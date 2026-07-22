import { failProjectV5 } from '../project-v5/errors.js'
import { MAX_ROBOT_JOINTS_V5, MIN_ROBOT_JOINTS_V5 } from '../project-v5/limits.js'
import {
  composeRigidTransformV5,
  normalizeRigidTransformV5,
  type RigidTransformV5,
  type Vector3V5,
} from '../project-v5/rigid-transform.js'
import type {
  FrameDefinitionV5,
  RobotDefinitionV5,
  RobotJointDefinitionV5,
  RobotLinkDefinitionV5,
} from '../project-v5/types.js'
import type { RobotMechanicsDraftJointV1, RobotMechanicsDraftV1 } from './robot-mechanics-draft.js'

interface DraftGraph {
  readonly rootLinkId: string
  readonly linksById: ReadonlyMap<string, RobotLinkDefinitionV5>
  readonly jointsByParent: ReadonlyMap<string, readonly RobotMechanicsDraftJointV1[]>
  readonly framesById: ReadonlyMap<string, FrameDefinitionV5>
}

interface CollapsedLinkLocation {
  readonly retainedLinkId: string
  readonly retainedFromLink: RigidTransformV5
}

interface CollapsedMechanics {
  readonly links: readonly RobotLinkDefinitionV5[]
  readonly movableJoints: readonly RobotJointDefinitionV5[]
  readonly frames: readonly FrameDefinitionV5[]
}

function invalid(code: string, path: string, message: string): never {
  failProjectV5(code, path, message, 'Correct the Robot mechanics draft and try again.')
}

function identity(): RigidTransformV5 {
  return { positionM: [0, 0, 0], quaternion: [0, 0, 0, 1] }
}

function finitePose(value: unknown, path: string): RigidTransformV5 {
  if (value === null || typeof value !== 'object') invalid('PROJECT_VALUE_INVALID', path, 'Rigid transform must be an object.')
  const record = value as { positionM?: unknown; quaternion?: unknown }
  if (!Array.isArray(record.positionM) || record.positionM.length !== 3 || !Array.isArray(record.quaternion) || record.quaternion.length !== 4
    || record.positionM.some((component) => typeof component !== 'number' || !Number.isFinite(component))
    || record.quaternion.some((component) => typeof component !== 'number' || !Number.isFinite(component))) {
    invalid('PROJECT_VALUE_INVALID', path, 'Rigid transform components must be finite tuples.')
  }
  return normalizeRigidTransformV5({
    positionM: [record.positionM[0] as number, record.positionM[1] as number, record.positionM[2] as number],
    quaternion: [record.quaternion[0] as number, record.quaternion[1] as number, record.quaternion[2] as number, record.quaternion[3] as number],
  }, path)
}

function finiteAxis(value: unknown, path: string): Vector3V5 {
  if (!Array.isArray(value) || value.length !== 3 || value.some((component) => typeof component !== 'number' || !Number.isFinite(component))) {
    invalid('JOINT_AXIS_NOT_NORMALIZABLE', path, 'Joint axis must be a finite three-component vector.')
  }
  const axis: Vector3V5 = [value[0] as number, value[1] as number, value[2] as number]
  if (Math.hypot(...axis) === 0) invalid('JOINT_AXIS_NOT_NORMALIZABLE', path, 'Joint axis must be non-zero.')
  return axis
}

function finiteNumber(value: unknown, code: string, path: string, message: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) invalid(code, path, message)
  return value
}

function validateJoint(joint: RobotMechanicsDraftJointV1, index: number): RobotMechanicsDraftJointV1 {
  const path = `$.draft.joints[${index}]`
  if (typeof joint.id !== 'string' || joint.id.length === 0) invalid('PROJECT_ID_INVALID', `${path}.id`, 'Joint id must be a non-empty string.')
  if (typeof joint.parentLinkId !== 'string' || typeof joint.childLinkId !== 'string') {
    invalid('ROBOT_LINK_NOT_FOUND', path, 'Joint Link references must be strings.')
  }
  finitePose(joint.origin, `${path}.origin`)
  finiteNumber(joint.zeroOffset, 'ROBOT_JOINT_VALUE_NOT_FINITE', `${path}.zeroOffset`, 'Joint zero offset must be finite.')
  if (joint.direction !== 1 && joint.direction !== -1) invalid('ROBOT_JOINT_DIRECTION_INVALID', `${path}.direction`, 'Joint direction must be 1 or -1.')
  if (joint.type === 'fixed') {
    if (joint.axis !== null || joint.min !== null || joint.max !== null || joint.home !== null || joint.maximumVelocity !== null) {
      invalid('FIXED_JOINT_FIELDS_INVALID', path, 'Fixed Joints must not define an axis, limits, home, or maximum velocity.')
    }
    return joint
  }
  if (joint.type !== 'revolute' && joint.type !== 'prismatic') {
    invalid('ROBOT_JOINT_TYPE_UNSUPPORTED', `${path}.type`, `Joint type ${String(joint.type)} is not supported.`)
  }
  finiteAxis(joint.axis, `${path}.axis`)
  const min = finiteNumber(joint.min, 'ROBOT_JOINT_LIMIT_INVALID', `${path}.min`, 'Joint limits must be finite.')
  const max = finiteNumber(joint.max, 'ROBOT_JOINT_LIMIT_INVALID', `${path}.max`, 'Joint limits must be finite.')
  const home = finiteNumber(joint.home, 'ROBOT_JOINT_LIMIT_INVALID', `${path}.home`, 'Joint home must be finite.')
  const maximumVelocity = finiteNumber(joint.maximumVelocity, 'ROBOT_JOINT_LIMIT_INVALID', `${path}.maximumVelocity`, 'Joint maximum velocity must be finite.')
  if (min > max || home < min || home > max || maximumVelocity <= 0) {
    invalid('ROBOT_JOINT_LIMIT_INVALID', path, 'Movable Joint limits must be ordered, contain home, and have positive maximum velocity.')
  }
  return joint
}

function validateDraftGraph(draft: RobotMechanicsDraftV1): DraftGraph {
  const linksById = new Map<string, RobotLinkDefinitionV5>()
  draft.links.forEach((link, index) => {
    if (typeof link.id !== 'string' || link.id.length === 0) invalid('PROJECT_ID_INVALID', `$.draft.links[${index}].id`, 'Link id must be a non-empty string.')
    if (linksById.has(link.id)) invalid('PROJECT_ID_DUPLICATE', `$.draft.links[${index}].id`, `Link id ${link.id} is duplicated.`)
    linksById.set(link.id, link)
  })
  if (linksById.size === 0) invalid('ROBOT_JOINT_CHAIN_INVALID', '$.draft.links', 'Robot mechanics draft must include Links.')

  const ids = new Set<string>(linksById.keys())
  const incoming = new Map<string, number>([...linksById.keys()].map((id) => [id, 0]))
  const jointsByParent = new Map<string, RobotMechanicsDraftJointV1[]>()
  draft.joints.forEach((joint, index) => {
    validateJoint(joint, index)
    if (ids.has(joint.id)) invalid('PROJECT_ID_DUPLICATE', `$.draft.joints[${index}].id`, `Definition-local id ${joint.id} is duplicated.`)
    ids.add(joint.id)
    if (!linksById.has(joint.parentLinkId) || !linksById.has(joint.childLinkId)) {
      invalid('ROBOT_LINK_NOT_FOUND', `$.draft.joints[${index}]`, 'Joint Link does not exist.')
    }
    if (joint.parentLinkId === joint.childLinkId) invalid('KINEMATIC_CYCLE', `$.draft.joints[${index}]`, 'Joint cannot connect a Link to itself.')
    incoming.set(joint.childLinkId, incoming.get(joint.childLinkId)! + 1)
    const siblings = jointsByParent.get(joint.parentLinkId) ?? []
    siblings.push(joint)
    jointsByParent.set(joint.parentLinkId, siblings)
  })
  if ([...incoming.values()].some((count) => count > 1)) {
    invalid('ROBOT_JOINT_CHAIN_INVALID', '$.draft.joints', 'Each Link may have at most one parent Joint.')
  }

  const visited = new Set<string>()
  const visiting = new Set<string>()
  const visitLink = (linkId: string): void => {
    if (visiting.has(linkId)) invalid('KINEMATIC_CYCLE', '$.draft.joints', 'Robot Joint graph must be acyclic.')
    if (visited.has(linkId)) return
    visiting.add(linkId)
    for (const joint of jointsByParent.get(linkId) ?? []) visitLink(joint.childLinkId)
    visiting.delete(linkId)
    visited.add(linkId)
  }
  for (const linkId of linksById.keys()) visitLink(linkId)

  const roots = [...linksById.keys()].filter((linkId) => incoming.get(linkId) === 0)
  if (roots.length !== 1) invalid('ROBOT_JOINT_CHAIN_INVALID', '$.draft.joints', 'Robot Joint graph must have exactly one root Link.')
  const reachable = new Set<string>()
  const visitReachable = (linkId: string): void => {
    if (reachable.has(linkId)) return
    reachable.add(linkId)
    for (const joint of jointsByParent.get(linkId) ?? []) visitReachable(joint.childLinkId)
  }
  visitReachable(roots[0]!)
  if (reachable.size !== linksById.size) invalid('ROBOT_JOINT_CHAIN_INVALID', '$.draft.joints', 'Robot Joint graph must be connected.')

  const framesById = new Map<string, FrameDefinitionV5>()
  draft.frames.forEach((frame, index) => {
    if (ids.has(frame.id)) invalid('PROJECT_ID_DUPLICATE', `$.draft.frames[${index}].id`, `Definition-local id ${frame.id} is duplicated.`)
    ids.add(frame.id); framesById.set(frame.id, frame)
    finitePose(frame.localPose, `$.draft.frames[${index}].localPose`)
  })
  const visitingFrames = new Set<string>()
  const visitedFrames = new Set<string>()
  const visitFrame = (frameId: string): void => {
    if (visitingFrames.has(frameId)) invalid('FRAME_CYCLE', '$.draft.frames', `Frame ${frameId} participates in a cycle.`)
    if (visitedFrames.has(frameId)) return
    const frame = framesById.get(frameId)!
    if (frame.parentFrameId === null || (!linksById.has(frame.parentFrameId) && !framesById.has(frame.parentFrameId))) {
      invalid('FRAME_PARENT_NOT_FOUND', `$.draft.frames.${frame.id}.parentFrameId`, 'Frame parent does not exist.')
    }
    visitingFrames.add(frameId)
    if (framesById.has(frame.parentFrameId)) visitFrame(frame.parentFrameId)
    visitingFrames.delete(frameId); visitedFrames.add(frameId)
  }
  for (const frameId of framesById.keys()) visitFrame(frameId)
  return { rootLinkId: roots[0]!, linksById, jointsByParent, framesById }
}

function collapseFixedOnlySegments(graph: DraftGraph): CollapsedMechanics {
  const containsMovable = new Map<string, boolean>()
  const subtreeContainsMovable = (linkId: string): boolean => {
    const prior = containsMovable.get(linkId)
    if (prior !== undefined) return prior
    const result = (graph.jointsByParent.get(linkId) ?? []).some((joint) => joint.type !== 'fixed' || subtreeContainsMovable(joint.childLinkId))
    containsMovable.set(linkId, result)
    return result
  }
  const retainedLinkOrder: string[] = []
  const retainedLinks = new Map<string, RobotLinkDefinitionV5>()
  const geometryByRetainedLink = new Map<string, RobotLinkDefinitionV5['geometryOccurrences'][number][]>()
  const locations = new Map<string, CollapsedLinkLocation>()
  const movableJoints: RobotJointDefinitionV5[] = []

  const addGeometry = (linkId: string, retainedLinkId: string, retainedFromLink: RigidTransformV5): void => {
    const link = graph.linksById.get(linkId)!
    const occurrences = geometryByRetainedLink.get(retainedLinkId)!
    link.geometryOccurrences.forEach((occurrence, index) => {
      occurrences.push({ ...occurrence, linkLocalPose: composeRigidTransformV5(retainedFromLink, finitePose(occurrence.linkLocalPose, `$.draft.links.${linkId}.geometryOccurrences[${index}].linkLocalPose`)) })
    })
  }
  const addRetainedLink = (linkId: string): void => {
    retainedLinkOrder.push(linkId)
    retainedLinks.set(linkId, graph.linksById.get(linkId)!)
    geometryByRetainedLink.set(linkId, [])
  }
  const traverse = (linkId: string, retainedLinkId: string, retainedFromLink: RigidTransformV5): void => {
    locations.set(linkId, { retainedLinkId, retainedFromLink })
    addGeometry(linkId, retainedLinkId, retainedFromLink)
    const outgoing = graph.jointsByParent.get(linkId) ?? []
    const movingBranches = outgoing.filter((joint) => joint.type !== 'fixed' || subtreeContainsMovable(joint.childLinkId))
    if (movingBranches.length > 1) {
      invalid('MOVABLE_BRANCH_UNSUPPORTED', `$.draft.joints.${linkId}`, 'A Robot mechanics draft may have only one branch containing movable Joints.')
    }
    for (const joint of outgoing) {
      const jointOrigin = finitePose(joint.origin, `$.draft.joints.${joint.id}.origin`)
      if (joint.type === 'fixed') {
        traverse(joint.childLinkId, retainedLinkId, composeRigidTransformV5(retainedFromLink, jointOrigin))
        continue
      }
      const axis = finiteAxis(joint.axis, `$.draft.joints.${joint.id}.axis`)
      const min = joint.min!
      const max = joint.max!
      const home = joint.home!
      const maximumVelocity = joint.maximumVelocity!
      movableJoints.push({
        id: joint.id,
        type: joint.type,
        parentLinkId: retainedLinkId,
        childLinkId: joint.childLinkId,
        origin: composeRigidTransformV5(retainedFromLink, jointOrigin),
        axis,
        min,
        max,
        home,
        zeroOffset: joint.zeroOffset,
        direction: joint.direction,
        maximumVelocity,
      })
      addRetainedLink(joint.childLinkId)
      traverse(joint.childLinkId, joint.childLinkId, identity())
    }
  }

  addRetainedLink(graph.rootLinkId)
  traverse(graph.rootLinkId, graph.rootLinkId, identity())
  if (movableJoints.length < MIN_ROBOT_JOINTS_V5 || movableJoints.length > MAX_ROBOT_JOINTS_V5) {
    invalid('ROBOT_JOINT_CHAIN_INVALID', '$.draft.joints', `A serial Robot requires ${MIN_ROBOT_JOINTS_V5} to ${MAX_ROBOT_JOINTS_V5} movable Joints.`)
  }
  const frames = [...graph.framesById.values()].map((frame) => {
    const location = locations.get(frame.parentFrameId ?? '')
    if (location === undefined) return { ...frame, localPose: finitePose(frame.localPose, `$.draft.frames.${frame.id}.localPose`) }
    return {
      ...frame,
      parentFrameId: location.retainedLinkId,
      localPose: composeRigidTransformV5(location.retainedFromLink, finitePose(frame.localPose, `$.draft.frames.${frame.id}.localPose`)),
    }
  })
  const links = retainedLinkOrder.map((linkId) => ({
    ...retainedLinks.get(linkId)!,
    geometryOccurrences: geometryByRetainedLink.get(linkId)!,
  }))
  return { links, movableJoints, frames }
}

export function canonicalizeRobotMechanicsV5(
  draft: RobotMechanicsDraftV1,
): Pick<RobotDefinitionV5, 'links' | 'joints' | 'frames'> {
  const graph = validateDraftGraph(draft)
  const collapsed = collapseFixedOnlySegments(graph)
  return Object.freeze({
    links: Object.freeze(collapsed.links),
    joints: Object.freeze(collapsed.movableJoints),
    frames: Object.freeze(collapsed.frames),
  })
}
