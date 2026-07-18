import { act, fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createShellLayoutControllerV4 } from '../features/ui/v4/shell-layout-controller.js'
import { createAppCommandBindingsV4, createAppCommandRuntimeV4 } from '../features/commands/v4/app-command-runtime.js'
import type { AppCommandV4 } from '../features/commands/v4/app-command.js'
import { createAppCommandRegistryV4 } from '../features/commands/v4/app-command-registry.js'
import { initialShellLayoutBoundsV4 } from '../features/ui/v4/shell-layout-geometry.js'
import { createShellLayoutStoreV4, type ShellLayoutStoreV4 } from '../features/ui/v4/shell-layout-store.js'
import type { ShellLayoutControllerV4 } from '../features/ui/v4/shell-layout-controller.js'
import type { ViewportSafeAreaInsetsV4 } from '../features/viewport/v4/viewport-safe-area.js'
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

  function layoutCommandBindings() {
    const toggle = (
      id: 'view.sidebar' | 'view.inspector' | 'view.bottom',
      dock: 'sidebar' | 'inspector' | 'bottom',
    ): AppCommandV4 => ({
      id,
      label: dock,
      section: 'view',
      kind: 'toggle',
      visible: true,
      enabled: true,
      get checked() {
        return shellLayoutController.getState().isDockVisible(dock)
      },
      execute() {
        const snapshot = shellLayoutController.getState()
        shellLayoutController.setDockVisible(dock, !snapshot.isDockVisible(dock))
      },
    })
    return createAppCommandBindingsV4(createAppCommandRuntimeV4(createAppCommandRegistryV4([
      toggle('view.sidebar', 'sidebar'),
      toggle('view.inspector', 'inspector'),
      toggle('view.bottom', 'bottom'),
    ])))
  }

  function renderShell(props: Partial<Parameters<typeof AppShellV4>[0]> = {}) {
    const commandBindings = layoutCommandBindings()
    return render(
      <AppShellV4
        shellLayoutController={shellLayoutController}
        commandBindings={commandBindings}
        header={<div>Header</div>}
        renderViewport={() => <div>3D viewport</div>}
        {...props}
      />,
    )
  }

  function workspace(): HTMLElement {
    return document.querySelector('.studio-workspace') as HTMLElement
  }

  it('renders a controller-owned central viewport workspace with Bottom below that column', () => {
    renderShell({ bottomRail: <div>Bottom content</div> })

    const shell = screen.getByLabelText('3D viewport').closest('.app-shell') as HTMLElement
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

  it('owns the Header and calls renderViewport once with the controller safe-area snapshot', () => {
    const renderViewport = vi.fn<(safeAreaInsets: ViewportSafeAreaInsetsV4) => ReactNode>(
      () => <div>Shared viewport</div>,
    )
    const bindings = createAppCommandBindingsV4(createAppCommandRuntimeV4(createAppCommandRegistryV4([])))
    render(<AppShellV4
      shellLayoutController={shellLayoutController}
      commandBindings={bindings}
      header={<div>Reviewed Header</div>}
      renderViewport={renderViewport}
    />)

    expect(screen.getByText('Reviewed Header')).toBeInTheDocument()
    expect(screen.getByText('Shared viewport')).toBeInTheDocument()
    expect(renderViewport).toHaveBeenCalledOnce()
    expect(renderViewport.mock.calls[0]?.[0]).toBe(shellLayoutController.getState().safeAreaInsets)
  })

  it('allocates the reviewed ribbon height and restores the workspace offset when collapsed', () => {
    renderShell()
    const shell = screen.getByLabelText('3D viewport').closest('.app-shell') as HTMLElement

    expect(shell.style.getPropertyValue('--ribbon-height')).toBe('38px')
    act(() => shellLayoutController.setRibbonExpanded(false))
    expect(shell.style.getPropertyValue('--ribbon-height')).toBe('0px')
    act(() => shellLayoutController.setRibbonExpanded(true))
    expect(shell.style.getPropertyValue('--ribbon-height')).toBe('38px')
  })

  it('removes the legacy top-bar Add and inline Theme controls', () => {
    renderShell()

    expect(screen.queryByRole('button', { name: 'Add' })).not.toBeInTheDocument()
    expect(screen.queryByRole('combobox', { name: 'Theme' })).not.toBeInTheDocument()
    expect(screen.queryByRole('toolbar', { name: 'Top bar controls' })).not.toBeInTheDocument()
  })

  it('applies controller Theme preferences after the inline selector is removed', () => {
    renderShell()

    act(() => shellLayoutController.setTheme('dark'))
    expect(document.documentElement).toHaveAttribute('data-theme', 'dark')
    expect(document.documentElement.style.colorScheme).toBe('dark')
  })

  it('uses one observed workspace width for wide, compact, narrow, and restored layout modes', () => {
    renderShell()
    const observer = TestResizeObserver.instances[0]!
    const target = workspace()

    act(() => observer.deliver(target, 1200, 700))
    expect(screen.getByLabelText('3D viewport').closest('.app-shell')).toHaveAttribute('data-layout-mode', 'wide')
    act(() => observer.deliver(target, 1199, 700))
    expect(screen.getByLabelText('3D viewport').closest('.app-shell')).toHaveAttribute('data-layout-mode', 'compact')
    expect(screen.getByLabelText('Inspector')).toHaveAttribute('hidden')
    act(() => shellLayoutController.setDockVisible('inspector', true))
    expect(screen.getByLabelText('Inspector')).not.toHaveAttribute('hidden')

    act(() => observer.deliver(target, 960, 700))
    expect(screen.getByLabelText('3D viewport').closest('.app-shell')).toHaveAttribute('data-layout-mode', 'compact')
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

  it('routes pointer and keyboard resize to only the addressed preference and Shell variable', () => {
    renderShell()
    const shell = screen.getByLabelText('3D viewport').closest('.app-shell') as HTMLElement
    const sidebar = screen.getByRole('separator', { name: 'Resize Scene Assets' })
    const inspector = screen.getByRole('separator', { name: 'Resize Inspector' })
    const before = shellLayoutController.getState().preferences

    fireEvent.pointerDown(sidebar, { button: 0, clientX: 100, pointerId: 1 })
    fireEvent.pointerMove(sidebar, { clientX: 120, pointerId: 1 })
    fireEvent.pointerUp(sidebar, { clientX: 120, pointerId: 1 })
    expect(shellLayoutController.getState().preferences).toMatchObject({
      sidebar: { widthPx: 268 },
      inspector: { widthPx: before.inspector.widthPx },
      bottom: { heightPx: before.bottom.heightPx },
    })
    expect(shell.style.getPropertyValue('--sidebar-width')).toBe('268px')

    fireEvent.keyDown(inspector, { key: 'ArrowLeft' })
    expect(shellLayoutController.getState().preferences).toMatchObject({
      sidebar: { widthPx: 268 },
      inspector: { widthPx: 328 },
      bottom: { heightPx: before.bottom.heightPx },
    })
    expect(shell.style.getPropertyValue('--inspector-width')).toBe('328px')

    act(() => shellLayoutController.setDockVisible('bottom', true))
    const bottom = screen.getByRole('separator', { name: 'Resize Bottom Workspace' })
    fireEvent.pointerDown(bottom, { button: 0, clientY: 100, pointerId: 2 })
    fireEvent.pointerMove(bottom, { clientY: 90, pointerId: 2 })
    fireEvent.pointerUp(bottom, { clientY: 90, pointerId: 2 })
    expect(shellLayoutController.getState().preferences).toMatchObject({
      sidebar: { widthPx: 268 },
      inspector: { widthPx: 328 },
      bottom: { heightPx: 170 },
    })
    expect(shell.style.getPropertyValue('--bottom-height')).toBe('170px')
  })

  it('resets layout dimensions and docks while preserving Theme and the active Bottom tab', () => {
    renderShell()
    act(() => {
      shellLayoutController.setTheme('dark')
      shellLayoutController.setBottomTab('collision')
      shellLayoutController.setDockSize('sidebar', 320)
      shellLayoutController.setDockSize('inspector', 400)
      shellLayoutController.setDockSize('bottom', 220)
      shellLayoutController.setSceneJobSplit(70)
      shellLayoutController.setDockVisible('bottom', true)
      shellLayoutController.resetLayout()
    })
    expect(shellLayoutController.getState()).toMatchObject({
      overlays: { sidebarOpen: false, inspectorOpen: false, bottomOpen: false },
      preferences: {
        theme: 'dark',
        sidebar: { widthPx: 248, sceneJobSplitPercent: 60 },
        inspector: { widthPx: 320 },
        bottom: { heightPx: 160, activeTab: 'collision' },
      },
    })
  })

  it('keeps the resolved viewport at least 480 pixels when raw stored dimensions are invalid', () => {
    renderShell()
    act(() => {
      shellLayoutController.setBounds(1000, 700)
      shellLayoutStore.setState((state) => ({
        ...state,
        preferences: {
          ...state.preferences,
          sidebar: { ...state.preferences.sidebar, widthPx: 9999 },
          inspector: { ...state.preferences.inspector, widthPx: 9999 },
        },
      }), true)
    })
    expect(shellLayoutController.getState().resolved.viewportWidthPx).toBeGreaterThanOrEqual(480)
    expect(screen.getByLabelText('3D viewport').closest('.app-shell')).toHaveStyle({
      '--sidebar-width': '420px',
    })
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
    const view = renderShell()
    const assetRail = screen.getByLabelText('Scene Assets')
    const assetObserver = TestResizeObserver.instances.find((candidate) => candidate.observed.has(assetRail))!

    act(() => shellLayoutController.setBounds(959, 700))
    act(() => shellLayoutController.setDockVisible('sidebar', true))
    act(() => assetObserver.deliver(assetRail, 248, 360))
    expect(screen.getByRole('separator', { name: 'Resize Scene Objects and Robot Jobs' })).toBeInTheDocument()

    const split = screen.getByRole('separator', { name: 'Resize Scene Objects and Robot Jobs' })
    fireEvent.pointerDown(split, { button: 0, clientY: 0, pointerId: 3 })
    fireEvent.pointerMove(split, { clientY: 36, pointerId: 3 })
    fireEvent.pointerUp(split, { clientY: 36, pointerId: 3 })
    expect(shellLayoutController.getState().preferences.sidebar.sceneJobSplitPercent).toBe(70)
    fireEvent.keyDown(split, { key: 'ArrowDown' })
    fireEvent.keyDown(split, { key: 'ArrowDown' })
    fireEvent.keyDown(split, { key: 'ArrowDown' })
    fireEvent.keyDown(split, { key: 'ArrowDown' })
    fireEvent.keyDown(split, { key: 'ArrowDown' })
    fireEvent.keyDown(split, { key: 'ArrowDown' })
    expect(shellLayoutController.getState().preferences.sidebar.sceneJobSplitPercent).toBe(75)
    act(() => shellLayoutController.setSceneJobSplit(70))

    view.unmount()
    shellLayoutController.dispose()
    shellLayoutController = createShellLayoutControllerV4({
      preferencesStore: shellLayoutStore,
      initialBounds: initialShellLayoutBoundsV4(959, 700),
    })
    renderShell()
    act(() => shellLayoutController.setDockVisible('sidebar', true))
    const remountedRail = screen.getByLabelText('Scene Assets')
    const remountedObserver = TestResizeObserver.instances.find((candidate) => candidate.observed.has(remountedRail))!
    act(() => remountedObserver.deliver(remountedRail, 248, 360))
    const remountedSplit = screen.getByRole('separator', { name: 'Resize Scene Objects and Robot Jobs' })
    expect(remountedSplit).toHaveAttribute('aria-valuenow', '70')
    fireEvent.doubleClick(remountedSplit)
    expect(shellLayoutController.getState().preferences.sidebar.sceneJobSplitPercent).toBe(60)

    act(() => remountedObserver.deliver(remountedRail, 248, 359))
    expect(screen.queryByRole('separator', { name: 'Resize Scene Objects and Robot Jobs' })).not.toBeInTheDocument()
    expect(remountedRail).toHaveAttribute('data-scene-job-handle', 'hidden')
    expect(screen.getByRole('region', { name: 'Scene Objects' })).toHaveStyle({ gridRow: '1' })
    expect(screen.getByRole('region', { name: 'Robot Jobs' })).toHaveStyle({ gridRow: '2' })
    expect(shellLayoutController.getState().preferences.sidebar.sceneJobSplitPercent).toBe(60)
  })

  it('preserves controller safe-area state for compact and narrow overlay drawers', () => {
    renderShell()
    act(() => shellLayoutController.setBounds(1199, 700))
    act(() => shellLayoutController.setDockVisible('inspector', true))
    expect(shellLayoutController.getState().safeAreaInsets).toEqual({
      top: 0, right: 332, bottom: 0, left: 0,
    })
    act(() => shellLayoutController.setBounds(959, 700))
    act(() => {
      shellLayoutController.setDockVisible('sidebar', true)
      shellLayoutController.setDockVisible('bottom', true)
    })
    expect(shellLayoutController.getState().safeAreaInsets).toEqual({
      top: 0, right: 0, bottom: 172, left: 260,
    })
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
