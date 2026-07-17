import { render, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { BoxGeometry, Group, Mesh, MeshStandardMaterial } from 'three'
import type { SceneRuntimeProjectionV1 } from './scene-runtime-selector'
import {
  WorkcellV4,
  assertPreparedVisibleSceneTriangleBudgetV4,
  createViewportBoundResolvers,
  workbenchDropSurfaceZ,
  workcellLinearAxisBindings,
  workcellRenderEntities,
} from './Workcell'
import { WORKBENCH_TOP_Z } from './workcell-constants'
import type { CommittedLinearAxisSourceV1 } from './linear-axis-source'
import type { LinearAxisCommittedStateV1 } from './linear-axis-source'
import { makeMinimalWorkcellProjectV4 } from '../../core/project-v4/test-support'
import type { WorkcellProjectV4 } from '../../core/project-v4/types'
import { buildInitialRobotRuntimeStatesV4 } from '../robot/v4/robot-runtime-registry'
import { selectSceneRuntimeV4 } from './v4/scene-runtime-selector'
import {
  createPreparedRobotDefinitionGeometryV4,
  createRobotDefinitionGeometryRepositoryV4,
} from '../robot/v4/robot-definition-geometry-repository'
import type {
  RobotDefinitionGeometryPublicationSnapshotV4,
  RobotDefinitionGeometryRepositoryV4,
} from '../robot/v4/robot-definition-geometry-repository'
import type { WorkcellRegistrationV4 } from './Workcell'

vi.mock('@react-three/fiber', () => ({
  createPortal: (node: unknown) => node,
  useFrame: vi.fn(),
  useThree: vi.fn(),
}))

vi.mock('@react-three/drei/web/Html.js', () => ({
  Html: ({ children }: { children: unknown }) => children,
}))

describe('Workcell published render authority', () => {
  it('uses only effective-visible entities from the published runtime projection', () => {
    const visible = { entityId: 'object:visible', effectiveVisible: true }
    const hidden = { entityId: 'object:hidden', effectiveVisible: false }
    const runtime = {
      entities: [visible, hidden],
    } as unknown as SceneRuntimeProjectionV1

    expect(workcellRenderEntities(runtime)).toEqual([visible])
  })

  it('keeps bounds and world-matrix updates out of StrictMode render calculation', () => {
    const visible = new Group()
    visible.add(new Mesh(new BoxGeometry(1, 1, 1)))
    const update = vi.spyOn(visible, 'updateWorldMatrix')
    const runtime = {
      entities: [],
      objects: [{ entityId: 'object:visible', effectiveVisible: true }],
      byId: new Map([['object:visible', {
        entityId: 'object:visible', kind: 'object', effectiveVisible: true, parentId: null,
      }]]),
      robot: null,
      linearAxis: null,
    } as unknown as SceneRuntimeProjectionV1

    const firstRender = createViewportBoundResolvers(
      runtime, 'object:visible', new Map([['object:visible', visible]]), null, new Group(),
    )
    const strictModeSecondRender = createViewportBoundResolvers(
      runtime, 'object:visible', new Map([['object:visible', visible]]), null, new Group(),
    )
    expect(firstRender.canFocusSelection).toBe(true)
    expect(strictModeSecondRender.canFocusSelection).toBe(true)
    expect(update).not.toHaveBeenCalled()

    firstRender.focusSelectionBounds()
    expect(update).toHaveBeenCalled()
  })

  it('disables Focus until the selected committed Entity has registered renderable geometry', () => {
    const objectRuntime = {
      entities: [],
      objects: [{ entityId: 'object:visible', effectiveVisible: true }],
      byId: new Map([['object:visible', {
        entityId: 'object:visible', kind: 'object', effectiveVisible: true, parentId: null,
      }]]),
      robot: null,
      linearAxis: null,
    } as unknown as SceneRuntimeProjectionV1

    const missingRegistration = createViewportBoundResolvers(
      objectRuntime, 'object:visible', new Map(), null, new Group(),
    )
    const loadingStepRoot = new Group()
    const loadingStep = createViewportBoundResolvers(
      objectRuntime, 'object:visible', new Map([['object:visible', loadingStepRoot]]), null, new Group(),
    )

    expect(missingRegistration.canFocusSelection).toBe(false)
    expect(missingRegistration.focusSelectionBounds().isEmpty()).toBe(true)
    expect(loadingStep.canFocusSelection).toBe(false)
    expect(loadingStep.focusSelectionBounds().isEmpty()).toBe(true)
  })

  it('tracks async geometry added to and removed from the same registered Object root', () => {
    const root = new Group()
    const update = vi.spyOn(root, 'updateWorldMatrix')
    const runtime = {
      entities: [],
      objects: [{ entityId: 'object:async-step', effectiveVisible: true }],
      byId: new Map([['object:async-step', {
        entityId: 'object:async-step', kind: 'object', effectiveVisible: true, parentId: null,
      }]]),
      robot: null,
      linearAxis: null,
    } as unknown as SceneRuntimeProjectionV1
    const resolvers = createViewportBoundResolvers(
      runtime, 'object:async-step', new Map([['object:async-step', root]]), null, new Group(),
    )

    expect(resolvers.canFocusSelection).toBe(false)
    const geometry = new Mesh(new BoxGeometry(1, 1, 1))
    root.add(geometry)
    expect(resolvers.canFocusSelection).toBe(true)
    root.remove(geometry)
    expect(resolvers.canFocusSelection).toBe(false)
    expect(update).not.toHaveBeenCalled()
  })

  it('recognizes committed Robot, Axis, and Group-descendant render roots', () => {
    const renderable = () => {
      const root = new Group()
      root.add(new Mesh(new BoxGeometry(1, 1, 1)))
      return root
    }
    const robot = {
      entityId: 'robot:active', kind: 'robot', effectiveVisible: true, parentId: null,
    }
    const axis = {
      entityId: 'linear-axis:active', kind: 'linear-axis', effectiveVisible: true, parentId: null,
    }
    const group = {
      entityId: 'group:fixture', kind: 'group', effectiveVisible: true, parentId: null,
    }
    const child = {
      entityId: 'object:child', kind: 'object', effectiveVisible: true, parentId: 'group:fixture',
    }
    const runtime = {
      entities: [robot, axis, group, child], objects: [child], robot, linearAxis: axis,
      byId: new Map<string, typeof robot | typeof axis | typeof group | typeof child>([
        ['robot:active', robot], ['linear-axis:active', axis],
        ['group:fixture', group], ['object:child', child],
      ]),
    } as unknown as SceneRuntimeProjectionV1
    const scene = new Group()
    const axisRoot = renderable()
    axisRoot.name = 'linear-axis:active'
    scene.add(axisRoot)
    const roots = new Map([['object:child', renderable()]])
    const robotRoot = renderable()

    expect(createViewportBoundResolvers(
      runtime, 'robot:active', roots, robotRoot, scene,
    ).canFocusSelection).toBe(true)
    expect(createViewportBoundResolvers(
      runtime, 'linear-axis:active', roots, robotRoot, scene,
    ).canFocusSelection).toBe(true)
    expect(createViewportBoundResolvers(
      runtime, 'group:fixture', roots, robotRoot, scene,
    ).canFocusSelection).toBe(true)
  })

  it('focuses and fits the dedicated published Workbench render root', () => {
    const workbench = {
      entityId: 'workcell:workbench', kind: 'environment', effectiveVisible: true,
      parentId: null,
    }
    const runtime = {
      entities: [workbench], objects: [], robot: null, linearAxis: null,
      workbench,
      byId: new Map([['workcell:workbench', workbench]]),
    } as unknown as SceneRuntimeProjectionV1
    const scene = new Group()
    const root = new Group()
    root.name = 'workcell:workbench'
    root.add(new Mesh(new BoxGeometry(1.8, 1.2, 0.1)))
    scene.add(root)

    const resolvers = createViewportBoundResolvers(
      runtime, 'workcell:workbench', new Map(), null, scene,
    )

    expect(resolvers.canFocusSelection).toBe(true)
    expect(resolvers.focusSelectionBounds().isEmpty()).toBe(false)
    expect(resolvers.fitAllBounds().isEmpty()).toBe(false)
  })

  it('uses the transformed Workbench top only while its published entity is visible', () => {
    const visibleWorkbench = {
      effectiveVisible: true,
      worldMatrix: [
        1, 0, 0, 0,
        0, 1, 0, 0,
        0, 0, 1, 0,
        0, 0, 0.25, 1,
      ],
    }
    const runtime = { workbench: visibleWorkbench } as unknown as SceneRuntimeProjectionV1

    expect(workbenchDropSurfaceZ(runtime)).toBeCloseTo(WORKBENCH_TOP_Z + 0.25)
    expect(workbenchDropSurfaceZ(runtime, {
      position: [0, 0, 0.5],
      quaternion: [0, 0, 0, 1],
      scale: [1, 1, 1],
    })).toBeCloseTo(WORKBENCH_TOP_Z + 0.75)
    expect(workbenchDropSurfaceZ({
      ...runtime,
      workbench: { ...visibleWorkbench, effectiveVisible: false },
    } as unknown as SceneRuntimeProjectionV1)).toBe(0)
    expect(workbenchDropSurfaceZ({
      ...runtime,
      workbench: null,
    } as unknown as SceneRuntimeProjectionV1)).toBe(0)
  })

  it('binds the published runtime, live Object roots, and computed Robot root to the axis updater', () => {
    const runtime = { linearAxis: { entityId: 'linear-axis:active' } } as unknown as SceneRuntimeProjectionV1
    const objectRoot = new Group()
    const robotRoot = new Group()
    const objectRoots = new Map([['object:carriage', objectRoot]])
    const source = {
      kind: 'manual', subscribe: () => () => undefined,
      synchronizeCommittedState: () => undefined,
      setPositionM: async () => undefined, home: async () => undefined,
    } satisfies CommittedLinearAxisSourceV1
    const committedState: LinearAxisCommittedStateV1 = {
      axisEntityId: 'linear-axis:active', configurationIdentity: 'axis-config:A',
      positionM: 0.5, homePositionM: 0,
    }

    expect(workcellLinearAxisBindings(
      runtime,
      objectRoots,
      robotRoot,
      source,
      committedState,
    )).toEqual({
      runtime,
      objectRoots,
      robotRoot,
      source,
      committedState,
    })
  })
})

function v4Project(robotCount = 1): WorkcellProjectV4 {
  const project = makeMinimalWorkcellProjectV4()
  const robot = project.robots[0]!
  return {
    ...project,
    robots: Array.from({ length: robotCount }, (_, index) => ({
      ...robot,
      id: `robot-${index + 1}`,
      name: `Robot ${index + 1}`,
      localBasePose: {
        positionM: [index, 0, 0],
        quaternion: [0, 0, 0, 1],
      },
    })),
    spatialEntities: [{
      id: 'fixture-box',
      name: 'Fixture Box',
      geometry: { kind: 'box', dimensionsM: [1, 1, 1], color: '#808080' },
      parentFrameId: 'world',
      localPose: { positionM: [3, 0, 0], quaternion: [0, 0, 0, 1] },
      visible: true,
      groupId: null,
      removable: true,
      transformOwner: 'manual',
      numericStatus: {
        value: 5,
        sourceOwnership: 'manual',
        overlay: { visible: false, frameId: null },
      },
      graspable: false,
      graspFrames: [],
      movingFrames: [],
    }],
  }
}

function v4Projection(project: WorkcellProjectV4) {
  return selectSceneRuntimeV4(project, {
    projectRevisionId: project.revisionId,
    robots: buildInitialRobotRuntimeStatesV4(project),
  })
}

function preparedV4(project: WorkcellProjectV4, triangleCount: number) {
  const definition = project.robotDefinitions[0]!
  const geometry = new BoxGeometry(0.1, 0.1, 0.1)
  return createPreparedRobotDefinitionGeometryV4({
    definitionId: definition.id,
    linkTemplates: new Map(definition.links.map(({ id }) => {
      const root = new Group()
      root.add(new Mesh(geometry, new MeshStandardMaterial()))
      return [id, root] as const
    })),
    sharedGeometry: new Set([geometry]),
    triangleCount,
    disposeResources: vi.fn(),
  })
}

describe('WorkcellV4 dark multi-Robot composition', () => {
  it('accepts exactly 1,500,000 prepared triangles and rejects 1,500,001', () => {
    const project = v4Project()
    const runtime = v4Projection(project)
    const repository = createRobotDefinitionGeometryRepositoryV4()
    const definition = project.robotDefinitions[0]!
    const passingHandle = repository.stage(definition, preparedV4(project, 1_499_988))
    repository.commitBatch([passingHandle])
    const passing = new Map([[definition.id, repository.readCurrent(definition.id)!]])
    expect(assertPreparedVisibleSceneTriangleBudgetV4(project, runtime, passing))
      .toBe(1_500_000)

    const failingHandle = repository.stage(definition, preparedV4(project, 1_499_989))
    repository.commitBatch([failingHandle])
    const failing = new Map([[definition.id, repository.readCurrent(definition.id)!]])
    expect(() => assertPreparedVisibleSceneTriangleBudgetV4(project, runtime, failing))
      .toThrow(/VISIBLE_SCENE_TRIANGLE_LIMIT_EXCEEDED/)
    repository.revoke(failingHandle)
    repository.revoke(passingHandle)
  })

  it('publishes two Robot roots, one Spatial root, and only Project collision proxies', async () => {
    const project = v4Project(2)
    const runtime = v4Projection(project)
    const repository = createRobotDefinitionGeometryRepositoryV4()
    const definition = project.robotDefinitions[0]!
    const handle = repository.stage(definition, preparedV4(project, 12))
    repository.commitBatch([handle])
    let registration: WorkcellRegistrationV4 | null = null
    const view = render(
      <WorkcellV4
        geometryRepository={repository}
        onRegister={(value) => {
          registration = value
        }}
        project={project}
        sceneRuntime={runtime}
      />,
    )

    await waitFor(() => expect(registration?.robots.size).toBe(2))
    expect([...registration!.robots.keys()]).toEqual(['robot-1', 'robot-2'])
    expect([...registration!.spatialEntities.keys()]).toEqual(['fixture-box'])
    expect(registration!.collisionProxies).toHaveLength(1)
    expect('set' in registration!.robots).toBe(false)
    expect('set' in registration!.spatialEntities).toBe(false)
    expect(registration!.robots.has('environment')).toBe(false)
    expect(registration!.spatialEntities.has('linear-axis')).toBe(false)
    view.unmount()
    expect(registration).toBeNull()
    repository.revoke(handle)
  })

  it('throws the prepared budget guard before publishing any registration', () => {
    const project = v4Project()
    const runtime = v4Projection(project)
    const repository = createRobotDefinitionGeometryRepositoryV4()
    const definition = project.robotDefinitions[0]!
    const handle = repository.stage(definition, preparedV4(project, 1_500_001))
    repository.commitBatch([handle])
    const onRegister = vi.fn()

    expect(() => render(
      <WorkcellV4
        geometryRepository={repository}
        onRegister={onRegister}
        project={project}
        sceneRuntime={runtime}
      />,
    )).toThrow(/VISIBLE_SCENE_TRIANGLE_LIMIT_EXCEEDED/)
    expect(onRegister).not.toHaveBeenCalled()
    repository.revoke(handle)
  })

  it('pins the budgeted handle when a same-Definition replacement commits before mount', async () => {
    const project = v4Project()
    const runtime = v4Projection(project)
    const repository = createRobotDefinitionGeometryRepositoryV4()
    const definition = project.robotDefinitions[0]!
    const oldHandle = repository.stage(definition, preparedV4(project, 12))
    repository.commitBatch([oldHandle])
    const oldSnapshot = repository.readCurrent(definition.id)!
    const replacementHandle = repository.stage(definition, preparedV4(project, 1_500_000))
    const frozenVersion = repository.getSnapshot()
    let replacementCommitted = false
    const acquire = vi.fn(repository.acquire)
    const racingRepository: RobotDefinitionGeometryRepositoryV4 = {
      ...repository,
      acquire,
      getSnapshot: () => frozenVersion,
      subscribe: () => () => undefined,
      readCurrent: (definitionId): RobotDefinitionGeometryPublicationSnapshotV4 | null => {
        if (definitionId !== definition.id) return repository.readCurrent(definitionId)
        return Object.freeze({
          definitionId,
          handle: oldSnapshot.handle,
          get triangleCount() {
            if (!replacementCommitted) {
              replacementCommitted = true
              repository.commitBatch([replacementHandle])
            }
            return oldSnapshot.triangleCount
          },
        })
      },
    }
    let registration: WorkcellRegistrationV4 | null = null
    const view = render(
      <WorkcellV4
        geometryRepository={racingRepository}
        onRegister={(value) => {
          registration = value
        }}
        project={project}
        sceneRuntime={runtime}
      />,
    )

    await waitFor(() => expect(registration?.robots.size).toBe(1))
    expect(replacementCommitted).toBe(true)
    expect(repository.readCurrent(definition.id)?.handle).toBe(replacementHandle)
    expect(registration!.robots.values().next().value?.publicationHandle).toBe(oldHandle)
    expect(acquire).toHaveBeenCalledOnce()
    expect(acquire.mock.calls[0]?.[2]).toBe(oldHandle)
    expect(acquire.mock.calls[0]?.[2]).not.toBe(replacementHandle)

    view.unmount()
    repository.revoke(replacementHandle)
    repository.revoke(oldHandle)
  })

  it('never republishes an old same-count Robot set during a visibility swap', async () => {
    const base = v4Project(2)
    const projectA: WorkcellProjectV4 = {
      ...base,
      robots: [base.robots[0]!, { ...base.robots[1]!, visible: false }],
    }
    const projectB: WorkcellProjectV4 = {
      ...projectA,
      revisionId: 'visibility-swap-revision',
      robots: [{ ...base.robots[0]!, visible: false }, base.robots[1]!],
    }
    const repository = createRobotDefinitionGeometryRepositoryV4()
    const definition = base.robotDefinitions[0]!
    const handle = repository.stage(definition, preparedV4(base, 12))
    repository.commitBatch([handle])
    const calls: Array<WorkcellRegistrationV4 | null> = []
    const view = render(
      <WorkcellV4
        geometryRepository={repository}
        onRegister={(value) => calls.push(value)}
        project={projectA}
        sceneRuntime={v4Projection(projectA)}
      />,
    )
    await waitFor(() => expect(calls.at(-1)?.robots.has('robot-1')).toBe(true))
    calls.length = 0

    view.rerender(
      <WorkcellV4
        geometryRepository={repository}
        onRegister={(value) => calls.push(value)}
        project={projectB}
        sceneRuntime={v4Projection(projectB)}
      />,
    )
    await waitFor(() => expect(calls.at(-1)?.robots.has('robot-2')).toBe(true))
    expect(calls
      .filter((value): value is WorkcellRegistrationV4 => value !== null)
      .every((value) => !value.robots.has('robot-1'))).toBe(true)

    view.unmount()
    repository.revoke(handle)
  })

  it('never republishes an old same-count Spatial Entity set during a visibility swap', async () => {
    const base = v4Project()
    const entityA = base.spatialEntities[0]!
    const entityB = { ...entityA, id: 'fixture-box-b', name: 'Fixture Box B', visible: false }
    const projectA: WorkcellProjectV4 = {
      ...base,
      spatialEntities: [entityA, entityB],
    }
    const projectB: WorkcellProjectV4 = {
      ...projectA,
      revisionId: 'spatial-visibility-swap-revision',
      spatialEntities: [
        { ...entityA, visible: false },
        { ...entityB, visible: true },
      ],
    }
    const repository = createRobotDefinitionGeometryRepositoryV4()
    const definition = base.robotDefinitions[0]!
    const handle = repository.stage(definition, preparedV4(base, 12))
    repository.commitBatch([handle])
    const calls: Array<WorkcellRegistrationV4 | null> = []
    const view = render(
      <WorkcellV4
        geometryRepository={repository}
        onRegister={(value) => calls.push(value)}
        project={projectA}
        sceneRuntime={v4Projection(projectA)}
      />,
    )
    await waitFor(() => expect(calls.at(-1)?.spatialEntities.has('fixture-box')).toBe(true))
    calls.length = 0

    view.rerender(
      <WorkcellV4
        geometryRepository={repository}
        onRegister={(value) => calls.push(value)}
        project={projectB}
        sceneRuntime={v4Projection(projectB)}
      />,
    )
    await waitFor(() => expect(calls.at(-1)?.spatialEntities.has('fixture-box-b')).toBe(true))
    expect(calls
      .filter((value): value is WorkcellRegistrationV4 => value !== null)
      .every((value) => !value.spatialEntities.has('fixture-box'))).toBe(true)

    view.unmount()
    repository.revoke(handle)
  })

  it('updates a stable ready registration without a null publication on a Joint tick', async () => {
    const project = v4Project()
    const repository = createRobotDefinitionGeometryRepositoryV4()
    const definition = project.robotDefinitions[0]!
    const handle = repository.stage(definition, preparedV4(project, 12))
    repository.commitBatch([handle])
    const calls: Array<WorkcellRegistrationV4 | null> = []
    const runtimeA = buildInitialRobotRuntimeStatesV4(project)
    const robotState = runtimeA['robot-1']!
    const runtimeB = {
      ...runtimeA,
      'robot-1': {
        ...robotState,
        jointValues: { ...robotState.jointValues, J1: 45 },
        numericStatus: 99,
      },
    }
    const view = render(
      <WorkcellV4
        geometryRepository={repository}
        onRegister={(value) => calls.push(value)}
        project={project}
        sceneRuntime={selectSceneRuntimeV4(project, {
          projectRevisionId: project.revisionId,
          robots: runtimeA,
        })}
      />,
    )
    await waitFor(() => expect(calls.at(-1)?.robots.size).toBe(1))
    const root = calls.at(-1)!.robots.get('robot-1')!.root
    calls.length = 0

    view.rerender(
      <WorkcellV4
        geometryRepository={repository}
        onRegister={(value) => calls.push(value)}
        project={project}
        sceneRuntime={selectSceneRuntimeV4(project, {
          projectRevisionId: project.revisionId,
          robots: runtimeB,
        })}
      />,
    )
    await waitFor(() => expect(calls.at(-1)?.robots.get('robot-1')?.root).toBe(root))
    expect(calls).not.toContain(null)

    view.unmount()
    repository.revoke(handle)
  })

  it('routes visual isolation without changing complete registration or collision proxies', async () => {
    const project = v4Project(2)
    const repository = createRobotDefinitionGeometryRepositoryV4()
    const definition = project.robotDefinitions[0]!
    const handle = repository.stage(definition, preparedV4(project, 12))
    repository.commitBatch([handle])
    let registration: WorkcellRegistrationV4 | null = null
    const common = {
      geometryRepository: repository,
      interaction: { onSelect: vi.fn(), onContextMenu: vi.fn() },
      onRegister: (value: WorkcellRegistrationV4 | null) => {
        if (value !== null) registration = value
      },
      project,
      sceneRuntime: v4Projection(project),
    }
    const view = render(
      <WorkcellV4
        {...common}
        viewIsolation={{ kind: 'robot', robotId: 'robot-1' }}
      />,
    )
    await waitFor(() => expect(registration?.robots.size).toBe(2))
    expect(registration!.robots.get('robot-1')!.root.visible).toBe(true)
    expect(registration!.robots.get('robot-2')!.root.visible).toBe(false)
    expect(registration!.spatialEntities.get('fixture-box')!.visible).toBe(false)
    const proxyIds = registration!.collisionProxies.map(({ entity }) => entity.id)

    view.rerender(
      <WorkcellV4
        {...common}
        viewIsolation={{ kind: 'spatial-entity', entityId: 'fixture-box' }}
      />,
    )
    await waitFor(() => {
      expect(registration!.robots.get('robot-1')!.root.visible).toBe(false)
      expect(registration!.robots.get('robot-2')!.root.visible).toBe(false)
      expect(registration!.spatialEntities.get('fixture-box')!.visible).toBe(true)
    })
    expect(registration!.robots.size).toBe(2)
    expect(registration!.spatialEntities.size).toBe(1)
    expect(registration!.collisionProxies.map(({ entity }) => entity.id)).toEqual(proxyIds)
    view.unmount()
    repository.revoke(handle)
  })
})
