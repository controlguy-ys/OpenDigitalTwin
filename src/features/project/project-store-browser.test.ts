import { afterEach, describe, expect, it } from 'vitest'

import { ProjectV4Error } from '../../core/project-v4/index.js'
import { createBrowserProjectFileCommandPortV4 } from './v4/project-file-command-port.js'
import { createBrowserUserPromptPortV4 } from '../ui/v4/user-prompt-port.js'
import { ProjectDatabaseV4 } from './v4/project-v4-db.js'
import {
  createBrowserProjectResourcesV4,
  type BrowserProjectResourcesV4,
} from './project-store-browser.js'

const databases: ProjectDatabaseV4[] = []

function createDatabase(): ProjectDatabaseV4 {
  const database = new ProjectDatabaseV4(
    'browser-project-v4-' + crypto.randomUUID(),
  )
  databases.push(database)
  return database
}

function deterministicIds(): () => string {
  let id = 0
  return () => 'browser-id-' + String(++id)
}

function createResources(
  database = createDatabase(),
): BrowserProjectResourcesV4 {
  return createBrowserProjectResourcesV4({
    database,
    nowIso: () => '2026-07-17T00:00:00.000Z',
    createId: deterministicIds(),
    resolveDefinitionGeometry: async () => null,
    animationScheduler: {
      now: () => 0,
      request: () => 1,
      cancel: () => undefined,
    },
  })
}

function runtimeRevisionIds(resources: BrowserProjectResourcesV4): unknown[] {
  return [
    resources.runtimeBundle.getState().projectRevisionId,
    resources.robots.getState().projectRevisionId,
    resources.jobs.getState().projectRevisionId,
    resources.scene.getState().projectRevisionId,
    resources.interaction.getState().projectRevisionId,
    resources.coordinateDisplay.getState().projectRevisionId,
  ]
}

function expectProjectError(action: () => unknown, code: string): void {
  let error: unknown
  try {
    action()
  } catch (caught) {
    error = caught
  }
  expect(error).toBeInstanceOf(ProjectV4Error)
  expect((error as ProjectV4Error).code).toBe(code)
}

afterEach(async () => {
  for (const database of databases.splice(0)) {
    database.close()
    await database.delete()
  }
})

describe('browser Project V4 resource root', () => {
  it('owns independent injectable Project-file and User-prompt ports', () => {
    const first = createResources()
    const second = createResources()
    const projectFiles = createBrowserProjectFileCommandPortV4()
    const userPrompt = createBrowserUserPromptPortV4({ prompt: () => null })
    const injected = createBrowserProjectResourcesV4({
      database: createDatabase(),
      nowIso: () => '2026-07-17T00:00:00.000Z',
      createId: deterministicIds(),
      resolveDefinitionGeometry: async () => null,
      animationScheduler: { now: () => 0, request: () => 1, cancel: () => undefined },
      projectFiles,
      userPrompt,
    })

    expect(first.projectFiles).not.toBe(second.projectFiles)
    expect(first.userPrompt).not.toBe(second.userPrompt)
    expect(injected.projectFiles).toBe(projectFiles)
    expect(injected.userPrompt).toBe(userPrompt)
  })

  it('publishes New through one revision-qualified public resource graph', async () => {
    const resources = createResources()

    await resources.projectStore.getState().newProject()

    const project = resources.projectStore.getState().activeProject
    expect(project).not.toBeNull()
    expect(runtimeRevisionIds(resources)).toEqual(
      Array(6).fill(project!.revisionId),
    )
    expect(resources.geometry.readCurrent(
      project!.robotDefinitions[0]!.id,
    )?.resolution).toBe('UNRESOLVED')
  })

  it('keeps the replacement Job revision after disposing the prior runtime', async () => {
    const resources = createResources()
    await resources.projectStore.getState().newProject()
    const firstRevision = resources.projectStore.getState().activeProject!.revisionId

    await resources.projectStore.getState().newProject()

    const secondRevision = resources.projectStore.getState().activeProject!.revisionId
    expect(secondRevision).not.toBe(firstRevision)
    expect(runtimeRevisionIds(resources)).toEqual(Array(6).fill(secondRevision))
  })

  it('makes a retained prior executor terminal after Project replacement', async () => {
    const resources = createResources()
    await resources.projectStore.getState().newProject()
    const oldExecutor = resources.runtimeBundle.getState().active!.jobs.executor

    await resources.projectStore.getState().newProject()
    const replacement = resources.projectStore.getState().activeProject!
    const jobsBeforeStaleCalls = resources.jobs.getState()

    expectProjectError(
      () => oldExecutor.startJob('job-default', 0),
      'JOB_EXECUTOR_DISPOSED',
    )
    await expect(oldExecutor.advanceAll(0)).rejects.toMatchObject({
      code: 'JOB_EXECUTOR_DISPOSED',
    })
    expectProjectError(
      () => oldExecutor.cancelRobotJob('robot-default', 'stale runtime'),
      'JOB_EXECUTOR_DISPOSED',
    )
    expect(resources.jobs.getState()).toBe(jobsBeforeStaleCalls)
    expect(runtimeRevisionIds(resources)).toEqual(Array(6).fill(replacement.revisionId))
  })

  it('settles a prior runtime waiter during Project replacement without publishing it', async () => {
    const resources = createResources()
    await resources.projectStore.getState().newProject()
    const oldExecutor = resources.runtimeBundle.getState().active!.jobs.executor
    const { runId } = oldExecutor.startJob('job-default', 25)
    const waiter = oldExecutor.waitForTerminal(runId)

    await resources.projectStore.getState().newProject()
    const replacement = resources.projectStore.getState().activeProject!
    const outcome = await Promise.race([
      waiter,
      Promise.resolve(null),
    ])

    expect(outcome).toMatchObject({
      runId,
      state: 'CANCELLED',
      completedAtSimulationMs: 25,
      message: 'Project runtime disposed.',
    })
    expect(resources.jobs.getState().projectRevisionId).toBe(replacement.revisionId)
    expect(resources.jobs.getState().byRobotId['robot-default']).toMatchObject({
      state: 'IDLE',
      runId: null,
    })
  })

  it('restores the stable target through a fresh browser resource root', async () => {
    const database = createDatabase()
    const first = createResources(database)
    await first.projectStore.getState().newProject()
    const revisionId = first.projectStore.getState().activeProject!.revisionId

    const second = createResources(database)
    await second.projectStore.getState().hydrate()

    expect(second.projectStore.getState().activeProject?.revisionId).toBe(
      revisionId,
    )
    expect(runtimeRevisionIds(second)).toEqual(Array(6).fill(revisionId))
  })

  it('keeps every public resource on the newest consecutive replacement', async () => {
    const resources = createResources()

    await resources.projectStore.getState().newProject()
    const firstRevisionId = resources.projectStore.getState().activeProject!
      .revisionId
    await resources.projectStore.getState().newProject()
    const secondRevisionId = resources.projectStore.getState().activeProject!
      .revisionId

    expect(secondRevisionId).not.toBe(firstRevisionId)
    expect(runtimeRevisionIds(resources)).toEqual(
      Array(6).fill(secondRevisionId),
    )
  })

  it('exports only gated V4 resources and command boundaries', () => {
    const resources = createResources()

    expect(resources.shellLayoutStore.getState().preferences).toMatchObject({
      version: 1,
      bottom: { activeTab: 'timeline' },
      theme: 'system',
    })

    expect(Object.keys(resources).sort()).toEqual([
      'coordinateDisplay',
      'geometry',
      'interaction',
      'jobCommands',
      'jobs',
      'mutations',
      'projectFiles',
      'projectStore',
      'robotImport',
      'robots',
      'runtimeBundle',
      'scene',
      'sceneCommands',
      'shellLayoutStore',
      'userPrompt',
      'viewportPreferences',
    ])
    expect(resources).not.toHaveProperty('rawRobots')
    expect(resources).not.toHaveProperty('rawGeometry')
    expect(resources).not.toHaveProperty('projectStoreV3')
  })
})
