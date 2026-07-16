# Heterogeneous CRB15000 and MRb05 Release Demo Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce and prove the non-skippable Docker/browser release fixture containing one CRB15000, one operator-confirmed MRb05 single-Assembly Robot, Sample Jobs, explicit Pick/Place, and an actual OPC UA Server Read/Write flow.

**Architecture:** Treat the MRb05 STEP as a pinned external `asset://local-samples` dependency and verify its bytes/hierarchy before any semantic use. Require a human operator to create and explicitly approve the seven-Link/six-Joint Definition through the P3 Wizard; no script derives ownership or Mechanics. Generate one canonical heterogeneous V4 Project from that approved Definition, run Web plus the compiled TypeScript Runtime Gateway in Server mode, drive both the browser and a real `node-opcua` Client, and fail release completion on any skipped external fixture, missing Docker gate, performance miss, or absent in-app browser evidence.

**Tech Stack:** TypeScript 6.0.3, React 19.2.7, occt-import-js 0.0.23, node-opcua 2.175.0, Playwright 1.61.1, Vitest 4.1.10, Vite 8.1.4, Node 22.15.1, npm 11.4.2, Docker Compose, Codex in-app browser.

## Global Constraints

- P1 through P7 are landed prerequisites. P8 consumes public interfaces only and adds no new Project, Robot, Mapping, Command, Attachment, or interpolation semantics.
- The physical source is `${ROBOTSIM_ASSET_MOUNT_LOCAL_SAMPLES}/Savvy/MRb05_3D_20241011.STEP` and is referenced as `asset://local-samples/Savvy/MRb05_3D_20241011.STEP`.
- Require exactly 14,161,656 source bytes and SHA-256 `8bce1c031ec9301ce8e66d01c82560a7bb0c881e0455871b6d5f2c38afe567fa` before parsing.
- With `occt-import-js@0.0.23` and the checked-in `STEP_IMPORT_OPTIONS`, require 49 Meshes, 12 hierarchy Nodes, 10 selectable mesh-bearing component occurrences, 117,708 vertices, and 140,689 triangles.
- Require component evidence including `LINK0_ASSY`, `LOWER_LINK_ASSY`, `UPPER_LINK_ASSY_STANDARD`, and `END EFFECTOR ASSY-MRB_STANDARD`.
- Keep the STEP and every physical mount path outside Git, Project JSON, XML, XLSX, screenshots, and committed logs.
- Component names and motor-like parts are selection evidence only. Never infer seven-Link ownership, six-Joint order, Joint origins/axes, Base, Flange, Tool0, Tool, TCP, or Gripper Frames.
- P8 has a mandatory operator-confirmation stop. No fixture generator, test helper, AI/API call, script, or agent may set approval, copy unreviewed mappings, or continue after rejection.
- The approved MRb05 Definition uses seven rigid Links and six revolute Joints `J1..J6`. J1/J2 ranges are -360..360 degrees at 180 degrees/second; J3 is -158..158 degrees at 180 degrees/second; J4/J5/J6 are -360..360 degrees at 360 degrees/second. Origins, axes, order, Frames, and zero pose still require operator mechanical evidence.
- Persist the pinned source convention as Y-up normalized once to the Z-up Robot domain. Do not also apply an equivalent custom root rotation.
- Joint preview must prove that Jn moves only its configured child subtree. Included source Zero Pose Geometry must reconstruct within 0.5 mm; excluded hardware is outside this comparison.
- The release Project contains `Robot_A_CRB15000`, `Robot_B_MRb05`, `Cup_01`, `Pick_Table`, `Place_Table`, `Job_A_CRB_PickPlace`, `Job_B_MRb05_Inspection`, `Action_A_CloseGripper`, `Execute_Action_A_CloseGripper`, `Start_Robot_A_CRB_PickPlace`, and `Set_Robot_B_MRb05_J1`.
- OPC UA tests use a real `node-opcua` Client against the Gateway Server, one Session for each staged command, Boolean `false -> true` Trigger edges, a unique Command ID, and an expiry no more than 60 seconds in the future.
- Replaying an active identical Command ID returns the stored result and never executes again. Changed payload or expiry with the same active ID fails `COMMAND_ID_CONFLICT`.
- `test:release:mrb05` is a strict release command. A missing Asset, missing operator-confirmation artifact, skipped Playwright test, unavailable Docker Engine, unhealthy service, missing OPC UA assertion, or missing 15-minute performance run is a failure, not a skip or static substitute.
- Enforce at most 1.5M visible Scene triangles, browser p95 frame interval <=33.4 ms, heap <=768 MiB, Runtime Gateway allocation 1 CPU/512 MiB, Gateway processing latency p95 <=50 ms, interpolation delay 200 ms plus or minus one 100 ms publishing cycle, and 10,240 leaf-updates/second for at least 15 minutes. During the entire run, WebSocket depth remains at most one transmitting plus one newest pending Batch, each Browser interpolation buffer remains at most 32 samples, and neither surface retains growing historical state.
- Use readiness state, command result, Job state, or Attachment state polling. Do not use arbitrary sleeps as success evidence.
- Comments remain English. Preserve unrelated work and never stage `Savvy/`, backup CAD folders, raw Docker logs, or transient release artifacts.
- Every automated task ends with focused tests, lint/build, and one commit. The operator-confirmation task stops for explicit user approval before its commit.

---

## File Structure

**Create:**

- `scripts/release/mrb05-fixture-contract.ts` — immutable external Asset evidence.
- `scripts/release/verify-mrb05-asset.ts` — strict digest/STEP hierarchy preflight.
- `scripts/release/mrb05-operator-confirmation.ts` — closed approval-envelope validator.
- `scripts/release/build-heterogeneous-demo.ts` — canonical sample Project generator/checker.
- `scripts/release/run-mrb05-release.ts` — cross-platform Docker/test orchestration.
- `scripts/release/run-heterogeneous-performance.ts` — bounded 15-minute load and metric gate.
- Matching `*.test.ts` files for every release script.
- `tests/fixtures/release/mrb05-operator-browser-export.v1.json` — immutable byte-for-byte browser export created at the mandatory operator stop.
- `tests/fixtures/release/mrb05-operator-confirmation.v1.json` — separate approval envelope referencing the browser export by fixed relative name and SHA-256.
- `public/samples/heterogeneous-dual-robot-v4.json` — generated canonical Project with logical Assets only.
- `src/features/project/HeterogeneousDemoMenuItem.tsx` and test — production sample loader.
- `tests/release/opcua-release-client.ts` and test — browse-path based actual OPC UA assertions.
- `tests/heterogeneous-dual-robot-opcua.spec.ts` — complete browser/OPC UA acceptance.
- `tests/heterogeneous-performance.spec.ts` — browser metric capture under release load.
- `playwright.mrb05.config.ts` — Docker-targeted release configuration.
- `docs/operator/heterogeneous-demo.md` — exact setup and operation.
- `docs/verification/heterogeneous-release-verification.md` — sanitized evidence and counts.

**Modify:**

- `src/features/project/ProjectMenu.tsx` and test.
- `compose.yaml`, `deploy/nginx.conf`, and deployment validation/smoke tests.
- `package.json`, `package-lock.json`, `.gitignore`, `README.md`, and `docs/progress/2026-07-13-project-status.md`.

### Task 1: Pin and Verify the External MRb05 Asset

**Files:**
- Create: `scripts/release/mrb05-fixture-contract.ts`
- Test: `scripts/release/mrb05-fixture-contract.test.ts`
- Create: `scripts/release/verify-mrb05-asset.ts`
- Test: `scripts/release/verify-mrb05-asset.test.ts`
- Modify: `package.json`
- Modify: `package-lock.json`

**Interfaces:**
- Consumes: `STEP_IMPORT_OPTIONS`, `occt-import-js@0.0.23`, and `ROBOTSIM_ASSET_MOUNT_LOCAL_SAMPLES`.
- Produces: `MRB05_FIXTURE_CONTRACT`, `resolveMRb05FixturePath`, `verifyMRb05Asset`, and the strict `verify:mrb05:asset` command.

- [ ] **Step 1: Write RED contract and missing-environment tests**

```ts
it('pins the external source without a physical path', () => {
  expect(MRB05_FIXTURE_CONTRACT).toMatchObject({
    uri: 'asset://local-samples/Savvy/MRb05_3D_20241011.STEP',
    sourceBytes: 14_161_656,
    sha256: '8bce1c031ec9301ce8e66d01c82560a7bb0c881e0455871b6d5f2c38afe567fa',
    parserVersion: '0.0.23',
    meshes: 49,
    nodes: 12,
    selectableOccurrences: 10,
    vertices: 117_708,
    triangles: 140_689,
  })
  expect(JSON.stringify(MRB05_FIXTURE_CONTRACT)).not.toMatch(/[A-Z]:\\|\/srv\//)
})

it('fails instead of skipping when the mount is absent', async () => {
  await expect(verifyMRb05Asset({ environment: {}, parser })).rejects.toMatchObject({
    code: 'MRB05_ASSET_MOUNT_REQUIRED',
  })
})
```

Cover missing file, byte plus/minus one, digest mismatch, parser version mismatch, each Geometry count plus/minus one, missing required component evidence, parser failure, and non-zero CLI exit.

- [ ] **Step 2: Run RED**

```powershell
npm run test:run -- scripts/release/mrb05-fixture-contract.test.ts scripts/release/verify-mrb05-asset.test.ts
```

Expected: FAIL because the fixture contract and verifier do not exist.

- [ ] **Step 3: Implement the immutable contract and verifier**

```ts
export const MRB05_FIXTURE_CONTRACT = Object.freeze({
  uri: 'asset://local-samples/Savvy/MRb05_3D_20241011.STEP',
  relativePath: 'Savvy/MRb05_3D_20241011.STEP',
  sourceBytes: 14_161_656,
  sha256: '8bce1c031ec9301ce8e66d01c82560a7bb0c881e0455871b6d5f2c38afe567fa',
  parserVersion: '0.0.23',
  meshes: 49,
  nodes: 12,
  selectableOccurrences: 10,
  vertices: 117_708,
  triangles: 140_689,
  requiredNameFragments: Object.freeze([
    'LINK0_ASSY',
    'LOWER_LINK_ASSY',
    'UPPER_LINK_ASSY_STANDARD',
    'END EFFECTOR ASSY-MRB_STANDARD',
  ]),
})

export interface MRb05AssetVerification {
  readonly uri: typeof MRB05_FIXTURE_CONTRACT.uri
  readonly sha256: typeof MRB05_FIXTURE_CONTRACT.sha256
  readonly sourceBytes: number
  readonly meshes: number
  readonly nodes: number
  readonly selectableOccurrences: number
  readonly selectableOccurrenceKeys: readonly {
    readonly nodePath: readonly number[]
    readonly meshIndices: readonly number[]
  }[]
  readonly vertices: number
  readonly triangles: number
}

export async function verifyMRb05Asset(options: {
  readonly environment: Readonly<Record<string, string | undefined>>
  readonly parser?: MRb05StepParser
}): Promise<MRb05AssetVerification>
```

Resolve only `mountRoot + relativePath`, verify `realpath` remains inside the mount, stream SHA-256 before parsing, parse with the checked-in options, recursively count Nodes, count mesh-bearing children beneath the assembly root, and compare every pinned value exactly. Return the parser-derived selectable `(nodePath, meshIndices)` keys in canonical path order for the confirmation validator; these keys are structural identity, not inferred Link ownership. Print only the logical URI and counts.

- [ ] **Step 4: Add and run the strict preflight command**

```json
{
  "verify:mrb05:asset": "tsx scripts/release/verify-mrb05-asset.ts"
}
```

```powershell
$env:ROBOTSIM_ASSET_MOUNT_LOCAL_SAMPLES = (Get-Location).Path
npm run verify:mrb05:asset
```

Expected: exit 0 with the exact logical URI, digest, 49/12/10 hierarchy counts, 117,708 vertices, and 140,689 triangles. With the environment variable removed, expected exit is non-zero with `MRB05_ASSET_MOUNT_REQUIRED`.

- [ ] **Step 5: Run GREEN and commit**

```powershell
npm run test:run -- scripts/release/mrb05-fixture-contract.test.ts scripts/release/verify-mrb05-asset.test.ts
npm run lint
git add scripts/release/mrb05-fixture-contract* scripts/release/verify-mrb05-asset* package.json package-lock.json
git diff --cached --check
git commit -m "test: pin the external mrb05 asset"
```

### Task 2: Enforce the Operator-Confirmed MRb05 Definition Gate

**Files:**
- Create: `scripts/release/mrb05-operator-confirmation.ts`
- Test: `scripts/release/mrb05-operator-confirmation.test.ts`
- Create after explicit approval: `tests/fixtures/release/mrb05-operator-browser-export.v1.json`
- Create after explicit approval: `tests/fixtures/release/mrb05-operator-confirmation.v1.json`
- Modify: `package.json`
- Modify: `package-lock.json`

**Interfaces:**
- Consumes: Task 1 verified Asset, P3 Robot Assembly Wizard/export, P1 `RobotDefinitionV4`, and P2 Joint preview.
- Produces: `MRb05OperatorApprovalEnvelopeV1`, `MRb05OperatorConfirmationV1`, `validateMRb05OperatorConfirmation`, one immutable browser export, and its separate digest-bound approval envelope.

- [ ] **Step 1: Write RED closed-envelope and anti-inference tests**

```ts
it('rejects an unapproved or machine-produced envelope', () => {
  const exportBytes = validBrowserExportBytes()
  expect(() => validateMRb05OperatorConfirmation(
    pendingApprovalEnvelopeFor(exportBytes),
    exportBytes,
    selectableOccurrenceKeys(),
  )).toThrow('MRB05_OPERATOR_APPROVAL_REQUIRED')
})

it('requires all ten occurrence groups to be owned once or explicitly excluded', () => {
  const missing = browserExportWithMissingOccurrence(selectableOccurrenceKeys()[7])
  expect(() => validateMRb05OperatorConfirmation(
    approvedEnvelopeFor(missing),
    missing,
    selectableOccurrenceKeys(),
  ))
    .toThrow('MRB05_OCCURRENCE_DISPOSITION_INCOMPLETE')

  const duplicate = browserExportWithDuplicateOccurrence(selectableOccurrenceKeys()[4])
  expect(() => validateMRb05OperatorConfirmation(
    approvedEnvelopeFor(duplicate),
    duplicate,
    selectableOccurrenceKeys(),
  ))
    .toThrow('MRB05_OCCURRENCE_OWNER_CONFLICT')
})

it('binds approval to the immutable browser-export bytes', () => {
  const exportBytes = validBrowserExportBytes()
  expect(() => validateMRb05OperatorConfirmation(
    approvedEnvelopeFor(exportBytes),
    changeOneByte(exportBytes),
    selectableOccurrenceKeys(),
  )).toThrow('MRB05_DEFINITION_EXPORT_DIGEST_MISMATCH')
})
```

Reject unknown fields, changed URI/digest, not-exactly-seven Links, not-exactly-six `J1..J6` revolute Joints, wrong range/velocity evidence, non-Y-up convention, simultaneous custom root rotation, incomplete Zero Pose proof, ancestor motion, missing origin/axis/Frame evidence, and a Definition containing STEP bytes or physical paths.

- [ ] **Step 2: Run RED**

```powershell
npm run test:run -- scripts/release/mrb05-operator-confirmation.test.ts
```

Expected: FAIL because the confirmation validator does not exist.

- [ ] **Step 3: Implement the approval envelope validator**

```ts
export interface MRb05OperatorApprovalEnvelopeV1 {
  readonly schemaVersion: 1
  readonly decision: 'approved'
  readonly approvedAt: string
  readonly sourceUri: typeof MRB05_FIXTURE_CONTRACT.uri
  readonly sourceSha256: typeof MRB05_FIXTURE_CONTRACT.sha256
  readonly definitionExport: {
    readonly relativePath: 'mrb05-operator-browser-export.v1.json'
    readonly sha256: string
  }
}

export interface MRb05OperatorConfirmationV1 {
  readonly approval: MRb05OperatorApprovalEnvelopeV1
  readonly definition: RobotDefinitionV4
  readonly occurrenceDisposition: readonly (
    | {
        readonly nodePath: readonly number[]
        readonly meshIndices: readonly number[]
        readonly disposition: 'link'
        readonly linkId: string
      }
    | {
        readonly nodePath: readonly number[]
        readonly meshIndices: readonly number[]
        readonly disposition: 'excluded'
        readonly reason: string
      }
  )[]
  readonly evidence: readonly {
    readonly fieldPath: string
    readonly source: string
    readonly operatorConfirmed: true
  }[]
  readonly jointPreview: readonly {
    readonly jointId: 'J1' | 'J2' | 'J3' | 'J4' | 'J5' | 'J6'
    readonly movedLinkIds: readonly string[]
    readonly ancestorLinkIdsMoved: readonly []
  }[]
  readonly maximumZeroPoseErrorM: number
}

export function validateMRb05OperatorConfirmation(
  approvalEnvelope: unknown,
  definitionExportBytes: Uint8Array,
  selectableOccurrenceKeys: MRb05AssetVerification['selectableOccurrenceKeys'],
): MRb05OperatorConfirmationV1
```

Hash `definitionExportBytes` before parsing and require an exact match with the approval envelope reference. Reject a changed path, digest mismatch, or an envelope that embeds or overrides Definition semantics. Parse the immutable browser export, then normalize its occurrence union as one dense ten-entry array whose canonical `(nodePath, meshIndices)` keys exactly equal the ten selectable occurrence keys returned by Task 1's pinned parser evidence. Do not assume contiguous or name-derived paths. Require every link to own at least one included occurrence, evidence for every Joint origin/axis/order and Base/Flange/Tool0/TCP field, six descendant proofs, and `maximumZeroPoseErrorM <= 0.0005`. Deep-freeze the combined validated result. The CLI first calls `verifyMRb05Asset`, then loads both files and passes the exact occurrence key set into this validator. Tests must prove that changing one byte of the browser export fails `MRB05_DEFINITION_EXPORT_DIGEST_MISMATCH`.

- [ ] **Step 4: Perform the mandatory browser/operator stop**

Run the P3 browser with the verified mounted Asset, import `asset://local-samples/Savvy/MRb05_3D_20241011.STEP`, display all 10 occurrence groups/49 Meshes, and have the operator assign or exclude every group, enter all six Joint/Frame records from mechanical evidence, exercise J1-J6, and export the byte-free Definition plus evidence directly to `tests/fixtures/release/mrb05-operator-browser-export.v1.json`. Preserve those browser-produced bytes unchanged.

Before creating `tests/fixtures/release/mrb05-operator-confirmation.v1.json`, present the exact occurrence disposition, each Joint origin/axis/order/limit/velocity, Base/Flange/Tool0/TCP, Y-up decision, descendant proof, maximum Zero Pose error, and SHA-256 of the immutable browser export to the user. Stop and request explicit approval. If the user rejects or requests changes, return to the Wizard, create a new browser export, and repeat the review. Do not run Task 3 without an explicit approval response in the active task.

After approval, leave the browser export byte-for-byte unchanged. Create only the separate approval envelope with `decision: "approved"`, the actual approval timestamp, the fixed relative file name, and the browser export SHA-256, then run:

```powershell
npx tsx scripts/release/mrb05-operator-confirmation.ts tests/fixtures/release/mrb05-operator-confirmation.v1.json tests/fixtures/release/mrb05-operator-browser-export.v1.json
```

Expected: exit 0. The validator must fail if either file is absent or the digest differs; it never generates, repairs, or copies semantic fields and never writes approval.

- [ ] **Step 5: Run GREEN and commit the approved artifact**

```powershell
npm run test:run -- scripts/release/mrb05-operator-confirmation.test.ts
npx tsx scripts/release/mrb05-operator-confirmation.ts tests/fixtures/release/mrb05-operator-confirmation.v1.json tests/fixtures/release/mrb05-operator-browser-export.v1.json
npm run lint
git add scripts/release/mrb05-operator-confirmation* tests/fixtures/release/mrb05-operator-confirmation.v1.json tests/fixtures/release/mrb05-operator-browser-export.v1.json package.json package-lock.json
git diff --cached --check
git commit -m "test: record operator confirmed mrb05 definition"
```

Expected: the committed JSON contains no STEP bytes or physical path and matches the exact user-approved export.

### Task 3: Generate the Canonical Heterogeneous Demo Project

**Files:**
- Create: `scripts/release/build-heterogeneous-demo.ts`
- Test: `scripts/release/build-heterogeneous-demo.test.ts`
- Create: `public/samples/heterogeneous-dual-robot-v4.json`
- Create: `src/features/project/HeterogeneousDemoMenuItem.tsx`
- Test: `src/features/project/HeterogeneousDemoMenuItem.test.tsx`
- Modify: `src/features/project/ProjectMenu.tsx`
- Modify: `src/features/project/ProjectMenu.test.tsx`
- Modify: `README.md`

**Interfaces:**
- Consumes: Task 2 approved MRb05 Definition, P2 CRB15000 built-in Definition, P1 canonical JSON/Revision contracts, P6 ordinary decode-preview-apply path, and P7 Action contracts.
- Produces: `createHeterogeneousDemoProjectV4`, one checked-in canonical sample, and a Project Menu loader.

- [ ] **Step 1: Write RED fixture-content and determinism tests**

```ts
it('builds the exact heterogeneous Scene, Jobs, Actions, and mappings', () => {
  const project = createHeterogeneousDemoProjectV4(approvedMRb05())
  expect(project.robots.map(({ id }) => id)).toEqual([
    'Robot_A_CRB15000',
    'Robot_B_MRb05',
  ])
  expect(project.jobs.map(({ id }) => id)).toEqual([
    'Job_A_CRB_PickPlace',
    'Job_B_MRb05_Inspection',
  ])
  expect(project.assetReferences.find(({ id }) => id === 'asset-mrb05')?.uri)
    .toBe(MRB05_FIXTURE_CONTRACT.uri)
})

it('emits identical canonical bytes on two runs', () => {
  expect(buildBytes(approvedMRb05())).toEqual(buildBytes(approvedMRb05()))
})
```

Assert two different Definitions, independent Base poses and Joint state, `Cup_01` graspable, named Pick/Place Frames, Server mode, required Action/Mapping IDs, no synchronization barrier, no bytes/physical paths, and every Job value within its confirmed Joint limits.

- [ ] **Step 2: Run RED**

```powershell
npm run test:run -- scripts/release/build-heterogeneous-demo.test.ts src/features/project/HeterogeneousDemoMenuItem.test.tsx src/features/project/ProjectMenu.test.tsx
```

Expected: FAIL because the generator, fixture, and menu item do not exist.

- [ ] **Step 3: Implement the deterministic generator**

```ts
export function createHeterogeneousDemoProjectV4(
  confirmation: MRb05OperatorConfirmationV1,
): WorkcellProjectV4

export function buildHeterogeneousDemoBytes(
  confirmation: MRb05OperatorConfirmationV1,
): Uint8Array
```

Use stable IDs named in the Global Constraints. `Job_B_MRb05_Inspection` starts at confirmed Home, uses `[J1:10,J2:-10,J3:5,J4:10,J5:-10,J6:10]` degrees only after validating those values against the approved limits, applies different 20/60/30 percent segment speeds, and returns Home. `Job_A_CRB_PickPlace` closes, attaches `Cup_01`, transports, opens, and detaches to `Place_Table` through P7 Action references. Generate timestamps from fixed fixture metadata so canonical bytes do not vary by wall clock.

- [ ] **Step 4: Add the production sample loader**

```tsx
export function HeterogeneousDemoMenuItem(props: Readonly<{
  loadProject(source: Blob): Promise<void>
  fetchSample?: typeof fetch
}>): JSX.Element
```

Render one menu item named `Load Heterogeneous Dual Robot Demo`. Fetch `/samples/heterogeneous-dual-robot-v4.json`, pass it through the ordinary P6 decode/validation/atomic Apply path, and display `UNRESOLVED` if the external MRb Asset is unavailable. Do not bypass Project validation or directly hydrate stores.

- [ ] **Step 5: Generate, verify, run GREEN, and commit**

```powershell
npx tsx scripts/release/build-heterogeneous-demo.ts --write public/samples/heterogeneous-dual-robot-v4.json
npx tsx scripts/release/build-heterogeneous-demo.ts --check public/samples/heterogeneous-dual-robot-v4.json
npm run test:run -- scripts/release/build-heterogeneous-demo.test.ts src/features/project/HeterogeneousDemoMenuItem.test.tsx src/features/project/ProjectMenu.test.tsx
npm run lint
npm run build
git add scripts/release/build-heterogeneous-demo* public/samples/heterogeneous-dual-robot-v4.json src/features/project/HeterogeneousDemoMenuItem* src/features/project/ProjectMenu* README.md
git diff --cached --check
git commit -m "feat: add heterogeneous dual robot demo"
```

### Task 4: Add a Cross-Platform Docker Release Orchestrator

**Files:**
- Create: `scripts/release/run-mrb05-release.ts`
- Test: `scripts/release/run-mrb05-release.test.ts`
- Create: `playwright.mrb05.config.ts`
- Modify: `compose.yaml`
- Modify: `deploy/nginx.conf`
- Modify: `scripts/deployment/validate-deployment.mjs`
- Modify: `scripts/deployment/validate-deployment.test.ts`
- Modify: `scripts/deployment/smoke-deployment.mjs`
- Modify: `scripts/deployment/smoke-deployment.test.ts`
- Modify: `.gitignore`
- Modify: `package.json`
- Modify: `package-lock.json`

**Interfaces:**
- Consumes: Task 1 preflight, Task 3 sample, P4/P5 Gateway health/readiness/Server mode, and Docker Compose.
- Produces: `runMRb05Release`, `playwright.mrb05.config.ts`, strict Docker lifecycle, and local-only release artifacts.

- [ ] **Step 1: Write RED orchestration and no-skip tests**

```ts
it('fails before Docker when the external Asset or approval is missing', async () => {
  await expect(runMRb05Release({ environment: {}, commands })).rejects.toMatchObject({
    code: 'MRB05_RELEASE_PREREQUISITE_FAILED',
  })
  expect(commands.dockerComposeUp).not.toHaveBeenCalled()
})

it('fails a nominal Playwright exit when any release test is skipped', async () => {
  commands.playwright.mockResolvedValue({ exitCode: 0, passed: 4, failed: 0, skipped: 1 })
  await expect(runMRb05Release(validOptions())).rejects.toMatchObject({
    code: 'MRB05_RELEASE_TEST_SKIPPED',
  })
})
```

Cover Docker unavailable, build/up failure, `/healthz` timeout, expected pre-Apply `/readyz` `NO_ACTIVE_REVISION`, post-Apply ready timeout, OPC UA port unavailable, Playwright failure, performance failure, cleanup after every terminal path, and raw log/artifact paths remaining ignored.

- [ ] **Step 2: Run RED**

```powershell
npm run test:run -- scripts/release/run-mrb05-release.test.ts scripts/deployment/validate-deployment.test.ts scripts/deployment/smoke-deployment.test.ts
```

Expected: FAIL because the release runner/configuration is missing.

- [ ] **Step 3: Implement the process and result contracts**

```ts
export interface MRb05ReleaseCommands {
  verifyAsset(): Promise<void>
  verifyConfirmation(): Promise<void>
  verifySample(): Promise<void>
  dockerInfo(): Promise<void>
  dockerComposeUp(): Promise<void>
  waitForHealth(): Promise<void>
  runPlaywright(): Promise<{ exitCode: number; passed: number; failed: number; skipped: number }>
  runPerformance(): Promise<ReleasePerformanceResultV1>
  collectDiagnostics(): Promise<void>
  dockerComposeDown(): Promise<void>
}

export async function runMRb05Release(options: {
  readonly environment: NodeJS.ProcessEnv
  readonly commands?: MRb05ReleaseCommands
}): Promise<void>
```

Use `spawn` with argument arrays and one shell end-to-end; do not concatenate paths into a command string. Sequence preflight -> confirmation -> sample check -> Docker info -> `docker compose up -d --build` -> health -> Playwright -> performance. P5 has already removed the legacy optional `opcua` profile, so the runner must use the standard Web + Runtime Gateway graph. Always run diagnostics and Compose down in `finally`. Store outputs below `.artifacts/mrb05-release/<run-id>` and ignore that directory.

- [ ] **Step 4: Configure the release deployment**

Expose the Gateway OPC UA Server at `${ROBOTSIM_OPCUA_PORT:-4840}:4840`, mount the host local-samples root read-only at `/srv/robotsim/assets/local-samples`, keep managed Assets separate, and retain 1 CPU/512 MiB on the Gateway. Do not add a deployment mode field or environment variable: the canonical heterogeneous Project alone sets `opcUa.mode` to `server`. `playwright.mrb05.config.ts` targets `http://127.0.0.1:${WEB_PORT:-8080}`, uses one worker, a 20-minute test timeout, retained failure traces, and no development `webServer` because Docker owns the process.

Add scripts:

```json
{
  "test:release:mrb05": "tsx scripts/release/run-mrb05-release.ts",
  "test:e2e:mrb05": "playwright test -c playwright.mrb05.config.ts"
}
```

- [ ] **Step 5: Run GREEN and commit**

```powershell
npm run test:run -- scripts/release/run-mrb05-release.test.ts scripts/deployment/validate-deployment.test.ts scripts/deployment/smoke-deployment.test.ts
npm run lint
npm run build:gateway
npm run deploy:validate
git add scripts/release/run-mrb05-release* playwright.mrb05.config.ts compose.yaml deploy/nginx.conf scripts/deployment/validate-deployment* scripts/deployment/smoke-deployment* .gitignore package.json package-lock.json
git diff --cached --check
git commit -m "test: orchestrate the mrb05 docker release"
```

### Task 5: Prove the Actual OPC UA and Browser Acceptance Flow

**Files:**
- Create: `tests/release/opcua-release-client.ts`
- Test: `tests/release/opcua-release-client.test.ts`
- Create: `tests/heterogeneous-dual-robot-opcua.spec.ts`
- Modify: `playwright.mrb05.config.ts`

**Interfaces:**
- Consumes: Task 3 demo, Task 4 Docker stack, P5 Server namespace/Command staging, P7 Action Executor, and the P2 browser diagnostics.
- Produces: `OpcUaReleaseClient`, browse-path resolved Node handles, and the complete automated 20-step release acceptance.

- [ ] **Step 1: Write RED browse, Session-staging, and dedup helper tests**

```ts
it('resolves dynamic Robot and Joint nodes by BrowseName rather than fixed NodeId', async () => {
  const handles = await client.resolveDemoNodes('demo-project')
  expect(handles.actualJoint('Robot_A_CRB15000', 'J1')).toBeDefined()
  expect(handles.actualJoint('Robot_B_MRb05', 'J1')).toBeDefined()
})

it('stages Value, ID, expiry, and false-to-true Trigger in one Session', async () => {
  const result = await client.executeMapping({
    mappingId: 'Set_Robot_B_MRb05_J1',
    commandId: 'release-mrb-j1-001',
    expiresAt: now + 60_000,
    value: 10,
  })
  expect(result).toMatchObject({ acknowledgement: 'ACCEPTED', state: 'SUCCEEDED' })
  expect(writes.map(({ field }) => field)).toEqual([
    'Value', 'CommandId', 'ExpiresAt', 'Trigger=false', 'Trigger=true',
  ])
})
```

Test incomplete staging, cross-Session isolation, `NO_ACTIVE_PUBLISHER`, changed-payload conflict, identical replay, Action versus Mapping paths, result polling, Session close, and OPC UA status-code failures.

- [ ] **Step 2: Run RED**

```powershell
npm run test:run -- tests/release/opcua-release-client.test.ts
```

Expected: FAIL because the release Client does not exist.

- [ ] **Step 3: Implement the actual Client contract**

```ts
export interface OpcUaReleaseClient {
  connect(endpointUrl: string): Promise<void>
  resolveDemoNodes(projectId: string): Promise<DemoOpcUaNodeHandlesV1>
  readActualJoint(robotId: string, jointId: string): Promise<number>
  executeMapping(request: ReleaseMappingCommandV1): Promise<ReleaseCommandResultV1>
  executeAction(request: ReleaseActionCommandV1): Promise<ReleaseCommandResultV1>
  readAttachment(objectId: string): Promise<ReleaseAttachmentStateV1>
  close(): Promise<void>
}
```

Use `OPCUAClient.create` with SecurityPolicy None/anonymous only for this approved short-term release. Translate Browse paths below `Objects/WebDigitalTwin/Projects/<projectId>`; do not depend on implementation-specific numeric NodeIds. Poll at 25 ms with a bounded command timeout and return stable results.

- [ ] **Step 4: Implement the 20-step Playwright acceptance with `test.step`**

The test must perform these ordered assertions without arbitrary sleeps:

1. Verify `/healthz` and pre-Apply `/readyz` `NO_ACTIVE_REVISION`.
2. Open the production Web UI.
3. Load `Heterogeneous Dual Robot Demo` through Project Menu.
4. Resolve the MRb05 Asset and acquire the Runtime Publisher Lease.
5. Wait for `/readyz` to identify the applied Revision.
6. Assert CRB15000 and MRb05 are visible, different Definitions, and independently selectable.
7. Assert each Robot exposes its own Joint IDs, Mechanics, Jobs, and controls.
8. Read both Robots' Actual J1 through the real OPC UA Client.
9. Stage and execute `Set_Robot_B_MRb05_J1` with a new ID and valid expiry.
10. Assert only the intended MRb05 child subtree moves, source remains Simulation, and Home restores it.
11. Invoke `Action_A_CloseGripper` from UI and restore Open.
12. Invoke `Execute_Action_A_CloseGripper` through OPC UA and assert `ACCEPTED`, `RUNNING`, `SUCCEEDED`; restore Open.
13. Start `Job_B_MRb05_Inspection` and wait for `RUNNING`.
14. While MRb05 runs, trigger `Start_Robot_A_CRB_PickPlace` through OPC UA.
15. Assert CRB Attach discontinuity <=0.5 mm and <=0.1 degree.
16. Assert `Cup_01` follows the Tool and detaches at `Place_Table` while MRb state remains independent.
17. Assert Pick/Place remains `RUNNING` until Job end, then `SUCCEEDED`.
18. Replay the identical Mapping and both Action IDs with fresh Trigger edges; assert stored results and zero re-execution.
19. Save/reload and verify Definitions, logical Asset/digest/mapping, Jobs, Action/Mapping, and independent Joint state.
20. Reset and verify Robots, Object parent/pose, Grippers, Jobs, Attachments, and Action results return to reset state.

Use browser diagnostics only as assertions alongside visible controls; do not mutate hidden stores from the test.

- [ ] **Step 5: Run focused GREEN and commit**

```powershell
npm run test:run -- tests/release/opcua-release-client.test.ts
$env:ROBOTSIM_ASSET_MOUNT_LOCAL_SAMPLES = (Get-Location).Path
npm run verify:mrb05:asset
npm run test:e2e:mrb05 -- tests/heterogeneous-dual-robot-opcua.spec.ts
npm run lint
git add tests/release/opcua-release-client* tests/heterogeneous-dual-robot-opcua.spec.ts playwright.mrb05.config.ts
git diff --cached --check
git commit -m "test: prove heterogeneous opc ua browser flow"
```

Expected: no Playwright test is skipped and every real OPC UA/browser assertion passes.

### Task 6: Run the Fifteen-Minute Integrated Performance Gate

**Files:**
- Create: `scripts/release/run-heterogeneous-performance.ts`
- Test: `scripts/release/run-heterogeneous-performance.test.ts`
- Create: `tests/heterogeneous-performance.spec.ts`
- Modify: `scripts/release/run-mrb05-release.ts`
- Modify: `scripts/release/run-mrb05-release.test.ts`
- Modify: `playwright.mrb05.config.ts`

**Interfaces:**
- Consumes: P4 maximum Subscription/state driver, P5 Gateway diagnostics, the Task 3 Scene, and Task 4 runner.
- Produces: `ReleasePerformanceResultV1` and a strict integrated resource/latency decision.

- [ ] **Step 1: Write RED exact-boundary and duration tests**

```ts
it('rejects a run shorter than fifteen minutes even when samples pass', () => {
  expect(() => assertReleasePerformance({
    durationMs: 899_999,
    visibleTriangleCount: 1_500_000,
    browserFrameIntervalsMs: [16.7],
    browserHeapBytes: [200 * MIB],
    gatewayLatencyMs: [10],
    interpolationDelayMs: [200],
    webSocketPendingBatchDepth: [2],
    browserInterpolationBufferDepth: [32],
    webSocketHistoricalGrowthDetected: false,
    browserBufferHistoricalGrowthDetected: false,
    leafUpdatesPerSecond: 10_240,
    gatewayRestartCount: 0,
  })).toThrow('PERFORMANCE_DURATION_INSUFFICIENT')
})

it('accepts every exact release boundary', () => {
  expect(() => assertReleasePerformance({
    durationMs: 900_000,
    visibleTriangleCount: 1_500_000,
    browserFrameIntervalsMs: percentileFixture(33.4),
    browserHeapBytes: [768 * MIB],
    gatewayLatencyMs: percentileFixture(50),
    interpolationDelayMs: percentileFixture(200),
    webSocketPendingBatchDepth: [2],
    browserInterpolationBufferDepth: [32],
    webSocketHistoricalGrowthDetected: false,
    browserBufferHistoricalGrowthDetected: false,
    leafUpdatesPerSecond: 10_240,
    gatewayRestartCount: 0,
  })).not.toThrow()
})
```

Add plus-one tests for visible triangles, frame p95, heap, Gateway p95, WebSocket depth 3, Browser buffer depth 33, interpolation p95 outside 100-300 ms, either historical-growth flag becoming true, and update rate below 10,240. Assert missing `performance.memory`, missing queue/buffer/interpolation diagnostics, dropped measurement windows, process restart, or Docker OOM is a failure.

- [ ] **Step 2: Run RED**

```powershell
npm run test:run -- scripts/release/run-heterogeneous-performance.test.ts scripts/release/run-mrb05-release.test.ts
```

Expected: FAIL because the performance gate is missing.

- [ ] **Step 3: Implement exact metric calculation and orchestration**

```ts
export interface ReleasePerformanceSamplesV1 {
  readonly durationMs: number
  readonly visibleTriangleCount: number
  readonly browserFrameIntervalsMs: readonly number[]
  readonly browserHeapBytes: readonly number[]
  readonly gatewayLatencyMs: readonly number[]
  readonly interpolationDelayMs: readonly number[]
  readonly webSocketPendingBatchDepth: readonly number[]
  readonly browserInterpolationBufferDepth: readonly number[]
  readonly webSocketHistoricalGrowthDetected: boolean
  readonly browserBufferHistoricalGrowthDetected: boolean
  readonly leafUpdatesPerSecond: number
  readonly gatewayRestartCount: number
}

export interface ReleasePerformanceResultV1 {
  readonly durationMs: number
  readonly visibleTriangleCount: number
  readonly browserP95FrameIntervalMs: number
  readonly browserPeakHeapBytes: number
  readonly gatewayP95ProcessingLatencyMs: number
  readonly interpolationP95DelayMs: number
  readonly webSocketPeakPendingBatchDepth: number
  readonly browserPeakInterpolationBufferDepth: number
  readonly webSocketHistoricalGrowthDetected: boolean
  readonly browserBufferHistoricalGrowthDetected: boolean
  readonly leafUpdatesPerSecond: number
  readonly gatewayRestartCount: number
}

export function assertReleasePerformance(
  samples: ReleasePerformanceSamplesV1,
): ReleasePerformanceResultV1
```

Drive exactly 1,024 expanded Leaves at 10 Hz through P4's release load endpoint for 900,000 ms. Before load, read the rendered Scene triangle count and reject more than 1.5M. Once per second, sample browser animation-frame intervals and Chromium heap, end-to-end interpolation delay, WebSocket transmitting-plus-pending depth, the maximum per-channel Browser interpolation-buffer depth, Gateway processing latency, and container restart state. Calculate nearest-rank p95 from all valid latency samples. Require interpolation p95 in the inclusive 100-300 ms range, every WebSocket depth sample <=2, every Browser buffer sample <=32, and no retained historical entry beyond those bounded structures during any measurement window. Compose already enforces 1 CPU and 512 MiB; fail on restart/OOM or a configured resource-limit mismatch.

- [ ] **Step 4: Add the browser collector and runner integration**

`tests/heterogeneous-performance.spec.ts` loads the same sample, waits for ready, starts the release load, records Scene triangles, frames/heap, interpolation delay, queue/buffer depths, and history-growth diagnostics for the full 15 minutes, then writes one JSON result below `.artifacts/mrb05-release`. `runMRb05Release` invokes the performance step after functional acceptance and parses the result through `assertReleasePerformance`; it cannot accept a missing field, missing file, shorter duration, or a measurement window that omits the bounded-state diagnostics.

- [ ] **Step 5: Run GREEN and commit**

```powershell
npm run test:run -- scripts/release/run-heterogeneous-performance.test.ts scripts/release/run-mrb05-release.test.ts
npm run lint
npm run build:gateway
npm run build
git add scripts/release/run-heterogeneous-performance* scripts/release/run-mrb05-release* tests/heterogeneous-performance.spec.ts playwright.mrb05.config.ts
git diff --cached --check
git commit -m "test: enforce heterogeneous performance gate"
```

### Task 7: Complete the Non-Skippable Release and In-App Browser Evidence

**Files:**
- Create: `docs/operator/heterogeneous-demo.md`
- Create: `docs/verification/heterogeneous-release-verification.md`
- Modify: `README.md`
- Modify: `docs/progress/2026-07-13-project-status.md`
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `docs/superpowers/plans/2026-07-16-heterogeneous-release-demo.md`

**Interfaces:**
- Consumes: Tasks 1-6 and every P1-P7 release gate.
- Produces: final reproducible commands, sanitized automated evidence, Codex in-app browser evidence, and the completed P8 gate.

- [ ] **Step 1: Add a release-suite structural test**

Scan `playwright.mrb05.config.ts`, `tests/heterogeneous-dual-robot-opcua.spec.ts`, and `tests/heterogeneous-performance.spec.ts`; fail if they contain `test.skip`, `describe.skip`, a conditional return for missing MRb05, or a development Web server. Assert `test:release:mrb05` invokes the strict runner and the runner calls both functional and performance suites.

- [ ] **Step 2: Run the complete automated release gate**

```powershell
$env:ROBOTSIM_ASSET_MOUNT_LOCAL_SAMPLES = (Get-Location).Path
npm run verify
npm run test:p3-authoring
npm run test:interchange
npm run verify:pick-place
npm run test:middleware
npm run build:gateway
npm run deploy:validate
npm run deploy:smoke:modes
npm run test:release:mrb05
```

Expected: all commands exit 0; `test:release:mrb05` reports zero skipped tests, exact MRb05 preflight, the full functional scenario, and a 900,000 ms performance run within every threshold.

- [ ] **Step 3: Repeat the visible acceptance in the Codex in-app browser**

Start the already-built release Compose stack in Server mode, open `http://127.0.0.1:8080/` in the Codex in-app browser, and repeat the Task 5 sequence through visible controls. Use the release OPC UA Client for Read/Write evidence. Capture screenshots or equivalent visible evidence showing both Robots, each Robot's Job/Joint selection, MRb05 commanded J1 subtree, CRB holding `Cup_01`, successful results, Save/Reload, and Reset.

If the in-app browser, Docker Engine, external Asset, operator-confirmation artifact, or OPC UA Client is unavailable, stop and report that exact blocker. Do not mark the plan complete from headless or static-only evidence.

- [ ] **Step 4: Write the exact operator and verification records**

`docs/operator/heterogeneous-demo.md` records environment setup, logical URI, Compose command, UI flow, OPC UA endpoint, command staging order, dedup replay, reset, and cleanup. `docs/verification/heterogeneous-release-verification.md` records the commit, exact commands, pass/fail counts, zero skipped tests, health/readiness, MRb05 counts/digest, OPC UA results, Attach/Detach tolerance, performance metrics/duration, and in-app browser evidence paths. Do not include absolute mount paths or raw logs.

- [ ] **Step 5: Verify repository hygiene and commit**

```powershell
rg -n "T[B]D|T[O]DO|F[I]XME|f[i]ll in|impl[e]ment later|appropr[i]ate error handling|sim[i]lar to Task" docs/operator/heterogeneous-demo.md docs/verification/heterogeneous-release-verification.md
git status --short
git diff --check
git add docs/operator/heterogeneous-demo.md docs/verification/heterogeneous-release-verification.md README.md docs/progress/2026-07-13-project-status.md package.json package-lock.json docs/superpowers/plans/2026-07-16-heterogeneous-release-demo.md
git diff --cached --check
git commit -m "docs: record heterogeneous release evidence"
```

Expected: the placeholder scan exits 1, only intended source/docs are staged, `Savvy/` and other CAD folders remain untracked, and the commit succeeds.

## Self-Review

- **Spec coverage:** Task 1 pins the exact external file/hierarchy. Task 2 makes semantic MRb05 approval human-owned and non-inferential. Task 3 creates the required heterogeneous Project/Jobs/Actions/Mappings. Task 4 provides strict Docker health/readiness and no-skip orchestration. Task 5 proves real OPC UA Read/Write, concurrent Jobs, Action routing, Pick/Place, deduplication, Save/Reload, and Reset. Task 6 enforces every quantitative performance criterion for 15 minutes. Task 7 requires Codex in-app browser evidence and sanitized documentation.
- **No-skip audit:** The release runner fails on missing prerequisites and parses Playwright counts. Release specs contain no skip path. A skipped external suite cannot satisfy completion.
- **No-inference audit:** The only real MRb05 Definition source is the operator-approved browser export. The verifier validates it but cannot generate, repair, or approve ownership/Mechanics.
- **Type consistency:** `MRB05_FIXTURE_CONTRACT`, `MRb05OperatorConfirmationV1`, `createHeterogeneousDemoProjectV4`, `OpcUaReleaseClient`, and `ReleasePerformanceResultV1` each have one owning module and are consumed by name in subsequent tasks.
- **Repository hygiene:** The Project and committed artifacts contain the logical URI/digest only. Physical STEP bytes, mount roots, raw logs, and `.artifacts` stay untracked.
- **Placeholder scan:** Run `rg -n "T[B]D|T[O]DO|F[I]XME|f[i]ll in|impl[e]ment later|appropr[i]ate error handling|sim[i]lar to Task" docs/superpowers/plans/2026-07-16-heterogeneous-release-demo.md`; expect exit code 1.
