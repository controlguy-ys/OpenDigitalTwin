import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
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

  it('renders the exact action, checkbox, and radio role and checked-state matrix', () => {
    const cases: readonly [AppCommandV4['kind'], boolean | undefined, string, string | null][] = [
      ['action', undefined, 'menuitem', null], ['toggle', true, 'menuitemcheckbox', 'true'], ['radio', false, 'menuitemradio', 'false'],
    ]
    for (const [kind, checked, role, ariaChecked] of cases) {
      const { unmount } = render(<AppCommandMenuItemV4 commandBindings={bindings({ id: `kind.${kind}`, label: kind, section: 'view', kind, visible: true, enabled: true, ...(checked === undefined ? {} : { checked }), execute() {} })} commandId={`kind.${kind}`} onOutcome={vi.fn()} />)
      const item = screen.getByRole(role, { name: kind })
      if (ariaChecked === null) expect(item).not.toHaveAttribute('aria-checked')
      else expect(item).toHaveAttribute('aria-checked', ariaChecked)
      unmount()
    }
  })

  it('renders nothing for both absent and hidden command ids', () => {
    const visibleBindings = bindings({ id: 'available', label: 'Available', section: 'view', kind: 'action', visible: true, enabled: true, execute() {} })
    const absent = render(<AppCommandMenuItemV4 commandBindings={visibleBindings} commandId="missing" onOutcome={vi.fn()} />)
    expect(absent.container).toBeEmptyDOMElement()
    absent.unmount()
    const hidden = render(<AppCommandMenuItemV4 commandBindings={bindings({ id: 'hidden.again', label: 'Hidden', section: 'view', kind: 'action', visible: false, enabled: true, execute() {} })} commandId="hidden.again" onOutcome={vi.fn()} />)
    expect(hidden.container).toBeEmptyDOMElement()
  })

  it('keeps a disabled item focusable and blocks pointer, Enter, and Space activation', async () => {
    const user = userEvent.setup(); const execute = vi.fn()
    render(<AppCommandMenuItemV4 commandBindings={bindings({ id: 'context.disabled', label: 'Context disabled', section: 'view', kind: 'action', visible: true, enabled: false, disabledReason: 'No target.', execute })} commandId="context.disabled" onOutcome={vi.fn()} />)
    const item = screen.getByRole('menuitem', { name: 'Context disabled' })
    item.focus(); expect(item).toHaveFocus()
    await user.click(item); await user.keyboard('{Enter}'); await user.keyboard(' ')
    expect(item).toHaveAttribute('aria-disabled', 'true')
    expect(item).toHaveAttribute('title', 'No target.')
    expect(execute).not.toHaveBeenCalled()
  })

  it('keeps shortcut text visual-only and only marks destructive commands destructive', () => {
    const { rerender } = render(<AppCommandMenuItemV4 commandBindings={bindings({ id: 'shortcut', label: 'Shortcut', section: 'project', kind: 'action', visible: true, enabled: true, shortcut: 'Ctrl+S', execute() {} })} commandId="shortcut" onOutcome={vi.fn()} />)
    const item = screen.getByRole('menuitem', { name: 'Shortcut' })
    expect(item).toHaveAttribute('aria-keyshortcuts', 'Control+S')
    expect(screen.getByText('Ctrl+S')).toHaveAttribute('aria-hidden', 'true')
    expect(item).not.toHaveAttribute('data-destructive')
    rerender(<AppCommandMenuItemV4 commandBindings={bindings({ id: 'destructive', label: 'Destructive', section: 'project', kind: 'action', visible: true, enabled: true, destructive: true, execute() {} })} commandId="destructive" onOutcome={vi.fn()} />)
    expect(screen.getByRole('menuitem', { name: 'Destructive' })).toHaveAttribute('data-destructive', 'true')
  })

  it('invokes exactly once for each independent pointer, Enter, and Space activation', async () => {
    const activations: readonly ['pointer' | 'enter' | 'space', (item: HTMLElement, user: ReturnType<typeof userEvent.setup>) => Promise<void>][] = [
      ['pointer', async (item, user) => { await user.click(item) }],
      ['enter', async (item, user) => { item.focus(); await user.keyboard('{Enter}') }],
      ['space', async (item, user) => { item.focus(); await user.keyboard(' ') }],
    ]
    for (const [name, activate] of activations) {
      const user = userEvent.setup(); const execute = vi.fn(); const onOutcome = vi.fn()
      const { unmount } = render(<AppCommandMenuItemV4 commandBindings={bindings({ id: `activate.${name}`, label: name, section: 'view', kind: 'action', visible: true, enabled: true, execute })} commandId={`activate.${name}`} onOutcome={onOutcome} />)
      await activate(screen.getByRole('menuitem', { name }), user)
      await vi.waitFor(() => expect(onOutcome).toHaveBeenCalledWith(`activate.${name}`, 'completed'))
      expect(execute).toHaveBeenCalledTimes(1)
      unmount()
    }
  })

  it('shares pending state, clears it on settlement, and clears a runtime error on successful retry', async () => {
    let resolve!: () => void
    const deferred = new Promise<void>((done) => { resolve = done })
    const execute = vi.fn().mockReturnValueOnce(deferred).mockRejectedValueOnce(new Error('Retry me.')).mockResolvedValueOnce(undefined)
    const onOutcome = vi.fn()
    render(<AppCommandMenuItemV4 commandBindings={bindings({ id: 'retry', label: 'Retry', section: 'view', kind: 'action', visible: true, enabled: true, execute })} commandId="retry" onOutcome={onOutcome} />)
    const item = screen.getByRole('menuitem', { name: 'Retry' })
    fireEvent.click(item)
    expect(item).toHaveAttribute('aria-busy', 'true')
    expect(item).toHaveAttribute('data-pending', 'true')
    resolve()
    await vi.waitFor(() => expect(item).not.toHaveAttribute('aria-busy'))
    fireEvent.click(item)
    expect(await screen.findByRole('alert')).toHaveTextContent('Retry me.')
    fireEvent.click(item)
    await vi.waitFor(() => expect(onOutcome).toHaveBeenLastCalledWith('retry', 'completed'))
    expect(screen.queryByRole('alert')).toBeNull()
    expect(execute).toHaveBeenCalledTimes(3)
  })
})
