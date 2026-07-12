import Dexie from 'dexie'
import { afterEach, expect, it, vi } from 'vitest'
import type { WorkcellProjectSnapshotV1 } from '../../domain/project/project'
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

function project(id: string): WorkcellProjectSnapshotV1 {
  return {
    manifest: {
      format: 'WebDigitalTwinProject',
      schemaVersion: 1,
      projectId: id,
      name: id,
      createdAt: '2026-07-13T00:00:00.000Z',
      updatedAt: '2026-07-13T00:00:00.000Z',
    },
  } as WorkcellProjectSnapshotV1
}

afterEach(async () => {
  for (const item of databases.splice(0)) item.close()
  for (const name of names) await Dexie.delete(name)
  names.clear()
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
