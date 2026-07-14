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
  existing Task 2 migration. The complete frozen migration dependency bundle is
  required and captured before the first await; unknown versions never downgrade.

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

- Post-fix focused archive/staging/store/menu matrix: 6 files, 114 tests passed.
- Worker protocol/security matrix: 1 file, 54 tests passed.
- V3 archive facade matrix: 1 file, 24 tests passed.
- Archive staging matrix: 1 file, 24 tests passed.
- Task 3 brief command: 7 files, 162 tests passed.
- Full parallel Vitest: 83 files, 698 tests passed in 72.52 seconds.
- Full serial Vitest (`npx vitest run --maxWorkers=1`): 83 files, 698 tests passed in
  194.32 seconds; no OOM recurrence after duplicate browser/test processes were
  removed.
- Strict TypeScript (`npx tsc -b --pretty false`): passed.
- Lint (`npm run lint`): passed with zero warnings.
- Production build (`npm run build`): passed.
- CAD asset validation: 7 link assets valid; 0 errors; 0 warnings.
- Production source scan: no `zipSync`, `unzipSync`, `localeCompare`,
  `File.arrayBuffer()`, or menu-side Blob materialization. The only production
  `.arrayBuffer()` is the bounded `Blob.slice(offset, end).arrayBuffer()` range read in
  the archive Worker client.
- Working-tree diff check: passed before staging.
- Default preview-server E2E: 3/3 passed in 5.9 minutes.
- Dedicated SHA-256 Worker Chromium: 1/1 passed (5.7-second test).
- Dedicated archive Worker Chromium: 1/1 passed (9.3-second test). It processed exactly
  268,435,456 raw encode bytes in 67 chunks and an exact 314,572,800-byte valid virtual
  ZIP through 87 range reads. All twelve entries expanded sequentially, maximum active
  expansion was one, the RAF heartbeat advanced 484 frames, maximum Worker auxiliary
  payload was 56,626,176 bytes, central workspace was 16,777,216 bytes, and both raw
  source/compressed cap-plus-one cases rejected before mutation.
- Independent post-fix review: no Critical, Important, or Minor findings; ready.

## Scope boundary

- This task does not publish prepared sources into the Task 4 repository/runtime and
  does not expose a raw token consumer.
- The temporary V2 browser adapter is intentionally isolated to
  `project-store-browser.ts` and should be removed when Task 4 wires V3 decode results
  into stable repository publication.
- No PLC transfer, deployment, OPC UA live write, or unrelated UI behavior is included.
