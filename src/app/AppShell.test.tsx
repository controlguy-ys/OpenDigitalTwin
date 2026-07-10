import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { App } from './App'
import { AppShell } from './AppShell'

vi.mock('../features/scene/SceneCanvas', () => ({
  SceneCanvas: () => null,
}))

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

  it('exposes when scene-dependent controls are not ready', () => {
    render(<AppShell controlsDisabled viewport={<div>3D viewport</div>} />)

    const viewport = screen.getByLabelText('3D viewport')
    expect(viewport).toHaveAttribute('aria-busy', 'true')
    expect(viewport.closest('.app-shell')).toHaveAttribute(
      'data-controls-disabled',
      'true',
    )
    expect(screen.getByRole('button', { name: 'Import STEP' })).toBeEnabled()
  })

  it('keeps controls disabled without marking an error fallback as busy', () => {
    render(
      <AppShell
        controlsDisabled
        viewport={<div>3D viewport</div>}
        viewportBusy={false}
      />,
    )

    const viewport = screen.getByLabelText('3D viewport')
    expect(viewport).toHaveAttribute('aria-busy', 'false')
    expect(viewport.closest('.app-shell')).toHaveAttribute(
      'data-controls-disabled',
      'true',
    )
  })

  it('keeps scene-dependent controls gated while the canvas loads', () => {
    render(<App />)

    const viewport = screen.getByLabelText('3D viewport')
    expect(viewport).toHaveAttribute('aria-busy', 'true')
    expect(viewport.closest('.app-shell')).toHaveAttribute(
      'data-controls-disabled',
      'true',
    )
  })
})
