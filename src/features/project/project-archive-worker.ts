import { Inflate, Zip, ZipDeflate, ZipPassThrough } from 'fflate'
import { createIncrementalSha256 } from '../../lib/hash/sha256-worker'
import {
  MAX_OBJECT_ASSET_BYTES,
  MAX_PROJECT_SOURCE_BYTES,
  MAX_ROBOT_LINK_BYTES,
} from '../../domain/project/project'

export const PROJECT_ARCHIVE_CHUNK_BYTES = 4 * 1024 * 1024
export const PROJECT_ARCHIVE_TIMEOUT_MS = 120_000
export const PROJECT_ARCHIVE_MAX_AUXILIARY_BYTES = 64 * 1024 * 1024
export const PROJECT_ARCHIVE_MAX_COMPRESSED_BYTES = 300 * 1024 * 1024
export const PROJECT_ARCHIVE_MAX_CENTRAL_BYTES = 16 * 1024 * 1024
export const PROJECT_ARCHIVE_MAX_JSON_ENTRY_BYTES = 8 * 1024 * 1024
export const PROJECT_ARCHIVE_MAX_JSON_BYTES = 64 * 1024 * 1024
export const PROJECT_ARCHIVE_MAX_ENTRIES = 1_024

const decoder = new TextDecoder('utf-8', { fatal: true })

export interface ProjectArchiveCentralEntry {
  readonly path: string
  readonly flags: number
  readonly compression: 0 | 8
  readonly crc32: number
  readonly compressedSize: number
  readonly uncompressedSize: number
  readonly localOffset: number
  readonly spanEnd: number
}

export interface ProjectArchiveEncodeEntry {
  readonly path: string
  readonly bytes: ArrayBuffer
  readonly compression: 'store' | 'deflate'
}

interface ProjectArchiveEncodeDescriptor {
  readonly path: string
  readonly byteLength: number
  readonly compression: 'store' | 'deflate'
}

export interface ProjectArchiveDigestInput {
  readonly key: string
  readonly bytes: ArrayBuffer
}

export type ProjectArchiveWorkerRequest =
  | {
      readonly type: 'inspect-start'
      readonly generation: number
      readonly totalBytes: number
      readonly tailOffset: number
      readonly tailLength: number
    }
  | {
      readonly type: 'inspect-chunk'
      readonly generation: number
      readonly sequence: number
      readonly offset: number
      readonly bytes: ArrayBuffer
      readonly final: boolean
    }
  | { readonly type: 'extract-start'; readonly generation: number; readonly path: string }
  | {
      readonly type: 'extract-chunk'
      readonly generation: number
      readonly path: string
      readonly offset: number
      readonly bytes: ArrayBuffer
    }
  | {
      readonly type: 'digest-start'
      readonly generation: number
      readonly key: string
      readonly totalBytes: number
    }
  | {
      readonly type: 'digest-chunk'
      readonly generation: number
      readonly key: string
      readonly sequence: number
      readonly offset: number
      readonly bytes: ArrayBuffer
      readonly final: boolean
    }
  | {
      readonly type: 'encode-start'
      readonly generation: number
      readonly entries: readonly ProjectArchiveEncodeDescriptor[]
    }
  | { readonly type: 'encode-entry-start'; readonly generation: number; readonly index: number }
  | {
      readonly type: 'encode-chunk'
      readonly generation: number
      readonly index: number
      readonly sequence: number
      readonly offset: number
      readonly bytes: ArrayBuffer
      readonly final: boolean
    }
  | { readonly type: 'cancel'; readonly generation: number }

export type ProjectArchiveWorkerResponse =
  | { readonly type: 'inspect-ready'; readonly generation: number; readonly tailLength: number }
  | {
      readonly type: 'inspect-ack'
      readonly generation: number
      readonly sequence: number
      readonly receivedBytes: number
    }
  | {
      readonly type: 'central-ready'
      readonly generation: number
      readonly entries: readonly ProjectArchiveCentralEntry[]
      readonly auxiliaryBytes: number
    }
  | {
      readonly type: 'extract-range'
      readonly generation: number
      readonly path: string
      readonly offset: number
      readonly length: number
    }
  | {
      readonly type: 'entry-data'
      readonly generation: number
      readonly path: string
      readonly bytes: ArrayBuffer
      readonly auxiliaryBytes: number
    }
  | { readonly type: 'digest-ready'; readonly generation: number; readonly key: string; readonly totalBytes: number }
  | {
      readonly type: 'digest-ack'
      readonly generation: number
      readonly key: string
      readonly sequence: number
      readonly receivedBytes: number
    }
  | { readonly type: 'digest'; readonly generation: number; readonly key: string; readonly sha256: string; readonly totalBytes: number }
  | { readonly type: 'encode-ready'; readonly generation: number; readonly entryCount: number }
  | { readonly type: 'encode-entry-ready'; readonly generation: number; readonly index: number }
  | {
      readonly type: 'encode-ack'
      readonly generation: number
      readonly index: number
      readonly sequence: number
      readonly receivedBytes: number
    }
  | {
      readonly type: 'encode-output'
      readonly generation: number
      readonly sequence: number
      readonly bytes: ArrayBuffer
      readonly final: boolean
    }
  | { readonly type: 'cancelled'; readonly generation: number }
  | {
      readonly type: 'error'
      readonly generation: number
      readonly code: 'PROJECT_ARCHIVE_WORKER_FAILED'
      readonly message: string
    }

export interface ProjectArchiveWorkerSession {
  handle(message: unknown): void
}

export interface ProjectArchiveWorkerLike {
  onmessage: ((event: MessageEvent<ProjectArchiveWorkerResponse>) => void) | null
  onerror: ((event: ErrorEvent) => void) | null
  onmessageerror: ((event: MessageEvent<unknown>) => void) | null
  postMessage(message: ProjectArchiveWorkerRequest, transfer?: Transferable[]): void
  terminate(): void
}

export interface ProjectArchiveReader {
  readonly entries: readonly ProjectArchiveCentralEntry[]
  readEntry(path: string): Promise<ArrayBuffer>
  finish(): void
  close(): void
}

export class ProjectArchiveError extends Error {
  readonly code: string

  constructor(code: string, message: string, cause?: unknown) {
    super(`${code}: ${message}`, cause === undefined ? undefined : { cause })
    this.name = 'ProjectArchiveError'
    this.code = code
  }
}

function exactRecord(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
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
    return descriptor !== undefined && descriptor.enumerable && 'value' in descriptor
  })
}

function isArrayBuffer(value: unknown): value is ArrayBuffer {
  if (typeof value !== 'object' || value === null) return false
  try {
    return Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'byteLength')?.get?.call(value) !== undefined
  } catch {
    return false
  }
}

function safeArchivePath(path: string): boolean {
  return (
    path.length > 0 &&
    path.length <= 512 &&
    /^[\x20-\x7e]+$/.test(path) &&
    !path.startsWith('/') &&
    !path.startsWith('\\') &&
    !/^[a-z]:/i.test(path) &&
    !path.includes('\\') &&
    path.split('/').every((segment) => segment !== '' && segment !== '.' && segment !== '..')
  )
}

function inspectExtra(bytes: Uint8Array, start: number, length: number): void {
  const end = start + length
  let offset = start
  while (offset < end) {
    if (offset + 4 > end) throw new Error('ZIP extra field is truncated.')
    const view = new DataView(bytes.buffer, bytes.byteOffset + offset, 4)
    const headerId = view.getUint16(0, true)
    const fieldLength = view.getUint16(2, true)
    offset += 4
    if (offset + fieldLength > end) throw new Error('ZIP extra field length is invalid.')
    if (headerId === 0x0001) throw new Error('ZIP64 entries are unsupported.')
    offset += fieldLength
  }
}

function entryLimit(path: string): number {
  if (path.endsWith('.step')) {
    return path.startsWith('robot/') ? MAX_ROBOT_LINK_BYTES : MAX_OBJECT_ASSET_BYTES
  }
  return PROJECT_ARCHIVE_MAX_JSON_ENTRY_BYTES
}

function findEndOfCentralDirectory(tail: Uint8Array, tailOffset: number): number {
  const minimum = Math.max(0, tail.length - 65_557)
  for (let offset = tail.length - 22; offset >= minimum; offset -= 1) {
    if (
      tail[offset] === 0x50 &&
      tail[offset + 1] === 0x4b &&
      tail[offset + 2] === 0x05 &&
      tail[offset + 3] === 0x06
    ) {
      return tailOffset + offset
    }
  }
  throw new Error('ZIP end-of-central-directory record is missing.')
}

function parseCentralDirectory(
  tail: Uint8Array,
  tailOffset: number,
  totalBytes: number,
): readonly ProjectArchiveCentralEntry[] {
  const eocdAbsolute = findEndOfCentralDirectory(tail, tailOffset)
  const eocd = eocdAbsolute - tailOffset
  const view = new DataView(tail.buffer, tail.byteOffset, tail.byteLength)
  const commentLength = view.getUint16(eocd + 20, true)
  if (eocdAbsolute + 22 + commentLength !== totalBytes) {
    throw new Error('ZIP end record does not end at the archive boundary.')
  }
  const disk = view.getUint16(eocd + 4, true)
  const centralDisk = view.getUint16(eocd + 6, true)
  const diskEntries = view.getUint16(eocd + 8, true)
  const totalEntries = view.getUint16(eocd + 10, true)
  const centralSize = view.getUint32(eocd + 12, true)
  const centralOffset = view.getUint32(eocd + 16, true)
  if (disk !== 0 || centralDisk !== 0 || diskEntries !== totalEntries) {
    throw new Error('Multi-disk ZIP archives are unsupported.')
  }
  if (
    totalEntries === 0xffff ||
    centralSize === 0xffffffff ||
    centralOffset === 0xffffffff
  ) {
    throw new Error('ZIP64 archives are unsupported.')
  }
  if (totalEntries === 0 || totalEntries > PROJECT_ARCHIVE_MAX_ENTRIES) {
    throw new Error('ZIP entry count is outside the Project limit.')
  }
  if (centralSize > PROJECT_ARCHIVE_MAX_CENTRAL_BYTES) {
    throw new Error('ZIP central directory exceeds the workspace limit.')
  }
  if (centralOffset + centralSize !== eocdAbsolute || centralOffset < tailOffset) {
    throw new Error('ZIP central directory is out of bounds.')
  }

  const paths = new Set<string>()
  const records: ProjectArchiveCentralEntry[] = []
  let sourceBytes = 0
  let jsonBytes = 0
  let offset = centralOffset - tailOffset
  const centralEnd = offset + centralSize
  for (let index = 0; index < totalEntries; index += 1) {
    if (offset + 46 > centralEnd || view.getUint32(offset, true) !== 0x02014b50) {
      throw new Error('ZIP central entry is malformed.')
    }
    const versionNeeded = view.getUint16(offset + 6, true)
    const flags = view.getUint16(offset + 8, true)
    const compression = view.getUint16(offset + 10, true)
    const crc32 = view.getUint32(offset + 16, true)
    const compressedSize = view.getUint32(offset + 20, true)
    const uncompressedSize = view.getUint32(offset + 24, true)
    const nameLength = view.getUint16(offset + 28, true)
    const extraLength = view.getUint16(offset + 30, true)
    const entryCommentLength = view.getUint16(offset + 32, true)
    const diskStart = view.getUint16(offset + 34, true)
    const localOffset = view.getUint32(offset + 42, true)
    if (
      versionNeeded >= 45 ||
      compressedSize === 0xffffffff ||
      uncompressedSize === 0xffffffff ||
      localOffset === 0xffffffff
    ) {
      throw new Error('ZIP64 entries are unsupported.')
    }
    if (diskStart !== 0) throw new Error('Multi-disk ZIP entries are unsupported.')
    if ((flags & 0x0001) !== 0) throw new Error('Encrypted ZIP entries are unsupported.')
    const allowedFlags = compression === 8 ? 0x080e : 0x0808
    if ((flags & ~allowedFlags) !== 0) throw new Error('ZIP entry flags are unsupported.')
    if (compression !== 0 && compression !== 8) {
      throw new Error('ZIP compression method is unsupported.')
    }
    const nameStart = offset + 46
    const nameEnd = nameStart + nameLength
    const extraEnd = nameEnd + extraLength
    const recordEnd = extraEnd + entryCommentLength
    if (recordEnd > centralEnd) throw new Error('ZIP central entry length is invalid.')
    let path: string
    try {
      path = decoder.decode(tail.subarray(nameStart, nameEnd))
    } catch {
      throw new Error('ZIP entry path is not valid UTF-8.')
    }
    if (!safeArchivePath(path)) throw new Error(`Unsafe ZIP entry path: ${path}.`)
    if (paths.has(path)) throw new Error(`Duplicate ZIP entry path: ${path}.`)
    paths.add(path)
    inspectExtra(tail, nameEnd, extraLength)
    if (uncompressedSize > entryLimit(path)) {
      throw new Error(`ZIP entry ${path} exceeds its expanded-size limit.`)
    }
    if (path.endsWith('.step')) sourceBytes += uncompressedSize
    else jsonBytes += uncompressedSize
    if (sourceBytes > MAX_PROJECT_SOURCE_BYTES) {
      throw new Error('ZIP source payloads exceed the Project byte limit.')
    }
    if (jsonBytes > PROJECT_ARCHIVE_MAX_JSON_BYTES) {
      throw new Error('ZIP JSON payloads exceed the aggregate Project limit.')
    }
    records.push({
      path,
      flags,
      compression: compression as 0 | 8,
      crc32,
      compressedSize,
      uncompressedSize,
      localOffset,
      spanEnd: 0,
    })
    offset = recordEnd
  }
  if (offset !== centralEnd) throw new Error('ZIP central directory length is inconsistent.')

  const orderedByOffset = [...records].sort((left, right) => left.localOffset - right.localOffset)
  orderedByOffset.forEach((record, index) => {
    const spanEnd = orderedByOffset[index + 1]?.localOffset ?? centralOffset
    const minimumSpan = 30 + record.compressedSize
    if (
      record.localOffset < 0 ||
      record.localOffset + minimumSpan > spanEnd ||
      spanEnd > centralOffset
    ) {
      throw new Error(`ZIP local span for ${record.path} overlaps or is out of range.`)
    }
    ;(record as { spanEnd: number }).spanEnd = spanEnd
  })
  return Object.freeze(records.map((record) => Object.freeze(record)))
}

function validateCentralResponseEntries(
  value: readonly ProjectArchiveCentralEntry[],
  totalBytes: number,
): readonly ProjectArchiveCentralEntry[] {
  if (value.length === 0 || value.length > PROJECT_ARCHIVE_MAX_ENTRIES) {
    throw new Error('Archive Worker returned an invalid central entry count.')
  }
  const paths = new Set<string>()
  const records: ProjectArchiveCentralEntry[] = []
  let sourceBytes = 0
  let jsonBytes = 0
  for (const candidate of value) {
    if (!exactRecord(candidate, [
      'path',
      'flags',
      'compression',
      'crc32',
      'compressedSize',
      'uncompressedSize',
      'localOffset',
      'spanEnd',
    ])) {
      throw new Error('Archive Worker returned a malformed central entry.')
    }
    const record = candidate as ProjectArchiveCentralEntry
    if (
      typeof record.path !== 'string' ||
      !safeArchivePath(record.path) ||
      paths.has(record.path) ||
      !Number.isSafeInteger(record.flags) ||
      record.flags < 0 ||
      record.flags > 0xffff ||
      (record.flags & 0x0001) !== 0 ||
      (record.compression !== 0 && record.compression !== 8) ||
      (record.flags & ~(record.compression === 8 ? 0x080e : 0x0808)) !== 0 ||
      !Number.isSafeInteger(record.crc32) ||
      record.crc32 < 0 ||
      record.crc32 > 0xffffffff ||
      !Number.isSafeInteger(record.compressedSize) ||
      record.compressedSize < 0 ||
      !Number.isSafeInteger(record.uncompressedSize) ||
      record.uncompressedSize < 0 ||
      record.uncompressedSize > entryLimit(record.path) ||
      !Number.isSafeInteger(record.localOffset) ||
      record.localOffset < 0 ||
      !Number.isSafeInteger(record.spanEnd) ||
      record.spanEnd <= record.localOffset ||
      record.spanEnd > totalBytes
    ) {
      throw new Error('Archive Worker returned an invalid central entry.')
    }
    paths.add(record.path)
    if (record.path.endsWith('.step')) sourceBytes += record.uncompressedSize
    else jsonBytes += record.uncompressedSize
    if (
      sourceBytes > MAX_PROJECT_SOURCE_BYTES ||
      jsonBytes > PROJECT_ARCHIVE_MAX_JSON_BYTES
    ) {
      throw new Error('Archive Worker central entries exceed aggregate limits.')
    }
    records.push(Object.freeze({ ...record }))
  }
  const ordered = [...records].sort((left, right) => left.localOffset - right.localOffset)
  for (let index = 1; index < ordered.length; index += 1) {
    if (ordered[index - 1]!.spanEnd > ordered[index]!.localOffset) {
      throw new Error('Archive Worker central entry spans overlap.')
    }
  }
  return Object.freeze(records)
}

const CRC32_TABLE = Uint32Array.from({ length: 256 }, (_value, index) => {
  let crc = index
  for (let bit = 0; bit < 8; bit += 1) {
    crc = (crc & 1) !== 0 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1
  }
  return crc >>> 0
})

function updateCrc32(crc: number, bytes: Uint8Array): number {
  let next = crc
  for (const byte of bytes) next = CRC32_TABLE[(next ^ byte) & 0xff]! ^ (next >>> 8)
  return next >>> 0
}

interface ActiveExtraction {
  readonly record: ProjectArchiveCentralEntry
  readonly output: Uint8Array<ArrayBuffer>
  readonly descriptor: Uint8Array<ArrayBuffer>
  readonly inflate: Inflate | undefined
  dataOffset: number
  dataEnd: number
  nextOffset: number
  expectedLength: number
  outputOffset: number
  descriptorOffset: number
  crc: number
  headerParsed: boolean
  compressedFinalized: boolean
}

export function createProjectArchiveWorkerSession(
  postResponse: (
    response: ProjectArchiveWorkerResponse,
    transfer?: Transferable[],
  ) => void,
): ProjectArchiveWorkerSession {
  let generation = -1
  let state: 'idle' | 'inspect' | 'ready' | 'extract' | 'digest' | 'encode' | 'closed' = 'idle'
  let totalBytes = 0
  let tailOffset = 0
  let tail: Uint8Array<ArrayBuffer> | undefined
  let receivedBytes = 0
  let nextSequence = 0
  let centralEntries: readonly ProjectArchiveCentralEntry[] = []
  let extraction: ActiveExtraction | undefined
  let digestKey = ''
  let digestTotalBytes = 0
  let digestReceivedBytes = 0
  let digestSequence = 0
  let digestHash: ReturnType<typeof createIncrementalSha256> | undefined
  let encodeDescriptors: readonly ProjectArchiveEncodeDescriptor[] = []
  let archiveZip: Zip | undefined
  let encodeEntry: ZipDeflate | ZipPassThrough | undefined
  let encodeEntryIndex = -1
  let encodeNextEntryIndex = 0
  let encodeReceivedBytes = 0
  let encodeInputSequence = 0
  let encodeOutputSequence = 0
  let encodeOutputBuffer = new Uint8Array(PROJECT_ARCHIVE_CHUNK_BYTES)
  let encodeOutputLength = 0

  const fail = (message: string): void => {
    if (state === 'closed') return
    state = 'closed'
    tail = undefined
    extraction = undefined
    digestHash = undefined
    try {
      archiveZip?.terminate()
    } catch {
      // Worker failure cleanup is best-effort.
    }
    archiveZip = undefined
    encodeEntry = undefined
    postResponse({
      type: 'error',
      generation,
      code: 'PROJECT_ARCHIVE_WORKER_FAILED',
      message,
    })
  }

  const emitEncodeOutput = (final: boolean): void => {
    if (encodeOutputLength > 0) {
      const bytes = encodeOutputBuffer.slice(0, encodeOutputLength).buffer
      encodeOutputLength = 0
      postResponse({
        type: 'encode-output',
        generation,
        sequence: encodeOutputSequence++,
        bytes,
        final,
      }, [bytes])
      return
    }
    if (final) throw new Error('ZIP encoder produced no final output bytes.')
  }

  const collectEncodeOutput = (chunk: Uint8Array, final: boolean): void => {
    let offset = 0
    while (offset < chunk.byteLength) {
      const copied = Math.min(
        PROJECT_ARCHIVE_CHUNK_BYTES - encodeOutputLength,
        chunk.byteLength - offset,
      )
      encodeOutputBuffer.set(chunk.subarray(offset, offset + copied), encodeOutputLength)
      encodeOutputLength += copied
      offset += copied
      if (
        encodeOutputLength === PROJECT_ARCHIVE_CHUNK_BYTES &&
        (offset < chunk.byteLength || !final)
      ) {
        emitEncodeOutput(false)
      }
    }
    if (final) {
      emitEncodeOutput(true)
      archiveZip = undefined
      encodeEntry = undefined
      state = 'closed'
    }
  }

  const validateEncodeDescriptors = (
    value: unknown,
  ): readonly ProjectArchiveEncodeDescriptor[] => {
    if (!Array.isArray(value) || value.length === 0 || value.length > PROJECT_ARCHIVE_MAX_ENTRIES) {
      throw new Error('ZIP encode entry count is outside the Project limit.')
    }
    const paths = new Set<string>()
    let previousPath = ''
    let sourceBytes = 0
    let jsonBytes = 0
    return Object.freeze(value.map((candidate, index) => {
      const record = exactRecord(candidate, ['path', 'byteLength', 'compression'])
        ? candidate
        : undefined
      if (
        record === undefined ||
        typeof record.path !== 'string' ||
        !safeArchivePath(record.path) ||
        !Number.isSafeInteger(record.byteLength) ||
        (record.byteLength as number) <= 0 ||
        (record.compression !== 'store' && record.compression !== 'deflate')
      ) {
        throw new Error(`ZIP encode descriptor ${index} is invalid.`)
      }
      const path = record.path
      const byteLength = record.byteLength as number
      if (index > 0 && path <= previousPath) {
        throw new Error('ZIP encode paths must be unique and sorted by code unit.')
      }
      previousPath = path
      if (paths.has(path)) throw new Error(`Duplicate ZIP encode path: ${path}.`)
      paths.add(path)
      if (byteLength > entryLimit(path)) {
        throw new Error(`ZIP encode entry ${path} exceeds its expanded-size limit.`)
      }
      if (path.endsWith('.step')) sourceBytes += byteLength
      else jsonBytes += byteLength
      if (sourceBytes > MAX_PROJECT_SOURCE_BYTES || jsonBytes > PROJECT_ARCHIVE_MAX_JSON_BYTES) {
        throw new Error('ZIP encode payloads exceed the aggregate Project limits.')
      }
      return Object.freeze({
        path,
        byteLength,
        compression: record.compression,
      }) as ProjectArchiveEncodeDescriptor
    }))
  }

  const requestExtractionRange = (): void => {
    const active = extraction!
    const remaining = active.record.spanEnd - active.nextOffset
    active.expectedLength = Math.min(PROJECT_ARCHIVE_CHUNK_BYTES, remaining)
    postResponse({
      type: 'extract-range',
      generation,
      path: active.record.path,
      offset: active.nextOffset,
      length: active.expectedLength,
    })
  }

  const beginExtraction = (record: ProjectArchiveCentralEntry): void => {
    let active!: ActiveExtraction
    const output = new Uint8Array(record.uncompressedSize)
    const inflate = record.compression === 8
      ? new Inflate((chunk) => {
          if (active.outputOffset + chunk.byteLength > active.output.byteLength) {
            throw new Error(`Expanded ZIP entry ${record.path} exceeds its declared size.`)
          }
          active.output.set(chunk, active.outputOffset)
          active.outputOffset += chunk.byteLength
          active.crc = updateCrc32(active.crc, chunk)
        })
      : undefined
    active = {
      record,
      output,
      descriptor: new Uint8Array(16),
      inflate,
      dataOffset: 0,
      dataEnd: 0,
      nextOffset: record.localOffset,
      expectedLength: 0,
      outputOffset: 0,
      descriptorOffset: 0,
      crc: 0xffffffff,
      headerParsed: false,
      compressedFinalized: false,
    }
    extraction = active
    state = 'extract'
    requestExtractionRange()
  }

  const parseLocalHeader = (active: ActiveExtraction, bytes: Uint8Array): void => {
    if (bytes.byteLength < 30) throw new Error(`ZIP local header for ${active.record.path} is truncated.`)
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    if (view.getUint32(0, true) !== 0x04034b50) {
      throw new Error(`ZIP local header signature for ${active.record.path} is invalid.`)
    }
    const versionNeeded = view.getUint16(4, true)
    const flags = view.getUint16(6, true)
    const compression = view.getUint16(8, true)
    const localCrc32 = view.getUint32(14, true)
    const localCompressedSize = view.getUint32(18, true)
    const localUncompressedSize = view.getUint32(22, true)
    const nameLength = view.getUint16(26, true)
    const extraLength = view.getUint16(28, true)
    const headerLength = 30 + nameLength + extraLength
    if (versionNeeded >= 45) throw new Error('ZIP64 local entries are unsupported.')
    if (headerLength > bytes.byteLength) {
      throw new Error(`ZIP local header for ${active.record.path} exceeds one bounded chunk.`)
    }
    if (flags !== active.record.flags || compression !== active.record.compression) {
      throw new Error(`ZIP local flags or compression for ${active.record.path} conflict with the central entry.`)
    }
    let localPath: string
    try {
      localPath = decoder.decode(bytes.subarray(30, 30 + nameLength))
    } catch {
      throw new Error(`ZIP local path for ${active.record.path} is not valid UTF-8.`)
    }
    if (localPath !== active.record.path || !safeArchivePath(localPath)) {
      throw new Error(`ZIP local path ${localPath} conflicts with central path ${active.record.path}.`)
    }
    inspectExtra(bytes, 30 + nameLength, extraLength)
    const hasDescriptor = (flags & 0x0008) !== 0
    if (!hasDescriptor && (
      localCrc32 !== active.record.crc32 ||
      localCompressedSize !== active.record.compressedSize ||
      localUncompressedSize !== active.record.uncompressedSize
    )) {
      throw new Error(`ZIP local CRC or sizes for ${active.record.path} conflict with the central entry.`)
    }
    if (hasDescriptor && (
      (localCrc32 !== 0 && localCrc32 !== active.record.crc32) ||
      (localCompressedSize !== 0 && localCompressedSize !== active.record.compressedSize) ||
      (localUncompressedSize !== 0 && localUncompressedSize !== active.record.uncompressedSize)
    )) {
      throw new Error(`ZIP streaming local fields for ${active.record.path} conflict with the central entry.`)
    }
    active.dataOffset = active.record.localOffset + headerLength
    active.dataEnd = active.dataOffset + active.record.compressedSize
    const descriptorLength = active.record.spanEnd - active.dataEnd
    if (
      (hasDescriptor && descriptorLength !== 12 && descriptorLength !== 16) ||
      (!hasDescriptor && descriptorLength !== 0)
    ) {
      throw new Error(`ZIP local span or data descriptor for ${active.record.path} is inconsistent.`)
    }
    if (
      active.record.compression === 0 &&
      active.record.compressedSize !== active.record.uncompressedSize
    ) {
      throw new Error(`Stored ZIP entry ${active.record.path} has inconsistent sizes.`)
    }
    active.headerParsed = true
  }

  const consumeExtractionChunk = (active: ActiveExtraction, bytes: Uint8Array): void => {
    if (!active.headerParsed) parseLocalHeader(active, bytes)
    const chunkStart = active.nextOffset
    const chunkEnd = chunkStart + bytes.byteLength
    const dataStart = Math.max(active.dataOffset, chunkStart)
    const dataEnd = Math.min(active.dataEnd, chunkEnd)
    if (dataEnd > dataStart) {
      const compressed = bytes.subarray(dataStart - chunkStart, dataEnd - chunkStart)
      const final = dataEnd === active.dataEnd
      if (active.record.compression === 0) {
        if (active.outputOffset + compressed.byteLength > active.output.byteLength) {
          throw new Error(`Stored ZIP entry ${active.record.path} exceeds its declared size.`)
        }
        active.output.set(compressed, active.outputOffset)
        active.outputOffset += compressed.byteLength
        active.crc = updateCrc32(active.crc, compressed)
      } else {
        active.inflate!.push(compressed, final)
      }
      if (final) active.compressedFinalized = true
    } else if (active.record.compressedSize === 0 && !active.compressedFinalized) {
      if (active.record.compression === 8) active.inflate!.push(new Uint8Array(), true)
      active.compressedFinalized = true
    }
    const descriptorStart = Math.max(active.dataEnd, chunkStart)
    const descriptorEnd = Math.min(active.record.spanEnd, chunkEnd)
    if (descriptorEnd > descriptorStart) {
      const descriptorChunk = bytes.subarray(
        descriptorStart - chunkStart,
        descriptorEnd - chunkStart,
      )
      active.descriptor.set(descriptorChunk, active.descriptorOffset)
      active.descriptorOffset += descriptorChunk.byteLength
    }
    active.nextOffset = chunkEnd
  }

  const finishExtraction = (active: ActiveExtraction): void => {
    if (!active.compressedFinalized || active.outputOffset !== active.output.byteLength) {
      throw new Error(`Expanded ZIP entry ${active.record.path} length is inconsistent.`)
    }
    const crc32 = (active.crc ^ 0xffffffff) >>> 0
    if (crc32 !== active.record.crc32) {
      throw new Error(`ZIP CRC mismatch for ${active.record.path}.`)
    }
    if ((active.record.flags & 0x0008) !== 0) {
      const descriptor = new DataView(
        active.descriptor.buffer,
        active.descriptor.byteOffset,
        active.descriptorOffset,
      )
      const signed = active.descriptorOffset === 16
      if (signed && descriptor.getUint32(0, true) !== 0x08074b50) {
        throw new Error(`ZIP signed data descriptor for ${active.record.path} is invalid.`)
      }
      const fieldOffset = signed ? 4 : 0
      if (
        descriptor.getUint32(fieldOffset, true) !== active.record.crc32 ||
        descriptor.getUint32(fieldOffset + 4, true) !== active.record.compressedSize ||
        descriptor.getUint32(fieldOffset + 8, true) !== active.record.uncompressedSize
      ) {
        throw new Error(`ZIP data descriptor for ${active.record.path} conflicts with the central entry.`)
      }
    }
    const auxiliaryBytes =
      active.output.byteLength + PROJECT_ARCHIVE_CHUNK_BYTES + centralEntries.length * 256
    if (auxiliaryBytes > PROJECT_ARCHIVE_MAX_AUXILIARY_BYTES) {
      throw new Error('Archive extraction exceeded the auxiliary workspace limit.')
    }
    const output = active.output.buffer
    extraction = undefined
    state = 'ready'
    postResponse({
      type: 'entry-data',
      generation,
      path: active.record.path,
      bytes: output,
      auxiliaryBytes,
    }, [output])
  }

  return {
    handle(message) {
      if (state === 'closed') return
      if (
        exactRecord(message, ['type', 'generation']) &&
        message.type === 'cancel' &&
        Number.isSafeInteger(message.generation)
      ) {
        const cancelledGeneration = message.generation as number
        state = 'closed'
        tail = undefined
        postResponse({ type: 'cancelled', generation: cancelledGeneration })
        return
      }
      if (state === 'idle') {
        if (
          exactRecord(message, ['type', 'generation', 'key', 'totalBytes']) &&
          message.type === 'digest-start'
        ) {
          if (
            !Number.isSafeInteger(message.generation) ||
            typeof message.key !== 'string' ||
            message.key.length === 0 ||
            !Number.isSafeInteger(message.totalBytes) ||
            (message.totalBytes as number) <= 0 ||
            (message.totalBytes as number) > MAX_OBJECT_ASSET_BYTES
          ) {
            fail('Archive digest initialization is invalid.')
            return
          }
          if (generation !== -1 && message.generation !== generation) {
            fail('Archive digest generation changed within one operation.')
            return
          }
          generation = message.generation as number
          digestKey = message.key
          digestTotalBytes = message.totalBytes as number
          digestReceivedBytes = 0
          digestSequence = 0
          digestHash = createIncrementalSha256()
          state = 'digest'
          postResponse({
            type: 'digest-ready',
            generation,
            key: digestKey,
            totalBytes: digestTotalBytes,
          })
          return
        }
        if (
          exactRecord(message, ['type', 'generation', 'entries']) &&
          message.type === 'encode-start'
        ) {
          if (!Number.isSafeInteger(message.generation)) {
            fail('Archive encode generation is invalid.')
            return
          }
          generation = message.generation as number
          try {
            encodeDescriptors = validateEncodeDescriptors(message.entries)
            encodeNextEntryIndex = 0
            encodeEntryIndex = -1
            encodeOutputSequence = 0
            encodeOutputLength = 0
            encodeOutputBuffer = new Uint8Array(PROJECT_ARCHIVE_CHUNK_BYTES)
            state = 'encode'
            archiveZip = new Zip((error, chunk, final) => {
              if (error !== null) {
                fail(error.message)
                return
              }
              try {
                collectEncodeOutput(chunk, final)
              } catch (caught) {
                fail(caught instanceof Error ? caught.message : 'ZIP output collection failed.')
              }
            })
            postResponse({
              type: 'encode-ready',
              generation,
              entryCount: encodeDescriptors.length,
            })
          } catch (error) {
            fail(error instanceof Error ? error.message : 'Archive encode plan is invalid.')
          }
          return
        }
        if (!exactRecord(message, [
          'type', 'generation', 'totalBytes', 'tailOffset', 'tailLength',
        ]) || message.type !== 'inspect-start') {
          fail('Expected inspect-start as the first archive Worker message.')
          return
        }
        if (
          !Number.isSafeInteger(message.generation) ||
          !Number.isSafeInteger(message.totalBytes) ||
          !Number.isSafeInteger(message.tailOffset) ||
          !Number.isSafeInteger(message.tailLength)
        ) {
          fail('Archive inspection lengths and generation must be safe integers.')
          return
        }
        generation = message.generation as number
        totalBytes = message.totalBytes as number
        tailOffset = message.tailOffset as number
        const tailLength = message.tailLength as number
        if (
          totalBytes < 22 ||
          totalBytes > PROJECT_ARCHIVE_MAX_COMPRESSED_BYTES ||
          tailLength < 22 ||
          tailLength > PROJECT_ARCHIVE_MAX_CENTRAL_BYTES ||
          tailOffset !== totalBytes - tailLength
        ) {
          fail('Archive inspection range is outside the frozen limits.')
          return
        }
        tail = new Uint8Array(tailLength)
        state = 'inspect'
        postResponse({ type: 'inspect-ready', generation, tailLength })
        return
      }
      if (state === 'inspect') {
        if (!exactRecord(message, [
          'type', 'generation', 'sequence', 'offset', 'bytes', 'final',
        ]) || message.type !== 'inspect-chunk') {
          fail('Expected the canonical next archive inspection chunk.')
          return
        }
        if (
          message.generation !== generation ||
          message.sequence !== nextSequence ||
          message.offset !== tailOffset + receivedBytes ||
          !isArrayBuffer(message.bytes) ||
          typeof message.final !== 'boolean'
        ) {
          fail('Archive inspection chunk order or fields are invalid.')
          return
        }
        const bytes = new Uint8Array(message.bytes)
        const expectedLength = Math.min(
          PROJECT_ARCHIVE_CHUNK_BYTES,
          tail!.byteLength - receivedBytes,
        )
        const expectedFinal = receivedBytes + expectedLength === tail!.byteLength
        if (bytes.byteLength !== expectedLength || message.final !== expectedFinal) {
          fail('Archive inspection chunk length is not canonical.')
          return
        }
        tail!.set(bytes, receivedBytes)
        receivedBytes += bytes.byteLength
        const sequence = nextSequence
        nextSequence += 1
        postResponse({
          type: 'inspect-ack',
          generation,
          sequence,
          receivedBytes,
        })
        if (expectedFinal) {
          try {
            const entries = parseCentralDirectory(tail!, tailOffset, totalBytes)
            const auxiliaryBytes = tail!.byteLength
            tail = undefined
            centralEntries = entries
            state = 'ready'
            postResponse({
              type: 'central-ready',
              generation,
              entries,
              auxiliaryBytes,
            })
          } catch (error) {
            fail(error instanceof Error ? error.message : 'Archive central directory is invalid.')
          }
        }
        return
      }
      if (state === 'ready') {
        if (!exactRecord(message, ['type', 'generation', 'path']) || message.type !== 'extract-start') {
          fail('Expected extract-start after archive inspection.')
          return
        }
        if (message.generation !== generation || typeof message.path !== 'string') {
          fail('Archive extraction request is malformed.')
          return
        }
        const record = centralEntries.find(({ path }) => path === message.path)
        if (record === undefined) {
          fail(`Archive entry ${message.path} is not present in the validated central directory.`)
          return
        }
        try {
          beginExtraction(record)
        } catch (error) {
          fail(error instanceof Error ? error.message : 'Archive entry extraction could not start.')
        }
        return
      }
      if (state === 'extract') {
        if (!exactRecord(message, [
          'type', 'generation', 'path', 'offset', 'bytes',
        ]) || message.type !== 'extract-chunk') {
          fail('Expected the canonical next archive extraction chunk.')
          return
        }
        const active = extraction!
        if (
          message.generation !== generation ||
          message.path !== active.record.path ||
          message.offset !== active.nextOffset ||
          !isArrayBuffer(message.bytes) ||
          message.bytes.byteLength !== active.expectedLength
        ) {
          fail('Archive extraction chunk order or length is invalid.')
          return
        }
        try {
          consumeExtractionChunk(active, new Uint8Array(message.bytes))
          if (active.nextOffset === active.record.spanEnd) finishExtraction(active)
          else requestExtractionRange()
        } catch (error) {
          fail(error instanceof Error ? error.message : 'Archive entry extraction failed.')
        }
        return
      }
      if (state === 'digest') {
        if (!exactRecord(message, [
          'type', 'generation', 'key', 'sequence', 'offset', 'bytes', 'final',
        ]) || message.type !== 'digest-chunk') {
          fail('Expected the canonical next archive digest chunk.')
          return
        }
        if (
          message.generation !== generation ||
          message.key !== digestKey ||
          message.sequence !== digestSequence ||
          message.offset !== digestReceivedBytes ||
          !isArrayBuffer(message.bytes) ||
          typeof message.final !== 'boolean'
        ) {
          fail('Archive digest chunk order or fields are invalid.')
          return
        }
        const bytes = new Uint8Array(message.bytes)
        const expectedLength = Math.min(
          PROJECT_ARCHIVE_CHUNK_BYTES,
          digestTotalBytes - digestReceivedBytes,
        )
        const expectedFinal = digestReceivedBytes + expectedLength === digestTotalBytes
        if (bytes.byteLength !== expectedLength || message.final !== expectedFinal) {
          fail('Archive digest chunk length is not canonical.')
          return
        }
        try {
          digestHash!.update(bytes)
          digestReceivedBytes += bytes.byteLength
          const sequence = digestSequence++
          postResponse({
            type: 'digest-ack',
            generation,
            key: digestKey,
            sequence,
            receivedBytes: digestReceivedBytes,
          })
          if (expectedFinal) {
            const sha256 = digestHash!.digestHex()
            digestHash = undefined
            state = 'idle'
            postResponse({
              type: 'digest',
              generation,
              key: digestKey,
              sha256,
              totalBytes: digestTotalBytes,
            })
          }
        } catch (error) {
          fail(error instanceof Error ? error.message : 'Archive digest failed.')
        }
        return
      }
      if (state === 'encode') {
        if (
          exactRecord(message, ['type', 'generation', 'index']) &&
          message.type === 'encode-entry-start'
        ) {
          if (
            message.generation !== generation ||
            message.index !== encodeNextEntryIndex ||
            encodeEntry !== undefined
          ) {
            fail('Archive encode entry order is invalid.')
            return
          }
          const descriptor = encodeDescriptors[encodeNextEntryIndex]
          if (descriptor === undefined) {
            fail('Archive encode entry index exceeds the plan.')
            return
          }
          encodeEntryIndex = encodeNextEntryIndex
          encodeReceivedBytes = 0
          encodeInputSequence = 0
          encodeEntry = descriptor.compression === 'store'
            ? new ZipPassThrough(descriptor.path)
            : new ZipDeflate(descriptor.path, { level: 6 })
          encodeEntry.mtime = new Date(1980, 0, 1, 0, 0, 0, 0)
          encodeEntry.os = 0
          encodeEntry.attrs = 0
          archiveZip!.add(encodeEntry)
          postResponse({
            type: 'encode-entry-ready',
            generation,
            index: encodeEntryIndex,
          })
          return
        }
        if (
          exactRecord(message, [
            'type', 'generation', 'index', 'sequence', 'offset', 'bytes', 'final',
          ]) && message.type === 'encode-chunk'
        ) {
          const descriptor = encodeDescriptors[encodeEntryIndex]
          if (
            descriptor === undefined ||
            encodeEntry === undefined ||
            message.generation !== generation ||
            message.index !== encodeEntryIndex ||
            message.sequence !== encodeInputSequence ||
            message.offset !== encodeReceivedBytes ||
            !isArrayBuffer(message.bytes) ||
            typeof message.final !== 'boolean'
          ) {
            fail('Archive encode chunk order or fields are invalid.')
            return
          }
          const bytes = new Uint8Array(message.bytes)
          const expectedLength = Math.min(
            PROJECT_ARCHIVE_CHUNK_BYTES,
            descriptor.byteLength - encodeReceivedBytes,
          )
          const expectedFinal = encodeReceivedBytes + expectedLength === descriptor.byteLength
          if (bytes.byteLength !== expectedLength || message.final !== expectedFinal) {
            fail('Archive encode chunk length is not canonical.')
            return
          }
          try {
            encodeEntry.push(bytes, expectedFinal)
            encodeReceivedBytes += bytes.byteLength
            const sequence = encodeInputSequence++
            postResponse({
              type: 'encode-ack',
              generation,
              index: encodeEntryIndex,
              sequence,
              receivedBytes: encodeReceivedBytes,
            })
            if (expectedFinal) {
              encodeEntry = undefined
              encodeNextEntryIndex += 1
              if (encodeNextEntryIndex === encodeDescriptors.length) archiveZip!.end()
            }
          } catch (error) {
            fail(error instanceof Error ? error.message : 'Archive encode failed.')
          }
          return
        }
        fail('Expected encode-entry-start or the canonical next encode chunk.')
        return
      }
      fail('Unknown or out-of-order archive Worker message.')
    },
  }
}

interface ArchiveByteSource {
  readonly size: number
  read(offset: number, length: number): Promise<ArrayBuffer>
}

function byteSource(source: Blob | Uint8Array | ArrayBuffer): ArchiveByteSource {
  if (source instanceof Blob) {
    return {
      size: source.size,
      read(offset, length) {
        return source.slice(offset, offset + length).arrayBuffer()
      },
    }
  }
  const view = source instanceof Uint8Array ? source : new Uint8Array(source)
  return {
    size: view.byteLength,
    read(offset, length) {
      return Promise.resolve(view.slice(offset, offset + length).buffer)
    },
  }
}

class WorkerChannel {
  private readonly worker: ProjectArchiveWorkerLike
  private readonly generation: number
  private readonly queue: ProjectArchiveWorkerResponse[] = []
  private readonly waiters: {
    readonly resolve: (response: ProjectArchiveWorkerResponse) => void
    readonly reject: (error: unknown) => void
  }[] = []
  private readonly watchdog: ReturnType<typeof setTimeout>
  private closed = false
  private failure: ProjectArchiveError | undefined
  private removeAbort = (): void => {}

  constructor(
    workerFactory: () => ProjectArchiveWorkerLike,
    generation: number,
    signal?: AbortSignal,
  ) {
    this.generation = generation
    try {
      this.worker = workerFactory()
    } catch (error) {
      throw new ProjectArchiveError(
        'PROJECT_ARCHIVE_WORKER_UNAVAILABLE',
        'Archive Worker construction failed.',
        error,
      )
    }
    this.worker.onmessage = (event) => {
      if (this.closed) return
      const response = event.data
      if (
        typeof response !== 'object' ||
        response === null ||
        !('generation' in response) ||
        response.generation !== this.generation
      ) {
        this.fail(new ProjectArchiveError(
          'PROJECT_ARCHIVE_WORKER_FAILED',
          'Archive Worker response generation is malformed or stale.',
        ))
        return
      }
      if (response.type === 'error') {
        this.fail(new ProjectArchiveError(
          'PROJECT_ARCHIVE_WORKER_FAILED',
          response.message,
        ))
        return
      }
      const waiter = this.waiters.shift()
      if (waiter === undefined) this.queue.push(response)
      else waiter.resolve(response)
    }
    this.worker.onerror = (event) => this.fail(new ProjectArchiveError(
      'PROJECT_ARCHIVE_WORKER_FAILED',
      'Archive Worker emitted an error.',
      event,
    ))
    this.worker.onmessageerror = (event) => this.fail(new ProjectArchiveError(
      'PROJECT_ARCHIVE_WORKER_FAILED',
      'Archive Worker emitted a messageerror.',
      event,
    ))
    const onAbort = (): void => {
      if (this.closed) return
      try {
        this.worker.postMessage({ type: 'cancel', generation: this.generation })
      } catch {
        // Cancellation still terminates synchronously.
      }
      this.fail(new ProjectArchiveError(
        'PROJECT_ARCHIVE_CANCELLED',
        'Archive operation was cancelled.',
      ))
    }
    signal?.addEventListener('abort', onAbort, { once: true })
    this.removeAbort = () => signal?.removeEventListener('abort', onAbort)
    this.watchdog = setTimeout(() => this.fail(new ProjectArchiveError(
      'PROJECT_ARCHIVE_TIMEOUT',
      `Archive operation exceeded ${PROJECT_ARCHIVE_TIMEOUT_MS} ms.`,
    )), PROJECT_ARCHIVE_TIMEOUT_MS)
    if (signal?.aborted === true) onAbort()
  }

  post(message: ProjectArchiveWorkerRequest, transfer?: Transferable[]): void {
    if (this.failure !== undefined) throw this.failure
    try {
      this.worker.postMessage(message, transfer)
    } catch (error) {
      const failure = new ProjectArchiveError(
        'PROJECT_ARCHIVE_WORKER_FAILED',
        'Archive Worker postMessage failed.',
        error,
      )
      this.fail(failure)
      throw failure
    }
  }

  next(): Promise<ProjectArchiveWorkerResponse> {
    if (this.failure !== undefined) return Promise.reject(this.failure)
    const queued = this.queue.shift()
    if (queued !== undefined) return Promise.resolve(queued)
    return new Promise((resolve, reject) => this.waiters.push({ resolve, reject }))
  }

  assertNoQueuedResponses(): void {
    if (this.failure !== undefined) throw this.failure
    if (this.queue.length !== 0) {
      throw new ProjectArchiveError(
        'PROJECT_ARCHIVE_WORKER_FAILED',
        'Archive Worker returned data after the terminal response.',
      )
    }
  }

  close(): void {
    if (this.closed) return
    this.closed = true
    clearTimeout(this.watchdog)
    this.removeAbort()
    this.worker.onmessage = null
    this.worker.onerror = null
    this.worker.onmessageerror = null
    try {
      this.worker.terminate()
    } catch {
      // Worker cleanup is best-effort after the result is settled.
    }
  }

  private fail(error: ProjectArchiveError): void {
    if (this.closed) return
    this.failure = error
    for (const waiter of this.waiters.splice(0)) waiter.reject(error)
    this.close()
  }
}

let nextGeneration = 1

function defaultWorkerFactory(): ProjectArchiveWorkerLike {
  return new Worker(new URL('./project-archive-worker.ts', import.meta.url), {
    type: 'module',
    name: 'project-archive-codec',
  }) as unknown as ProjectArchiveWorkerLike
}

export class ProjectArchiveCodecWorker {
  private readonly workerFactory: () => ProjectArchiveWorkerLike

  constructor(options: { readonly workerFactory?: () => ProjectArchiveWorkerLike } = {}) {
    this.workerFactory = options.workerFactory ?? defaultWorkerFactory
  }

  async digestSources(
    sources: readonly ProjectArchiveDigestInput[],
    signal?: AbortSignal,
  ): Promise<ReadonlyMap<string, string>> {
    if (!Array.isArray(sources) || sources.length === 0) {
      throw new ProjectArchiveError(
        'PROJECT_ARCHIVE_INPUT_INVALID',
        'Archive digest sources must be a non-empty array.',
      )
    }
    const keys = new Set<string>()
    for (const source of sources) {
      if (
        typeof source.key !== 'string' ||
        source.key.length === 0 ||
        keys.has(source.key) ||
        !isArrayBuffer(source.bytes) ||
        source.bytes.byteLength <= 0 ||
        source.bytes.byteLength > MAX_OBJECT_ASSET_BYTES
      ) {
        throw new ProjectArchiveError(
          'PROJECT_ARCHIVE_INPUT_INVALID',
          'Archive digest source key or bytes are invalid.',
        )
      }
      keys.add(source.key)
    }
    const generation = nextGeneration++
    const channel = new WorkerChannel(this.workerFactory, generation, signal)
    const digests = new Map<string, string>()
    try {
      for (const source of sources) {
        channel.post({
          type: 'digest-start',
          generation,
          key: source.key,
          totalBytes: source.bytes.byteLength,
        })
        const ready = await channel.next()
        if (
          ready.type !== 'digest-ready' ||
          ready.key !== source.key ||
          ready.totalBytes !== source.bytes.byteLength
        ) {
          throw new ProjectArchiveError(
            'PROJECT_ARCHIVE_WORKER_FAILED',
            'Archive Worker digest-ready response is malformed.',
          )
        }
        let offset = 0
        let sequence = 0
        const view = new Uint8Array(source.bytes)
        while (offset < view.byteLength) {
          const length = Math.min(PROJECT_ARCHIVE_CHUNK_BYTES, view.byteLength - offset)
          const bytes = view.slice(offset, offset + length).buffer
          const final = offset + length === view.byteLength
          channel.post({
            type: 'digest-chunk',
            generation,
            key: source.key,
            sequence,
            offset,
            bytes,
            final,
          }, [bytes])
          const ack = await channel.next()
          offset += length
          if (
            ack.type !== 'digest-ack' ||
            ack.key !== source.key ||
            ack.sequence !== sequence ||
            ack.receivedBytes !== offset
          ) {
            throw new ProjectArchiveError(
              'PROJECT_ARCHIVE_WORKER_FAILED',
              'Archive Worker digest acknowledgement is malformed or out of order.',
            )
          }
          sequence += 1
        }
        const result = await channel.next()
        if (
          result.type !== 'digest' ||
          result.key !== source.key ||
          result.totalBytes !== source.bytes.byteLength ||
          !/^[0-9a-f]{64}$/.test(result.sha256)
        ) {
          throw new ProjectArchiveError(
            'PROJECT_ARCHIVE_WORKER_FAILED',
            'Archive Worker digest response is malformed.',
          )
        }
        digests.set(source.key, result.sha256)
      }
      return digests
    } finally {
      channel.close()
    }
  }

  async encode(
    entries: readonly ProjectArchiveEncodeEntry[],
    signal?: AbortSignal,
  ): Promise<Blob> {
    if (!Array.isArray(entries) || entries.length === 0) {
      throw new ProjectArchiveError(
        'PROJECT_ARCHIVE_INPUT_INVALID',
        'Archive encode entries must be a non-empty array.',
      )
    }
    const descriptors = entries.map(({ path, bytes, compression }) => {
      if (!isArrayBuffer(bytes)) {
        throw new ProjectArchiveError(
          'PROJECT_ARCHIVE_INPUT_INVALID',
          `Archive encode entry ${path} bytes must be an ArrayBuffer.`,
        )
      }
      return { path, byteLength: bytes.byteLength, compression }
    })
    const generation = nextGeneration++
    const channel = new WorkerChannel(this.workerFactory, generation, signal)
    const parts: ArrayBuffer[] = []
    let outputSequence = 0
    let outputFinal = false
    let outputBytes = 0
    let lastInputAcknowledged = false
    const consumeOutput = (response: ProjectArchiveWorkerResponse): boolean => {
      if (response.type !== 'encode-output') return false
      if (
        response.sequence !== outputSequence ||
        !isArrayBuffer(response.bytes) ||
        response.bytes.byteLength <= 0 ||
        response.bytes.byteLength > PROJECT_ARCHIVE_CHUNK_BYTES ||
        (!response.final && response.bytes.byteLength !== PROJECT_ARCHIVE_CHUNK_BYTES) ||
        (response.final && !lastInputAcknowledged) ||
        outputFinal
      ) {
        throw new ProjectArchiveError(
          'PROJECT_ARCHIVE_WORKER_FAILED',
          'Archive Worker output chunk is malformed or out of order.',
        )
      }
      outputSequence += 1
      outputFinal = response.final
      outputBytes += response.bytes.byteLength
      if (outputBytes > PROJECT_ARCHIVE_MAX_COMPRESSED_BYTES) {
        throw new ProjectArchiveError(
          'PROJECT_ARCHIVE_WORKER_FAILED',
          'Archive Worker output exceeds the compressed archive limit.',
        )
      }
      parts.push(response.bytes)
      return true
    }
    const waitFor = async <Type extends ProjectArchiveWorkerResponse['type']>(
      type: Type,
    ): Promise<Extract<ProjectArchiveWorkerResponse, { readonly type: Type }>> => {
      while (true) {
        const response = await channel.next()
        if (consumeOutput(response)) continue
        if (response.type !== type) {
          throw new ProjectArchiveError(
            'PROJECT_ARCHIVE_WORKER_FAILED',
            `Archive Worker returned ${response.type} while ${type} was required.`,
          )
        }
        return response as Extract<ProjectArchiveWorkerResponse, { readonly type: Type }>
      }
    }
    try {
      channel.post({ type: 'encode-start', generation, entries: descriptors })
      const ready = await waitFor('encode-ready')
      if (ready.entryCount !== entries.length) {
        throw new ProjectArchiveError(
          'PROJECT_ARCHIVE_WORKER_FAILED',
          'Archive Worker encode-ready response is malformed.',
        )
      }
      for (const [index, entry] of entries.entries()) {
        channel.post({ type: 'encode-entry-start', generation, index })
        const entryReady = await waitFor('encode-entry-ready')
        if (entryReady.index !== index) {
          throw new ProjectArchiveError(
            'PROJECT_ARCHIVE_WORKER_FAILED',
            'Archive Worker entry-ready response is out of order.',
          )
        }
        const view = new Uint8Array(entry.bytes)
        let offset = 0
        let sequence = 0
        while (offset < view.byteLength) {
          const length = Math.min(PROJECT_ARCHIVE_CHUNK_BYTES, view.byteLength - offset)
          const bytes = view.slice(offset, offset + length).buffer
          const final = offset + length === view.byteLength
          channel.post({
            type: 'encode-chunk',
            generation,
            index,
            sequence,
            offset,
            bytes,
            final,
          }, [bytes])
          const ack = await waitFor('encode-ack')
          offset += length
          if (
            ack.index !== index ||
            ack.sequence !== sequence ||
            ack.receivedBytes !== offset
          ) {
            throw new ProjectArchiveError(
              'PROJECT_ARCHIVE_WORKER_FAILED',
              'Archive Worker encode acknowledgement is malformed or out of order.',
            )
          }
          if (final && index === entries.length - 1) lastInputAcknowledged = true
          sequence += 1
        }
      }
      while (!outputFinal) {
        const response = await channel.next()
        if (!consumeOutput(response)) {
          throw new ProjectArchiveError(
            'PROJECT_ARCHIVE_WORKER_FAILED',
            `Archive Worker returned ${response.type} while encode-output was required.`,
          )
        }
      }
      channel.assertNoQueuedResponses()
      return new Blob(parts, { type: 'application/vnd.web-digital-twin' })
    } catch (error) {
      parts.length = 0
      throw error
    } finally {
      channel.close()
    }
  }

  async open(
    source: Blob | Uint8Array | ArrayBuffer,
    signal?: AbortSignal,
  ): Promise<ProjectArchiveReader> {
    const input = byteSource(source)
    if (input.size < 22 || input.size > PROJECT_ARCHIVE_MAX_COMPRESSED_BYTES) {
      throw new ProjectArchiveError(
        'PROJECT_ARCHIVE_INVALID',
        'Compressed archive size is outside the frozen limit.',
      )
    }
    const generation = nextGeneration++
    const channel = new WorkerChannel(this.workerFactory, generation, signal)
    try {
      const tailLength = Math.min(PROJECT_ARCHIVE_MAX_CENTRAL_BYTES, input.size)
      const tailOffset = input.size - tailLength
      channel.post({
        type: 'inspect-start',
        generation,
        totalBytes: input.size,
        tailOffset,
        tailLength,
      })
      const ready = await channel.next()
      if (ready.type !== 'inspect-ready' || ready.tailLength !== tailLength) {
        throw new ProjectArchiveError(
          'PROJECT_ARCHIVE_WORKER_FAILED',
          'Archive Worker inspect-ready response is malformed.',
        )
      }
      let receivedBytes = 0
      let sequence = 0
      while (receivedBytes < tailLength) {
        const length = Math.min(PROJECT_ARCHIVE_CHUNK_BYTES, tailLength - receivedBytes)
        const bytes = await input.read(tailOffset + receivedBytes, length)
        if (bytes.byteLength !== length) {
          throw new ProjectArchiveError(
            'PROJECT_ARCHIVE_INPUT_FAILED',
            'Archive input returned a truncated inspection chunk.',
          )
        }
        const final = receivedBytes + length === tailLength
        channel.post({
          type: 'inspect-chunk',
          generation,
          sequence,
          offset: tailOffset + receivedBytes,
          bytes,
          final,
        }, [bytes])
        const ack = await channel.next()
        receivedBytes += length
        if (
          ack.type !== 'inspect-ack' ||
          ack.sequence !== sequence ||
          ack.receivedBytes !== receivedBytes
        ) {
          throw new ProjectArchiveError(
            'PROJECT_ARCHIVE_WORKER_FAILED',
            'Archive Worker inspection acknowledgement is malformed or out of order.',
          )
        }
        sequence += 1
      }
      const central = await channel.next()
      if (
        central.type !== 'central-ready' ||
        !Array.isArray(central.entries) ||
        !Number.isSafeInteger(central.auxiliaryBytes) ||
        central.auxiliaryBytes < 0 ||
        central.auxiliaryBytes > PROJECT_ARCHIVE_MAX_AUXILIARY_BYTES
      ) {
        throw new ProjectArchiveError(
          'PROJECT_ARCHIVE_WORKER_FAILED',
          'Archive Worker central-directory response is malformed.',
        )
      }
      let entries: readonly ProjectArchiveCentralEntry[]
      try {
        entries = validateCentralResponseEntries(central.entries, input.size)
      } catch (error) {
        throw new ProjectArchiveError(
          'PROJECT_ARCHIVE_WORKER_FAILED',
          'Archive Worker central-directory response is invalid.',
          error,
        )
      }
      const entriesByPath = new Map(entries.map((entry) => [entry.path, entry] as const))
      let reading = false
      let readerClosed = false
      return Object.freeze({
        entries,
        readEntry: async (path: string) => {
          if (readerClosed) {
            throw new ProjectArchiveError('PROJECT_ARCHIVE_READER_CLOSED', 'Archive reader is closed.')
          }
          if (reading) {
            throw new ProjectArchiveError(
              'PROJECT_ARCHIVE_WORKER_FAILED',
              'Archive entries must be expanded sequentially.',
            )
          }
          const record = entriesByPath.get(path)
          if (record === undefined) {
            throw new ProjectArchiveError(
              'PROJECT_ARCHIVE_INVALID',
              `Archive entry ${path} is missing.`,
            )
          }
          reading = true
          try {
            channel.post({ type: 'extract-start', generation, path })
            while (true) {
              const response = await channel.next()
              if (response.type === 'extract-range') {
                if (
                  response.path !== path ||
                  !Number.isSafeInteger(response.offset) ||
                  !Number.isSafeInteger(response.length) ||
                  response.length <= 0 ||
                  response.length > PROJECT_ARCHIVE_CHUNK_BYTES ||
                  response.offset < record.localOffset ||
                  response.offset + response.length > record.spanEnd ||
                  response.offset + response.length > input.size
                ) {
                  throw new ProjectArchiveError(
                    'PROJECT_ARCHIVE_WORKER_FAILED',
                    'Archive Worker requested an invalid extraction range.',
                  )
                }
                const bytes = await input.read(response.offset, response.length)
                if (bytes.byteLength !== response.length) {
                  throw new ProjectArchiveError(
                    'PROJECT_ARCHIVE_INPUT_FAILED',
                    'Archive input returned a truncated extraction chunk.',
                  )
                }
                channel.post({
                  type: 'extract-chunk',
                  generation,
                  path,
                  offset: response.offset,
                  bytes,
                }, [bytes])
                continue
              }
              if (
                response.type !== 'entry-data' ||
                response.path !== path ||
                !isArrayBuffer(response.bytes) ||
                response.bytes.byteLength !== record.uncompressedSize ||
                !Number.isSafeInteger(response.auxiliaryBytes) ||
                response.auxiliaryBytes < 0 ||
                response.auxiliaryBytes > PROJECT_ARCHIVE_MAX_AUXILIARY_BYTES
              ) {
                throw new ProjectArchiveError(
                  'PROJECT_ARCHIVE_WORKER_FAILED',
                  'Archive Worker entry response is malformed.',
                )
              }
              return response.bytes
            }
          } catch (error) {
            readerClosed = true
            channel.close()
            throw error
          } finally {
            reading = false
          }
        },
        finish: () => {
          if (readerClosed) return
          try {
            channel.assertNoQueuedResponses()
          } finally {
            readerClosed = true
            channel.close()
          }
        },
        close: () => {
          if (readerClosed) return
          readerClosed = true
          channel.close()
        },
      })
    } catch (error) {
      channel.close()
      throw error
    }
  }
}

interface WorkerGlobalLike {
  readonly document?: unknown
  readonly close?: () => void
  postMessage?: (message: ProjectArchiveWorkerResponse, transfer?: Transferable[]) => void
  onmessage?: ((event: MessageEvent<unknown>) => void) | null
}

const workerGlobal = globalThis as unknown as WorkerGlobalLike
if (
  workerGlobal.document === undefined &&
  typeof workerGlobal.close === 'function' &&
  typeof workerGlobal.postMessage === 'function'
) {
  const session = createProjectArchiveWorkerSession((response, transfer) =>
    workerGlobal.postMessage!(response, transfer))
  workerGlobal.onmessage = (event) => session.handle(event.data)
}

// Keep the imports tree-shake-visible for the next protocol slices. All ZIP and
// digest work remains inside this dedicated Worker module.
void Inflate
void Zip
void ZipDeflate
void ZipPassThrough
void createIncrementalSha256
