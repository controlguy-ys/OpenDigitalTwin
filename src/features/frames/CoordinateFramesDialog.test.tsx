import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { quaternionToRpy, serializableTransformToPose3D } from '../../domain/frames/pose3d'
import { useRobotConfigurationStore } from '../robot/robot-configuration-store'
import { useCoordinateFrameStore } from './coordinate-frame-store'
import { CoordinateFramesDialog } from './CoordinateFramesDialog'

describe('CoordinateFramesDialog', () => {
  beforeEach(() => {
    useCoordinateFrameStore.getState().resetFrames()
    useRobotConfigurationStore.getState().resetToDatasheet()
  })

  it('edits MCP translation and rotation in millimetres and degrees', async () => {
    const user = userEvent.setup()
    render(<CoordinateFramesDialog onClose={vi.fn()} open rig={null} />)

    await user.clear(screen.getByLabelText('Position X (mm)'))
    await user.type(screen.getByLabelText('Position X (mm)'), '125')
    await user.clear(screen.getByLabelText('Rotation Z (deg)'))
    await user.type(screen.getByLabelText('Rotation Z (deg)'), '30')
    await user.click(screen.getByRole('button', { name: 'Apply frame' }))

    const pose = serializableTransformToPose3D(
      useCoordinateFrameStore.getState().frames.mcp,
    )
    expect(pose.position[0]).toBeCloseTo(0.125)
    expect(quaternionToRpy(pose.quaternion)[2]).toBeCloseTo(Math.PI / 6)
  })

  it('edits Robot Base under MCP and TCP under Flange', async () => {
    const user = userEvent.setup()
    render(<CoordinateFramesDialog onClose={vi.fn()} open rig={null} />)

    await user.selectOptions(screen.getByLabelText('Coordinate frame'), 'base')
    fireEvent.change(screen.getByLabelText('Position Y (mm)'), {
      target: { value: '-80' },
    })
    await user.click(screen.getByRole('button', { name: 'Apply frame' }))
    expect(useRobotConfigurationStore.getState().configuration.basePosition[1]).toBeCloseTo(-0.08)

    await user.selectOptions(screen.getByLabelText('Coordinate frame'), 'tcp')
    await user.clear(screen.getByLabelText('Position Z (mm)'))
    await user.type(screen.getByLabelText('Position Z (mm)'), '65')
    await user.click(screen.getByRole('button', { name: 'Apply frame' }))
    expect(useCoordinateFrameStore.getState().frames.tcp.position[2]).toBeCloseTo(0.065)
  })

  it('keeps World and Flange derived frames read-only', async () => {
    const user = userEvent.setup()
    render(<CoordinateFramesDialog onClose={vi.fn()} open rig={null} />)

    await user.selectOptions(screen.getByLabelText('Coordinate frame'), 'world')
    expect(screen.getByLabelText('Position X (mm)')).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Apply frame' })).toBeDisabled()

    await user.selectOptions(screen.getByLabelText('Coordinate frame'), 'flange')
    expect(screen.getByLabelText('Rotation Z (deg)')).toBeDisabled()
    expect(screen.getByText('Robot rig is not ready.')).toBeVisible()
  })
})
