import { describe, expect, it } from 'vitest'
import type { EquipmentStatus } from '../../domain/equipment/equipment'
import { getStackLightRenderState } from './StackLight'

const STATUSES: readonly EquipmentStatus[] = [
  'OFF',
  'RUNNING',
  'WARNING',
  'FAULT',
]

describe('stack-light render state', () => {
  it.each(STATUSES)('activates only the lens selected by %s', (status) => {
    const renderState = getStackLightRenderState(status)
    const activeLenses = renderState.filter(({ active }) => active)

    expect(activeLenses).toHaveLength(status === 'OFF' ? 0 : 1)
    expect(activeLenses.map(({ lens }) => lens)).toEqual(
      status === 'RUNNING'
        ? ['green']
        : status === 'WARNING'
          ? ['yellow']
          : status === 'FAULT'
            ? ['red']
            : [],
    )
  })

  it.each(STATUSES)('uses the approved optical limits for %s', (status) => {
    const renderState = getStackLightRenderState(status)

    for (const lens of renderState) {
      expect(lens.emissiveIntensity).toBe(lens.active ? 2.4 : 0.08)
      if (lens.pointLight !== null) {
        expect(lens.pointLight.intensity).toBeLessThanOrEqual(0.4)
        expect(lens.pointLight.distance).toBeLessThanOrEqual(0.45)
      }
    }
  })
})
