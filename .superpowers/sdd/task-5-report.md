# Task 5 Report: Collision Policy, Findings, and Report UI

## Outcome

Implemented the collision policy and findings inspection slice for the geometry
proxy runtime:

- extended the collision store with independently selectable policy, current
  findings, diagnostics, validation report, navigation, stale-report, and
  optional playback-pause state;
- added canonical `ignorePair()` / `restorePair()` actions, finite warning
  distance validation, owned incoming rows, and stable navigation clamping;
- added deterministic JSON and CSV report encoders with schema version 1,
  stable row ordering, RFC-style CSV escaping, exact product language, and a
  10,000-finding export cap;
- mounted an accessible `Geometry Proxy Collision` panel beside Timeline with
  millimetre policy input, live counts, diagnostics, ignore/restore controls,
  first/previous/next finding navigation, pause control, report downloads, and
  the non-safety disclaimer;
- connected collision red, near-miss yellow, and selection blue outlines for
  Robot Links, built-in/imported/held Objects, and the Workbench;
- focused only the selected finding pair without mutating scene transforms;
- kept policy persistence on the V2 browser runtime bridge and added a
  canonical ignored-pair capture regression test.

## TDD Evidence

### RED

Command:

```text
npm run test:run -- src/features/collision/collision-store.test.ts src/features/collision/collision-report.test.ts src/features/collision/CollisionPanel.test.tsx src/features/interaction/outline-state.test.ts
```

Observed expected failures before production implementation:

- missing `CollisionPanel` and `collision-report` modules;
- missing store actions `setCollisionEnabled`, `ignorePair`,
  `setValidationReport`, and navigation setters;
- existing outline code attempted `startsWith()` on a finding row and could not
  distinguish near misses.

Result: 4 test files failed, 5 new behavior tests failed, and 5 existing tests
passed.

### GREEN

Focused store/report/panel/outline command:

```text
npm run test:run -- src/features/collision/collision-store.test.ts src/features/collision/collision-report.test.ts src/features/collision/CollisionPanel.test.tsx src/features/interaction/outline-state.test.ts
```

Result: 4 files, 18 tests passed.

Expanded collision/App/outline integration command:

```text
npm run test:run -- src/features/collision src/features/interaction/outline-state.test.ts src/features/interaction/GraspController.test.tsx src/features/equipment src/features/robot/RobotModel.test.ts src/features/scene src/app src/features/project/browser-project-runtime.test.ts src/features/project/project-store.test.ts
```

Result: 22 files, 99 tests passed.

## Final Verification

```text
npm run test:run
```

Result: 68 files, 385 tests passed, 0 failed.

```text
npm run lint
npm run build
git diff --check
```

Results:

- oxlint passed;
- TypeScript and Vite production build passed;
- diff check passed.

Accessibility coverage uses semantic headings, checkboxes, spinbuttons,
navigation buttons, named lists, status text, and named download controls.
Download tests verify that both generated Blob URLs are revoked.

## Notes

- The UI and reports use the exact labels `Geometry Proxy Collision` and
  `Approximate Clearance`.
- Reports and UI state contain no STEP bytes or project secrets.
- Results remain proxy-based and are explicitly not physics, RobotWare,
  SafeMove, or safety-rated validation.
- Vite retains the pre-existing OCCT `path` / `crypto` browser-externalization
  messages and large-chunk warning; neither is introduced by this task and the
  production build succeeds.

## Fix Review

The post-implementation review identified three precision and render-isolation
gaps. They were corrected with a second RED-to-GREEN cycle:

- selected navigation now owns a stable full-row key containing both Entity
  IDs, both Box IDs, kind, signed clearance, sample index, and time. Reordered
  reports preserve the exact row; stale reports preserve selection; removal or
  source replacement resets to the first valid row;
- collision, near-miss, and selection color now come from the exact selected
  finding. A near-miss row and collision row sharing one pair no longer collapse
  to the collision severity;
- Robot Link, Equipment/Object, held Object, and Workbench rendering subscribe
  only to primitive per-Entity outline selectors. Unrelated navigation keeps
  unrelated participants and the top-level Canvas boundary from rerendering;
- report ordering now includes `firstEntityId` and `secondEntityId` before Box
  tie-breaks, making shuffled reversed-orientation JSON and CSV byte-identical.

Review RED result: 3 files failed with 5 expected failures and 11 existing
tests passing. Review GREEN results:

- focused: 5 files, 24 tests passed;
- expanded collision/UI integration: 23 files, 104 tests passed;
- full suite: 69 files, 390 tests passed with 0 failures;
- lint, production build, and diff-check passed.
