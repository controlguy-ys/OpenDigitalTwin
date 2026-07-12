import { Euler, Matrix4, Quaternion, Vector3 } from 'three'
import type { SerializableTransform } from '../equipment/equipment'

export type Position3 = readonly [number, number, number]
export type Quaternion4 = readonly [number, number, number, number]
export type RollPitchYaw = readonly [number, number, number]

export interface Pose3D {
  readonly position: Position3
  readonly quaternion: Quaternion4
}

export const IDENTITY_POSE: Pose3D = {
  position: [0, 0, 0],
  quaternion: [0, 0, 0, 1],
}

const QUATERNION_EPSILON = 1e-12
const SCALE_EPSILON = 1e-9

function finiteTuple(value: readonly number[], length: number): boolean {
  return value.length === length && value.every(Number.isFinite)
}

export function normalizePose3D(pose: Pose3D): Pose3D {
  if (!finiteTuple(pose.position, 3) || !finiteTuple(pose.quaternion, 4)) {
    throw new Error('Pose3D position and quaternion must contain finite numbers.')
  }
  const quaternion = new Quaternion(...pose.quaternion)
  if (quaternion.lengthSq() <= QUATERNION_EPSILON) {
    throw new Error('Pose3D quaternion must be normalizable.')
  }
  quaternion.normalize()
  return {
    position: [...pose.position],
    quaternion: quaternion.toArray(),
  }
}

export function pose3DToMatrix4(pose: Pose3D): Matrix4 {
  const normalized = normalizePose3D(pose)
  return new Matrix4().compose(
    new Vector3(...normalized.position),
    new Quaternion(...normalized.quaternion),
    new Vector3(1, 1, 1),
  )
}

export function matrix4ToPose3D(matrix: Matrix4): Pose3D {
  const position = new Vector3()
  const quaternion = new Quaternion()
  const scale = new Vector3()
  matrix.decompose(position, quaternion, scale)
  if (
    [scale.x, scale.y, scale.z].some(
      (entry) => Math.abs(entry - 1) > SCALE_EPSILON,
    )
  ) {
    throw new Error('Pose3D matrices cannot contain scale.')
  }
  return normalizePose3D({
    position: position.toArray(),
    quaternion: quaternion.toArray(),
  })
}

export function composePose3D(parentWorld: Pose3D, local: Pose3D): Pose3D {
  return matrix4ToPose3D(
    pose3DToMatrix4(parentWorld).multiply(pose3DToMatrix4(local)),
  )
}

export function invertPose3D(pose: Pose3D): Pose3D {
  return matrix4ToPose3D(pose3DToMatrix4(pose).invert())
}

export function relativePose3D(referenceWorld: Pose3D, targetWorld: Pose3D): Pose3D {
  return composePose3D(invertPose3D(referenceWorld), targetWorld)
}

export function rpyToQuaternion([
  roll,
  pitch,
  yaw,
]: RollPitchYaw): Quaternion4 {
  if (![roll, pitch, yaw].every(Number.isFinite)) {
    throw new Error('Roll, pitch, and yaw must be finite radians.')
  }
  return new Quaternion()
    .setFromEuler(new Euler(roll, pitch, yaw, 'ZYX'))
    .normalize()
    .toArray()
}

export function quaternionToRpy(quaternion: Quaternion4): RollPitchYaw {
  const normalized = normalizePose3D({ position: [0, 0, 0], quaternion })
  const euler = new Euler().setFromQuaternion(
    new Quaternion(...normalized.quaternion),
    'ZYX',
  )
  return [euler.x, euler.y, euler.z]
}

export function pose3DApproximatelyEquals(
  first: Pose3D,
  second: Pose3D,
  epsilon = 1e-9,
): boolean {
  const firstElements = pose3DToMatrix4(first).elements
  const secondElements = pose3DToMatrix4(second).elements
  return firstElements.every(
    (entry, index) =>
      Math.abs(entry - (secondElements[index] ?? Number.NaN)) <= epsilon,
  )
}

export function serializableTransformToPose3D(
  transform: SerializableTransform,
): Pose3D {
  if (
    transform.scale.some(
      (component) =>
        !Number.isFinite(component) ||
        Math.abs(component - 1) > SCALE_EPSILON,
    )
  ) {
    throw new Error('Coordinate frames cannot contain scale.')
  }
  return normalizePose3D({
    position: transform.position,
    quaternion: transform.quaternion,
  })
}

export function pose3DToSerializableTransform(
  pose: Pose3D,
): SerializableTransform {
  const normalized = normalizePose3D(pose)
  return {
    position: [...normalized.position],
    quaternion: [...normalized.quaternion],
    scale: [1, 1, 1],
  }
}
