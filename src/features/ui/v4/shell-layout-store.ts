import { createStore, type StoreApi } from 'zustand/vanilla'

import { isThemePreference, type ThemePreference } from '../theme-preference.js'
import type { BottomWorkspaceTabV4 } from './bottom-workspace-tab.js'

export type { BottomWorkspaceTabV4 } from './bottom-workspace-tab.js'

export const WORKSPACE_PREFERENCES_STORAGE_KEY_V1 = 'robotsim.workspace-preferences.v1'

const LEGACY_STORAGE_KEYS = [
  'robotsim.assetDrawerOpen',
  'robotsim.inspectorDrawerOpen',
  'robotsim.bottomDrawerOpen',
  'robotsim.sidebarSplitPercent',
  'robotsim.bottomWorkspaceTab',
  'robotsim.theme',
] as const

export type ShellLayoutModeV4 = 'wide' | 'compact' | 'narrow'
export type ShellDockV4 = 'sidebar' | 'inspector' | 'bottom'

export interface ShellWorkspacePreferencesV1 {
  readonly version: 1
  readonly modes: Readonly<Record<ShellLayoutModeV4, {
    readonly ribbonExpanded: boolean
    readonly dockVisible: Readonly<Record<ShellDockV4, boolean>>
  }>>
  readonly sidebar: { readonly widthPx: number; readonly sceneJobSplitPercent: number }
  readonly inspector: { readonly widthPx: number }
  readonly bottom: { readonly heightPx: number; readonly activeTab: BottomWorkspaceTabV4 }
  readonly theme: ThemePreference
}

export interface ShellLayoutStateV4 {
  readonly preferences: ShellWorkspacePreferencesV1
  setRibbonExpanded(mode: ShellLayoutModeV4, expanded: boolean): void
  setDockedVisible(mode: ShellLayoutModeV4, dock: ShellDockV4, visible: boolean): void
  setDockSize(dock: ShellDockV4, sizePx: number): void
  setSceneJobSplit(percent: number): void
  setBottomTab(tab: BottomWorkspaceTabV4): void
  setTheme(theme: ThemePreference): void
  resetLayout(): void
}

export type ShellLayoutStoreV4 = StoreApi<ShellLayoutStateV4>

export interface CreateShellLayoutStoreOptionsV4 {
  readonly storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null
}

function defaultPreferences(): ShellWorkspacePreferencesV1 {
  return {
    version: 1,
    modes: {
      wide: { ribbonExpanded: true, dockVisible: { sidebar: true, inspector: true, bottom: false } },
      compact: { ribbonExpanded: false, dockVisible: { sidebar: true, inspector: false, bottom: false } },
      narrow: { ribbonExpanded: false, dockVisible: { sidebar: false, inspector: false, bottom: false } },
    },
    sidebar: { widthPx: 248, sceneJobSplitPercent: 60 },
    inspector: { widthPx: 320 },
    bottom: { heightPx: 160, activeTab: 'timeline' },
    theme: 'system',
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function booleanOrDefault(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
}

function numberOrDefault(value: unknown, fallback: number, minimum: number, maximum = Number.POSITIVE_INFINITY): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= minimum && value <= maximum
    ? value
    : fallback
}

function dockVisibilityOrDefault(value: unknown, fallback: Readonly<Record<ShellDockV4, boolean>>): Readonly<Record<ShellDockV4, boolean>> {
  const source = isRecord(value) ? value : {}
  return {
    sidebar: booleanOrDefault(source.sidebar, fallback.sidebar),
    inspector: booleanOrDefault(source.inspector, fallback.inspector),
    bottom: booleanOrDefault(source.bottom, fallback.bottom),
  }
}

function modeOrDefault(value: unknown, fallback: ShellWorkspacePreferencesV1['modes'][ShellLayoutModeV4]): ShellWorkspacePreferencesV1['modes'][ShellLayoutModeV4] {
  const source = isRecord(value) ? value : {}
  return {
    ribbonExpanded: booleanOrDefault(source.ribbonExpanded, fallback.ribbonExpanded),
    dockVisible: dockVisibilityOrDefault(source.dockVisible, fallback.dockVisible),
  }
}

function normalizePreferences(value: unknown): ShellWorkspacePreferencesV1 | null {
  if (!isRecord(value) || value.version !== 1) return null
  const defaults = defaultPreferences()
  const modes = isRecord(value.modes) ? value.modes : {}
  const sidebar = isRecord(value.sidebar) ? value.sidebar : {}
  const inspector = isRecord(value.inspector) ? value.inspector : {}
  const bottom = isRecord(value.bottom) ? value.bottom : {}
  return {
    version: 1,
    modes: {
      wide: modeOrDefault(modes.wide, defaults.modes.wide),
      compact: {
        ...modeOrDefault(modes.compact, defaults.modes.compact),
        dockVisible: {
          ...modeOrDefault(modes.compact, defaults.modes.compact).dockVisible,
          inspector: false,
        },
      },
      narrow: {
        ...modeOrDefault(modes.narrow, defaults.modes.narrow),
        dockVisible: { sidebar: false, inspector: false, bottom: false },
      },
    },
    sidebar: {
      widthPx: numberOrDefault(sidebar.widthPx, defaults.sidebar.widthPx, 220, 420),
      sceneJobSplitPercent: numberOrDefault(sidebar.sceneJobSplitPercent, defaults.sidebar.sceneJobSplitPercent, 35, 75),
    },
    inspector: { widthPx: numberOrDefault(inspector.widthPx, defaults.inspector.widthPx, 280, 480) },
    bottom: {
      heightPx: numberOrDefault(bottom.heightPx, defaults.bottom.heightPx, 120),
      activeTab: bottom.activeTab === 'collision' ? 'collision' : 'timeline',
    },
    theme: isThemePreference(value.theme) ? value.theme : defaults.theme,
  }
}

function safeGet(storage: CreateShellLayoutStoreOptionsV4['storage'], key: string): string | null {
  try { return storage?.getItem(key) ?? null } catch { return null }
}

function safeSet(storage: CreateShellLayoutStoreOptionsV4['storage'], preferences: ShellWorkspacePreferencesV1): void {
  try { storage?.setItem(WORKSPACE_PREFERENCES_STORAGE_KEY_V1, JSON.stringify(preferences)) } catch {
    // Browser preferences are optional and never affect Project content.
  }
}

function migrateLegacyPreferences(storage: CreateShellLayoutStoreOptionsV4['storage']): ShellWorkspacePreferencesV1 {
  const legacy = Object.fromEntries(LEGACY_STORAGE_KEYS.map((key) => [key, safeGet(storage, key)])) as Record<(typeof LEGACY_STORAGE_KEYS)[number], string | null>
  const defaults = defaultPreferences()
  const split = Number(legacy['robotsim.sidebarSplitPercent'])
  const preferences: ShellWorkspacePreferencesV1 = {
    ...defaults,
    modes: {
      ...defaults.modes,
      wide: {
        ...defaults.modes.wide,
        dockVisible: {
          sidebar: legacy['robotsim.assetDrawerOpen'] === null ? defaults.modes.wide.dockVisible.sidebar : legacy['robotsim.assetDrawerOpen'] === 'true',
          inspector: legacy['robotsim.inspectorDrawerOpen'] === null ? defaults.modes.wide.dockVisible.inspector : legacy['robotsim.inspectorDrawerOpen'] === 'true',
          bottom: legacy['robotsim.bottomDrawerOpen'] === null ? defaults.modes.wide.dockVisible.bottom : legacy['robotsim.bottomDrawerOpen'] === 'true',
        },
      },
    },
    sidebar: { ...defaults.sidebar, sceneJobSplitPercent: numberOrDefault(split, defaults.sidebar.sceneJobSplitPercent, 35, 75) },
    bottom: { ...defaults.bottom, activeTab: legacy['robotsim.bottomWorkspaceTab'] === 'collision' ? 'collision' : 'timeline' },
    theme: isThemePreference(legacy['robotsim.theme']) ? legacy['robotsim.theme'] : defaults.theme,
  }
  safeSet(storage, preferences)
  if (LEGACY_STORAGE_KEYS.some((key) => legacy[key] !== null)) {
    for (const key of LEGACY_STORAGE_KEYS) {
      try { storage?.removeItem(key) } catch {
        // A failed legacy cleanup must not block the combined preference.
      }
    }
  }
  return preferences
}

function readPreferences(storage: CreateShellLayoutStoreOptionsV4['storage']): ShellWorkspacePreferencesV1 {
  const raw = safeGet(storage, WORKSPACE_PREFERENCES_STORAGE_KEY_V1)
  if (raw === null) return migrateLegacyPreferences(storage)
  try {
    const normalized = normalizePreferences(JSON.parse(raw)) ?? defaultPreferences()
    safeSet(storage, normalized)
    return normalized
  } catch {
    const defaults = defaultPreferences()
    safeSet(storage, defaults)
    return defaults
  }
}

function clamp(value: number, fallback: number, minimum: number, maximum?: number): number {
  if (!Number.isFinite(value)) return fallback
  return Math.min(maximum ?? Number.POSITIVE_INFINITY, Math.max(minimum, value))
}

function supportsPersistedDock(mode: ShellLayoutModeV4, dock: ShellDockV4): boolean {
  return mode === 'wide' || (mode === 'compact' && (dock === 'sidebar' || dock === 'bottom'))
}

export function createShellLayoutStoreV4(options: CreateShellLayoutStoreOptionsV4): ShellLayoutStoreV4 {
  const initialPreferences = readPreferences(options.storage)
  return createStore<ShellLayoutStateV4>((set, get) => {
    const replacePreferences = (preferences: ShellWorkspacePreferencesV1) => {
      safeSet(options.storage, preferences)
      set({ preferences })
    }
    return {
      preferences: initialPreferences,
      setRibbonExpanded(mode, expanded) {
        const current = get().preferences
        replacePreferences({ ...current, modes: { ...current.modes, [mode]: { ...current.modes[mode], ribbonExpanded: expanded } } })
      },
      setDockedVisible(mode, dock, visible) {
        if (!supportsPersistedDock(mode, dock)) return
        const current = get().preferences
        replacePreferences({ ...current, modes: { ...current.modes, [mode]: { ...current.modes[mode], dockVisible: { ...current.modes[mode].dockVisible, [dock]: visible } } } })
      },
      setDockSize(dock, sizePx) {
        const current = get().preferences
        if (dock === 'sidebar') {
          replacePreferences({ ...current, sidebar: { ...current.sidebar, widthPx: clamp(sizePx, 248, 220, 420) } })
        } else if (dock === 'inspector') {
          replacePreferences({ ...current, inspector: { widthPx: clamp(sizePx, 320, 280, 480) } })
        } else {
          replacePreferences({ ...current, bottom: { ...current.bottom, heightPx: clamp(sizePx, 160, 120) } })
        }
      },
      setSceneJobSplit(percent) {
        const current = get().preferences
        replacePreferences({ ...current, sidebar: { ...current.sidebar, sceneJobSplitPercent: Math.round(clamp(percent, 60, 35, 75)) } })
      },
      setBottomTab(tab) {
        const current = get().preferences
        replacePreferences({ ...current, bottom: { ...current.bottom, activeTab: tab } })
      },
      setTheme(theme) {
        const current = get().preferences
        replacePreferences({ ...current, theme: isThemePreference(theme) ? theme : 'system' })
      },
      resetLayout() {
        const current = get().preferences
        const defaults = defaultPreferences()
        replacePreferences({ ...defaults, bottom: { ...defaults.bottom, activeTab: current.bottom.activeTab }, theme: current.theme })
      },
    }
  })
}
