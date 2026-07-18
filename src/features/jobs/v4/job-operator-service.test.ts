import { describe, expect, it, vi } from 'vitest'
import { makeMinimalWorkcellProjectV4 } from '../../../core/project-v4/test-support.js'
import { createJobRuntimeStoreV4 } from './job-runtime-store.js'
import { createJobOperatorServiceV4 } from './job-operator-service.js'

describe('createJobOperatorServiceV4', () => {
  it('starts only the explicit matching Robot/Job pair and cancels that Robot only', async () => {
    const project = { ...makeMinimalWorkcellProjectV4(), jobs: [{ id: 'job-1', name: 'Job', robotId: 'robot-1', steps: [] }] }
    const jobs = createJobRuntimeStoreV4()
    jobs.getState().replaceProject(project)
    const playback = {
      startJob: vi.fn(() => ({ runId: 'run-1' })),
      cancelRobotJob: vi.fn(), ensureRunning: vi.fn(), quiesce: vi.fn(async () => undefined), resume: vi.fn(), dispose: vi.fn(),
    }
    const service = createJobOperatorServiceV4({ readProject: () => project, jobs, playback })
    expect(service.canStart('robot-1', 'job-1')).toBe(true)
    await service.start('robot-1', 'job-1')
    expect(playback.startJob).toHaveBeenCalledWith('job-1')
  })
})
