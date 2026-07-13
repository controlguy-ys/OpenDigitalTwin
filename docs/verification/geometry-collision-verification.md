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
  three exact nonzero broad-phase candidates, and exactly 1,000 Worker samples
  below the sample cap while intentionally pressuring the finding cap.

Run the complete local gate:

```powershell
npm run verify
```

## Browser acceptance split

`tests/geometry-collision.spec.ts` contains two isolated browser scenarios:

- **Test A — migration and round-trip:** imports a generated V1 fixture and
  verifies owned V2 migration, current collision and near-miss results,
  unchanged Robot/Object poses, Workbench participation, pair ignore/restore,
  finding navigation, JSON/CSV downloads, persisted reload, and migrated V2
  semantic parity.
- **Test B — Worker workload:** starts from a fresh page and imports a compact
  V2 workload with one STEP Asset, five Instances, and ten Compound Boxes per
  Instance. It proves the 50-external-Box reference budget without rendering
  50 STEP Instances, establishes a canonical TCP-held Object, and runs exactly
  1,000 samples. The assertion instruments the native Worker constructor and
  its 250/500/750/1,000-sample progress messages, then proves that multiple
  `requestAnimationFrame` callbacks run across those progress intervals while
  **Cancel Validation** is available. Its downloaded report must contain the
  held/static pair only in the middle of the motion (samples 400–600 and
  1.2–1.6 seconds), with the configured `worker-*` Compound-Box identifiers.

`tests/project-roundtrip.spec.ts` remains an independent general V2
save/export/import gate. Test A specifically covers V1-owned migration and its
persisted V2 result; Test B separately covers the heavier V2 Worker workload.

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

- `npm run verify`: passed. Oxlint reported no diagnostics; Vitest passed 74
  files and 451 tests; CAD validation reported seven valid Links, zero errors,
  and zero warnings; TypeScript and the Vite production build completed.
- Geometry Test A passed in 2.4 minutes in the final one-Worker combined run,
  including V1 migration, report workflows, and migrated V2 reload parity.
- `npx playwright test tests/geometry-collision.spec.ts --workers=1
  --timeout=300000 --grep "keeps browser animation responsive"`: passed
  Geometry Test B in 1.3 minutes. It exercised 59 live Boxes (seven Links, one
  Tool, one Workbench, and 50 external), native Worker construction and all
  four progress messages, canonical held-Object recomposition, sustained
  in-flight animation frames, and the downloaded report.
- `npm run test:e2e`: passed all three tests in 5.3 minutes with one Worker.
  Geometry Test A passed in 2.4 minutes, Geometry Test B in 1.2 minutes, and the
  general V2 project round-trip in 1.6 minutes.
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

The production-source and unfinished-marker scans above are reproducible in
PowerShell 5.1 with:

```powershell
$rapierHits = & rg -n -i "rapier|RigidBody|CuboidCollider|useBeforePhysicsStep" src package.json --glob "!**/*.test.*"
if ($LASTEXITCODE -eq 0) { $rapierHits; throw 'Production Rapier references remain' }
if ($LASTEXITCODE -ne 1) { throw "Rapier scan failed with exit code $LASTEXITCODE" }

$placeholderHits = & rg -n -i "T[B]D|T[O]DO|F[I]XME|console\.(log|debug)|check[p]oint" src/features/collision src/domain/collision tests/geometry-collision.spec.ts docs/operator/geometry-collision.md
if ($LASTEXITCODE -eq 0) { $placeholderHits; throw 'Unfinished collision markers remain' }
if ($LASTEXITCODE -ne 1) { throw "Placeholder scan failed with exit code $LASTEXITCODE" }
```
