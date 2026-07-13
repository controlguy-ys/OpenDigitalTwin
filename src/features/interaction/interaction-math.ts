import {
  Box3,
  Matrix4,
  Quaternion,
  Vector3,
  type Object3D,
} from 'three'
import type { SerializableTransform } from '../../domain/equipment/equipment'
import type { JointAnglesDeg } from '../../domain/robot/joint-frame'
import type { CollisionEntityId } from './interaction-store'

export const CUP01_PICK_ANGLES_DEG: JointAnglesDeg = [
  184.8,
  -63.6,
  -205.2,
  -152,
  -22.1,
  -144.2,
]
export const GRASP_SENSOR_LOCAL_CENTER = [0, 0, 0.09] as const
export const GRASP_SENSOR_HALF_EXTENTS = [0.1, 0.08, 0.1] as const
export const MAX_WORKBENCH_SNAP_GAP_METERS = 0.002

export interface GraspCandidateDistance {
  equipmentId: string
  distanceSq: number
}

function transformToMatrix(transform: SerializableTransform): Matrix4 {
  return new Matrix4().compose(
    new Vector3(...transform.position),
    new Quaternion(...transform.quaternion),
    new Vector3(...transform.scale),
  )
}

export function matrixToTransform(matrix: Matrix4): SerializableTransform {
  const position = new Vector3()
  const quaternion = new Quaternion()
  const scale = new Vector3()
  matrix.decompose(position, quaternion, scale)
  return {
    position: position.toArray(),
    quaternion: quaternion.toArray(),
    scale: scale.toArray(),
  }
}

export function computeGripOffset(
  toolWorld: SerializableTransform,
  equipmentWorld: SerializableTransform,
): SerializableTransform {
  const offsetMatrix = transformToMatrix(toolWorld)
    .invert()
    .multiply(transformToMatrix(equipmentWorld))
  return matrixToTransform(offsetMatrix)
}

export function composeWorldTransform(
  parentWorld: SerializableTransform,
  localTransform: SerializableTransform,
): SerializableTransform {
  return matrixToTransform(
    transformToMatrix(parentWorld).multiply(transformToMatrix(localTransform)),
  )
}

export function chooseNearestGraspCandidate(
  candidates: readonly GraspCandidateDistance[],
): string | null {
  let nearest: GraspCandidateDistance | null = null
  for (const candidate of candidates) {
    if (!Number.isFinite(candidate.distanceSq) || candidate.distanceSq < 0) {
      continue
    }
    if (
      nearest === null ||
      candidate.distanceSq < nearest.distanceSq ||
      (candidate.distanceSq === nearest.distanceSq &&
        candidate.equipmentId < nearest.equipmentId)
    ) {
      nearest = candidate
    }
  }
  return nearest?.equipmentId ?? null
}

function colliderWorldBottom(
  transform: SerializableTransform,
  localCenter: readonly [number, number, number],
  halfExtents: readonly [number, number, number],
): number {
  const quaternion = new Quaternion(...transform.quaternion).normalize()
  const scale = new Vector3(...transform.scale)
  const scaledCenter = new Vector3(...localCenter)
    .multiply(scale)
    .applyQuaternion(quaternion)
  const rotation = new Matrix4().makeRotationFromQuaternion(quaternion).elements
  const worldHalfExtentZ =
    Math.abs(rotation[2] ?? 0) * halfExtents[0] * Math.abs(scale.x) +
    Math.abs(rotation[6] ?? 0) * halfExtents[1] * Math.abs(scale.y) +
    Math.abs(rotation[10] ?? 0) * halfExtents[2] * Math.abs(scale.z)
  return transform.position[2] + scaledCenter.z - worldHalfExtentZ
}

export function snapTransformToWorkbench(
  transform: SerializableTransform,
  localCenter: readonly [number, number, number],
  halfExtents: readonly [number, number, number],
  workbenchTopZ: number,
): SerializableTransform {
  const snapped: SerializableTransform = {
    position: [...transform.position],
    quaternion: [...transform.quaternion],
    scale: [...transform.scale],
  }
  const gap = colliderWorldBottom(
    snapped,
    localCenter,
    halfExtents,
  ) - workbenchTopZ
  if (gap > 0 && gap <= MAX_WORKBENCH_SNAP_GAP_METERS + Number.EPSILON) {
    snapped.position[2] -= gap
  }
  return snapped
}

export function getGraspSensorWorldTransform(
  toolFrame: Object3D,
): SerializableTransform {
  toolFrame.updateWorldMatrix(true, false)
  return matrixToTransform(
    toolFrame.matrixWorld
      .clone()
      .multiply(new Matrix4().makeTranslation(...GRASP_SENSOR_LOCAL_CENTER)),
  )
}

export function getWorldColliderCenter(
  object: Object3D,
  localCenter: readonly [number, number, number],
): [number, number, number] {
  object.updateWorldMatrix(true, false)
  return new Vector3(...localCenter).applyMatrix4(object.matrixWorld).toArray()
}

function transformedBox(
  transform: SerializableTransform,
  localCenter: readonly [number, number, number],
  halfExtents: readonly [number, number, number],
): Box3 {
  return new Box3(
    new Vector3(
      localCenter[0] - halfExtents[0],
      localCenter[1] - halfExtents[1],
      localCenter[2] - halfExtents[2],
    ),
    new Vector3(
      localCenter[0] + halfExtents[0],
      localCenter[1] + halfExtents[1],
      localCenter[2] + halfExtents[2],
    ),
  ).applyMatrix4(transformToMatrix(transform))
}

export function intersectsGraspSensor(
  sensorWorld: SerializableTransform,
  sensorHalfExtents: readonly [number, number, number],
  equipmentWorld: SerializableTransform,
  equipmentLocalCenter: readonly [number, number, number],
  equipmentHalfExtents: readonly [number, number, number],
): boolean {
  return transformedBox(sensorWorld, [0, 0, 0], sensorHalfExtents).intersectsBox(
    transformedBox(
      equipmentWorld,
      equipmentLocalCenter,
      equipmentHalfExtents,
    ),
  )
}

function robotLinkIndex(entity: CollisionEntityId): number | null {
  if (!entity.startsWith('robot-link:LINK')) {
    return null
  }
  const index = Number(entity.slice('robot-link:LINK'.length))
  return Number.isInteger(index) ? index : null
}

export function isCollisionPairAllowed(
  first: CollisionEntityId,
  second: CollisionEntityId,
): boolean {
  if (first === second || first === 'grasp-sensor' || second === 'grasp-sensor') {
    return false
  }

  const firstRobotIndex = robotLinkIndex(first)
  const secondRobotIndex = robotLinkIndex(second)
  if (firstRobotIndex !== null && secondRobotIndex !== null) {
    return Math.abs(firstRobotIndex - secondRobotIndex) > 1
  }

  const workcell = first === 'workcell:workbench' || second === 'workcell:workbench'
  if (workcell) {
    const robotEntity = firstRobotIndex === null ? second : first
    return robotEntity.startsWith('robot-link:') && robotEntity !== 'robot-link:LINK00'
  }

  return (
    (firstRobotIndex !== null &&
      (second.startsWith('equipment:') || second.startsWith('object:'))) ||
    (secondRobotIndex !== null &&
      (first.startsWith('equipment:') || first.startsWith('object:')))
  )
}
