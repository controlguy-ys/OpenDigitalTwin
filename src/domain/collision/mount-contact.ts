import type { RobotMountContactV1 } from '../project/scene-state-v1'
import { pairKey, type CollisionEntityCategory } from './collision'

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
