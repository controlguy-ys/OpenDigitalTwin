import {
  validateCommandBatchV1,
  validateCommandResultV1,
  type CommandBatchV1,
  type CommandResultV1,
  type RuntimePublisherLeaseV1,
} from '../../../core/runtime-protocol/v1.js'
import {
  validateWorkcellProjectV5,
  type RigidTransformV5,
  type WorkcellProjectV5,
} from '../../../core/project-v5/index.js'
import type { ProductCommandPayloadV1 } from '../../../../middleware/runtime-gateway/opcua-command-staging.js'

export interface RuntimeGatewaySimulationCommandPortV5 {
  writeJointValues(robotId: string, values: Readonly<Record<string, number>>): void | Promise<void>
  commitObjectPose(objectId: string, pose: RigidTransformV5): void | Promise<void>
  writeLogicalSignal(signalId: string, value: boolean | number | string): void | Promise<void>
  startJob(jobId: string): void | Promise<void>
  cancelJob(jobId: string): void | Promise<void>
}

export interface RuntimeGatewayCommandOwnerV5 {
  execute(batch: CommandBatchV1): Promise<CommandResultV1>
}

function terminal(
  batch: CommandBatchV1,
  command: CommandBatchV1['commands'][number],
  acknowledgement: 'ACCEPTED' | 'REJECTED',
  failureCode: string | null,
  message: string,
  completedAt: number,
): CommandResultV1 {
  return validateCommandResultV1({
    type: 'command-result-v1', protocolVersion: 1, projectId: batch.projectId, configRevision: batch.configRevision,
    leaseGeneration: batch.leaseGeneration, targetId: command.targetId, commandId: command.commandId,
    acknowledgement, executionState: failureCode === null ? 'SUCCEEDED' : 'FAILED', failureCode, message,
    attachedObjectId: null, completedAt,
  })
}

function poseFromRpy(pose: Extract<ProductCommandPayloadV1, { kind: 'scene-object-pose' }>['pose']): RigidTransformV5 {
  const halfRoll = pose.roll / 2
  const halfPitch = pose.pitch / 2
  const halfYaw = pose.yaw / 2
  const cr = Math.cos(halfRoll); const sr = Math.sin(halfRoll)
  const cp = Math.cos(halfPitch); const sp = Math.sin(halfPitch)
  const cy = Math.cos(halfYaw); const sy = Math.sin(halfYaw)
  const zero = (value: number): number => Math.abs(value) < 1e-12 ? 0 : value
  return Object.freeze({
    positionM: [pose.x, pose.y, pose.z] as RigidTransformV5['positionM'],
    quaternion: [zero(sr * cp * cy - cr * sp * sy), zero(cr * sp * cy + sr * cp * sy), zero(cr * cp * sy - sr * sp * cy), zero(cr * cp * cy + sr * sp * sy)] as RigidTransformV5['quaternion'],
  })
}

function payload(value: unknown): ProductCommandPayloadV1 | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null
  const input = value as Record<string, unknown>
  if (input.kind === 'robot-joint-target' && typeof input.robotId === 'string' && input.jointValues !== null && typeof input.jointValues === 'object' && !Array.isArray(input.jointValues)) {
    const jointValues = Object.entries(input.jointValues as Record<string, unknown>)
    if (jointValues.every(([, jointValue]) => typeof jointValue === 'number' && Number.isFinite(jointValue))) {
      const values: Record<string, number> = Object.create(null) as Record<string, number>
      for (const [jointId, jointValue] of jointValues) values[jointId] = jointValue as number
      return { kind: input.kind, robotId: input.robotId, jointValues: Object.freeze(values) }
    }
  }
  if (input.kind === 'scene-object-pose' && typeof input.objectId === 'string' && input.pose !== null && typeof input.pose === 'object') {
    const pose = input.pose as Record<string, unknown>
    if (['x', 'y', 'z', 'roll', 'pitch', 'yaw'].every((key) => typeof pose[key] === 'number' && Number.isFinite(pose[key] as number))) {
      return { kind: input.kind, objectId: input.objectId, pose: { x: pose.x as number, y: pose.y as number, z: pose.z as number, roll: pose.roll as number, pitch: pose.pitch as number, yaw: pose.yaw as number } }
    }
  }
  if (input.kind === 'logical-signal' && typeof input.signalId === 'string' && (typeof input.value === 'boolean' || typeof input.value === 'number' || typeof input.value === 'string')) return { kind: input.kind, signalId: input.signalId, value: input.value }
  if (input.kind === 'job' && typeof input.jobId === 'string' && (input.operation === 'start' || input.operation === 'cancel')) return { kind: input.kind, jobId: input.jobId, operation: input.operation }
  return null
}

export function createRuntimeGatewayCommandOwnerV5(options: Readonly<{
  project: WorkcellProjectV5
  configRevision: string
  leaseGeneration?: number
  /** Legacy generation-only fence for callers that do not hold a lease record. */
  readLeaseGeneration?: () => number | null
  /** Reads the complete Gateway-issued Browser lease for time and identity fencing. */
  readLease?: () => RuntimePublisherLeaseV1 | null
  nowMs: () => number
  simulation: RuntimeGatewaySimulationCommandPortV5
  isActive?: () => boolean
}>): RuntimeGatewayCommandOwnerV5 {
  const project = validateWorkcellProjectV5(options.project)
  const robots = new Map(project.robots.map((robot) => [robot.id, robot]))
  const definitions = new Map(project.robotDefinitions.map((definition) => [definition.id, definition]))
  const objects = new Set(project.spatialEntities.map(({ id }) => id))
  const signals = new Map(project.logicalSignals.map((signal) => [signal.id, signal]))
  const jobs = new Set(project.jobs.map(({ id }) => id))
  const now = (): number => options.nowMs()
  const active = (): boolean => options.isActive?.() ?? true
  const acceptedLease = (): number | null => options.readLeaseGeneration?.() ?? options.leaseGeneration ?? null
  const leaseMatches = (batch: CommandBatchV1): boolean => {
    const lease = options.readLease?.()
    if (lease !== undefined) {
      return lease !== null
        && lease.projectId === project.projectId
        && lease.configRevision === options.configRevision
        && lease.generation === batch.leaseGeneration
        && lease.expiresAt > now()
    }
    return acceptedLease() === batch.leaseGeneration
  }

  return Object.freeze({
    async execute(batchInput: CommandBatchV1) {
      const batch = validateCommandBatchV1(batchInput)
      const command = batch.commands[0]
      if (command === undefined || batch.commands.length !== 1) throw new Error('BROWSER_COMMAND_BATCH_SIZE_INVALID')
      if (
        batch.projectId !== project.projectId
        || batch.configRevision !== options.configRevision
        || !leaseMatches(batch)
        || !active()
      ) {
        return terminal(batch, command, 'ACCEPTED', 'COMMAND_LEASE_STALE', 'Browser command owner is not active.', now())
      }
      if (command.expiresAt <= now()) return terminal(batch, command, 'ACCEPTED', 'COMMAND_EXPIRED', 'Command has expired.', now())
      const candidate = payload(command.value)
      if (candidate === null) return terminal(batch, command, 'ACCEPTED', 'COMMAND_TARGET_INVALID', 'Command payload is invalid.', now())
      try {
        if (candidate.kind === 'robot-joint-target') {
          const robot = robots.get(candidate.robotId)
          const definition = robot === undefined ? undefined : definitions.get(robot.definitionId)
          const jointIds = definition === undefined ? [] : definition.joints.map(({ id }) => id)
          if (command.targetId !== candidate.robotId || definition === undefined || Object.keys(candidate.jointValues).length !== jointIds.length || !jointIds.every((id) => Object.hasOwn(candidate.jointValues, id))) throw new Error('COMMAND_TARGET_INVALID')
          await options.simulation.writeJointValues(candidate.robotId, candidate.jointValues)
        } else if (candidate.kind === 'scene-object-pose') {
          if (command.targetId !== candidate.objectId || !objects.has(candidate.objectId)) throw new Error('COMMAND_TARGET_INVALID')
          await options.simulation.commitObjectPose(candidate.objectId, poseFromRpy(candidate.pose))
        } else if (candidate.kind === 'logical-signal') {
          const signal = signals.get(candidate.signalId)
          if (command.targetId !== candidate.signalId || signal === undefined) throw new Error('COMMAND_TARGET_INVALID')
          await options.simulation.writeLogicalSignal(candidate.signalId, candidate.value)
        } else {
          if (command.targetId !== candidate.jobId || !jobs.has(candidate.jobId)) throw new Error('COMMAND_TARGET_INVALID')
          if (candidate.operation === 'start') await options.simulation.startJob(candidate.jobId)
          else await options.simulation.cancelJob(candidate.jobId)
        }
        if (!active() || !leaseMatches(batch)) {
          return terminal(batch, command, 'ACCEPTED', 'COMMAND_LEASE_STALE', 'Browser command owner changed during execution.', now())
        }
        if (command.expiresAt <= now()) return terminal(batch, command, 'ACCEPTED', 'COMMAND_EXPIRED', 'Command expired during execution.', now())
        return terminal(batch, command, 'ACCEPTED', null, 'Browser command succeeded.', now())
      } catch (error) {
        const code = error instanceof Error && error.message === 'COMMAND_TARGET_INVALID' ? 'COMMAND_TARGET_INVALID' : 'BROWSER_COMMAND_FAILED'
        return terminal(batch, command, 'ACCEPTED', code, code === 'COMMAND_TARGET_INVALID' ? 'Command target is invalid.' : 'Browser command failed.', now())
      }
    },
  })
}
