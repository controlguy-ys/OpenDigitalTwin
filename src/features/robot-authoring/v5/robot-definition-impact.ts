import type { RobotDefinitionV5, WorkcellProjectV5 } from '../../../core/project-v5/index.js'

export interface RobotDefinitionImpactV5 {
  readonly robotIds: readonly string[]
  readonly jobIds: readonly string[]
  readonly mappingIds: readonly string[]
  readonly frameIds: readonly string[]
  readonly requiresMotionRevalidation: boolean
  readonly blockingCodes: readonly string[]
}

function sorted(values: ReadonlySet<string>): readonly string[] {
  return [...values].sort()
}

function freezeReport(report: RobotDefinitionImpactV5): RobotDefinitionImpactV5 {
  return Object.freeze({
    robotIds: Object.freeze([...report.robotIds]),
    jobIds: Object.freeze([...report.jobIds]),
    mappingIds: Object.freeze([...report.mappingIds]),
    frameIds: Object.freeze([...report.frameIds]),
    requiresMotionRevalidation: report.requiresMotionRevalidation,
    blockingCodes: Object.freeze([...report.blockingCodes]),
  })
}

const EMPTY_IMPACT: RobotDefinitionImpactV5 = freezeReport({
  robotIds: [], jobIds: [], mappingIds: [], frameIds: [], requiresMotionRevalidation: false, blockingCodes: [],
})

function byId<T extends { readonly id: string }>(values: readonly T[]): ReadonlyMap<string, T> {
  return new Map(values.map((value) => [value.id, value]))
}

function exactIds(ids: readonly string[], expected: ReadonlyMap<string, unknown>): boolean {
  return ids.length === expected.size && ids.every((id) => expected.has(id))
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
  current: RobotDefinitionV5['joints'][number] | undefined,
  candidate: RobotDefinitionV5['joints'][number] | undefined,
): boolean {
  return current === undefined || candidate === undefined || !equal(
    {
      type: current.type, parentLinkId: current.parentLinkId, childLinkId: current.childLinkId,
      origin: current.origin, axis: current.axis, min: current.min, max: current.max, home: current.home,
      zeroOffset: current.zeroOffset, direction: current.direction, maximumVelocity: current.maximumVelocity,
    },
    {
      type: candidate.type, parentLinkId: candidate.parentLinkId, childLinkId: candidate.childLinkId,
      origin: candidate.origin, axis: candidate.axis, min: candidate.min, max: candidate.max, home: candidate.home,
      zeroOffset: candidate.zeroOffset, direction: candidate.direction, maximumVelocity: candidate.maximumVelocity,
    },
  )
}

function frameMotionChanged(
  current: RobotDefinitionV5['frames'][number] | undefined,
  candidate: RobotDefinitionV5['frames'][number] | undefined,
): boolean {
  return current === undefined || candidate === undefined || !equal(
    { parentFrameId: current.parentFrameId, localPose: current.localPose, role: current.role },
    { parentFrameId: candidate.parentFrameId, localPose: candidate.localPose, role: candidate.role },
  )
}

function descendantsOfLinks(
  currentDefinition: RobotDefinitionV5,
  candidateDefinition: RobotDefinitionV5,
  changedJointIds: ReadonlySet<string>,
  changedLinkIds: ReadonlySet<string>,
): ReadonlySet<string> {
  const currentJoints = byId(currentDefinition.joints)
  const candidateJoints = byId(candidateDefinition.joints)
  const childrenByParent = new Map<string, Set<string>>()
  const links = new Set<string>(changedLinkIds)
  for (const joint of [...currentDefinition.joints, ...candidateDefinition.joints]) {
    const children = childrenByParent.get(joint.parentLinkId) ?? new Set<string>()
    children.add(joint.childLinkId)
    childrenByParent.set(joint.parentLinkId, children)
  }
  for (const jointId of changedJointIds) {
    const current = currentJoints.get(jointId)
    const candidate = candidateJoints.get(jointId)
    if (current !== undefined) links.add(current.childLinkId)
    if (candidate !== undefined) links.add(candidate.childLinkId)
  }
  const pending = [...links]
  while (pending.length > 0) {
    for (const child of childrenByParent.get(pending.pop()!) ?? []) {
      if (!links.has(child)) {
        links.add(child)
        pending.push(child)
      }
    }
  }
  return links
}

function affectedFrames(
  currentDefinition: RobotDefinitionV5,
  candidateDefinition: RobotDefinitionV5,
  changedLinks: ReadonlySet<string>,
): ReadonlySet<string> {
  const currentFrames = byId(currentDefinition.frames)
  const candidateFrames = byId(candidateDefinition.frames)
  const allFrameIds = new Set([...currentFrames.keys(), ...candidateFrames.keys()])
  const affected = new Set<string>()
  for (const frameId of allFrameIds) {
    const current = currentFrames.get(frameId)
    const candidate = candidateFrames.get(frameId)
    if (
      frameMotionChanged(current, candidate)
      || (current?.parentFrameId !== null && current?.parentFrameId !== undefined && changedLinks.has(current.parentFrameId))
      || (candidate?.parentFrameId !== null && candidate?.parentFrameId !== undefined && changedLinks.has(candidate.parentFrameId))
    ) affected.add(frameId)
  }
  let changed = true
  while (changed) {
    changed = false
    for (const frame of [...currentDefinition.frames, ...candidateDefinition.frames]) {
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
  const currentJoints = byId(currentDefinition.joints)
  const currentLinks = byId(currentDefinition.links)
  const changedJointIds = new Set([...currentJoints.keys(), ...candidateJoints.keys()]
    .filter((jointId) => jointMotionChanged(currentJoints.get(jointId), candidateJoints.get(jointId))))
  const changedLinkIds = new Set([...currentLinks.keys(), ...candidateLinks.keys()]
    .filter((linkId) => {
      const current = currentLinks.get(linkId)
      const candidate = candidateLinks.get(linkId)
      return current === undefined || candidate === undefined || !equal(current.geometryOccurrences, candidate.geometryOccurrences)
    }))
  const changedLinks = descendantsOfLinks(currentDefinition, candidateDefinition, changedJointIds, changedLinkIds)
  const frameIds = affectedFrames(currentDefinition, candidateDefinition, changedLinks)
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
    if (!exactIds(Object.keys(robot.initialJointValues), candidateJoints)) jointConflict = true
    const selectedTcp = candidateFrames.get(robot.selectedTcpFrameId)
    if (
      !candidateFrames.has(robot.selectedToolFrameId)
      || selectedTcp === undefined
      || selectedTcp.role !== 'tcp'
      || !exactIds(Object.keys(robot.frameSources), candidateFrames)
      || (robot.numericStatus.overlay.frameId !== null && !candidateFrames.has(robot.numericStatus.overlay.frameId))
    ) frameConflict = true
  }

  for (const job of project.jobs) {
    if (!robotIds.has(job.robotId)) continue
    for (const instruction of job.instructions) {
      if (instruction.kind === 'move-joint' && !exactIds(Object.keys(instruction.jointValues), candidateJoints)) {
        jointConflict = true
      }
      if (instruction.kind === 'attach' && !candidateFrames.has(instruction.toolFrameId)) frameConflict = true
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

  return freezeReport({
    robotIds: sorted(robotIds),
    jobIds: sorted(jobIds),
    mappingIds: sorted(mappingIds),
    frameIds: sorted(frameIds),
    requiresMotionRevalidation,
    blockingCodes: sorted(blockingCodes),
  })
}
