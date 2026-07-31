import { describe, expect, it, vi } from 'vitest'
import { createStore } from 'zustand/vanilla'

import { validateWorkcellProjectV5, type RobotJobInstructionV1, type WorkcellProjectV5 } from '../../../core/project-v5/index.js'
import { createLogicalIoJobSampleV5, LOGICAL_IO_JOB_SAMPLE_IDS_V5 } from '../../project/v5/logical-io-job-sample-v5.js'
import type { JobRuntimeStoreV5 } from '../v5/job-runtime-store.js'
import { createJobAuthoringServiceV6 } from './job-authoring-service-v6.js'

function runtime(state: 'IDLE' | 'RUNNING') {
  return createStore<JobRuntimeStoreV5>()(() => ({ projectRevisionId: null, configRevision: null, byRobotId: { [LOGICAL_IO_JOB_SAMPLE_IDS_V5.robotId]: { robotId: LOGICAL_IO_JOB_SAMPLE_IDS_V5.robotId, jobId: state === 'RUNNING' ? LOGICAL_IO_JOB_SAMPLE_IDS_V5.jobId : null, runId: state === 'RUNNING' ? 'run' : null, state, stepIndex: state === 'RUNNING' ? 0 : null, startedAtSimulationMs: state === 'RUNNING' ? 0 : null, completedAtSimulationMs: null, failureCode: null, message: '' } }, replaceProject: vi.fn(), reset: vi.fn(), setRobotState: vi.fn() }))
}

function delay(id: string, durationMs = 100): RobotJobInstructionV1 {
  return { id, kind: 'delay', durationMs }
}

function onlyJob(project: WorkcellProjectV5) {
  const job = project.jobs[0]
  if (job === undefined) throw new Error('Expected the logical I/O fixture Job.')
  return job
}

function authoringHarness() {
  let project: WorkcellProjectV5 = createLogicalIoJobSampleV5({ projectId: 'author-project', revisionId: 'author-r1', nowIso: '2026-07-30T00:00:00.000Z' })
  let revision = 1
  const mutate = vi.fn(async (request: { readonly expectedRevisionId: string; readonly recipe: (active: WorkcellProjectV5) => WorkcellProjectV5 }) => {
    expect(request.expectedRevisionId).toBe(project.revisionId)
    const candidate = request.recipe(project)
    revision += 1
    project = { ...candidate, revisionId: `author-r${revision}` }
  })
  const service = createJobAuthoringServiceV6({ mutations: { readPublished: () => ({ project, revisionId: project.revisionId }), mutate }, runtime: runtime('IDLE'), createInstructionId: (() => {
    const ids = ['move-1', 'fresh-instruction']
    return () => ids.shift() ?? 'later-instruction'
  })() })
  return { get project() { return project }, mutate, service }
}

describe('JobAuthoringServiceV6', () => {
  it('keeps the exact instruction order for reorder, insert, replace, duplicate, and remove against successive revisions', async () => {
    const harness = authoringHarness()
    const jobId = onlyJob(harness.project).id
    const original = onlyJob(harness.project).instructions.map((instruction) => instruction.id)
    const first = original[0]
    const second = original[1]
    if (first === undefined || second === undefined) throw new Error('Expected two fixture instructions.')

    await harness.service.reorder(jobId, second, first)
    expect(onlyJob(harness.project).instructions.slice(0, 2).map((instruction) => instruction.id)).toEqual([second, first])
    await harness.service.insert(jobId, delay('inserted'), first)
    expect(onlyJob(harness.project).instructions.slice(0, 3).map((instruction) => instruction.id)).toEqual([second, 'inserted', first])
    await harness.service.replace(jobId, delay('inserted', 250))
    expect(onlyJob(harness.project).instructions.find((instruction) => instruction.id === 'inserted')).toEqual(delay('inserted', 250))
    await harness.service.duplicate(jobId, 'inserted')
    expect(onlyJob(harness.project).instructions.map((instruction) => instruction.id).slice(0, 4)).toEqual([second, 'inserted', 'fresh-instruction', first])
    await harness.service.remove(jobId, 'inserted')
    expect(onlyJob(harness.project).instructions.map((instruction) => instruction.id).slice(0, 3)).toEqual([second, 'fresh-instruction', first])
    expect(harness.mutate).toHaveBeenCalledTimes(5)
  })

  it('reads the latest expected revision and applies its recipe to the latest Project', async () => {
    const first = createLogicalIoJobSampleV5({ projectId: 'latest-project', revisionId: 'latest-r1', nowIso: '2026-07-30T00:00:00.000Z' })
    const latest = { ...first, revisionId: 'latest-r2', jobs: first.jobs.map((job) => ({ ...job, instructions: [delay('latest-only')] })) }
    const mutate = vi.fn(async (request: { readonly expectedRevisionId: string; readonly recipe: (active: WorkcellProjectV5) => WorkcellProjectV5 }) => {
      expect(request.expectedRevisionId).toBe('latest-r2')
      const result = request.recipe(latest)
      expect(onlyJob(result).instructions.map((instruction) => instruction.id)).toEqual(['inserted', 'latest-only'])
    })
    const service = createJobAuthoringServiceV6({ mutations: { readPublished: () => ({ project: latest, revisionId: latest.revisionId }), mutate }, runtime: runtime('IDLE') })
    await service.insert(onlyJob(latest).id, delay('inserted'), 'latest-only')
    expect(mutate).toHaveBeenCalledOnce()
  })

  it('propagates stale mutation rejection unchanged', async () => {
    const project = createLogicalIoJobSampleV5({ projectId: 'stale-project', revisionId: 'stale-r1', nowIso: '2026-07-30T00:00:00.000Z' })
    const stale = new Error('PROJECT_REVISION_STALE')
    const service = createJobAuthoringServiceV6({ mutations: { readPublished: () => ({ project, revisionId: project.revisionId }), mutate: vi.fn(async () => { throw stale }) }, runtime: runtime('IDLE') })
    const job = onlyJob(project)
    const instruction = job.instructions[0]
    if (instruction === undefined) throw new Error('Expected a fixture instruction.')
    await expect(service.remove(job.id, instruction.id)).rejects.toBe(stale)
  })

  it('leaves V5 validator boundaries to the mutation service', async () => {
    const project = createLogicalIoJobSampleV5({ projectId: 'validation-project', revisionId: 'validation-r1', nowIso: '2026-07-30T00:00:00.000Z' })
    const mutate = vi.fn(async (request: { readonly recipe: (active: WorkcellProjectV5) => WorkcellProjectV5 }) => {
      validateWorkcellProjectV5(request.recipe(project))
    })
    const service = createJobAuthoringServiceV6({ mutations: { readPublished: () => ({ project, revisionId: project.revisionId }), mutate }, runtime: runtime('IDLE') })
    const job = onlyJob(project)
    const instruction = job.instructions[0]
    if (instruction === undefined) throw new Error('Expected a fixture instruction.')
    await expect(service.replace(job.id, { id: instruction.id, kind: 'move-joint', jointValues: { J1: 0 }, speedPercentToNext: 101 })).rejects.toThrow('ROBOT_JOINT_SET_MISMATCH')
    expect(mutate).toHaveBeenCalledOnce()
  })

  it('rejects every authoring operation before mutation while the target Robot is running', async () => {
    const project = createLogicalIoJobSampleV5({ projectId: 'running-project', revisionId: 'running-revision', nowIso: '2026-07-30T00:00:00.000Z' })
    const mutate = vi.fn()
    const service = createJobAuthoringServiceV6({ mutations: { readPublished: () => ({ project, revisionId: project.revisionId }), mutate }, runtime: runtime('RUNNING') })
    const job = onlyJob(project)
    const instruction = job.instructions[0]
    if (instruction === undefined) throw new Error('Expected a fixture instruction.')
    const jobId = job.id
    const instructionId = instruction.id
    await expect(service.reorder(jobId, instructionId, null)).rejects.toThrow('running Job')
    await expect(service.insert(jobId, delay('blocked'), null)).rejects.toThrow('running Job')
    await expect(service.replace(jobId, delay(instructionId))).rejects.toThrow('running Job')
    await expect(service.duplicate(jobId, instructionId)).rejects.toThrow('running Job')
    await expect(service.remove(jobId, instructionId)).rejects.toThrow('running Job')
    expect(mutate).not.toHaveBeenCalled()
  })
})
