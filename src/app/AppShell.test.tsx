import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createBrowserProjectResourcesV4 } from '../features/project/project-store-browser.js'
import { createShellLayoutStoreV4, type ShellLayoutStoreV4 } from '../features/ui/v4/shell-layout-store.js'
import { BottomWorkspace } from '../features/ui/BottomWorkspace.js'
import { AppShellV4 } from './AppShell.js'

describe('AppShellV4', () => {
  let shellLayoutStore: ShellLayoutStoreV4

  beforeEach(() => {
    localStorage.clear()
    shellLayoutStore = createShellLayoutStoreV4({ storage: localStorage })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('renders the five bounded industrial workstation regions', () => {
    render(<AppShellV4 shellLayoutStore={shellLayoutStore} viewport={<div>3D viewport</div>} />)

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
        shellLayoutStore={shellLayoutStore}
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
        shellLayoutStore={shellLayoutStore}
        viewport={<div>3D viewport</div>}
      />,
    )

    expect(screen.getByText('Joint source: Simulation')).toBeVisible()
    expect(screen.queryByRole('combobox', { name: 'Joint source' })).not.toBeInTheDocument()
  })

  it('opens the responsive drawers and bottom sheet from their controls', async () => {
    const user = userEvent.setup()
    vi.stubGlobal('matchMedia', vi.fn((query: string) => ({
      matches: query === '(max-width: 1199px)',
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })))
    render(<AppShellV4 shellLayoutStore={shellLayoutStore} viewport={<div>3D viewport</div>} />)

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
    render(<AppShellV4 inspector={<button type="button">Inspector action</button>} shellLayoutStore={shellLayoutStore} viewport={<div>3D viewport</div>} />)

    const inspector = screen.getByLabelText('Inspector')
    const shell = inspector.closest('.app-shell')
    const control = screen.getByRole('button', { name: 'Inspector drawer' })
    expect(inspector).not.toHaveAttribute('hidden')
    expect(shell).toHaveClass('is-inspector-open')

    await user.click(control)

    expect(control).toHaveAttribute('aria-expanded', 'false')
    expect(inspector).toHaveAttribute('hidden')
    expect(shell).not.toHaveClass('is-inspector-open')
    expect(shellLayoutStore.getState().preferences.modes.wide.dockVisible.inspector).toBe(false)
    expect(localStorage.getItem('robotsim.inspectorDrawerOpen')).toBeNull()

    await user.click(control)
    expect(inspector).not.toHaveAttribute('hidden')
    expect(shell).toHaveClass('is-inspector-open')
  })

  it('keeps the document fixed while named work areas own scrolling', () => {
    render(
      <AppShellV4
        bottomRail={<div>Bottom content</div>}
        shellLayoutStore={shellLayoutStore}
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
        shellLayoutStore={shellLayoutStore}
        viewport={<div>3D viewport</div>}
      />,
    )
    const splitter = screen.getByRole('separator', {
      name: 'Resize Scene Objects and Robot Jobs',
    })

    fireEvent.keyDown(splitter, { key: 'ArrowDown' })

    expect(splitter).toHaveAttribute('aria-valuenow', '61')
    expect(shellLayoutStore.getState().preferences.sidebar.sceneJobSplitPercent).toBe(61)
    expect(localStorage.getItem('robotsim.sidebarSplitPercent')).toBeNull()
  })

  it('separates control gating from the viewport error state and blocks Add', async () => {
    const user = userEvent.setup()
    const createBox = vi.fn()
    render(
      <AppShellV4
        controlsDisabled
        onCreateBox={createBox}
        shellLayoutStore={shellLayoutStore}
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

  it('keeps migrated preferences in rendered Shell and Bottom consumers without recreating legacy keys', async () => {
    const user = userEvent.setup()
    vi.stubGlobal('matchMedia', vi.fn((query: string) => ({
      matches: query === '(min-width: 960px)',
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })))
    localStorage.clear()
    localStorage.setItem('robotsim.assetDrawerOpen', 'true')
    localStorage.setItem('robotsim.inspectorDrawerOpen', 'false')
    localStorage.setItem('robotsim.bottomDrawerOpen', 'true')
    localStorage.setItem('robotsim.sidebarSplitPercent', '67')
    localStorage.setItem('robotsim.bottomWorkspaceTab', 'collision')
    localStorage.setItem('robotsim.theme', 'dark')
    const resources = createBrowserProjectResourcesV4({
      resolveDefinitionGeometry: async () => null,
    })

    render(
      <AppShellV4
        bottomRail={<BottomWorkspace collision="Collision" shellLayoutStore={resources.shellLayoutStore} timeline="Timeline" />}
        shellLayoutStore={resources.shellLayoutStore}
        viewport={<div>3D viewport</div>}
      />,
    )

    expect(screen.getByLabelText('Inspector')).toHaveAttribute('hidden')
    expect(screen.getByRole('separator')).toHaveAttribute('aria-valuenow', '67')
    expect(screen.getByRole('tabpanel', { name: 'Collision' })).toBeVisible()
    expect(document.documentElement).toHaveAttribute('data-theme', 'dark')

    fireEvent.keyDown(screen.getByRole('separator'), { key: 'ArrowDown' })
    await user.selectOptions(screen.getByRole('combobox', { name: 'Theme' }), 'light')
    await user.click(screen.getByRole('tab', { name: 'Timeline' }))

    expect(resources.shellLayoutStore.getState().preferences).toMatchObject({
      sidebar: { sceneJobSplitPercent: 68 },
      bottom: { activeTab: 'timeline' },
      theme: 'light',
    })
    expect([...Array(localStorage.length).keys()].map((index) => localStorage.key(index))).toEqual([
      'robotsim.workspace-preferences.v1',
    ])
  })
})
