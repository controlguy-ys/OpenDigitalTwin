import { expect, it, vi } from 'vitest'
import type { WorkcellProjectSnapshotV3 } from '../../domain/project/project-v3'
import type { ProjectDecodeResultV3 } from './project-codec'
import type { ProjectMutationService } from './project-mutation-service'
import { repositoryProjectFixture } from './project-revision-repository.test-support'
import { createProjectStore } from './project-store'

function mutationService(snapshot: WorkcellProjectSnapshotV3 | null = null): ProjectMutationService {
  let published = snapshot === null ? null : {
    revisionId: 'revision-a',
    snapshot,
    generation: 1,
  }
  return {
    replaceFromActive: vi.fn(async () => undefined),
    replacePreparedUntrusted: vi.fn(async () => undefined),
    hydrate: vi.fn(async () => undefined),
    readPublished: vi.fn(() => published),
    isRecoveryRequired: vi.fn(() => false),
    subscribe: vi.fn(() => () => undefined),
  }
}

it('exports the active V3 revision without recapturing feature stores', async () => {
  const snapshot = await repositoryProjectFixture({ name: 'Active V3' })
  const service = mutationService(snapshot)
  const createNew = vi.fn()
  const stageNew = vi.fn()
  const encode = vi.fn(async () => new Blob([new Uint8Array([3])]))
  const store = createProjectStore({
    mutationService: service,
    createNew,
    stageNew,
    decode: vi.fn(),
    encode,
  })

  await store.getState().exportActiveProject()

  expect(createNew).not.toHaveBeenCalled()
  expect(stageNew).not.toHaveBeenCalled()
  expect(encode).toHaveBeenCalledWith(snapshot)
})

it.each([1, 2])('rejects superseded schema version %s without mutation', async (schemaVersion) => {
  const snapshot = await repositoryProjectFixture({ name: 'Active V3' })
  const service = mutationService(snapshot)
  const error = Object.assign(
    new Error(`Project schema ${schemaVersion} is unsupported.`),
    { code: 'PROJECT_SCHEMA_UNSUPPORTED' },
  )
  const store = createProjectStore({
    mutationService: service,
    createNew: vi.fn(),
    stageNew: vi.fn(),
    decode: vi.fn(async () => { throw error }),
    encode: vi.fn(),
  })

  await expect(store.getState().importProject(new Uint8Array([schemaVersion])))
    .rejects.toMatchObject({ code: 'PROJECT_SCHEMA_UNSUPPORTED' })

  expect(service.replacePreparedUntrusted).not.toHaveBeenCalled()
  expect(store.getState()).toMatchObject({
    activeProjectName: 'Active V3',
    status: 'ready',
  })
})

it('publishes New through one prepared V3 mutation', async () => {
  const snapshot = await repositoryProjectFixture({ name: 'New V3' })
  const decoded = {
    projection: {} as ProjectDecodeResultV3['projection'],
    preparedSourceGroups: [],
    warnings: [],
  } satisfies ProjectDecodeResultV3
  const service = mutationService()
  const store = createProjectStore({
    mutationService: service,
    createNew: vi.fn(async () => snapshot),
    stageNew: vi.fn(async () => decoded),
    decode: vi.fn(),
    encode: vi.fn(),
  })

  await store.getState().newProject()

  expect(service.replacePreparedUntrusted).toHaveBeenCalledWith(decoded)
})
