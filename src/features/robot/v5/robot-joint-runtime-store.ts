import {
  failProjectV5,
  validateWorkcellProjectV5,
  type RigidTransformV5,
  type WorkcellProjectV5,
} from '../../../core/project-v5/index.js'
import { computeSerialRobotPoseV5, type SerialRobotPoseV5 } from '../../../core/robot-runtime-v5/serial-kinematics.js'
import { validateStateBatchV1, type StateBatchV1 } from '../../../core/runtime-protocol/v1.js'
import { createStore, type StoreApi } from 'zustand/vanilla'

export type RobotJointRuntimeQualityV5 = 'GOOD' | 'UNCERTAIN' | 'BAD' | 'STALE'
export type RobotJointWriterV5 = 'simulation' | 'manual' | `opcua:${string}`

export interface RobotJointRuntimeValueV5 {
  readonly robotId: string
  readonly definitionId: string
  readonly jointValues: Readonly<Record<string, number>>
  readonly jointSource: RobotJointWriterV5
  readonly quality: RobotJointRuntimeQualityV5
  readonly statusCode: string
  readonly sourceTimestampMs: number
  readonly publishedTimestampMs: number
  readonly receivedTimestampMs: number
  readonly revision: number
}

export interface RobotJointRuntimeStoreV5 {
  readonly projectRevisionId: string | null
  readonly configRevision: string | null
  readonly byRobotId: Readonly<Record<string, RobotJointRuntimeValueV5>>
  replaceProject(project: WorkcellProjectV5, configRevision: string): void
  ingest(batch: StateBatchV1, receivedTimestampMs: number): boolean
  restoreReplayPrefix(batch: StateBatchV1, receivedTimestampMs: number): boolean
  beginEndpointCatchup(endpointId: string, atMs: number): RobotJointCatchupGuardV5
  markEndpointDisconnected(endpointId: string, atMs: number): void
  resetEndpointSession(endpointId: string, atMs: number): void
  resetGatewaySession(atMs: number): void
  writeJointValues(robotId: string, values: Readonly<Record<string, number>>, writer: RobotJointWriterV5): void
  readRobot(robotId: string): RobotJointRuntimeValueV5 | null
  readRobotPose(robotId: string, worldBasePose?: RigidTransformV5): SerialRobotPoseV5
}

export interface RobotJointCatchupGuardV5 { commit(): void; abort(): void }

interface JointChannel {
  readonly mappingId: string
  readonly endpointId: string
  readonly robotId: string
  readonly jointId: string
  readonly minimum: number
  readonly maximum: number
}

interface Context {
  readonly project: WorkcellProjectV5
  readonly configRevision: string
  readonly definitionByRobotId: ReadonlyMap<string, WorkcellProjectV5['robotDefinitions'][number]>
  readonly channelsByMappingId: ReadonlyMap<string, JointChannel>
  readonly channelsByEndpoint: ReadonlyMap<string, readonly JointChannel[]>
  readonly endpoints: ReadonlySet<string>
  readonly endpointSequence: Map<string, number>
  readonly endpointReceipt: Map<string, number>
  readonly sourceFences: Map<string, number>
  readonly publishedFences: Map<string, number>
}

interface Guard {
  readonly snapshot: Readonly<Record<string, RobotJointRuntimeValueV5>>
  pending: Record<string, RobotJointRuntimeValueV5>
  readonly sequence: number | undefined
  readonly receipt: number | undefined
  readonly sourceFences: ReadonlyMap<string, number | undefined>
  readonly publishedFences: ReadonlyMap<string, number | undefined>
  active: boolean
}

const CONFIG_REVISION = /^[0-9a-f]{64}$/u
function failure(code: string, path: string, message: string): never {
  failProjectV5(code, path, message, 'Correct the Robot runtime command and try again.')
}
function revision(value: string): string {
  if (!CONFIG_REVISION.test(value)) throw new TypeError('Config revision must be a lowercase 64-character hexadecimal digest.')
  return value
}
function timestamp(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new TypeError(`${label} must be a non-negative safe integer.`)
  return value
}
function frozenRobot(value: RobotJointRuntimeValueV5): RobotJointRuntimeValueV5 {
  return Object.freeze({ ...value, jointValues: Object.freeze({ ...value.jointValues }) })
}
function frozenRobots(value: Readonly<Record<string, RobotJointRuntimeValueV5>>): Readonly<Record<string, RobotJointRuntimeValueV5>> {
  return Object.freeze(Object.assign(Object.create(null) as Record<string, RobotJointRuntimeValueV5>, value))
}
function increment(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0 || value === Number.MAX_SAFE_INTEGER) failure('ROBOT_RUNTIME_REVISION_EXHAUSTED', '$.revision', 'Robot runtime revision cannot be safely incremented.')
  return value + 1
}

function inspectPartialJointRecord(value: unknown, path: string): readonly [string, number][] {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    failure('PROJECT_VALUE_INVALID', path, 'Joint update must be a plain record.')
  }
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) {
    failure('PROJECT_VALUE_INVALID', path, 'Joint update must be a plain record without a custom prototype.')
  }
  const entries: Array<[string, number]> = []
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string') failure('PROJECT_VALUE_INVALID', path, 'Joint update keys must be strings.')
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (descriptor === undefined || !descriptor.enumerable || !('value' in descriptor)) {
      failure('PROJECT_VALUE_INVALID', path, 'Joint updates must use enumerable own data properties.')
    }
    entries.push([key, descriptor.value as number])
  }
  if (entries.length === 0) failure('ROBOT_JOINT_UPDATE_EMPTY', path, 'At least one Joint value is required.')
  return entries
}

function compile(projectInput: WorkcellProjectV5, config: string): { readonly context: Context; readonly initial: Readonly<Record<string, RobotJointRuntimeValueV5>> } {
  const project = validateWorkcellProjectV5(projectInput)
  const configRevision = revision(config)
  const definitions = new Map(project.robotDefinitions.map((definition) => [definition.id, definition]))
  const definitionByRobotId = new Map(project.robots.map((robot) => [robot.id, definitions.get(robot.definitionId)!]))
  const initial = Object.fromEntries(project.robots.map((robot) => [robot.id, frozenRobot({
    robotId: robot.id, definitionId: robot.definitionId, jointValues: robot.initialJointValues,
    jointSource: robot.jointSource, quality: 'BAD', statusCode: 'BadWaitingForInitialData',
    sourceTimestampMs: 0, publishedTimestampMs: 0, receivedTimestampMs: 0, revision: 0,
  })])) as Record<string, RobotJointRuntimeValueV5>
  for (const robot of project.robots) computeSerialRobotPoseV5(definitionByRobotId.get(robot.id)!, robot.initialJointValues, robot.localBasePose)
  const endpointById = new Map(project.opcUa.endpoints.map((endpoint) => [endpoint.endpointId, endpoint]))
  const channelsByMappingId = new Map<string, JointChannel>()
  const byEndpoint = new Map<string, JointChannel[]>()
  for (const mapping of project.opcUa.mappings) {
    const endpoint = endpointById.get(mapping.endpointId)
    const leaf = mapping.leaves[0]
    if (endpoint === undefined || !endpoint.enabled || (mapping.direction !== 'read' && mapping.direction !== 'readWrite') || mapping.leaves.length !== 1 || leaf?.projectTarget.type !== 'robot-joint') continue
    const target = leaf.projectTarget
    const state = initial[target.robotId]
    const definition = definitionByRobotId.get(target.robotId)
    const joint = definition?.joints.find((candidate) => candidate.id === target.jointId)
    if (state === undefined || definition === undefined || joint === undefined || state.jointSource !== `opcua:${mapping.endpointId}`) continue
    const channel = Object.freeze({ mappingId: mapping.id, endpointId: mapping.endpointId, robotId: target.robotId, jointId: target.jointId, minimum: joint.min, maximum: joint.max })
    if (channelsByMappingId.has(mapping.id)) continue
    channelsByMappingId.set(mapping.id, channel)
    const entries = byEndpoint.get(mapping.endpointId) ?? []
    entries.push(channel); byEndpoint.set(mapping.endpointId, entries)
  }
  return {
    context: {
      project, configRevision, definitionByRobotId, channelsByMappingId,
      channelsByEndpoint: new Map([...byEndpoint].map(([id, entries]) => [id, Object.freeze([...entries])])),
      endpoints: new Set(project.opcUa.endpoints.filter((endpoint) => endpoint.enabled).map((endpoint) => endpoint.endpointId)),
      endpointSequence: new Map(), endpointReceipt: new Map(), sourceFences: new Map(), publishedFences: new Map(),
    },
    initial: frozenRobots(initial),
  }
}

function acceptedValue(
  state: RobotJointRuntimeValueV5,
  channel: JointChannel,
  mapped: StateBatchV1['values'][number],
  batch: StateBatchV1,
  receivedTimestampMs: number,
): RobotJointRuntimeValueV5 {
  const quality: RobotJointRuntimeQualityV5 = mapped.quality
  const finite = typeof mapped.value === 'number' && Number.isFinite(mapped.value)
  const withinLimits = finite && mapped.value >= channel.minimum && mapped.value <= channel.maximum
  const nextQuality = quality === 'GOOD' && !withinLimits ? 'BAD' : quality
  const nextValue = nextQuality === 'GOOD'
    ? { ...state.jointValues, [channel.jointId]: mapped.value as number }
    : state.jointValues
  return frozenRobot({
    ...state, jointValues: nextValue, quality: nextQuality,
    statusCode: nextQuality === 'GOOD'
      ? mapped.statusCode
      : (quality === 'GOOD' ? (finite ? 'BadOutOfRange' : 'BadTypeMismatch') : mapped.statusCode),
    sourceTimestampMs: batch.sourceTimestampMs, publishedTimestampMs: batch.publishedTimestampMs,
    receivedTimestampMs: Math.max(state.receivedTimestampMs, receivedTimestampMs), revision: increment(state.revision),
  })
}

export function createRobotJointRuntimeStoreV5(project: WorkcellProjectV5, configRevision: string): StoreApi<RobotJointRuntimeStoreV5> {
  let prepared = compile(project, configRevision)
  let context = prepared.context
  const guards = new Map<string, Guard>()
  const noOpGuards = new Map<string, { active: boolean; readonly epoch: number }>()
  let guardEpoch = 0

  return createStore<RobotJointRuntimeStoreV5>()((set, get) => {
    const publish = (next: Readonly<Record<string, RobotJointRuntimeValueV5>>): void => set({
      ...get(), projectRevisionId: context.project.revisionId, configRevision: context.configRevision, byRobotId: frozenRobots(next),
    }, true)
    const apply = (batch: StateBatchV1, received: number, prefix: boolean): boolean => {
      if (batch.projectId !== context.project.projectId || batch.configRevision !== context.configRevision || batch.sourceTimestampMs > batch.publishedTimestampMs) return false
      if (!prefix && (batch.sequence <= (context.endpointSequence.get(batch.endpointId) ?? 0) || received < (context.endpointReceipt.get(batch.endpointId) ?? 0))) return false
      const recognized = batch.values.flatMap((mapped) => {
        const channel = context.channelsByMappingId.get(mapped.mappingId)
        if (channel?.endpointId !== batch.endpointId) return []
        return [[channel, mapped] as const]
      })
      const groups = new Map<string, typeof recognized>()
      for (const entry of recognized) {
        const key = entry[1].coherenceGroupId === null ? `mapping:${entry[0].mappingId}` : `coherence:${entry[1].coherenceGroupId}`
        const entries = groups.get(key) ?? []; entries.push(entry); groups.set(key, entries)
      }
      const accepted = prefix ? recognized : [...groups.values()].flatMap((entries) => entries.some(([channel]) => (
        batch.sourceTimestampMs < (context.sourceFences.get(channel.mappingId) ?? 0)
        || batch.publishedTimestampMs < (context.publishedFences.get(channel.mappingId) ?? 0)
      )) ? [] : entries)
      if (accepted.length === 0) return false
      const guard = guards.get(batch.endpointId)
      const robots: Record<string, RobotJointRuntimeValueV5> = { ...(guard?.pending ?? get().byRobotId) }
      for (const [channel, mapped] of accepted) {
        const prior = robots[channel.robotId]
        if (prior !== undefined) robots[channel.robotId] = acceptedValue(prior, channel, mapped, batch, received)
      }
      if (!prefix) {
        context.endpointSequence.set(batch.endpointId, batch.sequence); context.endpointReceipt.set(batch.endpointId, received)
        for (const [channel] of accepted) { context.sourceFences.set(channel.mappingId, batch.sourceTimestampMs); context.publishedFences.set(channel.mappingId, batch.publishedTimestampMs) }
      }
      if (guard !== undefined) guard.pending = robots
      else publish(robots)
      return true
    }
    const requireRobot = (robotId: string): RobotJointRuntimeValueV5 => {
      const robots = get().byRobotId
      const found = Object.hasOwn(robots, robotId) ? robots[robotId] : undefined
      if (found === undefined) failure('ROBOT_INSTANCE_NOT_FOUND', `$.robots.${robotId}`, `Robot Instance ${robotId} does not exist.`)
      return found
    }
    const marked = (target: Readonly<Record<string, RobotJointRuntimeValueV5>>, endpointId: string, at: number, quality: 'STALE' | 'BAD', statusCode: string): Record<string, RobotJointRuntimeValueV5> => {
      const channels = context.channelsByEndpoint.get(endpointId) ?? []
      const next: Record<string, RobotJointRuntimeValueV5> = { ...target }
      for (const robotId of new Set(channels.map((channel) => channel.robotId))) {
        const prior = next[robotId]
        if (prior !== undefined) next[robotId] = frozenRobot({ ...prior, quality, statusCode, receivedTimestampMs: Math.max(prior.receivedTimestampMs, at), revision: increment(prior.revision) })
      }
      return next
    }
    const mark = (endpointId: string, at: number, quality: 'STALE' | 'BAD', statusCode: string): void => {
      const channels = context.channelsByEndpoint.get(endpointId) ?? []
      if (channels.length === 0) return
      const guard = guards.get(endpointId)
      const next = marked(guard?.pending ?? get().byRobotId, endpointId, at, quality, statusCode)
      if (guard !== undefined) guard.pending = next
      else publish(next)
    }

    return {
      projectRevisionId: context.project.revisionId, configRevision: context.configRevision, byRobotId: prepared.initial,
      ingest: (batch, received) => apply(validateStateBatchV1(batch), timestamp(received, 'Receipt timestamp'), false),
      restoreReplayPrefix: (batch, received) => apply(validateStateBatchV1(batch), timestamp(received, 'Replay receipt timestamp'), true),
      beginEndpointCatchup(endpointId, atCandidate) {
        const at = timestamp(atCandidate, 'Catch-up timestamp')
        if (!context.endpoints.has(endpointId)) throw new Error('ENDPOINT_CATCHUP_UNKNOWN_ENDPOINT')
        if (guards.has(endpointId) || noOpGuards.has(endpointId)) throw new Error('ENDPOINT_CATCHUP_ALREADY_ACTIVE')
        const channels = context.channelsByEndpoint.get(endpointId) ?? []
        if (channels.length === 0) {
          const guard = { active: true, epoch: guardEpoch }; noOpGuards.set(endpointId, guard)
          const finish = (): void => { if (!guard.active || guard.epoch !== guardEpoch) return; guard.active = false; if (noOpGuards.get(endpointId) === guard) noOpGuards.delete(endpointId) }
          return Object.freeze({ commit: finish, abort: finish })
        }
        const ownedRobotIds = [...new Set(channels.map((channel) => channel.robotId))]
        const snapshot = Object.freeze(Object.fromEntries(ownedRobotIds.map((robotId) => [robotId, get().byRobotId[robotId]!])) as Record<string, RobotJointRuntimeValueV5>)
        const guard: Guard = {
          snapshot, pending: { ...snapshot }, sequence: context.endpointSequence.get(endpointId), receipt: context.endpointReceipt.get(endpointId), active: true,
          sourceFences: new Map(channels.map((channel) => [channel.mappingId, context.sourceFences.get(channel.mappingId)])),
          publishedFences: new Map(channels.map((channel) => [channel.mappingId, context.publishedFences.get(channel.mappingId)])),
        }
        guards.set(endpointId, guard)
        const epoch = guardEpoch
        const stale: Record<string, RobotJointRuntimeValueV5> = { ...get().byRobotId }
        for (const robotId of ownedRobotIds) {
          const prior = stale[robotId]
          if (prior !== undefined) stale[robotId] = frozenRobot({ ...prior, quality: 'STALE', statusCode: 'BadNoCommunication', receivedTimestampMs: Math.max(prior.receivedTimestampMs, at), revision: increment(prior.revision) })
        }
        publish(stale)
        const finish = (commit: boolean): void => {
          if (!guard.active || epoch !== guardEpoch) return
          guard.active = false; guards.delete(endpointId)
          if (commit) { publish({ ...get().byRobotId, ...guard.pending }); return }
          if (guard.sequence === undefined) context.endpointSequence.delete(endpointId); else context.endpointSequence.set(endpointId, guard.sequence)
          if (guard.receipt === undefined) context.endpointReceipt.delete(endpointId); else context.endpointReceipt.set(endpointId, guard.receipt)
          for (const [id, value] of guard.sourceFences) { if (value === undefined) context.sourceFences.delete(id); else context.sourceFences.set(id, value) }
          for (const [id, value] of guard.publishedFences) { if (value === undefined) context.publishedFences.delete(id); else context.publishedFences.set(id, value) }
          const stale: Record<string, RobotJointRuntimeValueV5> = { ...get().byRobotId }
          for (const robotId of ownedRobotIds) {
            const prior = stale[robotId]; if (prior !== undefined) stale[robotId] = frozenRobot({ ...prior, quality: 'STALE', statusCode: 'BadNoCommunication', receivedTimestampMs: Math.max(prior.receivedTimestampMs, at), revision: increment(prior.revision) })
          }
          publish(stale)
        }
        return Object.freeze({ commit: () => finish(true), abort: () => finish(false) })
      },
      markEndpointDisconnected: (endpointId, at) => mark(endpointId, timestamp(at, 'Disconnect timestamp'), 'STALE', 'BadNoCommunication'),
      resetEndpointSession: (endpointId, atCandidate) => {
        const at = timestamp(atCandidate, 'Endpoint reset timestamp')
        context.endpointSequence.delete(endpointId); context.endpointReceipt.delete(endpointId)
        for (const channel of context.channelsByEndpoint.get(endpointId) ?? []) { context.sourceFences.delete(channel.mappingId); context.publishedFences.delete(channel.mappingId) }
        mark(endpointId, at, 'BAD', 'BadWaitingForInitialData')
      },
      resetGatewaySession: (atCandidate) => {
        const at = timestamp(atCandidate, 'Reset timestamp')
        for (const guard of guards.values()) guard.active = false
        for (const guard of noOpGuards.values()) guard.active = false
        guards.clear(); noOpGuards.clear(); guardEpoch += 1
        context.endpointSequence.clear(); context.endpointReceipt.clear(); context.sourceFences.clear(); context.publishedFences.clear()
        let next: Readonly<Record<string, RobotJointRuntimeValueV5>> = get().byRobotId
        for (const endpointId of context.channelsByEndpoint.keys()) next = marked(next, endpointId, at, 'BAD', 'BadWaitingForInitialData')
        publish(next)
      },
      replaceProject: (nextProject, nextConfig) => {
        const nextPrepared = compile(nextProject, nextConfig)
        for (const guard of guards.values()) guard.active = false
        for (const guard of noOpGuards.values()) guard.active = false
        prepared = nextPrepared; context = prepared.context; guards.clear(); noOpGuards.clear(); guardEpoch += 1; publish(prepared.initial)
      },
      readRobot: (robotId) => {
        const robots = get().byRobotId
        return Object.hasOwn(robots, robotId) ? robots[robotId]! : null
      },
      readRobotPose: (robotId, worldBasePose) => {
        const state = requireRobot(robotId); const definition = context.definitionByRobotId.get(robotId)
        if (definition === undefined) failure('ROBOT_INSTANCE_NOT_FOUND', `$.robots.${robotId}`, `Robot Instance ${robotId} has no Definition.`)
        const authored = context.project.robots.find((robot) => robot.id === robotId)!
        return computeSerialRobotPoseV5(definition, state.jointValues, worldBasePose ?? authored.localBasePose)
      },
      writeJointValues: (robotId, values, writer) => {
        const state = requireRobot(robotId)
        if (state.jointSource !== writer) failure('ROBOT_JOINT_OWNERSHIP_CONFLICT', `$.robots.${robotId}.jointSource`, `Writer ${writer} does not own Robot ${robotId} Joint state.`)
        const definition = context.definitionByRobotId.get(robotId)!
        const path = `$.robots.${robotId}.jointValues`
        const update = inspectPartialJointRecord(values, path)
        const joints = new Map(definition.joints.map((joint) => [joint.id, joint]))
        for (const [id, value] of update) {
          const joint = joints.get(id); if (joint === undefined) failure('ROBOT_JOINT_NOT_FOUND', `$.robots.${robotId}.jointValues.${id}`, `Joint ${id} does not exist.`)
          if (!Number.isFinite(value)) failure('ROBOT_JOINT_VALUE_NOT_FINITE', `$.robots.${robotId}.jointValues.${id}`, 'Joint command must be finite.')
          if (value < joint.min || value > joint.max) failure('ROBOT_JOINT_VALUE_OUT_OF_RANGE', `$.robots.${robotId}.jointValues.${id}`, `Joint command must be within ${joint.min}..${joint.max}.`)
        }
        const merged = Object.fromEntries([...Object.entries(state.jointValues), ...update]); computeSerialRobotPoseV5(definition, merged)
        publish({ ...get().byRobotId, [robotId]: frozenRobot({ ...state, jointValues: merged, quality: 'GOOD', statusCode: 'Good', revision: increment(state.revision) }) })
      },
    }
  })
}
