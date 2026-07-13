import type { RobotLinkId } from '../../domain/robot/crb15000'
import type { CollisionFinding } from '../../domain/collision/collision'
import type {
  CollisionEntityId,
  CollisionPairKey,
  SceneSelection,
  ExternalCollisionEntityId,
} from './interaction-store'

export type OutlineState = 'selection' | 'collision' | 'near-miss' | null

type OutlineFinding = CollisionPairKey | CollisionFinding

function findingPairKey(finding: OutlineFinding): string {
  return typeof finding === 'string' ? finding : finding.pairKey
}

function entityParticipates(entityId: string, pair: string): boolean {
  return pair.startsWith(`${entityId}|`) || pair.endsWith(`|${entityId}`)
}

export function hasActiveCollision(
  entityId: CollisionEntityId,
  pairs: readonly OutlineFinding[],
): boolean {
  return pairs.some(
    (finding) => {
      if (typeof finding !== 'string' && finding.kind !== 'collision') {
        return false
      }
      return entityParticipates(entityId, findingPairKey(finding))
    },
  )
}

function findingOutlineState(
  entityId: CollisionEntityId,
  findings: readonly OutlineFinding[],
): Extract<OutlineState, 'collision' | 'near-miss'> | null {
  let result: Extract<OutlineState, 'collision' | 'near-miss'> | null = null
  for (const finding of findings) {
    const pair = findingPairKey(finding)
    if (!entityParticipates(entityId, pair)) continue
    const kind = typeof finding === 'string' ? 'collision' : finding.kind
    if (kind === 'collision') return 'collision'
    result = 'near-miss'
  }
  return result
}

export function getEquipmentOutlineState(
  equipmentId: string,
  selected: boolean,
  pairs: readonly OutlineFinding[],
): OutlineState {
  const finding = findingOutlineState(
    `equipment:${equipmentId}`,
    pairs,
  )
  if (finding !== null) return finding
  return selected ? 'selection' : null
}

export function getExternalEntityOutlineState(
  entityId: ExternalCollisionEntityId | CollisionEntityId,
  selected: boolean,
  pairs: readonly OutlineFinding[],
): OutlineState {
  const finding = findingOutlineState(entityId, pairs)
  return finding ?? (selected ? 'selection' : null)
}

export function getRobotLinkOutlineState(
  selection: SceneSelection,
  linkId: RobotLinkId,
  pairs: readonly OutlineFinding[],
): OutlineState {
  const finding = findingOutlineState(
    `robot-link:${linkId}`,
    pairs,
  )
  if (finding !== null) return finding
  return selection?.kind === 'robot' ||
    (selection?.kind === 'robot-link' && selection.linkId === linkId)
    ? 'selection'
    : null
}
