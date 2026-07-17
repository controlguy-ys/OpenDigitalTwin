import {
  canonicalProjectV4Bytes,
  validateWorkcellProjectV4,
  type WorkcellProjectV4,
} from '../../../core/project-v4/index.js'

export type ProjectV4CodecErrorCode =
  | 'PROJECT_JSON_SOURCE_INVALID'
  | 'PROJECT_JSON_ENCODING_INVALID'
  | 'PROJECT_JSON_PARSE_FAILED'

export class ProjectV4CodecError extends Error {
  readonly code: ProjectV4CodecErrorCode
  readonly cause?: unknown

  constructor(code: ProjectV4CodecErrorCode, message: string, cause?: unknown) {
    super(`${code}: ${message}`)
    this.name = 'ProjectV4CodecError'
    this.code = code
    if (cause !== undefined) this.cause = cause
  }
}

const typedArrayPrototype = Object.getPrototypeOf(Uint8Array.prototype) as object
const typedArrayTagGetter = Object.getOwnPropertyDescriptor(
  typedArrayPrototype,
  Symbol.toStringTag,
)?.get as (this: unknown) => string | undefined
const typedArrayLengthGetter = Object.getOwnPropertyDescriptor(
  typedArrayPrototype,
  'length',
)?.get as (this: unknown) => number
const arrayBufferByteLengthGetter = Object.getOwnPropertyDescriptor(
  ArrayBuffer.prototype,
  'byteLength',
)?.get as (this: unknown) => number
const setUint8Array = Uint8Array.prototype.set
const readBlobArrayBuffer = Blob.prototype.arrayBuffer
const applyIntrinsic = Reflect.apply

function failCodec(
  code: ProjectV4CodecErrorCode,
  message: string,
  cause?: unknown,
): never {
  throw new ProjectV4CodecError(code, message, cause)
}

export function encodeProjectV4(project: WorkcellProjectV4): Blob {
  return new Blob([canonicalProjectV4Bytes(project)], {
    type: 'application/json;charset=utf-8',
  })
}

async function snapshotProjectJsonSource(source: unknown): Promise<Uint8Array<ArrayBuffer>> {
  let typedArrayBrand: string | undefined
  try {
    typedArrayBrand = applyIntrinsic(typedArrayTagGetter, source, [])
  } catch {
    typedArrayBrand = undefined
  }

  if (typedArrayBrand === 'Uint8Array') {
    try {
      const length = applyIntrinsic(typedArrayLengthGetter, source, [])
      const snapshot = new Uint8Array(length)
      applyIntrinsic(setUint8Array, snapshot, [source])
      return snapshot
    } catch (error) {
      return failCodec(
        'PROJECT_JSON_SOURCE_INVALID',
        'Project JSON Uint8Array source could not be snapshotted.',
        error,
      )
    }
  }

  let arrayBufferByteLength: number | undefined
  try {
    arrayBufferByteLength = applyIntrinsic(arrayBufferByteLengthGetter, source, [])
  } catch {
    arrayBufferByteLength = undefined
  }

  if (arrayBufferByteLength !== undefined) {
    try {
      const snapshot = new Uint8Array(arrayBufferByteLength)
      const sourceView = new Uint8Array(source as ArrayBuffer)
      applyIntrinsic(setUint8Array, snapshot, [sourceView])
      return snapshot
    } catch (error) {
      return failCodec(
        'PROJECT_JSON_SOURCE_INVALID',
        'Project JSON ArrayBuffer source could not be snapshotted.',
        error,
      )
    }
  }

  try {
    const snapshot = await applyIntrinsic(readBlobArrayBuffer, source, [])
    return new Uint8Array(snapshot)
  } catch (error) {
    return failCodec(
      'PROJECT_JSON_SOURCE_INVALID',
      'Project JSON source must be a Blob, Uint8Array, or ArrayBuffer.',
      error,
    )
  }
}

export async function decodeProjectV4(
  source: Blob | Uint8Array | ArrayBuffer,
): Promise<WorkcellProjectV4> {
  const bytes = await snapshotProjectJsonSource(source)

  let text: string
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch (error) {
    return failCodec(
      'PROJECT_JSON_ENCODING_INVALID',
      'Project JSON source is not valid UTF-8.',
      error,
    )
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(text) as unknown
  } catch (error) {
    return failCodec(
      'PROJECT_JSON_PARSE_FAILED',
      'Project JSON source does not contain exactly one JSON value.',
      error,
    )
  }

  return validateWorkcellProjectV4(parsed)
}
