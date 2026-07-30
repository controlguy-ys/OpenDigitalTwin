import { act, fireEvent, render, screen } from '@testing-library/react'
import { Maximize2 } from 'lucide-react'
import { describe, expect, it, vi } from 'vitest'

import { createAppCommandRegistryV6 } from '../../commands/v6/app-command-v6.js'
import { createWorkspaceLayoutStoreV6 } from '../../ui/v6/workspace-layout-store-v6.js'
import { WorkcellViewportV6 } from './WorkcellViewportV6.js'

describe('WorkcellViewportV6', () => {
  it('has one persistent registry-backed Main View button that swaps icon/name/tooltip without replacing its node', async () => {
    let maximized = false
    const execute = vi.fn(() => { maximized = !maximized })
    const registry = createAppCommandRegistryV6([{ id: 'view.main.maximize', get label() { return maximized ? 'Restore Main View' : 'Maximize Main View' }, get checked() { return maximized }, icon: 'Maximize2', visible: true, enabled: true, execute }])
    render(<WorkcellViewportV6 canvas={<canvas data-testid="stable-canvas" />} registry={registry} />)
    const before = screen.getByRole('button', { name: 'Maximize Main View' })
    expect(before).toHaveAttribute('aria-controls', 'v6-main-view')
    expect(before).toHaveAttribute('aria-pressed', 'false')
    fireEvent.click(before)
    const after = screen.getByRole('button', { name: 'Restore Main View' })
    expect(after).toBe(before)
    expect(after).toHaveAttribute('aria-pressed', 'true')
    expect(after.querySelector('svg')).toHaveClass('lucide-minimize-2')
    expect(document.activeElement).toBe(after)
    expect(screen.getByRole('tooltip')).toHaveTextContent('Restore Main View')
    expect(execute).toHaveBeenCalledOnce()
    expect(screen.getByTestId('stable-canvas')).toBeInTheDocument()
  })

  it('routes right clicks to context only and keeps no browser Fullscreen path', () => {
    const onContextMenu = vi.fn()
    const registry = createAppCommandRegistryV6([{ id: 'view.main.maximize', label: 'Maximize Main View', icon: 'Maximize2', checked: false, visible: true, enabled: true, execute: vi.fn() }])
    render(<WorkcellViewportV6 canvas={<canvas data-testid="stable-canvas" />} onContextMenu={onContextMenu} registry={registry} />)
    fireEvent.contextMenu(screen.getByTestId('v6-canvas-host'))
    expect(onContextMenu).toHaveBeenCalledOnce()
    expect(WorkcellViewportV6.toString()).not.toContain('requestFullscreen')
    expect(Maximize2).toBeDefined()
  })

  it('keeps the Canvas and toolbar button mounted when Task 3 Escape presentation restore changes the layout store', () => {
    const layoutStore = createWorkspaceLayoutStoreV6({ storage: null })
    const registry = createAppCommandRegistryV6([{
      id: 'view.main.maximize',
      get label() { return layoutStore.getState().mainViewPresentation === 'maximized' ? 'Restore Main View' : 'Maximize Main View' },
      get checked() { return layoutStore.getState().mainViewPresentation === 'maximized' },
      icon: 'Maximize2', visible: true, enabled: true,
      execute: () => layoutStore.getState().toggleMainViewMaximized(),
    }])
    render(<WorkcellViewportV6 canvas={<canvas data-testid="stable-canvas" />} layoutStore={layoutStore} registry={registry} />)
    const button = screen.getByRole('button', { name: 'Maximize Main View' })
    const canvas = screen.getByTestId('stable-canvas')
    fireEvent.click(button)
    act(() => layoutStore.getState().restoreMainView())
    expect(screen.getByRole('button', { name: 'Maximize Main View' })).toBe(button)
    expect(screen.getByTestId('stable-canvas')).toBe(canvas)
  })
})
