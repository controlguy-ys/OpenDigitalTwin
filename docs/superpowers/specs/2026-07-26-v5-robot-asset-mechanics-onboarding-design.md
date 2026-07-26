# Project V5 Robot Asset and Mechanics Onboarding Design

**Date:** 2026-07-26

**Status:** Approved design, pending written-spec review

**Target:** `main` at baseline `1a8844d`

## 1. Goal

Complete one reusable Project V5 workflow in which an operator can import an
Object STEP or a heterogeneous serial Robot, inspect the actual geometry,
deterministically define its mechanics, preview the result, and publish it
without compromising the active Project, browser runtime, or Runtime Gateway.

The completed workflow is:

```text
Select STEP sources
-> resolve and stage immutable Asset content
-> parse and inspect actual Geometry
-> define Link, Joint, and Frame mechanics
-> preview actual Mesh motion
-> review Project dependencies and budgets
-> atomically publish Project, runtime, Gateway, and Asset leases
-> save, reload, export, import, or relink
```

This milestone closes the current gap between the strong Project V5 runtime and
the proxy-only V5 viewport. It does not broaden the product into physics,
automatic Robot inference, or manufacturer-specific programming.

## 2. Current Baseline

The active application already has the following authoritative foundations:

- Project V5 is the only active browser Project format.
- Robot Definitions and Robot Instances are separate and support multiple
  instances of one reusable Definition.
- Generic serial kinematics supports one through sixteen revolute or prismatic
  Joints with arbitrary origins, axes, limits, Home, direction, zero offset,
  and maximum velocity.
- Fixed Joints are accepted by the authoring draft and collapsed before the
  canonical Robot Definition is created.
- Manifest and already-resolved URDF adapters, assembled-Home alignment, and
  shared-Definition impact analysis exist.
- Project persistence, browser runtime preparation, and Runtime Gateway
  activation use an atomic publication coordinator.
- OPC UA Client, Server, and Bridge roles, Object and Robot mappings, Jobs,
  attachments, signals, commands, and World-pose resolution are already part of
  the V5 runtime.

The active viewport does not resolve referenced STEP content. Asset Objects and
Robot Geometry occurrences are displayed as collision boxes, wireframe boxes,
or spheres. The active Model surface also lacks Robot/Object STEP import,
Mechanics editing, and relinking.

## 3. Approved Product Decisions

1. Asset storage uses a hybrid model. Project JSON stores immutable Asset
   identity and metadata; browser storage may cache source bytes and prepared
   Geometry by SHA-256.
2. Project export does not embed STEP bytes. The Project's `assetReferences`
   remain its Asset manifest.
3. Absolute operating-system paths are not persisted. `uri` is a logical or
   relative identity, while `sourceFileName` remains operator-facing metadata.
4. Missing cached content does not invalidate the Project, mechanics, Jobs, or
   OPC UA runtime. It creates a recoverable unresolved visual state.
5. Object import consumes one complete STEP source per Object.
6. A Robot Definition consumes one through seven STEP sources independently of
   its one through sixteen controllable Joints.
7. A single STEP Assembly can define a multi-Link Robot when it exposes
   separable Assembly occurrences. A completely fused Solid is not split
   automatically.
8. STEP names, dimensions, component count, AI, and external APIs do not infer
   authoritative Joint mechanics.
9. Individual Asset complexity produces a warning, not an import rejection.
   The approved Project-wide byte and visible-Triangle budgets are the only hard
   Asset-complexity admission limits. Existing structural cardinality limits,
   including Robot source, Robot Instance, spatial entity, and Job counts,
   remain unchanged.
10. Actual Meshes, collision proxies, and Frame markers use the same Project V5
    World resolver. Rendering does not implement a second kinematics path.
11. Import orientation and origin correction remain editable Definition
    metadata after Apply. They are not discarded after being materialized into
    runtime `linkLocalPose` values.

## 4. Scope

### 4.1 Included

- content-addressed STEP source persistence and relinking;
- cancellable STEP parsing through the existing OCCT Web Worker boundary;
- actual Object and per-Link Robot Mesh rendering;
- deterministic placeholders for loading, missing, and failed Assets;
- immutable Geometry sharing with instance-isolated mutable presentation state;
- Object STEP import;
- Robot STEP import from one through seven sources;
- Manifest, resolved-URDF, and Manual Mechanics authoring;
- source unit and orientation correction;
- Assembly occurrence-to-Link mapping;
- Joint, Link, Base, Flange, Tool0, TCP, and custom Frame review;
- local preview, dependency impact review, cancellation, and atomic Apply;
- Project-wide Asset performance admission and deterministic diagnostics;
- Save, reload, export, import, and relink acceptance.

### 4.2 Explicit non-goals

- automatic decomposition of a fused Solid;
- AI or API-based Joint, pivot, or Link inference;
- inverse kinematics or Cartesian path planning;
- physics, dynamics, or physics-based collision;
- manufacturer Robot-code generation;
- coordinated multi-Robot scheduling;
- arbitrary branched movable mechanisms;
- ACOPOStrak-style moving-carrier topology;
- a self-contained Project ZIP containing all STEP sources;
- TLS, certificates, authentication, or other security expansion;
- restoration of every V4 ribbon, dock, theme, and context-menu feature.

## 5. Asset Identity and Persistence

The existing `AssetReferenceV5` remains the canonical Project identity:

```text
AssetReferenceV5
├─ id
├─ logical uri
├─ sha256
├─ byteLength
├─ sourceFileName
└─ mediaType = model/step
```

The Project never stores a browser file handle, absolute path, Blob URL, parsed
Three.js object, or staging token. Those values are environment-specific
resources and cannot be part of deterministic Project JSON.

`AssetContentRepositoryV5` owns immutable source bytes outside the Project:

```text
SHA-256
├─ exact source bytes
├─ byte length
├─ cache timestamps
├─ staging owners
└─ live preview/runtime leases
```

Two Asset references with the same SHA-256 share one content record. Every
reference with that hash must declare the same byte length and media type.
Project referenced-byte accounting also counts a unique SHA-256 only once. A
Robot Definition uses a given Asset Reference ID at most once; placing the same
source content twice requires two distinct Asset References, which may still
share the content hash.

Relink accepts replacement bytes only when their SHA-256 and byte length match
the existing reference. Selecting different content starts a new Asset import
and creates a new reference through normal Project publication; it never
silently changes the meaning of an existing hash.

Browser cache contents are not active application state. A failed or cancelled
operation may leave unreferenced immutable bytes until bounded garbage
collection removes them. It may not leave an active Geometry lease, Project
reference, or Runtime registration. Cache retention is derived by scanning
durable retained Project revisions plus live staging and runtime leases; a
separate cache-owner pointer never competes with the Project pointer for
authority.

The application cache ceiling is:

```text
min(1 GiB, floor(70% of navigator.storage.estimate().quota))
```

When quota estimation is unavailable, the conservative ceiling is 512 MiB. GC
runs before staging, after cancellation or failed publication, after Project
deletion, and whenever cached bytes exceed 80 percent of the ceiling. It evicts
only records without a live staging/preview/runtime lease, in this order:

1. content not referenced by any retained Project revision, oldest access first;
2. content referenced only by non-active retained Projects, oldest access first.

Content referenced by the active Project is not automatically evicted. Access
timestamps influence only GC order and never Project authority. If GC cannot
make room for the pending exact bytes, staging fails with
`ASSET_CACHE_QUOTA_EXCEEDED`; no candidate Project is created and all partial
staging records are removed.

Robot Definition authoring adds persisted, non-runtime Geometry provenance:

```text
RobotGeometryAuthoringV1
├─ alignmentMode = link-local | assembled-home
├─ sourceRootToRobotBaseByAssetId
│  └─ AssetReferenceId -> rigid transform
├─ baseToGroundOffsetM
└─ occurrenceInventoryByAssetId
   └─ parserContractVersion, occurrenceCount, occurrenceKeyDigest
```

`RobotDefinitionV5` gains the backward-compatible optional field
`geometryAuthoring?: RobotGeometryAuthoringV1`. The closed-record validator is
expanded to accept either absence or a valid object; it does not inject a new
key while decoding an unchanged document. Existing Project V5 byte round trips
therefore remain unchanged. New Robot import and confirmed Mechanics Apply
always write the field. A Definition without it remains runtime-valid, but
reopening its Geometry mapping requires reselecting and reviewing the
exact-hash sources before Apply; the application does not invent missing
provenance.

For an assembled source, the transform rigidly places each already
unit/Up-axis-normalized source root in Robot Base coordinates at Home. For
link-local sources, it records the normalized source-root placement that was
used to derive each occurrence's final Link-local pose.
The renderer continues to consume only canonical `linkLocalPose`; it does not
apply this authoring transform again. Persisting the provenance makes later
Mechanics editing, Save/reload, and Base-motion verification deterministic.

The STEP adapter derives a canonical zero-based child/mesh ordinal path, never
from optional STEP names. Persisted occurrence IDs are fixed-length,
Project-safe identifiers:

```text
occ_<source-use-digest-16>_<path-digest-32>
```

`source-use-digest` hashes the Asset Reference ID. `path-digest` hashes parser
contract version plus the canonical ordinal path. The ID contains only
lowercase ASCII letters, digits, and underscore and remains below the current
128-byte identifier limit. Two Asset References for the same content therefore
produce distinct occurrence IDs, while exact reload/relink of one reference is
stable. The sorted complete key set is hashed into `occurrenceKeyDigest`.

At Apply, the union of mapped occurrence keys and
`excludedGeometryOccurrenceKeys` must equal the prepared inventory exactly,
with no duplicates. On exact-hash Relink, the parser contract version, count,
and inventory digest must match before the Asset becomes `ready`. A parser
upgrade that changes inventory identity requires an explicit re-import and
review; it cannot silently remap Link Geometry.

## 6. Asset Preparation and Atomic Publication

### 6.1 Preparation

One import session owns an abort generation and performs these phases:

1. validate extension, positive byte length, and duplicate selections within
   the pending file set;
2. compute SHA-256, deduplicate against staged and cached content, and evaluate
   aggregate Project byte feasibility using unique hashes;
3. stage exact bytes and send a transferable copy to the existing OCCT worker;
4. validate the parse result and derive Geometry statistics;
5. build collision proxies and a prepared Geometry template;
6. expose the prepared template only to the import preview;
7. materialize and validate the complete candidate Project;
8. request one atomic Project publication.

The parser queue has concurrency one. This prevents concurrent OCCT/WASM jobs
from multiplying peak memory. Cancellation terminates the active worker,
invalidates late results, releases preview leases, and recreates a clean worker
for the next request.

### 6.2 Publication boundary

Asset preparation is part of the existing prepared browser Runtime candidate,
not a fourth top-level coordinator participant and not a post-commit repair.
`runtime.prepare()` returns a candidate bundle that owns all candidate Geometry
generations, unresolved-Asset states, and leases. Its existing
prepare/apply/commit/rollback lifecycle therefore governs Renderer resources:

```text
Prepare candidate Project revision
-> prepare browser Runtime and Geometry generations
-> prepare Gateway activation
-> apply candidate Runtime resources without publishing them to readers
-> activate the candidate Gateway revision
-> durably commit the Project revision
-> commit the matching Runtime and Geometry-lease transition
-> finalize the durable publication
-> release the previous Runtime epoch after the swap
```

Staging tokens never appear in Project JSON. If any prepare, durable commit, or
activation step fails, the candidate runtime and candidate Geometry leases are
released, staged ownership is revoked, and the coordinator follows its existing
compensation or recovery-required path so Project, browser runtime, Renderer,
and Gateway authority cannot be reported as a mismatched stable revision.

The Project repository remains the only durable publication authority. Startup
reconciliation uses its existing revision pointer and commit token together
with Runtime/Gateway status. After a browser restart, in-memory Geometry leases
do not survive; hydration reacquires available content for the authoritative
Project or publishes an unresolved visual state. It never chooses the newest
cache record by timestamp.

New imports require every selected source to be prepared successfully before
Apply. Opening an already valid Project is different: a missing visual source
is recoverable and does not block Project or Gateway activation.

## 7. Runtime Geometry Repository

`GeometryRepositoryV5` has two cache levels:

```text
Parsed source key       = SHA-256
Prepared template key   = SHA-256 + canonical SourceConvention + originMode
```

The parsed source can be reused across different placements. A prepared
template includes normalized unit/orientation handling and immutable renderable
Geometry. `originMode` is `source` for Robot sources and is the Project-declared
`source | center` choice for Object Assets. Robot occurrence `linkLocalPose` and
Object local pose remain Project data rather than being baked into shared
Geometry.

Each visible Robot or Object acquires a lease:

- immutable `BufferGeometry` may be shared;
- mutable Object3D hierarchy, Material, visibility, selection, and highlight
  state are instance-local;
- duplicate Robot Instances cannot change each other's presentation state;
- release is idempotent;
- Materials and instance-owned objects are disposed when their lease ends;
- shared Geometry is disposed only after the final generation lease is
  released.

The renderer preserves one Canvas for normal loading and component-level
failures. An Asset-level error boundary replaces only an occurrence whose
Geometry construction or component rendering fails. WebGL context loss is a
viewport-level event: the application pauses rendering, preserves Project
state, displays a recovery overlay, and may rebuild the Canvas once after the
browser reports context restoration. GPU out-of-memory cannot be guaranteed to
remain occurrence-local and is mitigated by admission budgets rather than
described as a recoverable Asset error.

## 8. Rendering and Coordinate Authority

The transform chain is:

```text
WorldResolver
-> Robot Link World Pose or Object World Pose
-> Geometry occurrence linkLocalPose or Object Geometry origin
-> actual Mesh
```

Actual Mesh, collision proxy, and Frame marker must use this same resolved pose.
The renderer does not evaluate Joint origins, offsets, or axes and does not
apply import orientation a second time.

Asset presentation states are:

- `loading`: bounded neutral placeholder and progress;
- `ready`: actual Mesh;
- `missing`: deterministic proxy plus Relink action;
- `hash-mismatch`: proxy plus mismatch diagnostic, with no activation;
- `parse-failed`: proxy plus retry/replace diagnostic;
- `render-failed`: occurrence-local error placeholder.

Collision boxes remain available as a separate diagnostic layer and fallback.
They are not a substitute for a successfully resolved visual Asset.

## 9. Object STEP Import

Object import treats one STEP source as one rigid Object:

1. select and prepare one STEP;
2. review units, source orientation, origin mode, Geometry statistics, and
   warnings;
3. enter name, group, local XYZ/RPY, and initial numeric Status;
4. preview the actual Mesh;
5. Apply through one atomic Project mutation.

The imported Object retains the normal Project V5 capabilities for manual or
OPC UA-owned XYZ/RPY, numeric status, visibility, grouping, moving Frames, and
future grasp Frames. Import does not create those optional mappings
automatically. Initial visibility is `true` and the default parent is MCP;
existing Scene editing can change them after import.

## 10. Robot Import and Mechanics Authoring

The active Model surface exposes:

```text
Import Object STEP
Import Robot
Robot Mechanics
Relink Asset
```

Robot import uses one scrolling staged Dialog. Advanced fields may collapse,
but every value required for deterministic mechanics remains directly
inspectable and editable.

### 10.1 Source

- select one through seven STEP sources;
- optionally select one Mechanics Manifest or already-resolved URDF;
- parse each source and display its Assembly/occurrence tree;
- report either `Rig-capable` with the separable occurrence count or
  `Rigid-only` when no supported separable structure exists.

Xacro execution, shell commands, package resolution, and network retrieval are
outside the browser adapter. A resolved URDF caller supplies already-expanded
XML and pre-resolved Geometry occurrence bindings.

### 10.2 Orientation and units

The operator chooses:

- source linear unit: millimetre, centimetre, metre, or inch;
- source Up axis: X, Y, or Z;
- deterministic rotation preset axis X/Y/Z and angle at plus/minus 90 degrees
  or 180 degrees;
- optional Manual RPY correction;
- the assembled Robot Base origin and ground reference.

All authoring paths enforce the canonical conversion factors:
millimetre `0.001`, centimetre `0.01`, metre `1`, inch `0.0254`, and the
already-supported external Project value foot `0.3048`. The active UI offers
the approved first four choices. A declared `linearUnit` with a different
`sourceToMeters` value is invalid, and every root-rotation quaternion is
normalized through the common rigid-transform validator.

The transform convention uses right-handed column vectors and separates source
normalization from the persisted rigid adjustment:

```text
R_up:
  Z-Up -> identity
  Y-Up -> +90 degrees about X
  X-Up -> -90 degrees about Y

N(p_raw) = R_up * (sourceToMeters * p_raw)

R_manual = Rz(yaw) * Ry(pitch) * Rx(roll)
R_adjust = R_manual * R_preset
t = -R_adjust * N(selectedBaseOrigin)

sourceRootToRobotBase(q_normalized) = R_adjust * q_normalized + t
T_rawSourceToRobotBase(p_raw) = sourceRootToRobotBase(N(p_raw))
```

Manual RPY is intrinsic Z-Y-X, displayed as Roll/Pitch/Yaw in degrees.
`R_preset` rotates about Robot Base axes after Up-axis normalization. Only
`R_adjust` and `t` are persisted in `sourceRootToRobotBaseByAssetId`; unit scale
and `R_up` remain in `SourceConvention`. The selected Base origin therefore
maps exactly to Robot Base `[0, 0, 0]` without normalization being applied
twice.

The selected ground point is transformed by the same equation.
`baseToGroundOffsetM` stores its resulting Z relative to Robot Base and
sets the new Robot Instance's default local Base Z to the negated offset so the
selected ground reference starts at World Z zero. It does not introduce a
second Geometry transform. For multiple sources, one source is the alignment
master and the remaining source-root transforms are reviewed relative to that
same Robot Base.

The correction is represented through canonical source convention,
`sourceRootToRobotBaseByAssetId`, and assembled occurrence poses, then
materialized into link-local Geometry poses. It is separate from each Robot
Instance's `localBasePose`. Moving a Robot in the cell therefore does not change
its import correction.

Non-uniform Mesh scaling is not allowed. Mechanical dimension changes use Joint
origin translations and explicit Geometry-local poses. Import unit conversion
is the only Geometry-wide scale operation.

### 10.3 Link and Joint mapping

- create and order Link identities;
- assign each selected STEP occurrence to exactly one Link;
- explicitly exclude unused occurrences;
- create one through sixteen revolute, prismatic, or draft-only fixed Joints;
- define parent and child Link for each Joint;
- reject movable branching, disconnected movable chains, and cycles;
- collapse fixed Joints before canonical Project validation.

The one-through-sixteen limit applies after fixed-Joint collapse to controllable
revolute and prismatic Joints. Fixed draft Joints do not consume that limit but
remain bounded as follows:

- Manifest or resolved-URDF input: at most 1,048,576 UTF-8 bytes;
- JSON/XML nesting depth: at most 64;
- XML elements: at most 4,096;
- draft Links: at most 256;
- draft Joints: at most 255;
- Geometry occurrences in one Robot Definition: at most 4,096.

These checks run before dependency analysis or preview construction. Fixed-only
branches cannot bypass the draft Link, Joint, input-size, or occurrence limits.

A single STEP with seven separable Assembly occurrences can be mapped to a
six-axis Robot. A single fused Solid cannot be animated as separate Links in
this milestone and is offered as a rigid Object or rejected with guidance to
provide a separable Assembly/source set.

### 10.4 Mechanics

Each draft Joint provides:

- parent and child Link;
- origin XYZ/RPY;
- axis XYZ;
- lower and upper limit;
- Home;
- direction;
- zero offset; and
- maximum velocity.

Origin translations use millimetres in the UI and metres canonically.
Revolute limit, Home, and zero-offset fields use degrees, while revolute
velocity uses degrees per second. Prismatic limit, Home, and zero-offset fields
use millimetres in the UI and metres canonically, while prismatic velocity uses
millimetres per second in the UI and metres per second canonically. Orientation
fields use degrees in the UI and normalized quaternions canonically. A
near-zero axis, non-finite value, reversed limits, Home outside limits, or
non-positive maximum velocity blocks Apply. Preview shows the normalized axis
as an arrow and never hides the canonical value that will be applied.

New authoring accepts `manual`, `manifest`, `resolved-urdf`, or deterministic
`datasheet` preset mechanics provenance. A Datasheet preset must already
provide every required numeric field; this scope does not parse, OCR, or infer
values from a PDF. New authoring does not create STEP-estimated mechanics.

### 10.5 Frames

The canonical Definition has exactly one Base Frame parented to the root Link
with an identity local pose, exactly one Flange Frame parented to the terminal
Link, and exactly one Tool0
Frame parented to Flange. It has at least one TCP Frame and may have multiple
Tool, TCP, and custom Frames. Each TCP is parented to Tool0, a Tool, or another
explicit Definition-local Frame without cycles. A Robot Instance's selected
Tool must have role `tool0` or `tool`, and its selected TCP must have role
`tcp`.

Geometry endpoints do not implicitly define TCP. Duplicate Base, Flange, or
Tool0 roles, invalid role parentage, and order-dependent Frame selection are
rejected.

These stricter cardinality rules apply when a Definition is created or confirmed
through the new Mechanics authoring service. Loading an existing Project V5
Definition without Flange or Tool0 remains valid. Opening such a Definition in
the Mechanics Dialog reports the missing roles and requires the operator to add
and preview them before Apply; no silent Frame insertion or ID rewrite occurs.
Existing Tool/TCP IDs and OPC UA Frame targets remain unchanged unless the
operator explicitly edits them.

### 10.6 Preview and impact review

Preview uses local draft ownership and candidate-only Geometry leases. It
provides:

- Home and per-Joint Jog;
- limit-end preview;
- selected Link highlighting;
- Joint axis and pivot markers;
- assembled/zero-pose ghost comparison; and
- calculated TCP display.

Before Apply, impact analysis lists every Robot Instance using the Definition
and any affected Job, saved Joint value, Frame mapping, or OPC UA Joint target.
An unresolved conflict blocks publication instead of clamping or silently
dropping dependent data.

Preview, Back, and Cancel never change the active Project revision.

## 11. Performance Admission

The individual limits that are currently hard failures become authoring
warnings:

- Object warning: over 50 MiB or 250,000 Triangles;
- Robot Definition warning: over 100 MiB or 600,000 Triangles.

Crossing a warning threshold requires one explicit acknowledgement in the
Review stage before Apply becomes available. The acknowledgement belongs to the
pending authoring session and is not persisted in Project JSON.

This is an intentional Core contract change. Per-Object and per-Robot byte and
Triangle checks move out of canonical Project rejection and into the authoring
diagnostic service. The Robot mechanics materializer follows the same policy.
Their existing constants remain as warning thresholds, and existing tests that
expect per-Asset rejection are replaced with warning/acknowledgement tests.
Canonical Project validation retains structural cardinality limits and the two
aggregate hard budgets. Aggregate referenced bytes are changed from unique
Asset IDs to unique SHA-256 content identities.

The hard Project limits remain:

```text
Unique referenced STEP bytes <= 512 MiB
Visible rendered Triangle cost <= 3,000,000
```

Referenced bytes count unique SHA-256 values. Visible Triangle cost counts every
visible Geometry occurrence and Robot Instance because shared GPU buffers do
not remove per-instance draw and shading cost. Hidden Robots, hidden Objects,
and groups hidden through their effective visibility contribute zero visible
Triangles but continue to count referenced source bytes.

Triangle statistics use one canonical rule:

- indexed triangle Mesh: `index.count / 3`;
- non-indexed triangle Mesh: `position.count / 3`;
- Material groups do not duplicate the underlying triangles;
- Lines, Points, helpers, Frame markers, and collision-proxy diagnostics
  contribute zero to the visual Asset budget;
- Project Box and Cylinder primitives use their existing declared constants;
- each visible occurrence or Robot Instance multiplies the applicable source
  count once;
- frustum culling and occlusion do not reduce admission cost.

The exact equation is:

```text
ObjectCost =
  sum(effective-visible primitive constants)
  + sum(effective-visible Asset Object geometry.statistics.triangles)

RobotCost =
  sum(for each visible Robot Instance:
    sum(all Geometry occurrences in its Robot Definition:
      occurrence.statistics.triangles))

VisibleTriangleCost = ObjectCost + RobotCost
```

An occurrence contributes once inside each visible Robot Instance that uses its
Definition. It is not added once globally and then multiplied again.

Counts must be finite, non-negative integers after division. Prepared content
statistics must match the Project candidate before Apply; a missing source on
later reopen uses the previously validated persisted statistics for admission.
A visible unresolved Asset therefore has the same Triangle cost with or without
cached bytes. Exact-hash Relink reparses the source and must reproduce the
persisted statistics and occurrence inventory before the Asset becomes
`ready`; mismatch requires explicit re-import and review.

The same admission rule applies when import, visibility, grouping, or Robot
Instance count changes. Enabling visibility that would exceed the limit is
rejected before the active Project changes and reports the exact excess and
largest contributors.

Visible Assets are prepared first when a Project opens. Hidden Assets remain
unparsed until preview, visibility enablement, relink, or another explicit use.
Collision proxies and mechanics are available before a visual Mesh resolves.

The 3,000,000-Triangle value is a safety ceiling, not the recommended scene
size. The release reference workload is two Robots plus ten Objects between
900,000 and 1,000,000 visible Triangles. On the project owner's recorded demo
machine,
that workload must sustain a median of at least 30 frames per second in Chromium
at a 1440 by 900 viewport. The committed performance scenario uses a fixed
20-second camera orbit and deterministic Joint trajectory, discards a 5-second
warm-up, and computes frame rate from `requestAnimationFrame` timestamps over
the remaining 15 seconds. The evidence records fixture revision, device,
browser version, scene statistics, raw sample count, sample duration, and
median frame rate. This hardware-recorded gate is separate from deterministic
CI correctness tests.

## 12. Error Model and Recovery

Stable diagnostic codes distinguish operator-correctable conditions:

| Stable code | Condition | Invariant and recovery |
|---|---|---|
| `ASSET_FILE_UNSUPPORTED` | unsupported file | reject before staging |
| `ASSET_CONTENT_DEDUPLICATED` | duplicate selected content | reuse the hash and report deduplication |
| `ASSET_HASH_MISMATCH` | mismatch during Relink | reject Relink; offer explicit new import |
| `ASSET_GEOMETRY_STATISTICS_MISMATCH` | exact-hash parse disagrees with persisted Geometry contract | keep unresolved; require explicit re-import/review |
| `ASSET_STEP_PARSE_FAILED` | STEP parse failure | fail only that source; allow retry or replacement |
| `ASSET_WORKER_FAILED` | Worker failure | recreate the Worker; preserve active Project |
| `ASSET_CACHE_QUOTA_EXCEEDED` | cache cannot stage exact bytes after GC | remove partial staging; preserve active Project |
| `ROBOT_MECHANICS_INVALID` | invalid Mechanics | identify Joint and field; block Apply |
| `ROBOT_TOPOLOGY_UNSUPPORTED` | unsupported movable branch | retain draft and report serial-chain scope |
| `PROJECT_ASSET_BYTE_BUDGET_EXCEEDED` | unique byte excess | report exact excess and main contributors |
| `PROJECT_VISIBLE_TRIANGLE_BUDGET_EXCEEDED` | visible Triangle excess | report exact excess and main contributors |
| `PROJECT_PUBLICATION_FAILED` | publication or Gateway failure | release candidate leases and preserve or reconcile authority |
| `ASSET_CONTENT_MISSING` | source missing on reopen | activate Project with proxy and Relink state |
| `ASSET_RENDER_FAILED` | Mesh/render failure | replace only the failed occurrence |

Every diagnostic uses one closed payload:

```text
AssetOnboardingDiagnosticV1
├─ code
├─ severity = info | warning | error
├─ path
├─ message
├─ recoveryActions[]
├─ assetReferenceId?
├─ robotDefinitionId?
├─ jointId?
├─ limit?
├─ actual?
├─ excess?
└─ contributors[] = { kind, id, name, cost }
```

Numeric values use the canonical unit of the validated field. Contributors are
sorted by descending cost and then stable ID. Multiple diagnostics are sorted
by severity, path, code, and stable target ID so the same candidate produces
the same result. Each `recoveryActions` entry is a stable action identifier, not
translated display prose.

The initial recovery-action vocabulary is closed:

```text
none
reselect-file
relink-exact
import-as-new
retry-parse
edit-mechanics
provide-separable-source
import-rigid-object
clear-unreferenced-cache
reduce-scene-cost
reload-project
open-recovery
```

File rejection maps to `reselect-file`; deduplication to `none`; hash or
statistics mismatch to `import-as-new`; missing content to `relink-exact`;
parse/Worker failure to `retry-parse`; cache quota failure to
`clear-unreferenced-cache` and `reduce-scene-cost`; mechanics failure to
`edit-mechanics`;
unsupported topology to `provide-separable-source` and
`import-rigid-object`; budget excess to `reduce-scene-cost`; component render
failure to `reload-project`; and an unreconciled publication to
`open-recovery`. A publication that was fully compensated requires no recovery
action. Adding an action or changing a mapping is a versioned diagnostic
contract change.

Dialogs present stable codes and actionable messages. Raw worker, WebAssembly,
Three.js, database, or Gateway stack text is retained for diagnostics but is
not used as the primary operator message.

## 13. Verification and Acceptance

### 13.1 Unit and integration coverage

- source hashing, deduplication, staging ownership, retained-Project scanning,
  garbage collection, and idempotent preview/runtime lease release;
- cache-ceiling calculation, deterministic eviction order, injected quota
  exhaustion, and partial-staging cleanup;
- parser serialization, cancellation, worker recreation, and ignored late
  replies;
- source-convention canonicalization and prepared-template cache keys;
- occurrence-key stability, complete mapped/excluded inventory, and parser
  contract/digest mismatch rejection;
- shared BufferGeometry with isolated mutable Materials and instance state;
- component-level Asset error containment and one persistent Canvas during
  normal/component-failure operation;
- Project-wide unique-byte and visible-instance Triangle accounting;
- soft per-Asset warnings and hard aggregate rejection;
- Manual, Manifest, and resolved-URDF candidates;
- deterministic Datasheet preset candidates without PDF inference;
- fixed-Joint collapse and unsupported branch/cycle rejection;
- required Frame role cardinality, parentage, and selected Tool/TCP role checks;
- assembled-Home occurrence alignment;
- dependency conflicts;
- publication failure injection and complete rollback;
- exact Triangle-admission boundaries at 3,000,000 and 3,000,001;
- exact referenced-byte boundaries at 512 MiB and 512 MiB plus one byte,
  same-hash deduplication, and hidden-Asset byte accounting;
- identical Triangle admission with a cached or unresolved visual source;
- stable diagnostic-code invariants and their documented recovery action.

### 13.2 Browser acceptance

The release adds focused V5 browser scenarios for:

1. importing one complete Object STEP and displaying its actual Mesh;
2. importing a single STEP Assembly with seven occurrences as a six-axis Robot;
3. importing one Robot from multiple STEP sources;
4. correcting a sideways source through unit, Up-axis, and Manual RPY controls;
5. proving two Robots with different J2 origin/axis values produce their
   independent expected TCP values;
6. proving revolute, prismatic, and fixed authoring behavior;
7. proving fixed Joints do not appear in controls, Jobs, or OPC UA Joint targets;
8. cancelling preview without changing the Project revision;
9. failing publication without changing Project, Gateway, active Renderer
   generation, or staged/cache invariants;
10. preserving Asset hash, source-root and occurrence provenance, Joint values,
    TCP, and Mesh-placement metadata through Save, reload, export, and import;
11. opening with a missing source, retaining Job and OPC UA operation, and
    recovering through exact-hash Relink;
12. allowing an individual warning threshold to be exceeded while rejecting a
    Project-wide hard-budget excess;
13. sharing Geometry between two instances while keeping visibility, selection,
    and Material state independent; and
14. containing one render failure without losing the viewport Canvas.

The browser suite also:

- moves an imported Robot Instance Base after Save/reload and proves the
  persisted source-root correction still produces the same Base-relative Link
  and TCP poses;
- requires explicit acknowledgement before applying an individual Asset
  warning;
- starts with a hidden scene below budget, attempts a visibility change that
  would produce 3,000,001 Triangles, and proves the revision, visibility, and
  active Runtime remain unchanged while exact excess and contributors are
  shown;
- injects failure after each publication phase and reloads the application to
  prove commit-token startup reconciliation;
- verifies hash-mismatch Relink rejection, parse retry, missing-source recovery,
  and render-failure recovery by their stable diagnostic codes;
- imports a fused-Solid fixture, proves Robot Apply remains unavailable, and
  shows the explicit rigid-Object or separable-source guidance;
- verifies each rotation preset plus Base-origin and ground-reference selection
  against the persisted correction formula.

Export/import acceptance has two explicit environments. Import into the same
browser cache resolves the actual Mesh immediately. Import into a clean browser
preserves all placement and provenance metadata, starts in
`ASSET_CONTENT_MISSING`, and restores the identical actual Mesh only after
exact-hash Relink. Byte-free export is never considered proof that the source
content moved with the Project.

Kinematic Link and TCP positions must match deterministic reference results
within `1e-6 m` for the same canonical Joint input. Expected successful Jobs
must assert `SUCCEEDED`; tests may not accept `SUCCEEDED | FAILED` as an
equivalent result.

The current full unit/integration suite, lint, build, Gateway configuration
check, and V5 Connectivity E2E remain release gates. New Asset and Mechanics
browser tests become part of the default V5 E2E command rather than a
non-default V4-specific suite.

## 14. Delivery Gates

This design is one product vertical slice, but implementation is divided into
independently verifiable gates:

1. **Contracts and budgets:** persisted Geometry-authoring provenance,
   deterministic occurrence identity, canonical units and Frames, stable
   diagnostics, and the approved warning/aggregate-budget migration.
2. **Asset persistence:** content-addressed staging, exact-hash Relink, cache
   retention/garbage collection, parser cancellation, and missing-source
   hydration.
3. **Geometry runtime:** prepared templates, Runtime-owned leases, actual Object
   and Robot Link rendering, coordinate authority, disposal, and error
   containment.
4. **Authoring and publication:** Object import, Robot staged Dialog, preview,
   dependency impact, warning acknowledgement, and atomic Apply through the
   existing coordinator.
5. **Release acceptance:** Save/reload/export/import/relink, phase-by-phase
   rollback and restart reconciliation, browser E2E, and recorded performance
   evidence.

Each gate retains the previous gate's tests. A later gate may not compensate for
an unverified earlier contract with UI-only behavior. The implementation plan
must preserve these boundaries so each gate can be reviewed and reverted
without an unrelated subsystem rewrite.

## 15. Completion Definition

The milestone is complete only when an operator can use the active V5
application to import an Object and a heterogeneous serial Robot, see their
actual Meshes, deterministically confirm or edit the Robot mechanics, publish
the candidate once, and recover missing sources without breaking the Project,
Job, or OPC UA runtime.

Proxy-only success, parser-only success, a locally prepared but unpublished
candidate, or tests that do not prove actual Mesh motion do not satisfy this
design.
