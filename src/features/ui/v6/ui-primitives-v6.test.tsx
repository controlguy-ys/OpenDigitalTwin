import { createRef } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Check, Save, TriangleAlert } from 'lucide-react'
import { expect, it, vi } from 'vitest'
import { IconButtonV6 } from './IconButtonV6.js'
import { StatusBadgeV6 } from './StatusBadgeV6.js'
import { SwitchFieldV6 } from './SwitchFieldV6.js'
import { ButtonV6 } from './ButtonV6.js'

it('renders shared buttons with token variants, native state, ref forwarding, and an accessible name', () => {
  const ref = createRef<HTMLButtonElement>()
  render(<>
    <ButtonV6 ref={ref} aria-label="Run simulation" disabled size="compact" variant="primary">Run</ButtonV6>
    <ButtonV6 size="default" variant="secondary">Settings</ButtonV6>
  </>)

  const compact = screen.getByRole('button', { name: 'Run simulation' })
  const standard = screen.getByRole('button', { name: 'Settings' })
  expect(compact).toHaveAttribute('data-variant', 'primary')
  expect(compact).toHaveAttribute('data-size', 'compact')
  expect(compact).toBeDisabled()
  expect(ref.current).toBe(compact)
  expect(standard).toHaveAttribute('data-variant', 'secondary')
  expect(standard).toHaveAttribute('data-size', 'default')
})

it('shows the icon button label in a tooltip when keyboard focus reaches it', async () => {
  const user = userEvent.setup()
  const onClick = vi.fn()

  render(<IconButtonV6 icon={Save} label="Save Project" onClick={onClick} />)

  const button = screen.getByRole('button', { name: 'Save Project' })
  expect(button).toBeVisible()

  await user.tab()

  expect(button).toHaveFocus()
  expect(screen.getByRole('tooltip')).toHaveTextContent('Save Project')

  await user.keyboard('{Enter}')
  expect(onClick).toHaveBeenCalledOnce()
})

it('shows the icon button tooltip while the pointer hovers over its target', async () => {
  const user = userEvent.setup()

  render(<IconButtonV6 icon={Save} label="Save Project" onClick={vi.fn()} />)

  await user.hover(screen.getByRole('button', { name: 'Save Project' }))

  expect(screen.getByRole('tooltip')).toHaveTextContent('Save Project')
})

it('describes the purpose of its native checkbox with the visible switch label', async () => {
  const user = userEvent.setup()
  const onChange = vi.fn()

  render(
    <SwitchFieldV6
      checked={false}
      description="Read transform from OPC UA"
      label="Enable communications"
      onChange={onChange}
    />,
  )

  const checkbox = screen.getByRole('checkbox', { name: 'Enable communications' })
  expect(checkbox).not.toBeChecked()
  expect(checkbox).toHaveAccessibleDescription('Read transform from OPC UA')

  await user.click(checkbox)
  expect(onChange).toHaveBeenCalledWith(true)
})

it('exposes a visible status icon and text independently of its data state color', () => {
  render(<StatusBadgeV6 icon={TriangleAlert} label="Gateway degraded" state="warning" />)

  expect(screen.getByText('Gateway degraded')).toBeVisible()
  expect(screen.getByTestId('status-icon-v6')).toBeVisible()
  expect(screen.getByTestId('status-badge-v6')).toHaveAttribute('data-state', 'warning')
})

it('keeps a success badge understandable with its icon and visible label', () => {
  render(<StatusBadgeV6 icon={Check} label="Gateway connected" state="success" />)

  expect(screen.getByText('Gateway connected')).toBeVisible()
  expect(screen.getByTestId('status-icon-v6')).toBeVisible()
  expect(screen.getByTestId('status-badge-v6')).toHaveAttribute('data-state', 'success')
})
