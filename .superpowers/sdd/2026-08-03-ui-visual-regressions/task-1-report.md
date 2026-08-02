# Task 1 report

## Scope

- Replaced the broad V5 scene direct-child sizing selectors with the explicit `v5-scene-renderer` class. The status presentation is now intrinsic-size and the inactive-runtime empty state retains a full-canvas surface.
- Kept the real 72px bottom-right Drei ViewCube and made its GizmoHelper margin responsive to the renderer's shortest side so the cube footprint stays inside the Canvas after resize.
- Kept the Camera toolbar in the top viewport lane and bounded the Camera views menu by viewport width and dynamic viewport height, with an internal vertical scroll region and wrapped menu labels.
- Added focused scene and viewport regression contracts.

## Evidence

- `git show HEAD:src/styles/global.css` contains both pre-fix broad direct-child rules (`.v6-main-view-canvas-host .v5-scene-canvas > div` and `.v5-scene-canvas > div,`).
- `git show HEAD:src/styles/v6/viewport.css` has no Camera views `max-height` or `overflow-y` contract and no intrinsic-size status declarations.
- The intrinsic ViewCube margin cap is 96px; the responsive helper reduces that value only when the renderer's shortest side requires it.

## Validation

- `npm run test:run -- src/features/scene/v5/V5WorkcellWorkspace.test.tsx src/features/viewport/v6/ViewportOverlayV6.test.tsx` — 2 files, 20 tests passed.
- `npm run test:run -- src/features/scene/v5 src/features/viewport/v6` — 10 files, 69 tests passed.
- `npm run typecheck` — passed.
- `npm run lint` — passed.
- `npm run build` — passed; Vite emitted only the existing large-chunk warning.
- `git diff --check` — passed.

## Commit

Commit SHA: see the final `git rev-parse HEAD` handoff value.

## Fix Round 1

The independent review rejected source-text CSS assertions. The source-text checks were removed from `src/features/scene/v5/V5WorkcellWorkspace.test.tsx` and `src/features/viewport/v6/ViewportOverlayV6.test.tsx`. Behavior-facing coverage now lives in `tests/ui-v6-scene.spec.ts` and exercises 1440x900 plus 512x384.

- Canvas/status/toolbar rectangles are asserted inside the live viewport.
- The live renderer's production ViewCube size and bottom-right alignment attributes identify the real surface under test. The temporary safe-margin attribute used in this round was removed after review.
- Camera views is opened at both sizes; its menu rectangle is asserted inside the host/viewport, all seven menu items are present, and the short viewport drives `scrollTop` to verify an internal scroll region.

Validation output:

- `npm run test:run -- src/features/scene/v5/V5WorkcellWorkspace.test.tsx src/features/viewport/v6/ViewportOverlayV6.test.tsx` — 2 files, 18 tests passed.
- `npx playwright test tests/ui-v6-scene.spec.ts` — 4 tests passed, including the new viewport bounds/menu scroll test.

## Fix Round 2

- Removed the production-only `data-view-cube-safe-margin` hook from `V5WorkcellWorkspace.tsx`; the browser check no longer trusts a value that can diverge from Drei's rendered placement.
- Increased the intrinsic `GizmoHelper` margin cap to 96px after screenshot evidence showed the former 48px margin placed the visible cube against the renderer's right and bottom edges.
- Added a small PNG decoder to `tests/ui-v6-scene.spec.ts` to measure the actual light ViewCube pixels from live `renderer.screenshot()` output. The test now checks pixel count, footprint size, bottom-right alignment, and at least 8px clearance on every renderer edge at 1440x900 and 512x384.
- Page-level narrow-shell command-rail occlusion remains owned by Task 2; this round proves the intrinsic renderer surface only and does not add shell coupling.

Validation output:

- `npm run test:run -- src/features/scene/v5/V5WorkcellWorkspace.test.tsx src/features/viewport/v6/ViewportOverlayV6.test.tsx` — 2 files, 18 tests passed.
- `npx playwright test tests/ui-v6-scene.spec.ts --grep "ViewCube, status"` — 1 test passed with screenshot-backed pixel bounds at both viewports.
- Observed renderer pixel bounds: 1440x900 produced a 1112x810 renderer with ViewCube pixels x=965..1066, y=656..771; 512x384 produced a 464x264 renderer with pixels x=244..450, y=101..244. Both retain at least 8px renderer-edge clearance.
