import {
  MAX_RUNTIME_BATCH_BYTES_V1,
  validateRuntimeStreamMessageV1,
  type EndpointCatchupBoundaryV1,
  type EndpointLifecycleV1,
  type EndpointReplayBoundaryV1,
  type RuntimeStreamMessageV1,
  type StateBatchV1,
} from '../../../core/runtime-protocol/v1.js'

export interface BrowserLocationV5 {
  readonly protocol: string
  readonly host: string
}

export interface BrowserWebSocketV5 {
  readonly readyState: number
  close(): void
  addEventListener(
    type: 'open' | 'message' | 'close' | 'error',
    listener: (event: unknown) => void,
  ): void
  removeEventListener(
    type: 'open' | 'message' | 'close' | 'error',
    listener: (event: unknown) => void,
  ): void
}

export interface EndpointCatchupGuardV5 {
  commit(): void
  abort(): void
}

export interface RuntimeGatewayStateConsumerV5 {
  ingest(batch: StateBatchV1, receivedTimestampMs: number): boolean
  restoreReplayPrefix(batch: StateBatchV1, receivedTimestampMs: number): boolean
}

export type RuntimeGatewayLifecycleConsumerV5 = (
  event: EndpointLifecycleV1,
  receivedTimestampMs: number,
) => boolean

export interface RuntimeGatewayStreamContextV5 {
  readonly projectId: string
  readonly configRevision: string
  readonly gatewayId: string
}

export interface RuntimeGatewayStreamTargetV5 extends RuntimeGatewayStreamContextV5 {
  readonly stateConsumers: readonly RuntimeGatewayStateConsumerV5[]
  readonly lifecycleConsumers: readonly RuntimeGatewayLifecycleConsumerV5[]
  readonly onEndpointCatchupStart: (
    endpointId: string,
    receivedTimestampMs: number,
  ) => EndpointCatchupGuardV5
  readonly onSessionStart?: (receivedTimestampMs: number) => void
  readonly onSessionDisconnect?: (receivedTimestampMs: number) => void
}

export interface RuntimeGatewayStateStreamOptionsV5 {
  readonly url?: string
  readonly location?: BrowserLocationV5
  readonly createWebSocket?: (url: string) => BrowserWebSocketV5
  readonly readActiveTarget: () => RuntimeGatewayStreamTargetV5
  readonly nowMs?: () => number
  readonly reconnectDelayMs?: number
}

export interface RuntimeGatewayStateStreamV5 {
  start(): void
  refreshActiveTarget(): void
  stop(): void
}

interface SocketListenersV5 {
  readonly open: (event: unknown) => void
  readonly message: (event: unknown) => void
  readonly close: (event: unknown) => void
  readonly error: (event: unknown) => void
}

interface SocketCandidateV5 {
  readonly native: BrowserWebSocketV5
  listeners: SocketListenersV5 | null
  nativeOpened: boolean
  established: boolean
  accepting: boolean
  failed: boolean
  disconnectReported: boolean
  openedTarget: RuntimeGatewayStreamTargetV5 | null
}

interface EndpointRecordV5 {
  wireSequence: number | null
  lifecycle: EndpointLifecycleV1 | null
  seen: boolean
  replayEligible: boolean
}

interface BufferedPublisherFrameV5 {
  readonly message: StateBatchV1 | EndpointLifecycleV1
  readonly atMs: number
  readonly prefix: boolean
}

interface AdmittedPhysicalFrameV5 {
  readonly openedTarget: RuntimeGatewayStreamTargetV5
  readonly record: EndpointRecordV5
  readonly message: RuntimeStreamMessageV1
  readonly atMs: number
  readonly physicalBytes: number
}

interface ActiveBoundaryV5 {
  readonly kind: 'replay' | 'catchup'
  readonly endpointId: string
  readonly boundaryId: string
  readonly declaredCount: number
  readonly declaredBytes: number
  readonly target: RuntimeGatewayStreamTargetV5
  readonly record: EndpointRecordV5
  readonly provisional: EndpointRecordV5
  readonly frames: BufferedPublisherFrameV5[]
  readonly queued: AdmittedPhysicalFrameV5[]
  guard: EndpointCatchupGuardV5 | null
  guardState: 'none' | 'active' | 'committed' | 'aborted'
  replayStage: 'prefix' | 'current' | 'disconnected'
  observedBytes: number
  status: 'starting' | 'buffering' | 'draining'
  canceled: boolean
}

const MAX_ENDPOINTS_PER_SOCKET_V5 = 8
const MAX_BOUNDARY_BYTES_V5 = 8 * MAX_RUNTIME_BATCH_BYTES_V1

function requireReconnectDelayV5(value: number): number {
  if (!Number.isSafeInteger(value) || value < 50) {
    throw new TypeError('Runtime Gateway reconnect delay must be a whole number of at least 50 ms.')
  }
  return value
}

function requireTimestampV5(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError('Runtime Gateway clock must return a non-negative safe integer.')
  }
  return value
}

function physicalTextV5(event: unknown): string | null {
  if (event === null || typeof event !== 'object') return null
  const data = (event as { readonly data?: unknown }).data
  return typeof data === 'string' ? data : null
}

function cloneEndpointRecordV5(record: EndpointRecordV5): EndpointRecordV5 {
  return {
    wireSequence: record.wireSequence,
    lifecycle: record.lifecycle,
    seen: record.seen,
    replayEligible: record.replayEligible,
  }
}

function sameLifecycleTupleV5(left: EndpointLifecycleV1, right: EndpointLifecycleV1): boolean {
  return left.publisherGeneration === right.publisherGeneration
    && left.sessionGeneration === right.sessionGeneration
}

function sameLifecycleSemanticV5(left: EndpointLifecycleV1, right: EndpointLifecycleV1): boolean {
  return sameLifecycleTupleV5(left, right)
    && left.gatewayId === right.gatewayId
    && left.projectId === right.projectId
    && left.configRevision === right.configRevision
    && left.endpointId === right.endpointId
    && left.originId === right.originId
    && left.eventId === right.eventId
    && left.phase === right.phase
    && left.statusCode === right.statusCode
    && left.occurredAtMs === right.occurredAtMs
}

function lifecycleTupleIsNewerV5(candidate: EndpointLifecycleV1, current: EndpointLifecycleV1): boolean {
  return candidate.publisherGeneration > current.publisherGeneration
    || (candidate.publisherGeneration === current.publisherGeneration
      && candidate.sessionGeneration > current.sessionGeneration)
}

function applyLifecycleV5(record: EndpointRecordV5, event: EndpointLifecycleV1): 'accepted' | 'duplicate' {
  const current = record.lifecycle
  if (current !== null && sameLifecycleSemanticV5(current, event)) return 'duplicate'

  if (event.phase === 'connected') {
    if (current !== null && !lifecycleTupleIsNewerV5(event, current)) {
      throw new TypeError('Endpoint connected lifecycle is stale or conflicts with its current tuple.')
    }
  } else if (
    current === null
    || current.phase !== 'connected'
    || !sameLifecycleTupleV5(current, event)
    || current.originId !== event.originId
  ) {
    throw new TypeError('Endpoint disconnected lifecycle does not match the active publisher session.')
  }

  record.lifecycle = event
  return 'accepted'
}

export function runtimeGatewayWebSocketUrlV5(location: BrowserLocationV5): string {
  if (location.host.trim().length === 0) throw new TypeError('Browser host must not be empty.')
  const scheme = location.protocol === 'https:'
    ? 'wss:'
    : location.protocol === 'http:'
      ? 'ws:'
      : null
  if (scheme === null) throw new TypeError(`Unsupported browser protocol ${location.protocol}.`)
  return `${scheme}//${location.host}/runtime/ws`
}

function defaultBrowserLocationV5(): BrowserLocationV5 {
  return { protocol: globalThis.location.protocol, host: globalThis.location.host }
}

function defaultWebSocketFactoryV5(url: string): BrowserWebSocketV5 {
  return new globalThis.WebSocket(url) as BrowserWebSocketV5
}

export function createRuntimeGatewayStateStreamV5(
  options: RuntimeGatewayStateStreamOptionsV5,
): RuntimeGatewayStateStreamV5 {
  const url = options.url ?? runtimeGatewayWebSocketUrlV5(
    options.location ?? defaultBrowserLocationV5(),
  )
  const createWebSocket = options.createWebSocket ?? defaultWebSocketFactoryV5
  const nowMs = options.nowMs ?? Date.now
  const reconnectDelayMs = requireReconnectDelayV5(options.reconnectDelayMs ?? 1_000)
  const encoder = new TextEncoder()

  let started = false
  let candidate: SocketCandidateV5 | null = null
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null
  let refreshInFlight = false
  let lastReceiptMs = 0
  let boundary: ActiveBoundaryV5 | null = null
  const endpointRecords = new Map<string, EndpointRecordV5>()

  const sampleReceiptV5 = (): number => {
    lastReceiptMs = Math.max(lastReceiptMs, requireTimestampV5(nowMs()))
    return lastReceiptMs
  }

  const clearEndpointStateV5 = (): void => {
    endpointRecords.clear()
    lastReceiptMs = 0
  }

  const detachCandidateV5 = (target: SocketCandidateV5): void => {
    const listeners = target.listeners
    if (listeners === null) return
    target.native.removeEventListener('open', listeners.open)
    target.native.removeEventListener('message', listeners.message)
    target.native.removeEventListener('close', listeners.close)
    target.native.removeEventListener('error', listeners.error)
    target.listeners = null
    if (candidate === target) candidate = null
  }

  const closeDetachedV5 = (target: SocketCandidateV5): void => {
    try {
      if (target.native.readyState < 2) target.native.close()
      else if (target.native.readyState !== 3) target.native.close()
    } catch {
      // A browser close failure cannot make cleanup unbounded.
    }
  }

  const abortActiveBoundaryV5 = (): void => {
    const active = boundary
    if (active === null) return
    active.canceled = true
    if (active.guard !== null && active.guardState === 'active') {
      active.guardState = 'aborted'
      try {
        active.guard.abort()
      } catch {
        // Guard cleanup is isolated from transport cleanup.
      }
    }
    boundary = null
  }

  const abortReturnedGuardV5 = (returnedGuard: EndpointCatchupGuardV5): void => {
    try {
      returnedGuard.abort()
    } catch {
      // A detached returned guard cannot block intentional cleanup.
    }
  }

  const scheduleReconnectV5 = (): void => {
    if (!started || reconnectTimer !== null) return
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null
      connectV5()
    }, reconnectDelayMs)
  }

  const rejectCandidateV5 = (target: SocketCandidateV5, atMs: number): void => {
    if (target.failed) return
    target.failed = true
    target.accepting = false
    detachCandidateV5(target)
    abortActiveBoundaryV5()
    endpointRecords.clear()
    if (target.established && !target.disconnectReported) {
      target.disconnectReported = true
      try {
        target.openedTarget?.onSessionDisconnect?.(atMs)
      } catch {
        // Session observers are isolated from reconnection.
      }
    }
    closeDetachedV5(target)
    scheduleReconnectV5()
  }

  const sampleOrRejectV5 = (target: SocketCandidateV5): number | null => {
    try {
      return sampleReceiptV5()
    } catch {
      rejectCandidateV5(target, lastReceiptMs)
      return null
    }
  }

  const requireEndpointRecordV5 = (endpointId: string): EndpointRecordV5 => {
    const existing = endpointRecords.get(endpointId)
    if (existing !== undefined) return existing
    if (endpointRecords.size >= MAX_ENDPOINTS_PER_SOCKET_V5) {
      throw new TypeError('Runtime Gateway socket supports at most eight Endpoints.')
    }
    const created: EndpointRecordV5 = {
      wireSequence: null,
      lifecycle: null,
      seen: false,
      replayEligible: true,
    }
    endpointRecords.set(endpointId, created)
    return created
  }

  const admitEnvelopeV5 = (
    target: SocketCandidateV5,
    openedTarget: RuntimeGatewayStreamTargetV5,
    message: RuntimeStreamMessageV1,
  ): EndpointRecordV5 => {
    if (options.readActiveTarget() !== openedTarget || target.openedTarget !== openedTarget) {
      throw new TypeError('Runtime Gateway active target changed.')
    }
    if (
      message.projectId !== openedTarget.projectId
      || message.configRevision !== openedTarget.configRevision
      || message.gatewayId !== openedTarget.gatewayId
    ) {
      throw new TypeError('Runtime Gateway frame context does not match the opened target.')
    }
    const record = requireEndpointRecordV5(message.endpointId)
    if (record.wireSequence !== null && message.sequence <= record.wireSequence) {
      throw new TypeError('Runtime Gateway wire sequence is not strictly increasing.')
    }
    record.wireSequence = message.sequence
    return record
  }

  const deliverStateV5 = (
    target: RuntimeGatewayStreamTargetV5,
    batch: StateBatchV1,
    atMs: number,
    prefix: boolean,
  ): void => {
    for (const stateConsumer of target.stateConsumers) {
      try {
        if (prefix) stateConsumer.restoreReplayPrefix(batch, atMs)
        else stateConsumer.ingest(batch, atMs)
      } catch {
        // One state consumer cannot block its peers.
      }
    }
  }

  const deliverLifecycleV5 = (
    target: RuntimeGatewayStreamTargetV5,
    event: EndpointLifecycleV1,
    atMs: number,
  ): void => {
    for (const lifecycleConsumer of target.lifecycleConsumers) {
      try {
        lifecycleConsumer(event, atMs)
      } catch {
        // One lifecycle consumer cannot block its peers.
      }
    }
  }

  const applyOrdinaryV5 = (
    openedTarget: RuntimeGatewayStreamTargetV5,
    record: EndpointRecordV5,
    message: StateBatchV1 | EndpointLifecycleV1,
    atMs: number,
    consumeReplayEligibility: boolean,
  ): void => {
    if (consumeReplayEligibility) {
      record.seen = true
      record.replayEligible = false
    }
    if (message.type === 'state-batch-v1') {
      if (record.lifecycle?.phase !== 'connected') {
        throw new TypeError('State is valid only while its Endpoint is connected.')
      }
      deliverStateV5(openedTarget, message, atMs, false)
      return
    }
    if (applyLifecycleV5(record, message) === 'accepted') {
      deliverLifecycleV5(openedTarget, message, atMs)
    }
  }

  const boundaryIdV5 = (
    message: EndpointReplayBoundaryV1 | EndpointCatchupBoundaryV1,
  ): string => message.type === 'endpoint-replay-boundary-v1'
    ? message.replayId
    : message.catchupId

  const beginBoundaryV5 = (
    target: SocketCandidateV5,
    openedTarget: RuntimeGatewayStreamTargetV5,
    record: EndpointRecordV5,
    message: EndpointReplayBoundaryV1 | EndpointCatchupBoundaryV1,
    atMs: number,
  ): void => {
    if (boundary !== null || message.phase !== 'start') {
      throw new TypeError('Runtime Gateway boundary start is nested or misplaced.')
    }
    if (
      message.messageCount < 1
      || message.encodedBytes < 1
      || message.encodedBytes > MAX_BOUNDARY_BYTES_V5
    ) {
      throw new TypeError('Runtime Gateway boundary declaration is outside its fixed limits.')
    }
    const kind = message.type === 'endpoint-replay-boundary-v1' ? 'replay' : 'catchup'
    if (kind === 'replay' && (record.seen || !record.replayEligible)) {
      throw new TypeError('Replay is valid only as an unseen Endpoint first frame.')
    }
    record.seen = true
    record.replayEligible = false

    const active: ActiveBoundaryV5 = {
      kind,
      endpointId: message.endpointId,
      boundaryId: boundaryIdV5(message),
      declaredCount: message.messageCount,
      declaredBytes: message.encodedBytes,
      target: openedTarget,
      record,
      provisional: cloneEndpointRecordV5(record),
      frames: [],
      queued: [],
      guard: null,
      guardState: 'none',
      replayStage: 'prefix',
      observedBytes: 0,
      status: kind === 'catchup' ? 'starting' : 'buffering',
      canceled: false,
    }
    boundary = active
    if (kind === 'replay') return

    const retainedGuard = openedTarget.onEndpointCatchupStart(message.endpointId, atMs)
    if (
      retainedGuard === null
      || typeof retainedGuard !== 'object'
      || typeof retainedGuard.commit !== 'function'
      || typeof retainedGuard.abort !== 'function'
    ) {
      throw new TypeError('Endpoint catch-up start must return a commit/abort guard.')
    }
    if (
      active.canceled
      || boundary !== active
      || candidate !== target
      || target.failed
      || !target.accepting
      || !started
    ) {
      abortReturnedGuardV5(retainedGuard)
      return
    }
    active.guard = retainedGuard
    active.guardState = 'active'
    active.status = 'buffering'
    const queuedDuringStart = [...active.queued]
    active.queued.length = 0
    for (const queuedFrame of queuedDuringStart) {
      if (!boundaryStillOwnedV5(active, target)) return
      try {
        routeAdmittedFrameV5(target, queuedFrame)
      } catch {
        rejectCandidateV5(target, queuedFrame.atMs)
        return
      }
    }
  }

  const admitReplayBodyV5 = (
    active: ActiveBoundaryV5,
    message: StateBatchV1 | EndpointLifecycleV1,
  ): boolean => {
    if (message.type === 'state-batch-v1') {
      if (active.replayStage === 'disconnected') {
        throw new TypeError('Replay State cannot follow its retained disconnect.')
      }
      return active.replayStage === 'prefix'
    }

    const outcome = applyLifecycleV5(active.provisional, message)
    if (active.replayStage === 'prefix') {
      if (message.phase !== 'connected' || outcome !== 'accepted') {
        throw new TypeError('Replay prefix must be followed by one connected lifecycle.')
      }
      active.replayStage = 'current'
      return false
    }
    if (active.replayStage === 'current') {
      if (message.phase === 'connected' && outcome !== 'duplicate') {
        throw new TypeError('Replay contains more than one connected lifecycle.')
      }
      if (message.phase === 'disconnected' && outcome === 'accepted') {
        active.replayStage = 'disconnected'
      }
      return false
    }
    if (outcome !== 'duplicate' || message.phase !== 'disconnected') {
      throw new TypeError('Only an exact retained-disconnect duplicate may follow replay disconnect.')
    }
    return false
  }

  const admitCatchupBodyV5 = (
    active: ActiveBoundaryV5,
    message: StateBatchV1 | EndpointLifecycleV1,
  ): void => {
    if (message.type === 'state-batch-v1') {
      if (active.provisional.lifecycle?.phase !== 'connected') {
        throw new TypeError('Catch-up State is valid only while provisionally connected.')
      }
      return
    }
    applyLifecycleV5(active.provisional, message)
  }

  const appendBoundaryBodyV5 = (
    active: ActiveBoundaryV5,
    record: EndpointRecordV5,
    message: StateBatchV1 | EndpointLifecycleV1,
    atMs: number,
    physicalBytes: number,
  ): void => {
    if (active.status !== 'buffering' || record !== active.record || message.endpointId !== active.endpointId) {
      throw new TypeError('Runtime Gateway boundary body crosses its exclusive Endpoint.')
    }
    if (
      active.frames.length >= active.declaredCount
      || active.observedBytes + physicalBytes > active.declaredBytes
      || active.observedBytes + physicalBytes > MAX_BOUNDARY_BYTES_V5
    ) {
      throw new TypeError('Runtime Gateway boundary body exceeds declared totals.')
    }
    const prefix = active.kind === 'replay'
      ? admitReplayBodyV5(active, message)
      : false
    if (active.kind === 'catchup') admitCatchupBodyV5(active, message)
    active.frames.push({ message, atMs, prefix })
    active.observedBytes += physicalBytes
  }

  const boundaryStillOwnedV5 = (
    active: ActiveBoundaryV5,
    target: SocketCandidateV5,
  ): boolean => !active.canceled
    && boundary === active
    && candidate === target
    && target.accepting
    && !target.failed
    && started

  const drainBoundaryV5 = (
    active: ActiveBoundaryV5,
    target: SocketCandidateV5,
  ): void => {
    active.status = 'draining'
    for (const entry of active.frames) {
      if (!boundaryStillOwnedV5(active, target)) return
      if (entry.prefix) {
        if (entry.message.type !== 'state-batch-v1') {
          throw new TypeError('Only replay State may be delivered as a prefix.')
        }
        deliverStateV5(active.target, entry.message, entry.atMs, true)
      } else {
        applyOrdinaryV5(active.target, active.record, entry.message, entry.atMs, false)
      }
      if (!boundaryStillOwnedV5(active, target)) return
    }

    if (active.guard !== null) {
      if (!boundaryStillOwnedV5(active, target) || active.guardState !== 'active') return
      active.guard.commit()
      active.guardState = 'committed'
      if (!boundaryStillOwnedV5(active, target)) return
    }

    boundary = null
    const queued = [...active.queued]
    active.queued.length = 0
    for (const queuedFrame of queued) {
      if (candidate !== target || target.failed || !target.accepting || !started) return
      try {
        routeAdmittedFrameV5(target, queuedFrame)
      } catch {
        rejectCandidateV5(target, queuedFrame.atMs)
        return
      }
    }
  }

  const finishBoundaryV5 = (
    target: SocketCandidateV5,
    openedTarget: RuntimeGatewayStreamTargetV5,
    message: EndpointReplayBoundaryV1 | EndpointCatchupBoundaryV1,
  ): void => {
    const active = boundary
    if (active === null || active.status !== 'buffering' || message.phase !== 'end') {
      throw new TypeError('Runtime Gateway boundary end has no matching start.')
    }
    const kind = message.type === 'endpoint-replay-boundary-v1' ? 'replay' : 'catchup'
    if (
      kind !== active.kind
      || message.endpointId !== active.endpointId
      || boundaryIdV5(message) !== active.boundaryId
      || message.messageCount !== active.declaredCount
      || message.encodedBytes !== active.declaredBytes
      || active.frames.length !== active.declaredCount
      || active.observedBytes !== active.declaredBytes
      || (active.kind === 'replay' && active.replayStage === 'prefix')
    ) {
      throw new TypeError('Runtime Gateway boundary end does not match its complete body.')
    }
    if (options.readActiveTarget() !== openedTarget || active.target !== openedTarget) {
      throw new TypeError('Runtime Gateway active target changed before boundary drain.')
    }
    drainBoundaryV5(active, target)
  }

  const routeAdmittedFrameV5 = (
    target: SocketCandidateV5,
    admitted: AdmittedPhysicalFrameV5,
  ): void => {
    const { openedTarget, record, message, atMs, physicalBytes } = admitted
    const active = boundary
    if (
      active !== null
      && (message.type === 'endpoint-replay-boundary-v1'
        || message.type === 'endpoint-catchup-boundary-v1')
      && message.phase === 'end'
    ) {
      finishBoundaryV5(target, openedTarget, message)
      return
    }
    if (active !== null) {
      if (message.type !== 'state-batch-v1' && message.type !== 'endpoint-lifecycle-v1') {
        throw new TypeError('Runtime Gateway boundaries cannot nest.')
      }
      appendBoundaryBodyV5(active, record, message, atMs, physicalBytes)
      return
    }
    if (message.type === 'endpoint-replay-boundary-v1' || message.type === 'endpoint-catchup-boundary-v1') {
      beginBoundaryV5(target, openedTarget, record, message, atMs)
      return
    }
    applyOrdinaryV5(openedTarget, record, message, atMs, true)
  }

  const admitPhysicalFrameV5 = (
    target: SocketCandidateV5,
    event: unknown,
    atMs: number,
  ): AdmittedPhysicalFrameV5 => {
    const text = physicalTextV5(event)
    if (text === null) throw new TypeError('Runtime Gateway accepts only string WebSocket frames.')
    const physicalBytes = encoder.encode(text).byteLength
    if (physicalBytes > MAX_RUNTIME_BATCH_BYTES_V1) {
      throw new TypeError('Runtime Gateway WebSocket frame exceeds its UTF-8 byte limit.')
    }
    const openedTarget = target.openedTarget
    if (openedTarget === null) throw new TypeError('Runtime Gateway candidate has no captured target.')
    const message = validateRuntimeStreamMessageV1(JSON.parse(text) as unknown)
    const record = admitEnvelopeV5(target, openedTarget, message)
    return { openedTarget, record, message, atMs, physicalBytes }
  }

  const handleMessageV5 = (target: SocketCandidateV5, event: unknown): void => {
    const atMs = sampleOrRejectV5(target)
    if (atMs === null || target.failed) return
    try {
      const admitted = admitPhysicalFrameV5(target, event, atMs)
      const active = boundary
      if (active !== null && (active.status === 'starting' || active.status === 'draining')) {
        active.queued.push(admitted)
        return
      }
      routeAdmittedFrameV5(target, admitted)
    } catch {
      rejectCandidateV5(target, atMs)
    }
  }

  const handleTerminalEventV5 = (target: SocketCandidateV5): void => {
    const atMs = sampleOrRejectV5(target)
    if (atMs === null || target.failed) return
    rejectCandidateV5(target, atMs)
  }

  const connectV5 = (): void => {
    if (!started || candidate !== null) return
    let native: BrowserWebSocketV5
    try {
      native = createWebSocket(url)
    } catch {
      scheduleReconnectV5()
      return
    }
    const next: SocketCandidateV5 = {
      native,
      listeners: null,
      nativeOpened: false,
      established: false,
      accepting: false,
      failed: false,
      disconnectReported: false,
      openedTarget: null,
    }
    const listeners: SocketListenersV5 = {
      open: () => {
        if (candidate !== next || next.failed || !started || next.nativeOpened || native.readyState !== 1) return
        next.nativeOpened = true
        abortActiveBoundaryV5()
        clearEndpointStateV5()
        const atMs = sampleOrRejectV5(next)
        if (atMs === null || next.failed) return
        try {
          const openedTarget = options.readActiveTarget()
          next.openedTarget = openedTarget
          next.established = true
          openedTarget.onSessionStart?.(atMs)
          next.accepting = true
          refreshInFlight = false
        } catch {
          rejectCandidateV5(next, atMs)
        }
      },
      message: (event) => {
        if (candidate === next && next.accepting && !next.failed && started) handleMessageV5(next, event)
      },
      close: () => {
        if (candidate === next && !next.failed) handleTerminalEventV5(next)
      },
      error: () => {
        if (candidate === next && !next.failed) handleTerminalEventV5(next)
      },
    }
    next.listeners = listeners
    candidate = next
    native.addEventListener('open', listeners.open)
    native.addEventListener('message', listeners.message)
    native.addEventListener('close', listeners.close)
    native.addEventListener('error', listeners.error)
  }

  const disposeIntentionalV5 = (): void => {
    if (reconnectTimer !== null) {
      clearTimeout(reconnectTimer)
      reconnectTimer = null
    }
    const activeCandidate = candidate
    if (activeCandidate !== null) {
      activeCandidate.failed = true
      activeCandidate.accepting = false
      detachCandidateV5(activeCandidate)
      abortActiveBoundaryV5()
      endpointRecords.clear()
      closeDetachedV5(activeCandidate)
    } else {
      abortActiveBoundaryV5()
      endpointRecords.clear()
    }
  }

  const start = (): void => {
    if (started) return
    started = true
    refreshInFlight = false
    connectV5()
  }

  const refreshActiveTarget = (): void => {
    if (!started || refreshInFlight) return
    refreshInFlight = true
    disposeIntentionalV5()
    connectV5()
  }

  const stop = (): void => {
    if (!started && candidate === null && reconnectTimer === null) return
    started = false
    refreshInFlight = false
    disposeIntentionalV5()
    lastReceiptMs = 0
  }

  return Object.freeze({ start, refreshActiveTarget, stop })
}
