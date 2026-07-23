import { createStore, type StoreApi } from 'zustand/vanilla'

import type { WorkcellProjectV5 } from '../../../core/project-v5/index.js'
import { decodeProjectV5, encodeProjectV5 } from './project-v5-codec.js'
import type { ProjectV5MutationService } from './project-v5-mutation-service.js'

export type ProjectStoreStatusV5 =
  | 'idle'
  | 'loading'
  | 'saving'
  | 'importing'
  | 'ready'
  | 'error'
  | 'recovery-required'

export interface ProjectStoreStateV5 {
  readonly activeProject: WorkcellProjectV5 | null
  readonly status: ProjectStoreStatusV5
  readonly error: string | null
  hydrate(): Promise<void>
  newProject(): Promise<void>
  saveActiveProject(): Promise<WorkcellProjectV5>
  exportActiveProject(): Promise<Blob>
  importProject(source: Blob | Uint8Array | ArrayBuffer): Promise<void>
}

export type ProjectStoreV5 = StoreApi<ProjectStoreStateV5>

export interface ProjectStoreDependenciesV5 {
  readonly mutations: ProjectV5MutationService
  readonly createDefaultProject: () => WorkcellProjectV5
  readonly encodeProject?: (project: WorkcellProjectV5) => Blob
  readonly decodeProject?: (source: Blob | Uint8Array | ArrayBuffer) => Promise<WorkcellProjectV5>
}

export class ProjectStoreV5Error extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(`${code}: ${message}`)
    this.name = 'ProjectStoreV5Error'
    this.code = code
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function errorCode(error: unknown): unknown {
  return typeof error === 'object' && error !== null && 'code' in error
    ? error.code
    : undefined
}

function missingActiveProject(): ProjectStoreV5Error {
  return new ProjectStoreV5Error('PROJECT_ACTIVE_REVISION_MISSING', 'No durable Project V5 publication is active.')
}

export function createProjectStoreV5(dependencies: ProjectStoreDependenciesV5): ProjectStoreV5 {
  const encode = dependencies.encodeProject ?? encodeProjectV5
  const decode = dependencies.decodeProject ?? decodeProjectV5
  const publishedProject = (): WorkcellProjectV5 | null => dependencies.mutations.readPublished()?.project ?? null
  let store!: ProjectStoreV5

  const finishReady = (): void => {
    const recovery = dependencies.mutations.readRecoveryError()
    const recoveryRequired = dependencies.mutations.isRecoveryRequired()
    const authoritative = publishedProject()
    store.setState({
      activeProject: recoveryRequired ? authoritative ?? store.getState().activeProject : authoritative,
      status: recoveryRequired ? 'recovery-required' : 'ready',
      error: recovery === null ? null : errorMessage(recovery),
    })
  }
  const applyFailure = (error: unknown): void => {
    const recoveryRequired = dependencies.mutations.isRecoveryRequired() || errorCode(error) === 'PROJECT_RECOVERY_REQUIRED'
    store.setState({
      activeProject: publishedProject() ?? store.getState().activeProject,
      status: recoveryRequired ? 'recovery-required' : 'error',
      error: errorMessage(error),
    })
  }

  store = createStore<ProjectStoreStateV5>()(() => ({
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
        await dependencies.mutations.replace({ candidate: dependencies.createDefaultProject(), description: 'New Project' })
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
        const encoded = encode(project)
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
        const candidate = await decode(source)
        await dependencies.mutations.replace({ candidate, description: 'Import Project' })
        finishReady()
      } catch (error) {
        applyFailure(error)
        throw error
      }
    },
  }))

  dependencies.mutations.subscribe(() => finishReady())
  return store
}
