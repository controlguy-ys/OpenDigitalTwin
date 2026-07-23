import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import {
  validateWorkcellProjectV5,
  type WorkcellProjectV5,
} from '../../../core/project-v5/index.js'
import {
  cloneWorkcellProjectV5,
  makeMinimalWorkcellProjectV5,
} from '../../../core/project-v5/test-support.js'
import { BindingOverviewDialogV1 } from './BindingOverviewDialog.js'

describe('BindingOverviewDialogV1', () => {
  it('groups bindings by Endpoint and opens mapped or available targets', async () => {
    const user = userEvent.setup()
    const project = cloneWorkcellProjectV5(makeMinimalWorkcellProjectV5())
    ;(project.opcUa.endpoints as unknown as Array<WorkcellProjectV5['opcUa']['endpoints'][number]>).push({
      endpointId: 'endpoint-2', name: 'Secondary PLC', endpointUrl: 'opc.tcp://localhost:4841',
      enabled: true, publishingIntervalMs: 100, reconnectDelayMs: 1_000,
    })
    const active = validateWorkcellProjectV5(project)
    const onEdit = vi.fn()
    render(<BindingOverviewDialogV1 activeProject={active} onClose={vi.fn()} onEdit={onEdit} />)

    expect(screen.getByRole('heading', { name: 'Controller (1)' })).toBeVisible()
    expect(screen.getByRole('heading', { name: 'Secondary PLC (0)' })).toBeVisible()
    expect(screen.queryByText('opc.tcp://localhost:4840')).not.toBeInTheDocument()
    expect(screen.getByRole('row', { name: /PartPresent/ })).toBeVisible()
    expect(screen.getByRole('row', { name: /PartPresent/ })).toHaveTextContent('s=Signals.PartPresent')
    await user.click(screen.getByRole('button', { name: 'Edit Binding' }))
    expect(onEdit).toHaveBeenCalledWith(
      { type: 'logical-signal', signalId: 'PartPresent' },
      'mapping-1',
    )

    await user.click(screen.getByRole('button', { name: 'Create binding: Robot 1 / Joint / J1' }))
    expect(onEdit).toHaveBeenCalledWith({ type: 'robot-joint', robotId: 'robot-1', jointId: 'J1' })
  })
})
