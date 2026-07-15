import { create } from 'zustand'
import { createStore } from 'zustand/vanilla'
import type {
  ObjectAssetRecordV1,
  ObjectAssetRecordV2,
  ObjectInstanceRecordV1,
  ProjectCollisionBoxV2,
} from '../../domain/project/project'
import type { ObjectAssetRecordV3 } from '../../domain/project/object-asset-v3'
import { validateCollisionBox } from '../../domain/collision/collision'
import type { SerializableTransform } from '../../domain/equipment/equipment'
import {
  MAX_ASSET_MATERIALS,
  MAX_ASSET_MESHES,
  MAX_OBJECT_ASSET_BYTES,
  MAX_OBJECT_ASSET_TRIANGLES,
  MAX_COLLISION_BOXES_PER_ENTITY,
} from '../../domain/project/project'
import {
  objectAssetDb,
  type ObjectAssetDatabase,
} from './object-asset-db'

export type ObjectAssetPersistenceStatus =
  | 'idle'
  | 'loading'
  | 'persistent'
  | 'memory-only'

export const OBJECT_ASSET_PERSISTENCE_WARNING =
  'Object Asset storage is unavailable; changes will remain in memory for this session.'

export type ObjectAssetReadModelV3 = ObjectAssetRecordV2 | ObjectAssetRecordV3
export type ObjectInstanceReadModelV3 = ObjectInstanceRecordV1 & {
  readonly graspable?: boolean
}

export interface ObjectAssetStoreState {
  assets: readonly ObjectAssetReadModelV3[]
  instances: readonly ObjectInstanceReadModelV3[]
  persistenceStatus: ObjectAssetPersistenceStatus
  warnings: readonly string[]
  hydrate(): Promise<void>
  addAssetInstance(
    asset: ObjectAssetRecordV2,
    instance: ObjectInstanceRecordV1,
  ): Promise<void>
  replaceProject(
    assets: readonly ObjectAssetRecordV2[],
    instances: readonly ObjectInstanceRecordV1[],
  ): Promise<void>
  upsertAsset(asset: ObjectAssetRecordV2): Promise<void>
  createInstance(instance: ObjectInstanceRecordV1): Promise<void>
  updateInstance(instance: ObjectInstanceRecordV1): Promise<void>
  previewInstanceTransform(id: string, transform: SerializableTransform): void
  commitInstanceTransform(id: string): Promise<void>
  cancelInstanceTransform(id: string): void
  applyOpcUaStatuses(values: Readonly<Record<string, number>>): void
  removeInstance(id: string): Promise<void>
  removeAsset(id: string): Promise<void>
}

function nonEmpty(value: string, label: string): void {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${label} is required.`)
  }
}

function finiteTuple(
  value: readonly number[],
  length: number,
  label: string,
  positive = false,
): void {
  if (
    !Array.isArray(value) ||
    value.length !== length ||
    value.some(
      (entry) =>
        !Number.isFinite(entry) || (positive && entry <= 0),
    )
  ) {
    throw new Error(`${label} must contain ${length} ${positive ? 'positive ' : ''}finite numbers.`)
  }
}

function validateCollisionBoxes(boxes: readonly ProjectCollisionBoxV2[]): void {
  if (!Array.isArray(boxes) || boxes.length === 0) {
    throw new Error('Object Asset must contain at least one collision Box.')
  }
  if (boxes.length > MAX_COLLISION_BOXES_PER_ENTITY) {
    throw new Error(`Object Asset cannot exceed ${MAX_COLLISION_BOXES_PER_ENTITY} collision Boxes.`)
  }
  const ids = new Set<string>()
  boxes.forEach((box) => {
    validateCollisionBox(box)
    if (ids.has(box.id)) throw new Error(`Duplicate collision Box id: ${box.id}.`)
    ids.add(box.id)
  })
}

function validateAsset(asset: ObjectAssetRecordV2): void {
  nonEmpty(asset.id, 'Object Asset id')
  nonEmpty(asset.name, 'Object Asset name')
  nonEmpty(asset.sourceFileName, 'Object Asset source filename')
  if (
    Object.prototype.toString.call(asset.sourceBytes) !== '[object ArrayBuffer]' ||
    asset.sourceBytes.byteLength === 0 ||
    asset.sourceBytes.byteLength > MAX_OBJECT_ASSET_BYTES
  ) {
    throw new Error('Object Asset STEP bytes are invalid or exceed 50 MiB.')
  }
  if (!Number.isFinite(asset.importScale) || asset.importScale <= 0) {
    throw new Error('Object Asset import scale must be positive.')
  }
  if (asset.originMode !== 'center' && asset.originMode !== 'source') {
    throw new Error('Object Asset origin mode is unsupported.')
  }
  finiteTuple(asset.collisionHalfExtents, 3, 'Object Asset collision half extents', true)
  finiteTuple(asset.colliderCenter, 3, 'Object Asset collider center')
  validateCollisionBoxes(asset.collisionBoxes)
  const { vertices, triangles, meshes, materials } = asset.statistics
  if (
    [vertices, triangles, meshes, materials].some(
      (value) => !Number.isSafeInteger(value) || value < 0,
    ) ||
    triangles > MAX_OBJECT_ASSET_TRIANGLES ||
    meshes > MAX_ASSET_MESHES ||
    materials > MAX_ASSET_MATERIALS
  ) {
    throw new Error('Object Asset geometry statistics exceed the supported budget.')
  }
}

function validateInstance(instance: ObjectInstanceRecordV1): void {
  nonEmpty(instance.id, 'Object Instance id')
  nonEmpty(instance.assetId, 'Object Instance Asset id')
  nonEmpty(instance.name, 'Object Instance name')
  finiteTuple(instance.transform.position, 3, 'Object Instance position')
  finiteTuple(instance.transform.quaternion, 4, 'Object Instance quaternion')
  if (Math.hypot(...instance.transform.quaternion) <= 1e-9) {
    throw new Error('Object Instance quaternion cannot be zero.')
  }
  finiteTuple(instance.transform.scale, 3, 'Object Instance scale', true)
  if (!Number.isFinite(instance.numericStatus)) {
    throw new Error('Object Instance numeric status must be finite.')
  }
  if (instance.statusSource !== 'manual' && instance.statusSource !== 'opcua') {
    throw new Error('Object Instance status source is unsupported.')
  }
  if (
    typeof instance.statusOverlayVisible !== 'boolean' ||
    typeof instance.visible !== 'boolean'
  ) {
    throw new Error('Object Instance visibility flags must be boolean.')
  }
}

function cloneCollisionBox(box: ProjectCollisionBoxV2): ProjectCollisionBoxV2 {
  const normalized = validateCollisionBox(box)
  return {
    id: normalized.id,
    center: [...normalized.center],
    halfExtents: [...normalized.halfExtents],
    quaternion: [...normalized.quaternion],
  }
}

function migrateLegacyAsset(
  asset: ObjectAssetRecordV1 | ObjectAssetRecordV2,
): ObjectAssetRecordV2 {
  if (Object.prototype.hasOwnProperty.call(asset, 'collisionBoxes')) {
    return asset as ObjectAssetRecordV2
  }
  return {
    ...asset,
    collisionBoxes: [{
      id: 'default',
      center: [...asset.colliderCenter],
      halfExtents: [...asset.collisionHalfExtents],
      quaternion: [0, 0, 0, 1],
    }],
  }
}

function cloneAsset(asset: ObjectAssetRecordV2): ObjectAssetRecordV2 {
  const collisionBoxes = asset.collisionBoxes.map(cloneCollisionBox)
  const first = collisionBoxes[0]!
  return {
    ...asset,
    sourceBytes: asset.sourceBytes.slice(0),
    colliderCenter: [...first.center],
    collisionHalfExtents: [...first.halfExtents],
    collisionBoxes,
    statistics: { ...asset.statistics },
  }
}

function cloneInstance(instance: ObjectInstanceRecordV1): ObjectInstanceRecordV1 {
  return {
    ...instance,
    transform: {
      position: [...instance.transform.position],
      quaternion: [...instance.transform.quaternion],
      scale: [...instance.transform.scale],
    },
  }
}

function cloneTransform(transform: SerializableTransform): SerializableTransform {
  return {
    position: [...transform.position],
    quaternion: [...transform.quaternion],
    scale: [...transform.scale],
  }
}

function replaceById<T extends { id: string }>(
  records: readonly T[],
  next: T,
): T[] {
  const index = records.findIndex(({ id }) => id === next.id)
  if (index === -1) return [...records, next]
  const result = [...records]
  result[index] = next
  return result
}

export interface ObjectAssetStoreOptions {
  readonly mode?: 'durable-cache' | 'published-read-model'
}

function createObjectAssetState(
  database: ObjectAssetDatabase,
  options: ObjectAssetStoreOptions = {},
) {
  const publishedReadModel = options.mode === 'published-read-model'
  const requireProjectCommand = (): void => {
    if (publishedReadModel) {
      throw new Error('PROJECT_V3_COMMAND_REQUIRED: Mutate durable Object state through SceneCommandService.')
    }
  }
  let hydrated = false
  let hydrationPromise: Promise<void> | null = null
  const committedTransforms = new Map<string, SerializableTransform>()
  const pendingTransforms = new Set<string>()

  return (
    set: (
      update:
        | Partial<ObjectAssetStoreState>
        | ((state: ObjectAssetStoreState) => Partial<ObjectAssetStoreState>),
    ) => void,
    get: () => ObjectAssetStoreState,
  ): ObjectAssetStoreState => {
    const memoryOnly = () =>
      set((state) => ({
        persistenceStatus: 'memory-only',
        warnings: state.warnings.includes(OBJECT_ASSET_PERSISTENCE_WARNING)
          ? state.warnings
          : [...state.warnings, OBJECT_ASSET_PERSISTENCE_WARNING],
      }))

    const hydrate = (): Promise<void> => {
      if (hydrated) return Promise.resolve()
      if (hydrationPromise !== null) return hydrationPromise
      if (publishedReadModel) {
        hydrated = true
        set({ persistenceStatus: 'memory-only', warnings: [] })
        return Promise.resolve()
      }
      set({ persistenceStatus: 'loading' })
      hydrationPromise = (async () => {
        try {
          await database.open()
          const [storedAssets, instances] = await database.transaction(
            'r',
            database.assets,
            database.instances,
            () => Promise.all([
              database.assets.toArray(),
              database.instances.toArray(),
            ]),
          )
          const requiresMigration = storedAssets.some(
            (asset) =>
              !Object.prototype.hasOwnProperty.call(asset, 'collisionBoxes'),
          )
          const assets = storedAssets.map(migrateLegacyAsset)
          assets.forEach(validateAsset)
          const assetIds = new Set(assets.map(({ id }) => id))
          instances.forEach((instance) => {
            validateInstance(instance)
            if (!assetIds.has(instance.assetId)) {
              throw new Error(`Object Instance ${instance.id} references a missing Asset.`)
            }
          })
          const nextAssets = assets.map(cloneAsset)
          const nextInstances = instances.map(cloneInstance)
          if (requiresMigration) {
            await database.transaction('rw', database.assets, async () => {
              await database.assets.clear()
              await database.assets.bulkAdd(nextAssets)
            })
          }
          committedTransforms.clear()
          nextInstances.forEach((instance) => {
            committedTransforms.set(instance.id, cloneTransform(instance.transform))
          })
          set({
            assets: nextAssets,
            instances: nextInstances,
            persistenceStatus: 'persistent',
            warnings: [],
          })
        } catch {
          memoryOnly()
        } finally {
          hydrated = true
          hydrationPromise = null
        }
      })()
      return hydrationPromise
    }

    return {
      assets: [],
      instances: [],
      persistenceStatus: 'idle',
      warnings: [],
      hydrate,
      addAssetInstance: async (asset, instance) => {
        requireProjectCommand()
        validateAsset(asset)
        validateInstance(instance)
        if (instance.assetId !== asset.id) {
          throw new Error('Object Instance must reference the imported Object Asset.')
        }
        await hydrate()
        if (get().assets.some(({ id }) => id === asset.id)) {
          throw new Error(`Object Asset ${asset.id} already exists.`)
        }
        if (get().instances.some(({ id }) => id === instance.id)) {
          throw new Error(`Object Instance ${instance.id} already exists.`)
        }
        const nextAsset = cloneAsset(asset)
        const nextInstance = cloneInstance(instance)
        if (get().persistenceStatus !== 'memory-only') {
          await database.transaction(
            'rw',
            database.assets,
            database.instances,
            async () => {
              await database.assets.add(nextAsset)
              await database.instances.add(nextInstance)
            },
          )
        }
        set((state) => ({
          assets: [...state.assets, nextAsset],
          instances: [...state.instances, nextInstance],
        }))
        committedTransforms.set(nextInstance.id, cloneTransform(nextInstance.transform))
      },
      replaceProject: async (assets, instances) => {
        assets.forEach(validateAsset)
        instances.forEach(validateInstance)
        const assetIds = new Set(assets.map(({ id }) => id))
        if (assetIds.size !== assets.length) {
          throw new Error('Object Asset ids must be unique.')
        }
        if (new Set(instances.map(({ id }) => id)).size !== instances.length) {
          throw new Error('Object Instance ids must be unique.')
        }
        if (instances.some(({ assetId }) => !assetIds.has(assetId))) {
          throw new Error('Every Object Instance must reference a project Asset.')
        }
        await hydrate()
        const nextAssets = assets.map(cloneAsset)
        const nextInstances = instances.map(cloneInstance)
        if (get().persistenceStatus !== 'memory-only') {
          await database.transaction(
            'rw',
            database.assets,
            database.instances,
            async () => {
              await database.assets.clear()
              await database.instances.clear()
              await database.assets.bulkAdd(nextAssets)
              await database.instances.bulkAdd(nextInstances)
            },
          )
        }
        committedTransforms.clear()
        pendingTransforms.clear()
        nextInstances.forEach((instance) =>
          committedTransforms.set(instance.id, cloneTransform(instance.transform)),
        )
        set({ assets: nextAssets, instances: nextInstances })
      },
      upsertAsset: async (asset) => {
        requireProjectCommand()
        validateAsset(asset)
        await hydrate()
        const next = cloneAsset(asset)
        set((state) => ({ assets: replaceById(state.assets, next) }))
        if (get().persistenceStatus !== 'memory-only') {
          try {
            await database.assets.put(next)
          } catch {
            memoryOnly()
          }
        }
      },
      createInstance: async (instance) => {
        requireProjectCommand()
        validateInstance(instance)
        await hydrate()
        if (!get().assets.some(({ id }) => id === instance.assetId)) {
          throw new Error(`Object Instance references missing Object Asset ${instance.assetId}.`)
        }
        if (get().instances.some(({ id }) => id === instance.id)) {
          throw new Error(`Object Instance ${instance.id} already exists.`)
        }
        const next = cloneInstance(instance)
        committedTransforms.set(next.id, cloneTransform(next.transform))
        set((state) => ({ instances: [...state.instances, next] }))
        if (get().persistenceStatus !== 'memory-only') {
          try {
            await database.instances.add(next)
          } catch (error) {
            set((state) => ({
              instances: state.instances.filter(({ id }) => id !== next.id),
            }))
            throw error
          }
        }
      },
      updateInstance: async (instance) => {
        requireProjectCommand()
        validateInstance(instance)
        await hydrate()
        if (!get().assets.some(({ id }) => id === instance.assetId)) {
          throw new Error(`Object Instance references missing Object Asset ${instance.assetId}.`)
        }
        if (!get().instances.some(({ id }) => id === instance.id)) {
          throw new Error(`Object Instance ${instance.id} does not exist.`)
        }
        const next = cloneInstance(instance)
        committedTransforms.set(next.id, cloneTransform(next.transform))
        pendingTransforms.delete(next.id)
        set((state) => ({ instances: replaceById(state.instances, next) }))
        if (get().persistenceStatus !== 'memory-only') {
          try {
            await database.instances.put(next)
          } catch {
            memoryOnly()
          }
        }
      },
      previewInstanceTransform: (id, transform) => {
        requireProjectCommand()
        finiteTuple(transform.position, 3, 'Object Instance position')
        finiteTuple(transform.quaternion, 4, 'Object Instance quaternion')
        finiteTuple(transform.scale, 3, 'Object Instance scale', true)
        pendingTransforms.add(id)
        set((state) => ({
          instances: state.instances.map((instance) =>
            instance.id === id
              ? { ...instance, transform: cloneTransform(transform) }
              : instance,
          ),
        }))
      },
      commitInstanceTransform: async (id) => {
        requireProjectCommand()
        await hydrate()
        const instance = get().instances.find((candidate) => candidate.id === id)
        if (instance === undefined) return
        const next = cloneInstance(instance)
        if (get().persistenceStatus !== 'memory-only') {
          try {
            await database.instances.put(next)
          } catch {
            memoryOnly()
          }
        }
        committedTransforms.set(id, cloneTransform(next.transform))
        pendingTransforms.delete(id)
      },
      cancelInstanceTransform: (id) => {
        requireProjectCommand()
        const transform = committedTransforms.get(id)
        if (transform === undefined) return
        pendingTransforms.delete(id)
        set((state) => ({
          instances: state.instances.map((instance) =>
            instance.id === id
              ? { ...instance, transform: cloneTransform(transform) }
              : instance,
          ),
        }))
      },
      applyOpcUaStatuses: (values) => {
        set((state) => ({
          instances: state.instances.map((instance) => {
            const value = values[instance.id]
            return instance.statusSource === 'opcua' &&
              typeof value === 'number' &&
              Number.isFinite(value)
              ? { ...instance, numericStatus: value }
              : instance
          }),
        }))
      },
      removeInstance: async (id) => {
        requireProjectCommand()
        await hydrate()
        set((state) => ({
          instances: state.instances.filter((instance) => instance.id !== id),
        }))
        committedTransforms.delete(id)
        pendingTransforms.delete(id)
        if (get().persistenceStatus !== 'memory-only') {
          try {
            await database.instances.delete(id)
          } catch {
            memoryOnly()
          }
        }
      },
      removeAsset: async (id) => {
        requireProjectCommand()
        await hydrate()
        if (get().instances.some(({ assetId }) => assetId === id)) {
          throw new Error('Object Asset cannot be deleted while Instances reference it.')
        }
        set((state) => ({
          assets: state.assets.filter((asset) => asset.id !== id),
        }))
        if (get().persistenceStatus !== 'memory-only') {
          try {
            await database.assets.delete(id)
          } catch {
            memoryOnly()
          }
        }
      },
    }
  }
}

export function createObjectAssetStore(
  database: ObjectAssetDatabase,
  options: ObjectAssetStoreOptions = {},
) {
  return createStore<ObjectAssetStoreState>()(createObjectAssetState(database, options))
}

export const useObjectAssetStore = create<ObjectAssetStoreState>()(
  createObjectAssetState(objectAssetDb, { mode: 'published-read-model' }),
)
