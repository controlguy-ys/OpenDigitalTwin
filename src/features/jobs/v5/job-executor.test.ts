import { describe, expect, it, vi } from 'vitest'

import { makeMinimalWorkcellProjectV5 } from '../../../core/project-v5/test-support.js'
import type { CommandResultV1 } from '../../../core/runtime-protocol/v1.js'
import { createLogicalSignalRuntimeStoreV1 } from '../../signals/v5/logical-signal-runtime-store.js'
import { createRobotJointRuntimeStoreV5 } from '../../robot/v5/robot-joint-runtime-store.js'
import { createAttachmentInstructionErrorV1 } from '../../../core/action-runtime-v5/attachment-instruction-error.js'
import {
  GatewaySignalWriteErrorV1,
  RuntimeGatewayCommandClientV1Error,
} from '../../runtime-gateway/v5/runtime-gateway-command-client.js'
import { createJobRuntimeStoreV5 } from './job-runtime-store.js'
import { createRobotJobExecutorV5 } from './job-executor.js'

const REVISION = 'a'.repeat(64)

function terminalResult(overrides: Partial<CommandResultV1> = {}): CommandResultV1 {
  return {
    type: 'command-result-v1', protocolVersion: 1, projectId: 'project-v5', configRevision: REVISION,
    leaseGeneration: 1, targetId: 'target', commandId: 'command', acknowledgement: 'ACCEPTED',
    executionState: 'SUCCEEDED', failureCode: null, message: '', attachedObjectId: null, completedAt: 1,
    ...overrides,
  }
}

function addPart(project: ReturnType<typeof makeMinimalWorkcellProjectV5>): void {
  ;(project.spatialEntities as unknown as unknown[]).push({
    id: 'part', name: 'Part', geometry: { kind: 'box', dimensionsM: [0.1, 0.1, 0.1], color: '#ffffff' },
    parentFrameId: 'mcp', localPose: { positionM: [0, 0, 0], quaternion: [0, 0, 0, 1] }, visible: true,
    groupId: null, removable: true, transformOwner: 'simulation',
    numericStatus: { value: 0, sourceOwnership: 'simulation', overlay: { visible: false, frameId: null } },
    graspable: true, graspFrames: [], movingFrames: [],
  })
}

function harness(instructions: unknown[], options: { readonly jointSource?: 'simulation' | `opcua:${string}`; readonly write?: (id: string, value: boolean, signal?: AbortSignal) => Promise<CommandResultV1>; readonly attach?: () => Promise<void>; readonly detach?: () => Promise<void>; readonly jointRange?: readonly [number, number]; readonly createRunId?: () => string; readonly readProject?: () => ReturnType<typeof makeMinimalWorkcellProjectV5> } = {}) {
  const project = structuredClone(makeMinimalWorkcellProjectV5())
  ;(project.jobs[0]!.instructions as unknown as unknown[]).splice(0, 1, ...instructions)
  ;(project.logicalSignals[0] as { direction: 'input' | 'output' | 'bidirectional' | 'internal' }).direction = 'bidirectional'
  ;(project.opcUa.mappings[0] as { direction: 'read' | 'write' | 'readWrite' }).direction = 'readWrite'
  addPart(project)
  if (options.jointSource !== undefined) (project.robots[0] as { jointSource: typeof options.jointSource }).jointSource = options.jointSource
  if (options.jointRange !== undefined) {
    const joint = project.robotDefinitions[0]!.joints[0] as { min: number; max: number }
    joint.min = options.jointRange[0]; joint.max = options.jointRange[1]
  }
  const robots = createRobotJointRuntimeStoreV5(project, REVISION)
  const jobs = createJobRuntimeStoreV5(project, REVISION)
  const signals = createLogicalSignalRuntimeStoreV1(project, REVISION)
  const writeBoolean = options.write ?? vi.fn(async () => terminalResult())
  const executor = createRobotJobExecutorV5({
    readProject: options.readProject ?? (() => project), robots, jobs, signals,
    signalWrites: { writeBoolean },
    attachments: { attach: async () => options.attach?.(), detach: async () => options.detach?.() },
    createRunId: options.createRunId ?? (() => { let next = 1; return () => `run-${next++}` })(),
  })
  return { executor, jobs, robots, signals, writeBoolean, project }
}

function signalBatch(value: boolean, quality: 'GOOD' | 'BAD' = 'GOOD', sequence = 1): import('../../../core/runtime-protocol/v1.js').StateBatchV1 {
  return {
    type: 'state-batch-v1', protocolVersion: 1, gatewayId: 'gateway', projectId: 'project-v5', configRevision: REVISION,
    endpointId: 'endpoint-1', sequence, sourceTimestampMs: sequence * 100, publishedTimestampMs: sequence * 100,
    originId: 'gateway', values: [{ mappingId: 'mapping-1', coherenceGroupId: null, value, unit: '', quality, statusCode: quality === 'GOOD' ? 'Good' : 'Bad' }],
  }
}

describe('RobotJobExecutorV5', () => {
  it('keeps public methods safe when destructured', async () => {
    const subject = harness([{ id: 'delay', kind: 'delay', durationMs: 1 }])
    const { startJob, advanceAll, cancelJob } = subject.executor
    startJob('job-1', 0)
    await advanceAll(0)
    cancelJob('robot-1', 'destructured')
    expect(subject.jobs.getState().byRobotId['robot-1']).toMatchObject({ state: 'CANCELLED' })
    expect(() => subject.executor.readState('toString')).toThrow('ROBOT_INSTANCE_NOT_FOUND')
  })

  it('validates a replacement Run ID before cancelling the authoritative run', async () => {
    let id = 'run-1'
    const subject = harness([{ id: 'delay', kind: 'delay', durationMs: 100 }], { createRunId: () => id })
    const original = subject.executor.startJob('job-1', 0)
    id = ''
    expect(() => subject.executor.startJob('job-1', 1)).toThrow('JOB_RUN_ID_INVALID')
    expect(subject.jobs.getState().byRobotId['robot-1']).toMatchObject({ state: 'RUNNING', runId: original.runId })
    id = original.runId
    expect(() => subject.executor.startJob('job-1', 1)).toThrow('JOB_RUN_ID_DUPLICATE')
    expect(subject.jobs.getState().byRobotId['robot-1']).toMatchObject({ state: 'RUNNING', runId: original.runId })
    await subject.executor.advanceAll(100)
    expect(subject.jobs.getState().byRobotId['robot-1']).toMatchObject({ state: 'SUCCEEDED', runId: original.runId })
  })

  it('rolls back a failed replacement publication without creating a phantom Run ID', async () => {
    const subject = harness([{ id: 'delay', kind: 'delay', durationMs: 100 }])
    const original = subject.executor.startJob('job-1', 0)
    const state = subject.jobs.getState()
    const publish = state.setRobotState
    let rejectNext = true
    subject.jobs.setState({ ...state, setRobotState: (candidate) => {
      if (rejectNext && candidate.runId !== original.runId) { rejectNext = false; throw new Error('publication rejected') }
      publish(candidate)
    } }, true)
    expect(() => subject.executor.startJob('job-1', 1)).toThrow('publication rejected')
    expect(subject.jobs.getState().byRobotId['robot-1']).toMatchObject({ state: 'RUNNING', runId: original.runId })
    await expect(subject.executor.waitForTerminal('run-2')).rejects.toThrow('Unknown Job run')
    await subject.executor.advanceAll(100)
    await expect(subject.executor.waitForTerminal(original.runId)).resolves.toMatchObject({ state: 'SUCCEEDED' })
  })

  it('fences every mutation while a replacement start publication is observable', async () => {
    const write = vi.fn(async () => terminalResult())
    const subject = harness([{ id: 'set', kind: 'set-do', signalId: 'PartPresent', value: true }], { write })
    const original = subject.executor.startJob('job-1', 0)
    let triggered = false
    const synchronousErrors: unknown[] = []
    const pending: Promise<unknown>[] = []
    const attempt = (operation: () => unknown): void => {
      try {
        const result = operation()
        if (result instanceof Promise) pending.push(result)
      } catch (error) { synchronousErrors.push(error) }
    }
    const unsubscribe = subject.jobs.subscribe((state) => {
      if (triggered || state.byRobotId['robot-1']?.runId !== 'run-2') return
      triggered = true
      attempt(() => subject.executor.advanceAll(1))
      attempt(() => subject.executor.advanceRobot('robot-1', 1))
      attempt(() => subject.executor.cancelRobotJob('robot-1', 'reentrant cancel'))
      attempt(() => subject.executor.cancelJob(undefined, 'reentrant cancel all'))
      attempt(() => subject.executor.reset())
      attempt(() => subject.executor.shutdown('reentrant shutdown'))
      throw new Error('subscriber publication rejected')
    })
    expect(() => subject.executor.startJob('job-1', 1)).toThrow('subscriber publication rejected')
    unsubscribe()
    const asynchronous = await Promise.allSettled(pending)
    const rejected = asynchronous.filter((result) => result.status === 'rejected').map((result) => result.reason)
    expect([...synchronousErrors, ...rejected]).toHaveLength(6)
    expect([...synchronousErrors, ...rejected].every((error) => String(error).includes('JOB_RUNTIME_START_IN_PROGRESS'))).toBe(true)
    expect(write).not.toHaveBeenCalled()
    expect(subject.jobs.getState().byRobotId['robot-1']).toMatchObject({ state: 'RUNNING', runId: original.runId })
    await expect(subject.executor.waitForTerminal('run-2')).rejects.toThrow('Unknown Job run')
    subject.executor.cancelRobotJob('robot-1', 'cleanup')
  })

  it('preflights reset and shutdown before tearing down a running session', () => {
    for (const operation of ['reset', 'shutdown'] as const) {
      let failRead = false
      let projectRef!: ReturnType<typeof makeMinimalWorkcellProjectV5>
      const subject = harness([{ id: 'delay', kind: 'delay', durationMs: 100 }], {
        readProject: () => { if (failRead) throw new Error('preflight failed'); return projectRef },
      })
      projectRef = subject.project
      const run = subject.executor.startJob('job-1', 0)
      failRead = true
      expect(() => subject.executor[operation]()).toThrow('preflight failed')
      expect(subject.jobs.getState().byRobotId['robot-1']).toMatchObject({ state: 'RUNNING', runId: run.runId })
    }
  })

  it('installs the SetDO controller and queue before injected synchronous reentry', async () => {
    let executor!: ReturnType<typeof harness>['executor']
    let signal: AbortSignal | undefined
    let reentered: Promise<void> | undefined
    const write = vi.fn((_id: string, _value: boolean, supplied?: AbortSignal) => {
      signal = supplied
      reentered = executor.advanceAll(0)
      executor.cancelRobotJob('robot-1', 'sync cancel')
      return Promise.resolve(terminalResult())
    })
    const subject = harness([
      { id: 'set', kind: 'set-do', signalId: 'PartPresent', value: true },
      { id: 'delay', kind: 'delay', durationMs: 10 },
    ], {
      write,
    })
    executor = subject.executor
    executor.startJob('job-1', 0)
    await executor.advanceAll(0)
    await reentered
    expect(signal?.aborted).toBe(true)
    expect(write).toHaveBeenCalledOnce()
    expect(subject.jobs.getState().byRobotId['robot-1']).toMatchObject({ state: 'CANCELLED' })
  })

  it('settles an unexpected non-port failure once without poisoning later runs', async () => {
    const subject = harness([{ id: 'move', kind: 'move-joint', jointValues: { J1: 5 }, speedPercentToNext: 100 }])
    const first = subject.executor.startJob('job-1', 0)
    const current = subject.robots.getState()
    subject.robots.setState({ ...current, writeJointValues: () => { throw new Error('unexpected robot failure') } }, true)
    await expect(subject.executor.advanceAll(0)).resolves.toBeUndefined()
    await expect(subject.executor.waitForTerminal(first.runId)).resolves.toMatchObject({ state: 'FAILED', failureCode: 'JOB_EXECUTION_FAILED' })
    ;(subject.project.jobs[0]!.instructions as unknown as unknown[]).splice(0, 1, { id: 'delay', kind: 'delay', durationMs: 1 })
    const next = subject.executor.startJob('job-1', 1)
    await expect(subject.executor.advanceAll(2)).resolves.toBeUndefined()
    await expect(subject.executor.waitForTerminal(next.runId)).resolves.toMatchObject({ state: 'SUCCEEDED' })
  })

  it('advances Robots independently when one Robot has a pending Attachment', async () => {
    const project = structuredClone(makeMinimalWorkcellProjectV5())
    addPart(project)
    ;(project.robots as unknown as unknown[]).push({ ...project.robots[0]!, id: 'robot-2', name: 'Robot 2', serialNumber: 'ROBOT-002' })
    ;(project.jobs[0]!.instructions as unknown as unknown[]).splice(0, 1, { id: 'attach', kind: 'attach', objectId: 'part', toolFrameId: 'Tool', objectGraspFrameId: null, maximumDistanceM: 1 })
    ;(project.jobs as unknown as unknown[]).push({ id: 'job-2', name: 'Job 2', robotId: 'robot-2', instructions: [{ id: 'delay-2', kind: 'delay', durationMs: 1 }] })
    const robots = createRobotJointRuntimeStoreV5(project, REVISION)
    const jobs = createJobRuntimeStoreV5(project, REVISION)
    const signals = createLogicalSignalRuntimeStoreV1(project, REVISION)
    let resolveAttach!: () => void
    const attachment = new Promise<void>((resolve) => { resolveAttach = resolve })
    let run = 0
    const executor = createRobotJobExecutorV5({
      readProject: () => project, robots, jobs, signals,
      signalWrites: { writeBoolean: async () => terminalResult() },
      attachments: { attach: () => attachment, detach: async () => undefined },
      createRunId: () => `run-${++run}`,
    })
    executor.startJob('job-1', 0)
    executor.startJob('job-2', 0)
    const blocked = executor.advanceRobot('robot-1', 0)
    await executor.advanceRobot('robot-2', 1)
    expect(jobs.getState().byRobotId['robot-1']).toMatchObject({ state: 'RUNNING' })
    expect(jobs.getState().byRobotId['robot-2']).toMatchObject({ state: 'SUCCEEDED' })
    resolveAttach()
    await blocked
  })
  it('waits for SetDO terminal success before advancing', async () => {
    let resolve!: (value: CommandResultV1) => void
    const pending = new Promise<CommandResultV1>((done) => { resolve = done })
    const writeBoolean = vi.fn(() => pending)
    const subject = harness([
      { id: 'set', kind: 'set-do', signalId: 'PartPresent', value: true },
      { id: 'delay', kind: 'delay', durationMs: 100 },
    ], { write: writeBoolean })
    subject.executor.startJob('job-1', 0)
    const advance = subject.executor.advanceAll(0)
    const overlapping = subject.executor.advanceAll(0)
    expect(subject.jobs.getState().byRobotId['robot-1']?.stepIndex).toBe(0)
    expect(writeBoolean).toHaveBeenCalledOnce()
    resolve(terminalResult())
    await advance
    await overlapping
    expect(subject.jobs.getState().byRobotId['robot-1']?.stepIndex).toBe(1)
    expect(writeBoolean).toHaveBeenCalledOnce()
  })

  it('preserves known failures and normalizes unknown SetDO failures once', async () => {
    const known = harness([{ id: 'set', kind: 'set-do', signalId: 'PartPresent', value: true }], {
      write: vi.fn(async () => terminalResult({ executionState: 'FAILED', failureCode: 'OPC_UA_WRITE_REJECTED' })),
    })
    known.executor.startJob('job-1', 0)
    await known.executor.advanceAll(0)
    expect(known.jobs.getState().byRobotId['robot-1']).toMatchObject({ state: 'FAILED', failureCode: 'OPC_UA_WRITE_REJECTED' })

    const unknown = harness([{ id: 'set', kind: 'set-do', signalId: 'PartPresent', value: true }], {
      write: vi.fn(async () => { throw new Error('unexpected') }),
    })
    unknown.executor.startJob('job-1', 0)
    await unknown.executor.advanceAll(0)
    expect(unknown.jobs.getState().byRobotId['robot-1']).toMatchObject({ state: 'FAILED', failureCode: 'SIGNAL_WRITE_FAILED' })
    await unknown.executor.advanceAll(1)
    expect(unknown.writeBoolean).toHaveBeenCalledOnce()
  })

  it.each([
    new GatewaySignalWriteErrorV1('SIGNAL_WRITE_MAPPING_NOT_FOUND', 'Missing Mapping.'),
    new GatewaySignalWriteErrorV1('SIGNAL_WRITE_MAPPING_AMBIGUOUS', 'Ambiguous Mapping.'),
    new RuntimeGatewayCommandClientV1Error('RUNTIME_GATEWAY_TIMEOUT', 'Timed out.'),
    new RuntimeGatewayCommandClientV1Error('RUNTIME_GATEWAY_UNAVAILABLE', 'Offline.'),
  ] as const)('preserves a recognized SetDO rejection once', async (error) => {
    const write = vi.fn(async () => { throw error })
    const subject = harness([{ id: 'set', kind: 'set-do', signalId: 'PartPresent', value: true }], { write })
    subject.executor.startJob('job-1', 0)
    await subject.executor.advanceAll(0)
    expect(subject.jobs.getState().byRobotId['robot-1']).toMatchObject({ state: 'FAILED', failureCode: error.code })
    await subject.executor.advanceAll(1)
    expect(write).toHaveBeenCalledOnce()
  })

  it('aborts a pending SetDO on cancellation and ignores its late settlement', async () => {
    let reject!: (error: unknown) => void
    let suppliedSignal: AbortSignal | undefined
    const pending = new Promise<CommandResultV1>((_resolve, fail) => { reject = fail })
    const write = vi.fn((_id: string, _value: boolean, signal?: AbortSignal) => {
      suppliedSignal = signal
      return pending
    })
    const subject = harness([{ id: 'set', kind: 'set-do', signalId: 'PartPresent', value: true }], { write })
    subject.executor.startJob('job-1', 0)
    const advancing = subject.executor.advanceAll(0)
    subject.executor.cancelRobotJob('robot-1', 'operator stop')
    expect(suppliedSignal?.aborted).toBe(true)
    reject(new Error('late'))
    await advancing
    expect(subject.jobs.getState().byRobotId['robot-1']).toMatchObject({ state: 'CANCELLED', failureCode: null })
    expect(write).toHaveBeenCalledOnce()
  })

  it('keeps a replacement run authoritative when a cancelled SetDO settles late', async () => {
    let rejectFirst!: (error: unknown) => void
    let calls = 0
    const first = new Promise<CommandResultV1>((_resolve, reject) => { rejectFirst = reject })
    const subject = harness([{ id: 'set', kind: 'set-do', signalId: 'PartPresent', value: true }], {
      write: vi.fn(() => (++calls === 1 ? first : Promise.resolve(terminalResult()))),
    })
    const old = subject.executor.startJob('job-1', 0)
    const oldAdvance = subject.executor.advanceAll(0)
    subject.executor.cancelRobotJob('robot-1', 'replace')
    const replacement = subject.executor.startJob('job-1', 1)
    await subject.executor.advanceAll(1)
    expect(subject.jobs.getState().byRobotId['robot-1']).toMatchObject({ state: 'SUCCEEDED', runId: replacement.runId })
    rejectFirst(new Error('late old rejection'))
    await oldAdvance
    expect(subject.jobs.getState().byRobotId['robot-1']).toMatchObject({ state: 'SUCCEEDED', runId: replacement.runId })
    expect(old.runId).not.toBe(replacement.runId)
  })

  it('preserves a replacement started synchronously by the old Abort listener', async () => {
    let executor!: ReturnType<typeof harness>['executor']
    let rejectOld!: (error: unknown) => void
    let replacement: { readonly runId: string } | undefined
    let calls = 0
    const oldPending = new Promise<CommandResultV1>((_resolve, reject) => { rejectOld = reject })
    const subject = harness([{ id: 'set', kind: 'set-do', signalId: 'PartPresent', value: true }], {
      write: (_id, _value, signal) => {
        calls += 1
        if (calls > 1) return Promise.resolve(terminalResult())
        signal!.addEventListener('abort', () => { replacement = executor.startJob('job-1', 1) }, { once: true })
        return oldPending
      },
    })
    executor = subject.executor
    const old = executor.startJob('job-1', 0)
    const oldAdvance = executor.advanceAll(0)
    executor.cancelRobotJob('robot-1', 'replace')
    expect(replacement).toBeDefined()
    await executor.advanceAll(1)
    expect(subject.jobs.getState().byRobotId['robot-1']).toMatchObject({ state: 'SUCCEEDED', runId: replacement!.runId })
    rejectOld(new Error('late old failure'))
    await oldAdvance
    await expect(executor.waitForTerminal(old.runId)).resolves.toMatchObject({ state: 'CANCELLED' })
    expect(subject.jobs.getState().byRobotId['robot-1']).toMatchObject({ state: 'SUCCEEDED', runId: replacement!.runId })
  })

  it('enforces exact Simulation timing for WaitDI and Delay', async () => {
    const wait = harness([{ id: 'wait', kind: 'wait-di', signalId: 'PartPresent', expected: true, timeoutMs: 1_000 }])
    wait.executor.startJob('job-1', 50)
    await wait.executor.advanceAll(1_049)
    expect(wait.jobs.getState().byRobotId['robot-1']?.state).toBe('RUNNING')
    await wait.executor.advanceAll(1_050)
    expect(wait.jobs.getState().byRobotId['robot-1']).toMatchObject({ state: 'FAILED', failureCode: 'WAIT_DI_TIMEOUT' })

    const delay = harness([{ id: 'delay', kind: 'delay', durationMs: 250 }])
    delay.executor.startJob('job-1', 10)
    await delay.executor.advanceAll(259)
    expect(delay.jobs.getState().byRobotId['robot-1']?.state).toBe('RUNNING')
    await delay.executor.advanceAll(260)
    expect(delay.jobs.getState().byRobotId['robot-1']?.state).toBe('SUCCEEDED')

    const exactGood = harness([{ id: 'wait', kind: 'wait-di', signalId: 'PartPresent', expected: true, timeoutMs: 1_000 }])
    exactGood.executor.startJob('job-1', 50)
    exactGood.signals.getState().ingest(signalBatch(true, 'GOOD', 1), 1_050)
    await exactGood.executor.advanceAll(1_050)
    expect(exactGood.jobs.getState().byRobotId['robot-1']?.state).toBe('SUCCEEDED')

    const fractional = harness([{ id: 'delay', kind: 'delay', durationMs: 1 }])
    fractional.executor.startJob('job-1', 0.5)
    await fractional.executor.advanceAll(1.5)
    expect(fractional.jobs.getState().byRobotId['robot-1']).toMatchObject({ state: 'SUCCEEDED', completedAtSimulationMs: 1.5 })
  })

  it('does not satisfy WaitDI from stale retained data, then succeeds on GOOD data', async () => {
    const subject = harness([{ id: 'wait', kind: 'wait-di', signalId: 'PartPresent', expected: true, timeoutMs: 1_000 }])
    subject.signals.getState().ingest(signalBatch(true, 'GOOD', 1), 1)
    subject.signals.getState().markEndpointDisconnected('endpoint-1', 2)
    subject.executor.startJob('job-1', 0)
    await subject.executor.advanceAll(500)
    expect(subject.jobs.getState().byRobotId['robot-1']?.state).toBe('RUNNING')
    subject.signals.getState().ingest(signalBatch(true, 'GOOD', 2), 600)
    await subject.executor.advanceAll(600)
    expect(subject.jobs.getState().byRobotId['robot-1']?.state).toBe('SUCCEEDED')
  })

  it('preserves listed Attachment errors and refuses OPC UA-owned Robots', async () => {
    const attached = harness([{ id: 'attach', kind: 'attach', objectId: 'part', toolFrameId: 'Tool', objectGraspFrameId: null, maximumDistanceM: 1 }], {
      attach: async () => { throw createAttachmentInstructionErrorV1('OUT_OF_RANGE', 'Out of range') },
    })
    attached.executor.startJob('job-1', 0)
    await attached.executor.advanceAll(0)
    expect(attached.jobs.getState().byRobotId['robot-1']).toMatchObject({ state: 'FAILED', failureCode: 'OUT_OF_RANGE' })

    const external = harness([{ id: 'move', kind: 'move-joint', jointValues: { J1: 10 }, speedPercentToNext: 100 }], { jointSource: 'opcua:endpoint-1' })
    expect(() => external.executor.startJob('job-1', 0)).toThrow('ROBOT_JOINT_SOURCE_NOT_SIMULATION')
  })

  it.each([
    'SOURCE_OWNERSHIP_CONFLICT', 'ALREADY_ATTACHED', 'NOT_ATTACHED', 'OUT_OF_RANGE',
    'ATTACHMENT_TARGET_NOT_FOUND', 'ATTACHMENT_FRAME_UNAVAILABLE',
  ] as const)('preserves Attachment failure %s after one call', async (code) => {
    const attach = vi.fn(async () => { throw createAttachmentInstructionErrorV1(code, `Attachment failed: ${code}`) })
    const subject = harness([{ id: 'attach', kind: 'attach', objectId: 'part', toolFrameId: 'Tool', objectGraspFrameId: null, maximumDistanceM: 1 }], { attach })
    subject.executor.startJob('job-1', 0)
    await subject.executor.advanceAll(0)
    expect(subject.jobs.getState().byRobotId['robot-1']).toMatchObject({ state: 'FAILED', failureCode: code })
    expect(attach).toHaveBeenCalledOnce()
  })

  it('normalizes an unknown detach rejection without retrying it', async () => {
    const project = structuredClone(makeMinimalWorkcellProjectV5())
    ;(project.jobs[0]!.instructions as unknown as unknown[]).splice(0, 1, { id: 'detach', kind: 'detach', objectId: 'part', targetParentFrameId: null })
    addPart(project)
    const robots = createRobotJointRuntimeStoreV5(project, REVISION)
    const jobs = createJobRuntimeStoreV5(project, REVISION)
    const signals = createLogicalSignalRuntimeStoreV1(project, REVISION)
    const detach = vi.fn(async () => { throw new Error('unexpected') })
    const executor = createRobotJobExecutorV5({
      readProject: () => project, robots, jobs, signals, signalWrites: { writeBoolean: async () => terminalResult() },
      attachments: { attach: async () => undefined, detach }, createRunId: () => 'run-1',
    })
    executor.startJob('job-1', 0)
    await executor.advanceAll(0)
    await executor.advanceAll(1)
    expect(jobs.getState().byRobotId['robot-1']).toMatchObject({ state: 'FAILED', failureCode: 'ATTACHMENT_INSTRUCTION_FAILED' })
    expect(detach).toHaveBeenCalledOnce()
  })

  it('executes authored I/O order and uses wrapped MoveJoint interpolation', async () => {
    const actions: string[] = []
    const io = harness([
      { id: 'first', kind: 'move-joint', jointValues: { J1: 170 }, speedPercentToNext: 100 },
      { id: 'second', kind: 'move-joint', jointValues: { J1: -170 }, speedPercentToNext: 100 },
      { id: 'set', kind: 'set-do', signalId: 'PartPresent', value: true },
      { id: 'wait', kind: 'wait-di', signalId: 'PartPresent', expected: true, timeoutMs: 100 },
      { id: 'delay', kind: 'delay', durationMs: 10 },
      { id: 'attach', kind: 'attach', objectId: 'part', toolFrameId: 'Tool', objectGraspFrameId: null, maximumDistanceM: 1 },
      { id: 'detach', kind: 'detach', objectId: 'part', targetParentFrameId: null },
    ], {
      write: vi.fn(async () => { actions.push('set'); return terminalResult() }),
      attach: async () => { actions.push('attach') }, detach: async () => { actions.push('detach') },
      jointRange: [-360, 360],
    })
    io.signals.getState().ingest(signalBatch(true), 0)
    io.executor.startJob('job-1', 0)
    await io.executor.advanceAll(0)
    await io.executor.advanceAll(111)
    expect(io.robots.getState().readRobot('robot-1')?.jointValues.J1).toBeCloseTo(180, 0)
    await io.executor.advanceAll(223)
    await io.executor.advanceAll(233)
    expect(io.jobs.getState().byRobotId['robot-1']).toMatchObject({ state: 'SUCCEEDED', stepIndex: 7 })
    expect(actions).toEqual(['set', 'attach', 'detach'])
  })

  it('prevents a cancelled Attachment rejection from mutating a replacement run', async () => {
    let rejectFirst!: (error: unknown) => void
    let calls = 0
    const first = new Promise<void>((_resolve, reject) => { rejectFirst = reject })
    const subject = harness([{ id: 'attach', kind: 'attach', objectId: 'part', toolFrameId: 'Tool', objectGraspFrameId: null, maximumDistanceM: 1 }], {
      attach: () => (++calls === 1 ? first : Promise.resolve()),
    })
    subject.executor.startJob('job-1', 0)
    const oldAdvance = subject.executor.advanceAll(0)
    subject.executor.cancelRobotJob('robot-1', 'replace')
    const replacement = subject.executor.startJob('job-1', 1)
    await subject.executor.advanceAll(1)
    expect(subject.jobs.getState().byRobotId['robot-1']).toMatchObject({ state: 'SUCCEEDED', runId: replacement.runId })
    rejectFirst(new Error('late attachment'))
    await oldAdvance
    expect(subject.jobs.getState().byRobotId['robot-1']).toMatchObject({ state: 'SUCCEEDED', runId: replacement.runId })
  })

  it('keeps reset and shutdown control flow from becoming a late failure', async () => {
    for (const close of [
      (executor: ReturnType<typeof harness>['executor']) => executor.reset(),
      (executor: ReturnType<typeof harness>['executor']) => executor.shutdown(),
    ]) {
      let reject!: (error: unknown) => void
      const pending = new Promise<CommandResultV1>((_resolve, fail) => { reject = fail })
      const subject = harness([{ id: 'set', kind: 'set-do', signalId: 'PartPresent', value: true }], { write: vi.fn(() => pending) })
      subject.executor.startJob('job-1', 0)
      const advancing = subject.executor.advanceAll(0)
      close(subject.executor)
      reject(new Error('late'))
      await advancing
      expect(subject.jobs.getState().byRobotId['robot-1']).toMatchObject({ state: 'IDLE', failureCode: null })
    }
  })

  it('fences reentrant Job starts during reset and shutdown while settling waiters once', async () => {
    for (const teardown of [
      (executor: ReturnType<typeof harness>['executor']) => executor.reset(),
      (executor: ReturnType<typeof harness>['executor']) => executor.shutdown(),
    ]) {
      let reject!: (error: unknown) => void
      let signal: AbortSignal | undefined
      const pending = new Promise<CommandResultV1>((_resolve, fail) => { reject = fail })
      const subject = harness([{ id: 'set', kind: 'set-do', signalId: 'PartPresent', value: true }], {
        write: (_id, _value, supplied) => { signal = supplied; return pending },
      })
      const run = subject.executor.startJob('job-1', 0)
      const waiter = subject.executor.waitForTerminal(run.runId)
      const reentrant: unknown[] = []
      const unsubscribe = subject.jobs.subscribe((state) => {
        if (state.byRobotId['robot-1']?.state !== 'IDLE') return
        try { subject.executor.startJob('job-1', 0) } catch (error) { reentrant.push(error) }
      })
      const advancing = subject.executor.advanceAll(0)
      teardown(subject.executor)
      unsubscribe()
      expect(signal?.aborted).toBe(true)
      await expect(waiter).resolves.toMatchObject({ state: 'CANCELLED', runId: run.runId })
      expect(reentrant).toHaveLength(1)
      reject(new Error('late'))
      await advancing
      expect(subject.jobs.getState().byRobotId['robot-1']).toMatchObject({ state: 'IDLE' })
    }
  })

  it('normalizes cross-domain and synchronous instruction failures without reissuing', async () => {
    const setDo = harness([{ id: 'set', kind: 'set-do', signalId: 'PartPresent', value: true }], {
      write: () => { throw createAttachmentInstructionErrorV1('OUT_OF_RANGE', 'wrong port') },
    })
    setDo.executor.startJob('job-1', 0)
    await setDo.executor.advanceAll(0)
    expect(setDo.jobs.getState().byRobotId['robot-1']).toMatchObject({ state: 'FAILED', failureCode: 'SIGNAL_WRITE_FAILED' })

    const attach = harness([{ id: 'attach', kind: 'attach', objectId: 'part', toolFrameId: 'Tool', objectGraspFrameId: null, maximumDistanceM: 1 }], {
      attach: () => { throw new RuntimeGatewayCommandClientV1Error('RUNTIME_GATEWAY_TIMEOUT', 'wrong port') },
    })
    attach.executor.startJob('job-1', 0)
    await attach.executor.advanceAll(0)
    expect(attach.jobs.getState().byRobotId['robot-1']).toMatchObject({ state: 'FAILED', failureCode: 'ATTACHMENT_INSTRUCTION_FAILED' })
  })
})
