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
  removed. A source-only dual-Robot sample demonstrates independent Jobs and
  Server publication. The Gateway validates exact Project/Revision payloads and
  publishes read-only Actual Joint nodes. Final evidence is recorded by command
  rather than freezing an intermediate test count in this log.
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

- Tests and checks: the final serialized `npm run verify` passed `88` Vitest
  files and `993` tests, CRB CAD validation reported `7 link assets valid; 0
  errors; 0 warnings`, Gateway and Web production builds passed, and the V4
  Chromium acceptance passed `1/1`. `npm run deploy:validate` and Compose config
  validation passed. The final Docker smoke built both images, verified exact
  pre/post-activation readiness, selected the two-Robot Server flow in headless
  Chromium, and used a strict external `node-opcua` Client to read `CRB J1=0`
  and `Slide X=0.2` before clean teardown. Client writes are independently
  covered as `BadNotWritable`.
- Working user flow: Start the app, load **Dual sample**, select each Robot,
  change its Joint values without changing the other Robot, run the CRB and
  logical-slide Jobs, switch OPC UA from **Off** to **Server**, observe Gateway
  readiness and endpoint, then read each Robot's Actual Joint nodes from an
  external OPC UA Client. Save/export and import the canonical Project V4 JSON
  to reproduce the configuration.
- Known limitations: The second sample Robot is a logical one-axis slide without
  STEP Geometry; arbitrary single-STEP Robot assembly authoring and MRb05
  mechanical confirmation are pending. OPC UA Client/Bridge and command writes,
  XML/XLSX mapping interchange, explicit Attach/Detach pick-place, automatic
  assembly splitting, physics, IK/path planning, security hardening, and Legacy
  migration are not included in this short-term release. Public deployment and
  submission media are also not implementation-complete claims.

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
