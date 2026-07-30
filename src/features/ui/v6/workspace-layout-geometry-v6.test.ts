import { describe, expect, it } from 'vitest'

import {
  resolveViewportSafeAreaV6,
  resolveWorkspaceLayoutV6,
  resolveWorkspaceModeV6,
} from './workspace-layout-geometry-v6.js'
import { createWorkspaceLayoutStoreV6 } from './workspace-layout-store-v6.js'

describe('workspace layout geometry V6', () => {
  it('resolves the exact responsive boundaries', () => {
    expect(resolveWorkspaceModeV6(1200)).toBe('wide')
    expect(resolveWorkspaceModeV6(1199)).toBe('compact')
    expect(resolveWorkspaceModeV6(960)).toBe('compact')
    expect(resolveWorkspaceModeV6(959)).toBe('narrow')
  })

  it('keeps a 480px central viewport in wide and compact layouts', () => {
    const preferences = createWorkspaceLayoutStoreV6({ storage: null }).getState().preferences
    const wide = resolveWorkspaceLayoutV6({ mode: 'wide', widthPx: 1200, heightPx: 800 }, preferences)
    const compact = resolveWorkspaceLayoutV6({ mode: 'compact', widthPx: 960, heightPx: 800 }, preferences)

    expect(wide.viewportWidthPx).toBeGreaterThanOrEqual(480)
    expect(compact.viewportWidthPx).toBeGreaterThanOrEqual(480)
    expect(wide.bottomHeightPx).toBeLessThanOrEqual(360)
    expect(compact.inspectorWidthPx).toBe(0)
  })

  it('derives overlay safe areas without mutating the supplied preferences', () => {
    const preferences = createWorkspaceLayoutStoreV6({ storage: null }).getState().preferences
    const before = structuredClone(preferences)
    const resolved = resolveWorkspaceLayoutV6({ mode: 'narrow', widthPx: 700, heightPx: 600 }, preferences)
    const safeArea = resolveViewportSafeAreaV6({
      mode: 'narrow',
      presentation: 'workspace',
      drawers: { explorer: true, inspector: true, bottom: true },
      preferences,
      resolved,
    })

    expect(safeArea).toEqual({ top: 0, right: 372, bottom: 192, left: 292 })
    expect(preferences).toEqual(before)
  })

  it('returns zero safe area in maximized presentation', () => {
    const preferences = createWorkspaceLayoutStoreV6({ storage: null }).getState().preferences
    const resolved = resolveWorkspaceLayoutV6({ mode: 'compact', widthPx: 1000, heightPx: 800 }, preferences)

    expect(resolveViewportSafeAreaV6({
      mode: 'compact', presentation: 'maximized', drawers: { explorer: false, inspector: true, bottom: false }, preferences, resolved,
    })).toEqual({ top: 0, right: 0, bottom: 0, left: 0 })
  })
})
