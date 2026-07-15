import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { SceneEntityV1 } from '../../domain/project/scene-state-v1'
import { testSceneRuntime, TEST_IDENTITY_POSE } from './scene-ui-test-fixtures'
import { LinearAxisInspector } from './LinearAxisInspector'

function axisRuntime(attachedRobot = false) {
  const axis: SceneEntityV1 = {
    kind: 'linear-axis', id: 'linear-axis:active', name: 'Linear Axis', parentId: null,
    localPose: TEST_IDENTITY_POSE, visible: true, direction: 'x', minPositionM: -1,
    maxPositionM: 2, homePositionM: 0.25, currentPositionM: 0.5,
    carriageEntityId: null, robotEntityId: attachedRobot ? 'robot:active' : null,
  }
  const robot: SceneEntityV1 = {
    kind: 'robot', id: 'robot:active', name: 'Robot',
    parentId: attachedRobot ? 'linear-axis:active' : null,
    localPose: TEST_IDENTITY_POSE, visible: true,
  }
  const group: SceneEntityV1 = {
    kind: 'group', id: 'group:carriage', name: 'Carriage Group', parentId: null,
    localPose: TEST_IDENTITY_POSE, visible: true,
  }
  const object: SceneEntityV1 = {
    kind: 'object', id: 'object:pallet', name: 'Pallet', parentId: null,
    localPose: TEST_IDENTITY_POSE, visible: true,
    target: { kind: 'object-instance', id: 'pallet' }, transformSource: 'manual',
  }
  const opcObject: SceneEntityV1 = {
    kind: 'object', id: 'object:live', name: 'Live Object', parentId: null,
    localPose: TEST_IDENTITY_POSE, visible: true,
    target: { kind: 'object-instance', id: 'live' }, transformSource: 'opcua',
  }
  return testSceneRuntime([axis, robot, group, object, opcObject])
}

function commands() {
  return {
    setLinearAxisPosition: vi.fn(async () => undefined),
    moveLinearAxisHome: vi.fn(async () => undefined),
    setLinearAxisCarriage: vi.fn(async () => undefined),
    attachRobotToLinearAxis: vi.fn(async () => undefined),
    detachRobotFromLinearAxis: vi.fn(async () => undefined),
    deleteLinearAxis: vi.fn(async () => undefined),
  }
}

describe('LinearAxisInspector', () => {
  it('keeps out-of-range input uncommitted and identifies the allowed range', async () => {
    const user = userEvent.setup()
    const axisCommands = commands()
    render(<LinearAxisInspector commands={axisCommands} runtime={axisRuntime()} />)
    const position = screen.getByRole('spinbutton', { name: 'Axis position (mm)' })

    await user.clear(position)
    await user.type(position, '2100')
    await user.click(screen.getByRole('button', { name: 'Apply position' }))

    expect(axisCommands.setLinearAxisPosition).not.toHaveBeenCalled()
    expect(screen.getByRole('alert')).toHaveTextContent('Allowed range: -1000 to 2000 mm')
    expect(position).toHaveValue(2100)
  })

  it('commits bounded Manual motion, Home, eligible carriage, and Robot attachment commands', async () => {
    const user = userEvent.setup()
    const axisCommands = commands()
    render(<LinearAxisInspector commands={axisCommands} runtime={axisRuntime()} />)
    const position = screen.getByRole('spinbutton', { name: 'Axis position (mm)' })

    await user.clear(position)
    await user.type(position, '1250')
    await user.click(screen.getByRole('button', { name: 'Apply position' }))
    await user.click(screen.getByRole('button', { name: 'Move Home' }))
    await user.selectOptions(screen.getByRole('combobox', { name: 'Carriage' }), 'group:carriage')
    await user.click(screen.getByRole('button', { name: 'Set carriage' }))
    await user.click(screen.getByRole('button', { name: 'Attach Robot' }))

    expect(axisCommands.setLinearAxisPosition).toHaveBeenCalledWith(1.25)
    expect(axisCommands.moveLinearAxisHome).toHaveBeenCalledOnce()
    expect(axisCommands.setLinearAxisCarriage).toHaveBeenCalledWith('group:carriage')
    expect(axisCommands.attachRobotToLinearAxis).toHaveBeenCalledOnce()
    expect(screen.getByRole('option', { name: 'Live Object' })).toBeDisabled()
  })

  it('offers detach when the Robot is already attached', async () => {
    const user = userEvent.setup()
    const axisCommands = commands()
    render(<LinearAxisInspector commands={axisCommands} runtime={axisRuntime(true)} />)

    await user.click(screen.getByRole('button', { name: 'Detach Robot' }))

    expect(axisCommands.detachRobotFromLinearAxis).toHaveBeenCalledOnce()
  })
})
