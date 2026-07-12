# WebDigitalTwin Project Status — 2026-07-13

## Summary

The CRB 15000 browser simulator has completed the baseline implementation
through Task 9. The repository contains the supplied STEP source, normalized
runtime GLBs, simulation and interaction code, automated unit/integration and
CAD checks, the approved extension Tech Spec, and four execution-ready
extension plans.

## Completed baseline work

| Plan task | Delivered outcome | Representative commit |
| --- | --- | --- |
| 1 | Approved industrial desktop/narrow visual references and UI specification | `d8cd1b3` |
| 2 | React 19, TypeScript, Vite, Vitest, Three/Rapier application foundation | `6075151` |
| 3 | Seven supplied STEP links converted and validated as browser GLBs | `ec1adef` |
| 4 | Manifest-driven CRB kinematics and Simulation joint-frame boundary | `3bf00cf` |
| 5 | Complete STEP-derived CRB workcell renderer | `78c23a9` |
| 6 | Six joint controls, poses, keyframes, and playback hardening | `2b4d948`, `51effb8` |
| 7 | Persistent equipment, cups, machines, and stack-light assets | `05292dc` |
| 8 | Browser Web Worker STEP import, persistence, units, and resource limits | `ba7d3f4`, `2095c49`, `a189dac` |
| 9 | Selection, transforms, Rapier collision, gripper pick/place, and lifecycle race hardening | `7e3d1a5`, `786afc5` |

## Remaining baseline work

- **Task 10 — Industrial UI completion:** finish responsive states, visual
  fidelity, accessibility details, and final operator-facing interaction polish.
- **Task 11 — Production E2E:** add the read-only debug bridge and Playwright
  coverage for loading, joints, persistence, collision, import, and pick/place.
- **Task 12 — Final audit:** run visual comparison, documentation review,
  production checks, and the full completion audit.

## Approved extension Tech Spec

The approved extension is documented in
[`2026-07-11-frame-graph-generic-robot-opcua-pose-sequence-design.md`](../superpowers/specs/2026-07-11-frame-graph-generic-robot-opcua-pose-sequence-design.md).
It defines:

1. Manually editable World/MCP/Robot Base/TCP/fixture/equipment coordinate frames.
2. Importable generic robot definitions from STEP plus Manifest and resolved URDF.
3. Custom mechanical origins, axes, limits, offsets, flange/TCP, and collision geometry.
4. Per-RobotInstance Simulation or read-only OPC UA joint-angle ownership.
5. Ordered Pose Sequences with per-segment 1–100% velocity-based speed.
6. Persistence, conflict handling, lifecycle cleanup, security boundaries, and acceptance tests.

Execution is decomposed into four implementation plans under
`docs/superpowers/plans/`. These plans are approved planning artifacts; their
features are not represented as complete in the current runtime.

## Current limitations

- The built-in CRB 15000 is the only robot model currently simulated.
- STEP import currently creates equipment assets, not arbitrary articulated robots.
- MCP/Base/TCP/object Frame Graph editing is specified but not implemented.
- OPC UA is an architectural boundary only; no live gateway or PLC integration is present.
- Existing playback uses baseline keyframes; persisted reorderable velocity-aware Pose Sequences are planned.
- The application is not safety-rated and performs no controller or PLC writes.

## Verification record

Publication verification on 2026-07-13:

- `npm run lint`: PASS.
- `npm run test:run`: 29 test files and 193 tests PASS.
- `npm run cad:validate`: 7 link assets valid, 0 errors, 0 warnings.
- `npm run build`: TypeScript and Vite production build PASS.
- Recorded non-blocking upstream advisories: `occt-import-js` browser
  externalization messages for `path`/`crypto`, and the Vite large-chunk
  advisory for the CAD/runtime bundle.
