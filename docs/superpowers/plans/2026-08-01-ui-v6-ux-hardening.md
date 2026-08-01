# UI V6 UX Hardening Implementation Plan

> **For Codex:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` to implement this plan task-by-task. Dispatch a fresh `gpt-5.6-luna` agent for each implementation task and a separate Luna reviewer before the task commit is accepted.

**Goal:** Fix every confirmed UI/UX defect from the audit of commit `e1ec66c9ff83a69e8a726c55dcc248b80a3c2097`: unstable native-looking menus and controls, a silent/blank 3D viewport, contradictory offline diagnostics, inaccessible Connection Monitor behavior, truncated Job failures and lost compact context, dense Job editing, and an enabled no-op OPC UA Apply action.

**Architecture:** Keep Project V5 and Runtime Gateway contracts authoritative. Add a small V6 control primitive, explicit scene-presentation telemetry between the V5 renderer and V6 camera, typed connectivity freshness, semantic Job status surfaces, and a guarded Settings submit path. Independent Luna lanes own disjoint source files; one Luna integration lane wires `AppV6` and acceptance tests after the component lanes are green.

**Tech Stack:** React 19, TypeScript, Zustand, React Three Fiber/Drei, Vitest/Testing Library, Playwright, Oxlint, Vite, Runtime Gateway V1 diagnostics.

## Global Constraints

- Implement only in `C:\Users\googo\DevelopmentMain\Example\SampleProj0710\RobotSimWeb\.worktrees\ui-v6-main-integration` on branch `codex/ui-v6-main-integration`.
- Start from exact base commit `e1ec66c9ff83a69e8a726c55dcc248b80a3c2097`; rebase or merge only with explicit user approval.
- Preserve the pre-existing untracked `.omo/` directory. Stage named files only; never use `git add -A` or `git add .`.
- UI V6 remains an application shell over Project V5. Do not add a Project V6 schema, restore Legacy/V4 production imports, or change browser-owned Project persistence.
- Preserve revision, lease, idempotency, command ownership, and atomic publication boundaries.
- Do not perform external OPC UA writes, PLC/Robot actions, transfer, restart, or deployment. Local Gateway/browser fixture reset is allowed for tests.
- Retained runtime data is valuable for diagnosis, but it must be visibly labelled `Last known` whenever the current transport is unavailable.
- Use collision geometry as the current renderer fallback. Loading STEP or other full asset meshes is outside this hardening plan and must not block a visible proxy, camera framing, or an actionable render-state message.
- Critical error and recovery text must wrap; it must not be hidden behind unconditional ellipsis.
- Menu, toolbar, and dock controls have a minimum 32 CSS-pixel target; primary dialog actions retain the existing 40 CSS-pixel treatment where already defined.
- Keep the Connection Monitor modeless and the viewport operable while it is open.
- Generated logs, traces, reports, and screenshots stay under ignored `artifacts/`; do not commit them.
- Each behavioral fix starts with a test that fails on `e1ec66c`, then passes after the smallest implementation.
- Each implementation task in Tasks 1-6 ends with targeted tests, `npm run lint`, `npm run build`, a narrow commit, and an independent Luna review of the diff. Task 7 is the root-owned independent integration gate.

## Audit-to-Task Traceability

| Audit finding | Owning task | Observable completion |
|---|---:|---|
| Project menu expands the header and native-looking controls are inconsistent | 1 | Opening any top-level menu does not change header height; shared controls expose V6 classes, sizes, focus, and pressed state |
| Viewport shows only axes with no explanation; Fit All/Focus are no-ops | 2 and 6 | Demo robot and Part proxies are reported/rendered, unresolved poses produce a visible message, and camera commands change the live Three camera |
| Header says Gateway Offline while retained rows say Online/GOOD | 3 | Current transport is Offline and retained rows read Last known/Stale with their original observation time |
| Connection Monitor does not receive focus or close on Escape | 3 | Opening focuses the panel heading; Escape closes and restores the connected opener without trapping viewport focus |
| Job failure message is truncated and weak; compact layout loses it | 4 and 6 | Full failure text, state badge, live announcement, recovery actions, and compact FAILED summary remain available |
| Job Editor inspector is visually dense | 4 | Instruction fields and actions are grouped into labelled, spaced sections without changing authoring semantics |
| Apply & Activate is enabled with Changed sections 0 | 5 | Button is disabled, helper text explains why, and direct form submit cannot cross the activation boundary |

## SubAgent Execution Map

| Wave | Task | Luna ownership | May run with | Must wait for |
|---|---:|---|---|---|
| A | 1 | Shared V6 controls, menu layout, shell dock API/CSS | 2, 3, 4, 5 | None |
| A | 2 | V5 scene telemetry, proxy visibility, camera synchronization internals | 1, 3, 4, 5 | None |
| A | 3 | Poller refresh, connectivity freshness/model/panel/global monitor CSS | 1, 2, 4, 5 | None |
| A | 4 | Job monitor/editor, compact status component, Job CSS/dialog request | 1, 2, 3, 5 | None |
| A | 5 | OPC UA Settings dirty/no-op guard | 1, 2, 3, 4 | None |
| B | 6 | `AppV6` composition plus Playwright acceptance | Nothing touching `AppV6` or listed specs | Tasks 1-5 accepted |
| C | 7 | Root integration gate and manual QA evidence | None | Task 6 accepted |

For every Luna task: the implementer returns the exact diff, red/green command output, and commit candidate; a fresh Luna reviewer checks spec coverage and code quality; the root agent authorizes the narrow commit only after review findings are resolved. Agents must not edit files owned by another active lane. Wave A source work may run concurrently, but all staging and commits are serialized by the root agent.

### Task 1: Stabilize the Menu Bar and Shared V6 Controls

**Luna owner:** Shell/control lane.

**Files:**

- Create: `src/features/ui/v6/ButtonV6.tsx`
- Modify: `src/features/ui/v6/AppMenuBarV6.tsx`
- Modify: `src/features/ui/v6/CommandSurfaceControlV6.tsx`
- Modify: `src/features/ui/v6/ApplicationShellV6.tsx`
- Modify: `src/features/ui/v6/HeaderStatusV6.tsx`
- Modify: `src/styles/v6/components.css`
- Modify: `src/styles/v6/shell.css`
- Test: `src/features/ui/v6/ui-primitives-v6.test.tsx`
- Test: `src/features/ui/v6/command-surfaces-v6.test.tsx`
- Test: `src/features/ui/v6/ApplicationShellV6.test.tsx`

**Contract:** `ButtonV6Props` extends native button attributes with `variant: 'primary' | 'secondary' | 'ghost' | 'danger'` and `size: 'compact' | 'default'`. `ApplicationShellV6Props` gains optional `bottomStatus?: ReactNode`. Menu anchors use `.v6-menu-anchor`, triggers use `.v6-menu-trigger`, and surfaces use `.v6-menu-surface`; the surface is absolutely positioned below its trigger and does not participate in header layout.

- [ ] **Step 1: Add red shared-button tests**

  Extend `ui-primitives-v6.test.tsx` to render compact/default variants and assert the variant/size data attributes, native disabled state, forwarded ref, and accessible name. Run:

  ```bash
  npm run test:run -- src/features/ui/v6/ui-primitives-v6.test.tsx
  ```

  Expected on `e1ec66c`: failure because `ButtonV6` does not exist.

- [ ] **Step 2: Implement `ButtonV6` and token-driven styles**

  Use existing V6 focus/color tokens. Add 32px compact and 40px default minimum heights, visible `:focus-visible`, disabled treatment, and no global selector changes. Re-run the Step 1 command and expect PASS.

- [ ] **Step 3: Add red menu-structure and shell-toggle tests**

  In `command-surfaces-v6.test.tsx`, assert each top-level trigger has `.v6-menu-trigger` and its opened menu is `.v6-menu-surface` inside `.v6-menu-anchor`. In `ApplicationShellV6.test.tsx`, assert all dock toggles use the shared button, expose `aria-pressed`, and render `bottomStatus` even while the Bottom dock is collapsed. Run:

  ```bash
  npm run test:run -- src/features/ui/v6/command-surfaces-v6.test.tsx src/features/ui/v6/ApplicationShellV6.test.tsx
  ```

  Expected: failures for missing classes, pressed state, and `bottomStatus`.

- [ ] **Step 4: Make menus floating and normalize command controls**

  Add explicit menu classes in `AppMenuBarV6`; set the anchor to `position: relative` and the surface to `position: absolute; top: 100%; left: 0` with the existing overlay z-index token. Apply `ButtonV6` or the same V6 class contract to `CommandSurfaceControlV6`. Preserve current roving focus, menuitem roles, theme radio roles, command IDs, Escape behavior, and stable opener restoration.

- [ ] **Step 5: Normalize shell dock controls and compact status**

  Replace the three bare dock buttons with `ButtonV6 size="compact" variant="ghost"`, set `aria-pressed` to the corresponding visibility state, and render `bottomStatus` only in the Job Monitor toggle. Keep the mounted Canvas and all existing drawer/dock state semantics unchanged. Ensure `HeaderStatusV6` keeps Project, save, simulation, Gateway, and OPC UA labels available at compact width.

- [ ] **Step 6: Verify and commit Task 1**

  ```bash
  npm run test:run -- src/features/ui/v6/ui-primitives-v6.test.tsx src/features/ui/v6/command-surfaces-v6.test.tsx src/features/ui/v6/ApplicationShellV6.test.tsx
  npm run lint
  npm run build
  git add src/features/ui/v6/ButtonV6.tsx src/features/ui/v6/AppMenuBarV6.tsx src/features/ui/v6/CommandSurfaceControlV6.tsx src/features/ui/v6/ApplicationShellV6.tsx src/features/ui/v6/HeaderStatusV6.tsx src/styles/v6/components.css src/styles/v6/shell.css src/features/ui/v6/ui-primitives-v6.test.tsx src/features/ui/v6/command-surfaces-v6.test.tsx src/features/ui/v6/ApplicationShellV6.test.tsx
  git commit -m "fix(ui): stabilize V6 menus and dock controls"
  ```

### Task 2: Make Scene Visibility and Camera Framing Explicit

**Luna owner:** Viewport/scene lane. Do not edit `AppV6.tsx`; Task 6 owns composition.

**Files:**

- Create: `src/features/scene/v5/workcell-scene-presentation-v5.ts`
- Create: `src/features/scene/v5/workcell-scene-presentation-v5.test.ts`
- Modify: `src/features/scene/v5/V5WorkcellWorkspace.tsx`
- Modify: `src/features/scene/v5/V5WorkcellWorkspace.test.tsx`
- Modify: `src/features/viewport/v6/camera-controller-v6.ts`
- Modify: `src/features/viewport/v6/camera-controller-v6.test.ts`
- Modify: `src/styles/v6/viewport.css`

**Contract:** Add `WorkcellSceneBoundsV5 { center: readonly [number, number, number]; radius: number }`, `WorkcellSceneGeometrySampleV5 { key: string; selectionKey: string | null; worldCenter: readonly [number, number, number] | null; radius: number; issue: 'unresolved-world-pose' | null }`, and immutable `WorkcellScenePresentationV5 { state: 'ready' | 'empty' | 'degraded'; visibleGeometryCount: number; unresolvedPoseKeys: readonly string[]; visibleBounds: WorkcellSceneBoundsV5 | null; selectionBounds: WorkcellSceneBoundsV5 | null }`. Export `reduceWorkcellScenePresentationV5(samples, expectedVisibleGeometryCount, selectedKey)`.

`V5WorkcellCanvasProps` gains optional `cameraPose?: WorkcellCameraPoseV5`, `cameraVersion?: number`, and `onPresentationChange?: (value: WorkcellScenePresentationV5) => void`, where `WorkcellCameraPoseV5` has readonly position/target three-tuples and the synchronizer always applies fixed Z-up `[0, 0, 1]`. Existing callers retain the current camera through defaults. The canvas wrapper exposes the applied pose through `data-camera-position` and `data-camera-target`; the DOM render-state output uses `data-testid="v5-scene-presentation"`, `data-state`, and visible count/error text. These are operational diagnostics, not test-only branches. Internally, `WorldPoseGroup` receives `geometryKey`, `selectionKey`, `localCenter`, `radius`, and `onGeometrySample`; a null resolver result emits `issue: 'unresolved-world-pose'` for that stable key. Do not widen the private Project runtime resolver API.

Add `CameraSnapshotV6 { readonly position: readonly [number, number, number]; readonly target: readonly [number, number, number] }`; `CameraControllerV6` adds `snapshot(): CameraSnapshotV6`. Its existing mutable `CameraPointV6` option remains the single controller-owned pose; every successful command mutates that pose, invokes `update()` exactly once, and `snapshot()` returns frozen tuple copies. Task 6 owns that mutable pose in `AppV6.cameraPoseRef`, increments `cameraVersion` from `update()`, and passes `camera.snapshot()` to the V5 canvas synchronizer.

- [ ] **Step 1: Add red scene-presentation reducer tests**

  Test that resolved robot collision boxes plus the logical sample Part produce `ready`, a count greater than zero, and finite bounds; a missing pose produces `degraded` with the entity/frame key; no visible entities produces `empty`. Run:

  ```bash
  npm run test:run -- src/features/scene/v5/workcell-scene-presentation-v5.test.ts
  ```

  Expected: failure because the presentation module does not exist.

- [ ] **Step 2: Implement immutable scene presentation aggregation**

  Aggregate sample spheres into bounds. Use stable keys `robot:{robotId}:link:{linkId}:geometry:{occurrenceKey}` and `object:{entityId}`; use selection keys `robot:{robotId}` and `entity:{entityId}`. Deduplicate reports by geometry key and publish only when the immutable snapshot changes. Do not update React state on every animation frame when values are unchanged.

- [ ] **Step 3: Add red renderer visibility and diagnostic tests**

  Extend `V5WorkcellWorkspace.test.tsx` to assert that the NED2 collision-box occurrences and logical Part create visible proxy meshes; an asset occurrence without collision boxes creates a visible diagnostic wireframe; a null world pose reports a visible `degraded` message instead of leaving an unexplained axes-only view. Run:

  ```bash
  npm run test:run -- src/features/scene/v5/V5WorkcellWorkspace.test.tsx
  ```

  Expected: failures because geometry visibility and render state are not observable.

- [ ] **Step 4: Wire renderer reports and a visible render-state overlay**

  Keep collision boxes as the normal robot/asset fallback. Give geometry without boxes a clearly visible minimum-size wireframe and accessible label. Track null pose transitions in `WorldPoseGroup`; keep unresolved geometry hidden from false placement, but render a DOM status/error overlay listing the affected count and first stable key. Preserve axes/grid and selection behavior.

- [ ] **Step 5: Report unresolved poses at the renderer boundary**

  When the existing runtime resolver returns `null`, emit one `unresolved-world-pose` sample for the stable geometry key; when a later frame resolves, replace it with the current world-center sample. Preserve the resolver interface and all runtime stores. The overlay copy is `World pose unavailable for {key}. Geometry is hidden until runtime pose data recovers.`

- [ ] **Step 6: Add red camera snapshot/synchronization tests**

  Extend `camera-controller-v6.test.ts` so Fit All and Focus Selection move a readable camera snapshot to supplied bounds and leave it unchanged for `null`. Add a renderer test proving a changed `cameraVersion` applies position and target to the live Three camera/OrbitControls port. Run:

  ```bash
  npm run test:run -- src/features/viewport/v6/camera-controller-v6.test.ts src/features/scene/v5/V5WorkcellWorkspace.test.tsx
  ```

  Expected before implementation: no readable snapshot and no live camera synchronization.

- [ ] **Step 7: Implement the camera synchronization seam**

  Add a typed internal camera synchronizer using React Three Fiber `useThree`. On `cameraVersion`, copy the supplied position and target into the default perspective camera and OrbitControls, set camera up to fixed `[0, 0, 1]`, update the projection matrix, then call controls update. Do not use `as any`, ignored TypeScript errors, or a second Canvas.

- [ ] **Step 8: Verify and commit Task 2**

  ```bash
  npm run test:run -- src/features/scene/v5/workcell-scene-presentation-v5.test.ts src/features/scene/v5/V5WorkcellWorkspace.test.tsx src/features/viewport/v6/camera-controller-v6.test.ts
  npm run lint
  npm run build
  git add src/features/scene/v5/workcell-scene-presentation-v5.ts src/features/scene/v5/workcell-scene-presentation-v5.test.ts src/features/scene/v5/V5WorkcellWorkspace.tsx src/features/scene/v5/V5WorkcellWorkspace.test.tsx src/features/viewport/v6/camera-controller-v6.ts src/features/viewport/v6/camera-controller-v6.test.ts src/styles/v6/viewport.css
  git commit -m "fix(viewport): expose render state and camera framing"
  ```

### Task 3: Distinguish Offline Transport from Last-Known Connectivity

**Luna owner:** Connectivity lane.

**Files:**

- Modify: `src/features/runtime-gateway/runtime-gateway-status-poller.ts`
- Modify: `src/features/runtime-gateway/runtime-gateway-status-poller.test.ts`
- Modify: `src/features/connectivity/v5/connectivity-presentation-store.ts`
- Modify: `src/features/connectivity/v5/connectivity-presentation-store.test.ts`
- Modify: `src/features/connectivity/v5/connection-monitor-model.ts`
- Modify: `src/features/connectivity/v5/connection-monitor-model.test.ts`
- Modify: `src/features/connectivity/v5/ConnectionMonitorPanel.tsx`
- Modify: `src/features/connectivity/v5/ConnectionMonitorPanel.test.tsx`
- Modify only the Connection Monitor rules in: `src/styles/global.css`

**Contract:** `RuntimeGatewayStatusPollerV1` gains `pollNow(): void`; it clears a scheduled poll and starts immediately when demand is active and no request is in flight. `ConnectivityPresentationStoreV1` gains `refresh(): void`, implemented only as `poller.pollNow()`. It is a no-op while stopped and inherits the poller's no-overlap behavior.

`ConnectivityPresentationStateV1` gains `statusFreshness: 'current' | 'last-known' | 'unavailable'` and `transportErrorOccurredAtMs`. `ConnectionMonitorRowV1` gains `freshness` with the same closed values. For `last-known`, row `state` is exactly `Last known: {raw state}`, row `quality` is exactly `Last known: {raw quality}`, and the visible badge is exactly `Last known`. Current rows retain their raw state/quality and display `Current`; unavailable rows display `Unavailable`. Raw retained status remains intact; only its row presentation changes.

- [ ] **Step 1: Add red immediate-poll tests**

  Assert `pollNow()` starts immediately under header/monitor demand, does not overlap an in-flight request, and is a no-op when stopped. Run:

  ```bash
  npm run test:run -- src/features/runtime-gateway/runtime-gateway-status-poller.test.ts
  ```

  Expected: failure because `pollNow` is absent.

- [ ] **Step 2: Implement and expose read-only retry**

  Implement `pollNow()` in the poller and `refresh()` in `ConnectivityPresentationStoreV1`. `refresh()` calls only `poller.pollNow()`, which uses the existing GET snapshot reader; it must not call settings activation, endpoint lifecycle, or any OPC UA command path.

- [ ] **Step 3: Add red freshness projection tests**

  Extend store/model tests with success, transport failure, and recovery. After failure, assert Gateway header `Offline`, status freshness `last-known`, retained Gateway state `Last known: Online`, quality `Last known: GOOD`, visible freshness `Last known`, and unchanged original observation timestamp. After recovery, assert raw Online/GOOD plus visible freshness `Current`. Run:

  ```bash
  npm run test:run -- src/features/connectivity/v5/connectivity-presentation-store.test.ts src/features/connectivity/v5/connection-monitor-model.test.ts
  ```

  Expected: retained rows still report plain Online/GOOD.

- [ ] **Step 4: Implement typed freshness and readable row text**

  Capture the transport failure time from the store clock. Set every retained status/diagnostic row to `last-known`; keep the web-proxy error row current. Render the exact freshness badge and prefixed state/quality strings from the Contract in both table and compact cards. Keep detailed revision/config/diagnostic data available.

- [ ] **Step 5: Add red panel focus, Escape, live-region, and Retry tests**

  Extend `ConnectionMonitorPanel.test.tsx`: opening through the imperative control focuses the `Connection Monitor` heading; Escape closes and restores a connected opener; viewport controls remain focusable; stale transition is announced politely; `Retry now` calls only `store.refresh`; readable message is primary while code/time remain in details. Run:

  ```bash
  npm run test:run -- src/features/connectivity/v5/ConnectionMonitorPanel.test.tsx
  ```

- [ ] **Step 6: Implement modeless keyboard and recovery behavior**

  Give the heading `tabIndex={-1}` and focus it after mount/menu close. While open, listen for non-composing Escape, prevent default, close, clean up the listener, and restore only a connected opener. Add a polite atomic summary and a `Retry now` button. Do not add `aria-modal` or a focus trap.

- [ ] **Step 7: Verify and commit Task 3**

  ```bash
  npm run test:run -- src/features/runtime-gateway/runtime-gateway-status-poller.test.ts src/features/connectivity/v5/connectivity-presentation-store.test.ts src/features/connectivity/v5/connection-monitor-model.test.ts src/features/connectivity/v5/ConnectionMonitorPanel.test.tsx
  npm run lint
  npm run build
  git add src/features/runtime-gateway/runtime-gateway-status-poller.ts src/features/runtime-gateway/runtime-gateway-status-poller.test.ts src/features/connectivity/v5/connectivity-presentation-store.ts src/features/connectivity/v5/connectivity-presentation-store.test.ts src/features/connectivity/v5/connection-monitor-model.ts src/features/connectivity/v5/connection-monitor-model.test.ts src/features/connectivity/v5/ConnectionMonitorPanel.tsx src/features/connectivity/v5/ConnectionMonitorPanel.test.tsx src/styles/global.css
  git commit -m "fix(connectivity): label retained status after transport loss"
  ```

### Task 4: Make Job Failure and Editing Actions Recoverable

**Luna owner:** Jobs lane. Do not edit `ApplicationShellV6.tsx`, `shell.css`, or `AppV6.tsx`.

**Files:**

- Modify: `src/features/jobs/v6/RobotJobMonitorV6.tsx`
- Modify: `src/features/jobs/v6/RobotJobMonitorV6.test.tsx`
- Modify: `src/features/jobs/v6/RobotJobEditorDialogV6.tsx`
- Modify: `src/features/jobs/v6/RobotJobEditorDialogV6.test.tsx`
- Modify: `src/features/ui/v6/dialog-request-v6.ts`
- Create: `src/features/ui/v6/dialog-request-v6.test.ts`
- Modify: `src/app/v6/AppV6Dialogs.tsx`
- Modify: `src/styles/v6/jobs.css`

**Contract:** `RobotJobMonitorV6Props.onOpenEditor` becomes `(instructionId?: string) => void`. Export `RobotJobCompactStatusV6` with the same project/job/runtime inputs and no interactive child. The Job dialog request gains optional `instructionId`; `RobotJobEditorDialogV6` uses it as the initial selection when it belongs to the requested Job.

- [ ] **Step 1: Add red failure communication tests**

  Add a FAILED fixture with `WaitDI instruction wait-part-present timed out.` Assert a visible state badge, the entire message, an atomic polite status summary, `Inspect failed step`, and `Retry Job`. Assert Retry calls only `playback.startJob(job.id)` and inspection emits the current instruction ID. Run:

  ```bash
  npm run test:run -- src/features/jobs/v6/RobotJobMonitorV6.test.tsx
  ```

  Expected: failures for badge, full/live summary, dynamic actions, and instruction ID.

- [ ] **Step 2: Implement Job status semantics and recovery actions**

  Remove the shared nowrap/ellipsis rule from Summary and Message. Add state-specific data attributes and text, a screen-reader announcement that includes state/step/message, dynamic `Start Job`/`Retry Job`, and `Inspect failed step` only when a failed instruction exists. Preserve Start/Cancel playback ownership and the existing step-list announcement/follow behavior.

- [ ] **Step 3: Add red compact-status tests**

  Test `RobotJobCompactStatusV6` for IDLE, RUNNING, FAILED, CANCELLED, and no-runtime states. FAILED output must include `Job Monitor`, `FAILED`, current step, and a concise message while its accessible label retains the full message.

- [ ] **Step 4: Add red editor selection/grouping tests**

  Extend dialog-request and editor tests so `instructionId` opens the failed step, an invalid ID falls back to the first step, each instruction-kind fieldset has a legend, and mutation actions are grouped under an accessible `Step actions` label. Keep the running read-only behavior and modal focus restoration tests unchanged. Run:

  ```bash
  npm run test:run -- src/features/ui/v6/dialog-request-v6.test.ts src/features/jobs/v6/RobotJobEditorDialogV6.test.tsx
  ```

- [ ] **Step 5: Recompose the dense editor without changing services**

  Use semantic fieldsets for instruction kind/details and a labelled action group. Add consistent grid gaps, responsive single-column flow, and a sticky inspector heading/action area only where it does not create horizontal overflow. Do not change `job-authoring-service-v6.ts` or `ModalDialogV6.tsx`.

- [ ] **Step 6: Pass the requested instruction through `AppV6Dialogs`**

  Forward `dialog.instructionId` into `RobotJobEditorDialogV6`. Keep dialog parentage, close behavior, and trigger focus restoration intact.

- [ ] **Step 7: Verify and commit Task 4**

  ```bash
  npm run test:run -- src/features/jobs/v6/RobotJobMonitorV6.test.tsx src/features/jobs/v6/RobotJobEditorDialogV6.test.tsx src/features/ui/v6/dialog-request-v6.test.ts
  npm run lint
  npm run build
  git add src/features/jobs/v6/RobotJobMonitorV6.tsx src/features/jobs/v6/RobotJobMonitorV6.test.tsx src/features/jobs/v6/RobotJobEditorDialogV6.tsx src/features/jobs/v6/RobotJobEditorDialogV6.test.tsx src/features/ui/v6/dialog-request-v6.ts src/features/ui/v6/dialog-request-v6.test.ts src/app/v6/AppV6Dialogs.tsx src/styles/v6/jobs.css
  git commit -m "fix(jobs): expose failure recovery and compact status"
  ```

### Task 5: Disable No-Op OPC UA Apply

**Luna owner:** Settings lane.

**Files:**

- Modify: `src/features/connectivity/v5/OpcUaSettingsDialog.tsx`
- Modify: `src/features/connectivity/v5/OpcUaSettingsDialog.test.tsx`

**Contract:** Compute `changedSections` once per render from the current draft and active Project. `canApply = !busy && changedSections > 0`. The same count drives the summary, submit disabled state, helper text, and the function-level guard.

- [ ] **Step 1: Add red unchanged-draft tests**

  Open an unchanged draft and assert `Changed sections` is 0, `Apply & Activate` is disabled, `No changes to apply.` is visible and referenced by the button, and direct form submission does not call `applyAndActivate`. Update the Test Connection case so diagnostics alone leave Apply disabled. Run:

  ```bash
  npm run test:run -- src/features/connectivity/v5/OpcUaSettingsDialog.test.tsx
  ```

  Expected: the unchanged Apply button is enabled.

- [ ] **Step 2: Add red changed/busy transition tests**

  Change one OPC UA role/endpoint/route field and assert count 1 plus enabled Apply; revert it and assert count 0 plus disabled Apply; preserve existing busy coalescing, rejection, retained draft, validation focus, and trigger-focus tests.

- [ ] **Step 3: Implement one authoritative dirty gate**

  Store `changedSections = changedSectionCount(draft, activeProject)`, derive `canApply`, guard `apply()` before touching `applyInFlightRef`, and connect helper text through `aria-describedby`. Do not alter settings controller validation or activation behavior for a changed draft.

- [ ] **Step 4: Verify and commit Task 5**

  ```bash
  npm run test:run -- src/features/connectivity/v5/OpcUaSettingsDialog.test.tsx
  npm run lint
  npm run build
  git add src/features/connectivity/v5/OpcUaSettingsDialog.tsx src/features/connectivity/v5/OpcUaSettingsDialog.test.tsx
  git commit -m "fix(connectivity): guard unchanged OPC UA settings"
  ```

### Task 6: Compose the Lanes and Add Browser Acceptance

**Luna owner:** Fresh integration lane after Tasks 1-5 and their reviews are accepted.

**Files:**

- Modify: `src/app/v6/AppV6.tsx`
- Modify: `src/app/v6/AppV6.test.tsx`
- Modify: `tests/ui-v6-shell.spec.ts`
- Modify: `tests/ui-v6-scene.spec.ts`
- Modify: `tests/ui-v6-jobs.spec.ts`
- Modify: `tests/ui-v6-connectivity.spec.ts`
- Modify: `tests/ui-v6-accessibility.spec.ts`
- Modify only if shared setup is required: `tests/ui-v6-fixtures.ts`
- Modify only integration selectors/rules if required: `src/styles/v6/shell.css`, `src/styles/v6/viewport.css`

- [ ] **Step 1: Add red `AppV6` composition tests**

  Assert `AppV6` passes scene presentation into camera bounds, applies the first valid Fit All after Project/runtime epoch activation, forwards the failed instruction ID into the Job dialog, and supplies `RobotJobCompactStatusV6` through `ApplicationShellV6.bottomStatus`. Run:

  ```bash
  npm run test:run -- src/app/v6/AppV6.test.tsx
  ```

- [ ] **Step 2: Wire live scene bounds and the real Three camera**

  Hold the mutable camera position/target and latest immutable scene presentation in refs. Pass `cameraPose`, `cameraVersion`, and `onPresentationChange` to `V5WorkcellCanvas`; have camera controller bounds callbacks read the latest presentation. Auto-fit once when a new Project revision/runtime epoch first reports finite visible bounds. Do not reset camera on ordinary polls, selection changes, dock changes, or menu actions.

- [ ] **Step 3: Wire failed-step inspection and compact Job status**

  Pass the current instruction ID from `RobotJobMonitorV6.onOpenEditor` into the `job-editor` request. Render `RobotJobCompactStatusV6` in `bottomStatus`; clicking the existing Job Monitor dock toggle opens the hidden dock/sheet. Avoid nested buttons.

- [ ] **Step 4: Add red menu layout and target-size Playwright assertions**

  In `ui-v6-shell.spec.ts`, record header bounding box before and after opening Project; assert equal height, visible floating menu, and at least 32px width/height for top-level menu and dock controls at 1712x1368 and 1024x768.

- [ ] **Step 5: Add red scene recovery Playwright assertions**

  In `ui-v6-scene.spec.ts`, load the demo and assert the render-state output reports at least one robot proxy and the Part, then activate Fit All and observe a changed camera snapshot/test ID. The `unresolved-world-pose` branch remains covered by the reducer and renderer component tests; do not add a production-only browser test hook. Do not rely on pixel comparison as the only assertion.

- [ ] **Step 6: Add red Job and Settings Playwright assertions**

  In `ui-v6-jobs.spec.ts`, run the logical demo to its deterministic WaitDI timeout; assert FAILED, full timeout text, polite summary, Retry Job, Inspect failed step, and the same failure context in the 1024x768 collapsed dock toggle. Open the editor and assert the failed instruction is selected. In `ui-v6-connectivity.spec.ts`, open unchanged Settings and assert Apply disabled; change one field, assert enabled, then Cancel. Do not activate a new settings draft in this added scenario.

- [ ] **Step 7: Add red offline/focus Playwright assertions**

  Route `**/runtime/status` normally until a current snapshot is displayed, then toggle the route to `abort('failed')`. Open Connection Monitor, assert heading focus, trigger `Retry now`, then assert Offline plus visible Last known state/quality and no unqualified Online/GOOD retained row. Record requests during Retry and assert every new request is GET to `/runtime/status` or `/runtime/integration-diagnostics`; assert no POST/PUT/PATCH/DELETE, settings activation, or endpoint lifecycle request. Press Escape and assert the Connectivity menu trigger regains focus.

- [ ] **Step 8: Keep accessibility acceptance explicit**

  Extend `ui-v6-accessibility.spec.ts` at 1024x768 and body zoom 2 to cover menu/dock target semantics, monitor focus/Escape, Job FAILED live text, Settings disabled explanation, no horizontal overflow, and zero serious/critical axe violations. Retain reduced-motion compatibility.

- [ ] **Step 9: Run focused integration acceptance**

  ```bash
  npm run test:run -- src/app/v6 src/features/ui/v6 src/features/scene/v5 src/features/viewport/v6 src/features/jobs/v6 src/features/connectivity/v5 src/features/runtime-gateway/runtime-gateway-status-poller.test.ts
  npm run lint
  npm run build:gateway
  node dist-gateway/middleware/runtime-gateway/main.js --check-config
  npm run build
  npm run test:e2e:v6
  ```

  Expected: all commands exit 0; Playwright remains serial with one worker and owns ports 8081/4173.

- [ ] **Step 10: Commit Task 6 narrowly**

  ```bash
  git add src/app/v6/AppV6.tsx src/app/v6/AppV6.test.tsx tests/ui-v6-shell.spec.ts tests/ui-v6-scene.spec.ts tests/ui-v6-jobs.spec.ts tests/ui-v6-connectivity.spec.ts tests/ui-v6-accessibility.spec.ts tests/ui-v6-fixtures.ts src/styles/v6/shell.css src/styles/v6/viewport.css
  git diff --cached --name-only
  git commit -m "test(ui): prove V6 UX recovery flows"
  ```

  Compare the staged-name output to the Task 6 Files list and unstage any path not owned by this task before committing.

### Task 7: Final Root Verification and Manual QA Gate

**Owner:** Root agent. Luna may execute capture scenarios, but root must inspect the final diff, command results, and observable artifacts.

- [ ] **Step 1: Verify branch and intended diff**

  ```bash
  git branch --show-current
  git log --oneline --decorate -7
  git status --short
  git diff e1ec66c9ff83a69e8a726c55dcc248b80a3c2097...HEAD --stat
  git diff --check e1ec66c9ff83a69e8a726c55dcc248b80a3c2097...HEAD
  ```

  Expected: only planned files plus the pre-existing untracked `.omo/`; no whitespace errors.

- [ ] **Step 2: Run Codex UI verification and full verification**

  ```bash
  npm run --silent verify:codex -- --scope ui --json
  npm run verify
  ```

  Expected: exit 0, lint with 0 warnings/errors, all Vitest/validation/build/Gateway config checks pass, and all V6 Playwright scenarios pass. Do not run Playwright concurrently with another Gateway or preview process.

- [ ] **Step 3: Create the exact evidence directory and capture desktop manual QA**

  ```bash
  SHORT_SHA="$(git rev-parse --short HEAD)"
  UTCSTAMP="$(date -u +%Y%m%dT%H%M%SZ)"
  QA_DIR="artifacts/qa/${SHORT_SHA}/ui-v6-${UTCSTAMP}"
  mkdir -p "${QA_DIR}/desktop" "${QA_DIR}/compact" "${QA_DIR}/offline"
  ```

  At 1712x1368, capture `desktop/01-project-menu.png`, `desktop/02-scene-fit-all.png`, `desktop/03-job-failed.png`, `desktop/04-job-editor.png`, `desktop/05-settings-unchanged.png`, `desktop/06-settings-changed.png`, and `desktop/07-monitor-online.png`. Record evidence in `${QA_DIR}/manual-qa.json` with the exact shape `{ "sha": "...", "utcStamp": "...", "scenarios": [{ "id": "...", "viewport": "1712x1368", "expected": "...", "observed": "...", "verdict": "pass", "screenshot": "desktop/01-project-menu.png" }], "retryRequests": [] }`; later steps append scenarios and `{ "method": "GET", "path": "/runtime/status" }` request records.

- [ ] **Step 4: Capture compact/accessibility manual QA**

  At 1024x768 and 200% zoom, capture `compact/01-job-failed-dock.png`, `compact/02-menu-targets.png`, `compact/03-editor-no-overflow.png`, `compact/04-settings-helper.png`, and `compact/05-monitor-focus-restored.png`; save axe output as `compact/axe-results.json`. Verify keyboard-only Project, Connectivity, Job, and dialog flows and reduced-motion behavior, and append results to `${QA_DIR}/manual-qa.json`.

- [ ] **Step 5: Capture offline recovery without external writes**

  Use Playwright route failure; do not stop or reconfigure any user Gateway. Capture `offline/01-last-known.png` and `offline/02-recovered-current.png`. Confirm header Offline, retained rows visibly Last known, Retry performs only the two allowed GET reads, and recovery returns rows to Current. Do not change saved Project configuration or endpoint ownership; append the request-method evidence to `${QA_DIR}/manual-qa.json`.

- [ ] **Step 6: Reconcile findings and declare completion**

  Record exact command counts, final SHA, artifact paths, and any pre-existing unrelated issues. Completion requires all seven audit rows in the traceability table to have automated and manual evidence; a green build without observable desktop/compact/offline behavior is insufficient.

## Final Acceptance Checklist

- [ ] Opening every menu leaves header height unchanged and menu keyboard behavior remains correct.
- [ ] Shared V6 buttons are visibly consistent, keyboard-focused, and at least 32px.
- [ ] The demo exposes visible NED2/Part proxy geometry; a missing pose produces an explicit degraded state.
- [ ] Fit All and Focus Selection change the actual Three camera, not only controller state.
- [ ] Offline transport never presents retained runtime rows as current Online/GOOD.
- [ ] Connection Monitor focuses on open, remains modeless, closes on Escape, and restores the opener.
- [ ] FAILED Job text is complete, announced, recoverable, and retained in compact mode.
- [ ] Job Editor fields/actions are grouped and remain keyboard-operable without overflow.
- [ ] Apply & Activate cannot run with Changed sections 0 and enables after a real draft change.
- [ ] Project V5 persistence and Runtime Gateway ownership/publication invariants remain unchanged.
- [ ] Targeted tests, lint, build, Gateway config, V6 E2E, full `npm run verify`, and manual QA all pass.
