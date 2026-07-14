# Task 3 Report: Deterministic V3 Project Archives

## Outcome

- Added a deterministic, v3-only streaming encoder with the fixed twelve-JSON-entry
  layout and content-addressed Robot/Object STEP entries. Unordered collections and
  entry paths use code-unit ordering, JSON object keys are canonical, ZIP metadata is
  fixed, and Simulation Job/Pose domain order is preserved.
- Added random-access streaming decode that reads the manifest first, validates the
  central directory before expansion, expands one entry at a time, verifies exact
  path/index/CRC/digest relationships, and rejects missing, duplicate, unknown, or
  unreferenced entries before source staging.
- Added `ProjectArchiveCodecWorker` with fixed 4 MiB transferable chunks, strict
  request/response sequencing, streaming `fflate` ZIP encode, bounded inflate, exact
  120,000 ms operation watchdogs, AbortSignal propagation, generation-inert late
  messages, and cancellation/error cleanup.
- Kept source hashing single-rooted in `ProjectSourceStagingService`: decode does not
  SHA STEP payloads in the archive Worker. The high-level `prepareArchiveProject`
  operation synchronously validates and owns a complete byte-free metadata plan, then
  reads, transfer-detaches, hashes, and stages exactly one source before requesting the
  next. It returns only opaque prepared groups and rolls back the whole token set on
  any later failure; no raw source adopter or batch-buffer overload is exported.
- Added byte-free `ProjectDecodeResultV3 { projection, preparedSourceGroups, warnings }`
  with authentic, idempotent result revocation. No result field exposes `sourceBytes`,
  `ArrayBuffer`, or a typed-array view.
- Preserved V1/V2 import through streamed legacy layout extraction followed by the
  existing Task 2 migration. Legacy decode now builds only one-byte, path-aliased
  semantic placeholders plus central-directory size plans, then reads, transfers,
  hashes, and stages one unique namespace/path before requesting the next. A
  registry-backed, exact-service/dependency/signal-bound one-shot capability carries
  the pre-staged assignments across `reader.finish()` into migration, so migration
  does not restage or rehash them. The complete frozen migration dependency bundle is
  required and captured exactly once before its captured staging identity is compared
  with the base service and before the first await; unknown versions never downgrade.
- Tightened the encode client after the final input acknowledgement: while final ZIP
  output is pending, every response must be `encode-output`; duplicate acknowledgements
  and every other response type fail immediately with `PROJECT_ARCHIVE_WORKER_FAILED`.

## Fixed security and memory limits

- Archive input/compressed size: 300 MiB.
- Project-owned staged raw sources: 256 MiB aggregate.
- JSON entry: 8 MiB; JSON aggregate: 64 MiB.
- Worker auxiliary workspace: 64 MiB; central-directory workspace: 16 MiB.
- Transport chunk: exactly 4 MiB except the final chunk.
- Public encode/decode deadline and Worker watchdog: exactly 120,000 ms.
- Cancellation terminates the active Worker path within the 250 ms acceptance bound.

The decoder rejects unsafe/control/traversal paths, duplicate paths, unsupported flags,
encryption, unsupported methods, multi-disk archives, every ZIP64 sentinel/extra form,
malformed extras/comments/descriptors, local/central header disagreement, overlap or
out-of-range records, count and size overflows, CRC mismatch, and forged Worker
metadata. Cap-plus-one cases reject before source staging or output mutation.

## RED-to-GREEN evidence

- Initial archive tests failed because the V3 archive facade and archive Worker did not
  exist. GREEN covers one Robot STEP for seven Links, shared Object STEP blobs, inline
  Box/Cylinder records, live-field omission, byte-free round trips, and one staging
  digest per unique namespace source.
- Determinism tests cover repeated encodes, reversed unordered collections, reversed
  property insertion, fixed timestamps in UTC and Asia/Seoul, and preserved Job/Pose
  order.
- Protocol REDs exposed short non-final output chunks, early final responses, and
  queued responses after final. The client now rejects each malformed sequence and
  enforces the cumulative compressed cap.
- Validation REDs cover the complete central/local ZIP attack matrix, malformed Worker
  acknowledgements and metadata, digest/path/byte mismatches, conflicting equal-digest
  bytes, duplicate asset IDs, missing/unknown/unreferenced entries, and post-staging
  provenance failure rollback.
- Deadline REDs use fake time to prove that 70 seconds in phase one plus 50 seconds in
  phase two fails at the single public 120-second boundary rather than receiving a new
  timeout per phase. Abort is propagated through staging and provenance waits.
- Chromium strengthening first failed because the fixture expanded only one entry.
  GREEN processes all twelve entries sequentially and records the exact max-boundary
  workload and auxiliary-memory measurements below.
- The first streaming-staging RED had exactly two failures and 21 passes: the old raw
  batch API never invoked the planned reader, and a signal-ignoring second digest left
  the operation pending. GREEN preflights the complete owner/path/central-size plan
  before the first await, requests source two only after source one has become an
  opaque token, rejects abort within 250 ms, revokes/detaches the issued source, and
  transfer-detaches the still-pending digest buffer. Late digest completion mints no
  token. The same two-source cancellation is covered through the public decode facade.
- The follow-up legacy Archive REDs observed eight expanded STEP entries before the
  first and second staging digests, where the required maxima were one and two. GREEN
  covers both V1 and V2 through the public facade and proves one-entry read -> transfer
  -> digest -> token sequencing, one digest per unique namespace/path, shared-path
  aliasing, separate staging followed by digest de-duplication for equal bytes at
  different paths, and cross-namespace isolation for equal Robot/Object bytes.
- Legacy preflight now rejects owner-weighted Robot/Project byte overflow (including
  seven owners of one 20 MiB path), off-slot one-byte buffers, typed views, accessors,
  unsafe/duplicate/missing paths, invalid placeholder aliases, and substituted
  services/dependencies/signals before any read or hash. Capability tests cover forged,
  foreign, replayed, revoked, and prepare-to-consume abort states. Finish failure,
  migration failure, and explicit signal-ignoring late read/digest/analyzer settlement
  all detach bytes and revoke every prior/current/late token.
- A Worker-protocol RED resolved a Blob after a duplicate final input acknowledgement.
  The final-output drain now rejects that duplicate immediately; the complete Worker
  protocol matrix remains green.
- Independent review of the first follow-up found that a stateful legacy-migration
  `sourceStaging` getter could return base service A for the identity check and foreign
  service B for the later dependency capture. The fresh RED observed two getter reads
  where one was required, allowing B-owned prepared tokens to reach a decode result
  bound to A. GREEN snapshots the complete migration bundle first, compares only its
  frozen captured service, and then uses that same bundle exclusively. The regression
  proves one getter read, all eight digests on A, zero digests on B, and A-only token
  ownership in the returned result.
- Playwright wiring RED reproduced `RobotSim` instead of the Worker harness title when
  a dev-only spec was discovered by the preview-server config. The default suite now
  excludes both Worker harnesses, while dedicated hash/archive scripts use their exact
  dev-server configs and are part of `npm run verify`.

## Additional integration files and why they are required

The brief's six primary codec files were not sufficient to keep the existing browser
application functional while Task 4 repository publication remains out of scope:

- `src/domain/project/project-v3.ts` and
  `src/features/project/project-source-staging.ts` expose the high-level archive-only
  staging operation; no raw staging/adoption port is made public.
- `src/features/project/project-store.ts`, `project-store-browser.ts`, their tests, and
  `ProjectMenu.tsx`/its test provide the temporary V2 browser runtime adapter. It uses
  the streaming Worker and keeps Blob/File transport end to end until Task 4 replaces
  it; the menu no longer performs a whole-file read or creates a redundant export
  Blob.
- `playwright.archive.config.ts` and the three `tests/project-archive-worker.*` files
  are the required reference-Chromium max-boundary harness. They exercise the real
  browser Worker rather than a fake-Worker approximation.

## Verification

- Follow-up focused archive/staging/migration matrix: 6 files, 227 tests passed.
- Worker protocol/security matrix: 1 file, 55 tests passed.
- V3 archive facade matrix: 1 file, 24 tests passed.
- Archive staging matrix: 1 file, 24 tests passed.
- Task 3 brief command: 7 files, 162 tests passed.
- Full parallel Vitest: 83 files, 717 tests passed in 45.08 seconds.
- Full serial Vitest (`npx vitest run --no-file-parallelism --maxWorkers=1`): 83 files,
  717 tests passed in 140.98 seconds; no timing/order failure.
- Strict TypeScript (`npx tsc -b --pretty false`): passed.
- Lint (`npm run lint`): passed with zero warnings.
- Production build (`npm run build`): passed.
- CAD asset validation: 7 link assets valid; 0 errors; 0 warnings.
- Production source scan: no `zipSync`, `unzipSync`, `localeCompare`,
  `File.arrayBuffer()`, or menu-side Blob materialization. The only production
  `.arrayBuffer()` is the bounded `Blob.slice(offset, end).arrayBuffer()` range read in
  the archive Worker client.
- Internal-surface scan: no legacy Archive capability, plan, raw adopter, batch buffer,
  or prepared-token session is exported by the public project codec/menu/application
  facade. The prepare/consume authority remains a deep internal migration boundary.
- Working-tree diff check: passed before staging.
- Default preview-server E2E: 3/3 passed in 5.9 minutes.
- Dedicated SHA-256 Worker Chromium: 1/1 passed (5.7-second test).
- Dedicated archive Worker Chromium: 1/1 passed (9.3-second test). It processed exactly
  268,435,456 raw encode bytes in 67 chunks and an exact 314,572,800-byte valid virtual
  ZIP through 87 range reads. All twelve entries expanded sequentially, maximum active
  expansion was one, the RAF heartbeat advanced 484 frames, maximum Worker auxiliary
  payload was 56,626,176 bytes, central workspace was 16,777,216 bytes, and both raw
  source/compressed cap-plus-one cases rejected before mutation.
- The follow-up does not change the browser Worker session/streaming algorithm,
  harness routes, preview wiring, chunk sizes, or max-boundary algorithm; the default
  and dedicated Chromium evidence above is reused from base commit `47f34d4`. The
  changed client response state and legacy migration handoff are covered by the
  227-test focused matrix and both fresh full-suite modes.
- Independent review of follow-up commit `323578f` found one Important dependency
  capture TOCTOU and no other Critical, Important, or Minor issue. The current
  follow-up fixes that finding with the RED-to-GREEN coverage above.

## Scope boundary

- This task does not publish prepared sources into the Task 4 repository/runtime and
  does not expose a raw token consumer.
- The temporary V2 browser adapter is intentionally isolated to
  `project-store-browser.ts` and should be removed when Task 4 wires V3 decode results
  into stable repository publication.
- No PLC transfer, deployment, OPC UA live write, or unrelated UI behavior is included.
