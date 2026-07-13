import Dexie from 'dexie'
import { afterEach, expect, it, vi } from 'vitest'
import type { CurrentProjectSnapshot } from '../../domain/project/project'
import { CRB15000_DEFINITION, type RobotLinkId } from '../../domain/robot/crb15000'
import { ProjectDatabase } from './project-db'
import { createProjectStore, type ProjectRuntime } from './project-store'

const databases: ProjectDatabase[] = []
const names = new Set<string>()
let index = 0

function database() {
  const name = `project-store-${++index}`
  const result = new ProjectDatabase(name)
  databases.push(result)
  names.add(name)
  return result
}

function project(id: string): CurrentProjectSnapshot {
  const linkIds = [
    'LINK00', 'LINK01', 'LINK02', 'LINK03', 'LINK04', 'LINK05', 'LINK06',
  ] as const satisfies readonly RobotLinkId[]
  const transform = () => ({
    position: [0, 0, 0] as [number, number, number],
    quaternion: [0, 0, 0, 1] as [number, number, number, number],
    scale: [1, 1, 1] as [number, number, number],
  })
  return {
    manifest: {
      format: 'WebDigitalTwinProject',
      schemaVersion: 2,
      projectId: id,
      name: id,
      createdAt: '2026-07-13T00:00:00.000Z',
      updatedAt: '2026-07-13T00:00:00.000Z',
    },
    robot: {
      name: 'Robot',
      basePosition: [0, 0, 0],
      baseRotationDeg: [0, 0, 0],
      links: linkIds.map((linkId) => ({
        linkId,
        sourceFileName: `${linkId}.step`,
        sourceBytes: new Uint8Array([1]).buffer,
        localTransform: transform(),
        visible: true,
        collisionCenter: [0, 0, 0],
        collisionHalfExtents: [0.1, 0.1, 0.1],
        collisionBoxes: [{
          id: 'default',
          center: [0, 0, 0],
          halfExtents: [0.1, 0.1, 0.1],
          quaternion: [0, 0, 0, 1],
        }],
        statistics: { vertices: 3, triangles: 1, meshes: 1, materials: 1 },
      })),
      joints: CRB15000_DEFINITION.joints.map((joint) => ({
        ...joint,
        origin: [...joint.origin],
        axis: [...joint.axis],
        maxVelocityDegPerSec: 180,
      })),
    },
    frames: { mcp: transform(), tcp: transform() },
    objectAssets: [],
    objectInstances: [],
    poses: [],
    opcUa: {
      endpointUrl: 'opc.tcp://127.0.0.1:4840',
      samplingIntervalMs: 100,
      joints: CRB15000_DEFINITION.joints.map(({ id: jointId }) => ({
        id: jointId,
        nodeId: `ns=2;s=${jointId}`,
        scale: 1,
        offset: 0,
      })),
      equipment: [],
    },
    collisionPolicy: {
      enabled: true,
      warningDistanceM: 0.02,
      ignoredPairKeys: [],
      enabledRobotSelfPairs: [],
    },
  } as CurrentProjectSnapshot
}

afterEach(async () => {
  for (const item of databases.splice(0)) item.close()
  for (const name of names) await Dexie.delete(name)
  names.clear()
})

it('rejects an invalid decoded snapshot before staging or mutating active state', async () => {
  const current = project('current-project')
  const incoming = project('invalid-project')
  incoming.robot.links[0]!.collisionBoxes = []
  const db = database()
  await db.projects.put({ key: 'active', snapshot: current })
  const runtime: ProjectRuntime = {
    capture: vi.fn(async () => current),
    stage: vi.fn(async () => ({ staged: true })),
    commit: vi.fn(async () => undefined),
    dispose: vi.fn(),
  }
  const store = createProjectStore(db, runtime, {
    decode: vi.fn(async () => incoming),
    encode: vi.fn(async () => new Uint8Array([1])),
  })
  await store.getState().hydrate()

  await expect(store.getState().importProject(new Uint8Array([9]))).rejects.toThrow(
    /Robot|project/i,
  )

  expect(runtime.stage).not.toHaveBeenCalled()
  expect(runtime.commit).not.toHaveBeenCalled()
  expect(store.getState().activeProjectId).toBe('current-project')
  expect((await db.projects.get('active'))?.snapshot.manifest.projectId).toBe(
    'current-project',
  )
})

it('keeps the active project unchanged when imported geometry staging fails', async () => {
  const current = project('current-project')
  const incoming = project('incoming-project')
  const db = database()
  await db.projects.put({ key: 'active', snapshot: current })
  const runtime: ProjectRuntime = {
    capture: vi.fn(async () => current),
    stage: vi.fn(async () => {
      throw new Error('broken Object STEP')
    }),
    commit: vi.fn(async () => undefined),
    dispose: vi.fn(),
  }
  const store = createProjectStore(db, runtime, {
    decode: vi.fn(async () => incoming),
    encode: vi.fn(async () => new Uint8Array([1])),
  })
  await store.getState().hydrate()

  await expect(store.getState().importProject(new Uint8Array([9]))).rejects.toThrow(
    'broken Object STEP',
  )

  expect(store.getState().activeProjectId).toBe('current-project')
  expect(runtime.commit).not.toHaveBeenCalled()
  expect((await db.projects.get('active'))?.snapshot.manifest.projectId).toBe(
    'current-project',
  )
})
