import { Group } from 'three'
import { describe, expect, it, vi } from 'vitest'
import type { StoreApi } from 'zustand/vanilla'
import {
  makeMinimalWorkcellProjectV4,
  projectAtLimit,
  projectWithVisibleTriangleCount,
} from '../../../core/project-v4/test-support.js'
import type {
  RobotDefinitionV4,
  WorkcellProjectV4,
} from '../../../core/project-v4/index.js'
import { MAX_VISIBLE_SCENE_TRIANGLES_V4 } from '../../../core/project-v4/limits.js'
import { createCoordinateDisplayStoreV4 } from '../../frames/v4/coordinate-display-store.js'
import { createInteractionStoreV4 } from '../../interaction/v4/interaction-store.js'
import type { RobotJobExecutorV4 } from '../../jobs/v4/job-executor.js'
import { createJobRuntimeStoreV4 } from '../../jobs/v4/job-runtime-store.js'
import type { RobotJobPlaybackControllerV4 } from '../../jobs/v4/simulation-clock.js'
import {
  createPreparedRobotDefinitionGeometryV4,
  createRobotDefinitionGeometryRepositoryV4,
  type PreparedRobotDefinitionGeometryV4,
} from '../../robot/v4/robot-definition-geometry-repository.js'
import { createRobotRuntimeRegistryV4 } from '../../robot/v4/robot-runtime-registry.js'
import { selectSceneRuntimeV4 } from '../../scene/v4/scene-runtime-selector.js'
import { createSceneRuntimeStoreV4 } from '../../scene/v4/scene-runtime-store.js'
import {
  createBrowserRuntimeBundleStoreV4,
  type BrowserJobRuntimeResourcesV4,
} from './browser-runtime-bundle-store-v4.js'
import {
  createBrowserProjectRuntimeV4,
  type BrowserProjectRuntimeDependenciesV4,
} from './browser-project-runtime-v4.js'
import { createRuntimePublicationBarrierV4 } from './runtime-publication-barrier-v4.js'

interface PreparedGeometryHarness {
  readonly geometry: PreparedRobotDefinitionGeometryV4
  readonly dispose: ReturnType<typeof vi.fn>
}

function preparedGeometry(
  definition: RobotDefinitionV4,
  triangleCount: number,
): PreparedGeometryHarness {
  const dispose = vi.fn()
  return {
    geometry: createPreparedRobotDefinitionGeometryV4({
      definitionId: definition.id,
      linkTemplates: new Map(definition.links.map(({ id }) => [id, new Group()])),
      sharedGeometry: new Set(),
      triangleCount,
      disposeResources: dispose,
    }),
    dispose,
  }
}

interface JobResourcesHarness extends BrowserJobRuntimeResourcesV4 {
  readonly quiesce: ReturnType<typeof vi.fn>
  readonly resume: ReturnType<typeof vi.fn>
  readonly disposeSpy: ReturnType<typeof vi.fn>
}

function jobResources(): JobResourcesHarness {
  const quiesce = vi.fn(async () => undefined)
  const resume = vi.fn()
  const disposeSpy = vi.fn()
  const executor: RobotJobExecutorV4 = {
    startJob: () => ({ runId: 'run-1' }),
    advanceAll: async () => undefined,
    cancelRobotJob: () => undefined,
    readState: () => { throw new Error('unused') },
    waitForTerminal: async () => { throw new Error('unused') },
    reset: vi.fn(),
    shutdown: vi.fn(),
  }
  const playback: RobotJobPlaybackControllerV4 = {
    startJob: () => ({ runId: 'run-1' }),
    cancelRobotJob: () => undefined,
    ensureRunning: () => undefined,
    quiesce,
    resume,
    dispose: disposeSpy,
  }
  return { executor, playback, quiesce, resume, disposeSpy, dispose: disposeSpy }
}

function revision(project: WorkcellProjectV4, revisionId: string): WorkcellProjectV4 {
  return {
    ...structuredClone(project),
    revisionId,
    metadata: {
      ...project.metadata,
      name: `Project ${revisionId}`,
      updatedAt: '2026-07-17T00:00:00.000Z',
    },
  }
}

interface RuntimeHarness {
  readonly runtime: ReturnType<typeof createBrowserProjectRuntimeV4>
  readonly dependencies: BrowserProjectRuntimeDependenciesV4
  readonly robots: ReturnType<typeof createRobotRuntimeRegistryV4>
  readonly jobs: ReturnType<typeof createJobRuntimeStoreV4>
  readonly scene: ReturnType<typeof createSceneRuntimeStoreV4>
  readonly interaction: ReturnType<typeof createInteractionStoreV4>
  readonly coordinates: ReturnType<typeof createCoordinateDisplayStoreV4>
  readonly bundles: ReturnType<typeof createBrowserRuntimeBundleStoreV4>
  readonly geometry: ReturnType<typeof createRobotDefinitionGeometryRepositoryV4>
  readonly publicStores: {
    readonly robots: StoreApi<ReturnType<RuntimeHarness['robots']['getState']>>
    readonly jobs: StoreApi<ReturnType<RuntimeHarness['jobs']['getState']>>
    readonly scene: StoreApi<ReturnType<RuntimeHarness['scene']['getState']>>
    readonly interaction: StoreApi<ReturnType<RuntimeHarness['interaction']['getState']>>
    readonly coordinates: StoreApi<ReturnType<RuntimeHarness['coordinates']['getState']>>
    readonly bundles: StoreApi<ReturnType<RuntimeHarness['bundles']['getState']>>
  }
  readonly publicGeometry: ReturnType<
    ReturnType<typeof createRuntimePublicationBarrierV4>['gateGeometryRepository']
  >
  readonly jobResourcesByRevision: Map<string, JobResourcesHarness>
}

function runtimeHarness(options: {
  readonly resolve?: (
    project: WorkcellProjectV4,
    definition: RobotDefinitionV4,
  ) => Promise<PreparedRobotDefinitionGeometryV4 | null>
} = {}): RuntimeHarness {
  const robots = createRobotRuntimeRegistryV4()
  const jobs = createJobRuntimeStoreV4()
  const scene = createSceneRuntimeStoreV4()
  const interaction = createInteractionStoreV4()
  const coordinates = createCoordinateDisplayStoreV4()
  const bundles = createBrowserRuntimeBundleStoreV4()
  const geometry = createRobotDefinitionGeometryRepositoryV4()
  const notifications = createRuntimePublicationBarrierV4()
  const publicStores = {
    robots: notifications.gateStore(robots),
    jobs: notifications.gateStore(jobs),
    scene: notifications.gateStore(scene),
    interaction: notifications.gateStore(interaction),
    coordinates: notifications.gateStore(coordinates),
    bundles: notifications.gateStore(bundles),
  }
  const publicGeometry = notifications.gateGeometryRepository(geometry)
  const jobResourcesByRevision = new Map<string, JobResourcesHarness>()
  const dependencies: BrowserProjectRuntimeDependenciesV4 = {
    robotRegistry: robots,
    jobStore: jobs,
    sceneStore: scene,
    interactionStore: interaction,
    coordinateDisplayStore: coordinates,
    runtimeBundleStore: bundles,
    geometryRepository: geometry,
    notifications,
    resolveDefinitionGeometry: options.resolve ?? (async () => null),
    prepareScene: (project, robotStates) => selectSceneRuntimeV4(project, {
      projectRevisionId: project.revisionId,
      robots: robotStates,
    }),
    createJobRuntime: (project) => {
      const resources = jobResources()
      jobResourcesByRevision.set(project.revisionId, resources)
      return resources
    },
  }
  return {
    runtime: createBrowserProjectRuntimeV4(dependencies),
    dependencies,
    robots,
    jobs,
    scene,
    interaction,
    coordinates,
    bundles,
    geometry,
    publicStores,
    publicGeometry,
    jobResourcesByRevision,
  }
}

describe('Browser Project runtime V4', () => {
  it('prepares without live effects and disposes un-applied Geometry and Job resources', async () => {
    const sources: PreparedGeometryHarness[] = []
    const harness = runtimeHarness({
      resolve: async (_project, definition) => {
        const source = preparedGeometry(definition, 12)
        sources.push(source)
        return source.geometry
      },
    })
    const project = revision(makeMinimalWorkcellProjectV4(), 'revision-prepare')

    const bundle = await harness.runtime.prepare(project, project.revisionId)

    expect(harness.robots.getState().projectRevisionId).toBeNull()
    expect(harness.jobs.getState().projectRevisionId).toBeNull()
    expect(harness.scene.getState().projectRevisionId).toBeNull()
    expect(harness.geometry.getSnapshot()).toBe(0)
    expect(harness.bundles.getState().active).toBeNull()
    expect(bundle.resources.definitionPublications[0]).toMatchObject({
      triangleCount: 12,
    })

    await harness.runtime.dispose(bundle)
    expect(sources[0]!.dispose).toHaveBeenCalledTimes(1)
    expect(harness.jobResourcesByRevision.get(project.revisionId)!.disposeSpy)
      .toHaveBeenCalledTimes(1)
  })

  it('disposes a resolved Geometry resource that fails Definition validation', async () => {
    const project = revision(makeMinimalWorkcellProjectV4(), 'revision-invalid-geometry')
    const mismatched = preparedGeometry({
      ...project.robotDefinitions[0]!,
      id: 'definition-other',
    }, 12)
    const harness = runtimeHarness({
      resolve: async () => mismatched.geometry,
    })

    await expect(harness.runtime.prepare(project, project.revisionId))
      .rejects.toMatchObject({ code: 'ROBOT_GEOMETRY_PREPARED_RESOURCE_INVALID' })

    expect(mismatched.dispose).toHaveBeenCalledTimes(1)
    expect(harness.geometry.getSnapshot()).toBe(0)
    expect(harness.bundles.getState().active).toBeNull()
  })

  it('accepts the visible-triangle budget and rejects plus one before apply', async () => {
    const harness = runtimeHarness()
    const accepted = revision(
      projectWithVisibleTriangleCount(MAX_VISIBLE_SCENE_TRIANGLES_V4),
      'revision-triangle-pass',
    )
    const rejected = revision(
      projectWithVisibleTriangleCount(MAX_VISIBLE_SCENE_TRIANGLES_V4 + 1),
      'revision-triangle-fail',
    )

    const acceptedBundle = await harness.runtime.prepare(accepted, accepted.revisionId)
    await expect(harness.runtime.prepare(rejected, rejected.revisionId))
      .rejects.toMatchObject({ code: 'VISIBLE_SCENE_TRIANGLE_LIMIT_EXCEEDED' })

    expect(harness.robots.getState().projectRevisionId).toBeNull()
    expect(harness.geometry.getSnapshot()).toBe(0)
    await harness.runtime.dispose(acceptedBundle)
  })

  it('releases one coherent revision across every public store on commit', async () => {
    const harness = runtimeHarness({
      resolve: async (_project, definition) => preparedGeometry(definition, 12).geometry,
    })
    const project = revision(makeMinimalWorkcellProjectV4(), 'revision-atomic')
    const observations: string[] = []
    harness.publicStores.robots.subscribe(() => {
      observations.push([
        harness.publicStores.robots.getState().projectRevisionId,
        harness.publicStores.jobs.getState().projectRevisionId,
        harness.publicStores.scene.getState().projectRevisionId,
        harness.publicStores.interaction.getState().projectRevisionId,
        harness.publicStores.coordinates.getState().projectRevisionId,
        harness.publicStores.bundles.getState().projectRevisionId,
      ].join(':'))
    })

    const bundle = await harness.runtime.prepare(project, project.revisionId)
    const application = await harness.runtime.apply(bundle)

    expect(observations).toEqual([])
    expect(harness.publicStores.robots.getState().projectRevisionId).toBeNull()
    expect(harness.geometry.readCurrent('definition-1')).toBeNull()
    application.commit()

    expect(observations).toEqual([
      Array(6).fill(project.revisionId).join(':'),
    ])
    expect(harness.publicGeometry.getSnapshot()).toBe(1)
    expect(harness.jobResourcesByRevision.get(project.revisionId)!.resume)
      .toHaveBeenCalledTimes(1)
  })

  it('rolls back a same-Definition replacement silently and resumes the prior clock', async () => {
    const sources = new Map<string, PreparedGeometryHarness>()
    const harness = runtimeHarness({
      resolve: async (project, definition) => {
        const source = preparedGeometry(
          definition,
          project.revisionId === 'revision-a' ? 12 : 24,
        )
        sources.set(project.revisionId, source)
        return source.geometry
      },
    })
    const projectA = revision(makeMinimalWorkcellProjectV4(), 'revision-a')
    const projectB = revision(makeMinimalWorkcellProjectV4(), 'revision-b')
    const applicationA = await harness.runtime.apply(
      await harness.runtime.prepare(projectA, projectA.revisionId),
    )
    applicationA.commit()
    const firstGeometry = harness.geometry.readCurrent('definition-1')!
    const observations = vi.fn()
    harness.publicStores.robots.subscribe(observations)
    const applicationB = await harness.runtime.apply(
      await harness.runtime.prepare(projectB, projectB.revisionId),
    )

    expect(harness.geometry.readCurrent('definition-1')!.handle)
      .toBe(firstGeometry.handle)

    await applicationB.rollback()

    expect(harness.robots.getState().projectRevisionId).toBe(projectA.revisionId)
    expect(harness.jobs.getState().projectRevisionId).toBe(projectA.revisionId)
    expect(harness.scene.getState().projectRevisionId).toBe(projectA.revisionId)
    expect(harness.bundles.getState().projectRevisionId).toBe(projectA.revisionId)
    expect(harness.geometry.readCurrent('definition-1')!.handle)
      .toBe(firstGeometry.handle)
    expect(harness.publicStores.robots.getState().projectRevisionId)
      .toBe(projectA.revisionId)
    expect(observations).not.toHaveBeenCalled()
    expect(sources.get(projectB.revisionId)!.dispose).toHaveBeenCalledTimes(1)
    expect(harness.jobResourcesByRevision.get(projectA.revisionId)!.quiesce)
      .toHaveBeenCalledTimes(1)
    expect(harness.jobResourcesByRevision.get(projectA.revisionId)!.resume)
      .toHaveBeenCalledTimes(2)
    expect(harness.jobResourcesByRevision.get(projectB.revisionId)!.disposeSpy)
      .toHaveBeenCalledTimes(1)
  })

  it('restores all checkpoints when Scene apply fails and publishes no candidate', async () => {
    const harness = runtimeHarness({
      resolve: async (_project, definition) => preparedGeometry(definition, 12).geometry,
    })
    const projectA = revision(makeMinimalWorkcellProjectV4(), 'revision-a')
    const projectB = revision(makeMinimalWorkcellProjectV4(), 'revision-b')
    const applicationA = await harness.runtime.apply(
      await harness.runtime.prepare(projectA, projectA.revisionId),
    )
    applicationA.commit()
    const firstGeometry = harness.geometry.readCurrent('definition-1')!.handle
    const listener = vi.fn()
    harness.publicStores.robots.subscribe(listener)
    vi.spyOn(harness.scene.getState(), 'replaceProjection')
      .mockImplementationOnce(() => { throw new Error('scene failed') })
    const candidate = await harness.runtime.prepare(projectB, projectB.revisionId)

    await expect(harness.runtime.apply(candidate)).rejects.toThrow('scene failed')

    expect(harness.robots.getState().projectRevisionId).toBe(projectA.revisionId)
    expect(harness.jobs.getState().projectRevisionId).toBe(projectA.revisionId)
    expect(harness.scene.getState().projectRevisionId).toBe(projectA.revisionId)
    expect(harness.geometry.readCurrent('definition-1')!.handle).toBe(firstGeometry)
    expect(listener).not.toHaveBeenCalled()
    expect(harness.jobResourcesByRevision.get(projectA.revisionId)!.resume)
      .toHaveBeenCalledTimes(2)
    expect(harness.jobResourcesByRevision.get(projectB.revisionId)!.disposeSpy)
      .toHaveBeenCalledTimes(1)
  })

  it('disposes every unstaged prepared Geometry after a partial stage failure', async () => {
    const sources: PreparedGeometryHarness[] = []
    const harness = runtimeHarness({
      resolve: async (_project, definition) => {
        const source = preparedGeometry(definition, 12)
        sources.push(source)
        return source.geometry
      },
    })
    const project = revision(
      projectAtLimit('robotDefinitions', 2),
      'revision-stage-failure',
    )
    const candidate = await harness.runtime.prepare(project, project.revisionId)
    const stage = harness.geometry.stage
    let stageCalls = 0
    vi.spyOn(harness.geometry, 'stage').mockImplementation((definition, geometry) => {
      stageCalls += 1
      if (stageCalls === 2) throw new Error('stage failed')
      return stage(definition, geometry)
    })

    await expect(harness.runtime.apply(candidate)).rejects.toThrow('stage failed')

    expect(sources).toHaveLength(2)
    sources.forEach(({ dispose }) => expect(dispose).toHaveBeenCalledTimes(1))
    expect(harness.jobResourcesByRevision.get(project.revisionId)!.disposeSpy)
      .toHaveBeenCalledTimes(1)
    expect(() => {
      const transaction = harness.dependencies.notifications.begin()
      transaction.rollback()
    }).not.toThrow()
  })

  it('closes the barrier and resumes the prior clock when checkpoint capture fails', async () => {
    const harness = runtimeHarness()
    const projectA = revision(makeMinimalWorkcellProjectV4(), 'revision-a')
    const projectB = revision(makeMinimalWorkcellProjectV4(), 'revision-b')
    const applicationA = await harness.runtime.apply(
      await harness.runtime.prepare(projectA, projectA.revisionId),
    )
    applicationA.commit()
    vi.spyOn(harness.coordinates.getState(), 'captureCheckpoint')
      .mockImplementationOnce(() => { throw new Error('checkpoint failed') })
    const candidate = await harness.runtime.prepare(projectB, projectB.revisionId)

    await expect(harness.runtime.apply(candidate)).rejects.toThrow('checkpoint failed')

    expect(harness.publicStores.robots.getState().projectRevisionId)
      .toBe(projectA.revisionId)
    expect(harness.jobResourcesByRevision.get(projectA.revisionId)!.resume)
      .toHaveBeenCalledTimes(2)
    expect(harness.jobResourcesByRevision.get(projectB.revisionId)!.disposeSpy)
      .toHaveBeenCalledTimes(1)
    expect(() => {
      const transaction = harness.dependencies.notifications.begin()
      transaction.rollback()
    }).not.toThrow()
  })

  it('preserves an apply failure while exhausting restore, Geometry, Job, and clock cleanup', async () => {
    const sources = new Map<string, PreparedGeometryHarness>()
    const harness = runtimeHarness({
      resolve: async (project, definition) => {
        const source = preparedGeometry(definition, 12)
        sources.set(project.revisionId, source)
        return source.geometry
      },
    })
    const projectA = revision(makeMinimalWorkcellProjectV4(), 'revision-a')
    const projectB = revision(makeMinimalWorkcellProjectV4(), 'revision-b')
    const applicationA = await harness.runtime.apply(
      await harness.runtime.prepare(projectA, projectA.revisionId),
    )
    applicationA.commit()
    const candidate = await harness.runtime.prepare(projectB, projectB.revisionId)
    sources.get(projectB.revisionId)!.dispose.mockImplementationOnce(() => {
      throw new Error('geometry cleanup failed')
    })
    harness.jobResourcesByRevision.get(projectB.revisionId)!.disposeSpy
      .mockImplementationOnce(() => { throw new Error('job cleanup failed') })
    vi.spyOn(harness.bundles.getState(), 'restoreCheckpoint')
      .mockImplementationOnce(() => { throw new Error('restore failed') })
    vi.spyOn(harness.scene.getState(), 'replaceProjection')
      .mockImplementationOnce(() => { throw new Error('scene failed') })

    await expect(harness.runtime.apply(candidate)).rejects.toThrow('scene failed')

    expect(harness.robots.getState().projectRevisionId).toBe(projectA.revisionId)
    expect(harness.jobs.getState().projectRevisionId).toBe(projectA.revisionId)
    expect(sources.get(projectB.revisionId)!.dispose).toHaveBeenCalledTimes(1)
    expect(harness.jobResourcesByRevision.get(projectB.revisionId)!.disposeSpy)
      .toHaveBeenCalledTimes(1)
    expect(harness.jobResourcesByRevision.get(projectA.revisionId)!.resume)
      .toHaveBeenCalledTimes(2)
    expect(() => {
      const transaction = harness.dependencies.notifications.begin()
      transaction.rollback()
    }).not.toThrow()
  })

  it('exhausts rollback cleanup even when every reversible boundary throws', async () => {
    const sources = new Map<string, PreparedGeometryHarness>()
    const harness = runtimeHarness({
      resolve: async (project, definition) => {
        const source = preparedGeometry(definition, 12)
        sources.set(project.revisionId, source)
        return source.geometry
      },
    })
    const projectA = revision(makeMinimalWorkcellProjectV4(), 'revision-a')
    const projectB = revision(makeMinimalWorkcellProjectV4(), 'revision-b')
    const applicationA = await harness.runtime.apply(
      await harness.runtime.prepare(projectA, projectA.revisionId),
    )
    applicationA.commit()
    const applicationB = await harness.runtime.apply(
      await harness.runtime.prepare(projectB, projectB.revisionId),
    )
    sources.get(projectB.revisionId)!.dispose.mockImplementationOnce(() => {
      throw new Error('geometry cleanup failed')
    })
    harness.jobResourcesByRevision.get(projectB.revisionId)!.disposeSpy
      .mockImplementationOnce(() => { throw new Error('job cleanup failed') })
    const restoreBundle = harness.bundles.getState().restoreCheckpoint
    vi.spyOn(harness.bundles.getState(), 'restoreCheckpoint')
      .mockImplementationOnce((checkpoint) => {
        restoreBundle(checkpoint)
        throw new Error('restore failed')
      })

    expect(() => applicationB.rollback()).toThrow('restore failed')

    expect(harness.robots.getState().projectRevisionId).toBe(projectA.revisionId)
    expect(harness.bundles.getState().projectRevisionId).toBe(projectA.revisionId)
    expect(harness.geometry.readCurrent('definition-1')!.resolution).toBe('RESOLVED')
    expect(sources.get(projectB.revisionId)!.dispose).toHaveBeenCalledTimes(1)
    expect(harness.jobResourcesByRevision.get(projectB.revisionId)!.disposeSpy)
      .toHaveBeenCalledTimes(1)
    expect(harness.jobResourcesByRevision.get(projectA.revisionId)!.resume)
      .toHaveBeenCalledTimes(2)
    expect(() => {
      const transaction = harness.dependencies.notifications.begin()
      transaction.rollback()
    }).not.toThrow()
  })

  it('preserves preparation failure while disposing every resolved Definition', async () => {
    const sources: PreparedGeometryHarness[] = []
    const harness = runtimeHarness({
      resolve: async (_project, definition) => {
        const source = preparedGeometry(definition, 1_500_001)
        sources.push(source)
        if (sources.length === 1) {
          source.dispose.mockImplementationOnce(() => {
            throw new Error('first cleanup failed')
          })
        }
        return source.geometry
      },
    })
    const project = revision(
      projectAtLimit('robotDefinitions', 2),
      'revision-prepare-failure',
    )

    await expect(harness.runtime.prepare(project, project.revisionId))
      .rejects.toMatchObject({ code: 'VISIBLE_SCENE_TRIANGLE_LIMIT_EXCEEDED' })

    expect(sources).toHaveLength(2)
    sources.forEach(({ dispose }) => expect(dispose).toHaveBeenCalledTimes(1))
  })

  it('exhausts explicit dispose across Definitions and Job resources', async () => {
    const sources: PreparedGeometryHarness[] = []
    const harness = runtimeHarness({
      resolve: async (_project, definition) => {
        const source = preparedGeometry(definition, 12)
        sources.push(source)
        return source.geometry
      },
    })
    const project = revision(
      projectAtLimit('robotDefinitions', 2),
      'revision-dispose',
    )
    const bundle = await harness.runtime.prepare(project, project.revisionId)
    sources[0]!.dispose.mockImplementationOnce(() => {
      throw new Error('first cleanup failed')
    })

    expect(() => harness.runtime.dispose(bundle)).toThrow('first cleanup failed')

    expect(sources[0]!.dispose).toHaveBeenCalledTimes(1)
    expect(sources[1]!.dispose).toHaveBeenCalledTimes(1)
    expect(harness.jobResourcesByRevision.get(project.revisionId)!.disposeSpy)
      .toHaveBeenCalledTimes(1)
  })

  it('commits an explicit UNRESOLVED replacement and cleans prior Geometry only afterward', async () => {
    const firstSource: PreparedGeometryHarness[] = []
    const harness = runtimeHarness({
      resolve: async (project, definition) => {
        if (project.revisionId === 'revision-b') return null
        const source = preparedGeometry(definition, 12)
        firstSource.push(source)
        return source.geometry
      },
    })
    const projectA = revision(makeMinimalWorkcellProjectV4(), 'revision-a')
    const projectB = revision(makeMinimalWorkcellProjectV4(), 'revision-b')
    const applicationA = await harness.runtime.apply(
      await harness.runtime.prepare(projectA, projectA.revisionId),
    )
    applicationA.commit()
    const applicationB = await harness.runtime.apply(
      await harness.runtime.prepare(projectB, projectB.revisionId),
    )

    applicationB.commit()
    expect(harness.geometry.readCurrent('definition-1')).toMatchObject({
      resolution: 'UNRESOLVED',
      triangleCount: 0,
    })
    expect(harness.geometry.acquire('definition-1', 'robot-1')).toBeNull()
    expect(firstSource[0]!.dispose).not.toHaveBeenCalled()

    await applicationB.cleanup()
    expect(firstSource[0]!.dispose).toHaveBeenCalledTimes(1)
    expect(harness.jobResourcesByRevision.get(projectA.revisionId)!.disposeSpy)
      .toHaveBeenCalledTimes(1)
  })
})
