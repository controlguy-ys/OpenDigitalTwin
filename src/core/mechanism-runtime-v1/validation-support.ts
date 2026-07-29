import { normalizeRigidTransformV5 } from '../project-v5/rigid-transform.js'
import { failMechanismV1 } from './errors.js'
import type { CanonicalJsonObjectV1, CanonicalJsonValueV1, RigidTransformV1 } from './types.js'

const CANONICAL_VALUE_RECOVERY = 'Provide finite JSON data with plain objects, dense arrays, and no accessors.'

function failCanonicalValue(path: string): never {
  return failMechanismV1(
    'MECHANISM_VALUE_INVALID',
    path,
    'Value must be canonical JSON data.',
    CANONICAL_VALUE_RECOVERY,
  )
}

function isArrayIndex(key: string, length: number): boolean {
  if (!/^(0|[1-9]\d*)$/.test(key)) return false
  const index = Number(key)
  return Number.isSafeInteger(index) && index < length
}

function inspectCanonicalJsonValueV1(
  value: unknown,
  path: string,
  ancestors: WeakSet<object>,
): CanonicalJsonValueV1 {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return value
  if (typeof value === 'number') return Number.isFinite(value) ? value : failCanonicalValue(path)
  if (typeof value !== 'object') return failCanonicalValue(path)
  if (ancestors.has(value)) return failCanonicalValue(path)

  ancestors.add(value)
  try {
    if (Array.isArray(value)) return inspectCanonicalJsonArrayV1(value, path, ancestors)
    return inspectCanonicalJsonPlainObjectV1(value, path, ancestors)
  } finally {
    ancestors.delete(value)
  }
}

function inspectCanonicalJsonArrayV1(
  value: readonly unknown[],
  path: string,
  ancestors: WeakSet<object>,
): readonly CanonicalJsonValueV1[] {
  if (Object.getPrototypeOf(value) !== Array.prototype) return failCanonicalValue(path)
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key === 'symbol' || (key !== 'length' && !isArrayIndex(key, value.length))) {
      return failCanonicalValue(path)
    }
  }

  const output: CanonicalJsonValueV1[] = []
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index))
    if (descriptor === undefined || !descriptor.enumerable || !('value' in descriptor)) {
      return failCanonicalValue(path)
    }
    output.push(inspectCanonicalJsonValueV1(descriptor.value, `${path}[${index}]`, ancestors))
  }
  return Object.freeze(output)
}

function inspectCanonicalJsonPlainObjectV1(
  value: object,
  path: string,
  ancestors: WeakSet<object>,
): CanonicalJsonObjectV1 {
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) return failCanonicalValue(path)

  const output: Record<string, CanonicalJsonValueV1> = Object.create(null) as Record<string, CanonicalJsonValueV1>
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key === 'symbol') return failCanonicalValue(path)
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (descriptor === undefined || !descriptor.enumerable || !('value' in descriptor)) {
      return failCanonicalValue(`${path}.${key}`)
    }
    Object.defineProperty(output, key, {
      configurable: false,
      enumerable: true,
      value: inspectCanonicalJsonValueV1(descriptor.value, `${path}.${key}`, ancestors),
      writable: false,
    })
  }
  return Object.freeze(output) as CanonicalJsonObjectV1
}

export function inspectCanonicalJsonObjectV1(
  value: unknown,
  path: string,
): CanonicalJsonObjectV1 {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return failCanonicalValue(path)
  return inspectCanonicalJsonPlainObjectV1(value, path, new WeakSet<object>())
}

export function frozenNullPrototypeRecordV1<T>(
  entries: readonly (readonly [string, T])[],
): Readonly<Record<string, T>> {
  const output: Record<string, T> = Object.create(null) as Record<string, T>
  for (const [key, value] of entries) {
    Object.defineProperty(output, key, {
      configurable: false,
      enumerable: true,
      value,
      writable: false,
    })
  }
  return Object.freeze(output) as Readonly<Record<string, T>>
}

export function normalizeMechanismRigidTransformV1(
  value: RigidTransformV1,
  path: string,
): RigidTransformV1 {
  try {
    return normalizeRigidTransformV5({
      positionM: [...value.positionM],
      quaternion: [...value.quaternion],
    }, path)
  } catch (error) {
    return failMechanismV1(
      'TRANSFORM_INVALID',
      path,
      'Rigid transform is invalid.',
      'Provide a finite position and a finite, non-zero quaternion.',
      error,
    )
  }
}
