import { describe, expect, it } from 'vitest'
import { isExternalCollisionRegistrationActive } from './EquipmentScene'

describe('external collision registration visibility', () => {
  it('deactivates only the held Entity when the Robot root is hidden', () => {
    expect(
      isExternalCollisionRegistrationActive(
        'object:held-cup',
        'held-cup',
        true,
        'object:held-cup',
        ['robot'],
      ),
    ).toBe(false)
    expect(
      isExternalCollisionRegistrationActive(
        'object:static-fixture',
        'static-fixture',
        true,
        'object:held-cup',
        ['robot'],
      ),
    ).toBe(true)
  })

  it('respects local visibility and explicit external-Entity hiding', () => {
    expect(
      isExternalCollisionRegistrationActive(
        'equipment:machine-01',
        'machine-01',
        false,
        null,
        [],
      ),
    ).toBe(false)
    expect(
      isExternalCollisionRegistrationActive(
        'equipment:machine-01',
        'machine-01',
        true,
        null,
        ['machine-01'],
      ),
    ).toBe(false)
  })
})
