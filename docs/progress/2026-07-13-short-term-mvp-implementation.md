# Short-term WebDigitalTwin MVP Implementation — 2026-07-13

## Delivered in the portable-project slice

- Added a versioned V1 Workcell Project contract with finite-value, reference,
  STEP byte, mesh/material, and triangle-budget validation.
- Split new external imports into reusable Object Assets and transform/status
  Object Instances. Existing legacy Equipment records remain readable.
- Restricted a new custom Robot to exactly seven `LINK00–LINK06` STEP files.
  Single-Link replacement is a separate mode and never silently fills missing
  custom links with CRB geometry.
- Removed CRB-specific world-origin subtraction from generic Robot import.
- Persisted per-Link raw STEP, CAD-local transform, visibility, Box collision,
  and statistics independently from joint Mechanical configuration.
- Added the Robot Geometry editor and restored custom Geometry after reload.
- Added deterministic `.wdtwin` ZIP encoding with pre-expansion central
  directory checks, safe paths, fixed entry layout, source STEP preservation,
  and schema validation.
- Added a staged active Project Store with rollback to the previous central
  snapshot on decode, conversion, or commit failure.
- Added New, Save, Export, and Import controls to the top bar.
- Bundled the seven authoritative CRB STEP sources so the default workcell can
  also be exported as a complete portable project.
- Added the fixed `World → MCP → Robot Base → Joints → Flange → TCP`
  hierarchy. MCP, Robot Base, and TCP are manually editable and persisted;
  World and the joint-derived Flange are read-only.
- Parent Robot and Object rendering under MCP, and mount the gripper, grasp
  sensor, and held Object under TCP. Released Object world poses are converted
  back to MCP-local storage exactly once.
- Added a multi-stage unprivileged Nginx Web image and an optional profile-gated
  OPC UA Connector image under Docker Compose.
- Added independent Web/Connector health checks, same-origin `/opcua` WebSocket
  proxying, read-only filesystems, capability drops, bounded resources, and
  node-owned temporary PKI storage.
- Added static deployment contracts and real Web-only/OPC UA profile smoke
  orchestration with automatic cleanup.

## Corrected requirements carried into implementation

- The seven-file cap belongs only to Robot Import.
- One Object STEP is imported whole as one Object Asset; Object count is not
  capped at seven.
- Geometry configuration and Mechanical configuration are separate surfaces.
- A complete custom Robot requires seven Links. Partial Link replacement is an
  explicit operation, not a fallback to built-in CRB links.
- Security features remain excluded only for the short-term trusted-LAN target;
  this does not authorize public-internet exposure.

## Current resource budgets

- Robot: 25 MiB and 150k triangles per Link; 100 MiB and 600k triangles total.
- Object: 50 MiB and 250k triangles per Asset.
- Asset complexity: 64 meshes and 32 materials.
- Project raw STEP bytes: 256 MiB.
- Visible Scene: 1.5M triangles.

## Verification evidence

- `npm run test:run`: 52 files and 271 tests passed.
- `npm run lint`: passed.
- `npm run cad:validate`: 7 valid Links, 0 errors, and 0 warnings.
- Production TypeScript/Vite build: passed.
- Playwright MCP/Base/TCP edit → default-project Export → storage clear →
  Import semantic round-trip: passed in 1.1 minutes.
- Static deployment contract and Web-only/OPC UA Compose configurations:
  passed.
- Real Web-only smoke: clean image build, `nginx -t`, healthy Nginx, SPA probe,
  and cleanup passed.
- Real OPC UA profile smoke: both services healthy, Connector health, Nginx
  `/opcua` WebSocket handshake, and cleanup passed without an OPC UA server.
- `npm audit --audit-level=high`: 0 vulnerabilities.

## Delivered in the geometry-collision slice

- Replaced the physics collision runtime with deterministic Box/Compound-Box
  OBB queries for Robot Links, Tool, held Objects, Workbench, Equipment, and
  imported Object Instances.
- Added collision and near-miss policy, pair ignore/restore, stable finding
  navigation, red/yellow outlines, approximate-clearance JSON/CSV reports, and
  a non-safety disclaimer.
- Added a revision-driven current-pose scheduler capped at 10 Hz and a
  cancellable Web Worker for deterministic Preview/Validate Pose-sequence
  sampling. Sequence runs cap at 20,000 samples and 10,000 findings.
- Advanced `.wdtwin` persistence to schema V2 for Compound Boxes and collision
  policy while preserving V1 visible placement through owned migration.
- Added query telemetry plus a deterministic fixture covering seven Robot Link
  Boxes, one Tool Box, 50 external Boxes, and 1,000 Worker samples.
- Added browser acceptance for V1 migration, current collision/near-miss,
  no-pose-response behavior, Workbench participation, ignore/restore,
  navigation, report downloads, reload parity, and held-Object sequence
  validation. V2 save/export/import remains an independent project-roundtrip
  browser gate.

## Geometry collision verification evidence

- `npm run verify`: 73 test files and 439 tests passed; seven CAD Links were
  valid with zero errors and zero warnings; lint and production build passed.
- Geometry browser acceptance: one test passed in 3.2 minutes with one
  Playwright Worker and a 300-second bound.
- Independent V2 project round-trip: one test passed in 1.6 minutes.
- Playwright is serialized to one Worker because concurrent OCCT-heavy project
  imports exhausted browser resources. The last combined command exposed only
  a strict test-locator ambiguity; after correction, both component browser
  gates passed independently.
- Static deployment validation, real Web-only Docker smoke, real OPC UA-profile
  Docker smoke, and automatic Compose cleanup passed.
- High-severity dependency audit reported zero vulnerabilities. Production
  source/runtime dependencies contain no Rapier integration.

## Deferred next slices

- Scene draw-call telemetry and enforcement at runtime.
- Multi-Robot, IK, dynamics, automatic assembly splitting/LOD, OPC UA writes,
  authentication, certificates, and public-internet hardening.
