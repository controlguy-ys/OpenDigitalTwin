import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { createStore } from 'zustand/vanilla'

import { createLogicalIoJobSampleV5, LOGICAL_IO_JOB_SAMPLE_IDS_V5 } from '../../project/v5/logical-io-job-sample-v5.js'
import type { JobRuntimeStoreV5 } from '../v5/job-runtime-store.js'
import { RobotJobEditorDialogV6 } from './RobotJobEditorDialogV6.js'

describe('RobotJobEditorDialogV6', () => {
  it('uses the explicit selected Job and disables all authoring controls while running', () => {
    const project = createLogicalIoJobSampleV5({ projectId: 'editor-project', revisionId: 'editor-revision', nowIso: '2026-07-30T00:00:00.000Z' })
    const runtime = createStore<JobRuntimeStoreV5>()(() => ({ projectRevisionId: null, configRevision: null, byRobotId: { [LOGICAL_IO_JOB_SAMPLE_IDS_V5.robotId]: { robotId: LOGICAL_IO_JOB_SAMPLE_IDS_V5.robotId, jobId: project.jobs[0]!.id, runId: 'run', state: 'RUNNING', stepIndex: 0, startedAtSimulationMs: 0, completedAtSimulationMs: null, failureCode: null, message: '' } }, replaceProject: vi.fn(), reset: vi.fn(), setRobotState: vi.fn() }))
    const authoring = { reorder: vi.fn(), insert: vi.fn(), replace: vi.fn(), duplicate: vi.fn(), remove: vi.fn() }
    render(<RobotJobEditorDialogV6 authoring={authoring} jobId={project.jobs[0]!.id} onClose={vi.fn()} project={project} runtime={runtime} />)
    expect(screen.getByRole('dialog', { name: `Edit Job: ${project.jobs[0]!.name}` })).toBeVisible()
    for (const name of ['Edit', 'Insert Before', 'Insert After', 'Duplicate', 'Delete', 'Move Before', 'Move After', 'Drag step 1']) expect(screen.getByRole('button', { name })).toBeDisabled()
  })

  it('edits an ordered move pose from operator values instead of generated defaults', () => {
    const project = createLogicalIoJobSampleV5({ projectId: 'pose-project', revisionId: 'pose-revision', nowIso: '2026-07-30T00:00:00.000Z' })
    const authoring = { reorder: vi.fn(), insert: vi.fn(), replace: vi.fn(() => Promise.resolve()), duplicate: vi.fn(), remove: vi.fn() }
    render(<RobotJobEditorDialogV6 authoring={authoring} jobId={project.jobs[0]!.id} onClose={vi.fn()} project={project} />)
    expect(screen.getAllByLabelText(/J[12]/u).map((input) => input.getAttribute('aria-label'))).toEqual(['J1', 'J2'])
    fireEvent.change(screen.getByLabelText('J1'), { target: { value: '12' } })
    fireEvent.change(screen.getByLabelText('J2'), { target: { value: '-8' } })
    fireEvent.change(screen.getByLabelText('Speed (%)'), { target: { value: '40' } })
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    expect(authoring.replace).toHaveBeenCalledWith(project.jobs[0]!.id, expect.objectContaining({ kind: 'move-joint', jointValues: { J1: 12, J2: -8 }, speedPercentToNext: 40 }))
  })
})
