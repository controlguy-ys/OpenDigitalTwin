// @vitest-environment node

import { describe, expect, it, vi } from 'vitest'

import { validateWorkcellProjectV5, type WorkcellProjectV5 } from '../../src/core/project-v5/index.js'
import { cloneWorkcellProjectV5, makeMinimalWorkcellProjectV5 } from '../../src/core/project-v5/test-support.js'
import {
  MAX_RUNTIME_BATCH_BYTES_V1,
  type StateBatchV1,
} from '../../src/core/runtime-protocol/v1.js'
import {
  createOpcUaClientAdapterPublicationHarnessV1,
  readNormalizedOpcUaClientPublicationV1,
  type NormalizedOpcUaClientPublicationV1,
} from './opcua-client-adapter.js'
import { compileOpcUaClientReadPlanV1 } from './opcua-client-read-plan.js'
import {
  createRuntimeTimelineStagingV1,
  createStateBatchHubV1,
  type GatewayWebSocketV1,
} from './state-batch-hub.js'
import { splitStateBatchesV1 } from './runtime-stream-timeline.js'

const REVISION = 'a'.repeat(64)
const NEXT_REVISION = 'b'.repeat(64)

function project(): WorkcellProjectV5 {
  const value = cloneWorkcellProjectV5(makeMinimalWorkcellProjectV5())
  ;(value as unknown as { projectId: string }).projectId = 'project-test'
  ;(value.opcUa.endpoints[0] as unknown as { endpointId: string; reconnectDelayMs: number }).endpointId = 'endpoint-test'
  ;(value.opcUa.endpoints[0] as unknown as { reconnectDelayMs: number }).reconnectDelayMs = 25
  ;(value.opcUa.mappings[0] as unknown as { id: string; endpointId: string; nodeAddress: unknown; leaves: unknown }).id = 'mapping-1'
  ;(value.opcUa.mappings[0] as unknown as { endpointId: string }).endpointId = 'endpoint-test'
  ;(value.opcUa.mappings[0] as unknown as { nodeAddress: unknown }).nodeAddress = {
    namespaceUri: 'urn:hub-test', identifierType: 'string', identifier: 'Machine.State',
  }
  ;(value.opcUa.mappings[0] as unknown as { leaves: unknown }).leaves = [{
    leafPath: ['present'], projectPath: [],
    projectTarget: { type: 'logical-signal', signalId: value.logicalSignals[0]!.id },
    opcUaDataType: 'Boolean', projectDataType: 'boolean', scale: 1, offset: 0, unit: '', required: true,
  }]
  return validateWorkcellProjectV5(value)
}

function publicationHarness(): {
  readonly publications: NormalizedOpcUaClientPublicationV1[]
  reconnect(): void
  emit(value: boolean): void
  stop(): void
} {
  const sourceProject = project()
  const rootKey = compileOpcUaClientReadPlanV1(sourceProject)[0]!.monitoredRoots[0]!.rootKey
  const harness = createOpcUaClientAdapterPublicationHarnessV1({
    project: sourceProject, endpointId: 'endpoint-test', gatewayId: 'gateway-test',
    originId: 'gateway-test:opcua-client', configRevision: REVISION, publisherGeneration: 1,
  })
  const publications: NormalizedOpcUaClientPublicationV1[] = [harness.lifecycle('connected')]
  return {
    publications,
    reconnect: () => { publications.push(harness.lifecycle('connected')) },
    emit(value: boolean) {
      publications.push(...harness.state({
        rootKey, value: { present: value },
        statusCode: 'Good', sourceTimestampMs: 1_000,
      }))
    },
    stop: () => { publications.push(harness.lifecycle('disconnected')) },
  }
}

interface ScenarioHarnessV1 {
  readonly publications: NormalizedOpcUaClientPublicationV1[]
  readonly rootKey: string
  readonly rootKeys: Readonly<Record<string, string>>
  readonly clock: { now: number }
  connected(): NormalizedOpcUaClientPublicationV1
  disconnected(): NormalizedOpcUaClientPublicationV1
  state(value: unknown, statusCode: string, sourceTimestampMs: number, mappingId?: string): readonly NormalizedOpcUaClientPublicationV1[]
}

function scenarioProject(options: Readonly<{
  endpointIds?: readonly string[]
  mappingIds?: readonly string[]
  coherenceGroupId?: string | null
  valueKind?: 'boolean' | 'string'
  sharedRoot?: boolean
}> = {}): WorkcellProjectV5 {
  const endpointIds = options.endpointIds ?? ['endpoint-test']
  const mappingIds = options.mappingIds ?? ['mapping-a']
  const valueKind = options.valueKind ?? 'boolean'
  const value = cloneWorkcellProjectV5(makeMinimalWorkcellProjectV5())
  ;(value as unknown as { projectId: string }).projectId = 'project-test'
  const baseEndpoint = value.opcUa.endpoints[0]!
  ;(value.opcUa.endpoints as unknown as Array<typeof baseEndpoint>).splice(
    0,
    value.opcUa.endpoints.length,
    ...endpointIds.map((endpointId, index) => ({
      ...baseEndpoint,
      endpointId,
      name: endpointId,
      endpointUrl: `opc.tcp://localhost:${4840 + index}`,
      reconnectDelayMs: 25,
    })),
  )
  const baseSignal = value.logicalSignals[0]!
  ;(value.logicalSignals as unknown as Array<typeof baseSignal>).splice(
    0,
    value.logicalSignals.length,
    ...endpointIds.flatMap((endpointId) => mappingIds.map((mappingId) => {
      const resolvedMappingId = endpointIds.length === 1 ? mappingId : `${endpointId}-${mappingId}`
      return ({
      ...baseSignal,
      id: `${endpointId}-${resolvedMappingId}`,
      name: `${endpointId}-${resolvedMappingId}`,
      dataType: valueKind === 'string' ? 'String' as const : 'Boolean' as const,
      initialValue: valueKind === 'string' ? '' : false,
      })
    })),
  )
  const baseMapping = value.opcUa.mappings[0]!
  const mappings = endpointIds.flatMap((endpointId) => mappingIds.map((mappingId) => {
    const resolvedMappingId = endpointIds.length === 1 ? mappingId : `${endpointId}-${mappingId}`
    return ({
    ...baseMapping,
    id: resolvedMappingId,
    endpointId,
    nodeAddress: {
      namespaceUri: 'urn:hub-test',
      identifierType: 'string' as const,
      identifier: options.sharedRoot === false ? `${endpointId}.${resolvedMappingId}` : `${endpointId}.Combined`,
    },
    coherenceGroupId: options.coherenceGroupId ?? null,
    leaves: [{
      ...baseMapping.leaves[0]!,
      leafPath: mappingIds.length === 1 || options.sharedRoot === false ? [] : [resolvedMappingId],
      projectTarget: { type: 'logical-signal' as const, signalId: `${endpointId}-${resolvedMappingId}` },
      opcUaDataType: valueKind === 'string' ? 'String' as const : 'Boolean' as const,
      projectDataType: valueKind === 'string' ? 'string' as const : 'boolean' as const,
    }],
    })
  }))
  ;(value.opcUa.mappings as unknown as typeof mappings).splice(
    0,
    value.opcUa.mappings.length,
    ...mappings,
  )
  return validateWorkcellProjectV5(value)
}

function scenarioHarness(
  sourceProject = scenarioProject(),
  endpointId = 'endpoint-test',
  publisherGeneration = 1,
  clock = { now: 10_000 },
  configRevision = REVISION,
): ScenarioHarnessV1 {
  const harness = createOpcUaClientAdapterPublicationHarnessV1({
    project: sourceProject,
    endpointId,
    gatewayId: 'gateway-test',
    originId: 'gateway-test:opcua-client',
    configRevision,
    publisherGeneration,
    nowMs: () => clock.now,
  })
  const endpointPlan = compileOpcUaClientReadPlanV1(sourceProject)
    .find((endpoint) => endpoint.endpointId === endpointId)!
  const rootKey = endpointPlan.monitoredRoots[0]!.rootKey
  const rootKeys = Object.freeze(Object.fromEntries(endpointPlan.monitoredRoots.flatMap((root) =>
    root.mappingIds.map((mappingId) => [mappingId, root.rootKey]),
  )))
  const publications: NormalizedOpcUaClientPublicationV1[] = []
  return {
    publications,
    rootKey,
    rootKeys,
    clock,
    connected() {
      const publication = harness.lifecycle('connected')
      publications.push(publication)
      return publication
    },
    disconnected() {
      const publication = harness.lifecycle('disconnected')
      publications.push(publication)
      return publication
    },
    state(input, statusCode, sourceTimestampMs, mappingId) {
      const values = harness.state({
        rootKey: mappingId === undefined ? rootKey : rootKeys[mappingId]!,
        value: input,
        statusCode,
        sourceTimestampMs,
      })
      publications.push(...values)
      return values
    },
  }
}

function publishAll(
  target: { publish(publication: NormalizedOpcUaClientPublicationV1): boolean | void },
  publications: readonly NormalizedOpcUaClientPublicationV1[],
): void {
  for (const publication of publications) target.publish(publication)
}

function expectExactFramedCut(
  messages: readonly Record<string, unknown>[],
  boundaryType: 'endpoint-replay-boundary-v1' | 'endpoint-catchup-boundary-v1',
): readonly Record<string, unknown>[] {
  expect(messages[0]).toMatchObject({ type: boundaryType, phase: 'start' })
  expect(messages.at(-1)).toMatchObject({ type: boundaryType, phase: 'end' })
  const body = messages.slice(1, -1)
  const encodedBytes = body.reduce(
    (sum, message) => sum + new TextEncoder().encode(JSON.stringify(message)).byteLength,
    0,
  )
  expect(messages[0]).toMatchObject({ messageCount: body.length, encodedBytes })
  expect(messages.at(-1)).toMatchObject({
    messageCount: body.length,
    encodedBytes,
    ...(boundaryType === 'endpoint-replay-boundary-v1'
      ? { replayId: messages[0]!.replayId }
      : { catchupId: messages[0]!.catchupId }),
  })
  expect(body.length).toBeGreaterThan(0)
  return body
}

type ControlledSocketHooksV1 = Readonly<{
  onSend?: (data: string) => void
  onClose?: () => void
  onOff?: (event: 'close' | 'error') => void
}>

class ControlledSocket implements GatewayWebSocketV1 {
  readonly sent: string[] = []
  readonly close: ReturnType<typeof vi.fn<() => void>>
  private readonly listeners = new Map<'close' | 'error', Set<() => void>>()
  private callbacks: Array<(error?: Error) => void> = []
  private readonly hooks: ControlledSocketHooksV1
  constructor(hooks: ControlledSocketHooksV1 = {}) {
    this.hooks = hooks
    this.close = vi.fn<() => void>(() => { this.hooks.onClose?.() })
  }
  send(data: string, callback: (error?: Error) => void): void {
    this.sent.push(data)
    this.callbacks.push(callback)
    this.hooks.onSend?.(data)
  }
  on(event: 'close' | 'error', listener: () => void): void { const set = this.listeners.get(event) ?? new Set(); set.add(listener); this.listeners.set(event, set) }
  off(event: 'close' | 'error', listener: () => void): void {
    this.listeners.get(event)?.delete(listener)
    this.hooks.onOff?.(event)
  }
  complete(error?: Error): boolean {
    const callback = this.callbacks.shift()
    if (callback === undefined) return false
    callback(error)
    return true
  }

  emit(event: 'close' | 'error'): void {
    for (const listener of this.listeners.get(event) ?? []) listener()
  }

  sentMessages(): Array<Record<string, unknown>> {
    return this.sent.map((payload) => JSON.parse(payload) as Record<string, unknown>)
  }

  sentBatches(): StateBatchV1[] {
    return this.sentMessages().filter(({ type }) => type === 'state-batch-v1') as unknown as StateBatchV1[]
  }

  sentSequences(): number[] {
    return this.sentMessages().map(({ sequence }) => sequence as number)
  }
}

function prepare(hub: ReturnType<typeof createStateBatchHubV1>, staged = createRuntimeTimelineStagingV1(), revision = REVISION) {
  return hub.prepareRevisionActivation({
    projectId: 'project-test', configRevision: revision, gatewayId: 'gateway-test',
    originId: 'gateway-test:opcua-client', publisherGeneration: 1, endpointIds: ['endpoint-test'],
    stagedTimeline: staged.seal(),
  })
}

function installAndConnect(hub: ReturnType<typeof createStateBatchHubV1>, source: ReturnType<typeof publicationHarness>): void {
  const prepared = prepare(hub)
  prepared.installPrepared()
  prepared.flushPrepared()
  expect(hub.publish(source.publications[0]!)).toBe(true)
}

function publishLatest(hub: ReturnType<typeof createStateBatchHubV1>, source: ReturnType<typeof publicationHarness>): void {
  expect(hub.publish(source.publications[source.publications.length - 1]!)).toBe(true)
}

function drain(socket: ControlledSocket): void {
  while (socket.complete()) { /* deterministic test socket */ }
}

function rawValue(index: number, coherenceGroupId: string | null = null) {
  return {
    mappingId: `mapping-${index}`,
    coherenceGroupId,
    value: index,
    unit: '',
    quality: 'GOOD' as const,
    statusCode: 'Good',
  }
}

/** These raw envelopes are intentionally limited to direct splitter tests. */
function rawBatch(sequence: number, overrides: Partial<StateBatchV1> = {}): StateBatchV1 {
  return {
    type: 'state-batch-v1', protocolVersion: 1, gatewayId: 'gateway-test',
    projectId: 'project-test', configRevision: REVISION, endpointId: 'endpoint-test',
    sequence, sourceTimestampMs: sequence, publishedTimestampMs: sequence,
    originId: 'gateway-test:opcua-client', values: [rawValue(sequence)], ...overrides,
  }
}

describe('StateBatchHubV1 opaque lifecycle timeline', () => {
  it('rejects raw and forged values before queue/cache mutation', () => {
    const hub = createStateBatchHubV1()
    const prepared = prepare(hub)
    prepared.installPrepared()
    prepared.flushPrepared()
    const socket = new ControlledSocket()
    hub.attach(socket)
    const source = publicationHarness()
    const real = source.publications[0]!
    const raw = readNormalizedOpcUaClientPublicationV1(real)

    expect(hub.publish(raw as never)).toBe(false)
    expect(hub.publish({ message: raw } as never)).toBe(false)
    expect(socket.sent).toEqual([])
    expect(hub.queueDepth(socket)).toBe(0)
    source.stop()
  })

  it('stages real adapter publications, coalesces the candidate cut, then flushes only after install', () => {
    const source = publicationHarness()
    source.emit(false)
    source.emit(true)
    const staging = createRuntimeTimelineStagingV1()
    for (const publication of source.publications) staging.publish(publication)
    const hub = createStateBatchHubV1()
    const initial = prepare(hub)
    initial.installPrepared()
    initial.flushPrepared()
    const socket = new ControlledSocket()
    hub.attach(socket)
    const prepared = prepare(hub, staging)

    prepared.installPrepared()
    expect(socket.sent).toEqual([])
    prepared.flushPrepared()
    while (socket.complete()) { /* drain the deterministic socket queue */ }
    const messages = socket.sent.map((value) => JSON.parse(value) as { type: string; values?: { value: unknown }[] })
    expectExactFramedCut(messages, 'endpoint-catchup-boundary-v1')
    expect(messages.map(({ type }) => type)).toContain('endpoint-lifecycle-v1')
    expect(messages.filter(({ type }) => type === 'state-batch-v1')).toHaveLength(1)
    expect(messages.find(({ type }) => type === 'state-batch-v1')?.values?.[0]?.value).toBe(true)
    source.stop()
  })

  it('seals P1(A1,B1) then P2(A2) as exact B1,A2 frames without retaining A1', () => {
    const pairProject = scenarioProject({ mappingIds: ['mapping-a', 'mapping-b'], valueKind: 'string' })
    const aOnlyProject = scenarioProject({ mappingIds: ['mapping-a'], valueKind: 'string' })
    const pair = scenarioHarness(pairProject, 'endpoint-test', 2)
    const aOnly = scenarioHarness(aOnlyProject, 'endpoint-test', 2)
    const staging = createRuntimeTimelineStagingV1()
    staging.publish(pair.connected())
    publishAll(staging, pair.state({ 'mapping-a': 'A1', 'mapping-b': 'B1' }, 'Good', 1))
    aOnly.connected()
    aOnly.state('discarded', 'Good', 1)
    publishAll(staging, aOnly.state('A2', 'Good', 2))

    const hub = createStateBatchHubV1()
    const initial = prepare(hub); initial.installPrepared(); initial.flushPrepared()
    const socket = new ControlledSocket(); hub.attach(socket)
    const prepared = hub.prepareRevisionActivation({
      projectId: 'project-test', configRevision: REVISION, gatewayId: 'gateway-test',
      originId: 'gateway-test:opcua-client', publisherGeneration: 2, endpointIds: ['endpoint-test'],
      stagedTimeline: staging.seal(),
    })
    prepared.installPrepared(); prepared.flushPrepared(); drain(socket)

    const body = expectExactFramedCut(socket.sentMessages(), 'endpoint-catchup-boundary-v1')
    const stateFrames = body.filter(({ type }) => type === 'state-batch-v1')
    expect(stateFrames.flatMap(({ values }) =>
      (values as Array<{ mappingId: string; value: unknown }>).map(({ mappingId, value }) => ({ mappingId, value })),
    )).toEqual([
      { mappingId: 'mapping-b', value: 'B1' },
      { mappingId: 'mapping-a', value: 'A2' },
    ])
    expect(JSON.stringify(stateFrames)).not.toContain('A1')
  })

  it('retains a blocked lifecycle barrier rather than dropping it', () => {
    const source = publicationHarness()
    source.emit(true)
    source.stop()
    const hub = createStateBatchHubV1()
    const prepared = prepare(hub)
    prepared.installPrepared()
    prepared.flushPrepared()
    const socket = new ControlledSocket()
    hub.attach(socket)
    for (const publication of source.publications) hub.publish(publication)
    while (socket.complete()) { /* drain */ }
    expect(socket.sentMessages().map(({ type, phase }) => `${type}:${phase ?? ''}`)).toEqual([
      'endpoint-lifecycle-v1:connected',
      'endpoint-catchup-boundary-v1:start',
      'state-batch-v1:',
      'endpoint-lifecycle-v1:disconnected',
      'endpoint-catchup-boundary-v1:end',
    ])
  })

  it('detaches old sockets synchronously before a different revision flush closes them', () => {
    const hub = createStateBatchHubV1()
    const first = prepare(hub)
    first.installPrepared(); first.flushPrepared()
    const socket = new ControlledSocket()
    hub.attach(socket)
    const second = prepare(hub, createRuntimeTimelineStagingV1(), 'b'.repeat(64))
    second.installPrepared()
    expect(socket.close).not.toHaveBeenCalled()
    second.flushPrepared()
    expect(socket.close).toHaveBeenCalledOnce()
  })

  it('keeps one in-flight State and coalesces its pending channel to the newest real publication', () => {
    const source = publicationHarness()
    const hub = createStateBatchHubV1()
    installAndConnect(hub, source)
    const socket = new ControlledSocket()
    hub.attach(socket)
    drain(socket)
    source.emit(true)
    publishLatest(hub, source)
    source.emit(false)
    publishLatest(hub, source)
    source.emit(true)
    publishLatest(hub, source)

    expect(socket.sentBatches()).toHaveLength(1)
    expect(hub.queueDepth(socket)).toBe(2)
    socket.complete()
    drain(socket)
    expect(socket.sentBatches()).toHaveLength(2)
    expect(socket.sentBatches()[1]?.values[0]?.value).toBe(true)
    expect(hub.queueDepth(socket)).toBe(0)
  })

  it('closes and detaches browser sessions during deactivation', () => {
    const source = publicationHarness()
    const hub = createStateBatchHubV1()
    installAndConnect(hub, source)
    const socket = new ControlledSocket()
    hub.attach(socket)
    hub.deactivateRevision()
    expect(socket.close).toHaveBeenCalledOnce()
    expect(hub.queueDepth(socket)).toBe(0)
  })

  it('detaches failed and closed sockets without retaining pending payloads', () => {
    const source = publicationHarness()
    const hub = createStateBatchHubV1()
    installAndConnect(hub, source)
    const failed = new ControlledSocket()
    const closed = new ControlledSocket()
    hub.attach(failed)
    const detach = hub.attach(closed)
    drain(failed)
    drain(closed)
    source.emit(true)
    publishLatest(hub, source)
    source.emit(false)
    publishLatest(hub, source)
    failed.complete(new Error('slow browser disappeared'))
    closed.emit('close')
    detach()
    expect(hub.queueDepth(failed)).toBe(0)
    expect(hub.queueDepth(closed)).toBe(0)
  })

  it('keeps coherence groups intact while splitter forms bounded chunks', () => {
    const values = Array.from({ length: 129 }, (_, index) => rawValue(index, index >= 127 ? 'last-group' : null))
    const split = splitStateBatchesV1(rawBatch(1, { values }))
    expect(split.map(({ values: chunk }) => chunk.length)).toEqual([127, 2])
    expect(split.flatMap(({ values: chunk }) => chunk.map(({ mappingId }) => mappingId)))
      .toEqual(values.map(({ mappingId }) => mappingId))
  })

  it.each([[128, [128]], [129, [128, 1]]])(
    'splits exactly %i source values into %j bounded chunks',
    (count, expectedChunkSizes) => {
      expect(splitStateBatchesV1(rawBatch(1, {
        values: Array.from({ length: count }, (_, index) => rawValue(index)),
      })).map(({ values }) => values.length)).toEqual(expectedChunkSizes)
    },
  )

  it('rejects duplicate mapping IDs across direct splitter chunks before splitting', () => {
    const values = Array.from({ length: 129 }, (_, index) => rawValue(index))
    values[128] = { ...values[128]!, mappingId: values[0]!.mappingId }
    expect(() => splitStateBatchesV1(rawBatch(1, { values }))).toThrow(/RUNTIME_STATE_MAPPING_DUPLICATE/)
  })

  it('bounds splitter serialization work to one value encoding per source mapping', () => {
    const stringify = vi.spyOn(JSON, 'stringify')
    try {
      splitStateBatchesV1(rawBatch(1, { values: Array.from({ length: 128 }, (_, index) => rawValue(index)) }))
      expect(stringify.mock.calls.length).toBeLessThanOrEqual(130)
    } finally {
      stringify.mockRestore()
    }
  })

  it('rejects a coherence group whose encoded envelope exceeds the wire budget', () => {
    expect(() => splitStateBatchesV1(rawBatch(1, {
      values: [{ ...rawValue(0, 'oversized'), value: 'x'.repeat(256 * 1024) }],
    }))).toThrow(/RUNTIME_STATE_BATCH_SIZE_EXCEEDED/)
  })

  it('rejects a delayed real source sequence after a later accepted publication', () => {
    const source = publicationHarness()
    const hub = createStateBatchHubV1()
    installAndConnect(hub, source)
    const socket = new ControlledSocket()
    hub.attach(socket)
    drain(socket)
    source.emit(false)
    const sequenceTwo = source.publications[source.publications.length - 1]!
    source.emit(true)
    const sequenceThree = source.publications[source.publications.length - 1]!
    expect(hub.publish(sequenceThree)).toBe(true)
    expect(hub.publish(sequenceTwo)).toBe(false)
    drain(socket)
    expect(socket.sentBatches()[0]?.values[0]?.value).toBe(true)
  })

  it('stays bounded across a sustained blocked publication burst', () => {
    const source = publicationHarness()
    const hub = createStateBatchHubV1()
    installAndConnect(hub, source)
    const socket = new ControlledSocket()
    hub.attach(socket)
    drain(socket)
    for (let sequence = 1; sequence <= 1_000; sequence += 1) {
      source.emit(sequence % 2 === 0)
      publishLatest(hub, source)
    }
    expect(socket.sentBatches()).toHaveLength(1)
    expect(hub.queueDepth(socket)).toBe(2)
    socket.complete()
    drain(socket)
    expect(socket.sentBatches()).toHaveLength(2)
    expect(hub.queueDepth(socket)).toBe(0)
  })

  it('replays the newest active endpoint snapshot to a browser that attaches after publication', () => {
    const source = publicationHarness()
    const hub = createStateBatchHubV1()
    installAndConnect(hub, source)
    source.emit(false)
    publishLatest(hub, source)
    source.emit(true)
    publishLatest(hub, source)
    const socket = new ControlledSocket()
    hub.attach(socket)
    drain(socket)
    expect(socket.sentBatches()[0]).toMatchObject({ values: [expect.objectContaining({ value: true })] })
  })

  it('replays a reconnect snapshot with a fresh monotonic hub wire sequence', () => {
    const source = publicationHarness()
    const hub = createStateBatchHubV1()
    installAndConnect(hub, source)
    source.emit(false)
    publishLatest(hub, source)
    const first = new ControlledSocket()
    hub.attach(first)
    drain(first)
    first.emit('close')
    source.emit(true)
    publishLatest(hub, source)
    const reconnect = new ControlledSocket()
    hub.attach(reconnect)
    drain(reconnect)
    expect(reconnect.sentBatches()[0]).toMatchObject({ values: [expect.objectContaining({ value: true })] })
    expect(reconnect.sentSequences()).toEqual([...reconnect.sentSequences()].sort((left, right) => left - right))
  })

  it('rejects State before C and after D without mutating the socket queue', () => {
    const source = publicationHarness()
    const hub = createStateBatchHubV1()
    const prepared = prepare(hub)
    prepared.installPrepared()
    prepared.flushPrepared()
    const socket = new ControlledSocket()
    hub.attach(socket)
    source.emit(true)
    expect(hub.publish(source.publications[1]!)).toBe(false)
    expect(hub.queueDepth(socket)).toBe(0)
    expect(hub.publish(source.publications[0]!)).toBe(true)
    expect(hub.publish(source.publications[1]!)).toBe(true)
    source.stop()
    publishLatest(hub, source)
    source.emit(false)
    expect(hub.publish(source.publications[source.publications.length - 1]!)).toBe(false)
  })

  it('keeps blocked reconnect lifecycle framing before later State and disconnect barriers', () => {
    const source = publicationHarness()
    const hub = createStateBatchHubV1()
    installAndConnect(hub, source)
    const socket = new ControlledSocket()
    hub.attach(socket)
    drain(socket)
    source.emit(true)
    publishLatest(hub, source)
    source.reconnect()
    publishLatest(hub, source)
    source.emit(false)
    publishLatest(hub, source)
    source.stop()
    publishLatest(hub, source)
    drain(socket)
    expect(socket.sentMessages().map(({ type, phase }) => `${type}:${phase ?? ''}`)).toEqual([
      'endpoint-replay-boundary-v1:start',
      'endpoint-lifecycle-v1:connected',
      'endpoint-replay-boundary-v1:end',
      'state-batch-v1:',
      'endpoint-catchup-boundary-v1:start',
      'endpoint-lifecycle-v1:connected',
      'state-batch-v1:',
      'endpoint-lifecycle-v1:disconnected',
      'endpoint-catchup-boundary-v1:end',
    ])
  })

  it('accepts an exact-byte source envelope in direct splitter coverage', () => {
    const source = rawBatch(2, { values: [{ ...rawValue(1), value: '' }] })
    const padding = MAX_RUNTIME_BATCH_BYTES_V1 - new TextEncoder().encode(JSON.stringify(source)).byteLength
    const exact = { ...source, values: [{ ...source.values[0]!, value: 'x'.repeat(padding) }] }
    expect(() => splitStateBatchesV1(exact, 2)).not.toThrow()
    expect(() => splitStateBatchesV1(exact, 11)).toThrow(/RUNTIME_STATE_BATCH_SIZE_EXCEEDED/)
  })

  it('replays lifecycle prefix, retained current snapshot, and disconnect suffix to a fresh browser', () => {
    const source = publicationHarness()
    const hub = createStateBatchHubV1()
    installAndConnect(hub, source)
    source.emit(true)
    publishLatest(hub, source)
    source.stop()
    publishLatest(hub, source)
    const fresh = new ControlledSocket()
    hub.attach(fresh)
    drain(fresh)
    expect(fresh.sentMessages().map(({ type, phase }) => `${type}:${phase ?? ''}`)).toEqual([
      'endpoint-replay-boundary-v1:start',
      'endpoint-lifecycle-v1:connected',
      'state-batch-v1:',
      'endpoint-lifecycle-v1:disconnected',
      'endpoint-replay-boundary-v1:end',
    ])
  })

  it('does not replay a stale prior revision after a different-revision prepared activation', () => {
    const source = publicationHarness()
    const hub = createStateBatchHubV1()
    installAndConnect(hub, source)
    source.emit(true)
    publishLatest(hub, source)
    const next = prepare(hub, createRuntimeTimelineStagingV1(), NEXT_REVISION)
    next.installPrepared()
    next.flushPrepared()
    const fresh = new ControlledSocket()
    hub.attach(fresh)
    expect(fresh.sent).toEqual([])
  })

  it('keeps wire sequence unique across live State, lifecycle barriers, and replay', () => {
    const source = publicationHarness()
    const hub = createStateBatchHubV1()
    installAndConnect(hub, source)
    const live = new ControlledSocket()
    hub.attach(live)
    drain(live)
    source.emit(true)
    publishLatest(hub, source)
    source.stop()
    publishLatest(hub, source)
    drain(live)
    const fresh = new ControlledSocket()
    hub.attach(fresh)
    drain(fresh)
    const sequences = [...live.sentSequences(), ...fresh.sentSequences()]
    expect(new Set(sequences).size).toBe(sequences.length)
  })

  it('accepts disconnect only for the exact active publisher/session generation', () => {
    const source = publicationHarness()
    const hub = createStateBatchHubV1()
    installAndConnect(hub, source)
    const wrongPublisher = scenarioHarness(undefined, undefined, 2)
    wrongPublisher.connected()
    expect(hub.publish(wrongPublisher.disconnected())).toBe(false)
    source.stop()
    expect(hub.publish(source.publications[1]!)).toBe(true)
  })

  it('keeps prepared timeline handles single-use', () => {
    const timeline = createRuntimeTimelineStagingV1()
    const hub = createStateBatchHubV1()
    const sealed = timeline.seal()
    const first = hub.prepareRevisionActivation({
      projectId: 'project-test', configRevision: REVISION, gatewayId: 'gateway-test',
      originId: 'gateway-test:opcua-client', publisherGeneration: 1, endpointIds: ['endpoint-test'], stagedTimeline: sealed,
    })
    first.installPrepared()
    expect(() => hub.prepareRevisionActivation({
      projectId: 'project-test', configRevision: REVISION, gatewayId: 'gateway-test',
      originId: 'gateway-test:opcua-client', publisherGeneration: 1, endpointIds: ['endpoint-test'], stagedTimeline: sealed,
    })).toThrow(/Sealed Runtime timeline is invalid/)
  })

  it('frames replay and blocked catch-up cuts with exact UTF-8 body metadata and preserves in-flight A -> pending B -> D physical order', () => {
    const source = scenarioHarness()
    const hub = createStateBatchHubV1()
    const prepared = prepare(hub)
    prepared.installPrepared(); prepared.flushPrepared()
    expect(hub.publish(source.connected())).toBe(true)
    const socket = new ControlledSocket()
    hub.attach(socket)
    drain(socket)
    expectExactFramedCut(socket.sentMessages(), 'endpoint-replay-boundary-v1')

    const beforeLive = socket.sent.length
    publishAll(hub, source.state(true, 'Good', 100))
    publishAll(hub, source.state(false, 'Good', 101))
    expect(hub.publish(source.disconnected())).toBe(true)
    expect(socket.sent.slice(beforeLive).map((payload) => (JSON.parse(payload) as { type: string }).type)).toEqual([
      'state-batch-v1',
    ])
    socket.complete()
    drain(socket)
    const physical = socket.sent.slice(beforeLive).map((payload) => JSON.parse(payload) as Record<string, unknown>)
    expect(physical.map(({ type, phase }) => `${type}:${phase ?? ''}`)).toEqual([
      'state-batch-v1:',
      'endpoint-catchup-boundary-v1:start',
      'state-batch-v1:',
      'endpoint-lifecycle-v1:disconnected',
      'endpoint-catchup-boundary-v1:end',
    ])
    expectExactFramedCut(physical.slice(1), 'endpoint-catchup-boundary-v1')

    let actionable = false
    let buffered: Record<string, unknown>[] = []
    let insideCatchup = false
    const observed: boolean[] = []
    for (const message of physical.slice(1)) {
      if (message.type === 'endpoint-catchup-boundary-v1' && message.phase === 'start') {
        insideCatchup = true
        buffered = []
      } else if (message.type === 'endpoint-catchup-boundary-v1' && message.phase === 'end') {
        for (const body of buffered) {
          if (body.type === 'state-batch-v1') actionable = (body.values as Array<{ quality: string }>)[0]?.quality === 'GOOD'
          if (body.type === 'endpoint-lifecycle-v1' && body.phase === 'disconnected') actionable = false
        }
        insideCatchup = false
      } else if (insideCatchup) {
        buffered.push(message)
      }
      observed.push(actionable)
    }
    expect(observed).toEqual(observed.map(() => false))
  })

  it('reconstructs GOOD payload plus latest non-GOOD quality and rejects regressing or impossible PLC clocks for live and replay', () => {
    const source = scenarioHarness(undefined, undefined, 1, { now: 100 })
    const hub = createStateBatchHubV1()
    const prepared = prepare(hub); prepared.installPrepared(); prepared.flushPrepared()
    expect(hub.publish(source.connected())).toBe(true)
    publishAll(hub, source.state(true, 'Good', 100))
    source.clock.now = 101
    publishAll(hub, source.state(false, 'BadNoCommunication', 101))
    expect(hub.publish(source.disconnected())).toBe(true)
    const replay = new ControlledSocket()
    hub.attach(replay); drain(replay)
    const body = expectExactFramedCut(replay.sentMessages(), 'endpoint-replay-boundary-v1')
    const states = body.filter(({ type }) => type === 'state-batch-v1') as unknown as StateBatchV1[]
    expect(states.map(({ values }) => ({ value: values[0]!.value, quality: values[0]!.quality }))).toEqual([
      { value: true, quality: 'GOOD' },
      { value: true, quality: 'BAD' },
    ])

    const lower = scenarioHarness(undefined, undefined, 1, { now: 200 })
    const lowerHub = createStateBatchHubV1()
    const lowerPrepared = prepare(lowerHub); lowerPrepared.installPrepared(); lowerPrepared.flushPrepared()
    expect(lowerHub.publish(lower.connected())).toBe(true)
    publishAll(lowerHub, lower.state(true, 'Good', 100))
    lower.clock.now = 201
    const regressing = lower.state(false, 'Good', 50)[0]!
    expect(lowerHub.publish(regressing)).toBe(false)
    const lowerReplay = new ControlledSocket(); lowerHub.attach(lowerReplay); drain(lowerReplay)
    expect(lowerReplay.sentBatches().flatMap(({ values }) => values.map(({ value }) => value))).toEqual([true])

    const impossible = scenarioHarness(undefined, undefined, 1, { now: 50 })
    const impossibleHub = createStateBatchHubV1()
    const impossiblePrepared = prepare(impossibleHub); impossiblePrepared.installPrepared(); impossiblePrepared.flushPrepared()
    expect(impossibleHub.publish(impossible.connected())).toBe(true)
    expect(impossibleHub.publish(impossible.state(true, 'Good', 100)[0]!)).toBe(false)
    const impossibleReplay = new ControlledSocket(); impossibleHub.attach(impossibleReplay); drain(impossibleReplay)
    expect(impossibleReplay.sentBatches()).toEqual([])
  })

  it('admits independent groups independently while rejecting stale coherence siblings atomically', () => {
    const independentProject = scenarioProject({ mappingIds: ['mapping-a', 'mapping-b'] })
    const independent = scenarioHarness(independentProject)
    const hub = createStateBatchHubV1()
    const prepared = prepare(hub); prepared.installPrepared(); prepared.flushPrepared()
    expect(hub.publish(independent.connected())).toBe(true)
    publishAll(hub, independent.state({ 'mapping-a': true }, 'Good', 100))
    publishAll(hub, independent.state({ 'mapping-a': false, 'mapping-b': true }, 'Good', 50))
    const replay = new ControlledSocket(); hub.attach(replay); drain(replay)
    const accepted = replay.sentBatches().flatMap(({ values }) => values.map(({ mappingId, value }) => ({ mappingId, value })))
    expect(accepted).toContainEqual({ mappingId: 'mapping-a', value: true })
    expect(accepted).toContainEqual({ mappingId: 'mapping-b', value: true })
    expect(accepted).not.toContainEqual({ mappingId: 'mapping-a', value: false })

    const coherentProject = scenarioProject({ mappingIds: ['mapping-a', 'mapping-b'], coherenceGroupId: 'pair' })
    const coherent = scenarioHarness(coherentProject)
    const coherentHub = createStateBatchHubV1()
    const coherentPrepared = prepare(coherentHub); coherentPrepared.installPrepared(); coherentPrepared.flushPrepared()
    expect(coherentHub.publish(coherent.connected())).toBe(true)
    publishAll(coherentHub, coherent.state({ 'mapping-a': true }, 'Good', 100))
    publishAll(coherentHub, coherent.state({ 'mapping-a': false, 'mapping-b': true }, 'Good', 50))
    const coherentReplay = new ControlledSocket(); coherentHub.attach(coherentReplay); drain(coherentReplay)
    expect(coherentReplay.sentBatches().flatMap(({ values }) => values.map(({ mappingId }) => mappingId))).toEqual(['mapping-a'])
  })

  it('replays sparse A/B prefix reconstruction across three PLC clock-reset sessions', () => {
    const sourceProject = scenarioProject({ mappingIds: ['mapping-a', 'mapping-b'], sharedRoot: false })
    const source = scenarioHarness(sourceProject, 'endpoint-test', 1, { now: 100_000 })
    const hub = createStateBatchHubV1()
    const prepared = prepare(hub); prepared.installPrepared(); prepared.flushPrepared()
    expect(hub.publish(source.connected())).toBe(true)
    publishAll(hub, source.state(true, 'Good', 90_000, 'mapping-b'))
    expect(hub.publish(source.disconnected())).toBe(true)
    source.clock.now += 1
    expect(hub.publish(source.connected())).toBe(true)
    publishAll(hub, source.state(true, 'Good', 1_000, 'mapping-a'))
    expect(hub.publish(source.disconnected())).toBe(true)
    source.clock.now += 1
    expect(hub.publish(source.connected())).toBe(true)
    expect(hub.publish(source.disconnected())).toBe(true)

    const replay = new ControlledSocket(); hub.attach(replay); drain(replay)
    const body = expectExactFramedCut(replay.sentMessages(), 'endpoint-replay-boundary-v1')
    expect(body.map(({ type, phase }) => `${type}:${phase ?? ''}`)).toEqual([
      'state-batch-v1:', 'state-batch-v1:', 'endpoint-lifecycle-v1:connected', 'endpoint-lifecycle-v1:disconnected',
    ])
    expect((body.slice(0, 2) as unknown as StateBatchV1[]).flatMap(({ values }) => values.map(({ mappingId }) => mappingId)).sort())
      .toEqual(['mapping-a', 'mapping-b'])
  })

  it.each([
    [['z-endpoint', 'a-endpoint']],
    [['a-endpoint', 'z-endpoint']],
  ])('replays two Endpoints in lexical order while one disconnects and the other stays GOOD (activation order %j)', (endpointIds) => {
    const sourceProject = scenarioProject({ endpointIds, mappingIds: ['mapping'] })
    const a = scenarioHarness(sourceProject, 'a-endpoint')
    const z = scenarioHarness(sourceProject, 'z-endpoint')
    const hub = createStateBatchHubV1()
    const staged = createRuntimeTimelineStagingV1()
    const prepared = hub.prepareRevisionActivation({
      projectId: 'project-test', configRevision: REVISION, gatewayId: 'gateway-test',
      originId: 'gateway-test:opcua-client', publisherGeneration: 1, endpointIds,
      stagedTimeline: staged.seal(),
    })
    prepared.installPrepared(); prepared.flushPrepared()
    expect(hub.publish(z.connected())).toBe(true)
    publishAll(hub, z.state(true, 'Good', 10))
    expect(hub.publish(a.connected())).toBe(true)
    publishAll(hub, a.state(true, 'Good', 10))
    expect(hub.publish(a.disconnected())).toBe(true)
    const socket = new ControlledSocket(); hub.attach(socket); drain(socket)
    const starts = socket.sentMessages().filter(({ type, phase }) => type === 'endpoint-replay-boundary-v1' && phase === 'start')
    expect(starts.map(({ endpointId }) => endpointId)).toEqual(['a-endpoint', 'z-endpoint'])
    const byEndpoint = new Map<string, Array<Record<string, unknown>>>()
    for (const message of socket.sentMessages()) {
      const endpointId = message.endpointId as string
      const messages = byEndpoint.get(endpointId) ?? []
      messages.push(message)
      byEndpoint.set(endpointId, messages)
    }
    expect(byEndpoint.get('a-endpoint')?.some((message) => message.phase === 'disconnected')).toBe(true)
    expect(byEndpoint.get('z-endpoint')?.some((message) => message.phase === 'disconnected')).toBe(false)
  })

  it('isolates pending barrier/byte overflow, makes candidate overflow sticky, and evicts cache LRU without dropping lifecycle', () => {
    const source = scenarioHarness()
    const hub = createStateBatchHubV1()
    const prepared = prepare(hub); prepared.installPrepared(); prepared.flushPrepared()
    expect(hub.publish(source.connected())).toBe(true)
    const slow = new ControlledSocket(); hub.attach(slow); drain(slow)
    publishAll(hub, source.state(true, 'Good', 1))
    for (let index = 0; index < 17; index += 1) {
      expect(hub.publish(source.disconnected())).toBe(true)
      expect(hub.publish(source.connected())).toBe(true)
    }
    expect(slow.close).toHaveBeenCalledOnce()
    expect(hub.queueDepth(slow)).toBe(0)

    const candidateSource = scenarioHarness()
    const staging = createRuntimeTimelineStagingV1()
    for (let index = 0; index < 17; index += 1) {
      staging.publish(candidateSource.connected())
      staging.publish(candidateSource.disconnected())
    }
    expect(() => staging.assertHealthy()).toThrow(/RUNTIME_STREAM_BARRIER_CAPACITY_EXCEEDED/)
    const beforeIgnored = candidateSource.publications.length
    staging.publish(candidateSource.connected())
    expect(candidateSource.publications).toHaveLength(beforeIgnored + 1)
    expect(() => staging.seal()).toThrow(/RUNTIME_STREAM_BARRIER_CAPACITY_EXCEEDED/)

    const mappingIds = Array.from({ length: 10 }, (_, index) => `mapping-${index}`)
    const largeProject = scenarioProject({ mappingIds, valueKind: 'string', sharedRoot: false })
    const large = scenarioHarness(largeProject)
    const cacheHub = createStateBatchHubV1()
    const cachePrepared = prepare(cacheHub); cachePrepared.installPrepared(); cachePrepared.flushPrepared()
    expect(cacheHub.publish(large.connected())).toBe(true)
    const byteSlow = new ControlledSocket(); cacheHub.attach(byteSlow); drain(byteSlow)
    const largeValue = 'x'.repeat(240_000)
    for (const [index, mappingId] of mappingIds.entries()) {
      large.clock.now += 1
      publishAll(cacheHub, large.state(`${index}${largeValue}`, 'Good', index + 1, mappingId))
    }
    expect(byteSlow.close).toHaveBeenCalledOnce()
    expect(cacheHub.queueDepth(byteSlow)).toBe(0)
    const cacheReplay = new ControlledSocket(); cacheHub.attach(cacheReplay); drain(cacheReplay)
    const replayedIds = cacheReplay.sentBatches().flatMap(({ values }) => values.map(({ mappingId }) => mappingId))
    expect(replayedIds).not.toContain('mapping-0')
    expect(replayedIds).toContain('mapping-9')
    expect(cacheReplay.sentMessages().some(({ type, phase }) => type === 'endpoint-lifecycle-v1' && phase === 'connected')).toBe(true)
  })

  it('enforces the 128-effective-channel cache cap with deterministic group LRU eviction', () => {
    const hub = createStateBatchHubV1()
    const prepared = prepare(hub); prepared.installPrepared(); prepared.flushPrepared()
    const first = scenarioHarness(scenarioProject({ mappingIds: ['mapping-0'] }))
    expect(hub.publish(first.connected())).toBe(true)
    for (let index = 0; index < 129; index += 1) {
      const mappingId = `mapping-${index}`
      const source = scenarioHarness(scenarioProject({ mappingIds: [mappingId] }))
      source.connected()
      let latest: NormalizedOpcUaClientPublicationV1 | undefined
      for (let sequence = 0; sequence <= index; sequence += 1) {
        latest = source.state(sequence % 2 === 0, 'Good', index + 1)[0]
      }
      expect(latest).toBeDefined()
      expect(hub.publish(latest!)).toBe(true)
    }
    const replay = new ControlledSocket(); hub.attach(replay); drain(replay)
    const mappingIds = replay.sentBatches().flatMap(({ values }) => values.map(({ mappingId }) => mappingId))
    expect(new Set(mappingIds).size).toBe(128)
    expect(mappingIds).not.toContain('mapping-0')
    expect(mappingIds).toContain('mapping-128')
  })

  it('keeps same-revision sockets/replay across online, never-connect, and truthful disconnected rollback replacement cuts', () => {
    const oldSource = scenarioHarness(undefined, undefined, 1)
    const hub = createStateBatchHubV1()
    const initial = prepare(hub); initial.installPrepared(); initial.flushPrepared()
    expect(hub.publish(oldSource.connected())).toBe(true)
    publishAll(hub, oldSource.state(true, 'Good', 1))
    const socket = new ControlledSocket(); hub.attach(socket); drain(socket)
    const beforeReplacement = socket.sent.length
    expect(hub.publish(oldSource.disconnected())).toBe(true)
    drain(socket)

    const candidate = scenarioHarness(undefined, undefined, 2)
    const staging = createRuntimeTimelineStagingV1()
    staging.publish(candidate.connected())
    publishAll(staging, candidate.state(false, 'Good', 1))
    const online = hub.prepareRevisionActivation({
      projectId: 'project-test', configRevision: REVISION, gatewayId: 'gateway-test',
      originId: 'gateway-test:opcua-client', publisherGeneration: 2, endpointIds: ['endpoint-test'],
      stagedTimeline: staging.seal(),
    })
    online.installPrepared()
    expect(socket.sent).toHaveLength(beforeReplacement + 1)
    online.flushPrepared(); drain(socket)
    const onlineFrames = socket.sentMessages().slice(beforeReplacement + 1)
    expectExactFramedCut(onlineFrames, 'endpoint-catchup-boundary-v1')

    expect(hub.publish(candidate.disconnected())).toBe(true)
    drain(socket)
    const neverConnect = hub.prepareRevisionActivation({
      projectId: 'project-test', configRevision: REVISION, gatewayId: 'gateway-test',
      originId: 'gateway-test:opcua-client', publisherGeneration: 3, endpointIds: ['endpoint-test'],
      stagedTimeline: createRuntimeTimelineStagingV1().seal(),
    })
    neverConnect.installPrepared(); neverConnect.flushPrepared()
    const fresh = new ControlledSocket(); hub.attach(fresh); drain(fresh)
    const replayBody = expectExactFramedCut(fresh.sentMessages(), 'endpoint-replay-boundary-v1')
    expect(replayBody.at(-1)).toMatchObject({ type: 'endpoint-lifecycle-v1', phase: 'disconnected' })
    expect(fresh.sentBatches().some(({ values }) => values.some(({ value }) => value === false))).toBe(true)
  })

  it('preserves A then old B/D then staged C/State then send-reentrant live chronology across same-Revision install', () => {
    const sourceProject = scenarioProject({ mappingIds: ['mapping-a'], valueKind: 'string' })
    const oldSource = scenarioHarness(sourceProject, 'endpoint-test', 1)
    const candidate = scenarioHarness(sourceProject, 'endpoint-test', 2)
    const hub = createStateBatchHubV1()
    const initial = prepare(hub); initial.installPrepared(); initial.flushPrepared()
    expect(hub.publish(oldSource.connected())).toBe(true)

    let injected = false
    const socket = new ControlledSocket({
      onSend: (payload) => {
        const message = JSON.parse(payload) as Record<string, unknown>
        if (!injected && message.type === 'endpoint-catchup-boundary-v1' && message.phase === 'start') {
          injected = true
          publishAll(hub, candidate.state('LIVE', 'Good', 2))
        }
      },
    })
    hub.attach(socket); drain(socket)
    const offset = socket.sent.length

    publishAll(hub, oldSource.state('A', 'Good', 1))
    publishAll(hub, oldSource.state('B', 'Good', 2))
    expect(hub.publish(oldSource.disconnected())).toBe(true)
    expect(socket.sentMessages().slice(offset).map(({ type }) => type)).toEqual(['state-batch-v1'])

    const staging = createRuntimeTimelineStagingV1()
    staging.publish(candidate.connected())
    publishAll(staging, candidate.state('C', 'Good', 1))
    const replacement = hub.prepareRevisionActivation({
      projectId: 'project-test', configRevision: REVISION, gatewayId: 'gateway-test',
      originId: 'gateway-test:opcua-client', publisherGeneration: 2, endpointIds: ['endpoint-test'],
      stagedTimeline: staging.seal(),
    })
    replacement.installPrepared(); replacement.flushPrepared()
    expect(socket.sentMessages().slice(offset).map(({ type }) => type)).toEqual(['state-batch-v1'])

    expect(socket.complete()).toBe(true)
    drain(socket)
    const physical = socket.sentMessages().slice(offset)
    const signature = physical.map((message) => {
      const value = message.type === 'state-batch-v1'
        ? (message.values as Array<{ value: unknown }>)[0]?.value
        : ''
      return `${message.type}:${message.phase ?? ''}:${value ?? ''}`
    })
    expect(signature).toEqual([
      'state-batch-v1::A',
      'endpoint-catchup-boundary-v1:start:',
      'state-batch-v1::B',
      'endpoint-lifecycle-v1:disconnected:',
      'endpoint-catchup-boundary-v1:end:',
      'endpoint-catchup-boundary-v1:start:',
      'endpoint-lifecycle-v1:connected:',
      'state-batch-v1::C',
      'endpoint-catchup-boundary-v1:end:',
      'endpoint-catchup-boundary-v1:start:',
      'state-batch-v1::LIVE',
      'endpoint-catchup-boundary-v1:end:',
    ])
    expectExactFramedCut(physical.slice(1, 5), 'endpoint-catchup-boundary-v1')
    expectExactFramedCut(physical.slice(5, 9), 'endpoint-catchup-boundary-v1')
    expectExactFramedCut(physical.slice(9), 'endpoint-catchup-boundary-v1')
    expect(injected).toBe(true)
    expect(socket.sentSequences()).toEqual([...socket.sentSequences()].sort((left, right) => left - right))

    const fresh = new ControlledSocket(); hub.attach(fresh); drain(fresh)
    const liveFinal = socket.sentBatches().at(-1)?.values[0]?.value
    const replayFinal = fresh.sentBatches().at(-1)?.values[0]?.value
    expect(liveFinal).toBe('LIVE')
    expect(replayFinal).toBe(liveFinal)
  })

  it('detaches/installs before different-revision and deactivation close reentrancy', () => {
    const hub = createStateBatchHubV1()
    const first = prepare(hub); first.installPrepared(); first.flushPrepared()
    let replacement: ControlledSocket | null = null
    const old = new ControlledSocket({
      onClose: () => {
        replacement = new ControlledSocket()
        hub.attach(replacement)
      },
    })
    hub.attach(old)
    const next = prepare(hub, createRuntimeTimelineStagingV1(), NEXT_REVISION)
    next.installPrepared()
    expect(replacement).toBeNull()
    next.flushPrepared()
    expect(replacement).not.toBeNull()
    expect(replacement!.sent).toEqual([])

    let afterDeactivate: ControlledSocket | null = null
    const active = new ControlledSocket({
      onClose: () => {
        afterDeactivate = new ControlledSocket()
        hub.attach(afterDeactivate)
      },
    })
    hub.attach(active)
    hub.deactivateRevision()
    expect(afterDeactivate).not.toBeNull()
    expect(afterDeactivate!.sent).toEqual([])
  })

  it('queues a send-reentrant live publication exactly once after the complete staged catch-up end', () => {
    const oldSource = scenarioHarness(undefined, undefined, 1)
    const candidate = scenarioHarness(undefined, undefined, 2)
    const hub = createStateBatchHubV1()
    const initial = prepare(hub); initial.installPrepared(); initial.flushPrepared()
    expect(hub.publish(oldSource.connected())).toBe(true)
    let injected = false
    const socket = new ControlledSocket({
      onSend: (payload) => {
        const message = JSON.parse(payload) as Record<string, unknown>
        if (!injected && message.type === 'endpoint-catchup-boundary-v1' && message.phase === 'start') {
          injected = true
          publishAll(hub, candidate.state(true, 'Good', 2))
        }
      },
    })
    hub.attach(socket); drain(socket)
    const staging = createRuntimeTimelineStagingV1()
    staging.publish(candidate.connected())
    publishAll(staging, candidate.state(false, 'Good', 1))
    const replacement = hub.prepareRevisionActivation({
      projectId: 'project-test', configRevision: REVISION, gatewayId: 'gateway-test',
      originId: 'gateway-test:opcua-client', publisherGeneration: 2, endpointIds: ['endpoint-test'],
      stagedTimeline: staging.seal(),
    })
    const offset = socket.sent.length
    replacement.installPrepared(); replacement.flushPrepared(); drain(socket)
    const frames = socket.sentMessages().slice(offset)
    const endIndex = frames.findIndex(({ type, phase }) => type === 'endpoint-catchup-boundary-v1' && phase === 'end')
    const injectedIndexes = frames.flatMap((message, index) =>
      message.type === 'state-batch-v1'
        && (message.values as Array<{ value: unknown }>)[0]?.value === true ? [index] : [],
    )
    expect(injectedIndexes).toHaveLength(1)
    expect(injectedIndexes[0]).toBeGreaterThan(endIndex)
  })

  it.each(['off', 'close'] as const)(
    'installs before a %s-reentrant reconnect and queues its publication once after the staged replay end',
    (callout) => {
      const oldSource = scenarioHarness(undefined, undefined, 1)
      const candidate = scenarioHarness(undefined, undefined, 2, { now: 10_000 }, NEXT_REVISION)
      const hub = createStateBatchHubV1()
      const initial = prepare(hub); initial.installPrepared(); initial.flushPrepared()
      expect(hub.publish(oldSource.connected())).toBe(true)
      let replacement: ControlledSocket | null = null
      let fired = false
      const reenter = (): void => {
        if (fired) return
        fired = true
        replacement = new ControlledSocket()
        hub.attach(replacement)
        publishAll(hub, candidate.state(true, 'Good', 2))
      }
      const old = new ControlledSocket(
        callout === 'off' ? { onOff: reenter } : { onClose: reenter },
      )
      hub.attach(old); drain(old)
      const staging = createRuntimeTimelineStagingV1()
      staging.publish(candidate.connected())
      publishAll(staging, candidate.state(false, 'Good', 1))
      const prepared = hub.prepareRevisionActivation({
        projectId: 'project-test', configRevision: NEXT_REVISION, gatewayId: 'gateway-test',
        originId: 'gateway-test:opcua-client', publisherGeneration: 2, endpointIds: ['endpoint-test'],
        stagedTimeline: staging.seal(),
      })
      prepared.installPrepared()
      expect(replacement).toBeNull()
      prepared.flushPrepared()
      expect(replacement).not.toBeNull()
      drain(replacement!)
      const frames = replacement!.sentMessages()
      expect(frames[0]?.sequence).toBe(1)
      const replayEnd = frames.findIndex(({ type, phase }) => type === 'endpoint-replay-boundary-v1' && phase === 'end')
      const trueIndexes = frames.flatMap((message, index) =>
        message.type === 'state-batch-v1'
          && (message.values as Array<{ value: unknown }>)[0]?.value === true ? [index] : [],
      )
      expect(trueIndexes).toHaveLength(1)
      expect(trueIndexes[0]).toBeGreaterThan(replayEnd)
    },
  )

  it('keeps ordinary BAD/BadNoCommunication State as State and frames zero-retained lifecycle replay', () => {
    const source = scenarioHarness()
    const hub = createStateBatchHubV1()
    const initial = prepare(hub); initial.installPrepared(); initial.flushPrepared()
    expect(hub.publish(source.connected())).toBe(true)
    publishAll(hub, source.state(true, 'Good', 1))
    publishAll(hub, source.state(false, 'BadNoCommunication', 2))
    const fresh = new ControlledSocket(); hub.attach(fresh); drain(fresh)
    expect(fresh.sentBatches().at(-1)?.values[0]).toMatchObject({ quality: 'BAD', statusCode: 'BadNoCommunication' })
    expect(fresh.sentMessages().filter(({ type }) => type === 'endpoint-lifecycle-v1')).toHaveLength(1)

    const emptySource = scenarioHarness()
    const emptyHub = createStateBatchHubV1()
    const emptyInitial = prepare(emptyHub); emptyInitial.installPrepared(); emptyInitial.flushPrepared()
    expect(emptyHub.publish(emptySource.connected())).toBe(true)
    expect(emptyHub.publish(emptySource.disconnected())).toBe(true)
    const emptyReplay = new ControlledSocket(); emptyHub.attach(emptyReplay); drain(emptyReplay)
    const body = expectExactFramedCut(emptyReplay.sentMessages(), 'endpoint-replay-boundary-v1')
    expect(body.map(({ type, phase }) => `${type}:${phase}`)).toEqual([
      'endpoint-lifecycle-v1:connected', 'endpoint-lifecycle-v1:disconnected',
    ])
  })

  it('reserves replay/catch-up/wire counters atomically at the last-safe value and isolates exhaustion without partial frames', () => {
    type CounterOptions = {
      initialReplayCounter?: number
      initialCatchupCounter?: number
      initialWireSequenceByEndpoint?: Readonly<Record<string, number>>
    }
    const createWithCounters = createStateBatchHubV1 as unknown as (options: CounterOptions) => ReturnType<typeof createStateBatchHubV1>
    const source = scenarioHarness()
    const lastSafe = createWithCounters({
      initialReplayCounter: Number.MAX_SAFE_INTEGER - 1,
      initialCatchupCounter: Number.MAX_SAFE_INTEGER - 1,
      initialWireSequenceByEndpoint: { 'endpoint-test': Number.MAX_SAFE_INTEGER - 3 },
    })
    const prepared = prepare(lastSafe); prepared.installPrepared(); prepared.flushPrepared()
    expect(lastSafe.publish(source.connected())).toBe(true)
    const replay = new ControlledSocket(); lastSafe.attach(replay); drain(replay)
    expect(replay.sentMessages()[0]).toMatchObject({ replayId: `replay:${Number.MAX_SAFE_INTEGER}` })
    expect(replay.sentSequences().at(-1)).toBe(Number.MAX_SAFE_INTEGER)

    const exhaustedPeer = new ControlledSocket(); lastSafe.attach(exhaustedPeer)
    expect(exhaustedPeer.sent).toEqual([])
    expect(exhaustedPeer.close).toHaveBeenCalledOnce()

    const wireExhausted = createWithCounters({ initialWireSequenceByEndpoint: { 'endpoint-test': Number.MAX_SAFE_INTEGER - 1 } })
    const wirePrepared = prepare(wireExhausted); wirePrepared.installPrepared(); wirePrepared.flushPrepared()
    expect(wireExhausted.publish(scenarioHarness().connected())).toBe(true)
    const noPrefix = new ControlledSocket(); wireExhausted.attach(noPrefix)
    expect(noPrefix.sent).toEqual([])
    expect(noPrefix.close).toHaveBeenCalledOnce()

    const catchupSource = scenarioHarness()
    const catchupHub = createWithCounters({ initialCatchupCounter: Number.MAX_SAFE_INTEGER - 1 })
    const catchupPrepared = prepare(catchupHub); catchupPrepared.installPrepared(); catchupPrepared.flushPrepared()
    expect(catchupHub.publish(catchupSource.connected())).toBe(true)
    const catchupPeer = new ControlledSocket(); catchupHub.attach(catchupPeer); drain(catchupPeer)
    publishAll(catchupHub, catchupSource.state(true, 'Good', 1))
    publishAll(catchupHub, catchupSource.state(false, 'Good', 2))
    catchupPeer.complete(); drain(catchupPeer)
    expect(catchupPeer.sentMessages().some(({ catchupId }) => catchupId === `catchup:${Number.MAX_SAFE_INTEGER}`)).toBe(true)
    publishAll(catchupHub, catchupSource.state(true, 'Good', 3))
    publishAll(catchupHub, catchupSource.state(false, 'Good', 4))
    const beforeExhaustedCut = catchupPeer.sent.length
    catchupPeer.complete()
    expect(catchupPeer.sent).toHaveLength(beforeExhaustedCut)
    expect(catchupPeer.close).toHaveBeenCalledOnce()
  })
})
