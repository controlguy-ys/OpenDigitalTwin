import { useStore } from 'zustand'
import type { StoreApi } from 'zustand/vanilla'
import type { ReactNode } from 'react'

import type { WorkcellProjectV5 } from '../../../core/project-v5/index.js'
import type { RobotJobPlaybackControllerV5 } from '../v5/simulation-clock.js'
import type { JobRuntimeStoreV5 } from '../v5/job-runtime-store.js'
import { jobInstructionSummaryV6 } from './job-instruction-summary-v6.js'

export interface RobotJobMonitorV6Props {
  readonly project: WorkcellProjectV5
  readonly jobId: string
  readonly runtime?: StoreApi<JobRuntimeStoreV5>
  readonly playback?: Pick<RobotJobPlaybackControllerV5, 'startJob' | 'cancelRobotJob'>
  readonly onOpenEditor?: (instructionId?: string) => void
}

export type RobotJobCompactStatusV6Props = Pick<RobotJobMonitorV6Props, 'project' | 'jobId' | 'runtime'>

export function RobotJobMonitorV6(props: RobotJobMonitorV6Props): ReactNode {
  if (props.runtime === undefined) return <MonitorContent {...props} jobStates={{}} />
  return <SubscribedMonitor {...props} runtime={props.runtime} />
}

export function RobotJobCompactStatusV6(props: RobotJobCompactStatusV6Props): ReactNode {
  if (props.runtime === undefined) return <CompactStatusContent {...props} jobStates={{}} />
  return <SubscribedCompactStatus {...props} runtime={props.runtime} />
}

function SubscribedMonitor(props: RobotJobMonitorV6Props & { readonly runtime: StoreApi<JobRuntimeStoreV5> }): ReactNode {
  const jobStates = useStore(props.runtime, (state) => state.byRobotId)
  return <MonitorContent {...props} jobStates={jobStates} />
}

function SubscribedCompactStatus(props: RobotJobCompactStatusV6Props & { readonly runtime: StoreApi<JobRuntimeStoreV5> }): ReactNode {
  const jobStates = useStore(props.runtime, (state) => state.byRobotId)
  return <CompactStatusContent {...props} jobStates={jobStates} />
}

function MonitorContent({ project, jobId, playback, onOpenEditor, jobStates }: RobotJobMonitorV6Props & { readonly jobStates: JobRuntimeStoreV5['byRobotId'] }): ReactNode {
  const job = project.jobs.find((candidate) => candidate.id === jobId) ?? null
  if (job === null) return <section aria-label="Job monitor" className="v6-job-monitor"><p>No Jobs in this Project.</p></section>
  const state = jobStates[job.robotId]
  const runtimeState = state?.state ?? 'IDLE'
  const current = state?.stepIndex ?? null
  const instruction = current === null ? null : job.instructions[current] ?? null
  const message = state?.message || 'Ready'
  const canStart = playback !== undefined && runtimeState !== 'RUNNING'
  const canCancel = playback !== undefined && runtimeState === 'RUNNING'
  const actionLabel = runtimeState === 'FAILED' ? 'Retry Job' : 'Start Job'
  const statusSummary = `${runtimeState}${current === null ? '' : ` Step ${current + 1}: ${instruction?.kind ?? 'unknown'}`}${message === 'Ready' ? '' : ` ${message}`}`
  return <section aria-label="Job monitor" className="v6-job-monitor" data-state={runtimeState}>
    <header><div><span>Job</span><strong>{job.name}</strong></div><button disabled={runtimeState === 'RUNNING'} onClick={() => onOpenEditor?.()} type="button">Edit Job</button></header>
    <div className="v6-job-monitor-actions"><button disabled={!canStart} onClick={() => playback?.startJob(job.id)} type="button">{actionLabel}</button><button disabled={!canCancel} onClick={() => playback?.cancelRobotJob(job.robotId, 'Operator cancelled the Job.')} type="button">Cancel</button>{runtimeState === 'FAILED' && instruction !== null && <button onClick={() => onOpenEditor?.(instruction.id)} type="button">Inspect failed step</button>}<strong>Current Step {current === null ? '—' : current + 1} / {job.instructions.length}</strong></div>
    <div aria-atomic="true" aria-label="Job monitor status" aria-live="polite" className="v6-job-monitor-status" role="status">{statusSummary}</div>
    <dl><div><dt>Kind</dt><dd>{instruction?.kind ?? '—'}</dd></div><div><dt>Summary</dt><dd>{instruction === null ? 'Ready' : jobInstructionSummaryV6(instruction, project)}</dd></div><div><dt>State</dt><dd><span className="v6-job-state-badge" data-state={runtimeState}>{runtimeState}</span></dd></div><div><dt>Message</dt><dd>{message}</dd></div></dl>
  </section>
}

function CompactStatusContent({ project, jobId, jobStates }: RobotJobCompactStatusV6Props & { readonly jobStates: JobRuntimeStoreV5['byRobotId'] }): ReactNode {
  const job = project.jobs.find((candidate) => candidate.id === jobId) ?? null
  if (job === null) return <section aria-label="Job Monitor" className="v6-job-compact-status"><strong>Job Monitor</strong><span className="v6-job-state-badge" data-state="IDLE">IDLE</span></section>
  const state = jobStates[job.robotId]
  const runtimeState = state?.state ?? 'IDLE'
  const current = state?.stepIndex ?? null
  const instruction = current === null ? null : job.instructions[current] ?? null
  const message = state?.message || 'Ready'
  const conciseMessage = runtimeState === 'IDLE' ? 'Ready' : message
  return <section aria-label="Job Monitor" className="v6-job-compact-status" data-state={runtimeState}><strong>Job Monitor</strong><span>{job.name}</span><span className="v6-job-state-badge" data-state={runtimeState}>{runtimeState}</span><span>{current === null ? 'No current step' : `Step ${current + 1}: ${instruction?.kind ?? 'unknown'}`}</span><span aria-label={message}>{conciseMessage}</span></section>
}
