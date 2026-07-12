# Fixed Coordinate Frames Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement one editable `World → MCP → Robot Base → Joints → Flange → TCP` hierarchy and make every external Object use MCP-local coordinates without changing the V1 `.wdtwin` format.

**Architecture:** Add scale-free Pose3D math and a persisted fixed-frame store for MCP/TCP. Workcell rendering nests Robot and Object scenes under MCP, keeps Robot Base in the existing mechanical configuration, derives Flange from FK, and mounts gripper/grasp/held-object runtime under editable TCP. Project capture/import uses the existing `frames.mcp` and `frames.tcp` V1 records.

**Tech Stack:** React 19, TypeScript 6, Zustand 5, Three.js 0.185, React Three Fiber 9, Vitest 4, Playwright 1.61.

## Global Constraints

- Internal coordinates are right-handed Z-up metres, radians, and normalized `[x,y,z,w]` quaternions.
- `World` is immutable identity; MCP and TCP never contain scale.
- Robot Base remains `RobotConfiguration.basePosition/baseRotationDeg` under MCP; the existing workbench mount offset remains for visual compatibility.
- Flange is derived/read-only and TCP is Flange-local.
- Object transforms are MCP-local. Identity MCP preserves existing data without a jump.
- Moving MCP carries Robot, colliders, gripper/TCP, and non-held Objects without changing joint angles or Object local transforms.
- Moving TCP carries gripper, grasp sensor, and held Object without changing joints.
- Release converts rendered world pose back to MCP-local exactly once before persistence.
- Keep one Robot, one MCP, and one TCP. Exclude generic Frame Tree, reparenting, multiple TCPs, IK, and Cartesian jogging.
- Use TDD and one focused commit per task.

---

### Task 1: Canonical Pose3D Math

**Files:**
- Create: `src/domain/frames/pose3d.ts`
- Create: `src/domain/frames/pose3d.test.ts`

**Interfaces:** Produces `Pose3D`, `IDENTITY_POSE`, normalize/compose/invert/relative helpers, ZYX RPY conversion, approximate equality, and scale-free `SerializableTransform` adapters.

- [ ] **Step 1: Write failing tests** for normalization, invalid values, non-commuting ZYX RPY, composition/inverse/relative recovery, and scale rejection.

```ts
it('converts a world pose to MCP-local and back', () => {
  const local = relativePose3D(mcp, world)
  expect(pose3DApproximatelyEquals(composePose3D(mcp, local), world)).toBe(true)
})
```

- [ ] **Step 2: Verify RED** with `npm run test:run -- src/domain/frames/pose3d.test.ts`; expect missing module failure.
- [ ] **Step 3: Implement** with Three.js `Matrix4`, `Quaternion`, `Vector3`, and `Euler('ZYX')`. Clone tuples, normalize quaternions, and reject scale differing from 1 by more than `1e-9`.
- [ ] **Step 4: Verify GREEN** with `npm run test:run -- src/domain/frames && npm run lint && git diff --check`.
- [ ] **Step 5: Commit** `src/domain/frames` as `feat: add fixed frame pose math` after `git diff --cached --check`.

---

### Task 2: Persist MCP/TCP and Integrate Project V1

**Files:**
- Create: `src/features/frames/coordinate-frame-store.ts`
- Create: `src/features/frames/coordinate-frame-store.test.ts`
- Modify: `src/domain/project/project.ts`
- Modify: `src/domain/project/project.test.ts`
- Modify: `src/features/project/browser-project-runtime.ts`

**Interfaces:** Produces `CoordinateFrameId = 'mcp' | 'tcp'`, `useCoordinateFrameStore`, `setFramePose()`, `replaceFrames()`, and `resetFrames()`.

- [ ] **Step 1: Write failing tests** proving MCP/TCP persistence, tuple ownership, invalid-scale rejection, and independence from Robot Base.

```ts
it('persists MCP independently from Robot Base', () => {
  store.getState().setFramePose('mcp', poseAt(0.1, -0.05, 0))
  expect(store.getState().frames.mcp.position).toEqual([0.1, -0.05, 0])
})
```

- [ ] **Step 2: Verify RED** with `npm run test:run -- src/features/frames/coordinate-frame-store.test.ts`.
- [ ] **Step 3: Implement** LocalStorage key `robot-sim.coordinate-frames.v1`, identity defaults, finite normalized pose validation, and project bridge. Project validation requires exact identity scale for MCP/TCP. `capture()` reads the store and `commit()` calls `replaceFrames(snapshot.frames)`.
- [ ] **Step 4: Verify GREEN** with `npm run test:run -- src/domain/project src/features/frames src/features/project && npm run build && git diff --check`.
- [ ] **Step 5: Commit** affected files as `feat: persist MCP and TCP project frames` after cached diff validation.

---

### Task 3: Apply MCP/TCP to Rendering and Interaction

**Files:**
- Modify: `src/domain/robot/kinematics.ts`
- Modify: `src/domain/robot/kinematics.test.ts`
- Create: `src/features/frames/frame-runtime.ts`
- Create: `src/features/frames/frame-runtime.test.ts`
- Modify: `src/features/robot/RobotModel.tsx`
- Modify: `src/features/robot/RobotGripper.tsx`
- Modify: `src/features/scene/Workcell.tsx`
- Modify: `src/features/interaction/GraspController.tsx`
- Modify: `src/features/interaction/grasp-actions.test.ts`

**Interfaces:** `RobotRig` gains `tcpFrame: Group`; produces `worldTransformToMcpLocal(world, mcp)`.

- [ ] **Step 1: Write failing tests** for `tcpFrame.parent === toolFrame`, MCP world movement with invariant locals/joints, TCP sensor movement, and world-to-MCP release conversion.

```ts
it('converts released world transform to MCP-local', () => {
  expect(worldTransformToMcpLocal(worldAt(1, 2, 0), mcpAt(1, 1, 0)).position)
    .toEqual([0, 1, 0])
})
```

- [ ] **Step 2: Verify RED** with focused robot/frame/interaction tests.
- [ ] **Step 3: Implement** one MCP group containing `EquipmentScene` and the existing robot mount. Add/apply TCP under Flange, mount gripper and all grasp/held runtime under TCP, and convert release world pose through inverse MCP before persistence.
- [ ] **Step 4: Verify GREEN** with robot/frame/equipment/interaction/scene tests, CAD validation, build, and diff check.
- [ ] **Step 5: Commit** as `feat: apply MCP and TCP to the workcell runtime`.

---

### Task 4: Manual Coordinate Editor

**Files:**
- Create: `src/features/frames/CoordinateFramesDialog.tsx`
- Create: `src/features/frames/CoordinateFramesDialog.test.tsx`
- Modify: `src/app/App.tsx`
- Modify: `src/app/AppShell.tsx`
- Modify: `src/app/AppShell.test.tsx`
- Modify: `src/features/equipment/EquipmentInspector.tsx`
- Modify: `src/styles/global.css`

**Interfaces:** Consumes coordinate frames, Robot configuration, current `RobotRigRegistration`, and joint state; produces one `Coordinate Frames` dialog.

- [ ] **Step 1: Write failing UI tests** for World/Flange read-only, MCP/TCP Apply/Cancel, Base proxy updates, finite validation, degree RPY, and live Flange/TCP display.

```tsx
await user.selectOptions(screen.getByLabelText('Coordinate frame'), 'mcp')
await editMillimetres('Frame X (mm)', 100)
await user.click(screen.getByRole('button', { name: 'Apply frame' }))
expect(setFramePose).toHaveBeenCalledWith('mcp', expect.objectContaining({ position: [0.1, 0, 0] }))
```

- [ ] **Step 2: Verify RED** with the dialog and AppShell tests.
- [ ] **Step 3: Implement** selector order World, MCP, Robot Base, Flange, TCP. Disable World/Flange fields. MCP/TCP write frame store; Base calls `setBasePose`; Cancel restores committed values. Label Object transforms as MCP-local.
- [ ] **Step 4: Verify GREEN** with frame/app/equipment tests, lint, build, and diff check.
- [ ] **Step 5: Commit** as `feat: edit fixed workcell coordinates`.

---

### Task 5: Browser Acceptance and Documentation

**Files:**
- Create: `tests/fixed-coordinate-frames.spec.ts`
- Create: `docs/operator/fixed-coordinate-frames.md`
- Modify: `README.md`
- Modify: `docs/progress/2026-07-13-short-term-mvp-implementation.md`

- [ ] **Step 1: Add Playwright acceptance** that edits MCP, Base, and TCP; confirms values and unchanged joints; saves/exports/imports; and verifies frames after reload.
- [ ] **Step 2: Document** `T_parent_child`, metres/mm, radians/degrees, ZYX RPY, hierarchy, MCP-local Objects, Base compatibility offset, Flange read-only behavior, TCP grasp behavior, persistence, and exclusions.
- [ ] **Step 3: Run final gates:** `npm run verify`, `npm run test:e2e`, `npm audit --audit-level=high`, and `git diff --check`.
- [ ] **Step 4: Commit** tests/docs as `docs: verify fixed coordinate frame workflows` after cached diff validation.

## Self-Review

- Coverage: World/MCP/Base/Joints/Flange/TCP, MCP-local Objects, editing, project persistence, and interaction alignment are included.
- Scope: multiple MCP/TCP, generic Frame Tree, reparenting, sensors, IK, and Cartesian jogging are excluded.
- Compatibility: identity MCP/TCP preserves current scenes and V1 archive layout; Base mount offset remains unchanged.
- Placeholder scan: no incomplete implementation placeholders remain.
- Type consistency: project `frames`, store, runtime, and dialog share the same scale-free Pose3D boundary.
