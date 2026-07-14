# Single-Robot Workcell V3, Jobs, Primitives, and OPC UA Transform Design

**Status:** G0 amended normative design awaiting user approval

**Date:** 2026-07-13

## 1. Decision Summary

The next development stage delivers one Project V3 foundation and five
independently reviewable product workstreams in one milestone:

1. Import one fixed six-axis serial Robot from one through seven selected STEP
   `File` objects, collapsed to one through seven unique persisted source Assets.
   Exactly seven Robot Links (`LINK00` through `LINK06`) are mapped from the
   parsed source components. A single STEP assembly may provide all seven Links.
2. Bind the absolute `X/Y/Z/Roll/Pitch/Yaw` transform of built-in Equipment and
   STEP or generated Object Instances to OPC UA nodes through the existing read-only
   OPC UA Client middleware.
3. Replace the flat Pose sequence with Project-owned Simulation Jobs. Each Job
   directly owns its ordered Pose Steps, outgoing speed, easing, and revision.
4. Create lightweight Box and Cylinder Object Assets in the browser while
   preserving the existing one-whole-STEP-file-per-Object import path.
5. Present the product through transient `BUILD`, `SIMULATE`, `CONNECT`, and
   `VALIDATE` workspace lenses without persisting presentation state.

The implementation order freezes one Project Schema v3 foundation, introduces
the transient workspace shell, then splits into Robot Import, Simulation Jobs,
Primitive Objects, and Equipment Transform OPC UA workstreams. One `.wdtwin`
archive saves and reloads all durable workcell configuration atomically; live
telemetry, interpolation state, and workspace mode are excluded.

The approved short-term Robot scope remains one Robot, six revolute Joints
(`J1` through `J6`), and seven serial Links. A literal seven-Joint Robot,
variable DOF, and eight or more Links remain a later Generic Robot phase.

## 2. Product Language

The UI, validation messages, tests, and documentation shall use:

> Seven Robot Links mapped from one through seven STEP sources.

They shall not use "seven STEP files" as a synonym for seven Robot Links.
Robot source-file limits apply only to Robot Import. Each imported STEP Object
Asset owns one whole STEP file. Generated Box and Cylinder Assets own no STEP
file or bytes.

All engineering UI translation and dimension fields use millimetres and default
to three decimal places; angular fields use degrees and default to two decimal
places. Runtime/domain/archive translation and primitive dimensions remain
metres, and rotations remain normalized Quaternions or explicitly documented
degree fields. UI input converts `mm / 1000` exactly to the stored metre value;
live OPC UA metre values display as `m * 1000`. Formatting is presentation-only:
opening, switching panels, or applying a form with an untouched rounded field
must preserve the original stored precision. Only a field explicitly edited by
the operator replaces its underlying value. Tests cover positive/negative/high-
precision round trips with no repeated-open drift.

## 3. Scope

### 3.1 Robot Import

- Keep exactly one active Robot in the scene.
- Accept one through seven selected `.step` or `.stp` Robot `File` objects and
  one through seven unique persisted Robot source Assets after digest collapse.
  Reject 0/8 selections synchronously before `arrayBuffer()`, copy, hash, or
  Worker allocation, even if eight selections are byte-identical. Preflight
  also enforces a 1-through-255 UTF-8-byte filename ending case-insensitively in
  `.step` or `.stp`, nonzero `File.size`, 25 MiB per selected File, and 100 MiB
  summed selected `File.size`. An invalid name/suffix fails as
  `ROBOT_STEP_FILENAME_INVALID`; a zero-byte File fails as
  `ROBOT_STEP_PARSE_FAILED` with stable detail `reason: 'empty-source'`. Every
  preflight failure occurs before reading, copying, hashing, or Worker allocation.
- Resolve exactly `LINK00` through `LINK06` from assembly components or flat
  mesh parts found in those sources.
- Parse each unique source once in a Web Worker and preserve its assembly tree.
- Store each unique source byte sequence once, even when several Links use it.
- Let names such as `LINK00` suggest mappings, but never treat names as proof of
  Kinematics.
- Accept existing seven independent Link files without regression.
- The deterministic Geometry subset is a self-contained STEP source whose
  AP203/AP214/AP242 Geometry can be resolved by the checked-in OCCT Worker into
  finite, non-empty, separately selectable occurrences with triangulatable
  Geometry and finite occurrence transforms. An assembly that depends on an
  unresolved external STEP reference fails as
  `ROBOT_STEP_EXTERNAL_REFERENCE_UNSUPPORTED`; a tessellated/PMI-only or
  otherwise non-triangulatable occurrence fails as `ROBOT_STEP_UNSUPPORTED`.
  AP242 Joint/mate/kinematic metadata, PMI, colors, and names are never Mechanics
  authority. A fused export that exposes fewer than seven selectable Link
  occurrences remains unsupported; it is not split heuristically.
- Obtain Mechanics from the existing Datasheet configuration, an optional Robot
  Definition Manifest, or the Manual Robot Setup Wizard.
- An optional Mechanics Manifest filename is 1 through 255 UTF-8 bytes; reject
  outside that range as `ROBOT_MECHANICS_MANIFEST_FILENAME_INVALID` before any
  read. Its content is at most 1,048,576 raw bytes. Check `File.size` before
  `arrayBuffer()`, digest, UTF-8 decode, or JSON parse; exact
  boundary passes and plus one fails as
  `ROBOT_MECHANICS_MANIFEST_TOO_LARGE`. Accepted original bytes are hashed once
  through the shared Project hash service. Fatal UTF-8 decode, JSON syntax or
  duplicate-key failure, and closed-schema failure report respectively
  `ROBOT_MECHANICS_MANIFEST_INVALID_UTF8`,
  `ROBOT_MECHANICS_MANIFEST_INVALID_JSON`, and
  `ROBOT_MECHANICS_MANIFEST_SCHEMA_INVALID`. A single leading UTF-8 BOM may be
  removed for decoding but remains part of the original-byte digest. Raw
  Manifest bytes remain non-persistent; cancellation within 250 ms makes any
  late hash/decode result inert.
- Treat STEP assembly nodes/meshes only as Geometry occurrences, never as Joint
  count evidence. A source may contain seven mappable Link components for this
  six-Joint chain. If a supplied Manifest or Manual Mechanics payload declares
  any Joint count other than exactly six, reject it before staging with
  `ROBOT_JOINT_COUNT_UNSUPPORTED`; a real seven-DOF Robot is outside this phase.
- Validate the canonical serial chain `LINK00 -> LINK01 -> ... -> LINK06`.
- Localize world/assembly Zero Pose Geometry into each Link coordinate system.
- Generate collision boxes from each Link's selected and localized Geometry.
- Stage and commit Geometry, Mechanics, collision proxies, and persistence as
  one Robot replacement transaction.

### 3.2 Equipment and Object OPC UA Transform Binding

- Apply to canonical external entities identified as `equipment:<id>` or
  `object:<id>`.
- In this design, MCP means the application's editable Machine-Centric Point:
  the common workcell frame beneath World, not a vendor-neutral Robot standard.
- Keep numeric Status Binding independent from Transform Binding.
- Add a Transform source selector: `Manual` or `OPC UA`.
- Treat OPC UA XYZRPY as a read-only absolute Pose relative to a selected
  reference frame. MCP is the default and World is the alternate.
- Require all six scalar Node mappings in the selected server-side OPC UA
  Transform Profile.
- Convert raw values with per-axis `output = raw * scale + offset` mappings in
  the Connector.
- Define mapped X/Y/Z output in meters and mapped Roll/Pitch/Yaw output in
  degrees.
- Convert RPY to a normalized Quaternion with the existing `ZYX` Euler order.
- Apply a new Pose only when all six values are finite and GOOD in the same
  Connector sampling cycle.
- Sample and hold the current `renderPose` on BAD, malformed, stale, or
  disconnected input.
- Persist the Manual fallback Pose and Binding configuration, not transient OPC
  UA telemetry.
- Drive rendering and Geometry Collision from the effective runtime Pose.
- Keep the Equipment OPC UA connection active independently of whether the
  Robot Joint source is Simulation or OPC UA.
- Prevent drag and Robot grasp while OPC UA owns an entity transform.
- Perform no OPC UA writes.

### 3.3 Shared Project and Runtime Work

- Introduce Project Schema v3 with deterministic v1/v2 migrations.
- Make one `WorkcellProjectSnapshotV3` aggregate authoritative for Robot source
  Assets and Link references, Simulation Jobs and `activeJobId`, STEP/Box/
  Cylinder Object Assets, Object Instances, canonical Manual fallback
  transforms, canonical numeric Status bindings, and OPC UA Transform Profile
  bindings.
- Replace the flat Pose array with ordered Jobs whose ordered Pose Steps are
  owned directly by the Job. Do not add a shared Pose library.
- Preserve outgoing Pose speed and easing, support Job CRUD plus Pose reorder/delete,
  and make only the active Job playable and validatable.
- Add generated Box and Cylinder Assets without fake STEP bytes or archive STEP
  entries. Keep imported external Object Assets as one whole STEP source each.
- Persist built-in Equipment configuration required by `.wdtwin` portability,
  including its Manual fallback transform and Transform source.
- Use canonical external-entity IDs in numeric Status and Equipment Transform
  bindings to prevent Equipment and Object ID collisions.
- Keep Project load/import transactional: a failed Robot source restore or OPC
  UA Binding validation leaves the active Workcell unchanged.
- Generate new Project, Object Asset/Instance, Job/Pose, Primitive, and any
  non-content-addressed Robot-import operation IDs through one injectable
  `createPortableId()` utility. Robot source IDs remain their exact SHA-256 and
  Link/occurrence/proxy IDs remain deterministic derivations. The utility prefers
  `crypto.randomUUID()` and otherwise formats an RFC 4122 version-4 UUID from
  `crypto.getRandomValues()`, which remains available on the supported trusted-
  LAN HTTP origin. It never uses `Math.random()`; absence of both cryptographic
  APIs is an explicit blocking error before mutation.
- Remove bindings when their target Object or Equipment is deleted.
- Keep workspace mode and all live OPC UA state outside ProjectDB and the
  `.wdtwin` archive.

### 3.4 Transient Workspace Modes

- Expose exactly four workspace lenses: `BUILD`, `SIMULATE`, `CONNECT`, and
  `VALIDATE`; exactly one is active and the initial lens is `BUILD`.
- Treat a mode change as presentation routing only. It does not switch Joint or
  Transform ownership, connect or disconnect OPC UA, mutate the Project, start
  or stop a Job, change a Pose, release a grasped Object, or run validation.
- A dirty Manual preview blocks routing. The operator must choose Apply,
  Discard, or Stay; Apply/Discard is a separate explicit prerequisite action,
  and Stay cancels navigation. The subsequent mode route itself remains
  mutation-free.
- Keep scene hierarchy on the left, the 3D viewport in the centre, contextual
  inspection on the right, and a Timeline/Collision/Events dock below the
  viewport.

## 4. Out of Scope

- Multiple Robots.
- Variable-size Robot Link or Joint collections.
- Seven-axis or non-serial Robots.
- Prismatic, continuous, fixed, parallel, or closed-loop Robot Joints.
- URDF, Xacro, SDF, or automatic AP242 Kinematics import.
- Inferring Joint axes, origins, limits, Home, velocity, Flange, Tool0, or TCP from
  Geometry.
- Cutting a fused B-Rep or triangle mesh into moving Robot Links.
- AI/API/harness-assisted Geometry extraction or remapping, including API keys,
  endpoints, prompts, upload flows, and non-deterministic conversion fallback.
- Automatic mesh splitting, decimation, or simplification.
- OPC UA write-back, commands, method calls, or controller motion control.
- OPC UA MonitoredItems or Subscription transport; this stage uses polling.
- Partial-axis Equipment Transform Binding.
- Equipment Transform Binding references other than World or MCP, including
  Robot Base, live Joint, Flange, Tool0, TCP, and future custom frames.
- Persisting live OPC UA telemetry as Project configuration.
- Persisting workspace mode, active dock, connection state, or smoothing
  trajectory as Project configuration.
- Authentication, certificates, public-internet deployment, or other security
  hardening.
- Shared Pose libraries, Job chaining, loops, conditions, PLC Job triggers, or
  multi-Job playback.
- IK, physics engines, rigid-body dynamics, acceleration/jerk planning, or
  safety-rated validation. Collision remains Geometry-only.

## 5. Current Gaps Addressed

The current Robot Import validates exactly seven selected files, maps file names
directly to `LINK00` through `LINK06`, and stores one complete STEP byte array in
each Link record. The OCCT conversion consumes the flat mesh array but ignores
the returned root/child assembly structure. It therefore cannot use one source
assembly for several Links.

Current imported Link records also use an identity local transform, while the
built-in ABB loader compensates for Link world origins. Replacing Geometry
without replacing Mechanics can therefore create a Robot with a new shape,
old CRB15000 dimensions, and an incorrect Zero Pose.

The current OPC UA path supports six Joint values and one numeric Status value
per Equipment mapping. It has no six-axis Equipment Transform frame, no
Transform source ownership, no atomic sample rule, and no runtime quality state
per external entity. The current Project also stores a flat Pose array and only
STEP Object Assets, while the current screen presents unrelated engineering
actions in one crowded workspace.

## 6. Project Schema v3

`WorkcellProjectSnapshotV3` is the only current-version Project aggregate. V1
and V2 remain decode-only migration inputs. The exact aggregate projection is:

```ts
type DeepReadonly<T> =
  T extends ArrayBuffer ? ArrayBuffer
  : T extends readonly unknown[] ? { readonly [Key in keyof T]: DeepReadonly<T[Key]> }
  : T extends object ? { readonly [Key in keyof T]: DeepReadonly<T[Key]> }
  : T

interface ProjectRigidTransformV3 {
  readonly position: readonly [number, number, number]
  readonly quaternion: readonly [number, number, number, number]
  readonly scale: readonly [1, 1, 1]
}

type WorkcellProjectSnapshotV3 = DeepReadonly<
  Omit<
    WorkcellProjectSnapshotV2,
    'manifest' | 'robot' | 'frames' | 'objectAssets' | 'objectInstances' | 'poses' | 'opcUa'
  > & {
    readonly manifest: Omit<WorkcellProjectManifestV2, 'schemaVersion'> & {
      readonly schemaVersion: 3
    }
    readonly robot: Readonly<Omit<ProjectRobotV2, 'links' | 'joints'> & {
      readonly sources: readonly RobotStepSourceAssetV3[]
      readonly links: readonly RobotLinkGeometryRecordV3[]
      readonly mechanics: FixedSixAxisRobotMechanicsV3
      readonly mechanicsProvenance: RobotMechanicsProvenanceV3
    }>
    readonly frames: Readonly<{
      readonly mcp: ProjectRigidTransformV3
      readonly tcp: ProjectRigidTransformV3
    }>
    readonly simulation: ProjectSimulationStateV3
    readonly objectAssets: readonly ObjectAssetRecordV3[]
    readonly objectInstances: readonly ObjectInstanceRecordV3[]
    readonly builtInEquipment: readonly ProjectBuiltInEquipmentRecordV3[]
    readonly externalEntities: readonly ProjectExternalEntityTransformStateV3[]
    readonly opcUa: Readonly<
      Omit<WorkcellProjectSnapshotV2['opcUa'], 'equipment'> & {
        readonly numericStatusBindings: readonly ProjectOpcUaNumericStatusBindingV3[]
        readonly equipmentTransforms: readonly ProjectOpcUaEquipmentTransformBindingV3[]
      }
    >
  }
>
```

The inherited `collisionPolicy` field retains its V2 meaning. V3 overrides
`frames` so MCP and Tool0-to-TCP are explicit rigid transforms. The old top-level
`poses` field is forbidden in native V3. Workspace Mode and
live OPC UA values, timestamps, quality, sequence, connection state, and
smoothing state are forbidden anywhere in the aggregate.

V3 validation is closed: unknown top-level or nested keys are rejected. At a
public/untrusted boundary every tuple/ArrayBuffer/ordered collection is cloned;
an internal active-metadata recipe receives only the byte-free projection and
reuses repository-owned source handles without exposing their buffers. The normalized
non-binary object graph is recursively frozen, all numeric values are finite,
and Quaternions are normalized with norms at or below `1e-9` rejected. Every
MCP, TCP, Flange, and Tool0 rigid transform has finite position/quaternion
components and exact scale `[1, 1, 1]`; non-unit, negative, zero, or non-finite
scale is rejected rather than folded into FK or collision. Source
bytes are copied on ingress and every public read/archive encode; no caller or
typed-array view receives the internal revision buffer. Validation, migration,
capture, and archive decode enforce the same referential and cardinality rules
before preparation or active mutation.

Browser portability does not assume a secure context. Every production ID
creation path uses the central injectable factory; feature modules never call
`crypto.randomUUID()` directly. Unit tests exercise both factory branches and a
non-secure-origin browser gate proves New Project, whole-STEP Object import, Job
creation, and Primitive creation while `isSecureContext === false` and
`crypto.randomUUID` is unavailable.

Synchronous public `validateWorkcellProjectSnapshotV3()` performs a safe
structural/referential/canonicalization pass and makes exactly one source copy
when used standalone. The production load/import/commit path avoids validating
then copying again: `preflightWorkcellProjectShapeV3()` first rejects keys,
cardinalities, declared sizes, and references without taking ownership;
`ProjectSourceStagingService` then makes the sole full source copy (or adopts a
private Worker-transferred owned buffer), and
`validateStagedWorkcellProjectSnapshotV3()` adopts those branded staged buffers
without another copy. An untrusted snapshot is not fully staged until this
single owning cryptographic path completes:

```ts
declare const preparedProjectSourceBrand: unique symbol

interface PreparedProjectSourceV1 {
  readonly [preparedProjectSourceBrand]: true
  readonly tokenId: string
  readonly namespace: 'robot' | 'object'
  readonly sha256: string
  readonly byteLength: number
}

type ByteFreeRobotStepSourceAssetV3 = Omit<RobotStepSourceAssetV3, 'sourceBytes'>
type ByteFreeStepObjectAssetRecordV3 = Omit<StepObjectAssetRecordV3, 'sourceBytes'> & {
  readonly sourceSha256: string
}
type ByteFreeObjectAssetRecordV3 =
  | ByteFreeStepObjectAssetRecordV3
  | BoxObjectAssetRecordV3
  | CylinderObjectAssetRecordV3
type ByteFreeWorkcellProjectProjectionV3 = DeepReadonly<
  Omit<WorkcellProjectSnapshotV3, 'robot' | 'objectAssets'> & {
    readonly robot: Omit<WorkcellProjectSnapshotV3['robot'], 'sources'> & {
      readonly sources: readonly ByteFreeRobotStepSourceAssetV3[]
    }
    readonly objectAssets: readonly ByteFreeObjectAssetRecordV3[]
  }
>

interface PreparedProjectSourceGroupV1 {
  readonly ownerKeys: readonly (`robot-source:${string}` | `object-asset:${string}`)[]
  readonly preparedSource: PreparedProjectSourceV1
}

declare function stageProjectSourcesV3(
  snapshot: WorkcellProjectSnapshotV3,
  stagingService: ProjectSourceStagingService,
): Promise<{
  readonly projection: ByteFreeWorkcellProjectProjectionV3
  readonly preparedSourceGroups: readonly PreparedProjectSourceGroupV1[]
}>
```

For a public raw-snapshot call, the staging service synchronously clones the
complete non-binary configuration graph and owns all Robot/Object source buffers
before its first `await`. That invocation-time clone cannot observe a later
caller mutation or source-buffer swap. It then hashes the already-owned source
set sequentially, exactly once per unique source, keeps bytes in a private token
registry, and returns only a byte-free projection plus opaque tokens. A private
Worker-transferred/File-stream lease may instead be adopted sequentially because
it is no longer caller-mutable.
No prepared/decode/migration result exposes `sourceBytes` or a view of the
registry buffer; only internal candidate preparation may hydrate a runtime
snapshot from it. One prepared token may name multiple distinct owner keys only
within the same namespace and digest—for example, two semantic STEP Object
Assets sharing one archive Blob. The token is consumed/revoked once, while one
owner-bound verified handle is minted per owner. Every source owner appears in
exactly one group.
For Robot sources, the recomputed lowercase digest must equal both `id` and
`sha256`; Object digests become the content identity used by archive/revision
projections. Migration, codec decode, Robot analysis, and commit pass the same
prepared token forward instead of hashing again. Cancel/discard revokes it and
disposes its bytes. Commit preparation, pointer publication, runtime publication,
and stable finalization mint no handle by themselves. Only after matching stable-
pointer finalization and activation of the published runtime does the repository
consume the prepared token once, bind each owner to the canonical resident
buffer, and mint/activate one verified handle per owner. Raw public replacement
invokes this path internally. No stage trusts a
declared digest or can mint a token, while active metadata recipes validate
existing verified handles and perform no source hash.

### 6.1 Robot Source and Link Separation

The normative model is:

```ts
interface RobotStepSourceAssetV3 {
  readonly id: string
  readonly sha256: string
  readonly sourceFileName: string
  readonly sourceBytes: ArrayBuffer
  readonly detectedUnit: 'meter' | 'millimeter' | 'inch' | 'unknown'
  readonly selectedSourceUnit: 'meter' | 'millimeter' | 'inch'
  readonly unitDecision: 'detected' | 'operator-confirmed' | 'legacy-detected'
  readonly sourceToMeters: number
  readonly parserVersion: string
  readonly statistics: GeometryStatistics
}

interface RobotAssemblyPartRefV3 {
  readonly sourceAssetId: string
  readonly nodePath: readonly number[]
  readonly nodeName: string
  readonly meshIndices: readonly number[]
}

interface RobotLinkGeometryRecordV3 {
  readonly linkId: RobotLinkId
  readonly sourceRefs: readonly RobotAssemblyPartRefV3[]
  readonly coordinateMode: 'assembly-zero-pose' | 'link-local'
  readonly zeroPoseLocalization: SerializableTransform
  readonly operatorAdjustment: SerializableTransform
  readonly visible: boolean
  readonly collisionBoxes: readonly ProjectCollisionBoxV2[]
  readonly statistics: GeometryStatistics
}
```

`nodePath` is normally a deterministic non-negative child-ordinal path from the
OCCT root. `nodeName` is diagnostic and helps remapping, but it is not identity.
`meshIndices` are
validated against the same source hash and parser version. One Link may own one
or more part references. The owned occurrence key is
`(sourceAssetId, nodePath, meshIndex)` and may belong to at most one Link. A raw
mesh index may still appear under multiple distinct assembly node paths, because
those paths represent separate component instances.

One reserved migration namespace resolves byte-identical legacy Link files
without duplicating source bytes. A V1/V2 whole-source occurrence uses
`nodePath: [-1, linkOrdinal]`, where `linkOrdinal` is 0 through 6 and must match
the owning `LINK00` through `LINK06`; `nodeName` is exactly
`legacy-whole-source:<linkId>`, `coordinateMode` is `link-local`, and
`meshIndices` is the sorted complete parsed mesh-index set. Robot Import never
creates this path. Restore recognizes the negative prefix instead of traversing
the assembly tree and validates the stored parser version and complete mesh set.
All other negative paths are invalid. The reserved paths make the seven legacy
occurrences distinct while still referencing one content-addressed source.

`selectedSourceUnit` is the authoritative reload decision. `sourceToMeters`
must equal `1`, `0.001`, or `0.0254` for meter, millimeter, or inch respectively.
`detectedUnit` retains parser provenance, while `unitDecision` records whether
the operator overrode or confirmed it. Project restore never guesses a new unit
because a parser version changed.

The archive layout is:

```text
robot/sources/index.json
robot/sources/<sha256>.step
robot/links/index.json
robot/configuration.json
```

`robot/sources/index.json` stores
`Omit<RobotStepSourceAssetV3, 'sourceBytes'>` records; the `sha256` field resolves
the corresponding STEP entry. Decode reconstructs owned `sourceBytes` only after
the path digest and exact bytes match.

The same SHA-256 source is written once. `sha256` is lowercase 64-character hex,
must match the exact `sourceBytes`, and is also the exact `id`; source IDs and
digests are therefore unique and `sourceAssetId` resolution is unambiguous.
Content hashing must work in the trusted-LAN HTTP deployment and may not depend
exclusively on secure-context Web Crypto.

Native and decoded V3 Projects require one through seven unique Robot source
hashes. Every source is referenced by at least one Link part; all seven Links
have non-empty `sourceRefs`, every reference has non-empty `meshIndices`, and no
`(sourceAssetId, nodePath, meshIndex)` occurrence has more than one Link owner.
Zero/eight sources, an unreferenced source, an empty Link reference list, an
empty mesh-index list, a missing source ID, or duplicate occurrence ownership
fails before runtime preparation.

### 6.2 Fixed Mechanics Contract

Project Schema v3 continues to persist six Joints. Import validation requires:

- `J1: LINK00 -> LINK01`
- `J2: LINK01 -> LINK02`
- `J3: LINK02 -> LINK03`
- `J4: LINK03 -> LINK04`
- `J5: LINK04 -> LINK05`
- `J6: LINK05 -> LINK06`
- finite origins;
- normalized non-zero axes;
- finite minimum, maximum, Home, direction/offset, and strictly positive
  maximum-velocity data;
- minimum less than maximum;
- Home within limits; and
- a defined rigid Flange/Tool0 and TCP, each with exact unit scale.

This explicit contract prevents cycles, self-edges, duplicate children,
multiple roots, unreachable Links, and order-dependent rig construction.

Joint limits, Home, Job Pose angles, browser Simulation angles, and OPC UA Joint
angles are all command-space degrees. FK applies the exact equation
`effectiveAngleDeg = direction * commandAngleDeg + zeroOffsetDeg`, then rotates
about the normalized stored axis at the stored origin. Limits and maximum
velocity are checked in command space before that mapping. This equation is the
only interpretation used by rendering, TCP calculation, playback, and collision.

The optional fixed-scope Manifest supplies Mechanics and frame definitions; it
does not bypass Geometry mapping confirmation:

```ts
interface FixedSixAxisJointManifestV1 {
  readonly id: 'J1' | 'J2' | 'J3' | 'J4' | 'J5' | 'J6'
  readonly parentLink: RobotLinkId
  readonly childLink: RobotLinkId
  readonly originM: readonly [number, number, number]
  readonly axis: readonly [number, number, number]
  readonly minDeg: number
  readonly maxDeg: number
  readonly homeDeg: number
  readonly zeroOffsetDeg: number
  readonly direction: 1 | -1
  readonly maxVelocityDegPerSec: number
}

type ProjectRobotJointV3 = FixedSixAxisJointManifestV1

interface FixedSixAxisRobotManifestV1 {
  readonly schemaVersion: 1
  readonly name: string
  readonly joints: readonly FixedSixAxisJointManifestV1[]
  readonly flange: ProjectRigidTransformV3
  readonly tool0: ProjectRigidTransformV3
  readonly tcp: ProjectRigidTransformV3
}

interface FixedSixAxisRobotMechanicsV3 {
  readonly joints: readonly [
    ProjectRobotJointV3,
    ProjectRobotJointV3,
    ProjectRobotJointV3,
    ProjectRobotJointV3,
    ProjectRobotJointV3,
    ProjectRobotJointV3,
  ]
  readonly flange: ProjectRigidTransformV3
  readonly tool0: ProjectRigidTransformV3
}

type RobotMechanicsProvenanceV3 =
  | {
      readonly kind: 'datasheet'
      readonly configurationId: string
      readonly configurationRevision: string
    }
  | {
      readonly kind: 'manifest'
      readonly sourceFileName: string
      readonly sourceSha256: string
    }
  | {
      readonly kind: 'manual'
      readonly canonicalSha256: string
    }
```

The six tuple positions and Link pairs are fixed by this stage's serial
contract. Manual Wizard input produces the same validated structure. Manifest
fields are finite, axes and transform quaternions are normalized during staging,
all frame-transform scales must already equal `[1, 1, 1]`, and every validation
error identifies the exact Joint or frame field. Scale is never normalized from
a non-unit value because doing so would silently change the declared Mechanics.

Joint count comes only from the selected Datasheet configuration, validated
Manifest, or explicit Manual Mechanics payload. Assembly component count,
names, and mesh count never override it. A Manifest/Manual payload with a Joint
array length other than six fails as `ROBOT_JOINT_COUNT_UNSUPPORTED` and reports
both `declaredJointCount` and `requiredJointCount: 6`; no Geometry, Project,
repository, or active Robot state changes. Seven Geometry components in one STEP
remain the normal seven-Link/six-Joint case and do not trigger this error.

`coordinateMode` is a Geometry-mapping decision stored per Link, not a global
Mechanics Manifest field. The Review step shows Mechanics provenance as
Datasheet configuration ID/revision, Manifest SHA-256, or Manual configuration
content digest. Project configuration persists that provenance. A STEP assembly
name or tree never counts as Mechanics provenance.

Manifest SHA-256 hashes the original Manifest bytes at import time. The current
Project/archive intentionally does not retain those raw Manifest bytes or add a
`robot/mechanics/source-manifest.json` entry; `sourceFileName` plus lowercase
64-hex `sourceSha256` is audit provenance, while the validated normalized
Mechanics block is the durable authority. Manual SHA-256 hashes the UTF-8 JSON
produced by constructing that normalized Mechanics object in fixed schema field
order and serializing it with `JSON.stringify`. The synchronous structural
validator checks only the lowercase-64-hex shape; every untrusted staging,
archive-decode, and commit path asynchronously recomputes/verifies it through
`ProjectHashService`, and WS2 Manual creation uses that same service. Datasheet
ID/revision are immutable non-empty catalog
values. Empty/malformed Manifest provenance, inconsistent Manual provenance, or
empty Datasheet provenance fails Project validation. This keeps Projects usable
when the original Manifest or Datasheet catalog is unavailable offline.

Robot name, Base XYZRPY, each Joint origin/axis/minimum/maximum/Home/zero
offset/direction/maximum velocity, all seven Geometry-local transforms,
Flange/Tool0, and TCP are independently editable. Datasheet values are defaults,
not immutable Geometry-derived truth. Every accepted edit is validated against
the fixed chain and survives Project Save, browser reload, Export, and Import;
changing Geometry never silently changes Mechanics.

`robot.mechanics.flange` persists Link-6-to-Flange and
`robot.mechanics.tool0` persists Flange-to-Tool0. The inherited `frames.tcp`
persists Tool0-to-TCP, while `frames.mcp` remains the editable Machine-Centric
Point. All four are rigid transforms with exact unit scale. These fields are not
reconstructed from STEP names or Geometry.

### 6.3 Simulation, Object Assets, and Canonical External Entity State

Jobs directly own their ordered Pose Steps:

```ts
type ProjectPoseStepV3 = Readonly<
  Omit<ProjectPoseRecordV1, 'anglesDeg' | 'speedPercentToNext'> & {
    readonly anglesDeg: readonly [number, number, number, number, number, number]
    readonly speedPercentToNext: number
  }
>

interface SimulationJobV1 {
  readonly id: string
  readonly name: string
  readonly revision: number
  readonly poses: readonly ProjectPoseStepV3[]
}

interface ProjectSimulationStateV3 {
  readonly activeJobId: string | null
  readonly jobs: readonly SimulationJobV1[]
}

const MAX_JOBS = 32
const MAX_POSES_PER_JOB = 256
const MAX_PROJECT_POSES = 2048
```

Job IDs are non-empty and unique among Jobs. Pose IDs are non-empty and unique
across all Jobs; Job and Pose IDs use separate namespaces and may have the same
text. Job revision is a positive integer. A non-null `activeJobId` resolves to
exactly one Job. V3 Pose
Steps require six finite Joint angles, `easing: 'linear' | 'easeInOut'`, and
persisted `speedPercentToNext` in inclusive `[1, 100]`. Save Pose defaults are
`speedPercentToNext: 100`, `easing: 'easeInOut'`, and terminal
`durationMs: 1000`; terminal duration contributes no playback elapsed time and
is recalculated when the Pose gains an outgoing successor. For every
non-terminal Pose at index `i`, `durationMs` is a redundant canonical value:

Each Pose angle is command-space degrees and must be within the corresponding
current Mechanics inclusive `[minDeg, maxDeg]`; exact boundaries pass and any
value outside fails. Validation, migration, Save Pose, explicit angle update,
playback preparation, and Mechanics reconciliation never clamp an angle.

```text
durationMs = max(
  16,
  max over J1..J6(
    abs(poses[i + 1].anglesDeg[j] - poses[i].anglesDeg[j])
    / robot.mechanics.joints[j].maxVelocityDegPerSec
    * 1000 * 100 / poses[i].speedPercentToNext
  )
)
```

All validation, migration, Job editing, Mechanics reconciliation, and playback
preparation call this one public helper; speed is read from the outgoing Pose so
no duplicate speed argument can diverge:

```ts
declare function deriveCanonicalPoseDurationMsV3(
  from: Readonly<Pick<ProjectPoseStepV3, 'anglesDeg' | 'speedPercentToNext'>>,
  to: Readonly<Pick<ProjectPoseStepV3, 'anglesDeg'>>,
  mechanics: Readonly<Pick<FixedSixAxisRobotMechanicsV3, 'joints'>>,
): number
```

Easing changes interpolation shape but not this duration. Native/decode
validation derives the value from the same Project Mechanics and rejects a
stored difference greater than `1e-9 ms`; the owned canonical snapshot replaces
an accepted within-tolerance value with the exact derived number. The terminal
Pose must store exactly `1000`. Angle, order, speed, or Mechanics edits
recalculate every affected outgoing duration in the same atomic mutation. Every
derived non-terminal segment duration is at least 16 ms. The exact boundaries
32 Jobs, 256 Poses per Job, and 2,048 Poses per Project are accepted; boundary
plus one fails before active-state mutation.

A Mechanics edit or Robot replacement never commits Robot state first and fixes
Jobs through a later store subscription. The candidate snapshot replaces
`robot.mechanics` and reconciles `simulation.jobs` before one
public `ProjectMutationService.replaceFromActive()` byte-free recipe. The
coordinator is foundation-private and is never imported by a feature. Each Job
whose canonical duration
changes receives exactly one revision increment in that candidate; unaffected
Jobs retain their revision and object identity. Validation and runtime
publication observe only the old complete snapshot or the new complete snapshot.
Before duration reconciliation, every stored Pose is checked against the proposed
command-space limits. Any violation rejects the entire candidate as
`PROJECT_JOB_POSE_OUT_OF_LIMITS` with total count plus the first 64 stable-
ordered `{ jobId, poseId, jointId, angleDeg, minDeg, maxDeg }` details; Robot,
Mechanics, Jobs, revisions, pointer, and runtime all remain unchanged.

Only the active Job can play or validate. Play snapshots its `id`, positive
revision, and ordered Poses. Both `playing` and `paused` reject Job switching and
all Job/Pose mutations plus every Simulation/OPC-UA Joint-source change. Among
operator actions, only explicit Stop returns transport to `idle` and unlocks
editing; Stop preserves the current displayed Joint angles. Natural completion
is a non-user terminal path that publishes the final Pose exactly once, retains
that final Pose, and returns to `idle`. A fatal playback/source-quality error is
the other non-user terminal path: it samples/retains the current interpolated
Joint angles, reports the reason, and returns to `idle` without snapping to the
terminal Pose. While OPC UA owns Robot Joints, Jobs remain visible but editing
and playback start are rejected. Project V3 is authoritative after
load/import; the legacy `robot-sim.pose-sequence.v1` key is one-time recovery
input only when no active Project exists. Remove it without requiring an extra
Save as soon as the recovered or loaded V3 revision has a matching stable
pointer, active runtime plus verified owner handles, and successful Project-
backed Job hydration. Any earlier finalization, activation, integrity, or Job-
hydration failure retains it for the next startup retry.

Project V3 uses one closed Object Asset discriminator:

```ts
type ObjectAssetGeometryV3 = DeepReadonly<Pick<
  ObjectAssetRecordV2,
  'id' | 'name' | 'colliderCenter' | 'collisionHalfExtents' |
  'collisionBoxes' | 'statistics'
>>

type StepObjectAssetRecordV3 = ObjectAssetGeometryV3 & {
  readonly sourceKind: 'step'
  readonly sourceFileName: string
  readonly sourceBytes: ArrayBuffer
  readonly importScale: number
  readonly originMode: EquipmentOriginMode
}

type BoxObjectAssetRecordV3 = ObjectAssetGeometryV3 & {
  readonly sourceKind: 'box'
  readonly dimensionsM: readonly [number, number, number]
  readonly color: `#${string}`
}

type CylinderObjectAssetRecordV3 = ObjectAssetGeometryV3 & {
  readonly sourceKind: 'cylinder'
  readonly radiusM: number
  readonly heightM: number
  readonly axis: 'z'
  readonly radialSegments: 32
  readonly color: `#${string}`
}

type ObjectAssetRecordV3 =
  | StepObjectAssetRecordV3
  | BoxObjectAssetRecordV3
  | CylinderObjectAssetRecordV3

const MAX_OBJECT_ASSETS = 256
const MAX_OBJECT_INSTANCES = 512
const MAX_VISIBLE_RENDER_ITEMS = 1024
const MAX_VISIBLE_STATUS_OVERLAYS = 128

type ObjectInstanceRecordV3 = Readonly<
  Omit<ObjectInstanceRecordV1, 'transform' | 'numericStatus'> & {
  readonly graspable: boolean
  readonly manualNumericStatus: number
  }
>
```

Every Box dimension is within inclusive `[0.001, 10]` metres. Cylinder radius
is within inclusive `[0.0005, 5]` metres and height within `[0.001, 10]`
metres. Primitive colors are canonical uppercase `#RRGGBB`; alpha, textures,
and per-face materials are excluded. A Box renders exactly 12 triangles with
one exact local proxy whose half-extents are `dimensionsM / 2`. A Cylinder is a
closed mesh generated along local +Z with exactly 32 radial segments and 128
triangles; it uses one conservative collision proxy with half-extents
`[radiusM, radiusM, heightM / 2]`. Generated
Assets contain no STEP filename/bytes and create no archive STEP entry. A new
Box or Cylinder Instance starts with `graspable: false` and may be changed by
the operator later. Its other deterministic instance defaults are
`manualNumericStatus: 0`, `statusSource: 'manual'`,
`statusOverlayVisible: true`, and `visible: true`.

Primitive redundant Geometry fields are validated, not trusted. Both shapes
require `colliderCenter: [0, 0, 0]` and exactly one collision Box
`{ id: 'primitive-body', center: [0, 0, 0], quaternion: [0, 0, 0, 1] }` with
the derived half-extents above. Box statistics are exactly
`{ vertices: 24, triangles: 12, meshes: 1, materials: 1 }`; Cylinder statistics
are exactly `{ vertices: 196, triangles: 128, meshes: 1, materials: 1 }`.
`collisionHalfExtents`, the Box entry, and statistics must equal those derived
values or native/decode validation rejects the Project before preparation.

Primitive dialogs show the same limits as Box `1.000..10000.000 mm`, Cylinder
radius `0.500..5000.000 mm`, and Cylinder height `1.000..10000.000 mm`; they
convert once to the metre fields above. Manual Robot/Base/Frame/Object XYZ and
Mechanics origin positions use the same mm presentation contract. CONNECT live
XYZ is formatted from runtime metres to mm; Roll/Pitch/Yaw remains degrees.

Object cardinality is independent from the Robot's one-through-seven STEP-
source rule. A Project accepts at most 256 Object Assets and 512 Object
Instances across STEP and generated kinds. Runtime preparation counts one
visible render item for each actual Three.js Mesh/material render group in the
Robot, built-in Equipment, and every visible Object Instance, after asset reuse;
the total is at most 1,024. Exact limits pass and plus one rejects before active
mutation. This draw-call-oriented cap is enforced in addition to triangle,
source-byte, mesh, material, and collision budgets.

`statusOverlayVisible` remains durable per-entity configuration, but it does not
authorize an unbounded DOM overlay. At runtime, only visible entities whose
overlay anchor projects inside the current camera frustum are candidates. Rank
candidates deterministically by the selected canonical entity first, then by
ascending camera-space distance, then by lexical canonical `ExternalEntityId`;
mount only the first 128 numeric Status overlays and cull the rest. An off-screen
selected entity remains available in the Inspector but does not create an
off-screen overlay. Recompute the ranked set at most once per animation frame
after camera, entity transform, selection, visibility, or overlay-configuration
change. Culling is presentation-only: it never changes `statusOverlayVisible`,
Project validation, live numeric reduction, or archive content. Exactly 128
mounted overlay roots pass; the 129th candidate is deterministically culled.

Persisted general Project identifiers (Project, Asset, Instance, Job, Pose,
Gateway/Profile references, and user-defined Robot/source labels) are 1 through
128 UTF-8 bytes. User-visible Project/Robot/Asset/Instance/Job/Pose names are 1
through 128 UTF-8 bytes. Original STEP/Manifest filenames are 1 through 255
UTF-8 bytes. More specific OPC UA NodeId limits remain 1 through 1,024 UTF-8
bytes. Validators count encoded bytes, reject rather than truncate, and apply
the same rule in native validation, legacy migration, UI submission, and archive
decode. Text controls use the matching `maxLength` as an early guard and still
run UTF-8 byte validation for multibyte input.

Built-in Equipment configuration is stored without duplicating transform
ownership:

```ts
interface ProjectBuiltInEquipmentRecordV3 {
  readonly id: string
  readonly name: string
  readonly kind: 'cup' | 'machine'
  readonly status: EquipmentStatus
  readonly manualNumericStatus: number
  readonly statusSource: EquipmentStatusSource
  readonly statusOverlayVisible: boolean
  readonly graspable: boolean
  readonly collisionHalfExtents: readonly [number, number, number]
  readonly collisionCenter?: readonly [number, number, number]
  readonly stackLightAnchor: readonly [number, number, number] | null
}
```

The record contains Manual numeric-status fallback, status-source/display,
grasp, stack-light, and collision configuration but no effective live numeric
value, `transform`, STEP reload field, or Object `assetId`.
Each persisted built-in ID must resolve exactly one immutable catalog entry and
its `kind`, collision Geometry, and stack-light capability must match that
entry. A Project may persist a subset after operator deletion, but cannot add an
unknown built-in ID or change its Geometry kind; count therefore cannot exceed
the catalog cardinality.
Built-in Equipment and Object Instances retain separate Geometry stores, but
Project Schema v3 targets them through canonical IDs:

```ts
type ExternalEntityId = `equipment:${string}` | `object:${string}`
type TransformSource = 'manual' | 'opcua'

interface ProjectExternalEntityTransformStateV3 {
  readonly entityId: ExternalEntityId
  readonly manualTransform: SerializableTransform
  readonly transformSource: TransformSource
}
```

Each Object Instance has exactly one matching `object:<id>` transform state;
each `builtInEquipment` record has exactly one matching `equipment:<id>` state.
Duplicate built-in IDs, duplicate canonical IDs, missing matches, and orphan
external states fail before preparation. `manualTransform` is always canonical MCP-local XYZRPY
configuration and has no separate Manual reference-frame selector. The existing
numeric `statusSource` remains separate. Schema v3 captures the built-in
Equipment Manual transforms needed to restore a Project without depending on
unrelated Equipment IndexedDB state. V1/V2 Object Instances migrate with
`graspable: false` because that choice was not durable in the legacy Project.

`manualNumericStatus` is the only durable numeric value for both built-ins and
Object Instances. When `statusSource: 'opcua'`, the effective display value,
quality, and timestamp live only in the runtime status reducer; Project capture
still writes the unchanged Manual fallback. Returning to Manual restores that
fallback. Numeric Status Binding deletion never changes Transform Binding, and
Transform Binding deletion never changes numeric Status Binding.
Native V3 requires exactly one matching numeric Binding whenever
`statusSource: 'opcua'`; Manual source may retain one dormant Binding. Switching
Manual to OPC UA is accepted only when the same candidate already contains that
Binding. Removing an active numeric Binding is one atomic Project mutation that
sets `statusSource: 'manual'`, restores `manualNumericStatus`, and removes only
the numeric Binding.
Both durable Manual fallbacks must be finite numbers. Native/decode validation
rejects `NaN`, infinities, an unsupported `statusSource`, an unsupported
`EquipmentStatus`, or an invalid visibility Boolean before preparation.

The remaining fixed V3 archive entries are:

```text
objects/assets.json
objects/assets/<sha256>.step   # sourceKind 'step' only
objects/instances.json
equipment/built-ins.json
external/entities.json
simulation/jobs.json
opcua/bindings.json
collision/policy.json
```

`opcua/bindings.json` contains exactly the sorted
`numericStatusBindings` and `equipmentTransforms` collections. Neither
collection contains live values, quality, timestamps, sequence counters, or
interpolation state.

The Object archive projection is explicit:

```ts
type ArchivedStepObjectAssetRecordV3 =
  Omit<StepObjectAssetRecordV3, 'sourceBytes'> & {
    readonly sourceSha256: string
  }

type ArchivedObjectAssetRecordV3 =
  | ArchivedStepObjectAssetRecordV3
  | BoxObjectAssetRecordV3
  | CylinderObjectAssetRecordV3
```

`objects/assets.json` contains only `ArchivedObjectAssetRecordV3` records and
never embeds or base64-encodes STEP bytes. For a STEP record,
`sourceSha256` is lowercase 64-character hex and resolves
`objects/assets/<sourceSha256>.step`; it is content identity, not Object Asset
identity, so two different Asset IDs may reference the same digest.

Unordered collections are sorted by stable ID for deterministic JSON. Job array
order and each Job's Pose order are preserved as domain order. Box/Cylinder
definitions remain inline in `objects/assets.json` and produce no `.step`
entry. STEP Object source bytes are content-addressed at encode time: each STEP
Asset still represents one whole source, while byte-identical Asset records
reference one shared `objects/assets/<sha256>.step` entry. The entry digest must
match its exact bytes on decode. Decode rejects a missing/unreferenced blob, a
digest/byte mismatch, duplicate JSON Asset ID, or conflicting archive path
before constructing `StepObjectAssetRecordV3` and before active mutation.

### 6.4 OPC UA Transform Binding

```ts
interface ConnectorOpcUaScalarMappingV1 {
  readonly nodeId: string
  readonly scale: number
  readonly offset: number
}

interface ConnectorEquipmentTransformMappingV1 {
  readonly id: string
  readonly name: string
  readonly x: ConnectorOpcUaScalarMappingV1
  readonly y: ConnectorOpcUaScalarMappingV1
  readonly z: ConnectorOpcUaScalarMappingV1
  readonly roll: ConnectorOpcUaScalarMappingV1
  readonly pitch: ConnectorOpcUaScalarMappingV1
  readonly yaw: ConnectorOpcUaScalarMappingV1
}

interface GatewayEquipmentTransformProfileV1 {
  readonly id: string
  readonly revision: string
  readonly name: string
  readonly samplingIntervalMs: number
}

interface FixedTwoCycleSmoothingPolicyV1 {
  readonly mode: 'two-cycle'
  readonly cycles: 2
}

interface ProjectOpcUaNumericStatusBindingV3 {
  readonly entityId: ExternalEntityId
  readonly nodeId: string
  readonly scale: number
  readonly offset: number
}

interface ProjectOpcUaEquipmentTransformBindingV3 {
  readonly entityId: ExternalEntityId
  readonly gatewayId: string
  readonly gatewayProfileId: string
  readonly gatewayProfileRevision: string
  readonly mode: 'absolute'
  readonly referenceFrameId: 'world' | 'mcp'
  readonly smoothing: FixedTwoCycleSmoothingPolicyV1
}

interface GatewayEquipmentTransformCatalogV1 {
  readonly type: 'equipment-transform-profile-catalog'
  readonly gatewayId: string
  readonly profiles: readonly GatewayEquipmentTransformProfileV1[]
}

interface GatewayNumericStatusMappingDescriptorV1 {
  readonly id: string
  readonly nodeId: string
  readonly scale: number
  readonly offset: number
}

interface GatewayNumericStatusCatalogV1 {
  readonly type: 'numeric-status-catalog'
  readonly gatewayId: string
  readonly samplingIntervalMs: number
  readonly mappings: readonly GatewayNumericStatusMappingDescriptorV1[]
}
```

`ProjectOpcUaNumericStatusBindingV3` is the closed V3 replacement for
`ProjectOpcUaEquipmentBindingV1`: it changes legacy Object-only `instanceId`
ownership to canonical `entityId`, so both `equipment:*` and `object:*` targets
use the same durable binding shape. At most one numeric Status Binding may
target an entity. Its target must exist, `nodeId` must be non-empty, and
`scale`/`offset` must be finite. Native V3 rejects the legacy `equipment` array,
an `instanceId` field, duplicate targets, or orphan canonical IDs. Numeric
Status Binding remains independent from Transform Binding.

`referenceFrameId` is explicitly limited to World or MCP in this stage and
defaults to MCP. Every persisted Binding contains exactly
`smoothing: { mode: 'two-cycle', cycles: 2 }`; no duration in milliseconds is
stored. A Profile sampling interval `T` is within inclusive `[10, 1000]` ms and
defaults to `100` ms. Runtime interpolation duration is Profile-derived as
`D = 2 * T`, so the default duration is exactly `200` ms.

The Connector configuration keeps the existing `equipment` numeric Status
array and adds a separate `equipmentTransformProfiles` array containing the
server-side mappings above. Catalog Profiles derive from those mappings and copy
the Connector's existing global polling interval into `samplingIntervalMs`.
This preserves current Status deployments, avoids a second scheduler, and makes
the two sources independently configurable.

The Connector also publishes a read-only `numeric-status-catalog` projected
from that unchanged `equipment` array plus the same normalized global
`samplingIntervalMs`. Mapping IDs and normalized
`nodeId`/`scale`/`offset` tuples must each be unique. Existing
`equipment-status.values` remain keyed by Connector mapping ID. The browser
resolves each V3 numeric Status Binding to exactly one catalog entry by exact
`nodeId`/`scale`/`offset`, then routes that already converted value to the
Binding's canonical `entityId`; it never applies scale/offset a second time.
Zero or multiple matches produce BAD for that Binding and preserve the Manual
fallback. Catalog publication changes no mounted Connector configuration and
requires no OPC UA write.

Both the numeric and transform catalogs carry the same required `gatewayId` and
are scoped to one WebSocket connection generation. Each catalog must be accepted
before any frame of its kind; a pre-catalog frame is ignored, refreshes no clock,
and leaves its consumers on Manual fallback in WAITING until the fixed 3000 ms
catalog deadline, then BAD. An exact semantic duplicate catalog is ignored. A
different second catalog in one connection, a Gateway ID mismatch between the
two catalogs, or a catalog whose Gateway ID differs from the connection's first
accepted catalog is a protocol fault: the browser closes that socket, clears
both catalogs/mapping resolutions/sequences, and reconnects. Reconnect increments
`connectionGeneration`; no old catalog or numeric/transform frame may resolve in
the new generation.

`gatewayId` is a new required top-level Connector setting. The checked-in and
documented example configurations receive an explicit value; an older mounted
configuration without one fails startup with a migration message rather than
silently adopting an identity. Its existing Joint and numeric `equipment`
mappings otherwise remain unchanged.

Transform NodeIds, scales, and offsets are Connector configuration, not browser
Project Transform Binding configuration. The V3 numeric Status Binding retains
the existing Project-side `nodeId`/`scale`/`offset` semantics; this schema change
only canonicalizes target ownership and does not rewrite mounted Connector
configuration. The gateway sends a read-only Profile catalog containing Gateway
ID, Profile ID, revision, display name, and sampling interval. The browser binds
one catalog Profile to one
canonical external entity and persists only that immutable selection plus its
reference frame. A missing or revision-mismatched Profile never silently
retargets an entity; quality remains BAD until the operator selects an exact
available revision. One Project may assign a Profile to at most one entity.

This is intentionally different from the current unused Project NodeId fields.
The browser does not attempt to rewrite global Middleware configuration, and
two browser clients cannot overwrite each other's Node mappings.

The Profile revision is a deterministic SHA-256 digest of the normalized six
NodeIds, scales, offsets, global sampling interval, and canonical output-unit
contract, computed by the Connector at startup. It is not an
operator-maintained version string. Changing any mapping or the polling interval
therefore changes the revision automatically. The non-empty Gateway ID is stable
Connector configuration and prevents a Project from accepting a coincidentally
matching Profile exposed by another gateway.

### 6.5 Migration

- v1 first migrates through the existing v2 migration.
- V2 Robot Link bytes are hashed first. Each unique SHA-256 becomes exactly one
  v3 source Asset, and every legacy Link receives its reserved
  `[-1, linkOrdinal]` whole-source occurrence reference to that shared Asset.
- Migration reparses each unique legacy source hash once with the currently locked
  `occt-import-js 0.0.23`, records that parser version, and resolves the
  reserved whole-source selection against the new parse result. Because v2 did
  not persist a unit decision, a known parser-detected unit becomes
  `legacy-detected`; an unknown unit blocks migration and routes the operator to
  Robot Import. A reparse or validation failure leaves the previously active
  Project revision unchanged.
- A v2 Link's existing `localTransform` becomes its v3
  `zeroPoseLocalization`; `operatorAdjustment` starts as identity. This
  preserves legacy rendering exactly rather than reinterpreting old files.
- Each V2 Joint maps its origin/axis/limits/maximum velocity directly into the
  normalized Mechanics block. Because V2 did not persist Home, zero offset, or
  direction, migration uses `homeDeg = clamp(0, minDeg, maxDeg)`,
  `zeroOffsetDeg = 0`, and `direction = 1`. To preserve the existing rig, the
  Link06-to-Flange transform is identity and Flange-to-Tool0 is exactly
  `{ position: [0, 0, 0], quaternion: [0, 0.7071067811865476, 0,
  0.7071067811865476], scale: [1, 1, 1] }`; the existing `frames.tcp` value is
  preserved as Tool0-to-TCP. Migration hashes this normalized block as Manual
  provenance and emits one bounded `PROJECT_V2_MECHANICS_DEFAULTED` warning.
  Existing MCP/TCP frame scales must already equal `[1, 1, 1]`; a non-unit
  legacy frame fails migration as `PROJECT_LEGACY_FRAME_NON_RIGID` before any
  revision or runtime mutation rather than being silently rescaled.
- Every v1/v2 flat Pose array, including an empty array, becomes exactly one
  active Job with `id: 'job-default'`, `name: 'Default Job'`, `revision: 1`,
  and the legacy Pose order, IDs, angles, easing, and outgoing speeds preserved.
  A legacy Pose whose optional outgoing speed is absent receives the
  deterministic V3 default `speedPercentToNext: 100`. Migration recomputes every
  non-terminal `durationMs` from normalized V3 Mechanics and speed using the
  formula in section 6.3 and sets the terminal value to `1000`; if a legacy
  stored duration differs by more than `1e-9 ms`, it emits one bounded
  `PROJECT_LEGACY_POSE_DURATION_NORMALIZED` warning rather than retaining two
  conflicting motion authorities. Every legacy angle must also lie within the
  migrated Mechanics command-space limits. A violation fails migration as
  `PROJECT_LEGACY_POSE_OUT_OF_LIMITS` with the bounded stable detail shape from
  section 6.3; migration never clamps or publishes a partial Default Job.
- Every legacy Object Asset becomes `sourceKind: 'step'`; migration invents no
  Box or Cylinder Asset.
- Existing imported Object transforms become canonical MCP-local
  `manualTransform` values with `transformSource: 'manual'`; the v3 Instance no
  longer contains a transform, renames its archived numeric value to
  `manualNumericStatus`, and starts with `graspable: false`. If the legacy
  `statusSource` was OPC UA, the archived value is retained only as the fallback
  and one bounded `PROJECT_V2_STATUS_FALLBACK_ASSUMED` warning is emitted.
- Every V2 `opcUa.equipment[]` entry migrates to exactly one
  `opcUa.numericStatusBindings[]` entry with
  `entityId: object:${instanceId}` and the exact existing `nodeId`, `scale`, and
  `offset`. Migration creates no built-in numeric Status Binding because V1/V2
  could not represent one. This target canonicalization does not redesign the
  Connector's server configuration contract.
- A migrated Object whose legacy `statusSource` is OPC UA keeps OPC UA source
  only when its matching migrated numeric Binding exists. Otherwise migration
  normalizes the source to Manual, preserves `manualNumericStatus`, and includes
  the same bounded fallback warning rather than creating an invalid V3 state.
- Deleting an entity removes its browser/Project numeric Binding and live state,
  but never edits the Connector's mounted configuration. If the Connector still
  broadcasts the deleted entity ID, the browser ignores it as unassigned.
- Missing v3 Equipment Transform bindings migrate to an empty list.
- Workspace Mode and legacy localStorage UI state never enter the V3 snapshot.
- A migrated archive is revalidated against all v3 referential and byte
  budgets before commit.

Legacy v1/v2 archives contained neither built-in Equipment configuration nor
its transforms. Migration restores both from the immutable built-in catalog,
normalizes optional numeric Status fields into `manualNumericStatus`, creates one matching canonical
`equipment:*` transform state per restored record, and emits one bounded
warning; data that was absent from the archive cannot be reconstructed. A new
V3 capture persists the currently active built-in Equipment records and their
separate canonical transform states.

### 6.6 Commit and Crash Consistency

The authoritative ProjectDB aggregate is the active-revision pointer, one
immutable byte-free revision projection, and the namespace-local source Blobs
reachable from that projection. A hydrated `WorkcellProjectSnapshotV3` owns the
resolved source bytes in memory. Robot Geometry, Object Geometry, Equipment
rows, and Three.js assets remain revision-tagged derived caches rather than
independent sources of truth.

ProjectDB has these three v3 tables:

- `projectRevisions[revisionId]` stores normalized configuration only. Robot
  source records omit `sourceBytes` while retaining `id === sha256`; STEP Object
  records replace `sourceBytes` with `sourceSha256`; Box/Cylinder branches are
  unchanged.
- `projectSourceBlobs[key]` stores exact bytes under
  `robot:<sha256>` or `object:<sha256>`, plus namespace, digest, and byte length.
  De-duplication is within a namespace. Equal content used by Robot and Object
  intentionally has one Blob in each namespace.
- `projectPointers['active']` is either stable with the active revision ID and
  last commit token, or publishing with new revision ID, retained previous
  revision ID, and one cryptographic commit token. Finalizing an already stable
  same token/target is an idempotent success; compensation never rolls back an
  already finalized target.

Raw Mechanics Manifest bytes are not Project-owned and never enter any table.
An existing revision row is immutable: an identical ID is an idempotent no-op
only when project ID and the complete byte-free projection match exactly, and
the original creation time is retained. Any identity collision fails closed.

All untrusted source ingress—New, migration, archive decode/import, public raw
replacement, or a Robot/Object source change—passes through
`ProjectSourceStagingService`, which owns the supplied buffer before its first
asynchronous digest boundary, hashes those exact bytes once, and registers an
opaque `PreparedProjectSourceV1` token. Migration, decode, analysis, confirmation,
and commit pass that same token forward; they do not rehash it. Existing
active sources carry repository-minted `VerifiedProjectSourceHandleV1` tokens
registered in a private WeakSet/WeakMap against owner, namespace, digest, byte
length, and the exact repository-owned buffer. Handles are non-serializable,
cannot be supplied through a public snapshot, and are preserved only when all
registered identity fields and the buffer identity are unchanged. Thus a
metadata-only edit performs zero source-buffer copies, source hashes, or Blob
writes. A forged, copied, mutated, missing, revoked, or cross-namespace prepared
token/verified handle fails before preparation. Cancel/discard revokes staged
tokens. Commit preparation, publishing-pointer write, runtime publication, and
stable finalization do not upgrade them. Only the post-finalization activation
phase consumes each prepared token once and mints owner-bound verified repository
handles against the active runtime's canonical resident buffer.
The repository retains exactly one canonical resident source buffer per
namespace/digest Blob key; all owner-bound handles for that key reference it.
If a newly staged owner resolves an already verified digest, promotion discards
the duplicate staged bytes and binds the owner to the canonical buffer. Runtime
parse/Geometry cache likewise keys by digest plus Geometry-affecting config.
Hydration/public read clones each unique Blob key at most once per returned
snapshot and all same-key records in that snapshot share the caller-owned clone;
that clone is isolated from the canonical buffer, so mutating it cannot alter
the store or a later read.

Every durable feature command enters through `ProjectMutationService`. Its
`replaceFromActive(recipe, preparedSourceGroups)` method serializes an async,
byte-free recipe against the currently published projection, prepares and
durably commits exactly one candidate, and publishes exactly one runtime bundle.
Feature stores are projections of that published bundle, never command-side
authorities. While a mutation is pending, duplicate submit cannot start another
candidate. Rejection preserves the prior revision, runtime, selectors, and UI
read model. `ProjectCommitCoordinator` and source handle/token registries remain
foundation-private implementation details.

Source verification is sequential across the whole Project. `ProjectHashService`
uses native `SubtleCrypto.digest` when available. On trusted-LAN HTTP without
it, the pure-TypeScript SHA-256 implementation runs only inside a dedicated
Worker with fixed 4 MiB transferable chunks, ordered acknowledgements, and at
most one chunk/job in flight globally. The main thread never executes a
whole-source JavaScript hash loop. Worker unavailability/failure rejects before
mutation; cancellation terminates it within 250 ms. Each source has an exact
60,000 ms watchdog; a silent/late Worker or native digest returns
`PROJECT_HASH_TIMEOUT` and its late completion is inert. A multi-source 256 MiB
Project retains less than 8 MiB auxiliary hashing payload and keeps the browser
animation heartbeat responsive.

V3 archive encode/decode is likewise off the main thread. The browser
production path uses a cancellable streaming codec Worker with 4 MiB transferable
chunks; it does not call `zipSync`, `unzipSync`, or read a complete 300 MiB File
into one main-thread buffer. Encode returns Blob parts. Decode validates ZIP
headers and limits before expansion, expands at most one source entry at a time,
and forwards that owned entry to source staging. Memory accounting separates
caller-owned input/output, the complete Project-owned staged-source payload set
(bounded by the 256 MiB raw-source limit), and codec auxiliary workspace; only
the last category is capped at 64 MiB. Timeout is exactly 120,000 ms and cancel completes within 250 ms;
late/error/malformed Worker output mutates nothing and revokes staged tokens.

A Project revision identity is the lowercase SHA-256 of UTF-8
`projectId + "\n" + canonicalJson(storedProjection)`. The projection recursively
sorts object keys and every unordered collection, preserves Job/Pose domain
order, and contains only verified source-digest references, never an
`ArrayBuffer`. Therefore identical configuration and byte-identical sources may
reuse an immutable revision, while changing any Robot or Object STEP byte
changes the identity even when filenames and all other metadata are unchanged.

A commit uses these ordered phases:

1. acquire the Project mutation lock and disable interaction;
2. build a candidate through the frozen candidate factory, structurally
   validate it, validate retained verified handles/prepared source tokens, and
   calculate the prepared hydrated snapshot, byte-free revision row, required
   new Blobs, and revision ID without rehashing sources or writing ProjectDB;
3. stage all runtime assets against the prepared hydrated snapshot without
   mutating active state. Parse/Geometry reuse keys are source digest plus every
   geometry-affecting configuration field, not Project revision ID; published
   bundle associations remain revision-tagged;
4. preflight additional unique Blob bytes plus bounded row overhead when a
   storage estimate is available, reconcile non-authoritative derived caches,
   then in one IndexedDB transaction verify the expected stable pointer, repair
   any non-session-verified same-key Blob from the newly verified owned bytes,
   write missing Blobs plus the byte-free revision, and set the pointer to
   publishing. Known insufficient headroom or `QuotaExceededError` becomes
   `PROJECT_STORAGE_QUOTA_INSUFFICIENT`;
5. synchronously publish the prepared runtime bundle, then atomically finalize
   the matching publishing token to a stable pointer;
6. consume each pending prepared-source token exactly once, bind every owner to
   its canonical resident buffer, and mint/activate verified owner handles. Only
   after this succeeds is the publication eligible for observer notification;
   and
7. release the lock, notify observers, dispose the retained old runtime, then
   mark/sweep unreferenced cache rows, revision rows, and source Blobs.

The prior active revision remains retained only while the pointer is publishing.
Garbage collection rereads the pointer, derives the stable/publishing mark set,
sweeps revisions, and sweeps Blobs in one read-write transaction, so another
tab cannot interleave a commit and lose its new revision. In-memory Three.js
cleanup-retry IDs do not pin ProjectDB rows or Blobs. A cleanup/disposal
exception after successful publication does not roll the commit back: the new
pointer/cache/runtime remains authoritative, one bounded diagnostic is emitted,
and cleanup is retried idempotently.

The revision repository exposes separate prepare-without-write and atomic
commit-prepared operations. Mutating a caller buffer while source staging is
pending cannot affect its digest or stored bytes because that buffer was owned
first. Every public read/archive encode clones buffers and never exposes the
repository-owned instance.

Runtime publication performs no parsing, hashing, allocation, or persistence;
it is one prevalidated bundle-pointer replacement. If it throws after the
publishing pointer transaction, the matching commit token atomically restores
the retained previous pointer and runtime before unlocking. Compensation failure
enters `recovery-required`, keeps interaction blocked, and requests one reload.
If pointer finalization fails after new runtime publication, the complete new
pointer/cache/runtime remains together in publishing state, interaction stays
blocked, and reload resolves it rather than partially rolling back.
If token consumption or verified-handle activation fails after the pointer is
stable, the stable pointer, cache, and published runtime remain coherent, but the
mutation lock and `recovery-required` gate prevent observer notification,
editing, or playback. Reload integrity-hydrates the same stable revision and
mints/activates its handles before access resumes. This state is never eligible
for legacy cleanup.

Startup reads the active pointer and its byte-free revision first, resolves
every namespace-local Blob reference, validates namespace and byte length, and
sequentially recomputes each referenced digest before minting new verified
handles or using a derived cache. Missing/corrupt references fail closed. If
the pointer is publishing, startup integrity-hydrates/prepares/publishes the new
revision, finalizes the matching token, and activates its verified owner handles;
if that fails while the pointer is still publishing and a previous revision
exists, it compensates and rebuilds the previous revision. A stable pointer is
never compensated and instead remains `recovery-required` until integrity
hydration and handle activation succeed. It then runs the single-transaction
mark/sweep. Crashes
after atomic commit/before runtime publish, after publish/before finalize, and
during finalize therefore cannot leave publishing stuck. Legacy adoption keeps
the obsolete full-byte Project, Object, and Equipment Dexie rows until the same
v3 revision has all three conditions: a
matching stable pointer, the new runtime plus every verified owner handle active,
and a fresh DB-only reopen-equivalent hydrate/integrity proof of every referenced
Blob without consulting legacy data. Finalization, activation, or proof failure
retains every legacy row. Cleanup failure is retry-only and may run again only
after re-proving all three conditions; an external release event is not a
retention condition.

## 7. Robot Import Architecture

### 7.1 Source Analysis

The STEP Worker returns a serializable source analysis containing source
statistics, OCCT assembly nodes, deterministic node paths, mesh membership,
names, and detected units. Each unique source hash is parsed once per Import or
Project restore operation.

Selection count, suffix, individual `File.size`, and selected-total size are
validated on one through seven selected `File` objects before any read, copy,
hash, or Worker allocation. Only then are accepted selections hashed. For byte-
identical selections, the first selection is retained and later selections
collapse by SHA-256 with one non-blocking
`ROBOT_STEP_DUPLICATE_SOURCE_COLLAPSED` warning. The resulting persisted unique-
source-Asset count must independently remain one through seven. Within a single
assembly, distinct node paths remain distinct occurrences even when their
Geometry is identical. Source identity is content-based; a file name is display
metadata.

Digest collapse intentionally does not preserve upload filename or selection
ordinal as a Geometry occurrence. Therefore two byte-identical independent flat
single-part Files expose the same ordinary `(sourceAssetId, nodePath, meshIndex)`
key and cannot represent two separately placed Links in a new import. Assigning
that one key to multiple Links fails before commit as `ROBOT_LINK_PART_CONFLICT`
with guidance to export a component-preserving assembly whose repeated placements
have distinct node paths, or to provide semantically distinct Link STEP Geometry.
One assembly source may still reuse identical raw mesh Geometry across different
Links when each occurrence has a distinct non-negative assembly `nodePath`; the
source bytes remain stored once.

Every source is normalized independently into meters before Link subset merge.
Known millimeter, meter, and inch units preselect their explicit scale; the
operator may override that selection only with explicit confirmation. An unknown
unit always requires an operator selection and confirmation before mapping. The
chosen unit, decision provenance, and source-to-meter factor are persisted.
Multiple sources with different known units may contribute to one Link only
after this normalization.

The source analyzer exposes part candidates from assembly nodes that own meshes.
Meshes not represented by a named assembly node receive deterministic synthetic
part IDs so the operator can map a flat multi-mesh STEP manually. The analyzer
does not create Kinematics.

### 7.2 Wizard Flow

1. **Sources:** synchronously validate one through seven selected Robot STEP
   `File` objects and their selected byte limits; then hash and collapse byte-
   identical selections, validate one through seven unique persisted source
   Assets and de-duplicated byte limits, and detect units.
2. **Parts:** show the assembly/mesh tree, source names, statistics, and a 3D
   preview.
3. **Link Mapping:** suggest `LINK00` through `LINK06`; require explicit operator
   confirmation for all assignments and explicit acknowledgement of every
   excluded part.
4. **Mechanics:** choose the existing Datasheet configuration, import the
   optional Manifest, or enter the six-Joint serial Mechanics manually. Display
   the fixed requirement before entry; reject a declared count other than six
   without interpreting STEP component count as DOF.
5. **Zero Pose:** preview all Links, exercise each Joint individually, and
   validate reconstructed source bounds.
6. **Frames and Collision:** confirm Base, Flange/Tool0, TCP, generated Link
   collision boxes, and any operator Geometry adjustment.
7. **Review and Commit:** show errors, warnings, budgets, source hashes, and the
   exact replacement summary; commit once.

The existing one-Link replacement mode remains available, but it is explicitly
a Geometry-only operation against the active Robot Definition. It may not be
used to bypass full-Robot validation with a multi-Link assembly.

### 7.3 Geometry Localization

Each selected occurrence first composes every transform on its persisted node
path and any mesh-local placement. For source Geometry expressed in
assembly/world Zero Pose coordinates:

```text
OccurrenceInSource = NodeWorldFromPath * MeshLocal
OccurrenceRobotBaseZero = SourceRootToRobotBase * OccurrenceInSource
OccurrenceLinkLocal = inverse(LinkZeroWorld) * OccurrenceRobotBaseZero
```

The Worker applies the occurrence matrix before merging selected meshes, so two
instances of one raw mesh index under different non-identity node paths remain
in their distinct assembly positions. `SourceRootToRobotBase` includes the
persisted source-to-meter conversion. The full Link transform, not only
translation, is persisted as `zeroPoseLocalization`. Link-local sources still
bake their node/mesh occurrence transforms but use identity Link localization.
The operator's editable Geometry adjustment is stored separately so provenance
is not destroyed.

All source references assigned to one Link must use the same
`coordinateMode`. Mixing assembly-Zero-Pose and Link-local references within a
single Link is rejected because one Link-level localization cannot represent
both. Different Links may use different modes.

At Zero Pose, applying the Robot FK world matrix followed by localization must
reconstruct the selected source component world Geometry. Collision boxes are
generated after localization from only the selected Link subset; the whole
Robot assembly AABB must never become one Link collider.

### 7.4 Robot Validation and Error Handling

Import fails before persistence when any of the following occurs:

- unique source count outside one through seven after duplicate collapse;
- invalid/unsupported STEP filename or extension, empty source, or byte budget violation;
- corrupt STEP, empty parse, or source-wide Geometry budget violation;
- source parsing that exceeds the fixed Worker watchdog or terminates with a
  Worker `error`/`messageerror`;
- unconfirmed source unit, inconsistent stored source-to-meter conversion, or
  mixed coordinate modes within one Link;
- missing `LINK00` through `LINK06` assignment;
- empty Link selection, nonexistent node path, or out-of-range mesh index;
- the same source/node/mesh occurrence assigned to multiple Links, including
  byte-identical independent flat Files that collapsed to that one occurrence;
- an unassigned part that the operator has not explicitly excluded;
- one fused body that cannot provide seven independently moving Link subsets;
- a Manifest or Manual Mechanics payload declaring other than six Joints;
- invalid serial Mechanics, limits, Home, velocity, Flange, Tool0, or TCP;
- failed Zero Pose reconstruction; or
- failed collision proxy or persistence staging.

The stable operator/API error codes are:

| Code | Meaning |
|---|---|
| `ROBOT_STEP_SOURCE_COUNT` | Selected `File` count before reading or unique persisted source count after duplicate collapse is outside one through seven. |
| `ROBOT_STEP_DUPLICATE_SOURCE_COLLAPSED` | Non-blocking warning: later byte-identical selections collapsed into the first source. |
| `ROBOT_STEP_FILENAME_INVALID` | STEP filename is outside 1-255 UTF-8 bytes or does not end case-insensitively in `.step`/`.stp`; reject before read. |
| `ROBOT_STEP_BUDGET_EXCEEDED` | A source, parse tree, Geometry payload, Link, or Robot exceeds a defined budget. |
| `ROBOT_STEP_PARSE_FAILED` | Source is empty (`reason: 'empty-source'`) or OCCT cannot produce usable Geometry/source analysis. |
| `ROBOT_STEP_EXTERNAL_REFERENCE_UNSUPPORTED` | The STEP assembly requires an unresolved external source. |
| `ROBOT_STEP_UNSUPPORTED` | The source exposes no supported triangulatable selectable Geometry occurrence. |
| `ROBOT_STEP_PARSE_TIMEOUT` | A source exceeded the fixed Worker parse deadline. |
| `ROBOT_STEP_UNIT_REQUIRED` | A source unit is unknown, unconfirmed, or inconsistent with its stored conversion. |
| `ROBOT_STEP_FUSED_BODY` | Seven independent Link subsets cannot be selected. |
| `ROBOT_LINK_MAPPING_INCOMPLETE` | A required Link or explicit exclusion decision is missing. |
| `ROBOT_LINK_PART_CONFLICT` | A source/node/mesh occurrence has multiple owners or incompatible coordinate modes. For collapsed byte-identical flat Files, export distinct Link Geometry or one component-preserving assembly with distinct occurrence paths. |
| `ROBOT_JOINT_COUNT_UNSUPPORTED` | Manifest/Manual Mechanics declares a Joint count other than the required six; details include declared and required counts. |
| `ROBOT_MECHANICS_MANIFEST_FILENAME_INVALID` | Manifest filename is outside 1-255 UTF-8 bytes; reject before read. |
| `ROBOT_MECHANICS_MANIFEST_TOO_LARGE` | Manifest `File.size` exceeds 1,048,576 bytes before read. |
| `ROBOT_MECHANICS_MANIFEST_INVALID_UTF8` | Manifest bytes fail fatal UTF-8 decoding. |
| `ROBOT_MECHANICS_MANIFEST_INVALID_JSON` | Manifest JSON syntax or duplicate-key validation fails. |
| `ROBOT_MECHANICS_MANIFEST_SCHEMA_INVALID` | Decoded Manifest fails the closed v1 schema. |
| `ROBOT_MECHANICS_INVALID` | Serial Mechanics, limits, Home, Flange, Tool0, or TCP are invalid. |
| `ROBOT_MECHANICS_DERIVED_NON_FINITE` | A finite input overflows a derived duration, matrix, AABB, or proxy. |
| `ROBOT_ZERO_POSE_MISMATCH` | Localized Link Geometry does not reconstruct the source Zero Pose. |
| `ROBOT_SOURCE_MAPPING_DRIFT` | A persisted source mapping cannot be resolved after reparse. |
| `ROBOT_IMPORT_COMMIT_FAILED` | Persistence or runtime publication fails after staging. |

A fused Robot returns the stable error code `ROBOT_STEP_FUSED_BODY` and recovery
guidance to export separate bodies or provide a component-preserving STEP. The
system never guesses a cut plane or duplicates one mesh across Links.

All sources, converted assets, mappings, Mechanics, and proxies are staged
before active mutation. Cancel or failure disposes staged Three.js resources
and leaves the active Project, DB rows, runtime repositories, selection,
collision state, and Robot configuration unchanged. Old assets are disposed
only after the replacement commits successfully.

On Project restore, a changed parser version reparses each source once and
revalidates persisted node paths, names, and mesh membership. An unreconciled
mapping fails transactionally as `ROBOT_SOURCE_MAPPING_DRIFT` and directs the
operator to reopen Robot Import; it never remaps a Link silently.

### 7.5 Robot Performance Budgets

The short-term implementation intentionally preserves conservative limits:

- one through seven selected Robot STEP `File` objects before reading and one
  through seven unique persisted Robot source Assets after digest collapse;
- at most 25 MiB per source;
- at most 100 MiB of unique Robot source bytes;
- at most 600,000 triangles across all parsed unique Robot sources;
- at most 150,000 selected triangles per resolved Link;
- at most 448 parsed meshes across all sources;
- at most 2,048 assembly nodes, an assembly depth of 64, and 448 total part
  references;
- at most 224 parsed material definitions across all sources;
- at most 64 meshes and 32 materials per resolved Link; and
- at most 256 MiB of serialized position, normal, and index array payload from
  the Worker; and
- the existing 1,500,000 visible scene-triangle limit.

These Robot limits do not become Object source-count limits. Each imported STEP
Object Asset owns one whole STEP file, with the existing 50 MiB,
250,000-triangle, 64-mesh, and 32-material per-Asset limits. Generated Box and
Cylinder Assets consume the visible-scene triangle budget but consume zero STEP
bytes and zero ZIP STEP entries. The existing 256 MiB Project-wide raw
STEP-byte limit remains in force across Robot and imported STEP Object sources.

Project restore does not eagerly parse every stored Object Asset. It integrity-
verifies all referenced source Blobs, but prepares STEP Geometry only for Assets
referenced by a visible Instance; uninstantiated or exclusively hidden Assets
remain byte-verified and lazy. A mutation that creates/shows an Instance first
prepares any missing Geometry in the candidate, checks both declared statistics
and actual parser totals, then enforces the 1,500,000 rendered-triangle and 1,024
actual Mesh/material-group limits before publication. Failure leaves the prior
visibility/runtime unchanged. Cache identity is source digest plus Geometry-
affecting configuration, so repeated Instances and semantic Assets reuse one
parse/Geometry allocation. Boundary tests load 256 inactive Assets without eager
parse, activate an exact-budget fixture, and reject triangle/group boundary plus
one before publication.

Changing these limits requires separate measured browser profiling and is not
part of this stage. The Worker rejects node, depth, material, mesh, and typed
array limits before transferring Geometry to the main thread. Parsing and
Geometry conversion remain off the main thread. Robot sources are parsed
sequentially rather than by concurrent OCCT workers. A main-thread 60,000 ms
watchdog terminates a non-responsive source Worker, and Worker `error` or
`messageerror` follows the same staged-resource cleanup path. The operator sees
the current phase and can cancel by terminating the active Worker; intra-OCCT
percentage progress is not fabricated when the parser cannot provide it.

## 8. OPC UA Equipment Transform Architecture

### 8.1 Connector Contract

The Connector flattens the six mappings for each configured external entity
into the same OPC UA read request used for that sampling cycle. It publishes one
atomic frame:

```ts
type EquipmentTransformSample =
  | {
      readonly quality: 'GOOD'
      readonly positionM: readonly [number, number, number]
      readonly rotationDegZYX: readonly [number, number, number]
    }
  | {
      readonly quality: 'BAD'
    }

interface EquipmentTransformFrame {
  readonly type: 'equipment-transform-frame'
  readonly sequence: number
  readonly timestampMs: number
  readonly values: Readonly<Record<string, EquipmentTransformSample>>
}

interface GatewayNumericStatusFrameV1 {
  readonly type: 'equipment-status'
  readonly sequence: number
  readonly timestampMs: number
  readonly values: Readonly<Record<string, number | null>>
}
```

> Six finite values from one Connector cycle are accepted as one atomic target;
> after a one-time baseline snap, each subsequent changed target reaches the
> displayed and Geometry-collision effective transform over exactly two
> sampling cycles.

The `values` keys are immutable gateway Profile IDs. The browser maps them to
external entities through Project bindings. A Profile is GOOD only when all six
DataValues have GOOD StatusCodes and all mapped outputs are finite. No partial
Pose is emitted. The timestamp identifies
the Connector sampling cycle. `sequence` increases once per Connector cycle and
the numeric/transform frames from that cycle carry the same value. The browser
tracks `lastNumericSequence` and `lastTransformSequence` independently, ignores
a duplicate or lower value only within that frame kind, and resets both only
after that connection reopens.

For each numeric mapping, Middleware emits a finite converted number only when
the corresponding OPC UA DataValue has a GOOD StatusCode and
`raw * scale + offset` is finite. BAD StatusCode, missing/non-finite raw value,
non-finite output, or cycle read failure emits `null` for that mapping; a read
failure emits `null` for every numeric mapping. Browser reduction requires the
current-generation numeric catalog and sequence, treats `null` or a missing
bound mapping as BAD, and refreshes neither last-GOOD nor stale clocks. A finite
number is already scaled, becomes the transient GOOD effective value, and is not
converted again. BAD, STALE, catalog mismatch, protocol fault, and disconnect
display the durable `manualNumericStatus` fallback; transport disconnect may be
shown separately as DISCONNECTED. No non-GOOD numeric frame mutates Project
state or the fallback.

The numeric catalog interval uses the same inclusive `[10, 1000] ms` validation.
After that catalog is accepted, numeric first-sample and silence/last-GOOD stale
deadline is exactly `max(3 * samplingIntervalMs, 1000 ms)`, including a
numeric-only connection with zero Transform Profiles. Before the catalog, the
fixed 3000 ms handshake rule applies. An explicit numeric `null` is BAD by
precedence and does not become STALE merely as time advances; a later finite
GOOD value restarts the last-GOOD clock. Complete frame silence reaches STALE at
the exact deadline and displays `manualNumericStatus`.

Runtime stale age is measured in one injected browser-local wall-clock domain:
the production default is `Date.now()` both when a frame is received and when
its age is evaluated. It is never calculated by subtracting the Connector wall-
clock timestamp and never mixes `performance.now()` with epoch milliseconds.
`timestampMs` remains diagnostic metadata, so unsynchronized browser/Connector
host clocks cannot create false STALE or fresh states.

A wall-clock discontinuity is conservative. A negative elapsed value from a
backward jump makes the retained sample non-fresh, holds the current Pose/value,
and requires the next valid current-generation GOOD to stamp the new clock and
establish one baseline. A forward jump may make the sample STALE. Neither case
extrapolates, replays samples, invents a zero Pose, or mutates Project state.

Wire sample quality is only `GOOD` or `BAD`. Browser runtime quality is
`WAITING`, `GOOD`, `BAD`, `STALE`, or `DISCONNECTED`. Runtime-only states are
never forged as upstream OPC UA StatusCodes. The reducer evaluates the following
precedence from top to bottom:

| Runtime quality | Exact condition |
|---|---|
| `DISCONNECTED` | The browser WebSocket is not open. This overrides every catalog or sample state. |
| `BAD` | The socket is open and the catalog handshake timed out, a bounded malformed-string current-generation protocol fault occurred, the Gateway/Profile/revision does not match, or the latest accepted Profile sample is explicitly BAD. BAD remains until a matching GOOD sample or a connection transition. |
| `WAITING` | The socket is open and the catalog deadline has not elapsed, or a matching Profile has produced no accepted sample in the current connection and its stale deadline has not elapsed. |
| `STALE` | A matching Profile produced no accepted sample before the deadline, or its latest accepted GOOD sample age is greater than or equal to the stale deadline. |
| `GOOD` | The latest accepted sample is GOOD and its local receipt age is strictly less than the stale deadline. |

Before a catalog supplies authoritative Profile `T`, the catalog-handshake
deadline is the fixed worst-case `3000 ms` measured from socket open. After the
matching catalog is accepted, the per-Profile stale/first-sample deadline is
`max(3 * samplingIntervalMs, 1000 ms)`. Before the first sample on a connection,
the sample clock starts when the matching catalog is accepted.
After a GOOD sample, it starts at that GOOD sample's browser-local `Date.now()`
receipt time. BAD frames do not move Geometry or refresh a prior GOOD stale clock;
explicit BAD nevertheless has higher display precedence than STALE. Duplicate
and out-of-order frames are not accepted and refresh no clock.

The gateway sends the Profile catalog when a browser socket opens. An upstream
OPC UA read error or upstream session disconnect emits a BAD sample for every
configured Transform Profile within one polling interval. A browser WebSocket
disconnect is detected locally as DISCONNECTED. Neither path emits zero values
or reuses values under a GOOD label.

Connector configuration validation requires a non-empty stable Gateway ID,
unique Profile IDs, non-empty names, six non-empty NodeIds, finite scales and
offsets, and a finite global sampling interval in inclusive `[10, 1000]` ms;
the documented default is `100` ms.
Startup then computes each non-empty Profile revision. Project validation requires a
unique canonical entity target, a unique Profile assignment, and non-empty
Gateway ID, Profile ID, and revision. Invalid Connector configuration prevents
startup with a field-specific error. The Connector never calls an OPC UA write
API.

The lightweight Connector contract permits at most 32 Transform Profiles and at
most 256 total read Nodes per cycle across the six Robot Joints, numeric Status,
and Transform mappings. Gateway IDs, Profile IDs, and Profile display names are
1 through 128 UTF-8 bytes, and each NodeId is 1 through 1,024 UTF-8 bytes.
Numeric/Transform catalog and frame JSON payloads are limited to 64 KiB UTF-8 each.
Connector configuration over a count or identifier limit fails startup; a
browser protocol payload over the wire limit is rejected before JSON reduction,
freezes the current render Pose, and closes the socket as `DISCONNECTED`.

The same Connector process accepts at most
`MAX_GATEWAY_CLIENTS = 8` concurrent browser WebSockets. Clients one through
eight share the single polling/read result; accepting a ninth must immediately
close only that socket with WebSocket code `1013` and must not create another OPC
UA read loop or subscriber. Before each broadcast to an open client, the
Connector checks that client's `bufferedAmount`: exactly 1,048,576 bytes may
receive the next bounded message, while a value greater than 1,048,576 bytes
closes only that slow client with code `1013` and skips its send. Thus 1,048,576
and 1,048,577 are exact pass/close test boundaries; one slow browser cannot delay
polling or delivery to the other seven.

Browser validation is synchronous, string-only, and byte-before-parse. Joint
presentation keeps three separate runtime facts: the last accepted
`JointQuality`, a transient transport overlay `BAD | STALE | null`, and shared
connection state `CONNECTED | DISCONNECTED`. The overlay and connection state
are presentation data, not synthetic `JointFrame` quality values, and
`JointQuality` is not widened. The public presentation projection exposes all
three facts plus `effectiveQuality = transportOverlay ?? acceptedQuality`; shell
consumers render `effectiveQuality`, while no transport or connection event may
rewrite `acceptedQuality`. A
bounded string that is invalid JSON or fails the closed message schema emits
exactly one current-generation protocol fault, refreshes none of the sequence,
receipt, or last-GOOD clocks, keeps the WebSocket open, and transitions active
Transform consumers on that connection to `BAD` with motion state `HELD` plus
active numeric consumers to `BAD` with immediate `manualNumericStatus` fallback.
It also preserves all six currently displayed Robot Joint angles and the last
accepted Joint quality/timestamp, refreshes no Joint accepted-frame/last-GOOD
clock, keeps connection state `CONNECTED`, and sets the Joint transport overlay
to `BAD`.
Binary or oversized input is never decoded or truncated; it closes the socket
and transitions Transform consumers to `DISCONNECTED` with `HELD` and numeric
consumers to `DISCONNECTED` with the same Manual fallback. It preserves the six
Joint angles plus last accepted Joint quality/timestamp, keeps the transport
overlay `BAD`, and reports `DISCONNECTED` only through the separate shared-
connection state. A successful reconnect starts a new connection generation,
sets only connection state to `CONNECTED`, clears the old-generation overlay,
preserves the accepted Joint data, and starts the 1,000 ms silence watchdog. A
later valid current-generation Joint message clears any current-generation
overlay and recovers without a zero-angle transition.

Joint freshness uses browser-local receipt age in the existing reducer's clock
domain, never Connector wall-clock subtraction. `joint-frame.timestampMs` from
the wire is diagnostic only; the adapter stamps accepted frames with injected
browser receipt `nowMs` (default `Date.now()`) and retains the upstream timestamp
separately. Joint presentation exposes `lastAcceptedReceivedAtMs: number | null`:
it is `null` before the first accepted Joint frame and otherwise retains that
last browser-local receipt time across transport faults/reconnects. Socket-open
time, not a fabricated receipt, anchors the current-generation initial watchdog.
On an open socket, exactly 1,000 ms of Joint-frame silence overlays STALE while
retaining angles; a fresh current-generation GOOD clears it. A
Connector clock offset of plus or minus one day cannot make a newly received
GOOD Joint frame STALE or fresh.

An entity may retain a configured Binding while its Transform source is Manual.
If Transform source is OPC UA, exactly one persisted Binding for that entity is
required. Switching Manual to OPC UA is rejected unless the same Project
candidate already contains that Binding. Removing an active Transform Binding
atomically sets `transformSource: 'manual'`, restores `manualTransform`, clears
the runtime target/segment, and removes only the Transform Binding; there is no
intermediate invalid candidate, and the numeric Binding/source are unchanged.
The Project remains loadable without a live gateway; a missing catalog
does not corrupt the archive. A closed socket reports `DISCONNECTED`; once the
socket is open, a missing catalog after its deadline or Gateway/Profile revision
mismatch reports `BAD`, with Manual fallback before the generation's first
GOOD and with the held `renderPose` after a prior GOOD.

One polling cycle issues exactly one OPC UA multi-node `session.read` call for
all configured Joint, numeric Status, and Transform Profile Nodes. This provides a
coherent gateway frame but does not claim PLC task-level transactional
atomicity. A later controller sample-counter or structured-array Node contract
is required if the source PLC must prove that stricter guarantee. The current
stage creates no OPC UA Subscription or MonitoredItem.

### 8.2 Coordinate Convention

- `referenceFrameId` is World or MCP; MCP is the default.
- X/Y/Z mapped outputs are meters.
- Roll/Pitch/Yaw mapped outputs are degrees.
- The value transform is `raw * scale + offset`.
- Typical millimeter nodes use scale `0.001` and degree nodes use scale `1`.
- Quaternion conversion is `Euler(roll, pitch, yaw, 'ZYX')`, matching the
  current Manual Equipment Inspector.
- Scale remains the persisted Manual Geometry scale and is not controlled by
  OPC UA.

The transient target, segment, and render Poses are retained in reference-frame
coordinates. The runtime calculates `referenceWorld * renderPose`, then converts that result to the
MCP-local representation consumed by the current scene. A World-bound entity
therefore remains fixed in World when MCP changes.

### 8.3 Runtime Ownership

Each external entity has one persisted Manual fallback and one transient
smoothing reducer. `targetPose` is the reducer's current motion destination and
is reset to the sampled held Pose when motion is cancelled;
`renderPose` is the only effective Pose exposed to the scene and Geometry
collision. Target and render revisions are intentionally separate:

```ts
interface SmoothedTransformState {
  readonly quality: 'WAITING' | 'GOOD' | 'BAD' | 'STALE' | 'DISCONNECTED'
  readonly motionState: 'WAITING_BASELINE' | 'HELD' | 'INTERPOLATING' | 'SETTLED'
  readonly baselineRequired: boolean
  readonly hasAcceptedGood: boolean
  readonly targetPose: TransformPose
  readonly renderPose: TransformPose
  readonly activeSegment: {
    readonly from: TransformPose
    readonly to: TransformPose
    readonly startedAtMs: number
    readonly durationMs: number
  } | null
  readonly lastGoodReceivedAtMs: number | null
  readonly targetRevision: number
  readonly renderRevision: number
}
```

The normative state transition is:

```text
When baselineRequired and one complete current-generation GOOD target arrives:
  renderPose = target
  targetPose = target
  activeSegment = none
  motionState = SETTLED
  baselineRequired = false

On each subsequent accepted changed GOOD target at browser-local `Date.now()` t0:
  from = sample(renderPose, t0)
  to = accepted target Pose
  durationMs = D = 2 * samplingIntervalMs
  renderPose(t) = lerp/slerp(from, to, clamp((t - t0) / D, 0, 1))

On BAD, STALE, bounded malformed-string protocol fault, or disconnect at th:
  held = sample(renderPose, th)
  renderPose = held
  targetPose = held
  activeSegment = none
  motionState = HELD

On reconnect:
  baselineRequired = true
  snap once to the first later complete GOOD target

On visibility hidden at th:
  held = sample(renderPose, th)
  renderPose = held
  targetPose = held
  activeSegment = none
  motionState = HELD

On foreground resume:
  keep the pre-background held renderPose
  targetPose = renderPose
  activeSegment = none
  baselineRequired = true
  if the retained target is complete, same-generation, fresh, current-quality
     GOOD, and no later non-GOOD or protocol fault occurred:
    snap once to that target
  else:
    keep renderPose unchanged and HELD until the first later fresh GOOD target,
    then snap once to establish the new baseline
```

Translation uses clamped linear interpolation. Rotation uses normalized
shortest-arc Quaternion slerp: negate the destination Quaternion when its dot
product with the source is negative. A new changed GOOD target received during
an active segment rebases from the sampled `renderPose` at receipt time and
never extrapolates. Ordinary BAD or STALE recovery on the same open connection
does not create a new generation; the next changed GOOD target interpolates
from the held Pose. Reconnect and a foreground resume that cannot safely reuse
its retained target require the one baseline snap described above.

When Transform source is OPC UA:

- Manual XYZRPY editing is read-only.
- Binding fields, live target, runtime quality, motion state, and last-update age
  remain visible.
- The selected server Profile ID, revision, and display name remain visible.
- A source with no accepted GOOD in its current generation displays the Manual
  fallback while waiting; a non-GOOD event before that baseline holds the
  Manual fallback.
- After a GOOD has been accepted, BAD, STALE, malformed input, or disconnect
  holds the sampled `renderPose`; it never falls back to Manual or emits a zero
  or partial Pose.
- A frame becomes STALE when its browser receipt age is greater than or equal to
  `max(3 * samplingIntervalMs, 1000 ms)`; the held Pose is unchanged.
- Duplicate, lower-sequence, non-finite, partial, or matrix-identical targets
  create no new motion target and refresh only the clocks explicitly allowed by
  the protocol contract.

Switching back to Manual restores the exact persisted Manual transform. It does
not copy transient OPC UA telemetry into Project configuration. A future
"Capture live Pose as Manual" convenience action is out of scope.

The Binding identity is the tuple `(gatewayId, gatewayProfileId,
gatewayProfileRevision, mode, referenceFrameId)`. Changing any tuple field, or
entering OPC UA ownership from Manual, increments the entity generation, clears
its accepted target and sample clocks, sets `baselineRequired`, and exposes the
Manual fallback until the new Binding supplies a complete GOOD target. A Pose
from an old Profile is never reinterpreted in a new Profile or reference frame.

Robot Joint and external-entity OPC UA ownership are independent. Selecting the
Simulation Joint source does not disconnect or suppress Equipment Status or
Transform polling consumers. The shared gateway remains connected while any Robot
or external-entity OPC UA consumer is enabled.

An entity whose Transform source is OPC UA cannot be preview-dragged, committed
through Manual XYZRPY, or grasped by the Robot. Switching an already-held entity
to OPC UA is rejected with an instruction to release it first; the system never
performs an implicit drop or creates two active transform writers.

Each entity owns a strictly increasing Transform-authority generation and a serialized
mutation gate. Manual preview/apply, source transition, grasp begin/release,
Binding identity change, delete, Project replacement, and OPC UA sample
application capture that generation. A source or Binding transition invalidates
outstanding Manual preview/apply tokens before OPC UA may publish; deletion
invalidates every retained token and sample. Late persistence completion, stale
UI Apply, or a frame from an older generation is ignored. This gate is the
authority behind UI disabling and store checks, so ownership is enforced even
when actions race outside the Inspector.

### 8.4 Scene and Collision Integration

`renderPose` is the single effective transform consumed by rendering, status
overlays, selection, grasp/collision participation, and the Geometry entity
registry. `targetPose` is never rendered or registered for collision. Sampling
is coalesced to at most one `renderPose` publication per animation frame, and
World/MCP reference conversion occurs after interpolation in the selected
reference coordinates. Rendering and live Geometry collision therefore receive
the same matrix element-for-element.

An accepted target whose 4x4 matrix differs from the previous target by more
than `1e-9` per element increments `targetRevision` exactly once and invalidates
an active or completed validation report exactly once. Interpolation frames
that change the effective matrix increment `renderRevision` and update the
Geometry registry/live collision without additional report invalidations. A
baseline snap whose matrix changes increments both revisions once; an identical
baseline only clears `baselineRequired`. A BAD/STALE/fault/disconnect hold
samples the current matrix but creates no target revision.

Live collision re-evaluates each published `renderPose` no later than the
current 100 ms collision polling interval plus one render frame. A Job
validation result cannot become current while any external transform is still
interpolating. BAD/STALE quality alone does not move Geometry or create a false
zero-position collision.

An accepted sample whose target 4x4 matrix differs by no more than `1e-9` per
element updates only allowed receipt/quality state. It creates no segment,
Geometry mutation, `targetRevision`, `renderRevision`, collision revision, or
report invalidation. This prevents identical periodic samples from continuously
invalidating an otherwise current collision report.

Deleting an Object or Equipment target removes its live sample, persisted
Transform Binding, numeric Status Binding, selection, and collision registry
entry through the canonical external-entity removal path.

### 8.5 Project Save and Reload

Project capture persists:

- the Manual fallback transform;
- `transformSource`;
- the gateway Profile ID/revision, mode, selected reference frame, and fixed
  `{ mode: 'two-cycle', cycles: 2 }` smoothing policy;
- numeric Status source/Binding and `manualNumericStatus` fallback
  independently, never the live effective status value; and
- no accepted target, render Pose, timestamp, runtime quality, revisions,
  trajectory, or socket state.

After Project load, an OPC UA sourced entity has no retained telemetry, renders
at its Manual fallback with `baselineRequired`, and reports quality from the
precedence table above. A
connected, matching Profile begins in `WAITING`; an offline socket begins in
`DISCONNECTED`. A Binding that references a missing canonical entity fails
Project staging before commit.

## 9. Development Sequence

After this amended design is approved, implementation follows one shared
foundation, one shell stage, four feature workstreams, and one release stage.

### Foundation: Project Schema v3 and Protocol Contracts

1. Define v3 Robot sources/link references, Simulation Jobs, three Object Asset
   source kinds, deeply readonly Object records, and canonical external-entity
   Transform state.
2. Add the shared secure/non-secure-origin ID factory and route every current
   and new entity-creation path through it.
3. Define canonical numeric Status bindings/catalog routing, OPC UA Equipment
   Transform bindings, fixed smoothing policy, and gateway messages.
4. Implement v1/v2 migration, byte-aware revision identity, and `.wdtwin`
   archive layout changes.
5. Prove legacy v2 rendering and Project round-trip parity before feature UI
   work begins.

### Workspace Stage A: Transient Engineering Shell

1. Add memory-only BUILD/SIMULATE/CONNECT/VALIDATE routing after the Project V3
   foundation passes.
2. Route only currently working baseline features into stable
   Explorer/Viewport/Inspector/Dock slots.
3. Preserve all Project, source, playback, selection, grasp, and collision state
   across mode changes.

### Workstream R: Single-Assembly Robot Import

1. Add deterministic source hashing, duplicate-selection collapse with one
   warning, single-copy source storage, and assembly-tree analysis.
2. Preserve OCCT root/node/mesh relationships through the Worker protocol.
3. Convert selected mesh subsets into independently owned Link assets.
4. Implement source, part mapping, Mechanics, Zero Pose, Frames/Collision, and
   Review wizard stages.
5. Implement full-matrix localization and reconstruction validation.
6. Stage and atomically commit the new Robot.
7. Preserve and regression-test seven-file Import and one-Link replacement.

### Workstream O: OPC UA External Entity Transform

1. Add unchanged numeric mapping plus Transform Profile Connector configuration
   and one-cycle read aggregation.
2. Add read-only numeric/Transform catalogs, connection-generation identity,
   GOOD StatusCode handling, strict frame validation, and shared polling-client
   APIs.
3. Add Manual/OPC UA Transform ownership with baseline, target, render,
   quality, and HELD state.
4. Extend the Equipment Inspector with independent numeric/Transform Binding
   create/replace/delete controls and live quality for built-in/Object targets.
5. Route effective transforms through built-in Equipment and Object Instance
   adapters.
6. Resolve World/MCP input into the scene's MCP-local transform.
7. Integrate live Pose changes with collision revision and report staleness.
8. Persist, reload, delete, and migrate Transform Bindings.

### Workstream J: Simulation Jobs

1. Replace flat Pose ownership with ordered, Project-owned Jobs.
2. Add active-Job create, rename, duplicate, delete, Pose save/reorder/delete,
   speed/easing editing, and revision-safe playback.
3. Scope Geometry Collision validation requests and reports by Job ID/revision.
4. Keep Job editing and playback read-only while OPC UA owns Robot Joints.

### Workstream P: Primitive Objects

1. Add deterministic Box and +Z Cylinder Asset factories and collision proxies.
2. Add one creation flow beside the existing whole-file STEP Object import.
3. Reuse Object Instance placement, numeric status overlay, OPC binding,
   persistence, selection, and deletion paths.

### Integration, Documentation, and Release Gate

1. Run unit, middleware, integration, E2E, CAD, build, and deployment validation.
2. Verify the real ABB one-file assembly manually and retain a compact synthetic
   assembly fixture for CI.
3. Update README, Robot Import operator guidance, OPC UA Connector guidance,
   Simulation Job and Primitive Object guidance, Project format documentation,
   workspace-mode guidance, example Connector config, and verification evidence.
4. Commit each independently passing foundation/workstream slice; merge only
   after the complete success criteria pass.

## 10. Testing Strategy

### 10.1 Unit Tests

- Source hashing, duplicate-selection collapse, single-copy source storage,
  path generation, flat-mesh fallback, collapsed-flat-file semantic-conflict
  guidance, and budget boundaries.
- Mesh subset ownership and disposal.
- Serial Mechanics graph validation.
- Zero Pose localization/reconstruction matrices, including nested non-identity
  assembly-node transforms and repeated raw mesh instances.
- Schema v1/v2/v3 validation and deterministic migration.
- Portable UUID generation through both `randomUUID` and injected
  `getRandomValues`-only branches, including RFC 4122 version/variant bits,
  collision smoke coverage, and explicit failure when no cryptographic source
  exists.
- Job/Pose identity, revision, boundary, ordering, speed/easing, lock, and
  playback-snapshot behavior.
- STEP/Box/Cylinder discrimination, primitive dimension/color boundaries, +Z
  Cylinder generation, and conservative proxies.
- Archive source deduplication and corrupt-reference rejection.
- OPC UA six-Node Profile parsing, scale/offset conversion, duplicate Profile,
  duplicate Project assignment, and revision-mismatch rejection.
- GOOD/BAD/malformed/stale/disconnected frame reduction.
- Eight-client Connector admission and per-client buffered-send backpressure
  boundaries, proving one slow/ninth client cannot affect the shared poller.
- Duplicate/out-of-order sequence rejection and reconnect reset.
- ZYX degree-to-Quaternion conversion, shortest-arc slerp, two-cycle timing,
  mid-motion retargeting, HELD state, and target/render revision separation.
- Manual fallback ownership and source switching.
- World/MCP resolution.
- Canonical Equipment/Object mutation and deletion routing.
- Deterministic 128-overlay ranking/culling with 128/129 boundaries and no
  mutation of persisted overlay configuration.

### 10.2 Integration Tests

- One assembly source, mixed two-through-six sources, and seven independent
  sources all resolving the same seven-Link contract.
- Failed or cancelled Robot Import preserving all active stores and resources.
- Middleware reading every Transform node in one sampling cycle and emitting
  one Profile sample.
- OPC UA Transform updates moving both a built-in cup and an Object Instance.
- Collision registry and report-stale behavior after live Object motion.
- Project Save/Export/Import restoring Robot source mappings, Manual fallback,
  Jobs, primitive definitions, Transform source, and bindings.
- Mode changes preserving domain state and routing each operation to exactly one
  engineering lens.

### 10.3 E2E and Manual Fixtures

- CI uses a compact generated STEP/OCCT result fixture with seven named assembly
  parts, including a repeated raw mesh under two non-identity child transforms,
  plus corrupt, unnamed, duplicate, and fused-body fixtures.
- Automated real-assembly pipeline validation uses
  `tests/fixtures/robots/fixed-six-axis-test-mechanics.json`. It is explicitly a
  deterministic test Mechanics fixture and makes no vendor-accuracy claim for
  the CRB15000-10kg/1.52 mechanical dimensions. A production import must select
  a validated Datasheet configuration, Manifest, or operator-entered Mechanics.
- A fake WebSocket gateway emits deterministic GOOD, BAD, stale, reconnect,
  malformed, jittered, foreground-resume, and out-of-order Equipment Transform
  frames.
- Generated self-contained AP203/AP214/AP242-style Geometry fixtures prove
  separately selectable occurrence handling; unresolved external-reference,
  tessellated/PMI-only, and fused-body fixtures prove the declared deterministic
  rejection paths. No exporter kinematic metadata supplies Joint Mechanics.
- Manual verification uses
  `CRB15000_10kg-152_Omnicore_rev00_ASM_CAD.step` and records its expected
  source/assembly statistics.
- `tests/robot-assembly-import.spec.ts`, `tests/simulation-jobs.spec.ts`,
  `tests/primitive-object-workflow.spec.ts`, and
  `tests/opcua-transform-smoothing.spec.ts` cover the new browser workflows.
- Existing `tests/project-roundtrip.spec.ts` and
  `tests/geometry-collision.spec.ts` workflows remain in the release gate.
- A checked-in Playwright functional matrix runs production Chromium on
  `windows-latest` and `ubuntu-latest`; the quantitative orbit fixes
  `deviceScaleFactor: 1`, while a separate `deviceScaleFactor: 2` smoke checks
  initial render, overlay culling, and zero WebGL context loss without applying
  the hardware-sensitive frame/heap thresholds.

## 11. Success Criteria

### 11.1 Robot Import

1. Selecting the actual one-file CRB15000 assembly reports 13,093,130 source
   bytes, SHA-256
   `4130e05b6287fa47a49d376b6ab3cde3c98306155118d6f6e06751d1067b9ef1`,
   38,299 triangles, nine assembly nodes, seven named Link meshes, and parser
   provenance `occt-import-js 0.0.23`.
2. Importing that file with the explicitly test-only fixed Mechanics fixture
   creates one source record and exactly seven Link records without labeling the
   fixture as CRB15000-10kg/1.52 vendor data.
3. The exported `.wdtwin` contains exactly one STEP entry for that source; raw
   archived STEP bytes equal the unique input bytes rather than seven copies.
4. At Zero Pose, every rendered Link world AABB matches its parsed source subset
   AABB within 0.5 mm, and compared world matrices match within `1e-6`.
5. For every `n` from 1 through 6, rotating `Jn` moves exactly the descendant set
   `{LINK0n, ..., LINK06}` and leaves `{LINK00, ..., LINK0(n-1)}` unchanged.
6. The current seven-file CRB15000 path still produces the built-in Zero Pose,
   TCP, Link bounds, and collision proxy bounds within the same tolerances.
7. A mixed two-through-six source fixture parses each unique source exactly once
   and resolves exactly seven Links.
8. Byte-identical selected source files collapse to one stored source with one
   non-blocking warning. Distinct assembly node paths can own repeated raw mesh
   Geometry on different Links, but byte-identical independent flat single-part
   selections do not create a second semantic occurrence: assigning the collapsed
   key twice fails as `ROBOT_LINK_PART_CONFLICT` with component-preserving-
   assembly/distinct-Geometry guidance. Missing Link, stale node path, invalid
   Mechanics, corrupt STEP, unacknowledged part, and budget violations likewise
   fail before commit and leave the active Workcell unchanged.
9. A single fused whole-Robot body fails as `ROBOT_STEP_FUSED_BODY`, creates no
   persistent rows, and leaves no staged Three.js resources.
10. Cancel terminates the active Worker and updates the UI within 250 ms of the
    click without leaving partial state.
11. Save, browser reload, `.wdtwin` Export, and `.wdtwin` Import preserve source
    hashes, node mappings, selected source units, source-to-meter factors,
    localization, operator adjustments, Mechanics provenance, TCP, and collision
    boxes exactly.
12. An unknown-unit fixture confirmed as inch restores and re-exports with
    `selectedSourceUnit: 'inch'` and `sourceToMeters: 0.0254`, preserving its
    world bounds; a legacy unknown-unit source fails migration without changing
    the active Project.
13. A non-responsive Worker terminates at 60,000 ms under fake time with
    `ROBOT_STEP_PARSE_TIMEOUT`; Worker `error` and `messageerror` fixtures fail
    through `ROBOT_STEP_PARSE_FAILED`. All three keep a UI heartbeat responsive,
    preserve the active Workcell, and leave zero staged resources.
14. Using the fixed test Mechanics fixture, operator changes to Robot name,
    Base XYZRPY, Joint origin/axis/limits/Home/direction/offset/maximum velocity,
    all seven Geometry-local transforms, Flange, Tool0, and TCP produce the expected
    command-space result `direction * commandAngleDeg + zeroOffsetDeg`, FK/TCP
    and Geometry matrices, and playback limits, then survive Save, browser
    reload, Export, and Import exactly. Zero or negative maximum velocity fails
    before commit. Every MCP/Flange/Tool0/TCP test transform has exact unit
    scale; a non-unit scale in native V3, Manifest, Manual input, or legacy
     MCP/TCP migration fails before staging and leaves the active Project intact.
    Every listed field is independently editable through millimetre/degree UI
    adapters; opening or applying with an untouched rounded field preserves its
    full stored precision. Apply is atomic, Cancel is accepted only before the
    serialized mutation begins, and Cancel/double-submit cannot race a
    `publishing` pointer.
15. A fixture that references one raw mesh index from two non-identity node paths
    preserves two distinct component world matrices, permits the occurrences to
    belong to different Links, and reconstructs both within `1e-6` after reload.
16. A one-STEP fixture with seven Geometry components maps to seven Links when a
    valid six-Joint Mechanics source is selected. The same Geometry paired with
    a Manifest declaring seven Joints fails as `ROBOT_JOINT_COUNT_UNSUPPORTED`,
    reports `{ declaredJointCount: 7, requiredJointCount: 6 }`, stages no
     resources, and leaves the active Robot and Project unchanged; component
     count alone is never treated as Joint count.
17. Robot selection preflight accepts exactly 1 and 7 selected Files and rejects
    0 and 8 before read/copy/hash/Worker allocation, including eight duplicate
    Files. The exact 25 MiB per-File and 100 MiB selected-total bounds pass and
    plus one fails before reading.
18. A Mechanics Manifest at exactly 1,048,576 bytes passes pre-read validation;
    plus one reports `ROBOT_MECHANICS_MANIFEST_TOO_LARGE` before read/hash/decode/
    parse. Accepted original bytes are hashed once; BOM, fatal UTF-8, JSON,
    duplicate-key, closed-schema, cancel/late-result, normalized provenance, and
    raw-byte non-persistence tests pass. Manual canonical provenance is stable
    across property insertion order.
19. Self-contained separable AP203/AP214/AP242 Geometry fixtures pass through the
    same OCCT occurrence contract. Unresolved external references and unsupported
    tessellated/PMI-only inputs report their stable errors; AP242 Joint/mate data
    is ignored as Mechanics. Any non-finite derived duration/matrix/AABB reports
    `ROBOT_MECHANICS_DERIVED_NON_FINITE` before Project mutation.

### 11.2 OPC UA Equipment Transform

1. Given raw values `[1000, -250, 800, 10, 20, 30]`, XYZ scales of `0.001`, RPY
   scales of `1`, and zero offsets, the effective MCP-relative Pose is
   `[1, -0.25, 0.8]` meters with the normalized Quaternion produced by
   `Euler(10deg, 20deg, 30deg, 'ZYX')` within `1e-6`.
2. All six nodes for a Profile are read in one Connector cycle and emitted in
   one atomic `equipment-transform-frame` sample.
3. If any one node has BAD quality, is missing, or maps to a non-finite number,
   the current `renderPose` is sampled and becomes the held Pose; quality becomes
   BAD, motion state becomes `HELD`, and no zero or partial Pose is applied.
4. With a 100 ms sampling interval, complete frame silence for 1,000 ms after a
   GOOD sample changes quality to STALE while preserving the held Pose;
   continuously accepted BAD frames remain BAD by precedence.
5. First complete GOOD after Binding/source/generation change or reconnect snaps
   exactly once as the baseline. The next changed GOOD at `T = 100 ms` uses
   `D = 2 * T = 200 ms` and samples exactly 0%, 50%, and 100% at elapsed 0,
   100, and 200 ms without an intermediate zero or partial Pose.
6. Manual XYZRPY controls are read-only in OPC UA mode. Switching to Manual
   restores the exact saved Manual fallback.
7. Numeric Status source and Transform source can be configured independently
   on the same entity. Native V3 accepts one canonical numeric Status Binding
   for both `equipment:*` and `object:*`, rejects duplicate/orphan targets and
   legacy `instanceId`, and V2 migration maps `instanceId` to
   `object:${instanceId}` without changing NodeId/scale/offset. Each Binding
   resolves one exact numeric catalog tuple, receives the value keyed by its
   Connector mapping ID, and applies scale/offset exactly once in Middleware.
   Either OPC UA source requires its matching Binding. Removing an active
   Binding atomically restores only that source's Manual fallback and removes
   only that Binding, with no invalid intermediate Project.
8. The same Binding flow moves both `equipment:cup-01` and one imported
   `object:<id>` target.
9. Rendering and Geometry collision consume the same `renderPose` matrix on
   every coalesced animation frame. Live collision reacts no later than 100 ms
   plus one render frame; `targetPose` is never rendered or registered.
10. Save while OPC UA supplies a live Pose and numeric Status stores the Manual
    transform and `manualNumericStatus` fallbacks plus their independent
    Bindings, but stores no live value, timestamp, quality, target/render
    revision, or trajectory. Reload shows both fallbacks until their first GOOD
    samples.
11. Deleting a bound target removes both Transform and browser/Project numeric
    Status bindings and leaves no live-sample or collision-registry entry; the
    browser ignores any orphan ID still broadcast by unchanged Connector
    configuration.
12. Middleware tests prove no OPC UA write, method-call, or command API is
    invoked.
13. With Robot Joint source set to Simulation, bound Equipment continues to
    consume OPC UA Transform and numeric Status frames.
14. Duplicate or lower sequence values do not change effective Pose or
    collision revision and refresh no clocks; a reopened WebSocket accepts the
    new stream sequence and requires one new baseline snap.
15. An MCP-relative Binding follows MCP, while a World-relative Binding retains
    its World Pose after MCP changes.
16. Drag, Manual Apply, and Robot grasp are blocked while Transform source is
    OPC UA, and switching a held entity to OPC UA is rejected without dropping
    it.
17. On an open socket, a missing Profile, Gateway ID mismatch, or Profile
    revision mismatch leaves the Manual fallback visible only before the
    generation's first GOOD; after a prior GOOD it preserves the held Pose with
    BAD quality. It never applies another Gateway/Profile revision.
18. After the first baseline GOOD, 100 repeated frames with an identical 4x4
    target matrix update allowed receipt/quality state but add zero segments,
    target revisions, render revisions, Geometry mutations, collision-registry
    revisions, or report invalidations.
19. A Manual Apply captured before switching to OPC UA and an OPC UA frame from
    a generation invalidated by entity deletion both complete with no transform,
    persistence, selection, grasp, or collision-registry mutation.
20. An unchanged Connector mapping produces the same Profile revision across
    restarts. Changing any NodeId, scale, offset, or global polling interval
    changes the revision and keeps a Project saved against the older revision in
    BAD fallback until the operator explicitly reselects it.
21. Deterministic reducer tests prove `DISCONNECTED` for a closed socket,
    `WAITING` during an in-deadline handshake or first sample, `BAD` for explicit
    BAD or catalog identity mismatch, `GOOD` for a fresh complete sample, and
    `STALE` for expired silence. Motion state separately exposes `HELD`; every
    transition preserves Manual fallback before a baseline or the held Pose
    after a baseline, without a transient zero Pose.
22. Changing Profile ID, Gateway ID, Profile revision, mode, or reference frame
    clears old target/clock state, increments the entity generation, sets
    `baselineRequired`, and shows the Manual fallback until a GOOD frame for the
    new identity arrives. A late old-identity frame changes no state.
23. Connector boundary tests accept 32 Transform Profiles and 256 total read
    Nodes, reject 33 Profiles or 257 Nodes before startup, accept a 65,536-byte
    catalog/frame, and reject 65,537 bytes before JSON reduction while
    preserving the held Pose. UTF-8 identifier tests likewise accept the exact
    128/1,024-byte ID/NodeId limits and reject one byte above them.
24. Foreground resume snaps only when the retained complete target is from the
    same generation, remains current-quality GOOD, has no later non-GOOD or
    protocol fault, and is younger than the stale threshold. An absent, stale,
    BAD, or faulted target remains `HELD` with `baselineRequired`; the first
    later fresh GOOD snaps exactly once. Background entry freezes the sampled
    render Pose and clears the active segment; hidden elapsed time never advances
    or replays the obsolete trajectory on resume.
25. Shortest-arc Quaternion interpolation makes yaw `350 deg -> 10 deg` travel
    +20 degrees and `179 deg -> -179 deg` travel +2 degrees. Mid-motion targets
    at `100 ms +/- 40 ms` rebase from sampled `renderPose`, produce no
    acceptance-time matrix jump above `1e-9`, and never extrapolate.
26. One accepted changed target increments `targetRevision` and invalidates the
    report exactly once. Multiple interpolation frames increment only
    `renderRevision` and update live collision; no additional report
    invalidation occurs before settlement.
27. A bounded malformed string emits exactly one current-generation protocol
    fault, refreshes no sequence/receipt/last-GOOD clock, keeps the socket open,
    exposes BAD/`HELD` for Transform consumers, and replaces every active numeric
    consumer's prior live GOOD value with BAD plus `manualNumericStatus`; it
    preserves all six current Joint angles plus last accepted Joint quality/time,
    sets only the separate Joint transport overlay to BAD, and keeps shared
    connection state CONNECTED. Binary or oversized input closes the socket and
    exposes DISCONNECTED/`HELD` plus the same numeric Manual fallback, preserves
    the same accepted Joint data, keeps the overlay BAD, and reports DISCONNECTED
    only through shared-connection state. No synthetic JointFrame refreshes its
    clock or widens `JointQuality`. A reconnect clears only old-generation
    presentation fault state and starts a new silence watchdog; a later valid
    current-generation Joint frame recovers without a zero-angle transition.
    Connector timestamp skew of plus/minus one day does not alter browser-local
    `Date.now()` receipt freshness. An otherwise fault-free open connection with
    no Joint frame becomes Joint STALE at exactly 1,000 ms without changing
    angles.
28. Every persisted Binding contains exactly
    `smoothing: { mode: 'two-cycle', cycles: 2 }`; `D = 2 * T` is derived from
    the Profile and no millisecond duration editor or Project field exists.
29. Sampling intervals 10 ms and 1,000 ms are accepted and derive durations 20
    ms and 2,000 ms; 9 ms and 1,001 ms fail Connector validation before startup.
    With no catalog, the handshake remains WAITING before 3,000 ms and becomes
    BAD at 3,000 ms without requiring an unavailable Profile interval.
30. Numeric and transform catalogs from one connection have the same Gateway ID
    and precede their frame kinds. Exact duplicate catalogs change nothing;
    mismatched replacement/Gateway catalogs close the connection. Reconnect
    clears both catalogs, mapping resolutions, sequences, and generation-owned
    frames before accepting new data.
31. A finite numeric raw value with BAD OPC UA StatusCode, missing/non-finite
    value, non-finite converted output, or read failure emits `null`. Browser
    reduction marks the bound numeric source BAD, shows `manualNumericStatus`,
    refreshes no last-GOOD/stale clock, and never applies scale/offset twice.
32. A numeric catalog carries the global interval even when there are zero
    Transform Profiles. T `100 ms` becomes STALE on silence at exactly 1,000 ms;
    T `1000 ms` becomes STALE at exactly 3,000 ms. Explicit `null` remains BAD
    by precedence until a later finite GOOD or connection transition.
33. Exactly eight concurrent browser WebSockets share one Connector polling
    result; a ninth closes with code `1013` and creates no additional OPC UA read
    loop. A client with `bufferedAmount === 1_048_576` remains open for the next
    bounded send, while `1_048_577` closes only that client with code `1013` and
    does not delay polling or delivery to the other clients.

### 11.3 Project V3 and Simulation Jobs

1. V1-to-V2-to-V3 and V2-to-V3 migrations are deterministic. Every legacy flat
   Pose array, including empty, becomes one active `job-default` / `Default Job`
   at revision 1 while preserving Pose IDs, names, order, six angles, easing,
   and outgoing speed; an absent legacy optional speed becomes 100. Every
   non-terminal duration is recomputed from normalized V3 Mechanics and speed,
   the terminal duration becomes exactly 1,000 ms, and a changed legacy value
   produces one bounded normalization warning.
   Legacy missing Mechanics fields use the exact Home/offset/direction,
   identity-Flange, +90-degree-Y Tool0 defaults in section 6.5 and preserve
   existing Zero-Pose and TCP world matrices. Legacy MCP/TCP scale must be exact
   unit scale; non-unit scale fails with `PROJECT_LEGACY_FRAME_NON_RIGID` and no
   active-state mutation.
2. Exactly 32 Jobs, 256 Poses in one Job, and 2,048 total Project Poses pass;
   33, 257, and 2,049 fail before active-state mutation. Job revision 1 passes;
   0, -1, and 1.5 fail, and non-null `activeJobId` must resolve.
3. Save Pose with no Job atomically creates and selects `Job 1`, then appends
   `Pose 1` with `speedPercentToNext: 100`, `easing: 'easeInOut'`, and terminal
   `durationMs: 1000`. The terminal placeholder adds zero playback elapsed time
   and is recomputed when the Pose gains a successor.
4. Pose add/delete/reorder, angles, outgoing speed, easing, and derived-duration
    changes increment the owning Job revision exactly once; display-name changes
    do not. Speed 1%/100% pass and 0%/101% fail; every non-terminal derived
    duration is at least 16 ms. Native/decode V3 validation rejects a
    non-terminal stored duration that differs from the section 6.3 formula by
    more than `1e-9 ms` and rejects a terminal value other than exactly 1,000 ms.
    Each Joint's exact command-space minimum/maximum angle passes and a fixed
    `1e-9 deg` outside either boundary fails without clamping or Job mutation.
    Migration reports `PROJECT_LEGACY_POSE_OUT_OF_LIMITS`; a proposed Mechanics
    edit that narrows around any saved Pose reports
    `PROJECT_JOB_POSE_OUT_OF_LIMITS` with total plus at most 64 stable details
    and leaves Robot, Mechanics, Jobs, revisions, DB pointer, and runtime intact.
5. Playback snapshots only the active Job ID, revision, and ordered Poses.
   `playing` and `paused` reject Job switch, all Job/Pose mutations, and Joint-
   source change. Among user actions only Stop returns to `idle`; it retains the
   current displayed Joint angles. Natural completion publishes/retains the
   final Pose exactly once and returns to `idle`; fatal quality/error retains the
   sampled current Pose, reports the reason, and returns to `idle` without a
   terminal snap.
6. OPC UA Robot Joint ownership permits full Job read access but rejects every
   Job/Pose mutation and playback start. Switching Joint ownership while a run
   is playing or paused is rejected until Stop. Collision request/progress/result/report
   records carry matching non-empty `jobId` and positive `jobRevision`.
7. V3 Save, browser reload, Export, and Import preserve Job order and each Job's
   Pose order exactly. The legacy localStorage sequence is recovery input only
   when no active Project exists. It is removed after any successfully integrity-
   hydrated stable active V3 revision has its runtime/verified owner handles
   active and its Project-backed Jobs hydrated, including reload recovery; it
   requires no extra Save, and every earlier failure retains the key for retry.
8. Every built-in Equipment record and Object Instance has exactly one matching
   canonical external transform state. Native/decode validation rejects missing,
   duplicate, or orphan records, unknown built-in catalog IDs, and kind/Geometry
   mismatches. `manualNumericStatus` survives round-trip while live OPC UA
   Status value/quality/time is absent from every archive entry.
9. Seven byte-identical legacy Link sources migrate to one content-addressed
   source plus seven distinct reserved `[-1, linkOrdinal]` occurrences, with no
   ownership collision and byte-identical source round-trip.
10. Revision identity hashes only the complete canonical byte-free projection,
    whose Robot/Object references were produced by one-copy/one-hash source
    staging or repository-minted verified handles. Two otherwise identical
    snapshots with different STEP bytes have different revision IDs;
    byte-identical source content and identical configuration produce the same
    revision ID. One hundred metadata-only edits perform zero source copies,
    source-digest calls, parser/Geometry rebuilds, or Blob writes and leave one
    retained revision after mark/sweep.
11. Cryptographic staging rejects a Robot source whose exact bytes do not match
    both declared `id` and `sha256`; raw public ingress synchronously snapshots
    the non-binary graph and owns every source before the first await, then hashes
    each owned source once. A two-source deferred-hash test mutates caller source
    B and configuration while source A is pending and proves the invocation-time
    candidate is committed. Public prepared/migration/decode results remain
    byte-free. Mutating an input or public-read buffer changes neither the active
    revision nor the next read/archive. Cross-tab commit/GC, quota failure, and
    every `publishing` crash boundary preserve or recover one complete revision.

### 11.4 Primitive Objects and Workspace Modes

1. `ObjectAssetRecordV3.sourceKind` is exactly `step | box | cylinder`. STEP
    Assets each retain one whole source; byte-identical STEP Assets share one
    content-addressed archive entry. Box and Cylinder Assets generate zero STEP
    bytes and zero archive STEP entries.
   Exactly 256 Object Assets, 512 Object Instances, and 1,024 actual visible
   Three.js Mesh/material render groups pass; each boundary plus one rejects
   before active mutation. General IDs/names accept 128 UTF-8 bytes and STEP or
   Manifest filenames accept 255 UTF-8 bytes; plus one rejects without
   truncation.
2. Box dimensions accept each exact `[0.001, 10] m` boundary. Cylinder radius
   accepts `[0.0005, 5] m` and height `[0.001, 10] m`; a fixed `1e-12` outside
   any boundary fails before mutation. Colors are uppercase `#RRGGBB`.
3. A Cylinder renders along local +Z with 32 radial segments and collision
   half-extents `[radiusM, radiusM, heightM / 2]`. A Box renders 12 triangles
   with exact half-extents `[width / 2, height / 2, depth / 2]`; the closed
   Cylinder renders 128 triangles. Generated triangles count toward the
   visible-scene limit but not STEP byte/ZIP-entry limits. A native/decode
   record with inconsistent centre, proxy, or statistics is rejected.
4. Every V3 Object Instance has required `graspable`; migrated V1/V2 Instances
   use `false`. Its only durable Pose is the matching canonical MCP-local Manual
   transform state, with no separate Manual frame field.
5. Generated Objects reuse name, Manual XYZRPY, `manualNumericStatus`, numeric
   Status overlay, independent numeric/Transform OPC UA Bindings, persistence,
   collision, selection, and deletion behavior.
   BUILD exposes exactly `Import STEP Object`, `Create Box`, and
   `Create Cylinder`.
6. Creating one primitive Asset, its first Instance, and canonical transform
   state is atomic. Invalid creation, preparation, commit, or deletion leaves
   all persistent and runtime counts unchanged.
7. Exactly one of BUILD/SIMULATE/CONNECT/VALIDATE is active and BUILD is the
   page-load default. Mode changes alter presentation only and cause zero
   Project, source, Job, Joint, transform, grasp, selection, or validation
   mutations. A dirty Manual preview requires a separate successful Apply or
   Discard before routing; Stay leaves mode and preview unchanged.
8. Workspace Mode is absent from ProjectDB, `.wdtwin`, localStorage,
   sessionStorage, URL state, and OPC UA messages.
9. `statusOverlayVisible: true` may exist on every persisted entity, but runtime
   mounts at most 128 overlay roots. With 129 in-frustum candidates, the selected
   canonical entity ranks first, remaining candidates sort by camera-space
   distance then canonical ID, and exactly the final-ranked candidate is culled;
   Project/runtime numeric state and archive bytes remain unchanged.

### 11.5 Shared Release Gate

1. Project v1 and v2 fixtures migrate deterministically to v3 and re-export as
   byte-stable v3 configuration JSON with source files stored once.
2. Existing Simulation and OPC UA Joint sources, migrated Pose ordering/speed,
   Manual Object transform, one-whole-STEP-per-imported-Object, Object removal,
   numeric Status overlay, grasp, and Geometry Collision workflows remain
   functional.
3. `npm run lint`, `npm run test:run`, `npm run test:middleware`,
     `npm run cad:validate`, `npm run build`, `npm run test:perf:reference`,
    `npm run test:e2e:insecure`, and
   `npm run test:e2e -- tests/mode-workspace.spec.ts tests/mode-workspace-visual.spec.ts tests/robot-assembly-import.spec.ts tests/simulation-jobs.spec.ts tests/primitive-object-workflow.spec.ts tests/opcua-transform-smoothing.spec.ts tests/project-roundtrip.spec.ts tests/project-v3-roundtrip.spec.ts tests/geometry-collision.spec.ts`
   all pass with no flaky timeout accepted as a release pass.
4. Documentation describes units, ZYX rotation order, source ownership,
   GOOD/BAD/STALE behavior, fused-body rejection, file/Geometry budgets, Project
   migration, and recovery actions completely and consistently.
5. Boundary fixtures prove acceptance at every configured source, byte,
    triangle, mesh, node/depth, material, Link-reference, typed-array, and total
    scene budget, and deterministic pre-commit rejection immediately above each
    boundary.
6. A dedicated non-secure-origin Chromium run maps a non-local hostname to the
   local preview server, asserts `isSecureContext === false`,
   `typeof crypto.randomUUID === 'undefined'`, and
   `typeof crypto.getRandomValues === 'function'`, then completes New Project,
   whole-STEP Object import, Job/Pose creation, and Box/Cylinder creation with
   non-empty unique IDs. No production source outside the central ID utility
   contains a direct `crypto.randomUUID()` call or a `Math.random()` fallback.
7. Fault injection before and after every Project commit phase, including the DB
   pointer/runtime-bundle boundary and compensation failure, leaves DB pointer,
   cache revision, and visible runtime all on the complete old or complete new
   revision. Interaction is never enabled for a mixed revision, and reload
   recovers the authoritative revision.
8. `npm run deploy:validate`, `npm run deploy:build`, `npm run deploy:smoke`, and
   `npm run deploy:smoke:opcua` pass. WebSocket open alone is not success: the OPC
   UA deployment smoke must decode a schema-valid Profile catalog through the
   same-origin `/opcua` route, then observe the unavailable-upstream BAD sample
   for a configured Profile and prove it contains no GOOD sample of any Pose and
   no zero or partial Pose.
9. A checked-in Playwright workflow passes the same functional production-
   Chromium matrix on `windows-latest` and `ubuntu-latest`: WebGL scene startup,
   OCCT WASM Worker import of the one-source/seven-Link fixture, Project round-
   trip, and same-origin `/opcua` catalog/frame receipt. macOS/Safari is outside
   this stage.
10. On each declared Windows and Linux reference host, the controlled resource
    run uses viewport 1440 by 900 and `deviceScaleFactor: 1`; after 5 seconds
    warm-up plus a 10 second orbit, the 1,024-group/at-most-1,500,000-triangle
    fixture with 512 eligible Status overlays mounts at most 128 overlay roots,
    has p95 frame interval at most 33.4 ms, no Long Task above 200 ms, no WebGL
    context loss, and peak `JSHeapUsedSize` at most 768 MiB. A separate
    `deviceScaleFactor: 2` functional smoke renders the same scene, enforces the
    128-overlay cap, and has no WebGL context loss; it does not inherit DPR1
    performance thresholds.

## 12. Implementation Plan Boundary

The approved executable planning set is:

1. a shared Project Schema v3 foundation plan;
2. a Single-Assembly Robot Import plan;
3. a Simulation Jobs plan;
4. a Primitive Objects plan;
5. an OPC UA Equipment Transform and Smoothing plan; and
6. a Mode Workspace and Release plan.

Each plan must use TDD-sized tasks, exact file paths, explicit interfaces,
targeted failure-first tests, verification commands, and reviewable commits.
No source or Middleware implementation starts before the user explicitly
approves this G0-amended normative revision.

## 13. Future Roadmap, Not Current Fallback

The following ideas are recorded only for later design work:

- AI/API/harness-assisted analysis when a supplied STEP does not follow the
  deterministic source/part conventions;
- OPC UA Subscription/MonitoredItem transport after the polling protocol is
  proven and measured;
- arbitrary editable Frame Graphs beyond fixed World/MCP/Base/Flange/Tool0/TCP;
- variable-DOF, seven-axis, parallel, closed-loop, and multi-Robot cells;
- fused-body splitting and automatic mesh simplification; and
- physics-engine collision response and rigid-body dynamics.

Project V3 contains no dormant field, feature flag, API key, endpoint, prompt,
upload path, Subscription handle, generic Joint collection, automatic splitter,
or physics configuration for these ideas. Adding any of them requires a new
approved design and schema/runtime compatibility review.
