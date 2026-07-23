import { describe, expect, it, vi } from 'vitest'

import {
  cloneWorkcellProjectV5,
  makeMinimalWorkcellProjectV5,
} from '../../../core/project-v5/test-support.js'
import type { OpcUaMappingV5, WorkcellProjectV5 } from '../../../core/project-v5/index.js'
import { createAttachmentRuntimeStoreV1 } from '../../actions/v5/attachment-runtime-store.js'
import { createJobRuntimeStoreV5 } from '../../jobs/v5/job-runtime-store.js'
import type { RobotJobExecutorV5 } from '../../jobs/v5/job-executor.js'
import type { RobotJobPlaybackControllerV5 } from '../../jobs/v5/simulation-clock.js'
import {
  createRobotFrameStatusRuntimeStoreV5,
  type RobotFrameStatusRuntimeStoreV5,
} from '../../robot/v5/robot-frame-status-runtime-store.js'
import { createRobotJointRuntimeStoreV5 } from '../../robot/v5/robot-joint-runtime-store.js'
import type { GatewaySignalWritePortV1 } from '../../runtime-gateway/v5/runtime-gateway-command-client.js'
import { createObjectRuntimeStateV5 } from '../../scene/v5/object-runtime-state.js'
import { createLogicalSignalRuntimeStoreV1 } from '../../signals/v5/logical-signal-runtime-store.js'
import {
  createBrowserRuntimeBundleCellV5,
  type BrowserRuntimeBundleStateV5,
  type PublishedBrowserRuntimeGraphV5,
} from './browser-runtime-bundle-store-v5.js'

const CONFIG_A = 'a'.repeat(64)
const CONFIG_B = 'b'.repeat(64)
const CONFIG_C = 'c'.repeat(64)
const SURFACE_ERROR = {
  robots: 'RUNTIME_GRAPH_ROBOTS_MISALIGNED',
  robotFrames: 'RUNTIME_GRAPH_ROBOT_FRAMES_MISALIGNED',
  objects: 'RUNTIME_GRAPH_OBJECTS_MISALIGNED',
  signals: 'RUNTIME_GRAPH_SIGNALS_MISALIGNED',
  jobs: 'RUNTIME_GRAPH_JOBS_MISALIGNED',
  attachments: 'RUNTIME_GRAPH_ATTACHMENTS_MISALIGNED',
  streamTarget: 'RUNTIME_GRAPH_STREAM_TARGET_MISALIGNED',
} as const
const STORE_API_METHODS = ['setState', 'getState', 'getInitialState', 'subscribe'] as const
const ROBOT_RUNTIME_METHODS = [
  'replaceProject',
  'ingest',
  'restoreReplayPrefix',
  'beginEndpointCatchup',
  'markEndpointDisconnected',
  'resetEndpointSession',
  'resetGatewaySession',
  'writeJointValues',
  'readRobot',
  'readRobotPose',
] as const
const SIGNAL_RUNTIME_METHODS = [
  'replaceProject',
  'ingest',
  'restoreReplayPrefix',
  'beginEndpointCatchup',
  'markEndpointDisconnected',
  'resetEndpointSession',
  'resetGatewaySession',
  'read',
] as const
const JOB_RUNTIME_METHODS = ['replaceProject', 'reset', 'setRobotState'] as const
const ATTACHMENT_RUNTIME_METHODS = [
  'replaceProject',
  'reset',
  'commitAttach',
  'commitDetach',
] as const
const FRAME_RUNTIME_METHODS = [
  'replaceProject',
  'ingest',
  'restoreReplayPrefix',
  'beginEndpointCatchup',
  'sampleFrame',
  'readNumericStatus',
  'markEndpointDisconnected',
  'resetEndpointSession',
  'resetGatewaySession',
] as const
const STORE_API_METHOD_CASES = (['robots', 'signals', 'jobs', 'attachments'] as const)
  .flatMap((surface) => STORE_API_METHODS.map((method) => [surface, method] as const))
const STORE_STATE_METHOD_CASES = [
  ...ROBOT_RUNTIME_METHODS.map((method) => ['robots', method, 'RUNTIME_GRAPH_ROBOTS_INVALID'] as const),
  ...SIGNAL_RUNTIME_METHODS.map((method) => ['signals', method, 'RUNTIME_GRAPH_SIGNALS_INVALID'] as const),
  ...JOB_RUNTIME_METHODS.map((method) => ['jobs', method, 'RUNTIME_GRAPH_JOBS_INVALID'] as const),
  ...ATTACHMENT_RUNTIME_METHODS.map((method) => ['attachments', method, 'RUNTIME_GRAPH_ATTACHMENTS_INVALID'] as const),
]
const DIRECT_RUNTIME_METHOD_CASES = [
  ...FRAME_RUNTIME_METHODS.map((method) => ['robotFrames', method, 'RUNTIME_GRAPH_ROBOT_FRAMES_INVALID'] as const),
  ...FRAME_RUNTIME_METHODS.map((method) => ['objects', method, 'RUNTIME_GRAPH_OBJECTS_INVALID'] as const),
]

function project(revisionId = 'revision-1'): WorkcellProjectV5 {
  const value = cloneWorkcellProjectV5(makeMinimalWorkcellProjectV5())
  ;(value as unknown as { revisionId: string }).revisionId = revisionId
  return value
}

function poseMapping(
  id: string,
  projectTarget: Extract<OpcUaMappingV5['leaves'][number]['projectTarget'], {
    readonly type: 'robot-frame' | 'entity-frame'
  }>,
): OpcUaMappingV5 {
  const paths = [
    ['positionM', 0],
    ['positionM', 1],
    ['positionM', 2],
    ['rpyDegrees', 0],
    ['rpyDegrees', 1],
    ['rpyDegrees', 2],
  ] as const
  return {
    id,
    endpointId: 'endpoint-1',
    nodeAddress: {
      namespaceUri: 'urn:sample:plc',
      identifierType: 'string',
      identifier: id,
    },
    direction: 'read',
    coherenceGroupId: id,
    interpolationMode: 'shortest-quaternion',
    coordinateConvention: 'project-v5-z-up-metres-quaternion-xyzw',
    leaves: paths.map((projectPath, index) => ({
      leafPath: [index],
      projectPath,
      projectTarget,
      opcUaDataType: 'Double',
      projectDataType: 'number',
      scale: 1,
      offset: 0,
      unit: index < 3 ? 'metre' : 'degree',
      required: true,
    })),
  }
}

function projectWithMappedDirectRuntimes(revisionId: string): WorkcellProjectV5 {
  const value = project(revisionId)
  const robot = value.robots[0] as unknown as { frameSources: Record<string, string> }
  robot.frameSources.TCP = 'opcua:endpoint-1'
  ;(value.spatialEntities as unknown as Array<WorkcellProjectV5['spatialEntities'][number]>).push({
    id: 'box',
    name: 'Box',
    geometry: { kind: 'box', dimensionsM: [1, 1, 1], color: '#808080' },
    parentFrameId: 'box-motion',
    localPose: { positionM: [0, 0, 0], quaternion: [0, 0, 0, 1] },
    visible: true,
    groupId: null,
    removable: true,
    transformOwner: 'opcua:endpoint-1',
    numericStatus: {
      value: 0,
      sourceOwnership: 'manual',
      overlay: { visible: false, frameId: null },
    },
    graspable: false,
    graspFrames: [],
    movingFrames: [{
      frameId: 'box-motion',
      name: 'Box motion',
      parentFrameId: 'world',
      localPose: { positionM: [0, 0, 0], quaternion: [0, 0, 0, 1] },
      sourceOwnership: 'opcua:endpoint-1',
    }],
  })
  ;(value.opcUa.mappings as unknown as OpcUaMappingV5[]).push(
    poseMapping('robot-tcp', { type: 'robot-frame', robotId: 'robot-1', frameId: 'TCP' }),
    poseMapping('box-pose', { type: 'entity-frame', entityId: 'box', frameId: 'box-motion' }),
  )
  return value
}

function graph(
  currentProject: WorkcellProjectV5,
  configRevision: string,
  gatewayId: string,
): PublishedBrowserRuntimeGraphV5 {
  const robots = createRobotJointRuntimeStoreV5(currentProject, configRevision)
  const robotFrames = createRobotFrameStatusRuntimeStoreV5(currentProject, configRevision)
  const objects = createObjectRuntimeStateV5(currentProject, configRevision)
  const signals = createLogicalSignalRuntimeStoreV1(currentProject, configRevision)
  const jobs = createJobRuntimeStoreV5(currentProject, configRevision)
  const attachments = createAttachmentRuntimeStoreV1(currentProject, configRevision)
  const signalWrites: GatewaySignalWritePortV1 = {
    writeBoolean: () => Promise.reject(new Error('unused Signal write stub')),
  }
  const jobExecutor: RobotJobExecutorV5 = {
    startJob: () => ({ runId: 'unused-run' }),
    advanceRobot: () => Promise.resolve(),
    advanceAll: () => Promise.resolve(),
    cancelRobotJob: () => undefined,
    cancelJob: () => undefined,
    readState: (robotId) => jobs.getState().byRobotId[robotId]!,
    waitForTerminal: () => Promise.reject(new Error('unused terminal wait stub')),
    reset: () => undefined,
    shutdown: () => undefined,
  }
  const playback: RobotJobPlaybackControllerV5 = {
    startJob: () => ({ runId: 'unused-run' }),
    cancelRobotJob: () => undefined,
    ensureRunning: () => undefined,
    quiesce: () => Promise.resolve(),
    resume: () => undefined,
    dispose: () => undefined,
  }
  return {
    robots,
    robotFrames,
    signals,
    objects,
    jobs,
    attachments,
    signalWrites,
    jobExecutor,
    playback,
    world: {
      readRobotFrameWorldPose: () => null,
      readRobotLinkWorldPose: () => null,
      readSceneFrameWorldPose: () => null,
      readObjectWorldPose: () => null,
    },
    streamTarget: {
      projectId: currentProject.projectId,
      configRevision,
      gatewayId,
      stateConsumers: [],
      lifecycleConsumers: [],
      onEndpointCatchupStart: () => ({ commit: () => undefined, abort: () => undefined }),
    },
  }
}

function bundle(
  revisionId: string,
  configRevision: string,
  runtimeEpoch: number,
  gatewayId = 'gateway-1',
): BrowserRuntimeBundleStateV5 {
  const currentProject = project(revisionId)
  return {
    runtimeEpoch,
    project: currentProject,
    projectRevisionId: currentProject.revisionId,
    configRevision,
    gatewayId,
    runtimeGraph: graph(currentProject, configRevision, gatewayId),
  }
}

function withoutMethod(value: object, method: string): object {
  const incomplete = { ...value } as Record<string, unknown>
  delete incomplete[method]
  return incomplete
}

describe('BrowserRuntimeBundleCellV5 split-phase publication', () => {
  it('creates one frozen, revision-aligned state without a stable per-store facade', () => {
    const cell = createBrowserRuntimeBundleCellV5(bundle('revision-1', CONFIG_A, 1), () => undefined)
    const state = cell.getState()

    expect(Object.isFrozen(state)).toBe(true)
    expect(Object.isFrozen(state.project)).toBe(true)
    expect(Object.isFrozen(state.runtimeGraph)).toBe(true)
    expect(Object.isFrozen(state.runtimeGraph.streamTarget)).toBe(true)
    expect(Object.isFrozen(state.runtimeGraph.streamTarget.stateConsumers)).toBe(true)
    expect(state).toMatchObject({
      runtimeEpoch: 1,
      projectRevisionId: 'revision-1',
      configRevision: CONFIG_A,
      gatewayId: 'gateway-1',
    })
    expect('signals' in cell).toBe(false)
    expect('robots' in cell).toBe(false)
    expect('runtimeGraph' in cell).toBe(false)
  })

  it('prepares without mutation, installs with no callout, then flushes the captured listeners once', () => {
    const diagnostics = vi.fn()
    const cell = createBrowserRuntimeBundleCellV5(bundle('revision-1', CONFIG_A, 1), diagnostics)
    const base = cell.getState()
    const observed: Array<{ readonly epoch: number; readonly graph: PublishedBrowserRuntimeGraphV5 }> = []
    cell.subscribe(() => {
      const current = cell.getState()
      observed.push({ epoch: current.runtimeEpoch, graph: current.runtimeGraph })
    })
    const token = cell.prepareInstall(bundle('revision-2', CONFIG_B, 2), base, 1)

    expect(cell.getState()).toBe(base)
    expect(token.previousRuntimeGraph).toBe(base.runtimeGraph)
    expect(observed).toEqual([])
    token.installPure()
    const installed = cell.getState()
    expect(installed).not.toBe(base)
    expect(installed).toMatchObject({
      runtimeEpoch: 2,
      projectRevisionId: 'revision-2',
      configRevision: CONFIG_B,
    })
    expect(Object.isFrozen(installed)).toBe(true)
    expect(observed).toEqual([])

    expect(() => token.flushIsolatedNotifications()).not.toThrow()
    expect(observed).toEqual([{ epoch: 2, graph: installed.runtimeGraph }])
    expect(() => token.flushIsolatedNotifications()).not.toThrow()
    expect(observed).toHaveLength(1)
    const afterFlush = cell.getState()
    expect(() => token.installPure()).toThrow(/INSTALL_TOKEN_REUSED/u)
    expect(cell.getState()).toBe(afterFlush)
    expect(diagnostics).not.toHaveBeenCalled()
  })

  it.each([
    'robots',
    'robotFrames',
    'objects',
    'signals',
    'jobs',
    'attachments',
    'streamTarget',
  ] as const)('rejects a %s revision mismatch without mutation or notification', (surface) => {
    const initial = bundle('revision-1', CONFIG_A, 1)
    const cell = createBrowserRuntimeBundleCellV5(initial, () => undefined)
    const base = cell.getState()
    const candidate = bundle('revision-2', CONFIG_B, 2)
    const runtimeGraph = {
      ...candidate.runtimeGraph,
      [surface]: initial.runtimeGraph[surface],
    } as unknown as PublishedBrowserRuntimeGraphV5
    const notify = vi.fn()
    cell.subscribe(notify)

    expect(() => cell.prepareInstall({ ...candidate, runtimeGraph }, base, 1))
      .toThrow(new RegExp(SURFACE_ERROR[surface], 'u'))
    expect(cell.getState()).toBe(base)
    expect(notify).not.toHaveBeenCalled()
  })

  it('rejects invalid epochs, Project/config/gateway alignment, and exhaustion before mutation', () => {
    const initial = bundle('revision-1', CONFIG_A, 1)
    expect(() => createBrowserRuntimeBundleCellV5({ ...initial, runtimeEpoch: 0 }, () => undefined))
      .toThrow(/RUNTIME_EPOCH_INVALID/u)

    const cell = createBrowserRuntimeBundleCellV5(initial, () => undefined)
    const base = cell.getState()
    const next = bundle('revision-2', CONFIG_B, 2)
    expect(() => cell.prepareInstall({ ...next, runtimeEpoch: 3 }, base, 1))
      .toThrow(/RUNTIME_EPOCH_INCREMENT_INVALID/u)
    expect(() => cell.prepareInstall({ ...next, projectRevisionId: 'wrong' }, base, 1))
      .toThrow(/PROJECT_REVISION_MISALIGNED/u)
    expect(() => cell.prepareInstall({ ...next, configRevision: 'A'.repeat(64) }, base, 1))
      .toThrow(/CONFIG_REVISION_INVALID/u)
    expect(() => cell.prepareInstall({ ...next, gatewayId: 'other-gateway' }, base, 1))
      .toThrow(/RUNTIME_GRAPH_STREAM_TARGET_MISALIGNED/u)
    expect(cell.getState()).toBe(base)

    const exhausted = createBrowserRuntimeBundleCellV5(
      bundle('revision-max', CONFIG_A, Number.MAX_SAFE_INTEGER),
      () => undefined,
    )
    expect(() => exhausted.prepareInstall(
      bundle('revision-next', CONFIG_B, Number.MAX_SAFE_INTEGER),
      exhausted.getState(),
      Number.MAX_SAFE_INTEGER,
    )).toThrow(/RUNTIME_EPOCH_EXHAUSTED/u)
  })

  it('requires the exact base object and epoch before validating a candidate', () => {
    const cell = createBrowserRuntimeBundleCellV5(bundle('revision-1', CONFIG_A, 1), () => undefined)
    const base = cell.getState()
    const equalButForeignBase = { ...base }
    const invalidCandidate = { ...bundle('revision-2', CONFIG_B, 2), runtimeEpoch: 99 }

    expect(() => cell.prepareInstall(invalidCandidate, equalButForeignBase, 1))
      .toThrow(/RUNTIME_BASE_BUNDLE_STALE/u)
    expect(() => cell.prepareInstall(invalidCandidate, base, 2))
      .toThrow(/RUNTIME_BASE_EPOCH_STALE/u)
    expect(cell.getState()).toBe(base)
  })

  it('rejects stale, reused, and foreign install tokens before changing either cell', () => {
    const cell = createBrowserRuntimeBundleCellV5(bundle('revision-1', CONFIG_A, 1), () => undefined)
    const base = cell.getState()
    const stale = cell.prepareInstall(bundle('revision-2', CONFIG_B, 2), base, 1)
    const winner = cell.prepareInstall(bundle('revision-3', CONFIG_C, 2), base, 1)
    winner.installPure()
    const winnerState = cell.getState()

    expect(() => stale.installPure()).toThrow(/INSTALL_TOKEN_STALE/u)
    expect(cell.getState()).toBe(winnerState)
    expect(() => winner.installPure()).toThrow(/INSTALL_TOKEN_REUSED/u)
    expect(cell.getState()).toBe(winnerState)

    const other = createBrowserRuntimeBundleCellV5(bundle('revision-1', CONFIG_A, 1), () => undefined)
    const foreign = other.prepareInstall(bundle('revision-4', CONFIG_B, 2), other.getState(), 1)
    expect(() => winner.installPure.call(foreign)).toThrow(/INSTALL_TOKEN_FOREIGN/u)
    expect(cell.getState()).toBe(winnerState)
    expect(other.getState().runtimeEpoch).toBe(1)
  })

  it('uses the prepare-time listener snapshot and isolates listener and diagnostic failures', () => {
    const diagnosticErrors: unknown[] = []
    const cell = createBrowserRuntimeBundleCellV5(bundle('revision-1', CONFIG_A, 1), (error) => {
      diagnosticErrors.push(error)
      throw new Error('diagnostic failed')
    })
    const firstError = new Error('first listener failed')
    const observed: string[] = []
    let token!: ReturnType<typeof cell.prepareInstall>
    const unsubscribeFirst = cell.subscribe(() => {
      observed.push(`first:${cell.getState().runtimeEpoch}`)
      expect(() => token.installPure()).toThrow(/INSTALL_TOKEN_REUSED/u)
      throw firstError
    })
    cell.subscribe(() => observed.push(`second:${cell.getState().runtimeEpoch}`))
    token = cell.prepareInstall(bundle('revision-2', CONFIG_B, 2), cell.getState(), 1)
    unsubscribeFirst()
    cell.subscribe(() => observed.push(`late:${cell.getState().runtimeEpoch}`))

    token.installPure()
    expect(() => token.flushIsolatedNotifications()).not.toThrow()
    expect(observed).toEqual(['first:2', 'second:2'])
    expect(diagnosticErrors).toEqual([firstError])
    expect(cell.getState().runtimeEpoch).toBe(2)
  })

  it('captures an owned frozen candidate so caller mutation after prepare cannot alter publication', () => {
    const cell = createBrowserRuntimeBundleCellV5(bundle('revision-1', CONFIG_A, 1), () => undefined)
    const next = bundle('revision-2', CONFIG_B, 2)
    const token = cell.prepareInstall(next, cell.getState(), 1)
    ;(next as unknown as { runtimeEpoch: number }).runtimeEpoch = 99
    ;(next as unknown as { projectRevisionId: string }).projectRevisionId = 'mutated'
    ;(next.project as unknown as { revisionId: string }).revisionId = 'mutated-project'

    token.installPure()
    const installed = cell.getState()
    expect(installed).toMatchObject({
      runtimeEpoch: 2,
      projectRevisionId: 'revision-2',
      configRevision: CONFIG_B,
    })
    expect(installed.project.revisionId).toBe('revision-2')
    expect(Object.isFrozen(installed.project)).toBe(true)
  })

  it.each([
    ['robots', null, 'RUNTIME_GRAPH_ROBOTS_INVALID'],
    ['signals', {}, 'RUNTIME_GRAPH_SIGNALS_INVALID'],
    ['jobs', { getState: null }, 'RUNTIME_GRAPH_JOBS_INVALID'],
    ['attachments', { getState: () => null }, 'RUNTIME_GRAPH_ATTACHMENTS_INVALID'],
    ['robotFrames', null, 'RUNTIME_GRAPH_ROBOT_FRAMES_INVALID'],
    ['objects', null, 'RUNTIME_GRAPH_OBJECTS_INVALID'],
    ['streamTarget', null, 'RUNTIME_GRAPH_STREAM_TARGET_INVALID'],
  ] as const)('rejects malformed %s graph surfaces with a coded error before publication', (
    surface,
    malformed,
    errorCode,
  ) => {
    const cell = createBrowserRuntimeBundleCellV5(bundle('revision-1', CONFIG_A, 1), () => undefined)
    const next = bundle('revision-2', CONFIG_B, 2)
    const notify = vi.fn()
    cell.subscribe(notify)
    const runtimeGraph = {
      ...next.runtimeGraph,
      [surface]: malformed,
    } as unknown as PublishedBrowserRuntimeGraphV5

    expect(() => cell.prepareInstall({ ...next, runtimeGraph }, cell.getState(), 1))
      .toThrow(new RegExp(errorCode, 'u'))
    expect(cell.getState().runtimeEpoch).toBe(1)
    expect(notify).not.toHaveBeenCalled()
  })

  it('converts a throwing store reader into a coded pre-publication rejection', () => {
    const cell = createBrowserRuntimeBundleCellV5(bundle('revision-1', CONFIG_A, 1), () => undefined)
    const next = bundle('revision-2', CONFIG_B, 2)
    const runtimeGraph = {
      ...next.runtimeGraph,
      robots: { getState: () => { throw new Error('raw reader failure') } },
    } as unknown as PublishedBrowserRuntimeGraphV5

    expect(() => cell.prepareInstall({ ...next, runtimeGraph }, cell.getState(), 1))
      .toThrow(/RUNTIME_GRAPH_ROBOTS_INVALID/u)
    expect(cell.getState().runtimeEpoch).toBe(1)
  })

  it.each([
    ['signalWrites', 'writeBoolean', 'RUNTIME_GRAPH_SIGNAL_WRITES_INVALID'],
    ['jobExecutor', 'startJob', 'RUNTIME_GRAPH_JOB_EXECUTOR_INVALID'],
    ['jobExecutor', 'advanceRobot', 'RUNTIME_GRAPH_JOB_EXECUTOR_INVALID'],
    ['jobExecutor', 'advanceAll', 'RUNTIME_GRAPH_JOB_EXECUTOR_INVALID'],
    ['jobExecutor', 'cancelRobotJob', 'RUNTIME_GRAPH_JOB_EXECUTOR_INVALID'],
    ['jobExecutor', 'cancelJob', 'RUNTIME_GRAPH_JOB_EXECUTOR_INVALID'],
    ['jobExecutor', 'readState', 'RUNTIME_GRAPH_JOB_EXECUTOR_INVALID'],
    ['jobExecutor', 'waitForTerminal', 'RUNTIME_GRAPH_JOB_EXECUTOR_INVALID'],
    ['jobExecutor', 'reset', 'RUNTIME_GRAPH_JOB_EXECUTOR_INVALID'],
    ['jobExecutor', 'shutdown', 'RUNTIME_GRAPH_JOB_EXECUTOR_INVALID'],
    ['playback', 'startJob', 'RUNTIME_GRAPH_PLAYBACK_INVALID'],
    ['playback', 'cancelRobotJob', 'RUNTIME_GRAPH_PLAYBACK_INVALID'],
    ['playback', 'ensureRunning', 'RUNTIME_GRAPH_PLAYBACK_INVALID'],
    ['playback', 'quiesce', 'RUNTIME_GRAPH_PLAYBACK_INVALID'],
    ['playback', 'resume', 'RUNTIME_GRAPH_PLAYBACK_INVALID'],
    ['playback', 'dispose', 'RUNTIME_GRAPH_PLAYBACK_INVALID'],
  ] as const)('rejects %s without the required %s service method before publication', (
    service,
    method,
    errorCode,
  ) => {
    const cell = createBrowserRuntimeBundleCellV5(bundle('revision-1', CONFIG_A, 1), () => undefined)
    const next = bundle('revision-2', CONFIG_B, 2)
    const runtimeGraph = {
      ...next.runtimeGraph,
      [service]: withoutMethod(next.runtimeGraph[service], method),
    } as unknown as PublishedBrowserRuntimeGraphV5

    expect(() => cell.prepareInstall({ ...next, runtimeGraph }, cell.getState(), 1))
      .toThrow(new RegExp(errorCode, 'u'))
    expect(cell.getState().runtimeEpoch).toBe(1)
  })

  it('captures an accessor-backed next Epoch exactly once and publishes the captured value', () => {
    const cell = createBrowserRuntimeBundleCellV5(bundle('revision-1', CONFIG_A, 1), () => undefined)
    const notify = vi.fn()
    cell.subscribe(notify)
    const candidate = { ...bundle('revision-2', CONFIG_B, 2) }
    let epochReads = 0
    Object.defineProperty(candidate, 'runtimeEpoch', {
      enumerable: true,
      get: () => (++epochReads === 1 ? 2 : 3),
    })

    const token = cell.prepareInstall(candidate, cell.getState(), 1)
    expect(epochReads).toBe(1)
    expect(cell.getState().runtimeEpoch).toBe(1)
    expect(notify).not.toHaveBeenCalled()
    token.installPure()
    expect(cell.getState().runtimeEpoch).toBe(2)
    expect(notify).not.toHaveBeenCalled()
    token.flushIsolatedNotifications()
    expect(notify).toHaveBeenCalledOnce()
  })

  it('captures graph and stream accessors once and publishes only the validated snapshot', () => {
    const cell = createBrowserRuntimeBundleCellV5(bundle('revision-1', CONFIG_A, 1), () => undefined)
    const notify = vi.fn()
    cell.subscribe(notify)
    const candidate = bundle('revision-2', CONFIG_B, 2)
    const sourceGraph = candidate.runtimeGraph
    const sourceTarget = sourceGraph.streamTarget
    const reads = {
      runtimeGraph: 0,
      robots: 0,
      streamTarget: 0,
      projectId: 0,
      stateConsumers: 0,
      lifecycleConsumers: 0,
      catchup: 0,
    }
    const capturedCatchup = sourceTarget.onEndpointCatchupStart
    const accessorTarget = {
      configRevision: sourceTarget.configRevision,
      gatewayId: sourceTarget.gatewayId,
    }
    Object.defineProperties(accessorTarget, {
      projectId: {
        enumerable: true,
        get: () => (++reads.projectId === 1 ? sourceTarget.projectId : 'wrong-project'),
      },
      stateConsumers: {
        enumerable: true,
        get: () => (++reads.stateConsumers === 1 ? sourceTarget.stateConsumers : [{}]),
      },
      lifecycleConsumers: {
        enumerable: true,
        get: () => (++reads.lifecycleConsumers === 1 ? sourceTarget.lifecycleConsumers : [null]),
      },
      onEndpointCatchupStart: {
        enumerable: true,
        get: () => (++reads.catchup === 1 ? capturedCatchup : undefined),
      },
    })
    const accessorGraph = {
      signals: sourceGraph.signals,
      objects: sourceGraph.objects,
      jobs: sourceGraph.jobs,
      attachments: sourceGraph.attachments,
      robotFrames: sourceGraph.robotFrames,
      signalWrites: sourceGraph.signalWrites,
      jobExecutor: sourceGraph.jobExecutor,
      playback: sourceGraph.playback,
      world: sourceGraph.world,
    }
    Object.defineProperties(accessorGraph, {
      robots: {
        enumerable: true,
        get: () => (++reads.robots === 1 ? sourceGraph.robots : {}),
      },
      streamTarget: {
        enumerable: true,
        get: () => (++reads.streamTarget === 1 ? accessorTarget : null),
      },
    })
    const accessorCandidate = {
      runtimeEpoch: candidate.runtimeEpoch,
      project: candidate.project,
      projectRevisionId: candidate.projectRevisionId,
      configRevision: candidate.configRevision,
      gatewayId: candidate.gatewayId,
    }
    Object.defineProperty(accessorCandidate, 'runtimeGraph', {
      enumerable: true,
      get: () => (++reads.runtimeGraph === 1 ? accessorGraph : {}),
    })

    const token = cell.prepareInstall(
      accessorCandidate as unknown as BrowserRuntimeBundleStateV5,
      cell.getState(),
      1,
    )
    expect(reads).toEqual({
      runtimeGraph: 1,
      robots: 1,
      streamTarget: 1,
      projectId: 1,
      stateConsumers: 1,
      lifecycleConsumers: 1,
      catchup: 1,
    })
    expect(cell.getState().runtimeEpoch).toBe(1)
    expect(notify).not.toHaveBeenCalled()
    token.installPure()
    expect(cell.getState().runtimeGraph.robots.getState().projectRevisionId).toBe('revision-2')
    expect(cell.getState().runtimeGraph.streamTarget).toMatchObject({
      projectId: candidate.project.projectId,
      configRevision: CONFIG_B,
      gatewayId: 'gateway-1',
    })
    expect(cell.getState().runtimeGraph.streamTarget.stateConsumers).toEqual([])
    expect(cell.getState().runtimeGraph.streamTarget.lifecycleConsumers).toEqual([])
    expect(() => cell.getState().runtimeGraph.streamTarget.onEndpointCatchupStart('endpoint-1', 100))
      .not.toThrow()
    expect(notify).not.toHaveBeenCalled()
  })

  it('rejects a first-read invalid accessor value without retry, mutation, or notification', () => {
    const cell = createBrowserRuntimeBundleCellV5(bundle('revision-1', CONFIG_A, 1), () => undefined)
    const notify = vi.fn()
    cell.subscribe(notify)
    const candidate = { ...bundle('revision-2', CONFIG_B, 2) }
    let epochReads = 0
    Object.defineProperty(candidate, 'runtimeEpoch', {
      enumerable: true,
      get: () => (++epochReads === 1 ? 3 : 2),
    })

    expect(() => cell.prepareInstall(candidate, cell.getState(), 1))
      .toThrow(/RUNTIME_EPOCH_INCREMENT_INVALID/u)
    expect(epochReads).toBe(1)
    expect(cell.getState().runtimeEpoch).toBe(1)
    expect(notify).not.toHaveBeenCalled()
  })

  it.each(STORE_API_METHOD_CASES)(
    'rejects %s StoreApi without %s before publication',
    (surface, method) => {
      const cell = createBrowserRuntimeBundleCellV5(bundle('revision-1', CONFIG_A, 1), () => undefined)
      const next = bundle('revision-2', CONFIG_B, 2)
      const runtimeGraph = {
        ...next.runtimeGraph,
        [surface]: withoutMethod(next.runtimeGraph[surface], method),
      } as unknown as PublishedBrowserRuntimeGraphV5

      expect(() => cell.prepareInstall({ ...next, runtimeGraph }, cell.getState(), 1))
        .toThrow(new RegExp(`RUNTIME_GRAPH_${surface.toUpperCase()}_INVALID`, 'u'))
      expect(cell.getState().runtimeEpoch).toBe(1)
    },
  )

  it.each(STORE_STATE_METHOD_CASES)(
    'rejects %s runtime state without %s before publication',
    (surface, method, errorCode) => {
      const cell = createBrowserRuntimeBundleCellV5(bundle('revision-1', CONFIG_A, 1), () => undefined)
      const next = bundle('revision-2', CONFIG_B, 2)
      const store = next.runtimeGraph[surface]
      const invalidState = withoutMethod(store.getState(), method)
      const runtimeGraph = {
        ...next.runtimeGraph,
        [surface]: { ...store, getState: () => invalidState },
      } as unknown as PublishedBrowserRuntimeGraphV5

      expect(() => cell.prepareInstall({ ...next, runtimeGraph }, cell.getState(), 1))
        .toThrow(new RegExp(errorCode, 'u'))
      expect(cell.getState().runtimeEpoch).toBe(1)
    },
  )

  it.each(DIRECT_RUNTIME_METHOD_CASES)(
    'rejects %s runtime service without %s before publication',
    (surface, method, errorCode) => {
      const cell = createBrowserRuntimeBundleCellV5(bundle('revision-1', CONFIG_A, 1), () => undefined)
      const next = bundle('revision-2', CONFIG_B, 2)
      const runtimeGraph = {
        ...next.runtimeGraph,
        [surface]: withoutMethod(next.runtimeGraph[surface], method),
      } as unknown as PublishedBrowserRuntimeGraphV5

      expect(() => cell.prepareInstall({ ...next, runtimeGraph }, cell.getState(), 1))
        .toThrow(new RegExp(errorCode, 'u'))
      expect(cell.getState().runtimeEpoch).toBe(1)
    },
  )

  it.each([
    ['signalWrites', 'writeBoolean', 'RUNTIME_GRAPH_SIGNAL_WRITES_INVALID'],
    ['robots', 'subscribe', 'RUNTIME_GRAPH_ROBOTS_INVALID'],
    ['robotFrames', 'sampleFrame', 'RUNTIME_GRAPH_ROBOT_FRAMES_INVALID'],
  ] as const)('rejects accessor-backed %s.%s methods before publication', (
    surface,
    method,
    errorCode,
  ) => {
    const cell = createBrowserRuntimeBundleCellV5(bundle('revision-1', CONFIG_A, 1), () => undefined)
    const notify = vi.fn()
    cell.subscribe(notify)
    const next = bundle('revision-2', CONFIG_B, 2)
    const source = next.runtimeGraph[surface]
    const accessorSurface = { ...source } as Record<string, unknown>
    const original = accessorSurface[method]
    Object.defineProperty(accessorSurface, method, {
      enumerable: true,
      get: () => original,
    })
    const runtimeGraph = {
      ...next.runtimeGraph,
      [surface]: accessorSurface,
    } as unknown as PublishedBrowserRuntimeGraphV5

    expect(() => cell.prepareInstall({ ...next, runtimeGraph }, cell.getState(), 1))
      .toThrow(new RegExp(errorCode, 'u'))
    expect(cell.getState().runtimeEpoch).toBe(1)
    expect(notify).not.toHaveBeenCalled()
  })

  it('rejects prepare immediately when a candidate Epoch getter installs a competing token', () => {
    const cell = createBrowserRuntimeBundleCellV5(bundle('revision-1', CONFIG_A, 1), () => undefined)
    const originalBase = cell.getState()
    const winner = cell.prepareInstall(bundle('revision-winner', CONFIG_B, 2), originalBase, 1)
    const outerCandidate = { ...bundle('revision-outer', CONFIG_C, 2) }
    const notify = vi.fn()
    cell.subscribe(notify)
    let epochReads = 0
    Object.defineProperty(outerCandidate, 'runtimeEpoch', {
      enumerable: true,
      get: () => {
        epochReads += 1
        winner.installPure()
        return 2
      },
    })
    let outerToken: unknown

    expect(() => {
      outerToken = cell.prepareInstall(outerCandidate, originalBase, 1)
    }).toThrow(/RUNTIME_BASE_BUNDLE_STALE/u)
    expect(outerToken).toBeUndefined()
    expect(epochReads).toBe(1)
    expect(cell.getState()).toMatchObject({
      runtimeEpoch: 2,
      projectRevisionId: 'revision-winner',
      configRevision: CONFIG_B,
    })
    expect(notify).not.toHaveBeenCalled()
  })

  it('rejects prepare immediately when a candidate Store reader installs a competing token', () => {
    const cell = createBrowserRuntimeBundleCellV5(bundle('revision-1', CONFIG_A, 1), () => undefined)
    const originalBase = cell.getState()
    const winner = cell.prepareInstall(bundle('revision-winner', CONFIG_B, 2), originalBase, 1)
    const outerCandidate = bundle('revision-outer', CONFIG_C, 2)
    const sourceRobots = outerCandidate.runtimeGraph.robots
    let storeReads = 0
    const runtimeGraph = {
      ...outerCandidate.runtimeGraph,
      robots: {
        ...sourceRobots,
        getState: () => {
          storeReads += 1
          winner.installPure()
          return sourceRobots.getState()
        },
      },
    } as PublishedBrowserRuntimeGraphV5
    const notify = vi.fn()
    cell.subscribe(notify)
    let outerToken: unknown

    expect(() => {
      outerToken = cell.prepareInstall({ ...outerCandidate, runtimeGraph }, originalBase, 1)
    }).toThrow(/RUNTIME_BASE_BUNDLE_STALE/u)
    expect(outerToken).toBeUndefined()
    expect(storeReads).toBe(1)
    expect(cell.getState()).toMatchObject({
      runtimeEpoch: 2,
      projectRevisionId: 'revision-winner',
      configRevision: CONFIG_B,
    })
    expect(notify).not.toHaveBeenCalled()
  })

  it('publishes captured direct-runtime metadata without rereading caller accessors', () => {
    const cell = createBrowserRuntimeBundleCellV5(bundle('revision-1', CONFIG_A, 1), () => undefined)
    const base = cell.getState()
    const candidate = bundle('revision-2', CONFIG_B, 2)
    const source = candidate.runtimeGraph.robotFrames
    let projectRevisionReads = 0
    let configRevisionReads = 0
    const adversarial = { ...source } as Record<string, unknown>
    Object.defineProperties(adversarial, {
      projectRevisionId: {
        enumerable: true,
        get: () => {
          projectRevisionReads += 1
          return projectRevisionReads === 1 ? 'revision-2' : 'forged-revision'
        },
      },
      configRevision: {
        enumerable: true,
        get: () => {
          configRevisionReads += 1
          return configRevisionReads === 1 ? CONFIG_B : 'f'.repeat(64)
        },
      },
    })
    const token = cell.prepareInstall({
      ...candidate,
      runtimeGraph: {
        ...candidate.runtimeGraph,
        robotFrames: adversarial as unknown as RobotFrameStatusRuntimeStoreV5,
      },
    }, base, 1)
    token.installPure()

    const published = cell.getState().runtimeGraph.robotFrames
    expect(projectRevisionReads).toBe(1)
    expect(configRevisionReads).toBe(1)
    expect([published.projectRevisionId, published.projectRevisionId]).toEqual([
      'revision-2',
      'revision-2',
    ])
    expect([published.configRevision, published.configRevision]).toEqual([CONFIG_B, CONFIG_B])
    expect(projectRevisionReads).toBe(1)
    expect(configRevisionReads).toBe(1)
  })

  it('keeps direct runtime metadata and sampling context live after replaceProject', () => {
    const cell = createBrowserRuntimeBundleCellV5(bundle('revision-1', CONFIG_A, 1), () => undefined)
    const graph = cell.getState().runtimeGraph
    const robotFrames = graph.robotFrames
    const objects = graph.objects
    const nextProject = projectWithMappedDirectRuntimes('revision-2')

    expect(robotFrames.sampleFrame('robot-1', 'TCP', 0)).toBeNull()
    expect(objects.sampleFrame('box', 'box-motion', 0)).toBeNull()
    robotFrames.replaceProject(nextProject, CONFIG_B)
    objects.replaceProject(nextProject, CONFIG_B)

    expect(robotFrames).toMatchObject({
      projectRevisionId: 'revision-2',
      configRevision: CONFIG_B,
    })
    expect(objects).toMatchObject({
      projectRevisionId: 'revision-2',
      configRevision: CONFIG_B,
    })
    expect(robotFrames.sampleFrame('robot-1', 'TCP', 0)).toMatchObject({
      robotId: 'robot-1',
      frameId: 'TCP',
      worldPose: null,
      quality: 'BAD',
      owner: 'opcua:endpoint-1',
    })
    expect(objects.sampleFrame('box', 'box-motion', 0)).toMatchObject({
      entityId: 'box',
      frameId: 'box-motion',
      worldPose: null,
      quality: 'BAD',
      owner: 'opcua:endpoint-1',
    })
  })

  it('binds every stream callback to its source target and preserves arguments, results, and throws', () => {
    const cell = createBrowserRuntimeBundleCellV5(bundle('revision-1', CONFIG_A, 1), () => undefined)
    const next = bundle('revision-2', CONFIG_B, 2)
    const sourceTarget = next.runtimeGraph.streamTarget
    const expectedGuard = Object.freeze({ commit: vi.fn(), abort: vi.fn() })
    const disconnectError = new Error('disconnect callback failure')
    const observations: Array<readonly [string, boolean, number | string]> = []
    const target = {
      ...sourceTarget,
      marker: 'source-target',
      onEndpointCatchupStart(this: { readonly marker?: string }, endpointId: string, atMs: number) {
        observations.push([endpointId, this.marker === 'source-target', atMs])
        return expectedGuard
      },
      onSessionStart(this: { readonly marker?: string }, atMs: number) {
        observations.push(['start', this.marker === 'source-target', atMs])
      },
      onSessionDisconnect(this: { readonly marker?: string }, atMs: number) {
        observations.push(['disconnect', this.marker === 'source-target', atMs])
        throw disconnectError
      },
    }
    const runtimeGraph = { ...next.runtimeGraph, streamTarget: target }
    const token = cell.prepareInstall({ ...next, runtimeGraph }, cell.getState(), 1)
    token.installPure()
    const published = cell.getState().runtimeGraph.streamTarget

    expect(published.onEndpointCatchupStart('endpoint-1', 10)).toBe(expectedGuard)
    published.onSessionStart?.(20)
    expect(() => published.onSessionDisconnect?.(30)).toThrow(disconnectError)
    expect(observations).toEqual([
      ['endpoint-1', true, 10],
      ['start', true, 20],
      ['disconnect', true, 30],
    ])
  })
})
