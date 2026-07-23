import type { ProjectStoreStateV5 } from '../../features/project/v5/project-store-v5.js'

type InitialProjectStoreStateV5 = Pick<ProjectStoreStateV5, 'activeProject' | 'status' | 'hydrate' | 'newProject'>

export interface InitialProjectStoreV5 {
  getState(): InitialProjectStoreStateV5
}

export interface InitialProjectBootstrapV5 {
  run(isActive: () => boolean): Promise<void>
}

export function createInitialProjectBootstrapV5(store: InitialProjectStoreV5): InitialProjectBootstrapV5 {
  interface BootstrapRun {
    readonly hydration: Promise<void>
    participants: number
    newProject: Promise<void> | null
  }
  let activeRun: BootstrapRun | null = null
  return {
    async run(isActive) {
      let run = activeRun
      if (run === null) {
        run = { hydration: store.getState().hydrate(), participants: 0, newProject: null }
        activeRun = run
      }
      run.participants += 1
      try {
        await run.hydration
        if (!isActive()) return
        const state = store.getState()
        if (state.activeProject !== null || (state.status !== 'idle' && state.status !== 'ready')) return
        run.newProject ??= state.newProject()
        await run.newProject
      } finally {
        run.participants -= 1
        if (run.participants === 0 && activeRun === run) activeRun = null
      }
    },
  }
}
