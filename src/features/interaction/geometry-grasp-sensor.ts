import type { Object3D } from 'three'
import {
  validateGeometryCollisionEntity,
  type GeometryCollisionEntity,
} from '../../domain/collision/collision'
import { queryObbPair, worldObbFromBox } from '../../domain/collision/obb'
import {
  GRASP_SENSOR_HALF_EXTENTS,
  GRASP_SENSOR_LOCAL_CENTER,
} from './interaction-math'
import type { ExternalCollisionEntityId } from './interaction-store'

export interface GeometryGraspCandidate {
  readonly entityId: ExternalCollisionEntityId
  readonly distanceSq: number
}

function squaredDistance(
  first: readonly [number, number, number],
  second: readonly [number, number, number],
): number {
  const x = first[0] - second[0]
  const y = first[1] - second[1]
  const z = first[2] - second[2]
  return Math.round((x * x + y * y + z * z) * 1e12) / 1e12
}

export function createGeometryGraspSensorEntity(
  tcpFrame: Object3D,
): GeometryCollisionEntity {
  tcpFrame.updateWorldMatrix(true, false)
  return validateGeometryCollisionEntity({
    id: 'tool:grasp-sensor',
    name: 'Grasp sensor',
    category: 'tool',
    worldMatrix: [...tcpFrame.matrixWorld.elements],
    boxes: [
      {
        id: 'sensor',
        center: GRASP_SENSOR_LOCAL_CENTER,
        halfExtents: GRASP_SENSOR_HALF_EXTENTS,
        quaternion: [0, 0, 0, 1],
      },
    ],
  })
}

export function findGraspCandidates(
  sensorEntity: GeometryCollisionEntity,
  candidates: readonly GeometryCollisionEntity[],
): readonly GeometryGraspCandidate[] {
  const sensorObbs = sensorEntity.boxes.map((box) =>
    worldObbFromBox(sensorEntity, box),
  )
  const found: GeometryGraspCandidate[] = []

  for (const candidate of candidates) {
    if (candidate.category !== 'equipment' && candidate.category !== 'object') {
      continue
    }
    let nearestDistanceSq = Number.POSITIVE_INFINITY
    for (const sensorObb of sensorObbs) {
      for (const box of candidate.boxes) {
        const candidateObb = worldObbFromBox(candidate, box)
        const overlap = queryObbPair(sensorObb, candidateObb, 0)
        if (overlap?.kind !== 'collision') continue
        nearestDistanceSq = Math.min(
          nearestDistanceSq,
          squaredDistance(sensorObb.center, candidateObb.center),
        )
      }
    }
    if (Number.isFinite(nearestDistanceSq)) {
      found.push({
        entityId: candidate.id as ExternalCollisionEntityId,
        distanceSq: nearestDistanceSq,
      })
    }
  }

  return Object.freeze(
    found.sort(
      (first, second) =>
        first.distanceSq - second.distanceSq ||
        first.entityId.localeCompare(second.entityId),
    ),
  )
}
