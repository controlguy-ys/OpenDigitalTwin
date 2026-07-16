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

export async function decodeProjectV4(
  source: Blob | Uint8Array | ArrayBuffer,
): Promise<WorkcellProjectV4> {
  let bytes: Uint8Array<ArrayBuffer>
  if (source instanceof Blob) {
    bytes = new Uint8Array(await source.arrayBuffer())
  } else if (
    ArrayBuffer.isView(source) &&
    Object.prototype.toString.call(source) === '[object Uint8Array]'
  ) {
    bytes = new Uint8Array(source.byteLength)
    bytes.set(source as Uint8Array)
  } else if (Object.prototype.toString.call(source) === '[object ArrayBuffer]') {
    let snapshot: ArrayBuffer
    try {
      snapshot = ArrayBuffer.prototype.slice.call(source, 0) as ArrayBuffer
    } catch (error) {
      return failCodec(
        'PROJECT_JSON_SOURCE_INVALID',
        'Project JSON source only impersonates an ArrayBuffer.',
        error,
      )
    }
    bytes = new Uint8Array(snapshot)
  } else {
    return failCodec(
      'PROJECT_JSON_SOURCE_INVALID',
      'Project JSON source must be a Blob, Uint8Array, or ArrayBuffer.',
    )
  }

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
