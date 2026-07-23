import { describe, expect, it, vi } from 'vitest'

import type { CommandResultV1 } from '../../src/core/runtime-protocol/v1.js'
import { createRuntimeCommandDedupeRegistryV1, MAX_RUNTIME_COMMAND_RECORDS_V1 } from './runtime-command-dedupe-registry.js'
import { createBrowserPublisherLeaseManagerV1 } from './browser-publisher-lease.js'
import { createBrowserCommandDispatchV1, type ProductCommandSnapshotV1 } from './browser-command-dispatch.js'

const REVISION = 'a'.repeat(64)

function deferred<T>(): { readonly promise: Promise<T>; resolve(value: T): void } {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

function snapshot(requestId = 'request-1'): ProductCommandSnapshotV1 {
  return {
    requestId, expiresAt: 2_000, projectId: 'project-v5', revisionId: 'revision-1', configRevision: REVISION,
    sessionId: 'session-a', targetId: 'box-1',
    payload: { kind: 'scene-object-pose', objectId: 'box-1', pose: { x: 1, y: 2, z: 3, roll: 0, pitch: 0, yaw: 0 } },
  }
}

function succeeded(commandId: string, completedAt = 1_250): CommandResultV1 {
  return {
    type: 'command-result-v1', protocolVersion: 1, projectId: 'project-v5', configRevision: REVISION,
    leaseGeneration: 1, targetId: 'box-1', commandId, acknowledgement: 'ACCEPTED', executionState: 'SUCCEEDED',
    failureCode: null, message: 'Succeeded.', attachedObjectId: null, completedAt,
  }
}

describe('BrowserCommandDispatchV1', () => {
  it('validates the entire outbound batch before publishing RUNNING', async () => {
    const lease = createBrowserPublisherLeaseManagerV1({ nowMs: () => 1_000 })
    lease.acquire({ projectId: 'project-v5', configRevision: REVISION, publisherId: 'browser-a' })
    const publishResult = vi.fn()
    const send = vi.fn()
    const dispatch = createBrowserCommandDispatchV1({
      lease, dedupe: createRuntimeCommandDedupeRegistryV1(), send, publishResult, nowMs: () => 1_000,
    })
    await expect(dispatch.execute(snapshot('x'.repeat(129)))).rejects.toThrow('RUNTIME_PROTOCOL_INVALID')
    expect(send).not.toHaveBeenCalled()
    expect(publishResult).not.toHaveBeenCalledWith(expect.objectContaining({ executionState: 'RUNNING' }))
  })

  it('publishes ACCEPTED/RUNNING before a deferred terminal result', async () => {
    const pending = deferred<CommandResultV1>()
    const lease = createBrowserPublisherLeaseManagerV1({ nowMs: () => 1_000 })
    lease.acquire({ projectId: 'project-v5', configRevision: REVISION, publisherId: 'browser-a' })
    const publishResult = vi.fn()
    const dispatch = createBrowserCommandDispatchV1({
      lease, dedupe: createRuntimeCommandDedupeRegistryV1(), send: vi.fn(() => pending.promise), publishResult, nowMs: () => 1_000,
    })
    const executing = dispatch.execute(snapshot())
    expect(publishResult).toHaveBeenCalledWith(expect.objectContaining({
      commandId: 'request-1', acknowledgement: 'ACCEPTED', executionState: 'RUNNING', completedAt: null,
    }))
    pending.resolve(succeeded('request-1'))
    await expect(executing).resolves.toEqual(succeeded('request-1'))
    expect(publishResult).toHaveBeenLastCalledWith(succeeded('request-1'))
  })

  it('rejects before dispatch when the Browser publisher is absent or expired', async () => {
    const lease = createBrowserPublisherLeaseManagerV1({ nowMs: () => 6_001 })
    const send = vi.fn()
    const publishResult = vi.fn()
    const dispatch = createBrowserCommandDispatchV1({ lease, dedupe: createRuntimeCommandDedupeRegistryV1(), send, publishResult, nowMs: () => 6_001 })
    await expect(dispatch.execute(snapshot())).resolves.toMatchObject({ acknowledgement: 'REJECTED', failureCode: 'BROWSER_PUBLISHER_UNAVAILABLE' })
    expect(send).not.toHaveBeenCalled()
    expect(publishResult).toHaveBeenCalledWith(expect.objectContaining({ executionState: 'FAILED' }))
  })

  it('uses one shared bounded registry and excludes the session from duplicate identity', async () => {
    const registry = createRuntimeCommandDedupeRegistryV1()
    const never = new Promise<never>(() => undefined)
    for (let index = 0; index < MAX_RUNTIME_COMMAND_RECORDS_V1; index += 1) {
      void registry.execute({ channel: 'client-write', key: `client-${index}`, fingerprint: 'same' }, { preflight: () => null, operation: () => never })
    }
    const lease = createBrowserPublisherLeaseManagerV1({ nowMs: () => 1_000 })
    lease.acquire({ projectId: 'project-v5', configRevision: REVISION, publisherId: 'browser-a' })
    const send = vi.fn(async () => succeeded('overflow'))
    const dispatch = createBrowserCommandDispatchV1({ lease, dedupe: registry, send, publishResult: vi.fn(), nowMs: () => 1_000 })
    await expect(dispatch.execute(snapshot('overflow'))).resolves.toMatchObject({
      acknowledgement: 'REJECTED', executionState: 'FAILED', failureCode: 'COMMAND_DEDUPE_CAPACITY_EXHAUSTED',
    })
    expect(send).not.toHaveBeenCalled()
  })

  it('keeps the canonical terminal Result when a conflicting retry is rejected and republishes it for an identical retry', async () => {
    const lease = createBrowserPublisherLeaseManagerV1({ nowMs: () => 1_000 })
    lease.acquire({ projectId: 'project-v5', configRevision: REVISION, publisherId: 'browser-a' })
    const publishResult = vi.fn()
    const dispatch = createBrowserCommandDispatchV1({
      lease, dedupe: createRuntimeCommandDedupeRegistryV1(), send: vi.fn(async () => succeeded('request-1')),
      publishResult, nowMs: () => 1_000,
    })
    const original = await dispatch.execute(snapshot('request-1'))
    const conflict = await dispatch.execute({ ...snapshot('request-1'), expiresAt: 2_001 })
    expect(conflict).toMatchObject({ acknowledgement: 'REJECTED', failureCode: 'COMMAND_ID_CONFLICT' })
    expect(publishResult).toHaveBeenLastCalledWith(original)

    await expect(dispatch.execute(snapshot('request-1'))).resolves.toEqual(original)
    expect(publishResult).toHaveBeenLastCalledWith(original)
  })
})
