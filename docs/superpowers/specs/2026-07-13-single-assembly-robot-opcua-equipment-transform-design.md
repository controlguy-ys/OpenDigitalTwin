# Single-Assembly Robot Import and OPC UA Equipment Transform Design

**Status:** Written design awaiting user review

**Date:** 2026-07-13

## 1. Decision Summary

The next development stage delivers two independently reviewable workstreams in
one product milestone:

1. Import one fixed six-axis serial Robot from one through seven STEP source
   files. Exactly seven Robot Links (`LINK00` through `LINK06`) are mapped from
   the parsed source components. A single STEP assembly may provide all seven
   Links.
2. Bind the absolute `X/Y/Z/Roll/Pitch/Yaw` transform of built-in Equipment and
   imported Object Instances to OPC UA nodes through the existing read-only
   OPC UA Client middleware.

The implementation order shares one Project Schema v3 foundation, then splits
into a Robot Import plan and an Equipment Transform OPC UA plan. This keeps the
two features isolated while ensuring that one `.wdtwin` archive can save,
reload, and move both configurations atomically.

The approved short-term Robot scope remains one Robot, six revolute Joints
(`J1` through `J6`), and seven serial Links. A literal seven-Joint Robot,
variable DOF, and eight or more Links remain a later Generic Robot phase.

## 2. Product Language

The UI, validation messages, tests, and documentation shall use:

> Seven Robot Links mapped from one through seven STEP sources.

They shall not use "seven STEP files" as a synonym for seven Robot Links.
Robot source-file limits apply only to Robot Import. Each external Object Asset
continues to be imported from its own single STEP file.

## 3. Scope

### 3.1 Robot Import

- Keep exactly one active Robot in the scene.
- Accept one through seven unique `.step` or `.stp` Robot source files.
- Resolve exactly `LINK00` through `LINK06` from assembly components or flat
  mesh parts found in those sources.
- Parse each unique source once in a Web Worker and preserve its assembly tree.
- Store each unique source byte sequence once, even when several Links use it.
- Let names such as `LINK00` suggest mappings, but never treat names as proof of
  Kinematics.
- Accept existing seven independent Link files without regression.
- Obtain Mechanics from the existing Datasheet configuration, an optional Robot
  Definition Manifest, or the Manual Robot Setup Wizard.
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
- Hold the last good Pose on BAD, malformed, stale, or disconnected input.
- Persist the Manual fallback Pose and Binding configuration, not transient OPC
  UA telemetry.
- Drive rendering and Geometry Collision from the effective runtime Pose.
- Keep the Equipment OPC UA connection active independently of whether the
  Robot Joint source is Simulation or OPC UA.
- Prevent drag and Robot grasp while OPC UA owns an entity transform.
- Perform no OPC UA writes.

### 3.3 Shared Project and Runtime Work

- Introduce Project Schema v3 with deterministic v1/v2 migrations.
- Persist built-in Equipment configuration required by `.wdtwin` portability,
  including its Manual fallback transform and Transform source.
- Use canonical external-entity IDs in new OPC UA Equipment Transform bindings
  to prevent Equipment and Object ID collisions.
- Keep Project load/import transactional: a failed Robot source restore or OPC
  UA Binding validation leaves the active Workcell unchanged.
- Remove bindings when their target Object or Equipment is deleted.

## 4. Out of Scope

- Multiple Robots.
- Variable-size Robot Link or Joint collections.
- Seven-axis or non-serial Robots.
- Prismatic, continuous, fixed, parallel, or closed-loop Robot Joints.
- URDF, Xacro, SDF, or automatic AP242 Kinematics import.
- Inferring Joint axes, origins, limits, Home, velocity, Flange, or TCP from
  Geometry.
- Cutting a fused B-Rep or triangle mesh into moving Robot Links.
- OPC UA write-back, commands, method calls, or controller motion control.
- Partial-axis Equipment Transform Binding.
- Equipment Transform Binding references other than World or MCP, including
  Robot Base, live Joint, Flange, TCP, and future custom frames.
- Persisting live OPC UA telemetry as Project configuration.
- Authentication, certificates, public-internet deployment, or other security
  hardening.
- IK, dynamics, acceleration/jerk planning, or safety-rated validation.

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
per external entity.

## 6. Project Schema v3

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

`nodePath` is a deterministic child-ordinal path from the OCCT root. `nodeName`
is diagnostic and helps remapping, but it is not identity. `meshIndices` are
validated against the same source hash and parser version. One Link may own one
or more part references. The owned occurrence key is
`(sourceAssetId, nodePath, meshIndex)` and may belong to at most one Link. A raw
mesh index may still appear under multiple distinct assembly node paths, because
those paths represent separate component instances.

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
robot/mechanics/source-manifest.json  # optional, Manifest provenance only
```

The same SHA-256 source is written once. Content hashing must work in the
trusted-LAN HTTP deployment and may not depend exclusively on secure-context
Web Crypto.

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
- finite minimum, maximum, Home, direction/offset, and velocity data;
- minimum less than maximum;
- Home within limits; and
- a defined Flange/Tool0 and TCP.

This explicit contract prevents cycles, self-edges, duplicate children,
multiple roots, unreachable Links, and order-dependent rig construction.

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

interface FixedSixAxisRobotManifestV1 {
  readonly schemaVersion: 1
  readonly name: string
  readonly joints: readonly FixedSixAxisJointManifestV1[]
  readonly flange: SerializableTransform
  readonly tcp: SerializableTransform
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
fields are finite, axes are normalized during staging, and every validation
error identifies the exact Joint and field.

`coordinateMode` is a Geometry-mapping decision stored per Link, not a global
Mechanics Manifest field. The Review step shows Mechanics provenance as
Datasheet configuration ID/revision, Manifest SHA-256, or Manual configuration
content digest. Project configuration persists that provenance. A STEP assembly
name or tree never counts as Mechanics provenance.

Manifest SHA-256 hashes the original Manifest bytes. Manual SHA-256 hashes the
UTF-8 JSON produced by constructing the validated, normalized Mechanics object
in the fixed schema field order and serializing it with `JSON.stringify`.
Datasheet ID and revision are immutable catalog values. A Manifest digest must
match the optional archived source Manifest, and a Manual digest must match the
stored normalized Mechanics block. Empty or inconsistent provenance fails
Project validation. The normalized Mechanics block remains authoritative when a
Datasheet catalog is unavailable offline.

### 6.3 Canonical External Entity State

Built-in Equipment and imported Objects retain separate Geometry stores, but
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

The existing numeric `statusSource` remains separate. Schema v3 captures the
built-in Equipment Manual transforms needed to restore a Project without
depending on unrelated Equipment IndexedDB state.

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

interface ProjectOpcUaEquipmentTransformBindingV3 {
  readonly entityId: ExternalEntityId
  readonly gatewayId: string
  readonly gatewayProfileId: string
  readonly gatewayProfileRevision: string
  readonly mode: 'absolute'
  readonly referenceFrameId: 'world' | 'mcp'
}

interface GatewayEquipmentTransformCatalogV1 {
  readonly type: 'equipment-transform-profile-catalog'
  readonly gatewayId: string
  readonly profiles: readonly GatewayEquipmentTransformProfileV1[]
}
```

`referenceFrameId` is explicitly limited to World or MCP in this stage.

The Connector configuration keeps the existing `equipment` numeric Status
array and adds a separate `equipmentTransformProfiles` array containing the
server-side mappings above. Catalog Profiles derive from those mappings and copy
the Connector's existing global polling interval into `samplingIntervalMs`.
This preserves current Status deployments, avoids a second scheduler, and makes
the two sources independently configurable.

`gatewayId` is a new required top-level Connector setting. The checked-in and
documented example configurations receive an explicit value; an older mounted
configuration without one fails startup with a migration message rather than
silently adopting an identity. Its existing Joint and numeric `equipment`
mappings otherwise remain unchanged.

NodeIds, scales, and offsets are Connector configuration, not browser Project
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
- Each v2 Robot Link source becomes one v3 source asset and one synthetic
  whole-source part reference.
- Migration reparses each legacy Link source with the currently locked
  `occt-import-js 0.0.23`, records that parser version, and resolves the
  synthetic whole-source selection against the new parse result. Because v2 did
  not persist a unit decision, a known parser-detected unit becomes
  `legacy-detected`; an unknown unit blocks migration and routes the operator to
  Robot Import. A reparse or validation failure leaves the previously active
  Project revision unchanged.
- A v2 Link's existing `localTransform` becomes its v3
  `zeroPoseLocalization`; `operatorAdjustment` starts as identity. This
  preserves legacy rendering exactly rather than reinterpreting old files.
- Existing imported Object transforms become `manualTransform` with
  `transformSource: 'manual'`.
- Existing numeric Equipment bindings retain their v2 behavior; this stage does
  not redesign their server configuration contract.
- Deleting an entity removes its browser/Project numeric Binding and live state,
  but never edits the Connector's mounted configuration. If the Connector still
  broadcasts the deleted entity ID, the browser ignores it as unassigned.
- Missing v3 Equipment Transform bindings migrate to an empty list.
- A migrated archive is revalidated against all v3 referential and byte
  budgets before commit.

Legacy v1/v2 archives never contained built-in Equipment transforms. Their
migration therefore restores the built-in defaults and emits a migration
warning; data that was absent from the archive cannot be reconstructed. A new
v3 capture persists the currently active built-in Equipment state.

### 6.6 Commit and Crash Consistency

The Project v3 snapshot is authoritative and contains every source byte needed
to rebuild Robot and Object Geometry caches. Robot Geometry, Object Asset, and
Equipment databases are derived runtime caches rather than independent sources
of truth.

A commit uses these ordered phases:

1. validate and stage the complete v3 snapshot and runtime assets without
   mutating active state;
2. write the snapshot under a new immutable Project revision in ProjectDB;
3. populate or reconcile derived cache rows tagged with that revision;
4. enter a Project commit lock, flip the ProjectDB active-revision pointer in one
   IndexedDB transaction, and synchronously swap one fully built runtime bundle;
   and
5. release the lock, notify observers, then garbage-collect older cache
   revisions.

Runtime publication performs no parsing, allocation, or persistence; it is one
prevalidated bundle-pointer replacement. An in-process error between the DB
pointer flip and runtime swap executes a compensating transaction that restores
the previous DB pointer before releasing the commit lock, then reinstates the
previous runtime bundle. If compensation itself fails, interaction remains
blocked in a recovery-required state and the page reloads from the authoritative
DB revision instead of exposing a mixed Workcell.

A process termination after the DB pointer flip has no surviving old runtime;
startup rebuilds derived caches and runtime from the active authoritative
snapshot. Startup always checks cache revision against the active Project
revision before using a cache row. Failure before the pointer flip leaves the
old revision active and disposes every staged runtime asset.

## 7. Robot Import Architecture

### 7.1 Source Analysis

The STEP Worker returns a serializable source analysis containing source
statistics, OCCT assembly nodes, deterministic node paths, mesh membership,
names, and detected units. Each unique source hash is parsed once per Import or
Project restore operation.

Selecting byte-identical files is rejected as `ROBOT_STEP_DUPLICATE_SOURCE`
because two separate component occurrences cannot be inferred from identical
standalone bytes. The operator may select at most seven unique files. Within a
single assembly, distinct node paths remain distinct occurrences even when
their Geometry is identical. Source identity is content-based; a file name is
display metadata.

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

1. **Sources:** select one through seven Robot STEP sources; hash, reject
   duplicate sources, detect units, and validate byte limits.
2. **Parts:** show the assembly/mesh tree, source names, statistics, and a 3D
   preview.
3. **Link Mapping:** suggest `LINK00` through `LINK06`; require explicit operator
   confirmation for all assignments and explicit acknowledgement of every
   excluded part.
4. **Mechanics:** choose the existing Datasheet configuration, import the
   optional Manifest, or enter the six-Joint serial Mechanics manually.
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

- source count outside one through seven;
- unsupported extension, empty source, duplicate source hash, or byte budget
  violation;
- corrupt STEP, empty parse, or source-wide Geometry budget violation;
- source parsing that exceeds the fixed Worker watchdog or terminates with a
  Worker `error`/`messageerror`;
- unconfirmed source unit, inconsistent stored source-to-meter conversion, or
  mixed coordinate modes within one Link;
- missing `LINK00` through `LINK06` assignment;
- empty Link selection, nonexistent node path, or out-of-range mesh index;
- the same source/node/mesh occurrence assigned to multiple Links;
- an unassigned part that the operator has not explicitly excluded;
- one fused body that cannot provide seven independently moving Link subsets;
- invalid serial Mechanics, limits, Home, velocity, Flange, or TCP;
- failed Zero Pose reconstruction; or
- failed collision proxy or persistence staging.

The stable operator/API error codes are:

| Code | Meaning |
|---|---|
| `ROBOT_STEP_SOURCE_COUNT` | Selected source count is outside one through seven. |
| `ROBOT_STEP_DUPLICATE_SOURCE` | Two selected standalone sources have identical bytes. |
| `ROBOT_STEP_BUDGET_EXCEEDED` | A source, parse tree, Geometry payload, Link, or Robot exceeds a defined budget. |
| `ROBOT_STEP_PARSE_FAILED` | OCCT cannot produce usable Geometry and source analysis. |
| `ROBOT_STEP_PARSE_TIMEOUT` | A source exceeded the fixed Worker parse deadline. |
| `ROBOT_STEP_UNIT_REQUIRED` | A source unit is unknown, unconfirmed, or inconsistent with its stored conversion. |
| `ROBOT_STEP_FUSED_BODY` | Seven independent Link subsets cannot be selected. |
| `ROBOT_LINK_MAPPING_INCOMPLETE` | A required Link or explicit exclusion decision is missing. |
| `ROBOT_LINK_PART_CONFLICT` | A source/node/mesh occurrence has multiple owners or incompatible coordinate modes. |
| `ROBOT_MECHANICS_INVALID` | Serial Mechanics, limits, Home, Flange, or TCP are invalid. |
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

- one through seven Robot STEP sources;
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

These Robot limits do not become Object source-count limits. Each Object Asset
still owns one whole STEP file, with the existing 50 MiB, 250,000-triangle,
64-mesh, and 32-material per-Asset limits. The existing 256 MiB Project-wide raw
STEP-byte limit also remains in force across Robot and Object sources.

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
```

The `values` keys are immutable gateway Profile IDs. The browser maps them to
external entities through Project bindings. A Profile is GOOD only when all six
DataValues have GOOD StatusCodes and all mapped outputs are finite. No partial
Pose is emitted. The timestamp identifies
the Connector sampling cycle. `sequence` increases once per emitted Connector
cycle. The browser ignores a duplicate or lower sequence on the same WebSocket
connection and resets sequence acceptance only after that connection reopens.
Numeric Status frames remain unchanged.

Runtime stale age is measured from the browser's monotonic local receipt time,
not by subtracting the Connector wall-clock timestamp. `timestampMs` remains
diagnostic metadata, so unsynchronized host clocks cannot create false STALE or
fresh states.

Wire sample quality is only `GOOD` or `BAD`. Browser runtime quality is
`WAITING`, `GOOD`, `BAD`, `STALE`, or `DISCONNECTED`. Runtime-only states are
never forged as upstream OPC UA StatusCodes. The reducer evaluates the following
precedence from top to bottom:

| Runtime quality | Exact condition |
|---|---|
| `DISCONNECTED` | The browser WebSocket is not open. This overrides every catalog or sample state. |
| `BAD` | The socket is open and the catalog handshake timed out, the Gateway/Profile/revision does not match, or the latest accepted Profile sample is explicitly BAD. BAD remains until a matching GOOD sample or a connection transition. |
| `WAITING` | The socket is open and the catalog deadline has not elapsed, or a matching Profile has produced no accepted sample in the current connection and its stale deadline has not elapsed. |
| `STALE` | A matching Profile produced no accepted sample before the deadline, or its latest accepted GOOD sample is older than the stale deadline. |
| `GOOD` | The latest accepted sample is GOOD and its local receipt age is within the stale deadline. |

The stale deadline is `max(3 * samplingIntervalMs, 1000 ms)` and is also the
catalog-handshake deadline measured from socket open. Before the first sample on
a connection, the sample clock starts when the matching catalog is accepted.
After a GOOD sample, it starts at that GOOD sample's browser monotonic receipt
time. BAD frames do not move Geometry or refresh a prior GOOD stale clock;
explicit BAD nevertheless has higher display precedence than STALE. Duplicate
and out-of-order frames are not accepted and refresh no clock.

The gateway sends the Profile catalog when a browser socket opens. An upstream
OPC UA read error or upstream session disconnect emits a BAD sample for every
configured Transform Profile within one polling interval. A browser WebSocket
disconnect is detected locally as DISCONNECTED. Neither path emits zero values
or reuses values under a GOOD label.

Connector configuration validation requires a non-empty stable Gateway ID,
unique Profile IDs, non-empty names, six non-empty NodeIds, finite scales and
offsets, and the already-required finite positive global sampling interval.
Startup then computes each non-empty Profile revision. Project validation requires a
unique canonical entity target, a unique Profile assignment, and non-empty
Gateway ID, Profile ID, and revision. Invalid Connector configuration prevents
startup with a field-specific error. The Connector never calls an OPC UA write
API.

The lightweight Connector contract permits at most 32 Transform Profiles and at
most 256 total read Nodes per cycle across the six Robot Joints, numeric Status,
and Transform mappings. Gateway IDs, Profile IDs, and Profile display names are
1 through 128 UTF-8 bytes, and each NodeId is 1 through 1,024 UTF-8 bytes.
Catalog and Transform-frame JSON payloads are limited to 64 KiB UTF-8 each.
Connector configuration over a count or identifier limit fails startup; a
browser protocol payload over the wire limit is rejected before JSON reduction,
freezes last-good Geometry, and closes the socket as `DISCONNECTED`.

An entity may retain a configured Binding while its Transform source is Manual.
If Transform source is OPC UA, exactly one persisted Binding for that entity is
required. The Project remains loadable without a live gateway; a missing catalog
does not corrupt the archive. A closed socket reports `DISCONNECTED`; once the
socket is open, a missing catalog after its deadline or Gateway/Profile revision
mismatch reports `BAD`, always with Manual or last-good fallback.

One OPC UA multi-node Read places all configured Joint, numeric Status, and
Transform Profile Nodes in the same Connector sampling cycle. This provides a
coherent gateway frame but does not claim PLC task-level transactional
atomicity. A later controller sample-counter or structured-array Node contract
is required if the source PLC must prove that stricter guarantee.

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

The transient last-good Pose is retained in reference-frame coordinates. The
runtime calculates `referenceWorld * livePose`, then converts that result to the
MCP-local representation consumed by the current scene. A World-bound entity
therefore remains fixed in World when MCP changes.

### 8.3 Runtime Ownership

Each external entity has a persisted Manual fallback transform and an optional
transient last-good OPC UA transform:

```text
effectiveTransform =
  transformSource == Manual ? manualTransform
  : lastGoodOpcUaTransform ?? manualTransform
```

When Transform source is OPC UA:

- Manual XYZRPY editing is read-only.
- Binding fields, live value, quality, and last-update age remain visible.
- The selected server Profile ID, revision, and display name remain visible.
- The first GOOD frame becomes effective atomically.
- BAD or malformed input changes quality but not Geometry.
- A disconnected source freezes the last good Pose.
- A source with no previous good Pose uses the Manual fallback.
- A frame becomes STALE when its age exceeds
  `max(3 * samplingIntervalMs, 1000 ms)`; the Pose remains frozen.
- Reconnection resumes on the first complete GOOD frame.
- Duplicate or out-of-order sequence values do not change Pose or collision
  revision.

Switching back to Manual restores the exact persisted Manual transform. It does
not copy transient OPC UA telemetry into Project configuration. A future
"Capture live Pose as Manual" convenience action is out of scope.

The Binding identity is the tuple `(gatewayId, gatewayProfileId,
gatewayProfileRevision, mode, referenceFrameId)`. Changing any tuple field, or
entering OPC UA ownership from Manual, increments the entity generation, clears
its last-good transform and sample clocks, and immediately exposes the Manual
fallback until the new Binding supplies a complete GOOD frame. A Pose from an
old Profile is never reinterpreted in a new Profile or reference frame.

Robot Joint and external-entity OPC UA ownership are independent. Selecting the
Simulation Joint source does not disconnect or suppress Equipment Status or
Transform subscriptions. The shared gateway remains connected while any Robot
or external-entity OPC UA consumer is enabled.

An entity whose Transform source is OPC UA cannot be preview-dragged, committed
through Manual XYZRPY, or grasped by the Robot. Switching an already-held entity
to OPC UA is rejected with an instruction to release it first; the system never
performs an implicit drop or creates two active transform writers.

Each entity owns a monotonic Transform-authority generation and a serialized
mutation gate. Manual preview/apply, source transition, grasp begin/release,
Binding identity change, delete, Project replacement, and OPC UA sample
application capture that generation. A source or Binding transition invalidates
outstanding Manual preview/apply tokens before OPC UA may publish; deletion
invalidates every retained token and sample. Late persistence completion, stale
UI Apply, or a frame from an older generation is ignored. This gate is the
authority behind UI disabling and store checks, so ownership is enforced even
when actions race outside the Inspector.

### 8.4 Scene and Collision Integration

The effective transform is the single input to rendering, status overlays,
selection, grasp/collision participation, and the Geometry entity registry. A
GOOD OPC UA update is coalesced to at most one effective transform change per
render frame.

Every accepted effective transform change increments the relevant collision
registry revision. Live collision re-evaluates the new Pose no later than the
current 100 ms collision polling interval plus one render frame. An active
sequence-validation request is cancelled and a completed report is marked stale
when a bound external entity moves. BAD/STALE quality alone does not move
Geometry or create a false zero-position collision.

An accepted sample whose effective 4x4 matrix differs by no more than `1e-9`
per element updates receipt time and quality but does not publish a Geometry
mutation or increment collision revision. This prevents identical periodic
samples from continuously invalidating an otherwise current collision report.

Deleting an Object or Equipment target removes its live sample, persisted
Transform Binding, numeric Status Binding, selection, and collision registry
entry through the canonical external-entity removal path.

### 8.5 Project Save and Reload

Project capture persists:

- the Manual fallback transform;
- `transformSource`;
- the gateway Profile ID/revision, mode, and selected reference frame;
- numeric Status configuration independently; and
- no last-good value, timestamp, or runtime quality.

After Project load, an OPC UA sourced entity has no retained telemetry, renders
at its Manual fallback, and reports quality from the precedence table above. A
connected, matching Profile begins in `WAITING`; an offline socket begins in
`DISCONNECTED`. A Binding that references a missing canonical entity fails
Project staging before commit.

## 9. Development Sequence

After this design is approved, detailed implementation work is split into three
plans: one shared foundation and two feature workstreams.

### Foundation: Project Schema v3 and Protocol Contracts

1. Define v3 Robot sources/link references and canonical external-entity
   Transform state.
2. Define v3 OPC UA Equipment Transform bindings and gateway messages.
3. Implement v1/v2 migration and `.wdtwin` archive layout changes.
4. Prove legacy v2 rendering and Project round-trip parity before feature UI
   work begins.

### Workstream R: Single-Assembly Robot Import

1. Add deterministic source hashing, duplicate-selection rejection,
   single-copy source storage, and assembly-tree analysis.
2. Preserve OCCT root/node/mesh relationships through the Worker protocol.
3. Convert selected mesh subsets into independently owned Link assets.
4. Implement source, part mapping, Mechanics, Zero Pose, Frames/Collision, and
   Review wizard stages.
5. Implement full-matrix localization and reconstruction validation.
6. Stage and atomically commit the new Robot.
7. Preserve and regression-test seven-file Import and one-Link replacement.

### Workstream O: OPC UA External Entity Transform

1. Add Connector configuration and one-cycle six-Node read aggregation.
2. Add the read-only Profile catalog plus strict frame validation and
   subscription APIs.
3. Add Manual/OPC UA Transform ownership with last-good quality state.
4. Extend the Equipment Inspector with Binding configuration and live quality.
5. Route effective transforms through built-in Equipment and imported Object
   adapters.
6. Resolve World/MCP input into the scene's MCP-local transform.
7. Integrate live Pose changes with collision revision and report staleness.
8. Persist, reload, delete, and migrate Transform Bindings.

### Integration, Documentation, and Release Gate

1. Run unit, middleware, integration, E2E, CAD, build, and deployment validation.
2. Verify the real ABB one-file assembly manually and retain a compact synthetic
   assembly fixture for CI.
3. Update README, Robot Import operator guidance, OPC UA Connector guidance,
   Project format documentation, example Connector config, and verification
   evidence.
4. Commit each independently passing foundation/workstream slice; merge only
   after the complete success criteria pass.

## 10. Testing Strategy

### 10.1 Unit Tests

- Source hashing, duplicate-selection rejection, single-copy source storage,
  path generation, flat-mesh fallback, and budget boundaries.
- Mesh subset ownership and disposal.
- Serial Mechanics graph validation.
- Zero Pose localization/reconstruction matrices, including nested non-identity
  assembly-node transforms and repeated raw mesh instances.
- Schema v1/v2/v3 validation and deterministic migration.
- Archive source deduplication and corrupt-reference rejection.
- OPC UA six-Node Profile parsing, scale/offset conversion, duplicate Profile,
  duplicate Project assignment, and revision-mismatch rejection.
- GOOD/BAD/malformed/stale/disconnected frame reduction.
- Duplicate/out-of-order sequence rejection and reconnect reset.
- ZYX degree-to-Quaternion conversion.
- Manual fallback ownership and source switching.
- World/MCP resolution.
- Canonical Equipment/Object mutation and deletion routing.

### 10.2 Integration Tests

- One assembly source, mixed two-through-six sources, and seven independent
  sources all resolving the same seven-Link contract.
- Failed or cancelled Robot Import preserving all active stores and resources.
- Middleware reading every Transform node in one sampling cycle and emitting
  one Profile sample.
- OPC UA Transform updates moving both a built-in cup and an imported Object.
- Collision registry and report-stale behavior after live Object motion.
- Project Save/Export/Import restoring Robot source mappings, Manual fallback,
  Transform source, and bindings.

### 10.3 E2E and Manual Fixtures

- CI uses a compact generated STEP/OCCT result fixture with seven named assembly
  parts, including a repeated raw mesh under two non-identity child transforms,
  plus corrupt, unnamed, duplicate, and fused-body fixtures.
- Automated real-assembly pipeline validation uses
  `tests/fixtures/robots/fixed-six-axis-test-mechanics.json`. It is explicitly a
  deterministic test Mechanics fixture and makes no vendor-accuracy claim for
  the CRB15000-10kg/1.52 mechanical dimensions. A production import must select
  a validated Datasheet configuration, Manifest, or operator-entered Mechanics.
- A fake WebSocket gateway emits deterministic GOOD, BAD, stale, reconnect, and
  out-of-order Equipment Transform frames.
- Manual verification uses
  `CRB15000_10kg-152_Omnicore_rev00_ASM_CAD.step` and records its expected
  source/assembly statistics.
- `tests/robot-assembly-import.spec.ts` and
  `tests/opcua-equipment-transform.spec.ts` cover the new browser workflows.
- Existing `tests/project-roundtrip.spec.ts` and
  `tests/geometry-collision.spec.ts` workflows remain in the release gate.

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
8. Missing Link, duplicate source/node/mesh occurrence ownership, stale node
   path, invalid Mechanics, corrupt STEP, unacknowledged part, and budget
   violations fail before commit with actionable errors and leave the active
   Workcell unchanged.
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
14. Using the fixed test Mechanics fixture, operator changes to Joint origin,
    axis, limits, Home, direction/offset, maximum velocity, Flange, and TCP
    produce the expected FK/TCP matrices and playback limits, then survive Save,
    browser reload, Export, and Import exactly.
15. A fixture that references one raw mesh index from two non-identity node paths
    preserves two distinct component world matrices, permits the occurrences to
    belong to different Links, and reconstructs both within `1e-6` after reload.

### 11.2 OPC UA Equipment Transform

1. Given raw values `[1000, -250, 800, 10, 20, 30]`, XYZ scales of `0.001`, RPY
   scales of `1`, and zero offsets, the effective MCP-relative Pose is
   `[1, -0.25, 0.8]` meters with the normalized Quaternion produced by
   `Euler(10deg, 20deg, 30deg, 'ZYX')` within `1e-6`.
2. All six nodes for a Profile are read in one Connector cycle and emitted in
   one atomic `equipment-transform-frame` sample.
3. If any one node has BAD quality, is missing, or maps to a non-finite number,
   no coordinate changes; the last good Pose remains and quality becomes BAD.
4. With a 100 ms sampling interval, complete frame silence for 1,000 ms after a
   GOOD sample changes quality to STALE while preserving the last good Pose;
   continuously accepted BAD frames remain BAD by precedence.
5. Disconnect preserves the last good Pose; reconnect applies the first new
   complete GOOD Pose without an intermediate zero or partial Pose.
6. Manual XYZRPY controls are read-only in OPC UA mode. Switching to Manual
   restores the exact saved Manual fallback.
7. Numeric Status source and Transform source can be configured independently
   on the same entity.
8. The same Binding flow moves both `equipment:cup-01` and one imported
   `object:<id>` target.
9. A GOOD transform affects rendering on the next rendered frame, affects live
   collision no later than 100 ms plus one render frame, and marks an existing
   validation report stale.
10. Save during a live OPC UA Pose stores the Manual fallback and Binding but
    stores no live value, timestamp, or quality. Reload shows the fallback until
    the first GOOD sample.
11. Deleting a bound target removes both Transform and browser/Project numeric
    Status bindings and leaves no live-sample or collision-registry entry; the
    browser ignores any orphan ID still broadcast by unchanged Connector
    configuration.
12. Middleware tests prove no OPC UA write, method-call, or command API is
    invoked.
13. With Robot Joint source set to Simulation, bound Equipment continues to
    consume OPC UA Transform and numeric Status frames.
14. Duplicate or lower sequence values do not change effective Pose or
    collision revision; a reopened WebSocket accepts the new stream sequence.
15. An MCP-relative Binding follows MCP, while a World-relative Binding retains
    its World Pose after MCP changes.
16. Drag, Manual Apply, and Robot grasp are blocked while Transform source is
    OPC UA, and switching a held entity to OPC UA is rejected without dropping
    it.
17. On an open socket, a missing Profile, Gateway ID mismatch, or Profile
    revision mismatch leaves the Manual fallback visible with BAD quality; it
    never applies values from a different gateway or Profile revision.
18. After the first effective GOOD Pose, 100 repeated frames with an identical
    4x4 matrix update receipt age/quality but add zero Geometry mutations and
    zero collision-registry revisions.
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
    `STALE` for expired silence. Every transition preserves Manual fallback or
    last-good Geometry without a transient zero Pose.
22. Changing Profile ID, Gateway ID, Profile revision, mode, or reference frame
    clears old last-good telemetry, increments the entity generation, and shows
    the Manual fallback until a GOOD frame for the new identity arrives. A late
    old-identity frame changes no state.
23. Connector boundary tests accept 32 Transform Profiles and 256 total read
    Nodes, reject 33 Profiles or 257 Nodes before startup, accept a 65,536-byte
    catalog/frame, and reject 65,537 bytes before JSON reduction while preserving
    last-good Geometry. UTF-8 identifier tests likewise accept the exact
    128/1,024-byte ID/NodeId limits and reject one byte above them.

### 11.3 Shared Release Gate

1. Project v1 and v2 fixtures migrate deterministically to v3 and re-export as
   byte-stable v3 configuration JSON with source files stored once.
2. Existing Simulation and OPC UA Joint sources, Pose ordering/speed, Manual
   Object transform, one-whole-STEP-per-Object import, Object removal, numeric
   Status overlay, grasp, and Geometry Collision workflows remain functional.
3. `npm run lint`, `npm run test:run`, `npm run test:middleware`,
   `npm run cad:validate`, `npm run build`, and
   `npm run test:e2e -- tests/robot-assembly-import.spec.ts tests/opcua-equipment-transform.spec.ts tests/project-roundtrip.spec.ts tests/geometry-collision.spec.ts`
   all pass with no flaky timeout accepted as a release pass.
4. Documentation describes units, ZYX rotation order, source ownership,
   GOOD/BAD/STALE behavior, fused-body rejection, file/Geometry budgets, Project
   migration, and recovery actions completely and consistently.
5. Boundary fixtures prove acceptance at every configured source, byte,
   triangle, mesh, node/depth, material, Link-reference, typed-array, and total
   scene budget, and deterministic pre-commit rejection immediately above each
   boundary.
6. Fault injection before and after every Project commit phase, including the DB
   pointer/runtime-bundle boundary and compensation failure, leaves DB pointer,
   cache revision, and visible runtime all on the complete old or complete new
   revision. Interaction is never enabled for a mixed revision, and reload
   recovers the authoritative revision.
7. `npm run deploy:validate`, `npm run deploy:smoke`, and
   `npm run deploy:smoke:opcua` pass. The OPC UA deployment smoke test receives
   the Profile catalog through `/opcua` and proves an unavailable upstream emits
   BAD quality without a zero Pose.

## 12. Implementation Plan Boundary

After user approval of this written design, detailed implementation planning
will produce:

1. a shared Project Schema v3 foundation plan;
2. a Single-Assembly Robot Import plan; and
3. an OPC UA Equipment Transform plan.

Each plan must use TDD-sized tasks, exact file paths, explicit interfaces,
targeted failure-first tests, verification commands, and reviewable commits.
No implementation starts before the written design review is approved.
