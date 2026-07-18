import { describe, expect, it } from 'vitest'

import { createShellLayoutStoreV4 } from './shell-layout-store.js'
import {
  MIN_NARROW_SCENE_JOB_RESIZE_HEIGHT_PX_V4,
  initialShellLayoutBoundsV4,
  isSceneJobResizeAvailableV4,
  modeForShellWidthV4,
  resolveActiveDockResizeV4,
  resolveShellLayoutV4,
} from './shell-layout-geometry.js'

function preferences() {
  return createShellLayoutStoreV4({ storage: null }).getState().preferences
}

describe('shell layout geometry', () => {
  it('uses the approved responsive mode boundaries and independently normalizes invalid bounds', () => {
    expect(modeForShellWidthV4(1200)).toBe('wide')
    expect(modeForShellWidthV4(1199)).toBe('compact')
    expect(modeForShellWidthV4(960)).toBe('compact')
    expect(modeForShellWidthV4(959)).toBe('narrow')

    expect(initialShellLayoutBoundsV4(Number.NaN, 900, 0)).toEqual({
      mode: 'wide', widthPx: 1200, workspaceHeightPx: 900, dividerPx: 6,
    })
    expect(initialShellLayoutBoundsV4(900, Number.POSITIVE_INFINITY, Number.NaN)).toEqual({
      mode: 'narrow', widthPx: 900, workspaceHeightPx: 800, dividerPx: 6,
    })
  })

  it('resolves approved wide, compact, narrow, and hidden-dock geometry without negative values', () => {
    const defaults = preferences()
    expect(resolveShellLayoutV4(initialShellLayoutBoundsV4(1440, 900), defaults)).toEqual({
      sidebarWidthPx: 248, inspectorWidthPx: 320, bottomHeightPx: 160, viewportWidthPx: 860,
    })
    const compact = { ...defaults, sidebar: { ...defaults.sidebar, widthPx: 420 } }
    expect(resolveShellLayoutV4(initialShellLayoutBoundsV4(960, 900), compact)).toMatchObject({
      sidebarWidthPx: 420, inspectorWidthPx: 0, viewportWidthPx: 534,
    })
    expect(resolveShellLayoutV4(initialShellLayoutBoundsV4(959, 900), defaults)).toMatchObject({
      sidebarWidthPx: 0, inspectorWidthPx: 0, viewportWidthPx: 959,
    })
    const hidden = {
      ...defaults,
      modes: {
        ...defaults.modes,
        wide: { ...defaults.modes.wide, dockVisible: { ...defaults.modes.wide.dockVisible, sidebar: false } },
      },
    }
    expect(resolveShellLayoutV4(initialShellLayoutBoundsV4(1440, 900), hidden)).toMatchObject({
      sidebarWidthPx: 0, inspectorWidthPx: 320, viewportWidthPx: 1114,
    })
  })

  it('passively shrinks inspector first and then sidebar while preserving preferences and restoring them after growth', () => {
    const source = {
      ...preferences(),
      sidebar: { widthPx: 420, sceneJobSplitPercent: 60 },
      inspector: { widthPx: 480 },
    }
    const bytesBefore = JSON.stringify(source)
    const inspectorFirst = resolveShellLayoutV4({ ...initialShellLayoutBoundsV4(1100, 800), mode: 'wide' }, source)
    const sidebarSecond = resolveShellLayoutV4({ ...initialShellLayoutBoundsV4(800, 800), mode: 'wide' }, source)
    const restored = resolveShellLayoutV4(initialShellLayoutBoundsV4(1600, 800), source)

    expect(inspectorFirst).toMatchObject({ sidebarWidthPx: 420, inspectorWidthPx: 188, viewportWidthPx: 480 })
    expect(sidebarSecond).toMatchObject({ sidebarWidthPx: 308, inspectorWidthPx: 0, viewportWidthPx: 480 })
    expect(restored).toMatchObject({ sidebarWidthPx: 420, inspectorWidthPx: 480 })
    expect(JSON.stringify(source)).toBe(bytesBefore)
  })

  it('clamps only the active dock, ignores unsupported side resizing, and bounds Bottom independently', () => {
    const source = {
      ...preferences(),
      sidebar: { widthPx: 300, sceneJobSplitPercent: 60 },
      inspector: { widthPx: 400 },
    }
    const bytesBefore = JSON.stringify(source)
    const wide = initialShellLayoutBoundsV4(1200, 900)
    expect(resolveActiveDockResizeV4('sidebar', 999, wide, source)).toBe(308)
    expect(source.inspector.widthPx).toBe(400)
    expect(resolveActiveDockResizeV4('inspector', 999, wide, source)).toBe(408)
    expect(source.sidebar.widthPx).toBe(300)
    expect(resolveActiveDockResizeV4('inspector', 400, initialShellLayoutBoundsV4(960, 900), source)).toBe(400)
    expect(resolveActiveDockResizeV4('sidebar', 400, initialShellLayoutBoundsV4(959, 900), source)).toBe(300)
    expect(resolveActiveDockResizeV4('bottom', 999, initialShellLayoutBoundsV4(1440, 200), source)).toBe(120)
    expect(resolveActiveDockResizeV4('bottom', Number.NaN, initialShellLayoutBoundsV4(1440, 900), source)).toBe(160)
    expect(JSON.stringify(source)).toBe(bytesBefore)
  })

  it('caps a normal Bottom rail at 45 percent of workspace height', () => {
    const source = { ...preferences(), bottom: { heightPx: 999, activeTab: 'timeline' as const } }
    expect(resolveShellLayoutV4(initialShellLayoutBoundsV4(1440, 1000), source).bottomHeightPx).toBe(450)
  })

  it('applies the approved Scene-to-Job availability threshold', () => {
    expect(isSceneJobResizeAvailableV4('wide', 0)).toBe(true)
    expect(isSceneJobResizeAvailableV4('compact', Number.NaN)).toBe(true)
    expect(isSceneJobResizeAvailableV4('narrow', MIN_NARROW_SCENE_JOB_RESIZE_HEIGHT_PX_V4)).toBe(true)
    expect(isSceneJobResizeAvailableV4('narrow', 359)).toBe(false)
    expect(isSceneJobResizeAvailableV4('narrow', Number.POSITIVE_INFINITY)).toBe(false)
  })
})
