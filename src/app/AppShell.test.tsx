import { act, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createShellLayoutControllerV4 } from '../features/ui/v4/shell-layout-controller.js'
import { initialShellLayoutBoundsV4 } from '../features/ui/v4/shell-layout-geometry.js'
import { createShellLayoutStoreV4, type ShellLayoutStoreV4 } from '../features/ui/v4/shell-layout-store.js'
import type { ShellLayoutControllerV4 } from '../features/ui/v4/shell-layout-controller.js'
import { AppShellV4 } from './AppShell.js'

class TestResizeObserver {
  static instances: TestResizeObserver[] = []
  readonly observed = new Set<Element>()
  readonly disconnect = vi.fn()
  readonly callback: ResizeObserverCallback
  constructor(callback: ResizeObserverCallback) {
    this.callback = callback
    TestResizeObserver.instances.push(this)
  }
  observe = (target: Element) => this.observed.add(target)
  deliver(target: Element, width: number, height: number) {
    this.callback([{
      target,
      contentRect: { width, height },
    } as ResizeObserverEntry], this as unknown as ResizeObserver)
  }
}

describe('AppShellV4', () => {
  let shellLayoutStore: ShellLayoutStoreV4
  let shellLayoutController: ShellLayoutControllerV4

  beforeEach(() => {
    localStorage.clear()
    TestResizeObserver.instances = []
    vi.stubGlobal('ResizeObserver', TestResizeObserver)
    shellLayoutStore = createShellLayoutStoreV4({ storage: localStorage })
    shellLayoutController = createShellLayoutControllerV4({
      preferencesStore: shellLayoutStore,
      initialBounds: initialShellLayoutBoundsV4(1440, 800),
    })
  })

  afterEach(() => {
    shellLayoutController.dispose()
    vi.unstubAllGlobals()
  })

  function renderShell(props: Partial<Parameters<typeof AppShellV4>[0]> = {}) {
    return render(
      <AppShellV4
        shellLayoutController={shellLayoutController}
        viewport={<div>3D viewport</div>}
        {...props}
      />,
    )
  }

  function workspace(): HTMLElement {
    return document.querySelector('.studio-workspace') as HTMLElement
  }

  it('renders a controller-owned central viewport workspace with Bottom below that column', () => {
    renderShell({ bottomRail: <div>Bottom content</div> })

    const shell = screen.getByLabelText('3D viewport').closest('.app-shell')!
    const center = shell.querySelector('.studio-center-column')!
    const bottom = screen.getByLabelText('Bottom Workspace')
    expect(shell).toHaveAttribute('data-layout-mode', 'wide')
    expect(screen.getByLabelText('Scene Assets')).toBeInTheDocument()
    expect(screen.getByLabelText('Inspector')).toBeInTheDocument()
    expect(center).toContainElement(bottom)
    expect(bottom.parentElement).toBe(center)
    expect(bottom).toHaveAttribute('aria-hidden', 'true')
    expect(workspace()).toBe(TestResizeObserver.instances[0]?.observed.values().next().value)
  })

  it('retains the bounded Add controls and controller-owned Theme preference', async () => {
    const user = userEvent.setup()
    const createBox = vi.fn()
    renderShell({ onCreateBox: createBox })

    await user.click(screen.getByRole('button', { name: 'Add' }))
    expect(screen.getAllByRole('menuitem').map((item) => item.textContent)).toEqual([
      'Box', 'Cylinder', 'Group',
    ])
    await user.click(screen.getByRole('menuitem', { name: 'Box' }))
    await user.selectOptions(screen.getByRole('combobox', { name: 'Theme' }), 'dark')

    expect(createBox).toHaveBeenCalledOnce()
    expect(shellLayoutController.getState().preferences.theme).toBe('dark')
    expect(document.documentElement).toHaveAttribute('data-theme', 'dark')
  })

  it('uses one observed workspace width for wide, compact, narrow, and restored layout modes', () => {
    renderShell()
    const observer = TestResizeObserver.instances[0]!
    const target = workspace()

    act(() => observer.deliver(target, 1199, 700))
    expect(screen.getByLabelText('3D viewport').closest('.app-shell')).toHaveAttribute('data-layout-mode', 'compact')
    expect(screen.getByLabelText('Inspector')).toHaveAttribute('hidden')
    act(() => shellLayoutController.setDockVisible('inspector', true))
    expect(screen.getByLabelText('Inspector')).not.toHaveAttribute('hidden')

    act(() => observer.deliver(target, 959, 700))
    expect(screen.getByLabelText('3D viewport').closest('.app-shell')).toHaveAttribute('data-layout-mode', 'narrow')
    expect(screen.getByLabelText('Inspector')).toHaveAttribute('hidden')

    act(() => observer.deliver(target, 1440, 700))
    expect(screen.getByLabelText('3D viewport').closest('.app-shell')).toHaveAttribute('data-layout-mode', 'wide')
    expect(shellLayoutController.getState().preferences.sidebar.widthPx).toBe(248)
    expect(shellLayoutController.getState().preferences.inspector.widthPx).toBe(320)
  })

  it('uses controller effective docks and renders only applicable dock resize handles', async () => {
    const user = userEvent.setup()
    renderShell()

    expect(screen.getByRole('separator', { name: 'Resize Scene Assets' })).toBeVisible()
    expect(screen.getByRole('separator', { name: 'Resize Inspector' })).toBeVisible()
    expect(screen.queryByRole('separator', { name: 'Resize Bottom Workspace' })).not.toBeInTheDocument()

    const sceneHandle = screen.getByRole('separator', { name: 'Resize Scene Assets' })
    await user.click(screen.getByRole('button', { name: 'Inspector drawer' }))
    expect(screen.getByLabelText('Inspector')).toHaveAttribute('hidden')
    await user.keyboard('{Escape}')
    fireEvent.keyDown(sceneHandle, { key: 'ArrowRight' })
    expect(shellLayoutController.getState().preferences.sidebar.widthPx).toBe(256)
    fireEvent.doubleClick(sceneHandle)
    expect(shellLayoutController.getState().preferences.sidebar.widthPx).toBe(248)

    act(() => shellLayoutController.setBounds(1199, 700))
    expect(screen.queryByRole('separator', { name: 'Resize Inspector' })).not.toBeInTheDocument()
    act(() => shellLayoutController.setBounds(959, 700))
    expect(screen.queryByRole('separator', { name: 'Resize Scene Assets' })).not.toBeInTheDocument()
    expect(screen.queryByRole('separator', { name: 'Resize Bottom Workspace' })).not.toBeInTheDocument()
  })

  it('keeps the Scene and Job split controller-owned, clamped, and reset independently', () => {
    renderShell({ assetTree: <div>Scene tree</div>, jobTree: <div>Job tree</div> })
    const split = screen.getByRole('separator', { name: 'Resize Scene Objects and Robot Jobs' })
    fireEvent.keyDown(split, { key: 'ArrowDown' })
    expect(shellLayoutController.getState().preferences.sidebar.sceneJobSplitPercent).toBe(61)
    fireEvent.doubleClick(split)
    expect(shellLayoutController.getState().preferences.sidebar.sceneJobSplitPercent).toBe(60)
    expect(shellLayoutController.getState().preferences.sidebar.widthPx).toBe(248)
  })

  it('keeps a narrow Scene and Job separator only at the 360-pixel content threshold', () => {
    renderShell()
    const assetRail = screen.getByLabelText('Scene Assets')
    const assetObserver = TestResizeObserver.instances.find((candidate) => candidate.observed.has(assetRail))!

    act(() => shellLayoutController.setBounds(959, 700))
    act(() => shellLayoutController.setDockVisible('sidebar', true))
    act(() => assetObserver.deliver(assetRail, 248, 360))
    expect(screen.getByRole('separator', { name: 'Resize Scene Objects and Robot Jobs' })).toBeInTheDocument()

    act(() => assetObserver.deliver(assetRail, 248, 359))
    expect(screen.queryByRole('separator', { name: 'Resize Scene Objects and Robot Jobs' })).not.toBeInTheDocument()
    expect(shellLayoutController.getState().preferences.sidebar.sceneJobSplitPercent).toBe(60)
  })

  it('keeps named work areas internal while document root overflow remains locked', () => {
    renderShell({ bottomRail: <div>Bottom content</div> })
    expect(document.documentElement).toHaveStyle({ overflow: 'hidden' })
    expect(document.body).toHaveStyle({ overflow: 'hidden' })
    expect(screen.getByLabelText('3D viewport').closest('.app-shell')).toHaveStyle({
      height: '100dvh',
      overflow: 'hidden',
    })
  })
})
