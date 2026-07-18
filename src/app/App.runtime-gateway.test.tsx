import { act, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { createStore } from 'zustand/vanilla'
import { describe, expect, it, vi } from 'vitest'

import {
  validateWorkcellProjectV4,
  type WorkcellProjectV4,
} from '../core/project-v4/index.js'
import { deriveCollisionPolicyV4 } from '../domain/collision/collision-policy-v4.js'
import { createCoordinateDisplayStoreV4 } from '../features/frames/v4/coordinate-display-store.js'
import { createInteractionStoreV4 } from '../features/interaction/v4/interaction-store.js'
import { createJobRuntimeStoreV4 } from '../features/jobs/v4/job-runtime-store.js'
import type { RobotJobPlaybackControllerV4 } from '../features/jobs/v4/simulation-clock.js'
import type { BrowserProjectResourcesV4 } from '../features/project/project-store-browser.js'
import { createBrowserRuntimeBundleStoreV4 } from '../features/project/v4/browser-runtime-bundle-store-v4.js'
import { createDualRobotSampleV4, DUAL_ROBOT_SAMPLE_IDS_V4 } from '../features/project/v4/dual-robot-sample-v4.js'
import type { ProjectMutationServiceV4 } from '../features/project/v4/project-v4-mutation-service.js'
import type { ProjectStoreStateV4 } from '../features/project/v4/project-store-v4.js'
import { createRobotDefinitionGeometryRepositoryV4 } from '../features/robot/v4/robot-definition-geometry-repository.js'
import { createRobotRuntimeRegistryV4 } from '../features/robot/v4/robot-runtime-registry.js'
import type {
  RuntimeGatewayPublisherV4,
  RuntimeGatewayStatePayloadV4,
  RuntimeGatewayStatusV4,
} from '../features/runtime-gateway/v4/runtime-gateway-publisher-v4.js'
import { RuntimeGatewayPublisherV4Error } from '../features/runtime-gateway/v4/runtime-gateway-publisher-v4.js'
import { selectSceneRuntimeV4 } from '../features/scene/v4/scene-runtime-selector.js'
import { createSceneRuntimeStoreV4 } from '../features/scene/v4/scene-runtime-store.js'
import { createViewportPreferenceStoreV4 } from '../features/viewport/v4/viewport-preference-store.js'
import { createShellLayoutStoreV4 } from '../features/ui/v4/shell-layout-store.js'
import { App } from './App.js'

vi.mock('./AppShell.js', () => ({
  AppShellV4: ({ header }: {
    readonly header: ReactNode
  }) => (
    <main>{header}</main>
  ),
}))

function project(revisionId: string): WorkcellProjectV4 {
  return createDualRobotSampleV4({
    projectId: 'project-runtime-gateway-v4',
    revisionId,
    nowIso: '2026-07-17T00:00:00.000Z',
    opcUaMode: 'server',
  })
}

function projectWithReservedJointId(revisionId: string): WorkcellProjectV4 {
  const source = project(revisionId)
  const sourceDefinition = source.robotDefinitions[0]!
  const previousJointId = sourceDefinition.joints[0]!.id
  const definition = {
    ...sourceDefinition,
    joints: sourceDefinition.joints.map((joint, index) => (
      index === 0 ? { ...joint, id: '__proto__' } : joint
    )),
  }
  const robots = source.robots.map((robot) => robot.definitionId !== definition.id
    ? robot
    : {
        ...robot,
        initialJointValues: Object.fromEntries(definition.joints.map(({ id, home }) => [
          id,
          id === '__proto__'
            ? robot.initialJointValues[previousJointId] ?? home
            : robot.initialJointValues[id],
        ])),
      })
  return validateWorkcellProjectV4({
    ...source,
    robotDefinitions: source.robotDefinitions.map((candidate) => (
      candidate.id === definition.id ? definition : candidate
    )),
    robots,
    jobs: [],
    opcUa: { ...source.opcUa, mappings: [] },
  })
}

function status(
  source: WorkcellProjectV4,
  endpointUrl = 'opc.tcp://127.0.0.1:4840',
): RuntimeGatewayStatusV4 {
  return {
    projectId: source.projectId,
    revisionId: source.revisionId,
    mode: 'server',
    ready: true,
    opcUaStarted: true,
    endpointUrl,
  }
}

function resourcesForProject(projectV4: WorkcellProjectV4): BrowserProjectResourcesV4 {
  const robots = createRobotRuntimeRegistryV4()
  robots.getState().replaceProject(projectV4)
  const jobs = createJobRuntimeStoreV4()
  jobs.getState().replaceProject(projectV4)
  const projection = selectSceneRuntimeV4(projectV4, robots.getState())
  const scene = createSceneRuntimeStoreV4()
  scene.getState().replaceProjection(projection)
  const interaction = createInteractionStoreV4()
  interaction.getState().replaceProject(projectV4)
  const coordinateDisplay = createCoordinateDisplayStoreV4()
  coordinateDisplay.getState().replaceProject(projectV4)
  const runtimeBundle = createBrowserRuntimeBundleStoreV4()
  const playback: RobotJobPlaybackControllerV4 = {
    startJob: vi.fn(() => ({ runId: 'run-runtime-gateway-v4' })),
    cancelRobotJob: vi.fn(),
    ensureRunning: vi.fn(),
    quiesce: vi.fn(async () => undefined),
    resume: vi.fn(),
    dispose: vi.fn(),
  }
  runtimeBundle.getState().replaceActive({
    project: projectV4,
    sceneRuntime: projection,
    collisionPolicy: deriveCollisionPolicyV4(
      projectV4.robots,
      projectV4.robotDefinitions,
      { enabled: true, nearMissMarginM: 0.05 },
    ),
    jobs: {
      executor: {
        startJob: vi.fn(() => ({ runId: 'run-runtime-gateway-v4' })),
        advanceAll: vi.fn(async () => undefined),
        cancelRobotJob: vi.fn(),
        readState: vi.fn(),
        waitForTerminal: vi.fn(),
        reset: vi.fn(),
        shutdown: vi.fn(),
      },
      playback,
      dispose: vi.fn(),
    },
  })
  const projectStore = createStore<ProjectStoreStateV4>()(() => ({
    activeProject: projectV4,
    status: 'ready',
    error: null,
    hydrate: vi.fn(async () => undefined),
    newProject: vi.fn(async () => undefined),
    saveActiveProject: vi.fn(async () => projectV4),
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
    sceneCommands: {} as BrowserProjectResourcesV4['sceneCommands'],
    jobCommands: {} as BrowserProjectResourcesV4['jobCommands'],
    projectFiles: {
      pickProject: vi.fn(async () => null),
      downloadProject: vi.fn(),
    },
    userPrompt: { requestText: vi.fn(async () => null) },
  }
}

function replacePublishedProject(
  resources: BrowserProjectResourcesV4,
  next: WorkcellProjectV4,
): void {
  resources.robots.getState().replaceProject(next)
  resources.jobs.getState().replaceProject(next)
  const projection = selectSceneRuntimeV4(next, resources.robots.getState())
  resources.scene.getState().replaceProjection(projection)
  resources.interaction.getState().replaceProject(next)
  resources.coordinateDisplay.getState().replaceProject(next)
  const jobs = resources.runtimeBundle.getState().active!.jobs
  resources.runtimeBundle.getState().replaceActive({
    project: next,
    sceneRuntime: projection,
    collisionPolicy: deriveCollisionPolicyV4(
      next.robots,
      next.robotDefinitions,
      { enabled: true, nearMissMarginM: 0.05 },
    ),
    jobs,
  })
  resources.projectStore.setState((state) => ({
    ...state,
    activeProject: next,
  }), true)
}

function publisher(overrides: Partial<RuntimeGatewayPublisherV4> = {}): {
  readonly value: RuntimeGatewayPublisherV4
  readonly activateProject: ReturnType<typeof vi.fn>
  readonly publishRobotState: ReturnType<typeof vi.fn>
} {
  const activateProject = vi.fn(async (candidate: WorkcellProjectV4) => status(candidate))
  const publishRobotState = vi.fn(async (payload) => status({
    ...project(payload.revisionId),
    projectId: payload.projectId,
  }))
  return {
    activateProject,
    publishRobotState,
    value: {
      activateProject,
      publishRobotState,
      readStatus: vi.fn(async () => status(project('revision-status'))),
      ...overrides,
    },
  }
}

function deferred<T>(): {
  readonly promise: Promise<T>
  resolve(value: T): void
  reject(error: unknown): void
} {
  let resolvePromise!: (value: T) => void
  let rejectPromise!: (error: unknown) => void
  return {
    promise: new Promise<T>((resolve, reject) => {
      resolvePromise = resolve
      rejectPromise = reject
    }),
    resolve: (value) => resolvePromise(value),
    reject: (error) => rejectPromise(error),
  }
}

describe('App Runtime Gateway V4 integration', () => {
  it('activates only after every public runtime surface matches the Project revision', async () => {
    const active = project('revision-matching-v4')
    const resources = resourcesForProject(active)
    const gateway = publisher()
    resources.scene.setState((state) => ({
      ...state,
      projectRevisionId: 'revision-stale',
    }), true)

    render(<App gatewayPublisher={gateway.value} resources={resources} />)
    await Promise.resolve()
    expect(gateway.activateProject).not.toHaveBeenCalled()

    act(() => {
      resources.scene.getState().replaceProjection(
        selectSceneRuntimeV4(active, resources.robots.getState()),
      )
    })
    await waitFor(() => expect(gateway.activateProject).toHaveBeenCalledWith(
      active,
      expect.any(AbortSignal),
    ))
  })

  it('publishes exact raw joint state for both Robots and unsubscribes on cleanup', async () => {
    const active = project('revision-state-v4')
    const resources = resourcesForProject(active)
    const gateway = publisher()
    const view = render(<App gatewayPublisher={gateway.value} resources={resources} />)

    await waitFor(() => expect(gateway.publishRobotState).toHaveBeenCalledTimes(1))
    expect(gateway.publishRobotState.mock.calls[0]![0]).toEqual({
      projectId: active.projectId,
      revisionId: active.revisionId,
      robots: active.robots.map((robot) => ({
        robotId: robot.id,
        jointValues: robot.initialJointValues,
      })),
    })

    act(() => resources.robots.getState().writeJointValues(
      DUAL_ROBOT_SAMPLE_IDS_V4.slideRobotId,
      { [DUAL_ROBOT_SAMPLE_IDS_V4.slideJointId]: 0.7 },
      'simulation',
    ))
    await waitFor(() => expect(gateway.publishRobotState).toHaveBeenCalledTimes(2))

    const activationSignal = gateway.activateProject.mock.calls[0]![1] as AbortSignal
    view.unmount()
    expect(activationSignal.aborted).toBe(true)
    act(() => resources.robots.getState().writeJointValues(
      DUAL_ROBOT_SAMPLE_IDS_V4.slideRobotId,
      { [DUAL_ROBOT_SAMPLE_IDS_V4.slideJointId]: 0.8 },
      'simulation',
    ))
    expect(gateway.publishRobotState).toHaveBeenCalledTimes(2)
  })

  it('publishes a schema-valid reserved JavaScript key Joint id without dropping it', async () => {
    const active = projectWithReservedJointId('revision-reserved-joint-v4')
    const resources = resourcesForProject(active)
    const gateway = publisher()

    render(<App gatewayPublisher={gateway.value} resources={resources} />)
    await waitFor(() => expect(gateway.publishRobotState).toHaveBeenCalledTimes(1))

    const payload = gateway.publishRobotState.mock.calls[0]![0] as RuntimeGatewayStatePayloadV4
    const robotId = active.robots[0]!.id
    const jointValues = payload.robots.find(({ robotId: id }) => id === robotId)!.jointValues
    expect(Object.hasOwn(jointValues, '__proto__')).toBe(true)
    expect(jointValues.__proto__).toBe(active.robots[0]!.initialJointValues.__proto__)
  })

  it('deactivates a prior Server without mutating an imported unsupported Client Project', async () => {
    const server = project('revision-client-mode-v4')
    const active = validateWorkcellProjectV4({
      ...server,
      opcUa: { ...server.opcUa, mode: 'client' },
    })
    const resources = resourcesForProject(active)
    const deactivateProject = vi.fn(async (candidate: WorkcellProjectV4) => ({
      ...status(candidate),
      mode: 'off' as const,
      opcUaStarted: false,
      endpointUrl: null,
    }))
    const gateway = publisher({ activateProject: deactivateProject })

    render(<App gatewayPublisher={gateway.value} resources={resources} />)

    await waitFor(() => expect(
      screen.getByRole('button', { name: /Gateway details: Unavailable.*OPC UA mode client/ }),
    ).toBeInTheDocument())
    expect(deactivateProject).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: active.projectId,
        revisionId: active.revisionId,
        opcUa: {
          mode: 'off',
          endpoints: [],
          mappings: [],
          actionBindings: [],
          bridgeRoutes: [],
        },
      }),
      expect.any(AbortSignal),
    )
    expect(active.opcUa.mode).toBe('client')
  })

  it('keeps a valid zero-Robot Server Project ready without posting an empty state batch', async () => {
    const source = project('revision-zero-robot-v4')
    const active = validateWorkcellProjectV4({
      ...source,
      assetReferences: [],
      robotDefinitions: [],
      robots: [],
      jobs: [],
      opcUa: { ...source.opcUa, mappings: [] },
    })
    const resources = resourcesForProject(active)
    const gateway = publisher()

    render(<App gatewayPublisher={gateway.value} resources={resources} />)

    await waitFor(() => expect(gateway.activateProject).toHaveBeenCalledOnce())
    await waitFor(() => expect(
      screen.getByRole('button', { name: /Gateway details: OPC UA Server.*Ready/ }),
    ).toBeInTheDocument())
    expect(gateway.publishRobotState).not.toHaveBeenCalled()
  })

  it('attaches one completion handler when coalesced state publishes share a Promise', async () => {
    const active = project('revision-coalesced-v4')
    const resources = resourcesForProject(active)
    const statePublish = deferred<RuntimeGatewayStatusV4>()
    const thenSpy = vi.spyOn(statePublish.promise, 'then')
    let publishCount = 0
    const gateway = publisher()
    const sharedPromisePublisher: RuntimeGatewayPublisherV4 = {
      ...gateway.value,
      publishRobotState: () => {
        publishCount += 1
        return statePublish.promise
      },
    }

    render(<App gatewayPublisher={sharedPromisePublisher} resources={resources} />)
    await waitFor(() => expect(publishCount).toBe(1))
    const initialHandlerCount = thenSpy.mock.calls.length

    act(() => {
      resources.robots.getState().writeJointValues(
        DUAL_ROBOT_SAMPLE_IDS_V4.slideRobotId,
        { [DUAL_ROBOT_SAMPLE_IDS_V4.slideJointId]: 0.7 },
        'simulation',
      )
      resources.robots.getState().writeJointValues(
        DUAL_ROBOT_SAMPLE_IDS_V4.slideRobotId,
        { [DUAL_ROBOT_SAMPLE_IDS_V4.slideJointId]: 0.8 },
        'simulation',
      )
    })
    await waitFor(() => expect(publishCount).toBe(3))

    expect(thenSpy).toHaveBeenCalledTimes(initialHandlerCount)
    statePublish.resolve(status(active))
  })

  it('ignores stale activation completion after a Project replacement', async () => {
    const first = project('revision-first-v4')
    const second = project('revision-second-v4')
    const resources = resourcesForProject(first)
    const stale = deferred<RuntimeGatewayStatusV4>()
    const activateProject = vi.fn((candidate: WorkcellProjectV4) => (
      candidate.revisionId === first.revisionId
        ? stale.promise
        : Promise.resolve(status(second, 'opc.tcp://127.0.0.1:4841'))
    ))
    const gateway = publisher({ activateProject })

    render(<App gatewayPublisher={gateway.value} resources={resources} />)
    await waitFor(() => expect(activateProject).toHaveBeenCalledTimes(1))
    act(() => replacePublishedProject(resources, second))
    await waitFor(() => expect(activateProject).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(
      screen.getByRole('button', { name: /Gateway details:/ }),
    ).toHaveAttribute('title', 'opc.tcp://127.0.0.1:4840'))

    stale.resolve(status(first, 'opc.tcp://127.0.0.1:4999'))
    await Promise.resolve()
    expect(screen.getByRole('button', { name: /Gateway details:/ }))
      .toHaveAttribute('title', 'opc.tcp://127.0.0.1:4840')
    expect(gateway.publishRobotState.mock.calls.every(
      ([payload]) => payload.revisionId === second.revisionId,
    )).toBe(true)
  })

  it('shows Gateway failure without disabling local Project controls', async () => {
    const active = project('revision-unavailable-v4')
    const resources = resourcesForProject(active)
    const gateway = publisher({
      activateProject: vi.fn(async () => {
        throw new Error('Gateway is offline.')
      }),
    })

    render(<App gatewayPublisher={gateway.value} resources={resources} />)

    await waitFor(() => expect(
      screen.getByRole('button', { name: /Gateway details: OPC UA Server.*Gateway is offline/ }),
    ).toBeInTheDocument())
    expect(screen.getByRole('button', { name: 'Save Project' })).toBeEnabled()
  })

  it('single-flights same-revision reactivation and retries only the latest Robot state', async () => {
    const active = project('revision-gateway-recovery-v4')
    const resources = resourcesForProject(active)
    const firstState = deferred<RuntimeGatewayStatusV4>()
    const secondState = deferred<RuntimeGatewayStatusV4>()
    const recoveryActivation = deferred<RuntimeGatewayStatusV4>()
    const activateProject = vi.fn((candidate: WorkcellProjectV4) => (
      activateProject.mock.calls.length === 1
        ? Promise.resolve(status(candidate))
        : recoveryActivation.promise
    ))
    const publishRobotState = vi.fn()
      .mockImplementationOnce(() => firstState.promise)
      .mockImplementationOnce(() => secondState.promise)
      .mockImplementation(async (payload) => status({
        ...active,
        projectId: payload.projectId,
        revisionId: payload.revisionId,
      }))
    const gateway = publisher({ activateProject, publishRobotState })

    render(<App gatewayPublisher={gateway.value} resources={resources} />)
    await waitFor(() => expect(publishRobotState).toHaveBeenCalledTimes(1))

    act(() => resources.robots.getState().writeJointValues(
      DUAL_ROBOT_SAMPLE_IDS_V4.slideRobotId,
      { [DUAL_ROBOT_SAMPLE_IDS_V4.slideJointId]: 0.6 },
      'simulation',
    ))
    await waitFor(() => expect(publishRobotState).toHaveBeenCalledTimes(2))

    const lostRuntime = new RuntimeGatewayPublisherV4Error(
      'NO_ACTIVE_REVISION',
      'No active Project Revision exists.',
      { statusCode: 409 },
    )
    firstState.reject(lostRuntime)
    secondState.reject(lostRuntime)
    await waitFor(() => expect(activateProject).toHaveBeenCalledTimes(2))

    act(() => resources.robots.getState().writeJointValues(
      DUAL_ROBOT_SAMPLE_IDS_V4.slideRobotId,
      { [DUAL_ROBOT_SAMPLE_IDS_V4.slideJointId]: 0.9 },
      'simulation',
    ))
    expect(publishRobotState).toHaveBeenCalledTimes(2)
    expect(activateProject).toHaveBeenCalledTimes(2)

    recoveryActivation.resolve(status(active))
    await waitFor(() => expect(publishRobotState).toHaveBeenCalledTimes(3))
    expect(publishRobotState.mock.calls[2]![0]).toEqual(expect.objectContaining({
      projectId: active.projectId,
      revisionId: active.revisionId,
      robots: expect.arrayContaining([
        expect.objectContaining({
          robotId: DUAL_ROBOT_SAMPLE_IDS_V4.slideRobotId,
          jointValues: {
            [DUAL_ROBOT_SAMPLE_IDS_V4.slideJointId]: 0.9,
          },
        }),
      ]),
    }))
    expect(activateProject).toHaveBeenCalledTimes(2)
  })
})
