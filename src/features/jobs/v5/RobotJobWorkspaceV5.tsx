import { useState, type ReactNode } from 'react'
import { useStore } from 'zustand'
import { createStore } from 'zustand/vanilla'

import type { WorkcellProjectV5 } from '../../../core/project-v5/index.js'
import type { BrowserRuntimeBundleStateV5 } from '../../project/v5/browser-runtime-bundle-store-v5.js'
import type { JobRuntimeStoreV5 } from './job-runtime-store.js'

export interface RobotJobWorkspaceV5Props {
  readonly project: WorkcellProjectV5
  readonly bundle: BrowserRuntimeBundleStateV5 | null
}

export function RobotJobWorkspaceV5({ project, bundle }: RobotJobWorkspaceV5Props): ReactNode {
  const [selectedJobId, setSelectedJobId] = useState(project.jobs[0]?.id ?? '')
  const jobsByRobot = useStore(
    bundle?.runtimeGraph.jobs ?? EMPTY_JOB_STORE,
    (state) => state.byRobotId,
  )
  const selected = project.jobs.find(({ id }) => id === selectedJobId) ?? null
  const runtime = selected === null ? null : jobsByRobot[selected.robotId] ?? null
  const canStart = bundle !== null && selected !== null && runtime?.state !== 'RUNNING'
  const canCancel = bundle !== null && selected !== null && runtime?.state === 'RUNNING'

  return <section className="v5-jobs" aria-label="Robot Jobs">
    <header><h2>Robot Jobs</h2><span>{project.jobs.length}</span></header>
    {project.jobs.length === 0
      ? <p className="v5-empty-copy">No V5 Jobs in this Project.</p>
      : <>
        <label>Job
          <select onChange={(event) => setSelectedJobId(event.currentTarget.value)} value={selected?.id ?? ''}>
            {project.jobs.map((job) => <option key={job.id} value={job.id}>{job.name}</option>)}
          </select>
        </label>
        <div className="v5-job-actions">
          <button disabled={!canStart} onClick={() => { if (bundle !== null && selected !== null) bundle.runtimeGraph.playback.startJob(selected.id) }} type="button">Start</button>
          <button disabled={!canCancel} onClick={() => { if (bundle !== null && selected !== null) bundle.runtimeGraph.playback.cancelRobotJob(selected.robotId, 'Operator cancelled the Job.') }} type="button">Cancel</button>
        </div>
        {selected !== null && <dl className="v5-job-status">
          <div><dt>Robot</dt><dd>{project.robots.find(({ id }) => id === selected.robotId)?.name ?? selected.robotId}</dd></div>
          <div><dt>Instructions</dt><dd>{selected.instructions.length}</dd></div>
          <div><dt>State</dt><dd>{runtime?.state ?? 'IDLE'}</dd></div>
          <div><dt>Step</dt><dd>{runtime?.stepIndex === null || runtime?.stepIndex === undefined ? '—' : `${runtime.stepIndex + 1} / ${selected.instructions.length}`}</dd></div>
          <div><dt>Message</dt><dd>{runtime?.message || 'Ready'}</dd></div>
        </dl>}
        {selected !== null && <ol className="v5-job-instructions">
          {selected.instructions.map((instruction, index) => <li className={runtime?.stepIndex === index ? 'is-current' : ''} key={instruction.id}>
            <span>{index + 1}</span><strong>{instruction.kind}</strong>
          </li>)}
        </ol>}
      </>}
  </section>
}

const EMPTY_JOB_STORE = createStore<JobRuntimeStoreV5>()(() => ({
  projectRevisionId: null,
  configRevision: null,
  byRobotId: {},
  replaceProject: () => undefined,
  reset: () => undefined,
  setRobotState: () => undefined,
}))
