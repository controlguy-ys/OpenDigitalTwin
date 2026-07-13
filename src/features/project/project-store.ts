import { createStore } from 'zustand/vanilla'
import type {
  CurrentProjectSnapshot,
  WorkcellProjectSnapshotV1,
} from '../../domain/project/project'
import {
  validateWorkcellProjectSnapshot,
  WORKCELL_PROJECT_SCHEMA_VERSION_V1,
} from '../../domain/project/project'
import { migrateV1ToV2 } from '../../domain/project/project-v1-migration'
import { decodeWorkcellProject, encodeWorkcellProject } from './project-codec'
import type { ProjectDatabase } from './project-db'

export interface ProjectRuntime<Staged = unknown> {
  createNew?(): Promise<CurrentProjectSnapshot>
  capture(previous: CurrentProjectSnapshot | null): Promise<CurrentProjectSnapshot>
  stage(snapshot: CurrentProjectSnapshot): Promise<Staged>
  commit(snapshot: CurrentProjectSnapshot, staged: Staged): Promise<void>
  dispose(staged: Staged): void
}

export interface ProjectCodec {
  decode(bytes: Uint8Array | ArrayBuffer): Promise<CurrentProjectSnapshot>
  encode(snapshot: CurrentProjectSnapshot): Promise<Uint8Array>
}

export interface ProjectStoreState {
  activeProjectId: string | null
  activeProjectName: string | null
  activeSnapshot: CurrentProjectSnapshot | null
  status: 'idle' | 'loading' | 'saving' | 'importing' | 'ready' | 'error'
  error: string | null
  hydrate(): Promise<void>
  newProject(): Promise<void>
  saveActiveProject(): Promise<CurrentProjectSnapshot>
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

  const currentSnapshot = (candidate: unknown): CurrentProjectSnapshot => {
    const schemaVersion = (
      candidate as { manifest?: { schemaVersion?: unknown } }
    ).manifest?.schemaVersion
    return schemaVersion === WORKCELL_PROJECT_SCHEMA_VERSION_V1
      ? migrateV1ToV2(candidate as WorkcellProjectSnapshotV1)
      : validateWorkcellProjectSnapshot(candidate)
  }

  const collisionPersistenceSignature = (candidate: unknown): string => {
    const snapshot = candidate as {
      manifest?: { schemaVersion?: unknown }
      robot?: { links?: Array<Record<string, unknown>> }
      objectAssets?: Array<Record<string, unknown>>
      collisionPolicy?: unknown
    }
    return JSON.stringify({
      schemaVersion: snapshot.manifest?.schemaVersion,
      robotLinks: snapshot.robot?.links?.map((link) => ({
        collisionCenter: link.collisionCenter,
        collisionHalfExtents: link.collisionHalfExtents,
        collisionBoxes: link.collisionBoxes,
      })),
      objectAssets: snapshot.objectAssets?.map((asset) => ({
        colliderCenter: asset.colliderCenter,
        collisionHalfExtents: asset.collisionHalfExtents,
        collisionBoxes: asset.collisionBoxes,
      })),
      collisionPolicy: snapshot.collisionPolicy,
    })
  }

  return createStore<ProjectStoreState>()((set, get) => {
    const activate = (snapshot: CurrentProjectSnapshot) => ({
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
          else {
            const snapshot = currentSnapshot(stored.snapshot)
            if (
              collisionPersistenceSignature(stored.snapshot) !==
              collisionPersistenceSignature(snapshot)
            ) {
              await database.projects.put({ key: 'active', snapshot })
            }
            set(activate(snapshot))
          }
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
      newProject: async () => {
        await hydrate()
        const previous = get().activeSnapshot
        set({ status: 'importing', error: null })
        let staged: Staged | undefined
        try {
          const snapshot = validateWorkcellProjectSnapshot(
            runtime.createNew === undefined
              ? await runtime.capture(null)
              : await runtime.createNew(),
          )
          staged = await runtime.stage(snapshot)
          await runtime.commit(snapshot, staged)
          await database.projects.put({ key: 'active', snapshot })
          set(activate(snapshot))
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
            error: error instanceof Error ? error.message : 'New project failed.',
          })
          throw error
        }
      },
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
          const incoming = currentSnapshot(await codec.decode(bytes))
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
