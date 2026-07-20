import {
  endpointLifecycleEventIdV1,
  validateEndpointLifecycleV1,
  type EndpointLifecycleV1,
} from '../../../core/runtime-protocol/v1.js'
import { type WorkcellProjectV5 } from '../../../core/project-v5/index.js'

export interface EndpointLifecycleTargetV5 {
  markEndpointDisconnected(endpointId: string, atMs: number): void
  resetEndpointSession(endpointId: string, atMs: number): void
}

export interface EndpointLifecycleRouterV5 {
  ingest(event: EndpointLifecycleV1, receivedTimestampMs: number): boolean
  resetSocketSession(): void
}

export interface EndpointLifecycleRouterContextV5 {
  readonly project: WorkcellProjectV5 | null
  readonly configRevision: string | null
  readonly gatewayId: string | null
}

export interface CreateEndpointLifecycleRouterOptionsV5 {
  readonly readActiveContext: () => EndpointLifecycleRouterContextV5
  readonly targets: readonly EndpointLifecycleTargetV5[]
}

interface AcceptedLifecycleRecordV5 {
  readonly semanticKey: string
  readonly publisherGeneration: number
  readonly sessionGeneration: number
  readonly phaseOrdinal: 0 | 1
}

// Project validation caps OPC UA Endpoints at eight; retain the same bound at
// this browser boundary even if a caller supplies a stale/malformed context.
const MAX_ENDPOINT_LIFECYCLE_RECORDS_V5 = 8

function phaseOrdinal(phase: EndpointLifecycleV1['phase']): 0 | 1 {
  return phase === 'connected' ? 0 : 1
}

function compareOrder(
  left: Pick<AcceptedLifecycleRecordV5, 'publisherGeneration' | 'sessionGeneration' | 'phaseOrdinal'>,
  right: Pick<AcceptedLifecycleRecordV5, 'publisherGeneration' | 'sessionGeneration' | 'phaseOrdinal'>,
): number {
  if (left.publisherGeneration !== right.publisherGeneration) {
    return left.publisherGeneration - right.publisherGeneration
  }
  if (left.sessionGeneration !== right.sessionGeneration) {
    return left.sessionGeneration - right.sessionGeneration
  }
  return left.phaseOrdinal - right.phaseOrdinal
}

function semanticKey(event: EndpointLifecycleV1): string {
  return [
    event.projectId,
    event.configRevision,
    event.gatewayId,
    event.endpointId,
    event.originId,
    event.eventId,
  ].join('\u0000')
}

function validReceiptTimestamp(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0
}

export function createEndpointLifecycleRouterV5(
  options: CreateEndpointLifecycleRouterOptionsV5,
): EndpointLifecycleRouterV5 {
  const recordsByEndpoint = new Map<string, AcceptedLifecycleRecordV5>()
  const pending: Array<Readonly<{ event: EndpointLifecycleV1; receivedTimestampMs: number }>> = []
  let draining = false

  const drain = (): void => {
    if (draining) return
    draining = true
    try {
      while (pending.length > 0) {
        const next = pending.shift()!
        for (const target of options.targets) {
          try {
            if (next.event.phase === 'connected') target.resetEndpointSession(next.event.endpointId, next.receivedTimestampMs)
            else target.markEndpointDisconnected(next.event.endpointId, next.receivedTimestampMs)
          } catch {
            // Independent targets still receive this consumed lifecycle event.
          }
        }
      }
    } finally {
      draining = false
    }
  }

  const ingest = (eventInput: EndpointLifecycleV1, receivedTimestampMs: number): boolean => {
    if (!validReceiptTimestamp(receivedTimestampMs)) return false
    let event: EndpointLifecycleV1
    try {
      event = validateEndpointLifecycleV1(eventInput)
    } catch {
      return false
    }
    if (event.eventId !== endpointLifecycleEventIdV1(event)) return false

    const context = options.readActiveContext()
    const project = context.project
    if (
      project === null
      || context.configRevision === null
      || context.gatewayId === null
      || event.projectId !== project.projectId
      || event.configRevision !== context.configRevision
      || event.gatewayId !== context.gatewayId
      || (project.opcUa.mode !== 'client' && project.opcUa.mode !== 'bridge')
    ) return false
    const endpoint = project.opcUa.endpoints.find(({ endpointId }) => endpointId === event.endpointId)
    if (endpoint === undefined || !endpoint.enabled) return false

    const candidate: AcceptedLifecycleRecordV5 = Object.freeze({
      semanticKey: semanticKey(event),
      publisherGeneration: event.publisherGeneration,
      sessionGeneration: event.sessionGeneration,
      phaseOrdinal: phaseOrdinal(event.phase),
    })
    const previous = recordsByEndpoint.get(event.endpointId)
    if (previous === undefined && recordsByEndpoint.size >= MAX_ENDPOINT_LIFECYCLE_RECORDS_V5) return false
    if (previous !== undefined) {
      const comparison = compareOrder(candidate, previous)
      if (comparison <= 0) return false
    }
    recordsByEndpoint.set(event.endpointId, candidate)
    // Consumption happens before fan-out: target exceptions cannot make an
    // accepted lifecycle transition retryable, and reentrant input queues.
    pending.push(Object.freeze({ event, receivedTimestampMs }))
    drain()
    return true
  }

  return Object.freeze({
    ingest,
    resetSocketSession: () => { recordsByEndpoint.clear(); pending.length = 0 },
  })
}
