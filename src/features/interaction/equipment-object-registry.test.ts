import { createRef } from 'react'
import { Group, type Object3D } from 'three'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  geometryEntityRegistry,
  registerGeometryEntity,
} from '../collision/geometry-entity-registry'
import { updateEquipmentObjectRegistration } from './equipment-object-registry'

describe('equipment object registration', () => {
  beforeEach(() => {
    geometryEntityRegistry.clear()
  })

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

  it('keeps the canonical collision registration pointed at the active grasp owner', () => {
    const registry = new Map<string, Object3D>()
    const worldOwner = createRef<Object3D>()
    const heldOwner = createRef<Object3D>()
    const worldObject = new Group()
    const heldObject = new Group()
    registerGeometryEntity({
      id: 'equipment:cup-01',
      name: 'Cup',
      category: 'equipment',
      boxes: [
        {
          id: 'default',
          center: [0, 0, 0],
          halfExtents: [0.1, 0.1, 0.1],
          quaternion: [0, 0, 0, 1],
        },
      ],
      object: null,
    })

    updateEquipmentObjectRegistration(
      registry,
      'cup-01',
      worldOwner,
      worldObject,
    )
    expect(geometryEntityRegistry.get('equipment:cup-01')?.object).toBe(
      worldObject,
    )

    updateEquipmentObjectRegistration(
      registry,
      'cup-01',
      heldOwner,
      heldObject,
    )
    updateEquipmentObjectRegistration(registry, 'cup-01', worldOwner, null)
    expect(geometryEntityRegistry.get('equipment:cup-01')?.object).toBe(
      heldObject,
    )
  })
})
