# Task 6 Report: Explicit Robot Mount Contact

## Outcome

Implemented Robot mount contact as an explicit Project V3 collision-policy
surface instead of an implicit `LINK00|workbench` exemption.

- `deriveMountContactPairKey()` accepts only a complete Robot mount
  configuration whose base Link and mount surface are both active canonical
  collision participants. Invalid, incomplete, hidden, or stale configuration
  exempts nothing.
- The normal collision query evaluates the configured pair with the same OBB
  and warning-distance rules as every other pair, then extracts only that pair
  into `clear`, `near`, or `contact` mount state.
- Mount extraction does not change broad-phase candidate counts or narrow-phase
  test counts. The public finding count reflects only public findings after the
  configured mount row is extracted.
- Current-pose and sequence Worker paths derive and pass the same canonical
  mount pair. The Worker aggregates the most severe observed state using
  `contact > near > clear`.
- The mount pair is never inserted into `ignoredPairKeys`, never appears in the
  ignored-pair controls, and never receives Ignore/Restore actions.
- JSON reports expose `mountContactPairKey`, `mountContactState`, and the
  independently sorted user-managed `ignoredPairKeys`.
- The Collision panel presents the current source as `Live` or `Job`, reports a
  complete but unevaluated configuration as `Configured unavailable`, and uses
  `Incomplete` only when the active mount configuration itself is incomplete.

The geometry acceptance fixture was migrated to the current Project V3 Scene
archive surface (`scene/state.json`, Scene local poses, and Object Instance
scale). The Worker-only archive prunes redundant Robot STEP sources while
preserving the intended 5 Object Instances x 10 collision Boxes workload.

## Production Composition Regression

Production request instrumentation found that the held Object, canonical pair,
and static target were all present, but the Robot root was composed at
`[0, 0, 2.16]`. Project V3 already projects the absolute Robot Scene pose at
Workbench height (`z = 1.08`) into the runtime Robot configuration. The
Collision panel then added `WORKBENCH_TOP_Z` a second time.

Captured evidence:

- held Object: `object:collision-fixture`;
- static target: `object:collision-worker-load-00` at matrix translation
  `[0.725, 0, 2.315]`;
- held TCP-local position: `[0, 0, 0.09]`;
- incorrect Robot root: `[0, 0, 2.16]`;
- sequence result: 1,000 samples, zero findings, not truncated.

At the middle `J1 = 0` sample the duplicated mount offset put the held center at
`z = 3.395`, exactly `1.08 m` above the static probe. Sequence composition now
uses the Project V3 absolute Robot Scene pose once by composing MCP directly
with the configured base pose.

## TDD Evidence

### Mount query RED -> GREEN

The initial query tests failed because the hard-coded mount exemption suppressed
an unconfigured pair and no explicit mount state was returned. The new mount
derivation test initially failed because the module did not exist.

GREEN coverage proves:

- configured `contact`, `near`, and `clear` extraction;
- incomplete or inactive configuration exempts nothing;
- canonical active-participant validation;
- unchanged query telemetry and ordinary pair ordering.

### Protocol, Worker, current pose, and panel RED -> GREEN

Focused RED runs produced five protocol/current-pose/Worker failures and four
panel/adapter failures before the new mount fields and composition existed.
GREEN coverage verifies owned protocol validation, Worker severity aggregation,
current-pose Project configuration usage, panel/report separation, and the
absence of mount Ignore/Restore controls.

### Absolute Robot root RED -> GREEN

Command:

```text
npx vitest run src/features/collision/CollisionPanel.test.tsx --maxWorkers=1
```

Observed RED: 1 failed, 18 passed. The production-composed root was
`[0, 0, 2.16]` instead of `[0, 0, 1.08]`.

After removing the duplicated Workbench mount composition, the panel suite
passed 19/19. An exact Worker reproduction additionally proves that the aligned
root produces only middle-window held/static findings, while the double-mounted
root produces no findings.

Focused reproduction result:

```text
Test Files  2 passed (2)
Tests       33 passed (33)
```

## Review Follow-up Closure

The review follow-up added seven failing assertions before the fixes. They
covered a stale ignored mount pair suppressing narrow phase, mount leakage into
the public ignored-pair report/UI, missing sequence-result mount persistence,
disabled or not-yet-evaluated configuration semantics, and a Job report whose
mount state was worse than the current-pose state.

The follow-up implementation now guarantees:

- a configured mount pair is always evaluated even if a stale persisted policy
  also lists it as ignored;
- stale mount entries are sanitized from JSON report metadata and the
  user-managed Ignore/Restore surface;
- sequence validation persists its owned `mountContact` result in the Job
  report, and the panel display plus JSON export use that Job state while the
  Job report is active;
- disabled validation leaves a complete mount configuration unevaluated instead
  of manufacturing a false `clear` state;
- completeness and evaluation are separate, so a valid pair without a matching
  evaluation reads `Configured unavailable` rather than `Incomplete`.

The browser near-miss assertion was restored to require both a nonzero
Near-miss count and an exact `kind: 'near-miss'` row for the fixture/LINK00
pair. The fixture now enters at X = 135 mm through the imported archive, making
the +45 mm separation deterministic inside the unchanged 50 mm warning band.
Ignore, Restore, and the restored near-miss report row are asserted without
changing existing Playwright timeouts.

## Final Verification

Focused collision/domain gate:

```text
npm run test:run -- src/domain/collision src/features/collision
```

Result: 16 files, 138 tests passed, 0 failed.

Full serial Vitest gate:

```text
npx vitest run --maxWorkers=1
```

Result: 109 files, 930 tests passed, 0 failed in 273.09 seconds.

Geometry browser acceptance gate, with existing timeouts unchanged:

```text
npm run test:e2e -- tests/geometry-collision.spec.ts
```

Result: 3 tests passed, 0 failed in 4.2 minutes. This covers mount status and
report metadata, Ignore/Restore separation, Save/Export/reload preservation,
and responsive held-Object Worker validation.

Static and production gates:

```text
npm run lint
npm run build
git diff --check
```

Results:

- oxlint passed without diagnostics;
- TypeScript and Vite production build passed;
- diff whitespace check passed;
- Vite retained its existing OCCT `path` / `crypto` browser-externalization
  messages and main-chunk size warning.

No push, merge, deployment, or external runtime operation was performed.
