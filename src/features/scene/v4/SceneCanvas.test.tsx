import { act, fireEvent, render, screen } from '@testing-library/react'
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
    readonly onPointerMissed?: () => void
  } & Record<string, unknown>) => {
    capture.canvas = props
    return (
      <div data-testid="r3f-canvas">
        <button onClick={onPointerMissed} type="button">Pointer miss</button>
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
      readonly onContextMenu: (
        selection: { readonly kind: 'robot'; readonly robotId: string },
        position: { readonly x: number; readonly y: number },
      ) => void
    }
    return (
      <>
        <button
          onClick={() => interaction.onSelect({ kind: 'robot', robotId: 'robot-1' })}
          type="button"
        >Select rendered Robot</button>
        <button
          onContextMenu={() => interaction.onContextMenu(
            { kind: 'robot', robotId: 'robot-1' },
            { x: 31, y: 47 },
          )}
          type="button"
        >Open rendered Robot menu</button>
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

  it('routes rendered identity once and clears selection for pointer-miss or empty context', () => {
    const data = renderCanvas()

    data.interaction.getState().clearSelection()
    fireEvent.click(screen.getByRole('button', { name: 'Select rendered Robot' }))
    expect(data.interaction.getState().selection).toEqual({
      kind: 'robot',
      robotId: 'robot-1',
    })

    fireEvent.contextMenu(screen.getByRole('button', { name: 'Open rendered Robot menu' }), {
      clientX: 31,
      clientY: 47,
    })
    expect(data.onContextRequest).toHaveBeenCalledTimes(1)
    expect(data.onContextRequest).toHaveBeenLastCalledWith({
      selection: { kind: 'robot', robotId: 'robot-1' },
      position: { x: 31, y: 47 },
    })

    fireEvent.click(screen.getByRole('button', { name: 'Pointer miss' }))
    expect(data.interaction.getState().selection).toBeNull()

    data.interaction.getState().select({ kind: 'robot', robotId: 'robot-1' })
    fireEvent.contextMenu(screen.getByTestId('scene-canvas-surface'), {
      clientX: 101,
      clientY: 202,
    })
    expect(data.interaction.getState().selection).toBeNull()
    expect(data.onContextRequest).toHaveBeenCalledTimes(2)
    expect(data.onContextRequest).toHaveBeenLastCalledWith({
      selection: null,
      position: { x: 101, y: 202 },
    })
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
