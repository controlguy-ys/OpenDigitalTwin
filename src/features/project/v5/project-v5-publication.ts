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
import type { StoredProjectPointerV5 } from './project-v5-db.js'

export interface PublishedProjectV5 {
  readonly project: WorkcellProjectV5
  readonly revisionId: string
  readonly configRevision: string
}

export interface ProjectV5RuntimeCommitTransitionV5 {
  rollback(): Promise<void>
  finalize(): Promise<void>
}

export interface ProjectV5BrowserRuntimePublicationPort<PreparedRuntime = unknown> {
  prepare(project: WorkcellProjectV5, configRevision: string): Promise<PreparedRuntime>
  apply(prepared: PreparedRuntime): Promise<void>
  commit(prepared: PreparedRuntime): Promise<ProjectV5RuntimeCommitTransitionV5>
  rollback(prepared: PreparedRuntime): Promise<void>
}

export interface ProjectV5GatewayPublicationPort<PreparedGateway = unknown> {
  prepare(project: WorkcellProjectV5, configRevision: string): Promise<PreparedGateway>
  activate(prepared: PreparedGateway): Promise<RuntimeGatewayStatusV1>
  reactivate(previous: PublishedProjectV5): Promise<RuntimeGatewayStatusV1>
  readStatus(): Promise<RuntimeGatewayStatusV1>
  rollback(prepared: PreparedGateway): Promise<void>
  cleanupPrevious(previous: PublishedProjectV5): Promise<void>
}

export interface ProjectV5PublicationRequest {
  readonly candidate: WorkcellProjectV5
  readonly expectedRevisionId: string | null
}

export interface ProjectPublicationCoordinatorV5 {
  replace(request: ProjectV5PublicationRequest): Promise<PublishedProjectV5>
  hydrate(): Promise<PublishedProjectV5 | null>
  subscribe(listener: () => void): () => void
  readPublished(): PublishedProjectV5 | null
  isRecoveryRequired(): boolean
  readCleanupStatus(): ProjectV5CleanupStatus
  retryCleanup(): Promise<void>
}

export type ProjectV5CleanupKind =
  | 'runtime-transition-finalize'
  | 'gateway-previous'
  | 'repository-garbage-collection'

export interface ProjectV5CleanupIssue {
  readonly kind: ProjectV5CleanupKind
  readonly revisionId: string
  readonly attemptCount: number
  readonly lastError: { readonly code: string; readonly message: string }
}

export interface ProjectV5CleanupStatus {
  readonly pending: readonly ProjectV5CleanupIssue[]
}

export interface ProjectV5PublicationCoordinatorOptions<PreparedRuntime = unknown, PreparedGateway = unknown> {
  readonly repository: ProjectRepositoryV5
  readonly runtime: ProjectV5BrowserRuntimePublicationPort<PreparedRuntime>
  readonly gateway: ProjectV5GatewayPublicationPort<PreparedGateway>
  readonly initialPublished?: PublishedProjectV5 | null
  readonly configRevisionForProjectV5?: (project: WorkcellProjectV5) => Promise<string>
  readonly createCommitToken?: () => string
  readonly onRecoveryRequired?: (error: unknown) => void
  readonly onCleanupIssue?: (issue: ProjectV5CleanupIssue) => void
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

function assertGatewayInactiveStatus(value: RuntimeGatewayStatusV1): void {
  let status: RuntimeGatewayStatusV1
  try {
    status = validateRuntimeGatewayStatusV1(value)
  } catch (error) {
    return failPublication('PROJECT_GATEWAY_STATUS_INVALID', 'Gateway returned an invalid rollback status.', error)
  }
  if (
    status.project.phase !== 'not-applied'
    || status.project.projectId !== null
    || status.project.revisionId !== null
    || status.project.configRevision !== null
    || status.project.readinessCode !== 'NO_ACTIVE_REVISION'
  ) {
    return failPublication(
      'PROJECT_GATEWAY_ROLLBACK_MISMATCH',
      'Gateway did not return to the canonical no-active-revision state.',
    )
  }
}

interface PendingCleanupTaskV5 {
  readonly kind: ProjectV5CleanupKind
  readonly revisionId: string
  readonly operation: () => Promise<void>
  attemptCount: number
  lastError: { readonly code: string; readonly message: string } | null
}

function cleanupError(error: unknown): { readonly code: string; readonly message: string } {
  if (error instanceof ProjectPublicationV5Error) {
    return Object.freeze({ code: error.code, message: error.message })
  }
  if (error instanceof Error) return Object.freeze({ code: error.name, message: error.message })
  return Object.freeze({ code: 'PROJECT_CLEANUP_FAILED', message: String(error) })
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
  const cleanupTasks = new Map<ProjectV5CleanupKind, PendingCleanupTaskV5>()
  const listeners = new Set<() => void>()

  const enqueue = <Result>(operation: () => Promise<Result>): Promise<Result> => {
    const pending = tail.then(operation, operation)
    tail = pending.then(() => undefined, () => undefined)
    return pending
  }

  const requireEditable = (): void => {
    if (recoveryRequired) {
      failPublication('PROJECT_RECOVERY_REQUIRED', 'Reload recovery is required before another Project V5 publication.')
    }
    if (cleanupTasks.size > 0) {
      failPublication('PROJECT_CLEANUP_REQUIRED', 'Resolve retained Project V5 cleanup tasks before another publication.')
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

  const notifyPublished = (): void => {
    for (const listener of listeners) {
      try {
        listener()
      } catch {
        // Observers cannot alter durable publication authority.
      }
    }
  }

  const cleanupStatus = (): ProjectV5CleanupStatus => Object.freeze({
    pending: Object.freeze(Array.from(cleanupTasks.values(), (task) => Object.freeze({
      kind: task.kind,
      revisionId: task.revisionId,
      attemptCount: task.attemptCount,
      lastError: task.lastError!,
    }))),
  })

  const emitCleanupIssue = (task: PendingCleanupTaskV5): void => {
    const issue = cleanupStatus().pending.find((candidate) => candidate.kind === task.kind)
    if (issue === undefined) return
    try {
      options.onCleanupIssue?.(issue)
    } catch {
      // Observation cannot alter the active publication or retained task.
    }
  }

  const runCleanupTask = async (task: PendingCleanupTaskV5): Promise<void> => {
    task.attemptCount += 1
    try {
      await task.operation()
      cleanupTasks.delete(task.kind)
    } catch (error) {
      task.lastError = cleanupError(error)
      emitCleanupIssue(task)
    }
  }

  const retainCleanupTask = async (
    kind: ProjectV5CleanupKind,
    revisionId: string,
    operation: () => Promise<void>,
  ): Promise<void> => {
    if (cleanupTasks.has(kind)) {
      failPublication('PROJECT_CLEANUP_TASK_DUPLICATE', `Project V5 cleanup task ${kind} is already retained.`)
    }
    const task: PendingCleanupTaskV5 = {
      kind,
      revisionId,
      operation,
      attemptCount: 0,
      lastError: null,
    }
    cleanupTasks.set(kind, task)
    await runCleanupTask(task)
  }

  const loadDurablePublication = async (revisionId: string): Promise<PublishedProjectV5> => {
    const record = await repository.readRevision(revisionId)
    if (record === null) {
      return failPublication('PROJECT_HYDRATION_REVISION_MISSING', `Durable Project V5 revision ${revisionId} is missing.`)
    }
    if (record.revisionId !== revisionId || record.project.revisionId !== revisionId) {
      return failPublication('PROJECT_HYDRATION_REVISION_MISMATCH', `Durable Project V5 revision ${revisionId} has mismatched identity.`)
    }
    return publicPublished(record.project, record.revisionId, record.configRevision)
  }

  const restoreRuntimeAndGateway = async (next: PublishedProjectV5): Promise<{
    readonly preparedRuntime: PreparedRuntime
    readonly preparedGateway: PreparedGateway
    readonly runtimeTransition: ProjectV5RuntimeCommitTransitionV5
  }> => {
    let preparedRuntime: PreparedRuntime | undefined
    let preparedGateway: PreparedGateway | undefined
    let runtimeTransition: ProjectV5RuntimeCommitTransitionV5 | undefined
    let gatewayActivationAttempted = false
    try {
      preparedRuntime = await runtime.prepare(next.project, next.configRevision)
      preparedGateway = await gateway.prepare(next.project, next.configRevision)
      await runtime.apply(preparedRuntime)
      gatewayActivationAttempted = true
      assertGatewayStatus(await gateway.activate(preparedGateway), next)
      runtimeTransition = await runtime.commit(preparedRuntime)
      return { preparedRuntime, preparedGateway, runtimeTransition }
    } catch (error) {
      const compensationErrors: unknown[] = []
      const compensate = async (operation: () => Promise<void> | void): Promise<void> => {
        try {
          await operation()
        } catch (compensationError) {
          compensationErrors.push(compensationError)
        }
      }
      if (preparedGateway !== undefined) await compensate(() => gateway.rollback(preparedGateway!))
      if (gatewayActivationAttempted) await compensate(async () => {
        assertGatewayInactiveStatus(await gateway.readStatus())
      })
      if (runtimeTransition !== undefined) {
        await compensate(() => runtimeTransition!.rollback())
      } else if (preparedRuntime !== undefined) {
        await compensate(() => runtime.rollback(preparedRuntime!))
      }
      enterRecovery(compensationErrors)
      throw error
    }
  }

  const rollbackHydratedRuntimeAndGateway = async (activation: {
    readonly preparedRuntime: PreparedRuntime
    readonly preparedGateway: PreparedGateway
    readonly runtimeTransition: ProjectV5RuntimeCommitTransitionV5
  }): Promise<readonly unknown[]> => {
    const errors: unknown[] = []
    const compensate = async (operation: () => Promise<void> | void): Promise<void> => {
      try {
        await operation()
      } catch (error) {
        errors.push(error)
      }
    }
    await compensate(() => gateway.rollback(activation.preparedGateway))
    await compensate(async () => { assertGatewayInactiveStatus(await gateway.readStatus()) })
    await compensate(() => activation.runtimeTransition.rollback())
    return errors
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
        let runtimeTransition: ProjectV5RuntimeCommitTransitionV5 | undefined
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
          runtimeTransition = await runtime.commit(preparedRuntime)
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

          if (preparedGateway !== undefined) {
            await compensate(() => gateway.rollback(preparedGateway!))
          }
          if (gatewayActivationAttempted && previous === null) {
            await compensate(async () => {
              assertGatewayInactiveStatus(await gateway.readStatus())
            })
          }
          if (runtimeTransition !== undefined) {
            await compensate(() => runtimeTransition!.rollback())
          } else if (preparedRuntime !== undefined) {
            await compensate(() => runtime.rollback(preparedRuntime!))
          }
          if (repositoryCommitted) {
            await compensate(() => repository.compensatePublication(commitToken!))
          } else if (preparedRevision !== undefined && !repositoryCommitStarted) {
            await compensate(() => repository.discardPreparedRevision(preparedRevision!))
          }
          if (gatewayActivationAttempted && previous !== null) {
            await compensate(async () => {
              assertGatewayStatus(await gateway.reactivate(previous), previous)
              assertGatewayStatus(await gateway.readStatus(), previous)
            })
          }
          enterRecovery(compensationErrors)
          throw error
        }

        await retainCleanupTask('runtime-transition-finalize', next.revisionId, () => runtimeTransition!.finalize())
        if (previous !== null) {
          await retainCleanupTask('gateway-previous', previous.revisionId, () => gateway.cleanupPrevious(previous))
        }
        await retainCleanupTask('repository-garbage-collection', next.revisionId, () => repository.garbageCollect())
        notifyPublished()
        return publicPublished(next.project, next.revisionId, next.configRevision)
      })
    },

    hydrate() {
      return enqueue(async () => {
        if (published !== null) return publicPublished(published.project, published.revisionId, published.configRevision)
        if (recoveryRequired) {
          return failPublication('PROJECT_RECOVERY_REQUIRED', 'Reload recovery is required before Project V5 hydration.')
        }
        const pointer = await repository.readPointer()
        if (pointer === null) return null

        const compensateInterruptedPublication = async (
          interrupted: Extract<StoredProjectPointerV5, { readonly state: 'publishing' }>,
          originalError: unknown,
        ): Promise<PublishedProjectV5 | null> => {
          try {
            await repository.compensatePublication(interrupted.commitToken)
            const restoredPointer = await repository.readPointer()
            if (interrupted.previousRevisionId === null) {
              if (restoredPointer !== null) {
                return failPublication('PROJECT_HYDRATION_COMPENSATION_MISMATCH', 'Interrupted Project V5 publication did not compensate to an empty durable pointer.')
              }
              return null
            }
            if (
              restoredPointer === null
              || restoredPointer.state !== 'stable'
              || restoredPointer.revisionId !== interrupted.previousRevisionId
              || restoredPointer.commitToken !== interrupted.previousCommitToken
            ) {
              return failPublication('PROJECT_HYDRATION_COMPENSATION_MISMATCH', 'Interrupted Project V5 publication did not restore its previous durable pointer.')
            }
            const previous = await loadDurablePublication(restoredPointer.revisionId)
            const activation = await restoreRuntimeAndGateway(previous)
            published = previous
            await retainCleanupTask('runtime-transition-finalize', previous.revisionId, () => activation.runtimeTransition.finalize())
            await retainCleanupTask('repository-garbage-collection', previous.revisionId, () => repository.garbageCollect())
            notifyPublished()
            return publicPublished(previous.project, previous.revisionId, previous.configRevision)
          } catch (compensationError) {
            enterRecovery([originalError, compensationError])
            throw originalError
          }
        }

        let next: PublishedProjectV5
        try {
          next = await loadDurablePublication(pointer.revisionId)
        } catch (error) {
          if (pointer.state === 'publishing') return compensateInterruptedPublication(pointer, error)
          enterRecovery([error])
          throw error
        }

        let activation: Awaited<ReturnType<typeof restoreRuntimeAndGateway>> | undefined
        try {
          activation = await restoreRuntimeAndGateway(next)
          if (pointer.state === 'publishing') {
            await repository.finalizePublication(pointer.commitToken)
            const finalized = await repository.readPointer()
            if (
              finalized === null
              || finalized.state !== 'stable'
              || finalized.revisionId !== next.revisionId
              || finalized.commitToken !== pointer.commitToken
            ) {
              return failPublication('PROJECT_HYDRATION_FINALIZATION_MISMATCH', 'Interrupted Project V5 publication did not finalize to its restored target.')
            }
          }
        } catch (error) {
          if (activation !== undefined) {
            const rollbackErrors = await rollbackHydratedRuntimeAndGateway(activation)
            if (rollbackErrors.length > 0) enterRecovery(rollbackErrors)
          }
          if (pointer.state === 'publishing') return compensateInterruptedPublication(pointer, error)
          throw error
        }

        published = next
        await retainCleanupTask('runtime-transition-finalize', next.revisionId, () => activation!.runtimeTransition.finalize())
        await retainCleanupTask('repository-garbage-collection', next.revisionId, () => repository.garbageCollect())
        notifyPublished()
        return publicPublished(next.project, next.revisionId, next.configRevision)
      })
    },

    subscribe(listener) {
      if (typeof listener !== 'function') {
        return failPublication('PROJECT_SUBSCRIPTION_INVALID', 'Project V5 publication listener must be a function.')
      }
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },

    readPublished() {
      return published === null ? null : publicPublished(published.project, published.revisionId, published.configRevision)
    },

    isRecoveryRequired() {
      return recoveryRequired
    },

    readCleanupStatus() {
      return cleanupStatus()
    },

    retryCleanup() {
      return enqueue(async () => {
        for (const task of Array.from(cleanupTasks.values())) await runCleanupTask(task)
      })
    },
  }
  return Object.freeze(coordinator)
}
