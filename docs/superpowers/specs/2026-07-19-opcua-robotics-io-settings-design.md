# OPC UA Robotics, PLC I/O, Job Instructions, and Connectivity UX

**Date:** 2026-07-19

**Status:** Approved on 2026-07-19

**Target:** OpenWebDigitalTwin

**Delivery style:** Breaking, deterministic milestones with no Legacy Adoption

## 1. Purpose

This specification aligns the Robot-facing OPC UA Server model with the
official OPC UA for Robotics Companion Specification, makes PLC interaction the
primary integration path, and defines the operator-facing settings and
connection-monitoring experience.

It supersedes the custom Robot address-space portions of
`2026-07-16-project-v4-multi-robot-runtime-gateway-design.md`. The existing
Project V4 implementation remains the inspected baseline, not the target
contract.

The target must support:

- OPC UA Client subscriptions for Robot, Object, Moving Frame, status, and
  logical-input values;
- OPC UA Client writes for logical outputs used by `SetDO`;
- an OPC UA Server that exposes Robot telemetry through standard Robotics types;
- a separate OpenWebDigitalTwin model for Scene Objects, logical signals,
  simulation commands, Job runtime, attachments, and diagnostics;
- deterministic `MoveJoint`, `SetDO`, `WaitDI`, `Delay`, `Attach`, and `Detach`
  Job instructions;
- OPC UA Settings, a live Connection Monitor, and a Docker run guide; and
- the existing browser-only Simulation path when the Gateway is unavailable or
  OPC UA mode is Off.

Manufacturer-specific Robot program generation is explicitly excluded. Legacy
Project adoption, deprecated OPC UA aliases, and automatic old-schema migration
are also excluded until the user requests them.

Security configuration is outside this short-term prototype. Anonymous access,
`MessageSecurityMode.None`, and `SecurityPolicy.None` remain an explicit
trusted-development-LAN limitation, not a production recommendation.

## 2. Confirmed Current Baseline

The source audit confirmed the following current behavior:

- Project V4 has a closed persisted root with Robots, Spatial Entities, Jobs,
  Actions, and OPC UA configuration, but no independent logical-signal catalog.
- Jobs support only Joint Pose and Action Reference steps.
- OPC UA Client mode subscribes to read mappings but has no write API.
- OPC UA Server mode publishes only custom, read-only
  `RobotSim/Robots/<robotId>/Joints/<jointId>/Actual` values.
- Browser-to-Gateway state publication contains Robot Joint values only.
- Bridge activation is defective because the Server adapter recognizes exact
  `server` mode but not `bridge` mode.
- Gateway status decodes Client endpoint errors, but the UI presentation drops
  them and does not monitor status continuously.
- The existing Object Inspector authors a duplicate endpoint URL and timing
  configuration per Object instead of selecting a shared Endpoint profile.
- Docker publishes the Gateway Server on port 4840 by default, which conflicts
  with a host PLC Server already using `127.0.0.1:4840`.

These gaps are implementation targets. Documentation must not claim that
Client writes, Bridge, standard Robotics types, or PLC-to-Web Server commands
work before their runtime verification passes.

## 3. Standards Baseline

The normative Robot model is **OPC UA for Robotics Part 1: Vertical Integration
v1.02**, Namespace publication date 2025-09-08:

- Specification: <https://reference.opcfoundation.org/specs/OPC-40010-1>
- Namespace URI: `http://opcfoundation.org/UA/Robotics/`
- Namespace rules: <https://reference.opcfoundation.org/specs/OPC-40010-1/12>
- Official NodeSet: <https://github.com/OPCFoundation/UA-Nodeset/tree/Robotics-1.02-2025-09-08/Robotics>

The server loads the official Standard, DI, IA, and Robotics v1.02 NodeSets in
dependency order. The currently installed `node-opcua-nodesets` package already
contains the v1.02 Robotics NodeSet and its DI/IA dependencies; implementation
must pin and verify those files rather than copying standard type definitions
by hand.

### 3.1 Namespace ownership

The Robotics Namespace owns standard type definitions and standard
BrowseNames. It does not own OpenWebDigitalTwin-created instance NodeIds.

Use these separate namespaces:

```text
http://opcfoundation.org/UA/Robotics/     Standard Robotics definitions
urn:open-web-digital-twin:model:v1        Product-specific type definitions
urn:open-web-digital-twin:instances:v1    Project and runtime instances
```

No custom type, custom instance, command, Scene Object, logical signal, or Job
detail NodeId may be created in the OPC Foundation namespaces. Persisted Client
bindings store a Namespace URI and identifier, never a session-local Namespace
Index such as `ns=2`.

### 3.2 Standard Robot model

There is no separate standard `RobotType`. Each Robot, linear unit, turntable,
or positioner is a `MotionDeviceType` instance. A Robot is classified by its
`MotionDeviceCategory`.

```text
Objects
└─ DI:DeviceSet
   └─ WorkcellMotionSystem : Robotics:MotionDeviceSystemType
      ├─ MotionDevices
      │  ├─ RobotA : Robotics:MotionDeviceType
      │  │  ├─ ParameterSet
      │  │  ├─ Axes
      │  │  │  ├─ J1 : Robotics:AxisType
      │  │  │  └─ Jn : Robotics:AxisType
      │  │  └─ PowerTrains
      │  └─ LinearTrack : Robotics:MotionDeviceType
      ├─ Controllers
      │  └─ RobotController : Robotics:ControllerType
      └─ SafetyStates
```

Rules:

1. Joint count is derived from the Robot Definition and is not fixed at six.
2. A linear track or positioner is normally a separate Motion Device in the
   same Motion Device System, not an undocumented extra Robot Joint.
3. `ControllerType` relates to controlled Motion Devices through the standard
   `Controls` reference.
4. Each Axis publishes mandatory `ActualPosition`; `ActualSpeed` and
   `ActualAcceleration` are optional until a reliable source exists.
5. Revolute Axis engineering units are degrees and prismatic Axis units are
   millimetres. Project V5 stores revolute values in degrees and prismatic
   values in metres; the adapter preserves revolute values and converts only
   prismatic values at its single server boundary, then publishes valid
   `EngineeringUnits` and `EURange`.
6. `ActualPosition` is read-only telemetry. It is never reused as a target or
   command value.
7. Generic Object numeric status is not mapped to Robotics Safety State.
8. A simulated Safety State is clearly identified as informational and never
   presented as safety-rated data.

The first implementation may be labelled **Robotics-compatible mapping**. It
must not claim Robotics Base Server Facet conformance until all recursively
mandatory children, identity fields, references, and conformance tests pass.

### 3.3 Operation boundary

Robotics Part 1 standardizes program-oriented Controller and Task operation,
including Load, Start, Stop, GetReady, and StandDown state machines. It does not
standardize arbitrary high-frequency Joint target writes, generic Object poses,
Attach/Detach, or general PLC DI/DO exchange.

Accordingly:

- Robot Actual telemetry uses standard Robotics types;
- future Job lifecycle exposure may project genuinely equivalent lifecycle
  state through `TaskControlType`;
- direct simulation Joint targets use the product-specific command contract;
- generic Object and logical-signal exchange stays in the OpenWebDigitalTwin
  model; and
- no standard operation method is exposed until its state machine and failure
  behavior are complete.

## 4. Breaking Project Contract

The next persisted contract is **Project V5**. Project V4 is closed and cannot
gain logical signals, structured Node addresses, or explicit Job instructions
without silently changing its schema.

There is no automatic V4-to-V5 migration, Compatibility Mode, deprecated node
alias, or Legacy Adoption UI. A V4 file fails before active Project mutation
with a clear unsupported-schema error. The V5 sample and tests become the only
production path.

### 4.1 Robot identification additions

`RobotDefinitionV5` adds the standard-facing identity needed for a truthful
Motion Device projection:

```ts
interface RobotIdentificationV1 {
  manufacturer: string
  model: string
  productCode: string
  serialNumberTemplate: string | null
  motionDeviceCategory: 'ARTICULATED_ROBOT' | 'SCARA_ROBOT' | 'DELTA_ROBOT' | 'OTHER'
}
```

`RobotInstanceV5` owns its actual serial number. Controller identification is a
separate record; Robot identity is not reused as Controller identity.

### 4.2 Logical signals

Jobs and OPC UA bindings depend on stable logical signals rather than external
NodeIds:

```ts
type LogicalSignalDataTypeV1 = 'Boolean' | 'Int32' | 'UInt32' | 'Double' | 'String'
type LogicalSignalDirectionV1 = 'input' | 'output' | 'bidirectional' | 'internal'

interface LogicalSignalV1 {
  id: string
  name: string
  dataType: LogicalSignalDataTypeV1
  direction: LogicalSignalDirectionV1
  initialValue: boolean | number | string
  unit: string
  scope: { type: 'project' } | { type: 'robot' | 'entity'; id: string }
}
```

The Signal runtime adds Value, Quality, StatusCode, SourceTimestamp,
PublishedTimestamp, and Owner. Those fields are runtime state and are not
written back into canonical Project JSON.

### 4.3 Stable OPC UA Node address

```ts
interface OpcUaNodeAddressV1 {
  namespaceUri: string
  identifierType: 'string' | 'numeric' | 'guid' | 'byteString'
  identifier: string
}
```

The Settings UI may accept a pasted `ns=<index>;...` value as session-local
input only while a live Browse Session exists. Before Apply, it resolves and
persists the Namespace URI form. A disconnected form cannot persist an
unresolved Namespace Index.

An OPC UA Mapping binds one Endpoint and Node address to one logical Signal or
one typed Scene/Robot target. Structured values are flattened through explicit
bounded leaf paths. No reflection-based or heuristic field discovery is used
after Apply.

### 4.4 Job instruction envelope

Every instruction has a stable ID and one explicit operation. Manufacturer code
metadata and generators are not added.

```ts
type RobotJobInstructionV1 =
  | { id: string; kind: 'move-joint'; jointValues: Record<string, number>; speedPercentToNext: number }
  | { id: string; kind: 'set-do'; signalId: string; value: boolean }
  | { id: string; kind: 'wait-di'; signalId: string; expected: boolean; timeoutMs: number }
  | { id: string; kind: 'delay'; durationMs: number }
  | { id: string; kind: 'attach'; objectId: string; toolFrameId: string; objectGraspFrameId: string | null; maximumDistanceM: number }
  | { id: string; kind: 'detach'; objectId: string; targetParentFrameId: string | null }
```

Validation rules:

- `set-do` accepts only Boolean output or bidirectional Signals;
- `wait-di` accepts only Boolean input or bidirectional Signals;
- timeout is mandatory and a timeout fails the Job with a stable code;
- `move-joint` must contain the exact Joint ID set of its Robot Definition;
- Attach and Detach use explicit Object identities and preserve World pose;
- no gripper-close or proximity heuristic automatically selects an Object; and
- instruction reordering uses a drag handle with keyboard-accessible movement,
  not only Up/Down buttons.

## 5. Runtime and OPC UA Data Flow

```text
External PLC OPC UA Server
   │  subscribe/read             │ write SetDO/output
   ▼                             ▲
Runtime Gateway OPC UA Client ───┘
   │ StateBatch / CommandResult
   ▼
Browser Simulation Runtime
   │ accepted Actual state and command execution
   ▼
Runtime Gateway OPC UA Server
   │ Robotics telemetry + OpenWebDigitalTwin exchange
   ▼
External PLC OPC UA Client
```

Client, Server, and Bridge are roles of one Gateway:

| Mode | Outbound Client | Inbound Server |
|---|---:|---:|
| Off | No | No |
| Client | Yes | No |
| Server | No | Yes |
| Bridge | Yes | Yes |

Bridge does not mean automatic pass-through. Every forward route is explicit,
directional, typed, unit-checked, and cycle-checked.

### 5.1 OPC UA Client writes

`SetDO` uses the already-versioned Runtime Command envelope:

1. Job executor resolves `signalId` to an enabled write Mapping.
2. Browser sends a revision-qualified, expiring Command Request.
3. Gateway validates Project revision, Mapping direction, type, expiry, and
   deduplication identity.
4. Gateway calls OPC UA `Session.write` on the mapped Node.
5. Gateway returns Accepted/Rejected and terminal Succeeded/Failed result.
6. Job proceeds only after success; failure stops the Job with the returned
   stable failure code.

`WaitDI` observes the logical Signal store populated by OPC UA subscriptions.
It never polls the browser DOM or issues repeated read calls. A disconnect keeps
the last value for display but marks it stale; stale input cannot satisfy a new
WaitDI transition unless the instruction explicitly allows it in a future
version.

### 5.2 Server Actual and command separation

Standard Robot Actual values are read-only. The product model is separate:

```text
Objects
├─ DI:DeviceSet
│  └─ <MotionDeviceSystem and standard Robotics-typed instances>
└─ OpenWebDigitalTwin
   └─ Projects/<projectId>
      ├─ Actual
      │  ├─ SceneObjects/<entityId>/{Pose,Status,Color,Quality,Timestamps}
      │  ├─ LogicalSignals/<signalId>/{Value,Quality,Timestamps}
      │  ├─ Jobs/<jobId>/{State,StepIndex,FailureCode}
      │  └─ Attachments/<objectId>/{State,ParentFrameId}
      ├─ Command
      │  ├─ RobotJointTargets/<robotId>
      │  ├─ SceneObjects/<entityId>
      │  ├─ LogicalSignals/<signalId>
      │  └─ Jobs/<jobId>
      ├─ Result
      └─ Diagnostics
```

Command groups use per-Session staging and an explicit rising-edge Execute
trigger. A complete request contains RequestId, ExpiresAt, typed payload, and
Execute. Results contain Acknowledgement, ExecutionState, FailureCode, Message,
and completion time. Repeating the same RequestId returns the retained result
without executing twice.

Object pose commands use an atomic XYZ/RPY payload. Partial component writes do
not leak into the Scene. Internal orientation remains quaternion; RPY is an
exchange and UI representation only.

### 5.3 Runtime ownership

- Manual editing is enabled only while the corresponding target owner is
  Manual or Simulation.
- An active OPC UA read Binding owns its mapped target.
- An accepted Server command changes the target through the Simulation command
  boundary; it does not write directly into React or Three.js state.
- Disconnect retains the last valid display value, marks Quality stale/bad, and
  does not silently return ownership to Manual.
- Manual takeover remains an explicit user command.

## 6. OPC UA Settings and Monitoring UX

Settings and monitoring are separate surfaces.

### 6.1 Connectivity menu

Replace blind immediate mode switching as the primary workflow with:

```text
Connectivity
├─ OPC UA Settings…
├─ Connection Monitor…
├─ Binding Overview…
└─ Docker Run Guide…
```

The current mode may remain visible as a compact status control, but selecting
a mode with incomplete configuration opens Settings at the relevant section
instead of applying an invalid Project.

The Header displays two independent states:

```text
Gateway: Online | Offline | Activating | Error
OPC UA: Off | Client Connected | Server Listening | Bridge Degraded | Error
```

`Off · Ready` is removed because Gateway process readiness and OPC UA role are
different facts.

### 6.2 OPC UA Settings

`OPC UA Settings` is a modal Draft editor. It reuses the existing app tokens,
focus return, Escape handling, and responsive dialog behavior.

Sections:

1. **Overview**
   - Off / Client / Server / Bridge role selector
   - active and Draft Project revision
   - concise data-direction explanation
   - change-impact summary
2. **Client Endpoints**
   - shared Endpoint profiles, maximum eight
   - Name, URL, Enabled, Publishing Interval, Reconnect Delay
   - Test Connection, Duplicate, Delete
   - Binding count and Open Binding Overview
3. **Server**
   - listener state and advertised endpoint
   - standard Robotics view and product extension view
   - effective host/port values as read-only deployment settings
4. **Bridge Routes**
   - explicit Source, Destination, Scale, Offset, Unit
   - immediate self-reference and cycle errors
5. **Diagnostics and Docker**
   - effective runtime kind and health endpoints
   - host endpoint translation warning
   - copyable run and diagnostic commands

Footer actions are `Cancel` and `Apply & Activate`. Apply validates the complete
Draft, stages the candidate revision, activates Gateway adapters atomically,
and closes only on success. Failure leaves the Dialog open and preserves the
previous active runtime. `Test Connection` is diagnostic and never saves the
Draft by itself.

Object and Robot Binding editors select a shared Endpoint profile. They do not
re-author Endpoint URL, reconnect delay, or publishing defaults per Object.

### 6.3 Connection Monitor

`Connection Monitor` is a modeless panel so the user can keep watching the 3D
Simulation. Rows use one structure:

```text
Component | State | Endpoint | Last update | Quality | Error
```

It displays:

- Web proxy reachability;
- Gateway process liveness;
- active Project and revision readiness;
- Server listener and advertised endpoint;
- each Client Endpoint phase;
- Session and Subscription state;
- monitored item and Mapping counts;
- last notification and last GOOD value timestamps;
- reconnect attempt and next retry;
- last error code, message, and time; and
- last outgoing command result.

Endpoint phase is one of Disabled, Connecting, Connected, Reconnecting, or
Faulted. `ready=true` for an applied Project does not imply that required Client
Endpoints are connected.

Near-term transport polls status every two seconds while the Monitor is open
and every ten seconds while only the Header status is visible. A later
versioned diagnostics WebSocket message may replace polling without changing
the presentation contract.

## 7. Docker and Native Topology

For a Windows-hosted virtual PLC Server at `127.0.0.1:4840`, use distinct ports:

```text
Browser                    http://127.0.0.1:8080
Gateway HTTP               runtime-gateway:8081
Gateway OPC UA Client  --> opc.tcp://host.docker.internal:4840
Gateway OPC UA Server  <-- opc.tcp://127.0.0.1:4841
```

Recommended launch:

```powershell
$env:ROBOTSIM_OPCUA_PORT = '4841'
$env:ROBOTSIM_OPCUA_ADVERTISE_HOST = '127.0.0.1'
docker compose up -d --build --wait
docker compose ps
Invoke-WebRequest http://127.0.0.1:8080/runtime/healthz
Invoke-WebRequest http://127.0.0.1:8080/runtime/readyz
Invoke-WebRequest http://127.0.0.1:8080/runtime/status
```

Inside Docker, `opc.tcp://127.0.0.1:4840` addresses the Gateway container, not
the Windows host. Settings detects a loopback Client URL while runtime kind is
Docker, warns the user, and offers the deterministic
`host.docker.internal` replacement.

Listener host, listener port, and advertised host/port are deployment-owned
environment values. The browser displays effective values and instructions; it
does not pretend that editing a Project can change Docker port publication.
Environment changes require a container restart.

The Web UI never connects to the Docker daemon. "Docker connection" means the
observable Web-to-Gateway path and Gateway-to-OPC-UA Endpoint paths. Container
lifecycle remains an operator command documented in the run guide.

## 8. Limits

Retain the approved bounded integration limits:

| Resource | Maximum per Project |
|---|---:|
| OPC UA Client Endpoints | 8 |
| Structured Mapping roots | 128 |
| Expanded Mapping leaves | 1,024 |
| Leaves per structure | 32 |
| Structure depth | 4 |
| Fixed array elements | 256 |
| Aggregate mapped leaf updates | 10,240 per second |
| Concurrent OPC UA Server Sessions | 16 |
| Active command deduplication records | 4,096 |

Limits are validated before activation. Plus-one cases fail without replacing
the active Project. Scalar Object pose/status mappings count toward leaf and
update budgets.

## 9. Implementation Milestones

### Milestone 1: Connectivity stabilization

- Fix Bridge Server activation.
- Change Docker Gateway Server default/recommended port to 4841.
- Separate Gateway, Project-ready, Server, and Client-connected states.
- Preserve and present endpoint diagnostics.
- Correct Docker operator documentation.

### Milestone 2: Project V5 core contracts

- Add standard Robot and Controller identification.
- Add logical Signals and stable Namespace-URI Node addresses.
- Add explicit Job instruction envelopes.
- Add validators, limits, canonical codec, IndexedDB repository, and V5 sample.
- Reject V4 without migration or compatibility surfaces.

### Milestone 3: Client writes and Job I/O

- Add Gateway Client write service and Command Result transport.
- Add logical-signal runtime store.
- Implement SetDO, WaitDI, and Delay execution.
- Integrate explicit Attach and Detach instructions.
- Add write, timeout, disconnect, stale-quality, and deduplication tests.

### Milestone 4: Standard Robot Server and product exchange

- Load official Standard, DI, IA, and Robotics NodeSets.
- Instantiate the standard Motion Device System, Robots, Axes, Controllers,
  Power Trains, and informational Safety State.
- Publish converted Robot Actual telemetry as read-only standard Variables.
- Add product Actual, Command, Result, and Diagnostics branches.
- Add per-Session atomic command staging and Lease-fenced browser execution.

### Milestone 5: Settings, Monitor, and binding cleanup

- Add the Draft-based Settings Dialog.
- Add modeless Connection Monitor.
- Centralize Endpoint profiles.
- Change Object context `Open Binding` to select shared Endpoints and stable Node
  addresses.
- Add local Help and Docker Run Guide.

### Milestone 6: Technical demonstration

- Use two visible Robots and generic Scene Objects.
- Run at least one Job with ten or more MoveJoint poses plus SetDO, WaitDI,
  Delay, Attach, and Detach.
- Connect Gateway Client to a real test/virtual PLC Server on 4840.
- Connect a separate OPC UA Client to Gateway Server on 4841.
- Verify Browser, native Gateway, Docker Compose, save/reload, disconnect,
  reconnect, and command deduplication paths.

## 10. Success Criteria

The stage is complete only when all criteria pass:

1. The Server loads the official v1.02 Robotics NodeSet and required DI/IA
   dependencies; it does not hand-copy standard types.
2. Every Robot is projected as a standard `MotionDeviceType`, every configured
   Joint as an `AxisType`, and a linear unit as a separate Motion Device when
   modelled independently.
3. A two-, seven-, and sixteen-Joint Robot exposes the exact Axis count without
   fixed-six padding or truncation.
4. Revolute Actual Position reads in degrees and prismatic Actual Position in
   millimetres with correct units and ranges.
5. Standard Actual Position writes return `BadNotWritable`.
6. No product-created NodeId uses an OPC Foundation namespace.
7. Binding remains correct when the external Server assigns a different
   Namespace Index, because the persisted address uses Namespace URI.
8. Project V5 saves, exports, imports, reloads, and produces the same canonical
   revision. V4 is rejected without partial mutation or Legacy UI.
9. Bridge starts both adapters; an upstream Object value at port 4840 reaches
   the browser while Gateway Server remains readable at port 4841.
10. SetDO performs one OPC UA Client write and continues only after success.
11. WaitDI completes on a subscribed GOOD input, fails on timeout, and does not
    accept stale retained data as a new transition.
12. Delay, Attach, and Detach execute in the authored order and emit stable
    results.
13. A PLC Client command cannot modify standard Actual values; it uses a
    complete expiring product Command and receives Accepted/Running/Succeeded or
    Failed results.
14. Duplicate RequestId does not execute twice, cross-Session staged fields do
    not mix, and an expired or stale-generation request is rejected.
15. Settings Apply is atomic. Invalid endpoint, update budget, or Bridge cycle
    leaves the previous active runtime unchanged.
16. The Monitor distinguishes Gateway Online, Project Ready, Server Listening,
    and each Client Connected state and reports disconnect within one monitor
    polling interval.
17. Docker loopback Client URLs show the host-translation warning, and the
    generated guide uses `host.docker.internal:4840` plus Server port 4841.
18. The technical Job contains at least ten MoveJoint poses and the complete
    PLC I/O plus pick/place instruction path, verified through the browser.
19. Focused unit/integration tests, full test suite, lint, browser build,
    Gateway build, Docker validation, native OPC UA smoke, Docker OPC UA smoke,
    and browser acceptance all pass.
20. No manufacturer Robot program generator, security setup UI, Legacy
    Adoption, automatic old-schema migration, physics engine, or safety claim
    is introduced.

## 11. Approved Breaking Boundary

The user approved the following breaking boundary on 2026-07-19:

- Project V5 replaces V4 without migration or aliases;
- Robot telemetry uses standard Robotics types;
- direct simulation commands stay in the product model;
- Settings and Connection Monitor are separate surfaces; and
- Docker port 4841 is the default Gateway Server port when the host PLC occupies
  4840.
