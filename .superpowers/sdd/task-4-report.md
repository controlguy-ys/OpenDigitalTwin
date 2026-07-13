# Task 4 Report: Project Schema V2 and Collision Persistence

## Outcome

- Added immutable V1 schema literal `1` and current V2 schema literal `2`.
- Added `WorkcellProjectSnapshotV2`, `CurrentProjectSnapshot`, Compound Box,
  and collision-policy project contracts.
- Added atomic V1 validation and V1-to-V2 migration with owned geometry bytes,
  transforms, arrays, default Boxes, and the `0.02 m` migration policy.
- Added owned V2 normalization for Compound Boxes and collision policy, including
  quaternion normalization, per-Entity and project caps, unique Box IDs,
  canonical pair keys, and first-Box legacy mirrors.
- Updated Robot Geometry and Object Asset persistence to validate, clone, restore,
  and capture every Compound Box. Existing `setCollision` updates only the first
  Box bounds while retaining its ID, quaternion, and additional Boxes.
- Updated project stores, database records, coordinate-frame aliases, menu tests,
  browser runtime, import creation paths, and current snapshot consumers to V2.
- Added V1/V2 archive decoding, V2-only archive encoding, and
  `collision/policy.json`. Invalid V2 canonical data is rejected without legacy
  fallback or active-state mutation.
- Browser runtime captures and restores collision policy after geometry staging.

## TDD Evidence

### RED

1. `npm run test:run -- src/domain/project/project.test.ts src/domain/project/project-v1-migration.test.ts`
   - 2 files failed; 9 failed / 6 passed.
   - Expected failures: missing V1 literal, schema 2 unsupported, and missing
     migration module.
2. `npm run test:run -- src/features/robot/robot-geometry-store.test.ts src/features/objects/object-asset-store.test.ts src/features/project/project-store.test.ts`
   - 3 files failed; 7 failed / 5 passed.
   - Expected failures: shared Box tuples, `setCollision` not updating the first
     Box, invalid Box arrays accepted, and invalid import staged.
3. `npm run test:run -- src/features/project/project-codec.test.ts`
   - 1 file failed; 3 failed / 2 passed.
   - Expected failures: missing policy archive entry and missing V1 migration.
4. Legacy mirror regression:
   `npm run test:run -- src/features/robot/robot-geometry-store.test.ts src/features/objects/object-asset-store.test.ts`
   - 2 files failed; 2 failed / 10 passed.
   - Expected failure: stale legacy bounds were not repaired from the canonical
     first Box.

### GREEN

- Schema/migration: 2 files / 17 tests passed.
- Robot/Object stores: 2 files / 12 tests passed.
- Codec: 1 file / 5 tests passed.
- Task-focused domains/features: 21 files / 76 tests passed.

## Final Verification

- `npm run test:run`: 65 files / 362 tests passed.
- `npm run lint`: passed.
- `npm run build`: passed (`tsc -b` and Vite production build).
- `npm audit --audit-level=high`: 0 vulnerabilities.
- `npx playwright test tests/project-roundtrip.spec.ts`: 1 passed, including
  schema 2, seven non-empty Robot Box arrays, collision policy, and semantic
  export/import equality.
- `git diff --check`: passed.

## Notes

- No CAD, implementation-plan, or approved specification files were modified.
- Vite continues to report its existing large-chunk and OCCT browser
  externalization warnings; they do not fail the production build.

## Fix Review

### Findings Addressed

- Project hydration now validates and normalizes both stored V1 and V2 snapshots
  before activation. Invalid stored V2 remains untouched and produces the
  Project Store error state.
- Stored Project collision data is rewritten only when its persisted collision
  signature differs after migration or normalization. This covers schema
  migration, legacy first-Box mirrors, normalized quaternions, and canonical
  policy pair-key arrays.
- Robot Geometry and Object Asset hydration now recognizes only records where
  `collisionBoxes` is absent as legacy V1 rows. It creates one identity-rotation
  `default` Box, preserves bytes and visible placement data, validates the full
  record set, and atomically rewrites the IndexedDB table.
- A present but invalid V2 `collisionBoxes` property is never treated as legacy
  data and is never rewritten with fallback bounds.

### Review TDD Evidence

1. RED:
   `npm run test:run -- src/features/project/project-store.test.ts src/features/robot/robot-geometry-store.test.ts src/features/objects/object-asset-store.test.ts`
   - 3 files ran; 4 expected failures / 17 passed.
   - The failures proved invalid V2 Project activation, stale Project collision
     data, and Robot/Object V1 rows falling to memory-only mode.
2. GREEN: the same command passed 3 files / 21 tests.

### Review Final Verification

- `npm run test:run`: 65 files / 369 tests passed.
- `npm run lint`: passed with no warnings.
- `npm run build`: passed (`tsc -b` and Vite production build).
- `npm audit --audit-level=high`: 0 vulnerabilities.
- `npx playwright test tests/project-roundtrip.spec.ts`: 1 passed.
- `git diff --check`: passed.
