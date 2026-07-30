import { describe, expect, it, vi } from 'vitest'

import {
  WORKSPACE_PREFERENCES_STORAGE_KEY_V6,
  createWorkspaceLayoutStoreV6,
  type WorkspaceStorageV6,
} from './workspace-layout-store-v6.js'

class MemoryStorage implements WorkspaceStorageV6 {
  readonly values = new Map<string, string>()
  writes = 0

  getItem(key: string): string | null { return this.values.get(key) ?? null }
  setItem(key: string, value: string): void { this.writes += 1; this.values.set(key, value) }
  removeItem(key: string): void { this.values.delete(key) }
}

describe('WorkspaceLayoutStoreV6', () => {
  it('starts in workspace presentation and uses the responsive boundaries', () => {
    const store = createWorkspaceLayoutStoreV6({ storage: new MemoryStorage() })

    expect(store.getState().mainViewPresentation).toBe('workspace')
    store.getState().setWorkspaceBounds(1200, 800)
    expect(store.getState().mode).toBe('wide')
    store.getState().setWorkspaceBounds(1199, 800)
    expect(store.getState().mode).toBe('compact')
    store.getState().setWorkspaceBounds(959, 800)
    expect(store.getState().mode).toBe('narrow')
  })

  it('clamps each persisted dock size and the measured bottom maximum', () => {
    const store = createWorkspaceLayoutStoreV6({ storage: new MemoryStorage() })
    store.getState().setWorkspaceBounds(1440, 400)
    store.getState().setDockSize('explorer', 999)
    store.getState().setDockSize('inspector', 20)
    store.getState().setDockSize('bottom', 999)

    expect(store.getState().preferences.explorerWidthPx).toBe(420)
    expect(store.getState().preferences.inspectorWidthPx).toBe(280)
    expect(store.getState().preferences.bottomHeightPx).toBe(180)
  })

  it('recovers from corrupt, unsupported, and unavailable browser storage', () => {
    const corrupt = new MemoryStorage()
    corrupt.values.set(WORKSPACE_PREFERENCES_STORAGE_KEY_V6, '{not json')
    expect(createWorkspaceLayoutStoreV6({ storage: corrupt }).getState().preferences.version).toBe(1)

    const unsupported = new MemoryStorage()
    unsupported.values.set(WORKSPACE_PREFERENCES_STORAGE_KEY_V6, JSON.stringify({ version: 99 }))
    expect(createWorkspaceLayoutStoreV6({ storage: unsupported }).getState().preferences.theme).toBe('system')

    const storage: WorkspaceStorageV6 = {
      getItem: vi.fn(() => { throw new Error('disabled') }),
      setItem: vi.fn(() => { throw new Error('disabled') }),
      removeItem: vi.fn(),
    }
    expect(createWorkspaceLayoutStoreV6({ storage }).getState().preferences.version).toBe(1)
  })

  it('serializes only the preference allow-list, never transient layout state', () => {
    const storage = new MemoryStorage()
    const store = createWorkspaceLayoutStoreV6({ storage })
    Object.assign(store.getState().preferences, { sentinelRuntimeProperty: true })
    store.getState().setWorkspaceBounds(960, 700)
    store.getState().setDrawerOpen('inspector', true)
    store.getState().requestDialog({ kind: 'help', topic: 'about' })
    store.getState().toggleMainViewMaximized()
    store.getState().setActiveBottomTab('diagnostics')
    store.getState().setTheme('dark')

    const serialized = JSON.parse(storage.values.get(WORKSPACE_PREFERENCES_STORAGE_KEY_V6) ?? '{}') as Record<string, unknown>
    expect(serialized).toEqual({
      version: 1,
      theme: 'dark',
      explorerWidthPx: expect.any(Number),
      inspectorWidthPx: expect.any(Number),
      bottomHeightPx: expect.any(Number),
      toolboxCollapsed: expect.any(Boolean),
      visibleByMode: expect.any(Object),
    })
    expect(serialized).not.toHaveProperty('mainViewPresentation')
    expect(serialized).not.toHaveProperty('openDialog')
    expect(serialized).not.toHaveProperty('drawers')
    expect(serialized).not.toHaveProperty('activeBottomTab')
    expect(serialized).not.toHaveProperty('project')
    expect(serialized).not.toHaveProperty('selection')
    expect(serialized).not.toHaveProperty('sentinelRuntimeProperty')
  })

  it('closes every transient drawer when measured workspace mode changes', () => {
    const store = createWorkspaceLayoutStoreV6({ storage: null })
    store.getState().setWorkspaceBounds(959, 800)
    store.getState().setDrawerOpen('explorer', true)
    store.getState().setDrawerOpen('inspector', true)
    store.getState().setDrawerOpen('bottom', true)
    store.getState().setWorkspaceBounds(960, 800)

    expect(store.getState().drawers).toEqual({ explorer: false, inspector: false, bottom: false })

    store.getState().setDrawerOpen('inspector', true)
    store.getState().setWorkspaceBounds(959, 800)
    expect(store.getState().drawers).toEqual({ explorer: false, inspector: false, bottom: false })
  })

  it('clamps an open narrow Bottom sheet using the current measured height', () => {
    const store = createWorkspaceLayoutStoreV6({ storage: null })
    store.getState().setWorkspaceBounds(959, 800)
    store.getState().setDockSize('bottom', 360)
    store.getState().setWorkspaceBounds(959, 400)
    store.getState().setDrawerOpen('bottom', true)

    expect(store.getState().getSnapshot().viewportSafeArea.bottom).toBe(192)
  })

  it('resets geometry and visibility while preserving theme and selected bottom tab', () => {
    const store = createWorkspaceLayoutStoreV6({ storage: new MemoryStorage() })
    store.getState().setTheme('light')
    store.getState().setActiveBottomTab('diagnostics')
    store.getState().setDockSize('explorer', 360)
    store.getState().setDockVisible('wide', 'explorer', false)
    store.getState().setDrawerOpen('inspector', true)
    store.getState().requestDialog({ kind: 'help', topic: 'controls' })
    store.getState().toggleMainViewMaximized()
    store.getState().resetLayout()

    expect(store.getState().preferences.theme).toBe('light')
    expect(store.getState().activeBottomTab).toBe('diagnostics')
    expect(store.getState().preferences.explorerWidthPx).toBe(280)
    expect(store.getState().preferences.visibleByMode.wide.explorer).toBe(true)
    expect(store.getState().drawers).toEqual({ explorer: false, inspector: false, bottom: false })
    expect(store.getState().openDialog).toBeNull()
    expect(store.getState().mainViewPresentation).toBe('workspace')
  })
})
