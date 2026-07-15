import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useInteractionStore } from '../features/interaction/interaction-store'
import { sceneEditorStore } from '../features/project/project-store-browser'
import { TEST_SCENE_ENTITIES, testSceneRuntime } from '../features/scene/scene-ui-test-fixtures'
import { App } from './App'

const runtime = testSceneRuntime(TEST_SCENE_ENTITIES)

vi.mock('../features/scene/scene-runtime-selector', async (importOriginal) => ({
  ...await importOriginal<typeof import('../features/scene/scene-runtime-selector')>(),
  usePublishedSceneRuntime: () => runtime,
}))

vi.mock('../features/scene/SceneCanvas', () => ({
  SceneCanvas: ({ onContextMenu }: {
    onContextMenu?: (
      entityId: 'object:cup-1' | 'robot:active' | null,
      position: { x: number; y: number },
    ) => void
  }) => (
    <div>
      <button onClick={() => onContextMenu?.(null, { x: 0, y: 0 })} type="button">Empty viewport context</button>
      <button onClick={() => onContextMenu?.('object:cup-1', { x: 0, y: 0 })} type="button">Entity viewport context</button>
      <button onClick={() => onContextMenu?.('robot:active', { x: 0, y: 0 })} type="button">Robot viewport context</button>
    </div>
  ),
}))

describe('App scene editor integration', () => {
  beforeEach(() => {
    useInteractionStore.getState().resetInteraction()
    sceneEditorStore.setState({ selectedEntityId: 'robot:active' })
  })

  it('mounts the bounded Scene Explorer and uses the common Inspector for Robot base pose', () => {
    render(<App />)

    expect(screen.getByRole('tree', { name: 'Scene Objects' })).toBeVisible()
    expect(screen.getByTestId('scene-tree-scroll')).toHaveStyle({ overflow: 'auto' })
    expect(screen.getByLabelText('Local X (mm)')).toBeVisible()
    expect(screen.getByLabelText('World X (mm)')).toHaveAttribute('readonly')
    expect(screen.queryByText('Equipment', { selector: 'h2' })).not.toBeInTheDocument()
  })

  it('opens only implemented empty and Entity menus from the 3D viewport boundary', async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.click(screen.getByRole('button', { name: 'Empty viewport context' }))
    expect(screen.getAllByRole('menuitem').map((item) => item.textContent)).toEqual([
      'Create Group', 'Create Box', 'Create Cylinder',
    ])
    expect(screen.queryByRole('menuitem', { name: 'Fit All' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Entity viewport context' }))
    expect(screen.getByRole('menuitem', { name: 'Duplicate' })).toBeVisible()
    expect(screen.getByRole('menuitem', { name: 'Delete' })).toBeVisible()
    expect(screen.queryByRole('menuitem', { name: 'Fit All' })).not.toBeInTheDocument()
  })

  it('opens and focuses the current Collision bottom-rail surface from Robot context', async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.click(screen.getByRole('button', { name: 'Robot viewport context' }))
    await user.click(screen.getByRole('menuitem', { name: 'Open Collision' }))

    expect(screen.getByLabelText('Timeline and Events')).toHaveClass('is-open')
    expect(screen.getByRole('heading', { name: 'Geometry Proxy Collision' }))
      .toHaveFocus()
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })
})
