import type { Object3D } from 'three'
import type { StoreApi } from 'zustand/vanilla'
import type { CollisionPolicy } from '../../domain/collision/collision'
import {
  queryGeometryCollisionsWithTelemetry,
} from '../../domain/collision/query-collision'
import type { CollisionStoreState } from './collision-store'
import {
  geometryEntityRegistry,
  snapshotGeometryEntities,
  type GeometryEntityRegistry,
} from './geometry-entity-registry'

export const CURRENT_POSE_COLLISION_INTERVAL_MS = 100

export interface CurrentPoseCollisionResult {
  readonly findings: ReturnType<
    typeof queryGeometryCollisionsWithTelemetry
  >['findings']
  readonly telemetry: ReturnType<
    typeof queryGeometryCollisionsWithTelemetry
  >['telemetry']
  readonly diagnostics: ReturnType<
    typeof snapshotGeometryEntities
  >['diagnostics']
}

export class CurrentPoseCollisionScheduler {
  private readonly intervalMs: number
  private lastExecutionMs: number | null = null
  private publishedRevision: string | null = null
  private pendingRevision: string | null = null

  constructor(intervalMs = CURRENT_POSE_COLLISION_INTERVAL_MS) {
    if (!Number.isFinite(intervalMs) || intervalMs <= 0) {
      throw new Error('Current-pose collision interval must be positive.')
    }
    this.intervalMs = intervalMs
  }

  observe(
    nowMs: number,
    revision: string,
    query: (revision: string) => void,
  ): boolean {
    if (!Number.isFinite(nowMs) || nowMs < 0) {
      throw new Error('Current-pose collision time must be non-negative.')
    }
    if (revision.length === 0) {
      throw new Error('Current-pose collision revision must not be empty.')
    }

    this.pendingRevision =
      revision === this.publishedRevision ? null : revision
    if (this.pendingRevision === null) return false
    if (
      this.lastExecutionMs !== null &&
      nowMs - this.lastExecutionMs < this.intervalMs
    ) {
      return false
    }

    const pendingRevision = this.pendingRevision
    query(pendingRevision)
    this.lastExecutionMs = nowMs
    this.publishedRevision = pendingRevision
    if (this.pendingRevision === pendingRevision) {
      this.pendingRevision = null
    }
    return true
  }
}

export function queryCurrentPoseCollision(
  policy: CollisionPolicy,
  registry: GeometryEntityRegistry = geometryEntityRegistry,
): CurrentPoseCollisionResult {
  const snapshot = snapshotGeometryEntities(registry)
  const query = queryGeometryCollisionsWithTelemetry(snapshot.entities, policy)
  return Object.freeze({
    findings: query.findings,
    telemetry: query.telemetry,
    diagnostics: snapshot.diagnostics,
  })
}

export function publishCurrentPoseCollision(
  collisionStore: Pick<StoreApi<CollisionStoreState>, 'getState'>,
  registry: GeometryEntityRegistry = geometryEntityRegistry,
): CurrentPoseCollisionResult {
  const policy = collisionStore.getState().policy
  const result = queryCurrentPoseCollision(policy, registry)
  collisionStore.getState().replaceCollisionState({
    policy,
    currentFindings: result.findings,
    diagnostics: result.diagnostics,
  })
  return result
}

function appendObjectTransformRevision(
  values: string[],
  object: Object3D,
): void {
  let current: Object3D | null = object
  while (current !== null) {
    values.push(
      current.uuid,
      current.visible ? '1' : '0',
      `${current.position.x},${current.position.y},${current.position.z}`,
      `${current.quaternion.x},${current.quaternion.y},${current.quaternion.z},${current.quaternion.w}`,
      `${current.scale.x},${current.scale.y},${current.scale.z}`,
    )
    current = current.parent
  }
}

export function currentPoseCollisionRevision(
  policy: CollisionPolicy,
  registry: GeometryEntityRegistry = geometryEntityRegistry,
): string {
  const values = [
    policy.enabled ? 'enabled' : 'disabled',
    `${policy.warningDistanceM}`,
    ...policy.ignoredPairKeys,
    '#self',
    ...policy.enabledRobotSelfPairs,
  ]
  const registrations = [...registry.values()].sort((first, second) =>
    first.id.localeCompare(second.id),
  )
  for (const registration of registrations) {
    values.push(
      '#entity',
      registration.id,
      registration.category,
      `${registration.colliderRevision}`,
      JSON.stringify(registration.boxes),
    )
    if (registration.object === null) {
      values.push('missing')
    } else {
      appendObjectTransformRevision(values, registration.object)
    }
  }
  return values.join('|')
}
