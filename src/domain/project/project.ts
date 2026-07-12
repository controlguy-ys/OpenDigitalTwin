import type {
  EquipmentOriginMode,
  EquipmentStatusSource,
  SerializableTransform,
} from '../equipment/equipment'
import type { RobotJointDefinition, RobotLinkId, Vector3Tuple } from '../robot/crb15000'

export const WORKCELL_PROJECT_FORMAT = 'WebDigitalTwinProject'
export const WORKCELL_PROJECT_SCHEMA_VERSION = 1

export const MAX_ROBOT_LINKS = 7
export const MAX_ROBOT_LINK_BYTES = 25 * 1024 * 1024
export const MAX_ROBOT_BYTES = 100 * 1024 * 1024
export const MAX_OBJECT_ASSET_BYTES = 50 * 1024 * 1024
export const MAX_PROJECT_SOURCE_BYTES = 256 * 1024 * 1024
export const MAX_ROBOT_LINK_TRIANGLES = 150_000
export const MAX_ROBOT_TRIANGLES = 600_000
export const MAX_OBJECT_ASSET_TRIANGLES = 250_000
export const MAX_SCENE_TRIANGLES = 1_500_000
export const MAX_ASSET_MESHES = 64
export const MAX_ASSET_MATERIALS = 32

const ROBOT_LINK_IDS = [
  'LINK00',
  'LINK01',
  'LINK02',
  'LINK03',
  'LINK04',
  'LINK05',
  'LINK06',
] as const satisfies readonly RobotLinkId[]

const JOINT_IDS = ['J1', 'J2', 'J3', 'J4', 'J5', 'J6'] as const

export interface GeometryStatistics {
  vertices: number
  triangles: number
  meshes: number
  materials: number
}

export interface WorkcellProjectManifestV1 {
  format: typeof WORKCELL_PROJECT_FORMAT
  schemaVersion: typeof WORKCELL_PROJECT_SCHEMA_VERSION
  projectId: string
  name: string
  createdAt: string
  updatedAt: string
}

export interface RobotLinkGeometryRecordV1 {
  linkId: RobotLinkId
  sourceFileName: string
  sourceBytes: ArrayBuffer
  localTransform: SerializableTransform
  visible: boolean
  collisionHalfExtents: [number, number, number]
  statistics: GeometryStatistics
}

export interface ProjectRobotJointV1 extends RobotJointDefinition {
  parentLink: RobotLinkId
  childLink: RobotLinkId
  maxVelocityDegPerSec: number
}

export interface ProjectRobotV1 {
  name: string
  basePosition: Vector3Tuple
  baseRotationDeg: Vector3Tuple
  links: RobotLinkGeometryRecordV1[]
  joints: ProjectRobotJointV1[]
}

export interface ObjectAssetRecordV1 {
  id: string
  name: string
  sourceFileName: string
  sourceBytes: ArrayBuffer
  importScale: number
  originMode: EquipmentOriginMode
  collisionHalfExtents: [number, number, number]
  statistics: GeometryStatistics
}

export interface ObjectInstanceRecordV1 {
  id: string
  assetId: string
  name: string
  transform: SerializableTransform
  numericStatus: number
  statusSource: EquipmentStatusSource
  statusOverlayVisible: boolean
  visible: boolean
}

export interface ProjectPoseRecordV1 {
  id: string
  name: string
  anglesDeg: [number, number, number, number, number, number]
  durationMs: number
  easing: 'linear' | 'easeInOut'
  speedPercentToNext?: number
}

export interface ProjectOpcUaJointBindingV1 {
  id: (typeof JOINT_IDS)[number]
  nodeId: string
  scale: number
  offset: number
}

export interface ProjectOpcUaEquipmentBindingV1 {
  instanceId: string
  nodeId: string
  scale: number
  offset: number
}

export interface WorkcellProjectSnapshotV1 {
  manifest: WorkcellProjectManifestV1
  robot: ProjectRobotV1
  frames: {
    mcp: SerializableTransform
    tcp: SerializableTransform
  }
  objectAssets: ObjectAssetRecordV1[]
  objectInstances: ObjectInstanceRecordV1[]
  poses: ProjectPoseRecordV1[]
  opcUa: {
    endpointUrl: string
    samplingIntervalMs: number
    joints: ProjectOpcUaJointBindingV1[]
    equipment: ProjectOpcUaEquipmentBindingV1[]
  }
}

function fail(message: string): never {
  throw new Error(`Invalid workcell project: ${message}`)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) fail(`${label} is required.`)
  return value
}

function requireArray(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) fail(`${label} must be an array.`)
  return value
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    fail(`${label} must be a non-empty string.`)
  }
  return value
}

function requireFinite(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    fail(`${label} must be finite.`)
  }
  return value
}

function requirePositive(value: unknown, label: string): number {
  const number = requireFinite(value, label)
  if (number <= 0) fail(`${label} must be positive.`)
  return number
}

function requireInteger(value: unknown, label: string): number {
  const number = requireFinite(value, label)
  if (!Number.isInteger(number) || number < 0) {
    fail(`${label} must be a non-negative integer.`)
  }
  return number
}

function requireBoolean(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') fail(`${label} must be boolean.`)
  return value
}

function requireTuple(
  value: unknown,
  length: number,
  label: string,
  positive = false,
): number[] {
  if (!Array.isArray(value) || value.length !== length) {
    fail(`${label} must contain ${length} numbers.`)
  }
  return value.map((entry, index) =>
    positive
      ? requirePositive(entry, `${label}[${index}]`)
      : requireFinite(entry, `${label}[${index}]`),
  )
}

function requireTransform(value: unknown, label: string): void {
  const transform = requireRecord(value, label)
  requireTuple(transform.position, 3, `${label}.position`)
  const quaternion = requireTuple(transform.quaternion, 4, `${label}.quaternion`)
  if (Math.hypot(...quaternion) <= 1e-9) fail(`${label}.quaternion cannot be zero.`)
  requireTuple(transform.scale, 3, `${label}.scale`, true)
}

function requireArrayBuffer(value: unknown, label: string): ArrayBuffer {
  if (
    typeof value !== 'object' ||
    value === null ||
    ArrayBuffer.isView(value) ||
    Object.prototype.toString.call(value) !== '[object ArrayBuffer]'
  ) {
    fail(`${label} must be an ArrayBuffer.`)
  }
  return value as ArrayBuffer
}

function requireStatistics(
  value: unknown,
  label: string,
  triangleBudget: number,
): GeometryStatistics {
  const statistics = requireRecord(value, `${label} statistics`)
  const vertices = requireInteger(statistics.vertices, `${label} vertices`)
  const triangles = requireInteger(statistics.triangles, `${label} triangles`)
  const meshes = requireInteger(statistics.meshes, `${label} meshes`)
  const materials = requireInteger(statistics.materials, `${label} materials`)
  if (triangles > triangleBudget) fail(`${label} exceeds its triangle budget.`)
  if (meshes > MAX_ASSET_MESHES) fail(`${label} exceeds its mesh budget.`)
  if (materials > MAX_ASSET_MATERIALS) fail(`${label} exceeds its material budget.`)
  return { vertices, triangles, meshes, materials }
}

function requireUniqueId(
  value: unknown,
  label: string,
  ids: Set<string>,
): string {
  const id = requireString(value, `${label} id`)
  if (ids.has(id)) fail(`Duplicate ${label} id: ${id}.`)
  ids.add(id)
  return id
}

function validateManifest(value: unknown): void {
  const manifest = requireRecord(value, 'manifest')
  if (manifest.format !== WORKCELL_PROJECT_FORMAT) fail('Unsupported project format.')
  if (manifest.schemaVersion !== WORKCELL_PROJECT_SCHEMA_VERSION) {
    fail('Unsupported project schema version.')
  }
  requireString(manifest.projectId, 'Project id')
  requireString(manifest.name, 'Project name')
  for (const field of ['createdAt', 'updatedAt'] as const) {
    const timestamp = requireString(manifest[field], `Project ${field}`)
    if (!Number.isFinite(Date.parse(timestamp))) fail(`Project ${field} is invalid.`)
  }
}

function validateRobot(value: unknown): {
  sourceBytes: number
  triangles: number
} {
  const robot = requireRecord(value, 'robot')
  requireString(robot.name, 'Robot name')
  requireTuple(robot.basePosition, 3, 'Robot base position')
  requireTuple(robot.baseRotationDeg, 3, 'Robot base rotation')

  const links = requireArray(robot.links, 'Robot links')
  if (links.length !== MAX_ROBOT_LINKS) {
    fail('A custom Robot must contain exactly seven Link STEP files.')
  }

  const linkIds = new Set<string>()
  let sourceBytes = 0
  let triangles = 0
  for (const [index, rawLink] of links.entries()) {
    const link = requireRecord(rawLink, `Robot link ${index}`)
    const linkId = requireString(link.linkId, `Robot link ${index} id`)
    if (!ROBOT_LINK_IDS.includes(linkId as RobotLinkId)) {
      fail(`Unsupported Robot link id: ${linkId}.`)
    }
    if (linkIds.has(linkId)) fail(`Duplicate Robot link id: ${linkId}.`)
    linkIds.add(linkId)
    requireString(link.sourceFileName, `${linkId} source filename`)
    const bytes = requireArrayBuffer(link.sourceBytes, `${linkId} source bytes`).byteLength
    if (bytes === 0) fail(`${linkId} STEP file is empty.`)
    if (bytes > MAX_ROBOT_LINK_BYTES) fail(`${linkId} exceeds the STEP byte budget.`)
    sourceBytes += bytes
    requireTransform(link.localTransform, `${linkId} local transform`)
    requireBoolean(link.visible, `${linkId} visibility`)
    requireTuple(link.collisionHalfExtents, 3, `${linkId} collision half extents`, true)
    const stats = requireStatistics(
      link.statistics,
      linkId,
      MAX_ROBOT_LINK_TRIANGLES,
    )
    triangles += stats.triangles
  }
  if (sourceBytes > MAX_ROBOT_BYTES) fail('Robot exceeds the total STEP byte budget.')
  if (triangles > MAX_ROBOT_TRIANGLES) fail('Robot exceeds the total triangle budget.')

  const joints = requireArray(robot.joints, 'Robot joints')
  if (joints.length !== JOINT_IDS.length) fail('Robot must contain exactly six joints.')
  joints.forEach((rawJoint, index) => {
    const joint = requireRecord(rawJoint, `Robot joint ${index}`)
    if (joint.id !== JOINT_IDS[index]) fail(`Robot joint ${index} must be ${JOINT_IDS[index]}.`)
    if (!linkIds.has(requireString(joint.parentLink, `${JOINT_IDS[index]} parent Link`))) {
      fail(`${JOINT_IDS[index]} parent Link is missing.`)
    }
    if (!linkIds.has(requireString(joint.childLink, `${JOINT_IDS[index]} child Link`))) {
      fail(`${JOINT_IDS[index]} child Link is missing.`)
    }
    requireTuple(joint.origin, 3, `${JOINT_IDS[index]} origin`)
    const axis = requireTuple(joint.axis, 3, `${JOINT_IDS[index]} axis`)
    if (Math.hypot(...axis) <= 1e-9) fail(`${JOINT_IDS[index]} axis cannot be zero.`)
    const minDeg = requireFinite(joint.minDeg, `${JOINT_IDS[index]} minimum`)
    const maxDeg = requireFinite(joint.maxDeg, `${JOINT_IDS[index]} maximum`)
    if (minDeg >= maxDeg) fail(`${JOINT_IDS[index]} limits are invalid.`)
    requirePositive(joint.maxVelocityDegPerSec, `${JOINT_IDS[index]} velocity`)
  })
  return { sourceBytes, triangles }
}

function validateAssets(value: unknown): {
  ids: Set<string>
  sourceBytes: number
  triangles: Map<string, number>
} {
  const assets = requireArray(value, 'Object Assets')
  const ids = new Set<string>()
  const triangles = new Map<string, number>()
  let sourceBytes = 0
  assets.forEach((rawAsset, index) => {
    const asset = requireRecord(rawAsset, `Object Asset ${index}`)
    const id = requireUniqueId(asset.id, 'Object Asset', ids)
    requireString(asset.name, `${id} name`)
    requireString(asset.sourceFileName, `${id} source filename`)
    const bytes = requireArrayBuffer(asset.sourceBytes, `${id} source bytes`).byteLength
    if (bytes === 0) fail(`${id} STEP file is empty.`)
    if (bytes > MAX_OBJECT_ASSET_BYTES) fail(`${id} exceeds the STEP byte budget.`)
    sourceBytes += bytes
    requirePositive(asset.importScale, `${id} import scale`)
    if (asset.originMode !== 'center' && asset.originMode !== 'source') {
      fail(`${id} origin mode is unsupported.`)
    }
    requireTuple(asset.collisionHalfExtents, 3, `${id} collision half extents`, true)
    const stats = requireStatistics(
      asset.statistics,
      `Object Asset ${id}`,
      MAX_OBJECT_ASSET_TRIANGLES,
    )
    triangles.set(id, stats.triangles)
  })
  return { ids, sourceBytes, triangles }
}

function validateInstances(
  value: unknown,
  assetIds: Set<string>,
  assetTriangles: Map<string, number>,
): number {
  const instances = requireArray(value, 'Object Instances')
  const ids = new Set<string>()
  let visibleTriangles = 0
  instances.forEach((rawInstance, index) => {
    const instance = requireRecord(rawInstance, `Object Instance ${index}`)
    const id = requireUniqueId(instance.id, 'Object Instance', ids)
    const assetId = requireString(instance.assetId, `${id} Object Asset id`)
    if (!assetIds.has(assetId)) {
      fail(`Object Instance ${id} references missing Object Asset ${assetId}.`)
    }
    requireString(instance.name, `${id} name`)
    requireTransform(instance.transform, `${id} transform`)
    requireFinite(instance.numericStatus, `${id} numeric status`)
    if (instance.statusSource !== 'manual' && instance.statusSource !== 'opcua') {
      fail(`${id} status source is unsupported.`)
    }
    requireBoolean(instance.statusOverlayVisible, `${id} status overlay visibility`)
    if (requireBoolean(instance.visible, `${id} visibility`)) {
      visibleTriangles += assetTriangles.get(assetId) ?? 0
    }
  })
  return visibleTriangles
}

function validatePoses(value: unknown): void {
  const poses = requireArray(value, 'Poses')
  const ids = new Set<string>()
  poses.forEach((rawPose, index) => {
    const pose = requireRecord(rawPose, `Pose ${index}`)
    const id = requireUniqueId(pose.id, 'Pose', ids)
    requireString(pose.name, `${id} name`)
    requireTuple(pose.anglesDeg, 6, `${id} joint angles`)
    requirePositive(pose.durationMs, `${id} duration`)
    if (pose.easing !== 'linear' && pose.easing !== 'easeInOut') {
      fail(`${id} easing is unsupported.`)
    }
    if (pose.speedPercentToNext !== undefined) {
      const speed = requireFinite(pose.speedPercentToNext, `${id} speed`)
      if (speed < 1 || speed > 100) fail(`${id} speed must be from 1 through 100.`)
    }
  })
}

function validateOpcUa(value: unknown, instanceIds: Set<string>): void {
  const opcUa = requireRecord(value, 'OPC UA configuration')
  requireString(opcUa.endpointUrl, 'OPC UA endpoint URL')
  requirePositive(opcUa.samplingIntervalMs, 'OPC UA sampling interval')
  const joints = requireArray(opcUa.joints, 'OPC UA joint bindings')
  if (joints.length !== JOINT_IDS.length) {
    fail('OPC UA configuration must contain exactly six joint bindings.')
  }
  joints.forEach((rawBinding, index) => {
    const binding = requireRecord(rawBinding, `OPC UA joint binding ${index}`)
    if (binding.id !== JOINT_IDS[index]) fail(`OPC UA joint binding ${index} is invalid.`)
    requireString(binding.nodeId, `${JOINT_IDS[index]} OPC UA NodeId`)
    requireFinite(binding.scale, `${JOINT_IDS[index]} OPC UA scale`)
    requireFinite(binding.offset, `${JOINT_IDS[index]} OPC UA offset`)
  })
  requireArray(opcUa.equipment, 'OPC UA equipment bindings').forEach(
    (rawBinding, index) => {
      const binding = requireRecord(rawBinding, `OPC UA equipment binding ${index}`)
      const instanceId = requireString(binding.instanceId, 'OPC UA equipment instance id')
      if (!instanceIds.has(instanceId)) {
        fail(`OPC UA binding references missing Object Instance ${instanceId}.`)
      }
      requireString(binding.nodeId, `${instanceId} OPC UA NodeId`)
      requireFinite(binding.scale, `${instanceId} OPC UA scale`)
      requireFinite(binding.offset, `${instanceId} OPC UA offset`)
    },
  )
}

export function validateWorkcellProjectSnapshot(
  value: unknown,
): WorkcellProjectSnapshotV1 {
  const snapshot = requireRecord(value, 'project')
  validateManifest(snapshot.manifest)
  const robot = validateRobot(snapshot.robot)

  const frames = requireRecord(snapshot.frames, 'coordinate frames')
  requireTransform(frames.mcp, 'MCP frame')
  requireTransform(frames.tcp, 'TCP frame')

  const assets = validateAssets(snapshot.objectAssets)
  const visibleObjectTriangles = validateInstances(
    snapshot.objectInstances,
    assets.ids,
    assets.triangles,
  )
  if (robot.triangles + visibleObjectTriangles > MAX_SCENE_TRIANGLES) {
    fail('Visible Scene exceeds the triangle budget.')
  }
  if (robot.sourceBytes + assets.sourceBytes > MAX_PROJECT_SOURCE_BYTES) {
    fail('Project exceeds the raw STEP byte budget.')
  }

  validatePoses(snapshot.poses)
  const instanceIds = new Set(
    requireArray(snapshot.objectInstances, 'Object Instances').map((instance, index) =>
      requireString(requireRecord(instance, `Object Instance ${index}`).id, 'Object Instance id'),
    ),
  )
  validateOpcUa(snapshot.opcUa, instanceIds)
  return value as WorkcellProjectSnapshotV1
}
