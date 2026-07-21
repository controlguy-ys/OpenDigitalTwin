# Task 7 Gateway Integration Fix Report

## Status

DONE

## Root Cause and Semantic Decision

- When the local Runtime Gateway is absent, Vite converts the upstream `ECONNREFUSED` into a generic non-JSON HTTP 502 response.
- The Runtime Gateway publisher correctly surfaced that response as `RUNTIME_GATEWAY_HTTP_502`, but App treated every publisher failure as an application error and the Header exposed the raw transport message.
- Runtime Gateway presentation now has an explicit `offline` phase.
- A rejected transport (`RUNTIME_GATEWAY_UNAVAILABLE`) or generic proxy-generated `RUNTIME_GATEWAY_HTTP_502` is presented as `Offline`.
- A structured HTTP error response from the Gateway retains its application error code and message, including when its HTTP status is 502.
- Local Project and Handover controls remain available while the Gateway is Offline.

## TDD Evidence

- RED: 3 focused assertions failed because the Header mapped `offline` to `Idle` and App exposed transport/proxy failures as raw errors; 15 existing focused tests passed.
- GREEN: 3 files and 34 tests passed through the real Runtime Gateway publisher, App integration, and Header derivation.
- The regression covers rejected transport, non-JSON proxy 502, structured application 502, and continued local Project control availability.

## Verification

- Focused gate: 3 files, 34 tests passed.
- Full unit gate: 171 files, 2,188 tests passed.
- `npm run lint`: passed with zero diagnostics.
- `npx tsc --noEmit --strict`: passed with zero diagnostics.
- Task 7 Playwright and documentation files were not changed by this fix.

## Commit

- `fix: present unavailable runtime gateway as offline` (exact SHA reported in the handoff)

## Self-Review

- The fix is limited to Runtime Gateway failure classification, presentation state, Header labeling, and targeted tests.
- Generic proxy 502 is treated as transport unavailability; structured Gateway errors remain distinguishable.
- No Gateway retry, job execution, Handover runtime, PLC, deployment, or E2E behavior was changed.
