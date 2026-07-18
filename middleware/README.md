# Runtime Gateway

The middleware hosts the Project V4 Runtime Gateway and its optional OPC UA
Server and OPC UA Client adapters. The browser remains a local Simulation
runtime and publishes validated, revision-qualified snapshots to the Gateway.

## Run locally

```powershell
npm run build:gateway
npm run runtime:gateway
```

The HTTP service listens on port `8081` and the OPC UA Server listener uses port
`4840` by default. Runtime mode is owned by the applied Project, not an
environment flag. Client connections are outbound to the endpoint URLs stored in
the applied Project.

## HTTP contract

- `GET /healthz` - process liveness.
- `GET /readyz` - `503` until a Project Revision is active.
- `GET /runtime/status` - active Project, Revision, mode, and endpoint.
- `PUT /runtime/project` - validate and atomically activate one Project V4.
- `POST /runtime/state` - publish a revision-fenced multi-Robot Joint snapshot.

Modes are `off`, `server`, `client`, and `bridge`. `server` exposes only
read-only Robot Actual Joint values. `client` subscribes to configured external
read mappings, including generic Object pose/status mappings; `bridge` runs both
adapters. The Client does not write, call methods, or control a Robot. Anonymous
access with `SecurityPolicy.None` is deliberate for the current no-security
prototype and must not be treated as a production security profile.

For generic Object bindings, the Client assembles six `Double` values into a
coherent pose, converts XYZ from the configured `m` or `mm` unit to project
metres, and converts Roll/Pitch/Yaw degrees to the project quaternion. It keeps
the latest valid values through bad-quality updates, reports quality/status, and
the browser deterministically interpolates retained valid poses. See the
[operator binding guide](../docs/operator/opcua-object-binding.md).
