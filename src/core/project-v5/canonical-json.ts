import type { WorkcellProjectV5 } from './types.js'
import { validateWorkcellProjectV5 } from './validate.js'

function canonicalJsonValue(value: unknown): string {
  if (value === null) return 'null'
  if (typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value)
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('Canonical JSON only supports finite numbers.')
    return JSON.stringify(value === 0 ? 0 : value)
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJsonValue).join(',')}]`
  if (typeof value !== 'object') throw new TypeError('Canonical JSON only supports JSON values.')

  const record = value as Record<string, unknown>
  return `{${Object.keys(record).sort().map((key) => (
    `${JSON.stringify(key)}:${canonicalJsonValue(record[key])}`
  )).join(',')}}`
}

export function canonicalProjectV5Json(project: WorkcellProjectV5): string {
  return canonicalJsonValue(validateWorkcellProjectV5(project))
}

export function canonicalProjectV5Bytes(project: WorkcellProjectV5): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(canonicalProjectV5Json(project))
}

export async function configRevisionForProjectV5(project: WorkcellProjectV5): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', canonicalProjectV5Bytes(project))
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}
