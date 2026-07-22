# Generic Serial Robot Mechanics Authoring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make one through sixteen-axis serial Robots mechanically correct by authoring per-Joint parent/child, origin, axis, limits, direction, zero offset, and Geometry alignment instead of assigning one fixed six-axis template.

**Architecture:** `RobotDefinitionV5` remains the only runtime representation. Import adapters and the manual editor produce one `RobotMechanicsImportCandidateV1` containing definition identity/assets, Mechanics metadata, an authoring draft that may contain fixed Joints, and an explicit Geometry-alignment mode. A deterministic materializer collapses fixed-only segments, optionally aligns assembled-at-Home STEP occurrences, and emits one validated movable serial chain. STEP supplies Geometry only, while a Manifest, resolved URDF, Datasheet entry, or manual editing supplies Mechanics. Every estimated value remains unconfirmed until a person explicitly applies it.

**Tech Stack:** TypeScript 6, React 19, Zustand 5, Three.js/R3F, Vitest, Testing Library, Playwright, existing Project V5 rigid-transform and serial-kinematics modules.

## Global Constraints

- Tasks 1-4 and Task 5's pure dependency-impact analysis may execute before the V5 browser cutover because they modify only inactive V5 core/feature modules and tests. They must not import from, register commands in, or otherwise change the active V4 browser path.
- Task 6 and all UI/browser acceptance work in Tasks 7-8 are blocked until `docs/superpowers/plans/2026-07-19-opcua-settings-connection-monitor.md` has completed its V5 publication/mutation authority and browser cutover, and `src/app/v5-production-import-graph.test.ts` proves the production `src/app` graph has no Project V4 dependency.
- This plan explicitly supersedes the prior master-plan freeze on the Project V5 aggregate only for adding required `RobotDefinitionV5.mechanics`. No other Project V5 field or semantic may be reopened. Land this contract change before the browser V5 cutover.
- The Task 1 aggregate change must update every V5 Project producer and direct Robot Definition fixture, canonical codec/golden expectation, repository materialization fixture, Runtime Gateway fixture, and config-revision expectation. The required surfaces are `src/core/project-v5/test-support.ts`, all `src/core/project-v5/*.test.ts` direct fixtures, `src/features/project/v5/logical-io-job-sample-v5.ts` and its tests, `src/features/project/v5/project-v5-codec.test.ts`, `src/features/project/v5/project-v5-repository.test.ts`, V5 browser-runtime/store tests under `src/features/project/v5`, V5 Robot/Job/Runtime-Gateway tests under `src/features/{robot,jobs,runtime-gateway}/v5`, and Runtime Gateway tests under `middleware/runtime-gateway`. Use the Task 1 producer scan as the completion gate; do not rely on a validator default.
- Do not add a Legacy menu, automatic V4 migration, or a V4/V5 union.
- Keep internal position in metres, revolute command values in degrees, prismatic command values in metres, rotation as quaternion XYZW, and display/edit orientation as intrinsic Z-Y-X RPY degrees.
- Keep STEP Geometry and Robot Mechanics independent. Replacing Geometry must never rewrite Joint origins or axes.
- The canonical runtime supports one connected, unbranched serial chain with one through sixteen movable revolute/prismatic Joints.
- Import-only fixed Joints are collapsed deterministically; they are not exposed as controllable Joint values or OPC UA Joint targets.
- Reject floating, planar, mimic, cyclic, and movable-branched kinematics in this milestone.
- AI may propose a draft only in a separate future milestone. This plan contains no API-key path and no AI-authored value may be applied automatically.
- Apply is atomic. A failed validation leaves the active Project, Geometry, Jobs, OPC UA mappings, and persisted revision unchanged.

## Execution Phases

1. **Pre-cutover V5 foundation:** Tasks 1-4 and Task 5. These deliver a validated import candidate, deterministic materialization/alignment, adapters, and pure impact analysis without touching active browser state.
2. **Existing V5 browser cutover:** complete the prerequisite Robotics/product-exchange milestone, then execute `2026-07-19-opcua-settings-connection-monitor.md` Tasks 1-7 in order. Do not execute only its Task 7 in isolation.
3. **Post-cutover authoring:** Tasks 6-8 consume the cutover's `ProjectV5AtomicMutationPort`, active V5 commands, V5 Model menu, V5 App, and V5 persistence flow.

## Canonical transform rule

For every movable Joint, runtime forward kinematics remains:

```text
T_world_childLink
= T_world_parentLink
* T_parentLink_jointOrigin
* T_jointMotion(axis, direction * (command + zeroOffset))

T_world_geometry
= T_world_link * T_link_geometry
```

This is compatible with the URDF convention that Joint origin transforms the parent Link frame to the Joint frame and the Joint axis is expressed in the Joint frame. Denavit-Hartenberg tables are accepted only through an adapter that converts them to these explicit transforms; DH is not the canonical storage format.

---

### Task 1: Lock Mechanics provenance and confirmation in Project V5

**Files:**
- Modify: `src/core/project-v5/types.ts`
- Modify: `src/core/project-v5/validate-shape.ts`
- Modify: `src/core/project-v5/validate-references.ts`
- Modify: `src/core/project-v5/test-support.ts`
- Modify: `src/features/project/v5/logical-io-job-sample-v5.ts`
- Test: `src/core/project-v5/validate-shape.test.ts`
- Test: `src/core/project-v5/validate-references.test.ts`
- Test: `src/core/project-v5/canonical-json.test.ts`
- Test: `src/features/project/v5/logical-io-job-sample-v5.test.ts`
- Test: `src/features/project/v5/project-v5-codec.test.ts`
- Test: `src/features/project/v5/project-v5-repository.test.ts`
- Test: every direct V5 Robot Definition fixture found by the producer scan in Step 4, including browser-runtime, Robot, Job, Runtime-Gateway, and `middleware/runtime-gateway` tests

**Interfaces:**
- Produces: `RobotMechanicsMetadataV1` on every `RobotDefinitionV5`.
- Consumes: existing `RobotDefinitionV5`, `RigidTransformV5`, and closed-record validation conventions.

- [ ] **Step 1: Write the failing validation tests**

```ts
function projectWithMechanics(mechanics: RobotMechanicsMetadataV1 | Record<string, unknown>): unknown {
  const project = makeMinimalWorkcellProjectV5()
  const definition = project.robotDefinitions[0]!
  return {
    ...project,
    robotDefinitions: [{ ...definition, mechanics }],
  }
}

it('accepts confirmed manifest mechanics and rejects unknown provenance fields', () => {
  const mechanics: RobotMechanicsMetadataV1 = {
    schemaVersion: 1,
    status: 'confirmed',
    sourceKind: 'manifest',
    sourceName: 'ned2.robot.json',
    calibrationRevision: 'ned2-r1',
  }
  expect(validateWorkcellProjectV5(projectWithMechanics(mechanics))).toBeDefined()
  expect(() => validateWorkcellProjectV5(projectWithMechanics({
    ...mechanics,
    unexpected: true,
  }))).toThrow(/closed|unexpected/i)
})

it('rejects an empty calibration revision', () => {
  const project = projectWithMechanics({
    schemaVersion: 1,
    status: 'estimated',
    sourceKind: 'step-estimate',
    sourceName: 'robot.step',
    calibrationRevision: '',
  })
  expect(() => validateWorkcellProjectV5(project)).toThrow(/calibrationRevision/)
})
```

- [ ] **Step 2: Run the tests and verify RED**

Run: `npm run test:run -- src/core/project-v5/validate-shape.test.ts src/core/project-v5/validate-references.test.ts`

Expected: FAIL because `RobotDefinitionV5.mechanics` and its validation do not exist.

- [ ] **Step 3: Add the closed metadata contract**

```ts
export interface RobotMechanicsMetadataV1 {
  readonly schemaVersion: 1
  readonly status: 'estimated' | 'confirmed'
  readonly sourceKind: 'manual' | 'manifest' | 'resolved-urdf' | 'datasheet' | 'step-estimate'
  readonly sourceName: string
  readonly calibrationRevision: string
}

export interface RobotDefinitionV5 {
  // existing fields remain unchanged
  readonly mechanics: RobotMechanicsMetadataV1
}
```

Require non-empty `sourceName` and `calibrationRevision`. Update every V5 fixture explicitly; do not add a validator or decoder default. This is the only approved exception to the prior V5 aggregate freeze.

- [ ] **Step 4: Update every V5 producer, fixture, codec, Gateway fixture, and hash expectation**

Run the producer scan before and after editing:

```powershell
rg -l "robotDefinitions\s*:|RobotDefinitionV5|makeMinimalWorkcellProjectV5|logical-io-job-sample-v5" src/core/project-v5 src/features/project/v5 src/features/robot/v5 src/features/jobs/v5 src/features/runtime-gateway/v5 middleware/runtime-gateway
```

For every result that constructs or snapshots a Robot Definition, add explicit Mechanics metadata. Update canonical JSON/codec golden text, repository materialization expectations, Gateway Project fixtures, and every expected `configRevisionForProjectV5` SHA-256 value whose canonical bytes changed. Do not preserve an old hash with a compatibility branch and do not bulk-accept snapshots without inspecting the Mechanics field.

- [ ] **Step 5: Run the complete changed-contract suite**

Run:

```powershell
npm run test:run -- src/core/project-v5 src/features/project/v5 src/features/robot/v5 src/features/jobs/v5 src/features/runtime-gateway/v5 middleware/runtime-gateway
npm run lint
npm run build:gateway
npm run build
```

Expected: all affected V5/Gateway tests PASS; lint and both builds succeed; every canonical/config revision expectation includes the required Mechanics bytes.

- [ ] **Step 6: Commit**

```powershell
git diff --check
# Stage only the Task 1 files identified by the producer scan and reviewed above.
git commit -m "feat: record robot mechanics provenance"
```

---

### Task 2: Canonicalize movable and fixed Joint drafts

**Files:**
- Create: `src/core/robot-runtime-v5/robot-mechanics-draft.ts`
- Create: `src/core/robot-runtime-v5/robot-mechanics-import-candidate.ts`
- Create: `src/core/robot-runtime-v5/canonicalize-robot-mechanics.ts`
- Test: `src/core/robot-runtime-v5/canonicalize-robot-mechanics.test.ts`
- Modify: `src/core/robot-runtime-v5/index.ts`

**Interfaces:**
- Produces: `RobotMechanicsDraftV1`, `RobotMechanicsImportCandidateV1`, `RobotGeometryAlignmentV1`, and `canonicalizeRobotMechanicsV5(draft)`.
- Consumes: `RobotMechanicsMetadataV1`, `RobotLinkDefinitionV5`, `RobotJointDefinitionV5`, `FrameDefinitionV5`, and rigid-transform composition.

- [ ] **Step 1: Define the failing tests for distinct origins**

```ts
it('keeps each Robot Joint origin and axis independent', () => {
  const compact = canonicalizeRobotMechanicsV5(makeSixAxisDraft({ j2OriginM: [0, 0, 0.20] }))
  const tall = canonicalizeRobotMechanicsV5(makeSixAxisDraft({ j2OriginM: [0, 0, 0.55] }))
  expect(compact.joints[1]!.origin.positionM).toEqual([0, 0, 0.20])
  expect(tall.joints[1]!.origin.positionM).toEqual([0, 0, 0.55])
})

it('collapses fixed accessories without creating a command Joint', () => {
  const result = canonicalizeRobotMechanicsV5(makeDraftWithFixedCameraMount())
  expect(result.joints.map(({ id }) => id)).toEqual(['J1', 'J2'])
  expect(result.links).toHaveLength(3)
  expect(result.links[1]!.geometryOccurrences.map(({ occurrenceKey }) => occurrenceKey))
    .toContain('camera-body')
})

it('rejects a movable branch and a fixed cycle', () => {
  expect(() => canonicalizeRobotMechanicsV5(makeMovableBranchDraft()))
    .toThrow(/MOVABLE_BRANCH_UNSUPPORTED/)
  expect(() => canonicalizeRobotMechanicsV5(makeFixedCycleDraft()))
    .toThrow(/KINEMATIC_CYCLE/)
})
```

The test file defines these local builders; they are test support, not production API:

- `makeSixAxisDraft({ j2OriginM }): RobotMechanicsDraftV1` returns `LINK00` through `LINK06`, `J1` through `J6`, one TCP Frame parented to `LINK06`, and otherwise identity origins with finite revolute limits.
- `makeDraftWithFixedCameraMount(): RobotMechanicsDraftV1` returns movable `J1`/`J2` plus a fixed accessory Link containing occurrence `camera-body` and no movable descendant.
- `makeMovableBranchDraft(): RobotMechanicsDraftV1` returns one Link with two movable child branches.
- `makeFixedCycleDraft(): RobotMechanicsDraftV1` returns three fixed edges whose parent/child graph closes a cycle.

- [ ] **Step 2: Run the tests and verify RED**

Run: `npm run test:run -- src/core/robot-runtime-v5/canonicalize-robot-mechanics.test.ts`

Expected: FAIL because the draft and canonicalizer modules do not exist.

- [ ] **Step 3: Implement the import-only draft contract**

```ts
export interface RobotMechanicsDraftJointV1 {
  readonly id: string
  readonly type: 'revolute' | 'prismatic' | 'fixed'
  readonly parentLinkId: string
  readonly childLinkId: string
  readonly origin: RigidTransformV5
  readonly axis: Vector3V5 | null
  readonly min: number | null
  readonly max: number | null
  readonly home: number | null
  readonly zeroOffset: number
  readonly direction: 1 | -1
  readonly maximumVelocity: number | null
}

export interface RobotMechanicsDraftV1 {
  readonly links: readonly RobotLinkDefinitionV5[]
  readonly joints: readonly RobotMechanicsDraftJointV1[]
  readonly frames: readonly FrameDefinitionV5[]
}

export type RobotDefinitionEnvelopeV1 = Pick<
  RobotDefinitionV5,
  | 'id'
  | 'name'
  | 'identification'
  | 'assetReferenceIds'
  | 'sourceConventions'
  | 'excludedGeometryOccurrenceKeys'
>

export type RobotGeometryAlignmentV1 =
  | { readonly kind: 'link-local' }
  | {
      readonly kind: 'assembled-home'
      readonly occurrenceWorldPoses: Readonly<Record<string, RigidTransformV5>>
    }

export interface RobotMechanicsImportCandidateV1 {
  readonly schemaVersion: 1
  readonly definition: RobotDefinitionEnvelopeV1
  readonly mechanics: RobotMechanicsMetadataV1
  readonly draft: RobotMechanicsDraftV1
  readonly geometryAlignment: RobotGeometryAlignmentV1
}
```

Fixed Joints require `axis`, limits, home, and maximum velocity to be `null`. Movable Joints require finite limits, home within limits, finite positive velocity, and a finite non-zero axis. The import candidate is the single contract returned by every adapter and created by the manual editor; no adapter may return a bare draft plus out-of-band provenance or alignment state.

- [ ] **Step 4: Implement deterministic fixed-segment collapse**

```ts
export function canonicalizeRobotMechanicsV5(
  draft: RobotMechanicsDraftV1,
): Pick<RobotDefinitionV5, 'links' | 'joints' | 'frames'> {
  const graph = validateDraftGraph(draft)
  const collapsed = collapseFixedOnlySegments(graph)
  return Object.freeze({
    links: Object.freeze(collapsed.links),
    joints: Object.freeze(collapsed.movableJoints.map(toRuntimeJoint)),
    frames: Object.freeze(collapsed.frames),
  })
}
```

When collapsing a fixed edge, compose its origin into every descendant Geometry occurrence, Frame, and next movable Joint origin. A fixed accessory branch with no movable descendant merges into the nearest retained Link. A branch containing a movable descendant is rejected.

- [ ] **Step 5: Run canonicalization and kinematics tests**

Run: `npm run test:run -- src/core/robot-runtime-v5`

Expected: all Robot Runtime V5 tests PASS, including distinct-origin and fixed-collapse cases.

- [ ] **Step 6: Commit**

```powershell
git add src/core/robot-runtime-v5
git commit -m "feat: canonicalize generic serial robot mechanics"
```

---

### Task 3: Align assembled-zero-pose STEP Geometry to Link frames

**Files:**
- Create: `src/core/robot-runtime-v5/align-assembled-geometry.ts`
- Create: `src/core/robot-runtime-v5/materialize-robot-mechanics-import.ts`
- Test: `src/core/robot-runtime-v5/align-assembled-geometry.test.ts`
- Test: `src/core/robot-runtime-v5/materialize-robot-mechanics-import.test.ts`
- Modify: `src/core/robot-runtime-v5/index.ts`

**Interfaces:**
- Produces: `alignAssembledGeometryV5(definition, occurrenceWorldPoses)` and `materializeRobotMechanicsImportCandidateV5(candidate): RobotDefinitionV5`.
- Consumes: Task 2 `RobotMechanicsImportCandidateV1`, `canonicalizeRobotMechanicsV5`, `computeSerialRobotPoseV5`, and `relativeRigidTransformV5`.

- [ ] **Step 1: Write the failing home-pose invariance test**

```ts
it('preserves assembled source placement at Home and follows the Link after motion', () => {
  const candidate = makeAssembledHomeCandidate()
  const assembled = candidate.geometryAlignment
  if (assembled.kind !== 'assembled-home') throw new Error('Test fixture must use assembled-home alignment.')
  const aligned = materializeRobotMechanicsImportCandidateV5(candidate)
  const homePose = computeSerialRobotPoseV5(aligned, homeJointValuesV5(aligned))
  expectOccurrenceWorldPosesV5(homePose, aligned)
    .toEqualCloseTo(assembled.occurrenceWorldPoses, 1e-9)

  const moved = computeSerialRobotPoseV5(aligned, { ...homeJointValuesV5(aligned), J2: 45 })
  expectOccurrenceWorldPoseV5(moved, aligned, 'LINK02-body')
    .not.toEqual(assembled.occurrenceWorldPoses['LINK02-body'])
})
```

The test file defines `makeAssembledHomeCandidate(): RobotMechanicsImportCandidateV1` with an offset `J2`, one occurrence on each retained Link, and `geometryAlignment.kind === 'assembled-home'`. It also defines `expectOccurrenceWorldPosesV5`, `expectOccurrenceWorldPoseV5`, and the custom matcher `toEqualCloseTo(actual, expected, tolerance)`, each by composing `pose.linkWorldPoses[linkId]` with `occurrence.linkLocalPose`. These names are test-only helpers.

- [ ] **Step 2: Run the test and verify RED**

Run: `npm run test:run -- src/core/robot-runtime-v5/align-assembled-geometry.test.ts`

Expected: FAIL because `alignAssembledGeometryV5` does not exist.

- [ ] **Step 3: Implement inverse-Home alignment**

```ts
export function alignAssembledGeometryV5(
  definition: RobotDefinitionV5,
  assembledOccurrenceWorldPoses: Readonly<Record<string, RigidTransformV5>>,
): RobotDefinitionV5 {
  const home = computeSerialRobotPoseV5(definition, homeJointValues(definition))
  return mapGeometryOccurrences(definition, (linkId, occurrence) => ({
    ...occurrence,
    linkLocalPose: relativeRigidTransformV5(
      home.linkWorldPoses[linkId]!,
      assembledOccurrenceWorldPoses[occurrence.occurrenceKey]!,
    ),
  }))
}
```

The module also exports `homeJointValuesV5(definition): Readonly<Record<string, number>>`, derived solely from `definition.joints[].home`, for use by alignment/tests. Its private occurrence mapper must preserve Definition/Link/occurrence order and freeze each replaced collection.

Require every Geometry occurrence key in the canonical Definition exactly once in `assembledOccurrenceWorldPoses`; reject extra keys, missing keys, duplicate occurrence keys in the Definition, and non-finite/non-normalizable transforms. Alignment runs only after fixed-Joint collapse, so each occurrence is assigned to its retained Link before the inverse-Home transform is computed.

- [ ] **Step 4: Implement the single materialization orchestration**

```ts
export function materializeRobotMechanicsImportCandidateV5(
  candidate: RobotMechanicsImportCandidateV1,
): RobotDefinitionV5 {
  const canonical = canonicalizeRobotMechanicsV5(candidate.draft)
  const definition: RobotDefinitionV5 = Object.freeze({
    ...candidate.definition,
    mechanics: candidate.mechanics,
    links: canonical.links,
    joints: canonical.joints,
    frames: canonical.frames,
  })
  return candidate.geometryAlignment.kind === 'assembled-home'
    ? alignAssembledGeometryV5(definition, candidate.geometryAlignment.occurrenceWorldPoses)
    : definition
}
```

This is the only import/manual materialization order: validate the closed candidate and metadata; canonicalize and collapse fixed Joints; construct the runtime Definition; if and only if alignment is `assembled-home`, evaluate Home kinematics and replace Link-local Geometry poses; finally validate the complete candidate Project before persistence. `link-local` Manifest/URDF Geometry is never realigned. Replacing STEP Geometry may replace asset references, occurrences, and alignment poses, but must copy the existing Mechanics draft unchanged unless the operator separately edits Mechanics.

- [ ] **Step 5: Run the focused suite**

Run: `npm run test:run -- src/core/robot-runtime-v5`

Expected: all tests PASS and Home Geometry differs by less than `1e-9` metres/quaternion component from the assembled source.

- [ ] **Step 6: Commit**

```powershell
git add src/core/robot-runtime-v5
git commit -m "feat: align assembled robot geometry to link frames"
```

---

### Task 4: Add deterministic Manifest and resolved URDF adapters

**Files:**
- Create: `src/features/robot-authoring/v5/robot-definition-manifest-v1.ts`
- Create: `src/features/robot-authoring/v5/robot-definition-manifest-v1.test.ts`
- Create: `src/features/robot-authoring/v5/resolved-urdf-adapter-v1.ts`
- Create: `src/features/robot-authoring/v5/resolved-urdf-adapter-v1.test.ts`
- Create: `src/features/robot-authoring/v5/fixture-support.test.ts`
- Create: `src/features/robot-authoring/v5/fixtures/two-offset-six-axis.robot.json`
- Create: `src/features/robot-authoring/v5/fixtures/fixed-tool.urdf`

**Interfaces:**
- Produces: `decodeRobotDefinitionManifestV1(bytes): RobotMechanicsImportCandidateV1`, `ResolvedUrdfAssetBindingsV1`, and `parseResolvedUrdfV1(xml, assetBindings): RobotMechanicsImportCandidateV1`.
- Consumes: Task 2's single import-candidate contract and Task 3's `materializeRobotMechanicsImportCandidateV5` orchestration.

`ResolvedUrdfAssetBindingsV1` is defined in `resolved-urdf-adapter-v1.ts` as:

```ts
export interface ResolvedUrdfAssetBindingsV1 {
  readonly definition: RobotDefinitionEnvelopeV1
  readonly mechanics: RobotMechanicsMetadataV1 & { readonly sourceKind: 'resolved-urdf' }
  readonly geometryOccurrencesByLinkName: Readonly<
    Record<string, readonly RobotGeometryOccurrenceV5[]>
  >
  readonly geometryAlignment: RobotGeometryAlignmentV1
}
```

The caller resolves assets before parsing; the URDF adapter never reads files, resolves packages, or fetches resources. Every geometry occurrence must come from `geometryOccurrencesByLinkName`. Unknown/missing URDF Link names, duplicate occurrence keys, or an occurrence asset not declared by `definition.assetReferenceIds` fail closed.

- [ ] **Step 1: Write Manifest tests**

```ts
it('decodes independent per-Joint origins and occurrence-to-Link mappings', () => {
  const candidate = decodeRobotDefinitionManifestV1(
    readRobotAuthoringFixtureBytesV1('two-offset-six-axis.robot.json'),
  )
  expect(candidate.mechanics.sourceKind).toBe('manifest')
  expect(candidate.draft.joints[1]!.origin.positionM).toEqual([0, 0, 0.42])
  expect(candidate.draft.joints[1]!.axis).toEqual([0, 1, 0])
  expect(candidate.draft.links[2]!.geometryOccurrences[0]!.occurrenceKey).toBe('arm-link-2')
  expect(materializeRobotMechanicsImportCandidateV5(candidate).joints).toHaveLength(6)
})
```

- [ ] **Step 2: Write resolved URDF tests**

```ts
it('uses parent-to-joint origin, joint-frame axis, and collapses a fixed tool', () => {
  const candidate = parseResolvedUrdfV1(
    readRobotAuthoringFixtureTextV1('fixed-tool.urdf'),
    makeResolvedUrdfAssetBindingsV1(),
  )
  const definition = materializeRobotMechanicsImportCandidateV5(candidate)
  expect(definition.joints.map(({ type }) => type)).toEqual(['revolute', 'revolute'])
  expect(definition.joints[1]!.origin.positionM).toEqual([0, 0, 0.31])
  expect(definition.frames.find(({ role }) => role === 'tcp')?.parentFrameId).toBe('LINK02')
})

it.each(['continuous', 'floating', 'planar', 'mimic'])(
  'rejects unsupported resolved URDF construct %s',
  (construct) => expect(() => parseResolvedUrdfFixtureWithV1(construct)).toThrow(/URDF_UNSUPPORTED/),
)
```

Both adapter test files import these helpers from a test-only `src/features/robot-authoring/v5/fixture-support.test.ts`: `readRobotAuthoringFixtureBytesV1(name)` and `readRobotAuthoringFixtureTextV1(name)` read only the named checked-in fixture via `new URL('./fixtures/' + name, import.meta.url)` after rejecting `/`, `\\`, and `..`; `makeResolvedUrdfAssetBindingsV1()` returns a complete `ResolvedUrdfAssetBindingsV1` for `fixed-tool.urdf`; `parseResolvedUrdfFixtureWithV1(construct)` substitutes exactly one checked-in Joint construct and calls `parseResolvedUrdfV1` with those bindings.

- [ ] **Step 3: Run both adapter tests and verify RED**

Run: `npm run test:run -- src/features/robot-authoring/v5`

Expected: FAIL because neither adapter exists.

- [ ] **Step 4: Implement the closed Manifest codec**

The JSON uses schema `open-digital-twin/robot-definition-manifest/1`, one closed Definition envelope, Mechanics metadata, draft Links/Joints/Frames, explicit units/transforms, asset occurrence mappings, and one closed Geometry-alignment union. It contains no embedded STEP bytes. Reject unknown fields, path traversal, duplicate IDs/occurrence keys, undeclared assets, invalid units, and non-finite numbers before returning the complete `RobotMechanicsImportCandidateV1`. A Manifest with already Link-local transforms uses `{ "kind": "link-local" }`; a Manifest describing an assembled-at-Home STEP source uses `{ "kind": "assembled-home", "occurrenceWorldPoses": ... }` and must provide exactly one pose per occurrence.

- [ ] **Step 5: Implement the resolved URDF adapter**

Read only already-expanded URDF XML. Do not execute Xacro, shell commands, package resolvers, or network requests. Interpret `origin xyz/rpy`, `parent`, `child`, `axis`, and `limit`; convert radians to degrees for revolute limits/velocity and retain metres for prismatic values. Fixed Joints enter `candidate.draft` and are collapsed only by Task 3 materialization. Copy `definition`, `mechanics`, and `geometryAlignment` from the closed bindings; attach each pre-resolved occurrence to its matching URDF Link. Return the complete candidate, never a bare draft.

- [ ] **Step 6: Run adapter and core suites**

Run: `npm run test:run -- src/features/robot-authoring/v5 src/core/robot-runtime-v5 src/core/project-v5`

Expected: all tests PASS.

- [ ] **Step 7: Commit**

```powershell
git add src/features/robot-authoring/v5
git commit -m "feat: import robot mechanics manifests and resolved URDF"
```

---

### Task 5: Add pure dependency-impact analysis

**Files:**
- Create: `src/features/robot-authoring/v5/robot-definition-impact.ts`
- Test: `src/features/robot-authoring/v5/robot-definition-impact.test.ts`

**Interfaces:**
- Produces: pure `analyzeRobotDefinitionImpactV5(project, candidateDefinition)`.
- Consumes: a canonical `RobotDefinitionV5` candidate and an immutable `WorkcellProjectV5`; it has no repository, browser-runtime, Gateway, or UI dependency.

- [ ] **Step 1: Write dependency-impact tests**

```ts
it('reports every affected Instance, Job, OPC UA mapping, and Frame', () => {
  const report = analyzeRobotDefinitionImpactV5(projectWithSharedDefinition(), changedDefinition())
  expect(report.robotIds).toEqual(['robot-a', 'robot-b'])
  expect(report.jobIds).toEqual(['job-a', 'job-b'])
  expect(report.mappingIds).toEqual(['map-j1-a'])
  expect(report.requiresMotionRevalidation).toBe(true)
})

it('reports removed Joint IDs referenced by Jobs or mappings as blocking', () => {
  const report = analyzeRobotDefinitionImpactV5(
    projectWithJ6References(),
    candidateDefinitionWithoutJ6(),
  )
  expect(report.blockingCodes).toContain('JOINT_DEPENDENCY_CONFLICT')
})
```

The test file defines complete V5 fixtures `projectWithSharedDefinitionV5`, `changedDefinitionV5`, `projectWithJ6ReferencesV5`, and `candidateDefinitionWithoutJ6V5`. Each fixture passes `validateWorkcellProjectV5` before the analyzer is called; no helper reads or mutates production persistence.

- [ ] **Step 2: Run tests and verify RED**

Run: `npm run test:run -- src/features/robot-authoring/v5/robot-definition-impact.test.ts`

Expected: FAIL because the impact analyzer does not exist.

- [ ] **Step 3: Implement immutable impact reporting**

```ts
export interface RobotDefinitionImpactV5 {
  readonly robotIds: readonly string[]
  readonly jobIds: readonly string[]
  readonly mappingIds: readonly string[]
  readonly frameIds: readonly string[]
  readonly requiresMotionRevalidation: boolean
  readonly blockingCodes: readonly string[]
}
```

Changing origin, axis, direction, offset, limits, or Link Geometry sets `requiresMotionRevalidation`. Removing or renaming an ID used by a Job, selected TCP, Frame source, Attachment, or OPC UA mapping is blocking. Return stable sorted IDs and blocking codes. Do not silently rewrite references and do not mutate the Project or candidate.

- [ ] **Step 4: Run the authoring and Project model suites**

Run: `npm run test:run -- src/features/robot-authoring/v5/robot-definition-impact.test.ts src/core/project-v5`

Expected: all tests PASS, including immutability and stable-order cases.

- [ ] **Step 5: Commit**

```powershell
git add src/features/robot-authoring/v5/robot-definition-impact.ts src/features/robot-authoring/v5/robot-definition-impact.test.ts
git commit -m "feat: analyze robot mechanics dependencies"
```

---

### V5 browser cutover prerequisite gate

Do not begin Task 6 until the existing OPC UA Settings/Monitor milestone has delivered and tested all of the following production interfaces:

- `ProjectV5AtomicMutationPort`, owned by the single V5 publication coordinator.
- Active `AppV5`, V5 Model-menu command composition, V5 Scene/selection, and V5 Project file/persistence flow.
- Production import-graph proof that `src/app` has no Project V4 dependency and exposes no Legacy path.

Complete the existing Milestone 4 prerequisites and the Settings/Monitor plan Tasks 1-7 rather than recreating those facilities in this feature. Record the exact prerequisite commit in the SDD ledger before dispatching Task 6.

---

### Task 6: Apply confirmed Mechanics through the V5 mutation authority

**Files:**
- Create: `src/features/robot-authoring/v5/robot-definition-authoring-service.ts`
- Test: `src/features/robot-authoring/v5/robot-definition-authoring-service.test.ts`

**Interfaces:**
- Produces: `prepareRobotDefinitionCommitV5(...)` and a single-use confirmation token.
- Consumes: Task 5 impact analysis and the cutover-provided `ProjectV5AtomicMutationPort`; it must not import a repository implementation or `browser-project-runtime-v5.ts` directly.

- [ ] **Step 1: Write RED stale-token, confirmation, and rollback tests**

Prepare validates and materializes the candidate, computes its impact report, and returns a token containing the exact active Project revision/configuration hash. Commit rejects blocking impact, unconfirmed Mechanics, a consumed token, or any base-revision change. A successful commit submits exactly one complete Project candidate to `ProjectV5AtomicMutationPort`. A port rejection leaves durable Project, browser runtime, Gateway activation, Jobs, mappings, and selection on the prior revision.

- [ ] **Step 2: Run RED**

Run: `npm run test:run -- src/features/robot-authoring/v5/robot-definition-authoring-service.test.ts`

Expected: FAIL because the service does not exist.

- [ ] **Step 3: Implement prepare/confirm/commit without a second lifecycle**

The service treats `ProjectV5AtomicMutationPort` as opaque. It may construct and validate the replacement Project, but it may not call IndexedDB, Gateway activation, runtime prepare/apply/commit, or rollback primitives itself. Those remain the single cutover publication authority's responsibility.

- [ ] **Step 4: Run focused publication and authoring suites**

Run: `npm run test:run -- src/features/robot-authoring/v5 src/features/project/v5`

Expected: all tests PASS, including stale-token, one-use token, confirmation, dependency, and port-failure rollback cases.

- [ ] **Step 5: Commit**

```powershell
git add src/features/robot-authoring/v5/robot-definition-authoring-service.ts src/features/robot-authoring/v5/robot-definition-authoring-service.test.ts
git commit -m "feat: apply robot mechanics atomically"
```

---

### Task 7: Build the manual Mechanics Editor and live preview

**Files:**
- Create: `src/features/robot-authoring/v5/robot-mechanics-draft-store.ts`
- Test: `src/features/robot-authoring/v5/robot-mechanics-draft-store.test.ts`
- Create: `src/features/robot-authoring/v5/RobotMechanicsDialogV5.tsx`
- Test: `src/features/robot-authoring/v5/RobotMechanicsDialogV5.test.tsx`
- Create: `src/features/robot-authoring/v5/RobotMechanicsPreviewV5.tsx`
- Modify: active V5 command composition and Model menu files established by the V5 cutover
- Modify: `src/styles/global.css`

**Interfaces:**
- Produces: Model menu command `robot.mechanics.open` and a modal editor with local draft ownership.
- Consumes: authoring service, impact report, V5 serial kinematics, selected Robot Definition/Instance.

- [ ] **Step 1: Write draft-store tests**

```ts
it('previews without mutating the active Project and resets on cancel', () => {
  const store = createRobotMechanicsDraftStoreV5(activeDefinition())
  store.getState().setJointOriginRpy('J2', [0, 0, 0.42], [0, 90, 0])
  expect(store.getState().previewDefinition.joints[1]!.origin.positionM).toEqual([0, 0, 0.42])
  expect(readActiveProject()).toEqual(originalProject)
  store.getState().cancel()
  expect(store.getState().previewDefinition).toEqual(activeDefinition())
})
```

The draft-store test creates one validated `originalProjectV5` fixture and passes its selected Definition into `createRobotMechanicsDraftStoreV5`. `readActiveProjectV5()` is a local spy-backed test port returning that frozen fixture; `activeDefinitionV5()` returns its selected Definition. These helpers must not read IndexedDB or a production singleton.

- [ ] **Step 2: Write dialog interaction tests**

```tsx
it('edits origin, axis, limits, direction, offset, and confirms estimated Mechanics', async () => {
  renderMechanicsDialog()
  await user.click(screen.getByRole('row', { name: /J2/ }))
  await user.clear(screen.getByLabelText('Origin Z'))
  await user.type(screen.getByLabelText('Origin Z'), '0.42')
  await user.click(screen.getByRole('button', { name: 'Preview Home' }))
  expect(previewPort.showDefinition).toHaveBeenCalled()
  expect(screen.getByText(/2 Robot Instances affected/)).toBeVisible()
  await user.click(screen.getByLabelText('I confirmed the mechanical configuration'))
  await user.click(screen.getByRole('button', { name: 'Apply Mechanics' }))
  expect(authoringService.commit).toHaveBeenCalledTimes(1)
})
```

- [ ] **Step 3: Run UI tests and verify RED**

Run: `npm run test:run -- src/features/robot-authoring/v5/RobotMechanicsDialogV5.test.tsx src/features/robot-authoring/v5/robot-mechanics-draft-store.test.ts`

Expected: FAIL because the editor does not exist.

- [ ] **Step 4: Implement the editor**

The dialog contains:

- Link/Joint chain tree.
- Editable Joint type, parent, child, Origin XYZ/RPY, Axis XYZ, min/max/home, direction, zero offset, and velocity.
- Read-only normalized-axis preview.
- Home, +Limit, -Limit, and selected-Joint sweep previews.
- World/Base/Joint/TCP frame markers.
- `Estimated` or `Confirmed` badge and calibration revision input.
- Impact summary listing affected Robot Instances, Jobs, mappings, and Frames.
- Apply disabled for invalid, unconfirmed, stale, or dependency-conflicting drafts.

Use one vertically scrolling dialog; do not put the full editor back into the right Inspector.

- [ ] **Step 5: Wire preview Geometry without persistence**

`RobotMechanicsPreviewV5` receives a frozen candidate definition and selected instance base pose. It uses `computeSerialRobotPoseV5` and the existing Geometry repository without writing IndexedDB or runtime Gateway state. Closing or cancelling restores the committed definition immediately.

- [ ] **Step 6: Run UI and V5 project suites**

Run: `npm run test:run -- src/features/robot-authoring/v5 src/features/project/v5 src/core/robot-runtime-v5`

Expected: all tests PASS.

- [ ] **Step 7: Commit**

```powershell
git add src/features/robot-authoring/v5 src/styles/global.css src/app
git commit -m "feat: add robot mechanics editor and preview"
```

---

### Task 8: Add heterogeneous Robot acceptance and operator documentation

**Files:**
- Create: `tests/generic-robot-mechanics.spec.ts`
- Create: `docs/operator/robot-mechanics-authoring.md`
- Modify: `README.md`
- Modify: `package.json`

**Interfaces:**
- Produces: `npm run test:e2e:mechanics` and the release acceptance evidence.
- Consumes: active V5 app, Manifest/URDF adapters, Mechanics Editor, normal Project save/reload.

- [ ] **Step 1: Write the Playwright acceptance test**

```ts
test('authors two six-axis Robots with different Joint origins and retains motion after reload', async ({ page }) => {
  await page.goto('/')
  await importRobotManifest(page, 'compact-six-axis.robot.json')
  await importRobotManifest(page, 'tall-six-axis.robot.json')
  await editJointOrigin(page, 'Tall Robot', 'J2', { x: 0, y: 0, z: 0.55 })
  await confirmAndApplyMechanics(page)
  await setJoint(page, 'Compact Robot', 'J2', 45)
  await setJoint(page, 'Tall Robot', 'J2', 45)
  await expectTcpReadoutsToDiffer(page, 'Compact Robot', 'Tall Robot')
  await saveAndReloadProject(page)
  await expectJointOrigin(page, 'Tall Robot', 'J2').toEqual({ x: 0, y: 0, z: 0.55 })
})
```

Define the Playwright helpers in `tests/support/generic-robot-mechanics.ts`. They must locate controls by accessible role/name, wait on the V5 Project revision/status UI rather than fixed timeouts, and return numeric pose/origin values parsed from labelled fields. Fixture import uses checked-in files only; no network, AI, or native CAD conversion is part of this acceptance path.

Add a second case proving a resolved URDF fixed Tool Joint does not appear in the Joint controls or OPC UA Joint mapping list while its TCP remains correctly positioned.

- [ ] **Step 2: Run E2E and verify RED**

Run: `npx playwright test tests/generic-robot-mechanics.spec.ts`

Expected: FAIL before the active V5 UI integration is complete.

- [ ] **Step 3: Add the npm command**

```json
"test:e2e:mechanics": "playwright test tests/generic-robot-mechanics.spec.ts"
```

- [ ] **Step 4: Document the operator flow and limits**

Document Manifest fields, resolved-URDF restrictions, fixed-Joint collapse, assembled STEP alignment, manual confirmation, shared-Definition impact, Job/mapping conflicts, and the distinction between Geometry correctness and manufacturer-certified calibration. Include the transform equation from this plan and one complete six-axis Manifest example.

- [ ] **Step 5: Run the release gate**

Run:

```powershell
npm run lint
npm run test:run
npm run build:gateway
npm run build
npm run test:e2e:mechanics
```

Expected: zero lint/type/build errors, all unit/integration tests PASS, and both heterogeneous Robot browser scenarios PASS.

- [ ] **Step 6: Commit**

```powershell
git add tests/generic-robot-mechanics.spec.ts docs/operator/robot-mechanics-authoring.md README.md package.json
git commit -m "test: verify heterogeneous robot mechanics authoring"
```

## Acceptance criteria

- Two six-axis Robots with different Joint origins and axes produce different, mathematically expected TCP poses from the same Joint command vector.
- A Robot may have one through sixteen movable serial Joints; no logic assumes `J1` through `J6` or `LINK00` through `LINK06`.
- A STEP assembly with one file may map multiple occurrences to different Links; STEP file count never determines Joint count.
- Fixed URDF segments are collapsed without appearing as controllable Joints, Job values, or OPC UA Joint targets.
- Assembled-zero-pose STEP Geometry remains visually unchanged at Home within `1e-9` transform tolerance after Link-local alignment.
- Manual edits preview without persistence and apply as one atomic Project revision only after explicit confirmation.
- Definition edits list every affected Robot Instance and block dangling Job, TCP, Frame, Attachment, and OPC UA references.
- Save, reload, export, and import preserve Mechanics provenance, calibration revision, Joint transforms, Geometry alignment, and selected TCP.
- Unsupported branched, cyclic, floating, planar, mimic, or unbounded continuous definitions fail with field-specific diagnostics and leave the active Project unchanged.
- The release gate passes lint, the complete unit/integration suite, production builds, and real-browser heterogeneous Robot acceptance.

## Self-review result

- Spec coverage: variable Joint location, axis, limits, fixed segments, one-file STEP, URDF, manual editing, preview, atomic apply, shared-definition impact, persistence, and browser verification are covered.
- Placeholder scan: the plan contains no deferred implementation placeholders; explicitly unsupported kinematics are rejection rules for this milestone.
- Type consistency: every adapter returns `RobotMechanicsDraftV1`; every runtime consumer receives canonical `RobotDefinitionV5`; fixed Joints exist only in the draft and never in runtime Joint-value records.
