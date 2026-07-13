# Geometry Proxy Collision Verification

This verification covers the deterministic geometry-query implementation. It
does not certify RobotWare, SafeMove, PLC logic, stopping distance, or any
safety function.

## Automated coverage

The unit and integration suites cover:

- Box and Compound-Box validation, World OBB transforms, SAT axes, broad-phase
  filtering, stable findings, ignored pairs, and query telemetry;
- runtime Entity registration for Robot Links, Tool, held Objects, Workbench,
  Equipment, and imported Object Instances;
- the revision-driven 10 Hz current-pose scheduler without transform mutation;
- V1-to-V2 migration, canonical collision policy/Boxes, and atomic project
  restore;
- report encoding, navigation, visibility participation, and collision UI;
- deterministic Preview/Validate sampling, pure FK parity, Worker progress,
  cancellation isolation, sample/finding caps, and held-Object recomposition;
- a reference workload with seven Link Boxes, one Tool Box, 50 external Boxes,
  and exactly 1,000 Worker samples.

Run the complete local gate:

```powershell
npm run verify
```

## Browser acceptance split

`tests/geometry-collision.spec.ts` imports a generated V1 fixture and verifies
its owned V2 migration, current collision and near-miss results, unchanged
Robot/Object poses, Workbench participation, pair ignore/restore, finding
navigation, JSON/CSV downloads, persisted reload parity, and two-Pose
validation with a TCP-held Object.

`tests/project-roundtrip.spec.ts` is the independent V2 save/export/import gate.
Keeping V2 re-import out of the longer collision workflow avoids repeating the
same project codec path while preserving real-browser semantic coverage.

```powershell
npm run test:e2e
```

## Deployment and dependency gates

```powershell
npm run deploy:validate
npm run deploy:smoke
npm run deploy:smoke:opcua
npm audit --audit-level=high
```

The smoke commands require a working Docker Engine and clean up their temporary
Compose project. If Docker is unavailable, record the exact daemon or command
failure; a static Compose validation is not a substitute for a successful
runtime smoke.

## Resource and interpretation limits

- Current-pose execution is capped at 10 Hz.
- Sequence validation is capped at 20,000 samples and 10,000 findings.
- The reference proxy budget is seven Link Boxes, one Tool Box, one Workbench,
  and up to 256 external boxes; each Entity supports up to 16 Boxes and the
  project supports up to 1,024 Boxes.
- Broad-phase and narrow-phase telemetry counts proxy work only. It is not a
  render-FPS, STEP triangle, controller-cycle, or safety-performance metric.
- Findings use configured proxies and Approximate Clearance. They do not move
  scene Objects or provide automatic collision avoidance.

## Verification record (2026-07-13)

- `npm run verify`: passed. Oxlint reported no diagnostics; Vitest passed 73
  files and 439 tests; CAD validation reported seven valid Links, zero errors,
  and zero warnings; TypeScript and the Vite production build completed.
- `npx playwright test tests/geometry-collision.spec.ts --workers=1
  --timeout=300000`: passed one test in 3.2 minutes.
- `npx playwright test tests/project-roundtrip.spec.ts --timeout=180000`:
  passed one test in 1.6 minutes.
- `npm run test:e2e`: its test build passed, but the last combined run ended
  with one pass and one test-locator failure before the locator was corrected.
  The corrected geometry test and the independent V2 round-trip test then both
  passed with the commands above. Playwright now uses one Worker so the two
  OCCT-heavy imports do not compete for browser resources.
- `npm run deploy:validate`: static deployment contract passed.
- `npm run deploy:smoke`: Web image build, `nginx -t`, health probe, and cleanup
  passed on port 18080.
- `npm run deploy:smoke:opcua`: Web and Connector image builds, both health
  checks, same-origin OPC UA WebSocket probe, and cleanup passed.
- `npm audit --audit-level=high`: reported zero vulnerabilities.
- Production dependency/source scan: `@react-three/rapier` is absent from
  runtime dependencies and non-test production source has no Rapier/RigidBody
  callbacks. The lockfile still contains a development-only transitive Rapier
  package under `@types/three`; it is not imported or bundled by production.
- Changed-file placeholder/checkpoint scan: no unfinished implementation
  markers, temporary collision checkpoints, or console debug statements found.
- `git diff --check`: passed; line-ending conversion notices are informational
  and no whitespace errors were reported.
