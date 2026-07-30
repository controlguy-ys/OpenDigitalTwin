import { useStore } from 'zustand'
import type { StoreApi } from 'zustand/vanilla'
import type { ReactNode } from 'react'

import type { WorkcellProjectV5 } from '../../../core/project-v5/index.js'
import type { RobotJobPlaybackControllerV5 } from '../v5/simulation-clock.js'
import type { JobRuntimeStoreV5 } from '../v5/job-runtime-store.js'
import { jobInstructionSummaryV6 } from './job-instruction-summary-v6.js'

export interface RobotJobMonitorV6Props {
  readonly project: WorkcellProjectV5
  readonly runtime?: StoreApi<JobRuntimeStoreV5>
  readonly playback?: Pick<RobotJobPlaybackControllerV5, 'startJob' | 'cancelRobotJob'>
  readonly onOpenEditor?: () => void
}

export function RobotJobMonitorV6({ project, runtime, playback, onOpenEditor }: RobotJobMonitorV6Props): ReactNode {
  const jobStates = useStore(runtime ?? EMPTY_RUNTIME, (state) => state.byRobotId)
  const job = project.jobs[0] ?? null
  if (job === null) return <section className="v6-job-monitor" aria-label="Job monitor"><p>No Jobs in this Project.</p></section>
  const state = jobStates[job.robotId]; const current = state?.stepIndex ?? null
  const instruction = current === null ? null : job.instructions[current] ?? null
  const canStart = playback !== undefined && state?.state !== 'RUNNING'; const canCancel = playback !== undefined && state?.state === 'RUNNING'
  return <section className="v6-job-monitor" aria-label="Job monitor">
    <header><div><span>Job</span><strong>{job.name}</strong></div><button onClick={onOpenEditor} type="button">Edit Job</button></header>
    <div className="v6-job-monitor-actions"><button disabled={!canStart} onClick={() => playback?.startJob(job.id)} type="button">Start</button><button disabled={!canCancel} onClick={() => playback?.cancelRobotJob(job.robotId, 'Operator cancelled the Job.')} type="button">Cancel</button><strong>Current Step {current === null ? '—' : current + 1} / {job.instructions.length}</strong></div>
    <dl><div><dt>Kind</dt><dd>{instruction?.kind ?? '—'}</dd></div><div><dt>Summary</dt><dd>{instruction === null ? 'Ready' : jobInstructionSummaryV6(instruction, project)}</dd></div><div><dt>State</dt><dd>{state?.state ?? 'IDLE'}</dd></div><div><dt>Message</dt><dd>{state?.message || 'Ready'}</dd></div></dl>
  </section>
}

const EMPTY_RUNTIME = { getState: () => ({ byRobotId: {} }), subscribe: () => () => {} } as unknown as StoreApi<JobRuntimeStoreV5>
