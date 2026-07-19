import {
  canonicalProjectV5Bytes,
  validateWorkcellProjectV5,
} from '../../../core/project-v5/index.js'
import type { WorkcellProjectV5 } from '../../../core/project-v5/index.js'

export type ProjectV5CodecErrorCode =
  | 'PROJECT_JSON_SOURCE_INVALID'
  | 'PROJECT_JSON_ENCODING_INVALID'
  | 'PROJECT_JSON_PARSE_FAILED'

export class ProjectV5CodecError extends Error {
  readonly code: ProjectV5CodecErrorCode
  readonly cause?: unknown

  constructor(code: ProjectV5CodecErrorCode, message: string, cause?: unknown) {
    super(`${code}: ${message}`)
    this.name = 'ProjectV5CodecError'
    this.code = code
    if (cause !== undefined) this.cause = cause
  }
}

function codecError(
  code: ProjectV5CodecErrorCode,
  message: string,
  cause?: unknown,
): ProjectV5CodecError {
  return new ProjectV5CodecError(code, message, cause)
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

async function snapshotProjectV5Source(source: unknown): Promise<Uint8Array<ArrayBuffer>> {
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
      throw codecError(
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
      throw codecError(
        'PROJECT_JSON_SOURCE_INVALID',
        'Project JSON ArrayBuffer source could not be snapshotted.',
        error,
      )
    }
  }

  try {
    const buffer = await applyIntrinsic(readBlobArrayBuffer, source, [])
    return new Uint8Array(buffer)
  } catch (error) {
    throw codecError(
      'PROJECT_JSON_SOURCE_INVALID',
      'Expected a Blob, Uint8Array, or ArrayBuffer source.',
      error,
    )
  }
}

function decodeUtf8ProjectV5(bytes: Uint8Array<ArrayBuffer>): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    throw codecError('PROJECT_JSON_ENCODING_INVALID', 'Project JSON must be valid UTF-8.')
  }
}

function parseProjectV5Json(json: string): unknown {
  try {
    return JSON.parse(json) as unknown
  } catch {
    throw codecError('PROJECT_JSON_PARSE_FAILED', 'Project source must contain exactly one JSON value.')
  }
}

export function encodeProjectV5(project: WorkcellProjectV5): Blob {
  return new Blob([canonicalProjectV5Bytes(project)], { type: 'application/json;charset=utf-8' })
}

export async function decodeProjectV5(
  source: Blob | Uint8Array | ArrayBuffer,
): Promise<WorkcellProjectV5> {
  const bytes = await snapshotProjectV5Source(source)
  return validateWorkcellProjectV5(parseProjectV5Json(decodeUtf8ProjectV5(bytes)))
}
