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

- `npm run test:run`: 48 files and 255 tests passed.
- `npm run lint`: passed.
- `npm run cad:validate`: 7 valid Links, 0 errors, and 0 warnings.
- Production TypeScript/Vite build: passed.
- Playwright MCP/Base/TCP edit → default-project Export → storage clear →
  Import semantic round-trip: passed in 1.2 minutes.
- `npm audit --audit-level=high`: 0 vulnerabilities.

## Deferred next slices

- Docker/Nginx on-prem deployment package and health checks.
- Scene draw-call telemetry and enforcement at runtime.
- Multi-Robot, IK, dynamics, automatic assembly splitting/LOD, OPC UA writes,
  authentication, certificates, and public-internet hardening.
