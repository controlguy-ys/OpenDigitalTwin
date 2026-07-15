import { describe, expect, it } from 'vitest'
import type { RobotMountContactV1 } from '../project/scene-state-v1'
import type { GeometryCollisionEntity } from './collision'
import { deriveMountContactPairKey } from './mount-contact'

function participant(
  id: string,
  category: GeometryCollisionEntity['category'],
): Pick<GeometryCollisionEntity, 'id' | 'category'> {
  return { id, category }
}

const CONFIGURED: RobotMountContactV1 = {
  baseLinkId: 'LINK00',
  mountSurfaceCollisionEntityId: 'workcell:workbench',
}

describe('mount contact derivation', () => {
  it('publishes a canonical pair only when the configured link and surface are active', () => {
    expect(deriveMountContactPairKey(CONFIGURED, [
      participant('workcell:workbench', 'environment'),
      participant('robot-link:LINK00', 'robot-link'),
    ])).toBe('robot-link:LINK00|workcell:workbench')
  })

  it.each([
    ['missing configuration', null, [
      participant('robot-link:LINK00', 'robot-link'),
      participant('workcell:workbench', 'environment'),
    ]],
    ['incomplete surface', { ...CONFIGURED, mountSurfaceCollisionEntityId: null }, [
      participant('robot-link:LINK00', 'robot-link'),
      participant('workcell:workbench', 'environment'),
    ]],
    ['missing base geometry', CONFIGURED, [
      participant('workcell:workbench', 'environment'),
    ]],
    ['missing surface geometry', CONFIGURED, [
      participant('robot-link:LINK00', 'robot-link'),
    ]],
    ['geometry-free surface category', CONFIGURED, [
      participant('robot-link:LINK00', 'robot-link'),
      participant('workcell:workbench', 'robot-link'),
    ]],
  ] as const)('returns null for %s', (_label, configuration, participants) => {
    expect(deriveMountContactPairKey(configuration, participants)).toBeNull()
  })
})
