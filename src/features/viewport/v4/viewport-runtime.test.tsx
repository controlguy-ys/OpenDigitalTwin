import { render, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import {
  BoxGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
} from 'three'
import {
  validateWorkcellProjectV4,
  type SpatialEntityV4,
  type WorkcellProjectV4,
} from '../../../core/project-v4/index.js'
import { makeMinimalWorkcellProjectV4 } from '../../../core/project-v4/test-support.js'
import type { WorkcellRegistrationV4 } from '../../scene/Workcell.js'
import { createRobotRuntimeRegistryV4 } from '../../robot/v4/robot-runtime-registry.js'
import type { RobotInstanceRegistrationV4 } from '../../robot/v4/RobotInstanceModel.js'
import { selectSceneRuntimeV4 } from '../../scene/v4/scene-runtime-selector.js'
import { createViewportBoundResolversV4 } from './viewport-runtime.js'
import { ViewportRuntimeV4 } from './viewport-runtime.js'
import { createViewportPreferenceStoreV4 } from './viewport-preference-store.js'

const viewportHarness = vi.hoisted(() => ({
  camera: null as unknown,
  orbitProps: null as Record<string, unknown> | null,
}))

vi.mock('@react-three/fiber', () => ({
  useThree: (selector: (state: { readonly camera: unknown }) => unknown) => selector({
    camera: viewportHarness.camera,
  }),
}))

vi.mock('@react-three/drei/core/OrbitControls.js', async () => {
  const React = await import('react')
  const { Vector3 } = await import('three')
  const controls = { target: new Vector3(), update: vi.fn() }
  return {
    OrbitControls: React.forwardRef((props: Record<string, unknown>, ref) => {
      viewportHarness.orbitProps = props
      React.useImperativeHandle(ref, () => controls)
      return null
    }),
  }
})

function entity(id: string, groupId: string | null, x: number): SpatialEntityV4 {
  return {
    id,
    name: id,
    geometry: { kind: 'box', dimensionsM: [0.5, 0.5, 0.5], color: '#808080' },
    parentFrameId: 'world',
    localPose: { positionM: [x, 0, 0], quaternion: [0, 0, 0, 1] },
    visible: true,
    groupId,
    removable: true,
    transformOwner: 'manual',
    numericStatus: {
      value: 0,
      sourceOwnership: 'manual',
      overlay: { visible: false, frameId: null },
    },
    graspable: true,
    graspFrames: [{
      frameId: `${id}:grasp`,
      name: `${id} grasp`,
      localPose: { positionM: [0, 0, 1], quaternion: [0, 0, 0, 1] },
    }],
    movingFrames: [],
  }
}

function projectFixture(): WorkcellProjectV4 {
  const source = makeMinimalWorkcellProjectV4()
  return validateWorkcellProjectV4({
    ...source,
    revisionId: 'viewport-runtime-revision',
    sceneGroups: [
      { id: 'group:root', name: 'Root', parentGroupId: null, visible: true },
      { id: 'group:child', name: 'Child', parentGroupId: 'group:root', visible: true },
    ],
    spatialEntities: [
      entity('entity:a', 'group:root', 10),
      entity('entity:b', 'group:child', 20),
    ],
  })
}

function runtime(project: WorkcellProjectV4) {
  const robots = createRobotRuntimeRegistryV4()
  robots.getState().replaceProject(project)
  return selectSceneRuntimeV4(project, robots.getState())
}

function meshAt(x: number, size = 1): Mesh {
  const mesh = new Mesh(
    new BoxGeometry(size, size, size),
    new MeshBasicMaterial(),
  )
  mesh.position.x = x
  return mesh
}

function registration(): WorkcellRegistrationV4 {
  const root = new Group()
  root.add(meshAt(1))
  const link = meshAt(4, 0.2)
  const frame = new Group()
  frame.position.set(5, 0, 0)
  const robot: RobotInstanceRegistrationV4 = {
    robotId: 'robot-1',
    definitionId: 'definition-1',
    publicationHandle: null,
    geometryState: 'RESOLVED',
    root,
    linkObjects: new Map([['L0', link]]),
    frameObjects: new Map([['TCP', frame]]),
    collisionProxies: [],
  }
  return {
    robots: new Map([['robot-1', robot]]),
    spatialEntities: new Map([
      ['entity:a', meshAt(10)],
      ['entity:b', meshAt(20)],
    ]),
    collisionProxies: [],
  }
}

function xExtent(resolver: ReturnType<typeof createViewportBoundResolversV4>) {
  const bounds = resolver.focusSelectionBounds()
  return [bounds.min.x, bounds.max.x]
}

describe('viewport bound resolvers V4', () => {
  it('fits every effectively visible registered Robot and Spatial root', () => {
    const project = projectFixture()
    const bounds = createViewportBoundResolversV4(
      project,
      runtime(project),
      registration(),
      null,
    ).fitAllBounds()
    expect(bounds.min.x).toBeCloseTo(0.5)
    expect(bounds.max.x).toBeCloseTo(20.5)
  })

  it('maps qualified Robot, Link, Spatial, and nested Group selections exactly', () => {
    const project = projectFixture()
    const projection = runtime(project)
    const registered = registration()

    expect(xExtent(createViewportBoundResolversV4(
      project,
      projection,
      registered,
      { kind: 'robot', robotId: 'robot-1' },
    ))).toEqual([0.5, 1.5])
    const linkExtent = xExtent(createViewportBoundResolversV4(
      project,
      projection,
      registered,
      { kind: 'robot-link', robotId: 'robot-1', linkId: 'L0' },
    ))
    expect(linkExtent[0]).toBeCloseTo(3.9)
    expect(linkExtent[1]).toBeCloseTo(4.1)
    expect(xExtent(createViewportBoundResolversV4(
      project,
      projection,
      registered,
      { kind: 'spatial-entity', entityId: 'entity:a' },
    ))).toEqual([9.5, 10.5])
    expect(xExtent(createViewportBoundResolversV4(
      project,
      projection,
      registered,
      { kind: 'scene-group', groupId: 'group:root' },
    ))).toEqual([9.5, 20.5])
  })

  it('focuses Robot and global/entity Frames by their projected World pose', () => {
    const project = projectFixture()
    const projection = runtime(project)
    const registered = registration()

    const robotFrame = createViewportBoundResolversV4(
      project,
      projection,
      registered,
      { kind: 'robot-frame', robotId: 'robot-1', frameId: 'TCP' },
    )
    expect(robotFrame.canFocusSelection).toBe(true)
    expect(robotFrame.focusSelectionBounds().getCenter(new Group().position).x).toBe(5)

    const sceneFrame = createViewportBoundResolversV4(
      project,
      projection,
      registered,
      { kind: 'scene-frame', frameId: 'mcp' },
    )
    expect(sceneFrame.canFocusSelection).toBe(true)
    expect(sceneFrame.focusSelectionBounds().getCenter(new Group().position).x).toBe(0)

    const entityFrame = createViewportBoundResolversV4(
      project,
      projection,
      registered,
      { kind: 'entity-frame', entityId: 'entity:a', frameId: 'entity:a:grasp' },
    )
    expect(entityFrame.canFocusSelection).toBe(true)
    expect(entityFrame.focusSelectionBounds().getCenter(new Group().position).x).toBe(10)
  })

  it('fails focus closed for unresolved identity or missing registration', () => {
    const project = projectFixture()
    const projection = runtime(project)
    for (const selection of [
      { kind: 'robot' as const, robotId: 'missing' },
      { kind: 'robot-link' as const, robotId: 'robot-1', linkId: 'missing' },
      { kind: 'spatial-entity' as const, entityId: 'missing' },
      { kind: 'scene-group' as const, groupId: 'missing' },
      { kind: 'scene-frame' as const, frameId: 'missing' },
    ]) {
      const resolver = createViewportBoundResolversV4(
        project,
        projection,
        registration(),
        selection,
      )
      expect(resolver.canFocusSelection).toBe(false)
      expect(resolver.focusSelectionBounds().isEmpty()).toBe(true)
    }
    expect(createViewportBoundResolversV4(
      project,
      projection,
      null,
      { kind: 'robot', robotId: 'robot-1' },
    ).canFocusSelection).toBe(false)
    expect(createViewportBoundResolversV4(
      project,
      projection,
      null,
      { kind: 'scene-frame', frameId: 'world' },
    ).canFocusSelection).toBe(false)

    const unresolved = registration()
    const robot = unresolved.robots.get('robot-1')!
    const unresolvedRegistration: WorkcellRegistrationV4 = {
      ...unresolved,
      robots: new Map([['robot-1', { ...robot, geometryState: 'UNRESOLVED' }]]),
    }
    for (const selection of [
      { kind: 'robot' as const, robotId: 'robot-1' },
      { kind: 'robot-link' as const, robotId: 'robot-1', linkId: 'L0' },
      { kind: 'robot-frame' as const, robotId: 'robot-1', frameId: 'TCP' },
    ]) {
      expect(createViewportBoundResolversV4(
        project,
        projection,
        unresolvedRegistration,
        selection,
      ).canFocusSelection).toBe(false)
    }
  })

  it('does not focus an Entity Frame whose projection is hidden', () => {
    const source = projectFixture()
    const project = validateWorkcellProjectV4({
      ...source,
      revisionId: 'viewport-hidden-frame',
      spatialEntities: source.spatialEntities.map((candidate) => (
        candidate.id === 'entity:a' ? { ...candidate, visible: false } : candidate
      )),
    })
    const resolver = createViewportBoundResolversV4(
      project,
      runtime(project),
      registration(),
      { kind: 'entity-frame', entityId: 'entity:a', frameId: 'entity:a:grasp' },
    )
    expect(resolver.canFocusSelection).toBe(false)
    expect(resolver.focusSelectionBounds().isEmpty()).toBe(true)
  })

  it('does not impose a fixed Orbit distance cap on valid large-cell Fit All', async () => {
    const project = projectFixture()
    viewportHarness.camera = new PerspectiveCamera()
    viewportHarness.orbitProps = null
    render(
      <ViewportRuntimeV4
        onRegister={vi.fn()}
        preferences={createViewportPreferenceStoreV4(null)}
        project={project}
        registration={registration()}
        runtime={runtime(project)}
        selection={null}
      />,
    )
    await waitFor(() => expect(viewportHarness.orbitProps).not.toBeNull())
    expect(viewportHarness.orbitProps).not.toHaveProperty('maxDistance')
  })
})
