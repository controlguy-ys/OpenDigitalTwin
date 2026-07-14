# Deterministic Assembly Robot Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Import one fixed six-axis Robot from one through seven unique STEP source assets by deterministically mapping operator-confirmed assembly parts to exactly `LINK00` through `LINK06`, localizing Zero Pose Geometry, and atomically replacing the active Robot without AI inference or partial state.

**Architecture:** Reject an over-limit File selection before reading bytes, then use the WS1 source-staging service to own/hash each accepted File exactly once. Collapse duplicate digests, lease each retained prepared source buffer to one sequential parser Worker and receive the same buffer back, preserve deterministic assembly-node paths, and carry those prepared tokens through operator confirmation into the atomic Project mutation. Pure mapping, fixed-Mechanics, and full-matrix localization modules build a complete staged Robot bundle. The frozen Project V3 contracts and mutation service supplied by WS1 remain the only schema, migration, codec, and commit authority.

**Tech Stack:** React 19, TypeScript 6, Three.js 0.185, React Three Fiber 9, Zustand 5, Dexie 4, `occt-import-js` 0.0.23, Web Workers, Vitest 4, Testing Library 16.

## Global Constraints

- **Prerequisite:** Complete and freeze WS1 Project V3 Foundation before starting this plan. WS1 alone owns `WorkcellProjectSnapshotV3`, V1/V2-to-V3 migration, archive layout/codec, `ProjectHashService`, `ProjectSourceStagingService`, opaque `PreparedProjectSourceV1`, `ProjectMutationService`, source de-duplication rules, and `ProjectRuntimeV3.prepare()/publish()/dispose()`.
- Execute against the landed WS6 Stage A Mode shell. Robot feature components own their behavior; final BUILD placement and cross-feature browser acceptance remain WS6 Stage B work.
- WS2 Task 4 is the first Wave 2 shared Project-runtime integration commit. WS3 Task 4 and WS4 Task 3 must rebase and land after it; WS2 must not absorb their Job or Primitive behavior.
- This plan consumes WS1 types and APIs. It does not change Project schema shape, schema version, migration ownership, or codec ownership.
- Product copy is exactly `Seven Robot Links mapped from one through seven STEP sources.` Do not describe the new flow as requiring seven STEP files.
- One active Robot, six revolute Joints (`J1` through `J6`), and seven serial Links (`LINK00` through `LINK06`) remain fixed.
- Every new WS2 source has `id === sha256` using the exact lowercase 64-hex digest. Every analyzer/mapping `nodePath` contains only non-negative integer child ordinals. The reserved `[-1, linkOrdinal]` whole-source form is WS1 migration-only and WS2 never emits it.
- WS2 creates no random persisted Robot identity: source IDs are content digests and Link/occurrence/proxy IDs are deterministic derivations. If an implementation adds a transient import-operation correlation ID, it must consume WS1 `createPortableId()` and fail before staging when unavailable; direct `crypto.randomUUID()`/`Math.random()` calls are forbidden.
- Source names may suggest mappings, but no name, assembly tree, Geometry, heuristic, model, or AI output may confirm Mechanics or commit Link ownership.
- Every Link assignment and every excluded part requires explicit operator acknowledgement before Review can pass.
- Accept one through seven selected `File` objects at the UI/analyzer ingress and one through seven **unique persisted source assets** after digest collapse. Reject 0 or 8 selected Files before any `arrayBuffer()`, source copy, hash, or Worker allocation—even when all eight would be byte-identical. If accepted selections are byte-identical, retain the first prepared source, revoke later duplicate tokens, and show one non-blocking `ROBOT_STEP_DUPLICATE_SOURCE_COLLAPSED` warning.
- Digest-identical flat-file selections do not create semantic occurrence aliases after collapse. One canonical `(sourceAssetId, nodePath, meshIndex)` may belong to only one Link. To reuse identical Geometry for multiple Links, the operator must provide a self-contained STEP assembly whose repeated component instances have distinct assembly occurrence paths; attempting to assign one collapsed flat occurrence to multiple Links fails as `ROBOT_LINK_PART_CONFLICT` with that guidance. A future source-instance schema is explicitly outside this milestone.
- Accept `.step` and `.stp` extensions case-insensitively, including `.STEP` and `.STP`; reject every other suffix before reading. Before reading bytes, enforce 25 MiB per selected `File` and 100 MiB summed `File.size` across all selections. After collapse, re-enforce 100 MiB unique Robot source bytes total.
- Preserve the WS1 limits: 600,000 parsed Robot triangles total; 150,000 selected triangles per Link; 448 parsed meshes; 2,048 assembly nodes; depth 64; 448 part references; 224 parsed materials; 64 meshes and 32 materials per Link; 256 MiB Worker typed-array payload; 1,500,000 visible scene triangles; 256 MiB Project source bytes.
- Parse unique sources sequentially in one active Worker. A per-source watchdog expires at exactly 60,000 ms; Cancel terminates the Worker and changes visible UI state within 250 ms.
- Known meter, millimeter, and inch units are persisted explicitly; unknown units require operator selection and confirmation. Restore never re-guesses a unit.
- `MAX_MECHANICS_MANIFEST_BYTES = 1_048_576`. Check optional Manifest `File.size` before `arrayBuffer()`, hash, UTF-8 decode, or JSON parse; accept the exact boundary, reject plus one atomically, and never persist raw Manifest bytes.
- Manifest failures use the frozen codes `ROBOT_MECHANICS_MANIFEST_FILENAME_INVALID`, `ROBOT_MECHANICS_MANIFEST_TOO_LARGE`, `ROBOT_MECHANICS_MANIFEST_INVALID_UTF8`, `ROBOT_MECHANICS_MANIFEST_INVALID_JSON`, and `ROBOT_MECHANICS_MANIFEST_SCHEMA_INVALID`; derived duration/matrix/AABB overflow uses `ROBOT_MECHANICS_DERIVED_NON_FINITE`.
- The remaining frozen Robot Import error mapping is exact: invalid selected/unique source count is `ROBOT_STEP_SOURCE_COUNT`; invalid UTF-8 filename length or extension is `ROBOT_STEP_FILENAME_INVALID`; zero-byte input is `ROBOT_STEP_PARSE_FAILED` with `reason: 'empty-source'`; any byte/tree/Geometry/Link/Robot budget is `ROBOT_STEP_BUDGET_EXCEEDED`; Worker construction, `error`, `messageerror`, malformed reply, or unusable OCCT output is `ROBOT_STEP_PARSE_FAILED`; the 60,000 ms watchdog is `ROBOT_STEP_PARSE_TIMEOUT`; duplicate occurrence ownership or coordinate-mode conflict is `ROBOT_LINK_PART_CONFLICT`; and matrix/AABB reconstruction outside tolerance is `ROBOT_ZERO_POSE_MISMATCH`. UI and operator copy localize these codes but never replace them with free-form-only failures.
- Internal Geometry units are metres; rotations use normalized `[x,y,z,w]` quaternions and full 4x4 matrices.
- The serial chain is `J1 LINK00->LINK01` through `J6 LINK05->LINK06`; Geometry never creates or infers Kinematics.
- STEP assembly component/mesh count is never treated as Joint count. Seven Geometry components are the normal seven-Link/six-Joint case. A Manifest or Manual Mechanics payload declaring any count other than exactly six fails before staging as `ROBOT_JOINT_COUNT_UNSUPPORTED` with declared and required counts; a real seven-DOF Robot is outside this stage.
- A fused whole-Robot body is rejected as `ROBOT_STEP_FUSED_BODY`; the implementation never cuts or duplicates a mesh to manufacture Link ownership.
- Supported Robot Geometry is a self-contained AP203/AP214/AP242 STEP that the checked-in OCCT Worker exposes as finite, non-empty, separately selectable triangulatable occurrences. Unresolved external references fail as `ROBOT_STEP_EXTERNAL_REFERENCE_UNSUPPORTED`; tessellated/PMI-only or otherwise non-triangulatable sources fail as `ROBOT_STEP_UNSUPPORTED`. AP242 Joint/mate metadata, PMI, colors, and names never supply Mechanics.
- Cancel and every pre-publication failure leave Project DB, active runtime, selection, collision state, repositories, and current Robot unchanged, with staged resources disposed exactly once. A post-publication finalization or post-finalization token-consumption/handle-activation failure keeps the coherent new publishing/stable pointer plus new runtime locked in `recovery-required`; old-runtime disposal failure is a successful new commit with a bounded cleanup warning. No terminal path exposes a mixed revision.
- Preserve the seven-independent-file workflow and explicit one-Link Geometry replacement. One-Link replacement cannot accept a multi-Link assembly or bypass full-Robot validation.
- Preserve the repository's already tracked seven-Link ABB baseline and its production imports. Do not add the new proprietary/full one-source ABB assembly or any additional vendor CAD; new CI coverage uses compact generated/redistributable fixtures, and the one-source real ABB assembly remains opt-in local evidence only.
- No PLC, OPC UA write, Robot command, IK, dynamics, or safety-rated behavior is in scope.
- Preserve unrelated user changes; use failure-first tests and one focused commit per task.

---

### Task 1: Source Identity, De-duplication, Bounded Worker Analysis

**Files:**
- Create: `src/features/robot/assembly/robot-import-errors.ts`
- Create: `src/features/robot/assembly/robot-source-analysis.ts`
- Create: `src/features/robot/assembly/robot-source-analysis.test.ts`
- Create: `src/features/robot/assembly/robot-assembly-worker-protocol.ts`
- Create: `src/features/robot/assembly/robot-assembly-worker-protocol.test.ts`
- Create: `src/features/robot/assembly/robot-assembly-analysis.worker.ts`
- Create: `src/features/robot/assembly/RobotAssemblyAnalysisClient.ts`
- Create: `src/features/robot/assembly/RobotAssemblyAnalysisClient.test.ts`
- Modify: `src/lib/cad/occt-types.ts`
- Modify: `src/features/import/detect-step-unit.ts`
- Modify: `src/features/import/detect-step-unit.test.ts`

**Interfaces:**
- Consumes: frozen WS1 `ProjectSourceStagingService`, `PreparedProjectSourceV1`, `RobotStepSourceAssetV3`, `RobotAssemblyPartRefV3`, and Robot budget exports from `src/domain/project/project-v3.ts`.
- Produces: `RobotImportError` including stable `ROBOT_JOINT_COUNT_UNSUPPORTED` details `{ declaredJointCount, requiredJointCount: 6 }`, `RobotImportDiagnostic`, `preflightRobotSourceSelection()`, `deduplicatePreparedRobotSources()`, `RobotSourceAnalysis`, `RobotPartOccurrence`, and `RobotAssemblyAnalysisClient.analyzeSources()/cancel()/dispose()`.

- [ ] **Step 1: Write failing pure tests** for assembly source identity through the frozen WS1 staging service, case-insensitive `.step`/`.stp` validation (`.step`, `.stp`, `.STEP`, `.STP` pass; `.iges`, `.zip`, and missing suffix fail as `ROBOT_STEP_FILENAME_INVALID` before read), exact selected-file/byte limits, and single-copy owned buffers. Prove 1 and 7 selected Files pass preflight; 0 and 8 fail as `ROBOT_STEP_SOURCE_COUNT` before `arrayBuffer`, staging/hash, or Worker calls; eight duplicate Files still fail; a zero-byte `.step` fails as `ROBOT_STEP_PARSE_FAILED` with `reason: 'empty-source'` before staging/Worker; exact 25 MiB/file and 100 MiB selected-size sum pass while plus one fails as `ROBOT_STEP_BUDGET_EXCEEDED`. Use `TextEncoder` multibyte names to prove a STEP `File.name` at exactly 255 UTF-8 bytes passes and 256 rejects as `ROBOT_STEP_FILENAME_INVALID` before read/copy/hash/Worker allocation, with no truncation. Default tests may use the already tracked seven-Link production baseline but must not reference the new local one-file ABB assembly; redistributable one-file parseable fixtures are introduced in Task 6.

```ts
it('uses one frozen WS1 staged digest as exact Robot source identity', async () => {
  const result = await analyzeRobotSourceInputs([
    file('assembly.step', SYNTHETIC_STEP_BYTES),
  ], { sourceStaging, sourceDigestSpy })
  expect(result.uniqueSources[0]).toMatchObject({
    id: result.preparedSources[0].sha256,
    sha256: result.preparedSources[0].sha256,
  })
  expect(sourceDigestSpy).toHaveBeenCalledTimes(1)
})
```

- [ ] **Step 2: Write failing de-duplication/analyzer/client tests.** Prove two byte-identical accepted selections collapse to the first file, revoke the duplicate token, and emit exactly one warning; 1 and 7 unique assets pass after collapse. Prove deterministic non-negative integer child-ordinal `nodePath`, rejection of negative/fractional ordinals, unnamed flat-mesh synthetic parts, distinct occurrence keys, budget boundaries, strictly sequential parsing, one transfer-and-return parser lease per retained digest, no second hash/copy at confirmation or commit, Worker construction/`error`/`messageerror`/malformed reply all returning `ROBOT_STEP_PARSE_FAILED`, 60,000 ms returning `ROBOT_STEP_PARSE_TIMEOUT`, late-message rejection, and Cancel revocation/termination. Every budget fixture asserts `ROBOT_STEP_BUDGET_EXCEEDED` at the exact plus-one boundary; no test accepts an implementation-specific substitute code.

```ts
const result = await deduplicateRobotSourceInputs([
  file('first.step', SAME_BYTES),
  file('duplicate-name.stp', SAME_BYTES),
])
expect(result.uniqueSources.map((source) => source.sourceFileName)).toEqual(['first.step'])
expect(result.diagnostics).toEqual([
  expect.objectContaining({
    code: 'ROBOT_STEP_DUPLICATE_SOURCE_COLLAPSED',
    severity: 'warning',
  }),
])

expect(() => validateRobotPartOccurrence(partWithNodePath([-1, 0])))
  .toThrowError(expect.objectContaining({ code: 'ROBOT_SOURCE_MAPPING_DRIFT' }))
expect(() => validateRobotPartOccurrence(partWithNodePath([0, 1.5])))
  .toThrowError(expect.objectContaining({ code: 'ROBOT_SOURCE_MAPPING_DRIFT' }))
```

- [ ] **Step 3: Verify the frozen staging/hash gate, then RED.** Run each command in order and stop at the first non-zero exit. The WS1 hash/staging suites must PASS; the assembly suite must then fail only for missing WS2 modules/APIs.

```powershell
npm run test:run -- src/lib/hash src/features/project/project-source-staging.test.ts
npm run test:run -- src/features/robot/assembly/robot-source-analysis.test.ts src/features/robot/assembly/robot-assembly-worker-protocol.test.ts src/features/robot/assembly/RobotAssemblyAnalysisClient.test.ts
```

- [ ] **Step 4: Implement source identity and bounded sequential analysis.** Run count/`File.size` preflight before `arrayBuffer()`. Stage accepted files sequentially, set both source `id` and `sha256` from the prepared token digest, collapse duplicates while revoking the later token, and never call a second hash implementation. Lease the retained token's owned buffer to the parser Worker with a transfer list and require that exact buffer back before the token can commit; Worker failure/cancel revokes it. Retain first-selection display metadata, normalize every analyzer tree path to non-negative integer child ordinals, reject malformed ordinals, calculate typed-array bytes before transfer, stable-sort parts, and report only real phases `hashing|parsing|analyzing|ready`. Start one 60,000 ms timer per source and close the Worker on every terminal path.

```ts
export interface RobotPartOccurrence {
  readonly sourceAssetId: string
  readonly nodePath: readonly number[]
  readonly nodeName: string
  readonly meshIndices: readonly number[]
  readonly occurrenceMatrix: readonly [
    number, number, number, number,
    number, number, number, number,
    number, number, number, number,
    number, number, number, number,
  ]
}
```

- [ ] **Step 5: Verify GREEN and commit.** Run each command in order and stop at the first non-zero exit; expect all focused tests PASS and no open fake timers. Stage only the listed files, inspect the staged diff, then commit.

```powershell
npm run test:run -- src/lib/hash src/features/import/detect-step-unit.test.ts src/features/robot/assembly
npm run lint
npm run build
git diff --check
git add src/lib/hash/sha256.test.ts src/lib/cad/occt-types.ts src/features/import/detect-step-unit.ts src/features/import/detect-step-unit.test.ts src/features/robot/assembly
git diff --cached --check
git commit -m "feat: analyze unique robot step sources"
```

---

### Task 2: Operator-Confirmed Part Ownership and Link Geometry

**Files:**
- Create: `src/features/robot/assembly/robot-link-mapping.ts`
- Create: `src/features/robot/assembly/robot-link-mapping.test.ts`
- Create: `src/features/robot/assembly/robot-link-geometry.ts`
- Create: `src/features/robot/assembly/robot-link-geometry.test.ts`
- Modify: `src/features/import/occt-to-three.ts`
- Modify: `src/features/import/occt-to-three.test.ts`
- Modify: `src/features/robot/robot-step-import.ts`
- Modify: `src/features/robot/robot-step-import.test.ts`

**Interfaces:**
- Consumes: Task 1 analyses/results plus frozen WS1 `RobotAssemblyPartRefV3` and `RobotLinkGeometryRecordV3`.
- Produces: `RobotLinkMappingDraft`, `suggestLinkMappings()`, `validateConfirmedLinkMapping()`, `extractMappedLinkGeometry()`, and independently owned Link assets/source references.

- [ ] **Step 1: Write failing mapping and Geometry tests** proving suggestions remain unconfirmed, all `LINK00` through `LINK06` are required, every Link owns at least one occurrence, every other occurrence is explicitly excluded, duplicate `(sourceAssetId,nodePath,meshIndex)` ownership and mixed coordinate modes fail exactly as `ROBOT_LINK_PART_CONFLICT`, every new mapping path is non-negative and never begins with the reserved migration sentinel `-1`, a single fused part returns `ROBOT_STEP_FUSED_BODY`, and subset conversion enforces per-Link budgets/disposal. Select two byte-identical flat one-part Files, prove digest collapse leaves one semantic occurrence, then attempt two-Link assignment and assert `ROBOT_LINK_PART_CONFLICT` plus operator guidance to provide distinct self-contained assembly occurrence paths. Conversely, two repeated instances with distinct node paths inside one assembly may map to different Links while sharing one source Blob.

```ts
expect(() => validateConfirmedLinkMapping({
  assignments: suggestedAssignments({ confirmed: false }),
  excludedPartKeys: [],
})).toThrowError(expect.objectContaining({
  code: 'ROBOT_LINK_MAPPING_INCOMPLETE',
}))
```

- [ ] **Step 2: Verify RED** with `npm run test:run -- src/features/robot/assembly/robot-link-mapping.test.ts src/features/robot/assembly/robot-link-geometry.test.ts src/features/import/occt-to-three.test.ts src/features/robot/robot-step-import.test.ts`; expect missing APIs.
- [ ] **Step 3: Implement stable occurrence ownership and subset conversion.** Canonicalize occurrence keys from source ID, ordinary non-negative node path, and mesh index; clone arrays before transformation; stable-sort source references and Link outputs; calculate collision bounds from each selected Link subset only. New assembly mapping, seven-file compatibility mapping, and one-Link replacement must never produce the WS1-only reserved `[-1, linkOrdinal]` form.

```ts
export interface ConfirmedRobotLinkMapping {
  readonly links: Readonly<Record<RobotLinkId, {
    readonly coordinateMode: 'assembly-zero-pose' | 'link-local'
    readonly sourceRefs: readonly RobotAssemblyPartRefV3[]
  }>>
  readonly excludedPartKeys: readonly string[]
}
```

- [ ] **Step 4: Preserve compatibility paths.** Route seven independent non-identical files through seven ordinary whole-source occurrences using analyzer-produced non-negative parsed paths after explicit legacy mapping confirmation. Digest-identical flat files collapse and cannot stand in for distinct semantic occurrences; require distinct assembly paths as frozen above. Keep one-Link replacement on one source and reject an assembly/multiple sources there. The phrase `whole-source` describes selected mesh coverage, not the reserved WS1 migration path namespace.
- [ ] **Step 5: Verify GREEN and commit.** Run each command in order and stop at the first non-zero exit. Stage only the listed files, inspect the staged diff, then commit.

```powershell
npm run test:run -- src/features/robot/assembly src/features/import/occt-to-three.test.ts src/features/robot/robot-step-import.test.ts
npm run lint
npm run build
git add src/features/robot/assembly/robot-link-mapping.ts src/features/robot/assembly/robot-link-mapping.test.ts src/features/robot/assembly/robot-link-geometry.ts src/features/robot/assembly/robot-link-geometry.test.ts src/features/import/occt-to-three.ts src/features/import/occt-to-three.test.ts src/features/robot/robot-step-import.ts src/features/robot/robot-step-import.test.ts
git diff --cached --check
git commit -m "feat: map confirmed assembly parts to links"
```

---

### Task 3: Fixed Mechanics and Full-Matrix Zero Pose Localization

**Files:**
- Create: `src/features/robot/assembly/fixed-robot-mechanics.ts`
- Create: `src/features/robot/assembly/fixed-robot-mechanics.test.ts`
- Create: `src/features/robot/assembly/robot-mechanics-manifest.ts`
- Create: `src/features/robot/assembly/robot-mechanics-manifest.test.ts`
- Create: `src/features/robot/assembly/robot-geometry-localization.ts`
- Create: `src/features/robot/assembly/robot-geometry-localization.test.ts`
- Modify: `src/domain/robot/kinematics.ts`
- Modify: `src/domain/robot/kinematics.test.ts`
- Modify: `src/features/robot/robot-configuration-store.ts`
- Modify: `src/features/robot/robot-configuration-store.test.ts`

**Interfaces:**
- Consumes: frozen WS1 `ProjectRobotJointV3`, `FixedSixAxisRobotMechanicsV3`, `FixedSixAxisRobotManifestV1`, `RobotMechanicsProvenanceV3`, `RobotLinkGeometryRecordV3`, and Task 2 mapped subsets.
- Produces: `loadRobotMechanicsManifest()`, `createManualMechanicsProvenance()`, `validateFixedRobotMechanics()`, `localizeRobotLinkOccurrences()`, `validateZeroPoseReconstruction()`, and staged localized assets/collision Boxes. The configuration store may preview a draft but cannot durably publish Mechanics outside the Task 4 aggregate service.

- [ ] **Step 1: Write failing Manifest/Mechanics/localization tests** for Robot name, Base XYZRPY, exact serial Link pairs, six ordered Joint IDs, every Joint origin/normalized axis/command-space minimum/maximum/Home/direction/offset/maximum velocity field, strictly positive finite maximum velocity, all seven geometry-local transforms, separate Flange/Tool0/TCP, stable provenance, nested rotation+translation, mixed normalized units, repeated occurrences, and tolerance failure immediately above `1e-6` matrix error or 0.5 mm AABB error. Manifest `File.size` 1,048,576 passes and 1,048,577 rejects as `ROBOT_MECHANICS_MANIFEST_TOO_LARGE` before any `arrayBuffer()`, hash, decode, or parse spy. Hash the original accepted bytes exactly once through WS1 `ProjectHashService`; permit at most one leading UTF-8 BOM for decoding while retaining the original-byte digest; reject malformed UTF-8 with fatal decoding, malformed JSON, duplicate/unknown keys, wrong arrays/counts, non-finite values, and closed-schema violations with the frozen Manifest error codes. Prove cancel before completion releases owned bytes within 250 ms and a late Worker/hash completion cannot publish a result. Prove raw Manifest bytes never enter a Project snapshot/archive/Blob row, while filename plus lowercase digest and every TCP/frame field reach normalized provenance. Prove Manual Mechanics provenance hashes canonical normalized JSON once and is stable across property insertion order. Use exact unit-scale rigid fixtures for MCP/Flange/Tool0/TCP, then prove a non-unit scale in Manifest or Manual Mechanics fails as `ROBOT_MECHANICS_INVALID` before staging. Use a nontrivial Joint fixture with `direction: -1` and nonzero offset and prove `effectiveAngleDeg = direction * commandAngleDeg + zeroOffsetDeg` is identical in FK, TCP, rendering, playback, and collision; limits/Home/maximum velocity remain command-space values. The smallest positive finite test velocity passes only when every derived duration remains finite; a tiny positive velocity that overflows an existing moving Job duration rejects the whole candidate, while zero and negative values fail before staging. A one-STEP/seven-component fixture with six-Joint Mechanics passes; the same Geometry with a seven-Joint Manifest or Manual payload fails as `ROBOT_JOINT_COUNT_UNSUPPORTED`, reports `{ declaredJointCount: 7, requiredJointCount: 6 }`, and stages nothing.

Assert every matrix/AABB tolerance failure above the stated boundary maps exactly to `ROBOT_ZERO_POSE_MISMATCH`. Use a multibyte Manifest filename to prove exactly 255 UTF-8 bytes passes and 256 rejects as `ROBOT_MECHANICS_MANIFEST_FILENAME_INVALID` before `arrayBuffer()`, hash, decode, parse, or provenance work; no filename is truncated.

```ts
it('reconstructs source Zero Pose after Link localization', () => {
  const local = occurrenceLinkLocal(linkZeroWorld, sourceRoot, occurrence)
  expectMatrixClose(
    linkZeroWorld.clone().multiply(local),
    sourceRoot.clone().multiply(occurrence),
    1e-6,
  )
})
```

- [ ] **Step 2: Verify RED** with `npm run test:run -- src/features/robot/assembly/robot-mechanics-manifest.test.ts src/features/robot/assembly/fixed-robot-mechanics.test.ts src/features/robot/assembly/robot-geometry-localization.test.ts src/domain/robot/kinematics.test.ts src/features/robot/robot-configuration-store.test.ts`; expect missing functions.
- [ ] **Step 3: Implement the bounded Manifest owner, field validation, and matrix composition.** `loadRobotMechanicsManifest(file, signal)` checks `File.size` before reading, owns one copied buffer, uses WS1 `ProjectHashService` for exactly one original-byte digest, decodes with `TextDecoder('utf-8', { fatal: true })`, strips at most one leading BOM only from decoded text, parses JSON with duplicate-key detection, and closed-schema narrows to `FixedSixAxisRobotManifestV1`; any abort invalidates the operation generation so late work is inert. `createManualMechanicsProvenance()` canonicalizes the already normalized closed-schema Mechanics and hashes those canonical UTF-8 bytes through the same service. Neither path retains raw input bytes after normalization. Determine Joint count only from the Datasheet/Manifest/Manual Mechanics source, reject non-six counts with `ROBOT_JOINT_COUNT_UNSUPPORTED`, consume the frozen six-entry Mechanics tuple, reject non-finite or non-positive maximum velocity, and require every MCP/Flange/Tool0/TCP transform to use finite position/quaternion components plus exact scale `[1, 1, 1]`; a non-unit value is `ROBOT_MECHANICS_INVALID`, never a value to normalize away. Evaluate Joint transforms with `direction * commandAngleDeg + zeroOffsetDeg`, and keep limits/Home/maximum velocity in command space. For assembly coordinates calculate `OccurrenceInSource = NodeWorldFromPath * MeshLocal`, `OccurrenceRobotBaseZero = SourceRootToRobotBase * OccurrenceInSource`, and `OccurrenceLinkLocal = inverse(LinkZeroWorld) * OccurrenceRobotBaseZero`. Compose separate Link06-to-Flange, Flange-to-Tool0, and Tool0-to-TCP transforms. After every duration/matrix/AABB derivation, require all outputs finite; finite inputs that overflow composition fail as `ROBOT_MECHANICS_DERIVED_NON_FINITE` before mutation. Store operator adjustment separately; never use STEP names/tree or component count as Mechanics provenance.
- [ ] **Step 4: Verify descendant semantics and GREEN.** For every `n=1..6`, rotate `Jn` and assert exactly `LINK0n` through `LINK06` move. Run focused tests, `npm run cad:validate`, and `npm run build`; expect PASS.
- [ ] **Step 5: Commit.** Run each command in order and stop at the first non-zero exit.

```powershell
git add src/features/robot/assembly/robot-mechanics-manifest.ts src/features/robot/assembly/robot-mechanics-manifest.test.ts src/features/robot/assembly/fixed-robot-mechanics.ts src/features/robot/assembly/fixed-robot-mechanics.test.ts src/features/robot/assembly/robot-geometry-localization.ts src/features/robot/assembly/robot-geometry-localization.test.ts src/domain/robot/kinematics.ts src/domain/robot/kinematics.test.ts src/features/robot/robot-configuration-store.ts src/features/robot/robot-configuration-store.test.ts
git diff --cached --check
git commit -m "feat: localize robot assembly zero pose"
```

---

### Task 4: Atomic Replacement and Frozen V3 Runtime Restore Integration

**Files:**
- Create: `src/features/robot/assembly/robot-replacement-service.ts`
- Create: `src/features/robot/assembly/robot-replacement-service.test.ts`
- Modify: `src/features/project/browser-project-runtime.ts`
- Modify: `src/features/project/browser-project-runtime.test.ts`
- Modify: `src/features/robot/robot-geometry-repository.ts`
- Modify: `src/features/robot/robot-geometry-store.ts`
- Modify: `src/features/robot/robot-geometry-store.test.ts`
- Modify: `src/features/robot/default-robot-geometry.ts`
- Modify: `tests/project-roundtrip.spec.ts`

**Interfaces:**
- Consumes: WS1 frozen byte-free active projection, V3 Robot source/Link contracts, prepared source groups/tokens, V1/V2-to-V3 decode output, `reconcileSimulationForMechanicsChange()`, `ProjectMutationService.replaceFromActive()`, and `ProjectRuntimeV3.prepare()/publish()/dispose()`.
- Produces: `RobotReplacementService.replace()/replaceMechanics()/cancel()`, V3 Robot asset restore, atomic Robot-plus-Job duration reconciliation, source-hash/path drift validation, and runtime/repository publication after successful Project commit.

- [ ] **Step 1: Write failing transaction/restore tests** injecting failure before source restore, during Link conversion, during Mechanics/Job reconciliation, during runtime publication with successful compensation, after runtime publication during finalization or post-finalization token consumption/handle activation, and during old-runtime disposal. Assert every result follows the WS1 terminal matrix: pre-publication/recoverable publication failure leaves the complete old state; post-publication finalization or consumption/activation failure leaves the complete new pointer/runtime locked `recovery-required`; old-runtime disposal resolves successfully on the new revision with one cleanup warning. No case exposes a mixed visible runtime, Project pointer, repositories, selection, collision revision, Robot Mechanics, or Jobs. With existing moving Jobs, replace maximum velocity 180 with 90 and prove one byte-free recipe contains doubled canonical durations, increments each affected Job revision exactly once, retains unaffected Job identity/revision, invokes `ProjectMutationService.replaceFromActive()` once with zero source changes, publishes once, and exposes no mismatched intermediate state. Then narrow one proposed Joint limit around two saved Poses and assert `PROJECT_JOB_POSE_OUT_OF_LIMITS`, stable Job/Pose/Joint details, zero mutation-service calls, and byte-for-byte unchanged Robot/Mechanics/Jobs/revisions/runtime; no angle is clamped. For a new Robot source, prove digest count/copy count remain exactly one from selection through confirmation and commit. For a staged digest already active, prove the staged token is revoked after parsing and the recipe reuses the active source handle with zero Blob write. Full and one-Link replacement retain every still-referenced active source, remove only newly unreferenced source records, and revoke every unused/stale token. Add restore tests proving one shared source parses once, each exact WS1-migrated `[-1, linkOrdinal]` whole-source reference restores through the isolated legacy adapter, every other negative/fractional or stale node path returns `ROBOT_SOURCE_MAPPING_DRIFT`, unknown legacy units return `ROBOT_STEP_UNIT_REQUIRED`, and staged assets dispose exactly once.

```ts
await expect(service.replace(validDraft(), failingDependencies('runtime-commit')))
  .rejects.toMatchObject({ code: 'ROBOT_IMPORT_COMMIT_FAILED' })
expect(semanticWorkcellSnapshot()).toEqual(before)
expect(stagedAssets.every((asset) => asset.dispose.mock.calls.length === 1)).toBe(true)
```

- [ ] **Step 2: Verify RED** with `npm run test:run -- src/features/robot/assembly/robot-replacement-service.test.ts src/features/project/browser-project-runtime.test.ts src/features/robot/robot-geometry-store.test.ts`; expect missing V3 Robot restore/service behavior.
- [ ] **Step 3: Implement the service strictly on the WS1 boundary.** Build one byte-free active mutation recipe that replaces the frozen V3 Robot projection and related frame/proxy values, calls `reconcileSimulationForMechanicsChange(current.simulation, nextRobot.mechanics)`, and returns Robot plus reconciled Simulation together. Call `ProjectMutationService.replaceFromActive(recipe, preparedSourceGroups)` exactly once; each new Robot digest group has one `robot-source:<sha256>` owner. Reuse unchanged active owner keys and revoke staged tokens whose digest already resolves an active verified source. Reconciliation first rejects any saved Pose outside proposed inclusive command-space limits as `PROJECT_JOB_POSE_OUT_OF_LIMITS` with total plus at most 64 stable details; in that case revoke new tokens, do not call the mutation service, and do not clamp. `replaceMechanics()` uses the same recipe with an empty source-group list. The internal frozen coordinator invokes `ProjectRuntimeV3.prepare()` and publishes repositories only after durable commit. No feature imports `ProjectCommitCoordinator`, constructs handles/claims, or runs a post-commit repair. Do not edit schema validators, migration, codec, coordinator, or frozen Robot contracts in this task.

```ts
export interface RobotReplacementService {
  replace(draft: RobotReplacementDraft): Promise<void>
  replaceMechanics(mechanics: FixedSixAxisRobotMechanicsV3): Promise<void>
  cancel(): boolean // false after replaceFromActive has begun
}
```

- [ ] **Step 4: Verify V3 Save/reload/Export/Import integration GREEN.** Assert Robot name, Base XYZRPY, every field of all six Joint Mechanics records including command-space Home/direction/offset/strictly-positive maximum velocity, atomically reconciled Job durations/revisions, all seven geometry-local transforms, source `id === sha256`, selected units, source-to-meter factors, node mappings, localization, adjustments, Mechanics provenance, separate Flange/Tool0/TCP, and Boxes survive exactly, and a one-source Robot still has one WS1 archive source entry. Re-run the nontrivial direction/offset FK/TCP/render/playback/collision fixture after reload. Run Project/runtime/round-trip tests and `npm run build`.
- [ ] **Step 5: Commit.** Run each command in order and stop at the first non-zero exit.

```powershell
git add src/features/robot/assembly/robot-replacement-service.ts src/features/robot/assembly/robot-replacement-service.test.ts src/features/project/browser-project-runtime.ts src/features/project/browser-project-runtime.test.ts src/features/robot/robot-geometry-repository.ts src/features/robot/robot-geometry-store.ts src/features/robot/robot-geometry-store.test.ts src/features/robot/default-robot-geometry.ts tests/project-roundtrip.spec.ts
git diff --cached --check
git commit -m "feat: restore assembly robots through project v3"
```

---

### Task 5: Seven-Stage Operator-Confirmed Wizard

**Files:**
- Create: `src/features/robot/assembly/robot-import-wizard-store.ts`
- Create: `src/features/robot/assembly/robot-import-wizard-store.test.ts`
- Create: `src/features/robot/assembly/RobotAssemblyWizard.tsx`
- Create: `src/features/robot/assembly/RobotAssemblyWizard.test.tsx`
- Create: `src/features/robot/assembly/RobotAssemblyWizard.css`
- Create: `src/features/robot/assembly/RobotAssemblyPreview.tsx`
- Create: `src/features/robot/assembly/RobotMechanicsEditor.tsx`
- Create: `src/features/robot/assembly/RobotMechanicsEditor.test.tsx`
- Modify: `src/features/robot/RobotImportDialog.tsx`
- Modify: `src/features/robot/RobotImportDialog.test.tsx`

**Interfaces:**
- Produces: stages `sources|parts|link-mapping|mechanics|zero-pose|frames-collision|review`, an accessible complete Manual Mechanics editor, exact budget review, serialized async `commit()/cancel()`, and a controlled `RobotAssemblyWizard` surface for WS6 Stage B placement without editing App/AppShell composition.
- Consumes: Tasks 1-4 and the existing one-Link replacement mode.

- [ ] **Step 1: Write failing state/UI tests** for ordered stage guards, duplicate-collapse warning, unit confirmation, Parts tree/preview, suggestion-versus-confirmation, excluded-part acknowledgement, Manifest upload/errors and full Manual Mechanics editing: Robot name; Base XYZ/RPY; J1-J6 origin XYZ, normalized axis XYZ, command minimum/maximum/Home, direction, zero offset, and maximum velocity; seven geometry-local XYZ/RPY transforms; and separate Flange, Tool0, and TCP XYZ/RPY. Inputs display/edit linear engineering values in millimetres to three decimals and angular values in degrees to two decimals, while adapters create metre/quaternion domain values. An untouched rounded field must retain its original full-precision domain value; only a touched field is quantized from its submitted text. Cover per-field error association plus summary focus, Apply/Cancel draft isolation, `ROBOT_JOINT_COUNT_UNSUPPORTED` declared/required-count diagnostics, per-Joint Zero Pose exercise, collision/frame review, stable error/recovery copy, keyboard focus, and commit disabled until every invariant passes. Add a cancel-versus-commit barrier and double-submit test: Cancel is accepted and revokes tokens only before `ProjectMutationService.replaceFromActive()` begins; once it begins Cancel and Commit are disabled, the dialog remains pending until success/failure, and exactly one mutation can occur.

Use `TextEncoder` multibyte fixtures to prove Robot name accepts exactly 128 UTF-8 bytes and rejects 129 at submit with no truncation, while STEP/Manifest filename 256-byte failures occur before `arrayBuffer()` or staged work. Assert localized UI details retain the frozen Task 1-3 error codes rather than reducing them to free-form text.

```tsx
await user.upload(screen.getByLabelText('Robot STEP sources'), oneAssemblyFile())
await screen.findByText('Suggested LINK00')
expect(screen.getByRole('button', { name: 'Review and commit Robot' })).toBeDisabled()
await user.click(screen.getByRole('checkbox', { name: 'Confirm LINK00 mapping' }))
```

- [ ] **Step 2: Verify RED** with `npm run test:run -- src/features/robot/assembly/robot-import-wizard-store.test.ts src/features/robot/assembly/RobotAssemblyWizard.test.tsx src/features/robot/RobotImportDialog.test.tsx`; expect missing wizard behavior.
- [ ] **Step 3: Implement a pure wizard state machine, complete Mechanics editor, and split UI.** Persist no draft before commit; keep staged resources under an operation generation; show real phase labels without fabricated percentages; expose hashes, units, statistics, mappings, exclusions, and budgets; restore dialog focus and provide `aria-busy`, status, and alert semantics. `RobotMechanicsEditor` owns every frozen field above, separates display strings from full-precision domain draft values, performs explicit `mm / 1000` and `m * 1000` conversions, and emits only a closed normalized Mechanics draft. Apply validates atomically; Cancel discards the draft. The state machine has `editing | committing | failed | complete`: the point of no return is entry into the Task 4 mutation call, after which Cancel is ignored/disabled and duplicate submit returns the same pending Promise.

```ts
export type RobotImportWizardStage =
  | 'sources'
  | 'parts'
  | 'link-mapping'
  | 'mechanics'
  | 'zero-pose'
  | 'frames-collision'
  | 'review'
```

- [ ] **Step 4: Wire full and replacement modes.** New Robot uses the wizard; one-Link replacement remains Geometry-only. Cancel before the mutation boundary terminates analysis/hash work immediately, revokes every pending source token, and returns UI busy state to false within 250 ms. During the serialized mutation it is disabled/ignored so it cannot race a `publishing` pointer. Normal success closes with the new published bundle; a pre-publication failure keeps the prior bundle plus editable draft/error state; a post-publication recovery-required result keeps the dialog locked with reload/recovery guidance; old-runtime cleanup warning closes successfully on the new bundle.
- [ ] **Step 5: Verify GREEN and commit.** Run focused tests and keyboard-only flows first, then run each command below in order and stop at the first non-zero exit. Stage only the listed files, inspect the staged diff, then commit.

```powershell
npm run lint
npm run build
git add src/features/robot/assembly/robot-import-wizard-store.ts src/features/robot/assembly/robot-import-wizard-store.test.ts src/features/robot/assembly/RobotAssemblyWizard.tsx src/features/robot/assembly/RobotAssemblyWizard.test.tsx src/features/robot/assembly/RobotAssemblyWizard.css src/features/robot/assembly/RobotAssemblyPreview.tsx src/features/robot/assembly/RobotMechanicsEditor.tsx src/features/robot/assembly/RobotMechanicsEditor.test.tsx src/features/robot/RobotImportDialog.tsx src/features/robot/RobotImportDialog.test.tsx
git diff --cached --check
git commit -m "feat: add confirmed robot assembly wizard"
```

---

### Task 6: Redistributable Fixtures, WS6 Browser Handoff, and Local ABB Evidence

**Files:**
- Create: `tests/fixtures/robots/fixed-six-axis-test-mechanics.json`
- Create: `tests/fixtures/robots/generated-seven-part-assembly.step`
- Create: `tests/fixtures/robots/generated-seven-part-ap203.step`
- Create: `tests/fixtures/robots/generated-seven-part-ap214.step`
- Create: `tests/fixtures/robots/generated-seven-part-ap242.step`
- Create: `tests/fixtures/robots/generated-external-reference.step`
- Create: `tests/fixtures/robots/generated-unsupported-tessellated.step`
- Create: `tests/fixtures/robots/generated-fused-body.step`
- Create: `src/features/robot/assembly/robot-assembly-fixtures.test.ts`
- Create: `scripts/cad/verify-local-abb-assembly.ts`
- Create: `docs/integration/robot-assembly-ws6-handoff.md`
- Create: `docs/operator/robot-assembly-import.md`
- Create: `docs/verification/robot-assembly-import-verification.md`
- Modify: `README.md`
- Modify: `docs/progress/2026-07-13-project-status.md`
- Modify: `package.json`

**Interfaces:**
- Produces: compact generated CI fixtures with provenance, fixture-level analyzer/mapping evidence, an exact WS6 production-UI browser handoff, an explicitly opt-in local ABB verifier, operator guidance, and dated feature evidence.
- Consumes: all earlier Tasks. WS6 Stage B owns creation and execution of `tests/robot-assembly-import.spec.ts` after mounting the controlled Wizard.

- [ ] **Step 1: Write failing fixture/analyzer tests and the browser handoff.** The focused tests parse self-contained generated AP203/AP214/AP242-style one-source assemblies into seven deterministic selectable occurrences, pair them with six-Joint test Mechanics, and prove AP242 kinematic/PMI/name metadata is ignored as Mechanics. Reject the same Geometry paired with a seven-Joint Manifest as `ROBOT_JOINT_COUNT_UNSUPPORTED`, unresolved external references as `ROBOT_STEP_EXTERNAL_REFERENCE_UNSUPPORTED`, tessellated/PMI-only input as `ROBOT_STEP_UNSUPPORTED`, and the fused-body fixture as `ROBOT_STEP_FUSED_BODY`, all with zero mutation. Exercise the seven-source regression and assert fixture headers/provenance state that STEP data is generated and redistributable. `docs/integration/robot-assembly-ws6-handoff.md` must specify the exact controlled Wizard props/commands and the later production-UI scenarios: one-source/seven-Link/six-Joint import, seven-Joint Manifest rejection, explicit confirmation, test Mechanics, commit, Joint descendants, Save/reload/Export/Import, one source entry, duplicate collapse, Cancel, fused/external-reference/unsupported failures, and seven-file regression.

```ts
it('analyzes one generated assembly as seven deterministic Link candidates', async () => {
  const analysis = await analyzeFixture('tests/fixtures/robots/generated-seven-part-assembly.step')
  expect(analysis.parts).toHaveLength(7)
  expect(analysis.uniqueSourceCount).toBe(1)
})
```

- [ ] **Step 2: Verify RED** with `npm run test:run -- src/features/robot/assembly/robot-assembly-fixtures.test.ts`; expect missing generated fixtures and analyzer results.
- [ ] **Step 3: Add the opt-in local verifier and documentation.** Add package script `"verify:robot-assembly:local": "tsx scripts/cad/verify-local-abb-assembly.ts"`. The command `npm run verify:robot-assembly:local -- --file "<absolute-path-to-ABB-step>"` must fail clearly if the explicit file is missing, and must not be called by `test:run`, `verify`, or CI. With no `--file`, it prints `SKIP: local ABB assembly path was not supplied` and exits 0. Never copy or stage the local ABB file.

```ts
if (filePath === undefined) {
  console.log('SKIP: local ABB assembly path was not supplied')
  process.exitCode = 0
} else if (!existsSync(filePath)) {
  throw new Error(`Local ABB assembly not found: ${filePath}`)
}
```

- [ ] **Step 4: Record real local acceptance separately.** When the authorized local file is supplied, require exactly 13,093,130 bytes, SHA-256 `4130e05b6287fa47a49d376b6ab3cde3c98306155118d6f6e06751d1067b9ef1`, 38,299 triangles, nine assembly nodes, seven named Link meshes, and parser `occt-import-js 0.0.23`. Record results in the verification document; do not add the CAD path to Git.
- [ ] **Step 5: Run GREEN and commit.** Run each command in order and stop at the first non-zero exit; require exit 0 without retry or timeout waiver. Stage only generated fixtures/code/docs, inspect the staged diff, then commit.

```powershell
npm run lint
npm run test:run
npm run test:middleware
npm run cad:validate
npm run build
npm run deploy:validate
npm run deploy:build
npm run deploy:smoke
npm run deploy:smoke:opcua
git add tests/fixtures/robots src/features/robot/assembly/robot-assembly-fixtures.test.ts scripts/cad/verify-local-abb-assembly.ts docs/integration/robot-assembly-ws6-handoff.md docs/operator/robot-assembly-import.md docs/verification/robot-assembly-import-verification.md README.md docs/progress/2026-07-13-project-status.md package.json
git diff --cached --check
git commit -m "test: verify robot assembly fixtures and handoff"
```

---

## Quantitative Success Criteria

- Selected Robot File count 1 and 7 passes preflight; 0 and 8 fails synchronously as `ROBOT_STEP_SOURCE_COUNT` before `arrayBuffer()`, copy, hash, or Worker allocation, including eight duplicate Files. Within the accepted selection, unique persisted source count remains 1 through 7 after SHA-256 collapse. Every source has `id === sha256` equal to the exact lowercase 64-hex digest. Re-selecting identical bytes within the seven-File cap yields one source asset and one warning, not a second parse or Project entry. Identical collapsed flat occurrences cannot be aliased across Links: attempted reuse fails `ROBOT_LINK_PART_CONFLICT`, while repeated assembly instances with distinct node paths remain valid.
- Exact source, Robot-total, Geometry, node/depth, material, typed-array, and scene boundaries pass; each boundary plus one fails before staging.
- Every unique hash is parsed once per Import/restore operation; concurrent OCCT Worker count never exceeds one.
- One assembly source produces seven Link records and one WS1 source entry containing byte-identical source data. Every WS2-created path contains only non-negative integers and no WS2 output uses the reserved `[-1, linkOrdinal]` migration namespace; exact WS1-migrated reserved refs alone restore through the legacy adapter.
- Zero Pose source-subset AABBs differ by at most 0.5 mm and 4x4 matrix elements by at most `1e-6`.
- Rotating `Jn` for every `n=1..6` moves exactly `LINK0n` through `LINK06` and no ancestor.
- Cancel leaves busy state within 250 ms; timeout occurs at exactly 60,000 ms under fake time.
- Fused, corrupt, unmapped, conflicting, invalid-Mechanics, unit-required, mapping-drift, and over-budget cases leave zero staged resources and no active Workcell mutation. Exact code assertions cover `ROBOT_STEP_SOURCE_COUNT`, `ROBOT_STEP_FILENAME_INVALID`, `ROBOT_STEP_BUDGET_EXCEEDED`, `ROBOT_STEP_PARSE_FAILED` including `empty-source`, `ROBOT_STEP_PARSE_TIMEOUT`, `ROBOT_LINK_PART_CONFLICT`, `ROBOT_MECHANICS_MANIFEST_FILENAME_INVALID`, and `ROBOT_ZERO_POSE_MISMATCH` at their frozen boundaries.
- Save, reload, Export, and Import preserve Robot name, Base XYZRPY, all six Joint origins/axes/command-space minimum/maximum/Home/direction/offset/strictly-positive maximum velocities, all seven geometry-local transforms, WS1 hashes/paths/units/mappings, localization, adjustments, Mechanics provenance, separate rigid unit-scale Flange/Tool0/TCP, and collision Boxes exactly. A `direction: -1` plus nonzero offset fixture evaluates `direction * commandAngleDeg + zeroOffsetDeg` identically in FK, TCP, rendering, playback, and collision; zero/negative maximum velocity and non-unit MCP/Flange/Tool0/TCP scale never reach staging.
- Every Robot replacement or Mechanics edit with existing Jobs reconciles Robot Mechanics plus affected Job durations/revisions in one byte-free recipe, one `ProjectMutationService.replaceFromActive()` call, one durable commit, and one runtime publication. No post-commit subscription or intermediate stale-duration snapshot exists.
- A Robot replacement or Mechanics edit whose proposed limits exclude any stored Pose fails as `PROJECT_JOB_POSE_OUT_OF_LIMITS` before the mutation service, reports total plus at most 64 stable Job/Pose/Joint details, clamps nothing, and preserves Robot/Mechanics/Jobs/revisions/pointer/runtime exactly.
- One STEP with seven mappable Geometry components plus valid six-Joint Mechanics succeeds. A Manifest/Manual payload declaring seven Joints fails as `ROBOT_JOINT_COUNT_UNSUPPORTED` with declared/required counts, zero staged resources, and no active-state mutation; STEP component count never supplies DOF.
- An optional Mechanics Manifest at exactly 1,048,576 bytes passes pre-read validation; plus one fails before read/hash/decode/parse. STEP/Manifest filenames accept 255 UTF-8 bytes and reject 256 before reading, and Robot name accepts 128 bytes and rejects 129 without truncation. Accepted original bytes are hashed once, malformed UTF-8/JSON/closed-schema inputs fail with stable Manifest errors, canceled late work is inert, normalized filename/digest provenance survives round-trip, and raw Manifest bytes never persist. Manual canonical provenance is deterministic.
- Every Manual Mechanics field is independently editable through the declared mm/deg adapters; untouched rounded fields retain full stored precision. Apply is atomic, pre-commit Cancel revokes work within 250 ms, and Cancel/double-submit cannot race the serialized Project mutation after its point of no return.
- The legacy seven-file path preserves Zero Pose, TCP, Link bounds, and proxy bounds within the same tolerances.
- Default CI/test commands preserve the already tracked seven-Link ABB production baseline but never read or require the new proprietary one-file ABB assembly. Its one-file statistics are proven only by the explicit local verifier.

## Self-Review

- **Spec coverage:** Tasks 1-6 cover unique-source identity, duplicate collapse, bounded parsing, deterministic mapping, fixed Mechanics, localization, atomic replacement, frozen V3 runtime integration, compatibility, controlled UI, CI fixtures, local ABB evidence, feature verification, and the WS6 browser handoff.
- **WS1 ownership:** No task edits Project schema, migration, or codec. Task 4 consumes the frozen WS1 types and transaction.
- **SHA ownership:** WS1 owns `sha256.ts` and its known-vector/fallback behavior. Task 1 consumes that implementation and adds only an assembly-specific regression to the existing test file.
- **No-AI audit:** No interface permits AI-produced ownership or Mechanics; suggestions remain unconfirmed until operator action.
- **Fixture audit:** No additional vendor CAD is staged: the existing tracked seven-Link ABB baseline remains, newly added files are generated/redistributable, and the new one-file ABB assembly appears only as explicit local verifier input.
- **Type consistency:** WS1 owns V3 types; this plan imports them unchanged. Feature-owned `RobotSourceAnalysis`, `ConfirmedRobotLinkMapping`, and `RobotReplacementService` have one definition each.
- **Placeholder scan:** Run `rg -n "T[B]D|T[O]DO|F[I]XME|f[i]ll in|impl[e]ment later|appropr[i]ate error handling|sim[i]lar to Task" docs/superpowers/plans/2026-07-13-deterministic-assembly-robot-import.md`; expect exit code 1.
- **Scope scan:** Run `git status --short -- docs/superpowers/plans/2026-07-13-deterministic-assembly-robot-import.md`; during planning it must list only this document as new/modified.
