import {
  composeRigidTransformV4,
  normalizeRigidTransformV4,
  type RigidTransformV4,
} from '../../../core/project-v4/rigid-transform.js'
import type {
  CollisionBoxV4,
  RobotDefinitionV4,
  SpatialEntityV4,
} from '../../../core/project-v4/types.js'
import {
  encodeRuntimeIdentitySegmentV4,
  robotLinkCollisionIdV4,
  spatialEntityCollisionIdV4,
} from '../../../core/robot-runtime/collision-identity.js'
import {
  validateCollisionBox,
  validateGeometryCollisionEntityV4,
  type CollisionBox,
  type GeometryCollisionEntityV4,
  type Matrix4Tuple,
} from '../../../domain/collision/collision.js'

export interface CollisionGeometryProxyV4 {
  readonly entity: GeometryCollisionEntityV4
  readonly effectiveVisible: boolean
}

function rigidTransformMatrixV4(poseCandidate: RigidTransformV4): Matrix4Tuple {
  const pose = normalizeRigidTransformV4(poseCandidate, '$.worldPose')
  const [x, y, z, w] = pose.quaternion
  const x2 = x + x
  const y2 = y + y
  const z2 = z + z
  const xx = x * x2
  const xy = x * y2
  const xz = x * z2
  const yy = y * y2
  const yz = y * z2
  const zz = z * z2
  const wx = w * x2
  const wy = w * y2
  const wz = w * z2
  return Object.freeze([
    1 - (yy + zz), xy + wz, xz - wy, 0,
    xy - wz, 1 - (xx + zz), yz + wx, 0,
    xz + wy, yz - wx, 1 - (xx + yy), 0,
    pose.positionM[0], pose.positionM[1], pose.positionM[2], 1,
  ])
}

function collisionBoxFromV4(
  box: CollisionBoxV4,
  id: string,
  parentPose: RigidTransformV4 = {
    positionM: [0, 0, 0],
    quaternion: [0, 0, 0, 1],
  },
): CollisionBox {
  const local = composeRigidTransformV4(parentPose, {
    positionM: box.centerM,
    quaternion: box.quaternion,
  })
  return validateCollisionBox({
    id,
    center: local.positionM,
    halfExtents: box.halfExtentsM,
    quaternion: local.quaternion,
  })
}

export function robotLinkCollisionProxiesV4(input: {
  readonly robotId: string
  readonly definition: RobotDefinitionV4
  readonly linkWorldPoses: Readonly<Record<string, RigidTransformV4>>
  readonly effectiveVisible: boolean
}): readonly CollisionGeometryProxyV4[] {
  const excluded = new Set(input.definition.excludedGeometryOccurrenceKeys)
  const proxies: CollisionGeometryProxyV4[] = []
  for (const link of input.definition.links) {
    if (!Object.hasOwn(input.linkWorldPoses, link.id)) {
      throw new Error(`Robot Link ${link.id} is missing its resolved World pose.`)
    }
    const worldPose = input.linkWorldPoses[link.id]
    if (worldPose === undefined) {
      throw new Error(`Robot Link ${link.id} is missing its resolved World pose.`)
    }
    const boxes = link.geometryOccurrences.flatMap((occurrence) => {
      if (excluded.has(occurrence.occurrenceKey)) return []
      return occurrence.collisionBoxes.map((box) => collisionBoxFromV4(
        box,
        `${encodeRuntimeIdentitySegmentV4(occurrence.occurrenceKey)}:${encodeRuntimeIdentitySegmentV4(box.id)}`,
        occurrence.linkLocalPose,
      ))
    })
    if (boxes.length === 0) continue
    proxies.push(Object.freeze({
      entity: validateGeometryCollisionEntityV4({
        id: robotLinkCollisionIdV4(input.robotId, link.id),
        name: link.name,
        category: 'robot-link',
        worldMatrix: rigidTransformMatrixV4(worldPose),
        boxes,
      }),
      effectiveVisible: input.effectiveVisible,
    }))
  }
  return Object.freeze(proxies)
}

export function spatialEntityCollisionProxyV4(input: {
  readonly entity: SpatialEntityV4
  readonly worldPose: RigidTransformV4
  readonly effectiveVisible: boolean
}): CollisionGeometryProxyV4 | null {
  const { geometry } = input.entity
  const boxes: readonly CollisionBox[] = geometry.kind === 'box'
    ? [validateCollisionBox({
        id: 'primitive',
        center: [0, 0, 0],
        halfExtents: geometry.dimensionsM.map((value) => value / 2) as [number, number, number],
        quaternion: [0, 0, 0, 1],
      })]
    : geometry.kind === 'cylinder'
      ? [validateCollisionBox({
          id: 'primitive',
          center: [0, 0, 0],
          halfExtents: [geometry.radiusM, geometry.radiusM, geometry.heightM / 2],
          quaternion: [0, 0, 0, 1],
        })]
      : geometry.collisionBoxes.map((box) => collisionBoxFromV4(
          box,
          encodeRuntimeIdentitySegmentV4(box.id),
        ))
  if (boxes.length === 0) return null
  return Object.freeze({
    entity: validateGeometryCollisionEntityV4({
      id: spatialEntityCollisionIdV4(input.entity.id),
      name: input.entity.name,
      category: 'spatial-entity',
      worldMatrix: rigidTransformMatrixV4(input.worldPose),
      boxes,
    }),
    effectiveVisible: input.effectiveVisible,
  })
}

export function visibleCollisionEntitiesV4(
  proxies: readonly CollisionGeometryProxyV4[],
): readonly GeometryCollisionEntityV4[] {
  return Object.freeze(
    proxies.filter(({ effectiveVisible }) => effectiveVisible).map(({ entity }) => entity),
  )
}
