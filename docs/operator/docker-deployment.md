# Docker On-Prem Deployment

## Prerequisites

- Docker Engine 27 or newer.
- Docker Compose v2.
- A trusted factory or development LAN.

This short-term package does not configure authentication, authorization, TLS,
OPC UA signing/encryption, certificate trust, or public-internet protection.

## Standard topology

The default Compose project always starts two services:

```text
Browser                    http://127.0.0.1:8080
Gateway HTTP               runtime-gateway:8081
Gateway OPC UA Client  --> opc.tcp://host.docker.internal:4840  (host PLC Server)
Gateway OPC UA Server  <-- opc.tcp://127.0.0.1:4841             (external PLC Client)
```

The Gateway process is always available, but the applied Project owns the OPC UA
mode. `Off` keeps browser Simulation and Project activation available without an
OPC UA listener or Client connection. `Server` starts the read-only Robot Actual
namespace for that exact Project revision. `Client` makes outbound connections
to the configured Project endpoint URLs, and `Bridge` does both. There is no
separate Connector profile or configuration file.

The Compose network permits the Gateway's outbound Client connections; operators
must still allow routing and firewall access from the container to each external
OPC UA Server. Port `4841` is published only for the Gateway Server listener;
it is not required for Client-only mode. Inside the Gateway container,
`opc.tcp://127.0.0.1:4840` points back to that container, not to the Windows
PLC. Docker Project Endpoints must use `opc.tcp://host.docker.internal:4840`.

## Start

```powershell
$env:ROBOTSIM_OPCUA_PORT = '4841'
$env:ROBOTSIM_OPCUA_ADVERTISE_HOST = '127.0.0.1'
docker compose up -d --build --wait
docker compose ps
Invoke-WebRequest http://127.0.0.1:8080/healthz
Invoke-WebRequest http://127.0.0.1:8080/runtime/healthz
Invoke-WebRequest http://127.0.0.1:8080/runtime/readyz
Invoke-WebRequest http://127.0.0.1:8080/runtime/status
```

Open `http://<docker-host>:8080/`. Load or create a Project in the browser. The
browser publishes the validated Project V4 revision to the Gateway through the
same-origin `/runtime/` proxy.

Change published host ports when required:

```powershell
$env:WEB_PORT = '9080'
$env:ROBOTSIM_OPCUA_ADVERTISE_HOST = 'robot-sim.example.local'
$env:ROBOTSIM_OPCUA_PORT = '14840'
docker compose up -d --build --wait
```

`WEB_PORT` changes only the host-side Web port. Gateway HTTP remains internal
port `8081`. `ROBOTSIM_OPCUA_PORT` is used for both the container listener and
the host-side OPC UA port so endpoint discovery has one deterministic URL.
`ROBOTSIM_OPCUA_ADVERTISE_HOST` is different: it must be the DNS name or IP that
external OPC UA Clients use, because it is returned in endpoint discovery. The
default `localhost` is suitable only for Clients running on the Docker host.
Compose advertises and listens on the same `ROBOTSIM_OPCUA_PORT`, so strict OPC
UA endpoint discovery also works when the published port is changed.
Changing listener or advertised endpoint environment values requires a container
restart.

## Select an OPC UA mode

1. Load the intended Project, or choose **Project → Samples → Dual-Robot Technical Demo**.
2. Change the Project's **OPC UA** selector from **Off** to **Server** to expose
   Robot Actual values, **Client** to subscribe to external Object bindings, or
   **Bridge** to do both.
3. Wait for **Gateway ready**. For Server/Bridge, inspect the reported endpoint.
4. In Server/Bridge mode, connect an external OPC UA Client to
   `opc.tcp://<docker-host>:${ROBOTSIM_OPCUA_PORT:-4841}`.

The namespace URI is `urn:web-digital-twin:robot-sim:v4`. Each configured Robot
Joint is exposed as a read-only `Double`:

```text
ns=2;s=RobotSim/Robots/<robotId>/Joints/<jointId>/Actual
```

The numeric namespace index is deterministic in the current adapter tests, but
an OPC UA Client should resolve the namespace URI when possible. Runtime state
is accepted only for the exact active Project and revision. Unknown Robots,
unknown Joints, duplicate Robots, non-finite values, and oversized batches are
rejected before publication.

The Server namespace is derived from Robot Definitions. Client/Bridge mappings
are read-only subscriptions, not Server-node authoring.

## Health and diagnostics

```powershell
Invoke-WebRequest http://127.0.0.1:8080/healthz
Invoke-WebRequest http://127.0.0.1:8080/runtime/healthz
Invoke-WebRequest http://127.0.0.1:8080/runtime/readyz
Invoke-WebRequest http://127.0.0.1:8080/runtime/status
docker compose logs --tail 200 web
docker compose logs --tail 200 runtime-gateway
docker compose ps
```

- `/healthz` reports Nginx liveness.
- `/runtime/healthz` reports Gateway process liveness independently of Project
  activation.
- `/runtime/readyz` returns `503 NO_ACTIVE_REVISION` until a browser applies a
  Project, then `200` for Off, Server, Client, or Bridge mode.
- `/runtime/status` reports the active Project ID, revision, mode, readiness,
  OPC UA start state, and endpoint URL.
- If Server activation fails, the Gateway rejects the candidate and attempts to
  restore the previous active runtime rather than publishing a partial revision.

The Browser remains a local Simulation runtime when the Gateway is unavailable;
its Gateway indicator reports the integration error separately.

## Direct Gateway check

For middleware development without Docker:

```powershell
npm run build:gateway
npm run runtime:gateway
```

Environment variables are optional:

```powershell
$env:ROBOTSIM_GATEWAY_HOST = '127.0.0.1'
$env:ROBOTSIM_GATEWAY_HTTP_PORT = '18081'
$env:ROBOTSIM_OPCUA_ADVERTISE_HOST = '127.0.0.1'
$env:ROBOTSIM_OPCUA_ADVERTISE_PORT = '14840'
$env:ROBOTSIM_OPCUA_PORT = '14840'
npm run runtime:gateway
```

The browser build expects same-origin `/runtime/`; use the Compose/Nginx
topology for the supported end-to-end browser flow. Nginx proxies both the
Runtime HTTP routes and the `/runtime/ws` WebSocket upgrade, so Client/Bridge
state reaches the browser without a cross-origin WebSocket configuration.

## Validation before deployment

```powershell
npm run lint
npm run test:run
npm run build:gateway
npm run build
npm run deploy:validate
docker compose config --quiet
npm run deploy:smoke
```

The Server release gate uses a real `node-opcua` Client to read both sample
Robots and exercises the two-Robot Project in the browser. Client/Bridge
deployment should additionally be checked against the intended external OPC UA
Server.

## Persistence, update, and rollback

Project V4 state is stored in each browser's IndexedDB and exported as canonical
JSON. The Runtime Gateway holds only the currently applied revision in memory;
it is not a Project database.

Before updating, export every Project that must survive browser-data loss:

```powershell
git pull --ff-only
docker compose build --pull
docker compose up -d --wait
```

For rollback, check out the previously verified Git revision, rebuild, start the
same Compose topology, and import the saved Project V4 JSON if necessary. Old
formats are not migrated by this release.

## Resource and container boundary

The checked-in Compose defaults use read-only root filesystems, dropped Linux
capabilities, `no-new-privileges`, PID limits, and bounded CPU/memory. Nginx and
the Gateway receive only temporary writable storage. Increase limits in an
operator-maintained override only after measuring browser STEP/render load and
Gateway traffic.

These controls reduce accidental container scope; they do not replace network
segmentation or an OPC UA security policy.

## Shutdown

```powershell
docker compose down
```

No Compose-managed Project volume exists. Export Project JSON before clearing
browser storage or retiring the workstation.

## Safety boundary

The short-term Server publishes read-only simulation Actual Joint values. The
Client/Bridge path also only reads external Object values. Neither path starts
Robot motion, transfers to a PLC, writes controller variables, implements a
safety function, or makes the application suitable for public-internet exposure.
