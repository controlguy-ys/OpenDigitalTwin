import {
  canonicalProjectV5Bytes,
  validateWorkcellProjectV5,
} from '../../../core/project-v5/index.js'
import type { WorkcellProjectV5 } from '../../../core/project-v5/index.js'

export class ProjectV5CodecError extends Error {
  readonly code: 'PROJECT_JSON_SOURCE_INVALID' | 'PROJECT_JSON_ENCODING_INVALID' | 'PROJECT_JSON_PARSE_FAILED'

  constructor(code: ProjectV5CodecError['code'], message: string) {
    super(`${code}: ${message}`)
    this.name = 'ProjectV5CodecError'
    this.code = code
  }
}

function codecError(
  code: ProjectV5CodecError['code'],
  message: string,
): ProjectV5CodecError {
  return new ProjectV5CodecError(code, message)
}

async function snapshotProjectV5Source(source: unknown): Promise<Uint8Array<ArrayBuffer>> {
  try {
    const buffer = await Blob.prototype.arrayBuffer.call(source)
    return new Uint8Array(buffer)
  } catch {
    // Continue with the remaining intrinsic source types.
  }

  try {
    return new Uint8Array(Uint8Array.prototype.slice.call(source))
  } catch {
    // Continue with ArrayBuffer's intrinsic source type.
  }

  try {
    return new Uint8Array(ArrayBuffer.prototype.slice.call(source, 0))
  } catch {
    throw codecError('PROJECT_JSON_SOURCE_INVALID', 'Expected a Blob, Uint8Array, or ArrayBuffer source.')
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
