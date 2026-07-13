import type { RobotLinkId } from '../../domain/robot/crb15000'
import type {
  CollisionEntityId,
  CollisionPairKey,
  SceneSelection,
  ExternalCollisionEntityId,
} from './interaction-store'

export type OutlineState = 'selection' | 'collision' | null

export function hasActiveCollision(
  entityId: CollisionEntityId,
  pairs: readonly CollisionPairKey[],
): boolean {
  return pairs.some(
    (pair) =>
      pair.startsWith(`${entityId}|`) || pair.endsWith(`|${entityId}`),
  )
}

export function getEquipmentOutlineState(
  equipmentId: string,
  selected: boolean,
  pairs: readonly CollisionPairKey[],
): OutlineState {
  if (hasActiveCollision(`equipment:${equipmentId}`, pairs)) {
    return 'collision'
  }
  return selected ? 'selection' : null
}

export function getExternalEntityOutlineState(
  entityId: ExternalCollisionEntityId,
  selected: boolean,
  pairs: readonly CollisionPairKey[],
): OutlineState {
  return hasActiveCollision(entityId, pairs)
    ? 'collision'
    : selected
      ? 'selection'
      : null
}

export function getRobotLinkOutlineState(
  selection: SceneSelection,
  linkId: RobotLinkId,
  pairs: readonly CollisionPairKey[],
): OutlineState {
  if (hasActiveCollision(`robot-link:${linkId}`, pairs)) {
    return 'collision'
  }
  return selection?.kind === 'robot' ||
    (selection?.kind === 'robot-link' && selection.linkId === linkId)
    ? 'selection'
    : null
}
