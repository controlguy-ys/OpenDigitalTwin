import type { ProjectStoreStateV4 } from '../features/project/v4/project-store-v4.js'

type InitialProjectStoreStateV4 = Pick<
  ProjectStoreStateV4,
  'activeProject' | 'status' | 'hydrate' | 'newProject'
>

export interface InitialProjectStoreV4 {
  getState(): InitialProjectStoreStateV4
}

export interface InitialProjectBootstrapV4 {
  run(isActive: () => boolean): Promise<void>
}

export function createInitialProjectBootstrapV4(
  store: InitialProjectStoreV4,
): InitialProjectBootstrapV4 {
  let newProjectPromise: Promise<void> | null = null

  return {
    async run(isActive) {
      await store.getState().hydrate()
      if (!isActive()) return

      const state = store.getState()
      if (
        state.activeProject !== null
        || (state.status !== 'idle' && state.status !== 'ready')
      ) return

      newProjectPromise ??= state.newProject()
      await newProjectPromise
    },
  }
}
