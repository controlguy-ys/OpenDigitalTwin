# OpenDigitalTwin UI V6 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the crowded fixed Project V5 interface with an industrial, resizable, keyboard-accessible UI V6 workspace that keeps the 3D viewport primary and makes Project, Model, Job, OPC UA, and inspection workflows easy to find.

**Architecture:** UI V6 is an application-shell version, not a new Project schema. `AppV6` continues to consume `BrowserProjectApplicationResourcesV5`, `WorkcellProjectV5`, the V5 mutation service, and the current Runtime Gateway contracts. A browser-local V6 layout store and one command registry feed the menu bar, toolbox, context menus, keyboard shortcuts, Explorer, Inspector, viewport overlays, and Job surfaces without changing Project V5 persistence or OPC UA ownership rules.

**Tech Stack:** React 19.2.7, TypeScript 6.0.3, Zustand 5.0.14, React Three Fiber 9.6.1, Drei 10.7.7, Three.js 0.185.1, Lucide React 1.24.0, Pretendard 1.3.9, Vitest 4.1.10, Testing Library 16.3.2, Playwright 1.61.1, Vite 8.1.4, CSS Grid.

## Global Constraints

- `V6` means the visible application and workspace generation. Canonical Project data remains exactly `schemaVersion: 5`; do not create `core/project-v6`, a Project migrator, dual persistence, or a Legacy Adoption path.
- V6 production code must not import from `src/app/v4`, `src/features/ui/v4`, `src/features/scene/v4`, `src/features/jobs/v4`, or `src/features/viewport/v4`.
- Preserve the existing `ProjectV5MutationService` revision, lease, idempotency, atomic publication, Runtime Epoch, and active Runtime Bundle boundaries.
- Preserve the current OPC UA endpoint, mapping, interpolation, ownership, address-space browsing, and Gateway contracts. UI work must never issue an external OPC UA write during automated or manual acceptance.
- Do not restore unsupported commands. A command without a current V5 service port remains absent from menus and toolboxes instead of appearing disabled or non-functional.
- Do not restore a simulation/runtime session after reload. Only UI preferences such as theme, panel sizes, panel visibility, and Toolbox collapse state may persist in browser-local storage.
- Keep one React Three Fiber `Canvas` mounted while panels resize, collapse, open as drawers, or switch tabs. Camera state and runtime subscriptions must survive layout changes.
- Main View maximize is an application-pane presentation mode, not the browser Fullscreen API or `F11`. Entering and leaving it must keep the same Canvas, camera, selection, runtime subscriptions, active Job, and Project revision.
- Main View maximize state is transient UI state. Never persist it to Project JSON or browser-local preferences, so reload always returns to the normal workspace.
- Use the following responsive modes from the measured workspace width: `wide >= 1200px`, `compact 960..1199px`, and `narrow < 960px`.
- Preserve at least 480 CSS pixels for the central viewport in wide and compact modes.
- Layout limits are Explorer `220..420px`, Inspector `280..480px`, and Bottom Workspace `120px..45%` of the measured workspace height.
- Wide defaults: Explorer and Inspector open, Bottom Job Monitor open at 180px, Toolbox collapsed.
- Compact defaults: Explorer docked, Inspector drawer closed, Bottom Job Monitor collapsed, Toolbox collapsed.
- Narrow defaults: Explorer and Inspector drawers closed, Job Monitor bottom sheet closed, Toolbox collapsed.
- Right mouse click is reserved for the context menu in the viewport and Explorer. Camera input is left-click select, middle-drag orbit, `Shift+middle-drag` pan, and wheel zoom.
- Use Pretendard Variable globally. Keep monospace only for NodeIds, code, and diagnostics.
- Support `system`, `dark`, and `light` themes. DOM panels, WebGL background, grid, axes, View Cube, markers, selection outline, and overlays must resolve from the same theme.
- Target WCAG 2.2 AA for the V6 HTML interaction layer. Automated checks supplement, but do not replace, keyboard, zoom, high-contrast, reduced-motion, and screen-reader acceptance.
- Interactive targets use a 32x32 CSS-pixel product minimum and never fall below the WCAG 24x24 CSS-pixel minimum. Focus indicators are at least 2px and retain 3:1 contrast against adjacent colors.
- Icon-only controls use Lucide icons, an accessible name, focus-visible styling, and a tooltip that is available on pointer hover and keyboard focus.
- A checkbox or switch must have a visible label and a one-line purpose or ownership explanation. Do not use unexplained boolean controls.
- `prefers-reduced-motion: reduce` removes panel, tooltip, status, camera-follow, and auto-scroll animation while preserving the final state.
- Project-owned edits create one atomic Project revision per completed user action. Dragging and numeric drafts do not publish intermediate revisions.
- Running Jobs are read-only. Reordering, editing, deleting, duplicating, attach/detach changes, and I/O changes are disabled while that Robot has a running Job.
- Preserve current Project bootstrap and StrictMode cleanup behavior. A V6 render must not dispose one-shot resources during the StrictMode setup probe.
- Add a targeted failing test before every behavioral change. Run focused tests after each task and `npm run verify` before final cutover.
- Use the in-app browser for the final visual and interaction acceptance. Generated screenshots belong under `artifacts/ui/v6/` and are not staged unless explicitly requested.

## V6 Information Architecture

### Persistent Header

- Brand and active Project name.
- Save state: `Saved`, `Unsaved`, `Saving`, or `Error`.
- Menus: `Project`, `Home`, `Model`, `Job`, `Simulation`, `Connectivity`, `View`, `Help`.
- Quick actions: Save, Start active Job, Cancel active Job.
- Compact runtime status: Simulation/Live, Gateway, and OPC UA.

### Contextual Toolbox

- Always available: Select, Translate, Rotate.
- Model authoring: Add Box, Add Cylinder.
- View helpers: Focus Selection and Fit All.
- Import Robot and Import Object remain absent until V5 authoring ports exist; V6 does not call V4 import dialogs.

### Workspace

- Left: searchable Scene Explorer with Frames, Robots, Groups, and Objects.
- Center: stable 3D viewport and small unobstructed overlays.
- Right: selected Robot or Object Inspector.
- Bottom: compact current-Job monitor.
- Full Job authoring: resizable modal dialog with a vertical instruction list and Step Inspector.

### Main View Presentation

- The Main View pane toolbar ends with one icon-only toggle using Lucide `Maximize2` in workspace mode and `Minimize2` in maximized mode.
- The same DOM control remains mounted and swaps its accessible name and tooltip between `Maximize Main View` and `Restore Main View`.
- Maximized mode masks the application header, Explorer, Inspector, Toolbox, and Job Monitor while the Main View fills the application viewport. Those surfaces retain their sizes, collapsed/open state, active selection, and drafts for exact restoration.
- The pane toolbar is separate from the Canvas overlay, so the presentation control never covers the View Cube or camera controls.
- The restore icon and `Escape` return to the exact prior workspace. `Escape` first closes a menu, popover, context menu, or non-busy dialog; it restores Main View only when no higher-priority overlay is open.
- Maximizing does not call `requestFullscreen()`, alter browser chrome, create a Project revision, run Home/Fit, or restart rendering/runtime resources.

### Context Actions

- Robot: Focus, Translate Base, Rotate Base, Show/Hide, Open Binding, Rename.
- Object: Focus, Translate, Rotate, Show/Hide, Duplicate, Open Binding, Rename, Delete when `removable === true`.
- Group: Show/Hide, Rename, Delete only when empty.
- Empty viewport: Add Box, Add Cylinder, Fit All.
- Job instruction: Edit, Insert Before, Insert After, Duplicate, Delete, Move Before, Move After.

## File Structure

### Create

- `src/app/v6/AppV6.tsx` — resource lifecycle and top-level composition only.
- `src/app/v6/AppV6.test.tsx` — bootstrap, Runtime Epoch, dialog routing, and cutover tests.
- `src/app/v6/app-command-composition-v6.ts` — bind V6 command IDs to V5 resource ports.
- `src/app/v6/app-command-composition-v6.test.ts` — identical command behavior across UI surfaces.
- `src/app/v6/v6-production-import-graph.test.ts` — forbid production imports from V4/Legacy UI.
- `src/app/v6/v6-style-contract.test.ts` — Pretendard, semantic tokens, reduced motion, and fixed-color boundary.
- `src/features/commands/v6/app-command-v6.ts` — command types and registry.
- `src/features/commands/v6/app-command-v6.test.ts` — registry, enabled state, and invocation tests.
- `src/features/interaction/v6/workcell-selection-v6.ts` — Robot, Object, Frame, and Group selection identity.
- `src/features/ui/v6/workspace-layout-store-v6.ts` — browser-local layout and theme preferences.
- `src/features/ui/v6/workspace-layout-store-v6.test.ts` — persistence, clamping, reset, and corrupt-data tests.
- `src/features/ui/v6/workspace-layout-geometry-v6.ts` — pure responsive geometry and safe-area calculation.
- `src/features/ui/v6/workspace-layout-geometry-v6.test.ts` — wide, compact, and narrow layout tests.
- `src/features/ui/v6/ApplicationShellV6.tsx` — header and dock composition.
- `src/features/ui/v6/ApplicationShellV6.test.tsx` — stable viewport and responsive drawer tests.
- `src/features/ui/v6/DockResizeHandleV6.tsx` — pointer and keyboard resizing.
- `src/features/ui/v6/AppMenuBarV6.tsx` — eight top-level menus.
- `src/features/ui/v6/ModelToolboxV6.tsx` — contextual authoring and view tools.
- `src/features/ui/v6/HeaderStatusV6.tsx` — save, simulation, Gateway, and OPC UA status.
- `src/features/ui/v6/IconButtonV6.tsx` — accessible icon control.
- `src/features/ui/v6/TooltipV6.tsx` — hover/focus tooltip.
- `src/features/ui/v6/StatusBadgeV6.tsx` — text, icon, and color state.
- `src/features/ui/v6/SwitchFieldV6.tsx` — labeled boolean setting.
- `src/features/ui/v6/ModalDialogV6.tsx` — common focus, Escape, header, body, and footer behavior.
- `src/features/ui/v6/dialog-request-v6.ts` — closed dialog-routing union used by AppV6.
- `src/features/ui/v6/HelpOverlayV6.tsx` — controls, ownership, Job, and OPC UA help.
- `src/features/scene/v6/scene-tree-model-v6.ts` — stable hierarchical Explorer rows.
- `src/features/scene/v6/SceneExplorerV6.tsx` — searchable keyboard tree.
- `src/features/scene/v6/SceneContextMenuV6.tsx` — typed context actions.
- `src/features/scene/v6/scene-command-service-v6.ts` — V5 mutation-backed scene actions.
- `src/features/inspector/v6/SelectionInspectorV6.tsx` — selection routing.
- `src/features/inspector/v6/ObjectInspectorV6.tsx` — Runtime, Transform, Geometry, Status, and Communications.
- `src/features/inspector/v6/RobotInspectorV6.tsx` — Runtime, Base, Joints, Tool/TCP, and Communications.
- `src/features/viewport/v6/WorkcellViewportV6.tsx` — stable Canvas and scene composition.
- `src/features/viewport/v6/ViewportOverlayV6.tsx` — camera, layer, and transform UI.
- `src/features/viewport/v6/camera-controller-v6.ts` — Home, Fit, Focus, and standard view commands.
- `src/features/viewport/v6/scene-theme-v6.ts` — resolved DOM/WebGL theme values.
- `src/features/viewport/v6/transform-session-v6.ts` — local TransformControls draft and one-shot commit.
- `src/features/jobs/v6/RobotJobMonitorV6.tsx` — compact runtime monitor.
- `src/features/jobs/v6/RobotJobEditorDialogV6.tsx` — full Job authoring dialog.
- `src/features/jobs/v6/JobInstructionListV6.tsx` — vertical sortable list and execution follow.
- `src/features/jobs/v6/job-instruction-summary-v6.ts` — readable instruction summaries.
- `src/features/jobs/v6/job-authoring-service-v6.ts` — atomic V5 Job mutations.
- `src/features/connectivity/v6/ConnectivityMenuV6.tsx` — compact status and links to existing V5 connectivity surfaces.
- `src/styles/v6/tokens.css` — semantic dark/light tokens.
- `src/styles/v6/base.css` — Pretendard, focus, form, and reset rules.
- `src/styles/v6/shell.css` — header, dock, drawer, and responsive layout.
- `src/styles/v6/components.css` — shared controls, menus, tooltip, status, and dialog.
- `src/styles/v6/scene.css` — Explorer and Inspector.
- `src/styles/v6/viewport.css` — overlays and safe areas.
- `src/styles/v6/jobs.css` — Job monitor and editor.
- `src/styles/v6/index.css` — one explicit V6 stylesheet entry.
- `tests/ui-v6-shell.spec.ts` — layout, menu, theme, and stable viewport acceptance.
- `tests/ui-v6-scene.spec.ts` — Explorer, context menu, transform, and ownership acceptance.
- `tests/ui-v6-jobs.spec.ts` — 17-Step Job monitor/editor acceptance.
- `tests/ui-v6-connectivity.spec.ts` — settings, monitor, binding, and nested browse dialog acceptance.
- `tests/ui-v6-accessibility.spec.ts` — axe, keyboard-only, zoom, and landmark acceptance.

### Modify

- `src/app/App.tsx` — export `AppV6` only after all parity gates pass.
- `src/main.tsx` — load `src/styles/v6/index.css` at V6 cutover.
- `src/styles/global.css` — remove the superseded V5 shell section after cutover; do not add new V6 rules here.
- `src/features/ui/theme-preference.ts` — reuse the existing preference type under V6 ownership.
- `src/features/connectivity/v5/OpcUaSettingsDialog.tsx` — adopt `ModalDialogV6` without changing settings behavior.
- `src/features/connectivity/v5/BindingEditorDialog.tsx` — adopt `ModalDialogV6` after nested browser verification.
- `src/features/connectivity/v5/BindingOverviewDialog.tsx` — adopt `ModalDialogV6`.
- `src/features/connectivity/v5/DockerRunGuideDialog.tsx` — adopt `ModalDialogV6`.
- `src/features/connectivity/v5/OpcUaAddressSpaceBrowserDialog.tsx` — adopt nested V6 dialog stacking last.
- `package.json` — add Pretendard and focused V6 test scripts.
- `package-lock.json` — lock the exact font package.
- `playwright.config.ts` — add V6 screenshot projects only if existing configuration cannot express the required viewports.

### Remove After Verified Cutover

- `src/app/v5/AppV5.tsx`
- `src/app/v5/AppV5.test.tsx`
- V5 shell CSS selectors under `.v5-app-shell`, `.v5-app-header`, `.v5-layout`, `.v5-explorer`, `.v5-workcell`, `.v5-inspector`, and `.v5-jobs`.

Project V5 core, V5 project features, V5 connectivity logic, V5 runtime stores, and Gateway code remain.

---

### Task 1: Lock the V6 Boundary and Command Contract

**Files:**
- Create: `docs/superpowers/specs/2026-07-30-open-digital-twin-ui-v6-design.md`
- Modify: `docs/design/robot-sim-visual-spec.md`
- Create: `src/features/commands/v6/app-command-v6.ts`
- Create: `src/features/commands/v6/app-command-v6.test.ts`
- Create: `src/features/interaction/v6/workcell-selection-v6.ts`
- Create: `src/app/v6/v6-production-import-graph.test.ts`

**Interfaces:**
- Produces: `AppCommandIdV6`, `AppCommandSnapshotV6`, `AppCommandRegistryV6`, and the final V6 menu/Toolbox/context-action inventory.

- [ ] **Step 1: Write the V6 design contract**

Record the Information Architecture, responsive modes, Main View maximize/restore presentation, right-button rule, ownership behavior, theme rules, Job authoring model, and explicit non-goals from this plan. State clearly:

```md
UI V6 consumes Project V5. UI V6 does not imply Project schemaVersion 6.
Unsupported capabilities stay absent.
Runtime session state is not restored after reload.
```

- [ ] **Step 2: Write failing command and import-boundary tests**

```ts
expect(registry.get('model.addBox')?.enabled).toBe(true)
expect(registry.get('model.addBox')?.label).toBe('Add Box')
await registry.invoke('model.addBox')
expect(addBox).toHaveBeenCalledOnce()

expect(productionV6Imports).not.toContainEqual(
  expect.stringMatching(/\/(?:app|features)\/.*\/v4\//u),
)
```

Test duplicate command IDs, unknown invocation, hidden commands, disabled commands, and a rejected asynchronous command.
Verify `view.main.maximize` is exposed by both the View menu and Main View pane toolbar, changes from `Maximize Main View` with `Maximize2` to `Restore Main View` with `Minimize2`, and never invokes a Project mutation.

- [ ] **Step 3: Implement the minimal command registry**

```ts
export type AppCommandIdV6 =
  | 'project.new' | 'project.loadDemo' | 'project.save'
  | 'project.export' | 'project.import'
  | 'tool.select' | 'tool.translate' | 'tool.rotate'
  | 'model.addBox' | 'model.addCylinder'
  | 'view.focusSelection' | 'view.fitAll'
  | 'view.main.maximize'
  | 'scene.toggleVisibility' | 'scene.rename'
  | 'scene.duplicate' | 'scene.delete'
  | 'binding.open'
  | 'job.openEditor' | 'job.start' | 'job.cancel'
  | 'view.layout.reset'
  | 'view.theme.system' | 'view.theme.dark' | 'view.theme.light'
  | 'help.controls' | 'help.about'

export interface AppCommandSnapshotV6 {
  readonly id: AppCommandIdV6
  readonly label: string
  readonly enabled: boolean
  readonly visible: boolean
  readonly checked?: boolean
  readonly shortcut?: string
  execute(): void | Promise<void>
}

export type V6WorkcellSelection =
  | { readonly kind: 'robot'; readonly id: string }
  | { readonly kind: 'entity'; readonly id: string }
  | { readonly kind: 'frame'; readonly id: string }
  | { readonly kind: 'group'; readonly id: string }
```

- [ ] **Step 4: Run the focused gate**

Run:

```powershell
npm run test:run -- src/features/commands/v6/app-command-v6.test.ts src/app/v6/v6-production-import-graph.test.ts
```

Expected: both test files pass and no V6 production import points to V4.

- [ ] **Step 5: Commit**

```powershell
git add docs/design/robot-sim-visual-spec.md docs/superpowers/specs/2026-07-30-open-digital-twin-ui-v6-design.md src/features/commands/v6/app-command-v6.ts src/features/commands/v6/app-command-v6.test.ts src/features/interaction/v6/workcell-selection-v6.ts src/app/v6/v6-production-import-graph.test.ts
git commit -m "docs(ui): define the OpenDigitalTwin V6 workspace contract"
```

---

### Task 2: Establish V6 Tokens, Pretendard, and Shared Controls

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `src/styles/v6/tokens.css`
- Create: `src/styles/v6/base.css`
- Create: `src/styles/v6/components.css`
- Create: `src/styles/v6/index.css`
- Create: `src/features/ui/v6/IconButtonV6.tsx`
- Create: `src/features/ui/v6/TooltipV6.tsx`
- Create: `src/features/ui/v6/StatusBadgeV6.tsx`
- Create: `src/features/ui/v6/SwitchFieldV6.tsx`
- Create: `src/features/ui/v6/ui-primitives-v6.test.tsx`

**Interfaces:**
- Produces: semantic V6 tokens and four accessible primitives used by every later task.

- [ ] **Step 1: Add the exact offline font dependency**

Run:

```powershell
npm install --save-exact pretendard@1.3.9
npm install --save-dev --save-exact @axe-core/playwright@4.12.1
```

Import the packaged variable font from `src/styles/v6/base.css`, then set:

```css
:root {
  font-family: "Pretendard Variable", Pretendard, system-ui, sans-serif;
}
```

- [ ] **Step 2: Write failing theme and primitive tests**

```tsx
render(<IconButtonV6 icon={Save} label="Save Project" onClick={onClick} />)
expect(screen.getByRole('button', { name: 'Save Project' })).toBeVisible()
await user.tab()
expect(screen.getByRole('tooltip')).toHaveTextContent('Save Project')

render(<SwitchFieldV6 checked={false} description="Read transform from OPC UA" label="Enable communications" onChange={onChange} />)
expect(screen.getByRole('checkbox', { name: 'Enable communications' })).toHaveAccessibleDescription('Read transform from OPC UA')
```

Verify dark and light token snapshots expose canvas, panel, viewport, border, text, muted, accent, success, warning, fault, selection, focus, and overlay colors.
Add `v6-style-contract.test.ts` assertions that the V6 stylesheet entry loads Pretendard, defines both themes, includes a reduced-motion block, and does not use fixed panel/text colors outside `tokens.css`.

- [ ] **Step 3: Implement semantic tokens and primitives**

Use `data-theme="light"` and `data-theme="dark"` overrides. `StatusBadgeV6` must render icon, visible text, and `data-state`; color alone is never the only state signal.

- [ ] **Step 4: Run the focused gate**

```powershell
npm run test:run -- src/features/ui/v6/ui-primitives-v6.test.tsx src/features/ui/theme-preference.test.ts src/app/v6/v6-style-contract.test.ts
npm run lint
```

Expected: all focused tests and lint pass.

- [ ] **Step 5: Commit**

```powershell
git add package.json package-lock.json src/styles/v6 src/app/v6/v6-style-contract.test.ts src/features/ui/v6/IconButtonV6.tsx src/features/ui/v6/TooltipV6.tsx src/features/ui/v6/StatusBadgeV6.tsx src/features/ui/v6/SwitchFieldV6.tsx src/features/ui/v6/ui-primitives-v6.test.tsx
git commit -m "feat(ui): add V6 themes and accessible controls"
```

---

### Task 3: Build the Browser-Local Resizable Workspace Shell

**Files:**
- Create: `src/features/ui/v6/workspace-layout-store-v6.ts`
- Create: `src/features/ui/v6/workspace-layout-store-v6.test.ts`
- Create: `src/features/ui/v6/workspace-layout-geometry-v6.ts`
- Create: `src/features/ui/v6/workspace-layout-geometry-v6.test.ts`
- Create: `src/features/ui/v6/DockResizeHandleV6.tsx`
- Create: `src/features/ui/v6/dialog-request-v6.ts`
- Create: `src/features/ui/v6/ApplicationShellV6.tsx`
- Create: `src/features/ui/v6/ApplicationShellV6.test.tsx`
- Create: `src/styles/v6/shell.css`
- Modify: `src/styles/v6/index.css`

**Interfaces:**
- Produces: `WorkspaceLayoutStoreV6`, `WorkspaceLayoutSnapshotV6`, `ApplicationShellV6`, and stable viewport safe-area insets.

- [ ] **Step 1: Write failing store and geometry tests**

```ts
expect(resolveWorkspaceModeV6(1200)).toBe('wide')
expect(resolveWorkspaceModeV6(1199)).toBe('compact')
expect(resolveWorkspaceModeV6(959)).toBe('narrow')

store.getState().setDockSize('explorer', 999)
expect(store.getState().preferences.explorerWidthPx).toBe(420)
store.getState().setDockSize('inspector', 20)
expect(store.getState().preferences.inspectorWidthPx).toBe(280)
```

Also verify corrupt storage resets safely, `resetLayout()` preserves theme, and no runtime, Project, selection, or open-dialog state is persisted.
Verify Main View presentation is excluded from serialized preferences and a newly created store always starts in `workspace` mode.

- [ ] **Step 2: Implement the preference contract**

```ts
export interface WorkspacePreferencesV6 {
  readonly version: 1
  readonly theme: 'system' | 'dark' | 'light'
  readonly explorerWidthPx: number
  readonly inspectorWidthPx: number
  readonly bottomHeightPx: number
  readonly toolboxCollapsed: boolean
  readonly visibleByMode: Readonly<Record<'wide' | 'compact' | 'narrow', {
    readonly explorer: boolean
    readonly inspector: boolean
    readonly bottom: boolean
  }>>
}

export interface WorkspaceLayoutSnapshotV6 {
  readonly mode: 'wide' | 'compact' | 'narrow'
  readonly preferences: WorkspacePreferencesV6
  readonly mainViewPresentation: 'workspace' | 'maximized'
  readonly viewportSafeArea: {
    readonly top: number
    readonly right: number
    readonly bottom: number
    readonly left: number
  }
}

export type DialogRequestV6 =
  | { readonly kind: 'opcua-settings' }
  | { readonly kind: 'binding-overview' }
  | { readonly kind: 'binding-editor'; readonly target: OpcUaProjectTargetV5; readonly mappingId?: string }
  | { readonly kind: 'docker-guide' }
  | { readonly kind: 'job-editor'; readonly jobId: string }
  | { readonly kind: 'help'; readonly topic: 'controls' | 'about' }
```

Persist under `opendigitaltwin.ui-v6.preferences.v1`.
Expose `toggleMainViewMaximized()` and `restoreMainView()` as transient store actions. Do not add `mainViewPresentation` to `WorkspacePreferencesV6`.

- [ ] **Step 3: Write the stable-viewport component test**

Render a viewport child that increments a mount counter. Resize, collapse, reopen every panel, maximize Main View, and restore the workspace, then assert:

```ts
expect(viewportMountCount).toBe(1)
expect(screen.getByRole('separator', { name: 'Resize Scene Explorer' })).toHaveAttribute('aria-valuenow')
expect(screen.getByRole('button', { name: 'Maximize Main View' })).toBeVisible()
```

Snapshot panel sizes and visibility before maximizing. After the restore icon and after `Escape`, assert the snapshot is restored exactly. The same toolbar button retains focus; do not move focus back into a previously active hidden dock.

- [ ] **Step 4: Implement the shell and handles**

Use CSS variables for dock dimensions. Handles support pointer drag, Arrow keys in 8px increments, `Shift+Arrow` in 24px increments, and double-click reset. Compact and narrow overlays publish safe-area insets to viewport overlays.

Apply `data-main-view-presentation="maximized"` to the existing shell instead of conditionally replacing the viewport. CSS makes Main View occupy the complete application grid and masks other shell regions without unmounting them. Masked regions must be inert and absent from keyboard and screen-reader navigation. The Main View toolbar and its presentation control remain mounted.

- [ ] **Step 5: Run and commit**

```powershell
npm run test:run -- src/features/ui/v6/workspace-layout-store-v6.test.ts src/features/ui/v6/workspace-layout-geometry-v6.test.ts src/features/ui/v6/ApplicationShellV6.test.tsx
git add src/features/ui/v6/workspace-layout-store-v6.ts src/features/ui/v6/workspace-layout-store-v6.test.ts src/features/ui/v6/workspace-layout-geometry-v6.ts src/features/ui/v6/workspace-layout-geometry-v6.test.ts src/features/ui/v6/DockResizeHandleV6.tsx src/features/ui/v6/dialog-request-v6.ts src/features/ui/v6/ApplicationShellV6.tsx src/features/ui/v6/ApplicationShellV6.test.tsx src/styles/v6/shell.css src/styles/v6/index.css
git commit -m "feat(ui): add the resizable V6 workspace shell"
```

---

### Task 4: Add the Menu Bar, Toolbox, Header Status, and Command Composition

**Files:**
- Create: `src/app/v6/app-command-composition-v6.ts`
- Create: `src/app/v6/app-command-composition-v6.test.ts`
- Create: `src/features/ui/v6/AppMenuBarV6.tsx`
- Create: `src/features/ui/v6/ModelToolboxV6.tsx`
- Create: `src/features/ui/v6/HeaderStatusV6.tsx`
- Create: `src/features/ui/v6/HelpOverlayV6.tsx`
- Create: `src/features/ui/v6/command-surfaces-v6.test.tsx`

**Interfaces:**
- Consumes: `AppCommandRegistryV6`, `BrowserProjectApplicationResourcesV5`, `WorkspaceLayoutStoreV6`.
- Produces: one command state and execution path for menu, Toolbox, context menu, and shortcuts.

- [ ] **Step 1: Write failing surface-parity tests**

Invoke `model.addBox` from the Model menu, Toolbox, and empty-viewport context menu against separate harnesses. Each must call the same registry command once and create one Project revision.

```ts
expect(menuAddBox).toHaveAttribute('data-command-id', 'model.addBox')
expect(toolboxAddBox).toHaveAttribute('data-command-id', 'model.addBox')
expect(contextAddBox).toHaveAttribute('data-command-id', 'model.addBox')
```

Invoke `view.main.maximize` from the View menu and Main View pane toolbar against separate harnesses. Each must use the same layout command, publish no Project revision, and expose the same checked state. The command returns focus to the View menu trigger when invoked from the menu; the toolbar button keeps focus when invoked directly.

- [ ] **Step 2: Compose V5 resource ports**

Move primitive creation out of `AppV5`. The command composition receives:

```ts
export interface AppCommandCompositionContextV6 {
  readonly resources: BrowserProjectApplicationResourcesV5
  readonly selection: V6WorkcellSelection | null
  readonly layout: WorkspaceLayoutStoreV6
  readonly openDialog: (dialog: DialogRequestV6) => void
  readonly setInteractionMode: (mode: 'select' | 'translate' | 'rotate') => void
}
```

Keep Runtime ownership and mutation errors in the existing resource boundaries.

- [ ] **Step 3: Implement the visible header**

At 1366px wide, the header must remain one row. Detailed OPC UA settings, Connection Monitor, Binding Overview, Docker Guide, Add Box, and Add Cylinder move out of the persistent button row.

- [ ] **Step 4: Implement keyboard behavior**

- `Ctrl+S`: Save Project and prevent the browser Save dialog.
- `F1`: Help Overlay.
- `Escape`: close the active menu, popover, context menu, or non-busy dialog first; otherwise restore a maximized Main View.
- `Shift+F10`: open the context menu for the focused Explorer row or selected scene object.
- Do not bind browser-reserved shortcuts that cannot be prevented consistently.

- [ ] **Step 5: Run and commit**

```powershell
npm run test:run -- src/app/v6/app-command-composition-v6.test.ts src/features/ui/v6/command-surfaces-v6.test.tsx
git add src/app/v6/app-command-composition-v6.ts src/app/v6/app-command-composition-v6.test.ts src/features/ui/v6/AppMenuBarV6.tsx src/features/ui/v6/ModelToolboxV6.tsx src/features/ui/v6/HeaderStatusV6.tsx src/features/ui/v6/HelpOverlayV6.tsx src/features/ui/v6/command-surfaces-v6.test.tsx
git commit -m "feat(ui): unify V6 menus toolbox and shortcuts"
```

---

### Task 5: Replace the Flat Explorer with a Searchable Scene Tree

**Files:**
- Create: `src/features/scene/v6/scene-tree-model-v6.ts`
- Create: `src/features/scene/v6/scene-tree-model-v6.test.ts`
- Create: `src/features/scene/v6/SceneExplorerV6.tsx`
- Create: `src/features/scene/v6/SceneExplorerV6.test.tsx`
- Create: `src/features/scene/v6/SceneContextMenuV6.tsx`
- Create: `src/features/scene/v6/SceneContextMenuV6.test.tsx`
- Create: `src/features/scene/v6/scene-command-service-v6.ts`
- Create: `src/features/scene/v6/scene-command-service-v6.test.ts`
- Create: `src/styles/v6/scene.css`
- Modify: `src/styles/v6/index.css`

**Interfaces:**
- Consumes: `V6WorkcellSelection` from Task 1.
- Produces: stable `SceneTreeRowV6` values and atomic Robot/Object/Group scene commands.

- [ ] **Step 1: Write failing tree-model tests**

Use one World frame, one MCP frame, two Robots, one nested Group, and three Objects. Verify stable order, parent depth, visibility, owner labels, and filtering that retains matching ancestors.

- [ ] **Step 2: Implement semantic tree rows**

```ts
export interface SceneTreeRowV6 {
  readonly key: string
  readonly kind: 'section' | 'frame' | 'robot' | 'group' | 'object'
  readonly id: string
  readonly parentKey: string | null
  readonly depth: number
  readonly name: string
  readonly visible: boolean | null
  readonly ownerLabel: string | null
}
```

- [ ] **Step 3: Implement keyboard and pointer interaction**

Use `role="tree"` and `role="treeitem"`. Arrow Up/Down changes the active row, Arrow Right expands, Arrow Left collapses or focuses the parent, Enter selects, Space toggles visibility when supported, and `Shift+F10` opens the same context menu as right click.

- [ ] **Step 4: Implement scene mutations**

Every rename, visibility, duplicate, and delete operation calls `ProjectV5MutationService.mutate()` once with the current `expectedRevisionId`. Delete is absent for non-removable Objects and non-empty Groups.

- [ ] **Step 5: Run and commit**

```powershell
npm run test:run -- src/features/scene/v6/scene-tree-model-v6.test.ts src/features/scene/v6/SceneExplorerV6.test.tsx src/features/scene/v6/SceneContextMenuV6.test.tsx src/features/scene/v6/scene-command-service-v6.test.ts
git add src/features/scene/v6 src/styles/v6/scene.css src/styles/v6/index.css
git commit -m "feat(scene): add the V6 Explorer and context actions"
```

---

### Task 6: Stabilize the Viewport, Camera Tools, Mouse Mapping, and Transform Gizmo

**Files:**
- Create: `src/features/viewport/v6/WorkcellViewportV6.tsx`
- Create: `src/features/viewport/v6/WorkcellViewportV6.test.tsx`
- Create: `src/features/viewport/v6/ViewportOverlayV6.tsx`
- Create: `src/features/viewport/v6/ViewportOverlayV6.test.tsx`
- Create: `src/features/viewport/v6/camera-controller-v6.ts`
- Create: `src/features/viewport/v6/camera-controller-v6.test.ts`
- Create: `src/features/viewport/v6/scene-theme-v6.ts`
- Create: `src/features/viewport/v6/scene-theme-v6.test.ts`
- Create: `src/features/viewport/v6/transform-session-v6.ts`
- Create: `src/features/viewport/v6/transform-session-v6.test.ts`
- Create: `src/styles/v6/viewport.css`
- Modify: `src/styles/v6/index.css`

**Interfaces:**
- Produces: `CameraControllerV6`, `SceneThemeV6`, and `TransformSessionV6`.
- Consumes: V5 Runtime Bundle, Project V5 mutation service, V6 selection, interaction mode, and viewport safe areas.

- [ ] **Step 1: Write failing mouse and camera tests**

Verify right-button pointer down requests context actions and never starts pan. Verify Home restores camera, Fit All uses visible geometry bounds, and Focus Selection changes the orbit pivot without mutating Project or Robot state.

Render `WorkcellViewportV6` in workspace and maximized presentation states. Assert the pane-toolbar toggle keeps the same DOM identity, changes `aria-pressed`, accessible name, tooltip, and Lucide icon, and invokes `view.main.maximize`. Toggle twice and assert `canvasAfter === canvasBefore`, the camera snapshot is unchanged, and Runtime Epoch, subscription count, active Job, selection, and Project revision do not change.

- [ ] **Step 2: Implement the camera contract**

```ts
export interface CameraControllerV6 {
  home(): void
  fitAll(): void
  focusSelection(): void
  setOrientation(value: 'isometric' | 'top' | 'front' | 'right' | 'back' | 'left' | 'bottom'): void
}
```

`WorkcellViewportV6` owns the pane container with `id="v6-main-view"` and a narrow toolbar outside the Canvas overlay. Put the maximize/restore command at the toolbar's right edge with `aria-controls="v6-main-view"` and `aria-pressed`. The same button remains mounted and focused when clicked.

Keep the View Cube in the Canvas upper-right safe area and place Home, Fit, and Focus below or to the left of it without overlap. The separate pane toolbar must not consume or cover the View Cube safe area. Maximizing triggers only the existing ResizeObserver/R3F resize path; do not call Home or Fit.

- [ ] **Step 3: Implement one resolved scene theme**

Map semantic tokens into background, grid minor/major lines, axes, marker labels, selection outline, View Cube, and overlay colors. Theme changes must not remount Canvas.

- [ ] **Step 4: Implement draft-only transforms**

`TransformSessionV6` snapshots the selected manual-owned Object pose or Robot base pose at drag start, updates only the temporary scene object during drag, and publishes one validated V5 mutation on drag end. Escape restores the snapshot. OPC UA-, simulation-, or attachment-owned transforms reject the session with a visible owner explanation.

- [ ] **Step 5: Run and commit**

```powershell
npm run test:run -- src/features/viewport/v6 src/features/scene/v5/attachment-pose-runtime.test.ts
git add src/features/viewport/v6 src/styles/v6/viewport.css src/styles/v6/index.css
git commit -m "feat(viewport): add stable V6 camera and transform controls"
```

---

### Task 7: Split the Inspector into Focused Robot and Object Panels

**Files:**
- Create: `src/features/inspector/v6/SelectionInspectorV6.tsx`
- Create: `src/features/inspector/v6/ObjectInspectorV6.tsx`
- Create: `src/features/inspector/v6/ObjectInspectorV6.test.tsx`
- Create: `src/features/inspector/v6/RobotInspectorV6.tsx`
- Create: `src/features/inspector/v6/RobotInspectorV6.test.tsx`
- Modify: `src/styles/v6/scene.css`

**Interfaces:**
- Consumes: V5 Project, Runtime Bundle, selection, connected endpoint IDs, mutation service, and `binding.open`.
- Produces: controlled Transform and Communications drafts keyed by selection ID and Project revision.

- [ ] **Step 1: Write failing Object Inspector tests**

Verify collapsible Runtime, Transform, Geometry, Status, and Communications sections; XYZ/RPY units; one Apply action; owner-driven disabled state; labeled communications switch; tagName editing; and no mutation for unchanged drafts.

- [ ] **Step 2: Write failing Robot Inspector tests**

Verify Runtime, Base Transform, Joints, Tool/TCP, Status, and Communications sections. Confirm joint controls target the selected Robot, not the first Robot, and OPC UA joint ownership disables manual sliders with a readable explanation.

- [ ] **Step 3: Implement controlled drafts**

Reset a draft only when selection identity or published revision changes. Reject invalid numbers before mutation. Use metres internally and present a consistent selected display unit with the unit visible beside every field.

- [ ] **Step 4: Add collapsible section state**

Section openness is transient component state and is not written to Project or local storage. Inspector header remains sticky; Apply/Reset actions remain visible without horizontal scrolling.

- [ ] **Step 5: Run and commit**

```powershell
npm run test:run -- src/features/inspector/v6 src/features/connectivity/v5/entity-comms-model.test.ts src/features/robot/v5/robot-joint-runtime-store.test.ts
git add src/features/inspector/v6 src/styles/v6/scene.css
git commit -m "feat(inspector): add focused V6 Robot and Object panels"
```

---

### Task 8: Replace the Horizontal Job Strip with a Monitor and Vertical Editor

**Files:**
- Create: `src/features/jobs/v6/RobotJobMonitorV6.tsx`
- Create: `src/features/jobs/v6/RobotJobMonitorV6.test.tsx`
- Create: `src/features/jobs/v6/RobotJobEditorDialogV6.tsx`
- Create: `src/features/jobs/v6/RobotJobEditorDialogV6.test.tsx`
- Create: `src/features/jobs/v6/JobInstructionListV6.tsx`
- Create: `src/features/jobs/v6/JobInstructionListV6.test.tsx`
- Create: `src/features/jobs/v6/job-instruction-summary-v6.ts`
- Create: `src/features/jobs/v6/job-instruction-summary-v6.test.ts`
- Create: `src/features/jobs/v6/job-authoring-service-v6.ts`
- Create: `src/features/jobs/v6/job-authoring-service-v6.test.ts`
- Create: `src/styles/v6/jobs.css`
- Modify: `src/styles/v6/index.css`

**Interfaces:**
- Consumes: V5 Job runtime store, playback controller, Project V5 mutation service, and `ModalDialogV6`.
- Produces: readable summaries and atomic reorder/edit/insert/delete/duplicate operations over the existing `RobotJobV5.instructions` array.

- [ ] **Step 1: Write failing summary tests**

Expected summaries:

```ts
expect(summary(moveJoint)).toBe('Move joints · 6 axes · 30%')
expect(summary(waitDi)).toBe('Wait PartPresent = true · timeout 3 s')
expect(summary(setDo)).toBe('Set GripperClose = true')
expect(summary(delay)).toBe('Delay 500 ms')
expect(summary(attach)).toBe('Attach Part → TCP')
expect(summary(detach)).toBe('Detach Part → World')
```

- [ ] **Step 2: Write failing monitor tests**

The monitor shows Job, Start/Cancel, `Current Step 6 / 17`, kind, summary, state, and message. It does not render a horizontal instruction list.

- [ ] **Step 3: Write failing vertical-list tests**

Render 17 instructions and verify:

```ts
expect(currentRow).toHaveAttribute('aria-current', 'step')
expect(list.scrollWidth).toBeLessThanOrEqual(list.clientWidth)
```

Follow Execution is on by default. Manual scroll pauses it and exposes `Return to Current Step`. Current, complete, waiting, and failed states use visible text and icons.
The current row uses `aria-current="step"`. One `aria-live="polite"` region announces only the Step number, instruction kind, and terminal/wait state; it never announces interpolated joint values.

- [ ] **Step 4: Implement atomic authoring commands**

```ts
export interface JobAuthoringServiceV6 {
  reorder(jobId: string, instructionId: string, beforeId: string | null): Promise<void>
  insert(jobId: string, instruction: RobotJobInstructionV1, beforeId: string | null): Promise<void>
  replace(jobId: string, instruction: RobotJobInstructionV1): Promise<void>
  duplicate(jobId: string, instructionId: string): Promise<void>
  remove(jobId: string, instructionId: string): Promise<void>
}
```

HTML drag handles provide pointer reorder. `Alt+ArrowUp` and `Alt+ArrowDown` provide keyboard reorder. Both call one service operation. Block every authoring command while the Robot runtime state is active.

- [ ] **Step 5: Run and commit**

```powershell
npm run test:run -- src/features/jobs/v6 src/features/jobs/v5/job-executor.test.ts src/features/jobs/v5/simulation-clock.test.ts
git add src/features/jobs/v6 src/styles/v6/jobs.css src/styles/v6/index.css
git commit -m "feat(jobs): add the V6 Job monitor and vertical editor"
```

---

### Task 9: Consolidate Dialogs and Connectivity Navigation

**Files:**
- Create: `src/features/ui/v6/ModalDialogV6.tsx`
- Create: `src/features/ui/v6/ModalDialogV6.test.tsx`
- Create: `src/features/connectivity/v6/ConnectivityMenuV6.tsx`
- Create: `src/features/connectivity/v6/ConnectivityMenuV6.test.tsx`
- Modify: `src/features/connectivity/v5/DockerRunGuideDialog.tsx`
- Modify: `src/features/connectivity/v5/BindingOverviewDialog.tsx`
- Modify: `src/features/connectivity/v5/OpcUaSettingsDialog.tsx`
- Modify: `src/features/connectivity/v5/BindingEditorDialog.tsx`
- Modify: `src/features/connectivity/v5/OpcUaAddressSpaceBrowserDialog.tsx`
- Modify: `src/styles/v6/components.css`

**Interfaces:**
- Produces: one modal frame and a Connectivity menu that opens current V5 controllers without duplicating settings state.

- [ ] **Step 1: Write failing dialog behavior tests**

Verify initial focus, Tab/Shift+Tab containment, Escape close when not busy, trigger-focus restoration, `aria-labelledby`, non-dismissal while applying, and nested dialog stacking.

- [ ] **Step 2: Implement `ModalDialogV6`**

```ts
export interface ModalDialogV6Props {
  readonly titleId: string
  readonly busy?: boolean
  readonly triggerRef?: RefObject<HTMLElement | null>
  readonly onClose: () => void
  readonly header: ReactNode
  readonly children: ReactNode
  readonly footer: ReactNode
}
```

- [ ] **Step 3: Migrate in increasing risk order**

Migrate Docker Guide, Binding Overview, OPC UA Settings, Binding Editor, then nested Address Space Browser. Run each existing focused test immediately after its migration. Do not change endpoint drafts, validation, address conversion, or activation behavior.

- [ ] **Step 4: Implement Connectivity navigation**

The persistent header shows compact health only. The Connectivity menu contains OPC UA Settings, Connection Monitor, Binding Overview, and Docker Run Guide. Selected Robot/Object surfaces continue to offer `Open Binding`.

- [ ] **Step 5: Run and commit**

```powershell
npm run test:connectivity-ui
git add src/features/ui/v6/ModalDialogV6.tsx src/features/ui/v6/ModalDialogV6.test.tsx src/features/connectivity/v6 src/features/connectivity/v5/DockerRunGuideDialog.tsx src/features/connectivity/v5/BindingOverviewDialog.tsx src/features/connectivity/v5/OpcUaSettingsDialog.tsx src/features/connectivity/v5/BindingEditorDialog.tsx src/features/connectivity/v5/OpcUaAddressSpaceBrowserDialog.tsx src/styles/v6/components.css
git commit -m "feat(connectivity): unify V6 dialogs and navigation"
```

---

### Task 10: Compose AppV6 and Prove Behavioral Parity

**Files:**
- Create: `src/app/v6/AppV6.tsx`
- Create: `src/app/v6/AppV6.test.tsx`
- Create: `tests/ui-v6-shell.spec.ts`
- Create: `tests/ui-v6-scene.spec.ts`
- Create: `tests/ui-v6-jobs.spec.ts`
- Create: `tests/ui-v6-connectivity.spec.ts`
- Create: `tests/ui-v6-accessibility.spec.ts`
- Modify: `src/app/App.tsx`
- Modify: `src/main.tsx`
- Modify: `src/styles/global.css`
- Modify: `package.json`

**Interfaces:**
- Consumes: every prior V6 surface and `BrowserProjectApplicationResourcesV5`.
- Produces: the one production `App` entry point.

- [ ] **Step 1: Write failing AppV6 parity tests**

Port the current AppV5 bootstrap, StrictMode disposal, Runtime Epoch replacement, Object communications mutation, Load Demo, binding, and Job start assertions. Add:

```ts
expect(screen.getByRole('menubar')).toBeVisible()
expect(screen.getByRole('main', { name: '3D viewport' })).toBeVisible()
expect(screen.getByRole('tree', { name: 'Scene Explorer' })).toBeVisible()
expect(screen.queryByText('Project V5', { exact: true })).not.toBeInTheDocument()
```

The Project schema remains verifiably 5 in exported JSON and About details.

- [ ] **Step 2: Compose AppV6 without lifecycle duplication**

Move only resource lifecycle, selection, dialog requests, and command composition into `AppV6`. Keep Explorer, Inspector, viewport, Job, and Connectivity rendering in their focused feature components.

- [ ] **Step 3: Cut over production entry and styles**

Change:

```ts
export { AppV6 as App } from './v6/AppV6.js'
```

Keep the shared `global.css` import for still-active feature styles and load `src/styles/v6/index.css` immediately after it. Remove superseded V5 shell rules only after V6 component and E2E tests pass.

- [ ] **Step 4: Add the V6 browser suites**

Add these exact package scripts:

```json
{
  "test:e2e:v6": "playwright test tests/ui-v6-shell.spec.ts tests/ui-v6-scene.spec.ts tests/ui-v6-jobs.spec.ts tests/ui-v6-connectivity.spec.ts tests/ui-v6-accessibility.spec.ts",
  "test:e2e": "npm run test:e2e:v6"
}
```

Run at 1712x1368, 1366x768, 1024x768, and 768x1024. Test:

- Header never wraps or obscures status.
- Every dock resizes, collapses, and reopens.
- Viewport remains at least 480px in wide/compact.
- Camera and runtime state survive dock changes.
- Main View maximize masks workspace chrome, fills the application viewport, swaps to the restore icon, and restores the exact panel geometry and visibility from both the icon and `Escape`.
- Main View maximize/restore keeps the same Canvas DOM node and preserves camera, selection, active Job, Runtime Epoch, subscriptions, and Project revision without invoking the browser Fullscreen API.
- The Main View pane toolbar, View Cube, Home, Fit, and Focus controls never overlap in workspace or maximized mode.
- Right click opens context actions without panning.
- Light and Dark theme every DOM and WebGL surface.
- No unexplained checkbox is present.
- 17-Step Job has no horizontal scrollbar and follows execution.
- Nested OPC UA address browsing returns focus to Binding Editor.
- 200% browser zoom reflows without body-level horizontal scrolling.
- `@axe-core/playwright` reports zero serious or critical violations for the default workspace, OPC UA Settings, Binding Editor, and Job Editor.
- Keyboard-only navigation completes Project menu, Scene Tree selection, `Shift+F10` context action, Inspector edit, Binding dialog, and Job Editor without a trap.

- [ ] **Step 5: Run automated verification**

```powershell
npm run test:run -- src/app/v6 src/features/commands/v6 src/features/ui/v6 src/features/scene/v6 src/features/inspector/v6 src/features/viewport/v6 src/features/jobs/v6 src/features/connectivity/v5 src/features/connectivity/v6
npm run lint
npm run typecheck
npm run build
npm run test:e2e:v6
npm run verify
```

Expected: all commands exit 0. If the environment blocks native browser or full-suite execution, record the exact blocker and do not mark V6 complete until the missing gate runs in an allowed environment.

- [ ] **Step 6: Run the manual browser acceptance**

Capture accepted screenshots into:

```text
artifacts/ui/v6/
  01-wide-dark.png
  02-wide-light.png
  03-compact-inspector-drawer.png
  04-narrow-scene-drawer.png
  05-main-view-maximized.png
  06-object-context-menu.png
  07-object-opcua-owned-inspector.png
  08-job-monitor-running.png
  09-job-editor-17-steps.png
  10-opcua-address-browser.png
  11-help-overlay.png
```

Inspect every file before accepting it. Verify the working flow: load demo, select Object, edit manual pose, open binding, browse/copy NodeId, start Job, follow current Step, cancel/reset, switch theme, resize docks, and reopen Help.
During the same flow, maximize Main View while a Job is running, inspect the unobstructed pane toolbar and Canvas controls, restore with the icon, maximize again, and restore with `Escape`. Confirm the Job, camera, selection, Runtime Epoch, Project revision, and prior dock geometry remain unchanged.
Repeat the critical flow at 200% zoom and with Windows High Contrast and reduced-motion enabled. Verify landmark, Scene Tree, Dialog, and Job status announcements with NVDA and Chromium.

- [ ] **Step 7: Commit the cutover**

```powershell
git add src/app/v6 src/app/App.tsx src/main.tsx src/styles/v6 src/styles/global.css src/features/commands/v6 src/features/ui/v6 src/features/scene/v6 src/features/inspector/v6 src/features/viewport/v6 src/features/jobs/v6 src/features/connectivity/v6 src/features/connectivity/v5 package.json package-lock.json tests/ui-v6-shell.spec.ts tests/ui-v6-scene.spec.ts tests/ui-v6-jobs.spec.ts tests/ui-v6-connectivity.spec.ts tests/ui-v6-accessibility.spec.ts
git commit -m "feat(ui): cut over OpenDigitalTwin to UI V6"
```

---

### Task 11: Remove Superseded UI Composition After V6 Acceptance

**Files:**
- Delete: `src/app/v5/AppV5.tsx`
- Delete: `src/app/v5/AppV5.test.tsx`
- Modify: `src/styles/global.css`
- Modify: `src/app/v6/v6-production-import-graph.test.ts`
- Modify: `package.json`

**Interfaces:**
- Produces: a single V6 production UI with Project V5 domain/runtime contracts.

- [ ] **Step 1: Prove the old composition is unreachable**

```powershell
rg -n "AppV5|v5-app-shell|v5-app-header|v5-layout|v5-explorer|v5-workcell|v5-inspector|v5-jobs" src tests package.json
```

Expected before deletion: matches exist only in the two V5 composition files, superseded CSS, and the deletion-boundary test.

- [ ] **Step 2: Delete only the proven-dead composition and CSS**

Do not delete Project V5, V5 Runtime, V5 Connectivity, or Gateway code. Strengthen the import-graph test to reject new references to the removed UI.

- [ ] **Step 3: Run final verification**

```powershell
npm run verify
```

Expected: exit 0 with the V6 production entry point and no V4/Legacy UI production imports.

- [ ] **Step 4: Commit**

```powershell
git add src/app/v5/AppV5.tsx src/app/v5/AppV5.test.tsx src/styles/global.css src/app/v6/v6-production-import-graph.test.ts package.json
git commit -m "refactor(ui): remove superseded V5 composition"
```

## Completion Gate

UI V6 is complete only when all conditions hold:

1. The production entry is `AppV6`; exported Project JSON remains `schemaVersion: 5`.
2. No V6 production file imports V4/Legacy UI.
3. Header stays one row at 1366x768 and contains no primitive or detailed Connectivity button cluster.
4. Explorer, Inspector, Toolbox, and Job Monitor resize/collapse without remounting Canvas or resetting camera/runtime state.
5. Main View exposes a non-overlapping maximize/restore icon, fills the application viewport without invoking browser full screen, and restores the exact previous workspace from both the icon and `Escape`.
6. Main View maximize/restore preserves the same Canvas node, camera, selection, active Job, Runtime Epoch, subscriptions, and Project revision.
7. Wide, compact, narrow, Dark, Light, and 200% zoom acceptance passes.
8. Right click opens context actions and never performs camera pan.
9. Manual transform commits once; OPC UA/simulation/attachment ownership stays read-only and visibly explained.
10. The 17-Step demo has no horizontal scrollbar, exposes the current Step, and provides Follow Execution recovery.
11. All icon-only controls have accessible names and tooltips; all switches have visible labels and descriptions.
12. Keyboard-only, 200% zoom, High Contrast, reduced-motion, NVDA, and axe acceptance gates pass with no serious or critical automated accessibility violations.
13. Existing Project, Load Demo, Save, Export, Import, OPC UA Settings, Connection Monitor, Binding, Address Space Browse, Job Start/Cancel, and Runtime Epoch flows pass.
14. Targeted tests, lint, typecheck, build, E2E, full verify, and manual in-app browser acceptance are recorded at the same commit.
