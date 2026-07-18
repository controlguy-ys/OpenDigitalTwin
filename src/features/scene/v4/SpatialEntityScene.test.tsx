import { StrictMode } from 'react'
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import {
  BoxGeometry,
  BufferGeometry,
  CylinderGeometry,
  Material,
  Mesh,
  Object3D,
  Vector3,
} from 'three'
import { makeMinimalWorkcellProjectV4 } from '../../../core/project-v4/test-support'
import { validateWorkcellProjectV4 } from '../../../core/project-v4/validate'
import type { SpatialEntityV4, WorkcellProjectV4 } from '../../../core/project-v4/types'
import { createObjectRuntimeStateV4 } from '../../runtime-gateway/v4/object-runtime-state-v4'
import { visibleCollisionEntitiesV4 } from '../../collision/v4/scene-entity-adapter-v4'
import { buildInitialRobotRuntimeStatesV4 } from '../../robot/v4/robot-runtime-registry'
import {
  selectSceneRuntimeV4,
  type SceneRuntimeEntityV4,
  type SceneRuntimeProjectionV4,
  type SceneRuntimeSpatialEntityV4,
} from './scene-runtime-selector'
import {
  resolveSpatialEntityWorldPoseV4,
  SpatialEntitySceneV4,
  type SpatialEntitySceneRegistrationV4,
} from './SpatialEntityScene'

const fiberCapture = vi.hoisted(() => ({
  frame: null as (() => void) | null,
}))

vi.mock('@react-three/fiber', () => ({
  createPortal: (node: unknown) => node,
  useFrame: (callback: () => void) => { fiberCapture.frame = callback },
}))

vi.mock('@react-three/drei/web/Html.js', () => ({
  Html: ({ children }: { children: unknown }) => children,
}))

const transformControlsCapture = vi.hoisted(() => ({
  props: null as Record<string, unknown> | null,
  instances: new Map<string, object>(),
}))

vi.mock('./SpatialEntityTransformControls.js', async () => {
  const React = await import('react')
  return {
    SpatialEntityTransformControlsV4: (props: Record<string, unknown>) => {
      const instance = React.useRef<object>({})
      transformControlsCapture.props = props
      transformControlsCapture.instances.set(
        props.entityId as string,
        instance.current,
      )
      return <output data-testid="spatial-transform-controls" />
    },
  }
})

function entity(
  id: string,
  geometry: SpatialEntityV4['geometry'],
  groupId: string | null = null,
): SpatialEntityV4 {
  return {
    id,
    name: id,
    geometry,
    parentFrameId: 'world',
    localPose: { positionM: [id.length, 0, 0], quaternion: [0, 0, 0, 1] },
    visible: true,
    groupId,
    removable: true,
    transformOwner: 'manual',
    numericStatus: {
      value: id.length,
      sourceOwnership: 'manual',
      overlay: { visible: true, frameId: null },
    },
    graspable: false,
    graspFrames: [],
    movingFrames: [],
  }
}

function spatialProject(): WorkcellProjectV4 {
  const project = makeMinimalWorkcellProjectV4()
  return {
    ...project,
    sceneGroups: [{
      id: 'hidden-group',
      name: 'Hidden Group',
      parentGroupId: null,
      visible: false,
    }],
    spatialEntities: [
      entity('box-entity', {
        kind: 'box',
        dimensionsM: [1, 2, 3],
        color: '#112233',
      }),
      entity('cylinder-entity', {
        kind: 'cylinder',
        radiusM: 0.5,
        heightM: 2,
        axis: 'z',
        radialSegments: 32,
        color: '#445566',
      }),
      entity('asset-entity', {
        kind: 'asset',
        assetReferenceId: 'asset-robot',
        occurrenceKey: 'asset-entity-occurrence',
        sourceConvention: {
          linearUnit: 'millimeter',
          sourceToMeters: 0.001,
          orientation: { mode: 'up-axis', upAxis: 'z' },
        },
        originMode: 'source',
        statistics: { vertices: 30, triangles: 10, meshes: 1, materials: 1 },
        collisionBoxes: [{
          id: 'asset-box',
          centerM: [0.1, 0, 0.2],
          halfExtentsM: [0.2, 0.3, 0.4],
          quaternion: [0, 0, 0, 1],
        }],
      }),
      entity('hidden-entity', {
        kind: 'box',
        dimensionsM: [1, 1, 1],
        color: '#778899',
      }, 'hidden-group'),
    ],
  }
}

const LIVE_REVISION = 'e'.repeat(64)

function liveSpatialProject(): WorkcellProjectV4 {
  const source = spatialProject()
  const owner = 'opcua:endpoint-live' as const
  const box = source.spatialEntities.find(({ id }) => id === 'box-entity')!
  const frameId = 'box-entity-motion'
  const target = { type: 'entity-frame' as const, entityId: box.id, frameId }
  return validateWorkcellProjectV4({
    ...source,
    revisionId: LIVE_REVISION,
    spatialEntities: [{
      ...box,
      parentFrameId: frameId,
      localPose: { positionM: [0.25, 0, 0], quaternion: [0, 0, 0, 1] },
      transformOwner: owner,
      numericStatus: { ...box.numericStatus, sourceOwnership: owner },
      movingFrames: [{
        frameId,
        name: 'Box live motion',
        parentFrameId: 'world',
        localPose: { positionM: [0, 0, 0], quaternion: [0, 0, 0, 1] },
        sourceOwnership: owner,
      }],
    }],
    opcUa: {
      mode: 'client',
      endpoints: [{
        endpointId: 'endpoint-live',
        name: 'Live',
        endpointUrl: 'opc.tcp://127.0.0.1:4840',
        enabled: true,
        publishingIntervalMs: 100,
        reconnectDelayMs: 1_000,
      }],
      mappings: [{
        id: 'mapping-live-pose',
        endpointId: 'endpoint-live',
        direction: 'read',
        publishingIntervalMs: 100,
        coherenceGroupId: 'box-live-pose',
        sourceOwnership: owner,
        interpolationMode: 'shortest-quaternion',
        coordinateConvention: 'project-v4-z-up-metres-quaternion-xyzw',
        leaves: [
          ['positionM', 0, 'X'], ['positionM', 1, 'Y'], ['positionM', 2, 'Z'],
          ['rpyDegrees', 0, 'Roll'], ['rpyDegrees', 1, 'Pitch'], ['rpyDegrees', 2, 'Yaw'],
        ].map(([root, index, suffix]) => ({
          leafPath: [root as string, index as number],
          nodeId: `ns=2;s=Box/${suffix}`,
          projectTarget: target,
          opcUaDataType: 'Double',
          projectDataType: 'number',
          scale: 1,
          offset: 0,
          unit: root === 'positionM' ? 'metre' : 'degree',
          required: true,
        })),
      }, {
        id: 'mapping-live-status',
        endpointId: 'endpoint-live',
        direction: 'read',
        publishingIntervalMs: 100,
        coherenceGroupId: null,
        sourceOwnership: owner,
        interpolationMode: 'none',
        coordinateConvention: 'project-v4-z-up-metres-quaternion-xyzw',
        leaves: [{
          leafPath: [],
          nodeId: 'ns=2;s=Box/Status',
          projectTarget: { type: 'entity-status', entityId: box.id },
          opcUaDataType: 'Double',
          projectDataType: 'number',
          scale: 1,
          offset: 0,
          unit: 'number',
          required: true,
        }],
      }],
      actionBindings: [],
      bridgeRoutes: [],
    },
  })
}

function liveBatch(sequence: number, x: number, status = 42) {
  return {
    type: 'state-batch-v1' as const,
    protocolVersion: 1 as const,
    gatewayId: 'gateway-live',
    projectId: 'project-v4',
    configRevision: LIVE_REVISION,
    endpointId: 'endpoint-live',
    sequence,
    sourceTimestampMs: 900 + sequence * 100,
    publishedTimestampMs: 4_900 + sequence * 100,
    originId: 'gateway-live:client',
    values: [{
      mappingId: 'mapping-live-pose',
      coherenceGroupId: 'box-live-pose',
      value: { positionM: [x, 0, 0], quaternion: [0, 0, 0, 1] },
      unit: 'project-v4-z-up-metres-quaternion-xyzw',
      quality: 'GOOD' as const,
      statusCode: 'Good',
    }, {
      mappingId: 'mapping-live-status',
      coherenceGroupId: null,
      value: status,
      unit: 'number',
      quality: 'GOOD' as const,
      statusCode: 'Good',
    }],
  }
}

function statusOnlyLiveSpatialProject(): WorkcellProjectV4 {
  const source = liveSpatialProject()
  const box = source.spatialEntities[0]!
  return validateWorkcellProjectV4({
    ...source,
    spatialEntities: [{
      ...box,
      parentFrameId: 'world',
      localPose: { positionM: [7, 0, 0], quaternion: [0, 0, 0, 1] },
      transformOwner: 'manual',
      movingFrames: [],
    }],
    opcUa: {
      ...source.opcUa,
      mappings: source.opcUa.mappings.filter(({ id }) => id === 'mapping-live-status'),
    },
  })
}

function runtimeFor(project: WorkcellProjectV4): SceneRuntimeProjectionV4 {
  return selectSceneRuntimeV4(project, {
    projectRevisionId: project.revisionId,
    robots: buildInitialRobotRuntimeStatesV4(project),
  })
}

function replaceSpatialRuntime(
  projection: SceneRuntimeProjectionV4,
  entityId: string,
  patch: Partial<SceneRuntimeSpatialEntityV4>,
): SceneRuntimeProjectionV4 {
  const current = projection.entities.get(entityId)
  if (current?.kind !== 'spatial-entity') {
    throw new Error(`Expected ${entityId} to be a Spatial Entity runtime.`)
  }
  const entities = new Map<string, SceneRuntimeEntityV4>(projection.entities)
  const next = Object.freeze({ ...current, ...patch })
  entities.set(entityId, next)
  const visibleSpatialEntityIds = projection.visibleSpatialEntityIds.filter(
    (id) => id !== entityId,
  )
  if (next.effectiveVisible) visibleSpatialEntityIds.push(entityId)
  return Object.freeze({
    ...projection,
    entities,
    visibleSpatialEntityIds: Object.freeze(visibleSpatialEntityIds),
  })
}

function firstMesh(root: Object3D): Mesh {
  const mesh = root.getObjectByProperty('type', 'Mesh')
  if (!(mesh instanceof Mesh)) throw new Error('Expected a Mesh.')
  return mesh
}

function materialOf(mesh: Mesh): Material {
  if (Array.isArray(mesh.material)) throw new Error('Expected one Material.')
  return mesh.material
}

function expectRuntimeReadonlyMap(map: ReadonlyMap<unknown, unknown>): void {
  expect(Object.isFrozen(map)).toBe(true)
  expect('set' in map).toBe(false)
  expect('delete' in map).toBe(false)
  expect('clear' in map).toBe(false)
}

describe('SpatialEntitySceneV4', () => {
  it('shows a translate gizmo only for the selected manually owned Spatial Entity', async () => {
    transformControlsCapture.instances.clear()
    const project = spatialProject()
    let registration: SpatialEntitySceneRegistrationV4 | null = null
    const commitLocalPose = vi.fn(async () => undefined)
    const { rerender } = render(
      <SpatialEntitySceneV4
        gizmoFrame="world"
        onCommitLocalPose={commitLocalPose}
        onRegister={(value) => {
          registration = value
        }}
        project={project}
        sceneRuntime={runtimeFor(project)}
        selection={{ kind: 'spatial-entity', entityId: 'box-entity' }}
      />,
    )

    await waitFor(() => expect(registration?.roots.size).toBe(3))
    expect(screen.getByTestId('spatial-transform-controls')).toBeInTheDocument()
    expect(transformControlsCapture.props).toMatchObject({
      entityId: 'box-entity',
      persistedWorldPose: { positionM: [10, 0, 0], quaternion: [0, 0, 0, 1] },
      gizmoFrame: 'world',
    })

    for (const entityId of ['cylinder-entity', 'asset-entity']) {
      rerender(
        <SpatialEntitySceneV4
          gizmoFrame="world"
          onCommitLocalPose={commitLocalPose}
          onRegister={(value) => {
            registration = value
          }}
          project={project}
          sceneRuntime={runtimeFor(project)}
          selection={{ kind: 'spatial-entity', entityId }}
        />,
      )
      expect(transformControlsCapture.props).toMatchObject({ entityId })
    }
    expect([...new Set(transformControlsCapture.instances.values())]).toHaveLength(3)

    rerender(
      <SpatialEntitySceneV4
        gizmoFrame="parent"
        onCommitLocalPose={commitLocalPose}
        onRegister={(value) => {
          registration = value
        }}
        project={{
          ...project,
          spatialEntities: project.spatialEntities.map((candidate) => (
            candidate.id === 'box-entity'
              ? { ...candidate, transformOwner: 'opcua:endpoint-a' as const }
              : candidate
          )),
        }}
        sceneRuntime={runtimeFor(project)}
        selection={{ kind: 'spatial-entity', entityId: 'box-entity' }}
      />,
    )
    expect(screen.queryByTestId('spatial-transform-controls')).toBeNull()
  })

  it('renders visible primitives and bounded unresolved Assets with Z-axis cylinders', async () => {
    const project = spatialProject()
    const sceneRuntime = runtimeFor(project)
    let registration: SpatialEntitySceneRegistrationV4 | null = null
    const view = render(
      <SpatialEntitySceneV4
        onRegister={(value) => {
          registration = value
        }}
        project={project}
        sceneRuntime={sceneRuntime}
      />,
    )

    await waitFor(() => expect(registration?.roots.size).toBe(3))
    expect([...registration!.roots.keys()]).toEqual([
      'box-entity',
      'cylinder-entity',
      'asset-entity',
    ])
    const box = registration!.roots.get('box-entity')!.getObjectByProperty('type', 'Mesh') as Mesh
    expect(box.geometry).toBeInstanceOf(BoxGeometry)
    const cylinder = registration!.roots.get('cylinder-entity')!
      .getObjectByProperty('type', 'Mesh') as Mesh
    expect(cylinder.geometry).toBeInstanceOf(CylinderGeometry)
    cylinder.geometry.computeBoundingBox()
    const cylinderSize = cylinder.geometry.boundingBox!.getSize(new Vector3())
    expect(cylinderSize.z).toBeCloseTo(2)
    expect(cylinderSize.x).toBeCloseTo(1)
    expect(cylinderSize.y).toBeCloseTo(1)
    const assetRoot = registration!.roots.get('asset-entity')!
    expect(assetRoot.getObjectByName('spatial-geometry-unresolved')).not.toBeNull()
    expect(assetRoot.userData.geometryState).toBe('UNRESOLVED')
    expect(registration!.collisionProxies).toHaveLength(3)
    expect(screen.getByRole('status', { name: 'box-entity numeric status' })).toHaveTextContent('10')
    expect(screen.queryByRole('status', { name: 'hidden-entity numeric status' })).toBeNull()

    view.unmount()
    expect(registration).toBeNull()
  })

  it('uses quaternion-aware collision-box AABBs for unresolved placeholders and overlays', async () => {
    const project = spatialProject()
    const rotatedAsset = entity('rotated-asset', {
      kind: 'asset',
      assetReferenceId: 'asset-robot',
      occurrenceKey: 'rotated-asset-occurrence',
      sourceConvention: {
        linearUnit: 'millimeter',
        sourceToMeters: 0.001,
        orientation: { mode: 'up-axis', upAxis: 'z' },
      },
      originMode: 'source',
      statistics: { vertices: 30, triangles: 10, meshes: 1, materials: 1 },
      collisionBoxes: [{
        id: 'rotated-box',
        centerM: [0.5, -0.5, 1],
        halfExtentsM: [1, 2, 3],
        quaternion: [0, 0, Math.SQRT1_2, Math.SQRT1_2],
      }],
    })
    const rotatedProject = { ...project, spatialEntities: [rotatedAsset] }
    let registration: SpatialEntitySceneRegistrationV4 | null = null
    const view = render(
      <SpatialEntitySceneV4
        onRegister={(value) => {
          registration = value
        }}
        project={rotatedProject}
        sceneRuntime={runtimeFor(rotatedProject)}
      />,
    )

    await waitFor(() => expect(registration).not.toBeNull())
    const root = registration!.roots.get('rotated-asset')!
    const placeholder = firstMesh(root)
    placeholder.geometry.computeBoundingBox()
    const size = placeholder.geometry.boundingBox!.getSize(new Vector3())
    expect(size.x).toBeCloseTo(4)
    expect(size.y).toBeCloseTo(2)
    expect(size.z).toBeCloseTo(6)
    expect(placeholder.position.x).toBeCloseTo(0.5)
    expect(placeholder.position.y).toBeCloseTo(-0.5)
    expect(placeholder.position.z).toBeCloseTo(1)
    const overlayPosition = root.getObjectByName('spatial-status:rotated-asset')!.position
    expect(overlayPosition.x).toBeCloseTo(0.5)
    expect(overlayPosition.y).toBeCloseTo(-0.5)
    expect(overlayPosition.z).toBeCloseTo(4.06)

    view.unmount()
  })

  it('publishes immutable root snapshots while retaining Object identities across visibility changes', async () => {
    const project = spatialProject()
    const initialRuntime = runtimeFor(project)
    const registrations: SpatialEntitySceneRegistrationV4[] = []
    const onRegister = (value: SpatialEntitySceneRegistrationV4 | null) => {
      if (value !== null) registrations.push(value)
    }
    const view = render(
      <SpatialEntitySceneV4
        onRegister={onRegister}
        project={project}
        sceneRuntime={initialRuntime}
      />,
    )
    await waitFor(() => expect(registrations).toHaveLength(1))
    const first = registrations[0]!
    const cylinderRoot = first.roots.get('cylinder-entity')
    expectRuntimeReadonlyMap(first.roots)

    view.rerender(
      <SpatialEntitySceneV4
        onRegister={onRegister}
        project={project}
        sceneRuntime={replaceSpatialRuntime(initialRuntime, 'box-entity', {
          effectiveVisible: false,
        })}
      />,
    )
    await waitFor(() => expect(registrations.at(-1)?.roots.size).toBe(2))
    const second = registrations.at(-1)!
    expectRuntimeReadonlyMap(second.roots)
    expect(first.roots.size).toBe(3)
    expect(first.roots.has('box-entity')).toBe(true)
    expect(second.roots.has('box-entity')).toBe(false)
    expect(second.roots.get('cylinder-entity')).toBe(cylinderRoot)

    view.unmount()
  })

  it('updates poses, proxies, and overlays without recreating stable scene resources', async () => {
    const project = spatialProject()
    const initialRuntime = runtimeFor(project)
    const registrations: SpatialEntitySceneRegistrationV4[] = []
    const publicationEvents: Array<SpatialEntitySceneRegistrationV4 | null> = []
    const onRegister = (value: SpatialEntitySceneRegistrationV4 | null) => {
      publicationEvents.push(value)
      if (value !== null) registrations.push(value)
    }
    const view = render(
      <SpatialEntitySceneV4
        onRegister={onRegister}
        project={project}
        sceneRuntime={initialRuntime}
      />,
    )
    await waitFor(() => expect(registrations).toHaveLength(1))
    const first = registrations[0]!
    const root = first.roots.get('box-entity')!
    const mesh = firstMesh(root)
    const geometry = mesh.geometry
    const material = materialOf(mesh)
    const firstProxy = first.collisionProxies.find(
      ({ entity }) => entity.name === 'box-entity',
    )!
    const changedRuntime = replaceSpatialRuntime(initialRuntime, 'box-entity', {
      worldPose: {
        positionM: [99, 2, 3],
        quaternion: [0, 0, 0, 1],
      },
      numericStatus: 42,
    })

    view.rerender(
      <SpatialEntitySceneV4
        onRegister={onRegister}
        project={project}
        sceneRuntime={changedRuntime}
      />,
    )
    await waitFor(() => {
      expect(registrations.at(-1)?.roots.get('box-entity')?.position.toArray())
        .toEqual([99, 2, 3])
      expect(screen.getByRole('status', { name: 'box-entity numeric status' }))
        .toHaveTextContent('42')
    })
    const second = registrations.at(-1)!
    const updatedMesh = firstMesh(second.roots.get('box-entity')!)
    const secondProxy = second.collisionProxies.find(
      ({ entity }) => entity.name === 'box-entity',
    )!
    expect(second.roots.get('box-entity')).toBe(root)
    expect(updatedMesh.geometry).toBe(geometry)
    expect(materialOf(updatedMesh)).toBe(material)
    expect(firstProxy.entity.worldMatrix.slice(12, 15)).toEqual([10, 0, 0])
    expect(secondProxy.entity.worldMatrix.slice(12, 15)).toEqual([99, 2, 3])
    expect(publicationEvents).toEqual([first, second])

    view.unmount()
    expect(publicationEvents).toEqual([first, second, null])
  })

  it('retains resources across same-geometry Project snapshots with new poses and statuses', async () => {
    const project = spatialProject()
    const registrations: SpatialEntitySceneRegistrationV4[] = []
    const publicationEvents: Array<SpatialEntitySceneRegistrationV4 | null> = []
    const onRegister = (value: SpatialEntitySceneRegistrationV4 | null) => {
      publicationEvents.push(value)
      if (value !== null) registrations.push(value)
    }
    const view = render(
      <SpatialEntitySceneV4
        onRegister={onRegister}
        project={project}
        sceneRuntime={runtimeFor(project)}
      />,
    )
    await waitFor(() => expect(registrations).toHaveLength(1))
    const first = registrations[0]!
    const root = first.roots.get('box-entity')!
    const mesh = firstMesh(root)
    const geometry = mesh.geometry
    const material = materialOf(mesh)
    const changedProject: WorkcellProjectV4 = {
      ...project,
      revisionId: 'revision-pose-status',
      spatialEntities: project.spatialEntities.map((candidate) => (
        candidate.id === 'box-entity'
          ? {
              ...candidate,
              localPose: {
                positionM: [123, 4, 5],
                quaternion: [0, 0, 0, 1],
              },
              numericStatus: {
                ...candidate.numericStatus,
                value: 88,
              },
            }
          : candidate
      )),
    }

    view.rerender(
      <SpatialEntitySceneV4
        onRegister={onRegister}
        project={changedProject}
        sceneRuntime={runtimeFor(changedProject)}
      />,
    )
    await waitFor(() => {
      expect(registrations).toHaveLength(2)
      expect(screen.getByRole('status', { name: 'box-entity numeric status' }))
        .toHaveTextContent('88')
    })
    const second = registrations[1]!
    const updatedMesh = firstMesh(second.roots.get('box-entity')!)
    expect(second.roots.get('box-entity')).toBe(root)
    expect(updatedMesh.geometry).toBe(geometry)
    expect(materialOf(updatedMesh)).toBe(material)
    expect(root.position.toArray()).toEqual([123, 4, 5])
    expect(publicationEvents).toEqual([first, second])

    view.unmount()
    expect(publicationEvents.at(-1)).toBeNull()
  })

  it('hands registration from callback A to B without rebuilding scene resources', async () => {
    const project = spatialProject()
    const sceneRuntime = runtimeFor(project)
    const events: string[] = []
    let registrationA: SpatialEntitySceneRegistrationV4 | null = null
    let registrationB: SpatialEntitySceneRegistrationV4 | null = null
    const onRegisterA = (value: SpatialEntitySceneRegistrationV4 | null) => {
      events.push(value === null ? 'A:null' : 'A:registration')
      registrationA = value
    }
    const onRegisterB = (value: SpatialEntitySceneRegistrationV4 | null) => {
      events.push(value === null ? 'B:null' : 'B:registration')
      registrationB = value
    }
    const view = render(
      <SpatialEntitySceneV4
        onRegister={onRegisterA}
        project={project}
        sceneRuntime={sceneRuntime}
      />,
    )
    await waitFor(() => expect(registrationA).not.toBeNull())
    const root = registrationA!.roots.get('box-entity')!
    const mesh = firstMesh(root)
    const geometry = mesh.geometry
    const material = materialOf(mesh)

    view.rerender(
      <SpatialEntitySceneV4
        onRegister={onRegisterB}
        project={project}
        sceneRuntime={sceneRuntime}
      />,
    )
    await waitFor(() => expect(registrationB).not.toBeNull())
    const updatedMesh = firstMesh(registrationB!.roots.get('box-entity')!)
    expect(events).toEqual(['A:registration', 'A:null', 'B:registration'])
    expect(registrationB!.roots.get('box-entity')).toBe(root)
    expect(updatedMesh.geometry).toBe(geometry)
    expect(materialOf(updatedMesh)).toBe(material)

    view.unmount()
    expect(events).toEqual([
      'A:registration',
      'A:null',
      'B:registration',
      'B:null',
    ])
  })

  it('attempts the full callback handoff rollback and preserves its first error', async () => {
    const project = spatialProject()
    const sceneRuntime = runtimeFor(project)
    const events: string[] = []
    const firstFailure = new Error('A unregister primary')
    let registration: SpatialEntitySceneRegistrationV4 | null = null
    const onRegisterA = (value: SpatialEntitySceneRegistrationV4 | null) => {
      events.push(value === null ? 'A:null' : 'A:registration')
      if (value === null) throw firstFailure
      registration = value
    }
    const onRegisterB = (value: SpatialEntitySceneRegistrationV4 | null) => {
      events.push(value === null ? 'B:null' : 'B:registration')
      if (value === null) throw new Error('B unregister cleanup')
      throw new Error('B registration cleanup')
    }
    const view = render(
      <SpatialEntitySceneV4
        onRegister={onRegisterA}
        project={project}
        sceneRuntime={sceneRuntime}
      />,
    )
    await waitFor(() => expect(registration).not.toBeNull())
    const geometryAttempts: Array<ReturnType<typeof vi.fn>> = []
    const materialAttempts: Array<ReturnType<typeof vi.fn>> = []
    let index = 0
    registration!.roots.forEach((root) => {
      const currentIndex = index
      const mesh = firstMesh(root)
      const disposeGeometry = vi.fn(() => {
        if (currentIndex === 0) throw new Error('geometry cleanup')
      })
      mesh.geometry.dispose = disposeGeometry
      geometryAttempts.push(disposeGeometry)
      const disposeMaterial = vi.fn(() => {
        if (currentIndex === 0) throw new Error('material cleanup')
      })
      materialOf(mesh).dispose = disposeMaterial
      materialAttempts.push(disposeMaterial)
      index += 1
    })

    let caught: unknown
    try {
      view.rerender(
        <SpatialEntitySceneV4
          onRegister={onRegisterB}
          project={project}
          sceneRuntime={sceneRuntime}
        />,
      )
    } catch (error) {
      caught = error
    }
    expect(caught).toBe(firstFailure)
    expect(events).toEqual([
      'A:registration',
      'A:null',
      'B:registration',
      'B:null',
    ])
    expect(geometryAttempts.every((attempt) => attempt.mock.calls.length === 1)).toBe(true)
    expect(materialAttempts.every((attempt) => attempt.mock.calls.length === 1)).toBe(true)
  })

  it('replaces and disposes resources when Entity geometry topology changes', async () => {
    const project = spatialProject()
    const registrations: SpatialEntitySceneRegistrationV4[] = []
    const onRegister = (value: SpatialEntitySceneRegistrationV4 | null) => {
      if (value !== null) registrations.push(value)
    }
    const view = render(
      <SpatialEntitySceneV4
        onRegister={onRegister}
        project={project}
        sceneRuntime={runtimeFor(project)}
      />,
    )
    await waitFor(() => expect(registrations).toHaveLength(1))
    const oldRoot = registrations[0]!.roots.get('box-entity')!
    const oldMesh = firstMesh(oldRoot)
    const disposeGeometry = vi.fn()
    const disposeMaterial = vi.fn()
    oldMesh.geometry.dispose = disposeGeometry
    materialOf(oldMesh).dispose = disposeMaterial
    const changedProject: WorkcellProjectV4 = {
      ...project,
      revisionId: 'revision-geometry',
      spatialEntities: project.spatialEntities.map((candidate) => (
        candidate.id === 'box-entity'
          ? {
              ...candidate,
              geometry: {
                kind: 'box',
                dimensionsM: [4, 5, 6],
                color: '#112233',
              },
            }
          : candidate
      )),
    }

    view.rerender(
      <SpatialEntitySceneV4
        onRegister={onRegister}
        project={changedProject}
        sceneRuntime={runtimeFor(changedProject)}
      />,
    )
    await waitFor(() => expect(registrations).toHaveLength(2))
    expect(registrations[1]!.roots.get('box-entity')).not.toBe(oldRoot)
    expect(disposeGeometry).toHaveBeenCalledOnce()
    expect(disposeMaterial).toHaveBeenCalledOnce()

    view.unmount()
  })

  it('preserves registration failures while attempting every setup rollback action', () => {
    const project = spatialProject()
    const primary = new Error('registration primary')
    const removeAttempts: Array<ReturnType<typeof vi.fn>> = []
    const geometryAttempts: Array<ReturnType<typeof vi.fn>> = []
    const materialAttempts: Array<ReturnType<typeof vi.fn>> = []
    let compensationCount = 0
    const onRegister = (value: SpatialEntitySceneRegistrationV4 | null) => {
      if (value === null) {
        compensationCount += 1
        return
      }
      let index = 0
      value.roots.forEach((root) => {
        const currentIndex = index
        const remove = vi.fn(() => {
          if (currentIndex === 0) throw new Error('remove cleanup')
          return root
        })
        root.removeFromParent = remove
        removeAttempts.push(remove)
        const mesh = firstMesh(root)
        const disposeGeometry = vi.fn(() => {
          if (currentIndex === 0) throw new Error('geometry cleanup')
        })
        mesh.geometry.dispose = disposeGeometry
        geometryAttempts.push(disposeGeometry)
        const disposeMaterial = vi.fn(() => {
          if (currentIndex === 0) throw new Error('material cleanup')
        })
        materialOf(mesh).dispose = disposeMaterial
        materialAttempts.push(disposeMaterial)
        index += 1
      })
      throw primary
    }

    let caught: unknown
    try {
      render(
        <SpatialEntitySceneV4
          onRegister={onRegister}
          project={project}
          sceneRuntime={runtimeFor(project)}
        />,
      )
    } catch (error) {
      caught = error
    }
    expect(caught).toBe(primary)
    expect(compensationCount).toBe(1)
    expect(removeAttempts).toHaveLength(3)
    expect(removeAttempts.every((attempt) => attempt.mock.calls.length === 1)).toBe(true)
    expect(geometryAttempts.every((attempt) => attempt.mock.calls.length === 1)).toBe(true)
    expect(materialAttempts.every((attempt) => attempt.mock.calls.length === 1)).toBe(true)
  })

  it('withdraws a previous publication when a runtime update fails before republishing', async () => {
    const project = spatialProject()
    const initialRuntime = runtimeFor(project)
    let registration: SpatialEntitySceneRegistrationV4 | null = null
    let unregisterAttempts = 0
    const unregisterFailure = new Error('unregister cleanup')
    const onRegister = (value: SpatialEntitySceneRegistrationV4 | null) => {
      if (value === null) {
        unregisterAttempts += 1
        throw unregisterFailure
      }
      registration = value
    }
    const view = render(
      <SpatialEntitySceneV4
        onRegister={onRegister}
        project={project}
        sceneRuntime={initialRuntime}
      />,
    )
    await waitFor(() => expect(registration).not.toBeNull())
    const geometryAttempts: Array<ReturnType<typeof vi.fn>> = []
    const materialAttempts: Array<ReturnType<typeof vi.fn>> = []
    let index = 0
    registration!.roots.forEach((root) => {
      const currentIndex = index
      const mesh = firstMesh(root)
      const disposeGeometry = vi.fn(() => {
        if (currentIndex === 0) throw new Error('geometry cleanup')
      })
      mesh.geometry.dispose = disposeGeometry
      geometryAttempts.push(disposeGeometry)
      const disposeMaterial = vi.fn(() => {
        if (currentIndex === 0) throw new Error('material cleanup')
      })
      materialOf(mesh).dispose = disposeMaterial
      materialAttempts.push(disposeMaterial)
      index += 1
    })
    const invalidEntities = new Map(initialRuntime.entities)
    invalidEntities.delete('box-entity')
    const invalidRuntime: SceneRuntimeProjectionV4 = {
      ...initialRuntime,
      entities: invalidEntities,
    }

    let caught: unknown
    try {
      view.rerender(
        <SpatialEntitySceneV4
          onRegister={onRegister}
          project={project}
          sceneRuntime={invalidRuntime}
        />,
      )
    } catch (error) {
      caught = error
    }
    expect(caught).toBeInstanceOf(Error)
    expect((caught as Error).message)
      .toBe('Spatial Entity box-entity has no V4 runtime projection.')
    expect(caught).not.toBe(unregisterFailure)
    expect(unregisterAttempts).toBe(1)
    expect(geometryAttempts.every((attempt) => attempt.mock.calls.length === 1)).toBe(true)
    expect(materialAttempts.every((attempt) => attempt.mock.calls.length === 1)).toBe(true)
  })

  it('preserves unregister failures while attempting every unmount cleanup action', async () => {
    const project = spatialProject()
    const primary = new Error('unregister primary')
    let registration: SpatialEntitySceneRegistrationV4 | null = null
    const onRegister = (value: SpatialEntitySceneRegistrationV4 | null) => {
      if (value === null) throw primary
      registration = value
    }
    const view = render(
      <SpatialEntitySceneV4
        onRegister={onRegister}
        project={project}
        sceneRuntime={runtimeFor(project)}
      />,
    )
    await waitFor(() => expect(registration).not.toBeNull())
    const removeAttempts: Array<ReturnType<typeof vi.fn>> = []
    const geometryAttempts: Array<ReturnType<typeof vi.fn>> = []
    const materialAttempts: Array<ReturnType<typeof vi.fn>> = []
    let index = 0
    registration!.roots.forEach((root) => {
      const currentIndex = index
      const remove = vi.fn(() => {
        if (currentIndex === 0) throw new Error('remove cleanup')
        return root
      })
      root.removeFromParent = remove
      removeAttempts.push(remove)
      const mesh = firstMesh(root)
      const disposeGeometry = vi.fn(() => {
        if (currentIndex === 0) throw new Error('geometry cleanup')
      })
      mesh.geometry.dispose = disposeGeometry
      geometryAttempts.push(disposeGeometry)
      const disposeMaterial = vi.fn(() => {
        if (currentIndex === 0) throw new Error('material cleanup')
      })
      materialOf(mesh).dispose = disposeMaterial
      materialAttempts.push(disposeMaterial)
      index += 1
    })

    let caught: unknown
    try {
      view.unmount()
    } catch (error) {
      caught = error
    }
    expect(caught).toBe(primary)
    expect(removeAttempts.every((attempt) => attempt.mock.calls.length === 1)).toBe(true)
    expect(geometryAttempts.every((attempt) => attempt.mock.calls.length === 1)).toBe(true)
    expect(materialAttempts.every((attempt) => attempt.mock.calls.length === 1)).toBe(true)
  })

  it('uses disjoint idempotently disposed resources across StrictMode setup cycles', async () => {
    const project = spatialProject()
    const registrations: SpatialEntitySceneRegistrationV4[] = []
    const geometryDispose = vi.spyOn(BufferGeometry.prototype, 'dispose')
    const materialDispose = vi.spyOn(Material.prototype, 'dispose')
    const onRegister = (value: SpatialEntitySceneRegistrationV4 | null) => {
      if (value === null) return
      registrations.push(value)
    }
    const view = render(
      <StrictMode>
        <SpatialEntitySceneV4
          onRegister={onRegister}
          project={project}
          sceneRuntime={runtimeFor(project)}
        />
      </StrictMode>,
    )

    await waitFor(() => expect(registrations).toHaveLength(1))
    expect(geometryDispose).toHaveBeenCalledTimes(project.spatialEntities.length)
    expect(materialDispose).toHaveBeenCalledTimes(project.spatialEntities.length)

    view.unmount()
    expect(geometryDispose).toHaveBeenCalledTimes(project.spatialEntities.length * 2)
    expect(materialDispose).toHaveBeenCalledTimes(project.spatialEntities.length * 2)
    geometryDispose.mockRestore()
    materialDispose.mockRestore()
  })

  it('isolates Spatial visuals and emits exact identity without changing registration or proxies', async () => {
    const source = spatialProject()
    const project: WorkcellProjectV4 = {
      ...source,
      revisionId: 'spatial-isolation-revision',
      sceneGroups: [
        ...source.sceneGroups,
        { id: 'group-root', name: 'Root', parentGroupId: null, visible: true },
        { id: 'group-child', name: 'Child', parentGroupId: 'group-root', visible: true },
      ],
      spatialEntities: source.spatialEntities.map((candidate) => (
        candidate.id === 'box-entity'
          ? { ...candidate, groupId: 'group-root' }
          : candidate.id === 'cylinder-entity'
            ? { ...candidate, groupId: 'group-child' }
            : candidate
      )),
    }
    const onSelect = vi.fn()
    const onContextCandidate = vi.fn()
    let registration: SpatialEntitySceneRegistrationV4 | null = null
    const common = {
      interaction: { onSelect, onContextCandidate },
      onRegister: (value: SpatialEntitySceneRegistrationV4 | null) => {
        if (value !== null) registration = value
      },
      project,
      sceneRuntime: runtimeFor(project),
    }
    const view = render(
      <SpatialEntitySceneV4
        {...common}
        viewIsolation={{ kind: 'scene-group', groupId: 'group-root' }}
      />,
    )
    await waitFor(() => expect(registration?.roots.size).toBe(3))
    expect(registration!.roots.get('box-entity')!.visible).toBe(true)
    expect(registration!.roots.get('cylinder-entity')!.visible).toBe(true)
    expect(registration!.roots.get('asset-entity')!.visible).toBe(false)
    expect(screen.getByRole('status', { name: 'box-entity numeric status' })).toBeVisible()
    expect(screen.queryByRole('status', { name: 'asset-entity numeric status' }))
      .not.toBeInTheDocument()

    const primitive = view.container.querySelectorAll('primitive')[0]!
    fireEvent.pointerDown(primitive, { button: 2, pointerId: 21 })
    expect(onContextCandidate).toHaveBeenCalledWith({
      kind: 'spatial-entity',
      entityId: 'box-entity',
    }, 21)
    expect(onSelect).not.toHaveBeenCalled()
    fireEvent.pointerDown(primitive, { button: 0, pointerId: 22 })
    expect(onSelect).toHaveBeenCalledWith({
      kind: 'spatial-entity',
      entityId: 'box-entity',
    })

    const proxyIds = registration!.collisionProxies.map(({ entity }) => entity.id)
    view.rerender(
      <SpatialEntitySceneV4
        {...common}
        viewIsolation={{ kind: 'robot', robotId: 'robot-1' }}
      />,
    )
    await waitFor(() => {
      expect([...registration!.roots.values()].every(({ visible }) => !visible)).toBe(true)
    })
    expect(registration!.roots.size).toBe(3)
    expect(registration!.collisionProxies.map(({ entity }) => entity.id)).toEqual(proxyIds)
    expect(screen.queryByRole('status')).not.toBeInTheDocument()

    view.rerender(
      <SpatialEntitySceneV4
        {...common}
        viewIsolation={{ kind: 'spatial-entity', entityId: 'asset-entity' }}
      />,
    )
    await waitFor(() => {
      expect(registration!.roots.get('asset-entity')!.visible).toBe(true)
      expect(registration!.roots.get('box-entity')!.visible).toBe(false)
    })
    view.unmount()
  })

  it('renders and republishes live OPC UA Object pose, status, and collision data without rebuilding geometry', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    vi.setSystemTime(5_000)
    fiberCapture.frame = null
    try {
      const project = liveSpatialProject()
      const sceneRuntime = runtimeFor(project)
      const objectRuntime = createObjectRuntimeStateV4(project)
      expect(objectRuntime.ingest(liveBatch(1, 1), 5_000)).toBe(true)
      const resolved = resolveSpatialEntityWorldPoseV4(
        project,
        sceneRuntime,
        project.spatialEntities[0]!,
        objectRuntime,
        5_000,
      )
      expect(resolved.positionM).toEqual([1.25, 0, 0])

      let registration: SpatialEntitySceneRegistrationV4 | null = null
      render(
        <SpatialEntitySceneV4
          objectRuntime={objectRuntime}
          onRegister={(value) => { if (value !== null) registration = value }}
          project={project}
          sceneRuntime={sceneRuntime}
        />,
      )
      await waitFor(() => expect(registration?.roots.size).toBe(1))
      const root = registration!.roots.get('box-entity')!
      const geometry = firstMesh(root).geometry
      expect(root.position.x).toBeCloseTo(1.25)
      expect(registration!.collisionProxies[0]!.entity.worldMatrix.slice(12, 15))
        .toEqual([1.25, 0, 0])
      expect(screen.getByRole('status', { name: 'box-entity numeric status' }))
        .toHaveTextContent('42')

      vi.setSystemTime(5_100)
      expect(objectRuntime.ingest(liveBatch(2, 2, 43), 5_100)).toBe(true)
      vi.setSystemTime(5_200)
      expect(objectRuntime.ingest(liveBatch(3, 3, 44), 5_200)).toBe(true)
      vi.setSystemTime(5_400)
      act(() => { fiberCapture.frame?.() })

      expect(root.position.x).toBeCloseTo(3.25)
      await waitFor(() => {
        expect(visibleCollisionEntitiesV4(registration!.collisionProxies)[0]!.worldMatrix.slice(12, 15))
          .toEqual([3.25, 0, 0])
        expect(screen.getByRole('status', { name: 'box-entity numeric status' }))
          .toHaveTextContent('44')
      })
      expect(firstMesh(root).geometry).toBe(geometry)
    } finally {
      vi.useRealTimers()
    }
  })

  it('republishes a status-only OPC UA Object within 100 ms without moving its manual transform', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    vi.setSystemTime(5_000)
    fiberCapture.frame = null
    try {
      const project = statusOnlyLiveSpatialProject()
      const sceneRuntime = runtimeFor(project)
      const objectRuntime = createObjectRuntimeStateV4(project)
      expect(objectRuntime.ingest(liveBatch(1, 1, 42), 5_000)).toBe(true)

      let registration: SpatialEntitySceneRegistrationV4 | null = null
      render(
        <SpatialEntitySceneV4
          objectRuntime={objectRuntime}
          onRegister={(value) => { if (value !== null) registration = value }}
          project={project}
          sceneRuntime={sceneRuntime}
        />,
      )
      await waitFor(() => expect(registration?.roots.size).toBe(1))
      const root = registration!.roots.get('box-entity')!
      const geometry = firstMesh(root).geometry
      expect(root.position.x).toBeCloseTo(7)
      expect(screen.getByRole('status', { name: 'box-entity numeric status' }))
        .toHaveTextContent('42')

      vi.setSystemTime(5_100)
      expect(objectRuntime.ingest(liveBatch(2, 99, 43), 5_100)).toBe(true)
      act(() => { fiberCapture.frame?.() })

      await waitFor(() => {
        expect(root.position.x).toBeCloseTo(7)
        expect(registration!.collisionProxies[0]!.entity.worldMatrix.slice(12, 15))
          .toEqual([7, 0, 0])
        expect(screen.getByRole('status', { name: 'box-entity numeric status' }))
          .toHaveTextContent('43')
      })
      expect(firstMesh(root).geometry).toBe(geometry)
    } finally {
      vi.useRealTimers()
    }
  })

  it('shares an intermediate live pose between rendering and the collision query without republishing geometry', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    vi.setSystemTime(5_000)
    fiberCapture.frame = null
    try {
      const project = liveSpatialProject()
      const sceneRuntime = runtimeFor(project)
      const objectRuntime = createObjectRuntimeStateV4(project)
      expect(objectRuntime.ingest(liveBatch(1, 1), 5_000)).toBe(true)
      const registrations: SpatialEntitySceneRegistrationV4[] = []
      render(
        <SpatialEntitySceneV4
          objectRuntime={objectRuntime}
          onRegister={(value) => { if (value !== null) registrations.push(value) }}
          project={project}
          sceneRuntime={sceneRuntime}
        />,
      )
      await waitFor(() => expect(registrations).toHaveLength(1))
      const registration = registrations[0]!
      const root = registration.roots.get('box-entity')!
      const geometry = firstMesh(root).geometry

      vi.setSystemTime(5_100)
      expect(objectRuntime.ingest(liveBatch(2, 2), 5_100)).toBe(true)
      vi.setSystemTime(5_200)
      expect(objectRuntime.ingest(liveBatch(3, 3), 5_200)).toBe(true)
      vi.setSystemTime(5_350)
      act(() => { fiberCapture.frame?.() })

      expect(root.position.x).toBeCloseTo(2.75)
      expect(visibleCollisionEntitiesV4(registration.collisionProxies)[0]!.worldMatrix.slice(12, 15))
        .toEqual([2.75, 0, 0])
      expect(registrations).toHaveLength(1)
      expect(firstMesh(root).geometry).toBe(geometry)
    } finally {
      vi.useRealTimers()
    }
  })

  it('inherits a live parent moving frame for a manually owned child Object', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    vi.setSystemTime(5_000)
    fiberCapture.frame = null
    try {
      const source = liveSpatialProject()
      const project = validateWorkcellProjectV4({
        ...source,
        spatialEntities: [
          ...source.spatialEntities,
          {
            ...entity('child-entity', {
              kind: 'box',
              dimensionsM: [0.2, 0.2, 0.2],
              color: '#aabbcc',
            }),
            parentFrameId: 'box-entity-motion',
            localPose: { positionM: [0.5, 0, 0], quaternion: [0, 0, 0, 1] },
          },
        ],
      })
      const objectRuntime = createObjectRuntimeStateV4(project)
      expect(objectRuntime.ingest(liveBatch(1, 1), 5_000)).toBe(true)
      expect(resolveSpatialEntityWorldPoseV4(
        project,
        runtimeFor(project),
        project.spatialEntities.find(({ id }) => id === 'child-entity')!,
        objectRuntime,
        5_000,
      ).positionM).toEqual([1.5, 0, 0])

      let registration: SpatialEntitySceneRegistrationV4 | null = null
      render(
        <SpatialEntitySceneV4
          objectRuntime={objectRuntime}
          onRegister={(value) => { if (value !== null) registration = value }}
          project={project}
          sceneRuntime={runtimeFor(project)}
        />,
      )
      await waitFor(() => expect(registration?.roots.size).toBe(2))
      const childRoot = registration!.roots.get('child-entity')!

      vi.setSystemTime(5_100)
      expect(objectRuntime.ingest(liveBatch(2, 2), 5_100)).toBe(true)
      vi.setSystemTime(5_350)
      act(() => { fiberCapture.frame?.() })

      expect(childRoot.position.x).toBeCloseTo(2.5)
    } finally {
      vi.useRealTimers()
    }
  })
})
