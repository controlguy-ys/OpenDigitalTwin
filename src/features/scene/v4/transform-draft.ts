import {
  failProjectV4,
  normalizeRigidTransformV4,
  quaternionToRpyDegreesV4,
  rpyDegreesToQuaternionV4,
  type RigidTransformV4,
} from '../../../core/project-v4/index.js'

export interface TransformDraftV4 {
  readonly xMm: string
  readonly yMm: string
  readonly zMm: string
  readonly rollDeg: string
  readonly pitchDeg: string
  readonly yawDeg: string
}

function draftFailure(field: keyof TransformDraftV4): never {
  failProjectV4(
    'TRANSFORM_DRAFT_INVALID',
    `$.transformDraft.${field}`,
    'Transform draft fields must contain finite numbers.',
    'Enter a finite XYZ value in millimetres and RPY value in degrees.',
  )
}

function parseFiniteField(draft: TransformDraftV4, field: keyof TransformDraftV4): number {
  const text = draft[field]
  if (text.trim() === '') draftFailure(field)
  const value = Number(text)
  if (!Number.isFinite(value)) draftFailure(field)
  return value === 0 ? 0 : value
}

function displayNumber(value: number): string {
  return String(value === 0 ? 0 : value)
}

export function transformDraftFromRigidTransformV4(
  pose: RigidTransformV4,
): TransformDraftV4 {
  const normalized = normalizeRigidTransformV4(pose, '$.transformDraft.pose')
  const [rollDeg, pitchDeg, yawDeg] = quaternionToRpyDegreesV4(normalized.quaternion)

  return {
    xMm: displayNumber(normalized.positionM[0] * 1_000),
    yMm: displayNumber(normalized.positionM[1] * 1_000),
    zMm: displayNumber(normalized.positionM[2] * 1_000),
    rollDeg: displayNumber(rollDeg),
    pitchDeg: displayNumber(pitchDeg),
    yawDeg: displayNumber(yawDeg),
  }
}

export function rigidTransformFromTransformDraftV4(
  draft: TransformDraftV4,
): RigidTransformV4 {
  const xMm = parseFiniteField(draft, 'xMm')
  const yMm = parseFiniteField(draft, 'yMm')
  const zMm = parseFiniteField(draft, 'zMm')
  const rollDeg = parseFiniteField(draft, 'rollDeg')
  const pitchDeg = parseFiniteField(draft, 'pitchDeg')
  const yawDeg = parseFiniteField(draft, 'yawDeg')

  return normalizeRigidTransformV4({
    positionM: [xMm / 1_000, yMm / 1_000, zMm / 1_000],
    quaternion: rpyDegreesToQuaternionV4([rollDeg, pitchDeg, yawDeg]),
  }, '$.transformDraft')
}
