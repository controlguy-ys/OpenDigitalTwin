import { describe, expect, it, vi } from 'vitest'

import {
  cloneWorkcellProjectV5,
  makeMinimalWorkcellProjectV5,
} from '../../src/core/project-v5/test-support.js'
import { validateWorkcellProjectV5, type WorkcellProjectV5 } from '../../src/core/project-v5/index.js'
import type { OpcUaClientAdapterV1 } from './opcua-client-adapter.js'
import {
  createRuntimeCommandDedupeRegistryV1,
  MAX_RUNTIME_COMMAND_RECORDS_V1,
} from './runtime-command-dedupe-registry.js'
import {
  createRuntimeCommandServiceV1,
  RuntimeCommandServiceClosedErrorV1,
} from './runtime-command-service.js'

const REVISION = 'a'.repeat(64)

function writableProject(): WorkcellProjectV5 {
  const project = cloneWorkcellProjectV5(makeMinimalWorkcellProjectV5())
  const signal = project.logicalSignals[0] as { direction: 'input' | 'output' | 'bidirectional' }
  signal.direction = 'output'
  const mapping = project.opcUa.mappings[0] as { direction: 'read' | 'write' | 'readWrite' }
  mapping.direction = 'write'
  return validateWorkcellProjectV5(project)
}

function request(overrides: Record<string, unknown> = {}) {
  return {
    type: 'command-request-v1', protocolVersion: 1, commandId: 'command-1', projectId: 'project-v5',
    configRevision: REVISION, leaseGeneration: 7, expiresAt: 6_000, targetId: 'mapping-1', value: true,
    ...overrides,
  }
}

function service(options: {
  readonly nowMs?: () => number
  readonly write?: OpcUaClientAdapterV1['write']
  readonly phase?: 'connected' | 'disabled'
} = {}) {
  const write: OpcUaClientAdapterV1['write'] = options.write
    ?? vi.fn(async () => ({ ok: true, statusCode: 'Good' } as const))
  const adapter: Pick<OpcUaClientAdapterV1, 'status' | 'write'> = {
    status: () => [{
      endpointId: 'endpoint-1', endpointUrl: 'opc.tcp://localhost:4840', phase: options.phase ?? 'connected',
      sessionActive: false, subscriptionActive: false, monitoredItemCount: 0, mappingCount: 1,
      lastValueQuality: null, lastNotificationAtMs: null, lastGoodValueAtMs: null,
      reconnectAttempt: 0, nextRetryAtMs: null, lastError: null,
    }],
    write,
  }
  return {
    adapter,
    service: createRuntimeCommandServiceV1({
      project: writableProject(), configRevision: REVISION, publisherId: 'gateway-1:client-write', generation: 7,
      nowMs: options.nowMs ?? (() => 1_000), clientAdapter: adapter,
      dedupe: createRuntimeCommandDedupeRegistryV1(),
    }),
  }
}

describe('RuntimeCommandServiceV1', () => {
  it.each([
    ['wrong project', { projectId: 'other-project' }, 'PROJECT_MISMATCH'],
    ['wrong revision', { configRevision: 'b'.repeat(64) }, 'REVISION_MISMATCH'],
    ['stale generation', { leaseGeneration: 6 }, 'COMMAND_LEASE_STALE'],
    ['expired', { expiresAt: 999 }, 'COMMAND_EXPIRED'],
    ['future expiry', { expiresAt: 6_001 }, 'COMMAND_EXPIRY_INVALID'],
    ['unknown target', { targetId: 'missing' }, 'COMMAND_TARGET_INVALID'],
    ['wrong type', { value: 1 }, 'COMMAND_TYPE_MISMATCH'],
  ])('returns an unretained %s rejection before write', async (_name, override, failureCode) => {
    const { service: commands, adapter } = service()
    await expect(commands.execute(request(override))).resolves.toMatchObject({
      acknowledgement: 'REJECTED', executionState: 'FAILED', failureCode,
    })
    expect(adapter.write).not.toHaveBeenCalled()
    expect(commands.size()).toBe(0)
  })

  it('uses a single preflight clock sample and permits exactly five seconds', async () => {
    const nowMs = vi.fn().mockReturnValueOnce(1_000).mockReturnValue(1_001)
    const { service: commands } = service({ nowMs })
    await expect(commands.execute(request())).resolves.toMatchObject({
      acknowledgement: 'ACCEPTED', executionState: 'SUCCEEDED', completedAt: 1_001,
    })
    expect(nowMs).toHaveBeenCalledTimes(2)
  })

  it('retains identical accepted commands after expiry and rejects changed fingerprints', async () => {
    const { service: commands, adapter } = service()
    const first = await commands.execute(request({ expiresAt: 1_000 }))
    await expect(commands.execute(request({ expiresAt: 1_000, value: false }))).resolves.toMatchObject({
      acknowledgement: 'REJECTED', failureCode: 'COMMAND_ID_CONFLICT',
    })
    await expect(commands.execute(request({ expiresAt: 1_000 }))).resolves.toEqual(first)
    expect(adapter.write).toHaveBeenCalledOnce()
  })

  it('closes new admissions while settling a never-ending admitted write and preserving duplicates', async () => {
    const write = vi.fn(() => new Promise<never>(() => undefined))
    const { service: commands } = service({ write })
    const first = commands.execute(request())
    const joined = commands.execute(request())
    commands.close()
    const afterClose = commands.execute(request())
    expect(first).toBe(joined)
    expect(first).toBe(afterClose)
    await expect(first).resolves.toMatchObject({
      acknowledgement: 'ACCEPTED', executionState: 'FAILED', failureCode: 'COMMAND_SERVICE_CLOSED',
    })
    await expect(commands.execute(request({ commandId: 'new' }))).resolves.toMatchObject({
      acknowledgement: 'REJECTED', failureCode: 'COMMAND_LEASE_STALE',
    })
  })

  it('maps adapter failures to retained terminal envelopes without a status code', async () => {
    const { service: commands } = service({
      write: async () => ({ ok: false, statusCode: 'BadUserAccessDenied', failureCode: 'OPC_UA_WRITE_REJECTED', message: 'Rejected.' }),
    })
    const value = await commands.execute(request())
    expect(Object.keys(value)).toHaveLength(13)
    expect(value).toMatchObject({ acknowledgement: 'ACCEPTED', executionState: 'FAILED', failureCode: 'OPC_UA_WRITE_REJECTED' })
    expect(value).not.toHaveProperty('statusCode')
  })

  it('rejects disconnected endpoints before adapter writes', async () => {
    const { service: commands, adapter } = service({ phase: 'disabled' })
    await expect(commands.execute(request())).resolves.toMatchObject({ failureCode: 'OPC_UA_ENDPOINT_DISCONNECTED' })
    expect(adapter.write).not.toHaveBeenCalled()
  })

  it('renews the lease on every read and throws the typed stale error after close', () => {
    const nowMs = vi.fn().mockReturnValueOnce(1_000).mockReturnValueOnce(1_250)
    const { service: commands } = service({ nowMs })
    expect(commands.lease()).toEqual({
      projectId: 'project-v5', configRevision: REVISION, publisherId: 'gateway-1:client-write',
      generation: 7, expiresAt: 6_000,
    })
    expect(commands.lease()).toMatchObject({ expiresAt: 6_250 })
    commands.close()
    expect(() => commands.lease()).toThrow(RuntimeCommandServiceClosedErrorV1)
    try {
      commands.lease()
    } catch (error) {
      expect(error).toMatchObject({ code: 'COMMAND_LEASE_STALE' })
    }
  })

  it.each([
    ['input Signal', makeMinimalWorkcellProjectV5()],
    ['non-write Mapping', (() => {
      const project = cloneWorkcellProjectV5(makeMinimalWorkcellProjectV5())
      ;(project.logicalSignals[0] as { direction: 'input' | 'bidirectional' }).direction = 'bidirectional'
      return validateWorkcellProjectV5(project)
    })()],
  ])('rejects a %s target before adapter write', async (_name, project) => {
    const write = vi.fn(async () => ({ ok: true, statusCode: 'Good' } as const))
    const commands = createRuntimeCommandServiceV1({
      project, configRevision: REVISION, publisherId: 'gateway-1:client-write', generation: 7,
      nowMs: () => 1_000,
      clientAdapter: { status: service().adapter.status, write },
      dedupe: createRuntimeCommandDedupeRegistryV1(),
    })
    await expect(commands.execute(request())).resolves.toMatchObject({
      acknowledgement: 'REJECTED', failureCode: 'COMMAND_TARGET_INVALID',
    })
    expect(write).not.toHaveBeenCalled()
  })

  it('retains an unexpected adapter rejection as an exact accepted write failure', async () => {
    const write = vi.fn(async () => { throw new Error('unexpected-adapter-rejection') })
    const { service: commands } = service({ write })
    const first = commands.execute(request())
    const retry = commands.execute(request())
    expect(first).toBe(retry)
    const expected = {
      type: 'command-result-v1', protocolVersion: 1, projectId: 'project-v5', configRevision: REVISION,
      leaseGeneration: 7, targetId: 'mapping-1', commandId: 'command-1',
      acknowledgement: 'ACCEPTED', executionState: 'FAILED', failureCode: 'OPC_UA_WRITE_FAILED',
      message: 'OPC UA write failed.', attachedObjectId: null, completedAt: 1_000,
    }
    await expect(first).resolves.toEqual(expected)
    expect(write).toHaveBeenCalledOnce()
  })

  it('converts shared-registry capacity exhaustion into the exact rejected envelope', async () => {
    const registry = createRuntimeCommandDedupeRegistryV1()
    const never = new Promise<never>(() => undefined)
    for (let index = 0; index < MAX_RUNTIME_COMMAND_RECORDS_V1; index += 1) {
      void registry.execute({ channel: 'server-command', key: `server-${index}`, fingerprint: 'same' }, {
        preflight: () => null,
        operation: () => never,
      })
    }
    const write = vi.fn(async () => ({ ok: true, statusCode: 'Good' } as const))
    const commands = createRuntimeCommandServiceV1({
      project: writableProject(), configRevision: REVISION, publisherId: 'gateway-1:client-write', generation: 7,
      nowMs: () => 1_000,
      clientAdapter: { status: service().adapter.status, write },
      dedupe: registry,
    })
    await expect(commands.execute(request())).resolves.toEqual({
      type: 'command-result-v1', protocolVersion: 1, projectId: 'project-v5', configRevision: REVISION,
      leaseGeneration: 7, targetId: 'mapping-1', commandId: 'command-1',
      acknowledgement: 'REJECTED', executionState: 'FAILED',
      failureCode: 'COMMAND_DEDUPE_CAPACITY_EXHAUSTED',
      message: 'Command deduplication capacity is exhausted.', attachedObjectId: null, completedAt: 1_000,
    })
    expect(write).not.toHaveBeenCalled()
  })

  it('applies Project, Revision, generation, expiry, target, type, then connectivity precedence', async () => {
    const { service: commands, adapter } = service({ phase: 'disabled' })
    const invalid = {
      projectId: 'other-project', configRevision: 'b'.repeat(64), leaseGeneration: 6,
      expiresAt: 999, targetId: 'missing', value: 1,
    }
    const cases = [
      ['PROJECT_MISMATCH', invalid],
      ['REVISION_MISMATCH', { ...invalid, projectId: 'project-v5' }],
      ['COMMAND_LEASE_STALE', { ...invalid, projectId: 'project-v5', configRevision: REVISION }],
      ['COMMAND_EXPIRED', { ...invalid, projectId: 'project-v5', configRevision: REVISION, leaseGeneration: 7 }],
      ['COMMAND_TARGET_INVALID', { ...invalid, projectId: 'project-v5', configRevision: REVISION, leaseGeneration: 7, expiresAt: 6_000 }],
      ['COMMAND_TYPE_MISMATCH', { ...invalid, projectId: 'project-v5', configRevision: REVISION, leaseGeneration: 7, expiresAt: 6_000, targetId: 'mapping-1' }],
      ['OPC_UA_ENDPOINT_DISCONNECTED', { projectId: 'project-v5', configRevision: REVISION, leaseGeneration: 7, expiresAt: 6_000, targetId: 'mapping-1', value: true }],
    ] as const
    for (const [failureCode, override] of cases) {
      await expect(commands.execute(request({ ...override, commandId: `precedence-${failureCode}` })))
        .resolves.toMatchObject({ failureCode })
    }
    expect(adapter.write).not.toHaveBeenCalled()
  })
})
