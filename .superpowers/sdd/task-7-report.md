# Task 7 Report: Minimal Coordinate-Aware Viewport Controls

## Status

DONE

## Scope delivered

- Added browser-local viewport preferences for Grid, World/Base/TCP frames,
  Pose Frame, Gizmo Frame, and complete camera state (position, target,
  quaternion, up vector, zoom, FOV, and clipping planes).
- Added camera-only Home View, Fit All, Focus Selection, and fixed World
  standard views. Focus is disabled until the selected committed Robot,
  Object, Axis, or Group descendant has registered renderable geometry and a
  non-empty post-commit bound; STEP loading/failure remains safely disabled.
- Added a non-draggable World View Cube and compact coordinate status strip
  with Actual TCP XYZ and ZYX RPY readouts in World, MCP, or Base frames.
- Added labelled, depth-tested World, Robot Base, and Actual TCP triads. Marker
  scale is distance/FOV aware for normal zoom readability.
- Connected Gizmo Frame World/Parent to World axes or a parent-oriented proxy,
  preserving the selected child's orientation during parent-frame translation.
- Kept camera and layer state outside Project V3, Robot Joint, Job, Timeline,
  collision, entity-pose, and simulation mutation paths.
- Gated camera diagnostic state publication to test mode and normalized safe
  persisted camera quaternion/up vectors while rejecting degenerate vectors.

## TDD evidence

Initial RED:

```text
npm run test:run -- src/features/viewport src/features/scene/SceneCanvas.test.tsx
7 test files failed: six missing viewport modules and SceneCanvas missing Home View.
Existing SceneCanvas tests: 3 passed.
```

Focused GREEN:

```text
npm run test:run -- src/features/viewport src/features/scene/SceneCanvas.test.tsx
7 files passed, 14 tests passed.

npm run test:run -- src/features/viewport src/features/scene src/app
24 files passed, 154 tests passed.
```

Self-review RED/GREEN covered Top/Bottom up-vector stability, camera-distance
marker scale, and Gizmo Frame propagation through TransformControls.

Review-fix RED/GREEN additionally covered deterministic TCP frame conversion,
complete camera persistence and Home reset, render-pure bounds resolution,
true rotated-parent gizmo translation, and browser-level semantic invariance.

Final review closure RED reproduced four failures: missing/empty geometry still
enabled Focus, production diagnostic publication was ungated, degenerate camera
vectors were accepted, and non-unit vectors were not normalized. The empty-bound
Focus no-op characterization already passed.

The final async-root RED reproduced a frozen `canFocusSelection`: adding valid
geometry to the same registered STEP root remained false. GREEN verifies the
same root transitions false-to-true-to-false as geometry is added and removed,
without render-time world-matrix mutation. A low-frequency selected probe reads
live eligibility and skips committed bounds work while readiness stays valid.

```text
npm run test:run -- src/features/viewport src/features/scene/SceneCanvas.test.tsx src/features/scene/Workcell.test.tsx src/features/interaction/EquipmentTransformControls.test.tsx src/features/equipment src/app/App.test.tsx
19 files passed, 78 tests passed.
```

## Final verification

```text
npx vitest run --maxWorkers=1 --no-file-parallelism
116 files passed, 954 tests passed, exact-final duration 307.26s.

npm run test:e2e -- tests/viewport-spatial-controls.spec.ts
test-mode build passed; 1 browser scenario passed in 1.4m, total 1.5m.

npm run lint
exit 0, no findings.

npm run build
exit 0; 2203 modules transformed.

git diff --check
exit 0.
```

Build retains the existing Vite informational warnings for browser-externalized
OCCT Node modules and the pre-existing large bundle threshold.

## Concerns

None. No PLC/OPC UA live write, Legacy path, physics, push, or merge was added.
