import { failProjectV4 } from './errors'
import {
  BOX_PRIMITIVE_TRIANGLES_V4,
  CYLINDER_PRIMITIVE_TRIANGLES_V4,
  CYLINDER_RADIAL_SEGMENTS_V4,
  DEFAULT_OPCUA_PUBLISHING_INTERVAL_MS_V4,
  MAX_ACTION_DEFINITIONS_V4,
  MAX_IDENTIFIER_UTF8_BYTES_V4,
  MAX_IMPORTED_OBJECT_STEP_ASSETS_V4,
  MAX_JOBS_V4,
  MAX_JOB_SPEED_PERCENT_V4,
  MAX_JOB_STEPS_PER_JOB_V4,
  MAX_LOGICAL_URI_UTF8_BYTES_V4,
  MAX_MOVING_FRAMES_PER_ENTITY_V4,
  MAX_NAME_UTF8_BYTES_V4,
  MAX_OBJECT_STEP_BYTES_V4,
  MAX_OBJECT_STEP_TRIANGLES_V4,
  MAX_OPCUA_ENDPOINTS_V4,
  MAX_OPCUA_ENDPOINT_URL_UTF8_BYTES_V4,
  MAX_OPCUA_EXPANDED_LEAVES_PER_ENDPOINT_V4,
  MAX_OPCUA_EXPANDED_LEAVES_PER_STRUCTURE_V4,
  MAX_OPCUA_EXPANDED_LEAVES_V4,
  MAX_OPCUA_FIXED_ARRAY_ELEMENTS_V4,
  MAX_OPCUA_LEAF_UPDATES_PER_SECOND_V4,
  MAX_OPCUA_NODE_ID_UTF8_BYTES_V4,
  MAX_OPCUA_STRUCTURE_DEPTH_V4,
  MAX_OPCUA_STRUCTURE_ROOTS_PER_ENDPOINT_V4,
  MAX_OPCUA_STRUCTURE_ROOTS_V4,
  MAX_PROJECT_FRAMES_V4,
  MAX_REFERENCED_STEP_BYTES_V4,
  MAX_ROBOT_DEFINITIONS_V4,
  MAX_ROBOT_DEFINITION_STEP_BYTES_V4,
  MAX_ROBOT_DEFINITION_TRIANGLES_V4,
  MAX_ROBOT_INSTANCES_V4,
  MAX_ROBOT_JOINTS_V4,
  MAX_ROBOT_LINKS_V4,
  MAX_ROBOT_STEP_SOURCES_V4,
  MAX_SCENE_GROUPS_V4,
  MAX_SOURCE_FILENAME_UTF8_BYTES_V4,
  MAX_SPATIAL_ENTITIES_V4,
  MAX_TOTAL_JOB_STEPS_V4,
  MAX_VISIBLE_SCENE_TRIANGLES_V4,
  MIN_JOB_SPEED_PERCENT_V4,
  MIN_OPCUA_PUBLISHING_INTERVAL_MS_V4,
  MIN_ROBOT_JOINTS_V4,
  MIN_ROBOT_LINKS_V4,
  MIN_ROBOT_STEP_SOURCES_V4,
  PROJECT_V4_SCHEMA_VERSION,
} from './limits'
import { normalizeRigidTransformV4 } from './rigid-transform'
import type {
  AssetReferenceV4,
  FrameDefinitionV4,
  OpcUaMappingV4,
  OpcUaProjectTargetV4,
  RobotActionDefinitionV4,
  RobotDefinitionV4,
  RobotInstanceV4,
  RobotJobV4,
  RobotJointDefinitionV4,
  SceneGroupV4,
  SourceConventionV4,
  SpatialEntityV4,
  WorkcellProjectV4,
} from './types'

type MutableRecord = Record<string, unknown>

const ROOT_KEYS = [
  'schemaVersion',
  'projectId',
  'revisionId',
  'metadata',
  'assetReferences',
  'scene',
  'robotDefinitions',
  'robots',
  'spatialEntities',
  'sceneGroups',
  'jobs',
  'actions',
  'opcUa',
] as const

const ID_FORBIDDEN_CHARACTER_PATTERN = /[\\/%?#]/u
const COLOR_PATTERN = /^#[0-9A-Fa-f]{6}$/u
const SHA256_PATTERN = /^[0-9a-f]{64}$/u
const OPCUA_OWNERSHIP_PATTERN = /^opcua:(.+)$/u

function invalid(path: string, message: string, code = 'PROJECT_VALUE_INVALID'): never {
  failProjectV4(code, path, message, 'Correct the persisted Project V4 value and try again.')
}

function inspectOwnDataProperties(value: object, path: string, allowArrayLength = false): void {
  for (const key of Reflect.ownKeys(value)) {
    if (allowArrayLength && key === 'length') continue
    if (typeof key !== 'string') {
      invalid(path, 'Symbol properties are not valid persisted Project fields.', 'PROJECT_RECORD_NOT_CLOSED')
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (descriptor === undefined || !descriptor.enumerable || !('value' in descriptor)) {
      invalid(path, 'Persisted Project fields must be enumerable data properties.', 'PROJECT_RECORD_NOT_CLOSED')
    }
  }
}

function expectRecord(value: unknown, path: string): MutableRecord {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    invalid(path, 'Expected a plain record.')
  }
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) {
    invalid(path, 'Expected a plain record without a custom prototype.')
  }
  inspectOwnDataProperties(value, path)
  return value as MutableRecord
}

function expectClosedRecord(
  value: unknown,
  path: string,
  requiredKeys: readonly string[],
  optionalKeys: readonly string[] = [],
): MutableRecord {
  const record = expectRecord(value, path)
  const allowed = new Set([...requiredKeys, ...optionalKeys])
  for (const key of requiredKeys) {
    if (!Object.hasOwn(record, key)) {
      invalid(`${path}.${key}`, 'Required field is missing.')
    }
  }
  for (const key of Object.keys(record)) {
    if (!allowed.has(key)) {
      invalid(path, `Unexpected field ${JSON.stringify(key)}.`, 'PROJECT_RECORD_NOT_CLOSED')
    }
  }
  return record
}

function expectDenseArray(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) invalid(path, 'Expected an array.')
  if (Object.getPrototypeOf(value) !== Array.prototype) {
    invalid(path, 'Persisted arrays must use Array.prototype.', 'PROJECT_ARRAY_PROTOTYPE_INVALID')
  }
  inspectOwnDataProperties(value, path, true)
  for (let index = 0; index < value.length; index += 1) {
    if (!Object.hasOwn(value, index)) {
      invalid(path, `Array index ${index} is missing.`, 'PROJECT_ARRAY_NOT_DENSE')
    }
  }
  for (const key of Object.keys(value)) {
    const index = Number(key)
    if (!Number.isSafeInteger(index) || index < 0 || String(index) !== key || index >= value.length) {
      invalid(path, `Unexpected array property ${JSON.stringify(key)}.`, 'PROJECT_RECORD_NOT_CLOSED')
    }
  }
  return value
}

function clonePlainValue(value: unknown, path: string, ancestors: WeakSet<object>): unknown {
  if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value
  }
  if (typeof value !== 'object') invalid(path, 'Persisted Project values must be JSON-compatible.')
  if (ancestors.has(value)) invalid(path, 'Caller value contains an object cycle.', 'PROJECT_VALUE_CYCLE')
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
  for (const [key, item] of Object.entries(source)) {
    Object.defineProperty(clone, key, {
      configurable: true,
      enumerable: true,
      value: clonePlainValue(item, `${path}.${key}`, ancestors),
      writable: true,
    })
  }
  ancestors.delete(value)
  return clone
}

function enforceMaximum(length: number, maximum: number, path: string, code: string): void {
  if (length > maximum) invalid(path, `Maximum is ${maximum}; received ${length}.`, code)
}

export function preflightWorkcellProjectShapeV4(
  value: unknown,
): asserts value is WorkcellProjectV4 {
  const root = expectRecord(value, '$')
  if (root.schemaVersion !== PROJECT_V4_SCHEMA_VERSION) {
    invalid(
      '$.schemaVersion',
      `Only schema version ${PROJECT_V4_SCHEMA_VERSION} is accepted without migration.`,
      'PROJECT_SCHEMA_UNSUPPORTED',
    )
  }
  expectClosedRecord(root, '$', ROOT_KEYS)

  const robotDefinitions = expectDenseArray(root.robotDefinitions, '$.robotDefinitions')
  const robots = expectDenseArray(root.robots, '$.robots')
  const spatialEntities = expectDenseArray(root.spatialEntities, '$.spatialEntities')
  const sceneGroups = expectDenseArray(root.sceneGroups, '$.sceneGroups')
  const jobs = expectDenseArray(root.jobs, '$.jobs')
  const actions = expectDenseArray(root.actions, '$.actions')
  expectDenseArray(root.assetReferences, '$.assetReferences')
  expectRecord(root.metadata, '$.metadata')
  expectRecord(root.scene, '$.scene')
  expectRecord(root.opcUa, '$.opcUa')

  enforceMaximum(
    robotDefinitions.length,
    MAX_ROBOT_DEFINITIONS_V4,
    '$.robotDefinitions',
    'ROBOT_DEFINITION_LIMIT_EXCEEDED',
  )
  enforceMaximum(robots.length, MAX_ROBOT_INSTANCES_V4, '$.robots', 'ROBOT_INSTANCE_LIMIT_EXCEEDED')
  enforceMaximum(
    spatialEntities.length,
    MAX_SPATIAL_ENTITIES_V4,
    '$.spatialEntities',
    'SPATIAL_ENTITY_LIMIT_EXCEEDED',
  )
  enforceMaximum(sceneGroups.length, MAX_SCENE_GROUPS_V4, '$.sceneGroups', 'SCENE_GROUP_LIMIT_EXCEEDED')
  enforceMaximum(jobs.length, MAX_JOBS_V4, '$.jobs', 'JOB_LIMIT_EXCEEDED')
  enforceMaximum(actions.length, MAX_ACTION_DEFINITIONS_V4, '$.actions', 'ACTION_LIMIT_EXCEEDED')
}

function utf8ByteLength(value: string, path: string): number {
  let bytes = 0
  for (const character of value) {
    const codePoint = character.codePointAt(0)!
    if (codePoint >= 0xd800 && codePoint <= 0xdfff) invalid(path, 'String contains an unpaired surrogate.')
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

function validateBoundedText(
  value: unknown,
  path: string,
  maximumBytes: number,
  allowEmpty = false,
): string {
  const text = expectString(value, path)
  if (text.normalize('NFC') !== text) invalid(path, 'String must already be NFC-normalized.')
  if (containsControlCharacter(text)) invalid(path, 'String must not contain control characters.')
  if (text.trim() !== text) invalid(path, 'String must not have leading or trailing whitespace.')
  const byteLength = utf8ByteLength(text, path)
  if ((!allowEmpty && byteLength === 0) || byteLength > maximumBytes) {
    invalid(path, `UTF-8 length must be ${allowEmpty ? '0' : '1'}..${maximumBytes} bytes.`)
  }
  return text
}

function validateId(value: unknown, path: string): string {
  const id = validateBoundedText(value, path, MAX_IDENTIFIER_UTF8_BYTES_V4)
  if (ID_FORBIDDEN_CHARACTER_PATTERN.test(id)) {
    invalid(path, 'Identifier must not contain slash, backslash, percent, query, or fragment characters.')
  }
  return id
}

function validateName(value: unknown, path: string): string {
  return validateBoundedText(value, path, MAX_NAME_UTF8_BYTES_V4)
}

function expectBoolean(value: unknown, path: string): boolean {
  if (typeof value !== 'boolean') invalid(path, 'Expected a boolean.')
  return value
}

function expectFiniteNumber(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) invalid(path, 'Expected a finite number.')
  return value === 0 ? 0 : value
}

function expectSafeInteger(value: unknown, path: string, minimum = 0): number {
  const number = expectFiniteNumber(value, path)
  if (!Number.isSafeInteger(number) || number < minimum) {
    invalid(path, `Expected a safe integer greater than or equal to ${minimum}.`)
  }
  return number
}

function expectEnum<T extends string>(value: unknown, path: string, allowed: readonly T[]): T {
  if (typeof value !== 'string' || !allowed.includes(value as T)) {
    invalid(path, `Expected one of: ${allowed.join(', ')}.`)
  }
  return value as T
}

function validateVector3(value: unknown, path: string): [number, number, number] {
  const vector = expectDenseArray(value, path)
  if (vector.length !== 3) invalid(path, 'Expected exactly three components.')
  return [
    expectFiniteNumber(vector[0], `${path}[0]`),
    expectFiniteNumber(vector[1], `${path}[1]`),
    expectFiniteNumber(vector[2], `${path}[2]`),
  ]
}

function validateQuaternion(value: unknown, path: string): [number, number, number, number] {
  const quaternion = expectDenseArray(value, path)
  if (quaternion.length !== 4) invalid(path, 'Expected exactly four [x, y, z, w] components.')
  const components: [number, number, number, number] = [
    expectFiniteNumber(quaternion[0], `${path}[0]`),
    expectFiniteNumber(quaternion[1], `${path}[1]`),
    expectFiniteNumber(quaternion[2], `${path}[2]`),
    expectFiniteNumber(quaternion[3], `${path}[3]`),
  ]
  return [...normalizeRigidTransformV4({ positionM: [0, 0, 0], quaternion: components }, path).quaternion]
}

function validateRigidTransform(value: unknown, path: string): void {
  const record = expectClosedRecord(value, path, ['positionM', 'quaternion'])
  const normalized = normalizeRigidTransformV4({
    positionM: validateVector3(record.positionM, `${path}.positionM`),
    quaternion: validateQuaternion(record.quaternion, `${path}.quaternion`),
  }, path)
  record.positionM = [...normalized.positionM]
  record.quaternion = [...normalized.quaternion]
}

function normalizeAxis(value: unknown, path: string): [number, number, number] {
  const axis = validateVector3(value, path)
  const magnitude = Math.hypot(...axis)
  if (!Number.isFinite(magnitude) || magnitude === 0) {
    invalid(path, 'Joint axis must be finite and non-zero.', 'JOINT_AXIS_NOT_NORMALIZABLE')
  }
  return axis.map((component) => {
    const normalized = component / magnitude
    return normalized === 0 ? 0 : normalized
  }) as [number, number, number]
}

function validateIsoTimestamp(value: unknown, path: string): string {
  const timestamp = expectString(value, path)
  const epochMs = Date.parse(timestamp)
  if (!Number.isFinite(epochMs) || new Date(epochMs).toISOString() !== timestamp) {
    invalid(path, 'Expected a canonical ISO-8601 UTC timestamp ending in Z.')
  }
  return timestamp
}

function validateLogicalUri(value: unknown, path: string): string {
  const uri = validateBoundedText(value, path, MAX_LOGICAL_URI_UTF8_BYTES_V4)
  if (uri.includes('%') || uri.includes('?') || uri.includes('#') || uri.includes('\\')) {
    invalid(path, 'Logical URI must not contain escapes, query, fragment, or backslash characters.')
  }
  if (uri.startsWith('asset://')) {
    const remainder = uri.slice('asset://'.length)
    const slashIndex = remainder.indexOf('/')
    if (slashIndex <= 0) invalid(path, 'Asset URI must contain an alias and a non-empty path.')
    const alias = remainder.slice(0, slashIndex)
    const logicalPath = remainder.slice(slashIndex + 1)
    if (!/^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/u.test(alias)) {
      invalid(path, 'Asset URI alias is not canonical.')
    }
    const segments = logicalPath.split('/')
    if (segments.some((segment) => segment === '' || segment === '.' || segment === '..')) {
      invalid(path, 'Asset URI path contains an empty or traversal segment.')
    }
    if (logicalPath.normalize('NFC') !== logicalPath || containsControlCharacter(logicalPath)) {
      invalid(path, 'Asset URI path must be NFC and control-free.')
    }
    return uri
  }
  if (!/^builtin:\/\/abb\/[A-Za-z0-9][A-Za-z0-9._-]*@[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(uri)) {
    invalid(path, 'Expected canonical asset://alias/path or builtin://abb/asset@version syntax.')
  }
  return uri
}

function validateSourceFileName(value: unknown, path: string): string {
  const fileName = validateBoundedText(value, path, MAX_SOURCE_FILENAME_UTF8_BYTES_V4)
  if (fileName === '.' || fileName === '..' || fileName.includes('/') || fileName.includes('\\')) {
    invalid(path, 'Source file name must be a basename without traversal or separators.')
  }
  return fileName
}

function validateSourceConvention(value: unknown, path: string): void {
  const record = expectClosedRecord(value, path, ['linearUnit', 'sourceToMeters', 'orientation'])
  const linearUnit = expectEnum(record.linearUnit, `${path}.linearUnit`, [
    'millimeter', 'centimeter', 'meter', 'inch', 'foot',
  ] as const)
  const expectedScale = {
    millimeter: 0.001,
    centimeter: 0.01,
    meter: 1,
    inch: 0.0254,
    foot: 0.3048,
  }[linearUnit]
  const sourceToMeters = expectFiniteNumber(record.sourceToMeters, `${path}.sourceToMeters`)
  if (sourceToMeters !== expectedScale) invalid(`${path}.sourceToMeters`, 'Scale does not match linearUnit.')

  const orientation = expectRecord(record.orientation, `${path}.orientation`)
  const mode = expectEnum(orientation.mode, `${path}.orientation.mode`, ['up-axis', 'root-rotation'] as const)
  if (mode === 'up-axis') {
    expectClosedRecord(orientation, `${path}.orientation`, ['mode', 'upAxis'])
    expectEnum(orientation.upAxis, `${path}.orientation.upAxis`, ['x', 'y', 'z'] as const)
  } else {
    expectClosedRecord(orientation, `${path}.orientation`, ['mode', 'quaternion'])
    orientation.quaternion = validateQuaternion(orientation.quaternion, `${path}.orientation.quaternion`)
  }
}

function validateStatistics(value: unknown, path: string): void {
  const record = expectClosedRecord(value, path, ['vertices', 'triangles', 'meshes', 'materials'])
  for (const key of ['vertices', 'triangles', 'meshes', 'materials'] as const) {
    record[key] = expectSafeInteger(record[key], `${path}.${key}`)
  }
}

function validateCollisionBoxes(value: unknown, path: string): void {
  const boxes = expectDenseArray(value, path)
  const ids = new Set<string>()
  boxes.forEach((box, index) => {
    const boxPath = `${path}[${index}]`
    const record = expectClosedRecord(box, boxPath, ['id', 'centerM', 'halfExtentsM', 'quaternion'])
    const id = validateId(record.id, `${boxPath}.id`)
    if (ids.has(id)) invalid(`${boxPath}.id`, `Duplicate collision box id ${id}.`, 'PROJECT_ID_DUPLICATE')
    ids.add(id)
    record.centerM = validateVector3(record.centerM, `${boxPath}.centerM`)
    const halfExtents = validateVector3(record.halfExtentsM, `${boxPath}.halfExtentsM`)
    if (halfExtents.some((component) => component <= 0)) {
      invalid(`${boxPath}.halfExtentsM`, 'Collision-box half extents must be strictly positive.')
    }
    record.halfExtentsM = halfExtents
    record.quaternion = validateQuaternion(record.quaternion, `${boxPath}.quaternion`)
  })
}

function validateNumericStatus(value: unknown, path: string): void {
  const record = expectClosedRecord(value, path, ['value', 'sourceOwnership', 'overlay'])
  record.value = expectFiniteNumber(record.value, `${path}.value`)
  validateOwnership(record.sourceOwnership, `${path}.sourceOwnership`, false)
  const overlay = expectClosedRecord(record.overlay, `${path}.overlay`, ['visible', 'frameId'])
  expectBoolean(overlay.visible, `${path}.overlay.visible`)
  if (overlay.frameId !== null) validateId(overlay.frameId, `${path}.overlay.frameId`)
}

function validateOwnership(value: unknown, path: string, allowAttachment: boolean): string {
  const ownership = expectString(value, path)
  if (ownership === 'manual' || ownership === 'simulation' || (allowAttachment && ownership === 'attachment')) {
    return ownership
  }
  const match = OPCUA_OWNERSHIP_PATTERN.exec(ownership)
  if (match?.[1] !== undefined) {
    validateId(match[1], path)
    return ownership
  }
  invalid(path, 'Expected manual, simulation, attachment where allowed, or opcua:<endpointId>.')
}

interface ShapeContext {
  readonly globalIds: Set<string>
  readonly mappingIds: Set<string>
  readonly actionBindingIds: Set<string>
  readonly bridgeRouteIds: Set<string>
}

function registerId(set: Set<string>, value: unknown, path: string): string {
  const id = validateId(value, path)
  if (set.has(id)) invalid(path, `Duplicate persisted id ${id}.`, 'PROJECT_ID_DUPLICATE')
  set.add(id)
  return id
}

function validateFrame(
  value: unknown,
  path: string,
  ids: Set<string>,
): void {
  const record = expectClosedRecord(value, path, ['id', 'name', 'parentFrameId', 'localPose', 'role'])
  registerId(ids, record.id, `${path}.id`)
  validateName(record.name, `${path}.name`)
  if (record.parentFrameId !== null) validateId(record.parentFrameId, `${path}.parentFrameId`)
  validateRigidTransform(record.localPose, `${path}.localPose`)
  expectEnum(record.role, `${path}.role`, [
    'world', 'mcp', 'base', 'flange', 'tool0', 'tool', 'tcp', 'gripper', 'grasp', 'placement', 'custom',
  ] as const)
}

function validateDefinition(value: unknown, path: string, context: ShapeContext): void {
  const record = expectClosedRecord(value, path, [
    'id',
    'name',
    'manufacturer',
    'model',
    'assetReferenceIds',
    'sourceConventions',
    'links',
    'joints',
    'frames',
    'excludedGeometryOccurrenceKeys',
  ])
  registerId(context.globalIds, record.id, `${path}.id`)
  validateName(record.name, `${path}.name`)
  validateName(record.manufacturer, `${path}.manufacturer`)
  validateName(record.model, `${path}.model`)

  const assetReferenceIds = expectDenseArray(record.assetReferenceIds, `${path}.assetReferenceIds`)
  if (assetReferenceIds.length < MIN_ROBOT_STEP_SOURCES_V4) {
    invalid(`${path}.assetReferenceIds`, 'At least one Robot STEP source is required.', 'ROBOT_STEP_SOURCE_LIMIT_EXCEEDED')
  }
  enforceMaximum(
    assetReferenceIds.length,
    MAX_ROBOT_STEP_SOURCES_V4,
    `${path}.assetReferenceIds`,
    'ROBOT_STEP_SOURCE_LIMIT_EXCEEDED',
  )
  const sourceIds = new Set<string>()
  assetReferenceIds.forEach((assetId, index) => {
    const id = validateId(assetId, `${path}.assetReferenceIds[${index}]`)
    if (sourceIds.has(id)) invalid(`${path}.assetReferenceIds[${index}]`, 'Robot STEP sources must be unique.')
    sourceIds.add(id)
  })

  const sourceConventions = expectRecord(record.sourceConventions, `${path}.sourceConventions`)
  for (const [assetId, convention] of Object.entries(sourceConventions)) {
    validateId(assetId, `${path}.sourceConventions.${assetId}`)
    validateSourceConvention(convention, `${path}.sourceConventions.${assetId}`)
  }

  const joints = expectDenseArray(record.joints, `${path}.joints`)
  if (joints.length < MIN_ROBOT_JOINTS_V4) {
    invalid(`${path}.joints`, 'At least one Joint is required.', 'ROBOT_JOINT_LIMIT_EXCEEDED')
  }
  enforceMaximum(joints.length, MAX_ROBOT_JOINTS_V4, `${path}.joints`, 'ROBOT_JOINT_LIMIT_EXCEEDED')

  const links = expectDenseArray(record.links, `${path}.links`)
  if (links.length < MIN_ROBOT_LINKS_V4 || links.length > MAX_ROBOT_LINKS_V4) {
    invalid(`${path}.links`, `Robot Link count must be ${MIN_ROBOT_LINKS_V4}..${MAX_ROBOT_LINKS_V4}.`, 'ROBOT_LINK_LIMIT_EXCEEDED')
  }
  if (links.length !== joints.length + 1) {
    invalid(`${path}.links`, 'A serial Robot must have exactly Joints + 1 Links.', 'ROBOT_JOINT_CHAIN_INVALID')
  }

  const localIds = new Set<string>()
  const includedOccurrences = new Set<string>()
  links.forEach((link, linkIndex) => {
    const linkPath = `${path}.links[${linkIndex}]`
    const linkRecord = expectClosedRecord(link, linkPath, ['id', 'name', 'geometryOccurrences'])
    registerId(localIds, linkRecord.id, `${linkPath}.id`)
    validateName(linkRecord.name, `${linkPath}.name`)
    const occurrences = expectDenseArray(linkRecord.geometryOccurrences, `${linkPath}.geometryOccurrences`)
    occurrences.forEach((occurrence, occurrenceIndex) => {
      const occurrencePath = `${linkPath}.geometryOccurrences[${occurrenceIndex}]`
      const occurrenceRecord = expectClosedRecord(occurrence, occurrencePath, [
        'occurrenceKey', 'assetReferenceId', 'linkLocalPose', 'statistics', 'collisionBoxes',
      ])
      const key = validateId(occurrenceRecord.occurrenceKey, `${occurrencePath}.occurrenceKey`)
      if (includedOccurrences.has(key)) {
        invalid(`${occurrencePath}.occurrenceKey`, 'Geometry occurrence is included more than once.', 'GEOMETRY_OCCURRENCE_DUPLICATE')
      }
      includedOccurrences.add(key)
      validateId(occurrenceRecord.assetReferenceId, `${occurrencePath}.assetReferenceId`)
      validateRigidTransform(occurrenceRecord.linkLocalPose, `${occurrencePath}.linkLocalPose`)
      validateStatistics(occurrenceRecord.statistics, `${occurrencePath}.statistics`)
      validateCollisionBoxes(occurrenceRecord.collisionBoxes, `${occurrencePath}.collisionBoxes`)
    })
  })

  joints.forEach((joint, jointIndex) => {
    const jointPath = `${path}.joints[${jointIndex}]`
    const jointRecord = expectClosedRecord(joint, jointPath, [
      'id', 'type', 'parentLinkId', 'childLinkId', 'origin', 'axis', 'min', 'max', 'home', 'zeroOffset',
      'direction', 'maximumVelocity',
    ])
    registerId(localIds, jointRecord.id, `${jointPath}.id`)
    expectEnum(jointRecord.type, `${jointPath}.type`, ['revolute', 'prismatic'] as const)
    validateId(jointRecord.parentLinkId, `${jointPath}.parentLinkId`)
    validateId(jointRecord.childLinkId, `${jointPath}.childLinkId`)
    validateRigidTransform(jointRecord.origin, `${jointPath}.origin`)
    jointRecord.axis = normalizeAxis(jointRecord.axis, `${jointPath}.axis`)
    const minimum = expectFiniteNumber(jointRecord.min, `${jointPath}.min`)
    const maximum = expectFiniteNumber(jointRecord.max, `${jointPath}.max`)
    const home = expectFiniteNumber(jointRecord.home, `${jointPath}.home`)
    jointRecord.zeroOffset = expectFiniteNumber(jointRecord.zeroOffset, `${jointPath}.zeroOffset`)
    if (minimum > maximum || home < minimum || home > maximum) {
      invalid(jointPath, 'Joint requires min <= home <= max.', 'ROBOT_JOINT_LIMIT_INVALID')
    }
    if (jointRecord.direction !== 1 && jointRecord.direction !== -1) {
      invalid(`${jointPath}.direction`, 'Joint direction must be 1 or -1.')
    }
    const maximumVelocity = expectFiniteNumber(jointRecord.maximumVelocity, `${jointPath}.maximumVelocity`)
    if (maximumVelocity <= 0) invalid(`${jointPath}.maximumVelocity`, 'Maximum velocity must be positive.')
  })

  const frames = expectDenseArray(record.frames, `${path}.frames`)
  frames.forEach((frame, frameIndex) => validateFrame(frame, `${path}.frames[${frameIndex}]`, localIds))

  const excluded = expectDenseArray(record.excludedGeometryOccurrenceKeys, `${path}.excludedGeometryOccurrenceKeys`)
  const excludedKeys = new Set<string>()
  excluded.forEach((value, index) => {
    const key = validateId(value, `${path}.excludedGeometryOccurrenceKeys[${index}]`)
    if (excludedKeys.has(key)) invalid(`${path}.excludedGeometryOccurrenceKeys[${index}]`, 'Excluded occurrence key is duplicated.')
    if (includedOccurrences.has(key)) {
      invalid(`${path}.excludedGeometryOccurrenceKeys[${index}]`, 'Included and excluded occurrence keys must be disjoint.')
    }
    excludedKeys.add(key)
  })
}

function validateAssetReference(value: unknown, path: string, context: ShapeContext): void {
  const record = expectClosedRecord(value, path, [
    'id', 'uri', 'sha256', 'byteLength', 'sourceFileName', 'mediaType',
  ])
  registerId(context.globalIds, record.id, `${path}.id`)
  validateLogicalUri(record.uri, `${path}.uri`)
  const sha256 = expectString(record.sha256, `${path}.sha256`)
  if (!SHA256_PATTERN.test(sha256)) invalid(`${path}.sha256`, 'Expected exactly 64 lowercase hexadecimal characters.')
  record.byteLength = expectSafeInteger(record.byteLength, `${path}.byteLength`)
  validateSourceFileName(record.sourceFileName, `${path}.sourceFileName`)
  if (record.mediaType !== 'model/step') invalid(`${path}.mediaType`, 'Only model/step is valid in Project V4.')
}

function validateScene(value: unknown, path: string, context: ShapeContext): void {
  const record = expectClosedRecord(value, path, ['frames'])
  const frames = expectDenseArray(record.frames, `${path}.frames`)
  frames.forEach((frame, index) => validateFrame(frame, `${path}.frames[${index}]`, context.globalIds))
}

function validateRobot(value: unknown, path: string, context: ShapeContext): void {
  const record = expectClosedRecord(value, path, [
    'id',
    'name',
    'definitionId',
    'visible',
    'baseParentFrameId',
    'localBasePose',
    'initialJointValues',
    'jointSource',
    'selectedToolFrameId',
    'selectedTcpFrameId',
    'numericStatus',
    'intentionalMountEntityId',
  ])
  registerId(context.globalIds, record.id, `${path}.id`)
  validateName(record.name, `${path}.name`)
  validateId(record.definitionId, `${path}.definitionId`)
  expectBoolean(record.visible, `${path}.visible`)
  validateId(record.baseParentFrameId, `${path}.baseParentFrameId`)
  validateRigidTransform(record.localBasePose, `${path}.localBasePose`)
  const initialJointValues = expectRecord(record.initialJointValues, `${path}.initialJointValues`)
  for (const [jointId, jointValue] of Object.entries(initialJointValues)) {
    validateId(jointId, `${path}.initialJointValues.${jointId}`)
    initialJointValues[jointId] = expectFiniteNumber(jointValue, `${path}.initialJointValues.${jointId}`)
  }
  validateOwnership(record.jointSource, `${path}.jointSource`, false)
  validateId(record.selectedToolFrameId, `${path}.selectedToolFrameId`)
  validateId(record.selectedTcpFrameId, `${path}.selectedTcpFrameId`)
  validateNumericStatus(record.numericStatus, `${path}.numericStatus`)
  if (record.intentionalMountEntityId !== null) {
    validateId(record.intentionalMountEntityId, `${path}.intentionalMountEntityId`)
  }
}

function validateSpatialGeometry(value: unknown, path: string): void {
  const discriminator = expectRecord(value, path)
  const kind = expectEnum(discriminator.kind, `${path}.kind`, ['asset', 'box', 'cylinder'] as const)
  if (kind === 'asset') {
    const record = expectClosedRecord(discriminator, path, [
      'kind',
      'assetReferenceId',
      'occurrenceKey',
      'sourceConvention',
      'originMode',
      'statistics',
      'collisionBoxes',
    ])
    validateId(record.assetReferenceId, `${path}.assetReferenceId`)
    validateId(record.occurrenceKey, `${path}.occurrenceKey`)
    validateSourceConvention(record.sourceConvention, `${path}.sourceConvention`)
    expectEnum(record.originMode, `${path}.originMode`, ['source', 'center'] as const)
    validateStatistics(record.statistics, `${path}.statistics`)
    validateCollisionBoxes(record.collisionBoxes, `${path}.collisionBoxes`)
    return
  }
  if (kind === 'box') {
    const record = expectClosedRecord(discriminator, path, ['kind', 'dimensionsM', 'color'])
    const dimensions = validateVector3(record.dimensionsM, `${path}.dimensionsM`)
    if (dimensions.some((component) => component <= 0)) {
      invalid(`${path}.dimensionsM`, 'Box dimensions must be strictly positive.')
    }
    record.dimensionsM = dimensions
    const color = expectString(record.color, `${path}.color`)
    if (!COLOR_PATTERN.test(color)) invalid(`${path}.color`, 'Expected canonical #RRGGBB color syntax.')
    return
  }
  const record = expectClosedRecord(discriminator, path, [
    'kind', 'radiusM', 'heightM', 'axis', 'radialSegments', 'color',
  ])
  const radius = expectFiniteNumber(record.radiusM, `${path}.radiusM`)
  const height = expectFiniteNumber(record.heightM, `${path}.heightM`)
  if (radius <= 0 || height <= 0) invalid(path, 'Cylinder radius and height must be strictly positive.')
  if (record.axis !== 'z') invalid(`${path}.axis`, 'Project V4 Cylinder axis is fixed to z.')
  if (record.radialSegments !== CYLINDER_RADIAL_SEGMENTS_V4) {
    invalid(`${path}.radialSegments`, `Project V4 Cylinder requires ${CYLINDER_RADIAL_SEGMENTS_V4} radial segments.`)
  }
  const color = expectString(record.color, `${path}.color`)
  if (!COLOR_PATTERN.test(color)) invalid(`${path}.color`, 'Expected canonical #RRGGBB color syntax.')
}

function validateSpatialEntity(value: unknown, path: string, context: ShapeContext): void {
  const record = expectClosedRecord(value, path, [
    'id',
    'name',
    'geometry',
    'parentFrameId',
    'localPose',
    'visible',
    'groupId',
    'removable',
    'transformOwner',
    'numericStatus',
    'graspable',
    'graspFrames',
    'movingFrames',
  ])
  registerId(context.globalIds, record.id, `${path}.id`)
  validateName(record.name, `${path}.name`)
  validateSpatialGeometry(record.geometry, `${path}.geometry`)
  validateId(record.parentFrameId, `${path}.parentFrameId`)
  validateRigidTransform(record.localPose, `${path}.localPose`)
  expectBoolean(record.visible, `${path}.visible`)
  if (record.groupId !== null) validateId(record.groupId, `${path}.groupId`)
  expectBoolean(record.removable, `${path}.removable`)
  validateOwnership(record.transformOwner, `${path}.transformOwner`, true)
  validateNumericStatus(record.numericStatus, `${path}.numericStatus`)
  expectBoolean(record.graspable, `${path}.graspable`)

  const graspFrames = expectDenseArray(record.graspFrames, `${path}.graspFrames`)
  graspFrames.forEach((frame, index) => {
    const framePath = `${path}.graspFrames[${index}]`
    const frameRecord = expectClosedRecord(frame, framePath, ['frameId', 'name', 'localPose'])
    registerId(context.globalIds, frameRecord.frameId, `${framePath}.frameId`)
    validateName(frameRecord.name, `${framePath}.name`)
    validateRigidTransform(frameRecord.localPose, `${framePath}.localPose`)
  })

  const movingFrames = expectDenseArray(record.movingFrames, `${path}.movingFrames`)
  enforceMaximum(
    movingFrames.length,
    MAX_MOVING_FRAMES_PER_ENTITY_V4,
    `${path}.movingFrames`,
    'MOVING_FRAME_LIMIT_EXCEEDED',
  )
  movingFrames.forEach((frame, index) => {
    const framePath = `${path}.movingFrames[${index}]`
    const frameRecord = expectClosedRecord(frame, framePath, [
      'frameId', 'name', 'parentFrameId', 'localPose', 'sourceOwnership',
    ])
    registerId(context.globalIds, frameRecord.frameId, `${framePath}.frameId`)
    validateName(frameRecord.name, `${framePath}.name`)
    validateId(frameRecord.parentFrameId, `${framePath}.parentFrameId`)
    validateRigidTransform(frameRecord.localPose, `${framePath}.localPose`)
    validateOwnership(frameRecord.sourceOwnership, `${framePath}.sourceOwnership`, true)
  })
}

function validateSceneGroup(value: unknown, path: string, context: ShapeContext): void {
  const record = expectClosedRecord(value, path, ['id', 'name', 'parentGroupId', 'visible'])
  registerId(context.globalIds, record.id, `${path}.id`)
  validateName(record.name, `${path}.name`)
  if (record.parentGroupId !== null) validateId(record.parentGroupId, `${path}.parentGroupId`)
  expectBoolean(record.visible, `${path}.visible`)
}

function validateJob(value: unknown, path: string, context: ShapeContext): void {
  const record = expectClosedRecord(value, path, ['id', 'name', 'robotId', 'steps'])
  registerId(context.globalIds, record.id, `${path}.id`)
  validateName(record.name, `${path}.name`)
  validateId(record.robotId, `${path}.robotId`)
  const steps = expectDenseArray(record.steps, `${path}.steps`)
  enforceMaximum(steps.length, MAX_JOB_STEPS_PER_JOB_V4, `${path}.steps`, 'JOB_STEP_LIMIT_EXCEEDED')
  steps.forEach((step, index) => {
    const stepPath = `${path}.steps[${index}]`
    const discriminator = expectRecord(step, stepPath)
    const kind = expectEnum(discriminator.kind, `${stepPath}.kind`, ['joint-pose', 'action-reference'] as const)
    if (kind === 'joint-pose') {
      const stepRecord = expectClosedRecord(discriminator, stepPath, [
        'kind', 'jointValues', 'speedPercentToNext',
      ])
      const jointValues = expectRecord(stepRecord.jointValues, `${stepPath}.jointValues`)
      for (const [jointId, jointValue] of Object.entries(jointValues)) {
        validateId(jointId, `${stepPath}.jointValues.${jointId}`)
        jointValues[jointId] = expectFiniteNumber(jointValue, `${stepPath}.jointValues.${jointId}`)
      }
      const speed = expectSafeInteger(stepRecord.speedPercentToNext, `${stepPath}.speedPercentToNext`, 0)
      if (speed < MIN_JOB_SPEED_PERCENT_V4 || speed > MAX_JOB_SPEED_PERCENT_V4) {
        invalid(`${stepPath}.speedPercentToNext`, `Speed must be ${MIN_JOB_SPEED_PERCENT_V4}..${MAX_JOB_SPEED_PERCENT_V4}.`)
      }
    } else {
      const stepRecord = expectClosedRecord(discriminator, stepPath, ['kind', 'actionId'])
      validateId(stepRecord.actionId, `${stepPath}.actionId`)
    }
  })
}

function validateAction(value: unknown, path: string, context: ShapeContext): void {
  const discriminator = expectRecord(value, path)
  const kind = expectEnum(discriminator.kind, `${path}.kind`, [
    'set-gripper-state', 'attach-object', 'detach-object',
  ] as const)
  if (kind === 'set-gripper-state') {
    const record = expectClosedRecord(discriminator, path, ['id', 'kind', 'robotId', 'state'])
    registerId(context.globalIds, record.id, `${path}.id`)
    validateId(record.robotId, `${path}.robotId`)
    expectEnum(record.state, `${path}.state`, ['OPEN', 'CLOSED'] as const)
    return
  }
  if (kind === 'attach-object') {
    const record = expectClosedRecord(
      discriminator,
      path,
      ['id', 'kind', 'robotId', 'toolFrameId', 'objectId', 'maximumDistanceM'],
      ['objectGraspFrameId'],
    )
    registerId(context.globalIds, record.id, `${path}.id`)
    validateId(record.robotId, `${path}.robotId`)
    validateId(record.toolFrameId, `${path}.toolFrameId`)
    validateId(record.objectId, `${path}.objectId`)
    if (Object.hasOwn(record, 'objectGraspFrameId')) {
      validateId(record.objectGraspFrameId, `${path}.objectGraspFrameId`)
    }
    const maximumDistance = expectFiniteNumber(record.maximumDistanceM, `${path}.maximumDistanceM`)
    if (maximumDistance < 0) invalid(`${path}.maximumDistanceM`, 'Maximum attach distance must be non-negative.')
    return
  }
  const record = expectClosedRecord(discriminator, path, ['id', 'kind', 'objectId'], ['targetParentFrameId'])
  registerId(context.globalIds, record.id, `${path}.id`)
  validateId(record.objectId, `${path}.objectId`)
  if (Object.hasOwn(record, 'targetParentFrameId')) {
    validateId(record.targetParentFrameId, `${path}.targetParentFrameId`)
  }
}

function validateEndpointUrl(value: unknown, path: string): string {
  const url = validateBoundedText(value, path, MAX_OPCUA_ENDPOINT_URL_UTF8_BYTES_V4)
  if (!/^(?:opc\.tcp|https?):\/\/[^\s\\?#]+$/u.test(url)) {
    invalid(path, 'Endpoint URL must use canonical opc.tcp, http, or https syntax.')
  }
  return url
}

function validateNodeId(value: unknown, path: string): string {
  return validateBoundedText(value, path, MAX_OPCUA_NODE_ID_UTF8_BYTES_V4)
}

function validateProjectTarget(value: unknown, path: string): void {
  const discriminator = expectRecord(value, path)
  const type = expectEnum(discriminator.type, `${path}.type`, [
    'robot-joint', 'robot-frame', 'robot-status', 'entity-frame', 'entity-status',
  ] as const)
  if (type === 'robot-joint') {
    const record = expectClosedRecord(discriminator, path, ['type', 'robotId', 'jointId'])
    validateId(record.robotId, `${path}.robotId`)
    validateId(record.jointId, `${path}.jointId`)
  } else if (type === 'robot-frame') {
    const record = expectClosedRecord(discriminator, path, ['type', 'robotId', 'frameId'])
    validateId(record.robotId, `${path}.robotId`)
    validateId(record.frameId, `${path}.frameId`)
  } else if (type === 'robot-status') {
    const record = expectClosedRecord(discriminator, path, ['type', 'robotId'])
    validateId(record.robotId, `${path}.robotId`)
  } else if (type === 'entity-frame') {
    const record = expectClosedRecord(discriminator, path, ['type', 'entityId', 'frameId'])
    validateId(record.entityId, `${path}.entityId`)
    validateId(record.frameId, `${path}.frameId`)
  } else {
    const record = expectClosedRecord(discriminator, path, ['type', 'entityId'])
    validateId(record.entityId, `${path}.entityId`)
  }
}

interface LeafPathTreeNode {
  childKind?: 'named' | 'numeric'
  readonly children: Map<string, LeafPathTreeNode>
  terminal: boolean
}

function createLeafPathTreeNode(): LeafPathTreeNode {
  return { children: new Map<string, LeafPathTreeNode>(), terminal: false }
}

function insertLeafPath(
  root: LeafPathTreeNode,
  segments: readonly (string | number)[],
  path: string,
): void {
  let node = root
  for (const segment of segments) {
    if (node.terminal) {
      invalid(path, 'A Mapping Leaf path cannot descend from another terminal Leaf.', 'OPCUA_LEAF_PATH_TREE_INVALID')
    }
    const childKind = typeof segment === 'string' ? 'named' : 'numeric'
    if (node.childKind !== undefined && node.childKind !== childKind) {
      invalid(path, 'One Mapping container cannot mix named and numeric children.', 'OPCUA_LEAF_PATH_TREE_INVALID')
    }
    node.childKind = childKind
    const childKey = `${childKind}:${segment}`
    const child = node.children.get(childKey) ?? createLeafPathTreeNode()
    node.children.set(childKey, child)
    node = child
  }
  if (node.children.size !== 0) {
    invalid(path, 'A terminal Mapping Leaf cannot be an ancestor of another Leaf.', 'OPCUA_LEAF_PATH_TREE_INVALID')
  }
  node.terminal = true
}

function validateMapping(value: unknown, path: string, context: ShapeContext): void {
  const record = expectClosedRecord(
    value,
    path,
    [
      'id',
      'endpointId',
      'direction',
      'coherenceGroupId',
      'sourceOwnership',
      'interpolationMode',
      'coordinateConvention',
      'leaves',
    ],
    ['publishingIntervalMs'],
  )
  registerId(context.mappingIds, record.id, `${path}.id`)
  validateId(record.endpointId, `${path}.endpointId`)
  expectEnum(record.direction, `${path}.direction`, [
    'read', 'write', 'readWrite', 'publish', 'action-trigger',
  ] as const)
  if (Object.hasOwn(record, 'publishingIntervalMs')) {
    const interval = expectSafeInteger(record.publishingIntervalMs, `${path}.publishingIntervalMs`, 0)
    if (interval < MIN_OPCUA_PUBLISHING_INTERVAL_MS_V4) {
      invalid(`${path}.publishingIntervalMs`, `Publishing interval must be at least ${MIN_OPCUA_PUBLISHING_INTERVAL_MS_V4} ms.`)
    }
  }
  if (record.coherenceGroupId !== null) validateId(record.coherenceGroupId, `${path}.coherenceGroupId`)
  validateOwnership(record.sourceOwnership, `${path}.sourceOwnership`, true)
  expectEnum(record.interpolationMode, `${path}.interpolationMode`, [
    'none', 'linear', 'shortest-quaternion', 'revolute-wrapped',
  ] as const)
  if (record.coordinateConvention !== 'project-v4-z-up-metres-quaternion-xyzw') {
    invalid(`${path}.coordinateConvention`, 'Coordinate convention must be the Project V4 canonical value.')
  }

  const leaves = expectDenseArray(record.leaves, `${path}.leaves`)
  if (leaves.length === 0) invalid(`${path}.leaves`, 'Every OPC UA Mapping requires at least one Leaf.')
  enforceMaximum(
    leaves.length,
    MAX_OPCUA_EXPANDED_LEAVES_PER_STRUCTURE_V4,
    `${path}.leaves`,
    'OPCUA_STRUCTURE_LEAF_LIMIT_EXCEEDED',
  )
  const leafPaths = new Set<string>()
  const leafPathTree = createLeafPathTreeNode()
  const numericIndicesByPrefix = new Map<string, Set<number>>()
  leaves.forEach((leaf, leafIndex) => {
    const leafPath = `${path}.leaves[${leafIndex}]`
    const leafRecord = expectClosedRecord(leaf, leafPath, [
      'leafPath',
      'nodeId',
      'projectTarget',
      'opcUaDataType',
      'projectDataType',
      'scale',
      'offset',
      'unit',
      'required',
    ])
    const segments = expectDenseArray(leafRecord.leafPath, `${leafPath}.leafPath`)
    enforceMaximum(
      segments.length,
      MAX_OPCUA_STRUCTURE_DEPTH_V4,
      `${leafPath}.leafPath`,
      'OPCUA_STRUCTURE_DEPTH_LIMIT_EXCEEDED',
    )
    const validatedSegments = segments.map((segment, segmentIndex): string | number => {
      const segmentPath = `${leafPath}.leafPath[${segmentIndex}]`
      if (typeof segment === 'string') {
        return validateBoundedText(segment, segmentPath, MAX_IDENTIFIER_UTF8_BYTES_V4)
      }
      return expectSafeInteger(segment, segmentPath)
    })
    leafRecord.leafPath = validatedSegments
    const serializedPath = JSON.stringify(validatedSegments)
    if (leafPaths.has(serializedPath)) invalid(`${leafPath}.leafPath`, 'Mapping Leaf path is duplicated.')
    leafPaths.add(serializedPath)
    insertLeafPath(leafPathTree, validatedSegments, `${leafPath}.leafPath`)
    validatedSegments.forEach((segment, segmentIndex) => {
      if (typeof segment === 'string') return
      const prefix = JSON.stringify(validatedSegments.slice(0, segmentIndex))
      const indices = numericIndicesByPrefix.get(prefix) ?? new Set<number>()
      indices.add(segment)
      numericIndicesByPrefix.set(prefix, indices)
    })
    validateNodeId(leafRecord.nodeId, `${leafPath}.nodeId`)
    validateProjectTarget(leafRecord.projectTarget, `${leafPath}.projectTarget`)
    const opcUaDataType = expectEnum(leafRecord.opcUaDataType, `${leafPath}.opcUaDataType`, [
      'Boolean', 'SByte', 'Byte', 'Int16', 'UInt16', 'Int32', 'UInt32', 'Float', 'Double', 'String',
    ] as const)
    const projectDataType = expectEnum(leafRecord.projectDataType, `${leafPath}.projectDataType`, [
      'boolean', 'integer', 'number', 'string',
    ] as const)
    const expectedProjectDataType = opcUaDataType === 'Boolean'
      ? 'boolean'
      : opcUaDataType === 'Float' || opcUaDataType === 'Double'
        ? 'number'
        : opcUaDataType === 'String'
          ? 'string'
          : 'integer'
    if (projectDataType !== expectedProjectDataType) {
      invalid(
        `${leafPath}.projectDataType`,
        `${opcUaDataType} requires Project scalar type ${expectedProjectDataType}.`,
        'OPCUA_DATA_TYPE_MISMATCH',
      )
    }
    leafRecord.scale = expectFiniteNumber(leafRecord.scale, `${leafPath}.scale`)
    leafRecord.offset = expectFiniteNumber(leafRecord.offset, `${leafPath}.offset`)
    validateBoundedText(leafRecord.unit, `${leafPath}.unit`, MAX_NAME_UTF8_BYTES_V4, true)
    expectBoolean(leafRecord.required, `${leafPath}.required`)
  })

  for (const [prefix, indices] of numericIndicesByPrefix) {
    const sorted = [...indices].sort((left, right) => left - right)
    const size = (sorted.at(-1) ?? -1) + 1
    if (size > MAX_OPCUA_FIXED_ARRAY_ELEMENTS_V4) {
      invalid(`${path}.leaves`, `Fixed array at ${prefix} exceeds ${MAX_OPCUA_FIXED_ARRAY_ELEMENTS_V4} elements.`, 'OPCUA_FIXED_ARRAY_LIMIT_EXCEEDED')
    }
    if (sorted.some((index, position) => index !== position)) {
      invalid(`${path}.leaves`, `Fixed array at ${prefix} has sparse indices.`, 'OPCUA_FIXED_ARRAY_SPARSE')
    }
  }
}

function validateOpcUa(value: unknown, path: string, context: ShapeContext): void {
  const record = expectClosedRecord(value, path, ['mode', 'endpoints', 'mappings', 'actionBindings', 'bridgeRoutes'])
  expectEnum(record.mode, `${path}.mode`, ['off', 'client', 'server', 'bridge'] as const)
  const endpoints = expectDenseArray(record.endpoints, `${path}.endpoints`)
  enforceMaximum(endpoints.length, MAX_OPCUA_ENDPOINTS_V4, `${path}.endpoints`, 'OPCUA_ENDPOINT_LIMIT_EXCEEDED')
  endpoints.forEach((endpoint, index) => {
    const endpointPath = `${path}.endpoints[${index}]`
    const endpointRecord = expectClosedRecord(endpoint, endpointPath, [
      'endpointId', 'name', 'endpointUrl', 'enabled', 'publishingIntervalMs', 'reconnectDelayMs',
    ])
    registerId(context.globalIds, endpointRecord.endpointId, `${endpointPath}.endpointId`)
    validateName(endpointRecord.name, `${endpointPath}.name`)
    validateEndpointUrl(endpointRecord.endpointUrl, `${endpointPath}.endpointUrl`)
    expectBoolean(endpointRecord.enabled, `${endpointPath}.enabled`)
    const interval = expectSafeInteger(endpointRecord.publishingIntervalMs, `${endpointPath}.publishingIntervalMs`, 0)
    if (interval < MIN_OPCUA_PUBLISHING_INTERVAL_MS_V4) {
      invalid(`${endpointPath}.publishingIntervalMs`, `Publishing interval must be at least ${MIN_OPCUA_PUBLISHING_INTERVAL_MS_V4} ms.`)
    }
    endpointRecord.reconnectDelayMs = expectSafeInteger(
      endpointRecord.reconnectDelayMs,
      `${endpointPath}.reconnectDelayMs`,
    )
  })

  const mappings = expectDenseArray(record.mappings, `${path}.mappings`)
  enforceMaximum(mappings.length, MAX_OPCUA_STRUCTURE_ROOTS_V4, `${path}.mappings`, 'OPCUA_STRUCTURE_ROOT_LIMIT_EXCEEDED')
  mappings.forEach((mapping, index) => validateMapping(mapping, `${path}.mappings[${index}]`, context))

  const bindings = expectDenseArray(record.actionBindings, `${path}.actionBindings`)
  bindings.forEach((binding, index) => {
    const bindingPath = `${path}.actionBindings[${index}]`
    const bindingRecord = expectClosedRecord(binding, bindingPath, [
      'id', 'endpointId', 'nodeId', 'kind', 'actionId', 'triggerMode', 'integerCommandValue',
    ])
    registerId(context.actionBindingIds, bindingRecord.id, `${bindingPath}.id`)
    validateId(bindingRecord.endpointId, `${bindingPath}.endpointId`)
    validateNodeId(bindingRecord.nodeId, `${bindingPath}.nodeId`)
    expectEnum(bindingRecord.kind, `${bindingPath}.kind`, ['action-execute', 'job-start'] as const)
    validateId(bindingRecord.actionId, `${bindingPath}.actionId`)
    const triggerMode = expectEnum(bindingRecord.triggerMode, `${bindingPath}.triggerMode`, [
      'boolean-rising-edge', 'integer-command-value',
    ] as const)
    if (triggerMode === 'boolean-rising-edge') {
      if (bindingRecord.integerCommandValue !== null) {
        invalid(`${bindingPath}.integerCommandValue`, 'Boolean rising-edge Binding requires null.')
      }
    } else {
      bindingRecord.integerCommandValue = expectSafeInteger(
        bindingRecord.integerCommandValue,
        `${bindingPath}.integerCommandValue`,
        Number.MIN_SAFE_INTEGER,
      )
    }
  })

  const routes = expectDenseArray(record.bridgeRoutes, `${path}.bridgeRoutes`)
  routes.forEach((route, index) => {
    const routePath = `${path}.bridgeRoutes[${index}]`
    const routeRecord = expectClosedRecord(route, routePath, [
      'id',
      'sourceChannelId',
      'destinationChannelId',
      'direction',
      'scale',
      'offset',
      'unit',
      'sourceOwnership',
    ])
    registerId(context.bridgeRouteIds, routeRecord.id, `${routePath}.id`)
    validateId(routeRecord.sourceChannelId, `${routePath}.sourceChannelId`)
    validateId(routeRecord.destinationChannelId, `${routePath}.destinationChannelId`)
    if (routeRecord.direction !== 'forward') invalid(`${routePath}.direction`, 'Bridge route direction is fixed to forward.')
    routeRecord.scale = expectFiniteNumber(routeRecord.scale, `${routePath}.scale`)
    routeRecord.offset = expectFiniteNumber(routeRecord.offset, `${routePath}.offset`)
    validateBoundedText(routeRecord.unit, `${routePath}.unit`, MAX_NAME_UTF8_BYTES_V4, true)
    expectEnum(routeRecord.sourceOwnership, `${routePath}.sourceOwnership`, ['client', 'server'] as const)
  })
}

function validateClosedShape(root: MutableRecord, context: ShapeContext): WorkcellProjectV4 {
  registerId(context.globalIds, root.projectId, '$.projectId')
  registerId(context.globalIds, root.revisionId, '$.revisionId')

  const metadata = expectClosedRecord(root.metadata, '$.metadata', ['name', 'createdAt', 'updatedAt'])
  validateName(metadata.name, '$.metadata.name')
  const createdAt = validateIsoTimestamp(metadata.createdAt, '$.metadata.createdAt')
  const updatedAt = validateIsoTimestamp(metadata.updatedAt, '$.metadata.updatedAt')
  if (Date.parse(updatedAt) < Date.parse(createdAt)) {
    invalid('$.metadata.updatedAt', 'updatedAt must not precede createdAt.')
  }

  expectDenseArray(root.assetReferences, '$.assetReferences').forEach((asset, index) => {
    validateAssetReference(asset, `$.assetReferences[${index}]`, context)
  })
  validateScene(root.scene, '$.scene', context)
  expectDenseArray(root.robotDefinitions, '$.robotDefinitions').forEach((definition, index) => {
    validateDefinition(definition, `$.robotDefinitions[${index}]`, context)
  })
  expectDenseArray(root.robots, '$.robots').forEach((robot, index) => {
    validateRobot(robot, `$.robots[${index}]`, context)
  })
  expectDenseArray(root.spatialEntities, '$.spatialEntities').forEach((entity, index) => {
    validateSpatialEntity(entity, `$.spatialEntities[${index}]`, context)
  })
  expectDenseArray(root.sceneGroups, '$.sceneGroups').forEach((group, index) => {
    validateSceneGroup(group, `$.sceneGroups[${index}]`, context)
  })
  expectDenseArray(root.jobs, '$.jobs').forEach((job, index) => validateJob(job, `$.jobs[${index}]`, context))
  expectDenseArray(root.actions, '$.actions').forEach((action, index) => {
    validateAction(action, `$.actions[${index}]`, context)
  })
  validateOpcUa(root.opcUa, '$.opcUa', context)

  return root as unknown as WorkcellProjectV4
}

function requireReference<T>(
  values: ReadonlyMap<string, T>,
  id: string,
  path: string,
  code: string,
  label: string,
): T {
  const value = values.get(id)
  if (value === undefined) invalid(path, `${label} ${id} does not exist.`, code)
  return value
}

function detectParentCycles(
  parents: ReadonlyMap<string, string | null>,
  paths: ReadonlyMap<string, string>,
  code: string,
): void {
  const states = new Map<string, 'visiting' | 'done'>()
  const visit = (id: string): void => {
    const state = states.get(id)
    if (state === 'visiting') invalid(paths.get(id) ?? '$', `Parent cycle includes ${id}.`, code)
    if (state === 'done') return
    states.set(id, 'visiting')
    const parent = parents.get(id)
    if (parent !== undefined && parent !== null) visit(parent)
    states.set(id, 'done')
  }
  for (const id of parents.keys()) visit(id)
}

interface GlobalFrameFacts {
  readonly frameIds: Set<string>
  readonly paths: Map<string, string>
}

function validateGlobalFrames(project: WorkcellProjectV4): GlobalFrameFacts {
  const totalFrames = project.scene.frames.length
    + project.robotDefinitions.reduce((sum, definition) => sum + definition.frames.length, 0)
    + project.spatialEntities.reduce(
      (sum, entity) => sum + entity.graspFrames.length + entity.movingFrames.length,
      0,
    )
  enforceMaximum(totalFrames, MAX_PROJECT_FRAMES_V4, '$', 'PROJECT_FRAME_LIMIT_EXCEEDED')

  const sceneFrames = new Map(project.scene.frames.map((frame) => [frame.id, frame]))
  const worldFrames = project.scene.frames.filter((frame) => frame.role === 'world')
  if (worldFrames.length !== 1) {
    invalid('$.scene.frames', 'Scene requires exactly one world Frame.', 'WORLD_FRAME_INVALID')
  }
  if (worldFrames[0]?.parentFrameId !== null) {
    invalid('$.scene.frames', 'The world Frame must be the only Scene Frame without a parent.', 'WORLD_FRAME_INVALID')
  }
  if (!project.scene.frames.some((frame) => frame.role === 'mcp')) {
    invalid('$.scene.frames', 'Scene requires at least one MCP Frame.', 'MCP_FRAME_NOT_FOUND')
  }

  const sceneParents = new Map<string, string | null>()
  const scenePaths = new Map<string, string>()
  project.scene.frames.forEach((frame, index) => {
    const path = `$.scene.frames[${index}].parentFrameId`
    scenePaths.set(frame.id, path)
    if (frame.role !== 'world' && frame.parentFrameId === null) {
      invalid(path, 'Only the world Scene Frame may have a null parent.', 'FRAME_PARENT_NOT_FOUND')
    }
    if (frame.parentFrameId !== null && !sceneFrames.has(frame.parentFrameId)) {
      invalid(path, `Scene Frame parent ${frame.parentFrameId} does not exist.`, 'FRAME_PARENT_NOT_FOUND')
    }
    sceneParents.set(frame.id, frame.parentFrameId)
  })
  detectParentCycles(sceneParents, scenePaths, 'FRAME_CYCLE')

  const frameIds = new Set(sceneFrames.keys())
  const parents = new Map(sceneParents)
  const paths = new Map(scenePaths)
  project.spatialEntities.forEach((entity, entityIndex) => {
    entity.graspFrames.forEach((frame, frameIndex) => {
      frameIds.add(frame.frameId)
      parents.set(frame.frameId, entity.parentFrameId)
      paths.set(frame.frameId, `$.spatialEntities[${entityIndex}].graspFrames[${frameIndex}].frameId`)
    })
    entity.movingFrames.forEach((frame, frameIndex) => {
      frameIds.add(frame.frameId)
      parents.set(frame.frameId, frame.parentFrameId)
      paths.set(frame.frameId, `$.spatialEntities[${entityIndex}].movingFrames[${frameIndex}].parentFrameId`)
    })
  })
  for (const [frameId, parentId] of parents) {
    if (parentId !== null && !frameIds.has(parentId)) {
      invalid(paths.get(frameId) ?? '$', `Frame parent ${parentId} does not exist.`, 'FRAME_PARENT_NOT_FOUND')
    }
  }
  detectParentCycles(parents, paths, 'FRAME_CYCLE')
  return { frameIds, paths }
}

interface DefinitionFacts {
  readonly definition: RobotDefinitionV4
  readonly joints: Map<string, RobotJointDefinitionV4>
  readonly frames: Map<string, FrameDefinitionV4>
  readonly triangleCount: number
}

function validateSerialJointChain(definition: RobotDefinitionV4, path: string): void {
  const links = new Set(definition.links.map((link) => link.id))
  const inDegree = new Map([...links].map((linkId) => [linkId, 0]))
  const outDegree = new Map([...links].map((linkId) => [linkId, 0]))
  const childByParent = new Map<string, string>()
  definition.joints.forEach((joint, index) => {
    const jointPath = `${path}.joints[${index}]`
    if (!links.has(joint.parentLinkId)) {
      invalid(`${jointPath}.parentLinkId`, `Link ${joint.parentLinkId} does not exist.`, 'ROBOT_LINK_NOT_FOUND')
    }
    if (!links.has(joint.childLinkId)) {
      invalid(`${jointPath}.childLinkId`, `Link ${joint.childLinkId} does not exist.`, 'ROBOT_LINK_NOT_FOUND')
    }
    if (joint.parentLinkId === joint.childLinkId) {
      invalid(jointPath, 'A Joint cannot connect a Link to itself.', 'ROBOT_JOINT_CHAIN_INVALID')
    }
    const parentOutDegree = (outDegree.get(joint.parentLinkId) ?? 0) + 1
    const childInDegree = (inDegree.get(joint.childLinkId) ?? 0) + 1
    if (parentOutDegree > 1 || childInDegree > 1) {
      invalid(jointPath, 'Robot Joint graph branches and is not a serial chain.', 'ROBOT_JOINT_CHAIN_INVALID')
    }
    outDegree.set(joint.parentLinkId, parentOutDegree)
    inDegree.set(joint.childLinkId, childInDegree)
    childByParent.set(joint.parentLinkId, joint.childLinkId)
  })

  const roots = [...links].filter((linkId) => inDegree.get(linkId) === 0)
  const tips = [...links].filter((linkId) => outDegree.get(linkId) === 0)
  if (roots.length !== 1 || tips.length !== 1) {
    invalid(`${path}.joints`, 'Robot Joint graph must have one root and one tip.', 'ROBOT_JOINT_CHAIN_INVALID')
  }
  const visited = new Set<string>()
  let cursor: string | undefined = roots[0]
  while (cursor !== undefined && !visited.has(cursor)) {
    visited.add(cursor)
    cursor = childByParent.get(cursor)
  }
  if (visited.size !== links.size || cursor !== undefined) {
    invalid(`${path}.joints`, 'Robot Joint graph must be one connected acyclic serial chain.', 'ROBOT_JOINT_CHAIN_INVALID')
  }
}

function validateDefinitionFrames(definition: RobotDefinitionV4, path: string): void {
  const links = new Set(definition.links.map((link) => link.id))
  const frames = new Map(definition.frames.map((frame) => [frame.id, frame]))
  const parents = new Map<string, string | null>()
  const paths = new Map<string, string>()
  definition.frames.forEach((frame, index) => {
    const framePath = `${path}.frames[${index}].parentFrameId`
    paths.set(frame.id, framePath)
    if (frame.parentFrameId === null) {
      invalid(framePath, 'Robot Definition Frame must parent a local Link or Frame.', 'FRAME_PARENT_NOT_FOUND')
    }
    if (links.has(frame.parentFrameId)) {
      parents.set(frame.id, null)
      return
    }
    if (!frames.has(frame.parentFrameId)) {
      invalid(framePath, `Definition-local parent ${frame.parentFrameId} does not exist.`, 'FRAME_PARENT_NOT_FOUND')
    }
    parents.set(frame.id, frame.parentFrameId)
  })
  detectParentCycles(parents, paths, 'FRAME_CYCLE')
}

function validateDefinitionSemantics(
  definition: RobotDefinitionV4,
  index: number,
  assets: ReadonlyMap<string, AssetReferenceV4>,
  referencedAssetIds: Set<string>,
): DefinitionFacts {
  const path = `$.robotDefinitions[${index}]`
  const conventionKeys = Object.keys(definition.sourceConventions)
  const sourceIds = new Set(definition.assetReferenceIds)
  if (conventionKeys.length !== sourceIds.size || conventionKeys.some((id) => !sourceIds.has(id))) {
    invalid(`${path}.sourceConventions`, 'Source conventions must have exactly the Robot source ID key set.', 'SOURCE_CONVENTION_KEY_MISMATCH')
  }

  let referencedBytes = 0
  for (const [sourceIndex, assetId] of definition.assetReferenceIds.entries()) {
    const asset = requireReference(
      assets,
      assetId,
      `${path}.assetReferenceIds[${sourceIndex}]`,
      'ASSET_REFERENCE_NOT_FOUND',
      'Asset reference',
    )
    if (asset.byteLength === 0) {
      invalid(`${path}.assetReferenceIds[${sourceIndex}]`, 'Referenced STEP source must have a positive byte length.')
    }
    referencedBytes += asset.byteLength
    referencedAssetIds.add(assetId)
  }
  if (referencedBytes > MAX_ROBOT_DEFINITION_STEP_BYTES_V4) {
    invalid(path, 'Robot Definition STEP bytes exceed the configured budget.', 'ROBOT_DEFINITION_STEP_BYTE_LIMIT_EXCEEDED')
  }

  let triangleCount = 0
  definition.links.forEach((link, linkIndex) => {
    link.geometryOccurrences.forEach((occurrence, occurrenceIndex) => {
      const occurrencePath = `${path}.links[${linkIndex}].geometryOccurrences[${occurrenceIndex}]`
      if (!sourceIds.has(occurrence.assetReferenceId)) {
        invalid(`${occurrencePath}.assetReferenceId`, 'Robot Geometry occurrence must use one of its Definition sources.', 'ASSET_REFERENCE_NOT_FOUND')
      }
      requireReference(
        assets,
        occurrence.assetReferenceId,
        `${occurrencePath}.assetReferenceId`,
        'ASSET_REFERENCE_NOT_FOUND',
        'Asset reference',
      )
      triangleCount += occurrence.statistics.triangles
    })
  })
  if (triangleCount > MAX_ROBOT_DEFINITION_TRIANGLES_V4) {
    invalid(path, 'Robot Definition triangles exceed the configured budget.', 'ROBOT_DEFINITION_TRIANGLE_LIMIT_EXCEEDED')
  }

  validateSerialJointChain(definition, path)
  validateDefinitionFrames(definition, path)
  return {
    definition,
    joints: new Map(definition.joints.map((joint) => [joint.id, joint])),
    frames: new Map(definition.frames.map((frame) => [frame.id, frame])),
    triangleCount,
  }
}

function endpointIdForOwnership(ownership: string): string | undefined {
  return OPCUA_OWNERSHIP_PATTERN.exec(ownership)?.[1]
}

function validateOwnershipReference(
  ownership: string,
  endpoints: ReadonlyMap<string, unknown>,
  path: string,
): void {
  const endpointId = endpointIdForOwnership(ownership)
  if (endpointId !== undefined && !endpoints.has(endpointId)) {
    invalid(path, `OPC UA endpoint ${endpointId} does not exist.`, 'OPCUA_ENDPOINT_NOT_FOUND')
  }
}

function expectExactJointValues(
  jointValues: Readonly<Record<string, number>>,
  facts: DefinitionFacts,
  path: string,
): void {
  const keys = Object.keys(jointValues)
  if (keys.length !== facts.joints.size || keys.some((key) => !facts.joints.has(key))) {
    invalid(path, 'Joint value keys must exactly match the selected Robot Definition.', 'ROBOT_JOINT_KEY_SET_MISMATCH')
  }
  for (const [jointId, value] of Object.entries(jointValues)) {
    const joint = facts.joints.get(jointId)!
    if (value < joint.min || value > joint.max) {
      invalid(`${path}.${jointId}`, `Joint value must be within ${joint.min}..${joint.max}.`, 'ROBOT_JOINT_VALUE_OUT_OF_RANGE')
    }
  }
}

function validateGroupGraph(groups: readonly SceneGroupV4[]): Map<string, boolean> {
  const groupMap = new Map(groups.map((group) => [group.id, group]))
  const parents = new Map<string, string | null>()
  const paths = new Map<string, string>()
  groups.forEach((group, index) => {
    const path = `$.sceneGroups[${index}].parentGroupId`
    if (group.parentGroupId !== null && !groupMap.has(group.parentGroupId)) {
      invalid(path, `Scene Group ${group.parentGroupId} does not exist.`, 'SCENE_GROUP_NOT_FOUND')
    }
    parents.set(group.id, group.parentGroupId)
    paths.set(group.id, path)
  })
  detectParentCycles(parents, paths, 'SCENE_GROUP_CYCLE')

  const effectiveVisibility = new Map<string, boolean>()
  const resolve = (id: string): boolean => {
    const cached = effectiveVisibility.get(id)
    if (cached !== undefined) return cached
    const group = groupMap.get(id)!
    const visible = group.visible && (group.parentGroupId === null || resolve(group.parentGroupId))
    effectiveVisibility.set(id, visible)
    return visible
  }
  for (const id of groupMap.keys()) resolve(id)
  return effectiveVisibility
}

function sourceConventionIdentity(convention: SourceConventionV4): string {
  const orientation = convention.orientation.mode === 'up-axis'
    ? `axis:${convention.orientation.upAxis}`
    : `quaternion:${convention.orientation.quaternion.join(',')}`
  return `${convention.linearUnit}|${convention.sourceToMeters}|${orientation}`
}

function validateRobotAndEntityReferences(
  project: WorkcellProjectV4,
  definitionFacts: ReadonlyMap<string, DefinitionFacts>,
  assets: ReadonlyMap<string, AssetReferenceV4>,
  endpoints: ReadonlyMap<string, unknown>,
  globalFrames: GlobalFrameFacts,
  referencedAssetIds: Set<string>,
  effectiveGroupVisibility: ReadonlyMap<string, boolean>,
): { readonly visibleTriangles: number; readonly robots: Map<string, RobotInstanceV4>; readonly entities: Map<string, SpatialEntityV4> } {
  const entities = new Map(project.spatialEntities.map((entity) => [entity.id, entity]))
  const robots = new Map(project.robots.map((robot) => [robot.id, robot]))
  const definitionReferenceCounts = new Map<string, number>()
  let visibleTriangles = 0

  project.robots.forEach((robot, index) => {
    const path = `$.robots[${index}]`
    const facts = definitionFacts.get(robot.definitionId)
    if (facts === undefined) {
      invalid(`${path}.definitionId`, `Robot Definition ${robot.definitionId} does not exist.`, 'ROBOT_DEFINITION_NOT_FOUND')
    }
    definitionReferenceCounts.set(robot.definitionId, (definitionReferenceCounts.get(robot.definitionId) ?? 0) + 1)
    if (!globalFrames.frameIds.has(robot.baseParentFrameId)) {
      invalid(`${path}.baseParentFrameId`, `Base parent Frame ${robot.baseParentFrameId} does not exist.`, 'FRAME_PARENT_NOT_FOUND')
    }
    expectExactJointValues(robot.initialJointValues, facts, `${path}.initialJointValues`)
    const toolFrame = facts.frames.get(robot.selectedToolFrameId)
    if (toolFrame === undefined) {
      invalid(`${path}.selectedToolFrameId`, `Selected Tool Frame ${robot.selectedToolFrameId} does not exist.`, 'ROBOT_FRAME_NOT_FOUND')
    }
    const tcpFrame = facts.frames.get(robot.selectedTcpFrameId)
    if (tcpFrame === undefined || tcpFrame.role !== 'tcp') {
      invalid(`${path}.selectedTcpFrameId`, `Selected TCP Frame ${robot.selectedTcpFrameId} is invalid.`, 'ROBOT_FRAME_NOT_FOUND')
    }
    validateOwnershipReference(robot.jointSource, endpoints, `${path}.jointSource`)
    validateOwnershipReference(robot.numericStatus.sourceOwnership, endpoints, `${path}.numericStatus.sourceOwnership`)
    if (robot.numericStatus.overlay.frameId !== null && !facts.frames.has(robot.numericStatus.overlay.frameId)) {
      invalid(`${path}.numericStatus.overlay.frameId`, 'Robot status overlay Frame does not belong to its Definition.', 'ROBOT_FRAME_NOT_FOUND')
    }
    if (robot.intentionalMountEntityId !== null && !entities.has(robot.intentionalMountEntityId)) {
      invalid(`${path}.intentionalMountEntityId`, 'Intentional mount Entity does not exist.', 'SPATIAL_ENTITY_NOT_FOUND')
    }
    if (robot.visible) visibleTriangles += facts.triangleCount
  })

  for (const [definitionId] of definitionFacts) {
    if (!definitionReferenceCounts.has(definitionId)) {
      invalid('$.robotDefinitions', `Robot Definition ${definitionId} is not referenced.`, 'ROBOT_DEFINITION_UNREFERENCED')
    }
  }

  const objectIdentities = new Set<string>()
  project.spatialEntities.forEach((entity, index) => {
    const path = `$.spatialEntities[${index}]`
    if (!globalFrames.frameIds.has(entity.parentFrameId)) {
      invalid(`${path}.parentFrameId`, `Entity parent Frame ${entity.parentFrameId} does not exist.`, 'FRAME_PARENT_NOT_FOUND')
    }
    if (entity.groupId !== null && !effectiveGroupVisibility.has(entity.groupId)) {
      invalid(`${path}.groupId`, `Scene Group ${entity.groupId} does not exist.`, 'SCENE_GROUP_NOT_FOUND')
    }
    validateOwnershipReference(entity.transformOwner, endpoints, `${path}.transformOwner`)
    validateOwnershipReference(entity.numericStatus.sourceOwnership, endpoints, `${path}.numericStatus.sourceOwnership`)
    if (entity.numericStatus.overlay.frameId !== null && !globalFrames.frameIds.has(entity.numericStatus.overlay.frameId)) {
      invalid(`${path}.numericStatus.overlay.frameId`, 'Entity status overlay Frame does not exist.', 'FRAME_PARENT_NOT_FOUND')
    }
    if (!entity.graspable && entity.graspFrames.length !== 0) {
      invalid(`${path}.graspFrames`, 'A non-graspable Entity cannot declare Grasp Frames.', 'OBJECT_GRASP_FRAME_INVALID')
    }
    entity.movingFrames.forEach((frame, frameIndex) => {
      validateOwnershipReference(
        frame.sourceOwnership,
        endpoints,
        `${path}.movingFrames[${frameIndex}].sourceOwnership`,
      )
    })

    let entityTriangles: number
    if (entity.geometry.kind === 'asset') {
      const asset = requireReference(
        assets,
        entity.geometry.assetReferenceId,
        `${path}.geometry.assetReferenceId`,
        'ASSET_REFERENCE_NOT_FOUND',
        'Asset reference',
      )
      if (asset.byteLength === 0 || asset.byteLength > MAX_OBJECT_STEP_BYTES_V4) {
        invalid(`${path}.geometry.assetReferenceId`, 'Object STEP source exceeds its byte budget.', 'OBJECT_STEP_BYTE_LIMIT_EXCEEDED')
      }
      if (entity.geometry.statistics.triangles > MAX_OBJECT_STEP_TRIANGLES_V4) {
        invalid(`${path}.geometry.statistics.triangles`, 'Object STEP triangles exceed the configured budget.', 'OBJECT_STEP_TRIANGLE_LIMIT_EXCEEDED')
      }
      referencedAssetIds.add(asset.id)
      objectIdentities.add([
        asset.sha256,
        sourceConventionIdentity(entity.geometry.sourceConvention),
        entity.geometry.originMode,
      ].join('|'))
      entityTriangles = entity.geometry.statistics.triangles
    } else if (entity.geometry.kind === 'box') {
      entityTriangles = BOX_PRIMITIVE_TRIANGLES_V4
    } else {
      entityTriangles = CYLINDER_PRIMITIVE_TRIANGLES_V4
    }
    const groupVisible = entity.groupId === null || effectiveGroupVisibility.get(entity.groupId) === true
    if (entity.visible && groupVisible) visibleTriangles += entityTriangles
  })
  enforceMaximum(
    objectIdentities.size,
    MAX_IMPORTED_OBJECT_STEP_ASSETS_V4,
    '$.spatialEntities',
    'IMPORTED_OBJECT_STEP_ASSET_LIMIT_EXCEEDED',
  )

  return { visibleTriangles, robots, entities }
}

function validateActionReferences(
  project: WorkcellProjectV4,
  robots: ReadonlyMap<string, RobotInstanceV4>,
  entities: ReadonlyMap<string, SpatialEntityV4>,
  definitions: ReadonlyMap<string, DefinitionFacts>,
  globalFrames: GlobalFrameFacts,
): Map<string, RobotActionDefinitionV4> {
  const actions = new Map(project.actions.map((action) => [action.id, action]))
  project.actions.forEach((action, index) => {
    const path = `$.actions[${index}]`
    if (action.kind === 'set-gripper-state') {
      requireReference(robots, action.robotId, `${path}.robotId`, 'ROBOT_INSTANCE_NOT_FOUND', 'Robot')
      return
    }
    const object = requireReference(
      entities,
      action.objectId,
      `${path}.objectId`,
      'SPATIAL_ENTITY_NOT_FOUND',
      'Spatial Entity',
    )
    if (action.kind === 'attach-object') {
      const robot = requireReference(robots, action.robotId, `${path}.robotId`, 'ROBOT_INSTANCE_NOT_FOUND', 'Robot')
      const definition = definitions.get(robot.definitionId)!
      if (!definition.frames.has(action.toolFrameId)) {
        invalid(`${path}.toolFrameId`, 'Attach Tool Frame does not belong to the named Robot.', 'ROBOT_FRAME_NOT_FOUND')
      }
      if (!object.graspable) invalid(`${path}.objectId`, 'Attach Object must be graspable.', 'OBJECT_NOT_GRASPABLE')
      if (
        action.objectGraspFrameId !== undefined
        && !object.graspFrames.some((frame) => frame.frameId === action.objectGraspFrameId)
      ) {
        invalid(`${path}.objectGraspFrameId`, 'Object Grasp Frame does not belong to the Object.', 'OBJECT_GRASP_FRAME_NOT_FOUND')
      }
    } else if (
      action.targetParentFrameId !== undefined
      && !globalFrames.frameIds.has(action.targetParentFrameId)
    ) {
      invalid(`${path}.targetParentFrameId`, 'Detach target parent Frame does not exist.', 'FRAME_PARENT_NOT_FOUND')
    }
  })
  return actions
}

function validateJobReferences(
  project: WorkcellProjectV4,
  robots: ReadonlyMap<string, RobotInstanceV4>,
  definitions: ReadonlyMap<string, DefinitionFacts>,
  actions: ReadonlyMap<string, RobotActionDefinitionV4>,
): Map<string, RobotJobV4> {
  const jobs = new Map(project.jobs.map((job) => [job.id, job]))
  const totalSteps = project.jobs.reduce((sum, job) => sum + job.steps.length, 0)
  enforceMaximum(totalSteps, MAX_TOTAL_JOB_STEPS_V4, '$.jobs', 'TOTAL_JOB_STEP_LIMIT_EXCEEDED')
  project.jobs.forEach((job, jobIndex) => {
    const path = `$.jobs[${jobIndex}]`
    const robot = requireReference(robots, job.robotId, `${path}.robotId`, 'ROBOT_INSTANCE_NOT_FOUND', 'Robot')
    const definition = definitions.get(robot.definitionId)!
    job.steps.forEach((step, stepIndex) => {
      const stepPath = `${path}.steps[${stepIndex}]`
      if (step.kind === 'joint-pose') {
        expectExactJointValues(step.jointValues, definition, `${stepPath}.jointValues`)
        return
      }
      const action = requireReference(
        actions,
        step.actionId,
        `${stepPath}.actionId`,
        'ACTION_NOT_FOUND',
        'Action',
      )
      if ('robotId' in action && action.robotId !== job.robotId) {
        invalid(`${stepPath}.actionId`, 'Job Action belongs to a different Robot.', 'ACTION_ROBOT_MISMATCH')
      }
    })
  })
  return jobs
}

function validateMappingTargetReferences(
  target: OpcUaProjectTargetV4,
  path: string,
  robots: ReadonlyMap<string, RobotInstanceV4>,
  entities: ReadonlyMap<string, SpatialEntityV4>,
  definitions: ReadonlyMap<string, DefinitionFacts>,
): void {
  if (
    target.type === 'robot-joint'
    || target.type === 'robot-frame'
    || target.type === 'robot-status'
  ) {
    const robot = requireReference(robots, target.robotId, `${path}.robotId`, 'ROBOT_INSTANCE_NOT_FOUND', 'Robot')
    const definition = definitions.get(robot.definitionId)!
    if (target.type === 'robot-joint' && !definition.joints.has(target.jointId)) {
      invalid(`${path}.jointId`, 'Mapped Joint does not belong to the Robot.', 'ROBOT_JOINT_NOT_FOUND')
    }
    if (target.type === 'robot-frame' && !definition.frames.has(target.frameId)) {
      invalid(`${path}.frameId`, 'Mapped Frame does not belong to the Robot.', 'ROBOT_FRAME_NOT_FOUND')
    }
    return
  }
  const entity = requireReference(
    entities,
    target.entityId,
    `${path}.entityId`,
    'SPATIAL_ENTITY_NOT_FOUND',
    'Spatial Entity',
  )
  if (
    target.type === 'entity-frame'
    && !entity.movingFrames.some((frame) => frame.frameId === target.frameId)
    && !entity.graspFrames.some((frame) => frame.frameId === target.frameId)
  ) {
    invalid(`${path}.frameId`, 'Mapped Frame does not belong to the Entity.', 'FRAME_PARENT_NOT_FOUND')
  }
}

function mappingCarriesState(direction: OpcUaMappingV4['direction']): boolean {
  return direction === 'read' || direction === 'publish' || direction === 'readWrite'
}

function mappingCarriesCommand(direction: OpcUaMappingV4['direction']): boolean {
  return direction === 'write' || direction === 'action-trigger' || direction === 'readWrite'
}

function validateOpcUaReferences(
  project: WorkcellProjectV4,
  endpoints: ReadonlyMap<string, { readonly enabled: boolean; readonly publishingIntervalMs: number }>,
  robots: ReadonlyMap<string, RobotInstanceV4>,
  entities: ReadonlyMap<string, SpatialEntityV4>,
  definitions: ReadonlyMap<string, DefinitionFacts>,
  actions: ReadonlyMap<string, RobotActionDefinitionV4>,
  jobs: ReadonlyMap<string, RobotJobV4>,
): void {
  const rootsByEndpoint = new Map<string, number>()
  const leavesByEndpoint = new Map<string, number>()
  const nodeMappings = new Map<string, { mappingId: string; direction: OpcUaMappingV4['direction'] }>()
  let leafCount = 0
  let updatesPerSecond = 0

  project.opcUa.mappings.forEach((mapping, mappingIndex) => {
    const path = `$.opcUa.mappings[${mappingIndex}]`
    const endpoint = requireReference(
      endpoints,
      mapping.endpointId,
      `${path}.endpointId`,
      'OPCUA_ENDPOINT_NOT_FOUND',
      'OPC UA endpoint',
    )
    validateOwnershipReference(mapping.sourceOwnership, endpoints, `${path}.sourceOwnership`)
    const roots = (rootsByEndpoint.get(mapping.endpointId) ?? 0) + 1
    if (roots > MAX_OPCUA_STRUCTURE_ROOTS_PER_ENDPOINT_V4) {
      invalid(path, 'Endpoint Structure-root budget is exceeded.', 'OPCUA_ENDPOINT_STRUCTURE_ROOT_LIMIT_EXCEEDED')
    }
    rootsByEndpoint.set(mapping.endpointId, roots)

    const endpointLeaves = (leavesByEndpoint.get(mapping.endpointId) ?? 0) + mapping.leaves.length
    if (endpointLeaves > MAX_OPCUA_EXPANDED_LEAVES_PER_ENDPOINT_V4) {
      invalid(path, 'Endpoint expanded-Leaf budget is exceeded.', 'OPCUA_ENDPOINT_LEAF_LIMIT_EXCEEDED')
    }
    leavesByEndpoint.set(mapping.endpointId, endpointLeaves)
    leafCount += mapping.leaves.length
    if (leafCount > MAX_OPCUA_EXPANDED_LEAVES_V4) {
      invalid(path, 'Project expanded-Leaf budget is exceeded.', 'OPCUA_PROJECT_LEAF_LIMIT_EXCEEDED')
    }

    const interval = mapping.publishingIntervalMs
      ?? endpoint.publishingIntervalMs
      ?? DEFAULT_OPCUA_PUBLISHING_INTERVAL_MS_V4
    if (endpoint.enabled) updatesPerSecond += mapping.leaves.length * 1000 / interval

    mapping.leaves.forEach((leaf, leafIndex) => {
      const leafPath = `${path}.leaves[${leafIndex}]`
      validateMappingTargetReferences(leaf.projectTarget, `${leafPath}.projectTarget`, robots, entities, definitions)
      const nodeKey = `${mapping.endpointId}\u0000${leaf.nodeId}`
      const previous = nodeMappings.get(nodeKey)
      if (previous !== undefined && previous.mappingId !== mapping.id) {
        const previousState = mappingCarriesState(previous.direction)
        const previousCommand = mappingCarriesCommand(previous.direction)
        const currentState = mappingCarriesState(mapping.direction)
        const currentCommand = mappingCarriesCommand(mapping.direction)
        if ((previousState && currentCommand) || (previousCommand && currentState)) {
          invalid(`${leafPath}.nodeId`, 'One Node cannot alias both Project State and Command channels.', 'OPCUA_STATE_COMMAND_NODE_ALIAS')
        }
      } else if (previous === undefined) {
        nodeMappings.set(nodeKey, { mappingId: mapping.id, direction: mapping.direction })
      }
    })
  })
  if (updatesPerSecond > MAX_OPCUA_LEAF_UPDATES_PER_SECOND_V4) {
    invalid('$.opcUa.mappings', 'Enabled OPC UA update-rate budget is exceeded.', 'OPCUA_UPDATE_RATE_LIMIT_EXCEEDED')
  }

  const integerCommands = new Map<string, Set<number>>()
  project.opcUa.actionBindings.forEach((binding, index) => {
    const path = `$.opcUa.actionBindings[${index}]`
    requireReference(
      endpoints,
      binding.endpointId,
      `${path}.endpointId`,
      'OPCUA_ENDPOINT_NOT_FOUND',
      'OPC UA endpoint',
    )
    const mappingAtNode = nodeMappings.get(`${binding.endpointId}\u0000${binding.nodeId}`)
    if (mappingAtNode !== undefined && mappingCarriesState(mappingAtNode.direction)) {
      invalid(
        `${path}.nodeId`,
        'One Node cannot alias both Project State and an Action Command Binding.',
        'OPCUA_STATE_COMMAND_NODE_ALIAS',
      )
    }
    if (binding.kind === 'action-execute') {
      requireReference(actions, binding.actionId, `${path}.actionId`, 'ACTION_NOT_FOUND', 'Action')
    } else {
      requireReference(jobs, binding.actionId, `${path}.actionId`, 'JOB_NOT_FOUND', 'Job')
    }
    if (binding.triggerMode === 'integer-command-value') {
      const key = `${binding.endpointId}\u0000${binding.nodeId}`
      const values = integerCommands.get(key) ?? new Set<number>()
      if (values.has(binding.integerCommandValue)) {
        invalid(`${path}.integerCommandValue`, 'Integer command value is duplicated for this endpoint Node.', 'OPCUA_INTEGER_COMMAND_DUPLICATE')
      }
      values.add(binding.integerCommandValue)
      integerCommands.set(key, values)
    }
  })

  const mappingIds = new Set(project.opcUa.mappings.map((mapping) => mapping.id))
  const bindingIds = new Set(project.opcUa.actionBindings.map((binding) => binding.id))
  const resolveChannel = (channelId: string, path: string): void => {
    const matches = Number(mappingIds.has(channelId)) + Number(bindingIds.has(channelId))
    if (matches === 0) invalid(path, `Bridge channel ${channelId} does not exist.`, 'BRIDGE_CHANNEL_NOT_FOUND')
    if (matches > 1) invalid(path, `Bridge channel ${channelId} is ambiguous.`, 'BRIDGE_CHANNEL_AMBIGUOUS')
  }
  const bridgeDestinations = new Map<string, string[]>()
  const bridgeInDegree = new Map<string, number>()
  project.opcUa.bridgeRoutes.forEach((route, index) => {
    const path = `$.opcUa.bridgeRoutes[${index}]`
    resolveChannel(route.sourceChannelId, `${path}.sourceChannelId`)
    resolveChannel(route.destinationChannelId, `${path}.destinationChannelId`)
    if (route.sourceChannelId === route.destinationChannelId) {
      invalid(path, 'Bridge route cannot echo a channel to itself.', 'BRIDGE_ROUTE_ECHO')
    }
    const destinations = bridgeDestinations.get(route.sourceChannelId) ?? []
    destinations.push(route.destinationChannelId)
    bridgeDestinations.set(route.sourceChannelId, destinations)
    if (!bridgeInDegree.has(route.sourceChannelId)) bridgeInDegree.set(route.sourceChannelId, 0)
    bridgeInDegree.set(
      route.destinationChannelId,
      (bridgeInDegree.get(route.destinationChannelId) ?? 0) + 1,
    )
  })
  const readyChannels = [...bridgeInDegree]
    .filter(([, inDegree]) => inDegree === 0)
    .map(([channelId]) => channelId)
  let visitedChannels = 0
  while (readyChannels.length !== 0) {
    const channelId = readyChannels.pop()!
    visitedChannels += 1
    for (const destinationId of bridgeDestinations.get(channelId) ?? []) {
      const remainingInDegree = bridgeInDegree.get(destinationId)! - 1
      bridgeInDegree.set(destinationId, remainingInDegree)
      if (remainingInDegree === 0) readyChannels.push(destinationId)
    }
  }
  if (visitedChannels !== bridgeInDegree.size) {
    invalid(
      '$.opcUa.bridgeRoutes',
      'Declared Bridge routes must form an acyclic directed graph.',
      'BRIDGE_ROUTE_CYCLE',
    )
  }
}

function validateReferencesAndBudgets(project: WorkcellProjectV4): void {
  const assets = new Map(project.assetReferences.map((asset) => [asset.id, asset]))
  const endpoints = new Map(project.opcUa.endpoints.map((endpoint) => [endpoint.endpointId, endpoint]))
  const globalFrames = validateGlobalFrames(project)
  const effectiveGroupVisibility = validateGroupGraph(project.sceneGroups)
  const referencedAssetIds = new Set<string>()
  const definitions = new Map<string, DefinitionFacts>()
  project.robotDefinitions.forEach((definition, index) => {
    definitions.set(
      definition.id,
      validateDefinitionSemantics(definition, index, assets, referencedAssetIds),
    )
  })

  const { visibleTriangles, robots, entities } = validateRobotAndEntityReferences(
    project,
    definitions,
    assets,
    endpoints,
    globalFrames,
    referencedAssetIds,
    effectiveGroupVisibility,
  )
  if (visibleTriangles > MAX_VISIBLE_SCENE_TRIANGLES_V4) {
    invalid('$.scene', 'Visible Scene triangle budget is exceeded.', 'VISIBLE_SCENE_TRIANGLE_LIMIT_EXCEEDED')
  }

  const referencedBytes = [...referencedAssetIds].reduce(
    (sum, assetId) => sum + requireReference(
      assets,
      assetId,
      '$.assetReferences',
      'ASSET_REFERENCE_NOT_FOUND',
      'Asset reference',
    ).byteLength,
    0,
  )
  if (referencedBytes > MAX_REFERENCED_STEP_BYTES_V4) {
    invalid('$.assetReferences', 'Referenced STEP byte budget is exceeded.', 'PROJECT_STEP_BYTE_LIMIT_EXCEEDED')
  }

  const actions = validateActionReferences(project, robots, entities, definitions, globalFrames)
  const jobs = validateJobReferences(project, robots, definitions, actions)
  validateOpcUaReferences(project, endpoints, robots, entities, definitions, actions, jobs)
}

function deepFreeze<T>(value: T, visited: WeakSet<object> = new WeakSet<object>()): T {
  if (value === null || typeof value !== 'object' || visited.has(value)) return value
  visited.add(value)
  for (const child of Object.values(value)) deepFreeze(child, visited)
  return Object.freeze(value)
}

export function validateWorkcellProjectV4(value: unknown): WorkcellProjectV4 {
  preflightWorkcellProjectShapeV4(value)
  const cloned = clonePlainValue(value, '$', new WeakSet<object>())
  preflightWorkcellProjectShapeV4(cloned)
  const root = expectClosedRecord(cloned, '$', ROOT_KEYS)
  const context: ShapeContext = {
    globalIds: new Set<string>(),
    mappingIds: new Set<string>(),
    actionBindingIds: new Set<string>(),
    bridgeRouteIds: new Set<string>(),
  }
  const project = validateClosedShape(root, context)
  validateReferencesAndBudgets(project)
  return deepFreeze(project)
}
