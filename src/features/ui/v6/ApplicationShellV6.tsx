import { useEffect, useSyncExternalStore, type CSSProperties, type ReactNode } from 'react'

import { DockResizeHandleV6 } from './DockResizeHandleV6.js'
import { dockSizeLimitsV6, resolveWorkspaceLayoutV6 } from './workspace-layout-geometry-v6.js'
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

type ShellStyle = CSSProperties & Record<
  '--v6-explorer-width' | '--v6-inspector-width' | '--v6-bottom-height' | '--v6-viewport-safe-top' | '--v6-viewport-safe-right' | '--v6-viewport-safe-bottom' | '--v6-viewport-safe-left',
  string
>

function chromeAttributes(maximized: boolean): { readonly 'aria-hidden': boolean; readonly inert?: true } {
  return maximized ? { 'aria-hidden': true, inert: true } : { 'aria-hidden': false }
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
      if (event.key === 'Escape' && current.mainViewPresentation === 'maximized' && current.openDialog === null) {
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
  const explorerVisible = state.mode !== 'narrow' && state.preferences.visibleByMode[state.mode].explorer
  const inspectorVisible = state.mode === 'wide' && state.preferences.visibleByMode.wide.inspector
  const bottomVisible = state.mode !== 'narrow' && state.preferences.visibleByMode[state.mode].bottom
  const [explorerMin, explorerMax] = dockSizeLimitsV6('explorer', state.workspaceHeightPx)
  const [inspectorMin, inspectorMax] = dockSizeLimitsV6('inspector', state.workspaceHeightPx)
  const [bottomMin, bottomMax] = dockSizeLimitsV6('bottom', state.workspaceHeightPx)
  const style: ShellStyle = {
    '--v6-explorer-width': `${resolved.explorerWidthPx}px`,
    '--v6-inspector-width': `${resolved.inspectorWidthPx}px`,
    '--v6-bottom-height': `${resolved.bottomHeightPx}px`,
    '--v6-viewport-safe-top': `${safeArea.top}px`,
    '--v6-viewport-safe-right': `${safeArea.right}px`,
    '--v6-viewport-safe-bottom': `${safeArea.bottom}px`,
    '--v6-viewport-safe-left': `${safeArea.left}px`,
  }
  const chrome = chromeAttributes(maximized)

  return (
    <section
      aria-label="OpenDigitalTwin workspace"
      className="v6-application-shell"
      data-main-view-presentation={state.mainViewPresentation}
      data-testid="v6-application-shell"
      style={style}
    >
      <header className="v6-shell-header" data-testid="v6-header" {...chrome}>{header}</header>
      <aside className="v6-shell-toolbox" data-testid="v6-toolbox" {...chrome}>{toolbox}</aside>
      <aside
        aria-label="Scene Explorer"
        className="v6-shell-explorer"
        data-testid="v6-explorer"
        data-visible={explorerVisible}
        {...chrome}
      >
        {explorer}
      </aside>
      {explorerVisible && (
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
      <main aria-label="3D viewport" className="v6-shell-main" id="v6-main-view">
        <div className="v6-main-view-toolbar">
          <button
            aria-controls="v6-main-view"
            aria-pressed={maximized}
            onClick={(event) => {
              store.getState().toggleMainViewMaximized()
              event.currentTarget.focus()
            }}
            type="button"
          >
            {maximized ? 'Restore Main View' : 'Maximize Main View'}
          </button>
        </div>
        <div className="v6-main-view-viewport" data-testid="v6-main-view-viewport">{viewport}</div>
      </main>
      {inspectorVisible && (
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
        data-testid="v6-inspector"
        data-visible={inspectorVisible}
        {...chrome}
      >
        {inspector}
      </aside>
      {bottomVisible && (
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
        data-testid="v6-bottom"
        data-visible={bottomVisible}
        {...chrome}
      >
        {bottom}
      </section>
      <div className="v6-viewport-safe-area" data-safe-area={`${safeArea.top},${safeArea.right},${safeArea.bottom},${safeArea.left}`} />
    </section>
  )
}
