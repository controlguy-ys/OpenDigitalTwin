import { createEvent, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { StrictMode, useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { createAppCommandBindingsV4, createAppCommandRuntimeV4 } from '../../commands/v4/app-command-runtime.js'
import { createAppCommandRegistryV4 } from '../../commands/v4/app-command-registry.js'
import type { AppCommandSectionV4 } from '../../commands/v4/app-command.js'
import { AppMenuBarV4 } from './AppMenuBarV4.js'
import type { AppMenuSectionModelV4 } from './app-menu-model.js'

const model: readonly AppMenuSectionModelV4[] = Object.freeze([
  { id: 'project', label: 'Project', children: Object.freeze([{ kind: 'command' as const, commandId: 'project.save' }, { kind: 'submenu' as const, id: 'project.samples', label: 'Samples', children: Object.freeze([{ kind: 'command' as const, commandId: 'project.sample' }]) }]) },
  { id: 'view', label: 'View', children: Object.freeze([{ kind: 'command' as const, commandId: 'view.home' }]) },
])
const bindings = createAppCommandBindingsV4(createAppCommandRuntimeV4(createAppCommandRegistryV4([
  { id: 'project.save', label: 'Save Project', section: 'project', kind: 'action', visible: true, enabled: true, execute() {} }, { id: 'project.sample', label: 'Sample', section: 'project', kind: 'action', visible: true, enabled: true, execute() {} }, { id: 'view.home', label: 'Home View', section: 'view', kind: 'action', visible: true, enabled: true, execute() {} },
])))
function Harness({ preview = () => undefined }: { preview?: (section: AppCommandSectionV4 | null) => void }) { const [open, setOpen] = useState<AppCommandSectionV4 | null>(null); return <><button>Outside</button><AppMenuBarV4 commandBindings={bindings} model={model} openSection={open} onOpenSectionChange={setOpen} onPreviewSection={preview} /></> }

function rect(left: number, top: number, width: number, height: number): DOMRect {
  return { x: left, y: top, left, top, width, height, right: left + width, bottom: top + height, toJSON: () => ({}) } as DOMRect
}

function installDesktopFlyoutRects(options: {
  readonly viewport: readonly [number, number]
  readonly owner: DOMRect
  readonly trigger: DOMRect
  readonly flyout: DOMRect
}): () => void {
  const width = Object.getOwnPropertyDescriptor(window, 'innerWidth')
  const height = Object.getOwnPropertyDescriptor(window, 'innerHeight')
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: options.viewport[0] })
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: options.viewport[1] })
  const spy = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    if (this.classList.contains('app-menu-submenu-popup-v4')) return options.flyout
    if (this.id.endsWith('-project-menu')) return options.owner
    if (this.id.endsWith('-project.samples-trigger')) return options.trigger
    return rect(0, 0, 0, 0)
  })
  return () => {
    spy.mockRestore()
    if (width !== undefined) Object.defineProperty(window, 'innerWidth', width)
    if (height !== undefined) Object.defineProperty(window, 'innerHeight', height)
  }
}

async function openDesktopSamples(): Promise<HTMLElement> {
  fireEvent.keyDown(screen.getByRole('menuitem', { name: 'Project' }), { key: 'ArrowDown' })
  fireEvent.keyDown(screen.getByRole('menuitem', { name: 'Samples' }), { key: 'ArrowRight' })
  return screen.findByRole('menu', { name: 'Samples' })
}
describe('AppMenuBarV4', () => {
  it('opens a single accessible popup and restores trigger focus on escape', () => { render(<Harness />); const trigger = screen.getByRole('menuitem', { name: 'Project' }); fireEvent.keyDown(trigger, { key: 'ArrowDown' }); expect(screen.getByRole('menu', { name: 'Project' })).toBeInTheDocument(); fireEvent.keyDown(screen.getByRole('menu', { name: 'Project' }), { key: 'Escape' }); expect(trigger).toHaveFocus() })
  it('uses roving top-level keyboard navigation while a section is open', async () => { render(<Harness />); const project = screen.getByRole('menuitem', { name: 'Project' }); fireEvent.keyDown(project, { key: 'ArrowRight' }); expect(screen.getByRole('menuitem', { name: 'View' })).toHaveFocus(); fireEvent.keyDown(screen.getByRole('menuitem', { name: 'View' }), { key: 'ArrowDown' }); fireEvent.keyDown(screen.getByRole('menuitem', { name: 'View' }), { key: 'ArrowLeft' }); expect(await screen.findByRole('menu', { name: 'Project' })).toBeInTheDocument() })
  it('dismisses with capture outside pointerdown without trapping the outside control', () => { render(<Harness />); fireEvent.click(screen.getByRole('menuitem', { name: 'Project' })); fireEvent.pointerDown(screen.getByRole('button', { name: 'Outside' })); expect(screen.queryByRole('menu', { name: 'Project' })).toBeNull(); expect(document.querySelector('[inert]')).toBeNull() })
  it('opens from Enter, Space, ArrowDown, and ArrowUp with menu ARIA relationships', () => { for (const key of ['Enter', ' ', 'ArrowDown', 'ArrowUp']) { const { unmount } = render(<Harness />); const trigger = screen.getByRole('menuitem', { name: 'Project' }); fireEvent.keyDown(trigger, { key }); expect(trigger).toHaveAttribute('aria-expanded', 'true'); expect(screen.getByRole('menu', { name: 'Project' })).toHaveAttribute('aria-labelledby', trigger.id); unmount() } })
  it('closes on Tab without preventing document traversal', () => { render(<Harness />); const trigger = screen.getByRole('menuitem', { name: 'Project' }); fireEvent.keyDown(trigger, { key: 'ArrowDown' }); fireEvent.keyDown(screen.getByRole('menu', { name: 'Project' }), { key: 'Tab' }); expect(screen.queryByRole('menu', { name: 'Project' })).toBeNull() })
  it('wraps closed top-level focus in both directions', () => { render(<Harness />); const project = screen.getByRole('menuitem', { name: 'Project' }); fireEvent.keyDown(project, { key: 'ArrowLeft' }); expect(screen.getByRole('menuitem', { name: 'View' })).toHaveFocus(); fireEvent.keyDown(screen.getByRole('menuitem', { name: 'View' }), { key: 'ArrowRight' }); expect(project).toHaveFocus() })

  it('closes only a nested submenu on ArrowLeft and restores its trigger focus', async () => {
    render(<Harness />)
    fireEvent.keyDown(screen.getByRole('menuitem', { name: 'Project' }), { key: 'ArrowDown' })
    const samples = screen.getByRole('menuitem', { name: 'Samples' })
    fireEvent.keyDown(samples, { key: 'ArrowRight' })
    const nested = await screen.findByRole('menu', { name: 'Samples' })
    expect(nested.parentElement).toHaveClass('app-menu-flyout-layer-v4')
    expect(screen.getByRole('menu', { name: 'Project' }).querySelector('.app-menu-list-v4')).not.toBeNull()
    fireEvent.keyDown(nested, { key: 'ArrowLeft' })
    expect(samples).toHaveFocus()
    expect(screen.queryByRole('menu', { name: 'Samples' })).toBeNull()
    expect(screen.getByRole('menu', { name: 'Project' })).toBeInTheDocument()
  })

  it('switches to the previous global section from a root submenu trigger on ArrowLeft', async () => {
    render(<Harness />)
    fireEvent.keyDown(screen.getByRole('menuitem', { name: 'Project' }), { key: 'ArrowDown' })
    fireEvent.keyDown(screen.getByRole('menuitem', { name: 'Samples' }), { key: 'ArrowLeft' })
    expect(await screen.findByRole('menu', { name: 'View' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'Home View' })).toHaveFocus()
  })

  it('opens with every supported trigger and sends focus to the requested first or last root item', async () => {
    const cases: readonly [string, (trigger: HTMLElement) => void, string][] = [
      ['pointer', (trigger) => fireEvent.click(trigger), 'Save Project'],
      ['Enter', (trigger) => fireEvent.keyDown(trigger, { key: 'Enter' }), 'Save Project'],
      ['Space', (trigger) => fireEvent.keyDown(trigger, { key: ' ' }), 'Save Project'],
      ['ArrowDown', (trigger) => fireEvent.keyDown(trigger, { key: 'ArrowDown' }), 'Save Project'],
      ['ArrowUp', (trigger) => fireEvent.keyDown(trigger, { key: 'ArrowUp' }), 'Samples'],
    ]
    for (const [_name, open, focused] of cases) {
      const { unmount } = render(<Harness />)
      open(screen.getByRole('menuitem', { name: 'Project' }))
      await waitFor(() => expect(screen.getByRole('menuitem', { name: focused })).toHaveFocus())
      unmount()
    }
  })

  it('wraps root roving navigation and switches sections from a focused root command', async () => {
    render(<Harness />)
    fireEvent.keyDown(screen.getByRole('menuitem', { name: 'Project' }), { key: 'ArrowDown' })
    const projectMenu = screen.getByRole('menu', { name: 'Project' })
    const save = screen.getByRole('menuitem', { name: 'Save Project' })
    fireEvent.keyDown(projectMenu, { key: 'ArrowUp' })
    expect(screen.getByRole('menuitem', { name: 'Samples' })).toHaveFocus()
    fireEvent.keyDown(projectMenu, { key: 'Home' })
    expect(save).toHaveFocus()
    fireEvent.keyDown(save, { key: 'ArrowRight' })
    expect(await screen.findByRole('menu', { name: 'View' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'Home View' })).toHaveFocus()
  })

  it('keeps a disabled root command in the roving order and focusable at Home and End', () => {
    const disabledBindings = createAppCommandBindingsV4(createAppCommandRuntimeV4(createAppCommandRegistryV4([
      { id: 'project.save', label: 'Save Project', section: 'project', kind: 'action', visible: true, enabled: false, disabledReason: 'Unavailable.', execute() {} },
      { id: 'project.sample', label: 'Sample', section: 'project', kind: 'action', visible: true, enabled: true, execute() {} },
      { id: 'view.home', label: 'Home View', section: 'view', kind: 'action', visible: true, enabled: true, execute() {} },
    ])))
    function DisabledHarness() { const [open, setOpen] = useState<AppCommandSectionV4 | null>(null); return <AppMenuBarV4 commandBindings={disabledBindings} model={model} openSection={open} onOpenSectionChange={setOpen} onPreviewSection={() => undefined} /> }
    render(<DisabledHarness />)
    fireEvent.keyDown(screen.getByRole('menuitem', { name: 'Project' }), { key: 'ArrowDown' })
    const popup = screen.getByRole('menu', { name: 'Project' })
    const disabled = screen.getByRole('menuitem', { name: 'Save Project' })
    expect(disabled).toHaveAttribute('aria-disabled', 'true')
    expect(disabled).toHaveFocus()
    fireEvent.keyDown(popup, { key: 'End' }); expect(screen.getByRole('menuitem', { name: 'Samples' })).toHaveFocus()
    fireEvent.keyDown(popup, { key: 'Home' }); expect(disabled).toHaveFocus()
  })

  it('closes from nested Tab and Shift+Tab without preventing default or restoring the trigger', async () => {
    render(<Harness />)
    fireEvent.keyDown(screen.getByRole('menuitem', { name: 'Project' }), { key: 'ArrowDown' })
    fireEvent.keyDown(screen.getByRole('menuitem', { name: 'Samples' }), { key: 'ArrowRight' })
    const nested = await screen.findByRole('menu', { name: 'Samples' })
    const tab = createEvent.keyDown(nested, { key: 'Tab', shiftKey: true, cancelable: true })
    fireEvent(nested, tab)
    expect(tab.defaultPrevented).toBe(false)
    expect(screen.queryByRole('menu', { name: 'Project' })).toBeNull()
    expect(screen.getByRole('menuitem', { name: 'Project' })).not.toHaveFocus()
  })

  it('closes only completed command outcomes and keeps cancelled and failed outcomes anchored', async () => {
    const commands = [
      { id: 'project.completed', label: 'Completed', section: 'project' as const, kind: 'action' as const, visible: true, enabled: true, execute() {} },
      { id: 'project.cancelled', label: 'Cancelled', section: 'project' as const, kind: 'action' as const, visible: true, enabled: true, execute: () => 'cancelled' as const },
      { id: 'project.failed', label: 'Failed', section: 'project' as const, kind: 'action' as const, visible: true, enabled: true, execute: () => { throw new Error('Nope.') } },
    ]
    const outcomeModel: readonly AppMenuSectionModelV4[] = Object.freeze([{ id: 'project', label: 'Project', children: Object.freeze(commands.map(({ id }) => ({ kind: 'command' as const, commandId: id }))) }])
    const outcomeBindings = createAppCommandBindingsV4(createAppCommandRuntimeV4(createAppCommandRegistryV4(commands)))
    function OutcomeHarness() { const [open, setOpen] = useState<AppCommandSectionV4 | null>(null); return <AppMenuBarV4 commandBindings={outcomeBindings} model={outcomeModel} openSection={open} onOpenSectionChange={setOpen} onPreviewSection={() => undefined} /> }
    render(<OutcomeHarness />)
    const trigger = screen.getByRole('menuitem', { name: 'Project' })
    for (const name of ['Cancelled', 'Failed'] as const) {
      fireEvent.keyDown(trigger, { key: 'ArrowDown' })
      fireEvent.click(screen.getByRole('menuitem', { name }))
      await waitFor(() => expect(screen.getByRole('menu', { name: 'Project' })).toBeInTheDocument())
      fireEvent.keyDown(screen.getByRole('menu', { name: 'Project' }), { key: 'Escape' })
    }
    fireEvent.keyDown(trigger, { key: 'ArrowDown' })
    fireEvent.click(screen.getByRole('menuitem', { name: 'Completed' }))
    await waitFor(() => expect(screen.queryByRole('menu', { name: 'Project' })).toBeNull())
    expect(trigger).toHaveFocus()
  })

  it('publishes committed preview changes once through StrictMode callback churn and closes before outside click focus/action', async () => {
    const previews = vi.fn(); const action = vi.fn()
    function StrictHarness({ currentModel = model }: { currentModel?: readonly AppMenuSectionModelV4[] }) {
      const [open, setOpen] = useState<AppCommandSectionV4 | null>(null)
      const [revision, setRevision] = useState(0)
      return <><button onClick={(event) => { event.currentTarget.focus(); action() }}>Outside</button><button onClick={() => setRevision((value) => value + 1)}>Churn {revision}</button><AppMenuBarV4 commandBindings={bindings} model={currentModel} openSection={open} onOpenSectionChange={setOpen} onPreviewSection={(section) => previews(section)} /></>
    }
    const { rerender } = render(<StrictMode><StrictHarness /></StrictMode>)
    await waitFor(() => expect(previews.mock.calls.map(([section]) => section)).toEqual([null]))
    fireEvent.click(screen.getByRole('button', { name: /Churn/ }))
    fireEvent.keyDown(screen.getByRole('menuitem', { name: 'Project' }), { key: 'ArrowDown' })
    await waitFor(() => expect(previews).toHaveBeenCalledWith('project'))
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Outside' }))
    fireEvent.click(screen.getByRole('button', { name: 'Outside' }))
    expect(action).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('button', { name: 'Outside' })).toHaveFocus()
    expect(document.querySelector('[inert], [role="dialog"], [data-backdrop]')).toBeNull()
    rerender(<StrictMode><StrictHarness currentModel={model} /></StrictMode>)
    await waitFor(() => expect(previews.mock.calls.map(([section]) => section)).toEqual([null, 'project', null]))
  })

  it('requests closure and publishes null when a controlled open section disappears from the model', async () => {
    const previews = vi.fn()
    function RemovalHarness({ currentModel }: { currentModel: readonly AppMenuSectionModelV4[] }) {
      const [open, setOpen] = useState<AppCommandSectionV4 | null>('project')
      return <AppMenuBarV4 commandBindings={bindings} model={currentModel} openSection={open} onOpenSectionChange={setOpen} onPreviewSection={previews} />
    }
    const { rerender } = render(<RemovalHarness currentModel={model} />)
    expect(await screen.findByRole('menu', { name: 'Project' })).toBeInTheDocument()
    rerender(<RemovalHarness currentModel={Object.freeze([model[1]!])} />)
    await waitFor(() => expect(screen.queryByRole('menu', { name: 'Project' })).toBeNull())
    await waitFor(() => expect(previews.mock.calls.map(([section]) => section)).toEqual(['project', null]))
  })

  it('keeps an ignored runtime outcome anchored just like cancelled and failed outcomes', async () => {
    const ignored = vi.fn(async () => 'ignored' as const)
    const command = { id: 'project.ignored', label: 'Ignored', section: 'project' as const, kind: 'action' as const, visible: true, enabled: true, execute() {} }
    const registry = createAppCommandRegistryV4([command])
    const state = Object.freeze({ pendingCommandIds: new Set<string>(), errorByCommandId: new Map<string, string>() })
    const ignoredBindings = {
      runtime: { getState: () => state, getRegistry: () => registry, subscribe: () => () => undefined, replaceRegistry: () => undefined, invoke: ignored, dispose: () => undefined },
      getRegistry: () => registry,
    }
    const ignoredModel: readonly AppMenuSectionModelV4[] = Object.freeze([{ id: 'project', label: 'Project', children: Object.freeze([{ kind: 'command' as const, commandId: command.id }]) }])
    function IgnoredHarness() { const [open, setOpen] = useState<AppCommandSectionV4 | null>(null); return <AppMenuBarV4 commandBindings={ignoredBindings} model={ignoredModel} openSection={open} onOpenSectionChange={setOpen} onPreviewSection={() => undefined} /> }
    render(<IgnoredHarness />)
    fireEvent.keyDown(screen.getByRole('menuitem', { name: 'Project' }), { key: 'ArrowDown' })
    fireEvent.click(screen.getByRole('menuitem', { name: 'Ignored' }))
    await waitFor(() => expect(ignored).toHaveBeenCalledWith('project.ignored'))
    expect(screen.getByRole('menu', { name: 'Project' })).toBeInTheDocument()
  })

  it('places a desktop flyout to the right with a viewport-relative remaining height', async () => {
    const restore = installDesktopFlyoutRects({ viewport: [1000, 700], owner: rect(100, 100, 250, 300), trigger: rect(200, 180, 120, 32), flyout: rect(0, 0, 210, 96) })
    try {
      render(<Harness />)
      const nested = await openDesktopSamples()
      await waitFor(() => expect(nested).toHaveStyle({ left: '223px', top: '76px', width: '210px', maxHeight: '516px' }))
    } finally { restore() }
  })

  it('flips a desktop flyout left when its right edge lacks viewport space', async () => {
    const restore = installDesktopFlyoutRects({ viewport: [500, 700], owner: rect(100, 100, 300, 300), trigger: rect(300, 180, 100, 32), flyout: rect(0, 0, 210, 96) })
    try {
      render(<Harness />)
      const nested = await openDesktopSamples()
      await waitFor(() => expect(nested).toHaveStyle({ left: '-13px', top: '76px', width: '210px', maxHeight: '516px' }))
    } finally { restore() }
  })

  it('clamps a desktop flyout width and x-position in a narrow viewport', async () => {
    const restore = installDesktopFlyoutRects({ viewport: [176, 500], owner: rect(100, 50, 76, 300), trigger: rect(150, 100, 20, 32), flyout: rect(0, 0, 210, 96) })
    try {
      render(<Harness />)
      const nested = await openDesktopSamples()
      await waitFor(() => expect(nested).toHaveStyle({ left: '-92px', top: '46px', width: '160px', maxWidth: '160px', maxHeight: '396px' }))
    } finally { restore() }
  })

  it('clamps a low desktop flyout to the remaining viewport height from its positive trigger offset', async () => {
    const restore = installDesktopFlyoutRects({ viewport: [1000, 320], owner: rect(100, 60, 250, 250), trigger: rect(200, 285, 100, 32), flyout: rect(0, 0, 210, 96) })
    try {
      render(<Harness />)
      const nested = await openDesktopSamples()
      await waitFor(() => expect(nested).toHaveStyle({ left: '203px', top: '221px', maxHeight: '31px' }))
    } finally { restore() }
  })
})
