# Task 5 Report: One Manual Linear Axis and Robot Mounting

## Outcome

- Added one Project V3-owned axis-aligned Linear Axis with X/Y/Z direction,
  finite closed bounds, persisted Manual position, Move Home, one Object-or-Group
  carriage, and optional Robot attachment.
- Added the narrow `LinearAxisSourceV1` boundary and shipped only
  `ManualLinearAxisSource`. Successful Manual writes publish `GOOD` scalar
  frames after the durable command completes; rejected writes retain the last
  committed state.
- Added one-recipe Project V3 commands for create, position, Home, carriage,
  Robot attach/detach, and detached-only deletion. Carriage replacement and
  Robot mounting preserve World pose atomically.
- Rejected non-Object/Group carriage targets and OPC-UA-owned Objects before
  mutation. Fixed rail remains an ordinary MCP-level Object, while a carriage
  Group keeps its member Objects Group-local.
- Added the moving Frame visualization and same-animation-update World-matrix
  synchronization for the carriage descendants and Robot before current-pose
  collision sampling. Fixed rail geometry is not moved.
- Made the scene runtime publish computed World matrices and made `RobotModel`
  consume that matrix rather than any Robot configuration base coordinates.
- Added selected-Axis Inspector composition with the common Transform Inspector,
  bounded numeric/slider Manual position, uncommitted range diagnostics, Move
  Home, carriage selection/clear, Robot attach/detach, and detached-only delete.
- Corrected the existing scene validator to honor the normative closed relation
  `min <= home/current <= max`, including a valid zero-travel range.

## RED Evidence

1. Initial exact Task 5 RED:

   `npm run test:run -- src/features/scene/LinearAxisRuntime.test.tsx src/features/scene/LinearAxisInspector.test.tsx src/features/scene/linear-axis-source.test.ts src/features/scene/scene-command-service.test.ts`

   Result: 3 suites failed and 1 passed; 18 existing tests passed in 5.99s.
   The Manual source, Axis runtime, and Axis Inspector modules did not exist.

2. Durable commands and Robot matrix authority:

   `npm run test:run -- src/features/scene/scene-command-service.test.ts src/features/robot/RobotModel.test.ts`

   Result: 2 files failed; 7 expected tests failed and 28 passed in 4.62s.
   Six durable Axis methods were absent, and `RobotModel` used a conflicting
   World-pose fixture instead of the required computed World matrix.

3. Workcell/App integration correction:

   `npm run test:run -- src/features/scene/Workcell.test.tsx src/app/App.test.tsx`

   With only the unverified wiring temporarily removed, result: 2 files failed;
   2 expected tests failed and 4 passed in 6.79s. Workcell had no live Axis
   bindings, and selected-Axis Manual controls were absent while the common
   Transform Inspector remained present. Minimal wiring was then restored.

4. Normative closed-bound correction:

   `npm run test:run -- src/domain/project/scene-state-v1.test.ts`

   Result: 1 test failed and 6 passed in 3.02s because the existing validator
   rejected the spec-valid `min === home === current === max` range.

## GREEN Evidence

- Manual source, runtime, Inspector, commands, and Robot matrix slice:
  5 files / 50 tests passed in 7.82s.
- Workcell/App integration: 2 files / 6 tests passed in 6.67s.
- Closed-bound validator plus Axis Inspector: 2 files / 10 tests passed in 5.73s.
- Fresh required focused Task 5 suite: 20 files / 124 tests passed in 22.86s.
- Fresh full serial suite: 107 files / 885 tests passed in 292.23s.

## Exact Verification

- `npm run test:run -- src/features/scene src/features/robot`: PASS,
  20 files / 124 tests in 22.86s.
- `npx vitest run --maxWorkers=1`: PASS,
  107 files / 885 tests in 292.23s.
- `npm run lint`: PASS, exit 0.
- `npm run build`: PASS, exit 0. Vite retained the existing `path`/`crypto`
  browser-externalization notices and chunk-size advisory.
- `git diff --check`: PASS; line-ending conversion notices only.
- `git diff --cached --check`: PASS after staging only Task 5 implementation,
  tests, validator correction, integration wiring, and this report.

## Files Outside the Brief

- `src/app/App.tsx` and `src/app/App.test.tsx`: compose the existing common
  Transform Inspector with Manual Axis controls for the selected Axis.
- `src/features/scene/scene-runtime-selector.ts`: publish the computed World
  matrix consumed by both the Robot and Axis collision synchronization path.
- `src/domain/project/scene-state-v1.ts` and `scene-state-v1.test.ts`: align the
  inherited range validator with the normative inclusive inequality.
- `src/features/scene/Workcell.test.tsx`: prove Workcell supplies the published
  runtime and live Object/Robot roots to the Axis updater.
- `.superpowers/sdd/task-5-report.md`: replace the stale unrelated collision
  report with the required Task 5 TDD and verification evidence.

## Scope Boundary

- No OPC UA Axis nodes, subscription UI, interpolation, middleware, PLC/live
  writes, physics, motor dynamics, or collision mount-contact policy.
- No primitives/camera work, Legacy mode, deploy, transfer, restart, push, or
  merge.
- Project V3 remains the sole durable placement/attachment authority; Robot
  configuration base fields are not restored as a renderer transform owner.
- Existing held/safe deletion, OPC UA Object ownership, hierarchy/world-pose
  math, body portals, Jobs shell/keyboard behavior, and Robot Base Inspector
  ownership remain unchanged.

## Review Follow-up

### Outcome

- Preserved Object-owned non-unit scale while applying axis-driven World pose;
  current-pose collision snapshots now observe that same scaled World matrix.
- Made one stable App-owned `ManualLinearAxisSource` the shared renderer and
  Inspector authority for the active Axis identity. Durable position/Home
  changes synchronize in place without source recreation.
- Added coherent initial `GOOD` publication, post-commit publication, isolated
  subscriber failures, and an optional bounded subscriber-error callback.
- Subscribed the production renderer to position, quality, and timestamp. Equal
  timestamps remain valid, strictly older frames are ignored, and `STALE` or
  `BAD` frames retain the last accepted `GOOD` pose.
- Made animation ordering explicit: Axis transforms run at priority `-1`, then
  current-pose collision sampling runs at priority `0`.
- Rejected a held Object or a Group containing the held descendant both
  reactively in the Inspector and authoritatively inside the queued Project V3
  carriage recipe. No interaction state is written to durable Project data.
- After successful Axis deletion, the App-owned callback clears Scene
  selection, draft pose, and isolation. Failed deletion does not invoke it.
- Rejected blank, whitespace, and nonfinite Manual position drafts without a
  command while retaining the draft and diagnostic.

### RED and Correction Evidence

- Initial review RED: 8 files failed; 16 tests failed and 46 passed in 12.64s.
  Failures covered all seven review findings.
- The first full serial run found one compatibility regression in a minimal
  Robot runtime fixture: 107 files passed and 1 failed; 899 tests passed and 1
  failed in 298.72s. The matrix helper now defaults to Robot-safe unit scale,
  while the carriage Object call explicitly preserves Object-owned scale.
- Compatibility correction slice: 4 files / 28 tests passed in 6.96s.

### Final Verification

- Focused review suite: 8 files / 62 tests passed in 12.34s.
- Expanded Scene, collision, Project, and App suite: 43 files / 406 tests
  passed in 47.60s.
- Fresh full serial suite: 108 files / 900 tests passed in 290.96s.
- `npm run lint`: PASS.
- `npm run build`: PASS; only the existing browser-externalization notices and
  chunk-size advisory remain.
- `git diff --check`: PASS with line-ending conversion notices only.
