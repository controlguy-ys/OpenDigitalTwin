import type { RuntimeGatewayStatusV1 } from '../../../core/runtime-protocol/gateway-status-v1.js'

export const RUNTIME_GATEWAY_HEADER_POLL_MS_V4 = 10_000
export const RUNTIME_GATEWAY_MONITOR_POLL_MS_V4 = 2_000

export type RuntimeGatewayStatusPollDemandV4 = 'stopped' | 'header' | 'monitor'

export interface RuntimeGatewayStatusPollerV4 {
  setDemand(demand: RuntimeGatewayStatusPollDemandV4): void
  stop(): void
  status(): Readonly<{
    demand: RuntimeGatewayStatusPollDemandV4
    inFlight: boolean
    nextPollAtMs: number | null
  }>
}

export interface RuntimeGatewayStatusPollerOptionsV4 {
  readonly readStatus: (signal?: AbortSignal) => Promise<RuntimeGatewayStatusV1>
  readonly onStatus: (status: RuntimeGatewayStatusV1) => void
  readonly onError: (error: unknown) => void
  readonly nowMs?: () => number
}

function pollIntervalMsV4(demand: Exclude<RuntimeGatewayStatusPollDemandV4, 'stopped'>): number {
  return demand === 'monitor'
    ? RUNTIME_GATEWAY_MONITOR_POLL_MS_V4
    : RUNTIME_GATEWAY_HEADER_POLL_MS_V4
}

export function createRuntimeGatewayStatusPollerV4(
  options: RuntimeGatewayStatusPollerOptionsV4,
): RuntimeGatewayStatusPollerV4 {
  const nowMs = options.nowMs ?? Date.now
  let demand: RuntimeGatewayStatusPollDemandV4 = 'stopped'
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
    const intervalMs = pollIntervalMsV4(demand)
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
    let read: Promise<RuntimeGatewayStatusV1>
    try {
      read = options.readStatus(controller.signal)
    } catch (error) {
      read = Promise.reject(error)
    }
    void read.then(
      (status) => {
        if (generation === requestGeneration && demand !== 'stopped') options.onStatus(status)
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

  const setDemand = (nextDemand: RuntimeGatewayStatusPollDemandV4): void => {
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

  return Object.freeze({
    setDemand,
    stop,
    status: () => Object.freeze({ demand, inFlight, nextPollAtMs }),
  })
}
