import {
  validateWorkcellProjectV5,
  type WorkcellProjectV5,
} from '../../../core/project-v5/index.js'
import type { StoreApi } from 'zustand/vanilla'
import type { AttachmentRuntimeStoreV1 } from '../../actions/v5/attachment-runtime-store.js'
import type { RobotJobExecutorV5 } from '../../jobs/v5/job-executor.js'
import type { JobRuntimeStoreV5 } from '../../jobs/v5/job-runtime-store.js'
import type { RobotJobPlaybackControllerV5 } from '../../jobs/v5/simulation-clock.js'
import type { RobotFrameStatusRuntimeStoreV5 } from '../../robot/v5/robot-frame-status-runtime-store.js'
import type { RobotJointRuntimeStoreV5 } from '../../robot/v5/robot-joint-runtime-store.js'
import type { GatewaySignalWritePortV1 } from '../../runtime-gateway/v5/runtime-gateway-command-client.js'
import type { RuntimeGatewayStreamTargetV5 } from '../../runtime-gateway/v5/runtime-gateway-state-stream.js'
import type { ObjectRuntimeStateV5 } from '../../scene/v5/object-runtime-state.js'
import type { LogicalSignalRuntimeStoreV1 } from '../../signals/v5/logical-signal-runtime-store.js'

export interface PublishedBrowserRuntimeGraphV5 {
  readonly robots: StoreApi<RobotJointRuntimeStoreV5>
  readonly robotFrames: RobotFrameStatusRuntimeStoreV5
  readonly signals: StoreApi<LogicalSignalRuntimeStoreV1>
  readonly objects: ObjectRuntimeStateV5
  readonly jobs: StoreApi<JobRuntimeStoreV5>
  readonly attachments: StoreApi<AttachmentRuntimeStoreV1>
  readonly signalWrites: GatewaySignalWritePortV1
  readonly jobExecutor: RobotJobExecutorV5
  readonly playback: RobotJobPlaybackControllerV5
  readonly streamTarget: RuntimeGatewayStreamTargetV5
}

export interface BrowserRuntimeBundleStateV5 {
  readonly runtimeEpoch: number
  readonly project: WorkcellProjectV5
  readonly projectRevisionId: string
  readonly configRevision: string
  readonly gatewayId: string
  readonly runtimeGraph: PublishedBrowserRuntimeGraphV5
}

export interface BrowserRuntimeBundleCellV5 {
  getState(): BrowserRuntimeBundleStateV5
  subscribe(listener: () => void): () => void
}

type BundleListenerV5 = () => void
type DiagnosticListenerV5 = (error: unknown) => void
type InstallPhaseV5 = 'prepared' | 'installed' | 'flushed' | 'rejected'

interface BrowserRuntimeBundleInstallTokenV5 {
  readonly previousRuntimeGraph: PublishedBrowserRuntimeGraphV5
  installPure(): void
  flushIsolatedNotifications(): void
}

interface BrowserRuntimeBundlePublisherCellV5 extends BrowserRuntimeBundleCellV5 {
  prepareInstall(
    next: BrowserRuntimeBundleStateV5,
    expectedBaseBundle: BrowserRuntimeBundleStateV5,
    expectedEpoch: number,
  ): BrowserRuntimeBundleInstallTokenV5
}

interface InstallOwnerV5 {
  readonly ownerId: symbol
}

interface InstallRecordV5 {
  readonly owner: InstallOwnerV5
  readonly base: BrowserRuntimeBundleStateV5
  readonly expectedEpoch: number
  readonly next: BrowserRuntimeBundleStateV5
  readonly listeners: readonly BundleListenerV5[]
  phase: InstallPhaseV5
}

const CONFIG_REVISION_PATTERN = /^[0-9a-f]{64}$/u
const installRecords = new WeakMap<object, InstallRecordV5>()
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

const JOB_EXECUTOR_METHODS = [
  'startJob',
  'advanceRobot',
  'advanceAll',
  'cancelRobotJob',
  'cancelJob',
  'readState',
  'waitForTerminal',
  'reset',
  'shutdown',
] as const
const PLAYBACK_METHODS = [
  'startJob',
  'cancelRobotJob',
  'ensureRunning',
  'quiesce',
  'resume',
  'dispose',
] as const

function fail(code: string, message: string): never {
  throw new TypeError(`${code}: ${message}`)
}

function requireEpoch(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
    fail('RUNTIME_EPOCH_INVALID', 'Runtime Epoch must be a positive safe integer.')
  }
  return value
}

function requireConfigRevision(value: unknown): string {
  if (typeof value !== 'string' || !CONFIG_REVISION_PATTERN.test(value)) {
    fail('CONFIG_REVISION_INVALID', 'Config Revision must be a lowercase 64-character hexadecimal digest.')
  }
  return value
}

function requireGatewayId(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0) {
    fail('GATEWAY_ID_INVALID', 'Gateway ID must be a non-empty string.')
  }
  return value
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object'
}

type CapturedMethodV5 = (...args: unknown[]) => unknown

function readField(
  record: Record<string, unknown>,
  key: string,
  code: string,
): unknown {
  try {
    return record[key]
  } catch {
    fail(code, `Runtime graph field ${key} could not be read.`)
  }
}

function readOwnDataField(
  record: Record<string, unknown>,
  key: string,
  code: string,
): unknown {
  let descriptor: PropertyDescriptor | undefined
  try {
    descriptor = Object.getOwnPropertyDescriptor(record, key)
  } catch {
    fail(code, `Runtime graph field ${key} is invalid.`)
  }
  if (descriptor === undefined || !('value' in descriptor)) {
    fail(code, `Runtime graph field ${key} must be an own data property.`)
  }
  return descriptor.value
}

function captureBoundDataMethods(
  code: string,
  ownerInput: unknown,
  methods: readonly string[],
): Readonly<Record<string, CapturedMethodV5>> {
  if (!isRecord(ownerInput)) {
    fail(code, 'Runtime graph service is missing or invalid.')
  }
  const captured: Record<string, CapturedMethodV5> = Object.create(null) as Record<string, CapturedMethodV5>
  for (const method of methods) {
    const candidate = readOwnDataField(ownerInput, method, code)
    if (typeof candidate !== 'function') {
      fail(code, `Runtime graph service method ${method} is missing or invalid.`)
    }
    captured[method] = (...args: unknown[]): unknown => Reflect.apply(candidate, ownerInput, args)
  }
  return Object.freeze(captured)
}

function canonicalMethodService<T>(
  code: string,
  input: unknown,
  methods: readonly string[],
): T {
  return captureBoundDataMethods(code, input, methods) as unknown as T
}

function requireRuntimeDataRecords(
  code: string,
  state: Record<string, unknown>,
  properties: readonly string[],
): void {
  for (const property of properties) {
    const value = readOwnDataField(state, property, code)
    if (!isRecord(value) || Array.isArray(value)) {
      fail(code, `Runtime graph state field ${property} is missing or invalid.`)
    }
  }
}

function alignedRuntimeSurface(
  invalidCode: string,
  misalignedCode: string,
  surface: unknown,
  projectRevisionId: string,
  configRevision: string,
): Readonly<{ projectRevisionId: string | null; configRevision: string | null }> {
  if (!isRecord(surface)) {
    fail(invalidCode, 'Runtime graph surface is missing or invalid.')
  }
  const surfaceProjectRevision = readField(surface, 'projectRevisionId', invalidCode)
  const surfaceConfigRevision = readField(surface, 'configRevision', invalidCode)
  if (
    !(surfaceProjectRevision === null || typeof surfaceProjectRevision === 'string')
    || !(surfaceConfigRevision === null || typeof surfaceConfigRevision === 'string')
  ) {
    fail(invalidCode, 'Runtime graph surface Revision fields are invalid.')
  }
  if (surfaceProjectRevision !== projectRevisionId || surfaceConfigRevision !== configRevision) {
    fail(misalignedCode, 'Runtime graph surface does not match the Bundle Project/configuration revision.')
  }
  return Object.freeze({
    projectRevisionId: surfaceProjectRevision,
    configRevision: surfaceConfigRevision,
  })
}

function canonicalRuntimeStore<TState>(
  invalidCode: string,
  misalignedCode: string,
  storeInput: unknown,
  stateMethods: readonly string[],
  stateRecordProperties: readonly string[],
  projectRevisionId: string,
  configRevision: string,
): StoreApi<TState> {
  const api = captureBoundDataMethods(invalidCode, storeInput, STORE_API_METHODS)
  let currentState: unknown
  try {
    currentState = api.getState!()
  } catch {
    fail(invalidCode, 'Runtime graph Store state could not be read.')
  }
  if (!isRecord(currentState)) {
    fail(invalidCode, 'Runtime graph surface is missing or invalid.')
  }
  alignedRuntimeSurface(invalidCode, misalignedCode, currentState, projectRevisionId, configRevision)
  captureBoundDataMethods(invalidCode, currentState, stateMethods)
  requireRuntimeDataRecords(invalidCode, currentState, stateRecordProperties)
  return api as unknown as StoreApi<TState>
}

function canonicalDirectRuntime<T>(
  invalidCode: string,
  misalignedCode: string,
  input: unknown,
  methods: readonly string[],
  projectRevisionId: string,
  configRevision: string,
): T {
  if (!isRecord(input)) {
    fail(invalidCode, 'Runtime graph surface is missing or invalid.')
  }
  const aligned = alignedRuntimeSurface(
    invalidCode,
    misalignedCode,
    input,
    projectRevisionId,
    configRevision,
  )
  const captured = captureBoundDataMethods(invalidCode, input, methods)
  let lastProjectRevisionId = aligned.projectRevisionId
  let lastConfigRevision = aligned.configRevision
  const wrapper = Object.assign({}, captured) as Record<string, unknown>
  const capturedReplaceProject = captured.replaceProject
  if (capturedReplaceProject !== undefined) {
    wrapper.replaceProject = (...args: unknown[]): unknown => {
      const nextProject = validateWorkcellProjectV5(args[0])
      const nextConfigRevision = requireConfigRevision(args[1])
      const result = capturedReplaceProject(nextProject, nextConfigRevision, ...args.slice(2))
      lastProjectRevisionId = nextProject.revisionId
      lastConfigRevision = nextConfigRevision
      return result
    }
  }
  Object.defineProperties(wrapper, {
    projectRevisionId: {
      enumerable: true,
      get: () => lastProjectRevisionId,
    },
    configRevision: {
      enumerable: true,
      get: () => lastConfigRevision,
    },
  })
  return Object.freeze(wrapper) as unknown as T
}

function canonicalStreamTarget(
  target: unknown,
  project: WorkcellProjectV5,
  configRevision: string,
  gatewayId: string,
): RuntimeGatewayStreamTargetV5 {
  if (!isRecord(target)) {
    fail('RUNTIME_GRAPH_STREAM_TARGET_INVALID', 'Runtime stream target is incomplete.')
  }
  const snapshot = {
    projectId: readField(target, 'projectId', 'RUNTIME_GRAPH_STREAM_TARGET_INVALID'),
    configRevision: readField(target, 'configRevision', 'RUNTIME_GRAPH_STREAM_TARGET_INVALID'),
    gatewayId: readField(target, 'gatewayId', 'RUNTIME_GRAPH_STREAM_TARGET_INVALID'),
    stateConsumers: readField(target, 'stateConsumers', 'RUNTIME_GRAPH_STREAM_TARGET_INVALID'),
    lifecycleConsumers: readField(target, 'lifecycleConsumers', 'RUNTIME_GRAPH_STREAM_TARGET_INVALID'),
    onEndpointCatchupStart: readField(target, 'onEndpointCatchupStart', 'RUNTIME_GRAPH_STREAM_TARGET_INVALID'),
    onSessionStart: readField(target, 'onSessionStart', 'RUNTIME_GRAPH_STREAM_TARGET_INVALID'),
    onSessionDisconnect: readField(target, 'onSessionDisconnect', 'RUNTIME_GRAPH_STREAM_TARGET_INVALID'),
  }
  if (
    typeof snapshot.projectId !== 'string'
    || typeof snapshot.configRevision !== 'string'
    || typeof snapshot.gatewayId !== 'string'
    || !Array.isArray(snapshot.stateConsumers)
    || !Array.isArray(snapshot.lifecycleConsumers)
    || typeof snapshot.onEndpointCatchupStart !== 'function'
    || (snapshot.onSessionStart !== undefined && typeof snapshot.onSessionStart !== 'function')
    || (snapshot.onSessionDisconnect !== undefined && typeof snapshot.onSessionDisconnect !== 'function')
  ) {
    fail('RUNTIME_GRAPH_STREAM_TARGET_INVALID', 'Runtime stream target is incomplete.')
  }
  if (
    snapshot.projectId !== project.projectId
    || snapshot.configRevision !== configRevision
    || snapshot.gatewayId !== gatewayId
  ) {
    fail(
      'RUNTIME_GRAPH_STREAM_TARGET_MISALIGNED',
      'Runtime stream target does not match the Bundle Project/configuration/Gateway identity.',
    )
  }
  const stateConsumerInputs = Array.from(snapshot.stateConsumers)
  const lifecycleConsumerInputs = Array.from(snapshot.lifecycleConsumers)
  const stateConsumers = Object.freeze(stateConsumerInputs.map((consumer) => (
    canonicalMethodService<RuntimeGatewayStreamTargetV5['stateConsumers'][number]>(
      'RUNTIME_GRAPH_STREAM_TARGET_INVALID',
      consumer,
      ['ingest', 'restoreReplayPrefix'],
    )
  )))
  for (const consumer of lifecycleConsumerInputs) {
    if (typeof consumer !== 'function') {
      fail('RUNTIME_GRAPH_STREAM_TARGET_INVALID', 'Runtime stream target is incomplete.')
    }
  }
  const lifecycleConsumers = Object.freeze(lifecycleConsumerInputs) as RuntimeGatewayStreamTargetV5['lifecycleConsumers']
  const catchupCallback = snapshot.onEndpointCatchupStart as RuntimeGatewayStreamTargetV5['onEndpointCatchupStart']
  const sessionStartCallback = snapshot.onSessionStart as RuntimeGatewayStreamTargetV5['onSessionStart']
  const sessionDisconnectCallback = snapshot.onSessionDisconnect as RuntimeGatewayStreamTargetV5['onSessionDisconnect']
  const onEndpointCatchupStart: RuntimeGatewayStreamTargetV5['onEndpointCatchupStart'] = (
    endpointId,
    receivedTimestampMs,
  ) => Reflect.apply(catchupCallback, target, [endpointId, receivedTimestampMs])
  const onSessionStart: RuntimeGatewayStreamTargetV5['onSessionStart'] = sessionStartCallback === undefined
    ? undefined
    : (receivedTimestampMs) => { Reflect.apply(sessionStartCallback, target, [receivedTimestampMs]) }
  const onSessionDisconnect: RuntimeGatewayStreamTargetV5['onSessionDisconnect'] = sessionDisconnectCallback === undefined
    ? undefined
    : (receivedTimestampMs) => { Reflect.apply(sessionDisconnectCallback, target, [receivedTimestampMs]) }
  return Object.freeze({
    projectId: snapshot.projectId,
    configRevision: snapshot.configRevision,
    gatewayId: snapshot.gatewayId,
    stateConsumers,
    lifecycleConsumers,
    onEndpointCatchupStart,
    ...(onSessionStart === undefined ? {} : { onSessionStart }),
    ...(onSessionDisconnect === undefined ? {} : { onSessionDisconnect }),
  })
}

function canonicalRuntimeGraph(
  input: unknown,
  project: WorkcellProjectV5,
  configRevision: string,
  gatewayId: string,
): PublishedBrowserRuntimeGraphV5 {
  if (!isRecord(input)) {
    fail('RUNTIME_GRAPH_INVALID', 'Runtime graph is required.')
  }
  const snapshot = {
    robots: readField(input, 'robots', 'RUNTIME_GRAPH_INVALID'),
    robotFrames: readField(input, 'robotFrames', 'RUNTIME_GRAPH_INVALID'),
    signals: readField(input, 'signals', 'RUNTIME_GRAPH_INVALID'),
    objects: readField(input, 'objects', 'RUNTIME_GRAPH_INVALID'),
    jobs: readField(input, 'jobs', 'RUNTIME_GRAPH_INVALID'),
    attachments: readField(input, 'attachments', 'RUNTIME_GRAPH_INVALID'),
    signalWrites: readField(input, 'signalWrites', 'RUNTIME_GRAPH_INVALID'),
    jobExecutor: readField(input, 'jobExecutor', 'RUNTIME_GRAPH_INVALID'),
    playback: readField(input, 'playback', 'RUNTIME_GRAPH_INVALID'),
    streamTarget: readField(input, 'streamTarget', 'RUNTIME_GRAPH_INVALID'),
  }
  const robots = canonicalRuntimeStore<RobotJointRuntimeStoreV5>(
    'RUNTIME_GRAPH_ROBOTS_INVALID',
    'RUNTIME_GRAPH_ROBOTS_MISALIGNED',
    snapshot.robots,
    ROBOT_RUNTIME_METHODS,
    ['byRobotId'],
    project.revisionId,
    configRevision,
  )
  const robotFrames = canonicalDirectRuntime<RobotFrameStatusRuntimeStoreV5>(
    'RUNTIME_GRAPH_ROBOT_FRAMES_INVALID',
    'RUNTIME_GRAPH_ROBOT_FRAMES_MISALIGNED',
    snapshot.robotFrames,
    FRAME_RUNTIME_METHODS,
    project.revisionId,
    configRevision,
  )
  const signals = canonicalRuntimeStore<LogicalSignalRuntimeStoreV1>(
    'RUNTIME_GRAPH_SIGNALS_INVALID',
    'RUNTIME_GRAPH_SIGNALS_MISALIGNED',
    snapshot.signals,
    SIGNAL_RUNTIME_METHODS,
    ['bySignalId'],
    project.revisionId,
    configRevision,
  )
  const objects = canonicalDirectRuntime<ObjectRuntimeStateV5>(
    'RUNTIME_GRAPH_OBJECTS_INVALID',
    'RUNTIME_GRAPH_OBJECTS_MISALIGNED',
    snapshot.objects,
    FRAME_RUNTIME_METHODS,
    project.revisionId,
    configRevision,
  )
  const jobs = canonicalRuntimeStore<JobRuntimeStoreV5>(
    'RUNTIME_GRAPH_JOBS_INVALID',
    'RUNTIME_GRAPH_JOBS_MISALIGNED',
    snapshot.jobs,
    JOB_RUNTIME_METHODS,
    ['byRobotId'],
    project.revisionId,
    configRevision,
  )
  const attachments = canonicalRuntimeStore<AttachmentRuntimeStoreV1>(
    'RUNTIME_GRAPH_ATTACHMENTS_INVALID',
    'RUNTIME_GRAPH_ATTACHMENTS_MISALIGNED',
    snapshot.attachments,
    ATTACHMENT_RUNTIME_METHODS,
    ['attachmentsByObjectId', 'detachedOverridesByObjectId'],
    project.revisionId,
    configRevision,
  )
  const signalWrites = canonicalMethodService<GatewaySignalWritePortV1>(
    'RUNTIME_GRAPH_SIGNAL_WRITES_INVALID',
    snapshot.signalWrites,
    ['writeBoolean'],
  )
  const jobExecutor = canonicalMethodService<RobotJobExecutorV5>(
    'RUNTIME_GRAPH_JOB_EXECUTOR_INVALID',
    snapshot.jobExecutor,
    JOB_EXECUTOR_METHODS,
  )
  const playback = canonicalMethodService<RobotJobPlaybackControllerV5>(
    'RUNTIME_GRAPH_PLAYBACK_INVALID',
    snapshot.playback,
    PLAYBACK_METHODS,
  )
  const streamTarget = canonicalStreamTarget(snapshot.streamTarget, project, configRevision, gatewayId)
  return Object.freeze({
    robots,
    robotFrames,
    signals,
    objects,
    jobs,
    attachments,
    signalWrites,
    jobExecutor,
    playback,
    streamTarget,
  })
}

function canonicalBundleState(
  input: BrowserRuntimeBundleStateV5,
  expectedRuntimeEpoch?: number,
): BrowserRuntimeBundleStateV5 {
  if (!isRecord(input)) {
    fail('RUNTIME_BUNDLE_INVALID', 'Runtime Bundle is required.')
  }
  const snapshot = {
    runtimeEpoch: readField(input, 'runtimeEpoch', 'RUNTIME_BUNDLE_INVALID'),
    project: readField(input, 'project', 'RUNTIME_BUNDLE_INVALID'),
    projectRevisionId: readField(input, 'projectRevisionId', 'RUNTIME_BUNDLE_INVALID'),
    configRevision: readField(input, 'configRevision', 'RUNTIME_BUNDLE_INVALID'),
    gatewayId: readField(input, 'gatewayId', 'RUNTIME_BUNDLE_INVALID'),
    runtimeGraph: readField(input, 'runtimeGraph', 'RUNTIME_BUNDLE_INVALID'),
  }
  const runtimeEpoch = requireEpoch(snapshot.runtimeEpoch)
  if (expectedRuntimeEpoch !== undefined && runtimeEpoch !== expectedRuntimeEpoch) {
    fail('RUNTIME_EPOCH_INCREMENT_INVALID', 'Next Runtime Epoch must increment the active Epoch by one.')
  }
  const project = validateWorkcellProjectV5(snapshot.project as WorkcellProjectV5)
  if (snapshot.projectRevisionId !== project.revisionId) {
    fail('PROJECT_REVISION_MISALIGNED', 'Bundle Project Revision does not match its validated Project.')
  }
  const configRevision = requireConfigRevision(snapshot.configRevision)
  const gatewayId = requireGatewayId(snapshot.gatewayId)
  const runtimeGraph = canonicalRuntimeGraph(snapshot.runtimeGraph, project, configRevision, gatewayId)

  return Object.freeze({
    runtimeEpoch,
    project,
    projectRevisionId: project.revisionId,
    configRevision,
    gatewayId,
    runtimeGraph,
  })
}

function diagnosticNoThrow(onDiagnostic: DiagnosticListenerV5, error: unknown): void {
  try {
    onDiagnostic(error)
  } catch {
    // Diagnostics are observational and may not break publication or later listeners.
  }
}

export function createBrowserRuntimeBundleCellV5(
  initial: BrowserRuntimeBundleStateV5,
  onDiagnostic: DiagnosticListenerV5,
): BrowserRuntimeBundlePublisherCellV5 {
  if (typeof onDiagnostic !== 'function') {
    throw new TypeError('Bundle diagnostic listener must be a function.')
  }
  const owner: InstallOwnerV5 = Object.freeze({ ownerId: Symbol('browser-runtime-bundle-cell-v5') })
  const listeners = new Set<BundleListenerV5>()
  let state = canonicalBundleState(initial)

  const getState = (): BrowserRuntimeBundleStateV5 => state
  const subscribe = (listener: BundleListenerV5): (() => void) => {
    if (typeof listener !== 'function') throw new TypeError('Bundle listener must be a function.')
    listeners.add(listener)
    return () => { listeners.delete(listener) }
  }

  const prepareInstall = (
    nextInput: BrowserRuntimeBundleStateV5,
    expectedBaseBundle: BrowserRuntimeBundleStateV5,
    expectedEpochInput: number,
  ): BrowserRuntimeBundleInstallTokenV5 => {
    const base = state
    if (expectedBaseBundle !== base) {
      fail('RUNTIME_BASE_BUNDLE_STALE', 'Expected Bundle is not the exact active Bundle object.')
    }
    const expectedEpoch = requireEpoch(expectedEpochInput)
    if (base.runtimeEpoch !== expectedEpoch) {
      fail('RUNTIME_BASE_EPOCH_STALE', 'Expected Runtime Epoch is not active.')
    }
    if (expectedEpoch === Number.MAX_SAFE_INTEGER) {
      fail('RUNTIME_EPOCH_EXHAUSTED', 'Runtime Epoch cannot be incremented safely.')
    }
    const next = canonicalBundleState(nextInput, expectedEpoch + 1)
    if (state !== base || state.runtimeEpoch !== expectedEpoch) {
      fail('RUNTIME_BASE_BUNDLE_STALE', 'Active Bundle changed while preparing the install token.')
    }
    const listenerSnapshot = Object.freeze(Array.from(listeners))
    let token!: BrowserRuntimeBundleInstallTokenV5
    token = Object.freeze({
      previousRuntimeGraph: base.runtimeGraph,
      installPure(this: BrowserRuntimeBundleInstallTokenV5): void {
        const record = installRecords.get(this)
        if (record === undefined || record.owner !== owner) {
          fail('INSTALL_TOKEN_FOREIGN', 'Install token does not belong to this Bundle cell.')
        }
        if (record.phase !== 'prepared') {
          fail('INSTALL_TOKEN_REUSED', 'Install token has already been consumed.')
        }
        if (state !== record.base || state.runtimeEpoch !== record.expectedEpoch) {
          record.phase = 'rejected'
          fail('INSTALL_TOKEN_STALE', 'Install token base Bundle is no longer active.')
        }
        record.phase = 'installed'
        state = record.next
      },
      flushIsolatedNotifications(this: BrowserRuntimeBundleInstallTokenV5): void {
        const record = installRecords.get(this)
        if (record === undefined || record.owner !== owner || record.phase !== 'installed') return
        record.phase = 'flushed'
        for (const listener of record.listeners) {
          try {
            listener()
          } catch (error) {
            diagnosticNoThrow(onDiagnostic, error)
          }
        }
      },
    })
    installRecords.set(token, {
      owner,
      base,
      expectedEpoch,
      next,
      listeners: listenerSnapshot,
      phase: 'prepared',
    })
    return token
  }

  return Object.freeze({ getState, subscribe, prepareInstall })
}
