import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { AppShellV4 } from './AppShell.js'

describe('AppShellV4', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('renders the five bounded industrial workstation regions', () => {
    render(<AppShellV4 viewport={<div>3D viewport</div>} />)

    expect(screen.getByRole('banner')).toHaveTextContent('RobotSim')
    expect(screen.getByLabelText('Scene Assets')).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Scene Objects' })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Robot Jobs' })).toBeInTheDocument()
    expect(screen.getByLabelText('3D viewport')).toBeInTheDocument()
    expect(screen.getByLabelText('Inspector')).toBeInTheDocument()
    expect(screen.getByLabelText('Timeline and Events')).toBeInTheDocument()
  })

  it('exposes only Box, Cylinder, and Group from Add', async () => {
    const user = userEvent.setup()
    const createBox = vi.fn()
    const createCylinder = vi.fn()
    const createGroup = vi.fn()
    render(
      <AppShellV4
        onCreateBox={createBox}
        onCreateCylinder={createCylinder}
        onCreateGroup={createGroup}
        viewport={<div>3D viewport</div>}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'Add' }))
    expect(screen.getAllByRole('menuitem').map((item) => item.textContent)).toEqual([
      'Box',
      'Cylinder',
      'Group',
    ])
    expect(screen.queryByText('Import STEP')).not.toBeInTheDocument()
    expect(screen.queryByText('Import Robot')).not.toBeInTheDocument()
    expect(screen.queryByText('Linear Axis')).not.toBeInTheDocument()

    await user.click(screen.getByRole('menuitem', { name: 'Box' }))
    await user.click(screen.getByRole('button', { name: 'Add' }))
    await user.click(screen.getByRole('menuitem', { name: 'Cylinder' }))
    await user.click(screen.getByRole('button', { name: 'Add' }))
    await user.click(screen.getByRole('menuitem', { name: 'Group' }))

    expect(createBox).toHaveBeenCalledOnce()
    expect(createCylinder).toHaveBeenCalledOnce()
    expect(createGroup).toHaveBeenCalledOnce()
  })

  it('shows the selected Robot source as read-only text', () => {
    render(
      <AppShellV4
        robotSourceLabel="Simulation"
        viewport={<div>3D viewport</div>}
      />,
    )

    expect(screen.getByText('Joint source: Simulation')).toBeVisible()
    expect(screen.queryByRole('combobox', { name: 'Joint source' })).not.toBeInTheDocument()
  })

  it('opens the responsive drawers and bottom sheet from their controls', async () => {
    const user = userEvent.setup()
    render(<AppShellV4 viewport={<div>3D viewport</div>} />)

    const controls = [
      screen.getByRole('button', { name: 'Scene Assets drawer' }),
      screen.getByRole('button', { name: 'Inspector drawer' }),
      screen.getByRole('button', { name: 'Timeline and Events sheet' }),
    ]
    for (const control of controls) {
      expect(control).toHaveAttribute('aria-expanded', 'false')
      await user.click(control)
      expect(control).toHaveAttribute('aria-expanded', 'true')
    }
    expect(screen.getByLabelText('Scene Assets')).toHaveClass('is-open')
    expect(screen.getByLabelText('Inspector')).toHaveClass('is-open')
    expect(screen.getByLabelText('Timeline and Events')).toHaveClass('is-open')
  })

  it('collapses the desktop Inspector and returns its grid space', async () => {
    const user = userEvent.setup()
    localStorage.setItem('robotsim.inspectorDrawerOpen', 'true')
    render(<AppShellV4 inspector={<button type="button">Inspector action</button>} viewport={<div>3D viewport</div>} />)

    const inspector = screen.getByLabelText('Inspector')
    const shell = inspector.closest('.app-shell')
    const control = screen.getByRole('button', { name: 'Inspector drawer' })
    expect(inspector).not.toHaveAttribute('hidden')
    expect(shell).toHaveClass('is-inspector-open')

    await user.click(control)

    expect(control).toHaveAttribute('aria-expanded', 'false')
    expect(inspector).toHaveAttribute('hidden')
    expect(shell).not.toHaveClass('is-inspector-open')
    expect(localStorage.getItem('robotsim.inspectorDrawerOpen')).toBe('false')

    await user.click(control)
    expect(inspector).not.toHaveAttribute('hidden')
    expect(shell).toHaveClass('is-inspector-open')
  })

  it('keeps the document fixed while named work areas own scrolling', () => {
    render(
      <AppShellV4
        bottomRail={<div>Bottom content</div>}
        viewport={<div>3D viewport</div>}
      />,
    )

    expect(document.documentElement).toHaveStyle({ overflow: 'hidden' })
    expect(document.body).toHaveStyle({ overflow: 'hidden' })
    expect(screen.getByLabelText('3D viewport').closest('.app-shell')).toHaveStyle({
      height: '100dvh',
      overflow: 'hidden',
    })
    expect(screen.getByLabelText('Timeline and Events')).toContainElement(
      screen.getByText('Bottom content'),
    )
  })

  it('persists the bounded Scene and Job split without changing Project state', () => {
    render(
      <AppShellV4
        assetTree={<div>Scene tree</div>}
        jobTree={<div>Job tree</div>}
        viewport={<div>3D viewport</div>}
      />,
    )
    const splitter = screen.getByRole('separator', {
      name: 'Resize Scene Objects and Robot Jobs',
    })

    fireEvent.keyDown(splitter, { key: 'ArrowDown' })

    expect(splitter).toHaveAttribute('aria-valuenow', '61')
    expect(localStorage.getItem('robotsim.sidebarSplitPercent')).toBe('61')
  })

  it('separates control gating from the viewport error state and blocks Add', async () => {
    const user = userEvent.setup()
    const createBox = vi.fn()
    render(
      <AppShellV4
        controlsDisabled
        onCreateBox={createBox}
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
    const add = screen.getByRole('button', { name: 'Add' })
    expect(add).toBeDisabled()
    await user.click(add)
    expect(screen.queryByRole('menu', { name: 'Add' })).not.toBeInTheDocument()
    expect(createBox).not.toHaveBeenCalled()
  })
})
