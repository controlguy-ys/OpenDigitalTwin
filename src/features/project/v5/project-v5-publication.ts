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
  deactivate(): Promise<ProjectV5RuntimeCommitTransitionV5>
}

export interface ProjectV5GatewayPublicationPort<PreparedGateway = unknown> {
  prepare(project: WorkcellProjectV5, configRevision: string, expectedPrevious: PublishedProjectV5 | null): Promise<PreparedGateway>
  activate(prepared: PreparedGateway): Promise<RuntimeGatewayStatusV1>
  reactivate(previous: PublishedProjectV5): Promise<RuntimeGatewayStatusV1>
  readStatus(): Promise<RuntimeGatewayStatusV1>
  rollback(prepared: PreparedGateway): Promise<ProjectV5GatewayRollbackDispositionV1>
  deactivate(): Promise<RuntimeGatewayStatusV1>
  cleanupPrevious(previous: PublishedProjectV5): Promise<void>
}

export type ProjectV5GatewayRollbackDispositionV1 =
  | 'prepared-only'
  | 'candidate-deactivated'
  | 'candidate-absent'
  | 'other-authority'

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
  readRecoveryError(): Error | null
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
  readonly lastError: { readonly code: string; readonly message: string } | null
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

function samePublishedPublication(left: PublishedProjectV5, right: PublishedProjectV5): boolean {
  return left.revisionId === right.revisionId
    && left.configRevision === right.configRevision
    && left.project.projectId === right.project.projectId
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

function gatewayStatusMatchesPublishedTarget(
  value: RuntimeGatewayStatusV1,
  expected: PublishedProjectV5,
): boolean {
  return value.project.phase === 'ready'
    && value.project.projectId === expected.project.projectId
    && value.project.revisionId === expected.revisionId
    && value.project.configRevision === expected.configRevision
}

function isGatewayActivationConflict(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error
    && error.code === 'PROJECT_ACTIVATION_CONFLICT'
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

interface CleanupRetryGenerationV5 {
  readonly identity: symbol
  readonly promise: Promise<void>
  readonly resolve: () => void
}

interface PendingCleanupTaskV5 {
  readonly kind: ProjectV5CleanupKind
  readonly revisionId: string
  readonly operation: () => Promise<void>
  attemptCount: number
  lastError: { readonly code: string; readonly message: string } | null
  failureOwner: CleanupRetryGenerationV5 | null | undefined
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
  let recoveryError: ProjectPublicationV5Error | null = null
  let tail = Promise.resolve()
  const cleanupTasks: PendingCleanupTaskV5[] = []
  let cleanupDrainPromise: Promise<void> | null = null
  let activeCleanupRetry: CleanupRetryGenerationV5 | null = null
  let queuedCleanupRetry: CleanupRetryGenerationV5 | null = null
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
    if (cleanupTasks.length > 0) {
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
    recoveryError = error
    notifyPublished()
    try {
      options.onRecoveryRequired?.(error)
    } catch {
      // Recovery state remains authoritative even when observation fails.
    }
  }

  const notifyPublished = (): void => {
    for (const listener of Array.from(listeners)) {
      try {
        listener()
      } catch {
        // Observers cannot alter durable publication authority.
      }
    }
  }

  const cleanupStatus = (): ProjectV5CleanupStatus => Object.freeze({
    pending: Object.freeze(Array.from(cleanupTasks, (task) => Object.freeze({
      kind: task.kind,
      revisionId: task.revisionId,
      attemptCount: task.attemptCount,
      lastError: task.lastError,
    }))),
  })

  const emitCleanupIssue = (task: PendingCleanupTaskV5): void => {
    const issue = cleanupStatus().pending.find((candidate) => candidate.kind === task.kind && candidate.revisionId === task.revisionId)
    if (issue === undefined) return
    try {
      options.onCleanupIssue?.(issue)
    } catch {
      // Observation cannot alter the active publication or retained task.
    }
  }

  const retainCleanupTask = (
    kind: ProjectV5CleanupKind,
    revisionId: string,
    operation: () => Promise<void>,
  ): void => {
    if (cleanupTasks.some((task) => task.kind === kind)) {
      failPublication('PROJECT_CLEANUP_TASK_DUPLICATE', `Project V5 cleanup task ${kind} is already retained.`)
    }
    const task: PendingCleanupTaskV5 = {
      kind,
      revisionId,
      operation,
      attemptCount: 0,
      lastError: null,
      failureOwner: undefined,
    }
    cleanupTasks.push(task)
  }

  const kickCleanupDrain = (owner: CleanupRetryGenerationV5 | null = null): Promise<void> => {
    if (cleanupDrainPromise !== null) return cleanupDrainPromise
    if (cleanupTasks.length === 0) return Promise.resolve()
    let resolveDrain!: () => void
    const drain = new Promise<void>((resolve) => { resolveDrain = resolve })
    cleanupDrainPromise = drain
    const running = Promise.resolve().then(async () => {
      while (cleanupTasks.length > 0) {
        const task = cleanupTasks[0]!
        task.attemptCount += 1
        task.lastError = null
        task.failureOwner = undefined
        try {
          await task.operation()
          if (cleanupTasks[0] === task) cleanupTasks.shift()
        } catch (error) {
          task.lastError = cleanupError(error)
          task.failureOwner = owner
          emitCleanupIssue(task)
          return
        }
      }
    })
    const finish = (): void => {
      if (cleanupDrainPromise === drain) {
        cleanupDrainPromise = null
      }
      resolveDrain()
    }
    void running.then(finish, (error) => {
      const task = cleanupTasks[0]
      if (task !== undefined) {
        task.lastError = cleanupError(error)
        task.failureOwner = owner
        emitCleanupIssue(task)
      }
      finish()
    })
    return drain
  }

  const createCleanupRetryGeneration = (): CleanupRetryGenerationV5 => {
    let resolve!: () => void
    const promise = new Promise<void>((settle) => { resolve = settle })
    return Object.freeze({ identity: Symbol('project-v5-cleanup-retry'), promise, resolve })
  }

  const finishCleanupRetryGeneration = (generation: CleanupRetryGenerationV5): void => {
    if (activeCleanupRetry === generation) {
      const next = queuedCleanupRetry
      queuedCleanupRetry = null
      activeCleanupRetry = next
      if (next !== null) startCleanupRetryGeneration(next)
    }
    generation.resolve()
  }

  const startCleanupRetryGeneration = (generation: CleanupRetryGenerationV5): void => {
    const running = Promise.resolve().then(async () => {
      const activeDrain = cleanupDrainPromise
      if (activeDrain !== null) await activeDrain
      if (activeCleanupRetry !== generation) return
      if (cleanupTasks.length > 0) await kickCleanupDrain(generation)
    })
    void running.then(
      () => finishCleanupRetryGeneration(generation),
      () => finishCleanupRetryGeneration(generation),
    )
  }

  const retryCleanup = (): Promise<void> => {
    const current = activeCleanupRetry
    if (current === null) {
      const generation = createCleanupRetryGeneration()
      activeCleanupRetry = generation
      startCleanupRetryGeneration(generation)
      return generation.promise
    }
    if (cleanupTasks[0]?.failureOwner === current) {
      if (queuedCleanupRetry === null) {
        queuedCleanupRetry = createCleanupRetryGeneration()
      }
      return queuedCleanupRetry.promise
    }
    return current.promise
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

  const samePointer = (left: StoredProjectPointerV5 | null, right: StoredProjectPointerV5 | null): boolean => {
    if (left === null || right === null) return left === right
    if (left.state !== right.state || left.revisionId !== right.revisionId || left.commitToken !== right.commitToken) return false
    if (left.state === 'stable' || right.state === 'stable') return left.state === right.state
    return left.previousRevisionId === right.previousRevisionId && left.previousCommitToken === right.previousCommitToken
  }

  const readHydrationPointer = async (): Promise<StoredProjectPointerV5 | null> => {
    try {
      return await repository.readPointer()
    } catch (error) {
      const code = typeof error === 'object' && error !== null && 'code' in error ? error.code : null
      if (code === 'PROJECT_POINTER_INVALID' || code === 'PROJECT_REVISION_CORRUPT' || code === 'PROJECT_CONFIG_REVISION_MISMATCH') {
        enterRecovery([error])
      }
      throw error
    }
  }

  const requireExactPointer = async (expected: StoredProjectPointerV5 | null): Promise<void> => {
    if (!samePointer(await readHydrationPointer(), expected)) {
      failPublication('PROJECT_ACTIVE_REVISION_CHANGED', 'The exact durable Project V5 pointer changed during hydration.')
    }
  }

  const restoreRuntimeAndGateway = async (next: PublishedProjectV5): Promise<{
    readonly preparedRuntime: PreparedRuntime
    readonly runtimeTransition: ProjectV5RuntimeCommitTransitionV5
    rollbackGateway(): Promise<ProjectV5GatewayRollbackDispositionV1>
  }> => {
    let preparedRuntime: PreparedRuntime | undefined
    let preparedGateway: PreparedGateway | undefined
    let runtimePrepared = false
    let gatewayPrepared = false
    let runtimeTransition: ProjectV5RuntimeCommitTransitionV5 | undefined
    let gatewayActivationAttempted = false
    try {
      preparedRuntime = await runtime.prepare(next.project, next.configRevision)
      runtimePrepared = true
      preparedGateway = await gateway.prepare(next.project, next.configRevision, null)
      gatewayPrepared = true
      await runtime.apply(preparedRuntime)
      gatewayActivationAttempted = true
      let rollbackGateway = (): Promise<ProjectV5GatewayRollbackDispositionV1> => gateway.rollback(preparedGateway as PreparedGateway)
      try {
        assertGatewayStatus(await gateway.activate(preparedGateway), next)
      } catch (activationError) {
        if (!isGatewayActivationConflict(activationError)) throw activationError
        const winner = await gateway.readStatus()
        if (!gatewayStatusMatchesPublishedTarget(winner, next)) throw activationError
        // Another tab owns a healthy exact durable target. Its Gateway
        // authority is convergence, not residue that this tab may remove.
        await gateway.rollback(preparedGateway)
        rollbackGateway = async () => 'other-authority'
      }
      runtimeTransition = await runtime.commit(preparedRuntime)
      return { preparedRuntime, runtimeTransition, rollbackGateway }
    } catch (error) {
      const compensationErrors: unknown[] = []
      const compensate = async (operation: () => Promise<void> | void): Promise<void> => {
        try {
          await operation()
        } catch (compensationError) {
          compensationErrors.push(compensationError)
        }
      }
      if (gatewayPrepared) await compensate(async () => { await gateway.rollback(preparedGateway as PreparedGateway) })
      if (gatewayActivationAttempted) await compensate(async () => {
        assertGatewayInactiveStatus(await gateway.readStatus())
      })
      if (runtimeTransition !== undefined) {
        await compensate(() => runtimeTransition!.rollback())
      } else if (runtimePrepared) {
        await compensate(() => runtime.rollback(preparedRuntime as PreparedRuntime))
      }
      enterRecovery(compensationErrors)
      throw error
    }
  }

  const rollbackHydratedRuntimeAndGateway = async (activation: {
    readonly preparedRuntime: PreparedRuntime
    readonly runtimeTransition: ProjectV5RuntimeCommitTransitionV5
    rollbackGateway(): Promise<ProjectV5GatewayRollbackDispositionV1>
  }): Promise<readonly unknown[]> => {
    const errors: unknown[] = []
    const compensate = async (operation: () => Promise<void> | void): Promise<void> => {
      try {
        await operation()
      } catch (error) {
        errors.push(error)
      }
    }
    const disposition = await activation.rollbackGateway().catch((error) => { errors.push(error); return undefined })
    if (disposition !== 'other-authority') {
      await compensate(async () => { assertGatewayInactiveStatus(await gateway.readStatus()) })
    }
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
        let runtimePrepared = false
        let gatewayPrepared = false
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
          runtimePrepared = true
          preparedGateway = await gateway.prepare(project, configRevision, previous)
          gatewayPrepared = true
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

          // A repository implementation may commit the pointer and lose the
          // response. Never infer the outcome from the rejected Promise:
          // reconcile the exact target revision plus coordinator commit token
          // before choosing compensation or prepared-row discard.
          let repositoryCommitNoEffect = !repositoryCommitStarted
          if (repositoryCommitStarted && !repositoryCommitted && preparedRevision !== undefined && commitToken !== undefined) {
            try {
              const pointer = await repository.readPointer()
              if (pointer !== null && pointer.revisionId === preparedRevision.revisionId && pointer.commitToken === commitToken) {
                repositoryCommitted = true
              } else if (
                (pointer === null && previous === null)
                || (pointer !== null && pointer.state === 'stable' && previous !== null && pointer.revisionId === previous.revisionId)
              ) {
                repositoryCommitNoEffect = true
              } else {
                compensationErrors.push(new ProjectPublicationV5Error(
                  'PROJECT_COMMIT_OUTCOME_UNKNOWN',
                  'Repository commit rejected without a reconcilable exact durable pointer.',
                ))
              }
            } catch (reconciliationError) {
              compensationErrors.push(new ProjectPublicationV5Error(
                'PROJECT_COMMIT_OUTCOME_UNKNOWN',
                'Repository commit rejected and durable pointer reconciliation failed.',
                reconciliationError,
              ))
            }
          }

          let gatewayRollback: ProjectV5GatewayRollbackDispositionV1 | undefined
          if (gatewayPrepared) {
            await compensate(async () => { gatewayRollback = await gateway.rollback(preparedGateway as PreparedGateway) })
          }
          if (gatewayActivationAttempted && previous === null && gatewayRollback === 'candidate-deactivated') {
            await compensate(async () => {
              assertGatewayInactiveStatus(await gateway.readStatus())
            })
          }
          if (runtimeTransition !== undefined) {
            await compensate(() => runtimeTransition!.rollback())
          } else if (runtimePrepared) {
            await compensate(() => runtime.rollback(preparedRuntime as PreparedRuntime))
          }
          if (repositoryCommitted) {
            await compensate(() => repository.compensatePublication(commitToken!))
          } else if (preparedRevision !== undefined && repositoryCommitNoEffect) {
            await compensate(() => repository.discardPreparedRevision(preparedRevision!))
          }
          if (gatewayActivationAttempted && previous !== null && gatewayRollback === 'candidate-deactivated') {
            await compensate(async () => {
              assertGatewayStatus(await gateway.reactivate(previous), previous)
              assertGatewayStatus(await gateway.readStatus(), previous)
            })
          }
          enterRecovery(compensationErrors)
          throw error
        }

        notifyPublished()
        retainCleanupTask('runtime-transition-finalize', next.revisionId, () => runtimeTransition!.finalize())
        if (previous !== null && !samePublishedPublication(previous, next)) {
          retainCleanupTask('gateway-previous', previous.revisionId, () => gateway.cleanupPrevious(previous))
        }
        retainCleanupTask('repository-garbage-collection', next.revisionId, () => repository.garbageCollect())
        void kickCleanupDrain()
        return publicPublished(next.project, next.revisionId, next.configRevision)
      })
    },

    hydrate() {
      return enqueue(async () => {
        if (published !== null) return publicPublished(published.project, published.revisionId, published.configRevision)
        requireEditable()
        const pointer = await readHydrationPointer()
        if (pointer === null) {
          let deactivation: ProjectV5RuntimeCommitTransitionV5 | undefined
          try {
            // A null durable pointer owns no Gateway authority.  Treat an
            // active/deactivating/recovery-required Gateway as a concurrent
            // publisher or recovery race; never issue an unconditional delete.
            assertGatewayInactiveStatus(await gateway.readStatus())
            deactivation = await runtime.deactivate()
            assertGatewayInactiveStatus(await gateway.readStatus())
            await requireExactPointer(null)
          } catch (error) {
            const rollbackErrors: unknown[] = []
            if (deactivation !== undefined) {
              try { await deactivation.rollback() } catch (rollbackError) { rollbackErrors.push(rollbackError) }
            }
            enterRecovery([error, ...rollbackErrors])
            throw error
          }
          notifyPublished()
          retainCleanupTask('runtime-transition-finalize', 'empty', () => deactivation!.finalize())
          void kickCleanupDrain()
          return null
        }

        let previous: PublishedProjectV5 | null = null
        if (pointer.state === 'publishing' && pointer.previousRevisionId !== null) {
          try {
            previous = await loadDurablePublication(pointer.previousRevisionId)
          } catch (error) {
            enterRecovery([error])
            throw error
          }
        }

        const rollbackActivation = async (
          activation: Awaited<ReturnType<typeof restoreRuntimeAndGateway>>,
          originalError: unknown,
          forceRecovery = false,
        ): Promise<never> => {
          const rollbackErrors = await rollbackHydratedRuntimeAndGateway(activation)
          if (forceRecovery || rollbackErrors.length > 0) enterRecovery([originalError, ...rollbackErrors])
          throw originalError
        }

        const restoreCompensatedPrevious = async (
          interrupted: Extract<StoredProjectPointerV5, { readonly state: 'publishing' }>,
          prior: PublishedProjectV5,
          originalError: unknown,
        ): Promise<PublishedProjectV5> => {
          try {
            await requireExactPointer(interrupted)
            await repository.compensatePublication(interrupted.commitToken)
            const stablePrevious: StoredProjectPointerV5 = {
              key: 'active', state: 'stable', revisionId: interrupted.previousRevisionId!, commitToken: interrupted.previousCommitToken!,
            }
            await requireExactPointer(stablePrevious)
            const activation = await restoreRuntimeAndGateway(prior)
            try {
              await requireExactPointer(stablePrevious)
            } catch (error) {
              return rollbackActivation(activation, error)
            }
            published = prior
            notifyPublished()
            retainCleanupTask('runtime-transition-finalize', prior.revisionId, () => activation.runtimeTransition.finalize())
            retainCleanupTask('repository-garbage-collection', prior.revisionId, () => repository.garbageCollect())
            void kickCleanupDrain()
            return publicPublished(prior.project, prior.revisionId, prior.configRevision)
          } catch (compensationError) {
            enterRecovery([originalError, compensationError])
            throw originalError
          }
        }

        let next: PublishedProjectV5
        try {
          next = await loadDurablePublication(pointer.revisionId)
        } catch (error) {
          if (pointer.state === 'publishing' && previous !== null) {
            return restoreCompensatedPrevious(pointer, previous, error)
          }
          enterRecovery([error])
          throw error
        }

        let activation: Awaited<ReturnType<typeof restoreRuntimeAndGateway>>
        try {
          activation = await restoreRuntimeAndGateway(next)
        } catch (error) {
          if (pointer.state === 'publishing' && previous !== null) {
            return restoreCompensatedPrevious(pointer, previous, error)
          }
          if (pointer.state === 'publishing') enterRecovery([error])
          throw error
        }

        try {
          await requireExactPointer(pointer)
        } catch (error) {
          return rollbackActivation(activation, error)
        }

        if (pointer.state === 'publishing') {
          try {
            await repository.finalizePublication(pointer.commitToken)
            const stableTarget: StoredProjectPointerV5 = {
              key: 'active', state: 'stable', revisionId: pointer.revisionId, commitToken: pointer.commitToken,
            }
            await requireExactPointer(stableTarget)
          } catch (error) {
            await rollbackActivation(activation, error, true)
          }
        }

        published = next
        notifyPublished()
        retainCleanupTask('runtime-transition-finalize', next.revisionId, () => activation.runtimeTransition.finalize())
        if (previous !== null && !samePublishedPublication(previous, next)) {
          retainCleanupTask('gateway-previous', previous.revisionId, () => gateway.cleanupPrevious(previous!))
        }
        retainCleanupTask('repository-garbage-collection', next.revisionId, () => repository.garbageCollect())
        void kickCleanupDrain()
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

    readRecoveryError() {
      return recoveryError
    },

    readCleanupStatus() {
      return cleanupStatus()
    },

    retryCleanup() {
      return retryCleanup()
    },
  }
  return Object.freeze(coordinator)
}
