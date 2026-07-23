import { describe, expect, it, vi } from 'vitest'

import { makeMinimalWorkcellProjectV5 } from '../../core/project-v5/test-support.js'
import { createInitialProjectBootstrapV5 } from './initial-project-bootstrap-v5.js'

describe('initial Project V5 bootstrap', () => {
  it('coalesces StrictMode-style concurrent runs and creates only one default project after an empty hydrate', async () => {
    const state = { activeProject: null as ReturnType<typeof makeMinimalWorkcellProjectV5> | null, status: 'idle' as 'idle' | 'ready' }
    const hydrate = vi.fn(async () => undefined)
    const newProject = vi.fn(async () => { state.activeProject = makeMinimalWorkcellProjectV5(); state.status = 'ready' })
    const bootstrap = createInitialProjectBootstrapV5({ getState: () => ({ ...state, hydrate, newProject }) })

    await Promise.all([bootstrap.run(() => true), bootstrap.run(() => true)])

    expect(hydrate).toHaveBeenCalledTimes(1)
    expect(newProject).toHaveBeenCalledTimes(1)
  })

  it('stops after hydration when its caller is inactive', async () => {
    const hydrate = vi.fn(async () => undefined)
    const newProject = vi.fn(async () => undefined)
    const bootstrap = createInitialProjectBootstrapV5({ getState: () => ({ activeProject: null, status: 'idle' as const, hydrate, newProject }) })

    await bootstrap.run(() => false)

    expect(newProject).not.toHaveBeenCalled()
  })

  it('creates the default project when an active StrictMode remount joins an inactive first run', async () => {
    let releaseHydrate!: () => void
    const hydrate = vi.fn(() => new Promise<void>((resolve) => { releaseHydrate = resolve }))
    const newProject = vi.fn(async () => undefined)
    const bootstrap = createInitialProjectBootstrapV5({ getState: () => ({ activeProject: null, status: 'idle' as const, hydrate, newProject }) })

    const first = bootstrap.run(() => false)
    const second = bootstrap.run(() => true)
    await vi.waitFor(() => expect(hydrate).toHaveBeenCalledOnce())
    releaseHydrate()
    await Promise.all([first, second])

    expect(newProject).toHaveBeenCalledOnce()
  })

  it('lets an active reentrant late joiner create after the first caller decides to skip', async () => {
    const hydrate = vi.fn(async () => undefined)
    const newProject = vi.fn(async () => undefined)
    const bootstrap = createInitialProjectBootstrapV5({ getState: () => ({ activeProject: null, status: 'idle' as const, hydrate, newProject }) })
    let late: Promise<void> | null = null

    const first = bootstrap.run(() => {
      late = bootstrap.run(() => true)
      return false
    })
    await first
    await late

    expect(hydrate).toHaveBeenCalledOnce()
    expect(newProject).toHaveBeenCalledOnce()
  })

  it('publishes the shared hydration handle before hydrate can synchronously reenter', async () => {
    let reentrant: Promise<void> | null = null
    let bootstrap!: ReturnType<typeof createInitialProjectBootstrapV5>
    const newProject = vi.fn(async () => undefined)
    const hydrate = vi.fn(async () => {
      reentrant = bootstrap.run(() => true)
    })
    bootstrap = createInitialProjectBootstrapV5({
      getState: () => ({ activeProject: null, status: 'idle' as const, hydrate, newProject }),
    })

    await bootstrap.run(() => true)
    await reentrant

    expect(hydrate).toHaveBeenCalledOnce()
    expect(newProject).toHaveBeenCalledOnce()
  })

  it('lets a late joiner await the exact in-flight New Project result while the store is saving', async () => {
    let releaseNew!: () => void
    const state = { activeProject: null, status: 'idle' as 'idle' | 'saving' | 'ready' }
    const hydrate = vi.fn(async () => undefined)
    const newProject = vi.fn(() => {
      state.status = 'saving'
      return new Promise<void>((resolve) => {
        releaseNew = () => { state.status = 'ready'; resolve() }
      })
    })
    const bootstrap = createInitialProjectBootstrapV5({ getState: () => ({ ...state, hydrate, newProject }) })

    const first = bootstrap.run(() => true)
    await vi.waitFor(() => expect(newProject).toHaveBeenCalledOnce())
    const late = bootstrap.run(() => true)
    expect(newProject).toHaveBeenCalledOnce()
    let lateSettled = false
    void late.then(() => { lateSettled = true })
    await Promise.resolve()
    expect(lateSettled).toBe(false)

    releaseNew()
    await expect(Promise.all([first, late])).resolves.toEqual([undefined, undefined])
  })

  it('shares hydration failure with joiners and permits a later retry', async () => {
    const hydrate = vi.fn()
      .mockRejectedValueOnce(new Error('hydrate failed'))
      .mockResolvedValueOnce(undefined)
    const newProject = vi.fn(async () => undefined)
    const bootstrap = createInitialProjectBootstrapV5({
      getState: () => ({ activeProject: null, status: 'idle' as const, hydrate, newProject }),
    })

    const first = bootstrap.run(() => true)
    const second = bootstrap.run(() => true)
    await expect(Promise.all([first, second])).rejects.toThrow('hydrate failed')
    expect(hydrate).toHaveBeenCalledOnce()

    await expect(bootstrap.run(() => true)).resolves.toBeUndefined()
    expect(hydrate).toHaveBeenCalledTimes(2)
    expect(newProject).toHaveBeenCalledOnce()
  })
})
