import { fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { describe, expect, it } from 'vitest'
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
})
