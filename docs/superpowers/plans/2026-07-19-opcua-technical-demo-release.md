# OPC UA Technical Demo and Release Evidence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver a repeatable native and Docker technical demonstration in which two visible Robots and generic Objects execute a ten-plus-pose PLC-I/O pick/place Job while independent OPC UA Clients verify the Gateway's standard Robotics telemetry and product command/result model.

**Architecture:** Build one canonical Project V5 demo fixture, one deterministic host-side virtual PLC Server on port 4840, and black-box probes that use only HTTP, WebSocket, browser accessibility, and OPC UA endpoints. The native Playwright fixture owns PLC stop/restart so reconnect behavior is deterministic; the Docker smoke reuses the same fixture through `host.docker.internal:4840` and treats an unavailable Docker Engine as an explicit blocked gate rather than a pass.

**Tech Stack:** TypeScript 6.0.3, JavaScript ESM, React 19.2.7, Vitest 4.1.10, Playwright 1.61.1, `node-opcua` 2.175.0, Vite 8.1.4, Docker Compose, Node 22.15.1, npm 11.4.2, PowerShell.

## Global Constraints

- Implement this plan only after Milestones 1 through 5 are green; consume Project V5, logical Signals, Job I/O, standard Robotics Server, product exchange, OPC UA Settings, and Connection Monitor contracts without reopening them.
- Project V5 is the only demo persistence format. Do not add V4 conversion, migration, aliases, Compatibility Mode, Legacy Adoption, or deprecated sample paths.
- Use two visible `RobotInstanceV5` records sharing one checked-in NED2 Robot Definition and at least two generic primitive Scene Objects; do not add multi-Robot synchronized scheduling.
- Robot A is Simulation-owned and runs the Job; Robot B is OPC UA Client-owned from the virtual PLC Joint array and remains locally non-editable until explicit takeover.
- The primary Job contains at least ten `move-joint` instructions and contains `set-do`, `wait-di`, `delay`, `attach`, and `detach` in one deterministic authored sequence.
- Run the deterministic virtual PLC OPC UA Server at exactly `opc.tcp://127.0.0.1:4840`; fail on a port conflict instead of selecting another port silently.
- Run the Gateway HTTP endpoint at `http://127.0.0.1:8081` and Gateway OPC UA Server at exactly `opc.tcp://127.0.0.1:4841`.
- Native Client configuration uses `opc.tcp://127.0.0.1:4840`; Docker Client configuration uses `opc.tcp://host.docker.internal:4840`. The browser never controls the Docker daemon.
- The independent OPC UA Client resolves Namespace URIs from `Server_NamespaceArray`; it never persists or assumes session-local Namespace Indexes.
- Verify standard Robotics `ActualPosition` as read-only. Product commands use per-Session staging, an expiring RequestId, a rising-edge Execute trigger, and terminal Result fields.
- An identical duplicate RequestId must return the retained result and must not execute a second write or Scene mutation.
- Disconnect retains display values as stale/bad, cannot satisfy a new `wait-di`, and does not silently restore Manual ownership; reconnect must recover the configured Endpoint without replacing the Project.
- Native and Docker probes use anonymous, `MessageSecurityMode.None`, and `SecurityPolicy.None` only as a trusted-development-LAN limitation. Do not add or claim a security configuration workflow.
- Do not add a manufacturer Robot program generator, automatic code export, physics engine, physical collision response, safety-rated behavior, or OPC UA Robotics conformance claim.
- A Docker Engine failure is reported as `BLOCKED: DOCKER_ENGINE_UNAVAILABLE` with the failing command and message. It must never be recorded as PASS, SKIP-PASS, or equivalent.
- Keep comments in English, preserve unrelated user changes and untracked CAD/artifact directories, and stage only files listed by each task.

---

## File Structure

**Create:**

- `src/features/robot/v5/builtin-ned2-definition-v5.ts` — Project V5 metadata wrapper for the checked-in seven-link NED2 geometry; no copied standard OPC UA types.
- `src/features/project/v5/opcua-technical-demo-v5.ts` — canonical two-Robot, generic-Object, Bridge-mode technical demo factory.
- `src/features/project/v5/opcua-technical-demo-v5.test.ts` — exact Robot/Object/Signal/Mapping/Job and round-trip assertions.
- `examples/opcua-technical-demo/project-v5.json` — canonical exported fixture generated from the factory and checked against it byte-for-byte.
- `scripts/demo/virtual-plc-server.mjs` and `virtual-plc-server.d.mts` — deterministic in-process/CLI OPC UA PLC Server on 4840.
- `scripts/demo/virtual-plc-server.test.ts` — NodeSet, read/write count, scenario, restart, and cleanup tests.
- `scripts/demo/opcua-technical-demo-client.mjs` and `opcua-technical-demo-client.d.mts` — independent OPC UA Client for standard Actual and product Command/Result validation.
- `scripts/demo/opcua-technical-demo-client.test.ts` — BrowseName resolution, unit, `BadNotWritable`, staging, terminal Result, and dedupe tests.
- `scripts/demo/native-technical-demo.mjs` and `native-technical-demo.d.mts` — native Gateway/PLC activation, state publication, SetDO, disconnect/reconnect, and OPC UA smoke orchestration.
- `scripts/demo/native-technical-demo.test.ts` — subprocess environment, readiness, ordering, failure, and cleanup tests.
- `scripts/demo/serve-native-gateway-web.mjs` — long-running native Gateway plus Vite preview process used by Playwright.
- `playwright.opcua-demo.config.ts` — serial technical-demo browser configuration.
- `tests/opcua-technical-demo.spec.ts` — Browser Job, pick/place, save/reload/import, reconnect, and product-command acceptance.
- `scripts/deployment/technical-demo-smoke.mjs` and `technical-demo-smoke.d.mts` — host PLC plus Docker Compose end-to-end smoke.
- `scripts/deployment/technical-demo-smoke.test.ts` — Docker preflight, endpoint translation, probe, failure, and teardown orchestration tests.
- `docs/operator/opcua-technical-demo.md` — native and Docker operator runbook with expected observations.
- `docs/verification/opcua-technical-demo-verification.md` — success-criterion checklist and evidence table.
- `docs/progress/2026-07-19-opcua-technical-demo-build-log.md` — actual Build Log, delegation, failure/recovery, verification, and human-decision record.

**Modify:**

- `src/app/App.tsx` — register the Project V5 technical sample in the existing Samples command and preserve the V5 publication boundary.
- `src/app/App.test.tsx` — prove the menu publishes the exact demo fixture.
- `vite.config.ts` — share the `/runtime` HTTP/WebSocket proxy between development and preview servers.
- `scripts/deployment/smoke-deployment.mjs` and its test — allow the technical probe to receive the effective runtime topology without weakening existing cleanup.
- `package.json` — add focused demo, native, Playwright, Docker, and release gates.
- `README.md` — link the runbook and state the verified/not-verified boundary.

**Consumed without modification:**

- `src/core/project-v5/index.ts`
- `src/features/project/v5/project-v5-codec.ts`
- `src/features/project/v5/project-v5-repository.ts`
- `src/features/project/v5/browser-project-runtime-v5.ts`
- `src/features/jobs/v5/job-executor.ts`
- `src/core/runtime-protocol/gateway-status-v1.ts`
- `middleware/runtime-gateway/opcua-robotics-model.ts`
- `middleware/runtime-gateway/opcua-openweb-model.ts`
- `middleware/runtime-gateway/opcua-command-staging.ts`
- `src/features/connectivity/v5/OpcUaSettingsDialog.tsx`
- `src/features/connectivity/v5/ConnectionMonitorPanel.tsx`

### Task 1: Create the Canonical Two-Robot Project V5 Demo

**Files:**
- Create: `src/features/robot/v5/builtin-ned2-definition-v5.ts`
- Create: `src/features/project/v5/opcua-technical-demo-v5.ts`
- Test: `src/features/project/v5/opcua-technical-demo-v5.test.ts`
- Create: `examples/opcua-technical-demo/project-v5.json`
- Modify: `src/app/App.tsx`
- Modify: `src/app/App.test.tsx`

**Interfaces:**
- Consumes: `WorkcellProjectV5`, `RobotJobInstructionV1`, `validateWorkcellProjectV5`, `canonicalProjectV5Json`, `encodeProjectV5`, `decodeProjectV5`, Milestone 3 `computeSerialRobotPoseV5`, V5 rigid-transform composition, and the existing V5 App publication command.
- Produces: `createOpcUaTechnicalDemoV5(options): WorkcellProjectV5`, `OPCUA_TECHNICAL_DEMO_IDS_V5`, and one canonical JSON fixture consumed by native, browser, and Docker probes.

- [ ] **Step 1: Write the failing sample contract tests**

```ts
it('contains two visible NED2 Robots, generic Objects, and the complete Job path', async () => {
  const project = createOpcUaTechnicalDemoV5({
    projectId: 'opcua-technical-demo-v5',
    revisionId: 'opcua-technical-demo-v5-r1',
    nowIso: '2026-07-19T00:00:00.000Z',
    plcEndpointUrl: 'opc.tcp://127.0.0.1:4840',
  })

  expect(project.schemaVersion).toBe(5)
  expect(project.opcUa.mode).toBe('bridge')
  expect(project.robots).toHaveLength(2)
  expect(project.robots.every(({ visible }) => visible)).toBe(true)
  expect(project.robots.map(({ jointSource }) => jointSource))
    .toEqual(['simulation', 'opcua:endpoint-demo-plc'])
  expect(new Set(project.robots.map(({ definitionId }) => definitionId)).size).toBe(1)
  expect(project.spatialEntities.map(({ geometry }) => geometry.kind).sort())
    .toEqual(['box', 'cylinder'])
  const fixture = project.spatialEntities.find(({ id }) => id === OPCUA_TECHNICAL_DEMO_IDS_V5.fixtureObjectId)!
  expect(fixture).toMatchObject({
    parentFrameId: OPCUA_TECHNICAL_DEMO_IDS_V5.fixtureMovingFrameId,
    transformOwner: 'opcua:endpoint-demo-plc',
    numericStatus: { sourceOwnership: 'opcua:endpoint-demo-plc' },
  })
  expect(fixture.movingFrames).toContainEqual(expect.objectContaining({
    frameId: OPCUA_TECHNICAL_DEMO_IDS_V5.fixtureMovingFrameId,
    parentFrameId: 'mcp',
    sourceOwnership: 'opcua:endpoint-demo-plc',
  }))
  const fixturePoseMapping = project.opcUa.mappings.find(
    ({ id }) => id === OPCUA_TECHNICAL_DEMO_IDS_V5.objectPoseMappingId,
  )!
  expect(new Set(fixturePoseMapping.leaves.map(({ projectTarget }) => JSON.stringify(projectTarget))))
    .toEqual(new Set([JSON.stringify({
      type: 'entity-frame',
      entityId: OPCUA_TECHNICAL_DEMO_IDS_V5.fixtureObjectId,
      frameId: OPCUA_TECHNICAL_DEMO_IDS_V5.fixtureMovingFrameId,
    })]))

  const job = project.jobs.find(({ id }) => id === OPCUA_TECHNICAL_DEMO_IDS_V5.jobId)!
  expect(job.instructions.filter(({ kind }) => kind === 'move-joint')).toHaveLength(12)
  expect(new Set(job.instructions.map(({ kind }) => kind))).toEqual(new Set([
    'move-joint', 'set-do', 'wait-di', 'delay', 'attach', 'detach',
  ]))
  expect(job.instructions.map(({ id }) => id)).toHaveLength(
    new Set(job.instructions.map(({ id }) => id)).size,
  )

  const encoded = encodeProjectV5(project)
  await expect(decodeProjectV5(encoded)).resolves.toEqual(project)
  expect(canonicalProjectV5Json(project))
    .not.toMatch(/"actions"|action-reference|actionBindings|ns=\d+;/u)
})

it('keeps every move inside the shared six-axis definition', () => {
  const project = technicalDemoProject()
  const jointIds = project.robotDefinitions[0]!.joints.map(({ id }) => id).sort()
  for (const instruction of project.jobs[0]!.instructions) {
    if (instruction.kind !== 'move-joint') continue
    expect(Object.keys(instruction.jointValues).sort()).toEqual(jointIds)
  }
})

it('places the authored grasp Frame exactly at Robot A Tool for the attach pose', () => {
  const project = technicalDemoProject()
  const robot = project.robots.find(({ id }) => id === OPCUA_TECHNICAL_DEMO_IDS_V5.robotAId)!
  const definition = project.robotDefinitions.find(({ id }) => id === robot.definitionId)!
  const job = project.jobs.find(({ id }) => id === OPCUA_TECHNICAL_DEMO_IDS_V5.jobId)!
  const attachPose = job.instructions.filter(({ kind }) => kind === 'move-joint')[1]!
  if (attachPose.kind !== 'move-joint') throw new Error('Demo attach pose is not MoveJoint.')
  const toolWorld = computeSerialRobotPoseV5(
    definition, attachPose.jointValues, robot.localBasePose,
  ).frameWorldPoses.Tool!
  const part = project.spatialEntities.find(({ id }) => id === OPCUA_TECHNICAL_DEMO_IDS_V5.partObjectId)!
  const grasp = part.graspFrames.find(({ frameId }) => frameId === OPCUA_TECHNICAL_DEMO_IDS_V5.partGraspFrameId)!
  expect(part.parentFrameId).toBe('mcp')
  expect(composeRigidTransformV5(part.localPose, grasp.localPose)).toEqual(toolWorld)
})

it('matches the checked-in canonical fixture exactly', async () => {
  const project = technicalDemoProject()
  const fixture = await readFile('examples/opcua-technical-demo/project-v5.json', 'utf8')
  expect(fixture).toBe(`${canonicalProjectV5Json(project)}\n`)
})
```

- [ ] **Step 2: Run RED**

Run:

```powershell
npm run test:run -- src/features/project/v5/opcua-technical-demo-v5.test.ts src/app/App.test.tsx
```

Expected: FAIL because the V5 NED2 wrapper, demo factory, fixture, and Samples command do not exist.

- [ ] **Step 3: Add the exact public factory and IDs**

```ts
export interface OpcUaTechnicalDemoV5Options {
  readonly projectId: string
  readonly revisionId: string
  readonly nowIso: string
  readonly plcEndpointUrl: 'opc.tcp://127.0.0.1:4840'
    | 'opc.tcp://host.docker.internal:4840'
}

export const OPCUA_TECHNICAL_DEMO_IDS_V5 = Object.freeze({
  robotDefinitionId: 'definition-demo-NED2',
  controllerAId: 'controller-demo-a',
  controllerBId: 'controller-demo-b',
  robotAId: 'robot-demo-a',
  robotBId: 'robot-demo-b',
  partObjectId: 'entity-demo-part',
  fixtureObjectId: 'entity-demo-fixture',
  fixtureMovingFrameId: 'frame-demo-fixture-live',
  partGraspFrameId: 'part-grasp',
  endpointId: 'endpoint-demo-plc',
  partPresentSignalId: 'signal-demo-part-present',
  clampCommandSignalId: 'signal-demo-clamp-command',
  objectPoseMappingId: 'mapping-demo-object-pose',
  objectStatusMappingId: 'mapping-demo-object-status',
  partPresentMappingId: 'mapping-demo-part-present',
  clampCommandMappingId: 'mapping-demo-clamp-command',
  robotBJointMappingPrefix: 'mapping-demo-robot-b-joint-',
  jobId: 'job-demo-pick-place',
} as const)

export function createOpcUaTechnicalDemoV5(
  options: OpcUaTechnicalDemoV5Options,
): WorkcellProjectV5
```

Port the checked-in NED2 link facts and kinematics under V5 types in `builtin-ned2-definition-v5.ts`; keep seven STEP asset references and `/models/robot/LINK00.glb` through `LINK06.glb` render preparation. Create two instances at `[-1.1, -0.45, 0]` and `[1.1, 0.45, 0]`, each with its own Controller and serial number. Both instances share the immutable Definition and geometry resources.

Create one graspable cyan Box part and one gray Cylinder fixture. The Box uses parent Frame `mcp`, an identity `part-grasp` local Frame, and a Simulation-owned transform. After creating Robot A and the exact pose list below, call `computeSerialRobotPoseV5(definition, poseRecord(poses[1]), robotA.localBasePose)` and set the Box `localPose` so `part-grasp` equals the resulting `Tool` world pose; do not hand-enter an approximate location or increase the 0.05 m attach tolerance to hide a geometry mismatch. The Cylinder declares Moving Frame `frame-demo-fixture-live`, parented to `mcp`, with `sourceOwnership: 'opcua:endpoint-demo-plc'`; the Entity uses that Frame as `parentFrameId`, identity `localPose`, and the same OPC UA `transformOwner`. Configure `PartPresent` as Boolean input and `ClampCommand` as Boolean output. Persist the exact String identifiers `VirtualPLC/Signals/PartPresent`, `VirtualPLC/Signals/ClampCommand`, `VirtualPLC/ObjectPos`, `VirtualPLC/ObjectStatus`, and `VirtualPLC/RobotB/Joints` with Namespace URI `urn:open-web-digital-twin:virtual-plc:v1`; map the fixed `ObjectPos` Double array to the Cylinder's `frame-demo-fixture-live` target with OPC UA source `leafPath` values `[0]` through `[5]` and Project destination `projectPath` values `positionM[0..2]` then `rpyDegrees[0..2]`, map `ObjectStatus` to that fixture through its own Int32 root with both paths empty, and never persist an `ns=` value. Map the six-element Robot B Joint array through six scalar Mapping roots sharing the same Node address, each with source `leafPath: [jointIndex]`, `projectPath: []`, and one stable Robot/Joint target. Robot B's `jointSource` and the fixture transform/status owners are `opcua:endpoint-demo-plc`; Robot A and the graspable Box remain Simulation-owned so the authored Job and Attach/Detach path succeed without silent ownership takeover.

Use these exact 12 Joint poses and operation order:

```ts
const poses = [
  [0, 0, 0, 0, 0, 0],
  [15, -10, -15, 0, 10, 0],
  [30, -20, -30, 15, 20, 20],
  [45, -25, -40, 30, 10, 40],
  [25, -5, -25, 45, -10, 60],
  [0, 15, -20, 60, -20, 80],
  [-25, -5, -25, 45, -10, 60],
  [-45, -25, -40, 30, 10, 40],
  [-30, -20, -30, 15, 20, 20],
  [-15, -10, -15, 0, 10, 0],
  [0, -5, -10, -15, 5, -20],
  [0, 0, 0, 0, 0, 0],
] as const

const instructions: RobotJobInstructionV1[] = [
  move('move-01-approach', poses[0], 35),
  move('move-02-detect', poses[1], 25),
  { id: 'wait-part-present', kind: 'wait-di', signalId: 'signal-demo-part-present', expected: true, timeoutMs: 5_000 },
  { id: 'clamp-on', kind: 'set-do', signalId: 'signal-demo-clamp-command', value: true },
  { id: 'clamp-settle', kind: 'delay', durationMs: 250 },
  { id: 'attach-part', kind: 'attach', objectId: 'entity-demo-part', toolFrameId: 'Tool', objectGraspFrameId: 'part-grasp', maximumDistanceM: 0.05 },
  ...poses.slice(2, 9).map((pose, index) => move(`move-${String(index + 3).padStart(2, '0')}-transfer`, pose, 40)),
  { id: 'detach-part', kind: 'detach', objectId: 'entity-demo-part', targetParentFrameId: 'mcp' },
  { id: 'clamp-off', kind: 'set-do', signalId: 'signal-demo-clamp-command', value: false },
  ...poses.slice(9).map((pose, index) => move(`move-${String(index + 10).padStart(2, '0')}-return`, pose, 30)),
]
```

- [ ] **Step 4: Register one accessible V5 Samples command**

Add `Project > Samples > OPC UA Technical Demo` to the existing menu. Selecting it must call `createOpcUaTechnicalDemoV5` with the Endpoint selected from `status.gateway.runtimeKind` (`127.0.0.1` for native, `host.docker.internal` for Docker), publish through the V5 coordinator, select Robot A, and show `OPC UA Technical Demo` as the Project name. It must not bypass repository preparation, Gateway activation, or runtime rollback.

```ts
const plcEndpointUrl = gatewayStatus?.gateway.runtimeKind === 'docker'
  ? 'opc.tcp://host.docker.internal:4840' as const
  : 'opc.tcp://127.0.0.1:4840' as const

await publishProjectV5(createOpcUaTechnicalDemoV5({
  projectId: 'opcua-technical-demo-v5',
  revisionId: crypto.randomUUID(),
  nowIso: new Date().toISOString(),
  plcEndpointUrl,
}))
```

- [ ] **Step 5: Generate the fixture and run GREEN**

Print the canonical JSON with this exact one-shot command, then add that stdout plus one trailing LF to `examples/opcua-technical-demo/project-v5.json` with `apply_patch`:

```powershell
npm exec tsx -- -e "import { canonicalProjectV5Json } from './src/core/project-v5/index.ts'; import { createOpcUaTechnicalDemoV5 } from './src/features/project/v5/opcua-technical-demo-v5.ts'; const p=createOpcUaTechnicalDemoV5({projectId:'opcua-technical-demo-v5',revisionId:'opcua-technical-demo-v5-r1',nowIso:'2026-07-19T00:00:00.000Z',plcEndpointUrl:'opc.tcp://127.0.0.1:4840'}); process.stdout.write(canonicalProjectV5Json(p))"
```

Then run:

```powershell
npm run test:run -- src/features/project/v5/opcua-technical-demo-v5.test.ts src/app/App.test.tsx
npm run build
git diff --check
```

Expected: focused tests PASS, the fixture is byte-identical to canonical V5 encoding, both Robots are visible records, the Job has 12 `move-joint` instructions and every required operation, and the browser build succeeds.

- [ ] **Step 6: Commit the demo contract**

```powershell
git add src/features/robot/v5/builtin-ned2-definition-v5.ts src/features/project/v5/opcua-technical-demo-v5.ts src/features/project/v5/opcua-technical-demo-v5.test.ts examples/opcua-technical-demo/project-v5.json src/app/App.tsx src/app/App.test.tsx
git diff --cached --check
git commit -m "feat: add opc ua technical demo project"
```

### Task 2: Build the Deterministic Virtual PLC Server on Port 4840

**Files:**
- Create: `scripts/demo/virtual-plc-server.mjs`
- Create: `scripts/demo/virtual-plc-server.d.mts`
- Test: `scripts/demo/virtual-plc-server.test.ts`

**Interfaces:**
- Consumes: `node-opcua` Server APIs only.
- Produces: `startVirtualPlcServer(options): Promise<VirtualPlcServerV1>` and a standalone `npm run demo:virtual-plc` process.

- [ ] **Step 1: Write the failing real-server test**

```ts
it('serves deterministic PLC Signals and ObjectPos values', async () => {
  const plc = await startVirtualPlcServer({ port: 14840 })
  const client = await connectAnonymous(plc.endpointUrl)
  try {
    expect(plc.endpointUrl).toBe('opc.tcp://127.0.0.1:14840')
    expect(await readNamespaceUri(client, 'urn:open-web-digital-twin:virtual-plc:v1'))
      .toBeGreaterThan(0)
    expect(await readBoolean(client, 'Signals/PartPresent')).toBe(false)
    expect(await readBoolean(client, 'Signals/ClampCommand')).toBe(false)
    expect(await readDoubleArray(client, 'ObjectPos')).toEqual([0.4, -0.2, 0.05, 0, 0, 0])
    expect(await readDoubleArray(client, 'RobotB/Joints')).toEqual([0, 0, 0, 0, 0, 0])

    await plc.setPartPresent(true)
    await plc.setRobotBJoints([5, -10, 15, -20, 25, -30])
    expect(await readDoubleArray(client, 'RobotB/Joints')).toEqual([5, -10, 15, -20, 25, -30])
    await writeBoolean(client, 'Signals/ClampCommand', true)
    expect(plc.readClampCommand()).toBe(true)
    expect(plc.writeCount('Signals/ClampCommand')).toBe(1)
  } finally {
    await client.close()
    await plc.stop()
  }
})

it('can stop and bind the same test port again', async () => {
  const first = await startVirtualPlcServer({ port: 14841 })
  await first.stop()
  const second = await startVirtualPlcServer({ port: 14841 })
  await second.stop()
})

it('fails explicitly when the configured port is occupied', async () => {
  const first = await startVirtualPlcServer({ port: 14842 })
  await expect(startVirtualPlcServer({ port: 14842 }))
    .rejects.toThrow('VIRTUAL_PLC_PORT_IN_USE: 127.0.0.1:14842')
  await first.stop()
})
```

- [ ] **Step 2: Run RED**

Run: `npm run test:run -- scripts/demo/virtual-plc-server.test.ts`

Expected: FAIL because the virtual PLC module does not exist.

- [ ] **Step 3: Implement the exact PLC contract**

```ts
export interface VirtualPlcServerV1 {
  readonly endpointUrl: `opc.tcp://127.0.0.1:${number}`
  readonly namespaceUri: 'urn:open-web-digital-twin:virtual-plc:v1'
  setPartPresent(value: boolean): Promise<void>
  setObjectPose(value: Readonly<{
    x: number; y: number; z: number
    roll: number; pitch: number; yaw: number
    status: number
  }>): Promise<void>
  setRobotBJoints(values: readonly [number, number, number, number, number, number]): Promise<void>
  readClampCommand(): boolean
  writeCount(path: 'Signals/ClampCommand'): number
  resetScenario(): Promise<void>
  stop(): Promise<void>
}

export function startVirtualPlcServer(
  options?: Readonly<{ port?: number }>,
): Promise<VirtualPlcServerV1>
```

Create one namespace `urn:open-web-digital-twin:virtual-plc:v1` with these String NodeIds and DataTypes:

```text
VirtualPLC/Signals/PartPresent       Boolean  read/write by scenario driver
VirtualPLC/Signals/ClampCommand      Boolean  read/write by Gateway
VirtualPLC/ObjectPos                 Double[6] [X,Y,Z metres, Roll,Pitch,Yaw degrees]
VirtualPLC/ObjectStatus              Int32
VirtualPLC/RobotB/Joints             Double[6] [J1..J6 degrees]
VirtualPLC/Diagnostics/ClampWriteCount UInt32 read-only
```

Initial state is `PartPresent=false`, `ClampCommand=false`, pose `{ x: 0.4, y: -0.2, z: 0.05, roll: 0, pitch: 0, yaw: 0, status: 10 }`, Robot B Joints `[0,0,0,0,0,0]`, and write count 0. Increment the count only when an OPC UA Client write to `ClampCommand` is accepted; internal reset does not increment it. Validate the requested port as integer 1..65535. Use anonymous `None/None`, `allowAnonymous: true`, `maxConnectionsPerEndpoint: 8`, a temporary per-process PKI directory, and idempotent shutdown. The CLI defaults to 4840, prints exactly `[demo-plc] ready opc.tcp://127.0.0.1:4840` after startup, and exits nonzero on startup failure; it never selects another port automatically.

- [ ] **Step 4: Run GREEN, CLI startup, and cleanup checks**

```powershell
npm run test:run -- scripts/demo/virtual-plc-server.test.ts
$process = Start-Process node -ArgumentList 'scripts/demo/virtual-plc-server.mjs' -PassThru -WindowStyle Hidden
try {
  Start-Sleep -Seconds 2
  if ($process.HasExited) { throw 'Virtual PLC exited before readiness.' }
} finally {
  Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
}
```

Expected: tests PASS on dedicated test ports, the CLI process stays alive on 4840, and cleanup releases the port. If an operator-owned Server already occupies 4840, keep unit tests on 14840–14842 and record only the live fixed-port check as blocked; never terminate the operator process.

- [ ] **Step 5: Commit the PLC fixture**

```powershell
git add scripts/demo/virtual-plc-server.mjs scripts/demo/virtual-plc-server.d.mts scripts/demo/virtual-plc-server.test.ts
git diff --cached --check
git commit -m "test: add deterministic virtual plc server"
```

### Task 3: Add the Independent Standard-Robotics and Product-Command OPC UA Client

**Files:**
- Create: `scripts/demo/opcua-technical-demo-client.mjs`
- Create: `scripts/demo/opcua-technical-demo-client.d.mts`
- Test: `scripts/demo/opcua-technical-demo-client.test.ts`

**Interfaces:**
- Consumes: Gateway OPC UA Server branches created by `opcua-robotics-model.ts`, `opcua-openweb-model.ts`, and `opcua-command-staging.ts`.
- Produces: `probeStandardRobotActualV1` and `executeSceneObjectPoseCommandV1` for native, Playwright, and Docker callers.

- [ ] **Step 1: Write RED against a real Gateway Server test harness**

```ts
it('reads standard Robot Actual with units and rejects writes', async () => {
  const harness = await startTechnicalDemoGatewayServer()
  try {
    await harness.publishRobotJoint('robot-demo-a', 'J1', 28.6478897565)
    const report = await probeStandardRobotActualV1({
      endpointUrl: 'opc.tcp://127.0.0.1:4841',
      robotBrowseName: 'RobotA',
      axisBrowseName: 'J1',
    })
    expect(report.roboticsNamespaceUri).toBe('http://opcfoundation.org/UA/Robotics/')
    expect(report.actualPosition).toBeCloseTo(28.6478897565, 8)
    expect(report.engineeringUnit).toBe('degree')
    expect(report.euRange).toEqual({ low: -270, high: 270 })
    expect(report.writeStatusCode).toBe('BadNotWritable')
  } finally {
    await harness.stop()
  }
})

it('stages one atomic Object pose and reuses the retained duplicate result', async () => {
  const harness = await startTechnicalDemoGatewayServerWithBrowserLease({ browserCommandDelayMs: 250 })
  try {
    const command = {
      requestId: 'demo-object-pose-001',
      expiresAt: harness.nowMs() + 5_000,
      objectId: 'entity-demo-part',
      pose: { x: 0.6, y: 0.1, z: 0.2, roll: 0, pitch: 0, yaw: 90 },
    } as const
    const observed: ProductCommandResultProbeV1[] = []
    const first = await executeSceneObjectPoseCommandV1({
      endpointUrl: harness.endpointUrl,
      command,
      onObserved: (result) => observed.push(result),
    })
    const duplicate = await executeSceneObjectPoseCommandV1({
      endpointUrl: harness.endpointUrl,
      command,
    })

    expect(observed.map(({ acknowledgement, executionState }) => `${acknowledgement}/${executionState}`))
      .toEqual(['ACCEPTED/RUNNING', 'ACCEPTED/SUCCEEDED'])
    expect(first.executionState).toBe('SUCCEEDED')
    expect(duplicate).toEqual(first)
    expect(harness.sceneCommandCount(command.requestId)).toBe(1)
    expect(harness.objectPose(command.objectId)).toEqual(command.pose)
  } finally {
    await harness.stop()
  }
})
```

- [ ] **Step 2: Run RED**

Run:

```powershell
npm run test:run -- scripts/demo/opcua-technical-demo-client.test.ts middleware/runtime-gateway/opcua-server-adapter.test.ts
```

Expected: FAIL because the independent Client helpers do not exist.

- [ ] **Step 3: Define the black-box probe contracts**

```ts
export interface StandardRobotActualProbeV1 {
  readonly roboticsNamespaceUri: 'http://opcfoundation.org/UA/Robotics/'
  readonly motionDeviceCount: number
  readonly axisCount: number
  readonly actualPosition: number
  readonly engineeringUnit: 'degree' | 'millimetre'
  readonly euRange: Readonly<{ low: number; high: number }>
  readonly writeStatusCode: 'BadNotWritable'
}

export interface SceneObjectPoseCommandV1 {
  readonly requestId: string
  readonly expiresAt: number
  readonly objectId: string
  readonly pose: Readonly<{
    x: number; y: number; z: number
    roll: number; pitch: number; yaw: number
  }>
}

export interface ProductCommandResultProbeV1 {
  readonly requestId: string
  readonly acknowledgement: 'ACCEPTED' | 'REJECTED'
  readonly executionState: 'RUNNING' | 'SUCCEEDED' | 'FAILED'
  readonly failureCode: string | null
  readonly message: string
  readonly completedAt: number | null
}

export function probeStandardRobotActualV1(options: Readonly<{
  endpointUrl: string
  robotBrowseName: string
  axisBrowseName: string
}>): Promise<StandardRobotActualProbeV1>

export function executeSceneObjectPoseCommandV1(options: Readonly<{
  endpointUrl: string
  command: SceneObjectPoseCommandV1
  onObserved?: (result: ProductCommandResultProbeV1) => void
}>): Promise<ProductCommandResultProbeV1>
```

Resolve namespace indexes from `Server_NamespaceArray`, then resolve nodes by BrowseName and TypeDefinition. Never construct `ns=<fixed-index>` strings. For Robot Actual, verify the Robot instance is a subtype of Robotics `MotionDeviceType`, the Axis is `AxisType`, `ActualPosition` has `AccessLevel` without `CurrentWrite`, its `EngineeringUnits` matches its Joint kind, and its `EURange` equals the configured Joint limit after the single revolute-degree/prismatic-metre-to-millimetre exchange conversion. Attempt one write anyway and require `BadNotWritable`.

For the product Object command, use one OPC UA Session and write `RequestId`, `ExpiresAt`, `X`, `Y`, `Z`, `Roll`, `Pitch`, `Yaw`, and `Execute=false`; encode the command's epoch-millisecond `expiresAt` as an OPC UA `DateTime`, then write only `Execute=true`. Poll the matching Result at 50 ms intervals for at most five seconds. Require the returned RequestId to equal the staged value, invoke `onObserved` once for each distinct acknowledgement/execution-state transition, require a validated command to expose `ACCEPTED/RUNNING` before terminal, and return only `SUCCEEDED` or `FAILED` as terminal. A second helper call with the same RequestId is a new Session and must receive the retained terminal result without another Scene execution; because it may connect after completion, it is not required to replay the historical RUNNING observation.

- [ ] **Step 4: Run GREEN and prove namespace-index independence**

```powershell
npm run test:run -- scripts/demo/opcua-technical-demo-client.test.ts middleware/runtime-gateway/opcua-server-adapter.test.ts
rg -n "ns=[0-9]+;" scripts/demo/opcua-technical-demo-client.mjs scripts/demo/opcua-technical-demo-client.d.mts
```

Expected: tests PASS; the scan exits 1 with no fixed Namespace Index. `ActualPosition` is readable in degrees and its write returns `BadNotWritable`; the first product command observes Accepted/Running then Succeeded, and a duplicate RequestId returns the same terminal result and executes once.

- [ ] **Step 5: Commit the independent Client probe**

```powershell
git add scripts/demo/opcua-technical-demo-client.mjs scripts/demo/opcua-technical-demo-client.d.mts scripts/demo/opcua-technical-demo-client.test.ts
git diff --cached --check
git commit -m "test: probe robotics and product opc ua models"
```

### Task 4: Orchestrate the Native 4840-to-4841 Smoke

**Files:**
- Create: `scripts/demo/native-technical-demo.mjs`
- Create: `scripts/demo/native-technical-demo.d.mts`
- Test: `scripts/demo/native-technical-demo.test.ts`
- Create: `scripts/demo/serve-native-gateway-web.mjs`
- Modify: `vite.config.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: Task 1 fixture, Task 2 PLC Server, Task 3 probes, Gateway `/runtime/project`, `/runtime/state`, `/runtime/status`, `/runtime/command-lease`, and `/runtime/command` endpoints.
- Produces: `runNativeTechnicalDemoV1(options): Promise<NativeTechnicalDemoReportV1>` and a long-running Gateway/Web stack for Playwright.

- [ ] **Step 1: Write failing orchestration and cleanup tests**

```ts
it('runs the fixed native topology in deterministic order', async () => {
  const calls: string[] = []
  const report = await runNativeTechnicalDemoV1(nativeHarness({ calls }))
  expect(calls).toEqual([
    'plc:start:4840',
    'gateway:start:http=8081:opcua=4841',
    'project:activate:bridge',
    'client:connected',
    'state:publish',
    'robotics:probe',
    'setdo:first',
    'setdo:duplicate',
    'plc:stop',
    'client:reconnecting',
    'plc:restart:4840',
    'client:connected',
    'gateway:stop',
    'plc:stop',
  ])
  expect(report).toMatchObject({
    plcEndpointUrl: 'opc.tcp://127.0.0.1:4840',
    gatewayEndpointUrl: 'opc.tcp://127.0.0.1:4841',
    clampWriteCount: 1,
    reconnectRecovered: true,
  })
})

it('stops every started resource when activation fails', async () => {
  const calls: string[] = []
  await expect(runNativeTechnicalDemoV1(nativeHarness({
    calls,
    activationFailure: new Error('PROJECT_ACTIVATION_FAILED'),
  }))).rejects.toThrow('PROJECT_ACTIVATION_FAILED')
  expect(calls.at(-2)).toBe('gateway:stop')
  expect(calls.at(-1)).toBe('plc:stop')
})
```

- [ ] **Step 2: Run RED**

Run: `npm run test:run -- scripts/demo/native-technical-demo.test.ts`

Expected: FAIL because native orchestration does not exist.

- [ ] **Step 3: Implement the report and exact native sequence**

```ts
export interface NativeTechnicalDemoReportV1 {
  readonly projectId: 'opcua-technical-demo-v5'
  readonly configRevision: string
  readonly plcEndpointUrl: 'opc.tcp://127.0.0.1:4840'
  readonly gatewayEndpointUrl: 'opc.tcp://127.0.0.1:4841'
  readonly actualWriteStatusCode: 'BadNotWritable'
  readonly clampWriteCount: 1
  readonly firstCommandState: 'SUCCEEDED'
  readonly duplicateCommandState: 'SUCCEEDED'
  readonly reconnectDetectedMs: number
  readonly reconnectRecovered: true
}

export function runNativeTechnicalDemoV1(
  options?: NativeTechnicalDemoOptionsV1,
): Promise<NativeTechnicalDemoReportV1>
```

Start the Gateway with exactly:

```text
ROBOTSIM_RUNTIME_KIND=native
ROBOTSIM_GATEWAY_HOST=127.0.0.1
ROBOTSIM_GATEWAY_HTTP_PORT=8081
ROBOTSIM_OPCUA_PORT=4841
ROBOTSIM_OPCUA_ADVERTISE_HOST=127.0.0.1
ROBOTSIM_OPCUA_ADVERTISE_PORT=4841
```

Wait for `/healthz`, activate `examples/opcua-technical-demo/project-v5.json` through `PUT /runtime/project`, and require status `project.phase=ready`, `opcUa.mode=bridge`, `server.phase=listening`, and the PLC Endpoint `phase=connected`. Publish one exact Robot state batch for both Robots, run the Task 3 standard probe, acquire the Runtime command lease, and send `ClampCommand=true` twice with the same Command ID. Require identical `SUCCEEDED` results and PLC write count 1.

Stop the PLC, require Client phase `reconnecting` or `faulted` within one 2,000 ms Monitor interval plus 500 ms tolerance, restart the same PLC on 4840, and require `connected` without reactivating the Project. Stop resources in reverse start order in `finally`.

- [ ] **Step 4: Add the long-running native Gateway/Web process**

`serve-native-gateway-web.mjs` starts only the Gateway and Vite preview; the Playwright worker owns the PLC so it can disconnect/reconnect it. It must emit `[demo-stack] ready http://127.0.0.1:4174` only after Web `/` and Gateway `/healthz` are reachable, forward SIGINT/SIGTERM, and stop child processes in reverse order.

Share one runtime proxy object in Vite:

```ts
const runtimeProxy = {
  '/runtime': {
    target: 'http://127.0.0.1:8081',
    ws: true,
  },
}

export default defineConfig({
  plugins: [react()],
  server: { proxy: runtimeProxy },
  preview: { proxy: runtimeProxy },
})
```

Add these scripts:

```json
{
  "scripts": {
    "demo:virtual-plc": "node scripts/demo/virtual-plc-server.mjs",
    "demo:smoke:native": "node scripts/demo/native-technical-demo.mjs",
    "demo:serve:native": "node scripts/demo/serve-native-gateway-web.mjs"
  }
}
```

- [ ] **Step 5: Run unit GREEN and the real native smoke**

```powershell
npm run test:run -- scripts/demo/native-technical-demo.test.ts scripts/demo/virtual-plc-server.test.ts scripts/demo/opcua-technical-demo-client.test.ts
npm run build:gateway
npm run build
npm run demo:smoke:native
```

Expected: focused tests and builds PASS; native smoke prints one JSON report with ports 4840/4841, `BadNotWritable`, one Clamp write, and recovered reconnect. If 4840 is occupied by the user's PLC, record `BLOCKED: VIRTUAL_PLC_PORT_IN_USE` and do not terminate it or report the native smoke as passed.

- [ ] **Step 6: Commit native orchestration**

```powershell
git add scripts/demo/native-technical-demo.mjs scripts/demo/native-technical-demo.d.mts scripts/demo/native-technical-demo.test.ts scripts/demo/serve-native-gateway-web.mjs vite.config.ts package.json
git diff --cached --check
git commit -m "test: add native opc ua technical smoke"
```

### Task 5: Prove the Complete Browser Job, Persistence, and Reconnect Flow

**Files:**
- Create: `playwright.opcua-demo.config.ts`
- Create: `tests/opcua-technical-demo.spec.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: Task 2 in-process PLC, `demo:serve:native`, the accessible V5 App, OPC UA Settings/Monitor, Job editor/runtime, Project Save/Export/Import, and Task 3 product command helper.
- Produces: serial Browser acceptance evidence for success criteria 7, 8, 9, 10–18.

- [ ] **Step 1: Add the serial Playwright configuration**

```ts
import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests',
  testMatch: 'opcua-technical-demo.spec.ts',
  timeout: 300_000,
  workers: 1,
  fullyParallel: false,
  expect: { timeout: 15_000 },
  use: {
    actionTimeout: 15_000,
    baseURL: 'http://127.0.0.1:4174',
    headless: true,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'npm run build:e2e && npm run build:gateway && npm run demo:serve:native',
    url: 'http://127.0.0.1:4174',
    reuseExistingServer: false,
    timeout: 90_000,
  },
})
```

- [ ] **Step 2: Write the failing end-to-end test**

```ts
test.describe.serial('OPC UA technical demo', () => {
  let plc: VirtualPlcServerV1

  test.beforeAll(async () => {
    plc = await startVirtualPlcServer({ port: 4840 })
  })

  test.afterAll(async () => {
    await plc?.stop()
  })

  test('executes PLC I/O pick/place and survives persistence plus reconnect', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('menuitem', { name: 'Project', exact: true }).click()
    await page.getByRole('menuitem', { name: 'Samples', exact: true }).click()
    await page.getByRole('menuitem', { name: 'OPC UA Technical Demo', exact: true }).click()

    await expect(page.getByText('OPC UA Technical Demo', { exact: true })).toBeVisible()
    const scene = page.getByRole('tree', { name: 'Scene Objects' })
    for (const name of ['Robot A', 'Robot B', 'Demo Part', 'Demo Fixture']) {
      await expect(scene.getByRole('treeitem', { name, exact: true })).toBeVisible()
    }
    await expect(page.getByRole('main', { name: '3D viewport' }))
      .toHaveAttribute('aria-busy', 'false')

    await expect(page.getByRole('button', { name: /Gateway: Online/u }))
      .toBeVisible()
    await expect(page.getByRole('button', { name: /OPC UA: (Bridge|Connected)/u }))
      .toBeVisible()

    await plc.setObjectPose({
      x: 0.45, y: -0.15, z: 0.08, roll: 0, pitch: 0, yaw: 30, status: 20,
    })
    await scene.getByRole('treeitem', { name: 'Demo Fixture', exact: true }).click()
    await expect(page.getByRole('region', { name: 'Object Inspector' }))
      .toContainText(/X\s*450\.0 mm.*Y\s*-150\.0 mm.*Z\s*80\.0 mm.*Yaw\s*30\.0°.*Status\s*20/su)
    await plc.setRobotBJoints([5, -10, 15, -20, 25, -30])
    await scene.getByRole('treeitem', { name: 'Robot B', exact: true }).click()
    const jointInspector = page.getByRole('region', { name: 'Robot Joint Inspector' })
    await expect(jointInspector.getByLabel('J1')).toHaveValue('5')
    await expect(jointInspector).toContainText('Source: OPC UA (endpoint-demo-plc)')
    await expect(jointInspector.getByLabel('J1')).toBeDisabled()

    const job = page.getByRole('treeitem', {
      name: /PLC Pick and Place.*12 MoveJoint/u,
    })
    await job.click()
    await page.getByRole('button', { name: 'Teach Job' }).click()
    const dialog = page.getByRole('dialog', { name: 'Job Editor' })
    await expect(dialog.getByRole('listitem')).toHaveCount(18)
    await expect(dialog.getByText('MoveJoint')).toHaveCount(12)
    await dialog.getByRole('button', { name: 'Close' }).click()

    await page.getByRole('button', { name: 'Start Job' }).click()
    await expect(page.getByRole('status', { name: 'Robot Job state' }))
      .toContainText('WAITING', { timeout: 30_000 })
    await plc.setPartPresent(true)
    await expect(page.getByRole('status', { name: 'Robot Job state' }))
      .toContainText('SUCCEEDED', { timeout: 30_000 })
    expect(plc.writeCount('Signals/ClampCommand')).toBe(2)
    expect(plc.readClampCommand()).toBe(false)

    await page.getByRole('menuitem', { name: 'Project', exact: true }).click()
    await page.getByRole('menuitem', { name: 'Save', exact: true }).click()
    await page.reload()
    await expect(page.getByText('OPC UA Technical Demo', { exact: true })).toBeVisible()
    await expect(scene.getByRole('treeitem', { name: 'Robot A', exact: true })).toBeVisible()

    const downloadPromise = page.waitForEvent('download')
    await page.getByRole('menuitem', { name: 'Project', exact: true }).click()
    await page.getByRole('menuitem', { name: 'Export Project', exact: true }).click()
    const exported = await readDownloadedProject(await downloadPromise)
    expect(exported.schemaVersion).toBe(5)
    await importDownloadedProject(page, exported)
    await expect(page.getByText('OPC UA Technical Demo', { exact: true })).toBeVisible()

    await plc.stop()
    await page.getByRole('menuitem', { name: 'Connectivity', exact: true }).click()
    await page.getByRole('menuitem', { name: 'Connection Monitor…', exact: true }).click()
    const monitor = page.getByRole('complementary', { name: 'Connection Monitor' })
    await expect(monitor.getByRole('row', { name: /Virtual PLC.*Reconnecting|Virtual PLC.*Faulted/u }))
      .toBeVisible({ timeout: 2_500 })

    plc = await startVirtualPlcServer({ port: 4840 })
    await expect(monitor.getByRole('row', { name: /Virtual PLC.*Connected/u }))
      .toBeVisible({ timeout: 15_000 })
    await expect(page.getByText('OPC UA Technical Demo', { exact: true })).toBeVisible()

    const product = await executeSceneObjectPoseCommandV1({
      endpointUrl: 'opc.tcp://127.0.0.1:4841',
      command: {
        requestId: 'browser-demo-object-pose-001',
        expiresAt: Date.now() + 5_000,
        objectId: 'entity-demo-part',
        pose: { x: 0.7, y: 0.2, z: 0.1, roll: 0, pitch: 0, yaw: 45 },
      },
    })
    expect(product.executionState).toBe('SUCCEEDED')
  })
})
```

The expected Job editor count is 18: 12 MoveJoint instructions and six I/O/action instructions. Add a final assertion that the part is no longer attached and its World pose equals the commanded product pose within 0.5 mm and 0.1 degree through the Inspector's World-pose readout.

- [ ] **Step 3: Run RED and capture the first actionable failure**

Run: `npm run test:e2e:opcua-demo`

Expected: FAIL until the new config, script, accessible sample flow, and complete runtime integration exist. Preserve the Playwright trace for the first behavioral failure; do not weaken role/name assertions into CSS selectors.

- [ ] **Step 4: Wire the exact script and make the test GREEN**

```json
{
  "scripts": {
    "test:e2e:opcua-demo": "playwright test --config=playwright.opcua-demo.config.ts"
  }
}
```

Fix only integration gaps exposed by the black-box test. Use the V5 App publication and runtime ports; do not add test-only React state, hidden control buttons, sleep-only synchronization, or direct Three.js mutation. `WaitDI` must advance from the subscribed GOOD PLC value, `SetDO` must be observed by the PLC, Attach/Detach must pass through the action runtime, and product commands must pass through the Simulation command boundary.

- [ ] **Step 5: Run the Browser flow twice from clean state**

```powershell
npm run test:e2e:opcua-demo
npm run test:e2e:opcua-demo
```

Expected: both clean runs PASS. Each run shows two Robots and two Objects, one PLC-owned fixture pose/status update, one disabled/manual-proof OPC UA-owned Robot B Joint update, 12 MoveJoint instructions on Simulation-owned Robot A, WAITING before the PLC input transition, one successful Job, two authored Clamp writes (`true`, then `false`), preserved V5 save/export/import, disconnect within 2.5 seconds, reconnect on the same Project, and one successful product Object command.

- [ ] **Step 6: Commit the Browser acceptance**

```powershell
git add playwright.opcua-demo.config.ts tests/opcua-technical-demo.spec.ts package.json
git diff --cached --check
git commit -m "test: verify browser opc ua technical demo"
```

### Task 6: Extend the Docker Smoke Without Hiding Engine Failures

**Files:**
- Create: `scripts/deployment/technical-demo-smoke.mjs`
- Create: `scripts/deployment/technical-demo-smoke.d.mts`
- Test: `scripts/deployment/technical-demo-smoke.test.ts`
- Modify: `scripts/deployment/smoke-deployment.mjs`
- Modify: `scripts/deployment/smoke-deployment.test.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: Task 2 host PLC, Task 3 independent Client, existing `smokeDeployment`, Compose Web port 8080, Gateway HTTP proxy, `host.docker.internal:4840`, and Gateway Server port 4841.
- Produces: `runDockerTechnicalDemoSmokeV1(): Promise<DockerTechnicalDemoReportV1>` and `npm run deploy:smoke:technical-demo`.

- [ ] **Step 1: Write failing preflight, endpoint, probe, and teardown tests**

```ts
it('reports an unavailable engine as BLOCKED and never as pass', async () => {
  await expect(runDockerTechnicalDemoSmokeV1(harness({
    dockerInfoError: new Error('open //./pipe/dockerDesktopLinuxEngine: The system cannot find the file specified.'),
  }))).rejects.toThrow(
    'BLOCKED: DOCKER_ENGINE_UNAVAILABLE: docker info: open //./pipe/dockerDesktopLinuxEngine',
  )
})

it('uses host.docker.internal for PLC Client and 4841 for Gateway Server', async () => {
  const calls: string[] = []
  const report = await runDockerTechnicalDemoSmokeV1(harness({ calls }))
  expect(calls).toContain('sample:endpoint:opc.tcp://host.docker.internal:4840')
  expect(calls).toContain('probe:opc.tcp://127.0.0.1:4841')
  expect(report).toMatchObject({
    webUrl: 'http://127.0.0.1:8080',
    plcClientUrl: 'opc.tcp://host.docker.internal:4840',
    gatewayServerUrl: 'opc.tcp://127.0.0.1:4841',
  })
  expect(calls.at(-1)).toMatch(/compose:down/u)
})

it('tears down Compose and the PLC after a browser probe failure', async () => {
  const calls: string[] = []
  await expect(runDockerTechnicalDemoSmokeV1(harness({
    calls,
    browserFailure: new Error('JOB_TIMEOUT'),
  }))).rejects.toThrow('JOB_TIMEOUT')
  expect(calls.slice(-2)).toEqual(['compose:down', 'plc:stop'])
})
```

- [ ] **Step 2: Run RED**

Run:

```powershell
npm run test:run -- scripts/deployment/technical-demo-smoke.test.ts scripts/deployment/smoke-deployment.test.ts
```

Expected: FAIL because technical Docker orchestration does not exist.

- [ ] **Step 3: Implement the explicit Docker report and preflight**

```ts
export interface DockerTechnicalDemoReportV1 {
  readonly webUrl: 'http://127.0.0.1:8080'
  readonly plcClientUrl: 'opc.tcp://host.docker.internal:4840'
  readonly gatewayServerUrl: 'opc.tcp://127.0.0.1:4841'
  readonly composeHealthy: true
  readonly browserJobState: 'SUCCEEDED'
  readonly actualWriteStatusCode: 'BadNotWritable'
  readonly duplicateExecutedOnce: true
}

export function runDockerTechnicalDemoSmokeV1(): Promise<DockerTechnicalDemoReportV1>
```

Run `docker info --format '{{json .ServerVersion}}'` before starting the PLC or Compose. On nonzero exit, throw exactly `BLOCKED: DOCKER_ENGINE_UNAVAILABLE: docker info: <one-line stderr>`. Do not catch that error and turn it into an empty report. When available, start the host PLC at 4840, call `smokeDeployment` with `port=8080` and `opcUaPort=4841`, open the browser through Nginx, select the demo, require the auto-selected Docker Endpoint `host.docker.internal:4840`, execute the Job, then run the independent Client against 4841. Always run Compose down and stop the PLC in `finally`.

- [ ] **Step 4: Add the script and run deterministic unit GREEN**

```json
{
  "scripts": {
    "deploy:smoke:technical-demo": "node scripts/deployment/technical-demo-smoke.mjs"
  }
}
```

```powershell
npm run test:run -- scripts/deployment/technical-demo-smoke.test.ts scripts/deployment/smoke-deployment.test.ts scripts/deployment/validate-deployment.test.ts
npm run deploy:validate
docker compose config --quiet
```

Expected: tests PASS, static deployment validation prints `[deploy] static deployment contract valid`, and Compose config exits 0 without needing a running Engine.

- [ ] **Step 5: Run the real Docker smoke when the Engine is available**

```powershell
docker info
npm run deploy:smoke:technical-demo
```

Expected when available: both containers are healthy; browser Job succeeds; the container Client reaches host PLC 4840; the host Client reads Gateway 4841; standard Actual is not writable; duplicate RequestId executes once; cleanup removes the Compose project.

Expected on the currently observed unavailable Engine: `docker info` fails and the smoke records `BLOCKED: DOCKER_ENGINE_UNAVAILABLE` in the Build Log. Leave the Success Criterion and release checklist unchecked; do not report Docker validation as passed.

- [ ] **Step 6: Commit Docker technical-smoke support**

```powershell
git add scripts/deployment/technical-demo-smoke.mjs scripts/deployment/technical-demo-smoke.d.mts scripts/deployment/technical-demo-smoke.test.ts scripts/deployment/smoke-deployment.mjs scripts/deployment/smoke-deployment.test.ts package.json
git diff --cached --check
git commit -m "test: add docker opc ua technical smoke"
```

### Task 7: Publish the Runbook, Build Log, and Release Gate

**Files:**
- Create: `docs/operator/opcua-technical-demo.md`
- Create: `docs/verification/opcua-technical-demo-verification.md`
- Create: `docs/progress/2026-07-19-opcua-technical-demo-build-log.md`
- Modify: `README.md`
- Modify: `package.json`

**Interfaces:**
- Consumes: Tasks 1–6 and all Milestone 1–5 verification scripts.
- Produces: executable operator instructions, artifact-grounded evidence, and one release command that cannot turn a blocked Docker smoke into success.

- [ ] **Step 1: Write the operator runbook with exact native commands**

Document this terminal split:

```powershell
# Terminal 1: deterministic PLC Server
npm run demo:virtual-plc

# Terminal 2: Gateway
npm run build:gateway
$env:ROBOTSIM_RUNTIME_KIND = 'native'
$env:ROBOTSIM_GATEWAY_HOST = '127.0.0.1'
$env:ROBOTSIM_GATEWAY_HTTP_PORT = '8081'
$env:ROBOTSIM_OPCUA_PORT = '4841'
$env:ROBOTSIM_OPCUA_ADVERTISE_HOST = '127.0.0.1'
$env:ROBOTSIM_OPCUA_ADVERTISE_PORT = '4841'
npm run runtime:gateway

# Terminal 3: Browser
npm run dev -- --host 127.0.0.1 --port 5173
```

Then list the exact browser flow: load `Project > Samples > OPC UA Technical Demo`, open `Connectivity > Connection Monitor`, wait for Gateway Online/Bridge Connected, select `PLC Pick and Place`, start, change `PartPresent` to true through the PLC scenario, observe `SUCCEEDED`, and run the independent Client probe. State ports, Namespace URIs, expected Signal transitions, expected Job operations, and that standard Actual writes must fail.

- [ ] **Step 2: Write the Docker runbook and blocker semantics**

```powershell
$env:ROBOTSIM_OPCUA_PORT = '4841'
$env:ROBOTSIM_OPCUA_ADVERTISE_HOST = '127.0.0.1'
docker compose up -d --build --wait
docker compose ps
Invoke-WebRequest http://127.0.0.1:8080/runtime/healthz
Invoke-WebRequest http://127.0.0.1:8080/runtime/readyz
Invoke-WebRequest http://127.0.0.1:8080/runtime/status
npm run deploy:smoke:technical-demo
```

Explain that the host PLC is `127.0.0.1:4840`, the container uses `host.docker.internal:4840`, and the external Client uses `127.0.0.1:4841`. Include the exact `BLOCKED: DOCKER_ENGINE_UNAVAILABLE` rule and the operator command `docker info`; do not tell the user to enable privileged mode, mount `docker.sock`, or use host networking.

- [ ] **Step 3: Create the verification checklist and Build Log skeleton**

The Build Log starts with this exact known content:

```markdown
# Build Log

## Project
- Project name: OpenWebDigitalTwin OPC UA Technical Demo
- Track: Web Digital Twin / Industrial Interoperability
- User and problem: Validate browser Robot/Object interaction with PLC OPC UA data and a standard-facing Robot Server.

## Initial Brief
- Goal: Demonstrate two Robots, generic Objects, PLC I/O Job execution, and external OPC UA Server access.
- Context: Project V5 with Runtime Gateway Client, Server, and Bridge roles.
- Constraints: Ports 4840/4841; deterministic commands; no Legacy, security UI, physics, safety claim, or manufacturer generator.
- Done when: All 20 approved success criteria pass, including live Docker smoke.

## Key Delegations
## Failure & Recovery
## Verification
## Human Decisions
```

Under `Key Delegations`, append one `### Delegation N` entry for each agent actually used and record Purpose, Request, Result, and Next human decision from that agent's completion message. Under `Failure & Recovery`, record each observed failure, its evidence-backed cause, and the changed approach; if none occurred, write `No implementation failure observed.` Under `Verification`, paste each executed command, exact exit status/count, the observed browser flow, and unresolved limits. Under `Human Decisions`, copy the approved breaking decisions from the design specification and separately list the scope Codex implemented. Do not commit empty fields, illustrative values, or claimed command results that were not executed.

The verification document has one row per approved Success Criterion 1–20 with columns `Criterion`, `Evidence command`, `Evidence artifact`, and `Status`. Status is only `PASS`, `FAIL`, or `BLOCKED`; it is never prefilled as PASS.

- [ ] **Step 4: Add the release script and run every non-Docker gate**

```json
{
  "scripts": {
    "verify:opcua-demo": "npm run test:run && npm run lint && npm run cad:validate && npm run deploy:validate && npm run build:gateway && node dist-gateway/middleware/runtime-gateway/main.js --check-config && npm run build && npm run test:e2e:opcua-demo"
  }
}
```

```powershell
npm run verify:opcua-demo
npm run demo:smoke:native
git diff --check
git status --short
```

Expected: the unfiltered full unit suite, lint, CAD validation, static deployment validation, Gateway build, config check, browser build, Browser acceptance, and native smoke PASS. Record actual file/test counts and elapsed times; do not copy historical counts.

- [ ] **Step 5: Run the Docker release gate and classify the outcome truthfully**

```powershell
npm run deploy:smoke:technical-demo
```

If it passes, mark Criterion 19 Docker smoke PASS with the command output and Compose project name. If the Engine is unavailable, mark Criterion 19 and the overall release `BLOCKED: DOCKER_ENGINE_UNAVAILABLE`, retain the exact `docker info` error, and leave the plan incomplete. Unit-mocked Docker orchestration and `docker compose config --quiet` do not substitute for the live smoke.

- [ ] **Step 6: Scan prohibited claims and finalize documentation**

```powershell
npm run test:run -- src/app/v5-production-import-graph.test.ts src/features/ui/v4/app-menu-model.test.ts src/features/help/v4
rg -n -g "!*.test.*" -g "!*.spec.*" "Legacy Adoption|Compatibility Mode|automatic migration|manufacturer (Robot )?code generator|Generate (NED2|KUKA|FANUC)|Security Settings|Physics Engine|safety-rated|Robotics conformant|Robotics certified" src/app/v5 src/features/connectivity/v5 src/features/jobs/v5 src/features/ui/v4 src/features/help/v4 middleware/runtime-gateway
rg -n "conformant|certified|safety-rated|production security|manufacturer code generator|Legacy Adoption|automatic migration" README.md docs/operator/opcua-technical-demo.md docs/verification/opcua-technical-demo-verification.md docs/progress/2026-07-19-opcua-technical-demo-build-log.md
git diff --check
```

Expected: the production-import graph, menu, and Help tests PASS; the production-source scan has no executable UI/import/command implementation for a prohibited feature; and documentation contains no prohibited affirmative claim. Negative limitation statements are allowed only in documentation and must be reviewed/recorded individually in the verification matrix. The runbook may say explicitly that the prototype is not conformant, certified, safety-rated, or production-secured and does not include a manufacturer generator or Legacy migration.

- [ ] **Step 7: Commit release evidence**

```powershell
git add README.md package.json docs/operator/opcua-technical-demo.md docs/verification/opcua-technical-demo-verification.md docs/progress/2026-07-19-opcua-technical-demo-build-log.md
git diff --cached --check
git commit -m "docs: publish opc ua technical demo evidence"
```

## Completion Checklist

- [ ] Two visible NED2 Robot instances and at least two generic primitive Objects load from one Project V5 sample.
- [ ] Virtual PLC `RobotB/Joints` drives OPC UA-owned Robot B while local Joint inputs stay disabled; Robot A remains Simulation-owned for the Job.
- [ ] The primary Job contains exactly 12 MoveJoint instructions plus SetDO, WaitDI, Delay, Attach, and Detach in authored order.
- [ ] The host virtual PLC binds 127.0.0.1:4840; native and Docker Gateway Clients use the correct host forms.
- [ ] Gateway Server binds/advertises 127.0.0.1:4841 and loads official Standard, DI, IA, and Robotics NodeSets.
- [ ] A separate Client discovers namespaces by URI, reads standard Robot Actual and units, and receives `BadNotWritable` on Actual write.
- [ ] Revolute/prismatic `EURange` and units are read through a real Client with the single approved conversion boundary.
- [ ] SetDO performs one write per authored instruction and waits for terminal success.
- [ ] WaitDI requires a new subscribed GOOD value and cannot pass on stale retained data.
- [ ] Attach and Detach preserve World pose and never infer the Object from gripper state.
- [ ] Product Object pose command stages atomically, is observed as Accepted/Running, executes through the Simulation boundary, and returns a terminal Result.
- [ ] An identical duplicate RequestId returns the retained result and causes no duplicate Scene or PLC write.
- [ ] Save, IndexedDB reload, JSON export, and JSON import retain schema 5 and the canonical revision.
- [ ] PLC disconnect is visible within 2.5 seconds; reconnect recovers without Project replacement or silent Manual takeover.
- [ ] Native smoke, Browser Playwright, full unit tests, lint, CAD validation, Gateway/browser builds, config check, and static deployment validation pass.
- [ ] Live Docker Compose technical smoke passes; if the Engine is unavailable, the release remains BLOCKED and is not described as complete.
- [ ] Build Log contains actual commands, counts, failures, recovery, known limits, delegations, and human decisions.
- [ ] No manufacturer generator, Legacy surface, migration, security UI, physics engine, safety claim, or Robotics conformance claim is introduced.
