# On-Prem Docker Deployment Design

## 1. Purpose

Package WebDigitalTwin RobotSim as a reproducible on-premise Docker Compose
deployment. The short-term target is a trusted factory LAN: one Nginx-hosted
browser application plus an optional read-only OPC UA connector. This design
does not expose the application directly to the public internet and does not
add authentication, TLS termination, certificates, or OPC UA writes.

## 2. Success Criteria

1. `docker compose build web` produces the browser application from a clean
   checkout using the repository's pinned Node/npm versions.
2. `docker compose up -d web` serves the SPA on a configurable host port and
   returns HTTP 200 from `/healthz`.
3. Direct navigation to an application route falls back to `index.html` while
   static assets retain appropriate cache headers.
4. The browser derives the OPC UA gateway WebSocket URL from its current host
   and `/opcua`; the same build therefore works over HTTP and HTTPS without a
   host-specific rebuild.
5. `docker compose --profile opcua up -d` starts the optional connector and
   Nginx proxies WebSocket Upgrade traffic from `/opcua` to it.
6. The connector reads its OPC UA endpoint, NodeIds, scale, offset, sampling,
   and retry values from a mounted JSON file and remains read-only.
7. Both services expose health checks. The web health check does not depend on
   the PLC or OPC UA server, so UI availability remains observable separately.
8. Containers run without Linux capabilities, use bounded resources, and use
   read-only filesystems except for explicitly declared temporary filesystems.
9. Repository verification, deployment configuration tests, Nginx syntax
   validation, container health checks, and a browser smoke test pass.

## 3. Considered Approaches

### A. Web-only Nginx image

This is the smallest image and deployment surface, but operators must install
and supervise the OPC UA connector separately. It does not provide one
repeatable deployment workflow for the complete digital-twin stack.

### B. Compose web plus optional connector profile — selected

Nginx and the Node connector have separate images and process lifecycles.
Compose provides one configuration boundary while the `opcua` profile keeps
the default web-only deployment lightweight. Each service can be restarted,
logged, and health-checked independently.

### C. Combined Nginx and Node container

One container is superficially simpler to start, but it requires a supervisor,
couples unrelated failure domains, and prevents independent scaling and health
reporting. It is rejected for this release.

## 4. Architecture

```text
Browser
  │ HTTP : WEB_PORT
  ▼
Nginx web container
  ├─ /, /assets/*  -> immutable Vite build
  ├─ /healthz      -> Nginx-only HTTP 200
  └─ /opcua        -> WebSocket proxy
                         │ internal ws://opcua-connector:4841
                         ▼
                  Node OPC UA connector (optional profile)
                         │ anonymous read-only OPC UA Client
                         ▼
                  Factory OPC UA Server
```

The browser application and connector remain separate components. Nginx owns
HTTP serving and the same-origin WebSocket boundary. The connector owns OPC UA
session creation, polling, quality reporting, and WebSocket broadcasting.

## 5. Web Image

The root `Dockerfile` uses two stages:

- `node:22-alpine` installs with `npm ci` and runs `npm run build`.
- An unprivileged Nginx image copies only `dist/` and the site configuration.

The runtime image contains no source STEP working files beyond assets already
emitted into `dist`, no Node toolchain, and no package manager cache. It listens
on an unprivileged internal port. The root filesystem is read-only under
Compose, with temporary paths supplied through `tmpfs` only where Nginx needs
them.

Nginx behavior:

- `/healthz` returns a fixed text response and does not log routine probes.
- `/opcua` sets HTTP/1.1 Upgrade and Connection headers, disables proxy
  buffering, and uses long read/send timeouts suitable for WebSockets.
- Hashed `/assets/` responses use long-lived immutable caching.
- `index.html`, worker files, STEP files, and other non-hashed resources use
  revalidation rather than immutable caching.
- Unknown client-side routes use `try_files $uri $uri/ /index.html`.
- A conservative body-size limit is retained because project Import occurs in
  the browser and does not upload data to Nginx.

## 6. Runtime OPC UA URL

The production browser default is derived at runtime:

```text
http:  -> ws://<current-host>/opcua
https: -> wss://<current-host>/opcua
```

`VITE_OPCUA_GATEWAY_URL` remains an explicit build-time override for local or
special deployments. A pure helper owns URL resolution and is unit-tested for
HTTP, HTTPS, explicit override, and non-browser fallback behavior. This avoids
baking a workstation IP into the Docker image.

## 7. Connector Image and Configuration

`middleware/Dockerfile` installs production dependencies from the root lockfile
and starts `middleware/opcua-connector.mjs`. Compose mounts a user-editable
configuration file read-only at `/app/config/opcua.config.json` and sets
`OPCUA_CONFIG` to that path.

The existing configuration contract remains:

- exactly six joint mappings;
- zero or more Object status mappings;
- positive WebSocket port and sampling interval;
- finite scale and offset values;
- anonymous `SecurityPolicy.None` / `MessageSecurityMode.None`;
- reads only, with no OPC UA write or method call surface.

The connector adds a small HTTP health endpoint on a separate internal port.
Its liveness response reports process/WebSocket availability only. Connection
quality to the OPC UA server continues to be represented by broadcast `GOOD`,
`BAD`, or `STALE` joint frames and does not make the container unhealthy.

## 8. Compose Contract

`compose.yaml` defines:

- `web`, enabled by default;
- `opcua-connector`, enabled only by profile `opcua`;
- `WEB_PORT`, defaulting to `8080`;
- `OPCUA_CONFIG_PATH`, defaulting to the checked-in trusted-LAN example;
- restart policy `unless-stopped`;
- service health checks;
- capability drop, `no-new-privileges`, read-only root filesystem, `tmpfs`,
  process limit, memory limit, and CPU limit.

The Nginx upstream name resolves even when the optional service is absent by
using Docker's embedded DNS resolver and a variable-based proxy target. A user
can therefore run the web-only profile without Nginx refusing to start. Access
to `/opcua` returns a gateway error until the connector profile is running;
the rest of the SPA remains healthy.

No host network mode, privileged mode, Docker socket mount, PLC write access,
or secret is included.

## 9. Health and Failure Behavior

- Nginx unavailable: Compose marks `web` unhealthy and the browser is not
  reachable.
- Connector stopped or profile omitted: `/healthz` remains healthy; OPC UA mode
  reports a failed WebSocket connection while Simulation mode remains usable.
- OPC UA server unavailable: connector remains alive, retries with the existing
  bounded strategy, and broadcasts `BAD` quality.
- Invalid connector configuration: connector fails fast with a clear error and
  Compose reports the service as stopped/unhealthy.
- Browser project data remains in browser IndexedDB; container replacement does
  not migrate browser-local projects. Portable `.wdtwin` Export remains the
  backup and transfer mechanism.

## 10. Verification

Automated checks include:

1. Unit tests for runtime WebSocket URL resolution.
2. Static tests that assert required Docker, Compose, Nginx, health-check, and
   hardening contracts without requiring a Docker daemon.
3. `docker compose config` validation when Docker Compose is installed.
4. `nginx -t` inside the built web image.
5. Container smoke test: start web, wait for healthy, verify `/healthz`, load
   the SPA, and stop the stack.
6. Optional connector-profile smoke test that verifies both health endpoints
   without requiring a reachable OPC UA server.
7. Existing `npm run verify`, `npm run test:e2e`, and high-level dependency
   audit.

Docker-dependent checks are reported as an explicit environment blocker if the
daemon or Compose plugin is unavailable; static validation and application
tests still run.

## 11. Operator Workflow

Web only:

```powershell
docker compose up -d --build web
```

Web plus OPC UA:

```powershell
$env:OPCUA_CONFIG_PATH = 'C:\absolute\path\opcua.config.json'
docker compose --profile opcua up -d --build
```

Operators verify `http://<host>:8080/healthz`, then open the host root URL. The
documentation includes configuration examples, logs, restart, update, backup,
and shutdown commands.

## 12. Explicit Exclusions

- TLS certificates or automated HTTPS termination.
- Authentication, authorization, user management, or audit identity.
- OPC UA signing, encryption, credentials, certificate trust lists, writes, or
  method calls.
- Kubernetes, Swarm, Helm, or cloud-specific deployment resources.
- Multi-host high availability, database backup, or shared server-side project
  storage.
- Public-internet hardening or safety-rated control behavior.
