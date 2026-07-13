# Task 7 Report: Geometry Collision Acceptance and Evidence

## Outcome

Completed the Task 7 acceptance, performance, documentation, and deployment
evidence slice:

- added an isolated Test A with a generated V1 `.wdtwin` fixture covering
  migration, imported Object collision/near-miss, unchanged Object pose,
  Workbench participation, pair ignore/restore, navigation, JSON/CSV reports,
  and migrated V2 reload parity;
- added an isolated Test B with a compact V2 Worker workload, canonical
  TCP-held Object, exact scene Box telemetry, and report assertions over the
  held/static pair's middle-motion sample/time window;
- added deterministic query telemetry and a reference fixture with seven Link
  Boxes, one Tool Box, 50 external Boxes, three exact nonzero broad-phase
  candidates, and exactly 1,000 Worker samples below the sample cap while
  intentionally pressuring the finding cap;
- compressed the browser Worker fixture to one STEP Asset, five Instances, and
  ten Compound Boxes per Instance while instrumenting native Worker creation,
  all four progress messages, and sustained animation frames across partial
  progress intervals;
- exposed current-pose query telemetry without changing the existing findings
  API and preserved the current-pose transform-mutation regression;
- fixed missing React keys on Robot Link interaction portals found while
  exercising the real browser scene;
- serialized Playwright to one Worker because two simultaneous OCCT project
  imports exhausted browser resources;
- added operator, verification, README, and progress documentation.

## Browser evidence

Test A and Test B are intentionally isolated so their OCCT-backed imports do
not share a page or a singleton import client. Test A passed in 2.4 minutes in
the final one-Worker combined run. It owns V1 migration, current-pose/report
workflows, and the saved migrated-V2 reload comparison.

Test B passed with:

```text
npx playwright test tests/geometry-collision.spec.ts --workers=1 --timeout=300000 --grep "keeps browser animation responsive"
```

Result: one test passed in 1.3 minutes. The browser reported 59 live Boxes,
announced `object:collision-fixture` as the held Entity, exposed progress at
250/500/750/1000 samples, and executed sustained animation frames across
partial Worker progress intervals. The downloaded JSON contained the canonical
`object:collision-fixture|object:collision-worker-load-00` pair in samples
486–513, around 1.35–1.43 seconds, with `worker-*` Box IDs. The time differs
from the sample number because the 499.5-degree J1 move is duration-scaled by
the configured 180 degrees/second maximum velocity.

`tests/project-roundtrip.spec.ts` remains the independent general V2
save/export/import gate. It complements rather than replaces Test A's
V1-to-V2 migration round-trip.

## Final gates

- `npm run verify`: passed; 74 Vitest files and 451 tests, seven valid CAD Links,
  zero CAD errors/warnings, clean lint, and successful TypeScript/Vite build.
- `npm run test:e2e`: passed all three browser tests sequentially with one
  Worker in 5.3 minutes. Geometry Test A passed in 2.4 minutes, Geometry Test B
  in 1.2 minutes, and the general V2 project round-trip in 1.6 minutes.
- `npm run deploy:validate`: passed.
- `npm run deploy:smoke`: passed with real Web image build, Nginx validation,
  health probe, and cleanup.
- `npm run deploy:smoke:opcua`: passed with real Web/Connector builds, both
  services healthy, WebSocket probe, and cleanup.
- `npm audit --audit-level=high`: zero vulnerabilities.
- Production dependency/source Rapier scan: no runtime dependency or non-test
  source hit. A development-only transitive package remains under
  `@types/three` in the lockfile and is not bundled by production.
- Placeholder/checkpoint scan: no hits in changed implementation/docs.
- `git diff --check`: passed with no whitespace errors.

## Remaining concern

No geometry-collision acceptance or integration gate remains unverified.
Existing Vite OCCT-browser-externalization and large-chunk notices remain
non-fatal and are documented performance constraints rather than test failures.
