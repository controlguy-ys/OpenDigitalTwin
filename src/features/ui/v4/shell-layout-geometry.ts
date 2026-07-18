import type {
  ShellDockV4,
  ShellLayoutModeV4,
  ShellWorkspacePreferencesV1,
} from './shell-layout-store.js'

export interface ShellLayoutBoundsV4 {
  readonly mode: ShellLayoutModeV4
  readonly widthPx: number
  readonly workspaceHeightPx: number
  readonly dividerPx: number
}

export interface ResolvedShellLayoutV4 {
  readonly sidebarWidthPx: number
  readonly inspectorWidthPx: number
  readonly bottomHeightPx: number
  readonly viewportWidthPx: number
}

const DEFAULT_WIDTH_PX = 1200
const DEFAULT_HEIGHT_PX = 800
const DEFAULT_DIVIDER_PX = 6
const MIN_VIEWPORT_WIDTH_PX = 480
const MIN_SIDEBAR_WIDTH_PX = 220
const MAX_SIDEBAR_WIDTH_PX = 420
const MIN_INSPECTOR_WIDTH_PX = 280
const MAX_INSPECTOR_WIDTH_PX = 480
const MIN_BOTTOM_HEIGHT_PX = 120

export const MIN_NARROW_SCENE_JOB_RESIZE_HEIGHT_PX_V4 = 360

function finitePositive(value: number, fallback: number): number {
  return Number.isFinite(value) && value > 0 ? value : fallback
}

function finiteNonNegative(value: number, fallback = 0): number {
  return Number.isFinite(value) && value >= 0 ? value : fallback
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min
  return Math.min(max, Math.max(min, value))
}

function modeFromBounds(bounds: ShellLayoutBoundsV4): ShellLayoutModeV4 {
  if (bounds.mode === 'wide' || bounds.mode === 'compact' || bounds.mode === 'narrow') {
    return bounds.mode
  }
  return modeForShellWidthV4(bounds.widthPx)
}

function normalizedBounds(bounds: ShellLayoutBoundsV4): ShellLayoutBoundsV4 {
  const widthPx = finitePositive(bounds.widthPx, DEFAULT_WIDTH_PX)
  const workspaceHeightPx = finitePositive(bounds.workspaceHeightPx, DEFAULT_HEIGHT_PX)
  const dividerPx = finitePositive(bounds.dividerPx, DEFAULT_DIVIDER_PX)
  return { mode: modeFromBounds({ ...bounds, widthPx }), widthPx, workspaceHeightPx, dividerPx }
}

function preferredSize(preferences: ShellWorkspacePreferencesV1, dock: ShellDockV4): number {
  if (dock === 'sidebar') return clamp(preferences.sidebar.widthPx, MIN_SIDEBAR_WIDTH_PX, MAX_SIDEBAR_WIDTH_PX)
  if (dock === 'inspector') return clamp(preferences.inspector.widthPx, MIN_INSPECTOR_WIDTH_PX, MAX_INSPECTOR_WIDTH_PX)
  return finitePositive(preferences.bottom.heightPx, 160)
}

function isDockedVisible(mode: ShellLayoutModeV4, dock: ShellDockV4, preferences: ShellWorkspacePreferencesV1): boolean {
  if (mode === 'narrow') return false
  if (dock === 'inspector') return mode === 'wide' && preferences.modes.wide.dockVisible.inspector
  if (dock === 'sidebar') return preferences.modes[mode].dockVisible.sidebar
  return preferences.modes[mode].dockVisible.bottom
}

function bottomMaximum(bounds: ShellLayoutBoundsV4): number {
  return Math.max(MIN_BOTTOM_HEIGHT_PX, bounds.workspaceHeightPx * 0.45)
}

export function modeForShellWidthV4(widthPx: number): ShellLayoutModeV4 {
  if (!Number.isFinite(widthPx) || widthPx < 960) return 'narrow'
  if (widthPx < 1200) return 'compact'
  return 'wide'
}

export function initialShellLayoutBoundsV4(
  widthPx: number,
  heightPx: number,
  dividerPx = DEFAULT_DIVIDER_PX,
): ShellLayoutBoundsV4 {
  const normalizedWidth = finitePositive(widthPx, DEFAULT_WIDTH_PX)
  return {
    mode: modeForShellWidthV4(normalizedWidth),
    widthPx: normalizedWidth,
    workspaceHeightPx: finitePositive(heightPx, DEFAULT_HEIGHT_PX),
    dividerPx: finitePositive(dividerPx, DEFAULT_DIVIDER_PX),
  }
}

export function resolveShellLayoutV4(
  inputBounds: ShellLayoutBoundsV4,
  preferences: ShellWorkspacePreferencesV1,
): ResolvedShellLayoutV4 {
  const bounds = normalizedBounds(inputBounds)
  const sidebarVisible = isDockedVisible(bounds.mode, 'sidebar', preferences)
  const inspectorVisible = isDockedVisible(bounds.mode, 'inspector', preferences)
  const sidebarDivider = sidebarVisible ? bounds.dividerPx : 0
  const inspectorDivider = inspectorVisible ? bounds.dividerPx : 0
  let sidebarWidthPx = sidebarVisible ? preferredSize(preferences, 'sidebar') : 0
  let inspectorWidthPx = inspectorVisible ? preferredSize(preferences, 'inspector') : 0
  const usableSideSpace = Math.max(0, bounds.widthPx - MIN_VIEWPORT_WIDTH_PX - sidebarDivider - inspectorDivider)
  let overflow = Math.max(0, sidebarWidthPx + inspectorWidthPx - usableSideSpace)
  const inspectorReduction = Math.min(inspectorWidthPx, overflow)
  inspectorWidthPx -= inspectorReduction
  overflow -= inspectorReduction
  const sidebarReduction = Math.min(sidebarWidthPx, overflow)
  sidebarWidthPx -= sidebarReduction
  const viewportWidthPx = Math.max(0, bounds.widthPx - sidebarWidthPx - inspectorWidthPx - sidebarDivider - inspectorDivider)
  return {
    sidebarWidthPx: finiteNonNegative(sidebarWidthPx),
    inspectorWidthPx: finiteNonNegative(inspectorWidthPx),
    bottomHeightPx: clamp(preferredSize(preferences, 'bottom'), MIN_BOTTOM_HEIGHT_PX, bottomMaximum(bounds)),
    viewportWidthPx: finiteNonNegative(viewportWidthPx),
  }
}

export function resolveActiveDockResizeV4(
  dock: ShellDockV4,
  requestedSizePx: number,
  inputBounds: ShellLayoutBoundsV4,
  preferences: ShellWorkspacePreferencesV1,
): number {
  const bounds = normalizedBounds(inputBounds)
  const current = preferredSize(preferences, dock)
  const requested = Number.isFinite(requestedSizePx) ? requestedSizePx : current
  if (dock === 'bottom') return clamp(requested, MIN_BOTTOM_HEIGHT_PX, bottomMaximum(bounds))
  if (bounds.mode === 'narrow' || (bounds.mode === 'compact' && dock === 'inspector')) return current
  if (!isDockedVisible(bounds.mode, dock, preferences)) return current
  const oppositeDock: ShellDockV4 = dock === 'sidebar' ? 'inspector' : 'sidebar'
  const oppositeVisible = isDockedVisible(bounds.mode, oppositeDock, preferences)
  const oppositeWidth = oppositeVisible ? resolveShellLayoutV4(bounds, preferences)[
    oppositeDock === 'sidebar' ? 'sidebarWidthPx' : 'inspectorWidthPx'
  ] : 0
  const dividers = bounds.dividerPx + (oppositeVisible ? bounds.dividerPx : 0)
  const maxForCenter = Math.max(0, bounds.widthPx - MIN_VIEWPORT_WIDTH_PX - dividers - oppositeWidth)
  const min = dock === 'sidebar' ? MIN_SIDEBAR_WIDTH_PX : MIN_INSPECTOR_WIDTH_PX
  const max = dock === 'sidebar' ? MAX_SIDEBAR_WIDTH_PX : MAX_INSPECTOR_WIDTH_PX
  const effectiveMax = Math.min(max, Math.max(min, maxForCenter))
  return clamp(requested, min, effectiveMax)
}

export function isSceneJobResizeAvailableV4(
  mode: ShellLayoutModeV4,
  sidebarContentHeightPx: number,
): boolean {
  if (mode === 'wide' || mode === 'compact') return true
  return Number.isFinite(sidebarContentHeightPx)
    && sidebarContentHeightPx >= MIN_NARROW_SCENE_JOB_RESIZE_HEIGHT_PX_V4
}
