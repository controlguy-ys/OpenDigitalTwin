import { failMechanismV1 } from './errors.js'
import {
  MAX_MECHANISM_BODIES_V1,
  MAX_MECHANISM_MOVABLE_JOINTS_V1,
  MAX_MECHANISM_TREE_JOINTS_V1,
  EMPTY_SOLVER_PARAMETERS_SHA256_V1,
} from './limits.js'
import { inspectCanonicalJsonObjectV1, normalizeMechanismRigidTransformV1 } from './validation-support.js'
import type { MechanismDefinitionV1, MechanismJointV1, RigidTransformV1 } from './types.js'

export interface CompiledTreeMechanismV1 {
  readonly definition: MechanismDefinitionV1
  readonly rootBodyId: string
  readonly movableJointIds: readonly string[]
  readonly traversal: readonly {
    readonly jointId: string
    readonly parentBodyId: string
    readonly childBodyId: string
  }[]
}

function invalidValue(path: string): never {
  return failMechanismV1('MECHANISM_VALUE_INVALID', path, 'Value must match the Mechanism V1 canonical definition contract.')
}

function compareStableIds(left: string, right: string): number {
  if (left < right) return -1
  if (left > right) return 1
  return 0
}

function closedRecord(
  value: unknown,
  path: string,
  allowedKeys: readonly string[],
  requiredKeys: readonly string[] = allowedKeys,
): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) invalidValue(path)
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) invalidValue(path)
  const allowed = new Set(allowedKeys)
  const record = value as Record<string, unknown>
  for (const key of Reflect.ownKeys(record)) {
    if (typeof key !== 'string') invalidValue(path)
    const descriptor = Object.getOwnPropertyDescriptor(record, key)
    if (descriptor === undefined || !descriptor.enumerable || !('value' in descriptor)) invalidValue(`${path}.${key}`)
    if (!allowed.has(key)) invalidValue(`${path}.${key}`)
  }
  for (const key of requiredKeys) if (!Object.hasOwn(record, key)) invalidValue(`${path}.${key}`)
  return record
}

function denseArray(value: unknown, path: string): readonly unknown[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) invalidValue(path)
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key === 'symbol' || (key !== 'length' && !/^(0|[1-9]\d*)$/.test(key))) invalidValue(path)
  }
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index))
    if (descriptor === undefined || !descriptor.enumerable || !('value' in descriptor)) invalidValue(`${path}[${index}]`)
  }
  return value
}

function stringValue(value: unknown, path: string): string {
  return typeof value === 'string' ? value : invalidValue(path)
}

function finiteNumber(value: unknown, path: string): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : invalidValue(path)
}

function numberValue(value: unknown, path: string): number {
  return typeof value === 'number' ? value : invalidValue(path)
}

function stringArray(value: unknown, path: string): void {
  for (const [index, item] of denseArray(value, path).entries()) stringValue(item, `${path}[${index}]`)
}

function transformShape(value: unknown, path: string): void {
  const record = closedRecord(value, path, ['positionM', 'quaternion'])
  const position = denseArray(record.positionM, `${path}.positionM`)
  const quaternion = denseArray(record.quaternion, `${path}.quaternion`)
  if (position.length !== 3) invalidValue(`${path}.positionM`)
  if (quaternion.length !== 4) invalidValue(`${path}.quaternion`)
  for (const [index, item] of position.entries()) finiteNumber(item, `${path}.positionM[${index}]`)
  for (const [index, item] of quaternion.entries()) finiteNumber(item, `${path}.quaternion[${index}]`)
}

function peekStringField(value: unknown, key: string): string | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined
  const descriptor = Object.getOwnPropertyDescriptor(value, key)
  return descriptor !== undefined && 'value' in descriptor && typeof descriptor.value === 'string'
    ? descriptor.value
    : undefined
}

function validateDefinitionShape(definition: unknown): asserts definition is MechanismDefinitionV1 {
  const record = closedRecord(definition, '$', [
    'mechanismId', 'name', 'topologyKind', 'solverRef', 'bodies', 'joints', 'frames', 'motionGroups',
    'constraints', 'geometryBindings', 'sourceProvenance',
  ])
  stringValue(record.mechanismId, '$.mechanismId')
  stringValue(record.name, '$.name')
  const topologyKind = stringValue(record.topologyKind, '$.topologyKind')
  if (!['tree', 'free-body', 'parallel'].includes(topologyKind)) invalidValue('$.topologyKind')

  const solver = closedRecord(record.solverRef, '$.solverRef', ['solverKey', 'contractVersion', 'parameters', 'normalizedParametersHash'])
  stringValue(solver.solverKey, '$.solverRef.solverKey')
  stringValue(solver.contractVersion, '$.solverRef.contractVersion')
  inspectCanonicalJsonObjectV1(solver.parameters, '$.solverRef.parameters')
  stringValue(solver.normalizedParametersHash, '$.solverRef.normalizedParametersHash')

  const bodyValues = denseArray(record.bodies, '$.bodies')
  const jointValues = denseArray(record.joints, '$.joints')
  if (bodyValues.length < 1 || bodyValues.length > MAX_MECHANISM_BODIES_V1) {
    failMechanismV1('MECHANISM_RESOURCE_LIMIT_EXCEEDED', '$.bodies', 'Body count must be within the Tree limit.')
  }
  if (jointValues.length > MAX_MECHANISM_TREE_JOINTS_V1) {
    failMechanismV1('MECHANISM_RESOURCE_LIMIT_EXCEEDED', '$.joints', 'Joint count exceeds the Tree limit.')
  }

  const checkedBodyIds = new Set<string>()
  for (const [index, value] of bodyValues.entries()) {
    const body = closedRecord(value, `$.bodies[${index}]`, ['bodyId', 'name'])
    const bodyId = stringValue(body.bodyId, `$.bodies[${index}].bodyId`)
    stringValue(body.name, `$.bodies[${index}].name`)
    if (checkedBodyIds.has(bodyId)) failMechanismV1('MECHANISM_ID_DUPLICATE', `$.bodies[${index}].bodyId`, 'Body IDs must be unique.')
    checkedBodyIds.add(bodyId)
  }
  const checkedJointIds = new Set<string>()
  const checkedIncomingBodies = new Set<string>()
  const checkedMovableJointIds = new Set<string>()
  for (const [index, value] of jointValues.entries()) {
    const path = `$.joints[${index}]`
    const preliminary = closedRecord(value, path, [
      'jointId', 'jointType', 'parentBodyId', 'childBodyId', 'origin', 'axis', 'minimum', 'maximum', 'home',
      'zeroOffset', 'direction', 'maximumVelocity',
    ], [])
    const jointType = stringValue(preliminary.jointType, `${path}.jointType`)
    const expectedKeys = jointType === 'fixed'
      ? ['jointId', 'jointType', 'parentBodyId', 'childBodyId', 'origin']
      : jointType === 'revolute' || jointType === 'prismatic'
        ? ['jointId', 'jointType', 'parentBodyId', 'childBodyId', 'origin', 'axis', 'minimum', 'maximum', 'home', 'zeroOffset', 'direction', 'maximumVelocity']
        : invalidValue(`${path}.jointType`)
    const joint = closedRecord(value, path, expectedKeys)
    const jointId = stringValue(joint.jointId, `${path}.jointId`)
    const parentBodyId = stringValue(joint.parentBodyId, `${path}.parentBodyId`)
    const childBodyId = stringValue(joint.childBodyId, `${path}.childBodyId`)
    transformShape(joint.origin, `${path}.origin`)
    if (jointType !== 'fixed') {
      const axis = denseArray(joint.axis, `${path}.axis`)
      if (axis.length !== 3) invalidValue(`${path}.axis`)
      for (const [axisIndex, component] of axis.entries()) numberValue(component, `${path}.axis[${axisIndex}]`)
      for (const key of ['minimum', 'maximum', 'home', 'zeroOffset', 'direction', 'maximumVelocity'] as const) numberValue(joint[key], `${path}.${key}`)
    }
    if (checkedJointIds.has(jointId)) failMechanismV1('MECHANISM_ID_DUPLICATE', `${path}.jointId`, 'Joint IDs must be unique.')
    checkedJointIds.add(jointId)
    if (!checkedBodyIds.has(parentBodyId)) failMechanismV1('BODY_NOT_FOUND', `${path}.parentBodyId`, 'Joint parent Body does not exist.')
    if (!checkedBodyIds.has(childBodyId)) failMechanismV1('BODY_NOT_FOUND', `${path}.childBodyId`, 'Joint child Body does not exist.')
    if (parentBodyId === childBodyId || checkedIncomingBodies.has(childBodyId)) {
      failMechanismV1('MECHANISM_TOPOLOGY_INVALID', path, 'Tree Joints require one distinct incoming edge per child Body.')
    }
    checkedIncomingBodies.add(childBodyId)
    if (jointType !== 'fixed') {
      checkedMovableJointIds.add(jointId)
      if (checkedMovableJointIds.size > MAX_MECHANISM_MOVABLE_JOINTS_V1) {
        failMechanismV1('MECHANISM_RESOURCE_LIMIT_EXCEEDED', '$.joints', 'Movable Joint count exceeds the Tree limit.')
      }
      const typedJoint = joint as unknown as Exclude<MechanismJointV1, { readonly jointType: 'fixed' }>
      const magnitude = Math.hypot(...typedJoint.axis)
      if (!Number.isFinite(magnitude) || magnitude === 0) failMechanismV1('JOINT_AXIS_NOT_NORMALIZABLE', `${path}.axis`, 'Movable Joint axis must be finite and non-zero.')
      if (!Number.isFinite(typedJoint.minimum)) failMechanismV1('JOINT_LIMIT_INVALID', `${path}.minimum`, 'Joint minimum must be finite.')
      if (!Number.isFinite(typedJoint.maximum)) failMechanismV1('JOINT_LIMIT_INVALID', `${path}.maximum`, 'Joint maximum must be finite.')
      if (!Number.isFinite(typedJoint.home)) failMechanismV1('JOINT_LIMIT_INVALID', `${path}.home`, 'Joint home must be finite.')
      if (!Number.isFinite(typedJoint.zeroOffset)) failMechanismV1('JOINT_LIMIT_INVALID', `${path}.zeroOffset`, 'Joint zero offset must be finite.')
      if (typedJoint.minimum > typedJoint.maximum || typedJoint.home < typedJoint.minimum || typedJoint.home > typedJoint.maximum) {
        failMechanismV1('JOINT_LIMIT_INVALID', path, 'Joint limits must be ordered and include home.')
      }
      if (!Number.isFinite(typedJoint.maximumVelocity) || typedJoint.maximumVelocity < 0) {
        failMechanismV1('JOINT_LIMIT_INVALID', `${path}.maximumVelocity`, 'Joint maximum velocity must be non-negative and finite.')
      }
      if (typedJoint.direction !== 1 && typedJoint.direction !== -1) {
        failMechanismV1('JOINT_DIRECTION_INVALID', `${path}.direction`, 'Joint direction must be 1 or -1.')
      }
    }
  }
  const roles = new Set(['world', 'mcp', 'mount', 'base', 'flange', 'tool0', 'tool', 'tcp', 'gripper', 'grasp', 'placement', 'work', 'sensor', 'custom'])
  const frameValues = denseArray(record.frames, '$.frames')
  const checkedFrameIds = new Set(frameValues.map((value) => peekStringField(value, 'frameId')).filter((value): value is string => value !== undefined))
  const encounteredFrameIds = new Set<string>()
  for (const [index, value] of frameValues.entries()) {
    const path = `$.frames[${index}]`
    const frame = closedRecord(value, path, ['frameId', 'name', 'role', 'parent', 'localPose'])
    const frameId = stringValue(frame.frameId, `${path}.frameId`)
    stringValue(frame.name, `${path}.name`)
    if (!roles.has(stringValue(frame.role, `${path}.role`))) invalidValue(`${path}.role`)
    const parentPreliminary = closedRecord(frame.parent, `${path}.parent`, ['type', 'bodyId', 'frameId'], [])
    const parentType = stringValue(parentPreliminary.type, `${path}.parent.type`)
    const parent = closedRecord(frame.parent, `${path}.parent`, parentType === 'body'
      ? ['type', 'bodyId']
      : parentType === 'frame' ? ['type', 'frameId'] : invalidValue(`${path}.parent.type`))
    stringValue(parentType === 'body' ? parent.bodyId : parent.frameId, `${path}.parent.${parentType === 'body' ? 'bodyId' : 'frameId'}`)
    transformShape(frame.localPose, `${path}.localPose`)
    if (encounteredFrameIds.has(frameId)) failMechanismV1('MECHANISM_ID_DUPLICATE', `${path}.frameId`, 'Frame IDs must be unique.')
    encounteredFrameIds.add(frameId)
    if (parentType === 'body' && !checkedBodyIds.has(parent.bodyId as string)) {
      failMechanismV1('FRAME_PARENT_NOT_FOUND', `${path}.parent`, 'Frame parent Body does not exist.')
    }
    if (parentType === 'frame' && !checkedFrameIds.has(parent.frameId as string)) {
      failMechanismV1('FRAME_PARENT_NOT_FOUND', `${path}.parent`, 'Frame parent Frame does not exist.')
    }
  }
  const checkedMotionGroupIds = new Set<string>()
  for (const [index, value] of denseArray(record.motionGroups, '$.motionGroups').entries()) {
    const path = `$.motionGroups[${index}]`
    const group = closedRecord(value, path, ['motionGroupId', 'name', 'coordinateJointIds', 'endFrameIds'])
    const motionGroupId = stringValue(group.motionGroupId, `${path}.motionGroupId`)
    stringValue(group.name, `${path}.name`)
    stringArray(group.coordinateJointIds, `${path}.coordinateJointIds`)
    stringArray(group.endFrameIds, `${path}.endFrameIds`)
    if (checkedMotionGroupIds.has(motionGroupId)) {
      failMechanismV1('MECHANISM_ID_DUPLICATE', `${path}.motionGroupId`, 'Motion Group IDs must be unique.')
    }
    checkedMotionGroupIds.add(motionGroupId)
    const coordinateIds = new Set<string>()
    for (const [coordinateIndex, jointId] of (group.coordinateJointIds as readonly string[]).entries()) {
      if (coordinateIds.has(jointId) || !checkedMovableJointIds.has(jointId)) {
        failMechanismV1('MOTION_GROUP_INVALID', `${path}.coordinateJointIds[${coordinateIndex}]`, 'Motion Group coordinates must name distinct movable Joints.')
      }
      coordinateIds.add(jointId)
    }
    const endIds = new Set<string>()
    for (const [endIndex, frameId] of (group.endFrameIds as readonly string[]).entries()) {
      if (!checkedFrameIds.has(frameId)) failMechanismV1('FRAME_NOT_FOUND', `${path}.endFrameIds[${endIndex}]`, 'Motion Group end Frame does not exist.')
      if (endIds.has(frameId)) failMechanismV1('MOTION_GROUP_INVALID', `${path}.endFrameIds[${endIndex}]`, 'Motion Group end Frames must be distinct.')
      endIds.add(frameId)
    }
  }
  for (const [index, value] of denseArray(record.constraints, '$.constraints').entries()) {
    const path = `$.constraints[${index}]`
    const constraint = closedRecord(value, path, ['constraintId', 'constraintType', 'parentFrameId', 'childFrameId', 'targetPose'])
    stringValue(constraint.constraintId, `${path}.constraintId`)
    if (stringValue(constraint.constraintType, `${path}.constraintType`) !== 'loop-closure') invalidValue(`${path}.constraintType`)
    stringValue(constraint.parentFrameId, `${path}.parentFrameId`)
    stringValue(constraint.childFrameId, `${path}.childFrameId`)
    transformShape(constraint.targetPose, `${path}.targetPose`)
  }
  for (const [index, value] of denseArray(record.geometryBindings, '$.geometryBindings').entries()) {
    const path = `$.geometryBindings[${index}]`
    const binding = closedRecord(value, path, ['geometryBindingId', 'bodyId', 'assetReferenceId', 'occurrenceKey', 'bodyLocalPose'])
    for (const key of ['geometryBindingId', 'bodyId', 'assetReferenceId', 'occurrenceKey'] as const) stringValue(binding[key], `${path}.${key}`)
    transformShape(binding.bodyLocalPose, `${path}.bodyLocalPose`)
  }
  const source = closedRecord(record.sourceProvenance, '$.sourceProvenance', ['sourceKind', 'sourceDetail', 'sourceName', 'sourceRevision', 'adapterKey', 'adapterVersion'])
  if (!['project-v5-robot', 'mechanism-manifest', 'urdf', 'manual', 'fixture'].includes(stringValue(source.sourceKind, '$.sourceProvenance.sourceKind'))) invalidValue('$.sourceProvenance.sourceKind')
  for (const key of ['sourceDetail', 'sourceName', 'sourceRevision'] as const) stringValue(source[key], `$.sourceProvenance.${key}`)
  for (const key of ['adapterKey', 'adapterVersion'] as const) if (source[key] !== null) stringValue(source[key], `$.sourceProvenance.${key}`)
}

function cloneJoint(joint: MechanismJointV1, index: number): MechanismJointV1 {
  const origin = cloneFrozenTransform(joint.origin, `$.joints[${index}].origin`)
  if (joint.jointType === 'fixed') return Object.freeze({ ...joint, origin })
  const magnitude = Math.hypot(...joint.axis)
  return Object.freeze({
    ...joint,
    axis: Object.freeze([
      joint.axis[0] / magnitude,
      joint.axis[1] / magnitude,
      joint.axis[2] / magnitude,
    ] as [number, number, number]),
    origin,
  })
}

function cloneFrozenTransform(value: RigidTransformV1, path: string): RigidTransformV1 {
  const normalized = normalizeMechanismRigidTransformV1(value, path)
  return Object.freeze({
    positionM: Object.freeze([...normalized.positionM] as [number, number, number]),
    quaternion: Object.freeze([...normalized.quaternion] as [number, number, number, number]),
  })
}

function cloneDefinition(definition: MechanismDefinitionV1): MechanismDefinitionV1 {
  return Object.freeze({
    ...definition,
    bodies: Object.freeze(definition.bodies.map((body) => Object.freeze({ ...body })).sort((left, right) => compareStableIds(left.bodyId, right.bodyId))),
    joints: Object.freeze(definition.joints.map(cloneJoint).sort((left, right) => compareStableIds(left.jointId, right.jointId))),
    frames: Object.freeze(definition.frames.map((frame, index) => Object.freeze({
      ...frame,
      parent: Object.freeze({ ...frame.parent }),
      localPose: cloneFrozenTransform(frame.localPose, `$.frames[${index}].localPose`),
    })).sort((left, right) => compareStableIds(left.frameId, right.frameId))),
    motionGroups: Object.freeze(definition.motionGroups.map((group) => Object.freeze({
      ...group,
      coordinateJointIds: Object.freeze([...group.coordinateJointIds]),
      endFrameIds: Object.freeze([...group.endFrameIds]),
    })).sort((left, right) => compareStableIds(left.motionGroupId, right.motionGroupId))),
    constraints: Object.freeze(definition.constraints.map((constraint, index) => Object.freeze({
      ...constraint,
      targetPose: cloneFrozenTransform(constraint.targetPose, `$.constraints[${index}].targetPose`),
    }))),
    geometryBindings: Object.freeze(definition.geometryBindings.map((binding, index) => Object.freeze({
      ...binding,
      bodyLocalPose: cloneFrozenTransform(binding.bodyLocalPose, `$.geometryBindings[${index}].bodyLocalPose`),
    })).sort((left, right) => compareStableIds(left.geometryBindingId, right.geometryBindingId))),
    solverRef: Object.freeze({ ...definition.solverRef, parameters: inspectCanonicalJsonObjectV1(definition.solverRef.parameters, '$.solverRef.parameters') }),
    sourceProvenance: Object.freeze({ ...definition.sourceProvenance }),
  })
}

function validateFrames(definition: MechanismDefinitionV1): Set<string> {
  const bodyIds = new Set(definition.bodies.map(({ bodyId }) => bodyId))
  const frameIds = new Set(definition.frames.map(({ frameId }) => frameId))
  const encounteredFrameIds = new Set<string>()
  for (const [index, frame] of definition.frames.entries()) {
    if (encounteredFrameIds.has(frame.frameId)) failMechanismV1('MECHANISM_ID_DUPLICATE', `$.frames[${index}].frameId`, 'Frame IDs must be unique.')
    encounteredFrameIds.add(frame.frameId)
    if (frame.parent.type === 'body' && !bodyIds.has(frame.parent.bodyId)) {
      failMechanismV1('FRAME_PARENT_NOT_FOUND', `$.frames[${index}].parent`, 'Frame parent Body does not exist.')
    }
    if (frame.parent.type === 'frame' && !frameIds.has(frame.parent.frameId)) {
      failMechanismV1('FRAME_PARENT_NOT_FOUND', `$.frames[${index}].parent`, 'Frame parent Frame does not exist.')
    }
  }
  const framesById = new Map(definition.frames.map((frame) => [frame.frameId, frame] as const))
  const resolved = new Set<string>()
  const resolving = new Set<string>()
  const visit = (frameId: string): void => {
    if (resolved.has(frameId)) return
    if (resolving.has(frameId)) failMechanismV1('FRAME_CYCLE', '$.frames', 'Frame parent graph contains a cycle.')
    resolving.add(frameId)
    const frame = framesById.get(frameId)!
    if (frame.parent.type === 'frame') visit(frame.parent.frameId)
    resolving.delete(frameId)
    resolved.add(frameId)
  }
  for (const frameId of frameIds) visit(frameId)
  return frameIds
}

function validateTreeReferences(definition: MechanismDefinitionV1, frameIds: ReadonlySet<string>): void {
  if (definition.topologyKind !== 'tree') {
    failMechanismV1('TOPOLOGY_UNSUPPORTED', '$.topologyKind', 'Tree FK supports only Tree topology.')
  }
  if (definition.constraints.length !== 0) {
    failMechanismV1('TOPOLOGY_UNSUPPORTED', '$.constraints', 'Tree FK does not support loop constraints.')
  }
  const movableJointIds = new Set(definition.joints.filter((joint) => joint.jointType !== 'fixed').map(({ jointId }) => jointId))
  for (const [groupIndex, group] of definition.motionGroups.entries()) {
    const coordinates = new Set<string>()
    for (const [coordinateIndex, jointId] of group.coordinateJointIds.entries()) {
      if (coordinates.has(jointId) || !movableJointIds.has(jointId)) {
        failMechanismV1('MOTION_GROUP_INVALID', `$.motionGroups[${groupIndex}].coordinateJointIds[${coordinateIndex}]`, 'Motion Group coordinates must name distinct movable Joints.')
      }
      coordinates.add(jointId)
    }
    const ends = new Set<string>()
    for (const [frameIndex, frameId] of group.endFrameIds.entries()) {
      if (!frameIds.has(frameId)) failMechanismV1('FRAME_NOT_FOUND', `$.motionGroups[${groupIndex}].endFrameIds[${frameIndex}]`, 'Motion Group end Frame does not exist.')
      if (ends.has(frameId)) {
        failMechanismV1('MOTION_GROUP_INVALID', `$.motionGroups[${groupIndex}].endFrameIds[${frameIndex}]`, 'Motion Group end Frames must be distinct.')
      }
      ends.add(frameId)
    }
  }
  if (definition.solverRef.solverKey !== 'open-digital-twin/tree-fk') {
    failMechanismV1('SOLVER_UNAVAILABLE', '$.solverRef.solverKey', 'Tree FK solver key is unavailable.')
  }
  if (definition.solverRef.contractVersion !== '1') {
    failMechanismV1('SOLVER_UNAVAILABLE', '$.solverRef.contractVersion', 'Tree FK solver contract version is unavailable.')
  }
  if (Object.keys(definition.solverRef.parameters).length !== 0) {
    failMechanismV1('SOLVER_PARAMETERS_INVALID', '$.solverRef.parameters', 'Tree FK solver parameters must be empty.')
  }
  if (definition.solverRef.normalizedParametersHash !== EMPTY_SOLVER_PARAMETERS_SHA256_V1) {
    failMechanismV1('SOLVER_PARAMETERS_INVALID', '$.solverRef.normalizedParametersHash', 'Tree FK solver parameter hash is invalid.')
  }
}

function validateBodyAndJointGraph(definition: MechanismDefinitionV1): string {
  if (definition.bodies.length < 1 || definition.bodies.length > MAX_MECHANISM_BODIES_V1) {
    failMechanismV1('MECHANISM_RESOURCE_LIMIT_EXCEEDED', '$.bodies', 'Body count must be within the Tree limit.')
  }
  if (definition.joints.length > MAX_MECHANISM_TREE_JOINTS_V1) {
    failMechanismV1('MECHANISM_RESOURCE_LIMIT_EXCEEDED', '$.joints', 'Joint count exceeds the Tree limit.')
  }
  if (definition.joints.filter((joint) => joint.jointType !== 'fixed').length > MAX_MECHANISM_MOVABLE_JOINTS_V1) {
    failMechanismV1('MECHANISM_RESOURCE_LIMIT_EXCEEDED', '$.joints', 'Movable Joint count exceeds the Tree limit.')
  }

  const bodyIds = new Set<string>()
  for (const [index, body] of definition.bodies.entries()) {
    if (bodyIds.has(body.bodyId)) failMechanismV1('MECHANISM_ID_DUPLICATE', `$.bodies[${index}].bodyId`, 'Body IDs must be unique.')
    bodyIds.add(body.bodyId)
  }
  const jointIds = new Set<string>()
  const incomingBodies = new Set<string>()
  for (const [index, joint] of definition.joints.entries()) {
    if (jointIds.has(joint.jointId)) failMechanismV1('MECHANISM_ID_DUPLICATE', `$.joints[${index}].jointId`, 'Joint IDs must be unique.')
    jointIds.add(joint.jointId)
    if (!bodyIds.has(joint.parentBodyId)) failMechanismV1('BODY_NOT_FOUND', `$.joints[${index}].parentBodyId`, 'Joint parent Body does not exist.')
    if (!bodyIds.has(joint.childBodyId)) failMechanismV1('BODY_NOT_FOUND', `$.joints[${index}].childBodyId`, 'Joint child Body does not exist.')
    if (joint.parentBodyId === joint.childBodyId || incomingBodies.has(joint.childBodyId)) {
      failMechanismV1('MECHANISM_TOPOLOGY_INVALID', `$.joints[${index}]`, 'Tree Joints require one distinct incoming edge per child Body.')
    }
    incomingBodies.add(joint.childBodyId)
    if (joint.jointType === 'fixed') continue
    const axisMagnitude = Math.hypot(...joint.axis)
    if (!Number.isFinite(axisMagnitude) || axisMagnitude === 0) {
      failMechanismV1('JOINT_AXIS_NOT_NORMALIZABLE', `$.joints[${index}].axis`, 'Movable Joint axis must be finite and non-zero.')
    }
    if (!Number.isFinite(joint.minimum)) failMechanismV1('JOINT_LIMIT_INVALID', `$.joints[${index}].minimum`, 'Joint minimum must be finite.')
    if (!Number.isFinite(joint.maximum)) failMechanismV1('JOINT_LIMIT_INVALID', `$.joints[${index}].maximum`, 'Joint maximum must be finite.')
    if (!Number.isFinite(joint.home)) failMechanismV1('JOINT_LIMIT_INVALID', `$.joints[${index}].home`, 'Joint home must be finite.')
    if (!Number.isFinite(joint.zeroOffset)) failMechanismV1('JOINT_LIMIT_INVALID', `$.joints[${index}].zeroOffset`, 'Joint zero offset must be finite.')
    if (joint.minimum > joint.maximum || joint.home < joint.minimum || joint.home > joint.maximum) {
      failMechanismV1('JOINT_LIMIT_INVALID', `$.joints[${index}]`, 'Joint limits must be ordered and include home.')
    }
    if (!Number.isFinite(joint.maximumVelocity) || joint.maximumVelocity < 0) {
      failMechanismV1('JOINT_LIMIT_INVALID', `$.joints[${index}].maximumVelocity`, 'Joint maximum velocity must be non-negative and finite.')
    }
    if (joint.direction !== 1 && joint.direction !== -1) {
      failMechanismV1('JOINT_DIRECTION_INVALID', `$.joints[${index}].direction`, 'Joint direction must be 1 or -1.')
    }
  }

  const roots = [...bodyIds].filter((bodyId) => !incomingBodies.has(bodyId))
  if (roots.length !== 1) failMechanismV1('MECHANISM_TOPOLOGY_INVALID', '$.joints', 'A Tree must have exactly one root Body.')
  const rootBodyId = roots[0]!
  const childrenByParent = new Map<string, readonly MechanismJointV1[]>()
  for (const joint of definition.joints) {
    childrenByParent.set(joint.parentBodyId, [...(childrenByParent.get(joint.parentBodyId) ?? []), joint])
  }
  const visited = new Set<string>()
  const visit = (bodyId: string): void => {
    if (visited.has(bodyId)) failMechanismV1('MECHANISM_TOPOLOGY_INVALID', '$.joints', 'Body graph contains a cycle.')
    visited.add(bodyId)
    for (const joint of childrenByParent.get(bodyId) ?? []) visit(joint.childBodyId)
  }
  visit(rootBodyId)
  if (visited.size !== bodyIds.size) failMechanismV1('MECHANISM_TOPOLOGY_INVALID', '$.joints', 'Body graph is disconnected.')

  return rootBodyId
}

export function compileTreeMechanismDefinitionV1(
  definition: MechanismDefinitionV1,
): CompiledTreeMechanismV1 {
  validateDefinitionShape(definition)
  const rootBodyId = validateBodyAndJointGraph(definition)
  const frameIds = validateFrames(definition)
  validateTreeReferences(definition, frameIds)
  const normalized = cloneDefinition(definition)
  const childrenByParent = new Map<string, MechanismJointV1[]>()
  for (const joint of normalized.joints) {
    const children = childrenByParent.get(joint.parentBodyId) ?? []
    children.push(joint)
    childrenByParent.set(joint.parentBodyId, children)
  }
  for (const children of childrenByParent.values()) children.sort((left, right) => compareStableIds(left.jointId, right.jointId))

  const traversal: { jointId: string, parentBodyId: string, childBodyId: string }[] = []
  const visit = (bodyId: string): void => {
    for (const joint of childrenByParent.get(bodyId) ?? []) {
      traversal.push({ jointId: joint.jointId, parentBodyId: joint.parentBodyId, childBodyId: joint.childBodyId })
      visit(joint.childBodyId)
    }
  }
  visit(rootBodyId)

  return Object.freeze({
    definition: normalized,
    rootBodyId,
    movableJointIds: Object.freeze(normalized.joints
      .filter((joint) => joint.jointType !== 'fixed')
      .map(({ jointId }) => jointId)
      .sort(compareStableIds)),
    traversal: Object.freeze(traversal.map((entry) => Object.freeze(entry))),
  })
}
