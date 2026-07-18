import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { beforeEach, expect, it, vi } from 'vitest'
import { BottomWorkspace } from './BottomWorkspace'
import type { BottomWorkspaceTabV4 } from './v4/bottom-workspace-tab.js'

beforeEach(() => {
  localStorage.clear()
})

function ControlledBottomWorkspace({
  initialTab = 'timeline',
  onActiveTabChange,
}: {
  readonly initialTab?: BottomWorkspaceTabV4
  readonly onActiveTabChange?: (tab: BottomWorkspaceTabV4) => void
}) {
  const [activeTab, setActiveTab] = useState<BottomWorkspaceTabV4>(initialTab)
  return (
    <BottomWorkspace
      activeTab={activeTab}
      collision={<div>Collision content</div>}
      collisionCount={3}
      onActiveTabChange={(tab) => {
        onActiveTabChange?.(tab)
        setActiveTab(tab)
      }}
      timeline={<div>Timeline content</div>}
    />
  )
}

it('shows one controlled bottom workspace panel at a time and emits one tab selection', async () => {
  const user = userEvent.setup()
  const onActiveTabChange = vi.fn()
  render(<ControlledBottomWorkspace onActiveTabChange={onActiveTabChange} />)

  expect(screen.getByRole('tabpanel', { name: 'Timeline' })).toBeVisible()
  expect(screen.queryByRole('tabpanel', { name: 'Collision' })).not.toBeInTheDocument()
  expect(screen.getByRole('tab', { name: 'Collision 3' })).toBeVisible()

  await user.click(screen.getByRole('tab', { name: 'Collision 3' }))
  expect(screen.getByRole('tabpanel', { name: 'Collision' })).toBeVisible()
  expect(screen.queryByRole('tabpanel', { name: 'Timeline' })).not.toBeInTheDocument()
  expect(onActiveTabChange).toHaveBeenCalledOnce()
  expect(onActiveTabChange).toHaveBeenCalledWith('collision')
  expect(localStorage.getItem('robotsim.bottomWorkspaceTab')).toBeNull()
  expect(localStorage.getItem('robotsim.workspace-preferences.v1')).toBeNull()
})

it('uses roving focus and standard horizontal tab keyboard navigation', async () => {
  const user = userEvent.setup()
  const onActiveTabChange = vi.fn()
  render(<ControlledBottomWorkspace onActiveTabChange={onActiveTabChange} />)
  const timeline = screen.getByRole('tab', { name: 'Timeline' })
  const collision = screen.getByRole('tab', { name: 'Collision 3' })

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
  expect(onActiveTabChange).toHaveBeenCalledTimes(4)
})
