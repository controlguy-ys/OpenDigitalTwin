import { createStore, type StoreApi } from 'zustand/vanilla'

import type { WorkcellProjectV4 } from '../../../core/project-v4/index.js'
import type { ProjectMutationServiceV4 } from './project-v4-mutation-service.js'

export type ProjectStoreStatusV4 =
  | 'idle'
  | 'loading'
  | 'saving'
  | 'importing'
  | 'ready'
  | 'error'
  | 'recovery-required'

export interface ProjectStoreStateV4 {
  readonly activeProject: WorkcellProjectV4 | null
  readonly status: ProjectStoreStatusV4
  readonly error: string | null
  hydrate(): Promise<void>
  newProject(): Promise<void>
  saveActiveProject(): Promise<WorkcellProjectV4>
  exportActiveProject(): Promise<Blob>
  importProject(source: Blob | Uint8Array | ArrayBuffer): Promise<void>
}

export type ProjectStoreV4 = StoreApi<ProjectStoreStateV4>

export interface ProjectStoreDependenciesV4 {
  readonly mutations: ProjectMutationServiceV4
  readonly createDefaultProject: () => WorkcellProjectV4
  readonly encodeProject: (project: WorkcellProjectV4) => Blob
  readonly decodeProject: (
    source: Blob | Uint8Array | ArrayBuffer,
  ) => Promise<WorkcellProjectV4>
}

export class ProjectStoreV4Error extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(`${code}: ${message}`)
    this.name = 'ProjectStoreV4Error'
    this.code = code
  }
}

function missingActiveProject(): ProjectStoreV4Error {
  return new ProjectStoreV4Error(
    'PROJECT_ACTIVE_REVISION_MISSING',
    'No durable Project V4 publication is active.',
  )
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function errorCode(error: unknown): unknown {
  return typeof error === 'object' && error !== null && 'code' in error
    ? error.code
    : undefined
}

export function createProjectStoreV4(
  dependencies: ProjectStoreDependenciesV4,
): ProjectStoreV4 {
  const publishedProject = (): WorkcellProjectV4 | null => (
    dependencies.mutations.readPublished()?.project ?? null
  )
  let store!: ProjectStoreV4

  const applyFailure = (error: unknown): void => {
    const recoveryRequired = dependencies.mutations.isRecoveryRequired()
      || errorCode(error) === 'PROJECT_RECOVERY_REQUIRED'
    store.setState({
      activeProject: publishedProject() ?? store.getState().activeProject,
      status: recoveryRequired ? 'recovery-required' : 'error',
      error: errorMessage(error),
    })
  }

  const finishReady = (): void => {
    store.setState({
      activeProject: publishedProject(),
      status: dependencies.mutations.isRecoveryRequired()
        ? 'recovery-required'
        : 'ready',
      error: null,
    })
  }

  store = createStore<ProjectStoreStateV4>()(() => ({
    activeProject: publishedProject(),
    status: 'idle',
    error: null,

    async hydrate() {
      store.setState({ status: 'loading', error: null })
      try {
        await dependencies.mutations.hydrate()
        finishReady()
      } catch (error) {
        applyFailure(error)
        throw error
      }
    },

    async newProject() {
      store.setState({ status: 'saving', error: null })
      try {
        const candidate = dependencies.createDefaultProject()
        await dependencies.mutations.replace(candidate)
        finishReady()
      } catch (error) {
        applyFailure(error)
        throw error
      }
    },

    async saveActiveProject() {
      store.setState({ status: 'saving', error: null })
      try {
        const project = publishedProject()
        if (project === null) throw missingActiveProject()
        finishReady()
        return project
      } catch (error) {
        applyFailure(error)
        throw error
      }
    },

    async exportActiveProject() {
      store.setState({ status: 'saving', error: null })
      try {
        const project = publishedProject()
        if (project === null) throw missingActiveProject()
        const encoded = dependencies.encodeProject(project)
        finishReady()
        return encoded
      } catch (error) {
        applyFailure(error)
        throw error
      }
    },

    async importProject(source) {
      store.setState({ status: 'importing', error: null })
      try {
        const candidate = await dependencies.decodeProject(source)
        await dependencies.mutations.replace(candidate)
        finishReady()
      } catch (error) {
        applyFailure(error)
        throw error
      }
    },
  }))

  dependencies.mutations.subscribe(() => {
    const project = publishedProject()
    store.setState({
      activeProject: project,
      status: dependencies.mutations.isRecoveryRequired()
        ? 'recovery-required'
        : 'ready',
      error: null,
    })
  })

  return store
}
