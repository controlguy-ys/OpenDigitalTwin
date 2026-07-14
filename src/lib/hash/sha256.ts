import {
  SHA256_WORKER_CHUNK_BYTES,
  type Sha256WorkerRequest,
  type Sha256WorkerResponse,
} from './sha256-worker'
export type { Sha256WorkerRequest, Sha256WorkerResponse }

export const PROJECT_HASH_CHUNK_BYTES = SHA256_WORKER_CHUNK_BYTES
export const PROJECT_HASH_TIMEOUT_MS = 60_000

const HEX_SHA256 = /^[0-9a-f]{64}$/
const ARRAY_BUFFER_BYTE_LENGTH_GETTER = Object.getOwnPropertyDescriptor(
  ArrayBuffer.prototype,
  'byteLength',
)?.get

export interface ProjectHashWorker {
  onmessage: ((event: MessageEvent<unknown>) => void) | null
  onerror: ((event: ErrorEvent) => void) | null
  onmessageerror: ((event: MessageEvent<unknown>) => void) | null
  postMessage(message: Sha256WorkerRequest, transfer?: Transferable[]): void
  terminate(): void
}

export interface ProjectHashService {
  sha256(bytes: ArrayBuffer | ArrayBufferView, signal?: AbortSignal): Promise<string>
}

export interface ProjectSourceDigest {
  digestSource(bytes: ArrayBuffer | ArrayBufferView, signal?: AbortSignal): Promise<string>
}

export interface ProjectRevisionIdentityHasher {
  hashRevisionIdentity(bytes: ArrayBuffer | ArrayBufferView, signal?: AbortSignal): Promise<string>
}

export interface ProjectHashServiceOptions {
  readonly subtle?: SubtleCrypto | undefined
  readonly workerFactory?: (() => ProjectHashWorker) | undefined
}

export class ProjectHashError extends Error {
  readonly code: string

  constructor(code: string, message: string, cause?: unknown) {
    super(`${code}: ${message}`, cause === undefined ? undefined : { cause })
    this.name = 'ProjectHashError'
    this.code = code
  }
}

function arrayBufferByteLength(value: object): number | undefined {
  try {
    return ARRAY_BUFFER_BYTE_LENGTH_GETTER?.call(value) as number | undefined
  } catch {
    return undefined
  }
}

function inputView(bytes: ArrayBuffer | ArrayBufferView): Uint8Array<ArrayBuffer> {
  if (ArrayBuffer.isView(bytes)) {
    if (arrayBufferByteLength(bytes.buffer) === undefined) {
      throw new ProjectHashError('PROJECT_HASH_INPUT_INVALID', 'Shared buffers are not supported.')
    }
    return new Uint8Array(bytes.buffer as ArrayBuffer, bytes.byteOffset, bytes.byteLength)
  }
  if (typeof bytes !== 'object' || bytes === null || arrayBufferByteLength(bytes) === undefined) {
    throw new ProjectHashError('PROJECT_HASH_INPUT_INVALID', 'Hash input must be an ArrayBuffer or view.')
  }
  return new Uint8Array(bytes as ArrayBuffer)
}

function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer), (byte) =>
    byte.toString(16).padStart(2, '0')).join('')
}

function exactRecord(
  value: unknown,
  keys: readonly string[],
): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const ownKeys = Reflect.ownKeys(value)
  if (
    ownKeys.length !== keys.length ||
    ownKeys.some((key) => typeof key !== 'string' || !keys.includes(key))
  ) {
    return false
  }
  return keys.every((key) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    return descriptor !== undefined && 'value' in descriptor
  })
}

export function sha256ChunkRanges(
  totalBytes: number,
): readonly { readonly offset: number; readonly length: number }[] {
  if (!Number.isSafeInteger(totalBytes) || totalBytes < 0) {
    throw new ProjectHashError(
      'PROJECT_HASH_INPUT_INVALID',
      'Hash byte length must be a non-negative safe integer.',
    )
  }
  const ranges: { offset: number; length: number }[] = []
  for (let offset = 0; offset < totalBytes; offset += PROJECT_HASH_CHUNK_BYTES) {
    ranges.push({
      offset,
      length: Math.min(PROJECT_HASH_CHUNK_BYTES, totalBytes - offset),
    })
  }
  return ranges
}

function cancelledError(): ProjectHashError {
  return new ProjectHashError('PROJECT_HASH_CANCELLED', 'SHA-256 hashing was cancelled.')
}

function hashWithNative(
  digest: SubtleCrypto['digest'],
  bytes: Uint8Array<ArrayBuffer>,
  signal: AbortSignal | undefined,
): Promise<string> {
  return new Promise((resolve, reject) => {
    let settled = false
    const finish = (action: () => void): void => {
      if (settled) return
      settled = true
      clearTimeout(watchdog)
      signal?.removeEventListener('abort', onAbort)
      action()
    }
    const onAbort = (): void => finish(() => reject(cancelledError()))
    const watchdog = setTimeout(() => finish(() => reject(new ProjectHashError(
      'PROJECT_HASH_TIMEOUT',
      `SHA-256 hashing exceeded ${PROJECT_HASH_TIMEOUT_MS} ms.`,
    ))), PROJECT_HASH_TIMEOUT_MS)
    signal?.addEventListener('abort', onAbort, { once: true })
    if (signal?.aborted === true) {
      onAbort()
      return
    }
    let pending: Promise<ArrayBuffer>
    try {
      pending = digest('SHA-256', bytes)
    } catch (error) {
      finish(() => reject(new ProjectHashError(
        'PROJECT_HASH_FAILED',
        'Native SHA-256 digest could not start.',
        error,
      )))
      return
    }
    void pending.then(
      (result) => finish(() => {
        const digest = toHex(result)
        if (!HEX_SHA256.test(digest)) {
          reject(new ProjectHashError('PROJECT_HASH_FAILED', 'Native SHA-256 returned an invalid digest.'))
          return
        }
        resolve(digest)
      }),
      (error) => finish(() => reject(new ProjectHashError(
        'PROJECT_HASH_FAILED',
        'Native SHA-256 digest failed.',
        error,
      ))),
    )
  })
}

function hashWithWorker(
  workerFactory: (() => ProjectHashWorker) | undefined,
  bytes: Uint8Array<ArrayBuffer>,
  signal: AbortSignal | undefined,
): Promise<string> {
  return new Promise((resolve, reject) => {
    let worker: ProjectHashWorker | undefined
    let settled = false
    let phase: 'init' | 'chunk' | 'final' = 'init'
    let nextOffset = 0
    let nextSequence = 0
    let expectedSequence = -1
    let expectedReceivedBytes = 0

    const terminate = (): void => {
      try {
        worker?.terminate()
      } catch {
        // Termination is best-effort after the operation has already failed.
      }
    }
    const finish = (action: () => void): void => {
      if (settled) return
      settled = true
      clearTimeout(watchdog)
      signal?.removeEventListener('abort', onAbort)
      terminate()
      action()
    }
    const fail = (code: string, message: string, cause?: unknown): void => {
      finish(() => reject(new ProjectHashError(code, message, cause)))
    }
    const post = (message: Sha256WorkerRequest, transfer?: Transferable[]): boolean => {
      try {
        worker!.postMessage(message, transfer)
        return true
      } catch (error) {
        fail('PROJECT_HASH_WORKER_FAILED', 'SHA-256 Worker postMessage failed.', error)
        return false
      }
    }
    const sendNext = (): void => {
      if (settled) return
      if (nextOffset === bytes.byteLength) {
        phase = 'final'
        post({ type: 'final' })
        return
      }
      const length = Math.min(PROJECT_HASH_CHUNK_BYTES, bytes.byteLength - nextOffset)
      const chunk = bytes.slice(nextOffset, nextOffset + length).buffer
      expectedSequence = nextSequence
      expectedReceivedBytes = nextOffset + length
      phase = 'chunk'
      if (post({ type: 'chunk', sequence: nextSequence, bytes: chunk }, [chunk])) {
        nextSequence += 1
        nextOffset += length
      }
    }
    const onAbort = (): void => {
      if (settled) return
      try {
        worker?.postMessage({ type: 'cancel' })
      } catch {
        // Cancellation still terminates and rejects immediately.
      }
      finish(() => reject(cancelledError()))
    }
    const watchdog = setTimeout(() => fail(
      'PROJECT_HASH_TIMEOUT',
      `SHA-256 hashing exceeded ${PROJECT_HASH_TIMEOUT_MS} ms.`,
    ), PROJECT_HASH_TIMEOUT_MS)
    signal?.addEventListener('abort', onAbort, { once: true })
    if (signal?.aborted === true) {
      onAbort()
      return
    }
    if (workerFactory === undefined) {
      fail('PROJECT_HASH_WORKER_UNAVAILABLE', 'No SHA-256 Worker is available.')
      return
    }
    try {
      worker = workerFactory()
    } catch (error) {
      fail('PROJECT_HASH_WORKER_UNAVAILABLE', 'SHA-256 Worker construction failed.', error)
      return
    }
    if (worker === undefined || worker === null) {
      fail('PROJECT_HASH_WORKER_UNAVAILABLE', 'SHA-256 Worker construction returned no Worker.')
      return
    }
    worker.onerror = (event) => fail(
      'PROJECT_HASH_WORKER_FAILED',
      'SHA-256 Worker emitted an error.',
      event,
    )
    worker.onmessageerror = (event) => fail(
      'PROJECT_HASH_WORKER_FAILED',
      'SHA-256 Worker emitted a messageerror.',
      event,
    )
    worker.onmessage = (event) => {
      if (settled) return
      const response = event.data
      if (
        phase === 'init' &&
        exactRecord(response, ['type', 'totalBytes']) &&
        response.type === 'initialized' &&
        response.totalBytes === bytes.byteLength
      ) {
        sendNext()
        return
      }
      if (
        phase === 'chunk' &&
        exactRecord(response, ['type', 'sequence', 'receivedBytes']) &&
        response.type === 'chunk-ack' &&
        response.sequence === expectedSequence &&
        response.receivedBytes === expectedReceivedBytes
      ) {
        sendNext()
        return
      }
      if (
        phase === 'final' &&
        exactRecord(response, ['type', 'sha256', 'totalBytes']) &&
        response.type === 'digest' &&
        response.totalBytes === bytes.byteLength &&
        typeof response.sha256 === 'string' &&
        HEX_SHA256.test(response.sha256)
      ) {
        finish(() => resolve(response.sha256 as string))
        return
      }
      if (
        exactRecord(response, ['type', 'code', 'message']) &&
        response.type === 'error' &&
        response.code === 'PROJECT_HASH_WORKER_FAILED' &&
        typeof response.message === 'string'
      ) {
        fail('PROJECT_HASH_WORKER_FAILED', response.message)
        return
      }
      fail('PROJECT_HASH_WORKER_FAILED', 'SHA-256 Worker acknowledgement was malformed or out of order.')
    }
    post({ type: 'init', totalBytes: bytes.byteLength })
  })
}

export function createProjectHashService(
  options: ProjectHashServiceOptions = {},
): ProjectHashService {
  const nativeDigest = options.subtle?.digest.bind(options.subtle)
  const workerFactory = options.workerFactory
  return Object.freeze({
    sha256(bytes: ArrayBuffer | ArrayBufferView, signal?: AbortSignal): Promise<string> {
      let view: Uint8Array<ArrayBuffer>
      try {
        view = inputView(bytes)
      } catch (error) {
        return Promise.reject(error)
      }
      return nativeDigest === undefined
        ? hashWithWorker(workerFactory, view, signal)
        : hashWithNative(nativeDigest, view, signal)
    },
  })
}

export function createProjectSourceDigest(
  hashService: ProjectHashService,
): ProjectSourceDigest {
  const sha256 = hashService.sha256.bind(hashService)
  return Object.freeze({
    digestSource(bytes: ArrayBuffer | ArrayBufferView, signal?: AbortSignal): Promise<string> {
      return sha256(bytes, signal)
    },
  })
}

export function createProjectRevisionIdentityHasher(
  hashService: ProjectHashService,
): ProjectRevisionIdentityHasher {
  const sha256 = hashService.sha256.bind(hashService)
  return Object.freeze({
    hashRevisionIdentity(bytes: ArrayBuffer | ArrayBufferView, signal?: AbortSignal): Promise<string> {
      return sha256(bytes, signal)
    },
  })
}
