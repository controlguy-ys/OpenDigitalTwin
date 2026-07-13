# WebDigitalTwin RobotSim Web

Browser-based industrial workcell simulation for one configurable six-axis
Robot, reusable STEP Object Assets, editable Poses, and optional read-only OPC
UA joint/status input.

## Implemented capabilities

- One active six-axis Robot with `LINK00` through `LINK06`.
- ABB CRB 15000-12/1.27 STEP-derived default geometry and datasheet mechanics.
- `Import new Robot`: exactly seven mapped STEP files are required.
- `Replace one Link`: a separate explicit single-file replacement flow.
- Robot Geometry configuration is independent from Mechanical configuration:
  source filename, local XYZ/RPY/scale, visibility, Box collision bounds, and
  mesh statistics are persisted per Link.
- Object import accepts one whole STEP file per reusable Object Asset. Multiple
  Object Instances can share the same converted geometry.
- Manual Object XYZ/RPY editing, deletion, numeric 3D status overlay, and
  Manual/OPC UA status ownership. Object transforms are relative to MCP.
- Fixed `World -> MCP -> Robot Base -> Joints -> Flange -> TCP` hierarchy. MCP,
  Robot Base, and TCP are editable in mm/degrees; World and Flange are
  read-only. The gripper and held Object follow TCP.
- Simulation Poses can be saved, reordered, speed-adjusted, and deleted.
- Geometry Proxy Collision evaluates Robot Links, Tool, held Objects,
  Workbench, Equipment, and imported Object Instances with Box/Compound-Box
  proxies. It reports current-pose collision/near-miss findings and runs
  deterministic Pose-sequence validation in a cancellable Web Worker.
- `.wdtwin` project Save, Export, and Import covers Robot source STEP files,
  mechanics, Geometry configuration, collision policy, Objects, Poses, frame
  placeholders, and OPC UA bindings. V1 projects migrate to schema V2 on load.
- Import is decoded, resource-validated, and geometry-staged before the active
  project changes; failure retains the previous central snapshot.
- Optional anonymous, read-only OPC UA Client middleware publishes joint angles
  and numeric Object status over a local WebSocket.

## Quick start

Requirements: Node.js `>=22.15.1 <23` and npm `>=11.4.2 <12`.

```powershell
npm install
npm run dev -- --host 127.0.0.1 --port 5173
```

Open [http://127.0.0.1:5173/](http://127.0.0.1:5173/).

### Docker deployment

Web-only on a trusted on-premise LAN:

```powershell
docker compose up -d --build web
```

Web plus the optional read-only OPC UA Connector:

```powershell
$env:OPCUA_CONFIG_PATH = 'C:\RobotSim\opcua.config.json'
docker compose --profile opcua up -d --build --wait
```

The default URL is [http://127.0.0.1:8080/](http://127.0.0.1:8080/), and
`/healthz` reports Web availability independently from PLC connectivity. See
the [Docker operator guide](docs/operator/docker-deployment.md) before using
the OPC UA profile.

## Project workflow

1. Use **Import Robot STEP** and choose either a complete seven-Link Robot or
   the explicit single-Link replacement mode.
2. Use **Robot Config** for base pose, joint origins, axes, limits, and maximum
   velocities. Use **Robot Geometry** for CAD-local transforms and collision
   bounds.
3. Use **Import STEP** for an external Object. One file becomes one Object
   Asset plus its first scene Instance.
4. Arrange Objects with the inspector and build the Simulation Pose sequence.
5. Use **Coordinate Frames** to position MCP, Robot Base, and TCP. Moving MCP
   carries the Robot and Objects together without changing their local poses.
6. Use **Geometry Proxy Collision** to set the warning distance, inspect
   collision/near-miss findings, ignore intentional pairs, and validate the
   Simulation Pose sequence.
7. Use **Save**, then **Export** to create a portable `.wdtwin`. **Import**
   restores a validated archive.

### Resource limits

| Scope | Limit |
| --- | ---: |
| Robot files | exactly 7 for a new Robot |
| Robot STEP per Link | 25 MiB, 150,000 triangles |
| Robot total | 100 MiB, 600,000 triangles |
| Object STEP per Asset | 50 MiB, 250,000 triangles |
| Meshes/materials per Asset | 64 / 32 |
| Project raw STEP total | 256 MiB |
| Visible Scene | 1,500,000 triangles |

The seven-file rule applies only to Robot Import. Objects have no seven-file
count limit; each Object Asset owns one whole STEP file and is controlled by
the per-Asset and total project budgets.

## OPC UA middleware

```powershell
npm run middleware:opcua
```

The browser never opens `opc.tcp` directly. The middleware configuration is in
[`middleware/opcua.config.json`](middleware/opcua.config.json). This short-term
scope intentionally uses anonymous `SecurityPolicy.None` /
`MessageSecurityMode.None` and performs no writes or motion commands. Keep it
on a trusted on-premise LAN only.

## Verification

```powershell
npm run verify
npm run test:e2e
npm run deploy:validate
npm run deploy:smoke
npm run deploy:smoke:opcua
npm audit --audit-level=high
```

`verify` runs lint, unit/integration tests, CAD validation, TypeScript, and the
production build. Playwright separately exercises Geometry Proxy Collision V1
migration/current/sequence workflows and the V2 project semantic round-trip.

## Architecture

```text
src/domain/project       Versioned project/Asset/Instance contracts and budgets
src/features/project     .wdtwin codec, active project store, and project menu
src/features/robot       Robot import, mechanics, Geometry persistence, renderer
src/features/frames      Pose math, persisted MCP/TCP, manual frame editor
src/features/objects     Reusable Object Asset and Object Instance persistence
src/features/import      STEP Worker, OCCT conversion, shared geometry cache
src/features/joints      Simulation/OPC UA sources, Poses, playback
src/features/equipment   Scene adapter, inspector, status overlay, stack lights
src/features/collision   Geometry registry, OBB queries, policy/report UI, Worker
middleware               Read-only OPC UA Client and WebSocket gateway
```

## Documentation

- [Fixed Coordinate Frames operator guide](docs/operator/fixed-coordinate-frames.md)
- [Geometry Proxy Collision operator guide](docs/operator/geometry-collision.md)
- [Geometry Proxy Collision verification](docs/verification/geometry-collision-verification.md)
- [Docker on-prem operator guide](docs/operator/docker-deployment.md)
- [Geometry Collision Core Tech Spec](docs/superpowers/specs/2026-07-13-geometry-collision-core-design.md)
- [Docker deployment Tech Spec](docs/superpowers/specs/2026-07-13-on-prem-docker-deployment-design.md)
- [Portable Workcell Project Tech Spec](docs/superpowers/specs/2026-07-13-portable-workcell-project-format.md)
- [Implementation plan](docs/superpowers/plans/2026-07-13-portable-workcell-project-core.md)
- [Short-term MVP implementation record](docs/progress/2026-07-13-short-term-mvp-implementation.md)
- [Configurable Digital Twin design](docs/superpowers/specs/2026-07-11-frame-graph-generic-robot-opcua-pose-sequence-design.md)

## Known exclusions and safety boundary

Multi-Robot scenes, IK, dynamics, acceleration/jerk planning, automatic STEP
assembly splitting, automatic mesh simplification, OPC UA writes, credentials,
certificates, and public-internet deployment are not implemented. The Docker
package targets a trusted on-premise LAN only.

This project is not a safety-rated Robot controller. It performs no PLC
transfer, controller write, motion-start command, or safety function.
