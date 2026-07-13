import {
  validateCollisionBox,
  validateCollisionFinding,
  validateCollisionPolicy,
  validateGeometryCollisionEntity,
  type CollisionBox,
  type CollisionFinding,
  type CollisionPolicy,
  type GeometryCollisionEntity,
} from '../../domain/collision/collision'
import type { SerializableTransform } from '../../domain/equipment/equipment'
import type { RobotLinkId } from '../../domain/robot/crb15000'
import type { RobotKinematicDefinition } from '../../domain/robot/kinematics'
import type { RobotKeyframe } from '../joints/keyframes'
import {
  MAX_COLLISION_VALIDATION_SAMPLES,
  type CollisionValidationMode,
} from './validate-pose-sequence'

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
  readonly policy: CollisionPolicy
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
      linkEntities: linkEntities(robotCandidate.linkEntities),
      toolEntity: toolEntity(robotCandidate.toolEntity),
    }),
    heldObject: heldObject(value.heldObject),
    staticEntities: Object.freeze(
      staticCandidates.map((entity) =>
        validateGeometryCollisionEntity(entity as GeometryCollisionEntity),
      ),
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
