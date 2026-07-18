import { render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { Vector3 } from 'three'
import { WorldViewCubeV4 } from './WorldViewCube.js'
import { createAppCommandBindingsV4, createAppCommandRuntimeV4 } from '../../commands/v4/app-command-runtime.js'
import { createAppCommandRegistryV4 } from '../../commands/v4/app-command-registry.js'

const FACES = ['right', 'left', 'front', 'back', 'top', 'bottom'] as const
type Face = (typeof FACES)[number]
type CommandSpy = ReturnType<typeof vi.fn<() => void>>

function bindings() {
  const calls = Object.fromEntries(FACES.map((face) => [
    face,
    vi.fn<() => void>(),
  ])) as Record<Face, CommandSpy>
  const runtime = createAppCommandRuntimeV4(createAppCommandRegistryV4(
    FACES.map((face) => ({
      id: `view.orientation.${face}`,
      label: face,
      section: 'view' as const,
      kind: 'action' as const,
      visible: true,
      enabled: true,
      execute: () => calls[face](),
    })),
  ))
  return { calls, commandBindings: createAppCommandBindingsV4(runtime) }
}

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

type CubeClick = (event: {
  readonly face?: { readonly normal: Vector3 }
  readonly object: { readonly position: Vector3 }
  stopPropagation(): void
}) => null

function cubeClick(): CubeClick {
  return capture.cube?.onClick as CubeClick
}

describe('WorldViewCubeV4', () => {
  it('uses the fixed World face labels, visual palette, and 88-pixel footprint', () => {
    const { container } = render(<WorldViewCubeV4 commandBindings={bindings().commandBindings} onDirection={vi.fn()} />)

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

  it('keeps the face-label array identity stable across rerenders', () => {
    const data = bindings()
    const { rerender } = render(<WorldViewCubeV4 commandBindings={data.commandBindings} onDirection={vi.fn()} />)
    const initialFaces = capture.cube?.faces

    rerender(<WorldViewCubeV4 commandBindings={data.commandBindings} onDirection={vi.fn()} />)
    expect(capture.cube?.faces).toBe(initialFaces)
  })

  it('routes each exact cardinal face to only its exact shared orientation command', () => {
    const data = bindings()
    const onDirection = vi.fn()
    render(<WorldViewCubeV4 commandBindings={data.commandBindings} onDirection={onDirection} />)
    const faces: readonly [Face, readonly [number, number, number]][] = [
      ['right', [1, 0, 0]], ['left', [-1, 0, 0]],
      ['front', [0, -1, 0]], ['back', [0, 1, 0]],
      ['top', [0, 0, 1]], ['bottom', [0, 0, -1]],
    ]
    for (const [face, normal] of faces) {
      const before = Object.fromEntries(FACES.map((candidate) => [candidate, data.calls[candidate].mock.calls.length])) as Record<Face, number>
      const stopPropagation = vi.fn()
      expect(cubeClick()({
        face: { normal: new Vector3(...normal) },
        object: { position: new Vector3() },
        stopPropagation,
      })).toBeNull()
      expect(stopPropagation).toHaveBeenCalledOnce()
      for (const candidate of FACES) {
        expect(data.calls[candidate]).toHaveBeenCalledTimes(before[candidate] + (candidate === face ? 1 : 0))
      }
      expect(onDirection).not.toHaveBeenCalled()
    }
  })

  it('routes an edge directly to its direction callback without invoking a face command', () => {
    const data = bindings()
    const onDirection = vi.fn()
    render(<WorldViewCubeV4 commandBindings={data.commandBindings} onDirection={onDirection} />)
    const edge = [1, -1, 1] as const
    cubeClick()({
      face: { normal: new Vector3(0, 0, -1) },
      object: { position: new Vector3(...edge) },
      stopPropagation: vi.fn(),
    })

    expect(onDirection).toHaveBeenCalledExactlyOnceWith(edge)
    for (const face of FACES) expect(data.calls[face]).not.toHaveBeenCalled()
  })

  it('maps a non-unit axis source to its exact face ID without the direct path', () => {
    const data = bindings()
    const onDirection = vi.fn()
    render(<WorldViewCubeV4 commandBindings={data.commandBindings} onDirection={onDirection} />)

    cubeClick()({
      face: { normal: new Vector3(0, 0, -1) },
      object: { position: new Vector3(-9, 0, 0) },
      stopPropagation: vi.fn(),
    })

    expect(data.calls.left).toHaveBeenCalledOnce()
    for (const face of FACES.filter((face) => face !== 'left')) {
      expect(data.calls[face]).not.toHaveBeenCalled()
    }
    expect(onDirection).not.toHaveBeenCalled()
  })

  it('keeps corner directions direct-only and ignores a zero direction', () => {
    const data = bindings()
    const onDirection = vi.fn()
    render(<WorldViewCubeV4 commandBindings={data.commandBindings} onDirection={onDirection} />)

    cubeClick()({
      face: { normal: new Vector3() },
      object: { position: new Vector3(3, -2, 1) },
      stopPropagation: vi.fn(),
    })
    expect(onDirection).toHaveBeenCalledExactlyOnceWith([3, -2, 1])
    for (const face of FACES) expect(data.calls[face]).not.toHaveBeenCalled()

    cubeClick()({
      face: { normal: new Vector3() },
      object: { position: new Vector3() },
      stopPropagation: vi.fn(),
    })
    expect(onDirection).toHaveBeenCalledOnce()
    for (const face of FACES) expect(data.calls[face]).not.toHaveBeenCalled()
  })

  it('increases the top-right screen margin for safe-area overlays', () => {
    render(
      <WorldViewCubeV4
        commandBindings={bindings().commandBindings}
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
