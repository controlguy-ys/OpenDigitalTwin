import type { EquipmentStatus } from '../equipment/equipment'
import type { RobotLinkId } from '../robot/crb15000'
import { validateCollisionPolicy } from '../collision/collision'
import {
  MAX_ASSET_MATERIALS,
  MAX_ASSET_MESHES,
  MAX_COLLISION_BOXES_PER_ENTITY,
  MAX_COLLISION_BOXES_PER_PROJECT,
  MAX_OBJECT_ASSET_BYTES,
  MAX_OBJECT_ASSET_TRIANGLES,
  MAX_PROJECT_SOURCE_BYTES,
  MAX_ROBOT_BYTES,
  MAX_ROBOT_LINK_BYTES,
  MAX_ROBOT_LINK_TRIANGLES,
  MAX_ROBOT_TRIANGLES,
  MAX_SCENE_TRIANGLES,
  WORKCELL_PROJECT_FORMAT,
  type GeometryStatistics,
  type WorkcellProjectManifestV2,
  type WorkcellProjectSnapshotV2,
} from './project'
import type {
  ExternalEntityId,
  ProjectBuiltInEquipmentRecordV3,
  ProjectExternalEntityTransformStateV3,
  TransformSource,
} from './external-entity-v3'
import type { ProjectOpcUaNumericStatusBindingV3 } from './opcua-numeric-status-binding-v3'
import type {
  FixedTwoCycleSmoothingPolicyV1,
  ProjectOpcUaEquipmentTransformBindingV3,
} from './opcua-transform-binding-v3'
import {
  MAX_OBJECT_ASSETS,
  MAX_OBJECT_INSTANCES,
  MAX_VISIBLE_RENDER_ITEMS,
  MAX_VISIBLE_STATUS_OVERLAYS,
  type BoxObjectAssetRecordV3,
  type CylinderObjectAssetRecordV3,
  type DeepReadonly,
  type ObjectAssetGeometryV3,
  type ObjectAssetRecordV3,
  type ObjectInstanceRecordV3,
  type StepObjectAssetRecordV3,
} from './object-asset-v3'
import type {
  FixedSixAxisRobotMechanicsV3,
  FixedSixAxisJointManifestV1,
  FixedSixAxisRobotManifestV1,
  ProjectRigidTransformV3,
  ProjectRobotJointV3,
  RobotAssemblyPartRefV3,
  RobotLinkGeometryRecordV3,
  RobotMechanicsProvenanceV3,
  RobotStepSourceAssetV3,
} from './robot-source-v3'
import {
  canonicalizeSimulationDurationsV3,
  deriveCanonicalPoseDurationMsV3,
  reconcileSimulationForMechanicsChange,
  validateSimulationPoseLimitsV3,
  ProjectJobPoseOutOfLimitsErrorV3,
  ProjectPoseDurationDerivedNonFiniteErrorV3,
  type ProjectPoseLimitViolationV3,
} from './simulation-duration-v3'
import {
  MAX_JOBS,
  MAX_POSES_PER_JOB,
  MAX_PROJECT_POSES,
  type ProjectPoseStepV3,
  type ProjectSimulationStateV3,
  type SimulationJobV1,
} from './simulation-job-v1'
import type {
  ProjectRevisionIdentityHasher,
  ProjectSourceDigest,
} from '../../lib/hash/sha256'

export const WORKCELL_PROJECT_SCHEMA_VERSION_V3 = 3
export const MAX_IDENTIFIER_UTF8_BYTES = 128
export const MAX_NAME_UTF8_BYTES = 128
export const MAX_SOURCE_FILENAME_UTF8_BYTES = 255
export const MAX_OPCUA_NODE_ID_UTF8_BYTES = 1_024
export const MIN_ROBOT_STEP_SOURCES = 1
export const MAX_ROBOT_STEP_SOURCES = 7
export const MAX_ROBOT_SOURCE_MESHES = 448
export const MAX_ROBOT_SOURCE_MATERIALS = 224
export const MAX_ROBOT_PART_REFERENCES = 448
export const MAX_ROBOT_ASSEMBLY_DEPTH = 64

export type WorkcellProjectManifestV3 = Readonly<
  Omit<WorkcellProjectManifestV2, 'schemaVersion'> & {
    readonly schemaVersion: typeof WORKCELL_PROJECT_SCHEMA_VERSION_V3
  }
>

export type WorkcellProjectSnapshotV3 = DeepReadonly<
  Omit<
    WorkcellProjectSnapshotV2,
    | 'manifest'
    | 'robot'
    | 'frames'
    | 'objectAssets'
    | 'objectInstances'
    | 'poses'
    | 'opcUa'
  > & {
    readonly manifest: WorkcellProjectManifestV3
    readonly robot: Readonly<
      Omit<WorkcellProjectSnapshotV2['robot'], 'links' | 'joints'> & {
        readonly sources: readonly RobotStepSourceAssetV3[]
        readonly links: readonly RobotLinkGeometryRecordV3[]
        readonly mechanics: FixedSixAxisRobotMechanicsV3
        readonly mechanicsProvenance: RobotMechanicsProvenanceV3
      }
    >
    readonly frames: Readonly<{
      readonly mcp: ProjectRigidTransformV3
      readonly tcp: ProjectRigidTransformV3
    }>
    readonly simulation: ProjectSimulationStateV3
    readonly objectAssets: readonly ObjectAssetRecordV3[]
    readonly objectInstances: readonly ObjectInstanceRecordV3[]
    readonly builtInEquipment: readonly ProjectBuiltInEquipmentRecordV3[]
    readonly externalEntities: readonly ProjectExternalEntityTransformStateV3[]
    readonly opcUa: Readonly<
      Omit<WorkcellProjectSnapshotV2['opcUa'], 'equipment'> & {
        readonly numericStatusBindings: readonly ProjectOpcUaNumericStatusBindingV3[]
        readonly equipmentTransforms: readonly ProjectOpcUaEquipmentTransformBindingV3[]
      }
    >
  }
>

export type ByteFreeRobotStepSourceAssetV3 = Omit<
  RobotStepSourceAssetV3,
  'sourceBytes'
>
export type ByteFreeStepObjectAssetRecordV3 = Omit<
  StepObjectAssetRecordV3,
  'sourceBytes'
> & {
  readonly sourceSha256: string
}
export type ByteFreeObjectAssetRecordV3 =
  | ByteFreeStepObjectAssetRecordV3
  | BoxObjectAssetRecordV3
  | CylinderObjectAssetRecordV3
export type ByteFreeWorkcellProjectProjectionV3 = DeepReadonly<
  Omit<WorkcellProjectSnapshotV3, 'robot' | 'objectAssets'> & {
    readonly robot: Omit<WorkcellProjectSnapshotV3['robot'], 'sources'> & {
      readonly sources: readonly ByteFreeRobotStepSourceAssetV3[]
    }
    readonly objectAssets: readonly ByteFreeObjectAssetRecordV3[]
  }
>

export interface ProjectSourceDescriptorV3 {
  readonly namespace: 'robot' | 'object'
  readonly ownerKey: `robot-source:${string}` | `object-asset:${string}`
  readonly sourceBytes: ArrayBuffer
  readonly declaredSha256?: string
}

export {
  MAX_JOBS,
  MAX_OBJECT_ASSETS,
  MAX_OBJECT_INSTANCES,
  MAX_POSES_PER_JOB,
  MAX_PROJECT_POSES,
  MAX_VISIBLE_RENDER_ITEMS,
  MAX_VISIBLE_STATUS_OVERLAYS,
  canonicalizeSimulationDurationsV3,
  deriveCanonicalPoseDurationMsV3,
  reconcileSimulationForMechanicsChange,
  validateSimulationPoseLimitsV3,
  ProjectJobPoseOutOfLimitsErrorV3,
  ProjectPoseDurationDerivedNonFiniteErrorV3,
}
export type {
  BoxObjectAssetRecordV3,
  CylinderObjectAssetRecordV3,
  DeepReadonly,
  ExternalEntityId,
  FixedSixAxisJointManifestV1,
  FixedSixAxisRobotManifestV1,
  FixedSixAxisRobotMechanicsV3,
  FixedTwoCycleSmoothingPolicyV1,
  ObjectAssetGeometryV3,
  ObjectAssetRecordV3,
  ObjectInstanceRecordV3,
  ProjectBuiltInEquipmentRecordV3,
  ProjectExternalEntityTransformStateV3,
  ProjectOpcUaEquipmentTransformBindingV3,
  ProjectOpcUaNumericStatusBindingV3,
  ProjectPoseStepV3,
  ProjectPoseLimitViolationV3,
  ProjectRigidTransformV3,
  ProjectRobotJointV3,
  ProjectSimulationStateV3,
  RobotAssemblyPartRefV3,
  RobotLinkGeometryRecordV3,
  RobotMechanicsProvenanceV3,
  RobotStepSourceAssetV3,
  SimulationJobV1,
  StepObjectAssetRecordV3,
  TransformSource,
}

const encoder = new TextEncoder()
const ARRAY_BUFFER_BYTE_LENGTH_GETTER = Object.getOwnPropertyDescriptor(
  ArrayBuffer.prototype,
  'byteLength',
)?.get
const HEX_SHA256 = /^[0-9a-f]{64}$/
const UPPERCASE_COLOR = /^#[0-9A-F]{6}$/
export const ROBOT_LINK_IDS_V3 = [
  'LINK00',
  'LINK01',
  'LINK02',
  'LINK03',
  'LINK04',
  'LINK05',
  'LINK06',
] as const satisfies readonly RobotLinkId[]
const ROBOT_LINK_IDS = ROBOT_LINK_IDS_V3
const JOINT_IDS = ['J1', 'J2', 'J3', 'J4', 'J5', 'J6'] as const
const STATUS_VALUES = new Set<EquipmentStatus>([
  'OFF',
  'RUNNING',
  'WARNING',
  'FAULT',
])

interface BuiltInCatalogEntryV3 {
  readonly kind: 'cup' | 'machine'
  readonly collisionHalfExtents: readonly [number, number, number]
  readonly collisionCenter?: readonly [number, number, number]
  readonly stackLightAnchor: readonly [number, number, number] | null
}

const BUILT_IN_CATALOG = new Map<string, BuiltInCatalogEntryV3>([
  ['cup-01', {
    kind: 'cup',
    collisionHalfExtents: [0.055, 0.055, 0.075],
    stackLightAnchor: null,
  }],
  ['cup-02', {
    kind: 'cup',
    collisionHalfExtents: [0.055, 0.055, 0.075],
    stackLightAnchor: null,
  }],
  ['machine-01', {
    kind: 'machine',
    collisionHalfExtents: [0.14, 0.12, 0.2],
    stackLightAnchor: [0, 0, 0.32],
  }],
])

function fail(message: string): never {
  throw new Error(`Invalid workcell project V3: ${message}`)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function closedRecord(
  value: unknown,
  label: string,
  allowedKeys: readonly string[],
  optionalKeys: readonly string[] = [],
): Record<string, unknown> {
  if (!isRecord(value)) fail(`${label} must be an object.`)
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) {
    fail(`${label} must be a plain object without inherited configuration state.`)
  }
  const allowed = new Set(allowedKeys)
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key === 'symbol') fail(`${label} contains an unknown symbol field.`)
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (descriptor === undefined || !descriptor.enumerable) {
      fail(`${label}.${key} must be an enumerable field.`)
    }
    if (!('value' in descriptor)) fail(`${label}.${key} must be a data field.`)
    if (!allowed.has(key)) fail(`${label} contains unknown field ${key}.`)
  }
  const optional = new Set(optionalKeys)
  for (const key of allowedKeys) {
    if (!optional.has(key) && !Object.hasOwn(value, key)) {
      fail(`${label}.${key} is required.`)
    }
  }
  return value
}

function arrayValue(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) fail(`${label} must be an array.`)
  if (Object.getPrototypeOf(value) !== Array.prototype) {
    fail(`${label} must be a plain array without inherited configuration state.`)
  }
  let indexCount = 0
  for (const key of Reflect.ownKeys(value)) {
    if (key === 'length') continue
    if (typeof key === 'symbol') fail(`${label} contains an unknown symbol field.`)
    const index = Number(key)
    if (
      !Number.isSafeInteger(index) ||
      index < 0 ||
      index >= value.length ||
      String(index) !== key
    ) {
      fail(`${label} contains unknown field ${key}.`)
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (descriptor === undefined || !descriptor.enumerable) {
      fail(`${label}[${key}] must be enumerable.`)
    }
    if (!('value' in descriptor)) fail(`${label}[${key}] must be a data field.`)
    indexCount += 1
  }
  if (indexCount !== value.length) fail(`${label} must not be sparse.`)
  return value
}

function boundedString(
  value: unknown,
  label: string,
  maxBytes = MAX_IDENTIFIER_UTF8_BYTES,
): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    fail(`${label} must be a non-empty string.`)
  }
  const byteLength = encoder.encode(value).byteLength
  if (byteLength > maxBytes) {
    fail(`${label} must not exceed ${maxBytes} UTF-8 bytes.`)
  }
  return value
}

function identifier(value: unknown, label: string): string {
  const result = boundedString(value, label)
  if (result.includes('|')) fail(`${label} must not contain |.`)
  return result
}

function finite(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    fail(`${label} must be finite.`)
  }
  return value
}

function positive(value: unknown, label: string): number {
  const result = finite(value, label)
  if (result <= 0) fail(`${label} must be positive.`)
  return result
}

function nonNegativeInteger(value: unknown, label: string): number {
  const result = finite(value, label)
  if (!Number.isInteger(result) || result < 0) {
    fail(`${label} must be a non-negative integer.`)
  }
  return result
}

function booleanValue(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') fail(`${label} must be boolean.`)
  return value
}

function numericTuple(
  value: unknown,
  length: number,
  label: string,
  requirePositive = false,
): number[] {
  const tuple = arrayValue(value, label)
  if (tuple.length !== length) {
    fail(`${label} must contain exactly ${length} numbers.`)
  }
  return tuple.map((entry, index) =>
    requirePositive
      ? positive(entry, `${label}[${index}]`)
      : finite(entry, `${label}[${index}]`),
  )
}

function sameNumbers(first: readonly number[], second: readonly number[]): boolean {
  return first.length === second.length &&
    first.every((value, index) => Object.is(value, second[index]))
}

function normalizedUnitVector(components: readonly number[], label: string): number[] {
  const scale = Math.max(...components.map((component) => Math.abs(component)))
  if (scale === 0) fail(`${label} norm must be greater than 1e-9.`)
  const scaled = components.map((component) => component / scale)
  const scaledNorm = Math.hypot(...scaled)
  if (
    !Number.isFinite(scaledNorm) ||
    scaledNorm <= 0 ||
    scale <= 1e-9 / scaledNorm
  ) {
    fail(`${label} norm must be greater than 1e-9.`)
  }
  const originalNorm = scale * scaledNorm
  if (
    Number.isFinite(originalNorm) &&
    Math.abs(originalNorm - 1) <= Number.EPSILON
  ) {
    return components.map((component) => Object.is(component, -0) ? 0 : component)
  }
  const result = scaled.map((component) => {
    const normalized = component / scaledNorm
    return Object.is(normalized, -0) ? 0 : normalized
  })
  const resultNorm = Math.hypot(...result)
  if (
    result.some((component) => !Number.isFinite(component)) ||
    !Number.isFinite(resultNorm) ||
    Math.abs(resultNorm - 1) > 1e-12
  ) {
    fail(`${label} must normalize to a finite unit vector.`)
  }
  return result
}

function normalizedQuaternion(value: unknown, label: string): number[] {
  return normalizedUnitVector(numericTuple(value, 4, label), label)
}

function tryArrayBufferByteLength(value: object): number | undefined {
  if (ARRAY_BUFFER_BYTE_LENGTH_GETTER === undefined) return undefined
  try {
    return ARRAY_BUFFER_BYTE_LENGTH_GETTER.call(value) as number
  } catch {
    return undefined
  }
}

function arrayBufferByteLength(value: unknown, label: string): number {
  if (typeof value !== 'object' || value === null) {
    fail(`${label} must be an ArrayBuffer.`)
  }
  const byteLength = tryArrayBufferByteLength(value)
  if (byteLength === undefined) fail(`${label} must be an ArrayBuffer.`)
  if (Reflect.ownKeys(value).length !== 0) {
    fail(`${label} contains unknown configuration fields.`)
  }
  return byteLength
}

function sha256(value: unknown, label: string): string {
  const result = boundedString(value, label)
  if (!HEX_SHA256.test(result)) {
    fail(`${label} must be a lowercase 64-character SHA-256 digest.`)
  }
  return result
}

function exactScale(value: unknown, label: string): void {
  const scale = numericTuple(value, 3, `${label}.scale`)
  if (!sameNumbers(scale, [1, 1, 1])) {
    fail(`${label} is rigid and requires exact unit scale [1, 1, 1].`)
  }
}

function validateTransform(
  value: unknown,
  label: string,
  normalize: boolean,
  rigid: boolean,
): void {
  const transform = closedRecord(
    value,
    label,
    ['position', 'quaternion', 'scale'],
  )
  numericTuple(transform.position, 3, `${label}.position`)
  const quaternion = normalizedQuaternion(
    transform.quaternion,
    `${label}.quaternion`,
  )
  if (rigid) exactScale(transform.scale, label)
  else numericTuple(transform.scale, 3, `${label}.scale`, true)
  if (normalize) transform.quaternion = quaternion
}

function validateStatistics(
  value: unknown,
  label: string,
  triangleBudget: number,
  meshBudget = MAX_ASSET_MESHES,
  materialBudget = MAX_ASSET_MATERIALS,
): GeometryStatistics {
  const record = closedRecord(
    value,
    `${label}.statistics`,
    ['vertices', 'triangles', 'meshes', 'materials'],
  )
  const statistics = {
    vertices: nonNegativeInteger(record.vertices, `${label}.statistics.vertices`),
    triangles: nonNegativeInteger(record.triangles, `${label}.statistics.triangles`),
    meshes: nonNegativeInteger(record.meshes, `${label}.statistics.meshes`),
    materials: nonNegativeInteger(record.materials, `${label}.statistics.materials`),
  }
  if (statistics.triangles > triangleBudget) {
    fail(`${label} exceeds its triangle budget.`)
  }
  if (statistics.meshes > meshBudget) fail(`${label} exceeds its ${meshBudget} mesh budget.`)
  if (statistics.materials > materialBudget) {
    fail(`${label} exceeds its ${materialBudget} material budget.`)
  }
  return statistics
}

function validateCollisionBoxes(
  value: unknown,
  label: string,
  normalize: boolean,
): number {
  const boxes = arrayValue(value, `${label}.collisionBoxes`)
  if (boxes.length === 0 || boxes.length > MAX_COLLISION_BOXES_PER_ENTITY) {
    fail(`${label}.collisionBoxes must contain 1 through ${MAX_COLLISION_BOXES_PER_ENTITY} Boxes.`)
  }
  const ids = new Set<string>()
  boxes.forEach((value, index) => {
    const box = closedRecord(
      value,
      `${label}.collisionBoxes[${index}]`,
      ['id', 'center', 'halfExtents', 'quaternion'],
    )
    const id = identifier(box.id, `${label}.collisionBoxes[${index}].id`)
    if (ids.has(id)) fail(`${label}.collisionBoxes contains duplicate id ${id}.`)
    ids.add(id)
    numericTuple(box.center, 3, `${label}.collisionBoxes[${index}].center`)
    numericTuple(
      box.halfExtents,
      3,
      `${label}.collisionBoxes[${index}].halfExtents`,
      true,
    )
    const quaternion = normalizedQuaternion(
      box.quaternion,
      `${label}.collisionBoxes[${index}].quaternion`,
    )
    if (normalize) box.quaternion = quaternion
  })
  return boxes.length
}

interface RobotValidationResultV3 {
  readonly sourceBytes: number
  readonly triangles: number
  readonly collisionBoxes: number
}

function validateRobotSource(
  value: unknown,
  index: number,
): { readonly id: string; readonly bytes: number; readonly statistics: GeometryStatistics } {
  const label = `robot.sources[${index}]`
  const source = closedRecord(value, label, [
    'id',
    'sha256',
    'sourceFileName',
    'sourceBytes',
    'detectedUnit',
    'selectedSourceUnit',
    'unitDecision',
    'sourceToMeters',
    'parserVersion',
    'statistics',
  ])
  const id = sha256(source.id, `${label}.id`)
  const digest = sha256(source.sha256, `${label}.sha256`)
  if (id !== digest) fail(`${label}.id must equal its sha256 digest.`)
  boundedString(
    source.sourceFileName,
    `${label}.sourceFileName`,
    MAX_SOURCE_FILENAME_UTF8_BYTES,
  )
  if (!/\.(?:step|stp)$/i.test(source.sourceFileName as string)) {
    fail(`${label}.sourceFileName must end in .step or .stp.`)
  }
  const bytes = arrayBufferByteLength(source.sourceBytes, `${label}.sourceBytes`)
  if (bytes === 0) fail(`${label}.sourceBytes must not be empty.`)
  if (bytes > MAX_ROBOT_LINK_BYTES) fail(`${label} exceeds the Robot STEP byte budget.`)
  const detectedUnits = ['meter', 'millimeter', 'inch', 'unknown']
  const selectedUnits = ['meter', 'millimeter', 'inch']
  const decisions = ['detected', 'operator-confirmed', 'legacy-detected']
  if (!detectedUnits.includes(source.detectedUnit as string)) {
    fail(`${label}.detectedUnit is unsupported.`)
  }
  if (!selectedUnits.includes(source.selectedSourceUnit as string)) {
    fail(`${label}.selectedSourceUnit is unsupported.`)
  }
  if (!decisions.includes(source.unitDecision as string)) {
    fail(`${label}.unitDecision is unsupported.`)
  }
  const unitScale = {
    meter: 1,
    millimeter: 0.001,
    inch: 0.0254,
  }[source.selectedSourceUnit as 'meter' | 'millimeter' | 'inch']
  if (finite(source.sourceToMeters, `${label}.sourceToMeters`) !== unitScale) {
    fail(`${label}.sourceToMeters does not match selectedSourceUnit.`)
  }
  if (
    source.unitDecision !== 'operator-confirmed' &&
    source.detectedUnit !== source.selectedSourceUnit
  ) {
    fail(`${label}.unitDecision requires matching detected and selected units.`)
  }
  boundedString(source.parserVersion, `${label}.parserVersion`)
  return {
    id,
    bytes,
    statistics: validateStatistics(
      source.statistics,
      label,
      MAX_ROBOT_TRIANGLES,
      MAX_ROBOT_SOURCE_MESHES,
      MAX_ROBOT_SOURCE_MATERIALS,
    ),
  }
}

function validateRobotPartRef(
  value: unknown,
  label: string,
  linkId: RobotLinkId,
  coordinateMode: unknown,
  sourceIds: ReadonlySet<string>,
  sourceStatistics: ReadonlyMap<string, GeometryStatistics>,
): {
  readonly sourceAssetId: string
  readonly occurrenceKeys: readonly string[]
} {
  const reference = closedRecord(
    value,
    label,
    ['sourceAssetId', 'nodePath', 'nodeName', 'meshIndices'],
  )
  const sourceAssetId = sha256(reference.sourceAssetId, `${label}.sourceAssetId`)
  if (!sourceIds.has(sourceAssetId)) {
    fail(`${label} references missing Robot source ${sourceAssetId}.`)
  }
  const nodePath = arrayValue(reference.nodePath, `${label}.nodePath`).map(
    (entry, index) => finite(entry, `${label}.nodePath[${index}]`),
  )
  if (nodePath.length > MAX_ROBOT_ASSEMBLY_DEPTH) {
    fail(`${label}.nodePath exceeds the ${MAX_ROBOT_ASSEMBLY_DEPTH} assembly-depth budget.`)
  }
  const nodeName = boundedString(reference.nodeName, `${label}.nodeName`)
  const meshIndices = arrayValue(reference.meshIndices, `${label}.meshIndices`)
    .map((entry, index) =>
      nonNegativeInteger(entry, `${label}.meshIndices[${index}]`),
    )
  if (meshIndices.length === 0) fail(`${label}.meshIndices must not be empty.`)
  if (new Set(meshIndices).size !== meshIndices.length) {
    fail(`${label}.meshIndices must be unique.`)
  }
  const sourceMeshCount = sourceStatistics.get(sourceAssetId)!.meshes
  if (meshIndices.some((meshIndex) => meshIndex >= sourceMeshCount)) {
    fail(`${label}.meshIndices must resolve within the declared source mesh count.`)
  }

  const linkOrdinal = ROBOT_LINK_IDS.indexOf(linkId)
  const reserved = nodePath[0] === -1
  if (reserved) {
    const completeMeshSet = Array.from(
      { length: sourceStatistics.get(sourceAssetId)!.meshes },
      (_, index) => index,
    )
    if (
      nodePath.length !== 2 ||
      nodePath[1] !== linkOrdinal ||
      nodeName !== `legacy-whole-source:${linkId}` ||
      coordinateMode !== 'link-local' ||
      !sameNumbers(meshIndices, completeMeshSet)
    ) {
      fail(`${label}.nodePath is not the reserved legacy whole-source occurrence for ${linkId}.`)
    }
  } else if (
    nodePath.some((entry) => !Number.isInteger(entry) || entry < 0)
  ) {
    fail(`${label}.nodePath must contain non-negative child ordinals.`)
  }

  return {
    sourceAssetId,
    occurrenceKeys: meshIndices.map(
      (meshIndex) => `${sourceAssetId}|${nodePath.join(',')}|${meshIndex}`,
    ),
  }
}

function validateMechanicsProvenance(value: unknown): void {
  const base = closedRecord(
    value,
    'robot.mechanicsProvenance',
    [
      'kind',
      'configurationId',
      'configurationRevision',
      'sourceFileName',
      'sourceSha256',
      'canonicalSha256',
    ],
    [
      'configurationId',
      'configurationRevision',
      'sourceFileName',
      'sourceSha256',
      'canonicalSha256',
    ],
  )
  if (base.kind === 'datasheet') {
    const record = closedRecord(
      value,
      'robot.mechanicsProvenance',
      ['kind', 'configurationId', 'configurationRevision'],
    )
    boundedString(record.configurationId, 'robot.mechanicsProvenance.configurationId')
    boundedString(
      record.configurationRevision,
      'robot.mechanicsProvenance.configurationRevision',
    )
    return
  }
  if (base.kind === 'manifest') {
    const record = closedRecord(
      value,
      'robot.mechanicsProvenance',
      ['kind', 'sourceFileName', 'sourceSha256'],
    )
    boundedString(
      record.sourceFileName,
      'robot.mechanicsProvenance.sourceFileName',
      MAX_SOURCE_FILENAME_UTF8_BYTES,
    )
    sha256(record.sourceSha256, 'robot.mechanicsProvenance.sourceSha256')
    return
  }
  if (base.kind === 'manual') {
    const record = closedRecord(
      value,
      'robot.mechanicsProvenance',
      ['kind', 'canonicalSha256'],
    )
    sha256(record.canonicalSha256, 'robot.mechanicsProvenance.canonicalSha256')
    return
  }
  fail('robot.mechanicsProvenance.kind is unsupported.')
}

function validateMechanics(
  value: unknown,
  normalize: boolean,
): FixedSixAxisRobotMechanicsV3 {
  const mechanics = closedRecord(
    value,
    'robot.mechanics',
    ['joints', 'flange', 'tool0'],
  )
  const joints = arrayValue(mechanics.joints, 'robot.mechanics.joints')
  if (joints.length !== 6) {
    fail('ROBOT_JOINT_COUNT_UNSUPPORTED: robot.mechanics.joints must contain exactly 6 Joints.')
  }
  joints.forEach((value, index) => {
    const label = `robot.mechanics.joints[${index}]`
    const joint = closedRecord(value, label, [
      'id',
      'parentLink',
      'childLink',
      'originM',
      'axis',
      'minDeg',
      'maxDeg',
      'homeDeg',
      'zeroOffsetDeg',
      'direction',
      'maxVelocityDegPerSec',
    ])
    if (joint.id !== JOINT_IDS[index]) fail(`${label}.id must be ${JOINT_IDS[index]}.`)
    if (joint.parentLink !== ROBOT_LINK_IDS[index]) {
      fail(`${label}.parentLink must be ${ROBOT_LINK_IDS[index]}.`)
    }
    if (joint.childLink !== ROBOT_LINK_IDS[index + 1]) {
      fail(`${label}.childLink must be ${ROBOT_LINK_IDS[index + 1]}.`)
    }
    numericTuple(joint.originM, 3, `${label}.originM`)
    const axis = normalizedUnitVector(
      numericTuple(joint.axis, 3, `${label}.axis`),
      `${label}.axis`,
    )
    if (normalize) {
      joint.axis = axis
    }
    const minDeg = finite(joint.minDeg, `${label}.minDeg`)
    const maxDeg = finite(joint.maxDeg, `${label}.maxDeg`)
    if (minDeg >= maxDeg) fail(`${label} limits require minDeg < maxDeg.`)
    const homeDeg = finite(joint.homeDeg, `${label}.homeDeg`)
    if (homeDeg < minDeg || homeDeg > maxDeg) {
      fail(`${label}.homeDeg must be within the Joint limits.`)
    }
    finite(joint.zeroOffsetDeg, `${label}.zeroOffsetDeg`)
    if (joint.direction !== 1 && joint.direction !== -1) {
      fail(`${label}.direction must be 1 or -1.`)
    }
    positive(joint.maxVelocityDegPerSec, `${label}.maxVelocityDegPerSec`)
  })
  validateTransform(mechanics.flange, 'robot.mechanics.flange', normalize, true)
  validateTransform(mechanics.tool0, 'robot.mechanics.tool0', normalize, true)
  return mechanics as unknown as FixedSixAxisRobotMechanicsV3
}

export function normalizeFixedSixAxisRobotMechanicsV3(
  value: FixedSixAxisRobotMechanicsV3,
): FixedSixAxisRobotMechanicsV3 {
  const normalized = validateMechanics(structuredClone(value), true)
  deepFreezeConfiguration(normalized)
  return normalized
}

function canonicalMechanicsTransformV3(value: ProjectRigidTransformV3): Record<string, unknown> {
  return {
    position: [...value.position],
    quaternion: [...value.quaternion],
    scale: [...value.scale],
  }
}

export function canonicalMechanicsBytesV3(
  mechanics: FixedSixAxisRobotMechanicsV3,
): Uint8Array {
  const normalizedMechanics = normalizeFixedSixAxisRobotMechanicsV3(mechanics)
  return new TextEncoder().encode(JSON.stringify({
    joints: normalizedMechanics.joints.map((joint) => ({
      id: joint.id,
      parentLink: joint.parentLink,
      childLink: joint.childLink,
      originM: [...joint.originM],
      axis: [...joint.axis],
      minDeg: joint.minDeg,
      maxDeg: joint.maxDeg,
      homeDeg: joint.homeDeg,
      zeroOffsetDeg: joint.zeroOffsetDeg,
      direction: joint.direction,
      maxVelocityDegPerSec: joint.maxVelocityDegPerSec,
    })),
    flange: canonicalMechanicsTransformV3(normalizedMechanics.flange),
    tool0: canonicalMechanicsTransformV3(normalizedMechanics.tool0),
  }))
}

export async function verifyProjectCryptographicProvenanceV3(
  projection: Pick<ByteFreeWorkcellProjectProjectionV3, 'robot'>,
  revisionIdentityHasher: ProjectRevisionIdentityHasher,
  signal?: AbortSignal,
): Promise<void> {
  const provenance = projection.robot.mechanicsProvenance
  if (provenance.kind !== 'manual') return
  const digest = await revisionIdentityHasher.hashRevisionIdentity(
    canonicalMechanicsBytesV3(projection.robot.mechanics),
    signal,
  )
  if (digest !== provenance.canonicalSha256) {
    throw Object.assign(new Error(
      'PROJECT_MANUAL_MECHANICS_DIGEST_MISMATCH: Manual Robot Mechanics provenance does not match the normalized Mechanics block.',
    ), { code: 'PROJECT_MANUAL_MECHANICS_DIGEST_MISMATCH' })
  }
}

function validateRobot(
  value: unknown,
  normalize: boolean,
): RobotValidationResultV3 {
  const robot = closedRecord(value, 'robot', [
    'name',
    'basePosition',
    'baseRotationDeg',
    'sources',
    'links',
    'mechanics',
    'mechanicsProvenance',
  ])
  boundedString(robot.name, 'robot.name', MAX_NAME_UTF8_BYTES)
  numericTuple(robot.basePosition, 3, 'robot.basePosition')
  numericTuple(robot.baseRotationDeg, 3, 'robot.baseRotationDeg')

  const sources = arrayValue(robot.sources, 'robot.sources')
  if (
    sources.length < MIN_ROBOT_STEP_SOURCES ||
    sources.length > MAX_ROBOT_STEP_SOURCES
  ) {
    fail(`robot.sources must contain 1 through 7 unique Robot STEP sources.`)
  }
  const sourceIds = new Set<string>()
  const sourceStatistics = new Map<string, GeometryStatistics>()
  let sourceBytes = 0
  let sourceTriangles = 0
  let sourceMeshes = 0
  let sourceMaterials = 0
  let triangles = 0
  sources.forEach((source, index) => {
    const validated = validateRobotSource(source, index)
    if (sourceIds.has(validated.id)) fail(`robot.sources contains duplicate source id ${validated.id}.`)
    sourceIds.add(validated.id)
    sourceStatistics.set(validated.id, validated.statistics)
    sourceBytes += validated.bytes
    sourceTriangles += validated.statistics.triangles
    sourceMeshes += validated.statistics.meshes
    sourceMaterials += validated.statistics.materials
  })
  if (sourceBytes > MAX_ROBOT_BYTES) fail('Robot exceeds the total STEP byte budget.')
  if (sourceTriangles > MAX_ROBOT_TRIANGLES) {
    fail('Robot sources exceed the total triangle budget.')
  }
  if (sourceMeshes > MAX_ROBOT_SOURCE_MESHES) {
    fail(`Robot sources exceed the ${MAX_ROBOT_SOURCE_MESHES} mesh budget.`)
  }
  if (sourceMaterials > MAX_ROBOT_SOURCE_MATERIALS) {
    fail(`Robot sources exceed the ${MAX_ROBOT_SOURCE_MATERIALS} material budget.`)
  }

  const links = arrayValue(robot.links, 'robot.links')
  if (links.length !== ROBOT_LINK_IDS.length) {
    fail('robot.links must contain complete LINK00 through LINK06 ownership.')
  }
  const linkIds = new Set<string>()
  const referencedSources = new Set<string>()
  const occurrenceOwners = new Map<string, RobotLinkId>()
  let collisionBoxes = 0
  let partReferences = 0
  let selectedMeshBudgetViolationLabel: string | undefined
  links.forEach((value, index) => {
    const label = `robot.links[${index}]`
    const link = closedRecord(value, label, [
      'linkId',
      'sourceRefs',
      'coordinateMode',
      'zeroPoseLocalization',
      'operatorAdjustment',
      'visible',
      'collisionBoxes',
      'statistics',
    ])
    if (!ROBOT_LINK_IDS.includes(link.linkId as RobotLinkId)) {
      fail(`${label}.linkId is unsupported.`)
    }
    const linkId = link.linkId as RobotLinkId
    if (linkIds.has(linkId)) fail(`robot.links contains duplicate ${linkId}.`)
    linkIds.add(linkId)
    if (
      link.coordinateMode !== 'assembly-zero-pose' &&
      link.coordinateMode !== 'link-local'
    ) {
      fail(`${label}.coordinateMode is unsupported.`)
    }
    const references = arrayValue(link.sourceRefs, `${label}.sourceRefs`)
    if (references.length === 0) fail(`${label}.sourceRefs must not be empty.`)
    partReferences += references.length
    if (partReferences > MAX_ROBOT_PART_REFERENCES) {
      fail(`Robot exceeds the ${MAX_ROBOT_PART_REFERENCES} source-reference budget.`)
    }
    let selectedMeshOccurrences = 0
    references.forEach((reference, referenceIndex) => {
      const validatedReference = validateRobotPartRef(
        reference,
        `${label}.sourceRefs[${referenceIndex}]`,
        linkId,
        link.coordinateMode,
        sourceIds,
        sourceStatistics,
      )
      referencedSources.add(validatedReference.sourceAssetId)
      const occurrenceKeys = validatedReference.occurrenceKeys
      selectedMeshOccurrences += occurrenceKeys.length
      occurrenceKeys.forEach((key) => {
        const owner = occurrenceOwners.get(key)
        if (owner !== undefined) {
          fail(`Robot part ownership duplicates occurrence ${key} between ${owner} and ${linkId}.`)
        }
        occurrenceOwners.set(key, linkId)
      })
    })
    if (
      selectedMeshOccurrences > MAX_ASSET_MESHES &&
      selectedMeshBudgetViolationLabel === undefined
    ) {
      selectedMeshBudgetViolationLabel = label
    }
    validateTransform(
      link.zeroPoseLocalization,
      `${label}.zeroPoseLocalization`,
      normalize,
      false,
    )
    validateTransform(
      link.operatorAdjustment,
      `${label}.operatorAdjustment`,
      normalize,
      false,
    )
    booleanValue(link.visible, `${label}.visible`)
    collisionBoxes += validateCollisionBoxes(
      link.collisionBoxes,
      label,
      normalize,
    )
    triangles += validateStatistics(
      link.statistics,
      label,
      MAX_ROBOT_LINK_TRIANGLES,
    ).triangles
  })
  if (selectedMeshBudgetViolationLabel !== undefined) {
    fail(`${selectedMeshBudgetViolationLabel} exceeds its ${MAX_ASSET_MESHES} selected-mesh budget.`)
  }
  ROBOT_LINK_IDS.forEach((linkId) => {
    if (!linkIds.has(linkId)) fail(`robot.links is missing ${linkId}.`)
  })
  sourceIds.forEach((sourceId) => {
    if (!referencedSources.has(sourceId)) {
      fail(`Robot source ${sourceId} is unreferenced.`)
    }
  })
  if (triangles > MAX_ROBOT_TRIANGLES) fail('Robot exceeds the total triangle budget.')

  validateMechanics(robot.mechanics, normalize)
  validateMechanicsProvenance(robot.mechanicsProvenance)
  return { sourceBytes, triangles, collisionBoxes }
}

interface AssetValidationResultV3 {
  readonly assetIds: ReadonlySet<string>
  readonly assetTriangles: ReadonlyMap<string, number>
  readonly sourceBytes: number
  readonly collisionBoxes: number
}

function validateAssetGeometry(
  asset: Record<string, unknown>,
  label: string,
  normalize: boolean,
): GeometryStatistics {
  identifier(asset.id, `${label}.id`)
  boundedString(asset.name, `${label}.name`, MAX_NAME_UTF8_BYTES)
  numericTuple(asset.colliderCenter, 3, `${label}.colliderCenter`)
  numericTuple(
    asset.collisionHalfExtents,
    3,
    `${label}.collisionHalfExtents`,
    true,
  )
  validateCollisionBoxes(asset.collisionBoxes, label, normalize)
  return validateStatistics(asset.statistics, label, MAX_OBJECT_ASSET_TRIANGLES)
}

function requireExactPrimitiveGeometry(
  asset: Record<string, unknown>,
  label: string,
  halfExtents: readonly [number, number, number],
  statistics: GeometryStatistics,
): void {
  const center = numericTuple(asset.colliderCenter, 3, `${label}.colliderCenter`)
  const proxy = numericTuple(
    asset.collisionHalfExtents,
    3,
    `${label}.collisionHalfExtents`,
  )
  if (!sameNumbers(center, [0, 0, 0]) || !sameNumbers(proxy, halfExtents)) {
    fail(`${label} primitive proxy does not match its derived Geometry.`)
  }
  const boxes = arrayValue(asset.collisionBoxes, `${label}.collisionBoxes`)
  if (boxes.length !== 1) fail(`${label} primitive proxy requires exactly one collision Box.`)
  const box = closedRecord(
    boxes[0],
    `${label}.collisionBoxes[0]`,
    ['id', 'center', 'halfExtents', 'quaternion'],
  )
  if (
    box.id !== 'primitive-body' ||
    !sameNumbers(numericTuple(box.center, 3, `${label}.collisionBoxes[0].center`), [0, 0, 0]) ||
    !sameNumbers(
      numericTuple(box.halfExtents, 3, `${label}.collisionBoxes[0].halfExtents`),
      halfExtents,
    ) ||
    !sameNumbers(
      numericTuple(box.quaternion, 4, `${label}.collisionBoxes[0].quaternion`),
      [0, 0, 0, 1],
    )
  ) {
    fail(`${label} primitive collision proxy is inconsistent.`)
  }
  const actualStatistics = closedRecord(
    asset.statistics,
    `${label}.statistics`,
    ['vertices', 'triangles', 'meshes', 'materials'],
  )
  if (
    actualStatistics.vertices !== statistics.vertices ||
    actualStatistics.triangles !== statistics.triangles ||
    actualStatistics.meshes !== statistics.meshes ||
    actualStatistics.materials !== statistics.materials
  ) {
    fail(`${label} primitive statistics are inconsistent.`)
  }
}

function validateAssets(
  value: unknown,
  normalize: boolean,
): AssetValidationResultV3 {
  const assets = arrayValue(value, 'objectAssets')
  if (assets.length > MAX_OBJECT_ASSETS) {
    fail(`MAX_OBJECT_ASSETS is ${MAX_OBJECT_ASSETS}.`)
  }
  const assetIds = new Set<string>()
  const assetTriangles = new Map<string, number>()
  let sourceBytes = 0
  let collisionBoxes = 0
  assets.forEach((value, index) => {
    const label = `objectAssets[${index}]`
    const base = closedRecord(
      value,
      label,
      [
        'id',
        'name',
        'sourceKind',
        'sourceFileName',
        'sourceBytes',
        'importScale',
        'originMode',
        'dimensionsM',
        'radiusM',
        'heightM',
        'axis',
        'radialSegments',
        'color',
        'colliderCenter',
        'collisionHalfExtents',
        'collisionBoxes',
        'statistics',
      ],
      [
        'id',
        'name',
        'sourceFileName',
        'sourceBytes',
        'importScale',
        'originMode',
        'dimensionsM',
        'radiusM',
        'heightM',
        'axis',
        'radialSegments',
        'color',
        'colliderCenter',
        'collisionHalfExtents',
        'collisionBoxes',
        'statistics',
      ],
    )
    const sourceKind = base.sourceKind
    if (sourceKind === 'step') {
      const asset = closedRecord(value, label, [
        'id',
        'name',
        'sourceKind',
        'sourceFileName',
        'sourceBytes',
        'importScale',
        'originMode',
        'colliderCenter',
        'collisionHalfExtents',
        'collisionBoxes',
        'statistics',
      ])
      boundedString(
        asset.sourceFileName,
        `${label}.sourceFileName`,
        MAX_SOURCE_FILENAME_UTF8_BYTES,
      )
      if (!/\.(?:step|stp)$/i.test(asset.sourceFileName as string)) {
        fail(`${label}.sourceFileName must end in .step or .stp.`)
      }
      const bytes = arrayBufferByteLength(asset.sourceBytes, `${label}.sourceBytes`)
      if (bytes === 0) fail(`${label}.sourceBytes must not be empty.`)
      if (bytes > MAX_OBJECT_ASSET_BYTES) fail(`${label} exceeds the Object STEP byte budget.`)
      sourceBytes += bytes
      positive(asset.importScale, `${label}.importScale`)
      if (asset.originMode !== 'center' && asset.originMode !== 'source') {
        fail(`${label}.originMode is unsupported.`)
      }
    } else if (sourceKind === 'box') {
      const asset = closedRecord(value, label, [
        'id',
        'name',
        'sourceKind',
        'dimensionsM',
        'color',
        'colliderCenter',
        'collisionHalfExtents',
        'collisionBoxes',
        'statistics',
      ])
      const dimensions = numericTuple(asset.dimensionsM, 3, `${label}.dimensionsM`)
      dimensions.forEach((dimension) => {
        if (dimension < 0.001 || dimension > 10) {
          fail(`${label}.dimensionsM values must be within [0.001, 10].`)
        }
      })
      if (typeof asset.color !== 'string' || !UPPERCASE_COLOR.test(asset.color)) {
        fail(`${label}.color must use canonical uppercase #RRGGBB.`)
      }
      requireExactPrimitiveGeometry(
        asset,
        label,
        [dimensions[0]! / 2, dimensions[1]! / 2, dimensions[2]! / 2],
        { vertices: 24, triangles: 12, meshes: 1, materials: 1 },
      )
    } else if (sourceKind === 'cylinder') {
      const asset = closedRecord(value, label, [
        'id',
        'name',
        'sourceKind',
        'radiusM',
        'heightM',
        'axis',
        'radialSegments',
        'color',
        'colliderCenter',
        'collisionHalfExtents',
        'collisionBoxes',
        'statistics',
      ])
      const radius = finite(asset.radiusM, `${label}.radiusM`)
      const height = finite(asset.heightM, `${label}.heightM`)
      if (radius < 0.0005 || radius > 5) {
        fail(`${label}.radiusM must be within [0.0005, 5].`)
      }
      if (height < 0.001 || height > 10) {
        fail(`${label}.heightM must be within [0.001, 10].`)
      }
      if (asset.axis !== 'z') fail(`${label}.axis must be z.`)
      if (asset.radialSegments !== 32) fail(`${label}.radialSegments must be 32.`)
      if (typeof asset.color !== 'string' || !UPPERCASE_COLOR.test(asset.color)) {
        fail(`${label}.color must use canonical uppercase #RRGGBB.`)
      }
      requireExactPrimitiveGeometry(
        asset,
        label,
        [radius, radius, height / 2],
        { vertices: 196, triangles: 128, meshes: 1, materials: 1 },
      )
    } else {
      fail(`${label}.sourceKind is unsupported.`)
    }

    const asset = base
    const id = identifier(asset.id, `${label}.id`)
    if (assetIds.has(id)) fail(`objectAssets contains duplicate id ${id}.`)
    assetIds.add(id)
    const statistics = validateAssetGeometry(asset, label, normalize)
    assetTriangles.set(id, statistics.triangles)
    collisionBoxes += arrayValue(asset.collisionBoxes, `${label}.collisionBoxes`).length
  })
  return { assetIds, assetTriangles, sourceBytes, collisionBoxes }
}

interface EntityValidationResultV3 {
  readonly instanceIds: ReadonlySet<string>
  readonly canonicalIds: ReadonlySet<string>
  readonly statusSources: ReadonlyMap<string, 'manual' | 'opcua'>
  readonly transformSources: ReadonlyMap<string, 'manual' | 'opcua'>
  readonly visibleObjectTriangles: number
}

function validateInstances(
  value: unknown,
  assetIds: ReadonlySet<string>,
  assetTriangles: ReadonlyMap<string, number>,
): {
  readonly instanceIds: ReadonlySet<string>
  readonly statusSources: ReadonlyMap<string, 'manual' | 'opcua'>
  readonly visibleObjectTriangles: number
} {
  const instances = arrayValue(value, 'objectInstances')
  if (instances.length > MAX_OBJECT_INSTANCES) {
    fail(`MAX_OBJECT_INSTANCES is ${MAX_OBJECT_INSTANCES}.`)
  }
  const ids = new Set<string>()
  const statusSources = new Map<string, 'manual' | 'opcua'>()
  let visibleObjectTriangles = 0
  instances.forEach((value, index) => {
    const label = `objectInstances[${index}]`
    const instance = closedRecord(value, label, [
      'id',
      'assetId',
      'name',
      'manualNumericStatus',
      'statusSource',
      'statusOverlayVisible',
      'visible',
      'graspable',
    ])
    const id = identifier(instance.id, `${label}.id`)
    if (ids.has(id)) fail(`objectInstances contains duplicate id ${id}.`)
    ids.add(id)
    const assetId = identifier(instance.assetId, `${label}.assetId`)
    if (!assetIds.has(assetId)) {
      fail(`${label} references missing Object Asset ${assetId}.`)
    }
    boundedString(instance.name, `${label}.name`, MAX_NAME_UTF8_BYTES)
    finite(instance.manualNumericStatus, `${label}.manualNumericStatus`)
    if (instance.statusSource !== 'manual' && instance.statusSource !== 'opcua') {
      fail(`${label}.statusSource is unsupported.`)
    }
    statusSources.set(`object:${id}`, instance.statusSource)
    booleanValue(instance.statusOverlayVisible, `${label}.statusOverlayVisible`)
    if (booleanValue(instance.visible, `${label}.visible`)) {
      visibleObjectTriangles += assetTriangles.get(assetId) ?? 0
    }
    booleanValue(instance.graspable, `${label}.graspable`)
  })
  return { instanceIds: ids, statusSources, visibleObjectTriangles }
}

function exactOptionalTuple(
  actual: unknown,
  expected: readonly number[] | undefined,
  label: string,
): boolean {
  if (expected === undefined) return actual === undefined
  return sameNumbers(numericTuple(actual, expected.length, label), expected)
}

function validateBuiltIns(value: unknown): {
  readonly builtInIds: ReadonlySet<string>
  readonly statusSources: ReadonlyMap<string, 'manual' | 'opcua'>
} {
  const records = arrayValue(value, 'builtInEquipment')
  if (records.length > BUILT_IN_CATALOG.size) {
    fail('builtInEquipment exceeds the immutable catalog cardinality.')
  }
  const ids = new Set<string>()
  const statusSources = new Map<string, 'manual' | 'opcua'>()
  records.forEach((value, index) => {
    const label = `builtInEquipment[${index}]`
    const record = closedRecord(
      value,
      label,
      [
        'id',
        'name',
        'kind',
        'status',
        'manualNumericStatus',
        'statusSource',
        'statusOverlayVisible',
        'graspable',
        'collisionHalfExtents',
        'collisionCenter',
        'stackLightAnchor',
      ],
      ['collisionCenter'],
    )
    const id = identifier(record.id, `${label}.id`)
    if (ids.has(id)) fail(`builtInEquipment contains duplicate id ${id}.`)
    ids.add(id)
    const catalog = BUILT_IN_CATALOG.get(id)
    if (catalog === undefined) fail(`${label}.id is not in the built-in catalog.`)
    boundedString(record.name, `${label}.name`, MAX_NAME_UTF8_BYTES)
    if (record.kind !== 'cup' && record.kind !== 'machine') {
      fail(`${label}.kind is unsupported.`)
    }
    if (!STATUS_VALUES.has(record.status as EquipmentStatus)) {
      fail(`${label}.status is unsupported.`)
    }
    finite(record.manualNumericStatus, `${label}.manualNumericStatus`)
    if (record.statusSource !== 'manual' && record.statusSource !== 'opcua') {
      fail(`${label}.statusSource is unsupported.`)
    }
    statusSources.set(`equipment:${id}`, record.statusSource)
    booleanValue(record.statusOverlayVisible, `${label}.statusOverlayVisible`)
    booleanValue(record.graspable, `${label}.graspable`)
    const halfExtents = numericTuple(
      record.collisionHalfExtents,
      3,
      `${label}.collisionHalfExtents`,
      true,
    )
    if (record.collisionCenter !== undefined) {
      numericTuple(record.collisionCenter, 3, `${label}.collisionCenter`)
    } else if (Object.hasOwn(record, 'collisionCenter')) {
      fail(`${label}.collisionCenter must be omitted or contain three finite numbers.`)
    }
    if (record.stackLightAnchor !== null) {
      numericTuple(record.stackLightAnchor, 3, `${label}.stackLightAnchor`)
    }
    if (
      record.kind !== catalog.kind ||
      !sameNumbers(halfExtents, catalog.collisionHalfExtents) ||
      !exactOptionalTuple(record.collisionCenter, catalog.collisionCenter, `${label}.collisionCenter`) ||
      (catalog.stackLightAnchor === null
        ? record.stackLightAnchor !== null
        : record.stackLightAnchor === null ||
          !sameNumbers(
            numericTuple(record.stackLightAnchor, 3, `${label}.stackLightAnchor`),
            catalog.stackLightAnchor,
          ))
    ) {
      fail(`${label} Geometry does not match the immutable built-in catalog.`)
    }
  })
  return { builtInIds: ids, statusSources }
}

function externalEntityId(value: unknown, label: string): string {
  const id = boundedString(value, label, MAX_IDENTIFIER_UTF8_BYTES + 10)
  const match = /^(equipment|object):(.+)$/.exec(id)
  if (match === null) fail(`${label} must be a canonical equipment: or object: id.`)
  identifier(match[2], `${label} suffix`)
  return id
}

function validateExternalEntities(
  value: unknown,
  expectedIds: ReadonlySet<string>,
  normalize: boolean,
): ReadonlyMap<string, 'manual' | 'opcua'> {
  const states = arrayValue(value, 'externalEntities')
  const ids = new Set<string>()
  const sources = new Map<string, 'manual' | 'opcua'>()
  states.forEach((value, index) => {
    const label = `externalEntities[${index}]`
    const state = closedRecord(
      value,
      label,
      ['entityId', 'manualTransform', 'transformSource'],
    )
    const entityId = externalEntityId(state.entityId, `${label}.entityId`)
    if (ids.has(entityId)) fail(`externalEntities contains duplicate ${entityId}.`)
    ids.add(entityId)
    if (!expectedIds.has(entityId)) fail(`externalEntities contains orphan ${entityId}.`)
    validateTransform(
      state.manualTransform,
      `${label}.manualTransform`,
      normalize,
      false,
    )
    if (state.transformSource !== 'manual' && state.transformSource !== 'opcua') {
      fail(`${label}.transformSource is unsupported.`)
    }
    sources.set(entityId, state.transformSource)
  })
  expectedIds.forEach((entityId) => {
    if (!ids.has(entityId)) fail(`externalEntities is missing ${entityId}.`)
  })
  return sources
}

export function validateBuiltInEquipmentDefaultPairsV3(
  configurationDefaults: readonly ProjectBuiltInEquipmentRecordV3[],
  transformDefaults: readonly ProjectExternalEntityTransformStateV3[],
): Readonly<{
  readonly configurations: readonly ProjectBuiltInEquipmentRecordV3[]
  readonly transforms: readonly ProjectExternalEntityTransformStateV3[]
}> {
  const configurations = structuredClone(configurationDefaults)
  const transforms = structuredClone(transformDefaults)
  if (configurations.length !== transforms.length) {
    fail('Built-in Equipment defaults must contain one configuration/transform pair per id.')
  }
  const { builtInIds } = validateBuiltIns(configurations)
  const expectedIds = new Set<string>(
    Array.from(builtInIds, (id) => `equipment:${id}`),
  )
  transforms.forEach((transform, index) => {
    if (
      transform.transformSource !== 'manual' ||
      !transform.entityId.startsWith('equipment:')
    ) {
      fail(`Built-in Equipment transform default ${index} must be MCP-local Manual state.`)
    }
  })
  validateExternalEntities(transforms, expectedIds, true)
  deepFreezeConfiguration(configurations)
  deepFreezeConfiguration(transforms)
  return Object.freeze({ configurations, transforms })
}

function validateEntities(
  snapshot: Record<string, unknown>,
  assets: AssetValidationResultV3,
  normalize: boolean,
): EntityValidationResultV3 {
  const instances = validateInstances(
    snapshot.objectInstances,
    assets.assetIds,
    assets.assetTriangles,
  )
  const builtIns = validateBuiltIns(snapshot.builtInEquipment)
  const canonicalIds = new Set<string>([
    ...Array.from(instances.instanceIds, (id) => `object:${id}`),
    ...Array.from(builtIns.builtInIds, (id) => `equipment:${id}`),
  ])
  const transformSources = validateExternalEntities(
    snapshot.externalEntities,
    canonicalIds,
    normalize,
  )
  return {
    instanceIds: instances.instanceIds,
    canonicalIds,
    statusSources: new Map([
      ...instances.statusSources,
      ...builtIns.statusSources,
    ]),
    transformSources,
    visibleObjectTriangles: instances.visibleObjectTriangles,
  }
}

function validateSimulation(
  value: unknown,
  mechanics: FixedSixAxisRobotMechanicsV3,
): ProjectSimulationStateV3 {
  const simulation = closedRecord(
    value,
    'simulation',
    ['activeJobId', 'jobs'],
  )
  const jobs = arrayValue(simulation.jobs, 'simulation.jobs')
  if (jobs.length > MAX_JOBS) fail(`simulation.jobs cannot exceed ${MAX_JOBS}.`)
  const jobIds = new Set<string>()
  const poseIds = new Set<string>()
  let poseCount = 0
  jobs.forEach((value, jobIndex) => {
    const label = `simulation.jobs[${jobIndex}]`
    const job = closedRecord(value, label, ['id', 'name', 'revision', 'poses'])
    const id = identifier(job.id, `${label}.id`)
    if (jobIds.has(id)) fail(`simulation.jobs contains duplicate id ${id}.`)
    jobIds.add(id)
    boundedString(job.name, `${label}.name`, MAX_NAME_UTF8_BYTES)
    const revision = finite(job.revision, `${label}.revision`)
    if (!Number.isSafeInteger(revision) || revision <= 0) {
      fail(`${label}.revision must be a positive safe integer.`)
    }
    const poses = arrayValue(job.poses, `${label}.poses`)
    if (poses.length > MAX_POSES_PER_JOB) {
      fail(`${label}.poses cannot exceed ${MAX_POSES_PER_JOB}.`)
    }
    poseCount += poses.length
    poses.forEach((value, poseIndex) => {
      const poseLabel = `${label}.poses[${poseIndex}]`
      const pose = closedRecord(value, poseLabel, [
        'id',
        'name',
        'anglesDeg',
        'durationMs',
        'easing',
        'speedPercentToNext',
      ])
      const poseId = identifier(pose.id, `${poseLabel}.id`)
      if (poseIds.has(poseId)) {
        fail(`simulation contains duplicate Pose id ${poseId}.`)
      }
      poseIds.add(poseId)
      boundedString(pose.name, `${poseLabel}.name`, MAX_NAME_UTF8_BYTES)
      numericTuple(pose.anglesDeg, 6, `${poseLabel}.anglesDeg`)
      positive(pose.durationMs, `${poseLabel}.durationMs`)
      if (pose.easing !== 'linear' && pose.easing !== 'easeInOut') {
        fail(`${poseLabel}.easing is unsupported.`)
      }
      const speed = finite(
        pose.speedPercentToNext,
        `${poseLabel}.speedPercentToNext`,
      )
      if (speed < 1 || speed > 100) {
        fail(`${poseLabel}.speedPercentToNext must be within [1, 100].`)
      }
    })
  })
  if (poseCount > MAX_PROJECT_POSES) {
    fail(`simulation cannot exceed ${MAX_PROJECT_POSES} Project Poses.`)
  }
  if (simulation.activeJobId !== null) {
    const activeJobId = identifier(
      simulation.activeJobId,
      'simulation.activeJobId',
    )
    if (!jobIds.has(activeJobId)) {
      fail('simulation.activeJobId must reference an existing Job.')
    }
  }
  return canonicalizeSimulationDurationsV3(
    simulation as unknown as ProjectSimulationStateV3,
    mechanics,
  )
}

function validateJointBindings(value: unknown): void {
  const bindings = arrayValue(value, 'opcUa.joints')
  if (bindings.length !== 6) fail('opcUa.joints must contain exactly 6 bindings.')
  bindings.forEach((value, index) => {
    const label = `opcUa.joints[${index}]`
    const binding = closedRecord(value, label, ['id', 'nodeId', 'scale', 'offset'])
    if (binding.id !== JOINT_IDS[index]) fail(`${label}.id must be ${JOINT_IDS[index]}.`)
    boundedString(binding.nodeId, `${label}.nodeId`, MAX_OPCUA_NODE_ID_UTF8_BYTES)
    finite(binding.scale, `${label}.scale`)
    finite(binding.offset, `${label}.offset`)
  })
}

function validateOpcUa(
  value: unknown,
  entities: EntityValidationResultV3,
): void {
  const opcUa = closedRecord(value, 'opcUa', [
    'endpointUrl',
    'samplingIntervalMs',
    'joints',
    'numericStatusBindings',
    'equipmentTransforms',
  ])
  boundedString(opcUa.endpointUrl, 'opcUa.endpointUrl', MAX_OPCUA_NODE_ID_UTF8_BYTES)
  positive(opcUa.samplingIntervalMs, 'opcUa.samplingIntervalMs')
  validateJointBindings(opcUa.joints)

  const numericTargets = new Set<string>()
  arrayValue(opcUa.numericStatusBindings, 'opcUa.numericStatusBindings')
    .forEach((value, index) => {
      const label = `opcUa.numericStatusBindings[${index}]`
      const binding = closedRecord(
        value,
        label,
        ['entityId', 'nodeId', 'scale', 'offset'],
      )
      const entityId = externalEntityId(binding.entityId, `${label}.entityId`)
      if (!entities.canonicalIds.has(entityId)) {
        fail(`${label} references missing or orphan entity ${entityId}.`)
      }
      if (numericTargets.has(entityId)) {
        fail(`opcUa.numericStatusBindings contains duplicate target ${entityId}.`)
      }
      numericTargets.add(entityId)
      boundedString(binding.nodeId, `${label}.nodeId`, MAX_OPCUA_NODE_ID_UTF8_BYTES)
      finite(binding.scale, `${label}.scale`)
      finite(binding.offset, `${label}.offset`)
    })

  const transformTargets = new Set<string>()
  const profileAssignments = new Set<string>()
  arrayValue(opcUa.equipmentTransforms, 'opcUa.equipmentTransforms')
    .forEach((value, index) => {
      const label = `opcUa.equipmentTransforms[${index}]`
      const binding = closedRecord(value, label, [
        'entityId',
        'gatewayId',
        'gatewayProfileId',
        'gatewayProfileRevision',
        'mode',
        'referenceFrameId',
        'smoothing',
      ])
      const entityId = externalEntityId(binding.entityId, `${label}.entityId`)
      if (!entities.canonicalIds.has(entityId)) {
        fail(`${label} references missing or orphan entity ${entityId}.`)
      }
      if (transformTargets.has(entityId)) {
        fail(`opcUa.equipmentTransforms contains duplicate target ${entityId}.`)
      }
      transformTargets.add(entityId)
      const gatewayId = identifier(binding.gatewayId, `${label}.gatewayId`)
      const profileId = identifier(
        binding.gatewayProfileId,
        `${label}.gatewayProfileId`,
      )
      const revision = sha256(
        binding.gatewayProfileRevision,
        `${label}.gatewayProfileRevision`,
      )
      const profileKey = `${gatewayId}|${profileId}|${revision}`
      if (profileAssignments.has(profileKey)) {
        fail(`opcUa.equipmentTransforms contains duplicate Profile assignment ${profileKey}.`)
      }
      profileAssignments.add(profileKey)
      if (binding.mode !== 'absolute') fail(`${label}.mode must be absolute.`)
      if (binding.referenceFrameId !== 'world' && binding.referenceFrameId !== 'mcp') {
        fail(`${label}.referenceFrameId must be world or mcp.`)
      }
      const smoothing = closedRecord(
        binding.smoothing,
        `${label}.smoothing`,
        ['mode', 'cycles', 'milliseconds'],
        ['cycles', 'milliseconds'],
      )
      if (smoothing.mode !== 'two-cycle' || smoothing.cycles !== 2) {
        fail(`${label}.smoothing must use the fixed two-cycle policy.`)
      }
      closedRecord(
        binding.smoothing,
        `${label}.smoothing`,
        ['mode', 'cycles'],
      )
    })

  entities.statusSources.forEach((source, entityId) => {
    if (source === 'opcua' && !numericTargets.has(entityId)) {
      fail(`OPC UA numeric status source for ${entityId} requires one numeric binding.`)
    }
  })
  entities.transformSources.forEach((source, entityId) => {
    if (source === 'opcua' && !transformTargets.has(entityId)) {
      fail(`OPC UA transform source for ${entityId} requires one transform binding.`)
    }
  })
}

function validateCollisionPolicyV3(value: unknown, normalize: boolean): void {
  const policy = closedRecord(value, 'collisionPolicy', [
    'enabled',
    'warningDistanceM',
    'ignoredPairKeys',
    'enabledRobotSelfPairs',
  ])
  const enabled = booleanValue(policy.enabled, 'collisionPolicy.enabled')
  const warningDistanceM = finite(
    policy.warningDistanceM,
    'collisionPolicy.warningDistanceM',
  )
  if (warningDistanceM < 0) fail('collisionPolicy.warningDistanceM must be non-negative.')
  const ignoredPairKeys = arrayValue(
    policy.ignoredPairKeys,
    'collisionPolicy.ignoredPairKeys',
  ).map((entry, index) =>
    boundedString(entry, `collisionPolicy.ignoredPairKeys[${index}]`, 512),
  )
  const enabledRobotSelfPairs = arrayValue(
    policy.enabledRobotSelfPairs,
    'collisionPolicy.enabledRobotSelfPairs',
  ).map((entry, index) =>
    boundedString(entry, `collisionPolicy.enabledRobotSelfPairs[${index}]`, 512),
  )
  try {
    const validated = validateCollisionPolicy({
      enabled,
      warningDistanceM,
      ignoredPairKeys,
      enabledRobotSelfPairs,
    })
    if (normalize) {
      policy.ignoredPairKeys = [...validated.ignoredPairKeys]
      policy.enabledRobotSelfPairs = [...validated.enabledRobotSelfPairs]
    }
  } catch (error) {
    fail(error instanceof Error ? error.message : 'collisionPolicy is invalid.')
  }
}

function validateManifestV3(value: unknown): void {
  const manifest = closedRecord(value, 'manifest', [
    'format',
    'schemaVersion',
    'projectId',
    'name',
    'createdAt',
    'updatedAt',
  ])
  if (manifest.format !== WORKCELL_PROJECT_FORMAT) fail('manifest.format is unsupported.')
  if (manifest.schemaVersion !== WORKCELL_PROJECT_SCHEMA_VERSION_V3) {
    fail('manifest.schemaVersion must be 3.')
  }
  identifier(manifest.projectId, 'manifest.projectId')
  boundedString(manifest.name, 'manifest.name', MAX_NAME_UTF8_BYTES)
  for (const field of ['createdAt', 'updatedAt'] as const) {
    const timestamp = boundedString(manifest[field], `manifest.${field}`)
    if (!Number.isFinite(Date.parse(timestamp))) fail(`manifest.${field} is invalid.`)
  }
}

function deepFreezeConfiguration(value: unknown): void {
  if (
    typeof value !== 'object' ||
    value === null ||
    tryArrayBufferByteLength(value) !== undefined
  ) {
    return
  }
  for (const nested of Object.values(value)) deepFreezeConfiguration(nested)
  if (!Object.isFrozen(value)) Object.freeze(value)
}

function validateSnapshotCore(
  value: unknown,
  normalize: boolean,
  freeze: boolean,
): WorkcellProjectSnapshotV3 {
  const snapshot = closedRecord(value, 'project', [
    'manifest',
    'robot',
    'frames',
    'simulation',
    'objectAssets',
    'objectInstances',
    'builtInEquipment',
    'externalEntities',
    'opcUa',
    'collisionPolicy',
  ])
  validateManifestV3(snapshot.manifest)
  const robot = validateRobot(snapshot.robot, normalize)
  const robotRecord = snapshot.robot as Record<string, unknown>
  const mechanics = robotRecord.mechanics as FixedSixAxisRobotMechanicsV3

  const frames = closedRecord(snapshot.frames, 'frames', ['mcp', 'tcp'])
  validateTransform(frames.mcp, 'frames.mcp', normalize, true)
  validateTransform(frames.tcp, 'frames.tcp', normalize, true)

  const simulation = validateSimulation(snapshot.simulation, mechanics)
  if (normalize) snapshot.simulation = simulation
  const assets = validateAssets(snapshot.objectAssets, normalize)
  const entities = validateEntities(snapshot, assets, normalize)
  validateOpcUa(snapshot.opcUa, entities)
  validateCollisionPolicyV3(snapshot.collisionPolicy, normalize)

  if (robot.sourceBytes + assets.sourceBytes > MAX_PROJECT_SOURCE_BYTES) {
    fail('Project exceeds the raw STEP byte budget.')
  }
  if (robot.triangles + entities.visibleObjectTriangles > MAX_SCENE_TRIANGLES) {
    fail('Visible Scene exceeds the triangle budget.')
  }
  if (robot.collisionBoxes + assets.collisionBoxes > MAX_COLLISION_BOXES_PER_PROJECT) {
    fail(`Project cannot exceed ${MAX_COLLISION_BOXES_PER_PROJECT} collision Boxes.`)
  }
  if (freeze) deepFreezeConfiguration(snapshot)
  return snapshot as unknown as WorkcellProjectSnapshotV3
}

export function preflightWorkcellProjectShapeV3(value: unknown): void {
  validateSnapshotCore(value, false, false)
}

export function validateWorkcellProjectSnapshotV3(
  value: unknown,
): WorkcellProjectSnapshotV3 {
  preflightWorkcellProjectShapeV3(value)
  const owned = structuredClone(value)
  return validateSnapshotCore(owned, true, true)
}

declare const preparedProjectSourceBrand: unique symbol
declare const stagedProjectOwnershipAttestationBrand: unique symbol

export type ProjectSourceNamespaceV1 = 'robot' | 'object'
export type ProjectSourceOwnerKeyV1 = `robot-source:${string}` | `object-asset:${string}`

export interface PreparedProjectSourceV1 {
  readonly [preparedProjectSourceBrand]: true
  readonly tokenId: string
  readonly namespace: ProjectSourceNamespaceV1
  readonly sha256: string
  readonly byteLength: number
}

export interface PreparedProjectSourceGroupV1 {
  readonly ownerKeys: readonly ProjectSourceOwnerKeyV1[]
  readonly preparedSource: PreparedProjectSourceV1
}

export interface LegacyProjectSourceAnalysisV1 {
  readonly detectedUnit: 'meter' | 'millimeter' | 'inch' | 'unknown'
  readonly meshIndices: readonly number[]
}

export interface ProjectSourceLockedLeaseInputV1 {
  readonly tokenId: string
  readonly generation: number
  readonly sourceBytes: ArrayBuffer
  readonly signal?: AbortSignal
}

export interface ProjectSourceLockedLeaseResultV1 {
  readonly tokenId: string
  readonly generation: number
  readonly sourceBytes: ArrayBuffer
  readonly analysis: LegacyProjectSourceAnalysisV1
}

export type ProjectSourceLockedLeaseWorkerV1 = (
  input: ProjectSourceLockedLeaseInputV1,
) => Promise<ProjectSourceLockedLeaseResultV1>

interface StagedProjectOwnershipAttestationV3 {
  readonly [stagedProjectOwnershipAttestationBrand]: true
}

interface PreparedSourceStateV1 {
  readonly authority: symbol
  readonly namespace: ProjectSourceNamespaceV1
  readonly sha256: string
  readonly byteLength: number
  status: 'active' | 'leased' | 'revoked'
  sourceBytes: ArrayBuffer | undefined
  generation: number
}

interface PermitClaimV3 {
  readonly token: PreparedProjectSourceV1
  readonly capturedGeneration: number
  readonly capturedBuffer: ArrayBuffer
  readonly ownerKeys: readonly ProjectSourceOwnerKeyV1[]
}

interface StagedProjectSourceAssignmentV3 {
  readonly namespace: ProjectSourceNamespaceV1
  readonly ownerKey: ProjectSourceOwnerKeyV1
  readonly sourceBytes: ArrayBuffer
  readonly sourceByteLength: number
  readonly declaredSha256: string | undefined
}

interface OwnershipAttestationStateV3 {
  consumed: boolean
  readonly resolve: () => readonly StagedProjectSourceAssignmentV3[]
}

interface ProjectSourceOwnershipBoundaryOptionsV1 {
  readonly sourceDigest: ProjectSourceDigest
  readonly copySource?: ((bytes: ArrayBuffer) => ArrayBuffer) | undefined
  readonly tokenIdFactory?: (() => string) | undefined
  readonly lockedLegacyAnalyzer?: ProjectSourceLockedLeaseWorkerV1 | undefined
}

interface ProjectSourceOwnershipBoundaryV1 {
  stage(namespace: ProjectSourceNamespaceV1, bytes: ArrayBuffer, signal?: AbortSignal): Promise<PreparedProjectSourceV1>
  stageOwned(
    namespace: ProjectSourceNamespaceV1,
    bytes: ArrayBuffer,
    signal?: AbortSignal,
    expectedSha256?: string,
  ): Promise<PreparedProjectSourceV1>
  assertPrepared(source: PreparedProjectSourceV1): void
  revoke(source: PreparedProjectSourceV1): void
  analyzeLegacyRobotSource(
    source: PreparedProjectSourceV1,
    signal?: AbortSignal,
  ): Promise<LegacyProjectSourceAnalysisV1>
  activeBuffer(source: PreparedProjectSourceV1): ArrayBuffer
  attest(groups: readonly PreparedProjectSourceGroupV1[]): StagedProjectOwnershipAttestationV3
}

const preparedSourceRegistryV1 = new WeakMap<object, PreparedSourceStateV1>()
const ownershipAttestationRegistryV3 = new WeakMap<object, OwnershipAttestationStateV3>()

function sourceFailure(code: string, message: string, cause?: unknown): never {
  throw Object.assign(
    new Error(`${code}: ${message}`, cause === undefined ? undefined : { cause }),
    { code },
  )
}

function sourceCancelled(): Error & { readonly code: 'PROJECT_SOURCE_LEASE_CANCELLED' } {
  return Object.assign(
    new Error('PROJECT_SOURCE_LEASE_CANCELLED: Project source lease was cancelled.'),
    { code: 'PROJECT_SOURCE_LEASE_CANCELLED' as const },
  )
}

function sourceSignalAborted(signal?: AbortSignal): boolean {
  return signal?.aborted === true
}

function validateClosedLegacyAnalysis(value: unknown): LegacyProjectSourceAnalysisV1 {
  const record = closedRecord(
    value,
    'Legacy Project source analysis',
    ['detectedUnit', 'meshIndices'],
  )
  if (
    record.detectedUnit !== 'meter' &&
    record.detectedUnit !== 'millimeter' &&
    record.detectedUnit !== 'inch' &&
    record.detectedUnit !== 'unknown'
  ) {
    sourceFailure('PROJECT_SOURCE_LEASE_RETURN_INVALID', 'Locked parser returned an invalid source unit.')
  }
  const meshIndices = arrayValue(record.meshIndices, 'Legacy Project source analysis.meshIndices')
    .map((entry, index) => nonNegativeInteger(
      entry,
      `Legacy Project source analysis.meshIndices[${index}]`,
    ))
  if (new Set(meshIndices).size !== meshIndices.length) {
    sourceFailure('PROJECT_SOURCE_LEASE_RETURN_INVALID', 'Locked parser returned duplicate mesh indices.')
  }
  meshIndices.sort((first, second) => first - second)
  return Object.freeze({
    detectedUnit: record.detectedUnit,
    meshIndices: Object.freeze(meshIndices),
  }) as LegacyProjectSourceAnalysisV1
}

function createProjectSourceOwnershipBoundaryV1(
  options: ProjectSourceOwnershipBoundaryOptionsV1,
): ProjectSourceOwnershipBoundaryV1 {
  const authority = Symbol('ProjectSourceOwnershipAuthorityV1')
  const digestSource = options.sourceDigest.digestSource.bind(options.sourceDigest)
  const copySource = options.copySource
  const tokenIdFactory = options.tokenIdFactory
  const lockedLegacyAnalyzer = options.lockedLegacyAnalyzer
  let nextTokenId = 1

  const stateFor = (
    source: PreparedProjectSourceV1,
    expectedStatus?: PreparedSourceStateV1['status'],
  ): PreparedSourceStateV1 => {
    if (typeof source !== 'object' || source === null) {
      return sourceFailure('PROJECT_SOURCE_TOKEN_INVALID', 'Prepared Project source token is invalid.')
    }
    const state = preparedSourceRegistryV1.get(source)
    if (state === undefined || state.authority !== authority) {
      return sourceFailure(
        'PROJECT_SOURCE_TOKEN_INVALID',
        'Prepared Project source token is forged or belongs to another service.',
      )
    }
    if (expectedStatus !== undefined && state.status !== expectedStatus) {
      return sourceFailure(
        state.status === 'revoked' ? 'PROJECT_SOURCE_TOKEN_REVOKED' : 'PROJECT_SOURCE_TOKEN_LEASED',
        `Prepared Project source token is ${state.status}.`,
      )
    }
    return state
  }

  const stageOwned = async (
    namespace: ProjectSourceNamespaceV1,
    bytes: ArrayBuffer,
    signal?: AbortSignal,
    expectedSha256?: string,
  ): Promise<PreparedProjectSourceV1> => {
    const ownedByteLength = typeof bytes === 'object' && bytes !== null
      ? tryArrayBufferByteLength(bytes)
      : undefined
    if (ownedByteLength === undefined) {
      return sourceFailure('PROJECT_SOURCE_BYTES_INVALID', 'Project source must be an ArrayBuffer.')
    }
    let adoptedBytes: ArrayBuffer
    try {
      adoptedBytes = structuredClone(bytes, { transfer: [bytes] })
    } catch (error) {
      return sourceFailure(
        'PROJECT_SOURCE_TRANSFER_FAILED',
        'Project source ownership transfer failed.',
        error,
      )
    }
    const disposeAdoptedBytes = (): void => {
      if (tryArrayBufferByteLength(adoptedBytes) === 0) return
      try {
        structuredClone(adoptedBytes, { transfer: [adoptedBytes] })
      } catch {
        // A concurrent cancellation may already have detached the buffer.
      }
    }
    if (sourceSignalAborted(signal)) {
      disposeAdoptedBytes()
      throw sourceCancelled()
    }
    let removeDigestAbort = (): void => {}
    const abortedDigest = signal === undefined
      ? undefined
      : new Promise<never>((_resolve, reject) => {
          const onAbort = (): void => {
            disposeAdoptedBytes()
            reject(sourceCancelled())
          }
          signal.addEventListener('abort', onAbort, { once: true })
          removeDigestAbort = () => signal.removeEventListener('abort', onAbort)
        })
    let digest: string
    try {
      const pendingDigest = Promise.resolve(digestSource(adoptedBytes, signal))
      digest = abortedDigest === undefined
        ? await pendingDigest
        : await Promise.race([pendingDigest, abortedDigest])
    } finally {
      removeDigestAbort()
    }
    if (!HEX_SHA256.test(digest)) {
      return sourceFailure('PROJECT_SOURCE_DIGEST_INVALID', 'Project source digest must be lowercase 64-hex.')
    }
    if (expectedSha256 !== undefined && digest !== expectedSha256) {
      return sourceFailure(
        'PROJECT_SOURCE_DIGEST_MISMATCH',
        'Archive source bytes do not match the path and index digest.',
      )
    }
    if (sourceSignalAborted(signal)) {
      disposeAdoptedBytes()
      throw sourceCancelled()
    }
    const tokenId = tokenIdFactory?.() ?? `prepared-source-${nextTokenId++}`
    if (typeof tokenId !== 'string' || tokenId.length === 0) {
      return sourceFailure('PROJECT_SOURCE_TOKEN_INVALID', 'Prepared Project source token ID is invalid.')
    }
    const token = Object.freeze({ tokenId, namespace, sha256: digest, byteLength: ownedByteLength }) as PreparedProjectSourceV1
    preparedSourceRegistryV1.set(token, {
      authority,
      namespace,
      sha256: digest,
      byteLength: ownedByteLength,
      status: 'active',
      sourceBytes: adoptedBytes,
      generation: 0,
    })
    return token
  }

  const boundary: ProjectSourceOwnershipBoundaryV1 = {
    stage(namespace, bytes, signal) {
      const sourceLength = typeof bytes === 'object' && bytes !== null
        ? tryArrayBufferByteLength(bytes)
        : undefined
      if (sourceLength === undefined) {
        return Promise.reject(Object.assign(
          new Error('PROJECT_SOURCE_BYTES_INVALID: Project source must be an ArrayBuffer.'),
          { code: 'PROJECT_SOURCE_BYTES_INVALID' },
        ))
      }
      const owned = copySource?.(bytes) ?? bytes.slice(0)
      if (tryArrayBufferByteLength(owned) !== sourceLength || owned === bytes) {
        return Promise.reject(Object.assign(
          new Error('PROJECT_SOURCE_COPY_FAILED: Project source copy must be independent and byte-identical in length.'),
          { code: 'PROJECT_SOURCE_COPY_FAILED' },
        ))
      }
      return stageOwned(namespace, owned, signal)
    },
    stageOwned,
    assertPrepared(source) {
      stateFor(source, 'active')
    },
    revoke(source) {
      const state = stateFor(source)
      if (state.status === 'revoked') return
      state.status = 'revoked'
      if (state.sourceBytes !== undefined && tryArrayBufferByteLength(state.sourceBytes) !== 0) {
        try {
          structuredClone(state.sourceBytes, { transfer: [state.sourceBytes] })
        } catch {
          // A leased or concurrently cancelled buffer may already be detached.
        }
      }
      state.sourceBytes = undefined
      state.generation += 1
    },
    async analyzeLegacyRobotSource(source, signal) {
      const state = stateFor(source, 'active')
      if (state.namespace !== 'robot') {
        boundary.revoke(source)
        return sourceFailure('PROJECT_SOURCE_LEASE_NAMESPACE_INVALID', 'Legacy analysis accepts only Robot sources.')
      }
      const lockedAnalyzer = lockedLegacyAnalyzer
      if (lockedAnalyzer === undefined) {
        boundary.revoke(source)
        return sourceFailure('PROJECT_SOURCE_PARSER_UNAVAILABLE', 'No locked legacy source analyzer is configured.')
      }
      if (signal?.aborted === true) {
        boundary.revoke(source)
        throw sourceCancelled()
      }
      const generation = state.generation + 1
      state.generation = generation
      state.status = 'leased'
      const retained = state.sourceBytes!
      const transferred = structuredClone(retained, { transfer: [retained] })
      state.sourceBytes = undefined
      let removeAbort = (): void => {}
      const aborted = new Promise<never>((_resolve, reject) => {
        if (signal === undefined) return
        const onAbort = (): void => reject(sourceCancelled())
        signal.addEventListener('abort', onAbort, { once: true })
        removeAbort = () => signal.removeEventListener('abort', onAbort)
      })
      try {
        const pending = lockedAnalyzer({
          tokenId: source.tokenId,
          generation,
          sourceBytes: transferred,
          ...(signal === undefined ? {} : { signal }),
        })
        const returned = signal === undefined
          ? await pending
          : await Promise.race([pending, aborted])
        if (
          state.status !== 'leased' ||
          state.generation !== generation ||
          returned.tokenId !== source.tokenId ||
          returned.generation !== generation ||
          tryArrayBufferByteLength(returned.sourceBytes) !== state.byteLength
        ) {
          return sourceFailure(
            'PROJECT_SOURCE_LEASE_RETURN_INVALID',
            'Locked parser returned an invalid or late buffer lease.',
          )
        }
        const analysis = validateClosedLegacyAnalysis(returned.analysis)
        const reclaimed = structuredClone(returned.sourceBytes, { transfer: [returned.sourceBytes] })
        state.sourceBytes = reclaimed
        state.status = 'active'
        state.generation += 1
        return analysis
      } catch (error) {
        if (state.status === 'leased' && state.generation === generation) {
          state.status = 'revoked'
          state.sourceBytes = undefined
          state.generation += 1
        }
        throw error
      } finally {
        removeAbort()
      }
    },
    activeBuffer(source) {
      return stateFor(source, 'active').sourceBytes!
    },
    attest(groups) {
      const tokens = new Set<PreparedProjectSourceV1>()
      const claims: PermitClaimV3[] = groups.map((group) => {
        if (tokens.has(group.preparedSource)) {
          return sourceFailure(
            'PROJECT_SOURCE_ASSIGNMENT_INVALID',
            'A prepared Project source token must appear in exactly one owner group.',
          )
        }
        tokens.add(group.preparedSource)
        const state = stateFor(group.preparedSource, 'active')
        return {
          token: group.preparedSource,
          capturedGeneration: state.generation,
          capturedBuffer: state.sourceBytes!,
          ownerKeys: Object.freeze([...group.ownerKeys]),
        }
      })
      const attestation = Object.freeze({}) as StagedProjectOwnershipAttestationV3
      ownershipAttestationRegistryV3.set(attestation, {
        consumed: false,
        resolve: () => {
          const assignments: StagedProjectSourceAssignmentV3[] = []
          const owners = new Set<ProjectSourceOwnerKeyV1>()
          for (const claim of claims) {
            const state = stateFor(claim.token, 'active')
            if (
              state.generation !== claim.capturedGeneration ||
              state.sourceBytes !== claim.capturedBuffer
            ) {
              return sourceFailure(
                'PROJECT_SOURCE_OWNERSHIP_CAPABILITY_INVALID',
                'Prepared source changed after ownership attestation.',
              )
            }
            if (claim.ownerKeys.length === 0) {
              return sourceFailure('PROJECT_SOURCE_ASSIGNMENT_INVALID', 'Prepared source group must own at least one source.')
            }
            for (const ownerKey of claim.ownerKeys) {
              if (owners.has(ownerKey)) {
                return sourceFailure('PROJECT_SOURCE_ASSIGNMENT_INVALID', `Duplicate prepared Project source owner ${ownerKey}.`)
              }
              owners.add(ownerKey)
              const namespace = ownerKey.startsWith('robot-source:') ? 'robot' : 'object'
              if (
                namespace !== state.namespace ||
                (namespace === 'robot' && ownerKey !== `robot-source:${state.sha256}`)
              ) {
                return sourceFailure('PROJECT_SOURCE_ASSIGNMENT_INVALID', `Prepared source does not match ${ownerKey}.`)
              }
              assignments.push({
                namespace,
                ownerKey,
                sourceBytes: state.sourceBytes!,
                sourceByteLength: state.byteLength,
                declaredSha256: namespace === 'robot' ? state.sha256 : undefined,
              })
            }
          }
          return Object.freeze(assignments.sort((first, second) =>
            (first.namespace === second.namespace ? 0 : first.namespace === 'robot' ? -1 : 1) ||
            (first.ownerKey < second.ownerKey ? -1 : first.ownerKey > second.ownerKey ? 1 : 0)))
        },
      })
      return attestation
    },
  }
  return Object.freeze(boundary)
}

function consumeStagedProjectOwnershipAttestationV3(
  attestation: StagedProjectOwnershipAttestationV3,
): readonly StagedProjectSourceAssignmentV3[] {
  if (typeof attestation !== 'object' || attestation === null) {
    return sourceFailure('PROJECT_SOURCE_OWNERSHIP_CAPABILITY_INVALID', 'Staged ownership capability is invalid.')
  }
  const state = ownershipAttestationRegistryV3.get(attestation)
  if (state === undefined || state.consumed) {
    return sourceFailure(
      'PROJECT_SOURCE_OWNERSHIP_CAPABILITY_INVALID',
      'Staged ownership capability is forged or already consumed.',
    )
  }
  state.consumed = true
  return state.resolve()
}

/** Internal no-copy validation path for source buffers already owned by staging. */
export function validateStagedWorkcellProjectSnapshotV3(
  value: unknown,
  ownershipCapability: StagedProjectOwnershipAttestationV3,
): WorkcellProjectSnapshotV3 {
  let assignments
  try {
    assignments = consumeStagedProjectOwnershipAttestationV3(ownershipCapability)
  } catch {
    fail('Staged validation requires a fresh registry-owned capability.')
  }
  preflightWorkcellProjectShapeV3(value)
  const descriptors = collectProjectSourceDescriptorsV3(
    value as WorkcellProjectSnapshotV3,
  )
  if (descriptors.length !== assignments.length) {
    fail('Staged source assignments do not match the ownership capability.')
  }
  descriptors.forEach((descriptor, index) => {
    const assignment = assignments[index]
    if (
      assignment === undefined ||
      descriptor.namespace !== assignment.namespace ||
      descriptor.ownerKey !== assignment.ownerKey ||
      descriptor.sourceBytes !== assignment.sourceBytes ||
      arrayBufferByteLength(
        descriptor.sourceBytes,
        `Staged source assignment ${descriptor.ownerKey} sourceBytes`,
      ) !== assignment.sourceByteLength ||
      descriptor.declaredSha256 !== assignment.declaredSha256
    ) {
      fail(`Staged source assignment ${descriptor.ownerKey} is not capability-owned.`)
    }
  })
  return validateSnapshotCore(value, true, true)
}

export function collectProjectSourceDescriptorsV3(
  snapshot: WorkcellProjectSnapshotV3,
): readonly ProjectSourceDescriptorV3[] {
  const descriptors: ProjectSourceDescriptorV3[] = [
    ...snapshot.robot.sources.map((source) => ({
      namespace: 'robot' as const,
      ownerKey: `robot-source:${source.id}` as const,
      sourceBytes: source.sourceBytes,
      declaredSha256: source.sha256,
    })),
    ...snapshot.objectAssets.flatMap((asset) =>
      asset.sourceKind === 'step'
        ? [{
            namespace: 'object' as const,
            ownerKey: `object-asset:${asset.id}` as const,
            sourceBytes: asset.sourceBytes,
          }]
        : [],
    ),
  ]
  return descriptors.sort((first, second) =>
    (first.namespace === second.namespace
      ? 0
      : first.namespace === 'robot'
        ? -1
        : 1) ||
    (first.ownerKey < second.ownerKey
      ? -1
      : first.ownerKey > second.ownerKey
        ? 1
        : 0),
  )
}

export interface ProjectSourceStagingServiceOptionsV1 {
  readonly sourceDigest: ProjectSourceDigest
  readonly copySource?: ((bytes: ArrayBuffer) => ArrayBuffer) | undefined
  readonly tokenIdFactory?: (() => string) | undefined
}

export interface ProjectSourceStagingService {
  stage(
    namespace: ProjectSourceNamespaceV1,
    bytes: ArrayBuffer,
    signal?: AbortSignal,
  ): Promise<PreparedProjectSourceV1>
  assertPrepared(source: PreparedProjectSourceV1): void
  revoke(source: PreparedProjectSourceV1): void
  validateProjection(
    projection: ByteFreeWorkcellProjectProjectionV3,
    groups: readonly PreparedProjectSourceGroupV1[],
  ): ByteFreeWorkcellProjectProjectionV3
  prepareArchiveProject(
    projection: ByteFreeWorkcellProjectProjectionV3,
    sources: readonly ProjectArchiveSourcePlanV1[],
    readBytes: ProjectArchiveSourceReaderV1,
    signal?: AbortSignal,
  ): Promise<StagedProjectSourcesV3>
}

/**
 * Complete byte-free source plan for streaming archive preparation. Central
 * directory sizes make every frozen cap checkable before the first read,
 * transfer, digest, or token mutation.
 */
export interface ProjectArchiveSourcePlanV1 {
  readonly namespace: ProjectSourceNamespaceV1
  readonly entryPath: string
  readonly sha256: string
  readonly ownerKeys: readonly ProjectSourceOwnerKeyV1[]
  readonly byteLength: number
}

export type ProjectArchiveSourceReaderV1 = (
  source: ProjectArchiveSourcePlanV1,
  signal?: AbortSignal,
) => Promise<ArrayBuffer>

/**
 * Canonical migration-only staging surface. The analyzer is installed once at
 * the composition root and frozen onto the same registry-backed service that
 * minted its prepared-source capabilities.
 */
export interface ProjectSourceMigrationStagingServiceV1
  extends ProjectSourceStagingService {
  stageOwnedLegacyProjectSources(
    snapshot: WorkcellProjectSnapshotV2,
    signal?: AbortSignal,
  ): Promise<readonly StagedLegacyProjectSourceV1[]>
  analyzeLegacyRobotSource(
    source: PreparedProjectSourceV1,
    signal?: AbortSignal,
  ): Promise<LegacyProjectSourceAnalysisV1>
}

export interface ProjectSourceMigrationFoundationOptionsInternalV1
  extends ProjectSourceStagingServiceOptionsV1 {
  readonly lockedLegacyAnalyzer: ProjectSourceLockedLeaseWorkerV1
}

export interface ProjectSourceMigrationFoundationInternalV1 {
  readonly sourceStaging: ProjectSourceMigrationStagingServiceV1
}

export interface StagedProjectSourcesV3 {
  readonly projection: ByteFreeWorkcellProjectProjectionV3
  readonly preparedSourceGroups: readonly PreparedProjectSourceGroupV1[]
}

interface StagedLegacyProjectSourceV1 {
  readonly legacyOwnerKey: `robot-link:${string}` | `object-asset:${string}`
  readonly preparedSource: PreparedProjectSourceV1
}

const projectSourceServiceBoundariesV1 = new WeakMap<
  ProjectSourceStagingService,
  ProjectSourceOwnershipBoundaryV1
>()
const projectSourceMigrationServicesV1 = new WeakSet<ProjectSourceMigrationStagingServiceV1>()

/** Internal registry assertion used by the migration entrypoint before any staging. */
export function assertCanonicalProjectSourceMigrationStagingServiceInternalV1(
  service: ProjectSourceMigrationStagingServiceV1,
): void {
  if (
    !projectSourceMigrationServicesV1.has(service) ||
    !projectSourceServiceBoundariesV1.has(service)
  ) {
    return sourceFailure(
      'PROJECT_SOURCE_STAGING_SERVICE_INVALID',
      'Project migration requires the exact registry-backed staging service.',
    )
  }
}

function projectSourceBoundaryFor(
  service: ProjectSourceStagingService,
): ProjectSourceOwnershipBoundaryV1 {
  const boundary = projectSourceServiceBoundariesV1.get(service)
  if (boundary === undefined) {
    return sourceFailure(
      'PROJECT_SOURCE_STAGING_SERVICE_INVALID',
      'Project source staging requires a registry-backed canonical service.',
    )
  }
  return boundary
}

function preparedGroupsByOwner(
  groups: readonly PreparedProjectSourceGroupV1[],
): ReadonlyMap<ProjectSourceOwnerKeyV1, PreparedProjectSourceGroupV1> {
  const owners = new Map<ProjectSourceOwnerKeyV1, PreparedProjectSourceGroupV1>()
  const tokens = new Set<PreparedProjectSourceV1>()
  for (const group of groups) {
    if (tokens.has(group.preparedSource)) {
      return sourceFailure(
        'PROJECT_SOURCE_ASSIGNMENT_INVALID',
        'A prepared Project source token must appear in exactly one owner group.',
      )
    }
    tokens.add(group.preparedSource)
    for (const ownerKey of group.ownerKeys) {
      if (owners.has(ownerKey)) {
        return sourceFailure('PROJECT_SOURCE_ASSIGNMENT_INVALID', `Duplicate Project source owner ${ownerKey}.`)
      }
      owners.set(ownerKey, group)
    }
  }
  return owners
}

function hydratePreparedProjectionV3(
  projection: ByteFreeWorkcellProjectProjectionV3,
  groups: readonly PreparedProjectSourceGroupV1[],
  boundary: ProjectSourceOwnershipBoundaryV1,
): WorkcellProjectSnapshotV3 {
  const candidate = structuredClone(projection) as unknown as Record<string, unknown>
  const robot = candidate.robot as Record<string, unknown>
  const sources = robot.sources as Record<string, unknown>[]
  const assets = candidate.objectAssets as Record<string, unknown>[]
  const owners = preparedGroupsByOwner(groups)
  for (const source of sources) {
    const ownerKey = `robot-source:${String(source.id)}` as const
    const group = owners.get(ownerKey)
    if (
      group === undefined ||
      group.preparedSource.namespace !== 'robot' ||
      group.preparedSource.sha256 !== source.id ||
      group.preparedSource.sha256 !== source.sha256
    ) {
      return sourceFailure('PROJECT_SOURCE_ASSIGNMENT_INVALID', `Missing or mismatched prepared source for ${ownerKey}.`)
    }
    source.sourceBytes = boundary.activeBuffer(group.preparedSource)
  }
  for (const asset of assets) {
    if (asset.sourceKind !== 'step') continue
    const ownerKey = `object-asset:${String(asset.id)}` as const
    const group = owners.get(ownerKey)
    if (
      group === undefined ||
      group.preparedSource.namespace !== 'object' ||
      group.preparedSource.sha256 !== asset.sourceSha256
    ) {
      return sourceFailure('PROJECT_SOURCE_ASSIGNMENT_INVALID', `Missing or mismatched prepared source for ${ownerKey}.`)
    }
    delete asset.sourceSha256
    asset.sourceBytes = boundary.activeBuffer(group.preparedSource)
  }
  const expectedOwners = sources.length + assets.filter(({ sourceKind }) => sourceKind === 'step').length
  if (owners.size !== expectedOwners) {
    return sourceFailure('PROJECT_SOURCE_ASSIGNMENT_INVALID', 'Prepared source groups contain orphan owners.')
  }
  return validateStagedWorkcellProjectSnapshotV3(candidate, boundary.attest(groups))
}

function byteFreePreparedProjectionV3(
  snapshot: WorkcellProjectSnapshotV3,
  digestByObjectOwner: ReadonlyMap<string, string>,
): ByteFreeWorkcellProjectProjectionV3 {
  const snapshotRecord = snapshot as unknown as Record<string, unknown>
  const snapshotRobot = snapshotRecord.robot as Record<string, unknown>
  const snapshotSources = snapshotRobot.sources as Record<string, unknown>[]
  const snapshotAssets = snapshotRecord.objectAssets as Record<string, unknown>[]
  const { robot: _robot, objectAssets: _objectAssets, ...projectMetadata } = snapshotRecord
  const { sources: _sources, ...robotMetadata } = snapshotRobot
  const sources = snapshotSources.map((source) => {
    const { sourceBytes: _sourceBytes, ...metadata } = source
    return metadata
  })
  const objectAssets = snapshotAssets.map((asset) => {
    if (asset.sourceKind !== 'step') return asset
    const ownerKey = `object-asset:${String(asset.id)}`
    const sourceSha256 = digestByObjectOwner.get(ownerKey)
    if (sourceSha256 === undefined) {
      return sourceFailure('PROJECT_SOURCE_ASSIGNMENT_INVALID', `Missing Object source digest for ${ownerKey}.`)
    }
    const { sourceBytes: _sourceBytes, ...metadata } = asset
    return { ...metadata, sourceSha256 }
  })
  const projection = structuredClone({
    ...projectMetadata,
    robot: { ...robotMetadata, sources },
    objectAssets,
  }) as unknown as ByteFreeWorkcellProjectProjectionV3
  deepFreezeConfiguration(projection)
  return projection
}

function archiveExpectedOwnersV1(
  projection: ByteFreeWorkcellProjectProjectionV3,
): ReadonlyMap<string, readonly ProjectSourceOwnerKeyV1[]> {
  const expected = new Map<string, ProjectSourceOwnerKeyV1[]>()
  for (const source of projection.robot.sources) {
    if (!HEX_SHA256.test(source.id) || source.id !== source.sha256) {
      return sourceFailure(
        'PROJECT_SOURCE_ASSIGNMENT_INVALID',
        'Archive Robot source ID and digest must be the same lowercase SHA-256.',
      )
    }
    expected.set(`robot:${source.sha256}`, [`robot-source:${source.id}`])
  }
  for (const asset of projection.objectAssets) {
    if (asset.sourceKind !== 'step') continue
    if (!HEX_SHA256.test(asset.sourceSha256)) {
      return sourceFailure(
        'PROJECT_SOURCE_ASSIGNMENT_INVALID',
        `Archive Object Asset ${asset.id} has an invalid source digest.`,
      )
    }
    const key = `object:${asset.sourceSha256}`
    const owners = expected.get(key) ?? []
    owners.push(`object-asset:${asset.id}`)
    expected.set(key, owners)
  }
  for (const owners of expected.values()) owners.sort()
  return expected
}

function preflightArchiveProjectionWithSourcesV1(
  projection: ByteFreeWorkcellProjectProjectionV3,
  sources: readonly {
    readonly namespace: ProjectSourceNamespaceV1
    readonly ownerKeys: readonly ProjectSourceOwnerKeyV1[]
    readonly bytes: ArrayBuffer
  }[],
): void {
  const candidate = structuredClone(projection) as unknown as Record<string, unknown>
  const owners = new Map<ProjectSourceOwnerKeyV1, {
    readonly namespace: ProjectSourceNamespaceV1
    readonly bytes: ArrayBuffer
  }>()
  for (const source of sources) {
    for (const ownerKey of source.ownerKeys) {
      if (owners.has(ownerKey)) {
        return sourceFailure(
          'PROJECT_SOURCE_ASSIGNMENT_INVALID',
          `Duplicate Archive source owner ${ownerKey}.`,
        )
      }
      owners.set(ownerKey, { namespace: source.namespace, bytes: source.bytes })
    }
  }
  const robot = candidate.robot as Record<string, unknown>
  const robotSources = robot.sources as Record<string, unknown>[]
  for (const source of robotSources) {
    const ownerKey = `robot-source:${String(source.id)}` as const
    const assignment = owners.get(ownerKey)
    if (assignment === undefined || assignment.namespace !== 'robot') {
      return sourceFailure(
        'PROJECT_SOURCE_ASSIGNMENT_INVALID',
        `Missing Archive source owner ${ownerKey}.`,
      )
    }
    source.sourceBytes = assignment.bytes
  }
  const objectAssets = candidate.objectAssets as Record<string, unknown>[]
  for (const asset of objectAssets) {
    if (asset.sourceKind !== 'step') continue
    const ownerKey = `object-asset:${String(asset.id)}` as const
    const assignment = owners.get(ownerKey)
    if (assignment === undefined || assignment.namespace !== 'object') {
      return sourceFailure(
        'PROJECT_SOURCE_ASSIGNMENT_INVALID',
        `Missing Archive source owner ${ownerKey}.`,
      )
    }
    delete asset.sourceSha256
    asset.sourceBytes = assignment.bytes
  }
  preflightWorkcellProjectShapeV3(candidate)
}

function assertByteFreeArchiveProjectionGraphV1(
  value: unknown,
  seen = new WeakSet<object>(),
  active = new WeakSet<object>(),
): void {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return
  }
  if (typeof value !== 'object') {
    return sourceFailure(
      'PROJECT_SOURCE_ASSIGNMENT_INVALID',
      'Archive Project projection contains a non-data value.',
    )
  }
  if (tryArrayBufferByteLength(value) !== undefined || ArrayBuffer.isView(value)) {
    return sourceFailure(
      'PROJECT_SOURCE_ASSIGNMENT_INVALID',
      'Archive Project projection must be byte-free.',
    )
  }
  if (active.has(value)) {
    return sourceFailure(
      'PROJECT_SOURCE_ASSIGNMENT_INVALID',
      'Archive Project projection must not contain cycles.',
    )
  }
  if (seen.has(value)) return
  seen.add(value)
  active.add(value)
  const prototype = Object.getPrototypeOf(value)
  if (Array.isArray(value)) {
    if (prototype !== Array.prototype) {
      return sourceFailure(
        'PROJECT_SOURCE_ASSIGNMENT_INVALID',
        'Archive Project projection arrays must use the plain Array prototype.',
      )
    }
    const descriptors = Object.getOwnPropertyDescriptors(value)
    const lengthDescriptor = Object.getOwnPropertyDescriptor(value, 'length')
    if (
      lengthDescriptor === undefined ||
      !('value' in lengthDescriptor) ||
      lengthDescriptor.value !== value.length
    ) {
      return sourceFailure(
        'PROJECT_SOURCE_ASSIGNMENT_INVALID',
        'Archive Project projection array length must be a data field.',
      )
    }
    for (let index = 0; index < value.length; index += 1) {
      const descriptor = descriptors[String(index)]
      if (descriptor === undefined || !descriptor.enumerable || !('value' in descriptor)) {
        return sourceFailure(
          'PROJECT_SOURCE_ASSIGNMENT_INVALID',
          'Archive Project projection array elements must be enumerable data fields.',
        )
      }
      assertByteFreeArchiveProjectionGraphV1(descriptor.value, seen, active)
    }
    const expectedKeyCount = value.length + 1
    if (Reflect.ownKeys(descriptors).length !== expectedKeyCount) {
      return sourceFailure(
        'PROJECT_SOURCE_ASSIGNMENT_INVALID',
        'Archive Project projection arrays contain unknown fields.',
      )
    }
    active.delete(value)
    return
  }
  if (prototype !== Object.prototype) {
    return sourceFailure(
      'PROJECT_SOURCE_ASSIGNMENT_INVALID',
      'Archive Project projection records must use the plain Object prototype.',
    )
  }
  const descriptors = Object.getOwnPropertyDescriptors(value)
  for (const key of Reflect.ownKeys(descriptors)) {
    if (typeof key !== 'string') {
      return sourceFailure(
        'PROJECT_SOURCE_ASSIGNMENT_INVALID',
        'Archive Project projection records cannot contain symbol fields.',
      )
    }
    const descriptor = descriptors[key]!
    if (!descriptor.enumerable || !('value' in descriptor)) {
      return sourceFailure(
        'PROJECT_SOURCE_ASSIGNMENT_INVALID',
        'Archive Project projection fields must be enumerable data fields.',
      )
    }
    assertByteFreeArchiveProjectionGraphV1(descriptor.value, seen, active)
  }
  active.delete(value)
}

function waitForArchiveSourceOperationV1<Result>(
  pending: Promise<Result>,
  signal?: AbortSignal,
): Promise<Result> {
  if (signal === undefined) return pending
  if (signal.aborted) return Promise.reject(sourceCancelled())
  return new Promise<Result>((resolve, reject) => {
    let settled = false
    const onAbort = (): void => {
      if (settled) return
      settled = true
      reject(sourceCancelled())
    }
    signal.addEventListener('abort', onAbort, { once: true })
    pending.then(
      (value) => {
        if (settled) return
        settled = true
        signal.removeEventListener('abort', onAbort)
        resolve(value)
      },
      (error) => {
        if (settled) return
        settled = true
        signal.removeEventListener('abort', onAbort)
        reject(error)
      },
    )
  })
}

async function stageArchiveSourceForOperationV1(
  boundary: ProjectSourceOwnershipBoundaryV1,
  source: {
    readonly namespace: ProjectSourceNamespaceV1
    readonly sha256: string
    readonly bytes: ArrayBuffer
  },
  operationClosed: () => boolean,
  signal?: AbortSignal,
): Promise<PreparedProjectSourceV1> {
  const pending = boundary.stageOwned(
    source.namespace,
    source.bytes,
    signal,
    source.sha256,
  )
  let accepted = false
  void pending.then(
    (preparedSource) => {
      if (!accepted && (operationClosed() || signal?.aborted === true)) {
        try {
          boundary.revoke(preparedSource)
        } catch {
          // A concurrent failure may already have revoked the late token.
        }
      }
    },
    () => undefined,
  )
  const preparedSource = await waitForArchiveSourceOperationV1(pending, signal)
  if (operationClosed() || signal?.aborted === true) {
    boundary.revoke(preparedSource)
    throw sourceCancelled()
  }
  accepted = true
  return preparedSource
}

function completeArchiveProjectPreparationV1(
  ownedProjection: ByteFreeWorkcellProjectProjectionV3,
  groups: PreparedProjectSourceGroupV1[],
  boundary: ProjectSourceOwnershipBoundaryV1,
): StagedProjectSourcesV3 {
  groups.sort((first, second) => {
    const firstKey = first.ownerKeys[0]!
    const secondKey = second.ownerKeys[0]!
    return firstKey < secondKey ? -1 : firstKey > secondKey ? 1 : 0
  })
  const frozenGroups = Object.freeze(groups)
  const validatedProjection = hydratePreparedProjectionV3(
    ownedProjection,
    frozenGroups,
    boundary,
  )
  const objectDigests = new Map<string, string>()
  for (const group of frozenGroups) {
    for (const ownerKey of group.ownerKeys) {
      if (ownerKey.startsWith('object-asset:')) {
        objectDigests.set(ownerKey, group.preparedSource.sha256)
      }
    }
  }
  return Object.freeze({
    projection: byteFreePreparedProjectionV3(validatedProjection, objectDigests),
    preparedSourceGroups: frozenGroups,
  })
}

function preflightArchiveSourcePlansV1(
  projection: ByteFreeWorkcellProjectProjectionV3,
  sources: readonly ProjectArchiveSourcePlanV1[],
): {
  readonly projection: ByteFreeWorkcellProjectProjectionV3
  readonly sources: readonly ProjectArchiveSourcePlanV1[]
} {
  let ownedProjection: ByteFreeWorkcellProjectProjectionV3
  let ownedSources: readonly ProjectArchiveSourcePlanV1[]
  try {
    assertByteFreeArchiveProjectionGraphV1(projection)
    assertByteFreeArchiveProjectionGraphV1(sources)
    ownedProjection = structuredClone(projection)
    ownedSources = structuredClone(sources)
  } catch (error) {
    return sourceFailure(
      'PROJECT_SOURCE_ASSIGNMENT_INVALID',
      'Archive Project projection and source plan must be closed data-only graphs.',
      error,
    )
  }
  if (!Array.isArray(ownedSources)) {
    return sourceFailure('PROJECT_SOURCE_ASSIGNMENT_INVALID', 'Archive source plan must be an array.')
  }
  const expectedOwners = archiveExpectedOwnersV1(ownedProjection)
  if (ownedSources.length !== expectedOwners.size) {
    return sourceFailure(
      'PROJECT_SOURCE_ASSIGNMENT_INVALID',
      'Archive source plan does not resolve every Project source exactly once.',
    )
  }
  const seenKeys = new Set<string>()
  let totalSourceBytes = 0
  const planned = ownedSources.map((input, index) => {
    const record = closedRecord(input, `Archive source plan[${index}]`, [
      'namespace', 'entryPath', 'sha256', 'ownerKeys', 'byteLength',
    ])
    const namespace = record.namespace
    if (namespace !== 'robot' && namespace !== 'object') {
      return sourceFailure('PROJECT_SOURCE_ASSIGNMENT_INVALID', 'Archive source namespace is invalid.')
    }
    const sha256 = record.sha256
    if (typeof sha256 !== 'string' || !HEX_SHA256.test(sha256)) {
      return sourceFailure('PROJECT_SOURCE_ASSIGNMENT_INVALID', 'Archive source digest is invalid.')
    }
    const expectedPath = namespace === 'robot'
      ? `robot/sources/${sha256}.step`
      : `objects/assets/${sha256}.step`
    if (record.entryPath !== expectedPath) {
      return sourceFailure(
        'PROJECT_SOURCE_ASSIGNMENT_INVALID',
        'Archive source path does not match its namespace and digest.',
      )
    }
    const key = `${namespace}:${sha256}`
    if (seenKeys.has(key)) {
      return sourceFailure('PROJECT_SOURCE_ASSIGNMENT_INVALID', `Duplicate Archive source ${key}.`)
    }
    seenKeys.add(key)
    const ownerKeys = arrayValue(record.ownerKeys, `Archive source plan[${index}].ownerKeys`)
      .map((ownerKey) => {
        if (
          typeof ownerKey !== 'string' ||
          (namespace === 'robot'
            ? ownerKey !== `robot-source:${sha256}`
            : !ownerKey.startsWith('object-asset:'))
        ) {
          return sourceFailure(
            'PROJECT_SOURCE_ASSIGNMENT_INVALID',
            `Archive source ${key} has an invalid owner.`,
          )
        }
        return ownerKey as ProjectSourceOwnerKeyV1
      })
      .sort()
    if (ownerKeys.length === 0 || new Set(ownerKeys).size !== ownerKeys.length) {
      return sourceFailure(
        'PROJECT_SOURCE_ASSIGNMENT_INVALID',
        `Archive source ${key} has duplicate or empty owners.`,
      )
    }
    const expected = expectedOwners.get(key)
    if (
      expected === undefined ||
      expected.length !== ownerKeys.length ||
      expected.some((ownerKey, ownerIndex) => ownerKey !== ownerKeys[ownerIndex])
    ) {
      return sourceFailure(
        'PROJECT_SOURCE_ASSIGNMENT_INVALID',
        `Archive source ${key} does not match the Project owner graph.`,
      )
    }
    const byteLength = nonNegativeInteger(
      record.byteLength,
      `Archive source plan[${index}].byteLength`,
    )
    const entryLimit = namespace === 'robot' ? MAX_ROBOT_LINK_BYTES : MAX_OBJECT_ASSET_BYTES
    if (byteLength === 0 || byteLength > entryLimit) {
      return sourceFailure(
        'PROJECT_SOURCE_BYTES_INVALID',
        `Archive source ${key} has an invalid planned byte length.`,
      )
    }
    totalSourceBytes += byteLength
    if (totalSourceBytes > MAX_PROJECT_SOURCE_BYTES) {
      return sourceFailure('PROJECT_SOURCE_BYTES_INVALID', 'Archive sources exceed the Project byte limit.')
    }
    return Object.freeze({
      namespace,
      entryPath: expectedPath,
      sha256,
      ownerKeys: Object.freeze(ownerKeys),
      byteLength,
    }) satisfies ProjectArchiveSourcePlanV1
  })
  for (const key of expectedOwners.keys()) {
    if (!seenKeys.has(key)) {
      return sourceFailure('PROJECT_SOURCE_ASSIGNMENT_INVALID', `Missing Archive source ${key}.`)
    }
  }
  try {
    preflightArchiveProjectionWithSourcesV1(
      ownedProjection,
      planned.map((source) => ({ ...source, bytes: new ArrayBuffer(1) })),
    )
  } catch (error) {
    return sourceFailure(
      'PROJECT_SOURCE_ASSIGNMENT_INVALID',
      'Archive Project projection is not a valid V3 Project.',
      error,
    )
  }
  return Object.freeze({
    projection: ownedProjection,
    sources: Object.freeze(planned),
  })
}

async function prepareArchiveProjectFromReaderV1(
  projection: ByteFreeWorkcellProjectProjectionV3,
  sources: readonly ProjectArchiveSourcePlanV1[],
  readBytes: ProjectArchiveSourceReaderV1,
  boundary: ProjectSourceOwnershipBoundaryV1,
  signal?: AbortSignal,
): Promise<StagedProjectSourcesV3> {
  if (typeof readBytes !== 'function') {
    return sourceFailure('PROJECT_SOURCE_ASSIGNMENT_INVALID', 'Archive source reader must be a function.')
  }
  const capturedReadBytes = readBytes
  const capturedSignal = signal
  const planned = preflightArchiveSourcePlansV1(projection, sources)
  if (capturedSignal?.aborted === true) throw sourceCancelled()

  const staged: PreparedProjectSourceV1[] = []
  const groups: PreparedProjectSourceGroupV1[] = []
  let operationClosed = false
  try {
    for (const source of planned.sources) {
      const pendingRead = Promise.resolve().then(() => capturedReadBytes(source, capturedSignal))
      const returnedBytes = await waitForArchiveSourceOperationV1(pendingRead, capturedSignal)
      const byteLength = typeof returnedBytes === 'object' && returnedBytes !== null
        ? tryArrayBufferByteLength(returnedBytes)
        : undefined
      if (byteLength !== source.byteLength) {
        return sourceFailure(
          'PROJECT_SOURCE_BYTES_INVALID',
          `Archive source ${source.entryPath} does not match its planned byte length.`,
        )
      }
      let ownedBytes: ArrayBuffer
      try {
        ownedBytes = structuredClone(returnedBytes, { transfer: [returnedBytes] })
      } catch (error) {
        return sourceFailure(
          'PROJECT_SOURCE_TRANSFER_FAILED',
          'Archive source ownership transfer failed.',
          error,
        )
      }
      const preparedSource = await stageArchiveSourceForOperationV1(
        boundary,
        { namespace: source.namespace, sha256: source.sha256, bytes: ownedBytes },
        () => operationClosed,
        capturedSignal,
      )
      staged.push(preparedSource)
      groups.push(Object.freeze({ ownerKeys: source.ownerKeys, preparedSource }))
      if (sourceSignalAborted(capturedSignal)) throw sourceCancelled()
    }
    return completeArchiveProjectPreparationV1(planned.projection, groups, boundary)
  } catch (error) {
    operationClosed = true
    for (const source of staged) {
      try {
        boundary.revoke(source)
      } catch {
        // Revocation is best-effort for a token already invalidated by failure.
      }
    }
    throw error
  } finally {
    operationClosed = true
  }
}

function projectSourceStagingMethodsV1(
  boundary: ProjectSourceOwnershipBoundaryV1,
): ProjectSourceStagingService {
  return {
    stage: boundary.stage,
    assertPrepared: boundary.assertPrepared,
    revoke: boundary.revoke,
    validateProjection(projection, groups) {
      const hydrated = hydratePreparedProjectionV3(projection, groups, boundary)
      const objectDigests = new Map<string, string>()
      for (const group of groups) {
        for (const ownerKey of group.ownerKeys) {
          if (ownerKey.startsWith('object-asset:')) {
            objectDigests.set(ownerKey, group.preparedSource.sha256)
          }
        }
      }
      return byteFreePreparedProjectionV3(hydrated, objectDigests)
    },
    prepareArchiveProject(projection, sources, readBytes, signal) {
      let registeredBoundary: ProjectSourceOwnershipBoundaryV1
      try {
        registeredBoundary = projectSourceBoundaryFor(this)
      } catch (error) {
        return Promise.reject(error)
      }
      if (registeredBoundary !== boundary) {
        return Promise.reject(Object.assign(
          new Error('PROJECT_SOURCE_STAGING_SERVICE_INVALID: Archive staging service identity is invalid.'),
          { code: 'PROJECT_SOURCE_STAGING_SERVICE_INVALID' },
        ))
      }
      return prepareArchiveProjectFromReaderV1(
        projection,
        sources,
        readBytes,
        boundary,
        signal,
      )
    },
  }
}

function registerCanonicalProjectSourceStagingServiceV1<
  Service extends ProjectSourceStagingService,
>(
  service: Service,
  boundary: ProjectSourceOwnershipBoundaryV1,
): Service {
  projectSourceServiceBoundariesV1.set(service, boundary)
  return Object.freeze(service)
}

export function createProjectSourceStagingService(
  options: ProjectSourceStagingServiceOptionsV1,
): ProjectSourceStagingService {
  const boundary = createProjectSourceOwnershipBoundaryV1(options)
  return registerCanonicalProjectSourceStagingServiceV1(
    projectSourceStagingMethodsV1(boundary),
    boundary,
  )
}

/**
 * Internal composition boundary for the future bundled legacy parser runtime.
 * It is intentionally absent from the feature facade/public barrel: the
 * construction root supplies one locked adapter and receives the only bound
 * analyzer that can lease this canonical service's tokens.
 */
export function createProjectSourceMigrationFoundationInternalV1(
  options: ProjectSourceMigrationFoundationOptionsInternalV1,
): ProjectSourceMigrationFoundationInternalV1 {
  const boundary = createProjectSourceOwnershipBoundaryV1(options)
  let sourceStaging!: ProjectSourceMigrationStagingServiceV1
  sourceStaging = registerCanonicalProjectSourceStagingServiceV1({
    ...projectSourceStagingMethodsV1(boundary),
    stageOwnedLegacyProjectSources(snapshot, signal) {
      if (this !== sourceStaging) {
        return Promise.reject(Object.assign(
          new Error('PROJECT_SOURCE_STAGING_SERVICE_INVALID: Migration staging service identity is invalid.'),
          { code: 'PROJECT_SOURCE_STAGING_SERVICE_INVALID' },
        ))
      }
      return stageOwnedLegacyProjectSourcesV2Internal(snapshot, boundary, signal)
    },
    analyzeLegacyRobotSource(source, signal) {
      if (this !== sourceStaging) {
        return Promise.reject(Object.assign(
          new Error('PROJECT_SOURCE_STAGING_SERVICE_INVALID: Migration staging service identity is invalid.'),
          { code: 'PROJECT_SOURCE_STAGING_SERVICE_INVALID' },
        ))
      }
      return boundary.analyzeLegacyRobotSource(source, signal)
    },
  }, boundary)
  projectSourceMigrationServicesV1.add(sourceStaging)
  return Object.freeze({
    sourceStaging,
  })
}

/**
 * Assigns one independent owned buffer to Object staging when the same source
 * identity also belongs to Robot staging. The complete split plan is built
 * synchronously so the Robot transfer cannot detach bytes still needed by the
 * Object namespace. Repeated owners inside one namespace retain one identity.
 */
function splitCrossNamespaceObjectSourceBuffersV1(
  robotSourceBuffers: readonly ArrayBuffer[],
  objectSourceBuffers: readonly ArrayBuffer[],
): ReadonlyMap<ArrayBuffer, ArrayBuffer> {
  const robotIdentities = new Set(robotSourceBuffers)
  const objectOwnedBuffers = new Map<ArrayBuffer, ArrayBuffer>()
  for (const sourceBytes of objectSourceBuffers) {
    if (objectOwnedBuffers.has(sourceBytes)) continue
    if (!robotIdentities.has(sourceBytes)) {
      objectOwnedBuffers.set(sourceBytes, sourceBytes)
      continue
    }
    const sourceByteLength = tryArrayBufferByteLength(sourceBytes)
    if (sourceByteLength === undefined) {
      return sourceFailure('PROJECT_SOURCE_BYTES_INVALID', 'Project source must be an ArrayBuffer.')
    }
    let namespaceOwnedBytes: ArrayBuffer
    try {
      namespaceOwnedBytes = structuredClone(sourceBytes)
    } catch (error) {
      return sourceFailure(
        'PROJECT_SOURCE_COPY_FAILED',
        'Cross-namespace Project source ownership copy failed.',
        error,
      )
    }
    if (
      namespaceOwnedBytes === sourceBytes ||
      tryArrayBufferByteLength(namespaceOwnedBytes) !== sourceByteLength
    ) {
      return sourceFailure(
        'PROJECT_SOURCE_COPY_FAILED',
        'Cross-namespace Project source ownership copy must be independent and byte-identical in length.',
      )
    }
    objectOwnedBuffers.set(sourceBytes, namespaceOwnedBytes)
  }
  return objectOwnedBuffers
}

export async function stageProjectSourcesV3(
  snapshot: WorkcellProjectSnapshotV3,
  stagingService: ProjectSourceStagingService,
  revisionIdentityHasher: ProjectRevisionIdentityHasher,
  signal?: AbortSignal,
): Promise<StagedProjectSourcesV3> {
  preflightWorkcellProjectShapeV3(snapshot)
  const owned = structuredClone(snapshot)
  const descriptors = collectProjectSourceDescriptorsV3(owned)
  const objectOwnedBuffers = splitCrossNamespaceObjectSourceBuffersV1(
    descriptors.filter(({ namespace }) => namespace === 'robot').map(({ sourceBytes }) => sourceBytes),
    descriptors.filter(({ namespace }) => namespace === 'object').map(({ sourceBytes }) => sourceBytes),
  )
  const boundary = projectSourceBoundaryFor(stagingService)
  const groupsByDigest = new Map<string, {
    readonly ownerKeys: ProjectSourceOwnerKeyV1[]
    readonly preparedSource: PreparedProjectSourceV1
  }>()
  const staged: PreparedProjectSourceV1[] = []
  const robotBufferTokens = new Map<ArrayBuffer, PreparedProjectSourceV1>()
  const objectBufferTokens = new Map<ArrayBuffer, PreparedProjectSourceV1>()
  const objectDigests = new Map<string, string>()
  try {
    await verifyProjectCryptographicProvenanceV3(owned, revisionIdentityHasher, signal)
    for (const descriptor of descriptors) {
      const bufferTokens = descriptor.namespace === 'robot' ? robotBufferTokens : objectBufferTokens
      let prepared = bufferTokens.get(descriptor.sourceBytes)
      if (prepared === undefined) {
        const namespaceOwnedBytes = descriptor.namespace === 'robot'
          ? descriptor.sourceBytes
          : objectOwnedBuffers.get(descriptor.sourceBytes)!
        prepared = await boundary.stageOwned(descriptor.namespace, namespaceOwnedBytes, signal)
        bufferTokens.set(descriptor.sourceBytes, prepared)
        staged.push(prepared)
      }
      if (descriptor.namespace === 'robot' && descriptor.declaredSha256 !== prepared.sha256) {
        return sourceFailure(
          'PROJECT_SOURCE_DIGEST_MISMATCH',
          `Robot source ${descriptor.ownerKey} does not match its declared digest.`,
        )
      }
      const digestKey = `${descriptor.namespace}:${prepared.sha256}`
      const existing = groupsByDigest.get(digestKey)
      if (existing === undefined) {
        groupsByDigest.set(digestKey, { ownerKeys: [descriptor.ownerKey], preparedSource: prepared })
      } else {
        if (existing.preparedSource.byteLength !== prepared.byteLength) {
          return sourceFailure('PROJECT_SOURCE_DIGEST_COLLISION', 'Equal source digests have different byte lengths.')
        }
        existing.ownerKeys.push(descriptor.ownerKey)
        if (existing.preparedSource !== prepared) boundary.revoke(prepared)
      }
      if (descriptor.namespace === 'object') objectDigests.set(descriptor.ownerKey, prepared.sha256)
    }
    const groups = Array.from(groupsByDigest.values(), (group) => Object.freeze({
      ownerKeys: Object.freeze([...group.ownerKeys].sort()),
      preparedSource: group.preparedSource,
    })).sort((first, second) =>
      first.ownerKeys[0]! < second.ownerKeys[0]! ? -1 : first.ownerKeys[0]! > second.ownerKeys[0]! ? 1 : 0)
    const projection = byteFreePreparedProjectionV3(owned, objectDigests)
    return Object.freeze({
      projection: stagingService.validateProjection(projection, groups),
      preparedSourceGroups: Object.freeze(groups),
    })
  } catch (error) {
    for (const source of staged) boundary.revoke(source)
    throw error
  }
}

async function stageOwnedLegacyProjectSourcesV2Internal(
  snapshot: WorkcellProjectSnapshotV2,
  boundary: ProjectSourceOwnershipBoundaryV1,
  signal?: AbortSignal,
): Promise<readonly StagedLegacyProjectSourceV1[]> {
  const staged: PreparedProjectSourceV1[] = []
  const results: StagedLegacyProjectSourceV1[] = []
  const robotBufferTokens = new Map<ArrayBuffer, PreparedProjectSourceV1>()
  const objectBufferTokens = new Map<ArrayBuffer, PreparedProjectSourceV1>()
  const objectOwnedBuffers = splitCrossNamespaceObjectSourceBuffersV1(
    snapshot.robot.links.map(({ sourceBytes }) => sourceBytes),
    snapshot.objectAssets.map(({ sourceBytes }) => sourceBytes),
  )
  try {
    for (const link of snapshot.robot.links) {
      let prepared = robotBufferTokens.get(link.sourceBytes)
      if (prepared === undefined) {
        prepared = await boundary.stageOwned('robot', link.sourceBytes, signal)
        robotBufferTokens.set(link.sourceBytes, prepared)
        staged.push(prepared)
      }
      results.push({ legacyOwnerKey: `robot-link:${link.linkId}`, preparedSource: prepared })
    }
    for (const asset of snapshot.objectAssets) {
      let prepared = objectBufferTokens.get(asset.sourceBytes)
      if (prepared === undefined) {
        prepared = await boundary.stageOwned(
          'object',
          objectOwnedBuffers.get(asset.sourceBytes)!,
          signal,
        )
        objectBufferTokens.set(asset.sourceBytes, prepared)
        staged.push(prepared)
      }
      results.push({ legacyOwnerKey: `object-asset:${asset.id}`, preparedSource: prepared })
    }
    return Object.freeze(results.map((result) => Object.freeze(result)))
  } catch (error) {
    for (const source of staged) boundary.revoke(source)
    throw error
  }
}
