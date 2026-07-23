# M5 Foundation A2 report

## Delivered

- Added the V5-only Project store with hydrate, New, save, canonical export, and validated import operations. Its active Project is a projection of the Project V5 mutation/publication authority.
- Added a minimal valid default V5 workcell factory with injected identity and clock dependencies.
- Added an isolated browser file-command port with explicit cancel, safe deterministic JSON filenames, and DOM/object-URL cleanup on success and failures.
- Added a StrictMode-safe initial bootstrap that coalesces in-flight callers, creates only after an authoritative empty hydrate, and proceeds when any joined caller remains active.
- Extended the approved publication/mutation authority narrowly: serialized `hydrate`, `replace`, and `subscribe`. Hydration reads durable pointer states explicitly, uses the stored revision record's config hash verbatim, restores Browser Runtime/Gateway inside the coordinator queue, finalizes valid interrupted publications, compensates failed interrupted publications, and enters recovery-required on unrecoverable durable corruption/convergence failure.
- Hardened healthy-empty hydration with transactional Browser Runtime deactivation plus canonical Gateway inactive readback. The Browser runtime can roll the exact prior graph back or finalize it away and subsequently publish New.
- Added exact stable/publishing pointer-tuple readbacks around activation, finalization, and compensation. First-publication interruption never deletes the only durable target on restoration failure.
- Made publication recovery observable with snapshot-safe listener notification and a read-only recovery error projected by the store without replacing its last active object.
- Moved cleanup to an ordered, non-blocking retained drain: runtime finalize, previous Gateway cleanup, then repository garbage collection. Failed/running cleanup rejects overlapping publication quickly; explicit retries share and await the exact drain/retry generation. A synchronous retry requested while the current retry generation reports another failure is retained as one following generation, so consecutive failures cannot lose callback-requested work.
- Added a private monotonic Browser Runtime authority generation. Empty-state publish/deactivate ABA cycles and commit/rollback cycles invalidate old candidates without changing the exact restored public Bundle/graph identity.
- Reworked StrictMode bootstrap to publish shared hydration and New handles before invoking store methods, including synchronous reentry, late saving-state joins, shared failure, and later retry.
- Made picker cleanup independently best-effort and guaranteed promise settlement when listener removal, element removal, or file access throws.

## Boundary checks

- No A2 production file imports V4 project/job code, has a V4 database name, Legacy switch, raw OPC UA NodeId, or a structural conversion adapter.
- New/Import route only through mutation-service replacement; the store never calls repository, Browser Runtime, or Gateway primitives.
- Decode completes before Import replacement is requested, so real codec/validation failures retain the exact previously projected active object. Reordered valid JSON is normalized and re-exported as canonical V5 JSON.

## Tests and validation

- Focused A2 plus all A1 runtime/publication/mutation/repository/codec/database tests: 14 files, 255 tests passed.
- `npm run test:job-io`: 48 files, 779 tests passed.
- `npm run build:gateway`: passed.
- `npm run build`: passed.
- `npm run lint`: passed. Existing unrelated warning remains at `middleware/runtime-gateway/main.test.ts:520` (`unicorn/no-useless-spread`).
- `git diff --check`: passed. `check:diff` is not defined in `package.json`.

## Known non-blocking output

- Vite reports pre-existing browser externalization/chunk-size warnings from `occt-import-js` and the large production chunk. They do not affect TypeScript or build success.
