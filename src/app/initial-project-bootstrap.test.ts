import { describe, expect, it, vi } from 'vitest'
import type { WorkcellProjectSnapshotV3 } from '../domain/project/project-v3'
import { createInitialProjectBootstrap } from './initial-project-bootstrap'

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => { resolve = done })
  return { promise, resolve }
}

describe('initial project bootstrap', () => {
  it('shares one New Project call across active StrictMode effect replays', async () => {
    const hydration = deferred()
    const state = {
      activeSnapshot: null,
      status: 'idle' as const,
      hydrate: vi.fn(() => hydration.promise),
      newProject: vi.fn(async () => undefined),
    }
    const bootstrap = createInitialProjectBootstrap({ getState: () => state })
    let firstActive = true
    const first = bootstrap.run(() => firstActive)
    firstActive = false
    const second = bootstrap.run(() => true)

    hydration.resolve()
    await Promise.all([first, second])

    expect(state.hydrate).toHaveBeenCalledTimes(2)
    expect(state.newProject).toHaveBeenCalledTimes(1)
  })

  it.each(['error', 'recovery-required', 'loading', 'ready'] as const)(
    'does not overwrite an empty Project store in %s status',
    async (status) => {
      const state = {
        activeSnapshot: null,
        status,
        hydrate: vi.fn(async () => undefined),
        newProject: vi.fn(async () => undefined),
      }
      const bootstrap = createInitialProjectBootstrap({ getState: () => state })

      await bootstrap.run(() => true)

      expect(state.newProject).not.toHaveBeenCalled()
    },
  )

  it('does not replace a Project that hydration made active', async () => {
    const state = {
      activeSnapshot: null as WorkcellProjectSnapshotV3 | null,
      status: 'idle' as const,
      hydrate: vi.fn(async () => {
        state.activeSnapshot = {} as WorkcellProjectSnapshotV3
      }),
      newProject: vi.fn(async () => undefined),
    }
    const bootstrap = createInitialProjectBootstrap({ getState: () => state })

    await bootstrap.run(() => true)

    expect(state.newProject).not.toHaveBeenCalled()
  })
})
