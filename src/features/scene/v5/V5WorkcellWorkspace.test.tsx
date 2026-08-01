import { fireEvent, render, screen } from '@testing-library/react'
import { forwardRef, type ReactNode } from 'react'
import { PerspectiveCamera } from 'three'
import { describe, expect, it, vi } from 'vitest'
import { createStore } from 'zustand/vanilla'

import {
  cloneWorkcellProjectV5,
  makeMinimalWorkcellProjectV5,
} from '../../../core/project-v5/test-support.js'
import {
  validateWorkcellProjectV5,
  type RigidTransformV5,
  type WorkcellProjectV5,
} from '../../../core/project-v5/index.js'
import type { BrowserRuntimeBundleStateV5 } from '../../project/v5/browser-runtime-bundle-store-v5.js'
import { V5WorkcellCanvas, V5WorkcellWorkspace, workcellProxyUserDataV5 } from './V5WorkcellWorkspace.js'

const { cameraProbe, frameMode } = vi.hoisted(() => ({
  cameraProbe: { current: null as object | null },
  frameMode: { enabled: true },
}))
const controlsProbe = {
  target: { values: [0, 0, 0] as [number, number, number], set(...values: [number, number, number]) { this.values = values } },
  update: vi.fn(),
}

vi.mock('@react-three/fiber', () => ({
  Canvas: ({ children }: { readonly children: ReactNode }) => children,
  useFrame: (callback: () => void) => { if (frameMode.enabled) callback() },
  useThree: <T,>(selector: (state: { readonly camera: object | null }) => T) => selector({ camera: cameraProbe.current }),
}))

vi.mock('@react-three/drei', () => ({
  GizmoHelper: ({ children }: { readonly children: ReactNode }) => children,
  GizmoViewcube: () => null,
  Grid: () => null,
  Html: ({ children }: { readonly children: ReactNode }) => children,
  OrbitControls: forwardRef((_, ref) => {
    if (typeof ref !== 'function' && ref !== null) ref.current = controlsProbe
    return null
  }),
  PerspectiveCamera: () => null,
}))

const SHARED_LINK_POSE: RigidTransformV5 = Object.freeze({
  positionM: Object.freeze([1, 2, 3] as const),
  quaternion: Object.freeze([0, 0, 0, 1] as const),
})

function project(revisionId = 'revision-1'): WorkcellProjectV5 {
  const base = makeMinimalWorkcellProjectV5()
  return validateWorkcellProjectV5({
    ...base,
    revisionId,
    spatialEntities: [{
      id: 'box',
      name: 'Workpiece',
      geometry: { kind: 'box', dimensionsM: [0.2, 0.2, 0.2], color: '#38bdf8' },
      parentFrameId: 'mcp',
      localPose: { positionM: [0, 0, 0.1], quaternion: [0, 0, 0, 1] },
      visible: true,
      groupId: null,
      removable: true,
      transformOwner: 'manual',
      numericStatus: { value: 0, sourceOwnership: 'manual', overlay: { visible: true, frameId: null } },
      graspable: false,
      graspFrames: [],
      movingFrames: [],
    }],
  })
}

function projectWithRepeatedLinkGeometry(): WorkcellProjectV5 {
  const next = cloneWorkcellProjectV5(project())
  const definition = next.robotDefinitions[0]!
  const link = definition.links.find(({ id }) => id === 'L0')!
  const first = link.geometryOccurrences[0]!
  ;(link.geometryOccurrences as unknown as Array<typeof first>).push({
    ...first,
    occurrenceKey: 'robot-occurrence-duplicate',
  })
  return validateWorkcellProjectV5(next)
}

function projectWithAssetEntity(): WorkcellProjectV5 {
  const base = project()
  const next = cloneWorkcellProjectV5(base)
  const occurrence = next.robotDefinitions[0]!.links[0]!.geometryOccurrences[0]!
  ;(occurrence.collisionBoxes as unknown as Array<typeof occurrence.collisionBoxes[number]>).push({
    id: 'collision-box-1',
    centerM: [0, 0, 0],
    halfExtentsM: [0.1, 0.1, 0.1],
    quaternion: [0, 0, 0, 1],
  })
  const baseWithCollision = validateWorkcellProjectV5(next)
  const entity = baseWithCollision.spatialEntities[0]!
  return validateWorkcellProjectV5({
    ...baseWithCollision,
    spatialEntities: [{
      ...entity,
      id: 'asset-object',
      name: 'Asset without collision boxes',
      geometry: {
        kind: 'asset',
        assetReferenceId: baseWithCollision.assetReferences[0]!.id,
        occurrenceKey: 'asset-occurrence',
        sourceConvention: { linearUnit: 'meter', sourceToMeters: 1, orientation: { mode: 'up-axis', upAxis: 'z' } },
        originMode: 'source',
        statistics: { vertices: 0, triangles: 0, meshes: 0, materials: 0 },
        collisionBoxes: [],
      },
    }],
  })
}

function bundleWithWorld(readRobotLinkWorldPose: ReturnType<typeof vi.fn>, readObjectWorldPose: () => RigidTransformV5 | null = () => null): BrowserRuntimeBundleStateV5 {
  const robots = createStore(() => ({ byRobotId: { 'robot-1': {} } }))
  return {
    runtimeEpoch: 1,
    project: projectWithRepeatedLinkGeometry(),
    projectRevisionId: 'revision-1',
    configRevision: 'a'.repeat(64),
    gatewayId: 'gateway-test',
    runtimeGraph: {
      robots,
      world: {
        readRobotLinkWorldPose,
        readRobotFrameWorldPose: () => null,
        readSceneFrameWorldPose: () => null,
        readObjectWorldPose,
      },
    },
  } as unknown as BrowserRuntimeBundleStateV5
}

describe('V5WorkcellWorkspace', () => {
  it('keeps binding available for a selected Object even before runtime activation', () => {
    const onOpenBinding = vi.fn()
    render(<V5WorkcellWorkspace
      bundle={null}
      onOpenBinding={onOpenBinding}
      onSelect={vi.fn()}
      project={project()}
      selection={{ kind: 'entity', id: 'box' }}
    />)
    fireEvent.click(screen.getByRole('button', { name: 'Open Binding…' }))
    expect(onOpenBinding).toHaveBeenCalledWith({ type: 'entity-status', entityId: 'box' })
    expect(screen.getByText('Project runtime is not active.')).toBeInTheDocument()
  })

  it('renders repeated Robot Link geometry through the shared World facade instead of private kinematics', () => {
    const readRobotLinkWorldPose = vi.fn((robotId: string, linkId: string): RigidTransformV5 | null => (
      robotId === 'robot-1' && linkId === 'L0' ? SHARED_LINK_POSE : null
    ))
    const activeProject = projectWithRepeatedLinkGeometry()
    render(<V5WorkcellWorkspace
      bundle={bundleWithWorld(readRobotLinkWorldPose)}
      onOpenBinding={vi.fn()}
      onSelect={vi.fn()}
      project={activeProject}
      selection={null}
    />)

    const linkReads = readRobotLinkWorldPose.mock.calls.filter(([, linkId]) => linkId === 'L0')
    expect(linkReads.length).toBeGreaterThanOrEqual(4)
    expect(screen.getByTestId('v5-scene-presentation')).toHaveAttribute('data-state', 'degraded')
    expect(screen.getByText('World pose unavailable for object:box. Geometry is hidden until runtime pose data recovers.')).toBeInTheDocument()
  })

  it('exposes camera pose diagnostics on the canvas wrapper', () => {
    render(<V5WorkcellCanvas
      bundle={bundleWithWorld(vi.fn(() => SHARED_LINK_POSE))}
      cameraPose={{ position: [7, 8, 9], target: [1, 2, 3] }}
      cameraVersion={4}
      onSelect={vi.fn()}
      project={projectWithRepeatedLinkGeometry()}
      selection={null}
    />)
    expect(screen.getByTestId('scene-canvas-surface')).toHaveAttribute('data-camera-position', '[7,8,9]')
    expect(screen.getByTestId('scene-canvas-surface')).toHaveAttribute('data-camera-target', '[1,2,3]')
  })

  it('synchronizes the supplied camera version and exposes collision and diagnostic proxy surfaces', () => {
    const camera = new PerspectiveCamera()
    vi.spyOn(camera, 'updateProjectionMatrix')
    cameraProbe.current = camera
    controlsProbe.target.values = [0, 0, 0]
    controlsProbe.update.mockClear()
    const { rerender } = render(<V5WorkcellCanvas
      bundle={bundleWithWorld(vi.fn(() => SHARED_LINK_POSE))}
      cameraPose={{ position: [7, 8, 9], target: [1, 2, 3] }}
      cameraVersion={5}
      onSelect={vi.fn()}
      project={projectWithAssetEntity()}
      selection={null}
    />)
    expect(camera.position.toArray()).toEqual([7, 8, 9])
    expect(camera.up.toArray()).toEqual([0, 0, 1])
    expect(controlsProbe.target.values).toEqual([1, 2, 3])
    expect(camera.updateProjectionMatrix).toHaveBeenCalledOnce()
    expect(controlsProbe.update).toHaveBeenCalledOnce()
    expect(workcellProxyUserDataV5('object:asset-object', 'diagnostic-wireframe')).toEqual(expect.objectContaining({ proxyKind: 'diagnostic-wireframe' }))
    expect(workcellProxyUserDataV5('robot:robot-1:link:L0:geometry:robot-occurrence', 'collision-box')).toEqual(expect.objectContaining({ proxyKind: 'collision-box' }))
    rerender(<V5WorkcellCanvas
      bundle={bundleWithWorld(vi.fn(() => SHARED_LINK_POSE))}
      cameraPose={{ position: [8, 9, 10], target: [2, 3, 4] }}
      cameraVersion={6}
      onSelect={vi.fn()}
      project={projectWithAssetEntity()}
      selection={null}
    />)
    expect(camera.position.toArray()).toEqual([8, 9, 10])
    expect(controlsProbe.target.values).toEqual([2, 3, 4])
    expect(camera.updateProjectionMatrix).toHaveBeenCalledTimes(2)
    expect(controlsProbe.update).toHaveBeenCalledTimes(2)
  })

  it('publishes proxy observability through R3F userData instead of DOM-only group attributes', () => {
    expect(workcellProxyUserDataV5('object:asset-object', 'diagnostic-wireframe')).toEqual({
      geometryKey: 'object:asset-object',
      proxyKind: 'diagnostic-wireframe',
    })
    expect(workcellProxyUserDataV5()).toEqual({})
  })

  it('publishes finite presentation bounds on mount even before the R3F frame loop runs', () => {
    frameMode.enabled = false
    const onPresentationChange = vi.fn()
    const activeBundle = bundleWithWorld(vi.fn(() => SHARED_LINK_POSE), () => SHARED_LINK_POSE)
    render(<V5WorkcellCanvas
      bundle={activeBundle}
      onPresentationChange={onPresentationChange}
      onSelect={vi.fn()}
      project={project()}
      selection={null}
    />)
    const latest = onPresentationChange.mock.calls.at(-1)?.[0]
    expect(latest?.state).toBe('ready')
    expect(latest?.visibleBounds?.radius).toBeGreaterThan(0)
    frameMode.enabled = true
  })

  it('invalidates the previous presentation before repopulating after a scene identity change', () => {
    frameMode.enabled = false
    const onPresentationChange = vi.fn()
    const firstBundle = bundleWithWorld(vi.fn(() => SHARED_LINK_POSE), () => SHARED_LINK_POSE)
    const { rerender } = render(<V5WorkcellCanvas
      bundle={firstBundle}
      onPresentationChange={onPresentationChange}
      onSelect={vi.fn()}
      project={project()}
      selection={null}
    />)
    onPresentationChange.mockClear()
    rerender(<V5WorkcellCanvas
      bundle={{ ...firstBundle, runtimeEpoch: 2, project: project('revision-next') }}
      onPresentationChange={onPresentationChange}
      onSelect={vi.fn()}
      project={project('revision-next')}
      selection={null}
    />)
    expect(onPresentationChange.mock.calls.some(([value]) => value.state === 'degraded')).toBe(true)
    expect(onPresentationChange.mock.calls.at(-1)?.[0].state).toBe('ready')
    frameMode.enabled = true
  })
})
