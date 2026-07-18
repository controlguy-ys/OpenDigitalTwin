import { describe, expect, it, vi } from 'vitest'
import { makeMinimalWorkcellProjectV4 } from '../../../core/project-v4/test-support.js'
import { createJobRuntimeStoreV4 } from '../../jobs/v4/job-runtime-store.js'
import { createRobotRuntimeRegistryV4 } from '../../robot/v4/robot-runtime-registry.js'
import { createRobotOperatorCommandServiceV4 } from './robot-operator-command-service.js'

describe('createRobotOperatorCommandServiceV4', () => {
  it('homes the requested Robot with its live permitted writer and snapshots pose values', async () => {
    const project = { ...makeMinimalWorkcellProjectV4(), jobs: [{ id: 'job-1', name: 'Job', robotId: 'robot-1', steps: [] }] }
    const robots = createRobotRuntimeRegistryV4()
    const jobs = createJobRuntimeStoreV4()
    robots.getState().replaceProject(project)
    jobs.getState().replaceProject(project)
    const saveJointPose = vi.fn(async () => undefined)
    const service = createRobotOperatorCommandServiceV4({ readProject: () => project, robots, jobs, jobCommands: { saveJointPose } })
    expect(service.canHome('robot-1')).toBe(true)
    service.home('robot-1')
    await service.savePose('robot-1', 'job-1')
    expect(saveJointPose).toHaveBeenCalledWith('job-1', expect.objectContaining({ J1: 0 }), 100)
  })
})
