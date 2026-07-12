import { Matrix4, Quaternion, Vector3 } from 'three'
import type { SerializableTransform } from '../../domain/equipment/equipment'
import { serializableTransformToPose3D } from '../../domain/frames/pose3d'

function transformMatrix(transform: SerializableTransform): Matrix4 {
  return new Matrix4().compose(
    new Vector3(...transform.position),
    new Quaternion(...transform.quaternion).normalize(),
    new Vector3(...transform.scale),
  )
}

export function worldTransformToMcpLocal(
  world: SerializableTransform,
  mcp: SerializableTransform,
): SerializableTransform {
  serializableTransformToPose3D(mcp)
  const local = transformMatrix(mcp).invert().multiply(transformMatrix(world))
  const position = new Vector3()
  const quaternion = new Quaternion()
  const scale = new Vector3()
  local.decompose(position, quaternion, scale)
  return {
    position: position.toArray(),
    quaternion: quaternion.normalize().toArray(),
    scale: scale.toArray(),
  }
}
