import { useRef, useState, type ReactNode } from 'react'
import type { StoreApi } from 'zustand/vanilla'

import type { RobotJobInstructionV1, WorkcellProjectV5 } from '../../../core/project-v5/index.js'
import type { JobRuntimeStoreV5 } from '../v5/job-runtime-store.js'
import { ModalDialogV6 } from '../../ui/v6/ModalDialogV6.js'
import type { JobAuthoringServiceV6 } from './job-authoring-service-v6.js'
import { JobInstructionListV6 } from './JobInstructionListV6.js'
import { jobInstructionSummaryV6 } from './job-instruction-summary-v6.js'

export interface RobotJobEditorDialogV6Props {
  readonly project: WorkcellProjectV5
  readonly runtime?: StoreApi<JobRuntimeStoreV5>
  readonly authoring: JobAuthoringServiceV6
  readonly onClose: () => void
}

export function RobotJobEditorDialogV6({ project, runtime, authoring, onClose }: RobotJobEditorDialogV6Props): ReactNode {
  const triggerRef = useRef<HTMLButtonElement>(null); const [selectedId, setSelectedId] = useState<string | null>(project.jobs[0]?.instructions[0]?.id ?? null)
  const job = project.jobs[0] ?? null
  if (job === null) return null
  const running = runtime?.getState().byRobotId[job.robotId]?.state === 'RUNNING'; const selected = job.instructions.find((instruction) => instruction.id === selectedId) ?? null
  const action = (operation: () => Promise<void>): void => { if (!running) void operation() }
  return <ModalDialogV6 className="v6-job-editor-dialog" footer={<footer className="v6-job-editor-footer"><button onClick={onClose} ref={triggerRef} type="button">Close</button></footer>} header={<header className="v6-job-editor-header"><h2 id="v6-job-editor-title">Edit Job: {job.name}</h2><p>{running ? 'A running Job is read-only.' : 'Changes publish one Project revision per action.'}</p></header>} onClose={onClose} size="editor" titleId="v6-job-editor-title">
    <div className="v6-job-editor-body"><JobInstructionListV6 instructions={job.instructions} onReorder={(id, beforeId) => action(() => authoring.reorder(job.id, id, beforeId))} onSelect={setSelectedId} project={project} selectedInstructionId={selectedId} state={runtime?.getState().byRobotId[job.robotId]?.state ?? 'IDLE'} stepIndex={runtime?.getState().byRobotId[job.robotId]?.stepIndex ?? null} />
      <aside aria-label="Step Inspector" className="v6-job-step-inspector"><h3>Step Inspector</h3>{selected === null ? <p>Select a step.</p> : <><p><strong>{selected.kind}</strong></p><p>{jobInstructionSummaryV6(selected, project)}</p><div className="v6-job-context-actions"><button disabled={running} onClick={() => action(() => authoring.duplicate(job.id, selected.id))} type="button">Duplicate</button><button disabled={running} onClick={() => action(() => authoring.remove(job.id, selected.id))} type="button">Delete</button><button disabled={running} onClick={() => action(() => authoring.reorder(job.id, selected.id, job.instructions[Math.max(0, job.instructions.indexOf(selected) - 1)]?.id ?? null))} type="button">Move Before</button><button disabled={running} onClick={() => action(() => authoring.reorder(job.id, selected.id, job.instructions[job.instructions.indexOf(selected) + 2]?.id ?? null))} type="button">Move After</button></div></>}</aside></div>
  </ModalDialogV6>
}

export type JobInstructionDraftV6 = RobotJobInstructionV1
