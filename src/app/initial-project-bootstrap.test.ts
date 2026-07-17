import { describe, expect, it, vi } from 'vitest'

import type { WorkcellProjectV4 } from '../core/project-v4/index.js'
import { makeMinimalWorkcellProjectV4 } from '../core/project-v4/test-support.js'
import type { ProjectStoreStatusV4 } from '../features/project/v4/project-store-v4.js'
import {
  createInitialProjectBootstrapV4,
} from './initial-project-bootstrap.js'

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

describe('initial Project V4 bootstrap', () => {
  it('shares one New Project call across active StrictMode effect replays', async () => {
    const hydration = deferred()
    const state = {
      activeProject: null as WorkcellProjectV4 | null,
      status: 'idle' as ProjectStoreStatusV4,
      hydrate: vi.fn(async () => {
        await hydration.promise
        state.status = 'ready'
      }),
      newProject: vi.fn(async () => undefined),
    }
    const bootstrap = createInitialProjectBootstrapV4({
      getState: () => state,
    })
    let firstActive = true
    const first = bootstrap.run(() => firstActive)
    firstActive = false
    const second = bootstrap.run(() => true)

    hydration.resolve()
    await Promise.all([first, second])

    expect(state.hydrate).toHaveBeenCalledTimes(2)
    expect(state.newProject).toHaveBeenCalledTimes(1)
  })

  it.each(['error', 'recovery-required', 'loading'] as const)(
    'does not overwrite an empty V4 store in %s status',
    async (status) => {
      const state = {
        activeProject: null,
        status,
        hydrate: vi.fn(async () => undefined),
        newProject: vi.fn(async () => undefined),
      }
      const bootstrap = createInitialProjectBootstrapV4({
        getState: () => state,
      })

      await bootstrap.run(() => true)

      expect(state.newProject).not.toHaveBeenCalled()
    },
  )

  it('does not replace a V4 Project restored by hydrate', async () => {
    const state = {
      activeProject: null as WorkcellProjectV4 | null,
      status: 'idle' as ProjectStoreStatusV4,
      hydrate: vi.fn(async () => {
        state.activeProject = makeMinimalWorkcellProjectV4()
        state.status = 'ready'
      }),
      newProject: vi.fn(async () => undefined),
    }
    const bootstrap = createInitialProjectBootstrapV4({
      getState: () => state,
    })

    await bootstrap.run(() => true)

    expect(state.newProject).not.toHaveBeenCalled()
  })

  it('does not create a Project after an abandoned effect finishes hydrating', async () => {
    const hydration = deferred()
    const state = {
      activeProject: null,
      status: 'idle' as const,
      hydrate: vi.fn(() => hydration.promise),
      newProject: vi.fn(async () => undefined),
    }
    const bootstrap = createInitialProjectBootstrapV4({
      getState: () => state,
    })
    let active = true
    const pending = bootstrap.run(() => active)
    active = false
    hydration.resolve()

    await pending

    expect(state.newProject).not.toHaveBeenCalled()
  })
})
