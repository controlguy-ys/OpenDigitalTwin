# WebDigitalTwin Project Status — 2026-07-16

## Summary

The repository now implements a reusable, single-Robot Project V3 Scene Editor
in the browser. The approved short-term scope covers portable Project storage,
Object hierarchy and transforms, Simulation Jobs, one Linear Axis, explicit
mount contact, Geometry Proxy Collision, and essential coordinate-aware viewport
controls. Legacy Project V2 browser/runtime authority is not part of this stage.

## Delivered capabilities

| Area | Current outcome |
| --- | --- |
| Robot | One six-axis Robot, seven Link Geometry mappings, editable mechanics and collision Boxes |
| Scene | MCP-rooted Robot/Object/Group/Linear-Axis hierarchy with one-level Groups |
| Objects | Whole-file STEP Assets, shared Instances, Box/Cylinder primitives, status overlays |
| Transforms | Manual Local XYZ/RPY, derived World pose, World-pose-preserving reparent/ungroup |
| Ownership | Manual or OPC UA Object transform/status ownership with explicit switching |
| Jobs | Named Jobs containing ordered Poses with editable outgoing speed and deletion |
| External axis | One manual X/Y/Z Linear Axis with carriage and Robot attach/detach |
| Collision | Deterministic Box/compound-Box query, Job validation, explicit mount contact |
| Viewport | Actual TCP marker, World View Cube, Home/Fit/Focus, coordinate layers/status |
| Layout | Split Scene Objects/Robot Jobs sidebar, exclusive Timeline/Collision workspace, themes |
| Interaction | Type-specific context actions, confirmations, and accessible transient operation feedback |
| Persistence | Atomic Project V3 Save/Export/Import/reload with source staging and revision recovery |

## Resource and transaction boundary

- Up to 64 imported STEP Object Assets and 256 Object Instances.
- Advisory warnings at STEP Asset 52 and Object Instance 205 do not block work.
- A 65th STEP Asset is blocked before STEP parsing or source staging.
- A 257th Instance is rejected without changing the published revision, active
  pointer, or source blobs.
- One STEP Object may be reused by multiple Instances. Primitive Assets consume
  no STEP bytes but still consume Asset/Instance/render budgets.
- The seven-file mapping rule belongs only to new Robot import.

## Persistence boundary

Durable Project content includes Scene hierarchy, Local Poses, visibility,
Robot/Geometry/mechanics, Objects, Jobs/Poses, Linear Axis configuration and
attachments, mount contact, collision policy, Frames, and OPC UA bindings.

Theme, camera and coordinate-layer preferences, drawer layout, selection, and
Isolate remain browser-local. Home View changes only camera state. Reload clears
Isolate while retaining persisted Hide state.

The single Linear Axis is reachable from the Add menu, and Robot mount contact
is editable from the Robot Inspector. Warnings and rejected operations appear
as visible status/alert feedback but remain outside Project persistence.

## Verification scope

The publication gate is:

```powershell
npm run lint
npm run test:run
npm run cad:validate
npm run build
npm run test:e2e -- tests/project-v3-roundtrip.spec.ts tests/reusable-scene-editor.spec.ts tests/viewport-spatial-controls.spec.ts tests/geometry-collision.spec.ts
npm run test:e2e:hash
npm run test:e2e:archive
```

Additional focused browser evidence is provided by
`tests/project-resource-performance.spec.ts`. Exact 256/257 publication behavior
is intentionally covered at `ProjectMutationService` integration level because
hydrating a synthetic 255-Instance `.wdtwin` exceeded the 180-second browser
archive test budget; the test still uses the real repository, coordinator,
pointer, revision, and source-blob stores.

Fresh verification on 2026-07-16:

- `npm run lint`: PASS, no findings.
- `npm run test:run`: 118 files and 968 tests PASS in 116.70 seconds.
- `npm run cad:validate`: 7 Link Assets valid, 0 errors, 0 warnings.
- `npm run build`: PASS, 2,205 modules transformed.
- focused resource browser tests: 2/2 PASS in 58.3 seconds.
- combined Project/Scene/Viewport/Collision E2E: 6/6 PASS in 10.7 minutes.
- `npm run test:e2e:hash`: 1/1 PASS in 6.3 seconds.
- `npm run test:e2e:archive`: 1/1 PASS in 11.4 seconds.

The build retains the existing informational OCCT `path`/`crypto` browser
externalization messages and the bundle-size advisory. They are non-blocking
and introduce no TypeScript, lint, unit, CAD, or Playwright failure.

## Current limitations

- One active Robot and one manual Linear Axis; no axis chain.
- New Robot import currently requires all seven `LINK00`–`LINK06` mappings.
- Groups are one level deep and editing is single-selection.
- No IK, Cartesian jog, path authoring, dynamics, physical collision response,
  acceleration/jerk planning, or safety-rated validation.
- No automatic STEP assembly splitting, semantic Joint extraction, or automatic
  mesh simplification/repair.
- OPC UA is anonymous, read-only middleware scope; there are no controller
  writes, credentials/certificates, or public-internet deployment guarantees.

The application is a geometric planning and visualization aid, not a Robot
controller or safety function.
