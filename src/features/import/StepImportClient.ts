import type { OcctSuccessResult } from '../../lib/cad/occt-types'
import {
  STEP_IMPORT_OPTIONS,
  type StepWorkerRequest,
  type StepWorkerResponse,
} from './step-worker-protocol'

export interface StepImportWorker {
  onmessage: ((event: MessageEvent<StepWorkerResponse>) => void) | null
  onerror: ((event: ErrorEvent) => void) | null
  onmessageerror: ((event: MessageEvent<unknown>) => void) | null
  postMessage(message: StepWorkerRequest, transfer: Transferable[]): void
  terminate(): void
}

interface ActiveImport {
  resolve: (result: OcctSuccessResult) => void
  reject: (error: Error | DOMException) => void
}

function copySourceBytes(source: ArrayBuffer | Uint8Array): ArrayBuffer {
  if (source instanceof Uint8Array) {
    return source.buffer.slice(
      source.byteOffset,
      source.byteOffset + source.byteLength,
    ) as ArrayBuffer
  }

  return source.slice(0)
}

function abortError(): DOMException {
  return new DOMException('STEP import was cancelled.', 'AbortError')
}

export class StepImportClient {
  private readonly createWorker: () => StepImportWorker
  private worker: StepImportWorker | null = null
  private active: ActiveImport | null = null
  private disposed = false

  constructor(createWorker: () => StepImportWorker) {
    this.createWorker = createWorker
  }

  import(source: ArrayBuffer | Uint8Array): Promise<OcctSuccessResult> {
    if (this.disposed) {
      return Promise.reject(new Error('STEP import client has been disposed.'))
    }
    if (this.active !== null) {
      return Promise.reject(new Error('A STEP import is already in progress.'))
    }

    const worker = this.worker ?? this.openWorker()
    const transferableBuffer = copySourceBytes(source)
    const request: StepWorkerRequest = {
      kind: 'import-step',
      bytes: new Uint8Array(transferableBuffer),
      options: STEP_IMPORT_OPTIONS,
    }

    return new Promise<OcctSuccessResult>((resolve, reject) => {
      this.active = { resolve, reject }
      try {
        worker.postMessage(request, [transferableBuffer])
      } catch (error) {
        this.active = null
        reject(
          error instanceof Error
            ? error
            : new Error('Unable to send STEP bytes to the import worker.'),
        )
      }
    })
  }

  cancel(): void {
    const active = this.active
    if (active === null) {
      return
    }

    this.active = null
    this.closeWorker()
    active.reject(abortError())
  }

  dispose(): void {
    if (this.disposed) {
      return
    }

    this.disposed = true
    if (this.active !== null) {
      const active = this.active
      this.active = null
      this.closeWorker()
      active.reject(abortError())
      return
    }

    this.closeWorker()
  }

  private openWorker(): StepImportWorker {
    const worker = this.createWorker()
    worker.onmessage = (event) => {
      if (worker !== this.worker) {
        return
      }

      const active = this.active
      if (active === null) {
        return
      }
      this.active = null

      if (event.data.kind === 'error') {
        active.reject(new Error(event.data.message))
        return
      }
      if (event.data.result.success !== true) {
        active.reject(new Error('OCCT could not parse this STEP file.'))
        return
      }

      active.resolve(event.data.result)
    }
    worker.onerror = (event) => {
      this.rejectWorkerFailure(
        worker,
        new Error(event.message || 'The STEP import worker failed.'),
      )
    }
    worker.onmessageerror = () => {
      this.rejectWorkerFailure(
        worker,
        new Error('The STEP import worker returned an unreadable message.'),
      )
    }
    this.worker = worker
    return worker
  }

  private rejectWorkerFailure(worker: StepImportWorker, error: Error): void {
    if (worker !== this.worker) {
      return
    }

    const active = this.active
    this.active = null
    this.closeWorker()
    active?.reject(error)
  }

  private closeWorker(): void {
    const worker = this.worker
    this.worker = null
    if (worker === null) {
      return
    }

    worker.onmessage = null
    worker.onerror = null
    worker.onmessageerror = null
    worker.terminate()
  }
}

export const stepImportClient = new StepImportClient(
  () =>
    new Worker(new URL('./step-import.worker.ts', import.meta.url), {
      type: 'module',
    }),
)
