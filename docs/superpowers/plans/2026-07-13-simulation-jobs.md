# Simulation Jobs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Group ordered Robot Poses into directly owned Simulation Jobs with deterministic CRUD, editing, playback, collision-validation identity, OPC UA read-only behavior, and authoritative Project V3 persistence.

**Architecture:** A pure Job domain validates immutable Job/Pose collections and applies the frozen monotonic `SimulationJobV1.revision` rule. Every interactive Job/Pose create, rename, duplicate, delete, selection, Save Pose, angle, order, speed, or easing command is asynchronous and submits exactly one byte-free `ProjectMutationService.replaceFromActive(recipe, [])` call. Only WS1's ordered runtime-bundle publication may update the Job Zustand store; that store is a read-only projection for selectors, never command-side authority. Pre-publication failure retains the old bundle, while finalization or post-finalization token-consumption/handle-activation failure after publication keeps the new Project pointer/cache/runtime/read model together and locks interaction in `recovery-required` until reload. The Robot store retains Joint telemetry and explicit `idle | playing | paused` transport state only. Timeline and collision validation consume the published `snapshot.simulation` projection. The isolated no-active-Project legacy bootstrap is initialization, not an interactive command: it creates one complete Project-with-recovered-Job candidate and atomically submits it once through WS1 `replaceUntrusted()`.

**Tech Stack:** React 19, TypeScript 6, Zustand 5, Vitest 4, Testing Library 16, Web Workers, Playwright 1.61, Dexie 4, fflate 0.8.

## Global Constraints

- **Prerequisite:** Complete and freeze WS1 Project V3 Foundation first. WS1 alone owns `WorkcellProjectSnapshotV3`, `SimulationJobV1`, V1/V2 flat-Pose migration, V3 validation, archive codec, and atomic Project replacement.
- Execute against the landed WS6 Stage A Mode shell. Job components own behavior; final SIMULATE placement and cross-feature browser acceptance remain WS6 Stage B work.
- Tasks 1-3 may run in parallel with other Wave 2 domain work. Before Task 4 edits the shared Project runtime bridge, land WS2 Task 4 first and rebase; WS4 Task 3 then lands after this Task 4.
- This plan consumes frozen WS1 Job fields and migration output. It does not change schema shape, schema version, migration rules, or codec paths.
- A Job directly owns its Poses. There is no shared Pose library, reference aliasing, linked copy, conditional branch, loop, Job chaining, PLC command, or OPC UA write.
- Preserve Pose order, six finite command-space Joint angles within the current Mechanics inclusive limits, easing `linear|easeInOut`, outgoing speed 1-100%, and the frozen G0 velocity-derived transition duration with the existing 16 ms minimum. Exact min/max angles pass; any outside value is rejected with no clamp or Job mutation. `durationMs` is redundant: non-terminal values must match the max-Joint-delta/maximum-velocity/speed formula within `1e-9 ms`, terminal is exactly `1000`, and easing affects interpolation shape rather than duration.
- Use the WS1 budgets exactly: at most 32 Jobs, 256 Poses per Job, and 2,048 Poses per Project. Exact boundaries pass; boundary plus one fails before mutation/commit.
- Job IDs are non-empty, immutable, and unique among Jobs; Pose IDs are non-empty, immutable, and unique across all Jobs. Job and Pose namespaces are separate, so one Job and one Pose may intentionally use the same text. New and duplicated Jobs start at revision 1. Duplicate creates fresh Job and Pose IDs in their respective namespaces and deep-copies all Pose tuples.
- `SimulationJobV1.revision` is a positive monotonic integer for motion content. Pose add/delete/reorder, angles, outgoing speed, easing, and derived-duration changes increment it exactly once; display-name changes do not increment it. Migration starts at revision 1.
- Save current Pose defaults are fixed at persisted `speedPercentToNext: 100`, `easing: 'easeInOut'`, and terminal `durationMs: 1000`. When that Pose gains an outgoing successor, recompute its duration from Joint delta, current Mechanics maximum velocities, and speed with the existing 16 ms minimum; the terminal placeholder is never added to playback elapsed time.
- If no Job exists, Save Pose creates `Job 1`, selects it, and appends `Pose 1` in one byte-free Project recipe, one durable commit, and one runtime publication.
- Playback consumes only the active Job and snapshots its `jobId`, numeric `revision`, and Poses at Play. Both `playing` and `paused` retain that active run and reject Job selection, every Job/Pose mutation, and every Simulation/OPC-UA Joint-source change in the UI and command/source services. Among user actions only explicit Stop returns transport to `idle`, retains the current displayed Joint angles, and unlocks Jobs. Natural completion publishes/retains the final Pose once; a fatal source-quality/playback error retains the sampled current interpolated Pose and reports the reason. Those are the only non-user terminal paths and both return to `idle`.
- In OPC UA Joint mode, Jobs and Poses remain readable, but Job create/rename/duplicate/delete/select, Pose angle/reorder/speed/easing edit, Save Pose, and playback are rejected in both the UI and async command service.
- Project V3 is authoritative after load/import. Runtime code must not continue mirroring Jobs to the legacy `robot-sim.pose-sequence.v1` localStorage key.
- Job/Pose command services receive only WS1's frozen byte-free active projection, return a detached next projection, and always pass an empty prepared-source group list. They never import `ProjectCommitCoordinator`, construct source handles, stage bytes, mutate a Zustand store first, or publish a speculative revision.
- Every command has one in-flight state. While it is pending, its initiating control and conflicting Job/Pose controls are disabled and a direct second invocation is rejected before a second mutation-service call. Success clears pending only after one durable revision and one runtime publication. Validation, preparation, stale revision, pre-publication storage failure, cancellation, or runtime-publication failure with successful WS1 compensation clears pending and preserves the prior active revision, runtime bundle, Job read model, selection, and visible Job/Pose values byte-for-byte. If finalization or post-finalization prepared-token consumption/handle activation fails after the new runtime publishes, preserve the new publishing/stable pointer, cache, runtime, and Job read model together as applicable, expose `recovery-required`, keep Job interaction locked, and request reload; do not claim or attempt a feature-local rollback.
- Failure to dispose the old in-memory runtime after stable finalization is success-with-warning: keep the committed new pointer/cache/runtime/Job read model, resolve the Job command, emit the bounded WS1 diagnostic, and retry only the old resource cleanup.
- Consume the WS1 `createPortableId()` utility as the production default for every new/duplicated Job and Pose ID. Tests may inject `idFactory`; production code never calls `crypto.randomUUID()` or `Math.random()` directly. If the portable crypto source is unavailable or ID allocation fails partway through a duplicate, the complete Job/Pose candidate is discarded before the single Project mutation-service call; no Zustand publication occurs.
- Mechanics changes never reach the Job store first or trigger a post-commit repair subscription. The WS1 `reconcileSimulationForMechanicsChange()` helper builds Robot Mechanics plus affected Job durations/revisions into the same Project candidate; WS2 submits it once, and the WS3 runtime bridge publishes that already-consistent bundle.
- Legacy localStorage recovery never overwrites or merges into an active Project. It runs only when no active Project record exists. After any active Project is successfully integrity-hydrated and its pointer is stable—including reload recovery after a prior finalization failure—the legacy key/banner is removed idempotently exactly once; failed hydration leaves it intact. This prevents stale recovery data from resurrecting if the active Project is later cleared.
- The no-active-Project recovery exception never commits an empty Project first. It builds one complete validated V3 New-Project snapshot containing the recovered Job and calls `ProjectMutationService.replaceUntrusted()` once. Pre-publication or compensated runtime-publication failure leaves no active Project and retains the legacy key, so startup can retry; post-publication finalization failure keeps the new recovery Project and key under `recovery-required`; the next successful stable hydration/finalization removes the key. All later interactive Job/Pose changes use byte-free `replaceFromActive(recipe, [])`.
- Collision requests, progress, results, reports, and exports carry both `jobId: string` and `jobRevision: number`; a report from one Job is never displayed as the active report of another.
- Preserve existing pause/resume/stop semantics, speed calculation, collision sample cap 20,000, findings cap 10,000, 250-sample progress cadence, and 10 Hz current-pose collision.
- No PLC, Robot deployment, IK, dynamics, or safety-rated behavior is in scope.
- Preserve unrelated user changes; use failure-first tests and one focused commit per task.

---

### Task 1: Job Domain, Async Commands, and Published Read Model

**Files:**
- Create: `src/domain/jobs/simulation-job.ts`
- Create: `src/domain/jobs/simulation-job.test.ts`
- Create: `src/features/jobs/simulation-job-store.ts`
- Create: `src/features/jobs/simulation-job-store.test.ts`
- Create: `src/features/jobs/simulation-job-command-service.ts`
- Create: `src/features/jobs/simulation-job-command-service.test.ts`
- Create: `src/features/jobs/SimulationJobRuntimeBridge.tsx`
- Create: `src/features/jobs/SimulationJobRuntimeBridge.test.tsx`
- Modify: `src/features/joints/keyframes.ts`
- Modify: `src/features/joints/keyframes.test.ts`
- Modify: `src/features/joints/robot-store.ts`
- Modify: `src/features/joints/robot-store.test.ts`

**Interfaces:**
- Consumes: frozen WS1 `SimulationJobV1`, `deriveCanonicalPoseDurationMsV3()`, `reconcileSimulationForMechanicsChange()`, `createPortableId()`, and Job/Pose budget constants from `src/domain/project/project-v3.ts`; existing `RobotKeyframe` remains migration-only.
- Consumes: WS1 `ProjectMutationService.replaceFromActive()` and the frozen `ByteFreeWorkcellProjectProjectionV3`; no WS3 module imports the internal `ProjectCommitCoordinator`.
- Produces: pure Job candidate helpers, async `SimulationJobCommandService`, read-only `SimulationJobReadModelState`, stable selectors, and a controlled `SimulationJobRuntimeBridge` that WS6 Stage B mounts once. The Robot store no longer owns/persists `keyframes`, and WS3 creates no Mechanics-duration subscription.

- [ ] **Step 1: Write failing domain tests** for Job-ID uniqueness among Jobs, Pose-ID uniqueness across all Jobs, acceptance when a Job ID and Pose ID have the same text, immutable IDs, non-empty Job/Pose names, independent Job/Pose rename validation at exactly 128/129 UTF-8 bytes, six finite angles, each Joint's exact Mechanics min/max accepted and fixed `1e-9 deg` outside rejected as `PROJECT_JOB_POSE_OUT_OF_LIMITS`, Save Pose defaults `100% / easeInOut / 1000 ms terminal`, terminal duration exclusion from elapsed playback, speed 1 and 100 accepted, 0/101 rejected, supported easing, exact frozen G0 derived duration, acceptance at `1e-9 ms` error, rejection immediately above it, terminal 999/1001 rejection, 16 ms minimum outgoing duration, 32/256/2,048 boundaries, owned tuples, revision starting at 1, one increment per motion edit, and display-name exclusion from revision.

```ts
it('increments the frozen Job revision only for motion-affecting edits', () => {
  const job = jobWithTwoPoses()
  expect(renameJob(job, 'Renamed').revision).toBe(job.revision)
  expect(withPoseSpeed(job, 50).revision).toBe(job.revision + 1)
})
```

- [ ] **Step 2: Write failing command/read-model/runtime-publication tests** for async create, Job/Pose rename, duplicate, delete, select, Save Pose, Pose angle replacement/delete/reorder, speed/easing edit, injected ID generation, and deep ownership. For every valid command, spy on `ProjectMutationService.replaceFromActive()` and require exactly one byte-free recipe, exactly `[]` source groups, one durable revision, one runtime publication, and then one read-model notification; before publication the old Job/Pose/selection remains visible. Inject validation, preparation, revision-write, pointer, cancellation, stale-active-revision, and runtime-publication-with-successful-compensation failures and require the old revision/runtime/read model byte-for-byte, no speculative Zustand write, and pending cleared. Separately inject finalization or post-finalization token-consumption/handle-activation failure after publication and require the new pointer/cache/runtime/read model to remain mutually consistent, `recovery-required` to lock commands/playback, and reload to be requested; assert zero feature-local rollback. Hold the first Promise, invoke the same or a conflicting command again, and prove controls remain disabled and there is still exactly one mutation-service call. Run production-default creation with a `getRandomValues`-only crypto source and assert RFC-v4 unique Job/Pose IDs. With neither portable crypto API, assert `PORTABLE_ID_CRYPTO_UNAVAILABLE` and byte-for-byte unchanged Job state; make an injected duplicate factory throw after allocating the new Job ID but before all Pose IDs and prove no mutation-service call or publication occurs. `savePose()` and `setPoseAngles()` accept exactly six finite command-space degrees within current Mechanics. `renamePose()` validates the supplied name before constructing a recipe, changes no motion content or Job revision, and submits exactly one mutation on success. Test exact per-Joint boundaries; `1e-9 deg` outside returns `PROJECT_JOB_POSE_OUT_OF_LIMITS`, clamps nothing, and changes no Pose/Job/revision. A valid `setPoseAngles()` replaces only the selected Pose tuple, recalculates both the preceding incoming duration and selected outgoing duration when present, preserves terminal `1000`, and increments the owning Job revision exactly once. Assert duplicate is inserted after its source, named `Name Copy` / `Name Copy 2`, receives fresh IDs, starts at revision 1, and becomes active. Assert deleting the active Job selects the next Job at that index, otherwise the previous, otherwise `null`. Publish one WS1/WS2 candidate that changes Robot maximum velocity and already contains reconciled Jobs; prove the bridge replaces Robot/Jobs in one notification, every duration-affected Job has one revision increment, unaffected Jobs retain identity/revision, and zero follow-up store mutation/subscription fires.

```ts
const pendingCopy = commands.duplicateJob('job-a')
expect(jobReadModel.getState().jobs).toEqual([source])
const copy = await pendingCopy
expect(copy.id).not.toBe('job-a')
expect(copy.poses.map(({ id }) => id)).not.toEqual(source.poses.map(({ id }) => id))
expect(copy.poses.map(({ anglesDeg }) => anglesDeg)).toEqual(
  source.poses.map(({ anglesDeg }) => anglesDeg),
)

projectRuntime.publish(candidateWithReconciledMechanicsAndJobs({ maxVelocityDegPerSec: 90 }))
expect(jobReadModel.getState().jobs.find(({ id }) => id === 'job-a')?.revision)
  .toBe(source.revision + 1)
expect(jobReadModelPublicationSpy).toHaveBeenCalledTimes(1)
```

- [ ] **Step 3: Verify RED** with `npm run test:run -- src/domain/jobs src/features/jobs/simulation-job-command-service.test.ts src/features/jobs/simulation-job-store.test.ts src/features/jobs/SimulationJobRuntimeBridge.test.tsx src/features/joints/keyframes.test.ts src/features/joints/robot-store.test.ts`; expect missing modules and old Robot-store ownership failures.
- [ ] **Step 4: Implement immutable validation, async commands, and the published read model.** Inject `idFactory`, `now`, `getMechanics`, `assertEditable`, and `ProjectMutationService` dependencies for deterministic tests; default `idFactory` exactly to WS1 `createPortableId`. Allocate and validate every Job/Pose ID into a detached byte-free recipe result before calling `replaceFromActive(recipe, [])`, so a crypto/duplicate-allocation failure mutates nothing. Use WS1 `validateSimulationPoseLimitsV3()` for hydration, Save, explicit update, and playback snapshot preparation; reject rather than clamp. On hydration reject non-terminal duration error above `1e-9 ms`, canonicalize accepted values to the exact frozen result, and require terminal `1000`. Recalculate affected outgoing segment durations after Job-owned angle/order/speed changes; easing changes revision/interpolation shape but not duration. Mechanics edits are prohibited on this command path and arrive only in an already reconciled Project runtime bundle. Keep pending/error in a separate command controller/state, not in the Job read model. Only the bridge's internal action replaces Jobs/active ID when WS1 synchronously publishes a runtime bundle. A later finalization failure does not reverse that projection; the global recovery state locks the consistent published new read model.

```ts
export interface SimulationJobReadModelState {
  readonly jobs: readonly SimulationJobV1[]
  readonly activeJobId: string | null
}

export interface SimulationJobCommandState {
  readonly pendingCommand: string | null
  readonly commandError: string | null
  readonly recoveryRequired: boolean
}

export interface SimulationJobCommandService {
  createJob(name?: string): Promise<string>
  renameJob(jobId: string, name: string): Promise<void>
  duplicateJob(jobId: string): Promise<SimulationJobV1>
  deleteJob(jobId: string): Promise<void>
  selectJob(jobId: string): Promise<void>
  savePose(anglesDeg: JointAnglesDeg): Promise<void>
  renamePose(jobId: string, poseId: string, name: string): Promise<void>
  setPoseAngles(jobId: string, poseId: string, anglesDeg: JointAnglesDeg): Promise<void>
  movePose(jobId: string, poseId: string, direction: -1 | 1): Promise<void>
  deletePose(jobId: string, poseId: string): Promise<void>
  setPoseSpeed(jobId: string, poseId: string, speedPercent: number): Promise<void>
  setPoseEasing(jobId: string, poseId: string, easing: RobotKeyframeEasing): Promise<void>
}
```

- [ ] **Step 5: Publish already reconciled Project Jobs through a controlled bridge, remove flat Pose ownership, and verify GREEN.** `SimulationJobRuntimeBridge` applies each WS1-published authoritative runtime bundle once through an internal store-only publication action and owns no Mechanics subscription; WS6 Stage B mounts that bridge exactly once. The command service never calls that action. Delete keyframe/localStorage actions from `RobotStoreState`; keep joint angles, quality, gripper, and replace the playback boolean with `playbackStatus: 'idle' | 'playing' | 'paused'`. Run each command in order and stop at the first non-zero exit; expect PASS.

```powershell
npm run test:run -- src/domain/jobs src/features/jobs src/features/joints
npm run lint
npm run build
```

- [ ] **Step 6: Commit.** Run each command in order and stop at the first non-zero exit.

```powershell
git add src/domain/jobs src/features/jobs/simulation-job-command-service.ts src/features/jobs/simulation-job-command-service.test.ts src/features/jobs/simulation-job-store.ts src/features/jobs/simulation-job-store.test.ts src/features/jobs/SimulationJobRuntimeBridge.tsx src/features/jobs/SimulationJobRuntimeBridge.test.tsx src/features/joints/keyframes.ts src/features/joints/keyframes.test.ts src/features/joints/robot-store.ts src/features/joints/robot-store.test.ts
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
- Consumes: Task 1 Job read-model selectors and async command service, existing Simulation/OPC UA sources, `sampleTimeline()`, and Robot playback transport.
- Produces: shared `JointSourceModeState`, controlled `JobToolbar`, active-Job Timeline, feature-scoped styling, accessible async Job CRUD plus Pose angle/reorder/speed/easing controls, and a command-enforced `assertSimulationJobEditable()` gate for WS6 Stage B placement.

- [ ] **Step 1: Write failing authority/UI tests** proving Simulation mode permits edit/play, OPC UA mode permits read only, and playback blocks Job switch/mutation plus the Joint-source selector. Test Job selector, New, Rename, Duplicate, Delete confirmation, exact Pose count/duration, Save Pose creating `Job 1` / `Pose 1`, an accessible per-row Rename Pose action, a keyboard-operable `Update Pose from current Robot` action that awaits `setPoseAngles()` with the six current Simulation angles, speed/easing controls, arrow-button reorder, and explicit disabled reasons. Hold a command Promise and prove its initiating and conflicting controls are disabled, rapid double click causes one service call, and the old published values remain visible before publication. A compensated/pre-publication rejection restores controls/focus with the prior values plus an accessible error; a post-publication finalization failure instead shows the consistent new read model, a recovery/reload message, and leaves controls locked. Updating a middle Pose must refresh its incoming/outgoing displayed durations without creating a second revision increment. While `playing` or `paused`, attempting Simulation-to-OPC-UA source change through either UI or the source store throws/rejects with `Stop playback before changing Robot Joint source.` and performs no implicit Stop.

Use `TextEncoder` multibyte fixtures for New/Rename Job and Rename Pose: Job and Pose names accept exactly 128 UTF-8 bytes and reject 129 before ID allocation or `ProjectMutationService` invocation, associate the error with the field, focus it from the summary, and never truncate. Save Pose keeps the deterministic automatic `Pose N` name and exposes no hidden caller-supplied name. Domain validation remains the final authority.

```tsx
setJointSourceMode('opcua')
render(<JobToolbar />)
expect(screen.getByRole('button', { name: 'New Job' })).toBeDisabled()
expect(screen.getByText('OPC UA owns Robot joints; Jobs are read-only.')).toBeVisible()
```

- [ ] **Step 2: Write failing playback tests** proving Play revalidates the active Job's six angles against current Mechanics before snapshot, rejects an injected out-of-limit Job without moving the Robot or entering `playing`, and otherwise snapshots only the active Job. Pause changes transport to `paused` and resumes the same snapshot/position; among user actions Stop alone changes transport to `idle` and resets time without moving the Robot; natural completion publishes/retains the final Pose once and returns `idle`; fatal BAD/STALE/playback error samples/retains the current interpolated Pose, records one terminal reason, and returns `idle` without snapping final. Fewer than two Poses disables Play, hidden-document state becomes `paused`, and Job/source switch remains impossible while either playing or paused.
- [ ] **Step 3: Verify RED** with `npm run test:run -- src/features/joints/joint-source-mode-store.test.ts src/features/jobs/JobToolbar.test.tsx src/features/ui/Timeline.test.tsx src/features/joints/JointInspector.test.tsx`; expect missing Job UI/source-mode authority.
- [ ] **Step 4: Implement shared source authority and active-Job UI.** Move `sourceMode` out of component-local state into the new store. Its mutation action must read/inject Robot playback state and reject every source change while `playbackStatus !== 'idle'`; the UI disables the selector and exposes the same textual reason, so disabled HTML is not the only guard. Make the async Job command service read this source store and Robot playback state before constructing its recipe. Bind component controls to separate command pending/error state, never optimistically patch the Job read model, and restore focus to the initiating control after normal success or compensated/pre-publication failure; a recovery-required result focuses the recovery alert and keeps controls locked. Expose an accessible `Rename Pose` action for each Pose row and `Update Pose from current Robot` only as an explicit operator action; selecting a Pose or moving current Robot Joints never overwrites stored angles implicitly. Use accessible buttons as the non-drag alternative for every Pose move.

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
- Consumes: active Job ID/numeric revision/Poses, existing full-scene `revision`, Worker caps, Job-edit subscriptions, and already-reconciled Project bundle publication events.
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
- [ ] **Step 4: Implement protocol threading and report map.** Keep `revision` as the full scene signature and add Job identity separately. Include Robot Mechanics in that scene signature; observe the one authoritative bundle publication carrying both new Mechanics and reconciled Job revisions, then coalesce its simultaneous scene/Job invalidation into one effective Worker cancel. Store immutable reports by Job ID; reject a report whose Job revision differs from the current Job content. Do not create a separate duration writer.

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
- Consumes: WS1 byte-free V3 active projections/migration output, `ProjectMutationService.replaceFromActive()` for active-Project commands, `ProjectMutationService.replaceUntrusted()` for the one no-active recovery bootstrap, Task 1 published read-model bridge, and legacy key `robot-sim.pose-sequence.v1`.
- Produces: V3 Job durable-command/runtime-publication integration, `recoverLegacyPoseSequence()`, `completeLegacyRecoveryAfterStablePublication()`, `discardLegacyRecoveryAfterStableActiveHydration()`, a recovery warning/banner, and semantic V1/V2/V3 browser round-trip evidence. It imports no `ProjectCommitCoordinator`.

- [ ] **Step 1: Write failing runtime tests** proving the active byte-free Project projection—not the Zustand read model—is the command recipe input, a stable published bundle atomically replaces Jobs/Poses/active ID and stops playback, and pre-publication/runtime-publication failure with successful compensation leaves the old revision/runtime/read model unchanged. Prove post-publication finalization or post-finalization token-consumption/handle-activation failure retains the mutually consistent new pointer/cache/runtime/read model under `recovery-required`, while old-bundle disposal failure resolves success with the new state plus one bounded cleanup warning. Save/reload restores exact order/speed/easing, and Project import never merges existing runtime Jobs.

```ts
expect((await projectRepository.readActiveProjection()).simulation.jobs).toEqual([
  expect.objectContaining({ id: 'job-a', poses: expectedOwnedPoses }),
])
```

- [ ] **Step 2: Write failing legacy-recovery tests** for the exact authority order:
  1. An active V3 or WS1-migrated V1/V2 Project always wins and legacy localStorage is not merged.
  2. With no active Project and a valid legacy array, build one complete standard New-Project V3 snapshot containing exactly one selected `Recovered Poses` Job and submit it once through `replaceUntrusted()`; never publish or commit an empty baseline first.
  3. Preparation, pre-publication commit, or compensated runtime-publication failure leaves no active Project, retains the key/recovery banner, and publishes no recovered in-memory Job so the next startup retries. Finalization or post-finalization token-consumption/handle-activation failure retains the key, keeps the newly published recovery Project consistent under `recovery-required`, and requests reload. Only successful stable publication plus active handles removes the key/banner.
  4. Invalid JSON/records move raw text to `robot-sim.pose-sequence.v1.quarantine`, remove the active legacy key, show one warning, and do not crash.
  5. Starting with an active stable Project plus a stale key removes that key once only after integrity hydration succeeds. Starting from recovery publication followed by finalization failure retains the key; reload then hydrates/finalizes the same active Project and removes it exactly once. Failed hydration/finalization never removes it.

```ts
expect(recoverLegacyPoseSequence({ activeProject: null, storage })).toMatchObject({
  recoveredJob: expect.objectContaining({ name: 'Recovered Poses' }),
  removeLegacyAfterStablePublication: true,
})
```

- [ ] **Step 3: Verify RED** with `npm run test:run -- src/features/jobs/legacy-pose-recovery.test.ts src/features/project/browser-project-runtime.test.ts src/features/project/project-store.test.ts src/features/project/ProjectMenu.test.tsx`; expect missing recovery and old flat-Pose runtime behavior.
- [ ] **Step 4: Implement runtime integration without touching WS1 schema/codec/migration.** Normal Job commands already persist through one byte-free `replaceFromActive(recipe, [])`; never capture or recommit Zustand Job state. After Project hydration or ordered runtime publication, the runtime bridge internally replaces its read-only projection from `snapshot.simulation` exactly once. If startup integrity-hydrates a stable active Project (or finishes recovery of its publishing pointer), call `discardLegacyRecoveryAfterStableActiveHydration()` idempotently after stability is proven, never before. Run recovery only after Project hydration returns no active record: combine the standard New-Project defaults and recovered Job in one validated detached snapshot, then call `replaceUntrusted()` once; WS1's transaction verifies that the expected active pointer is still `null`. Never commit an empty baseline, never publish an in-memory recovery first, and never write live Job edits to the legacy key.
- [ ] **Step 5: Verify migration/round-trip GREEN.** Use WS1 V1/V2 fixtures in `tests/project-roundtrip.spec.ts` and assert flat Poses arrive as exactly one `job-default` / `Default Job` with IDs/order/angles/speed/easing preserved, non-terminal durations recomputed from normalized V3 Mechanics/speed, terminal duration set to `1000`, and one bounded warning when legacy timing changed; then V3 Export/Import remains semantically equal. Run focused tests and `npm run test:e2e -- tests/project-roundtrip.spec.ts`.
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

- [ ] **Step 1: Write the failing controlled integration workflow** covering no-Job Save Pose, Job CRUD/duplicate IDs, explicit Pose-angle replacement plus incoming/outgoing duration reconciliation, Pose order/speed/easing, active-only playback, playback lock, OPC UA read-only, and Job-scoped collision identity without mounting App/AppShell. For each mutation class, assert one async byte-free recipe, empty source groups, no optimistic read-model change, one stable runtime publication on success, unchanged old revision/runtime/UI on pre-publication failure or blocked double-submit, recovery lock with the consistent new bundle on post-publication finalization failure, and success-with-warning on old-bundle disposal failure.

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
- [ ] **Step 3: Complete accessible component evidence, handoff, and documentation.** Keyboard-only component tests must await Job selection/CRUD, explicit Pose update from current Robot, Pose reorder, speed/easing edits, playback, and validation. Pending operations disable conflicting controls, expose status text, reject double-submit, and preserve the last published values. Normal success or compensated/pre-publication failure returns focus; recovery-required focuses its alert and retains the interaction lock. Disabled operations expose a textual reason. `docs/integration/simulation-jobs-ws6-handoff.md` must freeze the exact Bridge/read-model selectors/async command props/Timeline integration and later browser scenarios for V1/V2 migration, legacy recovery, Save/reload, Export/Import, boundary rejection, commit failure, rapid double-submit, mode switching, and Job-scoped reports. Document direct ownership, one-command/one-revision/one-publication semantics, outgoing transition semantics, OPC read-only behavior, report identity, migration, recovery, limits, and exclusions.
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
- Job create/rename and Pose rename accept exactly 128 UTF-8 bytes and reject 129 before ID allocation or Project mutation, with no truncation and deterministic field focus. Save Pose assigns only the deterministic automatic `Pose N` name.
- Speed 1% and 100% pass; 0% and 101% fail. Segment duration never falls below 16 ms. Non-terminal duration matches the frozen G0 formula within `1e-9 ms`; a larger mismatch and terminal values other than exactly `1000` fail before mutation.
- Save Pose with zero Jobs produces exactly one selected `Job 1` containing exactly one `Pose 1` in one state notification. The Pose stores `speedPercentToNext: 100`, `easing: 'easeInOut'`, and terminal `durationMs: 1000`; terminal duration contributes zero playback elapsed time, and it is recomputed when it gains a successor.
- Replacing one stored Pose from the six current Simulation Joint angles is explicit and atomic: exactly six finite angles are required, the incoming and outgoing canonical durations are recalculated when present, terminal stays exactly `1000`, and the owning Job revision increments once. Selection or live Joint movement alone changes no stored Pose.
- Save/update/playback accept each Joint's exact command-space minimum/maximum and reject `1e-9 deg` outside as `PROJECT_JOB_POSE_OUT_OF_LIMITS`; no angle is clamped, no invalid playback starts, and a rejected Save/update changes no Job/Pose/revision.
- Duplicate creates one Job immediately after its source at revision 1, with fresh Job/Pose IDs, deep-equal motion content, and no shared mutable tuple.
- Playback publishes only the active Job snapshot and publishes the final Pose once. Both `playing` and `paused` permit zero Job/Pose mutations, Job switches, or Joint-source changes; Pause never ends or unlocks the active run, and a rejected source change performs no implicit Stop. Stop is the only user action that returns `idle` and unlocks Jobs while retaining the current Pose. Natural completion retains the final Pose; terminal quality/error failure samples and retains the current interpolated Pose plus one reason without snapping final. Those two non-user paths also close the run.
- OPC UA mode permits zero Job/Pose mutations and zero playback starts while preserving full read access.
- Every collision request/progress/result/report contains matching non-empty Job ID/revision. Job A results never appear as Job B's active report.
- A maximum-velocity change is reconciled by WS1/WS2 in one Project candidate, increments each duration-affected Job revision exactly once, changes the collision scene revision, cancels active validation once, and marks its report stale; duration-unaffected Jobs keep identity/revision. WS3 performs zero post-commit duration repairs.
- WS6 mounts exactly one `SimulationJobRuntimeBridge`; one published Project bundle causes one Job-store notification, remount cleanup leaves zero duplicate listeners, and no Mechanics subscription exists.
- V1/V2 flat Poses migrate through WS1 to exactly one `job-default` / `Default Job` with order, IDs, angles, speed, and easing preserved; non-terminal durations are canonically recomputed, terminal becomes `1000`, and a changed legacy value produces one bounded normalization warning.
- An active Project always wins over legacy localStorage. No-project recovery retains the legacy key until the one atomic recovered Project is stably hydrated; pre-publication failure leaves no active Project so startup can retry, post-publication finalization failure retains the key until reload recovery succeeds, and subsequent Job edits never write back. Any successfully integrity-hydrated stable active Project removes a stale key idempotently; failed hydration never does.
- Save, reload, Export, and Import preserve Jobs, active Job, Pose order, edited angles, speed, and easing exactly.
- Production Job/Pose creation and duplication use WS1 `createPortableId`; the getRandomValues-only path succeeds with unique RFC-v4 IDs, while missing crypto or a mid-allocation throw produces zero Job/Pose/revision mutation. Direct `crypto.randomUUID()` and `Math.random()` ID generation are absent.
- Every Job/Pose mutation invokes `ProjectMutationService.replaceFromActive()` exactly once with one byte-free recipe and zero prepared-source groups. A successful command creates one durable revision and one runtime/read-model publication; while pending, a rapid or conflicting second command creates zero additional calls. Validation, preparation, pre-publication storage, stale-revision, cancellation, or runtime-publication failure with successful compensation leaves the previous revision, runtime bundle, selection, Job/Pose values, and read model unchanged. Finalization or post-finalization token-consumption/handle-activation failure after publication instead preserves the new pointer/cache/runtime/read model together under `recovery-required` and locks interaction pending reload. Old-bundle disposal failure keeps the committed new state and resolves success with one bounded cleanup warning/retry.
- Zustand Job state has zero public CRUD/edit/select actions and is never captured as Project authority. It changes only when the single runtime bridge projects an ordered WS1 runtime-bundle publication; a post-publication recovery state keeps that new projection locked rather than rolling it back locally.
- Existing collision gates remain: 20,000 samples, 10,000 findings, 250-sample progress cadence, and 10 Hz current-pose execution.

## Self-Review

- **Spec coverage:** Tasks 1-5 cover direct Job ownership, CRUD/duplicate, Pose editing, Mechanics-duration synchronization, playback, OPC read-only enforcement, report identity/staleness, frozen V3 runtime integration, WS1 migration acceptance, legacy recovery, accessibility, and release evidence.
- **WS1 ownership:** No task changes Project schema, version, migration, validator, or codec. Task 4 only consumes WS1 output and integrates runtime capture/commit.
- **Authority audit:** Project V3 is the only command and durable authority. All Job/Pose commands use the public byte-free mutation service; the read model has no command-side writes. The legacy key is recovery input only and is removed after successful stable publication.
- **Type consistency:** `SimulationJobV1` and `snapshot.simulation` are imported from WS1 everywhere; `jobRevision` is numeric in playback, collision protocol, reports, and persistence.
- **Placeholder scan:** Run `rg -n "T[B]D|T[O]DO|F[I]XME|f[i]ll in|impl[e]ment later|appropr[i]ate error handling|sim[i]lar to Task" docs/superpowers/plans/2026-07-13-simulation-jobs.md`; expect exit code 1.
- **Scope scan:** Run `git status --short -- docs/superpowers/plans/2026-07-13-simulation-jobs.md`; during planning it must list only this document as new/modified.
