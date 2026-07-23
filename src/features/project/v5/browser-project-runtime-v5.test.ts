import { describe, expect, it, vi } from 'vitest'
import {
  cloneWorkcellProjectV5,
  makeMinimalWorkcellProjectV5,
} from '../../../core/project-v5/test-support.js'
import type { OpcUaMappingV5, WorkcellProjectV5 } from '../../../core/project-v5/index.js'
import type { StateBatchV1 } from '../../../core/runtime-protocol/v1.js'
import {
  createBrowserProjectRuntimeV5,
  type BrowserProjectResourcesV5,
  type BrowserProjectRuntimeV5Options,
} from './browser-project-runtime-v5.js'
import type { BrowserWebSocketV5 } from '../../runtime-gateway/v5/runtime-gateway-state-stream.js'

const CONFIG_A = 'a'.repeat(64)
const CONFIG_B = 'b'.repeat(64)

function poseMapping(
  id: string,
  projectTarget: Extract<OpcUaMappingV5['leaves'][number]['projectTarget'], {
    readonly type: 'robot-frame' | 'entity-frame'
  }>,
): OpcUaMappingV5 {
  const paths = [
    ['positionM', 0], ['positionM', 1], ['positionM', 2],
    ['rpyDegrees', 0], ['rpyDegrees', 1], ['rpyDegrees', 2],
  ] as const
  return {
    id,
    endpointId: 'endpoint-1',
    nodeAddress: { namespaceUri: 'urn:sample:plc', identifierType: 'string', identifier: id },
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

function attachmentProject(options: {
  readonly mappedMovingFrame?: boolean
  readonly mappedRobotFrameId?: 'Base' | 'TCP'
  readonly objectPositionM?: readonly [number, number, number]
} = {}): WorkcellProjectV5 {
  const project = cloneWorkcellProjectV5(makeMinimalWorkcellProjectV5())
  const mappings = project.opcUa.mappings as unknown as OpcUaMappingV5[]
  const movingFrameId = 'part-motion'
  ;(project.spatialEntities as unknown as WorkcellProjectV5['spatialEntities'][number][]).push({
    id: 'part',
    name: 'Part',
    geometry: { kind: 'box', dimensionsM: [0.1, 0.1, 0.1], color: '#ffffff' },
    parentFrameId: options.mappedMovingFrame ? movingFrameId : 'world',
    localPose: { positionM: options.objectPositionM ?? [0, 0, 0], quaternion: [0, 0, 0, 1] },
    visible: true,
    groupId: null,
    removable: true,
    transformOwner: options.mappedMovingFrame ? 'opcua:endpoint-1' : 'simulation',
    numericStatus: { value: 0, sourceOwnership: 'simulation', overlay: { visible: false, frameId: null } },
    graspable: true,
    graspFrames: [{
      frameId: 'part-grasp',
      name: 'Part grasp',
      localPose: { positionM: [0, 0, 0], quaternion: [0, 0, 0, 1] },
    }],
    movingFrames: options.mappedMovingFrame ? [{
      frameId: movingFrameId,
      name: 'Part motion',
      parentFrameId: 'world',
      localPose: { positionM: [0, 0, 0], quaternion: [0, 0, 0, 1] },
      sourceOwnership: 'opcua:endpoint-1',
    }] : [],
  })
  if (options.mappedMovingFrame) {
    mappings.push(poseMapping('map-part-motion', {
      type: 'entity-frame', entityId: 'part', frameId: movingFrameId,
    }))
  }
  if (options.mappedRobotFrameId !== undefined) {
    const frameId = options.mappedRobotFrameId
    ;(project.robots[0]!.frameSources as unknown as Record<string, string>)[frameId] = 'opcua:endpoint-1'
    mappings.push(poseMapping(`map-robot-${frameId.toLowerCase()}`, {
      type: 'robot-frame', robotId: 'robot-1', frameId,
    }))
  }
  ;(project.jobs[0] as unknown as { instructions: WorkcellProjectV5['jobs'][number]['instructions'] }).instructions = options.mappedMovingFrame
    ? [{ id: 'place', kind: 'detach', objectId: 'part', targetParentFrameId: movingFrameId }]
    : [{
        id: 'pick',
        kind: 'attach',
        objectId: 'part',
        toolFrameId: 'TCP',
        objectGraspFrameId: 'part-grasp',
        maximumDistanceM: 0.01,
      }]
  return project
}

function projectWithOpcUaRobotAndSignal(): WorkcellProjectV5 {
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

function robotFrameBatch(mappingId: string, positionM: readonly [number, number, number]): StateBatchV1 {
  return {
    type: 'state-batch-v1',
    protocolVersion: 1,
    projectId: 'project-v5',
    configRevision: CONFIG_A,
    gatewayId: 'gateway-1',
    endpointId: 'endpoint-1',
    sequence: 1,
    originId: 'publisher',
    sourceTimestampMs: 10,
    publishedTimestampMs: 10,
    values: [{
      mappingId,
      coherenceGroupId: mappingId,
      value: { positionM: [...positionM], quaternion: [0, 0, 0, 1] },
      unit: 'project-v5-z-up-metres-quaternion-xyzw',
      quality: 'GOOD',
      statusCode: 'Good',
    }],
  }
}

function cyclicAttachmentProject(): WorkcellProjectV5 {
  const project = cloneWorkcellProjectV5(makeMinimalWorkcellProjectV5())
  const entity = (id: string): WorkcellProjectV5['spatialEntities'][number] => ({
    id,
    name: id,
    geometry: { kind: 'box', dimensionsM: [0.1, 0.1, 0.1], color: '#ffffff' },
    parentFrameId: 'world',
    localPose: { positionM: [0, 0, 0], quaternion: [0, 0, 0, 1] },
    visible: true,
    groupId: null,
    removable: true,
    transformOwner: 'simulation',
    numericStatus: { value: 0, sourceOwnership: 'simulation', overlay: { visible: false, frameId: null } },
    graspable: true,
    graspFrames: [{
      frameId: `${id}-grasp`,
      name: `${id} grasp`,
      localPose: { positionM: [0, 0, 0], quaternion: [0, 0, 0, 1] },
    }],
    movingFrames: [],
  })
  ;(project.spatialEntities as unknown as WorkcellProjectV5['spatialEntities'][number][]).push(
    entity('part-a'),
    entity('part-b'),
  )
  ;(project.robots[0] as unknown as { baseParentFrameId: string }).baseParentFrameId = 'part-a-grasp'
  ;(project.jobs[0] as unknown as { instructions: WorkcellProjectV5['jobs'][number]['instructions'] }).instructions = [{
    id: 'pick-b',
    kind: 'attach',
    objectId: 'part-b',
    toolFrameId: 'TCP',
    objectGraspFrameId: 'part-b-grasp',
    maximumDistanceM: 0.01,
  }]
  return project
}

function scheduler() {
  let next = 0
  return {
    now: () => 0,
    request: () => ++next,
    cancel: () => undefined,
  }
}

function controlledScheduler() {
  let now = 0
  let next = 0
  let requests = 0
  const callbacks = new Map<number, (simulationMs: number) => void>()
  return {
    scheduler: {
      now: () => now,
      request: (callback: (simulationMs: number) => void) => {
        const handle = ++next
        requests += 1
        callbacks.set(handle, callback)
        return handle
      },
      cancel: (handle: number) => { callbacks.delete(handle) },
    },
    advance: (simulationMs: number) => {
      now = simulationMs
      const scheduled = Array.from(callbacks.values())
      callbacks.clear()
      for (const callback of scheduled) callback(simulationMs)
    },
    pending: () => callbacks.size,
    requests: () => requests,
  }
}

function longRunningJobProject(): WorkcellProjectV5 {
  const project = cloneWorkcellProjectV5(makeMinimalWorkcellProjectV5())
  ;(project.jobs[0] as { instructions: WorkcellProjectV5['jobs'][number]['instructions'] }).instructions = [
    { id: 'home', kind: 'move-joint', jointValues: { J1: 0 }, speedPercentToNext: 100 },
    { id: 'move', kind: 'move-joint', jointValues: { J1: 100 }, speedPercentToNext: 100 },
  ]
  return project
}

function writableSetDoProject(): WorkcellProjectV5 {
  const project = cloneWorkcellProjectV5(makeMinimalWorkcellProjectV5())
  ;(project.logicalSignals[0] as { direction: 'output' }).direction = 'output'
  ;(project.opcUa.mappings[0] as { direction: 'write' }).direction = 'write'
  ;(project.jobs[0] as { instructions: WorkcellProjectV5['jobs'][number]['instructions'] }).instructions = [
    { id: 'set-part-present', kind: 'set-do', signalId: 'PartPresent', value: true },
  ]
  return project
}

function moveThenWritableSetDoProject(): WorkcellProjectV5 {
  const project = writableSetDoProject()
  ;(project.jobs[0] as { instructions: WorkcellProjectV5['jobs'][number]['instructions'] }).instructions = [
    { id: 'move-before-set-do', kind: 'move-joint', jointValues: { J1: 10 }, speedPercentToNext: 100 },
    { id: 'set-part-present', kind: 'set-do', signalId: 'PartPresent', value: true },
  ]
  return project
}

function deferred<T>() {
  let resolve: (value: T | PromiseLike<T>) => void = () => undefined
  let reject: (reason?: unknown) => void = () => undefined
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve
    reject = nextReject
  })
  return { promise, resolve, reject }
}

function commandLeaseResponse(): Response {
  return new Response(JSON.stringify({
    projectId: 'project-v5', configRevision: CONFIG_A,
    publisherId: 'gateway-1:client-write', generation: 1, expiresAt: 6_000,
  }), { headers: { 'Content-Type': 'application/json' } })
}

function successfulCommandResponse(targetId = 'mapping-1'): Response {
  return new Response(JSON.stringify({
    type: 'command-result-v1', protocolVersion: 1,
    projectId: 'project-v5', configRevision: CONFIG_A, leaseGeneration: 1,
    targetId, commandId: 'command-1', acknowledgement: 'ACCEPTED', executionState: 'SUCCEEDED',
    failureCode: null, message: 'done', attachedObjectId: null, completedAt: 101,
  }), { headers: { 'Content-Type': 'application/json' } })
}

function browserRobotCommand(configRevision: string, commandId: string, leaseGeneration = 1) {
  return {
    type: 'command-batch-v1' as const,
    protocolVersion: 1 as const,
    projectId: 'project-v5',
    configRevision,
    leaseGeneration,
    commands: [{
      commandId,
      expiresAt: 10_000,
      targetId: 'robot-1',
      value: { kind: 'robot-joint-target' as const, robotId: 'robot-1', jointValues: { J1: 12 } },
    }],
  }
}

class FakeSocket implements BrowserWebSocketV5 {
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
  emit(type: 'open' | 'message' | 'close' | 'error', event: unknown = {}): void {
    if (type === 'open') this.readyState = 1
    if (type === 'close') this.readyState = 3
    for (const listener of this.listeners.get(type) ?? []) listener(event)
  }
  frame(value: unknown): void { this.emit('message', { data: JSON.stringify(value) }) }
  listenerCount(): number {
    return [...this.listeners.values()].reduce((total, listeners) => total + listeners.size, 0)
  }
}

function options(
  overrides: Partial<BrowserProjectRuntimeV5Options> = {},
): BrowserProjectRuntimeV5Options {
  return {
    initialProject: makeMinimalWorkcellProjectV5(),
    initialConfigRevision: CONFIG_A,
    gatewayId: 'gateway-1',
    scheduler: scheduler(),
    createRunId: () => 'run-1',
    createCommandId: () => 'command-1',
    stream: {
      url: 'ws://runtime.test/runtime/ws',
      createWebSocket: () => { throw new Error('Socket was not expected in this test.') },
      nowMs: () => 100,
      reconnectDelayMs: 50,
    },
    command: { fetch: async () => new Response(), nowMs: () => 100 },
    onDiagnostic: () => undefined,
    ...overrides,
  }
}

describe('BrowserProjectRuntimeV5', () => {
  it('registers one revision-fenced V5 command owner on the Browser stream target', async () => {
    const runtime = createBrowserProjectRuntimeV5(options())
    const target = runtime.bundle.getState().runtimeGraph.streamTarget
    target.onBrowserPublisherLease?.({
      projectId: 'project-v5', configRevision: CONFIG_A, publisherId: 'gateway-1:browser-simulation', generation: 1, expiresAt: 6_000,
    })
    await expect(target.onCommandBatch?.({
      type: 'command-batch-v1', protocolVersion: 1, projectId: 'project-v5', configRevision: CONFIG_A,
      leaseGeneration: 1, commands: [{ commandId: 'external-joint', expiresAt: 200, targetId: 'robot-1', value: { kind: 'robot-joint-target', robotId: 'robot-1', jointValues: { J1: 12 } } }],
    })).resolves.toMatchObject({ acknowledgement: 'ACCEPTED', executionState: 'SUCCEEDED' })
    expect(runtime.bundle.getState().runtimeGraph.robots.getState().readRobot('robot-1')?.jointValues).toEqual({ J1: 12 })
    await expect(target.onCommandBatch?.({
      type: 'command-batch-v1', protocolVersion: 1, projectId: 'project-v5', configRevision: CONFIG_A,
      leaseGeneration: 1, commands: [{ commandId: 'external-signal', expiresAt: 200, targetId: 'PartPresent', value: { kind: 'logical-signal', signalId: 'PartPresent', value: true } }],
    })).resolves.toMatchObject({ acknowledgement: 'ACCEPTED', executionState: 'SUCCEEDED' })
    expect(runtime.bundle.getState().runtimeGraph.signals.getState().read('PartPresent'))
      .toMatchObject({ value: true, owner: 'simulation', quality: 'GOOD' })
    expect(target.browserPublisherId).toBe('gateway-1:browser-simulation')
    await runtime.dispose()
    await expect(target.onCommandBatch?.({
      type: 'command-batch-v1', protocolVersion: 1, projectId: 'project-v5', configRevision: CONFIG_A,
      leaseGeneration: 1, commands: [{ commandId: 'after-dispose', expiresAt: 200, targetId: 'robot-1', value: { kind: 'robot-joint-target', robotId: 'robot-1', jointValues: { J1: 1 } } }],
    })).resolves.toMatchObject({ acknowledgement: 'ACCEPTED', executionState: 'FAILED', failureCode: 'COMMAND_LEASE_STALE' })
  })

  it('runs Browser product job start and cancellation through the scheduled playback controller', async () => {
    const callbacks: Array<(simulationMs: number) => void> = []
    const request = vi.fn((callback: (simulationMs: number) => void) => {
      callbacks.push(callback)
      return callbacks.length
    })
    const cancel = vi.fn()
    const project = cloneWorkcellProjectV5(makeMinimalWorkcellProjectV5())
    ;(project.jobs[0] as unknown as { instructions: WorkcellProjectV5['jobs'][number]['instructions'] }).instructions = [{
      id: 'scheduled-motion', kind: 'move-joint', jointValues: { J1: 30 }, speedPercentToNext: 100,
    }]
    const runtime = createBrowserProjectRuntimeV5(options({
      initialProject: project,
      scheduler: { now: () => 100, request, cancel },
    }))
    try {
      const target = runtime.bundle.getState().runtimeGraph.streamTarget
      target.onBrowserPublisherLease?.({
        projectId: 'project-v5', configRevision: CONFIG_A, publisherId: 'gateway-1:browser-simulation', generation: 1, expiresAt: 6_000,
      })
      await expect(target.onCommandBatch?.({
        type: 'command-batch-v1', protocolVersion: 1, projectId: 'project-v5', configRevision: CONFIG_A,
        leaseGeneration: 1, commands: [{
          commandId: 'external-job-start', expiresAt: 200, targetId: 'job-1', value: { kind: 'job', jobId: 'job-1', operation: 'start' },
        }],
      })).resolves.toMatchObject({ acknowledgement: 'ACCEPTED', executionState: 'SUCCEEDED' })
      expect(request).toHaveBeenCalledTimes(1)
      expect(runtime.bundle.getState().runtimeGraph.jobs.getState().byRobotId['robot-1']).toMatchObject({ state: 'RUNNING' })

      await expect(target.onCommandBatch?.({
        type: 'command-batch-v1', protocolVersion: 1, projectId: 'project-v5', configRevision: CONFIG_A,
        leaseGeneration: 1, commands: [{
          commandId: 'external-job-cancel', expiresAt: 200, targetId: 'job-1', value: { kind: 'job', jobId: 'job-1', operation: 'cancel' },
        }],
      })).resolves.toMatchObject({ acknowledgement: 'ACCEPTED', executionState: 'SUCCEEDED' })
      expect(cancel).toHaveBeenCalledWith(1)
      expect(runtime.bundle.getState().runtimeGraph.jobs.getState().byRobotId['robot-1']).toMatchObject({ state: 'CANCELLED' })
      expect(callbacks).toHaveLength(1)
    } finally {
      await runtime.dispose()
    }
  })

  it('commits a product Object pose through the V5 Browser Simulation owner', async () => {
    const runtime = createBrowserProjectRuntimeV5(options({ initialProject: attachmentProject() }))
    try {
      const target = runtime.bundle.getState().runtimeGraph.streamTarget
      target.onBrowserPublisherLease?.({
        projectId: 'project-v5', configRevision: CONFIG_A, publisherId: 'gateway-1:browser-simulation', generation: 1, expiresAt: 6_000,
      })
      await expect(target.onCommandBatch?.({
        type: 'command-batch-v1', protocolVersion: 1, projectId: 'project-v5', configRevision: CONFIG_A,
        leaseGeneration: 1, commands: [{
          commandId: 'external-pose', expiresAt: 200, targetId: 'part',
          value: { kind: 'scene-object-pose', objectId: 'part', pose: { x: 1, y: 2, z: 3, roll: 0, pitch: 0, yaw: Math.PI } },
        }],
      })).resolves.toMatchObject({ acknowledgement: 'ACCEPTED', executionState: 'SUCCEEDED' })
    } finally {
      await runtime.dispose()
    }
  })

  it('publishes only a revision-aligned graph through its bundle', async () => {
    const runtime = createBrowserProjectRuntimeV5(options())
    const before = runtime.bundle.getState()
    const next = cloneWorkcellProjectV5(makeMinimalWorkcellProjectV5())
    ;(next as { revisionId: string }).revisionId = 'revision-2'

    const prepared = await runtime.prepare(next, CONFIG_B)
    expect(Object.keys(prepared).sort()).toEqual(['configRevision', 'projectRevisionId'])
    expect(Object.keys(runtime).sort()).toEqual([
      'apply', 'bundle', 'commit', 'deactivate', 'dispose', 'prepare', 'readActiveBundle', 'rollback',
      'startGatewayStream', 'stopGatewayStream',
    ])

    await runtime.apply(prepared)
    await (await runtime.commit(prepared)).finalize()

    const published = runtime.bundle.getState()
    expect(published).toMatchObject({
      runtimeEpoch: before.runtimeEpoch + 1,
      projectRevisionId: 'revision-2',
      configRevision: CONFIG_B,
      gatewayId: 'gateway-1',
    })
    expect(published.runtimeGraph).not.toBe(before.runtimeGraph)
    expect([
      published.runtimeGraph.robots.getState().projectRevisionId,
      published.runtimeGraph.robotFrames.projectRevisionId,
      published.runtimeGraph.objects.projectRevisionId,
      published.runtimeGraph.signals.getState().projectRevisionId,
      published.runtimeGraph.jobs.getState().projectRevisionId,
      published.runtimeGraph.attachments.getState().projectRevisionId,
    ]).toEqual(Array(6).fill('revision-2'))
    expect([
      published.runtimeGraph.robots.getState().configRevision,
      published.runtimeGraph.robotFrames.configRevision,
      published.runtimeGraph.objects.configRevision,
      published.runtimeGraph.signals.getState().configRevision,
      published.runtimeGraph.jobs.getState().configRevision,
      published.runtimeGraph.attachments.getState().configRevision,
      published.runtimeGraph.streamTarget.configRevision,
    ]).toEqual(Array(7).fill(CONFIG_B))
  })

  it('rolls a committed candidate back to the exact live base graph before publication finalization', async () => {
    const runtime = createBrowserProjectRuntimeV5(options())
    const base = runtime.bundle.getState()
    let baseRobotNotifications = 0
    const unsubscribeBaseRobot = base.runtimeGraph.robots.subscribe(() => { baseRobotNotifications += 1 })
    base.runtimeGraph.robots.getState().writeJointValues('robot-1', { J1: 24 }, 'simulation')
    const candidate = cloneWorkcellProjectV5(makeMinimalWorkcellProjectV5())
    ;(candidate as { revisionId: string }).revisionId = 'revision-transition'

    const prepared = await runtime.prepare(candidate, CONFIG_B)
    await runtime.apply(prepared)
    const transition = await runtime.commit(prepared)

    expect(runtime.bundle.getState()).not.toBe(base)
    expect(runtime.bundle.getState().runtimeGraph).not.toBe(base.runtimeGraph)
    expect(base.runtimeGraph.robots.getState().readRobot('robot-1')?.jointValues).toEqual({ J1: 24 })

    await transition.rollback()

    expect(runtime.bundle.getState()).toBe(base)
    expect(runtime.bundle.getState().runtimeGraph).toBe(base.runtimeGraph)
    expect(runtime.bundle.getState().runtimeGraph.robots.getState().readRobot('robot-1')?.jointValues).toEqual({ J1: 24 })
    base.runtimeGraph.robots.getState().writeJointValues('robot-1', { J1: 25 }, 'simulation')
    expect(baseRobotNotifications).toBe(2)
    unsubscribeBaseRobot()
    await runtime.dispose()
  })

  it('returns a first committed candidate to a truly empty Browser runtime', async () => {
    const runtime = createBrowserProjectRuntimeV5(options({
      initialProject: undefined,
      initialConfigRevision: undefined,
    }))
    expect(runtime.readActiveBundle()).toBeNull()
    expect(() => runtime.bundle.getState()).toThrow('RUNTIME_BUNDLE_EMPTY')

    const candidate = cloneWorkcellProjectV5(makeMinimalWorkcellProjectV5())
    ;(candidate as { revisionId: string }).revisionId = 'revision-first-transition'
    const prepared = await runtime.prepare(candidate, CONFIG_B)
    await runtime.apply(prepared)
    const transition = await runtime.commit(prepared)

    expect(runtime.readActiveBundle()).toMatchObject({
      projectRevisionId: 'revision-first-transition', configRevision: CONFIG_B,
    })
    await transition.rollback()

    expect(runtime.readActiveBundle()).toBeNull()
    expect(() => runtime.bundle.getState()).toThrow('RUNTIME_BUNDLE_EMPTY')
    await runtime.dispose()
  })

  it('deactivates an active graph transactionally and can publish New after finalization', async () => {
    const runtime = createBrowserProjectRuntimeV5(options())
    const base = runtime.readActiveBundle()!
    const transition = await runtime.deactivate()

    expect(runtime.readActiveBundle()).toBeNull()
    expect(() => base.runtimeGraph.playback.startJob('job-1')).toThrow('BROWSER_RUNTIME_GRAPH_INACTIVE')

    await transition.rollback()
    expect(runtime.readActiveBundle()).toBe(base)
    expect(() => base.runtimeGraph.playback.startJob('job-1')).not.toThrow()

    await (await runtime.deactivate()).finalize()
    expect(runtime.readActiveBundle()).toBeNull()
    expect(() => base.runtimeGraph.playback.startJob('job-1')).toThrow()

    const next = cloneWorkcellProjectV5(makeMinimalWorkcellProjectV5())
    ;(next as { revisionId: string }).revisionId = 'revision-after-empty'
    const prepared = await runtime.prepare(next, CONFIG_B)
    await runtime.apply(prepared)
    await (await runtime.commit(prepared)).finalize()
    expect(runtime.readActiveBundle()).toMatchObject({ projectRevisionId: 'revision-after-empty' })
    await runtime.dispose()
  })

  it('fences prior public job APIs and requires a fresh Browser lease after rollback', async () => {
    let receiptNow = 100
    const clock = controlledScheduler()
    const sockets: FakeSocket[] = []
    const runtime = createBrowserProjectRuntimeV5(options({
      initialProject: longRunningJobProject(),
      scheduler: clock.scheduler,
      stream: {
        url: 'ws://runtime.test/runtime/ws',
        createWebSocket: () => {
          const socket = new FakeSocket()
          sockets.push(socket)
          return socket
        },
        nowMs: () => receiptNow,
        reconnectDelayMs: 50,
      },
    }))
    const oldGraph = runtime.bundle.getState().runtimeGraph
    runtime.startGatewayStream()
    sockets[0]!.emit('open')
    oldGraph.streamTarget.onBrowserPublisherLease?.({
      projectId: 'project-v5', configRevision: CONFIG_A,
      publisherId: 'gateway-1:browser-simulation', generation: 1, expiresAt: 6_000,
    })
    oldGraph.playback.startJob('job-1')
    clock.advance(0)
    expect(oldGraph.jobs.getState().byRobotId['robot-1']?.state).toBe('RUNNING')
    expect(clock.pending()).toBe(1)
    let resumedRobotNotifications = 0
    const unsubscribeOldRobot = oldGraph.robots.subscribe(() => { resumedRobotNotifications += 1 })

    const candidate = longRunningJobProject()
    ;(candidate as { revisionId: string }).revisionId = 'revision-fenced'
    const prepared = await runtime.prepare(candidate, CONFIG_B)
    await runtime.apply(prepared)
    const transition = await runtime.commit(prepared)

    expect(sockets[0]!.readyState).toBe(3)
    expect(sockets).toHaveLength(2)
    await expect(oldGraph.streamTarget.onCommandBatch?.(browserRobotCommand(CONFIG_A, 'blocked'))).resolves.toMatchObject({
      executionState: 'FAILED', failureCode: 'COMMAND_LEASE_STALE',
    })
    expect(() => oldGraph.playback.startJob('job-1')).toThrow('BROWSER_RUNTIME_GRAPH_INACTIVE')
    expect(() => oldGraph.playback.cancelRobotJob('robot-1', 'stale holder')).toThrow('BROWSER_RUNTIME_GRAPH_INACTIVE')
    expect(() => oldGraph.playback.ensureRunning()).toThrow('BROWSER_RUNTIME_GRAPH_INACTIVE')
    await expect(oldGraph.playback.quiesce()).rejects.toThrow('BROWSER_RUNTIME_GRAPH_INACTIVE')
    expect(() => oldGraph.playback.resume()).toThrow('BROWSER_RUNTIME_GRAPH_INACTIVE')
    expect(() => oldGraph.playback.dispose()).toThrow('BROWSER_RUNTIME_GRAPH_INACTIVE')
    expect(() => oldGraph.jobExecutor.startJob('job-1', 1_000)).toThrow('BROWSER_RUNTIME_GRAPH_INACTIVE')
    await expect(oldGraph.jobExecutor.advanceRobot('robot-1', 1_000)).rejects.toThrow('BROWSER_RUNTIME_GRAPH_INACTIVE')
    await expect(oldGraph.jobExecutor.advanceAll(1_000)).rejects.toThrow('BROWSER_RUNTIME_GRAPH_INACTIVE')
    expect(() => oldGraph.jobExecutor.cancelRobotJob('robot-1', 'stale holder')).toThrow('BROWSER_RUNTIME_GRAPH_INACTIVE')
    expect(() => oldGraph.jobExecutor.cancelJob('robot-1', 'stale holder')).toThrow('BROWSER_RUNTIME_GRAPH_INACTIVE')
    expect(() => oldGraph.jobExecutor.reset()).toThrow('BROWSER_RUNTIME_GRAPH_INACTIVE')
    expect(() => oldGraph.jobExecutor.shutdown('stale holder')).toThrow('BROWSER_RUNTIME_GRAPH_INACTIVE')
    expect(clock.pending()).toBe(0)
    clock.advance(1_000)
    expect(oldGraph.robots.getState().readRobot('robot-1')?.jointValues).toEqual({ J1: 0 })

    const requestsBeforeRollback = clock.requests()
    await transition.rollback()
    expect(clock.pending()).toBe(1)
    expect(clock.requests()).toBe(requestsBeforeRollback + 1)
    expect(sockets[1]!.readyState).toBe(3)
    expect(sockets).toHaveLength(3)
    sockets[2]!.emit('open')
    const notificationsBeforeFreshCommand = resumedRobotNotifications
    await expect(oldGraph.streamTarget.onCommandBatch?.(browserRobotCommand(CONFIG_A, 'released-generation'))).resolves.toMatchObject({
      executionState: 'FAILED', failureCode: 'COMMAND_LEASE_STALE',
    })
    oldGraph.streamTarget.onBrowserPublisherLease?.({
      projectId: 'project-v5', configRevision: CONFIG_A,
      publisherId: 'gateway-1:browser-simulation', generation: 2, expiresAt: 6_000,
    })
    await expect(oldGraph.streamTarget.onCommandBatch?.(browserRobotCommand(CONFIG_A, 'fresh-generation', 2))).resolves.toMatchObject({
      executionState: 'SUCCEEDED', failureCode: null,
    })
    expect(resumedRobotNotifications).toBe(notificationsBeforeFreshCommand + 1)
    clock.advance(1_000)
    await Promise.resolve()
    await Promise.resolve()
    expect(oldGraph.robots.getState().readRobot('robot-1')?.jointValues.J1).toBeGreaterThan(0)

    const finalCandidate = longRunningJobProject()
    ;(finalCandidate as { revisionId: string }).revisionId = 'revision-finalized'
    const finalPrepared = await runtime.prepare(finalCandidate, 'c'.repeat(64))
    await runtime.apply(finalPrepared)
    await (await runtime.commit(finalPrepared)).finalize()
    expect(() => oldGraph.playback.startJob('job-1')).toThrow('disposed')
    unsubscribeOldRobot()
    await runtime.dispose()
  })

  it('drains a direct deferred executor advance before installing a candidate', async () => {
    const commandResponse = deferred<Response>()
    const fetch = vi.fn((url: string): Promise<Response> => (
      url.endsWith('/command-lease') ? Promise.resolve(commandLeaseResponse()) : commandResponse.promise
    ))
    const runtime = createBrowserProjectRuntimeV5(options({
      initialProject: writableSetDoProject(),
      command: { fetch, nowMs: () => 100 },
    }))
    const oldGraph = runtime.bundle.getState().runtimeGraph
    let oldJobNotifications = 0
    const unsubscribe = oldGraph.jobs.subscribe(() => { oldJobNotifications += 1 })
    oldGraph.jobExecutor.startJob('job-1', 0)
    const directAdvance = oldGraph.jobExecutor.advanceRobot('robot-1', 0)
    await new Promise<void>((resolve) => setTimeout(resolve, 0))
    expect(fetch).toHaveBeenCalledTimes(2)

    const candidate = cloneWorkcellProjectV5(makeMinimalWorkcellProjectV5())
    ;(candidate as { revisionId: string }).revisionId = 'revision-direct-advance-drain'
    const prepared = await runtime.prepare(candidate, CONFIG_B)
    await runtime.apply(prepared)
    const committing = runtime.commit(prepared)
    let commitSettled = false
    void committing.then(() => { commitSettled = true })
    for (let index = 0; index < 10; index += 1) await Promise.resolve()
    expect(commitSettled).toBe(false)
    expect(runtime.bundle.getState().runtimeGraph).toBe(oldGraph)

    commandResponse.resolve(successfulCommandResponse())
    await directAdvance
    const notificationsBeforeInstall = oldJobNotifications
    const transition = await committing
    expect(runtime.bundle.getState().runtimeGraph).not.toBe(oldGraph)
    expect(oldJobNotifications).toBe(notificationsBeforeInstall)

    await transition.rollback()
    expect(runtime.bundle.getState().runtimeGraph).toBe(oldGraph)
    expect(oldGraph.jobs.getState().byRobotId['robot-1']).toMatchObject({ state: 'SUCCEEDED' })
    unsubscribe()
    await runtime.dispose()
  })

  it('pre-registers a direct advance before a synchronous subscriber reenters commit', async () => {
    const commandResponse = deferred<Response>()
    const fetch = vi.fn((url: string): Promise<Response> => (
      url.endsWith('/command-lease') ? Promise.resolve(commandLeaseResponse()) : commandResponse.promise
    ))
    const runtime = createBrowserProjectRuntimeV5(options({
      initialProject: moveThenWritableSetDoProject(),
      command: { fetch, nowMs: () => 100 },
    }))
    const oldGraph = runtime.bundle.getState().runtimeGraph
    const candidate = cloneWorkcellProjectV5(makeMinimalWorkcellProjectV5())
    ;(candidate as { revisionId: string }).revisionId = 'revision-reentrant-direct-advance'
    const prepared = await runtime.prepare(candidate, CONFIG_B)
    await runtime.apply(prepared)
    let reentrantCommit: ReturnType<typeof runtime.commit> | null = null
    const unsubscribe = oldGraph.robots.subscribe(() => {
      if (reentrantCommit === null) reentrantCommit = runtime.commit(prepared)
    })

    oldGraph.jobExecutor.startJob('job-1', 0)
    const directAdvance = oldGraph.jobExecutor.advanceRobot('robot-1', 0)
    if (reentrantCommit === null) throw new Error('Expected a synchronous Robot subscriber commit.')
    const committing = reentrantCommit as ReturnType<BrowserProjectResourcesV5['commit']>
    let commitSettled = false
    void committing.then(() => { commitSettled = true })
    await new Promise<void>((resolve) => setTimeout(resolve, 0))
    expect(fetch).toHaveBeenCalledTimes(2)
    expect(commitSettled).toBe(false)
    expect(runtime.bundle.getState().runtimeGraph).toBe(oldGraph)

    commandResponse.reject(new Error('deferred SetDO command failure'))
    await directAdvance
    expect(oldGraph.jobs.getState().byRobotId['robot-1']).toMatchObject({ state: 'FAILED' })
    const transition = await committing
    expect(runtime.bundle.getState().runtimeGraph).not.toBe(oldGraph)

    await transition.rollback()
    const laterCandidate = cloneWorkcellProjectV5(makeMinimalWorkcellProjectV5())
    ;(laterCandidate as { revisionId: string }).revisionId = 'revision-after-reentrant-failure'
    const laterPrepared = await runtime.prepare(laterCandidate, 'c'.repeat(64))
    await runtime.apply(laterPrepared)
    await (await runtime.commit(laterPrepared)).finalize()
    unsubscribe()
    await runtime.dispose()
  })

  it('fences published signal writes before lease fetches and re-enables them only after rollback', async () => {
    const fetch = vi.fn(async (url: string): Promise<Response> => (
      url.endsWith('/command-lease') ? commandLeaseResponse() : successfulCommandResponse()
    ))
    const runtime = createBrowserProjectRuntimeV5(options({
      initialProject: writableSetDoProject(),
      command: { fetch, nowMs: () => 100 },
    }))
    const oldGraph = runtime.bundle.getState().runtimeGraph
    await expect(oldGraph.signalWrites.writeBoolean('PartPresent', true)).resolves.toMatchObject({ executionState: 'SUCCEEDED' })
    expect(fetch.mock.calls.map(([url]) => url)).toEqual(['/runtime/command-lease', '/runtime/command'])
    const candidate = cloneWorkcellProjectV5(makeMinimalWorkcellProjectV5())
    ;(candidate as { revisionId: string }).revisionId = 'revision-signal-write-fence'
    const prepared = await runtime.prepare(candidate, CONFIG_B)
    await runtime.apply(prepared)
    const transition = await runtime.commit(prepared)

    await expect(oldGraph.signalWrites.writeBoolean('PartPresent', true)).rejects.toThrow('BROWSER_RUNTIME_GRAPH_INACTIVE')
    expect(fetch).toHaveBeenCalledTimes(2)

    await transition.rollback()
    await expect(oldGraph.signalWrites.writeBoolean('PartPresent', true)).resolves.toMatchObject({ executionState: 'SUCCEEDED' })
    expect(fetch.mock.calls.map(([url]) => url)).toEqual([
      '/runtime/command-lease', '/runtime/command', '/runtime/command-lease', '/runtime/command',
    ])

    const finalCandidate = cloneWorkcellProjectV5(makeMinimalWorkcellProjectV5())
    ;(finalCandidate as { revisionId: string }).revisionId = 'revision-signal-write-finalized'
    const finalPrepared = await runtime.prepare(finalCandidate, 'c'.repeat(64))
    await runtime.apply(finalPrepared)
    await (await runtime.commit(finalPrepared)).finalize()

    await expect(oldGraph.signalWrites.writeBoolean('PartPresent', true)).rejects.toThrow('BROWSER_RUNTIME_GRAPH_DISPOSED')
    expect(fetch).toHaveBeenCalledTimes(4)
    await runtime.dispose()
  })

  it('does not resurrect a Browser lease that expires while a transition is pending', async () => {
    let receiptNow = 100
    const runtime = createBrowserProjectRuntimeV5(options({
      stream: {
        url: 'ws://runtime.test/runtime/ws',
        createWebSocket: () => { throw new Error('Socket was not expected in this test.') },
        nowMs: () => receiptNow,
        reconnectDelayMs: 50,
      },
    }))
    const oldGraph = runtime.bundle.getState().runtimeGraph
    oldGraph.streamTarget.onBrowserPublisherLease?.({
      projectId: 'project-v5', configRevision: CONFIG_A,
      publisherId: 'gateway-1:browser-simulation', generation: 1, expiresAt: 101,
    })
    const candidate = cloneWorkcellProjectV5(makeMinimalWorkcellProjectV5())
    ;(candidate as { revisionId: string }).revisionId = 'revision-expired-lease'
    const prepared = await runtime.prepare(candidate, CONFIG_B)
    await runtime.apply(prepared)
    const transition = await runtime.commit(prepared)
    receiptNow = 102

    await transition.rollback()

    await expect(oldGraph.streamTarget.onCommandBatch?.(browserRobotCommand(CONFIG_A, 'expired'))).resolves.toMatchObject({
      executionState: 'FAILED', failureCode: 'COMMAND_LEASE_STALE',
    })
    await runtime.dispose()
  })

  it('keeps the published graph live throughout every detached apply checkpoint', async () => {
    const checkpoints: string[] = []
    const runtime = createBrowserProjectRuntimeV5(options({
      testHooks: {
        afterDetachedApplyStep: (step, graph) => {
          checkpoints.push(step)
          expect(graph).not.toBe(runtime.bundle.getState().runtimeGraph)
        },
      },
    }))
    const before = runtime.bundle.getState()
    const next = cloneWorkcellProjectV5(makeMinimalWorkcellProjectV5())
    ;(next as { revisionId: string }).revisionId = 'revision-3'
    const prepared = await runtime.prepare(next, CONFIG_B)

    await runtime.apply(prepared)

    expect(checkpoints).toEqual(['robots', 'frames', 'objects', 'signals', 'jobs', 'attachments'])
    expect(runtime.bundle.getState()).toBe(before)
    expect(runtime.bundle.getState().runtimeGraph).toBe(before.runtimeGraph)
    await runtime.rollback(prepared)
    expect(runtime.bundle.getState()).toBe(before)
  })

  it('falls back to an authored moving-frame pose until its OPC UA pose exists', async () => {
    const runtime = createBrowserProjectRuntimeV5(options({
      initialProject: attachmentProject({ mappedMovingFrame: true }),
    }))
    try {
      const graph = runtime.bundle.getState().runtimeGraph
      expect(graph.objects.sampleFrame('part', 'part-motion', 100)).toMatchObject({
        worldPose: null,
        quality: 'BAD',
      })
      graph.attachments.getState().commitAttach({
        objectId: 'part',
        robotId: 'robot-1',
        toolFrameId: 'TCP',
        objectGraspFrameId: 'part-grasp',
        toolFromObject: { positionM: [0, 0, 0], quaternion: [0, 0, 0, 1] },
        toolWorldPoseAtAttach: { positionM: [0, 0, 0], quaternion: [0, 0, 0, 1] },
        objectWorldPoseAtAttach: { positionM: [0, 0, 0], quaternion: [0, 0, 0, 1] },
        attachedAtSimulationMs: 0,
      })

      graph.jobExecutor.startJob('job-1', 0)
      await graph.jobExecutor.advanceAll(0)

      expect(graph.jobs.getState().byRobotId['robot-1']).toMatchObject({ state: 'SUCCEEDED', stepIndex: 1 })
      expect(graph.attachments.getState().detachedOverridesByObjectId.part).toMatchObject({
        parentFrameId: 'part-motion',
      })
    } finally {
      await runtime.dispose()
    }
  })

  it('uses a GOOD mapped Base pose as the kinematic base for an unmapped Tool frame', async () => {
    const runtime = createBrowserProjectRuntimeV5(options({
      initialProject: attachmentProject({ mappedRobotFrameId: 'Base', objectPositionM: [1, 0, 0] }),
      stream: {
        url: 'ws://runtime.test/runtime/ws',
        createWebSocket: () => { throw new Error('Socket was not expected in this test.') },
        nowMs: () => 200,
        reconnectDelayMs: 50,
      },
    }))
    try {
      const graph = runtime.bundle.getState().runtimeGraph
      expect(graph.robotFrames.ingest(robotFrameBatch('map-robot-base', [1, 0, 0]), 100)).toBe(true)
      expect(graph.robotFrames.sampleFrame('robot-1', 'Base', 200)).toMatchObject({
        worldPose: { positionM: [1, 0, 0] },
        quality: 'GOOD',
      })

      graph.jobExecutor.startJob('job-1', 0)
      await graph.jobExecutor.advanceAll(0)

      expect(graph.jobs.getState().byRobotId['robot-1']).toMatchObject({ state: 'SUCCEEDED', stepIndex: 1 })
      expect(graph.attachments.getState().attachmentsByObjectId.part).toMatchObject({ toolFrameId: 'TCP' })
    } finally {
      await runtime.dispose()
    }
  })

  it('keeps an exact OPC UA-owned Robot frame unavailable before its first pose', async () => {
    const runtime = createBrowserProjectRuntimeV5(options({
      initialProject: attachmentProject({ mappedRobotFrameId: 'TCP' }),
    }))
    try {
      const graph = runtime.bundle.getState().runtimeGraph
      expect(graph.robotFrames.sampleFrame('robot-1', 'TCP', 100)).toMatchObject({
        worldPose: null,
        quality: 'BAD',
      })

      graph.jobExecutor.startJob('job-1', 0)
      await graph.jobExecutor.advanceAll(0)

      expect(graph.jobs.getState().byRobotId['robot-1']).toMatchObject({
        state: 'FAILED',
        failureCode: 'ATTACHMENT_FRAME_UNAVAILABLE',
        stepIndex: 0,
      })
    } finally {
      await runtime.dispose()
    }
  })

  it('does not let an attachment fallback hide a runtime coordinate dependency cycle', async () => {
    const runtime = createBrowserProjectRuntimeV5(options({ initialProject: cyclicAttachmentProject() }))
    try {
      const graph = runtime.bundle.getState().runtimeGraph
      graph.attachments.getState().commitAttach({
        objectId: 'part-a',
        robotId: 'robot-1',
        toolFrameId: 'TCP',
        objectGraspFrameId: 'part-a-grasp',
        toolFromObject: { positionM: [0, 0, 0], quaternion: [0, 0, 0, 1] },
        toolWorldPoseAtAttach: { positionM: [0, 0, 0], quaternion: [0, 0, 0, 1] },
        objectWorldPoseAtAttach: { positionM: [0, 0, 0], quaternion: [0, 0, 0, 1] },
        attachedAtSimulationMs: 0,
      })

      graph.jobExecutor.startJob('job-1', 0)
      await graph.jobExecutor.advanceAll(0)

      expect(graph.jobs.getState().byRobotId['robot-1']).toMatchObject({
        state: 'FAILED',
        failureCode: 'ATTACHMENT_FRAME_UNAVAILABLE',
        stepIndex: 0,
      })
      expect(Object.keys(graph.attachments.getState().attachmentsByObjectId)).toEqual(['part-a'])
    } finally {
      await runtime.dispose()
    }
  })

  it('returns a composite catch-up guard despite a throwing Zustand observer', async () => {
    const diagnostics: unknown[] = []
    const runtime = createBrowserProjectRuntimeV5(options({ onDiagnostic: (error) => diagnostics.push(error) }))
    try {
      const graph = runtime.bundle.getState().runtimeGraph
      const unsubscribe = graph.signals.subscribe(() => { throw new Error('hostile catch-up observer') })
      let guard!: ReturnType<typeof graph.streamTarget.onEndpointCatchupStart>
      expect(() => { guard = graph.streamTarget.onEndpointCatchupStart('endpoint-1', 100) }).not.toThrow()
      unsubscribe()
      expect(() => guard.abort()).not.toThrow()
      expect(() => graph.streamTarget.onEndpointCatchupStart('endpoint-1', 101).abort()).not.toThrow()
      expect(diagnostics).toEqual([])
    } finally {
      await runtime.dispose()
    }
  })

  it('leaves one durable Robot stale overlay when composite catch-up construction aborts', async () => {
    const runtime = createBrowserProjectRuntimeV5(options({ initialProject: projectWithOpcUaRobotAndSignal() }))
    try {
      const graph = runtime.bundle.getState().runtimeGraph
      const signalGuard = graph.signals.getState().beginEndpointCatchup('endpoint-1', 99)
      let stalePublications = 0
      const stop = graph.robots.subscribe((state) => {
        if (state.byRobotId['robot-1']?.quality === 'STALE') stalePublications += 1
      })

      expect(() => graph.streamTarget.onEndpointCatchupStart('endpoint-1', 100))
        .toThrow('ENDPOINT_CATCHUP_ALREADY_ACTIVE')
      graph.streamTarget.onSessionDisconnect?.(100)
      stop()

      expect(stalePublications).toBe(1)
      expect(graph.robots.getState().readRobot('robot-1')).toMatchObject({
        quality: 'STALE', statusCode: 'BadNoCommunication', receivedTimestampMs: 100,
      })
      expect(() => graph.robots.getState().beginEndpointCatchup('endpoint-1', 101).abort()).not.toThrow()
      signalGuard.abort()
    } finally {
      await runtime.dispose()
    }
  })

  it('keeps session start no-throw when a reset observer fails', async () => {
    const diagnostics: unknown[] = []
    const runtime = createBrowserProjectRuntimeV5(options({ onDiagnostic: (error) => diagnostics.push(error) }))
    try {
      const graph = runtime.bundle.getState().runtimeGraph
      const unsubscribe = graph.signals.subscribe(() => { throw new Error('hostile reset observer') })
      expect(() => graph.streamTarget.onSessionStart?.(100)).not.toThrow()
      unsubscribe()
      expect(diagnostics).toEqual([expect.objectContaining({ message: 'hostile reset observer' })])
      expect(graph.signals.getState().read('PartPresent')).toMatchObject({
        quality: 'BAD',
        statusCode: 'BadWaitingForInitialData',
      })
    } finally {
      await runtime.dispose()
    }
  })

  it('closes a socket created reentrantly after owner disposal starts', async () => {
    const socket = new FakeSocket()
    let runtime!: BrowserProjectResourcesV5
    runtime = createBrowserProjectRuntimeV5(options({
      stream: {
        url: 'ws://runtime.test/runtime/ws',
        createWebSocket: () => {
          void runtime.dispose()
          return socket
        },
        nowMs: () => 100,
        reconnectDelayMs: 50,
      },
    }))

    runtime.startGatewayStream()
    await runtime.dispose()

    expect(socket.readyState).toBe(3)
    expect(socket.listenerCount()).toBe(0)
  })

  it('marks the active graph stale on an unexpected browser disconnect', () => {
    const sockets: FakeSocket[] = []
    const runtime = createBrowserProjectRuntimeV5(options({
      stream: {
        url: 'ws://runtime.test/runtime/ws',
        createWebSocket: () => {
          const socket = new FakeSocket()
          sockets.push(socket)
          return socket
        },
        nowMs: () => 100,
        reconnectDelayMs: 50,
      },
    }))
    runtime.startGatewayStream()
    const socket = sockets[0]!
    socket.emit('open')
    socket.frame({
      type: 'endpoint-lifecycle-v1', protocolVersion: 1,
      projectId: 'project-v5', configRevision: CONFIG_A, gatewayId: 'gateway-1',
      endpointId: 'endpoint-1', sequence: 1, originId: 'publisher',
      publisherGeneration: 1, sessionGeneration: 1, phase: 'connected',
      eventId: 'lifecycle:1:1:connected', statusCode: 'Good', occurredAtMs: 10,
    })
    socket.frame({
      type: 'state-batch-v1', protocolVersion: 1,
      projectId: 'project-v5', configRevision: CONFIG_A, gatewayId: 'gateway-1',
      endpointId: 'endpoint-1', sequence: 2, originId: 'publisher',
      sourceTimestampMs: 10, publishedTimestampMs: 10,
      values: [{
        mappingId: 'mapping-1', coherenceGroupId: null, value: true, unit: '',
        quality: 'GOOD', statusCode: 'Good',
      }],
    })
    const signals = runtime.bundle.getState().runtimeGraph.signals
    expect(signals.getState().read('PartPresent')).toMatchObject({ value: true, quality: 'GOOD' })

    socket.emit('close')

    expect(signals.getState().read('PartPresent')).toMatchObject({
      value: true, quality: 'STALE', statusCode: 'BadNoCommunication',
    })
  })

  it('authenticates candidates and shares one cancellation rollback promise', async () => {
    const runtime = createBrowserProjectRuntimeV5(options({
      testHooks: {
        detachedApplyGate: (_step, signal) => new Promise<void>((_resolve, reject) => {
          signal.addEventListener('abort', () => {
            const error = new Error('aborted')
            error.name = 'AbortError'
            reject(error)
          }, { once: true })
        }),
      },
    }))
    const next = cloneWorkcellProjectV5(makeMinimalWorkcellProjectV5())
    ;(next as { revisionId: string }).revisionId = 'revision-4'
    const prepared = await runtime.prepare(next, CONFIG_B)

    await expect(runtime.commit({ projectRevisionId: 'foreign', configRevision: CONFIG_B })).rejects.toThrow(
      'BROWSER_RUNTIME_CANDIDATE_FOREIGN',
    )
    const applying = runtime.apply(prepared)
    const firstRollback = runtime.rollback(prepared)
    const secondRollback = runtime.rollback(prepared)
    expect(secondRollback).toBe(firstRollback)
    await expect(applying).rejects.toMatchObject({ name: 'AbortError' })
    await firstRollback
    await expect(runtime.apply(prepared)).rejects.toThrow('BROWSER_RUNTIME_CANDIDATE_CONSUMED')
  })

  it('joins an apply when a detached gate reenters rollback synchronously', async () => {
    let releaseGate: (() => void) | null = null
    let prepared!: Awaited<ReturnType<BrowserProjectResourcesV5['prepare']>>
    let rollbackFromGate: Promise<void> | null = null
    const runtime = createBrowserProjectRuntimeV5(options({
      testHooks: {
        detachedApplyGate: () => {
          rollbackFromGate = runtime.rollback(prepared)
          return new Promise<void>((resolve) => { releaseGate = resolve })
        },
      },
    }))
    const next = cloneWorkcellProjectV5(makeMinimalWorkcellProjectV5())
    ;(next as { revisionId: string }).revisionId = 'revision-rollback-gate'
    prepared = await runtime.prepare(next, CONFIG_B)
    const applying = runtime.apply(prepared)
    await Promise.resolve()
    expect(rollbackFromGate).not.toBeNull()
    let rollbackSettled = false
    void rollbackFromGate!.then(() => { rollbackSettled = true })
    await Promise.resolve()
    await Promise.resolve()
    expect(rollbackSettled).toBe(false)

    releaseGate!()
    await expect(applying).rejects.toMatchObject({ name: 'AbortError' })
    await rollbackFromGate
  })

  it('publishes the shared rollback promise before abort listeners can reenter', async () => {
    let releaseGate: (() => void) | null = null
    let prepared!: Awaited<ReturnType<BrowserProjectResourcesV5['prepare']>>
    let rollbackFromAbort: Promise<void> | null = null
    const runtime = createBrowserProjectRuntimeV5(options({
      testHooks: {
        detachedApplyGate: (_step, signal) => {
          signal.addEventListener('abort', () => {
            rollbackFromAbort = runtime.rollback(prepared)
          }, { once: true })
          return new Promise<void>((resolve) => { releaseGate = resolve })
        },
      },
    }))
    const next = cloneWorkcellProjectV5(makeMinimalWorkcellProjectV5())
    ;(next as { revisionId: string }).revisionId = 'revision-abort-reentry'
    prepared = await runtime.prepare(next, CONFIG_B)
    const applying = runtime.apply(prepared)
    await Promise.resolve()

    const rollback = runtime.rollback(prepared)
    expect(rollbackFromAbort).toBe(rollback)

    releaseGate!()
    await expect(applying).rejects.toMatchObject({ name: 'AbortError' })
    await rollback
  })

  it('finishes commit cleanup and reentrant notifications after publication', async () => {
    const diagnostics: unknown[] = []
    const runtime = createBrowserProjectRuntimeV5(options({ onDiagnostic: (error) => diagnostics.push(error) }))
    const oldGraph = runtime.bundle.getState().runtimeGraph
    const finalProject = cloneWorkcellProjectV5(makeMinimalWorkcellProjectV5())
    ;(finalProject as { revisionId: string }).revisionId = 'revision-final'
    let nested: ReturnType<typeof runtime.prepare> | null = null
    runtime.bundle.subscribe(() => {
      nested = runtime.prepare(finalProject, 'c'.repeat(64))
      throw new Error('subscriber failure')
    })
    const replacement = cloneWorkcellProjectV5(makeMinimalWorkcellProjectV5())
    ;(replacement as { revisionId: string }).revisionId = 'revision-5'
    const prepared = await runtime.prepare(replacement, CONFIG_B)
    await runtime.apply(prepared)

    const transition = await runtime.commit(prepared)
    expect(runtime.bundle.getState().projectRevisionId).toBe('revision-5')
    expect(diagnostics.some((error) => error instanceof Error && error.message === 'subscriber failure')).toBe(true)
    await transition.finalize()
    expect(() => oldGraph.playback.startJob('job-1')).toThrow('disposed')
    const nestedCandidate = await nested!
    await runtime.rollback(nestedCandidate)
  })

  it('disposes by synchronously stopping transport and returns one shared promise', async () => {
    const sockets: FakeSocket[] = []
    const runtime = createBrowserProjectRuntimeV5(options({
      stream: {
        url: 'ws://runtime.test/runtime/ws',
        createWebSocket: () => {
          const socket = new FakeSocket()
          sockets.push(socket)
          return socket
        },
        nowMs: () => 100,
        reconnectDelayMs: 50,
      },
    }))
    runtime.startGatewayStream()
    const first = runtime.dispose()
    const second = runtime.dispose()
    expect(second).toBe(first)
    expect(sockets[0]!.readyState).toBe(3)
    await first
    await expect(runtime.prepare(makeMinimalWorkcellProjectV5(), CONFIG_A)).rejects.toThrow(
      'BROWSER_RUNTIME_DISPOSED',
    )
    expect(() => runtime.startGatewayStream()).toThrow('BROWSER_RUNTIME_DISPOSED')
    expect(() => runtime.stopGatewayStream()).not.toThrow()
  })
})
