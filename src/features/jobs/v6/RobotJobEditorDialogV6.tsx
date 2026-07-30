import { useState, type ReactNode, type RefObject } from 'react'
import { useStore } from 'zustand'
import type { StoreApi } from 'zustand/vanilla'

import type { RobotJobInstructionV1, WorkcellProjectV5 } from '../../../core/project-v5/index.js'
import { ModalDialogV6 } from '../../ui/v6/ModalDialogV6.js'
import type { JobRuntimeStoreV5 } from '../v5/job-runtime-store.js'
import { JobInstructionListV6 } from './JobInstructionListV6.js'
import type { JobAuthoringServiceV6 } from './job-authoring-service-v6.js'
import { jobInstructionSummaryV6 } from './job-instruction-summary-v6.js'

export interface RobotJobEditorDialogV6Props {
  readonly project: WorkcellProjectV5
  readonly jobId: string
  readonly runtime?: StoreApi<JobRuntimeStoreV5>
  readonly authoring: JobAuthoringServiceV6
  readonly onClose: () => void
  readonly triggerRef?: RefObject<HTMLElement | null>
}

function defaultInstruction(project: WorkcellProjectV5, jobId: string, kind: RobotJobInstructionV1['kind']): RobotJobInstructionV1 | null {
  const job = project.jobs.find((candidate) => candidate.id === jobId); if (job === undefined) return null
  const robot = project.robots.find((candidate) => candidate.id === job.robotId); const definition = robot === undefined ? undefined : project.robotDefinitions.find((candidate) => candidate.id === robot.definitionId)
  const id = `job-instruction-${crypto.randomUUID()}`
  if (kind === 'move-joint' && definition !== undefined && robot !== undefined) return { id, kind, jointValues: Object.fromEntries(definition.joints.map((joint) => [joint.id, robot.initialJointValues[joint.id] ?? joint.home])), speedPercentToNext: 30 }
  if (kind === 'set-do') { const signal = project.logicalSignals.find((candidate) => candidate.dataType === 'Boolean' && (candidate.direction === 'output' || candidate.direction === 'bidirectional')); return signal === undefined ? null : { id, kind, signalId: signal.id, value: true } }
  if (kind === 'wait-di') { const signal = project.logicalSignals.find((candidate) => candidate.dataType === 'Boolean' && (candidate.direction === 'input' || candidate.direction === 'bidirectional')); return signal === undefined ? null : { id, kind, signalId: signal.id, expected: true, timeoutMs: 3_000 } }
  if (kind === 'delay') return { id, kind, durationMs: 500 }
  const entity = project.spatialEntities.find((candidate) => candidate.graspable)
  if (kind === 'attach') { const frame = definition?.frames[0]; return entity === undefined || frame === undefined ? null : { id, kind, objectId: entity.id, toolFrameId: frame.id, objectGraspFrameId: entity.graspFrames[0]?.frameId ?? null, maximumDistanceM: 0 } }
  return entity === undefined ? null : { id, kind: 'detach', objectId: entity.id, targetParentFrameId: project.scene.frames[0]?.id ?? null }
}
function instructionKind(value: string): RobotJobInstructionV1['kind'] {
  if (value === 'move-joint' || value === 'set-do' || value === 'wait-di' || value === 'delay' || value === 'attach' || value === 'detach') return value
  return 'move-joint'
}

export function RobotJobEditorDialogV6(props: RobotJobEditorDialogV6Props): ReactNode {
  if (props.runtime === undefined) return <EditorContent {...props} runtimeState={undefined} />
  return <SubscribedEditor {...props} runtime={props.runtime} />
}

function SubscribedEditor(props: RobotJobEditorDialogV6Props & { readonly runtime: StoreApi<JobRuntimeStoreV5> }): ReactNode {
  const job = props.project.jobs.find((candidate) => candidate.id === props.jobId)
  const runtimeState = useStore(props.runtime, (state) => job === undefined ? undefined : state.byRobotId[job.robotId])
  return <EditorContent {...props} runtimeState={runtimeState} />
}

function EditorContent({ project, jobId, authoring, onClose, triggerRef, runtimeState }: RobotJobEditorDialogV6Props & { readonly runtimeState: JobRuntimeStoreV5['byRobotId'][string] | undefined }): ReactNode {
  const job = project.jobs.find((candidate) => candidate.id === jobId) ?? null
  const [selectedId, setSelectedId] = useState<string | null>(job?.instructions[0]?.id ?? null)
  const [kind, setKind] = useState<RobotJobInstructionV1['kind']>('move-joint')
  if (job === null) return null
  const selected = job.instructions.find((instruction) => instruction.id === selectedId) ?? null; const running = runtimeState?.state === 'RUNNING'
  const invoke = (operation: () => Promise<void>): void => { if (!running) void operation() }
  const draft = defaultInstruction(project, job.id, kind)
  const insert = (beforeId: string | null): void => { if (draft !== null) invoke(() => authoring.insert(job.id, draft, beforeId)) }
  const replace = (): void => { if (draft !== null && selected !== null) invoke(() => authoring.replace(job.id, { ...draft, id: selected.id })) }
  return <ModalDialogV6 className="v6-job-editor-dialog" footer={<footer className="v6-job-editor-footer"><button onClick={onClose} type="button">Close</button></footer>} header={<header className="v6-job-editor-header"><h2 id="v6-job-editor-title">Edit Job: {job.name}</h2><p>{running ? 'A running Job is read-only.' : 'Changes publish one Project revision per action.'}</p></header>} onClose={onClose} size="editor" titleId="v6-job-editor-title" {...(triggerRef === undefined ? {} : { triggerRef })}>
    <div className="v6-job-editor-body"><JobInstructionListV6 disabled={running} instructions={job.instructions} onReorder={(id, beforeId) => invoke(() => authoring.reorder(job.id, id, beforeId))} onSelect={setSelectedId} project={project} selectedInstructionId={selectedId} state={runtimeState?.state ?? 'IDLE'} stepIndex={runtimeState?.stepIndex ?? null} />
      <aside aria-label="Step Inspector" className="v6-job-step-inspector"><h3>Step Inspector</h3>{selected === null ? <p>Select a step.</p> : <><p><strong>{selected.kind}</strong></p><p>{jobInstructionSummaryV6(selected, project)}</p><label>Instruction kind<select aria-label="Instruction kind" disabled={running} onChange={(event) => setKind(instructionKind(event.currentTarget.value))} value={kind}><option value="move-joint">Move joint</option><option value="set-do">Set DO</option><option value="wait-di">Wait DI</option><option value="delay">Delay</option><option value="attach">Attach</option><option value="detach">Detach</option></select></label><div className="v6-job-context-actions"><button disabled={running || draft === null} onClick={replace} type="button">Edit</button><button disabled={running || draft === null} onClick={() => insert(selected.id)} type="button">Insert Before</button><button disabled={running || draft === null} onClick={() => insert(job.instructions[job.instructions.indexOf(selected) + 1]?.id ?? null)} type="button">Insert After</button><button disabled={running} onClick={() => invoke(() => authoring.duplicate(job.id, selected.id))} type="button">Duplicate</button><button disabled={running} onClick={() => invoke(() => authoring.remove(job.id, selected.id))} type="button">Delete</button><button disabled={running} onClick={() => invoke(() => authoring.reorder(job.id, selected.id, job.instructions[Math.max(0, job.instructions.indexOf(selected) - 1)]?.id ?? null))} type="button">Move Before</button><button disabled={running} onClick={() => invoke(() => authoring.reorder(job.id, selected.id, job.instructions[job.instructions.indexOf(selected) + 2]?.id ?? null))} type="button">Move After</button></div></>}</aside></div>
  </ModalDialogV6>
}
