# Read-Only OPC UA Joint Source Gateway Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a browser-safe, read-only OPC UA source that maps named robot joints through a Node gateway, enforces exclusive Simulation/OPC UA ownership, and holds the last good pose on invalid or stale data.

**Architecture:** A server-only Node process owns OPC UA certificates, sessions, MonitoredItems, the allowlisted NodeId profiles, and reconnect behavior. Browser and gateway share one emitted local ESM protocol package, but the browser may request only a server-provisioned profile ID and can never authorize a NodeId. One coordinator slot per RobotInstance enforces exclusive Simulation/OPC UA ownership with generation-based late-frame rejection; the gateway assembles coherent instance-addressed frames and forwards them over an origin-checked WebSocket that fails closed outside loopback unless a reverse proxy supplies a valid upstream bearer credential.

**Tech Stack:** TypeScript 6, React 19, Zustand 5, Dexie 4, native WebSocket, Node.js 22, `node-opcua@2.175.0`, `ws@8.21.0`, Vitest 4, Playwright 1.61

## Global Constraints

- This plan starts only after the Frame Graph and Generic Robot plans are complete and reviewed.
- Consume `RobotDefinitionV1`, `RobotInstanceV1`, `orderedMovableJoints()`, `useRobotInstanceStore`, and `sceneDb` from those plans; do not recreate parallel owners.
- The checked-in CRB profile uses the Generic Robot plan's exact definition ID `crb15000-12kg-127` and revision `builtin-v1`; validation rejects any drift.
- Joint identity is `robotInstanceId + jointId`; array position alone is never an external contract.
- Internal revolute values use radians and prismatic values use metres.
- Simulation and OPC UA ownership are mutually exclusive for a RobotInstance.
- The OPC UA path is read-only. Do not call Write, Call, program-start, reset, or controller methods.
- Do not modify any PLC, Automation Studio project, PVI setting, global executable path, or target IP.
- The browser never receives OPC UA private keys and never opens `opc.tcp`.
- BAD or frames older than 1,000 ms hold the last good pose and pause playback
  at its current elapsed position; source switch/delete uses Stop and resets.
- Gateway default bind is loopback. A non-loopback bind fails startup unless origins are explicit, `GATEWAY_AUTH_MODE=reverse-proxy-bearer`, and a non-empty `GATEWAY_UPSTREAM_BEARER_TOKEN` is configured; every upgrade must then carry the matching reverse-proxy-injected `Authorization: Bearer` header.
- Browser subscribe messages contain a server-provisioned profile ID plus robot identity only. NodeIds, units, scale, offset, and direction come exclusively from the validated `GATEWAY_PROFILE_FILE`; client data can never widen the server allowlist.
- `RobotInstanceV1.sourceMode` is the persisted owner selection. Connection readiness, quality, accepted sequence, source objects, listeners, sockets, and timers are transient and keyed by RobotInstance ID.
- `RobotInstanceV1.opcUaProfileSelectionId` persists the reusable browser profile selection assigned to that instance; App never resolves an OPC source from one global active profile.
- A Simulation source `connect()` publishes one complete current named-joint frame synchronously before its returned Promise resolves, so switching back to Simulation cannot leave its controls permanently disabled.
- Keep gateway files out of the Vite client dependency graph.

---

## File Map

```text
packages/opcua-protocol/package.json
packages/opcua-protocol/tsconfig.json
packages/opcua-protocol/src/index.ts
src/domain/robot/joint-source.ts
src/domain/robot/joint-source.test.ts
src/domain/opcua/gateway-protocol.ts
src/domain/opcua/gateway-protocol.test.ts
src/features/joints/JointSourceCoordinator.ts
src/features/joints/JointSourceCoordinator.test.ts
src/features/joints/SimulationJointSource.ts
src/features/joints/SimulationJointSource.test.ts
src/features/joints/robot-source-deletion-adapter.ts
src/features/joints/robot-source-deletion-adapter.test.ts
src/features/joints/robot-playback-control.ts
src/features/joints/robot-playback-control.test.ts
src/features/opcua/OpcUaGatewayJointSource.ts
src/features/opcua/OpcUaGatewayJointSource.test.ts
src/features/opcua/RobotJointSourceManager.ts
src/features/opcua/RobotJointSourceManager.test.ts
src/features/opcua/opcua-profile-store.ts
src/features/opcua/opcua-profile-store.test.ts
src/features/opcua/OpcUaInspector.tsx
src/features/opcua/OpcUaInspector.test.tsx
gateway/src/config.ts
gateway/src/config.test.ts
gateway/src/frame-assembler.ts
gateway/src/frame-assembler.test.ts
gateway/src/opcua-adapter.ts
gateway/src/websocket-server.ts
gateway/src/index.ts
gateway/tsconfig.json
gateway/fixtures/allowed-profiles.json
scripts/test/mock-opcua-gateway.ts
scripts/test/mock-opcua-gateway.test.ts
scripts/verify/scan-credentials.ps1
scripts/verify/scan-opcua-readonly.ps1
e2e/opcua-source.spec.ts
docs/opcua-gateway.md
docs/operator/joint-source-modes.md
```

## Task 1: Define and Validate Named Joint Frames

**Files:**
- Create: `packages/opcua-protocol/package.json`
- Create: `packages/opcua-protocol/tsconfig.json`
- Create: `packages/opcua-protocol/src/index.ts`
- Create: `src/domain/robot/joint-source.ts`
- Create: `src/domain/robot/joint-source.test.ts`
- Modify: `src/features/robots/robot-instance-store.ts`
- Test: `src/features/robots/robot-instance-store.test.ts`
- Modify: `package.json`
- Modify: `package-lock.json`

**Interfaces:**
- Consumes: `RobotDefinitionV1`, `RobotInstanceV1`, `orderedMovableJoints()`.
- Produces: local package `@robot-sim/opcua-protocol`, shared `JointSourceMode`, `JointQuality`, `NamedJointValue`, `RobotJointFrame`, domain `RobotJointSource`, `validateRobotJointFrame()`, `reduceNamedJointFrame()`, and required persisted `RobotInstanceV1.sourceMode` plus nullable `opcUaProfileSelectionId`.

- [ ] **Step 1: Write failing contract tests**

```ts
it('accepts each movable joint exactly once regardless of wire order', () => {
  const frame = frameFor('robot-1', [
    { jointId: 'joint-b', value: 0.2 },
    { jointId: 'joint-a', value: 0.1 },
  ])
  expect(validateRobotJointFrame(definition, 'robot-1', frame, null, 1_000)).toEqual(frame)
})

it.each(['duplicate', 'missing', 'unknown', 'wrong-revision', 'out-of-order']) (
  'rejects %s named-joint input without changing the last good pose',
  (fault) => expect(() => validateFault(fault)).toThrow(),
)

it('holds the last good runtime pose for BAD or >1000ms data', () => {
  const result = reduceNamedJointFrame(runtimeState, definition, staleFrame, 2_001)
  expect(result.jointPositions).toEqual(runtimeState.jointPositions)
  expect(result.quality).toBe('STALE')
})

it('defaults a v3 persisted RobotInstance to Simulation without inventing persisted joints', () => {
  const restored = normalizeRobotInstanceSourceMode(legacyInstanceWithoutSourceMode())
  expect(restored.sourceMode).toBe('simulation')
  expect(restored.opcUaProfileSelectionId).toBeNull()
  expect(restored).toMatchObject(legacyInstanceMetadata)
  expect('jointPositions' in restored).toBe(false)
  expect(readRuntimeState('robot-1')).toEqual(runtimeState)
})
```

- [ ] **Step 2: Run the tests and verify RED**

Run: `npm run test:run -- src/domain/robot/joint-source.test.ts`

Expected: FAIL because the shared package, `joint-source.ts`, named-frame validation, and RobotInstance source ownership do not exist.

- [ ] **Step 3: Create the emitted shared protocol package**

Create `packages/opcua-protocol/package.json`:

```json
{
  "name": "@robot-sim/opcua-protocol",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    }
  },
  "files": ["dist"]
}
```

Create a standalone `packages/opcua-protocol/tsconfig.json`; do not extend either
application tsconfig:

```json
{
  "compilerOptions": {
    "target": "ES2023",
    "lib": ["ES2023"],
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "rootDir": "./src",
    "outDir": "./dist",
    "noEmit": false,
    "allowImportingTsExtensions": false,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "skipLibCheck": true
  },
  "include": ["src/**/*.ts"],
  "exclude": ["src/**/*.test.ts"]
}
```

`packages/opcua-protocol/src/index.ts` initially owns the transport-safe joint
types below. `src/domain/robot/joint-source.ts` imports and re-exports them; it
must not redeclare structurally similar wire types.

```ts
export type JointSourceMode = 'simulation' | 'opcua'
export type JointQuality = 'GOOD' | 'UNCERTAIN' | 'BAD' | 'STALE'
export type JointSourceStatus = JointQuality | 'CONNECTING' | 'DISCONNECTED'

export interface NamedJointValue {
  readonly jointId: string
  readonly value: number
}

export interface RobotJointFrame {
  readonly robotInstanceId: string
  readonly definitionRevision: string
  readonly values: readonly NamedJointValue[]
  readonly timestampMs: number
  readonly sequence: number
  readonly quality: JointQuality
}
```

Install the package as a local file dependency and add build ordering:

```powershell
npm install --save-exact ./packages/opcua-protocol
```

```json
{
  "scripts": {
    "protocol:build": "tsc -p packages/opcua-protocol/tsconfig.json",
    "dev": "npm run protocol:build && vite",
    "test": "npm run protocol:build && vitest",
    "test:run": "npm run protocol:build && vitest run",
    "test:coverage": "npm run protocol:build && vitest run --coverage",
    "build": "npm run protocol:build && tsc -b && vite build",
    "build:e2e": "npm run protocol:build && tsc -b && vite build --mode test"
  }
}
```

- [ ] **Step 4: Implement the domain contract and pure reducer**

```ts
import type {
  JointSourceMode,
  RobotJointFrame,
} from '@robot-sim/opcua-protocol'

export type {
  JointQuality,
  JointSourceMode,
  JointSourceStatus,
  NamedJointValue,
  RobotJointFrame,
} from '@robot-sim/opcua-protocol'

export interface RobotJointSource {
  readonly mode: JointSourceMode
  readonly robotInstanceId: string
  connect(): Promise<void>
  disconnect(): Promise<void>
  subscribe(listener: (frame: RobotJointFrame) => void): () => void
  subscribeStatus(listener: (status: JointSourceStatus) => void): () => void
}

export function validateRobotJointFrame(
  definition: RobotDefinitionV1,
  expectedRobotInstanceId: string,
  frame: RobotJointFrame,
  previousSequence: number | null,
  nowMs: number,
): RobotJointFrame {
  const expected = new Set(orderedMovableJoints(definition).map(({ id }) => id))
  const received = new Set<string>()
  if (frame.robotInstanceId !== expectedRobotInstanceId) throw new Error('Robot instance mismatch')
  if (frame.definitionRevision !== definition.revision) throw new Error('Robot definition revision mismatch')
  if (!Number.isInteger(frame.sequence) || frame.sequence < 0) throw new Error('Joint sequence must be a non-negative integer')
  if (previousSequence !== null && frame.sequence <= previousSequence) throw new Error('Joint frame is out of order')
  if (!Number.isFinite(frame.timestampMs) || frame.timestampMs > nowMs + 1_000) throw new Error('Joint timestamp is invalid')
  for (const value of frame.values) {
    if (!expected.has(value.jointId)) throw new Error(`Unknown joint: ${value.jointId}`)
    if (received.has(value.jointId)) throw new Error(`Duplicate joint: ${value.jointId}`)
    if (!Number.isFinite(value.value)) throw new Error(`Non-finite joint: ${value.jointId}`)
    received.add(value.jointId)
  }
  if (received.size !== expected.size) throw new Error('Joint frame is incomplete')
  return frame
}
```

Implement `reduceNamedJointFrame(runtime: RobotInstanceRuntimeState, ...)` so
BAD/STALE changes only transient quality while retaining joint positions;
GOOD/UNCERTAIN clamps bounded joints and applies values by ID to a new runtime
value. Timestamp/sequence live in the coordinator snapshot, and the coordinator
invokes Pause for bad quality. Continuous joints are not wrapped. The reducer
never controls playback and never returns or persists a `RobotInstanceV1`.

- [ ] **Step 5: Put source ownership on each RobotInstance**

Add `readonly sourceMode: JointSourceMode` and
`readonly opcUaProfileSelectionId: string | null` to `RobotInstanceV1`, set
them to `'simulation'`/`null` in every built-in/import factory, validate them on every store
mutation, and add this transitional row normalizer until Task 3 writes the DB
migration:

```ts
export function normalizeRobotInstanceSourceMode(
  record: RobotInstanceV1 | (Omit<RobotInstanceV1, 'sourceMode' | 'opcUaProfileSelectionId'> & {
    sourceMode?: unknown
    opcUaProfileSelectionId?: unknown
  }),
): RobotInstanceV1 {
  const sourceMode = record.sourceMode === undefined ? 'simulation' : record.sourceMode
  if (sourceMode !== 'simulation' && sourceMode !== 'opcua') {
    throw new Error(`Invalid RobotInstance source mode: ${String(sourceMode)}`)
  }
  const opcUaProfileSelectionId = record.opcUaProfileSelectionId === undefined
    ? null
    : record.opcUaProfileSelectionId
  if (opcUaProfileSelectionId !== null && typeof opcUaProfileSelectionId !== 'string') {
    throw new Error('Invalid OPC UA profile selection ID')
  }
  return { ...record, sourceMode, opcUaProfileSelectionId }
}
```

Wire named-frame application without creating a second writable joint owner.
The store implementation is private to a coordinator capability; it is not a
public Zustand action:

```ts
applyJointFrameFromCoordinator: (capability, frame, nowMs = Date.now()) => set((state) => {
  assertCurrentCoordinatorCapability(capability, frame.robotInstanceId)
  const instance = requireInstance(state, frame.robotInstanceId)
  const definition = requireEffectiveDefinition(instance)
  const runtime = requireRuntimeState(state, frame.robotInstanceId)
  const nextRuntime = reduceNamedJointFrame(runtime, definition, frame, nowMs)
  return replaceRuntimeState(state, frame.robotInstanceId, nextRuntime)
})
```

Keep the old CRB tuple selector as a temporary compatibility selector that
reads `J1` through `J6` from the named map. No second writable joint state is
allowed. `reduceNamedJointFrame()` consumes and returns the Generic Robot plan's
memory-only `RobotInstanceRuntimeState`; `RobotInstanceV1` persists source mode
and metadata only and is never rewritten for an incoming angle frame.
Remove/internalize Generic Robot's public `setJoint()`/Home mutation actions in
this task; render selectors remain public, while all writes must arrive through
the current coordinator capability.

- [ ] **Step 6: Run focused and regression tests**

Run: `npm run protocol:build`

Expected: PASS and emit `packages/opcua-protocol/dist/index.js` plus declarations.

Then run:

```powershell
node --input-type=module -e "await import('@robot-sim/opcua-protocol')"
```

Expected: exit 0 from a clean `npm ci` checkout after the protocol build. The
wrapped `dev`, interactive `test`, `test:run`, coverage, browser build, E2E
build, gateway test, and gateway build workflows all create the ignored package
output before resolving the package.

Then run: `npm run test:run -- src/domain/robot/joint-source.test.ts src/features/robots/robot-instance-store.test.ts src/domain/robot/joint-frame.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit**

```powershell
git add packages/opcua-protocol package.json package-lock.json src/domain/robot/joint-source.ts src/domain/robot/joint-source.test.ts src/features/robots/robot-instance-store.ts src/features/robots/robot-instance-store.test.ts src/domain/robot/joint-frame.ts src/domain/robot/joint-frame.test.ts
git diff --cached --check
git commit -m "refactor: use named robot joint frames"
```

## Task 2: Add Exclusive Source Ownership and Dynamic Simulation Source

**Files:**
- Create: `src/features/joints/JointSourceCoordinator.ts`
- Create: `src/features/joints/JointSourceCoordinator.test.ts`
- Modify: `src/features/joints/SimulationJointSource.ts`
- Create: `src/features/joints/SimulationJointSource.test.ts`
- Create: `src/features/joints/robot-source-deletion-adapter.ts`
- Create: `src/features/joints/robot-source-deletion-adapter.test.ts`
- Create: `src/features/joints/robot-playback-control.ts`
- Create: `src/features/joints/robot-playback-control.test.ts`
- Create: `src/features/joints/robot-simulation-mutation-gate.ts`
- Create: `src/features/joints/robot-simulation-mutation-gate.test.ts`
- Create: `src/features/joints/robot-manual-joint-commands.ts`
- Create: `src/features/joints/robot-manual-joint-commands.test.ts`
- Modify: `src/features/robots/robot-instance-store.ts`
- Test: `src/features/robots/robot-instance-store.test.ts`
- Modify: `src/features/joints/JointInspector.tsx`
- Modify: `src/features/joints/robot-simulation-mutation-gate.ts`
- Modify: `src/features/joints/robot-simulation-mutation-gate.test.ts`
- Test: `src/features/joints/JointInspector.test.tsx`
- Modify: `src/app/App.tsx`
- Modify: `src/features/ui/Timeline.tsx`
- Modify: `src/features/ui/Timeline.test.tsx`
- Modify: `src/features/robots/robot-instance-lifecycle.ts`
- Modify: `src/features/robots/robot-instance-lifecycle.test.ts`

**Interfaces:**
- Consumes: `RobotJointSource`, `RobotJointFrame`, `RobotInstanceV1.sourceMode`, and effective definitions by RobotInstance ID.
- Produces: one `JointSourceCoordinator` per RobotInstance through `JointSourceCoordinatorRegistry.forRobot()`, a RobotInstance-bound named-joint `SimulationJointSource`, isolated per-instance readiness/quality/sequence state, the stable per-instance `RobotPlaybackController` consumed later by the Pose plan, and one serialized `RobotSimulationMutationGate` shared by source changes, mechanical Apply, playback start, and Pose persistence.

- [ ] **Step 1: Write source-switch race tests**

```ts
it('disconnects the old source and ignores its late frames for the same robot', async () => {
  const coordinator = registry.forRobot('robot-a')
  await coordinator.switchSource(simulationA)
  const oldListener = simulationA.listener
  await coordinator.switchSource(opcuaA)
  oldListener(goodFrame({ sequence: 99 }))
  expect(applyFrame).not.toHaveBeenCalledWith(expect.objectContaining({ sequence: 99 }))
  expect(simulationA.disconnect).toHaveBeenCalledOnce()
})

it('switches two RobotInstances independently', async () => {
  const robotA = registry.forRobot('robot-a')
  const robotB = registry.forRobot('robot-b')
  await robotA.switchSource(opcuaA)
  await robotB.switchSource(simulationB)
  expect(robotA.snapshot()).toMatchObject({ mode: 'opcua', ready: false })
  expect(robotB.snapshot()).toMatchObject({ mode: 'simulation', ready: true })
  expect(opcuaA.disconnect).not.toHaveBeenCalled()
})

it('rolls back mode and source when a replacement connect fails', async () => {
  const coordinator = registry.forRobot('robot-a')
  await coordinator.switchSource(simulationA)
  await expect(coordinator.switchSource(rejectingOpcUaA)).rejects.toThrow('connect failed')
  expect(readInstance('robot-a').sourceMode).toBe('simulation')
  expect(simulationA.connect).toHaveBeenCalledTimes(2)
  expect(coordinator.snapshot()).toMatchObject({ mode: 'simulation', ready: true })
})

it('clears every source reference when pending-frame acceptance and rollback both fail', async () => {
  const coordinator = registry.forRobot('robot-a')
  await coordinator.switchSource(simulationA)
  dependencies.failNextModeCommitFor('robot-a', 'simulation', new Error('rollback write failed'))
  const invalidInitial = opcUaSourceWithInitialFrame(incompleteFrame())
  await expect(coordinator.switchSource(invalidInitial)).rejects.toThrow(AggregateError)
  expect(coordinator.sourceForTest()).toBeNull()
  expect(coordinator.rollbackBaselineForTest()).toBeNull()
  expect(coordinator.snapshot()).toMatchObject({ ready: false, status: 'DISCONNECTED' })
  expect(readPlayback('robot-a')).toMatchObject({ playing: false, elapsedMs: 0 })
  expect(coordinator.snapshot().lastAcceptedSequence).toBeNull()
})

it('lets only the newest same-robot switch win a connection race', async () => {
  const coordinator = registry.forRobot('robot-a')
  const first = coordinator.switchSource(deferredOpcUaA)
  const second = coordinator.switchSource(simulationA)
  deferredOpcUaA.resolveConnect()
  await Promise.all([first, second])
  expect(coordinator.snapshot()).toMatchObject({ mode: 'simulation', ready: true })
})

it('keeps the last request when connect and persisted-mode commit are both deferred', async () => {
  const coordinator = registry.forRobot('robot-a')
  dependencies.deferModeCommits()
  const first = coordinator.switchSource(deferredOpcUaA)
  deferredOpcUaA.resolveConnect()
  await dependencies.waitForModeCommit('robot-a', 'opcua')
  const second = coordinator.switchSource(simulationA)
  dependencies.resolveModeCommitAgainstCurrentGeneration()
  await first
  dependencies.resolveModeCommitAgainstCurrentGeneration()
  await second
  expect(readPersistedInstance('robot-a').sourceMode).toBe('simulation')
  expect(coordinator.snapshot()).toMatchObject({ mode: 'simulation', ready: true })
  expect(simulationA.disconnect).not.toHaveBeenCalled()
})

it('restores the last committed source when a superseding candidate fails', async () => {
  const coordinator = registry.forRobot('robot-a')
  await coordinator.switchSource(simulationA)
  const first = coordinator.switchSource(deferredOpcUaA)
  const second = coordinator.switchSource(rejectingOpcUaB)
  deferredOpcUaA.resolveConnect()
  await first
  await expect(second).rejects.toThrow('connect failed')
  expect(simulationA.connect).toHaveBeenCalledTimes(2)
  expect(coordinator.snapshot()).toMatchObject({ mode: 'simulation', ready: true })
})

it('replays a pre-commit GOOD frame then DISCONNECTED status in arrival order', async () => {
  dependencies.deferModeCommits()
  const switching = registry.forRobot('robot-a').switchSource(opcuaA)
  await dependencies.waitForModeCommit('robot-a', 'opcua')
  opcuaA.emit(goodFrame())
  opcuaA.emitStatus('DISCONNECTED')
  dependencies.resolveModeCommitAgainstCurrentGeneration()
  await switching
  expect(registry.forRobot('robot-a').snapshot()).toMatchObject({
    ready: false, status: 'DISCONNECTED',
  })
})

it('replays pre-commit CONNECTING then GOOD frame in arrival order', async () => {
  dependencies.deferModeCommits()
  const switching = registry.forRobot('robot-a').switchSource(opcuaA)
  await dependencies.waitForModeCommit('robot-a', 'opcua')
  opcuaA.emitStatus('CONNECTING')
  opcuaA.emit(goodFrame())
  dependencies.resolveModeCommitAgainstCurrentGeneration()
  await switching
  expect(registry.forRobot('robot-a').snapshot()).toMatchObject({ ready: true, status: 'GOOD' })
})

it('invalidates a queued Simulation mutation before an ownership transition commits', async () => {
  const lease = mutationGate.beginSimulationMutation('robot-a')
  mutationGate.deferBeforeCommit('robot-a')
  const mutation = mutationGate.runIfCurrent(lease, commitMechanicalFixture)
  await mutationGate.waitUntilCommitBoundary('robot-a')
  const switching = registry.forRobot('robot-a').switchSource(opcuaA)
  mutationGate.releaseCommitBoundary('robot-a')
  await expect(mutation).rejects.toThrow(/ownership changed/i)
  await switching
  expect(commitMechanicalFixture).not.toHaveBeenCalled()
  expect(readInstance('robot-a').sourceMode).toBe('opcua')
})

it('rejects new mutations while a source transition is pending and reopens after rollback', async () => {
  const coordinator = registry.forRobot('robot-a')
  await coordinator.switchSource(simulationA)
  const switching = coordinator.switchSource(deferredOpcUaA)
  expect(() => mutationGate.beginSimulationMutation('robot-a')).toThrow(/transition.*pending/i)
  deferredOpcUaA.rejectConnect(new Error('connect failed'))
  await expect(switching).rejects.toThrow('connect failed')
  expect(() => mutationGate.beginSimulationMutation('robot-a')).not.toThrow()
  expect(readInstance('robot-a').sourceMode).toBe('simulation')
})

it('keeps the old mode retryable and reports DISCONNECTED when old-source detach fails', async () => {
  const coordinator = registry.forRobot('robot-a')
  await coordinator.switchSource(simulationA)
  simulationA.disconnect.mockRejectedValueOnce(new Error('detach failed'))
  await expect(coordinator.switchSource(opcuaA)).rejects.toThrow(/detach failed/)
  expect(readPersistedInstance('robot-a').sourceMode).toBe('simulation')
  expect(coordinator.snapshot()).toMatchObject({ ready: false, status: 'DISCONNECTED' })
  simulationA.listener(goodFrame({ sequence: 99 }))
  expect(applyFrame).not.toHaveBeenCalledWith('robot-a', expect.objectContaining({ sequence: 99 }))
  simulationA.disconnect.mockResolvedValueOnce(undefined)
  await coordinator.switchSource(opcuaA)
  expect(coordinator.snapshot().mode).toBe('opcua')
})

it('publishes a complete initial Simulation frame synchronously during connect', async () => {
  const source = new SimulationJointSource('robot-b', () => snapshotFor('robot-b'))
  const listener = vi.fn()
  source.subscribe(listener)
  const pending = source.connect()
  expect(listener).toHaveBeenCalledOnce()
  expect(listener.mock.calls[0]![0].values.map(({ jointId }) => jointId)).toEqual(['P1', 'P2'])
  await pending
})

it.each(['BAD', 'STALE'] as const)('does not become ready from an initial %s frame', async (quality) => {
  const coordinator = registry.forRobot('robot-a')
  await coordinator.switchSource(opcuaA)
  setPlaybackElapsed('robot-a', 500)
  pausePlayback.mockClear()
  opcuaA.emit(goodFrame({ quality }))
  expect(coordinator.snapshot()).toMatchObject({ mode: 'opcua', ready: false, status: quality })
  expect(readRuntimeState('robot-a').jointPositions).toEqual(lastGoodPositions)
  expect(coordinator.snapshot().lastGoodTimestampMs).toBe(lastGoodTimestampMs)
  expect(pausePlayback).toHaveBeenCalledOnceWith('robot-a', 'source-quality')
  expect(readPlaybackElapsed('robot-a')).toBe(500)
})

it('normalizes an old wire-GOOD frame to STALE before readiness and pause decisions', async () => {
  const coordinator = registry.forRobot('robot-a')
  await coordinator.switchSource(opcuaA)
  setPlaybackElapsed('robot-a', 500)
  opcuaA.emit(goodFrame({ quality: 'GOOD', timestampMs: nowMs - 1_001 }))
  expect(coordinator.snapshot()).toMatchObject({ ready: false, status: 'STALE' })
  expect(readRuntimeState('robot-a').jointPositions).toEqual(lastGoodPositions)
  expect(readPlaybackElapsed('robot-a')).toBe(500)
})

it('lowers readiness on reconnect/disconnect status without moving the last good pose', async () => {
  const coordinator = registry.forRobot('robot-a')
  await coordinator.switchSource(opcuaA)
  opcuaA.emit(goodFrame())
  const lastGood = readRuntimeState('robot-a').jointPositions
  opcuaA.emitStatus('CONNECTING')
  expect(coordinator.snapshot()).toMatchObject({ ready: false, status: 'CONNECTING' })
  opcuaA.emitStatus('DISCONNECTED')
  expect(coordinator.snapshot()).toMatchObject({ ready: false, status: 'DISCONNECTED' })
  expect(readRuntimeState('robot-a').jointPositions).toEqual(lastGood)
})

it.each(['BAD', 'STALE'] as const)('deduplicates matching %s status and frame into one pause/event', async (quality) => {
  const coordinator = registry.forRobot('robot-a')
  await coordinator.switchSource(opcuaA)
  opcuaA.emit(goodFrame())
  pausePlayback.mockClear()
  opcuaA.emitStatus(quality)
  opcuaA.emit(goodFrame({ quality }))
  expect(pausePlayback).toHaveBeenCalledOnceWith('robot-a', 'source-quality')
  expect(sourceQualityEvents('robot-a', quality)).toHaveLength(1)
})

it('quiesces for transactional deletion, resumes on rollback, and finalizes without late frames', async () => {
  await registry.forRobot('robot-a').switchSource(opcuaA)
  const token = await deletionAdapter.quiesce('robot-a')
  await deletionAdapter.withDeletionBarrier(token, async () => {
    opcuaA.listener(goodFrame({ sequence: 99 }))
    expect(applyFrame).not.toHaveBeenCalledWith(
      'robot-a', expect.objectContaining({ sequence: 99 }),
    )
    expect(() => mutationGate.beginSimulationMutation('robot-a'))
      .toThrow(/instance-delete.*pending/i)
    await simulateRolledBackDeleteTransaction()
  })
  await deletionAdapter.resume(token)
  expect(opcuaA.connect).toHaveBeenCalledTimes(2)
  const committed = await deletionAdapter.quiesce('robot-a')
  await deletionAdapter.withDeletionBarrier(committed, async () => {
    await simulateCommittedDeleteTransaction()
  })
  await deletionAdapter.finalizeDelete(committed)
  expect(registry.hasRobot('robot-a')).toBe(false)
  expect(readSourceRuntime('robot-a')).toBeUndefined()
})

it('pauses one RobotInstance without resetting elapsed and stops only the switched instance', () => {
  seedPlayback('robot-a', { playing: true, elapsedMs: 500 })
  seedPlayback('robot-b', { playing: true, elapsedMs: 700 })
  playbackController.pausePlayback('robot-a', 'source-quality')
  expect(readPlayback('robot-a')).toMatchObject({ playing: false, elapsedMs: 500 })
  expect(readPlayback('robot-b')).toMatchObject({ playing: true, elapsedMs: 700 })
  playbackController.stopPlayback('robot-a')
  expect(readPlayback('robot-a')).toMatchObject({ playing: false, elapsedMs: 0 })
  expect(readPlayback('robot-b')).toMatchObject({ playing: true, elapsedMs: 700 })
})

it('serializes explicit Disconnect, resets playback/sequence, and rejects a queued mutation', async () => {
  const coordinator = registry.forRobot('robot-a')
  await coordinator.switchSource(simulationA)
  seedPlayback('robot-a', { playing: false, elapsedMs: 500 })
  seedAcceptedSequence('robot-a', 12)
  mutationGate.deferBeforeCommit('robot-a')
  const lease = mutationGate.beginSimulationMutation('robot-a')
  const mutation = mutationGate.runIfCurrent(lease, commitPoseFixture)
  await mutationGate.waitUntilCommitBoundary('robot-a')
  const disconnect = coordinator.disconnect()
  mutationGate.releaseCommitBoundary('robot-a')
  await expect(mutation).rejects.toThrow(/ownership changed/i)
  await disconnect
  expect(commitPoseFixture).not.toHaveBeenCalled()
  expect(readPlayback('robot-a')).toMatchObject({ playing: false, elapsedMs: 0 })
  expect(coordinator.snapshot()).toMatchObject({
    ready: false, status: 'DISCONNECTED', lastAcceptedSequence: null,
  })
})

it('exposes no raw joint setter and authorizes manual commands only through ready Simulation', async () => {
  expect(useRobotInstanceStore.getState()).not.toHaveProperty('setJoint')
  expect(useRobotInstanceStore.getState()).not.toHaveProperty('home')
  const before = readRuntimeState('robot-a').jointPositions
  await registry.forRobot('robot-a').switchSource(opcuaA)
  expect(() => manualJointCommands.setJoint('robot-a', 'J1', 0.5)).toThrow(/Simulation/i)
  expect(() => manualJointCommands.home('robot-a')).toThrow(/Simulation/i)
  expect(readRuntimeState('robot-a').jointPositions).toEqual(before)

  const pending = registry.forRobot('robot-a').switchSource(deferredSimulationA)
  expect(() => manualJointCommands.setJoint('robot-a', 'J1', 0.5)).toThrow(/transition.*pending/i)
  deferredSimulationA.resolveConnect()
  await pending
  manualJointCommands.setJoint('robot-a', 'J1', 0.5)
  expect(readRuntimeState('robot-a').jointPositions.J1).toBe(0.5)
  manualJointCommands.home('robot-a')
  expect(readRuntimeState('robot-a').jointPositions).toEqual(homeJointMap('robot-a'))
})
```

- [ ] **Step 2: Run RED**

Run: `npm run test:run -- src/features/joints/JointSourceCoordinator.test.ts src/features/joints/SimulationJointSource.test.ts src/features/joints/robot-playback-control.test.ts src/features/joints/robot-simulation-mutation-gate.test.ts src/features/joints/robot-manual-joint-commands.test.ts src/features/joints/robot-source-deletion-adapter.test.ts src/features/robots/robot-instance-lifecycle.test.ts`

Expected: FAIL because the coordinator does not exist and Simulation source is fixed to six values.

- [ ] **Step 3: Implement isolated generation-safe coordinators**

```ts
export type RobotPlaybackPauseReason =
  | 'collision'
  | 'source-quality'
  | 'revision-change'

export interface RobotPlaybackController {
  pausePlayback(robotInstanceId: string, reason: RobotPlaybackPauseReason): void
  stopPlayback(robotInstanceId: string): void
}

export interface RobotSimulationMutationLease {
  readonly robotInstanceId: string
  readonly generation: number
  readonly kind: 'simulation-mutation'
}

export interface RobotMutationTransition {
  readonly robotInstanceId: string
  readonly generation: number
  readonly kind: 'source-change' | 'playback-start' | 'instance-delete'
}

export interface RobotSimulationMutationGate {
  assertSimulationEditable(robotInstanceId: string): void
  beginSimulationMutation(robotInstanceId: string): RobotSimulationMutationLease
  runIfCurrent<T>(lease: RobotSimulationMutationLease, operation: () => Promise<T>): Promise<T>
  requestTransition(
    robotInstanceId: string,
    kind: RobotMutationTransition['kind'],
  ): RobotMutationTransition
  runTransition<T>(transition: RobotMutationTransition, operation: () => Promise<T>): Promise<T>
  completeTransition(transition: RobotMutationTransition): void
  registerTransitionCleanup(robotInstanceId: string, cleanup: () => void): () => void
}

export interface JointSourceSnapshot {
  readonly mode: JointSourceMode
  readonly sourceGeneration: number
  readonly ready: boolean
  readonly status: JointSourceStatus
  readonly lastAcceptedSequence: number | null
  readonly lastGoodTimestampMs: number | null
}

export interface CoordinatorDependencies {
  getInstance(robotInstanceId: string): RobotInstanceV1
  getSourceState(robotInstanceId: string): JointSourceSnapshot
  setRequestedGeneration(robotInstanceId: string, generation: number): void
  getRequestedGeneration(robotInstanceId: string): number
  commitSourceModeIfCurrent(
    robotInstanceId: string,
    mode: JointSourceMode,
    generation: number,
    transition: RobotMutationTransition,
  ): Promise<boolean>
  setSourceState(
    robotInstanceId: string,
    ready: boolean,
    status: JointSourceStatus,
  ): void
  applyFrame(robotInstanceId: string, frame: RobotJointFrame): JointQuality
  resetAcceptedSequence(robotInstanceId: string): void
  stopPlayback(robotInstanceId: string): void
  pausePlayback(robotInstanceId: string, reason: 'source-quality'): void
  reportDiagnostic(robotInstanceId: string, code: 'SOURCE_PRECOMMIT_OVERFLOW'): void
  mutationGate: RobotSimulationMutationGate
}

type PendingSourceEvent =
  | { readonly kind: 'frame'; readonly frame: RobotJointFrame }
  | { readonly kind: 'status'; readonly status: JointSourceStatus }

const MAX_PENDING_SOURCE_EVENTS = 128

export class JointSourceCoordinator {
  #generation = 0
  #tail: Promise<void> = Promise.resolve()
  #source: RobotJointSource | null = null
  #rollbackBaseline: RobotJointSource | null = null
  #unsubscribe: (() => void) | null = null

  constructor(
    readonly robotInstanceId: string,
    private readonly dependencies: CoordinatorDependencies,
  ) {}

  switchSource(source: RobotJointSource): Promise<void> {
    if (source.robotInstanceId !== this.robotInstanceId) {
      return Promise.reject(new Error('Joint source RobotInstance mismatch'))
    }
    const transition = this.dependencies.mutationGate.requestTransition(
      this.robotInstanceId,
      'source-change',
    )
    const generation = ++this.#generation
    this.dependencies.setRequestedGeneration(this.robotInstanceId, generation)
    const work = this.#tail.then(() => this.performSwitch(source, generation, transition))
    const operation = work.finally(() => this.dependencies.mutationGate.completeTransition(transition))
    this.#tail = operation.catch(() => undefined)
    return operation
  }

  private async performSwitch(
    source: RobotJointSource,
    generation: number,
    transition: RobotMutationTransition,
  ): Promise<void> {
    if (!this.isCurrent(generation)) return
    const previous = this.#source ?? this.#rollbackBaseline
    const previousMode = this.dependencies.getInstance(this.robotInstanceId).sourceMode
    this.dependencies.stopPlayback(this.robotInstanceId)
    this.dependencies.resetAcceptedSequence(this.robotInstanceId)
    this.dependencies.setSourceState(this.robotInstanceId, false, 'CONNECTING')
    await this.detachCurrent()
    if (!this.isCurrent(generation)) return

    let acceptLiveEvents = false
    let overflowReported = false
    const pendingEvents: PendingSourceEvent[] = []
    const queuePending = (event: PendingSourceEvent): void => {
      if (pendingEvents.length === MAX_PENDING_SOURCE_EVENTS) {
        pendingEvents.shift()
        if (!overflowReported) {
          overflowReported = true
          this.dependencies.reportDiagnostic(this.robotInstanceId, 'SOURCE_PRECOMMIT_OVERFLOW')
        }
      }
      pendingEvents.push(event)
    }
    const unsubscribeFrames = source.subscribe((frame) => {
      if (!this.isCurrent(generation) || frame.robotInstanceId !== this.robotInstanceId) return
      if (!acceptLiveEvents) {
        queuePending({ kind: 'frame', frame })
        return
      }
      this.acceptFrame(frame)
    })
    const unsubscribeStatus = source.subscribeStatus((status) => {
      if (!this.isCurrent(generation)) return
      if (!acceptLiveEvents) {
        queuePending({ kind: 'status', status })
        return
      }
      this.acceptStatus(status)
    })
    const unsubscribe = () => {
      unsubscribeFrames()
      unsubscribeStatus()
    }
    try {
      await source.connect()
      if (!this.isCurrent(generation)) {
        unsubscribe()
        await source.disconnect()
        return
      }
      const modeCommitted = await this.dependencies.commitSourceModeIfCurrent(
        this.robotInstanceId,
        source.mode,
        generation,
        transition,
      )
      if (!modeCommitted || !this.isCurrent(generation)) {
        unsubscribe()
        await source.disconnect()
        return
      }
      this.#source = source
      this.#rollbackBaseline = source
      this.#unsubscribe = unsubscribe
      while (pendingEvents.length > 0) {
        const event = pendingEvents.shift()!
        if (event.kind === 'frame') this.acceptFrame(event.frame)
        else this.acceptStatus(event.status)
      }
      acceptLiveEvents = true
    } catch (error) {
      unsubscribe()
      await source.disconnect().catch(() => undefined)
      if (this.isCurrent(generation)) {
        try {
          await this.restorePrevious(previous, previousMode, generation, transition)
        } catch (rollbackError) {
          this.clearFailedSlot()
          throw new AggregateError([error, rollbackError], 'Joint source switch and rollback failed')
        }
      }
      throw error
    }
  }

  disconnect(): Promise<void> {
    const transition = this.dependencies.mutationGate.requestTransition(
      this.robotInstanceId,
      'source-change',
    )
    const generation = ++this.#generation
    this.dependencies.setRequestedGeneration(this.robotInstanceId, generation)
    this.dependencies.stopPlayback(this.robotInstanceId)
    this.dependencies.resetAcceptedSequence(this.robotInstanceId)
    const work = this.#tail.then(() => this.dependencies.mutationGate.runTransition(
      transition,
      async () => {
        if (!this.isCurrent(generation)) return
        await this.detachCurrent()
        if (this.isCurrent(generation)) {
          this.#rollbackBaseline = null
          this.dependencies.setSourceState(this.robotInstanceId, false, 'DISCONNECTED')
        }
      },
    ))
    const operation = work.finally(() => this.dependencies.mutationGate.completeTransition(transition))
    this.#tail = operation.catch(() => undefined)
    return operation
  }

  snapshot(): JointSourceSnapshot {
    return this.dependencies.getSourceState(this.robotInstanceId)
  }

  private isCurrent(generation: number): boolean {
    return generation === this.#generation &&
      generation === this.dependencies.getRequestedGeneration(this.robotInstanceId)
  }

  private acceptFrame(frame: RobotJointFrame): void {
    const quality = this.dependencies.applyFrame(this.robotInstanceId, frame)
    const ready = quality === 'GOOD' || quality === 'UNCERTAIN'
    this.transitionStatus(quality, ready)
  }

  private acceptStatus(status: JointSourceStatus): void {
    const frameQuality = status === 'GOOD' || status === 'UNCERTAIN'
    const ready = frameQuality ? this.snapshot().ready : false
    this.transitionStatus(status, ready)
  }

  private transitionStatus(status: JointSourceStatus, ready: boolean): void {
    const previous = this.snapshot()
    const enteringBadQuality = (status === 'BAD' || status === 'STALE') &&
      (previous.status !== status || previous.ready)
    if (enteringBadQuality) {
      this.dependencies.pausePlayback(this.robotInstanceId, 'source-quality')
    }
    this.dependencies.setSourceState(this.robotInstanceId, ready, status)
  }

  private async detachCurrent(): Promise<void> {
    const source = this.#source
    const unsubscribe = this.#unsubscribe
    this.#unsubscribe = null
    if (source === null) {
      unsubscribe?.()
      return
    }
    try {
      unsubscribe?.()
      await source.disconnect()
      if (this.#source === source) this.#source = null
    } catch (error) {
      // Retain the source object only so a later explicit retry can disconnect it;
      // its listeners are already inert and it cannot publish frames.
      this.dependencies.setSourceState(this.robotInstanceId, false, 'DISCONNECTED')
      throw new Error('Current joint source detach failed', { cause: error })
    }
  }

  private async restorePrevious(
    previous: RobotJointSource | null,
    previousMode: JointSourceMode,
    generation: number,
    transition: RobotMutationTransition,
  ): Promise<void> {
    const modeCommitted = await this.dependencies.commitSourceModeIfCurrent(
      this.robotInstanceId,
      previousMode,
      generation,
      transition,
    )
    if (!modeCommitted || !this.isCurrent(generation)) return
    this.dependencies.resetAcceptedSequence(this.robotInstanceId)
    if (previous === null) {
      this.#rollbackBaseline = null
      this.dependencies.setSourceState(this.robotInstanceId, false, 'DISCONNECTED')
      return
    }
    this.dependencies.setSourceState(this.robotInstanceId, false, 'CONNECTING')
    const unsubscribeFrames = previous.subscribe((frame) => {
      if (this.isCurrent(generation) && frame.robotInstanceId === this.robotInstanceId) {
        this.acceptFrame(frame)
      }
    })
    const unsubscribeStatus = previous.subscribeStatus((status) => {
      if (this.isCurrent(generation)) this.acceptStatus(status)
    })
    const unsubscribe = () => {
      unsubscribeFrames()
      unsubscribeStatus()
    }
    try {
      await previous.connect()
      if (!this.isCurrent(generation)) {
        unsubscribe()
        await previous.disconnect()
        return
      }
      this.#source = previous
      this.#rollbackBaseline = previous
      this.#unsubscribe = unsubscribe
    } catch (error) {
      unsubscribe()
      await previous.disconnect().catch(() => undefined)
      this.#source = null
      this.#rollbackBaseline = null
      this.#unsubscribe = null
      this.dependencies.setSourceState(this.robotInstanceId, false, 'DISCONNECTED')
      throw error
    }
  }

  private clearFailedSlot(): void {
    this.#unsubscribe?.()
    this.#unsubscribe = null
    this.#source = null
    this.#rollbackBaseline = null
    this.dependencies.stopPlayback(this.robotInstanceId)
    this.dependencies.resetAcceptedSequence(this.robotInstanceId)
    this.dependencies.setSourceState(this.robotInstanceId, false, 'DISCONNECTED')
  }
}

export class JointSourceCoordinatorRegistry {
  readonly #byRobot = new Map<string, JointSourceCoordinator>()

  constructor(private readonly dependencies: CoordinatorDependencies) {}

  forRobot(robotInstanceId: string): JointSourceCoordinator {
    const existing = this.#byRobot.get(robotInstanceId)
    if (existing !== undefined) return existing
    const created = new JointSourceCoordinator(robotInstanceId, this.dependencies)
    this.#byRobot.set(robotInstanceId, created)
    return created
  }

  async disconnectAll(): Promise<void> {
    await Promise.all([...this.#byRobot.values()].map((entry) => entry.disconnect()))
    this.#byRobot.clear()
  }
}
```

Implement `RobotSimulationMutationGate` as a per-RobotInstance promise mutex
plus a monotonic generation and current transition token.
`beginSimulationMutation()` synchronously rejects unless the persisted source
owner is Simulation, the playback slot has `sessionActive=false` (Stop, not
merely Pause), and no transition is
pending, then returns the current generation. `requestTransition()` increments
that generation and marks its token pending synchronously before any
asynchronous source switch or Play work is queued. It then invokes registered
synchronous, idempotent transition-cleanup hooks (for example, canceling a
Mechanical preview back to the committed definition); if a hook throws, it
clears only that token and aborts the transition. `assertSimulationEditable()`
performs the same owner/no-active-session/no-pending checks for synchronous preview
actions. `runIfCurrent()` enters the
instance mutex, rechecks generation, no pending transition, Simulation
ownership, and `sessionActive=false`, and holds the mutex through the caller's
persistence transaction and runtime publication. For the lease that predates a
transition, the generation check fails; a new lease cannot be created while
the token is pending. `runTransition()` uses the same mutex and token for
source-mode commit or playback start. For `playback-start`, the later Pose plan
may either create a fresh session from `sessionActive=false` or Resume one
valid paused session; this exception never permits a persisted Simulation
mutation while a session is active. `completeTransition()` clears pending
state only when its exact token is still current and is called from the outer
source/Play operation's `finally`, including connect failure and rollback; an
older completion can never clear a newer pending request.
`registerTransitionCleanup()` returns an unsubscribe function and deletion
removes all hooks for that instance.
Thus a transition requested before a mutation reaches the mutex aborts the
mutation with no DB/memory change; if a mutation already owns the mutex it
finishes while Simulation still owns the instance and the source transition
waits. Neither path can commit mechanical/Pose state after OPC UA becomes live.
The gate contains no persisted data and deletion removes its slot.

The pre-commit source buffer is one bounded ordered discriminated-event queue,
not separate frame/status slots. Replay retained events in exact arrival order
before enabling live delivery; callbacks that fire synchronously during replay
append to the same queue. On the 129th pre-commit event discard only the oldest
event and record one bounded diagnostic, preserving order among all retained
events. This prevents a late disconnect from being overwritten by an earlier
GOOD frame or the reverse.

`robot-playback-control.ts` owns a transient slot per RobotInstance containing
`sessionActive`, `playing`, `elapsedMs`, `pauseReason`, and a generation. Adapt
the existing Timeline to the active RobotInstance slot now: Pause sets
`playing=false` and retains both elapsed and an existing `sessionActive=true`;
calling Pause without a session does not invent one. Stop sets
`sessionActive=false`, `playing=false`, resets elapsed to zero, clears the
reason, and increments only that slot's generation. Hydration creates a stopped
zero/inactive slot; instance deletion removes it. This is the stable minimal contract,
not a future-plan stub. The later Pose plan consumes it and adds velocity-aware
sampling without redeclaring pause/stop semantics.

Implement the Generic Robot plan's `RobotSourceDeletionAdapter` in
`robot-source-deletion-adapter.ts`. Its memory-only token contains the
RobotInstance ID, detached source object, persisted mode, and the generation
captured by `JointSourceCoordinator.quiesceForDeletion()`, plus an
`instance-delete` mutation transition requested synchronously on entry.
Quiesce increments the coordinator generation before disconnecting so every
queued listener/timer becomes inert, stops only that robot's playback, and does
not rewrite the persisted mode. Its `withDeletionBarrier()` calls
`mutationGate.runTransition(deleteTransition, operation)` so the lifecycle's
entire Dexie delete transaction shares the same per-instance mutex as
Mechanical/Pose commits. `resume(token)` is valid only while the instance row still exists and
reconnects the exact source under a new current generation, restoring readiness
from its initial frame, then completes only that deletion transition so
Simulation mutations can resume; failure still completes the token after
placing the source in DISCONNECTED recovery. `finalizeDelete(token)` is idempotent, permanently
disconnects the token, removes the registry slot and transient source state,
removes the mutation-gate slot without reopening it, and never touches the
already-committed deleted instance row. Wire this adapter
into the existing `robot-instance-lifecycle.ts`; its failure/rollback tests must
run once with the real coordinator adapter, not only the Generic fake.

Store `JointSourceSnapshot` in a transient
`sourceStateByRobotInstanceId: Readonly<Record<string, JointSourceSnapshot>>`
slice beside persisted instances. Seed each hydrated instance from its persisted
`sourceMode` with `ready=false`, `status='DISCONNECTED'`, and
`sourceGeneration=0`, `lastAcceptedSequence=null`,
`lastGoodTimestampMs=null`. A successful source-mode commit publishes the
current coordinator generation into that instance snapshot; disconnect keeps
the new generation with readiness false. `applyFrame()`
validates and advances sequence for every structurally valid frame only for the
addressed instance; GOOD/UNCERTAIN additionally update `lastGoodTimestampMs`.
`resetAcceptedSequence()` clears both values only for that instance.
Rejected/BAD/STALE frames never overwrite the last-good timestamp. Never write
this runtime slice to Dexie.
`applyFrame()` returns the reducer's effective quality after age normalization;
the coordinator must use that return value, never raw wire quality, for
readiness, Pause, and status.
Remove its entry only when that RobotInstance is deleted.

Keep playback actions semantically distinct: source switch, explicit
disconnect/delete, and rollback failure call `stopPlayback(robotInstanceId)`
and reset elapsed through the stable playback-control Stop path; BAD/STALE calls
`pausePlayback(robotInstanceId, 'source-quality')` so the current elapsed
position is retained for explicit recovery. Never implement both with one
callback.

`setRequestedGeneration()` updates that instance's transient generation
synchronously before queueing. `commitSourceModeIfCurrent()` calls
`mutationGate.runTransition(transition, ...)`, then runs one Dexie transaction,
checks the coordinator generation before the `put`, rechecks it after the
awaited `put`, aborts the transaction on mismatch, and publishes the memory
instance only after a current transaction commits. It returns `false` for a
superseded request. Consequently a queued stale operation exits before
`detachCurrent()`, and an operation superseded during connect or persistence
disconnects only its own candidate and never detaches the newer source.

A failed new connect reconnects the prior source and restores its persisted
mode; if rollback also fails, the implementation clears the slot, sets
`DISCONNECTED`, and surfaces both errors. The generation checks make every older
connect, rollback, listener, and disconnect completion inert.
If detaching the old source fails before a candidate connects, keep the old
persisted mode and a listener-free source reference solely for a later
disconnect retry, set readiness false/DISCONNECTED, and surface the cause. Do
not subscribe or connect the candidate and do not pretend the old source is
ready. A later explicit switch retries the old disconnect first.

`RobotManualJointCommands` is the only public manual Joint/Home mutation API.
It calls `mutationGate.assertSimulationEditable(robotInstanceId)`, then requires
that exact coordinator snapshot to be current-generation
`mode='simulation'`, `ready=true`, and GOOD/UNCERTAIN. It resolves the registry's
current `SimulationJointSource` for that generation and publishes a complete
named-joint map through `setPositions()`; Home publishes the effective Home map
the same way. The coordinator's private capability applies the resulting frame.
OPC ownership, disconnected/not-ready Simulation, active/pending transition,
playing/paused session, wrong instance/generation, or a stale source object all
reject before runtime mutation. JointInspector and legacy CRB controls call
this service and never the Zustand store directly.

- [ ] **Step 4: Refactor Simulation source and inspector**

```ts
export class SimulationJointSource implements RobotJointSource {
  readonly mode = 'simulation' as const

  constructor(
    readonly robotInstanceId: string,
    private readonly readInitial: () => {
      readonly definitionRevision: string
      readonly jointPositions: Readonly<Record<string, number>>
    },
  ) {}

  connect(): Promise<void> {
    this.publishStatus('CONNECTING')
    const initial = this.readInitial()
    this.setPositions(initial.jointPositions, initial.definitionRevision)
    this.publishStatus('GOOD')
    return Promise.resolve()
  }

  disconnect(): Promise<void> {
    this.publishStatus('DISCONNECTED')
    return Promise.resolve()
  }

  subscribeStatus(listener: (status: JointSourceStatus) => void): () => void {
    return this.statusListeners.subscribe(listener)
  }

  setPositions(
    jointPositions: Readonly<Record<string, number>>,
    definitionRevision: string,
    timestampMs = Date.now(),
  ): RobotJointFrame {
  const values = Object.entries(jointPositions).map(([jointId, value]) => ({ jointId, value }))
  return this.publish({
    robotInstanceId: this.robotInstanceId,
    definitionRevision,
    values,
    timestampMs,
    sequence: this.nextSequence(),
    quality: 'GOOD',
  })
  }
}
```

Render inspector controls from `orderedMovableJoints(effectiveDefinition)`.
Read mode/readiness from that selected RobotInstance's coordinator snapshot and
disable controls unless its mode is Simulation and readiness is GOOD or
UNCERTAIN. Switching one robot never changes another robot's mode, source,
accepted sequence, playback, or controls. Switching to OPC UA requires an
explicit confirmation dialog.

- [ ] **Step 5: Test and commit**

Run: `npm run test:run -- src/features/joints src/features/robots/robot-instance-store.test.ts src/features/robots/robot-instance-lifecycle.test.ts src/features/ui/Timeline.test.tsx src/app/AppShell.test.tsx`

Expected: PASS, including two-instance isolation, initial Simulation readiness,
BAD/STALE not-ready hold, connect rollback, deferred connect/persistence
last-request-wins races, late-frame rejection, StrictMode connect/disconnect,
and dynamic joint-count coverage.

```powershell
git add src/features/joints src/features/robots/robot-instance-store.ts src/features/robots/robot-instance-store.test.ts src/features/robots/robot-instance-lifecycle.ts src/features/robots/robot-instance-lifecycle.test.ts src/features/ui/Timeline.tsx src/features/ui/Timeline.test.tsx src/app/App.tsx src/app/AppShell.test.tsx
git diff --cached --check
git commit -m "feat: arbitrate robot joint sources"
```

## Task 3: Define the Gateway Wire Protocol and Binding Persistence

**Files:**
- Modify: `packages/opcua-protocol/src/index.ts`
- Create: `src/domain/opcua/gateway-protocol.ts`
- Create: `src/domain/opcua/gateway-protocol.test.ts`
- Create: `src/features/opcua/opcua-profile-store.ts`
- Create: `src/features/opcua/opcua-profile-store.test.ts`
- Modify: `src/state/scene-db.ts`
- Test: `src/state/scene-db.test.ts`
- Modify: `src/features/robots/robot-instance-store.ts`
- Modify: `src/features/robots/robot-instance-store.test.ts`

**Interfaces:**
- Consumes: shared `RobotJointFrame`, `RobotDefinitionV1`,
  `RobotInstanceV1.sourceMode`, the Task 2 `RobotSimulationMutationGate`, and
  Dexie `sceneDb` v3.
- Produces: shared server-only `GatewayAllowedProfileV1`, browser `OpcUaBindingProfileV1` selection records, exact validated client/server messages, Dexie v4 source-mode migration, and StrictMode-safe profile-selection hydration.

- [ ] **Step 1: Write protocol and persistence RED tests**

```ts
it('rejects write-like or NodeId-bearing browser subscribe requests', () => {
  expect(() => parseGatewayClientMessage({ type: 'write', nodeId: 'ns=2;s=J1' })).toThrow()
  expect(() => parseGatewayClientMessage({ ...validSubscribe, nodeId: 'ns=2;s=J1' })).toThrow(/field/i)
  expect(() => parseGatewayClientMessage({ ...validSubscribe, bindings: [serverBinding] })).toThrow(/field/i)
})

it('validates the server profile allowlist and rejects duplicate NodeIds', () => {
  expect(parseGatewayAllowedProfiles(validProfileFile)).toEqual([allowedProfile])
  expect(() => parseGatewayAllowedProfiles(profileFileWithDuplicateNodeId())).toThrow(/NodeId/i)
})

it('isolates a corrupt stored profile while restoring valid profiles once', async () => {
  await db.opcUaProfiles.bulkPut([validProfile, corruptProfile as never])
  await Promise.all([store.getState().hydrate(), store.getState().hydrate()])
  expect(store.getState().profiles).toEqual([validProfile])
  expect(store.getState().warnings).toContain(OPCUA_CORRUPT_PROFILE_WARNING)
})

it('upgrades v3 RobotInstances to sourceMode simulation exactly once', async () => {
  await seedSceneV3WithoutSourceMode('scene-v4')
  const first = new SceneDatabase('scene-v4')
  await first.open()
  expect((await first.robotInstances.get('robot-a'))?.sourceMode).toBe('simulation')
  first.close()
  const reopened = new SceneDatabase('scene-v4')
  await reopened.open()
  expect(await reopened.robotInstances.count()).toBe(1)
})

it('persists distinct profile assignments per RobotInstance and blocks assigned-profile deletion', async () => {
  await store.getState().upsert(validProfile)
  await store.getState().upsert(secondProfileForSameDefinition)
  await store.getState().assignToRobot('robot-a', validProfile.id)
  await store.getState().assignToRobot('robot-b', secondProfileForSameDefinition.id)
  await reopenStores()
  expect(readInstance('robot-a').opcUaProfileSelectionId).toBe(validProfile.id)
  expect(readInstance('robot-b').opcUaProfileSelectionId).toBe(secondProfileForSameDefinition.id)
  await expect(store.getState().deleteProfile(validProfile.id)).rejects.toThrow(/assigned.*robot-a/i)
  await store.getState().unassignFromRobot('robot-a')
  await store.getState().deleteProfile(validProfile.id)
})

it('rejects assigning a profile from another definition/revision', async () => {
  await store.getState().upsert(profileFor('other-definition', 'rev-x'))
  await expect(store.getState().assignToRobot('robot-a', 'other-profile'))
    .rejects.toThrow(/definition.*revision/i)
})

it('allows rename but rejects semantic upsert of an assigned profile', async () => {
  await store.getState().upsert(validProfile)
  await store.getState().assignToRobot('robot-a', validProfile.id)
  await store.getState().upsert({ ...validProfile, name: 'Renamed selection' })
  await expect(store.getState().upsert({
    ...validProfile,
    gatewayProfileId: 'different-server-profile',
  })).rejects.toThrow(/assigned.*robot-a.*unassign/i)
  expect(await db.opcUaProfiles.get(validProfile.id)).toMatchObject({
    name: 'Renamed selection', gatewayProfileId: validProfile.gatewayProfileId,
  })
})

it('requires Simulation mode before changing an instance profile assignment', async () => {
  await store.getState().upsert(validProfile)
  await store.getState().upsert(secondProfileForSameDefinition)
  await store.getState().assignToRobot('robot-a', validProfile.id)
  setPersistedSourceMode('robot-a', 'opcua')
  await expect(store.getState().assignToRobot('robot-a', secondProfileForSameDefinition.id))
    .rejects.toThrow(/Simulation/i)
  expect(readInstance('robot-a').opcUaProfileSelectionId).toBe(validProfile.id)
})

it('rejects assignment changes while an OPC source transition is pending', async () => {
  await store.getState().upsert(validProfile)
  await store.getState().upsert(secondProfileForSameDefinition)
  await store.getState().assignToRobot('robot-a', validProfile.id)
  const deferredSource = deferredOpcUaFor(validProfile)
  const switching = coordinatorFor('robot-a').switchSource(deferredSource)
  await deferredSource.waitUntilConnectPending()
  await expect(store.getState().assignToRobot('robot-a', secondProfileForSameDefinition.id))
    .rejects.toThrow(/transition.*pending/i)
  deferredSource.resolveConnect()
  await switching
  expect(readInstance('robot-a')).toMatchObject({
    sourceMode: 'opcua', opcUaProfileSelectionId: validProfile.id,
  })
})
```

- [ ] **Step 2: Run RED**

Run: `npm run protocol:build`

Expected: PASS.

Then run: `npm run test:run -- src/domain/opcua src/features/opcua/opcua-profile-store.test.ts src/state/scene-db.test.ts src/features/robots/robot-instance-store.test.ts`

Expected: FAIL because shared OPC profile messages, browser selection storage,
and schema v4 do not exist.

- [ ] **Step 3: Implement exact read-only messages**

```ts
export interface OpcUaJointBinding {
  readonly jointId: string
  readonly nodeId: string
  readonly sourceUnit: 'degree' | 'radian' | 'millimeter' | 'meter'
  readonly scale: number
  readonly offset: number
  readonly direction: 1 | -1
}

export interface GatewayAllowedProfileV1 {
  readonly schemaVersion: 1
  readonly id: string
  readonly name: string
  readonly robotDefinitionId: string
  readonly robotDefinitionRevision: string
  readonly samplingIntervalMs: number
  readonly bindings: readonly OpcUaJointBinding[]
}

export interface OpcUaBindingProfileV1 {
  readonly schemaVersion: 1
  readonly id: string
  readonly name: string
  readonly gatewayProfileId: string
  readonly robotDefinitionId: string
  readonly robotDefinitionRevision: string
}

export type GatewayStatus =
  | 'CONNECTING'
  | 'GOOD'
  | 'UNCERTAIN'
  | 'BAD'
  | 'STALE'
  | 'DISCONNECTED'

export type GatewayClientMessage = {
  readonly type: 'subscribe'
  readonly robotInstanceId: string
  readonly profileId: string
  readonly robotDefinitionId: string
  readonly robotDefinitionRevision: string
}

export type GatewayServerMessage =
  | { readonly type: 'status'; readonly status: GatewayStatus; readonly detail: string }
  | { readonly type: 'profile-accepted'; readonly profile: GatewayAllowedProfileV1 }
  | { readonly type: 'joint-frame'; readonly frame: RobotJointFrame }
  | { readonly type: 'error'; readonly code: string; readonly message: string }
```

Put these types and the pure `parseGatewayClientMessage()`,
`parseGatewayServerMessage()`, and `parseGatewayAllowedProfiles()` functions in
`@robot-sim/opcua-protocol`. The browser adapter at
`src/domain/opcua/gateway-protocol.ts` re-exports the package API and adds no
parallel wire types. Client parsing accepts only the five exact subscribe fields
above and rejects NodeIds, bindings, endpoint, credential, write, method, and
unknown fields. Server profile parsing caps profiles and bindings at 64,
enforces unique profile IDs, joint IDs and NodeIds, sampling interval
10–1,000 ms, non-empty NodeIds, finite scale/offset, and direction `1|-1`.

- [ ] **Step 4: Add Dexie schema and store**

Add Dexie version 4 while preserving every v3 table/index. Add
`opcUaProfiles: '&id, gatewayProfileId, robotDefinitionId, robotDefinitionRevision, name'`
plus an `opcUaProfileSelectionId` index on `robotInstances`, and upgrade every
existing row missing source fields to `sourceMode='simulation'` and
`opcUaProfileSelectionId=null` in the same transaction. Browser profile records are selections
only: validate their definition identity and `gatewayProfileId`, and reject any
row containing NodeIds, bindings, endpoint, token, cookie, or certificate data.
Use single-flight hydration and row-level isolation. `assignToRobot()` verifies
the profile and instance definition/revision, acquires a per-instance
Simulation mutation lease, and under `runIfCurrent()` rechecks no source/Play
transition is pending, the instance is still in Simulation Mode, and its
definition/revision is unchanged before writing the instance field in one
transaction. `unassignFromRobot()` uses the same gate and sets it to null while
refusing to leave that instance in OPC
mode. Changing the assignment of an OPC-owned instance therefore requires an
explicit switch back to Simulation first. Profile deletion is rejected while any RobotInstance
references it and reports those instance names. RobotInstance deletion removes
the reference with its row, so shared profile records remain. Use preview-free
atomic upsert/delete/assign actions and an idempotent v3->v4 reopen test.
For an existing assigned selection ID, `upsert()` may change only the display
name. Treat `gatewayProfileId`, robot definition ID/revision, and schema version
as immutable semantic fields until every named RobotInstance is explicitly
unassigned; reject a semantic retarget before writing either DB or memory. This
prevents a reusable ID from silently moving live/reloaded robots to a different
server allowlist entry.

- [ ] **Step 5: Run tests and commit**

Run: `npm run protocol:build`

Expected: PASS.

Then run: `npm run test:run -- src/domain/opcua src/features/opcua/opcua-profile-store.test.ts src/state/scene-db.test.ts src/features/robots/robot-instance-store.test.ts`

Expected: PASS.

```powershell
git add packages/opcua-protocol/src/index.ts src/domain/opcua src/features/opcua/opcua-profile-store.ts src/features/opcua/opcua-profile-store.test.ts src/state/scene-db.ts src/state/scene-db.test.ts src/features/robots/robot-instance-store.ts src/features/robots/robot-instance-store.test.ts
git diff --cached --check
git commit -m "feat: persist read-only OPC UA bindings"
```

## Task 4: Build the Coherent Frame Assembler

**Files:**
- Create: `gateway/src/frame-assembler.ts`
- Create: `gateway/src/frame-assembler.test.ts`
- Create: `gateway/src/config.ts`
- Create: `gateway/src/config.test.ts`
- Create: `gateway/tsconfig.json`
- Create: `gateway/vitest.config.ts`
- Create: `gateway/fixtures/allowed-profiles.json`
- Modify: `package.json`
- Modify: `package-lock.json`

**Interfaces:**
- Consumes: shared `GatewayAllowedProfileV1`, OPC UA scalar value, StatusCode quality, source timestamp, and explicit RobotInstance ID.
- Produces: coherent canonical instance-addressed `RobotJointFrame` messages, a Node-only test/build boundary, and fail-closed server configuration containing validated allowed profiles.

- [ ] **Step 1: Add pinned server-only dependencies and scripts**

Run:

```powershell
npm install --save-exact node-opcua@2.175.0 ws@8.21.0
```

Expected: exit 0 and exact production versions in the lockfile.

Then run:

```powershell
npm install --save-dev --save-exact @types/ws@8.18.1
```

Expected: exit 0.

Add scripts:

```json
{
  "gateway:build": "npm run protocol:build && tsc -p gateway/tsconfig.json",
  "gateway:start": "node gateway/dist/index.js",
  "gateway:test": "npm run protocol:build && vitest run --config gateway/vitest.config.ts",
  "verify": "npm run lint && npm run test:run && npm run gateway:test && npm run gateway:build && npm run cad:validate && npm run build"
}
```

Create a standalone `gateway/tsconfig.json`; do not extend the Vite/Bundler
tsconfig and use `.js` suffixes for every relative import in gateway source so
the emitted ESM runs directly in Node:

```json
{
  "compilerOptions": {
    "target": "ES2023",
    "lib": ["ES2023"],
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "noEmit": false,
    "outDir": "./dist",
    "rootDir": "./src",
    "allowImportingTsExtensions": false,
    "sourceMap": true,
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "skipLibCheck": true,
    "types": ["node"]
  },
  "include": ["src/**/*.ts"],
  "exclude": ["src/**/*.test.ts"]
}
```

Create `gateway/vitest.config.ts` so gateway tests do not inherit the browser's
jsdom setup or its `src/**/*.test.*` include:

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['gateway/src/**/*.test.ts'],
    testTimeout: 15_000,
    hookTimeout: 15_000,
  },
})
```

- [ ] **Step 2: Write assembler RED tests**

```ts
it('emits only after every joint has a value inside one sampling window', () => {
  const assembler = createFrameAssembler('robot-a', profile, { samplingWindowMs: 20 })
  expect(assembler.push(sample('J1', 90, 'degree', 100, 'GOOD'))).toBeNull()
  expect(assembler.push(sample('J2', 0.2, 'radian', 110, 'GOOD'))).toMatchObject({
    robotInstanceId: 'robot-a',
    definitionRevision: profile.robotDefinitionRevision,
    values: [{ jointId: 'J1', value: Math.PI / 2 }, { jointId: 'J2', value: 0.2 }],
    quality: 'GOOD',
  })
})

it('applies unit conversion, direction, scale, then offset', () => {
  expect(normalizeValue(180, binding({ sourceUnit: 'degree', direction: -1, scale: 0.5, offset: 0.1 })))
    .toBeCloseTo(-Math.PI * 0.5 + 0.1)
})
```

- [ ] **Step 3: Run RED**

Run: `npm run gateway:test`

Expected: FAIL because the gateway assembler does not exist.

- [ ] **Step 4: Implement normalization and coherence**

```ts
export function normalizeValue(raw: number, binding: OpcUaJointBinding): number {
  const canonical = binding.sourceUnit === 'degree'
    ? raw * Math.PI / 180
    : binding.sourceUnit === 'millimeter'
      ? raw / 1_000
      : raw
  const value = binding.direction * canonical * binding.scale + binding.offset
  if (!Number.isFinite(value)) throw new Error(`Invalid OPC UA value for ${binding.jointId}`)
  return value
}
```

Keep the newest sample per joint. Emit only when all joints exist and the newest
minus oldest source timestamp is at most `max(20, samplingIntervalMs)`. Quality
is the worst of GOOD, UNCERTAIN, BAD. Increment one sequence per emitted frame.
Every output copies the constructor's non-empty `robotInstanceId` and the
server profile's definition revision. Clear the window after emit so values
from different instances or sampling windows cannot mix.

- [ ] **Step 5: Implement fail-closed configuration**

```ts
export interface GatewayConfig {
  readonly endpointUrl: string
  readonly host: string
  readonly port: number
  readonly allowedOrigins: readonly string[]
  readonly authMode: 'loopback' | 'reverse-proxy-bearer'
  readonly upstreamBearerToken: string | null
  readonly allowedProfiles: ReadonlyMap<string, GatewayAllowedProfileV1>
  readonly certificateFile: string | null
  readonly privateKeyFile: string | null
}
```

Read `OPCUA_ENDPOINT_URL`, `GATEWAY_HOST` (default `127.0.0.1`),
`GATEWAY_PORT` (default `8765`), `GATEWAY_ALLOWED_ORIGINS`,
`GATEWAY_PROFILE_FILE`, `GATEWAY_AUTH_MODE`,
`GATEWAY_UPSTREAM_BEARER_TOKEN`, and optional server-side certificate paths.
Load and validate the profile JSON with `parseGatewayAllowedProfiles()` before
opening a socket. `gateway/fixtures/allowed-profiles.json` contains a complete
six-joint test profile with no credentials.

```json
[
  {
    "schemaVersion": 1,
    "id": "crb-profile",
    "name": "CRB15000 read-only joints",
    "robotDefinitionId": "crb15000-12kg-127",
    "robotDefinitionRevision": "builtin-v1",
    "samplingIntervalMs": 20,
    "bindings": [
      { "jointId": "J1", "nodeId": "ns=2;s=Robot.J1", "sourceUnit": "degree", "scale": 1, "offset": 0, "direction": 1 },
      { "jointId": "J2", "nodeId": "ns=2;s=Robot.J2", "sourceUnit": "degree", "scale": 1, "offset": 0, "direction": 1 },
      { "jointId": "J3", "nodeId": "ns=2;s=Robot.J3", "sourceUnit": "degree", "scale": 1, "offset": 0, "direction": 1 },
      { "jointId": "J4", "nodeId": "ns=2;s=Robot.J4", "sourceUnit": "degree", "scale": 1, "offset": 0, "direction": 1 },
      { "jointId": "J5", "nodeId": "ns=2;s=Robot.J5", "sourceUnit": "degree", "scale": 1, "offset": 0, "direction": 1 },
      { "jointId": "J6", "nodeId": "ns=2;s=Robot.J6", "sourceUnit": "degree", "scale": 1, "offset": 0, "direction": 1 }
    ]
  }
]
```

Require a non-empty, wildcard-free origin list in every mode. Treat only
`127.0.0.1`, `::1`, and `localhost` as loopback. For any other host, reject
startup unless auth mode is `reverse-proxy-bearer` and the upstream token is at
least 32 characters. Loopback mode rejects a configured upstream token rather
than silently ignoring it. Keep the token in the gateway process only; never
place it in a message, error, snapshot, serialized config, or log.

Add tests for missing/duplicate profile IDs, duplicate NodeIds, missing profile
file, non-loopback without auth, wildcard origin, short token, valid
reverse-proxy-bearer config, and redacted thrown/logged diagnostics.

- [ ] **Step 6: Test and commit**

Run: `npm run gateway:test`

Expected: PASS under the dedicated Node environment.

Then run: `npm run gateway:build`

Expected: PASS and emit `gateway/dist/index.js`.

Then run:

```powershell
node --input-type=module -e "await import('./gateway/dist/config.js'); await import('./gateway/dist/frame-assembler.js')"
```

Expected: exit 0 with no missing extension, package, or cross-root import.

Then run: `npm audit --omit=dev --audit-level=high`

Expected: all PASS with no high/critical production vulnerabilities.

```powershell
git add package.json package-lock.json gateway/src/frame-assembler.ts gateway/src/frame-assembler.test.ts gateway/src/config.ts gateway/src/config.test.ts gateway/tsconfig.json gateway/vitest.config.ts gateway/fixtures/allowed-profiles.json
git diff --cached --check
git commit -m "feat: assemble OPC UA joint frames"
```

## Task 5: Connect OPC UA MonitoredItems to an Origin-Checked WebSocket

**Files:**
- Create: `gateway/src/opcua-adapter.ts`
- Create: `gateway/src/opcua-adapter.test.ts`
- Create: `gateway/src/gateway-error.ts`
- Create: `gateway/src/gateway-error.test.ts`
- Create: `gateway/src/websocket-server.ts`
- Create: `gateway/src/websocket-server.test.ts`
- Create: `gateway/src/index.ts`

**Interfaces:**
- Consumes: fail-closed gateway config, server-resolved `GatewayAllowedProfileV1`, instance-addressed subscribe message, and `node-opcua` data changes.
- Produces: authenticated status/profile/coherent joint-frame WebSocket messages; no write-capable surface and no client-authorized NodeId.

- [ ] **Step 1: Write adapter and WebSocket RED tests**

```ts
it('creates read-only monitored items and never exposes write or call', async () => {
  await adapter.subscribe('robot-a', allowedProfile, { onFrame, onStatus })
  expect(fakeSubscription.monitorItems).toHaveBeenCalledWith(
    expect.arrayContaining([expect.objectContaining({ attributeId: AttributeIds.Value })]),
    expect.objectContaining({ samplingInterval: allowedProfile.samplingIntervalMs }),
    TimestampsToReturn.Both,
  )
  expect((adapter as unknown as { write?: unknown }).write).toBeUndefined()
  expect((adapter as unknown as { call?: unknown }).call).toBeUndefined()
})

it('rejects a WebSocket with an unapproved Origin before parsing messages', async () => {
  const response = await openRawWebSocket({ origin: 'https://evil.example' })
  expect(response.statusCode).toBe(403)
})

it.each([undefined, 'Bearer wrong-token'])('rejects non-loopback without valid proxy bearer %s', async (authorization) => {
  const response = await openRawWebSocket({
    config: nonLoopbackConfig,
    origin: 'https://hmi.example',
    authorization,
  })
  expect(response.statusCode).toBe(401)
  expect(opcua.subscribe).not.toHaveBeenCalled()
})

it('accepts a valid reverse-proxy bearer without echoing it', async () => {
  const response = await openRawWebSocket({
    config: nonLoopbackConfig,
    origin: 'https://hmi.example',
    authorization: `Bearer ${upstreamToken}`,
  })
  expect(response.statusCode).toBe(101)
  expect(response.rawHeaders.join('\n')).not.toContain(upstreamToken)
})

it('rejects an unknown profile ID before touching OPC UA', async () => {
  const socket = await openAllowedSocket(loopbackConfig)
  socket.send(JSON.stringify({ ...validSubscribe, profileId: 'not-allowed' }))
  await expect(nextServerMessage(socket)).resolves.toMatchObject({ type: 'error', code: 'PROFILE_NOT_ALLOWED' })
  expect(opcua.subscribe).not.toHaveBeenCalled()
})

it.each([
  ['malformed JSON', '{'],
  ['unknown subscribe field', JSON.stringify({ ...validSubscribe, nodeId: 'ns=2;s=J1' })],
] as const)('closes %s with policy code 1008', async (_caseName, payload) => {
  const socket = await openAllowedSocket(loopbackConfig)
  socket.send(payload)
  await expect(socketClosed(socket)).resolves.toMatchObject({ code: 1008 })
  expect(opcua.subscribe).not.toHaveBeenCalled()
})

it('uses only the server mapping and carries RobotInstance ID into the frame', async () => {
  const socket = await openAllowedSocket(loopbackConfig)
  socket.send(JSON.stringify(validSubscribeFor('robot-b', 'crb-profile')))
  expect(opcua.subscribe).toHaveBeenCalledWith(
    'robot-b',
    loopbackConfig.allowedProfiles.get('crb-profile'),
    expect.objectContaining({ onFrame: expect.any(Function), onStatus: expect.any(Function) }),
  )
  opcua.emitFrame()
  await expect(nextJointFrame(socket)).resolves.toMatchObject({ robotInstanceId: 'robot-b' })
})

it('disposes a subscription that resolves after socket close without accepting or sending', async () => {
  const deferred = deferOpcUaSubscribe()
  opcua.subscribe.mockReturnValueOnce(deferred.promise)
  const socket = await openAllowedSocket(loopbackConfig)
  socket.send(JSON.stringify(validSubscribe))
  await deferred.waitUntilCalled()
  socket.close()
  const dispose = vi.fn().mockResolvedValue(undefined)
  deferred.resolve(dispose)
  await server.waitForSocketCleanup()
  expect(dispose).toHaveBeenCalledOnce()
  expect(serverMessages(socket)).not.toEqual(expect.arrayContaining([
    expect.objectContaining({ type: 'profile-accepted' }),
  ]))
  expect(opcua.openSubscriptionCount()).toBe(0)
})

it('sends profile-accepted only after subscribe succeeds', async () => {
  opcua.subscribe.mockRejectedValueOnce(new Error('upstream unavailable'))
  const socket = await openAllowedSocket(loopbackConfig)
  socket.send(JSON.stringify(validSubscribe))
  await expect(nextServerMessage(socket)).resolves.toMatchObject({
    type: 'error', code: 'SUBSCRIBE_FAILED',
  })
  expect(serverMessages(socket)).not.toEqual(expect.arrayContaining([
    expect.objectContaining({ type: 'profile-accepted' }),
  ]))
})

it('closes and tracks cleanup when replacing an active subscription whose disposer fails', async () => {
  const dispose = vi.fn()
    .mockRejectedValueOnce(new Error('dispose failed'))
    .mockResolvedValueOnce(undefined)
  opcua.subscribe.mockResolvedValueOnce(dispose)
  const socket = await openAllowedSocket(loopbackConfig)
  socket.send(JSON.stringify(validSubscribe))
  await expect(nextServerMessage(socket)).resolves.toMatchObject({ type: 'profile-accepted' })
  socket.send(JSON.stringify(validSubscribeFor('robot-a', 'second-allowed-profile')))
  await expect(socketClosed(socket)).resolves.toMatchObject({ code: 1011 })
  await server.waitForSocketCleanup()
  expect(opcua.subscribe).toHaveBeenCalledTimes(1)
  expect(dispose).toHaveBeenCalledTimes(2)
  expect(opcua.openSubscriptionCount()).toBe(0)
  expect(unhandledRejections).toHaveLength(0)
})

it('keeps one assembler sequence across an upstream OPC UA reconnect', async () => {
  const frames: RobotJointFrame[] = []
  await adapter.subscribe('robot-a', allowedProfile, {
    onFrame: (frame) => frames.push(frame),
    onStatus: vi.fn(),
  })
  emitCompleteMonitoredSet(firstUpstreamSubscription, 1)
  emitPartialMonitoredSet(firstUpstreamSubscription, { J1: 99 })
  await forceOpcUaReconnectWithoutClosingWebSocket()
  emitPartialMonitoredSet(reconnectedUpstreamSubscription, { J2: 2 })
  expect(frames.map(({ sequence }) => sequence)).toEqual([1])
  emitCompleteFreshMonitoredSet(reconnectedUpstreamSubscription, 2)
  expect(frames.map(({ sequence }) => sequence)).toEqual([1, 2])
})

it('publishes real reconnect status separately without fabricating a joint frame', async () => {
  const socket = await openAllowedSocket(loopbackConfig)
  socket.send(JSON.stringify(validSubscribe))
  await opcua.forceUpstreamDisconnectAndReconnect()
  expect(statusMessages(socket).map(({ status }) => status)).toEqual(
    expect.arrayContaining(['DISCONNECTED', 'CONNECTING']),
  )
  expect(jointFrameMessages(socket)).toHaveLength(0)
})

it('serializes a bounded public gateway error without its cause or secret', () => {
  const error = new GatewayError('UPSTREAM_DISPOSE_FAILED', {
    cause: new Error('opc.tcp://secret-host user=admin password=secret'),
  })
  const message = toBoundedProtocolError(error)
  expect(message).toEqual({
    type: 'error', code: 'UPSTREAM_DISPOSE_FAILED', message: 'Upstream cleanup failed',
  })
  expect(JSON.stringify(message)).not.toMatch(/secret-host|admin|password/i)
})
```

- [ ] **Step 2: Run RED**

Run: `npm run gateway:test`

Expected: FAIL because the adapter and server do not exist.

- [ ] **Step 3: Implement the narrow OPC adapter**

Create an internal `ReadOnlyOpcUaAdapter` whose public methods are only
`connect()`, `subscribe(robotInstanceId, allowedProfile, { onFrame, onStatus })`, and
`disconnect()`. `subscribe()` creates
`createFrameAssembler(robotInstanceId, allowedProfile, options)`; it never
accepts browser bindings. Use
`OPCUAClient.create()`, `createSession()`, `createSubscription2()`, and
`subscription.monitorItems()` with `AttributeIds.Value`. Map StatusCode and
sourceTimestamp, reconnect with capped exponential delays 250, 500, 1,000,
2,000, and 5,000 ms, and terminate subscriptions on client disconnect. Create
the frame assembler once per logical WebSocket subscription outside the
upstream reconnect loop; recreated OPC UA sessions/MonitoredItems feed that same
assembler so its emitted sequence remains strictly increasing until the
browser WebSocket generation ends. On upstream disconnect call
`assembler.resetWindowPreservingSequence()` before recreating MonitoredItems:
discard every partial value/timestamp/quality from the old OPC session while
retaining only the next sequence counter. A post-reconnect coherent frame must
contain a fresh value for every mapped joint and can never combine pre- and
post-reconnect samples.
The callback object is the sole typed per-subscription output path.
`onStatus(status, detail)` emits bounded CONNECTING/GOOD/UNCERTAIN/BAD/STALE/
DISCONNECTED lifecycle and quality changes for that logical subscription;
`onFrame` emits only complete named-joint frames. Never encode a lifecycle
transition as an empty frame.

- [ ] **Step 4: Authenticate upgrades, resolve server profiles, and own sessions**

Define the server error contract in `gateway-error.ts`:

```ts
export type GatewayErrorCode =
  | 'PROFILE_NOT_ALLOWED'
  | 'PROFILE_REVISION_MISMATCH'
  | 'SUBSCRIPTION_TRANSITION_ACTIVE'
  | 'SUBSCRIBE_FAILED'
  | 'UPSTREAM_DISPOSE_FAILED'
  | 'INVALID_CLIENT_MESSAGE'

export class GatewayError extends Error {
  constructor(
    readonly code: GatewayErrorCode,
    options?: { readonly cause?: unknown },
  ) {
    super(code, options)
  }
}
```

`toBoundedProtocolError()` maps each code to a fixed operator-safe message of at
most 160 characters and never serializes `cause`, stack, endpoint, NodeIds,
credentials, certificate paths, or raw input. Unknown operational errors map to
`SUBSCRIBE_FAILED`; JSON/schema errors map to `INVALID_CLIENT_MESSAGE`.
`isClientProtocolViolation()` and `isUpstreamCleanupFailure()` inspect only
typed code/classes, never substring-match secret-bearing messages.

Authorize a non-loopback upgrade by hashing the presented and configured tokens
to equal-length SHA-256 buffers and comparing with `timingSafeEqual`; malformed
or missing headers return 401. Loopback mode skips bearer authentication but
still enforces its explicit Origin list.

```ts
function isAuthorizedUpgrade(request: IncomingMessage, config: GatewayConfig): boolean {
  if (config.authMode === 'loopback') return true
  const expected = config.upstreamBearerToken
  const header = request.headers.authorization
  if (expected === null || typeof header !== 'string' || !header.startsWith('Bearer ')) return false
  const presented = header.slice('Bearer '.length)
  const expectedDigest = createHash('sha256').update(expected, 'utf8').digest()
  const presentedDigest = createHash('sha256').update(presented, 'utf8').digest()
  return timingSafeEqual(expectedDigest, presentedDigest)
}

const server = createServer()
const wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 })

server.on('upgrade', (request, socket, head) => {
  if (!isAuthorizedUpgrade(request, config)) {
    socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n')
    socket.destroy()
    return
  }
  if (!isAllowedOrigin(request.headers.origin, config.allowedOrigins)) {
    socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n')
    socket.destroy()
    return
  }
  wss.handleUpgrade(request, socket, head, (webSocket) => {
    wss.emit('connection', webSocket, request)
  })
})

wss.on('connection', (socket) => {
  let closed = false
  let socketGeneration = 0
  let disposeSubscription: (() => Promise<void>) | null = null
  let subscriptionTransition = false
  let transition: Promise<void> = Promise.resolve()

  const send = (message: GatewayServerMessage): boolean => {
    if (closed || socket.readyState !== WebSocket.OPEN) return false
    socket.send(JSON.stringify(message))
    return true
  }

  socket.on('message', (bytes) => {
    if (subscriptionTransition) {
      send({
        type: 'error',
        code: 'SUBSCRIPTION_TRANSITION_ACTIVE',
        message: 'A subscription transition is already active',
      })
      return
    }
    subscriptionTransition = true
    const generation = ++socketGeneration
    transition = (async () => {
      try {
        const message = parseGatewayClientMessage(JSON.parse(bytes.toString()))
        const profile = config.allowedProfiles.get(message.profileId)
        if (profile === undefined) throw new GatewayError('PROFILE_NOT_ALLOWED')
        if (
          profile.robotDefinitionId !== message.robotDefinitionId ||
          profile.robotDefinitionRevision !== message.robotDefinitionRevision
        ) throw new GatewayError('PROFILE_REVISION_MISMATCH')

        const previousDispose = disposeSubscription
        if (previousDispose !== null) {
          try {
            await previousDispose()
          } catch (error) {
            throw new GatewayError('UPSTREAM_DISPOSE_FAILED', { cause: error })
          }
          if (disposeSubscription === previousDispose) disposeSubscription = null
        }
        if (closed || generation !== socketGeneration) return

        let activated = false
        const queuedSourceMessages: GatewayServerMessage[] = []
        const publishSourceMessage = (sourceMessage: GatewayServerMessage): void => {
          if (closed || generation !== socketGeneration) return
          if (!activated) {
            if (queuedSourceMessages.length === 16) queuedSourceMessages.shift()
            queuedSourceMessages.push(sourceMessage)
            return
          }
          send(sourceMessage)
        }
        const rawDispose = await opcua.subscribe(message.robotInstanceId, profile, {
          onFrame: (frame) => publishSourceMessage({ type: 'joint-frame', frame }),
          onStatus: (status, detail) => publishSourceMessage({ type: 'status', status, detail }),
        })
        const nextDispose = createTrackedDisposer(rawDispose)
        if (closed || generation !== socketGeneration) {
          await nextDispose()
          return
        }
        disposeSubscription = nextDispose
        if (!send({ type: 'profile-accepted', profile })) {
          disposeSubscription = null
          await nextDispose()
          return
        }
        activated = true
        for (const sourceMessage of queuedSourceMessages) send(sourceMessage)
      } catch (error) {
        if (!closed && generation === socketGeneration) {
          send(toBoundedProtocolError(error))
          if (isClientProtocolViolation(error)) {
            socket.close(1008, 'Invalid gateway client message')
          } else if (isUpstreamCleanupFailure(error)) {
            socket.close(1011, 'Upstream cleanup failed')
          }
        }
      } finally {
        if (generation === socketGeneration) subscriptionTransition = false
      }
    })()
  })
  socket.on('close', () => {
    closed = true
    ++socketGeneration
    const cleanup = transition.finally(async () => {
      const dispose = disposeSubscription
      disposeSubscription = null
      await dispose?.()
    })
    trackSocketCleanup(cleanup)
  })
})
```

`createTrackedDisposer()` coalesces concurrent disposal calls and marks the
handle complete only after success. A failed replacement disposal keeps the
handle installed, starts no new subscription, sends one bounded operational
error, and closes that socket with 1011; close cleanup retries the tracked
handle and gateway shutdown awaits/reports it. Thus a late subscribe resolution
is disposed once on the normal path, while a failed cleanup is never lost or
silently treated as complete.
`trackSocketCleanup()` is awaited by gateway shutdown and tests. Never send
`profile-accepted` until `opcua.subscribe()` has returned a disposer and the
socket generation is still current; a failed subscribe sends only a bounded
error. Status and frame callbacks share the socket-generation guard; messages
emitted synchronously during subscribe are bounded, retain their relative
order, and flush only after acceptance. Status callbacks produce typed status
messages and never an empty joint frame.

Send status messages for CONNECTING, GOOD, UNCERTAIN, BAD, STALE, and
DISCONNECTED. Reject a second outstanding subscribe until the first is fully
disposed. Cap inbound JSON at 64 KiB and close malformed clients with code
1008. `isClientProtocolViolation()` classifies only JSON parse failures and
exact-schema/type/unknown-field violations for policy close; a valid request
whose profile is unavailable/mismatched or whose upstream subscribe fails gets
a bounded error without misclassifying the socket bytes. Convert asynchronous
handler rejections to a bounded protocol error and
never let them become unhandled rejections. Never include authorization headers,
configured bearer values, certificate paths, or raw profile-file contents in
errors or logs.

- [ ] **Step 5: Add a local in-process OPC UA smoke test**

Start `OPCUAServer` on an ephemeral loopback port, expose six Double variables,
connect the real adapter using `robotInstanceId='robot-smoke'` and an allowed
profile, update all values, and assert one named joint frame containing that
exact instance ID and definition revision.
The test must close the server, subscription, session, and socket in `finally`.

- [ ] **Step 6: Test and commit**

Run: `npm run gateway:test`

Expected: PASS with no open handles.

Then run: `npm run gateway:build`

Expected: PASS.

```powershell
git add gateway/src
git diff --cached --check
git commit -m "feat: bridge OPC UA subscriptions to WebSocket"
```

## Task 6: Implement the Browser OPC UA Joint Source

**Files:**
- Create: `src/features/opcua/OpcUaGatewayJointSource.ts`
- Create: `src/features/opcua/OpcUaGatewayJointSource.test.ts`
- Create: `src/features/opcua/RobotJointSourceManager.ts`
- Create: `src/features/opcua/RobotJointSourceManager.test.ts`
- Modify: `src/app/App.tsx`
- Test: `src/app/AppShell.test.tsx`

**Interfaces:**
- Consumes: shared gateway protocol, selected server-profile record, RobotInstance identity, and its dedicated coordinator.
- Produces: RobotInstance-bound `RobotJointSource` implementation plus an ID-keyed all-instance source manager with profile acknowledgement, validation, reconnect, stale detection, and late-message cancellation.

```ts
export interface BrowserWebSocketLike {
  readonly readyState: number
  send(data: string): void
  close(code?: number, reason?: string): void
  addEventListener(type: 'open', listener: (event: Event) => void): void
  addEventListener(type: 'message', listener: (event: MessageEvent<unknown>) => void): void
  addEventListener(type: 'close', listener: (event: CloseEvent) => void): void
  addEventListener(type: 'error', listener: (event: Event) => void): void
  removeEventListener(type: 'open', listener: (event: Event) => void): void
  removeEventListener(type: 'message', listener: (event: MessageEvent<unknown>) => void): void
  removeEventListener(type: 'close', listener: (event: CloseEvent) => void): void
  removeEventListener(type: 'error', listener: (event: Event) => void): void
}

export type WebSocketFactory = (url: string) => BrowserWebSocketLike
```

The production factory is `(url) => new WebSocket(url)` and tests inject a
complete fake implementing the interface. The source stores exact listener
references, removes all four on replacement/disconnect, and generation-guards
every event. Constructor/factory failure publishes DISCONNECTED plus a bounded
diagnostic. Before initial profile acceptance it rejects without reconnect;
after a previously accepted generation it participates in the same reconnect
schedule.

- [ ] **Step 1: Write browser source RED tests**

```ts
async function connectAndAccept(
  source: OpcUaGatewayJointSource,
  accepted = profileAccepted(validAcceptedProfile),
): Promise<void> {
  const connecting = source.connect()
  const socket = await waitForSocket(sockets, 0)
  socket.emitOpen()
  expectPromisePending(connecting)
  socket.emit(accepted)
  await connecting
}

it('resolves connect only after a matching validated profile acknowledgement', async () => {
  const connecting = source.connect()
  const socket = await waitForSocket(sockets, 0)
  socket.emitOpen()
  expectPromisePending(connecting)
  socket.emit(profileAccepted(validAcceptedProfile))
  await expect(connecting).resolves.toBeUndefined()
  expect(coordinatorFor('robot-a').snapshot().ready).toBe(false)
  socket.emit(jointFrameMessage())
  expect(frameListener).toHaveBeenCalledOnce()
})

it.each([
  ['server-error', 'PROFILE_NOT_ALLOWED'],
  ['socket-error', 'PROFILE_ACK_SOCKET_ERROR'],
  ['close', 'PROFILE_ACK_CLOSED'],
  ['timeout', 'PROFILE_ACK_TIMEOUT'],
] as const)(
  'rejects the uncommitted initial source on acknowledgement %s',
  async (failure, expectedCode) => {
    const connecting = coordinatorFor('robot-a').switchSource(source)
    const socket = await waitForSocket(sockets, 0)
    socket.emitOpen()
    if (failure === 'server-error') socket.emit(errorMessage('PROFILE_NOT_ALLOWED'))
    if (failure === 'socket-error') socket.emitError()
    if (failure === 'close') socket.close()
    if (failure === 'timeout') vi.advanceTimersByTime(3_001)
    await expect(connecting).rejects.toMatchObject({ code: expectedCode })
    expect(reconnectTimers()).toHaveLength(0)
    expect(coordinatorFor('robot-a').snapshot()).toMatchObject({
      mode: 'simulation', ready: true,
    })
  },
)

it('ignores messages from a replaced socket generation', async () => {
  await connectAndAccept(source)
  const first = sockets[0]!
  first.close()
  timers.runNextTimer()
  first.emit(jointFrameMessage({ sequence: 9 }))
  expect(listener).not.toHaveBeenCalled()
})

it('publishes STALE once after 1000ms without a good frame', async () => {
  await connectAndAccept(source)
  sockets[0]!.emit(jointFrameMessage({ timestampMs: 100 }))
  vi.setSystemTime(1_101)
  timers.runOnlyPendingTimers()
  expect(listener).toHaveBeenLastCalledWith(expect.objectContaining({ quality: 'STALE' }))
})

it('subscribes by allowlisted profile ID and never sends NodeIds or bindings', async () => {
  const connecting = source.connect()
  const socket = await waitForSocket(sockets, 0)
  socket.emitOpen()
  const sent = JSON.parse(socket.sent[0]!)
  expect(sent).toEqual({
    type: 'subscribe',
    robotInstanceId: 'robot-a',
    profileId: 'crb-profile',
    robotDefinitionId: 'crb15000',
    robotDefinitionRevision: 'rev-1',
  })
  expect(JSON.stringify(sent)).not.toMatch(/nodeId|bindings|token/i)
  socket.emit(profileAccepted(validAcceptedProfile))
  await connecting
})

it('rejects a profile acknowledgement for another definition', async () => {
  const connecting = source.connect()
  const socket = await waitForSocket(sockets, 0)
  socket.emitOpen()
  socket.emit(profileAccepted({ robotDefinitionRevision: 'wrong' }))
  await expect(connecting).rejects.toMatchObject({ code: 'PROFILE_REVISION_MISMATCH' })
  expect(listener).not.toHaveBeenCalled()
  expect(readDiagnostic()).toMatch(/profile revision/i)
})

it.each([
  ['missing movable joint', acceptedProfileMissing('slide')],
  ['degree unit on prismatic joint', acceptedProfileWithUnit('slide', 'degree')],
  ['millimeter unit on revolute joint', acceptedProfileWithUnit('joint-1', 'millimeter')],
] as const)('rejects %s before readiness', async (_caseName, acceptedProfile) => {
  const connecting = source.connect()
  const socket = await waitForSocket(sockets, 0)
  socket.emitOpen()
  socket.emit(profileAccepted(acceptedProfile))
  await expect(connecting).rejects.toThrow(/joint set|unit.*joint/i)
  socket.emit(jointFrameMessage())
  expect(frameListener).not.toHaveBeenCalled()
  expect(readDiagnostic()).toMatch(/joint set|unit.*joint/i)
  expect(coordinatorFor('robot-a').snapshot().ready).toBe(false)
})

it('reports gateway and socket lifecycle status independently from joint frames', async () => {
  const statusListener = vi.fn()
  source.subscribeStatus(statusListener)
  await connectAndAccept(source)
  sockets[0]!.emit(statusMessage('GOOD'))
  sockets[0]!.close()
  expect(statusListener.mock.calls.map(([status]) => status)).toEqual(
    expect.arrayContaining(['CONNECTING', 'GOOD', 'DISCONNECTED']),
  )
  expect(frameListener).not.toHaveBeenCalledWith(expect.objectContaining({ values: [] }))
})

it('keeps robot-a connected when the UI selection changes to robot-b', async () => {
  const firstReconcile = sourceManager.reconcile(
    twoInstances({ robotA: assignedOpcUa, robotB: simulation }),
  )
  const socket = await waitForOpcUaSocket('robot-a')
  socket.emit(profileAcceptedFor(assignedOpcUa))
  await firstReconcile
  socket.emit(jointFrameMessage())
  selectRobotInTree('robot-b')
  await sourceManager.reconcile(readHydratedInstancesAndProfiles())
  expect(coordinatorFor('robot-a').snapshot()).toMatchObject({ mode: 'opcua', ready: true })
  expect(opcUaSocketFor('robot-a').close).not.toHaveBeenCalled()
})

it('does not construct an OPC source for a null/missing/corrupt assignment', async () => {
  await sourceManager.reconcile(oneInstance({ sourceMode: 'opcua', opcUaProfileSelectionId: null }))
  expect(opcUaSourceFactory).not.toHaveBeenCalled()
  expect(readSourceDiagnostic('robot-a')).toMatch(/assign.*profile/i)
  expect(coordinatorFor('robot-a').snapshot()).toMatchObject({ ready: false })
})

it('lets a newer profile reconcile win over a deferred older profile', async () => {
  coordinatorFor('robot-a').deferNextSwitch()
  const oldReconcile = sourceManager.reconcile(oneInstance({ assignment: profileA }))
  await coordinatorFor('robot-a').waitUntilSwitchQueued()
  const newReconcile = sourceManager.reconcile(oneInstance({ assignment: profileB }))
  coordinatorFor('robot-a').releaseDeferredSwitch()
  await Promise.all([oldReconcile, newReconcile])
  expect(sourceManager.signatureForTest('robot-a')).toBe(signatureFor(profileB))
  expect(sourceFor(profileA).disconnect).toHaveBeenCalled()
  expect(coordinatorFor('robot-a').snapshot().mode).toBe('opcua')
})

it('does not recreate an instance removed during a deferred reconcile', async () => {
  coordinatorFor('robot-a').deferNextSwitch()
  const adding = sourceManager.reconcile(oneInstance({ assignment: profileA }))
  await coordinatorFor('robot-a').waitUntilSwitchQueued()
  const removing = sourceManager.reconcile(noInstances())
  coordinatorFor('robot-a').releaseDeferredSwitch()
  await Promise.all([adding, removing])
  expect(sourceManager.hasRobotForTest('robot-a')).toBe(false)
  expect(coordinatorRegistry.hasRobot('robot-a')).toBe(false)
})

it('contains reconcile rejection as a per-instance diagnostic', async () => {
  coordinatorFor('robot-a').switchSource.mockRejectedValueOnce(new Error('socket failed'))
  await expect(sourceManager.reconcile(oneInstance({ assignment: profileA }))).resolves.toBeUndefined()
  expect(readSourceDiagnostic('robot-a')).toMatch(/socket failed/i)
  expect(unhandledRejections).toHaveLength(0)
})

it('does not retarget a live manager entry when assigned profile upsert is rejected', async () => {
  await profileStore.getState().upsert(profileA)
  await profileStore.getState().assignToRobot('robot-a', profileA.id)
  const firstReconcile = sourceManager.reconcile(readHydratedInstancesAndProfiles())
  const socket = await waitForOpcUaSocket('robot-a')
  socket.emit(profileAcceptedFor(profileA))
  await firstReconcile
  await expect(profileStore.getState().upsert({
    ...profileA, gatewayProfileId: 'different-server-profile',
  })).rejects.toThrow(/assigned/i)
  await sourceManager.reconcile(readHydratedInstancesAndProfiles())
  expect(sourceManager.signatureForTest('robot-a')).toBe(signatureFor(profileA))
  expect(opcUaSourceFactory).toHaveBeenCalledTimes(1)
})

it('cannot assign profile B while the manager is connecting profile A', async () => {
  await profileStore.getState().upsert(profileA)
  await profileStore.getState().upsert(profileB)
  await profileStore.getState().assignToRobot('robot-a', profileA.id)
  coordinatorFor('robot-a').deferNextSwitch()
  const reconcile = sourceManager.reconcile(readHydratedInstancesAndProfiles())
  await coordinatorFor('robot-a').waitUntilSwitchQueued()
  await expect(profileStore.getState().assignToRobot('robot-a', profileB.id))
    .rejects.toThrow(/transition.*pending/i)
  coordinatorFor('robot-a').releaseDeferredSwitch()
  const socket = await waitForOpcUaSocket('robot-a')
  socket.emit(profileAcceptedFor(profileA))
  await reconcile
  socket.emit(jointFrameMessage())
  expect(readInstance('robot-a').opcUaProfileSelectionId).toBe(profileA.id)
  expect(sourceManager.signatureForTest('robot-a')).toBe(signatureFor(profileA))
  expect(coordinatorFor('robot-a').snapshot()).toMatchObject({ mode: 'opcua', ready: true })
})
```

- [ ] **Step 2: Run RED**

Run: `npm run test:run -- src/features/opcua/OpcUaGatewayJointSource.test.ts src/features/opcua/RobotJointSourceManager.test.ts`

Expected: FAIL because the browser source does not exist.

- [ ] **Step 3: Implement the source**

Expose `readonly mode = 'opcua'` and `readonly robotInstanceId`. Use an injected
`WebSocketFactory` for tests. On open, send one validated subscribe message
containing only instance ID, allowed profile ID, and definition identity. Parse
`profileId` from `profileSelection.gatewayProfileId`; the browser selection's
own record ID is never sent as authorization. Parse
the server's `profile-accepted` message and require its ID/definition/revision to
match the selected record before accepting joint frames. Against the active
effective definition, require bindings to contain every movable joint exactly
once and no other joint; degree/radian units are valid only for revolute or
continuous joints, while millimeter/meter are valid only for prismatic joints.
Fixed joints have no binding. Any mismatch closes/rejects that source
generation, records a diagnostic, and never reaches ready or frame reduction.
`connect()` remains pending after socket open and resolves only after the first
matching, fully validated `profile-accepted`. A server error, incompatible
acknowledgement, socket error/close, explicit Disconnect, or 3,000 ms
acknowledgement timeout rejects that initial promise with a bounded
browser-source error code (`PROFILE_NOT_ALLOWED`,
`PROFILE_REVISION_MISMATCH`, `PROFILE_INCOMPATIBLE`,
`PROFILE_ACK_SOCKET_ERROR`, `PROFILE_ACK_CLOSED`, or `PROFILE_ACK_TIMEOUT`),
removes listeners/timers, and schedules no reconnect because the
coordinator has not committed this source. The coordinator can therefore
atomically reconnect its prior Simulation source and roll back the source-mode
transaction. Profile acceptance alone does not set readiness; the first valid
GOOD/UNCERTAIN complete joint frame does. Only after initial acceptance does an
unexpected later close enter the bounded reconnect loop.
Parse every server
message and require gateway sequence to
increase strictly within that socket generation. Rewrite it to a source-local
monotonic emitted sequence that never resets across reconnects, validate the
rewritten frame against the active effective definition, and emit it. Synthetic
STALE frames increment the same emitted sequence. Use a generation token so old
socket, timer, and reconnect callbacks are inert. Reconnect at 250, 500, 1,000,
2,000, and 5,000 ms and reset backoff after a valid GOOD/UNCERTAIN frame.
Implement `subscribeStatus()` as a separate listener channel: connect/socket
open/reconnect publishes CONNECTING, every validated server status is forwarded,
synthetic stale publishes STALE, and an unexpected close publishes DISCONNECTED
then CONNECTING when a retry starts. Status messages never fabricate empty joint
frames and can only lower coordinator readiness until a valid frame arrives.
Explicit Disconnect cancels every timer/listener/socket, publishes DISCONNECTED,
and never reconnects.

- [ ] **Step 4: Integrate source creation without storing credentials**

```ts
const sourceManager = useMemo(() => new RobotJointSourceManager({
  gatewayUrl: import.meta.env.VITE_OPCUA_GATEWAY_URL ?? 'ws://127.0.0.1:8765',
  coordinatorRegistry: jointSourceRegistry,
  opcUaSourceFactory,
  simulationSourceFactory,
  reportDiagnostic,
}), [])

useEffect(() => {
  void sourceManager.reconcile({
    instances: hydratedInstances,
    profilesById,
    getEffectiveDefinition,
  })
}, [sourceManager, hydratedInstances, profilesById, effectiveDefinitionRevisions])
```

`RobotJointSourceManager` owns an ID-keyed source/signature map for every
hydrated RobotInstance, independent of Asset Tree selection. Reconcile retains
unchanged connections, constructs Simulation sources for Simulation instances,
and constructs an OPC source only when that instance's non-null assigned
profile exists and matches definition/revision. A null/missing/corrupt
assignment records an error and leaves that coordinator not-ready; it never
calls the factory or throws during render. Changed mode/profile/definition
switches only that instance through its coordinator. Removed instances use the
deletion/finalization path. App unmount calls manager `disconnectAll()` once.
Changing active selection only changes the Inspector and never a source
lifecycle. The native browser WebSocket sends no bearer token; in
non-loopback deployments the authenticated reverse proxy injects the upstream
Authorization header after authenticating the browser session.

Every `reconcile()` increments one manager generation and synchronously assigns
a per-instance desired token before awaiting source construction or coordinator
work. Only the token that still matches may publish its source/signature entry
or diagnostic. A newer profile/mode/definition request invalidates the older
token and relies on the coordinator's last-request-wins generation to dispose
the obsolete candidate. A removed instance invalidates its token before
awaiting deletion/finalization, so a deferred create can only dispose itself and
can never repopulate the map. `disconnectAll()` first invalidates the manager
generation and every token. Reconcile catches each instance failure internally,
records one bounded diagnostic for the current token, cleans the candidate, and
always resolves; therefore the App's intentional `void sourceManager.reconcile`
cannot create an unhandled rejection. Tests must cover deferred old-to-new
profile replacement, removal during creation, and a rejected coordinator
switch.
The retained signature contains instance ID, source mode, assigned selection
ID, `gatewayProfileId`, and definition/configuration revisions, but excludes the
selection display name; a permitted rename updates the Inspector without
reconnecting the source.

There is no global `activeProfile` fallback.

Do not persist the WebSocket URL, cookies, bearer tokens, sockets, timers, source
objects, or Three objects in Zustand or Dexie.

- [ ] **Step 5: Test and commit**

Run: `npm run test:run -- src/features/opcua src/app/AppShell.test.tsx`

Expected: PASS.

```powershell
git add src/features/opcua/OpcUaGatewayJointSource.ts src/features/opcua/OpcUaGatewayJointSource.test.ts src/features/opcua/RobotJointSourceManager.ts src/features/opcua/RobotJointSourceManager.test.ts src/app/App.tsx src/app/AppShell.test.tsx
git diff --cached --check
git commit -m "feat: stream OPC UA joints into the browser"
```

## Task 7: Add OPC UA Profile and Source Diagnostics UI

**Files:**
- Create: `src/features/opcua/OpcUaInspector.tsx`
- Create: `src/features/opcua/OpcUaInspector.test.tsx`
- Modify: `src/app/AppShell.tsx`
- Modify: `src/features/joints/JointInspector.tsx`
- Modify: `src/features/robot-config/mechanical-config-store.ts`
- Modify: `src/features/robot-config/mechanical-config-store.test.ts`
- Modify: `src/features/robot-config/MechanicalEditor.tsx`
- Modify: `src/features/robot-config/MechanicalEditor.test.tsx`
- Modify: `src/styles/global.css`

**Interfaces:**
- Consumes: browser profile-selection store, accepted server profile diagnostics, and the selected RobotInstance's coordinator state.
- Produces: accessible allowed-profile selector, explicit per-instance mode switch, read-only joint binding diagnostics, per-instance source quality display, and authoritative mechanical-edit ownership enforcement through the Task 2 mutation gate.

- [ ] **Step 1: Write UI RED tests**

```tsx
it('requires confirmation, locks manual controls, and shows every binding', async () => {
  render(<OpcUaInspector robotInstanceId="robot-1" />)
  await user.type(screen.getByLabelText('Profile selection name'), 'Robot 1 profile')
  await user.type(screen.getByLabelText('Gateway profile ID'), 'crb-profile')
  await user.click(screen.getByRole('button', { name: 'Save and Assign' }))
  expect(assignToRobot).toHaveBeenCalledWith('robot-1', expect.any(String))
  await user.click(screen.getByRole('button', { name: 'Use OPC UA' }))
  expect(screen.getByRole('dialog', { name: 'Switch joint source' })).toBeVisible()
  await user.click(screen.getByRole('button', { name: 'Confirm OPC UA mode' }))
  await gateway.emitProfileAccepted(allowedProfile)
  expect(screen.getByLabelText('J1 NodeId')).toHaveValue('ns=2;s=J1')
  expect(screen.getByLabelText('J1 NodeId')).toHaveAttribute('readonly')
  expect(screen.getByRole('status')).toHaveTextContent('CONNECTING')
  expect(screen.getByLabelText('J1 angle')).toBeDisabled()
})

it('switches robot-a without locking robot-b Simulation controls', async () => {
  renderTwoRobotInspectors()
  await switchRobotToOpcUa('robot-a')
  expect(screen.getByLabelText('robot-a J1 angle')).toBeDisabled()
  expect(screen.getByLabelText('robot-b P1 position')).toBeEnabled()
})

it('locks only the OPC-owned robot Mechanical Editor', async () => {
  renderTwoRobotMechanicalEditors()
  await switchRobotToOpcUa('robot-a')
  expect(screen.getByRole('button', { name: 'Apply robot-a mechanical configuration' })).toBeDisabled()
  expect(screen.getByRole('button', { name: 'Apply robot-b mechanical configuration' })).toBeEnabled()
})

it('rejects direct mechanical Apply while OPC owns the instance', async () => {
  setPersistedSourceMode('robot-a', 'opcua')
  previewMechanicalChange('robot-a')
  const dbBefore = await readMechanicalRows('robot-a')
  const runtimeBefore = readEffectiveDefinition('robot-a')
  await expect(mechanicalStore.getState().apply('robot-a', 'config-a', acknowledgement()))
    .rejects.toThrow(/Simulation.*stopped/i)
  expect(await readMechanicalRows('robot-a')).toEqual(dbBefore)
  expect(readEffectiveDefinition('robot-a')).toBe(runtimeBefore)
})

it('invalidates in-flight mechanical Apply when source switching is requested', async () => {
  mutationGate.deferBeforeCommit('robot-a')
  previewMechanicalChange('robot-a')
  const dbBefore = await readMechanicalRows('robot-a')
  const runtimeBefore = readEffectiveDefinition('robot-a')
  const apply = mechanicalStore.getState().apply('robot-a', 'config-a', acknowledgement())
  await mutationGate.waitUntilCommitBoundary('robot-a')
  const switchSource = coordinatorFor('robot-a').switchSource(opcUaSourceFor('robot-a'))
  mutationGate.releaseCommitBoundary('robot-a')
  await expect(apply).rejects.toThrow(/ownership changed/i)
  await switchSource
  expect(await readMechanicalRows('robot-a')).toEqual(dbBefore)
  expect(readEffectiveDefinition('robot-a')).toBe(runtimeBefore)
})

it('rejects direct preview under OPC and cancels an existing preview before switching', async () => {
  previewMechanicalChange('robot-a')
  expect(readEffectiveDefinition('robot-a')).not.toBe(readCommittedEffectiveDefinition('robot-a'))
  const switching = coordinatorFor('robot-a').switchSource(opcUaSourceFor('robot-a'))
  expect(readMechanicalDraft('robot-a')).toBeUndefined()
  expect(readEffectiveDefinition('robot-a')).toBe(readCommittedEffectiveDefinition('robot-a'))
  await switching
  expect(() => mechanicalStore.getState().previewJointOrigin(
    'robot-a', 'config-a', 'joint-1', poseAt(0, 0, 0.72),
  )).toThrow(/Simulation.*stopped/i)
})
```

- [ ] **Step 2: Run RED**

Run: `npm run test:run -- src/features/opcua/OpcUaInspector.test.tsx src/features/joints/JointInspector.test.tsx src/features/robot-config/mechanical-config-store.test.ts src/features/robot-config/MechanicalEditor.test.tsx`

Expected: FAIL because the inspector does not exist.

- [ ] **Step 3: Implement the inspector**

Render browser selection name, server profile ID, Save, `Save and Assign`,
`Assign to this robot`, Delete Selection, Connect, Disconnect, and `Use
Simulation`/`Use OPC UA`. Save alone creates a reusable record; assignment is
an explicit per-RobotInstance transaction and is required before OPC mode. A
selected instance displays its currently assigned profile independently from
the app's active tree selection. After the
gateway accepts the profile, render one read-only row per movable joint with
NodeId, source unit, scale, offset, direction, and sampling interval. The UI
never edits or submits a NodeId mapping; its recovery copy points operators to
the server-owned `GATEWAY_PROFILE_FILE`. Validate the selected profile ID and
definition identity before save. Use a native dialog with focus return and
Escape cancellation. Announce status/errors through `role="status"` and
`role="alert"`. Never render bearer tokens, authorization headers, certificate
paths, keys, or passwords.
Block deletion of an assigned selection and name every referencing robot; the
operator must unassign or delete those instances first.
Disable `Assign to this robot` while that instance is OPC-owned and direct the
operator to `Use Simulation`; the store repeats the same authority check.

- [ ] **Step 4: Lock all Simulation mutation surfaces**

Joint sliders/numbers, Home, Pose Save, Sequence edit/play, Mechanical Editor,
and gripper-driven automatic pose playback remain disabled only for the
RobotInstance owned by OPC UA. Other robots' Simulation controls, mechanical
configuration, object editing, and camera navigation remain enabled. Source
switching stops that robot's playback before the dialog closes.

Inject the Task 2 `RobotSimulationMutationGate` into
`mechanical-config-store.ts`. `apply(robotInstanceId, configurationId, ...)`
begins a lease for that explicit instance and verifies its persisted
configuration/revision still matches the instance-scoped draft; it never
derives ownership from active selection or from a possibly shared configuration
ID. It performs draft/geometry validation on a
clone, and calls `runIfCurrent()` around the entire Dexie transaction plus the
post-commit effective-definition/TCP/collider publication. The gate rechecks
Simulation ownership and stopped playback under the same per-instance mutex.
An OPC/Play transition requested before commit invalidates the lease; if Apply
already owns the mutex, Apply finishes while Simulation still owns the robot
and the transition waits. Guard denial is not a persistence fallback: it leaves
DB, committed runtime, and preview draft unchanged and reports an actionable
ownership error. The editor's disabled state mirrors this boundary but is not
the authority.
Every synchronous preview method first calls
`mutationGate.assertSimulationEditable(robotInstanceId)`. Register one
idempotent transition-cleanup hook per hydrated instance that cancels its draft
and republishes the committed effective definition/TCP/colliders synchronously
when source switching or Play is requested. `cancel()` itself remains safe and
available for cleanup. Consequently no pre-existing preview and no late direct
preview can alter FK, limits, or collision geometry under incoming OPC frames.

- [ ] **Step 5: Test and commit**

Run: `npm run test:run -- src/features/opcua src/features/joints src/features/robot-config src/app/AppShell.test.tsx`

Expected: PASS.

```powershell
git add src/features/opcua/OpcUaInspector.tsx src/features/opcua/OpcUaInspector.test.tsx src/app/AppShell.tsx src/features/joints/JointInspector.tsx src/features/joints/robot-simulation-mutation-gate.ts src/features/joints/robot-simulation-mutation-gate.test.ts src/features/robot-config/mechanical-config-store.ts src/features/robot-config/mechanical-config-store.test.ts src/features/robot-config/MechanicalEditor.tsx src/features/robot-config/MechanicalEditor.test.tsx src/styles/global.css
git diff --cached --check
git commit -m "feat: select allowed OPC UA joint profiles"
```

## Task 8: Add End-to-End Verification and Luna Documentation

**Files:**
- Create: `scripts/test/mock-opcua-gateway.ts`
- Create: `scripts/test/mock-opcua-gateway.test.ts`
- Create: `scripts/verify/scan-credentials.ps1`
- Create: `scripts/verify/scan-opcua-readonly.ps1`
- Create: `scripts/verify/scan-opcua-readonly.test.ps1`
- Create: `e2e/opcua-source.spec.ts`
- Modify: `playwright.config.ts`
- Modify: `.env.test`
- Modify: `src/test/debug-bridge.ts`
- Modify: `src/test/debug-bridge.test.ts`
- Create: `docs/opcua-gateway.md`
- Create: `docs/operator/joint-source-modes.md`
- Modify: `README.md`

**Interfaces:**
- Consumes: built gateway and browser application.
- Produces: deterministic source-mode E2E, per-instance read-only diagnostics,
  and operator/developer documentation.

- [ ] **Step 1: Implement a deterministic mock gateway**

Create one process with a WebSocket server on `127.0.0.1:8766` and an HTTP
control server on `127.0.0.1:8767`. Each WebSocket validates exactly one
subscribe message, resolves only checked-in `crb-profile` and
`resolved-urdf-profile` fixtures, asserts the message has
profile/definition/instance identity but no NodeId, binding, credential, or
authorization field, sends `profile-accepted`, and records one subscription
per RobotInstance. Keep per-instance values and a monotonically increasing
sequence across socket reconnects. Immediately send one complete GOOD frame so
each source satisfies its initial readiness contract. The HTTP API is
loopback-only and has this exact contract:

```text
GET  /health
  200 {
    "ready": true,
    "webSocketClients": number,
    "lastSubscribe": {
      "robotInstanceId": string,
      "profileId": string,
      "robotDefinitionId": string,
      "robotDefinitionRevision": string
    } | null,
    "activeRobotInstanceIds": string[]
  }

POST /control
  { "command": "emit", "robotInstanceId": string,
    "quality": "GOOD"|"UNCERTAIN"|"BAD",
    "jointValues"?: Record<string, number> }
  { "command": "stale", "robotInstanceId": string }
  { "command": "wrong-revision", "robotInstanceId": string }
  { "command": "incomplete", "robotInstanceId": string }
  { "command": "reordered", "robotInstanceId": string }
  { "command": "disconnect", "robotInstanceId": string }
  { "command": "reset" }
  -> 202 { "accepted": true }
```

`emit` clears stale suppression for the addressed instance, sends a complete
frame tagged with that RobotInstance, and uses finite `jointValues` only for
joint IDs allowed by that mock profile;
`stale` suppresses further frames for only that instance so its browser timer
becomes STALE;
`wrong-revision`, `incomplete`, and `reordered` send exactly one malformed
fixture; `disconnect` closes only that instance's WebSocket while retaining its
sequence/value state for the automatic resubscribe; and `reset` closes all
sockets and clears every sequence, value, and remembered subscription. A
duplicate live subscription for one RobotInstance supersedes and closes the old
socket. Unknown paths, methods, fields, commands, instance IDs, joint IDs, or
quality values return 400/404 without changing state. `/health.lastSubscribe`
is a newly allocated safe projection with exactly the four documented keys; it
must never echo NodeIds, bindings, bearer tokens, headers, or raw subscribe
objects. On readiness print
`MOCK_OPCUA_READY ws=8766 control=8767` once.

`scripts/test/mock-opcua-gateway.test.ts` starts with
`// @vitest-environment node`, starts the real child process, waits
for `/health`, observes one subscribe/control/frame round trip, sends SIGTERM,
awaits exit code 0, then binds both ports again to prove cleanup. Failure paths
must terminate the child in `finally`.

Preserve existing test-mode entries and ensure `.env.test` contains no
credentials and these values:

```dotenv
VITE_E2E=1
VITE_OPCUA_GATEWAY_URL=ws://127.0.0.1:8766
```

Append a second Playwright web server entry while preserving the existing Vite
preview entry:

```ts
webServer: [
  {
    command: 'npm run preview -- --host 127.0.0.1 --port 4173',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: false,
    timeout: 30_000,
  },
  {
    command: 'tsx scripts/test/mock-opcua-gateway.ts',
    url: 'http://127.0.0.1:8767/health',
    reuseExistingServer: false,
    timeout: 30_000,
  },
]
```

The Playwright helper implements a targeted `mockGateway.emit(...)` as:

```ts
async function emit(
  robotInstanceId: string,
  quality: 'GOOD' | 'UNCERTAIN' | 'BAD',
  jointValues?: Readonly<Record<string, number>>,
): Promise<void> {
  const response = await fetch('http://127.0.0.1:8767/control', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ command: 'emit', robotInstanceId, quality, jointValues }),
  })
  if (response.status !== 202) throw new Error(`Mock gateway control failed: ${response.status}`)
}
```

- [ ] **Step 2: Write failing Playwright acceptance**

Extend the already guarded Generic/Frame debug snapshot so each robot record
also contains plain-JSON `sourceMode`, `sourceReady`, `sourceQuality`, and
`sourceStatus`, a bounded last-16 `sourceStatusHistory`, `sourceGeneration`,
`lastAcceptedSequence`, `lastGoodTimestampMs`, and `lastRejectedReason`. The
E2E-only status recorder subscribes synchronously to each coordinator, appends
each actual transition, and resets on page load; the reconnect assertion polls
that history for the ordered DISCONNECTED→CONNECTING→GOOD subsequence rather
than sampling transient DOM text. The bridge reads the existing coordinator/runtime slices,
exposes no source object or mutation function, remains absent outside
`VITE_E2E=1`, and has a two-instance serialization/isolation unit test.

```ts
test('switches ownership and holds the last good OPC UA pose', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('tab', { name: 'OPC UA' }).click()
  await page.getByLabel('Profile selection name').fill('Local CRB profile')
  await page.getByLabel('Gateway profile ID').fill('crb-profile')
  await page.getByRole('button', { name: 'Save and Assign' }).click()
  await expect(page.getByLabel('OPC UA profile selection')).toHaveValue(/crb-profile/)
  await page.getByRole('button', { name: 'Use OPC UA' }).click()
  await page.getByRole('button', { name: 'Confirm OPC UA mode' }).click()
  await expect(page.getByLabel('J1 NodeId')).toHaveAttribute('readonly')
  await expectRobotSource(page, 'crb15000-01', {
    sourceMode: 'opcua', sourceReady: true, sourceQuality: 'GOOD',
  })
  const health = await mockGateway.health()
  expect(health.lastSubscribe).toEqual({
    robotInstanceId: 'crb15000-01',
    profileId: 'crb-profile',
    robotDefinitionId: 'crb15000-12kg-127',
    robotDefinitionRevision: 'builtin-v1',
  })
  expect(Object.keys(health.lastSubscribe!).sort()).toEqual([
    'profileId', 'robotDefinitionId', 'robotDefinitionRevision', 'robotInstanceId',
  ])

  const initial = await readRobotDebugRecord(page, 'crb15000-01')
  await mockGateway.emit('crb15000-01', 'GOOD', { J1: 0.35, J2: -0.1 })
  await expect.poll(async () => (
    await readRobotDebugRecord(page, 'crb15000-01')
  ).lastAcceptedSequence).toBeGreaterThan(initial.lastAcceptedSequence)
  const good = await readRobotDebugRecord(page, 'crb15000-01')
  expect(good.jointPositions).toMatchObject({ J1: 0.35, J2: -0.1 })
  expect(good).toMatchObject({ sourceReady: true, sourceQuality: 'GOOD' })

  await mockGateway.emit('crb15000-01', 'BAD', { J1: 1.2, J2: 0.8 })
  await expectRobotSource(page, 'crb15000-01', {
    sourceReady: false, sourceQuality: 'BAD',
  })
  expect((await readRobotDebugRecord(page, 'crb15000-01')).jointPositions)
    .toEqual(good.jointPositions)

  await mockGateway.emit('crb15000-01', 'GOOD', { J1: 0.4, J2: -0.2 })
  await expectRobotJointPositions(page, 'crb15000-01', { J1: 0.4, J2: -0.2 })
  const beforeStale = await readRobotDebugRecord(page, 'crb15000-01')
  await mockGateway.control({ command: 'stale', robotInstanceId: 'crb15000-01' })
  await expectRobotSource(page, 'crb15000-01', {
    sourceReady: false, sourceQuality: 'STALE',
  })
  expect((await readRobotDebugRecord(page, 'crb15000-01')).jointPositions)
    .toEqual(beforeStale.jointPositions)

  await mockGateway.emit('crb15000-01', 'GOOD')
  await expectRobotSource(page, 'crb15000-01', {
    sourceReady: true, sourceQuality: 'GOOD',
  })
  const beforeWrongRevision = await readRobotDebugRecord(page, 'crb15000-01')
  await mockGateway.control({ command: 'wrong-revision', robotInstanceId: 'crb15000-01' })
  await expect.poll(async () => (
    await readRobotDebugRecord(page, 'crb15000-01')
  ).lastRejectedReason).toBe('wrong-revision')
  const afterWrongRevision = await readRobotDebugRecord(page, 'crb15000-01')
  expect(afterWrongRevision.jointPositions).toEqual(beforeWrongRevision.jointPositions)
  expect(afterWrongRevision.lastAcceptedSequence).toBe(beforeWrongRevision.lastAcceptedSequence)

  const beforeDisconnect = afterWrongRevision
  await mockGateway.control({ command: 'disconnect', robotInstanceId: 'crb15000-01' })
  await expectRobotSourceStatusSequence(page, 'crb15000-01', [
    'DISCONNECTED', 'CONNECTING', 'GOOD',
  ])
  const reconnected = await readRobotDebugRecord(page, 'crb15000-01')
  expect(reconnected.sourceReady).toBe(true)
  expect(reconnected.lastAcceptedSequence).toBeGreaterThan(beforeDisconnect.lastAcceptedSequence)

  await page.reload()
  await expect(page.getByLabel('OPC UA profile selection')).toHaveValue(/crb-profile/)
  await expectRobotSource(page, 'crb15000-01', {
    sourceMode: 'opcua', sourceReady: true, sourceQuality: 'GOOD',
  })
  await expect(page.getByRole('button', { name: 'Play' })).toBeDisabled()
  await page.getByRole('button', { name: 'Use Simulation' }).click()
  await expectRobotSource(page, 'crb15000-01', {
    sourceMode: 'simulation', sourceReady: true, sourceQuality: 'GOOD',
  })
  await expect(page.getByLabel('J1 angle')).toBeEnabled()
})

test('rejects an unknown gateway profile and rolls the source transition back', async ({ page }) => {
  await page.goto('/')
  await saveAndAssignProfile(page, 'Rejected profile', 'not-allowlisted')
  await requestOpcUaMode(page, 'CRB15000')
  await expect(page.getByRole('alert')).toContainText(
    'PROFILE_NOT_ALLOWED: Unknown profile not-allowlisted',
  )
  await expectRobotSource(page, 'crb15000-01', {
    sourceMode: 'simulation', sourceReady: true, sourceQuality: 'GOOD',
  })
  await expect(page.getByLabel('J1 angle')).toBeEnabled()
})

test('isolates source ownership and targeted frames for two robot instances', async ({ page }) => {
  await page.goto('/')
  await importResolvedUrdf(page, fixturePath('resolved-urdf'), {
    requestedInstanceId: 'urdf-1', flangeParentLinkId: 'slider',
    flangeLocalId: 'tool0', tcpLocalId: 'default',
  })
  await saveAndAssignProfile(page, 'Local CRB profile', 'crb-profile', 'crb15000-01')
  await saveAndAssignProfile(page, 'Local URDF profile', 'resolved-urdf-profile', 'urdf-1')

  await requestOpcUaMode(page, 'CRB15000')
  await expectJointControl(page, 'crb15000-01', 'J1', { enabled: false })
  await expectJointControl(page, 'urdf-1', 'arm-revolute', { enabled: true })
  await setJointPosition(page, 'arm-revolute', { displayValue: 10, unit: 'deg' })
  await expectRobotSource(page, 'urdf-1', { sourceMode: 'simulation', sourceReady: true })

  await requestOpcUaMode(page, 'URDF Test Robot')
  await expect.poll(async () => (await mockGateway.health()).activeRobotInstanceIds.sort())
    .toEqual(['crb15000-01', 'urdf-1'])
  const beforeCrbFrame = await readRobotDebugRecord(page, 'urdf-1')
  await mockGateway.emit('crb15000-01', 'GOOD', { J1: 0.6 })
  await expectRobotJointPositions(page, 'crb15000-01', { J1: 0.6 })
  expect((await readRobotDebugRecord(page, 'urdf-1')).jointPositions)
    .toEqual(beforeCrbFrame.jointPositions)

  const beforeUrdfFrame = await readRobotDebugRecord(page, 'crb15000-01')
  await mockGateway.emit('urdf-1', 'GOOD', {
    'arm-revolute': 0.25, 'slider-prismatic': 0.15,
  })
  await expectRobotJointPositions(page, 'urdf-1', {
    'arm-revolute': 0.25, 'slider-prismatic': 0.15,
  })
  expect((await readRobotDebugRecord(page, 'crb15000-01')).jointPositions)
    .toEqual(beforeUrdfFrame.jointPositions)

  await useSimulationMode(page, 'CRB15000')
  await expectJointControl(page, 'crb15000-01', 'J1', { enabled: true })
  await expectJointControl(page, 'urdf-1', 'arm-revolute', { enabled: false })
  await expectRobotSource(page, 'urdf-1', { sourceMode: 'opcua', sourceReady: true })
})
```

- [ ] **Step 3: Run E2E and prove RED, then GREEN**

Run: `npm run test:e2e -- e2e/opcua-source.spec.ts`

Expected before wiring: FAIL at source switch. Expected after mock webServer
wiring: PASS for GOOD movement, BAD hold, stale hold, revision rejection,
disconnect/reconnect, profile-selection persistence, unknown-profile rejection, two-instance isolation,
manual-control lock, and immediate complete-frame readiness after explicit
return to Simulation. The suite calls `reset` in `beforeEach` and verifies
`/health` has zero clients in `afterAll`; Playwright owns process shutdown.

- [ ] **Step 4: Write Luna documentation**

`docs/opcua-gateway.md` must document installation, environment variables,
loopback default, certificates, exact `GATEWAY_PROFILE_FILE` schema, server-side
NodeId authorization, origin allowlist, `reverse-proxy-bearer` deployment,
upstream header injection/stripping, token rotation without browser exposure,
binding formula, sampling, quality mapping, troubleshooting, and the strict
read-only boundary. Document the shared protocol package and NodeNext gateway
build separately from the Vite client. The operator guide must document
per-robot source ownership, server-profile selection, read-only mapping
diagnostics, status meanings, switching, locked controls, last-good hold, and
safe recovery. State explicitly that this is simulation ingestion, not
safety-rated robot control.

Create `scripts/verify/scan-credentials.ps1` with PowerShell 5.1-compatible
array handling and explicit ripgrep exit semantics:

```powershell
$pattern = 'BEGIN[ -].*PRIVATE|password\s*[:=]\s*[''"][^''"]+|GATEWAY_UPSTREAM_BEARER_TOKEN\s*=\s*\S+'
$arguments = @(
  '-n', '-i', '--hidden', $pattern,
  '--glob', 'src/**',
  '--glob', 'gateway/**',
  '--glob', 'packages/opcua-protocol/**',
  '--glob', '.env*',
  '--glob', '!package-lock.json',
  '--', '.'
)
& rg @arguments
if ($LASTEXITCODE -eq 0) {
  Write-Error 'Credential or private-key material was found.'
  exit 1
}
if ($LASTEXITCODE -eq 1) {
  Write-Output 'Credential scan passed.'
  exit 0
}
exit $LASTEXITCODE
```

Create `scripts/verify/scan-opcua-readonly.ps1` so legitimate HTTP upgrade
`socket.write()` calls are not matched:

```powershell
param([string]$Root = '.')

$adapterPath = Join-Path $Root 'gateway/src/opcua-adapter.ts'
$adapterPattern = '\.(write|writeSingleNode|writeHistoryValue|call)\s*\('
$adapterHits = & rg -n -i $adapterPattern -- $adapterPath
$adapterExit = $LASTEXITCODE
if ($adapterExit -ne 0 -and $adapterExit -ne 1) { exit $adapterExit }

$requestPattern = '\b(WriteRequest|WriteValue|WriteResponse|CallRequest|CallMethodRequest|CallMethodResult|writeSingleNode|writeHistoryValue)\b'
$requestHits = & rg -n -i $requestPattern --glob '!*.test.ts' -- `
  (Join-Path $Root 'gateway/src') `
  (Join-Path $Root 'packages/opcua-protocol/src')
$requestExit = $LASTEXITCODE
if ($requestExit -ne 0 -and $requestExit -ne 1) { exit $requestExit }

if ($adapterExit -eq 0 -or $requestExit -eq 0) {
  $adapterHits
  $requestHits
  Write-Error 'An OPC UA write/call API or request type was found.'
  exit 1
}
Write-Output 'OPC UA read-only scan passed.'
exit 0
```

`scan-opcua-readonly.test.ps1` creates a temporary fixture root and invokes the
scanner in a child PowerShell process for four cases: `clientSession1.write()`
in `opcua-adapter.ts` fails; `(await session()).call()` there fails; an imported
`WriteRequest` anywhere under gateway source fails; and
`websocket-server.ts` containing only HTTP `socket.write()` passes. It removes
the temp root in `finally` and asserts exact child exit codes, proving receiver
names and expression receivers cannot bypass the read-only gate without
flagging legitimate HTTP upgrade writes.

- [ ] **Step 5: Run final gates**

Run each command only after the previous command exits 0:

```powershell
npm run lint
```

```powershell
npm run test:run
```

Expected: PASS, including `scripts/test/mock-opcua-gateway.test.ts` process and
port cleanup.

```powershell
npm run gateway:test
```

```powershell
npm run gateway:build
```

```powershell
npm run cad:validate
```

```powershell
npm run build
```

```powershell
npm run test:e2e -- e2e/opcua-source.spec.ts
```

```powershell
npm audit --omit=dev --audit-level=high
```

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/verify/scan-credentials.ps1
```

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/verify/scan-opcua-readonly.ps1
```

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/verify/scan-opcua-readonly.test.ps1
```

```powershell
$placeholderHits = & rg -n -i "T[B]D|T[O]DO|F[I]XME" docs/opcua-gateway.md docs/operator/joint-source-modes.md
if ($LASTEXITCODE -eq 0) { $placeholderHits; throw 'Documentation placeholders remain' }
if ($LASTEXITCODE -ne 1) { exit $LASTEXITCODE }
```

```powershell
git diff --check
```

Expected: all tests/builds pass; CAD reports 7 assets, 0 errors, 0 warnings;
audit has no high/critical production vulnerability; both security scans pass;
the placeholder scan prints nothing; no credential literal or OPC UA write/call
implementation exists.

- [ ] **Step 6: Commit**

```powershell
git add scripts/test/mock-opcua-gateway.ts scripts/test/mock-opcua-gateway.test.ts scripts/verify/scan-credentials.ps1 scripts/verify/scan-opcua-readonly.ps1 scripts/verify/scan-opcua-readonly.test.ps1 e2e/opcua-source.spec.ts playwright.config.ts .env.test src/test/debug-bridge.ts src/test/debug-bridge.test.ts docs/opcua-gateway.md docs/operator/joint-source-modes.md README.md
git diff --cached --check
git commit -m "test: verify read-only OPC UA joint ingestion"
```

## Completion Gate

Before marking this plan complete, a fresh reviewer must confirm that the
shared package and NodeNext output build from a clean checkout, the gateway has
no write-capable API surface, non-loopback upgrades require the proxy bearer,
client messages cannot authorize NodeIds, emitted frames carry the requested
RobotInstance ID, two robot sources remain isolated, late sockets cannot update
state, binding conversion is correct, BAD/STALE holds the last good pose without
setting ready, Simulation reconnect publishes a full initial frame, controls are
locked only for the OPC-owned robot, credentials remain server-side, all
automated gates pass, and no PLC or controller project was changed.
