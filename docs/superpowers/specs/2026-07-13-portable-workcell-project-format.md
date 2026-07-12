# Portable Workcell Project V1 Tech Spec

## Purpose

Define the short-term portable unit for one six-axis Robot, reusable external
Object Assets, scene Instances, Simulation Poses, and read-only OPC UA bindings.

## Domain boundaries

- One active Robot with six joints and exactly seven Geometry Links.
- `RobotLinkGeometryRecordV1` owns one Link STEP source and CAD-local settings.
- Robot Mechanical configuration owns joint origins, axes, limits, velocity,
  and base pose. Geometry edits never rewrite joint origins.
- `ObjectAssetRecordV1` owns one whole STEP source and converted-geometry
  metadata. `ObjectInstanceRecordV1` owns placement, visibility, and numeric
  status while referencing one Asset ID.
- Poses contain six joint angles, outgoing speed, duration, and easing.
- OPC UA bindings are configuration only; the browser consumes a middleware
  WebSocket and never writes controller values.

## Archive layout

```text
manifest.json
frames.json
robot/configuration.json
robot/links/index.json
robot/links/LINK00.step ... LINK06.step
objects/assets.json
objects/assets/0000.step ...
objects/instances.json
poses/sequences.json
opcua/bindings.json
```

The archive is ZIP encoded with a fixed timestamp and sorted paths. JSON never
contains raw STEP byte arrays; each Geometry record references an archive path.

## Validation and load transaction

1. Inspect the ZIP central directory before expansion.
2. Reject unsafe, duplicate, encrypted, ZIP64, excessive-entry, or excessive-
   size paths.
3. Expand and parse all required JSON entries.
4. Reattach raw STEP bytes and validate the complete V1 domain graph.
5. Convert all Robot and Object STEP geometry into temporary repositories.
6. Only after every conversion succeeds, replace persistent runtime stores and
   the authoritative active-project snapshot.
7. On failure, dispose staged geometry and retain or reconstruct the previous
   active snapshot.

## Compatibility

- `format` is `WebDigitalTwinProject`.
- `schemaVersion` is `1`.
- Unknown format/schema versions are rejected; no implicit downgrade occurs.
- Legacy imported Equipment rows remain readable but all new imports use the
  Asset/Instance model.

## Limits

The V1 validator enforces 7 Robot Links, 25 MiB/Link, 100 MiB/Robot,
150k triangles/Link, 600k triangles/Robot, 50 MiB and 250k triangles/Object
Asset, 64 meshes/Asset, 32 materials/Asset, 256 MiB raw STEP/project, and 1.5M
visible triangles.

## Exclusions

Fixed-frame editing, Docker deployment, security/authentication, OPC UA writes,
multi-Robot, IK, dynamics, automatic assembly splitting, and automatic LOD are
separate follow-on specifications.
