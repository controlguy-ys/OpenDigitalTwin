import type { RuntimeGatewayStatusV1 } from '../../core/runtime-protocol/gateway-status-v1.js'
import type { RuntimeIntegrationDiagnosticsV1 } from '../../core/runtime-protocol/integration-diagnostics-v1.js'

export const RUNTIME_GATEWAY_HEADER_POLL_MS_V1 = 10_000
export const RUNTIME_GATEWAY_MONITOR_POLL_MS_V1 = 2_000

export type RuntimeGatewayStatusPollDemandV1 = 'stopped' | 'header' | 'monitor'

export interface RuntimeConnectivitySnapshotV1 {
  readonly status: RuntimeGatewayStatusV1
  readonly integrationDiagnostics: RuntimeIntegrationDiagnosticsV1
}

export interface RuntimeGatewayStatusPollerV1 {
  setDemand(demand: RuntimeGatewayStatusPollDemandV1): void
  pollNow(): void
  stop(): void
  status(): Readonly<{
    demand: RuntimeGatewayStatusPollDemandV1
    inFlight: boolean
    nextPollAtMs: number | null
  }>
}

export interface RuntimeGatewayStatusPollerOptionsV1 {
  readonly readConnectivitySnapshot: (signal?: AbortSignal) => Promise<RuntimeConnectivitySnapshotV1>
  readonly onSnapshot: (snapshot: RuntimeConnectivitySnapshotV1) => void
  readonly onError: (error: unknown) => void
  readonly nowMs?: () => number
}

function pollIntervalMsV1(demand: Exclude<RuntimeGatewayStatusPollDemandV1, 'stopped'>): number {
  return demand === 'monitor'
    ? RUNTIME_GATEWAY_MONITOR_POLL_MS_V1
    : RUNTIME_GATEWAY_HEADER_POLL_MS_V1
}

export function createRuntimeGatewayStatusPollerV1(
  options: RuntimeGatewayStatusPollerOptionsV1,
): RuntimeGatewayStatusPollerV1 {
  const nowMs = options.nowMs ?? Date.now
  let demand: RuntimeGatewayStatusPollDemandV1 = 'stopped'
  let inFlight = false
  let nextPollAtMs: number | null = null
  let timer: ReturnType<typeof setTimeout> | null = null
  let activeRequest: AbortController | null = null
  let generation = 0

  const clearScheduledPoll = (): void => {
    if (timer !== null) clearTimeout(timer)
    timer = null
    nextPollAtMs = null
  }

  const scheduleNextPoll = (): void => {
    if (demand === 'stopped' || inFlight || timer !== null) return
    const intervalMs = pollIntervalMsV1(demand)
    nextPollAtMs = nowMs() + intervalMs
    timer = setTimeout(() => {
      timer = null
      nextPollAtMs = null
      poll()
    }, intervalMs)
  }

  const poll = (): void => {
    if (demand === 'stopped' || inFlight) return
    const requestGeneration = generation
    const controller = new AbortController()
    activeRequest = controller
    inFlight = true
    let read: Promise<RuntimeConnectivitySnapshotV1>
    try {
      read = options.readConnectivitySnapshot(controller.signal)
    } catch (error) {
      read = Promise.reject(error)
    }
    void read.then(
      (snapshot) => {
        if (generation === requestGeneration && demand !== 'stopped') options.onSnapshot(snapshot)
      },
      (error: unknown) => {
        if (generation === requestGeneration && demand !== 'stopped') options.onError(error)
      },
    ).finally(() => {
      if (generation !== requestGeneration) return
      inFlight = false
      activeRequest = null
      scheduleNextPoll()
    })
  }

  const stop = (): void => {
    if (demand === 'stopped' && !inFlight && timer === null) return
    demand = 'stopped'
    generation += 1
    clearScheduledPoll()
    const controller = activeRequest
    activeRequest = null
    inFlight = false
    controller?.abort()
  }

  const setDemand = (nextDemand: RuntimeGatewayStatusPollDemandV1): void => {
    if (nextDemand === 'stopped') {
      stop()
      return
    }
    const wasInactive = demand === 'stopped'
    demand = nextDemand
    if (wasInactive) {
      poll()
      return
    }
    if (timer !== null) {
      clearScheduledPoll()
      scheduleNextPoll()
    }
  }

  const pollNow = (): void => {
    if (demand === 'stopped' || inFlight) return
    clearScheduledPoll()
    poll()
  }

  return Object.freeze({
    setDemand,
    pollNow,
    stop,
    status: () => Object.freeze({ demand, inFlight, nextPollAtMs }),
  })
}
