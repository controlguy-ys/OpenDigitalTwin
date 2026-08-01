import { useEffect, useState, type ChangeEvent, type ReactNode, type RefObject } from 'react'
import { useStore } from 'zustand'
import type { StoreApi } from 'zustand/vanilla'

import {
  MAX_JOB_TIMER_MS_V5,
  type RobotJobInstructionV1,
  type WorkcellProjectV5,
} from '../../../core/project-v5/index.js'
import { ModalDialogV6 } from '../../ui/v6/ModalDialogV6.js'
import type { JobRuntimeStoreV5, RobotJobRuntimeStateV5 } from '../v5/job-runtime-store.js'
import { JobInstructionListV6 } from './JobInstructionListV6.js'
import type { JobAuthoringServiceV6 } from './job-authoring-service-v6.js'
import { jobInstructionSummaryV6 } from './job-instruction-summary-v6.js'

export interface RobotJobEditorDialogV6Props {
  readonly project: WorkcellProjectV5
  readonly jobId: string
  readonly instructionId?: string
  readonly runtime?: StoreApi<JobRuntimeStoreV5>
  readonly authoring: JobAuthoringServiceV6
  readonly onClose: () => void
  readonly triggerRef?: RefObject<HTMLElement | null>
}

type InstructionKind = RobotJobInstructionV1['kind']

interface InstructionDraftV6 {
  readonly kind: InstructionKind
  readonly pose: Readonly<Record<string, string>>
  readonly speed: string
  readonly signalId: string
  readonly booleanValue: boolean
  readonly timeoutMs: string
  readonly durationMs: string
  readonly objectId: string
  readonly toolFrameId: string
  readonly objectGraspFrameId: string
  readonly maximumDistanceM: string
  readonly targetParentFrameId: string
}

function instructionKind(value: string): InstructionKind {
  if (value === 'move-joint' || value === 'set-do' || value === 'wait-di' || value === 'delay' || value === 'attach' || value === 'detach') return value
  return 'move-joint'
}

function emptyDraft(kind: InstructionKind, jointIds: readonly string[]): InstructionDraftV6 {
  return {
    kind,
    pose: Object.fromEntries(jointIds.map((id) => [id, ''])),
    speed: '',
    signalId: '',
    booleanValue: true,
    timeoutMs: '',
    durationMs: '',
    objectId: '',
    toolFrameId: '',
    objectGraspFrameId: '',
    maximumDistanceM: '',
    targetParentFrameId: '',
  }
}

function draftForInstruction(instruction: RobotJobInstructionV1 | null, jointIds: readonly string[]): InstructionDraftV6 {
  if (instruction === null) return emptyDraft('move-joint', jointIds)
  if (instruction.kind === 'move-joint') return { ...emptyDraft('move-joint', jointIds), pose: Object.fromEntries(jointIds.map((id) => [id, String(instruction.jointValues[id])])), speed: String(instruction.speedPercentToNext) }
  if (instruction.kind === 'set-do') return { ...emptyDraft('set-do', jointIds), signalId: instruction.signalId, booleanValue: instruction.value }
  if (instruction.kind === 'wait-di') return { ...emptyDraft('wait-di', jointIds), signalId: instruction.signalId, booleanValue: instruction.expected, timeoutMs: String(instruction.timeoutMs) }
  if (instruction.kind === 'delay') return { ...emptyDraft('delay', jointIds), durationMs: String(instruction.durationMs) }
  if (instruction.kind === 'attach') return { ...emptyDraft('attach', jointIds), objectId: instruction.objectId, toolFrameId: instruction.toolFrameId, objectGraspFrameId: instruction.objectGraspFrameId ?? '', maximumDistanceM: String(instruction.maximumDistanceM) }
  return { ...emptyDraft('detach', jointIds), objectId: instruction.objectId, targetParentFrameId: instruction.targetParentFrameId ?? '' }
}

function finiteNumber(value: string): number | null {
  if (value.trim().length === 0) return null
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

function safeIntegerInRange(value: string, minimum: number, maximum: number): number | null {
  const number = finiteNumber(value)
  return number !== null && Number.isSafeInteger(number) && number >= minimum && number <= maximum ? number : null
}

function error(message: string): { readonly instruction: null; readonly error: string } {
  return { instruction: null, error: message }
}

function buildInstruction(
  project: WorkcellProjectV5,
  jobId: string,
  draft: InstructionDraftV6,
  id: string,
): { readonly instruction: RobotJobInstructionV1 | null; readonly error: string | null } {
  const job = project.jobs.find((candidate) => candidate.id === jobId)
  const robot = job === undefined ? undefined : project.robots.find((candidate) => candidate.id === job.robotId)
  const definition = robot === undefined ? undefined : project.robotDefinitions.find((candidate) => candidate.id === robot.definitionId)
  if (job === undefined || definition === undefined) return error('The selected Job Robot definition is unavailable.')
  if (draft.kind === 'move-joint') {
    const values: Record<string, number> = {}
    for (const joint of definition.joints) {
      const value = finiteNumber(draft.pose[joint.id] ?? '')
      if (value === null || value < joint.min || value > joint.max) return error(`${joint.id} must be a finite value from ${joint.min} to ${joint.max}.`)
      values[joint.id] = value
    }
    const speed = safeIntegerInRange(draft.speed, 1, 100)
    if (speed === null) return error('Speed must be an integer from 1 to 100.')
    return { instruction: { id, kind: 'move-joint', jointValues: values, speedPercentToNext: speed }, error: null }
  }
  if (draft.kind === 'set-do' || draft.kind === 'wait-di') {
    const signal = project.logicalSignals.find((candidate) => candidate.id === draft.signalId)
    const allowed = draft.kind === 'set-do'
      ? signal?.dataType === 'Boolean' && (signal.direction === 'output' || signal.direction === 'bidirectional')
      : signal?.dataType === 'Boolean' && (signal.direction === 'input' || signal.direction === 'bidirectional')
    if (signal === undefined || !allowed) return error('Select a compatible Boolean signal.')
    if (draft.kind === 'set-do') return { instruction: { id, kind: 'set-do', signalId: signal.id, value: draft.booleanValue }, error: null }
    const timeoutMs = safeIntegerInRange(draft.timeoutMs, 1, MAX_JOB_TIMER_MS_V5)
    if (timeoutMs === null) return error('Timeout must be a positive whole number of milliseconds.')
    return { instruction: { id, kind: 'wait-di', signalId: signal.id, expected: draft.booleanValue, timeoutMs }, error: null }
  }
  if (draft.kind === 'delay') {
    const durationMs = safeIntegerInRange(draft.durationMs, 1, MAX_JOB_TIMER_MS_V5)
    if (durationMs === null) return error('Duration must be a positive whole number of milliseconds.')
    return { instruction: { id, kind: 'delay', durationMs }, error: null }
  }
  const entity = project.spatialEntities.find((candidate) => candidate.id === draft.objectId)
  if (draft.kind === 'attach') {
    if (entity === undefined || !entity.graspable) return error('Select a graspable Object.')
    if (!definition.frames.some((frame) => frame.id === draft.toolFrameId)) return error('Select a Robot tool Frame.')
    if (draft.objectGraspFrameId.length > 0 && !entity.graspFrames.some((frame) => frame.frameId === draft.objectGraspFrameId)) return error('Select an Object grasp Frame.')
    const maximumDistanceM = finiteNumber(draft.maximumDistanceM)
    if (maximumDistanceM === null || maximumDistanceM < 0) return error('Maximum distance must be a finite value greater than or equal to zero.')
    return { instruction: { id, kind: 'attach', objectId: entity.id, toolFrameId: draft.toolFrameId, objectGraspFrameId: draft.objectGraspFrameId || null, maximumDistanceM }, error: null }
  }
  if (entity === undefined) return error('Select an Object.')
  const targetParentFrameId = draft.targetParentFrameId || null
  if (targetParentFrameId !== null && !project.scene.frames.some((frame) => frame.id === targetParentFrameId)) return error('Select a valid target parent Frame.')
  return { instruction: { id, kind: 'detach', objectId: entity.id, targetParentFrameId }, error: null }
}

function newInstructionId(): string {
  return `job-instruction-${crypto.randomUUID()}`
}

export function RobotJobEditorDialogV6(props: RobotJobEditorDialogV6Props): ReactNode {
  const job = props.project.jobs.find((candidate) => candidate.id === props.jobId)
  if (job === undefined) return null
  const runtime = props.runtime
  if (runtime === undefined) return <EditorContent {...props} job={job} runtimeState={undefined} />
  return <SubscribedEditor {...props} job={job} runtime={runtime} />
}

function SubscribedEditor(props: Omit<RobotJobEditorDialogV6Props, 'runtime'> & { readonly runtime: StoreApi<JobRuntimeStoreV5>; readonly job: WorkcellProjectV5['jobs'][number] }): ReactNode {
  const runtimeState = useStore(props.runtime, (state) => state.byRobotId[props.job.robotId])
  return <EditorContent {...props} runtimeState={runtimeState} />
}

function EditorContent({ project, job, authoring, instructionId, onClose, triggerRef, runtimeState }: RobotJobEditorDialogV6Props & { readonly job: WorkcellProjectV5['jobs'][number]; readonly runtimeState: RobotJobRuntimeStateV5 | undefined }): ReactNode {
  const robot = project.robots.find((candidate) => candidate.id === job.robotId)
  const definition = robot === undefined ? undefined : project.robotDefinitions.find((candidate) => candidate.id === robot.definitionId)
  const jointIds = definition?.joints.map((joint) => joint.id) ?? []
  const [selectedId, setSelectedId] = useState<string | null>(() => job.instructions.some((instruction) => instruction.id === instructionId) ? instructionId ?? null : job.instructions[0]?.id ?? null)
  const selected = job.instructions.find((instruction) => instruction.id === selectedId) ?? null
  const [draft, setDraft] = useState<InstructionDraftV6>(() => draftForInstruction(selected, jointIds))
  const [draftError, setDraftError] = useState<string | null>(null)
  const running = runtimeState?.state === 'RUNNING'

  useEffect(() => {
    setDraft(draftForInstruction(selected, jointIds))
    setDraftError(null)
  }, [selectedId, project.revisionId])

  const invoke = (operation: () => Promise<void>): void => {
    if (!running) void operation()
  }
  const setKind = (kind: InstructionKind): void => {
    setDraft(emptyDraft(kind, jointIds))
    setDraftError(null)
  }
  const updateText = (update: (current: InstructionDraftV6, value: string) => InstructionDraftV6) => (event: ChangeEvent<HTMLInputElement | HTMLSelectElement>): void => {
    const value = event.currentTarget.value
    setDraft((current) => update(current, value))
  }
  const candidate = (id: string): RobotJobInstructionV1 | null => {
    const result = buildInstruction(project, job.id, draft, id)
    setDraftError(result.error)
    return result.instruction
  }
  const insert = (beforeId: string | null): void => {
    const instruction = candidate(newInstructionId())
    if (instruction !== null) invoke(() => authoring.insert(job.id, instruction, beforeId))
  }
  const replace = (): void => {
    if (selected === null) return
    const instruction = candidate(selected.id)
    if (instruction !== null) invoke(() => authoring.replace(job.id, instruction))
  }
  const signalOptions = project.logicalSignals.filter((signal) => signal.dataType === 'Boolean' && (draft.kind === 'set-do' ? signal.direction === 'output' || signal.direction === 'bidirectional' : signal.direction === 'input' || signal.direction === 'bidirectional'))
  const graspableObjects = project.spatialEntities.filter((entity) => entity.graspable)
  const selectedObject = project.spatialEntities.find((entity) => entity.id === draft.objectId)
  const index = selected === null ? -1 : job.instructions.indexOf(selected)
  const nextInstructionId = index < 0 ? null : job.instructions[index + 1]?.id ?? null

  return <ModalDialogV6 className="v6-job-editor-dialog" footer={<footer className="v6-job-editor-footer"><button onClick={onClose} type="button">Close</button></footer>} header={<header className="v6-job-editor-header"><h2 id="v6-job-editor-title">Edit Job: {job.name}</h2><p>{running ? 'A running Job is read-only.' : 'Changes publish one Project revision per action.'}</p></header>} onClose={onClose} size="editor" titleId="v6-job-editor-title" {...(triggerRef === undefined ? {} : { triggerRef })}>
    <div className="v6-job-editor-body"><JobInstructionListV6 disabled={running} instructions={job.instructions} onReorder={(id, beforeId) => invoke(() => authoring.reorder(job.id, id, beforeId))} onSelect={setSelectedId} project={project} selectedInstructionId={selectedId} state={runtimeState?.state ?? 'IDLE'} stepIndex={runtimeState?.stepIndex ?? null} />
      <aside aria-label="Step Inspector" className="v6-job-step-inspector"><h3>Step Inspector</h3>{selected === null ? <p>Select a step.</p> : <><p><strong>{selected.kind}</strong></p><p>{jobInstructionSummaryV6(selected, project)}</p><fieldset disabled={running}><legend>Instruction kind</legend><label>Kind<select aria-label="Instruction kind" onChange={(event) => setKind(instructionKind(event.currentTarget.value))} value={draft.kind}><option value="move-joint">Move joint</option><option value="set-do">Set DO</option><option value="wait-di">Wait DI</option><option value="delay">Delay</option><option value="attach">Attach</option><option value="detach">Detach</option></select></label></fieldset>
        {draft.kind === 'move-joint' && <fieldset disabled={running}><legend>Pose</legend>{definition?.joints.map((joint) => <label key={joint.id}>{joint.id}<input aria-label={joint.id} max={joint.max} min={joint.min} onChange={updateText((current, value) => ({ ...current, pose: { ...current.pose, [joint.id]: value } }))} type="number" value={draft.pose[joint.id] ?? ''} /></label>)}<label>Speed (%)<input aria-label="Speed (%)" max={100} min={1} onChange={updateText((current, value) => ({ ...current, speed: value }))} step={1} type="number" value={draft.speed} /></label></fieldset>}
        {(draft.kind === 'set-do' || draft.kind === 'wait-di') && <fieldset disabled={running}><legend>{draft.kind === 'set-do' ? 'Set output' : 'Wait input'}</legend><label>Signal<select aria-label="Signal" onChange={updateText((current, value) => ({ ...current, signalId: value }))} value={draft.signalId}><option value="">Select signal</option>{signalOptions.map((signal) => <option key={signal.id} value={signal.id}>{signal.name}</option>)}</select></label><label>Value<select aria-label="Value" onChange={updateText((current, value) => ({ ...current, booleanValue: value === 'true' }))} value={String(draft.booleanValue)}><option value="true">true</option><option value="false">false</option></select></label>{draft.kind === 'wait-di' && <label>Timeout (ms)<input aria-label="Timeout (ms)" min={1} onChange={updateText((current, value) => ({ ...current, timeoutMs: value }))} step={1} type="number" value={draft.timeoutMs} /></label>}</fieldset>}
        {draft.kind === 'delay' && <fieldset disabled={running}><legend>Delay</legend><label>Duration (ms)<input aria-label="Duration (ms)" min={1} onChange={updateText((current, value) => ({ ...current, durationMs: value }))} step={1} type="number" value={draft.durationMs} /></label></fieldset>}
        {draft.kind === 'attach' && <fieldset disabled={running}><legend>Attach</legend><label>Object<select aria-label="Object" onChange={updateText((current, value) => ({ ...current, objectId: value, objectGraspFrameId: '' }))} value={draft.objectId}><option value="">Select graspable Object</option>{graspableObjects.map((entity) => <option key={entity.id} value={entity.id}>{entity.name}</option>)}</select></label><label>Tool Frame<select aria-label="Tool Frame" onChange={updateText((current, value) => ({ ...current, toolFrameId: value }))} value={draft.toolFrameId}><option value="">Select tool Frame</option>{definition?.frames.map((frame) => <option key={frame.id} value={frame.id}>{frame.name}</option>)}</select></label><label>Object Grasp Frame<select aria-label="Object Grasp Frame" onChange={updateText((current, value) => ({ ...current, objectGraspFrameId: value }))} value={draft.objectGraspFrameId}><option value="">None</option>{selectedObject?.graspFrames.map((frame) => <option key={frame.frameId} value={frame.frameId}>{frame.name}</option>)}</select></label><label>Maximum distance (m)<input aria-label="Maximum distance (m)" min={0} onChange={updateText((current, value) => ({ ...current, maximumDistanceM: value }))} step="any" type="number" value={draft.maximumDistanceM} /></label></fieldset>}
        {draft.kind === 'detach' && <fieldset disabled={running}><legend>Detach</legend><label>Object<select aria-label="Object" onChange={updateText((current, value) => ({ ...current, objectId: value }))} value={draft.objectId}><option value="">Select Object</option>{project.spatialEntities.map((entity) => <option key={entity.id} value={entity.id}>{entity.name}</option>)}</select></label><label>Target parent Frame<select aria-label="Target parent Frame" onChange={updateText((current, value) => ({ ...current, targetParentFrameId: value }))} value={draft.targetParentFrameId}><option value="">World</option>{project.scene.frames.map((frame) => <option key={frame.id} value={frame.id}>{frame.name}</option>)}</select></label></fieldset>}
        {draftError !== null && <p role="alert">{draftError}</p>}<fieldset className="v6-job-context-actions" disabled={running}><legend>Step actions</legend><button onClick={replace} type="button">Edit</button><button onClick={() => insert(selected.id)} type="button">Insert Before</button><button onClick={() => insert(nextInstructionId)} type="button">Insert After</button><button onClick={() => invoke(() => authoring.duplicate(job.id, selected.id))} type="button">Duplicate</button><button onClick={() => invoke(() => authoring.remove(job.id, selected.id))} type="button">Delete</button><button disabled={index <= 0} onClick={() => invoke(() => authoring.reorder(job.id, selected.id, job.instructions[index - 1]?.id ?? null))} type="button">Move Before</button><button disabled={index < 0 || index >= job.instructions.length - 1} onClick={() => invoke(() => authoring.reorder(job.id, selected.id, job.instructions[index + 2]?.id ?? null))} type="button">Move After</button></fieldset></>}</aside></div>
  </ModalDialogV6>
}
