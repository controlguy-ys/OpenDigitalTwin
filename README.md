# WebDigitalTwin — CRB 15000 RobotSim Web

Browser-based industrial robot digital-twin prototype for the ABB CRB 15000
12 kg / 1.27 m robot. The current application renders STEP-derived robot
geometry, simulates six joints, imports equipment STEP files, displays
industrial stack-light status, and supports collision-aware pick and place.

> Project status: the original implementation plan is complete through Task 9.
> A short-term configurable Digital Twin MVP is now implemented: single-robot
> STEP replacement, editable six-axis mechanics/base pose, object coordinates
> and numeric status, velocity-aware Pose editing, and a read-only OPC UA client
> middleware. The full Frame Graph and production E2E/final audit remain future
> scope.

## Current capabilities

- STEP-derived `LINK00`–`LINK06` CRB 15000 geometry rendered with React Three Fiber.
- Six-axis Simulation Mode with joint limits, Home/Reset, saved poses, and keyframe playback.
- Browser-side equipment STEP import through an OCCT Web Worker with unit detection and bounded resource validation.
- IndexedDB persistence for equipment records and imported geometry.
- Built-in cups, machine equipment, and reusable red/yellow/green industrial stack lights.
- Equipment selection and transform controls.
- Rapier collision events, gripper sensing, deterministic pick/place, held-object following, and release persistence.
- Responsive industrial HMI shell with viewport, asset tree, inspector, and timeline surfaces.
- Single-robot STEP replacement with a strict maximum of seven files (`LINK00`–`LINK06`), 25 MiB per file, and 100 MiB total.
- Editable robot name, base XYZ/RPY, joint origins, axes, limits, and maximum velocities with CRB datasheet defaults.
- Manual equipment XYZ/RPY, persistent deletion, numeric 3D status overlays, and Manual/OPC UA status ownership.
- Reorderable and deletable persisted Poses with 1–100% outgoing speed and velocity-derived segment durations.
- Simulation/OPC UA joint-source switch with BAD-quality fail-safe behavior.

## Quick start

Requirements:

- Node.js `>=22.15.1 <23`
- npm `>=11.4.2 <12`

```powershell
npm install
npm run dev -- --host 127.0.0.1 --port 5173
```

Open [http://127.0.0.1:5173/](http://127.0.0.1:5173/).

## Verification

```powershell
npm run verify
```

The verification pipeline runs lint, unit/integration tests, CAD asset
validation, TypeScript compilation, and the production Vite build. Browser E2E
coverage belongs to the remaining Task 11 scope.

Useful individual commands:

```powershell
npm run test:run
npm run cad:validate
npm run build
npm run test:e2e
npm run middleware:opcua
```

## Architecture

```text
src/domain              Robot/equipment contracts and kinematics
src/features/robot      CRB renderer, gripper, and status overlay
src/features/joints     Simulation source, joint store, poses, and playback
src/features/equipment  Equipment persistence, rendering, and stack lights
src/features/import     STEP worker pipeline and geometry repository
src/features/interaction Collision, selection, transforms, and grasp lifecycle
src/features/scene      React Three Fiber / Rapier workcell
src/features/ui         Timeline and industrial UI surfaces
middleware              Anonymous read-only OPC UA client and WebSocket gateway
scripts/cad             Deterministic CAD conversion and validation
public/models/robot     Runtime GLB assets and asset report
```

The browser remains independent of `opc.tcp`. The optional middleware connects
as an anonymous OPC UA client using `SecurityPolicy.None` and
`MessageSecurityMode.None`, polls six configured joint `Value` attributes, and
publishes frames to `ws://127.0.0.1:4841`. It never writes controller values or
starts robot motion. Edit [`middleware/opcua.config.json`](middleware/opcua.config.json)
and see [`middleware/README.md`](middleware/README.md) before starting it.

## Robot geometry and kinematics

The authoritative source geometry is the supplied
`CRB15000_12kg-127_OmniCore_rev00_STEP_J` STEP set. Runtime `LINK00` through
`LINK06` GLBs are generated from those files with OCCT metre output and retain
the source mesh and face colors.

The numeric CRB 15000-12/1.27 joint origins and axes are attributed to the
ROS-Industrial `abb_crb15000_support/urdf/crb15000_12_127_macro.xacro`
definition. Joint limits were cross-checked against ABB product specification
3HAC077390-001 Revision X.

## Documentation

- [Current project status](docs/progress/2026-07-13-project-status.md)
- [Short-term MVP implementation record](docs/progress/2026-07-13-short-term-mvp-implementation.md)
- [Baseline Robot Simulation Tech Spec](docs/superpowers/specs/2026-07-10-robot-simulation-design.md)
- [Approved configurable digital-twin Tech Spec](docs/superpowers/specs/2026-07-11-frame-graph-generic-robot-opcua-pose-sequence-design.md)
- [Baseline implementation plan](docs/superpowers/plans/2026-07-10-crb15000-web-simulation.md)
- [Frame Graph and manual coordinates plan](docs/superpowers/plans/2026-07-11-frame-graph-manual-coordinates.md)
- [Generic robot import and mechanics plan](docs/superpowers/plans/2026-07-11-generic-robot-import-mechanical-configuration.md)
- [Read-only OPC UA joint source plan](docs/superpowers/plans/2026-07-11-opcua-joint-source-gateway.md)
- [Pose Sequence speed and ordering plan](docs/superpowers/plans/2026-07-11-pose-sequence-speed-ordering.md)
- [Industrial visual specification](docs/design/robot-sim-visual-spec.md)

## Safety boundary

This project is a visualization and simulation prototype. It is not a
safety-rated robot controller. No PLC transfer, controller write, motion-start
command, or safety function is implemented.
