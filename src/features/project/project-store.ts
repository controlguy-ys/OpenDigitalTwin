import { createStore } from 'zustand/vanilla'
import type { WorkcellProjectSnapshotV3 } from '../../domain/project/project-v3'
import type { ProjectDecodeResultV3 } from './project-codec'
import { revokeProjectDecodeResult } from './project-codec'
import type { ProjectMutationService } from './project-mutation-service'

export interface ProjectStoreOptions {
  readonly mutationService: ProjectMutationService
  readonly createNew: () => Promise<WorkcellProjectSnapshotV3>
  readonly stageNew: (
    snapshot: WorkcellProjectSnapshotV3,
  ) => Promise<ProjectDecodeResultV3>
  readonly decode: (
    source: Blob | Uint8Array | ArrayBuffer,
  ) => Promise<ProjectDecodeResultV3>
  readonly encode: (snapshot: WorkcellProjectSnapshotV3) => Promise<Blob>
}

export interface ProjectStoreState {
  activeProjectId: string | null
  activeProjectName: string | null
  activeSnapshot: WorkcellProjectSnapshotV3 | null
  status:
    | 'idle'
    | 'loading'
    | 'saving'
    | 'importing'
    | 'ready'
    | 'error'
    | 'recovery-required'
  error: string | null
  hydrate(): Promise<void>
  newProject(): Promise<void>
  saveActiveProject(): Promise<WorkcellProjectSnapshotV3>
  exportActiveProject(): Promise<Blob>
  importProject(source: Blob | Uint8Array | ArrayBuffer): Promise<void>
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback
}

export function createProjectStore(options: ProjectStoreOptions) {
  const mutationService = options.mutationService
  let hydrated = false
  let hydrationPromise: Promise<void> | null = null

  const store = createStore<ProjectStoreState>()((set) => {
    const publishedState = (): Pick<
      ProjectStoreState,
      'activeProjectId' | 'activeProjectName' | 'activeSnapshot' | 'status' | 'error'
    > => {
      const published = mutationService.readPublished()
      if (published === null) {
        return {
          activeProjectId: null,
          activeProjectName: null,
          activeSnapshot: null,
          status: mutationService.isRecoveryRequired() ? 'recovery-required' : 'idle',
          error: null,
        }
      }
      return {
        activeProjectId: published.snapshot.manifest.projectId,
        activeProjectName: published.snapshot.manifest.name,
        activeSnapshot: published.snapshot,
        status: mutationService.isRecoveryRequired() ? 'recovery-required' : 'ready',
        error: null,
      }
    }

    const failState = (error: unknown, fallback: string) => ({
      status: mutationService.isRecoveryRequired()
        ? 'recovery-required' as const
        : mutationService.readPublished() === null
          ? 'error' as const
          : 'ready' as const,
      error: errorMessage(error, fallback),
    })

    const hydrate = (): Promise<void> => {
      if (hydrated) {
        set(publishedState())
        return Promise.resolve()
      }
      if (hydrationPromise !== null) return hydrationPromise
      set({ status: 'loading', error: null })
      hydrationPromise = mutationService.hydrate()
        .then(() => set(publishedState()))
        .catch((error) => {
          set(failState(error, 'Project storage failed.'))
        })
        .finally(() => {
          hydrated = true
          hydrationPromise = null
        })
      return hydrationPromise
    }

    const saveActiveProject = async (): Promise<WorkcellProjectSnapshotV3> => {
      await hydrate()
      const published = mutationService.readPublished()
      if (published === null) {
        throw new Error('PROJECT_ACTIVE_REVISION_MISSING: No V3 Project is active.')
      }
      set({ ...publishedState(), status: 'ready' })
      return published.snapshot
    }

    return {
      activeProjectId: null,
      activeProjectName: null,
      activeSnapshot: null,
      status: 'idle',
      error: null,
      hydrate,
      newProject: async () => {
        await hydrate()
        set({ status: 'importing', error: null })
        try {
          const snapshot = await options.createNew()
          const prepared = await options.stageNew(snapshot)
          await mutationService.replacePreparedUntrusted(prepared)
          set(publishedState())
        } catch (error) {
          set(failState(error, 'New Project failed.'))
          throw error
        }
      },
      saveActiveProject,
      exportActiveProject: async () => {
        const snapshot = await saveActiveProject()
        return options.encode(snapshot)
      },
      importProject: async (source) => {
        await hydrate()
        set({ status: 'importing', error: null })
        let decoded: ProjectDecodeResultV3 | undefined
        try {
          decoded = await options.decode(source)
          await mutationService.replacePreparedUntrusted(decoded)
          set(publishedState())
        } catch (error) {
          if (decoded !== undefined) {
            try {
              revokeProjectDecodeResult(decoded)
            } catch {
              // Repository publication may already have consumed or revoked it.
            }
          }
          set(failState(error, 'Project import failed.'))
          throw error
        }
      },
    }
  })

  mutationService.subscribe(() => {
    const published = mutationService.readPublished()
    store.setState(published === null
      ? {
          activeProjectId: null,
          activeProjectName: null,
          activeSnapshot: null,
          status: mutationService.isRecoveryRequired() ? 'recovery-required' : 'idle',
          error: null,
        }
      : {
          activeProjectId: published.snapshot.manifest.projectId,
          activeProjectName: published.snapshot.manifest.name,
          activeSnapshot: published.snapshot,
          status: mutationService.isRecoveryRequired() ? 'recovery-required' : 'ready',
          error: null,
        })
  })

  return store
}
