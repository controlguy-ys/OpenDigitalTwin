import type { WorkcellProjectSnapshotV3 } from '../../domain/project/project-v3'
import type {
  ProjectRevisionCandidateV1,
  ProjectRevisionRepository,
} from './project-revision-repository'

export interface PublishedProjectBundleV1 {
  readonly revisionId: string
  readonly snapshot: WorkcellProjectSnapshotV3
  readonly generation: number
}

export interface PreparedProjectRuntimeBundleV1<RuntimeResources>
  extends PublishedProjectBundleV1 {
  readonly resources: RuntimeResources
}

export interface ProjectRuntimeV3<RuntimeResources> {
  prepare(
    snapshot: WorkcellProjectSnapshotV3,
    revisionId: string,
  ): Promise<RuntimeResources>
  publish(bundle: PreparedProjectRuntimeBundleV1<RuntimeResources>): void
  dispose(bundle: PreparedProjectRuntimeBundleV1<RuntimeResources>): void
}

export class ProjectPublicationError extends Error {
  readonly code: string

  constructor(code: string, message: string, cause?: unknown) {
    super(`${code}: ${message}`, cause === undefined ? undefined : { cause })
    this.name = 'ProjectPublicationError'
    this.code = code
  }
}

export interface ProjectPublicationRequestV1 {
  readonly candidate: ProjectRevisionCandidateV1
  readonly expectedRevisionId: string | null
  readonly generation: number
}

export interface ProjectPublishedRestoreV1 extends PublishedProjectBundleV1 {}

export interface ProjectPublicationCoordinator {
  replace(request: ProjectPublicationRequestV1): Promise<PublishedProjectBundleV1>
  restorePublished(request: ProjectPublishedRestoreV1): Promise<PublishedProjectBundleV1>
  readPublished(): PublishedProjectBundleV1 | null
  isRecoveryRequired(): boolean
}

export interface ProjectPublicationCoordinatorOptions<RuntimeResources> {
  readonly repository: ProjectRevisionRepository
  readonly runtime: ProjectRuntimeV3<RuntimeResources>
  readonly createCommitToken?: (() => string) | undefined
  readonly onRecoveryRequired?: ((error: unknown) => void) | undefined
}

function defaultCommitToken(): string {
  return crypto.randomUUID()
}

export function createProjectPublicationCoordinator<RuntimeResources>(
  options: ProjectPublicationCoordinatorOptions<RuntimeResources>,
): ProjectPublicationCoordinator {
  const repository = options.repository
  const runtime = options.runtime
  const createCommitToken = options.createCommitToken ?? defaultCommitToken
  let published: PreparedProjectRuntimeBundleV1<RuntimeResources> | null = null
  let recoveryRequired = false
  let tail = Promise.resolve()

  const enqueue = <Result>(operation: () => Promise<Result>): Promise<Result> => {
    const pending = tail.then(operation, operation)
    tail = pending.then(() => undefined, () => undefined)
    return pending
  }

  const requireEditable = (): void => {
    if (recoveryRequired) {
      throw new ProjectPublicationError(
        'PROJECT_RECOVERY_REQUIRED',
        'Project publication requires reload recovery before another durable edit.',
      )
    }
  }

  const enterRecovery = (error: unknown): void => {
    recoveryRequired = true
    options.onRecoveryRequired?.(error)
  }

  const publicBundle = (
    bundle: PreparedProjectRuntimeBundleV1<RuntimeResources>,
  ): PublishedProjectBundleV1 => Object.freeze({
    revisionId: bundle.revisionId,
    snapshot: bundle.snapshot,
    generation: bundle.generation,
  })

  return Object.freeze({
    replace(request: ProjectPublicationRequestV1) {
      return enqueue(async () => {
        requireEditable()
        const revision = await repository.prepareRevision(request.candidate)
        const revisionId = revision.storedRevision.revisionId
        let next: PreparedProjectRuntimeBundleV1<RuntimeResources> | undefined
        let pointerPublished = false
        let runtimePublicationStarted = false
        const token = createCommitToken()
        try {
          const snapshot = repository.materializePreparedRuntime(revision)
          const resources = await runtime.prepare(snapshot, revisionId)
          next = Object.freeze({
            revisionId,
            snapshot,
            generation: request.generation,
            resources,
          })
          await repository.commitPreparedRevision(
            request.expectedRevisionId,
            revision,
            token,
          )
          pointerPublished = true
          runtimePublicationStarted = true
          runtime.publish(next)
          await repository.finalizePublication(token)
          await repository.activatePreparedSources(revision, token)
          const previous = published
          published = next
          if (previous !== null) {
            try {
              runtime.dispose(previous)
            } catch {
              // The new stable revision remains authoritative; cleanup is retry-only.
            }
          }
          try {
            await repository.garbageCollect()
          } catch {
            // Durable cleanup is retry-only after a successful publication.
          }
          return publicBundle(next)
        } catch (error) {
          if (runtimePublicationStarted) {
            enterRecovery(error)
          } else if (pointerPublished) {
            try {
              await repository.compensatePublication(token)
            } catch (compensationError) {
              enterRecovery(compensationError)
            }
          }
          if (next !== undefined && !runtimePublicationStarted) {
            try {
              runtime.dispose(next)
            } catch {
              // Preparation failure remains authoritative.
            }
          }
          if (!pointerPublished) {
            try {
              repository.discardPreparedRevision(revision)
            } catch {
              // A commit failure already revoked and consumed the prepared state.
            }
          }
          throw error
        }
      })
    },

    restorePublished(request: ProjectPublishedRestoreV1) {
      return enqueue(async () => {
        requireEditable()
        const resources = await runtime.prepare(request.snapshot, request.revisionId)
        const next = Object.freeze({ ...request, resources })
        try {
          runtime.publish(next)
        } catch (error) {
          enterRecovery(error)
          throw error
        }
        const previous = published
        published = next
        if (previous !== null) {
          try {
            runtime.dispose(previous)
          } catch {
            // Hydrated publication succeeds independently from stale cleanup.
          }
        }
        return publicBundle(next)
      })
    },

    readPublished() {
      return published === null ? null : publicBundle(published)
    },

    isRecoveryRequired() {
      return recoveryRequired
    },
  })
}
