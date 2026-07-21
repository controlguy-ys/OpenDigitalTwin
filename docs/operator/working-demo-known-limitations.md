# Working Demo known limitations

This document fixes the boundary for the current Working Demo. The application
is a geometry-oriented digital-twin viewer and Simulation Job demonstrator. It
is not a source of safety, calibration, payload, or controller-grade Robot data.

## STEP Robot kinematics

A STEP file reliably supplies Geometry, product hierarchy, names, and units. It
does not standardize Robot Joint axes, rotation origins, parent/child semantics,
motion limits, zero calibration, TCP, or controller conventions.

For a one-file Robot assembly, the current importer therefore uses a deterministic
fallback:

- Prefer seven primary nodes named like `BASE`, `J1` through `J6`, or `LINK00`
  through `LINK06`.
- When exactly seven mesh-owning nodes exist without complete names, preserve
  their source order.
- Assign extra accessory nodes to the nearest selected primary Link.
- Estimate each Joint origin from the interface between adjacent Link axis-aligned
  bounds.
- Apply the generic axis sequence Z, Y, Y, X, Y, X and the generic six-axis
  limits inherited by the import template.

This is sufficient to verify that imported Link Geometry renders, follows the
correct runtime Joint record, saves into a Robot-owned Job, and moves during a
Simulation Job. It does not establish mechanical or TCP accuracy. Exact Robot
simulation requires a later authoritative Datasheet, URDF, vendor XML, or manual
Joint origin/axis/limit configuration step.

The bundled default NED2 uses this same deterministic fallback. Its current
acceptance target is a stable Working Demo, not manufacturer-certified
kinematics.

## Geometry and performance

- Robot import accepts one through seven STEP sources per Definition.
- One Robot Definition is limited to 100 MiB and 600,000 triangles.
- A Project is limited to 16 Robot Instances, 16 Robot Definitions, 512 MiB of
  referenced STEP data, and 3,000,000 visible triangles.
- Collision is geometry-proxy validation only. It is not a physics engine or a
  safety-rated collision system.

## Stabilization decisions

- The default new Project uses the bundled NED2 instead of ABB CRB15000.
- Open left/right Drawer controls sit at their dock edge so they do not cover the
  panel title or first Tree row.
- A newly imported Robot receives an empty selected Job. For an older Project
  without such a Job, **Save Current Pose** creates and selects one before saving.
