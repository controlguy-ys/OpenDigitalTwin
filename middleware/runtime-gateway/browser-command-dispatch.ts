import {
  validateCommandBatchV1,
  validateCommandResultV1,
  type CommandBatchV1,
  type CommandResultV1,
} from '../../src/core/runtime-protocol/v1.js'
import {
  RuntimeCommandDedupeAdmissionErrorV1,
  type RuntimeCommandDedupeRegistryV1,
} from './runtime-command-dedupe-registry.js'
import type { BrowserPublisherLeaseManagerV1 } from './browser-publisher-lease.js'
import type { ProductCommandSnapshotV1 } from './opcua-command-staging.js'

export type { ProductCommandPayloadV1, ProductCommandSnapshotV1 } from './opcua-command-staging.js'

export interface BrowserCommandDispatchV1 {
  execute(snapshot: ProductCommandSnapshotV1): Promise<CommandResultV1>
}

function rejected(
  snapshot: ProductCommandSnapshotV1,
  leaseGeneration: number,
  code: string,
  message: string,
  completedAt: number,
): CommandResultV1 {
  return validateCommandResultV1({
    type: 'command-result-v1', protocolVersion: 1, projectId: snapshot.projectId,
    configRevision: snapshot.configRevision, leaseGeneration, targetId: snapshot.targetId,
    commandId: snapshot.requestId, acknowledgement: 'REJECTED', executionState: 'FAILED',
    failureCode: code, message, attachedObjectId: null, completedAt,
  })
}

function running(snapshot: ProductCommandSnapshotV1, leaseGeneration: number): CommandResultV1 {
  return validateCommandResultV1({
    type: 'command-result-v1', protocolVersion: 1, projectId: snapshot.projectId,
    configRevision: snapshot.configRevision, leaseGeneration, targetId: snapshot.targetId,
    commandId: snapshot.requestId, acknowledgement: 'ACCEPTED', executionState: 'RUNNING',
    failureCode: null, message: 'Browser command is running.', attachedObjectId: null, completedAt: null,
  })
}

function acceptedFailure(snapshot: ProductCommandSnapshotV1, leaseGeneration: number, code: string, message: string, completedAt: number): CommandResultV1 {
  return validateCommandResultV1({
    ...running(snapshot, leaseGeneration), executionState: 'FAILED', failureCode: code,
    message, completedAt,
  })
}

function key(snapshot: ProductCommandSnapshotV1, leaseGeneration: number): string {
  return JSON.stringify([snapshot.projectId, snapshot.configRevision, leaseGeneration, snapshot.requestId])
}

function fingerprint(snapshot: ProductCommandSnapshotV1, leaseGeneration: number): string {
  return JSON.stringify([snapshot.projectId, snapshot.configRevision, leaseGeneration, snapshot.expiresAt, snapshot.targetId, snapshot.payload])
}

export function createBrowserCommandDispatchV1(options: Readonly<{
  lease: BrowserPublisherLeaseManagerV1
  dedupe: RuntimeCommandDedupeRegistryV1
  send: (batch: CommandBatchV1) => Promise<CommandResultV1>
  publishResult: (result: CommandResultV1) => void
  /** Observes rejections that must not replace the canonical product Result record. */
  publishDiagnostic?: (result: CommandResultV1) => void
  nowMs: () => number
}>): BrowserCommandDispatchV1 {
  const handled = new WeakMap<Promise<CommandResultV1>, Promise<CommandResultV1>>()
  const now = (): number => {
    const value = options.nowMs()
    if (!Number.isSafeInteger(value) || value < 0) throw new TypeError('BROWSER_COMMAND_CLOCK_INVALID')
    return value
  }

  const execute = (snapshot: ProductCommandSnapshotV1): Promise<CommandResultV1> => {
    options.lease.tick()
    const active = options.lease.current()
    const generation = active?.generation ?? 1
      const preflight = (): CommandResultV1 | null => {
      options.lease.tick()
      const publisher = options.lease.current()
      if (publisher === null) {
        const result = rejected(snapshot, generation, 'BROWSER_PUBLISHER_UNAVAILABLE', 'No active Browser publisher is available.', now())
        options.publishResult(result)
        return result
      }
      if (publisher.projectId !== snapshot.projectId || publisher.configRevision !== snapshot.configRevision) {
        const result = rejected(snapshot, publisher.generation, 'REVISION_MISMATCH', 'Command does not match the active Browser Revision.', now())
        options.publishResult(result)
        return result
      }
      const at = now()
      if (snapshot.expiresAt <= at) {
        const result = rejected(snapshot, publisher.generation, 'COMMAND_EXPIRED', 'Command has expired.', at)
        options.publishResult(result)
        return result
      }
      if (snapshot.expiresAt > at + 60_000) {
        const result = rejected(snapshot, publisher.generation, 'COMMAND_EXPIRY_INVALID', 'Command expiry exceeds the staging limit.', at)
        options.publishResult(result)
        return result
      }
      return null
    }

    const publisher = active
    if (publisher === null) {
      const result = rejected(snapshot, generation, 'BROWSER_PUBLISHER_UNAVAILABLE', 'No active Browser publisher is available.', now())
      options.publishResult(result)
      return Promise.resolve(result)
    }
    const original = options.dedupe.execute({
      channel: 'server-command', key: key(snapshot, publisher.generation), fingerprint: fingerprint(snapshot, publisher.generation),
    }, {
      preflight,
      operation: () => {
        options.lease.tick()
        const beforeSend = options.lease.current()
        if (beforeSend === null || beforeSend.generation !== publisher.generation) {
          const result = rejected(snapshot, publisher.generation, 'BROWSER_PUBLISHER_UNAVAILABLE', 'Browser publisher lease expired before dispatch.', now())
          options.publishResult(result)
          return Promise.resolve(result)
        }
        const batch = validateCommandBatchV1({
          type: 'command-batch-v1', protocolVersion: 1, projectId: snapshot.projectId,
          configRevision: snapshot.configRevision, leaseGeneration: publisher.generation,
          commands: [{ commandId: snapshot.requestId, expiresAt: snapshot.expiresAt, targetId: snapshot.targetId, value: snapshot.payload }],
        })
        const started = running(snapshot, publisher.generation)
        options.publishResult(started)
        return Promise.resolve(options.send(batch)).then((result) => {
          const terminal = validateCommandResultV1(result)
          options.lease.tick()
          const current = options.lease.current()
          const fenced = current === null || current.generation !== publisher.generation
            ? acceptedFailure(snapshot, publisher.generation, 'COMMAND_LEASE_STALE', 'Browser publisher lease changed before command completion.', now())
            : terminal
          options.publishResult(fenced)
          return fenced
        }, () => {
          const terminal = acceptedFailure(snapshot, publisher.generation, 'BROWSER_COMMAND_FAILED', 'Browser command transport failed.', now())
          options.publishResult(terminal)
          return terminal
        })
      },
    })
    const existing = handled.get(original)
    if (existing !== undefined) {
      return existing.then((result) => {
        if (result.failureCode !== 'COMMAND_ID_CONFLICT') options.publishResult(result)
        return result
      })
    }
    const converted = original.catch((error: unknown) => {
      const code = error instanceof RuntimeCommandDedupeAdmissionErrorV1 ? error.code : 'BROWSER_COMMAND_FAILED'
      const message = code === 'COMMAND_ID_CONFLICT'
        ? 'Command identity was already admitted with a different request.'
        : code === 'COMMAND_DEDUPE_CAPACITY_EXHAUSTED'
          ? 'Command deduplication capacity is exhausted.'
          : 'Browser command transport failed.'
      const result = rejected(snapshot, publisher.generation, code, message, now())
      if (code === 'COMMAND_ID_CONFLICT') options.publishDiagnostic?.(result)
      else options.publishResult(result)
      return result
    })
    handled.set(original, converted)
    return converted
  }
  return Object.freeze({ execute })
}
