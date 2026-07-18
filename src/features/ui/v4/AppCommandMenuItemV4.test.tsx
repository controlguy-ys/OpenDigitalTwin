import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { createAppCommandBindingsV4, createAppCommandRuntimeV4 } from '../../commands/v4/app-command-runtime.js'
import { createAppCommandRegistryV4 } from '../../commands/v4/app-command-registry.js'
import type { AppCommandV4 } from '../../commands/v4/app-command.js'
import { AppCommandMenuItemV4 } from './AppCommandMenuItemV4.js'

function bindings(command: AppCommandV4) { return createAppCommandBindingsV4(createAppCommandRuntimeV4(createAppCommandRegistryV4([command]))) }
describe('AppCommandMenuItemV4', () => {
  it('renders semantic command state and invokes only once', async () => {
    const execute = vi.fn()
    const onOutcome = vi.fn()
    render(<AppCommandMenuItemV4 commandBindings={bindings({ id: 'toggle', label: 'Toggle', section: 'view', kind: 'toggle', visible: true, enabled: true, checked: true, shortcut: 'Ctrl+S', execute })} commandId="toggle" onOutcome={onOutcome} />)
    const item = screen.getByRole('menuitemcheckbox', { name: 'Toggle' })
    expect(item).toHaveAttribute('aria-checked', 'true')
    expect(item).toHaveAttribute('aria-keyshortcuts', 'Control+S')
    fireEvent.click(item)
    await vi.waitFor(() => expect(onOutcome).toHaveBeenCalledWith('toggle', 'completed'))
    expect(execute).toHaveBeenCalledTimes(1)
  })

  it('keeps disabled commands focusable and does not invoke them', () => {
    const execute = vi.fn()
    render(<AppCommandMenuItemV4 commandBindings={bindings({ id: 'disabled', label: 'Disabled', section: 'view', kind: 'action', visible: true, enabled: false, disabledReason: 'No selection.', execute })} commandId="disabled" onOutcome={vi.fn()} />)
    const item = screen.getByRole('menuitem', { name: 'Disabled' })
    expect(item).toHaveAttribute('aria-disabled', 'true')
    expect(item).toHaveAttribute('title', 'No selection.')
    fireEvent.click(item); fireEvent.keyDown(item, { key: 'Enter' })
    expect(execute).not.toHaveBeenCalled()
  })

  it('uses the runtime pending and error state without a local flag', async () => {
    let reject!: (error: Error) => void
    const deferred = new Promise<void>((_resolve, fail) => { reject = fail })
    const command: AppCommandV4 = { id: 'delete', label: 'Delete', section: 'home', kind: 'action', visible: true, enabled: true, destructive: true, execute: () => deferred }
    render(<AppCommandMenuItemV4 commandBindings={bindings(command)} commandId="delete" onOutcome={vi.fn()} />)
    const item = screen.getByRole('menuitem', { name: 'Delete' })
    fireEvent.click(item)
    expect(item).toHaveAttribute('aria-busy', 'true')
    expect(item).toHaveAttribute('data-destructive', 'true')
    fireEvent.click(item)
    reject(new Error('Expected failure.'))
    expect(await screen.findByRole('alert')).toHaveTextContent('Expected failure.')
    expect(item).toHaveAttribute('aria-describedby')
  })

  it('renders no item for absent or hidden commands', () => {
    const hidden: AppCommandV4 = { id: 'hidden', label: 'Hidden', section: 'view', kind: 'action', visible: false, enabled: true, execute() {} }
    const { container } = render(<AppCommandMenuItemV4 commandBindings={bindings(hidden)} commandId="hidden" onOutcome={vi.fn()} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('uses action and radio roles with checked state only on stateful commands', () => {
    const radio: AppCommandV4 = { id: 'radio', label: 'Server', section: 'connectivity', kind: 'radio', visible: true, enabled: true, checked: false, execute() {} }
    render(<AppCommandMenuItemV4 commandBindings={bindings(radio)} commandId="radio" onOutcome={vi.fn()} />)
    expect(screen.getByRole('menuitemradio', { name: 'Server' })).toHaveAttribute('aria-checked', 'false')
  })

  it('reports cancelled outcome without a local error', async () => {
    const outcome = vi.fn()
    render(<AppCommandMenuItemV4 commandBindings={bindings({ id: 'cancelled', label: 'cancelled', section: 'project', kind: 'action', visible: true, enabled: true, execute: () => 'cancelled' })} commandId="cancelled" onOutcome={outcome} />)
    fireEvent.click(screen.getByRole('menuitem', { name: 'cancelled' }))
    await vi.waitFor(() => expect(outcome).toHaveBeenCalledWith('cancelled', 'cancelled'))
    expect(screen.queryByRole('alert')).toBeNull()
  })
})
