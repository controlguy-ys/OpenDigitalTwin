# M5 Foundation A3 report

> Superseded by the A3R repair report: `v5-cutover-m5-foundation-a3r-report.md`.
> The repair commits are `390ced4`, `b240dc3`, `301ce6d`, and `f676168`.

## Delivered

- Added the V5-only connectivity client implementing the approved A2 publication port with opaque prepared candidates, exact config-revision validation, fenced rollback, canonical empty deactivation, bounded same-origin requests, and the two narrow diagnostic calls.
- Added closed, 64 KiB diagnostic request validation, an isolated temporary anonymous OPC UA connection test, and live-session namespace URI resolution.
- Added fenced `DELETE /runtime/project`. It stops adapters and clears runtime command/lease/timer state before deactivating the state hub; a stop failure attempts exact recovery of the captured active Project and reports recovery-required rather than claiming an empty runtime.
- Kept V4 imports out of the new browser client and did not expose browse/read/write/security/container controls.

## Verification

- Focused: 12 files, 270 tests passed (Project V5, shared protocol, A3 browser client, temporary connection test, OPC UA adapter, and runtime gateway routes).
- `npm run test:job-io`: 49 files, 810 tests passed.
- `npm run build:gateway`: passed.
- `npm run build`: passed (existing Vite dependency/chunk-size warnings only).
- `npm run lint`: passed; the sole warning is the existing `main.test.ts:520` `unicorn(no-useless-spread)` warning.
- `git diff --check`: passed.

## Known gate issue

`npm run test:gateway` ran 427 tests; 423 passed and 4 failed in untouched V4 adapter/publisher tests. Each failure is caused by the pre-existing V4-to-V5 fixture omitting now-required `robotDefinitions[0].mechanics`, not by the A3 files. The same command at baseline `618fe4f` ran 390 tests; 386 passed and the same four V4 tests failed with the same `PROJECT_VALUE_INVALID` error.

## A3R verification update

After A3R, `npm run test:job-io` passed 49 files / 815 tests, both builds and lint passed, and `npm run test:gateway` passed 426 / 430 tests. The unchanged four failures remain the documented V4 mechanics-fixture baseline; see the A3R report for the repair scope and remaining SOL review caveat.
