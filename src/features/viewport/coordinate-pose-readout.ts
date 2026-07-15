import { Euler, Matrix4, Quaternion, Vector3 } from 'three'
import type { PoseFramePreference } from './viewport-preference-store'

export interface CoordinateFrameMatrices {
  readonly world: readonly number[]
  readonly mcp: readonly number[]
  readonly base: readonly number[]
  readonly tcp: readonly number[]
}

export interface ActualTcpPoseReadout {
  readonly xyzMm: readonly [number, number, number]
  readonly rpyDeg: readonly [number, number, number]
}

function rounded(value: number, digits = 3): number {
  const clean = Math.abs(value) < 10 ** -(digits + 1) ? 0 : value
  return Number(clean.toFixed(digits))
}

export function computeActualTcpPoseReadout(
  matrices: CoordinateFrameMatrices,
  frame: PoseFramePreference,
): ActualTcpPoseReadout {
  const reference = frame === 'world' ? matrices.world : matrices[frame]
  const relative = new Matrix4().fromArray(reference).invert()
    .multiply(new Matrix4().fromArray(matrices.tcp))
  const position = new Vector3()
  const quaternion = new Quaternion()
  relative.decompose(position, quaternion, new Vector3())
  const rpy = new Euler().setFromQuaternion(quaternion.normalize(), 'ZYX')
  return {
    xyzMm: position.toArray().map((value) => rounded(value * 1000)) as [number, number, number],
    rpyDeg: [rpy.x, rpy.y, rpy.z]
      .map((value) => rounded(value * 180 / Math.PI)) as [number, number, number],
  }
}
