import { fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useInteractionStore } from '../interaction/interaction-store'
import { sceneEditorStore } from '../project/project-store-browser'
import { SceneCanvas } from './SceneCanvas'

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
  Workcell: ({
    onEntityContextMenu,
  }: {
    onEntityContextMenu?: (
      entityId: 'object:cup-1',
      position: { x: number; y: number },
    ) => void
  }) => (
    <button
      data-testid="rendered-entity"
      onContextMenu={() => onEntityContextMenu?.('object:cup-1', { x: 12, y: 24 })}
      type="button"
    >
      Rendered Entity
    </button>
  ),
}))
vi.mock('./SceneErrorBoundary', () => ({
  SceneErrorBoundary: ({ children }: { children: ReactNode }) => children,
}))
vi.mock('../robot/RobotStatusOverlay', () => ({ RobotStatusOverlay: () => null }))

describe('SceneCanvas viewport context boundary', () => {
  beforeEach(() => useInteractionStore.getState().resetInteraction())

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
})
