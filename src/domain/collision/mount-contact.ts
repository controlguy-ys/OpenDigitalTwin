import {
  canonicalCollisionPairKeyV4,
  robotAdjacencyPairKeysV4,
  robotLinkCollisionIdV4,
  rootRobotLinkIdV4,
  spatialEntityCollisionIdV4,
  type CollisionPairKeyV4,
} from '../../core/robot-runtime/collision-identity'
import type {
  RobotDefinitionV4,
  RobotInstanceV4,
} from '../../core/project-v4/types'
import type { RobotMountContactV1 } from '../project/scene-state-v1'
import {
  pairKey,
  validateCollisionPolicyV4,
  type CollisionEntityCategory,
  type CollisionPolicyV4,
} from './collision'

export interface MountContactParticipant {
  readonly id: string
  readonly category: CollisionEntityCategory
}

const MOUNT_SURFACE_CATEGORIES = new Set<CollisionEntityCategory>([
  'environment',
  'equipment',
  'object',
])

export function deriveMountContactPairKey(
  configuration: RobotMountContactV1 | null,
  participants: readonly MountContactParticipant[],
): string | null {
  const surfaceId = configuration?.mountSurfaceCollisionEntityId ?? null
  if (configuration === null || surfaceId === null) return null

  const baseId = `robot-link:${configuration.baseLinkId}`
  const base = participants.find(({ id }) => id === baseId)
  const surface = participants.find(({ id }) => id === surfaceId)
  if (
    base?.category !== 'robot-link' ||
    surface === undefined ||
    !MOUNT_SURFACE_CATEGORIES.has(surface.category) ||
    base.id === surface.id
  ) {
    return null
  }
  return pairKey(base.id, surface.id)
}

export function intentionalMountPairKeyV4(
  robot: RobotInstanceV4,
  definition: RobotDefinitionV4,
): CollisionPairKeyV4 | null {
  if (robot.definitionId !== definition.id) {
    throw new Error(`Robot ${robot.id} references a mismatched Robot Definition.`)
  }
  if (robot.intentionalMountEntityId === null) return null
  return canonicalCollisionPairKeyV4(
    robotLinkCollisionIdV4(robot.id, rootRobotLinkIdV4(definition)),
    spatialEntityCollisionIdV4(robot.intentionalMountEntityId),
  )
}

export function deriveCollisionPolicyV4(
  robots: readonly RobotInstanceV4[],
  definitions: readonly RobotDefinitionV4[],
  options: {
    readonly enabled: boolean
    readonly nearMissMarginM: number
  },
): CollisionPolicyV4 {
  const definitionsById = new Map<string, RobotDefinitionV4>()
  for (const definition of definitions) {
    if (definitionsById.has(definition.id)) {
      throw new Error(`Duplicate Robot Definition id: ${definition.id}`)
    }
    definitionsById.set(definition.id, definition)
  }

  const robotIds = new Set<string>()
  const excludedPairKeys = new Set<CollisionPairKeyV4>()
  const intentionalMountPairKeys = new Set<CollisionPairKeyV4>()
  for (const robot of robots) {
    if (robotIds.has(robot.id)) {
      throw new Error(`Duplicate Robot Instance id: ${robot.id}`)
    }
    robotIds.add(robot.id)
    const definition = definitionsById.get(robot.definitionId)
    if (definition === undefined) {
      throw new Error(`Robot ${robot.id} references missing Definition ${robot.definitionId}.`)
    }
    for (const key of robotAdjacencyPairKeysV4(robot.id, definition)) {
      excludedPairKeys.add(key)
    }
    const mountPair = intentionalMountPairKeyV4(robot, definition)
    if (mountPair !== null) intentionalMountPairKeys.add(mountPair)
  }

  return validateCollisionPolicyV4({
    enabled: options.enabled,
    nearMissMarginM: options.nearMissMarginM,
    excludedPairKeys,
    intentionalMountPairKeys,
    ignoredContactPairKeys: new Set(),
  })
}
