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
      'equipment:cup-01',
      worldOwner,
      worldObject,
    )
    updateEquipmentObjectRegistration(
      registry,
      'equipment:cup-01',
      heldOwner,
      heldObject,
    )
    updateEquipmentObjectRegistration(
      registry,
      'equipment:cup-01',
      worldOwner,
      null,
    )

    expect(registry.get('equipment:cup-01')).toBe(heldObject)

    updateEquipmentObjectRegistration(
      registry,
      'equipment:cup-01',
      heldOwner,
      null,
    )
    expect(registry.has('equipment:cup-01')).toBe(false)
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
      'equipment:cup-01',
      worldOwner,
      worldObject,
    )
    expect(geometryEntityRegistry.get('equipment:cup-01')?.object).toBe(
      worldObject,
    )

    updateEquipmentObjectRegistration(
      registry,
      'equipment:cup-01',
      heldOwner,
      heldObject,
    )
    updateEquipmentObjectRegistration(
      registry,
      'equipment:cup-01',
      worldOwner,
      null,
    )
    expect(geometryEntityRegistry.get('equipment:cup-01')?.object).toBe(
      heldObject,
    )
  })

  it('isolates canonical Equipment and Object owners that share one local id', () => {
    const owners = new Map<string, Object3D>()
    const equipmentWorldOwner = createRef<Object3D>()
    const equipmentHeldOwner = createRef<Object3D>()
    const objectWorldOwner = createRef<Object3D>()
    const equipmentWorld = new Group()
    const equipmentHeld = new Group()
    const objectWorld = new Group()

    registerGeometryEntity({
      id: 'equipment:shared-01',
      name: 'Legacy Equipment',
      category: 'equipment',
      boxes: [{
        id: 'default',
        center: [0, 0, 0],
        halfExtents: [0.1, 0.1, 0.1],
        quaternion: [0, 0, 0, 1],
      }],
      object: null,
    })
    registerGeometryEntity({
      id: 'object:shared-01',
      name: 'Imported Object',
      category: 'object',
      boxes: [{
        id: 'default',
        center: [0, 0, 0],
        halfExtents: [0.2, 0.2, 0.2],
        quaternion: [0, 0, 0, 1],
      }],
      object: null,
    })

    updateEquipmentObjectRegistration(
      owners,
      'equipment:shared-01',
      equipmentWorldOwner,
      equipmentWorld,
    )
    updateEquipmentObjectRegistration(
      owners,
      'object:shared-01',
      objectWorldOwner,
      objectWorld,
    )

    expect(owners).toEqual(
      new Map([
        ['equipment:shared-01', equipmentWorld],
        ['object:shared-01', objectWorld],
      ]),
    )
    expect(geometryEntityRegistry.get('equipment:shared-01')).toMatchObject({
      category: 'equipment',
      object: equipmentWorld,
    })
    expect(geometryEntityRegistry.get('object:shared-01')).toMatchObject({
      category: 'object',
      object: objectWorld,
    })

    registerGeometryEntity({
      ...geometryEntityRegistry.get('equipment:shared-01')!,
      category: 'held-object',
      object: equipmentWorld,
    })
    updateEquipmentObjectRegistration(
      owners,
      'equipment:shared-01',
      equipmentHeldOwner,
      equipmentHeld,
    )
    updateEquipmentObjectRegistration(
      owners,
      'equipment:shared-01',
      equipmentWorldOwner,
      null,
    )

    expect(owners.get('equipment:shared-01')).toBe(equipmentHeld)
    expect(owners.get('object:shared-01')).toBe(objectWorld)
    expect(geometryEntityRegistry.get('equipment:shared-01')).toMatchObject({
      category: 'held-object',
      object: equipmentHeld,
    })
    expect(geometryEntityRegistry.get('object:shared-01')).toMatchObject({
      category: 'object',
      object: objectWorld,
    })
  })

  it('hands an imported Object from world to held owner and back without changing its canonical id', () => {
    const owners = new Map<string, Object3D>()
    const worldOwner = createRef<Object3D>()
    const heldOwner = createRef<Object3D>()
    const releasedWorldOwner = createRef<Object3D>()
    const worldObject = new Group()
    const heldObject = new Group()
    const releasedWorldObject = new Group()
    const registration = {
      id: 'object:fixture-01' as const,
      name: 'Imported Fixture',
      boxes: [{
        id: 'default',
        center: [0, 0, 0] as const,
        halfExtents: [0.2, 0.2, 0.2] as const,
        quaternion: [0, 0, 0, 1] as const,
      }],
      colliderRevision: 1,
    }

    registerGeometryEntity({
      ...registration,
      category: 'object',
      object: null,
    })
    updateEquipmentObjectRegistration(
      owners,
      registration.id,
      worldOwner,
      worldObject,
    )
    expect(geometryEntityRegistry.get(registration.id)).toMatchObject({
      id: registration.id,
      category: 'object',
      object: worldObject,
    })

    registerGeometryEntity({
      ...registration,
      category: 'held-object',
      object: worldObject,
    })
    updateEquipmentObjectRegistration(
      owners,
      registration.id,
      heldOwner,
      heldObject,
    )
    updateEquipmentObjectRegistration(
      owners,
      registration.id,
      worldOwner,
      null,
    )
    expect(geometryEntityRegistry.get(registration.id)).toMatchObject({
      id: registration.id,
      category: 'held-object',
      object: heldObject,
    })

    registerGeometryEntity({
      ...registration,
      category: 'object',
      object: heldObject,
    })
    updateEquipmentObjectRegistration(
      owners,
      registration.id,
      releasedWorldOwner,
      releasedWorldObject,
    )
    updateEquipmentObjectRegistration(
      owners,
      registration.id,
      heldOwner,
      null,
    )
    expect(owners.get(registration.id)).toBe(releasedWorldObject)
    expect(geometryEntityRegistry.get(registration.id)).toMatchObject({
      id: registration.id,
      category: 'object',
      object: releasedWorldObject,
    })
  })
})
