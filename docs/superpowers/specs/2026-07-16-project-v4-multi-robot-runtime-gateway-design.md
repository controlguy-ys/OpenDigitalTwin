# Project V4 Multi-Robot, Runtime Gateway, and Pick/Place Design

**Date:** 2026-07-16

**Status:** Conversation-approved; written-spec review pending

**Target:** `main`

**Delivery style:** Deterministic implementation in bounded milestones

## 1. Purpose

This design evolves RobotSimWeb from one fixed six-axis Robot and one read-only
OPC UA Client connection into a reusable, lightweight Web Digital Twin that can:

- run multiple independent Robot instances in one browser Simulation;
- import Robot Geometry from one through seven STEP sources without treating
  source-file count as Joint count;
- describe variable Robot Joint chains and reusable Robot Definitions;
- mount a Robot Base on a user-defined Moving Frame such as a linear axis;
- model non-Robot equipment through general Spatial Entities and named XYZRPY
  Moving Frames;
- operate an optional OPC UA Client, Server, or Bridge through one Runtime
  Gateway with multiple independently supervised upstream Endpoints;
- import and export deterministic mapping configuration through JSON, XML, and
  XLSX without embedding workstation-specific paths;
- execute explicit Robot Pick/Place actions without a physics engine; and
- finish with a browser-verified sample containing two Robots, an OPC UA Server,
  independent Sample Jobs, and one complete Pick/Place sequence.

The target remains a visualization and engineering Digital Twin. It is not a
Robot safety controller, RobotWare replacement, motion planner, or physics
simulator.

## 2. Approved Decision Summary

1. Use the **Hybrid Core + Runtime Gateway** architecture.
2. Introduce a breaking `Project V4`; do not implement Legacy Adoption or an
   automatic V3 migration until the user explicitly requests it.
3. Keep Robot as a dedicated articulated domain type. Do not represent a Robot
   as a generic Moving Frame collection.
4. Represent Machine, Fixture, Table, Object, Track mover, and other non-Robot
   equipment as a generic `SpatialEntity` with zero or more named
   `MovingFrame` records.
5. Allow up to eight simultaneous Robot Instances, with one through sixteen
   Joints per Robot Definition.
6. Keep the Robot STEP source limit at one through seven files per Definition.
   A single assembly STEP may provide multiple Links, and one source never
   implies one Joint.
7. Use one Runtime Gateway that owns `endpoints[]`; do not require one Gateway
   container per upstream OPC UA Server.
8. Support `Off`, `Client`, `Server`, and `Bridge` OPC UA modes.
9. Use a `RuntimePublisherLease` fencing token for state publication and all
   outgoing writes. Observer browsers do not require a Lease.
10. Bound structured mappings by Structure roots, expanded scalar Leaves, and
    update rate: 128 Structures, 1,024 Leaves, eight Endpoints, and 10,240
    leaf-updates/second per Project.
11. Keep JSON as the only canonical Project representation. XML is lossless
    domain interchange. XLSX is a human-editable mapping workbook.
12. Store logical `asset://` or versioned `builtin://` URIs in Projects. Store
    physical mount paths outside Projects.
13. Use explicit `AttachObject` and `DetachObject` actions. Closing a Gripper
    never selects the nearest Object automatically.
14. Allow Job/UI execution and deterministic OPC UA Action Binding to invoke the
    same Action Executor.
15. Verify the finished system through the browser with a two-Robot sample and
    a real OPC UA Server read/write smoke client.
16. Use heterogeneous Robot Definitions in the final sample: the built-in ABB
    CRB15000 and a Savvy MRb05 created from one external Assembly STEP source.

## 3. Current Baseline and Breaking Boundary

The current Project V3 has one `robot` property, fixed `robot:active` and
`linear-axis:active` Scene IDs, fixed six-angle Job Poses, and one OPC UA
Endpoint configuration containing exactly `J1` through `J6`.

Relevant current sources are:

- `src/domain/project/project-v3.ts`
- `src/domain/project/scene-state-v1.ts`
- `src/domain/project/simulation-job-v1.ts`
- `middleware/opcua-config.mjs`
- `middleware/opcua-connector.mjs`
- `src/features/interaction/interaction-store.ts`
- `src/features/interaction/GraspController.tsx`
- `src/features/interaction/grasp-actions.ts`
- `src/features/project/project-v3-archive.ts`
- `deploy/nginx.conf`
- `playwright.config.ts`
- `compose.yaml`

The current grasp runtime also has one global held Object, selects a nearby
Object as part of Gripper Close, and detaches toward the Workbench. Project V4
replaces those behaviors with instance-keyed explicit Attachment constraints;
it does not retain the automatic-nearest compatibility path.

The current V3 archive embeds content-addressed STEP bytes and the reusable
Scene Editor caps unique imported Object STEP Assets at 64. V4 replaces the
archive's authoritative bytes with logical Asset references and raises the
approved unique Object STEP Asset limit to 128 while retaining the global byte
and visible-triangle budgets.

Project V4 replaces these cardinality assumptions. It is not a field-compatible
extension. A V4 decoder rejects V1, V2, and V3 payloads with
`PROJECT_SCHEMA_UNSUPPORTED` before mutating the active Project. The current
self-contained V3 archive is not silently adopted. An explicit migration or
vendoring feature can be designed later if requested.

When requirements conflict, this document supersedes the single-Robot,
fixed-six-Joint, read-only OPC UA, embedded-archive, and single-linear-axis
assumptions in the following prior designs:

- `2026-07-13-single-assembly-robot-opcua-equipment-transform-design.md`
- `2026-07-13-portable-workcell-project-format.md`
- `2026-07-13-on-prem-docker-deployment-design.md`
- `2026-07-15-reusable-scene-editor-design.md`

Unaffected behavior and regression expectations in those documents remain in
force.

## 4. Scope

### 4.1 In Scope

- Project V4 schema, validator, canonical codec, and revision hash.
- Reusable Robot Definitions and up to eight Robot Instances.
- One through sixteen revolute or prismatic Joints per serial Robot Definition.
- One through seven Robot STEP source references per Robot Definition.
- Deterministic manual Geometry-to-Link and Joint axis/origin configuration.
- Robot Base mounting under World, MCP, or any eligible Moving Frame.
- Independent Robot Joint state, source ownership, Job, and runtime buffer.
- General Spatial Entities, Scene Groups, visibility, XYZRPY, numeric status,
  and named Moving Frames.
- Explicit Gripper state, Attach, Detach, and Pick/Place Job actions.
- OPC UA Action Bindings targeting a preconfigured Job or Action.
- Runtime Gateway Asset resolution and OPC UA Off/Client/Server/Bridge modes.
- Multiple upstream OPC UA Endpoints and Subscription-based state transport.
- Browser-only visual interpolation with bounded buffers.
- OPC UA state, command, result, diagnostics, and Lease contracts.
- JSON canonical storage, lossless XML domain interchange, and XLSX mapping
  interchange.
- Docker Compose profiles, health/readiness checks, performance tests, and the
  final two-Robot browser demonstration.

### 4.2 Explicitly Out of Scope

- Authentication, authorization, OPC UA certificate trust management, signing,
  encryption, and production network hardening.
- AI/API/harness-based automatic STEP semantic extraction.
- Automatic Joint inference from STEP topology or names.
- Physics, mass, inertia, gravity, friction, dynamics, force, torque, or grasp
  contact simulation.
- Automatic nearest-Object grasping.
- Cartesian path planning, inverse kinematics, or reachability solving.
- Coordinated multi-Robot Jobs or cross-Robot synchronization barriers.
- Parallel and closed-loop Robot kinematics.
- Vendor-specific Track or shuttle OPC UA Information Models.
- Live PLC transfer, controller restart, safety validation, or certification.
- Legacy Project adoption or automatic V3-to-V4 migration.

Geometry collision may continue to validate geometric overlap, but it does not
create forces or move Objects.

## 5. Architecture

```text
Browser Web Application
├─ Project and Scene Editor
├─ Multi-Robot Simulation Runtime
├─ Robot Jobs and Action Executor
├─ STEP Analysis and Geometry Mapping UI
├─ Runtime Interpolation Buffers
└─ Browser Rendering and Browser Verification
                 │
                 │ versioned Project/config and state/command envelopes
                 ▼
Shared Deterministic Core
├─ Project V4 schema and canonical codec
├─ Robot, Frame, Scene, Job, Action, and Mapping validators
├─ Coordinate transformations
├─ Mapping/resource budget accounting
├─ JSON/XML/XLSX conversion
└─ Stable error/result contracts
                 │
                 ▼
Runtime Gateway
├─ AssetResolver
├─ Project revision activation
├─ RuntimePublisherLease manager
├─ WebSocket state/command gateway
└─ OpcUaAdapter
   ├─ Off
   ├─ Client: endpoints[] workers
   ├─ Server: downstream OPC UA namespace
   └─ Bridge: explicit upstream/downstream routes
```

The Shared Deterministic Core has no Three.js, React, WebSocket, filesystem, or
`node-opcua` dependency. Browser and Gateway adapters may change independently
as long as they honor the versioned Core contracts.

The Runtime Gateway does not become a Project authoring service. The browser
authors a Draft, the Core validates it, and the Gateway activates only the exact
validated `configRevision`.

The standard Docker deployment starts both `web` and `runtime-gateway`; OPC UA
mode defaults to `Off`. The same Gateway process changes only its `OpcUaAdapter`
for Client, Server, or Bridge mode. A web-only deployment remains usable for
`builtin://` Assets and session-local re-selection, but persistent external
`asset://` resolution requires the Gateway.

## 6. Project V4 Domain

### 6.1 Aggregate

The canonical aggregate has the following conceptual shape:

```ts
interface WorkcellProjectV4 {
  schemaVersion: 4
  projectId: string
  revisionId: string
  metadata: ProjectMetadataV4
  assetReferences: readonly AssetReferenceV4[]
  scene: ProjectSceneV4
  robotDefinitions: readonly RobotDefinitionV4[]
  robots: readonly RobotInstanceV4[]
  spatialEntities: readonly SpatialEntityV4[]
  sceneGroups: readonly SceneGroupV4[]
  jobs: readonly RobotJobV4[]
  actions: readonly RobotActionDefinitionV4[]
  opcUa: OpcUaProjectConfigurationV4
}
```

All persisted IDs are stable and globally unique within the Project. Project
load validates every reference and every parent edge before publishing the new
active revision.

### 6.2 Coordinate Convention

- Robot domain coordinates are right-handed and Z-up.
- Internal position is metres.
- Internal orientation is a normalized quaternion `[x, y, z, w]`.
- UI and interchange XYZRPY use metres and degrees.
- RPY composition is `Rz(yaw) * Ry(pitch) * Rx(roll)`.
- Every Frame has one parent. World has no parent.
- MCP is a named cell Frame beneath World, not a camera transform.
- Camera/View coordinates never enter Robot or Project pose calculations.
- A single Scene Coordinate Adapter converts domain transforms for rendering.

The Core rejects non-finite values, non-normalizable quaternions, duplicate
Frame IDs, missing parents, and parent cycles.

### 6.3 Robot Definition

`RobotDefinitionV4` owns reusable, instance-independent configuration:

- stable Definition ID, name, manufacturer/model metadata;
- one through seven Robot STEP `AssetReferenceV4` values;
- one through sixteen serial Joints and the corresponding two through seventeen
  serial Links;
- Joint type, parent/child Link, origin, axis, limits, Home, zero offset, and
  velocity limit;
- Geometry occurrence-to-Link mapping and Link-local transforms;
- Base, Flange, Tool0, Tool, TCP, and optional Gripper Frame definitions;
- Geometry/collision preparation metadata; and
- Geometry import unit, Up Axis, source-root Import Rotation, and checksum.

One STEP assembly may contain the selectable Geometry occurrences for all
Links. Several STEP sources may contribute occurrences to one Link. Source file
count never determines Link or Joint count. A fused, non-separable body cannot
be converted into independently moving Links and is rejected with explicit
recovery guidance.

Geometry and Joint mapping remain deterministic and operator-controlled. The
system may display STEP names and hierarchy as evidence but does not infer
mechanics from naming heuristics or an AI API.

### 6.4 Robot Instance

`RobotInstanceV4` owns instance state and references one Robot Definition:

- stable Robot ID and user-visible name;
- `definitionId`;
- Scene visibility and display settings;
- `baseParentFrameId` and a local Base Pose;
- persisted initial Joint values keyed by Joint ID;
- current Joint source: `simulation`, `manual`, or an OPC UA Binding set;
- selected Tool/TCP; and
- instance-specific numeric status.

The Robot Base pose has one authoritative owner. It is derived from
`baseParentFrameId * localBasePose`; it is not duplicated in Mechanics and Scene
state. Mounting a Robot to a linear carriage means assigning the carriage's
named Moving Frame as `baseParentFrameId`.

Two Robot Instances may share one Definition. Prepared Geometry and materials
are reused where the renderer permits, while Joint state, World matrices,
visibility, Jobs, OPC UA bindings, and status remain independent.

### 6.5 Spatial Entity and Moving Frame

`SpatialEntityV4` represents every non-Robot Scene item:

- stable ID, name, Asset reference or primitive Geometry;
- parent Frame and local pose;
- effective visibility, Group membership, and removable state;
- `manual`, `simulation`, `opcua`, or `attachment` transform owner;
- numeric status and overlay settings;
- `graspable` flag and optional named Object Grasp Frames; and
- zero or more named Moving Frames.

Each `MovingFrameV4` has a globally unique Frame ID, one parent, a local pose,
source ownership, timestamp, and quality. Machine, fixture, conveyor carrier,
linear carriage, and Track mover behavior use this general contract. No
vendor-specific Track model is added.

Scene Groups provide organization and inherited visibility. They do not own
Robot mechanics or duplicate child World poses.

### 6.6 Robot Job and Action Model

Every Job belongs to exactly one Robot:

```ts
type RobotJobStepV4 =
  | JointPoseStepV4
  | ActionReferenceStepV4

interface JointPoseStepV4 {
  kind: 'joint-pose'
  jointValues: Readonly<Record<JointId, number>>
  speedPercentToNext: number
}
```

Pose validation uses the selected Robot Definition's Joint ID set and limits.
The implementation does not pad or truncate to six angles. Job ordering,
speed-to-next, delete, duplicate, and preview operate per selected Robot.

Project V4 allows at most 32 Jobs, 256 total steps per Job, and 2,048 total Job
steps. Pose and Action-reference steps both consume the step budget. A Job may
start only when its Robot is in Simulation ownership.

`RobotActionDefinitionV4` provides stable, reusable Actions:

- `set-gripper-state` with `OPEN` or `CLOSED`;
- `attach-object` with Robot, Tool Grasp Frame, Object, optional Object Grasp
  Frame, and operator-set maximum attach distance;
- `detach-object` with Object and optional target parent Frame.

Jobs and OPC UA Action Bindings both invoke one Action Executor.
An OPC UA Action Binding may target `action-execute` or `job-start`. A Job may
reference only the three non-Job Actions above; it cannot start another Job and
cannot recursively invoke itself.

### 6.7 Kinematic Grasp Constraint

Pick/Place uses a transform-parent constraint, not physics.

On `attach-object`, the Action Executor validates:

1. the Robot, Tool Frame, Object, and optional Object Grasp Frame exist;
2. the Object is marked `graspable`;
3. the Object is not attached to another Tool;
4. the Object transform owner permits Simulation attachment;
5. attachment would not create a Frame cycle; and
6. the Tool-to-grasp target distance is within the Action's configured limit.

If valid, it calculates the Object's Tool-relative pose from the current World
poses and creates:

```ts
interface AttachmentConstraintV4 {
  robotId: string
  toolFrameId: string
  objectId: string
  relativePose: RigidTransformV4
  attachedAtSimulationMs: number
}
```

The Object keeps its World pose at the attach instant and then follows the Tool
exactly. Closing a Gripper never implies Attach. Opening it never implies
Detach.

Automated Attach/Detach checks compare the Object World pose immediately before
and after the parent change. The maximum accepted discontinuity is 0.5 mm in
position and 0.1 degree in orientation; later commanded Tool motion is outside
that boundary measurement.

On `detach-object`, the Object keeps its World pose and becomes a child of the
explicit target Frame or World. Simulation Reset restores the Project's initial
parent and pose. Deleting an attached Robot, Tool, Object, or parent is blocked
until the operator confirms Detach.

An OPC UA-owned Object cannot be attached until ownership changes to
Simulation/Manual. An attached Object rejects an OPC UA transform update.

### 6.8 Geometry Collision Identity

Geometry collision remains a validation layer, not a physics response. Every
Robot collision proxy is namespaced by Instance, for example
`robot-link:<robotId>:<linkId>`. Link adjacency exclusions apply only inside the
same Robot Instance. Robot-to-Robot and Robot-to-external-Object pairs remain
eligible candidates.

Intentional mount contact is configured per Robot Instance. While an Object is
attached, the exact Tool/Object grasp-contact pair is ignored, but the Object
continues to participate against other Robot Links and Scene Geometry. Detach
restores the ordinary candidate set. Hiding an Entity excludes its descendant
collision proxies without deleting Attachment or Joint state.

## 7. Limits and Resource Accounting

### 7.1 Project and Geometry Limits

| Resource | V4 limit |
|---|---:|
| Robot Instances | 8 |
| Joints per Robot Definition | 1-16 |
| Robot STEP source references per Definition | 1-7 |
| Unique imported non-Robot STEP Assets | 128 |
| Total non-Robot Object Instances | 256 |
| Jobs per Project | 32 |
| Job steps per Job | 256 |
| Total Job steps | 2,048 |
| Visible Scene triangles | 1,500,000 |
| Raw referenced STEP bytes per Project | 256 MiB |
| One Object STEP source | 50 MiB and 250,000 triangles |
| One Robot Definition | 100 MiB and 600,000 triangles |

Generated Box and Cylinder Assets do not consume STEP source count or raw STEP
byte budget, but their visible Geometry consumes the Scene triangle budget.
Repeated Instances reuse the same prepared Asset where possible.

### 7.2 OPC UA Mapping Limits

| Resource | Project limit | Endpoint limit | Structure limit |
|---|---:|---:|---:|
| Upstream Endpoints | 8 | n/a | n/a |
| Structure root mappings | 128 | 64 | n/a |
| Expanded scalar Leaves | 1,024 | 512 | 32 |
| Structure nesting depth | 4 | 4 | 4 |
| Fixed array elements | global Leaf budget | global Leaf budget | 256 |
| State/command batch | 256 KiB | 128 values/call target | n/a |
| Concurrent OPC UA Server Client Sessions | 16 | n/a | n/a |
| Active Command deduplication records | 4,096 | n/a | n/a |

The update-rate budget is:

```text
sum(expanded leaf count * publishing frequency Hz) <= 10,240 per second
```

The default publishing interval is 100 ms. One Mapping may request up to 20 Hz,
but its higher rate consumes proportionally more global budget.

A Structure is one root Mapping assignment. A Leaf is one scalar after fixed
arrays and nested Structures are expanded. Dynamic or unbounded arrays are
rejected. A single OPC UA ExtensionObject still consumes all decoded Leaves.
When one MonitoredItem fans out to several Project targets, the upstream
MonitoredItem is deduplicated but routed Leaves count once per target.

An external Server command's `expiresAt` may be at most 60 seconds after the
Trigger snapshot. Its deduplication record remains active while execution is
`RUNNING` and for five minutes after a terminal result. Expired terminal records
are pruned. If 4,096 records are active, the Gateway does not evict a valid
record; it rejects a new command with `COMMAND_DEDUP_CAPACITY_EXCEEDED`.

All limits apply simultaneously. Exactly-at-limit candidates pass. Each limit
plus one is rejected before Gateway activation.

The eight-Robot limit and the 1.5M-visible-triangle limit are independent. Eight
simple Robots may fit, while eight maximum-complexity Robots may exceed the
Scene Geometry budget and be rejected or require hidden Instances.

## 8. Logical Asset Resolution

### 8.1 URI Contract

Project V4 permits:

```text
asset://<mount-alias>/<normalized-relative-path>
builtin://abb/<asset-id>@<version>
```

Projects, XML, and XLSX never contain physical Windows, Linux, or Docker paths.
The deployment owns a mount table such as:

```text
cell-library -> D:\CellAssets              (Windows development)
cell-library -> /srv/webdtwin/cell-assets  (Linux/Docker)
```

The resolver rejects absolute relative-path payloads, `..` traversal, a path
that escapes the resolved mount, unknown aliases, and checksum mismatches.

### 8.2 Resolver Behavior

`AssetResolver` is independent from `OpcUaAdapter`. OPC UA `Off` disables OPC
UA only; it does not disable Asset resolution.

The Gateway can expose a dedicated managed `project-assets` mount for files
imported through the browser. Other deployment mounts may remain read-only. A
browser import computes SHA-256, performs STEP preflight, uploads or registers
the source under an allowed mount, and then commits only the logical URI and
digest to the Project. Upload and resolve paths stream bounded content rather
than buffering the Project-wide Asset budget in Gateway memory.

If no Runtime Gateway is present, built-in Assets continue to work. External
`asset://` references load as `UNRESOLVED`; the user may reselect a file for the
current session, but no workstation path is persisted.

Missing Assets do not prevent Project configuration from opening. The Scene
shows a bounded placeholder and an `UNRESOLVED` badge. A digest mismatch blocks
Geometry publication and offers Remap or Re-select; it never substitutes bytes
silently.

## 9. Runtime Gateway and OPC UA

### 9.1 Modes

| Mode | Behavior |
|---|---|
| `Off` | Asset resolution and Web Simulation; no OPC UA Client or Server |
| `Client` | Subscribe to multiple upstream Servers and perform explicitly allowed writes |
| `Server` | Publish accepted Web Simulation state and receive preconfigured commands |
| `Bridge` | Run Client and Server and route only explicitly declared paths |

The short-term deployment uses anonymous OPC UA access with SecurityPolicy None
because security configuration is outside this phase. The operator documentation
must state that this profile is not production-hardened.

### 9.2 Endpoint Workers

The Gateway owns `endpoints[]`. Each Endpoint Worker owns its Client, Session,
Subscriptions, reconnect state, sequence, diagnostics, and server-advertised
OperationLimits. An Endpoint failure never disconnects healthy workers.

The effective call budget is:

```text
min(application limit, non-zero server-advertised OperationLimit)
```

If a Server omits an optional limit or reports zero, the application limit
remains in force. The Gateway chunks read/write/monitored-item operations and
reports unsupported mappings explicitly.

### 9.3 Configuration Activation

1. Browser edits a Draft.
2. Shared Core validates schema, references, cycles, units, and budgets.
3. Browser computes an immutable canonical `configRevision`.
4. Operator selects Apply.
5. Gateway repeats deterministic validation.
6. Gateway stages Endpoint workers and Server namespace.
7. Gateway atomically activates the new Revision.

Schema or budget errors reject the entire candidate and leave the prior
Revision active. A valid offline Endpoint configuration may activate in
`CONNECTING` or `DEGRADED`; it does not invalidate unrelated configuration.

`/healthz` reports process liveness. `/readyz` reports ready only after one
validated Revision is active, the configured mode has staged its required
workers/namespace, and a Runtime Publisher Lease exists when Server commands
need a Simulation owner. Before first Apply it returns not-ready with
`NO_ACTIVE_REVISION`; callers do not wait for readiness before loading the
Project that creates that Revision.

### 9.4 State Transport

The Gateway sends `state-batch-v1` envelopes containing:

- protocol version, Gateway ID, Endpoint ID, Project ID, and config Revision;
- Endpoint-local monotonically increasing Sequence;
- sampled/source and published timestamps;
- Mapping ID and typed value;
- unit and Status/Quality; and
- origin ID for Bridge loop prevention.

Actual Robot Joint state, generic Moving Frame state, numeric Object status,
Attachment state, Job state, and Action results use stable Mapping IDs rather
than positional arrays tied to one Robot.

One structured coherence group is accepted atomically. A missing, non-finite,
or BAD required Leaf rejects the group and retains the previous complete value.
Different upstream Endpoints are never presented as one atomic Snapshot.

Each WebSocket client has a bounded latest-wins queue: one transmitting Batch
and at most one newest pending Batch. Historical Digital Twin state never grows
unbounded for a slow browser.

### 9.5 Browser Interpolation

Incoming state enters per-Robot and per-Moving-Frame runtime buffers without
causing a React rerender per network frame. The render loop samples approximately
two publishing cycles behind the latest accepted source timestamp.

- Position uses linear interpolation.
- Orientation uses shortest-path quaternion interpolation.
- Revolute Joint interpolation respects wrapping and limits.
- Prismatic Joint interpolation is linear.
- Out-of-order Sequence values are discarded.
- A gap beyond the staleness threshold freezes the last complete value and
  changes UI quality to `STALE`.

Interpolation is visualization-only. The Gateway's OPC UA Server publishes the
last accepted source state, not a browser-interpolated value.

### 9.6 Command Transport

Writes use `command-batch-v1`, separate from state:

- Command ID;
- Project and config Revision;
- Lease generation;
- expiry timestamp;
- Mapping or Action Binding ID; and
- typed command values.

The Gateway validates direction, datatype, unit, range, Revision, Lease,
expiry, and duplicate Command ID. It returns per-item acknowledgement and stable
failure results. A timed-out non-idempotent command is not automatically
repeated.

The deduplication key is `(projectId, configRevision, leaseGeneration,
bindingOrMappingId, commandId)`. While its bounded record is active, replay
returns the stored acknowledgement and terminal result and never re-executes,
even when the client supplies a new valid Trigger edge. Duplicate lookup occurs
before first-execution expiry validation, so an active identical replay returns
the stored result even after its original expiry. The same active Command ID
with changed expiry or payload fails as `COMMAND_ID_CONFLICT`. A new Revision or
Lease generation starts a new key space. A new or no-longer-retained request
whose expiry has passed is rejected as `COMMAND_EXPIRED`.

For an external OPC UA Client writing the Gateway Server, the client supplies a
preconfigured Mapping or Action Binding's Command ID, `expiresAt`, and Trigger,
not a browser Lease token. Command staging is isolated by OPC UA Session and
Binding/Mapping ID. A Mapping stages its typed `Value`; only a Boolean
`false -> true` Trigger snapshots the complete ID, expiry, and Value written by
that same Session. Writes from another Session cannot contribute fields, and a
Value write alone has no runtime effect. Incomplete staging fails as
`COMMAND_STAGING_INCOMPLETE`. Staging clears after a successful Trigger, Session
close, or Session timeout.

The Gateway requires a live `RuntimePublisherLease`, captures its current
generation, and forwards a `command-request-v1` only to that Lease owner. The
owner returns the result with the same Revision, generation, and Command ID. If
no owner exists, the command fails as `NO_ACTIVE_PUBLISHER`. A stale Browser
cannot complete a command after Lease takeover.

A Server-side Joint Command Mapping addressed to a Robot in Simulation
ownership is a one-shot imperative request to the Lease owner. It does not
change that Robot's configured Joint source. Changing source ownership to an
upstream OPC UA Binding requires a separate validated configuration Apply; a
Robot under OPC UA ownership cannot start a Simulation Job.

Each Server Mapping result exposes `IDLE | ACCEPTED | REJECTED`
acknowledgement and `IDLE | RUNNING | SUCCEEDED | FAILED` execution state.
`SUCCEEDED` means the Lease owner applied the complete command, not merely that
the Gateway accepted its Trigger.

### 9.7 Runtime Publisher Lease

The Gateway issues `RuntimePublisherLease` values containing:

```text
projectId, configRevision, publisherId, generation, expiresAt
```

Only one Browser may publish Simulation state or issue upstream writes for one
Project/Revision. Other Browsers remain observers. The Gateway rejects every
publish or write carrying an old generation, even when the previous lease has
not been locally noticed by a stale Browser.

Lease loss leaves the last state visible, rejects further writes, and marks
Gateway-published Simulation values with a communication-quality downgrade.
This Lease is independent from any existing Project source-publication lease.

### 9.8 Server Information Model

The Server separates actual state from desired commands:

```text
WebDigitalTwin
└─ Projects
   └─ <projectId>
      ├─ Actual
      │  ├─ Robots/<robotId>/Joints/<jointId>
      │  ├─ Robots/<robotId>/Frames/{Base,Flange,TCP}
      │  ├─ Entities/<entityId>/Frames/<frameId>/XYZRPY
      │  ├─ Entities/<entityId>/Status
      │  └─ Attachments/<objectId>
      ├─ Command
      │  ├─ Mappings/<mappingId>/{CommandId,ExpiresAt,Value,Trigger}
      │  └─ Actions/<actionBindingId>/{CommandId,ExpiresAt,Trigger}
      ├─ Result
      │  ├─ Mappings/<mappingId>/{CommandId,Acknowledgement,State,FailureCode,Message}
      │  └─ Actions/<actionBindingId>/{CommandId,Acknowledgement,State,FailureCode,Message}
      └─ Diagnostics
         ├─ ConfigRevision
         ├─ RuntimePublisherLease
         └─ Endpoints/<endpointId>
```

Robot remains a dedicated namespace. Non-Robot moving equipment exposes general
named XYZRPY Frames. State and Command never share one implicitly bidirectional
Variable.

### 9.9 Bridge Rules

Bridge mode forwards only declared routes. Each route specifies source,
destination, direction, conversion, and ownership. `originId + sequence` blocks
echo. A route may never feed its destination back into its own source. A
configuration containing a static route cycle is rejected before activation.

## 10. Mapping Model

Every Mapping declares:

- stable Mapping ID and Endpoint ID;
- source Node ID or Server namespace target;
- Project target type and target ID;
- `read`, `write`, `readWrite`, `publish`, or `action-trigger` direction;
- OPC UA datatype and expected Project datatype;
- scale, offset, unit, and coordinate convention;
- sampling/publishing interval;
- coherent Structure group membership; and
- source ownership and interpolation policy.

A declared `readWrite` Mapping expands into distinct State and Command
channels. It never creates one Variable that is both the accepted Actual value
and the Desired command value.

Robot mappings target a Robot ID and Joint/Frame ID. Generic mappings target a
Spatial Entity ID and named Moving Frame/Status ID. Robot Action Bindings target
only an existing Project Job or `RobotActionDefinitionV4`.

An Action Binding may use a Boolean rising edge or an integer command value. It
does not accept a remotely supplied Robot ID or Object ID. The binding publishes:

```text
CommandId
CommandAcknowledgement: IDLE | ACCEPTED | REJECTED
ActionState: IDLE | RUNNING | SUCCEEDED | FAILED
AttachedObjectId
FailureCode
```

Acknowledgement covers validation and enqueueing only. For `job-start`,
`ActionState` remains `RUNNING` until the entire Job terminates and then becomes
`SUCCEEDED` or `FAILED`. For `action-execute`, it reaches a terminal state only
after the shared Action Executor completes. The terminal state is stored with
the deduplication key.

## 11. JSON, XML, and XLSX

### 11.1 Canonical JSON

Canonical JSON is the sole source for Project validation and Revision hashing.
Object keys, record order, numeric normalization, and omitted optional values
follow one deterministic codec. Live telemetry, Lease state, interpolation
buffers, and physical deployment mounts are not Project configuration.

### 11.2 XML

XML is a lossless interchange representation of the V4 domain configuration.
It includes stable IDs, Robot Definitions, Robot Instances, Frames, Jobs,
Actions, Asset URIs/digests, Endpoints, and Mappings. It excludes STEP bytes,
physical deployment mounts, and live runtime state.

The release gate requires:

```text
canonicalHash(JSON -> XML -> JSON) == canonicalHash(original JSON)
```

### 11.3 XLSX

XLSX is an editing workbook, not a complete Project format. It contains bounded
sheets for:

- `Endpoints`
- `Robots`
- `Joints`
- `Frames`
- `Mappings`
- `Actions`
- `AssetReferences`

Every row uses stable IDs and explicit units. XLSX import stages all sheets,
reports sheet/cell errors, shows a semantic Diff, and applies atomically after
operator confirmation. It never applies valid rows while silently discarding
invalid rows.

## 12. UI and Operator Workflow

The existing Scene Objects/Robot Jobs split remains, generalized for multiple
Robots:

- Scene tree shows every Robot, Group, Object, and Moving Frame owner.
- Selecting a Robot filters the Job list and Timeline to that Robot.
- Robot visibility, Base mounting, Joint ownership, Tool/TCP, and status are
  instance-specific.
- Robot Definition/Geometry editing clearly indicates every Instance affected
  by a shared Definition change.
- The Mapping workspace groups configuration by Endpoint and domain target.
- Runtime status shows OPC UA mode, Lease owner/observer state, config Revision,
  Endpoint health, last timestamp, and quality.
- Asset errors provide Remap/Re-select without closing the Project.
- Attach/Detach actions are available in Job editing and context actions, but
  never infer the target Object.
- OPC UA Server mode exposes its endpoint URL and readiness in the browser.

## 13. Error and Recovery Contract

| Condition | Required behavior |
|---|---|
| Unsupported V1/V2/V3 Project | Reject with `PROJECT_SCHEMA_UNSUPPORTED` |
| Invalid schema/reference/cycle/budget | Reject candidate; preserve active Revision |
| Missing Asset | Load Project with `UNRESOLVED` Geometry placeholder |
| Digest mismatch | Block Geometry publication; require Remap/Re-select |
| One Endpoint disconnected | Reconnect only that Endpoint; retain others |
| Old Sequence or Revision | Drop without mutating current state |
| Partial/BAD coherent Structure | Keep prior complete value; mark quality |
| Lease expired or old generation | Reject publish/write; observation continues |
| Duplicate Command ID | Return prior result; do not execute twice |
| Active Command ID with changed immutable fields | `COMMAND_ID_CONFLICT` |
| Incomplete or cross-Session Command staging | `COMMAND_STAGING_INCOMPLETE` |
| Command deduplication capacity full | `COMMAND_DEDUP_CAPACITY_EXCEEDED` |
| Command timeout | Report failure; do not automatically replay |
| Bridge route cycle | Reject configuration before activation |
| Object already attached | `ALREADY_ATTACHED` |
| Object or Tool missing | `OBJECT_NOT_FOUND` or `TOOL_FRAME_NOT_FOUND` |
| Attach distance exceeded | `OUT_OF_RANGE` |
| Transform ownership conflict | `SOURCE_OWNERSHIP_CONFLICT` |
| Attachment would create cycle | `FRAME_CYCLE` |

Every error includes a stable code, affected ID/path, concise operator message,
and optional recovery action. Raw stack traces are diagnostic-only.

## 14. Final Sample Project and Browser Verification

The final integrated fixture is named
**Heterogeneous Dual Robot OPC UA Pick/Place Demo**.

### 14.1 Scene

- `Robot_A_CRB15000` references the built-in or checked-in
  `CRB15000_12kg-127_OmniCore_rev00_STEP_J` Robot Definition.
- `Robot_B_MRb05` references a separate Savvy MRb05 Robot Definition created
  from exactly one external Assembly STEP source.
- Their Base Frames are positioned independently on one workcell.
- `Cup_01` is a graspable Object with a configured Grasp Frame.
- `Pick_Table` and `Place_Table` provide named placement Frames.
- The Project runs in OPC UA `Server` mode and displays Server readiness.

### 14.2 MRb05 Single-Assembly Fixture

The local acceptance source is resolved as:

```text
asset://local-samples/Savvy/MRb05_3D_20241011.STEP
sha256: 8bce1c031ec9301ce8e66d01c82560a7bb0c881e0455871b6d5f2c38afe567fa
source bytes: 14,161,656
```

The physical `Savvy/MRb05_3D_20241011.STEP` remains an untracked user Asset and
is not added to Git. The test deployment maps `local-samples` outside Project
content.

The physical mount root is supplied through
`ROBOTSIM_ASSET_MOUNT_LOCAL_SAMPLES`. A release-fixture preflight must resolve
the URI and verify byte length, SHA-256, parser version, and import options
before starting browser tests. The ordinary source-only CI suite may report the
external fixture suite as skipped when this mount is absent, but the dedicated
`test:release:mrb05` gate requires it; a skipped external suite cannot satisfy
final completion.

With `occt-import-js@0.0.23` and the checked-in `STEP_IMPORT_OPTIONS`, the
source must parse successfully into:

- 49 Meshes;
- 12 hierarchy Nodes, including 10 selectable mesh-bearing component
  occurrences beneath the assembly root;
- 117,708 vertices and 140,689 triangles; and
- component-preserving groups including `LINK0_ASSY`, `LOWER_LINK_ASSY`,
  `UPPER_LINK_ASSY_STANDARD`, and `END EFFECTOR ASSY-MRB_STANDARD`.

The source is an AP214 Assembly with 36 Product records, 55 assembly
occurrences, and 25 `MANIFOLD_SOLID_BREP` records. Exact tessellation counts are
pinned to the parser version and options above; a deliberate parser upgrade
must update the fixture evidence in the same change.

The Robot Import Wizard displays the occurrence hierarchy and allows the
operator to include/exclude hardware and assign each included
`nodePath + meshIndices` occurrence to exactly one of seven rigid Links. It then
configures six revolute Joints. The MRb05 product specification supplies Joint
range and maximum-velocity evidence:

- J1/J2: -360 to +360 degrees, 180 degrees/second;
- J3: -158 to +158 degrees, 180 degrees/second; and
- J4/J5/J6: -360 to +360 degrees, 360 degrees/second.

The STEP component names and motor-like occurrences are selection evidence only.
Joint origins, axes, parent/child order, zero pose, Base, Flange, and TCP must be
entered or confirmed from mechanical evidence by the operator. The importer
does not infer those values.

For this pinned fixture, the saved source convention is `Y-Up`; the Scene
Coordinate Adapter normalizes it to the Robot domain's `Z-Up`. The operator may
preview and choose an equivalent source-root Import Rotation for another Asset,
but the fixture never applies both corrections and never asks an AI service to
guess orientation.

Before committing the Definition, Joint preview must prove that moving Jn moves
only its configured child subtree and never an ancestor. For every included
occurrence, reconstructed zero-pose World vertices must remain within 0.5 mm of
that same occurrence's source World vertices. Excluded hardware is outside this
comparison. Save/Reload and JSON/XML round-trip must retain the source digest,
occurrence ownership, link-local transforms, Mechanics, Frames, and collision
proxies.

### 14.3 Jobs and OPC UA Bindings

- `Job_A_CRB_PickPlace` belongs to `Robot_A_CRB15000` and performs Joint Pose
  movement, Close, Attach `Cup_01`, transport, Open, and Detach at
  `Place_Table`.
- `Job_B_MRb05_Inspection` belongs to `Robot_B_MRb05` and performs an
  independent ordered six-Joint Pose sequence with different per-segment
  speeds.
- The Jobs may run concurrently but contain no synchronization barrier.
- `Action_A_CloseGripper` is one reusable `set-gripper-state` Action invoked
  directly from UI and through the `Execute_Action_A_CloseGripper`
  `action-execute` Binding to prove both routes use one Action Executor.
- `Start_Robot_A_CRB_PickPlace` is an OPC UA Action Binding that starts the
  preconfigured Pick/Place Job.
- `Set_Robot_B_MRb05_J1` is an explicit OPC UA Command Mapping used to prove
  that variable Robot/Joint IDs are not tied to the CRB runtime. It is a
  one-shot command and leaves MRb05 Joint source ownership as `simulation`.
- A repeated identical Command ID cannot re-execute any command.

### 14.4 Browser Acceptance Procedure

1. Set `ROBOTSIM_ASSET_MOUNT_LOCAL_SAMPLES` to the physical Asset root without
   changing Project content.
2. Run the MRb05 release-fixture digest/parser preflight.
3. Build and start Web plus Runtime Gateway in OPC UA Server mode.
4. Wait for `/healthz`; confirm `/readyz` reports `NO_ACTIVE_REVISION` rather
   than waiting indefinitely.
5. Open the application in the Codex in-app browser.
6. Load and Apply the Heterogeneous Dual Robot Demo Project, resolve the MRb05
   Asset, and acquire the Runtime Publisher Lease.
7. Wait for `/readyz` to report the applied Revision ready.
8. Confirm the CRB15000 and MRb05 are simultaneously visible, have different
   Definitions, and are independently selectable.
9. Confirm each selected Robot displays its own Joint IDs, Mechanics, Jobs, and
   controls.
10. Use a real OPC UA test client to read both Robots' Actual Joint nodes.
11. In one OPC UA Session, stage one allowed MRb05 J1 Value, a new Command ID,
    and an expiry within 60 seconds, then write its Mapping Trigger
    `false -> true`. Verify `ACCEPTED`, terminal success, only the intended MRb05
    child subtree moves, Joint ownership remains `simulation`, and MRb05 can
    return Home.
12. Invoke `Action_A_CloseGripper` from the UI, verify the CRB Gripper closes,
    then restore it to Open.
13. With a new Command ID and valid expiry, write Trigger `false -> true` to
    `Execute_Action_A_CloseGripper`; verify `ACCEPTED`, `RUNNING -> SUCCEEDED`,
    and the same Gripper result, then restore Open.
14. Run `Job_B_MRb05_Inspection` from the browser and wait until its state is
    `RUNNING`; do not use an arbitrary delay.
15. While that Job is `RUNNING`, write a new Command ID, valid expiry, and
    Trigger `false -> true` to
    `Start_Robot_A_CRB_PickPlace`.
16. Observe in the browser that the CRB moves, `Cup_01` Attach/Detach pose
    discontinuity stays within 0.5 mm and 0.1 degree, the Object follows the
    Tool, and MRb05 state remains independent.
17. Verify the Pick/Place acknowledgement is `ACCEPTED`, its Action Result stays
    `RUNNING` until the Job ends and then becomes `SUCCEEDED`, and Attachment
    state is detached at the destination.
18. Before each result's five-minute retention ends, prove deduplication with a
    new valid delivery event: for the J1 Mapping and each Boolean Binding write
    Trigger `false`, restore its same prior Command ID and expiry, then write
    `false -> true`. Verify the stored result is returned and no command
    executes again.
19. Save and reload the Project and verify both Robot Definitions/Instances,
    MRb05 logical Asset/digest/occurrence mapping, Jobs, Action Binding, Command
    Mapping, and independent Joint configuration remain.
20. Reset Simulation and verify both Robots, Object parent, Object pose,
    Gripper states, Jobs, and Action results return to their defined reset state.

The handoff includes browser screenshots or equivalent visible evidence, OPC UA
client read/write assertions, automated test output, and exact Docker health
results. If Docker Engine, the MRb05 external Asset, or another required runtime
is unavailable, that is an explicit blocker; static-only validation is not
counted as final completion.

## 15. Verification Strategy

### 15.1 Unit Tests

- V4 schema limits, stable IDs, canonical hash, and explicit V3 rejection.
- Frame parent resolution, World pose composition, and cycle rejection.
- RPY/quaternion conversion and coordinate adapter invariants.
- Robot Definition validation for 1/16 Joints and 1/7 STEP sources.
- Job validation by Joint ID, limits, step ordering, and speed.
- Attach/Detach world-pose preservation, single owner, Reset, and error codes.
- Structure/Leaf/depth/array/update-rate budget boundaries and plus-one cases.
- XML lossless round-trip and XLSX semantic round-trip.
- Logical URI normalization, mount confinement, and digest validation.
- Session-local Command staging, expiry, 4,096-record deduplication boundaries,
  Lease fencing, and Bridge cycle rejection.

### 15.2 Integration Tests

- Two Robot Instances sharing one Definition with independent Joint state.
- One MRb05 Assembly STEP import preserving 10 selectable occurrence groups,
  grouping those occurrences into seven Links, configuring six Joints, and
  proving child-subtree motion within the included-occurrence 0.5 mm Geometry
  reconstruction gate.
- A dedicated external-fixture Release suite that requires the configured
  `local-samples` mount and fails preflight on missing bytes, digest mismatch,
  parser drift, or import-option drift; ordinary CI reports this suite's skip
  separately.
- Heterogeneous CRB15000 and MRb05 Instances with independent RobotDefinition,
  Joint, Job, selection, collision, and OPC UA state.
- Namespaced multi-Robot collision proxies, per-Robot adjacency exclusions,
  intentional mount contact, and attached Tool/Object contact exclusion.
- Robot mounted beneath a Moving Frame without duplicate Base ownership.
- Eight mock Endpoint workers with one disconnect/reconnect failure.
- OPC UA Client Subscription quality, timestamp, sequence, and coherence.
- OPC UA Server Actual/Command separation and Action Binding execution.
- Two OPC UA Client Sessions interleaving Command ID/Value writes to the same
  Mapping without cross-Session snapshots, plus 16/17 Session boundaries.
- Exactly 4,096 active deduplication records pass; a 4,097th command is rejected
  without evicting an active result, then succeeds after an eligible record is
  pruned.
- UI and OPC UA `action-execute` invocation of the same reusable Action, plus
  `job-start` acknowledgement separated from terminal Job completion.
- Bridge route forwarding without echo.
- Asset resolve, managed import, missing source, and digest mismatch in `Off`
  and `Server` modes.
- Slow WebSocket latest-wins behavior and bounded interpolation buffers.
- Save/load of Robot Jobs, Actions, Bindings, and Asset references.
- A Playwright fixture that starts both Vite and the Runtime Gateway, plus a
  `node-opcua` client in the test process. Browser UI evidence alone is not
  accepted as proof that the OPC UA TCP Server works.
- Server startup readiness ordering: live before Apply, not-ready with
  `NO_ACTIVE_REVISION`, then ready only after Project Apply and Lease acquisition.

### 15.3 Performance and Docker Gates

| Gate | Pass criterion |
|---|---:|
| Reference Scene | no more than 1.5M visible triangles |
| Browser p95 frame interval | <= 33.4 ms |
| Browser heap | <= 768 MiB |
| Runtime Gateway allocation | 1 CPU / 512 MiB |
| Additional Gateway processing latency | p95 <= 50 ms |
| Interpolation delay at 100 ms publishing | approximately 200 ms |
| Maximum mapping load | 10,240 leaf-updates/sec for at least 15 minutes |
| Queue behavior | bounded latest-wins, no historical growth |
| OPC UA modes | Off, Client, Server, and Bridge Compose smoke tests |

Docker tests cover Nginx SPA fallback, `/healthz`, pre/post-Apply `/readyz`,
WebSocket Upgrade, Asset resolution, OPC UA Server port exposure, and orderly
shutdown. Gateway readiness reports Revision and mode state separately from
process liveness.

## 16. Success Criteria

The work is complete only when all of the following are true:

1. Exactly eight Robot Instances pass and a ninth is rejected; one and sixteen
   Joints pass per Definition and zero/seventeen fail.
2. A Robot imported from one assembly STEP can map several Links and Joints
   manually. One and seven STEP sources pass; zero/eight fail. Source count does
   not alter Joint count.
3. The exact MRb05 external Asset parses into the pinned hierarchy/Geometry
   fixture, applies the saved `Y-Up` convention, maps to seven Links and six
   operator-confirmed Joints, and completes Joint Jog, Job, OPC UA Read/Write,
   Save/Reload, and Reset without becoming a rigid Object.
4. Two Robots sharing one Definition render and execute independent Jobs without
   state, selection, or OPC UA crosstalk.
5. The heterogeneous CRB15000 and MRb05 final fixture renders and executes
   independent Jobs without Definition, Joint, selection, collision, or OPC UA
   crosstalk.
6. A Robot Base mounted to a Moving Frame follows that Frame and maintains one
   authoritative transform path.
7. The 128th imported Object STEP Asset passes and the 129th fails before active
   mutation. Primitive Objects do not consume STEP source count.
8. Eight OPC UA Endpoints operate concurrently and failure of one does not stop
   healthy Endpoint state or writes. Sixteen OPC UA Server Client Sessions pass
   and a seventeenth is rejected without disturbing active Sessions.
9. Off, Client, Server, and Bridge work as specified; Server publishes accepted
   original state rather than browser interpolation.
10. The exact 128 Structure, 1,024 Leaf, and 10,240 updates/second boundaries
    pass, while each plus-one case fails before activation. Exactly 4,096 active
    Command deduplication records pass and a 4,097th is rejected without
    eviction.
11. A stale Lease generation cannot publish state, write upstream, or execute an
   Action. An observer can continue reading.
12. Bridge routes do not echo their own output.
13. `JSON -> XML -> JSON` preserves canonical hash, and XLSX mapping round-trip
    preserves semantic Mapping configuration.
14. Logical Assets resolve across configured Windows/Linux/Docker mounts without
    changing Project content. Missing and mismatched Assets fail locally without
    destroying the Project.
15. UI and OPC UA `action-execute` trigger the same reusable Action behavior;
    `job-start` acknowledgement and terminal Job result remain distinct.
16. Pick/Place attaches one explicit Object, preserves pose at Attach/Detach,
    follows the Tool, rejects double Attach, and Reset restores initial state.
17. Multi-Robot collision IDs cannot alias, and intentional Tool/Object or Base
    mount contact does not suppress unrelated collision findings.
18. The Heterogeneous Dual Robot OPC UA Pick/Place Demo completes the browser
    acceptance procedure, including MRb05 single-source resolution, OPC UA
    Joint Read/Write, Action write, Command deduplication, two different visible
    Robots, independent Sample Jobs, Save/Reload, and successful Reset.
19. Automated tests, production build, Docker smoke tests, performance gates,
    required external-fixture Release tests, and browser evidence all pass.
    Static validation or a skipped MRb05 suite is insufficient.

## 17. Delivery Decomposition

This is one approved target architecture, delivered through bounded milestones:

1. **Contracts:** Project V4, Core validators, versioned protocols, and boundary
   tests.
2. **Multi-Robot Runtime:** Definitions, Instances, keyed stores, Frame graph,
   per-Robot Jobs, and rendering.
3. **Robot/Asset Authoring:** variable-Joint Geometry mapping, logical Asset
   resolver, managed import, grouping, and missing-Asset recovery.
4. **Gateway Client:** multiple Endpoint Subscriptions, state batches,
   interpolation, quality, and backpressure.
5. **Gateway Server/Bridge:** Information Model, commands, Lease, writes,
   Action Bindings, results, and Bridge loop prevention.
6. **Interchange:** XML and XLSX adapters with preview and atomic apply.
7. **Pick/Place:** shared Action Executor, Attachment constraints, Job actions,
   OPC UA triggers, and Reset behavior.
8. **Release Demo:** heterogeneous CRB15000/MRb05 Sample Project, MRb05
   single-Assembly Asset fixture, Docker profiles, OPC UA test client, in-app
   browser verification, `test:release:mrb05`, performance run, and operator
   docs.

Each milestone must keep the production build and existing applicable tests
green. The implementation plan will identify file-level tasks and commit gates;
it must not treat the final Demo as optional polish.

## 18. Reference Standards

- OPC UA `OperationLimitsType`:
  <https://reference.opcfoundation.org/Core/Part5/v105/docs/6.3.11>
- OPC UA `ServerCapabilitiesType`:
  <https://reference.opcfoundation.org/Core/Part5/v105/docs/6.3.2>
- OPC UA Structured Types and ExtensionObject:
  <https://reference.opcfoundation.org/specs/OPC-10000-6/5.1.8>
- OPC UA `3DFrame`:
  <https://reference.opcfoundation.org/specs/OPC-10000-5/12.30>
- Savvy Robotics MRb05 product specification:
  <https://savvy-robotics.com/en/portfolio/mrb05-en/>
