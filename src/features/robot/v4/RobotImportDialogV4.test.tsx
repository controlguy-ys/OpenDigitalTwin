import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { RobotImportDialogV4 } from './RobotImportDialogV4.js'
import type { RobotImportControllerV4 } from './robot-step-import-v4.js'

describe('RobotImportDialogV4', () => {
  it('previews deterministic Link mapping and submits the selected up-axis', async () => {
    const controller: RobotImportControllerV4 = {
      importRobot: vi.fn(async () => 'imported-robot-id'),
      cancel: vi.fn(() => false),
    }
    const onClose = vi.fn()
    const user = userEvent.setup()
    render(<RobotImportDialogV4 controller={controller} onClose={onClose} open />)

    const base = new File(['base'], 'base.step', { type: 'model/step' })
    const arm = new File(['arm'], 'custom_LINK03.stp', { type: 'model/step' })
    await user.selectOptions(screen.getByLabelText('Robot source up axis'), 'y')
    await user.upload(screen.getByLabelText('Robot STEP sources'), [arm, base])

    expect(screen.getByRole('list', { name: 'Robot Link mapping' })).toHaveTextContent(
      'LINK00base.stepLINK03custom_LINK03.stp',
    )
    await user.click(screen.getByRole('button', { name: 'Import Robot' }))

    await waitFor(() => expect(controller.importRobot).toHaveBeenCalledWith(
      [arm, base],
      {
        name: 'Imported Robot',
        manufacturer: 'Custom',
        model: 'Six-axis Robot',
        sourceUpAxis: 'y',
      },
    ))
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
