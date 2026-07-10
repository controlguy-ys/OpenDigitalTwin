import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { App } from './App'
import { AppShell } from './AppShell'

describe('AppShell', () => {
  it('renders the five industrial workstation regions', () => {
    render(<AppShell viewport={<div>3D viewport</div>} />)
    expect(screen.getByRole('banner')).toHaveTextContent('RobotSim')
    expect(screen.getByLabelText('Scene Assets')).toBeInTheDocument()
    expect(screen.getByLabelText('3D viewport')).toBeInTheDocument()
    expect(screen.getByLabelText('Inspector')).toBeInTheDocument()
    expect(screen.getByLabelText('Timeline and Events')).toBeInTheDocument()
  })

  it('opens the responsive drawers and bottom sheet from their controls', async () => {
    const user = userEvent.setup()
    const { getByLabelText, getByRole } = render(
      <AppShell viewport={<div>3D viewport</div>} />,
    )

    const controls = [
      getByRole('button', { name: 'Scene Assets drawer' }),
      getByRole('button', { name: 'Inspector drawer' }),
      getByRole('button', { name: 'Timeline and Events sheet' }),
    ]

    for (const control of controls) {
      expect(control).toHaveAttribute('aria-expanded', 'false')
      await user.click(control)
      expect(control).toHaveAttribute('aria-expanded', 'true')
      await user.click(control)
      expect(control).toHaveAttribute('aria-expanded', 'false')
      await user.click(control)
    }

    expect(getByLabelText('Scene Assets')).toHaveClass('is-open')
    expect(getByLabelText('Inspector')).toHaveClass('is-open')
    expect(getByLabelText('Timeline and Events')).toHaveClass('is-open')
  })

  it('keeps the loading message as a screen-reader-only status', () => {
    render(<App />)

    const status = screen.getByRole('status')
    expect(status).toHaveTextContent('Preparing 3D workcell…')
    expect(status).toHaveClass('visually-hidden')
  })
})
