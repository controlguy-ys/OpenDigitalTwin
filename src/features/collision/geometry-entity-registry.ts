import type { Object3D } from 'three'
import {
  validateCollisionDiagnostic,
  validateGeometryCollisionEntity,
  type CollisionBox,
  type CollisionDiagnostic,
  type CollisionEntityCategory,
  type GeometryCollisionEntity,
} from '../../domain/collision/collision'

const IDENTITY_WORLD_MATRIX = Object.freeze([
  1, 0, 0, 0,
  0, 1, 0, 0,
  0, 0, 1, 0,
  0, 0, 0, 1,
])

export interface GeometryEntityRegistration {
  readonly id: string
  readonly name: string
  readonly category: CollisionEntityCategory
  readonly boxes: readonly CollisionBox[]
  readonly object: Object3D | null
  readonly colliderRevision?: number
}

export interface RegisteredGeometryEntity
  extends Omit<GeometryEntityRegistration, 'colliderRevision'> {
  readonly colliderRevision: number
  readonly lifecycleToken: symbol
}

export type GeometryEntityRegistry = Map<string, RegisteredGeometryEntity>

export interface GeometryEntitySnapshot {
  readonly entities: readonly GeometryCollisionEntity[]
  readonly diagnostics: readonly CollisionDiagnostic[]
}

export const geometryEntityRegistry: GeometryEntityRegistry = new Map()

function ownedRegistration(
  candidate: GeometryEntityRegistration,
  lifecycleToken: symbol,
): RegisteredGeometryEntity {
  const colliderRevision = candidate.colliderRevision ?? 0
  if (!Number.isSafeInteger(colliderRevision) || colliderRevision < 0) {
    throw new Error('Collider revision must be a non-negative integer.')
  }
  const entity = validateGeometryCollisionEntity({
    id: candidate.id,
    name: candidate.name,
    category: candidate.category,
    boxes: candidate.boxes,
    worldMatrix: IDENTITY_WORLD_MATRIX,
  })
  return Object.freeze({
    id: entity.id,
    name: entity.name,
    category: entity.category,
    boxes: entity.boxes,
    object: candidate.object,
    colliderRevision,
    lifecycleToken,
  })
}

export function registerGeometryEntity(
  candidate: GeometryEntityRegistration,
  registry: GeometryEntityRegistry = geometryEntityRegistry,
): () => void {
  const lifecycleToken = Symbol(candidate.id)
  const registration = ownedRegistration(candidate, lifecycleToken)
  registry.set(registration.id, registration)

  return () => {
    if (registry.get(registration.id)?.lifecycleToken === lifecycleToken) {
      registry.delete(registration.id)
    }
  }
}

export function updateGeometryEntityObject(
  entityId: string,
  object: Object3D | null,
  registry: GeometryEntityRegistry = geometryEntityRegistry,
): void {
  const current = registry.get(entityId)
  if (current === undefined || current.object === object) return
  registry.set(
    entityId,
    Object.freeze({
      ...current,
      object,
    }),
  )
}

function diagnostic(entityId: string, message: string): CollisionDiagnostic {
  return validateCollisionDiagnostic({ entityId, message })
}

export function snapshotGeometryEntities(
  registry: GeometryEntityRegistry = geometryEntityRegistry,
): GeometryEntitySnapshot {
  const entities: GeometryCollisionEntity[] = []
  const diagnostics: CollisionDiagnostic[] = []
  const registrations = [...registry.values()].sort((first, second) =>
    first.id.localeCompare(second.id),
  )

  for (const registration of registrations) {
    if (registration.object === null) {
      diagnostics.push(
        diagnostic(
          registration.id,
          `Collision Entity ${registration.id} has no live Object3D.`,
        ),
      )
      continue
    }

    try {
      registration.object.updateWorldMatrix(true, false)
      entities.push(
        validateGeometryCollisionEntity({
          id: registration.id,
          name: registration.name,
          category: registration.category,
          boxes: registration.boxes,
          worldMatrix: [...registration.object.matrixWorld.elements],
        }),
      )
    } catch (error) {
      diagnostics.push(
        diagnostic(
          registration.id,
          error instanceof Error
            ? error.message
            : `Collision Entity ${registration.id} could not be snapshotted.`,
        ),
      )
    }
  }

  return Object.freeze({
    entities: Object.freeze(entities),
    diagnostics: Object.freeze(diagnostics),
  })
}
