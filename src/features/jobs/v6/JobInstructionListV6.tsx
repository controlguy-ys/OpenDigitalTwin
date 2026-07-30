import { CheckCircle2, Circle, Clock3, GripVertical, XCircle } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'

import type { RobotJobInstructionV1, WorkcellProjectV5 } from '../../../core/project-v5/index.js'
import { jobInstructionSummaryV6 } from './job-instruction-summary-v6.js'

export interface JobInstructionListV6Props {
  readonly project: WorkcellProjectV5
  readonly instructions: readonly RobotJobInstructionV1[]
  readonly stepIndex: number | null
  readonly state: 'IDLE' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'CANCELLED'
  readonly onReorder?: (instructionId: string, beforeId: string | null) => void
  readonly onSelect?: (instructionId: string) => void
  readonly selectedInstructionId?: string | null
}

function status(index: number, current: number | null, state: JobInstructionListV6Props['state']): { readonly label: string; readonly Icon: typeof Circle } {
  if (state === 'FAILED' && index === current) return { label: 'Failed', Icon: XCircle }
  if (index === current) return state === 'RUNNING' ? { label: 'Current', Icon: Clock3 } : { label: 'Current', Icon: Circle }
  if (current !== null && index < current) return { label: 'Complete', Icon: CheckCircle2 }
  return { label: 'Waiting', Icon: Circle }
}

export function JobInstructionListV6({ project, instructions, stepIndex, state, onReorder, onSelect, selectedInstructionId }: JobInstructionListV6Props): ReactNode {
  const listRef = useRef<HTMLOListElement>(null); const currentRef = useRef<HTMLLIElement>(null)
  const [follow, setFollow] = useState(true); const [dragged, setDragged] = useState<string | null>(null)
  const returnToCurrent = (): void => {
    const current = currentRef.current
    if (current !== null && typeof current.scrollIntoView === 'function') current.scrollIntoView({ block: 'nearest' })
  }
  useEffect(() => { if (follow) returnToCurrent() }, [follow, stepIndex])
  const announce = stepIndex === null ? (state === 'FAILED' || state === 'SUCCEEDED' || state === 'CANCELLED' ? state : '') : `Step ${stepIndex + 1}: ${instructions[stepIndex]?.kind ?? ''}${state === 'RUNNING' ? ', running' : `, ${state.toLowerCase()}`}`
  const move = (index: number, delta: number): void => {
    const target = index + delta; if (target < 0 || target >= instructions.length) return
    onReorder?.(instructions[index]!.id, instructions[target]!.id)
  }
  return <section className="v6-job-instruction-list" aria-label="Job instructions">
    <div aria-live="polite" className="v6-sr-only">{announce}</div>
    <label className="v6-job-follow"><input checked={follow} onChange={(event) => setFollow(event.currentTarget.checked)} type="checkbox" />Follow Execution</label>
    {!follow && <button onClick={() => { setFollow(true); returnToCurrent() }} type="button">Return to Current Step</button>}
    <ol onScroll={() => { if (follow) setFollow(false) }} ref={listRef}>
      {instructions.map((instruction, index) => { const item = status(index, stepIndex, state); const isCurrent = index === stepIndex; return <li aria-current={isCurrent ? 'step' : undefined} className={selectedInstructionId === instruction.id ? 'is-selected' : undefined} key={instruction.id} ref={isCurrent ? currentRef : undefined}>
        <button aria-label={`Drag step ${index + 1}`} className="v6-job-drag-handle" draggable onDragEnd={(event) => { const target = event.currentTarget.closest('li')?.nextElementSibling?.getAttribute('data-instruction-id') ?? null; if (dragged !== null) onReorder?.(dragged, target); setDragged(null) }} onDragStart={() => setDragged(instruction.id)} onKeyDown={(event) => { if (!event.altKey) return; if (event.key === 'ArrowUp') { event.preventDefault(); move(index, -1) } if (event.key === 'ArrowDown') { event.preventDefault(); move(index, 1) } }} type="button"><GripVertical aria-hidden="true" /></button>
        <button className="v6-job-instruction-row" data-instruction-id={instruction.id} onClick={() => onSelect?.(instruction.id)} type="button"><span className="v6-job-step-number">{index + 1}</span><item.Icon aria-hidden="true" /><span><strong>{instruction.kind}</strong><span>{jobInstructionSummaryV6(instruction, project)}</span></span><em>{item.label}</em></button>
      </li> })}
    </ol>
  </section>
}
