import { describe, expect, it } from 'vitest'
import type { WorldObb } from './collision'
import { broadPhasePairs } from './broad-phase'

function obb(entityId: string, boxId: string, x: number): WorldObb {
  return {
    entityId,
    boxId,
    center: [x, 0, 0],
    axes: [
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
    ],
    halfExtents: [0.5, 0.5, 0.5],
  }
}

function keys(pairs: ReturnType<typeof broadPhasePairs>): string[] {
  return pairs.map(
    ([first, second]) =>
      `${first.entityId}/${first.boxId}|${second.entityId}/${second.boxId}`,
  )
}

describe('sweep-and-prune broad phase', () => {
  it('retains separated boxes inside the warning distance', () => {
    const first = obb('object:a', 'proxy', 0)
    const second = obb('object:b', 'proxy', 1.05)

    expect(broadPhasePairs([first, second], 0)).toEqual([])
    expect(keys(broadPhasePairs([first, second], 0.1))).toEqual([
      'object:a/proxy|object:b/proxy',
    ])
  })

  it('rejects candidates separated on an expanded Y or Z interval', () => {
    const first = obb('object:a', 'proxy', 0)
    const second: WorldObb = {
      ...obb('object:b', 'proxy', 0),
      center: [0, 2, 0],
    }

    expect(broadPhasePairs([first, second], 0.1)).toEqual([])
  })

  it('returns stable pairs and excludes boxes owned by the same Entity', () => {
    const input = [
      obb('object:c', 'main', 0.8),
      obb('object:a', 'second', 0.2),
      obb('object:b', 'main', 0.4),
      obb('object:a', 'first', 0),
    ]
    const expected = keys(broadPhasePairs(input, 0))

    expect(expected).not.toContain('object:a/first|object:a/second')
    expect(keys(broadPhasePairs([...input].reverse(), 0))).toEqual(expected)
    expect(expected).toEqual([...expected].sort())
  })

  it('sorts Entity and Box fields independently when display keys collide', () => {
    const input = [
      obb('object:a/one', 'two', 0),
      obb('object:a', 'one/two', 0),
      obb('robot-link:LINK00', 'main', 0),
    ]

    expect(broadPhasePairs(input, 0)).toEqual(
      broadPhasePairs([...input].reverse(), 0),
    )
  })
})
