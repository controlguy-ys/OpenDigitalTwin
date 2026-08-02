# Task 1 report

## Scope

- Replaced the broad V5 scene direct-child sizing selectors with the explicit `v5-scene-renderer` class. The status presentation is now intrinsic-size and the inactive-runtime empty state retains a full-canvas surface.
- Kept the real 72px bottom-right Drei ViewCube and made its GizmoHelper margin responsive to the renderer's shortest side so the cube footprint stays inside the Canvas after resize.
- Kept the Camera toolbar in the top viewport lane and bounded the Camera views menu by viewport width and dynamic viewport height, with an internal vertical scroll region and wrapped menu labels.
- Added focused scene and viewport regression contracts.

## Evidence

- `git show HEAD:src/styles/global.css` contains both pre-fix broad direct-child rules (`.v6-main-view-canvas-host .v5-scene-canvas > div` and `.v5-scene-canvas > div,`).
- `git show HEAD:src/styles/v6/viewport.css` has no Camera views `max-height` or `overflow-y` contract and no intrinsic-size status declarations.
- Responsive margin checks: 1440x900, 1086x774, and 1024x768 retain the 48px desktop margin; 512x384 computes a 46px margin and a 164px cube footprint.

## Validation

- `npm run test:run -- src/features/scene/v5/V5WorkcellWorkspace.test.tsx src/features/viewport/v6/ViewportOverlayV6.test.tsx` — 2 files, 20 tests passed.
- `npm run test:run -- src/features/scene/v5 src/features/viewport/v6` — 10 files, 69 tests passed.
- `npm run typecheck` — passed.
- `npm run lint` — passed.
- `npm run build` — passed; Vite emitted only the existing large-chunk warning.
- `git diff --check` — passed.

## Commit

Commit SHA: see the final `git rev-parse HEAD` handoff value.
