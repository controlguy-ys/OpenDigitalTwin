import { failProjectV5 } from './errors.js'
import {
  BOX_PRIMITIVE_TRIANGLES_V5,
  CYLINDER_PRIMITIVE_TRIANGLES_V5,
  DEFAULT_OPC_UA_PUBLISHING_INTERVAL_MS_V5,
  MAX_IMPORTED_OBJECT_STEP_ASSETS_V5,
  MAX_JOB_SPEED_PERCENT_V5,
  MAX_JOB_STEPS_PER_JOB_V5,
  MAX_JOB_TIMER_MS_V5,
  MAX_JOBS_V5,
  MAX_LOGICAL_SIGNALS_V5,
  MAX_MOVING_FRAMES_PER_ENTITY_V5,
  MAX_OBJECT_STEP_BYTES_V5,
  MAX_OBJECT_STEP_TRIANGLES_V5,
  MAX_OPC_UA_ENDPOINTS_V5,
  MAX_OPC_UA_EXPANDED_LEAVES_PER_ENDPOINT_V5,
  MAX_OPC_UA_EXPANDED_LEAVES_PER_STRUCTURE_V5,
  MAX_OPC_UA_EXPANDED_LEAVES_V5,
  MAX_OPC_UA_FIXED_ARRAY_ELEMENTS_V5,
  MAX_OPC_UA_LEAF_UPDATES_PER_SECOND_V5,
  MAX_OPC_UA_STRUCTURE_DEPTH_V5,
  MAX_OPC_UA_STRUCTURE_ROOTS_PER_ENDPOINT_V5,
  MAX_OPC_UA_STRUCTURE_ROOTS_V5,
  MAX_PROJECT_FRAMES_V5,
  MAX_REFERENCED_STEP_BYTES_V5,
  MAX_ROBOT_CONTROLLERS_V5,
  MAX_ROBOT_DEFINITION_STEP_BYTES_V5,
  MAX_ROBOT_DEFINITION_TRIANGLES_V5,
  MAX_ROBOT_DEFINITIONS_V5,
  MAX_ROBOT_INSTANCES_V5,
  MAX_ROBOT_JOINTS_V5,
  MAX_ROBOT_LINKS_V5,
  MAX_ROBOT_STEP_SOURCES_V5,
  MAX_SCENE_GROUPS_V5,
  MAX_SPATIAL_ENTITIES_V5,
  MAX_TOTAL_JOB_STEPS_V5,
  MAX_VISIBLE_SCENE_TRIANGLES_V5,
  MIN_JOB_SPEED_PERCENT_V5,
  MIN_OPC_UA_PUBLISHING_INTERVAL_MS_V5,
  MIN_ROBOT_JOINTS_V5,
  MIN_ROBOT_LINKS_V5,
  MIN_ROBOT_STEP_SOURCES_V5,
} from './limits.js'
import { opcUaNodeAddressKeyV1, type OpcUaNodeAddressV1 } from './opcua-node-address.js'
import type {
  AssetReferenceV5,
  FrameDefinitionV5,
  LogicalSignalV1,
  OpcUaEndpointV5,
  OpcUaMappingLeafV5,
  OpcUaMappingV5,
  OpcUaProjectTargetV5,
  RobotControllerV5,
  RobotDefinitionV5,
  RobotInstanceV5,
  SpatialEntityV5,
  WorkcellProjectV5,
} from './types.js'

const FRAME_PROJECT_PATHS_V5 = Object.freeze([
  ['positionM', 0], ['positionM', 1], ['positionM', 2],
  ['rpyDegrees', 0], ['rpyDegrees', 1], ['rpyDegrees', 2],
] as const)

const OPCUA_OWNERSHIP_PREFIX = 'opcua:'

interface DefinitionFacts {
  readonly definition: RobotDefinitionV5
  readonly joints: ReadonlyMap<string, RobotDefinitionV5['joints'][number]>
  readonly frames: ReadonlyMap<string, FrameDefinitionV5>
  readonly triangleCount: number
}

interface EntityFacts {
  readonly entity: SpatialEntityV5
  readonly graspFrames: ReadonlyMap<string, SpatialEntityV5['graspFrames'][number]>
  readonly movingFrames: ReadonlyMap<string, SpatialEntityV5['movingFrames'][number]>
}

interface GlobalFrameFacts {
  readonly frames: ReadonlyMap<string, { readonly path: string }>
}

interface ProjectIndexes {
  readonly assets: ReadonlyMap<string, AssetReferenceV5>
  readonly controllers: ReadonlyMap<string, RobotControllerV5>
  readonly definitions: ReadonlyMap<string, DefinitionFacts>
  readonly robots: ReadonlyMap<string, RobotInstanceV5>
  readonly entities: ReadonlyMap<string, EntityFacts>
  readonly groups: ReadonlyMap<string, WorkcellProjectV5['sceneGroups'][number]>
  readonly signals: ReadonlyMap<string, LogicalSignalV1>
  readonly jobs: ReadonlyMap<string, WorkcellProjectV5['jobs'][number]>
  readonly endpoints: ReadonlyMap<string, OpcUaEndpointV5>
  readonly mappings: ReadonlyMap<string, OpcUaMappingV5>
  readonly globalFrames: GlobalFrameFacts
}

interface LeafPathTreeNode {
  childKind?: 'named' | 'numeric'
  readonly children: Map<string, LeafPathTreeNode>
  terminal: boolean
}

function fail(code: string, path: string, message: string): never {
  return failProjectV5(code, path, message)
}

function enforceMaximum(length: number, maximum: number, path: string, code: string): void {
  if (length > maximum) fail(code, path, `Maximum is ${maximum}; received ${length}.`)
}

function requireSafeIntegerInRange(value: number, minimum: number, maximum: number, path: string, code: string): void {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    fail(code, path, `Expected an integer in ${minimum}..${maximum}.`)
  }
}

function requireReference<T>(
  values: ReadonlyMap<string, T>,
  id: string,
  path: string,
  code: string,
  label: string,
): T {
  const value = values.get(id)
  if (value === undefined) fail(code, path, `${label} ${id} does not exist.`)
  return value
}

function uniqueMap<T>(
  values: readonly T[],
  idOf: (value: T) => string,
  path: string,
  keyField = 'id',
): ReadonlyMap<string, T> {
  const result = new Map<string, T>()
  values.forEach((value, index) => {
    const id = idOf(value)
    if (result.has(id)) fail('PROJECT_ID_DUPLICATE', `${path}[${index}].${keyField}`, `Duplicate persisted id ${id}.`)
    result.set(id, value)
  })
  return result
}

function detectParentCycles(
  parents: ReadonlyMap<string, string | null>,
  paths: ReadonlyMap<string, string>,
  code: string,
): void {
  const states = new Map<string, 'visiting' | 'done'>()
  const visit = (id: string): void => {
    const state = states.get(id)
    if (state === 'visiting') fail(code, paths.get(id) ?? '$', `Parent cycle includes ${id}.`)
    if (state === 'done') return
    states.set(id, 'visiting')
    const parent = parents.get(id)
    if (parent !== undefined && parent !== null) visit(parent)
    states.set(id, 'done')
  }
  for (const id of parents.keys()) visit(id)
}

function ownershipEndpointId(ownership: string): string | undefined {
  return ownership.startsWith(OPCUA_OWNERSHIP_PREFIX) ? ownership.slice(OPCUA_OWNERSHIP_PREFIX.length) : undefined
}

function validateOwnershipReference(
  ownership: string,
  endpoints: ReadonlyMap<string, OpcUaEndpointV5>,
  path: string,
): void {
  const endpointId = ownershipEndpointId(ownership)
  if (endpointId !== undefined) {
    requireReference(endpoints, endpointId, path, 'OPCUA_ENDPOINT_NOT_FOUND', 'OPC UA endpoint')
  }
}

function createLeafPathTreeNode(): LeafPathTreeNode {
  return { children: new Map<string, LeafPathTreeNode>(), terminal: false }
}

function validatePathSegments(
  segments: readonly (string | number)[],
  path: string,
): readonly (string | number)[] {
  enforceMaximum(segments.length, MAX_OPC_UA_STRUCTURE_DEPTH_V5, path, 'OPCUA_STRUCTURE_DEPTH_LIMIT_EXCEEDED')
  segments.forEach((segment, index) => {
    if (typeof segment === 'number') {
      if (Object.is(segment, -0)) fail('OPCUA_PATH_INVALID', `${path}[${index}]`, 'OPC UA path segments must not use negative zero.')
      requireSafeIntegerInRange(segment, 0, Number.MAX_SAFE_INTEGER, `${path}[${index}]`, 'OPCUA_PATH_INVALID')
    }
  })
  return segments
}

function insertLeafPath(
  root: LeafPathTreeNode,
  segments: readonly (string | number)[],
  path: string,
): void {
  let node = root
  for (const segment of segments) {
    if (node.terminal) {
      fail('OPCUA_LEAF_PATH_TREE_INVALID', path, 'A Mapping Leaf path cannot descend from another terminal Leaf.')
    }
    const childKind = typeof segment === 'string' ? 'named' : 'numeric'
    if (node.childKind !== undefined && node.childKind !== childKind) {
      fail('OPCUA_LEAF_PATH_TREE_INVALID', path, 'One Mapping container cannot mix named and numeric children.')
    }
    node.childKind = childKind
    const key = `${childKind}:${segment}`
    const child = node.children.get(key) ?? createLeafPathTreeNode()
    node.children.set(key, child)
    node = child
  }
  if (node.children.size !== 0 || node.terminal) {
    fail('OPCUA_LEAF_PATH_TREE_INVALID', path, 'A Mapping Leaf path is duplicated or an ancestor of another Leaf.')
  }
  node.terminal = true
}

function validateFixedArrayIndexes(
  indexesByPrefix: ReadonlyMap<string, ReadonlySet<number>>,
  path: string,
): void {
  for (const [prefix, indexes] of indexesByPrefix) {
    const sorted = [...indexes].sort((left, right) => left - right)
    const size = (sorted.at(-1) ?? -1) + 1
    if (size > MAX_OPC_UA_FIXED_ARRAY_ELEMENTS_V5) {
      fail('OPCUA_FIXED_ARRAY_LIMIT_EXCEEDED', path, `Fixed array at ${prefix} exceeds ${MAX_OPC_UA_FIXED_ARRAY_ELEMENTS_V5} elements.`)
    }
  }
}

function genericOpcUaDataTypeProjectType(opcUaDataType: OpcUaMappingLeafV5['opcUaDataType']): OpcUaMappingLeafV5['projectDataType'] {
  if (opcUaDataType === 'Boolean') return 'boolean'
  if (opcUaDataType === 'Float' || opcUaDataType === 'Double') return 'number'
  if (opcUaDataType === 'String') return 'string'
  return 'integer'
}

function validateGenericDataTypePair(leaf: OpcUaMappingLeafV5, path: string): void {
  const expected = genericOpcUaDataTypeProjectType(leaf.opcUaDataType)
  if (leaf.projectDataType !== expected) {
    fail('OPCUA_DATA_TYPE_MISMATCH', `${path}.projectDataType`, `${leaf.opcUaDataType} requires Project scalar type ${expected}.`)
  }
}

function targetKey(target: OpcUaProjectTargetV5): string {
  if (target.type === 'logical-signal') return JSON.stringify(['logical-signal', target.signalId])
  if (target.type === 'robot-joint') return JSON.stringify(['robot-joint', target.robotId, target.jointId])
  if (target.type === 'robot-frame') return JSON.stringify(['robot-frame', target.robotId, target.frameId])
  if (target.type === 'robot-status') return JSON.stringify(['robot-status', target.robotId])
  if (target.type === 'entity-frame') return JSON.stringify(['entity-frame', target.entityId, target.frameId])
  return JSON.stringify(['entity-status', target.entityId])
}

function pathKey(path: readonly (string | number)[]): string {
  return JSON.stringify(path)
}

function effectiveLeafNodeAddressV1(
  mapping: OpcUaMappingV5,
  leaf: OpcUaMappingLeafV5,
): OpcUaNodeAddressV1 {
  return leaf.nodeAddress ?? mapping.nodeAddress
}

function validateFrameProjectPaths(leaves: readonly OpcUaMappingLeafV5[], path: string): void {
  const expected = new Set(FRAME_PROJECT_PATHS_V5.map(pathKey))
  const received = new Set(leaves.map((leaf) => pathKey(leaf.projectPath)))
  if (received.size !== leaves.length || received.size !== expected.size || [...received].some((key) => !expected.has(key))) {
    fail('OPCUA_PROJECT_PATH_INVALID', `${path}.leaves`, 'Frame Mapping requires each canonical positionM and rpyDegrees destination exactly once.')
  }
}

function validateProjectPath(target: OpcUaProjectTargetV5, leaf: OpcUaMappingLeafV5, path: string): void {
  if (
    target.type === 'logical-signal'
    || target.type === 'robot-joint'
    || target.type === 'robot-status'
    || target.type === 'entity-status'
  ) {
    if (leaf.projectPath.length !== 0) {
      fail('OPCUA_PROJECT_PATH_INVALID', `${path}.projectPath`, 'This Mapping target requires an empty Project path.')
    }
    return
  }
  const valid = FRAME_PROJECT_PATHS_V5.some((expected) => pathKey(expected) === pathKey(leaf.projectPath))
  if (!valid) {
    fail('OPCUA_PROJECT_PATH_INVALID', `${path}.projectPath`, 'Frame Mapping Project path is not canonical.')
  }
}

function validateNumericTargetDataType(target: OpcUaProjectTargetV5, leaf: OpcUaMappingLeafV5, path: string): void {
  if (target.type === 'logical-signal') return
  if (
    leaf.opcUaDataType === 'Boolean'
    || leaf.opcUaDataType === 'String'
    || (leaf.projectDataType !== 'integer' && leaf.projectDataType !== 'number')
  ) {
    fail('OPCUA_DATA_TYPE_MISMATCH', `${path}.opcUaDataType`, 'This Project target requires a numeric OPC UA scalar.')
  }
}

function validateSignalMapping(
  direction: OpcUaMappingV5['direction'],
  leaf: OpcUaMappingLeafV5,
  signal: LogicalSignalV1,
): void {
  const dataTypes = { Boolean: 'Boolean', Int32: 'Int32', UInt32: 'UInt32', Double: 'Double', String: 'String' } as const
  const reject = (code: string): never => fail(code, '$.opcUa.mappings', 'Logical Signal Mapping is incompatible.')
  if (leaf.opcUaDataType !== dataTypes[signal.dataType]) reject('OPCUA_DATA_TYPE_MISMATCH')
  if (direction === 'read' && signal.direction !== 'input' && signal.direction !== 'bidirectional') reject('OPCUA_SIGNAL_DIRECTION_MISMATCH')
  if (direction === 'write' && signal.direction !== 'output' && signal.direction !== 'bidirectional') reject('OPCUA_SIGNAL_DIRECTION_MISMATCH')
  if (direction === 'readWrite' && signal.direction !== 'bidirectional') reject('OPCUA_SIGNAL_DIRECTION_MISMATCH')
  if ((signal.dataType === 'Boolean' || signal.dataType === 'String') && (leaf.scale !== 1 || leaf.offset !== 0)) {
    reject('OPCUA_SCALE_NOT_APPLICABLE')
  }
}

function validateDefinitionFrames(definition: RobotDefinitionV5, path: string): ReadonlyMap<string, FrameDefinitionV5> {
  const links = uniqueMap(definition.links, (link) => link.id, `${path}.links`)
  const frames = uniqueMap(definition.frames, (frame) => frame.id, `${path}.frames`)
  const parents = new Map<string, string | null>()
  const paths = new Map<string, string>()
  definition.frames.forEach((frame, index) => {
    const framePath = `${path}.frames[${index}].parentFrameId`
    paths.set(frame.id, framePath)
    if (frame.parentFrameId === null) {
      fail('FRAME_PARENT_NOT_FOUND', framePath, 'Robot Definition Frame must parent a local Link or Frame.')
    }
    if (links.has(frame.parentFrameId)) {
      parents.set(frame.id, null)
    } else if (frames.has(frame.parentFrameId)) {
      parents.set(frame.id, frame.parentFrameId)
    } else {
      fail('FRAME_PARENT_NOT_FOUND', framePath, `Definition-local parent ${frame.parentFrameId} does not exist.`)
    }
  })
  detectParentCycles(parents, paths, 'FRAME_CYCLE')
  return frames
}

function validateDefinitionJointChain(definition: RobotDefinitionV5, path: string): ReadonlyMap<string, RobotDefinitionV5['joints'][number]> {
  const links = uniqueMap(definition.links, (link) => link.id, `${path}.links`)
  const joints = uniqueMap(definition.joints, (joint) => joint.id, `${path}.joints`)
  const inbound = new Map([...links.keys()].map((id) => [id, 0]))
  const outbound = new Map([...links.keys()].map((id) => [id, 0]))
  const childByParent = new Map<string, string>()
  definition.joints.forEach((joint, index) => {
    const jointPath = `${path}.joints[${index}]`
    if (!links.has(joint.parentLinkId)) fail('ROBOT_LINK_NOT_FOUND', `${jointPath}.parentLinkId`, 'Joint parent Link does not exist.')
    if (!links.has(joint.childLinkId)) fail('ROBOT_LINK_NOT_FOUND', `${jointPath}.childLinkId`, 'Joint child Link does not exist.')
    if (joint.parentLinkId === joint.childLinkId) fail('ROBOT_JOINT_CHAIN_INVALID', jointPath, 'Joint cannot connect a Link to itself.')
    const nextOutbound = (outbound.get(joint.parentLinkId) ?? 0) + 1
    const nextInbound = (inbound.get(joint.childLinkId) ?? 0) + 1
    if (nextOutbound > 1 || nextInbound > 1) fail('ROBOT_JOINT_CHAIN_INVALID', jointPath, 'Robot Joint graph must be serial.')
    outbound.set(joint.parentLinkId, nextOutbound)
    inbound.set(joint.childLinkId, nextInbound)
    childByParent.set(joint.parentLinkId, joint.childLinkId)
  })
  const roots = [...links.keys()].filter((id) => inbound.get(id) === 0)
  const tips = [...links.keys()].filter((id) => outbound.get(id) === 0)
  if (roots.length !== 1 || tips.length !== 1) fail('ROBOT_JOINT_CHAIN_INVALID', `${path}.joints`, 'Robot Joint graph must have one root and one tip.')
  const visited = new Set<string>()
  let current: string | undefined = roots[0]
  while (current !== undefined && !visited.has(current)) {
    visited.add(current)
    current = childByParent.get(current)
  }
  if (visited.size !== links.size || current !== undefined) {
    fail('ROBOT_JOINT_CHAIN_INVALID', `${path}.joints`, 'Robot Joint graph must be connected and acyclic.')
  }
  return joints
}

function definitionFacts(
  definition: RobotDefinitionV5,
  index: number,
  assets: ReadonlyMap<string, AssetReferenceV5>,
  referencedAssetIds: Set<string>,
): DefinitionFacts {
  const path = `$.robotDefinitions[${index}]`
  enforceMaximum(definition.assetReferenceIds.length, MAX_ROBOT_STEP_SOURCES_V5, `${path}.assetReferenceIds`, 'ROBOT_STEP_SOURCE_LIMIT_EXCEEDED')
  if (definition.assetReferenceIds.length < MIN_ROBOT_STEP_SOURCES_V5) {
    fail('ROBOT_STEP_SOURCE_LIMIT_EXCEEDED', `${path}.assetReferenceIds`, 'At least one Robot STEP source is required.')
  }
  enforceMaximum(definition.joints.length, MAX_ROBOT_JOINTS_V5, `${path}.joints`, 'ROBOT_JOINT_LIMIT_EXCEEDED')
  if (definition.joints.length < MIN_ROBOT_JOINTS_V5) fail('ROBOT_JOINT_LIMIT_EXCEEDED', `${path}.joints`, 'At least one Joint is required.')
  enforceMaximum(definition.links.length, MAX_ROBOT_LINKS_V5, `${path}.links`, 'ROBOT_LINK_LIMIT_EXCEEDED')
  if (definition.links.length < MIN_ROBOT_LINKS_V5) fail('ROBOT_LINK_LIMIT_EXCEEDED', `${path}.links`, 'At least two Links are required.')

  const sourceIds = new Set(definition.assetReferenceIds)
  if (sourceIds.size !== definition.assetReferenceIds.length) fail('PROJECT_ID_DUPLICATE', `${path}.assetReferenceIds`, 'Robot STEP source IDs must be unique.')
  const conventionKeys = Object.keys(definition.sourceConventions)
  if (conventionKeys.length !== sourceIds.size || conventionKeys.some((id) => !sourceIds.has(id))) {
    fail('SOURCE_CONVENTION_KEY_MISMATCH', `${path}.sourceConventions`, 'Source conventions must have exactly the Robot source ID key set.')
  }
  let sourceBytes = 0
  definition.assetReferenceIds.forEach((assetId, sourceIndex) => {
    const asset = requireReference(assets, assetId, `${path}.assetReferenceIds[${sourceIndex}]`, 'ASSET_REFERENCE_NOT_FOUND', 'Asset reference')
    if (asset.byteLength === 0) fail('ASSET_REFERENCE_NOT_FOUND', `${path}.assetReferenceIds[${sourceIndex}]`, 'Referenced STEP source must have positive byte length.')
    sourceBytes += asset.byteLength
    referencedAssetIds.add(asset.id)
  })
  if (sourceBytes > MAX_ROBOT_DEFINITION_STEP_BYTES_V5) {
    fail('ROBOT_DEFINITION_STEP_BYTE_LIMIT_EXCEEDED', path, 'Robot Definition STEP bytes exceed the configured budget.')
  }

  let triangleCount = 0
  const occurrences = new Set<string>()
  definition.links.forEach((link, linkIndex) => {
    link.geometryOccurrences.forEach((occurrence, occurrenceIndex) => {
      const occurrencePath = `${path}.links[${linkIndex}].geometryOccurrences[${occurrenceIndex}]`
      if (!sourceIds.has(occurrence.assetReferenceId)) {
        fail('ASSET_REFERENCE_NOT_FOUND', `${occurrencePath}.assetReferenceId`, 'Robot Geometry occurrence must use one of its Definition sources.')
      }
      requireReference(assets, occurrence.assetReferenceId, `${occurrencePath}.assetReferenceId`, 'ASSET_REFERENCE_NOT_FOUND', 'Asset reference')
      if (occurrences.has(occurrence.occurrenceKey)) fail('GEOMETRY_OCCURRENCE_DUPLICATE', `${occurrencePath}.occurrenceKey`, 'Geometry occurrence is included more than once.')
      occurrences.add(occurrence.occurrenceKey)
      triangleCount += occurrence.statistics.triangles
    })
  })
  if (triangleCount > MAX_ROBOT_DEFINITION_TRIANGLES_V5) {
    fail('ROBOT_DEFINITION_TRIANGLE_LIMIT_EXCEEDED', path, 'Robot Definition triangles exceed the configured budget.')
  }

  const joints = validateDefinitionJointChain(definition, path)
  const frames = validateDefinitionFrames(definition, path)
  return { definition, joints, frames, triangleCount }
}

function globalFrameFacts(project: WorkcellProjectV5): GlobalFrameFacts {
  const sceneFrames = uniqueMap(project.scene.frames, (frame) => frame.id, '$.scene.frames')
  const worldFrames = project.scene.frames.filter((frame) => frame.role === 'world')
  if (worldFrames.length !== 1 || worldFrames[0]?.parentFrameId !== null) {
    fail('WORLD_FRAME_INVALID', '$.scene.frames', 'Scene requires exactly one parentless world Frame.')
  }
  if (!project.scene.frames.some((frame) => frame.role === 'mcp')) {
    fail('MCP_FRAME_NOT_FOUND', '$.scene.frames', 'Scene requires at least one MCP Frame.')
  }

  const parents = new Map<string, string | null>()
  const paths = new Map<string, string>()
  project.scene.frames.forEach((frame, index) => {
    const path = `$.scene.frames[${index}].parentFrameId`
    paths.set(frame.id, path)
    if (frame.role !== 'world' && frame.parentFrameId === null) {
      fail('FRAME_PARENT_NOT_FOUND', path, 'Only the world Scene Frame may have a null parent.')
    }
    if (frame.parentFrameId !== null && !sceneFrames.has(frame.parentFrameId)) {
      fail('FRAME_PARENT_NOT_FOUND', path, `Scene Frame parent ${frame.parentFrameId} does not exist.`)
    }
    parents.set(frame.id, frame.parentFrameId)
  })
  detectParentCycles(parents, paths, 'FRAME_CYCLE')

  const frames = new Map<string, { path: string }>()
  project.scene.frames.forEach((frame, index) => frames.set(frame.id, { path: `$.scene.frames[${index}].id` }))
  project.spatialEntities.forEach((entity, entityIndex) => {
    entity.graspFrames.forEach((frame, frameIndex) => {
      const path = `$.spatialEntities[${entityIndex}].graspFrames[${frameIndex}].frameId`
      if (frames.has(frame.frameId)) fail('PROJECT_ID_DUPLICATE', path, `Duplicate global Frame id ${frame.frameId}.`)
      frames.set(frame.frameId, { path })
      parents.set(frame.frameId, entity.parentFrameId)
      paths.set(frame.frameId, path)
    })
    entity.movingFrames.forEach((frame, frameIndex) => {
      const path = `$.spatialEntities[${entityIndex}].movingFrames[${frameIndex}].parentFrameId`
      if (frames.has(frame.frameId)) fail('PROJECT_ID_DUPLICATE', `${path.slice(0, -'.parentFrameId'.length)}.frameId`, `Duplicate global Frame id ${frame.frameId}.`)
      frames.set(frame.frameId, { path })
      parents.set(frame.frameId, frame.parentFrameId)
      paths.set(frame.frameId, path)
    })
  })
  for (const [frameId, parentId] of parents) {
    if (parentId !== null && !frames.has(parentId)) {
      fail('FRAME_PARENT_NOT_FOUND', paths.get(frameId) ?? '$', `Frame parent ${parentId} does not exist.`)
    }
  }
  detectParentCycles(parents, paths, 'FRAME_CYCLE')
  return { frames }
}

function createProjectIndexes(project: WorkcellProjectV5): ProjectIndexes {
  const frameCount = project.scene.frames.length
    + project.robotDefinitions.reduce((sum, definition) => sum + definition.frames.length, 0)
    + project.spatialEntities.reduce((sum, entity) => sum + entity.graspFrames.length + entity.movingFrames.length, 0)
  enforceMaximum(frameCount, MAX_PROJECT_FRAMES_V5, '$', 'PROJECT_FRAME_LIMIT_EXCEEDED')
  enforceMaximum(project.controllers.length, MAX_ROBOT_CONTROLLERS_V5, '$.controllers', 'ROBOT_CONTROLLER_LIMIT_EXCEEDED')
  enforceMaximum(project.robotDefinitions.length, MAX_ROBOT_DEFINITIONS_V5, '$.robotDefinitions', 'ROBOT_DEFINITION_LIMIT_EXCEEDED')
  enforceMaximum(project.robots.length, MAX_ROBOT_INSTANCES_V5, '$.robots', 'ROBOT_INSTANCE_LIMIT_EXCEEDED')
  enforceMaximum(project.spatialEntities.length, MAX_SPATIAL_ENTITIES_V5, '$.spatialEntities', 'SPATIAL_ENTITY_LIMIT_EXCEEDED')
  enforceMaximum(project.sceneGroups.length, MAX_SCENE_GROUPS_V5, '$.sceneGroups', 'SCENE_GROUP_LIMIT_EXCEEDED')
  enforceMaximum(project.logicalSignals.length, MAX_LOGICAL_SIGNALS_V5, '$.logicalSignals', 'LOGICAL_SIGNAL_LIMIT_EXCEEDED')
  enforceMaximum(project.jobs.length, MAX_JOBS_V5, '$.jobs', 'JOB_LIMIT_EXCEEDED')
  enforceMaximum(project.opcUa.endpoints.length, MAX_OPC_UA_ENDPOINTS_V5, '$.opcUa.endpoints', 'OPCUA_ENDPOINT_LIMIT_EXCEEDED')
  enforceMaximum(project.opcUa.mappings.length, MAX_OPC_UA_STRUCTURE_ROOTS_V5, '$.opcUa.mappings', 'OPCUA_STRUCTURE_ROOT_LIMIT_EXCEEDED')

  const assets = uniqueMap(project.assetReferences, (asset) => asset.id, '$.assetReferences')
  const controllers = uniqueMap(project.controllers, (controller) => controller.id, '$.controllers')
  const robots = uniqueMap(project.robots, (robot) => robot.id, '$.robots')
  const groups = uniqueMap(project.sceneGroups, (group) => group.id, '$.sceneGroups')
  const signals = uniqueMap(project.logicalSignals, (signal) => signal.id, '$.logicalSignals')
  const jobs = uniqueMap(project.jobs, (job) => job.id, '$.jobs')
  const endpoints = uniqueMap(project.opcUa.endpoints, (endpoint) => endpoint.endpointId, '$.opcUa.endpoints', 'endpointId')
  const mappings = uniqueMap(project.opcUa.mappings, (mapping) => mapping.id, '$.opcUa.mappings')

  const referencedAssetIds = new Set<string>()
  const definitionRecords = uniqueMap(project.robotDefinitions, (definition) => definition.id, '$.robotDefinitions')
  const definitions = new Map<string, DefinitionFacts>()
  project.robotDefinitions.forEach((definition, index) => {
    definitions.set(definition.id, definitionFacts(definition, index, assets, referencedAssetIds))
  })

  const entityRecords = uniqueMap(project.spatialEntities, (entity) => entity.id, '$.spatialEntities')
  const entities = new Map<string, EntityFacts>()
  project.spatialEntities.forEach((entity, index) => {
    const path = `$.spatialEntities[${index}]`
    enforceMaximum(entity.movingFrames.length, MAX_MOVING_FRAMES_PER_ENTITY_V5, `${path}.movingFrames`, 'MOVING_FRAME_LIMIT_EXCEEDED')
    const graspFrames = uniqueMap(entity.graspFrames, (frame) => frame.frameId, `${path}.graspFrames`, 'frameId')
    const movingFrames = uniqueMap(entity.movingFrames, (frame) => frame.frameId, `${path}.movingFrames`, 'frameId')
    for (const frameId of graspFrames.keys()) {
      if (movingFrames.has(frameId)) fail('PROJECT_ID_DUPLICATE', `${path}.movingFrames`, `Duplicate Entity Frame id ${frameId}.`)
    }
    entities.set(entity.id, { entity, graspFrames, movingFrames })
  })
  if (entityRecords.size !== entities.size || definitionRecords.size !== definitions.size) {
    fail('PROJECT_ID_DUPLICATE', '$', 'Project indexes are inconsistent.')
  }

  return {
    assets,
    controllers,
    definitions,
    robots,
    entities,
    groups,
    signals,
    jobs,
    endpoints,
    mappings,
    globalFrames: globalFrameFacts(project),
  }
}

function validateGroupGraph(project: WorkcellProjectV5, groups: ReadonlyMap<string, WorkcellProjectV5['sceneGroups'][number]>): ReadonlyMap<string, boolean> {
  const parents = new Map<string, string | null>()
  const paths = new Map<string, string>()
  project.sceneGroups.forEach((group, index) => {
    const path = `$.sceneGroups[${index}].parentGroupId`
    if (group.parentGroupId !== null && !groups.has(group.parentGroupId)) {
      fail('SCENE_GROUP_NOT_FOUND', path, `Scene Group ${group.parentGroupId} does not exist.`)
    }
    parents.set(group.id, group.parentGroupId)
    paths.set(group.id, path)
  })
  detectParentCycles(parents, paths, 'SCENE_GROUP_CYCLE')
  const visibility = new Map<string, boolean>()
  const resolve = (id: string): boolean => {
    const cached = visibility.get(id)
    if (cached !== undefined) return cached
    const group = groups.get(id)!
    const visible = group.visible && (group.parentGroupId === null || resolve(group.parentGroupId))
    visibility.set(id, visible)
    return visible
  }
  for (const id of groups.keys()) resolve(id)
  return visibility
}

function expectExactJointValues(
  values: Readonly<Record<string, number>>,
  facts: DefinitionFacts,
  path: string,
): void {
  const ids = Object.keys(values)
  if (ids.length !== facts.joints.size || ids.some((id) => !facts.joints.has(id))) {
    fail('ROBOT_JOINT_SET_MISMATCH', path, 'Joint value keys must exactly match the selected Robot Definition.')
  }
  for (const [id, value] of Object.entries(values)) {
    const joint = facts.joints.get(id)!
    if (value < joint.min || value > joint.max) {
      fail('ROBOT_JOINT_VALUE_OUT_OF_RANGE', `${path}.${id}`, `Joint value must be within ${joint.min}..${joint.max}.`)
    }
  }
}

function validateRobotReferences(project: WorkcellProjectV5, indexes: ProjectIndexes): number {
  const controllerReferences = new Set<string>()
  let visibleTriangles = 0
  project.robots.forEach((robot, index) => {
    const path = `$.robots[${index}]`
    const definition = requireReference(indexes.definitions, robot.definitionId, `${path}.definitionId`, 'ROBOT_DEFINITION_NOT_FOUND', 'Robot Definition')
    requireReference(indexes.controllers, robot.controllerId, `${path}.controllerId`, 'ROBOT_CONTROLLER_NOT_FOUND', 'Robot Controller')
    controllerReferences.add(robot.controllerId)
    if (!indexes.globalFrames.frames.has(robot.baseParentFrameId)) {
      fail('FRAME_PARENT_NOT_FOUND', `${path}.baseParentFrameId`, `Base parent Frame ${robot.baseParentFrameId} does not exist.`)
    }
    expectExactJointValues(robot.initialJointValues, definition, `${path}.initialJointValues`)
    const sourceKeys = Object.keys(robot.frameSources)
    if (sourceKeys.length !== definition.frames.size || sourceKeys.some((id) => !definition.frames.has(id))) {
      fail('ROBOT_FRAME_SOURCE_SET_MISMATCH', `${path}.frameSources`, 'Frame sources must exactly match Definition Frame IDs.')
    }
    validateOwnershipReference(robot.jointSource, indexes.endpoints, `${path}.jointSource`)
    Object.entries(robot.frameSources).forEach(([frameId, ownership]) => {
      validateOwnershipReference(ownership, indexes.endpoints, `${path}.frameSources.${frameId}`)
    })
    validateOwnershipReference(robot.numericStatus.sourceOwnership, indexes.endpoints, `${path}.numericStatus.sourceOwnership`)
    if (!definition.frames.has(robot.selectedToolFrameId)) {
      fail('ROBOT_FRAME_NOT_FOUND', `${path}.selectedToolFrameId`, 'Selected Tool Frame does not belong to the Robot Definition.')
    }
    const tcp = definition.frames.get(robot.selectedTcpFrameId)
    if (tcp === undefined || tcp.role !== 'tcp') {
      fail('ROBOT_FRAME_NOT_FOUND', `${path}.selectedTcpFrameId`, 'Selected TCP Frame is invalid.')
    }
    if (robot.numericStatus.overlay.frameId !== null && !definition.frames.has(robot.numericStatus.overlay.frameId)) {
      fail('ROBOT_FRAME_NOT_FOUND', `${path}.numericStatus.overlay.frameId`, 'Robot status overlay Frame does not belong to the Robot Definition.')
    }
    if (robot.intentionalMountEntityId !== null && !indexes.entities.has(robot.intentionalMountEntityId)) {
      fail('SPATIAL_ENTITY_NOT_FOUND', `${path}.intentionalMountEntityId`, 'Intentional mount Entity does not exist.')
    }
    if (robot.visible) visibleTriangles += definition.triangleCount
  })
  for (const [controllerId] of indexes.controllers) {
    if (!controllerReferences.has(controllerId)) {
      fail('ROBOT_CONTROLLER_UNREFERENCED', '$.controllers', `Robot Controller ${controllerId} is not referenced.`)
    }
  }
  return visibleTriangles
}

function validateEntityReferences(
  project: WorkcellProjectV5,
  indexes: ProjectIndexes,
  groupVisibility: ReadonlyMap<string, boolean>,
): number {
  let visibleTriangles = 0
  const objectIdentities = new Set<string>()
  const referencedAssets = new Set<string>()
  project.spatialEntities.forEach((entity, index) => {
    const path = `$.spatialEntities[${index}]`
    if (!indexes.globalFrames.frames.has(entity.parentFrameId)) {
      fail('FRAME_PARENT_NOT_FOUND', `${path}.parentFrameId`, `Entity parent Frame ${entity.parentFrameId} does not exist.`)
    }
    if (entity.groupId !== null && !indexes.groups.has(entity.groupId)) {
      fail('SCENE_GROUP_NOT_FOUND', `${path}.groupId`, `Scene Group ${entity.groupId} does not exist.`)
    }
    validateOwnershipReference(entity.transformOwner, indexes.endpoints, `${path}.transformOwner`)
    validateOwnershipReference(entity.numericStatus.sourceOwnership, indexes.endpoints, `${path}.numericStatus.sourceOwnership`)
    if (entity.numericStatus.overlay.frameId !== null && !indexes.globalFrames.frames.has(entity.numericStatus.overlay.frameId)) {
      fail('FRAME_PARENT_NOT_FOUND', `${path}.numericStatus.overlay.frameId`, 'Entity status overlay Frame does not exist.')
    }
    if (!entity.graspable && entity.graspFrames.length !== 0) {
      fail('OBJECT_GRASP_FRAME_INVALID', `${path}.graspFrames`, 'A non-graspable Entity cannot declare Grasp Frames.')
    }
    entity.movingFrames.forEach((frame, frameIndex) => {
      validateOwnershipReference(frame.sourceOwnership, indexes.endpoints, `${path}.movingFrames[${frameIndex}].sourceOwnership`)
    })

    let triangles: number
    if (entity.geometry.kind === 'asset') {
      const asset = requireReference(indexes.assets, entity.geometry.assetReferenceId, `${path}.geometry.assetReferenceId`, 'ASSET_REFERENCE_NOT_FOUND', 'Asset reference')
      if (asset.byteLength === 0 || asset.byteLength > MAX_OBJECT_STEP_BYTES_V5) {
        fail('OBJECT_STEP_BYTE_LIMIT_EXCEEDED', `${path}.geometry.assetReferenceId`, 'Object STEP source exceeds its byte budget.')
      }
      if (entity.geometry.statistics.triangles > MAX_OBJECT_STEP_TRIANGLES_V5) {
        fail('OBJECT_STEP_TRIANGLE_LIMIT_EXCEEDED', `${path}.geometry.statistics.triangles`, 'Object STEP triangles exceed its budget.')
      }
      referencedAssets.add(asset.id)
      const orientation = entity.geometry.sourceConvention.orientation.mode === 'up-axis'
        ? entity.geometry.sourceConvention.orientation.upAxis
        : entity.geometry.sourceConvention.orientation.quaternion.join(',')
      objectIdentities.add(`${asset.sha256}|${entity.geometry.sourceConvention.linearUnit}|${entity.geometry.sourceConvention.sourceToMeters}|${orientation}|${entity.geometry.originMode}`)
      triangles = entity.geometry.statistics.triangles
    } else if (entity.geometry.kind === 'box') {
      triangles = BOX_PRIMITIVE_TRIANGLES_V5
    } else {
      triangles = CYLINDER_PRIMITIVE_TRIANGLES_V5
    }
    const groupVisible = entity.groupId === null || groupVisibility.get(entity.groupId) === true
    if (entity.visible && groupVisible) visibleTriangles += triangles
  })
  enforceMaximum(objectIdentities.size, MAX_IMPORTED_OBJECT_STEP_ASSETS_V5, '$.spatialEntities', 'IMPORTED_OBJECT_STEP_ASSET_LIMIT_EXCEEDED')
  return visibleTriangles
}

function validateLogicalSignalReferences(project: WorkcellProjectV5, indexes: ProjectIndexes): void {
  project.logicalSignals.forEach((signal, index) => {
    if (signal.scope.type === 'robot') {
      requireReference(indexes.robots, signal.scope.id, `$.logicalSignals[${index}].scope.id`, 'ROBOT_INSTANCE_NOT_FOUND', 'Robot')
    } else if (signal.scope.type === 'entity') {
      requireReference(indexes.entities, signal.scope.id, `$.logicalSignals[${index}].scope.id`, 'SPATIAL_ENTITY_NOT_FOUND', 'Spatial Entity')
    }
  })
}

function validateJobReferences(project: WorkcellProjectV5, indexes: ProjectIndexes): void {
  let totalInstructions = 0
  const instructionIds = new Set<string>()
  project.jobs.forEach((job, jobIndex) => {
    const path = `$.jobs[${jobIndex}]`
    enforceMaximum(job.instructions.length, MAX_JOB_STEPS_PER_JOB_V5, `${path}.instructions`, 'JOB_INSTRUCTION_LIMIT_EXCEEDED')
    totalInstructions += job.instructions.length
    const robot = requireReference(indexes.robots, job.robotId, `${path}.robotId`, 'ROBOT_INSTANCE_NOT_FOUND', 'Robot')
    const definition = requireReference(indexes.definitions, robot.definitionId, `${path}.robotId`, 'ROBOT_DEFINITION_NOT_FOUND', 'Robot Definition')
    job.instructions.forEach((instruction, instructionIndex) => {
      const instructionPath = `${path}.instructions[${instructionIndex}]`
      if (instructionIds.has(instruction.id)) {
        fail('PROJECT_ID_DUPLICATE', `${instructionPath}.id`, `Duplicate persisted id ${instruction.id}.`)
      }
      instructionIds.add(instruction.id)
      if (instruction.kind === 'move-joint') {
        expectExactJointValues(instruction.jointValues, definition, `${instructionPath}.jointValues`)
        requireSafeIntegerInRange(instruction.speedPercentToNext, MIN_JOB_SPEED_PERCENT_V5, MAX_JOB_SPEED_PERCENT_V5, `${instructionPath}.speedPercentToNext`, 'JOB_SPEED_PERCENT_INVALID')
      } else if (instruction.kind === 'set-do' || instruction.kind === 'wait-di') {
        const signal = requireReference(indexes.signals, instruction.signalId, `${instructionPath}.signalId`, 'LOGICAL_SIGNAL_NOT_FOUND', 'Logical Signal')
        const directionAllowed = instruction.kind === 'set-do'
          ? signal.direction === 'output' || signal.direction === 'bidirectional'
          : signal.direction === 'input' || signal.direction === 'bidirectional'
        if (signal.dataType !== 'Boolean' || !directionAllowed) {
          fail('JOB_SIGNAL_DIRECTION_INVALID', instruction.id, `${instruction.kind} Signal is incompatible.`)
        }
        if (instruction.kind === 'wait-di') {
          requireSafeIntegerInRange(instruction.timeoutMs, 1, MAX_JOB_TIMER_MS_V5, `${instructionPath}.timeoutMs`, 'JOB_TIMER_INVALID')
        }
      } else if (instruction.kind === 'delay') {
        requireSafeIntegerInRange(instruction.durationMs, 1, MAX_JOB_TIMER_MS_V5, `${instructionPath}.durationMs`, 'JOB_TIMER_INVALID')
      } else if (instruction.kind === 'attach') {
        const entity = requireReference(indexes.entities, instruction.objectId, `${instructionPath}.objectId`, 'SPATIAL_ENTITY_NOT_FOUND', 'Spatial Entity')
        if (!entity.entity.graspable) fail('OBJECT_NOT_GRASPABLE', `${instructionPath}.objectId`, 'Attach Object must be graspable.')
        if (!definition.frames.has(instruction.toolFrameId)) {
          fail('ROBOT_FRAME_NOT_FOUND', `${instructionPath}.toolFrameId`, 'Attach Tool Frame does not belong to the Job Robot.')
        }
        if (instruction.objectGraspFrameId !== null && !entity.graspFrames.has(instruction.objectGraspFrameId)) {
          fail('OBJECT_GRASP_FRAME_NOT_FOUND', `${instructionPath}.objectGraspFrameId`, 'Object Grasp Frame does not belong to the Object.')
        }
        if (instruction.maximumDistanceM < 0) {
          fail('ATTACH_DISTANCE_INVALID', `${instructionPath}.maximumDistanceM`, 'Attach maximum distance must be greater than or equal to zero.')
        }
      } else {
        requireReference(indexes.entities, instruction.objectId, `${instructionPath}.objectId`, 'SPATIAL_ENTITY_NOT_FOUND', 'Spatial Entity')
        if (instruction.targetParentFrameId !== null && !indexes.globalFrames.frames.has(instruction.targetParentFrameId)) {
          fail('FRAME_PARENT_NOT_FOUND', `${instructionPath}.targetParentFrameId`, 'Detach target parent Frame does not exist.')
        }
      }
    })
  })
  enforceMaximum(totalInstructions, MAX_TOTAL_JOB_STEPS_V5, '$.jobs', 'TOTAL_JOB_INSTRUCTION_LIMIT_EXCEEDED')
}

function validateMappingTargetReferences(
  target: OpcUaProjectTargetV5,
  path: string,
  indexes: ProjectIndexes,
): { readonly entity?: EntityFacts; readonly robot?: RobotInstanceV5; readonly definition?: DefinitionFacts } {
  if (target.type === 'logical-signal') {
    requireReference(indexes.signals, target.signalId, `${path}.signalId`, 'LOGICAL_SIGNAL_NOT_FOUND', 'Logical Signal')
    return {}
  }
  if (target.type === 'robot-joint' || target.type === 'robot-frame' || target.type === 'robot-status') {
    const robot = requireReference(indexes.robots, target.robotId, `${path}.robotId`, 'ROBOT_INSTANCE_NOT_FOUND', 'Robot')
    const definition = requireReference(indexes.definitions, robot.definitionId, `${path}.robotId`, 'ROBOT_DEFINITION_NOT_FOUND', 'Robot Definition')
    if (target.type === 'robot-joint' && !definition.joints.has(target.jointId)) {
      fail('ROBOT_JOINT_NOT_FOUND', `${path}.jointId`, 'Mapped Joint does not belong to the Robot.')
    }
    if (target.type === 'robot-frame' && !definition.frames.has(target.frameId)) {
      fail('ROBOT_FRAME_NOT_FOUND', `${path}.frameId`, 'Mapped Frame does not belong to the Robot.')
    }
    return { robot, definition }
  }
  const entity = requireReference(indexes.entities, target.entityId, `${path}.entityId`, 'SPATIAL_ENTITY_NOT_FOUND', 'Spatial Entity')
  if (target.type === 'entity-frame' && !entity.movingFrames.has(target.frameId)) {
    fail('FRAME_PARENT_NOT_FOUND', `${path}.frameId`, 'Mapped Frame must be an Entity Moving Frame.')
  }
  return { entity }
}

function validateMappingOwnership(
  mapping: OpcUaMappingV5,
  target: OpcUaProjectTargetV5,
  targetReferences: ReturnType<typeof validateMappingTargetReferences>,
  path: string,
): void {
  if (mapping.direction === 'write') return
  const expected = `${OPCUA_OWNERSHIP_PREFIX}${mapping.endpointId}`
  if (target.type === 'logical-signal') return
  if (target.type === 'robot-joint') {
    if (targetReferences.robot!.jointSource !== expected) fail('OPCUA_OWNERSHIP_MISMATCH', path, 'Robot Joint owner must match the Mapping Endpoint.')
    return
  }
  if (target.type === 'robot-frame') {
    if (targetReferences.robot!.frameSources[target.frameId] !== expected) fail('OPCUA_OWNERSHIP_MISMATCH', path, 'Robot Frame owner must match the Mapping Endpoint.')
    return
  }
  if (target.type === 'robot-status') {
    if (targetReferences.robot!.numericStatus.sourceOwnership !== expected) fail('OPCUA_OWNERSHIP_MISMATCH', path, 'Robot Status owner must match the Mapping Endpoint.')
    return
  }
  if (target.type === 'entity-frame') {
    const entity = targetReferences.entity!
    if (entity.entity.transformOwner !== expected || entity.movingFrames.get(target.frameId)!.sourceOwnership !== expected) {
      fail('OPCUA_OWNERSHIP_MISMATCH', path, 'Entity and Moving Frame owners must match the Mapping Endpoint.')
    }
    return
  }
  if (targetReferences.entity!.entity.numericStatus.sourceOwnership !== expected) {
    fail('OPCUA_OWNERSHIP_MISMATCH', path, 'Entity Status owner must match the Mapping Endpoint.')
  }
}

function validateMappingLeaves(
  mapping: OpcUaMappingV5,
  mappingPath: string,
  indexes: ProjectIndexes,
  channelKeys: Set<string>,
): OpcUaProjectTargetV5 {
  if (mapping.leaves.length === 0) {
    fail('OPCUA_STRUCTURE_LEAF_LIMIT_EXCEEDED', `${mappingPath}.leaves`, 'Every OPC UA Mapping requires at least one Leaf.')
  }
  enforceMaximum(mapping.leaves.length, MAX_OPC_UA_EXPANDED_LEAVES_PER_STRUCTURE_V5, `${mappingPath}.leaves`, 'OPCUA_STRUCTURE_LEAF_LIMIT_EXCEEDED')
  const leafPaths = new Set<string>()
  const tree = createLeafPathTreeNode()
  const indexesByPrefix = new Map<string, Set<number>>()
  let mappingTarget: OpcUaProjectTargetV5 | undefined
  mapping.leaves.forEach((leaf, leafIndex) => {
    const leafPath = `${mappingPath}.leaves[${leafIndex}]`
    const segments = validatePathSegments(leaf.leafPath, `${leafPath}.leafPath`)
    validatePathSegments(leaf.projectPath, `${leafPath}.projectPath`)
    const key = pathKey(segments)
    if (leafPaths.has(key)) fail('OPCUA_LEAF_PATH_TREE_INVALID', `${leafPath}.leafPath`, 'Mapping Leaf path is duplicated.')
    leafPaths.add(key)
    insertLeafPath(tree, segments, `${leafPath}.leafPath`)
    segments.forEach((segment, segmentIndex) => {
      if (typeof segment === 'string') return
      const prefix = pathKey(segments.slice(0, segmentIndex))
      const numericIndexes = indexesByPrefix.get(prefix) ?? new Set<number>()
      numericIndexes.add(segment)
      indexesByPrefix.set(prefix, numericIndexes)
    })
    const nodeAddressKey = opcUaNodeAddressKeyV1(effectiveLeafNodeAddressV1(mapping, leaf))
    const channelKey = `${mapping.endpointId}\u0000${nodeAddressKey}\u0000${key}`
    if (channelKeys.has(channelKey)) fail('OPCUA_CHANNEL_DUPLICATE', `${leafPath}.leafPath`, 'Endpoint Node and Leaf path must be unique.')
    channelKeys.add(channelKey)
    validateGenericDataTypePair(leaf, leafPath)
    validateProjectPath(leaf.projectTarget, leaf, leafPath)
    if (mappingTarget === undefined) {
      mappingTarget = leaf.projectTarget
    } else if (targetKey(mappingTarget) !== targetKey(leaf.projectTarget)) {
      fail('OPCUA_MAPPING_TARGET_MISMATCH', `${leafPath}.projectTarget`, 'Every Mapping Leaf must target the same Project resource.')
    }
    validateNumericTargetDataType(leaf.projectTarget, leaf, leafPath)
  })
  validateFixedArrayIndexes(indexesByPrefix, `${mappingPath}.leaves`)
  const target = mappingTarget!
  if (target.type === 'robot-joint' && mapping.leaves.length !== 1) {
    fail('OPCUA_SCALAR_MAPPING_LEAF_COUNT_INVALID', `${mappingPath}.leaves`, 'A scalar Mapping target requires exactly one Leaf.')
  }
  if (target.type === 'robot-frame' || target.type === 'entity-frame') validateFrameProjectPaths(mapping.leaves, mappingPath)
  const references = validateMappingTargetReferences(target, `${mappingPath}.leaves[0].projectTarget`, indexes)
  if (target.type === 'logical-signal') {
    const signal = requireReference(indexes.signals, target.signalId, `${mappingPath}.leaves[0].projectTarget.signalId`, 'LOGICAL_SIGNAL_NOT_FOUND', 'Logical Signal')
    mapping.leaves.forEach((leaf) => validateSignalMapping(mapping.direction, leaf, signal))
  }
  validateMappingOwnership(mapping, target, references, mappingPath)
  return target
}

function validateOpcUaReferences(project: WorkcellProjectV5, indexes: ProjectIndexes): void {
  const rootsByEndpoint = new Map<string, number>()
  const leavesByEndpoint = new Map<string, number>()
  const channelKeys = new Set<string>()
  const readTargets = new Map<string, string>()
  let projectLeaves = 0
  let updatesPerSecond = 0

  project.opcUa.endpoints.forEach((endpoint, index) => {
    const path = `$.opcUa.endpoints[${index}]`
    requireSafeIntegerInRange(endpoint.publishingIntervalMs, MIN_OPC_UA_PUBLISHING_INTERVAL_MS_V5, Number.MAX_SAFE_INTEGER, `${path}.publishingIntervalMs`, 'OPCUA_PUBLISHING_INTERVAL_INVALID')
    requireSafeIntegerInRange(endpoint.reconnectDelayMs, 0, Number.MAX_SAFE_INTEGER, `${path}.reconnectDelayMs`, 'OPCUA_RECONNECT_DELAY_INVALID')
  })

  project.opcUa.mappings.forEach((mapping, index) => {
    const path = `$.opcUa.mappings[${index}]`
    const endpoint = requireReference(indexes.endpoints, mapping.endpointId, `${path}.endpointId`, 'OPCUA_ENDPOINT_NOT_FOUND', 'OPC UA endpoint')
    if (mapping.publishingIntervalMs !== undefined) {
      requireSafeIntegerInRange(mapping.publishingIntervalMs, MIN_OPC_UA_PUBLISHING_INTERVAL_MS_V5, Number.MAX_SAFE_INTEGER, `${path}.publishingIntervalMs`, 'OPCUA_PUBLISHING_INTERVAL_INVALID')
    }
    const rootCount = (rootsByEndpoint.get(mapping.endpointId) ?? 0) + 1
    if (rootCount > MAX_OPC_UA_STRUCTURE_ROOTS_PER_ENDPOINT_V5) {
      fail('OPCUA_ENDPOINT_STRUCTURE_ROOT_LIMIT_EXCEEDED', path, 'Endpoint Structure-root budget is exceeded.')
    }
    rootsByEndpoint.set(mapping.endpointId, rootCount)
    const target = validateMappingLeaves(mapping, path, indexes, channelKeys)
    const endpointLeaves = (leavesByEndpoint.get(mapping.endpointId) ?? 0) + mapping.leaves.length
    if (endpointLeaves > MAX_OPC_UA_EXPANDED_LEAVES_PER_ENDPOINT_V5) {
      fail('OPCUA_ENDPOINT_LEAF_LIMIT_EXCEEDED', path, 'Endpoint expanded-Leaf budget is exceeded.')
    }
    leavesByEndpoint.set(mapping.endpointId, endpointLeaves)
    projectLeaves += mapping.leaves.length
    if (projectLeaves > MAX_OPC_UA_EXPANDED_LEAVES_V5) {
      fail('OPCUA_PROJECT_LEAF_LIMIT_EXCEEDED', path, 'Project expanded-Leaf budget is exceeded.')
    }
    const interval = mapping.publishingIntervalMs ?? endpoint.publishingIntervalMs ?? DEFAULT_OPC_UA_PUBLISHING_INTERVAL_MS_V5
    if (endpoint.enabled) {
      updatesPerSecond += mapping.leaves.length * 1000 / interval
      if (mapping.direction !== 'write') {
        const key = targetKey(target)
        const previous = readTargets.get(key)
        if (previous !== undefined && previous !== mapping.id) {
          fail('OPCUA_READ_OWNER_DUPLICATE', path, `Enabled OPC UA Mapping ${previous} already owns ${key}.`)
        }
        readTargets.set(key, mapping.id)
      }
    }
  })
  if (updatesPerSecond > MAX_OPC_UA_LEAF_UPDATES_PER_SECOND_V5) {
    fail('OPCUA_UPDATE_RATE_LIMIT_EXCEEDED', '$.opcUa.mappings', 'Enabled OPC UA update-rate budget is exceeded.')
  }

  const destinations = new Map<string, string[]>()
  const indegree = new Map<string, number>()
  const routeIds = new Set<string>()
  project.opcUa.bridgeRoutes.forEach((route, index) => {
    const path = `$.opcUa.bridgeRoutes[${index}]`
    if (routeIds.has(route.id)) fail('PROJECT_ID_DUPLICATE', `${path}.id`, `Duplicate persisted id ${route.id}.`)
    routeIds.add(route.id)
    requireReference(indexes.mappings, route.sourceMappingId, `${path}.sourceMappingId`, 'BRIDGE_MAPPING_NOT_FOUND', 'Bridge Mapping')
    requireReference(indexes.mappings, route.destinationMappingId, `${path}.destinationMappingId`, 'BRIDGE_MAPPING_NOT_FOUND', 'Bridge Mapping')
    if (route.sourceMappingId === route.destinationMappingId) {
      fail('BRIDGE_ROUTE_ECHO', path, 'Bridge route cannot echo a Mapping to itself.')
    }
    const next = destinations.get(route.sourceMappingId) ?? []
    next.push(route.destinationMappingId)
    destinations.set(route.sourceMappingId, next)
    if (!indegree.has(route.sourceMappingId)) indegree.set(route.sourceMappingId, 0)
    indegree.set(route.destinationMappingId, (indegree.get(route.destinationMappingId) ?? 0) + 1)
  })
  const ready = [...indegree].filter(([, value]) => value === 0).map(([id]) => id)
  let visited = 0
  while (ready.length !== 0) {
    const source = ready.pop()!
    visited += 1
    for (const destination of destinations.get(source) ?? []) {
      const remaining = indegree.get(destination)! - 1
      indegree.set(destination, remaining)
      if (remaining === 0) ready.push(destination)
    }
  }
  if (visited !== indegree.size) fail('BRIDGE_ROUTE_CYCLE', '$.opcUa.bridgeRoutes', 'Declared Bridge routes must form an acyclic directed graph.')
}

export function validateWorkcellProjectReferencesV5(project: WorkcellProjectV5): void {
  const indexes = createProjectIndexes(project)
  const groupVisibility = validateGroupGraph(project, indexes.groups)
  const robotTriangles = validateRobotReferences(project, indexes)
  const entityTriangles = validateEntityReferences(project, indexes, groupVisibility)
  if (robotTriangles + entityTriangles > MAX_VISIBLE_SCENE_TRIANGLES_V5) {
    fail('VISIBLE_SCENE_TRIANGLE_LIMIT_EXCEEDED', '$.scene', 'Visible Scene triangle budget is exceeded.')
  }
  validateLogicalSignalReferences(project, indexes)
  validateJobReferences(project, indexes)
  validateOpcUaReferences(project, indexes)

  const referencedAssetIds = new Set<string>()
  project.robotDefinitions.forEach((definition) => definition.assetReferenceIds.forEach((id) => referencedAssetIds.add(id)))
  project.spatialEntities.forEach((entity) => {
    if (entity.geometry.kind === 'asset') referencedAssetIds.add(entity.geometry.assetReferenceId)
  })
  const totalReferencedBytes = [...referencedAssetIds].reduce((sum, assetId) => sum + requireReference(indexes.assets, assetId, '$.assetReferences', 'ASSET_REFERENCE_NOT_FOUND', 'Asset reference').byteLength, 0)
  if (totalReferencedBytes > MAX_REFERENCED_STEP_BYTES_V5) {
    fail('PROJECT_STEP_BYTE_LIMIT_EXCEEDED', '$.assetReferences', 'Referenced STEP byte budget is exceeded.')
  }
}
