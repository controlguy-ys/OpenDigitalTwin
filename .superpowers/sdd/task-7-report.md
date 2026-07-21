# Task 7 Report: NED2 Handover Acceptance and Operator Runbook

## Status

DONE

Commit subjects:

- `test: verify offline NED2 handover demo`
- `test: assert terminal handover fault ownership`

## Scope delivered

- Added `tests/hackathon-handover-demo.spec.ts` with the offline happy path,
  COMPLETE and READY acceptance, a strict Header Offline assertion, the
  GRIP_CONFIRM_TIMEOUT ownership invariant, and Reset fault clearing.
- Added the exact operator and fault-injection flows to `README.md` and
  `docs/operator/working-demo-known-limitations.md`.
- Documented fixed Joint keyframes, local simulated Grip Confirm, visual-only
  Shared Zone, and the absence of physics, IK, and safety-rated validation.
- The live visual check did not justify changing sample `POSES`; the existing
  TCP-coincidence unit coverage remains intact.

## Browser-plugin evidence

The browser plugin ran first against Chrome at `http://127.0.0.1:4173/`
(`RobotSim`, approximately 1919 x 977). Semantic DOM controls loaded the sample,
selected NED2-A and the direct-handover Job, opened Timeline, started and reset
the flow, and exercised Grip Confirm Timeout.

Observed status checkpoints:

- `Step READY | Part TABLE | Shared Zone NONE`
- `Step PICK_GRIP | Part NED2-A | Shared Zone NONE`
- `Step HANDOVER_CONFIRM | Part NED2-A | Shared Zone NED2-A`
- `Step COMPLETE | Part OUTPUT_TRAY | Shared Zone NONE`
- Fault: `Failure GRIP_CONFIRM_TIMEOUT` with NED2-A retaining Part and Shared
  Zone ownership; Reset returned READY and cleared the toggle.

Screenshots were deliberately kept outside the repository:

```text
C:\Users\googo\AppData\Local\Temp\robotsim-handover-task7-20260721-200146\READY.png
C:\Users\googo\AppData\Local\Temp\robotsim-handover-task7-20260721-200146\PICK_GRIP.png
C:\Users\googo\AppData\Local\Temp\robotsim-handover-task7-20260721-200146\HANDOVER_CONFIRM.png
C:\Users\googo\AppData\Local\Temp\robotsim-handover-task7-20260721-200146\COMPLETE.png
C:\Users\googo\AppData\Local\Temp\robotsim-handover-task7-20260721-200146\GRIP_CONFIRM_TIMEOUT.png
```

The two Robot meshes, owning-TCP Workpiece placement, transparent wireframe
Shared Zone, and final Output Tray placement were visible. Console inspection
found no application error or framework overlay; it contained two existing
`THREE.Clock` deprecation warnings. One optional canvas zoom gesture timed out
after 10 seconds at `Input.synthesizeScrollGesture`; semantic browser control,
status inspection, and screenshot capture remained healthy, so no browser
fallback was required. The screenshots preceded the separately routed Header
presentation correction; the final strict Playwright assertion proves Offline.

## TDD evidence

Initial acceptance RED exposed ambiguous NED2-A text matching and then captured
the exact accessible status punctuation. After narrowing semantic locators, the
happy and fault paths reached their intended states. A subsequent strict Header
Offline RED exposed the gateway presentation issue; its owning correction was
routed outside Task 7 and retained here as a strict regression assertion.

Review closure replaced the two sequential fault-state checks with one terminal
status assertion covering HANDOVER_CONFIRM, Part NED2-A, Shared Zone NED2-A,
and Failure GRIP_CONFIRM_TIMEOUT together. The first exact-status RED exposed
the rendered `| Failure` delimiter; the corrected assertion then passed both
targeted scenarios (2/2 in 46.1s), while retaining READY Reset and fault-toggle
clearing checks.

## Required verification, in order

```text
npm run lint
PASS, 0 findings.

npm run test:run
PASS, 171 files and 2,190 tests; 172.11s.

npm run build
PASS, 2,225 modules transformed.

npm run test:e2e:v4
PASS, 2/2; 53.8s.

npm run test:e2e:viewport
PASS, 1/1; 35.0s.

npm run test:e2e:layout
PASS, 11/11 on the required full rerun; 4.1m.

npx playwright test tests/hackathon-handover-demo.spec.ts
PASS, 2/2; 50.9s.

git diff --check
BLOCKED only by the preserved unrelated user-owned
.superpowers/sdd/task-4-brief.md:71 blank line at EOF.
Task 7 scoped and staged diff checks both PASS.
```

The first layout run was 10/11 because the shortcut test did not observe its
viewport-preferences localStorage write in time. The isolated test passed 1/1,
then the required full command passed 11/11. Build and E2E retain existing OCCT
`path`/`crypto` externalization and large-chunk warnings. Runtime gateway
`ECONNREFUSED 127.0.0.1:8081` messages are expected for this offline flow and
the Header now presents the state as Offline.

## Self-review

The Task 7 commits contain the acceptance spec, two operator-document updates,
and this evidence report. No sample pose, application source, STEP asset,
backup, package artifact, raw log, PLC write, push, merge, or unrelated Task 4
edit is included.
