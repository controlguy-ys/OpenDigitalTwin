import { ProjectV4Error } from './errors'
import type { WorkcellProjectV4 } from './types'
import { validateWorkcellProjectV4 } from './validate'

function writeCanonicalJson(value: unknown): string {
  if (value === null) return 'null'

  switch (typeof value) {
    case 'boolean':
      return value ? 'true' : 'false'
    case 'number': {
      if (!Number.isFinite(value)) {
        throw new ProjectV4Error(
          'PROJECT_VALUE_INVALID',
          '$',
          'Canonical Project JSON only admits finite numbers.',
          'Correct the persisted Project V4 value and try again.',
        )
      }
      return JSON.stringify(Object.is(value, -0) ? 0 : value)
    }
    case 'string':
      return JSON.stringify(value)
    case 'object':
      if (Array.isArray(value)) {
        return `[${value.map((item) => writeCanonicalJson(item)).join(',')}]`
      }
      return `{${Object.keys(value)
        .sort()
        .map((key) => `${JSON.stringify(key)}:${writeCanonicalJson(
          (value as Record<string, unknown>)[key],
        )}`)
        .join(',')}}`
    default:
      throw new ProjectV4Error(
        'PROJECT_VALUE_INVALID',
        '$',
        'Canonical Project JSON only admits JSON-compatible values.',
        'Correct the persisted Project V4 value and try again.',
      )
  }
}

export function canonicalProjectV4Json(project: WorkcellProjectV4): string {
  return writeCanonicalJson(validateWorkcellProjectV4(project))
}

export function canonicalProjectV4Bytes(project: WorkcellProjectV4): Uint8Array {
  return new TextEncoder().encode(canonicalProjectV4Json(project))
}

export async function configRevisionForProjectV4(
  project: WorkcellProjectV4,
): Promise<string> {
  const bytes = canonicalProjectV4Bytes(project)
  const subtle = globalThis.crypto?.subtle
  if (subtle === undefined) {
    throw new ProjectV4Error(
      'PROJECT_CRYPTO_UNAVAILABLE',
      '$',
      'Web Crypto SHA-256 is unavailable.',
      'Run in a supported secure browser context or Node 22.',
    )
  }

  let digest: ArrayBuffer
  try {
    digest = await subtle.digest('SHA-256', bytes as BufferSource)
  } catch {
    throw new ProjectV4Error(
      'PROJECT_CONFIG_REVISION_FAILED',
      '$',
      'The canonical Project V4 revision digest could not be computed.',
      'Retry in a supported secure browser context or Node 22.',
    )
  }

  return Array.from(
    new Uint8Array(digest),
    (byte) => byte.toString(16).padStart(2, '0'),
  ).join('')
}
