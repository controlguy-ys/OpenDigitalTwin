# Mode Workspace and Release Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the crowded single-screen workspace with four explicit engineering lenses (BUILD, SIMULATE, CONNECT, and VALIDATE), then integrate Assembly Import, Simulation Jobs, Primitive Objects, canonical OPC UA numeric Status Binding, and OPC UA Equipment Transform into one accessible, release-verified UI.

**Architecture:** Workspace Mode is a transient presentation router, not a Robot source, ownership state, playback command, or Project field. Stage A introduces the Mode contract and routes only currently working actions into a stable Explorer/Viewport/Inspector/Dock shell. Stage B begins only after the four feature workstreams pass independently, then connects their public panels without duplicating domain state or silently changing Robot source, external-transform ownership, Job playback, selection, grasp, or collision state.

**Tech Stack:** React 19, TypeScript 6, Zustand 5, Three.js/R3F, Lucide React, CSS, Vitest 4, Testing Library, user-event, Playwright 1.61.

## Global Constraints

- Start Stage A only after `2026-07-13-project-v3-foundation.md` is complete and reviewed.
- Start Stage B only after the independently reviewed Assembly Import, Simulation Jobs, Primitive Objects, and OPC UA Equipment Transform/Smoothing plans are complete.
- Stage A owns only shell/navigation composition and consumes current feature panels unchanged. It must not edit child-workstream-owned Wizard, Primitive, Timeline/Job, numeric Status/Equipment Transform, or Collision panel internals.
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
- Desktop reference viewport is `1440 x 900`. Narrow reference viewport is `768 x 1024`. The responsive breakpoint remains `< 960px`. A separate `720 x 450` viewport with `screen: 1440 x 900` and `deviceScaleFactor: 2` is the deterministic 200% DPR2/reflow-equivalent acceptance lane; it adds no screenshot baseline.
- At desktop widths, icon-only controls are at least `32 x 32 CSS px`; at narrow widths, every interactive target is at least `44 x 44 CSS px`. Normal text contrast is at least `4.5:1`, non-text UI/focus contrast at least `3:1`, and the visible focus indicator is at least `2 CSS px`.
- All four Modes, drawers, tabs, Job actions, Binding controls, findings, and dialogs are operable by keyboard with deterministic focus return. No state is communicated by color alone.
- Preserve the current single-Worker Playwright setting for OCCT-heavy browser tests.
- Preserve the WS1 runtime presentation constant exactly as `MAX_VISIBLE_STATUS_OVERLAYS = 128`: rank selected visible entity first, then in-frustum distance/canonical ID, mount at most 128 overlay roots, and cull additional candidates without rejecting or mutating persisted `statusOverlayVisible` requests.
- E2E-only state inspection is guarded solely by `.env.test` `VITE_E2E=1`; production bundles must contain neither `__ROBOT_SIM_DEBUG__` nor a debug-bridge installer. The bridge is read-only and exposes no mutation, source bytes, credentials, NodeIds, or private gateway configuration.
- Browser OPC UA acceptance uses Playwright `page.routeWebSocket` plus `page.clock`; it never depends on a real gateway, wall-clock sleeps, or `waitForTimeout`.
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
src/features/workspace/WorkspaceBindingOutcomeLiveRegion.tsx
src/features/workspace/WorkspaceBindingOutcomeLiveRegion.test.tsx
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
src/main.tsx
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
src/features/equipment/OpcUaNumericStatusBindingPanel.tsx
src/features/equipment/OpcUaTransformBindingPanel.tsx
src/features/collision/CollisionPanel.tsx

# Stage B composition owned by this plan
src/features/objects/AddObjectMenu.tsx
src/features/objects/AddObjectMenu.test.tsx

src/test/debug-bridge.ts
src/test/debug-bridge.test.ts
.env.test
tests/mode-workspace.spec.ts
tests/mode-workspace-visual.spec.ts
tests/support/fake-opcua-gateway.ts
tests/mode-workspace-visual.spec.ts-snapshots/win32/*.png
tests/mode-workspace-visual.spec.ts-snapshots/linux/*.png
tests/robot-assembly-import.spec.ts
tests/simulation-jobs.spec.ts
tests/primitive-object-workflow.spec.ts
tests/opcua-transform-smoothing.spec.ts
scripts/verify-production-debug-bridge.mjs
scripts/verify-visual-baselines.mjs
scripts/deployment/smoke-deployment.mjs
scripts/deployment/smoke-deployment.test.ts
.github/workflows/webdt-platform.yml
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

it('serializes navigation once authoritative Apply begins', async () => {
  const gate = deferredApply()
  const first = requestWorkspaceModeChange('connect', dirtyPreviewDependencies('apply', gate))
  await gate.started()
  await expect(requestWorkspaceModeChange('validate', dirtyPreviewDependencies('apply', gate)))
    .rejects.toMatchObject({ code: 'WORKSPACE_NAVIGATION_PENDING' })
  expect(applyPreview).toHaveBeenCalledTimes(1)
  expect(activeMode()).toBe('build')
  gate.resolve()
  await expect(first).resolves.toMatchObject({ changed: true, mode: 'connect' })
  expect(activeMode()).toBe('connect')
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

`requestWorkspaceModeChange()` changes immediately when no draft exists. For a dirty draft, it requests one `apply | discard | stay` decision. Before a choice starts authoritative work, a newer navigation request may invalidate the older dialog result. Once Apply begins its Project mutation, acquire one navigation-pending gate, disable all Mode tabs/second requests, and retain that request's target until success or failure; a second programmatic request fails as `WORKSPACE_NAVIGATION_PENDING` and cannot commit then ignore the first result. Apply success performs exactly one route change; rejection stays in the current Mode with the draft and releases the gate. Discard invokes the authoritative transient Cancel/Discard command and changes only after committed Pose is visible. Stay changes nothing and returns focus.

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

it('passes mm/degree form drafts to the primitive feature without shell conversion', async () => {
  const primitiveIntegration = createPrimitiveIntegrationFake()
  renderIntegratedWorkspace('build', {
    primitiveIntegration,
    selectedEntityId: 'object:box-01',
  })

  await openBoxDialogAndEnterDimensions(user, [1000, 2000, 3000])
  await user.click(screen.getByRole('button', { name: 'Create Box' }))
  expect(primitiveIntegration.create).toHaveBeenCalledWith(
    expect.objectContaining({ dimensionsMm: [1000, 2000, 3000] }),
  )
  expect(primitiveIntegration.create.mock.calls[0][0]).not.toHaveProperty('dimensionsM')

  await enterManualTransform(user, {
    xMm: 125.5,
    yMm: -250.25,
    zMm: 500.125,
    rollDeg: 10.25,
    pitchDeg: -20.5,
    yawDeg: 30.75,
  })
  await user.click(screen.getByRole('button', { name: 'Apply manual transform' }))
  expect(primitiveIntegration.updateManualTransform).toHaveBeenCalledWith('object:box-01', {
    xMm: 125.5,
    yMm: -250.25,
    zMm: 500.125,
    rollDeg: 10.25,
    pitchDeg: -20.5,
    yawDeg: 30.75,
  })
  const manualDraft = primitiveIntegration.updateManualTransform.mock.calls[0][1]
  expect(manualDraft).not.toHaveProperty('positionM')
  expect(manualDraft).not.toHaveProperty('quaternion')
})
```

- [ ] **Step 2: Run RED**

Run: `npm run test:run -- src/features/workspace/WorkspaceRouter.test.tsx src/features/ui src/features/robot src/features/objects src/features/jobs`

Expected: FAIL until all four public BUILD/SIMULATE feature panels exist.

- [ ] **Step 3: Replace Stage A Robot/Object actions with final BUILD flows**

Mount `RobotAssemblyWizard` for one-through-seven source Assembly Import while retaining explicit single-Link replacement. Implement one shell-owned `AddObjectMenu` with STEP, Box, and Cylinder; it opens the existing STEP flow or the controlled `PrimitiveObjectDialog` and delegates primitive mutations/pending/errors through `PrimitiveObjectIntegration`. The UI boundary is frozen to Box `dimensionsMm`, Cylinder `radiusMm`/`heightMm` along local +Z, and Manual Object `xMm`/`yMm`/`zMm`/`rollDeg`/`pitchDeg`/`yawDeg`; display XYZ and dimensions in millimetres to three decimals and RPY in degrees to two decimals. The shell forwards those feature-owned drafts unchanged and must not synthesize `dimensionsM`, metre position, or Quaternion fields. The feature contract preserves untouched full-precision metre/Quaternion values and performs any touched-field conversion exactly once. Keep canonical uppercase `#RRGGBB` and Object Instance `graspable`, and keep creation, mapping, preview, Apply, Cancel, progress, and failure states inside the feature components; the router owns only placement.

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
- Create: `src/features/workspace/WorkspaceBindingOutcomeLiveRegion.tsx`
- Create: `src/features/workspace/WorkspaceBindingOutcomeLiveRegion.test.tsx`
- Modify: `src/features/ui/ContextInspector.tsx`
- Modify: `src/features/ui/ContextInspector.test.tsx`
- Modify: `src/features/joints/JointSourcePanel.tsx`
- Modify: `src/features/joints/JointSourcePanel.test.tsx`
- Modify: `src/app/App.tsx`
- Consume: `src/features/opcua/OpcUaGatewayClient.ts`
- Consume: `src/features/equipment/equipment-transform-store.ts`
- Consume: `src/features/equipment/OpcUaNumericStatusBindingPanel.tsx`
- Consume: `src/features/equipment/OpcUaTransformBindingPanel.tsx`
- Consume: `src/features/collision/CollisionPanel.tsx`
- Test: feature-owned tests under `src/features/opcua`, `src/features/equipment`, and `src/features/collision`

**Interfaces:**
- Consumes: the independently passing `OpcUaGatewayClient`, its `subscribeJointPresentation` result `{ acceptedQuality: JointQuality, transportOverlay: 'BAD' | 'STALE' | null, effectiveQuality: JointQuality, connectionState: 'CONNECTED' | 'DISCONNECTED', fault: 'protocol' | 'transport' | null, lastAcceptedReceivedAtMs: number | null }` with `effectiveQuality === (transportOverlay ?? acceptedQuality)`, equipment-transform store selectors, controlled `OpcUaNumericStatusBindingPanel` and `OpcUaTransformBindingPanel`, their four Project mutation commands and `onBindingOutcome`, and the Job-aware `CollisionPanel` API. The UI renders no fabricated age while that receipt is `null`.
- Produces: complete CONNECT and VALIDATE workspaces with one shared effective transform, effective Joint transport presentation without angle ownership, one persistent Binding-outcome live region, and explicit stale-report behavior.

- [ ] **Step 1: Write CONNECT/VALIDATE integration RED tests**

```tsx
it('shows fixed two-cycle smoothing as derived read-only diagnostics', () => {
  renderIntegratedWorkspace('connect', { samplingIntervalMs: 100 })
  expect(screen.getByLabelText('Transform smoothing')).toHaveTextContent('2 cycles · 200 ms')
  expect(screen.queryByRole('spinbutton', { name: /smoothing/i })).not.toBeInTheDocument()
})

it('creates and deletes canonical numeric Status bindings without changing Transform binding', async () => {
  renderIntegratedWorkspace('connect', { selectedEntityId: 'equipment:cup-01' })
  await user.selectOptions(screen.getByRole('combobox', { name: 'Numeric Status mapping' }), 'cup-status')
  await user.click(screen.getByRole('button', { name: 'Apply numeric Status binding' }))
  expect(setNumericStatusBinding).toHaveBeenCalledWith('equipment:cup-01', expect.any(Object))
  expect(setTransformBinding).not.toHaveBeenCalled()
  await user.click(screen.getByRole('button', { name: 'Remove numeric Status binding' }))
  expect(removeNumericStatusBinding).toHaveBeenCalledWith('equipment:cup-01')
  expect(removeTransformBinding).not.toHaveBeenCalled()
})

it('uses effective Joint presentation for every shell consumer without changing angles', () => {
  const angles = [11, 22, 33, 44, 55, 66]
  const view = renderIntegratedWorkspace('connect', {
    robotJointState: { angles, quality: 'GOOD' },
    jointPresentation: {
      acceptedQuality: 'GOOD',
      transportOverlay: 'BAD',
      effectiveQuality: 'BAD',
      connectionState: 'CONNECTED',
      fault: 'protocol',
      lastAcceptedReceivedAtMs: 500,
    },
  })

  expect(within(screen.getByTestId('global-header')).getByText('BAD')).toBeVisible()
  expect(within(screen.getByTestId('joint-source-panel')).getByText('BAD')).toBeVisible()
  expect(within(screen.getByTestId('workspace-activity-row')).getByText('BAD')).toBeVisible()
  expect(readJointAngles()).toEqual(angles)

  view.rerenderIntegratedWorkspace({
    jointPresentation: {
      acceptedQuality: 'GOOD',
      transportOverlay: 'BAD',
      effectiveQuality: 'BAD',
      connectionState: 'DISCONNECTED',
      fault: 'transport',
      lastAcceptedReceivedAtMs: 500,
    },
  })
  expect(screen.getAllByText('DISCONNECTED').length).toBeGreaterThan(0)
  expect(readJointAngles()).toEqual(angles)
})

it('keeps UNCERTAIN Joint-only and reduces numeric/Transform Uncertain StatusCode to BAD', () => {
  renderIntegratedWorkspace('connect', {
    jointPresentation: {
      acceptedQuality: 'UNCERTAIN',
      transportOverlay: null,
      effectiveQuality: 'UNCERTAIN',
      connectionState: 'CONNECTED',
      fault: null,
      lastAcceptedReceivedAtMs: 500,
    },
    numericStatusCode: 'Uncertain',
    transformStatusCode: 'Uncertain',
  })
  expect(screen.getByLabelText('Robot Joint quality')).toHaveTextContent('UNCERTAIN')
  expect(screen.getByLabelText('Numeric Status quality')).toHaveTextContent('BAD')
  expect(screen.getByLabelText('Transform quality')).toHaveTextContent('BAD')
})

it.each([
  ['Binding applied.', 'binding-summary'],
  ['Binding removed.', 'binding-source-control'],
  ['Binding changes canceled.', 'binding-edit-trigger'],
  ['Binding could not be applied. Review the highlighted fields.', 'first-invalid-field'],
] as const)('announces %s once and focuses %s', async (message, focusTarget) => {
  const { emitBindingOutcome } = renderIntegratedWorkspace('connect')
  const liveRegion = screen.getByRole('status')
  const announcements: string[] = []
  const observer = new MutationObserver(() => announcements.push(liveRegion.textContent ?? ''))
  observer.observe(liveRegion, { childList: true, subtree: true, characterData: true })

  emitBindingOutcome({ message, focusTarget })
  await waitFor(() => expect(document.activeElement).toBe(screen.getByTestId(focusTarget)))
  observer.disconnect()

  expect(liveRegion).toHaveTextContent(message)
  expect(announcements.filter((value) => value === message)).toHaveLength(1)
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

Run: `npm run test:run -- src/features/workspace src/features/ui src/features/opcua src/features/equipment src/features/collision src/app`

Expected: FAIL until the numeric Status/Transform Inspector flows and Job-aware `CollisionPanel` public APIs exist.

- [ ] **Step 3: Mount final CONNECT ownership and diagnostics**

Compose `JointSourcePanel` with the selected entity's controlled `OpcUaNumericStatusBindingPanel` and `OpcUaTransformBindingPanel` in the Context Inspector. Supply the exact selectors and four mutation commands from `docs/integration/opcua-transform-ws6-handoff.md`; read global activity snapshots from `OpcUaGatewayClient` and the equipment-transform store without copying them into workspace state. `App` subscribes once to `subscribeJointPresentation` and passes that projection to the global header, `JointSourcePanel`, and `WorkspaceActivityRow`; none may read the Robot store's accepted quality directly for presentation. All three render `effectiveQuality`, while diagnostics preserve the projection's separate `acceptedQuality` and `transportOverlay`. A transport/protocol overlay therefore replaces prior accepted GOOD with effective BAD immediately while retaining all six angles plus accepted `JointQuality`/timestamp, and socket close changes only connection to `DISCONNECTED` while accepted GOOD / overlay BAD / effective BAD remain distinguishable. `UNCERTAIN` remains a valid accepted Robot Joint quality only. Numeric Status and Transform presentation use `WAITING | GOOD | BAD | STALE | DISCONNECTED`; an OPC UA Uncertain StatusCode reduces to BAD and never exposes numeric/Transform `UNCERTAIN`. Use one WS5-injected browser-local `Date.now` function end-to-end for accepted receipt, Joint reducer freshness, numeric/Transform freshness, and presentation ages. Upstream wall-clock timestamps remain diagnostics and are never subtracted from local receipt time; no reducer or freshness arithmetic may mix in `performance.now`.

Numeric mapping choices come from the current-generation catalog and support create/replace/delete for both built-in `equipment:*` and imported/generated `object:*` selections. Show gateway identity, numeric mapping and Transform Profile catalogs, Robot Joint source, numeric Status source/binding/quality, selected entity Transform source, Binding Profile/revision, World/MCP reference, six live XYZRPY values, separate motion state including `HELD`, and last-update age. Fixed smoothing is exact read-only text `2 cycles · ${2 * samplingIntervalMs} ms` when T is known and exact fallback text `2 cycles · derived milliseconds` when T is unavailable; no ASCII hyphen substitute or duration editor is allowed. Manual controls remain visible but read-only with a reason under their respective OPC UA ownership. Numeric and Transform Binding changes use separate feature mutation gates, never rewrite each other, and never change Workspace Mode.

Mount exactly one `WorkspaceBindingOutcomeLiveRegion` above `WorkspaceRouter`, outside Mode/Inspector/panel remount boundaries, with `role="status" aria-live="polite" aria-atomic="true"`. Both Binding panels send every `onBindingOutcome` to that single consumer exactly once. Resolve stable `data-testid` focus targets and then announce/focus these frozen pairs: `Binding applied.` -> `binding-summary`; `Binding removed.` -> `binding-source-control`; `Binding changes canceled.` -> `binding-edit-trigger`; `Binding could not be applied. Review the highlighted fields.` -> `first-invalid-field`. The invalid path focuses the first associated invalid field. Test that the same live-region element survives CONNECT -> BUILD -> CONNECT remounts, that no duplicate live region exists, and that each Apply/Delete/Cancel/invalid Apply produces one mutation announcement and one deterministic focus move.

- [ ] **Step 4: Mount final VALIDATE Job-aware results**

Mount the Job-aware `CollisionPanel` and show its current-pose findings and active-Job Preview/Validate as separate tabs. Every completed Job report displays Job ID/name/revision, Robot/Mechanics revision, collision-registry revision, sample count, duration, and stale reason. Object motion, Job edit, Binding generation change, or Project replacement marks the report stale without silently rerunning it. Navigation and JSON/CSV export consume the existing collision report API; do not introduce a second validation panel or collision store.

- [ ] **Step 5: Verify CONNECT/VALIDATE integration and ownership locks**

Run:

```powershell
npm run test:run -- src/features/workspace src/features/ui src/features/opcua src/features/collision src/features/equipment src/features/objects src/app
npm run test:middleware
npm run build
```

Expected: PASS for numeric/Transform binding creation and deletion, quality language, independent Binding ownership, fixed smoothing display, canonical entity deletion, report staleness, Mode/source independence, middleware protocol, and production build.

- [ ] **Step 6: Commit**

```powershell
git add src/features/workspace/WorkspaceRouter.tsx src/features/workspace/WorkspaceRouter.test.tsx src/features/workspace/WorkspaceActivityRow.tsx src/features/workspace/WorkspaceActivityRow.test.tsx src/features/workspace/WorkspaceBindingOutcomeLiveRegion.tsx src/features/workspace/WorkspaceBindingOutcomeLiveRegion.test.tsx src/features/ui/ContextInspector.tsx src/features/ui/ContextInspector.test.tsx src/features/joints/JointSourcePanel.tsx src/features/joints/JointSourcePanel.test.tsx src/app/App.tsx
git diff --cached --check
git commit -m "feat: integrate connect and validation workspaces"
```

---

### Task 6: Complete Accessibility, Browser Acceptance, Visual QA, and Release Audit

**Files:**
- Create: `.env.test`
- Modify: `src/main.tsx`
- Create: `src/test/debug-bridge.ts`
- Create: `src/test/debug-bridge.test.ts`
- Create: `scripts/verify-production-debug-bridge.mjs`
- Create: `scripts/verify-visual-baselines.mjs`
- Modify: `scripts/deployment/smoke-deployment.mjs`
- Modify: `scripts/deployment/smoke-deployment.test.ts`
- Create: `tests/mode-workspace.spec.ts`
- Create: `tests/mode-workspace-visual.spec.ts`
- Create: `tests/support/fake-opcua-gateway.ts`
- Create: `tests/robot-assembly-import.spec.ts`
- Create: `tests/simulation-jobs.spec.ts`
- Create: `tests/primitive-object-workflow.spec.ts`
- Create: `tests/opcua-transform-smoothing.spec.ts`
- Create: `tests/nonsecure-origin.spec.ts`
- Consume: `docs/integration/robot-assembly-ws6-handoff.md`
- Consume: `docs/integration/simulation-jobs-ws6-handoff.md`
- Consume: `docs/integration/primitive-objects-ws6-handoff.md`
- Consume: `docs/integration/opcua-transform-ws6-handoff.md`
- Modify: `playwright.config.ts`
- Modify: `playwright.insecure.config.ts`
- Modify: `package.json`
- Create: `.github/workflows/webdt-platform.yml`
- Create: `docs/operator/workspace-modes.md`
- Create: `docs/verification/mode-workspace-release.md`
- Modify: `docs/progress/2026-07-13-project-status.md`
- Modify: `README.md`
- Modify: `src/styles/tokens.css`
- Modify: `src/styles/global.css`
- Modify: `src/styles/workspace.css`

**Interfaces:**
- Consumes: all six milestone workstreams and the production build.
- Produces: a test-only read-only debug snapshot, a deterministic fake same-origin OPC UA gateway, exactly sixteen platform-specific screenshots, protocol-aware deployment smoke evidence, Windows/Linux Chromium CI evidence, accessibility evidence, operator guidance, and the final plan-status ledger.

- [ ] **Step 1: Add a test-only read-only snapshot**

Create `.env.test` containing only `VITE_E2E=1`. In `src/main.tsx`, install the bridge through this compile-time-eliminable guard and nowhere else:

```ts
if (import.meta.env.VITE_E2E === '1') {
  void import('./test/debug-bridge').then(({ installDebugBridge }) => {
    installDebugBridge()
  })
}
```

Expose `window.__ROBOT_SIM_DEBUG__.snapshot()` only through that guarded import. Return frozen plain JSON containing `projectId`, Project revision/status; active Workspace Mode; every Robot source digest and Link ID without bytes; every Object Asset `{ id, sourceKind }` and Object Instance ID; every Job `{ id, revision, poseIds }`; active Job/revision/playback; selection/held ID; Joint source, effective presentation quality, connection state, accepted-receipt time, and six angles; numeric/Transform ownership and quality; collision/validation revision; visible panel IDs; and, for the selected external entity, finite 16-element `renderMatrix`/`collisionMatrix` plus `targetRevision`/`renderRevision`. Box/Cylinder primitive identity is therefore observable only through the Asset `sourceKind`, not a second primitive store. Expose no mutation method and no source bytes, credentials, NodeIds, private configuration, WebSocket handle, or store object. Unit-test the exact read-only shape and await bridge presence with `expect.poll` in test-mode E2E.

Create `scripts/verify-production-debug-bridge.mjs` and package script `verify:debug-bridge:production`. Preserve/verify the exact package script `"build:e2e": "tsc -b && vite build --mode test"`, so `.env.test` is loaded only for E2E. After `npm run build`, scan every production `dist/**/*.js` and `dist/**/*.html` byte-for-byte and fail if `__ROBOT_SIM_DEBUG__`, `installDebugBridge`, or the debug module path remains. Then run `npm run build:e2e` and prove the bridge appears. This production-negative/test-positive order is required because the test build replaces `dist`; unit tests also fail if normal production mode registers the bridge.

- [ ] **Step 2: Write the full Mode browser workflow before final fixes**

Create `tests/support/fake-opcua-gateway.ts` with this browser-test surface:

```ts
export interface FakeOpcUaGatewayController {
  waitForConnection(): Promise<void>
  sendJson(value: unknown): void
  sendMalformed(value: string): void
  close(options?: { code?: number; reason?: string }): Promise<void>
}

export function installFakeOpcUaGateway(page: Page): Promise<FakeOpcUaGatewayController>
```

`installFakeOpcUaGateway` registers `await page.routeWebSocket('**/opcua', route => capture(route))` before `page.goto` and does not call `connectToServer`, so the app's same-origin `/opcua` is fully mocked. Tests install `page.clock` before navigation, pause at a fixed epoch after the app is ready, and advance only with `page.clock.runFor(ms)`. The controller publishes the closed WS5 message kinds `numeric-status-catalog`, `equipment-transform-profile-catalog`, and their frames, and can inject a bounded malformed string, close, and accept a reconnect. No OPC UA browser test may use a real gateway, `waitForTimeout`, Date polling, or wall-clock interpolation assertions.

In `tests/opcua-transform-smoothing.spec.ts`, publish catalogs and a nonzero baseline GOOD Transform first. Publish a changed GOOD target at exact clock `t=0` and use the debug snapshot to assert both render and collision matrices remain at the baseline (0%); after `page.clock.runFor(100)` assert both are the same finite midpoint matrix (50%); after another `100` assert both are the target matrix (100%). Use the same clock/controller to drive jittered retarget, malformed-string BAD/HELD, close/reconnect, and visibility foreground/resume. Every sample asserts `renderMatrix === collisionMatrix`, monotonic `renderRevision` against `targetRevision`, and no partial/zero matrix.

`tests/mode-workspace.spec.ts` must:

1. Start in BUILD and prove no Workspace Mode field appears in an exported `.wdtwin`.
2. Open Robot Import, STEP Object Import, Box, Cylinder, and Coordinate Frames through BUILD.
3. Switch to SIMULATE, create/select a Job, save/reorder Poses, Play/Pause, switch to VALIDATE, and prove playback remains paused with unchanged elapsed position.
4. While still paused, switch to CONNECT and attempt to change Joint source; assert the selector/store rejects with `Stop playback before changing Robot Joint source.`, performs no implicit Stop, and preserves playback elapsed position and source. Stop explicitly before the later source workflow.
5. In CONNECT, create, replace, and remove one canonical numeric Status Binding; configure/replace/remove one external Transform Binding against the fake gateway; observe numeric GOOD/BAD/STALE fallback plus Transform GOOD then STALE without a zero Pose; and prove Workspace Mode changes neither Joint source nor either ownership.
6. Switch to VALIDATE, run active-Job validation, navigate/export a finding, change the Job, and observe the report become stale.
7. Select one Object before switching all four Modes and prove selection remains stable.
8. Create a dirty Manual transform preview, attempt a Mode switch, and exercise Apply, Discard, and Stay with correct focus return.

Consume the frozen WS2/WS3 handoff documents rather than inventing new feature commands. `tests/robot-assembly-import.spec.ts` must cover one-source/seven-Link import, explicit confirmation, full Mechanics persistence, Joint descendants, one archive source, duplicate collapse, Cancel, fused-body failure, and seven-source regression. `tests/simulation-jobs.spec.ts` must cover no-Job Save Pose defaults, Job CRUD/duplicate IDs, Pose order/speed/easing, active-only playback and lock, OPC UA read-only, Job-scoped collision reports, V1/V2 migration, legacy recovery, Save/reload/Export/Import, and boundaries. `tests/primitive-object-workflow.spec.ts` must create boundary-valid Box/Cylinder Assets, edit color/dimensions/Manual MCP-local XYZRPY/status/graspability, prove zero STEP archive entries, save/reload/export/import them, bind one through CONNECT, validate collision, and delete it atomically. `tests/opcua-transform-smoothing.spec.ts` must cover built-in/Object numeric Binding create/replace/active-delete with independent Transform state, catalog-before-frame/Gateway/reconnect generation, finite value with BAD StatusCode, `null`/missing/read-failure Manual fallback, exact numeric stale deadlines, and then drive the fake gateway through first Transform baseline snap, 0/100/200 ms interpolation, shortest-arc rotation, jittered retarget, bounded malformed-string BAD/HELD, disconnect HELD, fresh current-quality-GOOD foreground snap, stale foreground hold, GOOD-then-BAD/fault within the freshness window with zero snap, one later fresh baseline snap, and shared render/collision matrices.

`tests/nonsecure-origin.spec.ts` reuses the WS1 mapped `webdt.test` non-secure
Chromium config after WS2-WS5 land. In addition to the WS1 core Project/STEP-
Object test, it creates/duplicates a Job with Poses and creates a Box plus
Cylinder through production UI, then asserts every new ID is non-empty/unique
while `crypto.randomUUID` is unavailable. Missing crypto is covered by the WS3/
WS4 atomic unit tests; this browser lane must not mark the origin secure.

- [ ] **Step 3: Add keyboard, responsive, contrast, and visual acceptance**

Set `playwright.config.ts` `snapshotPathTemplate` to `{testDir}/{testFilePath}-snapshots/{platform}/{arg}{ext}`. With the fixed clock, fake gateway, deterministic Project, `animations: 'disabled'`, and `caret: 'hide'`, capture all four Modes at desktop `1440 x 900` and narrow `768 x 1024`. Mask only dynamic age text and the WebGL canvas so GPU output cannot destabilize shell snapshots. `scripts/verify-visual-baselines.mjs` is an exact allowlist check and fails unless these sixteen PNG files, and no other PNG in this snapshot directory, exist:

The visual test calls ``toHaveScreenshot(`${mode}-${viewport}.png`)`` exactly once for each platform-local Mode/viewport tuple; no ad hoc snapshot name is allowed.

| Platform | Required baseline files |
|---|---|
| `win32` | `tests/mode-workspace-visual.spec.ts-snapshots/win32/build-desktop.png` |
| `win32` | `tests/mode-workspace-visual.spec.ts-snapshots/win32/simulate-desktop.png` |
| `win32` | `tests/mode-workspace-visual.spec.ts-snapshots/win32/connect-desktop.png` |
| `win32` | `tests/mode-workspace-visual.spec.ts-snapshots/win32/validate-desktop.png` |
| `win32` | `tests/mode-workspace-visual.spec.ts-snapshots/win32/build-narrow.png` |
| `win32` | `tests/mode-workspace-visual.spec.ts-snapshots/win32/simulate-narrow.png` |
| `win32` | `tests/mode-workspace-visual.spec.ts-snapshots/win32/connect-narrow.png` |
| `win32` | `tests/mode-workspace-visual.spec.ts-snapshots/win32/validate-narrow.png` |
| `linux` | `tests/mode-workspace-visual.spec.ts-snapshots/linux/build-desktop.png` |
| `linux` | `tests/mode-workspace-visual.spec.ts-snapshots/linux/simulate-desktop.png` |
| `linux` | `tests/mode-workspace-visual.spec.ts-snapshots/linux/connect-desktop.png` |
| `linux` | `tests/mode-workspace-visual.spec.ts-snapshots/linux/validate-desktop.png` |
| `linux` | `tests/mode-workspace-visual.spec.ts-snapshots/linux/build-narrow.png` |
| `linux` | `tests/mode-workspace-visual.spec.ts-snapshots/linux/simulate-narrow.png` |
| `linux` | `tests/mode-workspace-visual.spec.ts-snapshots/linux/connect-narrow.png` |
| `linux` | `tests/mode-workspace-visual.spec.ts-snapshots/linux/validate-narrow.png` |

Freeze the update policy: snapshot generation/update is allowed only when `UPDATE_VISUAL_BASELINES=1`, using `npx playwright test tests/mode-workspace-visual.spec.ts --update-snapshots` on the matching OS. `playwright.config.ts` rejects `--update-snapshots` without that opt-in. Windows creates/updates only `win32`; Linux creates/updates only `linux`; never copy one platform's PNGs into the other directory. CI never sets the opt-in and must never update snapshots. Add package script `verify:visual-baselines` for the exact allowlist/count check.

At desktop and narrow sizes, tab through Mode navigation and each primary workflow; assert no horizontal document overflow, no overlapping open drawers, no hidden focused element, and no duplicate visible primary action. Add a non-screenshot 200% DPR2/reflow-equivalent context with `viewport: { width: 720, height: 450 }`, `screen: { width: 1440, height: 900 }`, and `deviceScaleFactor: 2`; assert zero horizontal document overflow and that every primary action remains reachable through the responsive drawer/sheet with no hidden primary action. In both normal and DPR2 lanes, a 129-candidate fixture mounts exactly `MAX_VISIBLE_STATUS_OVERLAYS = 128` overlay roots and leaves the culled candidate's persisted request unchanged. In CONNECT, keyboard-only input must create, replace, and active-delete both a numeric Status Binding and an external Transform Binding; after every dialog Apply/Delete/Cancel, the single persistent polite live region emits the frozen exact message once and focus moves to its frozen target. Measure target rectangles and fail below the desktop/narrow minima. Verify token pairs meet `4.5:1` text and `3:1` non-text contrast, visible focus is at least `2px`, and every quality/ownership state has a text label.

- [ ] **Step 4: Make the deployment smoke protocol-aware and own Windows/Linux Chromium CI**

Replace the `/opcua` open-only success check in `scripts/deployment/smoke-deployment.mjs` with `probeOpcUaProtocol`. It opens the deployed same-origin `/opcua`, parses string JSON messages, and allows at most `10_000 ms` to receive a non-empty `equipment-transform-profile-catalog` followed by an `equipment-transform-frame` whose profile keys exactly equal the catalog Profile IDs and whose samples are all `{ quality: 'BAD' }` while the upstream server is unavailable. Fail immediately on malformed payload, unknown/missing/partial Profile keys, any GOOD sample (especially an all-zero GOOD Pose), socket close, or timeout. Return auditable evidence `{ catalogReceived: true, badFrameReceived: true, goodPoseCount: 0, zeroGoodPoseCount: 0 }`; `deploy:smoke:opcua` succeeds only with all four values.

Extend `scripts/deployment/smoke-deployment.test.ts` with controlled WebSocket tests proving: open alone remains pending and cannot pass; catalog plus complete BAD frame passes; catalog plus a full non-zero GOOD Pose rejects and increments `goodPoseCount`; catalog plus a GOOD zero Pose rejects and increments both `goodPoseCount` and `zeroGoodPoseCount`; partial/unknown Profile sets reject; malformed JSON, early close, and the exact timeout reject. Keep the non-OPC-UA health smoke unchanged and preserve guaranteed Compose cleanup on every result.

Create `.github/workflows/webdt-platform.yml` with matrix `os: [windows-latest, ubuntu-latest]`, Chromium only, Node `22.15.1`, and npm `11.4.2`. Each job checks out, installs the pinned npm, runs `npm ci`, installs Chromium with `npx playwright install chromium` on Windows or `npx playwright install --with-deps chromium` on Ubuntu, runs `npm run verify` (which includes the normal production build), then runs `npm run verify:debug-bridge:production` and `npm run verify:visual-baselines` before `npm run test:e2e:platform`. Define that package script as the focused test-mode browser lane over `tests/robot-assembly-import.spec.ts`, `tests/project-v3-roundtrip.spec.ts`, `tests/opcua-transform-smoothing.spec.ts`, and `tests/mode-workspace-visual.spec.ts`; it must invoke the exact `build:e2e` mode, prove WebGL startup at DPR1 and DPR2 with zero context loss, OCCT WASM Worker startup, one-source Robot import, Project export/import round trip, mocked same-origin `/opcua`, 128-overlay culling, and the matching platform's eight visual baselines. CI never updates snapshots. Upload `playwright-report` and `test-results` on failure. Hosted CI is the functional matrix, not the quantitative p95 authority. No macOS job or baseline is in scope; both Windows and Linux jobs must be green.

- [ ] **Step 5: Document workflow and exact plan disposition**

Document what each Mode changes and explicitly does not change, global Project controls, dirty-preview navigation, ownership locks, Job activity outside SIMULATE, responsive drawers, keyboard commands, quality meanings, fixed two-cycle smoothing display, and recovery-required behavior. Include the `.env.test`-only debug guard and production absence check, deterministic fake-gateway/clock rule, exact sixteen-baseline Windows/Linux update policy, 200% DPR2/reflow lane, protocol-aware deployment-smoke evidence, and required two-job platform workflow. Record two separate controlled-reference DPR1 performance artifacts—one Windows and one Linux—with OS/CPU/RAM/browser/WebGL renderer and the WS1 thresholds; hosted platform jobs provide functional evidence only. Update the Project status ledger to mark completed baselines, superseded old plans, remaining future Generic Robot/Frame/security work, and the final milestone verification commands.

- [ ] **Step 6: Run the complete release gate**

```powershell
npm run lint
npm run test:run
npm run test:middleware
npm run cad:validate
npm run build
npm run verify:debug-bridge:production
npm run test:perf:reference
npm run verify:visual-baselines
npm run test:e2e -- tests/mode-workspace.spec.ts tests/mode-workspace-visual.spec.ts tests/robot-assembly-import.spec.ts tests/simulation-jobs.spec.ts tests/primitive-object-workflow.spec.ts tests/opcua-transform-smoothing.spec.ts tests/project-roundtrip.spec.ts tests/project-v3-roundtrip.spec.ts tests/geometry-collision.spec.ts
npm run test:e2e:insecure
npm run deploy:validate
npm run deploy:build
npm run deploy:smoke
npm run deploy:smoke:opcua
npm audit --audit-level=high
$directIdCalls = rg -n --glob '*.ts' --glob '*.tsx' "crypto\.randomUUID\(|Math\.random\(" src
if ($LASTEXITCODE -eq 0) { $directIdCalls; throw 'Direct non-portable ID generation remains.' }
if ($LASTEXITCODE -gt 1) { throw 'Portable-ID source scan failed.' }
git diff --check
```

Expected: zero lint errors; all unit/middleware tests pass; seven CAD Links with `0 errors, 0 warnings`; the normal production build contains no debug bridge and the subsequent E2E test-mode build contains it; both controlled Windows and Linux DPR1 reference performance artifacts pass the frozen budgets; the exact sixteen Windows/Linux visual files pass the allowlist and each platform workflow compares its eight matching baselines; all serialized Playwright workflows and the full non-secure-origin ID workflow pass with fake time and no flaky-timeout waiver; deployment images build; both deployment smokes clean up and the OPC UA smoke proves catalog plus complete all-BAD behavior with zero GOOD samples of any Pose; Windows and Linux Chromium required checks are green; zero high-severity audit findings; the direct randomUUID/Math.random scan has zero source hits; no whitespace errors.

- [ ] **Step 7: Request review, resolve findings, and commit evidence**

Use `superpowers:requesting-code-review`. Resolve every actionable finding, rerun its focused test, then rerun the complete release gate.

```powershell
git add .env.test src/main.tsx src/test tests/support/fake-opcua-gateway.ts tests/mode-workspace.spec.ts tests/mode-workspace-visual.spec.ts tests/mode-workspace-visual.spec.ts-snapshots tests/robot-assembly-import.spec.ts tests/simulation-jobs.spec.ts tests/primitive-object-workflow.spec.ts tests/opcua-transform-smoothing.spec.ts tests/nonsecure-origin.spec.ts scripts/verify-production-debug-bridge.mjs scripts/verify-visual-baselines.mjs scripts/deployment/smoke-deployment.mjs scripts/deployment/smoke-deployment.test.ts .github/workflows/webdt-platform.yml playwright.config.ts playwright.insecure.config.ts package.json docs/operator/workspace-modes.md docs/verification/mode-workspace-release.md docs/progress/2026-07-13-project-status.md README.md src/styles
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
7. CONNECT is the only persistent owner of Joint source, numeric Status Binding, external Transform Binding, catalog/Profile/revision/reference selection, and live quality diagnostics. While playback is `playing` or `paused`, Joint-source UI and store changes are rejected with the Stop-first reason and cause zero implicit transport/source mutation. For both `equipment:*` and `object:*`, the operator can create, replace, and delete a numeric Binding through the WS5 Project commands; each mutation round-trips, leaves the Transform Binding byte-for-byte unchanged, and the inverse Transform operation leaves numeric Binding unchanged. Fixed smoothing displays exact text `2 cycles · ${2 * samplingIntervalMs} ms` when T is known (therefore `2 cycles · 200 ms` at T `100`) and exact fallback `2 cycles · derived milliseconds` otherwise; no duration editor exists.
8. VALIDATE is the only persistent owner of current collision policy/findings, active-Job Preview/Validate, Job-tagged reports, ignore/restore, finding navigation, and report export.
9. Each primary action has one visible owner. Automated DOM inspection finds no duplicate visible Import Robot, Add Object, Save current Pose, Play, Stop Job, Apply Binding, Validate Job, Download JSON, or Download CSV action.
10. Selection survives all four Mode switches. OPC UA ownership, held Object identity, collision findings, and Project revision also remain unchanged unless the operator invokes their explicit feature action.
11. At `1440 x 900`, Explorer, Viewport, Inspector, and Dock fit without document overflow. At `768 x 1024`, no horizontal overflow exists, drawers are mutually exclusive, the top bar remains visible, and the bottom sheet does not cover it. At the non-screenshot `720 x 450`, DPR2 200%-reflow equivalent, no horizontal overflow or hidden primary action exists and every primary action is reachable through the responsive drawer/sheet.
12. Desktop icon-only targets are at least `32 x 32 CSS px`; every narrow target is at least `44 x 44 CSS px`; normal text contrast is at least `4.5:1`; UI/focus contrast is at least `3:1`; visible focus is at least `2 CSS px`.
13. Keyboard-only Playwright completes BUILD Add Object, SIMULATE Job selection/reorder/playback, CONNECT numeric and Transform Binding create/replace/active-delete, and VALIDATE finding navigation/export. Exactly one persistent `role="status" aria-live="polite" aria-atomic="true"` region survives panel remounts and announces each outcome once with deterministic focus: `Binding applied.` -> `binding-summary`; `Binding removed.` -> `binding-source-control`; `Binding changes canceled.` -> `binding-edit-trigger`; `Binding could not be applied. Review the highlighted fields.` -> `first-invalid-field`.
14. GOOD, UNCERTAIN (Robot Joint quality only), BAD, STALE, DISCONNECTED, WAITING, MANUAL, SIMULATION, OPC UA, HELD, Playing, Paused, and stale-report states all have visible text and are not color-only. Numeric/Transform Uncertain StatusCode is displayed as BAD, never UNCERTAIN.
15. Project busy disables mutation without changing Mode. `recovery-required` exposes only reload guidance and no mutation control.
16. Existing Project, Frames, Robot, Object, Joint, grasp, collision, OPC UA Joint, Docker, and `.wdtwin` workflows plus all new Assembly, Job, Primitive, Transform, and Mode workflows pass the complete release gate.
17. `npm run test:e2e:insecure` runs the WS1 core plus final Job/Pose/Box/Cylinder workflow at mapped `http://webdt.test`, proves `isSecureContext === false`, `randomUUID` absent, `getRandomValues` present, and every production-created ID non-empty/unique. The production-source scan finds zero direct `crypto.randomUUID()` or `Math.random()` calls outside the central factory abstraction.
18. `subscribeJointPresentation` drives the global header, `JointSourcePanel`, and activity row with separate `acceptedQuality`, `transportOverlay`, derived `effectiveQuality`, and connection state. A protocol/transport fault publishes accepted GOOD / overlay BAD / effective BAD immediately without changing six angles, accepted `JointQuality`, or accepted timestamp; close changes only connection to DISCONNECTED while that split remains observable. Every emission satisfies `effectiveQuality === (transportOverlay ?? acceptedQuality)`; accepted-frame and numeric/Transform freshness use one injected browser-local `Date.now` domain end-to-end with no `performance.now` reducer arithmetic.
19. `.env.test` contains only `VITE_E2E=1`; `build:e2e` is exactly `tsc -b && vite build --mode test`; the read-only debug bridge is present only in that test-mode E2E and exposes `projectId`, revision/status, Robot Link/source IDs, all Object Asset IDs/kinds and Instance IDs, all Job/Pose IDs, and the remaining frozen non-sensitive snapshot, while `verify:debug-bridge:production` finds zero bridge markers in every normal-production JS/HTML bundle.
20. The visual allowlist contains exactly sixteen PNGs: four Modes times desktop/narrow times `win32`/`linux`, with no macOS or 200%-lane PNG. Updating requires `UPDATE_VISUAL_BASELINES=1` on the matching OS; CI compares and never updates.
21. Mocked same-origin `/opcua` E2E uses only `page.routeWebSocket` and `page.clock`: a changed Transform samples equal render/collision matrices at exact 0%, 50%, and 100% after `0/100/200 ms`, and jitter/fault/disconnect/reconnect/foreground cases use no real gateway or `waitForTimeout`.
22. `deploy:smoke:opcua` does not pass on socket open: it receives a non-empty Profile catalog and a complete all-BAD frame, reports `catalogReceived`, `badFrameReceived`, `goodPoseCount: 0`, and `zeroGoodPoseCount: 0`, and rejects malformed, partial, unknown, full non-zero GOOD, GOOD-zero, close, or timeout cases. The non-zero GOOD fixture proves the gate is not merely a zero-Pose detector.
23. `npm run test:perf:reference` passes separately on the declared controlled Windows and Linux DPR1 reference machines with two recorded artifacts, `npm run deploy:build` passes, and `.github/workflows/webdt-platform.yml` is green for both hosted Windows and Linux Chromium with DPR1/DPR2 WebGL, zero context loss, OCCT WASM Worker, one-source Robot import, Project round trip, fake same-origin OPC UA, `MAX_VISIBLE_STATUS_OVERLAYS = 128` culling, and eight matching platform baselines.

## Self-Review

- **Coverage:** Transient Mode semantics, capability ownership, navigation guard, Stage A current-feature routing, mm/degree BUILD drafts, Job-owned SIMULATE flows, effective Joint/numeric/Transform CONNECT presentation, persistent Binding announcements, VALIDATE reports, deterministic gateway/clock E2E, responsive/200% behavior, exact cross-platform visual QA, protocol-aware deployment smoke, Windows/Linux CI, documentation, performance, and the final release gate each map to a task.
- **Scope:** This plan does not implement Assembly parsing, Job domain behavior, Primitive Geometry, OPC UA reduction/smoothing, or Project v3. It consumes their reviewed public interfaces and owns only workspace presentation and final integration.
- **Placeholder scan:** No unresolved placeholders, inert UI, unspecified routes, unnamed acceptance tests, open-only deployment probes, unguarded debug hooks, or floating screenshot counts remain.
- **Type consistency:** All tasks use `WorkspaceMode`, `WorkspaceCapability`, `WorkspaceActivitySnapshot`, `WorkspaceModeBar`, `WorkspaceActivityRow`, and `WorkspaceRouter` exactly as introduced in Task 1 or the locked file map.
- **Disposition:** Old baseline UI/final-audit tasks and the old Pose Sequence UI plan are explicitly superseded; completed baselines remain release regressions; generic Frame/Robot/security work stays future.
- **Dependency gate:** Stage A follows Project v3 review. Stage B follows all four feature-workstream reviews. Task 6 is the only milestone completion gate.
