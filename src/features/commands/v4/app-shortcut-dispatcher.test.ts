import { describe, expect, it, vi } from 'vitest'
import { createAppCommandBindingsV4, createAppCommandRuntimeV4 } from './app-command-runtime.js'
import { createAppCommandRegistryV4 } from './app-command-registry.js'
import { createAppShortcutDispatcherV4 } from './app-shortcut-dispatcher.js'
describe('createAppShortcutDispatcherV4', () => {
  it('dispatches an exact shortcut once and disposes its one listener', async () => {
    const execute = vi.fn(); const addEventListener = vi.fn(); const removeEventListener = vi.fn(); let listener: ((event: KeyboardEvent) => void) | null = null
    addEventListener.mockImplementation((_type: string, value: (event: KeyboardEvent) => void) => { listener = value })
    const runtime = createAppCommandRuntimeV4(createAppCommandRegistryV4([{ id: 'project.save', label: 'Save', section: 'project', kind: 'action', visible: true, enabled: true, shortcut: 'Ctrl+S', execute }]))
    const dispatcher = createAppShortcutDispatcherV4({ target: { addEventListener, removeEventListener }, bindings: createAppCommandBindingsV4(runtime) })
    const event = new KeyboardEvent('keydown', { key: 's', ctrlKey: true, cancelable: true }); listener!(event); await vi.waitFor(() => expect(execute).toHaveBeenCalledTimes(1)); expect(event.defaultPrevented).toBe(true)
    dispatcher.dispose(); dispatcher.dispose(); expect(removeEventListener).toHaveBeenCalledTimes(1)
  })

  it('ignores editable, modifier-mismatched, hidden, and ambiguous commands', () => {
    let listener: ((event: KeyboardEvent) => void) | null = null; const execute = vi.fn()
    const runtime = createAppCommandRuntimeV4(createAppCommandRegistryV4([
      { id: 'view.home', label: 'Home', section: 'view', kind: 'action', visible: true, enabled: true, shortcut: 'H', execute },
      { id: 'project.hidden', label: 'Hidden', section: 'project', kind: 'action', visible: false, enabled: true, shortcut: 'Ctrl+S', execute },
    ]))
    createAppShortcutDispatcherV4({ target: { addEventListener: vi.fn((_name, callback) => { listener = callback as (event: KeyboardEvent) => void }), removeEventListener: vi.fn() }, bindings: createAppCommandBindingsV4(runtime) })
    const input = document.createElement('input'); const editable = new KeyboardEvent('keydown', { key: 'h', ctrlKey: true, cancelable: true }); Object.defineProperty(editable, 'target', { value: input }); listener!(new KeyboardEvent('keydown', { key: 'h', bubbles: true, cancelable: true })); listener!(editable); listener!(new KeyboardEvent('keydown', { key: 's', ctrlKey: true, cancelable: true }))
    expect(execute).toHaveBeenCalledTimes(1)
  })

  it('requires every modifier to match and ignores repeat, composition, and malformed shortcuts', () => {
    let listener: ((event: KeyboardEvent) => void) | null = null; const execute = vi.fn()
    const runtime = createAppCommandRuntimeV4(createAppCommandRegistryV4([
      { id: 'project.save', label: 'Save', section: 'project', kind: 'action', visible: true, enabled: true, shortcut: 'Ctrl+S', execute },
      { id: 'view.bad', label: 'Bad', section: 'view', kind: 'action', visible: true, enabled: true, shortcut: 'Ctrl+Alt+', execute },
    ]))
    createAppShortcutDispatcherV4({ target: { addEventListener: vi.fn((_name, callback) => { listener = callback as (event: KeyboardEvent) => void }), removeEventListener: vi.fn() }, bindings: createAppCommandBindingsV4(runtime) })
    listener!(new KeyboardEvent('keydown', { key: 's', ctrlKey: true, shiftKey: true, cancelable: true }))
    const repeated = new KeyboardEvent('keydown', { key: 's', ctrlKey: true, cancelable: true }); Object.defineProperty(repeated, 'repeat', { value: true }); listener!(repeated)
    const composing = new KeyboardEvent('keydown', { key: 's', ctrlKey: true, cancelable: true }); Object.defineProperty(composing, 'isComposing', { value: true }); listener!(composing)
    listener!(new KeyboardEvent('keydown', { key: '+', ctrlKey: true, altKey: true, cancelable: true }))
    expect(execute).not.toHaveBeenCalled()
  })

  it('does not invoke disabled, pending, or ambiguous candidates', async () => {
    let listener: ((event: KeyboardEvent) => void) | null = null; let resolve!: () => void; const pending = new Promise<void>((done) => { resolve = done }); const execute = vi.fn(() => pending)
    const runtime = createAppCommandRuntimeV4(createAppCommandRegistryV4([
      { id: 'project.save', label: 'Save', section: 'project', kind: 'action', visible: true, enabled: true, shortcut: 'Ctrl+S', execute },
      { id: 'view.disabled', label: 'Disabled', section: 'view', kind: 'action', visible: true, enabled: false, shortcut: 'F', execute },
      { id: 'view.a', label: 'A', section: 'view', kind: 'action', visible: true, enabled: true, shortcut: 'H', execute },
      { id: 'help.b', label: 'B', section: 'help', kind: 'action', visible: true, enabled: true, shortcut: 'H', execute },
    ]))
    createAppShortcutDispatcherV4({ target: { addEventListener: vi.fn((_name, callback) => { listener = callback as (event: KeyboardEvent) => void }), removeEventListener: vi.fn() }, bindings: createAppCommandBindingsV4(runtime) })
    listener!(new KeyboardEvent('keydown', { key: 'f', cancelable: true })); listener!(new KeyboardEvent('keydown', { key: 'h', cancelable: true })); listener!(new KeyboardEvent('keydown', { key: 's', ctrlKey: true, cancelable: true })); await vi.waitFor(() => expect(execute).toHaveBeenCalledTimes(1)); const pendingEvent = new KeyboardEvent('keydown', { key: 's', ctrlKey: true, cancelable: true }); listener!(pendingEvent); expect(pendingEvent.defaultPrevented).toBe(false); resolve()
  })

  it('reads the replacement registry on every keydown and leaves propagation alone', async () => {
    let listener: ((event: KeyboardEvent) => void) | null = null; const before = vi.fn(); const after = vi.fn()
    const runtime = createAppCommandRuntimeV4(createAppCommandRegistryV4([{ id: 'view.home', label: 'Before', section: 'view', kind: 'action', visible: true, enabled: true, shortcut: 'H', execute: before }]))
    createAppShortcutDispatcherV4({ target: { addEventListener: vi.fn((_name, callback) => { listener = callback as (event: KeyboardEvent) => void }), removeEventListener: vi.fn() }, bindings: createAppCommandBindingsV4(runtime) })
    runtime.replaceRegistry(createAppCommandRegistryV4([{ id: 'view.home', label: 'After', section: 'view', kind: 'action', visible: true, enabled: true, shortcut: 'H', execute: after }]))
    const event = new KeyboardEvent('keydown', { key: 'H', cancelable: true }); const stop = vi.spyOn(event, 'stopPropagation'); listener!(event); await vi.waitFor(() => expect(after).toHaveBeenCalledTimes(1)); expect(before).not.toHaveBeenCalled(); expect(stop).not.toHaveBeenCalled()
  })
})
