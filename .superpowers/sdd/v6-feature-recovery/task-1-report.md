# Task 1 report: responsive shell and failed-Job recovery

## Scope

Task 1 owns the V6 application shell, menu bar, shell styles, focused V6 shell/menu tests, and `tests/ui-v6-accessibility.spec.ts`. No other production file was changed. The existing Job monitor implementation and its failed-step action were preserved.

## RED evidence

Behavior-focused tests were added before the implementation:

- `src/features/ui/v6/command-surfaces-v6.test.tsx` now asserts a `More menus` menuitem exposes all eight top-level menu names and the Project command surface.
- `src/features/ui/v6/ApplicationShellV6.test.tsx` now asserts a narrow command-bar/status seam and a bottom-sheet offset by `--v6-narrow-command-height`.
- `tests/ui-v6-accessibility.spec.ts` now asserts the compact menu surface, header bounds, dock-control non-overlap at 1024 x 768 and 512 x 384, and the failed-step recovery button's bottom edge.

The first focused RED attempts were blocked by the Windows sandbox before test collection:

```text
npx playwright test tests/ui-v6-accessibility.spec.ts --grep "compact menu command surface|failed-step recovery"
Error: spawn EPERM
```

```text
npm run test:run -- src/features/ui/v6/ApplicationShellV6.test.tsx src/features/ui/v6/command-surfaces-v6.test.tsx
[plugin externalize-deps]
Error: spawn EPERM
```

An escalated Playwright retry was stopped after approximately 313 seconds without a result, and an escalated Vitest retry was stopped after approximately 192 seconds without a result. Ports 4173 and 8081 had no listeners afterward. The pre-fix assertions were therefore recorded as the intended RED contract, but no browser RED screenshot was claimed.

## Implementation

- Added a responsive `More menus` menuitem to `AppMenuBarV6`. It exposes Project, Home, Model, Job, Simulation, Connectivity, View, and Help, then renders the existing registry-backed command surfaces or Connectivity actions in a nested compact surface.
- Preserved desktop top-level menu markup, menu roles, roving focus, Escape behavior, Shift+F10 dispatch, and trigger focus restoration. Narrow mode observes the shell's measured `data-workspace-mode` and routes horizontal menu navigation to the compact trigger.
- Reflowed compact headers into a two-row grid and narrow headers into brand/menu/status rows. Narrow mode keeps Project as the direct entry point and exposes all other menus through the overflow surface.
- Reserved a 76 px narrow command bar below the Job sheet. Dock toggles use a constrained three-column grid, and the compact Job status is presented in a dedicated status row while the existing inline status text remains for desktop/compact compatibility.
- Moved the narrow Job sheet above the command bar and tightened only shell-scoped Job monitor spacing so the existing `Inspect failed step` action remains in the initial visible sheet region.

## GREEN evidence

The focused Vitest command was rerun after the role-query correction:

```text
npm run test:run -- src/features/ui/v6/ApplicationShellV6.test.tsx src/features/ui/v6/command-surfaces-v6.test.tsx
2 files passed; 24 tests passed; 0 failed
```

Additional static checks:

```text
npx tsc -b --pretty false --noEmit
exit code 0

npm run lint
exit code 0

git diff --check
exit code 0
```

The new Playwright accessibility checks were not run in this environment because the local server/test process path hit `spawn EPERM`; they remain the required live validation for the 1024 x 768 and 512 x 384 acceptance dimensions.

## Changed files

- `src/features/ui/v6/AppMenuBarV6.tsx`
- `src/features/ui/v6/ApplicationShellV6.tsx`
- `src/styles/v6/shell.css`
- `src/features/ui/v6/command-surfaces-v6.test.tsx`
- `src/features/ui/v6/ApplicationShellV6.test.tsx`
- `tests/ui-v6-accessibility.spec.ts`

## Preservation matrix

| Existing surface | Result |
| --- | --- |
| Project, Home, Model, Job, Simulation, Connectivity, View, Help top-level menus | Retained directly on desktop; all eight are retained in the narrow More menus surface. |
| Registry-backed menu commands | Retained; compact commands use the same `AppCommandRegistryV6` IDs and invocation path. |
| Connectivity Settings, Monitor, Binding Overview, Docker Run Guide | Retained; compact callbacks restore focus to the More menus trigger. |
| Desktop menu roles and roving focus | Retained; existing trigger/menu markup and handlers are unchanged on wide/compact desktop layouts. |
| Escape, Shift+F10, and trigger focus restoration | Retained; overflow Escape closes and restores focus, while the existing global keyboard seams remain active. |
| Scene Explorer, Inspector, and Job Monitor dock actions | Retained with the same `aria-pressed` state and store/drawer handlers; only narrow placement changes. |
| Job status | Retained inline for existing desktop/compact consumers and exposed in a dedicated narrow status row. |
| Retry Job and Inspect failed step | Retained in the existing Job monitor; the narrow sheet is offset above the command bar so the recovery action can be reached without scrolling the page. |
| Main View maximize/restore and shell masking | No production behavior or markup removed; desktop shell grid and maximize selectors remain intact. |

## Concerns

- Live Playwright geometry and the full V6 E2E suite still need to be rerun in an environment where the preview/Gateway process can start without Windows `spawn EPERM`. This report does not claim live screenshot acceptance.
- `npm run verify` was not run; focused Vitest, TypeScript, lint, and diff checks are the available evidence for this change.
- The narrow status row intentionally duplicates the React status node: the legacy inline copy is `aria-hidden` and the dedicated row is the visible accessible copy.
