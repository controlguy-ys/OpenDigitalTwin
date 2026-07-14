import {
  PROJECT_ARCHIVE_CHUNK_BYTES,
  PROJECT_ARCHIVE_MAX_AUXILIARY_BYTES,
  PROJECT_ARCHIVE_MAX_CENTRAL_BYTES,
  PROJECT_ARCHIVE_MAX_COMPRESSED_BYTES,
  ProjectArchiveCodecWorker,
  ProjectArchiveError,
  type ProjectArchiveEncodeEntry,
  type ProjectArchiveWorkerLike,
  type ProjectArchiveWorkerRequest,
  type ProjectArchiveWorkerResponse,
} from '../src/features/project/project-archive-worker'
import {
  MAX_OBJECT_ASSET_BYTES,
  MAX_PROJECT_SOURCE_BYTES,
} from '../src/domain/project/project'

const MIB = 1024 * 1024
const SOURCE_TAIL_BYTES = 6 * MIB
const MAX_JSON_ENTRY_BYTES = 8 * MIB
const ZIP_UTF8_FLAG = 0x0800
const encoder = new TextEncoder()

export interface ProjectArchiveBrowserEvidence {
  readonly sourceByteLength: number
  readonly archiveByteLength: number
  readonly rafFrames: number
  readonly workersConstructed: number
  readonly workersTerminated: number
  readonly maxActiveWorkers: number
  readonly workerUrls: readonly string[]
  readonly requestChunkByteLengths: readonly number[]
  readonly outputChunkByteLengths: readonly number[]
  readonly maxActiveExpansions: number
  readonly expandedEntryByteLengths: readonly number[]
  readonly expandedSourceBytes: number
  readonly expandedJsonBytes: number
  readonly centralAuxiliaryBytes: readonly number[]
  readonly entryAuxiliaryBytes: readonly number[]
  readonly callerBoundaryBefore: readonly number[]
  readonly callerBoundaryAfter: readonly number[]
  readonly sourceLimit: number
  readonly sourceLimitExactAccepted: boolean
  readonly sourceLimitExactErrorCode: string
  readonly sourceLimitExactEncodeChunks: number
  readonly sourceLimitExactEncodedBytes: number
  readonly sourceLimitPlusOneErrorCode: string
  readonly sourceLimitPlusOneEncodeChunks: number
  readonly sourceLimitPlusOneCallerByteLength: number
  readonly sourceLimitPlusOneCallerBoundary: number
  readonly compressedLimit: number
  readonly compressedLimitExactAccepted: boolean
  readonly compressedLimitExactErrorCode: string
  readonly compressedLimitExactArchiveBytes: number
  readonly compressedLimitExactTailBytes: number
  readonly compressedLimitExactReadAttempts: number
  readonly compressedLimitExactReadBytes: number
  readonly compressedLimitExactMaxSliceBytes: number
  readonly compressedLimitPlusOneErrorCode: string
  readonly compressedLimitPlusOneWorkerDelta: number
  readonly compressedLimitPlusOneReadAttempts: number
}

declare global {
  interface Window {
    __projectArchiveWorkerEvidence?: Promise<ProjectArchiveBrowserEvidence>
  }
}

interface EvidenceTracker {
  workersConstructed: number
  workersTerminated: number
  activeWorkers: number
  maxActiveWorkers: number
  workerUrls: string[]
  requestChunkByteLengths: number[]
  outputChunkByteLengths: number[]
  encodeChunks: number
  encodeInputBytes: number
  activeExpansions: number
  maxActiveExpansions: number
  expandedEntryByteLengths: number[]
  centralAuxiliaryBytes: number[]
  entryAuxiliaryBytes: number[]
}

interface StaticArchiveSegment {
  readonly offset: number
  readonly bytes: Uint8Array<ArrayBuffer>
}

interface VirtualEntry {
  readonly path: string
  readonly byteLength: number
}

class EvidenceArchiveWorker implements ProjectArchiveWorkerLike {
  onmessage: ((event: MessageEvent<ProjectArchiveWorkerResponse>) => void) | null = null
  onerror: ((event: ErrorEvent) => void) | null = null
  onmessageerror: ((event: MessageEvent<unknown>) => void) | null = null

  readonly #worker: Worker
  readonly #tracker: EvidenceTracker
  #terminated = false
  #expanding = false

  constructor(worker: Worker, tracker: EvidenceTracker) {
    this.#worker = worker
    this.#tracker = tracker
    worker.addEventListener('message', (event: MessageEvent<ProjectArchiveWorkerResponse>) => {
      const response = event.data
      if (response.type === 'encode-output') {
        tracker.outputChunkByteLengths.push(response.bytes.byteLength)
      }
      if (response.type === 'central-ready') {
        tracker.centralAuxiliaryBytes.push(response.auxiliaryBytes)
      }
      if (response.type === 'entry-data') {
        tracker.expandedEntryByteLengths.push(response.bytes.byteLength)
        tracker.entryAuxiliaryBytes.push(response.auxiliaryBytes)
        this.#finishExpansion()
      } else if (response.type === 'error' || response.type === 'cancelled') {
        this.#finishExpansion()
      }
      this.onmessage?.(event)
    })
    worker.addEventListener('error', (event) => this.onerror?.(event))
    worker.addEventListener('messageerror', (event) => this.onmessageerror?.(event))
  }

  postMessage(message: ProjectArchiveWorkerRequest, transfer?: Transferable[]): void {
    if (
      message.type === 'inspect-chunk' ||
      message.type === 'extract-chunk' ||
      message.type === 'digest-chunk' ||
      message.type === 'encode-chunk'
    ) {
      this.#tracker.requestChunkByteLengths.push(message.bytes.byteLength)
    }
    if (message.type === 'encode-chunk') {
      this.#tracker.encodeChunks += 1
      this.#tracker.encodeInputBytes += message.bytes.byteLength
    }
    if (message.type === 'extract-start') {
      if (this.#expanding) throw new Error('A second archive expansion started concurrently.')
      this.#expanding = true
      this.#tracker.activeExpansions += 1
      this.#tracker.maxActiveExpansions = Math.max(
        this.#tracker.maxActiveExpansions,
        this.#tracker.activeExpansions,
      )
    }
    this.#worker.postMessage(message, transfer ?? [])
  }

  terminate(): void {
    if (this.#terminated) return
    this.#terminated = true
    this.#finishExpansion()
    this.#worker.terminate()
    this.#tracker.workersTerminated += 1
    this.#tracker.activeWorkers -= 1
  }

  #finishExpansion(): void {
    if (!this.#expanding) return
    this.#expanding = false
    this.#tracker.activeExpansions -= 1
  }
}

class LogicalSizeBlob extends Blob {
  readonly #logicalSize: number
  readAttempts = 0

  constructor(logicalSize: number) {
    super([])
    this.#logicalSize = logicalSize
  }

  override get size(): number {
    return this.#logicalSize
  }

  override slice(_start?: number, _end?: number, _contentType?: string): Blob {
    this.readAttempts += 1
    return new Blob([])
  }
}

class VirtualZipBlob extends Blob {
  readonly #logicalSize: number
  readonly #segments: readonly StaticArchiveSegment[]
  readAttempts = 0
  readBytes = 0
  maxSliceBytes = 0

  constructor(logicalSize: number, segments: readonly StaticArchiveSegment[]) {
    super([])
    this.#logicalSize = logicalSize
    this.#segments = segments
  }

  override get size(): number {
    return this.#logicalSize
  }

  override slice(start = 0, end = this.#logicalSize, contentType = ''): Blob {
    if (
      !Number.isSafeInteger(start) ||
      !Number.isSafeInteger(end) ||
      start < 0 ||
      end < start ||
      end > this.#logicalSize
    ) {
      throw new Error('Virtual ZIP requested an invalid range.')
    }
    const length = end - start
    if (length > PROJECT_ARCHIVE_CHUNK_BYTES) {
      throw new Error('Virtual ZIP requested more than one canonical chunk.')
    }
    const output = new Uint8Array(length)
    for (const segment of this.#segments) {
      const segmentEnd = segment.offset + segment.bytes.byteLength
      const overlapStart = Math.max(start, segment.offset)
      const overlapEnd = Math.min(end, segmentEnd)
      if (overlapStart >= overlapEnd) continue
      output.set(
        segment.bytes.subarray(
          overlapStart - segment.offset,
          overlapEnd - segment.offset,
        ),
        overlapStart - start,
      )
    }
    this.readAttempts += 1
    this.readBytes += length
    this.maxSliceBytes = Math.max(this.maxSliceBytes, length)
    return new Blob([output], { type: contentType })
  }
}

const CRC32_TABLE = Uint32Array.from({ length: 256 }, (_value, index) => {
  let crc = index
  for (let bit = 0; bit < 8; bit += 1) {
    crc = (crc & 1) !== 0 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1
  }
  return crc >>> 0
})

function crcMatrixTimes(matrix: readonly number[], vector: number): number {
  let value = vector >>> 0
  let result = 0
  let index = 0
  while (value !== 0) {
    if ((value & 1) !== 0) result ^= matrix[index]!
    value >>>= 1
    index += 1
  }
  return result >>> 0
}

const zeroCrcCache = new Map<number, number>()

function crc32Zeros(byteLength: number): number {
  const cached = zeroCrcCache.get(byteLength)
  if (cached !== undefined) return cached
  let operator = Array.from({ length: 32 }, (_value, bit) => {
    const basis = (2 ** bit) >>> 0
    return (CRC32_TABLE[basis & 0xff]! ^ (basis >>> 8)) >>> 0
  })
  let remaining = byteLength
  let crc = 0xffffffff
  while (remaining > 0) {
    if (remaining % 2 === 1) crc = crcMatrixTimes(operator, crc)
    remaining = Math.floor(remaining / 2)
    operator = operator.map((column) => crcMatrixTimes(operator, column))
  }
  const result = (crc ^ 0xffffffff) >>> 0
  zeroCrcCache.set(byteLength, result)
  return result
}

function makeLocalHeader(entry: VirtualEntry): Uint8Array<ArrayBuffer> {
  const path = encoder.encode(entry.path)
  const bytes = new Uint8Array(30 + path.byteLength)
  const view = new DataView(bytes.buffer)
  const crc32 = crc32Zeros(entry.byteLength)
  view.setUint32(0, 0x04034b50, true)
  view.setUint16(4, 20, true)
  view.setUint16(6, ZIP_UTF8_FLAG, true)
  view.setUint16(8, 0, true)
  view.setUint16(10, 0, true)
  view.setUint16(12, 0x21, true)
  view.setUint32(14, crc32, true)
  view.setUint32(18, entry.byteLength, true)
  view.setUint32(22, entry.byteLength, true)
  view.setUint16(26, path.byteLength, true)
  view.setUint16(28, 0, true)
  bytes.set(path, 30)
  return bytes
}

function makeCentralRecord(
  entry: VirtualEntry,
  localOffset: number,
): Uint8Array<ArrayBuffer> {
  const path = encoder.encode(entry.path)
  const bytes = new Uint8Array(46 + path.byteLength)
  const view = new DataView(bytes.buffer)
  const crc32 = crc32Zeros(entry.byteLength)
  view.setUint32(0, 0x02014b50, true)
  view.setUint16(4, 20, true)
  view.setUint16(6, 20, true)
  view.setUint16(8, ZIP_UTF8_FLAG, true)
  view.setUint16(10, 0, true)
  view.setUint16(12, 0, true)
  view.setUint16(14, 0x21, true)
  view.setUint32(16, crc32, true)
  view.setUint32(20, entry.byteLength, true)
  view.setUint32(24, entry.byteLength, true)
  view.setUint16(28, path.byteLength, true)
  view.setUint16(30, 0, true)
  view.setUint16(32, 0, true)
  view.setUint16(34, 0, true)
  view.setUint16(36, 0, true)
  view.setUint32(38, 0, true)
  view.setUint32(42, localOffset, true)
  bytes.set(path, 46)
  return bytes
}

function makeEndOfCentralDirectory(
  entryCount: number,
  centralSize: number,
  centralOffset: number,
): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(22)
  const view = new DataView(bytes.buffer)
  view.setUint32(0, 0x06054b50, true)
  view.setUint16(4, 0, true)
  view.setUint16(6, 0, true)
  view.setUint16(8, entryCount, true)
  view.setUint16(10, entryCount, true)
  view.setUint32(12, centralSize, true)
  view.setUint32(16, centralOffset, true)
  view.setUint16(20, 0, true)
  return bytes
}

function createBoundaryVirtualZip(): VirtualZipBlob {
  const sourceEntries: VirtualEntry[] = [
    { path: 'objects/assets/a.step', byteLength: MAX_OBJECT_ASSET_BYTES },
    { path: 'objects/assets/b.step', byteLength: MAX_OBJECT_ASSET_BYTES },
    { path: 'objects/assets/c.step', byteLength: MAX_OBJECT_ASSET_BYTES },
    { path: 'objects/assets/d.step', byteLength: MAX_OBJECT_ASSET_BYTES },
    { path: 'objects/assets/e.step', byteLength: MAX_OBJECT_ASSET_BYTES },
    { path: 'objects/assets/f.step', byteLength: SOURCE_TAIL_BYTES },
  ]
  const paddingPaths = [
    'padding/a.json',
    'padding/b.json',
    'padding/c.json',
    'padding/d.json',
    'padding/e.json',
    'padding/f.json',
  ] as const
  const allPaths = [...sourceEntries.map(({ path }) => path), ...paddingPaths]
  const structuralBytes = allPaths.reduce(
    (total, path) => total + 30 + encoder.encode(path).byteLength + 46 + encoder.encode(path).byteLength,
    22,
  )
  const paddingBytes = PROJECT_ARCHIVE_MAX_COMPRESSED_BYTES
    - MAX_PROJECT_SOURCE_BYTES
    - structuralBytes
  const finalPaddingBytes = paddingBytes - 5 * MAX_JSON_ENTRY_BYTES
  if (finalPaddingBytes <= 0 || finalPaddingBytes > MAX_JSON_ENTRY_BYTES) {
    throw new Error('Virtual ZIP padding cannot satisfy the frozen JSON limits.')
  }
  const entries: readonly VirtualEntry[] = [
    ...sourceEntries,
    ...paddingPaths.map((path, index) => ({
      path,
      byteLength: index < 5 ? MAX_JSON_ENTRY_BYTES : finalPaddingBytes,
    })),
  ]

  const segments: StaticArchiveSegment[] = []
  const centralRecords: Uint8Array<ArrayBuffer>[] = []
  let localOffset = 0
  for (const entry of entries) {
    const localHeader = makeLocalHeader(entry)
    segments.push({ offset: localOffset, bytes: localHeader })
    centralRecords.push(makeCentralRecord(entry, localOffset))
    localOffset += localHeader.byteLength + entry.byteLength
  }
  const centralOffset = localOffset
  const centralSize = centralRecords.reduce((total, record) => total + record.byteLength, 0)
  const end = makeEndOfCentralDirectory(entries.length, centralSize, centralOffset)
  const central = new Uint8Array(centralSize + end.byteLength)
  let centralWriteOffset = 0
  for (const record of centralRecords) {
    central.set(record, centralWriteOffset)
    centralWriteOffset += record.byteLength
  }
  central.set(end, centralWriteOffset)
  segments.push({ offset: centralOffset, bytes: central })
  if (centralOffset + central.byteLength !== PROJECT_ARCHIVE_MAX_COMPRESSED_BYTES) {
    throw new Error('Virtual ZIP does not end at the exact compressed archive limit.')
  }
  return new VirtualZipBlob(PROJECT_ARCHIVE_MAX_COMPRESSED_BYTES, segments)
}

function createTracker(): EvidenceTracker {
  return {
    workersConstructed: 0,
    workersTerminated: 0,
    activeWorkers: 0,
    maxActiveWorkers: 0,
    workerUrls: [],
    requestChunkByteLengths: [],
    outputChunkByteLengths: [],
    encodeChunks: 0,
    encodeInputBytes: 0,
    activeExpansions: 0,
    maxActiveExpansions: 0,
    expandedEntryByteLengths: [],
    centralAuxiliaryBytes: [],
    entryAuxiliaryBytes: [],
  }
}

function createEvidenceCodec(tracker: EvidenceTracker): ProjectArchiveCodecWorker {
  return new ProjectArchiveCodecWorker({
    workerFactory: () => {
      const workerUrl = new URL(
        '../src/features/project/project-archive-worker.ts',
        import.meta.url,
      )
      tracker.workerUrls.push(workerUrl.href)
      tracker.workersConstructed += 1
      tracker.activeWorkers += 1
      tracker.maxActiveWorkers = Math.max(
        tracker.maxActiveWorkers,
        tracker.activeWorkers,
      )
      return new EvidenceArchiveWorker(
        new Worker(workerUrl, { name: 'project-archive-evidence', type: 'module' }),
        tracker,
      )
    },
  })
}

function boundaryValues(bytes: Uint8Array): readonly number[] {
  return [
    bytes.byteLength,
    bytes[0] ?? -1,
    bytes[Math.floor(bytes.byteLength / 2)] ?? -1,
    bytes.at(-1) ?? -1,
  ]
}

function sourceLimitEntries(
  maximumSource: ArrayBuffer,
  tailSource: ArrayBuffer,
): readonly ProjectArchiveEncodeEntry[] {
  return [
    { path: 'objects/assets/a.step', bytes: maximumSource, compression: 'deflate' },
    { path: 'objects/assets/b.step', bytes: maximumSource, compression: 'deflate' },
    { path: 'objects/assets/c.step', bytes: maximumSource, compression: 'deflate' },
    { path: 'objects/assets/d.step', bytes: maximumSource, compression: 'deflate' },
    { path: 'objects/assets/e.step', bytes: maximumSource, compression: 'deflate' },
    { path: 'objects/assets/f.step', bytes: tailSource, compression: 'deflate' },
  ]
}

async function rejectionCode(operation: Promise<unknown>): Promise<string> {
  try {
    await operation
    return 'RESOLVED'
  } catch (error) {
    return error instanceof ProjectArchiveError ? error.code : 'UNKNOWN_ERROR'
  }
}

function nextAnimationFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()))
}

async function runProjectArchiveWorkerEvidence(): Promise<ProjectArchiveBrowserEvidence> {
  const tracker = createTracker()
  const source = new Uint8Array(MAX_OBJECT_ASSET_BYTES)
  source[0] = 0x51
  source[Math.floor(source.byteLength / 2)] = 0xa5
  source[source.byteLength - 1] = 0xfe
  const exactTail = new Uint8Array(SOURCE_TAIL_BYTES)
  exactTail[exactTail.byteLength - 1] = 0x6a
  const callerBoundaryBefore = boundaryValues(source)
  const virtualArchive = createBoundaryVirtualZip()

  let rafFrames = 0
  let countFrames = true
  const countFrame = (): void => {
    if (!countFrames) return
    rafFrames += 1
    requestAnimationFrame(countFrame)
  }
  requestAnimationFrame(countFrame)

  const exactChunkStart = tracker.encodeChunks
  const exactByteStart = tracker.encodeInputBytes
  let encodedArchive: Blob | undefined = await createEvidenceCodec(tracker).encode(
    sourceLimitEntries(source.buffer, exactTail.buffer),
  )
  const archiveByteLength = encodedArchive.size
  const sourceLimitExactEncodeChunks = tracker.encodeChunks - exactChunkStart
  const sourceLimitExactEncodedBytes = tracker.encodeInputBytes - exactByteStart
  encodedArchive = undefined

  let expandedSourceBytes = 0
  let expandedJsonBytes = 0
  const reader = await createEvidenceCodec(tracker).open(virtualArchive)
  try {
    for (const entry of reader.entries) {
      {
        const expanded = new Uint8Array(await reader.readEntry(entry.path))
        if (
          expanded.byteLength !== entry.uncompressedSize ||
          expanded[0] !== 0 ||
          expanded[Math.floor(expanded.byteLength / 2)] !== 0 ||
          expanded.at(-1) !== 0
        ) {
          throw new Error(`Virtual ZIP expansion for ${entry.path} is inconsistent.`)
        }
        if (entry.path.endsWith('.step')) expandedSourceBytes += expanded.byteLength
        else expandedJsonBytes += expanded.byteLength
      }
      await nextAnimationFrame()
    }
  } finally {
    reader.close()
  }
  await nextAnimationFrame()
  countFrames = false

  const plusOneTail = new Uint8Array(SOURCE_TAIL_BYTES + 1)
  plusOneTail[plusOneTail.byteLength - 1] = 0x6b
  const plusOneChunkStart = tracker.encodeChunks
  const sourceLimitPlusOneErrorCode = await rejectionCode(
    createEvidenceCodec(tracker).encode(sourceLimitEntries(source.buffer, plusOneTail.buffer)),
  )
  const sourceLimitPlusOneEncodeChunks = tracker.encodeChunks - plusOneChunkStart

  const plusOneCompressed = new LogicalSizeBlob(PROJECT_ARCHIVE_MAX_COMPRESSED_BYTES + 1)
  const plusOneWorkerStart = tracker.workersConstructed
  const compressedLimitPlusOneErrorCode = await rejectionCode(
    createEvidenceCodec(tracker).open(plusOneCompressed),
  )

  if (
    tracker.requestChunkByteLengths.some((length) => length > PROJECT_ARCHIVE_CHUNK_BYTES) ||
    tracker.outputChunkByteLengths.some((length) => length > PROJECT_ARCHIVE_CHUNK_BYTES) ||
    tracker.centralAuxiliaryBytes.some((bytes) => bytes > PROJECT_ARCHIVE_MAX_CENTRAL_BYTES) ||
    tracker.entryAuxiliaryBytes.some((bytes) => bytes > PROJECT_ARCHIVE_MAX_AUXILIARY_BYTES)
  ) {
    throw new Error('Archive Worker exceeded a frozen transfer or auxiliary limit.')
  }

  return {
    sourceByteLength: source.byteLength,
    archiveByteLength,
    rafFrames,
    workersConstructed: tracker.workersConstructed,
    workersTerminated: tracker.workersTerminated,
    maxActiveWorkers: tracker.maxActiveWorkers,
    workerUrls: tracker.workerUrls,
    requestChunkByteLengths: tracker.requestChunkByteLengths,
    outputChunkByteLengths: tracker.outputChunkByteLengths,
    maxActiveExpansions: tracker.maxActiveExpansions,
    expandedEntryByteLengths: tracker.expandedEntryByteLengths,
    expandedSourceBytes,
    expandedJsonBytes,
    centralAuxiliaryBytes: tracker.centralAuxiliaryBytes,
    entryAuxiliaryBytes: tracker.entryAuxiliaryBytes,
    callerBoundaryBefore,
    callerBoundaryAfter: boundaryValues(source),
    sourceLimit: MAX_PROJECT_SOURCE_BYTES,
    sourceLimitExactAccepted: sourceLimitExactEncodedBytes === MAX_PROJECT_SOURCE_BYTES,
    sourceLimitExactErrorCode: 'RESOLVED',
    sourceLimitExactEncodeChunks,
    sourceLimitExactEncodedBytes,
    sourceLimitPlusOneErrorCode,
    sourceLimitPlusOneEncodeChunks,
    sourceLimitPlusOneCallerByteLength: plusOneTail.byteLength,
    sourceLimitPlusOneCallerBoundary: plusOneTail.at(-1) ?? -1,
    compressedLimit: PROJECT_ARCHIVE_MAX_COMPRESSED_BYTES,
    compressedLimitExactAccepted:
      virtualArchive.readBytes > PROJECT_ARCHIVE_MAX_COMPRESSED_BYTES,
    compressedLimitExactErrorCode: 'RESOLVED',
    compressedLimitExactArchiveBytes: virtualArchive.size,
    compressedLimitExactTailBytes: tracker.centralAuxiliaryBytes[0] ?? -1,
    compressedLimitExactReadAttempts: virtualArchive.readAttempts,
    compressedLimitExactReadBytes: virtualArchive.readBytes,
    compressedLimitExactMaxSliceBytes: virtualArchive.maxSliceBytes,
    compressedLimitPlusOneErrorCode,
    compressedLimitPlusOneWorkerDelta: tracker.workersConstructed - plusOneWorkerStart,
    compressedLimitPlusOneReadAttempts: plusOneCompressed.readAttempts,
  }
}

const runButton = document.querySelector<HTMLButtonElement>('#run-evidence')
const status = document.querySelector<HTMLOutputElement>('#evidence-status')
if (runButton === null || status === null) {
  throw new Error('Project archive evidence controls are missing.')
}
runButton.addEventListener('click', () => {
  runButton.disabled = true
  status.value = 'Running'
  const pending = runProjectArchiveWorkerEvidence()
  window.__projectArchiveWorkerEvidence = pending
  void pending.then(
    (evidence) => {
      status.value = `Complete: ${evidence.rafFrames} animation frames`
    },
    (error: unknown) => {
      status.value = `Failed: ${error instanceof Error ? error.message : String(error)}`
    },
  )
})
