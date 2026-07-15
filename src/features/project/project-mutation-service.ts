import type {
  PreparedProjectSourceGroupV1,
  ProjectSourceStagingService,
} from '../../domain/project/project-v3'
import type { StoredWorkcellProjectSnapshotProjectionV3 } from './project-db'
import { materializeHydratedProjectSnapshotV1 } from './project-revision-hydration'
import type {
  ProjectRevisionRepository,
} from './project-revision-repository'
import type { ProjectDecodeResultV3 } from './project-v3-archive'
import type {
  ProjectPublicationCoordinator,
  PublishedProjectBundleV1,
} from './project-publication-coordinator'

export type ActiveProjectMutationRecipeV1 = (
  current: StoredWorkcellProjectSnapshotProjectionV3,
) => StoredWorkcellProjectSnapshotProjectionV3

export interface ProjectMutationService {
  replaceFromActive(
    recipe: ActiveProjectMutationRecipeV1,
    preparedSources?: readonly PreparedProjectSourceGroupV1[],
  ): Promise<void>
  replacePreparedUntrusted(result: ProjectDecodeResultV3): Promise<void>
  hydrate(): Promise<void>
  readPublished(): PublishedProjectBundleV1 | null
  isRecoveryRequired(): boolean
  subscribe(listener: () => void): () => void
}

export interface ProjectMutationServiceOptions {
  readonly repository: ProjectRevisionRepository
  readonly sourceStaging: ProjectSourceStagingService
  readonly coordinator: ProjectPublicationCoordinator
}

function cloneProjection(
  projection: StoredWorkcellProjectSnapshotProjectionV3,
): StoredWorkcellProjectSnapshotProjectionV3 {
  return structuredClone(projection)
}

function deepFreeze(value: unknown): void {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return
  for (const nested of Object.values(value)) deepFreeze(nested)
  Object.freeze(value)
}

function cloneFrozenProjection(
  projection: StoredWorkcellProjectSnapshotProjectionV3,
): StoredWorkcellProjectSnapshotProjectionV3 {
  const clone = cloneProjection(projection)
  deepFreeze(clone)
  return clone
}

export function createProjectMutationService(
  options: ProjectMutationServiceOptions,
): ProjectMutationService {
  const repository = options.repository
  const coordinator = options.coordinator
  const listeners = new Set<() => void>()
  let activeProjection: StoredWorkcellProjectSnapshotProjectionV3 | null = null
  let generation = 0
  let tail = Promise.resolve()
  let hydration: Promise<void> | null = null
  let localRecoveryRequired = false

  const enqueue = <Result>(operation: () => Promise<Result>): Promise<Result> => {
    const pending = tail.then(operation, operation)
    tail = pending.then(() => undefined, () => undefined)
    return pending
  }

  const notify = (): void => {
    for (const listener of listeners) listener()
  }

  const requireEditable = (): void => {
    if (localRecoveryRequired || coordinator.isRecoveryRequired()) {
      throw Object.assign(
        new Error('PROJECT_RECOVERY_REQUIRED: Reload is required before durable Project edits.'),
        { code: 'PROJECT_RECOVERY_REQUIRED' },
      )
    }
  }

  const revokePreparedSources = (
    preparedSources: readonly PreparedProjectSourceGroupV1[],
  ): void => {
    for (const { preparedSource } of preparedSources) {
      try {
        options.sourceStaging.revoke(preparedSource)
      } catch {
        // The repository may already have consumed or revoked the token.
      }
    }
  }

  const service: ProjectMutationService = {
    replaceFromActive(recipe, preparedSources = []) {
      return enqueue(async () => {
        requireEditable()
        if (activeProjection === null) {
          throw Object.assign(
            new Error('PROJECT_ACTIVE_REVISION_MISSING: No published Project is active.'),
            { code: 'PROJECT_ACTIVE_REVISION_MISSING' },
          )
        }
        const previous = coordinator.readPublished()
        if (previous === null) {
          throw Object.assign(
            new Error('PROJECT_ACTIVE_REVISION_MISSING: No published Project bundle is active.'),
            { code: 'PROJECT_ACTIVE_REVISION_MISSING' },
          )
        }
        try {
          const nextProjection = recipe(cloneFrozenProjection(activeProjection))
          const candidate = repository.createCandidate({
            projection: nextProjection,
            preparedSourceGroups: preparedSources,
          })
          generation += 1
          await coordinator.replace({
            candidate,
            expectedRevisionId: previous.revisionId,
            generation,
          })
          activeProjection = cloneProjection(nextProjection)
          notify()
        } catch (error) {
          revokePreparedSources(preparedSources)
          throw error
        }
      })
    },

    replacePreparedUntrusted(result) {
      return enqueue(async () => {
        requireEditable()
        const previous = coordinator.readPublished()
        const nextProjection = result.projection
        try {
          const candidate = repository.createCandidate({
            projection: nextProjection,
            preparedSourceGroups: result.preparedSourceGroups,
          })
          generation += 1
          await coordinator.replace({
            candidate,
            expectedRevisionId: previous?.revisionId ?? null,
            generation,
          })
          activeProjection = cloneProjection(nextProjection)
          notify()
        } catch (error) {
          revokePreparedSources(result.preparedSourceGroups)
          throw error
        }
      })
    },

    hydrate() {
      if (hydration !== null) return hydration
      hydration = enqueue(async () => {
        let pointer = await repository.readPointer()
        if (pointer === null) return
        if (pointer.state === 'publishing') {
          let runtimePublished = false
          try {
            const hydrated = await repository.readRevision(pointer.revisionId)
            if (hydrated === null) throw new Error('Publishing Project revision is missing.')
            const publicSnapshot = materializeHydratedProjectSnapshotV1(hydrated)
            await repository.finalizePublication(pointer.commitToken)
            const active = await repository.adoptHydratedRevision(hydrated)
            activeProjection = cloneProjection(active.projection)
            generation += 1
            await coordinator.restorePublished({
              revisionId: pointer.revisionId,
              snapshot: publicSnapshot,
              generation,
            })
            runtimePublished = true
            try { await repository.garbageCollect() } catch { /* retry-only */ }
            notify()
            return
          } catch (error) {
            if (runtimePublished || coordinator.isRecoveryRequired()) {
              localRecoveryRequired = true
              throw error
            }
            try {
              await repository.compensatePublication(pointer.commitToken)
              pointer = await repository.readPointer()
            } catch (compensationError) {
              localRecoveryRequired = true
              throw compensationError
            }
            if (pointer === null) {
              localRecoveryRequired = true
              throw error
            }
          }
        }
        const hydrated = await repository.readRevision(pointer.revisionId)
        if (hydrated === null) {
          localRecoveryRequired = true
          throw Object.assign(
            new Error('PROJECT_RECOVERY_REQUIRED: Active Project revision is missing.'),
            { code: 'PROJECT_RECOVERY_REQUIRED' },
          )
        }
        const publicSnapshot = materializeHydratedProjectSnapshotV1(hydrated)
        const active = await repository.adoptHydratedRevision(hydrated)
        generation += 1
        await coordinator.restorePublished({
          revisionId: active.revisionId,
          snapshot: publicSnapshot,
          generation,
        })
        activeProjection = cloneProjection(active.projection)
        notify()
      }).finally(() => {
        hydration = null
      })
      return hydration
    },

    readPublished() {
      return coordinator.readPublished()
    },

    isRecoveryRequired() {
      return localRecoveryRequired || coordinator.isRecoveryRequired()
    },

    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }

  return Object.freeze(service)
}
