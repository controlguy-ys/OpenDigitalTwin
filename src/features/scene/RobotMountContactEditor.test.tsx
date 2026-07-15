import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it, vi } from 'vitest'
import { RobotMountContactEditor } from './RobotMountContactEditor'

it('edits, saves incomplete, and clears durable Robot mount contact', async () => {
  const user = userEvent.setup()
  const setRobotMountContact = vi.fn(async () => undefined)
  render(
    <RobotMountContactEditor
      commands={{ setRobotMountContact }}
      configuration={{ baseLinkId: 'LINK00', mountSurfaceCollisionEntityId: null }}
      surfaces={[
        { id: 'workcell:workbench', name: 'Workbench' },
        { id: 'object:fixture', name: 'Fixture' },
      ]}
    />,
  )

  expect(screen.getByRole('status', { name: 'Mount contact configuration status' }))
    .toHaveTextContent('Incomplete')
  await user.selectOptions(screen.getByLabelText('Robot base Link'), 'LINK01')
  await user.selectOptions(screen.getByLabelText('Mount collision surface'), 'workcell:workbench')
  await user.click(screen.getByRole('button', { name: 'Save mount contact' }))
  expect(setRobotMountContact).toHaveBeenLastCalledWith({
    baseLinkId: 'LINK01',
    mountSurfaceCollisionEntityId: 'workcell:workbench',
  })

  await user.selectOptions(screen.getByLabelText('Mount collision surface'), '')
  await user.click(screen.getByRole('button', { name: 'Save mount contact' }))
  expect(setRobotMountContact).toHaveBeenLastCalledWith({
    baseLinkId: 'LINK01',
    mountSurfaceCollisionEntityId: null,
  })

  await user.click(screen.getByRole('button', { name: 'Clear mount contact' }))
  expect(setRobotMountContact).toHaveBeenLastCalledWith(null)
})

it('keeps a failed durable update visible to the operator', async () => {
  const user = userEvent.setup()
  render(
    <RobotMountContactEditor
      commands={{ setRobotMountContact: vi.fn(async () => {
        throw new Error('MOUNT_CONTACT_REJECTED: active surface is unavailable.')
      }) }}
      configuration={null}
      surfaces={[]}
    />,
  )

  await user.click(screen.getByRole('button', { name: 'Save mount contact' }))
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'MOUNT_CONTACT_REJECTED: active surface is unavailable.',
  )
})
