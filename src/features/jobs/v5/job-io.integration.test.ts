import { describe, expect, it, vi } from 'vitest'

import {
  validateWorkcellProjectV5,
  type RigidTransformV5,
  type RobotJobInstructionV1,
  type WorkcellProjectV5,
} from '../../../core/project-v5/index.js'
import {
  cloneWorkcellProjectV5,
  makeMinimalWorkcellProjectV5,
} from '../../../core/project-v5/test-support.js'
import type { CommandResultV1, StateBatchV1 } from '../../../core/runtime-protocol/v1.js'
import { createAttachmentRuntimeStoreV1 } from '../../actions/v5/attachment-runtime-store.js'
import { createBrowserAttachmentInstructionPortV1 } from '../../actions/v5/browser-attachment-instruction-port.js'
import { createRobotJointRuntimeStoreV5 } from '../../robot/v5/robot-joint-runtime-store.js'
import { createAttachmentPoseRuntimeV1 } from '../../scene/v5/attachment-pose-runtime.js'
import { createLogicalSignalRuntimeStoreV1 } from '../../signals/v5/logical-signal-runtime-store.js'
import {
  createGatewaySignalWritePortV1,
  type RuntimeGatewayCommandClientV1,
} from '../../runtime-gateway/v5/runtime-gateway-command-client.js'
import { createJobRuntimeStoreV5 } from './job-runtime-store.js'
import { createRobotJobExecutorV5 } from './job-executor.js'

const CONFIG_REVISION = 'a'.repeat(64)
const IDENTITY_POSE: RigidTransformV5 = Object.freeze({
  positionM: Object.freeze([0, 0, 0] as const),
  quaternion: Object.freeze([0, 0, 0, 1] as const),
})

function authoredInstructions(): readonly RobotJobInstructionV1[] {
  return Object.freeze([
    { id: 'move-1', kind: 'move-joint', jointValues: { J1: 9 }, speedPercentToNext: 100 },
    { id: 'set-start', kind: 'set-do', signalId: 'start', value: true },
    { id: 'wait-ready', kind: 'wait-di', signalId: 'ready', expected: true, timeoutMs: 2_000 },
    { id: 'settle', kind: 'delay', durationMs: 100 },
    { id: 'pick', kind: 'attach', objectId: 'part', toolFrameId: 'TCP', objectGraspFrameId: 'part-grasp', maximumDistanceM: 0.01 },
    { id: 'move-2', kind: 'move-joint', jointValues: { J1: 90 }, speedPercentToNext: 100 },
    { id: 'place', kind: 'detach', objectId: 'part', targetParentFrameId: 'fixture' },
  ])
}

function jobProject(options: {
  readonly instructions?: readonly RobotJobInstructionV1[]
  readonly objectPositionM?: readonly [number, number, number]
} = {}): WorkcellProjectV5 {
  const project = cloneWorkcellProjectV5(makeMinimalWorkcellProjectV5())
  ;(project.scene.frames as unknown as WorkcellProjectV5['scene']['frames'][number][]).push({
    id: 'fixture', name: 'Fixture', parentFrameId: 'world', localPose: IDENTITY_POSE, role: 'custom',
  })
  ;(project.spatialEntities as unknown as WorkcellProjectV5['spatialEntities'][number][]).push({
    id: 'part', name: 'Part', geometry: { kind: 'box', dimensionsM: [0.1, 0.1, 0.1], color: '#ffffff' },
    parentFrameId: 'world',
    localPose: { positionM: options.objectPositionM ?? [0, 0, 0], quaternion: [0, 0, 0, 1] },
    visible: true, groupId: null, removable: true, transformOwner: 'simulation',
    numericStatus: { value: 0, sourceOwnership: 'simulation', overlay: { visible: false, frameId: null } },
    graspable: true,
    graspFrames: [{ frameId: 'part-grasp', name: 'Part grasp', localPose: IDENTITY_POSE }],
    movingFrames: [],
  })
  ;(project.logicalSignals as unknown as WorkcellProjectV5['logicalSignals'][number][]).splice(
    0,
    1,
    { id: 'start', name: 'Start', dataType: 'Boolean', direction: 'output', initialValue: false, unit: '', scope: { type: 'project' } },
    { id: 'ready', name: 'Ready', dataType: 'Boolean', direction: 'input', initialValue: false, unit: '', scope: { type: 'project' } },
  )
  ;(project.opcUa.endpoints[0] as unknown as { endpointId: string }).endpointId = 'plc'
  ;(project.opcUa.mappings as unknown as WorkcellProjectV5['opcUa']['mappings'][number][]).splice(
    0,
    1,
    {
      id: 'map-start', endpointId: 'plc',
      nodeAddress: { namespaceUri: 'urn:job-io:plc', identifierType: 'string', identifier: 'Start' },
      direction: 'write', coherenceGroupId: null, interpolationMode: 'none',
      coordinateConvention: 'project-v5-z-up-metres-quaternion-xyzw',
      leaves: [{
        leafPath: [], projectPath: [], projectTarget: { type: 'logical-signal', signalId: 'start' },
        opcUaDataType: 'Boolean', projectDataType: 'boolean', scale: 1, offset: 0, unit: '', required: true,
      }],
    },
    {
      id: 'map-ready', endpointId: 'plc',
      nodeAddress: { namespaceUri: 'urn:job-io:plc', identifierType: 'string', identifier: 'Ready' },
      direction: 'read', coherenceGroupId: null, interpolationMode: 'none',
      coordinateConvention: 'project-v5-z-up-metres-quaternion-xyzw',
      leaves: [{
        leafPath: [], projectPath: [], projectTarget: { type: 'logical-signal', signalId: 'ready' },
        opcUaDataType: 'Boolean', projectDataType: 'boolean', scale: 1, offset: 0, unit: '', required: true,
      }],
    },
  )
  ;(project.jobs[0] as unknown as { name: string; instructions: readonly RobotJobInstructionV1[] }).name = 'Job I/O integration'
  ;(project.jobs[0] as unknown as { instructions: readonly RobotJobInstructionV1[] }).instructions = options.instructions ?? authoredInstructions()
  return validateWorkcellProjectV5(project)
}

function readyBatch(value: boolean, sequence: number): StateBatchV1 {
  return {
    type: 'state-batch-v1', protocolVersion: 1, gatewayId: 'gateway-local',
    projectId: 'project-v5', configRevision: CONFIG_REVISION, endpointId: 'plc', sequence,
    sourceTimestampMs: sequence, publishedTimestampMs: sequence, originId: 'gateway-local:client',
    values: [{
      mappingId: 'map-ready', coherenceGroupId: null, value, unit: '',
      quality: 'GOOD', statusCode: 'Good',
    }],
  }
}

function commandResult(request: Parameters<RuntimeGatewayCommandClientV1['writeBoolean']>[0]): CommandResultV1 {
  return {
    type: 'command-result-v1', protocolVersion: 1,
    projectId: request.projectId, configRevision: request.configRevision,
    leaseGeneration: 1, targetId: request.targetId, commandId: 'fake-command',
    acknowledgement: 'ACCEPTED', executionState: 'SUCCEEDED', failureCode: null,
    message: 'done', attachedObjectId: null, completedAt: 0,
  }
}

function poseDifference(from: RigidTransformV5, to: RigidTransformV5): {
  readonly positionM: number
  readonly orientationDeg: number
} {
  const positionM = Math.hypot(
    to.positionM[0] - from.positionM[0],
    to.positionM[1] - from.positionM[1],
    to.positionM[2] - from.positionM[2],
  )
  const dot = Math.min(1, Math.abs(
    from.quaternion[0] * to.quaternion[0]
    + from.quaternion[1] * to.quaternion[1]
    + from.quaternion[2] * to.quaternion[2]
    + from.quaternion[3] * to.quaternion[3],
  ))
  return Object.freeze({ positionM, orientationDeg: 2 * Math.acos(dot) * 180 / Math.PI })
}

function integratedHarness(project: WorkcellProjectV5) {
  const robots = createRobotJointRuntimeStoreV5(project, CONFIG_REVISION)
  const jobs = createJobRuntimeStoreV5(project, CONFIG_REVISION)
  const signals = createLogicalSignalRuntimeStoreV1(project, CONFIG_REVISION)
  const attachments = createAttachmentRuntimeStoreV1(project, CONFIG_REVISION)
  const attachmentPoses = createAttachmentPoseRuntimeV1(attachments)
  const fakeCommandClient: RuntimeGatewayCommandClientV1 = {
    clearLease: vi.fn(),
    writeBoolean: vi.fn(async (request) => commandResult(request)),
  }
  const signalWrites = createGatewaySignalWritePortV1({
    readActiveContext: () => ({ project, configRevision: CONFIG_REVISION }),
    commandClient: fakeCommandClient,
  })
  const readRobotFrameWorldPose = vi.fn((robotId: string, frameId: string): RigidTransformV5 | null => {
    if (robotId !== 'robot-1') return null
    return robots.getState().readRobotPose(robotId).frameWorldPoses[frameId] ?? null
  })
  const readSceneFrameWorldPose = vi.fn((frameId: string): RigidTransformV5 | null => (
    frameId === 'world' || frameId === 'mcp' || frameId === 'fixture' ? IDENTITY_POSE : null
  ))
  const authoredPartPose = project.spatialEntities.find(({ id }) => id === 'part')?.localPose ?? null
  const readObjectWorldPose = vi.fn((objectId: string): RigidTransformV5 | null => (
    attachmentPoses.readObjectWorldPose(objectId, readRobotFrameWorldPose, readSceneFrameWorldPose)
    ?? (objectId === 'part' ? authoredPartPose : null)
  ))
  const browserAttachments = createBrowserAttachmentInstructionPortV1({
    readProject: () => project,
    readConfigRevision: () => CONFIG_REVISION,
    attachments,
    readRobotFrameWorldPose,
    readSceneFrameWorldPose,
    readObjectWorldPose,
  })
  const poseDiscontinuities: Array<{ readonly positionM: number; readonly orientationDeg: number }> = []
  const observedAttachments = {
    async attach(
      instruction: Extract<RobotJobInstructionV1, { readonly kind: 'attach' }>,
      context: Parameters<typeof browserAttachments.attach>[1],
    ): Promise<void> {
      const before = readObjectWorldPose(instruction.objectId)
      await browserAttachments.attach(instruction, context)
      const after = readObjectWorldPose(instruction.objectId)
      if (before !== null && after !== null) poseDiscontinuities.push(poseDifference(before, after))
    },
    async detach(
      instruction: Extract<RobotJobInstructionV1, { readonly kind: 'detach' }>,
      context: Parameters<typeof browserAttachments.detach>[1],
    ): Promise<void> {
      const before = readObjectWorldPose(instruction.objectId)
      await browserAttachments.detach(instruction, context)
      const after = readObjectWorldPose(instruction.objectId)
      if (before !== null && after !== null) poseDiscontinuities.push(poseDifference(before, after))
    },
  }
  let run = 0
  const executor = createRobotJobExecutorV5({
    readProject: () => project,
    robots,
    jobs,
    signals,
    signalWrites,
    attachments: observedAttachments,
    createRunId: () => `run-${++run}`,
  })
  const authoredOrder: string[] = []
  let lastStepIndex: number | null = null
  const unsubscribeOrder = jobs.subscribe((state) => {
    const runtime = state.byRobotId['robot-1']
    if (runtime === undefined || runtime.stepIndex === null || runtime.stepIndex === lastStepIndex) return
    lastStepIndex = runtime.stepIndex
    const instruction = project.jobs[0]!.instructions[runtime.stepIndex]
    if (instruction !== undefined) authoredOrder.push(`${instruction.kind}:${instruction.id}`)
  })
  return {
    project, robots, jobs, signals, attachments, attachmentPoses,
    fakeCommandClient, executor, authoredOrder, poseDiscontinuities,
    readRobotFrameWorldPose, readSceneFrameWorldPose, readObjectWorldPose,
    dispose: () => { unsubscribeOrder(); executor.shutdown() },
  }
}

describe('V5 Job I/O integration', () => {
  it('executes all seven instructions in authored order with quality gates and continuous attachment poses', async () => {
    const harness = integratedHarness(jobProject())
    try {
      const initialPart = harness.readObjectWorldPose('part')
      const initialTcp = harness.readRobotFrameWorldPose('robot-1', 'TCP')
      expect(initialPart).toEqual(initialTcp)

      harness.executor.startJob('job-1', 0)
      await harness.executor.advanceAll(0)
      expect(harness.jobs.getState().byRobotId['robot-1']).toMatchObject({ state: 'RUNNING', stepIndex: 2 })
      expect(harness.robots.getState().readRobot('robot-1')).toMatchObject({ jointValues: { J1: 9 } })
      expect(harness.signals.getState().read('ready')).toMatchObject({ quality: 'BAD', statusCode: 'BadWaitingForInitialData' })

      harness.signals.getState().markEndpointDisconnected('plc', 10)
      await harness.executor.advanceAll(25)
      expect(harness.signals.getState().read('ready')).toMatchObject({ quality: 'STALE', statusCode: 'BadNoCommunication' })
      expect(harness.jobs.getState().byRobotId['robot-1']).toMatchObject({ state: 'RUNNING', stepIndex: 2 })

      harness.signals.getState().resetEndpointSession('plc', 30)
      expect(harness.signals.getState().ingest(readyBatch(false, 1), 31)).toBe(true)
      await harness.executor.advanceAll(50)
      expect(harness.signals.getState().read('ready')).toMatchObject({ value: false, quality: 'GOOD' })
      expect(harness.jobs.getState().byRobotId['robot-1']).toMatchObject({ state: 'RUNNING', stepIndex: 2 })

      expect(harness.signals.getState().ingest(readyBatch(true, 2), 51)).toBe(true)
      await harness.executor.advanceAll(50)
      expect(harness.jobs.getState().byRobotId['robot-1']).toMatchObject({ state: 'RUNNING', stepIndex: 3 })
      await harness.executor.advanceAll(149)
      expect(harness.jobs.getState().byRobotId['robot-1']).toMatchObject({ state: 'RUNNING', stepIndex: 3 })
      expect(Object.keys(harness.attachments.getState().attachmentsByObjectId)).toHaveLength(0)

      await harness.executor.advanceAll(150)
      expect(harness.jobs.getState().byRobotId['robot-1']).toMatchObject({ state: 'RUNNING', stepIndex: 5 })
      expect(harness.attachments.getState().attachmentsByObjectId.part).toMatchObject({ toolFrameId: 'TCP' })
      await harness.executor.advanceAll(1_049)
      expect(harness.jobs.getState().byRobotId['robot-1']).toMatchObject({ state: 'RUNNING', stepIndex: 5 })
      await harness.executor.advanceAll(1_050)

      expect(harness.jobs.getState().byRobotId['robot-1']).toMatchObject({ state: 'SUCCEEDED', stepIndex: 7 })
      expect(harness.authoredOrder).toEqual([
        'move-joint:move-1', 'set-do:set-start', 'wait-di:wait-ready', 'delay:settle',
        'attach:pick', 'move-joint:move-2', 'detach:place',
      ])
      expect(harness.fakeCommandClient.writeBoolean).toHaveBeenCalledExactlyOnceWith({
        projectId: harness.project.projectId, configRevision: CONFIG_REVISION,
        targetId: 'map-start', value: true,
      }, expect.any(AbortSignal))
      expect(harness.robots.getState().readRobot('robot-1')).toMatchObject({ jointValues: { J1: 90 } })
      expect(Object.keys(harness.attachments.getState().attachmentsByObjectId)).toHaveLength(0)
      expect(harness.attachments.getState().detachedOverridesByObjectId.part).toMatchObject({ parentFrameId: 'fixture' })
      expect(harness.poseDiscontinuities).toHaveLength(2)
      expect(harness.poseDiscontinuities.every(({ positionM, orientationDeg }) => (
        positionM <= 0.0005 && orientationDeg <= 0.1
      ))).toBe(true)
    } finally {
      harness.dispose()
    }
  })

  it('propagates the real attachment OUT_OF_RANGE failure at step zero without store publication', async () => {
    const instruction: RobotJobInstructionV1 = {
      id: 'pick', kind: 'attach', objectId: 'part', toolFrameId: 'TCP',
      objectGraspFrameId: 'part-grasp', maximumDistanceM: 0.01,
    }
    const harness = integratedHarness(jobProject({ instructions: [instruction], objectPositionM: [1, 0, 0] }))
    let attachmentPublications = 0
    const unsubscribe = harness.attachments.subscribe(() => { attachmentPublications += 1 })
    try {
      harness.executor.startJob('job-1', 0)
      await harness.executor.advanceAll(0)
      expect(harness.jobs.getState().byRobotId['robot-1']).toMatchObject({
        state: 'FAILED', failureCode: 'OUT_OF_RANGE', stepIndex: 0,
      })
      expect(Object.keys(harness.attachments.getState().attachmentsByObjectId)).toHaveLength(0)
      expect(Object.keys(harness.attachments.getState().detachedOverridesByObjectId)).toHaveLength(0)
      expect(attachmentPublications).toBe(0)
    } finally {
      unsubscribe()
      harness.dispose()
    }
  })
})
