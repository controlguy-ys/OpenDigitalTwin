# Project V5 Command Authority Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the Browser UI and future Codex operator tools one typed, previewable, revision-safe authority for Project V5 changes and simulation control.

**Architecture:** Define a closed Project command protocol in `src/core`, project each command into a validated candidate without side effects, and publish candidates through the existing atomic Project V5 mutation service. A five-minute preview registry and idempotency registry sit above that authority. Simulation commands remain separate from durable Project changes and act only on the active Browser runtime bundle.

**Tech Stack:** TypeScript 6.0.3, Project V5 validators, Vitest 4.1.10, React 19, Zustand runtime stores, existing Project publication coordinator.

## Global Constraints

- Project V5 remains the sole durable Project model.
- Every durable mutation requires `expectedRevisionId`.
- Preview never publishes or changes runtime state.
- Apply publishes the exact candidate represented by the preview.
- The Browser is the Project command owner.
- Human UI and remote operator paths call the same services.
- No external OPC UA or PLC write is introduced.
- Legacy V4 command services are not reused.
- Stage only files owned by the current task.

---

## File Structure

### Create

- `src/core/project-commands-v1/types.ts`
- `src/core/project-commands-v1/validate.ts`
- `src/core/project-commands-v1/index.ts`
- `src/core/project-commands-v1/validate.test.ts`
- `src/features/project/v5/project-command-projector-v5.ts`
- `src/features/project/v5/project-command-projector-v5.test.ts`
- `src/features/project/v5/project-command-preview-registry-v5.ts`
- `src/features/project/v5/project-command-preview-registry-v5.test.ts`
- `src/features/project/v5/project-command-idempotency-registry-v5.ts`
- `src/features/project/v5/project-command-idempotency-registry-v5.test.ts`
- `src/features/project/v5/project-command-service-v5.ts`
- `src/features/project/v5/project-command-service-v5.test.ts`
- `src/features/project/v5/simulation-command-service-v5.ts`
- `src/features/project/v5/simulation-command-service-v5.test.ts`
- `src/features/project/v5/codex-operator-sample-v5.ts`
- `src/features/project/v5/codex-operator-sample-v5.test.ts`
- `src/features/project/v5/project-sample-service-v5.ts`
- `src/features/project/v5/project-sample-service-v5.test.ts`

### Modify

- `src/features/project/v5/project-v5-mutation-service.ts`
- `src/features/project/v5/project-v5-mutation-service.test.ts`
- `src/features/project/v5/browser-project-resources-v5.ts`
- `src/features/project/v5/browser-project-resources-v5.test.ts`
- `src/app/v5/AppV5.tsx`
- `src/app/v5/AppV5.test.tsx`
- `src/features/connectivity/v5/BindingEditorDialog.tsx`
- `src/features/connectivity/v5/BindingEditorDialog.test.tsx`
- `src/features/jobs/v5/RobotJobWorkspaceV5.tsx`
- `src/features/jobs/v5/RobotJobWorkspaceV5.test.tsx`

---

## Task 1: Define the Closed Project Command Protocol

**Files:**
- Create: `src/core/project-commands-v1/types.ts`
- Create: `src/core/project-commands-v1/validate.ts`
- Create: `src/core/project-commands-v1/index.ts`
- Test: `src/core/project-commands-v1/validate.test.ts`

- [ ] **Step 1: Write failing protocol tests**

Cover all command discriminators, reject unknown keys, reject empty IDs, and prove returned data is detached from caller-owned input.

```ts
import { describe, expect, it } from 'vitest'
import { validateProjectCommandV1 } from './validate.js'

describe('validateProjectCommandV1', () => {
  it('accepts a SetEntityTransform command', () => {
    expect(validateProjectCommandV1({
      type: 'SetEntityTransform',
      entityId: 'entity-1',
      parentFrameId: 'world',
      localPose: {
        positionM: [1, 2, 3],
        quaternion: [0, 0, 0, 1],
      },
    }).type).toBe('SetEntityTransform')
  })

  it('rejects an unregistered command', () => {
    expect(() => validateProjectCommandV1({ type: 'run-arbitrary-code' }))
      .toThrow('PROJECT_COMMAND_TYPE_UNSUPPORTED')
  })
})
```

- [ ] **Step 2: Run the test and confirm failure**

```powershell
npx vitest run src/core/project-commands-v1/validate.test.ts
```

Expected: FAIL because the protocol modules do not exist.

- [ ] **Step 3: Add the exact command union**

Use existing Project V5 domain types rather than duplicating entity, robot, job, pose, or mapping shapes.

```ts
import type {
  OpcUaMappingV5,
  RigidTransformV5,
  RobotDefinitionV5,
  RobotJobInstructionV1,
  RobotJobV5,
  SpatialEntityV5,
} from '../project-v5/index.js'

export type ProjectCommandV1 =
  | {
      readonly type: 'SetEntityTransform'
      readonly entityId: string
      readonly parentFrameId: string
      readonly localPose: RigidTransformV5
    }
  | { readonly type: 'SetEntityVisibility'; readonly entityId: string; readonly visible: boolean }
  | { readonly type: 'CreatePrimitive'; readonly entity: SpatialEntityV5 }
  | { readonly type: 'DeleteEntity'; readonly entityId: string }
  | { readonly type: 'SetEntityGroup'; readonly entityId: string; readonly groupId: string | null }
  | { readonly type: 'UpdateOpcUaBinding'; readonly mappingId: string; readonly mapping: OpcUaMappingV5 | null }
  | {
      readonly type: 'UpdateRobotBase'
      readonly robotId: string
      readonly baseParentFrameId: string
      readonly localBasePose: RigidTransformV5
    }
  | {
      readonly type: 'UpdateRobotMechanics'
      readonly definitionId: string
      readonly mechanics: Pick<
        RobotDefinitionV5,
        | 'mechanics'
        | 'assetReferenceIds'
        | 'sourceConventions'
        | 'links'
        | 'joints'
        | 'frames'
        | 'excludedGeometryOccurrenceKeys'
      >
    }
  | { readonly type: 'CreateJob'; readonly job: RobotJobV5 }
  | {
      readonly type: 'UpdateJobStep'
      readonly jobId: string
      readonly stepId: string
      readonly step: RobotJobInstructionV1
    }
  | {
      readonly type: 'ReorderJobStep'
      readonly jobId: string
      readonly stepId: string
      readonly beforeStepId: string | null
    }
  | { readonly type: 'DeleteJobStep'; readonly jobId: string; readonly stepId: string }

export interface ProjectChangeRequestV1 {
  readonly expectedRevisionId: string
  readonly commands: readonly ProjectCommandV1[]
}

export interface ProjectChangePreviewV1 {
  readonly previewId: string
  readonly projectId: string
  readonly baseRevisionId: string
  readonly proposedRevisionId: string
  readonly normalizedCommands: readonly ProjectCommandV1[]
  readonly affectedEntities: readonly {
    readonly kind: 'entity' | 'robot' | 'job' | 'opcua-mapping'
    readonly id: string
  }[]
  readonly warnings: readonly string[]
  readonly validationResult: {
    readonly valid: true
    readonly errors: readonly never[]
  }
  readonly expiresAt: string
}

export interface ProjectChangeApplyRequestV1 {
  readonly previewId: string
  readonly expectedRevisionId: string
  readonly idempotencyKey: string
}

export interface ProjectChangeApplyResultV1 {
  readonly projectId: string
  readonly previousRevisionId: string
  readonly revisionId: string
  readonly runtimeEpoch: number
  readonly correlationId: string
  readonly publicationStatus: 'published'
  readonly observedAt: string
  readonly freshness: 'live'
}
```

- [ ] **Step 4: Implement strict validation**

`validateProjectCommandV1` must:

- accept only the eleven discriminators above;
- require exact object keys per discriminator;
- delegate poses, jobs, entities, robot definitions, and mappings through a full `validateWorkcellProjectV5` fixture or existing exported leaf validators;
- require `CreatePrimitive.entity.geometry.kind` to be `box` or `cylinder`;
- preserve `RobotDefinitionV5.id`, name, and identification when applying `UpdateRobotMechanics`;
- require `UpdateJobStep.step.id === stepId`;
- return a `structuredClone`-detached, frozen command.

- [ ] **Step 5: Export the protocol and run tests**

```powershell
npx vitest run src/core/project-commands-v1/validate.test.ts
npm run typecheck
```

Expected: PASS with no TypeScript errors.

- [ ] **Step 6: Commit the protocol**

```powershell
git add -- src/core/project-commands-v1
git commit -m "feat: define Project V5 command protocol"
```

---

## Task 2: Project Commands into a Candidate Revision

**Files:**
- Create: `src/features/project/v5/project-command-projector-v5.ts`
- Test: `src/features/project/v5/project-command-projector-v5.test.ts`

- [ ] **Step 1: Write failing projector tests**

Test one case for each command and these invariants:

- the base Project object is not mutated;
- referenced entity, robot, definition, job, instruction, group, and frame IDs must exist;
- create IDs must not already exist;
- deletes fail if a job, attachment definition, OPC UA mapping, or robot mount still references the entity;
- command order is significant;
- the returned candidate passes `validateWorkcellProjectV5`.

```ts
const candidate = projectCommandsV5(baseProject, [
  { type: 'SetEntityVisibility', entityId: 'box-1', visible: false },
  { type: 'SetEntityGroup', entityId: 'box-1', groupId: 'group-1' },
])

expect(candidate.spatialEntities.find(({ id }) => id === 'box-1')).toMatchObject({
  visible: false,
  groupId: 'group-1',
})
expect(baseProject.spatialEntities.find(({ id }) => id === 'box-1')).toMatchObject({
  visible: true,
  groupId: null,
})
```

- [ ] **Step 2: Run the test and confirm failure**

```powershell
npx vitest run src/features/project/v5/project-command-projector-v5.test.ts
```

Expected: FAIL because `projectCommandsV5` does not exist.

- [ ] **Step 3: Implement deterministic projection**

Expose exactly:

```ts
export function projectCommandsV5(
  base: WorkcellProjectV5,
  commands: readonly ProjectCommandV1[],
): WorkcellProjectV5
```

Implementation rules:

1. Validate and clone `base`.
2. Apply commands sequentially to cloned arrays.
3. Preserve `projectId`, `revisionId`, and metadata; revision stamping belongs to the mutation service.
4. Do not generate IDs or read the clock.
5. Validate the complete result with `validateWorkcellProjectV5`.
6. Throw `ProjectCommandProjectionError` with stable `code`, `commandIndex`, and `path`.

Use error codes:

```ts
export type ProjectCommandProjectionErrorCodeV5 =
  | 'PROJECT_COMMAND_TARGET_NOT_FOUND'
  | 'PROJECT_COMMAND_TARGET_DUPLICATE'
  | 'PROJECT_COMMAND_REFERENCE_INVALID'
  | 'PROJECT_COMMAND_OWNERSHIP_CONFLICT'
  | 'PROJECT_COMMAND_CANDIDATE_INVALID'
```

- [ ] **Step 4: Run focused tests**

```powershell
npx vitest run src/features/project/v5/project-command-projector-v5.test.ts
```

Expected: PASS for all commands and invariants.

- [ ] **Step 5: Commit the projector**

```powershell
git add -- src/features/project/v5/project-command-projector-v5.ts src/features/project/v5/project-command-projector-v5.test.ts
git commit -m "feat: project typed commands into Project V5"
```

---

## Task 3: Allow Exact Candidate Publication

**Files:**
- Modify: `src/features/project/v5/project-v5-mutation-service.ts`
- Modify: `src/features/project/v5/project-v5-mutation-service.test.ts`

- [ ] **Step 1: Write failing prepare and exact-commit tests**

Add a test proving the service can stamp and publish an already projected candidate while preserving the previewed domain content.

```ts
const prepared = mutations.prepareCandidate({
  expectedRevisionId: 'revision-active',
  candidate: projected,
})
expect(prepared.proposedRevisionId).not.toBe('revision-active')

const result = await mutations.commitCandidate({
  expectedRevisionId: 'revision-active',
  description: 'Apply Project command preview',
  candidate: prepared.candidate,
})

expect(result.project.spatialEntities).toEqual(projected.spatialEntities)
expect(result.revisionId).toBe(prepared.proposedRevisionId)
expect(result.project.metadata.createdAt).toBe(active.project.metadata.createdAt)
```

Also test stale revision rejection and invalid candidate rejection.

- [ ] **Step 2: Run the test and confirm failure**

```powershell
npx vitest run src/features/project/v5/project-v5-mutation-service.test.ts
```

Expected: FAIL because `prepareCandidate` and `commitCandidate` are not part of the service.

- [ ] **Step 3: Add pure preparation and exact commit to the mutation port**

```ts
prepareCandidate(request: {
  readonly expectedRevisionId: string
  readonly candidate: WorkcellProjectV5
}): {
  readonly baseRevisionId: string
  readonly proposedRevisionId: string
  readonly candidate: WorkcellProjectV5
}
```

`prepareCandidate` performs no persistence or publication. It verifies the active revision, validates the projected domain content, preserves Project identity and `metadata.createdAt`, creates the proposed revision ID, stamps `metadata.updatedAt`, validates the result, and returns a detached frozen candidate.

```ts
commitCandidate(request: {
  readonly expectedRevisionId: string
  readonly description: string
  readonly candidate: WorkcellProjectV5
}): Promise<PublishedProjectV5>
```

Inside the existing serialized queue:

1. reject recovery-required state;
2. verify `expectedRevisionId` against the active publication;
3. validate a detached candidate;
4. reject a changed `projectId`;
5. require the candidate revision to differ from the active revision;
6. require `metadata.createdAt` to match the active Project;
7. recheck active revision;
8. call `publication.replace` with the exact prepared candidate.

Refactor `mutate` to call the same private preparation function so both paths have identical revision and metadata behavior.

- [ ] **Step 4: Run mutation and publication tests**

```powershell
npx vitest run src/features/project/v5/project-v5-mutation-service.test.ts src/features/project/v5/project-v5-publication.test.ts
```

Expected: PASS, including compensation behavior already covered by publication tests.

- [ ] **Step 5: Commit the mutation extension**

```powershell
git add -- src/features/project/v5/project-v5-mutation-service.ts src/features/project/v5/project-v5-mutation-service.test.ts
git commit -m "feat: publish exact Project V5 candidates"
```

---

## Task 4: Add Preview and Idempotency Registries

**Files:**
- Create: `src/features/project/v5/project-command-preview-registry-v5.ts`
- Create: `src/features/project/v5/project-command-preview-registry-v5.test.ts`
- Create: `src/features/project/v5/project-command-idempotency-registry-v5.ts`
- Create: `src/features/project/v5/project-command-idempotency-registry-v5.test.ts`

- [ ] **Step 1: Write failing registry tests**

Preview tests must prove:

- default lifetime is exactly `300_000` ms;
- preview lookup returns a detached snapshot;
- expired previews throw `PROJECT_PREVIEW_EXPIRED`;
- consuming a preview removes it;
- invalidating a base revision removes all previews based on it.

Idempotency tests must prove:

- same key and same request fingerprint returns the stored result;
- same key and different fingerprint throws `COMMAND_ID_CONFLICT`;
- records expire after five minutes;
- no failed operation is stored as success.

- [ ] **Step 2: Run and confirm failure**

```powershell
npx vitest run src/features/project/v5/project-command-preview-registry-v5.test.ts src/features/project/v5/project-command-idempotency-registry-v5.test.ts
```

Expected: FAIL because both registries are absent.

- [ ] **Step 3: Implement the preview registry**

Store this internal record:

```ts
export interface StoredProjectCommandPreviewV5 {
  readonly previewId: string
  readonly baseRevisionId: string
  readonly expiresAtMs: number
  readonly commands: readonly ProjectCommandV1[]
  readonly candidate: WorkcellProjectV5
  readonly affectedEntities: ProjectChangePreviewV1['affectedEntities']
  readonly warnings: readonly string[]
}
```

Constructor dependencies must be injected:

```ts
createProjectCommandPreviewRegistryV5({
  nowMs,
  createPreviewId,
  lifetimeMs: 300_000,
})
```

- [ ] **Step 4: Implement the idempotency registry**

Expose:

```ts
read<Result>(key: string, fingerprint: string): Result | null
store<Result>(key: string, fingerprint: string, result: Result): Result
prune(): void
```

Validate keys as non-empty printable strings with maximum length 128.

- [ ] **Step 5: Run focused tests and commit**

```powershell
npx vitest run src/features/project/v5/project-command-preview-registry-v5.test.ts src/features/project/v5/project-command-idempotency-registry-v5.test.ts
git add -- src/features/project/v5/project-command-preview-registry-v5.ts src/features/project/v5/project-command-preview-registry-v5.test.ts src/features/project/v5/project-command-idempotency-registry-v5.ts src/features/project/v5/project-command-idempotency-registry-v5.test.ts
git commit -m "feat: track Project command previews"
```

---

## Task 5: Build the Shared Project Command Service

**Files:**
- Create: `src/features/project/v5/project-command-service-v5.ts`
- Test: `src/features/project/v5/project-command-service-v5.test.ts`

- [ ] **Step 1: Write failing service tests**

Cover:

- preview returns ID, base revision, expiry, count, and deterministic summaries;
- preview does not call `commitCandidate`;
- apply publishes the stored candidate;
- apply rejects a different expected revision;
- apply rejects expired preview;
- apply is idempotent for the same key;
- a successful apply invalidates all previews based on the old revision;
- a publication failure leaves no successful idempotency record.

- [ ] **Step 2: Define the service interface**

```ts
export interface ProjectCommandServiceV5 {
  previewChange(request: ProjectChangeRequestV1): ProjectChangePreviewV1
  applyChange(request: ProjectChangeApplyRequestV1): Promise<ProjectChangeApplyResultV1>
}
```

Dependencies:

```ts
export interface ProjectCommandServiceDependenciesV5 {
  readonly mutations: Pick<
    ProjectV5MutationService,
    'readPublished' | 'prepareCandidate' | 'commitCandidate'
  >
  readonly previews: ProjectCommandPreviewRegistryV5
  readonly idempotency: ProjectCommandIdempotencyRegistryV5
  readonly readRuntimeEpoch: () => number
  readonly createCorrelationId: () => string
}
```

- [ ] **Step 3: Implement preview**

`previewChange` must synchronously:

1. read the active Project;
2. require `request.expectedRevisionId` to match;
3. validate all commands;
4. run `projectCommandsV5`;
5. call `mutations.prepareCandidate` to assign `proposedRevisionId`;
6. derive stable affected entity records from the normalized commands;
7. store the normalized commands and exact prepared candidate;
8. return `projectId`, both revision IDs, normalized commands, affected entities, warnings, validation result, and expiry.

- [ ] **Step 4: Implement apply**

`applyChange` must:

1. validate request strings;
2. fingerprint `{previewId, expectedRevisionId}`;
3. return a stored idempotent result if present;
4. read and consume the preview;
5. verify both expected and current revision equal the preview base revision;
6. call `commitCandidate`;
7. create a correlation ID and read the committed runtime epoch;
8. return the approved `ProjectChangeApplyResultV1` shape;
9. store the result under the idempotency key;
10. invalidate old-revision previews.

Map stale revision failures at this service boundary to `PROJECT_REVISION_CONFLICT`. Include `$.expectedRevisionId`, the expected and actual revision IDs, correlation ID, and the two recovery actions from the approved design.

- [ ] **Step 5: Run tests and commit**

```powershell
npx vitest run src/features/project/v5/project-command-service-v5.test.ts
git add -- src/features/project/v5/project-command-service-v5.ts src/features/project/v5/project-command-service-v5.test.ts
git commit -m "feat: add shared Project command authority"
```

---

## Task 6: Build the Shared Simulation Command Service

**Files:**
- Create: `src/features/project/v5/simulation-command-service-v5.ts`
- Test: `src/features/project/v5/simulation-command-service-v5.test.ts`

- [ ] **Step 1: Write failing simulation tests**

Test start, cancel, reset, missing runtime, stale project revision, and non-simulation joint ownership.
Inject a spy for `runtimeGraph.signalWrites` and prove start, cancel, reset, and result reads never invoke an external signal write.

```ts
expect(service.execute({
  projectId: 'project-1',
  revisionId: 'revision-1',
  commandId: 'command-1',
  action: { type: 'start-job', jobId: 'job-1' },
})).toEqual({
  projectId: 'project-1',
  revisionId: 'revision-1',
  runtimeEpoch: 1,
  correlationId: 'command-1',
  acknowledgement: 'ACCEPTED',
  runId: 'run-1',
})
```

Reset must prove:

- playback is quiesced before reset;
- `jobExecutor.reset()` executes once;
- playback resumes after success;
- playback resumes after a thrown reset error;
- durable Project data is unchanged.

- [ ] **Step 2: Define the closed simulation union**

```ts
export type SimulationCommandV1 =
  | { readonly type: 'start-job'; readonly jobId: string }
  | {
      readonly type: 'cancel-job'
      readonly robotId: string
      readonly reason: string
    }
  | { readonly type: 'reset-simulation' }

export interface SimulationExecuteRequestV1 {
  readonly projectId: string
  readonly revisionId: string
  readonly commandId: string
  readonly action: SimulationCommandV1
}

export type SimulationExecuteResultV1 =
  | {
      readonly projectId: string
      readonly revisionId: string
      readonly runtimeEpoch: number
      readonly correlationId: string
      readonly acknowledgement: 'ACCEPTED'
      readonly runId: string
    }
  | {
      readonly projectId: string
      readonly revisionId: string
      readonly runtimeEpoch: number
      readonly correlationId: string
      readonly acknowledgement: 'COMPLETED'
    }

export interface SimulationExecutionResultV1 {
  readonly projectId: string
  readonly revisionId: string
  readonly runtimeEpoch: number
  readonly correlationId: string
  readonly state: 'ACCEPTED' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'CANCELLED'
  readonly observedAt: string
  readonly freshness: 'live'
  readonly failureCode: string | null
  readonly message: string
}
```

Expose:

```ts
export interface SimulationCommandServiceV5 {
  execute(request: SimulationExecuteRequestV1): SimulationExecuteResultV1
  getResult(correlationId: string): SimulationExecutionResultV1
}
```

- [ ] **Step 3: Implement against the active runtime bundle**

Use `BrowserRuntimeBundleCellV5.readActiveState()`.

- Require active bundle and matching `projectId` and `projectRevisionId`.
- Deduplicate `commandId`; same input returns the original acknowledgement and conflicting reuse throws `COMMAND_ID_CONFLICT`.
- For start, find the Job in `bundle.project.jobs`, verify all robot joints have `jointSource === 'simulation'`, and reject any Job containing `set-do` with `SIMULATION_EXTERNAL_WRITE_NOT_ALLOWED`.
- Delegate to `runtimeGraph.playback.startJob`.
- After start acknowledgement, observe `runtimeGraph.jobExecutor.waitForTerminal(runId)` and update the bounded result registry without blocking the acknowledgement.
- For cancel, delegate to `runtimeGraph.playback.cancelRobotJob`.
- For reset, call `playback.quiesce()`, `jobExecutor.reset()`, then `playback.resume()` in `finally`.
- Record at most 100 progress and terminal results by correlation ID so `simulation_get_result` can observe them without mutating runtime state.
- Do not call `runtimeGraph.signalWrites`; Job-owned logical output instructions continue through the existing Job executor contract, and the MCP simulation service adds no direct OPC UA write operation.

- [ ] **Step 4: Run focused tests and commit**

```powershell
npx vitest run src/features/project/v5/simulation-command-service-v5.test.ts
git add -- src/features/project/v5/simulation-command-service-v5.ts src/features/project/v5/simulation-command-service-v5.test.ts
git commit -m "feat: centralize simulation commands"
```

---

## Task 7: Add a Deterministic Operator-Safe Sample

**Files:**
- Create: `src/features/project/v5/codex-operator-sample-v5.ts`
- Create: `src/features/project/v5/codex-operator-sample-v5.test.ts`
- Create: `src/features/project/v5/project-sample-service-v5.ts`
- Create: `src/features/project/v5/project-sample-service-v5.test.ts`

- [ ] **Step 1: Write failing sample tests**

Build the sample from the existing logical two-joint Robot fixture and prove:

- Project name is `Project V5 Codex Operator Demo`;
- stable sample ID is `codex-operator-v5`;
- entity ID is `entity-part`;
- Job ID is `job-codex-operator-motion`;
- the Job has at least four `move-joint` instructions and one `delay`;
- the Job contains no `set-do`;
- OPC UA mode is `off` and mappings are empty;
- `validateWorkcellProjectV5` accepts the result.

- [ ] **Step 2: Implement the sample factory**

Expose:

```ts
export const CODEX_OPERATOR_SAMPLE_ID_V5 = 'codex-operator-v5'
export const CODEX_OPERATOR_SAMPLE_JOB_ID_V5 = 'job-codex-operator-motion'

export function createCodexOperatorSampleV5(options: {
  readonly projectId: string
  readonly revisionId: string
  readonly nowIso: string
}): WorkcellProjectV5
```

Reuse geometry-free Robot mechanics, Robot, part, and Frames from `createLogicalIoJobSampleV5`. Replace its Job with a deterministic move/delay-only Job and set OPC UA to `{mode:'off', endpoints:[], mappings:[], bridgeRoutes:[]}`.

- [ ] **Step 3: Add the shared named-sample lifecycle service**

```ts
export interface ProjectSampleServiceV5 {
  load(sampleId: typeof CODEX_OPERATOR_SAMPLE_ID_V5): Promise<PublishedProjectV5>
}
```

The service creates a fresh Project ID and revision ID, then calls the existing whole-Project `mutations.replace` lifecycle. It accepts no file path, URL, Project JSON, or arbitrary sample name.

- [ ] **Step 4: Run tests and commit**

```powershell
npx vitest run src/features/project/v5/codex-operator-sample-v5.test.ts src/features/project/v5/project-sample-service-v5.test.ts
git add -- src/features/project/v5/codex-operator-sample-v5.ts src/features/project/v5/codex-operator-sample-v5.test.ts src/features/project/v5/project-sample-service-v5.ts src/features/project/v5/project-sample-service-v5.test.ts
git commit -m "feat: add deterministic Codex operator sample"
```

---

## Task 8: Wire Browser Resources and Migrate UI Callers

**Files:**
- Modify: `src/features/project/v5/browser-project-resources-v5.ts`
- Modify: `src/features/project/v5/browser-project-resources-v5.test.ts`
- Modify: `src/app/v5/AppV5.tsx`
- Modify: `src/app/v5/AppV5.test.tsx`
- Modify: `src/features/connectivity/v5/BindingEditorDialog.tsx`
- Modify: `src/features/connectivity/v5/BindingEditorDialog.test.tsx`
- Modify: `src/features/jobs/v5/RobotJobWorkspaceV5.tsx`
- Modify: `src/features/jobs/v5/RobotJobWorkspaceV5.test.tsx`

- [ ] **Step 1: Write failing resource wiring tests**

Require:

```ts
resources.commands.previewChange
resources.commands.applyChange
resources.simulation.execute
```

Verify both services share the same mutation authority and active runtime bundle as the rest of the application.

- [ ] **Step 2: Instantiate registries and services**

Extend `BrowserProjectApplicationResourcesV5`:

```ts
readonly commands: ProjectCommandServiceV5
readonly simulation: SimulationCommandServiceV5
readonly samples: ProjectSampleServiceV5
```

Use the existing `createId`, `nowMs`, `mutations`, and `runtime.bundle` dependencies. Wrap `commitCandidate` with the same connectivity publication tracking used by `replace` and `mutate`.

- [ ] **Step 3: Migrate durable UI handlers**

Replace direct `mutations.mutate` calls in:

- `src/app/v5/AppV5.tsx`
- `src/features/connectivity/v5/BindingEditorDialog.tsx`

with a small UI helper that performs:

```ts
const preview = resources.commands.previewChange({
  expectedRevisionId: active.revisionId,
  commands,
})
await resources.commands.applyChange({
  previewId: preview.previewId,
  expectedRevisionId: active.revisionId,
  idempotencyKey: crypto.randomUUID(),
})
```

Project New, Import, and full Demo replacement continue to use `store` or `mutations.replace`; they are whole-Project lifecycle operations, not member commands.

Replace the inline `loadDemo` factory in `AppV5.tsx` with `resources.samples.load('codex-operator-v5')` so the human UI and `demo:reset` use the same named sample lifecycle.

- [ ] **Step 4: Migrate Job start and cancel**

Change `RobotJobWorkspaceV5` props to accept `SimulationCommandServiceV5` and active revision. Replace direct playback calls with `simulation.execute`.

Keep current button labels and disabled behavior unchanged.

- [ ] **Step 5: Add parity tests**

For one entity edit, one OPC UA mapping change, and one Job start:

- invoke the UI handler;
- assert the shared service receives the correct typed command;
- retain existing rendered UI expectations.

- [ ] **Step 6: Run the slice verification**

```powershell
npx vitest run src/core/project-commands-v1 src/features/project/v5 src/features/connectivity/v5/BindingEditorDialog.test.tsx src/features/jobs/v5/RobotJobWorkspaceV5.test.tsx src/app/v5/AppV5.test.tsx
npm run typecheck
npm run lint
```

Expected: all tests PASS and no type or lint errors.

- [ ] **Step 7: Commit the wiring**

```powershell
git add -- src/features/project/v5/browser-project-resources-v5.ts src/features/project/v5/browser-project-resources-v5.test.ts src/app/v5/AppV5.tsx src/app/v5/AppV5.test.tsx src/features/connectivity/v5/BindingEditorDialog.tsx src/features/connectivity/v5/BindingEditorDialog.test.tsx src/features/jobs/v5/RobotJobWorkspaceV5.tsx src/features/jobs/v5/RobotJobWorkspaceV5.test.tsx
git commit -m "refactor: route UI actions through shared authorities"
```

## Plan Completion Gate

This plan is complete only when:

- all eleven Project command kinds validate and project deterministically;
- preview is side-effect free and expires after five minutes;
- apply is revision-safe, exact-candidate, atomic, and idempotent;
- simulation start, cancel, and reset use one shared service;
- current V5 entity, OPC UA binding, and Job UI paths call the shared authorities;
- whole-Project New, Import, and Demo replacement behavior still passes;
- the named operator sample contains no external-write Job instruction;
- no external OPC UA or PLC write path exists.
