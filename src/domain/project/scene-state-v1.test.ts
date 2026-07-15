import { describe, expect, it } from 'vitest'
import {
  validateProjectSceneState,
  type ProjectSceneStateV1,
  type SceneEntityV1,
} from './scene-state-v1'

const POSE = {
  positionM: [0, 0, 0] as const,
  quaternion: [0, 0, 0, 1] as const,
}

function scene(...entities: readonly SceneEntityV1[]): ProjectSceneStateV1 {
  return { entities, robotMountContact: null }
}

const robot = (parentId: SceneEntityV1['parentId'] = null): SceneEntityV1 => ({
  kind: 'robot', id: 'robot:active', name: 'Robot', parentId,
  localPose: POSE, visible: true,
})

const group = (id: `group:${string}`, parentId: SceneEntityV1['parentId'] = null): SceneEntityV1 => ({
  kind: 'group', id, name: id, parentId, localPose: POSE, visible: true,
})

const object = (
  id: `object:${string}`,
  parentId: SceneEntityV1['parentId'] = null,
  transformSource: 'manual' | 'opcua' = 'manual',
): SceneEntityV1 => ({
  kind: 'object', id, name: id, parentId, localPose: POSE, visible: true,
  target: { kind: 'object-instance', id: id.slice('object:'.length) },
  transformSource,
})

const axis = (overrides: Partial<Extract<SceneEntityV1, { kind: 'linear-axis' }>> = {}): SceneEntityV1 => ({
  kind: 'linear-axis', id: 'linear-axis:active', name: 'Axis', parentId: null,
  localPose: POSE, visible: true, direction: 'x', minPositionM: -1,
  maxPositionM: 1, homePositionM: 0, currentPositionM: 0,
  carriageEntityId: null, robotEntityId: null, ...overrides,
})

describe('ProjectSceneStateV1 validation', () => {
  it('rejects sparse and accessor-backed entity arrays without invoking getters', () => {
    const sparse = [robot()]
    delete sparse[0]
    expect(() => validateProjectSceneState({ entities: sparse, robotMountContact: null }))
      .toThrow(/SCENE_ENTITIES_.*(?:sparse|dense)/)

    let getterCalls = 0
    const accessorBacked: SceneEntityV1[] = []
    Object.defineProperty(accessorBacked, '0', {
      get: () => {
        getterCalls += 1
        return robot()
      },
      enumerable: true,
    })
    accessorBacked.length = 1
    expect(() => validateProjectSceneState({
      entities: accessorBacked,
      robotMountContact: null,
    })).toThrow(/SCENE_ENTITIES_.*data/i)
    expect(getterCalls).toBe(0)
  })

  it('rejects nested groups, cycles, a second robot, and a second linear axis', () => {
    expect(() => validateProjectSceneState(scene(group('group:a'), group('group:b', 'group:a'))))
      .toThrow('SCENE_GROUP_NESTING')
    expect(() => validateProjectSceneState(scene(
      group('group:a', 'group:b'),
      object('object:cup-1', 'group:a'),
      group('group:b', 'object:cup-1'),
    ))).toThrow('SCENE_PARENT_CYCLE')
    expect(() => validateProjectSceneState(scene(robot(), { ...robot(), name: 'Duplicate' })))
      .toThrow('SCENE_ROBOT_LIMIT')
    expect(() => validateProjectSceneState(scene(axis(), { ...axis(), name: 'Duplicate' })))
      .toThrow('SCENE_LINEAR_AXIS_LIMIT')
  })

  it('requires axis attachment fields and child parent IDs to agree', () => {
    expect(() => validateProjectSceneState(scene(
      axis({ carriageEntityId: 'object:part-1' }), object('object:part-1'),
    ))).toThrow('SCENE_AXIS_ATTACHMENT_MISMATCH')
    expect(() => validateProjectSceneState(scene(
      axis(), object('object:part-1', 'linear-axis:active'),
    ))).toThrow('SCENE_AXIS_ATTACHMENT_MISMATCH')
    expect(() => validateProjectSceneState(scene(
      axis({ robotEntityId: 'robot:active' }), robot('linear-axis:active'),
    ))).not.toThrow()
  })

  it('rejects an OPC UA owned object below the MCP', () => {
    expect(() => validateProjectSceneState(scene(
      group('group:fixture'), object('object:cup-1', 'group:fixture', 'opcua'),
    ))).toThrow('SCENE_OPCUA_OBJECT_REQUIRES_MCP_PARENT')
  })

  it('normalizes finite non-zero quaternions and rejects invalid axis ranges', () => {
    const normalized = validateProjectSceneState(scene({
      ...object('object:cup-1'),
      localPose: { positionM: [1, 2, 3], quaternion: [0, 0, 0, 2] },
    }))
    expect(normalized.entities[0]!.localPose.quaternion).toEqual([0, 0, 0, 1])
    expect(() => validateProjectSceneState(scene(axis({ minPositionM: 1, maxPositionM: 1 }))))
      .toThrow('SCENE_LINEAR_AXIS_RANGE')
  })

  it('overflow-safely normalizes a finite quaternion', () => {
    const normalized = validateProjectSceneState(scene({
      ...object('object:cup-1'),
      localPose: {
        positionM: [0, 0, 0],
        quaternion: [Number.MAX_VALUE, Number.MAX_VALUE, 0, 0],
      },
    }))
    const quaternion = normalized.entities[0]!.localPose.quaternion
    expect(quaternion.every(Number.isFinite)).toBe(true)
    expect(Math.hypot(...quaternion)).toBeCloseTo(1, 12)
  })
})
