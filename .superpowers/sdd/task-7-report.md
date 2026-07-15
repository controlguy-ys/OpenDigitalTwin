# Task 7 Report: Minimal Coordinate-Aware Viewport Controls

## Status

DONE

## Scope delivered

- Added browser-local viewport preferences for Grid, World/Base/TCP frames,
  Pose Frame, Gizmo Frame, and last camera state.
- Added camera-only Home View, Fit All, Focus Selection, and fixed World
  standard views. Focus is disabled without effectively visible geometry.
- Added a non-draggable World View Cube and compact coordinate status strip.
- Added labelled, depth-tested World, Robot Base, and Actual TCP triads. Marker
  scale is distance/FOV aware for normal zoom readability.
- Connected Gizmo Frame World/Parent to TransformControls world/local space.
- Kept camera and layer state outside Project V3, Robot Joint, Job, Timeline,
  collision, entity-pose, and simulation mutation paths.

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

## Final verification

```text
npx vitest run --maxWorkers=1 --no-file-parallelism
115 files passed, 943 tests passed, exact-final duration 308.96s.

npm run test:e2e -- tests/viewport-spatial-controls.spec.ts
1 passed; build:e2e passed; browser scenario 4.2s, total 7.8s.

npm run lint
exit 0, no findings.

npm run build
exit 0; 2202 modules transformed.

git diff --check
exit 0.
```

Build retains the existing Vite informational warnings for browser-externalized
OCCT Node modules and the pre-existing large bundle threshold.

## Concerns

None. No PLC/OPC UA live write, Legacy path, physics, push, or merge was added.
