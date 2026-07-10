import { create } from 'zustand'
import { createStore } from 'zustand/vanilla'
import type {
  EquipmentRecord,
  EquipmentStatus,
} from '../../domain/equipment/equipment'
import { equipmentDb, type EquipmentDatabase } from './equipment-db'

export type EquipmentPersistenceStatus =
  | 'idle'
  | 'loading'
  | 'persistent'
  | 'memory-only'

export const EQUIPMENT_PERSISTENCE_WARNING =
  'Equipment storage is unavailable; changes will remain in memory for this session.'

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
  setEquipmentStatus(id: string, status: EquipmentStatus): Promise<void>
}

function cloneEquipmentRecord(record: EquipmentRecord): EquipmentRecord {
  return {
    id: record.id,
    name: record.name,
    kind: record.kind,
    status: record.status,
    transform: {
      position: [...record.transform.position],
      quaternion: [...record.transform.quaternion],
      scale: [...record.transform.scale],
    },
    graspable: record.graspable,
    collisionHalfExtents: [...record.collisionHalfExtents],
    stackLightAnchor:
      record.stackLightAnchor === null
        ? null
        : [...record.stackLightAnchor],
    ...(record.sourceBytes === undefined
      ? {}
      : { sourceBytes: record.sourceBytes.slice(0) }),
  }
}

function builtInRecords(): EquipmentRecord[] {
  return BUILT_IN_EQUIPMENT.map(cloneEquipmentRecord)
}

function mergePersistedRecords(
  persistedRecords: readonly EquipmentRecord[],
): EquipmentRecord[] {
  const recordsById = new Map(
    builtInRecords().map((record) => [record.id, record]),
  )

  for (const record of persistedRecords) {
    recordsById.set(record.id, cloneEquipmentRecord(record))
  }

  return [...recordsById.values()]
}

function createEquipmentStateCreator(database: EquipmentDatabase) {
  let hydrated = false
  let hydrationPromise: Promise<void> | null = null

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
        warnings: state.warnings.includes(EQUIPMENT_PERSISTENCE_WARNING)
          ? state.warnings
          : [...state.warnings, EQUIPMENT_PERSISTENCE_WARNING],
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
          const persistedRecords = await database.equipment.toArray()

          if (persistedRecords.length === 0) {
            const seeds = builtInRecords()
            await database.equipment.bulkPut(seeds)
            set({
              records: seeds,
              persistenceStatus: 'persistent',
              warnings: [],
            })
          } else {
            set({
              records: mergePersistedRecords(persistedRecords),
              persistenceStatus: 'persistent',
              warnings: [],
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
        await database.equipment.put(cloneEquipmentRecord(record))
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
        await hydrate()
        const nextRecord = cloneEquipmentRecord(record)
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
