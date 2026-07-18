import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, expect, it } from 'vitest'
import { createShellLayoutStoreV4, type ShellLayoutStoreV4 } from './v4/shell-layout-store.js'
import { BottomWorkspace } from './BottomWorkspace'

let shellLayoutStore: ShellLayoutStoreV4

beforeEach(() => {
  localStorage.clear()
  shellLayoutStore = createShellLayoutStoreV4({ storage: localStorage })
})

it('shows only one bottom workspace panel at a time and persists its active tab', async () => {
  const user = userEvent.setup()
  render(
    <BottomWorkspace
      collision={<div>Collision content</div>}
      collisionCount={3}
      shellLayoutStore={shellLayoutStore}
      timeline={<div>Timeline content</div>}
    />,
  )

  expect(screen.getByRole('tabpanel', { name: 'Timeline' })).toBeVisible()
  expect(screen.queryByRole('tabpanel', { name: 'Collision' })).not.toBeInTheDocument()
  expect(screen.getByRole('tab', { name: 'Collision 3' })).toBeVisible()

  await user.click(screen.getByRole('tab', { name: 'Collision 3' }))
  expect(screen.getByRole('tabpanel', { name: 'Collision' })).toBeVisible()
  expect(screen.queryByRole('tabpanel', { name: 'Timeline' })).not.toBeInTheDocument()
  expect(shellLayoutStore.getState().preferences.bottom.activeTab).toBe('collision')
  expect(localStorage.getItem('robotsim.bottomWorkspaceTab')).toBeNull()
  expect(localStorage.getItem('robotsim.workspace-preferences.v1')).not.toBeNull()
})

it('uses roving focus and standard horizontal tab keyboard navigation', async () => {
  const user = userEvent.setup()
  render(<BottomWorkspace collision="Collision" shellLayoutStore={shellLayoutStore} timeline="Timeline" />)
  const timeline = screen.getByRole('tab', { name: 'Timeline' })
  const collision = screen.getByRole('tab', { name: 'Collision 0' })

  expect(timeline).toHaveAttribute('tabindex', '0')
  expect(collision).toHaveAttribute('tabindex', '-1')
  timeline.focus()
  await user.keyboard('{ArrowRight}')
  expect(collision).toHaveFocus()
  expect(collision).toHaveAttribute('aria-selected', 'true')
  await user.keyboard('{Home}')
  expect(timeline).toHaveFocus()
  await user.keyboard('{End}')
  expect(collision).toHaveFocus()
  await user.keyboard('{ArrowRight}')
  expect(timeline).toHaveFocus()
})
