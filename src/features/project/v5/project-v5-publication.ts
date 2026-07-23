import {
  canonicalProjectV5Json,
  configRevisionForProjectV5 as calculateConfigRevisionForProjectV5,
  validateWorkcellProjectV5,
  type WorkcellProjectV5,
} from '../../../core/project-v5/index.js'
import {
  validateRuntimeGatewayStatusV1,
  type RuntimeGatewayStatusV1,
} from '../../../core/runtime-protocol/gateway-status-v1.js'
import type {
  PreparedProjectRevisionV5,
  ProjectRepositoryV5,
} from './project-v5-repository.js'

export interface PublishedProjectV5 {
  readonly project: WorkcellProjectV5
  readonly revisionId: string
  readonly configRevision: string
}

export interface ProjectV5BrowserRuntimePublicationPort<PreparedRuntime = unknown> {
  prepare(project: WorkcellProjectV5, configRevision: string): Promise<PreparedRuntime>
  apply(prepared: PreparedRuntime): Promise<void>
  commit(prepared: PreparedRuntime): void | Promise<void>
  rollback(prepared: PreparedRuntime): Promise<void>
}

export interface ProjectV5GatewayPublicationPort<PreparedGateway = unknown> {
  prepare(project: WorkcellProjectV5, configRevision: string): Promise<PreparedGateway>
  activate(prepared: PreparedGateway): Promise<RuntimeGatewayStatusV1>
  reactivate(previous: PublishedProjectV5): Promise<RuntimeGatewayStatusV1>
  rollback(prepared: PreparedGateway): Promise<void>
  cleanupPrevious(previous: PublishedProjectV5): Promise<void>
}

export interface ProjectV5PublicationRequest {
  readonly candidate: WorkcellProjectV5
  readonly expectedRevisionId: string | null
}

export interface ProjectPublicationCoordinatorV5 {
  replace(request: ProjectV5PublicationRequest): Promise<PublishedProjectV5>
  readPublished(): PublishedProjectV5 | null
  isRecoveryRequired(): boolean
}

export interface ProjectV5PublicationCoordinatorOptions<PreparedRuntime = unknown, PreparedGateway = unknown> {
  readonly repository: ProjectRepositoryV5
  readonly runtime: ProjectV5BrowserRuntimePublicationPort<PreparedRuntime>
  readonly gateway: ProjectV5GatewayPublicationPort<PreparedGateway>
  readonly initialPublished?: PublishedProjectV5 | null
  readonly configRevisionForProjectV5?: (project: WorkcellProjectV5) => Promise<string>
  readonly createCommitToken?: () => string
  readonly onRecoveryRequired?: (error: unknown) => void
}

export class ProjectPublicationV5Error extends Error {
  readonly code: string
  readonly cause?: unknown

  constructor(code: string, message: string, cause?: unknown) {
    super(`${code}: ${message}`)
    this.name = 'ProjectPublicationV5Error'
    this.code = code
    if (cause !== undefined) this.cause = cause
  }
}

const CONFIG_REVISION_PATTERN = /^[0-9a-f]{64}$/u

function failPublication(code: string, message: string, cause?: unknown): never {
  throw new ProjectPublicationV5Error(code, message, cause)
}

function defaultCommitToken(): string {
  return globalThis.crypto.randomUUID()
}

function requireConfigRevision(value: unknown): string {
  if (typeof value !== 'string' || !CONFIG_REVISION_PATTERN.test(value)) {
    return failPublication(
      'PROJECT_CONFIG_REVISION_INVALID',
      'Project V5 config revision must be lowercase SHA-256 hex.',
    )
  }
  return value
}

function publicPublished(
  project: WorkcellProjectV5,
  revisionId: string,
  configRevision: string,
): PublishedProjectV5 {
  if (project.revisionId !== revisionId) {
    return failPublication('PROJECT_PUBLISHED_REVISION_MISMATCH', 'Published Project V5 revision does not match its Project.')
  }
  return Object.freeze({ project, revisionId, configRevision: requireConfigRevision(configRevision) })
}

function validateInitialPublished(value: PublishedProjectV5 | null | undefined): PublishedProjectV5 | null {
  if (value === undefined || value === null) return null
  try {
    const project = validateWorkcellProjectV5(value.project)
    return publicPublished(project, value.revisionId, value.configRevision)
  } catch (error) {
    if (error instanceof ProjectPublicationV5Error) throw error
    return failPublication('PROJECT_PUBLISHED_INVALID', 'Initial published Project V5 is invalid.', error)
  }
}

function assertPreparedRevision(
  prepared: PreparedProjectRevisionV5,
  project: WorkcellProjectV5,
  configRevision: string,
): void {
  if (
    prepared.revisionId !== project.revisionId
    || prepared.configRevision !== configRevision
  ) {
    return failPublication(
      'PROJECT_PREPARED_REVISION_MISMATCH',
      'Repository prepared a Project V5 revision other than the canonical candidate.',
    )
  }
}

function assertGatewayStatus(
  value: RuntimeGatewayStatusV1,
  expected: PublishedProjectV5,
): void {
  let status: RuntimeGatewayStatusV1
  try {
    status = validateRuntimeGatewayStatusV1(value)
  } catch (error) {
    return failPublication('PROJECT_GATEWAY_STATUS_INVALID', 'Gateway returned an invalid activation status.', error)
  }
  if (
    status.project.phase !== 'ready'
    || status.project.projectId !== expected.project.projectId
    || status.project.revisionId !== expected.revisionId
    || status.project.configRevision !== expected.configRevision
  ) {
    return failPublication(
      'PROJECT_GATEWAY_ACTIVATION_MISMATCH',
      'Gateway did not activate the requested Project V5 revision and config revision.',
    )
  }
}

async function cleanupBestEffort(operation: () => Promise<void> | void): Promise<void> {
  try {
    await operation()
  } catch {
    // Cleanup is retry-only after the authoritative switch.
  }
}

export function createProjectPublicationCoordinatorV5<PreparedRuntime = unknown, PreparedGateway = unknown>(
  options: ProjectV5PublicationCoordinatorOptions<PreparedRuntime, PreparedGateway>,
): ProjectPublicationCoordinatorV5 {
  const repository = options.repository
  const runtime = options.runtime
  const gateway = options.gateway
  const createCommitToken = options.createCommitToken ?? defaultCommitToken
  const calculateConfigRevision = options.configRevisionForProjectV5 ?? calculateConfigRevisionForProjectV5
  let published = validateInitialPublished(options.initialPublished)
  let recoveryRequired = false
  let tail = Promise.resolve()

  const enqueue = <Result>(operation: () => Promise<Result>): Promise<Result> => {
    const pending = tail.then(operation, operation)
    tail = pending.then(() => undefined, () => undefined)
    return pending
  }

  const requireEditable = (): void => {
    if (recoveryRequired) {
      failPublication('PROJECT_RECOVERY_REQUIRED', 'Reload recovery is required before another Project V5 publication.')
    }
  }

  const enterRecovery = (errors: readonly unknown[]): void => {
    if (errors.length === 0) return
    recoveryRequired = true
    const error = new ProjectPublicationV5Error(
      'PROJECT_RECOVERY_REQUIRED',
      'Project V5 publication compensation did not restore prior authority.',
      errors.length === 1 ? errors[0] : new AggregateError(errors, 'Project V5 compensation failed.'),
    )
    try {
      options.onRecoveryRequired?.(error)
    } catch {
      // Recovery state remains authoritative even when observation fails.
    }
  }

  const restoreCommittedRuntime = async (previous: PublishedProjectV5): Promise<void> => {
    const prepared = await runtime.prepare(previous.project, previous.configRevision)
    try {
      await runtime.apply(prepared)
      await runtime.commit(prepared)
    } catch (error) {
      try {
        await runtime.rollback(prepared)
      } catch {
        // The caller records the original restoration failure.
      }
      throw error
    }
  }

  const coordinator: ProjectPublicationCoordinatorV5 = {
    replace(request) {
      return enqueue(async () => {
        requireEditable()
        const previous = published
        if (request.expectedRevisionId !== (previous?.revisionId ?? null)) {
          return failPublication(
            'PROJECT_ACTIVE_REVISION_CHANGED',
            'The active Project V5 revision changed before publication.',
          )
        }

        let project: WorkcellProjectV5
        try {
          project = validateWorkcellProjectV5(request.candidate)
        } catch (error) {
          return failPublication('PROJECT_PUBLICATION_CANDIDATE_INVALID', 'Project V5 candidate validation failed.', error)
        }
        const configRevision = requireConfigRevision(await calculateConfigRevision(project))
        const next = publicPublished(project, project.revisionId, configRevision)

        let preparedRevision: PreparedProjectRevisionV5 | undefined
        let preparedRuntime: PreparedRuntime | undefined
        let preparedGateway: PreparedGateway | undefined
        let commitToken: string | undefined
        let repositoryCommitStarted = false
        let repositoryCommitted = false
        let runtimeCommitted = false
        let gatewayActivationAttempted = false

        try {
          preparedRevision = await repository.prepareRevision(project, configRevision)
          assertPreparedRevision(preparedRevision, project, configRevision)
          const materialized = repository.materializePreparedProject(preparedRevision)
          if (canonicalProjectV5Json(materialized) !== canonicalProjectV5Json(project)) {
            return failPublication(
              'PROJECT_PREPARED_REVISION_MISMATCH',
              'Repository materialized Project V5 content other than the canonical candidate.',
            )
          }
          preparedRuntime = await runtime.prepare(project, configRevision)
          preparedGateway = await gateway.prepare(project, configRevision)
          await runtime.apply(preparedRuntime)
          gatewayActivationAttempted = true
          assertGatewayStatus(await gateway.activate(preparedGateway), next)
          commitToken = createCommitToken()
          repositoryCommitStarted = true
          await repository.commitPreparedRevision(request.expectedRevisionId, preparedRevision, commitToken)
          repositoryCommitted = true
          await runtime.commit(preparedRuntime)
          runtimeCommitted = true
          await repository.finalizePublication(commitToken)
          published = next
        } catch (error) {
          const compensationErrors: unknown[] = []
          const compensate = async (operation: () => Promise<void> | void): Promise<void> => {
            try {
              await operation()
            } catch (compensationError) {
              compensationErrors.push(compensationError)
            }
          }

          if (gatewayActivationAttempted && previous !== null) {
            await compensate(async () => {
              assertGatewayStatus(await gateway.reactivate(previous), previous)
            })
          }
          if (runtimeCommitted) {
            if (previous === null) {
              compensationErrors.push(new ProjectPublicationV5Error(
                'PROJECT_RUNTIME_RESTORE_UNAVAILABLE',
                'The first committed Project V5 runtime cannot be restored without a prior publication.',
              ))
            } else {
              await compensate(() => restoreCommittedRuntime(previous))
            }
          } else if (preparedRuntime !== undefined) {
            await compensate(() => runtime.rollback(preparedRuntime!))
          }
          if (preparedGateway !== undefined) {
            await compensate(() => gateway.rollback(preparedGateway!))
          }
          if (repositoryCommitted) {
            await compensate(() => repository.compensatePublication(commitToken!))
          } else if (preparedRevision !== undefined && !repositoryCommitStarted) {
            await compensate(() => repository.discardPreparedRevision(preparedRevision!))
          }
          enterRecovery(compensationErrors)
          throw error
        }

        if (previous !== null) await cleanupBestEffort(() => gateway.cleanupPrevious(previous))
        await cleanupBestEffort(() => repository.garbageCollect())
        return publicPublished(next.project, next.revisionId, next.configRevision)
      })
    },

    readPublished() {
      return published === null ? null : publicPublished(published.project, published.revisionId, published.configRevision)
    },

    isRecoveryRequired() {
      return recoveryRequired
    },
  }
  return Object.freeze(coordinator)
}
