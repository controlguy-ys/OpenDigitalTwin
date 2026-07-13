# Mode Workspace and Release Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the crowded single-screen workspace with four explicit engineering lenses (BUILD, SIMULATE, CONNECT, and VALIDATE), then integrate Assembly Import, Simulation Jobs, Primitive Objects, and OPC UA Equipment Transform into one accessible, release-verified UI.

**Architecture:** Workspace Mode is a transient presentation router, not a Robot source, ownership state, playback command, or Project field. Stage A introduces the Mode contract and routes only currently working actions into a stable Explorer/Viewport/Inspector/Dock shell. Stage B begins only after the four feature workstreams pass independently, then connects their public panels without duplicating domain state or silently changing Robot source, external-transform ownership, Job playback, selection, grasp, or collision state.

**Tech Stack:** React 19, TypeScript 6, Zustand 5, Three.js/R3F, Lucide React, CSS, Vitest 4, Testing Library, user-event, Playwright 1.61.

## Global Constraints

- Start Stage A only after `2026-07-13-project-v3-foundation.md` is complete and reviewed.
- Start Stage B only after the independently reviewed Assembly Import, Simulation Jobs, Primitive Objects, and OPC UA Equipment Transform/Smoothing plans are complete.
- Stage A owns only shell/navigation composition and consumes current feature panels unchanged. It must not edit child-workstream-owned Wizard, Primitive, Timeline/Job, Equipment Transform, or Collision panel internals.
- The only Workspace Modes are `BUILD`, `SIMULATE`, `CONNECT`, and `VALIDATE`. Exactly one is active.
- Workspace Mode starts as `BUILD` on each page load and is memory-only. Do not store it in ProjectDB, `.wdtwin`, localStorage, sessionStorage, URL state, or the OPC UA gateway.
- Changing Workspace Mode changes visible navigation and panels only. It must not connect/disconnect a source, switch Simulation/OPC UA ownership, start/pause/resume/stop playback, change Joint angles, apply/discard a transform, release a held Object, clear selection, or run/cancel validation.
- A dirty Manual preview blocks navigation until the operator explicitly chooses Apply, Discard, or Stay. Apply must succeed before navigation; Discard restores the committed transform; Stay keeps the current Mode and focus.
- Mode is distinct from `Joint source`. The global header shows them as separately labeled states and never combines hard-coded `SIMULATION` text with an OPC UA quality badge.
- External Transform source and numeric Status source remain independent. Ownership badges always include text and iconography; color is supplementary.
- BUILD owns Robot/Object creation, Geometry/Mechanical/Frame configuration, and Manual placement.
- SIMULATE owns manual Joints, gripper interaction, active Job editing, Timeline, and Job playback.
- CONNECT owns Joint source selection, gateway/Profile selection, numeric Status Binding, Equipment/Object Transform Binding, and live quality diagnostics.
- VALIDATE owns current-pose collision, active-Job Preview/Validate, findings, ignore/restore policy, navigation, and reports.
- Project controls and project busy/recovery state remain global. Mutation actions are disabled during Project preparation/publication and `recovery-required` blocks the entire workspace except reload guidance.
- A running or paused Job keeps its immutable playback session when the operator changes Mode. Outside SIMULATE, show one compact global activity row with `Go to Simulate`; show `Stop Job` there only when no other visible Stop control exists.
- Do not render inert placeholders. Stage A shows only working current features; Stage B mounts a feature only after its public interface and tests pass.
- Preserve one authoritative action owner. Do not show duplicate persistent Import, Save Pose, Play, Stop, Binding Apply, Validate, or report-download controls in two panels at once.
- Desktop reference viewport is `1440 x 900`. Narrow reference viewport is `768 x 1024`. The responsive breakpoint remains `< 960px`.
- At desktop widths, icon-only controls are at least `32 x 32 CSS px`; at narrow widths, every interactive target is at least `44 x 44 CSS px`. Normal text contrast is at least `4.5:1`, non-text UI/focus contrast at least `3:1`, and the visible focus indicator is at least `2 CSS px`.
- All four Modes, drawers, tabs, Job actions, Binding controls, findings, and dialogs are operable by keyboard with deterministic focus return. No state is communicated by color alone.
- Preserve the current single-Worker Playwright setting for OCCT-heavy browser tests.
- Keep source comments in English and preserve unrelated user changes.
- This plan authorizes no PLC write, OPC UA write, method call, command, transfer, restart, or deployment to a controller.

## Existing Plan Disposition

| Existing plan | Disposition |
|---|---|
| Baseline Tasks 10-12 in `2026-07-10-crb15000-web-simulation.md` | Superseded by this plan; retain its responsive, keyboard, visual, E2E, license, and audit requirements as regression criteria. |
| `2026-07-11-pose-sequence-speed-ordering.md` | Superseded by Simulation Jobs; consume Job interfaces only. |
| `2026-07-11-frame-graph-manual-coordinates.md` | Future generic Frame phase; do not expose its unavailable actions. |
| `2026-07-11-generic-robot-import-mechanical-configuration.md` | Future Generic Robot phase; Stage B consumes only the fixed assembly Wizard. |
| `2026-07-11-opcua-joint-source-gateway.md` | Partially realized; CONNECT shows the current fixed Robot Joint source plus the new external Transform flow. |
| Portable Project, fixed Frames, Docker, and Geometry Collision plans | Completed baselines; expose and regression-test rather than reimplement. |

## Locked File Map

```text
src/features/workspace/workspace-mode.ts                 # Mode/capability/activity contracts
src/features/workspace/workspace-mode.test.ts
src/features/workspace/workspace-mode-store.ts           # transient active Mode only
src/features/workspace/workspace-mode-store.test.ts
src/features/workspace/workspace-navigation-guard.ts      # Apply/Discard/Stay draft gate
src/features/workspace/workspace-navigation-guard.test.ts
src/features/workspace/WorkspaceModeBar.tsx
src/features/workspace/WorkspaceModeBar.test.tsx
src/features/workspace/WorkspaceActivityRow.tsx
src/features/workspace/WorkspaceActivityRow.test.tsx
src/features/workspace/WorkspaceRouter.tsx
src/features/workspace/WorkspaceRouter.test.tsx
src/features/ui/SceneExplorer.tsx
src/features/ui/SceneExplorer.test.tsx
src/features/ui/ContextInspector.tsx
src/features/ui/ContextInspector.test.tsx
src/features/ui/BottomDock.tsx
src/features/ui/BottomDock.test.tsx
src/features/joints/JointSourcePanel.tsx
src/features/joints/JointSourcePanel.test.tsx
src/app/AppShell.tsx
src/app/AppShell.test.tsx
src/app/App.tsx
src/styles/tokens.css
src/styles/global.css
src/styles/workspace.css

# Stage B interfaces produced by the four independent feature plans
src/features/robot/assembly/RobotAssemblyWizard.tsx
src/features/objects/PrimitiveObjectDialog.tsx
src/features/objects/primitive-object-integration.ts
src/features/jobs/JobToolbar.tsx
src/features/jobs/SimulationJobRuntimeBridge.tsx
src/features/ui/Timeline.tsx
src/features/opcua/OpcUaGatewayClient.ts
src/features/equipment/equipment-transform-store.ts
src/features/equipment/OpcUaTransformBindingPanel.tsx
src/features/collision/CollisionPanel.tsx

# Stage B composition owned by this plan
src/features/objects/AddObjectMenu.tsx
src/features/objects/AddObjectMenu.test.tsx

src/test/debug-bridge.ts
src/test/debug-bridge.test.ts
tests/mode-workspace.spec.ts
tests/mode-workspace-visual.spec.ts
tests/robot-assembly-import.spec.ts
tests/simulation-jobs.spec.ts
tests/primitive-object-workflow.spec.ts
tests/opcua-transform-smoothing.spec.ts
docs/operator/workspace-modes.md
docs/verification/mode-workspace-release.md
docs/progress/2026-07-13-project-status.md
README.md
```

---

### Task 1: Define Transient Mode, Capability, Activity, and Navigation Contracts

**Files:**
- Create: `src/features/workspace/workspace-mode.ts`
- Create: `src/features/workspace/workspace-mode.test.ts`
- Create: `src/features/workspace/workspace-mode-store.ts`
- Create: `src/features/workspace/workspace-mode-store.test.ts`
- Create: `src/features/workspace/workspace-navigation-guard.ts`
- Create: `src/features/workspace/workspace-navigation-guard.test.ts`

**Interfaces:**
- Consumes: read-only source/playback/selection/project status snapshots and existing Manual preview Apply/Cancel commands.
- Produces: `WorkspaceMode`, `WORKSPACE_MODE_DEFINITIONS`, `WorkspaceCapability`, `WorkspaceActivitySnapshot`, `useWorkspaceModeStore`, and `requestWorkspaceModeChange()`.

- [ ] **Step 1: Write pure contract RED tests**

```ts
it('exposes exactly four ordered Modes and one capability owner', () => {
  expect(WORKSPACE_MODE_DEFINITIONS.map(({ id }) => id)).toEqual([
    'build', 'simulate', 'connect', 'validate',
  ])
  expect(modeForCapability('robot-import')).toBe('build')
  expect(modeForCapability('job-playback')).toBe('simulate')
  expect(modeForCapability('transform-binding')).toBe('connect')
  expect(modeForCapability('job-validation')).toBe('validate')
})

it('changes Mode without touching source, playback, selection, or held state', () => {
  const runtime = runtimeSpies({ sourceMode: 'opcua', playback: 'paused', selectedId: 'object:1', heldId: 'object:2' })
  const store = createWorkspaceModeStore()
  store.getState().setMode('validate')
  expect(store.getState().activeMode).toBe('validate')
  expect(runtime.allMutationSpies()).not.toHaveBeenCalled()
})

it.each(['apply', 'discard', 'stay'] as const)('resolves a dirty preview through explicit %s', async (choice) => {
  const result = await requestWorkspaceModeChange('connect', dirtyPreviewDependencies(choice))
  expect(result).toMatchObject({ choice, changed: choice !== 'stay' })
})
```

- [ ] **Step 2: Run RED**

Run: `npm run test:run -- src/features/workspace/workspace-mode.test.ts src/features/workspace/workspace-mode-store.test.ts src/features/workspace/workspace-navigation-guard.test.ts`

Expected: FAIL because the workspace domain does not exist.

- [ ] **Step 3: Implement the exact Mode and capability map**

```ts
export type WorkspaceMode = 'build' | 'simulate' | 'connect' | 'validate'

export type WorkspaceCapability =
  | 'robot-import' | 'object-add' | 'frame-edit' | 'manual-placement'
  | 'joint-jog' | 'gripper' | 'job-edit' | 'job-playback'
  | 'joint-source' | 'status-binding' | 'transform-binding' | 'connection-diagnostics'
  | 'current-collision' | 'job-validation' | 'collision-policy' | 'collision-report'

export const WORKSPACE_MODE_DEFINITIONS = Object.freeze([
  { id: 'build', label: 'BUILD', capabilities: ['robot-import', 'object-add', 'frame-edit', 'manual-placement'] },
  { id: 'simulate', label: 'SIMULATE', capabilities: ['joint-jog', 'gripper', 'job-edit', 'job-playback'] },
  { id: 'connect', label: 'CONNECT', capabilities: ['joint-source', 'status-binding', 'transform-binding', 'connection-diagnostics'] },
  { id: 'validate', label: 'VALIDATE', capabilities: ['current-collision', 'job-validation', 'collision-policy', 'collision-report'] },
] as const)
```

The Zustand store owns only `activeMode` and `setMode()`, initializes to `build`, and has no persistence middleware. The activity snapshot is read-only and contains Project busy/recovery, Joint source/quality, active Job/playback, selected external-entity ownership/quality, active validation, and dirty-preview flags.

- [ ] **Step 4: Implement the explicit draft navigation guard**

`requestWorkspaceModeChange()` changes immediately when no draft exists. For a dirty draft, it requests one `apply | discard | stay` decision. Apply awaits the authoritative feature command and stays in the current Mode on rejection. Discard invokes the authoritative Cancel command before changing. Stay changes nothing. A newer navigation request invalidates an older dialog result.

- [ ] **Step 5: Run GREEN and transient-state proof**

Run: `npm run test:run -- src/features/workspace`

Expected: PASS; no test observes storage, source, playback, Joint, selection, grasp, validation, or Project writes from a plain Mode change.

- [ ] **Step 6: Commit**

```powershell
git add src/features/workspace
git diff --cached --check
git commit -m "feat: define transient workspace modes"
```

---

### Task 2: Build the Stage A Mode Shell and Global State Language

**Files:**
- Create: `src/features/workspace/WorkspaceModeBar.tsx`
- Create: `src/features/workspace/WorkspaceModeBar.test.tsx`
- Create: `src/features/workspace/WorkspaceActivityRow.tsx`
- Create: `src/features/workspace/WorkspaceActivityRow.test.tsx`
- Create: `src/features/ui/SceneExplorer.tsx`
- Create: `src/features/ui/SceneExplorer.test.tsx`
- Create: `src/features/ui/ContextInspector.tsx`
- Create: `src/features/ui/ContextInspector.test.tsx`
- Create: `src/features/ui/BottomDock.tsx`
- Create: `src/features/ui/BottomDock.test.tsx`
- Modify: `src/app/AppShell.tsx`
- Modify: `src/app/AppShell.test.tsx`
- Modify: `src/styles/tokens.css`
- Create: `src/styles/workspace.css`

**Interfaces:**
- Consumes: Task 1 Mode definitions/store/activity snapshot and existing ProjectMenu.
- Produces: four-tab Mode navigation, separate source/quality/activity language, and stable Explorer/Viewport/Inspector/Dock regions.

- [ ] **Step 1: Write shell RED tests**

```tsx
it('renders four Modes and labels Workspace separately from Joint source', async () => {
  renderShell({ mode: 'build', sourceMode: 'opcua', sourceQuality: 'GOOD' })
  expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual([
    'BUILD', 'SIMULATE', 'CONNECT', 'VALIDATE',
  ])
  expect(screen.getByLabelText('Workspace mode')).toHaveTextContent('BUILD')
  expect(screen.getByLabelText('Joint source status')).toHaveTextContent('OPC UA')
  expect(screen.getByLabelText('Joint source status')).toHaveTextContent('GOOD')
  expect(screen.queryByText(/^SIMULATION$/)).not.toBeInTheDocument()
})

it('shows one outside-Simulate activity route without stopping the Job', async () => {
  renderShell({ mode: 'validate', playback: 'playing' })
  await user.click(screen.getByRole('button', { name: 'Go to Simulate' }))
  expect(setMode).toHaveBeenCalledWith('simulate')
  expect(stopPlayback).not.toHaveBeenCalled()
})
```

- [ ] **Step 2: Run RED**

Run: `npm run test:run -- src/features/workspace/WorkspaceModeBar.test.tsx src/features/workspace/WorkspaceActivityRow.test.tsx src/features/ui src/app/AppShell.test.tsx`

Expected: FAIL because the current top bar hard-codes Simulation and combines all actions in one shell.

- [ ] **Step 3: Implement stable semantic regions**

Use `role="tablist"` for Mode navigation and one selected tab with roving keyboard focus. Keep Project controls global. The header order is Project, Workspace Mode, Joint source/quality, selected external ownership/quality when relevant, Project state. Remove Robot/Object/Frame action buttons from the global header; their working actions move into the appropriate routed panel in Task 3.

Render one left Scene Explorer, central Viewport, right Context Inspector, and bottom Dock. Region labels remain stable across Modes so assistive technology does not encounter a new page structure on each switch.

- [ ] **Step 4: Implement conditional activity ownership**

When playback is active outside SIMULATE, render Job name, Playing/Paused, elapsed/total time, and `Go to Simulate`. Render `Stop Job` only if the SIMULATE Timeline Stop control is not visible. When Project status is busy, show one progress state. When status is `recovery-required`, replace all content with reload guidance and retain no mutation control.

- [ ] **Step 5: Verify shell behavior and styling tokens**

Run:

```powershell
npm run test:run -- src/features/workspace src/features/ui src/app/AppShell.test.tsx
npm run lint
npm run build
```

Expected: PASS; Mode selection is visible by the next React commit, no source/playback command fires, header labels are unambiguous, and build succeeds.

- [ ] **Step 6: Commit**

```powershell
git add src/features/workspace src/features/ui src/app/AppShell.tsx src/app/AppShell.test.tsx src/styles/tokens.css src/styles/workspace.css
git diff --cached --check
git commit -m "feat: add mode-based workspace shell"
```

---

### Task 3: Route All Existing Working Features Through Stage A

**Files:**
- Create: `src/features/workspace/WorkspaceRouter.tsx`
- Create: `src/features/workspace/WorkspaceRouter.test.tsx`
- Create: `src/features/joints/JointSourcePanel.tsx`
- Create: `src/features/joints/JointSourcePanel.test.tsx`
- Modify: `src/app/App.tsx`
- Modify: `src/app/AppShell.test.tsx`
- Consume: `src/features/equipment/EquipmentAssetList.tsx`
- Consume: `src/features/equipment/EquipmentInspector.tsx`
- Consume: `src/features/ui/Timeline.tsx`
- Consume: `src/features/collision/CollisionPanel.tsx`
- Test: existing component tests for the four consumed panels
- Modify: `src/styles/global.css`
- Modify: `src/styles/workspace.css`

**Interfaces:**
- Consumes: Stage A shell, current imports/configuration/frames, flat Timeline, Joint source, numeric Status, Equipment Inspector, and CollisionPanel.
- Produces: a complete non-inert Stage A workspace before any new feature component is mounted.

- [ ] **Step 1: Write route ownership RED tests**

```tsx
it.each([
  ['build', ['Import Robot', 'Add STEP Object', 'Coordinate Frames']],
  ['simulate', ['Joint controls', 'Timeline']],
  ['connect', ['Joint source', 'Numeric status source']],
  ['validate', ['Collision', 'Validate Sequence']],
] as const)('routes existing actions to %s only', (mode, visibleNames) => {
  renderWorkspace(mode)
  for (const name of visibleNames) expect(screen.getByText(name)).toBeVisible()
  expect(primaryActionDuplicates()).toEqual([])
})

it('retains the selected entity while switching every Mode', async () => {
  renderWorkspace('build', { selectedEntityId: 'object:object-1' })
  for (const mode of ['simulate', 'connect', 'validate', 'build'] as const) {
    await selectMode(mode)
    expect(readSelectedEntityId()).toBe('object:object-1')
  }
})
```

- [ ] **Step 2: Run RED**

Run: `npm run test:run -- src/features/workspace/WorkspaceRouter.test.tsx src/features/joints/JointSourcePanel.test.tsx src/app src/features/equipment src/features/ui src/features/collision`

Expected: FAIL because all actions currently share the top bar/Inspector/bottom rail.

- [ ] **Step 3: Route BUILD and SIMULATE current capabilities**

BUILD exposes the current Robot Import, single-Link replacement, Robot Configuration, Robot Geometry, Object STEP Import, fixed Coordinate Frames, Scene Explorer, and Manual transform Inspector. SIMULATE exposes Joint controls, Home/Reset, gripper, current flat Pose Timeline, and playback. Keep Manual fields visible but read-only with an ownership reason when OPC UA owns their data.

- [ ] **Step 4: Route CONNECT and VALIDATE current capabilities**

Move the Simulation/OPC UA Joint source selector into `JointSourcePanel`; show endpoint/quality and existing numeric Equipment Status source without inventing Transform Binding UI. VALIDATE owns CollisionPanel, policy, current findings, sequence Preview/Validate, navigation, and reports. Show the non-safety disclaimer in VALIDATE.

- [ ] **Step 5: Implement Stage A responsive and keyboard behavior**

At `>= 960px`, keep the fixed Explorer and Inspector with the Dock below the Viewport. At `< 960px`, use mutually exclusive left/right drawers and one bottom sheet; opening one closes the other overlapping panel and returns focus to its trigger on close. Preserve Mode tabs, global activity, and viewport access with no horizontal document overflow at both reference sizes.

Run:

```powershell
npm run test:run -- src/features/workspace src/app src/features/equipment src/features/joints src/features/ui src/features/collision
npm run lint
npm run build
```

Expected: PASS with no inert or duplicate actions and no regression in current feature tests.

- [ ] **Step 6: Commit**

```powershell
git add src/features/workspace/WorkspaceRouter.tsx src/features/workspace/WorkspaceRouter.test.tsx src/features/joints/JointSourcePanel.tsx src/features/joints/JointSourcePanel.test.tsx src/app/App.tsx src/app/AppShell.test.tsx src/styles/global.css src/styles/workspace.css
git diff --cached --check
git commit -m "feat: route current tools by workspace mode"
```

---

### Task 4: Integrate BUILD and SIMULATE Feature Workstreams

**Files:**
- Modify: `src/features/workspace/WorkspaceRouter.tsx`
- Modify: `src/features/workspace/WorkspaceRouter.test.tsx`
- Modify: `src/features/ui/SceneExplorer.tsx`
- Modify: `src/features/ui/SceneExplorer.test.tsx`
- Modify: `src/features/ui/ContextInspector.tsx`
- Modify: `src/features/ui/ContextInspector.test.tsx`
- Modify: `src/app/App.tsx`
- Create: `src/features/objects/AddObjectMenu.tsx`
- Create: `src/features/objects/AddObjectMenu.test.tsx`
- Consume: `src/features/robot/assembly/RobotAssemblyWizard.tsx`
- Consume: `src/features/objects/PrimitiveObjectDialog.tsx`
- Consume: `src/features/objects/primitive-object-integration.ts`
- Consume: `src/features/jobs/JobToolbar.tsx`
- Consume: `src/features/jobs/SimulationJobRuntimeBridge.tsx`
- Consume: `src/features/ui/Timeline.tsx`
- Test: feature-owned tests under `src/features/robot`, `src/features/objects`, and `src/features/jobs`

**Interfaces:**
- Consumes: independently passing `RobotAssemblyWizard`, controlled `PrimitiveObjectDialog`, `PrimitiveObjectIntegration`, `JobToolbar`, `SimulationJobRuntimeBridge`, and active-Job `Timeline` public interfaces.
- Produces: the shell-owned `AddObjectMenu` plus complete BUILD and SIMULATE workflows without re-owning feature stores.

- [ ] **Step 1: Write integration RED tests with public feature fakes**

```tsx
it('offers exactly STEP, Box, and Cylinder from BUILD Add Object', async () => {
  renderIntegratedWorkspace('build')
  await user.click(screen.getByRole('button', { name: 'Add Object' }))
  expect(menuOptions()).toEqual(['Import STEP Object', 'Create Box', 'Create Cylinder'])
})

it('shows one active Job and locks Job mutation under OPC UA ownership', () => {
  renderIntegratedWorkspace('simulate', { activeJob: 'Pick and Place', jointSource: 'opcua' })
  expect(screen.getByRole('combobox', { name: 'Active Job' })).toHaveValue('Pick and Place')
  expect(screen.getByRole('button', { name: 'Save current Pose' })).toBeDisabled()
  expect(screen.getByText(/OPC UA owns Robot Joints/i)).toBeVisible()
})
```

- [ ] **Step 2: Run RED**

Run: `npm run test:run -- src/features/workspace/WorkspaceRouter.test.tsx src/features/ui src/features/robot src/features/objects src/features/jobs`

Expected: FAIL until all four public BUILD/SIMULATE feature panels exist.

- [ ] **Step 3: Replace Stage A Robot/Object actions with final BUILD flows**

Mount `RobotAssemblyWizard` for one-through-seven source Assembly Import while retaining explicit single-Link replacement. Implement one shell-owned `AddObjectMenu` with STEP, Box, and Cylinder; it opens the existing STEP flow or the controlled `PrimitiveObjectDialog` and delegates primitive mutations/pending/errors through `PrimitiveObjectIntegration`. Primitive forms use Box `dimensionsM`, Cylinder radius/height along local +Z, canonical uppercase `#RRGGBB`, and Object Instance `graspable`. Keep creation, mapping, preview, Apply, Cancel, progress, and failure states inside the feature components; the router owns only placement.

- [ ] **Step 4: Replace the flat Timeline with Job-owned SIMULATE flows**

Mount exactly one `SimulationJobRuntimeBridge`, then mount `JobToolbar` and the Job-aware existing `Timeline` as one active-Job editor. Show create, rename, duplicate, delete, Save current Pose, ordered Pose rows, outgoing speed, easing, calculated duration, Play/Pause/Stop, and Job validation status. A running or paused snapshot disables Job switch/edit; OPC UA Joint ownership makes the editor read-only. Do not retain the old flat-Pose behavior, create a second Timeline editor, or start a second Mechanics subscription.

- [ ] **Step 5: Verify BUILD/SIMULATE integration**

Run:

```powershell
npm run test:run -- src/features/workspace src/features/ui src/features/robot src/features/objects src/features/jobs src/app
npm run build
```

Expected: PASS; no duplicated stores or primary actions, and all feature-owned failure/ownership tests remain green.

- [ ] **Step 6: Commit**

```powershell
git add src/features/workspace src/features/ui src/features/objects/AddObjectMenu.tsx src/features/objects/AddObjectMenu.test.tsx src/app/App.tsx
git diff --cached --check
git commit -m "feat: integrate build and simulation workspaces"
```

---

### Task 5: Integrate CONNECT and VALIDATE Feature Workstreams

**Files:**
- Modify: `src/features/workspace/WorkspaceRouter.tsx`
- Modify: `src/features/workspace/WorkspaceRouter.test.tsx`
- Modify: `src/features/workspace/WorkspaceActivityRow.tsx`
- Modify: `src/features/workspace/WorkspaceActivityRow.test.tsx`
- Modify: `src/features/ui/ContextInspector.tsx`
- Modify: `src/features/ui/ContextInspector.test.tsx`
- Modify: `src/app/App.tsx`
- Consume: `src/features/opcua/OpcUaGatewayClient.ts`
- Consume: `src/features/equipment/equipment-transform-store.ts`
- Consume: `src/features/equipment/OpcUaTransformBindingPanel.tsx`
- Consume: `src/features/collision/CollisionPanel.tsx`
- Test: feature-owned tests under `src/features/opcua`, `src/features/equipment`, and `src/features/collision`

**Interfaces:**
- Consumes: the independently passing `OpcUaGatewayClient`, equipment-transform store selectors, controlled `OpcUaTransformBindingPanel`, and Job-aware `CollisionPanel` API.
- Produces: complete CONNECT and VALIDATE workspaces with one shared effective transform and explicit stale-report behavior.

- [ ] **Step 1: Write CONNECT/VALIDATE integration RED tests**

```tsx
it('shows fixed two-cycle smoothing as derived read-only diagnostics', () => {
  renderIntegratedWorkspace('connect', { samplingIntervalMs: 100 })
  expect(screen.getByLabelText('Transform smoothing')).toHaveTextContent('2 cycles')
  expect(screen.getByLabelText('Transform smoothing')).toHaveTextContent('200 ms')
  expect(screen.queryByRole('spinbutton', { name: /smoothing/i })).not.toBeInTheDocument()
})

it('keeps source and playback unchanged when entering VALIDATE', async () => {
  renderIntegratedWorkspace('simulate', { jointSource: 'opcua', playback: 'paused' })
  await selectMode('validate')
  expect(readJointSource()).toBe('opcua')
  expect(readPlaybackState()).toBe('paused')
  expect(sourceMutationSpies()).not.toHaveBeenCalled()
  expect(playbackMutationSpies()).not.toHaveBeenCalled()
})
```

- [ ] **Step 2: Run RED**

Run: `npm run test:run -- src/features/workspace src/features/ui src/features/opcua src/features/collision src/app`

Expected: FAIL until the external Transform Inspector flow and Job-aware `CollisionPanel` public APIs exist.

- [ ] **Step 3: Mount final CONNECT ownership and diagnostics**

Compose `JointSourcePanel` with the selected entity's controlled `OpcUaTransformBindingPanel` in the Context Inspector. Supply the exact selectors/commands from `docs/integration/opcua-transform-ws6-handoff.md`; read global activity snapshots from `OpcUaGatewayClient` and the equipment-transform store without copying them into workspace state. Show gateway identity, Profile catalog, Robot Joint source, numeric Status source, selected entity Transform source, Binding Profile/revision, World/MCP reference, six live XYZRPY values, quality `WAITING | GOOD | BAD | STALE | DISCONNECTED`, separate motion state including `HELD`, last-update age, and fixed smoothing `2 cycles - derived milliseconds`. Manual controls remain visible but read-only with a reason under OPC UA ownership. Profile/Binding changes use the feature mutation gate and never change Workspace Mode.

- [ ] **Step 4: Mount final VALIDATE Job-aware results**

Mount the Job-aware `CollisionPanel` and show its current-pose findings and active-Job Preview/Validate as separate tabs. Every completed Job report displays Job ID/name/revision, Robot/Mechanics revision, collision-registry revision, sample count, duration, and stale reason. Object motion, Job edit, Binding generation change, or Project replacement marks the report stale without silently rerunning it. Navigation and JSON/CSV export consume the existing collision report API; do not introduce a second validation panel or collision store.

- [ ] **Step 5: Verify CONNECT/VALIDATE integration and ownership locks**

Run:

```powershell
npm run test:run -- src/features/workspace src/features/ui src/features/opcua src/features/collision src/features/equipment src/features/objects src/app
npm run test:middleware
npm run build
```

Expected: PASS for quality language, Binding ownership, fixed smoothing display, canonical entity deletion, report staleness, Mode/source independence, middleware protocol, and production build.

- [ ] **Step 6: Commit**

```powershell
git add src/features/workspace/WorkspaceRouter.tsx src/features/workspace/WorkspaceRouter.test.tsx src/features/workspace/WorkspaceActivityRow.tsx src/features/workspace/WorkspaceActivityRow.test.tsx src/features/ui/ContextInspector.tsx src/features/ui/ContextInspector.test.tsx src/app/App.tsx
git diff --cached --check
git commit -m "feat: integrate connect and validation workspaces"
```

---

### Task 6: Complete Accessibility, Browser Acceptance, Visual QA, and Release Audit

**Files:**
- Create: `src/test/debug-bridge.ts`
- Create: `src/test/debug-bridge.test.ts`
- Create: `tests/mode-workspace.spec.ts`
- Create: `tests/mode-workspace-visual.spec.ts`
- Create: `tests/robot-assembly-import.spec.ts`
- Create: `tests/simulation-jobs.spec.ts`
- Create: `tests/primitive-object-workflow.spec.ts`
- Create: `tests/opcua-transform-smoothing.spec.ts`
- Consume: `docs/integration/robot-assembly-ws6-handoff.md`
- Consume: `docs/integration/simulation-jobs-ws6-handoff.md`
- Consume: `docs/integration/primitive-objects-ws6-handoff.md`
- Consume: `docs/integration/opcua-transform-ws6-handoff.md`
- Modify: `playwright.config.ts`
- Create: `docs/operator/workspace-modes.md`
- Create: `docs/verification/mode-workspace-release.md`
- Modify: `docs/progress/2026-07-13-project-status.md`
- Modify: `README.md`
- Modify: `src/styles/tokens.css`
- Modify: `src/styles/global.css`
- Modify: `src/styles/workspace.css`

**Interfaces:**
- Consumes: all six milestone workstreams and the production build.
- Produces: read-only browser evidence, deterministic screenshots, accessibility evidence, operator guidance, and the final plan-status ledger.

- [ ] **Step 1: Add a test-only read-only snapshot**

Expose `window.__ROBOT_SIM_DEBUG__.snapshot()` only when `VITE_E2E=1`. Return plain JSON containing active Workspace Mode, Project revision/status, Joint source/quality/angles, active Job/revision/playback state, selection/held ID, external transform ownership/quality, active collision/validation revision, and visible panel IDs. Expose no mutation method and no source bytes, credentials, NodeIds, or private configuration.

- [ ] **Step 2: Write the full Mode browser workflow before final fixes**

`tests/mode-workspace.spec.ts` must:

1. Start in BUILD and prove no Workspace Mode field appears in an exported `.wdtwin`.
2. Open Robot Import, STEP Object Import, Box, Cylinder, and Coordinate Frames through BUILD.
3. Switch to SIMULATE, create/select a Job, save/reorder Poses, Play/Pause, switch to VALIDATE, and prove playback remains paused with unchanged elapsed position.
4. Switch to CONNECT, configure one external Transform Binding against the fake gateway, observe GOOD then STALE without a zero Pose, and prove Workspace Mode changes neither Joint source nor Transform ownership.
5. Switch to VALIDATE, run active-Job validation, navigate/export a finding, change the Job, and observe the report become stale.
6. Select one Object before switching all four Modes and prove selection remains stable.
7. Create a dirty Manual transform preview, attempt a Mode switch, and exercise Apply, Discard, and Stay with correct focus return.

Consume the frozen WS2/WS3 handoff documents rather than inventing new feature commands. `tests/robot-assembly-import.spec.ts` must cover one-source/seven-Link import, explicit confirmation, full Mechanics persistence, Joint descendants, one archive source, duplicate collapse, Cancel, fused-body failure, and seven-source regression. `tests/simulation-jobs.spec.ts` must cover no-Job Save Pose defaults, Job CRUD/duplicate IDs, Pose order/speed/easing, active-only playback and lock, OPC UA read-only, Job-scoped collision reports, V1/V2 migration, legacy recovery, Save/reload/Export/Import, and boundaries. `tests/primitive-object-workflow.spec.ts` must create boundary-valid Box/Cylinder Assets, edit color/dimensions/Manual MCP-local XYZRPY/status/graspability, prove zero STEP archive entries, save/reload/export/import them, bind one through CONNECT, validate collision, and delete it atomically. `tests/opcua-transform-smoothing.spec.ts` must drive the fake gateway through first baseline snap, 0/100/200 ms interpolation, shortest-arc rotation, jittered retarget, bounded malformed-string BAD/HELD, disconnect HELD, fresh current-quality-GOOD foreground snap, stale foreground hold, GOOD-then-BAD/fault within the freshness window with zero snap, one later fresh baseline snap, and shared render/collision matrices.

- [ ] **Step 3: Add keyboard, responsive, contrast, and visual acceptance**

Capture deterministic screenshots at `1440 x 900` and `768 x 1024` with reduced nonessential motion. At both sizes, tab through Mode navigation and each primary workflow; assert no horizontal document overflow, no overlapping open drawers, no hidden focused element, and no duplicate visible primary action. Measure target rectangles and fail below the desktop/narrow minima. Verify token pairs meet `4.5:1` text and `3:1` non-text contrast, visible focus is at least `2px`, and every quality/ownership state has a text label.

- [ ] **Step 4: Document workflow and exact plan disposition**

Document what each Mode changes and explicitly does not change, global Project controls, dirty-preview navigation, ownership locks, Job activity outside SIMULATE, responsive drawers, keyboard commands, quality meanings, fixed two-cycle smoothing display, and recovery-required behavior. Update the Project status ledger to mark completed baselines, superseded old plans, remaining future Generic Robot/Frame/security work, and the final milestone verification commands.

- [ ] **Step 5: Run the complete release gate**

```powershell
npm run lint
npm run test:run
npm run test:middleware
npm run cad:validate
npm run build
npm run test:e2e -- tests/mode-workspace.spec.ts tests/mode-workspace-visual.spec.ts tests/robot-assembly-import.spec.ts tests/simulation-jobs.spec.ts tests/primitive-object-workflow.spec.ts tests/opcua-transform-smoothing.spec.ts tests/project-roundtrip.spec.ts tests/project-v3-roundtrip.spec.ts tests/geometry-collision.spec.ts
npm run deploy:validate
npm run deploy:smoke
npm run deploy:smoke:opcua
npm audit --audit-level=high
git diff --check
```

Expected: zero lint errors; all unit/middleware tests pass; seven CAD Links with `0 errors, 0 warnings`; production build passes; all serialized Playwright workflows and both reference screenshots pass without a flaky-timeout waiver; both deployment smokes clean up; zero high-severity audit findings; no whitespace errors.

- [ ] **Step 6: Request review, resolve findings, and commit evidence**

Use `superpowers:requesting-code-review`. Resolve every actionable finding, rerun its focused test, then rerun the complete release gate.

```powershell
git add src/test tests/mode-workspace.spec.ts tests/mode-workspace-visual.spec.ts tests/robot-assembly-import.spec.ts tests/simulation-jobs.spec.ts tests/primitive-object-workflow.spec.ts tests/opcua-transform-smoothing.spec.ts playwright.config.ts docs/operator/workspace-modes.md docs/verification/mode-workspace-release.md docs/progress/2026-07-13-project-status.md README.md src/styles
git diff --cached --check
git commit -m "docs: verify mode workspace release"
```

## Quantitative Success Criteria

1. Exactly four Mode tabs render in this order: BUILD, SIMULATE, CONNECT, VALIDATE. Exactly one has `aria-selected="true"`.
2. Every page load starts in BUILD. Mode is absent from local/session storage, ProjectDB revisions, URLs, gateway messages, and every `.wdtwin` entry.
3. Switching through all four Modes causes zero source connect/disconnect/switch calls, zero playback start/pause/resume/stop calls, zero Joint-angle writes, zero selection clears, zero grasp/release calls, zero transform Apply/Cancel calls when no draft exists, and zero validation start/cancel calls.
4. A dirty preview offers exactly Apply, Discard, and Stay. Apply failure retains the current Mode/draft; Discard restores the committed pose before navigation; Stay changes nothing and returns focus to the initiating Mode tab.
5. BUILD is the only persistent owner of Robot Import, Link replacement, STEP/Box/Cylinder Object creation, Frame editing, Geometry/Mechanical configuration, and Manual placement controls.
6. SIMULATE is the only persistent owner of Joint jog, gripper, Job selection/editing, Save Pose, and Timeline playback controls. A running/paused Job remains unchanged across Mode switches.
7. CONNECT is the only persistent owner of Joint source, numeric Status Binding, external Transform Binding, Profile/revision/reference selection, and live quality diagnostics. Fixed smoothing displays exactly `2 cycles` and `2 * samplingIntervalMs`; no duration editor exists.
8. VALIDATE is the only persistent owner of current collision policy/findings, active-Job Preview/Validate, Job-tagged reports, ignore/restore, finding navigation, and report export.
9. Each primary action has one visible owner. Automated DOM inspection finds no duplicate visible Import Robot, Add Object, Save current Pose, Play, Stop Job, Apply Binding, Validate Job, Download JSON, or Download CSV action.
10. Selection survives all four Mode switches. OPC UA ownership, held Object identity, collision findings, and Project revision also remain unchanged unless the operator invokes their explicit feature action.
11. At `1440 x 900`, Explorer, Viewport, Inspector, and Dock fit without document overflow. At `768 x 1024`, no horizontal overflow exists, drawers are mutually exclusive, the top bar remains visible, and the bottom sheet does not cover it.
12. Desktop icon-only targets are at least `32 x 32 CSS px`; every narrow target is at least `44 x 44 CSS px`; normal text contrast is at least `4.5:1`; UI/focus contrast is at least `3:1`; visible focus is at least `2 CSS px`.
13. Keyboard-only Playwright completes BUILD Add Object, SIMULATE Job selection/reorder/playback, CONNECT Binding inspection, and VALIDATE finding navigation/export with deterministic focus return and live announcements.
14. GOOD, UNCERTAIN, BAD, STALE, DISCONNECTED, WAITING, MANUAL, SIMULATION, OPC UA, HELD, Playing, Paused, and stale-report states all have visible text and are not color-only.
15. Project busy disables mutation without changing Mode. `recovery-required` exposes only reload guidance and no mutation control.
16. Existing Project, Frames, Robot, Object, Joint, grasp, collision, OPC UA Joint, Docker, and `.wdtwin` workflows plus all new Assembly, Job, Primitive, Transform, and Mode workflows pass the complete release gate.

## Self-Review

- **Coverage:** Transient Mode semantics, capability ownership, navigation guard, Stage A current-feature routing, Stage B integration, source/playback independence, responsive behavior, accessibility, visual QA, documentation, and the final release gate each map to a task.
- **Scope:** This plan does not implement Assembly parsing, Job domain behavior, Primitive Geometry, OPC UA reduction/smoothing, or Project v3. It consumes their reviewed public interfaces and owns only workspace presentation and final integration.
- **Placeholder scan:** No unresolved placeholders, inert UI, unspecified routes, or unnamed acceptance tests remain.
- **Type consistency:** All tasks use `WorkspaceMode`, `WorkspaceCapability`, `WorkspaceActivitySnapshot`, `WorkspaceModeBar`, `WorkspaceActivityRow`, and `WorkspaceRouter` exactly as introduced in Task 1 or the locked file map.
- **Disposition:** Old baseline UI/final-audit tasks and the old Pose Sequence UI plan are explicitly superseded; completed baselines remain release regressions; generic Frame/Robot/security work stays future.
- **Dependency gate:** Stage A follows Project v3 review. Stage B follows all four feature-workstream reviews. Task 6 is the only milestone completion gate.
