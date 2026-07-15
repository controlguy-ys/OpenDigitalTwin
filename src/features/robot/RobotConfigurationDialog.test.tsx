import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { RobotConfigurationDialog } from './RobotConfigurationDialog'
import { useRobotConfigurationStore } from './robot-configuration-store'

describe('RobotConfigurationDialog', () => {
  beforeEach(() => useRobotConfigurationStore.getState().resetToDatasheet())

  it('retires base-pose controls while preserving mechanical edits', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    useRobotConfigurationStore.getState().setBasePose([0.4, 0.1, 0], [10, 20, 30])
    render(<RobotConfigurationDialog onClose={onClose} open />)

    expect(screen.queryByLabelText('Base X (mm)')).not.toBeInTheDocument()
    expect(screen.getByText(/base pose is edited in the Scene Inspector/i)).toBeVisible()
    fireEvent.change(screen.getByLabelText('J3 origin Z (mm)'), {
      target: { value: '800' },
    })
    fireEvent.change(screen.getByLabelText('J3 maxVelocityDegPerSec'), {
      target: { value: '150' },
    })
    await user.click(screen.getByRole('button', { name: 'Apply configuration' }))

    expect(useRobotConfigurationStore.getState().configuration).toMatchObject({
      basePosition: [0.4, 0.1, 0],
      baseRotationDeg: [10, 20, 30],
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
