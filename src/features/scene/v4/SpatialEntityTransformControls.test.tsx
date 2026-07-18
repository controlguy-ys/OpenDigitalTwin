import { act, render, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { Group, Quaternion } from 'three'
import type { RigidTransformV4 } from '../../../core/project-v4/rigid-transform.js'
import { SpatialEntityTransformControlsV4 } from './SpatialEntityTransformControls.js'

const transformControlsCapture = vi.hoisted(() => ({
  props: null as Record<string, unknown> | null,
}))

vi.mock('@react-three/drei/core/TransformControls.js', () => ({
  TransformControls: (props: Record<string, unknown>) => {
    transformControlsCapture.props = props
    return null
  },
}))

function callControl(name: string): void {
  const callback = transformControlsCapture.props?.[name]
  if (typeof callback !== 'function') throw new Error(`Missing ${name} callback.`)
  callback()
}

describe('SpatialEntityTransformControlsV4', () => {
  it('uses parent-frame translation axes, preserves orientation, and commits one local pose', async () => {
    const scene = new Group()
    const object = new Group()
    scene.add(object)
    object.position.set(5, 2, 0)
    object.quaternion.setFromAxisAngle({ x: 0, y: 0, z: 1 }, Math.PI / 4)
    const parentWorldPose: RigidTransformV4 = {
      positionM: [1, 2, 0],
      quaternion: [0, 0, Math.SQRT1_2, Math.SQRT1_2],
    }
    const persistedWorldPose: RigidTransformV4 = {
      positionM: [5, 2, 0],
      quaternion: object.quaternion.toArray() as RigidTransformV4['quaternion'],
    }
    const onCommitLocalPose = vi.fn(async () => undefined)
    const onDraggingChange = vi.fn()

    render(
      <SpatialEntityTransformControlsV4
        entityId="entity-a"
        gizmoFrame="parent"
        object={object}
        onCommitLocalPose={onCommitLocalPose}
        onDraggingChange={onDraggingChange}
        parentWorldPose={parentWorldPose}
        persistedWorldPose={persistedWorldPose}
      />,
    )

    expect(transformControlsCapture.props).toMatchObject({
      mode: 'translate',
      space: 'local',
    })
    const proxy = transformControlsCapture.props?.object as Group
    expect(proxy).not.toBe(object)
    expect(proxy.quaternion.toArray()).toEqual(parentWorldPose.quaternion)

    act(() => {
      callControl('onMouseDown')
      proxy.position.set(1, 4, 0)
      callControl('onObjectChange')
    })
    expect(onDraggingChange).toHaveBeenCalledWith(true)
    expect(object.position.toArray()).toEqual([1, 4, 0])
    expect(object.quaternion.toArray()).toEqual(persistedWorldPose.quaternion)

    act(() => callControl('onMouseUp'))
    await waitFor(() => expect(onCommitLocalPose).toHaveBeenCalledOnce())
    const [committedEntityId, localPose] = onCommitLocalPose.mock.calls[0] as unknown as [
      string,
      RigidTransformV4,
    ]
    expect(committedEntityId).toBe('entity-a')
    expect(localPose.positionM).toEqual(expect.arrayContaining([expect.any(Number)]))
    expect(localPose.positionM[0]).toBeCloseTo(2)
    expect(localPose.positionM[1]).toBeCloseTo(0)
    expect(localPose.positionM[2]).toBeCloseTo(0)
    expect(localPose.quaternion).toEqual(
      new Quaternion(0, 0, -Math.sin(Math.PI / 8), Math.cos(Math.PI / 8)).toArray(),
    )
    expect(onDraggingChange).toHaveBeenLastCalledWith(false)
  })

  it('uses world axes and restores the persisted world pose when its one commit fails', async () => {
    const scene = new Group()
    const object = new Group()
    scene.add(object)
    const persistedWorldPose: RigidTransformV4 = {
      positionM: [3, 4, 5],
      quaternion: [0, 0, 0, 1],
    }
    object.position.set(...persistedWorldPose.positionM)
    const onCommitLocalPose = vi.fn(async () => {
      throw new Error('write rejected')
    })
    const onDraggingChange = vi.fn()

    render(
      <SpatialEntityTransformControlsV4
        entityId="entity-a"
        gizmoFrame="world"
        object={object}
        onCommitLocalPose={onCommitLocalPose}
        onDraggingChange={onDraggingChange}
        parentWorldPose={{ positionM: [0, 0, 0], quaternion: [0, 0, 0, 1] }}
        persistedWorldPose={persistedWorldPose}
      />,
    )

    expect(transformControlsCapture.props).toMatchObject({ space: 'world' })
    expect(transformControlsCapture.props?.object).toBe(object)
    act(() => {
      callControl('onMouseDown')
      object.position.set(9, 8, 7)
      callControl('onObjectChange')
      callControl('onMouseUp')
    })

    await waitFor(() => expect(onCommitLocalPose).toHaveBeenCalledOnce())
    await waitFor(() => expect(object.position.toArray()).toEqual([3, 4, 5]))
    expect(onDraggingChange.mock.calls).toEqual([[true], [false]])
  })

  it('restores Orbit eligibility when unmounted during a drag', () => {
    const object = new Group()
    const onDraggingChange = vi.fn()
    const view = render(
      <SpatialEntityTransformControlsV4
        entityId="entity-a"
        gizmoFrame="world"
        object={object}
        onCommitLocalPose={vi.fn(async () => undefined)}
        onDraggingChange={onDraggingChange}
        parentWorldPose={{ positionM: [0, 0, 0], quaternion: [0, 0, 0, 1] }}
        persistedWorldPose={{ positionM: [0, 0, 0], quaternion: [0, 0, 0, 1] }}
      />,
    )

    act(() => callControl('onMouseDown'))
    view.unmount()
    expect(onDraggingChange.mock.calls).toEqual([[true], [false]])
  })

  it('does not begin a second drag while its prior pose commit is pending', async () => {
    const scene = new Group()
    const object = new Group()
    scene.add(object)
    const onDraggingChange = vi.fn()
    let resolveCommit: () => void = () => undefined
    const onCommitLocalPose = vi.fn(() => new Promise<void>((resolve) => {
      resolveCommit = resolve
    }))
    render(
      <SpatialEntityTransformControlsV4
        entityId="entity-a"
        gizmoFrame="parent"
        object={object}
        onCommitLocalPose={onCommitLocalPose}
        onDraggingChange={onDraggingChange}
        parentWorldPose={{ positionM: [0, 0, 0], quaternion: [0, 0, 0, 1] }}
        persistedWorldPose={{ positionM: [0, 0, 0], quaternion: [0, 0, 0, 1] }}
      />,
    )

    expect(transformControlsCapture.props).toMatchObject({ enabled: true })
    act(() => {
      callControl('onMouseDown')
      callControl('onMouseUp')
    })
    await waitFor(() => expect(onCommitLocalPose).toHaveBeenCalledOnce())
    await waitFor(() => expect(transformControlsCapture.props).toMatchObject({ enabled: false }))
    const proxy = transformControlsCapture.props?.object as Group
    act(() => {
      callControl('onMouseDown')
      proxy.position.set(9, 8, 7)
      callControl('onObjectChange')
      callControl('onMouseUp')
    })

    expect(onDraggingChange.mock.calls).toEqual([[true], [false]])
    expect(onCommitLocalPose).toHaveBeenCalledOnce()
    expect(object.position.toArray()).toEqual([0, 0, 0])
    act(() => resolveCommit())
    await waitFor(() => expect(transformControlsCapture.props).toMatchObject({ enabled: true }))
  })

  it('rolls a rejected Entity A commit back to its immutable pose after rendering Entity B', async () => {
    const objectA = new Group()
    const objectB = new Group()
    objectA.position.set(1, 2, 3)
    objectB.position.set(20, 30, 40)
    let rejectCommit: (error: Error) => void = () => undefined
    const onCommitLocalPose = vi.fn(() => new Promise<void>((_resolve, reject) => {
      rejectCommit = reject
    }))
    const common = {
      gizmoFrame: 'world' as const,
      onCommitLocalPose,
      onDraggingChange: vi.fn(),
      parentWorldPose: { positionM: [0, 0, 0], quaternion: [0, 0, 0, 1] } as RigidTransformV4,
    }
    const { rerender } = render(
      <SpatialEntityTransformControlsV4
        {...common}
        entityId="entity-a"
        object={objectA}
        persistedWorldPose={{ positionM: [1, 2, 3], quaternion: [0, 0, 0, 1] }}
      />,
    )

    act(() => {
      callControl('onMouseDown')
      objectA.position.set(9, 9, 9)
      callControl('onObjectChange')
      callControl('onMouseUp')
    })
    await waitFor(() => expect(onCommitLocalPose).toHaveBeenCalledOnce())
    rerender(
      <SpatialEntityTransformControlsV4
        {...common}
        entityId="entity-b"
        object={objectB}
        persistedWorldPose={{ positionM: [20, 30, 40], quaternion: [0, 0, 0, 1] }}
      />,
    )

    act(() => rejectCommit(new Error('Entity A write rejected')))
    await waitFor(() => expect(objectA.position.toArray()).toEqual([1, 2, 3]))
    expect(objectB.position.toArray()).toEqual([20, 30, 40])
  })
})
