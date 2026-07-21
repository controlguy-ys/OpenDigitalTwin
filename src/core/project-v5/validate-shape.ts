import {
  CYLINDER_RADIAL_SEGMENTS_V5,
  MAX_IDENTIFIER_UTF8_BYTES_V5,
  MAX_LOGICAL_URI_UTF8_BYTES_V5,
  MAX_NAME_UTF8_BYTES_V5,
  MAX_OPC_UA_ENDPOINT_URL_UTF8_BYTES_V5,
  MAX_SOURCE_FILENAME_UTF8_BYTES_V5,
  PROJECT_V5_SCHEMA_VERSION,
} from './limits.js'
import { validateLogicalSignalValueV1 } from './logical-signal.js'
import { validateOpcUaNodeAddressV1 } from './opcua-node-address.js'
import { normalizeRigidTransformV5 } from './rigid-transform.js'
import {
  expectBoolean,
  expectClosedRecord,
  expectDenseArray,
  expectEnum,
  expectFiniteNumber,
  expectRecord,
  expectSafeInteger,
  expectString,
  invalidProjectV5,
  validateBoundedText,
} from './validation-support.js'
import type { WorkcellProjectV5 } from './types.js'

const ROOT_KEYS = [
  'schemaVersion',
  'projectId',
  'revisionId',
  'metadata',
  'assetReferences',
  'scene',
  'robotDefinitions',
  'controllers',
  'robots',
  'spatialEntities',
  'sceneGroups',
  'logicalSignals',
  'jobs',
  'opcUa',
] as const

const ID_FORBIDDEN_CHARACTER_PATTERN = /[\\/%?#]/u
const COLOR_PATTERN = /^#[0-9A-Fa-f]{6}$/u
const SHA256_PATTERN = /^[0-9a-f]{64}$/u
const OPCUA_OWNERSHIP_PATTERN = /^opcua:(.+)$/u

function validateId(value: unknown, path: string): string {
  const id = validateBoundedText(value, path, MAX_IDENTIFIER_UTF8_BYTES_V5)
  if (ID_FORBIDDEN_CHARACTER_PATTERN.test(id)) {
    invalidProjectV5(path, 'Identifier must not contain slash, backslash, percent, query, or fragment characters.')
  }
  return id
}

function validateName(value: unknown, path: string): string {
  return validateBoundedText(value, path, MAX_NAME_UTF8_BYTES_V5)
}

function validateUnit(value: unknown, path: string): string {
  return validateBoundedText(value, path, MAX_NAME_UTF8_BYTES_V5, true)
}

function validateVector3(value: unknown, path: string): [number, number, number] {
  const vector = expectDenseArray(value, path)
  if (vector.length !== 3) invalidProjectV5(path, 'Expected exactly three components.')
  return [
    expectFiniteNumber(vector[0], `${path}[0]`),
    expectFiniteNumber(vector[1], `${path}[1]`),
    expectFiniteNumber(vector[2], `${path}[2]`),
  ]
}

function validateQuaternion(value: unknown, path: string): [number, number, number, number] {
  const quaternion = expectDenseArray(value, path)
  if (quaternion.length !== 4) invalidProjectV5(path, 'Expected exactly four [x, y, z, w] components.')
  return [
    expectFiniteNumber(quaternion[0], `${path}[0]`),
    expectFiniteNumber(quaternion[1], `${path}[1]`),
    expectFiniteNumber(quaternion[2], `${path}[2]`),
    expectFiniteNumber(quaternion[3], `${path}[3]`),
  ]
}

function validateRigidTransform(value: unknown, path: string): void {
  const record = expectClosedRecord(value, path, ['positionM', 'quaternion'])
  const normalized = normalizeRigidTransformV5({
    positionM: validateVector3(record.positionM, `${path}.positionM`),
    quaternion: validateQuaternion(record.quaternion, `${path}.quaternion`),
  }, path)
  record.positionM = [...normalized.positionM]
  record.quaternion = [...normalized.quaternion]
}

function validateIsoTimestamp(value: unknown, path: string): string {
  const timestamp = expectString(value, path)
  const epochMs = Date.parse(timestamp)
  if (!Number.isFinite(epochMs) || new Date(epochMs).toISOString() !== timestamp) {
    invalidProjectV5(path, 'Expected a canonical ISO-8601 UTC timestamp ending in Z.')
  }
  return timestamp
}

function validateLogicalUri(value: unknown, path: string): string {
  const uri = validateBoundedText(value, path, MAX_LOGICAL_URI_UTF8_BYTES_V5)
  if (uri.includes('%') || uri.includes('?') || uri.includes('#') || uri.includes('\\')) {
    invalidProjectV5(path, 'Logical URI must not contain escapes, query, fragment, or backslash characters.')
  }
  if (uri.startsWith('asset://')) {
    const remainder = uri.slice('asset://'.length)
    const slashIndex = remainder.indexOf('/')
    if (slashIndex <= 0) invalidProjectV5(path, 'Asset URI must contain an alias and a non-empty path.')
    const alias = remainder.slice(0, slashIndex)
    const logicalPath = remainder.slice(slashIndex + 1)
    if (!/^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/u.test(alias)) {
      invalidProjectV5(path, 'Asset URI alias is not canonical.')
    }
    const segments = logicalPath.split('/')
    if (segments.some((segment) => segment === '' || segment === '.' || segment === '..')) {
      invalidProjectV5(path, 'Asset URI path contains an empty or traversal segment.')
    }
    return uri
  }
  if (!/^builtin:\/\/[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?\/[A-Za-z0-9][A-Za-z0-9._-]*@[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(uri)) {
    invalidProjectV5(path, 'Expected canonical asset://alias/path or builtin://vendor/asset@version syntax.')
  }
  return uri
}

function validateSourceFileName(value: unknown, path: string): string {
  const fileName = validateBoundedText(value, path, MAX_SOURCE_FILENAME_UTF8_BYTES_V5)
  if (fileName === '.' || fileName === '..' || fileName.includes('/') || fileName.includes('\\')) {
    invalidProjectV5(path, 'Source file name must be a basename without traversal or separators.')
  }
  return fileName
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
  return invalidProjectV5(path, 'Expected manual, simulation, attachment where allowed, or opcua:<endpointId>.')
}

function validateSourceConvention(value: unknown, path: string): void {
  const record = expectClosedRecord(value, path, ['linearUnit', 'sourceToMeters', 'orientation'])
  expectEnum(record.linearUnit, `${path}.linearUnit`, [
    'millimeter', 'centimeter', 'meter', 'inch', 'foot',
  ] as const)
  record.sourceToMeters = expectFiniteNumber(record.sourceToMeters, `${path}.sourceToMeters`)
  const orientation = expectRecord(record.orientation, `${path}.orientation`)
  const mode = expectEnum(orientation.mode, `${path}.orientation.mode`, ['up-axis', 'root-rotation'] as const)
  if (mode === 'up-axis') {
    const upAxis = expectClosedRecord(orientation, `${path}.orientation`, ['mode', 'upAxis'])
    expectEnum(upAxis.upAxis, `${path}.orientation.upAxis`, ['x', 'y', 'z'] as const)
    return
  }
  const rootRotation = expectClosedRecord(orientation, `${path}.orientation`, ['mode', 'quaternion'])
  rootRotation.quaternion = normalizeRigidTransformV5({
    positionM: [0, 0, 0],
    quaternion: validateQuaternion(rootRotation.quaternion, `${path}.orientation.quaternion`),
  }, `${path}.orientation.quaternion`).quaternion
}

function validateStatistics(value: unknown, path: string): void {
  const record = expectClosedRecord(value, path, ['vertices', 'triangles', 'meshes', 'materials'])
  for (const key of ['vertices', 'triangles', 'meshes', 'materials'] as const) {
    record[key] = expectSafeInteger(record[key], `${path}.${key}`)
  }
}

function validateCollisionBoxes(value: unknown, path: string): void {
  const boxes = expectDenseArray(value, path)
  boxes.forEach((box, index) => {
    const boxPath = `${path}[${index}]`
    const record = expectClosedRecord(box, boxPath, ['id', 'centerM', 'halfExtentsM', 'quaternion'])
    validateId(record.id, `${boxPath}.id`)
    record.centerM = validateVector3(record.centerM, `${boxPath}.centerM`)
    record.halfExtentsM = validateVector3(record.halfExtentsM, `${boxPath}.halfExtentsM`)
    record.quaternion = normalizeRigidTransformV5({
      positionM: [0, 0, 0],
      quaternion: validateQuaternion(record.quaternion, `${boxPath}.quaternion`),
    }, `${boxPath}.quaternion`).quaternion
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

function validateFrame(value: unknown, path: string): void {
  const record = expectClosedRecord(value, path, ['id', 'name', 'parentFrameId', 'localPose', 'role'])
  validateId(record.id, `${path}.id`)
  validateName(record.name, `${path}.name`)
  if (record.parentFrameId !== null) validateId(record.parentFrameId, `${path}.parentFrameId`)
  validateRigidTransform(record.localPose, `${path}.localPose`)
  expectEnum(record.role, `${path}.role`, [
    'world', 'mcp', 'base', 'flange', 'tool0', 'tool', 'tcp', 'gripper', 'grasp', 'placement', 'custom',
  ] as const)
}

function validateRobotIdentification(value: unknown, path: string): void {
  const record = expectClosedRecord(value, path, [
    'manufacturer', 'model', 'productCode', 'serialNumberTemplate', 'motionDeviceCategory',
  ])
  validateName(record.manufacturer, `${path}.manufacturer`)
  validateName(record.model, `${path}.model`)
  validateName(record.productCode, `${path}.productCode`)
  if (record.serialNumberTemplate !== null) validateName(record.serialNumberTemplate, `${path}.serialNumberTemplate`)
  expectEnum(record.motionDeviceCategory, `${path}.motionDeviceCategory`, [
    'ARTICULATED_ROBOT', 'SCARA_ROBOT', 'DELTA_ROBOT', 'OTHER',
  ] as const)
}

function validateRobotDefinition(value: unknown, path: string): void {
  const record = expectClosedRecord(value, path, [
    'id', 'name', 'identification', 'assetReferenceIds', 'sourceConventions', 'links', 'joints', 'frames',
    'excludedGeometryOccurrenceKeys',
  ])
  validateId(record.id, `${path}.id`)
  validateName(record.name, `${path}.name`)
  validateRobotIdentification(record.identification, `${path}.identification`)

  const assetReferenceIds = expectDenseArray(record.assetReferenceIds, `${path}.assetReferenceIds`)
  assetReferenceIds.forEach((assetId, index) => validateId(assetId, `${path}.assetReferenceIds[${index}]`))

  const sourceConventions = expectRecord(record.sourceConventions, `${path}.sourceConventions`)
  for (const key of Object.keys(sourceConventions)) {
    validateId(key, `${path}.sourceConventions.${key}`)
    validateSourceConvention(sourceConventions[key], `${path}.sourceConventions.${key}`)
  }

  const links = expectDenseArray(record.links, `${path}.links`)
  links.forEach((link, linkIndex) => {
    const linkPath = `${path}.links[${linkIndex}]`
    const linkRecord = expectClosedRecord(link, linkPath, ['id', 'name', 'geometryOccurrences'])
    validateId(linkRecord.id, `${linkPath}.id`)
    validateName(linkRecord.name, `${linkPath}.name`)
    const occurrences = expectDenseArray(linkRecord.geometryOccurrences, `${linkPath}.geometryOccurrences`)
    occurrences.forEach((occurrence, occurrenceIndex) => {
      const occurrencePath = `${linkPath}.geometryOccurrences[${occurrenceIndex}]`
      const occurrenceRecord = expectClosedRecord(occurrence, occurrencePath, [
        'occurrenceKey', 'assetReferenceId', 'linkLocalPose', 'statistics', 'collisionBoxes',
      ])
      validateId(occurrenceRecord.occurrenceKey, `${occurrencePath}.occurrenceKey`)
      validateId(occurrenceRecord.assetReferenceId, `${occurrencePath}.assetReferenceId`)
      validateRigidTransform(occurrenceRecord.linkLocalPose, `${occurrencePath}.linkLocalPose`)
      validateStatistics(occurrenceRecord.statistics, `${occurrencePath}.statistics`)
      validateCollisionBoxes(occurrenceRecord.collisionBoxes, `${occurrencePath}.collisionBoxes`)
    })
  })

  const joints = expectDenseArray(record.joints, `${path}.joints`)
  joints.forEach((joint, jointIndex) => {
    const jointPath = `${path}.joints[${jointIndex}]`
    const jointRecord = expectClosedRecord(joint, jointPath, [
      'id', 'type', 'parentLinkId', 'childLinkId', 'origin', 'axis', 'min', 'max', 'home', 'zeroOffset',
      'direction', 'maximumVelocity',
    ])
    validateId(jointRecord.id, `${jointPath}.id`)
    expectEnum(jointRecord.type, `${jointPath}.type`, ['revolute', 'prismatic'] as const)
    validateId(jointRecord.parentLinkId, `${jointPath}.parentLinkId`)
    validateId(jointRecord.childLinkId, `${jointPath}.childLinkId`)
    validateRigidTransform(jointRecord.origin, `${jointPath}.origin`)
    jointRecord.axis = validateVector3(jointRecord.axis, `${jointPath}.axis`)
    for (const key of ['min', 'max', 'home', 'zeroOffset', 'maximumVelocity'] as const) {
      jointRecord[key] = expectFiniteNumber(jointRecord[key], `${jointPath}.${key}`)
    }
    if (jointRecord.direction !== 1 && jointRecord.direction !== -1) {
      invalidProjectV5(`${jointPath}.direction`, 'Joint direction must be 1 or -1.')
    }
  })

  const frames = expectDenseArray(record.frames, `${path}.frames`)
  frames.forEach((frame, frameIndex) => validateFrame(frame, `${path}.frames[${frameIndex}]`))
  const excluded = expectDenseArray(record.excludedGeometryOccurrenceKeys, `${path}.excludedGeometryOccurrenceKeys`)
  excluded.forEach((key, index) => validateId(key, `${path}.excludedGeometryOccurrenceKeys[${index}]`))
}

function validateAssetReference(value: unknown, path: string): void {
  const record = expectClosedRecord(value, path, [
    'id', 'uri', 'sha256', 'byteLength', 'sourceFileName', 'mediaType',
  ])
  validateId(record.id, `${path}.id`)
  validateLogicalUri(record.uri, `${path}.uri`)
  if (typeof record.sha256 !== 'string' || !SHA256_PATTERN.test(record.sha256)) {
    invalidProjectV5(`${path}.sha256`, 'Expected exactly 64 lowercase hexadecimal characters.')
  }
  record.byteLength = expectSafeInteger(record.byteLength, `${path}.byteLength`)
  validateSourceFileName(record.sourceFileName, `${path}.sourceFileName`)
  if (record.mediaType !== 'model/step') invalidProjectV5(`${path}.mediaType`, 'Only model/step is valid.')
}

function validateScene(value: unknown, path: string): void {
  const record = expectClosedRecord(value, path, ['frames'])
  const frames = expectDenseArray(record.frames, `${path}.frames`)
  frames.forEach((frame, index) => validateFrame(frame, `${path}.frames[${index}]`))
}

function validateController(value: unknown, path: string): void {
  const record = expectClosedRecord(value, path, ['id', 'name', 'identification'])
  validateId(record.id, `${path}.id`)
  validateName(record.name, `${path}.name`)
  const identification = expectClosedRecord(record.identification, `${path}.identification`, [
    'manufacturer', 'model', 'productCode', 'serialNumber',
  ])
  validateName(identification.manufacturer, `${path}.identification.manufacturer`)
  validateName(identification.model, `${path}.identification.model`)
  validateName(identification.productCode, `${path}.identification.productCode`)
  validateName(identification.serialNumber, `${path}.identification.serialNumber`)
}

function validateRobot(value: unknown, path: string): void {
  const record = expectClosedRecord(value, path, [
    'id', 'name', 'definitionId', 'serialNumber', 'controllerId', 'visible', 'baseParentFrameId',
    'localBasePose', 'initialJointValues', 'jointSource', 'frameSources', 'selectedToolFrameId',
    'selectedTcpFrameId', 'numericStatus', 'intentionalMountEntityId',
  ])
  validateId(record.id, `${path}.id`)
  validateName(record.name, `${path}.name`)
  validateId(record.definitionId, `${path}.definitionId`)
  validateName(record.serialNumber, `${path}.serialNumber`)
  validateId(record.controllerId, `${path}.controllerId`)
  expectBoolean(record.visible, `${path}.visible`)
  validateId(record.baseParentFrameId, `${path}.baseParentFrameId`)
  validateRigidTransform(record.localBasePose, `${path}.localBasePose`)
  const initialJointValues = expectRecord(record.initialJointValues, `${path}.initialJointValues`)
  for (const key of Object.keys(initialJointValues)) {
    validateId(key, `${path}.initialJointValues.${key}`)
    initialJointValues[key] = expectFiniteNumber(initialJointValues[key], `${path}.initialJointValues.${key}`)
  }
  validateOwnership(record.jointSource, `${path}.jointSource`, false)
  const frameSources = expectRecord(record.frameSources, `${path}.frameSources`)
  for (const key of Object.keys(frameSources)) {
    validateId(key, `${path}.frameSources.${key}`)
    validateOwnership(frameSources[key], `${path}.frameSources.${key}`, false)
  }
  validateId(record.selectedToolFrameId, `${path}.selectedToolFrameId`)
  validateId(record.selectedTcpFrameId, `${path}.selectedTcpFrameId`)
  validateNumericStatus(record.numericStatus, `${path}.numericStatus`)
  if (record.intentionalMountEntityId !== null) validateId(record.intentionalMountEntityId, `${path}.intentionalMountEntityId`)
}

function validateSpatialGeometry(value: unknown, path: string): void {
  const discriminator = expectRecord(value, path)
  const kind = expectEnum(discriminator.kind, `${path}.kind`, ['asset', 'box', 'cylinder'] as const)
  if (kind === 'asset') {
    const record = expectClosedRecord(discriminator, path, [
      'kind', 'assetReferenceId', 'occurrenceKey', 'sourceConvention', 'originMode', 'statistics', 'collisionBoxes',
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
    record.dimensionsM = validateVector3(record.dimensionsM, `${path}.dimensionsM`)
    if (typeof record.color !== 'string' || !COLOR_PATTERN.test(record.color)) {
      invalidProjectV5(`${path}.color`, 'Expected canonical #RRGGBB color syntax.')
    }
    return
  }
  const record = expectClosedRecord(discriminator, path, [
    'kind', 'radiusM', 'heightM', 'axis', 'radialSegments', 'color',
  ])
  record.radiusM = expectFiniteNumber(record.radiusM, `${path}.radiusM`)
  record.heightM = expectFiniteNumber(record.heightM, `${path}.heightM`)
  if (record.axis !== 'z') invalidProjectV5(`${path}.axis`, 'Cylinder axis is fixed to z.')
  if (record.radialSegments !== CYLINDER_RADIAL_SEGMENTS_V5) {
    invalidProjectV5(`${path}.radialSegments`, `Cylinder requires ${CYLINDER_RADIAL_SEGMENTS_V5} radial segments.`)
  }
  if (typeof record.color !== 'string' || !COLOR_PATTERN.test(record.color)) {
    invalidProjectV5(`${path}.color`, 'Expected canonical #RRGGBB color syntax.')
  }
}

function validateSpatialEntity(value: unknown, path: string): void {
  const record = expectClosedRecord(value, path, [
    'id', 'name', 'geometry', 'parentFrameId', 'localPose', 'visible', 'groupId', 'removable',
    'transformOwner', 'numericStatus', 'graspable', 'graspFrames', 'movingFrames',
  ])
  validateId(record.id, `${path}.id`)
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
    validateId(frameRecord.frameId, `${framePath}.frameId`)
    validateName(frameRecord.name, `${framePath}.name`)
    validateRigidTransform(frameRecord.localPose, `${framePath}.localPose`)
  })

  const movingFrames = expectDenseArray(record.movingFrames, `${path}.movingFrames`)
  movingFrames.forEach((frame, index) => {
    const framePath = `${path}.movingFrames[${index}]`
    const frameRecord = expectClosedRecord(frame, framePath, [
      'frameId', 'name', 'parentFrameId', 'localPose', 'sourceOwnership',
    ])
    validateId(frameRecord.frameId, `${framePath}.frameId`)
    validateName(frameRecord.name, `${framePath}.name`)
    validateId(frameRecord.parentFrameId, `${framePath}.parentFrameId`)
    validateRigidTransform(frameRecord.localPose, `${framePath}.localPose`)
    validateOwnership(frameRecord.sourceOwnership, `${framePath}.sourceOwnership`, true)
  })
}

function validateSceneGroup(value: unknown, path: string): void {
  const record = expectClosedRecord(value, path, ['id', 'name', 'parentGroupId', 'visible'])
  validateId(record.id, `${path}.id`)
  validateName(record.name, `${path}.name`)
  if (record.parentGroupId !== null) validateId(record.parentGroupId, `${path}.parentGroupId`)
  expectBoolean(record.visible, `${path}.visible`)
}

function validateLogicalSignalScope(value: unknown, path: string): void {
  const discriminator = expectRecord(value, path)
  const type = expectEnum(discriminator.type, `${path}.type`, ['project', 'robot', 'entity'] as const)
  if (type === 'project') {
    expectClosedRecord(discriminator, path, ['type'])
    return
  }
  const record = expectClosedRecord(discriminator, path, ['type', 'id'])
  validateId(record.id, `${path}.id`)
}

function validateLogicalSignal(value: unknown, path: string): void {
  const record = expectClosedRecord(value, path, [
    'id', 'name', 'dataType', 'direction', 'initialValue', 'unit', 'scope',
  ])
  validateId(record.id, `${path}.id`)
  validateName(record.name, `${path}.name`)
  const dataType = expectEnum(record.dataType, `${path}.dataType`, [
    'Boolean', 'Int32', 'UInt32', 'Double', 'String',
  ] as const)
  expectEnum(record.direction, `${path}.direction`, ['input', 'output', 'bidirectional', 'internal'] as const)
  record.initialValue = validateLogicalSignalValueV1(dataType, record.initialValue, `${path}.initialValue`)
  validateUnit(record.unit, `${path}.unit`)
  validateLogicalSignalScope(record.scope, `${path}.scope`)
}

function validateJobInstruction(value: unknown, path: string): void {
  const discriminator = expectRecord(value, path)
  const kind = expectEnum(discriminator.kind, `${path}.kind`, [
    'move-joint', 'set-do', 'wait-di', 'delay', 'attach', 'detach',
  ] as const)
  if (kind === 'move-joint') {
    const record = expectClosedRecord(discriminator, path, ['id', 'kind', 'jointValues', 'speedPercentToNext'])
    validateId(record.id, `${path}.id`)
    const jointValues = expectRecord(record.jointValues, `${path}.jointValues`)
    for (const key of Object.keys(jointValues)) {
      validateId(key, `${path}.jointValues.${key}`)
      jointValues[key] = expectFiniteNumber(jointValues[key], `${path}.jointValues.${key}`)
    }
    record.speedPercentToNext = expectFiniteNumber(record.speedPercentToNext, `${path}.speedPercentToNext`)
    return
  }
  if (kind === 'set-do') {
    const record = expectClosedRecord(discriminator, path, ['id', 'kind', 'signalId', 'value'])
    validateId(record.id, `${path}.id`)
    validateId(record.signalId, `${path}.signalId`)
    expectBoolean(record.value, `${path}.value`)
    return
  }
  if (kind === 'wait-di') {
    const record = expectClosedRecord(discriminator, path, ['id', 'kind', 'signalId', 'expected', 'timeoutMs'])
    validateId(record.id, `${path}.id`)
    validateId(record.signalId, `${path}.signalId`)
    expectBoolean(record.expected, `${path}.expected`)
    record.timeoutMs = expectFiniteNumber(record.timeoutMs, `${path}.timeoutMs`)
    return
  }
  if (kind === 'delay') {
    const record = expectClosedRecord(discriminator, path, ['id', 'kind', 'durationMs'])
    validateId(record.id, `${path}.id`)
    record.durationMs = expectFiniteNumber(record.durationMs, `${path}.durationMs`)
    return
  }
  if (kind === 'attach') {
    const record = expectClosedRecord(discriminator, path, [
      'id', 'kind', 'objectId', 'toolFrameId', 'objectGraspFrameId', 'maximumDistanceM',
    ])
    validateId(record.id, `${path}.id`)
    validateId(record.objectId, `${path}.objectId`)
    validateId(record.toolFrameId, `${path}.toolFrameId`)
    if (record.objectGraspFrameId !== null) validateId(record.objectGraspFrameId, `${path}.objectGraspFrameId`)
    record.maximumDistanceM = expectFiniteNumber(record.maximumDistanceM, `${path}.maximumDistanceM`)
    return
  }
  const record = expectClosedRecord(discriminator, path, ['id', 'kind', 'objectId', 'targetParentFrameId'])
  validateId(record.id, `${path}.id`)
  validateId(record.objectId, `${path}.objectId`)
  if (record.targetParentFrameId !== null) validateId(record.targetParentFrameId, `${path}.targetParentFrameId`)
}

function validateJob(value: unknown, path: string): void {
  const record = expectClosedRecord(value, path, ['id', 'name', 'robotId', 'instructions'])
  validateId(record.id, `${path}.id`)
  validateName(record.name, `${path}.name`)
  validateId(record.robotId, `${path}.robotId`)
  const instructions = expectDenseArray(record.instructions, `${path}.instructions`)
  instructions.forEach((instruction, index) => validateJobInstruction(instruction, `${path}.instructions[${index}]`))
}

function validateEndpointUrl(value: unknown, path: string): string {
  const url = validateBoundedText(value, path, MAX_OPC_UA_ENDPOINT_URL_UTF8_BYTES_V5)
  if (!/^(?:opc\.tcp|https?):\/\/[^\s\\?#]+$/u.test(url)) {
    invalidProjectV5(path, 'Endpoint URL must use canonical opc.tcp, http, or https syntax.')
  }
  return url
}

function validatePath(value: unknown, path: string): void {
  const segments = expectDenseArray(value, path)
  segments.forEach((segment, index) => {
    const segmentPath = `${path}[${index}]`
    if (typeof segment === 'string') {
      validateBoundedText(segment, segmentPath, MAX_IDENTIFIER_UTF8_BYTES_V5)
      return
    }
    expectFiniteNumber(segment, segmentPath)
  })
}

function validateProjectTarget(value: unknown, path: string): void {
  const discriminator = expectRecord(value, path)
  const type = expectEnum(discriminator.type, `${path}.type`, [
    'logical-signal', 'robot-joint', 'robot-frame', 'robot-status', 'entity-frame', 'entity-status',
  ] as const)
  if (type === 'logical-signal') {
    const record = expectClosedRecord(discriminator, path, ['type', 'signalId'])
    validateId(record.signalId, `${path}.signalId`)
  } else if (type === 'robot-joint') {
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

function validateMapping(value: unknown, path: string): void {
  const record = expectClosedRecord(value, path, [
    'id', 'endpointId', 'nodeAddress', 'direction', 'coherenceGroupId', 'interpolationMode',
    'coordinateConvention', 'leaves',
  ], ['publishingIntervalMs'])
  validateId(record.id, `${path}.id`)
  validateId(record.endpointId, `${path}.endpointId`)
  record.nodeAddress = validateOpcUaNodeAddressV1(record.nodeAddress, `${path}.nodeAddress`)
  expectEnum(record.direction, `${path}.direction`, ['read', 'write', 'readWrite'] as const)
  if (Object.hasOwn(record, 'publishingIntervalMs')) {
    record.publishingIntervalMs = expectFiniteNumber(record.publishingIntervalMs, `${path}.publishingIntervalMs`)
  }
  if (record.coherenceGroupId !== null) validateId(record.coherenceGroupId, `${path}.coherenceGroupId`)
  expectEnum(record.interpolationMode, `${path}.interpolationMode`, [
    'none', 'linear', 'shortest-quaternion', 'revolute-wrapped',
  ] as const)
  if (record.coordinateConvention !== 'project-v5-z-up-metres-quaternion-xyzw') {
    invalidProjectV5(`${path}.coordinateConvention`, 'Coordinate convention must be the Project V5 canonical value.')
  }
  const leaves = expectDenseArray(record.leaves, `${path}.leaves`)
  leaves.forEach((leaf, index) => {
    const leafPath = `${path}.leaves[${index}]`
    const leafRecord = expectClosedRecord(leaf, leafPath, [
      'leafPath', 'projectPath', 'projectTarget', 'opcUaDataType', 'projectDataType', 'scale', 'offset', 'unit',
      'required',
    ])
    validatePath(leafRecord.leafPath, `${leafPath}.leafPath`)
    validatePath(leafRecord.projectPath, `${leafPath}.projectPath`)
    validateProjectTarget(leafRecord.projectTarget, `${leafPath}.projectTarget`)
    expectEnum(leafRecord.opcUaDataType, `${leafPath}.opcUaDataType`, [
      'Boolean', 'SByte', 'Byte', 'Int16', 'UInt16', 'Int32', 'UInt32', 'Float', 'Double', 'String',
    ] as const)
    expectEnum(leafRecord.projectDataType, `${leafPath}.projectDataType`, [
      'boolean', 'integer', 'number', 'string',
    ] as const)
    leafRecord.scale = expectFiniteNumber(leafRecord.scale, `${leafPath}.scale`)
    leafRecord.offset = expectFiniteNumber(leafRecord.offset, `${leafPath}.offset`)
    validateUnit(leafRecord.unit, `${leafPath}.unit`)
    expectBoolean(leafRecord.required, `${leafPath}.required`)
  })
}

function validateOpcUa(value: unknown, path: string): void {
  const record = expectClosedRecord(value, path, ['mode', 'endpoints', 'mappings', 'bridgeRoutes'])
  expectEnum(record.mode, `${path}.mode`, ['off', 'client', 'server', 'bridge'] as const)
  const endpoints = expectDenseArray(record.endpoints, `${path}.endpoints`)
  endpoints.forEach((endpoint, index) => {
    const endpointPath = `${path}.endpoints[${index}]`
    const endpointRecord = expectClosedRecord(endpoint, endpointPath, [
      'endpointId', 'name', 'endpointUrl', 'enabled', 'publishingIntervalMs', 'reconnectDelayMs',
    ])
    validateId(endpointRecord.endpointId, `${endpointPath}.endpointId`)
    validateName(endpointRecord.name, `${endpointPath}.name`)
    validateEndpointUrl(endpointRecord.endpointUrl, `${endpointPath}.endpointUrl`)
    expectBoolean(endpointRecord.enabled, `${endpointPath}.enabled`)
    endpointRecord.publishingIntervalMs = expectFiniteNumber(
      endpointRecord.publishingIntervalMs,
      `${endpointPath}.publishingIntervalMs`,
    )
    endpointRecord.reconnectDelayMs = expectFiniteNumber(
      endpointRecord.reconnectDelayMs,
      `${endpointPath}.reconnectDelayMs`,
    )
  })
  const mappings = expectDenseArray(record.mappings, `${path}.mappings`)
  mappings.forEach((mapping, index) => validateMapping(mapping, `${path}.mappings[${index}]`))
  const routes = expectDenseArray(record.bridgeRoutes, `${path}.bridgeRoutes`)
  routes.forEach((route, index) => {
    const routePath = `${path}.bridgeRoutes[${index}]`
    const routeRecord = expectClosedRecord(route, routePath, [
      'id', 'sourceMappingId', 'destinationMappingId', 'direction', 'scale', 'offset', 'unit',
    ])
    validateId(routeRecord.id, `${routePath}.id`)
    validateId(routeRecord.sourceMappingId, `${routePath}.sourceMappingId`)
    validateId(routeRecord.destinationMappingId, `${routePath}.destinationMappingId`)
    if (routeRecord.direction !== 'forward') invalidProjectV5(`${routePath}.direction`, 'Bridge route direction is fixed to forward.')
    routeRecord.scale = expectFiniteNumber(routeRecord.scale, `${routePath}.scale`)
    routeRecord.offset = expectFiniteNumber(routeRecord.offset, `${routePath}.offset`)
    validateUnit(routeRecord.unit, `${routePath}.unit`)
  })
}

export function preflightWorkcellProjectShapeV5(value: unknown): void {
  const root = expectRecord(value, '$')
  if (root.schemaVersion !== PROJECT_V5_SCHEMA_VERSION) {
    invalidProjectV5(
      '$.schemaVersion',
      `Only schema version ${PROJECT_V5_SCHEMA_VERSION} is accepted without migration.`,
      'PROJECT_SCHEMA_UNSUPPORTED',
    )
  }
}

export function validateWorkcellProjectShapeV5(value: unknown): WorkcellProjectV5 {
  const root = expectClosedRecord(value, '$', ROOT_KEYS)
  if (root.schemaVersion !== PROJECT_V5_SCHEMA_VERSION) {
    invalidProjectV5(
      '$.schemaVersion',
      `Only schema version ${PROJECT_V5_SCHEMA_VERSION} is accepted without migration.`,
      'PROJECT_SCHEMA_UNSUPPORTED',
    )
  }
  validateId(root.projectId, '$.projectId')
  validateId(root.revisionId, '$.revisionId')
  const metadata = expectClosedRecord(root.metadata, '$.metadata', ['name', 'createdAt', 'updatedAt'])
  validateName(metadata.name, '$.metadata.name')
  validateIsoTimestamp(metadata.createdAt, '$.metadata.createdAt')
  validateIsoTimestamp(metadata.updatedAt, '$.metadata.updatedAt')

  const assets = expectDenseArray(root.assetReferences, '$.assetReferences')
  assets.forEach((asset, index) => validateAssetReference(asset, `$.assetReferences[${index}]`))
  validateScene(root.scene, '$.scene')
  const definitions = expectDenseArray(root.robotDefinitions, '$.robotDefinitions')
  definitions.forEach((definition, index) => validateRobotDefinition(definition, `$.robotDefinitions[${index}]`))
  const controllers = expectDenseArray(root.controllers, '$.controllers')
  controllers.forEach((controller, index) => validateController(controller, `$.controllers[${index}]`))
  const robots = expectDenseArray(root.robots, '$.robots')
  robots.forEach((robot, index) => validateRobot(robot, `$.robots[${index}]`))
  const entities = expectDenseArray(root.spatialEntities, '$.spatialEntities')
  entities.forEach((entity, index) => validateSpatialEntity(entity, `$.spatialEntities[${index}]`))
  const groups = expectDenseArray(root.sceneGroups, '$.sceneGroups')
  groups.forEach((group, index) => validateSceneGroup(group, `$.sceneGroups[${index}]`))
  const signals = expectDenseArray(root.logicalSignals, '$.logicalSignals')
  signals.forEach((signal, index) => validateLogicalSignal(signal, `$.logicalSignals[${index}]`))
  const jobs = expectDenseArray(root.jobs, '$.jobs')
  jobs.forEach((job, index) => validateJob(job, `$.jobs[${index}]`))
  validateOpcUa(root.opcUa, '$.opcUa')

  return root as unknown as WorkcellProjectV5
}
