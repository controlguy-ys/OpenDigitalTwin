import { describe, expect, it } from 'vitest'
import {
  CUP_PROFILE_POINTS,
  CUP_VISUAL,
  MACHINE_VISUAL,
} from './BuiltInEquipment'
import { BUILT_IN_EQUIPMENT } from './equipment-store'

describe('built-in equipment visuals', () => {
  it('keeps the lathed cup profile open at the rim while placing water below it', () => {
    const firstPoint = CUP_PROFILE_POINTS[0]
    const rimPoint = CUP_PROFILE_POINTS.at(-1)

    expect(firstPoint?.[0]).toBeGreaterThan(0)
    expect(rimPoint?.[0]).toBeGreaterThan(0)
    expect(rimPoint?.[1]).toBe(CUP_VISUAL.height)
    expect(CUP_VISUAL.waterZ).toBeGreaterThan(0)
    expect(CUP_VISUAL.waterZ).toBeLessThan(CUP_VISUAL.height)
    expect(CUP_VISUAL.waterColor).toBe('#2d9cdb')
  })

  it('keeps the steel cabinet dimensions aligned with its collision bounds', () => {
    expect(MACHINE_VISUAL.size).toEqual(
      MACHINE_VISUAL.collisionHalfExtents.map((extent) => extent * 2),
    )
    expect(
      BUILT_IN_EQUIPMENT.find(({ id }) => id === 'machine-01')
        ?.collisionHalfExtents,
    ).toEqual(MACHINE_VISUAL.collisionHalfExtents)
  })
})
