import { fireEvent, render, screen } from '@testing-library/react'
import { Circle } from 'lucide-react'
import { describe, expect, it, vi } from 'vitest'

import type { ConnectivityPresentationStateV1 } from '../../connectivity/v5/connectivity-presentation-store.js'
import { createAppCommandRegistryV6, createMainViewMaximizeCommandV6, type AppCommandSnapshotV6 } from '../../commands/v6/app-command-v6.js'
import { AppMenuBarV6 } from './AppMenuBarV6.js'
import { HeaderStatusV6 } from './HeaderStatusV6.js'
import { HelpOverlayV6 } from './HelpOverlayV6.js'
import { ModelToolboxV6 } from './ModelToolboxV6.js'

function command(id: AppCommandSnapshotV6['id'], label: string = id): AppCommandSnapshotV6 {
  return { id, label, enabled: true, visible: true, execute: vi.fn() }
}

describe('V6 command surfaces', () => {
  it('uses the same registry IDs for Model menu, Toolbox, and empty-viewport context seams', async () => {
    const addBox = command('model.addBox', 'Add Box')
    const addCylinder = command('model.addCylinder', 'Add Cylinder')
    const registry = createAppCommandRegistryV6([addBox, addCylinder])
    const context = vi.fn(async () => registry.invoke('model.addBox'))
    render(<><AppMenuBarV6 registry={registry} /><ModelToolboxV6 registry={registry} /><button data-command-id="model.addBox" onClick={() => void context()} type="button">Context Add Box</button></>)

    fireEvent.click(screen.getByRole('menuitem', { name: 'Model' }))
    const menuAddBox = screen.getByRole('menuitem', { name: 'Add Box' })
    const toolboxAddBox = screen.getByRole('button', { name: 'Add Box' })
    const contextAddBox = screen.getByRole('button', { name: 'Context Add Box' })
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
    render(<AppMenuBarV6 registry={registry} />)

    const viewTrigger = screen.getByRole('menuitem', { name: 'View' })
    fireEvent.click(viewTrigger)
    const maximize = screen.getByRole('menuitem', { name: 'Maximize Main View' })
    expect(maximize).toHaveAttribute('aria-checked', 'false')
    fireEvent.click(maximize)
    await vi.waitFor(() => expect(viewTrigger).toHaveFocus())
    fireEvent.click(viewTrigger)
    expect(screen.getByRole('menuitem', { name: 'Restore Main View' })).toHaveAttribute('aria-checked', 'true')
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

    expect(screen.getByTestId('v6-header-status')).toHaveAttribute('data-one-row', 'true')
    expect(screen.getByText('Gateway Online')).toBeVisible()
    expect(screen.getByText('OPC UA Off')).toBeVisible()
    expect(screen.queryByRole('button', { name: /OPC UA Settings|Connection Monitor|Binding Overview|Docker Run Guide|Add Box|Add Cylinder/u })).toBeNull()
  })

  it('dispatches Ctrl+S and F1 once, ignores editable/repeated/composition keys, and gives Escape transient priority', async () => {
    const save = command('project.save', 'Save')
    const controls = command('help.controls', 'Controls')
    let maximized = true
    const maximize = createMainViewMaximizeCommandV6({ isMainViewMaximized: () => maximized, toggleMainView: () => { maximized = false } })
    const registry = createAppCommandRegistryV6([save, controls, maximize])
    const closeTransient = vi.fn()
    render(<AppMenuBarV6 registry={registry} transientUi={{ hasActiveTransient: () => true, closeActiveTransient: closeTransient }} />)

    fireEvent.keyDown(document, { key: 's', ctrlKey: true })
    fireEvent.keyDown(document, { key: 'F1' })
    fireEvent.keyDown(document, { key: 's', ctrlKey: true, repeat: true })
    fireEvent.keyDown(document, { key: 'F1', isComposing: true })
    const input = document.createElement('input')
    document.body.append(input)
    fireEvent.keyDown(input, { key: 's', ctrlKey: true })
    fireEvent.keyDown(document, { key: 'Escape' })

    await vi.waitFor(() => expect(save.execute).toHaveBeenCalledOnce())
    expect(controls.execute).toHaveBeenCalledOnce()
    expect(closeTransient).toHaveBeenCalledOnce()
    expect(maximized).toBe(true)
  })

  it('restores Main View only after no transient UI is active and dispatches Shift+F10 through its seam', async () => {
    let maximized = true
    const requestContextMenu = vi.fn()
    const registry = createAppCommandRegistryV6([createMainViewMaximizeCommandV6({
      isMainViewMaximized: () => maximized,
      toggleMainView: () => { maximized = false },
    })])
    render(<AppMenuBarV6
      onRequestContextMenu={requestContextMenu}
      registry={registry}
      transientUi={{ hasActiveTransient: () => false, closeActiveTransient: vi.fn() }}
    />)

    fireEvent.keyDown(document, { key: 'Escape' })
    fireEvent.keyDown(document, { key: 'F10', shiftKey: true })

    await vi.waitFor(() => expect(maximized).toBe(false))
    expect(requestContextMenu).toHaveBeenCalledOnce()
  })

  it('renders the exact requested help topic and closes it', () => {
    const close = vi.fn()
    render(<HelpOverlayV6 request={{ kind: 'help', topic: 'controls' }} onClose={close} />)
    expect(screen.getByRole('dialog', { name: 'Controls' })).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'Close help' }))
    expect(close).toHaveBeenCalledOnce()
  })
})
