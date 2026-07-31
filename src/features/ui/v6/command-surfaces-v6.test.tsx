import { fireEvent, render, screen, within } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { Circle } from 'lucide-react'
import { describe, expect, it, vi } from 'vitest'

import type { ConnectivityPresentationStateV1 } from '../../connectivity/v5/connectivity-presentation-store.js'
import { createAppCommandRegistryV6, createMainViewMaximizeCommandV6, type AppCommandSnapshotV6 } from '../../commands/v6/app-command-v6.js'
import { AppMenuBarV6 } from './AppMenuBarV6.js'
import { MainViewPaneToolbarCommandV6 } from './AppMenuBarV6.js'
import { CommandSurfaceControlV6 } from './CommandSurfaceControlV6.js'
import { HeaderStatusV6 } from './HeaderStatusV6.js'
import { HelpOverlayV6 } from './HelpOverlayV6.js'
import { ModelToolboxV6 } from './ModelToolboxV6.js'

function command(
  id: AppCommandSnapshotV6['id'],
  label: string = id,
  overrides: Partial<AppCommandSnapshotV6> = {},
): AppCommandSnapshotV6 {
  return { id, label, enabled: true, visible: true, execute: vi.fn(), ...overrides }
}

describe('V6 command surfaces', () => {
  it('uses the same registry IDs for Model menu, Toolbox, and empty-viewport context seams', async () => {
    const addBox = command('model.addBox', 'Add Box')
    const addCylinder = command('model.addCylinder', 'Add Cylinder')
    const registry = createAppCommandRegistryV6([addBox, addCylinder])
    const view = render(<>
      <AppMenuBarV6 registry={registry} />
      <ModelToolboxV6 registry={registry} />
      <div role="menu">
        <CommandSurfaceControlV6
          commandId="model.addBox"
          registry={registry}
          surface="viewport-context-menu"
        />
      </div>
    </>)

    fireEvent.click(screen.getByRole('menuitem', { name: 'Model' }))
    const menuAddBox = view.container.querySelector<HTMLElement>(
      '[data-command-surface="model-menu"][data-command-id="model.addBox"]',
    )!
    const toolboxAddBox = screen.getByRole('button', { name: 'Add Box' })
    const contextAddBox = view.container.querySelector<HTMLElement>(
      '[data-command-surface="viewport-context-menu"][data-command-id="model.addBox"]',
    )!
    expect(menuAddBox).toHaveAttribute('data-command-id', 'model.addBox')
    expect(toolboxAddBox).toHaveAttribute('data-command-id', 'model.addBox')
    expect(contextAddBox).toHaveAttribute('data-command-id', 'model.addBox')
    fireEvent.click(menuAddBox)
    fireEvent.click(toolboxAddBox)
    fireEvent.click(contextAddBox)
    await vi.waitFor(() => expect(addBox.execute).toHaveBeenCalledTimes(3))
  })

  it('shares checked Main View state and returns focus to the View menu trigger', async () => {
    let maximized = false
    const registry = createAppCommandRegistryV6([createMainViewMaximizeCommandV6({
      isMainViewMaximized: () => maximized,
      toggleMainView: () => { maximized = !maximized },
    })])
    render(<>
      <AppMenuBarV6 registry={registry} />
      <MainViewPaneToolbarCommandV6 registry={registry} />
    </>)

    const viewTrigger = screen.getByRole('menuitem', { name: 'View' })
    fireEvent.click(viewTrigger)
    const maximize = screen.getByRole('menuitemcheckbox', { name: 'Maximize Main View' })
    const toolbar = screen.getByRole('button', { name: 'Maximize Main View' })
    expect(maximize).toHaveAttribute('aria-checked', 'false')
    expect(toolbar).toHaveAttribute('data-command-id', 'view.main.maximize')
    expect(toolbar).toHaveAttribute('aria-pressed', 'false')
    fireEvent.click(toolbar)
    await vi.waitFor(() => expect(
      screen.getByRole('menuitemcheckbox', { name: 'Restore Main View' }),
    ).toHaveAttribute('aria-checked', 'true'))
    expect(toolbar).toHaveFocus()
    expect(screen.getByRole('button', { name: 'Restore Main View' })).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: 'Restore Main View' }))
    await vi.waitFor(() => expect(viewTrigger).toHaveFocus())
    fireEvent.click(viewTrigger)
    expect(screen.getByRole('menuitemcheckbox', { name: 'Maximize Main View' })).toHaveAttribute('aria-checked', 'false')
  })

  it('keeps the header compact and free of removed persistent command clusters', () => {
    const connectivity: ConnectivityPresentationStateV1 = {
      gateway: { state: 'online', label: 'Online', detail: 'Ready' },
      opcUa: { state: 'off', label: 'Off', detail: 'Disabled' },
      status: null,
      integrationDiagnostics: null,
      transportError: null,
      lastObservedAtMs: null,
    }
    render(<HeaderStatusV6
      connectivity={connectivity}
      simulation={{ icon: Circle, label: 'Simulation', state: 'neutral' }}
      projectName="Demo Cell"
      saveState="Saved"
    />)

    const header = screen.getByTestId('v6-header-status')
    expect(header).toHaveClass('v6-header-status')
    expect(header).not.toHaveAttribute('data-one-row')
    const css = readFileSync(resolve(process.cwd(), 'src/styles/v6/components.css'), 'utf8')
    const headerRule = css.match(/\.v6-header-status\s*\{([^}]*)\}/u)?.[1] ?? ''
    expect(headerRule).toMatch(/display:\s*flex/u)
    expect(headerRule).toMatch(/flex-wrap:\s*nowrap/u)
    expect(headerRule).toMatch(/min-width:\s*0/u)
    expect(headerRule).toMatch(/overflow:\s*hidden/u)
    expect(screen.getByText('Gateway Online')).toBeVisible()
    expect(screen.getByText('OPC UA Off')).toBeVisible()
    expect(screen.queryByRole('button', { name: /OPC UA Settings|Connection Monitor|Binding Overview|Docker Run Guide|Add Box|Add Cylinder/u })).toBeNull()
  })

  it('places all connectivity actions in the Connectivity menu and preserves the stable menu trigger for focus restoration', () => {
    const openSettings = vi.fn()
    const openMonitor = vi.fn()
    const openOverview = vi.fn()
    const openDocker = vi.fn()
    const registry = createAppCommandRegistryV6([])
    render(<AppMenuBarV6
      connectivity={{
        onOpenBindingOverview: openOverview,
        onOpenConnectionMonitor: openMonitor,
        onOpenDockerRunGuide: openDocker,
        onOpenOpcUaSettings: openSettings,
        projectAvailable: true,
      }}
      registry={registry}
    />)

    const trigger = screen.getByRole('menuitem', { name: 'Connectivity' })
    fireEvent.click(trigger)
    const menu = screen.getByRole('menu', { name: 'Connectivity menu' })
    expect(within(menu).getAllByRole('menuitem').map((item) => item.textContent)).toEqual([
      'OPC UA Settings', 'Connection Monitor', 'Binding Overview', 'Docker Run Guide',
    ])
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'OPC UA Settings' }))
    expect(openSettings).toHaveBeenCalledExactlyOnceWith(trigger)
    expect(screen.queryByRole('menu', { name: 'Connectivity menu' })).toBeNull()
  })

  it('dispatches Ctrl+S and F1 once, ignores editable/repeated/composition keys, and gives Escape transient priority', async () => {
    const save = command('project.save', 'Save')
    const controls = command('help.controls', 'Controls')
    let maximized = true
    const maximize = createMainViewMaximizeCommandV6({ isMainViewMaximized: () => maximized, toggleMainView: () => { maximized = false } })
    const registry = createAppCommandRegistryV6([save, controls, maximize])
    const closeTransient = vi.fn()
    const requestContextMenu = vi.fn()
    render(<AppMenuBarV6
      contextMenu={{
        resolveTarget: () => ({ kind: 'explorer-row', rowKey: 'row-focused' }),
        requestOpen: requestContextMenu,
      }}
      registry={registry}
      transientUi={{ hasActiveTransient: () => true, closeActiveTransient: closeTransient }}
    />)

    fireEvent.keyDown(document, { key: 's', ctrlKey: true })
    fireEvent.keyDown(document, { key: 'F1' })
    fireEvent.keyDown(document, { key: 's', ctrlKey: true, repeat: true })
    fireEvent.keyDown(document, { key: 'F1', isComposing: true })
    const input = document.createElement('input')
    document.body.append(input)
    expect(fireEvent.keyDown(input, { key: 's', ctrlKey: true })).toBe(false)
    expect(fireEvent.keyDown(input, { key: 'F1' })).toBe(false)
    expect(fireEvent.keyDown(input, { key: 'Escape' })).toBe(true)
    expect(fireEvent.keyDown(input, { key: 'F10', shiftKey: true })).toBe(true)
    fireEvent.keyDown(document, { key: 'Escape' })

    await vi.waitFor(() => expect(save.execute).toHaveBeenCalledTimes(2))
    expect(controls.execute).toHaveBeenCalledTimes(2)
    expect(closeTransient).toHaveBeenCalledOnce()
    expect(requestContextMenu).not.toHaveBeenCalled()
    expect(maximized).toBe(true)
  })

  it('uses roving top-level focus and opens and closes menus from the keyboard', async () => {
    const registry = createAppCommandRegistryV6([
      command('model.addBox', 'Add Box'),
      command('model.addCylinder', 'Add Cylinder'),
    ])
    render(<AppMenuBarV6 registry={registry} />)
    const project = screen.getByRole('menuitem', { name: 'Project' })
    const home = screen.getByRole('menuitem', { name: 'Home' })
    const model = screen.getByRole('menuitem', { name: 'Model' })

    expect(project).toHaveAttribute('tabindex', '0')
    expect(home).toHaveAttribute('tabindex', '-1')
    project.focus()
    fireEvent.keyDown(project, { key: 'ArrowRight' })
    expect(home).toHaveFocus()
    expect(home).toHaveAttribute('tabindex', '0')
    fireEvent.keyDown(home, { key: 'ArrowRight' })
    expect(model).toHaveFocus()
    fireEvent.keyDown(model, { key: 'ArrowDown' })
    await vi.waitFor(() => expect(screen.getByRole('menuitem', { name: 'Add Box' })).toHaveFocus())
    fireEvent.keyDown(screen.getByRole('menuitem', { name: 'Add Box' }), { key: 'Escape' })
    expect(model).toHaveFocus()
    expect(screen.queryByRole('menu', { name: 'Model menu' })).toBeNull()
    fireEvent.keyDown(model, { key: 'Enter' })
    expect(screen.getByRole('menu', { name: 'Model menu' })).toBeVisible()
  })

  it('uses radio roles and checked state for the exclusive theme commands', () => {
    const registry = createAppCommandRegistryV6([
      command('view.theme.system', 'System Theme', { checked: false }),
      command('view.theme.dark', 'Dark Theme', { checked: true }),
      command('view.theme.light', 'Light Theme', { checked: false }),
    ])
    render(<AppMenuBarV6 registry={registry} />)
    fireEvent.click(screen.getByRole('menuitem', { name: 'View' }))

    expect(screen.getByRole('menuitemradio', { name: 'System Theme' })).toHaveAttribute('aria-checked', 'false')
    expect(screen.getByRole('menuitemradio', { name: 'Dark Theme' })).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByRole('menuitemradio', { name: 'Light Theme' })).toHaveAttribute('aria-checked', 'false')
  })

  it('restores Main View only after no transient UI is active and dispatches Shift+F10 through its seam', async () => {
    let maximized = true
    const selectedTarget = {
      kind: 'selection',
      selection: { kind: 'entity', id: 'entity-selected' },
    } as const
    const requestContextMenu = vi.fn()
    const registry = createAppCommandRegistryV6([createMainViewMaximizeCommandV6({
      isMainViewMaximized: () => maximized,
      toggleMainView: () => { maximized = false },
    })])
    render(<AppMenuBarV6
      contextMenu={{
        resolveTarget: () => selectedTarget,
        requestOpen: requestContextMenu,
      }}
      registry={registry}
      transientUi={{ hasActiveTransient: () => false, closeActiveTransient: vi.fn() }}
    />)

    fireEvent.keyDown(document, { key: 'Escape' })
    fireEvent.keyDown(document, { key: 'F10', shiftKey: true })

    await vi.waitFor(() => expect(maximized).toBe(false))
    expect(requestContextMenu).toHaveBeenCalledExactlyOnceWith(selectedTarget)
  })

  it('renders the exact requested help topic and closes it', () => {
    const close = vi.fn()
    render(<HelpOverlayV6 request={{ kind: 'help', topic: 'controls' }} onClose={close} />)
    expect(screen.getByRole('dialog', { name: 'Controls' })).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'Close help' }))
    expect(close).toHaveBeenCalledOnce()
  })
})
