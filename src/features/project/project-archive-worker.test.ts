import { unzipSync, zipSync } from 'fflate'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  PROJECT_ARCHIVE_CHUNK_BYTES,
  PROJECT_ARCHIVE_MAX_AUXILIARY_BYTES,
  PROJECT_ARCHIVE_MAX_CENTRAL_BYTES,
  PROJECT_ARCHIVE_MAX_COMPRESSED_BYTES,
  PROJECT_ARCHIVE_MAX_ENTRIES,
  PROJECT_ARCHIVE_MAX_JSON_ENTRY_BYTES,
  PROJECT_ARCHIVE_TIMEOUT_MS,
  ProjectArchiveCodecWorker,
  createProjectArchiveWorkerSession,
  type ProjectArchiveWorkerLike,
  type ProjectArchiveWorkerRequest,
  type ProjectArchiveWorkerResponse,
} from './project-archive-worker'

class ControlledWorker implements ProjectArchiveWorkerLike {
  onmessage: ((event: MessageEvent<ProjectArchiveWorkerResponse>) => void) | null = null
  onerror: ((event: ErrorEvent) => void) | null = null
  onmessageerror: ((event: MessageEvent<unknown>) => void) | null = null
  readonly requests: ProjectArchiveWorkerRequest[] = []
  terminated = false
  onPost: ((message: ProjectArchiveWorkerRequest) => void) | undefined

  postMessage(message: ProjectArchiveWorkerRequest): void {
    this.requests.push(message)
    this.onPost?.(message)
  }

  emit(data: ProjectArchiveWorkerResponse): void {
    this.onmessage?.({ data } as MessageEvent<ProjectArchiveWorkerResponse>)
  }

  terminate(): void {
    this.terminated = true
  }
}

class SessionWorker implements ProjectArchiveWorkerLike {
  onmessage: ((event: MessageEvent<ProjectArchiveWorkerResponse>) => void) | null = null
  onerror: ((event: ErrorEvent) => void) | null = null
  onmessageerror: ((event: MessageEvent<unknown>) => void) | null = null
  readonly requests: ProjectArchiveWorkerRequest[] = []
  readonly digestChunkSizes: number[] = []
  readonly outputChunkSizes: number[] = []
  private readonly session = createProjectArchiveWorkerSession((response, transfer = []) => {
    if (response.type === 'encode-output') this.outputChunkSizes.push(response.bytes.byteLength)
    const owned = structuredClone(response, { transfer })
    queueMicrotask(() => this.onmessage?.({ data: owned } as MessageEvent<ProjectArchiveWorkerResponse>))
  })

  postMessage(message: ProjectArchiveWorkerRequest, transfer: Transferable[] = []): void {
    this.requests.push(message)
    if (message.type === 'digest-chunk') {
      this.digestChunkSizes.push(message.bytes.byteLength)
    }
    const owned = structuredClone(message, { transfer })
    queueMicrotask(() => this.session.handle(owned))
  }

  terminate(): void {}
}

class SuppressedExtractWorker implements ProjectArchiveWorkerLike {
  onmessage: ((event: MessageEvent<ProjectArchiveWorkerResponse>) => void) | null = null
  onerror: ((event: ErrorEvent) => void) | null = null
  onmessageerror: ((event: MessageEvent<unknown>) => void) | null = null
  terminated = false
  private readonly session = createProjectArchiveWorkerSession((response, transfer = []) => {
    if (response.type === 'extract-range') return
    const owned = structuredClone(response, { transfer })
    queueMicrotask(() => this.onmessage?.({ data: owned } as MessageEvent<ProjectArchiveWorkerResponse>))
  })

  postMessage(message: ProjectArchiveWorkerRequest, transfer: Transferable[] = []): void {
    const owned = structuredClone(message, { transfer })
    queueMicrotask(() => this.session.handle(owned))
  }

  terminate(): void {
    this.terminated = true
  }
}

function signatureOffset(bytes: Uint8Array, signature: number, start = 0): number {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  for (let offset = start; offset + 4 <= bytes.byteLength; offset += 1) {
    if (view.getUint32(offset, true) === signature) return offset
  }
  throw new Error(`Missing ZIP signature ${signature.toString(16)}.`)
}

function inspectInSession(bytes: Uint8Array): ProjectArchiveWorkerResponse[] {
  const responses: ProjectArchiveWorkerResponse[] = []
  const session = createProjectArchiveWorkerSession((response) => responses.push(response))
  session.handle({
    type: 'inspect-start', generation: 44, totalBytes: bytes.byteLength,
    tailOffset: 0, tailLength: bytes.byteLength,
  })
  session.handle({
    type: 'inspect-chunk', generation: 44, sequence: 0, offset: 0,
    bytes: bytes.slice().buffer, final: true,
  })
  return responses
}

function withCentralExtra(source: Uint8Array, headerId: number, fieldLength: number): Uint8Array {
  const central = signatureOffset(source, 0x02014b50)
  const eocd = signatureOffset(source, 0x06054b50, central)
  const view = new DataView(source.buffer, source.byteOffset, source.byteLength)
  const nameLength = view.getUint16(central + 28, true)
  const insertAt = central + 46 + nameLength
  const result = new Uint8Array(source.byteLength + 4)
  result.set(source.subarray(0, insertAt), 0)
  result.set(source.subarray(insertAt), insertAt + 4)
  const output = new DataView(result.buffer)
  output.setUint16(central + 30, 4, true)
  output.setUint16(insertAt, headerId, true)
  output.setUint16(insertAt + 2, fieldLength, true)
  output.setUint32(eocd + 4 + 12, view.getUint32(eocd + 12, true) + 4, true)
  return result
}

afterEach(() => {
  vi.useRealTimers()
})

describe('Project archive Worker boundary', () => {
  it('freezes the 4 MiB transfer, 120 second watchdog, and 64 MiB auxiliary caps', () => {
    expect(PROJECT_ARCHIVE_CHUNK_BYTES).toBe(4 * 1024 * 1024)
    expect(PROJECT_ARCHIVE_TIMEOUT_MS).toBe(120_000)
    expect(PROJECT_ARCHIVE_MAX_AUXILIARY_BYTES).toBe(64 * 1024 * 1024)
  })

  it('rejects compressed cap plus one before Worker construction', async () => {
    class OversizedBlob extends Blob {
      override get size(): number {
        return PROJECT_ARCHIVE_MAX_COMPRESSED_BYTES + 1
      }
    }
    const workerFactory = vi.fn(() => new ControlledWorker())
    const codec = new ProjectArchiveCodecWorker({ workerFactory })

    await expect(codec.open(new OversizedBlob())).rejects.toMatchObject({
      code: 'PROJECT_ARCHIVE_INVALID',
    })
    expect(workerFactory).not.toHaveBeenCalled()
  })

  it('rejects central workspace cap plus one before allocating its tail', () => {
    const responses: ProjectArchiveWorkerResponse[] = []
    const session = createProjectArchiveWorkerSession((response) => responses.push(response))

    session.handle({
      type: 'inspect-start',
      generation: 1,
      totalBytes: PROJECT_ARCHIVE_MAX_CENTRAL_BYTES + 1,
      tailOffset: 0,
      tailLength: PROJECT_ARCHIVE_MAX_CENTRAL_BYTES + 1,
    })

    expect(responses.at(-1)).toEqual(expect.objectContaining({ type: 'error' }))
  })

  it('rejects a non-final inspect chunk that is not exactly 4 MiB', () => {
    const responses: ProjectArchiveWorkerResponse[] = []
    const session = createProjectArchiveWorkerSession((response) => responses.push(response))
    session.handle({
      type: 'inspect-start',
      generation: 1,
      totalBytes: PROJECT_ARCHIVE_CHUNK_BYTES * 2,
      tailOffset: 0,
      tailLength: PROJECT_ARCHIVE_CHUNK_BYTES * 2,
    })
    session.handle({
      type: 'inspect-chunk',
      generation: 1,
      sequence: 0,
      offset: 0,
      bytes: new ArrayBuffer(1),
      final: false,
    })

    expect(responses.at(-1)).toEqual(expect.objectContaining({
      type: 'error',
      code: 'PROJECT_ARCHIVE_WORKER_FAILED',
    }))
  })

  it('rejects malformed or out-of-order inspect chunks', () => {
    const responses: ProjectArchiveWorkerResponse[] = []
    const session = createProjectArchiveWorkerSession((response) => responses.push(response))
    session.handle({
      type: 'inspect-start',
      generation: 4,
      totalBytes: 22,
      tailOffset: 0,
      tailLength: 22,
    })
    session.handle({
      type: 'inspect-chunk',
      generation: 4,
      sequence: 1,
      offset: 0,
      bytes: new ArrayBuffer(22),
      final: true,
    })

    expect(responses.at(-1)).toEqual(expect.objectContaining({ type: 'error' }))
  })

  it.each([
    ['EOCD trailing data', (bytes: Uint8Array) => {
      const result = new Uint8Array(bytes.byteLength + 1)
      result.set(bytes)
      return result
    }],
    ['multi-disk EOCD', (bytes: Uint8Array) => {
      const result = bytes.slice()
      new DataView(result.buffer).setUint16(signatureOffset(result, 0x06054b50) + 4, 1, true)
      return result
    }],
    ['ZIP64 EOCD entry count', (bytes: Uint8Array) => {
      const result = bytes.slice()
      new DataView(result.buffer).setUint16(signatureOffset(result, 0x06054b50) + 10, 0xffff, true)
      return result
    }],
    ['ZIP64 EOCD central size', (bytes: Uint8Array) => {
      const result = bytes.slice()
      new DataView(result.buffer).setUint32(signatureOffset(result, 0x06054b50) + 12, 0xffffffff, true)
      return result
    }],
    ['ZIP64 EOCD central offset', (bytes: Uint8Array) => {
      const result = bytes.slice()
      new DataView(result.buffer).setUint32(signatureOffset(result, 0x06054b50) + 16, 0xffffffff, true)
      return result
    }],
    ['ZIP64 central compressed size', (bytes: Uint8Array) => {
      const result = bytes.slice()
      new DataView(result.buffer).setUint32(signatureOffset(result, 0x02014b50) + 20, 0xffffffff, true)
      return result
    }],
    ['ZIP64 central expanded size', (bytes: Uint8Array) => {
      const result = bytes.slice()
      new DataView(result.buffer).setUint32(signatureOffset(result, 0x02014b50) + 24, 0xffffffff, true)
      return result
    }],
    ['ZIP64 central local offset', (bytes: Uint8Array) => {
      const result = bytes.slice()
      new DataView(result.buffer).setUint32(signatureOffset(result, 0x02014b50) + 42, 0xffffffff, true)
      return result
    }],
    ['ZIP64 extra field', (bytes: Uint8Array) => withCentralExtra(bytes, 0x0001, 0)],
    ['malformed extra field', (bytes: Uint8Array) => withCentralExtra(bytes, 0x0002, 2)],
    ['encrypted entry', (bytes: Uint8Array) => {
      const result = bytes.slice()
      const central = signatureOffset(result, 0x02014b50)
      const view = new DataView(result.buffer)
      view.setUint16(central + 8, view.getUint16(central + 8, true) | 1, true)
      return result
    }],
    ['unsupported flags', (bytes: Uint8Array) => {
      const result = bytes.slice()
      const central = signatureOffset(result, 0x02014b50)
      const view = new DataView(result.buffer)
      view.setUint16(central + 8, view.getUint16(central + 8, true) | 0x10, true)
      return result
    }],
    ['unsupported method', (bytes: Uint8Array) => {
      const result = bytes.slice()
      new DataView(result.buffer).setUint16(signatureOffset(result, 0x02014b50) + 10, 12, true)
      return result
    }],
    ['control-character path', (bytes: Uint8Array) => {
      const result = bytes.slice()
      result[signatureOffset(result, 0x02014b50) + 46] = 1
      return result
    }],
    ['unsafe traversal path', (bytes: Uint8Array) => {
      const result = bytes.slice()
      const name = signatureOffset(result, 0x02014b50) + 46
      result.set(new TextEncoder().encode('../'), name)
      return result
    }],
    ['malformed central comment', (bytes: Uint8Array) => {
      const result = bytes.slice()
      new DataView(result.buffer).setUint16(signatureOffset(result, 0x02014b50) + 32, 1, true)
      return result
    }],
    ['out-of-range local span', (bytes: Uint8Array) => {
      const result = bytes.slice()
      const central = signatureOffset(result, 0x02014b50)
      new DataView(result.buffer).setUint32(central + 42, central, true)
      return result
    }],
    ['oversized JSON entry', (bytes: Uint8Array) => {
      const result = bytes.slice()
      new DataView(result.buffer).setUint32(
        signatureOffset(result, 0x02014b50) + 24,
        8 * 1024 * 1024 + 1,
        true,
      )
      return result
    }],
  ] as const)('rejects %s during central preflight', (_name, mutate) => {
    const source = zipSync({ 'abc': new Uint8Array([1]) })
    const responses = inspectInSession(mutate(source))

    expect(responses.at(-1)).toEqual(expect.objectContaining({ type: 'error' }))
    expect(responses.some(({ type }) => type === 'central-ready')).toBe(false)
  })

  it('rejects duplicate paths and overlapping local spans during central preflight', () => {
    const duplicate = zipSync({ 'a': new Uint8Array([1]), 'b': new Uint8Array([2]) })
    const firstCentral = signatureOffset(duplicate, 0x02014b50)
    const secondCentral = signatureOffset(duplicate, 0x02014b50, firstCentral + 4)
    duplicate[secondCentral + 46] = 'a'.charCodeAt(0)
    expect(inspectInSession(duplicate).at(-1)).toEqual(expect.objectContaining({ type: 'error' }))

    const overlap = zipSync({ 'a': new Uint8Array([1]), 'b': new Uint8Array([2]) })
    const overlapFirst = signatureOffset(overlap, 0x02014b50)
    const overlapSecond = signatureOffset(overlap, 0x02014b50, overlapFirst + 4)
    new DataView(overlap.buffer).setUint32(overlapSecond + 42, 0, true)
    expect(inspectInSession(overlap).at(-1)).toEqual(expect.objectContaining({ type: 'error' }))
  })

  it.each([
    ['robot/source.step', 25 * 1024 * 1024],
    ['objects/source.step', 50 * 1024 * 1024],
  ] as const)('rejects %s per-source cap plus one before expansion', (path, limit) => {
    const archive = zipSync({ [path]: new Uint8Array([1]) })
    const central = signatureOffset(archive, 0x02014b50)
    new DataView(archive.buffer).setUint32(central + 24, limit + 1, true)

    expect(inspectInSession(archive).at(-1)).toEqual(expect.objectContaining({ type: 'error' }))
  })

  it('terminates and rejects cancellation within 250 ms', async () => {
    vi.useFakeTimers()
    const worker = new ControlledWorker()
    const codec = new ProjectArchiveCodecWorker({ workerFactory: () => worker })
    const controller = new AbortController()
    const pending = codec.open(new Blob([new Uint8Array(22)]), controller.signal)

    controller.abort()
    await expect(pending).rejects.toMatchObject({ code: 'PROJECT_ARCHIVE_CANCELLED' })
    expect(worker.terminated).toBe(true)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('uses the exact 120,000 ms watchdog and rejects a silent Worker', async () => {
    vi.useFakeTimers()
    const worker = new ControlledWorker()
    const codec = new ProjectArchiveCodecWorker({ workerFactory: () => worker })
    const pending = codec.open(new Blob([new Uint8Array(22)]))
    const observed = expect(pending).rejects.toMatchObject({ code: 'PROJECT_ARCHIVE_TIMEOUT' })

    await vi.advanceTimersByTimeAsync(PROJECT_ARCHIVE_TIMEOUT_MS - 1)
    expect(worker.terminated).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    await observed
    expect(worker.terminated).toBe(true)
  })

  it('rejects postMessage throws, Worker errors, and messageerror transport failures', async () => {
    const throwing = new ControlledWorker()
    throwing.onPost = () => { throw new Error('post failed') }
    await expect(new ProjectArchiveCodecWorker({ workerFactory: () => throwing })
      .open(new Blob([new Uint8Array(22)]))).rejects.toMatchObject({
      code: 'PROJECT_ARCHIVE_WORKER_FAILED',
    })

    const errored = new ControlledWorker()
    const errorPending = new ProjectArchiveCodecWorker({ workerFactory: () => errored })
      .open(new Blob([new Uint8Array(22)]))
    errored.onerror?.({ message: 'worker crashed' } as ErrorEvent)
    await expect(errorPending).rejects.toMatchObject({ code: 'PROJECT_ARCHIVE_WORKER_FAILED' })

    const messageErrored = new ControlledWorker()
    const messagePending = new ProjectArchiveCodecWorker({ workerFactory: () => messageErrored })
      .open(new Blob([new Uint8Array(22)]))
    messageErrored.onmessageerror?.({ data: null } as MessageEvent<unknown>)
    await expect(messagePending).rejects.toMatchObject({ code: 'PROJECT_ARCHIVE_WORKER_FAILED' })
  })

  it('cancels silent digest and encode operations synchronously', async () => {
    for (const operation of ['digest', 'encode'] as const) {
      const worker = new ControlledWorker()
      const controller = new AbortController()
      const codec = new ProjectArchiveCodecWorker({ workerFactory: () => worker })
      const pending = operation === 'digest'
        ? codec.digestSources([{ key: 'source', bytes: new Uint8Array([1]).buffer }], controller.signal)
        : codec.encode([{
            path: 'manifest.json', bytes: new Uint8Array([1]).buffer, compression: 'store',
          }], controller.signal)

      controller.abort()
      await expect(pending).rejects.toMatchObject({ code: 'PROJECT_ARCHIVE_CANCELLED' })
      expect(worker.terminated).toBe(true)
    }
  })

  it('cancels a stalled extraction and terminates its Worker immediately', async () => {
    const archive = zipSync({ 'manifest.json': new TextEncoder().encode('{}') })
    const worker = new SuppressedExtractWorker()
    const controller = new AbortController()
    const reader = await new ProjectArchiveCodecWorker({ workerFactory: () => worker })
      .open(new Blob([archive.slice().buffer]), controller.signal)
    const pending = reader.readEntry('manifest.json')

    controller.abort()

    await expect(pending).rejects.toMatchObject({ code: 'PROJECT_ARCHIVE_CANCELLED' })
    expect(worker.terminated).toBe(true)
  })

  it('rejects malformed digest and encode acknowledgements', async () => {
    const digestWorker = new ControlledWorker()
    digestWorker.onPost = (message) => {
      if (message.type === 'digest-start') {
        digestWorker.emit({
          type: 'digest-ready', generation: message.generation,
          key: message.key, totalBytes: message.totalBytes,
        })
      } else if (message.type === 'digest-chunk') {
        digestWorker.emit({
          type: 'digest-ack', generation: message.generation, key: message.key,
          sequence: message.sequence + 1, receivedBytes: message.bytes.byteLength,
        })
      }
    }
    await expect(new ProjectArchiveCodecWorker({ workerFactory: () => digestWorker })
      .digestSources([{ key: 'source', bytes: new Uint8Array([1]).buffer }]))
      .rejects.toMatchObject({ code: 'PROJECT_ARCHIVE_WORKER_FAILED' })

    const encodeWorker = new ControlledWorker()
    encodeWorker.onPost = (message) => {
      if (message.type === 'encode-start') {
        encodeWorker.emit({ type: 'encode-ready', generation: message.generation, entryCount: 1 })
      } else if (message.type === 'encode-entry-start') {
        encodeWorker.emit({ type: 'encode-entry-ready', generation: message.generation, index: 0 })
      } else if (message.type === 'encode-chunk') {
        encodeWorker.emit({
          type: 'encode-ack', generation: message.generation, index: 0,
          sequence: 1, receivedBytes: 1,
        })
      }
    }
    await expect(new ProjectArchiveCodecWorker({ workerFactory: () => encodeWorker })
      .encode([{ path: 'manifest.json', bytes: new Uint8Array([1]).buffer, compression: 'store' }]))
      .rejects.toMatchObject({ code: 'PROJECT_ARCHIVE_WORKER_FAILED' })
  })

  it('treats malformed responses as fatal and ignores retired-generation messages', async () => {
    const first = new ControlledWorker()
    const second = new ControlledWorker()
    const workers = [first, second]
    const codec = new ProjectArchiveCodecWorker({ workerFactory: () => workers.shift()! })
    const firstAbort = new AbortController()
    const firstPending = codec.open(new Blob([new Uint8Array(22)]), firstAbort.signal)
    firstAbort.abort()
    await expect(firstPending).rejects.toMatchObject({ code: 'PROJECT_ARCHIVE_CANCELLED' })

    const secondPending = codec.open(new Blob([new Uint8Array(22)]))
    first.emit({
      type: 'central-ready',
      generation: 1,
      entries: [],
      auxiliaryBytes: 0,
    })
    second.emit({
      type: 'central-ready',
      generation: 999,
      entries: [],
      auxiliaryBytes: 0,
    })

    await expect(secondPending).rejects.toMatchObject({
      code: 'PROJECT_ARCHIVE_WORKER_FAILED',
    })
    expect(second.terminated).toBe(true)
  })

  it('rejects forged duplicate central records on the main side', async () => {
    const worker = new ControlledWorker()
    worker.onPost = (message) => {
      if (message.type === 'inspect-start') {
        worker.emit({
          type: 'inspect-ready',
          generation: message.generation,
          tailLength: message.tailLength,
        })
      } else if (message.type === 'inspect-chunk') {
        worker.emit({
          type: 'inspect-ack',
          generation: message.generation,
          sequence: message.sequence,
          receivedBytes: message.bytes.byteLength,
        })
        const record = {
          path: 'manifest.json',
          flags: 0x0800,
          compression: 0 as const,
          crc32: 0,
          compressedSize: 1,
          uncompressedSize: 1,
          localOffset: 0,
          spanEnd: 1,
        }
        worker.emit({
          type: 'central-ready',
          generation: message.generation,
          entries: [record, { ...record }],
          auxiliaryBytes: 128,
        })
      }
    }
    const codec = new ProjectArchiveCodecWorker({ workerFactory: () => worker })

    await expect(codec.open(new Blob([new Uint8Array(22)]))).rejects.toMatchObject({
      code: 'PROJECT_ARCHIVE_WORKER_FAILED',
    })
    expect(worker.terminated).toBe(true)
  })

  it('rejects forged entry-count, aggregate JSON, and aggregate source cap violations', async () => {
    const record = (path: string, index: number, uncompressedSize: number) => ({
      path,
      flags: 0x0800,
      compression: 8 as const,
      crc32: 0,
      compressedSize: 0,
      uncompressedSize,
      localOffset: index,
      spanEnd: index + 1,
    })
    const plans = [
      Array.from({ length: PROJECT_ARCHIVE_MAX_ENTRIES + 1 }, (_, index) =>
        record(`${index}.json`, index, 1)),
      Array.from({ length: 9 }, (_, index) =>
        record(`${index}.json`, index, PROJECT_ARCHIVE_MAX_JSON_ENTRY_BYTES)),
      Array.from({ length: 6 }, (_, index) =>
        record(`objects/assets/${index.toString().padStart(64, '0')}.step`, index, 50 * 1024 * 1024)),
    ]
    for (const entries of plans) {
      const worker = new ControlledWorker()
      worker.onPost = (message) => {
        if (message.type === 'inspect-start') {
          worker.emit({
            type: 'inspect-ready', generation: message.generation,
            tailLength: message.tailLength,
          })
        } else if (message.type === 'inspect-chunk') {
          worker.emit({
            type: 'inspect-ack', generation: message.generation,
            sequence: message.sequence, receivedBytes: message.bytes.byteLength,
          })
          worker.emit({
            type: 'central-ready', generation: message.generation,
            entries, auxiliaryBytes: 0,
          })
        }
      }

      await expect(new ProjectArchiveCodecWorker({ workerFactory: () => worker })
        .open(new Blob([new Uint8Array(2_000)])))
        .rejects.toMatchObject({ code: 'PROJECT_ARCHIVE_WORKER_FAILED' })
      expect(worker.terminated).toBe(true)
    }
  })

  it('rejects a forged central auxiliary measurement above 64 MiB', async () => {
    const worker = new ControlledWorker()
    worker.onPost = (message) => {
      if (message.type === 'inspect-start') {
        worker.emit({
          type: 'inspect-ready', generation: message.generation,
          tailLength: message.tailLength,
        })
      } else if (message.type === 'inspect-chunk') {
        worker.emit({
          type: 'inspect-ack', generation: message.generation,
          sequence: message.sequence, receivedBytes: message.bytes.byteLength,
        })
        worker.emit({
          type: 'central-ready', generation: message.generation,
          entries: [], auxiliaryBytes: PROJECT_ARCHIVE_MAX_AUXILIARY_BYTES + 1,
        })
      }
    }

    await expect(new ProjectArchiveCodecWorker({ workerFactory: () => worker })
      .open(new Blob([new Uint8Array(22)])))
      .rejects.toMatchObject({ code: 'PROJECT_ARCHIVE_WORKER_FAILED' })
  })

  it('extracts one central-indexed entry and verifies its local header and CRC', async () => {
    const manifest = new TextEncoder().encode('{"schemaVersion":3}')
    const archive = zipSync({ 'manifest.json': manifest })
    const codec = new ProjectArchiveCodecWorker({
      workerFactory: () => new SessionWorker(),
    })
    const reader = await codec.open(new Blob([archive.slice().buffer]))

    await expect(reader.readEntry('manifest.json')).resolves.toEqual(
      manifest.slice().buffer,
    )
    reader.close()
  })

  it('rejects a central/local filename conflict before returning entry bytes', async () => {
    const archive = zipSync({ 'manifest.json': new TextEncoder().encode('{}') })
    archive[30] = 'x'.charCodeAt(0)
    const codec = new ProjectArchiveCodecWorker({ workerFactory: () => new SessionWorker() })
    const reader = await codec.open(new Blob([archive.slice().buffer]))

    await expect(reader.readEntry('manifest.json')).rejects.toThrow(/local|name|path/i)
  })

  it.each([
    ['version', (bytes: Uint8Array) => new DataView(bytes.buffer).setUint16(4, 45, true)],
    ['flags', (bytes: Uint8Array) => {
      const view = new DataView(bytes.buffer)
      view.setUint16(6, view.getUint16(6, true) ^ 0x0002, true)
    }],
    ['method', (bytes: Uint8Array) => {
      const view = new DataView(bytes.buffer)
      view.setUint16(8, view.getUint16(8, true) === 0 ? 8 : 0, true)
    }],
    ['CRC', (bytes: Uint8Array) => {
      const view = new DataView(bytes.buffer)
      view.setUint32(14, view.getUint32(14, true) ^ 1, true)
    }],
    ['compressed size', (bytes: Uint8Array) => {
      const view = new DataView(bytes.buffer)
      view.setUint32(18, view.getUint32(18, true) + 1, true)
    }],
    ['expanded size', (bytes: Uint8Array) => {
      const view = new DataView(bytes.buffer)
      view.setUint32(22, view.getUint32(22, true) + 1, true)
    }],
  ] as const)('rejects local/central %s disagreement', async (_name, mutate) => {
    const archive = zipSync({ 'manifest.json': new TextEncoder().encode('{"schemaVersion":3}') })
    mutate(archive)
    const codec = new ProjectArchiveCodecWorker({ workerFactory: () => new SessionWorker() })
    const reader = await codec.open(new Blob([archive.slice().buffer]))

    await expect(reader.readEntry('manifest.json')).rejects.toThrow(/local|ZIP64|conflict/i)
  })

  it('rejects an actual inflated length that disagrees with the declared length', async () => {
    const archive = zipSync({ 'manifest.json': new TextEncoder().encode('x'.repeat(1024)) })
    const central = signatureOffset(archive, 0x02014b50)
    const view = new DataView(archive.buffer)
    view.setUint32(central + 24, view.getUint32(central + 24, true) + 1, true)
    view.setUint32(22, view.getUint32(22, true) + 1, true)
    const codec = new ProjectArchiveCodecWorker({ workerFactory: () => new SessionWorker() })
    const reader = await codec.open(new Blob([archive.slice().buffer]))

    await expect(reader.readEntry('manifest.json')).rejects.toThrow(/length|expanded/i)
  })

  it('rejects a signed data descriptor that conflicts with the central record', async () => {
    const codec = new ProjectArchiveCodecWorker({ workerFactory: () => new SessionWorker() })
    const archiveBlob = await codec.encode([{
      path: 'manifest.json',
      bytes: new TextEncoder().encode('{"schemaVersion":3}').buffer,
      compression: 'deflate',
    }])
    const archive = new Uint8Array(await archiveBlob.arrayBuffer())
    const central = signatureOffset(archive, 0x02014b50)
    const view = new DataView(archive.buffer)
    expect(view.getUint16(central + 8, true) & 0x0008).toBe(0x0008)
    const nameLength = view.getUint16(26, true)
    const extraLength = view.getUint16(28, true)
    const descriptor = 30 + nameLength + extraLength + view.getUint32(central + 20, true)
    expect(view.getUint32(descriptor, true)).toBe(0x08074b50)
    view.setUint32(descriptor + 4, view.getUint32(descriptor + 4, true) ^ 1, true)
    const reader = await codec.open(new Blob([archive.buffer]))

    await expect(reader.readEntry('manifest.json')).rejects.toThrow(/descriptor/i)
  })

  it('rejects a CRC mismatch after bounded expansion', async () => {
    const archive = zipSync({ 'manifest.json': new TextEncoder().encode('{"schemaVersion":3}') })
    for (let offset = archive.length - 22; offset >= 0; offset -= 1) {
      if (
        archive[offset] === 0x50 && archive[offset + 1] === 0x4b &&
        archive[offset + 2] === 0x01 && archive[offset + 3] === 0x02
      ) {
        archive[offset + 16] = archive[offset + 16]! ^ 0xff
        break
      }
    }
    const codec = new ProjectArchiveCodecWorker({ workerFactory: () => new SessionWorker() })
    const reader = await codec.open(new Blob([archive.slice().buffer]))

    await expect(reader.readEntry('manifest.json')).rejects.toThrow(/CRC/i)
  })

  it('digests source inputs with one canonical 4 MiB chunk in flight', async () => {
    const worker = new SessionWorker()
    const codec = new ProjectArchiveCodecWorker({ workerFactory: () => worker })
    const bytes = new Uint8Array(PROJECT_ARCHIVE_CHUNK_BYTES + 3)
    bytes.fill(0x5a)
    const expected = Array.from(new Uint8Array(
      await crypto.subtle.digest('SHA-256', bytes),
    ), (byte) => byte.toString(16).padStart(2, '0')).join('')

    const digests = await codec.digestSources([{ key: 'source-a', bytes: bytes.buffer }])

    expect(digests.get('source-a')).toBe(expected)
    expect(worker.digestChunkSizes).toEqual([PROJECT_ARCHIVE_CHUNK_BYTES, 3])
  })

  it('streams sorted deterministic ZIP entries into bounded Blob parts', async () => {
    const entries = [{
      path: 'manifest.json',
      bytes: new TextEncoder().encode('{"schemaVersion":3}').buffer,
      compression: 'deflate' as const,
    }, {
      path: `robot/sources/${'a'.repeat(64)}.step`,
      bytes: new TextEncoder().encode('STEP').buffer,
      compression: 'store' as const,
    }]
    const firstWorker = new SessionWorker()
    const secondWorker = new SessionWorker()
    const workers = [firstWorker, secondWorker]
    const codec = new ProjectArchiveCodecWorker({ workerFactory: () => workers.shift()! })

    const first = await codec.encode(entries)
    const second = await codec.encode(entries)
    const firstBytes = new Uint8Array(await first.arrayBuffer())
    expect(new Uint8Array(await second.arrayBuffer())).toEqual(firstBytes)
    expect(Object.keys(unzipSync(firstBytes))).toEqual(entries.map(({ path }) => path))
    expect(firstWorker.outputChunkSizes.every((size) =>
      size > 0 && size <= PROJECT_ARCHIVE_CHUNK_BYTES)).toBe(true)

    const firstView = new DataView(firstBytes.buffer, firstBytes.byteOffset, firstBytes.byteLength)
    expect(firstView.getUint16(10, true)).toBe(0)
    expect(firstView.getUint16(12, true)).toBe(0x21)
  })

  it('keeps deterministic ZIP bytes across UTC and Asia/Seoul local timezones', async () => {
    const nodeProcess = (globalThis as unknown as {
      process?: { env: Record<string, string | undefined> }
    }).process
    if (nodeProcess === undefined) return
    const originalTimezone = nodeProcess.env.TZ
    const entries = [{
      path: 'manifest.json',
      bytes: new TextEncoder().encode('{"schemaVersion":3}').buffer,
      compression: 'deflate' as const,
    }]
    try {
      nodeProcess.env.TZ = 'UTC'
      const utc = await new ProjectArchiveCodecWorker({ workerFactory: () => new SessionWorker() })
        .encode(entries)
      nodeProcess.env.TZ = 'Asia/Seoul'
      const seoul = await new ProjectArchiveCodecWorker({ workerFactory: () => new SessionWorker() })
        .encode(entries)

      expect(new Uint8Array(await seoul.arrayBuffer()))
        .toEqual(new Uint8Array(await utc.arrayBuffer()))
    } finally {
      if (originalTimezone === undefined) delete nodeProcess.env.TZ
      else nodeProcess.env.TZ = originalTimezone
    }
  })

  it('rejects cumulative Worker encode output above 300 MiB', async () => {
    const worker = new ControlledWorker()
    const fullChunk = new ArrayBuffer(PROJECT_ARCHIVE_CHUNK_BYTES)
    worker.onPost = (message) => {
      if (message.type === 'encode-start') {
        worker.emit({ type: 'encode-ready', generation: message.generation, entryCount: 1 })
      } else if (message.type === 'encode-entry-start') {
        worker.emit({ type: 'encode-entry-ready', generation: message.generation, index: 0 })
      } else if (message.type === 'encode-chunk') {
        worker.emit({
          type: 'encode-ack',
          generation: message.generation,
          index: 0,
          sequence: 0,
          receivedBytes: 1,
        })
        for (let sequence = 0; sequence < 75; sequence += 1) {
          worker.emit({
            type: 'encode-output',
            generation: message.generation,
            sequence,
            bytes: fullChunk,
            final: false,
          })
        }
        worker.emit({
          type: 'encode-output',
          generation: message.generation,
          sequence: 75,
          bytes: new ArrayBuffer(1),
          final: true,
        })
      }
    }
    const codec = new ProjectArchiveCodecWorker({ workerFactory: () => worker })

    await expect(codec.encode([{
      path: 'manifest.json',
      bytes: new Uint8Array([1]).buffer,
      compression: 'store',
    }])).rejects.toMatchObject({ code: 'PROJECT_ARCHIVE_WORKER_FAILED' })
    expect(worker.terminated).toBe(true)
  })

  it('rejects a short non-final Worker output transfer', async () => {
    const worker = new ControlledWorker()
    worker.onPost = (message) => {
      if (message.type === 'encode-start') {
        worker.emit({ type: 'encode-ready', generation: message.generation, entryCount: 1 })
      } else if (message.type === 'encode-entry-start') {
        worker.emit({ type: 'encode-entry-ready', generation: message.generation, index: 0 })
      } else if (message.type === 'encode-chunk') {
        worker.emit({
          type: 'encode-ack', generation: message.generation, index: 0,
          sequence: 0, receivedBytes: 1,
        })
        worker.emit({
          type: 'encode-output', generation: message.generation, sequence: 0,
          bytes: new ArrayBuffer(1), final: false,
        })
        worker.emit({
          type: 'encode-output', generation: message.generation, sequence: 1,
          bytes: new ArrayBuffer(1), final: true,
        })
      }
    }
    const codec = new ProjectArchiveCodecWorker({ workerFactory: () => worker })

    await expect(codec.encode([{
      path: 'manifest.json', bytes: new Uint8Array([1]).buffer, compression: 'store',
    }])).rejects.toMatchObject({ code: 'PROJECT_ARCHIVE_WORKER_FAILED' })
  })

  it('rejects final output before the last canonical input acknowledgement', async () => {
    const worker = new ControlledWorker()
    worker.onPost = (message) => {
      if (message.type === 'encode-start') {
        worker.emit({ type: 'encode-ready', generation: message.generation, entryCount: 2 })
      } else if (message.type === 'encode-entry-start') {
        worker.emit({
          type: 'encode-entry-ready', generation: message.generation, index: message.index,
        })
      } else if (message.type === 'encode-chunk') {
        worker.emit({
          type: 'encode-ack', generation: message.generation, index: message.index,
          sequence: 0, receivedBytes: 1,
        })
        if (message.index === 0) {
          worker.emit({
            type: 'encode-output', generation: message.generation, sequence: 0,
            bytes: new ArrayBuffer(1), final: true,
          })
        }
      }
    }
    const codec = new ProjectArchiveCodecWorker({ workerFactory: () => worker })

    await expect(codec.encode([
      { path: 'a.json', bytes: new Uint8Array([1]).buffer, compression: 'store' },
      { path: 'b.json', bytes: new Uint8Array([2]).buffer, compression: 'store' },
    ])).rejects.toMatchObject({ code: 'PROJECT_ARCHIVE_WORKER_FAILED' })
  })

  it('rejects queued acknowledgements after final output', async () => {
    const worker = new ControlledWorker()
    worker.onPost = (message) => {
      if (message.type === 'encode-start') {
        worker.emit({ type: 'encode-ready', generation: message.generation, entryCount: 1 })
      } else if (message.type === 'encode-entry-start') {
        worker.emit({ type: 'encode-entry-ready', generation: message.generation, index: 0 })
      } else if (message.type === 'encode-chunk') {
        const ack = {
          type: 'encode-ack' as const, generation: message.generation, index: 0,
          sequence: 0, receivedBytes: 1,
        }
        worker.emit(ack)
        worker.emit({
          type: 'encode-output', generation: message.generation, sequence: 0,
          bytes: new ArrayBuffer(1), final: true,
        })
        worker.emit(ack)
      }
    }
    const codec = new ProjectArchiveCodecWorker({ workerFactory: () => worker })

    await expect(codec.encode([{
      path: 'manifest.json', bytes: new Uint8Array([1]).buffer, compression: 'store',
    }])).rejects.toMatchObject({ code: 'PROJECT_ARCHIVE_WORKER_FAILED' })
  })
})
