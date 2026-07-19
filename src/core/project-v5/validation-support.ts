import { failProjectV5 } from './errors.js'

export type MutableRecord = Record<string, unknown>

export function invalidProjectV5(path: string, message: string, code = 'PROJECT_VALUE_INVALID'): never {
  return failProjectV5(code, path, message, 'Correct the persisted Project V5 value and try again.')
}

function inspectOwnDataProperties(value: object, path: string, allowArrayLength = false): void {
  for (const key of Reflect.ownKeys(value)) {
    if (allowArrayLength && key === 'length') continue
    if (typeof key !== 'string') {
      invalidProjectV5(path, 'Symbol properties are not valid persisted Project fields.', 'PROJECT_RECORD_NOT_CLOSED')
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (descriptor === undefined || !descriptor.enumerable || !('value' in descriptor)) {
      invalidProjectV5(
        path,
        'Persisted Project fields must be enumerable data properties.',
        'PROJECT_RECORD_NOT_CLOSED',
      )
    }
  }
}

export function expectRecord(value: unknown, path: string): MutableRecord {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    invalidProjectV5(path, 'Expected a plain record.')
  }
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) {
    invalidProjectV5(
      path,
      'Expected a plain record without a custom prototype.',
      'PROJECT_RECORD_PROTOTYPE_INVALID',
    )
  }
  inspectOwnDataProperties(value, path)
  return value as MutableRecord
}

export function expectClosedRecord(
  value: unknown,
  path: string,
  requiredKeys: readonly string[],
  optionalKeys: readonly string[] = [],
): MutableRecord {
  const record = expectRecord(value, path)
  const allowed = new Set([...requiredKeys, ...optionalKeys])
  for (const key of requiredKeys) {
    if (!Object.hasOwn(record, key)) {
      invalidProjectV5(`${path}.${key}`, 'Required field is missing.')
    }
  }
  for (const key of Object.keys(record)) {
    if (!allowed.has(key)) {
      invalidProjectV5(path, `Unexpected field ${JSON.stringify(key)}.`, 'PROJECT_RECORD_NOT_CLOSED')
    }
  }
  return record
}

export function expectDenseArray(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) invalidProjectV5(path, 'Expected an array.')
  if (Object.getPrototypeOf(value) !== Array.prototype) {
    invalidProjectV5(
      path,
      'Persisted arrays must use Array.prototype.',
      'PROJECT_ARRAY_PROTOTYPE_INVALID',
    )
  }
  inspectOwnDataProperties(value, path, true)
  for (let index = 0; index < value.length; index += 1) {
    if (!Object.hasOwn(value, index)) {
      invalidProjectV5(path, `Array index ${index} is missing.`, 'PROJECT_ARRAY_NOT_DENSE')
    }
  }
  for (const key of Object.keys(value)) {
    const index = Number(key)
    if (!Number.isSafeInteger(index) || index < 0 || String(index) !== key || index >= value.length) {
      invalidProjectV5(path, `Unexpected array property ${JSON.stringify(key)}.`, 'PROJECT_RECORD_NOT_CLOSED')
    }
  }
  return value
}

function clonePlainValue(value: unknown, path: string, ancestors: WeakSet<object>): unknown {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      invalidProjectV5(path, 'Persisted Project numbers must be finite.', 'PROJECT_NUMBER_NOT_FINITE')
    }
    return value === 0 ? 0 : value
  }
  if (typeof value !== 'object') {
    invalidProjectV5(path, 'Persisted Project values must be JSON-compatible.')
  }
  if (ancestors.has(value)) {
    invalidProjectV5(path, 'Caller value contains an object cycle.', 'PROJECT_VALUE_CYCLE')
  }
  ancestors.add(value)

  if (Array.isArray(value)) {
    const source = expectDenseArray(value, path)
    const clone: unknown[] = []
    for (let index = 0; index < source.length; index += 1) {
      clone.push(clonePlainValue(source[index], `${path}[${index}]`, ancestors))
    }
    ancestors.delete(value)
    return clone
  }

  const source = expectRecord(value, path)
  const clone: MutableRecord = {}
  for (const key of Object.keys(source)) {
    Object.defineProperty(clone, key, {
      configurable: true,
      enumerable: true,
      value: clonePlainValue(source[key], `${path}.${key}`, ancestors),
      writable: true,
    })
  }
  ancestors.delete(value)
  return clone
}

export function clonePlainDataV5(value: unknown): unknown {
  return clonePlainValue(value, '$', new WeakSet<object>())
}

export function deepFreezeV5<T>(value: T, visited: WeakSet<object> = new WeakSet<object>()): T {
  if (value === null || typeof value !== 'object' || visited.has(value)) return value
  visited.add(value)
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (descriptor !== undefined && 'value' in descriptor) deepFreezeV5(descriptor.value, visited)
  }
  return Object.freeze(value)
}

export function utf8Length(value: string): number {
  return new TextEncoder().encode(value).byteLength
}

function containsControlCharacter(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0)!
    if (codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f)) return true
  }
  return false
}

export function expectString(value: unknown, path: string): string {
  if (typeof value !== 'string') invalidProjectV5(path, 'Expected a string.')
  return value
}

export function validateBoundedText(
  value: unknown,
  path: string,
  maximumBytes: number,
  allowEmpty = false,
): string {
  const text = expectString(value, path)
  if (text.normalize('NFC') !== text) {
    invalidProjectV5(path, 'String must already be NFC-normalized.', 'PROJECT_TEXT_INVALID')
  }
  if (containsControlCharacter(text)) {
    invalidProjectV5(path, 'String must not contain control characters.', 'PROJECT_TEXT_INVALID')
  }
  if (text.trim() !== text) {
    invalidProjectV5(path, 'String must not have leading or trailing whitespace.', 'PROJECT_TEXT_INVALID')
  }
  const length = utf8Length(text)
  if ((!allowEmpty && length === 0) || length > maximumBytes) {
    invalidProjectV5(path, `UTF-8 length must be ${allowEmpty ? '0' : '1'}..${maximumBytes} bytes.`, 'PROJECT_TEXT_INVALID')
  }
  return text
}

export function expectBoolean(value: unknown, path: string): boolean {
  if (typeof value !== 'boolean') invalidProjectV5(path, 'Expected a boolean.')
  return value
}

export function expectFiniteNumber(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    invalidProjectV5(path, 'Expected a finite number.', 'PROJECT_NUMBER_NOT_FINITE')
  }
  return value === 0 ? 0 : value
}

export function expectSafeInteger(value: unknown, path: string, minimum = 0): number {
  const number = expectFiniteNumber(value, path)
  if (!Number.isSafeInteger(number) || number < minimum) {
    invalidProjectV5(path, `Expected a safe integer greater than or equal to ${minimum}.`)
  }
  return number
}

export function expectEnum<T extends string>(
  value: unknown,
  path: string,
  allowed: readonly T[],
): T {
  if (typeof value !== 'string' || !allowed.includes(value as T)) {
    invalidProjectV5(path, `Expected one of: ${allowed.join(', ')}.`)
  }
  return value as T
}
