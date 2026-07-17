import {
  configRevisionForProjectV4,
  validateWorkcellProjectV4,
  type WorkcellProjectV4,
} from '../../../core/project-v4/index.js'
import type {
  PreparedProjectRevisionV4,
  ProjectRepositoryV4,
} from './project-v4-repository.js'

export interface PreparedProjectRuntimeBundleV4<R> {
  readonly project: WorkcellProjectV4
  readonly revisionId: string
  readonly resources: R
}

export interface ProjectRuntimeV4<R> {
  prepare(
    project: WorkcellProjectV4,
    revisionId: string,
  ): Promise<PreparedProjectRuntimeBundleV4<R>>
  apply(
    bundle: PreparedProjectRuntimeBundleV4<R>,
  ): Promise<AppliedProjectRuntimePublicationV4>
  dispose(bundle: PreparedProjectRuntimeBundleV4<R>): Promise<void> | void
}

export interface AppliedProjectRuntimePublicationV4 {
  commit(): Promise<void> | void
  rollback(): Promise<void> | void
  cleanup(): Promise<void> | void
}

export interface ProjectPublicationRequestV4 {
  readonly candidate: WorkcellProjectV4
  readonly expectedRevisionId: string | null
}

export interface PublishedProjectBundleV4 {
  readonly project: WorkcellProjectV4
  readonly revisionId: string
  readonly configRevision: string
}

export interface ProjectPublicationCoordinatorV4 {
  replace(request: ProjectPublicationRequestV4): Promise<PublishedProjectBundleV4>
  restorePublished(bundle: PublishedProjectBundleV4): Promise<PublishedProjectBundleV4>
  readPublished(): PublishedProjectBundleV4 | null
  isRecoveryRequired(): boolean
}

export interface ProjectPublicationCoordinatorV4Options<R> {
  readonly repository: ProjectRepositoryV4
  readonly runtime: ProjectRuntimeV4<R>
  readonly createCommitToken?: (() => string) | undefined
  readonly onRecoveryRequired?: ((error: unknown) => void) | undefined
}

export class ProjectPublicationV4Error extends Error {
  readonly code: string
  readonly cause?: unknown

  constructor(code: string, message: string, cause?: unknown) {
    super(`${code}: ${message}`)
    this.name = 'ProjectPublicationV4Error'
    this.code = code
    if (cause !== undefined) this.cause = cause
  }
}

function failPublication(code: string, message: string, cause?: unknown): never {
  throw new ProjectPublicationV4Error(code, message, cause)
}

function defaultCommitToken(): string {
  return globalThis.crypto.randomUUID()
}

function publicBundle(
  project: WorkcellProjectV4,
  revisionId: string,
  configRevision: string,
): PublishedProjectBundleV4 {
  return Object.freeze({ project, revisionId, configRevision })
}

function copyPublicBundle(bundle: PublishedProjectBundleV4): PublishedProjectBundleV4 {
  return publicBundle(bundle.project, bundle.revisionId, bundle.configRevision)
}

async function stabilizeRuntimeBundle<R>(
  bundle: PreparedProjectRuntimeBundleV4<R>,
  authoritative: PreparedProjectRevisionV4 | PublishedProjectBundleV4,
): Promise<PreparedProjectRuntimeBundleV4<R>> {
  try {
    if (typeof bundle !== 'object' || bundle === null) {
      return failPublication(
        'PROJECT_RUNTIME_PREPARED_BUNDLE_INVALID',
        'Runtime returned an invalid prepared Project V4 bundle.',
      )
    }
    const runtimeProjectSource = bundle.project
    const runtimeRevisionId = bundle.revisionId
    const resources = bundle.resources
    if (runtimeRevisionId !== authoritative.revisionId) {
      return failPublication(
        'PROJECT_RUNTIME_PREPARED_BUNDLE_INVALID',
        'Runtime prepared another Project V4 revision.',
      )
    }
    const runtimeProject = validateWorkcellProjectV4(runtimeProjectSource)
    const runtimeConfigRevision = await configRevisionForProjectV4(runtimeProject)
    if (runtimeConfigRevision !== authoritative.configRevision) {
      return failPublication(
        'PROJECT_RUNTIME_PREPARED_BUNDLE_INVALID',
        'Runtime prepared canonical content other than the requested Project V4 revision.',
      )
    }
    return Object.freeze({
      project: authoritative.project,
      revisionId: authoritative.revisionId,
      resources,
    })
  } catch (error) {
    if (
      error instanceof ProjectPublicationV4Error &&
      error.code === 'PROJECT_RUNTIME_PREPARED_BUNDLE_INVALID'
    ) {
      throw error
    }
    return failPublication(
      'PROJECT_RUNTIME_PREPARED_BUNDLE_INVALID',
      'Runtime returned an invalid prepared Project V4 bundle.',
      error,
    )
  }
}

function validateApplication(
  value: AppliedProjectRuntimePublicationV4,
): AppliedProjectRuntimePublicationV4 {
  if (
    typeof value !== 'object' ||
    value === null ||
    typeof value.commit !== 'function' ||
    typeof value.rollback !== 'function' ||
    typeof value.cleanup !== 'function'
  ) {
    return failPublication(
      'PROJECT_RUNTIME_APPLICATION_INVALID',
      'Runtime did not return a reversible Project V4 application handle.',
    )
  }
  return value
}

async function validatePublishedBundle(
  bundle: PublishedProjectBundleV4,
): Promise<PublishedProjectBundleV4> {
  try {
    if (typeof bundle !== 'object' || bundle === null) {
      return failPublication(
        'PROJECT_PUBLISHED_BUNDLE_INVALID',
        'Published Project V4 bundle is malformed.',
      )
    }
    const project = validateWorkcellProjectV4(bundle.project)
    if (bundle.revisionId !== project.revisionId) {
      return failPublication(
        'PROJECT_PUBLISHED_BUNDLE_INVALID',
        'Published Project V4 revision does not match its Project.',
      )
    }
    const configRevision = await configRevisionForProjectV4(project)
    if (bundle.configRevision !== configRevision) {
      return failPublication(
        'PROJECT_PUBLISHED_BUNDLE_INVALID',
        'Published Project V4 config revision does not match its Project.',
      )
    }
    return publicBundle(project, project.revisionId, configRevision)
  } catch (error) {
    if (
      error instanceof ProjectPublicationV4Error &&
      error.code === 'PROJECT_PUBLISHED_BUNDLE_INVALID'
    ) {
      throw error
    }
    return failPublication(
      'PROJECT_PUBLISHED_BUNDLE_INVALID',
      'Published Project V4 bundle failed validation.',
      error,
    )
  }
}

export function createProjectPublicationCoordinatorV4<R>(
  options: ProjectPublicationCoordinatorV4Options<R>,
): ProjectPublicationCoordinatorV4 {
  const repository = options.repository
  const runtime = options.runtime
  const createCommitToken = options.createCommitToken ?? defaultCommitToken
  let published: PublishedProjectBundleV4 | null = null
  let recoveryRequired = false
  let tail = Promise.resolve()

  const enqueue = <Result>(operation: () => Promise<Result>): Promise<Result> => {
    const pending = tail.then(operation, operation)
    tail = pending.then(() => undefined, () => undefined)
    return pending
  }

  const requireEditable = (): void => {
    if (recoveryRequired) {
      return failPublication(
        'PROJECT_RECOVERY_REQUIRED',
        'Project V4 publication requires reload recovery before another operation.',
      )
    }
  }

  const enterRecovery = (error: unknown): void => {
    recoveryRequired = true
    try {
      options.onRecoveryRequired?.(error)
    } catch {
      // Recovery state is authoritative even when notification fails.
    }
  }

  const disposeBestEffort = async (
    bundle: PreparedProjectRuntimeBundleV4<R>,
  ): Promise<void> => {
    try {
      await runtime.dispose(bundle)
    } catch {
      // The preceding failure remains authoritative.
    }
  }

  const rollbackBestEffort = async (
    application: AppliedProjectRuntimePublicationV4,
  ): Promise<void> => {
    try {
      await application.rollback()
    } catch {
      // Recovery remains required after an uncertain staged application.
    }
  }

  const coordinator: ProjectPublicationCoordinatorV4 = {
    replace(request) {
      return enqueue(async () => {
        requireEditable()
        const previous = published
        const prepared = await repository.prepareRevision(request.candidate)
        let runtimeBundle: PreparedProjectRuntimeBundleV4<R> | undefined
        let preparedRuntimeBundle: PreparedProjectRuntimeBundleV4<R> | undefined
        let commitToken: string | undefined
        let pointerPublished = false
        let runtimeApplyResolved = false
        let application: AppliedProjectRuntimePublicationV4 | undefined
        let durableFinalized = false
        let next: PublishedProjectBundleV4 | undefined

        try {
          const project = repository.materializePreparedProject(prepared)
          preparedRuntimeBundle = await runtime.prepare(project, prepared.revisionId)
          runtimeBundle = await stabilizeRuntimeBundle(preparedRuntimeBundle, {
            ...prepared,
            project,
          })
          commitToken = createCommitToken()
          await repository.commitPreparedRevision(
            request.expectedRevisionId,
            prepared,
            commitToken,
          )
          pointerPublished = true
          const applicationCandidate = await runtime.apply(runtimeBundle)
          runtimeApplyResolved = true
          application = validateApplication(applicationCandidate)
          await repository.finalizePublication(commitToken)
          durableFinalized = true
          next = publicBundle(
            prepared.project,
            prepared.revisionId,
            prepared.configRevision,
          )
          // These adjacent statements are the authoritative observer switch.
          published = next
          const commitResult = application.commit()
          await commitResult
        } catch (error) {
          if (application !== undefined) {
            if (durableFinalized) published = previous
            await rollbackBestEffort(application)
            enterRecovery(error)
          } else if (pointerPublished && runtimeApplyResolved) {
            enterRecovery(error)
          } else if (pointerPublished) {
            let compensated = false
            try {
              await repository.compensatePublication(commitToken!)
              compensated = true
            } catch (compensationError) {
              enterRecovery(compensationError)
            }
            if (compensated && runtimeBundle !== undefined) {
              await disposeBestEffort(runtimeBundle)
            }
          } else {
            const disposableBundle = runtimeBundle ?? preparedRuntimeBundle
            if (disposableBundle !== undefined) await disposeBestEffort(disposableBundle)
            try {
              repository.discardPreparedRevision(prepared)
            } catch {
              // A repository commit failure may already have consumed it.
            }
          }
          throw error
        }

        try {
          await application!.cleanup()
        } catch {
          // Runtime cleanup is retry-only after the authoritative switch.
        }
        try {
          await repository.garbageCollect()
        } catch {
          // Durable cleanup is retry-only after successful publication.
        }
        return copyPublicBundle(next!)
      })
    },

    restorePublished(bundle) {
      return enqueue(async () => {
        requireEditable()
        const next = await validatePublishedBundle(bundle)
        const preparedRuntimeBundle = await runtime.prepare(next.project, next.revisionId)
        let runtimeBundle: PreparedProjectRuntimeBundleV4<R>
        try {
          runtimeBundle = await stabilizeRuntimeBundle(preparedRuntimeBundle, next)
        } catch (error) {
          await disposeBestEffort(preparedRuntimeBundle)
          throw error
        }

        let application: AppliedProjectRuntimePublicationV4
        let runtimeApplyResolved = false
        try {
          const applicationCandidate = await runtime.apply(runtimeBundle)
          runtimeApplyResolved = true
          application = validateApplication(applicationCandidate)
        } catch (error) {
          if (!runtimeApplyResolved) await disposeBestEffort(runtimeBundle)
          enterRecovery(error)
          throw error
        }

        const previous = published
        try {
          // Restore has no pending durable work; publish and flush in one turn.
          published = next
          const commitResult = application.commit()
          await commitResult
        } catch (error) {
          published = previous
          await rollbackBestEffort(application)
          enterRecovery(error)
          throw error
        }
        try {
          await application.cleanup()
        } catch {
          // Runtime cleanup is retry-only after the authoritative switch.
        }
        return copyPublicBundle(next)
      })
    },

    readPublished() {
      return published === null ? null : copyPublicBundle(published)
    },

    isRecoveryRequired() {
      return recoveryRequired
    },
  }

  return Object.freeze(coordinator)
}
