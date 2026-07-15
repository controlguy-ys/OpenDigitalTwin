import { describe, expect, it } from 'vitest'
import {
  isExternalCollisionRegistrationActive,
  isSceneTransformManuallyOwned,
} from './EquipmentScene'
import { testSceneRuntime } from '../scene/scene-ui-test-fixtures'

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
    expect(
      isExternalCollisionRegistrationActive(
        'equipment:machine-01',
        'machine-01',
        true,
        null,
        ['equipment:machine-01'],
      ),
    ).toBe(false)
  })

  it('allows the transform gizmo only for Manual-owned Scene Entities', () => {
    const runtime = testSceneRuntime()

    expect(isSceneTransformManuallyOwned(runtime, 'object:cup-1')).toBe(true)
    expect(isSceneTransformManuallyOwned(runtime, 'object:live-part')).toBe(false)
  })
})
