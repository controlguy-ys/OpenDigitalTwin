import { fireEvent, render, screen } from '@testing-library/react'
import { useEffect, type ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useInteractionStore } from '../interaction/interaction-store'
import { sceneEditorStore } from '../project/project-store-browser'
import { recordCameraDiagnosticIfEnabled, SceneCanvas } from './SceneCanvas'
import type { CommittedLinearAxisSourceV1 } from './linear-axis-source'
import type { LinearAxisCommittedStateV1 } from './linear-axis-source'

const observedWorkcellProps = vi.hoisted(() => ({ current: null as null | Record<string, unknown> }))
const cameraCalls = vi.hoisted(() => ({ home: vi.fn(), fitAll: vi.fn(), focusSelection: vi.fn(), setStandardView: vi.fn() }))

vi.mock('@react-three/fiber', () => ({
  Canvas: ({
    children,
    onPointerMissed,
  }: {
    children: ReactNode
    onPointerMissed?: () => void
  }) => (
    <div data-testid="rendered-3d-viewport">
      {children}
      <button onClick={onPointerMissed} type="button">Miss rendered Entity</button>
    </div>
  ),
  useLoader: { clear: vi.fn() },
}))

vi.mock('./Workcell', () => ({
  Workcell: (props: {
    onEntityContextMenu?: (
      entityId: 'object:cup-1',
      position: { x: number; y: number },
    ) => void
    linearAxisSource?: unknown
    linearAxisCommittedState?: unknown
    registerViewportController?: (controller: unknown) => void
  }) => {
    observedWorkcellProps.current = props
    useEffect(() => {
      props.registerViewportController?.({
        actions: cameraCalls,
        canFocusSelection: false,
        robotRevision: 0,
        readCameraState: () => ({
          position: [2.2, 1.8, 1.7], target: [0.15, 0, 1.55],
          quaternion: [0, 0, 0, 1], up: [0, 0, 1], zoom: 1,
          fov: 42, near: 0.1, far: 100,
        }),
      })
    }, [props.registerViewportController])
    return (
    <button
      data-testid="rendered-entity"
      onContextMenu={() => props.onEntityContextMenu?.('object:cup-1', { x: 12, y: 24 })}
      type="button"
    >
      Rendered Entity
    </button>
    )
  },
}))
vi.mock('./SceneErrorBoundary', () => ({
  SceneErrorBoundary: ({ children }: { children: ReactNode }) => children,
}))
vi.mock('../robot/RobotStatusOverlay', () => ({ RobotStatusOverlay: () => null }))

describe('SceneCanvas viewport context boundary', () => {
  beforeEach(() => {
    useInteractionStore.getState().resetInteraction()
    cameraCalls.home.mockClear()
  })

  it('composes camera controls outside the project mutation boundary', () => {
    render(<SceneCanvas />)
    fireEvent.click(screen.getByRole('button', { name: 'Home View' }))
    expect(cameraCalls.home).toHaveBeenCalledOnce()
    expect(screen.getByRole('button', { name: 'Focus Selection' })).toBeDisabled()
  })

  it('does not publish test diagnostics for production camera commands', () => {
    const publish = vi.fn()
    const state = {
      position: [2.2, 1.8, 1.7], target: [0.15, 0, 1.55],
      quaternion: [0, 0, 0, 1], up: [0, 0, 1], zoom: 1,
      fov: 42, near: 0.1, far: 100,
    } as const

    recordCameraDiagnosticIfEnabled(false, publish, state)
    expect(publish).not.toHaveBeenCalled()
    recordCameraDiagnosticIfEnabled(true, publish, state)
    expect(publish).toHaveBeenCalledWith(state)
  })

  it('targets the actual rendered Entity and never reuses stale selection for the background', () => {
    const onContextMenu = vi.fn()
    render(<SceneCanvas onContextMenu={onContextMenu} />)

    useInteractionStore.getState().selectEquipment('object:stale-selection')
    fireEvent.contextMenu(screen.getByTestId('rendered-3d-viewport'), {
      clientX: 30,
      clientY: 40,
    })
    expect(onContextMenu).toHaveBeenLastCalledWith(null, { x: 30, y: 40 })

    fireEvent.contextMenu(screen.getByTestId('rendered-entity'))
    expect(onContextMenu).toHaveBeenLastCalledWith('object:cup-1', { x: 12, y: 24 })

    fireEvent.contextMenu(screen.getByTestId('rendered-3d-viewport'))
    expect(onContextMenu).toHaveBeenLastCalledWith(null, { x: 0, y: 0 })
    expect(onContextMenu).toHaveBeenCalledTimes(3)
  })

  it('clears both interaction and canonical Scene selection on a background miss', () => {
    render(<SceneCanvas />)
    useInteractionStore.getState().selectEquipment('object:cup-1')
    sceneEditorStore.getState().select('object:cup-1')

    fireEvent.click(screen.getByRole('button', { name: 'Miss rendered Entity' }))

    expect(useInteractionStore.getState().selection).toBeNull()
    expect(sceneEditorStore.getState().selectedEntityId).toBeNull()
  })

  it('passes the App-owned Axis source and committed state through to the Workcell renderer', () => {
    const source: CommittedLinearAxisSourceV1 = {
      kind: 'manual', subscribe: vi.fn(() => vi.fn()),
      synchronizeCommittedState: vi.fn(),
      setPositionM: vi.fn(async () => undefined), home: vi.fn(async () => undefined),
    }
    const committedState: LinearAxisCommittedStateV1 = {
      axisEntityId: 'linear-axis:active', configurationIdentity: 'axis-config:A',
      positionM: 0.5, homePositionM: 0,
    }

    render(
      <SceneCanvas
        linearAxisCommittedState={committedState}
        linearAxisSource={source}
      />,
    )

    expect(observedWorkcellProps.current?.linearAxisSource).toBe(source)
    expect(observedWorkcellProps.current?.linearAxisCommittedState).toBe(committedState)
  })
})
