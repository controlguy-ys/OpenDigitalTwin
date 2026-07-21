# Task 4 Report: Robot Jobs and Desktop Shell

## Outcome

- Exposed the existing Project V3 `simulation.jobs` and `activeJobId` in a permanently visible Robot Jobs pane below Scene Objects.
- Added Project V3 Job/Pose commands for Job CRUD/selection, Pose capture, speed, move, and delete. Each command submits exactly one Project mutation recipe.
- Recomputed every affected Job's canonical outgoing Pose durations atomically and incremented its revision once for rename/Pose changes.
- Replaced side-by-side Timeline/Collision rendering with mutually exclusive, accessible bottom tabs and a Collision Finding-count badge.
- Added a fixed 100dvh shell, 60/40 browser-local draggable Sidebar split clamped to 35–75%, browser-local drawer/bottom-tab/theme preferences, and equivalent semantic Light/Dark tokens.
- Consolidated STEP/Robot imports, Box/Cylinder creation, and Group creation under Add. Robot Mechanics, Geometry, and Frames are available from selected-Robot Inspector tabs, not permanent top-bar buttons.
- Kept Project V3 as sole durable Job authority: published Job poses use a non-persisting playback read model, and Inspector Reset no longer clears active Project Job poses.

## RED Evidence

1. Initial exact RED command:

   `npm run test:run -- src/features/jobs src/features/ui src/app/AppShell.test.tsx`

   Result: 6 test files failed; 9 tests failed and 10 passed in 10.54s. Failures were the four missing Task 4 modules, absent Scene Objects/Robot Jobs regions and Add/split surfaces, side-by-side bottom composition, missing no-Job guidance, and zero durable Timeline command calls.

2. Selected-Robot Inspector RED:

   `npm run test:run -- src/app/AppShell.test.tsx`

   Result: 3 failed and 11 passed. `RobotTargetInspector` was undefined, App did not yet compose Robot Jobs/BottomWorkspace, and no-Job guidance was absent.

3. Fixed-shell contract RED:

   `npm run test:run -- src/app/AppShell.test.tsx`

   Result: 1 failed and 14 passed. `html`/`body` were not yet locked by the mounted shell contract.

4. Project-authority RED:

   `npm run test:run -- src/features/joints/robot-store.test.ts`

   Result: 1 failed and 13 passed because `replacePublishedKeyframes` did not exist.

5. Reset-authority RED:

   `npm run test:run -- src/features/joints/JointInspector.test.tsx`

   Result: 1 failed and 8 passed because Reset cleared the active Job playback projection.

## GREEN Evidence

- Job commands, Robot Job list, Bottom Workspace, and theme preference: 4 files / 9 tests passed in 6.62s.
- Fixed shell and production App composition: 1 file / 15 tests passed in 7.12s.
- Project Job playback projection and browser runtime: 2 files / 23 tests passed in 4.19s.
- Reset preserves Project Job poses: 1 file / 9 tests passed in 4.49s.
- Required focused Task 4 suite: 10 files / 40 tests passed in 13.97s.
- Fresh full serial suite: 104 files / 853 tests passed in 276.89s.

## Files Outside the Brief

- `src/features/joints/JointInspector.tsx` and `JointInspector.test.tsx`: route production Save Pose to the active Project Job, disable it with actionable no-Job guidance, and prevent Reset from clearing durable Project Job poses.
- `src/features/joints/robot-store.ts` and `robot-store.test.ts`: add a non-persisting published playback projection and stop legacy localStorage hydration from becoming a parallel Job authority.
- `src/features/project/browser-project-runtime.ts`: publish only the active Project V3 Job into that non-persisting playback projection.
- `.superpowers/sdd/task-4-report.md`: required implementation evidence report.

The pre-existing unstaged `.superpowers/sdd/task-4-brief.md` change was treated as user-owned input and was not edited or staged.

## Verification

- `npm run test:run -- src/features/jobs src/features/ui src/app`: PASS, 10 files / 40 tests in 13.97s.
- `npx vitest run --maxWorkers=1`: PASS, 104 files / 853 tests in 276.89s.
- `npm run lint`: PASS, exit 0.
- `npm run build`: PASS, exit 0; Vite reported dependency externalization and chunk-size advisory warnings.
- `git diff --check`: PASS (line-ending conversion notices only).
- `git diff --cached --check`: PASS; only Task 4 implementation/tests/report were staged, and the user-owned brief change remained unstaged.

## Scope Boundary

- No viewport spatial controls, TCP marker, camera overlay, Linear Axis, mount-contact, or other Task 5+ implementation.
- No PLC/PVI/OPC UA live writes, transfer, deploy, or restart.
- No push or merge.

## Review Fix Wave (2026-07-15)

### Outcome

- Removed the reachable legacy Pose sequence authority completely. The robot store now exposes only a non-durable Project publication projection for Timeline playback; it has no Pose save, hydration, clear, replace, reorder, delete, speed, or localStorage persistence API.
- Every published active-Job sequence increments `playbackResetRevision`, stops playback, and deterministically resets Timeline elapsed position, including switches between equal nonempty Pose sequences.
- Joint Inspector Save Pose now requires the Project V3 callback, disables without it or at known limits, prevents duplicate pending saves, and announces authoritative rejection text through an accessible alert.
- Timeline speed, move, and delete commands now share an awaited pending/error boundary, disable duplicate/conflicting actions while pending, and announce conflict/limit/publication failures.
- Added a narrow-screen Top bar controls disclosure containing Project, quality, Joint source, Add, and Theme functions in a viewport-bounded vertical overlay. The document remains fixed and the solution does not depend on top-bar horizontal scrolling.
- Added roving keyboard models to both tab composites and tree/context-menu keyboard navigation with Escape focus return.
- Added numeric UI/service coverage for 32 Jobs, 256 Poses per Job, and 2048 Poses per Project.

### RED Evidence

1. Initial review RED:

   `npm run test:run -- src/features/joints/robot-store.test.ts src/features/joints/JointInspector.test.tsx src/features/ui/Timeline.test.tsx src/features/ui/BottomWorkspace.test.tsx src/features/jobs/RobotJobList.test.tsx src/app/AppShell.test.tsx`

   Result: 6 files failed; 9 tests failed and 47 passed in 10.50s. Expected failures proved the legacy store APIs, resumable cursor after a Job publication, silent/untracked command failures, missing numeric UI gate, clipped narrow controls, and missing composite keyboard models.

2. Numeric Job command RED:

   `npm run test:run -- src/features/jobs/RobotJobList.test.tsx src/features/jobs/job-command-service.test.ts`

   Result: 1 file failed and 1 passed; 1 test failed and 8 passed. Duplicate remained enabled at the 32-Job limit.

3. Production type gate RED:

   `npm run build`

   Result: failed on `exactOptionalPropertyTypes` for the unavailable-reason prop and the six-angle playback projection tuple. Both were narrowed without runtime behavior changes.

### GREEN Evidence

- Review behavior slice: 6 files / 52 tests passed in 10.56s.
- Numeric Job/Pose limits: 2 files / 9 tests passed in 5.65s.
- Required focused suite: 16 files / 91 tests passed in 20.90s.
- Fresh full serial suite after the final type narrowing: 104 files / 859 tests passed in 289.26s.
- `npm run lint`: PASS, exit 0.
- `npm run build`: PASS, exit 0; only the existing dependency externalization and chunk-size advisories remained.
- `rg -n -F 'robot-sim.pose-sequence.v1' src`: no matches.

### Scope Boundary

- Project V3 remains the sole durable Job/Pose authority and each Job command still submits one Project recipe.
- No Task 5+ feature, legacy compatibility mode, PLC/PVI/OPC UA write, transfer, deploy, restart, push, or merge was added.

## Second Review Fix Wave (2026-07-15)

### Outcome

- Replaced the late CSS-only 959.98px Top bar breakpoint with a deterministic component-selected compact mode at `(max-width: 1199px)`. At exactly 960px the disclosure is present, the closed toolbar is removed from the accessibility tree with `hidden`, and opening it exposes Project, quality, Joint source, Add, and Theme controls without document or Top bar horizontal scrolling.
- Kept the expanded >=1200px layout on a bounded width budget: the Project name remains capped and ellipsized, while the compact overlay is viewport-bounded and vertically scrollable.
- Reconciled Robot Jobs roving focus synchronously to an existing active/first Job, or to New Job when empty. Focus follows a replacement Job after the focused ID disappears and recovers to a surviving target when a menu launcher is deleted.
- Menu Arrow/Home/End navigation now filters disconnected and native-disabled items, so the disabled Duplicate command at 32 Jobs is never focused.
- Added behavior coverage proving Save Pose announces its pending state, disables the trigger, and submits only once until the Project command settles.

### RED Evidence

1. Exact 960 compact contract:

   `npm run test:run -- src/app/AppShell.test.tsx`

   Result: 1 test failed and 16 passed. At the 960 compact contract the closed toolbar was still accessible because mode selection and `hidden` were absent.

2. Dynamic Robot Jobs focus:

   `npm run test:run -- src/app/AppShell.test.tsx src/features/jobs/RobotJobList.test.tsx src/features/joints/JointInspector.test.tsx`

   Result after correcting the test environment: Robot Jobs had three expected failures. ArrowDown stalled on disabled Duplicate, zero-to-first/Project replacement left a tree item at `tabIndex=-1`, and deleting a menu launcher lost focus to the document body.

### GREEN Evidence

- Review behavior slice: 3 files / 34 tests passed in 7.70s.
- Required focused suite: 16 files / 94 tests passed in 20.68s.
- Fresh full serial suite: 104 files / 862 tests passed in 284.92s.
- `npm run lint`: PASS, exit 0.
- `npm run build`: PASS, exit 0; only the existing dependency externalization and chunk-size advisories remained.
- Browser-plugin smoke attempt: Chrome connected and a 960x800 viewport override was applied, but local navigation was blocked by `net::ERR_BLOCKED_BY_CLIENT`; the viewport override and tab session were reset. The deterministic component/DOM/CSS contract is the responsive evidence for this wave.

### Scope Boundary

- All previous Project V3 authority, atomic Job command, limit, playback, shell, and accessibility closures remain in force.
- No alternate browser harness, Task 5+, Legacy, PLC write, transfer, deploy, push, or merge was added.
