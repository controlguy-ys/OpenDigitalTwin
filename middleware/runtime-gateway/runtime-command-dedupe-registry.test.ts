import { describe, expect, it, vi } from 'vitest'

import type { CommandResultV1 } from '../../src/core/runtime-protocol/v1.js'
import {
  createRuntimeCommandDedupeRegistryV1,
  MAX_RUNTIME_COMMAND_RECORDS_V1,
} from './runtime-command-dedupe-registry.js'

function deferred<T>(): { readonly promise: Promise<T>; resolve(value: T): void } {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

function result(commandId = 'command-1'): CommandResultV1 {
  return {
    type: 'command-result-v1', protocolVersion: 1, projectId: 'project-1',
    configRevision: 'a'.repeat(64), leaseGeneration: 1, targetId: 'target-1', commandId,
    acknowledgement: 'ACCEPTED', executionState: 'SUCCEEDED', failureCode: null,
    message: 'Succeeded.', attachedObjectId: null, completedAt: 1,
  }
}

function record(key = 'key-1', fingerprint = 'fingerprint-1') {
  return { channel: 'client-write' as const, key, fingerprint }
}

describe('RuntimeCommandDedupeRegistryV1', () => {
  it('inserts before invoking the operation so simultaneous duplicates join one write', async () => {
    const registry = createRuntimeCommandDedupeRegistryV1()
    const gate = deferred<CommandResultV1>()
    const operation = vi.fn(() => {
      expect(registry.has('client-write', 'key-1')).toBe(true)
      return gate.promise
    })
    const first = registry.execute(record(), { preflight: () => null, operation })
    const duplicate = registry.execute(record(), { preflight: () => null, operation })

    expect(first).toBe(duplicate)
    expect(operation).toHaveBeenCalledOnce()
    gate.resolve(result())
    await expect(Promise.all([first, duplicate])).resolves.toEqual([result(), result()])
  })

  it('does not retain preflight rejection and rejects a fingerprint conflict before invoking callbacks', async () => {
    const registry = createRuntimeCommandDedupeRegistryV1()
    const rejection = result('rejected')
    const operation = vi.fn(async () => result())
    await expect(registry.execute(record(), { preflight: () => rejection, operation })).resolves.toBe(rejection)
    expect(registry.size()).toBe(0)
    await registry.execute(record(), { preflight: () => null, operation })
    const conflictingPreflight = vi.fn(() => null)
    const conflictingOperation = vi.fn(async () => result('conflict'))
    await expect(registry.execute(record('key-1', 'different'), {
      preflight: conflictingPreflight,
      operation: conflictingOperation,
    }))
      .rejects.toMatchObject({ code: 'COMMAND_ID_CONFLICT' })
    expect(operation).toHaveBeenCalledOnce()
    expect(conflictingPreflight).not.toHaveBeenCalled()
    expect(conflictingOperation).not.toHaveBeenCalled()
  })

  it('evicts the oldest terminal record but never an in-flight record at shared capacity', async () => {
    const registry = createRuntimeCommandDedupeRegistryV1()
    const inFlight = deferred<CommandResultV1>()
    void registry.execute(record('in-flight'), { preflight: () => null, operation: () => inFlight.promise })
    for (let index = 1; index < MAX_RUNTIME_COMMAND_RECORDS_V1; index += 1) {
      await registry.execute(record(`terminal-${index}`), { preflight: () => null, operation: async () => result(String(index)) })
    }
    await registry.execute(record('new'), { preflight: () => null, operation: async () => result('new') })
    expect(registry.size()).toBe(MAX_RUNTIME_COMMAND_RECORDS_V1)
    expect(registry.has('client-write', 'in-flight')).toBe(true)
    expect(registry.has('client-write', 'terminal-1')).toBe(false)
  })

  it('marks a completed record terminal before its awaiters can make a capacity admission', async () => {
    const registry = createRuntimeCommandDedupeRegistryV1()
    for (let index = 0; index < MAX_RUNTIME_COMMAND_RECORDS_V1; index += 1) {
      await registry.execute(record(`terminal-${index}`), {
        preflight: () => null, operation: async () => result(String(index)),
      })
    }
    await expect(registry.execute(record('new-terminal'), {
      preflight: () => null, operation: async () => result('new-terminal'),
    })).resolves.toMatchObject({ commandId: 'new-terminal' })
    expect(registry.has('client-write', 'terminal-0')).toBe(false)
  })

  it('makes a gated completion evictable before its awaiting caller immediately admits at capacity', async () => {
    const registry = createRuntimeCommandDedupeRegistryV1()
    const gate = deferred<CommandResultV1>()
    const gated = registry.execute(record('gated-oldest'), {
      preflight: () => null,
      operation: () => gate.promise,
    })
    for (let index = 1; index < MAX_RUNTIME_COMMAND_RECORDS_V1; index += 1) {
      await registry.execute(record(`later-terminal-${index}`), {
        preflight: () => null,
        operation: async () => result(String(index)),
      })
    }
    gate.resolve(result('gated'))
    await gated
    await registry.execute(record('immediate-admission'), {
      preflight: () => null,
      operation: async () => result('immediate'),
    })
    expect(registry.size()).toBe(MAX_RUNTIME_COMMAND_RECORDS_V1)
    expect(registry.has('client-write', 'gated-oldest')).toBe(false)
    expect(registry.has('client-write', 'later-terminal-1')).toBe(true)
  })

  it('rejects capacity before execution when every shared record is in flight', async () => {
    const registry = createRuntimeCommandDedupeRegistryV1()
    const gate = deferred<CommandResultV1>()
    for (let index = 0; index < MAX_RUNTIME_COMMAND_RECORDS_V1; index += 1) {
      void registry.execute({ channel: index % 2 === 0 ? 'client-write' : 'server-command', key: `key-${index}`, fingerprint: 'same' }, {
        preflight: () => null, operation: () => gate.promise,
      })
    }
    const operation = vi.fn(async () => result('overflow'))
    await expect(registry.execute(record('overflow'), { preflight: () => null, operation }))
      .rejects.toMatchObject({ code: 'COMMAND_DEDUPE_CAPACITY_EXHAUSTED' })
    expect(operation).not.toHaveBeenCalled()
    gate.resolve(result())
  })

  it('does not resurrect a cleared in-flight record on completion', async () => {
    const registry = createRuntimeCommandDedupeRegistryV1()
    const gate = deferred<CommandResultV1>()
    const pending = registry.execute(record(), { preflight: () => null, operation: () => gate.promise })
    registry.clear()
    gate.resolve(result())
    await pending
    expect(registry.size()).toBe(0)
  })

  it('turns a synchronous operation throw into a terminal rejection without resurrecting after clear', async () => {
    const registry = createRuntimeCommandDedupeRegistryV1()
    const failure = new Error('synchronous-operation-failure')
    const pending = registry.execute(record(), {
      preflight: () => null,
      operation: () => { throw failure },
    })
    expect(registry.has('client-write', 'key-1')).toBe(true)
    registry.clear()
    await expect(pending).rejects.toBe(failure)
    expect(registry.size()).toBe(0)
  })
})
