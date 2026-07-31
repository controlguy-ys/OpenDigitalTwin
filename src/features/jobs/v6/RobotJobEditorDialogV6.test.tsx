import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { createStore } from 'zustand/vanilla'

import { createLogicalIoJobSampleV5, LOGICAL_IO_JOB_SAMPLE_IDS_V5 } from '../../project/v5/logical-io-job-sample-v5.js'
import type { JobRuntimeStoreV5 } from '../v5/job-runtime-store.js'
import { RobotJobEditorDialogV6 } from './RobotJobEditorDialogV6.js'

function onlyJob(project: ReturnType<typeof createLogicalIoJobSampleV5>) {
  const job = project.jobs[0]
  if (job === undefined) throw new Error('Expected the logical I/O fixture Job.')
  return job
}

describe('RobotJobEditorDialogV6', () => {
  it('uses the explicit selected Job and disables all authoring controls while running', () => {
    const project = createLogicalIoJobSampleV5({ projectId: 'editor-project', revisionId: 'editor-revision', nowIso: '2026-07-30T00:00:00.000Z' })
    const job = onlyJob(project)
    const runtime = createStore<JobRuntimeStoreV5>()(() => ({ projectRevisionId: null, configRevision: null, byRobotId: { [LOGICAL_IO_JOB_SAMPLE_IDS_V5.robotId]: { robotId: LOGICAL_IO_JOB_SAMPLE_IDS_V5.robotId, jobId: job.id, runId: 'run', state: 'RUNNING', stepIndex: 0, startedAtSimulationMs: 0, completedAtSimulationMs: null, failureCode: null, message: '' } }, replaceProject: vi.fn(), reset: vi.fn(), setRobotState: vi.fn() }))
    const authoring = { reorder: vi.fn(), insert: vi.fn(), replace: vi.fn(), duplicate: vi.fn(), remove: vi.fn() }
    render(<RobotJobEditorDialogV6 authoring={authoring} jobId={job.id} onClose={vi.fn()} project={project} runtime={runtime} />)
    expect(screen.getByRole('dialog', { name: `Edit Job: ${job.name}` })).toBeVisible()
    for (const name of ['Edit', 'Insert Before', 'Insert After', 'Duplicate', 'Delete', 'Move Before', 'Move After', 'Drag step 1']) expect(screen.getByRole('button', { name })).toBeDisabled()
  })

  it('edits an ordered move pose from operator values instead of generated defaults', () => {
    const project = createLogicalIoJobSampleV5({ projectId: 'pose-project', revisionId: 'pose-revision', nowIso: '2026-07-30T00:00:00.000Z' })
    const job = onlyJob(project)
    const authoring = { reorder: vi.fn(), insert: vi.fn(), replace: vi.fn(() => Promise.resolve()), duplicate: vi.fn(), remove: vi.fn() }
    render(<RobotJobEditorDialogV6 authoring={authoring} jobId={job.id} onClose={vi.fn()} project={project} />)
    expect(screen.getAllByLabelText(/J[1-6]/u).map((input) => input.getAttribute('aria-label'))).toEqual(['J1', 'J2', 'J3', 'J4', 'J5', 'J6'])
    fireEvent.change(screen.getByLabelText('J1'), { target: { value: '12' } })
    fireEvent.change(screen.getByLabelText('J2'), { target: { value: '-8' } })
    fireEvent.change(screen.getByLabelText('Speed (%)'), { target: { value: '40' } })
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    expect(authoring.replace).toHaveBeenCalledWith(job.id, expect.objectContaining({ kind: 'move-joint', jointValues: { J1: 12, J2: -8, J3: 0, J4: 0, J5: 0, J6: 0 }, speedPercentToNext: 40 }))
  })

  it('keeps invalid pose speed local and does not mutate', () => {
    const project = createLogicalIoJobSampleV5({ projectId: 'speed-project', revisionId: 'speed-revision', nowIso: '2026-07-30T00:00:00.000Z' })
    const job = onlyJob(project)
    const authoring = { reorder: vi.fn(), insert: vi.fn(), replace: vi.fn(), duplicate: vi.fn(), remove: vi.fn() }
    render(<RobotJobEditorDialogV6 authoring={authoring} jobId={job.id} onClose={vi.fn()} project={project} />)
    fireEvent.change(screen.getByLabelText('Speed (%)'), { target: { value: '101' } })
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Speed must be an integer from 1 to 100.')
    expect(authoring.replace).not.toHaveBeenCalled()
  })

  it('authors each non-move V5 instruction from visible fields', () => {
    const project = createLogicalIoJobSampleV5({ projectId: 'all-kinds-project', revisionId: 'all-kinds-revision', nowIso: '2026-07-30T00:00:00.000Z' })
    const job = onlyJob(project)
    const authoring = { reorder: vi.fn(), insert: vi.fn(), replace: vi.fn(() => Promise.resolve()), duplicate: vi.fn(), remove: vi.fn() }
    render(<RobotJobEditorDialogV6 authoring={authoring} jobId={job.id} onClose={vi.fn()} project={project} />)
    const selectKind = (kind: string): void => { fireEvent.change(screen.getByLabelText('Instruction kind'), { target: { value: kind } }) }
    const edit = (): void => { fireEvent.click(screen.getByRole('button', { name: 'Edit' })) }

    selectKind('set-do')
    fireEvent.change(screen.getByLabelText('Signal'), { target: { value: LOGICAL_IO_JOB_SAMPLE_IDS_V5.clampCommandSignalId } })
    fireEvent.change(screen.getByLabelText('Value'), { target: { value: 'false' } })
    edit()
    expect(authoring.replace).toHaveBeenLastCalledWith(job.id, expect.objectContaining({ kind: 'set-do', signalId: LOGICAL_IO_JOB_SAMPLE_IDS_V5.clampCommandSignalId, value: false }))

    selectKind('wait-di')
    fireEvent.change(screen.getByLabelText('Signal'), { target: { value: LOGICAL_IO_JOB_SAMPLE_IDS_V5.partPresentSignalId } })
    fireEvent.change(screen.getByLabelText('Timeout (ms)'), { target: { value: '125' } })
    edit()
    expect(authoring.replace).toHaveBeenLastCalledWith(job.id, expect.objectContaining({ kind: 'wait-di', signalId: LOGICAL_IO_JOB_SAMPLE_IDS_V5.partPresentSignalId, expected: true, timeoutMs: 125 }))

    selectKind('delay')
    fireEvent.change(screen.getByLabelText('Duration (ms)'), { target: { value: '250' } })
    edit()
    expect(authoring.replace).toHaveBeenLastCalledWith(job.id, expect.objectContaining({ kind: 'delay', durationMs: 250 }))

    selectKind('attach')
    fireEvent.change(screen.getByLabelText('Object'), { target: { value: LOGICAL_IO_JOB_SAMPLE_IDS_V5.partEntityId } })
    fireEvent.change(screen.getByLabelText('Tool Frame'), { target: { value: 'Tool' } })
    fireEvent.change(screen.getByLabelText('Object Grasp Frame'), { target: { value: LOGICAL_IO_JOB_SAMPLE_IDS_V5.partGraspFrameId } })
    fireEvent.change(screen.getByLabelText('Maximum distance (m)'), { target: { value: '0.1' } })
    edit()
    expect(authoring.replace).toHaveBeenLastCalledWith(job.id, expect.objectContaining({ kind: 'attach', objectId: LOGICAL_IO_JOB_SAMPLE_IDS_V5.partEntityId, toolFrameId: 'Tool', objectGraspFrameId: LOGICAL_IO_JOB_SAMPLE_IDS_V5.partGraspFrameId, maximumDistanceM: 0.1 }))

    selectKind('detach')
    fireEvent.change(screen.getByLabelText('Object'), { target: { value: LOGICAL_IO_JOB_SAMPLE_IDS_V5.partEntityId } })
    fireEvent.change(screen.getByLabelText('Target parent Frame'), { target: { value: 'world' } })
    edit()
    expect(authoring.replace).toHaveBeenLastCalledWith(job.id, expect.objectContaining({ kind: 'detach', objectId: LOGICAL_IO_JOB_SAMPLE_IDS_V5.partEntityId, targetParentFrameId: 'world' }))
  })
})
