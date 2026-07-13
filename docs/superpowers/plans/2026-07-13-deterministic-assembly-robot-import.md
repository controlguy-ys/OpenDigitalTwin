# Deterministic Assembly Robot Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Import one fixed six-axis Robot from one through seven unique STEP source assets by deterministically mapping operator-confirmed assembly parts to exactly `LINK00` through `LINK06`, localizing Zero Pose Geometry, and atomically replacing the active Robot without AI inference or partial state.

**Architecture:** A sequential Web Worker pipeline hashes and de-duplicates selected files, parses each unique source once, preserves deterministic assembly-node paths, and returns bounded part metadata plus Geometry. Pure mapping, fixed-Mechanics, and full-matrix localization modules build a complete staged Robot bundle. The frozen Project V3 contracts and atomic Project replacement API supplied by WS1 remain the only schema, migration, codec, and commit authority; this workstream integrates those contracts into Robot analysis, runtime restore, and operator UI.

**Tech Stack:** React 19, TypeScript 6, Three.js 0.185, React Three Fiber 9, Zustand 5, Dexie 4, `occt-import-js` 0.0.23, Web Workers, Vitest 4, Testing Library 16.

## Global Constraints

- **Prerequisite:** Complete and freeze WS1 Project V3 Foundation before starting this plan. WS1 alone owns `WorkcellProjectSnapshotV3`, V1/V2-to-V3 migration, archive layout/codec, the shared `sha256Hex()` implementation plus known-vector/fallback tests, source de-duplication rules, `ProjectCommitCoordinator.replace()`, and `ProjectRuntimeV3.prepare()/publish()/dispose()`.
- Execute against the landed WS6 Stage A Mode shell. Robot feature components own their behavior; final BUILD placement and cross-feature browser acceptance remain WS6 Stage B work.
- WS2 Task 4 is the first Wave 2 shared Project-runtime integration commit. WS3 Task 4 and WS4 Task 3 must rebase and land after it; WS2 must not absorb their Job or Primitive behavior.
- This plan consumes WS1 types and APIs. It does not change Project schema shape, schema version, migration ownership, or codec ownership.
- Product copy is exactly `Seven Robot Links mapped from one through seven STEP sources.` Do not describe the new flow as requiring seven STEP files.
- One active Robot, six revolute Joints (`J1` through `J6`), and seven serial Links (`LINK00` through `LINK06`) remain fixed.
- Source names may suggest mappings, but no name, assembly tree, Geometry, heuristic, model, or AI output may confirm Mechanics or commit Link ownership.
- Every Link assignment and every excluded part requires explicit operator acknowledgement before Review can pass.
- Accept one through seven **unique source assets**. If byte-identical files are selected more than once, retain the first selection, collapse later selections by SHA-256, and show one non-blocking `ROBOT_STEP_DUPLICATE_SOURCE_COLLAPSED` warning. Validate the 1-7 count after collapse.
- Accept `.step` and `.stp`; enforce 25 MiB per unique source and 100 MiB unique Robot source bytes total.
- Preserve the WS1 limits: 600,000 parsed Robot triangles total; 150,000 selected triangles per Link; 448 parsed meshes; 2,048 assembly nodes; depth 64; 448 part references; 224 parsed materials; 64 meshes and 32 materials per Link; 256 MiB Worker typed-array payload; 1,500,000 visible scene triangles; 256 MiB Project source bytes.
- Parse unique sources sequentially in one active Worker. A per-source watchdog expires at exactly 60,000 ms; Cancel terminates the Worker and changes visible UI state within 250 ms.
- Known meter, millimeter, and inch units are persisted explicitly; unknown units require operator selection and confirmation. Restore never re-guesses a unit.
- Internal Geometry units are metres; rotations use normalized `[x,y,z,w]` quaternions and full 4x4 matrices.
- The serial chain is `J1 LINK00->LINK01` through `J6 LINK05->LINK06`; Geometry never creates or infers Kinematics.
- A fused whole-Robot body is rejected as `ROBOT_STEP_FUSED_BODY`; the implementation never cuts or duplicates a mesh to manufacture Link ownership.
- Cancel or failure leaves Project DB, active runtime, selection, collision state, repositories, and current Robot unchanged. Staged resources are disposed exactly once.
- Preserve the seven-independent-file workflow and explicit one-Link Geometry replacement. One-Link replacement cannot accept a multi-Link assembly or bypass full-Robot validation.
- Do not commit the proprietary/full ABB CAD. CI may contain only compact generated or otherwise redistributable synthetic STEP fixtures. The real ABB file is opt-in local manual evidence only.
- No PLC, OPC UA write, Robot command, IK, dynamics, or safety-rated behavior is in scope.
- Preserve unrelated user changes; use failure-first tests and one focused commit per task.

---

### Task 1: Source Identity, De-duplication, Bounded Worker Analysis

**Files:**
- Modify test only: `src/lib/hash/sha256.test.ts`
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
- Consumes: frozen WS1 `sha256Hex()` from `src/lib/hash/sha256.ts`, `RobotStepSourceAssetV3`, `RobotAssemblyPartRefV3`, and Robot budget exports from `src/domain/project/project-v3.ts`.
- Produces: `RobotImportError`, `RobotImportDiagnostic`, `deduplicateRobotSourceInputs()`, `RobotSourceAnalysis`, `RobotPartOccurrence`, and `RobotAssemblyAnalysisClient.analyzeSources()/cancel()/dispose()`.

- [ ] **Step 1: Write failing pure tests** for assembly source identity through the frozen WS1 hash utility, `.step`/`.stp` validation, exact byte limits, and owned buffers. Extend `sha256.test.ts` only with an inline assembly-specific binary/STEP-header identity regression; retain WS1's known-vector and no-`crypto.subtle` fallback tests unchanged, and do not edit `sha256.ts`. Default tests must not reference the local ABB directory; redistributable parseable STEP fixtures are introduced only in Task 6.

```ts
it('uses the frozen WS1 digest as exact Robot source identity', async () => {
  const digest = await sha256Hex(SYNTHETIC_STEP_BYTES)
  const result = await deduplicateRobotSourceInputs([
    file('assembly.step', SYNTHETIC_STEP_BYTES),
  ])
  expect(result.uniqueSources[0]).toMatchObject({ sha256: digest })
})
```

- [ ] **Step 2: Write failing de-duplication/analyzer/client tests.** Prove two byte-identical selections collapse to the first file and emit exactly one warning; 1 and 7 unique assets pass; 0 and 8 fail after collapse. Prove deterministic child-ordinal `nodePath`, unnamed flat-mesh synthetic parts, distinct occurrence keys, budget boundaries, strictly sequential parsing, one parse per hash, Worker `error`/`messageerror`, 60,000 ms timeout, late-message rejection, and Cancel termination.

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
```

- [ ] **Step 3: Verify the frozen hash gate, then RED.** Run each command in order and stop at the first non-zero exit. The WS1 hash suite must PASS; the assembly suite must then fail only for missing WS2 modules/APIs.

```powershell
npm run test:run -- src/lib/hash/sha256.test.ts
npm run test:run -- src/features/robot/assembly/robot-source-analysis.test.ts src/features/robot/assembly/robot-assembly-worker-protocol.test.ts src/features/robot/assembly/RobotAssemblyAnalysisClient.test.ts
```

- [ ] **Step 4: Implement source identity and bounded sequential analysis.** Call the frozen WS1 `sha256Hex()` over exact input bytes and build source IDs from its digest; do not add another hashing implementation or fallback. Retain first-selection display metadata, normalize tree paths, calculate typed-array bytes before transfer, stable-sort parts, and report only real phases `hashing|parsing|analyzing|ready`. Start one 60,000 ms timer per source and close the Worker on every terminal path.

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

- [ ] **Step 1: Write failing mapping and Geometry tests** proving suggestions remain unconfirmed, all `LINK00` through `LINK06` are required, every Link owns at least one occurrence, every other occurrence is explicitly excluded, duplicate `(sourceAssetId,nodePath,meshIndex)` ownership fails, mixed coordinate modes within one Link fail, a single fused part returns `ROBOT_STEP_FUSED_BODY`, and subset conversion enforces per-Link budgets/disposal.

```ts
expect(() => validateConfirmedLinkMapping({
  assignments: suggestedAssignments({ confirmed: false }),
  excludedPartKeys: [],
})).toThrowError(expect.objectContaining({
  code: 'ROBOT_LINK_MAPPING_INCOMPLETE',
}))
```

- [ ] **Step 2: Verify RED** with `npm run test:run -- src/features/robot/assembly/robot-link-mapping.test.ts src/features/robot/assembly/robot-link-geometry.test.ts src/features/import/occt-to-three.test.ts src/features/robot/robot-step-import.test.ts`; expect missing APIs.
- [ ] **Step 3: Implement stable occurrence ownership and subset conversion.** Canonicalize occurrence keys from source ID, node path, and mesh index; clone arrays before transformation; stable-sort source references and Link outputs; calculate collision bounds from each selected Link subset only.

```ts
export interface ConfirmedRobotLinkMapping {
  readonly links: Readonly<Record<RobotLinkId, {
    readonly coordinateMode: 'assembly-zero-pose' | 'link-local'
    readonly sourceRefs: readonly RobotAssemblyPartRefV3[]
  }>>
  readonly excludedPartKeys: readonly string[]
}
```

- [ ] **Step 4: Preserve compatibility paths.** Route seven independent files through seven whole-source occurrences after explicit legacy mapping confirmation. Keep one-Link replacement on one source and reject an assembly/multiple sources there.
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
- Create: `src/features/robot/assembly/robot-geometry-localization.ts`
- Create: `src/features/robot/assembly/robot-geometry-localization.test.ts`
- Modify: `src/domain/robot/kinematics.ts`
- Modify: `src/domain/robot/kinematics.test.ts`
- Modify: `src/features/robot/robot-configuration-store.ts`
- Modify: `src/features/robot/robot-configuration-store.test.ts`

**Interfaces:**
- Consumes: frozen WS1 `FixedSixAxisRobotManifestV1`, `RobotMechanicsProvenanceV3`, `RobotLinkGeometryRecordV3`, and Task 2 mapped subsets.
- Produces: `validateFixedRobotMechanics()`, `localizeRobotLinkOccurrences()`, `validateZeroPoseReconstruction()`, and staged localized assets/collision Boxes.

- [ ] **Step 1: Write failing Mechanics/localization tests** for Robot name, Base XYZRPY, exact serial Link pairs, six ordered Joint IDs, every Joint origin/normalized axis/minimum/maximum/Home/direction/offset/maximum velocity field, all seven geometry-local transforms, Flange/TCP, stable provenance, nested rotation+translation, mixed normalized units, repeated occurrences, and tolerance failure immediately above `1e-6` matrix error or 0.5 mm AABB error.

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

- [ ] **Step 2: Verify RED** with `npm run test:run -- src/features/robot/assembly/fixed-robot-mechanics.test.ts src/features/robot/assembly/robot-geometry-localization.test.ts src/domain/robot/kinematics.test.ts src/features/robot/robot-configuration-store.test.ts`; expect missing functions.
- [ ] **Step 3: Implement field-specific validation and matrix composition.** For assembly coordinates calculate `OccurrenceInSource = NodeWorldFromPath * MeshLocal`, `OccurrenceRobotBaseZero = SourceRootToRobotBase * OccurrenceInSource`, and `OccurrenceLinkLocal = inverse(LinkZeroWorld) * OccurrenceRobotBaseZero`. Store operator adjustment separately; never use STEP names/tree as Mechanics provenance.
- [ ] **Step 4: Verify descendant semantics and GREEN.** For every `n=1..6`, rotate `Jn` and assert exactly `LINK0n` through `LINK06` move. Run focused tests, `npm run cad:validate`, and `npm run build`; expect PASS.
- [ ] **Step 5: Commit.** Run each command in order and stop at the first non-zero exit.

```powershell
git add src/features/robot/assembly/fixed-robot-mechanics.ts src/features/robot/assembly/fixed-robot-mechanics.test.ts src/features/robot/assembly/robot-geometry-localization.ts src/features/robot/assembly/robot-geometry-localization.test.ts src/domain/robot/kinematics.ts src/domain/robot/kinematics.test.ts src/features/robot/robot-configuration-store.ts src/features/robot/robot-configuration-store.test.ts
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
- Consumes: WS1 frozen `CurrentProjectSnapshot`, V3 Robot source/Link contracts, V1/V2-to-V3 decode output, `ProjectCommitCoordinator.replace()`, and `ProjectRuntimeV3.prepare()/publish()/dispose()`.
- Produces: `RobotReplacementService.replace()/cancel()`, V3 Robot asset restore, source-hash/path drift validation, and runtime/repository publication after successful Project commit.

- [ ] **Step 1: Write failing transaction/restore tests** injecting failure before source restore, during Link conversion, after runtime publication, and during WS1 replacement compensation. Assert the visible runtime, Project pointer, repositories, selection, and collision revision are entirely old or entirely new. Add restore tests proving one shared source parses once, stale node paths return `ROBOT_SOURCE_MAPPING_DRIFT`, unknown legacy units return `ROBOT_STEP_UNIT_REQUIRED`, and staged assets dispose exactly once.

```ts
await expect(service.replace(validDraft(), failingDependencies('runtime-commit')))
  .rejects.toMatchObject({ code: 'ROBOT_IMPORT_COMMIT_FAILED' })
expect(semanticWorkcellSnapshot()).toEqual(before)
expect(stagedAssets.every((asset) => asset.dispose.mock.calls.length === 1)).toBe(true)
```

- [ ] **Step 2: Verify RED** with `npm run test:run -- src/features/robot/assembly/robot-replacement-service.test.ts src/features/project/browser-project-runtime.test.ts src/features/robot/robot-geometry-store.test.ts`; expect missing V3 Robot restore/service behavior.
- [ ] **Step 3: Implement the service strictly on the WS1 boundary.** Capture a candidate snapshot, replace only the frozen V3 Robot payload and related frame/proxy values, and call `ProjectCommitCoordinator.replace(candidate)` exactly once. The frozen coordinator invokes `ProjectRuntimeV3.prepare(candidate, revisionId)` to stage every source/Link asset, publishes repositories only through `publish()` after durable commit, and cleans old or failed staged bundles only through `dispose()`. Do not edit schema validators, migration, codec, `project-commit-coordinator.ts`, or the frozen Robot contracts in this task.

```ts
export interface RobotReplacementService {
  replace(draft: RobotReplacementDraft): Promise<void>
  cancel(): void
}
```

- [ ] **Step 4: Verify V3 Save/reload/Export/Import integration GREEN.** Assert Robot name, Base XYZRPY, every field of all six Joint Mechanics records, all seven geometry-local transforms, source hashes, selected units, source-to-meter factors, node mappings, localization, adjustments, Mechanics provenance, Flange/TCP, and Boxes survive exactly, and a one-source Robot still has one WS1 archive source entry. Run Project/runtime/round-trip tests and `npm run build`.
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
- Modify: `src/features/robot/RobotImportDialog.tsx`
- Modify: `src/features/robot/RobotImportDialog.test.tsx`

**Interfaces:**
- Produces: stages `sources|parts|link-mapping|mechanics|zero-pose|frames-collision|review`, accessible mapping/exclusion controls, exact budget review, `commit()/cancel()`, and a controlled `RobotAssemblyWizard` surface for WS6 Stage B placement without editing App/AppShell composition.
- Consumes: Tasks 1-4 and the existing one-Link replacement mode.

- [ ] **Step 1: Write failing state/UI tests** for ordered stage guards, duplicate-collapse warning, unit confirmation, Parts tree/preview, suggestion-versus-confirmation, excluded-part acknowledgement, Mechanics source, per-Joint Zero Pose exercise, collision/frame review, stable error/recovery copy, keyboard focus, Cancel, and commit disabled until every invariant passes.

```tsx
await user.upload(screen.getByLabelText('Robot STEP sources'), oneAssemblyFile())
await screen.findByText('Suggested LINK00')
expect(screen.getByRole('button', { name: 'Review and commit Robot' })).toBeDisabled()
await user.click(screen.getByRole('checkbox', { name: 'Confirm LINK00 mapping' }))
```

- [ ] **Step 2: Verify RED** with `npm run test:run -- src/features/robot/assembly/robot-import-wizard-store.test.ts src/features/robot/assembly/RobotAssemblyWizard.test.tsx src/features/robot/RobotImportDialog.test.tsx`; expect missing wizard behavior.
- [ ] **Step 3: Implement a pure wizard state machine and split UI.** Persist no draft before commit; keep staged resources under an operation generation; show real phase labels without fabricated percentages; expose hashes, units, statistics, mappings, exclusions, and budgets; restore dialog focus and provide `aria-busy`, status, and alert semantics.

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

- [ ] **Step 4: Wire full and replacement modes.** New Robot uses the wizard; one-Link replacement remains Geometry-only. Cancel during analysis terminates the Worker immediately and returns UI busy state to false within 250 ms.
- [ ] **Step 5: Verify GREEN and commit.** Run focused tests and keyboard-only flows first, then run each command below in order and stop at the first non-zero exit. Stage only the listed files, inspect the staged diff, then commit.

```powershell
npm run lint
npm run build
git add src/features/robot/assembly/robot-import-wizard-store.ts src/features/robot/assembly/robot-import-wizard-store.test.ts src/features/robot/assembly/RobotAssemblyWizard.tsx src/features/robot/assembly/RobotAssemblyWizard.test.tsx src/features/robot/assembly/RobotAssemblyWizard.css src/features/robot/assembly/RobotAssemblyPreview.tsx src/features/robot/RobotImportDialog.tsx src/features/robot/RobotImportDialog.test.tsx
git diff --cached --check
git commit -m "feat: add confirmed robot assembly wizard"
```

---

### Task 6: Redistributable Fixtures, WS6 Browser Handoff, and Local ABB Evidence

**Files:**
- Create: `tests/fixtures/robots/fixed-six-axis-test-mechanics.json`
- Create: `tests/fixtures/robots/generated-seven-part-assembly.step`
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

- [ ] **Step 1: Write failing fixture/analyzer tests and the browser handoff.** The focused test must parse the generated one-source assembly into seven deterministic selectable parts, reject the fused-body fixture, exercise the seven-source regression, and assert fixture headers/provenance state that the STEP data is generated and redistributable. `docs/integration/robot-assembly-ws6-handoff.md` must specify the exact controlled Wizard props/commands and the later production-UI scenarios: one-source/seven-Link import, explicit confirmation, test Mechanics, commit, Joint descendants, Save/reload/Export/Import, one source entry, duplicate collapse, Cancel, fused-body failure, and seven-file regression.

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
npm run deploy:smoke
npm run deploy:smoke:opcua
git add tests/fixtures/robots src/features/robot/assembly/robot-assembly-fixtures.test.ts scripts/cad/verify-local-abb-assembly.ts docs/integration/robot-assembly-ws6-handoff.md docs/operator/robot-assembly-import.md docs/verification/robot-assembly-import-verification.md README.md docs/progress/2026-07-13-project-status.md package.json
git diff --cached --check
git commit -m "test: verify robot assembly fixtures and handoff"
```

---

## Quantitative Success Criteria

- Unique source count 1 and 7 passes; 0 and 8 fails after SHA-256 collapse. Re-selecting identical bytes yields one source asset and one warning, not a second parse or Project entry.
- Exact source, Robot-total, Geometry, node/depth, material, typed-array, and scene boundaries pass; each boundary plus one fails before staging.
- Every unique hash is parsed once per Import/restore operation; concurrent OCCT Worker count never exceeds one.
- One assembly source produces seven Link records and one WS1 source entry containing byte-identical source data.
- Zero Pose source-subset AABBs differ by at most 0.5 mm and 4x4 matrix elements by at most `1e-6`.
- Rotating `Jn` for every `n=1..6` moves exactly `LINK0n` through `LINK06` and no ancestor.
- Cancel leaves busy state within 250 ms; timeout occurs at exactly 60,000 ms under fake time.
- Fused, corrupt, unmapped, conflicting, invalid-Mechanics, unit-required, mapping-drift, and over-budget cases leave zero staged resources and no active Workcell mutation.
- Save, reload, Export, and Import preserve Robot name, Base XYZRPY, all six Joint origins/axes/minimum/maximum/Home/direction/offset/maximum velocities, all seven geometry-local transforms, WS1 hashes/paths/units/mappings, localization, adjustments, Mechanics provenance, Flange/TCP, and collision Boxes exactly.
- The legacy seven-file path preserves Zero Pose, TCP, Link bounds, and proxy bounds within the same tolerances.
- Default CI/test commands never read or require proprietary ABB CAD. The real ABB statistics are proven only by the explicit local verifier.

## Self-Review

- **Spec coverage:** Tasks 1-6 cover unique-source identity, duplicate collapse, bounded parsing, deterministic mapping, fixed Mechanics, localization, atomic replacement, frozen V3 runtime integration, compatibility, controlled UI, CI fixtures, local ABB evidence, feature verification, and the WS6 browser handoff.
- **WS1 ownership:** No task edits Project schema, migration, or codec. Task 4 consumes the frozen WS1 types and transaction.
- **SHA ownership:** WS1 owns `sha256.ts` and its known-vector/fallback behavior. Task 1 consumes that implementation and adds only an assembly-specific regression to the existing test file.
- **No-AI audit:** No interface permits AI-produced ownership or Mechanics; suggestions remain unconfirmed until operator action.
- **Fixture audit:** Only generated/redistributable fixture paths are staged. The real ABB file appears only as an explicit local input and is never a default test dependency.
- **Type consistency:** WS1 owns V3 types; this plan imports them unchanged. Feature-owned `RobotSourceAnalysis`, `ConfirmedRobotLinkMapping`, and `RobotReplacementService` have one definition each.
- **Placeholder scan:** Run `rg -n "T[B]D|T[O]DO|F[I]XME|f[i]ll in|impl[e]ment later|appropr[i]ate error handling|sim[i]lar to Task" docs/superpowers/plans/2026-07-13-deterministic-assembly-robot-import.md`; expect exit code 1.
- **Scope scan:** Run `git status --short -- docs/superpowers/plans/2026-07-13-deterministic-assembly-robot-import.md`; during planning it must list only this document as new/modified.
