import { failProjectV4 } from '../project-v4/errors.js'
import type { RobotDefinitionV4 } from '../project-v4/types.js'

export type RobotLinkCollisionEntityIdV4 = `robot-link:${string}:${string}`
export type ToolCollisionEntityIdV4 = `tool:${string}:${string}`
export type SpatialEntityCollisionEntityIdV4 = `spatial-entity:${string}`
export type CollisionEntityIdV4 =
  | RobotLinkCollisionEntityIdV4
  | ToolCollisionEntityIdV4
  | SpatialEntityCollisionEntityIdV4
export type CollisionPairKeyV4 = `${string}|${string}`

function invalidIdentity(message: string): never {
  throw new Error(`Collision V4 identity must be canonical: ${message}`)
}

function invalidDefinition(
  code: string,
  path: string,
  message: string,
): never {
  failProjectV4(
    code,
    path,
    message,
    'Provide one connected serial Robot chain with one root Link.',
  )
}

function invalidChain(message: string): never {
  invalidDefinition('ROBOT_JOINT_CHAIN_INVALID', '$.definition.joints', message)
}

export function encodeRuntimeIdentitySegmentV4(value: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error('Runtime identity segment must not be empty.')
  }
  try {
    return encodeURIComponent(value)
  } catch {
    throw new Error('Runtime identity segment must contain valid Unicode.')
  }
}

export function decodeRuntimeIdentitySegmentV4(value: string): string | null {
  if (typeof value !== 'string' || value.length === 0) return null
  try {
    const decoded = decodeURIComponent(value)
    return decoded.length > 0 && encodeURIComponent(decoded) === value
      ? decoded
      : null
  } catch {
    return null
  }
}

export function robotLinkCollisionIdV4(
  robotId: string,
  linkId: string,
): RobotLinkCollisionEntityIdV4 {
  return `robot-link:${encodeRuntimeIdentitySegmentV4(robotId)}:${encodeRuntimeIdentitySegmentV4(linkId)}`
}

export function toolCollisionIdV4(
  robotId: string,
  toolFrameId: string,
): ToolCollisionEntityIdV4 {
  return `tool:${encodeRuntimeIdentitySegmentV4(robotId)}:${encodeRuntimeIdentitySegmentV4(toolFrameId)}`
}

export function spatialEntityCollisionIdV4(
  entityId: string,
): SpatialEntityCollisionEntityIdV4 {
  return `spatial-entity:${encodeRuntimeIdentitySegmentV4(entityId)}`
}

export function parseRobotLinkCollisionIdV4(
  value: string,
): { readonly robotId: string; readonly linkId: string } | null {
  if (typeof value !== 'string' || !value.startsWith('robot-link:')) return null
  const segments = value.slice('robot-link:'.length).split(':')
  if (segments.length !== 2) return null
  const robotId = decodeRuntimeIdentitySegmentV4(segments[0]!)
  const linkId = decodeRuntimeIdentitySegmentV4(segments[1]!)
  return robotId === null || linkId === null
    ? null
    : Object.freeze({ robotId, linkId })
}

function isCanonicalToolId(value: string): value is ToolCollisionEntityIdV4 {
  if (!value.startsWith('tool:')) return false
  const segments = value.slice('tool:'.length).split(':')
  return segments.length === 2
    && decodeRuntimeIdentitySegmentV4(segments[0]!) !== null
    && decodeRuntimeIdentitySegmentV4(segments[1]!) !== null
}

function isCanonicalSpatialId(
  value: string,
): value is SpatialEntityCollisionEntityIdV4 {
  if (!value.startsWith('spatial-entity:')) return false
  const segments = value.slice('spatial-entity:'.length).split(':')
  return segments.length === 1
    && decodeRuntimeIdentitySegmentV4(segments[0]!) !== null
}

function requireCanonicalCollisionId(
  value: string,
): asserts value is CollisionEntityIdV4 {
  if (typeof value !== 'string') {
    invalidIdentity(String(value))
  }
  if (
    parseRobotLinkCollisionIdV4(value) === null
    && !isCanonicalToolId(value)
    && !isCanonicalSpatialId(value)
  ) {
    invalidIdentity(value)
  }
}

export function canonicalCollisionPairKeyV4(
  first: CollisionEntityIdV4,
  second: CollisionEntityIdV4,
): CollisionPairKeyV4 {
  requireCanonicalCollisionId(first)
  requireCanonicalCollisionId(second)
  return first <= second
    ? `${first}|${second}`
    : `${second}|${first}`
}

interface SerialChainFacts {
  readonly rootLinkId: string
  readonly linkIds: ReadonlySet<string>
}

function inspectSerialChain(definition: RobotDefinitionV4): SerialChainFacts {
  if (!Array.isArray(definition.links) || !Array.isArray(definition.joints)) {
    invalidChain('Robot Definition Links and Joints must be arrays.')
  }
  const linkIds = new Set<string>()
  const localIds = new Set<string>()
  for (const [index, link] of definition.links.entries()) {
    if (typeof link.id !== 'string' || link.id.length === 0) {
      invalidChain('Robot Definition Link ids must be non-empty.')
    }
    if (localIds.has(link.id)) {
      invalidDefinition(
        'PROJECT_ID_DUPLICATE',
        `$.definition.links[${index}].id`,
        `Definition-local id ${link.id} is duplicated.`,
      )
    }
    localIds.add(link.id)
    linkIds.add(link.id)
  }
  if (linkIds.size < 2 || definition.joints.length !== linkIds.size - 1) {
    invalidChain('Robot Definition must contain one Joint between each serial Link.')
  }

  const children = new Set<string>()
  const childByParent = new Map<string, string>()
  for (const [index, joint] of definition.joints.entries()) {
    if (localIds.has(joint.id)) {
      invalidDefinition(
        'PROJECT_ID_DUPLICATE',
        `$.definition.joints[${index}].id`,
        `Definition-local id ${joint.id} is duplicated.`,
      )
    }
    localIds.add(joint.id)
    if (!linkIds.has(joint.parentLinkId)) {
      invalidDefinition(
        'ROBOT_LINK_NOT_FOUND',
        `$.definition.joints[${index}].parentLinkId`,
        `Link ${joint.parentLinkId} does not exist.`,
      )
    }
    if (!linkIds.has(joint.childLinkId)) {
      invalidDefinition(
        'ROBOT_LINK_NOT_FOUND',
        `$.definition.joints[${index}].childLinkId`,
        `Link ${joint.childLinkId} does not exist.`,
      )
    }
    if (
      joint.parentLinkId === joint.childLinkId
      || children.has(joint.childLinkId)
      || childByParent.has(joint.parentLinkId)
    ) {
      invalidChain('Robot Definition Joints must form one non-branching Link chain.')
    }
    children.add(joint.childLinkId)
    childByParent.set(joint.parentLinkId, joint.childLinkId)
  }

  const roots = [...linkIds].filter((linkId) => !children.has(linkId))
  if (roots.length !== 1) {
    invalidChain('Robot Definition must have exactly one root Link.')
  }
  const rootLinkId = roots[0]!
  const visited = new Set<string>()
  let current: string | undefined = rootLinkId
  while (current !== undefined && !visited.has(current)) {
    visited.add(current)
    current = childByParent.get(current)
  }
  if (visited.size !== linkIds.size || current !== undefined) {
    invalidChain('Robot Definition Link chain must be connected and acyclic.')
  }
  for (const [index, frame] of definition.frames.entries()) {
    if (localIds.has(frame.id)) {
      invalidDefinition(
        'PROJECT_ID_DUPLICATE',
        `$.definition.frames[${index}].id`,
        `Definition-local id ${frame.id} is duplicated.`,
      )
    }
    localIds.add(frame.id)
  }
  return { rootLinkId, linkIds }
}

export function rootRobotLinkIdV4(definition: RobotDefinitionV4): string {
  return inspectSerialChain(definition).rootLinkId
}

export function robotAdjacencyPairKeysV4(
  robotId: string,
  definition: RobotDefinitionV4,
): ReadonlySet<CollisionPairKeyV4> {
  encodeRuntimeIdentitySegmentV4(robotId)
  inspectSerialChain(definition)
  return new Set(definition.joints.map((joint) => canonicalCollisionPairKeyV4(
    robotLinkCollisionIdV4(robotId, joint.parentLinkId),
    robotLinkCollisionIdV4(robotId, joint.childLinkId),
  )))
}
