import { fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { describe, expect, it } from 'vitest'
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
describe('AppMenuBarV4', () => {
  it('opens a single accessible popup and restores trigger focus on escape', () => { render(<Harness />); const trigger = screen.getByRole('menuitem', { name: 'Project' }); fireEvent.keyDown(trigger, { key: 'ArrowDown' }); expect(screen.getByRole('menu', { name: 'Project' })).toBeInTheDocument(); fireEvent.keyDown(screen.getByRole('menu', { name: 'Project' }), { key: 'Escape' }); expect(trigger).toHaveFocus() })
  it('uses roving top-level keyboard navigation while a section is open', async () => { render(<Harness />); const project = screen.getByRole('menuitem', { name: 'Project' }); fireEvent.keyDown(project, { key: 'ArrowRight' }); expect(screen.getByRole('menuitem', { name: 'View' })).toHaveFocus(); fireEvent.keyDown(screen.getByRole('menuitem', { name: 'View' }), { key: 'ArrowDown' }); fireEvent.keyDown(screen.getByRole('menuitem', { name: 'View' }), { key: 'ArrowLeft' }); expect(await screen.findByRole('menu', { name: 'Project' })).toBeInTheDocument() })
  it('dismisses with capture outside pointerdown without trapping the outside control', () => { render(<Harness />); fireEvent.click(screen.getByRole('menuitem', { name: 'Project' })); fireEvent.pointerDown(screen.getByRole('button', { name: 'Outside' })); expect(screen.queryByRole('menu', { name: 'Project' })).toBeNull(); expect(document.querySelector('[inert]')).toBeNull() })
  it('opens from Enter, Space, ArrowDown, and ArrowUp with menu ARIA relationships', () => { for (const key of ['Enter', ' ', 'ArrowDown', 'ArrowUp']) { const { unmount } = render(<Harness />); const trigger = screen.getByRole('menuitem', { name: 'Project' }); fireEvent.keyDown(trigger, { key }); expect(trigger).toHaveAttribute('aria-expanded', 'true'); expect(screen.getByRole('menu', { name: 'Project' })).toHaveAttribute('aria-labelledby', trigger.id); unmount() } })
  it('closes on Tab without preventing document traversal', () => { render(<Harness />); const trigger = screen.getByRole('menuitem', { name: 'Project' }); fireEvent.keyDown(trigger, { key: 'ArrowDown' }); const event = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }); screen.getByRole('menu', { name: 'Project' }).dispatchEvent(event); expect(event.defaultPrevented).toBe(false); expect(screen.queryByRole('menu', { name: 'Project' })).toBeNull() })
  it('wraps closed top-level focus in both directions', () => { render(<Harness />); const project = screen.getByRole('menuitem', { name: 'Project' }); fireEvent.keyDown(project, { key: 'ArrowLeft' }); expect(screen.getByRole('menuitem', { name: 'View' })).toHaveFocus(); fireEvent.keyDown(screen.getByRole('menuitem', { name: 'View' }), { key: 'ArrowRight' }); expect(project).toHaveFocus() })
})
