import { fireEvent, render, screen } from '@testing-library/react'
import { useEffect } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { ApplicationShellV6 } from './ApplicationShellV6.js'
import { createWorkspaceLayoutStoreV6, type WorkspaceStorageV6 } from './workspace-layout-store-v6.js'

function renderShell(storage: WorkspaceStorageV6 | null = null) {
  const store = createWorkspaceLayoutStoreV6({ storage })
  let mounts = 0
  function Viewport() {
    useEffect(() => { mounts += 1 }, [])
    return <div data-testid="viewport">Stable viewport</div>
  }
  render(
    <ApplicationShellV6
      store={store}
      workspaceHeightPx={800}
      workspaceWidthPx={1440}
      header={<div>Header</div>}
      explorer={<div>Explorer</div>}
      inspector={<div>Inspector</div>}
      bottom={<div>Bottom</div>}
      toolbox={<div>Toolbox</div>}
      viewport={<Viewport />}
    />,
  )
  return { store, get mounts() { return mounts } }
}

describe('ApplicationShellV6', () => {
  it('keeps the same viewport node mounted through resizing, dock changes, maximize, restore, and Escape', () => {
    const view = renderShell()
    const viewport = screen.getByTestId('viewport')
    view.store.getState().setDockSize('explorer', 360)
    view.store.getState().setDockVisible('wide', 'explorer', false)
    view.store.getState().setDockVisible('wide', 'explorer', true)
    fireEvent.click(screen.getByRole('button', { name: 'Maximize Main View' }))
    const restore = screen.getByRole('button', { name: 'Restore Main View' })
    fireEvent.click(restore)
    fireEvent.click(screen.getByRole('button', { name: 'Maximize Main View' }))
    fireEvent.keyDown(document, { key: 'Escape' })

    expect(screen.getByTestId('viewport')).toBe(viewport)
    expect(view.mounts).toBe(1)
  })

  it('restores exact panel preferences and retains focus on the persistent presentation control', () => {
    const view = renderShell()
    view.store.getState().setDockSize('explorer', 360)
    view.store.getState().setDockSize('inspector', 410)
    view.store.getState().setDockVisible('wide', 'bottom', false)
    const before = structuredClone(view.store.getState().preferences)
    const button = screen.getByRole('button', { name: 'Maximize Main View' })
    fireEvent.click(button)
    expect(document.activeElement).toBe(button)
    fireEvent.click(button)

    expect(view.store.getState().preferences).toEqual(before)
    expect(document.activeElement).toBe(button)
  })

  it('masks mounted chrome from accessibility and does not call fullscreen or storage for presentation toggles', () => {
    const requestFullscreen = vi.fn()
    const storage: WorkspaceStorageV6 = {
      getItem: () => null,
      setItem: vi.fn(),
      removeItem: vi.fn(),
    }
    Object.defineProperty(document.documentElement, 'requestFullscreen', { configurable: true, value: requestFullscreen })
    const view = renderShell(storage)
    const shell = screen.getByTestId('v6-application-shell')
    fireEvent.click(screen.getByRole('button', { name: 'Maximize Main View' }))

    expect(shell).toHaveAttribute('data-main-view-presentation', 'maximized')
    expect(screen.getByTestId('v6-header')).toHaveAttribute('aria-hidden', 'true')
    expect(screen.getByTestId('v6-explorer')).toHaveAttribute('inert')
    expect(requestFullscreen).not.toHaveBeenCalled()
    expect(storage.setItem).not.toHaveBeenCalled()
    expect(view.store.getState().mainViewPresentation).toBe('maximized')
  })

  it('provides accessible resize handles with pointer capture, keyboard increments, reset, and Escape release', () => {
    const view = renderShell()
    const handle = screen.getByRole('separator', { name: 'Resize Scene Explorer' })
    const capture = vi.fn()
    const release = vi.fn()
    Object.assign(handle, { setPointerCapture: capture, releasePointerCapture: release, hasPointerCapture: () => true })
    fireEvent.pointerDown(handle, { button: 0, clientX: 100, pointerId: 4 })
    fireEvent.pointerMove(handle, { clientX: 124, pointerId: 4 })
    expect(capture).toHaveBeenCalledWith(4)
    expect(view.store.getState().preferences.explorerWidthPx).toBe(304)
    fireEvent.keyDown(handle, { key: 'ArrowRight' })
    fireEvent.keyDown(handle, { key: 'ArrowRight', shiftKey: true })
    expect(view.store.getState().preferences.explorerWidthPx).toBe(336)
    fireEvent.keyDown(handle, { key: 'Escape' })
    expect(release).toHaveBeenCalledWith(4)
    fireEvent.doubleClick(handle)
    expect(view.store.getState().preferences.explorerWidthPx).toBe(280)
  })
})
