# Project V5 Logical Signals and Jobs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the standalone Project V5 contract, validation, canonical persistence, and contract sample for Robot/Controller identity, stable OPC UA addresses, logical Signals, and explicit Job instructions.

**Architecture:** Add a new dependency-free `src/core/project-v5` lane and a new `src/features/project/v5` persistence lane; neither imports, opens, converts, or aliases V4. Persist only validated canonical Project JSON, while runtime Signal quality/ownership and Job execution state remain outside the Project aggregate for Milestone 3 consumers.

**Tech Stack:** TypeScript 6.0.3, Dexie 4.4.4, Web Crypto, Vitest 4.1.10, Vite 8.1.4, Node 22.15.1, npm 11.4.2.

## Global Constraints

- The persisted root is exactly `schemaVersion: 5`; schema versions 1, 2, 3, and 4 fail as `PROJECT_SCHEMA_UNSUPPORTED` before repository writes or active-Project mutation.
- Do not add V4 migration, Compatibility Mode, deprecated fields, aliases, dual-write persistence, or Legacy Adoption UI.
- Do not import any `project-v4` production or test module from `src/core/project-v5` or `src/features/project/v5`.
- Robot identity and Controller identity are separate records; every Robot instance owns its actual serial number and references one Controller.
- Persist OPC UA addresses as Namespace URI plus identifier type/value; never persist a session-local Namespace Index or raw `ns=<index>;...` text.
- Remove V4 `actions`, `action-reference`, `actionBindings`, and raw Mapping `nodeId` from the V5 root.
- Job instructions are exactly `move-joint`, `set-do`, `wait-di`, `delay`, `attach`, and `detach`; every instruction has a stable globally unique ID.
- `set-do` accepts only Boolean output or bidirectional Signals; `wait-di` accepts only Boolean input or bidirectional Signals and always has a positive timeout.
- `move-joint` contains the exact Joint ID set of its Robot Definition; Attach/Detach use explicit Object IDs and nullable Frame IDs.
- Preserve V4 spatial conventions in V5: metres, Z-up, normalized quaternion `[x,y,z,w]`, RPY degrees composed `Rz * Ry * Rx`, revolute values in degrees, and prismatic values in metres.
- Retain the approved limits: 8 OPC UA Client Endpoints, 128 structured Mapping roots, 1,024 expanded leaves, 32 leaves per structure, depth 4, 256 fixed-array elements, 10,240 mapped leaf updates/second, 16 Server Sessions, and 4,096 command deduplication records.
- Robot STEP source count remains 1..7 per Robot Definition only; a Scene Object references one complete STEP asset and is bounded by the existing Object budgets.
- Signal runtime Value/Quality/StatusCode/SourceTimestamp/PublishedTimestamp/Owner and Job runtime state are not persisted in canonical Project JSON.
- Keep comments in English, preserve unrelated/untracked CAD and artifact files, and stage only files listed by each task.

---

## File Structure

**Create:**

- `src/core/project-v5/errors.ts` — stable V5 validation failures.
- `src/core/project-v5/rigid-transform.ts` — standalone V5 transform math; no V4 import.
- `src/core/project-v5/limits.ts` — all V5 cardinality and scalar bounds.
- `src/core/project-v5/types.ts` — closed Project V5 aggregate and discriminated unions.
- `src/core/project-v5/opcua-node-address.ts` — structured Node-address validation and canonical key.
- `src/core/project-v5/logical-signal.ts` — logical Signal initial/runtime scalar validation.
- `src/core/project-v5/validation-support.ts` — closed-record, dense-array, clone, freeze, and scalar guards.
- `src/core/project-v5/validate-shape.ts` — closed persisted shape validation.
- `src/core/project-v5/validate-references.ts` — references, Job semantics, Mapping budgets, and Bridge-cycle validation.
- `src/core/project-v5/validate.ts` — public validation pipeline.
- `src/core/project-v5/canonical-json.ts` — deterministic JSON and SHA-256 config revision.
- `src/core/project-v5/test-support.ts` — minimal valid V5 fixtures and immutable test mutations.
- `src/core/project-v5/index.ts` — V5 public exports only.
- Focused `*.test.ts` beside the Core modules above.
- `src/features/project/v5/project-v5-codec.ts` — strict UTF-8 JSON import/export.
- `src/features/project/v5/project-v5-db.ts` — standalone `robot-sim-project-v5` Dexie database.
- `src/features/project/v5/project-v5-repository.ts` — crash-consistent canonical revision repository.
- `src/features/project/v5/logical-io-job-sample-v5.ts` — validated V5 contract sample.
- Focused `*.test.ts` beside each V5 Project feature.

**Modify:**

- `package.json` — add the focused `verify:v5-core` gate only.

**Explicitly untouched:**

- `src/core/project-v4/**`, `src/features/project/v4/**`, `src/features/jobs/v4/**`, and `middleware/runtime-gateway/**`; later milestone plans consume V5 and own the production cutover.

### Task 1: Add Standalone V5 Primitives, Limits, and Node Addresses

**Files:**
- Create: `src/core/project-v5/errors.ts`
- Create: `src/core/project-v5/rigid-transform.ts`
- Create: `src/core/project-v5/limits.ts`
- Create: `src/core/project-v5/opcua-node-address.ts`
- Test: `src/core/project-v5/rigid-transform.test.ts`
- Test: `src/core/project-v5/opcua-node-address.test.ts`

**Interfaces:**
- Produces: `ProjectV5Error`, `failProjectV5`, `RigidTransformV5`, V5 transform functions, `OpcUaNodeAddressV1`, `validateOpcUaNodeAddressV1`, `opcUaNodeAddressKeyV1`, `MAX_OPC_UA_ENDPOINTS_V5 = 8`, and all other `*_V5` limits.

- [ ] **Step 1: Write failing transform and structured-address tests**

```ts
it('normalizes a V5 transform without importing Project V4', () => {
  expect(normalizeRigidTransformV5({
    positionM: [-0, 1, 2],
    quaternion: [0, 0, 0, 2],
  }, '$.pose')).toEqual({ positionM: [0, 1, 2], quaternion: [0, 0, 0, 1] })
})

it.each([
  [{ namespaceUri: 'urn:sample:plc', identifierType: 'string', identifier: 'ObjectPos.X' }],
  [{ namespaceUri: 'urn:sample:plc', identifierType: 'numeric', identifier: '42' }],
  [{ namespaceUri: 'urn:sample:plc', identifierType: 'guid', identifier: '550e8400-e29b-41d4-a716-446655440000' }],
  [{ namespaceUri: 'urn:sample:plc', identifierType: 'byteString', identifier: 'AQID' }],
])('accepts a stable Namespace-URI address %#', (address) => {
  expect(validateOpcUaNodeAddressV1(address, '$.nodeAddress')).toEqual(address)
})

it.each(['ns=2', '2', ''])('rejects Namespace Index-like URI %j', (namespaceUri) => {
  expect(() => validateOpcUaNodeAddressV1({
    namespaceUri,
    identifierType: 'string',
    identifier: 'ObjectPos.X',
  }, '$.nodeAddress')).toThrowError(expect.objectContaining({
    code: 'OPCUA_NAMESPACE_URI_INVALID',
    path: '$.nodeAddress.namespaceUri',
  }))
})
```

- [ ] **Step 2: Run the focused tests and confirm RED**

Run:

```powershell
npm run test:run -- src/core/project-v5/rigid-transform.test.ts src/core/project-v5/opcua-node-address.test.ts
```

Expected: FAIL because the V5 modules do not exist.

- [ ] **Step 3: Implement the standalone primitives and exact limits**

```ts
export class ProjectV5Error extends Error {
  constructor(
    readonly code: string,
    readonly path: string,
    message: string,
    readonly recovery?: string,
  ) {
    super(`${code} at ${path}: ${message}`)
    this.name = 'ProjectV5Error'
  }
}

export interface OpcUaNodeAddressV1 {
  readonly namespaceUri: string
  readonly identifierType: 'string' | 'numeric' | 'guid' | 'byteString'
  readonly identifier: string
}

export function validateOpcUaNodeAddressV1(
  value: unknown,
  path: string,
): OpcUaNodeAddressV1

export function opcUaNodeAddressKeyV1(address: OpcUaNodeAddressV1): string {
  const value = validateOpcUaNodeAddressV1(address, '$.nodeAddress')
  return JSON.stringify([value.namespaceUri, value.identifierType, value.identifier])
}
```

Use an absolute `urn:`, `http:`, or `https:` Namespace URI; canonical unsigned decimal `0..4294967295`; lowercase canonical GUID; and canonical padded Base64. Copy the V4 transform algorithms under V5 symbols so this lane has no V4 dependency. Define `PROJECT_V5_SCHEMA_VERSION = 5`, the spec limits above, `MAX_OPC_UA_ENDPOINTS_V5 = 8`, `MAX_ROBOT_CONTROLLERS_V5 = 8`, `MAX_LOGICAL_SIGNALS_V5 = 1_024`, `MAX_LOGICAL_SIGNAL_STRING_UTF8_BYTES_V5 = 4_096`, and `MAX_JOB_TIMER_MS_V5 = 2_147_483_647`.

- [ ] **Step 4: Run GREEN and prove there is no V4 import**

Run:

```powershell
npm run test:run -- src/core/project-v5/rigid-transform.test.ts src/core/project-v5/opcua-node-address.test.ts
rg -n "project-v4|V4" src/core/project-v5 -g "*.ts" -g "!*.test.ts"
```

Expected: both test files PASS; `rg` returns no matches and exits 1.

- [ ] **Step 5: Commit the primitive boundary**

```powershell
git add src/core/project-v5/errors.ts src/core/project-v5/rigid-transform.ts src/core/project-v5/rigid-transform.test.ts src/core/project-v5/limits.ts src/core/project-v5/opcua-node-address.ts src/core/project-v5/opcua-node-address.test.ts
git diff --cached --check
git commit -m "feat: add project v5 core primitives"
```

### Task 2: Define the Closed V5 Aggregate and Shape Validator

**Files:**
- Create: `src/core/project-v5/types.ts`
- Create: `src/core/project-v5/logical-signal.ts`
- Create: `src/core/project-v5/validation-support.ts`
- Create: `src/core/project-v5/validate-shape.ts`
- Create: `src/core/project-v5/validate.ts`
- Create: `src/core/project-v5/test-support.ts`
- Create: `src/core/project-v5/index.ts`
- Test: `src/core/project-v5/validate-shape.test.ts`

**Interfaces:**
- Consumes: Task 1 primitives and limits.
- Produces: `WorkcellProjectV5`, `RobotIdentificationV1`, `RobotControllerIdentificationV1`, `RobotControllerV5`, `LogicalSignalV1`, `RobotJobInstructionV1`, `OpcUaEndpointV5`, `OpcUaMappingV5`, `OpcUaBridgeRouteV5`, `OpcUaProjectConfigurationV5`, `validateLogicalSignalValueV1`, and `validateWorkcellProjectV5`.

- [ ] **Step 1: Write failing closed-root, identity, and Signal-shape tests**

```ts
it.each([1, 2, 3, 4])('rejects schema V%i without conversion', (schemaVersion) => {
  expect(() => validateWorkcellProjectV5({ schemaVersion })).toThrowError(
    expect.objectContaining({ code: 'PROJECT_SCHEMA_UNSUPPORTED', path: '$.schemaVersion' }),
  )
})

it('requires separate Robot and Controller identification', () => {
  const project = makeMinimalWorkcellProjectV5()
  expect(project.robotDefinitions[0]!.identification).toMatchObject({
    manufacturer: 'ABB', model: 'CRB15000-12/1.27', productCode: 'CRB15000-12/1.27',
    serialNumberTemplate: null, motionDeviceCategory: 'ARTICULATED_ROBOT',
  })
  expect(project.controllers[0]!.identification.serialNumber).toBe('CTRL-SAMPLE-001')
  expect(project.robots[0]!.serialNumber).toBe('ROBOT-SAMPLE-001')
})

it('rejects persisted Signal runtime fields', () => {
  const project = cloneWorkcellProjectV5(makeMinimalWorkcellProjectV5())
  ;(project.logicalSignals[0] as unknown as Record<string, unknown>).quality = 'GOOD'
  expect(() => validateWorkcellProjectV5(project)).toThrowError(
    expect.objectContaining({ code: 'PROJECT_RECORD_NOT_CLOSED' }),
  )
})
```

- [ ] **Step 2: Run the shape test and confirm RED**

Run:

```powershell
npm run test:run -- src/core/project-v5/validate-shape.test.ts
```

Expected: FAIL because `types.ts`, test support, and the V5 validator do not exist.

- [ ] **Step 3: Define the exact new V5 interfaces**

```ts
export interface RobotIdentificationV1 {
  readonly manufacturer: string
  readonly model: string
  readonly productCode: string
  readonly serialNumberTemplate: string | null
  readonly motionDeviceCategory: 'ARTICULATED_ROBOT' | 'SCARA_ROBOT' | 'DELTA_ROBOT' | 'OTHER'
}

export interface RobotControllerIdentificationV1 {
  readonly manufacturer: string
  readonly model: string
  readonly productCode: string
  readonly serialNumber: string
}

export interface RobotControllerV5 {
  readonly id: string
  readonly name: string
  readonly identification: RobotControllerIdentificationV1
}

export type LogicalSignalDataTypeV1 = 'Boolean' | 'Int32' | 'UInt32' | 'Double' | 'String'
export type LogicalSignalDirectionV1 = 'input' | 'output' | 'bidirectional' | 'internal'
export type LogicalSignalValueV1 = boolean | number | string

export interface LogicalSignalV1 {
  readonly id: string
  readonly name: string
  readonly dataType: LogicalSignalDataTypeV1
  readonly direction: LogicalSignalDirectionV1
  readonly initialValue: LogicalSignalValueV1
  readonly unit: string
  readonly scope: { readonly type: 'project' }
    | { readonly type: 'robot' | 'entity'; readonly id: string }
}

export type RobotJobInstructionV1 =
  | { readonly id: string; readonly kind: 'move-joint'; readonly jointValues: Readonly<Record<string, number>>; readonly speedPercentToNext: number }
  | { readonly id: string; readonly kind: 'set-do'; readonly signalId: string; readonly value: boolean }
  | { readonly id: string; readonly kind: 'wait-di'; readonly signalId: string; readonly expected: boolean; readonly timeoutMs: number }
  | { readonly id: string; readonly kind: 'delay'; readonly durationMs: number }
  | { readonly id: string; readonly kind: 'attach'; readonly objectId: string; readonly toolFrameId: string; readonly objectGraspFrameId: string | null; readonly maximumDistanceM: number }
  | { readonly id: string; readonly kind: 'detach'; readonly objectId: string; readonly targetParentFrameId: string | null }

export interface RobotJobV5 {
  readonly id: string
  readonly name: string
  readonly robotId: string
  readonly instructions: readonly RobotJobInstructionV1[]
}
```

Define the Robot records with these exact fields; `RobotDefinitionV5` has no duplicate top-level manufacturer/model and `RobotInstanceV5` owns the actual serial number:

```ts
export interface RobotDefinitionV5 {
  readonly id: string
  readonly name: string
  readonly identification: RobotIdentificationV1
  readonly assetReferenceIds: readonly string[]
  readonly sourceConventions: Readonly<Record<string, SourceConventionV5>>
  readonly links: readonly RobotLinkDefinitionV5[]
  readonly joints: readonly RobotJointDefinitionV5[]
  readonly frames: readonly FrameDefinitionV5[]
  readonly excludedGeometryOccurrenceKeys: readonly string[]
}

export interface RobotInstanceV5 {
  readonly id: string
  readonly name: string
  readonly definitionId: string
  readonly serialNumber: string
  readonly controllerId: string
  readonly visible: boolean
  readonly baseParentFrameId: string
  readonly localBasePose: RigidTransformV5
  readonly initialJointValues: Readonly<Record<string, number>>
  readonly jointSource: 'simulation' | 'manual' | `opcua:${string}`
  readonly frameSources: Readonly<Record<string, 'simulation' | 'manual' | `opcua:${string}`>>
  readonly selectedToolFrameId: string
  readonly selectedTcpFrameId: string
  readonly numericStatus: NumericStatusV5
  readonly intentionalMountEntityId: string | null
}
```

Recreate the closed V4 asset, scene, geometry, Frame, Robot-link/Joint, entity, and group field sets under V5 names without importing V4; change only their referenced type suffixes and the coordinate convention literal specified below.

Define the OPC UA contract exactly:

```ts
export interface OpcUaEndpointV5 {
  readonly endpointId: string
  readonly name: string
  readonly endpointUrl: string
  readonly enabled: boolean
  readonly publishingIntervalMs: number
  readonly reconnectDelayMs: number
}

export type OpcUaProjectTargetV5 =
  | { readonly type: 'logical-signal'; readonly signalId: string }
  | { readonly type: 'robot-joint'; readonly robotId: string; readonly jointId: string }
  | { readonly type: 'robot-frame'; readonly robotId: string; readonly frameId: string }
  | { readonly type: 'robot-status'; readonly robotId: string }
  | { readonly type: 'entity-frame'; readonly entityId: string; readonly frameId: string }
  | { readonly type: 'entity-status'; readonly entityId: string }

export interface OpcUaMappingLeafV5 {
  readonly leafPath: readonly (string | number)[]
  readonly projectPath: readonly (string | number)[]
  readonly projectTarget: OpcUaProjectTargetV5
  readonly opcUaDataType: 'Boolean' | 'SByte' | 'Byte' | 'Int16' | 'UInt16' | 'Int32' | 'UInt32' | 'Float' | 'Double' | 'String'
  readonly projectDataType: 'boolean' | 'integer' | 'number' | 'string'
  readonly scale: number
  readonly offset: number
  readonly unit: string
  readonly required: boolean
}

export interface OpcUaMappingV5 {
  readonly id: string
  readonly endpointId: string
  readonly nodeAddress: OpcUaNodeAddressV1
  readonly direction: 'read' | 'write' | 'readWrite'
  readonly publishingIntervalMs?: number
  readonly coherenceGroupId: string | null
  readonly interpolationMode: 'none' | 'linear' | 'shortest-quaternion' | 'revolute-wrapped'
  readonly coordinateConvention: 'project-v5-z-up-metres-quaternion-xyzw'
  readonly leaves: readonly OpcUaMappingLeafV5[]
}

export interface OpcUaBridgeRouteV5 {
  readonly id: string
  readonly sourceMappingId: string
  readonly destinationMappingId: string
  readonly direction: 'forward'
  readonly scale: number
  readonly offset: number
  readonly unit: string
}

export interface OpcUaProjectConfigurationV5 {
  readonly mode: 'off' | 'client' | 'server' | 'bridge'
  readonly endpoints: readonly OpcUaEndpointV5[]
  readonly mappings: readonly OpcUaMappingV5[]
  readonly bridgeRoutes: readonly OpcUaBridgeRouteV5[]
}
```

`OpcUaProjectConfigurationV5` contains only `mode`, `endpoints`, `mappings`, and `bridgeRoutes`. Bridge routes reference Mapping IDs only; listener/advertised Server fields remain deployment-owned runtime status and never enter this Project contract.

```ts
export interface WorkcellProjectV5 {
  readonly schemaVersion: 5
  readonly projectId: string
  readonly revisionId: string
  readonly metadata: ProjectMetadataV5
  readonly assetReferences: readonly AssetReferenceV5[]
  readonly scene: ProjectSceneV5
  readonly robotDefinitions: readonly RobotDefinitionV5[]
  readonly controllers: readonly RobotControllerV5[]
  readonly robots: readonly RobotInstanceV5[]
  readonly spatialEntities: readonly SpatialEntityV5[]
  readonly sceneGroups: readonly SceneGroupV5[]
  readonly logicalSignals: readonly LogicalSignalV1[]
  readonly jobs: readonly RobotJobV5[]
  readonly opcUa: OpcUaProjectConfigurationV5
}
```

- [ ] **Step 4: Implement closed shape validation and logical scalar bounds**

Use `validation-support.ts` to reject accessors, symbols, sparse arrays, custom prototypes, unknown fields, non-finite numbers, invalid UTF-8 bounds, and caller-owned mutations. Validate logical values with this public function:

```ts
export function utf8Length(value: string): number {
  return new TextEncoder().encode(value).byteLength
}

export function validateLogicalSignalValueV1(
  dataType: LogicalSignalDataTypeV1,
  value: unknown,
  path: string,
): LogicalSignalValueV1 {
  if (dataType === 'Boolean' && typeof value === 'boolean') return value
  if (dataType === 'String' && typeof value === 'string' && utf8Length(value) <= 4_096) return value
  if (dataType === 'Int32' && Number.isInteger(value) && Number(value) >= -2_147_483_648 && Number(value) <= 2_147_483_647) return Number(value)
  if (dataType === 'UInt32' && Number.isInteger(value) && Number(value) >= 0 && Number(value) <= 4_294_967_295) return Number(value)
  if (dataType === 'Double' && typeof value === 'number' && Number.isFinite(value)) return value
  return failProjectV5('LOGICAL_SIGNAL_VALUE_TYPE_MISMATCH', path, `${dataType} initial value is invalid.`)
}
```

For this task, `validateWorkcellProjectV5` must preflight schema 5, clone plain data, validate every exact closed shape/root key, validate logical scalar bounds, and deep-freeze the returned clone. Task 3 extends this same function with cross-reference, semantic, and budget validation; do not add those future rules or a placeholder no-op reference validator here.

- [ ] **Step 5: Run GREEN and commit the aggregate**

```powershell
npm run test:run -- src/core/project-v5/validate-shape.test.ts
npm run build:gateway
git add src/core/project-v5/types.ts src/core/project-v5/logical-signal.ts src/core/project-v5/validation-support.ts src/core/project-v5/validate-shape.ts src/core/project-v5/validate-shape.test.ts src/core/project-v5/validate.ts src/core/project-v5/test-support.ts src/core/project-v5/index.ts
git diff --cached --check
git commit -m "feat: define project v5 aggregate"
```

Expected: the focused tests and Gateway TypeScript compilation PASS.

### Task 3: Enforce V5 References, Job Semantics, and OPC UA Budgets

**Files:**
- Create: `src/core/project-v5/validate-references.ts`
- Test: `src/core/project-v5/validate-references.test.ts`
- Modify: `src/core/project-v5/validate.ts`
- Modify: `src/core/project-v5/test-support.ts`

**Interfaces:**
- Consumes: Task 2 closed `WorkcellProjectV5` shapes.
- Produces: complete `validateWorkcellProjectV5(value): WorkcellProjectV5` semantics used by codec, repository, samples, Gateway, and Milestone 3.

- [ ] **Step 1: Write failing cross-reference and exact/plus-one tests**

```ts
it.each([
  ['logicalSignals', 1_024, 1_025, 'LOGICAL_SIGNAL_LIMIT_EXCEEDED'],
  ['opcUaMappings', 128, 129, 'OPCUA_STRUCTURE_ROOT_LIMIT_EXCEEDED'],
  ['opcUaLeaves', 1_024, 1_025, 'OPCUA_PROJECT_LEAF_LIMIT_EXCEEDED'],
  ['jobInstructions', 2_048, 2_049, 'TOTAL_JOB_INSTRUCTION_LIMIT_EXCEEDED'],
])('%s accepts %i and rejects %i', (field, exact, plusOne, code) => {
  expect(() => validateWorkcellProjectV5(projectV5AtLimit(field, exact))).not.toThrow()
  expect(() => validateWorkcellProjectV5(projectV5AtLimit(field, plusOne))).toThrow(code)
})

it.each([
  ['set-do', 'input', 'JOB_SIGNAL_DIRECTION_INVALID'],
  ['wait-di', 'output', 'JOB_SIGNAL_DIRECTION_INVALID'],
  ['wait-di', 'internal', 'JOB_SIGNAL_DIRECTION_INVALID'],
])('rejects %s against %s', (kind, direction, code) => {
  expect(() => validateWorkcellProjectV5(projectWithInstructionSignalV5(kind, direction)))
    .toThrow(code)
})

it('requires the exact Robot Joint set for every move-joint', () => {
  expect(() => validateWorkcellProjectV5(projectWithMissingMoveJointV5('J2')))
    .toThrow('ROBOT_JOINT_SET_MISMATCH')
})

it('uses Namespace URI when the same logical Node has different session indexes', () => {
  const project = makeMinimalWorkcellProjectV5()
  expect(project.opcUa.mappings[0]!.nodeAddress).toEqual({
    namespaceUri: 'urn:sample:plc', identifierType: 'string', identifier: 'Signals.PartPresent',
  })
  expect(JSON.stringify(project)).not.toMatch(/ns=\d+;/u)
})
```

- [ ] **Step 2: Run the reference test and confirm RED**

```powershell
npm run test:run -- src/core/project-v5/validate-references.test.ts
```

Expected: FAIL because reference/budget validation is not connected.

- [ ] **Step 3: Implement Robot, Controller, Signal, and Job reference rules**

Build ID maps once and enforce this matrix:

```ts
for (const job of project.jobs) {
  const robot = requireReference(robots, job.robotId, 'ROBOT_INSTANCE_NOT_FOUND')
  const definition = requireReference(definitions, robot.definitionId, 'ROBOT_DEFINITION_NOT_FOUND')
  for (const instruction of job.instructions) {
    if (instruction.kind === 'move-joint') expectExactJointIds(instruction.jointValues, definition.joints)
    if (instruction.kind === 'set-do' || instruction.kind === 'wait-di') {
      const signal = requireReference(signals, instruction.signalId, 'LOGICAL_SIGNAL_NOT_FOUND')
      const directionAllowed = instruction.kind === 'set-do'
        ? signal.direction === 'output' || signal.direction === 'bidirectional'
        : signal.direction === 'input' || signal.direction === 'bidirectional'
      if (signal.dataType !== 'Boolean' || !directionAllowed) {
        failProjectV5('JOB_SIGNAL_DIRECTION_INVALID', instruction.id, `${instruction.kind} Signal is incompatible.`)
      }
    }
  }
}
```

Also require each Robot's Definition and Controller, reject unreferenced Controllers, require `frameSources` to contain the exact Definition Frame ID set with valid ownership references, validate Signal robot/entity scopes, validate Attach graspability and Frames, validate nullable Detach parent Frames, allow `maximumDistanceM >= 0`, require `1..2_147_483_647` for WaitDI timeout and Delay duration, and enforce globally unique instruction IDs.

- [ ] **Step 4: Implement Mapping references and approved limits**

For every Mapping, validate its Endpoint, OPC UA source `leafPath` tree, Project destination `projectPath`, data type pair, target reference, per-Endpoint/root/leaf/update budgets, and `(endpointId, nodeAddress, leafPath)` channel uniqueness. Every leaf inside one Mapping must reference the same semantic `projectTarget`; use separate Mapping roots when one structured OPC UA value feeds multiple Robot Joints or otherwise targets more than one Project resource. `leafPath` addresses a component inside the OPC UA root value; `projectPath` addresses the semantic component inside the selected Project target, so a PLC array `[0]..[5]` can map deterministically to Object `positionM[0..2]` and `rpyDegrees[0..2]`. Logical Signal, Joint, and Status targets require `projectPath: []`.

Entity/Robot Frame mappings require exactly these six unique destination paths in this order-independent set:

```ts
const FRAME_PROJECT_PATHS_V5 = Object.freeze([
  ['positionM', 0], ['positionM', 1], ['positionM', 2],
  ['rpyDegrees', 0], ['rpyDegrees', 1], ['rpyDegrees', 2],
] as const)
```

Logical target rules are exact:

```ts
function validateSignalMapping(
  direction: OpcUaMappingV5['direction'],
  leaf: OpcUaMappingLeafV5,
  signal: LogicalSignalV1,
): void {
  const dataTypes = { Boolean: 'Boolean', Int32: 'Int32', UInt32: 'UInt32', Double: 'Double', String: 'String' } as const
  const reject = (code: string): never => failProjectV5(code, '$.opcUa.mappings', 'Logical Signal Mapping is incompatible.')
  if (leaf.opcUaDataType !== dataTypes[signal.dataType]) reject('OPCUA_DATA_TYPE_MISMATCH')
  if (direction === 'read' && signal.direction !== 'input' && signal.direction !== 'bidirectional') reject('OPCUA_SIGNAL_DIRECTION_MISMATCH')
  if (direction === 'write' && signal.direction !== 'output' && signal.direction !== 'bidirectional') reject('OPCUA_SIGNAL_DIRECTION_MISMATCH')
  if (direction === 'readWrite' && signal.direction !== 'bidirectional') reject('OPCUA_SIGNAL_DIRECTION_MISMATCH')
  if ((signal.dataType === 'Boolean' || signal.dataType === 'String') && (leaf.scale !== 1 || leaf.offset !== 0)) reject('OPCUA_SCALE_NOT_APPLICABLE')
}
```

Bridge source/destination IDs resolve only to V5 Mapping IDs; reject echo and directed cycles. No validator recognizes `actions`, `action-reference`, `actionBindings`, raw `nodeId`, or `ns=<index>;...`.

For every read/readWrite target, validate authored ownership against its Endpoint: Robot Joint requires `robot.jointSource === opcua:<endpointId>`; Robot Frame requires `robot.frameSources[frameId] === opcua:<endpointId>`; Object Frame requires the Entity transform/target Moving Frame owner; Entity/Robot Status requires its `NumericStatusV5.sourceOwnership`. Reject multiple enabled read owners for one Project target. A Mapping deletion never changes ownership implicitly; the explicit UI mutation must update both sides atomically. `publish` is not a valid V5 Mapping direction: product Server Actual Variables are generated from the active runtime snapshot, not from Client Mapping records.

- [ ] **Step 5: Run GREEN and commit semantic validation**

```powershell
npm run test:run -- src/core/project-v5
npm run lint
git add src/core/project-v5/validate-references.ts src/core/project-v5/validate-references.test.ts src/core/project-v5/validate.ts src/core/project-v5/test-support.ts
git diff --cached --check
git commit -m "feat: validate project v5 signals and jobs"
```

Expected: all Project V5 Core tests PASS and lint exits 0.

### Task 4: Add Canonical V5 JSON and Strict File Codec

**Files:**
- Create: `src/core/project-v5/canonical-json.ts`
- Test: `src/core/project-v5/canonical-json.test.ts`
- Modify: `src/core/project-v5/index.ts`
- Create: `src/features/project/v5/project-v5-codec.ts`
- Test: `src/features/project/v5/project-v5-codec.test.ts`

**Interfaces:**
- Consumes: `validateWorkcellProjectV5`.
- Produces: `canonicalProjectV5Json`, `canonicalProjectV5Bytes`, `configRevisionForProjectV5`, `encodeProjectV5`, and `decodeProjectV5`.

- [ ] **Step 1: Write failing canonical and rejection tests**

```ts
it('keeps instruction array order while canonicalizing object keys', async () => {
  const project = makeMinimalWorkcellProjectV5()
  expect(canonicalProjectV5Bytes(reverseObjectKeys(project)))
    .toEqual(canonicalProjectV5Bytes(project))
  expect(await configRevisionForProjectV5(project)).toMatch(/^[0-9a-f]{64}$/u)
})

it.each([1, 2, 3, 4])('rejects V%i at the V5 decode boundary', async (schemaVersion) => {
  await expect(decodeProjectV5(new TextEncoder().encode(JSON.stringify({ schemaVersion }))))
    .rejects.toMatchObject({ code: 'PROJECT_SCHEMA_UNSUPPORTED', path: '$.schemaVersion' })
})

it.each(['quality', 'statusCode', 'sourceTimestamp', 'publishedTimestamp', 'owner'])
  ('rejects persisted logical Signal runtime field %s', async (field) => {
    const project = cloneWorkcellProjectV5(makeMinimalWorkcellProjectV5())
    ;(project.logicalSignals[0] as unknown as Record<string, unknown>)[field] = 'runtime-only'
    await expect(decodeProjectV5(new TextEncoder().encode(JSON.stringify(project))))
      .rejects.toMatchObject({ code: 'PROJECT_RECORD_NOT_CLOSED' })
  })
```

- [ ] **Step 2: Run the focused tests and confirm RED**

```powershell
npm run test:run -- src/core/project-v5/canonical-json.test.ts src/features/project/v5/project-v5-codec.test.ts
```

Expected: FAIL because canonical and codec modules do not exist.

- [ ] **Step 3: Implement deterministic JSON and hashing**

```ts
export function canonicalProjectV5Json(project: WorkcellProjectV5): string
export function canonicalProjectV5Bytes(project: WorkcellProjectV5): Uint8Array<ArrayBuffer>
export async function configRevisionForProjectV5(project: WorkcellProjectV5): Promise<string>
```

Validate first; sort record keys lexicographically; preserve every array's semantic order; normalize `-0`; reject non-finite/non-JSON values; UTF-8 encode without whitespace; hash with Web Crypto SHA-256.

- [ ] **Step 4: Implement the strict V5 file boundary**

```ts
export function encodeProjectV5(project: WorkcellProjectV5): Blob {
  return new Blob([canonicalProjectV5Bytes(project)], { type: 'application/json;charset=utf-8' })
}

export async function decodeProjectV5(
  source: Blob | Uint8Array | ArrayBuffer,
): Promise<WorkcellProjectV5>
```

Snapshot genuine cross-realm Blob/Uint8Array/ArrayBuffer values with intrinsic methods, decode fatal UTF-8, parse exactly one JSON value, and call `validateWorkcellProjectV5`. Preserve stable codec codes `PROJECT_JSON_SOURCE_INVALID`, `PROJECT_JSON_ENCODING_INVALID`, and `PROJECT_JSON_PARSE_FAILED` under `ProjectV5CodecError`.

- [ ] **Step 5: Run GREEN and commit the codec**

```powershell
npm run test:run -- src/core/project-v5/canonical-json.test.ts src/features/project/v5/project-v5-codec.test.ts
git add src/core/project-v5/canonical-json.ts src/core/project-v5/canonical-json.test.ts src/core/project-v5/index.ts src/features/project/v5/project-v5-codec.ts src/features/project/v5/project-v5-codec.test.ts
git diff --cached --check
git commit -m "feat: add canonical project v5 codec"
```

### Task 5: Add Standalone V5 IndexedDB Revision Persistence

**Files:**
- Create: `src/features/project/v5/project-v5-db.ts`
- Test: `src/features/project/v5/project-v5-db.test.ts`
- Create: `src/features/project/v5/project-v5-repository.ts`
- Test: `src/features/project/v5/project-v5-repository.test.ts`

**Interfaces:**
- Consumes: Task 4 canonical/codec functions.
- Produces: `ProjectDatabaseV5`, `PreparedProjectRevisionV5`, `ProjectRevisionRecordV5`, `ProjectRepositoryV5`, and `createProjectRepositoryV5`.

- [ ] **Step 1: Write failing standalone-database and repository tests**

```ts
it('uses a standalone V5 database and leaves V4 untouched', async () => {
  const legacy = new Dexie('robot-sim-project-v4')
  legacy.version(1).stores({ marker: '&key' })
  await legacy.table('marker').put({ key: 'sentinel', value: 'unchanged' })
  const database = new ProjectDatabaseV5()
  expect(database.name).toBe('robot-sim-project-v5')
  await database.open()
  await expect(legacy.table('marker').get('sentinel')).resolves.toEqual({ key: 'sentinel', value: 'unchanged' })
})

it('round-trips only canonical V5 content', async () => {
  const repository = createProjectRepositoryV5({ database, now: () => NOW })
  const project = makeMinimalWorkcellProjectV5()
  const prepared = await repository.prepareRevision(project)
  await repository.commitPreparedRevision(null, prepared, 'commit-v5-a')
  await repository.finalizePublication('commit-v5-a')
  await expect(repository.readActive()).resolves.toEqual(project)
})
```

- [ ] **Step 2: Run persistence tests and confirm RED**

```powershell
npm run test:run -- src/features/project/v5/project-v5-db.test.ts src/features/project/v5/project-v5-repository.test.ts
```

Expected: FAIL because the V5 database and repository do not exist.

- [ ] **Step 3: Implement the new version-1 database**

```ts
export class ProjectDatabaseV5 extends Dexie {
  projectRevisions!: Table<StoredProjectRevisionV5, string>
  projectPointers!: Table<StoredProjectPointerV5, string>
  projectCommitTokens!: Table<StoredProjectCommitTokenV5, string>

  constructor(name = 'robot-sim-project-v5') {
    super(name)
    this.version(1).stores({
      projectRevisions: '&revisionId,projectId',
      projectPointers: '&key,state,revisionId',
      projectCommitTokens: '&commitToken,revisionId',
    })
  }
}
```

Do not declare an upgrade callback and do not open `robot-sim-project`, `robot-sim-project-v4`, or any source-blob table.

- [ ] **Step 4: Implement the crash-consistent repository contract**

```ts
export interface ProjectRepositoryV5 {
  prepareRevision(candidate: WorkcellProjectV5): Promise<PreparedProjectRevisionV5>
  materializePreparedProject(prepared: PreparedProjectRevisionV5): WorkcellProjectV5
  discardPreparedRevision(prepared: PreparedProjectRevisionV5): void
  commitPreparedRevision(expectedRevisionId: string | null, prepared: PreparedProjectRevisionV5, commitToken: string): Promise<void>
  finalizePublication(commitToken: string): Promise<void>
  compensatePublication(commitToken: string): Promise<void>
  readRevision(revisionId: string): Promise<ProjectRevisionRecordV5 | null>
  readActive(): Promise<WorkcellProjectV5 | null>
  readPointer(): Promise<StoredProjectPointerV5 | null>
  garbageCollect(): Promise<void>
}
```

Use opaque prepared-object authority, permanently reserved commit tokens, immutable revision collision checks, `stable|publishing` active pointers, expected-revision comparison, compensation to the previous stable pointer, canonical JSON/hash revalidation on every read, and garbage collection retaining current plus previous publishing revision.

- [ ] **Step 5: Prove failures and commit persistence**

Run:

```powershell
npm run test:run -- src/features/project/v5/project-v5-db.test.ts src/features/project/v5/project-v5-repository.test.ts
npm run lint
git add src/features/project/v5/project-v5-db.ts src/features/project/v5/project-v5-db.test.ts src/features/project/v5/project-v5-repository.ts src/features/project/v5/project-v5-repository.test.ts
git diff --cached --check
git commit -m "feat: persist project v5 revisions"
```

Expected: tests cover stale expected revision, revision collision, forged/consumed prepared handles, publishing-pointer crash, compensation, token reuse, corrupted/noncanonical rows, and retained-revision garbage collection; all PASS.

### Task 6: Add the V5 Logical-I/O Job Sample and Core Gate

**Files:**
- Create: `src/features/project/v5/logical-io-job-sample-v5.ts`
- Test: `src/features/project/v5/logical-io-job-sample-v5.test.ts`
- Create: `src/core/project-v5/core-boundary.test.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: all prior V5 Core and codec interfaces.
- Produces: `createLogicalIoJobSampleV5`, `LOGICAL_IO_JOB_SAMPLE_IDS_V5`, and the verified V5 foundation consumed by Milestones 3–6.

- [ ] **Step 1: Write the failing sample acceptance test**

```ts
it('creates a canonical V5 sample with every explicit instruction kind', async () => {
  const project = createLogicalIoJobSampleV5({
    projectId: 'sample-v5', revisionId: 'sample-v5-r1', nowIso: '2026-07-19T00:00:00.000Z',
  })
  const kinds = new Set(project.jobs[0]!.instructions.map(({ kind }) => kind))
  expect(kinds).toEqual(new Set(['move-joint', 'set-do', 'wait-di', 'delay', 'attach', 'detach']))
  expect(project.robotDefinitions[0]!.identification.motionDeviceCategory).toBe('ARTICULATED_ROBOT')
  expect(project.controllers).toHaveLength(1)
  expect(project.logicalSignals.map(({ direction }) => direction).sort()).toEqual(['input', 'output'])
  expect(JSON.stringify(project)).not.toMatch(/"actions"|action-reference|actionBindings|ns=\d+;/u)
  await expect(decodeProjectV5(encodeProjectV5(project))).resolves.toEqual(project)
})
```

- [ ] **Step 2: Run the sample test and confirm RED**

```powershell
npm run test:run -- src/features/project/v5/logical-io-job-sample-v5.test.ts
```

Expected: FAIL because the sample factory does not exist.

- [ ] **Step 3: Implement one deterministic contract sample**

Create one source-only two-Joint articulated Robot, its separate Controller, one graspable Box with a grasp Frame, Boolean `PartPresent` input and `ClampCommand` output Signals, and Namespace-URI mappings. Build the Job from these exact instruction groups:

```ts
const poses = [
  [0, 0], [10, -10], [20, -20], [30, -30], [40, -20],
  [50, -10], [40, 0], [30, 10], [20, 20], [10, 10], [0, 0],
] as const

const move = (
  id: string,
  [J1, J2]: readonly [number, number],
  speedPercentToNext: number,
): RobotJobInstructionV1 => ({
  id,
  kind: 'move-joint',
  jointValues: { J1, J2 },
  speedPercentToNext,
})

const instructions: RobotJobInstructionV1[] = [
  ...poses.slice(0, 2).map((values, index) => move(`move-${index + 1}`, values, 30)),
  { id: 'wait-part-present', kind: 'wait-di', signalId: 'signal-part-present', expected: true, timeoutMs: 5_000 },
  { id: 'clamp-on', kind: 'set-do', signalId: 'signal-clamp-command', value: true },
  { id: 'clamp-delay', kind: 'delay', durationMs: 250 },
  { id: 'attach-part', kind: 'attach', objectId: 'entity-part', toolFrameId: 'Tool', objectGraspFrameId: 'part-grasp', maximumDistanceM: 0.05 },
  ...poses.slice(2, 9).map((values, index) => move(`move-${index + 3}`, values, 40)),
  { id: 'detach-part', kind: 'detach', objectId: 'entity-part', targetParentFrameId: 'world' },
  { id: 'clamp-off', kind: 'set-do', signalId: 'signal-clamp-command', value: false },
  ...poses.slice(9).map((values, index) => move(`move-${index + 10}`, values, 30)),
]
```

The sample is a Core/persistence fixture, not a claim that Milestone 3 execution or Milestone 6 browser acceptance already works.

- [ ] **Step 4: Add the Core isolation test and focused script**

The boundary test scans every `src/core/project-v5/**/*.ts` production import and fails on React, Three.js, Node built-ins, DOM/WebSocket state, `node-opcua`, or `project-v4`. Add:

```json
{
  "scripts": {
    "verify:v5-core": "npm run test:run -- src/core/project-v5 src/features/project/v5 && npm run lint && npm run build:gateway && npm run build"
  }
}
```

- [ ] **Step 5: Run the focused and full regression gates**

```powershell
npm run verify:v5-core
npm run test:run
git diff --check
git status --short
```

Expected: focused V5 tests, lint, Gateway build, browser build, and the complete Vitest suite all PASS; status lists only intentional V5/plan changes plus pre-existing untracked CAD/artifact paths.

- [ ] **Step 6: Commit the sample and gate**

```powershell
git add package.json src/core/project-v5/core-boundary.test.ts src/features/project/v5/logical-io-job-sample-v5.ts src/features/project/v5/logical-io-job-sample-v5.test.ts
git diff --cached --check
git commit -m "test: prove project v5 core contracts"
```

## Completion Evidence

Record the focused/full Vitest file and test counts, lint result, Gateway/browser build result, canonical sample config revision, and `git status --short` in the implementation handoff. Completion requires proof that V1–V4 imports fail before V5 DB writes, V4 databases remain unchanged, every sample instruction has a stable ID, every OPC UA address contains a Namespace URI rather than an Index, and no runtime Signal fields enter canonical JSON.
