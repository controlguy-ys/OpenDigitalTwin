import type { ThemePreference } from '../theme-preference.js'
import type { BottomWorkspaceTabV4 } from './bottom-workspace-tab.js'
import {
  type ShellDockV4,
  type ShellLayoutModeV4,
  type ShellLayoutStoreV4,
  type ShellWorkspacePreferencesV1,
} from './shell-layout-store.js'
import {
  initialShellLayoutBoundsV4,
  resolveActiveDockResizeV4,
  resolveShellLayoutV4,
  type ResolvedShellLayoutV4,
  type ShellLayoutBoundsV4,
} from './shell-layout-geometry.js'
import {
  ZERO_VIEWPORT_SAFE_AREA_INSETS_V4,
  type ViewportSafeAreaInsetsV4,
} from '../../viewport/v4/viewport-safe-area.js'

export interface ShellOverlayStateV4 {
  readonly sidebarOpen: boolean
  readonly inspectorOpen: boolean
  readonly bottomOpen: boolean
}

export interface ShellLayoutControllerSnapshotV4 {
  readonly mode: ShellLayoutModeV4
  readonly bounds: ShellLayoutBoundsV4
  readonly preferences: ShellWorkspacePreferencesV1
  readonly overlays: ShellOverlayStateV4
  readonly resolved: ResolvedShellLayoutV4
  readonly safeAreaInsets: ViewportSafeAreaInsetsV4
  isDockVisible(dock: ShellDockV4): boolean
  isRibbonExpanded(): boolean
}

export interface ShellLayoutControllerV4 {
  getState(): ShellLayoutControllerSnapshotV4
  subscribe(listener: () => void): () => void
  setBounds(widthPx: number, workspaceHeightPx: number): void
  setDockVisible(dock: ShellDockV4, visible: boolean): void
  setRibbonExpanded(expanded: boolean): void
  setDockSize(dock: ShellDockV4, sizePx: number): void
  setSceneJobSplit(percent: number): void
  setBottomTab(tab: BottomWorkspaceTabV4): void
  setTheme(theme: ThemePreference): void
  resetLayout(): void
  dispose(): void
}

export interface CreateShellLayoutControllerOptionsV4 {
  readonly preferencesStore: ShellLayoutStoreV4
  readonly initialBounds: ShellLayoutBoundsV4
}

const CLOSED_OVERLAYS: ShellOverlayStateV4 = Object.freeze({
  sidebarOpen: false,
  inspectorOpen: false,
  bottomOpen: false,
})

function sameOverlays(a: ShellOverlayStateV4, b: ShellOverlayStateV4): boolean {
  return a.sidebarOpen === b.sidebarOpen
    && a.inspectorOpen === b.inspectorOpen
    && a.bottomOpen === b.bottomOpen
}

function sameBounds(a: ShellLayoutBoundsV4, b: ShellLayoutBoundsV4): boolean {
  return a.mode === b.mode && a.widthPx === b.widthPx
    && a.workspaceHeightPx === b.workspaceHeightPx && a.dividerPx === b.dividerPx
}

function sameResolved(a: ResolvedShellLayoutV4, b: ResolvedShellLayoutV4): boolean {
  return a.sidebarWidthPx === b.sidebarWidthPx && a.inspectorWidthPx === b.inspectorWidthPx
    && a.bottomHeightPx === b.bottomHeightPx && a.viewportWidthPx === b.viewportWidthPx
}

function sameInsets(a: ViewportSafeAreaInsetsV4, b: ViewportSafeAreaInsetsV4): boolean {
  return a.top === b.top && a.right === b.right && a.bottom === b.bottom && a.left === b.left
}

function samePreferences(a: ShellWorkspacePreferencesV1, b: ShellWorkspacePreferencesV1): boolean {
  return a.version === b.version && a.theme === b.theme
    && a.sidebar.widthPx === b.sidebar.widthPx
    && a.sidebar.sceneJobSplitPercent === b.sidebar.sceneJobSplitPercent
    && a.inspector.widthPx === b.inspector.widthPx
    && a.bottom.heightPx === b.bottom.heightPx
    && a.bottom.activeTab === b.bottom.activeTab
    && (['wide', 'compact', 'narrow'] as const).every((mode) => {
      const left = a.modes[mode]
      const right = b.modes[mode]
      return left.ribbonExpanded === right.ribbonExpanded
        && left.dockVisible.sidebar === right.dockVisible.sidebar
        && left.dockVisible.inspector === right.dockVisible.inspector
        && left.dockVisible.bottom === right.dockVisible.bottom
    })
}

function isPersistedDock(mode: ShellLayoutModeV4, dock: ShellDockV4): boolean {
  return mode === 'wide' || (mode === 'compact' && (dock === 'sidebar' || dock === 'bottom'))
}

function preferredOverlaySize(dock: ShellDockV4, preferences: ShellWorkspacePreferencesV1, resolved: ResolvedShellLayoutV4): number {
  if (dock === 'sidebar') return preferences.sidebar.widthPx
  if (dock === 'inspector') return preferences.inspector.widthPx
  return resolved.bottomHeightPx
}

function safeAreaInsets(
  mode: ShellLayoutModeV4,
  overlays: ShellOverlayStateV4,
  preferences: ShellWorkspacePreferencesV1,
  resolved: ResolvedShellLayoutV4,
): ViewportSafeAreaInsetsV4 {
  const sidebar = mode === 'narrow' && overlays.sidebarOpen
  const inspector = (mode === 'compact' || mode === 'narrow') && overlays.inspectorOpen
  const bottom = mode === 'narrow' && overlays.bottomOpen
  if (!sidebar && !inspector && !bottom) return ZERO_VIEWPORT_SAFE_AREA_INSETS_V4
  return Object.freeze({
    top: 0,
    right: inspector ? preferredOverlaySize('inspector', preferences, resolved) + 12 : 0,
    bottom: bottom ? preferredOverlaySize('bottom', preferences, resolved) + 12 : 0,
    left: sidebar ? preferredOverlaySize('sidebar', preferences, resolved) + 12 : 0,
  })
}

function createSnapshot(
  bounds: ShellLayoutBoundsV4,
  preferences: ShellWorkspacePreferencesV1,
  overlays: ShellOverlayStateV4,
): ShellLayoutControllerSnapshotV4 {
  const resolved = resolveShellLayoutV4(bounds, preferences)
  const safeArea = safeAreaInsets(bounds.mode, overlays, preferences, resolved)
  const isDockVisible = (dock: ShellDockV4): boolean => {
    if (isPersistedDock(bounds.mode, dock)) return preferences.modes[bounds.mode].dockVisible[dock]
    if (dock === 'sidebar') return overlays.sidebarOpen
    if (dock === 'inspector') return overlays.inspectorOpen
    return overlays.bottomOpen
  }
  return Object.freeze({
    mode: bounds.mode,
    bounds: Object.freeze({ ...bounds }),
    preferences,
    overlays: Object.freeze({ ...overlays }),
    resolved: Object.freeze({ ...resolved }),
    safeAreaInsets: safeArea,
    isDockVisible,
    isRibbonExpanded: () => preferences.modes[bounds.mode].ribbonExpanded,
  })
}

export function createShellLayoutControllerV4(
  options: CreateShellLayoutControllerOptionsV4,
): ShellLayoutControllerV4 {
  let bounds = initialShellLayoutBoundsV4(
    options.initialBounds.widthPx,
    options.initialBounds.workspaceHeightPx,
    options.initialBounds.dividerPx,
  )
  let preferences = options.preferencesStore.getState().preferences
  let overlays = CLOSED_OVERLAYS
  let snapshot = createSnapshot(bounds, preferences, overlays)
  let disposed = false
  const listeners = new Set<() => void>()

  const publish = () => {
    const next = createSnapshot(bounds, preferences, overlays)
    if (
      snapshot.mode === next.mode
      && sameBounds(snapshot.bounds, next.bounds)
      && samePreferences(snapshot.preferences, next.preferences)
      && sameOverlays(snapshot.overlays, next.overlays)
      && sameResolved(snapshot.resolved, next.resolved)
      && sameInsets(snapshot.safeAreaInsets, next.safeAreaInsets)
    ) return
    snapshot = next
    for (const listener of listeners) listener()
  }

  const unsubscribeStore = options.preferencesStore.subscribe((state) => {
    if (disposed) return
    preferences = state.preferences
    publish()
  })

  const setOverlays = (next: ShellOverlayStateV4) => {
    if (sameOverlays(overlays, next)) return
    overlays = Object.freeze({ ...next })
    publish()
  }

  return {
    getState: () => snapshot,
    subscribe(listener) {
      if (disposed) return () => undefined
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    setBounds(widthPx, workspaceHeightPx) {
      if (disposed) return
      const next = initialShellLayoutBoundsV4(widthPx, workspaceHeightPx, bounds.dividerPx)
      const changedMode = next.mode !== bounds.mode
      if (sameBounds(bounds, next) && !changedMode) return
      bounds = next
      if (changedMode) overlays = CLOSED_OVERLAYS
      publish()
    },
    setDockVisible(dock, visible) {
      if (disposed) return
      if (isPersistedDock(bounds.mode, dock)) {
        if (preferences.modes[bounds.mode].dockVisible[dock] !== visible) {
          options.preferencesStore.getState().setDockedVisible(bounds.mode, dock, visible)
        }
        return
      }
      if (bounds.mode === 'narrow') {
        if (dock === 'sidebar') setOverlays({ sidebarOpen: visible, inspectorOpen: visible ? false : overlays.inspectorOpen, bottomOpen: overlays.bottomOpen })
        else if (dock === 'inspector') setOverlays({ sidebarOpen: visible ? false : overlays.sidebarOpen, inspectorOpen: visible, bottomOpen: overlays.bottomOpen })
        else setOverlays({ ...overlays, bottomOpen: visible })
        return
      }
      if (dock === 'inspector') setOverlays({ ...overlays, inspectorOpen: visible })
    },
    setRibbonExpanded(expanded) {
      if (!disposed) options.preferencesStore.getState().setRibbonExpanded(bounds.mode, expanded)
    },
    setDockSize(dock, sizePx) {
      if (disposed) return
      const resolvedSize = resolveActiveDockResizeV4(dock, sizePx, bounds, preferences)
      const current = dock === 'sidebar' ? preferences.sidebar.widthPx
        : dock === 'inspector' ? preferences.inspector.widthPx : preferences.bottom.heightPx
      if (resolvedSize !== current) options.preferencesStore.getState().setDockSize(dock, resolvedSize)
    },
    setSceneJobSplit(percent) {
      if (!disposed) options.preferencesStore.getState().setSceneJobSplit(percent)
    },
    setBottomTab(tab) {
      if (!disposed) options.preferencesStore.getState().setBottomTab(tab)
    },
    setTheme(theme) {
      if (!disposed) options.preferencesStore.getState().setTheme(theme)
    },
    resetLayout() {
      if (disposed) return
      overlays = CLOSED_OVERLAYS
      options.preferencesStore.getState().resetLayout()
      publish()
    },
    dispose() {
      if (disposed) return
      disposed = true
      listeners.clear()
      unsubscribeStore()
    },
  }
}
