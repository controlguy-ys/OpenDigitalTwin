import {
  validateWorkcellProjectV4,
  type WorkcellProjectV4,
} from '../../../core/project-v4/index.js'
import type {
  ProjectPublicationCoordinatorV4,
  PublishedProjectBundleV4,
} from './project-v4-publication.js'
import type {
  ProjectRepositoryV4,
  ProjectRevisionRecordV4,
} from './project-v4-repository.js'

export interface ProjectMutationRecipeV4 {
  readonly description: string
  mutate(active: WorkcellProjectV4): WorkcellProjectV4
}

export interface ProjectMutationServiceV4 {
  hydrate(): Promise<void>
  readPublished(): PublishedProjectBundleV4 | null
  subscribe(listener: () => void): () => void
  replace(candidate: WorkcellProjectV4): Promise<PublishedProjectBundleV4>
  replacePrepared(
    candidate: WorkcellProjectV4,
    expectedRevisionId: string | null,
  ): Promise<PublishedProjectBundleV4>
  replaceFromActive(
    recipe: ProjectMutationRecipeV4,
  ): Promise<PublishedProjectBundleV4>
  isRecoveryRequired(): boolean
}

export interface ProjectMutationServiceDependenciesV4 {
  readonly repository: ProjectRepositoryV4
  readonly publication: ProjectPublicationCoordinatorV4
  readonly nowIso: () => string
  readonly createRevisionId: () => string
}

export class ProjectMutationServiceV4Error extends Error {
  readonly code: string
  readonly cause?: unknown

  constructor(code: string, message: string, cause?: unknown) {
    super(`${code}: ${message}`)
    this.name = 'ProjectMutationServiceV4Error'
    this.code = code
    if (cause !== undefined) this.cause = cause
  }
}

function failMutation(code: string, message: string, cause?: unknown): never {
  throw new ProjectMutationServiceV4Error(code, message, cause)
}

function publicBundle(record: ProjectRevisionRecordV4): PublishedProjectBundleV4 {
  return Object.freeze({
    project: record.project,
    revisionId: record.revisionId,
    configRevision: record.configRevision,
  })
}

export function createProjectMutationServiceV4(
  dependencies: ProjectMutationServiceDependenciesV4,
): ProjectMutationServiceV4 {
  const listeners = new Set<() => void>()
  let tail = Promise.resolve()
  let hydration: Promise<void> | null = null
  let localRecoveryRequired = false

  const enqueue = <Result>(operation: () => Promise<Result>): Promise<Result> => {
    const pending = tail.then(operation, operation)
    tail = pending.then(() => undefined, () => undefined)
    return pending
  }

  const recoveryRequired = (): boolean => (
    localRecoveryRequired || dependencies.publication.isRecoveryRequired()
  )

  const requireEditable = (): void => {
    if (recoveryRequired()) {
      failMutation(
        'PROJECT_RECOVERY_REQUIRED',
        'Reload recovery is required before another Project V4 operation.',
      )
    }
  }

  const enterRecovery = (): void => {
    localRecoveryRequired = true
  }

  const notifySuccess = (): void => {
    const notificationListeners = Array.from(listeners)
    for (const listener of notificationListeners) {
      try {
        listener()
      } catch {
        // A listener cannot reverse an already authoritative publication.
      }
    }
  }

  const requireRevision = async (
    revisionId: string,
  ): Promise<ProjectRevisionRecordV4> => {
    const record = await dependencies.repository.readRevision(revisionId)
    if (record === null) {
      return failMutation(
        'PROJECT_REVISION_MISSING',
        `Project V4 revision ${revisionId} is missing.`,
      )
    }
    return record
  }

  const restoreStable = async (revisionId: string): Promise<void> => {
    const record = await requireRevision(revisionId)
    await dependencies.publication.restorePublished(publicBundle(record))
  }

  const garbageCollectBestEffort = async (): Promise<void> => {
    try {
      await dependencies.repository.garbageCollect()
    } catch {
      // Durable cleanup is retry-only after successful restoration.
    }
  }

  const hydrateQueued = async (): Promise<void> => {
    requireEditable()
    let pointer
    try {
      pointer = await dependencies.repository.readPointer()
    } catch (error) {
      enterRecovery()
      throw error
    }
    if (pointer === null) {
      notifySuccess()
      return
    }

    if (pointer.state === 'stable') {
      try {
        await restoreStable(pointer.revisionId)
      } catch (error) {
        enterRecovery()
        throw error
      }
      await garbageCollectBestEffort()
      notifySuccess()
      return
    }

    let target: ProjectRevisionRecordV4
    try {
      target = await requireRevision(pointer.revisionId)
    } catch (targetError) {
      try {
        await dependencies.repository.compensatePublication(pointer.commitToken)
      } catch (compensationError) {
        enterRecovery()
        throw compensationError
      }

      let compensatedPointer
      try {
        compensatedPointer = await dependencies.repository.readPointer()
      } catch (pointerError) {
        enterRecovery()
        throw pointerError
      }
      if (compensatedPointer === null) {
        enterRecovery()
        return failMutation(
          'PROJECT_RECOVERY_REQUIRED',
          'The first interrupted Project V4 publication was corrupt and was removed.',
          targetError,
        )
      }
      if (compensatedPointer.state !== 'stable') {
        enterRecovery()
        return failMutation(
          'PROJECT_RECOVERY_REQUIRED',
          'Project V4 compensation did not restore a stable pointer.',
          targetError,
        )
      }
      try {
        await restoreStable(compensatedPointer.revisionId)
      } catch (restoreError) {
        enterRecovery()
        throw restoreError
      }
      await garbageCollectBestEffort()
      notifySuccess()
      return
    }

    try {
      await dependencies.repository.finalizePublication(pointer.commitToken)
    } catch (error) {
      enterRecovery()
      throw error
    }
    try {
      await dependencies.publication.restorePublished(publicBundle(target))
    } catch (error) {
      enterRecovery()
      throw error
    }
    await garbageCollectBestEffort()
    notifySuccess()
  }

  const replacePreparedQueued = async (
    candidate: WorkcellProjectV4,
    expectedRevisionId: string | null,
  ): Promise<PublishedProjectBundleV4> => {
    requireEditable()
    const validated = validateWorkcellProjectV4(candidate)
    const published = await dependencies.publication.replace({
      candidate: validated,
      expectedRevisionId,
    })
    notifySuccess()
    return published
  }

  const service: ProjectMutationServiceV4 = {
    hydrate() {
      if (hydration !== null) return hydration
      hydration = enqueue(hydrateQueued).finally(() => {
        hydration = null
      })
      return hydration
    },

    readPublished() {
      return dependencies.publication.readPublished()
    },

    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },

    replace(candidate) {
      return enqueue(async () => {
        const expectedRevisionId = dependencies.publication.readPublished()?.revisionId ?? null
        return replacePreparedQueued(candidate, expectedRevisionId)
      })
    },

    replacePrepared(candidate, expectedRevisionId) {
      return enqueue(() => replacePreparedQueued(candidate, expectedRevisionId))
    },

    replaceFromActive(recipe) {
      return enqueue(async () => {
        requireEditable()
        const active = dependencies.publication.readPublished()
        if (active === null) {
          return failMutation(
            'PROJECT_ACTIVE_REVISION_MISSING',
            'No published Project V4 revision is active.',
          )
        }
        const recipeInput = validateWorkcellProjectV4(structuredClone(active.project))
        const mutated = recipe.mutate(recipeInput)
        if (dependencies.publication.readPublished()?.revisionId !== active.revisionId) {
          return failMutation(
            'PROJECT_ACTIVE_REVISION_CHANGED',
            'The active Project V4 revision changed while applying the mutation recipe.',
          )
        }
        const revisionId = dependencies.createRevisionId()
        if (revisionId === active.revisionId) {
          return failMutation(
            'PROJECT_REVISION_ID_NOT_FRESH',
            'A mutation recipe must receive a fresh Project V4 revision identity.',
          )
        }
        const candidate = validateWorkcellProjectV4({
          ...mutated,
          projectId: active.project.projectId,
          revisionId,
          metadata: {
            ...mutated.metadata,
            createdAt: active.project.metadata.createdAt,
            updatedAt: dependencies.nowIso(),
          },
        })
        const published = await dependencies.publication.replace({
          candidate,
          expectedRevisionId: active.revisionId,
        })
        notifySuccess()
        return published
      })
    },

    isRecoveryRequired() {
      return recoveryRequired()
    },
  }

  return Object.freeze(service)
}
