# Frame Graph and Manual Coordinates Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a validated, persistent World/MCP/Robot Base/equipment coordinate hierarchy with manual numeric and 3D editing while preserving every current CRB15000, equipment, collision, grasp, and saved-world-pose behavior.

**Architecture:** Canonical `Pose3D` math and a pure validated frame graph form the domain boundary; the graph stores only parent-relative position and normalized quaternion, while Three.js objects remain runtime adapters. Dexie v2 migrates each existing equipment world transform into a dedicated equipment frame without a visible jump, and Zustand separates committed persistent frames from derived/runtime robot frames and memory-only previews. The current CRB15000 is mounted through `World -> MCP -> Robot Base`; a pure FK adapter emits read-only namespaced joint/link/flange nodes before render, and equipment rendering, colliders, grasp/release, numeric editing, reparenting, and gizmos all resolve through the same graph.

**Tech Stack:** Node 22.15.1, npm 11.4.2, React 19.2.7, Vite 8.1.4, TypeScript 6.0.3, Three.js 0.185.1, React Three Fiber 9.6.1, Drei 10.7.7, React Three Rapier 2.2.0, Zustand 5.0.14, Dexie 4.4.4, Vitest 4.1.10, Testing Library 16.3.2, Playwright 1.61.1, Oxlint 1.73.0.

## Global Constraints

- Use a right-handed, Z-up scene with internal metres, radians, and normalized quaternions in `[x, y, z, w]` order.
- A stored `Pose3D` is always `T_parent_child`; UI Euler composition is exactly `q = qz(yaw) * qy(pitch) * qx(roll)` and fields are labelled Roll X, Pitch Y, and Yaw Z.
- World is the one immutable root; every other frame has exactly one existing parent, frame IDs are unique, and cycles are rejected before any state or Dexie mutation.
- Cell-scoped frame IDs are globally unique. Robot-scoped IDs are always instantiated as `robot:<robotInstanceId>:<role>:<definitionLocalFrameId>`; reusable definition-local IDs never enter the scene graph directly.
- Reparenting preserves the selected frame's world pose by computing `inverse(T_world_newParent) * T_world_frame`.
- Preview is memory-only; Apply is one validated persistent transaction; Cancel restores the last committed pose and parent.
- Joint, link, and flange frames are derived/read-only. MCP, Robot Base, TCP, fixture, workobject, workpiece, equipment, sensor, camera, moving, and custom frames are editable only when `source === 'manual'` and `editable === true`.
- A TCP has one owner only: its manual FrameNode is persisted under an allowlisted same-robot derived flange ID, while a pure pre-render adapter derives joint/link/flange frames and never creates a duplicate TCP. Persisted rows may be validated as an incomplete storage projection; the merged runtime graph must contain every parent before it is exposed or edited.
- Robot Base edits move the mechanism, gripper, collision sensors, grasp sensor, and held object together without changing joint values.
- Preserve the current CRB15000 mount at world `[0, 0, 1.08]`, its zero-pose link transforms, `toolRotationYRad`, deterministic Cup 01 pick fixture, Rapier collision behavior, gripper behavior, and current keyframe angles.
- Use exact built-in RobotInstance ID `crb15000-01` and owner ID `robot:crb15000-01` in every persisted/derived frame and active-TCP adapter.
- Existing equipment rows must reopen at the same world position, orientation, and scale after migration; a corrupt row is isolated and cannot prevent valid rows or frames from hydrating.
- Equipment scale remains an equipment-asset property; frame poses never contain scale. Three.js objects, matrices, and refs never enter Zustand persistence or Dexie records.
- Held equipment is temporarily rendered under the tool frame, but its committed equipment frame is updated exactly once on release; reparenting or editing a held item is blocked with a clear error.
- This plan does not add generic robot import, mechanical overrides, OPC UA, inverse kinematics, Cartesian robot jogging, pose-sequence velocity semantics, PLC writes, PLC transfer, or controller deployment.
- Do not modify, build, deploy, restart, transfer to, or write variables on the adjacent Automation Studio project or any PLC.
- Use TDD for every domain/store behavior. Use Playwright for real WebGL transform controls, IndexedDB reopen, Rapier alignment, grasp/release, keyboard focus, and responsive acceptance.
- Every implementation task ends with its targeted tests, `git diff --check`, and one focused commit. After every shown `git add`, run `git diff --cached --check` and stop before commit on any nonzero exit so new files are covered. Do not combine the Luna documentation commit with Terra implementation commits.

---

## Locked File Map

```text
docs/
  operator/frame-coordinates.md                         # Luna operator workflow and terminology
  developer/frame-graph.md                             # Luna API, migration, invariants, and extension guide
  verification/frame-graph-verification.md             # Luna command/evidence record
e2e/
  frame-coordinates.spec.ts                            # real browser edit/reparent/reload/robot-base acceptance
src/
  app/
    App.tsx                                             # hydrate frames, compose tree/inspector, route frame actions
    AppShell.test.tsx                                   # shell integration and accessible frame UI checks
  domain/
    equipment/
      equipment.ts                                      # replace embedded transform with frameId + asset scale
      equipment.test.ts                                 # v2 equipment validation
    frames/
      pose3d.ts                                         # canonical pose validation and transform math
      pose3d.test.ts                                    # composition/inverse/relative/Euler tests
      frame-graph.ts                                    # graph validation, resolution, reparent, delete policies
      frame-graph.test.ts                               # cycle/missing/duplicate/reparent/delete tests
      frame-types.ts                                    # FrameRole, FrameNode, edit command types and IDs
  features/
    equipment/
      equipment-db.ts                                   # Dexie v2 frames table and v1 equipment migration
      equipment-db.test.ts                              # idempotent reopen/migration/rollback tests
      equipment-store.ts                                # records without poses; atomic equipment+frame lifecycle
      equipment-store.test.ts                           # seed/import/delete/corrupt/memory-only frame coupling
      EquipmentScene.tsx                                # render equipment from resolved frame world poses
      EquipmentScene.test.tsx                           # resolver and selection rendering integration
    frames/
      built-in-frames.ts                                # World/MCP/CRB Base/default TCP seed definitions
      frame-store.ts                                    # committed/manual/runtime/preview state and persistence
      frame-store.test.ts                               # StrictMode-safe hydration, preview/apply/cancel/reparent
      persisted-frame-validation.ts                    # validate allowlisted derived-parent references at rest
      persisted-frame-validation.test.ts               # reject arbitrary missing/cross-owner parents
      robot-frame-adapter.ts                            # synchronously derive namespaced joint/link/flange nodes
      robot-frame-adapter.test.ts                       # FK pose and no-TCP ownership tests
      scene-frame-graph.ts                              # merge persisted, equipment, and derived/runtime nodes
      scene-frame-graph.test.ts                         # complete scene graph and pose parity tests
      FrameAxisGizmos.tsx                               # axes and TransformControls runtime adapter
      FrameAxisGizmos.test.tsx                          # gizmo preview/apply/cancel/drag tests
      FrameTree.tsx                                     # accessible expandable Frames/Robots/Equipment tree
      FrameTree.test.tsx                                # roles, source, visibility, selection, keyboard tests
      FrameInspector.tsx                                # reference-aware numeric draft and reparent controls
      FrameInspector.test.tsx                           # units, validation, apply/cancel, focus, announcements
      frame-edit-controller.ts                          # route manual/equipment edits and block held/derived edits
      frame-edit-controller.test.ts                     # atomic routing and no-mutation failures
    import/
      ImportStepDialog.tsx                              # create v2 equipment record + initial world frame
      ImportStepDialog.test.tsx                         # imported equipment placement contract
      imported-equipment-actions.ts                     # delete frame and record atomically after held release
      imported-equipment-actions.test.ts                # deletion ordering and frame cleanup
    interaction/
      CollisionSystem.tsx                               # consume graph-resolved equipment/robot world objects
      EquipmentTransformControls.tsx                    # remove superseded equipment-only gizmo implementation
      EquipmentTransformControls.test.tsx               # remove superseded component tests
      GraspController.tsx                               # graph-aware world/local grip and release integration
      grasp-actions.ts                                  # release world pose -> equipment-parent local pose
      grasp-actions.test.ts                             # release/reparent preservation and one commit
      interaction-math.ts                               # reuse Pose3D adapters for grip math
      interaction-math.test.ts                          # parity with existing grasp/collision fixtures
      interaction-store.ts                              # add frame selection and frame-axis visibility only
      interaction-store.test.ts                         # single selection owner and visibility semantics
    robot/
      RobotModel.tsx                                    # mount rig at Robot Base and bind objects to pre-derived frame IDs
      RobotModel.test.ts                                # link/tool parity and derived registration
      RobotGripper.tsx                                  # unchanged geometry, active TCP parent adapter
    scene/
      Workcell.tsx                                      # replace fixed robot mount with MCP/Base frame groups
      SceneCanvas.tsx                                   # connect runtime frame registration and transform drag state
      workcell-constants.ts                             # retain 1.08 m mount constant for migration parity
    ui/
      InspectorPanel.tsx                                # extend Task 10 routing without replacing equipment controls
      InspectorPanel.test.tsx                           # contextual inspector routing
      EquipmentInspector.tsx                            # retain status/graspable/light/scale and add Transform surface
  test/
    debug-bridge.ts                                     # extend Task 11 read-only frame/TCP snapshot
    debug-bridge.test.ts                                # production guard and plain-JSON fields
  state/
    event-store.ts                                      # timestamp frame apply/reparent/persistence warnings
  styles/
    global.css                                          # frame tree, inspector, units, gizmo toolbar, narrow drawer styles
```

`EquipmentTransformControls.tsx` and its test are deleted only after `FrameAxisGizmos.tsx` passes the equivalent preview/commit/orbit-control tests. No other files are renamed in this subsystem.

---

### Task 1: Establish Canonical Pose3D Math

**Files:**
- Create: `src/domain/frames/pose3d.ts`
- Create: `src/domain/frames/pose3d.test.ts`

**Interfaces:**
- Consumes: Three.js `Matrix4`, `Quaternion`, `Euler`, and `Vector3` only as local calculation helpers.
- Produces: `Pose3D`, `IDENTITY_POSE`, `normalizePose3D`, `composePose3D`, `invertPose3D`, `relativePose3D`, `pose3DToMatrix4`, `matrix4ToPose3D`, `rpyToQuaternion`, `quaternionToRpy`, and `pose3DApproximatelyEquals` for every later task.

- [ ] **Step 1: Write failing validation and composition tests**

Create `src/domain/frames/pose3d.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import {
  composePose3D,
  IDENTITY_POSE,
  invertPose3D,
  normalizePose3D,
  pose3DApproximatelyEquals,
  quaternionToRpy,
  relativePose3D,
  rpyToQuaternion,
  type Pose3D,
} from './pose3d'

const PARENT: Pose3D = {
  position: [1, 2, 3],
  quaternion: [0, 0, Math.SQRT1_2, Math.SQRT1_2],
}

const CHILD: Pose3D = {
  position: [0.25, 0, 0.5],
  quaternion: [0, 0, 0, 1],
}

describe('Pose3D', () => {
  it('normalizes quaternions without mutating caller tuples', () => {
    const source: Pose3D = {
      position: [1, 2, 3],
      quaternion: [0, 0, 0, 2],
    }
    const normalized = normalizePose3D(source)
    expect(normalized).toEqual({
      position: [1, 2, 3],
      quaternion: [0, 0, 0, 1],
    })
    expect(normalized.position).not.toBe(source.position)
    expect(normalized.quaternion).not.toBe(source.quaternion)
  })

  it.each([
    { position: [Number.NaN, 0, 0], quaternion: [0, 0, 0, 1] },
    { position: [0, 0, 0], quaternion: [0, 0, 0, 0] },
    { position: [0, 0, 0], quaternion: [0, Infinity, 0, 1] },
  ])('rejects an invalid transform before matrix math', (pose) => {
    expect(() => normalizePose3D(pose as Pose3D)).toThrow(/finite|quaternion/i)
  })

  it('composes parent and child, then recovers each relative transform', () => {
    const world = composePose3D(PARENT, CHILD)
    expect(world.position[0]).toBeCloseTo(1)
    expect(world.position[1]).toBeCloseTo(2.25)
    expect(world.position[2]).toBeCloseTo(3.5)
    expect(pose3DApproximatelyEquals(relativePose3D(PARENT, world), CHILD)).toBe(true)
    expect(
      pose3DApproximatelyEquals(
        composePose3D(world, invertPose3D(world)),
        IDENTITY_POSE,
      ),
    ).toBe(true)
  })

  it('matches the non-commuting qz * qy * qx quaternion and round-trips RPY', () => {
    const input = [0.2, -0.35, 0.8] as const
    const quaternion = rpyToQuaternion(input)
    const [roll, pitch, yaw] = input
    const [sr, cr] = [Math.sin(roll / 2), Math.cos(roll / 2)]
    const [sp, cp] = [Math.sin(pitch / 2), Math.cos(pitch / 2)]
    const [sy, cy] = [Math.sin(yaw / 2), Math.cos(yaw / 2)]
    const expected = [
      sr * cp * cy - cr * sp * sy,
      cr * sp * cy + sr * cp * sy,
      cr * cp * sy - sr * sp * cy,
      cr * cp * cy + sr * sp * sy,
    ]
    quaternion.forEach((entry, index) => {
      expect(entry).toBeCloseTo(expected[index]!, 12)
    })
    const output = quaternionToRpy(quaternion)
    expect(output[0]).toBeCloseTo(input[0], 10)
    expect(output[1]).toBeCloseTo(input[1], 10)
    expect(output[2]).toBeCloseTo(input[2], 10)
  })
})
```

- [ ] **Step 2: Run the focused test to prove RED**

Run:

```powershell
npm run test:run -- src/domain/frames/pose3d.test.ts
```

Expected: FAIL because `./pose3d` cannot be resolved.

- [ ] **Step 3: Implement the complete canonical pose module**

Create `src/domain/frames/pose3d.ts`:

```ts
import { Euler, Matrix4, Quaternion, Vector3 } from 'three'

export type Position3 = readonly [number, number, number]
export type Quaternion4 = readonly [number, number, number, number]
export type RollPitchYaw = readonly [number, number, number]

export interface Pose3D {
  readonly position: Position3
  readonly quaternion: Quaternion4
}

export const IDENTITY_POSE: Pose3D = {
  position: [0, 0, 0],
  quaternion: [0, 0, 0, 1],
}

const QUATERNION_EPSILON = 1e-12

function finiteTuple(value: readonly number[], length: number): boolean {
  return value.length === length && value.every(Number.isFinite)
}

export function normalizePose3D(pose: Pose3D): Pose3D {
  if (!finiteTuple(pose.position, 3) || !finiteTuple(pose.quaternion, 4)) {
    throw new Error('Pose3D position and quaternion must contain finite numbers')
  }
  const quaternion = new Quaternion(...pose.quaternion)
  if (quaternion.lengthSq() <= QUATERNION_EPSILON) {
    throw new Error('Pose3D quaternion must be normalizable')
  }
  quaternion.normalize()
  return {
    position: [...pose.position],
    quaternion: quaternion.toArray(),
  }
}

export function pose3DToMatrix4(pose: Pose3D): Matrix4 {
  const normalized = normalizePose3D(pose)
  return new Matrix4().compose(
    new Vector3(...normalized.position),
    new Quaternion(...normalized.quaternion),
    new Vector3(1, 1, 1),
  )
}

export function matrix4ToPose3D(matrix: Matrix4): Pose3D {
  const position = new Vector3()
  const quaternion = new Quaternion()
  const scale = new Vector3()
  matrix.decompose(position, quaternion, scale)
  if (![scale.x, scale.y, scale.z].every((entry) => Math.abs(entry - 1) < 1e-9)) {
    throw new Error('Pose3D matrices cannot contain scale')
  }
  return normalizePose3D({
    position: position.toArray(),
    quaternion: quaternion.toArray(),
  })
}

export function composePose3D(parentWorld: Pose3D, local: Pose3D): Pose3D {
  return matrix4ToPose3D(
    pose3DToMatrix4(parentWorld).multiply(pose3DToMatrix4(local)),
  )
}

export function invertPose3D(pose: Pose3D): Pose3D {
  return matrix4ToPose3D(pose3DToMatrix4(pose).invert())
}

export function relativePose3D(referenceWorld: Pose3D, targetWorld: Pose3D): Pose3D {
  return composePose3D(invertPose3D(referenceWorld), targetWorld)
}

export function rpyToQuaternion([roll, pitch, yaw]: RollPitchYaw): Quaternion4 {
  if (![roll, pitch, yaw].every(Number.isFinite)) {
    throw new Error('Roll, pitch, and yaw must be finite radians')
  }
  return new Quaternion().setFromEuler(new Euler(roll, pitch, yaw, 'ZYX')).normalize().toArray()
}

export function quaternionToRpy(quaternion: Quaternion4): RollPitchYaw {
  const pose = normalizePose3D({ position: [0, 0, 0], quaternion })
  const euler = new Euler().setFromQuaternion(
    new Quaternion(...pose.quaternion),
    'ZYX',
  )
  return [euler.x, euler.y, euler.z]
}

export function pose3DApproximatelyEquals(
  first: Pose3D,
  second: Pose3D,
  epsilon = 1e-9,
): boolean {
  const firstMatrix = pose3DToMatrix4(first).elements
  const secondMatrix = pose3DToMatrix4(second).elements
  return firstMatrix.every(
    (entry, index) => Math.abs(entry - (secondMatrix[index] ?? Number.NaN)) <= epsilon,
  )
}
```

`Euler(..., 'ZYX')` in Three.js produces the required intrinsic Roll/Pitch/Yaw matrix equivalent to `qz(yaw) * qy(pitch) * qx(roll)`. The independent half-angle assertion uses non-commuting angles, so a matching but incorrect round-trip implementation cannot hide an order error.

- [ ] **Step 4: Run the focused test to prove GREEN**

Run:

```powershell
npm run test:run -- src/domain/frames/pose3d.test.ts
npm run lint -- src/domain/frames/pose3d.ts src/domain/frames/pose3d.test.ts
git diff --check
```

Expected: 4 tests PASS, Oxlint exits 0, and `git diff --check` prints nothing.

- [ ] **Step 5: Commit the pose boundary**

```powershell
git add src/domain/frames/pose3d.ts src/domain/frames/pose3d.test.ts
git diff --cached --check
git commit -m "feat: add canonical frame pose math"
```

Expected: one focused commit containing only Pose3D math and its tests.

---

### Task 2: Validate, Resolve, Reparent, and Delete Frame Graphs

**Files:**
- Create: `src/domain/frames/frame-types.ts`
- Create: `src/domain/frames/frame-graph.ts`
- Create: `src/domain/frames/frame-graph.test.ts`

**Interfaces:**
- Consumes: `Pose3D`, `IDENTITY_POSE`, `composePose3D`, `relativePose3D`.
- Produces: `FrameRole`, `FrameNode`, `validateFrameGraph`, `resolveWorldPose`, `reparentFramePreservingWorld`, and `deleteFrameSubtree`.

- [ ] **Step 1: Write graph-invariant and preserve-world RED tests**

```ts
const WORLD: FrameNode = {
  id: 'world', name: 'World', role: 'world', parentId: null,
  localPose: IDENTITY_POSE, ownerEntityId: null, source: 'manual', editable: false,
}
const MCP: FrameNode = {
  id: 'mcp-1', name: 'MCP 1', role: 'machine', parentId: 'world',
  localPose: { position: [1, 0, 0], quaternion: [0, 0, 0, 1] },
  ownerEntityId: null, source: 'manual', editable: true,
}
const EQUIPMENT: FrameNode = {
  id: 'equipment:cup-01', name: 'Cup 01', role: 'equipment', parentId: 'mcp-1',
  localPose: { position: [0.75, 0, 1.15], quaternion: [0, 0, 0, 1] },
  ownerEntityId: 'cup-01', source: 'manual', editable: true,
}

it('rejects a cycle, duplicate id, missing parent, and second world root', () => {
  expect(() => validateFrameGraph([WORLD, { ...MCP, parentId: 'mcp-1' }])).toThrow(/cycle/i)
  expect(() => validateFrameGraph([WORLD, WORLD])).toThrow(/duplicate/i)
  expect(() => validateFrameGraph([WORLD, { ...MCP, parentId: 'missing' }])).toThrow(/parent/i)
  expect(() => validateFrameGraph([WORLD, { ...WORLD, id: 'world-2' }])).toThrow(/one world/i)
})

it('reparents while preserving the exact world pose', () => {
  const fixture = { ...MCP, id: 'fixture-1', role: 'fixture' as const, localPose: { position: [-2, 1, 0], quaternion: [0, 0, 0, 1] } }
  const before = resolveWorldPose([WORLD, MCP, fixture, EQUIPMENT], EQUIPMENT.id)
  const frames = reparentFramePreservingWorld([WORLD, MCP, fixture, EQUIPMENT], EQUIPMENT.id, fixture.id)
  expect(pose3DApproximatelyEquals(resolveWorldPose(frames, EQUIPMENT.id), before)).toBe(true)
})
```

- [ ] **Step 2: Run RED**

Run: `npm run test:run -- src/domain/frames/frame-graph.test.ts`

Expected: FAIL because the frame graph modules do not exist.

- [ ] **Step 3: Implement immutable graph operations**

```ts
export type FrameRole = 'world' | 'machine' | 'robot-base' | 'joint' | 'link' |
  'flange' | 'tcp' | 'fixture' | 'workobject-user' | 'workpiece' | 'equipment' |
  'sensor' | 'camera' | 'moving' | 'custom'

export interface FrameNode {
  readonly id: string
  readonly name: string
  readonly role: FrameRole
  readonly parentId: string | null
  readonly localPose: Pose3D
  readonly ownerEntityId: string | null
  readonly source: 'manual' | 'derived' | 'runtime'
  readonly editable: boolean
}

export function resolveWorldPose(frames: readonly FrameNode[], id: string): Pose3D {
  const byId = validateFrameGraph(frames)
  const chain: FrameNode[] = []
  let current: FrameNode | undefined = byId.get(id)
  if (current === undefined) throw new Error(`Unknown frame: ${id}`)
  while (current !== undefined) {
    chain.push(current)
    current = current.parentId === null ? undefined : byId.get(current.parentId)
  }
  return chain.reverse().reduce((world, frame) => composePose3D(world, frame.localPose), IDENTITY_POSE)
}

export function reparentFramePreservingWorld(
  frames: readonly FrameNode[], id: string, nextParentId: string,
): readonly FrameNode[] {
  const byId = validateFrameGraph(frames)
  const frame = byId.get(id)
  const parent = byId.get(nextParentId)
  if (frame === undefined || parent === undefined) throw new Error('Frame or parent does not exist')
  if (!frame.editable || frame.source !== 'manual' || frame.role === 'world') throw new Error('Frame is read-only')
  const world = resolveWorldPose(frames, id)
  const parentWorld = resolveWorldPose(frames, nextParentId)
  const next = frames.map((entry) => entry.id === id
    ? { ...entry, parentId: nextParentId, localPose: relativePose3D(parentWorld, world) }
    : entry)
  validateFrameGraph(next)
  return next
}
```

`validateFrameGraph()` normalizes every pose, requires exactly one immutable
`world` root, checks IDs and parent references, walks every parent chain with
white/gray/black visitation to reject cycles, and returns a new `Map`. Deletion
accepts only `subtree` or an explicit `{ childId, nextParentId }[]` reparent plan;
implicit orphaning throws.

- [ ] **Step 4: Run GREEN and commit**

Run each command separately and stop on the first nonzero exit:

1. `npm run test:run -- src/domain/frames`
2. `npm run lint`
3. `git diff --check`

Expected: all frame-domain tests PASS, lint exits 0, diff check is silent.

```powershell
git add src/domain/frames/frame-types.ts src/domain/frames/frame-graph.ts src/domain/frames/frame-graph.test.ts
git diff --cached --check
git commit -m "feat: add validated scene frame graph"
```

---

### Task 3: Persist Frames and Migrate Existing Equipment Without a Jump

**Files:**
- Create: `src/features/frames/built-in-frames.ts`
- Create: `src/features/frames/frame-store.ts`
- Create: `src/features/frames/frame-store.test.ts`
- Create: `src/features/frames/persisted-frame-validation.ts`
- Create: `src/features/frames/persisted-frame-validation.test.ts`
- Modify: `src/features/equipment/equipment-db.ts`
- Create: `src/features/equipment/equipment-db.test.ts`
- Modify: `src/domain/equipment/equipment.ts`
- Modify: `src/domain/equipment/equipment.test.ts`
- Modify: `src/features/equipment/equipment-store.ts`
- Modify: `src/features/equipment/equipment-store.test.ts`

**Interfaces:**
- Consumes: validated `FrameNode` records and current v1 equipment transforms.
- Produces: Dexie v2 `frames` table, `WORLD_FRAME_ID`,
  `DEFAULT_MCP_FRAME_ID`, `CRB_BASE_FRAME_ID`, globally namespaced CRB
  flange/TCP IDs, persisted-projection validation, `useFrameStore`, and an
  injected `FramePreviewCleanupService` for later source/playback/lifecycle
  transitions.

- [ ] **Step 1: Write migration, hydration, and atomic-lifecycle RED tests**

```ts
it('migrates a v1 equipment transform to a v2 frame and preserves world pose across reopen', async () => {
  const v1 = await openVersion1Fixture('frame-migration')
  await v1.equipment.put(legacyCupAt([0.75, 0, 1.15]))
  v1.close()
  const v2 = new EquipmentDatabase('frame-migration')
  await v2.open()
  expect(await v2.frames.get('equipment:cup-01')).toMatchObject({
    parentId: 'mcp:default', localPose: { position: [0.75, 0, 1.15] },
  })
  expect((await v2.equipment.get('cup-01'))?.frameId).toBe('equipment:cup-01')
})

it('hydrates once under StrictMode and isolates one corrupt frame row', async () => {
  await db.frames.bulkPut([validFrame, corruptFrame as never])
  await Promise.all([store.getState().hydrate(), store.getState().hydrate()])
  expect(store.getState().frames.some(({ id }) => id === validFrame.id)).toBe(true)
  expect(store.getState().warnings).toContain(FRAME_CORRUPT_ROW_WARNING)
})

it('applies one preview and one transactional equipment+frame commit', async () => {
  store.getState().previewFrame('equipment:cup-01', movedPose, 'test:equipment-apply')
  await store.getState().applyFrame('equipment:cup-01', 'test:equipment-apply')
  expect(framePut).toHaveBeenCalledOnce()
  expect(equipmentPut).not.toHaveBeenCalled()
})

it('retains one manual TCP with an allowlisted same-owner derived flange parent', async () => {
  await db.frames.put(crbTcpFrame({ parentId: 'robot:crb15000-01:flange:tool0' }))
  await store.getState().hydrate()
  expect(store.getState().frames.filter(({ role }) => role === 'tcp')).toHaveLength(1)
  expect(store.getState().warnings).not.toContain(FRAME_CORRUPT_ROW_WARNING)
})

it.each([
  'missing:arbitrary',
  'robot:another-instance:flange:tool0',
])('rejects an unowned deferred parent %s', async (parentId) => {
  await db.frames.put(crbTcpFrame({ parentId }))
  await store.getState().hydrate()
  expect(store.getState().frames.some(({ role }) => role === 'tcp')).toBe(false)
})

it('creates two MCPs and TCPs, activates one TCP, then reloads all choices', async () => {
  const mcp2 = await store.getState().createManualFrame(machineFrameDraft('MCP 2'))
  const tcp1 = await store.getState().createManualFrame(tcpDraft('crb15000-01', 'TCP 1'))
  const tcp2 = await store.getState().createManualFrame(tcpDraft('crb15000-01', 'TCP 2'))
  await store.getState().setActiveTcp('robot:crb15000-01', tcp2)
  await reopenStore()
  expect(store.getState().frames.map(({ id }) => id)).toEqual(expect.arrayContaining([mcp2, tcp1, tcp2]))
  expect(store.getState().activeTcpByRobotOwnerId['robot:crb15000-01']).toBe(tcp2)
})

it('persists a tool-mounted sensor as a manual child of its persisted TCP', async () => {
  const tcp = await store.getState().createManualFrame(tcpDraft('crb15000-01', 'Vision TCP'))
  const sensor = await store.getState().createManualFrame(sensorDraft('Camera 1', tcp))
  await reopenStore()
  expect(store.getState().frames.find(({ id }) => id === sensor)).toMatchObject({
    role: 'sensor', parentId: tcp, source: 'manual', editable: true,
  })
})

it('rejects subtree deletion across an entity lifecycle root', async () => {
  const fixture = await store.getState().createManualFrame(fixtureDraft('Fixture 01'))
  await store.getState().reparentFrame('equipment:cup-01', fixture)
  const framesBefore = await db.frames.toArray()
  const equipmentBefore = await db.equipment.toArray()
  await expect(store.getState().deleteFrame(fixture, {
    childDisposition: { mode: 'delete-subtree' },
    replacementActiveTcpFrameId: null,
  })).rejects.toThrow(/equipment.*lifecycle/i)
  expect(await db.frames.toArray()).toEqual(framesBefore)
  expect(await db.equipment.toArray()).toEqual(equipmentBefore)
})

it('persists one monotonic transform revision and emits typed commit events', async () => {
  const id = await store.getState().createManualFrame(tcpDraft('crb15000-01', 'Revision TCP'))
  expect(store.getState().getCommittedFrameRecord(id)?.revision).toBe(1)
  const commits: FrameCommitEvent[] = []
  const unsubscribe = store.getState().subscribeCommittedFrames((event) => commits.push(event))
  store.getState().previewFrame(id, poseAt(0, 0, 0.2), 'test:revision')
  await store.getState().applyFrame(id, 'test:revision')
  store.getState().previewFrame(id, poseAt(0, 0, 0.3), 'test:revision')
  store.getState().cancelFrame(id, 'test:revision')
  await store.getState().renameFrame(id, 'Renamed TCP')
  store.getState().registerRuntimeFrames('robot:crb15000-01', [derivedFlangeFrame('tool1')])
  await store.getState().reparentFrame(id, 'robot:crb15000-01:flange:tool1')
  unsubscribe()
  expect(commits.map(({ kind, revision }) => [kind, revision])).toEqual([
    ['local-pose', 2], ['parent', 3],
  ])
  await reopenStore()
  expect(store.getState().getCommittedFrameRecord(id)).toMatchObject({
    id, name: 'Renamed TCP', revision: 3,
  })
})

it('commits parent and local pose together or rolls both back', async () => {
  const parentId = await store.getState().createManualFrame(machineFrameDraft('MCP Secondary'))
  const id = await store.getState().createManualFrame(fixtureDraft('Fixture 02'))
  const before = store.getState().getCommittedFrameRecord(id)!
  framePut.mockClear()
  await store.getState().commitFrameEdit(id, {
    parentId,
    localPose: poseAt(0.2, 0.1, 0),
    expectedRevision: before.revision,
  })
  expect(framePut).toHaveBeenCalledOnce()
  expect(store.getState().getCommittedFrameRecord(id)).toMatchObject({
    parentId, localPose: poseAt(0.2, 0.1, 0), revision: before.revision + 1,
  })

  const committed = store.getState().getCommittedFrameRecord(id)!
  db.failNextTransaction(new Error('disk full'))
  await expect(store.getState().commitFrameEdit(id, {
    parentId: 'mcp:default',
    localPose: poseAt(0.4, 0, 0),
    expectedRevision: committed.revision,
  })).rejects.toThrow('disk full')
  expect(store.getState().getCommittedFrameRecord(id)).toEqual(committed)
})

it('rejects applying another preview owner without changing DB or revision', async () => {
  const id = await store.getState().createManualFrame(fixtureDraft('Owned preview'))
  const before = store.getState().getCommittedFrameRecord(id)!
  store.getState().previewFrame(id, poseAt(0.2, 0, 0), 'frame-inspector:owner-a')
  await expect(store.getState().applyFrame(id, 'mechanical:robot-a:draft-b'))
    .rejects.toThrow(/preview.*owner/i)
  expect(store.getState().getCommittedFrameRecord(id)).toEqual(before)
  expect(store.getState().previews[id]?.ownerToken).toBe('frame-inspector:owner-a')
})
```

- [ ] **Step 2: Run RED**

Run: `npm run test:run -- src/features/frames src/features/equipment/equipment-db.test.ts src/features/equipment/equipment-store.test.ts`

Expected: FAIL because schema v2, frame store, and equipment `frameId` do not exist.

- [ ] **Step 3: Add equipment v2 and Dexie migration**

```ts
// Rename the current pre-migration interface before introducing v2.
export type EquipmentRecordV1 = EquipmentRecord

export interface EquipmentRecordV2 extends Omit<EquipmentRecordV1, 'transform'> {
  readonly schemaVersion: 2
  readonly frameId: string
  readonly assetScale: readonly [number, number, number]
}

export interface PersistedFrameRecord extends FrameNode {
  readonly revision: number
  readonly updatedAtMs: number
}
```

Add `frames!: Table<PersistedFrameRecord, string>` and:

```ts
this.version(2).stores({
  equipment: '&id, kind, status, name, frameId',
  scene: '&key',
  frames: '&id, parentId, role, ownerEntityId',
}).upgrade(async (transaction) => {
  const equipment = transaction.table('equipment')
  const frames = transaction.table('frames')
  for (const legacy of await equipment.toArray()) {
    const frameId = `equipment:${legacy.id}`
    await frames.put(toMigratedEquipmentFrame(legacy, frameId, Date.now()))
    await equipment.put(toEquipmentV2(legacy, frameId))
  }
})
```

`toMigratedEquipmentFrame()` copies position/quaternion, places the frame under
identity `mcp:default`, and moves legacy scale into `assetScale`. Validate before
each put. An exception aborts the whole Dexie upgrade.

- [ ] **Step 4: Implement single-flight committed/preview/runtime frame state**

```ts
export type CreatableManualFrameRole =
  | 'machine' | 'tcp' | 'fixture' | 'workobject-user' | 'workpiece'
  | 'sensor' | 'camera' | 'moving' | 'custom'

export interface ManualFrameDraft {
  readonly name: string
  readonly role: CreatableManualFrameRole
  readonly parentId: string
  readonly localPose: Pose3D
  readonly ownerEntityId: string | null
}

export interface FrameDeletePolicy {
  readonly childDisposition:
    | { readonly mode: 'delete-subtree' }
    | { readonly mode: 'reparent'; readonly assignments: readonly {
        readonly childId: string
        readonly nextParentId: string
      }[] }
  readonly replacementActiveTcpFrameId: string | null
}

export interface FrameCommitEvent {
  readonly frameId: string
  readonly kind: 'created' | 'local-pose' | 'parent' | 'deleted'
  readonly previousRevision: number | null
  readonly revision: number | null
}

export interface FramePreviewInvalidationEvent {
  readonly frameId: string
  readonly ownerToken: string
  readonly nextEpoch: number
  readonly reason: 'operator-cancel' | 'playback-start' | 'source-transition' | 'lifecycle-cleanup'
}

export interface FramePreviewCleanupService {
  cancelOwner(
    ownerToken: string,
    reason: Exclude<FramePreviewInvalidationEvent['reason'], 'operator-cancel'>,
  ): void
  cancelFrames(
    frameIds: readonly string[],
    reason: Exclude<FramePreviewInvalidationEvent['reason'], 'operator-cancel'>,
  ): void
}

export function createFramePreviewCleanupService(
  store: Pick<FrameStoreApi, 'getState' | 'setState'>,
): FramePreviewCleanupService

export interface PreparedPersistedFrameCommit {
  readonly record: PersistedFrameRecord
  readonly event: FrameCommitEvent | null
}

export function preparePersistedFrameCommit(
  current: PersistedFrameRecord,
  patch: Pick<FrameNode, 'parentId' | 'localPose' | 'name'>,
  updatedAtMs: number,
): PreparedPersistedFrameCommit

export interface FrameStoreState {
  readonly frames: readonly FrameNode[]
  readonly previews: Readonly<Record<string, {
    readonly ownerToken: string
    readonly localPose: Pose3D
  }>>
  readonly previewEpochByFrameId: Readonly<Record<string, number>>
  readonly runtimeFrames: readonly FrameNode[]
  readonly activeTcpByRobotOwnerId: Readonly<Record<string, string>>
  readonly status: 'idle' | 'loading' | 'persistent' | 'memory-only'
  readonly warnings: readonly string[]
  hydrate(): Promise<void>
  getCommittedFrameRecord(id: string): Readonly<PersistedFrameRecord> | undefined
  subscribeCommittedFrames(listener: (event: FrameCommitEvent) => void): () => void
  subscribePreviewInvalidations(listener: (event: FramePreviewInvalidationEvent) => void): () => void
  previewFrame(id: string, pose: Pose3D, ownerToken: string): void
  cancelFrame(id: string, ownerToken: string): void
  commitFrameEdit(id: string, patch: {
    readonly parentId: string
    readonly localPose: Pose3D
    readonly expectedRevision: number
    readonly expectedPreviewEpoch?: number
    readonly name?: string
  }): Promise<void>
  applyFrame(id: string, ownerToken: string): Promise<void>
  reparentFrame(id: string, parentId: string): Promise<void>
  createManualFrame(draft: ManualFrameDraft): Promise<string>
  renameFrame(id: string, name: string): Promise<void>
  deleteFrame(id: string, policy: FrameDeletePolicy): Promise<void>
  setActiveTcp(robotOwnerId: string, tcpFrameId: string): Promise<void>
  registerRuntimeFrames(ownerId: string, frames: readonly FrameNode[]): void
  unregisterRuntimeFrames(ownerId: string): void
}
```

Seed immutable World, identity MCP, CRB Base at `[0,0,1.08]`, and one manual
default TCP named `robot:crb15000-01:tcp:default` whose parent is
`robot:crb15000-01:flange:tool0`. Merge valid persisted manual/equipment frames
over seeds. Keep runtime Three-derived nodes in memory only. Preview records
survive a slow hydration by the same pending-preview merge pattern proven in
Task 9. Apply and reparent perform one Dexie transaction after validation.
Preview ownership is explicit: the first preview stores a non-empty owner token
(Frame Inspector session, gizmo session, equipment drag, or later Mechanical
draft); only that token may update or cancel it. A competing owner gets a
conflict without changing runtime state. Transition/lifecycle cleanup may use a
privileged owner-scoped cancellation service, but ordinary callers cannot clear
another editor's preview.
`createFramePreviewCleanupService()` is the sole privileged export. Inject it
only into source, playback, and entity-lifecycle composition roots; UI code gets
only ordinary owner-checked store actions. `cancelOwner()` and `cancelFrames()`
perform the same preview removal, committed-runtime republication, epoch
increment, and synchronous event publication as one atomic Zustand update.
Every frame also has an in-memory monotonic preview epoch. Any ordinary or
privileged cancellation removes the runtime preview, increments that frame's
epoch, republishes the committed runtime value, and synchronously emits one
`FramePreviewInvalidationEvent` naming the displaced owner. Frame Inspector and
the gizmo subscribe by owner token, close the matching React-local session,
restore all fields from the committed record, and disable Apply. A session
captures the epoch at begin; `commitFrameEdit()` rejects
`FRAME_PREVIEW_SESSION_INVALIDATED` when an optional `expectedPreviewEpoch`
does not equal the current epoch. Thus a missed UI callback or stale closure
cannot re-apply a draft after playback/source/lifecycle cleanup. Preview epochs
and listeners are runtime-only and are never written to Dexie.
`commitFrameEdit()` is the authoritative combined command: validate the
expected committed revision, target parent, cycle/owner rules, and normalized
pose, then write parent/local pose/optional name as one record in one Dexie
transaction. `applyFrame(id, ownerToken)` first verifies that token owns the
current preview; `reparentFrame()` is a no-preview compatibility wrapper that
constructs one combined patch. Neither runs sequential transactions or may
commit another editor's preview.
`PersistedFrameRecord.revision` is the committed transform/topology revision:
creation starts at 1; a normalized `localPose` change or `parentId` change
increments exactly once in the same transaction; a no-op Apply, preview,
Cancel, rename-only change, and active-TCP selection preserve it. Rename still
updates `updatedAtMs`. Hydration/reopen retains the exact revision. Mechanical
configuration Apply must use the same frame-store transaction helper when it
changes manual TCP/sensor/camera pose or parent, so it cannot bypass this rule.
Publish one `FrameCommitEvent` only after commit and never for preview/rollback.
`getCommittedFrameRecord()` returns a defensive read-only clone, and
`subscribeCommittedFrames()` is the typed API used by later playback snapshots;
consumers never infer a revision from `frames` array identity.
`preparePersistedFrameCommit()` is pure and does not start a nested Dexie
transaction: Frame Store Apply and the later Mechanical Apply call it for each
row inside their own caller-owned transaction, collect non-null events, publish
the new committed runtime, and dispatch those events only after that outer
transaction resolves. A failed outer transaction discards records/events.

`validatePersistedFrameRows()` treats storage as an incomplete projection: a
missing parent is accepted only when the child is a robot-scoped manual TCP,
the parent is an allowlisted derived flange ID for the same owner, and both IDs
match the namespace grammar. Any arbitrary or cross-owner missing parent is a
corrupt row. `createSceneFrameGraph()` later performs the strict complete graph
validation before the frame becomes visible/editable. There is never a second
runtime TCP node.

`createManualFrame()` supports machine/MCP, TCP, fixture, workobject, workpiece,
sensor, camera, moving, and custom roles and generates collision-safe IDs;
equipment and Robot Base creation remain coupled to their entity services.
Tool-mounted sensor/camera frames must parent an existing persisted manual TCP,
never a derived flange directly; machine-mounted sensor/camera frames parent a
persisted MCP/fixture/custom frame. Thus only the TCP row needs the allowlisted
same-owner deferred-flange exception, while its manual descendants hydrate as a
normal persisted chain.
Rename validates a trimmed unique sibling name. Delete requires explicit
subtree/reparent policy, refuses required seeds/derived frames, and refuses an
active TCP unless the same transaction selects a same-owner replacement.
Before deleting any subtree, resolve every descendant against an injected
entity-lifecycle-root index (equipment `frameId` now; later RobotInstance Base
and other entity roots). If any descendant is an entity root, reject before
mutation and identify the owning entity/lifecycle command. The frame-only API
never deletes an entity record or leaves one pointing at a missing frame;
equipment/robot lifecycle services perform their own cross-store transactional
cascade. Ordinary manual TCP/sensor/custom descendants are not entity roots and
remain eligible for the explicit subtree policy.
`setActiveTcp()` verifies role/owner/flange attachment and persists the current
CRB adapter mapping in the existing `scene` record; the Generic Robot plan
migrates this field into each `RobotInstanceV1`.

For a brand-new latest-version database, do not rely on a version-upgrade
callback: seed each built-in equipment v2 row and its matching equipment frame
with World/MCP/Base/manual-TCP plus the current active-TCP scene mapping in one
transaction. A reopen sees the rows and performs no second seed.

- [ ] **Step 5: Couple equipment create/delete atomically**

Equipment import creates its `EquipmentRecordV2` plus initial frame in one
transaction. Delete releases held state, locks re-grasp, deletes equipment and
frame together, invalidates cached geometry only after commit, and clears
selection/collision pairs. Built-in equipment Reset changes no persisted frame.

- [ ] **Step 6: Run GREEN and commit**

Run each command separately and stop on the first nonzero exit:

1. `npm run test:run -- src/domain/equipment src/features/frames src/features/equipment src/features/import/imported-equipment-actions.test.ts`
2. `npm run lint`
3. `git diff --check`

Expected: migration/reopen, corrupt isolation, deferred-parent ownership,
create/rename/delete/active-TCP reload, entity-root subtree rejection,
monotonic committed transform revision,
typed post-commit events, slow hydration, memory-only, import/delete rollback,
and one-commit preview tests all PASS.

```powershell
git add src/domain/equipment src/features/frames src/features/equipment src/features/import/ImportStepDialog.tsx src/features/import/ImportStepDialog.test.tsx src/features/import/imported-equipment-actions.ts src/features/import/imported-equipment-actions.test.ts
git diff --cached --check
git commit -m "feat: persist scene frames and equipment bindings"
```

---

### Task 4: Mount the Current CRB and Interaction Runtime Through the Graph

**Files:**
- Create: `src/features/frames/scene-frame-graph.ts`
- Create: `src/features/frames/scene-frame-graph.test.ts`
- Create: `src/features/frames/robot-frame-adapter.ts`
- Create: `src/features/frames/robot-frame-adapter.test.ts`
- Modify: `src/features/scene/Workcell.tsx`
- Modify: `src/features/scene/SceneCanvas.tsx`
- Modify: `src/features/robot/RobotModel.tsx`
- Modify: `src/features/robot/RobotModel.test.ts`
- Modify: `src/features/equipment/EquipmentScene.tsx`
- Create: `src/features/equipment/EquipmentScene.test.tsx`
- Modify: `src/features/interaction/CollisionSystem.tsx`
- Modify: `src/features/interaction/GraspController.tsx`
- Modify: `src/features/interaction/grasp-actions.ts`
- Modify: `src/features/interaction/grasp-actions.test.ts`

**Interfaces:**
- Consumes: committed+preview+runtime frame graph, current CRB rig/joints, and existing `RobotRigRegistration`.
- Produces: synchronous graph-resolved Three transforms and read-only namespaced joint/link/flange frames before React object registration.

- [ ] **Step 1: Write CRB/equipment/grasp parity RED tests**

```ts
it('keeps the current CRB zero-pose world matrices behind identity MCP', () => {
  const graph = createSceneFrameGraph(seedFrames(), equipmentFrames(), derivedZeroPoseFrames())
  expect(resolveWorldPose(graph, 'robot:crb15000-01:base').position).toEqual([0, 0, 1.08])
  expectMatrixClose(worldMatrixFor(graph, 'robot:crb15000-01:link:LINK06'), CURRENT_LINK06_WORLD)
})

it('moves robot, sensors, held item, and colliders together without changing joints', () => {
  const before = snapshotJointPositions()
  moveBaseFrame([0.2, -0.1, 1.08])
  expect(snapshotJointPositions()).toEqual(before)
  expectMatrixClose(relativeMatrix(toolWorld(), heldWorld()), savedGripOffset)
  expectMatrixClose(colliderWorld('LINK06'), linkWorld('LINK06'))
})

it('releases a held item into its equipment parent local frame with one commit', async () => {
  await releaseHeldEquipmentAtTool(toolWorld, workbenchTop, dependencies)
  expect(previewFrame).toHaveBeenCalledWith(
    'equipment:cup-01',
    relativePose3D(parentWorld, releasedWorld),
    expect.stringMatching(/^release:/),
  )
  expect(applyFrame).toHaveBeenCalledOnceWith(
    'equipment:cup-01',
    expect.stringMatching(/^release:/),
  )
})

it('materializes each robot-scoped frame ID once and never duplicates a persisted TCP', () => {
  const graph = createSceneFrameGraph(seedFrames(), equipmentFrames(), derivedZeroPoseFrames())
  expect(graph.filter(({ id }) => id === 'robot:crb15000-01:tcp:default')).toHaveLength(1)
  expect(derivedZeroPoseFrames().some(({ role }) => role === 'tcp')).toBe(false)
})
```

Define `expectMatrixClose(actual, expected, digits = 9)` in this test file by
comparing all 16 matrix elements with Vitest's built-in `toBeCloseTo`; do not
depend on an unregistered custom matcher.

- [ ] **Step 2: Run RED**

Run: `npm run test:run -- src/features/frames/scene-frame-graph.test.ts src/features/robot/RobotModel.test.ts src/features/equipment/EquipmentScene.test.tsx src/features/interaction/grasp-actions.test.ts`

Expected: FAIL because scene objects still use fixed mount and embedded transforms.

- [ ] **Step 3: Integrate graph-resolved runtime objects**

`deriveRobotFrameNodes(instanceId, rig, namedJointPositions)` is a pure adapter
that emits every namespaced joint/link/flange node synchronously from the same
FK matrices used for rendering and emits no TCP. Workcell calls it before
`createSceneFrameGraph()`, so strict `validateFrameGraph()` sees the persisted
manual TCP and its derived flange parent in the same render—there is no
effect-order hydration gap. Workcell renders nested MCP/Base groups from
resolved local poses. RobotModel binds Three object refs to the already-derived
frame IDs for collision/debug registration and unregisters only those refs on
cleanup; it never owns or registers a TCP FrameNode. EquipmentScene resolves
frame world pose relative to its rendered parent and applies `assetScale`
separately.

Use one helper at every runtime boundary:

```ts
export function applyPose3D(object: Object3D, pose: Pose3D): void {
  object.position.fromArray(pose.position)
  object.quaternion.fromArray(pose.quaternion).normalize()
  object.updateMatrix()
}
```

CollisionSystem continues reading registered scene objects; moving MCP/Base
therefore moves visual and sensor sources together. GraspController computes
grip/release in world space and converts release through the equipment frame's
current parent. Keep the Task 9 held-object registry, removal lock, local-Z
sensor, colliderCenter ranking, pair cleanup, and outline precedence unchanged.

- [ ] **Step 4: Extend the one selection owner**

Add `{ kind: 'frame'; frameId: string }` to `SceneSelection`. Hiding a frame
hides its visual descendants but does not delete them. Selecting a derived frame
shows read-only values. Deleting/reparenting a held equipment frame returns an
operator-visible error without mutation.

- [ ] **Step 5: Run GREEN and commit**

Run each command separately and stop on the first nonzero exit:

1. `npm run test:run -- src/features/frames src/features/robot src/features/equipment src/features/interaction`
2. `npm run cad:validate`
3. `npm run build`
4. `git diff --check`

Expected: all tests PASS; CAD 7/7, 0 errors, 0 warnings; build PASS; current
deterministic Cup 01 pick and collision fixture remain valid.

```powershell
git add src/features/frames/scene-frame-graph.ts src/features/frames/scene-frame-graph.test.ts src/features/frames/robot-frame-adapter.ts src/features/frames/robot-frame-adapter.test.ts src/features/scene src/features/robot src/features/equipment/EquipmentScene.tsx src/features/equipment/EquipmentScene.test.tsx src/features/interaction src/features/interaction/interaction-store.ts src/features/interaction/interaction-store.test.ts
git diff --cached --check
git commit -m "feat: resolve workcell transforms through frames"
```

---

### Task 5: Build the Frame Tree, Numeric Inspector, and Unified Gizmos

**Files:**
- Create: `src/features/frames/frame-edit-controller.ts`
- Create: `src/features/frames/frame-edit-controller.test.ts`
- Create: `src/features/frames/FrameAxisGizmos.tsx`
- Create: `src/features/frames/FrameAxisGizmos.test.tsx`
- Create: `src/features/frames/FrameTree.tsx`
- Create: `src/features/frames/FrameTree.test.tsx`
- Create: `src/features/frames/FrameInspector.tsx`
- Create: `src/features/frames/FrameInspector.test.tsx`
- Modify: `src/features/ui/InspectorPanel.tsx`
- Create: `src/features/ui/InspectorPanel.test.tsx`
- Modify: `src/features/ui/EquipmentInspector.tsx`
- Modify: `src/app/App.tsx`
- Modify: `src/app/AppShell.test.tsx`
- Modify: `src/styles/global.css`
- Delete after replacement passes: `src/features/interaction/EquipmentTransformControls.tsx`
- Delete after replacement passes: `src/features/interaction/EquipmentTransformControls.test.tsx`

**Interfaces:**
- Consumes: `FrameStoreState`, scene selection, runtime object registry.
- Produces: one accessible frame editing surface for MCP, Robot Base, TCP, fixtures, equipment, sensors, and custom frames.

- [ ] **Step 1: Write controller and UI RED tests**

```tsx
it('edits in MCP reference, previews in memory, applies once, and cancels drafts', async () => {
  render(<FrameInspector frameId="equipment:cup-01" />)
  await user.selectOptions(screen.getByLabelText('Reference frame'), 'mcp:default')
  await user.clear(screen.getByLabelText('X (mm)'))
  await user.type(screen.getByLabelText('X (mm)'), '800')
  expect(previewFrame).toHaveBeenCalled()
  await user.click(screen.getByRole('button', { name: 'Apply frame' }))
  expect(commitFrameEdit).toHaveBeenCalledWith('equipment:cup-01', expect.objectContaining({
    parentId: expect.any(String),
    localPose: expect.any(Object),
    expectedRevision: expect.any(Number),
    expectedPreviewEpoch: expect.any(Number),
  }))
})

it('resets a local draft and rejects its stale Apply after privileged cleanup', async () => {
  const controller = createFrameEditController(frameStore)
  const previewSpy = vi.spyOn(controller, 'preview')
  render(<FrameInspector
    frameId="robot:crb15000-01:tcp:default"
    controller={controller}
  />)
  await user.clear(screen.getByLabelText('Z (mm)'))
  await user.type(screen.getByLabelText('Z (mm)'), '400')
  const staleDraft = previewSpy.mock.results.at(-1)!.value
  expect(screen.getByLabelText('Z (mm)')).toHaveValue('400')

  act(() => privilegedPreviewCleanup.cancelOwner(
    staleDraft.ownerToken,
    'playback-start',
  ))

  expect(screen.getByLabelText('Z (mm)')).toHaveValue(committedTcpZMm)
  expect(screen.getByRole('button', { name: 'Apply frame' })).toBeDisabled()
  await expect(controller.apply(staleDraft)).rejects.toMatchObject({
    code: 'FRAME_PREVIEW_SESSION_INVALIDATED',
  })
  expect(readCommittedTcp()).toEqual(committedTcp)
})

it('reorders focus-safe tree selection and exposes derived frames read-only', async () => {
  render(<FrameTree />)
  await user.click(screen.getByRole('treeitem', { name: /LINK06/ }))
  expect(screen.getByLabelText('X (mm)')).toBeDisabled()
  expect(screen.getByText('Derived')).toBeVisible()
})

it('adds and renames an MCP, creates two TCPs, and activates the second TCP', async () => {
  render(<FrameTree />)
  await user.click(screen.getByRole('button', { name: 'Add frame' }))
  await chooseFrameRoleAndSubmit(user, 'Machine / MCP', 'MCP 2')
  await createTcpThroughUi(user, 'TCP 1')
  await createTcpThroughUi(user, 'TCP 2')
  await user.selectOptions(screen.getByLabelText('Active TCP'), 'TCP 2')
  expect(setActiveTcp).toHaveBeenCalledWith('robot:crb15000-01', expect.stringMatching(/:tcp:/))
})

it('requires an explicit child policy and replacement before deleting a parent or active TCP', async () => {
  render(<FrameTree />)
  await user.click(screen.getByRole('button', { name: 'Add frame' }))
  await chooseFrameRoleAndSubmit(user, 'Fixture', 'Fixture 01')
  expect(createManualFrame).toHaveBeenCalledWith(expect.objectContaining({ name: 'Fixture 01' }))
  await selectAndDelete(user, 'Fixture 01')
  expect(screen.getByRole('dialog', { name: 'Delete frame' })).toHaveTextContent(/reparent|subtree/i)
  await selectAndDelete(user, 'TCP 2')
  expect(screen.getByLabelText('Replacement TCP')).toBeRequired()
})

it('keeps every Task 10 equipment control while adding its frame transform surface', async () => {
  render(<InspectorPanel selection={{ kind: 'equipment', equipmentId: 'machine-01' }} />)
  expect(screen.getByLabelText('Equipment status')).toBeEnabled()
  expect(screen.getByLabelText('Graspable')).toBeEnabled()
  expect(screen.getByText('Stack light')).toBeVisible()
  expect(screen.getByLabelText('Asset scale X')).toBeEnabled()
  expect(screen.getByRole('tab', { name: 'Transform' })).toBeVisible()
})

it('keeps gizmo mouse-up as a cancellable preview until explicit Apply', async () => {
  render(<FrameAxisGizmos selectedFrameId="equipment:cup-01" />)
  dragSelectedFrameTo(movedWorldMatrix)
  endTransformDrag()
  expect(previewFrame).toHaveBeenCalled()
  expect(applyFrame).not.toHaveBeenCalled()
  await user.click(screen.getByRole('button', { name: 'Cancel frame' }))
  expect(cancelFrame).toHaveBeenCalledWith(
    'equipment:cup-01',
    expect.stringMatching(/^frame-inspector:/),
  )
})

it('uses an arbitrary valid graph frame as reference and copies canonical pose/matrix', async () => {
  renderFrameInspectorWithReference('equipment:cup-01', fixtureFrame('fixture:inspection'))
  await user.selectOptions(screen.getByLabelText('Reference frame'), 'fixture:inspection')
  expect(screen.getByLabelText('X (mm)')).toHaveValue(expectedCupInInspectionMm.x)
  await user.click(screen.getByRole('button', { name: 'Copy pose' }))
  expect(writeClipboard).toHaveBeenLastCalledWith(JSON.stringify(expectedCanonicalPose))
  await user.click(screen.getByRole('button', { name: 'Copy matrix' }))
  expect(JSON.parse(writeClipboard.mock.calls.at(-1)![0])).toEqual({
    order: 'column-major', elements: expectedColumnMajorMatrix,
  })
})
```

- [ ] **Step 2: Run RED**

Run: `npm run test:run -- src/features/frames src/features/ui/InspectorPanel.test.tsx src/app/AppShell.test.tsx`

Expected: FAIL because the frame UI and edit controller do not exist.

- [ ] **Step 3: Implement one edit controller**

```ts
export interface FrameEditSession {
  readonly id: string
  readonly ownerToken: string
  readonly frameId: string
  readonly expectedRevision: number
  readonly expectedPreviewEpoch: number
  readonly committedParentId: string
  readonly committedLocalPose: Pose3D
  readonly draftParentId: string
  readonly draftLocalPose: Pose3D
  readonly referenceFrameId: string
}

export interface FrameEditController {
  begin(frameId: string): FrameEditSession
  preview(session: FrameEditSession, poseInReference: Pose3D, referenceFrameId: string): FrameEditSession
  setParent(session: FrameEditSession, parentId: string): FrameEditSession
  apply(session: FrameEditSession): Promise<void>
  cancel(session: FrameEditSession): void
}
```

`preview()` converts reference-space input to world and then to current-parent
local pose. `setParent()` uses preserve-world math. Reject read-only, held,
missing, cyclic, invalid numeric, and scale-bearing input before store mutation.
Session objects remain React-local; only serializable previews enter Zustand.
The controller is stateless: every method receives the complete immutable
session and never looks up `sessionId` in a hidden map.
`begin()` snapshots the committed parent/local pose/revision. `preview()` and
`setParent()` return a new immutable session draft. `apply()` calls the store's
single `commitFrameEdit()` with draft parent+pose, expected revision, and
expected preview epoch;
success closes the session, while conflict/failure leaves the committed record
untouched and keeps the draft available for Cancel/retry.
`ownerToken` is exactly `frame-inspector:<session.id>`. The stateless controller
holds no subscription or hidden session map. FrameInspector and
FrameAxisGizmos subscribe directly to `subscribePreviewInvalidations()`, filter
by their React-local session owner token, set that local session to null, and
re-read committed values on a matching event.
Revision conflicts retain a retryable draft, but preview-epoch invalidation is
terminal and a fresh `begin()` is required.

- [ ] **Step 4: Implement tree, inspector, axes, and transform controls**

FrameTree groups Frames, Robots, and Equipment and exposes role, visibility,
source, and quality. Its Add flow creates the supported manual roles with a
validated parent; Rename is inline; Delete opens an explicit subtree/reparent
dialog and an active-TCP replacement selector when applicable. FrameInspector
provides a Reference combobox containing every currently resolvable valid graph
frame (with Parent, World, MCP, and Base grouped first), X/Y/Z with mm/m switch,
Roll/Pitch/Yaw with degree/radian switch, parent, Preview/Apply/Cancel, and the
same-owner active TCP selector. Drafts commit on Apply only; Enter applies a
valid field, Escape restores it. Alerts use `role="alert"` and successful
operations use `role="status"`.
`Copy pose` writes canonical-metre normalized-quaternion `Pose3D` JSON in the
selected reference. `Copy matrix` writes
`{ "order": "column-major", "elements": [16 numbers] }` JSON using the same
reference transform. Clipboard access is injected in tests; failure shows an
alert and never mutates the frame.

FrameAxisGizmos renders RGB axes and one Drei TransformControls for the selected
editable frame. Use a stable `useCallback` for drag state, disable OrbitControls
during drag, convert object world matrix through the chosen parent, and perform
preview updates during drag. Mouse-up ends drag and re-enables OrbitControls but
does not persist; the preview remains until the operator presses the same Apply
button used by numeric edits, which performs exactly one transaction. Cancel
after mouse-up restores the committed transform. Keep controls hidden for held
or derived frames.

- [ ] **Step 5: Replace equipment-only controls and verify responsive UI**

Extend the Task 10 InspectorPanel rather than replacing it: a frame node shows
FrameInspector; EquipmentInspector retains status, graspable, stack-light, and
asset-scale controls and adds a Transform tab backed by FrameInspector; a robot
link shows read-only frame data; a robot shows the existing JointInspector.
Delete the old equipment-only TransformControls only after its preview/commit,
hydration, and orbit lifecycle tests pass against FrameAxisGizmos. On narrow
screens use the existing mutually exclusive drawer and return focus on close.

- [ ] **Step 6: Run GREEN and commit**

Run each command separately and stop on the first nonzero exit:

1. `npm run test:run -- src/features/frames src/features/ui/InspectorPanel.test.tsx src/app/AppShell.test.tsx`
2. `npm run lint`
3. `npm run build`
4. `git diff --check`

Expected: unit/reference conversions, create/rename/delete, active-TCP
selection, apply/cancel, reparent, drag lifecycle, selection, visibility,
owner-scoped cancellation reset plus stale-Apply rejection, focus,
announcements, and narrow layout all PASS.

```powershell
git add src/features/frames src/features/ui/InspectorPanel.tsx src/features/ui/InspectorPanel.test.tsx src/features/ui/EquipmentInspector.tsx src/app/App.tsx src/app/AppShell.test.tsx src/styles/global.css
git add -u src/features/interaction/EquipmentTransformControls.tsx src/features/interaction/EquipmentTransformControls.test.tsx
git diff --cached --check
git commit -m "feat: edit machine and object coordinate frames"
```

---

### Task 6: Add Browser Acceptance and Luna Documentation

**Files:**
- Create: `e2e/frame-coordinates.spec.ts`
- Modify: `src/test/debug-bridge.ts`
- Create: `src/test/debug-bridge.test.ts`
- Create: `docs/operator/frame-coordinates.md`
- Create: `docs/developer/frame-graph.md`
- Create: `docs/verification/frame-graph-verification.md`
- Modify: `README.md`

**Interfaces:**
- Consumes: production build and read-only E2E debug snapshots.
- Produces: deterministic frame acceptance plus operator/developer/verification documentation.

- [ ] **Step 1: Write failing Playwright acceptance**

```ts
function expectPoseClose(actual: Pose3D, expected: Pose3D, digits = 8): void {
  actual.position.forEach((value, index) => {
    expect(value).toBeCloseTo(expected.position[index]!, digits)
  })
  const same = actual.quaternion.reduce(
    (sum, value, index) => sum + value * expected.quaternion[index]!,
    0,
  ) < 0
    ? actual.quaternion.map((value) => -value)
    : actual.quaternion
  same.forEach((value, index) => {
    expect(value).toBeCloseTo(expected.quaternion[index]!, digits)
  })
}

function expectPoseTranslatedBy(
  actual: Pose3D,
  before: Pose3D,
  delta: readonly [number, number, number],
): void {
  expectPoseClose(actual, {
    position: before.position.map((value, index) => value + delta[index]!) as [number, number, number],
    quaternion: before.quaternion,
  })
}

test('moves MCP/Base/equipment, preserves reparent world pose, and reloads', async ({ page }) => {
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])
  await page.goto('/')
  await addManualFrame(page, { role: 'fixture', name: 'Fixture 01', parent: 'MCP' })
  const relativeBefore = await readRelativePoses(page, 'MCP', [
    'CRB15000 Base', 'Machine 01', 'Fixture 01', 'Cup 01',
  ])
  await editFrame(page, 'MCP', { xMm: 100, yMm: -50, zMm: 0 })
  const relativeAfter = await readRelativePoses(page, 'MCP', Object.keys(relativeBefore))
  for (const id of Object.keys(relativeBefore)) {
    expectPoseClose(relativeAfter[id]!, relativeBefore[id]!)
  }

  const committedCupBeforeGrasp = await readFrameRecord(page, 'equipment:cup-01')
  await moveIntoFixtureAndCloseGripper(page, 'CRB15000', 'Cup 01')
  await expect.poll(() => readHeldEquipmentId(page)).toBe('cup-01')
  const jointsBeforeBaseEdit = await readJointSnapshot(page)
  const movingBefore = await readWorldPoses(page, [
    'robot:crb15000-01:link:LINK06',
    'robot:crb15000-01:flange:tool0',
    await readActiveTcpFrameId(page, 'crb15000-01'),
  ])
  const renderedCupBefore = await readRenderedEntityWorldPose(page, 'equipment:cup-01')
  const colliderBefore = await readColliderWorldPose(page, 'robot-link:crb15000-01:LINK06')
  await editFrame(page, 'CRB15000 Base', { zMm: 1180 })
  expect(await readJointSnapshot(page)).toEqual(jointsBeforeBaseEdit)
  const movingAfter = await readWorldPoses(page, Object.keys(movingBefore))
  for (const id of Object.keys(movingBefore)) {
    expectPoseTranslatedBy(movingAfter[id]!, movingBefore[id]!, [0, 0, 0.1])
  }
  expectPoseTranslatedBy(
    await readColliderWorldPose(page, 'robot-link:crb15000-01:LINK06'),
    colliderBefore,
    [0, 0, 0.1],
  )
  const renderedCupAfter = await readRenderedEntityWorldPose(page, 'equipment:cup-01')
  expectPoseTranslatedBy(renderedCupAfter, renderedCupBefore, [0, 0, 0.1])
  expectPoseClose(
    (await readFrameRecord(page, 'equipment:cup-01')).worldPose,
    committedCupBeforeGrasp.worldPose,
  )
  await openGripperAndRelease(page, 'CRB15000')
  await expect.poll(() => readHeldEquipmentId(page)).toBeNull()
  const committedCupAfterRelease = await readFrameRecord(page, 'equipment:cup-01')
  expectPoseClose(committedCupAfterRelease.worldPose, renderedCupAfter)
  expect(committedCupAfterRelease.revision).toBe(committedCupBeforeGrasp.revision + 1)

  await addManualFrame(page, { role: 'tcp', name: 'TCP 1', owner: 'crb15000-01' })
  await addManualFrame(page, { role: 'tcp', name: 'TCP 2', owner: 'crb15000-01' })
  await selectActiveTcp(page, 'CRB15000', 'TCP 2')
  await expect.poll(() => readActiveTcp(page, 'crb15000-01')).toMatch(/TCP 2/)
  await expect(page.getByRole('treeitem', { name: 'Fixture 01' })).toBeVisible()
  await selectFrame(page, 'Cup 01')
  await page.getByLabel('Reference frame').selectOption({ label: 'Fixture 01' })
  await page.getByRole('button', { name: 'Copy pose' }).click()
  expect(JSON.parse(await page.evaluate(() => navigator.clipboard.readText())))
    .toMatchObject({ position: expect.any(Array), quaternion: expect.any(Array) })
  await page.getByRole('button', { name: 'Copy matrix' }).click()
  expect(JSON.parse(await page.evaluate(() => navigator.clipboard.readText())))
    .toMatchObject({ order: 'column-major', elements: expect.any(Array) })
  const beforeReparent = await readWorldPose(page, 'Cup 01')
  await reparentFrame(page, 'Cup 01', 'Fixture 01')
  expectPoseClose(await readWorldPose(page, 'Cup 01'), beforeReparent)
  const activeTcpBeforeReload = await readWorldPose(page, 'TCP 2')
  await page.reload()
  expectPoseClose(await readWorldPose(page, 'Cup 01'), beforeReparent)
  await expect.poll(() => readActiveTcp(page, 'crb15000-01')).toMatch(/TCP 2/)
  expectPoseClose(await readWorldPose(page, 'TCP 2'), activeTcpBeforeReload)
  const robotTcpFrames = Object.values((await readFrameSnapshot(page)).framesById)
    .filter(({ ownerEntityId, role }) => ownerEntityId === 'robot:crb15000-01' && role === 'tcp')
  expect(robotTcpFrames.map(({ name }) => name)).toEqual(expect.arrayContaining(['TCP 1', 'TCP 2']))
})
```

Before GREEN, extend the Task 11 E2E-only read-only snapshot with plain-JSON
`framesById` committed records including world pose/revision, per-robot
`activeTcpFrameId`, registered derived frame IDs, held equipment ID,
`renderedEntityWorldPoses` for transient held-object/tool-follow transforms,
and canonical collider world poses keyed by entity ID. Keep the production
guard and expose no setters, store references, Three objects, or source bytes.
Add a DOM test proving the fields are absent when `VITE_E2E` is not enabled and
serializable when enabled; the Playwright helpers above read only this contract.

- [ ] **Step 2: Run RED, then GREEN**

Run: `npm run test:e2e -- e2e/frame-coordinates.spec.ts`

Expected before UI wiring: FAIL at Frame tree. Expected after wiring: PASS for
MCP-relative subtree invariance, exact Base-carried robot/tool/collider and held
render transforms with unchanged joints, held equipment-frame immutability plus
exactly one release commit, two TCP definitions and active-TCP reload, arbitrary
reference copy, explicit delete policies, preserve-world reparent, held edit
block, keyboard focus, responsive drawer, and collision/grasp alignment.

- [ ] **Step 3: Write Luna documentation**

Operator documentation defines World, MCP, Base, Flange, TCP, fixture,
workobject, equipment, sensor, Parent/World reference display, units,
Preview/Apply/Cancel, reparenting, held/read-only rules, and recovery. Developer
documentation records `T_parent_child`, ZYX RPY convention, graph invariants,
Dexie v2 migration, runtime frame registration, transform ownership, and
extension points. Verification documentation records exact commands and browser
evidence with no credentials or raw logs.

- [ ] **Step 4: Run final gates**

Run each gate separately and stop on the first nonzero exit:

1. `npm run lint`
2. `npm run test:run`
3. `npm run cad:validate`
4. `npm run build`
5. `npm run test:e2e -- e2e/frame-coordinates.spec.ts`
6. Run this PowerShell 5.1-safe inverted placeholder scan:

```powershell
$placeholderHits = & rg -n -i "T[B]D|T[O]DO|F[I]XME" docs/operator/frame-coordinates.md docs/developer/frame-graph.md docs/verification/frame-graph-verification.md
if ($LASTEXITCODE -eq 0) { $placeholderHits; throw 'Documentation placeholders remain' }
if ($LASTEXITCODE -ne 1) { exit $LASTEXITCODE }
```

7. `git diff --check`

Expected: all gates PASS; CAD 7/7, 0 errors, 0 warnings; placeholder scan prints
nothing; production build has only the recorded upstream bundle advisory.

- [ ] **Step 5: Commit Luna artifacts**

```powershell
git add e2e/frame-coordinates.spec.ts src/test/debug-bridge.ts src/test/debug-bridge.test.ts docs/operator/frame-coordinates.md docs/developer/frame-graph.md docs/verification/frame-graph-verification.md README.md
git diff --cached --check
git commit -m "docs: explain machine coordinate frame workflows"
```

## Completion Gate

A fresh reviewer must confirm graph invariants, exact RPY convention, migration
idempotence, manual frame lifecycle, MCP/Base/current CRB parity, namespaced
one-owner TCPs, active-TCP reload, one transform owner, reparent world-pose
preservation, held-object safety, collision/grasp alignment, accessibility,
reload persistence, and every automated gate before this plan is complete.
