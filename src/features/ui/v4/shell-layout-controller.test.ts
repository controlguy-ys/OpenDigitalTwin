import { describe, expect, it } from 'vitest'

import { createShellLayoutStoreV4 } from './shell-layout-store.js'
import { initialShellLayoutBoundsV4 } from './shell-layout-geometry.js'
import { createShellLayoutControllerV4 } from './shell-layout-controller.js'

class MemoryStorage {
  writes = 0
  readonly values = new Map<string, string>()
  getItem(key: string) { return this.values.get(key) ?? null }
  setItem(key: string, value: string) { this.writes += 1; this.values.set(key, value) }
  removeItem(key: string) { this.values.delete(key) }
}

function createController(width = 1440, height = 900) {
  const storage = new MemoryStorage()
  const store = createShellLayoutStoreV4({ storage })
  const controller = createShellLayoutControllerV4({
    preferencesStore: store,
    initialBounds: initialShellLayoutBoundsV4(width, height),
  })
  return { storage, store, controller }
}

describe('ShellLayoutControllerV4', () => {
  it('transitions wide, compact, and narrow without mutating stored width preferences and restores them on return', () => {
    const { controller, store } = createController(1200)
    const before = store.getState().preferences
    const modes: string[] = []
    controller.subscribe(() => modes.push(controller.getState().mode))

    controller.setBounds(1199, 900)
    controller.setBounds(960, 900)
    controller.setBounds(959, 900)
    controller.setBounds(1440, 900)

    expect(modes).toEqual(['compact', 'compact', 'narrow', 'wide'])
    expect(store.getState().preferences.sidebar.widthPx).toBe(before.sidebar.widthPx)
    expect(store.getState().preferences.inspector.widthPx).toBe(before.inspector.widthPx)
    expect(controller.getState().resolved).toMatchObject({ sidebarWidthPx: 248, inspectorWidthPx: 320 })
  })

  it('keeps compact Inspector and narrow drawers transient, exclusive where required, and out of storage', () => {
    const { controller, storage } = createController(1199)
    const writes = storage.writes
    controller.setDockVisible('inspector', true)
    expect(controller.getState().isDockVisible('inspector')).toBe(true)
    expect(storage.writes).toBe(writes)
    controller.setBounds(959, 900)
    expect(controller.getState().overlays).toEqual({ sidebarOpen: false, inspectorOpen: false, bottomOpen: false })
    controller.setDockVisible('sidebar', true)
    controller.setDockVisible('bottom', true)
    controller.setDockVisible('inspector', true)
    expect(controller.getState().overlays).toEqual({ sidebarOpen: false, inspectorOpen: true, bottomOpen: true })
    expect(storage.writes).toBe(writes)
  })

  it('persists only docked visibility and publishes immutable new snapshots from store changes and not after dispose', () => {
    const { controller, storage, store } = createController()
    const first = controller.getState()
    let calls = 0
    controller.subscribe(() => { calls += 1 })
    controller.setDockVisible('bottom', true)
    expect(storage.writes).toBeGreaterThan(0)
    expect(controller.getState()).not.toBe(first)
    const afterWrite = controller.getState()
    store.getState().setTheme('dark')
    expect(controller.getState()).not.toBe(afterWrite)
    controller.dispose()
    store.getState().setTheme('light')
    expect(calls).toBe(2)
  })

  it('sets one addressed dock size, delegates layout preferences, and resets only layout while closing overlays', () => {
    const { controller, store } = createController(959)
    controller.setDockVisible('sidebar', true)
    controller.setDockVisible('bottom', true)
    controller.setTheme('dark')
    controller.setBottomTab('collision')
    controller.setDockSize('bottom', 300)
    controller.setSceneJobSplit(67)
    expect(store.getState().preferences.bottom.heightPx).toBe(300)
    expect(store.getState().preferences.sidebar.sceneJobSplitPercent).toBe(67)
    controller.resetLayout()
    expect(controller.getState().overlays).toEqual({ sidebarOpen: false, inspectorOpen: false, bottomOpen: false })
    expect(store.getState().preferences.theme).toBe('dark')
    expect(store.getState().preferences.bottom.activeTab).toBe('collision')
    expect(store.getState().preferences.sidebar.sceneJobSplitPercent).toBe(60)
  })

  it('reports safe area only for transient overlays and includes the 12 CSS-pixel gutter', () => {
    const { controller } = createController(1199)
    expect(controller.getState().safeAreaInsets).toEqual({ top: 0, right: 0, bottom: 0, left: 0 })
    controller.setDockVisible('inspector', true)
    expect(controller.getState().safeAreaInsets).toEqual({ top: 0, right: 332, bottom: 0, left: 0 })
    controller.setBounds(959, 900)
    controller.setDockVisible('sidebar', true)
    controller.setDockVisible('bottom', true)
    expect(controller.getState().safeAreaInsets).toEqual({ top: 0, right: 0, bottom: 172, left: 260 })
  })

  it('closes every transient overlay on each actual mode transition but leaves it alone within one mode', () => {
    const { controller } = createController(1199)
    controller.setDockVisible('inspector', true)
    controller.setBounds(960, 900)
    expect(controller.getState().overlays.inspectorOpen).toBe(true)
    controller.setBounds(959, 900)
    expect(controller.getState().overlays).toEqual({ sidebarOpen: false, inspectorOpen: false, bottomOpen: false })
    controller.setDockVisible('sidebar', true)
    controller.setDockVisible('bottom', true)
    controller.setBounds(960, 900)
    expect(controller.getState().overlays).toEqual({ sidebarOpen: false, inspectorOpen: false, bottomOpen: false })
    controller.setDockVisible('inspector', true)
    controller.setBounds(1200, 900)
    expect(controller.getState().overlays).toEqual({ sidebarOpen: false, inspectorOpen: false, bottomOpen: false })
  })

  it('keeps the exact snapshot object for no-op operations and changes only the addressed side preference on resize', () => {
    const { controller, store } = createController()
    const first = controller.getState()
    controller.setBounds(1440, 900)
    controller.setDockVisible('sidebar', true)
    controller.setRibbonExpanded(true)
    controller.setDockSize('sidebar', 248)
    controller.setSceneJobSplit(60)
    controller.setBottomTab('timeline')
    controller.setTheme('system')
    expect(controller.getState()).toBe(first)

    controller.setDockSize('sidebar', 300)
    expect(store.getState().preferences).toMatchObject({ sidebar: { widthPx: 300 }, inspector: { widthPx: 320 } })
    controller.setDockSize('inspector', 400)
    expect(store.getState().preferences).toMatchObject({ sidebar: { widthPx: 300 }, inspector: { widthPx: 400 } })
  })
})
