import { createStore, type StoreApi } from 'zustand/vanilla'

import type { ThemePreference } from '../theme-preference.js'
import type { DialogRequestV6 } from './dialog-request-v6.js'
import {
  clampDockSizeV6,
  resolveViewportSafeAreaV6,
  resolveWorkspaceModeV6,
  resolveWorkspaceLayoutV6,
  type ViewportSafeAreaV6,
} from './workspace-layout-geometry-v6.js'

export const WORKSPACE_PREFERENCES_STORAGE_KEY_V6 = 'opendigitaltwin.ui-v6.preferences.v1'

export const DEFAULT_EXPLORER_WIDTH_PX_V6 = 248
export const DEFAULT_INSPECTOR_WIDTH_PX_V6 = 320
export const DEFAULT_BOTTOM_HEIGHT_PX_V6 = 180

export type WorkspaceLayoutModeV6 = 'wide' | 'compact' | 'narrow'
export type WorkspaceDockV6 = 'explorer' | 'inspector' | 'bottom'
export type MainViewPresentationV6 = 'workspace' | 'maximized'
export type BottomWorkspaceTabV6 = 'job-monitor' | 'diagnostics'

export interface WorkspacePreferencesV6 {
  readonly version: 1
  readonly theme: ThemePreference
  readonly explorerWidthPx: number
  readonly inspectorWidthPx: number
  readonly bottomHeightPx: number
  readonly toolboxCollapsed: boolean
  readonly visibleByMode: Readonly<Record<WorkspaceLayoutModeV6, Readonly<Record<WorkspaceDockV6, boolean>>>>
}

export interface WorkspaceLayoutSnapshotV6 {
  readonly mode: WorkspaceLayoutModeV6
  readonly preferences: WorkspacePreferencesV6
  readonly mainViewPresentation: MainViewPresentationV6
  readonly viewportSafeArea: ViewportSafeAreaV6
}

export interface WorkspaceStorageV6 {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

export interface WorkspaceLayoutStateV6 {
  readonly preferences: WorkspacePreferencesV6
  readonly mode: WorkspaceLayoutModeV6
  readonly workspaceWidthPx: number
  readonly workspaceHeightPx: number
  readonly drawers: Readonly<Record<WorkspaceDockV6, boolean>>
  readonly openDialog: DialogRequestV6 | null
  readonly mainViewPresentation: MainViewPresentationV6
  readonly activeBottomTab: BottomWorkspaceTabV6
  getSnapshot(): WorkspaceLayoutSnapshotV6
  setWorkspaceBounds(widthPx: number, heightPx: number): void
  setDockSize(dock: WorkspaceDockV6, sizePx: number): void
  setDockVisible(mode: WorkspaceLayoutModeV6, dock: WorkspaceDockV6, visible: boolean): void
  setDrawerOpen(dock: WorkspaceDockV6, open: boolean): void
  setToolboxCollapsed(collapsed: boolean): void
  setTheme(theme: ThemePreference): void
  setActiveBottomTab(tab: BottomWorkspaceTabV6): void
  requestDialog(request: DialogRequestV6): void
  closeDialog(): void
  toggleMainViewMaximized(): void
  restoreMainView(): void
  resetLayout(): void
}

export type WorkspaceLayoutStoreV6 = StoreApi<WorkspaceLayoutStateV6>

export interface CreateWorkspaceLayoutStoreOptionsV6 {
  readonly storage: WorkspaceStorageV6 | null
}

const CLOSED_DRAWERS: Readonly<Record<WorkspaceDockV6, boolean>> = Object.freeze({
  explorer: false, inspector: false, bottom: false,
})

function defaults(): WorkspacePreferencesV6 {
  return {
    version: 1,
    theme: 'system',
    explorerWidthPx: DEFAULT_EXPLORER_WIDTH_PX_V6,
    inspectorWidthPx: DEFAULT_INSPECTOR_WIDTH_PX_V6,
    bottomHeightPx: DEFAULT_BOTTOM_HEIGHT_PX_V6,
    toolboxCollapsed: true,
    visibleByMode: {
      wide: { explorer: true, inspector: false, bottom: false },
      compact: { explorer: true, inspector: false, bottom: false },
      narrow: { explorer: false, inspector: false, bottom: false },
    },
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function themeOrDefault(value: unknown, fallback: ThemePreference): ThemePreference {
  return value === 'light' || value === 'dark' || value === 'system' ? value : fallback
}

function booleanOrDefault(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
}

function numberOrDefault(value: unknown, fallback: number, dock: WorkspaceDockV6): number {
  return typeof value === 'number' && Number.isFinite(value) ? clampDockSizeV6(dock, value, 800) : fallback
}

function visibilityOrDefault(value: unknown, fallback: WorkspacePreferencesV6['visibleByMode']): WorkspacePreferencesV6['visibleByMode'] {
  const source = isRecord(value) ? value : {}
  const mode = (name: WorkspaceLayoutModeV6) => {
    const candidate = isRecord(source[name]) ? source[name] : {}
    return {
      explorer: booleanOrDefault(candidate.explorer, fallback[name].explorer),
      inspector: booleanOrDefault(candidate.inspector, fallback[name].inspector),
      bottom: booleanOrDefault(candidate.bottom, fallback[name].bottom),
    }
  }
  return { wide: mode('wide'), compact: mode('compact'), narrow: mode('narrow') }
}

function normalizePreferences(value: unknown): WorkspacePreferencesV6 | null {
  if (!isRecord(value) || value.version !== 1) return null
  const fallback = defaults()
  return {
    version: 1,
    theme: themeOrDefault(value.theme, fallback.theme),
    explorerWidthPx: numberOrDefault(value.explorerWidthPx, fallback.explorerWidthPx, 'explorer'),
    inspectorWidthPx: numberOrDefault(value.inspectorWidthPx, fallback.inspectorWidthPx, 'inspector'),
    bottomHeightPx: numberOrDefault(value.bottomHeightPx, fallback.bottomHeightPx, 'bottom'),
    toolboxCollapsed: booleanOrDefault(value.toolboxCollapsed, fallback.toolboxCollapsed),
    visibleByMode: visibilityOrDefault(value.visibleByMode, fallback.visibleByMode),
  }
}

function readPreferences(storage: WorkspaceStorageV6 | null): WorkspacePreferencesV6 {
  try {
    const raw = storage?.getItem(WORKSPACE_PREFERENCES_STORAGE_KEY_V6) ?? null
    if (raw === null) return defaults()
    return normalizePreferences(JSON.parse(raw)) ?? defaults()
  } catch {
    return defaults()
  }
}

function allowListedPreferences(preferences: WorkspacePreferencesV6): WorkspacePreferencesV6 {
  return {
    version: 1,
    theme: preferences.theme,
    explorerWidthPx: preferences.explorerWidthPx,
    inspectorWidthPx: preferences.inspectorWidthPx,
    bottomHeightPx: preferences.bottomHeightPx,
    toolboxCollapsed: preferences.toolboxCollapsed,
    visibleByMode: {
      wide: {
        explorer: preferences.visibleByMode.wide.explorer,
        inspector: preferences.visibleByMode.wide.inspector,
        bottom: preferences.visibleByMode.wide.bottom,
      },
      compact: {
        explorer: preferences.visibleByMode.compact.explorer,
        inspector: preferences.visibleByMode.compact.inspector,
        bottom: preferences.visibleByMode.compact.bottom,
      },
      narrow: {
        explorer: preferences.visibleByMode.narrow.explorer,
        inspector: preferences.visibleByMode.narrow.inspector,
        bottom: preferences.visibleByMode.narrow.bottom,
      },
    },
  }
}

function writePreferences(storage: WorkspaceStorageV6 | null, preferences: WorkspacePreferencesV6): void {
  try {
    storage?.setItem(
      WORKSPACE_PREFERENCES_STORAGE_KEY_V6,
      JSON.stringify(allowListedPreferences(preferences)),
    )
  } catch {}
}

export function createWorkspaceLayoutStoreV6(
  options: CreateWorkspaceLayoutStoreOptionsV6,
): WorkspaceLayoutStoreV6 {
  const initialPreferences = readPreferences(options.storage)
  return createStore<WorkspaceLayoutStateV6>((set, get) => {
    const replacePreferences = (preferences: WorkspacePreferencesV6) => {
      const allowed = allowListedPreferences(preferences)
      writePreferences(options.storage, allowed)
      set({ preferences: allowed })
    }
    const currentSnapshot = (): WorkspaceLayoutSnapshotV6 => {
      const state = get()
      const resolved = resolveWorkspaceLayoutV6({
        mode: state.mode, widthPx: state.workspaceWidthPx, heightPx: state.workspaceHeightPx,
      }, state.preferences)
      return Object.freeze({
        mode: state.mode,
        preferences: state.preferences,
        mainViewPresentation: state.mainViewPresentation,
        viewportSafeArea: resolveViewportSafeAreaV6({
          mode: state.mode,
          presentation: state.mainViewPresentation,
          drawers: state.drawers,
          preferences: state.preferences,
          resolved,
          workspaceHeightPx: state.workspaceHeightPx,
        }),
      })
    }
    return {
      preferences: initialPreferences,
      mode: 'wide',
      workspaceWidthPx: 1200,
      workspaceHeightPx: 800,
      drawers: CLOSED_DRAWERS,
      openDialog: null,
      mainViewPresentation: 'workspace',
      activeBottomTab: 'job-monitor',
      getSnapshot: currentSnapshot,
      setWorkspaceBounds(widthPx, heightPx) {
        const safeWidth = Number.isFinite(widthPx) && widthPx > 0 ? widthPx : 1200
        const safeHeight = Number.isFinite(heightPx) && heightPx > 0 ? heightPx : 800
        const nextMode = resolveWorkspaceModeV6(safeWidth)
        set({
          workspaceWidthPx: safeWidth,
          workspaceHeightPx: safeHeight,
          mode: nextMode,
          drawers: nextMode === get().mode ? get().drawers : CLOSED_DRAWERS,
        })
      },
      setDockSize(dock, sizePx) {
        const current = get()
        const value = clampDockSizeV6(dock, sizePx, current.workspaceHeightPx)
        const preferences = current.preferences
        if (dock === 'explorer') replacePreferences({ ...preferences, explorerWidthPx: value })
        else if (dock === 'inspector') replacePreferences({ ...preferences, inspectorWidthPx: value })
        else replacePreferences({ ...preferences, bottomHeightPx: value })
      },
      setDockVisible(mode, dock, visible) {
        const preferences = get().preferences
        replacePreferences({
          ...preferences,
          visibleByMode: {
            ...preferences.visibleByMode,
            [mode]: { ...preferences.visibleByMode[mode], [dock]: visible },
          },
        })
      },
      setDrawerOpen(dock, open) {
        set({ drawers: { ...get().drawers, [dock]: open } })
      },
      setToolboxCollapsed(collapsed) {
        replacePreferences({ ...get().preferences, toolboxCollapsed: collapsed })
      },
      setTheme(theme) {
        replacePreferences({ ...get().preferences, theme: themeOrDefault(theme, 'system') })
      },
      setActiveBottomTab(tab) {
        set({ activeBottomTab: tab })
      },
      requestDialog(request) { set({ openDialog: request }) },
      closeDialog() { set({ openDialog: null }) },
      toggleMainViewMaximized() {
        set({ mainViewPresentation: get().mainViewPresentation === 'workspace' ? 'maximized' : 'workspace' })
      },
      restoreMainView() { set({ mainViewPresentation: 'workspace' }) },
      resetLayout() {
        const state = get()
        const restored = { ...defaults(), theme: state.preferences.theme }
        writePreferences(options.storage, restored)
        set({
          preferences: restored,
          drawers: CLOSED_DRAWERS,
          openDialog: null,
          mainViewPresentation: 'workspace',
        })
      },
    }
  })
}
