import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  PROJECT_HASH_CHUNK_BYTES,
  createProjectHashService,
  createProjectRevisionIdentityHasher,
  createProjectSourceDigest,
  type ProjectHashWorker,
  type Sha256WorkerRequest,
  type Sha256WorkerResponse,
} from './sha256'
import { createSha256WorkerSession } from './sha256-worker'

const encoder = new TextEncoder()

class IncrementalFakeWorker implements ProjectHashWorker {
  onmessage: ((event: MessageEvent<unknown>) => void) | null = null
  onerror: ((event: ErrorEvent) => void) | null = null
  onmessageerror: ((event: MessageEvent<unknown>) => void) | null = null
  terminated = false
  inFlight = 0
  maxInFlight = 0
  maxTransferredBytes = 0

  readonly #session = createSha256WorkerSession((response) => {
    queueMicrotask(() => {
      this.inFlight -= 1
      this.onmessage?.({ data: response } as MessageEvent<Sha256WorkerResponse>)
    })
  })

  postMessage(message: Sha256WorkerRequest, transfer?: Transferable[]): void {
    this.inFlight += 1
    this.maxInFlight = Math.max(this.maxInFlight, this.inFlight)
    const transferredBytes = transfer?.reduce<number>(
      (total, entry) => total + (entry instanceof ArrayBuffer ? entry.byteLength : 0),
      0,
    ) ?? 0
    this.maxTransferredBytes = Math.max(this.maxTransferredBytes, transferredBytes)
    this.#session.handle(message)
  }

  terminate(): void {
    this.terminated = true
  }
}

class SilentWorker implements ProjectHashWorker {
  onmessage: ((event: MessageEvent<unknown>) => void) | null = null
  onerror: ((event: ErrorEvent) => void) | null = null
  onmessageerror: ((event: MessageEvent<unknown>) => void) | null = null
  terminated = false

  postMessage(): void {}

  terminate(): void {
    this.terminated = true
  }

  emitLateAck(): void {
    this.onmessage?.({
      data: { type: 'initialized', totalBytes: 3 },
    } as MessageEvent<Sha256WorkerResponse>)
  }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('ProjectHashService', () => {
  it.each([
    ['', 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'],
    ['abc', 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'],
  ])('hashes %j identically with Web Crypto and the Worker fallback', async (source, digest) => {
    const bytes = encoder.encode(source)
    const native = createProjectHashService({ subtle: globalThis.crypto.subtle })
    const fallback = createProjectHashService({
      subtle: undefined,
      workerFactory: () => new IncrementalFakeWorker(),
    })

    expect(await native.sha256(bytes)).toBe(digest)
    expect(await fallback.sha256(bytes)).toBe(digest)
    expect([...bytes]).toEqual([...encoder.encode(source)])
  })

  it('fails before mutation when trusted-LAN hashing has no Worker', async () => {
    const projectMutationSpy = vi.fn()
    await expect(createProjectHashService({
      subtle: undefined,
      workerFactory: undefined,
    }).sha256(encoder.encode('abc'))).rejects.toMatchObject({
      code: 'PROJECT_HASH_WORKER_UNAVAILABLE',
    })
    expect(projectMutationSpy).not.toHaveBeenCalled()
  })

  it('terminates a silent Worker at exactly 60 seconds and ignores its late acknowledgement', async () => {
    vi.useFakeTimers()
    const worker = new SilentWorker()
    const pending = createProjectHashService({
      subtle: undefined,
      workerFactory: () => worker,
    }).sha256(encoder.encode('abc'))
    const rejection = expect(pending).rejects.toMatchObject({ code: 'PROJECT_HASH_TIMEOUT' })

    await vi.advanceTimersByTimeAsync(59_999)
    expect(worker.terminated).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    await rejection
    expect(worker.terminated).toBe(true)
    expect(() => worker.emitLateAck()).not.toThrow()
  })

  it('terminates and rejects cancellation well inside 250 ms', async () => {
    const worker = new SilentWorker()
    const controller = new AbortController()
    const pending = createProjectHashService({
      subtle: undefined,
      workerFactory: () => worker,
    }).sha256(encoder.encode('abc'), controller.signal)
    const startedAt = performance.now()
    controller.abort()
    await expect(pending).rejects.toMatchObject({ code: 'PROJECT_HASH_CANCELLED' })
    expect(performance.now() - startedAt).toBeLessThan(250)
    expect(worker.terminated).toBe(true)
  })

  it('keeps one fixed-size transferable chunk in flight', async () => {
    const worker = new IncrementalFakeWorker()
    const bytes = new Uint8Array(PROJECT_HASH_CHUNK_BYTES * 2 + 17)
    bytes.set([1, 2, 3], bytes.length - 3)

    await createProjectHashService({
      subtle: undefined,
      workerFactory: () => worker,
    }).sha256(bytes)

    expect(worker.maxInFlight).toBe(1)
    expect(worker.maxTransferredBytes).toBe(PROJECT_HASH_CHUNK_BYTES)
    expect(worker.maxTransferredBytes).toBeLessThan(8 * 1024 * 1024)
  })

  it.each([
    [25, '394c345f0b0c63ee652627a62eed069244d35c4d5134e4f07d4eabb51afda47e'],
    [50, '8565a714dca840f8652c5bae9249ab05f5fb5a4f9f13fbe23304b10f68252da2'],
    [100, '20492a4d0d84f8beb1767f6616229f85d44c2827b64bdbfb260ee12fa1109e0e'],
    [256, 'a6d72ac7690f53be6ae46ba88506bd97302a093f7108472bd9efc3cefda06484'],
  ])(
    'hashes the actual %d MiB zero-byte source digest vector through the Worker fallback',
    async (sizeMiB, expectedDigest) => {
      const bytes = new Uint8Array(sizeMiB * 1024 * 1024)
      const fallback = createProjectHashService({
        subtle: undefined,
        workerFactory: () => new IncrementalFakeWorker(),
      })

      expect(await fallback.sha256(bytes)).toBe(expectedDigest)
      expect(bytes[0]).toBe(0)
      expect(bytes.at(-1)).toBe(0)
    },
    65_000,
  )

  it('fails closed on a malformed acknowledgement', async () => {
    const worker = new SilentWorker()
    worker.postMessage = () => queueMicrotask(() => worker.onmessage?.({
      data: { type: 'chunk-ack', sequence: 99, receivedBytes: 0 },
    } as MessageEvent<unknown>))
    await expect(createProjectHashService({
      subtle: undefined,
      workerFactory: () => worker,
    }).sha256(encoder.encode('abc'))).rejects.toMatchObject({
      code: 'PROJECT_HASH_WORKER_FAILED',
    })
    expect(worker.terminated).toBe(true)
  })

  it('exports distinct source and revision hashing adapters', async () => {
    const sha256 = vi.fn(async () => 'a'.repeat(64))
    const service = { sha256 }
    const source = createProjectSourceDigest(service)
    const revision = createProjectRevisionIdentityHasher(service)

    expect(source).not.toBe(revision)
    await source.digestSource(encoder.encode('source'))
    await revision.hashRevisionIdentity(encoder.encode('revision'))
    expect(sha256).toHaveBeenCalledTimes(2)
  })
})
