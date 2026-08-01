import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { createStore } from 'zustand/vanilla'

import type { JobRuntimeStoreV5 } from '../v5/job-runtime-store.js'
import { createLogicalIoJobSampleV5, LOGICAL_IO_JOB_SAMPLE_IDS_V5 } from '../../project/v5/logical-io-job-sample-v5.js'
import { RobotJobCompactStatusV6, RobotJobMonitorV6 } from './RobotJobMonitorV6.js'

describe('RobotJobMonitorV6', () => {
  it('shows the selected job, runtime status, and playback-only actions', () => {
    const project = createLogicalIoJobSampleV5({ projectId: 'monitor-project', revisionId: 'monitor-revision', nowIso: '2026-07-30T00:00:00.000Z' })
    const job = project.jobs[0]
    if (job === undefined) throw new Error('Expected the logical I/O fixture Job.')
    const runtime = createStore<JobRuntimeStoreV5>()(() => ({ projectRevisionId: project.revisionId, configRevision: null, byRobotId: { [LOGICAL_IO_JOB_SAMPLE_IDS_V5.robotId]: { robotId: LOGICAL_IO_JOB_SAMPLE_IDS_V5.robotId, jobId: job.id, runId: 'run', state: 'RUNNING', stepIndex: 5, startedAtSimulationMs: 0, completedAtSimulationMs: null, failureCode: null, message: 'Moving' } }, replaceProject: vi.fn(), reset: vi.fn(), setRobotState: vi.fn() }))
    const playback = { startJob: vi.fn(), cancelRobotJob: vi.fn() }
    render(<RobotJobMonitorV6 jobId={job.id} playback={playback} project={project} runtime={runtime} />)
    expect(screen.getByText('Current Step 6 / 17')).toBeVisible()
    expect(screen.getByText('attach')).toBeVisible()
    expect(screen.getByText('RUNNING')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Start Job' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Edit Job' })).toBeDisabled()
  })

  it('communicates a failed step with its full message and recovery actions', () => {
    const project = createLogicalIoJobSampleV5({ projectId: 'failed-monitor-project', revisionId: 'failed-monitor-revision', nowIso: '2026-07-30T00:00:00.000Z' })
    const job = project.jobs[0]
    if (job === undefined) throw new Error('Expected the logical I/O fixture Job.')
    const message = 'WaitDI instruction wait-part-present timed out.'
    const runtime = createStore<JobRuntimeStoreV5>()(() => ({ projectRevisionId: project.revisionId, configRevision: null, byRobotId: { [LOGICAL_IO_JOB_SAMPLE_IDS_V5.robotId]: { robotId: LOGICAL_IO_JOB_SAMPLE_IDS_V5.robotId, jobId: job.id, runId: 'failed-run', state: 'FAILED', stepIndex: 2, startedAtSimulationMs: 0, completedAtSimulationMs: 5_000, failureCode: 'WAIT_DI_TIMEOUT', message } }, replaceProject: vi.fn(), reset: vi.fn(), setRobotState: vi.fn() }))
    const playback = { startJob: vi.fn(), cancelRobotJob: vi.fn() }
    const onOpenEditor = vi.fn()
    render(<RobotJobMonitorV6 jobId={job.id} onOpenEditor={onOpenEditor} playback={playback} project={project} runtime={runtime} />)

    expect(screen.getByText('FAILED')).toBeVisible()
    expect(screen.getByText(message)).toBeVisible()
    const summary = screen.getByRole('status', { name: 'Job monitor status' })
    expect(summary).toHaveAttribute('aria-live', 'polite')
    expect(summary).toHaveAttribute('aria-atomic', 'true')
    expect(summary).toHaveTextContent(`FAILED Step 3: wait-di ${message}`)
    fireEvent.click(screen.getByRole('button', { name: 'Inspect failed step' }))
    expect(onOpenEditor).toHaveBeenCalledWith('wait-part-present')
    fireEvent.click(screen.getByRole('button', { name: 'Retry Job' }))
    expect(playback.startJob).toHaveBeenCalledTimes(1)
    expect(playback.startJob).toHaveBeenCalledWith(job.id)
    expect(playback.cancelRobotJob).not.toHaveBeenCalled()
  })

  it('exports a noninteractive compact status for every runtime state', () => {
    const project = createLogicalIoJobSampleV5({ projectId: 'compact-project', revisionId: 'compact-revision', nowIso: '2026-07-30T00:00:00.000Z' })
    const job = project.jobs[0]
    if (job === undefined) throw new Error('Expected the logical I/O fixture Job.')
    const states: Array<JobRuntimeStoreV5['byRobotId'][string]> = [
      { robotId: job.robotId, jobId: null, runId: null, state: 'IDLE', stepIndex: null, startedAtSimulationMs: null, completedAtSimulationMs: null, failureCode: null, message: '' },
      { robotId: job.robotId, jobId: job.id, runId: 'running', state: 'RUNNING', stepIndex: 0, startedAtSimulationMs: 0, completedAtSimulationMs: null, failureCode: null, message: 'Moving' },
      { robotId: job.robotId, jobId: job.id, runId: 'failed', state: 'FAILED', stepIndex: 2, startedAtSimulationMs: 0, completedAtSimulationMs: 5_000, failureCode: 'WAIT_DI_TIMEOUT', message: 'WaitDI instruction wait-part-present timed out.' },
      { robotId: job.robotId, jobId: job.id, runId: 'cancelled', state: 'CANCELLED', stepIndex: 1, startedAtSimulationMs: 0, completedAtSimulationMs: 2_000, failureCode: null, message: 'Operator cancelled the Job.' },
    ]
    for (const state of states) {
      const runtime = createStore<JobRuntimeStoreV5>()(() => ({ projectRevisionId: project.revisionId, configRevision: null, byRobotId: { [job.robotId]: state }, replaceProject: vi.fn(), reset: vi.fn(), setRobotState: vi.fn() }))
      const { unmount } = render(<RobotJobCompactStatusV6 jobId={job.id} project={project} runtime={runtime} />)
      expect(screen.getByRole('status')).toBeVisible()
      expect(screen.getByText(state.state)).toBeVisible()
      expect(screen.queryByRole('button')).toBeNull()
      unmount()
    }
    render(<RobotJobCompactStatusV6 jobId={job.id} project={project} />)
    expect(screen.getByText('IDLE')).toBeVisible()
    expect(screen.getByRole('status')).toBeVisible()
    expect(screen.queryByRole('button')).toBeNull()
  })
})
