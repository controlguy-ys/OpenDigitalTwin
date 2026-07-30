import { describe, expect, it, vi } from 'vitest'
import { createStore } from 'zustand/vanilla'

import type { WorkcellProjectV5 } from '../../../core/project-v5/index.js'
import { createLogicalIoJobSampleV5, LOGICAL_IO_JOB_SAMPLE_IDS_V5 } from '../../project/v5/logical-io-job-sample-v5.js'
import type { JobRuntimeStoreV5 } from '../v5/job-runtime-store.js'
import { createJobAuthoringServiceV6 } from './job-authoring-service-v6.js'

function runtime(state: 'IDLE' | 'RUNNING') {
  return createStore<JobRuntimeStoreV5>()(() => ({ projectRevisionId: null, configRevision: null, byRobotId: { [LOGICAL_IO_JOB_SAMPLE_IDS_V5.robotId]: { robotId: LOGICAL_IO_JOB_SAMPLE_IDS_V5.robotId, jobId: state === 'RUNNING' ? LOGICAL_IO_JOB_SAMPLE_IDS_V5.jobId : null, runId: state === 'RUNNING' ? 'run' : null, state, stepIndex: state === 'RUNNING' ? 0 : null, startedAtSimulationMs: state === 'RUNNING' ? 0 : null, completedAtSimulationMs: null, failureCode: null, message: '' } }, replaceProject: vi.fn(), reset: vi.fn(), setRobotState: vi.fn() }))
}

describe('JobAuthoringServiceV6', () => {
  it('uses the latest revision once and gives duplicated instructions a globally fresh id', async () => {
    let project: WorkcellProjectV5 = createLogicalIoJobSampleV5({ projectId: 'author-project', revisionId: 'author-revision', nowIso: '2026-07-30T00:00:00.000Z' })
    const mutate = vi.fn(async (request: { readonly expectedRevisionId: string; readonly recipe: (active: WorkcellProjectV5) => WorkcellProjectV5 }) => { expect(request.expectedRevisionId).toBe(project.revisionId); project = request.recipe(project) })
    const service = createJobAuthoringServiceV6({ mutations: { readPublished: () => ({ project, revisionId: project.revisionId }), mutate }, runtime: runtime('IDLE'), createInstructionId: () => 'fresh-instruction' })
    await service.duplicate(project.jobs[0]!.id, project.jobs[0]!.instructions[0]!.id)
    expect(mutate).toHaveBeenCalledOnce()
    expect(project.jobs[0]!.instructions.some((instruction) => instruction.id === 'fresh-instruction')).toBe(true)
  })

  it('rejects without mutation while the target Robot is running', async () => {
    const project = createLogicalIoJobSampleV5({ projectId: 'running-project', revisionId: 'running-revision', nowIso: '2026-07-30T00:00:00.000Z' })
    const mutate = vi.fn()
    const service = createJobAuthoringServiceV6({ mutations: { readPublished: () => ({ project, revisionId: project.revisionId }), mutate }, runtime: runtime('RUNNING') })
    await expect(service.remove(project.jobs[0]!.id, project.jobs[0]!.instructions[0]!.id)).rejects.toThrow('running Job')
    expect(mutate).not.toHaveBeenCalled()
  })
})
