import { act, fireEvent, render, screen } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { useEffect, type ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { ApplicationShellV6 } from './ApplicationShellV6.js'
import { createWorkspaceLayoutStoreV6, type WorkspaceStorageV6 } from './workspace-layout-store-v6.js'

interface RenderShellOptions {
  readonly storage?: WorkspaceStorageV6 | null
  readonly widthPx?: number
  readonly heightPx?: number
  readonly explorer?: ReactNode
  readonly inspector?: ReactNode
  readonly bottom?: ReactNode
  readonly toolbox?: ReactNode
}

function renderShell(options: RenderShellOptions = {}) {
  const store = createWorkspaceLayoutStoreV6({ storage: options.storage ?? null })
  let mounts = 0
  function Viewport() {
    useEffect(() => { mounts += 1 }, [])
    return <div data-testid="viewport">Stable viewport</div>
  }
  render(
    <ApplicationShellV6
      store={store}
      workspaceHeightPx={options.heightPx ?? 800}
      workspaceWidthPx={options.widthPx ?? 1440}
      header={<div>Header</div>}
      explorer={options.explorer ?? <div>Explorer</div>}
      inspector={options.inspector ?? <div>Inspector</div>}
      bottom={options.bottom ?? <div>Bottom</div>}
      toolbox={options.toolbox ?? <div>Toolbox</div>}
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
    act(() => view.store.getState().toggleMainViewMaximized())
    act(() => view.store.getState().restoreMainView())
    act(() => view.store.getState().toggleMainViewMaximized())
    fireEvent.keyDown(document, { key: 'Escape' })

    expect(screen.getByTestId('viewport')).toBe(viewport)
    expect(view.mounts).toBe(1)
  })

  it('restores exact panel preferences without the shell owning a Main View command control', () => {
    const view = renderShell()
    view.store.getState().setDockSize('explorer', 360)
    view.store.getState().setDockSize('inspector', 410)
    view.store.getState().setDockVisible('wide', 'bottom', false)
    const before = structuredClone(view.store.getState().preferences)
    act(() => view.store.getState().toggleMainViewMaximized())
    act(() => view.store.getState().restoreMainView())

    expect(view.store.getState().preferences).toEqual(before)
    expect(screen.queryByRole('button', { name: 'Maximize Main View' })).toBeNull()
  })

  it('masks mounted chrome from accessibility and does not call fullscreen or storage for presentation toggles', () => {
    const requestFullscreen = vi.fn()
    const storage: WorkspaceStorageV6 = {
      getItem: () => null,
      setItem: vi.fn(),
      removeItem: vi.fn(),
    }
    Object.defineProperty(document.documentElement, 'requestFullscreen', { configurable: true, value: requestFullscreen })
    const view = renderShell({ storage })
    const shell = screen.getByTestId('v6-application-shell')
    act(() => view.store.getState().toggleMainViewMaximized())

    expect(shell).toHaveAttribute('data-main-view-presentation', 'maximized')
    expect(screen.getByTestId('v6-header')).toHaveAttribute('aria-hidden', 'true')
    expect(screen.getByTestId('v6-explorer')).toHaveAttribute('inert')
    expect(requestFullscreen).not.toHaveBeenCalled()
    expect(storage.setItem).not.toHaveBeenCalled()
    expect(view.store.getState().mainViewPresentation).toBe('maximized')
  })

  it('honors a higher-priority overlay that consumes Escape before restoring Main View', () => {
    const view = renderShell({
      explorer: <button onKeyDown={(event) => event.preventDefault()} type="button">Context action</button>,
    })
    act(() => view.store.getState().toggleMainViewMaximized())
    fireEvent.keyDown(screen.getByRole('button', { name: 'Context action', hidden: true }), { key: 'Escape' })

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

  it('fully masks a collapsed dock from layout, input, and the accessibility tree', () => {
    const view = renderShell({ explorer: <button type="button">Explorer action</button> })
    act(() => view.store.getState().setDockVisible('wide', 'explorer', false))
    const explorer = screen.getByTestId('v6-explorer')

    expect(explorer).toHaveAttribute('data-visible', 'false')
    expect(explorer).toHaveAttribute('aria-hidden', 'true')
    expect(explorer).toHaveAttribute('inert')
    expect(screen.queryByRole('button', { name: 'Explorer action' })).toBeNull()
    const css = readFileSync(resolve(process.cwd(), 'src/styles/v6/shell.css'), 'utf8')
    const hiddenRule = css.match(
      /\.v6-shell-toolbox\[data-visible='false'\],[\s\S]*?\.v6-shell-bottom\[data-visible='false'\]\s*\{([^}]*)\}/u,
    )?.[1]
    expect(hiddenRule).toContain('overflow: hidden')
    expect(hiddenRule).toContain('pointer-events: none')
    expect(hiddenRule).toContain('visibility: hidden')
  })

  it('renders compact and narrow transient drawers and the Bottom sheet', () => {
    const compact = renderShell({ widthPx: 1000 })
    act(() => compact.store.getState().setDrawerOpen('inspector', true))
    const compactInspector = screen.getByTestId('v6-inspector')
    expect(compactInspector).toHaveAttribute('data-presentation', 'drawer')
    expect(compactInspector).toHaveAttribute('data-visible', 'true')
    expect(compactInspector).toBeVisible()
    expect(compact.store.getState().getSnapshot().viewportSafeArea.right).toBe(372)
  })

  it('renders every narrow overlay using the measured 400px workspace height', () => {
    const narrow = renderShell({ widthPx: 900, heightPx: 400 })
    act(() => {
      narrow.store.getState().setDrawerOpen('explorer', true)
      narrow.store.getState().setDrawerOpen('inspector', true)
      narrow.store.getState().setDrawerOpen('bottom', true)
    })

    expect(screen.getByTestId('v6-explorer')).toHaveAttribute('data-presentation', 'drawer')
    expect(screen.getByTestId('v6-inspector')).toHaveAttribute('data-presentation', 'drawer')
    expect(screen.getByTestId('v6-bottom')).toHaveAttribute('data-presentation', 'sheet')
    expect(screen.getByTestId('v6-bottom')).toHaveAttribute('data-visible', 'true')
    expect(narrow.store.getState().getSnapshot().viewportSafeArea.bottom).toBe(192)
  })

  it('keys responsive CSS to measured workspace mode instead of browser media queries', () => {
    const browserWidth = window.innerWidth
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1440 })
    try {
      renderShell({ widthPx: 1000 })
      expect(screen.getByTestId('v6-application-shell')).toHaveAttribute('data-workspace-mode', 'compact')
      expect(screen.getByTestId('v6-inspector')).toHaveAttribute('data-presentation', 'drawer')
      const css = readFileSync(resolve(process.cwd(), 'src/styles/v6/shell.css'), 'utf8')
      expect(css).not.toMatch(/@media\s*\(/u)
      expect(css).toContain(".v6-application-shell[data-workspace-mode='compact']")
      expect(css).toContain(".v6-application-shell[data-workspace-mode='narrow']")
    } finally {
      Object.defineProperty(window, 'innerWidth', { configurable: true, value: browserWidth })
    }
  })

  it('uses the persisted Toolbox collapse state in rendering and geometry', () => {
    const view = renderShell({ toolbox: <button type="button">Translate tool</button> })
    const shell = screen.getByTestId('v6-application-shell')
    const toolbox = screen.getByTestId('v6-toolbox')
    expect(shell).toHaveAttribute('data-toolbox-collapsed', 'true')
    expect(toolbox).toHaveAttribute('aria-hidden', 'true')
    expect(toolbox).toHaveAttribute('inert')
    expect(screen.queryByRole('button', { name: 'Translate tool' })).toBeNull()

    act(() => view.store.getState().setToolboxCollapsed(false))
    expect(shell).toHaveAttribute('data-toolbox-collapsed', 'false')
    expect(toolbox).not.toHaveAttribute('inert')
    expect(screen.getByRole('button', { name: 'Translate tool' })).toBeVisible()
  })

  it('provides 32px handle hit targets and aligns Bottom to the central Main View column', () => {
    renderShell()
    expect(screen.getByRole('separator', { name: 'Resize Scene Explorer' })).toBeInTheDocument()
    expect(screen.getByRole('separator', { name: 'Resize Job Monitor' })).toBeInTheDocument()

    const css = readFileSync(resolve(process.cwd(), 'src/styles/v6/shell.css'), 'utf8')
    expect(css).toMatch(/\.v6-application-shell\s*\{[^}]*height:\s*100%/u)
    expect(css).toMatch(/\.v6-dock-resize-handle--vertical\s*\{[^}]*min-width:\s*32px/u)
    expect(css).toMatch(/\.v6-dock-resize-handle--horizontal\s*\{[^}]*min-height:\s*32px/u)
    expect(css).toMatch(/\.v6-shell-main\s*\{[^}]*grid-column:\s*4/u)
    expect(css).toMatch(/\.v6-shell-main\s*\{[^}]*grid-template-rows:\s*minmax\(0,\s*1fr\)/u)
    expect(css).toMatch(/\.v6-shell-bottom\s*\{[^}]*grid-column:\s*4/u)
    expect(css).toMatch(/\.v6-shell-bottom-resize\s*\{[^}]*grid-column:\s*4/u)
  })
})
