import {
  normalizeRigidTransformV4,
  type RigidTransformV4,
} from '../../core/project-v4/rigid-transform'
import type { RobotDefinitionV4 } from '../../core/project-v4/types'
import {
  canonicalCollisionPairKeyV4,
  type CollisionEntityIdV4,
  type CollisionPairKeyV4,
} from '../../core/robot-runtime/collision-identity'
import { computeSerialRobotPoseV4 } from '../../core/robot-runtime/serial-kinematics'
import {
  validateCollisionBox,
  validateCollisionFinding,
  validateCollisionPolicy,
  validateCollisionPolicyV4,
  validateGeometryCollisionEntity,
  validateGeometryCollisionEntityV4,
  type CollisionBox,
  type CollisionFinding,
  type CollisionFindingV4,
  type CollisionPolicy,
  type CollisionPolicyV4,
  type GeometryCollisionEntity,
} from '../../domain/collision/collision'
import type { SerializableTransform } from '../../domain/equipment/equipment'
import type { RobotLinkId } from '../../domain/robot/crb15000'
import type { RobotKinematicDefinition } from '../../domain/robot/kinematics'
import type { RobotKeyframe } from '../joints/keyframes'
import type { MountContactState } from '../../domain/collision/query-collision'
import {
  MAX_COLLISION_VALIDATION_SAMPLES,
  type CollisionValidationMode,
} from './validate-pose-sequence'
import {
  robotLinkCollisionProxiesV4,
  type CollisionGeometryProxyV4,
} from './scene-entity-adapter'

export const MAX_COLLISION_VALIDATION_FINDINGS = 10_000

const LINK_IDS = Object.freeze([
  'LINK00',
  'LINK01',
  'LINK02',
  'LINK03',
  'LINK04',
  'LINK05',
  'LINK06',
] as const satisfies readonly RobotLinkId[])

export interface CollisionValidationLinkEntity {
  readonly linkId: RobotLinkId
  readonly id: `robot-link:${RobotLinkId}`
  readonly name: string
  readonly collisionActive: boolean
  readonly boxes: readonly CollisionBox[]
}

export interface CollisionValidationToolEntity {
  readonly id: `tool:${string}`
  readonly name: string
  readonly boxes: readonly CollisionBox[]
}

export interface CollisionValidationHeldObject {
  readonly id: `object:${string}` | `equipment:${string}`
  readonly name: string
  readonly boxes: readonly CollisionBox[]
  readonly tcpLocalTransform: SerializableTransform
}

export interface CollisionValidationRobot {
  readonly definition: RobotKinematicDefinition
  readonly rootPose: SerializableTransform
  readonly geometryTransforms: Readonly<Record<RobotLinkId, SerializableTransform>>
  readonly toolFrames: {
    readonly flange: SerializableTransform
    readonly tool: SerializableTransform
    readonly tcp: SerializableTransform
  }
  readonly linkEntities: readonly CollisionValidationLinkEntity[]
  readonly toolEntity: CollisionValidationToolEntity | null
}

export interface CollisionValidationRequest {
  readonly requestId: string
  readonly revision: string
  readonly mode: CollisionValidationMode
  readonly sequence: readonly RobotKeyframe[]
  readonly robot: CollisionValidationRobot
  readonly heldObject: CollisionValidationHeldObject | null
  readonly staticEntities: readonly GeometryCollisionEntity[]
  readonly mountContactPairKey: string | null
  readonly policy: CollisionPolicy
}

export interface CollisionPolicyWireV4 {
  readonly enabled: boolean
  readonly nearMissMarginM: number
  readonly excludedPairKeys: readonly CollisionPairKeyV4[]
  readonly intentionalMountPairKeys: readonly CollisionPairKeyV4[]
  readonly ignoredContactPairKeys: readonly CollisionPairKeyV4[]
}

export interface CollisionRobotJointStateV4 {
  readonly robotId: string
  readonly definitionId: string
  readonly jointValues: Readonly<Record<string, number>>
}

export interface CollisionRobotPlacementV4 {
  readonly robotId: string
  readonly worldBasePose: RigidTransformV4
  readonly effectiveVisible: boolean
}

export interface CollisionValidationSampleV4 {
  readonly sampleIndex: number
  readonly timeMs: number
  readonly robots: readonly CollisionRobotJointStateV4[]
}

export interface CollisionValidationRequestV4 {
  readonly requestId: string
  readonly revision: string
  readonly mode: CollisionValidationMode
  readonly definitions: readonly RobotDefinitionV4[]
  readonly robotPlacements: readonly CollisionRobotPlacementV4[]
  readonly sequence: readonly CollisionValidationSampleV4[]
  readonly staticProxies: readonly CollisionGeometryProxyV4[]
  readonly policy: CollisionPolicyWireV4
}

export interface CollisionValidationResultV4 {
  readonly requestId: string
  readonly revision: string
  readonly mode: CollisionValidationMode
  readonly sampleCount: number
  readonly durationMs: number
  readonly findings: readonly CollisionFindingV4[]
  readonly truncated: boolean
}

export interface CollisionValidationProgress {
  readonly requestId: string
  readonly revision: string
  readonly processedSamples: number
  readonly totalSamples: number
}

export interface CollisionValidationResult {
  readonly requestId: string
  readonly revision: string
  readonly mode: CollisionValidationMode
  readonly sampleCount: number
  readonly durationMs: number
  readonly findings: readonly CollisionFinding[]
  readonly mountContact: MountContactState | null
  readonly truncated: boolean
}

export type CollisionValidationWorkerCommand =
  | { readonly type: 'validate'; readonly request: CollisionValidationRequest }
  | { readonly type: 'cancel'; readonly requestId: string }

export type CollisionValidationWorkerEvent =
  | { readonly type: 'progress'; readonly progress: CollisionValidationProgress }
  | { readonly type: 'result'; readonly result: CollisionValidationResult }
  | {
      readonly type: 'cancelled'
      readonly requestId: string
      readonly revision: string
    }
  | {
      readonly type: 'error'
      readonly requestId: string
      readonly revision: string
      readonly message: string
    }

function record(candidate: unknown, label: string): Record<string, unknown> {
  if (typeof candidate !== 'object' || candidate === null || Array.isArray(candidate)) {
    throw new Error(`${label} must be an object.`)
  }
  return candidate as Record<string, unknown>
}

function nonEmptyString(candidate: unknown, label: string): string {
  if (typeof candidate !== 'string' || candidate.trim().length === 0) {
    throw new Error(`${label} must not be empty.`)
  }
  return candidate
}

function mountContactPairKey(
  candidate: unknown,
  linkEntities: readonly CollisionValidationLinkEntity[],
  staticEntities: readonly GeometryCollisionEntity[],
): string | null {
  if (candidate === null) return null
  const value = nonEmptyString(candidate, 'Collision validation mount contact pair')
  const ids = value.split('|')
  if (ids.length !== 2 || ids[0]! >= ids[1]!) {
    throw new Error('Collision validation mount contact pair must be canonical.')
  }
  const activeLinks = new Set(
    linkEntities.filter(({ collisionActive }) => collisionActive).map(({ id }) => id),
  )
  const staticIds = new Set(staticEntities.map(({ id }) => id))
  const hasActiveLink = ids.some((id) => activeLinks.has(id as `robot-link:${RobotLinkId}`))
  const hasStaticSurface = ids.some((id) => staticIds.has(id))
  if (!hasActiveLink || !hasStaticSurface) {
    throw new Error(
      'Collision validation mount contact pair must reference an active Robot Link and surface.',
    )
  }
  return value
}

function mountContactState(candidate: unknown): MountContactState | null {
  if (candidate === null) return null
  const value = record(candidate, 'Collision validation mount contact')
  const pair = nonEmptyString(value.pairKey, 'Collision validation mount contact pair')
  if (pair.split('|').length !== 2) {
    throw new Error('Collision validation mount contact pair is invalid.')
  }
  if (value.state !== 'clear' && value.state !== 'near' && value.state !== 'contact') {
    throw new Error('Collision validation mount contact state is invalid.')
  }
  return Object.freeze({ pairKey: pair, state: value.state })
}

function finiteNumber(candidate: unknown, label: string): number {
  if (typeof candidate !== 'number' || !Number.isFinite(candidate)) {
    throw new Error(`${label} must be finite.`)
  }
  return candidate
}

function nonNegativeInteger(candidate: unknown, label: string): number {
  const value = finiteNumber(candidate, label)
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative integer.`)
  }
  return value
}

function v4RigidTransform(
  candidate: unknown,
  label: string,
): RigidTransformV4 {
  const value = record(candidate, label)
  const positionM = tuple(value.positionM, 3, `${label} position`) as [number, number, number]
  const quaternion = tuple(value.quaternion, 4, `${label} quaternion`) as [number, number, number, number]
  return Object.freeze(normalizeRigidTransformV4({ positionM, quaternion }, label))
}

function compareStrings(first: string, second: string): number {
  return first < second ? -1 : first > second ? 1 : 0
}

function canonicalPairKeyArrayV4(
  candidate: unknown,
  label: string,
): readonly CollisionPairKeyV4[] {
  if (!Array.isArray(candidate)) {
    throw new Error(`${label} must be an array.`)
  }
  const result: CollisionPairKeyV4[] = []
  for (const [index, entry] of candidate.entries()) {
    const value = nonEmptyString(entry, `${label}[${index}]`)
    const segments = value.split('|')
    if (segments.length !== 2) {
      throw new Error(`${label} must contain canonical collision pair keys.`)
    }
    const canonical = canonicalCollisionPairKeyV4(
      segments[0] as CollisionEntityIdV4,
      segments[1] as CollisionEntityIdV4,
    )
    if (canonical !== value) {
      throw new Error(`${label} must contain canonical collision pair keys.`)
    }
    if (result.length > 0 && compareStrings(result.at(-1)!, canonical) >= 0) {
      throw new Error(`${label} must be sorted and duplicate-free.`)
    }
    result.push(canonical)
  }
  return Object.freeze(result)
}

export function collisionPolicyToWireV4(
  policyCandidate: CollisionPolicyV4,
): CollisionPolicyWireV4 {
  const policy = validateCollisionPolicyV4(policyCandidate)
  const sorted = (values: ReadonlySet<CollisionPairKeyV4>) =>
    Object.freeze([...values].sort(compareStrings))
  return Object.freeze({
    enabled: policy.enabled,
    nearMissMarginM: policy.nearMissMarginM,
    excludedPairKeys: sorted(policy.excludedPairKeys),
    intentionalMountPairKeys: sorted(policy.intentionalMountPairKeys),
    ignoredContactPairKeys: sorted(policy.ignoredContactPairKeys),
  })
}

export function collisionPolicyFromWireV4(
  candidate: unknown,
): CollisionPolicyV4 {
  const value = record(candidate, 'Collision policy wire V4')
  return validateCollisionPolicyV4({
    enabled: value.enabled as boolean,
    nearMissMarginM: value.nearMissMarginM as number,
    excludedPairKeys: new Set(canonicalPairKeyArrayV4(
      value.excludedPairKeys,
      'Excluded collision pair keys',
    )),
    intentionalMountPairKeys: new Set(canonicalPairKeyArrayV4(
      value.intentionalMountPairKeys,
      'Intentional mount collision pair keys',
    )),
    ignoredContactPairKeys: new Set(canonicalPairKeyArrayV4(
      value.ignoredContactPairKeys,
      'Ignored contact collision pair keys',
    )),
  })
}

function ownedDefinitionV4(
  candidate: unknown,
  index: number,
): RobotDefinitionV4 {
  const value = record(candidate, `Collision validation Definition ${index + 1}`)
  const id = nonEmptyString(value.id, `Collision validation Definition ${index + 1} id`)
  let cloned: RobotDefinitionV4
  try {
    cloned = structuredClone(candidate) as RobotDefinitionV4
  } catch {
    throw new Error(`Collision validation Definition ${id} must be serializable.`)
  }
  if (!Array.isArray(cloned.links) || !Array.isArray(cloned.joints) || !Array.isArray(cloned.frames)) {
    throw new Error(`Collision validation Definition ${id} collections must be arrays.`)
  }
  const homeValues = Object.fromEntries(
    cloned.joints.map((joint) => [joint.id, joint.home]),
  )
  const pose = computeSerialRobotPoseV4(cloned, homeValues)
  robotLinkCollisionProxiesV4({
    robotId: `definition-probe-${index}`,
    definition: cloned,
    linkWorldPoses: pose.linkWorldPoses,
    effectiveVisible: true,
  })
  return Object.freeze(cloned)
}

function ownedRobotPlacementV4(
  candidate: unknown,
  index: number,
): CollisionRobotPlacementV4 {
  const value = record(candidate, `Collision validation Robot placement ${index + 1}`)
  if (typeof value.effectiveVisible !== 'boolean') {
    throw new Error('Collision validation Robot placement visibility must be boolean.')
  }
  return Object.freeze({
    robotId: nonEmptyString(value.robotId, `Collision validation Robot placement ${index + 1} id`),
    worldBasePose: v4RigidTransform(
      value.worldBasePose,
      `Collision validation Robot placement ${index + 1} World Base pose`,
    ),
    effectiveVisible: value.effectiveVisible,
  })
}

function ownedJointValuesV4(
  candidate: unknown,
  definition: RobotDefinitionV4,
  label: string,
): Readonly<Record<string, number>> {
  const value = record(candidate, label)
  const keys = Object.keys(value)
  const expected = new Set(definition.joints.map(({ id }) => id))
  if (keys.length !== expected.size || keys.some((key) => !expected.has(key))) {
    throw new Error(`${label} must contain the exact literal Definition Joint key set.`)
  }
  const entries = definition.joints.map((joint) => {
    if (!Object.hasOwn(value, joint.id)) {
      throw new Error(`${label} is missing Joint ${joint.id}.`)
    }
    const jointValue = finiteNumber(value[joint.id], `${label} Joint ${joint.id}`)
    if (jointValue < joint.min || jointValue > joint.max) {
      throw new Error(`${label} Joint ${joint.id} exceeds its limits.`)
    }
    return [joint.id, jointValue] as const
  })
  return Object.freeze(Object.fromEntries(entries))
}

function sameStringSet(first: ReadonlySet<string>, second: ReadonlySet<string>): boolean {
  return first.size === second.size && [...first].every((value) => second.has(value))
}

export function validateCollisionValidationRequestV4(
  candidate: unknown,
): CollisionValidationRequestV4 {
  const value = record(candidate, 'Collision validation request V4')
  if (value.mode !== 'preview' && value.mode !== 'validate') {
    throw new Error('Collision validation V4 mode must be preview or validate.')
  }
  if (!Array.isArray(value.definitions)) {
    throw new Error('Collision validation V4 Definitions must be an array.')
  }
  if (!Array.isArray(value.robotPlacements)) {
    throw new Error('Collision validation V4 Robot placements must be an array.')
  }
  if (!Array.isArray(value.sequence)) {
    throw new Error('Collision validation V4 sequence must be an array.')
  }
  if (!Array.isArray(value.staticProxies)) {
    throw new Error('Collision validation V4 static proxies must be an array.')
  }
  if (value.sequence.length > MAX_COLLISION_VALIDATION_SAMPLES) {
    throw new Error('Collision validation V4 sequence exceeds the sample cap.')
  }

  const definitions = Object.freeze(value.definitions.map(ownedDefinitionV4))
  const definitionsById = new Map<string, RobotDefinitionV4>()
  for (const definition of definitions) {
    if (definitionsById.has(definition.id)) {
      throw new Error(`Duplicate collision validation Definition id: ${definition.id}`)
    }
    definitionsById.set(definition.id, definition)
  }

  const robotPlacements = Object.freeze(value.robotPlacements.map(ownedRobotPlacementV4))
  const placementIds = new Set<string>()
  for (const placement of robotPlacements) {
    if (placementIds.has(placement.robotId)) {
      throw new Error(`Duplicate collision validation Robot placement: ${placement.robotId}`)
    }
    placementIds.add(placement.robotId)
  }

  const definitionByRobotId = new Map<string, string>()
  let previousTimeMs = Number.NEGATIVE_INFINITY
  const sequence = Object.freeze(value.sequence.map((sampleCandidate, sampleIndex) => {
    const sample = record(sampleCandidate, `Collision validation sample ${sampleIndex}`)
    if (nonNegativeInteger(sample.sampleIndex, 'Collision validation sample index') !== sampleIndex) {
      throw new Error('Collision validation sample indices must start at zero and be contiguous.')
    }
    const timeMs = finiteNumber(sample.timeMs, 'Collision validation sample time')
    if (timeMs < 0 || timeMs < previousTimeMs) {
      throw new Error('Collision validation sample time must be finite, non-negative, and nondecreasing.')
    }
    previousTimeMs = timeMs
    if (!Array.isArray(sample.robots)) {
      throw new Error('Collision validation sample Robots must be an array.')
    }
    const sampleRobotIds = new Set<string>()
    const robots = Object.freeze(sample.robots.map((stateCandidate, robotIndex) => {
      const state = record(
        stateCandidate,
        `Collision validation sample ${sampleIndex} Robot ${robotIndex + 1}`,
      )
      const robotId = nonEmptyString(state.robotId, 'Collision validation sample Robot id')
      if (sampleRobotIds.has(robotId)) {
        throw new Error(`Duplicate collision validation sample Robot id: ${robotId}`)
      }
      sampleRobotIds.add(robotId)
      const definitionId = nonEmptyString(
        state.definitionId,
        `Collision validation sample Robot ${robotId} Definition id`,
      )
      const definition = definitionsById.get(definitionId)
      if (definition === undefined) {
        throw new Error(`Collision validation Robot ${robotId} references missing Definition ${definitionId}.`)
      }
      const previousDefinitionId = definitionByRobotId.get(robotId)
      if (previousDefinitionId !== undefined && previousDefinitionId !== definitionId) {
        throw new Error(`Collision validation Robot ${robotId} changed Definition ids.`)
      }
      definitionByRobotId.set(robotId, definitionId)
      return Object.freeze({
        robotId,
        definitionId,
        jointValues: ownedJointValuesV4(
          state.jointValues,
          definition,
          `Collision validation sample ${sampleIndex} Robot ${robotId}`,
        ),
      })
    }))
    if (!sameStringSet(sampleRobotIds, placementIds)) {
      throw new Error('Collision validation sample Robot set must match Robot placements.')
    }
    return Object.freeze({ sampleIndex, timeMs, robots })
  }))

  const staticIds = new Set<string>()
  const staticProxies = Object.freeze(value.staticProxies.map((proxyCandidate, index) => {
    const proxy = record(proxyCandidate, `Collision validation static proxy ${index + 1}`)
    if (typeof proxy.effectiveVisible !== 'boolean') {
      throw new Error('Collision validation static proxy visibility must be boolean.')
    }
    const entity = validateGeometryCollisionEntityV4(
      proxy.entity as CollisionGeometryProxyV4['entity'],
    )
    if (staticIds.has(entity.id)) {
      throw new Error(`Duplicate collision validation static Collision Entity id: ${entity.id}`)
    }
    staticIds.add(entity.id)
    return Object.freeze({ entity, effectiveVisible: proxy.effectiveVisible })
  }))

  return Object.freeze({
    requestId: nonEmptyString(value.requestId, 'Collision validation V4 request id'),
    revision: nonEmptyString(value.revision, 'Collision validation V4 revision'),
    mode: value.mode,
    definitions,
    robotPlacements,
    sequence,
    staticProxies,
    policy: collisionPolicyToWireV4(collisionPolicyFromWireV4(value.policy)),
  })
}

function tuple<const Length extends number>(
  candidate: unknown,
  length: Length,
  label: string,
  positive = false,
): number[] {
  if (!Array.isArray(candidate) || candidate.length !== length) {
    throw new Error(`${label} must contain ${length} numbers.`)
  }
  const values = candidate.map((value, index) => finiteNumber(value, `${label}[${index}]`))
  if (positive && values.some((value) => value <= 0)) {
    throw new Error(`${label} values must be positive.`)
  }
  return values
}

function transform(candidate: unknown, label: string): SerializableTransform {
  const value = record(candidate, label)
  const position = tuple(value.position, 3, `${label} position`) as [number, number, number]
  const quaternion = tuple(value.quaternion, 4, `${label} quaternion`) as [number, number, number, number]
  if (Math.hypot(...quaternion) <= 1e-12) {
    throw new Error(`${label} quaternion must be non-zero.`)
  }
  const quaternionLength = Math.hypot(...quaternion)
  const normalizedQuaternion = quaternion.map(
    (component) => component / quaternionLength,
  ) as [number, number, number, number]
  const scale = tuple(value.scale, 3, `${label} scale`, true) as [number, number, number]
  return Object.freeze({
    position: Object.freeze(position) as unknown as [number, number, number],
    quaternion: Object.freeze(normalizedQuaternion) as unknown as [number, number, number, number],
    scale: Object.freeze(scale) as unknown as [number, number, number],
  })
}

function linkId(candidate: unknown, label: string): RobotLinkId {
  if (typeof candidate !== 'string' || !LINK_IDS.includes(candidate as RobotLinkId)) {
    throw new Error(`${label} must be a supported Robot Link id.`)
  }
  return candidate as RobotLinkId
}

function definition(candidate: unknown): RobotKinematicDefinition {
  const value = record(candidate, 'Collision validation Robot definition')
  const jointsRaw = value.joints
  if (!Array.isArray(jointsRaw) || jointsRaw.length !== 6) {
    throw new Error('Collision validation Robot definition must contain six Joints.')
  }
  const joints = jointsRaw.map((jointCandidate, index) => {
    const joint = record(jointCandidate, `Collision validation Joint ${index + 1}`)
    const axis = tuple(joint.axis, 3, `Collision validation Joint ${index + 1} axis`) as [number, number, number]
    if (Math.hypot(...axis) <= 1e-12) {
      throw new Error(`Collision validation Joint ${index + 1} axis must be non-zero.`)
    }
    const minDeg = finiteNumber(joint.minDeg, `Collision validation Joint ${index + 1} minimum`)
    const maxDeg = finiteNumber(joint.maxDeg, `Collision validation Joint ${index + 1} maximum`)
    if (minDeg >= maxDeg) {
      throw new Error(`Collision validation Joint ${index + 1} limits are invalid.`)
    }
    return Object.freeze({
      id: nonEmptyString(joint.id, `Collision validation Joint ${index + 1} id`) as RobotKinematicDefinition['joints'][number]['id'],
      parentLink: linkId(joint.parentLink, `Collision validation Joint ${index + 1} parent`),
      childLink: linkId(joint.childLink, `Collision validation Joint ${index + 1} child`),
      origin: Object.freeze(tuple(joint.origin, 3, `Collision validation Joint ${index + 1} origin`)) as unknown as [number, number, number],
      axis: Object.freeze(axis) as unknown as [number, number, number],
      minDeg,
      maxDeg,
    })
  })
  return Object.freeze({
    id: nonEmptyString(value.id, 'Collision validation Robot definition id'),
    baseLink: linkId(value.baseLink, 'Collision validation Robot base Link'),
    joints: Object.freeze(joints),
    toolRotationYRad: finiteNumber(
      value.toolRotationYRad,
      'Collision validation Robot tool rotation',
    ),
  })
}

function poses(candidate: unknown): readonly RobotKeyframe[] {
  if (!Array.isArray(candidate)) {
    throw new Error('Collision validation sequence must be an array.')
  }
  const ids = new Set<string>()
  return Object.freeze(candidate.map((poseCandidate, index) => {
    const pose = record(poseCandidate, `Collision validation Pose ${index + 1}`)
    const id = nonEmptyString(pose.id, `Collision validation Pose ${index + 1} id`)
    if (ids.has(id)) throw new Error(`Duplicate collision validation Pose id: ${id}`)
    ids.add(id)
    const durationMs = finiteNumber(
      pose.durationMs,
      `Collision validation Pose ${index + 1} duration`,
    )
    if (durationMs <= 0) {
      throw new Error('Collision validation Pose duration must be positive.')
    }
    if (pose.easing !== 'linear' && pose.easing !== 'easeInOut') {
      throw new Error('Collision validation Pose easing is unsupported.')
    }
    const speedPercentToNext = pose.speedPercentToNext === undefined
      ? undefined
      : finiteNumber(
          pose.speedPercentToNext,
          `Collision validation Pose ${index + 1} speed`,
        )
    return Object.freeze({
      id,
      name: nonEmptyString(pose.name, `Collision validation Pose ${index + 1} name`),
      anglesDeg: Object.freeze(tuple(
        pose.anglesDeg,
        6,
        `Collision validation Pose ${index + 1} angles`,
      )) as unknown as RobotKeyframe['anglesDeg'],
      durationMs,
      easing: pose.easing,
      ...(speedPercentToNext === undefined ? {} : { speedPercentToNext }),
    })
  }))
}

function boxes(candidate: unknown, label: string): readonly CollisionBox[] {
  if (!Array.isArray(candidate) || candidate.length === 0) {
    throw new Error(`${label} must contain at least one Collision Box.`)
  }
  return Object.freeze(candidate.map((box) => validateCollisionBox(box as CollisionBox)))
}

function linkEntities(candidate: unknown): readonly CollisionValidationLinkEntity[] {
  if (!Array.isArray(candidate) || candidate.length !== LINK_IDS.length) {
    throw new Error('Collision validation requires exactly seven Robot Link entities.')
  }
  const seen = new Set<RobotLinkId>()
  const entities = candidate.map((entityCandidate, index) => {
    const entity = record(entityCandidate, `Collision validation Robot Link ${index + 1}`)
    const id = linkId(entity.linkId, `Collision validation Robot Link ${index + 1}`)
    if (seen.has(id)) throw new Error(`Duplicate collision validation Robot Link: ${id}`)
    seen.add(id)
    if (entity.id !== `robot-link:${id}`) {
      throw new Error(`Collision validation Robot Link ${id} has an invalid Entity id.`)
    }
    if (typeof entity.collisionActive !== 'boolean') {
      throw new Error(
        `Collision validation Robot Link ${id} collision participation must be boolean.`,
      )
    }
    return Object.freeze({
      linkId: id,
      id: entity.id as `robot-link:${RobotLinkId}`,
      name: nonEmptyString(entity.name, `Collision validation Robot Link ${id} name`),
      collisionActive: entity.collisionActive,
      boxes: boxes(entity.boxes, `Collision validation Robot Link ${id}`),
    })
  })
  if (LINK_IDS.some((id) => !seen.has(id))) {
    throw new Error('Collision validation requires all seven Robot Link entities.')
  }
  return Object.freeze(entities)
}

function toolEntity(candidate: unknown): CollisionValidationToolEntity | null {
  if (candidate === null) return null
  const entity = record(candidate, 'Collision validation Tool')
  const id = nonEmptyString(entity.id, 'Collision validation Tool id')
  if (!id.startsWith('tool:') || id === 'tool:') {
    throw new Error('Collision validation Tool id must use the tool namespace.')
  }
  return Object.freeze({
    id: id as `tool:${string}`,
    name: nonEmptyString(entity.name, 'Collision validation Tool name'),
    boxes: boxes(entity.boxes, 'Collision validation Tool'),
  })
}

function heldObject(candidate: unknown): CollisionValidationHeldObject | null {
  if (candidate === null) return null
  const entity = record(candidate, 'Collision validation held Object')
  const id = nonEmptyString(entity.id, 'Collision validation held Object id')
  if (
    (!id.startsWith('object:') && !id.startsWith('equipment:')) ||
    id.endsWith(':')
  ) {
    throw new Error('Collision validation held Object id has an invalid namespace.')
  }
  return Object.freeze({
    id: id as CollisionValidationHeldObject['id'],
    name: nonEmptyString(entity.name, 'Collision validation held Object name'),
    boxes: boxes(entity.boxes, 'Collision validation held Object'),
    tcpLocalTransform: transform(
      entity.tcpLocalTransform,
      'Collision validation held Object TCP-local transform',
    ),
  })
}

export function validateCollisionValidationRequest(
  candidate: unknown,
): CollisionValidationRequest {
  const value = record(candidate, 'Collision validation request')
  if (value.mode !== 'preview' && value.mode !== 'validate') {
    throw new Error('Collision validation mode must be preview or validate.')
  }
  const robotCandidate = record(value.robot, 'Collision validation Robot')
  const geometryCandidate = record(
    robotCandidate.geometryTransforms,
    'Collision validation Robot geometry transforms',
  )
  const geometryTransforms = {} as Record<RobotLinkId, SerializableTransform>
  for (const id of LINK_IDS) {
    geometryTransforms[id] = transform(
      geometryCandidate[id],
      `Collision validation ${id} geometry transform`,
    )
  }
  const toolFramesCandidate = record(
    robotCandidate.toolFrames,
    'Collision validation Tool frames',
  )
  const staticCandidates = value.staticEntities
  if (!Array.isArray(staticCandidates)) {
    throw new Error('Collision validation static Entities must be an array.')
  }

  const validatedLinkEntities = linkEntities(robotCandidate.linkEntities)
  const validatedStaticEntities = Object.freeze(
    staticCandidates.map((entity) =>
      validateGeometryCollisionEntity(entity as GeometryCollisionEntity),
    ),
  )
  return Object.freeze({
    requestId: nonEmptyString(value.requestId, 'Collision validation request id'),
    revision: nonEmptyString(value.revision, 'Collision validation revision'),
    mode: value.mode,
    sequence: poses(value.sequence),
    robot: Object.freeze({
      definition: definition(robotCandidate.definition),
      rootPose: transform(robotCandidate.rootPose, 'Collision validation Robot root pose'),
      geometryTransforms: Object.freeze(geometryTransforms),
      toolFrames: Object.freeze({
        flange: transform(toolFramesCandidate.flange, 'Collision validation flange frame'),
        tool: transform(toolFramesCandidate.tool, 'Collision validation Tool frame'),
        tcp: transform(toolFramesCandidate.tcp, 'Collision validation TCP frame'),
      }),
      linkEntities: validatedLinkEntities,
      toolEntity: toolEntity(robotCandidate.toolEntity),
    }),
    heldObject: heldObject(value.heldObject),
    staticEntities: validatedStaticEntities,
    mountContactPairKey: mountContactPairKey(
      value.mountContactPairKey,
      validatedLinkEntities,
      validatedStaticEntities,
    ),
    policy: validateCollisionPolicy(value.policy as CollisionPolicy),
  })
}

export function validateCollisionValidationProgress(
  candidate: unknown,
): CollisionValidationProgress {
  const value = record(candidate, 'Collision validation progress')
  const processedSamples = nonNegativeInteger(
    value.processedSamples,
    'Collision validation processed samples',
  )
  const totalSamples = nonNegativeInteger(
    value.totalSamples,
    'Collision validation total samples',
  )
  if (totalSamples > MAX_COLLISION_VALIDATION_SAMPLES) {
    throw new Error('Collision validation total samples exceed the sample cap.')
  }
  if (processedSamples > totalSamples) {
    throw new Error('Collision validation processed samples exceed total samples.')
  }
  return Object.freeze({
    requestId: nonEmptyString(value.requestId, 'Collision validation request id'),
    revision: nonEmptyString(value.revision, 'Collision validation revision'),
    processedSamples,
    totalSamples,
  })
}

export function validateCollisionValidationResult(
  candidate: unknown,
): CollisionValidationResult {
  const value = record(candidate, 'Collision validation result')
  if (value.mode !== 'preview' && value.mode !== 'validate') {
    throw new Error('Collision validation result mode must be preview or validate.')
  }
  const sampleCount = nonNegativeInteger(
    value.sampleCount,
    'Collision validation result sample count',
  )
  if (sampleCount > MAX_COLLISION_VALIDATION_SAMPLES) {
    throw new Error('Collision validation result exceeds the sample cap.')
  }
  const durationMs = finiteNumber(
    value.durationMs,
    'Collision validation result duration',
  )
  if (durationMs < 0) {
    throw new Error('Collision validation result duration must be non-negative.')
  }
  if (!Array.isArray(value.findings)) {
    throw new Error('Collision validation result findings must be an array.')
  }
  const findingsTruncated = value.findings.length > MAX_COLLISION_VALIDATION_FINDINGS
  const validatedFindings = value.findings
    .slice(0, MAX_COLLISION_VALIDATION_FINDINGS)
    .map((findingCandidate) => {
      const finding = validateCollisionFinding(findingCandidate as CollisionFinding)
      if (finding.sampleIndex !== null && finding.sampleIndex >= sampleCount) {
        throw new Error('Collision validation finding sample index exceeds the result.')
      }
      if (finding.timeMs !== null && finding.timeMs > durationMs) {
        throw new Error('Collision validation finding time exceeds the result duration.')
      }
      return finding
    })
  if (typeof value.truncated !== 'boolean') {
    throw new Error('Collision validation result truncated flag must be boolean.')
  }
  return Object.freeze({
    requestId: nonEmptyString(value.requestId, 'Collision validation request id'),
    revision: nonEmptyString(value.revision, 'Collision validation revision'),
    mode: value.mode,
    sampleCount,
    durationMs,
    findings: Object.freeze(validatedFindings),
    mountContact: mountContactState(value.mountContact),
    truncated: value.truncated || findingsTruncated,
  })
}

export function validateCollisionValidationWorkerEvent(
  candidate: unknown,
): CollisionValidationWorkerEvent {
  const value = record(candidate, 'Collision validation Worker event')
  if (value.type === 'progress') {
    return Object.freeze({
      type: 'progress',
      progress: validateCollisionValidationProgress(value.progress),
    })
  }
  if (value.type === 'result') {
    return Object.freeze({
      type: 'result',
      result: validateCollisionValidationResult(value.result),
    })
  }
  if (value.type === 'cancelled') {
    return Object.freeze({
      type: 'cancelled',
      requestId: nonEmptyString(value.requestId, 'Collision validation request id'),
      revision: nonEmptyString(value.revision, 'Collision validation revision'),
    })
  }
  if (value.type === 'error') {
    return Object.freeze({
      type: 'error',
      requestId: nonEmptyString(value.requestId, 'Collision validation request id'),
      revision: nonEmptyString(value.revision, 'Collision validation revision'),
      message: nonEmptyString(value.message, 'Collision validation Worker error'),
    })
  }
  throw new Error('Unsupported collision validation Worker event.')
}
