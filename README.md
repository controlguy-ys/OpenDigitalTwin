# WebDigitalTwin RobotSim Web

WebDigitalTwin is a lightweight, browser-first Robot workcell simulator. The
current release uses one deterministic Project V4 model for multiple independent
Robot Instances, scene objects, Robot-owned Simulation Jobs, geometric collision
checks, and an optional read-only OPC UA Server.

It is an engineering visualization tool, not a Robot controller, physics engine,
or safety-rated system.

## Current short-term scope

- Project V4 is the only active browser Project format. New, Save, Export,
  Import, reload, and runtime publication use validated canonical JSON.
- A Project can describe up to eight Robot Instances. Each reusable Robot
  Definition has one through sixteen named revolute or prismatic Joints; runtime
  state, selection, Jobs, rendering, and collision identity are keyed by Robot
  ID rather than a global active Robot.
- Robot STEP source count and Joint count are independent. A Definition may
  reference one through seven Robot STEP sources, including one assembly source,
  but this release does not infer Links or Joints from STEP topology.
- The default Project renders the built-in ABB CRB15000 geometry. The V4 Scene
  also supports primitive Boxes/Cylinders, Groups, visibility, transforms, and
  geometry-proxy collision inspection. Boxes, Cylinders, and imported STEP
  objects have manual XYZ/RPY placement when their transform is manually owned.
- Simulation Jobs belong to one Robot and contain ordered Joint Poses with a
  speed percentage to the next Pose. Different Robots keep independent state and
  execution sessions.
- The browser publishes only a fully matched Project revision and matching
  multi-Robot state to the Runtime Gateway. A missing Gateway does not disable
  local Simulation.
- Runtime Gateway mode is selected per Project: `Off`, `Server`, `Client`, or
  `Bridge`. Client reads configured external OPC UA nodes; Bridge combines that
  client with the read-only Server namespace. Server remains limited to each
  Robot Joint's read-only OPC UA `Double` Actual value.
- The standard Docker topology starts both the Nginx web service and the Runtime
  Gateway. Nginx serves the SPA and proxies same-origin `/runtime/` requests;
  the Gateway owns HTTP activation/state endpoints and optional OPC UA port
  `4840`.

Project V4 is a clean break. There is no Legacy Adoption or automatic Project
migration.

## Quick start

Requirements: Node.js `>=22.15.1 <23` and npm `>=11.4.2 <12`.

Browser-only local Simulation:

```powershell
npm install
npm run dev -- --host 127.0.0.1 --port 5173
```

Open [http://127.0.0.1:5173/](http://127.0.0.1:5173/). The application remains
usable when `/runtime` is unavailable; Gateway status is reported separately.

Build and run the Runtime Gateway directly for HTTP/OPC UA integration tests:

```powershell
npm run build:gateway
npm run runtime:gateway
```

The direct Gateway defaults are HTTP `http://127.0.0.1:8081` and OPC UA
`opc.tcp://127.0.0.1:4840`. The browser expects a same-origin `/runtime` route,
so Docker Compose is the supported full browser-plus-Gateway topology.

## Two-Robot Technical Demo flow

1. Open **Project → Samples → Dual-Robot Technical Demo**.
2. Select **ABB CRB15000**, then select **CRB 12-Pose Technical Demo** in Robot
   Jobs. The Timeline contains 12 Joint Poses with per-transition speeds.
3. Press **Start Job**. The approximately 5.2-second sequence moves J1 through
   +60° and -60°, follows all 12 Poses, reaches **SUCCEEDED**, and returns J1-J6
   to the Home value `0`.
4. Select **Logical Linear Slide** and run **Linear Slide Traverse** to verify
   that each Robot keeps independent Joint values and Job state.
5. Change **OPC UA** from **Off** to **Server** to activate the Gateway namespace.
6. Read the Joint Actual nodes with an external OPC UA Client. Node IDs are
   deterministic:

   ```text
   ns=2;s=RobotSim/Robots/<robotId>/Joints/<jointId>/Actual
   ```

The second sample Robot is deliberately a source-only, one-axis prismatic
`RobotDefinition`. It has logical Links, one `SLIDE_X` Joint, Jobs, and OPC UA
state, but no Geometry occurrences and no imported STEP mesh. It proves
multi-Robot identity and data flow; it does **not** prove MRb05 assembly
extraction, mechanical correctness, or a second rendered industrial Robot.
The full Pose table, acceptance checks, and remaining scope checklist are in the
[12-Pose Technical Demo guide](docs/operator/technical-demo-12-pose.md).

## Runtime Gateway contract

The browser and Gateway exchange exact Project/Revision-qualified JSON:

- `GET /healthz` - process liveness.
- `GET /readyz` - `503` before a Project revision is active, then `200`.
- `GET /runtime/status` - active Project, revision, mode, and OPC UA endpoint.
- `PUT /runtime/project` - validate and atomically activate one Project V4.
- `POST /runtime/state` - publish one validated multi-Robot Joint batch for the
  exact active revision; Server mode only.

Project bodies are bounded to 1 MiB. Runtime state uses the Project V4 runtime
batch budget. Unknown Robots/Joints, duplicate Robots, non-finite values, and
stale revisions are rejected before publication.

The OPC UA namespace URI is `urn:web-digital-twin:robot-sim:v4`. Actual Joint
variables are read-only; Client writes return `BadNotWritable`.
The current Server namespace is derived from Robot Definitions; object bindings
do not author arbitrary Server nodes. In Client or Bridge mode, an Object
Inspector can subscribe six external `Double` nodes (`X`, `Y`, `Z`, `Roll`,
`Pitch`, `Yaw`) and an optional numeric `Status` node. See
[Object OPC UA live binding](docs/operator/opcua-object-binding.md).

## Docker deployment

```powershell
docker compose up -d --build --wait
docker compose ps
```

Open [http://127.0.0.1:8080/](http://127.0.0.1:8080/). The default published OPC
UA endpoint is `opc.tcp://127.0.0.1:4840`. Override host ports when required:

```powershell
$env:WEB_PORT = '9080'
$env:ROBOTSIM_OPCUA_ADVERTISE_HOST = 'robot-sim.example.local'
$env:ROBOTSIM_OPCUA_PORT = '14840'
docker compose up -d --build --wait
```

Set `ROBOTSIM_OPCUA_ADVERTISE_HOST` to the DNS name or IP address that OPC UA
Clients actually use. The Gateway still binds to all container interfaces while
advertising this reachable host in endpoint discovery. Compose automatically
uses the same `ROBOTSIM_OPCUA_PORT` for the container listener, host publication,
and endpoint discovery, avoiding duplicate internal and external endpoint URLs.

Both containers run with read-only filesystems, dropped Linux capabilities,
bounded process/memory/CPU settings, and temporary writable storage. These
container restrictions are operational limits, not an application security
profile. See the [Docker operator guide](docs/operator/docker-deployment.md).

## Verification

Run the repository gates without relying on a historical test count:

```powershell
npm run lint
npm run test:run
npm run cad:validate
npm run build:gateway
npm run build
npm run test:e2e:v4
npm run deploy:validate
docker compose config --quiet
```

`tests/project-v4-multi-robot.spec.ts` is the browser acceptance path for
loading the two-Robot Project, rendering all 12 CRB Poses, observing positive
and negative intermediate motion, returning Home, preserving the second Robot,
and running its slide Job. Middleware tests start a real `node-opcua` Client and
verify read-only values for both Robots.

## Architecture

```text
Browser SPA
  Project V4 authoring/persistence
  Multi-Robot simulation and Jobs
  Scene/render/collision projection
  Runtime Gateway publisher
          |
          | same-origin /runtime JSON, exact revision
          v
Runtime Gateway
  Project activation and validation
  multi-Robot state publication
  OPC UA Server adapter (read-only Robot Actual values)
  OPC UA Client adapter (read-only external Object values)
          |
          v
External OPC UA Server / Client connections
```

Key code areas:

```text
src/core/project-v4             closed Project contracts and validation
src/core/robot-runtime          variable-Joint frames and serial kinematics
src/features/project/v4         V4 persistence, mutation, and publication
src/features/robot/v4           definition-driven Robot rendering
src/features/jobs/v4            per-Robot Job authoring and execution
src/features/collision/v4       Robot-qualified geometric collision
src/features/runtime-gateway/v4 browser HTTP publisher
middleware/runtime-gateway      HTTP activation and OPC UA Server/Client adapters
```

## Deliberate limitations

- No authentication, authorization, TLS, OPC UA signing/encryption, certificate
  trust workflow, or public-internet hardening.
- No controller writes, command nodes, external motion control, or arbitrary
  Server-node authoring. Client/Bridge Object bindings are read-only inputs.
- No physics response, dynamics, mass/inertia, force/torque, IK, Cartesian path
  planning, reachability solving, or coordinated multi-Robot synchronization.
- No automatic STEP assembly splitting, Link/Joint inference, mesh
  simplification, or API/harness-based semantic conversion.
- No current Robot-definition authoring UI for turning an arbitrary single STEP
  assembly such as MRb05 into a functional articulated Robot. Mechanical axes,
  origins, limits, Geometry occurrences, and source orientation still require a
  later deterministic authoring workflow and human confirmation.
- No explicit Attach/Detach pick-place runtime in the released short-term slice.
- No Legacy Project adoption. Unsupported Projects are rejected without
  mutating the active V4 revision.

## Documentation

- [Project V4 multi-Robot and Runtime Gateway design](docs/superpowers/specs/2026-07-16-project-v4-multi-robot-runtime-gateway-design.md)
- [Runtime Gateway middleware notes](middleware/README.md)
- [Docker operator guide](docs/operator/docker-deployment.md)
- [Object OPC UA live binding](docs/operator/opcua-object-binding.md)
- [Build Log](BUILDLOG.md)
