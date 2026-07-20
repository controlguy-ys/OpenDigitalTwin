import { describe, expect, it } from 'vitest'

import { makeMinimalWorkcellProjectV5 } from '../../../core/project-v5/test-support.js'
import { createJobRuntimeStoreV5 } from './job-runtime-store.js'

const REVISION = 'a'.repeat(64)
const REVISION_B = 'b'.repeat(64)

describe('JobRuntimeStoreV5', () => {
  it('rejects a half-specified initial Project/config pair', () => {
    const create = createJobRuntimeStoreV5 as unknown as (project?: ReturnType<typeof makeMinimalWorkcellProjectV5>, configRevision?: string) => unknown
    expect(() => create(makeMinimalWorkcellProjectV5())).toThrow(TypeError)
    expect(() => create(undefined, REVISION)).toThrow(TypeError)
  })

  it('invalidates an old run when same public revision content is replaced', () => {
    const project = makeMinimalWorkcellProjectV5()
    const jobs = createJobRuntimeStoreV5(project, REVISION)
    jobs.getState().setRobotState({
      robotId: 'robot-1', jobId: 'job-1', runId: 'run-1', state: 'RUNNING', stepIndex: 0,
      startedAtSimulationMs: 0, completedAtSimulationMs: null, failureCode: null, message: '',
    })
    const replacement = { ...structuredClone(project), metadata: { ...project.metadata, updatedAt: '2026-07-20T00:00:00.000Z' } }
    jobs.getState().replaceProject(replacement, REVISION_B)
    expect(jobs.getState()).toMatchObject({ projectRevisionId: 'revision-1', configRevision: REVISION_B })
    expect(jobs.getState().byRobotId['robot-1']).toMatchObject({ state: 'IDLE', runId: null })
    jobs.getState().setRobotState({
      robotId: 'robot-1', jobId: 'job-1', runId: 'run-2', state: 'RUNNING', stepIndex: 0,
      startedAtSimulationMs: 0.5, completedAtSimulationMs: null, failureCode: null, message: '',
    })
    expect(jobs.getState().byRobotId['robot-1']).toMatchObject({ state: 'RUNNING', startedAtSimulationMs: 0.5 })
    jobs.getState().reset(replacement, REVISION_B)
    expect(jobs.getState().byRobotId['robot-1']).toMatchObject({ state: 'IDLE' })
  })
})
