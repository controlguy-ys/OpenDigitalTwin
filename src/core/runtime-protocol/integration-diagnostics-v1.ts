import { validateCommandResultV1, type CommandResultV1 } from './v1.js'

export interface RuntimeIntegrationDiagnosticsV1 {
  readonly type: 'runtime-integration-diagnostics-v1'
  readonly protocolVersion: 1
  readonly observedAtMs: number
  readonly projectId: string | null
  readonly revisionId: string | null
  readonly configRevision: string | null
  readonly serverModel: {
    readonly standardNodeSets: 'disabled' | 'loaded' | 'faulted'
    readonly roboticsModel: 'disabled' | 'ready' | 'faulted'
    readonly productModel: 'disabled' | 'ready' | 'faulted'
    readonly activeSessionCount: number
    readonly maximumSessionCount: 16
    readonly lastError: string | null
  }
  readonly browserPublisher: {
    readonly phase: 'absent' | 'active' | 'expired'
    readonly publisherId: string | null
    readonly generation: number | null
    readonly expiresAt: number | null
  }
  readonly lastCommandResult: CommandResultV1 | null
}

function exact(record: Record<string, unknown>, keys: readonly string[]): void {
  if (Object.keys(record).length !== keys.length || keys.some((key) => !Object.hasOwn(record, key))) throw new Error('RUNTIME_PROTOCOL_INVALID')
}
function object(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) throw new Error('RUNTIME_PROTOCOL_INVALID')
  return value as Record<string, unknown>
}
function integer(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) throw new Error('RUNTIME_PROTOCOL_INVALID')
  return value as number
}
function nullableText(value: unknown): string | null {
  if (value === null || typeof value === 'string') return value
  throw new Error('RUNTIME_PROTOCOL_INVALID')
}
function enumValue<T extends string>(value: unknown, values: readonly T[]): T {
  if (typeof value !== 'string' || !values.includes(value as T)) throw new Error('RUNTIME_PROTOCOL_INVALID')
  return value as T
}

export function validateRuntimeIntegrationDiagnosticsV1(value: unknown): RuntimeIntegrationDiagnosticsV1 {
  const record = object(value)
  exact(record, ['type', 'protocolVersion', 'observedAtMs', 'projectId', 'revisionId', 'configRevision', 'serverModel', 'browserPublisher', 'lastCommandResult'])
  if (record.type !== 'runtime-integration-diagnostics-v1' || record.protocolVersion !== 1) throw new Error('RUNTIME_PROTOCOL_INVALID')
  const projectId = nullableText(record.projectId)
  const revisionId = nullableText(record.revisionId)
  const configRevision = nullableText(record.configRevision)
  if ((projectId === null) !== (revisionId === null) || (projectId === null) !== (configRevision === null)) throw new Error('RUNTIME_PROTOCOL_INVALID')
  const server = object(record.serverModel)
  exact(server, ['standardNodeSets', 'roboticsModel', 'productModel', 'activeSessionCount', 'maximumSessionCount', 'lastError'])
  const serverModel = Object.freeze({
    standardNodeSets: enumValue(server.standardNodeSets, ['disabled', 'loaded', 'faulted']),
    roboticsModel: enumValue(server.roboticsModel, ['disabled', 'ready', 'faulted']),
    productModel: enumValue(server.productModel, ['disabled', 'ready', 'faulted']),
    activeSessionCount: integer(server.activeSessionCount), maximumSessionCount: server.maximumSessionCount as 16,
    lastError: nullableText(server.lastError),
  })
  if (serverModel.maximumSessionCount !== 16 || serverModel.activeSessionCount > 16) throw new Error('RUNTIME_PROTOCOL_INVALID')
  if (projectId === null && (serverModel.standardNodeSets !== 'disabled' || serverModel.roboticsModel !== 'disabled' || serverModel.productModel !== 'disabled' || serverModel.activeSessionCount !== 0)) throw new Error('RUNTIME_PROTOCOL_INVALID')
  const publisher = object(record.browserPublisher)
  exact(publisher, ['phase', 'publisherId', 'generation', 'expiresAt'])
  const phase = enumValue(publisher.phase, ['absent', 'active', 'expired'])
  const publisherId = nullableText(publisher.publisherId)
  const generation = publisher.generation === null ? null : integer(publisher.generation)
  const expiresAt = publisher.expiresAt === null ? null : integer(publisher.expiresAt)
  if ((phase === 'active') !== (publisherId !== null && generation !== null && expiresAt !== null)) throw new Error('RUNTIME_PROTOCOL_INVALID')
  if (phase !== 'active' && (publisherId !== null || generation !== null || expiresAt !== null)) throw new Error('RUNTIME_PROTOCOL_INVALID')
  const lastCommandResult = record.lastCommandResult === null ? null : validateCommandResultV1(record.lastCommandResult)
  return Object.freeze({ type: 'runtime-integration-diagnostics-v1', protocolVersion: 1, observedAtMs: integer(record.observedAtMs), projectId, revisionId, configRevision, serverModel, browserPublisher: Object.freeze({ phase, publisherId, generation, expiresAt }), lastCommandResult })
}
