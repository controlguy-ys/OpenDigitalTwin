import { act, createEvent, fireEvent, render, screen } from '@testing-library/react'
import type { ComponentProps, ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { makeMinimalWorkcellProjectV4 } from '../../../core/project-v4/test-support.js'
import { createCoordinateDisplayStoreV4 } from '../../frames/v4/coordinate-display-store.js'
import { createInteractionStoreV4 } from '../../interaction/v4/interaction-store.js'
import { createRobotDefinitionGeometryRepositoryV4 } from '../../robot/v4/robot-definition-geometry-repository.js'
import { createRobotRuntimeRegistryV4 } from '../../robot/v4/robot-runtime-registry.js'
import { createViewportPreferenceStoreV4 } from '../../viewport/v4/viewport-preference-store.js'
import { selectSceneRuntimeV4 } from './scene-runtime-selector.js'
import { SceneCanvasV4 } from './SceneCanvas.js'

const capture = vi.hoisted(() => ({
  canvas: null as Record<string, unknown> | null,
  frameLayers: [] as Record<string, unknown>[],
  errorBoundary: null as Record<string, unknown> | null,
  overlay: null as Record<string, unknown> | null,
  runtime: null as Record<string, unknown> | null,
  tcpMarkers: [] as Record<string, unknown>[],
  workcell: null as Record<string, unknown> | null,
}))

vi.mock('@react-three/fiber', () => ({
  Canvas: ({ children, onPointerMissed, ...props }: {
    readonly children: ReactNode
    readonly onPointerMissed?: (event: { readonly button: number }) => void
  } & Record<string, unknown>) => {
    capture.canvas = props
    return (
      <div data-testid="r3f-canvas">
        <button
          onClick={(event) => onPointerMissed?.({ button: event.button })}
          type="button"
        >Pointer miss</button>
        {children}
      </div>
    )
  },
}))

vi.mock('./Workcell.js', () => ({
  WorkcellV4: (props: Record<string, unknown>) => {
    capture.workcell = props
    const interaction = props.interaction as {
      readonly onSelect: (selection: { readonly kind: 'robot'; readonly robotId: string }) => void
      readonly onContextCandidate: (
        selection: { readonly kind: 'robot'; readonly robotId: string },
        pointerId: number,
      ) => void
    }
    return (
      <>
        <button
          onPointerDown={(event) => interaction.onContextCandidate(
            { kind: 'robot', robotId: 'robot-1' },
            event.pointerId,
          )}
          type="button"
        >Stationary exact target</button>
      </>
    )
  },
}))

vi.mock('../SceneErrorBoundary.js', () => ({
  SceneErrorBoundary: (props: Record<string, unknown> & { readonly children: ReactNode }) => {
    capture.errorBoundary = props
    return props.children
  },
}))

vi.mock('../../viewport/v4/CoordinateFrameLayers.js', () => ({
  CoordinateFrameLayersV4: (props: Record<string, unknown>) => {
    capture.frameLayers.push(props)
    return <i data-testid="coordinate-frame-layers" />
  },
}))

vi.mock('../../viewport/v4/SelectedTcpFrameMarker.js', () => ({
  SelectedTcpFrameMarkerV4: (props: Record<string, unknown>) => {
    capture.tcpMarkers.push(props)
    return <i data-testid="selected-tcp-marker" />
  },
}))

vi.mock('../../viewport/v4/viewport-runtime.js', () => ({
  ViewportRuntimeV4: (props: Record<string, unknown>) => {
    capture.runtime = props
    return <i data-testid="viewport-runtime" />
  },
}))

vi.mock('../../viewport/v4/ViewportOverlay.js', () => ({
  ViewportOverlayV4: (props: Record<string, unknown>) => {
    capture.overlay = props
    return <i data-testid="viewport-overlay" />
  },
}))

function fixture() {
  const project = makeMinimalWorkcellProjectV4()
  const robots = createRobotRuntimeRegistryV4()
  robots.getState().replaceProject(project)
  const interaction = createInteractionStoreV4()
  interaction.getState().replaceProject(project)
  const coordinateDisplay = createCoordinateDisplayStoreV4()
  coordinateDisplay.getState().replaceProject(project)
  return {
    project,
    sceneRuntime: selectSceneRuntimeV4(project, robots.getState()),
    geometryRepository: createRobotDefinitionGeometryRepositoryV4(),
    interaction,
    coordinateDisplay,
    viewportPreferences: createViewportPreferenceStoreV4(null),
  }
}

function renderCanvas(
  overrides: Partial<ComponentProps<typeof SceneCanvasV4>> = {},
) {
  capture.canvas = null
  capture.frameLayers = []
  capture.errorBoundary = null
  capture.overlay = null
  capture.runtime = null
  capture.tcpMarkers = []
  capture.workcell = null
  const data = fixture()
  const onContextRequest = vi.fn()
  const onRegistration = vi.fn()
  const onStatusChange = vi.fn()
  const result = render(
    <SceneCanvasV4
      {...data}
      onContextRequest={onContextRequest}
      onRegistration={onRegistration}
      onStatusChange={onStatusChange}
      {...overrides}
    />,
  )
  return { ...data, ...result, onContextRequest, onRegistration, onStatusChange }
}

describe('SceneCanvasV4', () => {
  it('provides one ambient and one directional light for PBR scene materials', () => {
    const { container } = renderCanvas()

    expect(container.querySelectorAll('ambientlight')).toHaveLength(1)
    expect(container.querySelectorAll('directionallight')).toHaveLength(1)
  })

  it('composes only injected V4 scene owners with one Grid layer and one selected TCP marker', () => {
    const data = renderCanvas()

    expect(screen.getAllByTestId('coordinate-frame-layers')).toHaveLength(1)
    expect(screen.getAllByTestId('selected-tcp-marker')).toHaveLength(1)
    expect(screen.getAllByTestId('viewport-runtime')).toHaveLength(1)
    expect(screen.getAllByTestId('viewport-overlay')).toHaveLength(1)
    expect(capture.workcell).toMatchObject({
      project: data.project,
      sceneRuntime: data.sceneRuntime,
      geometryRepository: data.geometryRepository,
      viewIsolation: null,
    })
    expect(capture.frameLayers).toHaveLength(1)
    expect(capture.frameLayers[0]).toMatchObject({
      project: data.project,
      runtime: data.sceneRuntime,
      selection: { kind: 'robot', robotId: 'robot-1' },
      layers: data.viewportPreferences.getState().layers,
    })
    expect(capture.tcpMarkers).toEqual([
      expect.objectContaining({
        selection: { kind: 'robot', robotId: 'robot-1' },
        visible: true,
      }),
    ])
  })

  it('opens context for a stationary exact target and consumes its native menu', () => {
    const data = renderCanvas()

    data.interaction.getState().clearSelection()
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Stationary exact target' }), {
      button: 2,
      clientX: 31,
      clientY: 47,
      pointerId: 21,
      pointerType: 'mouse',
    })
    fireEvent.pointerUp(document, {
      button: 2,
      clientX: 31,
      clientY: 47,
      pointerId: 21,
      pointerType: 'mouse',
    })
    expect(data.interaction.getState().selection).toEqual({
      kind: 'robot',
      robotId: 'robot-1',
    })
    expect(data.onContextRequest).toHaveBeenLastCalledWith({
      selection: { kind: 'robot', robotId: 'robot-1' },
      position: { x: 31, y: 47 },
    })
    const nativeMenu = createEvent.contextMenu(document, {
      button: 2,
      clientX: 31,
      clientY: 47,
      pointerId: 21,
      pointerType: 'mouse',
    })
    expect(fireEvent(document, nativeMenu)).toBe(false)
  })

  it('clears selection and requests context for a stationary empty click', () => {
    const data = renderCanvas()
    const surface = screen.getByTestId('scene-canvas-surface')

    fireEvent.pointerDown(surface, {
      button: 2,
      clientX: 101,
      clientY: 202,
      pointerId: 22,
      pointerType: 'mouse',
    })
    fireEvent.pointerUp(document, {
      button: 2,
      clientX: 101,
      clientY: 202,
      pointerId: 22,
      pointerType: 'mouse',
    })
    expect(data.interaction.getState().selection).toBeNull()
    expect(data.onContextRequest).toHaveBeenLastCalledWith({
      selection: null,
      position: { x: 101, y: 202 },
    })
  })

  it('does not select or request context after a 5-pixel right-button Pan', () => {
    const data = renderCanvas()
    const target = screen.getByRole('button', { name: 'Stationary exact target' })

    fireEvent.pointerDown(target, {
      button: 2,
      clientX: 10,
      clientY: 20,
      pointerId: 23,
      pointerType: 'mouse',
    })
    fireEvent.pointerMove(document, {
      clientX: 15,
      clientY: 20,
      pointerId: 23,
      pointerType: 'mouse',
    })
    fireEvent.pointerUp(document, {
      button: 2,
      clientX: 15,
      clientY: 20,
      pointerId: 23,
      pointerType: 'mouse',
    })

    expect(data.interaction.getState().selection).toEqual({ kind: 'robot', robotId: 'robot-1' })
    expect(data.onContextRequest).not.toHaveBeenCalled()
  })

  it('cancels right gestures on pointer cancel, blur, and hidden document', () => {
    const data = renderCanvas()
    const surface = screen.getByTestId('scene-canvas-surface')
    const begin = (pointerId: number) => fireEvent.pointerDown(surface, {
      button: 2,
      clientX: pointerId,
      clientY: pointerId,
      pointerId,
      pointerType: 'mouse',
    })
    const finish = (pointerId: number) => fireEvent.pointerUp(document, {
      button: 2,
      clientX: pointerId,
      clientY: pointerId,
      pointerId,
      pointerType: 'mouse',
    })

    begin(24)
    fireEvent.pointerCancel(document, { pointerId: 24 })
    finish(24)
    begin(25)
    fireEvent.blur(window)
    finish(25)
    begin(26)
    const visibility = Object.getOwnPropertyDescriptor(document, 'visibilityState')
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' })
    fireEvent(document, new Event('visibilitychange'))
    if (visibility === undefined) delete (document as { visibilityState?: string }).visibilityState
    else Object.defineProperty(document, 'visibilityState', visibility)
    finish(26)

    expect(data.onContextRequest).not.toHaveBeenCalled()
  })

  it('handles document completion outside Canvas and leaves primary misses and keyboard menus alone', () => {
    const data = renderCanvas()
    const surface = screen.getByTestId('scene-canvas-surface')

    fireEvent.pointerDown(surface, {
      button: 2,
      clientX: 40,
      clientY: 50,
      pointerId: 27,
      pointerType: 'mouse',
    })
    fireEvent.pointerUp(document.body, {
      button: 2,
      clientX: 40,
      clientY: 50,
      pointerId: 27,
      pointerType: 'mouse',
    })
    expect(data.onContextRequest).toHaveBeenLastCalledWith({
      selection: null,
      position: { x: 40, y: 50 },
    })

    data.interaction.getState().select({ kind: 'robot', robotId: 'robot-1' })
    fireEvent.click(screen.getByRole('button', { name: 'Pointer miss' }), { button: 2 })
    expect(data.interaction.getState().selection).toEqual({ kind: 'robot', robotId: 'robot-1' })
    fireEvent.click(screen.getByRole('button', { name: 'Pointer miss' }), { button: 0 })
    expect(data.interaction.getState().selection).toBeNull()
    const keyboardMenu = createEvent.contextMenu(document, { button: 0, clientX: 0, clientY: 0 })
    expect(fireEvent(document, keyboardMenu)).toBe(true)
  })

  it('matches legacy native menus only at final coordinates and preserves the newest completion', () => {
    const animationFrames: FrameRequestCallback[] = []
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      animationFrames.push(callback)
      return animationFrames.length
    })
    const data = renderCanvas()
    const surface = screen.getByTestId('scene-canvas-surface')
    const complete = (pointerId: number, clientX: number, clientY: number) => {
      fireEvent.pointerDown(surface, { button: 2, clientX, clientY, pointerId, pointerType: 'mouse' })
      fireEvent.pointerUp(document, { button: 2, clientX, clientY, pointerId, pointerType: 'mouse' })
    }

    complete(28, 61, 71)
    expect(fireEvent.contextMenu(document, { button: 2, clientX: 61, clientY: 72 })).toBe(true)
    expect(fireEvent.contextMenu(document, { button: 2, clientX: 61, clientY: 71 })).toBe(false)
    complete(29, 81, 91)
    complete(30, 101, 111)
    act(() => animationFrames[1]?.(0))
    expect(fireEvent.contextMenu(document, {
      button: 2,
      clientX: 101,
      clientY: 111,
      pointerId: 30,
      pointerType: 'mouse',
    })).toBe(false)
    vi.unstubAllGlobals()
    expect(data.onContextRequest).toHaveBeenCalledTimes(3)
  })

  it('does not treat overlay controls as empty Canvas context', () => {
    const data = renderCanvas()

    fireEvent.contextMenu(screen.getByTestId('viewport-overlay'), {
      clientX: 12,
      clientY: 18,
    })
    expect(data.interaction.getState().selection).toEqual({
      kind: 'robot',
      robotId: 'robot-1',
    })
    expect(data.onContextRequest).not.toHaveBeenCalled()
  })

  it('forwards non-null unresolved registration as ready and null as loading', () => {
    const data = renderCanvas()
    const onRegister = capture.workcell?.onRegister as (
      registration: Record<string, unknown> | null,
    ) => void
    const unresolvedRegistration = {
      robots: new Map([['robot-1', { geometryState: 'PLACEHOLDER' }]]),
      spatialEntities: new Map(),
      collisionProxies: [],
    }

    expect(data.container.firstElementChild).toHaveAttribute('data-scene-status', 'loading')
    act(() => onRegister(unresolvedRegistration))
    expect(data.onRegistration).toHaveBeenLastCalledWith(unresolvedRegistration)
    expect(data.container.firstElementChild).toHaveAttribute('data-scene-status', 'ready')
    act(() => onRegister(null))
    expect(data.onRegistration).toHaveBeenLastCalledWith(null)
    expect(data.container.firstElementChild).toHaveAttribute('data-scene-status', 'loading')
  })

  it('forwards structured isolation without changing registration ownership', () => {
    const data = renderCanvas()

    act(() => data.interaction.getState().isolate({ kind: 'robot', robotId: 'robot-1' }))
    expect(capture.workcell).toMatchObject({
      viewIsolation: { kind: 'robot', robotId: 'robot-1' },
    })
    expect(capture.runtime).toMatchObject({
      project: data.project,
      runtime: data.sceneRuntime,
      selection: { kind: 'robot', robotId: 'robot-1' },
    })
  })

  it('initializes the Canvas camera from the injected V4 preference store', () => {
    const data = fixture()
    data.viewportPreferences.getState().setCameraState({
      position: [8, 7, 6],
      target: [3, 2, 1],
      quaternion: [0, 0, 0, 1],
      up: [0, 0, 1],
      zoom: 1.25,
      fov: 42,
      near: 0.05,
      far: 900,
    })
    renderCanvas(data)

    expect(capture.canvas?.camera).toEqual({
      position: [8, 7, 6],
      zoom: 1.25,
      fov: 42,
      near: 0.05,
      far: 900,
    })
  })

  it('runs each matching revision-qualified camera request once and ignores stale requests', () => {
    const data = renderCanvas()
    const home = vi.fn()
    const fitAll = vi.fn()
    const focusSelection = vi.fn()
    const onRegister = capture.runtime?.onRegister as (controller: Record<string, unknown>) => void
    act(() => onRegister({
      actions: {
        home,
        fitAll,
        focusSelection,
        setStandardView: vi.fn(),
      },
      canFocusSelection: true,
      readCameraState: () => data.viewportPreferences.getState().cameraState,
    }))

    const matching = {
      id: 1,
      projectRevisionId: data.project.revisionId,
      command: 'fit-all' as const,
    }
    data.rerender(
      <SceneCanvasV4
        cameraRequest={matching}
        coordinateDisplay={data.coordinateDisplay}
        geometryRepository={data.geometryRepository}
        interaction={data.interaction}
        onContextRequest={data.onContextRequest}
        project={data.project}
        sceneRuntime={data.sceneRuntime}
        viewportPreferences={data.viewportPreferences}
      />,
    )
    expect(fitAll).toHaveBeenCalledOnce()

    data.rerender(
      <SceneCanvasV4
        cameraRequest={matching}
        coordinateDisplay={data.coordinateDisplay}
        geometryRepository={data.geometryRepository}
        interaction={data.interaction}
        onContextRequest={data.onContextRequest}
        project={data.project}
        sceneRuntime={data.sceneRuntime}
        viewportPreferences={data.viewportPreferences}
      />,
    )
    expect(fitAll).toHaveBeenCalledOnce()

    data.rerender(
      <SceneCanvasV4
        cameraRequest={{
          id: 2,
          projectRevisionId: 'stale-revision',
          command: 'focus-selection',
        }}
        coordinateDisplay={data.coordinateDisplay}
        geometryRepository={data.geometryRepository}
        interaction={data.interaction}
        onContextRequest={data.onContextRequest}
        project={data.project}
        sceneRuntime={data.sceneRuntime}
        viewportPreferences={data.viewportPreferences}
      />,
    )
    expect(focusSelection).not.toHaveBeenCalled()

    data.rerender(
      <SceneCanvasV4
        cameraRequest={{
          id: 3,
          projectRevisionId: data.project.revisionId,
          command: 'home',
        }}
        coordinateDisplay={data.coordinateDisplay}
        geometryRepository={data.geometryRepository}
        interaction={data.interaction}
        onContextRequest={data.onContextRequest}
        project={data.project}
        sceneRuntime={data.sceneRuntime}
        viewportPreferences={data.viewportPreferences}
      />,
    )
    expect(home).toHaveBeenCalledOnce()
  })

  it('clears an error scope when a new Project revision becomes ready', () => {
    const data = renderCanvas()
    const onError = capture.errorBoundary?.onError as (error: Error) => void

    act(() => onError(new Error('renderer failed')))
    expect(data.container.firstElementChild).toHaveAttribute('data-scene-status', 'error')

    const nextProject = {
      ...data.project,
      revisionId: 'revision-after-renderer-failure',
    }
    const nextRobots = createRobotRuntimeRegistryV4()
    nextRobots.getState().replaceProject(nextProject)
    const nextRuntime = selectSceneRuntimeV4(nextProject, nextRobots.getState())
    data.interaction.getState().replaceProject(nextProject)
    data.coordinateDisplay.getState().replaceProject(nextProject)
    data.rerender(
      <SceneCanvasV4
        coordinateDisplay={data.coordinateDisplay}
        geometryRepository={data.geometryRepository}
        interaction={data.interaction}
        onContextRequest={data.onContextRequest}
        onRegistration={data.onRegistration}
        onStatusChange={data.onStatusChange}
        project={nextProject}
        sceneRuntime={nextRuntime}
        viewportPreferences={data.viewportPreferences}
      />,
    )
    expect(data.container.firstElementChild).toHaveAttribute('data-scene-status', 'loading')
    const onRegister = capture.workcell?.onRegister as (
      registration: Record<string, unknown> | null,
    ) => void
    const registration = {
      robots: new Map([['robot-1', { geometryState: 'RESOLVED' }]]),
      spatialEntities: new Map(),
      collisionProxies: [],
    }
    act(() => onRegister(registration))
    expect(data.container.firstElementChild).toHaveAttribute('data-scene-status', 'ready')
  })
})
