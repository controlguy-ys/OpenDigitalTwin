import { create } from 'zustand'
import { createStore } from 'zustand/vanilla'
import type { SerializableTransform } from '../../domain/equipment/equipment'
import { validateCollisionBox } from '../../domain/collision/collision'
import type {
  ProjectCollisionBoxV2,
  RobotLinkGeometryRecordV1,
  RobotLinkGeometryRecordV2,
} from '../../domain/project/project'
import {
  MAX_ASSET_MATERIALS,
  MAX_ASSET_MESHES,
  MAX_ROBOT_BYTES,
  MAX_ROBOT_LINK_BYTES,
  MAX_ROBOT_LINK_TRIANGLES,
  MAX_ROBOT_TRIANGLES,
  MAX_COLLISION_BOXES_PER_ENTITY,
} from '../../domain/project/project'
import type { RobotLinkId } from '../../domain/robot/crb15000'
import { robotGeometryDb, type RobotGeometryDatabase } from './robot-geometry-db'

const LINK_IDS = [
  'LINK00', 'LINK01', 'LINK02', 'LINK03', 'LINK04', 'LINK05', 'LINK06',
] as const satisfies readonly RobotLinkId[]

export interface RobotGeometryStoreState {
  links: readonly RobotLinkGeometryRecordV2[]
  persistenceStatus: 'idle' | 'loading' | 'persistent' | 'memory-only'
  hydrate(): Promise<void>
  replaceRobot(links: readonly RobotLinkGeometryRecordV2[]): Promise<void>
  replaceLink(link: RobotLinkGeometryRecordV2): Promise<void>
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

function validateCollisionBoxes(boxes: readonly ProjectCollisionBoxV2[]): void {
  if (!Array.isArray(boxes) || boxes.length === 0) {
    throw new Error('Robot Link must contain at least one collision Box.')
  }
  if (boxes.length > MAX_COLLISION_BOXES_PER_ENTITY) {
    throw new Error(`Robot Link cannot exceed ${MAX_COLLISION_BOXES_PER_ENTITY} collision Boxes.`)
  }
  const ids = new Set<string>()
  boxes.forEach((box) => {
    validateCollisionBox(box)
    if (ids.has(box.id)) throw new Error(`Duplicate collision Box id: ${box.id}.`)
    ids.add(box.id)
  })
}

function validateLink(link: RobotLinkGeometryRecordV2): void {
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
  validateCollisionBoxes(link.collisionBoxes)
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

function validateRobot(links: readonly RobotLinkGeometryRecordV2[]): void {
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

function cloneCollisionBox(box: ProjectCollisionBoxV2): ProjectCollisionBoxV2 {
  const normalized = validateCollisionBox(box)
  return {
    id: normalized.id,
    center: [...normalized.center],
    halfExtents: [...normalized.halfExtents],
    quaternion: [...normalized.quaternion],
  }
}

function migrateLegacyLink(
  link: RobotLinkGeometryRecordV1 | RobotLinkGeometryRecordV2,
): RobotLinkGeometryRecordV2 {
  if (Object.prototype.hasOwnProperty.call(link, 'collisionBoxes')) {
    return link as RobotLinkGeometryRecordV2
  }
  return {
    ...link,
    collisionBoxes: [{
      id: 'default',
      center: [...link.collisionCenter],
      halfExtents: [...link.collisionHalfExtents],
      quaternion: [0, 0, 0, 1],
    }],
  }
}

function cloneLink(link: RobotLinkGeometryRecordV2): RobotLinkGeometryRecordV2 {
  const collisionBoxes = link.collisionBoxes.map(cloneCollisionBox)
  const first = collisionBoxes[0]!
  return {
    ...link,
    sourceBytes: link.sourceBytes.slice(0),
    localTransform: cloneTransform(link.localTransform),
    collisionCenter: [...first.center],
    collisionHalfExtents: [...first.halfExtents],
    collisionBoxes,
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
    const persistLink = async (link: RobotLinkGeometryRecordV2) => {
      if (get().persistenceStatus === 'memory-only') return
      try {
        await database.links.put(link)
      } catch {
        set({ persistenceStatus: 'memory-only' })
      }
    }
    const updateLink = async (
      linkId: RobotLinkId,
      update: (link: RobotLinkGeometryRecordV2) => RobotLinkGeometryRecordV2,
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
          const storedLinks = await database.links.toArray()
          const requiresMigration = storedLinks.some(
            (link) =>
              !Object.prototype.hasOwnProperty.call(link, 'collisionBoxes'),
          )
          const links = storedLinks.map(migrateLegacyLink)
          if (links.length > 0) validateRobot(links)
          const next = links
            .map(cloneLink)
            .sort((a, b) => a.linkId.localeCompare(b.linkId))
          if (requiresMigration) {
            await database.transaction('rw', database.links, async () => {
              await database.links.clear()
              await database.links.bulkAdd(next)
            })
          }
          set({
            links: next,
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
        updateLink(linkId, (link) => {
          const first = link.collisionBoxes[0]!
          return {
            ...link,
            collisionCenter,
            collisionHalfExtents,
            collisionBoxes: [
              {
                ...first,
                center: [...collisionCenter],
                halfExtents: [...collisionHalfExtents],
              },
              ...link.collisionBoxes.slice(1),
            ],
          }
        }),
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
