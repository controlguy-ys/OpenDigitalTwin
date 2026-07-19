import {
  MAX_IDENTIFIER_UTF8_BYTES_V5,
  ProjectV5Error,
  validateWorkcellProjectV5,
  type WorkcellProjectV5,
} from '../project-v5/index.js'

export const RUNTIME_PROTOCOL_VERSION_V1 = 1 as const
export const MAX_RUNTIME_STATE_VALUES_V1 = 128
export const MAX_RUNTIME_COMMANDS_V1 = 128
export const MAX_RUNTIME_BATCH_BYTES_V1 = 256 * 1024
export const MAX_RUNTIME_STRUCTURE_DEPTH_V1 = 4
export const MAX_RUNTIME_STRUCTURE_LEAVES_V1 = 32
export const MAX_RUNTIME_FIXED_ARRAY_ELEMENTS_V1 = 256
export const MAX_RUNTIME_MESSAGE_UTF8_BYTES_V1 = 2_048

export type RuntimeScalarV1 = boolean | number | string
export type RuntimeScalarOrStructureV1 =
  | RuntimeScalarV1
  | readonly RuntimeScalarOrStructureV1[]
  | { readonly [key: string]: RuntimeScalarOrStructureV1 }

export type RuntimeValueQualityV1 = 'GOOD' | 'UNCERTAIN' | 'BAD'

export interface RuntimeMappedValueV1 {
  readonly mappingId: string
  readonly coherenceGroupId: string | null
  readonly value: RuntimeScalarOrStructureV1
  readonly unit: string
  readonly quality: RuntimeValueQualityV1
  readonly statusCode: string
}

export interface StateBatchV1 {
  readonly type: 'state-batch-v1'
  readonly protocolVersion: 1
  readonly gatewayId: string
  readonly projectId: string
  readonly configRevision: string
  readonly endpointId: string
  readonly sequence: number
  readonly sourceTimestampMs: number
  readonly publishedTimestampMs: number
  readonly originId: string
  readonly values: readonly RuntimeMappedValueV1[]
}

export interface RuntimePublisherLeaseV1 {
  readonly projectId: string
  readonly configRevision: string
  readonly publisherId: string
  readonly generation: number
  readonly expiresAt: number
}

export interface CommandRequestV1 {
  readonly type: 'command-request-v1'
  readonly protocolVersion: 1
  readonly commandId: string
  readonly projectId: string
  readonly configRevision: string
  readonly leaseGeneration: number
  readonly expiresAt: number
  readonly targetId: string
  readonly value?: RuntimeScalarOrStructureV1
}

export interface RuntimeCommandItemV1 {
  readonly commandId: string
  readonly expiresAt: number
  readonly targetId: string
  readonly value?: RuntimeScalarOrStructureV1
}

export interface CommandBatchV1 {
  readonly type: 'command-batch-v1'
  readonly protocolVersion: 1
  readonly projectId: string
  readonly configRevision: string
  readonly leaseGeneration: number
  readonly commands: readonly RuntimeCommandItemV1[]
}

export type CommandAcknowledgementV1 = 'IDLE' | 'ACCEPTED' | 'REJECTED'
export type CommandExecutionStateV1 = 'IDLE' | 'RUNNING' | 'SUCCEEDED' | 'FAILED'

export interface CommandResultV1 {
  readonly type: 'command-result-v1'
  readonly protocolVersion: 1
  readonly projectId: string
  readonly configRevision: string
  readonly leaseGeneration: number
  readonly targetId: string
  readonly commandId: string
  readonly acknowledgement: CommandAcknowledgementV1
  readonly executionState: CommandExecutionStateV1
  readonly failureCode: string | null
  readonly message: string
  readonly attachedObjectId: string | null
  readonly completedAt: number | null
}

export interface RuntimeProtocolFailureV1 {
  readonly code: string
  readonly path: string
  readonly message: string
}

export interface RevisionStageRequestV1 {
  readonly type: 'revision-stage-v1'
  readonly protocolVersion: 1
  readonly requestId: string
  readonly configRevision: string
  readonly project: WorkcellProjectV5
}

export type RevisionStageResultV1 =
  | {
      readonly type: 'revision-stage-result-v1'
      readonly protocolVersion: 1
      readonly requestId: string
      readonly ok: true
      readonly projectId: string
      readonly configRevision: string
      readonly stageToken: string
    }
  | {
      readonly type: 'revision-stage-result-v1'
      readonly protocolVersion: 1
      readonly requestId: string
      readonly ok: false
      readonly failure: RuntimeProtocolFailureV1
    }

export interface RevisionActivateRequestV1 {
  readonly type: 'revision-activate-v1'
  readonly protocolVersion: 1
  readonly requestId: string
  readonly stageToken: string
}

export type RevisionActivateResultV1 =
  | {
      readonly type: 'revision-activate-result-v1'
      readonly protocolVersion: 1
      readonly requestId: string
      readonly ok: true
      readonly projectId: string
      readonly configRevision: string
    }
  | {
      readonly type: 'revision-activate-result-v1'
      readonly protocolVersion: 1
      readonly requestId: string
      readonly ok: false
      readonly failure: RuntimeProtocolFailureV1
    }

export interface RevisionRollbackRequestV1 {
  readonly type: 'revision-rollback-v1'
  readonly protocolVersion: 1
  readonly requestId: string
  readonly stageToken: string
}

export type RevisionRollbackResultV1 =
  | {
      readonly type: 'revision-rollback-result-v1'
      readonly protocolVersion: 1
      readonly requestId: string
      readonly ok: true
      readonly stageToken: string
    }
  | {
      readonly type: 'revision-rollback-result-v1'
      readonly protocolVersion: 1
      readonly requestId: string
      readonly ok: false
      readonly failure: RuntimeProtocolFailureV1
    }

export type RuntimeProtocolV1Message =
  | StateBatchV1
  | CommandRequestV1
  | CommandBatchV1
  | CommandResultV1
  | RevisionStageRequestV1
  | RevisionStageResultV1
  | RevisionActivateRequestV1
  | RevisionActivateResultV1
  | RevisionRollbackRequestV1
  | RevisionRollbackResultV1

export class RuntimeProtocolV1Error extends Error {
  readonly code: string
  readonly path: string

  constructor(code: string, path: string, message: string) {
    super(`${code} at ${path}: ${message}`)
    this.name = 'RuntimeProtocolV1Error'
    this.code = code
    this.path = path
  }
}

type MutableRecord = Record<string, unknown>

const ID_FORBIDDEN_CHARACTER_PATTERN = /[\\/%?#]/u
const CONFIG_REVISION_PATTERN = /^[0-9a-f]{64}$/u
const FAILURE_CODE_PATTERN = /^[A-Z][A-Z0-9_]{0,127}$/u
const PATH_PROPERTY_PATTERN = /\.[A-Za-z_][A-Za-z0-9_]*/y
const PATH_INDEX_PATTERN = /\[(?:0|[1-9][0-9]*)\]/y
const PATH_KEY_PATTERN = /\["(?:[^"\\]|\\(?:["\\/bfnrt]|u[0-9A-Fa-f]{4}))*"\]/y
const encoder = new TextEncoder()

function invalid(
  path: string,
  message: string,
  code = 'RUNTIME_PROTOCOL_INVALID',
): never {
  throw new RuntimeProtocolV1Error(code, path, message)
}

function ownKeys(value: object, path: string): readonly PropertyKey[] {
  try {
    return Reflect.ownKeys(value)
  } catch {
    invalid(path, 'Record keys could not be inspected.')
  }
}

function ownDescriptor(value: object, key: PropertyKey, path: string): PropertyDescriptor {
  let descriptor: PropertyDescriptor | undefined
  try {
    descriptor = Object.getOwnPropertyDescriptor(value, key)
  } catch {
    invalid(path, 'A record property could not be inspected.')
  }
  if (descriptor === undefined) invalid(path, 'A record property disappeared during validation.')
  return descriptor
}

function prototypeOf(value: object, path: string): object | null {
  try {
    return Object.getPrototypeOf(value)
  } catch {
    invalid(path, 'The record prototype could not be inspected.')
  }
}

function isArray(value: object, path: string): boolean {
  try {
    return Array.isArray(value)
  } catch {
    invalid(path, 'The protocol value kind could not be inspected.')
  }
}

function defineEnumerableDataProperty(target: object, key: string, value: unknown): void {
  Object.defineProperty(target, key, {
    configurable: true,
    enumerable: true,
    value,
    writable: true,
  })
}

function expectRecord(value: unknown, path: string): MutableRecord {
  if (value === null || typeof value !== 'object' || isArray(value, path)) {
    invalid(path, 'Expected a plain record.')
  }
  const prototype = prototypeOf(value, path)
  if (prototype !== Object.prototype && prototype !== null) {
    invalid(path, 'Expected a plain record without a custom prototype.')
  }

  const snapshot: MutableRecord = {}
  for (const key of ownKeys(value, path)) {
    if (typeof key !== 'string') invalid(path, 'Symbol properties are not valid protocol fields.')
    const descriptor = ownDescriptor(value, key, path)
    if (!descriptor.enumerable || !('value' in descriptor)) {
      invalid(path, 'Protocol fields must be enumerable data properties.')
    }
    defineEnumerableDataProperty(snapshot, key, descriptor.value)
  }
  return snapshot
}

function expectClosedRecordSnapshot(
  record: MutableRecord,
  path: string,
  requiredKeys: readonly string[],
  optionalKeys: readonly string[] = [],
): MutableRecord {
  const allowed = new Set([...requiredKeys, ...optionalKeys])
  for (const key of Object.keys(record)) {
    if (!allowed.has(key)) invalid(path, `Unexpected field ${JSON.stringify(key)}.`)
  }
  for (const key of requiredKeys) {
    if (!Object.hasOwn(record, key)) invalid(`${path}.${key}`, 'Required field is missing.')
  }
  return record
}

function expectClosedRecord(
  value: unknown,
  path: string,
  requiredKeys: readonly string[],
  optionalKeys: readonly string[] = [],
): MutableRecord {
  return expectClosedRecordSnapshot(expectRecord(value, path), path, requiredKeys, optionalKeys)
}

function expectDenseArray(value: unknown, path: string): unknown[] {
  if (value === null || typeof value !== 'object' || !isArray(value, path)) {
    invalid(path, 'Expected an array.')
  }
  if (prototypeOf(value, path) !== Array.prototype) {
    invalid(path, 'Protocol arrays must use Array.prototype.')
  }

  let length: number | undefined
  const indexDescriptors = new Map<number, PropertyDescriptor>()
  const descriptors = new Map<string, PropertyDescriptor>()
  for (const key of ownKeys(value, path)) {
    if (typeof key !== 'string') invalid(path, 'Symbol properties are not valid protocol fields.')
    const descriptor = ownDescriptor(value, key, path)
    if (key === 'length') {
      if (!('value' in descriptor) || descriptor.enumerable) {
        invalid(path, 'Protocol Array length must be a non-enumerable data property.')
      }
      if (
        typeof descriptor.value !== 'number'
        || !Number.isSafeInteger(descriptor.value)
        || descriptor.value < 0
        || descriptor.value > 0xffff_ffff
      ) {
        invalid(path, 'Protocol Array length is invalid.')
      }
      length = descriptor.value
      continue
    }
    if (!descriptor.enumerable || !('value' in descriptor)) {
      invalid(path, 'Protocol Array entries must be enumerable data properties.')
    }
    descriptors.set(key, descriptor)
  }

  if (length === undefined) invalid(path, 'Protocol Array length is missing.')
  for (const [key, descriptor] of descriptors) {
    const index = Number(key)
    if (!Number.isSafeInteger(index) || index < 0 || String(index) !== key || index >= length) {
      invalid(path, `Unexpected array property ${JSON.stringify(key)}.`)
    }
    indexDescriptors.set(index, descriptor)
  }
  if (indexDescriptors.size !== length) invalid(path, 'Protocol Array is not dense.')

  const snapshot = Array.from<unknown>({ length })
  for (const [index, descriptor] of indexDescriptors) {
    defineEnumerableDataProperty(snapshot, String(index), descriptor.value)
  }
  return snapshot
}

function utf8ByteLength(value: string, path: string): number {
  let bytes = 0
  for (const character of value) {
    const codePoint = character.codePointAt(0)!
    if (codePoint >= 0xd800 && codePoint <= 0xdfff) {
      invalid(path, 'String contains an unpaired surrogate.')
    }
    if (codePoint <= 0x7f) bytes += 1
    else if (codePoint <= 0x7ff) bytes += 2
    else if (codePoint <= 0xffff) bytes += 3
    else bytes += 4
  }
  return bytes
}

function containsControlCharacter(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0)!
    if (codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f)) return true
  }
  return false
}

function expectString(value: unknown, path: string): string {
  if (typeof value !== 'string') invalid(path, 'Expected a string.')
  return value
}

function validateNormalizedText(
  value: unknown,
  path: string,
  maximumBytes: number,
  allowEmpty: boolean,
  requireTrimmed: boolean,
): string {
  const text = expectString(value, path)
  if (text.normalize('NFC') !== text) invalid(path, 'String must already be NFC-normalized.')
  if (containsControlCharacter(text)) invalid(path, 'String must not contain control characters.')
  if (requireTrimmed && text.trim() !== text) {
    invalid(path, 'String must not have leading or trailing whitespace.')
  }
  const byteLength = utf8ByteLength(text, path)
  if ((!allowEmpty && byteLength === 0) || byteLength > maximumBytes) {
    invalid(path, `UTF-8 length must be ${allowEmpty ? '0' : '1'}..${maximumBytes} bytes.`)
  }
  return text
}

function validateId(value: unknown, path: string): string {
  const id = validateNormalizedText(value, path, MAX_IDENTIFIER_UTF8_BYTES_V5, false, true)
  if (ID_FORBIDDEN_CHARACTER_PATTERN.test(id)) {
    invalid(path, 'Identifier must not contain slash, backslash, percent, query, or fragment characters.')
  }
  return id
}

function validateUnit(value: unknown, path: string): string {
  return validateNormalizedText(value, path, 128, true, true)
}

function validateStatusCode(value: unknown, path: string): string {
  return validateNormalizedText(value, path, 128, false, true)
}

function validateStageToken(value: unknown, path: string): string {
  return validateNormalizedText(value, path, 256, false, true)
}

function validateMessage(value: unknown, path: string): string {
  const message = expectString(value, path)
  if (utf8ByteLength(message, path) > MAX_RUNTIME_MESSAGE_UTF8_BYTES_V1) {
    invalid(path, `Message exceeds ${MAX_RUNTIME_MESSAGE_UTF8_BYTES_V1} UTF-8 bytes.`)
  }
  return message
}

function validateConfigRevision(value: unknown, path: string): string {
  const revision = expectString(value, path)
  if (!CONFIG_REVISION_PATTERN.test(revision)) {
    invalid(path, 'Expected exactly 64 lowercase hexadecimal SHA-256 characters.')
  }
  return revision
}

function validateFailureCode(value: unknown, path: string): string {
  const code = expectString(value, path)
  if (!FAILURE_CODE_PATTERN.test(code)) {
    invalid(path, 'Failure code must use the uppercase protocol code grammar.')
  }
  return code
}

function validateFailurePath(value: unknown, path: string): string {
  const failurePath = expectString(value, path)
  if (!failurePath.startsWith('$')) invalid(path, 'Failure path must start at $.')

  let offset = 1
  while (offset < failurePath.length) {
    let matched = false
    for (const pattern of [PATH_PROPERTY_PATTERN, PATH_INDEX_PATTERN, PATH_KEY_PATTERN]) {
      pattern.lastIndex = offset
      const match = pattern.exec(failurePath)
      if (match !== null && match.index === offset) {
        if (pattern === PATH_KEY_PATTERN) {
          try {
            if (typeof JSON.parse(match[0].slice(1, -1)) !== 'string') continue
          } catch {
            continue
          }
        }
        offset = pattern.lastIndex
        matched = true
        break
      }
    }
    if (!matched) invalid(path, 'Failure path does not use the Runtime Protocol JSON path grammar.')
  }
  return failurePath
}

function expectBoolean(value: unknown, path: string): boolean {
  if (typeof value !== 'boolean') invalid(path, 'Expected a boolean.')
  return value
}

function expectSafeInteger(value: unknown, path: string, minimum: number): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum) {
    invalid(path, `Expected a safe integer greater than or equal to ${minimum}.`)
  }
  return value
}

function expectEnum<T extends string>(
  value: unknown,
  path: string,
  allowed: readonly T[],
): T {
  if (typeof value !== 'string' || !allowed.includes(value as T)) {
    invalid(path, `Expected one of ${allowed.join(', ')}.`)
  }
  return value as T
}

function expectLiteral<T extends string | number>(value: unknown, path: string, literal: T): T {
  if (value !== literal) invalid(path, `Expected ${JSON.stringify(literal)}.`)
  return literal
}

function deepFreeze<T>(value: T, visited: WeakSet<object> = new WeakSet<object>()): T {
  if (value === null || typeof value !== 'object' || visited.has(value)) return value
  visited.add(value)
  for (const child of Object.values(value)) deepFreeze(child, visited)
  return Object.freeze(value)
}

interface RuntimeValueBudget {
  leaves: number
  readonly rootPath: string
}

function validateStructureKey(key: string, path: string): void {
  if (key.normalize('NFC') !== key) invalid(path, 'Structure key must already be NFC-normalized.')
  if (containsControlCharacter(key)) invalid(path, 'Structure key must not contain control characters.')
  const byteLength = utf8ByteLength(key, path)
  if (byteLength === 0 || byteLength > 128) {
    invalid(path, 'Structure key UTF-8 length must be 1..128 bytes.')
  }
}

function cloneRuntimeValue(
  value: unknown,
  path: string,
  depth: number,
  budget: RuntimeValueBudget,
  ancestors: WeakSet<object>,
): RuntimeScalarOrStructureV1 {
  if (depth > MAX_RUNTIME_STRUCTURE_DEPTH_V1) {
    invalid(path, `Runtime Structure depth exceeds ${MAX_RUNTIME_STRUCTURE_DEPTH_V1}.`)
  }

  if (typeof value === 'boolean' || typeof value === 'string') {
    budget.leaves += 1
    if (budget.leaves > MAX_RUNTIME_STRUCTURE_LEAVES_V1) {
      invalid(budget.rootPath, `Runtime value exceeds the maximum of ${MAX_RUNTIME_STRUCTURE_LEAVES_V1} scalar leaves.`)
    }
    return value
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) invalid(path, 'Runtime numbers must be finite.')
    budget.leaves += 1
    if (budget.leaves > MAX_RUNTIME_STRUCTURE_LEAVES_V1) {
      invalid(budget.rootPath, `Runtime value exceeds the maximum of ${MAX_RUNTIME_STRUCTURE_LEAVES_V1} scalar leaves.`)
    }
    return value
  }
  if (value === null || typeof value !== 'object') {
    invalid(path, 'Expected a Runtime scalar or nonempty Structure.')
  }
  if (ancestors.has(value)) invalid(path, 'Runtime Structure contains a cycle.')
  ancestors.add(value)

  if (isArray(value, path)) {
    const source = expectDenseArray(value, path)
    if (source.length === 0) invalid(path, 'Runtime Structure arrays must not be empty.')
    if (source.length > MAX_RUNTIME_FIXED_ARRAY_ELEMENTS_V1) {
      invalid(path, `Runtime Structure arrays may contain at most ${MAX_RUNTIME_FIXED_ARRAY_ELEMENTS_V1} entries.`)
    }
    const clone: RuntimeScalarOrStructureV1[] = []
    for (let index = 0; index < source.length; index += 1) {
      clone.push(cloneRuntimeValue(
        source[index],
        `${path}[${index}]`,
        depth + 1,
        budget,
        ancestors,
      ))
    }
    ancestors.delete(value)
    return clone
  }

  const source = expectRecord(value, path)
  const keys = Object.keys(source).sort()
  if (keys.length === 0) invalid(path, 'Runtime Structure objects must not be empty.')
  const clone: Record<string, RuntimeScalarOrStructureV1> = {}
  for (const key of keys) {
    const keyPath = `${path}[${JSON.stringify(key)}]`
    validateStructureKey(key, keyPath)
    defineEnumerableDataProperty(
      clone,
      key,
      cloneRuntimeValue(source[key], keyPath, depth + 1, budget, ancestors),
    )
  }
  ancestors.delete(value)
  return clone
}

function validateRuntimeValue(value: unknown, path: string): RuntimeScalarOrStructureV1 {
  return cloneRuntimeValue(value, path, 0, { leaves: 0, rootPath: path }, new WeakSet<object>())
}

function validateRuntimeMappedValueAt(value: unknown, path: string): RuntimeMappedValueV1 {
  const record = expectClosedRecord(value, path, [
    'mappingId',
    'coherenceGroupId',
    'value',
    'unit',
    'quality',
    'statusCode',
  ])
  const mappingId = validateId(record.mappingId, `${path}.mappingId`)
  const coherenceGroupId = record.coherenceGroupId === null
    ? null
    : validateId(record.coherenceGroupId, `${path}.coherenceGroupId`)
  return {
    mappingId,
    coherenceGroupId,
    value: validateRuntimeValue(record.value, `${path}.value`),
    unit: validateUnit(record.unit, `${path}.unit`),
    quality: expectEnum(record.quality, `${path}.quality`, ['GOOD', 'UNCERTAIN', 'BAD'] as const),
    statusCode: validateStatusCode(record.statusCode, `${path}.statusCode`),
  }
}

function validateRuntimeCommandItemAt(value: unknown, path: string): RuntimeCommandItemV1 {
  const record = expectClosedRecord(
    value,
    path,
    ['commandId', 'expiresAt', 'targetId'],
    ['value'],
  )
  const commandId = validateId(record.commandId, `${path}.commandId`)
  const expiresAt = expectSafeInteger(record.expiresAt, `${path}.expiresAt`, 0)
  const targetId = validateId(record.targetId, `${path}.targetId`)
  if (!Object.hasOwn(record, 'value')) return { commandId, expiresAt, targetId }
  return {
    commandId,
    expiresAt,
    targetId,
    value: validateRuntimeValue(record.value, `${path}.value`),
  }
}

function validateRuntimeFailureAt(value: unknown, path: string): RuntimeProtocolFailureV1 {
  const record = expectClosedRecord(value, path, ['code', 'path', 'message'])
  return {
    code: validateFailureCode(record.code, `${path}.code`),
    path: validateFailurePath(record.path, `${path}.path`),
    message: validateMessage(record.message, `${path}.message`),
  }
}

function validateEmbeddedProject(value: unknown, path: string): WorkcellProjectV5 {
  try {
    return validateWorkcellProjectV5(value)
  } catch (error) {
    if (error instanceof ProjectV5Error) {
      invalid(
        `${path}${error.path.slice(1)}`,
        `Embedded Project V5 is invalid (${error.code}).`,
        error.code,
      )
    }
    invalid(path, 'Embedded Project V5 validation failed.')
  }
}

export function validateRuntimeMappedValueV1(value: unknown): RuntimeMappedValueV1 {
  return deepFreeze(validateRuntimeMappedValueAt(value, '$'))
}

export function validateStateBatchV1(value: unknown): StateBatchV1 {
  const record = expectClosedRecord(value, '$', [
    'type',
    'protocolVersion',
    'gatewayId',
    'projectId',
    'configRevision',
    'endpointId',
    'sequence',
    'sourceTimestampMs',
    'publishedTimestampMs',
    'originId',
    'values',
  ])
  const type = expectLiteral(record.type, '$.type', 'state-batch-v1')
  const protocolVersion = expectLiteral(record.protocolVersion, '$.protocolVersion', 1)
  const gatewayId = validateId(record.gatewayId, '$.gatewayId')
  const projectId = validateId(record.projectId, '$.projectId')
  const configRevision = validateConfigRevision(record.configRevision, '$.configRevision')
  const endpointId = validateId(record.endpointId, '$.endpointId')
  const sequence = expectSafeInteger(record.sequence, '$.sequence', 1)
  const sourceTimestampMs = expectSafeInteger(record.sourceTimestampMs, '$.sourceTimestampMs', 0)
  const publishedTimestampMs = expectSafeInteger(
    record.publishedTimestampMs,
    '$.publishedTimestampMs',
    0,
  )
  const originId = validateId(record.originId, '$.originId')
  const values = expectDenseArray(record.values, '$.values')
  if (values.length === 0) invalid('$.values', 'State Batch must contain at least one value.')
  if (values.length > MAX_RUNTIME_STATE_VALUES_V1) {
    invalid(
      '$.values',
      `State Batch may contain at most ${MAX_RUNTIME_STATE_VALUES_V1} values.`,
      'RUNTIME_STATE_BATCH_VALUE_LIMIT_EXCEEDED',
    )
  }

  const clonedValues: RuntimeMappedValueV1[] = []
  const mappingIds = new Set<string>()
  for (let index = 0; index < values.length; index += 1) {
    const mapped = validateRuntimeMappedValueAt(values[index], `$.values[${index}]`)
    if (mappingIds.has(mapped.mappingId)) {
      invalid(`$.values[${index}].mappingId`, 'Mapping identity is duplicated within the State Batch.')
    }
    mappingIds.add(mapped.mappingId)
    clonedValues.push(mapped)
  }

  const clone: StateBatchV1 = {
    type,
    protocolVersion,
    gatewayId,
    projectId,
    configRevision,
    endpointId,
    sequence,
    sourceTimestampMs,
    publishedTimestampMs,
    originId,
    values: clonedValues,
  }
  if (encoder.encode(JSON.stringify(clone)).byteLength > MAX_RUNTIME_BATCH_BYTES_V1) {
    invalid(
      '$',
      `Encoded State Batch exceeds ${MAX_RUNTIME_BATCH_BYTES_V1} bytes.`,
      'RUNTIME_STATE_BATCH_SIZE_EXCEEDED',
    )
  }
  return deepFreeze(clone)
}

export function validateRuntimePublisherLeaseV1(value: unknown): RuntimePublisherLeaseV1 {
  const record = expectClosedRecord(value, '$', [
    'projectId',
    'configRevision',
    'publisherId',
    'generation',
    'expiresAt',
  ])
  return deepFreeze({
    projectId: validateId(record.projectId, '$.projectId'),
    configRevision: validateConfigRevision(record.configRevision, '$.configRevision'),
    publisherId: validateId(record.publisherId, '$.publisherId'),
    generation: expectSafeInteger(record.generation, '$.generation', 1),
    expiresAt: expectSafeInteger(record.expiresAt, '$.expiresAt', 0),
  })
}

export function validateCommandRequestV1(value: unknown): CommandRequestV1 {
  const record = expectClosedRecord(
    value,
    '$',
    [
      'type',
      'protocolVersion',
      'commandId',
      'projectId',
      'configRevision',
      'leaseGeneration',
      'expiresAt',
      'targetId',
    ],
    ['value'],
  )
  const base: CommandRequestV1 = {
    type: expectLiteral(record.type, '$.type', 'command-request-v1'),
    protocolVersion: expectLiteral(record.protocolVersion, '$.protocolVersion', 1),
    commandId: validateId(record.commandId, '$.commandId'),
    projectId: validateId(record.projectId, '$.projectId'),
    configRevision: validateConfigRevision(record.configRevision, '$.configRevision'),
    leaseGeneration: expectSafeInteger(record.leaseGeneration, '$.leaseGeneration', 1),
    expiresAt: expectSafeInteger(record.expiresAt, '$.expiresAt', 0),
    targetId: validateId(record.targetId, '$.targetId'),
  }
  if (!Object.hasOwn(record, 'value')) return deepFreeze(base)
  return deepFreeze({ ...base, value: validateRuntimeValue(record.value, '$.value') })
}

export function validateCommandBatchV1(value: unknown): CommandBatchV1 {
  const record = expectClosedRecord(value, '$', [
    'type',
    'protocolVersion',
    'projectId',
    'configRevision',
    'leaseGeneration',
    'commands',
  ])
  const type = expectLiteral(record.type, '$.type', 'command-batch-v1')
  const protocolVersion = expectLiteral(record.protocolVersion, '$.protocolVersion', 1)
  const projectId = validateId(record.projectId, '$.projectId')
  const configRevision = validateConfigRevision(record.configRevision, '$.configRevision')
  const leaseGeneration = expectSafeInteger(record.leaseGeneration, '$.leaseGeneration', 1)
  const commands = expectDenseArray(record.commands, '$.commands')
  if (commands.length === 0) invalid('$.commands', 'Command Batch must contain at least one item.')
  if (commands.length > MAX_RUNTIME_COMMANDS_V1) {
    invalid(
      '$.commands',
      `Command Batch may contain at most ${MAX_RUNTIME_COMMANDS_V1} items.`,
      'RUNTIME_COMMAND_BATCH_ITEM_LIMIT_EXCEEDED',
    )
  }

  const clonedCommands: RuntimeCommandItemV1[] = []
  const identities = new Set<string>()
  for (let index = 0; index < commands.length; index += 1) {
    const command = validateRuntimeCommandItemAt(commands[index], `$.commands[${index}]`)
    const identity = `${command.targetId}\u0000${command.commandId}`
    if (identities.has(identity)) {
      invalid(`$.commands[${index}].commandId`, 'Command identity is duplicated within the Batch.')
    }
    identities.add(identity)
    clonedCommands.push(command)
  }

  const clone: CommandBatchV1 = {
    type,
    protocolVersion,
    projectId,
    configRevision,
    leaseGeneration,
    commands: clonedCommands,
  }
  if (encoder.encode(JSON.stringify(clone)).byteLength > MAX_RUNTIME_BATCH_BYTES_V1) {
    invalid(
      '$',
      `Encoded Command Batch exceeds ${MAX_RUNTIME_BATCH_BYTES_V1} bytes.`,
      'RUNTIME_COMMAND_BATCH_SIZE_EXCEEDED',
    )
  }
  return deepFreeze(clone)
}

export function validateCommandResultV1(value: unknown): CommandResultV1 {
  const record = expectClosedRecord(value, '$', [
    'type',
    'protocolVersion',
    'projectId',
    'configRevision',
    'leaseGeneration',
    'targetId',
    'commandId',
    'acknowledgement',
    'executionState',
    'failureCode',
    'message',
    'attachedObjectId',
    'completedAt',
  ])
  const type = expectLiteral(record.type, '$.type', 'command-result-v1')
  const protocolVersion = expectLiteral(record.protocolVersion, '$.protocolVersion', 1)
  const projectId = validateId(record.projectId, '$.projectId')
  const configRevision = validateConfigRevision(record.configRevision, '$.configRevision')
  const leaseGeneration = expectSafeInteger(record.leaseGeneration, '$.leaseGeneration', 1)
  const targetId = validateId(record.targetId, '$.targetId')
  const commandId = validateId(record.commandId, '$.commandId')
  const acknowledgement = expectEnum(
    record.acknowledgement,
    '$.acknowledgement',
    ['IDLE', 'ACCEPTED', 'REJECTED'] as const,
  )
  const executionState = expectEnum(
    record.executionState,
    '$.executionState',
    ['IDLE', 'RUNNING', 'SUCCEEDED', 'FAILED'] as const,
  )
  const pair = `${acknowledgement}/${executionState}`
  if (![
    'IDLE/IDLE',
    'ACCEPTED/RUNNING',
    'ACCEPTED/SUCCEEDED',
    'ACCEPTED/FAILED',
    'REJECTED/FAILED',
  ].includes(pair)) {
    invalid('$.executionState', 'Acknowledgement and execution state combination is invalid.')
  }

  const failureCode = record.failureCode === null
    ? null
    : validateFailureCode(record.failureCode, '$.failureCode')
  const message = validateMessage(record.message, '$.message')
  const attachedObjectId = record.attachedObjectId === null
    ? null
    : validateId(record.attachedObjectId, '$.attachedObjectId')
  const completedAt = record.completedAt === null
    ? null
    : expectSafeInteger(record.completedAt, '$.completedAt', 0)
  const failureRequired = executionState === 'FAILED'
  if (failureRequired && failureCode === null) {
    invalid('$.failureCode', 'A failed Result requires a failure code.')
  }
  if (!failureRequired && failureCode !== null) {
    invalid('$.failureCode', 'A non-failed Result must not carry a failure code.')
  }
  const completionRequired = executionState === 'SUCCEEDED' || executionState === 'FAILED'
  if (completionRequired && completedAt === null) {
    invalid('$.completedAt', 'A terminal Result requires a completion time.')
  }
  if (!completionRequired && completedAt !== null) {
    invalid('$.completedAt', 'A non-terminal Result must not carry a completion time.')
  }

  return deepFreeze({
    type,
    protocolVersion,
    projectId,
    configRevision,
    leaseGeneration,
    targetId,
    commandId,
    acknowledgement,
    executionState,
    failureCode,
    message,
    attachedObjectId,
    completedAt,
  })
}

export function validateRevisionStageRequestV1(value: unknown): RevisionStageRequestV1 {
  const record = expectClosedRecord(value, '$', [
    'type',
    'protocolVersion',
    'requestId',
    'configRevision',
    'project',
  ])
  return deepFreeze({
    type: expectLiteral(record.type, '$.type', 'revision-stage-v1'),
    protocolVersion: expectLiteral(record.protocolVersion, '$.protocolVersion', 1),
    requestId: validateId(record.requestId, '$.requestId'),
    configRevision: validateConfigRevision(record.configRevision, '$.configRevision'),
    project: validateEmbeddedProject(record.project, '$.project'),
  })
}

export function validateRevisionStageResultV1(value: unknown): RevisionStageResultV1 {
  const discriminator = expectRecord(value, '$')
  const type = expectLiteral(discriminator.type, '$.type', 'revision-stage-result-v1')
  const protocolVersion = expectLiteral(discriminator.protocolVersion, '$.protocolVersion', 1)
  const requestId = validateId(discriminator.requestId, '$.requestId')
  const ok = expectBoolean(discriminator.ok, '$.ok')
  if (ok) {
    const record = expectClosedRecordSnapshot(discriminator, '$', [
      'type',
      'protocolVersion',
      'requestId',
      'ok',
      'projectId',
      'configRevision',
      'stageToken',
    ])
    return deepFreeze({
      type,
      protocolVersion,
      requestId,
      ok: true,
      projectId: validateId(record.projectId, '$.projectId'),
      configRevision: validateConfigRevision(record.configRevision, '$.configRevision'),
      stageToken: validateStageToken(record.stageToken, '$.stageToken'),
    })
  }
  const record = expectClosedRecordSnapshot(discriminator, '$', [
    'type',
    'protocolVersion',
    'requestId',
    'ok',
    'failure',
  ])
  return deepFreeze({
    type,
    protocolVersion,
    requestId,
    ok: false,
    failure: validateRuntimeFailureAt(record.failure, '$.failure'),
  })
}

export function validateRevisionActivateRequestV1(value: unknown): RevisionActivateRequestV1 {
  const record = expectClosedRecord(value, '$', [
    'type',
    'protocolVersion',
    'requestId',
    'stageToken',
  ])
  return deepFreeze({
    type: expectLiteral(record.type, '$.type', 'revision-activate-v1'),
    protocolVersion: expectLiteral(record.protocolVersion, '$.protocolVersion', 1),
    requestId: validateId(record.requestId, '$.requestId'),
    stageToken: validateStageToken(record.stageToken, '$.stageToken'),
  })
}

export function validateRevisionActivateResultV1(value: unknown): RevisionActivateResultV1 {
  const discriminator = expectRecord(value, '$')
  const type = expectLiteral(discriminator.type, '$.type', 'revision-activate-result-v1')
  const protocolVersion = expectLiteral(discriminator.protocolVersion, '$.protocolVersion', 1)
  const requestId = validateId(discriminator.requestId, '$.requestId')
  const ok = expectBoolean(discriminator.ok, '$.ok')
  if (ok) {
    const record = expectClosedRecordSnapshot(discriminator, '$', [
      'type',
      'protocolVersion',
      'requestId',
      'ok',
      'projectId',
      'configRevision',
    ])
    return deepFreeze({
      type,
      protocolVersion,
      requestId,
      ok: true,
      projectId: validateId(record.projectId, '$.projectId'),
      configRevision: validateConfigRevision(record.configRevision, '$.configRevision'),
    })
  }
  const record = expectClosedRecordSnapshot(discriminator, '$', [
    'type',
    'protocolVersion',
    'requestId',
    'ok',
    'failure',
  ])
  return deepFreeze({
    type,
    protocolVersion,
    requestId,
    ok: false,
    failure: validateRuntimeFailureAt(record.failure, '$.failure'),
  })
}

export function validateRevisionRollbackRequestV1(value: unknown): RevisionRollbackRequestV1 {
  const record = expectClosedRecord(value, '$', [
    'type',
    'protocolVersion',
    'requestId',
    'stageToken',
  ])
  return deepFreeze({
    type: expectLiteral(record.type, '$.type', 'revision-rollback-v1'),
    protocolVersion: expectLiteral(record.protocolVersion, '$.protocolVersion', 1),
    requestId: validateId(record.requestId, '$.requestId'),
    stageToken: validateStageToken(record.stageToken, '$.stageToken'),
  })
}

export function validateRevisionRollbackResultV1(value: unknown): RevisionRollbackResultV1 {
  const discriminator = expectRecord(value, '$')
  const type = expectLiteral(discriminator.type, '$.type', 'revision-rollback-result-v1')
  const protocolVersion = expectLiteral(discriminator.protocolVersion, '$.protocolVersion', 1)
  const requestId = validateId(discriminator.requestId, '$.requestId')
  const ok = expectBoolean(discriminator.ok, '$.ok')
  if (ok) {
    const record = expectClosedRecordSnapshot(discriminator, '$', [
      'type',
      'protocolVersion',
      'requestId',
      'ok',
      'stageToken',
    ])
    return deepFreeze({
      type,
      protocolVersion,
      requestId,
      ok: true,
      stageToken: validateStageToken(record.stageToken, '$.stageToken'),
    })
  }
  const record = expectClosedRecordSnapshot(discriminator, '$', [
    'type',
    'protocolVersion',
    'requestId',
    'ok',
    'failure',
  ])
  return deepFreeze({
    type,
    protocolVersion,
    requestId,
    ok: false,
    failure: validateRuntimeFailureAt(record.failure, '$.failure'),
  })
}

export function validateRuntimeProtocolV1Message(value: unknown): RuntimeProtocolV1Message {
  const record = expectRecord(value, '$')
  const type = expectString(record.type, '$.type')
  switch (type) {
    case 'state-batch-v1':
      return validateStateBatchV1(record)
    case 'command-request-v1':
      return validateCommandRequestV1(record)
    case 'command-batch-v1':
      return validateCommandBatchV1(record)
    case 'command-result-v1':
      return validateCommandResultV1(record)
    case 'revision-stage-v1':
      return validateRevisionStageRequestV1(record)
    case 'revision-stage-result-v1':
      return validateRevisionStageResultV1(record)
    case 'revision-activate-v1':
      return validateRevisionActivateRequestV1(record)
    case 'revision-activate-result-v1':
      return validateRevisionActivateResultV1(record)
    case 'revision-rollback-v1':
      return validateRevisionRollbackRequestV1(record)
    case 'revision-rollback-result-v1':
      return validateRevisionRollbackResultV1(record)
    default:
      invalid('$.type', `Unknown Runtime Protocol V1 message type ${JSON.stringify(type)}.`)
  }
}
