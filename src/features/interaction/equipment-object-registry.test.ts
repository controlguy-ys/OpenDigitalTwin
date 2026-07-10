import { createRef } from 'react'
import { Group, type Object3D } from 'three'
import { describe, expect, it } from 'vitest'
import { updateEquipmentObjectRegistration } from './equipment-object-registry'

describe('equipment object registration', () => {
  it('keeps the held portal source when the previous world owner unmounts', () => {
    const registry = new Map<string, Object3D>()
    const worldOwner = createRef<Object3D>()
    const heldOwner = createRef<Object3D>()
    const worldObject = new Group()
    const heldObject = new Group()

    updateEquipmentObjectRegistration(
      registry,
      'cup-01',
      worldOwner,
      worldObject,
    )
    updateEquipmentObjectRegistration(
      registry,
      'cup-01',
      heldOwner,
      heldObject,
    )
    updateEquipmentObjectRegistration(registry, 'cup-01', worldOwner, null)

    expect(registry.get('cup-01')).toBe(heldObject)

    updateEquipmentObjectRegistration(registry, 'cup-01', heldOwner, null)
    expect(registry.has('cup-01')).toBe(false)
  })
})
