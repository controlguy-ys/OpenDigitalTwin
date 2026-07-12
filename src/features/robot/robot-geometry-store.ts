import { create } from 'zustand'
import { createStore } from 'zustand/vanilla'
import type { SerializableTransform } from '../../domain/equipment/equipment'
import type { RobotLinkGeometryRecordV1 } from '../../domain/project/project'
import {
  MAX_ASSET_MATERIALS,
  MAX_ASSET_MESHES,
  MAX_ROBOT_BYTES,
  MAX_ROBOT_LINK_BYTES,
  MAX_ROBOT_LINK_TRIANGLES,
  MAX_ROBOT_TRIANGLES,
} from '../../domain/project/project'
import type { RobotLinkId } from '../../domain/robot/crb15000'
import { robotGeometryDb, type RobotGeometryDatabase } from './robot-geometry-db'

const LINK_IDS = [
  'LINK00', 'LINK01', 'LINK02', 'LINK03', 'LINK04', 'LINK05', 'LINK06',
] as const satisfies readonly RobotLinkId[]

export interface RobotGeometryStoreState {
  links: readonly RobotLinkGeometryRecordV1[]
  persistenceStatus: 'idle' | 'loading' | 'persistent' | 'memory-only'
  hydrate(): Promise<void>
  replaceRobot(links: readonly RobotLinkGeometryRecordV1[]): Promise<void>
  replaceLink(link: RobotLinkGeometryRecordV1): Promise<void>
  setLocalTransform(linkId: RobotLinkId, transform: SerializableTransform): Promise<void>
  setVisible(linkId: RobotLinkId, visible: boolean): Promise<void>
  setCollision(
    linkId: RobotLinkId,
    center: [number, number, number],
    halfExtents: [number, number, number],
  ): Promise<void>
  clear(): Promise<void>
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
    value.some((entry) => !Number.isFinite(entry) || (positive && entry <= 0))
  ) {
    throw new Error(`${label} must contain ${length} finite numbers.`)
  }
}

function validateLink(link: RobotLinkGeometryRecordV1): void {
  if (!LINK_IDS.includes(link.linkId)) throw new Error('Robot Link id is invalid.')
  if (link.sourceFileName.trim() === '') throw new Error(`${link.linkId} filename is required.`)
  if (
    Object.prototype.toString.call(link.sourceBytes) !== '[object ArrayBuffer]' ||
    link.sourceBytes.byteLength === 0 ||
    link.sourceBytes.byteLength > MAX_ROBOT_LINK_BYTES
  ) {
    throw new Error(`${link.linkId} STEP bytes are invalid or exceed 25 MiB.`)
  }
  finiteTuple(link.localTransform.position, 3, `${link.linkId} local position`)
  finiteTuple(link.localTransform.quaternion, 4, `${link.linkId} local quaternion`)
  if (Math.hypot(...link.localTransform.quaternion) <= 1e-9) {
    throw new Error(`${link.linkId} local quaternion cannot be zero.`)
  }
  finiteTuple(link.localTransform.scale, 3, `${link.linkId} local scale`, true)
  if (typeof link.visible !== 'boolean') throw new Error(`${link.linkId} visibility is invalid.`)
  finiteTuple(link.collisionCenter, 3, `${link.linkId} collision center`)
  finiteTuple(link.collisionHalfExtents, 3, `${link.linkId} collision extents`, true)
  const { vertices, triangles, meshes, materials } = link.statistics
  if (
    [vertices, triangles, meshes, materials].some(
      (value) => !Number.isSafeInteger(value) || value < 0,
    ) ||
    triangles > MAX_ROBOT_LINK_TRIANGLES ||
    meshes > MAX_ASSET_MESHES ||
    materials > MAX_ASSET_MATERIALS
  ) {
    throw new Error(`${link.linkId} geometry exceeds the supported budget.`)
  }
}

function validateRobot(links: readonly RobotLinkGeometryRecordV1[]): void {
  if (links.length !== LINK_IDS.length) {
    throw new Error('A new Robot import requires exactly seven Link STEP files.')
  }
  const ids = new Set<RobotLinkId>()
  let bytes = 0
  let triangles = 0
  links.forEach((link) => {
    validateLink(link)
    if (ids.has(link.linkId)) throw new Error(`Duplicate Robot Link ${link.linkId}.`)
    ids.add(link.linkId)
    bytes += link.sourceBytes.byteLength
    triangles += link.statistics.triangles
  })
  if (LINK_IDS.some((id) => !ids.has(id))) {
    throw new Error('A new Robot import requires exactly seven unique Links.')
  }
  if (bytes > MAX_ROBOT_BYTES) throw new Error('Robot STEP bytes exceed 100 MiB.')
  if (triangles > MAX_ROBOT_TRIANGLES) throw new Error('Robot triangles exceed 600,000.')
}

function cloneTransform(transform: SerializableTransform): SerializableTransform {
  return {
    position: [...transform.position],
    quaternion: [...transform.quaternion],
    scale: [...transform.scale],
  }
}

function cloneLink(link: RobotLinkGeometryRecordV1): RobotLinkGeometryRecordV1 {
  return {
    ...link,
    sourceBytes: link.sourceBytes.slice(0),
    localTransform: cloneTransform(link.localTransform),
    collisionCenter: [...link.collisionCenter],
    collisionHalfExtents: [...link.collisionHalfExtents],
    statistics: { ...link.statistics },
  }
}

function createRobotGeometryState(database: RobotGeometryDatabase) {
  let hydrated = false
  let hydrationPromise: Promise<void> | null = null
  return (
    set: (
      update:
        | Partial<RobotGeometryStoreState>
        | ((state: RobotGeometryStoreState) => Partial<RobotGeometryStoreState>),
    ) => void,
    get: () => RobotGeometryStoreState,
  ): RobotGeometryStoreState => {
    const persistLink = async (link: RobotLinkGeometryRecordV1) => {
      if (get().persistenceStatus === 'memory-only') return
      try {
        await database.links.put(link)
      } catch {
        set({ persistenceStatus: 'memory-only' })
      }
    }
    const updateLink = async (
      linkId: RobotLinkId,
      update: (link: RobotLinkGeometryRecordV1) => RobotLinkGeometryRecordV1,
    ) => {
      await get().hydrate()
      const current = get().links.find((link) => link.linkId === linkId)
      if (current === undefined) throw new Error(`Robot Link ${linkId} is not configured.`)
      const next = cloneLink(update(current))
      validateLink(next)
      set((state) => ({
        links: state.links.map((link) => (link.linkId === linkId ? next : link)),
      }))
      await persistLink(next)
    }
    const hydrate = (): Promise<void> => {
      if (hydrated) return Promise.resolve()
      if (hydrationPromise !== null) return hydrationPromise
      set({ persistenceStatus: 'loading' })
      hydrationPromise = (async () => {
        try {
          await database.open()
          const links = await database.links.toArray()
          if (links.length > 0) validateRobot(links)
          set({
            links: links.map(cloneLink).sort((a, b) => a.linkId.localeCompare(b.linkId)),
            persistenceStatus: 'persistent',
          })
        } catch {
          set({ persistenceStatus: 'memory-only' })
        } finally {
          hydrated = true
          hydrationPromise = null
        }
      })()
      return hydrationPromise
    }
    return {
      links: [],
      persistenceStatus: 'idle',
      hydrate,
      replaceRobot: async (links) => {
        validateRobot(links)
        await hydrate()
        const next = links.map(cloneLink).sort((a, b) => a.linkId.localeCompare(b.linkId))
        if (get().persistenceStatus !== 'memory-only') {
          await database.transaction('rw', database.links, async () => {
            await database.links.clear()
            await database.links.bulkAdd(next)
          })
        }
        set({ links: next })
      },
      replaceLink: async (link) => {
        validateLink(link)
        await hydrate()
        if (get().links.length !== LINK_IDS.length) {
          throw new Error('Import a complete seven-Link Robot before replacing one Link.')
        }
        await updateLink(link.linkId, () => link)
      },
      setLocalTransform: (linkId, localTransform) =>
        updateLink(linkId, (link) => ({ ...link, localTransform })),
      setVisible: (linkId, visible) =>
        updateLink(linkId, (link) => ({ ...link, visible })),
      setCollision: (linkId, collisionCenter, collisionHalfExtents) =>
        updateLink(linkId, (link) => ({
          ...link,
          collisionCenter,
          collisionHalfExtents,
        })),
      clear: async () => {
        await hydrate()
        if (get().persistenceStatus !== 'memory-only') await database.links.clear()
        set({ links: [] })
      },
    }
  }
}

export function createRobotGeometryStore(database: RobotGeometryDatabase) {
  return createStore<RobotGeometryStoreState>()(createRobotGeometryState(database))
}

export const useRobotGeometryStore = create<RobotGeometryStoreState>()(
  createRobotGeometryState(robotGeometryDb),
)
