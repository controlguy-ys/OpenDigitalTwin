import {
  validateCollisionValidationRequest,
  validateCollisionValidationWorkerEvent,
  type CollisionValidationProgress,
  type CollisionValidationRequest,
  type CollisionValidationResult,
  type CollisionValidationWorkerCommand,
} from './collision-validation-protocol'

type WorkerEventEnvelope = { readonly data?: unknown; readonly message?: string }
type WorkerListener = (event: WorkerEventEnvelope) => void

export interface CollisionValidationWorkerLike {
  addEventListener(type: 'message' | 'error', listener: WorkerListener): void
  removeEventListener(type: 'message' | 'error', listener: WorkerListener): void
  postMessage(message: unknown): void
  terminate(): void
}

export interface CollisionValidationOptions {
  readonly onProgress?: (progress: CollisionValidationProgress) => void
  readonly getCurrentRevision?: () => string
}

interface ActiveValidation {
  readonly request: CollisionValidationRequest
  readonly options: CollisionValidationOptions
  readonly resolve: (result: CollisionValidationResult) => void
  readonly reject: (error: Error) => void
  latestProcessedSamples: number
  latestProgressRatio: number
}

export class CollisionValidationCancelledError extends Error {
  constructor() {
    super('Collision validation was cancelled.')
    this.name = 'CollisionValidationCancelledError'
  }
}

export class StaleCollisionValidationResultError extends Error {
  constructor() {
    super('Collision validation result is stale.')
    this.name = 'StaleCollisionValidationResultError'
  }
}

function defaultWorkerFactory(): CollisionValidationWorkerLike {
  return new Worker(
    new URL('./collision-validation.worker.ts', import.meta.url),
    { type: 'module' },
  ) as unknown as CollisionValidationWorkerLike
}

export class CollisionValidationClient {
  private readonly workerFactory: () => CollisionValidationWorkerLike
  private worker: CollisionValidationWorkerLike | null = null
  private active: ActiveValidation | null = null

  constructor(
    workerFactory: () => CollisionValidationWorkerLike = defaultWorkerFactory,
  ) {
    this.workerFactory = workerFactory
  }

  validate(
    candidate: CollisionValidationRequest,
    options: CollisionValidationOptions = {},
  ): Promise<CollisionValidationResult> {
    if (this.active !== null) {
      throw new Error('A collision validation run is already active.')
    }
    const request = validateCollisionValidationRequest(candidate)
    const worker = this.ensureWorker()
    return new Promise<CollisionValidationResult>((resolve, reject) => {
      this.active = {
        request,
        options,
        resolve,
        reject,
        latestProcessedSamples: -1,
        latestProgressRatio: -1,
      }
      const command: CollisionValidationWorkerCommand = {
        type: 'validate',
        request,
      }
      try {
        worker.postMessage(command)
      } catch (error) {
        this.failActive(
          error instanceof Error
            ? error
            : new Error('Unable to start collision validation.'),
        )
        this.resetWorker()
      }
    })
  }

  cancel(): void {
    const active = this.active
    if (active === null) return
    const command: CollisionValidationWorkerCommand = {
      type: 'cancel',
      requestId: active.request.requestId,
    }
    const cancellation = new CollisionValidationCancelledError()
    try {
      this.worker?.postMessage(command)
    } catch {
      this.failActive(cancellation)
      this.resetWorker()
      return
    }
    this.failActive(cancellation)
  }

  dispose(): void {
    if (this.active !== null) {
      this.failActive(new CollisionValidationCancelledError())
    }
    this.resetWorker()
  }

  private readonly handleMessage: WorkerListener = (envelope) => {
    let event
    try {
      event = validateCollisionValidationWorkerEvent(envelope.data)
    } catch (error) {
      this.failActive(
        error instanceof Error
          ? error
          : new Error('Collision validation Worker returned invalid data.'),
      )
      this.resetWorker()
      return
    }

    const active = this.active
    if (active === null) return
    const eventRequestId =
      event.type === 'progress'
        ? event.progress.requestId
        : event.type === 'result'
          ? event.result.requestId
          : event.requestId
    if (eventRequestId !== active.request.requestId) return

    if (event.type === 'progress') {
      const progressRatio = event.progress.totalSamples === 0
        ? 1
        : event.progress.processedSamples / event.progress.totalSamples
      if (
        event.progress.revision !== active.request.revision ||
        event.progress.processedSamples < active.latestProcessedSamples ||
        progressRatio < active.latestProgressRatio
      ) {
        return
      }
      active.latestProcessedSamples = event.progress.processedSamples
      active.latestProgressRatio = progressRatio
      active.options.onProgress?.(event.progress)
      return
    }

    if (event.type === 'cancelled') {
      if (event.revision !== active.request.revision) return
      this.failActive(new CollisionValidationCancelledError())
      return
    }

    if (event.type === 'error') {
      if (event.revision !== active.request.revision) return
      this.failActive(new Error(event.message))
      return
    }

    if (event.result.mode !== active.request.mode) {
      this.failActive(
        new Error('Collision validation result mode does not match the active request.'),
      )
      this.resetWorker()
      return
    }

    const currentRevision =
      active.options.getCurrentRevision?.() ?? active.request.revision
    if (
      event.result.revision !== active.request.revision ||
      currentRevision !== active.request.revision
    ) {
      this.failActive(new StaleCollisionValidationResultError())
      return
    }
    this.active = null
    active.resolve(event.result)
  }

  private readonly handleError: WorkerListener = (event) => {
    this.failActive(
      new Error(event.message?.trim() || 'Collision validation Worker failed.'),
    )
    this.resetWorker()
  }

  private ensureWorker(): CollisionValidationWorkerLike {
    if (this.worker !== null) return this.worker
    const worker = this.workerFactory()
    worker.addEventListener('message', this.handleMessage)
    worker.addEventListener('error', this.handleError)
    this.worker = worker
    return worker
  }

  private failActive(error: Error): void {
    const active = this.active
    if (active === null) return
    this.active = null
    active.reject(error)
  }

  private resetWorker(): void {
    const worker = this.worker
    if (worker === null) return
    worker.removeEventListener('message', this.handleMessage)
    worker.removeEventListener('error', this.handleError)
    worker.terminate()
    this.worker = null
  }
}
