import { useEffect, useSyncExternalStore, type CSSProperties, type ReactNode } from 'react'

import { DockResizeHandleV6 } from './DockResizeHandleV6.js'
import {
  DOCK_RESIZE_TARGET_PX_V6,
  clampDockSizeV6,
  dockSizeLimitsV6,
  resolveWorkspaceLayoutV6,
} from './workspace-layout-geometry-v6.js'
import type { WorkspaceLayoutStoreV6 } from './workspace-layout-store-v6.js'

export interface ApplicationShellV6Props {
  readonly store: WorkspaceLayoutStoreV6
  readonly workspaceWidthPx: number
  readonly workspaceHeightPx: number
  readonly header: ReactNode
  readonly toolbox: ReactNode
  readonly explorer: ReactNode
  readonly inspector: ReactNode
  readonly bottom: ReactNode
  readonly viewport: ReactNode
}

type ShellStyle = CSSProperties & { [key: `--v6-${string}`]: string }

function visibilityAttributes(hidden: boolean): { readonly 'aria-hidden': boolean; readonly inert?: true } {
  return hidden ? { 'aria-hidden': true, inert: true } : { 'aria-hidden': false }
}

export function ApplicationShellV6({
  store,
  workspaceWidthPx,
  workspaceHeightPx,
  header,
  toolbox,
  explorer,
  inspector,
  bottom,
  viewport,
}: ApplicationShellV6Props) {
  const state = useSyncExternalStore(store.subscribe, store.getState, store.getState)
  useEffect(() => {
    store.getState().setWorkspaceBounds(workspaceWidthPx, workspaceHeightPx)
  }, [store, workspaceHeightPx, workspaceWidthPx])
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const current = store.getState()
      if (
        event.key === 'Escape'
        && !event.defaultPrevented
        && current.mainViewPresentation === 'maximized'
        && current.openDialog === null
      ) {
        event.preventDefault()
        current.restoreMainView()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [store])

  const resolved = resolveWorkspaceLayoutV6({
    mode: state.mode,
    widthPx: state.workspaceWidthPx,
    heightPx: state.workspaceHeightPx,
  }, state.preferences)
  const safeArea = state.getSnapshot().viewportSafeArea
  const maximized = state.mainViewPresentation === 'maximized'
  const explorerPresentation = state.mode === 'narrow' ? 'drawer' : 'dock'
  const inspectorPresentation = state.mode === 'wide' ? 'dock' : 'drawer'
  const bottomPresentation = state.mode === 'narrow' ? 'sheet' : 'dock'
  const explorerVisible = explorerPresentation === 'dock'
    ? state.preferences.visibleByMode[state.mode].explorer
    : state.drawers.explorer
  const inspectorVisible = inspectorPresentation === 'dock'
    ? state.preferences.visibleByMode[state.mode].inspector
    : state.drawers.inspector
  const bottomVisible = bottomPresentation === 'dock'
    ? state.preferences.visibleByMode[state.mode].bottom
    : state.drawers.bottom
  const toolboxVisible = !state.preferences.toolboxCollapsed
  const explorerHandleVisible = explorerPresentation === 'dock' && explorerVisible
  const inspectorHandleVisible = inspectorPresentation === 'dock' && inspectorVisible
  const bottomHandleVisible = bottomPresentation === 'dock' && bottomVisible
  const [explorerMin, explorerMax] = dockSizeLimitsV6('explorer', state.workspaceHeightPx)
  const [inspectorMin, inspectorMax] = dockSizeLimitsV6('inspector', state.workspaceHeightPx)
  const [bottomMin, bottomMax] = dockSizeLimitsV6('bottom', state.workspaceHeightPx)
  const style: ShellStyle = {
    '--v6-toolbox-width': `${resolved.toolboxWidthPx}px`,
    '--v6-explorer-width': `${resolved.explorerWidthPx}px`,
    '--v6-inspector-width': `${resolved.inspectorWidthPx}px`,
    '--v6-bottom-height': `${resolved.bottomHeightPx}px`,
    '--v6-explorer-overlay-width': `${state.preferences.explorerWidthPx}px`,
    '--v6-inspector-overlay-width': `${state.preferences.inspectorWidthPx}px`,
    '--v6-bottom-overlay-height': `${clampDockSizeV6(
      'bottom',
      state.preferences.bottomHeightPx,
      state.workspaceHeightPx,
    )}px`,
    '--v6-explorer-resize-width': `${explorerHandleVisible ? DOCK_RESIZE_TARGET_PX_V6 : 0}px`,
    '--v6-inspector-resize-width': `${inspectorHandleVisible ? DOCK_RESIZE_TARGET_PX_V6 : 0}px`,
    '--v6-bottom-resize-height': `${bottomHandleVisible ? DOCK_RESIZE_TARGET_PX_V6 : 0}px`,
    '--v6-viewport-safe-top': `${safeArea.top}px`,
    '--v6-viewport-safe-right': `${safeArea.right}px`,
    '--v6-viewport-safe-bottom': `${safeArea.bottom}px`,
    '--v6-viewport-safe-left': `${safeArea.left}px`,
  }

  return (
    <section
      aria-label="OpenDigitalTwin workspace"
      className="v6-application-shell"
      data-main-view-presentation={state.mainViewPresentation}
      data-testid="v6-application-shell"
      data-toolbox-collapsed={state.preferences.toolboxCollapsed}
      data-workspace-mode={state.mode}
      style={style}
    >
      <header
        className="v6-shell-header"
        data-testid="v6-header"
        {...visibilityAttributes(maximized)}
      >
        {header}
      </header>
      <aside
        className="v6-shell-toolbox"
        data-testid="v6-toolbox"
        data-visible={toolboxVisible}
        {...visibilityAttributes(maximized || !toolboxVisible)}
      >
        {toolbox}
      </aside>
      <aside
        aria-label="Scene Explorer"
        className="v6-shell-explorer"
        data-presentation={explorerPresentation}
        data-testid="v6-explorer"
        data-visible={explorerVisible}
        {...visibilityAttributes(maximized || !explorerVisible)}
      >
        {explorer}
      </aside>
      {explorerHandleVisible && (
        <DockResizeHandleV6
          className="v6-shell-explorer-resize"
          direction={1}
          label="Resize Scene Explorer"
          max={explorerMax}
          min={explorerMin}
          onChange={(value) => store.getState().setDockSize('explorer', value)}
          onReset={() => store.getState().setDockSize('explorer', 280)}
          orientation="vertical"
          value={state.preferences.explorerWidthPx}
          valueFromPointerDelta={(start, delta) => start + delta}
        />
      )}
      <main aria-label="3D viewport" className="v6-shell-main">
        <div className="v6-main-view-viewport" data-testid="v6-main-view-viewport">{viewport}</div>
      </main>
      {inspectorHandleVisible && (
        <DockResizeHandleV6
          className="v6-shell-inspector-resize"
          direction={-1}
          label="Resize Inspector"
          max={inspectorMax}
          min={inspectorMin}
          onChange={(value) => store.getState().setDockSize('inspector', value)}
          onReset={() => store.getState().setDockSize('inspector', 360)}
          orientation="vertical"
          value={state.preferences.inspectorWidthPx}
          valueFromPointerDelta={(start, delta) => start + delta}
        />
      )}
      <aside
        aria-label="Inspector"
        className="v6-shell-inspector"
        data-presentation={inspectorPresentation}
        data-testid="v6-inspector"
        data-visible={inspectorVisible}
        {...visibilityAttributes(maximized || !inspectorVisible)}
      >
        {inspector}
      </aside>
      {bottomHandleVisible && (
        <DockResizeHandleV6
          className="v6-shell-bottom-resize"
          direction={-1}
          label="Resize Job Monitor"
          max={bottomMax}
          min={bottomMin}
          onChange={(value) => store.getState().setDockSize('bottom', value)}
          onReset={() => store.getState().setDockSize('bottom', 180)}
          orientation="horizontal"
          value={state.preferences.bottomHeightPx}
          valueFromPointerDelta={(start, delta) => start + delta}
        />
      )}
      <section
        aria-label="Job Monitor"
        className="v6-shell-bottom"
        data-presentation={bottomPresentation}
        data-testid="v6-bottom"
        data-visible={bottomVisible}
        {...visibilityAttributes(maximized || !bottomVisible)}
      >
        {bottom}
      </section>
      {!maximized && <nav aria-label="Workspace docks" className="v6-workspace-dock-toggles">
        <button onClick={() => explorerPresentation === 'dock'
          ? store.getState().setDockVisible(state.mode, 'explorer', !explorerVisible)
          : store.getState().setDrawerOpen('explorer', !explorerVisible)} type="button">{explorerVisible ? 'Hide' : 'Show'} Scene Explorer</button>
        <button onClick={() => inspectorPresentation === 'dock'
          ? store.getState().setDockVisible(state.mode, 'inspector', !inspectorVisible)
          : store.getState().setDrawerOpen('inspector', !inspectorVisible)} type="button">{inspectorVisible ? 'Hide' : 'Show'} Inspector</button>
        <button onClick={() => bottomPresentation === 'dock'
          ? store.getState().setDockVisible(state.mode, 'bottom', !bottomVisible)
          : store.getState().setDrawerOpen('bottom', !bottomVisible)} type="button">{bottomVisible ? 'Hide' : 'Show'} Job Monitor</button>
      </nav>}
      <div className="v6-viewport-safe-area" data-safe-area={`${safeArea.top},${safeArea.right},${safeArea.bottom},${safeArea.left}`} />
    </section>
  )
}
