import type {
  WorkspaceDockV6,
  WorkspaceLayoutModeV6,
  WorkspacePreferencesV6,
} from './workspace-layout-store-v6.js'

export interface WorkspaceLayoutBoundsV6 {
  readonly mode: WorkspaceLayoutModeV6
  readonly widthPx: number
  readonly heightPx: number
  readonly dividerPx?: number
}

export interface ResolvedWorkspaceLayoutV6 {
  readonly toolboxWidthPx: number
  readonly explorerWidthPx: number
  readonly inspectorWidthPx: number
  readonly bottomHeightPx: number
  readonly viewportWidthPx: number
}

export interface ViewportSafeAreaV6 {
  readonly top: number
  readonly right: number
  readonly bottom: number
  readonly left: number
}

export interface ResolveViewportSafeAreaInputV6 {
  readonly mode: WorkspaceLayoutModeV6
  readonly presentation: 'workspace' | 'maximized'
  readonly drawers: Readonly<Record<WorkspaceDockV6, boolean>>
  readonly preferences: WorkspacePreferencesV6
  readonly resolved: ResolvedWorkspaceLayoutV6
  readonly workspaceHeightPx: number
}

const MIN_VIEWPORT_WIDTH_PX = 480
const MIN_EXPLORER_WIDTH_PX = 220
const MAX_EXPLORER_WIDTH_PX = 420
const MIN_INSPECTOR_WIDTH_PX = 280
const MAX_INSPECTOR_WIDTH_PX = 480
const MIN_BOTTOM_HEIGHT_PX = 120
const OVERLAY_GUTTER_PX = 12
const COLLAPSED_TOOLBOX_WIDTH_PX = 48
const EXPANDED_TOOLBOX_WIDTH_PX = 96

export const DOCK_RESIZE_TARGET_PX_V6 = 32

export const ZERO_VIEWPORT_SAFE_AREA_V6: ViewportSafeAreaV6 = Object.freeze({
  top: 0, right: 0, bottom: 0, left: 0,
})

function positive(value: number, fallback: number): number {
  return Number.isFinite(value) && value > 0 ? value : fallback
}

function clamp(value: number, minimum: number, maximum: number): number {
  if (!Number.isFinite(value)) return minimum
  return Math.min(maximum, Math.max(minimum, value))
}

function divider(bounds: WorkspaceLayoutBoundsV6): number {
  return positive(bounds.dividerPx ?? DOCK_RESIZE_TARGET_PX_V6, DOCK_RESIZE_TARGET_PX_V6)
}

function dockedVisible(
  mode: WorkspaceLayoutModeV6,
  dock: WorkspaceDockV6,
  preferences: WorkspacePreferencesV6,
): boolean {
  if (mode === 'narrow') return false
  if (mode === 'compact' && dock === 'inspector') return false
  return preferences.visibleByMode[mode][dock]
}

export function resolveWorkspaceModeV6(widthPx: number): WorkspaceLayoutModeV6 {
  if (!Number.isFinite(widthPx) || widthPx < 960) return 'narrow'
  return widthPx < 1200 ? 'compact' : 'wide'
}

export function maximumBottomHeightV6(heightPx: number): number {
  return Math.max(MIN_BOTTOM_HEIGHT_PX, positive(heightPx, 800) * 0.45)
}

export function dockSizeLimitsV6(
  dock: WorkspaceDockV6,
  heightPx: number,
): readonly [minimum: number, maximum: number] {
  if (dock === 'explorer') return [MIN_EXPLORER_WIDTH_PX, MAX_EXPLORER_WIDTH_PX]
  if (dock === 'inspector') return [MIN_INSPECTOR_WIDTH_PX, MAX_INSPECTOR_WIDTH_PX]
  return [MIN_BOTTOM_HEIGHT_PX, maximumBottomHeightV6(heightPx)]
}

export function clampDockSizeV6(dock: WorkspaceDockV6, value: number, heightPx: number): number {
  const [minimum, maximum] = dockSizeLimitsV6(dock, heightPx)
  return clamp(value, minimum, maximum)
}

export function resolveWorkspaceLayoutV6(
  inputBounds: WorkspaceLayoutBoundsV6,
  preferences: WorkspacePreferencesV6,
): ResolvedWorkspaceLayoutV6 {
  const widthPx = positive(inputBounds.widthPx, 1200)
  const heightPx = positive(inputBounds.heightPx, 800)
  const explorerVisible = dockedVisible(inputBounds.mode, 'explorer', preferences)
  const inspectorVisible = dockedVisible(inputBounds.mode, 'inspector', preferences)
  const toolboxWidthPx = preferences.toolboxCollapsed
    ? COLLAPSED_TOOLBOX_WIDTH_PX
    : EXPANDED_TOOLBOX_WIDTH_PX
  const dividerPx = divider(inputBounds)
  const explorerDivider = explorerVisible ? dividerPx : 0
  const inspectorDivider = inspectorVisible ? dividerPx : 0
  let explorerWidthPx = explorerVisible
    ? clampDockSizeV6('explorer', preferences.explorerWidthPx, heightPx)
    : 0
  let inspectorWidthPx = inspectorVisible
    ? clampDockSizeV6('inspector', preferences.inspectorWidthPx, heightPx)
    : 0
  const usableSideSpace = Math.max(
    0,
    widthPx - MIN_VIEWPORT_WIDTH_PX - toolboxWidthPx - explorerDivider - inspectorDivider,
  )
  let overflow = Math.max(0, explorerWidthPx + inspectorWidthPx - usableSideSpace)
  const inspectorReduction = Math.min(inspectorWidthPx, overflow)
  inspectorWidthPx -= inspectorReduction
  overflow -= inspectorReduction
  explorerWidthPx -= Math.min(explorerWidthPx, overflow)

  return Object.freeze({
    toolboxWidthPx,
    explorerWidthPx,
    inspectorWidthPx,
    bottomHeightPx: dockedVisible(inputBounds.mode, 'bottom', preferences)
      ? clampDockSizeV6('bottom', preferences.bottomHeightPx, heightPx)
      : 0,
    viewportWidthPx: Math.max(
      0,
      widthPx - toolboxWidthPx - explorerWidthPx - inspectorWidthPx
        - explorerDivider - inspectorDivider,
    ),
  })
}

export function resolveViewportSafeAreaV6({
  mode,
  presentation,
  drawers,
  preferences,
  workspaceHeightPx,
}: ResolveViewportSafeAreaInputV6): ViewportSafeAreaV6 {
  if (presentation === 'maximized') return ZERO_VIEWPORT_SAFE_AREA_V6
  const explorer = mode === 'narrow' && drawers.explorer
  const inspector = (mode === 'compact' || mode === 'narrow') && drawers.inspector
  const bottom = mode === 'narrow' && drawers.bottom
  if (!explorer && !inspector && !bottom) return ZERO_VIEWPORT_SAFE_AREA_V6
  return Object.freeze({
    top: 0,
    right: inspector ? clampDockSizeV6('inspector', preferences.inspectorWidthPx, 800) + OVERLAY_GUTTER_PX : 0,
    bottom: bottom
      ? clampDockSizeV6('bottom', preferences.bottomHeightPx, workspaceHeightPx) + OVERLAY_GUTTER_PX
      : 0,
    left: explorer ? clampDockSizeV6('explorer', preferences.explorerWidthPx, 800) + OVERLAY_GUTTER_PX : 0,
  })
}
