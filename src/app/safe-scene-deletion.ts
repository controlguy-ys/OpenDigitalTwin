import type { SceneEntityIdV1 } from '../domain/project/scene-state-v1'
import type { ExternalCollisionEntityId } from '../features/interaction/interaction-store'
import type { SceneRuntimeProjectionV1 } from '../features/scene/scene-runtime-selector'

export interface SafeSceneDeletionDependencies {
  readonly runtime: SceneRuntimeProjectionV1
  readonly getHeldEntityId: () => ExternalCollisionEntityId | null
  readonly getSceneSelection: () => SceneEntityIdV1 | null
  readonly beginRemoval: (entityId: ExternalCollisionEntityId) => boolean
  readonly endRemoval: (entityId: ExternalCollisionEntityId) => void
  readonly releaseHeldEntity: (entityId: ExternalCollisionEntityId) => Promise<void>
  readonly deleteEntity: (entityId: SceneEntityIdV1) => Promise<void>
  readonly deleteGroupAndContents: (
    groupId: `group:${string}`,
    confirmed: true,
  ) => Promise<void>
  readonly clearInteractionSelection: (entityId: ExternalCollisionEntityId) => void
  readonly clearCollisionPairs: (entityId: ExternalCollisionEntityId) => void
  readonly clearSceneSelection: () => void
}

function deletionSet(
  rootId: SceneEntityIdV1,
  runtime: SceneRuntimeProjectionV1,
): readonly SceneEntityIdV1[] {
  const root = runtime.byId.get(rootId)
  if (root === undefined) throw new Error(`Scene Entity ${rootId} is unavailable.`)
  if (root.source.kind === 'object' || root.source.kind === 'environment') return [rootId]
  if (root.source.kind !== 'group') {
    throw new Error('Only Object, Environment, and Group Scene Entities can be deleted.')
  }

  const result: SceneEntityIdV1[] = [rootId]
  for (let index = 0; index < result.length; index += 1) {
    const parentId = result[index]!
    for (const entity of runtime.entities) {
      if (entity.parentId === parentId) result.push(entity.entityId)
    }
  }
  return result
}

function isExternalEntityId(entityId: SceneEntityIdV1): entityId is ExternalCollisionEntityId {
  return entityId.startsWith('object:') || entityId.startsWith('equipment:')
}

export async function deleteSceneEntitySafely(
  entityId: SceneEntityIdV1,
  dependencies: SafeSceneDeletionDependencies,
): Promise<void> {
  const affectedIds = deletionSet(entityId, dependencies.runtime)
  const externalIds = affectedIds.filter(isExternalEntityId)
  const acquiredLocks: ExternalCollisionEntityId[] = []

  try {
    for (const externalId of externalIds) {
      if (!dependencies.beginRemoval(externalId)) {
        throw new Error('Scene Entity removal is already in progress.')
      }
      acquiredLocks.push(externalId)
    }

    const heldEntityId = dependencies.getHeldEntityId()
    if (heldEntityId !== null && externalIds.includes(heldEntityId)) {
      await dependencies.releaseHeldEntity(heldEntityId)
    }

    const entity = dependencies.runtime.byId.get(entityId)!
    if (entity.source.kind === 'group') {
      await dependencies.deleteGroupAndContents(
        entity.source.id as `group:${string}`,
        true,
      )
    } else {
      await dependencies.deleteEntity(entityId)
    }

    for (const externalId of externalIds) {
      dependencies.clearInteractionSelection(externalId)
      dependencies.clearCollisionPairs(externalId)
    }
    if (affectedIds.includes(dependencies.getSceneSelection() as SceneEntityIdV1)) {
      dependencies.clearSceneSelection()
    }
  } finally {
    for (const externalId of acquiredLocks.reverse()) {
      dependencies.endRemoval(externalId)
    }
  }
}
