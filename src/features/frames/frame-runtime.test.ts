import { expect, it } from 'vitest'
import type { SerializableTransform } from '../../domain/equipment/equipment'
import { worldTransformToMcpLocal } from './frame-runtime'

function transform(
  position: [number, number, number],
): SerializableTransform {
  return {
    position,
    quaternion: [0, 0, 0, 1],
    scale: [1, 1, 1],
  }
}

it('converts a released world transform to MCP-local coordinates', () => {
  expect(
    worldTransformToMcpLocal(
      transform([1, 2, 0.5]),
      transform([1, 1, 0]),
    ),
  ).toEqual({
    position: [0, 1, 0.5],
    quaternion: [0, 0, 0, 1],
    scale: [1, 1, 1],
  })
})
