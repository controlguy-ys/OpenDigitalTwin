import { act, render } from '@testing-library/react'
import { Group, Matrix4, Quaternion, Vector3 } from 'three'
import { describe, expect, it, vi } from 'vitest'
import type { WorkcellProjectSnapshotV3 } from '../../domain/project/project-v3'
import type { SceneEntityV1 } from '../../domain/project/scene-state-v1'
import { selectSceneRuntime } from './scene-runtime-selector'
import {
  LINEAR_AXIS_RUNTIME_FRAME_PRIORITY,
  linearAxisConfigurationIdentity as runtimeAxisConfigurationIdentity,
  linearAxisMovingFrameMatrix,
  synchronizeLinearAxisWorldMatrices,
} from './LinearAxisRuntime'
import { LinearAxisRuntime } from './LinearAxisRuntime'
import type {
  CommittedLinearAxisSourceV1,
  LinearAxisCommittedStateV1,
  LinearAxisFrameV1,
} from './linear-axis-source'
import {
  registerGeometryEntity,
  snapshotGeometryEntities,
} from '../collision/geometry-entity-registry'

const useFrameMock = vi.hoisted(() => vi.fn())
vi.mock('@react-three/fiber', () => ({ useFrame: useFrameMock }))

const IDENTITY_POSE = {
  positionM: [0, 0, 0] as const,
  quaternion: [0, 0, 0, 1] as const,
}

function runtime(entities: readonly SceneEntityV1[]) {
  return selectSceneRuntime({
    scene: { entities, robotMountContact: null },
    objectAssets: [],
    objectInstances: [],
    builtInEquipment: [],
  } as unknown as WorkcellProjectSnapshotV3, { isolatedEntityId: null })
}

function axisConfigurationIdentity(sceneRuntime: ReturnType<typeof runtime>): string {
  const identity = runtimeAxisConfigurationIdentity(sceneRuntime.linearAxis)
  if (identity === null) throw new Error('Expected Linear Axis')
  return identity
}

describe('LinearAxisRuntime', () => {
  it.each([
    ['x', -1, [-1, 0, 0]],
    ['x', 0.25, [0.25, 0, 0]],
    ['x', 2, [2, 0, 0]],
    ['y', -1, [0, -1, 0]],
    ['y', 0.25, [0, 0.25, 0]],
    ['y', 2, [0, 2, 0]],
    ['z', -1, [0, 0, -1]],
    ['z', 0.25, [0, 0, 0.25]],
    ['z', 2, [0, 0, 2]],
  ] as const)('places the %s moving Frame at a bounded position of %s m', (direction, position, expected) => {
    const axis: SceneEntityV1 = {
      kind: 'linear-axis', id: 'linear-axis:active', name: 'Axis', parentId: null,
      localPose: IDENTITY_POSE, visible: true, direction, minPositionM: -1,
      maxPositionM: 2, homePositionM: 0.25, currentPositionM: position,
      carriageEntityId: null, robotEntityId: null,
    }
    const axisRuntime = runtime([axis]).linearAxis!
    const matrix = linearAxisMovingFrameMatrix(axisRuntime)

    expect(new Vector3().setFromMatrixPosition(matrix).toArray()).toEqual(expected)
  })

  it('updates the Robot and Group-member carriage matrices before collision sampling without moving fixed rail', () => {
    const axis: SceneEntityV1 = {
      kind: 'linear-axis', id: 'linear-axis:active', name: 'Axis', parentId: null,
      localPose: {
        positionM: [10, 0, 0],
        quaternion: [0, 0, Math.SQRT1_2, Math.SQRT1_2],
      },
      visible: true, direction: 'x', minPositionM: -1, maxPositionM: 2,
      homePositionM: 0, currentPositionM: 1.25,
      carriageEntityId: 'group:carriage', robotEntityId: 'robot:active',
    }
    const carriage: SceneEntityV1 = {
      kind: 'group', id: 'group:carriage', name: 'Carriage',
      parentId: 'linear-axis:active',
      localPose: { ...IDENTITY_POSE, positionM: [0.5, 0, 0] }, visible: true,
    }
    const member: SceneEntityV1 = {
      kind: 'object', id: 'object:member', name: 'Member', parentId: 'group:carriage',
      localPose: { ...IDENTITY_POSE, positionM: [2, 0, 0] }, visible: true,
      target: { kind: 'object-instance', id: 'member' }, transformSource: 'manual',
    }
    const rail: SceneEntityV1 = {
      kind: 'object', id: 'object:rail', name: 'Fixed rail', parentId: null,
      localPose: { ...IDENTITY_POSE, positionM: [3, 0, 0] }, visible: true,
      target: { kind: 'object-instance', id: 'rail' }, transformSource: 'manual',
    }
    const robot: SceneEntityV1 = {
      kind: 'robot', id: 'robot:active', name: 'Robot', parentId: 'linear-axis:active',
      localPose: { ...IDENTITY_POSE, positionM: [0.75, 0, 0] }, visible: true,
    }
    const sceneRuntime = runtime([axis, carriage, member, rail, robot])
    const memberObject = new Group()
    const fixedRailObject = new Group()
    fixedRailObject.position.set(99, 98, 97)
    const robotRoot = new Group()
    const memberUpdate = vi.spyOn(memberObject, 'updateWorldMatrix')
    const robotUpdate = vi.spyOn(robotRoot, 'updateWorldMatrix')

    const updated = synchronizeLinearAxisWorldMatrices(
      sceneRuntime,
      new Map([
        ['object:member', memberObject],
        ['object:rail', fixedRailObject],
      ]),
      robotRoot,
    )

    expect(updated).toEqual(['object:member', 'robot:active'])
    expect(memberObject.position.toArray()).toEqual([10, 3.75, 0])
    expect(memberObject.quaternion.angleTo(
      new Quaternion(0, 0, Math.SQRT1_2, Math.SQRT1_2),
    )).toBeCloseTo(0, 14)
    expect(robotRoot.position.toArray()).toEqual([10, 2, 0])
    expect(fixedRailObject.position.toArray()).toEqual([99, 98, 97])
    expect(memberUpdate).toHaveBeenCalledWith(true, true)
    expect(robotUpdate).toHaveBeenCalledWith(true, true)
    expect(member.localPose.positionM).toEqual([2, 0, 0])
  })

  it('preserves Object-owned non-unit scale in both the rendered and collision World matrices', () => {
    const axis: SceneEntityV1 = {
      kind: 'linear-axis', id: 'linear-axis:active', name: 'Axis', parentId: null,
      localPose: IDENTITY_POSE, visible: true, direction: 'x', minPositionM: 0,
      maxPositionM: 2, homePositionM: 0, currentPositionM: 0.5,
      carriageEntityId: 'object:carriage', robotEntityId: null,
    }
    const carriage: SceneEntityV1 = {
      kind: 'object', id: 'object:carriage', name: 'Carriage', parentId: 'linear-axis:active',
      localPose: { ...IDENTITY_POSE, positionM: [0.25, 0, 0] }, visible: true,
      target: { kind: 'object-instance', id: 'carriage' }, transformSource: 'manual',
    }
    const sceneRuntime = runtime([axis, carriage])
    const carriageObject = new Group()
    carriageObject.scale.set(2, 3, 4)
    const cleanup = registerGeometryEntity({
      id: 'object:carriage', name: 'Carriage', category: 'object',
      boxes: [{
        id: 'body', center: [0, 0, 0], halfExtents: [0.1, 0.1, 0.1],
        quaternion: [0, 0, 0, 1],
      }],
      object: carriageObject,
    })

    try {
      synchronizeLinearAxisWorldMatrices(
        sceneRuntime,
        new Map([['object:carriage', carriageObject]]),
        null,
        1.25,
      )

      expect(carriageObject.position.toArray()).toEqual([1.5, 0, 0])
      expect(carriageObject.scale.toArray()).toEqual([2, 3, 4])
      const collision = snapshotGeometryEntities().entities.find(({ id }) => id === 'object:carriage')!
      const collisionScale = new Vector3()
      new Matrix4().fromArray(collision.worldMatrix as number[]).decompose(
        new Vector3(), new Quaternion(), collisionScale,
      )
      expect(collisionScale.toArray()).toEqual([2, 3, 4])
    } finally {
      cleanup()
    }
  })

  it('subscribes the renderer to source frames, orders before collision, and holds last GOOD on STALE/BAD', () => {
    useFrameMock.mockClear()
    const axis: SceneEntityV1 = {
      kind: 'linear-axis', id: 'linear-axis:active', name: 'Axis', parentId: null,
      localPose: IDENTITY_POSE, visible: true, direction: 'x', minPositionM: 0,
      maxPositionM: 2, homePositionM: 0, currentPositionM: 0.5,
      carriageEntityId: 'object:carriage', robotEntityId: null,
    }
    const carriage: SceneEntityV1 = {
      kind: 'object', id: 'object:carriage', name: 'Carriage', parentId: 'linear-axis:active',
      localPose: IDENTITY_POSE, visible: true,
      target: { kind: 'object-instance', id: 'carriage' }, transformSource: 'manual',
    }
    const sceneRuntime = runtime([axis, carriage])
    const carriageObject = new Group()
    let listener: ((frame: LinearAxisFrameV1) => void) | null = null
    const unsubscribe = vi.fn()
    const source: CommittedLinearAxisSourceV1 = {
      kind: 'manual',
      subscribe: vi.fn((nextListener) => {
        listener = nextListener
        nextListener({ positionM: 0.5, timestampMs: 10, quality: 'GOOD' })
        return unsubscribe
      }),
      synchronizeCommittedState: vi.fn(),
      setPositionM: vi.fn(async () => undefined),
      home: vi.fn(async () => undefined),
    }
    const committedState: LinearAxisCommittedStateV1 = {
      axisEntityId: axis.id,
      configurationIdentity: axisConfigurationIdentity(sceneRuntime),
      positionM: axis.currentPositionM,
      homePositionM: axis.homePositionM,
    }

    const view = render(
      <LinearAxisRuntime
        objectRoots={new Map([['object:carriage', carriageObject]])}
        robotRoot={null}
        runtime={sceneRuntime}
        source={source}
        committedState={committedState}
      />,
    )
    const [frameUpdate, priority] = useFrameMock.mock.calls.at(-1)!
    expect(source.subscribe).toHaveBeenCalledTimes(1)
    expect(priority).toBe(LINEAR_AXIS_RUNTIME_FRAME_PRIORITY)
    expect(priority).toBeLessThan(0)

    act(() => listener?.({ positionM: 1.25, timestampMs: 20, quality: 'GOOD' }))
    act(() => frameUpdate())
    expect(carriageObject.position.x).toBe(1.25)

    act(() => listener?.({ positionM: 1.5, timestampMs: 20, quality: 'GOOD' }))
    act(() => frameUpdate())
    expect(carriageObject.position.x).toBe(1.5)

    act(() => listener?.({ positionM: 1.75, timestampMs: 21, quality: 'STALE' }))
    act(() => frameUpdate())
    expect(carriageObject.position.x).toBe(1.5)

    act(() => listener?.({ positionM: 1.9, timestampMs: 22, quality: 'BAD' }))
    act(() => frameUpdate())
    expect(carriageObject.position.x).toBe(1.5)

    act(() => listener?.({ positionM: 1.1, timestampMs: 19, quality: 'GOOD' }))
    act(() => frameUpdate())
    expect(carriageObject.position.x).toBe(1.5)

    view.unmount()
    expect(unsubscribe).toHaveBeenCalledOnce()
  })

  it('replaces the nested-root subscription before synchronizing a new committed hierarchy', () => {
    useFrameMock.mockClear()
    const axisA: SceneEntityV1 = {
      kind: 'linear-axis', id: 'linear-axis:active', name: 'Axis', parentId: null,
      localPose: IDENTITY_POSE, visible: true, direction: 'x', minPositionM: 0,
      maxPositionM: 2, homePositionM: 0, currentPositionM: 0.5,
      carriageEntityId: 'object:carriage', robotEntityId: null,
    }
    const carriageA: SceneEntityV1 = {
      kind: 'object', id: 'object:carriage', name: 'Carriage', parentId: 'linear-axis:active',
      localPose: IDENTITY_POSE, visible: true,
      target: { kind: 'object-instance', id: 'carriage' }, transformSource: 'manual',
    }
    const runtimeA = runtime([axisA, carriageA])
    const axisB: SceneEntityV1 = {
      ...axisA, direction: 'y', homePositionM: 0.25, currentPositionM: 0.75,
    }
    const runtimeB = runtime([axisB, carriageA])
    const listeners: Array<(frame: LinearAxisFrameV1) => void> = []
    const events: string[] = []
    let sourcePositionM = 0.5
    let timestampMs = 1
    const source = {
      kind: 'manual' as const,
      subscribe(listener: (frame: LinearAxisFrameV1) => void) {
        const index = listeners.push(listener) - 1
        events.push(`subscribe:${index}`)
        listener({ positionM: sourcePositionM, timestampMs, quality: 'GOOD' })
        return () => events.push(`cleanup:${index}`)
      },
      synchronizeCommittedState(positionM: number, homePositionM: number) {
        events.push(`sync:${positionM}:${homePositionM}`)
        sourcePositionM = positionM
        timestampMs += 1
        for (const listener of listeners) {
          listener({ positionM, timestampMs, quality: 'GOOD' })
        }
      },
      setPositionM: vi.fn(async () => undefined),
      home: vi.fn(async () => undefined),
    }
    const carriageObject = new Group()
    const view = render(
      <LinearAxisRuntime
        committedState={{
          axisEntityId: axisA.id,
          configurationIdentity: axisConfigurationIdentity(runtimeA),
          positionM: axisA.currentPositionM,
          homePositionM: axisA.homePositionM,
        }}
        objectRoots={new Map([['object:carriage', carriageObject]])}
        robotRoot={null}
        runtime={runtimeA}
        source={source}
      />,
    )
    expect(events).toEqual(['subscribe:0', 'sync:0.5:0'])
    events.length = 0

    view.rerender(
      <LinearAxisRuntime
        committedState={{
          axisEntityId: axisB.id,
          configurationIdentity: axisConfigurationIdentity(runtimeB),
          positionM: axisB.currentPositionM,
          homePositionM: axisB.homePositionM,
        }}
        objectRoots={new Map([['object:carriage', carriageObject]])}
        robotRoot={null}
        runtime={runtimeB}
        source={source}
      />,
    )

    expect(events).toEqual(['cleanup:0', 'subscribe:1', 'sync:0.75:0.25'])
    const [frameUpdate] = useFrameMock.mock.calls.at(-1)!
    act(() => listeners[0]?.({ positionM: 1.9, timestampMs: 99, quality: 'GOOD' }))
    act(() => frameUpdate())
    expect(carriageObject.position.toArray()).toEqual([0, 0.75, 0])
  })
})
