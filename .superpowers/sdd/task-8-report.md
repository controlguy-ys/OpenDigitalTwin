# Task 8 Report: Project Round-Trip, Limits, Layout, and Regression Safety

## Status

DONE

## Scope delivered

- Added one end-to-end reusable workcell scenario with a STEP Object, Group,
  Local XYZ/RPY, a three-Pose Job at 25/60/20 percent, one X Linear Axis,
  Robot attach/detach, explicit mount contact, Save/Export/reload, and Ungroup.
- Proved OPC UA transform ownership must switch to Manual before grouping.
- Proved reparent, Robot attach/detach, and Ungroup preserve World pose.
- Proved persisted Hide survives reload while transient Isolate clears.
- Proved Light theme persists browser-locally without changing Project content.
- Proved Home View preserves the Project snapshot and live Robot Joint values.
- Proved the 1366 by 768 document has no horizontal or vertical scrollbar and
  both Scene Objects and Robot Jobs remain accessible.
- Added deterministic browser evidence for 80 percent advisory warnings and
  blocking the 65th STEP Asset before any additional STEP parse or revision.
- Added a real repository/coordinator integration boundary for Instance 256
  acceptance and Instance 257 rejection with revision, pointer, and source blobs
  unchanged after the rejected command.
- Extended V3 round-trip diagnostics with Scene Entity count, Job count, and an
  explicit absence check for viewport/theme/browser preference fields.
- Updated README, developer architecture guidance, and current project status.
- Closed the three post-review gaps: reachable Linear Axis/mount-contact UI,
  the approved type-specific context-action matrix, and visible non-persistent
  warning/error feedback.

## Defects found and closed

1. The 65th STEP import reached OCCT parsing and source staging before the V3
   validator rejected it. The dialog now disables file input at the active
   boundary, and command preflight plus queued-recipe recheck protects races.
2. Context-menu confirmation buttons were visible but pointer events were
   intercepted by the application root. Modal dialogs now make the application
   root inert for their lifetime and restore its prior state on cleanup.
3. Instance overflow originally surfaced only a generic candidate-invalid
   error. STEP import, primitive creation, and Duplicate now report the exact
   current count and limit before work and recheck inside the queued mutation.
4. The existing Project `New` E2E locator conflicted with `+ New Job`; the
   Project action now uses an exact test locator.
5. The V3 semantic E2E used real OCCT conversion for all seven archive Robot
   sources and exceeded its storage-test timeout. The test now uses a
   deterministic Geometry Worker while retaining real archive bytes, digests,
   IndexedDB revisions, pointers, and source blobs.
6. Linear Axis creation and mount-contact mutation existed below the UI but had
   no complete operator path. Add now creates the one Axis, and the Robot
   Inspector publishes complete, incomplete, or cleared mount contact.
7. Several context-menu actions were missing or shared an over-broad matrix.
   Each Robot/Object/Group/Axis/empty-space target now exposes only its approved
   actions, with disabled states and confirmations where required.
8. Resource warnings and rejected operations could be console-only or swallowed.
   They now surface as accessible transient status/alert feedback and remain
   excluded from Project archives.

## TDD evidence

Initial STEP-limit RED:

```text
ImportStepDialog and SceneCommandService: 2 failures / 38 tests.
The parser/stager and mutation command were called for a limit-blocked import.
```

Modal browser RED:

```text
Switch to Manual was visible and enabled but the application root intercepted
pointer events until the action timeout.
```

Instance boundary RED:

```text
Instance 256 was accepted and state remained stable after 257, but the rejected
operation surfaced PROJECT_REVISION_CANDIDATE_INVALID instead of the exact limit.
```

Focused GREEN:

```text
App, ProjectMutationService, SceneCommandService, and ImportStepDialog:
4 files passed, 56 tests passed.

Reusable Scene browser scenario:
1 passed, 55.3 seconds in the final focused run.

Resource browser scenarios:
2 passed, 58.2 seconds.

V3 semantic round-trip:
1 passed, 21.8 seconds in the focused run.
```

Post-review RED/GREEN:

```text
RED A: Add menu lacked Linear Axis; Scene commands lacked mount-contact mutation;
       Robot Inspector lacked a mount-contact editor.
RED B: context menus lacked approved Focus/Fit/Axis/attachment actions and exact
       per-entity action sets.
RED C: no visible feedback helper/store existed for warnings and rejections.

GREEN: 8 focused files, 94 tests passed; the context menu suite passed 21/21.
The reusable browser scenario now creates/configures the Axis and mount contact
through the real UI rather than injecting Project JSON.
```

## Success-criteria coverage

| Criterion | Evidence |
| --- | --- |
| Reusable Scene Save/reload | `tests/reusable-scene-editor.spec.ts` |
| 64 accepted / 65 blocked before parse | V3 domain boundary, Scene command preflight, Import dialog, resource browser spec |
| 256 accepted / 257 rejected atomically | `project-v3.test.ts` plus real `project-mutation-service.test.ts` integration |
| 80 percent warnings non-blocking | Scene command unit and resource browser spec |
| Hide durable / Isolate transient | reusable Scene browser spec |
| World pose preserved | Scene transform/command tests and reusable Scene browser spec |
| OPC UA ownership gate | Scene command/context tests and reusable Scene browser spec |
| Axis attach/detach stationary | Scene command tests and reusable Scene browser spec |
| Explicit mount contact | collision domain/panel tests and combined Geometry Collision browser spec |
| 1366 by 768 no document scroll | reusable Scene browser spec |
| Theme outside Project | reusable Scene plus V3 durable-summary browser specs |
| Home View semantic isolation | viewport tests and reusable Scene browser spec |
| Axis and mount-contact UI reachability | AppShell/App/editor tests and reusable Scene browser spec |
| Exact context-action matrix | `SceneContextMenu.test.tsx` |
| Visible, non-persistent feedback | operation-feedback tests and resource browser/archive specs |

The exact 256/257 browser archive fixture was intentionally replaced by the
real mutation/repository integration proof: importing a synthetic 255-Instance
archive remained in archive hydration beyond the 180-second browser budget.
This mapping tests the required transaction boundary without claiming that the
synthetic maximum-size archive currently loads responsively. Browser coverage
remains in place for warnings and the STEP pre-parse boundary.

## Final verification

```text
npm run lint
PASS, no findings.

npm run test:run
118 files passed, 968 tests passed, 116.70 seconds.

npm run cad:validate
7 Link Assets valid; 0 errors; 0 warnings.

npm run build
PASS; 2205 modules transformed.

npm run test:e2e -- tests/project-v3-roundtrip.spec.ts tests/reusable-scene-editor.spec.ts tests/viewport-spatial-controls.spec.ts tests/geometry-collision.spec.ts
6 passed in 10.7 minutes.

npm run test:e2e:hash
1 passed in 6.3 seconds.

npm run test:e2e:archive
1 passed in 11.4 seconds.

npx playwright test tests/project-resource-performance.spec.ts --max-failures=1
2 passed in 58.3 seconds.
```

Independent scans found no active browser/runtime compatibility symbol and no
unfinished implementation marker in the approved Scene/Viewport/Job scope.
`git diff --check` passed.

The build retains the existing informational OCCT browser externalization and
large-chunk advisories.

## Concern

A synthetic 255-Instance `.wdtwin` browser import exceeded the 180-second E2E
budget. The exact 256/257 transaction boundary is correct and fast at the real
mutation/repository level, but maximum-size archive hydration remains a future
performance-optimization target.
