import { StrictMode } from 'react'
import {
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
import type { SpatialEntityV4, WorkcellProjectV4 } from '../../../core/project-v4/types'
import { buildInitialRobotRuntimeStatesV4 } from '../../robot/v4/robot-runtime-registry'
import {
  selectSceneRuntimeV4,
  type SceneRuntimeEntityV4,
  type SceneRuntimeProjectionV4,
  type SceneRuntimeSpatialEntityV4,
} from './scene-runtime-selector'
import {
  SpatialEntitySceneV4,
  type SpatialEntitySceneRegistrationV4,
} from './SpatialEntityScene'

vi.mock('@react-three/fiber', () => ({
  createPortal: (node: unknown) => node,
}))

vi.mock('@react-three/drei/web/Html.js', () => ({
  Html: ({ children }: { children: unknown }) => children,
}))

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
})
