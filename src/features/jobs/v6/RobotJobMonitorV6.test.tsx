import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { createStore } from 'zustand/vanilla'

import type { JobRuntimeStoreV5 } from '../v5/job-runtime-store.js'
import { createLogicalIoJobSampleV5, LOGICAL_IO_JOB_SAMPLE_IDS_V5 } from '../../project/v5/logical-io-job-sample-v5.js'
import { RobotJobMonitorV6 } from './RobotJobMonitorV6.js'

describe('RobotJobMonitorV6', () => {
  it('shows the selected job, runtime status, and playback-only actions', () => {
    const project = createLogicalIoJobSampleV5({ projectId: 'monitor-project', revisionId: 'monitor-revision', nowIso: '2026-07-30T00:00:00.000Z' })
    const runtime = createStore<JobRuntimeStoreV5>()(() => ({ projectRevisionId: project.revisionId, configRevision: null, byRobotId: { [LOGICAL_IO_JOB_SAMPLE_IDS_V5.robotId]: { robotId: LOGICAL_IO_JOB_SAMPLE_IDS_V5.robotId, jobId: project.jobs[0]!.id, runId: 'run', state: 'RUNNING', stepIndex: 5, startedAtSimulationMs: 0, completedAtSimulationMs: null, failureCode: null, message: 'Moving' } }, replaceProject: vi.fn(), reset: vi.fn(), setRobotState: vi.fn() }))
    const playback = { startJob: vi.fn(), cancelRobotJob: vi.fn() }
    render(<RobotJobMonitorV6 playback={playback} project={project} runtime={runtime} />)
    expect(screen.getByText('Current Step 6 / 17')).toBeVisible()
    expect(screen.getByText('attach')).toBeVisible()
    expect(screen.getByText('RUNNING')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Start' })).toBeDisabled()
  })
})
