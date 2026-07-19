# Build Log

## Project

- Project name: WebDigitalTwin RobotSim Web
- Track: Developer Tools is the current recommendation; the final official
  track remains a human submission decision.
- User and problem: Automation engineers need a lightweight browser workspace
  for reviewing a Robot cell, changing independent Robot Joint states, arranging
  simple scene objects, preparing Simulation Jobs, and exposing inspectable
  runtime values without requiring a full desktop Robot engineering suite for
  every review or demonstration.

## Initial Brief

- Goal: Build a reusable Web Digital Twin around Project V4 with multiple Robot
  Instances, variable named Joint chains, Robot-owned Jobs, geometric collision,
  manual scene editing, and selectable OPC UA Server output.
- Context: The repository began as a single-Robot, fixed-six-Joint browser
  simulator with a separate read-only OPC UA Client connector. Requirements grew
  to include arbitrary Robot source layouts, multi-Robot state, moving Frames,
  Project save/load, Docker deployment, and explicit human control over
  mechanical configuration.
- Constraints: Keep the browser lightweight and deterministic; use geometry-only
  collision; do not infer Robot mechanics from STEP; do not add Legacy Adoption;
  do not modify user CAD; exclude authentication, certificates, signing,
  encryption, and public-network hardening from the short-term implementation.
- Done when: One Project V4 revision is published atomically to the browser
  runtime, a two-Robot sample runs independent Jobs, Off/Server mode can be
  selected, a real OPC UA Client can read both Robots' Actual Joint values, the
  Web plus Runtime Gateway stack starts with Docker, and the documented
  verification commands pass.

## Key Delegations

### Delegation 1

- Purpose: Deliver and independently challenge the Project V4 browser cutover,
  multi-Robot runtime, OPC UA Server vertical, deployment path, and release
  evidence in parallel while keeping one approved contract.
- Request: Specialists implemented V4 Project persistence/publication, Robot-ID
  runtime and Jobs, Scene/collision projection, a real `node-opcua` Server, the
  revision-fenced HTTP publisher, two-Robot browser acceptance, Legacy deletion,
  Docker integration, and adversarial tests. Separate reviewers looked for
  stale revisions, cross-Robot state leakage, resource cleanup failures, fixed
  six-Joint assumptions, and invalid OPC UA batches.
- Result: The browser now has one V4 authority and instance-keyed Robot/Job
  state; the old V1-V3/fixed-singleton paths and automatic nearest grasp were
  removed. The **Dual-Robot Technical Demo** provides an executable CRB Job with
  12 Joint Poses, the original CRB sweep, and an independent logical-slide Job.
  The Gateway validates exact Project/Revision payloads and publishes read-only
  Actual Joint nodes. Current verification evidence is recorded below.
- Next human decision: Confirm the official Build Week track, make the repository
  publicly judgeable, record and publish the under-three-minute YouTube demo,
  submit `/feedback` and retain its Session ID, confirm the final developer-tool
  setup/demo path is judgeable, review the submission copy, and submit the
  project. None of these human-owned items is marked complete by this
  implementation log.

## Failure & Recovery

- What failed: Early architecture coupled one active Robot, fixed J1-J6 tuples,
  old Project archives, and a separate OPC UA Client connector. During the V4
  cutover, review also reproduced a React Scene-status render loop and showed
  that a replaced Project could leave an old Job executor alive. A requested
  second imported Robot could not honestly be claimed because the available
  demonstration source did not yet have confirmed Link/Joint/Geometry mapping.
  Final Docker smoke also exposed an unreachable advertised endpoint, a default
  user-certificate store under the read-only container home, and one transient
  Docker BuildKit parent-snapshot cache failure.
- Why it failed: Cardinality and ownership were encoded in feature-specific
  stores rather than stable Robot IDs and one Project revision. Fresh callback
  identity retriggered a Scene effect, and executor lifetime was not tied tightly
  enough to runtime replacement. STEP source count does not reveal articulation,
  so a single assembly file cannot deterministically become a working Robot
  without operator-authored mechanics.
  OPC UA bind addresses are not valid discovery addresses, node-opcua owns a
  second User PKI unless explicitly injected, and the BuildKit cache failure
  occurred before application image execution.
- How we changed the approach: Project V4 became the only authority, publication
  waits until every runtime store reports the same revision, and Robots/Jobs/
  collision IDs are instance-qualified. Scene status callbacks were stabilized
  and made idempotent; disposed executors terminate waiters without writing to
  replacement stores. The second sample was deliberately modeled as a
  source-only logical prismatic Robot with no Geometry occurrences, and that
  limitation is shown in the UI documentation instead of presenting it as an
  imported MRb05. The OPC UA path moved behind a bounded Runtime Gateway with
  atomic Project activation and complete-batch validation.
  Bind/listen, advertised host, and advertised port are now explicit; Compose
  uses one host/container OPC UA port; both Server and User PKI stores live in
  the container `/tmp`; and the one Docker cache failure was recovered with a
  no-cache rebuild before repeating the complete smoke.

## Verification

- Historical baseline (before Object OPC UA binding documentation): the current serialized `npm run verify` passed `116` Vitest
  files and `1305` tests; CRB CAD validation reported `7 link assets valid; 0
  errors; 0 warnings`; deployment contracts, Runtime Gateway configuration, and
  production builds passed. Chromium acceptance passed the two-Robot V4 flow
  `2/2`, responsive viewport flow `1/1`, and docked workspace matrix `11/11`.
  Live browser verification additionally observed the 12-Pose CRB Job traverse
  both positive and negative J1 ranges, finish `SUCCEEDED · Step 12 of 12`,
  auto-scroll the active Timeline card into view, and return J1-J6 to Home.
- Working user flow: Open **Project → Samples → Dual-Robot Technical
  Demo**, select **CRB 12-Pose Technical Demo**, open Timeline, and start the
  Job. Observe all 12 Pose cards, positive and negative CRB motion, terminal
  `SUCCEEDED · Step 12 of 12`, and the final Home pose. Then select the
  logical-slide Robot to confirm its independent Job. Switch OPC UA from
  **Off** to **Server** when the optional Runtime Gateway is running, and use
  save/export/import to reproduce the canonical Project V4 configuration.
- Known limitations: The second sample Robot is a logical one-axis slide without
  STEP Geometry; arbitrary single-STEP Robot assembly authoring and MRb05
  mechanical confirmation are pending. The 12-Pose demo currently uses Joint
  targets only: named Poses/dwell, Cartesian IK and reachability, collision-based
  stop, execution-trace export, synchronized multi-Robot scheduling, and
  browser-level cancel/restart acceptance remain checklist items. OPC UA command
  writes, XML/XLSX mapping interchange, explicit
  Attach/Detach pick-place, automatic assembly splitting, physics, security
  hardening, Legacy migration, public deployment, and submission media are not
  included in this short-term release.

## Object OPC UA Binding Documentation Update

- Scope: Documented the implemented generic SpatialEntity Object binding path.
  Manual Box, Cylinder, and imported STEP placement uses XYZ/RPY fields and the
  move gizmo until an OPC UA transform owns the Object. The Inspector binds six
  `Double` nodes (`X`, `Y`, `Z`, `Roll`, `Pitch`, `Yaw`), with `m` or `mm`
  position conversion and optional numeric `Status`.
- Failure and recovery: Earlier release documentation still described
  Client/Bridge as unavailable and treated persisted mappings as roadmap-only.
  Source review confirmed active Client/Bridge adapters, a same-origin
  `/runtime/ws` stream, deterministic pose interpolation, quality propagation,
  and retention of the last valid pose/status through bad samples. The docs now
  describe those contracts and retain the read-only/security/safety exclusions.
- Focused evidence: documentation link and outdated-claim searches were run for
  this documentation-only change. No new full-suite count is claimed here; the
  preceding verification numbers remain historical baseline evidence.
- Working Object flow: Add or import a generic Object, select it, and place it
  with the Inspector XYZ/RPY fields or viewport move gizmo. Bind six external
  OPC UA pose nodes to make Client/Bridge runtime data authoritative; the manual
  fields and gizmo then lock until **Take Manual Control** is selected. An
  optional numeric Status node remains independently bound and visible.
- Regression and recovery: the Project V4 cutover removed the V3
  `EquipmentTransformControls` path without a V4 replacement, so Object
  selection remained but viewport movement disappeared. V4 now owns one generic
  SpatialEntity move-gizmo path for Box, Cylinder, and imported STEP Objects.
  OPC UA transform ownership deterministically disables both the gizmo and
  manual XYZ/RPY inputs; returning to Manual restores the saved manual pose.
- Current verification: the final serialized `npm run verify` passed `122`
  Vitest files and `1427` tests; CAD validation reported `7 link assets valid; 0
  errors; 0 warnings`; deployment contracts, Gateway configuration, Gateway/Web
  production builds, and Chromium acceptance passed (`2/2` multi-Robot, `1/1`
  viewport, `11/11` docked workspace). Independent review found no remaining
  P1/P2 issue in activation staging, replay, backpressure, or revision fencing.
- Live Object evidence: a local external OPC UA Server drove the selected Box to
  `2200/600/800 mm`, `12/24/36 deg`, and Status `92`. The browser displayed the
  values with all six manual pose fields disabled and exposed **Take Manual
  Control**. Before rebinding, Manual mode retained `X=650 mm`, `Rz=15 deg`, and
  the viewport move gizmo.

## Object Binding Context Entry and B&R PLC Probe

- Scope: Added a geometry-independent **Open Binding** command to the Object
  right-click menu. It selects the exact Spatial Entity, opens the Inspector,
  expands the existing OPC UA Binding disclosure, and focuses its summary. No
  duplicate modal, form, state store, or Geometry-specific branch was added.
- Browser flow: Right-clicking the sample Box exposed **Open Binding** between
  **Reset Pose** and grouping actions. The command opened the XYZ/RPY/Status
  mapping editor. A saved binding was re-opened with all seven Node IDs intact,
  OPC UA transform/status ownership visible, manual XYZ/RPY disabled, and
  **Take Manual Control** available.
- External probe: `opc.tcp://127.0.0.1:4840` was confirmed as a reachable B&R
  Embedded OPC UA Server. The Project was changed from Bridge to Client to avoid
  competing for the already-owned 4840 listen port. The Gateway connected and
  saved mappings for `g6AxRobC.MCSPosition0..5` plus a numeric Shuttle state.
- Known blocker: The B&R Server allowed anonymous browse/session creation but
  returned `BadUserAccessDenied` for the sampled application values. Therefore
  binding authoring, persistence, ownership, and Gateway connection were proven,
  but live Box motion was not claimed. The next real-value test requires
  anonymous read permission for dedicated Box variables or future authenticated
  Client support.
- Future Color: Keep Color independent from pose/status ownership. Add an Object
  runtime appearance channel that updates renderer materials; do not mutate
  imported Geometry or rebuild Geometry resources on every color sample.
- Verification: `110/110` focused App/command/menu/Inspector tests passed. The
  complete Vitest run, lint, Runtime Gateway TypeScript build, and Web production
  build also passed. An independent read-only review found no implementation
  issue after removing its two accidentally generated pnpm files.

## Human Decisions

- What Codex handled: Source inspection, design-to-code traceability, planning,
  delegated implementation, TDD, adversarial review, Legacy removal, failure
  reproduction and recovery, browser/Gateway/Docker verification preparation,
  and repository documentation.
- What people decided: Keep Robot as a dedicated articulated domain; allow up to
  seven STEP sources independently of Joint count; use manual deterministic
  mechanical mapping instead of AI extraction for now; represent generic
  machines with transforms/Moving Frames; use geometry-only collision; group
  Poses into Robot-owned Jobs; make OPC UA Server selectable; exclude security
  work; remove all Legacy behavior until explicitly requested; require a
  two-Robot browser demonstration; and retain final control over track, media,
  repository visibility, `/feedback`, and submission.
