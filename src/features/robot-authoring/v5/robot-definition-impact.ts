import type { RobotDefinitionV5, WorkcellProjectV5 } from '../../../core/project-v5/index.js'

export interface RobotDefinitionImpactV5 {
  readonly robotIds: readonly string[]
  readonly jobIds: readonly string[]
  readonly mappingIds: readonly string[]
  readonly frameIds: readonly string[]
  readonly requiresMotionRevalidation: boolean
  readonly blockingCodes: readonly string[]
}

const EMPTY_IMPACT: RobotDefinitionImpactV5 = {
  robotIds: [], jobIds: [], mappingIds: [], frameIds: [], requiresMotionRevalidation: false, blockingCodes: [],
}

function sorted(values: ReadonlySet<string>): readonly string[] {
  return [...values].sort()
}

function byId<T extends { readonly id: string }>(values: readonly T[]): ReadonlyMap<string, T> {
  return new Map(values.map((value) => [value.id, value]))
}

function equal(value: unknown, other: unknown): boolean {
  if (Object.is(value, other)) return true
  if (value === null || other === null || typeof value !== 'object' || typeof other !== 'object') return false
  if (Array.isArray(value) || Array.isArray(other)) {
    return Array.isArray(value)
      && Array.isArray(other)
      && value.length === other.length
      && value.every((item, index) => equal(item, other[index]))
  }
  const keys = Object.keys(value as Record<string, unknown>).sort()
  const otherKeys = Object.keys(other as Record<string, unknown>).sort()
  return keys.length === otherKeys.length
    && keys.every((key, index) => key === otherKeys[index] && equal(
      (value as Record<string, unknown>)[key], (other as Record<string, unknown>)[key],
    ))
}

function jointMotionChanged(
  current: RobotDefinitionV5['joints'][number],
  candidate: RobotDefinitionV5['joints'][number] | undefined,
): boolean {
  return candidate === undefined || !equal(
    {
      type: current.type, parentLinkId: current.parentLinkId, childLinkId: current.childLinkId,
      origin: current.origin, axis: current.axis, min: current.min, max: current.max, home: current.home,
      zeroOffset: current.zeroOffset, direction: current.direction, maximumVelocity: current.maximumVelocity,
    },
    candidate === undefined ? undefined : {
      type: candidate.type, parentLinkId: candidate.parentLinkId, childLinkId: candidate.childLinkId,
      origin: candidate.origin, axis: candidate.axis, min: candidate.min, max: candidate.max, home: candidate.home,
      zeroOffset: candidate.zeroOffset, direction: candidate.direction, maximumVelocity: candidate.maximumVelocity,
    },
  )
}

function frameMotionChanged(
  current: RobotDefinitionV5['frames'][number],
  candidate: RobotDefinitionV5['frames'][number] | undefined,
): boolean {
  return candidate === undefined || !equal(
    { parentFrameId: current.parentFrameId, localPose: current.localPose, role: current.role },
    candidate === undefined ? undefined : { parentFrameId: candidate.parentFrameId, localPose: candidate.localPose, role: candidate.role },
  )
}

function descendantsOfLinks(
  definition: RobotDefinitionV5,
  changedJointIds: ReadonlySet<string>,
  changedLinkIds: ReadonlySet<string>,
): ReadonlySet<string> {
  const childrenByParent = new Map<string, string>()
  const links = new Set<string>(changedLinkIds)
  for (const joint of definition.joints) {
    childrenByParent.set(joint.parentLinkId, joint.childLinkId)
    if (changedJointIds.has(joint.id)) links.add(joint.childLinkId)
  }
  const pending = [...links]
  while (pending.length > 0) {
    const child = childrenByParent.get(pending.pop()!)
    if (child !== undefined && !links.has(child)) {
      links.add(child)
      pending.push(child)
    }
  }
  return links
}

function affectedFrames(
  definition: RobotDefinitionV5,
  candidateFrames: ReadonlyMap<string, RobotDefinitionV5['frames'][number]>,
  changedLinks: ReadonlySet<string>,
): ReadonlySet<string> {
  const affected = new Set<string>()
  for (const frame of definition.frames) {
    if (frameMotionChanged(frame, candidateFrames.get(frame.id)) || (frame.parentFrameId !== null && changedLinks.has(frame.parentFrameId))) affected.add(frame.id)
  }
  let changed = true
  while (changed) {
    changed = false
    for (const frame of definition.frames) {
      if (frame.parentFrameId !== null && affected.has(frame.parentFrameId) && !affected.has(frame.id)) {
        affected.add(frame.id)
        changed = true
      }
    }
  }
  return affected
}

/**
 * Describes the persisted V5 records that would need attention if a canonical
 * Robot Definition were replaced. It reads only its arguments and never repairs
 * an invalid reference; callers must resolve every reported blocking conflict.
 */
export function analyzeRobotDefinitionImpactV5(
  project: WorkcellProjectV5,
  candidateDefinition: RobotDefinitionV5,
): RobotDefinitionImpactV5 {
  const currentDefinition = project.robotDefinitions.find((definition) => definition.id === candidateDefinition.id)
  if (currentDefinition === undefined || equal(currentDefinition, candidateDefinition)) return EMPTY_IMPACT

  const robotIds = new Set(project.robots
    .filter((robot) => robot.definitionId === candidateDefinition.id)
    .map((robot) => robot.id))
  if (robotIds.size === 0) return EMPTY_IMPACT

  const candidateJoints = byId(candidateDefinition.joints)
  const candidateLinks = byId(candidateDefinition.links)
  const candidateFrames = byId(candidateDefinition.frames)
  const changedJointIds = new Set(currentDefinition.joints
    .filter((joint) => jointMotionChanged(joint, candidateJoints.get(joint.id)))
    .map((joint) => joint.id))
  const changedLinkIds = new Set(currentDefinition.links
    .filter((link) => {
      const candidate = candidateLinks.get(link.id)
      return candidate === undefined || !equal(link.geometryOccurrences, candidate.geometryOccurrences)
    })
    .map((link) => link.id))
  const changedLinks = descendantsOfLinks(currentDefinition, changedJointIds, changedLinkIds)
  const frameIds = affectedFrames(currentDefinition, candidateFrames, changedLinks)
  const removedJointIds = new Set(currentDefinition.joints
    .filter((joint) => !candidateJoints.has(joint.id))
    .map((joint) => joint.id))
  const removedFrameIds = new Set(currentDefinition.frames
    .filter((frame) => !candidateFrames.has(frame.id))
    .map((frame) => frame.id))

  const jobIds = new Set(project.jobs.filter((job) => robotIds.has(job.robotId)).map((job) => job.id))
  const mappingIds = new Set<string>()
  let jointConflict = false
  let frameConflict = false

  for (const robot of project.robots) {
    if (!robotIds.has(robot.id)) continue
    if (Object.keys(robot.initialJointValues).some((jointId) => removedJointIds.has(jointId))) jointConflict = true
    if (
      removedFrameIds.has(robot.selectedToolFrameId)
      || removedFrameIds.has(robot.selectedTcpFrameId)
      || Object.keys(robot.frameSources).some((frameId) => removedFrameIds.has(frameId))
      || (robot.numericStatus.overlay.frameId !== null && removedFrameIds.has(robot.numericStatus.overlay.frameId))
    ) frameConflict = true
  }

  for (const job of project.jobs) {
    if (!robotIds.has(job.robotId)) continue
    for (const instruction of job.instructions) {
      if (instruction.kind === 'move-joint' && Object.keys(instruction.jointValues).some((jointId) => removedJointIds.has(jointId))) {
        jointConflict = true
      }
      if (instruction.kind === 'attach' && removedFrameIds.has(instruction.toolFrameId)) frameConflict = true
    }
  }

  for (const mapping of project.opcUa.mappings) {
    for (const leaf of mapping.leaves) {
      const target = leaf.projectTarget
      if (!('robotId' in target) || !robotIds.has(target.robotId)) continue
      if (target.type === 'robot-joint') {
        if (changedJointIds.has(target.jointId)) mappingIds.add(mapping.id)
        if (removedJointIds.has(target.jointId)) jointConflict = true
      }
      if (target.type === 'robot-frame') {
        if (frameIds.has(target.frameId)) mappingIds.add(mapping.id)
        if (removedFrameIds.has(target.frameId)) frameConflict = true
      }
    }
  }

  const blockingCodes = new Set<string>()
  if (jointConflict) blockingCodes.add('JOINT_DEPENDENCY_CONFLICT')
  if (frameConflict) blockingCodes.add('FRAME_DEPENDENCY_CONFLICT')
  const requiresMotionRevalidation = changedJointIds.size > 0 || changedLinkIds.size > 0 || frameIds.size > 0

  return {
    robotIds: sorted(robotIds),
    jobIds: sorted(jobIds),
    mappingIds: sorted(mappingIds),
    frameIds: sorted(frameIds),
    requiresMotionRevalidation,
    blockingCodes: sorted(blockingCodes),
  }
}
