import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, expect, it } from 'vitest'
import { BottomWorkspace } from './BottomWorkspace'

beforeEach(() => localStorage.clear())

it('shows only one bottom workspace panel at a time and persists its active tab', async () => {
  const user = userEvent.setup()
  render(
    <BottomWorkspace
      collision={<div>Collision content</div>}
      collisionCount={3}
      timeline={<div>Timeline content</div>}
    />,
  )

  expect(screen.getByRole('tabpanel', { name: 'Timeline' })).toBeVisible()
  expect(screen.queryByRole('tabpanel', { name: 'Collision' })).not.toBeInTheDocument()
  expect(screen.getByRole('tab', { name: 'Collision 3' })).toBeVisible()

  await user.click(screen.getByRole('tab', { name: 'Collision 3' }))
  expect(screen.getByRole('tabpanel', { name: 'Collision' })).toBeVisible()
  expect(screen.queryByRole('tabpanel', { name: 'Timeline' })).not.toBeInTheDocument()
  expect(localStorage.getItem('robotsim.bottomWorkspaceTab')).toBe('collision')
})
