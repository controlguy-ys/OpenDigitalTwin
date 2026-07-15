import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useInteractionStore } from '../features/interaction/interaction-store'
import { sceneEditorStore } from '../features/project/project-store-browser'
import { TEST_SCENE_ENTITIES, testSceneRuntime } from '../features/scene/scene-ui-test-fixtures'
import { App, LinearAxisTargetInspector } from './App'
import { ManualLinearAxisSource } from '../features/scene/linear-axis-source'

const runtime = testSceneRuntime(TEST_SCENE_ENTITIES)
const observedCanvasProps = vi.hoisted(() => ({
  current: null as null | Record<string, unknown>,
}))

vi.mock('../features/scene/scene-runtime-selector', async (importOriginal) => ({
  ...await importOriginal<typeof import('../features/scene/scene-runtime-selector')>(),
  usePublishedSceneRuntime: () => runtime,
}))

vi.mock('../features/scene/SceneCanvas', () => ({
  SceneCanvas: (props: {
    onContextMenu?: (
      entityId: 'object:cup-1' | 'robot:active' | null,
      position: { x: number; y: number },
    ) => void
    onStatusChange?: (status: 'ready') => void
    linearAxisSource?: unknown
  }) => {
    observedCanvasProps.current = props
    return (
    <div>
      <button onClick={() => props.onStatusChange?.('ready')} type="button">Scene ready</button>
      <button onClick={() => props.onContextMenu?.(null, { x: 0, y: 0 })} type="button">Empty viewport context</button>
      <button onClick={() => props.onContextMenu?.('object:cup-1', { x: 0, y: 0 })} type="button">Entity viewport context</button>
      <button onClick={() => props.onContextMenu?.('robot:active', { x: 0, y: 0 })} type="button">Robot viewport context</button>
    </div>
    )
  },
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

  it('composes common Transform and Manual controls for the selected Linear Axis', () => {
    sceneEditorStore.setState({ selectedEntityId: 'linear-axis:active' })

    render(<App />)

    expect(screen.getByLabelText('Local X (mm)')).toBeVisible()
    expect(screen.getByRole('spinbutton', { name: 'Axis position (mm)' })).toHaveValue(0)
    expect(screen.getByRole('button', { name: 'Move Home' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'Attach Robot' })).toBeVisible()
  })

  it('shares one stable Manual Axis source between renderer and Inspector commands', async () => {
    const user = userEvent.setup()
    sceneEditorStore.setState({ selectedEntityId: 'linear-axis:active' })
    render(<App />)
    const source = observedCanvasProps.current?.linearAxisSource as {
      home: () => Promise<void>
    }
    const home = vi.spyOn(source, 'home').mockResolvedValue(undefined)

    await user.click(screen.getByRole('button', { name: 'Scene ready' }))
    expect(observedCanvasProps.current?.linearAxisSource).toBe(source)
    await user.click(screen.getByRole('button', { name: 'Move Home' }))

    expect(home).toHaveBeenCalledOnce()
  })

  it('clears stale Scene editor ownership after successful Axis deletion', async () => {
    const user = userEvent.setup()
    sceneEditorStore.setState({ selectedEntityId: 'linear-axis:active' })
    sceneEditorStore.getState().beginDraft('linear-axis:active', TEST_SCENE_ENTITIES.at(-1)!.localPose)
    sceneEditorStore.getState().isolate('linear-axis:active')
    const commands = {
      setLinearAxisPosition: vi.fn(async () => undefined),
      moveLinearAxisHome: vi.fn(async () => undefined),
      setLinearAxisCarriage: vi.fn(async () => undefined),
      attachRobotToLinearAxis: vi.fn(async () => undefined),
      detachRobotFromLinearAxis: vi.fn(async () => undefined),
      deleteLinearAxis: vi.fn(async () => undefined),
    }
    const source = new ManualLinearAxisSource({
      initialPositionM: 0,
      homePositionM: 0,
      commitPositionM: commands.setLinearAxisPosition,
      commitHome: commands.moveLinearAxisHome,
    })
    render(
      <LinearAxisTargetInspector
        commands={commands}
        disabled={false}
        source={source}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'Delete Linear Axis' }))

    expect(sceneEditorStore.getState()).toMatchObject({
      selectedEntityId: null,
      isolatedEntityId: null,
      draftPose: null,
    })
    expect(commands.deleteLinearAxis).toHaveBeenCalledOnce()
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
    const entityMenu = screen.getByRole('menu', { name: 'Cup commands' })
    expect(entityMenu.parentElement).toBe(document.body)
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
