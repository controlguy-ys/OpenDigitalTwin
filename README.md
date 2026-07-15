# WebDigitalTwin RobotSim Web

A browser-based, lightweight digital twin for one configurable six-axis Robot,
reusable STEP Objects, Simulation Jobs, and optional read-only OPC UA input.

## Current capabilities

- One active six-axis Robot with editable mechanical origins, axes, limits,
  velocities, base pose, per-Link Geometry transforms, and Box collision proxies.
- ABB CRB 15000-12/1.27 STEP geometry and datasheet mechanics as the default.
- Robot import maps exactly `LINK00` through `LINK06`; replacing one existing
  Link is an explicit separate operation. Object import is independent of this
  seven-Link rule.
- One whole STEP file creates one reusable Object Asset and its first Object
  Instance. Objects can also be duplicated or created as simple Boxes/Cylinders.
- A Project V3 Scene Entity hierarchy with one-level Groups, Hide/Show, transient
  Isolate, rename, delete, reparent/ungroup, and editable XYZ/RPY transforms.
- Manual or OPC UA ownership for Object transforms and numeric Object status.
  OPC UA-owned transforms must be switched to Manual before spatial editing.
- Simulation Jobs group ordered Poses. Pose order, deletion, and outgoing speed
  are editable, with duration derived deterministically from joint travel,
  configured maximum velocities, and speed percentage.
- One manual X/Y/Z Linear Axis can be created from **Add > Linear Axis** and can
  carry the Robot while attach/detach preserves the Robot World pose.
- Geometry Proxy Collision reports collision and near-miss findings. An explicit
  Robot base/mount-surface pair is classified separately as mount contact.
- Actual TCP marker, World View Cube, Home/Fit/Focus camera actions, coordinate
  layers, and compact Pose/Gizmo frame status.
- Project V3 New/Save/Export/Import/reload persists Robot sources/configuration,
  Scene hierarchy and poses, Objects, Jobs, collision policy, OPC UA bindings,
  Linear Axis, and mount contact in one `.wdtwin` archive.
- Theme, camera, drawer layout, and Isolate state remain browser-local and are
  not written into the portable Project archive.
- Resource warnings and rejected operations are shown in the workspace as
  accessible status/alert messages; warnings remain until dismissal or the next
  operation, and this transient UI feedback is not archived.

## Quick start

Requirements: Node.js `>=22.15.1 <23` and npm `>=11.4.2 <12`.

```powershell
npm install
npm run dev -- --host 127.0.0.1 --port 5173
```

Open [http://127.0.0.1:5173/](http://127.0.0.1:5173/).

## Operator workflow

1. Create a Project or import a validated `.wdtwin` archive.
2. Import the seven Robot Link STEP files, or keep the supplied CRB 15000.
3. Import whole STEP Objects or add simple Box/Cylinder primitives.
4. Arrange Scene Entities with Groups, visibility, and the XYZ/RPY Inspector.
5. Create a Robot Job, save Poses, set speed to the next Pose, and reorder them.
6. Optionally use **Add > Linear Axis**, then attach the Robot from its context
   menu. Open the Axis settings from its context menu to edit travel values.
7. Select the Robot and configure its base Link/mount surface in the Inspector,
   then validate the current pose or Job sequence.
8. Save and Export the portable Project.

The left workspace is split between **Scene Objects** and **Robot Jobs**. The
bottom workspace switches between **Timeline** and **Collision**, so they do not
overlay one another. At narrow widths the same areas become bounded drawers.

## Resource limits

| Scope | Limit |
| --- | ---: |
| Robot sources | exactly 7 mapped Links for new Robot import |
| Robot STEP per Link | 25 MiB / 150,000 triangles |
| Robot total | 100 MiB / 600,000 triangles |
| STEP Object Assets | 64 |
| Object Assets, all kinds | 256 |
| Object Instances | 256 |
| Object STEP per Asset | 50 MiB / 250,000 triangles |
| Meshes / materials per Object Asset | 64 / 32 |
| Visible render items | 1,024 |
| Visible numeric status overlays | 128 (presentation cap) |
| Project raw STEP total | 256 MiB |
| Visible Scene triangles | 1,500,000 |

Warnings are emitted when creation reaches 52 STEP Assets or 205 Object
Instances (the first integer at or above 80%). They are advisory: the exact
64/256 boundaries remain usable. A request above a hard limit is rejected
without publishing a partial Project revision.

## OPC UA middleware

```powershell
npm run middleware:opcua
```

The browser does not open `opc.tcp` directly. The optional middleware is a
read-only OPC UA Client that forwards joint angles, Object XYZ/RPY values, and
numeric status over a local WebSocket. Configuration is in
[`middleware/opcua.config.json`](middleware/opcua.config.json). This short-term
scope uses anonymous `SecurityPolicy.None` / `MessageSecurityMode.None`, makes
no controller writes, and is intended only for a trusted on-premise LAN.

## Docker deployment

Web-only:

```powershell
docker compose up -d --build web
```

Web plus OPC UA middleware:

```powershell
$env:OPCUA_CONFIG_PATH = 'C:\RobotSim\opcua.config.json'
docker compose --profile opcua up -d --build --wait
```

The default URL is [http://127.0.0.1:8080/](http://127.0.0.1:8080/). See the
[Docker operator guide](docs/operator/docker-deployment.md).

## Verification

```powershell
npm run lint
npm run test:run
npm run cad:validate
npm run build
npm run test:e2e
npm run test:e2e:hash
npm run test:e2e:archive
```

The reusable Scene acceptance path is in
[`tests/reusable-scene-editor.spec.ts`](tests/reusable-scene-editor.spec.ts),
and exact resource boundaries are covered by
[`tests/project-resource-performance.spec.ts`](tests/project-resource-performance.spec.ts).
The default Playwright server owns the `build:e2e` test-mode build, so both the
npm script and direct `npx playwright test ...` invocations use fresh diagnostics.

## Architecture

```text
src/domain/project       Project V3 contracts, validation, hierarchy, and budgets
src/features/project     revision storage, staging, .wdtwin codec, project menu
src/features/scene       Scene runtime, commands, hierarchy, axis, and inspectors
src/features/jobs        Job/Pose mutation and sidebar workflow
src/features/viewport    camera preferences, coordinate layers, TCP and View Cube
src/features/robot       Robot import, mechanics, Geometry, and renderer
src/features/import      STEP Worker, deterministic preflight, geometry cache
src/features/collision   proxy registry, OBB query, mount contact, validation Worker
src/features/joints      Simulation and read-only OPC UA joint sources
middleware               read-only OPC UA Client and WebSocket gateway
```

## Documentation

- [Reusable Scene Editor developer guide](docs/developer/reusable-scene-editor.md)
- [Current project status](docs/progress/2026-07-13-project-status.md)
- [Fixed Coordinate Frames operator guide](docs/operator/fixed-coordinate-frames.md)
- [Geometry Proxy Collision operator guide](docs/operator/geometry-collision.md)
- [Docker on-prem operator guide](docs/operator/docker-deployment.md)
- [Reusable Scene Editor design](docs/superpowers/specs/2026-07-15-reusable-scene-editor-design.md)
- [Reusable Scene Editor implementation plan](docs/superpowers/plans/2026-07-15-reusable-scene-editor-implementation.md)

## Deliberate exclusions and safety boundary

Multi-Robot scenes, IK, dynamics, physics response, acceleration/jerk planning,
automatic STEP assembly splitting, automatic mesh simplification, more than one
Linear Axis, axis chaining, advanced jog/path authoring, OPC UA writes,
credentials/certificates, and public-internet deployment are not implemented.

This application is not a safety-rated Robot controller. It performs no PLC
transfer, controller write, motion-start command, or safety function.
