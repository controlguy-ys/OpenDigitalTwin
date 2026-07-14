import { useStore } from 'zustand'
import { browserProjectRuntime } from './browser-project-runtime'
import {
  decodeLegacyRuntimeProjectV2,
  encodeLegacyRuntimeProjectV2,
} from './project-codec'
import { projectDb } from './project-db'
import { createProjectStore, type ProjectStoreState } from './project-store'

// Temporary V2 runtime lane. Task 4 replaces this adapter with prepared V3
// source consumption; transport is already streaming Blob/File end to end.
export const projectStore = createProjectStore(projectDb, browserProjectRuntime, {
  decode: decodeLegacyRuntimeProjectV2,
  encode: encodeLegacyRuntimeProjectV2,
})

export function useProjectStore<T>(selector: (state: ProjectStoreState) => T): T {
  return useStore(projectStore, selector)
}
