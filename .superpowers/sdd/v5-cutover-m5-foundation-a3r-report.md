# M5 Foundation A3R report

## Repair commits

- `390ced4 fix(v5): fence gateway activation authority`
- `b240dc3 fix(v5): reconcile publication authority recovery`
- `301ce6d fix(v5): harden gateway diagnostic recovery`
- `f676168 fix(v5): bound namespace diagnostics`

## Delivered

- Added the closed V5 Project activation request with coordinator-supplied config revision, bounded activation-attempt ID, candidate Project, and exact expected Gateway authority. Native activation performs this comparison inside its serialized transition and returns `PROJECT_ACTIVATION_CONFLICT` without stopping or replacing the winning runtime.
- Extended validated Gateway status with the active attempt token and strict `ready`, `deactivating`, and `recovery-required` authority/readiness combinations. Recovery-required retains the exact active authority tuple rather than advertising ready or empty.
- Made browser publication prepare capture the Gateway's exact authority. Prepared candidates have deterministic injectable attempt IDs; rollback returns an explicit disposition, and the coordinator reactivates a previous Project only after verified candidate deactivation.
- Hydration accepts only an inactive Gateway or an exact active durable Project authority. Prepared runtime/Gateway handles are tracked with booleans so valid `void` handles are compensated. Commit response loss is reconciled by exact durable revision and commit token before compensation; unknown outcomes require recovery.
- Made identical logical replacement skip stale `cleanupPrevious`, allowing unchanged export/import followed by a later mutation.
- Fenced DELETE includes the activation attempt. Ambiguous rollback completion reads status and retries only the exact active candidate; explicit conflict is distinguished from an already-absent candidate or another authority.
- Deactivation now keeps exact authority through adapter shutdown and a settled local cleanup tail. It deactivates the Hub before clearing active authority; any local tail failure leaves the authority fenced as `recovery-required`.
- Runtime-validates and canonicalizes temporary Test Connection results, rejects injected fields/unsupported codes, bounds the shared error envelope, and never echoes arbitrary diagnostic fields.
- Reader overflow cancellation is fire-and-observe rather than awaited. Namespace resolution captures runtime authority briefly, reads NamespaceArray outside the transition queue, then verifies runtime token, generation, and adapter identity before returning.

## Verification

- Focused Gateway/publication/diagnostic suite: 5 files, 158 tests passed before the final diagnostic slice; final focused Gateway/publication/client suite: 3 files, 152 tests passed; final diagnostic-focused run: 4 files, 168 tests passed.
- `npm run test:job-io`: 49 files, 815 tests passed.
- `npm run build:gateway`: passed.
- `npm run build`: passed; Vite retained existing externalized `path`/`crypto` and chunk-size warnings.
- `npm run lint`: passed with the existing `middleware/runtime-gateway/main.test.ts:544` `unicorn(no-useless-spread)` warning.
- `git diff --check`: passed.

## Gateway baseline

`npm run test:gateway` ran 430 tests: 426 passed and 4 failed. The remaining failures are the pre-existing V4 adapter/publisher fixtures that omit required `robotDefinitions[0].mechanics`; the A3R server-model integration test passes with the closed V5 activation request. No V4 production compatibility path was added.

## Remaining caveat

The deactivation local cleanup tail is authoritative and covered by the existing stop/recovery tests, but not every individual local cleanup primitive is independently injectable. A fresh SOL Ultra review remains required before accepting A3R.
