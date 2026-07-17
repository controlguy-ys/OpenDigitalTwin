# Runtime Gateway

The middleware hosts the Project V4 Runtime Gateway and its optional OPC UA
Server. The browser remains a local Simulation runtime and publishes validated,
revision-qualified snapshots to the Gateway.

## Run locally

```powershell
npm run build:gateway
npm run runtime:gateway
```

The HTTP service listens on port `8081` and the OPC UA Server on port `4840` by
default. Runtime mode is owned by the applied Project, not an environment flag.

## HTTP contract

- `GET /healthz` - process liveness.
- `GET /readyz` - `503` until a Project Revision is active.
- `GET /runtime/status` - active Project, Revision, mode, and endpoint.
- `PUT /runtime/project` - validate and atomically activate one Project V4.
- `POST /runtime/state` - publish a revision-fenced multi-Robot Joint snapshot.

Only `off` and `server` modes are implemented in this short-term slice. Server
nodes are read-only Actual Joint values. Anonymous access with
`SecurityPolicy.None` is deliberate for the current no-security prototype and
must not be treated as a production security profile.
