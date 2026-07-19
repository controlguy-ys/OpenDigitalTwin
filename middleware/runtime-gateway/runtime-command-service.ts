import {
  validateCommandRequestV1,
  validateCommandResultV1,
  validateRuntimePublisherLeaseV1,
  type CommandRequestV1,
  type CommandResultV1,
  type RuntimePublisherLeaseV1,
} from '../../src/core/runtime-protocol/v1.js'
import type { WorkcellProjectV5 } from '../../src/core/project-v5/index.js'
import { compileOpcUaClientWritePlanV1 } from './opcua-client-write-service.js'
import type { OpcUaClientAdapterV1 } from './opcua-client-adapter.js'
import {
  RuntimeCommandDedupeAdmissionErrorV1,
  type RuntimeCommandDedupeRegistryV1,
} from './runtime-command-dedupe-registry.js'

export const RUNTIME_COMMAND_LEASE_TTL_MS_V1 = 5_000

export interface RuntimeCommandServiceV1 {
  lease(): RuntimePublisherLeaseV1
  execute(value: unknown): Promise<CommandResultV1>
  size(): number
  close(): void
}

export class RuntimeCommandServiceClosedErrorV1 extends Error {
  readonly code = 'COMMAND_LEASE_STALE' as const

  constructor() {
    super('COMMAND_LEASE_STALE')
    this.name = 'RuntimeCommandServiceClosedErrorV1'
  }
}

export interface RuntimeCommandServiceOptionsV1 {
  readonly project: WorkcellProjectV5
  readonly configRevision: string
  readonly publisherId: string
  readonly generation: number
  readonly nowMs: () => number
  readonly clientAdapter: Pick<OpcUaClientAdapterV1, 'status' | 'write'>
  readonly dedupe: RuntimeCommandDedupeRegistryV1
}

function commandKey(value: CommandRequestV1): string {
  return JSON.stringify([
    value.projectId, value.configRevision, value.leaseGeneration, value.targetId, value.commandId,
  ])
}

function commandFingerprint(value: CommandRequestV1): string {
  return JSON.stringify([
    value.projectId, value.configRevision, value.leaseGeneration, value.expiresAt, value.targetId, value.value,
  ])
}

function terminal(
  request: CommandRequestV1,
  acknowledgement: 'ACCEPTED' | 'REJECTED',
  failureCode: string | null,
  message: string,
  completedAt: number,
): CommandResultV1 {
  return validateCommandResultV1({
    type: 'command-result-v1',
    protocolVersion: 1,
    projectId: request.projectId,
    configRevision: request.configRevision,
    leaseGeneration: request.leaseGeneration,
    targetId: request.targetId,
    commandId: request.commandId,
    acknowledgement,
    executionState: failureCode === null ? 'SUCCEEDED' : 'FAILED',
    failureCode,
    message,
    attachedObjectId: null,
    completedAt,
  })
}

export function createRuntimeCommandServiceV1(
  options: RuntimeCommandServiceOptionsV1,
): RuntimeCommandServiceV1 {
  const writesByMappingId = new Map(
    compileOpcUaClientWritePlanV1(options.project).map((write) => [write.mappingId, write]),
  )
  let closed = false
  let resolveClosed!: () => void
  const closeSignal = new Promise<void>((resolve) => { resolveClosed = resolve })
  const handled = new WeakMap<Promise<CommandResultV1>, Promise<CommandResultV1>>()

  function rejected(request: CommandRequestV1, code: string, message: string): CommandResultV1 {
    return terminal(request, 'REJECTED', code, message, options.nowMs())
  }

  function acceptedFailure(request: CommandRequestV1, code: string, message: string): CommandResultV1 {
    return terminal(request, 'ACCEPTED', code, message, options.nowMs())
  }

  function preflight(request: CommandRequestV1): CommandResultV1 | null {
    if (closed) return rejected(request, 'COMMAND_LEASE_STALE', 'Command service is closed.')
    if (request.projectId !== options.project.projectId) {
      return rejected(request, 'PROJECT_MISMATCH', 'Command Project does not match the active Project.')
    }
    if (request.configRevision !== options.configRevision) {
      return rejected(request, 'REVISION_MISMATCH', 'Command Revision does not match the active Revision.')
    }
    if (request.leaseGeneration !== options.generation) {
      return rejected(request, 'COMMAND_LEASE_STALE', 'Command lease generation is stale.')
    }
    const now = options.nowMs()
    if (request.expiresAt < now) return rejected(request, 'COMMAND_EXPIRED', 'Command has expired.')
    if (request.expiresAt > now + RUNTIME_COMMAND_LEASE_TTL_MS_V1) {
      return rejected(request, 'COMMAND_EXPIRY_INVALID', 'Command expiry is beyond the lease limit.')
    }
    const write = writesByMappingId.get(request.targetId)
    if (write === undefined) {
      return rejected(request, 'COMMAND_TARGET_INVALID', 'Command target is not a writable Boolean Mapping.')
    }
    if (typeof request.value !== 'boolean') {
      return rejected(request, 'COMMAND_TYPE_MISMATCH', 'Command value must be Boolean.')
    }
    const endpoint = options.clientAdapter.status().find((candidate) => candidate.endpointId === write.endpointId)
    if (endpoint?.phase !== 'connected') {
      return rejected(request, 'OPC_UA_ENDPOINT_DISCONNECTED', 'Target OPC UA Endpoint is not connected.')
    }
    return null
  }

  function operation(request: CommandRequestV1): Promise<CommandResultV1> {
    const write = writesByMappingId.get(request.targetId)!
    const adapterResult = Promise.resolve()
      .then(() => options.clientAdapter.write({ mappingId: write.mappingId, value: request.value as boolean }))
      .then((value) => value.ok
        ? terminal(request, 'ACCEPTED', null, 'OPC UA write succeeded.', options.nowMs())
        : acceptedFailure(request, value.failureCode, value.message),
      () => acceptedFailure(request, 'OPC_UA_WRITE_FAILED', 'OPC UA write failed.'))
    return Promise.race([
      adapterResult,
      closeSignal.then(() => acceptedFailure(request, 'COMMAND_SERVICE_CLOSED', 'Command service closed before write completion.')),
    ])
  }

  function execute(value: unknown): Promise<CommandResultV1> {
    const request = validateCommandRequestV1(value)
    const original = options.dedupe.execute({
      channel: 'client-write', key: commandKey(request), fingerprint: commandFingerprint(request),
    }, {
      preflight: () => preflight(request),
      operation: () => operation(request),
    })
    const existing = handled.get(original)
    if (existing !== undefined) return existing
    const converted = original.catch((error: unknown) => {
      if (error instanceof RuntimeCommandDedupeAdmissionErrorV1) {
        return rejected(request, error.code, error.code === 'COMMAND_ID_CONFLICT'
          ? 'Command identity was already admitted with a different request.'
          : 'Command deduplication capacity is exhausted.')
      }
      return acceptedFailure(request, 'OPC_UA_WRITE_FAILED', 'OPC UA write failed.')
    })
    handled.set(original, converted)
    return converted
  }

  return Object.freeze({
    lease() {
      if (closed) throw new RuntimeCommandServiceClosedErrorV1()
      return validateRuntimePublisherLeaseV1({
        projectId: options.project.projectId,
        configRevision: options.configRevision,
        publisherId: options.publisherId,
        generation: options.generation,
        expiresAt: options.nowMs() + RUNTIME_COMMAND_LEASE_TTL_MS_V1,
      })
    },
    execute,
    size: () => options.dedupe.size(),
    close() {
      if (closed) return
      closed = true
      resolveClosed()
    },
  })
}
