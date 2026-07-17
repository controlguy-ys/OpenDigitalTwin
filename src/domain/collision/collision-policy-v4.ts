import {
  canonicalCollisionPairKeyV4,
  robotAdjacencyPairKeysV4,
  robotLinkCollisionIdV4,
  rootRobotLinkIdV4,
  spatialEntityCollisionIdV4,
  type CollisionPairKeyV4,
} from '../../core/robot-runtime/collision-identity.js'
import type {
  RobotDefinitionV4,
  RobotInstanceV4,
} from '../../core/project-v4/types.js'
import {
  validateCollisionPolicyV4,
  type CollisionPolicyV4,
} from './collision.js'

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
      throw new Error(
        `Robot ${robot.id} references missing Definition ${robot.definitionId}.`,
      )
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
