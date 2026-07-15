import type { ObjectAssetRecordV2, ObjectInstanceRecordV1 } from '../../domain/project/project'
import type {
  ByteFreeObjectAssetRecordV3,
  ObjectInstanceRecordV3,
  PreparedProjectSourceGroupV1,
} from '../../domain/project/project-v3'
import type {
  SceneEntityIdV1,
  SceneEntityV1,
  ScenePoseV1,
} from '../../domain/project/scene-state-v1'
import {
  reparentSceneEntityPreservingWorld,
  setSceneEntityWorldPose,
} from '../../domain/scene/scene-transform'
import type { StoredWorkcellProjectSnapshotProjectionV3 } from '../project/project-db'
import type { ProjectMutationService } from '../project/project-mutation-service'

export interface ImportStepObjectInputV1 {
  readonly asset: ObjectAssetRecordV2
  readonly instance: ObjectInstanceRecordV1
  readonly graspable: boolean
}

export interface StagedStepObjectSourceV1 {
  readonly sourceSha256: string
  readonly preparedSourceGroup: PreparedProjectSourceGroupV1
}

export interface CreateBoxObjectInputV1 {
  readonly name: string
  readonly dimensionsM: readonly [number, number, number]
  readonly color: `#${string}`
}

export interface CreateCylinderObjectInputV1 {
  readonly name: string
  readonly radiusM: number
  readonly heightM: number
  readonly color: `#${string}`
}

export interface SceneCommandWarningV1 {
  readonly code: 'STEP_ASSET_WARNING' | 'OBJECT_INSTANCE_WARNING'
  readonly current: number
  readonly limit: number
}

export interface SceneCommandService {
  importStepObject(input: ImportStepObjectInputV1): Promise<`object:${string}`>
  createGroup(name: string): Promise<`group:${string}`>
  createBox(input: CreateBoxObjectInputV1): Promise<`object:${string}`>
  createCylinder(input: CreateCylinderObjectInputV1): Promise<`object:${string}`>
  duplicateObject(entityId: SceneEntityIdV1): Promise<`object:${string}`>
  rename(entityId: SceneEntityIdV1, name: string): Promise<void>
  setVisible(entityId: SceneEntityIdV1, visible: boolean): Promise<void>
  setLocalPose(entityId: SceneEntityIdV1, pose: ScenePoseV1): Promise<void>
  setWorldPose(entityId: SceneEntityIdV1, pose: ScenePoseV1): Promise<void>
  reparent(entityId: SceneEntityIdV1, parentId: SceneEntityIdV1 | null): Promise<void>
  ungroup(groupId: `group:${string}`): Promise<void>
  deleteGroupAndContents(groupId: `group:${string}`, confirmed?: boolean): Promise<void>
  deleteEntity(entityId: SceneEntityIdV1): Promise<void>
  updateObjectInstance(
    entityId: `object:${string}`,
    update: Readonly<{
      numericStatus?: number
      statusSource?: 'manual' | 'opcua'
      statusOverlayVisible?: boolean
    }>,
  ): Promise<void>
  updateBuiltInEquipment(
    entityId: `equipment:${string}`,
    update: Readonly<{
      numericStatus?: number
      statusSource?: 'manual' | 'opcua'
      statusOverlayVisible?: boolean
    }>,
  ): Promise<void>
}

export interface SceneCommandServiceOptions {
  readonly mutationService: Pick<ProjectMutationService, 'replaceFromActive' | 'readPublished'>
  readonly stageStepSource?: (
    sourceBytes: ArrayBuffer,
    ownerKey: `object-asset:${string}`,
  ) => Promise<StagedStepObjectSourceV1>
  readonly createId?: () => string
  readonly onWarning?: (warning: SceneCommandWarningV1) => void
}

const IDENTITY_POSE: ScenePoseV1 = {
  positionM: [0, 0, 0],
  quaternion: [0, 0, 0, 1],
}

function activeSnapshot(options: SceneCommandServiceOptions): StoredWorkcellProjectSnapshotProjectionV3 {
  const published = options.mutationService.readPublished()
  if (published === null) throw new Error('PROJECT_ACTIVE_REVISION_MISSING: No V3 Project is active.')
  return published.snapshot as unknown as StoredWorkcellProjectSnapshotProjectionV3
}

function entityIn(
  current: StoredWorkcellProjectSnapshotProjectionV3,
  entityId: SceneEntityIdV1,
): SceneEntityV1 {
  const entity = current.scene.entities.find(({ id }) => id === entityId)
  if (entity === undefined) throw new Error(`SCENE_ENTITY_MISSING: ${entityId} does not exist.`)
  return entity
}

function replaceEntity(
  current: StoredWorkcellProjectSnapshotProjectionV3,
  entityId: SceneEntityIdV1,
  update: (entity: SceneEntityV1) => SceneEntityV1,
): StoredWorkcellProjectSnapshotProjectionV3 {
  entityIn(current, entityId)
  return {
    ...current,
    scene: {
      ...current.scene,
      entities: current.scene.entities.map((entity) => entity.id === entityId
        ? update(entity)
        : entity),
    },
  }
}

function collisionPairReferences(pair: string, entityId: string): boolean {
  return pair.split('|').includes(entityId)
}

function mountContactReferencesEntity(reference: string | null, entityId: string): boolean {
  return reference === entityId ||
    reference?.startsWith(`${entityId}/`) === true ||
    reference?.startsWith(`${entityId}\u0000`) === true
}

function assertDeletable(
  current: StoredWorkcellProjectSnapshotProjectionV3,
  entityId: SceneEntityIdV1,
): SceneEntityV1 {
  if (entityId === 'robot:active') throw new Error('ROBOT_DELETE_UNAVAILABLE: Robot deletion is unavailable.')
  const entity = entityIn(current, entityId)
  const axis = current.scene.entities.find(({ kind }) => kind === 'linear-axis')
  if (
    axis?.kind === 'linear-axis' &&
    axis.carriageEntityId === entityId
  ) {
    throw new Error('SCENE_AXIS_ATTACHMENT_DELETE_BLOCKED: Detach the Entity before deletion.')
  }
  return entity
}

function assertGroupCommandAvailable(
  current: StoredWorkcellProjectSnapshotProjectionV3,
  groupId: `group:${string}`,
): Extract<SceneEntityV1, { kind: 'group' }> {
  const group = entityIn(current, groupId)
  if (group.kind !== 'group') throw new Error(`SCENE_GROUP_REQUIRED: ${groupId} is not a Group.`)
  const axis = current.scene.entities.find(({ kind }) => kind === 'linear-axis')
  if (axis?.kind === 'linear-axis' && axis.carriageEntityId === groupId) {
    throw new Error('SCENE_AXIS_CARRIAGE_ATTACHED: Detach the Group before this command.')
  }
  return group
}

function deleteEntities(
  current: StoredWorkcellProjectSnapshotProjectionV3,
  entityIds: ReadonlySet<SceneEntityIdV1>,
): StoredWorkcellProjectSnapshotProjectionV3 {
  const objectInstanceIds = new Set<string>()
  const builtInIds = new Set<string>()
  for (const entity of current.scene.entities) {
    if (!entityIds.has(entity.id) || entity.kind !== 'object') continue
    if (entity.target.kind === 'object-instance') objectInstanceIds.add(entity.target.id)
    else builtInIds.add(entity.target.id)
  }
  const removedAssetIds = new Set(current.objectInstances
    .filter(({ id }) => objectInstanceIds.has(id))
    .map(({ assetId }) => assetId))
  const objectInstances = current.objectInstances.filter(({ id }) => !objectInstanceIds.has(id))
  const usedAssetIds = new Set(objectInstances.map(({ assetId }) => assetId))
  return {
    ...current,
    scene: {
      ...current.scene,
      entities: current.scene.entities.filter(({ id }) => !entityIds.has(id)),
      robotMountContact: current.scene.robotMountContact === null ||
        ![...entityIds].some((id) => mountContactReferencesEntity(
          current.scene.robotMountContact?.mountSurfaceCollisionEntityId ?? null,
          id,
        ))
        ? current.scene.robotMountContact
        : {
            ...current.scene.robotMountContact,
            mountSurfaceCollisionEntityId: null,
          },
    },
    objectInstances,
    objectAssets: current.objectAssets.filter(({ id }) =>
      !removedAssetIds.has(id) || usedAssetIds.has(id)),
    builtInEquipment: current.builtInEquipment.filter(({ id }) => !builtInIds.has(id)),
    opcUa: {
      ...current.opcUa,
      numericStatusBindings: current.opcUa.numericStatusBindings
        .filter(({ entityId }) => !entityIds.has(entityId)),
      equipmentTransforms: current.opcUa.equipmentTransforms
        .filter(({ entityId }) => !entityIds.has(entityId)),
    },
    collisionPolicy: {
      ...current.collisionPolicy,
      ignoredPairKeys: current.collisionPolicy.ignoredPairKeys
        .filter((pair) => ![...entityIds].some((id) => collisionPairReferences(pair, id))),
    },
  }
}

function thresholdWarnings(
  options: SceneCommandServiceOptions,
  counts: Readonly<{ stepAssetCount?: number; instanceCount?: number }>,
): void {
  if (counts.stepAssetCount === 52) {
    options.onWarning?.({ code: 'STEP_ASSET_WARNING', current: 52, limit: 64 })
  }
  if (counts.instanceCount === 205) {
    options.onWarning?.({ code: 'OBJECT_INSTANCE_WARNING', current: 205, limit: 256 })
  }
}

export function createSceneCommandService(
  options: SceneCommandServiceOptions,
): SceneCommandService {
  const createId = options.createId ?? (() => crypto.randomUUID())
  const mutate = options.mutationService.replaceFromActive.bind(options.mutationService)
  const preflightGroup = (groupId: `group:${string}`) => {
    const current = activeSnapshot(options)
    assertGroupCommandAvailable(current, groupId)
    return current
  }

  const createPrimitive = async (
    request:
      | Readonly<{ kind: 'box'; input: CreateBoxObjectInputV1 }>
      | Readonly<{ kind: 'cylinder'; input: CreateCylinderObjectInputV1 }>,
  ): Promise<`object:${string}`> => {
    const { input, kind } = request
    const id = createId()
    const entityId = `object:${id}` as const
    const assetId = `asset-${id}`
    const halfExtents: readonly [number, number, number] = kind === 'box'
      ? request.input.dimensionsM.map((value) => value / 2) as [number, number, number]
      : [input.radiusM, input.radiusM, input.heightM / 2]
    if (halfExtents.some((value) => !Number.isFinite(value) || value <= 0)) {
      throw new Error('SCENE_PRIMITIVE_DIMENSIONS_INVALID: Primitive dimensions must be positive and finite.')
    }
    await mutate((current) => {
      if (
        current.objectAssets.some(({ id: candidate }) => candidate === assetId) ||
        current.objectInstances.some(({ id: candidate }) => candidate === id) ||
        current.scene.entities.some(({ id: candidate }) => candidate === entityId)
      ) {
        throw new Error(`SCENE_ENTITY_DUPLICATE: ${entityId} already exists.`)
      }
      thresholdWarnings(
        options,
        { instanceCount: current.objectInstances.length + 1 },
      )
      const geometry = {
        id: assetId,
        name: input.name.trim(),
        colliderCenter: [0, 0, 0] as const,
        collisionHalfExtents: halfExtents,
        collisionBoxes: [{
          id: 'primitive-body', center: [0, 0, 0] as const,
          halfExtents, quaternion: [0, 0, 0, 1] as const,
        }],
        statistics: kind === 'box'
          ? { vertices: 24, triangles: 12, meshes: 1, materials: 1 }
          : { vertices: 196, triangles: 128, meshes: 1, materials: 1 },
      }
      const asset: ByteFreeObjectAssetRecordV3 = kind === 'box'
        ? {
            ...geometry,
            sourceKind: 'box' as const,
            dimensionsM: [...request.input.dimensionsM] as [number, number, number],
            color: input.color.toUpperCase() as `#${string}`,
          }
        : {
            ...geometry,
            sourceKind: 'cylinder' as const,
            radiusM: input.radiusM,
            heightM: input.heightM,
            axis: 'z' as const,
            radialSegments: 32 as const,
            color: input.color.toUpperCase() as `#${string}`,
          }
      const instance: ObjectInstanceRecordV3 = {
        id, assetId, name: input.name.trim(), manualNumericStatus: 0,
        statusSource: 'manual', statusOverlayVisible: true,
        scale: [1, 1, 1], graspable: false,
      }
      const entity: SceneEntityV1 = {
        kind: 'object', id: entityId, name: input.name.trim(),
        parentId: null, localPose: IDENTITY_POSE, visible: true,
        target: { kind: 'object-instance', id },
        transformSource: 'manual',
      }
      return {
        ...current,
        objectAssets: [...current.objectAssets, asset],
        objectInstances: [...current.objectInstances, instance],
        scene: { ...current.scene, entities: [...current.scene.entities, entity] },
      }
    })
    return entityId
  }

  const service: SceneCommandService = {
    async importStepObject(input) {
      if (options.stageStepSource === undefined) {
        throw new Error('PROJECT_SOURCE_STAGING_REQUIRED: STEP import requires Project source staging.')
      }
      const ownerKey = `object-asset:${input.asset.id}` as const
      const staged = await options.stageStepSource(input.asset.sourceBytes, ownerKey)
      await mutate((current) => {
        if (current.objectAssets.some(({ id }) => id === input.asset.id)) {
          throw new Error(`OBJECT_ASSET_DUPLICATE: ${input.asset.id} already exists.`)
        }
        if (
          current.objectInstances.some(({ id }) => id === input.instance.id) ||
          current.scene.entities.some(({ id }) => id === `object:${input.instance.id}`)
        ) {
          throw new Error(`OBJECT_INSTANCE_DUPLICATE: ${input.instance.id} already exists.`)
        }
        const stepAssetCount = current.objectAssets.filter((asset) => asset.sourceKind === 'step').length + 1
        const instanceCount = current.objectInstances.length + 1
        thresholdWarnings(options, { stepAssetCount, instanceCount })
        const { sourceBytes: _sourceBytes, ...asset } = input.asset
        const nextAsset: ByteFreeObjectAssetRecordV3 = {
          ...asset,
          sourceKind: 'step',
          sourceSha256: staged.sourceSha256,
        }
        const nextInstance: ObjectInstanceRecordV3 = {
          id: input.instance.id,
          assetId: input.instance.assetId,
          name: input.instance.name,
          manualNumericStatus: input.instance.numericStatus,
          statusSource: input.instance.statusSource,
          statusOverlayVisible: input.instance.statusOverlayVisible,
          scale: [...input.instance.transform.scale],
          graspable: input.graspable,
        }
        const nextEntity: SceneEntityV1 = {
          kind: 'object',
          id: `object:${input.instance.id}`,
          name: input.instance.name,
          parentId: null,
          localPose: {
            positionM: [...input.instance.transform.position],
            quaternion: [...input.instance.transform.quaternion],
          },
          visible: input.instance.visible,
          target: { kind: 'object-instance', id: input.instance.id },
          transformSource: 'manual',
        }
        return {
          ...current,
          objectAssets: [...current.objectAssets, nextAsset],
          objectInstances: [...current.objectInstances, nextInstance],
          scene: {
            ...current.scene,
            entities: [...current.scene.entities, nextEntity],
          },
        }
      }, [staged.preparedSourceGroup])
      return `object:${input.instance.id}` as const
    },

    async createGroup(name) {
      const id = `group:${createId()}` as const
      await mutate((current) => {
        if (current.scene.entities.some((entity) => entity.id === id)) {
          throw new Error(`SCENE_ENTITY_DUPLICATE: ${id} already exists.`)
        }
        return {
          ...current,
          scene: { ...current.scene, entities: [...current.scene.entities, {
          kind: 'group' as const, id, name: name.trim(), parentId: null,
          localPose: IDENTITY_POSE, visible: true,
          }] },
        }
      })
      return id
    },

    async createBox(input) {
      return createPrimitive({ kind: 'box', input })
    },

    async createCylinder(input) {
      return createPrimitive({ kind: 'cylinder', input })
    },

    async duplicateObject(entityId) {
      const publishedEntity = entityIn(activeSnapshot(options), entityId)
      if (publishedEntity.kind !== 'object' || publishedEntity.target.kind !== 'object-instance') {
        throw new Error('SCENE_DUPLICATE_OBJECT_REQUIRED: Only imported Objects can be duplicated.')
      }
      const instanceId = createId()
      const duplicateId = `object:${instanceId}` as const
      await mutate((active) => {
        const entity = entityIn(active, entityId)
        if (entity.kind !== 'object' || entity.target.kind !== 'object-instance') {
          throw new Error('SCENE_DUPLICATE_OBJECT_REQUIRED: Only imported Objects can be duplicated.')
        }
        const instance = active.objectInstances.find(({ id }) => id === entity.target.id)
        if (instance === undefined) throw new Error('SCENE_TARGET_MISSING: Object Instance is missing.')
        if (
          active.objectInstances.some(({ id }) => id === instanceId) ||
          active.scene.entities.some(({ id }) => id === duplicateId)
        ) {
          throw new Error(`OBJECT_INSTANCE_DUPLICATE: ${instanceId} already exists.`)
        }
        thresholdWarnings(
          options,
          { instanceCount: active.objectInstances.length + 1 },
        )
        return {
          ...active,
          objectInstances: [...active.objectInstances, {
            ...instance,
            id: instanceId,
            name: `${instance.name} Copy`,
            statusSource: 'manual',
          }],
          scene: { ...active.scene, entities: [...active.scene.entities, {
            ...entity, id: duplicateId, name: `${entity.name} Copy`,
            target: { kind: 'object-instance' as const, id: instanceId },
            transformSource: 'manual',
          }] },
        }
      })
      return duplicateId
    },

    async rename(entityId, name) {
      await mutate((current) => replaceEntity(current, entityId, (entity) => ({ ...entity, name: name.trim() })))
    },

    async setVisible(entityId, visible) {
      await mutate((current) => replaceEntity(current, entityId, (entity) => ({ ...entity, visible })))
    },

    async setLocalPose(entityId, pose) {
      await mutate((current) => replaceEntity(current, entityId, (entity) => ({ ...entity, localPose: pose })))
    },

    async setWorldPose(entityId, pose) {
      await mutate((current) => ({
        ...current,
        scene: setSceneEntityWorldPose(current.scene, entityId, pose),
      }))
    },

    async reparent(entityId, parentId) {
      await mutate((current) => ({
        ...current,
        scene: reparentSceneEntityPreservingWorld(current.scene, entityId, parentId),
      }))
    },

    async ungroup(groupId) {
      preflightGroup(groupId)
      await mutate((current) => {
        assertGroupCommandAvailable(current, groupId)
        let scene = current.scene
        for (const member of scene.entities.filter(({ parentId }) => parentId === groupId)) {
          scene = reparentSceneEntityPreservingWorld(scene, member.id, null)
        }
        return { ...current, scene: {
          ...scene,
          entities: scene.entities.filter(({ id }) => id !== groupId),
        } }
      })
    },

    async deleteGroupAndContents(groupId, confirmed = false) {
      if (!confirmed) throw new Error('SCENE_DELETE_CONFIRMATION_REQUIRED: Confirm Group contents deletion.')
      preflightGroup(groupId)
      await mutate((current) => {
        assertGroupCommandAvailable(current, groupId)
        const ids = new Set<SceneEntityIdV1>([groupId])
        for (const entity of current.scene.entities) {
          if (entity.parentId === groupId) ids.add(entity.id)
        }
        return deleteEntities(current, ids)
      })
    },

    async deleteEntity(entityId) {
      if (entityId === 'robot:active') {
        throw new Error('ROBOT_DELETE_UNAVAILABLE: Robot deletion is unavailable.')
      }
      const publishedEntity = assertDeletable(activeSnapshot(options), entityId)
      if (publishedEntity.kind === 'group') {
        throw new Error('SCENE_GROUP_DELETE_COMMAND_REQUIRED: Use a Group deletion command.')
      }
      if (publishedEntity.kind === 'linear-axis') {
        throw new Error('SCENE_AXIS_DELETE_UNAVAILABLE: Linear Axis deletion is unavailable in this stage.')
      }
      await mutate((active) => {
        const entity = assertDeletable(active, entityId)
        if (entity.kind === 'group') {
          throw new Error('SCENE_GROUP_DELETE_COMMAND_REQUIRED: Use a Group deletion command.')
        }
        if (entity.kind === 'linear-axis') {
          throw new Error('SCENE_AXIS_DELETE_UNAVAILABLE: Linear Axis deletion is unavailable in this stage.')
        }
        return deleteEntities(active, new Set([entityId]))
      })
    },

    async updateObjectInstance(entityId, update) {
      await mutate((current) => {
        const entity = entityIn(current, entityId)
        if (entity.kind !== 'object' || entity.target.kind !== 'object-instance') {
          throw new Error('SCENE_OBJECT_INSTANCE_REQUIRED: Object Instance Entity is required.')
        }
        const index = current.objectInstances.findIndex(({ id }) => id === entity.target.id)
        if (index < 0) throw new Error('SCENE_TARGET_MISSING: Object Instance is missing.')
        const previous = current.objectInstances[index]!
        const next: ObjectInstanceRecordV3 = {
          ...previous,
          ...(update.numericStatus === undefined
            ? {}
            : { manualNumericStatus: update.numericStatus }),
          ...(update.statusSource === undefined ? {} : { statusSource: update.statusSource }),
          ...(update.statusOverlayVisible === undefined
            ? {}
            : { statusOverlayVisible: update.statusOverlayVisible }),
        }
        return {
          ...current,
          objectInstances: current.objectInstances.map((instance, candidateIndex) =>
            candidateIndex === index ? next : instance),
        }
      })
    },

    async updateBuiltInEquipment(entityId, update) {
      await mutate((current) => {
        const entity = entityIn(current, entityId)
        if (entity.kind !== 'object' || entity.target.kind !== 'built-in-equipment') {
          throw new Error('SCENE_BUILT_IN_EQUIPMENT_REQUIRED: Built-in Equipment Entity is required.')
        }
        const index = current.builtInEquipment.findIndex(({ id }) => id === entity.target.id)
        if (index < 0) throw new Error('SCENE_TARGET_MISSING: Built-in Equipment is missing.')
        const previous = current.builtInEquipment[index]!
        const next = {
          ...previous,
          ...(update.numericStatus === undefined
            ? {}
            : { manualNumericStatus: update.numericStatus }),
          ...(update.statusSource === undefined ? {} : { statusSource: update.statusSource }),
          ...(update.statusOverlayVisible === undefined
            ? {}
            : { statusOverlayVisible: update.statusOverlayVisible }),
        }
        return {
          ...current,
          builtInEquipment: current.builtInEquipment.map((record, candidateIndex) =>
            candidateIndex === index ? next : record),
        }
      })
    },
  }
  return Object.freeze(service)
}
