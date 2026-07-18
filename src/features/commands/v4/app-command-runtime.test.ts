import { describe, expect, it, vi } from 'vitest'

import type { AppCommandV4 } from './app-command.js'
import { createAppCommandRegistryV4 } from './app-command-registry.js'
import { createAppCommandBindingsV4, createAppCommandRuntimeV4 } from './app-command-runtime.js'

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve
    reject = nextReject
  })
  return { promise, resolve, reject }
}

function command(
  id: string,
  overrides: Partial<AppCommandV4> = {},
): AppCommandV4 {
  return {
    id,
    label: id,
    section: 'project',
    kind: 'action',
    visible: true,
    enabled: true,
    execute: vi.fn(),
    ...overrides,
  }
}

function runtimeFor(commands: readonly AppCommandV4[]) {
  return createAppCommandRuntimeV4(createAppCommandRegistryV4(commands))
}

describe('createAppCommandRuntimeV4', () => {
  it('publishes pending synchronously, serializes one ID, and clears it after completion', async () => {
    const execution = deferred<void>()
    const execute = vi.fn(() => execution.promise)
    const runtime = runtimeFor([command('project.save', { execute })])
    const listener = vi.fn(() => runtime.getState())
    runtime.subscribe(listener)

    const first = runtime.invoke('project.save')
    const second = runtime.invoke('project.save')

    expect(execute).toHaveBeenCalledOnce()
    expect(runtime.getState().pendingCommandIds.has('project.save')).toBe(true)
    expect(listener).toHaveBeenCalledOnce()
    await expect(second).resolves.toBe('ignored')

    execution.resolve()
    await expect(first).resolves.toBe('completed')
    expect(runtime.getState().pendingCommandIds.has('project.save')).toBe(false)
    expect(listener).toHaveBeenCalledTimes(2)
  })

  it('runs different command IDs independently', async () => {
    const first = deferred<void>()
    const second = deferred<void>()
    const runtime = runtimeFor([
      command('project.save', { execute: () => first.promise }),
      command('project.export', { execute: () => second.promise }),
    ])

    const save = runtime.invoke('project.save')
    const exportProject = runtime.invoke('project.export')
    expect([...runtime.getState().pendingCommandIds]).toEqual([
      'project.save',
      'project.export',
    ])

    second.resolve()
    await expect(exportProject).resolves.toBe('completed')
    expect([...runtime.getState().pendingCommandIds]).toEqual(['project.save'])
    first.resolve()
    await expect(save).resolves.toBe('completed')
  })

  it('ignores unknown and disabled commands without execution, error clearing, or notification', async () => {
    const execute = vi.fn()
    const runtime = runtimeFor([command('project.save', { enabled: false, execute })])
    const listener = vi.fn()
    runtime.subscribe(listener)
    const before = runtime.getState()

    await expect(runtime.invoke('project.unknown')).resolves.toBe('ignored')
    await expect(runtime.invoke('project.save')).resolves.toBe('ignored')
    expect(execute).not.toHaveBeenCalled()
    expect(listener).not.toHaveBeenCalled()
    expect(runtime.getState()).toBe(before)
  })

  it('treats only an explicit cancellation result as cancelled without an error', async () => {
    const runtime = runtimeFor([command('project.import', {
      execute: () => Promise.resolve('cancelled'),
    })])

    await expect(runtime.invoke('project.import')).resolves.toBe('cancelled')
    expect(runtime.getState().pendingCommandIds.has('project.import')).toBe(false)
    expect(runtime.getState().errorByCommandId.has('project.import')).toBe(false)
  })

  it('converts synchronous throws and asynchronous rejections into failed outcomes', async () => {
    const runtime = runtimeFor([
      command('project.save', { execute: () => { throw new Error('Save failed.') } }),
      command('project.export', { execute: () => Promise.reject('not an Error') }),
    ])

    await expect(runtime.invoke('project.save')).resolves.toBe('failed')
    await expect(runtime.invoke('project.export')).resolves.toBe('failed')
    expect([...runtime.getState().errorByCommandId]).toEqual([
      ['project.save', 'Save failed.'],
      ['project.export', 'Command execution failed.'],
    ])
  })

  it('clears only the retried command error while preserving errors for other commands', async () => {
    let saveAttempt = 0
    const runtime = runtimeFor([
      command('project.save', {
        execute: () => {
          saveAttempt += 1
          if (saveAttempt === 1) throw new Error('Save failed.')
        },
      }),
      command('project.export', { execute: () => { throw new Error('Export failed.') } }),
    ])

    await runtime.invoke('project.save')
    await runtime.invoke('project.export')
    await expect(runtime.invoke('project.save')).resolves.toBe('completed')

    expect([...runtime.getState().errorByCommandId]).toEqual([
      ['project.export', 'Export failed.'],
    ])
  })

  it('publishes installed snapshots once for accepted starts and settlements only', async () => {
    const execution = deferred<void>()
    const runtime = runtimeFor([command('project.save', { execute: () => execution.promise })])
    const snapshots: object[] = []
    runtime.subscribe(() => snapshots.push(runtime.getState()))

    const invocation = runtime.invoke('project.save')
    await runtime.invoke('project.unknown')
    await runtime.invoke('project.save')
    execution.resolve()
    await invocation

    expect(snapshots).toHaveLength(2)
    expect((snapshots[0] as ReturnType<typeof runtime.getState>).pendingCommandIds.has('project.save')).toBe(true)
    expect((snapshots[1] as ReturnType<typeof runtime.getState>).pendingCommandIds.has('project.save')).toBe(false)
  })

  it('keeps state identity stable between publications and replaces it for start, settlement, and registry replacement', async () => {
    const execution = deferred<void>()
    const runtime = runtimeFor([command('project.save', { execute: () => execution.promise })])
    const initial = runtime.getState()

    expect(runtime.getState()).toBe(initial)
    const invocation = runtime.invoke('project.save')
    const pending = runtime.getState()
    expect(pending).not.toBe(initial)
    execution.resolve()
    await invocation
    const settled = runtime.getState()
    expect(settled).not.toBe(pending)

    runtime.replaceRegistry(createAppCommandRegistryV4([command('project.save')]))
    expect(runtime.getState()).not.toBe(settled)
  })

  it('replaces the registry immediately, preserves state, and keeps bindings dynamic', async () => {
    const original = command('project.save', { execute: () => { throw new Error('first') } })
    const runtime = runtimeFor([original])
    const bindings = createAppCommandBindingsV4(runtime)
    await runtime.invoke('project.save')
    const before = runtime.getState()
    const replacementExecute = vi.fn()
    const replacementRegistry = createAppCommandRegistryV4([
      command('project.save', { label: 'Save replacement', execute: replacementExecute }),
    ])
    const listener = vi.fn()
    runtime.subscribe(listener)

    runtime.replaceRegistry(replacementRegistry)

    expect(runtime.getRegistry()).toBe(replacementRegistry)
    expect(bindings.getRegistry()).toBe(replacementRegistry)
    expect(runtime.getState()).not.toBe(before)
    expect(runtime.getState().errorByCommandId.get('project.save')).toBe('first')
    expect(listener).toHaveBeenCalledOnce()
    await expect(runtime.invoke('project.save')).resolves.toBe('completed')
    expect(replacementExecute).toHaveBeenCalledOnce()
  })

  it('continues an accepted command across registry replacement and blocks its replacement by ID', async () => {
    const originalExecution = deferred<void>()
    const originalExecute = vi.fn(() => originalExecution.promise)
    const runtime = runtimeFor([command('project.save', { execute: originalExecute })])
    const originalInvocation = runtime.invoke('project.save')
    const replacementExecute = vi.fn()
    runtime.replaceRegistry(createAppCommandRegistryV4([
      command('project.save', { execute: replacementExecute }),
    ]))

    await expect(runtime.invoke('project.save')).resolves.toBe('ignored')
    expect(replacementExecute).not.toHaveBeenCalled()
    originalExecution.resolve()
    await expect(originalInvocation).resolves.toBe('completed')
    await expect(runtime.invoke('project.save')).resolves.toBe('completed')
    expect(originalExecute).toHaveBeenCalledOnce()
    expect(replacementExecute).toHaveBeenCalledOnce()
  })

  it('does not expose mutable pending or error collections', async () => {
    const execution = deferred<void>()
    const runtime = runtimeFor([command('project.save', { execute: () => execution.promise })])
    const invocation = runtime.invoke('project.save')
    const snapshot = runtime.getState()

    expect(() => (snapshot.pendingCommandIds as unknown as Set<string>).add('poison')).toThrow()
    expect(() => (snapshot.errorByCommandId as unknown as Map<string, string>).set('poison', 'poison')).toThrow()
    expect(runtime.getState().pendingCommandIds.has('poison')).toBe(false)
    expect(runtime.getState().errorByCommandId.has('poison')).toBe(false)
    execution.resolve()
    await invocation
  })

  it('stops observing after idempotent disposal while accepted invocations retain their outcome', async () => {
    const execution = deferred<void>()
    const runtime = runtimeFor([command('project.save', { execute: () => execution.promise })])
    const listener = vi.fn()
    runtime.subscribe(listener)
    const invocation = runtime.invoke('project.save')
    const pendingSnapshot = runtime.getState()

    runtime.dispose()
    runtime.dispose()
    runtime.replaceRegistry(createAppCommandRegistryV4([command('project.save')]))
    execution.resolve()
    await expect(invocation).resolves.toBe('completed')
    await expect(runtime.invoke('project.save')).resolves.toBe('ignored')

    expect(listener).toHaveBeenCalledOnce()
    expect(runtime.getState()).toBe(pendingSnapshot)
    expect(runtime.getState().pendingCommandIds.has('project.save')).toBe(true)
  })
})
