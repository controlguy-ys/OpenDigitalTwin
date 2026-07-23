import type { ProjectStoreStateV5 } from '../../features/project/v5/project-store-v5.js'

type InitialProjectStoreStateV5 = Pick<ProjectStoreStateV5, 'activeProject' | 'status' | 'hydrate' | 'newProject'>

export interface InitialProjectStoreV5 {
  getState(): InitialProjectStoreStateV5
}

export interface InitialProjectBootstrapV5 {
  run(isActive: () => boolean): Promise<void>
}

export function createInitialProjectBootstrapV5(store: InitialProjectStoreV5): InitialProjectBootstrapV5 {
  let runPromise: Promise<void> | null = null
  let joinedActivityChecks: Array<() => boolean> | null = null
  return {
    run(isActive) {
      if (runPromise !== null) {
        joinedActivityChecks!.push(isActive)
        return runPromise
      }
      const activityChecks = [isActive]
      joinedActivityChecks = activityChecks
      runPromise = (async () => {
        await store.getState().hydrate()
        if (!activityChecks.some((check) => check())) return
        const state = store.getState()
        if (state.activeProject !== null || (state.status !== 'idle' && state.status !== 'ready')) return
        await state.newProject()
      })().finally(() => {
        runPromise = null
        joinedActivityChecks = null
      })
      return runPromise
    },
  }
}
