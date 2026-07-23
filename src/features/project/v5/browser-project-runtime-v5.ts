import {
  composeRigidTransformV5,
  validateLogicalSignalValueV1,
  validateWorkcellProjectV5,
  type RigidTransformV5,
  type WorkcellProjectV5,
} from '../../../core/project-v5/index.js'
import type { StoreApi } from 'zustand/vanilla'
import {
  createBrowserAttachmentInstructionPortV1,
} from '../../actions/v5/browser-attachment-instruction-port.js'
import {
  createAttachmentRuntimeStoreV1,
  type AttachmentRuntimeStoreV1,
} from '../../actions/v5/attachment-runtime-store.js'
import {
  createRobotJobExecutorV5,
  type RobotJobExecutorV5,
  type RobotJobExecutorLifecycleV5,
} from '../../jobs/v5/job-executor.js'
import {
  createJobRuntimeStoreV5,
  type JobRuntimeStoreV5,
} from '../../jobs/v5/job-runtime-store.js'
import {
  createRobotJobPlaybackControllerV5,
  type AnimationFrameSchedulerV5,
  type RobotJobPlaybackControllerV5,
} from '../../jobs/v5/simulation-clock.js'
import {
  createRobotFrameStatusRuntimeStoreV5,
  type RobotFrameStatusRuntimeStoreV5,
} from '../../robot/v5/robot-frame-status-runtime-store.js'
import {
  createRobotJointRuntimeStoreV5,
  type RobotJointRuntimeStoreV5,
} from '../../robot/v5/robot-joint-runtime-store.js'
import {
  createEndpointLifecycleRouterV5,
  type EndpointLifecycleRouterV5,
} from '../../runtime-gateway/v5/endpoint-lifecycle-router.js'
import {
  createGatewaySignalWritePortV1,
  createRuntimeGatewayCommandClientV1,
  type GatewaySignalWritePortV1,
  type RuntimeGatewayCommandClientOptionsV1,
  type RuntimeGatewayCommandClientV1,
} from '../../runtime-gateway/v5/runtime-gateway-command-client.js'
import {
  createRuntimeGatewayStateStreamV5,
  type BrowserLocationV5,
  type BrowserWebSocketV5,
  type EndpointCatchupGuardV5,
  type RuntimeGatewayStateStreamOptionsV5,
  type RuntimeGatewayStreamTargetV5,
} from '../../runtime-gateway/v5/runtime-gateway-state-stream.js'
import type { RuntimePublisherLeaseV1 } from '../../../core/runtime-protocol/v1.js'
import {
  createRuntimeGatewayCommandOwnerV5,
  type RuntimeGatewayCommandOwnerV5,
} from '../../runtime-gateway/v5/runtime-gateway-command-owner.js'
import {
  createAttachmentPoseRuntimeV1,
  type AttachmentPoseRuntimeV1,
} from '../../scene/v5/attachment-pose-runtime.js'
import {
  createObjectRuntimeStateV5,
  type ObjectRuntimeStateV5,
} from '../../scene/v5/object-runtime-state.js'
import {
  createLogicalSignalRuntimeStoreV1,
  type LogicalSignalRuntimeStoreV1,
} from '../../signals/v5/logical-signal-runtime-store.js'
import {
  createBrowserRuntimeBundleCellV5,
  type BrowserRuntimeBundleCellV5,
  type BrowserRuntimeBundleStateV5,
  type PublishedBrowserRuntimeGraphV5,
} from './browser-runtime-bundle-store-v5.js'

export type BrowserRuntimeDetachedApplyStepV5 =
  | 'robots'
  | 'frames'
  | 'objects'
  | 'signals'
  | 'jobs'
  | 'attachments'

export interface BrowserRuntimeStreamOptionsV5 {
  readonly url?: string
  readonly location?: BrowserLocationV5
  readonly createWebSocket?: (url: string) => BrowserWebSocketV5
  readonly nowMs: () => number
  readonly reconnectDelayMs?: number
}

export interface BrowserRuntimeCommandOptionsV5 {
  readonly fetch?: RuntimeGatewayCommandClientOptionsV1['fetch']
  readonly basePath?: string
  readonly nowMs?: () => number
}

export interface BrowserProjectRuntimeTestHooksV5 {
  readonly detachedApplyGate?: (
    step: BrowserRuntimeDetachedApplyStepV5,
    signal: AbortSignal,
  ) => void | Promise<void>
  readonly afterDetachedApplyStep?: (
    step: BrowserRuntimeDetachedApplyStepV5,
    graph: PublishedBrowserRuntimeGraphV5,
  ) => void
  readonly failApplyAfter?: BrowserRuntimeDetachedApplyStepV5
}

export interface BrowserProjectRuntimeV5Options {
  readonly initialProject?: WorkcellProjectV5 | undefined
  readonly initialConfigRevision?: string | undefined
  readonly gatewayId: string
  readonly scheduler: AnimationFrameSchedulerV5
  readonly createRunId: () => string
  readonly createCommandId: () => string
  readonly stream: BrowserRuntimeStreamOptionsV5
  readonly command: BrowserRuntimeCommandOptionsV5
  readonly onDiagnostic: (error: unknown) => void
  readonly testHooks?: BrowserProjectRuntimeTestHooksV5
}

export interface PreparedBrowserRuntimeCandidateV5 {
  readonly projectRevisionId: string
  readonly configRevision: string
}

export interface CommittedBrowserRuntimeTransitionV5 {
  rollback(): Promise<void>
  finalize(): Promise<void>
}

export interface BrowserProjectResourcesV5 {
  readonly bundle: BrowserRuntimeBundleCellV5
  readActiveBundle(): BrowserRuntimeBundleStateV5 | null
  prepare(project: WorkcellProjectV5, configRevision: string): Promise<PreparedBrowserRuntimeCandidateV5>
  apply(prepared: PreparedBrowserRuntimeCandidateV5): Promise<void>
  commit(prepared: PreparedBrowserRuntimeCandidateV5): Promise<CommittedBrowserRuntimeTransitionV5>
  rollback(prepared: PreparedBrowserRuntimeCandidateV5): Promise<void>
  deactivate(): Promise<CommittedBrowserRuntimeTransitionV5>
  startGatewayStream(): void
  stopGatewayStream(): void
  dispose(): Promise<void>
}

interface BundleInstallTokenV5 {
  installPure(): void
  flushIsolatedNotifications(): void
  restorePure(): void
  flushRollbackNotifications(): void
}

interface BundlePublisherV5 extends BrowserRuntimeBundleCellV5 {
  readGeneration(): number
  prepareInstall(
    next: BrowserRuntimeBundleStateV5 | null,
    expectedBaseBundle: BrowserRuntimeBundleStateV5 | null,
    expectedGeneration: number,
  ): BundleInstallTokenV5
}

interface OwnedBrowserRuntimeGraphV5 {
  readonly project: WorkcellProjectV5
  readonly configRevision: string
  readonly robots: StoreApi<RobotJointRuntimeStoreV5>
  readonly robotFrames: RobotFrameStatusRuntimeStoreV5
  readonly objects: ObjectRuntimeStateV5
  readonly simulationObjectPoses: Map<string, RigidTransformV5>
  readonly signals: StoreApi<LogicalSignalRuntimeStoreV1>
  readonly jobs: StoreApi<JobRuntimeStoreV5>
  readonly attachments: StoreApi<AttachmentRuntimeStoreV1>
  readonly commandClient: RuntimeGatewayCommandClientV1
  readonly signalWrites: GatewaySignalWritePortV1
  readonly jobExecutor: RobotJobExecutorV5 & RobotJobExecutorLifecycleV5
  readonly playback: RobotJobPlaybackControllerV5
  readonly endpointRouter: EndpointLifecycleRouterV5
  readonly commandOwner: RuntimeGatewayCommandOwnerV5
  suspendForTransition(): Promise<void>
  resumeAfterTransition(): void
  deactivateCommandOwner(): void
  readonly streamTarget: RuntimeGatewayStreamTargetV5
  readonly graph: PublishedBrowserRuntimeGraphV5
  disposed: boolean
}

type CandidateStateV5 = 'prepared' | 'applying' | 'applied' | 'failed' | 'committing' | 'committed' | 'consumed'
type OwnerStateV5 = 'active' | 'disposing' | 'disposed'

interface CandidateRecordV5 {
  readonly handle: PreparedBrowserRuntimeCandidateV5
  readonly project: WorkcellProjectV5
  readonly configRevision: string
  readonly baseBundle: BrowserRuntimeBundleStateV5 | null
  readonly baseGeneration: number
  readonly owned: OwnedBrowserRuntimeGraphV5
  readonly controller: AbortController
  state: CandidateStateV5
  applyPromise: Promise<void> | null
  rollbackPromise: Promise<void> | null
  commitPromise: Promise<CommittedBrowserRuntimeTransitionV5> | null
}

type CommittedTransitionStateV5 = 'committed' | 'rolling-back' | 'rolled-back' | 'finalizing' | 'finalized' | 'disposed'

interface CommittedTransitionRecordV5 {
  readonly candidate: CandidateRecordV5
  readonly install: BundleInstallTokenV5
  readonly previousOwned: OwnedBrowserRuntimeGraphV5 | null
  state: CommittedTransitionStateV5
  rollbackPromise: Promise<void> | null
  finalizePromise: Promise<void> | null
}

interface DeactivationTransitionRecordV5 {
  readonly install: BundleInstallTokenV5
  readonly previousOwned: OwnedBrowserRuntimeGraphV5
  state: CommittedTransitionStateV5
  rollbackPromise: Promise<void> | null
  finalizePromise: Promise<void> | null
}

interface WorldResolverV5 {
  readonly readRobotFrameWorldPose: (robotId: string, frameId: string) => RigidTransformV5 | null
  readonly readSceneFrameWorldPose: (frameId: string) => RigidTransformV5 | null
  readonly readObjectWorldPose: (objectId: string) => RigidTransformV5 | null
}

const CONFIG_REVISION_PATTERN = /^[0-9a-f]{64}$/u
const APPLY_STEPS: readonly BrowserRuntimeDetachedApplyStepV5[] = Object.freeze([
  'robots', 'frames', 'objects', 'signals', 'jobs', 'attachments',
])

function failure(code: string): Error {
  return new Error(code)
}

function abortFailure(): Error {
  const error = new Error('The detached browser runtime apply was aborted.')
  error.name = 'AbortError'
  return error
}

function requireConfigRevision(value: string): string {
  if (!CONFIG_REVISION_PATTERN.test(value)) throw new TypeError('CONFIG_REVISION_INVALID')
  return value
}

function requireGatewayId(value: string): string {
  if (typeof value !== 'string' || value.length === 0) throw new TypeError('GATEWAY_ID_INVALID')
  return value
}

function requireTimestamp(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new TypeError('RUNTIME_RECEIPT_CLOCK_INVALID')
  return value
}

function reportNoThrow(onDiagnostic: (error: unknown) => void, error: unknown): void {
  try {
    onDiagnostic(error)
  } catch {
    // Diagnostics are observational and cannot break runtime cleanup.
  }
}

function runNoThrow(onDiagnostic: (error: unknown) => void, operation: () => void): void {
  try {
    operation()
  } catch (error) {
    reportNoThrow(onDiagnostic, error)
  }
}

function assertStreamOptions(options: BrowserRuntimeStreamOptionsV5): void {
  const hasUrl = typeof options.url === 'string'
  const hasLocation = options.location !== undefined
  if (
    hasUrl === hasLocation
    || (hasUrl && options.url!.length === 0)
    || typeof options.nowMs !== 'function'
  ) {
    throw new TypeError('BROWSER_RUNTIME_STREAM_TARGET_INVALID')
  }
}

function createMonotonicRenderClock(nowMs: () => number): () => number {
  let last = 0
  return (): number => {
    last = Math.max(last, requireTimestamp(nowMs()))
    return last
  }
}

function createWorldResolver(
  project: WorkcellProjectV5,
  robots: StoreApi<RobotJointRuntimeStoreV5>,
  robotFrames: RobotFrameStatusRuntimeStoreV5,
  objects: ObjectRuntimeStateV5,
  attachmentProjection: AttachmentPoseRuntimeV1,
  renderClock: () => number,
  readSimulationObjectPose: (objectId: string) => RigidTransformV5 | null,
): WorldResolverV5 {
  const sceneById = new Map(project.scene.frames.map((frame) => [frame.id, frame]))
  const entityById = new Map(project.spatialEntities.map((entity) => [entity.id, entity]))
  const movingById = new Map<string, { readonly entityId: string; readonly frame: WorkcellProjectV5['spatialEntities'][number]['movingFrames'][number] }>()
  const graspById = new Map<string, { readonly entityId: string; readonly frame: WorkcellProjectV5['spatialEntities'][number]['graspFrames'][number] }>()
  const robotById = new Map(project.robots.map((robot) => [robot.id, robot]))
  const definitionById = new Map(project.robotDefinitions.map((definition) => [definition.id, definition]))
  for (const entity of project.spatialEntities) {
    for (const frame of entity.movingFrames) movingById.set(frame.frameId, { entityId: entity.id, frame })
    for (const frame of entity.graspFrames) graspById.set(frame.frameId, { entityId: entity.id, frame })
  }

  const resolve = (kind: 'scene' | 'robot' | 'object', id: string, frameId?: string): RigidTransformV5 | null => {
    const renderTimestampMs = renderClock()
    const visiting = new Set<string>()
    const memo = new Map<string, RigidTransformV5 | null>()
    let cycleDetected = false
    const resolveFrame = (nextFrameId: string): RigidTransformV5 | null => {
      const scene = sceneById.get(nextFrameId)
      if (scene !== undefined) return resolveScene(scene.id)
      const moving = movingById.get(nextFrameId)
      if (moving !== undefined) return resolveMoving(moving.entityId, moving.frame.frameId)
      const grasp = graspById.get(nextFrameId)
      if (grasp !== undefined) return resolveGrasp(grasp.entityId, grasp.frame.frameId)
      return null
    }
    const within = (key: string, calculate: () => RigidTransformV5 | null): RigidTransformV5 | null => {
      if (memo.has(key)) return memo.get(key)!
      if (visiting.has(key)) {
        cycleDetected = true
        return null
      }
      visiting.add(key)
      let value: RigidTransformV5 | null = null
      try { value = calculate() } catch { value = null }
      visiting.delete(key)
      memo.set(key, value)
      return value
    }
    const resolveScene = (sceneFrameId: string): RigidTransformV5 | null => within(`scene:${sceneFrameId}`, () => {
      const frame = sceneById.get(sceneFrameId)
      if (frame === undefined) return null
      if (frame.parentFrameId === null) return frame.localPose
      const parent = resolveScene(frame.parentFrameId)
      return parent === null ? null : composeRigidTransformV5(parent, frame.localPose)
    })
    const resolveObject = (objectId: string): RigidTransformV5 | null => within(`entity:${objectId}`, () => {
      const entity = entityById.get(objectId)
      if (entity === undefined) return null
      const simulated = readSimulationObjectPose(objectId)
      if (simulated !== null) return simulated
      const projected = attachmentProjection.readObjectWorldPose(
        objectId,
        (robotId, nextFrameId) => resolveRobot(robotId, nextFrameId),
        (nextFrameId) => resolveFrame(nextFrameId),
      )
      if (projected !== null) return projected
      const parent = resolveFrame(entity.parentFrameId)
      return parent === null ? null : composeRigidTransformV5(parent, entity.localPose)
    })
    const resolveMoving = (entityId: string, movingFrameId: string): RigidTransformV5 | null => within(`moving:${entityId}:${movingFrameId}`, () => {
      const entry = movingById.get(movingFrameId)
      if (entry === undefined || entry.entityId !== entityId) return null
      const sampled = objects.sampleFrame(entityId, movingFrameId, renderTimestampMs)
      if (sampled?.worldPose !== null && sampled?.worldPose !== undefined) return sampled.worldPose
      const parent = resolveFrame(entry.frame.parentFrameId)
      return parent === null ? null : composeRigidTransformV5(parent, entry.frame.localPose)
    })
    const resolveGrasp = (entityId: string, graspFrameId: string): RigidTransformV5 | null => within(`grasp:${entityId}:${graspFrameId}`, () => {
      const entry = graspById.get(graspFrameId)
      if (entry === undefined || entry.entityId !== entityId) return null
      const root = resolveObject(entityId)
      return root === null ? null : composeRigidTransformV5(root, entry.frame.localPose)
    })
    const resolveRobot = (robotId: string, robotFrameId: string): RigidTransformV5 | null => within(`robot:${robotId}:${robotFrameId}`, () => {
      const robot = robotById.get(robotId)
      if (robot === undefined) return null
      const ownership = robot.frameSources[robotFrameId]
      if (typeof ownership === 'string' && ownership.startsWith('opcua:')) {
        return robotFrames.sampleFrame(robotId, robotFrameId, renderTimestampMs)?.worldPose ?? null
      }
      const definition = definitionById.get(robot.definitionId)
      if (definition === undefined) return null
      const baseParent = resolveFrame(robot.baseParentFrameId)
      if (baseParent === null) return null
      let base = composeRigidTransformV5(baseParent, robot.localBasePose)
      const baseFrame = definition.frames.find(({ role }) => role === 'base')
      if (baseFrame !== undefined && robot.frameSources[baseFrame.id]?.startsWith('opcua:')) {
        const mappedBase = robotFrames.sampleFrame(robotId, baseFrame.id, renderTimestampMs)?.worldPose
        if (mappedBase !== null && mappedBase !== undefined) base = mappedBase
      }
      return robots.getState().readRobotPose(robotId, base).frameWorldPoses[robotFrameId] ?? null
    })

    let resolved: RigidTransformV5 | null
    try {
      if (kind === 'scene') resolved = resolveFrame(id)
      else if (kind === 'object') resolved = resolveObject(id)
      else resolved = resolveRobot(id, frameId ?? '')
    } catch {
      return null
    }
    return cycleDetected ? null : resolved
  }

  return Object.freeze({
    readRobotFrameWorldPose: (robotId: string, frameId: string) => resolve('robot', robotId, frameId),
    readSceneFrameWorldPose: (frameId: string) => resolve('scene', frameId),
    readObjectWorldPose: (objectId: string) => resolve('object', objectId),
  })
}

function createCompositeCatchupGuard(
  endpointId: string,
  atMs: number,
  graph: Pick<OwnedBrowserRuntimeGraphV5, 'robots' | 'robotFrames' | 'objects' | 'signals'>,
  onDiagnostic: (error: unknown) => void,
): EndpointCatchupGuardV5 {
  const create = [
    () => graph.robots.getState().beginEndpointCatchup(endpointId, atMs),
    () => graph.robotFrames.beginEndpointCatchup(endpointId, atMs),
    () => graph.objects.beginEndpointCatchup(endpointId, atMs),
    () => graph.signals.getState().beginEndpointCatchup(endpointId, atMs),
  ]
  const guards: EndpointCatchupGuardV5[] = []
  try {
    for (const begin of create) guards.push(begin())
  } catch (error) {
    for (const guard of guards.reverse()) runNoThrow(onDiagnostic, () => guard.abort())
    throw error
  }
  let finished = false
  const finish = (kind: 'commit' | 'abort'): void => {
    if (finished) return
    finished = true
    for (const guard of guards) runNoThrow(onDiagnostic, () => guard[kind]())
  }
  return Object.freeze({ commit: () => finish('commit'), abort: () => finish('abort') })
}

function createOwnedGraph(
  projectInput: WorkcellProjectV5,
  configRevisionInput: string,
  options: BrowserProjectRuntimeV5Options,
  onDiagnostic: (error: unknown) => void,
): OwnedBrowserRuntimeGraphV5 {
  const project = validateWorkcellProjectV5(projectInput)
  const configRevision = requireConfigRevision(configRevisionInput)
  const nowMs = options.stream.nowMs
  const robots = createRobotJointRuntimeStoreV5(project, configRevision)
  const robotFrames = createRobotFrameStatusRuntimeStoreV5(project, configRevision)
  const objects = createObjectRuntimeStateV5(project, configRevision)
  const signals = createLogicalSignalRuntimeStoreV1(project, configRevision)
  const jobs = createJobRuntimeStoreV5(project, configRevision)
  const attachments = createAttachmentRuntimeStoreV1(project, configRevision)
  const commandClientOptions: RuntimeGatewayCommandClientOptionsV1 = {
    createCommandId: options.createCommandId,
    ...(options.command.fetch === undefined ? {} : { fetch: options.command.fetch }),
    ...(options.command.basePath === undefined ? {} : { basePath: options.command.basePath }),
    ...(options.command.nowMs === undefined ? {} : { nowMs: options.command.nowMs }),
  }
  const commandClient = createRuntimeGatewayCommandClientV1(commandClientOptions)
  const signalWrites = createGatewaySignalWritePortV1({
    readActiveContext: () => Object.freeze({ project, configRevision }),
    commandClient,
  })
  const attachmentProjection = createAttachmentPoseRuntimeV1(attachments)
  const simulationObjectPoses = new Map<string, RigidTransformV5>()
  const resolver = createWorldResolver(
    project,
    robots,
    robotFrames,
    objects,
    attachmentProjection,
    createMonotonicRenderClock(nowMs),
    (objectId) => simulationObjectPoses.get(objectId) ?? null,
  )
  const attachmentPort = createBrowserAttachmentInstructionPortV1({
    readProject: () => project,
    readConfigRevision: () => configRevision,
    attachments,
    ...resolver,
  })
  const jobExecutor = createRobotJobExecutorV5({
    readProject: () => project,
    robots,
    jobs,
    signals,
    signalWrites,
    attachments: attachmentPort,
    createRunId: options.createRunId,
  })
  const playback = createRobotJobPlaybackControllerV5({
    executor: jobExecutor,
    jobs,
    scheduler: options.scheduler,
    onError: onDiagnostic,
  })
  const lifecycleTargets = Object.freeze([
    robots.getState(), robotFrames, objects, signals.getState(),
  ])
  const endpointRouter = createEndpointLifecycleRouterV5({
    readActiveContext: () => Object.freeze({ project, configRevision, gatewayId: options.gatewayId }),
    targets: lifecycleTargets,
  })

  const endpointIds = Object.freeze(project.opcUa.endpoints
    .filter((endpoint) => endpoint.enabled)
    .map((endpoint) => endpoint.endpointId))
  const graphContext = { robots, robotFrames, objects, signals }
  const logicalSignalsById = new Map(project.logicalSignals.map((signal) => [signal.id, signal]))
  let ownerActive = true
  let graphDisposed = false
  let browserLease: RuntimePublisherLeaseV1 | null = null
  const directAdvanceSettlements = new Set<Promise<void>>()
  const commandOwner = createRuntimeGatewayCommandOwnerV5({
    project,
    configRevision,
    nowMs,
    isActive: () => ownerActive,
    readLease: () => browserLease,
    simulation: {
      writeJointValues: (robotId, values) => robots.getState().writeJointValues(robotId, values, 'simulation'),
      commitObjectPose: (objectId, pose) => { simulationObjectPoses.set(objectId, pose) },
      writeLogicalSignal: (signalId, value) => {
        const definition = logicalSignalsById.get(signalId)
        const previous = signals.getState().read(signalId)
        if (definition === undefined || previous === null) throw new Error('COMMAND_TARGET_INVALID')
        const atMs = nowMs()
        const next = Object.freeze({
          ...previous,
          value: validateLogicalSignalValueV1(definition.dataType, value, '$.command.value'),
          quality: 'GOOD' as const,
          statusCode: 'Good',
          owner: 'simulation' as const,
          sourceTimestampMs: atMs,
          publishedTimestampMs: atMs,
          receivedTimestampMs: Math.max(previous.receivedTimestampMs, atMs),
        })
        signals.setState({ bySignalId: Object.freeze({ ...signals.getState().bySignalId, [signalId]: next }) })
      },
      startJob: (jobId) => { playback.startJob(jobId) },
      cancelJob: (jobId) => {
        const job = project.jobs.find((candidate) => candidate.id === jobId)
        if (job === undefined) throw new Error('COMMAND_TARGET_INVALID')
        playback.cancelRobotJob(job.robotId, 'Cancelled by Browser product command.')
      },
    },
  })
  const streamTarget: RuntimeGatewayStreamTargetV5 = Object.freeze({
    projectId: project.projectId,
    configRevision,
    gatewayId: options.gatewayId,
    browserPublisherId: `${options.gatewayId}:browser-simulation`,
    stateConsumers: Object.freeze([robots.getState(), robotFrames, objects, signals.getState()]),
    lifecycleConsumers: Object.freeze([(event: Parameters<EndpointLifecycleRouterV5['ingest']>[0], receivedTimestampMs: number) => endpointRouter.ingest(event, receivedTimestampMs)]),
    onEndpointCatchupStart: (endpointId: string, receivedTimestampMs: number) => (
      createCompositeCatchupGuard(endpointId, receivedTimestampMs, graphContext, onDiagnostic)
    ),
    onSessionStart: (receivedTimestampMs: number) => {
      const resetters: readonly (() => void)[] = [
        () => robots.getState().resetGatewaySession(receivedTimestampMs),
        () => robotFrames.resetGatewaySession(receivedTimestampMs),
        () => objects.resetGatewaySession(receivedTimestampMs),
        () => signals.getState().resetGatewaySession(receivedTimestampMs),
        () => endpointRouter.resetSocketSession(),
      ]
      for (const reset of resetters) {
        try { reset() } catch (error) { reportNoThrow(onDiagnostic, error) }
      }
    },
    onSessionDisconnect: (receivedTimestampMs: number) => {
      // The stream invokes this before aborting its active composite guard.  Marking
      // while that guard is installed makes its single abort publish the durable
      // stale result without an extra post-abort transition.
      for (const endpointId of endpointIds) {
        runNoThrow(onDiagnostic, () => robots.getState().markEndpointDisconnected(endpointId, receivedTimestampMs))
        runNoThrow(onDiagnostic, () => robotFrames.markEndpointDisconnected(endpointId, receivedTimestampMs))
        runNoThrow(onDiagnostic, () => objects.markEndpointDisconnected(endpointId, receivedTimestampMs))
        runNoThrow(onDiagnostic, () => signals.getState().markEndpointDisconnected(endpointId, receivedTimestampMs))
      }
    },
    onBrowserPublisherLease: (lease: RuntimePublisherLeaseV1 | null) => { browserLease = lease },
    onCommandBatch: (batch: import('../../../core/runtime-protocol/v1.js').CommandBatchV1) => commandOwner.execute(batch),
  })
  const requirePublishedGraphActive = (): void => {
    if (!ownerActive && !graphDisposed) throw failure('BROWSER_RUNTIME_GRAPH_INACTIVE')
  }
  const trackDirectAdvance = (advance: () => Promise<void>): Promise<void> => {
    let resolveSettlement!: () => void
    let closed = false
    const settlement = new Promise<void>((resolve) => { resolveSettlement = resolve })
    directAdvanceSettlements.add(settlement)
    const closeSettlement = (): void => {
      if (closed) return
      closed = true
      directAdvanceSettlements.delete(settlement)
      resolveSettlement()
    }
    let caller: Promise<void>
    try { caller = advance() } catch (error) {
      closeSettlement()
      return Promise.reject(error)
    }
    void caller.then(closeSettlement, closeSettlement)
    return caller
  }
  const publishedSignalWrites: GatewaySignalWritePortV1 = Object.freeze({
    writeBoolean: (signalId: string, value: boolean, signal?: AbortSignal) => {
      if (graphDisposed) return Promise.reject(failure('BROWSER_RUNTIME_GRAPH_DISPOSED'))
      if (!ownerActive) return Promise.reject(failure('BROWSER_RUNTIME_GRAPH_INACTIVE'))
      return signalWrites.writeBoolean(signalId, value, signal)
    },
  })
  const publishedJobExecutor: RobotJobExecutorV5 = Object.freeze({
    startJob: (jobId: string, simulationMs: number) => {
      requirePublishedGraphActive()
      return jobExecutor.startJob(jobId, simulationMs)
    },
    advanceRobot: (robotId: string, simulationMs: number) => {
      if (!ownerActive && !graphDisposed) return Promise.reject(failure('BROWSER_RUNTIME_GRAPH_INACTIVE'))
      return trackDirectAdvance(() => jobExecutor.advanceRobot(robotId, simulationMs))
    },
    advanceAll: (simulationMs: number) => {
      if (!ownerActive && !graphDisposed) return Promise.reject(failure('BROWSER_RUNTIME_GRAPH_INACTIVE'))
      return trackDirectAdvance(() => jobExecutor.advanceAll(simulationMs))
    },
    cancelRobotJob: (robotId: string, reason: string) => {
      requirePublishedGraphActive()
      jobExecutor.cancelRobotJob(robotId, reason)
    },
    cancelJob: (robotId?: string, reason?: string) => {
      requirePublishedGraphActive()
      jobExecutor.cancelJob(robotId, reason)
    },
    readState: (robotId: string) => jobExecutor.readState(robotId),
    waitForTerminal: (runId: string) => jobExecutor.waitForTerminal(runId),
    reset: () => {
      requirePublishedGraphActive()
      jobExecutor.reset()
    },
    shutdown: (reason?: string) => {
      requirePublishedGraphActive()
      jobExecutor.shutdown(reason)
    },
  })
  const publishedPlayback: RobotJobPlaybackControllerV5 = Object.freeze({
    startJob: (jobId: string) => {
      requirePublishedGraphActive()
      return playback.startJob(jobId)
    },
    cancelRobotJob: (robotId: string, reason: string) => {
      requirePublishedGraphActive()
      playback.cancelRobotJob(robotId, reason)
    },
    ensureRunning: () => {
      requirePublishedGraphActive()
      playback.ensureRunning()
    },
    quiesce: () => {
      if (!ownerActive && !graphDisposed) return Promise.reject(failure('BROWSER_RUNTIME_GRAPH_INACTIVE'))
      return playback.quiesce()
    },
    resume: () => {
      requirePublishedGraphActive()
      playback.resume()
    },
    dispose: () => {
      requirePublishedGraphActive()
      playback.dispose()
    },
  })
  const graph: PublishedBrowserRuntimeGraphV5 = Object.freeze({
    robots, robotFrames, signals, objects, jobs, attachments,
    signalWrites: publishedSignalWrites, jobExecutor: publishedJobExecutor, playback: publishedPlayback, streamTarget,
  })
  return {
    project, configRevision, robots, robotFrames, objects, simulationObjectPoses, signals, jobs, attachments,
    commandClient, signalWrites, jobExecutor, playback, endpointRouter, commandOwner,
    suspendForTransition: () => {
      ownerActive = false
      const directAdvances = [...directAdvanceSettlements]
      browserLease = null
      commandClient.clearLease()
      return Promise.allSettled([playback.quiesce(), ...directAdvances]).then(() => undefined)
    },
    resumeAfterTransition: () => {
      if (ownerActive) return
      browserLease = null
      commandClient.clearLease()
      ownerActive = true
      playback.resume()
    },
    deactivateCommandOwner: () => {
      ownerActive = false
      browserLease = null
    },
    streamTarget, graph,
    get disposed() { return graphDisposed },
    set disposed(value: boolean) { graphDisposed = value },
  }
}

function disposeOwnedGraph(
  graph: OwnedBrowserRuntimeGraphV5,
  onDiagnostic: (error: unknown) => void,
): void {
  if (graph.disposed) return
  graph.disposed = true
  graph.deactivateCommandOwner()
  graph.simulationObjectPoses.clear()
  runNoThrow(onDiagnostic, () => graph.playback.dispose())
  runNoThrow(onDiagnostic, () => graph.jobExecutor.requestShutdown('Browser runtime graph disposed.', onDiagnostic))
  runNoThrow(onDiagnostic, () => graph.commandClient.clearLease())
}

export function createBrowserProjectRuntimeV5(
  options: BrowserProjectRuntimeV5Options,
): BrowserProjectResourcesV5 {
  if (typeof options?.onDiagnostic !== 'function') throw new TypeError('BROWSER_RUNTIME_DIAGNOSTIC_INVALID')
  if (typeof options.createRunId !== 'function' || typeof options.createCommandId !== 'function') {
    throw new TypeError('BROWSER_RUNTIME_ID_FACTORY_INVALID')
  }
  if (options.scheduler === null || typeof options.scheduler !== 'object') throw new TypeError('BROWSER_RUNTIME_SCHEDULER_INVALID')
  assertStreamOptions(options.stream)
  if ((options.initialProject === undefined) !== (options.initialConfigRevision === undefined)) {
    throw new TypeError('BROWSER_RUNTIME_INITIAL_PUBLICATION_INVALID')
  }
  const gatewayId = requireGatewayId(options.gatewayId)
  const onDiagnostic = options.onDiagnostic
  const initialProject = options.initialProject === undefined
    ? null
    : validateWorkcellProjectV5(options.initialProject)
  const initialConfigRevision = options.initialConfigRevision === undefined
    ? null
    : requireConfigRevision(options.initialConfigRevision)
  let activeOwnedGraph = initialProject === null
    ? null
    : createOwnedGraph(initialProject, initialConfigRevision!, options, onDiagnostic)
  const bundle = createBrowserRuntimeBundleCellV5(initialProject === null
    ? null
    : {
      runtimeEpoch: 1,
      project: initialProject,
      projectRevisionId: initialProject.revisionId,
      configRevision: initialConfigRevision!,
      gatewayId,
      runtimeGraph: activeOwnedGraph!.graph,
    }, onDiagnostic) as unknown as BundlePublisherV5
  const streamOptions: RuntimeGatewayStateStreamOptionsV5 = {
    ...(options.stream.url === undefined ? {} : { url: options.stream.url }),
    ...(options.stream.location === undefined ? {} : { location: options.stream.location }),
    ...(options.stream.createWebSocket === undefined ? {} : { createWebSocket: options.stream.createWebSocket }),
    nowMs: options.stream.nowMs,
    ...(options.stream.reconnectDelayMs === undefined ? {} : { reconnectDelayMs: options.stream.reconnectDelayMs }),
    readActiveTarget: () => bundle.getState().runtimeGraph.streamTarget,
  }
  const stream = createRuntimeGatewayStateStreamV5(streamOptions)
  const candidateRecords = new WeakMap<object, CandidateRecordV5>()
  const candidates = new Set<CandidateRecordV5>()
  let ownerState: OwnerStateV5 = 'active'
  let disposePromise: Promise<void> | null = null
  let activeTransition: CommittedTransitionRecordV5 | null = null
  let activeDeactivation: DeactivationTransitionRecordV5 | null = null
  let streamRequested = false

  const assertActive = (): void => {
    if (ownerState !== 'active') throw failure('BROWSER_RUNTIME_DISPOSED')
  }
  const assertNoActiveTransition = (): void => {
    if (activeTransition !== null || activeDeactivation !== null) throw failure('BROWSER_RUNTIME_TRANSITION_PENDING')
  }
  const requireCandidate = (prepared: PreparedBrowserRuntimeCandidateV5): CandidateRecordV5 => {
    if (prepared === null || (typeof prepared !== 'object' && typeof prepared !== 'function')) {
      throw failure('BROWSER_RUNTIME_CANDIDATE_FOREIGN')
    }
    const record = candidateRecords.get(prepared as object)
    if (record === undefined || record.handle !== prepared) throw failure('BROWSER_RUNTIME_CANDIDATE_FOREIGN')
    return record
  }
  const assertNotCancelled = (record: CandidateRecordV5): void => {
    if (record.controller.signal.aborted || ownerState !== 'active') throw abortFailure()
  }
  const consumeAndDispose = (record: CandidateRecordV5): void => {
    if (record.state === 'consumed') return
    record.state = 'consumed'
    candidates.delete(record)
    disposeOwnedGraph(record.owned, onDiagnostic)
  }
  const rollbackCommittedTransition = (
    transition: CommittedTransitionRecordV5,
  ): Promise<void> => {
    if (transition.rollbackPromise !== null) return transition.rollbackPromise
    if (transition.state !== 'committed') return Promise.reject(failure('BROWSER_RUNTIME_TRANSITION_CONSUMED'))
    transition.state = 'rolling-back'
    const rollback = Promise.resolve().then(() => {
      if (ownerState !== 'active' || activeTransition !== transition || activeOwnedGraph !== transition.candidate.owned) {
        throw failure('BROWSER_RUNTIME_TRANSITION_STALE')
      }
      stream.stop()
      transition.install.restorePure()
      activeOwnedGraph = transition.previousOwned
      disposeOwnedGraph(transition.candidate.owned, onDiagnostic)
      if (transition.previousOwned !== null) {
        transition.previousOwned.resumeAfterTransition()
        if (streamRequested) stream.start()
      }
      transition.candidate.state = 'consumed'
      activeTransition = null
      transition.state = 'rolled-back'
      runNoThrow(onDiagnostic, () => transition.install.flushRollbackNotifications())
    })
    transition.rollbackPromise = rollback
    return rollback
  }
  const finalizeCommittedTransition = (
    transition: CommittedTransitionRecordV5,
  ): Promise<void> => {
    if (transition.finalizePromise !== null) return transition.finalizePromise
    if (transition.state !== 'committed') return Promise.reject(failure('BROWSER_RUNTIME_TRANSITION_CONSUMED'))
    transition.state = 'finalizing'
    const finalize = Promise.resolve().then(() => {
      if (ownerState !== 'active' || activeTransition !== transition || activeOwnedGraph !== transition.candidate.owned) {
        throw failure('BROWSER_RUNTIME_TRANSITION_STALE')
      }
      if (transition.previousOwned !== null) disposeOwnedGraph(transition.previousOwned, onDiagnostic)
      transition.candidate.state = 'consumed'
      activeTransition = null
      transition.state = 'finalized'
    })
    transition.finalizePromise = finalize
    return finalize
  }
  const rollbackDeactivation = (transition: DeactivationTransitionRecordV5): Promise<void> => {
    if (transition.rollbackPromise !== null) return transition.rollbackPromise
    if (transition.state !== 'committed') return Promise.reject(failure('BROWSER_RUNTIME_TRANSITION_CONSUMED'))
    transition.state = 'rolling-back'
    const rollback = Promise.resolve().then(() => {
      if (ownerState !== 'active' || activeDeactivation !== transition || activeOwnedGraph !== null) {
        throw failure('BROWSER_RUNTIME_TRANSITION_STALE')
      }
      transition.install.restorePure()
      activeOwnedGraph = transition.previousOwned
      transition.previousOwned.resumeAfterTransition()
      if (streamRequested) stream.start()
      activeDeactivation = null
      transition.state = 'rolled-back'
      runNoThrow(onDiagnostic, () => transition.install.flushRollbackNotifications())
    })
    transition.rollbackPromise = rollback
    return rollback
  }
  const finalizeDeactivation = (transition: DeactivationTransitionRecordV5): Promise<void> => {
    if (transition.finalizePromise !== null) return transition.finalizePromise
    if (transition.state !== 'committed') return Promise.reject(failure('BROWSER_RUNTIME_TRANSITION_CONSUMED'))
    transition.state = 'finalizing'
    const finalize = Promise.resolve().then(() => {
      if (ownerState !== 'active' || activeDeactivation !== transition || activeOwnedGraph !== null) {
        throw failure('BROWSER_RUNTIME_TRANSITION_STALE')
      }
      disposeOwnedGraph(transition.previousOwned, onDiagnostic)
      activeDeactivation = null
      transition.state = 'finalized'
    })
    transition.finalizePromise = finalize
    return finalize
  }
  const runApply = async (record: CandidateRecordV5): Promise<void> => {
    try {
      for (const step of APPLY_STEPS) {
        assertNotCancelled(record)
        await options.testHooks?.detachedApplyGate?.(step, record.controller.signal)
        assertNotCancelled(record)
        if (step === 'robots') record.owned.robots.getState().replaceProject(record.project, record.configRevision)
        else if (step === 'frames') record.owned.robotFrames.replaceProject(record.project, record.configRevision)
        else if (step === 'objects') record.owned.objects.replaceProject(record.project, record.configRevision)
        else if (step === 'signals') record.owned.signals.getState().replaceProject(record.project, record.configRevision)
        else if (step === 'jobs') record.owned.jobs.getState().reset(record.project, record.configRevision)
        else record.owned.attachments.getState().reset(record.project, record.configRevision)
        assertNotCancelled(record)
        options.testHooks?.afterDetachedApplyStep?.(step, record.owned.graph)
        assertNotCancelled(record)
        if (options.testHooks?.failApplyAfter === step) throw new Error('TEST_APPLY_FAILURE')
      }
      assertNotCancelled(record)
      record.state = 'applied'
    } catch (error) {
      if (record.state === 'applying') record.state = 'failed'
      throw error
    }
  }

  const resources: BrowserProjectResourcesV5 = Object.freeze({
    bundle,
    readActiveBundle() {
      return bundle.readActiveState()
    },
    async prepare(projectCandidate: WorkcellProjectV5, candidateConfigRevision: string) {
      assertActive()
      const candidateProject = validateWorkcellProjectV5(projectCandidate)
      const candidateConfig = requireConfigRevision(candidateConfigRevision)
      const baseBundle = bundle.readActiveState()
      const baseGeneration = bundle.readGeneration()
      if (baseGeneration >= Number.MAX_SAFE_INTEGER - 1) throw new TypeError('RUNTIME_EPOCH_EXHAUSTED')
      const owned = createOwnedGraph(candidateProject, candidateConfig, options, onDiagnostic)
      const handle = Object.freeze({
        projectRevisionId: candidateProject.revisionId,
        configRevision: candidateConfig,
      })
      const record: CandidateRecordV5 = {
        handle, project: candidateProject, configRevision: candidateConfig,
        baseBundle, baseGeneration, owned,
        controller: new AbortController(), state: 'prepared', applyPromise: null, rollbackPromise: null,
        commitPromise: null,
      }
      candidateRecords.set(handle, record)
      candidates.add(record)
      return handle
    },
    apply(prepared: PreparedBrowserRuntimeCandidateV5) {
      try {
        assertActive()
        const record = requireCandidate(prepared)
        if (record.state === 'consumed') return Promise.reject(failure('BROWSER_RUNTIME_CANDIDATE_CONSUMED'))
        if (record.state === 'applying' || record.state === 'committing') return Promise.reject(failure('BROWSER_RUNTIME_CANDIDATE_BUSY'))
        if (record.state === 'applied') return Promise.reject(failure('BROWSER_RUNTIME_CANDIDATE_BUSY'))
        if (record.state === 'failed') return Promise.reject(failure('BROWSER_RUNTIME_CANDIDATE_APPLY_FAILED'))
        record.state = 'applying'
        // Record the shared Promise before test hooks or gates can re-enter
        // rollback.  A gate may synchronously request cancellation.
        const running = Promise.resolve().then(() => runApply(record))
        record.applyPromise = running
        return running
      } catch (error) {
        return Promise.reject(error)
      }
    },
    commit(prepared: PreparedBrowserRuntimeCandidateV5) {
      try {
        assertActive()
        const record = requireCandidate(prepared)
        if (record.state === 'consumed') throw failure('BROWSER_RUNTIME_CANDIDATE_CONSUMED')
        if (record.state === 'applying' || record.state === 'committing') throw failure('BROWSER_RUNTIME_CANDIDATE_BUSY')
        if (record.state === 'prepared') throw failure('BROWSER_RUNTIME_CANDIDATE_NOT_APPLIED')
        if (record.state === 'failed') throw failure('BROWSER_RUNTIME_CANDIDATE_APPLY_FAILED')
        const initialBundle = bundle.readActiveState()
        if (
          initialBundle !== record.baseBundle
          || bundle.readGeneration() !== record.baseGeneration
        ) {
          consumeAndDispose(record)
          throw failure('BROWSER_RUNTIME_CANDIDATE_STALE')
        }
        assertNoActiveTransition()
        const previousOwned = activeOwnedGraph
        record.state = 'committing'
        const committing = (async (): Promise<CommittedBrowserRuntimeTransitionV5> => {
          let previousSuspended = false
          try {
            if (previousOwned !== null) {
              const quiesced = previousOwned.suspendForTransition()
              previousSuspended = true
              if (streamRequested) stream.stop()
              await quiesced
            }
            if (ownerState !== 'active' || activeOwnedGraph !== previousOwned) {
              throw failure('BROWSER_RUNTIME_CANDIDATE_STALE')
            }
            const currentBundle = bundle.readActiveState()
            if (
              currentBundle !== record.baseBundle
              || bundle.readGeneration() !== record.baseGeneration
            ) {
              throw failure('BROWSER_RUNTIME_CANDIDATE_STALE')
            }
            const next: BrowserRuntimeBundleStateV5 = Object.freeze({
              runtimeEpoch: record.baseGeneration + 1,
              project: record.project,
              projectRevisionId: record.project.revisionId,
              configRevision: record.configRevision,
              gatewayId,
              runtimeGraph: record.owned.graph,
            })
            const install = bundle.prepareInstall(next, currentBundle, record.baseGeneration)
            const transition: CommittedTransitionRecordV5 = {
              candidate: record,
              install,
              previousOwned,
              state: 'committed',
              rollbackPromise: null,
              finalizePromise: null,
            }
            record.state = 'committed'
            candidates.delete(record)
            install.installPure()
            activeOwnedGraph = record.owned
            activeTransition = transition
            runNoThrow(onDiagnostic, () => record.owned.commandClient.clearLease())
            if (streamRequested) stream.start()
            runNoThrow(onDiagnostic, () => install.flushIsolatedNotifications())
            return Object.freeze({
              rollback: () => rollbackCommittedTransition(transition),
              finalize: () => finalizeCommittedTransition(transition),
            })
          } catch (error) {
            if (record.state === 'committing') record.state = 'applied'
            if (previousSuspended && previousOwned !== null && ownerState === 'active' && activeOwnedGraph === previousOwned) {
              previousOwned.resumeAfterTransition()
              if (streamRequested) stream.start()
            }
            throw error
          }
        })()
        record.commitPromise = committing
        return committing
      } catch (error) {
        return Promise.reject(error)
      }
    },
    rollback(prepared: PreparedBrowserRuntimeCandidateV5) {
      try {
        assertActive()
        const record = requireCandidate(prepared)
        if (record.state === 'consumed') return Promise.reject(failure('BROWSER_RUNTIME_CANDIDATE_CONSUMED'))
        if (record.state === 'committed') return Promise.reject(failure('BROWSER_RUNTIME_CANDIDATE_COMMITTED'))
        if (record.state === 'committing') return Promise.reject(failure('BROWSER_RUNTIME_CANDIDATE_BUSY'))
        if (record.rollbackPromise !== null) return record.rollbackPromise
        let resolveRollback!: () => void
        let rejectRollback!: (reason: unknown) => void
        const rollback = new Promise<void>((resolve, reject) => {
          resolveRollback = resolve
          rejectRollback = reject
        })
        record.rollbackPromise = rollback
        void (async (): Promise<void> => {
          try {
            if (record.state === 'applying') {
              record.controller.abort()
              await record.applyPromise?.catch(() => undefined)
            }
            consumeAndDispose(record)
            resolveRollback()
          } catch (error) {
            rejectRollback(error)
          }
        })()
        return rollback
      } catch (error) {
        return Promise.reject(error)
      }
    },
    async deactivate() {
      assertActive()
      assertNoActiveTransition()
      const previousOwned = activeOwnedGraph
      const currentBundle = bundle.readActiveState()
      if (previousOwned === null || currentBundle === null) {
        if (previousOwned !== null || currentBundle !== null) throw failure('BROWSER_RUNTIME_AUTHORITY_MISMATCH')
        return Object.freeze({ rollback: async () => undefined, finalize: async () => undefined })
      }
      let suspended = false
      try {
        const quiesced = previousOwned.suspendForTransition()
        suspended = true
        if (streamRequested) stream.stop()
        await quiesced
        if (ownerState !== 'active' || activeOwnedGraph !== previousOwned || bundle.readActiveState() !== currentBundle) {
          throw failure('BROWSER_RUNTIME_TRANSITION_STALE')
        }
        const install = bundle.prepareInstall(null, currentBundle, bundle.readGeneration())
        const transition: DeactivationTransitionRecordV5 = {
          install, previousOwned, state: 'committed', rollbackPromise: null, finalizePromise: null,
        }
        install.installPure()
        activeOwnedGraph = null
        activeDeactivation = transition
        runNoThrow(onDiagnostic, () => install.flushIsolatedNotifications())
        return Object.freeze({
          rollback: () => rollbackDeactivation(transition),
          finalize: () => finalizeDeactivation(transition),
        })
      } catch (error) {
        if (suspended && ownerState === 'active' && activeOwnedGraph === previousOwned) {
          previousOwned.resumeAfterTransition()
          if (streamRequested) stream.start()
        }
        throw error
      }
    },
    startGatewayStream() {
      assertActive()
      if (activeOwnedGraph === null) throw failure('BROWSER_RUNTIME_EMPTY')
      streamRequested = true
      stream.start()
      if (ownerState !== 'active') stream.stop()
    },
    stopGatewayStream() {
      if (ownerState !== 'active') return
      streamRequested = false
      stream.stop()
    },
    dispose() {
      if (disposePromise !== null) return disposePromise
      ownerState = 'disposing'
      streamRequested = false
      let resolve!: () => void
      disposePromise = new Promise<void>((done) => { resolve = done })
      runNoThrow(onDiagnostic, () => stream.stop())
      const snapshot = Array.from(candidates)
      const transition = activeTransition
      if (transition !== null) {
        activeTransition = null
        transition.state = 'disposed'
        transition.candidate.state = 'consumed'
      }
      const deactivation = activeDeactivation
      if (deactivation !== null) {
        activeDeactivation = null
        deactivation.state = 'disposed'
      }
      for (const record of snapshot) {
        if (record.state === 'applying') runNoThrow(onDiagnostic, () => record.controller.abort())
      }
      void (async () => {
        try {
          await Promise.allSettled(snapshot.flatMap((record) => [record.applyPromise, record.rollbackPromise, record.commitPromise]
            .filter((promise) => promise !== null)))
          for (const record of snapshot) consumeAndDispose(record)
          if (transition !== null && transition.previousOwned !== null) {
            disposeOwnedGraph(transition.previousOwned, onDiagnostic)
          }
          if (deactivation !== null) disposeOwnedGraph(deactivation.previousOwned, onDiagnostic)
          if (activeOwnedGraph !== null) disposeOwnedGraph(activeOwnedGraph, onDiagnostic)
        } finally {
          ownerState = 'disposed'
          resolve()
        }
      })()
      return disposePromise
    },
  })
  return resources
}
