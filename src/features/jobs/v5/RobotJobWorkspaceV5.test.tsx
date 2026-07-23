import { fireEvent, render, screen } from '@testing-library/react'
import { createStore } from 'zustand/vanilla'
import { describe, expect, it, vi } from 'vitest'

import type { WorkcellProjectV5 } from '../../../core/project-v5/index.js'
import type { BrowserRuntimeBundleStateV5 } from '../../project/v5/browser-runtime-bundle-store-v5.js'
import type { JobRuntimeStoreV5 } from './job-runtime-store.js'
import { RobotJobWorkspaceV5 } from './RobotJobWorkspaceV5.js'

describe('RobotJobWorkspaceV5', () => {
  it('starts the selected V5 Job through the published playback controller', () => {
    const startJob = vi.fn(() => ({ runId: 'run-1' }))
    const jobs = createStore<JobRuntimeStoreV5>()(() => ({
      projectRevisionId: 'revision',
      configRevision: 'a'.repeat(64),
      byRobotId: {
        robot: {
          robotId: 'robot', jobId: null, runId: null, state: 'IDLE', stepIndex: null,
          startedAtSimulationMs: null, completedAtSimulationMs: null, failureCode: null, message: '',
        },
      },
      replaceProject: vi.fn(),
      reset: vi.fn(),
      setRobotState: vi.fn(),
    }))
    const project = {
      robots: [{ id: 'robot', name: 'Robot' }],
      jobs: [{
        id: 'job',
        name: 'Pick and Place',
        robotId: 'robot',
        instructions: [{ id: 'delay', kind: 'delay', durationMs: 100 }],
      }],
    } as unknown as WorkcellProjectV5
    const bundle = {
      runtimeGraph: {
        jobs,
        playback: { startJob, cancelRobotJob: vi.fn() },
      },
    } as unknown as BrowserRuntimeBundleStateV5
    render(<RobotJobWorkspaceV5 bundle={bundle} project={project} />)
    fireEvent.click(screen.getByRole('button', { name: 'Start' }))
    expect(startJob).toHaveBeenCalledWith('job')
    expect(screen.getByText('delay')).toBeInTheDocument()
  })
})
