import {
  pairKey,
  validateCollisionBox,
  validateGeometryCollisionEntity,
  type CollisionBox,
  type CollisionFinding,
  type GeometryCollisionEntity,
  type QuaternionTuple,
  type Vector3Tuple,
  type WorldObb,
} from './collision'

const CROSS_AXIS_EPSILON_SQUARED = 1e-12
const VECTOR_EPSILON_SQUARED = 1e-24
const SEPARATION_PRECISION = 1e12

function dot(first: Vector3Tuple, second: Vector3Tuple): number {
  return first[0] * second[0] + first[1] * second[1] + first[2] * second[2]
}

function subtract(first: Vector3Tuple, second: Vector3Tuple): Vector3Tuple {
  return [first[0] - second[0], first[1] - second[1], first[2] - second[2]]
}

function scale(vector: Vector3Tuple, scalar: number): Vector3Tuple {
  return [
    canonicalZero(vector[0] * scalar),
    canonicalZero(vector[1] * scalar),
    canonicalZero(vector[2] * scalar),
  ]
}

function canonicalZero(value: number): number {
  return Object.is(value, -0) ? 0 : value
}

function cross(first: Vector3Tuple, second: Vector3Tuple): Vector3Tuple {
  return [
    canonicalZero(first[1] * second[2] - first[2] * second[1]),
    canonicalZero(first[2] * second[0] - first[0] * second[2]),
    canonicalZero(first[0] * second[1] - first[1] * second[0]),
  ]
}

function normalize(vector: Vector3Tuple, label: string): Vector3Tuple {
  const lengthSquared = dot(vector, vector)
  if (!Number.isFinite(lengthSquared) || lengthSquared <= VECTOR_EPSILON_SQUARED) {
    throw new Error(`${label} must be finite and non-degenerate.`)
  }
  return scale(vector, 1 / Math.sqrt(lengthSquared))
}

function quaternionAxes(
  quaternion: QuaternionTuple,
): readonly [Vector3Tuple, Vector3Tuple, Vector3Tuple] {
  const length = Math.hypot(...quaternion)
  const x = quaternion[0] / length
  const y = quaternion[1] / length
  const z = quaternion[2] / length
  const w = quaternion[3] / length
  const xx = x * x
  const yy = y * y
  const zz = z * z
  const xy = x * y
  const xz = x * z
  const yz = y * z
  const xw = x * w
  const yw = y * w
  const zw = z * w
  return [
    [1 - 2 * (yy + zz), 2 * (xy + zw), 2 * (xz - yw)],
    [2 * (xy - zw), 1 - 2 * (xx + zz), 2 * (yz + xw)],
    [2 * (xz + yw), 2 * (yz - xw), 1 - 2 * (xx + yy)],
  ]
}

function transformPoint(
  matrix: readonly number[],
  point: Vector3Tuple,
): Vector3Tuple {
  return [
    matrix[0]! * point[0] + matrix[4]! * point[1] + matrix[8]! * point[2] + matrix[12]!,
    matrix[1]! * point[0] + matrix[5]! * point[1] + matrix[9]! * point[2] + matrix[13]!,
    matrix[2]! * point[0] + matrix[6]! * point[1] + matrix[10]! * point[2] + matrix[14]!,
  ]
}

function transformDirection(
  matrix: readonly number[],
  direction: Vector3Tuple,
): Vector3Tuple {
  return [
    matrix[0]! * direction[0] + matrix[4]! * direction[1] + matrix[8]! * direction[2],
    matrix[1]! * direction[0] + matrix[5]! * direction[1] + matrix[9]! * direction[2],
    matrix[2]! * direction[0] + matrix[6]! * direction[1] + matrix[10]! * direction[2],
  ]
}

function orthonormalAxes(
  transformedAxes: readonly [Vector3Tuple, Vector3Tuple, Vector3Tuple],
): readonly [Vector3Tuple, Vector3Tuple, Vector3Tuple] {
  const first = normalize(transformedAxes[0], 'World OBB first axis')
  const secondRemainder = subtract(
    transformedAxes[1],
    scale(first, dot(transformedAxes[1], first)),
  )
  let second = normalize(secondRemainder, 'World OBB second axis')
  let third = normalize(cross(first, second), 'World OBB third axis')
  if (dot(third, transformedAxes[2]) < 0) {
    third = scale(third, -1)
    second = scale(second, -1)
  }
  return [first, second, third]
}

export function worldObbFromBox(
  entityCandidate: GeometryCollisionEntity,
  boxCandidate: CollisionBox,
): WorldObb {
  const entity = validateGeometryCollisionEntity(entityCandidate)
  const box = validateCollisionBox(boxCandidate)
  const localAxes = quaternionAxes(box.quaternion)
  const transformedAxes = localAxes.map((axis) =>
    transformDirection(entity.worldMatrix, axis),
  ) as unknown as [Vector3Tuple, Vector3Tuple, Vector3Tuple]
  const axes = orthonormalAxes(transformedAxes)
  const halfExtents = axes.map((axis) =>
    transformedAxes.reduce(
      (sum, edge, index) => sum + Math.abs(dot(edge, axis)) * box.halfExtents[index]!,
      0,
    ),
  ) as [number, number, number]
  return Object.freeze({
    entityId: entity.id,
    boxId: box.id,
    center: Object.freeze(transformPoint(entity.worldMatrix, box.center)),
    axes: Object.freeze(axes.map((axis) => Object.freeze(axis))) as WorldObb['axes'],
    halfExtents: Object.freeze(halfExtents),
  })
}

function validateWarningDistance(warningDistanceM: number): void {
  if (!Number.isFinite(warningDistanceM) || warningDistanceM < 0) {
    throw new Error('Collision warning distance must be finite and non-negative.')
  }
}

function projectedRadius(obb: WorldObb, axis: Vector3Tuple): number {
  return obb.axes.reduce(
    (sum, boxAxis, index) =>
      sum + obb.halfExtents[index]! * Math.abs(dot(boxAxis, axis)),
    0,
  )
}

function canonicalObbOrder(
  first: WorldObb,
  second: WorldObb,
): readonly [WorldObb, WorldObb] {
  const firstKey = `${first.entityId}\u0000${first.boxId}`
  const secondKey = `${second.entityId}\u0000${second.boxId}`
  return firstKey <= secondKey
    ? [first, second]
    : [second, first]
}

export interface ObbQueryMetadata {
  readonly sampleIndex?: number | null
  readonly timeMs?: number | null
}

export function queryObbPair(
  firstCandidate: WorldObb,
  secondCandidate: WorldObb,
  warningDistanceM: number,
  metadata: ObbQueryMetadata = {},
): CollisionFinding | null {
  validateWarningDistance(warningDistanceM)
  const [first, second] = canonicalObbOrder(firstCandidate, secondCandidate)
  if (first.entityId === second.entityId) return null
  const centerDelta = subtract(second.center, first.center)
  const candidateAxes: Vector3Tuple[] = [
    ...first.axes,
    ...second.axes,
  ]
  for (const firstAxis of first.axes) {
    for (const secondAxis of second.axes) {
      const crossAxis = cross(firstAxis, secondAxis)
      if (dot(crossAxis, crossAxis) >= CROSS_AXIS_EPSILON_SQUARED) {
        candidateAxes.push(normalize(crossAxis, 'OBB SAT cross axis'))
      }
    }
  }

  let separationM = Number.NEGATIVE_INFINITY
  for (const axisCandidate of candidateAxes) {
    const axis = normalize(axisCandidate, 'OBB SAT axis')
    const gap =
      Math.abs(dot(centerDelta, axis)) -
      projectedRadius(first, axis) -
      projectedRadius(second, axis)
    separationM = Math.max(separationM, gap)
  }
  separationM = Math.round(separationM * SEPARATION_PRECISION) / SEPARATION_PRECISION
  if (separationM > warningDistanceM) return null

  return Object.freeze({
    pairKey: pairKey(first.entityId, second.entityId),
    firstEntityId: first.entityId,
    secondEntityId: second.entityId,
    firstBoxId: first.boxId,
    secondBoxId: second.boxId,
    kind: separationM <= 0 ? 'collision' : 'near-miss',
    separationM,
    sampleIndex: metadata.sampleIndex ?? null,
    timeMs: metadata.timeMs ?? null,
  })
}
