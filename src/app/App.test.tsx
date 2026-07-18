import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { StrictMode } from 'react'
import { createStore } from 'zustand/vanilla'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { deriveCollisionPolicyV4 } from '../domain/collision/collision-policy-v4.js'
import { createCoordinateDisplayStoreV4 } from '../features/frames/v4/coordinate-display-store.js'
import type { AppCommandRegistryV4 } from '../features/commands/v4/app-command-registry.js'
import { createInteractionStoreV4 } from '../features/interaction/v4/interaction-store.js'
import type { SceneSelectionTargetV4 } from '../features/interaction/v4/scene-selection.js'
import { createJobRuntimeStoreV4 } from '../features/jobs/v4/job-runtime-store.js'
import type { RobotJobPlaybackControllerV4 } from '../features/jobs/v4/simulation-clock.js'
import type {
  BrowserProjectResourcesV4,
} from '../features/project/project-store-browser.js'
import { createBrowserRuntimeBundleStoreV4 } from '../features/project/v4/browser-runtime-bundle-store-v4.js'
import { createDefaultProjectV4 } from '../features/project/v4/default-project-v4.js'
import type { ProjectMutationServiceV4 } from '../features/project/v4/project-v4-mutation-service.js'
import type { ProjectStoreStateV4 } from '../features/project/v4/project-store-v4.js'
import { createRobotDefinitionGeometryRepositoryV4 } from '../features/robot/v4/robot-definition-geometry-repository.js'
import { createRobotRuntimeRegistryV4 } from '../features/robot/v4/robot-runtime-registry.js'
import type { SceneCommandServiceV4 } from '../features/scene/v4/scene-command-service.js'
import { selectSceneRuntimeV4 } from '../features/scene/v4/scene-runtime-selector.js'
import { createSceneRuntimeStoreV4 } from '../features/scene/v4/scene-runtime-store.js'
import { createViewportPreferenceStoreV4 } from '../features/viewport/v4/viewport-preference-store.js'
import { createShellLayoutStoreV4 } from '../features/ui/v4/shell-layout-store.js'
import type { ShellLayoutControllerV4 } from '../features/ui/v4/shell-layout-controller.js'
import { App } from './App.js'

const observed = vi.hoisted(() => ({
  canvas: null as null | Record<string, unknown>,
  collision: null as null | Record<string, unknown>,
  inspector: null as null | Record<string, unknown>,
  jobList: null as null | Record<string, unknown>,
  timeline: null as null | Record<string, unknown>,
  contextMenuProjectRevisions: [] as string[],
  commandBindings: [] as Array<{ readonly runtime: {
    getState(): {
      readonly pendingCommandIds: ReadonlySet<string>
      readonly errorByCommandId: ReadonlyMap<string, string>
    }
    getRegistry(): AppCommandRegistryV4
    invoke(commandId: string): Promise<unknown>
  } }>,
  shellLayoutControllers: [] as ShellLayoutControllerV4[],
}))

vi.mock('./AppShell.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./AppShell.js')>()
  return {
    ...actual,
    AppShellV4: (props: Parameters<typeof actual.AppShellV4>[0]) => {
      observed.shellLayoutControllers.push(props.shellLayoutController)
      observed.commandBindings.push(props.commandBindings)
      return <actual.AppShellV4 {...props} />
    },
  }
})

vi.mock('../features/scene/v4/SceneCanvas.js', () => ({
  SceneCanvasV4: (props: Record<string, unknown>) => {
    observed.canvas = props
    return (
      <div data-testid="scene-canvas-v4">
        <button
          onClick={() => (
            props.onStatusChange as ((status: 'ready') => void) | undefined
          )?.('ready')}
          type="button"
        >
          Scene ready
        </button>
        <button
          onClick={() => (
            props.onContextRequest as ((request: unknown) => void)
          )({
            selection: null,
            position: { x: 10, y: 20 },
          })}
          type="button"
        >
          Empty context
        </button>
        <button
          onClick={() => (
            props.onRegistration as ((registration: unknown) => void)
          )({
            robots: new Map(),
            spatialEntities: new Map(),
            collisionProxies: [{ marker: 'proxy-v4' }],
          })}
          type="button"
        >
          Register collision proxies
        </button>
      </div>
    )
  },
}))

vi.mock('../features/scene/v4/SceneExplorer.js', () => ({
  SceneExplorerV4: (props: {
    onFocus: (selection: SceneSelectionTargetV4) => void
  }) => (
    <section data-testid="scene-explorer-v4">
      Scene Explorer V4
      <button
        onClick={() => props.onFocus({
          kind: 'robot',
          robotId: 'robot-default',
        })}
        type="button"
      >
        Focus Robot
      </button>
    </section>
  ),
}))

vi.mock('../features/scene/v4/SceneEntityInspector.js', () => ({
  SceneEntityInspectorV4: (props: Record<string, unknown>) => {
    observed.inspector = props
    return <section data-testid="scene-inspector-v4">Inspector V4</section>
  },
}))

vi.mock('../features/jobs/v4/RobotJobList.js', () => ({
  RobotJobListV4: (props: Record<string, unknown>) => {
    observed.jobList = props
    return <section data-testid="robot-jobs-v4">Robot Jobs V4</section>
  },
}))

vi.mock('../features/ui/v4/Timeline.js', () => ({
  TimelineV4: (props: Record<string, unknown>) => {
    observed.timeline = props
    return <section data-testid="timeline-v4">Timeline V4</section>
  },
}))

vi.mock('../features/scene/v4/SceneContextMenu.js', () => ({
  SceneContextMenuV4: (props: {
    commandBindings: { readonly runtime: { invoke(commandId: string): Promise<unknown> } }
    project: { readonly revisionId: string }
  }) => (
    (() => {
      observed.contextMenuProjectRevisions.push(props.project.revisionId)
      return (
        <div data-testid="scene-context-menu-v4">
          <button onClick={() => { void props.commandBindings.runtime.invoke('view.fitAll') }} type="button">Context Fit All</button>
          <button
            onClick={() => { void props.commandBindings.runtime.invoke('view.collision.open') }}
            type="button"
          >
            Open Collision
          </button>
        </div>
      )
    })()
  ),
}))

vi.mock('../features/collision/v4/CollisionPanel.js', () => ({
  CollisionPanelV4: (props: Record<string, unknown>) => {
    observed.collision = props
    return <section data-testid="collision-v4">Collision V4</section>
  },
}))

function resourcesForTest(): BrowserProjectResourcesV4 & {
  readonly sceneCommands: SceneCommandServiceV4
} {
  const project = createDefaultProjectV4({
    projectId: 'project-app-v4',
    revisionId: 'revision-app-v4',
    nowIso: '2026-07-17T00:00:00.000Z',
  })
  const robots = createRobotRuntimeRegistryV4()
  robots.getState().replaceProject(project)
  const jobs = createJobRuntimeStoreV4()
  jobs.getState().replaceProject(project)
  const projection = selectSceneRuntimeV4(project, robots.getState())
  const scene = createSceneRuntimeStoreV4()
  scene.getState().replaceProjection(projection)
  const interaction = createInteractionStoreV4()
  interaction.getState().replaceProject(project)
  const coordinateDisplay = createCoordinateDisplayStoreV4()
  coordinateDisplay.getState().replaceProject(project)
  const runtimeBundle = createBrowserRuntimeBundleStoreV4()
  const playback: RobotJobPlaybackControllerV4 = {
    startJob: vi.fn(() => ({ runId: 'run-app-v4' })),
    cancelRobotJob: vi.fn(),
    ensureRunning: vi.fn(),
    quiesce: vi.fn(async () => undefined),
    resume: vi.fn(),
    dispose: vi.fn(),
  }
  const executor = {
    startJob: vi.fn(() => ({ runId: 'run-app-v4' })),
    advanceAll: vi.fn(async () => undefined),
    cancelRobotJob: vi.fn(),
    readState: vi.fn(() => jobs.getState().byRobotId['robot-default']!),
    waitForTerminal: vi.fn(),
    reset: vi.fn(),
    shutdown: vi.fn(),
  }
  runtimeBundle.getState().replaceActive({
    project,
    sceneRuntime: projection,
    collisionPolicy: deriveCollisionPolicyV4(
      project.robots,
      project.robotDefinitions,
      { enabled: true, nearMissMarginM: 0.05 },
    ),
    jobs: {
      executor,
      playback,
      dispose: vi.fn(),
    },
  })
  const projectStore = createStore<ProjectStoreStateV4>()(() => ({
    activeProject: project,
    status: 'ready',
    error: null,
    hydrate: vi.fn(async () => undefined),
    newProject: vi.fn(async () => undefined),
    saveActiveProject: vi.fn(async () => project),
    exportActiveProject: vi.fn(async () => new Blob(['{}'])),
    importProject: vi.fn(async () => undefined),
  }))
  const mutations = {
    hydrate: vi.fn(async () => undefined),
    readPublished: vi.fn(() => null),
    subscribe: vi.fn(() => () => undefined),
    replace: vi.fn(),
    replacePrepared: vi.fn(),
    replaceFromActive: vi.fn(),
    isRecoveryRequired: vi.fn(() => false),
  } as unknown as ProjectMutationServiceV4
  const sceneCommands = {
    createBox: vi.fn(async () => 'box-v4'),
    createCylinder: vi.fn(async () => 'cylinder-v4'),
    createGroup: vi.fn(async () => 'group-v4'),
  } as unknown as SceneCommandServiceV4

  return {
    projectStore,
    mutations,
    robots,
    jobs,
    scene,
    interaction,
    coordinateDisplay,
    viewportPreferences: createViewportPreferenceStoreV4(null),
    shellLayoutStore: createShellLayoutStoreV4({ storage: null }),
    geometry: createRobotDefinitionGeometryRepositoryV4(),
    runtimeBundle,
    sceneCommands,
    jobCommands: {} as BrowserProjectResourcesV4['jobCommands'],
    projectFiles: {
      pickProject: vi.fn(async () => null),
      downloadProject: vi.fn(),
    },
    userPrompt: { requestText: vi.fn(async () => null) },
  }
}

describe('App Project V4 production composition', () => {
  beforeEach(() => {
    observed.canvas = null
    observed.collision = null
    observed.inspector = null
    observed.jobList = null
    observed.timeline = null
    observed.contextMenuProjectRevisions.length = 0
    observed.commandBindings.length = 0
    observed.shellLayoutControllers.length = 0
    localStorage.clear()
  })

  it('renders only after every public resource reports the active revision', () => {
    const resources = resourcesForTest()
    resources.scene.setState((state) => ({
      ...state,
      projectRevisionId: 'revision-stale',
    }), true)

    render(<App gatewayPublisher={null} resources={resources} />)

    expect(screen.getByRole('status')).toHaveTextContent(
      'Synchronizing Project V4',
    )
    expect(screen.queryByTestId('scene-canvas-v4')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Add' })).not.toBeInTheDocument()
    expect(resources.sceneCommands.createBox).not.toHaveBeenCalled()
  })

  it('exposes no mutation controls while Project recovery is required', () => {
    const resources = resourcesForTest()
    resources.projectStore.setState((state) => ({
      ...state,
      status: 'recovery-required',
      error: 'Recovery is required.',
    }), true)

    render(<App gatewayPublisher={null} resources={resources} />)

    expect(screen.getByRole('status')).toHaveTextContent(
      'Project V4 recovery requires a reload.',
    )
    expect(screen.queryByRole('button', { name: 'Add' })).not.toBeInTheDocument()
    expect(resources.sceneCommands.createBox).not.toHaveBeenCalled()
  })

  it('keeps the last durable Project usable after an ordinary command error', () => {
    const resources = resourcesForTest()
    resources.projectStore.setState((state) => ({
      ...state,
      status: 'error',
      error: 'Imported Project is invalid.',
    }), true)

    render(<App gatewayPublisher={null} resources={resources} />)

    expect(screen.getByTestId('scene-canvas-v4')).toBeInTheDocument()
    expect(screen.getByRole('menubar', { name: 'Application menu' })).toBeInTheDocument()
    expect(document.querySelector('[data-phase="error"]')).toHaveTextContent('error')
  })

  it('composes the V4 Scene, Inspector, Jobs, Timeline, and Collision surfaces', async () => {
    const resources = resourcesForTest()
    const user = userEvent.setup()

    render(<App gatewayPublisher={null} resources={resources} />)

    expect(screen.getByTestId('scene-explorer-v4')).toBeInTheDocument()
    expect(screen.getByTestId('scene-canvas-v4')).toBeInTheDocument()
    expect(screen.getByTestId('scene-inspector-v4')).toBeInTheDocument()
    expect(screen.getByTestId('robot-jobs-v4')).toBeInTheDocument()
    expect(screen.getByTestId('timeline-v4')).toBeInTheDocument()
    expect(screen.queryByTestId('collision-v4')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', {
      name: 'Bottom Workspace sheet',
    }))
    await user.click(screen.getByRole('tab', { name: /^Collision/ }))
    expect(screen.getByTestId('collision-v4')).toBeInTheDocument()
    expect(screen.queryByTestId('timeline-v4')).not.toBeInTheDocument()
    expect(screen.getByText((content) => (
      content.includes('CRB15000') && content.includes('Simulation')
    ))).toBeVisible()
    expect(screen.queryByText('Import STEP')).not.toBeInTheDocument()
    expect(screen.queryByText('Import Robot')).not.toBeInTheDocument()
    expect(screen.queryByText('Linear Axis')).not.toBeInTheDocument()
  })

  it('keeps Job surfaces on the Active Robot when Scene selection is non-Robot', async () => {
    const resources = resourcesForTest()
    render(<App gatewayPublisher={null} resources={resources} />)

    act(() => {
      resources.interaction.getState().select({ kind: 'scene-frame', frameId: 'world' })
    })

    await waitFor(() => {
      expect(observed.jobList?.selectedRobotId).toBe('robot-default')
      expect(observed.timeline?.robotId).toBe('robot-default')
      expect(resources.interaction.getState().activeRobotId).toBe('robot-default')
      expect(observed.inspector?.selection).toEqual({ kind: 'scene-frame', frameId: 'world' })
      expect(observed.inspector?.commandBindings).toBe(observed.timeline?.commandBindings)
    })
  })

  it('projects live Joint writes into the Scene Canvas runtime', async () => {
    const resources = resourcesForTest()
    render(<App gatewayPublisher={null} resources={resources} />)

    const jointValue = () => {
      const runtime = observed.canvas?.sceneRuntime as {
        readonly entities: ReadonlyMap<string, {
          readonly kind: string
          readonly serialPose?: { readonly jointValues: Readonly<Record<string, number>> }
        }>
      } | undefined
      return runtime?.entities.get('robot-default')?.serialPose?.jointValues.J1
    }
    expect(jointValue()).toBe(0)

    act(() => {
      resources.robots.getState().writeJointValues(
        'robot-default',
        { J1: 35 },
        'simulation',
      )
    })

    await waitFor(() => expect(jointValue()).toBe(35))
  })

  it('keeps the mounted viewport while live Joint and Scene selection state churn', () => {
    const resources = resourcesForTest()
    render(<App gatewayPublisher={null} resources={resources} />)
    const canvas = screen.getByTestId('scene-canvas-v4')

    act(() => {
      for (const jointValue of [5, 10, 15, 20]) {
        resources.robots.getState().writeJointValues(
          'robot-default',
          { J1: jointValue },
          'simulation',
        )
        resources.interaction.getState().select({ kind: 'scene-frame', frameId: 'world' })
        resources.interaction.getState().select({ kind: 'robot', robotId: 'robot-default' })
      }
    })

    expect(screen.getByTestId('scene-canvas-v4')).toBe(canvas)
    expect(screen.queryByText('Synchronizing Project V4…')).not.toBeInTheDocument()
  })

  it('routes primitive creation and revision-qualified Focus and Fit requests', async () => {
    const resources = resourcesForTest()
    const user = userEvent.setup()
    render(<App gatewayPublisher={null} resources={resources} />)

    await user.click(screen.getByRole('menuitem', { name: 'Model' }))
    await user.click(screen.getByRole('menuitem', { name: 'Add Box' }))
    expect(resources.sceneCommands.createBox).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Box',
        parentFrameId: 'mcp',
        groupId: null,
      }),
    )

    await user.click(screen.getByRole('button', { name: 'Focus Robot' }))
    await waitFor(() => expect(observed.canvas?.cameraRequest).toMatchObject({
      projectRevisionId: 'revision-app-v4',
      command: 'focus-selection',
    }))

    await user.click(screen.getByRole('button', { name: 'Empty context' }))
    await user.click(screen.getByRole('button', { name: 'Context Fit All' }))
    await waitFor(() => expect(observed.canvas?.cameraRequest).toMatchObject({
      projectRevisionId: 'revision-app-v4',
      command: 'fit-all',
    }))
  })

  it('retains registered collision proxies and opens Collision from context', async () => {
    const resources = resourcesForTest()
    const user = userEvent.setup()
    render(<App gatewayPublisher={null} resources={resources} />)

    await user.click(screen.getByRole('button', {
      name: 'Register collision proxies',
    }))
    await user.click(screen.getByRole('button', {
      name: 'Bottom Workspace sheet',
    }))
    await user.click(screen.getByRole('tab', { name: /^Collision/ }))
    await waitFor(() => expect(
      (observed.collision?.controller as { getState(): { canValidate: boolean } } | undefined)
        ?.getState().canValidate,
    ).toBe(true))

    await user.click(screen.getByRole('button', { name: 'Focus Robot' }))
    await user.click(screen.getByRole('button', { name: 'Empty context' }))
    await user.click(screen.getByRole('button', { name: 'Open Collision' }))

    expect(screen.getByRole('tabpanel', { name: 'Collision' })).toBeVisible()
    const collision = observed.collision?.controller as {
      getState(): { readonly result: unknown }
    }
    expect(collision.getState().result).toBeNull()
  })

  it('owns one Shell controller that opens the controlled Collision tab immediately', async () => {
    const resources = resourcesForTest()
    const user = userEvent.setup()
    const view = render(<App gatewayPublisher={null} resources={resources} />)

    const controller = observed.shellLayoutControllers.at(-1)
    expect(controller).toBeDefined()
    expect(observed.shellLayoutControllers.every((candidate) => candidate === controller)).toBe(true)

    await user.click(screen.getByRole('button', { name: 'Focus Robot' }))
    await user.click(screen.getByRole('button', { name: 'Empty context' }))
    await user.click(screen.getByRole('button', { name: 'Open Collision' }))

    expect(resources.interaction.getState().selection).toEqual({
      kind: 'robot',
      robotId: 'robot-default',
    })
    expect(controller?.getState().preferences.bottom.activeTab).toBe('collision')
    expect(controller?.getState().isDockVisible('bottom')).toBe(true)

    view.unmount()
    expect(() => controller?.setDockVisible('bottom', false)).not.toThrow()
  })

  it('keeps exactly one live Shell controller subscription through StrictMode replay', async () => {
    const resources = resourcesForTest()
    const originalSubscribe = resources.shellLayoutStore.subscribe
    let liveSubscriptions = 0
    let subscribeCalls = 0
    resources.shellLayoutStore.subscribe = (...args: Parameters<typeof originalSubscribe>) => {
      subscribeCalls += 1
      liveSubscriptions += 1
      const unsubscribe = originalSubscribe(...args)
      return () => {
        liveSubscriptions -= 1
        unsubscribe()
      }
    }
    const user = userEvent.setup()
    const view = render(
      <StrictMode>
        <App gatewayPublisher={null} resources={resources} />
      </StrictMode>,
    )

    await waitFor(() => expect(liveSubscriptions).toBe(1))
    expect(subscribeCalls).toBeGreaterThanOrEqual(2)
    const controller = observed.shellLayoutControllers.at(-1)!
    act(() => controller.setTheme('dark'))
    await user.click(screen.getByRole('button', { name: 'Focus Robot' }))
    await user.click(screen.getByRole('button', { name: 'Empty context' }))
    await user.click(screen.getByRole('button', { name: 'Open Collision' }))

    expect(controller.getState().preferences.theme).toBe('dark')
    expect(controller.getState().preferences.bottom.activeTab).toBe('collision')
    expect(controller.getState().isDockVisible('bottom')).toBe(true)

    view.unmount()
    expect(liveSubscriptions).toBe(0)
  })

  it('owns one live StrictMode command runtime/key listener and disposes it without post-unmount publication', async () => {
    const resources = resourcesForTest()
    const add = window.addEventListener.bind(window)
    const remove = window.removeEventListener.bind(window)
    const listeners = new Set<EventListenerOrEventListenerObject>()
    const addSpy = vi.spyOn(window, 'addEventListener').mockImplementation(((type: string, listener: EventListenerOrEventListenerObject | null, options?: boolean | AddEventListenerOptions) => {
      if (listener === null) return
      if (type === 'keydown' && listener !== null) listeners.add(listener)
      add(type, listener, options)
    }) as typeof window.addEventListener)
    const removeSpy = vi.spyOn(window, 'removeEventListener').mockImplementation(((type: string, listener: EventListenerOrEventListenerObject | null, options?: boolean | EventListenerOptions) => {
      if (listener === null) return
      if (type === 'keydown' && listener !== null) listeners.delete(listener)
      remove(type, listener, options)
    }) as typeof window.removeEventListener)
    const view = render(<StrictMode><App gatewayPublisher={null} resources={resources} /></StrictMode>)
    await waitFor(() => expect(listeners.size).toBe(1))
    const bindings = observed.commandBindings.at(-1)!
    expect(observed.commandBindings.filter((candidate) => candidate === bindings).length).toBeGreaterThan(0)
    view.unmount()
    expect(listeners.size).toBe(0)
    await expect(bindings.runtime.invoke('project.save')).resolves.toBe('ignored')
    expect(resources.projectStore.getState().saveActiveProject).not.toHaveBeenCalled()
    expect(addSpy).toHaveBeenCalled(); expect(removeSpy).toHaveBeenCalled()
  })

  it('routes Project and connectivity commands through only the injected App resource ports', async () => {
    const resources = resourcesForTest()
    render(<App gatewayPublisher={null} resources={resources} />)
    const runtime = observed.commandBindings.at(-1)!.runtime
    await expect(runtime.invoke('project.new')).resolves.toBe('completed')
    await expect(runtime.invoke('project.save')).resolves.toBe('completed')
    await expect(runtime.invoke('project.import')).resolves.toBe('cancelled')
    await expect(runtime.invoke('project.export')).resolves.toBe('completed')
    await expect(runtime.invoke('project.sample.dual')).resolves.toBe('completed')
    await expect(runtime.invoke('connectivity.mode.server')).resolves.toBe('completed')
    expect(resources.projectStore.getState().newProject).toHaveBeenCalledOnce()
    expect(resources.projectStore.getState().saveActiveProject).toHaveBeenCalledOnce()
    expect(resources.projectFiles.pickProject).toHaveBeenCalledOnce()
    expect(resources.projectFiles.downloadProject).toHaveBeenCalledWith(expect.any(Blob), 'Untitled Workcell.json')
    expect(vi.mocked(resources.mutations.replaceFromActive)).toHaveBeenCalledTimes(2)
  })

  it('retains the App binding across a registry replacement while an accepted command settles with its own error', async () => {
    const resources = resourcesForTest()
    let rejectSave: (error: Error) => void = () => undefined
    const save = new Promise<never>((_resolve, reject) => {
      rejectSave = reject
    })
    resources.projectStore.setState((state) => ({
      ...state,
      saveActiveProject: vi.fn(() => save),
    }), true)
    render(<App gatewayPublisher={null} resources={resources} />)

    const bindings = observed.commandBindings.at(-1)!
    const invocation = bindings.runtime.invoke('project.save')
    await waitFor(() => expect(
      bindings.runtime.getState().pendingCommandIds.has('project.save'),
    ).toBe(true))

    act(() => {
      resources.projectStore.setState((state) => ({ ...state, status: 'saving' }), true)
    })
    await waitFor(() => expect(observed.commandBindings.at(-1)).toBe(bindings))
    expect(bindings.runtime.getState().pendingCommandIds.has('project.save')).toBe(true)

    rejectSave(new Error('disk rejected'))
    await expect(invocation).resolves.toBe('failed')
    expect(bindings.runtime.getState().errorByCommandId.get('project.save')).toBe('disk rejected')
  })

  it('wires Ctrl+S, H, and F once through App shortcuts while excluding an editor target', async () => {
    const resources = resourcesForTest()
    const user = userEvent.setup()
    render(<App gatewayPublisher={null} resources={resources} />)

    window.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, ctrlKey: true, key: 's' }))
    await waitFor(() => expect(resources.projectStore.getState().saveActiveProject).toHaveBeenCalledOnce())

    window.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'h' }))
    await waitFor(() => expect(observed.canvas?.cameraRequest).toMatchObject({ command: 'home' }))

    await user.click(screen.getByRole('button', { name: 'Focus Robot' }))
    window.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'f' }))
    await waitFor(() => expect(observed.canvas?.cameraRequest).toMatchObject({ command: 'focus-selection' }))

    const input = document.createElement('input')
    document.body.append(input)
    input.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, ctrlKey: true, key: 's' }))
    expect(resources.projectStore.getState().saveActiveProject).toHaveBeenCalledOnce()
    input.remove()
  })

  it('drops a camera request from the previous Project revision', async () => {
    const resources = resourcesForTest()
    const user = userEvent.setup()
    render(<App gatewayPublisher={null} resources={resources} />)
    await user.click(screen.getByRole('button', { name: 'Focus Robot' }))
    await waitFor(() => expect(observed.canvas?.cameraRequest).toMatchObject({
      projectRevisionId: 'revision-app-v4',
    }))

    const nextProject = createDefaultProjectV4({
      projectId: 'project-app-v4',
      revisionId: 'revision-app-v4-next',
      nowIso: '2026-07-17T01:00:00.000Z',
    })
    act(() => {
      resources.robots.getState().replaceProject(nextProject)
      resources.jobs.getState().replaceProject(nextProject)
      const projection = selectSceneRuntimeV4(
        nextProject,
        resources.robots.getState(),
      )
      resources.scene.getState().replaceProjection(projection)
      resources.interaction.getState().replaceProject(nextProject)
      resources.coordinateDisplay.getState().replaceProject(nextProject)
      const priorJobs = resources.runtimeBundle.getState().active!.jobs
      resources.runtimeBundle.getState().replaceActive({
        project: nextProject,
        sceneRuntime: projection,
        collisionPolicy: deriveCollisionPolicyV4(
          nextProject.robots,
          nextProject.robotDefinitions,
          { enabled: true, nearMissMarginM: 0.05 },
        ),
        jobs: priorJobs,
      })
      resources.projectStore.setState((state) => ({
        ...state,
        activeProject: nextProject,
      }), true)
    })

    await waitFor(() => {
      const request = observed.canvas?.cameraRequest as
        | { readonly projectRevisionId?: string }
        | undefined
      expect(request?.projectRevisionId).not.toBe('revision-app-v4')
    })
  })

  it('fails a Focus command captured by a stale registry instead of completing a discarded camera request', async () => {
    const resources = resourcesForTest()
    const user = userEvent.setup()
    render(<App gatewayPublisher={null} resources={resources} />)
    await user.click(screen.getByRole('button', { name: 'Register collision proxies' }))
    act(() => {
      resources.interaction.getState().select({ kind: 'scene-frame', frameId: 'world' })
    })
    await waitFor(() => expect(
      observed.commandBindings.at(-1)!.runtime.getRegistry().get('view.focusSelection')!.enabled,
    ).toBe(true))
    const staleFocus = observed.commandBindings.at(-1)!
      .runtime.getRegistry().get('view.focusSelection')!

    const nextProject = createDefaultProjectV4({
      projectId: 'project-app-v4',
      revisionId: 'revision-app-v4-stale-focus',
      nowIso: '2026-07-17T01:30:00.000Z',
    })
    act(() => {
      resources.robots.getState().replaceProject(nextProject)
      resources.jobs.getState().replaceProject(nextProject)
      const projection = selectSceneRuntimeV4(nextProject, resources.robots.getState())
      resources.scene.getState().replaceProjection(projection)
      resources.interaction.getState().replaceProject(nextProject)
      resources.coordinateDisplay.getState().replaceProject(nextProject)
      const priorJobs = resources.runtimeBundle.getState().active!.jobs
      resources.runtimeBundle.getState().replaceActive({
        project: nextProject,
        sceneRuntime: projection,
        collisionPolicy: deriveCollisionPolicyV4(
          nextProject.robots,
          nextProject.robotDefinitions,
          { enabled: true, nearMissMarginM: 0.05 },
        ),
        jobs: priorJobs,
      })
      resources.projectStore.setState((state) => ({
        ...state,
        activeProject: nextProject,
      }), true)
    })

    await waitFor(() => expect(staleFocus.enabled).toBe(false))
    const outcome = await Promise.resolve()
      .then(() => staleFocus.execute())
      .then(() => 'completed' as const, () => 'failed' as const)
    expect(outcome).toBe('failed')
    expect(observed.canvas?.cameraRequest).not.toMatchObject({
      projectRevisionId: 'revision-app-v4',
      command: 'focus-selection',
    })
  })

  it('never exposes prior Scene readiness or context during Project replacement', async () => {
    const resources = resourcesForTest()
    const user = userEvent.setup()
    render(<App gatewayPublisher={null} resources={resources} />)

    await user.click(screen.getByRole('button', { name: 'Scene ready' }))
    await user.click(screen.getByRole('button', { name: 'Empty context' }))
    expect(screen.getByTestId('scene-context-menu-v4')).toBeInTheDocument()

    const nextProject = createDefaultProjectV4({
      projectId: 'project-app-v4',
      revisionId: 'revision-app-v4-replacement',
      nowIso: '2026-07-17T02:00:00.000Z',
    })
    act(() => {
      resources.robots.getState().replaceProject(nextProject)
      resources.jobs.getState().replaceProject(nextProject)
      const projection = selectSceneRuntimeV4(
        nextProject,
        resources.robots.getState(),
      )
      resources.scene.getState().replaceProjection(projection)
      resources.interaction.getState().replaceProject(nextProject)
      resources.coordinateDisplay.getState().replaceProject(nextProject)
      const priorJobs = resources.runtimeBundle.getState().active!.jobs
      resources.runtimeBundle.getState().replaceActive({
        project: nextProject,
        sceneRuntime: projection,
        collisionPolicy: deriveCollisionPolicyV4(
          nextProject.robots,
          nextProject.robotDefinitions,
          { enabled: true, nearMissMarginM: 0.05 },
        ),
        jobs: priorJobs,
      })
      resources.projectStore.setState((state) => ({
        ...state,
        activeProject: nextProject,
      }), true)
    })

    expect(
      observed.contextMenuProjectRevisions,
    ).not.toContain('revision-app-v4-replacement')
    expect(screen.queryByTestId('scene-context-menu-v4')).not.toBeInTheDocument()
  })
})
