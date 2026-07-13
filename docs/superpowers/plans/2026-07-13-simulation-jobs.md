# Simulation Jobs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Group ordered Robot Poses into directly owned Simulation Jobs with deterministic CRUD, editing, playback, collision-validation identity, OPC UA read-only behavior, and authoritative Project V3 persistence.

**Architecture:** A pure Job domain validates immutable Job/Pose collections and applies the frozen monotonic `SimulationJobV1.revision` rule. A dedicated Zustand Job store becomes the only runtime owner of Jobs and Poses; the Robot store retains joint telemetry and explicit `idle | playing | paused` transport state only. Timeline, collision validation, and Project runtime consume `snapshot.simulation` through stable selectors. The frozen WS1 Project V3 contract remains the only persisted authority, while an isolated one-time adapter recovers legacy localStorage data only when no active Project exists.

**Tech Stack:** React 19, TypeScript 6, Zustand 5, Vitest 4, Testing Library 16, Web Workers, Playwright 1.61, Dexie 4, fflate 0.8.

## Global Constraints

- **Prerequisite:** Complete and freeze WS1 Project V3 Foundation first. WS1 alone owns `WorkcellProjectSnapshotV3`, `SimulationJobV1`, V1/V2 flat-Pose migration, V3 validation, archive codec, and atomic Project replacement.
- Execute against the landed WS6 Stage A Mode shell. Job components own behavior; final SIMULATE placement and cross-feature browser acceptance remain WS6 Stage B work.
- Tasks 1-3 may run in parallel with other Wave 2 domain work. Before Task 4 edits the shared Project runtime bridge, land WS2 Task 4 first and rebase; WS4 Task 3 then lands after this Task 4.
- This plan consumes frozen WS1 Job fields and migration output. It does not change schema shape, schema version, migration rules, or codec paths.
- A Job directly owns its Poses. There is no shared Pose library, reference aliasing, linked copy, conditional branch, loop, Job chaining, PLC command, or OPC UA write.
- Preserve Pose order, six finite joint angles, easing `linear|easeInOut`, outgoing speed 1-100%, and velocity-derived transition duration with the existing 16 ms minimum.
- Use the WS1 budgets exactly: at most 32 Jobs, 256 Poses per Job, and 2,048 Poses per Project. Exact boundaries pass; boundary plus one fails before mutation/commit.
- Job IDs and Pose IDs are non-empty, immutable, and unique across the Project. New and duplicated Jobs start at revision 1. Duplicate creates fresh Job and Pose IDs and deep-copies all Pose tuples.
- `SimulationJobV1.revision` is a positive monotonic integer for motion content. Pose add/delete/reorder, angles, outgoing speed, easing, and derived-duration changes increment it exactly once; display-name changes do not increment it. Migration starts at revision 1.
- Save current Pose defaults are fixed at persisted `speedPercentToNext: 100`, `easing: 'easeInOut'`, and terminal `durationMs: 1000`. When that Pose gains an outgoing successor, recompute its duration from Joint delta, current Mechanics maximum velocities, and speed with the existing 16 ms minimum; the terminal placeholder is never added to playback elapsed time.
- If no Job exists, Save Pose creates `Job 1`, selects it, and appends `Pose 1` in one state transition.
- Playback consumes only the active Job and snapshots its `jobId`, numeric `revision`, and Poses at Play. Both `playing` and `paused` retain that active run and reject Job selection and every Job/Pose mutation in UI and store. Only explicit Stop returns transport to `idle` and unlocks Jobs.
- In OPC UA Joint mode, Jobs and Poses remain readable but create, rename, duplicate, delete, reorder, speed/easing edit, Save Pose, and playback are rejected in both UI and store.
- Project V3 is authoritative after load/import. Runtime code must not continue mirroring Jobs to the legacy `robot-sim.pose-sequence.v1` localStorage key.
- Legacy localStorage recovery never overwrites or merges into an active Project. It runs only when no active Project record exists.
- Collision requests, progress, results, reports, and exports carry both `jobId: string` and `jobRevision: number`; a report from one Job is never displayed as the active report of another.
- Preserve existing pause/resume/stop semantics, speed calculation, collision sample cap 20,000, findings cap 10,000, 250-sample progress cadence, and 10 Hz current-pose collision.
- No PLC, Robot deployment, IK, dynamics, or safety-rated behavior is in scope.
- Preserve unrelated user changes; use failure-first tests and one focused commit per task.

---

### Task 1: Job Domain, Revision, and Authoritative Store

**Files:**
- Create: `src/domain/jobs/simulation-job.ts`
- Create: `src/domain/jobs/simulation-job.test.ts`
- Create: `src/features/jobs/simulation-job-store.ts`
- Create: `src/features/jobs/simulation-job-store.test.ts`
- Create: `src/features/jobs/simulation-job-mechanics-sync.ts`
- Create: `src/features/jobs/simulation-job-mechanics-sync.test.ts`
- Create: `src/features/jobs/SimulationJobRuntimeBridge.tsx`
- Create: `src/features/jobs/SimulationJobRuntimeBridge.test.tsx`
- Modify: `src/features/joints/keyframes.ts`
- Modify: `src/features/joints/keyframes.test.ts`
- Modify: `src/features/joints/robot-store.ts`
- Modify: `src/features/joints/robot-store.test.ts`

**Interfaces:**
- Consumes: frozen WS1 `SimulationJobV1` and Job/Pose budget constants from `src/domain/project/project-v3.ts`; existing `RobotKeyframe`, `deriveTransitionDurationMs()`, and Robot maximum velocities.
- Produces: runtime Job ownership helpers, `SimulationJobStoreState`, stable selectors, Job/Pose CRUD actions, `refreshDurationsForMechanics()`, `SimulationJobMechanicsSubscription`, and a controlled `SimulationJobRuntimeBridge` that WS6 Stage B mounts once. The Robot store no longer owns or persists `keyframes`.

- [ ] **Step 1: Write failing domain tests** for unique immutable IDs, non-empty names, six finite angles, Save Pose defaults `100% / easeInOut / 1000 ms terminal`, terminal duration exclusion from elapsed playback, speed 1 and 100 accepted, 0/101 rejected, supported easing, 16 ms minimum outgoing duration, 32/256/2,048 boundaries, owned tuples, revision starting at 1, one increment per motion edit, and display-name exclusion from revision.

```ts
it('increments the frozen Job revision only for motion-affecting edits', () => {
  const job = jobWithTwoPoses()
  expect(renameJob(job, 'Renamed').revision).toBe(job.revision)
  expect(withPoseSpeed(job, 50).revision).toBe(job.revision + 1)
})
```

- [ ] **Step 2: Write failing store and Mechanics-subscription tests** for create, rename, duplicate, delete, select, Save Pose, Pose delete/reorder, speed/easing edit, injected ID generation, and deep ownership. Assert duplicate is inserted after its source, named `Name Copy` / `Name Copy 2`, receives fresh IDs, starts at revision 1, and becomes active. Assert deleting the active Job selects the next Job at that index, otherwise the previous, otherwise `null`. Change one Robot maximum velocity and prove the subscription calls `refreshDurationsForMechanics()` once; every Job whose derived duration changes is recalculated in one store transition and increments revision exactly once, while unaffected Jobs retain object identity and revision.

```ts
const copy = store.getState().duplicateJob('job-a')
expect(copy.id).not.toBe('job-a')
expect(copy.poses.map(({ id }) => id)).not.toEqual(source.poses.map(({ id }) => id))
expect(copy.poses.map(({ anglesDeg }) => anglesDeg)).toEqual(
  source.poses.map(({ anglesDeg }) => anglesDeg),
)

const stop = mechanicsSubscription.start()
robotConfigurationStore.getState().updateJoint(0, { maxVelocityDegPerSec: 90 })
expect(jobStore.getState().jobs.find(({ id }) => id === 'job-a')?.revision)
  .toBe(source.revision + 1)
stop()
```

- [ ] **Step 3: Verify RED** with `npm run test:run -- src/domain/jobs src/features/jobs/simulation-job-store.test.ts src/features/jobs/simulation-job-mechanics-sync.test.ts src/features/joints/keyframes.test.ts src/features/joints/robot-store.test.ts`; expect missing modules and old Robot-store ownership failures.
- [ ] **Step 4: Implement immutable validation/revision and the Job store.** Inject `idFactory`, `now`, `getMaxVelocities`, and `assertEditable` dependencies for deterministic tests. Recalculate only outgoing segment durations after order/speed/easing/Mechanics changes. Use one Zustand transition per action and return cloned snapshots.

```ts
export interface SimulationJobStoreState {
  readonly jobs: readonly SimulationJobV1[]
  readonly activeJobId: string | null
  createJob(name?: string): string
  renameJob(jobId: string, name: string): void
  duplicateJob(jobId: string): SimulationJobV1
  deleteJob(jobId: string): void
  selectJob(jobId: string): void
  savePose(anglesDeg: JointAnglesDeg): void
  movePose(jobId: string, poseId: string, direction: -1 | 1): void
  deletePose(jobId: string, poseId: string): void
  setPoseSpeed(jobId: string, poseId: string, speedPercent: number): void
  setPoseEasing(jobId: string, poseId: string, easing: RobotKeyframeEasing): void
  refreshDurationsForMechanics(
    maxVelocitiesDegPerSec: readonly [number, number, number, number, number, number],
  ): readonly string[]
  replaceProjectJobs(jobs: readonly SimulationJobV1[], activeJobId: string | null): void
}

export interface SimulationJobMechanicsSubscription {
  start(): () => void
}
```

- [ ] **Step 5: Install Mechanics synchronization behind a controlled bridge, remove flat Pose ownership, and verify GREEN.** `SimulationJobRuntimeBridge` owns one effect that starts `SimulationJobMechanicsSubscription` and cleans it up; WS6 Stage B mounts that bridge exactly once. Project the six maximum velocities, ignore equal tuples, and call `refreshDurationsForMechanics()` once per changed tuple. Delete keyframe/localStorage actions from `RobotStoreState`; keep joint angles, quality, gripper, and replace the playback boolean with `playbackStatus: 'idle' | 'playing' | 'paused'`. Run each command in order and stop at the first non-zero exit; expect PASS.

```powershell
npm run test:run -- src/domain/jobs src/features/jobs src/features/joints
npm run lint
npm run build
```

- [ ] **Step 6: Commit.** Run each command in order and stop at the first non-zero exit.

```powershell
git add src/domain/jobs src/features/jobs/simulation-job-store.ts src/features/jobs/simulation-job-store.test.ts src/features/jobs/simulation-job-mechanics-sync.ts src/features/jobs/simulation-job-mechanics-sync.test.ts src/features/jobs/SimulationJobRuntimeBridge.tsx src/features/jobs/SimulationJobRuntimeBridge.test.tsx src/features/joints/keyframes.ts src/features/joints/keyframes.test.ts src/features/joints/robot-store.ts src/features/joints/robot-store.test.ts
git diff --cached --check
git commit -m "feat: add authoritative simulation job state"
```

---

### Task 2: Job-Aware Timeline, CRUD UI, and OPC UA Read-Only Gate

**Files:**
- Create: `src/features/joints/joint-source-mode-store.ts`
- Create: `src/features/joints/joint-source-mode-store.test.ts`
- Create: `src/features/jobs/JobToolbar.tsx`
- Create: `src/features/jobs/JobToolbar.test.tsx`
- Create: `src/features/jobs/simulation-jobs.css`
- Modify: `src/features/ui/Timeline.tsx`
- Modify: `src/features/ui/Timeline.test.tsx`
- Modify: `src/features/joints/JointInspector.tsx`
- Modify: `src/features/joints/JointInspector.test.tsx`

**Interfaces:**
- Consumes: Task 1 Job store/selectors, existing Simulation/OPC UA sources, `sampleTimeline()`, and Robot playback transport.
- Produces: shared `JointSourceModeState`, controlled `JobToolbar`, active-Job Timeline, feature-scoped styling, accessible CRUD/reorder/speed/easing controls, and a store-enforced `assertSimulationJobEditable()` gate for WS6 Stage B placement.

- [ ] **Step 1: Write failing authority/UI tests** proving Simulation mode permits edit/play, OPC UA mode permits read only, and playback blocks Job switch/mutation. Test Job selector, New, Rename, Duplicate, Delete confirmation, exact Pose count/duration, Save Pose creating `Job 1`, speed/easing controls, arrow-button reorder, and explicit disabled reasons.

```tsx
setJointSourceMode('opcua')
render(<JobToolbar />)
expect(screen.getByRole('button', { name: 'New Job' })).toBeDisabled()
expect(screen.getByText('OPC UA owns Robot joints; Jobs are read-only.')).toBeVisible()
```

- [ ] **Step 2: Write failing playback tests** proving Play snapshots only the active Job, Pause changes transport to `paused` and resumes the same snapshot/position, Stop alone changes transport to `idle` and resets time without moving the Robot, the final Pose publishes once and returns `idle`, fewer than two Poses disables Play, source quality BAD/STALE stops the run, hidden-document state becomes `paused`, and Job switch remains impossible while either playing or paused.
- [ ] **Step 3: Verify RED** with `npm run test:run -- src/features/joints/joint-source-mode-store.test.ts src/features/jobs/JobToolbar.test.tsx src/features/ui/Timeline.test.tsx src/features/joints/JointInspector.test.tsx`; expect missing Job UI/source-mode authority.
- [ ] **Step 4: Implement shared source authority and active-Job UI.** Move `sourceMode` out of component-local state into the new store. Make Job-store mutation dependencies read this source store and Robot playback state so disabled HTML is not the only guard. Use accessible buttons as the non-drag alternative for every Pose move.

```ts
export function assertSimulationJobEditable(): void {
  if (useJointSourceModeStore.getState().mode === 'opcua') {
    throw new Error('Simulation Jobs are read-only while OPC UA owns Robot joints.')
  }
  if (useRobotStore.getState().playbackStatus !== 'idle') {
    throw new Error('Stop playback before editing or switching Jobs.')
  }
}
```

- [ ] **Step 5: Implement snapshot playback and verify GREEN.** Store `{jobId, jobRevision: job.revision, poses}` in the Timeline playback ref at Play. Pause retains this ref; only Stop or completed/failed playback clears it and returns `idle`. Never read a different live Job during the run. Run focused tests, `npm run lint`, and `npm run build`; expect PASS and keyboard-complete CRUD/playback.
- [ ] **Step 6: Commit.** Run each command in order and stop at the first non-zero exit.

```powershell
git add src/features/joints/joint-source-mode-store.ts src/features/joints/joint-source-mode-store.test.ts src/features/jobs/JobToolbar.tsx src/features/jobs/JobToolbar.test.tsx src/features/jobs/simulation-jobs.css src/features/ui/Timeline.tsx src/features/ui/Timeline.test.tsx src/features/joints/JointInspector.tsx src/features/joints/JointInspector.test.tsx
git diff --cached --check
git commit -m "feat: operate pose jobs from the timeline"
```

---

### Task 3: Job-Scoped Collision Validation and Reports

**Files:**
- Modify: `src/features/collision/collision-validation-protocol.ts`
- Modify: `src/features/collision/collision-validation-protocol.test.ts`
- Modify: `src/features/collision/collision-validation-client.ts`
- Modify: `src/features/collision/collision-validation-client.test.ts`
- Modify: `src/features/collision/collision-validation.worker.ts`
- Modify: `src/features/collision/collision-store.ts`
- Modify: `src/features/collision/collision-store.test.ts`
- Modify: `src/features/collision/CollisionPanel.tsx`
- Modify: `src/features/collision/CollisionPanel.test.tsx`
- Modify: `src/features/collision/collision-report.ts`
- Modify: `src/features/collision/collision-report.test.ts`

**Interfaces:**
- Consumes: active Job ID/numeric revision/Poses, existing full-scene `revision`, Worker caps, Job-edit subscriptions, and Task 1 Mechanics-duration refresh events.
- Produces: protocol-wide `jobId` and `jobRevision`, `validationReportsByJobId`, active-Job report selector, job-scoped stale/cancel behavior, and Job identity in JSON/CSV reports.

- [ ] **Step 1: Write failing protocol/client/store tests** requiring non-empty matching `jobId`/`jobRevision` on request, progress, result, cancellation, and error events. Prove late results for another Job/revision are ignored, reports for two Jobs remain distinct, editing Job A stales/cancels only A, and a global scene revision change stales all reports. With validation running, change a maximum velocity that alters active-Job duration; assert one Job revision increment, a changed full-scene revision, one effective cancellation, and a stale active report. Also prove an unaffected Job retains its revision.

```ts
expect(validateCollisionValidationResult({
  ...resultFixture(),
  jobId: 'job-a',
  jobRevision: 4,
})).toMatchObject({ jobId: 'job-a', jobRevision: 4 })
```

- [ ] **Step 2: Write failing panel/report tests** proving Validate uses only active Job Poses, the UI displays `Report for <Job name>`, switching Jobs selects that Job's report or an empty state, stale state is scoped correctly, and JSON/CSV exports include Job ID/revision without changing the 20,000-sample/10,000-finding caps.
- [ ] **Step 3: Verify RED** with `npm run test:run -- src/features/collision`; expect missing Job identity and old single-report assertions.
- [ ] **Step 4: Implement protocol threading and report map.** Keep `revision` as the full scene signature and add Job identity separately. Include Robot Mechanics in that scene signature; subscribe to active Job ID/revision so `refreshDurationsForMechanics()` invalidates the same run through the numeric Job revision. Coalesce simultaneous scene/Job invalidation into one effective Worker cancel. Store immutable reports by Job ID; reject a report whose Job revision differs from the current Job content.

```ts
export interface CollisionValidationReport {
  readonly jobId: string
  readonly jobRevision: number
  readonly revision: string
  readonly sampleCount: number
  readonly findings: readonly CollisionFinding[]
  readonly truncated: boolean
}
```

- [ ] **Step 5: Verify GREEN and commit.** Run each command in order and stop at the first non-zero exit; expect existing progress `[250,500,750,1000]`, sample/finding caps, and current-pose 10 Hz tests unchanged. Stage only the listed files, inspect the staged diff, then commit.

```powershell
npm run test:run -- src/features/collision src/features/jobs
npm run lint
npm run build
git add src/features/collision
git diff --cached --check
git commit -m "feat: scope collision validation to simulation jobs"
```

---

### Task 4: Frozen V3 Runtime Persistence and One-Time Legacy Recovery

**Files:**
- Create: `src/features/jobs/legacy-pose-recovery.ts`
- Create: `src/features/jobs/legacy-pose-recovery.test.ts`
- Modify: `src/features/project/browser-project-runtime.ts`
- Modify: `src/features/project/browser-project-runtime.test.ts`
- Modify: `src/features/project/project-store-browser.ts`
- Modify: `src/features/project/project-store.test.ts`
- Modify: `src/features/project/ProjectMenu.tsx`
- Modify: `src/features/project/ProjectMenu.test.tsx`
- Modify: `tests/project-roundtrip.spec.ts`

**Interfaces:**
- Consumes: WS1 V3 snapshots/migration output/atomic store, Task 1 `replaceProjectJobs()`, and legacy key `robot-sim.pose-sequence.v1`.
- Produces: V3 Job capture/commit integration, `recoverLegacyPoseSequence()`, `completeLegacyRecoveryAfterSave()`, a recovery warning/banner, and semantic V1/V2/V3 browser round-trip evidence.

- [ ] **Step 1: Write failing runtime tests** proving capture clones all Jobs/Poses/active ID, commit atomically replaces them and stops playback, failed staging leaves current Jobs unchanged, Save/reload restores exact order/speed/easing, and Project import never merges existing runtime Jobs.

```ts
expect((await browserProjectRuntime.capture(previous)).simulation.jobs).toEqual([
  expect.objectContaining({ id: 'job-a', poses: expectedOwnedPoses }),
])
```

- [ ] **Step 2: Write failing legacy-recovery tests** for the exact authority order:
  1. An active V3 or WS1-migrated V1/V2 Project always wins and legacy localStorage is not merged.
  2. With no active Project and a valid legacy array, create one selected `Recovered Poses` Job in memory and retain the legacy key until the first successful Project save.
  3. Save failure retains the key and recovery banner; successful save removes the key/banner.
  4. Invalid JSON/records move raw text to `robot-sim.pose-sequence.v1.quarantine`, remove the active legacy key, show one warning, and do not crash.

```ts
expect(recoverLegacyPoseSequence({ activeProject: null, storage })).toMatchObject({
  recoveredJob: expect.objectContaining({ name: 'Recovered Poses' }),
  removeLegacyAfterSuccessfulSave: true,
})
```

- [ ] **Step 3: Verify RED** with `npm run test:run -- src/features/jobs/legacy-pose-recovery.test.ts src/features/project/browser-project-runtime.test.ts src/features/project/project-store.test.ts src/features/project/ProjectMenu.test.tsx`; expect missing recovery and old flat-Pose runtime behavior.
- [ ] **Step 4: Implement runtime integration without touching WS1 schema/codec/migration.** Capture Job-store state into `snapshot.simulation = { activeJobId, jobs }`; publish via one `replaceProjectJobs(snapshot.simulation.jobs, snapshot.simulation.activeJobId)` call after staging; run recovery only after Project hydration returns no active record. Never write live Job edits to the legacy key.
- [ ] **Step 5: Verify migration/round-trip GREEN.** Use WS1 V1/V2 fixtures in `tests/project-roundtrip.spec.ts` and assert flat Poses arrive as exactly one `job-default` / `Default Job` with IDs/order/angles/speed/easing preserved, then V3 Export/Import remains semantically equal. Run focused tests and `npm run test:e2e -- tests/project-roundtrip.spec.ts`.
- [ ] **Step 6: Commit.** Run each command in order and stop at the first non-zero exit.

```powershell
git add src/features/jobs/legacy-pose-recovery.ts src/features/jobs/legacy-pose-recovery.test.ts src/features/project/browser-project-runtime.ts src/features/project/browser-project-runtime.test.ts src/features/project/project-store-browser.ts src/features/project/project-store.test.ts src/features/project/ProjectMenu.tsx src/features/project/ProjectMenu.test.tsx tests/project-roundtrip.spec.ts
git diff --cached --check
git commit -m "feat: persist simulation jobs through project v3"
```

---

### Task 5: Controlled Integration, WS6 Browser Handoff, and Feature Gate

**Files:**
- Create: `src/features/jobs/simulation-jobs.integration.test.tsx`
- Create: `docs/integration/simulation-jobs-ws6-handoff.md`
- Create: `docs/operator/simulation-jobs.md`
- Create: `docs/verification/simulation-jobs-verification.md`
- Modify: `README.md`
- Modify: `docs/progress/2026-07-13-project-status.md`

**Interfaces:**
- Produces: deterministic controlled Job integration evidence, keyboard/accessibility component evidence, an exact WS6 production-UI browser handoff, operator semantics, and dated feature evidence.
- Consumes: Tasks 1-4 and WS1 V3 fixtures. WS6 Stage B owns creation and execution of `tests/simulation-jobs.spec.ts` after mounting the controlled Job surfaces.

- [ ] **Step 1: Write the failing controlled integration workflow** covering no-Job Save Pose, Job CRUD/duplicate IDs, Pose order/speed/easing, active-only playback, playback lock, OPC UA read-only, and Job-scoped collision identity without mounting App/AppShell.

```ts
it('keeps one controlled active Job across playback locks', async () => {
  renderSimulationJobIntegration()
  await createJobWithPoses('Pick and Place', 3)
  await duplicateActiveJob()
  expect(screen.getByLabelText('Active Job')).toHaveValue('Pick and Place Copy')
  await startPlayback()
  expect(screen.getByRole('button', { name: 'Delete Job' })).toBeDisabled()
})
```

- [ ] **Step 2: Verify RED** with `npm run test:run -- src/features/jobs/simulation-jobs.integration.test.tsx`; expect missing controlled integration behavior.
- [ ] **Step 3: Complete accessible component evidence, handoff, and documentation.** Keyboard-only component tests must complete Job selection/CRUD, Pose reorder, speed/easing edits, playback, and validation. Disabled operations expose a textual reason; focus remains visible and returns after Rename/Delete confirmation. `docs/integration/simulation-jobs-ws6-handoff.md` must freeze the exact Bridge/Toolbar/Timeline props/selectors/commands and later browser scenarios for V1/V2 migration, legacy recovery, Save/reload, Export/Import, boundary rejection, mode switching, and Job-scoped reports. Document direct ownership, outgoing transition semantics, OPC read-only behavior, report identity, migration, recovery, limits, and exclusions.
- [ ] **Step 4: Run the complete feature GREEN gate.** Execute `npm run lint`, `npm run test:run`, `npm run test:middleware`, `npm run cad:validate`, `npm run build`, `npm run deploy:validate`, `npm run deploy:smoke`, and `npm run deploy:smoke:opcua`; require exit 0 without retry/timeout waiver. Production-UI Playwright remains the WS6 Stage B release gate.
- [ ] **Step 5: Commit.** Run each command in order and stop at the first non-zero exit.

```powershell
git add src/features/jobs/simulation-jobs.integration.test.tsx docs/integration/simulation-jobs-ws6-handoff.md docs/operator/simulation-jobs.md docs/verification/simulation-jobs-verification.md README.md docs/progress/2026-07-13-project-status.md
git diff --cached --check
git commit -m "test: verify simulation job integration handoff"
```

---

## Quantitative Success Criteria

- 32 Jobs, 256 Poses in one Job, and 2,048 total Project Poses pass; 33, 257, or 2,049 fails atomically.
- Speed 1% and 100% pass; 0% and 101% fail. Segment duration never falls below 16 ms.
- Save Pose with zero Jobs produces exactly one selected `Job 1` containing exactly one `Pose 1` in one state notification. The Pose stores `speedPercentToNext: 100`, `easing: 'easeInOut'`, and terminal `durationMs: 1000`; terminal duration contributes zero playback elapsed time, and it is recomputed when it gains a successor.
- Duplicate creates one Job immediately after its source at revision 1, with fresh Job/Pose IDs, deep-equal motion content, and no shared mutable tuple.
- Playback publishes only the active Job snapshot and publishes the final Pose once. Both `playing` and `paused` permit zero Job/Pose mutations or Job switches; Pause never ends or unlocks the active run. Stop is the only user action that returns `idle` and unlocks Jobs; natural completion and terminal quality/error failure are non-user terminal paths that also close the run.
- OPC UA mode permits zero Job/Pose mutations and zero playback starts while preserving full read access.
- Every collision request/progress/result/report contains matching non-empty Job ID/revision. Job A results never appear as Job B's active report.
- A maximum-velocity change calls `refreshDurationsForMechanics()` once, increments each duration-affected Job revision exactly once, changes the collision scene revision, cancels active validation once, and marks its report stale; duration-unaffected Jobs keep their revision.
- WS6 mounts exactly one `SimulationJobRuntimeBridge`; remount cleanup leaves exactly one active Mechanics subscription and zero duplicate duration refreshes.
- V1/V2 flat Poses migrate through WS1 to exactly one `job-default` / `Default Job` with order, IDs, angles, speed, easing, and durations preserved.
- An active Project always wins over legacy localStorage. No-project recovery retains the legacy key until successful V3 save and never writes subsequent Job edits back to it.
- Save, reload, Export, and Import preserve Jobs, active Job, Pose order, speed, easing, and angles exactly.
- Existing collision gates remain: 20,000 samples, 10,000 findings, 250-sample progress cadence, and 10 Hz current-pose execution.

## Self-Review

- **Spec coverage:** Tasks 1-5 cover direct Job ownership, CRUD/duplicate, Pose editing, Mechanics-duration synchronization, playback, OPC read-only enforcement, report identity/staleness, frozen V3 runtime integration, WS1 migration acceptance, legacy recovery, accessibility, and release evidence.
- **WS1 ownership:** No task changes Project schema, version, migration, validator, or codec. Task 4 only consumes WS1 output and integrates runtime capture/commit.
- **Authority audit:** Project V3 is the only durable authority. The legacy key is recovery input only and is removed after successful save.
- **Type consistency:** `SimulationJobV1` and `snapshot.simulation` are imported from WS1 everywhere; `jobRevision` is numeric in playback, collision protocol, reports, and persistence.
- **Placeholder scan:** Run `rg -n "T[B]D|T[O]DO|F[I]XME|f[i]ll in|impl[e]ment later|appropr[i]ate error handling|sim[i]lar to Task" docs/superpowers/plans/2026-07-13-simulation-jobs.md`; expect exit code 1.
- **Scope scan:** Run `git status --short -- docs/superpowers/plans/2026-07-13-simulation-jobs.md`; during planning it must list only this document as new/modified.
