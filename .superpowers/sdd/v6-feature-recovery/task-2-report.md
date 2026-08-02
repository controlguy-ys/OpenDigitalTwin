# Task 2 report: Toolbox information architecture and Group recovery

## Result

V6 Model Toolbox now exposes semantic `Interaction`, `Geometry`, and `Camera` sections. Existing Select, Translate, Rotate, Add Box, Add Cylinder, Focus Selection, and Fit All command IDs remain stable and each control is rendered once. Add Group is restored in the Geometry section and Model menu. It creates a visible root Group through one expected-revision Project V5 mutation and selects the new Group only after the mutation succeeds.

## TDD evidence

### RED

Root captured the focused pre-implementation run with 3 failures and 12 passing tests. The failures were the expected behavioral gaps:

- `model.addGroup` was unknown to the V6 composition/registry.
- `SceneCommandServiceV6.createGroup` did not exist.
- `ModelToolboxV6` had no semantic `Interaction` section heading.

The first local attempt was blocked before test collection by Windows Vite `spawn EPERM`; the same focused run was then executed by the root agent to capture the behavioral RED above.

### GREEN

Exact focused command:

```text
npm run test:run -- src/features/ui/v6/ModelToolboxV6.test.tsx src/features/scene/v6/scene-command-service-v6.test.ts src/app/v6/app-command-composition-v6.test.ts src/features/ui/v6/command-surfaces-v6.test.tsx
```

Result: 4 files passed, 27 tests passed, 0 failed.

Additional static evidence: `npm run typecheck` and `git diff --check` both passed with no reported errors.

## Feature-preservation matrix

| Existing or recovered function | Surface | Result | Evidence |
| --- | --- | --- | --- |
| Select | Toolbox / `tool.select` | Retained | `ModelToolboxV6.test.tsx` renders and invokes once |
| Translate | Toolbox / `tool.translate` | Retained | `ModelToolboxV6.test.tsx` renders and invokes once |
| Rotate | Toolbox / `tool.rotate` | Retained | `ModelToolboxV6.test.tsx` renders and invokes once |
| Add Box | Toolbox and Model menu / `model.addBox` | Retained; remains distinct | Stable command ID and separate button regression coverage |
| Add Cylinder | Toolbox and Model menu / `model.addCylinder` | Retained; remains distinct | Stable command ID and separate button regression coverage |
| Add Group | Toolbox Geometry and Model menu / `model.addGroup` | Recovered | Composition and scene-service tests prove one mutation and Group selection |
| Focus Selection | Toolbox / `view.focusSelection` | Retained in Camera | Stable command ID and once-only invocation coverage |
| Fit All | Toolbox / `view.fitAll` | Retained in Camera | Stable command ID and once-only invocation coverage |
| Root Group visibility | Project V5 `sceneGroups` | Recovered | New record is `{ parentGroupId: null, visible: true }` |
| Selection after Group creation | V6 selection | Recovered | Selection callback runs only after mutation resolves |

No existing user-facing function was removed, hidden, disabled, or merged.

## Scope and review notes

Only V6 command IDs/composition/menu placement, the V6 scene service Group-creation path, the V6 Model Toolbox and its focused tests, and Toolbox-specific CSS were changed. No external OPC UA, PLC, robot, transfer, or deployment action was performed.
