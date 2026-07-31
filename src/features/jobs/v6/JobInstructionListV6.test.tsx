import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import type { RobotJobInstructionV1 } from '../../../core/project-v5/index.js'
import { createLogicalIoJobSampleV5 } from '../../project/v5/logical-io-job-sample-v5.js'
import { JobInstructionListV6 } from './JobInstructionListV6.js'

const project = createLogicalIoJobSampleV5({ projectId: 'project-v6-list', revisionId: 'revision-v6-list', nowIso: '2026-07-30T00:00:00.000Z' })
const instructions = Array.from({ length: 17 }, (_, index): RobotJobInstructionV1 => ({ id: `delay-${index}`, kind: 'delay', durationMs: 100 }))

describe('JobInstructionListV6', () => {
  it('is a vertical accessible list with follow pause and keyboard reorder', () => {
    const reorder = vi.fn()
    render(<JobInstructionListV6 instructions={instructions} onReorder={reorder} project={project} state="RUNNING" stepIndex={5} />)
    const current = screen.getByRole('listitem', { current: 'step' })
    expect(current).toHaveTextContent('Current')
    expect(screen.getAllByRole('listitem')).toHaveLength(17)
    fireEvent.scroll(screen.getByRole('list'))
    expect(screen.getByRole('button', { name: 'Return to Current Step' })).toBeVisible()
    fireEvent.keyDown(screen.getByRole('button', { name: 'Drag step 2' }), { key: 'ArrowUp', altKey: true })
    expect(reorder).toHaveBeenCalledWith('delay-1', 'delay-0')
    const destination = screen.getAllByRole('button', { name: /Delay 100 ms/u })[2]
    if (destination === undefined) throw new Error('Expected a drop destination.')
    fireEvent.dragStart(screen.getByRole('button', { name: 'Drag step 1' }))
    fireEvent.dragOver(destination)
    fireEvent.drop(destination)
    expect(reorder).toHaveBeenLastCalledWith('delay-0', 'delay-2')
  })
})
