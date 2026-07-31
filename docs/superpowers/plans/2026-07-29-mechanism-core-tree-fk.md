# Mechanism Core and Deterministic Tree FK Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Introduce a neutral in-memory Mechanism Core and deterministic branched Tree forward kinematics, then route current Project V5 Robot pose evaluation through one cached Browser-owned service without changing the closed Project V5 schema or its observable Robot, Job, viewport, and OPC UA behavior.

**Architecture:** Add a platform-independent `mechanism-runtime-v1` core containing immutable contracts, validation, a Tree Solver, a Solver Registry, and an Application Kinematics Service. Adapt each current serial `RobotDefinitionV5` into that canonical SI model, preserve `computeSerialRobotPoseV5()` as a compatibility wrapper, and let each Browser-owned runtime graph compile one Project-aware evaluator used by the Robot runtime store and the existing `WorldResolverV5` facade. Generalized persistence, Observation/ownership redesign, authoring, new collision UI, additional Solver families, and MCP implementation remain later slices.

**Tech Stack:** TypeScript 6.0.3, Vitest 4.1.10, Zustand 5.0.14, React 19.2.7, existing Project V5 rigid-transform utilities, Playwright 1.61.1, Node/tsx benchmark scripts.

## Global Constraints

- `WorkcellProjectV5`, its exact validator, stored limits, Project revision fencing, and atomic publication model remain unchanged.
- Slice 1 Mechanism, Twin Entity, Runtime Instance, and Robot Capability records are transient in-memory contracts only.
- Existing V5 Robot Definitions remain serial and keep their current 1–16 Joint and 2–17 Link limits.
- Common Mechanism limits are separately named: 128 Bodies, 127 total Tree Joints, and 64 movable Joints.
- Canonical Solver units are metres, radians, normalized quaternions, right-handed coordinates, and Z-up World.
- Preserve `qMechanical = direction * (qCommand + zeroOffset)` and `T_parent_child = T_origin * T_motion`.
- Every movable Joint requires one explicit coordinate; fixed Joints have no coordinate entry and no implicit home fallback is allowed.
- The Tree Solver is pure: no Browser store, time, network, OPC UA, geometry file, React, Three.js, DOM, Node runtime, or persistence access.
- Stable IDs, not array order or display names, determine topology and output ordering.
- Existing `computeSerialRobotPoseV5`, `RobotJointRuntimeStoreV5.readRobotPose`, and `WorldResolverV5` signatures remain available.
- GOOD OPC UA-mapped Base and exact mapped Tool/TCP Frame precedence remain unchanged.
- A Project candidate with invalid projected kinematics fails during `prepare()` before publication.
- The Runtime Gateway continues to project axis/status data only and does not perform FK.
- No external OPC UA, PLC, or Robot write is added or executed.
- No Legacy V4 dependency is introduced.
- No physics, dynamics, IK, Jacobian, constraint projection, generic Mechanism Job, generalized persistence, UI editor, asset conversion, Recorder, Replay, or Session storage is implemented.
- Humanoid/CNC viewport acceptance uses a test-mode-only transient harness; it
  adds no production menu, persisted sample, generalized Project record, or
  user-facing authoring flow.
- There is no V5 collision adapter today. Creating a new collision subsystem or UI is explicitly deferred; future collision code must consume a completed shared pose snapshot rather than invoke a Solver itself.
- CI verifies deterministic work and cache counts. The 4 ms warm p95 target is recorded by a separate reference-machine benchmark, not enforced as a flaky unit-test wall-clock assertion.
- Add a targeted test that demonstrably fails before each behavior change, then make the smallest implementation that passes it.
- Preserve unrelated worktree changes and stage only the files named by the active task.

---

## File Structure

### Create

- `src/core/mechanism-runtime-v1/types.ts`
- `src/core/mechanism-runtime-v1/limits.ts`
- `src/core/mechanism-runtime-v1/errors.ts`
- `src/core/mechanism-runtime-v1/validation-support.ts`
- `src/core/mechanism-runtime-v1/validate-tree-definition.ts`
- `src/core/mechanism-runtime-v1/tree-kinematics-solver.ts`
- `src/core/mechanism-runtime-v1/solver-registry.ts`
- `src/core/mechanism-runtime-v1/application-kinematics-service.ts`
- `src/core/mechanism-runtime-v1/test-support.ts`
- `src/core/mechanism-runtime-v1/index.ts`
- `src/core/mechanism-runtime-v1/contracts.test.ts`
- `src/core/mechanism-runtime-v1/validate-tree-definition.test.ts`
- `src/core/mechanism-runtime-v1/tree-kinematics-solver.test.ts`
- `src/core/mechanism-runtime-v1/solver-registry.test.ts`
- `src/core/mechanism-runtime-v1/application-kinematics-service.test.ts`
- `src/core/mechanism-runtime-v1/composed-mechanisms.test.ts`
- `src/core/mechanism-runtime-v1/core-boundary.test.ts`
- `src/core/mechanism-runtime-v1/fixtures/branched-humanoid.mechanism-v1.json`
- `src/core/mechanism-runtime-v1/fixtures/cnc-xyz.mechanism-v1.json`
- `src/core/robot-runtime-v5/robot-mechanism-adapter.ts`
- `src/core/robot-runtime-v5/robot-mechanism-adapter.test.ts`
- `src/core/robot-runtime-v5/serial-kinematics-compatibility.test.ts`
- `src/core/robot-runtime-v5/test-support.ts`
- `src/core/robot-runtime-v5/fixtures/serial-kinematics-golden-v5.json`
- `scripts/test-fixtures/generate-serial-kinematics-golden-v5.ts`
- `src/features/robot/v5/project-v5-robot-kinematics.ts`
- `src/features/robot/v5/project-v5-robot-kinematics.test.ts`
- `src/features/project/v5/kinematics-consumer-boundary.test.ts`
- `src/features/scene/v5/MechanismPoseLayerV1.tsx`
- `src/features/scene/v5/MechanismPoseLayerV1.test.tsx`
- `src/features/scene/v5/MechanismTreeViewportFixtureApp.tsx`
- `tests/mechanism-tree-viewport-fixtures.spec.ts`
- `scripts/performance/mechanism-tree-fk-benchmark.ts`
- `scripts/performance/mechanism-tree-fk-benchmark.test.ts`
- `docs/performance/mechanism-tree-fk-baseline.md`

### Modify

- `src/core/robot-runtime-v5/serial-kinematics.ts`
- `src/core/robot-runtime-v5/serial-kinematics.test.ts`
- `src/core/robot-runtime-v5/index.ts`
- `src/features/robot/v5/robot-joint-runtime-store.ts`
- `src/features/robot/v5/robot-joint-runtime-store.test.ts`
- `src/features/project/v5/browser-project-runtime-v5.ts`
- `src/features/project/v5/browser-project-runtime-v5.test.ts`
- `src/features/project/v5/browser-project-runtime-v5.candidate.test.ts`
- `src/features/jobs/v5/job-io.integration.test.ts`
- `src/features/actions/v5/browser-attachment-instruction-port.test.ts`
- `src/features/scene/v5/V5WorkcellWorkspace.test.tsx`
- `src/main.tsx`
- `package.json`

### Explicitly Do Not Modify

- `src/core/project-v5/types.ts`
- `src/core/project-v5/limits.ts`
- `src/core/project-v5/validate-shape.ts`
- `src/core/project-v5/validate-references.ts`
- `src/features/project/v5/browser-runtime-bundle-store-v5.ts`
- `middleware/runtime-gateway/**`
- `src/features/collision/v4/**`
- any V4 or Legacy Project/runtime file
- `.codex/config.toml`, `.mcp.json`, or MCP middleware in this Slice

---

## Public Contract Locked for Slice 1

The implementation may add private helpers, but it must keep the following public shapes and names consistent throughout the Slice.

```ts
// src/core/mechanism-runtime-v1/types.ts
import type { RigidTransformV5, Vector3V5 } from '../project-v5/rigid-transform.js'

export type RigidTransformV1 = RigidTransformV5
export type Vector3V1 = Vector3V5

// src/core/mechanism-runtime-v1/errors.ts
export type MechanismErrorCodeV1 =
  | 'SOLVER_REGISTRATION_DUPLICATE'
  | 'SOLVER_UNAVAILABLE'
  | 'SOLVER_CAPABILITY_UNAVAILABLE'
  | 'SOLVER_PARAMETERS_INVALID'
  | 'SOLVER_RESULT_INVALID'
  | 'TOPOLOGY_UNSUPPORTED'
  | 'MECHANISM_TOPOLOGY_INVALID'
  | 'MECHANISM_RESOURCE_LIMIT_EXCEEDED'
  | 'MECHANISM_ID_DUPLICATE'
  | 'MECHANISM_VALUE_INVALID'
  | 'BODY_NOT_FOUND'
  | 'FRAME_PARENT_NOT_FOUND'
  | 'FRAME_CYCLE'
  | 'FRAME_NOT_FOUND'
  | 'MOTION_GROUP_NOT_FOUND'
  | 'MOTION_GROUP_INVALID'
  | 'COORDINATE_SET_MISMATCH'
  | 'COORDINATE_VALUE_NOT_FINITE'
  | 'JOINT_LIMIT_INVALID'
  | 'JOINT_LIMIT_EXCEEDED'
  | 'JOINT_DIRECTION_INVALID'
  | 'JOINT_AXIS_NOT_NORMALIZABLE'
  | 'TRANSFORM_INVALID'
  | 'CONSTRAINT_UNSATISFIED'

export class MechanismErrorV1 extends Error {
  readonly code: MechanismErrorCodeV1
  readonly path: string
  readonly recovery?: string
  override readonly cause?: unknown

  constructor(
    code: MechanismErrorCodeV1,
    path: string,
    message: string,
    recovery?: string,
    cause?: unknown,
  ) {
    super(`${code} at ${path}: ${message}`)
    this.name = 'MechanismErrorV1'
    this.code = code
    this.path = path
    if (recovery !== undefined) this.recovery = recovery
    if (cause !== undefined) this.cause = cause
  }
}

export function failMechanismV1(
  code: MechanismErrorCodeV1,
  path: string,
  message: string,
  recovery?: string,
  cause?: unknown,
): never {
  throw new MechanismErrorV1(code, path, message, recovery, cause)
}

export type MechanismBodyIdV1 = string
export type MechanismJointIdV1 = string
export type MechanismFrameIdV1 = string
export type MechanismMotionGroupIdV1 = string

export interface MechanismBodyV1 {
  readonly bodyId: MechanismBodyIdV1
  readonly name: string
}

export type MechanismJointV1 =
  | {
      readonly jointId: MechanismJointIdV1
      readonly jointType: 'fixed'
      readonly parentBodyId: MechanismBodyIdV1
      readonly childBodyId: MechanismBodyIdV1
      readonly origin: RigidTransformV1
    }
  | {
      readonly jointId: MechanismJointIdV1
      readonly jointType: 'revolute' | 'prismatic'
      readonly parentBodyId: MechanismBodyIdV1
      readonly childBodyId: MechanismBodyIdV1
      readonly origin: RigidTransformV1
      readonly axis: Vector3V1
      readonly minimum: number
      readonly maximum: number
      readonly home: number
      readonly zeroOffset: number
      readonly direction: 1 | -1
      readonly maximumVelocity: number
    }

export type MechanismFrameParentV1 =
  | { readonly type: 'body'; readonly bodyId: MechanismBodyIdV1 }
  | { readonly type: 'frame'; readonly frameId: MechanismFrameIdV1 }

export interface MechanismFrameV1 {
  readonly frameId: MechanismFrameIdV1
  readonly name: string
  readonly role:
    | 'world'
    | 'mcp'
    | 'mount'
    | 'base'
    | 'flange'
    | 'tool0'
    | 'tool'
    | 'tcp'
    | 'gripper'
    | 'grasp'
    | 'placement'
    | 'work'
    | 'sensor'
    | 'custom'
  readonly parent: MechanismFrameParentV1
  readonly localPose: RigidTransformV1
}

export interface MechanismMotionGroupV1 {
  readonly motionGroupId: MechanismMotionGroupIdV1
  readonly name: string
  readonly coordinateJointIds: readonly MechanismJointIdV1[]
  readonly endFrameIds: readonly MechanismFrameIdV1[]
}

export type CanonicalJsonValueV1 =
  | null
  | boolean
  | number
  | string
  | readonly CanonicalJsonValueV1[]
  | CanonicalJsonObjectV1

export interface CanonicalJsonObjectV1 {
  readonly [key: string]: CanonicalJsonValueV1
}

export interface MechanismSolverReferenceV1 {
  readonly solverKey: string
  readonly contractVersion: string
  readonly parameters: CanonicalJsonObjectV1
  readonly normalizedParametersHash: string
}

export interface MechanismDefinitionV1 {
  readonly mechanismId: string
  readonly name: string
  readonly topologyKind: 'tree' | 'free-body' | 'parallel'
  readonly solverRef: MechanismSolverReferenceV1
  readonly bodies: readonly MechanismBodyV1[]
  readonly joints: readonly MechanismJointV1[]
  readonly frames: readonly MechanismFrameV1[]
  readonly motionGroups: readonly MechanismMotionGroupV1[]
  readonly constraints: readonly MechanismLoopClosureConstraintV1[]
  readonly geometryBindings: readonly MechanismGeometryBindingV1[]
  readonly sourceProvenance: MechanismSourceProvenanceV1
}

export interface MechanismLoopClosureConstraintV1 {
  readonly constraintId: string
  readonly constraintType: 'loop-closure'
  readonly parentFrameId: MechanismFrameIdV1
  readonly childFrameId: MechanismFrameIdV1
  readonly targetPose: RigidTransformV1
}

export interface MechanismGeometryBindingV1 {
  readonly geometryBindingId: string
  readonly bodyId: MechanismBodyIdV1
  readonly assetReferenceId: string
  readonly occurrenceKey: string
  readonly bodyLocalPose: RigidTransformV1
}

export interface MechanismSourceProvenanceV1 {
  readonly sourceKind: 'project-v5-robot' | 'mechanism-manifest' | 'urdf' | 'manual' | 'fixture'
  readonly sourceDetail: string
  readonly sourceName: string
  readonly sourceRevision: string
  readonly adapterKey: string | null
  readonly adapterVersion: string | null
}

export interface TwinEntityAssetBindingV1 {
  readonly assetBindingId: string
  readonly assetReferenceId: string
  readonly mechanismGeometryBindingId: string | null
}

export interface TwinEntityDefinitionV1 {
  readonly entityId: string
  readonly displayName: string
  readonly manufacturer: string
  readonly model: string
  readonly definitionRevision: string
  readonly assetBindings: readonly TwinEntityAssetBindingV1[]
  readonly mechanismDefinitionId: string | null
  readonly capabilityIds: readonly string[]
}

export interface MechanismRuntimeInstanceV1 {
  readonly instanceId: string
  readonly definitionId: string
  readonly parentFrameId: string
  readonly localPose: RigidTransformV1
  readonly activeToolFrameId: MechanismFrameIdV1 | null
  readonly activeTcpFrameId: MechanismFrameIdV1 | null
  readonly visible: boolean
  readonly declaredValueOwners: {
    readonly coordinates: 'manual' | 'simulation' | `opcua:${string}`
    readonly frames: Readonly<Record<string, 'manual' | 'simulation' | `opcua:${string}`>>
  }
}

export interface RobotHomeCoordinateSetV1 {
  readonly coordinateSetId: string
  readonly name: string
  readonly coordinatesByStableId: Readonly<Record<string, number>>
}

export interface RobotCapabilityV1 {
  readonly robotCapabilityId: string
  readonly mechanismId: string
  readonly motionGroupIds: readonly MechanismMotionGroupIdV1[]
  readonly baseFrameId: MechanismFrameIdV1 | null
  readonly flangeFrameIds: readonly MechanismFrameIdV1[]
  readonly toolFrameIds: readonly MechanismFrameIdV1[]
  readonly tcpFrameIds: readonly MechanismFrameIdV1[]
  readonly homeCoordinateSets: readonly RobotHomeCoordinateSetV1[]
  readonly robotStatusSemantics: {
    readonly numericStatusSupported: boolean
    readonly motionStateSupported: boolean
    readonly safetyStateSupported: boolean
  }
  readonly roboticsOpcUaView: {
    readonly axisJointIds: readonly MechanismJointIdV1[]
    readonly baseFrameId: MechanismFrameIdV1 | null
    readonly flangeFrameIds: readonly MechanismFrameIdV1[]
    readonly toolFrameIds: readonly MechanismFrameIdV1[]
    readonly tcpFrameIds: readonly MechanismFrameIdV1[]
  }
}

export interface ForwardKinematicsRequestV1 {
  readonly mechanismDefinition: MechanismDefinitionV1
  readonly rootWorldPose: RigidTransformV1
  readonly coordinatesByStableId: Readonly<Record<string, number>>
  readonly requestedFrameIds?: readonly string[]
  readonly requestedMotionGroupId?: string
}

export interface ForwardKinematicsResultV1 {
  readonly solverKey: string
  readonly solverContractVersion: string
  readonly normalizedCoordinates: Readonly<Record<string, number>>
  readonly bodyLocalPoses: Readonly<Record<string, RigidTransformV1>>
  readonly bodyWorldPoses: Readonly<Record<string, RigidTransformV1>>
  readonly frameWorldPoses: Readonly<Record<string, RigidTransformV1>>
  readonly motionGroupEndFramePoses: Readonly<Record<string, Readonly<Record<string, RigidTransformV1>>>>
  readonly warnings: readonly KinematicsWarningV1[]
}

export interface ValidationFindingV1 {
  readonly code: string
  readonly path: string
  readonly message: string
  readonly recovery?: string
}

export interface KinematicsWarningV1 {
  readonly code: string
  readonly path: string
  readonly message: string
}

export interface ValidationReportV1 {
  readonly valid: boolean
  readonly errors: readonly ValidationFindingV1[]
  readonly warnings: readonly ValidationFindingV1[]
}

export interface SolverCapabilitiesV1 {
  readonly topologyKinds: readonly ('tree' | 'free-body' | 'parallel')[]
  readonly jointTypes: readonly ('fixed' | 'revolute' | 'prismatic')[]
  readonly deterministicForward: true
  readonly inverse: boolean
  readonly jacobian: boolean
  readonly constraintProjection: boolean
}

export interface SolverDescriptorV1 {
  readonly solverKey: string
  readonly contractVersion: string
  readonly capabilities: SolverCapabilitiesV1
}

export interface InverseKinematicsRequestV1 {
  readonly mechanismDefinition: MechanismDefinitionV1
  readonly rootWorldPose: RigidTransformV1
  readonly seedCoordinatesByStableId: Readonly<Record<string, number>>
  readonly targetFrameId: MechanismFrameIdV1
  readonly targetWorldPose: RigidTransformV1
}

export interface InverseKinematicsResultV1 {
  readonly coordinatesByStableId: Readonly<Record<string, number>>
  readonly warnings: readonly KinematicsWarningV1[]
}

export interface JacobianRequestV1 {
  readonly mechanismDefinition: MechanismDefinitionV1
  readonly coordinatesByStableId: Readonly<Record<string, number>>
  readonly frameId: MechanismFrameIdV1
}

export interface JacobianResultV1 {
  readonly rows: readonly (readonly number[])[]
  readonly coordinateJointIds: readonly MechanismJointIdV1[]
}

export interface ConstraintProjectionRequestV1 {
  readonly mechanismDefinition: MechanismDefinitionV1
  readonly coordinatesByStableId: Readonly<Record<string, number>>
}

export interface ConstraintProjectionResultV1 {
  readonly coordinatesByStableId: Readonly<Record<string, number>>
  readonly warnings: readonly KinematicsWarningV1[]
}

export interface KinematicsSolverV1 {
  readonly solverKey: string
  readonly contractVersion: string
  describeCapabilities(): SolverCapabilitiesV1
  validateDefinition(definition: MechanismDefinitionV1): ValidationReportV1
  normalizeCoordinates(
    definition: MechanismDefinitionV1,
    coordinates: Readonly<Record<string, number>>,
  ): Readonly<Record<string, number>>
  evaluateForward(request: ForwardKinematicsRequestV1): ForwardKinematicsResultV1
  solveInverse?(request: InverseKinematicsRequestV1): InverseKinematicsResultV1
  evaluateJacobian?(request: JacobianRequestV1): JacobianResultV1
  projectConstraints?(
    request: ConstraintProjectionRequestV1,
  ): ConstraintProjectionResultV1
}
```

The V1 aliases keep the neutral public vocabulary while reusing the already
verified V5 tuple layout and composition math in Slice 1. Moving those spatial
primitives into a separately versioned neutral math package is deferred; the
implementation must not copy the quaternion/transform algorithm.

`RobotCapabilityV1.baseFrameId` is nullable because a valid current V5 Robot
Definition is not required to declare a role=`base` Frame; the Runtime
Instance's parent and local pose still define the Solver root. The adapter never
invents a Base Frame merely to fill this field.

Tree Solver v1 accepts only `topologyKind: 'tree'`, rejects `free-body` or
`parallel`, and rejects a non-empty `constraints` array with
`TOPOLOGY_UNSUPPORTED`; it does not implement loop closure.

`CanonicalJsonObjectV1` is a recursive closed JSON value type containing only
null, booleans, finite numbers, strings, arrays, and plain string-keyed objects.
Functions, `undefined`, symbols, non-finite numbers, accessors, custom
prototypes, and sparse arrays are rejected before a Solver sees parameters.

```ts
// src/core/mechanism-runtime-v1/application-kinematics-service.ts
export interface CompiledMechanismEvaluatorV1 {
  readonly definition: MechanismDefinitionV1
  readonly solverKey: string
  readonly solverContractVersion: string
  readonly normalizedSolverParametersHash: string
  evaluateForward(
    request: Omit<ForwardKinematicsRequestV1, 'mechanismDefinition'>,
  ): ForwardKinematicsResultV1
}

export interface ApplicationKinematicsServiceV1 {
  compile(definition: MechanismDefinitionV1): CompiledMechanismEvaluatorV1
}
```

```ts
// src/features/robot/v5/project-v5-robot-kinematics.ts
export interface RobotPoseEvaluationRequestV5 {
  readonly robotId: string
  readonly coordinateRevision: number
  readonly jointValues: Readonly<Record<string, number>>
  readonly rootWorldPose: RigidTransformV5
}

export interface RobotPoseEvaluationIdentityV5 {
  readonly projectId: string
  readonly projectRevisionId: string
  readonly configRevision: string
  readonly adapterKey: 'open-digital-twin/project-v5-robot'
  readonly adapterVersion: '1'
  readonly solverKey: string
  readonly solverContractVersion: string
  readonly normalizedSolverParametersHash: string
}

export interface EvaluatedSerialRobotPoseV5 {
  readonly identity: RobotPoseEvaluationIdentityV5
  readonly pose: SerialRobotPoseV5
}

export interface CompiledProjectRobotKinematicsV5 {
  evaluateRobot(request: RobotPoseEvaluationRequestV5): EvaluatedSerialRobotPoseV5
}

export interface ProjectRobotKinematicsFactoryV5 {
  compileProject(
    project: WorkcellProjectV5,
    configRevision: string,
  ): CompiledProjectRobotKinematicsV5
}
```

The feature-level cache contains at most one entry per current Robot Instance.
Its key is the compiled Project identity plus `robotId`, `coordinateRevision`,
the complete stable-Joint-order canonical coordinate tuple, all seven normalized
root-pose numbers, adapter version, Solver key/version, and normalized
parameters hash. `coordinateRevision` is evidence, not a substitute for value
equality: the evaluator rejects neither a valid standalone caller nor returns a
stale result when the same revision is paired with different Joint values.
Project replacement creates a new compiled evaluator, so an old cache entry can
never cross Project revisions.

---

## Task 1: Add Neutral Contracts, Errors, Limits, and the Core Boundary

**Files:**
- Create: `src/core/mechanism-runtime-v1/types.ts`
- Create: `src/core/mechanism-runtime-v1/limits.ts`
- Create: `src/core/mechanism-runtime-v1/errors.ts`
- Create: `src/core/mechanism-runtime-v1/validation-support.ts`
- Create: `src/core/mechanism-runtime-v1/contracts.test.ts`
- Create: `src/core/mechanism-runtime-v1/core-boundary.test.ts`

- [ ] **Step 1: Write failing limit and error tests**

```ts
expect(MAX_MECHANISM_BODIES_V1).toBe(128)
expect(MAX_MECHANISM_TREE_JOINTS_V1).toBe(127)
expect(MAX_MECHANISM_MOVABLE_JOINTS_V1).toBe(64)
expect(capture(() => failMechanismV1(
  'BODY_NOT_FOUND',
  '$.joints[0].parentBodyId',
  'Body base is missing.',
  'Add the referenced Body.',
))).toMatchObject({
  name: 'MechanismErrorV1',
  code: 'BODY_NOT_FOUND',
  path: '$.joints[0].parentBodyId',
  recovery: 'Add the referenced Body.',
})
```

- [ ] **Step 2: Run the limit/error test and confirm failure**

```powershell
npm run test:run -- src/core/mechanism-runtime-v1/contracts.test.ts
```

Expected: FAIL because `mechanism-runtime-v1` does not exist.

- [ ] **Step 3: Implement limits and `MechanismErrorV1`**

Add:

```ts
export const MAX_MECHANISM_BODIES_V1 = 128
export const MAX_MECHANISM_TREE_JOINTS_V1 = 127
export const MAX_MECHANISM_MOVABLE_JOINTS_V1 = 64
export const EMPTY_SOLVER_PARAMETERS_SHA256_V1 =
  '44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a'
```

Do not import or alias `MAX_ROBOT_JOINTS_V5` or `MAX_ROBOT_LINKS_V5`.

- [ ] **Step 4: Add compile-time contract fixtures**

In `contracts.test.ts`, declare values using `satisfies` for every closed
contract in the Public Contract section: fixed/revolute/prismatic Joint, typed
Frame parent, Twin Entity, Runtime Instance with declared owners, Robot
Capability with nullable Base, loop closure, geometry binding, provenance,
Solver reference, request, and result. Do not use `as unknown as`.

- [ ] **Step 5: Write failing strict-value inspection tests**

Test canonical parameter and record helpers directly from
`validation-support.ts` for detached nested data, accessor avoidance, hostile
keys, custom prototypes, symbols, sparse arrays, non-finite numbers, and frozen
null-prototype output.

Lock these module-local-support exports:

```ts
export function inspectCanonicalJsonObjectV1(
  value: unknown,
  path: string,
): CanonicalJsonObjectV1

export function frozenNullPrototypeRecordV1<T>(
  entries: readonly (readonly [string, T])[],
): Readonly<Record<string, T>>

export function normalizeMechanismRigidTransformV1(
  value: RigidTransformV1,
  path: string,
): RigidTransformV1
```

- [ ] **Step 6: Run the strict-value tests and confirm failure**

```powershell
npm run test:run -- src/core/mechanism-runtime-v1/contracts.test.ts
```

Expected: FAIL because the validation helpers are missing.

- [ ] **Step 7: Implement reusable strict-value inspection**

`validation-support.ts` must:

- inspect own property descriptors without invoking accessors;
- reject custom prototypes, symbols, non-enumerable values, sparse arrays, non-finite numbers, and unknown keys;
- safely retain IDs named `__proto__` and `constructor`;
- create frozen null-prototype output records;
- clone and normalize rigid transforms through the existing Project V5 math utility;
- translate every Project V5 math error into `MechanismErrorV1` with
  `TRANSFORM_INVALID`, the common caller path, and the original error retained
  only as `cause`;
- never mutate caller input.

- [ ] **Step 8: Run the contract tests**

```powershell
npm run test:run -- src/core/mechanism-runtime-v1/contracts.test.ts
```

Expected: PASS.

- [ ] **Step 9: Write and run the core-boundary test**

The scanner covers every production `.ts` file in the new directory, excludes
tests and `test-support.ts`, and rejects bare imports or identifiers for DOM,
React, Three.js, Zustand, OPC UA, Browser storage, Node, Worker, network, or V4.
The only permitted dependency outside the directory is
`../project-v5/rigid-transform.js`. Include one synthetic violating module to
prove each rule fires.

```powershell
npm run test:run -- src/core/mechanism-runtime-v1/core-boundary.test.ts
```

Expected: PASS.

- [ ] **Step 10: Commit the neutral foundation**

```powershell
git add -- src/core/mechanism-runtime-v1
git commit -m "feat: add neutral mechanism runtime contracts"
```

---

## Task 2: Compile and Validate Deterministic Tree Topology

**Files:**
- Create: `src/core/mechanism-runtime-v1/validate-tree-definition.ts`
- Create: `src/core/mechanism-runtime-v1/validate-tree-definition.test.ts`
- Create: `src/core/mechanism-runtime-v1/test-support.ts`

Tree validation locks this public first-error contract before implementation:

| Invalid condition | Code | Path |
| --- | --- | --- |
| non-closed record, bad scalar, unsupported role/type | `MECHANISM_VALUE_INVALID` | exact offending property |
| Body count outside `1..128` | `MECHANISM_RESOURCE_LIMIT_EXCEEDED` | `$.bodies` |
| total Joint count above 127 | `MECHANISM_RESOURCE_LIMIT_EXCEEDED` | `$.joints` |
| movable Joint count above 64 | `MECHANISM_RESOURCE_LIMIT_EXCEEDED` | `$.joints` |
| duplicate Body ID | `MECHANISM_ID_DUPLICATE` | `$.bodies[i].bodyId` |
| duplicate Joint ID | `MECHANISM_ID_DUPLICATE` | `$.joints[i].jointId` |
| duplicate Frame ID | `MECHANISM_ID_DUPLICATE` | `$.frames[i].frameId` |
| missing parent/child Body | `BODY_NOT_FOUND` | `$.joints[i].parentBodyId` or `.childBodyId` |
| self-edge or second incoming Joint | `MECHANISM_TOPOLOGY_INVALID` | `$.joints[i]` |
| zero/multiple root, disconnected graph, Body cycle | `MECHANISM_TOPOLOGY_INVALID` | `$.joints` |
| zero or non-finite movable axis | `JOINT_AXIS_NOT_NORMALIZABLE` | `$.joints[i].axis` |
| non-finite/unordered limits, home outside limits, non-positive velocity | `JOINT_LIMIT_INVALID` | exact `$.joints[i]` property; unordered/home uses `$.joints[i]` |
| direction other than `1` or `-1` | `JOINT_DIRECTION_INVALID` | `$.joints[i].direction` |
| missing Frame parent | `FRAME_PARENT_NOT_FOUND` | `$.frames[i].parent` |
| Frame parent cycle | `FRAME_CYCLE` | `$.frames` |
| non-Tree topology or non-empty constraints | `TOPOLOGY_UNSUPPORTED` | `$.topologyKind` or `$.constraints` |
| Motion Group missing/fixed Joint | `MOTION_GROUP_INVALID` | `$.motionGroups[i].coordinateJointIds[j]` |
| duplicate Motion Group coordinate/end Frame | `MOTION_GROUP_INVALID` | exact duplicate array element |
| Motion Group missing end Frame | `FRAME_NOT_FOUND` | `$.motionGroups[i].endFrameIds[j]` |
| wrong Tree Solver key/version | `SOLVER_UNAVAILABLE` | `$.solverRef.solverKey` or `.contractVersion` |
| non-empty Tree parameters or wrong parameter hash | `SOLVER_PARAMETERS_INVALID` | `$.solverRef.parameters` or `.normalizedParametersHash` |

Validation walks caller arrays in their original order and throws the first
finding in the table order within each record; canonical sorting begins only
after every check succeeds.

- [ ] **Step 1: Add deterministic valid-Tree builders**

Build deterministic fixtures for:

- one revolute Joint;
- fixed/revolute/prismatic mixed Tree;
- a branched Humanoid-like Tree;
- a three-axis prismatic CNC;
- a 128-Body Tree with 127 total Joints, exactly 64 movable and 63 fixed;
- nested Body/Frame references.

- [ ] **Step 2: Write the first failing valid-topology test**

```ts
const compiled = compileTreeMechanismDefinitionV1(makeBranchedMechanismV1())
expect(compiled.rootBodyId).toBe('base')
expect(compiled.traversal.map(({ jointId }) => jointId)).toEqual([
  'head-yaw', 'left-shoulder', 'left-elbow', 'right-shoulder', 'right-elbow',
])
expect(compiled.movableJointIds).toEqual([
  'head-yaw', 'left-elbow', 'left-shoulder', 'right-elbow', 'right-shoulder',
])
```

- [ ] **Step 3: Run the valid-topology test and confirm failure**

```powershell
npm run test:run -- src/core/mechanism-runtime-v1/validate-tree-definition.test.ts
```

Expected: FAIL because `compileTreeMechanismDefinitionV1` does not exist.

- [ ] **Step 4: Implement canonical copy and connected Tree traversal**

Expose:

```ts
export interface CompiledTreeMechanismV1 {
  readonly definition: MechanismDefinitionV1
  readonly rootBodyId: string
  readonly movableJointIds: readonly string[]
  readonly traversal: readonly {
    readonly jointId: string
    readonly parentBodyId: string
    readonly childBodyId: string
  }[]
}

export function compileTreeMechanismDefinitionV1(
  definition: MechanismDefinitionV1,
): CompiledTreeMechanismV1
```

For this step, implement detached normalization, one-root discovery, connected
acyclic traversal, stable-ID tie sorting, fixed-Joint retention, and frozen
compiled output.

- [ ] **Step 5: Run the valid-topology test**

```powershell
npm run test:run -- src/core/mechanism-runtime-v1/validate-tree-definition.test.ts
```

Expected: PASS for the valid fixtures.

- [ ] **Step 6: Add failing resource and Body-graph rejection tests**

Reject with exact code/path:

- zero or more than 128 Bodies;
- more than 127 total Joints;
- more than 64 movable Joints;
- duplicate IDs within the Body, Joint, or Frame typed namespace;
- missing parent or child Body;
- self-edge, multiple roots, multiple incoming Joints, disconnected Body, and Body cycle;
- zero/non-finite axes, invalid limits, home outside limits, invalid direction, and non-positive velocity;

- [ ] **Step 7: Run and confirm the new rejection cases fail**

```powershell
npm run test:run -- src/core/mechanism-runtime-v1/validate-tree-definition.test.ts
```

Expected: FAIL on the first unimplemented resource/graph validation.

- [ ] **Step 8: Implement resource, identity, Body, axis, and limit validation**

Use the stable common error-code union. Error paths refer to the caller's
original array index; canonical sorting occurs only after validation succeeds.

- [ ] **Step 9: Run the resource and Body-graph cases**

```powershell
npm run test:run -- src/core/mechanism-runtime-v1/validate-tree-definition.test.ts
```

Expected: PASS for valid and Body-graph cases.

- [ ] **Step 10: Add failing Frame, Motion Group, Solver, and constraint tests**

Cover:

- missing or cyclic Frame parents;
- `free-body` or `parallel` topology passed to Tree Solver v1;
- Motion Group reference to a fixed/missing Joint or missing end Frame;
- duplicate coordinate/end-frame membership inside a Motion Group;
- non-empty constraints for the Tree Solver;
- mismatched Tree Solver key/version/parameter set/hash.

- [ ] **Step 11: Run and confirm the new reference cases fail**

```powershell
npm run test:run -- src/core/mechanism-runtime-v1/validate-tree-definition.test.ts
```

Expected: FAIL on the first unimplemented Frame/Group/Solver validation.

- [ ] **Step 12: Implement Frame, Group, Solver, and constraint validation**

- [ ] **Step 13: Add deterministic-order and hostile-key tests**

Compile the same Tree under 100 seeded shuffles of Body, Joint, Frame, and
Motion Group arrays and compare canonical traversal/output metadata. Build one
fixture using Body/Joint/Frame IDs `__proto__` and `constructor`; prove typed
namespaces coexist, no prototype pollution occurs, and no entry disappears.

- [ ] **Step 14: Run the complete topology suite**

```powershell
npm run test:run -- src/core/mechanism-runtime-v1/validate-tree-definition.test.ts
```

Expected: PASS.

- [ ] **Step 15: Commit topology validation**

```powershell
git add -- src/core/mechanism-runtime-v1/validate-tree-definition.ts src/core/mechanism-runtime-v1/validate-tree-definition.test.ts src/core/mechanism-runtime-v1/test-support.ts
git commit -m "feat: validate deterministic tree mechanisms"
```

---

## Task 3: Implement Canonical Tree Forward Kinematics

**Files:**
- Create: `src/core/mechanism-runtime-v1/tree-kinematics-solver.ts`
- Create: `src/core/mechanism-runtime-v1/tree-kinematics-solver.test.ts`

Runtime request validation locks these codes and paths:

| Invalid condition | Code | Path |
| --- | --- | --- |
| non-plain/accessor/symbol coordinate record | `MECHANISM_VALUE_INVALID` | `$.coordinatesByStableId` |
| missing, extra, or fixed-Joint coordinate key | `COORDINATE_SET_MISMATCH` | `$.coordinatesByStableId` |
| non-finite coordinate | `COORDINATE_VALUE_NOT_FINITE` | `$.coordinatesByStableId.<jointId>` |
| command outside Joint limits | `JOINT_LIMIT_EXCEEDED` | `$.coordinatesByStableId.<jointId>` |
| invalid root transform | `TRANSFORM_INVALID` | `$.rootWorldPose` |
| unknown requested Frame | `FRAME_NOT_FOUND` | `$.requestedFrameIds[i]` |
| unknown requested Motion Group | `MOTION_GROUP_NOT_FOUND` | `$.requestedMotionGroupId` |

- [ ] **Step 1: Write failing coordinate-normalization tests**

Prove:

- one explicit coordinate is required for every movable Joint;
- fixed Joint IDs are rejected as coordinate keys;
- extra, missing, accessor, symbol, hidden, custom-prototype, and non-finite entries fail closed;
- home values are not inserted implicitly;
- revolute coordinates and offsets are radians;
- prismatic coordinates and offsets are metres;
- limits apply to commanded coordinates before direction/offset conversion, matching V5 behavior;
- normalized output is a frozen null-prototype record sorted by stable Joint ID.

- [ ] **Step 2: Write failing FK tests**

Cover:

- identity and non-identity root World poses;
- rotated Joint origins that distinguish `origin * motion` from `motion * origin`;
- `direction = -1` with non-zero `zeroOffset`;
- normalized non-unit axes;
- fixed/revolute/prismatic mixed chains;
- a Parent Body with two independently moving children;
- nested Frames;
- selected Frame and Motion Group output filtering without omitting coordinates needed elsewhere;
- identical outputs for shuffled input arrays;
- input immutability and deeply frozen output;
- finite normalized quaternions and canonical negative zero handling.

```ts
const result = solver.evaluateForward({
  mechanismDefinition: makeBranchedMechanismV1(),
  rootWorldPose: translatedAndRotatedRoot,
  coordinatesByStableId: {
    'head-yaw': Math.PI / 4,
    'left-shoulder': Math.PI / 6,
    'left-elbow': -Math.PI / 3,
    'right-shoulder': -Math.PI / 6,
    'right-elbow': Math.PI / 3,
  },
})
expect(result.bodyWorldPoses['left-hand']).not.toEqual(result.bodyWorldPoses['right-hand'])
```

- [ ] **Step 3: Run the test and confirm failure**

```powershell
npm run test:run -- src/core/mechanism-runtime-v1/tree-kinematics-solver.test.ts
```

Expected: FAIL because the Tree Solver does not exist.

- [ ] **Step 4: Implement `createTreeKinematicsSolverV1()`**

Export:

```ts
export const TREE_KINEMATICS_SOLVER_KEY_V1 = 'open-digital-twin/tree-fk'
export const TREE_KINEMATICS_SOLVER_CONTRACT_VERSION_V1 = '1'
export function createTreeKinematicsSolverV1(): KinematicsSolverV1
```

Required math:

```ts
const qMechanical = joint.direction * (qCommand + joint.zeroOffset)
const childLocal = composeRigidTransformV5(joint.origin, jointMotion)
const childWorld = composeRigidTransformV5(parentWorld, childLocal)
```

The Application Service passes one deeply frozen canonical Definition object to
both `validateDefinition()` and `evaluateForward()`. The Tree Solver may cache a
compiled traversal in a private `WeakMap` only for such frozen Definition
objects. A direct call with a mutable Definition must be revalidated and
recompiled, so caller mutation can never make a cached traversal stale.

- [ ] **Step 5: Validate and canonicalize result maps**

Return:

- root Body local pose as identity;
- root Body World pose as the normalized request root;
- every child Body local and World pose;
- every Frame World pose;
- only requested Frame entries when `requestedFrameIds` is present;
- only the requested Motion Group entry when `requestedMotionGroupId` is present;
- all normalized coordinates regardless of output filtering;
- empty frozen warnings for the first Solver.

- [ ] **Step 6: Run the targeted tests**

```powershell
npm run test:run -- src/core/mechanism-runtime-v1/validate-tree-definition.test.ts src/core/mechanism-runtime-v1/tree-kinematics-solver.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit Tree FK**

```powershell
git add -- src/core/mechanism-runtime-v1/tree-kinematics-solver.ts src/core/mechanism-runtime-v1/tree-kinematics-solver.test.ts
git commit -m "feat: implement deterministic tree forward kinematics"
```

---

## Task 4: Add the Solver Registry and Application Service

**Files:**
- Create: `src/core/mechanism-runtime-v1/solver-registry.ts`
- Create: `src/core/mechanism-runtime-v1/solver-registry.test.ts`
- Create: `src/core/mechanism-runtime-v1/application-kinematics-service.ts`
- Create: `src/core/mechanism-runtime-v1/application-kinematics-service.test.ts`
- Create: `src/core/mechanism-runtime-v1/index.ts`

- [ ] **Step 1: Write failing Registry tests**

Prove:

- exact `(solverKey, contractVersion)` lookup;
- duplicate registration fails with `SOLVER_REGISTRATION_DUPLICATE`;
- unavailable key/version fails with `SOLVER_UNAVAILABLE`;
- no fallback to another key or version;
- registration order does not affect discovery order;
- `describeCapabilities()` reports deterministic FK as required and IK/Jacobian/constraint projection as unavailable.

- [ ] **Step 2: Run the Registry test and confirm failure**

```powershell
npm run test:run -- src/core/mechanism-runtime-v1/solver-registry.test.ts
```

Expected: FAIL because the Registry does not exist.

- [ ] **Step 3: Implement immutable Registry creation**

```ts
export interface SolverRegistryV1 {
  readonly list: () => readonly SolverDescriptorV1[]
  readonly require: (solverKey: string, contractVersion: string) => KinematicsSolverV1
}

export function createSolverRegistryV1(
  solvers: readonly KinematicsSolverV1[],
): SolverRegistryV1
```

- [ ] **Step 4: Run Registry tests after implementation**

```powershell
npm run test:run -- src/core/mechanism-runtime-v1/solver-registry.test.ts
```

Expected: PASS.

- [ ] **Step 5: Write failing Application Service compile tests**

Use a spy Solver to prove:

- `compile()` resolves the exact Solver and validates once;
- invalid Definition reports its stable first error;
- repeated evaluation uses the same canonical Definition;
- complete coordinate normalization occurs before forward evaluation;
- returned Solver key/version/hash match the compiled Definition;
- optional unsupported operations are not invented or silently delegated.

- [ ] **Step 6: Run the compile test and confirm failure**

```powershell
npm run test:run -- src/core/mechanism-runtime-v1/application-kinematics-service.test.ts
```

Expected: FAIL because `createApplicationKinematicsServiceV1` does not exist.

- [ ] **Step 7: Implement compile and exact Solver invocation**

Export:

```ts
export function createApplicationKinematicsServiceV1(
  registry: SolverRegistryV1,
): ApplicationKinematicsServiceV1

export function createDefaultApplicationKinematicsServiceV1():
  ApplicationKinematicsServiceV1
```

The default service registers only Tree FK v1. `compile()` deep-clones and
freezes the Definition, resolves the exact key/version, calls validation once,
and returns an immutable evaluator.

- [ ] **Step 8: Run Application Service compile tests**

```powershell
npm run test:run -- src/core/mechanism-runtime-v1/application-kinematics-service.test.ts
```

Expected: PASS for compile/invocation behavior.

- [ ] **Step 9: Add failing malicious-result tests**

Use one malicious Solver variant per case. Wrong, missing, extra, mutable,
non-finite, non-normalized, or foreign Body/Frame/coordinate result fields must
fail with `SOLVER_RESULT_INVALID`. Requested Frame/Motion Group filtering must
still be accepted when it exactly matches the request.

- [ ] **Step 10: Run and confirm result validation fails**

```powershell
npm run test:run -- src/core/mechanism-runtime-v1/application-kinematics-service.test.ts
```

Expected: FAIL on the first unimplemented malicious result.

- [ ] **Step 11: Implement canonical result validation**

Validate and detach every result record before exposing it. Validate Solver
identity, exact coordinate set, expected Body sets, requested Frame/Group sets,
finite normalized transforms, warning records, null prototypes, and deep
freezing. Never repair a malformed Solver result silently.

- [ ] **Step 12: Export only the intended common surface**

`index.ts` exports contracts, limits, errors, Registry, service, Tree Solver, and validation APIs. It does not export private record-building or traversal mutation helpers.

- [ ] **Step 13: Run the complete neutral-core suite**

```powershell
npm run test:run -- src/core/mechanism-runtime-v1
```

Expected: PASS.

- [ ] **Step 14: Commit the shared service**

```powershell
git add -- src/core/mechanism-runtime-v1
git commit -m "feat: add versioned kinematics service"
```

---

## Task 5: Characterize Existing V5 Serial FK Before Refactoring

**Files:**
- Create: `src/core/robot-runtime-v5/test-support.ts`
- Create: `src/core/robot-runtime-v5/fixtures/serial-kinematics-golden-v5.json`
- Create: `src/core/robot-runtime-v5/serial-kinematics-compatibility.test.ts`
- Create: `scripts/test-fixtures/generate-serial-kinematics-golden-v5.ts`
- Modify: `src/core/robot-runtime-v5/serial-kinematics.test.ts`

- [ ] **Step 1: Add deterministic named case builders**

`test-support.ts` exports `buildSerialKinematicsSuccessCaseV5(caseId)` and
`buildSerialKinematicsErrorCaseV5(caseId)`. Both accept only a closed case ID
union and return fresh detached inputs. Success case IDs cover:

- the minimal one-axis V5 Robot;
- non-identity Robot base pose;
- rotated Joint origin;
- reverse direction and non-zero offset;
- one prismatic serial Robot;
- nested Frames;
- the checked-in `two-offset-six-axis.robot.json`;
- a test-only V5 NED2 Definition derived from `public/models/robot/ned2/manifest.json` with explicit V5 mechanics metadata.

For the NED2 fixture, include home, mid-range, and limit-adjacent coordinates. The test-only conversion must not become a Project V5 migration or production V4 dependency.

- [ ] **Step 2: Add the one-time pre-refactor generator**

The generator accepts exactly:

```text
--write
--source-commit <40-hex-commit>
```

It must:

- refuse to write unless the current `serial-kinematics.ts` lacks an import from `mechanism-runtime-v1`;
- verify the supplied commit equals `git rev-parse HEAD`;
- evaluate every named success and error case in stable case-ID order;
- emit canonical two-space JSON plus one trailing newline;
- write schema:

```ts
interface SerialKinematicsGoldenV5 {
  readonly schemaVersion: 1
  readonly sourceCommit: string
  readonly successCases: readonly {
    readonly caseId: SerialKinematicsSuccessCaseIdV5
    readonly expected: SerialRobotPoseV5
  }[]
  readonly errorCases: readonly {
    readonly caseId: SerialKinematicsErrorCaseIdV5
    readonly expected: {
      readonly name: 'ProjectV5Error'
      readonly code: string
      readonly path: string
      readonly message: string
      readonly recovery: string | null
    }
  }[]
}
```

Error case IDs must cover Joint count, Link count, duplicate Link/Joint/Frame
identity, missing Link, branch/cycle, missing/cyclic Frame parent, exact Joint
key set, hostile records, non-finite command, invalid limits, out-of-range
command, invalid offset, direction, axis, unsupported Joint type, non-finite
root position, and non-normalizable root quaternion.

- [ ] **Step 3: Run the generator before changing `serial-kinematics.ts`**

```powershell
$sourceCommit = git rev-parse HEAD
npx tsx scripts/test-fixtures/generate-serial-kinematics-golden-v5.ts --write --source-commit $sourceCommit
```

Expected: one deterministic fixture whose `sourceCommit` is the current
pre-refactor commit.

- [ ] **Step 4: Prove generation is byte-stable**

```powershell
$before = (Get-FileHash -Algorithm SHA256 src/core/robot-runtime-v5/fixtures/serial-kinematics-golden-v5.json).Hash
npx tsx scripts/test-fixtures/generate-serial-kinematics-golden-v5.ts --write --source-commit (git rev-parse HEAD)
$after = (Get-FileHash -Algorithm SHA256 src/core/robot-runtime-v5/fixtures/serial-kinematics-golden-v5.json).Hash
if ($before -ne $after) { throw 'Serial kinematics golden generation is not byte-stable.' }
```

Expected: no exception.

- [ ] **Step 5: Add characterization tests against exact golden values and errors**

Use a numeric comparison helper with absolute tolerance `1e-12` for positions and normalized quaternion sign equivalence. The fixture records the current implementation commit and coordinate inputs.

- [ ] **Step 6: Run characterization before changing `serial-kinematics.ts`**

```powershell
npm run test:run -- src/core/robot-runtime-v5/serial-kinematics.test.ts src/core/robot-runtime-v5/serial-kinematics-compatibility.test.ts
```

Expected: PASS against the original serial implementation. If it does not pass, correct the fixture or expose the pre-existing mismatch before proceeding.

- [ ] **Step 7: Commit characterization separately**

```powershell
git add -- scripts/test-fixtures/generate-serial-kinematics-golden-v5.ts src/core/robot-runtime-v5/test-support.ts src/core/robot-runtime-v5/fixtures/serial-kinematics-golden-v5.json src/core/robot-runtime-v5/serial-kinematics.test.ts src/core/robot-runtime-v5/serial-kinematics-compatibility.test.ts
git commit -m "test: characterize V5 serial kinematics"
```

---

## Task 6: Implement the V5 Robot-to-Mechanism Adapter

**Files:**
- Create: `src/core/robot-runtime-v5/robot-mechanism-adapter.ts`
- Create: `src/core/robot-runtime-v5/robot-mechanism-adapter.test.ts`
- Modify: `src/core/robot-runtime-v5/index.ts`

- [ ] **Step 1: Write failing projection tests**

Prove:

- each V5 Link becomes one Body with the same ID and name;
- each V5 Joint keeps its ID and Body references;
- revolute min/max/home/zeroOffset/maximumVelocity and commands convert degrees to radians;
- prismatic values remain metres;
- direction, axis, origin, Frame IDs, nested Frame parents, and roles are preserved;
- all current V5 roles, including `world`, `mcp`, `tool0`, `gripper`, `grasp`, and `placement`, project losslessly;
- a V5 Frame parent matching a Link becomes `{ type: 'body', bodyId }`; otherwise it becomes `{ type: 'frame', frameId }`;
- each V5 geometry occurrence becomes a geometry binding using its occurrence key, owning Link ID, asset reference, and Link-local pose;
- source provenance records the V5 mechanics source kind, source name, calibration revision, and adapter version without becoming persisted Project data;
- the adapter creates one stable `primary` Motion Group;
- the Tree Solver reference is exactly Tree v1 with empty parameters and the approved empty-object SHA-256;
- Robot Capability base/flange/tool/TCP IDs are preserved;
- a valid V5 Definition with no `base` role projects `baseFrameId: null` rather than failing or inventing a Frame;
- Robot Capability contains exactly one home coordinate set with
  `coordinateSetId: 'home'`, `name: 'Home'`, every movable Joint in stable ID
  order, revolute `home` converted from degrees to radians, and prismatic
  `home` retained in metres;
- Runtime Instance parent Frame, local base pose, selected Tool/TCP, and visibility are preserved;
- Runtime Instance declared owners project current whole-Robot `jointSource` and exact `frameSources` without adding per-coordinate ownership;
- projection is detached, frozen, and deterministic;
- generalized Mechanism typed namespaces may reuse the same textual ID, while
  the V5 compatibility adapter still rejects a Link/Joint/Frame textual ID
  collision with `PROJECT_ID_DUPLICATE` to preserve the old serial API;
- `canonicalCoordinatesFromRobotV5()` requires the exact V5 Joint key set;
- `serialRobotPoseFromMechanismV1()` restores the V5 result shape and original degree/metre command record.

- [ ] **Step 2: Run the adapter test and confirm failure**

```powershell
npm run test:run -- src/core/robot-runtime-v5/robot-mechanism-adapter.test.ts
```

Expected: FAIL because the adapter does not exist.

- [ ] **Step 3: Implement the adapter**

Export:

```ts
export const PROJECT_V5_ROBOT_ADAPTER_KEY = 'open-digital-twin/project-v5-robot'
export const PROJECT_V5_ROBOT_ADAPTER_VERSION = '1'

export interface ProjectedRobotMechanismV1 {
  readonly mechanismDefinition: MechanismDefinitionV1
  readonly adapterKey: typeof PROJECT_V5_ROBOT_ADAPTER_KEY
  readonly adapterVersion: typeof PROJECT_V5_ROBOT_ADAPTER_VERSION
}

export function projectRobotDefinitionV5ToMechanismV1(
  definition: RobotDefinitionV5,
): ProjectedRobotMechanismV1

export function projectRobotInstanceV5ToMechanismInstanceV1(
  robot: RobotInstanceV5,
): MechanismRuntimeInstanceV1

export function projectRobotCapabilityV5(
  definition: RobotDefinitionV5,
  robot: RobotInstanceV5,
): RobotCapabilityV1

export function canonicalCoordinatesFromRobotV5(
  definition: RobotDefinitionV5,
  jointValues: Readonly<Record<string, number>>,
): Readonly<Record<string, number>>

export function serialRobotPoseFromMechanismV1(
  definition: RobotDefinitionV5,
  originalJointValues: Readonly<Record<string, number>>,
  result: ForwardKinematicsResultV1,
): SerialRobotPoseV5

export function validateSerialRobotCompatibilityInputV5(
  definition: RobotDefinitionV5,
  jointValues: Readonly<Record<string, number>>,
  worldBasePose: RigidTransformV5,
): void
```

- [ ] **Step 4: Preserve V5 error compatibility**

Run `validateSerialRobotCompatibilityInputV5()` before sorting, projecting, or
calling the common service. It retains original V5 array indices and performs
the current serial Link/Joint/Frame graph, exact Joint-record, command, axis,
limit, origin, Frame pose, and root-pose checks. It therefore reproduces the
Task 5 negative golden `ProjectV5Error` objects exactly, including
`name/code/path/message/recovery`.

The compatibility layer must cover these exact mappings as a fail-closed backup
for errors that can still arise after successful prevalidation:

| Common code | Existing V5 code |
| --- | --- |
| `COORDINATE_SET_MISMATCH` | `ROBOT_JOINT_KEY_SET_MISMATCH` |
| `COORDINATE_VALUE_NOT_FINITE` | `ROBOT_JOINT_VALUE_NOT_FINITE` |
| `JOINT_LIMIT_EXCEEDED` | `ROBOT_JOINT_VALUE_OUT_OF_RANGE` |
| `JOINT_LIMIT_INVALID` | `ROBOT_JOINT_LIMIT_INVALID` |
| `JOINT_AXIS_NOT_NORMALIZABLE` | `JOINT_AXIS_NOT_NORMALIZABLE` |
| `JOINT_DIRECTION_INVALID` | `ROBOT_JOINT_DIRECTION_INVALID` |
| `MECHANISM_VALUE_INVALID` | `PROJECT_VALUE_INVALID` |
| `MECHANISM_ID_DUPLICATE` | `PROJECT_ID_DUPLICATE` |
| `BODY_NOT_FOUND` | `ROBOT_LINK_NOT_FOUND` |
| `FRAME_PARENT_NOT_FOUND` | `FRAME_PARENT_NOT_FOUND` |
| `FRAME_CYCLE` | `FRAME_CYCLE` |
| `MECHANISM_TOPOLOGY_INVALID` | `ROBOT_JOINT_CHAIN_INVALID` |
| `TOPOLOGY_UNSUPPORTED` | `ROBOT_JOINT_CHAIN_INVALID` |
| `TRANSFORM_INVALID` | `PROJECT_VALUE_INVALID` |

Errors from reused `normalizeRigidTransformV5()` are intentionally exercised by
prevalidation at the old V5 path before the common service runs. No
`MechanismErrorV1` or differently pathed `ProjectV5Error` may escape
`computeSerialRobotPoseV5()`. Do not change `ProjectV5Error` formatting, path
conventions, or recovery text behavior. Unsupported V5 Joint types are rejected
by prevalidation with `ROBOT_JOINT_TYPE_UNSUPPORTED` before projection. If a
finite-input composition overflows later and `TRANSFORM_INVALID.cause` is the
original `ProjectV5Error`, the compatibility wrapper rethrows that original
cause so its existing `$.result` path and error details remain intact.

- [ ] **Step 5: Run adapter and common-core tests**

```powershell
npm run test:run -- src/core/mechanism-runtime-v1 src/core/robot-runtime-v5/robot-mechanism-adapter.test.ts
```

Expected: PASS, including every Task 5 negative golden error object.

- [ ] **Step 6: Commit the compatibility adapter**

```powershell
git add -- src/core/robot-runtime-v5/robot-mechanism-adapter.ts src/core/robot-runtime-v5/robot-mechanism-adapter.test.ts src/core/robot-runtime-v5/index.ts
git commit -m "feat: adapt V5 robots to mechanism core"
```

---

## Task 7: Turn the Existing Serial API into a Compatibility Wrapper

**Files:**
- Modify: `src/core/robot-runtime-v5/serial-kinematics.ts`
- Modify: `src/core/robot-runtime-v5/serial-kinematics.test.ts`
- Modify: `src/core/robot-runtime-v5/serial-kinematics-compatibility.test.ts`

- [ ] **Step 1: Write a failing delegation test**

Introduce and test:

```ts
export interface SerialRobotKinematicsV5 {
  evaluate(
    definition: RobotDefinitionV5,
    jointValues: Readonly<Record<string, number>>,
    worldBasePose?: RigidTransformV5,
  ): SerialRobotPoseV5
}

export function createSerialRobotKinematicsV5(
  applicationService?: ApplicationKinematicsServiceV1,
): SerialRobotKinematicsV5
```

Inject a spy Application Service and assert one compile/evaluation path is used. This test fails while `computeSerialRobotPoseV5()` still owns the serial traversal.

- [ ] **Step 2: Run the delegation test and confirm failure**

```powershell
npm run test:run -- src/core/robot-runtime-v5/serial-kinematics-compatibility.test.ts
```

Expected: FAIL because `createSerialRobotKinematicsV5` is missing or the spy is not used.

- [ ] **Step 3: Replace traversal with Projection → Service → V5 conversion**

Keep:

```ts
export function computeSerialRobotPoseV5(
  definition: RobotDefinitionV5,
  jointValues: Readonly<Record<string, number>>,
  worldBasePose?: RigidTransformV5,
): SerialRobotPoseV5
```

Its default singleton wrapper uses the default Application Kinematics Service. `jointMotionTransformV5()` remains exported with its current behavior because existing callers and tests use it, but it must share canonical math helpers rather than become a second FK traversal.

- [ ] **Step 4: Delete only the superseded serial graph traversal**

Remove the private `chain()` and private Frame resolver from `serial-kinematics.ts` after all parity tests pass. Do not remove the compatibility API, V5 error mapping, or `jointMotionTransformV5`.

- [ ] **Step 5: Run golden parity and import/alignment regressions**

```powershell
npm run test:run -- src/core/robot-runtime-v5
```

Expected: PASS, including exact golden parity for minimal, offset, prismatic, two-offset-six-axis, and NED2 fixtures.

- [ ] **Step 6: Commit the wrapper refactor**

```powershell
git add -- src/core/robot-runtime-v5
git commit -m "refactor: delegate serial FK to mechanism service"
```

---

## Task 8: Compile One Project-Aware Evaluator and Cache Robot Pose Snapshots

**Files:**
- Create: `src/features/robot/v5/project-v5-robot-kinematics.ts`
- Create: `src/features/robot/v5/project-v5-robot-kinematics.test.ts`

- [ ] **Step 1: Write failing Project compilation tests**

Prove:

- every distinct Robot Definition is projected and compiled once;
- two Robot Instances may share one compiled Definition;
- every initial Robot coordinate set is validated at compile time;
- identity includes exact `projectId`, `revisionId`, `configRevision`, adapter key/version, Solver key/version, and parameter hash;
- a Project/adapter/Solver failure leaves no partially usable compiled evaluator;
- no Project data is mutated or persisted.

- [ ] **Step 2: Write failing bounded-cache tests**

With a spy Application Service, prove:

- repeated reads of several Links and Frames for the same Robot state/root invoke FK once;
- changing only requested Link/Frame does not invalidate;
- changing `coordinateRevision` invalidates;
- changing any Joint value while reusing the same `coordinateRevision` invalidates and recomputes;
- changing any root position/quaternion number invalidates;
- a different Robot Instance uses a distinct entry;
- two instances sharing a Definition may have different roots and coordinates;
- Project/config replacement uses a new compiled evaluator;
- unrelated Object/status changes do not invalidate;
- cache size is bounded by the current Robot Instance count.

- [ ] **Step 3: Run the tests and confirm failure**

```powershell
npm run test:run -- src/features/robot/v5/project-v5-robot-kinematics.test.ts
```

Expected: FAIL because the Project-aware evaluator does not exist.

- [ ] **Step 4: Implement the factory and compiled evaluator**

`createProjectRobotKinematicsFactoryV5(applicationService?)` returns a factory with the locked public contract. Compilation:

1. validates the Project and lowercase 64-character config revision;
2. projects each Definition once;
3. compiles each projected Definition through the Application Service;
4. associates Robot IDs with compiled Definitions and Robot capability metadata;
5. validates each initial coordinate set and authored root;
6. freezes all maps and exposes only `evaluateRobot`.

- [ ] **Step 5: Implement exact cache equality**

Do not serialize a root pose or coordinate record on every read. Convert
coordinates once into the Definition's stable Joint order, normalize the root,
and compare the coordinate tuple plus seven root numbers directly. Cache the
frozen `EvaluatedSerialRobotPoseV5` and replace only that Robot's entry after a
key change.

- [ ] **Step 6: Run the targeted tests**

```powershell
npm run test:run -- src/features/robot/v5/project-v5-robot-kinematics.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit the Browser-ready evaluator**

```powershell
git add -- src/features/robot/v5/project-v5-robot-kinematics.ts src/features/robot/v5/project-v5-robot-kinematics.test.ts
git commit -m "feat: cache project robot pose snapshots"
```

---

## Task 9: Inject Kinematics into the Robot Runtime Store Atomically

**Files:**
- Modify: `src/features/robot/v5/robot-joint-runtime-store.ts`
- Modify: `src/features/robot/v5/robot-joint-runtime-store.test.ts`

- [ ] **Step 1: Write failing injection and cache tests**

Add an optional construction dependency:

```ts
export interface RobotJointRuntimeStoreOptionsV5 {
  readonly kinematicsFactory?: ProjectRobotKinematicsFactoryV5
}
```

Test that:

- store creation calls `compileProject()` once;
- initial coordinates are evaluated before the store is returned;
- repeated `readRobotPose()` calls reuse one cached evaluation;
- a partial successful Joint write merges to a complete record and increments revision once;
- the next read uses the newly evaluated revision;
- an out-of-range/invalid write neither publishes nor poisons the prior cache;
- simulation/manual/OPC UA ownership errors remain identical;
- `replaceProject()` compiles the complete next context before swapping Project, state, or evaluator;
- a failed replacement leaves Project/config/state/evaluator and guards unchanged.

- [ ] **Step 2: Run the store test and confirm failure**

```powershell
npm run test:run -- src/features/robot/v5/robot-joint-runtime-store.test.ts
```

Expected: FAIL because the store does not accept or call the injected factory.

- [ ] **Step 3: Move FK responsibility out of the store**

Change:

```ts
createRobotJointRuntimeStoreV5(
  project: WorkcellProjectV5,
  configRevision: string,
  options: RobotJointRuntimeStoreOptionsV5 = {},
)
```

The store continues to own coordinate values, source, quality, timestamps, revision, and endpoint fencing. Its compiled Context owns `CompiledProjectRobotKinematicsV5`. It no longer imports `computeSerialRobotPoseV5`.

- [ ] **Step 4: Delegate compatible reads and write validation**

`readRobotPose()` returns only `.pose` from:

```ts
compiledKinematics.evaluateRobot({
  robotId,
  coordinateRevision: state.revision,
  jointValues: state.jointValues,
  rootWorldPose: worldBasePose ?? authored.localBasePose,
})
```

Validate a prospective write with the prospective incremented revision before publishing. Never increment on failure.

- [ ] **Step 5: Preserve catch-up and endpoint behavior**

Run tests for replay prefix, endpoint reset/disconnect, ownership mismatch, quality transitions, source/published fences, and revision exhaustion. The kinematics refactor must not change those paths.

- [ ] **Step 6: Run the Robot feature suite**

```powershell
npm run test:run -- src/features/robot/v5
```

Expected: PASS.

- [ ] **Step 7: Commit the runtime injection**

```powershell
git add -- src/features/robot/v5/robot-joint-runtime-store.ts src/features/robot/v5/robot-joint-runtime-store.test.ts
git commit -m "refactor: inject shared robot kinematics runtime"
```

---

## Task 10: Make the Browser Runtime Own the Shared Service

**Files:**
- Modify: `src/features/project/v5/browser-project-runtime-v5.ts`
- Modify: `src/features/project/v5/browser-project-runtime-v5.test.ts`
- Modify: `src/features/project/v5/browser-project-runtime-v5.candidate.test.ts`

- [ ] **Step 1: Write failing ownership and atomic-prepare tests**

Extend `BrowserProjectRuntimeTestHooksV5` with:

```ts
readonly createRobotKinematicsFactory?: () => ProjectRobotKinematicsFactoryV5
```

Tests must prove:

- `createOwnedGraph()` creates exactly one factory for that graph and injects it into the Robot store;
- reading several Robot Links/Frames through `runtimeGraph.world` at one unchanged state/root performs one FK evaluation;
- a candidate whose injected factory rejects compilation makes `prepare()` reject;
- the active bundle, runtime epoch, Project revision, stores, stream owner, and subscribers remain unchanged after that failure;
- rollback/finalize/dispose never expose or reuse a candidate evaluator in the previous graph.

- [ ] **Step 2: Run Browser runtime tests and confirm failure**

```powershell
npm run test:run -- src/features/project/v5/browser-project-runtime-v5.test.ts src/features/project/v5/browser-project-runtime-v5.candidate.test.ts
```

Expected: FAIL because the Browser runtime does not own/inject the factory.

- [ ] **Step 3: Create and inject the factory in `createOwnedGraph()`**

Create the factory before the Robot store:

```ts
const kinematicsFactory =
  options.testHooks?.createRobotKinematicsFactory?.()
  ?? createProjectRobotKinematicsFactoryV5()
const robots = createRobotJointRuntimeStoreV5(project, configRevision, {
  kinematicsFactory,
})
```

Do not add the Solver or evaluator to `PublishedBrowserRuntimeGraphV5`. `WorldResolverV5` remains the only public spatial query facade.

- [ ] **Step 4: Preserve current World resolution and OPC UA precedence**

Keep the current behavior:

- authored Robot Base is composed under `baseParentFrameId`;
- GOOD mapped Base replaces that derived Base;
- an exact OPC UA-owned Robot Frame returns sampled mapped data and does not fall back to FK;
- before the first exact mapped Frame observation, it returns `null`;
- Robot Link reads use derived FK from the resolved Base;
- cycle/failure isolation still returns `null` instead of crashing the Canvas.

Extend the existing mapped Base/Tool/TCP tests near the current Browser runtime ownership cases rather than duplicating a separate fake policy.

- [ ] **Step 5: Run Browser and viewport tests**

```powershell
npm run test:run -- src/features/project/v5 src/features/scene/v5/V5WorkcellWorkspace.test.tsx
```

Expected: PASS.

- [ ] **Step 6: Commit Browser ownership**

```powershell
git add -- src/features/project/v5/browser-project-runtime-v5.ts src/features/project/v5/browser-project-runtime-v5.test.ts src/features/project/v5/browser-project-runtime-v5.candidate.test.ts
git commit -m "feat: share browser kinematics snapshots"
```

---

## Task 11: Lock Consumer Boundaries and End-to-End Pose Continuity

**Files:**
- Create: `src/features/project/v5/kinematics-consumer-boundary.test.ts`
- Modify: `src/features/jobs/v5/job-io.integration.test.ts`
- Modify: `src/features/actions/v5/browser-attachment-instruction-port.test.ts`
- Modify: `src/features/scene/v5/V5WorkcellWorkspace.test.tsx`

- [ ] **Step 1: Write a failing source-boundary test**

Scan production files under:

- `src/features/project/v5`
- `src/features/scene/v5`
- `src/features/jobs/v5`
- `src/features/actions/v5`

Allow only the Browser composition root and Robot runtime integration to reference the Project Robot kinematics factory. Forbid imports of:

- `tree-kinematics-solver`;
- `computeSerialRobotPoseV5`;
- `jointMotionTransformV5`;
- any V4 kinematics or collision adapter.

Viewport, Job attachment, and action code must continue to consume `WorldResolverV5` or the existing injected World pose callbacks.

- [ ] **Step 2: Run the boundary test and confirm the intended failure**

```powershell
npm run test:run -- src/features/project/v5/kinematics-consumer-boundary.test.ts
```

Expected: FAIL if a current or newly introduced consumer bypasses the shared
service. If the existing source already satisfies the boundary, record the
immediate PASS as a characterization guard and do not create an artificial
production change.

- [ ] **Step 3: Add Job and attachment continuity assertions**

Update the Job I/O harness so Frame reads go through its shared World pose facade rather than directly constructing a second FK path. Preserve:

- seven-instruction Job execution;
- Attach at the active Tool/TCP;
- attached Object pose continuity as Joints move;
- Detach retaining the last World pose;
- stop/failure behavior for invalid Joint commands;
- no external OPC UA write.

- [ ] **Step 4: Add viewport snapshot reuse assertions**

In `V5WorkcellWorkspace.test.tsx`, render multiple Link geometry occurrences for one Robot and prove their World poses come from the shared World facade. Do not test private Solver math in React.

- [ ] **Step 5: Run all direct and indirect consumer regressions**

```powershell
npm run test:run -- src/core/robot-runtime-v5/align-assembled-geometry.test.ts src/core/robot-runtime-v5/materialize-robot-mechanics-import.test.ts
npm run test:run -- src/features/jobs/v5/job-io.integration.test.ts src/features/actions/v5/browser-attachment-instruction-port.test.ts src/features/scene/v5/V5WorkcellWorkspace.test.tsx src/features/project/v5/kinematics-consumer-boundary.test.ts
```

Expected: PASS.

- [ ] **Step 6: Record the collision deferral in the boundary test description**

State in the test/documentation that there is no V5 collision consumer in Slice 1. A future V5 collision adapter receives one completed `ForwardKinematicsResultV1`/pose snapshot; it may not call a Solver directly. Do not modify V4 collision files.

- [ ] **Step 7: Commit consumer guards**

```powershell
git add -- src/features/project/v5/kinematics-consumer-boundary.test.ts src/features/jobs/v5/job-io.integration.test.ts src/features/actions/v5/browser-attachment-instruction-port.test.ts src/features/scene/v5/V5WorkcellWorkspace.test.tsx
git commit -m "test: guard shared kinematics consumers"
```

---

## Task 12: Prove Branched, CNC, Mounted, and Multi-Instance Composition

**Files:**
- Create: `src/core/mechanism-runtime-v1/composed-mechanisms.test.ts`
- Create: `src/core/mechanism-runtime-v1/fixtures/branched-humanoid.mechanism-v1.json`
- Create: `src/core/mechanism-runtime-v1/fixtures/cnc-xyz.mechanism-v1.json`
- Create: `src/features/scene/v5/MechanismPoseLayerV1.tsx`
- Create: `src/features/scene/v5/MechanismPoseLayerV1.test.tsx`
- Create: `src/features/scene/v5/MechanismTreeViewportFixtureApp.tsx`
- Create: `tests/mechanism-tree-viewport-fixtures.spec.ts`
- Modify: `src/core/mechanism-runtime-v1/test-support.ts`
- Modify: `src/core/robot-runtime-v5/serial-kinematics-compatibility.test.ts`
- Modify: `src/main.tsx`
- Modify: `package.json`

- [ ] **Step 1: Check in closed Humanoid and CNC fixture JSON**

The two JSON files are normalized Mechanism V1 input, not Project V5 records.
They contain no asset URI, Browser state, or persisted ownership. Tests decode
them through the same strict common validation used by the Application Service;
unknown keys fail.

- [ ] **Step 2: Write failing approved-fixture core acceptance tests**

Add:

1. Humanoid Tree:
   - torso root;
   - independent left arm, right arm, head, left leg, and right leg branches;
   - separate Motion Groups and end Frames;
   - moving one branch leaves unrelated branch results unchanged.
2. CNC:
   - X/Y/Z prismatic chain;
   - spindle end Frame;
   - exact `[x, y, z]` translation in metres.
3. Robot-on-Linear:
   - evaluate a prismatic carriage Mechanism;
   - feed its carriage Frame World pose as the Robot root;
   - prove Robot TCP motion equals carriage composition plus Robot FK.
4. Multiple Instances:
   - compile one Mechanism Definition once;
   - evaluate two instance roots and coordinate records;
   - prove results do not alias or overwrite each other.
5. V5 NED2:
   - retain home/mid/limit-adjacent golden parity through the compatibility wrapper.

- [ ] **Step 3: Run the core fixture tests and confirm failure**

```powershell
npm run test:run -- src/core/mechanism-runtime-v1/composed-mechanisms.test.ts src/core/robot-runtime-v5/serial-kinematics-compatibility.test.ts
```

Expected: FAIL until all transient fixtures and composition paths are complete.

- [ ] **Step 4: Complete deterministic test builders**

Builders return fresh detached data and accept only explicit deterministic inputs. Do not read time, random global state, Browser state, external assets, or persisted Projects.

- [ ] **Step 5: Run the full core acceptance**

```powershell
npm run test:run -- src/core/mechanism-runtime-v1 src/core/robot-runtime-v5
```

Expected: PASS.

- [ ] **Step 6: Write a failing generic pose-layer component test**

Lock this render-only API:

```ts
export interface MechanismBodyVisualV1 {
  readonly bodyId: string
  readonly sizeM: readonly [number, number, number]
  readonly color: string
}

export interface MechanismPoseLayerV1Props {
  readonly bodyWorldPoses: ForwardKinematicsResultV1['bodyWorldPoses']
  readonly visuals: readonly MechanismBodyVisualV1[]
  readonly onDiagnostic?: (code: 'BODY_POSE_NOT_FOUND', bodyId: string) => void
}
```

Mock R3F primitives and prove one `<group>` per visual receives the matching
World position/quaternion. The component rejects or skips a missing Body with a
bounded diagnostic prop; it never imports a Solver, Project store, or OPC UA
adapter.

- [ ] **Step 7: Run the pose-layer test and confirm failure**

```powershell
npm run test:run -- src/features/scene/v5/MechanismPoseLayerV1.test.tsx
```

Expected: FAIL because `MechanismPoseLayerV1` does not exist.

- [ ] **Step 8: Implement the generic pose layer**

Render only the supplied completed pose snapshot. Do not calculate FK in JSX or
per Body. Keep one Canvas outside the component and use stable Body IDs as React
keys.

- [ ] **Step 9: Run the pose-layer test**

```powershell
npm run test:run -- src/features/scene/v5/MechanismPoseLayerV1.test.tsx
```

Expected: PASS.

- [ ] **Step 10: Add a test-mode-only viewport fixture app**

`MechanismTreeViewportFixtureApp.tsx`:

- selects `humanoid` or `cnc` from a required prop;
- imports the checked-in JSON fixture;
- compiles it once through `createDefaultApplicationKinematicsServiceV1()`;
- holds explicit full coordinates in React state;
- evaluates one complete snapshot per coordinate change, outside Body render loops;
- renders `MechanismPoseLayerV1`;
- exposes accessible `Move left arm`, `Reset humanoid`, `Move CNC`, and `Reset CNC` buttons;
- exposes compact read-only Body/Frame pose text with `data-testid` for E2E evidence.

In `src/main.tsx`, render this app only when both conditions hold:

```ts
import.meta.env.MODE === 'test'
new URLSearchParams(window.location.search).get('mechanismFixture')
```

Accepted query values are exactly `humanoid` and `cnc`; every other value boots
the normal `App`. Use a dynamic import so the production build does not expose a
fixture menu or alter the Project V5 bootstrap.

- [ ] **Step 11: Write failing Browser E2E**

`tests/mechanism-tree-viewport-fixtures.spec.ts` must:

- open `/?mechanismFixture=humanoid`, observe one Canvas and all expected Bodies;
- click `Move left arm`;
- prove the left hand pose changes while the right hand pose remains byte-identical;
- open `/?mechanismFixture=cnc`;
- click `Move CNC`;
- prove the spindle Frame reaches the exact expected XYZ pose;
- assert no page error or `3D renderer unavailable` fallback occurs.

- [ ] **Step 12: Add the fixture spec to the V5 E2E command**

Change only the existing script value:

```json
"test:e2e:v5": "playwright test tests/project-v5-browser-cutover.spec.ts tests/opcua-settings-monitor.spec.ts tests/mechanism-tree-viewport-fixtures.spec.ts"
```

- [ ] **Step 13: Run component and fixture E2E acceptance**

```powershell
npm run test:run -- src/features/scene/v5/MechanismPoseLayerV1.test.tsx
npm run test:e2e:v5
```

Expected: PASS for existing Project V5 E2E plus Humanoid/CNC transient viewport
motion.

- [ ] **Step 14: Commit approved fixture acceptance**

```powershell
git add -- src/core/mechanism-runtime-v1/composed-mechanisms.test.ts src/core/mechanism-runtime-v1/test-support.ts src/core/mechanism-runtime-v1/fixtures/branched-humanoid.mechanism-v1.json src/core/mechanism-runtime-v1/fixtures/cnc-xyz.mechanism-v1.json src/core/robot-runtime-v5/serial-kinematics-compatibility.test.ts src/features/scene/v5/MechanismPoseLayerV1.tsx src/features/scene/v5/MechanismPoseLayerV1.test.tsx src/features/scene/v5/MechanismTreeViewportFixtureApp.tsx src/main.tsx tests/mechanism-tree-viewport-fixtures.spec.ts package.json
git commit -m "test: verify generalized tree mechanism fixtures"
```

---

## Task 13: Add a Reproducible Tree FK Benchmark

**Files:**
- Create: `scripts/performance/mechanism-tree-fk-benchmark.ts`
- Create: `scripts/performance/mechanism-tree-fk-benchmark.test.ts`
- Create: `docs/performance/mechanism-tree-fk-baseline.md`
- Modify: `src/core/mechanism-runtime-v1/contracts.test.ts`
- Modify: `src/core/mechanism-runtime-v1/test-support.ts`
- Modify: `package.json`

- [ ] **Step 1: Write a failing benchmark-fixture test in the neutral core**

Assert the benchmark builder contains:

- exactly 128 Bodies;
- exactly 127 Tree Joints;
- exactly 64 movable Joints and 63 fixed Joints;
- at least four branches;
- explicit coordinates for all 64 movable Joints;
- deterministic IDs, root pose, and coordinate values.

- [ ] **Step 2: Run the fixture test and confirm failure**

```powershell
npm run test:run -- src/core/mechanism-runtime-v1/contracts.test.ts
```

Expected: FAIL until the exact benchmark fixture exists.

- [ ] **Step 3: Implement the exact benchmark fixture**

Add the deterministic builder to `test-support.ts`, rerun
`contracts.test.ts`, and confirm PASS before writing timing code.

- [ ] **Step 4: Write a failing benchmark-runner test**

Export a pure runner:

```ts
export interface MechanismTreeFkBenchmarkOptions {
  readonly warmupCount: number
  readonly batchCount: number
  readonly samplesPerBatch: number
}

export interface MechanismTreeFkBenchmarkReport {
  readonly fixture: {
    readonly bodies: 128
    readonly totalJoints: 127
    readonly movableJoints: 64
    readonly fixedJoints: 63
  }
  readonly solver: {
    readonly solverKey: string
    readonly contractVersion: string
  }
  readonly environment: {
    readonly platform: string
    readonly cpuModel: string
    readonly logicalCores: number
    readonly nodeVersion: string
    readonly gitCommit: string
  }
  readonly batches: readonly {
    readonly p50Ms: number
    readonly p95Ms: number
    readonly maxMs: number
  }[]
  readonly aggregate: {
    readonly p50Ms: number
    readonly p95Ms: number
  }
}

export interface MechanismTreeFkBenchmarkDependencies {
  readonly nowMs: () => number
  readonly readEnvironment: () => MechanismTreeFkBenchmarkReport['environment']
}

export function runMechanismTreeFkBenchmark(
  options: MechanismTreeFkBenchmarkOptions,
  dependencies?: MechanismTreeFkBenchmarkDependencies,
): MechanismTreeFkBenchmarkReport
```

The unit test uses 2 warm-ups, 2 batches, and 3 samples per batch, injects a
monotonic fake clock plus fixed environment metadata, and checks finite sorted percentile output without
asserting elapsed-time limits.

- [ ] **Step 5: Run the runner test and confirm failure**

```powershell
npm run test:run -- scripts/performance/mechanism-tree-fk-benchmark.test.ts
```

Expected: FAIL because the runner does not exist.

- [ ] **Step 6: Implement the benchmark runner and CLI**

The script:

- reports OS, CPU model, logical core count, Node version, fixture counts, Solver identity, and git commit;
- performs the configured warm-up and sample counts;
- uses `performance.now()` only around evaluation;
- changes coordinates deterministically each sample so cached application results cannot falsify Solver timing;
- emits bounded JSON with batch p50/p95/max and aggregate p50/p95;
- exits non-zero for invalid/non-finite output;
- does not fail solely because p95 exceeds 4 ms.

- [ ] **Step 7: Run the runner test**

```powershell
npm run test:run -- scripts/performance/mechanism-tree-fk-benchmark.test.ts
```

Expected: PASS.

- [ ] **Step 8: Add the benchmark command**

```json
{
  "scripts": {
    "benchmark:mechanism-tree-fk": "tsx scripts/performance/mechanism-tree-fk-benchmark.ts"
  }
}
```

The CLI defaults are exactly 2,000 warm-up evaluations and five batches of
10,000 evaluations.

- [ ] **Step 9: Run the benchmark on the reference development machine**

```powershell
npm run benchmark:mechanism-tree-fk
```

Expected: valid bounded JSON and no correctness error.

- [ ] **Step 10: Record the baseline without weakening the target**

`docs/performance/mechanism-tree-fk-baseline.md` records:

- date and commit;
- Hardware and Node version;
- fixture and sample counts;
- p50/p95;
- approved target `warm p95 <= 4 ms`;
- PASS or explicit baseline miss;
- no claim that the result generalizes to other Hardware/Browsers.

If the target is missed, keep the target and record the miss for a separately approved design amendment or optimization task.

- [ ] **Step 11: Run benchmark fixture and package validation**

```powershell
npm run test:run -- src/core/mechanism-runtime-v1
npm run test:run -- scripts/performance/mechanism-tree-fk-benchmark.test.ts
npm run benchmark:mechanism-tree-fk
npm run lint
```

Expected: tests and lint PASS; benchmark emits finite data.

- [ ] **Step 12: Commit benchmark evidence**

```powershell
git add -- package.json scripts/performance/mechanism-tree-fk-benchmark.ts scripts/performance/mechanism-tree-fk-benchmark.test.ts docs/performance/mechanism-tree-fk-baseline.md src/core/mechanism-runtime-v1/contracts.test.ts src/core/mechanism-runtime-v1/test-support.ts
git commit -m "perf: baseline generalized tree kinematics"
```

---

## Task 14: Run Layered Regression and Final Acceptance

**Files:**
- Modify only files required to correct failures caused by Tasks 1–13.

- [ ] **Step 1: Run neutral core and V5 compatibility**

```powershell
npm run test:run -- src/core/mechanism-runtime-v1 src/core/robot-runtime-v5
```

Expected: PASS.

- [ ] **Step 2: Run Robot, Project, Scene, Job, and action integration**

```powershell
npm run test:run -- src/features/robot/v5 src/features/project/v5 src/features/scene/v5 src/features/jobs/v5 src/features/actions/v5
```

Expected: PASS.

- [ ] **Step 3: Run the existing Job/OPC UA contract suites**

```powershell
npm run test:job-io
npm run test:opcua-server-model
```

Expected: PASS. This is read-only protocol/runtime verification; do not connect to or write an external PLC/Robot.

- [ ] **Step 4: Run static and build gates**

```powershell
npm run lint
npm run typecheck
npm run build:gateway
npm run build
```

Expected: PASS.

- [ ] **Step 5: Run V5 Browser E2E**

```powershell
npm run test:e2e:v5
```

Expected:

- existing V5 Project loads;
- Robot remains visible;
- Joint motion updates geometry;
- Frame/Link reads do not crash the Canvas;
- OPC UA Settings/monitor behavior remains intact.
- the test-mode Humanoid left branch moves without moving the right branch;
- the test-mode CNC spindle reaches the expected XYZ pose.

- [ ] **Step 6: Run repository guidance and Codex verification**

```powershell
npm run verify:guidance
npm run --silent verify:codex -- --scope src/core/mechanism-runtime-v1 --json
```

Expected: PASS with valid JSON evidence.

- [ ] **Step 7: Run the full repository gate**

```powershell
npm run verify
```

Expected: PASS. If an unrelated pre-existing failure occurs, preserve its exact output, prove every targeted Slice 1 gate passes, and do not label the full repository verified.

- [ ] **Step 8: Review the final diff for scope and schema safety**

```powershell
git diff --check
git diff -- src/core/project-v5/types.ts src/core/project-v5/limits.ts src/core/project-v5/validate-shape.ts src/core/project-v5/validate-references.ts
git status --short
```

Expected:

- no whitespace errors;
- no diff in the four Project V5 schema/limit files;
- no V4/Legacy or Gateway changes;
- only planned files remain.

- [ ] **Step 9: Scan for placeholders and forbidden shortcuts**

```powershell
rg -n "TBD|TODO|FIXME|temporary|fallback to|project-v4|computeSerialRobotPoseV5|tree-kinematics-solver" src/core/mechanism-runtime-v1 src/core/robot-runtime-v5 src/features/robot/v5 src/features/project/v5 src/features/scene/v5 src/features/jobs/v5 src/features/actions/v5
```

Review every match. The compatibility wrapper name is allowed only in Robot runtime compatibility surfaces; direct Tree Solver imports are allowed only in the neutral core/default service and tests.

- [ ] **Step 10: Route every final correction back through its owning Task**

Do not create an unreviewed catch-all commit. If final verification exposes a
Slice 1 defect, return to the Task that owns that file, add or strengthen its
failing targeted test, apply the minimal fix, rerun that Task's exact command,
and amend neither unrelated commits nor unrelated files. When no correction is
required, this step is complete without a new commit.

---

## Slice 1 Success Criteria

- [ ] `WorkcellProjectV5` remains byte/schema compatible and its existing limits are unchanged.
- [ ] The neutral core represents fixed, revolute, and prismatic branched Trees with stable IDs.
- [ ] Tree validation rejects multiple roots, cycles, disconnected Bodies, invalid Frames, constraints, incomplete coordinates, and resource-budget excess.
- [ ] Forward evaluation is deterministic, immutable, SI-based, and preserves `origin * motion`, direction, offset, limit, and root composition semantics.
- [ ] Humanoid, CNC, Robot-on-Linear, and multiple-instance transient fixtures pass through the same Application Kinematics Service.
- [ ] Test-mode Humanoid and CNC viewport fixtures render completed shared pose snapshots and pass explicit Browser motion E2E.
- [ ] Existing minimal, two-offset-six-axis, prismatic, nested-Frame, and NED2 serial outputs match pre-refactor golden values.
- [ ] `computeSerialRobotPoseV5()` and `RobotJointRuntimeStoreV5.readRobotPose()` remain compatible public APIs.
- [ ] One Browser-owned Project evaluator serves Robot store, World resolver, viewport, Job attachment, and action pose reads.
- [ ] Repeated Link/Frame reads for an unchanged Robot state/root perform one FK evaluation.
- [ ] Joint revision, resolved Base pose, Project/config revision, adapter, or Solver identity changes invalidate the correct cache entry.
- [ ] A failed Project candidate kinematics compile cannot partially publish or disturb the active Browser runtime.
- [ ] Existing mapped Base and exact mapped Tool/TCP OPC UA precedence remains unchanged.
- [ ] Runtime Gateway Robotics projection and all external-write safety boundaries remain unchanged.
- [ ] The 128-Body/64-movable-Joint benchmark is reproducible and its measured result is recorded without a flaky CI timing gate.
- [ ] Targeted tests, lint, builds, V5 E2E, Codex verification, and `npm run verify` pass, or any unrelated full-suite blocker is reported exactly without overstating completion.

## Deferred Follow-up Gates

These items require new approved plans and must not leak into Slice 1:

1. **Observation and ownership:** common Actual/Commanded/Simulated/Derived envelopes, coherent OPC UA batches, raw versus presentation interpolation.
2. **Generalized persistence:** successor Project schema, V5 migration, reusable Mechanism Definitions/Instances, generic Jobs and OPC UA targets.
3. **Authoring/assets:** Mechanism Manifest, URDF adapter, Manual Editor, Body occurrence mapping, GLB derivatives, source coordinate adapter.
4. **Collision:** V5 collision proxy adapter consuming one shared pose snapshot, followed by separate UI/E2E work.
5. **Additional Solvers:** FreeBody and Parallel/constraint Solver families.
6. **Client-neutral MCP:** supersede old Codex-only names with `middleware/opendigitaltwin-mcp`, `tsconfig.mcp.json`, and `scripts/mcp`; one STDIO server and identical schemas/results for Codex and Claude Code, with no external OPC UA/PLC/Robot writes.
