import { describe, expect, it } from 'vitest'
import type { SerializableTransform } from '../../domain/equipment/equipment'
import { createInteractionStore } from './interaction-store'

const IDENTITY_OFFSET: SerializableTransform = {
  position: [0, 0, 0],
  quaternion: [0, 0, 0, 1],
  scale: [1, 1, 1],
}

describe('interaction selection and visibility', () => {
  it('uses one serializable selection owner for robot, links, and equipment', () => {
    const store = createInteractionStore()

    store.getState().selectRobot()
    expect(store.getState().selection).toEqual({ kind: 'robot' })
    expect(store.getState().selectedEquipmentId).toBeNull()

    store.getState().selectRobotLink('LINK04')
    expect(store.getState().selection).toEqual({
      kind: 'robot-link',
      linkId: 'LINK04',
    })

    store.getState().selectEquipment('cup-01')
    expect(store.getState().selection).toEqual({
      kind: 'equipment',
      entityId: 'equipment:cup-01',
      equipmentId: 'cup-01',
    })
    expect(store.getState().selectedEquipmentId).toBe('cup-01')

    store.getState().clearSelectionForEntity('cup-01')
    expect(store.getState().selection).toBeNull()
    expect(structuredClone(store.getState().selection)).toBeNull()
  })

  it('preserves canonical Equipment and Object selection with one local id', () => {
    const store = createInteractionStore()

    store.getState().selectEquipment('object:shared-01')
    expect(store.getState().selection).toEqual({
      kind: 'equipment',
      entityId: 'object:shared-01',
      equipmentId: 'shared-01',
    })
    expect(store.getState().selectedEquipmentId).toBe('shared-01')

    expect(() =>
      store.getState().clearSelectionForEntity('workcell:workbench'),
    ).not.toThrow()
    expect(store.getState().selection).not.toBeNull()
    store.getState().clearSelectionForEntity('equipment:shared-01')
    expect(store.getState().selection).not.toBeNull()
    store.getState().clearSelectionForEntity('object:shared-01')
    expect(store.getState().selection).toBeNull()

    store.getState().selectEquipment('equipment:shared-01')
    expect(store.getState().selection).toEqual({
      kind: 'equipment',
      entityId: 'equipment:shared-01',
      equipmentId: 'shared-01',
    })
  })

  it('tracks visibility as plain ids and clears selection when an entity is hidden', () => {
    const store = createInteractionStore()
    store.getState().selectEquipment('cup-02')

    store.getState().setEntityVisible('cup-02', false)
    expect(store.getState().hiddenEntityIds).toEqual(['cup-02'])
    expect(store.getState().selection).toBeNull()

    store.getState().setEntityVisible('cup-02', true)
    expect(store.getState().hiddenEntityIds).toEqual([])
  })
})

describe('grasp transitions', () => {
  it('distinguishes canonical Equipment and Object candidates with the same local id', () => {
    const store = createInteractionStore()
    store.getState().enterGraspCandidate('equipment:shared-01')
    store.getState().enterGraspCandidate('object:shared-01')

    expect(store.getState().graspCandidateIds).toEqual([
      'equipment:shared-01',
      'object:shared-01',
    ])
    expect(
      store.getState().holdEquipment('object:shared-01', IDENTITY_OFFSET),
    ).toBe(true)
    expect(store.getState()).toMatchObject({
      heldEntityId: 'object:shared-01',
      heldEquipmentId: 'shared-01',
    })

    expect(
      store.getState().releaseHeldEquipment('equipment:shared-01'),
    ).toBeNull()
    expect(store.getState().releaseHeldEquipment('object:shared-01')).toMatchObject({
      entityId: 'object:shared-01',
      equipmentId: 'shared-01',
    })

    expect(store.getState().beginEquipmentRemoval('object:shared-01')).toBe(true)
    store.getState().enterGraspCandidate('object:shared-01')
    expect(
      store.getState().holdEquipment('object:shared-01', IDENTITY_OFFSET),
    ).toBe(false)
  })

  it('locks a removing asset against candidates and re-grasp until removal ends', () => {
    const store = createInteractionStore()
    store.getState().enterGraspCandidate('cup-01')

    expect(store.getState().beginEquipmentRemoval('cup-01')).toBe(true)
    expect(store.getState().graspCandidateIds).toEqual([])
    expect(store.getState().holdEquipment('cup-01', IDENTITY_OFFSET)).toBe(false)

    store.getState().resetInteraction()
    expect(store.getState().removingEquipmentIds).toEqual(['cup-01'])

    store.getState().endEquipmentRemoval('cup-01')
    store.getState().enterGraspCandidate('cup-01')
    expect(store.getState().holdEquipment('cup-01', IDENTITY_OFFSET)).toBe(true)
  })

  it('holds an entered candidate when the gripper closes', () => {
    const store = createInteractionStore()

    store.getState().enterGraspCandidate('cup-01')
    const held = store.getState().holdEquipment('cup-01', IDENTITY_OFFSET)

    expect(held).toBe(true)
    expect(store.getState()).toMatchObject({
      graspCandidateIds: ['cup-01'],
      heldEquipmentId: 'cup-01',
      gripOffset: IDENTITY_OFFSET,
    })
  })

  it('keeps the original held item when another candidate is closed on', () => {
    const store = createInteractionStore()
    store.getState().enterGraspCandidate('cup-01')
    store.getState().enterGraspCandidate('cup-02')
    expect(
      store.getState().holdEquipment('cup-01', IDENTITY_OFFSET),
    ).toBe(true)

    const heldSecond = store.getState().holdEquipment('cup-02', {
      ...IDENTITY_OFFSET,
      position: [1, 2, 3],
    })

    expect(heldSecond).toBe(false)
    expect(store.getState().heldEquipmentId).toBe('cup-01')
    expect(store.getState().gripOffset).toEqual(IDENTITY_OFFSET)
  })

  it('releases before an asset is removed and leaves no held id', () => {
    const store = createInteractionStore()
    store.getState().enterGraspCandidate('cup-01')
    store.getState().holdEquipment('cup-01', IDENTITY_OFFSET)

    const released = store.getState().releaseHeldEquipment('cup-01')

    expect(released).toEqual({
      entityId: 'equipment:cup-01',
      equipmentId: 'cup-01',
      gripOffset: IDENTITY_OFFSET,
    })
    expect(store.getState().heldEquipmentId).toBeNull()
    expect(store.getState().gripOffset).toBeNull()
  })
})

describe('collision transitions', () => {
  it('clears every canonical pair owned by an unmounted collision entity', () => {
    const store = createInteractionStore()
    store
      .getState()
      .enterCollision('equipment:cup-01', 'robot-link:LINK04')
    store
      .getState()
      .enterCollision('equipment:cup-01', 'robot-link:LINK05')
    store
      .getState()
      .enterCollision('equipment:cup-02', 'robot-link:LINK03')

    expect(
      store.getState().clearCollisionPairsForEntity('equipment:cup-01'),
    ).toBe(2)
    expect(store.getState().activeCollisionPairs).toEqual([
      'equipment:cup-02|robot-link:LINK03',
    ])
  })

  it('canonicalizes one collision enter and preserves history eligibility after exit', () => {
    const store = createInteractionStore()

    expect(
      store
        .getState()
        .enterCollision('equipment:cup-01', 'robot-link:LINK04'),
    ).toBe(true)
    expect(
      store
        .getState()
        .enterCollision('robot-link:LINK04', 'equipment:cup-01'),
    ).toBe(false)
    expect(store.getState().activeCollisionPairs).toEqual([
      'equipment:cup-01|robot-link:LINK04',
    ])

    expect(
      store
        .getState()
        .exitCollision('robot-link:LINK04', 'equipment:cup-01'),
    ).toBe(true)
    expect(store.getState().activeCollisionPairs).toEqual([])
  })

  it('reset clears transient interaction state but does not own event history', () => {
    const store = createInteractionStore()
    store.getState().selectEquipment('cup-01')
    store.getState().setEntityVisible('cup-02', false)
    store.getState().enterGraspCandidate('cup-01')
    store.getState().holdEquipment('cup-01', IDENTITY_OFFSET)
    store
      .getState()
      .enterCollision('equipment:cup-01', 'robot-link:LINK04')

    store.getState().resetInteraction()

    expect(store.getState()).toMatchObject({
      selection: null,
      selectedEquipmentId: null,
      hiddenEntityIds: [],
      graspCandidateIds: [],
      heldEquipmentId: null,
      gripOffset: null,
      activeCollisionPairs: [],
    })
  })
})
