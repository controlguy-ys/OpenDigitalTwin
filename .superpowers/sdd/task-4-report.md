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
