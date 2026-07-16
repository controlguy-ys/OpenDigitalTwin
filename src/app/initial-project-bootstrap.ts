import type { ProjectStoreState } from '../features/project/project-store'

type InitialProjectStoreState = Pick<
  ProjectStoreState,
  'activeSnapshot' | 'status' | 'hydrate' | 'newProject'
>

export interface InitialProjectStore {
  getState(): InitialProjectStoreState
}

export interface InitialProjectBootstrap {
  run(isActive: () => boolean): Promise<void>
}

export function createInitialProjectBootstrap(
  store: InitialProjectStore,
): InitialProjectBootstrap {
  let newProjectPromise: Promise<void> | null = null

  return {
    async run(isActive) {
      await store.getState().hydrate()
      if (!isActive()) return

      const state = store.getState()
      if (state.activeSnapshot !== null || state.status !== 'idle') return

      newProjectPromise ??= state.newProject()
      await newProjectPromise
    },
  }
}
