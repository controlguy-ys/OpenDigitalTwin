import { create } from 'zustand'
import { createStore } from 'zustand/vanilla'
import type {
  EquipmentRecord,
  SerializableTransform,
  EquipmentStatus,
  EquipmentStatusSource,
} from '../../domain/equipment/equipment'
import { isEquipmentRecord } from '../../domain/equipment/equipment'
import { equipmentDb, type EquipmentDatabase } from './equipment-db'

export type EquipmentPersistenceStatus =
  | 'idle'
  | 'loading'
  | 'persistent'
  | 'memory-only'

export const EQUIPMENT_PERSISTENCE_WARNING =
  'Equipment storage is unavailable; changes will remain in memory for this session.'
export const EQUIPMENT_CORRUPT_ROW_WARNING =
  'Some saved equipment data was corrupt and was skipped. Re-import the affected equipment.'

const IDENTITY_TRANSFORM = {
  quaternion: [0, 0, 0, 1] as [number, number, number, number],
  scale: [1, 1, 1] as [number, number, number],
}

export const BUILT_IN_EQUIPMENT: readonly EquipmentRecord[] = [
  {
    id: 'cup-01',
    name: 'Cup 01',
    kind: 'cup',
    status: 'RUNNING',
    transform: {
      position: [0.75, 0, 1.15],
      quaternion: [...IDENTITY_TRANSFORM.quaternion],
      scale: [...IDENTITY_TRANSFORM.scale],
    },
    graspable: true,
    collisionHalfExtents: [0.055, 0.055, 0.075],
    stackLightAnchor: null,
  },
  {
    id: 'cup-02',
    name: 'Cup 02',
    kind: 'cup',
    status: 'WARNING',
    transform: {
      position: [0.72, -0.18, 1.15],
      quaternion: [...IDENTITY_TRANSFORM.quaternion],
      scale: [...IDENTITY_TRANSFORM.scale],
    },
    graspable: true,
    collisionHalfExtents: [0.055, 0.055, 0.075],
    stackLightAnchor: null,
  },
  {
    id: 'machine-01',
    name: 'Machine 01',
    kind: 'machine',
    status: 'RUNNING',
    transform: {
      position: [0.92, 0.35, 1.28],
      quaternion: [...IDENTITY_TRANSFORM.quaternion],
      scale: [...IDENTITY_TRANSFORM.scale],
    },
    graspable: false,
    collisionHalfExtents: [0.14, 0.12, 0.2],
    stackLightAnchor: [0, 0, 0.32],
  },
]

export interface EquipmentStoreState {
  records: readonly EquipmentRecord[]
  persistenceStatus: EquipmentPersistenceStatus
  warnings: readonly string[]
  hydrate(): Promise<void>
  upsertEquipment(record: EquipmentRecord): Promise<void>
  previewEquipmentTransform(id: string, transform: SerializableTransform): void
  commitEquipmentTransform(id: string): Promise<void>
  cancelEquipmentTransform(id: string): void
  setEquipmentStatus(id: string, status: EquipmentStatus): Promise<void>
  setEquipmentNumericStatus(id: string, value: number): Promise<void>
  setEquipmentStatusSource(id: string, source: EquipmentStatusSource): Promise<void>
  applyOpcUaEquipmentStatuses(values: Readonly<Record<string, number>>): void
  setEquipmentStatusOverlayVisible(id: string, visible: boolean): Promise<void>
  removeEquipment(id: string): Promise<void>
}

function cloneEquipmentRecord(record: EquipmentRecord): EquipmentRecord {
  return {
    id: record.id,
    name: record.name,
    kind: record.kind,
    status: record.status,
    numericStatus: record.numericStatus ?? 0,
    statusSource: record.statusSource ?? 'manual',
    statusOverlayVisible: record.statusOverlayVisible ?? true,
    transform: {
      position: [...record.transform.position],
      quaternion: [...record.transform.quaternion],
      scale: [...record.transform.scale],
    },
    graspable: record.graspable,
    collisionHalfExtents: [...record.collisionHalfExtents],
    ...(record.collisionCenter === undefined
      ? {}
      : { collisionCenter: [...record.collisionCenter] }),
    stackLightAnchor:
      record.stackLightAnchor === null
        ? null
        : [...record.stackLightAnchor],
    ...(record.assetId === undefined ? {} : { assetId: record.assetId }),
    ...(record.sourceBytes === undefined
      ? {}
      : { sourceBytes: record.sourceBytes.slice(0) }),
    ...(record.importMetadata === undefined
      ? {}
      : {
          importMetadata: {
            ...record.importMetadata,
            colliderCenter: [...record.importMetadata.colliderCenter],
          },
        }),
  }
}

function builtInRecords(): EquipmentRecord[] {
  return BUILT_IN_EQUIPMENT.map(cloneEquipmentRecord)
}

function withEquipmentTransform(
  record: EquipmentRecord,
  transform: SerializableTransform,
): EquipmentRecord {
  const nextRecord: EquipmentRecord = {
    ...record,
    transform: {
      position: [...transform.position],
      quaternion: [...transform.quaternion],
      scale: [...transform.scale],
    },
  }
  if (!isEquipmentRecord(nextRecord)) {
    throw new Error('Invalid equipment transform; no changes were applied.')
  }
  return nextRecord
}

interface PersistedRecordMergeResult {
  records: EquipmentRecord[]
  corruptRecordCount: number
}

function mergePersistedRecords(
  persistedRecords: readonly unknown[],
  deletedEquipmentIds: ReadonlySet<string> = new Set(),
): PersistedRecordMergeResult {
  const recordsById = new Map(
    builtInRecords()
      .filter((record) => !deletedEquipmentIds.has(record.id))
      .map((record) => [record.id, record]),
  )
  let corruptRecordCount = 0

  for (const record of persistedRecords) {
    try {
      if (!isEquipmentRecord(record)) {
        corruptRecordCount += 1
        continue
      }

      recordsById.set(record.id, cloneEquipmentRecord(record))
    } catch {
      corruptRecordCount += 1
    }
  }

  return { records: [...recordsById.values()], corruptRecordCount }
}

function appendWarning(
  warnings: readonly string[],
  warning: string,
): readonly string[] {
  return warnings.includes(warning) ? warnings : [...warnings, warning]
}

function createEquipmentStateCreator(database: EquipmentDatabase) {
  let hydrated = false
  let hydrationPromise: Promise<void> | null = null
  const pendingTransformPreviews = new Map<string, SerializableTransform>()
  const committedTransforms = new Map<string, SerializableTransform>()
  const deletedEquipmentIds = new Set<string>()

  const rememberCommittedTransforms = (records: readonly EquipmentRecord[]) => {
    committedTransforms.clear()
    for (const record of records) {
      committedTransforms.set(record.id, {
        position: [...record.transform.position],
        quaternion: [...record.transform.quaternion],
        scale: [...record.transform.scale],
      })
    }
  }

  return (
    set: (
      update:
        | Partial<EquipmentStoreState>
        | ((state: EquipmentStoreState) => Partial<EquipmentStoreState>),
    ) => void,
    get: () => EquipmentStoreState,
  ): EquipmentStoreState => {
    const enterMemoryOnlyMode = () => {
      set((state) => ({
        persistenceStatus: 'memory-only',
        warnings: appendWarning(
          state.warnings,
          EQUIPMENT_PERSISTENCE_WARNING,
        ),
      }))
    }

    const hydrate = (): Promise<void> => {
      if (hydrated) {
        return Promise.resolve()
      }

      if (hydrationPromise !== null) {
        return hydrationPromise
      }

      set({ persistenceStatus: 'loading' })
      hydrationPromise = (async () => {
        try {
          await database.open()
          const sceneRecord = await database.scene.get('equipment-state')
          deletedEquipmentIds.clear()
          for (const id of sceneRecord?.deletedEquipmentIds ?? []) {
            if (typeof id === 'string' && id.length > 0) {
              deletedEquipmentIds.add(id)
            }
          }
          const persistedRecords = await database.equipment.toArray()

          if (persistedRecords.length === 0) {
            const seeds = builtInRecords().filter(
              (record) => !deletedEquipmentIds.has(record.id),
            )
            await database.equipment.bulkPut(seeds)
            rememberCommittedTransforms(seeds)
            const records = seeds.map((record) => {
              const pending = pendingTransformPreviews.get(record.id)
              return pending === undefined
                ? record
                : withEquipmentTransform(record, pending)
            })
            set({
              records,
              persistenceStatus: 'persistent',
              warnings: [],
            })
          } else {
            const mergeResult = mergePersistedRecords(
              persistedRecords,
              deletedEquipmentIds,
            )
            rememberCommittedTransforms(mergeResult.records)
            const records = mergeResult.records.map((record) => {
              const pending = pendingTransformPreviews.get(record.id)
              return pending === undefined
                ? record
                : withEquipmentTransform(record, pending)
            })
            set({
              records,
              persistenceStatus: 'persistent',
              warnings:
                mergeResult.corruptRecordCount === 0
                  ? []
                  : [EQUIPMENT_CORRUPT_ROW_WARNING],
            })
          }
        } catch {
          enterMemoryOnlyMode()
        } finally {
          hydrated = true
          hydrationPromise = null
        }
      })()

      return hydrationPromise
    }

    const persistRecord = async (record: EquipmentRecord): Promise<void> => {
      if (get().persistenceStatus === 'memory-only') {
        return
      }

      try {
        await database.equipment.put(record)
      } catch {
        enterMemoryOnlyMode()
      }
    }

    const persistDeletedEquipmentIds = async (): Promise<void> => {
      if (get().persistenceStatus === 'memory-only') {
        return
      }
      try {
        await database.scene.put({
          key: 'equipment-state',
          selectedEquipmentId: null,
          deletedEquipmentIds: [...deletedEquipmentIds],
        })
      } catch {
        enterMemoryOnlyMode()
      }
    }

    return {
      records: builtInRecords(),
      persistenceStatus: 'idle',
      warnings: [],
      hydrate,
      upsertEquipment: async (record) => {
        if (!isEquipmentRecord(record)) {
          throw new Error('Invalid equipment record; no changes were saved.')
        }
        await hydrate()
        deletedEquipmentIds.delete(record.id)
        pendingTransformPreviews.delete(record.id)
        const nextRecord = cloneEquipmentRecord(record)
        committedTransforms.set(nextRecord.id, {
          position: [...nextRecord.transform.position],
          quaternion: [...nextRecord.transform.quaternion],
          scale: [...nextRecord.transform.scale],
        })
        set((state) => {
          const existingIndex = state.records.findIndex(
            ({ id }) => id === nextRecord.id,
          )
          if (existingIndex === -1) {
            return { records: [...state.records, nextRecord] }
          }

          const records = [...state.records]
          records[existingIndex] = nextRecord
          return { records }
        })
        await persistRecord(nextRecord)
        await persistDeletedEquipmentIds()
      },
      previewEquipmentTransform: (id, transform) => {
        const currentRecord = get().records.find((record) => record.id === id)
        if (currentRecord === undefined) {
          return
        }
        const nextRecord = withEquipmentTransform(currentRecord, transform)
        pendingTransformPreviews.set(id, nextRecord.transform)
        set((state) => ({
          records: state.records.map((record) =>
            record.id === id ? nextRecord : record,
          ),
        }))
      },
      commitEquipmentTransform: async (id) => {
        await hydrate()
        const currentRecord = get().records.find((record) => record.id === id)
          if (currentRecord !== undefined) {
            const pendingAtCommit = pendingTransformPreviews.get(id)
            await persistRecord(currentRecord)
            committedTransforms.set(id, {
              position: [...currentRecord.transform.position],
              quaternion: [...currentRecord.transform.quaternion],
              scale: [...currentRecord.transform.scale],
            })
            if (pendingTransformPreviews.get(id) === pendingAtCommit) {
            pendingTransformPreviews.delete(id)
          }
          }
        },
        cancelEquipmentTransform: (id) => {
          const committed = committedTransforms.get(id)
          if (committed === undefined) {
            return
          }
          pendingTransformPreviews.delete(id)
          set((state) => ({
            records: state.records.map((record) =>
              record.id === id
                ? withEquipmentTransform(record, committed)
                : record,
            ),
          }))
        },
        setEquipmentStatus: async (id, status) => {
        await hydrate()
        const currentRecord = get().records.find((record) => record.id === id)
        if (currentRecord === undefined) {
          return
        }

        const nextRecord = cloneEquipmentRecord({
          ...currentRecord,
          status,
        })
        set((state) => ({
          records: state.records.map((record) =>
            record.id === id ? nextRecord : record,
          ),
        }))
          await persistRecord(nextRecord)
        },
        setEquipmentNumericStatus: async (id, value) => {
          if (!Number.isFinite(value)) {
            throw new Error('Equipment numeric status must be finite.')
          }
          await hydrate()
          const currentRecord = get().records.find((record) => record.id === id)
          if (currentRecord === undefined) {
            return
          }
          const nextRecord = cloneEquipmentRecord({
            ...currentRecord,
            numericStatus: value,
            statusSource: 'manual',
          })
          set((state) => ({
            records: state.records.map((record) =>
              record.id === id ? nextRecord : record,
            ),
          }))
          await persistRecord(nextRecord)
        },
        setEquipmentStatusSource: async (id, source) => {
          await hydrate()
          const currentRecord = get().records.find((record) => record.id === id)
          if (currentRecord === undefined) return
          const nextRecord = cloneEquipmentRecord({
            ...currentRecord,
            statusSource: source,
          })
          set((state) => ({
            records: state.records.map((record) =>
              record.id === id ? nextRecord : record,
            ),
          }))
          await persistRecord(nextRecord)
        },
        applyOpcUaEquipmentStatuses: (values) => {
          set((state) => ({
            records: state.records.map((record) => {
              const value = values[record.id]
              return record.statusSource === 'opcua' &&
                typeof value === 'number' &&
                Number.isFinite(value)
                ? cloneEquipmentRecord({ ...record, numericStatus: value })
                : record
            }),
          }))
        },
        setEquipmentStatusOverlayVisible: async (id, visible) => {
          await hydrate()
          const currentRecord = get().records.find((record) => record.id === id)
          if (currentRecord === undefined) {
            return
          }
          const nextRecord = cloneEquipmentRecord({
            ...currentRecord,
            statusOverlayVisible: visible,
          })
          set((state) => ({
            records: state.records.map((record) =>
              record.id === id ? nextRecord : record,
            ),
          }))
          await persistRecord(nextRecord)
        },
        removeEquipment: async (id) => {
        await hydrate()
          pendingTransformPreviews.delete(id)
          committedTransforms.delete(id)
          deletedEquipmentIds.add(id)
        set((state) => ({
          records: state.records.filter((record) => record.id !== id),
        }))
        if (get().persistenceStatus === 'memory-only') {
          return
        }

          try {
            await database.equipment.delete(id)
            await persistDeletedEquipmentIds()
          } catch {
          enterMemoryOnlyMode()
        }
      },
    }
  }
}

export function createEquipmentStore(database: EquipmentDatabase) {
  return createStore<EquipmentStoreState>()(
    createEquipmentStateCreator(database),
  )
}

export const useEquipmentStore = create<EquipmentStoreState>()(
  createEquipmentStateCreator(equipmentDb),
)
