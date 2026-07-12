import { useStore } from 'zustand'
import { browserProjectRuntime } from './browser-project-runtime'
import { projectDb } from './project-db'
import { createProjectStore, type ProjectStoreState } from './project-store'

export const projectStore = createProjectStore(projectDb, browserProjectRuntime)

export function useProjectStore<T>(selector: (state: ProjectStoreState) => T): T {
  return useStore(projectStore, selector)
}
