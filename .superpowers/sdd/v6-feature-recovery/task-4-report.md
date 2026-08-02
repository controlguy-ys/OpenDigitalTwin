# Task 4 report: ViewCube and camera clarity

Baseline: `09c157dea8801f1310fa98176114c0fdd632a11a` (`Task 3`)

## RED

Focused command:

```text
npm run test:run -- src/features/scene/v5/V5WorkcellWorkspace.test.tsx src/features/viewport/v6/ViewportOverlayV6.test.tsx src/app/v6/AppV6.test.tsx
```

Evidence: `.superpowers/sdd/v6-feature-recovery/task-4-red.txt`.

The new tests failed before implementation for the intended reasons: the HTML
`data-testid="v6-view-cube"` duplicate was still present, the real Drei cube
had no V6 orientation callback or dominant-size wrapper, and AppV6 did not pass
the shared camera controller into the Canvas.

## GREEN

The same focused command passed after implementation: 3 files, 26 tests, 0
failures (root verification; existing R3F/jsdom casing warnings are stderr
noise only). The focused suite covers:

SHA-pinned verification summary: `.omo/evidence/task-4-viewcube-verification.md`.

- real `GizmoViewcube` face labels, 88/60 scale, cardinal face routing, and an
  edge/corner isometric route;
- AppV6 wiring from the real Canvas callback to `CameraControllerV6`;
- all seven keyboard-accessible orientation commands, plus Home, Fit All,
  Focus Selection, and Translate preservation;
- absence of the redundant HTML `v6-view-cube` surface.

## Direct one-ViewCube evidence

- `src/features/scene/v5/V5WorkcellWorkspace.tsx` contains one rendered
  `GizmoViewcube`, inside one `GizmoHelper`, with the fixed six-face array and
  `data-view-cube-surface="interactive-3d"` Canvas marker.
- `src/features/viewport/v6/ViewportOverlayV6.tsx` contains no HTML cube
  element or `data-testid="v6-view-cube"`; the overlay keeps only the standard
  camera command buttons.
- The GREEN overlay assertion checks
  `screen.queryByTestId('v6-view-cube') === null` while all seven orientation
  buttons invoke the shared controller.

## Camera safe-area evidence

The real cube uses an 88 px footprint and a 104 px top/right Gizmo margin. The
overlay orientation grid starts at `top: 160px`; the Home/Fit/Focus/Translate
grid starts at `top: 236px`, with 32 px minimum hit targets. Thus the overlay
starts below the cube's approximately 60..148 px safe band and the two control
rows do not intersect. The focused tests assert the explicit
`outside-view-cube` and `below-view-cube` placement contracts.

## Feature-preservation matrix

| Existing function | Result | Evidence |
| --- | --- | --- |
| Orbit (left/middle), pan (Shift+middle), zoom (wheel) | Retained | `V6_CAMERA_MOUSE_MAPPING`; WorkcellViewportV6 tests |
| Six standard face orientations | Retained | Real cube faces and orientation adapter; overlay test |
| Isometric orientation | Retained | Real cube edge/corner callback plus standard `Set isometric view` button |
| Home / Fit All / Focus Selection | Retained | Overlay focused test and shared camera controller |
| Translate command and disabled explanation | Retained | Existing overlay focused test |
| TCP marker | Retained | Existing overlay focused tests |
| ViewCube visibility and safe area | Improved | One real Canvas cube, 88 px scale, 104 px margin, CSS safe placement |
| Browser-only camera state | Retained | AppV6 callback uses `camera.setOrientation`; no Project/runtime mutation |

## Owned changes

`src/features/scene/v5/V5WorkcellWorkspace.tsx`,
`src/features/scene/v5/V5WorkcellWorkspace.test.tsx`,
`src/features/viewport/v6/ViewportOverlayV6.tsx`,
`src/features/viewport/v6/ViewportOverlayV6.test.tsx`,
`src/styles/v6/viewport.css`, and the narrow AppV6 callback/test wiring approved
by the parent integrator (`src/app/v6/AppV6.tsx`, `src/app/v6/AppV6.test.tsx`).

No external OPC UA, PLC, robot, transfer, or deployment action was performed.
