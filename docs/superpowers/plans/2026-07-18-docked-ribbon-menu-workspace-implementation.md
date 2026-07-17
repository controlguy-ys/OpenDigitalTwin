# Docked Ribbon Lite Menu Workspace Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver the approved RobotStudio-informed Menu Bar, Ribbon Lite, shared command execution, independent Active Robot and Job context, and persistent resizable Docked Studio workspace without exposing unsupported RobotSim capabilities.

**Architecture:** The interaction store owns Active Robot and Job identity independently from Scene selection. A versioned Shell layout store and pure geometry resolver own browser-local dock state, while a shared command registry/runtime provides one execution and pending/error path to Menu Bar, Ribbon, Context Menu, existing buttons, and keyboard surfaces. App.tsx remains the composition root; feature services retain domain validation.

**Tech Stack:** React 19.2.7, TypeScript 6.0.3, Zustand 5.0.14, Lucide React 1.24.0, React Three Fiber 9.6.1, Vitest 4.1.10, Testing Library, Playwright 1.61.1, Vite 8.1.4, CSS Grid and container queries.

## Global Constraints

- Complete docs/superpowers/plans/2026-07-18-viewport-context-viewcube-implementation.md before this plan.
- Use Node >=22.15.1 <23 and npm >=11.4.2 <12.
- Global menu order is Project, Home, Model, Job, Simulation, Connectivity, View, Help.
- First-stage Quick Access exposes Save, Start Active Job, and Cancel Active Robot Job only.
- Do not display Undo, Redo, Save As, Recent Projects, STEP Import, Robot Geometry authoring, Coordinate Frames, OPC UA Client or Bridge, RAPID, Add-Ins, Pause, Resume, Simulation Reset, Run From Here, or Pose-step Context Bar commands until their V4 service contracts exist. Scene Copy/Paste/Reset Pose remains supported through the existing transform clipboard and Scene command service. View > Reset Layout remains required.
- Keep Active Robot independent from Scene selection; Object selection never clears or retargets it.
- Start, Cancel, Robot Home, Gripper, and Save Pose target only the explicit Active Robot and selected Job.
- Preserve a minimum 480 CSS-pixel central Viewport on wide and compact layouts.
- Wide defaults: Sidebar and Inspector open, Bottom closed, Ribbon expanded.
- Compact defaults: Sidebar open, Inspector overlay closed, Bottom closed, Ribbon collapsed.
- Narrow defaults: both side drawers and Bottom Sheet closed, Ribbon collapsed.
- Persist Ribbon and docked-region visibility per responsive mode. Compact Inspector and narrow Sidebar, Inspector, and Bottom Sheet openness are transient and close on reload or mode transition.
- Derive mode and available workspace height from a ResizeObserver on studio-workspace using CSS-pixel boundaries 1200 and 960; expose that same mode through a Shell-root data attribute for layout CSS.
- Dock limits are Sidebar 220-420 px, Inspector 280-480 px, Bottom 120 px to 45 percent of workspace height, and Scene/Job split 35-75 percent.
- Show the Scene-to-Job split handle in a narrow drawer only when its content height is at least 360 CSS pixels; below that threshold retain the stored split, hide the handle, and scroll both panes internally.
- Reset Layout restores all per-mode dock/Ribbon defaults, approved shared sizes, and closed transient overlays; it preserves Theme and the selected Timeline or Collision tab.
- Layout is browser-local under robotsim.workspace-preferences.v1 and never changes Project dirty state or export content.
- Keep the Bottom Workspace under the central Viewport only.
- Publish Viewport safe-area insets whenever a compact or narrow overlay is open so the View Cube, camera controls, orientation fallback, and anchored Context Menu remain usable.
- Reuse existing design tokens, six-pixel radius, Lucide icons, Light/Dark themes, and installed dependencies.
- Do not add a common destructive confirmation flow in this package.
- Use the user's in-app browser for final visual acceptance. Ask before running Playwright CLI or MCP; the Playwright commands below remain gated until that execution-time approval.
- Before Task 1 changes UI, capture local paired-evidence baselines under artifacts/ui/docked-ribbon-workspace/ as before-light.png and before-dark.png plus state.json; write after-light.png and after-dark.png in Task 11. Do not stage generated evidence unless the user asks.

---

### Task 1: Add independent Active Robot and Active Job context

**Files:**
- Modify: src/features/interaction/v4/interaction-store.ts
- Modify: src/features/interaction/v4/interaction-store.test.ts
- Modify: src/app/App.tsx
- Modify: src/app/App.test.tsx
- Modify: src/features/jobs/v4/RobotJobList.tsx
- Modify: src/features/jobs/v4/RobotJobList.test.tsx

**Interfaces:**
- Produces: InteractionStoreStateV4.activeRobotId, activateRobot(robotId), and activeJobIdV4(state).

- [ ] **Step 0: Prove the Viewport prerequisite is landed**

~~~powershell
npm run test:run -- src/features/scene/v4/right-button-gesture.test.ts src/features/scene/v4/SceneCanvas.test.tsx src/features/scene/v4/SceneContextMenu.test.tsx src/features/viewport/camera-actions.test.ts src/features/viewport/v4/WorldViewCube.test.tsx src/features/viewport/v4/viewport-runtime.test.tsx src/features/viewport/v4/ViewportOverlay.test.tsx
npm run test:e2e:viewport
~~~

Expected: targeted tests and the approved Viewport browser flow PASS before this plan edits shared Scene, Viewport, global CSS, Playwright, or package-script files. The Playwright command remains subject to the execution-time browser approval in Global Constraints.

- [ ] **Step 1: Write failing interaction tests**

~~~ts
expect(store.getState().activeRobotId).toBe('robot-a')
store.getState().select({ kind: 'spatial-entity', entityId: 'entity-a' })
expect(store.getState().activeRobotId).toBe('robot-a')

store.getState().select({ kind: 'robot-link', robotId: 'robot-b', linkId: 'L0' })
expect(store.getState().activeRobotId).toBe('robot-b')

store.getState().selectJob('robot-a', 'job-a')
expect(store.getState().activeRobotId).toBe('robot-a')
expect(activeJobIdV4(store.getState())).toBe('job-a')
~~~

Also test Project replacement preserving a valid Active Robot, choosing the next eligible Robot in stable Project order when the active one is removed, falling back to the first Robot when no successor exists, and clearing to `No active Robot` for a zero-Robot Project. Remove or rebind the selected Job and assert activeJobIdV4 clears whenever that Job no longer exists or no longer belongs to the Active Robot. Test checkpoint restore includes Active Robot.

- [ ] **Step 2: Run the focused tests**

~~~powershell
npm run test:run -- src/features/interaction/v4/interaction-store.test.ts src/app/App.test.tsx src/features/jobs/v4/RobotJobList.test.tsx
~~~

Expected: FAIL because activeRobotId and activateRobot are absent.

- [ ] **Step 3: Add the interaction contract**

~~~ts
export interface InteractionStoreStateV4 {
  readonly activeRobotId: RobotIdV4 | null
  activateRobot(robotId: RobotIdV4): void
}

export function activeJobIdV4(
  state: Pick<
    InteractionStoreStateV4,
    'activeRobotId' | 'selectedJobIdsByRobotId'
  >,
): RobotJobIdV4 | null {
  return state.activeRobotId === null
    ? null
    : state.selectedJobIdsByRobotId.get(state.activeRobotId) ?? null
}
~~~

Initialize Active Robot to the first valid Robot. Robot, Robot Link, and Robot Frame selection activates the owner. Spatial Entity, group, Scene Frame, Entity Frame, and null selection preserve Active Robot. selectJob activates its Robot. activateRobot rejects unknown identities with ROBOT_ACTIVE_SELECTION_INVALID.

- [ ] **Step 4: Use Active Robot throughout App and Job List**

Replace App.tsx derivation from robotIdFromSceneSelectionV4 with:

~~~ts
const activeRobotId = interaction.activeRobotId
const activeJobId = activeJobIdV4(interaction)
const activeRobot = activeRobotId === null
  ? null
  : project.robots.find((robot) => robot.id === activeRobotId) ?? null
~~~

Pass Active identities to Job List, Timeline, Inspector, Joint source status, and Quick Action composition. In RobotJobListV4, replace isCurrentRobotSelection with an Active Robot check. Selecting or opening a Job context item calls selectJob before its command.

- [ ] **Step 5: Run and commit**

~~~powershell
npm run test:run -- src/features/interaction/v4/interaction-store.test.ts src/app/App.test.tsx src/features/jobs/v4/RobotJobList.test.tsx
git add src/features/interaction/v4/interaction-store.ts src/features/interaction/v4/interaction-store.test.ts src/app/App.tsx src/app/App.test.tsx src/features/jobs/v4/RobotJobList.tsx src/features/jobs/v4/RobotJobList.test.tsx
git commit -m "feat(ui): keep active robot independent from scene selection"
~~~

Expected: all focused tests PASS and Object selection leaves Job controls attached to the Active Robot.

### Task 2: Reconcile visual specification and create the versioned layout store

**Files:**
- Modify: docs/design/robot-sim-visual-spec.md
- Modify: docs/superpowers/specs/2026-07-17-docked-ribbon-lite-menu-layout-design.md
- Create: src/features/ui/v4/bottom-workspace-tab.ts
- Create: src/features/ui/v4/shell-layout-store.ts
- Create: src/features/ui/v4/shell-layout-store.test.ts
- Modify: src/features/project/project-store-browser.ts
- Modify: src/features/project/project-store-browser.test.ts
- Modify: src/features/ui/theme-preference.ts
- Modify: src/features/ui/theme-preference.test.ts

**Interfaces:**
- Produces: ShellLayoutStoreV4 injected as BrowserProjectResourcesV4.shellLayoutStore.

- [ ] **Step 1: Replace the obsolete visible-copy and fixed-layout clauses**

Change the visual spec from an exhaustive global copy allow-list to surface rules:

- Header copy permits the approved eight menu labels, Project name and save state, Simulation state, Joint source, Gateway state, and Quick Actions.
- Context Bar copy comes only from visible AppCommandV4 labels.
- Bottom default is 160 px.
- Bottom spans the central Viewport only.
- Wide, compact, and narrow defaults match Global Constraints.
- Persisted state is per-mode for Ribbon and docked regions; compact Inspector and narrow drawers/sheet are transient overlays.
- Shell mode and available height come from the studio-workspace ResizeObserver; the same data-layout-mode attribute drives Shell CSS.

Record that the viewport-context/View Cube plan is the prerequisite and that Reset preserves Theme and Bottom tab.

- [ ] **Step 2: Write failing store tests**

~~~ts
expect(store.getState().preferences).toEqual({
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
})
store.getState().setDockSize('sidebar', 999)
expect(store.getState().preferences.sidebar.widthPx).toBe(420)
store.getState().setSceneJobSplit(10)
expect(store.getState().preferences.sidebar.sceneJobSplitPercent).toBe(35)
store.getState().setSceneJobSplit(99)
expect(store.getState().preferences.sidebar.sceneJobSplitPercent).toBe(75)
store.getState().setTheme('dark')
store.getState().setBottomTab('collision')
store.getState().resetLayout()
expect(store.getState().preferences.theme).toBe('dark')
expect(store.getState().preferences.bottom.activeTab).toBe('collision')
expect(store.getState().preferences.modes.wide.dockVisible.inspector).toBe(true)
expect(store.getState().preferences.modes.compact.ribbonExpanded).toBe(false)
~~~

Also test old individual-key migration, corrupt JSON, version mismatch, a missing nested field, finite out-of-range values, NaN, Infinity, storage read/write exceptions, and that Reset does not touch robotsim.viewport-preferences.v4 or any Project storage key. Persist a 67-percent Scene-to-Job split, recreate the store, and assert 67 is restored. Then call setSceneJobSplit(60) as the divider-only reset and assert widths, Bottom height, Ribbon/dock visibility, Theme, and active Bottom tab remain byte-for-byte unchanged. Assert setDockedVisible rejects compact Inspector and every narrow dock because those are transient overlays owned by the Shell controller.

- [ ] **Step 3: Run the store test**

~~~powershell
npm run test:run -- src/features/ui/v4/shell-layout-store.test.ts
~~~

Expected: FAIL because the store is absent.

- [ ] **Step 4: Implement the layout store contract**

bottom-workspace-tab.ts contains the one canonical type:

~~~ts
export type BottomWorkspaceTabV4 = 'timeline' | 'collision'
~~~

shell-layout-store.ts imports StoreApi from zustand/vanilla and that canonical tab type:

~~~ts
import type { StoreApi } from 'zustand/vanilla'
import type { BottomWorkspaceTabV4 } from './bottom-workspace-tab.js'

export type { BottomWorkspaceTabV4 } from './bottom-workspace-tab.js'

export type ShellLayoutModeV4 = 'wide' | 'compact' | 'narrow'
export type ShellDockV4 = 'sidebar' | 'inspector' | 'bottom'

export interface ShellWorkspacePreferencesV1 {
  readonly version: 1
  readonly modes: Readonly<Record<ShellLayoutModeV4, {
    readonly ribbonExpanded: boolean
    readonly dockVisible: Readonly<Record<ShellDockV4, boolean>>
  }>>
  readonly sidebar: {
    readonly widthPx: number
    readonly sceneJobSplitPercent: number
  }
  readonly inspector: { readonly widthPx: number }
  readonly bottom: {
    readonly heightPx: number
    readonly activeTab: BottomWorkspaceTabV4
  }
  readonly theme: ThemePreference
}

export interface ShellLayoutStateV4 {
  readonly preferences: ShellWorkspacePreferencesV1
  setRibbonExpanded(mode: ShellLayoutModeV4, expanded: boolean): void
  setDockedVisible(
    mode: ShellLayoutModeV4,
    dock: ShellDockV4,
    visible: boolean,
  ): void
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

export function createShellLayoutStoreV4(
  options: CreateShellLayoutStoreOptionsV4,
): ShellLayoutStoreV4
~~~

Persist one fully validated object under robotsim.workspace-preferences.v1. A missing field, wrong primitive type, non-finite number, or finite number outside its approved range falls back only that field to its default before the normalized object is written; malformed JSON or an unsupported version resets the whole object. setDockedVisible accepts all three docks in wide mode, Sidebar and Bottom in compact mode, and no docks in narrow mode; rejected overlay combinations leave storage unchanged. Migrate the six current Shell, Bottom-tab, and Theme keys once into wide-mode dock preferences, shared sizes, selected tab, and Theme. Keep robotsim.viewport-preferences.v4 separate. Inject the store through BrowserProjectResourcesV4.

- [ ] **Step 5: Run and commit**

~~~powershell
npm run test:run -- src/features/ui/v4/shell-layout-store.test.ts src/features/ui/theme-preference.test.ts src/features/project/project-store-browser.test.ts
git add docs/design/robot-sim-visual-spec.md docs/superpowers/specs/2026-07-17-docked-ribbon-lite-menu-layout-design.md src/features/ui/v4/bottom-workspace-tab.ts src/features/ui/v4/shell-layout-store.ts src/features/ui/v4/shell-layout-store.test.ts src/features/project/project-store-browser.ts src/features/project/project-store-browser.test.ts src/features/ui/theme-preference.ts src/features/ui/theme-preference.test.ts
git commit -m "feat(ui): add versioned workspace preferences"
~~~

Expected: focused tests PASS and only the combined workspace preference key is written after migration.

### Task 3: Resolve responsive Shell state, dock geometry, and resize handles

**Files:**
- Create: src/features/ui/v4/shell-layout-geometry.ts
- Create: src/features/ui/v4/shell-layout-geometry.test.ts
- Create: src/features/ui/v4/shell-layout-controller.ts
- Create: src/features/ui/v4/shell-layout-controller.test.ts
- Create: src/features/ui/v4/use-shell-layout-observer.ts
- Create: src/features/ui/v4/use-shell-layout-observer.test.tsx
- Create: src/features/ui/v4/DockResizeHandleV4.tsx
- Create: src/features/ui/v4/DockResizeHandleV4.test.tsx

**Interfaces:**
- Consumes: ShellWorkspacePreferencesV1 and ShellLayoutModeV4 from Task 2, plus ViewportSafeAreaInsetsV4 from the prerequisite src/features/viewport/v4/viewport-safe-area.ts.
- Produces: resolveShellLayoutV4(bounds, preferences), ShellLayoutControllerV4, useShellLayoutObserverV4, ViewportSafeAreaInsetsV4, and DockResizeHandleV4.

- [ ] **Step 1: Write failing pure geometry tests**

~~~ts
expect(resolveShellLayoutV4(
  { mode: 'wide', widthPx: 1440, workspaceHeightPx: 800, dividerPx: 6 },
  defaults,
)).toMatchObject({
  sidebarWidthPx: 248,
  inspectorWidthPx: 320,
  bottomHeightPx: 160,
  viewportWidthPx: 860,
})

expect(resolveShellLayoutV4(
  { mode: 'compact', widthPx: 960, workspaceHeightPx: 700, dividerPx: 6 },
  oversized,
)).toMatchObject({
  inspectorWidthPx: 0,
  viewportWidthPx: 534,
})

expect(resolveShellLayoutV4(
  { mode: 'narrow', widthPx: 768, workspaceHeightPx: 600, dividerPx: 6 },
  oversized,
)).toMatchObject({
  sidebarWidthPx: 0,
  inspectorWidthPx: 0,
  viewportWidthPx: 768,
})
~~~

Test exact 1200, 1199, 960, and 959 boundaries, finite/invalid initial browser-bound fallback, right-first then left clamping for passive window shrink, Bottom 45-percent cap, the 120-pixel minimum winning in an unusually short workspace, and temporary shrink not mutating stored preferred sizes. Separately test resolveActiveDockResizeV4: dragging Sidebar clamps only Sidebar and preserves Inspector preference; dragging Inspector clamps only Inspector and preserves Sidebar preference; compact ignores Inspector width; Bottom clamps independently.

- [ ] **Step 2: Write failing responsive controller and observer tests**

In one controller instance, feed widths 1200, 1199, 960, 959, then 1440. Assert mode transitions wide, compact, compact, narrow, wide; preferred Sidebar and Inspector widths remain unchanged; every transient overlay closes on each mode transition; and the final effective widths restore the stored preferences. Assert compact Inspector and all narrow overlay visibility changes write only transient state, while wide/compact dock changes update the versioned preference store. In narrow mode, opening Sidebar closes Inspector and opening Inspector closes Sidebar; Bottom may remain independently open.

Mock ResizeObserver on studio-workspace and assert contentRect CSS-pixel width/height call setBounds, the Shell root receives the matching data-layout-mode, and disconnect runs on unmount. Assert safeAreaInsets are zero with overlays closed, then equal Sidebar width plus 12 on the left, Inspector width plus 12 on the right, and Bottom height plus 12 on the bottom when the corresponding current-mode overlay opens.

- [ ] **Step 3: Write failing separator tests**

Assert role=separator, orientation, aria min/max/current, correct arrow direction, pointer capture drag, pointercancel cleanup, and double-click resetting only the addressed divider. Prove the generic handle converts a signed pointer-pixel delta through valueFromPointerDelta while keyboardStep remains in value units. For the Scene-to-Job separator, a 36-pixel vertical drag over a 360-pixel content area changes the split by exactly 10 percentage points; also assert 35/75 clamping, 60 reset, visibility at exactly 360 CSS pixels of drawer content height, hidden state at 359, and no write to the stored split when it is hidden.

- [ ] **Step 4: Run the new tests**

~~~powershell
npm run test:run -- src/features/ui/v4/shell-layout-geometry.test.ts src/features/ui/v4/shell-layout-controller.test.ts src/features/ui/v4/use-shell-layout-observer.test.tsx src/features/ui/v4/DockResizeHandleV4.test.tsx
~~~

Expected: FAIL because both modules are absent.

- [ ] **Step 5: Implement the resolver and responsive controller contracts**

~~~ts
export interface ShellLayoutBoundsV4 {
  readonly mode: ShellLayoutModeV4
  readonly widthPx: number
  readonly workspaceHeightPx: number
  readonly dividerPx: number
}

export function initialShellLayoutBoundsV4(
  widthPx: number,
  heightPx: number,
  dividerPx = 6,
): ShellLayoutBoundsV4

export interface ResolvedShellLayoutV4 {
  readonly sidebarWidthPx: number
  readonly inspectorWidthPx: number
  readonly bottomHeightPx: number
  readonly viewportWidthPx: number
}

export function resolveActiveDockResizeV4(
  dock: ShellDockV4,
  requestedSizePx: number,
  bounds: ShellLayoutBoundsV4,
  preferences: ShellWorkspacePreferencesV1,
): number

export const MIN_NARROW_SCENE_JOB_RESIZE_HEIGHT_PX_V4 = 360

export function isSceneJobResizeAvailableV4(
  mode: ShellLayoutModeV4,
  sidebarContentHeightPx: number,
): boolean

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

export function createShellLayoutControllerV4(
  options: CreateShellLayoutControllerOptionsV4,
): ShellLayoutControllerV4
~~~

modeForShellWidthV4 returns wide at 1200 or above, compact at 960 through 1199, and narrow below 960. initialShellLayoutBoundsV4 uses finite positive documentElement client width/height, falls back to 1200 by 800, and derives the matching mode to avoid an incorrect first paint before ResizeObserver. For passive window shrink, wide mode subtracts visible side docks and dividers, clamps effective Inspector first and effective Sidebar second until Viewport is at least 480 px without mutating preferred sizes. resolveActiveDockResizeV4 instead clamps only the divider being dragged against the other dock's current effective size and the 480-pixel center, leaving the opposite stored preference untouched. Compact excludes Inspector because it is an overlay. Narrow excludes both. Bottom effective maximum is max(120, workspaceHeightPx * 0.45). isSceneJobResizeAvailableV4 returns true outside narrow mode and returns true in narrow mode only for a finite content height of at least MIN_NARROW_SCENE_JOB_RESIZE_HEIGHT_PX_V4.

The controller routes visibility to persisted dock preferences only for wide docks and compact Sidebar/Bottom. It routes compact Inspector and all narrow docks to transient overlays; in narrow mode it enforces one open side drawer at a time. A mode change closes overlays before publishing the new snapshot. resetLayout resets all per-mode Ribbon/dock defaults and shared sizes, closes overlays, and preserves Theme and Bottom tab. useShellLayoutObserverV4 owns one ResizeObserver on studio-workspace, sends contentRect width and available workspace height to the controller, and exposes the controller mode for AppShell to write to data-layout-mode.

- [ ] **Step 6: Implement DockResizeHandleV4**

~~~ts
export interface DockResizeHandlePropsV4 {
  readonly label: string
  readonly orientation: 'horizontal' | 'vertical'
  readonly value: number
  readonly min: number
  readonly max: number
  readonly keyboardStep: number
  readonly valueFromPointerDelta: (
    startValue: number,
    signedDeltaPx: number,
  ) => number
  readonly onChange: (value: number) => void
  readonly onReset: () => void
  readonly direction: 1 | -1
}
~~~

Use pointer capture, clientX for vertical handles and clientY for horizontal handles. The pointer path passes startValue and axis delta times direction through valueFromPointerDelta; pixel docks pass `(start, deltaPx) => start + deltaPx`, while the Scene-to-Job separator passes `(start, deltaPx) => start + deltaPx / sidebarContentHeightPx * 100`. ArrowLeft or ArrowUp applies negative keyboardStep times direction directly in the current value unit; ArrowRight or ArrowDown applies the positive equivalent. Every pointer/keyboard proposal passes through its parent controller clamp before persistence. Escape or pointercancel ends drag without another change. Double-click invokes onReset.

- [ ] **Step 7: Run and commit**

~~~powershell
npm run test:run -- src/features/ui/v4/shell-layout-geometry.test.ts src/features/ui/v4/shell-layout-controller.test.ts src/features/ui/v4/use-shell-layout-observer.test.tsx src/features/ui/v4/DockResizeHandleV4.test.tsx
git add src/features/ui/v4/shell-layout-geometry.ts src/features/ui/v4/shell-layout-geometry.test.ts src/features/ui/v4/shell-layout-controller.ts src/features/ui/v4/shell-layout-controller.test.ts src/features/ui/v4/use-shell-layout-observer.ts src/features/ui/v4/use-shell-layout-observer.test.tsx src/features/ui/v4/DockResizeHandleV4.tsx src/features/ui/v4/DockResizeHandleV4.test.tsx
git commit -m "feat(ui): add bounded dock resizing"
~~~

Expected: geometry and separator tests PASS.

### Task 4: Restructure AppShell into docked central workspace

**Files:**
- Modify: src/app/App.tsx
- Modify: src/app/App.test.tsx
- Modify: src/app/AppShell.tsx
- Modify: src/app/AppShell.test.tsx
- Modify: src/features/ui/BottomWorkspace.tsx
- Modify: src/features/ui/BottomWorkspace.test.tsx
- Modify: src/styles/tokens.css
- Modify: src/styles/global.css

**Interfaces:**
- Consumes: ShellLayoutControllerV4, useShellLayoutObserverV4, and DockResizeHandleV4.
- Produces: AppShellV4 with the current header retained, left dock, central Viewport/Bottom, right dock, and controlled overlay drawers.

- [ ] **Step 1: Write failing Shell and Bottom Workspace tests**

Assert:

- Bottom Workspace is a child of .studio-center-column and shares its left and width.
- Wide defaults show Sidebar and Inspector, not Bottom.
- Compact defaults show docked Sidebar and overlay Inspector closed.
- Narrow defaults close both drawers and Bottom Sheet.
- Controlled Bottom tab writes through shellLayoutController.setBottomTab.
- Existing openCollision calls setBottomTab('collision') and setDockVisible('bottom', true) immediately; no request counter remains.
- Resize handles update store sizes and local CSS variables.
- Reset restores mode defaults while preserving Theme and active tab.
- Invalid stored sizes never produce a Viewport below 480 px.
- Crossing 1200/1199 and 960/959 in one mounted Shell closes transient overlays, preserves preferred widths, and updates data-layout-mode.
- Compact renders no Inspector handle; narrow renders no side or Bottom dock handles.
- Scene-to-Job drag clamps to 35-75, persists across remount, and double-click resets only that split to 60. In narrow mode the separator is present at 360 CSS pixels of drawer content height, absent below 360, and both panes retain their stored ratio with internal scrolling while the handle is absent.
- Opening a compact/narrow overlay updates the controller safe-area snapshot already covered in Task 3; Viewport wiring is deferred to Task 10.

- [ ] **Step 2: Run current component tests**

~~~powershell
npm run test:run -- src/app/App.test.tsx src/app/AppShell.test.tsx src/features/ui/BottomWorkspace.test.tsx
~~~

Expected: FAIL because AppShell owns unversioned local state and BottomWorkspace owns its own tab storage.

- [ ] **Step 3: Make BottomWorkspace controlled**

~~~ts
export interface BottomWorkspaceProps {
  readonly activeTab: BottomWorkspaceTabV4
  readonly onActiveTabChange: (tab: BottomWorkspaceTabV4) => void
  readonly timeline?: ReactNode
  readonly collision?: ReactNode
  readonly collisionCount?: number
}
~~~

Delete its localStorage access and collisionOpenRequest effect. Import BottomWorkspaceTabV4 from v4/bottom-workspace-tab.ts and re-export `type BottomWorkspaceTab = BottomWorkspaceTabV4` temporarily for source compatibility; do not maintain a second union. Keep its roving tab focus and call onActiveTabChange from click and arrow navigation.

In App.tsx, create one ShellLayoutControllerV4 from resources.shellLayoutStore and an initial CSS-pixel browser bound, subscribe with useSyncExternalStore, pass it to AppShellV4, and dispose it on App unmount. Bind BottomWorkspace activeTab to shellSnapshot.preferences.bottom.activeTab and onActiveTabChange to controller.setBottomTab. Change openCollision to select the result, call setBottomTab('collision'), and call setDockVisible('bottom', true); remove collisionOpenRequest, bottomRailOpenRequest, and inspectorOpenRequest state/props/effects now so behavior never breaks between tasks. AppShellV4 never creates a second controller. Its studio-workspace ResizeObserver replaces the initial bound immediately after mount.

Add readonly shellLayoutController: ShellLayoutControllerV4 to the existing AppShellPropsV4 and keep its currently declared viewport, Sidebar, Job, Inspector, Timeline, Collision, status, and top-bar props unchanged during this task. Task 10 replaces those legacy header props only after StudioHeaderV4 exists.

- [ ] **Step 4: Restructure AppShell markup**

Retain the current top-bar JSX and props during this task; StudioHeaderV4 and RibbonLiteV4 do not exist until Task 9. Restructure only the workspace region now, so Task 4 can build independently.

AppShell reads controller snapshots with useSyncExternalStore(controller.subscribe, controller.getState, controller.getState); it does not mirror dock state in component useState.
The still-visible current Theme select reads snapshot.preferences.theme and calls controller.setTheme; remove its local Theme state and direct localStorage write in this task.

Use this region skeleton:

~~~tsx
<div className={shellClassName} style={shellVariables}>
  {/* Current top-bar markup remains unchanged in Task 4. */}
  <div className="studio-workspace">
    <aside className="asset-rail" id="scene-assets-panel" />
    <DockResizeHandleV4 label="Resize Scene Assets" orientation="vertical" />
    <div className="studio-center-column">
      <main className="viewport">{viewport}</main>
      <DockResizeHandleV4 label="Resize Bottom Workspace" orientation="horizontal" />
      <section className="bottom-rail" id="timeline-collision-panel" />
    </div>
    <DockResizeHandleV4 label="Resize Inspector" orientation="vertical" direction={-1} />
    <aside className="inspector" id="inspector-panel" />
  </div>
</div>
~~~

Keep the existing Scene/Job internal separator using the shared handle, set its aria-valuenow from preferences.sidebar.sceneJobSplitPercent, and call controller.setSceneJobSplit for pointer, keyboard, and 60-percent double-click reset. Render it in wide/compact mode and in narrow mode only when a ResizeObserver on the Sidebar drawer content reports at least 360 CSS pixels. Hiding it never changes the stored split; both panes use internal overflow. Render the Inspector handle only in wide mode. Render Sidebar and Bottom handles in wide/compact only when those regions are docked and visible; render no dock handle in narrow mode. Persisted dock visibility and transient compact/narrow overlay open state come from the controller rather than component-local booleans.

- [ ] **Step 5: Replace fixed grid values and add container queries**

Set --sidebar-width, --inspector-width, --bottom-height, and --ribbon-height from the controller snapshot. Use a nested central column so Bottom never spans side docks. At 960-1199, Inspector is an overlay and Sidebar remains docked. Below 960, both side panels and Bottom are overlays. Drive the main structural selectors from data-layout-mode, not a second media-query breakpoint. Add container-type: inline-size to Viewport and Bottom Workspace; collapse collision columns when their container is below 640 px. In a short workspace where the 120-pixel Bottom minimum wins, keep scrolling inside the Bottom panel and never on the document root. Keep controller.safeAreaInsets available for the render-prop conversion in Task 10.

- [ ] **Step 6: Run and commit**

~~~powershell
npm run test:run -- src/app/App.test.tsx src/app/AppShell.test.tsx src/features/ui/BottomWorkspace.test.tsx src/features/ui/v4/shell-layout-store.test.ts src/features/ui/v4/shell-layout-geometry.test.ts src/features/ui/v4/shell-layout-controller.test.ts src/features/ui/v4/use-shell-layout-observer.test.tsx src/features/ui/v4/DockResizeHandleV4.test.tsx
git add src/app/App.tsx src/app/App.test.tsx src/app/AppShell.tsx src/app/AppShell.test.tsx src/features/ui/BottomWorkspace.tsx src/features/ui/BottomWorkspace.test.tsx src/styles/tokens.css src/styles/global.css
git commit -m "feat(ui): restructure resizable docked workspace"
~~~

Expected: component tests PASS and Bottom occupies only the central column.

### Task 5: Create shared command registry and execution runtime

**Files:**
- Create: src/features/commands/v4/app-command.ts
- Create: src/features/commands/v4/app-command-registry.ts
- Create: src/features/commands/v4/app-command-registry.test.ts
- Create: src/features/commands/v4/app-command-runtime.ts
- Create: src/features/commands/v4/app-command-runtime.test.ts
- Create: src/features/commands/v4/use-app-command.ts
- Create: src/features/commands/v4/use-app-command.test.tsx

**Interfaces:**
- Produces: AppCommandV4, AppCommandRegistryV4, AppCommandRuntimeV4, and command invocation outcomes.

- [ ] **Step 1: Write failing registry/runtime tests**

~~~ts
expect(() => createAppCommandRegistryV4([first, duplicate]))
  .toThrow('Duplicate App command id: project.save')

const firstInvocation = runtime.invoke('project.save')
const secondInvocation = runtime.invoke('project.save')
expect(await secondInvocation).toBe('ignored')
expect(await firstInvocation).toBe('completed')
expect(runtime.getState().pendingCommandIds.has('project.save')).toBe(false)
~~~

Also test ordered section listing, visible filtering, disabled/unknown invocation returning ignored, cancellation without error, thrown error returning failed, successful retry clearing only its command error, toggle/radio checked state, and registry replacement without presenter remount. Test runtime.getRegistry() returns the replacement immediately, replacement publishes once, and useAppCommandV4 plus a long-lived AppCommandBindingsV4 update one mounted presenter when its command becomes pending, fails, retries, or is replaced.

- [ ] **Step 2: Run the new tests**

~~~powershell
npm run test:run -- src/features/commands/v4/app-command-registry.test.ts src/features/commands/v4/app-command-runtime.test.ts src/features/commands/v4/use-app-command.test.tsx
~~~

Expected: FAIL because command modules are absent.

- [ ] **Step 3: Define the command contract**

~~~ts
export type AppCommandSectionV4 =
  | 'project' | 'home' | 'model' | 'job'
  | 'simulation' | 'connectivity' | 'view' | 'help'

export type AppCommandKindV4 = 'action' | 'toggle' | 'radio'
export type AppCommandExecutionV4 = void | 'cancelled'
export type AppCommandOutcomeV4 =
  | 'completed' | 'cancelled' | 'ignored' | 'failed'

export interface AppCommandV4 {
  readonly id: string
  readonly label: string
  readonly section: AppCommandSectionV4
  readonly kind: AppCommandKindV4
  readonly visible: boolean
  readonly enabled: boolean
  readonly checked?: boolean
  readonly groupId?: string
  readonly disabledReason?: string
  readonly destructive?: boolean
  readonly shortcut?: string
  execute(): AppCommandExecutionV4 | Promise<AppCommandExecutionV4>
}

export interface AppCommandRegistryV4 {
  get(commandId: string): AppCommandV4 | null
  list(section: AppCommandSectionV4): readonly AppCommandV4[]
}

export interface AppCommandRuntimeStateV4 {
  readonly pendingCommandIds: ReadonlySet<string>
  readonly errorByCommandId: ReadonlyMap<string, string>
}

export interface AppCommandRuntimeV4 {
  getState(): AppCommandRuntimeStateV4
  getRegistry(): AppCommandRegistryV4
  subscribe(listener: () => void): () => void
  replaceRegistry(registry: AppCommandRegistryV4): void
  invoke(commandId: string): Promise<AppCommandOutcomeV4>
  dispose(): void
}

export interface AppCommandBindingsV4 {
  readonly runtime: AppCommandRuntimeV4
  getRegistry(): AppCommandRegistryV4
}

export interface BoundAppCommandV4 {
  readonly command: AppCommandV4 | null
  readonly pending: boolean
  readonly error: string | null
  invoke(): Promise<AppCommandOutcomeV4>
}

export function useAppCommandV4(
  bindings: AppCommandBindingsV4,
  commandId: string,
): BoundAppCommandV4

export function createAppCommandRegistryV4(
  commands: readonly AppCommandV4[],
): AppCommandRegistryV4

export function createAppCommandRuntimeV4(
  registry: AppCommandRegistryV4,
): AppCommandRuntimeV4

export function createAppCommandBindingsV4(
  runtime: AppCommandRuntimeV4,
): AppCommandBindingsV4
~~~

Registry get returns null for unknown IDs and list returns visible commands in supplied order. Runtime owns the current registry plus pending and error maps; replaceRegistry swaps the registry and publishes even when pending state is unchanged. createAppCommandBindingsV4 returns one stable facade whose getRegistry delegates to runtime.getRegistry, so mounted presenters and shortcuts never retain the first catalog. Unknown, disabled, or duplicate-pending invocation returns ignored without executing or publishing an error. User dismissal returns cancelled. dispose clears subscribers and prevents later async completion from publishing. It never calls DOM elements.

- [ ] **Step 4: Run and commit**

~~~powershell
npm run test:run -- src/features/commands/v4/app-command-registry.test.ts src/features/commands/v4/app-command-runtime.test.ts src/features/commands/v4/use-app-command.test.tsx
git add src/features/commands/v4/app-command.ts src/features/commands/v4/app-command-registry.ts src/features/commands/v4/app-command-registry.test.ts src/features/commands/v4/app-command-runtime.ts src/features/commands/v4/app-command-runtime.test.ts src/features/commands/v4/use-app-command.ts src/features/commands/v4/use-app-command.test.tsx
git commit -m "feat(ui): add shared app command runtime"
~~~

Expected: registry, runtime, and bound-command hook tests PASS.

### Task 6: Extract reusable Project, Robot, Job, Collision, prompt, and Help ports

**Files:**
- Create: src/features/project/v4/project-file-command-port.ts
- Create: src/features/project/v4/project-file-command-port.test.ts
- Create: src/features/joints/v4/robot-operator-command-service.ts
- Create: src/features/joints/v4/robot-operator-command-service.test.ts
- Create: src/features/jobs/v4/job-operator-service.ts
- Create: src/features/jobs/v4/job-operator-service.test.ts
- Create: src/features/collision/v4/collision-validation-controller.ts
- Create: src/features/collision/v4/collision-validation-controller.test.ts
- Create: src/features/ui/v4/user-prompt-port.ts
- Create: src/features/ui/v4/user-prompt-port.test.ts
- Create: src/features/help/v4/local-help-controller.ts
- Create: src/features/help/v4/local-help-controller.test.ts
- Modify: src/features/joints/v4/JointInspector.tsx
- Modify: src/features/joints/v4/JointInspector.test.tsx
- Modify: src/features/jobs/v4/RobotJobList.tsx
- Modify: src/features/jobs/v4/RobotJobList.test.tsx
- Modify: src/features/ui/v4/Timeline.tsx
- Modify: src/features/ui/v4/Timeline.test.tsx
- Modify: src/features/collision/v4/CollisionPanel.tsx
- Modify: src/features/collision/v4/CollisionPanel.test.tsx

**Interfaces:**
- Produces feature ports consumed by both current components and App command composition.

- [ ] **Step 1: Write failing service/controller tests**

Test that Robot Home rechecks current writer and running state at invocation, Gripper targets the requested Robot, and Save Pose snapshots live joints into the selected Job. Test Job Start requires matching Active Robot/Job and Cancel affects one Robot. Test Collision shares one in-flight promise, rejects while any Job runs, clears stale result on revision change, and exposes shared pending/error/result state. A failed query must first publish the same normalized error to controller state and then reject with that Error so AppCommandRuntimeV4 publishes the identical message. Test queryVisibleGeometryCollisionsV4 accepts policy then proxies, filters through visibleCollisionEntitiesV4, and calls queryGeometryCollisionsWithTelemetryV4 with visible proxies then policy. Test Project file cancel returns null without error and download sanitizes the file name. Test prompt cancellation returns null, blank names reject before a service call, local Help opens only the declared controls, stepImport, opcUaMapping, and about topics, and dispose prevents later publication.

- [ ] **Step 2: Run the focused service tests**

~~~powershell
npm run test:run -- src/features/project/v4/project-file-command-port.test.ts src/features/joints/v4/robot-operator-command-service.test.ts src/features/jobs/v4/job-operator-service.test.ts src/features/collision/v4/collision-validation-controller.test.ts src/features/ui/v4/user-prompt-port.test.ts src/features/help/v4/local-help-controller.test.ts
~~~

Expected: FAIL because the ports are absent.

- [ ] **Step 3: Implement exact feature interfaces**

~~~ts
export interface RobotOperatorCommandServiceV4 {
  canHome(robotId: RobotIdV4): boolean
  home(robotId: RobotIdV4): void
  setGripper(robotId: RobotIdV4, state: 'OPEN' | 'CLOSED'): void
  canSavePose(robotId: RobotIdV4, jobId: RobotJobIdV4 | null): boolean
  savePose(robotId: RobotIdV4, jobId: RobotJobIdV4): Promise<void>
}

export interface JobOperatorServiceV4 {
  canStart(robotId: RobotIdV4, jobId: RobotJobIdV4 | null): boolean
  start(robotId: RobotIdV4, jobId: RobotJobIdV4): Promise<void>
  canCancel(robotId: RobotIdV4): boolean
  cancel(robotId: RobotIdV4): Promise<void>
}

export interface ProjectFileCommandPortV4 {
  pickProject(): Promise<File | null>
  downloadProject(blob: Blob, fileName: string): void
}

export interface CollisionValidationInputV4 {
  readonly projectRevisionId: RevisionIdV4
  readonly policy: CollisionPolicyV4
  readonly proxies: readonly CollisionGeometryProxyV4[]
  readonly jobRunning: boolean
  readonly query: CollisionQueryV4
}

export interface CollisionValidationStateV4 {
  readonly projectRevisionId: RevisionIdV4
  readonly pending: boolean
  readonly canValidate: boolean
  readonly error: string | null
  readonly result: CollisionQueryResultV4 | null
}

export interface CollisionValidationControllerV4 {
  getState(): CollisionValidationStateV4
  subscribe(listener: () => void): () => void
  replaceInput(input: CollisionValidationInputV4): void
  validate(): Promise<void>
  dispose(): void
}

export type CollisionQueryV4 = (
  policy: CollisionPolicyV4,
  proxies: readonly CollisionGeometryProxyV4[],
) => CollisionQueryResultV4 | Promise<CollisionQueryResultV4>

export const queryVisibleGeometryCollisionsV4: CollisionQueryV4

export interface CreateCollisionValidationControllerOptionsV4 {
  readonly initialInput: CollisionValidationInputV4
}

export function createCollisionValidationControllerV4(
  options: CreateCollisionValidationControllerOptionsV4,
): CollisionValidationControllerV4

export interface UserPromptPortV4 {
  requestText(request: {
    readonly title: string
    readonly initialValue: string
    readonly required: boolean
  }): Promise<string | null>
}

export type LocalHelpTopicV4 =
  | 'controls' | 'stepImport' | 'opcUaMapping' | 'about'

export interface LocalHelpStateV4 {
  readonly openTopic: LocalHelpTopicV4 | null
}

export interface LocalHelpControllerV4 {
  getState(): LocalHelpStateV4
  subscribe(listener: () => void): () => void
  hasTopic(topic: LocalHelpTopicV4): boolean
  open(topic: LocalHelpTopicV4): void
  close(): void
  dispose(): void
}

export function createLocalHelpControllerV4(options: {
  readonly availableTopics: readonly LocalHelpTopicV4[]
}): LocalHelpControllerV4
~~~

The browser Project file adapter owns its hidden file-input implementation and filename sanitization; commands call the port, never another button. Move CollisionQueryV4 and the current default query out of CollisionPanel.tsx into collision-validation-controller.ts. Export the default as queryVisibleGeometryCollisionsV4; it calls queryGeometryCollisionsWithTelemetryV4(visibleCollisionEntitiesV4(proxies), policy) and is the query supplied by App in Task 10. createCollisionValidationControllerV4 freezes the initial input snapshot, publishes canValidate=false while pending, returns the existing promise for a duplicate validate call, and uses a monotonically increasing request token. replaceInput invalidates an in-flight token and clears a stale result whenever projectRevisionId changes. A validation failure stores error.message, notifies once, and rethrows the same Error; dispose invalidates the token and subscribers so an obsolete revision cannot publish. While CollisionPanel is the temporary direct caller in this task, its click handler calls `void controller.validate().catch(() => undefined)` because the rendered controller state owns the error; AppCommandRuntimeV4 intentionally receives the rejection unchanged after Task 10 binding. The browser UserPrompt adapter is the only module that calls window.prompt. Local Help is an in-memory presentation controller; opcUaMapping is included only when the existing mapping workflow is mounted.

- [ ] **Step 4: Make existing components consume these ports**

JointInspector retains joint slider drafting but delegates Home, Gripper, and Save Pose. RobotJobList and Timeline delegate Start and Cancel while keeping Job/Pose authoring local. CollisionPanel renders controller state and calls validate. Retain the current component pending/error presentation as a temporary adapter in this task; Task 10 removes it only after each equivalent button is bound to the shared command runtime.

- [ ] **Step 5: Run and commit**

~~~powershell
npm run test:run -- src/features/project/v4/project-file-command-port.test.ts src/features/joints/v4/robot-operator-command-service.test.ts src/features/jobs/v4/job-operator-service.test.ts src/features/collision/v4/collision-validation-controller.test.ts src/features/ui/v4/user-prompt-port.test.ts src/features/help/v4/local-help-controller.test.ts src/features/joints/v4/JointInspector.test.tsx src/features/jobs/v4/RobotJobList.test.tsx src/features/ui/v4/Timeline.test.tsx src/features/collision/v4/CollisionPanel.test.tsx
git add src/features/project/v4/project-file-command-port.ts src/features/project/v4/project-file-command-port.test.ts src/features/joints/v4/robot-operator-command-service.ts src/features/joints/v4/robot-operator-command-service.test.ts src/features/jobs/v4/job-operator-service.ts src/features/jobs/v4/job-operator-service.test.ts src/features/collision/v4/collision-validation-controller.ts src/features/collision/v4/collision-validation-controller.test.ts src/features/ui/v4/user-prompt-port.ts src/features/ui/v4/user-prompt-port.test.ts src/features/help/v4/local-help-controller.ts src/features/help/v4/local-help-controller.test.ts src/features/joints/v4/JointInspector.tsx src/features/joints/v4/JointInspector.test.tsx src/features/jobs/v4/RobotJobList.tsx src/features/jobs/v4/RobotJobList.test.tsx src/features/ui/v4/Timeline.tsx src/features/ui/v4/Timeline.test.tsx src/features/collision/v4/CollisionPanel.tsx src/features/collision/v4/CollisionPanel.test.tsx
git commit -m "refactor(ui): share operator command services"
~~~

Expected: all focused tests PASS and migrated buttons retain existing behavior.

### Task 7: Compose the approved command catalog

**Files:**
- Create: src/app/v4/app-command-composition.ts
- Create: src/app/v4/app-command-composition.test.ts
- Create: src/features/scene/v4/scene-context-commands.ts
- Create: src/features/scene/v4/scene-context-commands.test.ts

**Interfaces:**
- Consumes: Project store/mutations, SceneCommandServiceV4, JobCommandServiceV4, operator ports, live Interaction store, ViewportPreferenceStoreV4, prompt/Help ports, camera port, Gateway presentation, and Shell layout controller.
- Produces: composeAppCommandsV4(context), section command IDs, Quick Action IDs, and Context Bar IDs.

- [ ] **Step 1: Write failing catalog tests**

Assert the default catalog includes only operational commands:

~~~ts
expect(registry.list('project').map((command) => command.id)).toEqual([
  'project.new',
  'project.save',
  'project.import',
  'project.export',
  'project.sample.dual',
])
expect(registry.get('connectivity.mode.off')?.kind).toBe('radio')
expect(registry.get('connectivity.mode.server')?.kind).toBe('radio')
expect(registry.get('view.sidebar')?.kind).toBe('toggle')
expect(registry.get('job.pause')).toBeNull()
expect(registry.get('model.importRobotStep')).toBeNull()
~~~

Test Robot, Object, Job, and empty Context Bar IDs; unsupported commands remain absent. Test every section and submenu against the exact matrix in Step 3, maximum menu depth of two, and Help opcUaMapping omission when its topic is unavailable. Test that Scene and Job command enablement and execution read the live Interaction store at invocation so a SceneExplorer row or Job row can synchronously become the active target and invoke the same stable command ID.

- [ ] **Step 2: Run the composition tests**

~~~powershell
npm run test:run -- src/app/v4/app-command-composition.test.ts src/features/scene/v4/scene-context-commands.test.ts
~~~

Expected: FAIL because composition modules are absent.

- [ ] **Step 3: Define the composition context**

~~~ts
export interface AppCameraCommandPortV4 {
  home(): void
  fitAll(): void
  canFocusSelection(): boolean
  focusSelection(): void
  setStandardView(view: StandardWorldView): void
}

export interface AppCommandActionPortsV4 {
  readonly project: {
    newProject(): void
    saveProject(): Promise<void>
    importProject(): Promise<'cancelled' | void>
    exportProject(): Promise<void>
    loadDualRobotSample(): void
  }
  readonly connectivity: {
    setMode(mode: 'off' | 'server'): Promise<void>
  }
  readonly presentation: {
    openRobotBase(robotId: RobotIdV4): void
    openInspector(request: {
      readonly selection: SceneSelectionTargetV4
      readonly section: 'joints' | 'pose' | 'parent' | 'group' | 'numericStatus'
    }): void
    openTimeline(): void
    openCollision(selection: SceneSelectionTargetV4 | null): void
    openGatewayDetails(): void
  }
}

export interface AppCommandCompositionContextV4 {
  readonly project: WorkcellProjectV4
  readonly projectState: ProjectStoreStateV4
  readonly interaction: StoreApi<InteractionStoreStateV4>
  readonly gateway: RuntimeGatewayPresentationV4
  readonly shellLayoutController: ShellLayoutControllerV4
  readonly scene: SceneCommandServiceV4
  readonly jobs: JobCommandServiceV4
  readonly viewportPreferences: ViewportPreferenceStoreV4
  readonly projectFiles: ProjectFileCommandPortV4
  readonly robotOperator: RobotOperatorCommandServiceV4
  readonly jobOperator: JobOperatorServiceV4
  readonly collision: CollisionValidationControllerV4
  readonly camera: AppCameraCommandPortV4
  readonly prompt: UserPromptPortV4
  readonly help: LocalHelpControllerV4
  readonly actions: AppCommandActionPortsV4
}
~~~

Use this exact first-stage hierarchy and IDs; a slash denotes one submenu and no path may exceed two menu levels:

| Section | Hierarchy | Stable command IDs |
| --- | --- | --- |
| Project | root; Samples / Dual-Robot Sample | project.new, project.save, project.import, project.export, project.sample.dual |
| Home | root | view.focusSelection, scene.rename, scene.pose.copy, scene.pose.paste, scene.pose.reset, scene.visibility.toggle, scene.isolate, scene.showAll, scene.delete, robot.home, robot.gripper.open, robot.gripper.close |
| Model | root | model.add.box, model.add.cylinder, model.add.group, scene.group.move, scene.group.remove, robot.base.edit, robot.mount.edit |
| Job | root | job.new, job.pose.save, job.start, job.cancel, job.rename, job.duplicate, job.delete, view.timeline.open |
| Simulation | root | job.start, job.cancel, view.timeline.open, collision.validate, view.collision.open |
| Connectivity | Runtime Mode / Off or OPC UA Server; root details | connectivity.mode.off, connectivity.mode.server, connectivity.details.open |
| View | Panels, Theme, Layers, Camera, Standard Views | view.sidebar, view.inspector, view.bottom, view.ribbon, view.layout.reset, view.theme.system, view.theme.light, view.theme.dark, view.layer.grid, view.layer.world, view.layer.mcp, view.layer.base, view.layer.tcp, view.home, view.fitAll, view.focusSelection, view.orientation.isometric, view.orientation.top, view.orientation.front, view.orientation.right, view.orientation.back, view.orientation.left, view.orientation.bottom |
| Help | root | help.controls, help.stepImport, help.opcuaMapping when available, help.about |

composeAppCommandsV4 uses SceneCommandServiceV4 for primitives, rename, visibility, pose writes, groups, delete, and Robot base/mount edits; JobCommandServiceV4 for create/rename/duplicate/delete; InteractionStoreStateV4 for transform clipboard, isolate, showAll, and current target; ViewportPreferenceStoreV4 for layer checked state and writes; LocalHelpControllerV4 for Help topics. Project, View, Connectivity, Job, Simulation, Home, and Help commands are constructed only when their exact port and workflow exist. Theme, layer, dock, and OPC mode entries use toggle or radio checked state. Command property getters and execute functions read the current StoreApi/controller state, rather than closing over a stale selection snapshot. No command calls App component callbacks indirectly through a DOM element.

Each stable ID has exactly one AppCommandV4 definition and one canonical section. app-menu-model.ts may reference that ID from a second approved section—for example job.start in Job and Simulation, or view.focusSelection in Home and View—without cloning the command. Registry duplicate-ID rejection therefore remains intact and pending/error state stays shared.

Use these exact Context Bar IDs after the visible gate; entries noted absent are not registered or rendered:

| Context | Ordered IDs in the first implementation | Capability-gated entries absent now |
| --- | --- | --- |
| Robot | robot.jog.open, robot.home, robot.base.edit, scene.visibility.toggle | TCP, Geometry, OPC Mapping |
| Object | scene.pose.edit, scene.parent.edit, scene.group.move, scene.status.edit, scene.visibility.toggle, scene.delete | OPC Mapping |
| Job | job.pose.save, job.start, job.cancel, job.rename, job.duplicate, job.delete, view.timeline.open | Pose-step selection, Run From Here, Pause, Resume |
| Empty Viewport | model.add.box, model.add.cylinder, model.add.group, view.fitAll | STEP Add Object |

robot.jog.open and the four Object edit commands are context-only AppCommandV4 definitions; app-menu-model.ts does not place them in a global menu. They call actions.presentation.openInspector with the exact current selection and requested inspector section. Global-menu preview temporarily replaces this target list, and closing or dismissing the menu restores the same ordered Context Bar without changing selection.

- [ ] **Step 4: Extract Scene context command definitions**

Move target resolution and current menu action construction logic from SceneContextMenu into scene-context-commands.ts without changing SceneContextMenu yet. Return the same stable AppCommandV4 definitions and ordered IDs used by the global catalog. Prompt cancellation returns cancelled. The Task 10 integration converts SceneContextMenu into a presenter and removes ProjectMenuV4 only after StudioHeaderV4 exists, preventing this task from introducing an intermediate broken presenter.

- [ ] **Step 5: Run and commit**

~~~powershell
npm run test:run -- src/app/v4/app-command-composition.test.ts src/features/scene/v4/scene-context-commands.test.ts
git add src/app/v4/app-command-composition.ts src/app/v4/app-command-composition.test.ts src/features/scene/v4/scene-context-commands.ts src/features/scene/v4/scene-context-commands.test.ts
git commit -m "feat(ui): compose approved app commands"
~~~

Expected: command catalog and Scene context definition tests PASS; unsupported capability IDs are absent.

### Task 8: Build accessible Menu Bar and compact menu

**Files:**
- Create: src/features/ui/v4/app-menu-model.ts
- Create: src/features/ui/v4/app-menu-model.test.ts
- Create: src/features/ui/v4/AppCommandMenuItemV4.tsx
- Create: src/features/ui/v4/AppCommandMenuItemV4.test.tsx
- Create: src/features/ui/v4/AppMenuBarV4.tsx
- Create: src/features/ui/v4/AppMenuBarV4.test.tsx
- Create: src/features/ui/v4/CompactAppMenuV4.tsx
- Create: src/features/ui/v4/CompactAppMenuV4.test.tsx
- Create: src/features/commands/v4/app-shortcut-dispatcher.ts
- Create: src/features/commands/v4/app-shortcut-dispatcher.test.ts
- Modify: src/styles/global.css

**Interfaces:**
- Consumes: AppCommandRegistryV4 and AppCommandRuntimeV4.
- Produces: desktop role=menubar, compact Menu disclosure, and one App-lifetime keyboard shortcut dispatcher.

- [ ] **Step 1: Write failing accessibility tests**

Test fixed menu order, one open menu, Left/Right top-level movement, Up/Down/Home/End items, Enter/Space invocation, Escape focus return, Tab close, outside pointer close without inert, checked menuitemcheckbox and menuitemradio, disabled reason title, command pending state, and no empty Help menu. In app-menu-model.test.ts assert the Step 3 matrix exactly, Project contains Samples > Dual-Robot Sample, View contains the Theme radio submenu, cross-section references reuse one registry command, maximum depth is two, separators never lead/trail/repeat, and absent commands remove empty submenus. Test Right opens a submenu, Left closes it and restores parent focus, and compact categories expose the same hierarchy. In app-shortcut-dispatcher.test.ts assert Ctrl+S invokes project.save, H invokes view.home, and F invokes view.focusSelection exactly once; input, textarea, select, contenteditable, modifier mismatch, repeated keydown, hidden/disabled command, and an already-pending command do not invoke. preventDefault runs only for an exact registered and enabled shortcut.

- [ ] **Step 2: Run the new tests**

~~~powershell
npm run test:run -- src/features/ui/v4/app-menu-model.test.ts src/features/ui/v4/AppCommandMenuItemV4.test.tsx src/features/ui/v4/AppMenuBarV4.test.tsx src/features/ui/v4/CompactAppMenuV4.test.tsx src/features/commands/v4/app-shortcut-dispatcher.test.ts
~~~

Expected: FAIL because menu components are absent.

- [ ] **Step 3: Define menu sections**

~~~ts
export const APP_MENU_SECTIONS_V4 = Object.freeze([
  { id: 'project', label: 'Project' },
  { id: 'home', label: 'Home' },
  { id: 'model', label: 'Model' },
  { id: 'job', label: 'Job' },
  { id: 'simulation', label: 'Simulation' },
  { id: 'connectivity', label: 'Connectivity' },
  { id: 'view', label: 'View' },
  { id: 'help', label: 'Help' },
] as const)

export type AppMenuNodeV4 =
  | { readonly kind: 'command'; readonly commandId: string }
  | {
      readonly kind: 'submenu'
      readonly id: string
      readonly label: string
      readonly children: readonly AppMenuNodeV4[]
    }
  | { readonly kind: 'separator'; readonly id: string }

export interface AppMenuSectionModelV4 {
  readonly id: AppCommandSectionV4
  readonly label: string
  readonly children: readonly AppMenuNodeV4[]
}

export interface AppMenuNavigationPropsV4 {
  readonly openSection: AppCommandSectionV4 | null
  readonly onOpenSectionChange: (
    section: AppCommandSectionV4 | null,
  ) => void
  readonly onPreviewSection: (
    section: AppCommandSectionV4 | null,
  ) => void
}
~~~

buildAppMenuModelV4(registry) resolves command IDs into this hierarchy, removes invisible commands and empty submenus/sections, and normalizes separators. AppCommandMenuItemV4 maps action to menuitem, toggle to menuitemcheckbox, and radio to menuitemradio. Invoke through runtime only. Keep failed commands open and render the command-scoped error; completed commands close; cancelled and ignored commands remain open.

Define and implement the non-React shortcut owner:

~~~ts
export interface AppShortcutDispatcherV4 {
  dispose(): void
}

export function createAppShortcutDispatcherV4(options: {
  readonly target: Pick<Window, 'addEventListener' | 'removeEventListener'>
  readonly bindings: AppCommandBindingsV4
}): AppShortcutDispatcherV4
~~~

It installs exactly one keydown listener, normalizes command.shortcut values, ignores editable targets and event.repeat, and reads the current registry/runtime on each keydown. It calls preventDefault and runtime.invoke only when one visible, enabled command exactly matches. dispose removes the listener. Task 10 creates one instance for the App lifetime.

- [ ] **Step 4: Implement desktop and compact navigation**

Desktop triggers use roving tab focus and open menus below the trigger. Compact renders one Menu trigger and the same categories as nested groups. Both are controlled by openSection and publish onPreviewSection whenever a section opens/closes, including keyboard navigation and outside dismissal. Neither surface dims or makes the app inert. Pointerdown outside closes before the next control handles its action.

- [ ] **Step 5: Run and commit**

~~~powershell
npm run test:run -- src/features/ui/v4/app-menu-model.test.ts src/features/ui/v4/AppCommandMenuItemV4.test.tsx src/features/ui/v4/AppMenuBarV4.test.tsx src/features/ui/v4/CompactAppMenuV4.test.tsx src/features/commands/v4/app-shortcut-dispatcher.test.ts
git add src/features/ui/v4/app-menu-model.ts src/features/ui/v4/app-menu-model.test.ts src/features/ui/v4/AppCommandMenuItemV4.tsx src/features/ui/v4/AppCommandMenuItemV4.test.tsx src/features/ui/v4/AppMenuBarV4.tsx src/features/ui/v4/AppMenuBarV4.test.tsx src/features/ui/v4/CompactAppMenuV4.tsx src/features/ui/v4/CompactAppMenuV4.test.tsx src/features/commands/v4/app-shortcut-dispatcher.ts src/features/commands/v4/app-shortcut-dispatcher.test.ts src/styles/global.css
git commit -m "feat(ui): add accessible application menus"
~~~

Expected: menu tests PASS with correct roles and keyboard behavior.

### Task 9: Build Ribbon Lite, Context Bar, and Studio Header

**Files:**
- Create: src/features/ui/v4/ribbon-model-v4.ts
- Create: src/features/ui/v4/ribbon-model-v4.test.ts
- Create: src/features/ui/v4/ribbon-overflow-v4.ts
- Create: src/features/ui/v4/ribbon-overflow-v4.test.ts
- Create: src/features/ui/v4/app-header-status.ts
- Create: src/features/ui/v4/app-header-status.test.ts
- Create: src/features/ui/v4/RibbonLiteV4.tsx
- Create: src/features/ui/v4/RibbonLiteV4.test.tsx
- Create: src/features/ui/v4/StudioHeaderV4.tsx
- Create: src/features/ui/v4/StudioHeaderV4.test.tsx
- Create: src/features/help/v4/LocalHelpPanelV4.tsx
- Create: src/features/help/v4/LocalHelpPanelV4.test.tsx
- Modify: src/styles/global.css

**Interfaces:**
- Consumes: menu components, command registry/runtime, Active context, AppHeaderStatusV4, LocalHelpControllerV4, and ShellLayoutControllerV4.
- Produces: two-level header with Quick Actions, status, global-menu preview, target Context Bar, More overflow, and local Help presentation.

- [ ] **Step 1: Write failing resolver and header tests**

Test:

- Robot context IDs differ from Object, Job, and empty context.
- Opening a global menu temporarily previews its frequent commands; closing restores target context.
- Menu Bar and compact Menu publish the controlled open section to StudioHeader; that exact value drives previewSection.
- Hidden capability commands never appear.
- Save, Start, and Cancel are the only Quick Actions.
- Lower-priority commands enter one More group in stable order.
- Ribbon expanded state comes from Shell layout.
- Compact and narrow default collapsed.
- Long Project names truncate without moving menu triggers or statuses.
- Aggregate Simulation and Active Robot Joint source are distinct.
- A two-Robot status with one running Job renders runningJobCount=1 and robotCount=2 while Joint source names only the Active Robot.
- No Active Robot renders the exact `No active Robot` source label. Project idle, ready/saved, loading, saving, importing, error, and recovery-required states plus Gateway mode/status/endpoint come only from AppHeaderStatusV4; Header never recomputes domain state.
- At 1199 and 960 CSS pixels and under a constrained header container, status presentation switches to approved short labels before Quick Actions or supported menu commands are removed.
- Opening each available Help topic renders concise local content and close restores focus; unavailable OPC UA Mapping content creates neither command nor empty panel.

- [ ] **Step 2: Run new tests**

~~~powershell
npm run test:run -- src/features/ui/v4/ribbon-model-v4.test.ts src/features/ui/v4/ribbon-overflow-v4.test.ts src/features/ui/v4/app-header-status.test.ts src/features/ui/v4/RibbonLiteV4.test.tsx src/features/ui/v4/StudioHeaderV4.test.tsx src/features/help/v4/LocalHelpPanelV4.test.tsx
~~~

Expected: FAIL because Ribbon and Header modules are absent.

- [ ] **Step 3: Implement pure context and overflow models**

~~~ts
export interface RibbonContextV4 {
  readonly selection: SceneSelectionV4
  readonly activeRobotId: RobotIdV4 | null
  readonly activeJobId: RobotJobIdV4 | null
  readonly previewSection: AppCommandSectionV4 | null
}

export type AppIconKeyV4 =
  | 'save' | 'play' | 'cancel' | 'home' | 'box' | 'cylinder'
  | 'group' | 'timeline' | 'collision' | 'server' | 'view'

export interface RibbonItemSpecV4 {
  readonly commandId: string
  readonly priority: number
  readonly iconKey: AppIconKeyV4
}

export interface RibbonLayoutV4 {
  readonly visibleItems: readonly RibbonItemSpecV4[]
  readonly overflowItems: readonly RibbonItemSpecV4[]
}

export type ProjectHeaderPhaseV4 =
  | 'idle' | 'ready' | 'loading' | 'saving' | 'importing'
  | 'error' | 'recovery-required'

export interface AppHeaderStatusV4 {
  readonly project: {
    readonly name: string
    readonly phase: ProjectHeaderPhaseV4
    readonly saved: boolean
    readonly message: string | null
  }
  readonly simulation: {
    readonly runningJobCount: number
    readonly robotCount: number
  }
  readonly jointSource: {
    readonly activeRobotName: string | null
    readonly sourceLabel: string | null
  }
  readonly gateway: {
    readonly modeLabel: string
    readonly statusLabel: string
    readonly endpoint: string | null
  }
}

export function composeAppHeaderStatusV4(input: {
  readonly projectState: Pick<
    ProjectStoreStateV4,
    'activeProject' | 'status' | 'error'
  >
  readonly jobRuntime: Pick<JobRuntimeStoreV4, 'byRobotId'>
  readonly robotRuntime: Pick<RobotRuntimeRegistryV4, 'robots'>
  readonly activeRobotId: RobotIdV4 | null
  readonly gateway: RuntimeGatewayPresentationV4
}): AppHeaderStatusV4

export interface StudioHeaderPropsV4 {
  readonly status: AppHeaderStatusV4
  readonly menuModel: readonly AppMenuSectionModelV4[]
  readonly commandBindings: AppCommandBindingsV4
  readonly quickActionIds: readonly ['project.save', 'job.start', 'job.cancel']
  readonly ribbonContext: Omit<RibbonContextV4, 'previewSection'>
  readonly shellLayoutController: ShellLayoutControllerV4
}
~~~

Resolve previewSection first; otherwise resolve exact target context. Each supported command has one explicit priority and Lucide iconKey; the icon map contains no text glyphs, emoji, handcrafted SVG, or fallback box. Filter every item through registry visibility. Overflow takes available width and measured command widths, sorts by stable priority/order, and moves complete lower-priority items into More; it never creates horizontal scrolling.

- [ ] **Step 4: Implement RibbonLiteV4 and StudioHeaderV4**

StudioHeader owns openSection, passes it plus onOpenSectionChange/onPreviewSection to Menu Bar or compact Menu, and passes the resulting previewSection into RibbonContextV4. It renders RobotSim, Project name/phase/saved state, Quick Actions, running Job count, Active Joint source, Gateway status, and Ribbon disclosure exclusively from AppHeaderStatusV4 and the Shell snapshot. composeAppHeaderStatusV4 maps the authoritative ProjectStoreStatusV4 directly into project.phase, sets project.saved only when an active Project exists and the phase is ready, counts jobRuntime entries whose state is RUNNING, resolves the Active Robot name from Project order and its Joint source from robotRuntime, and maps RuntimeGatewayPresentationV4 without losing endpoint/error text. If activeRobotId is null or missing, jointSource.activeRobotName and sourceLabel are null and Header renders `No active Robot`. App calls this pure composer; no aggregate calculation remains in Header. Use an explicit wide/compact status-label table selected from Shell mode; CSS may truncate labels but must not hide Quick Actions before switching to the compact labels. RibbonLite maps AppIconKeyV4 to installed Lucide components and renders icon plus short label, accessible labels and tooltips, command pending state, and one More menu.

LocalHelpPanelV4 subscribes to LocalHelpControllerV4 and renders one non-route local panel/dialog using existing tokens. It contains only the four declared topics, closes on its close button or Escape, has no external fetch, and returns focus to the invoking Help menu item. It is not modal to the 3D workspace unless the existing dialog pattern used by the app is modal.

- [ ] **Step 5: Run and commit**

~~~powershell
npm run test:run -- src/features/ui/v4/ribbon-model-v4.test.ts src/features/ui/v4/ribbon-overflow-v4.test.ts src/features/ui/v4/app-header-status.test.ts src/features/ui/v4/RibbonLiteV4.test.tsx src/features/ui/v4/StudioHeaderV4.test.tsx src/features/help/v4/LocalHelpPanelV4.test.tsx
git add src/features/ui/v4/ribbon-model-v4.ts src/features/ui/v4/ribbon-model-v4.test.ts src/features/ui/v4/ribbon-overflow-v4.ts src/features/ui/v4/ribbon-overflow-v4.test.ts src/features/ui/v4/app-header-status.ts src/features/ui/v4/app-header-status.test.ts src/features/ui/v4/RibbonLiteV4.tsx src/features/ui/v4/RibbonLiteV4.test.tsx src/features/ui/v4/StudioHeaderV4.tsx src/features/ui/v4/StudioHeaderV4.test.tsx src/features/help/v4/LocalHelpPanelV4.tsx src/features/help/v4/LocalHelpPanelV4.test.tsx src/styles/global.css
git commit -m "feat(ui): add ribbon lite studio header"
~~~

Expected: header and ribbon tests PASS at wide, compact, and narrow modes.

### Task 10: Integrate command and layout composition across the application

**Files:**
- Modify: src/app/App.tsx
- Modify: src/app/App.test.tsx
- Modify: src/app/AppShell.tsx
- Modify: src/app/AppShell.test.tsx
- Modify: src/features/project/project-store-browser.ts
- Modify: src/features/project/project-store-browser.test.ts
- Delete: src/features/project/ProjectMenu.tsx
- Delete: src/features/project/ProjectMenu.test.tsx
- Modify: src/features/viewport/v4/ViewportOverlay.tsx
- Modify: src/features/viewport/v4/ViewportOverlay.test.tsx
- Modify: src/features/viewport/v4/viewport-runtime.tsx
- Modify: src/features/viewport/v4/viewport-runtime.test.tsx
- Modify: src/features/viewport/v4/WorldViewCube.tsx
- Modify: src/features/viewport/v4/WorldViewCube.test.tsx
- Modify: src/features/scene/v4/SceneCanvas.tsx
- Modify: src/features/scene/v4/SceneCanvas.test.tsx
- Modify: src/features/scene/v4/SceneExplorer.tsx
- Modify: src/features/scene/v4/SceneExplorer.test.tsx
- Modify: src/features/scene/v4/SceneEntityInspector.tsx
- Modify: src/features/scene/v4/SceneEntityInspector.test.tsx
- Modify: src/features/jobs/v4/RobotJobList.tsx
- Modify: src/features/jobs/v4/RobotJobList.test.tsx
- Modify: src/features/ui/v4/Timeline.tsx
- Modify: src/features/ui/v4/Timeline.test.tsx
- Modify: src/features/joints/v4/JointInspector.tsx
- Modify: src/features/joints/v4/JointInspector.test.tsx
- Modify: src/features/collision/v4/CollisionPanel.tsx
- Modify: src/features/collision/v4/CollisionPanel.test.tsx
- Modify: src/features/scene/v4/SceneContextMenu.tsx
- Modify: src/features/scene/v4/SceneContextMenu.test.tsx
- Modify: src/styles/global.css

**Interfaces:**
- Consumes every prior task.
- Produces one App registry/runtime plus one Shell layout controller backed by the injected preference store, used by all command surfaces.

- [ ] **Step 1: Write failing App integration tests**

Assert:

- Project menu operations invoke the original Project store and mutation services once.
- Model primitives invoke the original Scene command service once.
- Start and Cancel affect Active Robot only in a two-Robot Project.
- Object selection leaves Active Robot, Job pane, Timeline, and Joint source intact.
- View toggles and drawer buttons share one checked state.
- Opening Collision remains Bottom-visible with activeTab collision through the Task 4 Shell controller.
- AppShell renderViewport passes the same safe-area inset to SceneCanvas, WorldViewCube, ViewportOverlay controls, and SceneContextMenu clamping.
- At compact/narrow overlay states, View Cube and fallback controls remain outside the covered inset.
- Menu, Ribbon, Context Menu, and existing buttons expose the same pending/error state for one command ID.
- SceneExplorer visibility, Job create/rename/duplicate/delete, Viewport layer buttons, and Ctrl+S/H/F use the same IDs and runtime as Menu/Ribbon equivalents; each underlying service is called once.
- Robot/Object/Job/Empty Context Bars match the Task 7 ID table; opening and closing every global menu preview restores the same target Context Bar and a constrained row creates exactly one More menu.
- Header aggregate Simulation status and Active Robot Joint source match the explicit AppHeaderStatusV4 contract for two Robots.
- Scene-to-Job split persists at 35-75, resets only to 60, and hides without mutation below the 360-pixel narrow-drawer threshold.
- No unsupported copy appears.
- App contains no ProjectMenuV4 or old Add/Theme top controls.
- A complete layout action sequence and Reset leave Project revision/dirty state/export JSON, Robot joints, Job runtime, camera preference bytes, Gateway mode, and OPC UA configuration unchanged.
- Project New, Import, Save, and Export leave the workspace-preferences bytes unchanged.

- [ ] **Step 2: Run integration tests**

~~~powershell
npm run test:run -- src/app/App.test.tsx src/app/AppShell.test.tsx src/features/commands/v4/app-shortcut-dispatcher.test.ts src/features/help/v4/LocalHelpPanelV4.test.tsx src/features/viewport/v4/ViewportOverlay.test.tsx src/features/viewport/v4/viewport-runtime.test.tsx src/features/viewport/v4/WorldViewCube.test.tsx src/features/scene/v4/SceneCanvas.test.tsx src/features/scene/v4/SceneExplorer.test.tsx src/features/scene/v4/SceneEntityInspector.test.tsx src/features/jobs/v4/RobotJobList.test.tsx src/features/ui/v4/Timeline.test.tsx src/features/joints/v4/JointInspector.test.tsx src/features/collision/v4/CollisionPanel.test.tsx src/features/scene/v4/SceneContextMenu.test.tsx
~~~

Expected: FAIL because App does not compose the new registry/runtime/header/layout.

- [ ] **Step 3: Compose one registry/runtime in App**

Reuse the App-lifetime ShellLayoutControllerV4 created in Task 4. Create one AppCommandRuntimeV4 and one stable createAppCommandBindingsV4(runtime) facade for the App lifetime, replace the runtime registry whenever command inputs change, and dispose it only on App unmount. Every presenter and the AppShortcutDispatcherV4 calls bindings.getRegistry() rather than retaining a catalog object. Create one AppShortcutDispatcherV4 and one LocalHelpControllerV4 for the same lifetime. Create CollisionValidationControllerV4 with `createCollisionValidationControllerV4({ initialInput: { projectRevisionId, policy, proxies, jobRunning, query: queryVisibleGeometryCollisionsV4 } })`, call replaceInput with that same canonical query when Project revision or geometry inputs change, and dispose it on unmount. Create the browser UserPromptPortV4, existing SceneCommandServiceV4, existing JobCommandServiceV4, ViewportPreferenceStoreV4, and remaining feature ports from current Project resources and Runtime Bundle. Pass registry/runtime and the Shell layout controller to AppShell, Scene Context Menu, and migrated feature components. Compose AppHeaderStatusV4 once in App from authoritative stores. AppShell renderViewport passes safeAreaInsets into SceneCanvasV4 and SceneContextMenuV4; SceneCanvas threads them to ViewportRuntimeV4/WorldViewCubeV4 and ViewportOverlayV4. SceneContextMenu clamps its anchored rectangle to the visible Viewport minus the same insets. Keep command invocation outside render.

At this integration boundary, replace AppShell's `viewport: ReactNode` with:

~~~ts
readonly renderViewport: (
  safeAreaInsets: ViewportSafeAreaInsetsV4,
) => ReactNode
~~~

AppShell invokes it exactly once with controller.getState().safeAreaInsets.

ViewportOverlayV4 maps the four finite non-negative inset values to `--viewport-safe-top/right/bottom/left` CSS variables and positions Home/Fit/Focus/orientation controls inside them. WorldViewCubeV4 uses top/right as its GizmoHelper margin. SceneContextMenuV4 intersects its existing viewport-edge clamp rectangle with those four insets; if the remaining area is smaller than the menu, it pins to the visible area's top-left and keeps the menu itself scrollable rather than overflowing the document.

Equivalent feature buttons receive one `commandBindings: AppCommandBindingsV4` prop and use useAppCommandV4 with these stable IDs:

~~~text
JointInspector: robot.home, robot.gripper.open, robot.gripper.close, job.pose.save
RobotJobList: job.new, job.rename, job.duplicate, job.delete, job.start, job.cancel
Timeline: job.start, job.cancel
CollisionPanel: collision.validate
ViewportOverlay: view.home, view.fitAll, view.focusSelection, view.layer.grid, view.layer.world, view.layer.mcp, view.layer.base, view.layer.tcp
ViewOrientationControl: view.orientation.isometric, view.orientation.top, view.orientation.front, view.orientation.right, view.orientation.back, view.orientation.left, view.orientation.bottom
WorldViewCube axis faces: view.orientation.top, view.orientation.front, view.orientation.right, view.orientation.back, view.orientation.left, view.orientation.bottom
AppShell drawer buttons: view.sidebar, view.inspector, view.bottom
StudioHeader Ribbon disclosure: view.ribbon
SceneExplorer: scene.visibility.toggle
SceneEntityInspector focus requests: scene.pose.edit, scene.parent.edit, scene.group.move, scene.status.edit
SceneContextMenu: IDs returned by scene-context-commands.ts
~~~

Those buttons render enabled, checked, pending, and error state from the bound command and call only bound.invoke(). Before SceneExplorer invokes scene.visibility.toggle, it synchronously selects that row's exact SceneSelectionTargetV4 in the Interaction store; before a Job-row authoring command, RobotJobList synchronously selects that Robot and Job. The live command getters and execute functions from Task 7 then resolve that exact current target while retaining one stable ID. A disabled command never mutates selection. Thread commandBindings from App through SceneCanvasV4 to ViewportRuntimeV4. ViewOrientationControl dispatches its seven standard options by ID. WorldViewCubeV4 maps an axis-aligned face vector to the corresponding standard-view ID; a genuine edge/corner continues through setWorldDirection because it has no equivalent discrete Menu command. Test that each face invokes once and does not also call the direct direction callback. Joint slider drafting, Pose speed/reorder/delete, Collision result navigation, and other feature-specific editors remain local because they have no global-command equivalent. Remove component-local pending/error state only after its equivalent button uses the runtime.

- [ ] **Step 4: Replace duplicate header controls and finish command bindings**

Keep the Task 4 Collision/drawer controller path. AppShell drawer buttons and View commands read the same current-mode effective checked state. Mount LocalHelpPanelV4 once beside AppShell and mount the AppShortcutDispatcherV4 once from an effect; neither creates another command runtime. Replace the current header with StudioHeaderV4/RibbonLiteV4 and remove ProjectMenuV4, Add menu, inline Theme select, and their obsolete CSS.

- [ ] **Step 5: Run focused and full unit gates**

~~~powershell
npm run test:run -- src/app src/features/commands/v4 src/features/ui/v4 src/features/help/v4 src/features/interaction/v4 src/features/project src/features/scene/v4 src/features/jobs/v4 src/features/joints/v4 src/features/collision/v4 src/features/viewport/v4
npm run lint
npm run build
~~~

Expected: targeted Vitest tests, lint, and production build PASS.

- [ ] **Step 6: Commit integration**

~~~powershell
git add src/app/App.tsx src/app/App.test.tsx src/app/AppShell.tsx src/app/AppShell.test.tsx src/features/project/project-store-browser.ts src/features/project/project-store-browser.test.ts src/features/project/ProjectMenu.tsx src/features/project/ProjectMenu.test.tsx src/features/viewport/v4/ViewportOverlay.tsx src/features/viewport/v4/ViewportOverlay.test.tsx src/features/viewport/v4/viewport-runtime.tsx src/features/viewport/v4/viewport-runtime.test.tsx src/features/viewport/v4/WorldViewCube.tsx src/features/viewport/v4/WorldViewCube.test.tsx src/features/scene/v4/SceneCanvas.tsx src/features/scene/v4/SceneCanvas.test.tsx src/features/scene/v4/SceneExplorer.tsx src/features/scene/v4/SceneExplorer.test.tsx src/features/scene/v4/SceneEntityInspector.tsx src/features/scene/v4/SceneEntityInspector.test.tsx src/features/scene/v4/SceneContextMenu.tsx src/features/scene/v4/SceneContextMenu.test.tsx src/features/jobs/v4/RobotJobList.tsx src/features/jobs/v4/RobotJobList.test.tsx src/features/ui/v4/Timeline.tsx src/features/ui/v4/Timeline.test.tsx src/features/joints/v4/JointInspector.tsx src/features/joints/v4/JointInspector.test.tsx src/features/collision/v4/CollisionPanel.tsx src/features/collision/v4/CollisionPanel.test.tsx src/styles/global.css
git commit -m "feat(ui): integrate docked ribbon command workspace"
~~~

### Task 11: Add responsive browser acceptance and final verification

**Files:**
- Create: tests/docked-ribbon-layout.spec.ts
- Modify: playwright.config.ts
- Modify: package.json
- Modify: src/test/playwright-build-contract.test.ts

**Interfaces:**
- Produces: npm run test:e2e:layout and inclusion in test:e2e.

- [ ] **Step 1: Write a failing build-contract assertion**

Assert package scripts include:

~~~json
{
  "scripts": {
    "test:e2e:layout": "playwright test tests/docked-ribbon-layout.spec.ts",
    "test:e2e": "npm run test:e2e:v4 && npm run test:e2e:viewport && npm run test:e2e:layout",
    "verify": "npm run lint && npm run test:run && npm run cad:validate && npm run deploy:validate && npm run build:gateway && node dist-gateway/middleware/runtime-gateway/main.js --check-config && npm run build && npm run test:e2e"
  }
}
~~~

- [ ] **Step 2: Run the contract test**

~~~powershell
npm run test:run -- src/test/playwright-build-contract.test.ts
~~~

Expected: FAIL because the layout script and test do not exist.

- [ ] **Step 3: Add responsive acceptance cases**

At 1440x900, 1200x900, 1199x900, 960x900, 959x900, and 768x1024 verify:

- Correct Menu Bar or compact Menu mode.
- Mode-specific default docks and Ribbon state.
- Pointer resize, keyboard resize, clamping, reload, and divider double-click resetting only its own dimension.
- Scene-to-Job split persists a non-default ratio, clamps 35-75, resets only itself to 60, remains adjustable at 360 CSS pixels of narrow Sidebar content height, and hides without changing storage at 359.
- One live page crosses 1200 to 1199 and 960 to 959, then returns to 1440; overlays close on each transition and preferred widths restore.
- Malformed workspace-preferences JSON, a valid object missing one nested field, and a finite out-of-range size each normalize deterministically without touching Project or camera preference storage.
- Open compact Inspector and every narrow drawer/sheet, reload, and assert all transient overlays return closed while persisted dock/Ribbon state and sizes remain unchanged.
- Compact hides the Inspector resize handle; narrow hides all side and Bottom dock handles.
- Bottom bounding box x and width equal central Viewport x and width.
- Central Viewport stays at least 480 px on wide and compact.
- documentElement scrollWidth equals clientWidth and scrollHeight equals clientHeight with no panel overlap; the central .viewport scrollWidth equals clientWidth and computed overflow-x is hidden or clip.
- Long Project, Robot, Object, and Job names truncate.
- At 1199 and 960, short status labels appear while Save, Start, Cancel, and supported menu commands remain available.
- Select Robot, Object, Job, and empty Viewport contexts and assert the exact Task 7 Context Bar IDs. Open each global menu preview, dismiss it, and assert the prior target Context Bar returns. Constrain the Ribbon row and assert exactly one More menu with stable item order; Geometry, Kinematics, OPC Mapping, STEP Add Object, and other gated entries remain absent.
- Open compact Inspector and each narrow drawer/sheet; assert the Cube, orientation fallback, and anchored Context Menu bounds stay outside safe-area-covered regions.
- Light/Dark remain operable in automated browser coverage.
- Object selection preserves Active Robot; Joint and sample Job actions still work.
- Ctrl+S, H, and F execute Save, Home View, and Focus Selection once outside editors and do nothing inside a text field.
- OPC UA Off/Server radio state and Gateway status remain accurate.

- [ ] **Step 4: Run automated gates**

~~~powershell
npm run test:e2e:layout
npm run test:e2e:viewport
npm run test:e2e:v4
npm run lint
npm run test:run
npm run build
npm run verify
~~~

Expected: all commands exit 0; only the known bundle-size warning may remain.

- [ ] **Step 5: Verify visually in the user's in-app browser**

Use the same Project in Light and Dark themes. Before each paired screenshot, record viewport size, Project revision, camera position/target, Scene selection, Active Robot/Job, and command state; restore those exact values before the comparison capture. Supply each before/after pair together to one visual comparison input. Resize every dock, reopen it, reload, reset, and cross both breakpoints in one session. Exercise Project Save, Object creation, Robot Home, Save Pose, Job Start/Cancel, Collision validation, camera layers, and OPC UA Off/Server. Confirm each command runs once, pending/error state agrees across surfaces, overlay safe areas protect Viewport controls, and no root scrolling appears. Finally set the user's in-app browser to actual 200-percent page zoom and repeat Menu, Quick Action, dock, Cube/fallback, and scroll checks; Playwright viewport or deviceScaleFactor is not accepted as a substitute for this manual browser-zoom check.

- [ ] **Step 6: Commit acceptance coverage**

~~~powershell
git add tests/docked-ribbon-layout.spec.ts playwright.config.ts package.json src/test/playwright-build-contract.test.ts
git commit -m "test(ui): verify docked ribbon workspace"
~~~

## Final Verification

~~~powershell
npm run test:run -- src/features/interaction/v4/interaction-store.test.ts src/features/ui/v4/shell-layout-store.test.ts src/features/ui/v4/shell-layout-geometry.test.ts src/features/ui/v4/shell-layout-controller.test.ts src/features/ui/v4/use-shell-layout-observer.test.tsx src/features/ui/v4/DockResizeHandleV4.test.tsx src/features/commands/v4/app-command-registry.test.ts src/features/commands/v4/app-command-runtime.test.ts src/features/commands/v4/use-app-command.test.tsx src/features/commands/v4/app-shortcut-dispatcher.test.ts src/features/collision/v4/collision-validation-controller.test.ts src/features/help/v4/local-help-controller.test.ts src/features/help/v4/LocalHelpPanelV4.test.tsx src/app/v4/app-command-composition.test.ts src/features/ui/v4/app-header-status.test.ts src/features/ui/v4/app-menu-model.test.ts src/features/ui/v4/AppMenuBarV4.test.tsx src/features/ui/v4/CompactAppMenuV4.test.tsx src/features/ui/v4/RibbonLiteV4.test.tsx src/features/ui/v4/StudioHeaderV4.test.tsx src/app/App.test.tsx src/app/AppShell.test.tsx
npm run lint
npm run build
npm run test:e2e:viewport
npm run test:e2e:layout
npm run test:e2e:v4
npm run verify
~~~

Expected: every command exits with code 0; verify includes all three browser suites, and paired visual evidence confirms the approved Menu Bar/Ribbon, stable Active Robot, mode-aware persistence, bounded dock geometry, safe overlay insets, and unchanged Robot, Job, Collision, Viewport, Project, and OPC UA behavior.
