# Short-term WebDigitalTwin MVP Implementation — 2026-07-13

## Delivered scope

### Single robot and STEP replacement

- The workcell keeps one active six-axis robot.
- `Import Robot STEP` accepts 1–7 `.step`/`.stp` files.
- `LINK00`–`LINK06` filenames map by link ID; generic filenames map by order.
- An eighth file, a duplicate link, files above 25 MiB, or a set above 100 MiB
  is rejected before conversion.
- Converted links replace matching runtime geometry; unspecified links retain
  the built-in CRB geometry.

### Robot mechanical configuration

- CRB 15000-12/1.27 values are the editable default.
- The operator can change robot name, base XYZ/RPY, each joint origin XYZ,
  axis XYZ, minimum/maximum angle, and maximum velocity.
- Configuration changes are persisted in browser storage and are used by the
  rendered kinematic chain, joint clamping, and Pose segment timing.

### Equipment editing and status

- Every external object can be selected, manually previewed/applied/cancelled
  in XYZ millimetres and Roll/Pitch/Yaw degrees, or deleted.
- Deleted built-in and imported equipment remains deleted after reload.
- Each object exposes a numeric 3D overlay, visibility toggle, and Manual or
  OPC UA status source.

### Pose Sequence MVP

- Poses can be saved, reordered up/down, assigned 1–100% outgoing speed, and
  deleted.
- Segment duration is derived from joint displacement and configured maximum
  joint velocities; the slowest required joint governs the segment.
- Ordered Poses and speeds persist in browser storage.

### OPC UA Client middleware

- `middleware/opcua-connector.mjs` is a read-only OPC UA Client.
- It creates an anonymous session with `SecurityPolicy.None` and
  `MessageSecurityMode.None` and polls six configured joint values.
- Optional numeric equipment nodes are published with joint frames over a
  local WebSocket gateway.
- The web UI switches between Simulation and OPC UA. Connection or payload
  failure produces BAD quality and holds the last valid pose.
- Authentication, certificates, encryption, writes, motion commands, and
  safety functions are intentionally excluded from this short-term target.

## Verification evidence

- `npm run test:run`: 36 files, 217 tests passed.
- `npm run cad:validate`: 7 links valid, 0 errors, 0 warnings.
- `npm run lint`: passed.
- `npm run build`: TypeScript and production Vite build passed.
- `npm audit --audit-level=high`: 0 vulnerabilities.
- Browser smoke check: Robot Config, object transform/status inspector, Robot
  STEP dialog, and Simulation/OPC UA source switching rendered and behaved as
  expected.

## Deferred scope

- Full World/MCP/Base/Flange/TCP/fixture Frame Graph and reparenting.
- Persisting imported robot STEP source bytes across browser reloads.
- Multi-robot scenes, IK, dynamics, acceleration/jerk planning, and safety-rated
  control.
- OPC UA security, credentials, certificates, redundancy, and write paths.
