import { act, fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { createAppCommandRegistryV6 } from '../../commands/v6/app-command-v6.js'
import { ApplicationShellV6 } from '../../ui/v6/ApplicationShellV6.js'
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

  it('routes pointer input through the approved interaction boundary and never pans on right click', () => {
    const interactions = {
      select: vi.fn(), orbit: vi.fn(), pan: vi.fn(), context: vi.fn(), zoom: vi.fn(),
    }
    const registry = createAppCommandRegistryV6([{ id: 'view.main.maximize', label: 'Maximize Main View', icon: 'Maximize2', checked: false, visible: true, enabled: true, execute: vi.fn() }])
    render(<WorkcellViewportV6 canvas={<canvas data-testid="stable-canvas" />} interaction={interactions} registry={registry} />)
    const host = screen.getByTestId('v6-canvas-host')

    fireEvent.pointerDown(host, { button: 0 })
    fireEvent.pointerDown(host, { button: 1 })
    fireEvent.pointerDown(host, { button: 1, shiftKey: true })
    fireEvent.pointerDown(host, { button: 2 })
    fireEvent.wheel(host, { deltaY: 120 })

    expect(interactions.select).toHaveBeenCalledOnce()
    expect(interactions.orbit).toHaveBeenCalledOnce()
    expect(interactions.pan).toHaveBeenCalledOnce()
    expect(interactions.context).toHaveBeenCalledOnce()
    expect(interactions.zoom).toHaveBeenCalledOnce()
    expect(interactions.pan).not.toHaveBeenCalledWith(expect.objectContaining({ button: 2 }))
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

  it('preserves the Canvas and explicit runtime probes across icon and Escape restoration', () => {
    const layoutStore = createWorkspaceLayoutStoreV6({ storage: null })
    const registry = createAppCommandRegistryV6([{
      id: 'view.main.maximize',
      get label() { return layoutStore.getState().mainViewPresentation === 'maximized' ? 'Restore Main View' : 'Maximize Main View' },
      get checked() { return layoutStore.getState().mainViewPresentation === 'maximized' },
      icon: 'Maximize2', visible: true, enabled: true,
      execute: () => layoutStore.getState().toggleMainViewMaximized(),
    }])
    const home = vi.fn()
    const fitAll = vi.fn()
    const requestFullscreen = vi.fn()
    const probes = {
      camera: { position: [3, 4, 5], target: [0, 0, 0] },
      selection: { kind: 'robot', id: 'robot-1' },
      activeJob: 'job-17', runtimeEpoch: 12, subscriptionCount: 4, projectRevision: 'revision-9',
    }
    const before = structuredClone(probes)
    Object.defineProperty(document.documentElement, 'requestFullscreen', { configurable: true, value: requestFullscreen })
    render(
      <ApplicationShellV6
        bottom={<div>Bottom</div>}
        explorer={<div>Explorer</div>}
        header={<div>Header</div>}
        inspector={<div>Inspector</div>}
        store={layoutStore}
        toolbox={<div>Toolbox</div>}
        viewport={<WorkcellViewportV6 canvas={<canvas data-testid="preserved-canvas" />} layoutStore={layoutStore} registry={registry} />}
        workspaceHeightPx={800}
        workspaceWidthPx={1440}
      />,
    )
    const canvas = screen.getByTestId('preserved-canvas')
    const button = screen.getByRole('button', { name: 'Maximize Main View' })

    fireEvent.click(button)
    fireEvent.click(screen.getByRole('button', { name: 'Restore Main View' }))
    fireEvent.click(button)
    fireEvent.keyDown(document, { key: 'Escape' })

    expect(screen.getByTestId('preserved-canvas')).toBe(canvas)
    expect(screen.getByRole('button', { name: 'Maximize Main View' })).toBe(button)
    expect(probes).toEqual(before)
    expect(home).not.toHaveBeenCalled()
    expect(fitAll).not.toHaveBeenCalled()
    expect(requestFullscreen).not.toHaveBeenCalled()
  })
})
