import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useLayoutEffect } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useInteractionStore } from '../features/interaction/interaction-store'
import { sceneEditorStore } from '../features/project/project-store-browser'
import { TEST_SCENE_ENTITIES, testSceneRuntime } from '../features/scene/scene-ui-test-fixtures'
import { App, LinearAxisTargetInspector } from './App'
import { ManualLinearAxisSource } from '../features/scene/linear-axis-source'
import type { LinearAxisSourceV1 } from '../features/scene/linear-axis-source'
import type { LinearAxisCommittedStateV1 } from '../features/scene/linear-axis-source'
import { operationFeedbackStore } from '../features/ui/OperationFeedback'

const runtime = testSceneRuntime(TEST_SCENE_ENTITIES)
let publishedRuntime = runtime
const observedCanvasProps = vi.hoisted(() => ({
  current: null as null | Record<string, unknown>,
}))
const canvasLifecycle = vi.hoisted(() => ({
  frames: [] as number[],
  subscriptionVersion: 0,
  throwOnRender: false,
}))

function runtimeAtAxisPosition(positionM: number) {
  return testSceneRuntime(TEST_SCENE_ENTITIES.map((entity) =>
    entity.kind === 'linear-axis' ? { ...entity, currentPositionM: positionM } : entity))
}

vi.mock('../features/scene/scene-runtime-selector', async (importOriginal) => ({
  ...await importOriginal<typeof import('../features/scene/scene-runtime-selector')>(),
  usePublishedSceneRuntime: () => publishedRuntime,
}))

vi.mock('../features/scene/SceneCanvas', () => ({
  SceneCanvas: (props: {
    onContextMenu?: (
      entityId: 'object:cup-1' | 'robot:active' | null,
      position: { x: number; y: number },
    ) => void
    onStatusChange?: (status: 'ready') => void
    linearAxisSource?: LinearAxisSourceV1 | null
    linearAxisCommittedState?: LinearAxisCommittedStateV1 | null
  }) => {
    observedCanvasProps.current = props
    useLayoutEffect(() => {
      if (props.linearAxisSource == null) return
      return props.linearAxisSource.subscribe((frame) => {
        canvasLifecycle.frames.push(frame.positionM)
      })
    }, [props.linearAxisSource, canvasLifecycle.subscriptionVersion])
    if (canvasLifecycle.throwOnRender) throw new Error('ABANDONED_SCENE_RENDER')
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
    publishedRuntime = runtime
    canvasLifecycle.frames.length = 0
    canvasLifecycle.subscriptionVersion = 0
    canvasLifecycle.throwOnRender = false
    useInteractionStore.getState().resetInteraction()
    sceneEditorStore.setState({ selectedEntityId: 'robot:active' })
    operationFeedbackStore.getState().clear()
  })

  it('mounts the bounded Scene Explorer and uses the common Inspector for Robot base pose', () => {
    render(<App />)

    expect(screen.getByRole('tree', { name: 'Scene Objects' })).toBeVisible()
    expect(screen.getByTestId('scene-tree-scroll')).toHaveStyle({ overflow: 'auto' })
    expect(screen.getByLabelText('Local X (mm)')).toBeVisible()
    expect(screen.getByLabelText('World X (mm)')).toHaveAttribute('readonly')
    expect(screen.queryByText('Equipment', { selector: 'h2' })).not.toBeInTheDocument()
  })

  it('exposes transient isolate state only through the test-mode diagnostic', () => {
    sceneEditorStore.getState().isolate('object:cup-1')

    render(<App />)

    expect(screen.getByTestId('scene-editor-diagnostic')).toHaveTextContent(
      'object:cup-1',
    )
    expect(screen.getByTestId('robot-joint-diagnostic')).toHaveTextContent(
      '[0,0,0,0,0,0]',
    )
  })

  it('composes common Transform and Manual controls for the selected Linear Axis', () => {
    sceneEditorStore.setState({ selectedEntityId: 'linear-axis:active' })

    render(<App />)

    expect(screen.getByLabelText('Local X (mm)')).toBeVisible()
    expect(screen.getByRole('spinbutton', { name: 'Axis position (mm)' })).toHaveValue(0)
    expect(screen.getByRole('button', { name: 'Move Home' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'Attach Robot' })).toBeVisible()
  })

  it('enables the reachable Linear Axis Add command when no Axis exists', async () => {
    const user = userEvent.setup()
    publishedRuntime = testSceneRuntime(
      TEST_SCENE_ENTITIES.filter(({ kind }) => kind !== 'linear-axis'),
    )
    render(<App />)

    await user.click(screen.getByRole('button', { name: 'Add' }))
    expect(screen.getByRole('menuitem', { name: 'Linear Axis' })).toBeEnabled()
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

  it('passes replacement state without publishing from the outer React root', () => {
    const view = render(<App />)
    const source = observedCanvasProps.current?.linearAxisSource as
      | LinearAxisSourceV1
      | null
      | undefined
    const initialCommittedState = observedCanvasProps.current?.linearAxisCommittedState as
      | LinearAxisCommittedStateV1
      | null
      | undefined
    canvasLifecycle.frames.length = 0
    publishedRuntime = runtimeAtAxisPosition(0.75)
    canvasLifecycle.subscriptionVersion += 1

    view.rerender(<App />)

    expect(observedCanvasProps.current?.linearAxisSource).toBe(source)
    const replacementCommittedState = observedCanvasProps.current
      ?.linearAxisCommittedState as LinearAxisCommittedStateV1
    expect(replacementCommittedState).toMatchObject({
      axisEntityId: 'linear-axis:active',
      positionM: 0.75,
      homePositionM: 0,
    })
    expect(replacementCommittedState.configurationIdentity).not.toBe(
      initialCommittedState?.configurationIdentity,
    )
    expect(canvasLifecycle.frames).toEqual([0])
  })

  it('does not publish committed state from an abandoned render', () => {
    const view = render(<App />)
    const source = observedCanvasProps.current?.linearAxisSource as
      | LinearAxisSourceV1
      | null
      | undefined
    if (source == null) throw new Error('Expected the App-owned Axis source.')
    const listener = vi.fn()
    const unsubscribe = source.subscribe(listener)
    listener.mockClear()
    publishedRuntime = runtimeAtAxisPosition(0.5)
    canvasLifecycle.throwOnRender = true

    expect(() => view.rerender(<App />)).toThrow('ABANDONED_SCENE_RENDER')
    expect(listener).not.toHaveBeenCalled()
    unsubscribe()
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
      'Create Group', 'Create Box', 'Create Cylinder', 'Fit All',
    ])

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
