import { createEvent, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { createAppCommandBindingsV4, createAppCommandRuntimeV4 } from '../../commands/v4/app-command-runtime.js'
import { createAppCommandRegistryV4 } from '../../commands/v4/app-command-registry.js'
import type { AppCommandSectionV4 } from '../../commands/v4/app-command.js'
import { CompactAppMenuV4 } from './CompactAppMenuV4.js'
import type { AppMenuSectionModelV4 } from './app-menu-model.js'
const model: readonly AppMenuSectionModelV4[] = Object.freeze([{ id: 'view', label: 'View', children: Object.freeze([{ kind: 'command' as const, commandId: 'view.home' }, { kind: 'submenu' as const, id: 'view.camera', label: 'Camera', children: Object.freeze([{ kind: 'command' as const, commandId: 'view.fit' }]) }]) }])
const bindings = createAppCommandBindingsV4(createAppCommandRuntimeV4(createAppCommandRegistryV4([{ id: 'view.home', label: 'Home View', section: 'view', kind: 'action', visible: true, enabled: true, execute() {} }, { id: 'view.fit', label: 'Fit All', section: 'view', kind: 'action', visible: true, enabled: true, execute() {} }])))
function Harness() { const [open, setOpen] = useState<AppCommandSectionV4 | null>(null); return <><button>Outside</button><CompactAppMenuV4 commandBindings={bindings} model={model} openSection={open} onOpenSectionChange={setOpen} onPreviewSection={() => undefined} /></> }
describe('CompactAppMenuV4', () => {
  it('opens categories without a menubar', () => { render(<Harness />); fireEvent.click(screen.getByRole('button', { name: 'Menu' })); expect(screen.queryByRole('menubar')).toBeNull(); fireEvent.keyDown(screen.getByRole('menuitem', { name: 'View' }), { key: 'Enter' }); expect(screen.getByRole('menuitem', { name: 'Home View' })).toBeInTheDocument() })
  it('returns from category/submenu and closes on escape or outside pointerdown', async () => { render(<Harness />); const menu = screen.getByRole('button', { name: 'Menu' }); fireEvent.click(menu); fireEvent.click(screen.getByRole('menuitem', { name: 'View' })); fireEvent.keyDown(screen.getByRole('menuitem', { name: 'Camera' }), { key: 'ArrowRight' }); await Promise.resolve(); fireEvent.keyDown(screen.getByRole('menu', { name: 'Camera' }), { key: 'ArrowLeft' }); expect(screen.getByRole('menuitem', { name: 'Camera' })).toHaveFocus(); fireEvent.keyDown(screen.getByRole('menu', { name: 'View' }), { key: 'ArrowLeft' }); expect(screen.getByRole('menuitem', { name: 'View' })).toBeInTheDocument(); fireEvent.keyDown(screen.getByRole('menu', { name: 'Application menu' }), { key: 'Escape' }); expect(menu).toHaveFocus(); fireEvent.click(menu); fireEvent.pointerDown(screen.getByRole('button', { name: 'Outside' })); expect(screen.queryByRole('menu', { name: 'Application menu' })).toBeNull() })
  it('exposes a disclosure and collapsed category trigger semantics without a stale target', () => { render(<Harness />); const disclosure = screen.getByRole('button', { name: 'Menu' }); expect(disclosure).toHaveAttribute('aria-haspopup', 'menu'); fireEvent.click(disclosure); const category = screen.getByRole('menuitem', { name: 'View' }); expect(category).toHaveAttribute('aria-expanded', 'false'); expect(category).not.toHaveAttribute('aria-controls'); expect(category).toHaveAttribute('aria-haspopup', 'menu') })
  it('navigates categories with Home End and closes on Tab', () => { render(<Harness />); fireEvent.click(screen.getByRole('button', { name: 'Menu' })); const root = screen.getByRole('menu', { name: 'Application menu' }); fireEvent.keyDown(root, { key: 'Home' }); expect(screen.getByRole('menuitem', { name: 'View' })).toHaveFocus(); fireEvent.keyDown(root, { key: 'Tab' }); expect(screen.queryByRole('menu', { name: 'Application menu' })).toBeNull() })

  it('keeps an active category trigger linked to its live labelled section menu and rebinds focus on back', async () => {
    render(<Harness />)
    fireEvent.click(screen.getByRole('button', { name: 'Menu' }))
    const category = screen.getByRole('menuitem', { name: 'View' })
    fireEvent.click(category)
    const section = await screen.findByRole('menu', { name: 'View' })
    const activeCategory = screen.getByRole('menuitem', { name: 'View' })
    expect(activeCategory).toHaveAttribute('aria-expanded', 'true')
    expect(activeCategory).toHaveAttribute('aria-controls', section.id)
    expect(section).toHaveAttribute('aria-labelledby', activeCategory.id)
    fireEvent.keyDown(section, { key: 'ArrowLeft' })
    await waitFor(() => expect(screen.getByRole('menuitem', { name: 'View' })).toHaveFocus())
  })

  it('keeps an open submenu across an equivalent model replacement', async () => {
    const equivalent = Object.freeze([{ id: 'view' as const, label: 'View', children: Object.freeze([{ kind: 'command' as const, commandId: 'view.home' }, { kind: 'submenu' as const, id: 'view.camera', label: 'Camera', children: Object.freeze([{ kind: 'command' as const, commandId: 'view.fit' }]) }]) }])
    function Controlled({ currentModel }: { currentModel: readonly AppMenuSectionModelV4[] }) { const [open, setOpen] = useState<AppCommandSectionV4 | null>(null); return <CompactAppMenuV4 commandBindings={bindings} model={currentModel} openSection={open} onOpenSectionChange={setOpen} onPreviewSection={() => undefined} /> }
    const { rerender } = render(<Controlled currentModel={model} />)
    fireEvent.click(screen.getByRole('button', { name: 'Menu' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'View' }))
    fireEvent.keyDown(screen.getByRole('menuitem', { name: 'Camera' }), { key: 'ArrowRight' })
    expect(await screen.findByRole('menu', { name: 'Camera' })).toBeInTheDocument()
    rerender(<Controlled currentModel={equivalent} />)
    expect(screen.getByRole('menu', { name: 'Camera' })).toBeInTheDocument()
  })

  it('keeps the disclosure and category root consistent while an invalid controlled section is cleared', async () => {
    const onOpenSectionChange = vi.fn()
    const alternate = Object.freeze([{ id: 'project' as const, label: 'Project', children: Object.freeze([{ kind: 'command' as const, commandId: 'view.home' }]) }])
    render(<CompactAppMenuV4 commandBindings={bindings} model={alternate} openSection="view" onOpenSectionChange={onOpenSectionChange} onPreviewSection={() => undefined} />)
    expect(await screen.findByRole('menu', { name: 'Application menu' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'Project' })).toBeInTheDocument()
    await waitFor(() => expect(onOpenSectionChange).toHaveBeenCalledWith(null))
  })

  it('uses the filtered model order for category roving and opens each category through pointer, Enter, Space, and ArrowRight', async () => {
    const multiModel: readonly AppMenuSectionModelV4[] = Object.freeze([
      { id: 'project', label: 'Project', children: Object.freeze([{ kind: 'command' as const, commandId: 'project.new' }]) },
      { id: 'view', label: 'View', children: Object.freeze([{ kind: 'command' as const, commandId: 'view.home' }]) },
    ])
    const multiBindings = createAppCommandBindingsV4(createAppCommandRuntimeV4(createAppCommandRegistryV4([
      { id: 'project.new', label: 'New Project', section: 'project', kind: 'action', visible: true, enabled: true, execute() {} },
      { id: 'view.home', label: 'Home View', section: 'view', kind: 'action', visible: true, enabled: true, execute() {} },
    ])))
    function MultiHarness() { const [open, setOpen] = useState<AppCommandSectionV4 | null>(null); return <CompactAppMenuV4 commandBindings={multiBindings} model={multiModel} openSection={open} onOpenSectionChange={setOpen} onPreviewSection={() => undefined} /> }
    render(<MultiHarness />)
    fireEvent.click(screen.getByRole('button', { name: 'Menu' }))
    const root = screen.getByRole('menu', { name: 'Application menu' })
    await waitFor(() => expect(screen.getByRole('menuitem', { name: 'Project' })).toHaveFocus())
    fireEvent.keyDown(root, { key: 'End' }); expect(screen.getByRole('menuitem', { name: 'View' })).toHaveFocus()
    fireEvent.keyDown(root, { key: 'ArrowDown' }); expect(screen.getByRole('menuitem', { name: 'Project' })).toHaveFocus()
    fireEvent.keyDown(root, { key: 'ArrowUp' }); expect(screen.getByRole('menuitem', { name: 'View' })).toHaveFocus()
    fireEvent.keyDown(root, { key: 'Home' }); expect(screen.getByRole('menuitem', { name: 'Project' })).toHaveFocus()
    fireEvent.keyDown(screen.getByRole('menuitem', { name: 'Project' }), { key: 'Enter' })
    expect(await screen.findByRole('menu', { name: 'Project' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'New Project' })).toHaveFocus()
  })

  it('renders every model category in exact canonical order before opening its exact section root', async () => {
    const ids = ['project', 'home', 'model', 'job', 'simulation', 'connectivity', 'view', 'help'] as const
    const labels = ['Project', 'Home', 'Model', 'Job', 'Simulation', 'Connectivity', 'View', 'Help'] as const
    const allModel: readonly AppMenuSectionModelV4[] = Object.freeze(ids.map((id, index) => Object.freeze({ id, label: labels[index]!, children: Object.freeze([{ kind: 'command' as const, commandId: `${id}.only` }]) })))
    const allBindings = createAppCommandBindingsV4(createAppCommandRuntimeV4(createAppCommandRegistryV4(ids.map((id) => ({ id: `${id}.only`, label: `${id} only`, section: id, kind: 'action' as const, visible: true, enabled: true, execute() {} })))))
    function AllHarness() { const [open, setOpen] = useState<AppCommandSectionV4 | null>(null); return <CompactAppMenuV4 commandBindings={allBindings} model={allModel} openSection={open} onOpenSectionChange={setOpen} onPreviewSection={() => undefined} /> }
    render(<AllHarness />)
    fireEvent.click(screen.getByRole('button', { name: 'Menu' }))
    expect(screen.getAllByRole('menuitem').map((item) => item.textContent?.trim())).toEqual(labels)
    fireEvent.click(screen.getByRole('menuitem', { name: 'Connectivity' }))
    const section = await screen.findByRole('menu', { name: 'Connectivity' })
    expect(section).toContainElement(screen.getByRole('menuitem', { name: 'connectivity only' }))
  })

  it('preserves the compact category-to-section hierarchy and opens the current category by every supported method', async () => {
    const methods: readonly [string, (category: HTMLElement) => void][] = [
      ['pointer', (category) => fireEvent.click(category)], ['Enter', (category) => fireEvent.keyDown(category, { key: 'Enter' })], ['Space', (category) => fireEvent.keyDown(category, { key: ' ' })], ['ArrowRight', (category) => fireEvent.keyDown(category, { key: 'ArrowRight' })],
    ]
    for (const [_name, open] of methods) {
      const { unmount } = render(<Harness />)
      fireEvent.click(screen.getByRole('button', { name: 'Menu' }))
      open(screen.getByRole('menuitem', { name: 'View' }))
      const section = await screen.findByRole('menu', { name: 'View' })
      expect(section).toContainElement(screen.getByRole('menuitem', { name: 'Home View' }))
      expect(section).toContainElement(screen.getByRole('menuitem', { name: 'Camera' }))
      expect(screen.getAllByRole('menuitem', { name: 'View' })).toHaveLength(1)
      unmount()
    }
  })

  it('keeps nested focus inside the Task 7 submenu before each exact ArrowLeft back step', async () => {
    render(<Harness />)
    fireEvent.click(screen.getByRole('button', { name: 'Menu' }))
    fireEvent.keyDown(screen.getByRole('menuitem', { name: 'View' }), { key: 'ArrowRight' })
    const camera = screen.getByRole('menuitem', { name: 'Camera' })
    fireEvent.keyDown(camera, { key: 'ArrowRight' })
    const nested = await screen.findByRole('menu', { name: 'Camera' })
    expect(nested.parentElement).toHaveClass('app-menu-flyout-layer-v4')
    expect(screen.getByRole('menu', { name: 'View' }).querySelector('.app-menu-list-v4')).not.toBeNull()
    expect(screen.getByRole('menuitem', { name: 'Fit All' })).toHaveFocus()
    fireEvent.keyDown(nested, { key: 'ArrowLeft' })
    expect(camera).toHaveFocus()
    fireEvent.keyDown(screen.getByRole('menu', { name: 'View' }), { key: 'ArrowLeft' })
    await waitFor(() => expect(screen.getByRole('menuitem', { name: 'View' })).toHaveFocus())
  })

  it('closes nested Tab and Shift+Tab without preventing default, and outside capture closes before its click action', async () => {
    const action = vi.fn()
    function OutsideHarness() { const [open, setOpen] = useState<AppCommandSectionV4 | null>(null); return <><button onClick={(event) => { event.currentTarget.focus(); action() }}>Outside action</button><CompactAppMenuV4 commandBindings={bindings} model={model} openSection={open} onOpenSectionChange={setOpen} onPreviewSection={() => undefined} /></> }
    render(<OutsideHarness />)
    fireEvent.click(screen.getByRole('button', { name: 'Menu' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'View' }))
    fireEvent.keyDown(screen.getByRole('menuitem', { name: 'Camera' }), { key: 'ArrowRight' })
    const nested = await screen.findByRole('menu', { name: 'Camera' })
    const tab = createEvent.keyDown(nested, { key: 'Tab', shiftKey: true, cancelable: true })
    fireEvent(nested, tab)
    expect(tab.defaultPrevented).toBe(false)
    expect(screen.queryByRole('menu', { name: 'Application menu' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Menu' }))
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Outside action' }))
    fireEvent.click(screen.getByRole('button', { name: 'Outside action' }))
    expect(action).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('button', { name: 'Outside action' })).toHaveFocus()
    expect(document.querySelector('[inert], [role="dialog"], [data-backdrop]')).toBeNull()
  })

  it('closes only completed compact commands and publishes exact controlled preview transitions on removal', async () => {
    const previews = vi.fn()
    const complete = vi.fn()
    const singleBindings = createAppCommandBindingsV4(createAppCommandRuntimeV4(createAppCommandRegistryV4([{ id: 'view.home', label: 'Home View', section: 'view', kind: 'action', visible: true, enabled: true, execute: complete }])))
    function Controlled({ currentModel }: { currentModel: readonly AppMenuSectionModelV4[] }) { const [open, setOpen] = useState<AppCommandSectionV4 | null>(null); return <CompactAppMenuV4 commandBindings={singleBindings} model={currentModel} openSection={open} onOpenSectionChange={setOpen} onPreviewSection={previews} /> }
    const simpleModel: readonly AppMenuSectionModelV4[] = Object.freeze([{ id: 'view', label: 'View', children: Object.freeze([{ kind: 'command' as const, commandId: 'view.home' }]) }])
    const { rerender } = render(<Controlled currentModel={simpleModel} />)
    await waitFor(() => expect(previews.mock.calls.map(([section]) => section)).toEqual([null]))
    fireEvent.click(screen.getByRole('button', { name: 'Menu' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'View' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Home View' }))
    await waitFor(() => expect(complete).toHaveBeenCalledTimes(1))
    expect(screen.queryByRole('menu', { name: 'Application menu' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Menu' })).toHaveFocus()
    await waitFor(() => expect(previews.mock.calls.map(([section]) => section)).toEqual([null, 'view', null]))
    fireEvent.click(screen.getByRole('button', { name: 'Menu' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'View' }))
    expect(await screen.findByRole('menu', { name: 'View' })).toBeInTheDocument()
    await waitFor(() => expect(previews.mock.calls.map(([section]) => section)).toEqual([null, 'view', null, 'view']))
    rerender(<Controlled currentModel={Object.freeze([])} />)
    await waitFor(() => expect(previews.mock.calls.map(([section]) => section)).toEqual([null, 'view', null, 'view', null]))
  })

  it('keeps cancelled and failed compact outcomes open on the exact current section', async () => {
    const commands = [
      { id: 'view.cancelled', label: 'Cancelled', section: 'view' as const, kind: 'action' as const, visible: true, enabled: true, execute: () => 'cancelled' as const },
      { id: 'view.failed', label: 'Failed', section: 'view' as const, kind: 'action' as const, visible: true, enabled: true, execute: () => { throw new Error('Failed.') } },
    ]
    const outcomeModel: readonly AppMenuSectionModelV4[] = Object.freeze([{ id: 'view', label: 'View', children: Object.freeze(commands.map(({ id }) => ({ kind: 'command' as const, commandId: id }))) }])
    const outcomeBindings = createAppCommandBindingsV4(createAppCommandRuntimeV4(createAppCommandRegistryV4(commands)))
    function OutcomeHarness() { const [open, setOpen] = useState<AppCommandSectionV4 | null>(null); return <CompactAppMenuV4 commandBindings={outcomeBindings} model={outcomeModel} openSection={open} onOpenSectionChange={setOpen} onPreviewSection={() => undefined} /> }
    render(<OutcomeHarness />)
    for (const name of ['Cancelled', 'Failed'] as const) {
      fireEvent.click(screen.getByRole('button', { name: 'Menu' }))
      fireEvent.click(screen.getByRole('menuitem', { name: 'View' }))
      fireEvent.click(screen.getByRole('menuitem', { name }))
      await waitFor(() => expect(screen.getByRole('menu', { name: 'View' })).toBeInTheDocument())
      fireEvent.keyDown(screen.getByRole('menu', { name: 'View' }), { key: 'Escape' })
    }
  })

  it('keeps an ignored compact runtime outcome open without creating a local error', async () => {
    const ignored = vi.fn(async () => 'ignored' as const)
    const command = { id: 'view.ignored', label: 'Ignored', section: 'view' as const, kind: 'action' as const, visible: true, enabled: true, execute() {} }
    const registry = createAppCommandRegistryV4([command])
    const state = Object.freeze({ pendingCommandIds: new Set<string>(), errorByCommandId: new Map<string, string>() })
    const ignoredBindings = {
      runtime: { getState: () => state, getRegistry: () => registry, subscribe: () => () => undefined, replaceRegistry: () => undefined, invoke: ignored, dispose: () => undefined },
      getRegistry: () => registry,
    }
    const ignoredModel: readonly AppMenuSectionModelV4[] = Object.freeze([{ id: 'view', label: 'View', children: Object.freeze([{ kind: 'command' as const, commandId: command.id }]) }])
    function IgnoredHarness() { const [open, setOpen] = useState<AppCommandSectionV4 | null>(null); return <CompactAppMenuV4 commandBindings={ignoredBindings} model={ignoredModel} openSection={open} onOpenSectionChange={setOpen} onPreviewSection={() => undefined} /> }
    render(<IgnoredHarness />)
    fireEvent.click(screen.getByRole('button', { name: 'Menu' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'View' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Ignored' }))
    await waitFor(() => expect(ignored).toHaveBeenCalledWith('view.ignored'))
    expect(screen.getByRole('menu', { name: 'View' })).toBeInTheDocument()
    expect(screen.queryByRole('alert')).toBeNull()
  })
})
