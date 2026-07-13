export type Vector3Tuple = readonly [number, number, number]
export type QuaternionTuple = readonly [number, number, number, number]
export type Matrix4Tuple = readonly number[]

export type CollisionEntityCategory =
  | 'robot-link'
  | 'tool'
  | 'environment'
  | 'equipment'
  | 'object'
  | 'held-object'

export interface CollisionBox {
  readonly id: string
  readonly center: Vector3Tuple
  readonly halfExtents: Vector3Tuple
  readonly quaternion: QuaternionTuple
}

export interface GeometryCollisionEntity {
  readonly id: string
  readonly name: string
  readonly category: CollisionEntityCategory
  readonly worldMatrix: Matrix4Tuple
  readonly boxes: readonly CollisionBox[]
}

export interface WorldObb {
  readonly entityId: string
  readonly boxId: string
  readonly center: Vector3Tuple
  readonly axes: readonly [Vector3Tuple, Vector3Tuple, Vector3Tuple]
  readonly halfExtents: Vector3Tuple
}

export interface CollisionPolicy {
  readonly enabled: boolean
  readonly warningDistanceM: number
  readonly ignoredPairKeys: readonly string[]
  readonly enabledRobotSelfPairs: readonly string[]
}

export interface CollisionFinding {
  readonly pairKey: string
  readonly firstEntityId: string
  readonly secondEntityId: string
  readonly firstBoxId: string
  readonly secondBoxId: string
  readonly kind: 'collision' | 'near-miss'
  readonly separationM: number
  readonly sampleIndex: number | null
  readonly timeMs: number | null
}

export interface CollisionDiagnostic {
  readonly entityId: string
  readonly message: string
}

export const MAX_COLLISION_BOXES_PER_ENTITY = 16

export const DEFAULT_COLLISION_POLICY: CollisionPolicy = Object.freeze({
  enabled: true,
  warningDistanceM: 0.05,
  ignoredPairKeys: Object.freeze([]),
  enabledRobotSelfPairs: Object.freeze([]),
})

function compareStrings(first: string, second: string): number {
  return first < second ? -1 : first > second ? 1 : 0
}

function requireNonEmpty(value: string, label: string): string {
  if (value.trim().length === 0) {
    throw new Error(`${label} must not be empty.`)
  }
  if (value.includes('|')) {
    throw new Error(`${label} must not contain the pair-key separator.`)
  }
  return value
}

function ownedVector3(
  values: readonly number[],
  label: string,
  positive = false,
): Vector3Tuple {
  if (values.length !== 3 || values.some((value) => !Number.isFinite(value))) {
    throw new Error(`${label} must contain three finite numbers.`)
  }
  if (positive && values.some((value) => value <= 0)) {
    throw new Error(`${label} values must be positive.`)
  }
  return Object.freeze([values[0]!, values[1]!, values[2]!])
}

function ownedQuaternion(values: readonly number[]): QuaternionTuple {
  if (values.length !== 4 || values.some((value) => !Number.isFinite(value))) {
    throw new Error('Collision Box quaternion must contain four finite numbers.')
  }
  const lengthSquared = values.reduce((sum, value) => sum + value * value, 0)
  if (lengthSquared <= 1e-24) {
    throw new Error('Collision Box quaternion must be non-zero.')
  }
  return Object.freeze([values[0]!, values[1]!, values[2]!, values[3]!])
}

function expectedIdPrefix(category: CollisionEntityCategory): string | null {
  switch (category) {
    case 'robot-link':
      return 'robot-link:'
    case 'tool':
      return 'tool:'
    case 'environment':
      return 'workcell:'
    case 'equipment':
      return 'equipment:'
    case 'object':
      return 'object:'
    case 'held-object':
      return null
  }
}

function validateEntityNamespace(
  id: string,
  category: CollisionEntityCategory,
): void {
  const prefix = expectedIdPrefix(category)
  const valid =
    category === 'held-object'
      ? id.startsWith('object:') || id.startsWith('equipment:')
      : prefix !== null && id.startsWith(prefix)
  if (!valid || id.endsWith(':')) {
    throw new Error(`Collision Entity ${id} has an invalid ${category} namespace.`)
  }
  if (category === 'environment' && id !== 'workcell:workbench') {
    throw new Error('Environment namespace currently supports workcell:workbench only.')
  }
}

export function validateCollisionBox(candidate: CollisionBox): CollisionBox {
  return Object.freeze({
    id: requireNonEmpty(candidate.id, 'Collision Box id'),
    center: ownedVector3(candidate.center, 'Collision Box center'),
    halfExtents: ownedVector3(
      candidate.halfExtents,
      'Collision Box half extents',
      true,
    ),
    quaternion: ownedQuaternion(candidate.quaternion),
  })
}

export function validateGeometryCollisionEntity(
  candidate: GeometryCollisionEntity,
): GeometryCollisionEntity {
  const id = requireNonEmpty(candidate.id, 'Collision Entity id')
  requireNonEmpty(candidate.name, 'Collision Entity name')
  validateEntityNamespace(id, candidate.category)
  if (
    candidate.worldMatrix.length !== 16 ||
    candidate.worldMatrix.some((value) => !Number.isFinite(value))
  ) {
    throw new Error('Collision Entity World matrix must contain 16 finite numbers.')
  }
  if (candidate.boxes.length > MAX_COLLISION_BOXES_PER_ENTITY) {
    throw new Error(
      `Collision Entity cannot exceed ${MAX_COLLISION_BOXES_PER_ENTITY} Boxes.`,
    )
  }
  const boxes = candidate.boxes.map(validateCollisionBox)
  const boxIds = new Set(boxes.map((box) => box.id))
  if (boxIds.size !== boxes.length) {
    throw new Error(`Collision Entity ${id} contains duplicate Box ids.`)
  }
  return Object.freeze({
    id,
    name: candidate.name,
    category: candidate.category,
    worldMatrix: Object.freeze([...candidate.worldMatrix]),
    boxes: Object.freeze(boxes),
  })
}

function validateEntityId(id: string): string {
  requireNonEmpty(id, 'Collision Entity id')
  if (!id.includes(':') || id.endsWith(':')) {
    throw new Error(`Collision Entity id ${id} must use a namespace.`)
  }
  return id
}

export function pairKey(firstEntityId: string, secondEntityId: string): string {
  const first = validateEntityId(firstEntityId)
  const second = validateEntityId(secondEntityId)
  return compareStrings(first, second) <= 0
    ? `${first}|${second}`
    : `${second}|${first}`
}

function ownedPairKeys(values: readonly string[], label: string): readonly string[] {
  const result = new Set<string>()
  for (const value of values) {
    const [first, second, extra] = value.split('|')
    if (first === undefined || second === undefined || extra !== undefined) {
      throw new Error(`${label} must contain canonical Entity pair keys.`)
    }
    const canonical = pairKey(first, second)
    if (canonical !== value) {
      throw new Error(`${label} must contain canonical Entity pair keys.`)
    }
    result.add(value)
  }
  return Object.freeze([...result].sort(compareStrings))
}

export function validateCollisionPolicy(
  candidate: CollisionPolicy,
): CollisionPolicy {
  if (typeof candidate.enabled !== 'boolean') {
    throw new Error('Collision policy enabled must be boolean.')
  }
  if (
    !Number.isFinite(candidate.warningDistanceM) ||
    candidate.warningDistanceM < 0
  ) {
    throw new Error('Collision warning distance must be a finite non-negative number.')
  }
  return Object.freeze({
    enabled: candidate.enabled,
    warningDistanceM: candidate.warningDistanceM,
    ignoredPairKeys: ownedPairKeys(
      candidate.ignoredPairKeys,
      'Ignored collision pairs',
    ),
    enabledRobotSelfPairs: ownedPairKeys(
      candidate.enabledRobotSelfPairs,
      'Enabled Robot self pairs',
    ),
  })
}

export function validateCollisionFinding(
  candidate: CollisionFinding,
): CollisionFinding {
  const firstEntityId = validateEntityId(candidate.firstEntityId)
  const secondEntityId = validateEntityId(candidate.secondEntityId)
  if (candidate.pairKey !== pairKey(firstEntityId, secondEntityId)) {
    throw new Error('Collision finding pair key does not match its Entity ids.')
  }
  if (!Number.isFinite(candidate.separationM)) {
    throw new Error('Collision finding separation must be finite.')
  }
  if (
    (candidate.kind === 'collision' && candidate.separationM > 0) ||
    (candidate.kind === 'near-miss' && candidate.separationM <= 0)
  ) {
    throw new Error('Collision finding kind does not match its separation.')
  }
  if (
    candidate.sampleIndex !== null &&
    (!Number.isInteger(candidate.sampleIndex) || candidate.sampleIndex < 0)
  ) {
    throw new Error('Collision finding sample index must be null or non-negative.')
  }
  if (
    candidate.timeMs !== null &&
    (!Number.isFinite(candidate.timeMs) || candidate.timeMs < 0)
  ) {
    throw new Error('Collision finding time must be null or non-negative.')
  }
  return Object.freeze({
    pairKey: candidate.pairKey,
    firstEntityId,
    secondEntityId,
    firstBoxId: requireNonEmpty(candidate.firstBoxId, 'First Collision Box id'),
    secondBoxId: requireNonEmpty(candidate.secondBoxId, 'Second Collision Box id'),
    kind: candidate.kind,
    separationM: candidate.separationM,
    sampleIndex: candidate.sampleIndex,
    timeMs: candidate.timeMs,
  })
}

export function validateCollisionDiagnostic(
  candidate: CollisionDiagnostic,
): CollisionDiagnostic {
  return Object.freeze({
    entityId: validateEntityId(candidate.entityId),
    message: requireNonEmpty(candidate.message, 'Collision diagnostic message'),
  })
}
