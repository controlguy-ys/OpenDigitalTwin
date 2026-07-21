# Box ObjectPos OPC UA Binding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Create 20 linear Box spatial entities and bind each Box pose to the live B&R OPC UA `ObjectPos[0..19]` X/Y/Z/Roll/Pitch/Yaw nodes.

**Architecture:** Add a deterministic Project V4 mutation recipe that creates or replaces the reserved ObjectPos Box set, endpoint, ownership, and six-leaf pose mappings. Extend the V4-to-V5 gateway contract and native OPC UA read-plan assembler so one pose mapping can consume six distinct scalar OPC UA roots. Expose the mutation from the Connectivity UI and verify the published project, live Gateway status, and runtime pose ingestion without writing to the PLC.

**Tech Stack:** React/TypeScript, Vite, Vitest, native `node-opcua` runtime gateway, Project V4/V5 validators.

## Global Constraints

- Read the live OPC UA server at `opc.tcp://127.0.0.1:4840` before authoring node IDs; confirmed namespace 5 and child paths `::Sample6X:ObjectPos[i].{X,Y,Z,Roll,Pitch,Yaw}`.
- Do not write, deploy, transfer, restart, or alter the PLC.
- Preserve the existing Robot `Rob.Q1..Q6` bindings.
- Keep Structured Text comments in English; new code comments are English.
- Keep changes narrow and validate XML/project shape where applicable.
- Commit the completed feature and report exact verification evidence.

---

### Task 1: Author the deterministic 20-Box ObjectPos Project mutation

**Files:**
- Create: `src/features/project/v4/box-objectpos-opcua-binding-v4.ts`
- Create: `src/features/project/v4/box-objectpos-opcua-binding-v4.test.ts`
- Test: `src/core/project-v4/validate.test.ts` through the new helper's validation assertions

**Interfaces:**
- Produces `bindBrObjectPosBoxesV4(project: WorkcellProjectV4): WorkcellProjectV4`.
- Uses the existing V4 `SpatialEntityV4`, `MovingFrameV4`, `OpcUaEndpointV4`, and `OpcUaMappingV4` contracts.

- [ ] **Step 1: Write the failing test** for exactly 20 `box` entities named `ObjectPos[0]` through `ObjectPos[19]`, linearly spaced on X at 0.30 m increments, six scalar leaves per mapping, and node IDs `ns=5;s=::Sample6X:ObjectPos[i].X/Y/Z/Roll/Pitch/Yaw`.
- [ ] **Step 2: Run the focused test** with `npx vitest run src/features/project/v4/box-objectpos-opcua-binding-v4.test.ts`; expect failure because the helper does not exist.
- [ ] **Step 3: Implement the mutation** with endpoint `endpoint-br-object-pos`, URL `opc.tcp://127.0.0.1:4840`, read ownership `opcua:endpoint-br-object-pos`, a moving frame per Box, and canonical Project V4 pose leaves.
- [ ] **Step 4: Validate the returned project** using `validateWorkcellProjectV4`, preserve non-reserved entities and existing Robot mappings, and replace only the reserved ObjectPos endpoint/mappings on repeat invocation.
- [ ] **Step 5: Run the focused test** and confirm PASS, including malformed source project rejection and repeat-application idempotency.
- [ ] **Step 6: Commit** with `git add src/features/project/v4/box-objectpos-opcua-binding-v4.ts src/features/project/v4/box-objectpos-opcua-binding-v4.test.ts && git commit -m "feat: author 20 ObjectPos Box bindings"`.

### Task 2: Support six distinct OPC UA roots in the V5 Gateway mapping

**Files:**
- Modify: `src/core/project-v5/types.ts`
- Modify: `src/core/project-v5/validate-shape.ts`
- Modify: `src/core/project-v5/validate-references.ts`
- Modify: `middleware/runtime-gateway/opcua-client-read-plan.ts`
- Modify: `middleware/runtime-gateway/opcua-client-adapter.ts`
- Modify: `src/features/runtime-gateway/v4/project-v4-to-v5-gateway.ts`
- Modify: `src/features/runtime-gateway/v4/project-v4-to-v5-gateway.test.ts`
- Create: `middleware/runtime-gateway/opcua-client-read-plan-objectpos.test.ts`

**Interfaces:**
- Adds optional V5 gateway leaf field `nodeAddress?: OpcUaNodeAddressV1`; existing mappings continue using the mapping root address.
- Compiles monitored roots by each leaf's effective address and assembles pose values from retained leaf samples until all six canonical Project paths are available.
- Converts V4 pose leaves to V5 leaves with each V4 node ID converted to the B&R namespace URI address.

- [ ] **Step 1: Add a failing conversion/assembly test** proving one entity-frame mapping with six leaf node addresses compiles to six monitored scalar roots and assembles `positionM + quaternion`.
- [ ] **Step 2: Run the focused tests** and confirm the new behavior fails before implementation.
- [ ] **Step 3: Add optional leaf node addresses** to the V5 shape/type/reference validation without changing existing persisted mappings.
- [ ] **Step 4: Update V4→V5 conversion** to preserve each pose leaf's effective OPC UA node address and use the V5 canonical Project paths.
- [ ] **Step 5: Update the read plan** to compile one root per effective leaf address while preserving the mapping ID association.
- [ ] **Step 6: Update the snapshot assembler** to retain per-mapping leaf values by Project path, emit a complete pose only after all six leaves are GOOD, and retain the last complete pose on a bad notification.
- [ ] **Step 7: Run the focused Gateway tests** and confirm the existing Robot Q1-Q6 conversion remains six mappings with no regressions.
- [ ] **Step 8: Commit** with `git add src/core/project-v5/types.ts src/core/project-v5/validate-shape.ts src/core/project-v5/validate-references.ts middleware/runtime-gateway/opcua-client-read-plan.ts middleware/runtime-gateway/opcua-client-adapter.ts src/features/runtime-gateway/v4/project-v4-to-v5-gateway.ts src/features/runtime-gateway/v4/project-v4-to-v5-gateway.test.ts middleware/runtime-gateway/opcua-client-read-plan-objectpos.test.ts && git commit -m "feat: assemble OPC UA pose mappings from scalar roots"`.

### Task 3: Expose the batch binding action in the application

**Files:**
- Modify: `src/app/App.tsx`
- Modify: `src/app/v4/app-command-composition.ts`
- Modify: `src/app/v4/app-command-composition.test.ts`
- Modify: `src/features/ui/v4/app-menu-model.ts` or the existing Connectivity command surface identified by the composition tests

**Interfaces:**
- Adds `actions.connectivity.bindBrObjectPosBoxes()` which applies `bindBrObjectPosBoxesV4` through `resources.mutations.replaceFromActive`.
- Presents the command as `Create 20 Box ObjectPos bindings`.

- [ ] **Step 1: Add a failing command-surface test** asserting the command is discoverable and invokes the mutation action.
- [ ] **Step 2: Run the focused command/UI test** and confirm failure.
- [ ] **Step 3: Wire the action and menu command** while preserving the existing Robot Q1-Q6 action.
- [ ] **Step 4: Run focused App tests, lint, and TypeScript build**.
- [ ] **Step 5: Commit** with `git add src/app/App.tsx src/app/v4/app-command-composition.ts src/app/v4/app-command-composition.test.ts src/features/ui/v4/app-menu-model.ts && git commit -m "feat: expose ObjectPos Box binding action"`.

### Task 4: Apply and verify the live 20-Box binding

**Files:**
- Modify: none beyond the implementation tasks
- Verify: published Project V4, Gateway HTTP status, WebSocket state batches, and browser UI

**Interfaces:**
- Uses the application action from Task 3 and the existing Runtime Gateway endpoints.

- [ ] **Step 1: Start/reuse the local webserver and native Gateway** without changing PLC settings.
- [ ] **Step 2: Apply `Create 20 Box ObjectPos bindings` once from the in-app UI**.
- [ ] **Step 3: Verify the active project has 20 reserved ObjectPos Box entities and 20 pose mappings (120 scalar leaves), while Robot Q1-Q6 mappings remain present.**
- [ ] **Step 4: Verify Gateway status** reports the B&R endpoint connected, 120 ObjectPos roots monitored, GOOD values, and the existing Robot endpoint mappings.
- [ ] **Step 5: Verify runtime ingestion** by observing state batches for ObjectPos mappings and confirming Box runtime poses update from X/Y/Z/Roll/Pitch/Yaw values.
- [ ] **Step 6: Run the full suite**: `npm run test:gateway`, `npm run lint`, `npm run build:gateway`, `npm run build`, and the App runtime tests.
- [ ] **Step 7: Commit any final verification-only fix** if needed, then report URLs, counts, node path pattern, and no-PLC-write boundary.

---

