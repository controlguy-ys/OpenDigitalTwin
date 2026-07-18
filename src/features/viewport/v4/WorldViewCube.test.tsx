import { render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { Vector3 } from 'three'
import { WorldViewCubeV4 } from './WorldViewCube.js'

const capture = vi.hoisted(() => ({
  cube: null as Record<string, unknown> | null,
  helper: null as Record<string, unknown> | null,
  group: null as Record<string, unknown> | null,
}))

vi.mock('@react-three/drei/core/GizmoHelper.js', () => ({
  GizmoHelper: (props: Record<string, unknown>) => {
    capture.helper = props
    return <>{props.children}</>
  },
}))

vi.mock('@react-three/drei/core/GizmoViewcube.js', () => ({
  GizmoViewcube: (props: Record<string, unknown>) => {
    capture.cube = props
    return null
  },
}))

vi.mock('@react-three/fiber', () => ({}))

describe('WorldViewCubeV4', () => {
  it('uses the fixed World face labels, visual palette, and 88-pixel footprint', () => {
    const { container } = render(<WorldViewCubeV4 onDirection={vi.fn()} />)

    expect(capture.cube).toMatchObject({
      color: '#d9e2e8',
      faces: ['Right', 'Left', 'Back', 'Front', 'Top', 'Bottom'],
      hoverColor: '#38bdf8',
      strokeColor: '#526674',
      textColor: '#17232d',
    })
    expect(capture.helper).toMatchObject({ alignment: 'top-right', margin: [56, 56] })
    expect(container.querySelector('group')).toHaveAttribute('scale', String(88 / 60))
  })

  it('returns null and sends World directions from faces, edges, and corners', () => {
    const onDirection = vi.fn()
    render(<WorldViewCubeV4 onDirection={onDirection} />)
    const onClick = capture.cube?.onClick as (event: {
      readonly face?: { readonly normal: Vector3 }
      readonly object: { readonly position: Vector3 }
      stopPropagation(): void
    }) => null

    for (const [normal, expected] of [
      [[1, 0, 0], [1, 0, 0]],
      [[-1, 0, 0], [-1, 0, 0]],
      [[0, 1, 0], [0, 1, 0]],
      [[0, -1, 0], [0, -1, 0]],
      [[0, 0, 1], [0, 0, 1]],
      [[0, 0, -1], [0, 0, -1]],
    ] as const) {
      const stopPropagation = vi.fn()
      expect(onClick({
        face: { normal: new Vector3(...normal) },
        object: { position: new Vector3() },
        stopPropagation,
      })).toBeNull()
      expect(stopPropagation).toHaveBeenCalledOnce()
      expect(onDirection).toHaveBeenLastCalledWith(expected)
    }

    onClick({
      face: { normal: new Vector3(0, 0, -1) },
      object: { position: new Vector3(1, -1, 1) },
      stopPropagation: vi.fn(),
    })
    expect(onDirection).toHaveBeenLastCalledWith([1, -1, 1])
  })

  it('increases the top-right screen margin for safe-area overlays', () => {
    render(
      <WorldViewCubeV4
        onDirection={vi.fn()}
        safeAreaInsets={{ top: 11, right: 13, bottom: 17, left: 19 }}
      />,
    )

    expect(capture.helper).toMatchObject({
      alignment: 'top-right',
      margin: [69, 67],
    })
  })
})
