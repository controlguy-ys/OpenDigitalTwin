import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  cloneWorkcellProjectV5,
  makeMinimalWorkcellProjectV5,
} from '../../../core/project-v5/test-support.js'
import type { OpcUaMappingV5, WorkcellProjectV5 } from '../../../core/project-v5/index.js'
import {
  createBrowserProjectRuntimeV5,
  type BrowserProjectRuntimeV5Options,
} from './browser-project-runtime-v5.js'
import type { BrowserWebSocketV5 } from '../../runtime-gateway/v5/runtime-gateway-state-stream.js'

const CONFIG = 'a'.repeat(64)

class ControlledSocket implements BrowserWebSocketV5 {
  readyState = 0
  private readonly listeners = new Map<string, Set<(event: unknown) => void>>()

  close(): void { this.readyState = 3 }
  addEventListener(type: 'open' | 'message' | 'close' | 'error', listener: (event: unknown) => void): void {
    const listeners = this.listeners.get(type) ?? new Set()
    listeners.add(listener)
    this.listeners.set(type, listeners)
  }
  removeEventListener(type: 'open' | 'message' | 'close' | 'error', listener: (event: unknown) => void): void {
    this.listeners.get(type)?.delete(listener)
  }
  open(): void { this.emit('open') }
  frame(message: unknown): void { this.emit('message', { data: JSON.stringify(message) }) }
  unexpectedClose(): void { this.emit('close') }
  private emit(type: 'open' | 'message' | 'close' | 'error', event: unknown = {}): void {
    if (type === 'open') this.readyState = 1
    if (type === 'close') this.readyState = 3
    for (const listener of this.listeners.get(type) ?? []) listener(event)
  }
}

function projectWithOpcUaSignalAndRobot(): WorkcellProjectV5 {
  const project = cloneWorkcellProjectV5(makeMinimalWorkcellProjectV5())
  ;(project.robots[0] as { jointSource: `opcua:${string}` }).jointSource = 'opcua:endpoint-1'
  ;(project.opcUa.mappings as unknown as OpcUaMappingV5[]).push({
    id: 'mapping-robot-joint',
    endpointId: 'endpoint-1',
    nodeAddress: { namespaceUri: 'urn:sample:plc', identifierType: 'string', identifier: 'Robot.J1' },
    direction: 'read',
    coherenceGroupId: null,
    interpolationMode: 'none',
    coordinateConvention: 'project-v5-z-up-metres-quaternion-xyzw',
    leaves: [{
      leafPath: [], projectPath: [],
      projectTarget: { type: 'robot-joint', robotId: 'robot-1', jointId: 'J1' },
      opcUaDataType: 'Double', projectDataType: 'number', scale: 1, offset: 0, unit: 'degree', required: true,
    }],
  })
  return project
}

function connected(sequence: number, sessionGeneration = 1): object {
  return {
    type: 'endpoint-lifecycle-v1', protocolVersion: 1,
    projectId: 'project-v5', configRevision: CONFIG, gatewayId: 'gateway-1',
    endpointId: 'endpoint-1', sequence, originId: 'publisher',
    publisherGeneration: 1, sessionGeneration, phase: 'connected',
    eventId: `lifecycle:1:${sessionGeneration}:connected`, statusCode: 'Good', occurredAtMs: sequence,
  }
}

function state(sequence: number, sourceTimestampMs: number, partPresent: boolean, j1: number): object {
  return {
    type: 'state-batch-v1', protocolVersion: 1,
    projectId: 'project-v5', configRevision: CONFIG, gatewayId: 'gateway-1',
    endpointId: 'endpoint-1', sequence, originId: 'publisher',
    sourceTimestampMs, publishedTimestampMs: sourceTimestampMs,
    values: [
      { mappingId: 'mapping-1', coherenceGroupId: null, value: partPresent, unit: '', quality: 'GOOD', statusCode: 'Good' },
      { mappingId: 'mapping-robot-joint', coherenceGroupId: null, value: j1, unit: 'degree', quality: 'GOOD', statusCode: 'Good' },
    ],
  }
}

function catchupStart(sequence: number, body: object): object {
  return {
    type: 'endpoint-catchup-boundary-v1', protocolVersion: 1,
    projectId: 'project-v5', configRevision: CONFIG, gatewayId: 'gateway-1',
    endpointId: 'endpoint-1', sequence, catchupId: 'catchup:1', phase: 'start',
    messageCount: 1,
    encodedBytes: new TextEncoder().encode(JSON.stringify(body)).byteLength,
  }
}

function options(
  createWebSocket: (url: string) => BrowserWebSocketV5,
  nowMs: () => number,
): BrowserProjectRuntimeV5Options {
  return {
    initialProject: projectWithOpcUaSignalAndRobot(),
    initialConfigRevision: CONFIG,
    gatewayId: 'gateway-1',
    scheduler: { now: () => 0, request: () => 1, cancel: () => undefined },
    createRunId: () => 'run-1',
    createCommandId: () => 'command-1',
    stream: { url: 'ws://runtime.test/runtime/ws', createWebSocket, nowMs, reconnectDelayMs: 50 },
    command: { fetch: async () => new Response(), nowMs: () => 100 },
    onDiagnostic: () => undefined,
  }
}

afterEach(() => vi.useRealTimers())

describe('BrowserProjectRuntimeV5 session disconnect and reconnect', () => {
  it('makes one durable stale publication when an active catch-up socket closes', async () => {
    let now = 10
    const sockets: ControlledSocket[] = []
    const runtime = createBrowserProjectRuntimeV5(options(() => {
      const socket = new ControlledSocket()
      sockets.push(socket)
      return socket
    }, () => now++))
    try {
      runtime.startGatewayStream()
      const socket = sockets[0]!
      socket.open()
      socket.frame(connected(1))
      socket.frame(state(2, 100, true, 10))
      const graph = runtime.bundle.getState().runtimeGraph
      expect(graph.signals.getState().read('PartPresent')).toMatchObject({ value: true, quality: 'GOOD' })
      expect(graph.robots.getState().readRobot('robot-1')).toMatchObject({ jointValues: { J1: 10 }, quality: 'GOOD' })

      let signalStalePublications = 0
      let robotStalePublications = 0
      const stopSignals = graph.signals.subscribe((snapshot) => {
        if (snapshot.read('PartPresent')?.quality === 'STALE') signalStalePublications += 1
      })
      const stopRobots = graph.robots.subscribe((snapshot) => {
        if (snapshot.readRobot('robot-1')?.quality === 'STALE') robotStalePublications += 1
      })
      socket.frame(catchupStart(3, state(4, 101, false, 11)))
      socket.unexpectedClose()
      stopSignals()
      stopRobots()

      expect(signalStalePublications).toBe(1)
      expect(robotStalePublications).toBe(1)
      expect(graph.signals.getState().read('PartPresent')).toMatchObject({
        value: true, quality: 'STALE', statusCode: 'BadNoCommunication',
      })
      expect(graph.robots.getState().readRobot('robot-1')).toMatchObject({
        jointValues: { J1: 10 }, quality: 'STALE', statusCode: 'BadNoCommunication',
      })
    } finally {
      await runtime.dispose()
    }
  })

  it('resets retained stale state and accepts lower sequences from a reconnected session', async () => {
    vi.useFakeTimers()
    let now = 10
    const sockets: ControlledSocket[] = []
    const runtime = createBrowserProjectRuntimeV5(options(() => {
      const socket = new ControlledSocket()
      sockets.push(socket)
      return socket
    }, () => now++))
    try {
      const initialBundle = runtime.bundle.getState()
      const canonicalProject = initialBundle.project
      const canonicalRevision = initialBundle.projectRevisionId
      runtime.startGatewayStream()
      const first = sockets[0]!
      first.open()
      first.frame(connected(1))
      first.frame(state(2, 100, true, 10))
      first.frame(catchupStart(3, state(4, 101, false, 11)))
      first.unexpectedClose()

      const graph = runtime.bundle.getState().runtimeGraph
      expect(graph.signals.getState().read('PartPresent')?.quality).toBe('STALE')
      expect(graph.robots.getState().readRobot('robot-1')?.quality).toBe('STALE')

      vi.advanceTimersByTime(50)
      const second = sockets[1]!
      second.open()
      expect(graph.signals.getState().read('PartPresent')).toMatchObject({
        value: true, quality: 'BAD', statusCode: 'BadWaitingForInitialData',
      })
      expect(graph.robots.getState().readRobot('robot-1')).toMatchObject({
        jointValues: { J1: 10 }, quality: 'BAD', statusCode: 'BadWaitingForInitialData',
      })

      second.frame(connected(1, 1))
      second.frame(state(2, 1, false, 20))

      expect(graph.signals.getState().read('PartPresent')).toMatchObject({ value: false, quality: 'GOOD' })
      expect(graph.robots.getState().readRobot('robot-1')).toMatchObject({ jointValues: { J1: 20 }, quality: 'GOOD' })
      expect(runtime.bundle.getState()).toBe(initialBundle)
      expect(runtime.bundle.getState()).toMatchObject({ project: canonicalProject, projectRevisionId: canonicalRevision })
    } finally {
      await runtime.dispose()
    }
  })
})
