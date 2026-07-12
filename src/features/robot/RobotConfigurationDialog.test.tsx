import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { RobotConfigurationDialog } from './RobotConfigurationDialog'
import { useRobotConfigurationStore } from './robot-configuration-store'

describe('RobotConfigurationDialog', () => {
  beforeEach(() => useRobotConfigurationStore.getState().resetToDatasheet())

  it('applies base and mechanical dimension edits', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(<RobotConfigurationDialog onClose={onClose} open />)

    fireEvent.change(screen.getByLabelText('Base X (mm)'), {
      target: { value: '500' },
    })
    fireEvent.change(screen.getByLabelText('J3 origin Z (mm)'), {
      target: { value: '800' },
    })
    fireEvent.change(screen.getByLabelText('J3 maxVelocityDegPerSec'), {
      target: { value: '150' },
    })
    await user.click(screen.getByRole('button', { name: 'Apply configuration' }))

    expect(useRobotConfigurationStore.getState().configuration).toMatchObject({
      basePosition: [0.5, 0, 0],
    })
    expect(
      useRobotConfigurationStore.getState().configuration.joints[2],
    ).toMatchObject({
      origin: [0, 0, 0.8],
      maxVelocityDegPerSec: 150,
    })
    expect(onClose).toHaveBeenCalled()
  })
})
