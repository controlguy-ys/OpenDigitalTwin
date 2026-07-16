import { describe, expect, it } from 'vitest'

import type { RigidTransformV4 } from '../project-v4/index.js'
import {
  reparentFramePreservingWorldV4,
  resolveWorldFrameMapV4,
  type FrameGraphNodeV4,
} from './index.js'

function pose(
  positionM: readonly [number, number, number] = [0, 0, 0],
  quaternion: readonly [number, number, number, number] = [0, 0, 0, 1],
): RigidTransformV4 {
  return { positionM, quaternion }
}

function node(
  frameId: string,
  parentFrameId: string | null,
  localPose: RigidTransformV4 = pose(),
): FrameGraphNodeV4 {
  return { frameId, parentFrameId, localPose }
}

function expectTransformClose(
  actual: RigidTransformV4 | undefined,
  expected: RigidTransformV4,
): void {
  expect(actual).toBeDefined()
  expected.positionM.forEach((value, index) => {
    expect(actual?.positionM[index]).toBeCloseTo(value, 12)
  })
  expected.quaternion.forEach((value, index) => {
    expect(actual?.quaternion[index]).toBeCloseTo(value, 12)
  })
}

describe('resolveWorldFrameMapV4', () => {
  it('resolves an unordered forest and applies a moving parent exactly once', () => {
    const world = resolveWorldFrameMapV4([
      node('robot-a:base', 'carriage', pose([0, 0, 0.5])),
      node('detached-root', null, pose([10, 0, 0])),
      node('carriage', 'world', pose([1, 0, 0])),
      node('world', null),
    ])

    expect([...world.keys()]).toHaveLength(4)
    expectTransformClose(world.get('robot-a:base'), pose([1, 0, 0.5]))
    expectTransformClose(world.get('detached-root'), pose([10, 0, 0]))
  })

  it('rejects duplicate IDs, missing parents, self-parenting, and longer cycles', () => {
    expect(() => resolveWorldFrameMapV4([
      node('same', null),
      node('same', null),
    ])).toThrow('FRAME_ID_DUPLICATE')

    expect(() => resolveWorldFrameMapV4([
      node('child', 'missing'),
    ])).toThrow('FRAME_PARENT_NOT_FOUND')

    expect(() => resolveWorldFrameMapV4([
      node('self', 'self'),
    ])).toThrow('FRAME_CYCLE')

    expect(() => resolveWorldFrameMapV4([
      node('a', 'b'),
      node('b', 'c'),
      node('c', 'a'),
    ])).toThrow('FRAME_CYCLE')
  })

  it('returns fresh transforms that do not alias caller-owned arrays', () => {
    const mutablePosition: [number, number, number] = [1, 2, 3]
    const mutableQuaternion: [number, number, number, number] = [0, 0, 0, 2]
    const input = [node('root', null, pose(mutablePosition, mutableQuaternion))]

    const resolved = resolveWorldFrameMapV4(input)
    mutablePosition[0] = 99
    mutableQuaternion[3] = 99

    expectTransformClose(resolved.get('root'), pose([1, 2, 3]))
    expect(resolved.get('root')?.positionM).not.toBe(mutablePosition)
    expect(resolved.get('root')?.quaternion).not.toBe(mutableQuaternion)
  })
})

describe('reparentFramePreservingWorldV4', () => {
  it('reparents to another root and then to null without changing World pose', () => {
    const original = [
      node('world', null),
      node('left', 'world', pose([2, 0, 0])),
      node('right', 'world', pose([10, 0, 0])),
      node('payload', 'left', pose([1, 2, 0])),
    ]
    const originalSnapshot = structuredClone(original)
    const before = resolveWorldFrameMapV4(original).get('payload')

    const underRight = reparentFramePreservingWorldV4(original, 'payload', 'right')
    const asRoot = reparentFramePreservingWorldV4(underRight, 'payload', null)

    expect(underRight.map(({ frameId }) => frameId)).toEqual(original.map(({ frameId }) => frameId))
    expect(underRight.find(({ frameId }) => frameId === 'payload')?.parentFrameId).toBe('right')
    expectTransformClose(resolveWorldFrameMapV4(underRight).get('payload'), before!)
    expectTransformClose(resolveWorldFrameMapV4(asRoot).get('payload'), before!)
    expect(original).toEqual(originalSnapshot)
  })

  it('preserves position and orientation when reparenting between rotated parents', () => {
    const halfSqrt = Math.SQRT1_2
    const graph = [
      node('world', null),
      node('rotated:z', 'world', pose([1, 0, 0], [0, 0, halfSqrt, halfSqrt])),
      node('rotated|y', 'world', pose([0, 2, 0], [0, halfSqrt, 0, halfSqrt])),
      node('payload%3A', 'rotated:z', pose([1, 0, 0], [halfSqrt, 0, 0, halfSqrt])),
    ]
    const before = resolveWorldFrameMapV4(graph).get('payload%3A')

    const candidate = reparentFramePreservingWorldV4(graph, 'payload%3A', 'rotated|y')

    expectTransformClose(resolveWorldFrameMapV4(candidate).get('payload%3A'), before!)
  })

  it('rejects unknown targets and a reparent below the target subtree', () => {
    const graph = [
      node('root', null),
      node('parent', 'root'),
      node('child', 'parent'),
    ]

    expect(() => reparentFramePreservingWorldV4(graph, 'missing', null)).toThrow(
      'FRAME_PARENT_NOT_FOUND',
    )
    expect(() => reparentFramePreservingWorldV4(graph, 'parent', 'missing')).toThrow(
      'FRAME_PARENT_NOT_FOUND',
    )
    expect(() => reparentFramePreservingWorldV4(graph, 'parent', 'child')).toThrow(
      'FRAME_CYCLE',
    )
  })
})
