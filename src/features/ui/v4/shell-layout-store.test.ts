import { describe, expect, it } from 'vitest'

import {
  WORKSPACE_PREFERENCES_STORAGE_KEY_V1,
  createShellLayoutStoreV4,
} from './shell-layout-store.js'

class MemoryStorage {
  readonly values = new Map<string, string>()
  writes = 0

  getItem(key: string): string | null {
    return this.values.get(key) ?? null
  }

  setItem(key: string, value: string): void {
    this.writes += 1
    this.values.set(key, value)
  }

  removeItem(key: string): void {
    this.values.delete(key)
  }
}

function createStore(storage = new MemoryStorage()) {
  return { storage, store: createShellLayoutStoreV4({ storage }) }
}

const defaults = {
  version: 1,
  modes: {
    wide: {
      ribbonExpanded: true,
      dockVisible: { sidebar: true, inspector: true, bottom: false },
    },
    compact: {
      ribbonExpanded: false,
      dockVisible: { sidebar: true, inspector: false, bottom: false },
    },
    narrow: {
      ribbonExpanded: false,
      dockVisible: { sidebar: false, inspector: false, bottom: false },
    },
  },
  sidebar: { widthPx: 248, sceneJobSplitPercent: 60 },
  inspector: { widthPx: 320 },
  bottom: { heightPx: 160, activeTab: 'timeline' },
  theme: 'system',
} as const

describe('ShellLayoutStoreV4', () => {
  it('starts with the approved mode-aware workspace defaults', () => {
    const { store } = createStore()

    expect(store.getState().preferences).toEqual(defaults)
  })

  it('clamps dock dimensions and the Scene-to-Job divider to their approved ranges', () => {
    const { store } = createStore()

    store.getState().setDockSize('sidebar', 999)
    store.getState().setDockSize('inspector', 1)
    store.getState().setSceneJobSplit(10)
    expect(store.getState().preferences).toMatchObject({
      sidebar: { widthPx: 420, sceneJobSplitPercent: 35 },
      inspector: { widthPx: 280 },
    })

    store.getState().setSceneJobSplit(99)
    expect(store.getState().preferences.sidebar.sceneJobSplitPercent).toBe(75)
  })

  it('resets layout without changing Theme or the selected Bottom tab', () => {
    const { store } = createStore()

    store.getState().setTheme('dark')
    store.getState().setBottomTab('collision')
    store.getState().setDockedVisible('wide', 'inspector', false)
    store.getState().setRibbonExpanded('compact', true)
    store.getState().resetLayout()

    expect(store.getState().preferences.theme).toBe('dark')
    expect(store.getState().preferences.bottom.activeTab).toBe('collision')
    expect(store.getState().preferences.modes.wide.dockVisible.inspector).toBe(true)
    expect(store.getState().preferences.modes.compact.ribbonExpanded).toBe(false)
  })

  it('persists a non-default Scene-to-Job divider and restores it in a recreated store', () => {
    const storage = new MemoryStorage()
    const first = createShellLayoutStoreV4({ storage })
    first.getState().setSceneJobSplit(67)

    const second = createShellLayoutStoreV4({ storage })

    expect(second.getState().preferences.sidebar.sceneJobSplitPercent).toBe(67)
  })

  it('resets only the Scene-to-Job divider when it receives its default value', () => {
    const { store } = createStore()
    store.getState().setDockSize('sidebar', 300)
    store.getState().setDockSize('inspector', 400)
    store.getState().setDockSize('bottom', 180)
    store.getState().setRibbonExpanded('wide', false)
    store.getState().setDockedVisible('wide', 'bottom', true)
    store.getState().setTheme('dark')
    store.getState().setBottomTab('collision')
    store.getState().setSceneJobSplit(67)
    const before = store.getState().preferences

    store.getState().setSceneJobSplit(60)

    expect(store.getState().preferences).toEqual({
      ...before,
      sidebar: { ...before.sidebar, sceneJobSplitPercent: 60 },
    })
  })

  it('keeps compact Inspector and all narrow dock visibility transient and unwritten', () => {
    const { storage, store } = createStore()
    const before = storage.getItem(WORKSPACE_PREFERENCES_STORAGE_KEY_V1)
    const writes = storage.writes

    store.getState().setDockedVisible('compact', 'inspector', true)
    store.getState().setDockedVisible('narrow', 'sidebar', true)
    store.getState().setDockedVisible('narrow', 'inspector', true)
    store.getState().setDockedVisible('narrow', 'bottom', true)

    expect(storage.writes).toBe(writes)
    expect(storage.getItem(WORKSPACE_PREFERENCES_STORAGE_KEY_V1)).toBe(before)
    expect(store.getState().preferences).toEqual(defaults)
  })

  it('migrates the six legacy shell, tab, and Theme keys into one combined preference', () => {
    const storage = new MemoryStorage()
    storage.values.set('robotsim.assetDrawerOpen', 'false')
    storage.values.set('robotsim.inspectorDrawerOpen', 'false')
    storage.values.set('robotsim.bottomDrawerOpen', 'true')
    storage.values.set('robotsim.sidebarSplitPercent', '67')
    storage.values.set('robotsim.bottomWorkspaceTab', 'collision')
    storage.values.set('robotsim.theme', 'dark')

    const store = createShellLayoutStoreV4({ storage })

    expect(store.getState().preferences).toMatchObject({
      modes: { wide: { dockVisible: { sidebar: false, inspector: false, bottom: true } } },
      sidebar: { sceneJobSplitPercent: 67 },
      bottom: { activeTab: 'collision' },
      theme: 'dark',
    })
    expect([...storage.values.keys()]).toEqual([
      WORKSPACE_PREFERENCES_STORAGE_KEY_V1,
    ])
  })

  it('resets malformed JSON and unsupported versions as a whole preference object', () => {
    for (const raw of ['{malformed', JSON.stringify({ version: 2 })]) {
      const storage = new MemoryStorage()
      storage.values.set(WORKSPACE_PREFERENCES_STORAGE_KEY_V1, raw)

      const store = createShellLayoutStoreV4({ storage })

      expect(store.getState().preferences).toEqual(defaults)
      expect(storage.getItem(WORKSPACE_PREFERENCES_STORAGE_KEY_V1)).toBe(
        JSON.stringify(defaults),
      )
    }
  })

  it('normalizes missing, wrong-type, out-of-range, NaN, and Infinity fields independently', () => {
    const storage = new MemoryStorage()
    const persisted = JSON.stringify({
      ...defaults,
      modes: {
        ...defaults.modes,
        wide: { ribbonExpanded: 'yes', dockVisible: { ...defaults.modes.wide.dockVisible } },
      },
      sidebar: { widthPx: 999, sceneJobSplitPercent: 67 },
      inspector: {},
      bottom: { heightPx: 160, activeTab: 'collision' },
      theme: 'invalid',
    }).replace('"heightPx":160', '"heightPx":1e999')
    storage.values.set(WORKSPACE_PREFERENCES_STORAGE_KEY_V1, persisted)
    const store = createShellLayoutStoreV4({ storage })

    expect(store.getState().preferences).toEqual({
      ...defaults,
      modes: {
        ...defaults.modes,
        wide: { ...defaults.modes.wide, ribbonExpanded: true },
      },
      sidebar: { widthPx: 248, sceneJobSplitPercent: 67 },
      bottom: { heightPx: 160, activeTab: 'collision' },
    })

    store.getState().setDockSize('sidebar', Number.NaN)
    store.getState().setDockSize('inspector', Number.POSITIVE_INFINITY)
    store.getState().setSceneJobSplit(Number.NaN)
    expect(store.getState().preferences).toMatchObject({
      sidebar: { widthPx: 248, sceneJobSplitPercent: 60 },
      inspector: { widthPx: 320 },
    })
  })

  it('normalizes compact Inspector and all narrow dock visibility to closed across reloads', () => {
    const storage = new MemoryStorage()
    storage.values.set(WORKSPACE_PREFERENCES_STORAGE_KEY_V1, JSON.stringify({
      ...defaults,
      modes: {
        ...defaults.modes,
        compact: {
          ...defaults.modes.compact,
          dockVisible: { ...defaults.modes.compact.dockVisible, inspector: true },
        },
        narrow: {
          ...defaults.modes.narrow,
          dockVisible: { sidebar: true, inspector: true, bottom: true },
        },
      },
    }))

    const first = createShellLayoutStoreV4({ storage })
    const persisted = storage.getItem(WORKSPACE_PREFERENCES_STORAGE_KEY_V1)!
    const second = createShellLayoutStoreV4({ storage })

    expect(first.getState().preferences.modes.compact.dockVisible.inspector).toBe(false)
    expect(first.getState().preferences.modes.narrow.dockVisible).toEqual({
      sidebar: false,
      inspector: false,
      bottom: false,
    })
    expect(persisted).toContain('"inspector":false')
    expect(second.getState().preferences).toEqual(first.getState().preferences)
  })

  it('tolerates storage read, write, and legacy cleanup exceptions', () => {
    const storage = {
      getItem: () => { throw new Error('read blocked') },
      setItem: () => { throw new Error('write blocked') },
      removeItem: () => { throw new Error('remove blocked') },
    }

    const store = createShellLayoutStoreV4({ storage })
    store.getState().setTheme('dark')
    store.getState().resetLayout()

    expect(store.getState().preferences.theme).toBe('dark')
  })

  it('never touches Viewport or Project storage when resetting layout', () => {
    const storage = new MemoryStorage()
    storage.values.set('robotsim.viewport-preferences.v4', '{"camera":"unchanged"}')
    storage.values.set('robotsim.project.v4', '{"project":"unchanged"}')
    const { store } = createStore(storage)
    const viewportBefore = storage.getItem('robotsim.viewport-preferences.v4')
    const projectBefore = storage.getItem('robotsim.project.v4')

    store.getState().resetLayout()

    expect(storage.getItem('robotsim.viewport-preferences.v4')).toBe(viewportBefore)
    expect(storage.getItem('robotsim.project.v4')).toBe(projectBefore)
  })
})
