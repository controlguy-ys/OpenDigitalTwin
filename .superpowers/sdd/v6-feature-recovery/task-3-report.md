# Task 3 report: primitive-specific geometry editing

## Result

The V6 Object Inspector now exposes primitive-specific geometry editors. Boxes edit width, depth, and height independently; Cylinders edit radius and height while displaying and preserving the fixed axis and radial segment contract. Each valid Apply uses one expected-revision Project V5 mutation. Asset geometry remains read-only. Transform ownership rules and the existing Runtime, Transform, Status, Communications, and Binding behavior remain intact.

## RED/GREEN evidence

### RED

Root captured the focused pre-implementation run:

```text
npm run test:run -- src/features/inspector/v6/ObjectInspectorV6.test.tsx
1 file; 3 failed, 5 passed
```

The three failures were the expected missing Box controls, missing Cylinder controls, and missing asset read-only presentation.

### GREEN

Root reran the same focused file after the production change:

```text
npm run test:run -- src/features/inspector/v6/ObjectInspectorV6.test.tsx
1 file; 10 passed, 0 failed
```

Additional static validation:

```text
npm run typecheck -- --pretty false
exit code 0
```

```text
npx oxlint src/features/inspector/v6/ObjectInspectorV6.tsx src/features/inspector/v6/ObjectInspectorV6.test.tsx
exit code 0
```

The focused tests cover independent Box dimensions, one revision-fenced mutation, latest published revision and concurrent entity preservation, geometry-draft reset on revision change, Cylinder radius/height with axis and radial-segment preservation, simulation-owned Transform with geometry still editable, positive finite validation without publication, and asset read-only behavior.

Root will record the SHA-pinned focused command and final changed-file verification in `.omo/evidence/task-3-primitive-inspector-verification.md`.

## Preservation matrix

| Existing or required surface | Result | Evidence |
| --- | --- | --- |
| Box width/depth/height authoring | Recovered; three independent inputs feed one Apply | `ObjectInspectorV6.test.tsx` Box mutation assertion |
| Cylinder radius/height authoring | Recovered; axis and radialSegments remain unchanged | `ObjectInspectorV6.test.tsx` Cylinder recipe assertion |
| Positive finite geometry validation | Enforced; blank, zero, negative, and non-finite drafts return before `readPublished()` | Focused invalid-draft test |
| Atomic Project V5 mutation boundary | Retained; valid Apply calls `mutate` once with current `expectedRevisionId` | Focused Box/Cylinder `toHaveBeenCalledOnce()` assertions |
| Non-primitive asset geometry | Read-only text; no primitive inputs or Apply controls | Focused asset test |
| Transform | Retained, including manual-only authoring and ownership explanation | Existing Transform tests remain green |
| Status | Retained | Existing inspector suite remains green |
| Communications | Retained, including enable/tag recipes and no OPC UA write | Existing communications test remains green |
| Binding | Retained through the existing Open Binding action and target mapping | Existing binding assertion remains green |

## Changed files

- `src/features/inspector/v6/ObjectInspectorV6.tsx`
- `src/features/inspector/v6/ObjectInspectorV6.test.tsx`
- `src/styles/v6/scene.css`

No external OPC UA, PLC, robot, transfer, or deployment action was performed. The pre-existing untracked `.omo/` coordination artifacts were not staged.
