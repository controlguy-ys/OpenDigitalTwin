import { createStore } from 'zustand/vanilla'
import type { WorkcellProjectSnapshotV1 } from '../../domain/project/project'
import { validateWorkcellProjectSnapshot } from '../../domain/project/project'
import { decodeWorkcellProject, encodeWorkcellProject } from './project-codec'
import type { ProjectDatabase } from './project-db'

export interface ProjectRuntime<Staged = unknown> {
  capture(previous: WorkcellProjectSnapshotV1 | null): Promise<WorkcellProjectSnapshotV1>
  stage(snapshot: WorkcellProjectSnapshotV1): Promise<Staged>
  commit(snapshot: WorkcellProjectSnapshotV1, staged: Staged): Promise<void>
  dispose(staged: Staged): void
}

export interface ProjectCodec {
  decode(bytes: Uint8Array | ArrayBuffer): Promise<WorkcellProjectSnapshotV1>
  encode(snapshot: WorkcellProjectSnapshotV1): Promise<Uint8Array>
}

export interface ProjectStoreState {
  activeProjectId: string | null
  activeProjectName: string | null
  activeSnapshot: WorkcellProjectSnapshotV1 | null
  status: 'idle' | 'loading' | 'saving' | 'importing' | 'ready' | 'error'
  error: string | null
  hydrate(): Promise<void>
  saveActiveProject(): Promise<WorkcellProjectSnapshotV1>
  exportActiveProject(): Promise<Uint8Array>
  importProject(bytes: Uint8Array | ArrayBuffer): Promise<void>
}

const defaultCodec: ProjectCodec = {
  decode: decodeWorkcellProject,
  encode: encodeWorkcellProject,
}

export function createProjectStore<Staged>(
  database: ProjectDatabase,
  runtime: ProjectRuntime<Staged>,
  codec: ProjectCodec = defaultCodec,
) {
  let hydrated = false
  let hydrationPromise: Promise<void> | null = null
  return createStore<ProjectStoreState>()((set, get) => {
    const activate = (snapshot: WorkcellProjectSnapshotV1) => ({
      activeSnapshot: snapshot,
      activeProjectId: snapshot.manifest.projectId,
      activeProjectName: snapshot.manifest.name,
      status: 'ready' as const,
      error: null,
    })

    const hydrate = (): Promise<void> => {
      if (hydrated) return Promise.resolve()
      if (hydrationPromise !== null) return hydrationPromise
      set({ status: 'loading', error: null })
      hydrationPromise = (async () => {
        try {
          await database.open()
          const stored = await database.projects.get('active')
          if (stored === undefined) set({ status: 'idle' })
          else set(activate(stored.snapshot))
        } catch (error) {
          set({
            status: 'error',
            error: error instanceof Error ? error.message : 'Project storage failed.',
          })
        } finally {
          hydrated = true
          hydrationPromise = null
        }
      })()
      return hydrationPromise
    }

    const saveActiveProject = async () => {
      await hydrate()
      set({ status: 'saving', error: null })
      try {
        const snapshot = validateWorkcellProjectSnapshot(
          await runtime.capture(get().activeSnapshot),
        )
        await database.projects.put({ key: 'active', snapshot })
        set(activate(snapshot))
        return snapshot
      } catch (error) {
        set({
          status: 'error',
          error: error instanceof Error ? error.message : 'Project save failed.',
        })
        throw error
      }
    }

    return {
      activeProjectId: null,
      activeProjectName: null,
      activeSnapshot: null,
      status: 'idle',
      error: null,
      hydrate,
      saveActiveProject,
      exportActiveProject: async () => {
        const snapshot = await saveActiveProject()
        return codec.encode(snapshot)
      },
      importProject: async (bytes) => {
        await hydrate()
        const previous = get().activeSnapshot
        set({ status: 'importing', error: null })
        let staged: Staged | undefined
        try {
          const incoming = await codec.decode(bytes)
          staged = await runtime.stage(incoming)
          await runtime.commit(incoming, staged)
          await database.projects.put({ key: 'active', snapshot: incoming })
          set(activate(incoming))
        } catch (error) {
          if (staged !== undefined) runtime.dispose(staged)
          if (previous !== null && staged !== undefined) {
            try {
              const rollback = await runtime.stage(previous)
              await runtime.commit(previous, rollback)
            } catch {
              // The previous central snapshot remains authoritative for next hydration.
            }
          }
          set({
            status: previous === null ? 'error' : 'ready',
            error: error instanceof Error ? error.message : 'Project import failed.',
          })
          throw error
        }
      },
    }
  })
}
