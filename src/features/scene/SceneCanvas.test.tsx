import { fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useInteractionStore } from '../interaction/interaction-store'
import { SceneCanvas } from './SceneCanvas'

vi.mock('@react-three/fiber', () => ({
  Canvas: ({ children }: { children: ReactNode }) => (
    <div data-testid="rendered-3d-viewport">{children}</div>
  ),
  useLoader: { clear: vi.fn() },
}))

vi.mock('./Workcell', () => ({
  Workcell: ({
    onEntityContextMenu,
  }: {
    onEntityContextMenu?: (entityId: 'object:cup-1') => void
  }) => (
    <button
      data-testid="rendered-entity"
      onContextMenu={() => onEntityContextMenu?.('object:cup-1')}
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
    fireEvent.contextMenu(screen.getByTestId('rendered-3d-viewport'))
    expect(onContextMenu).toHaveBeenLastCalledWith(null)

    fireEvent.contextMenu(screen.getByTestId('rendered-entity'))
    expect(onContextMenu).toHaveBeenLastCalledWith('object:cup-1')

    fireEvent.contextMenu(screen.getByTestId('rendered-3d-viewport'))
    expect(onContextMenu).toHaveBeenLastCalledWith(null)
    expect(onContextMenu).toHaveBeenCalledTimes(3)
  })
})
