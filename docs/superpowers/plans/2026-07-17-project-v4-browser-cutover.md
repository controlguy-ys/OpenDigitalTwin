# Project V4 Browser Cutover Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** Publish Project V4 through the browser repository and every V4 runtime store as one observable revision, then switch the production App, Project commands, Scene, Robot, Job, coordinate, and collision surfaces to that V4 resource graph.

**Architecture:** Keep P1 ProjectRepositoryV4 and ProjectPublicationCoordinatorV4 as the durable authority, and add a real notification barrier around the otherwise independent Zustand and Geometry external stores. Runtime preparation owns candidate Geometry and Job-clock resources without changing live state; apply holds notifications, stages every store, and exposes commit, rollback, and cleanup callbacks that preserve P1 target-wins recovery. The App consumes one revision-qualified active runtime bundle and the already-built P2 V4 components; V1-V3 files remain unreferenced deletion input for the next task.

**Tech Stack:** React 19.2.7, TypeScript 6.0.3, Zustand 5.0.14, Three.js 0.185.1, React Three Fiber 9.6.1, Dexie 4.4.4, Vitest 4.1.10, Vite 8.1.4, Node 22.15.1, npm 11.4.2.

## Global Constraints

- Begin from the landed P1 Project V4 repository, codec, and publication coordinator plus the completed P2 V4 Robot, Scene, Job, interaction, coordinate, and viewport modules.
- Project V4 is the only accepted browser Project format. V1, V2, V3, unknown root fields, physical paths, and embedded source bytes fail before runtime staging and preserve the active revision.
- Preserve logical asset:// and versioned builtin:// references; never persist physical paths or STEP bytes.
- Hydration is target-wins: absent pointer means no active Project; stable pointer restores the verified row; publishing pointer finalizes a verified target or compensates its exact token and restores the verified prior stable row.
- A corrupt first publishing target is compensated to an absent pointer and reported as recovery-required with no active Project in the current session.
- createDefaultProjectV4 receives independent projectId and revisionId values plus one canonical UTC timestamp.
- Runtime prepare changes no live store, Geometry publication, durable pointer, or active runtime bundle.
- Runtime apply withholds Robot, Job, Scene, interaction, coordinate, active-bundle, and Geometry notifications until commit.
- The first subscriber callback released by commit must read one identical Project revision from every public runtime store.
- Rollback restores checkpoints in reverse order, rolls back candidate Geometry generations, resumes the prior Job clock, and emits no candidate notification.
- Cleanup revokes prior Geometry generations and disposes the prior Job clock only after commit.
- An unavailable logical Geometry source publishes an explicit UNRESOLVED generation; it never reuses a prior same-ID Definition generation.
- Visible prepared Scene totals of 1,500,000 triangles pass and totals of 1,500,001 fail before apply.
- Save returns the already durable active V4 Project. Import and Export use canonical JSON with the .json suffix.
- Closing or opening a Gripper changes only Robot runtime state. This task adds no Object attachment behavior.
- The Add menu exposes V4 Box, Cylinder, and Group commands only. Fixed Robot editors, dedicated Linear Axis commands, and STEP authoring controls are absent until their V4 authoring work lands.
- Do not edit or stage unrelated CAD directories.
- Keep source comments in English.
- The browser cutover is one atomic final commit. Do not create partial commits during Tasks 1-5.

---

### Task 1: Add the Cross-Store Barrier, Checkpoints, and Quiescent Clock

**Files:**
- Create: src/features/project/v4/runtime-publication-barrier-v4.ts
- Test: src/features/project/v4/runtime-publication-barrier-v4.test.ts
- Create: src/features/project/v4/browser-runtime-bundle-store-v4.ts
- Test: src/features/project/v4/browser-runtime-bundle-store-v4.test.ts
- Modify: src/features/jobs/v4/job-runtime-store.ts
- Test: src/features/jobs/v4/job-runtime-store.test.ts
- Modify: src/features/jobs/v4/simulation-clock.ts
- Test: src/features/jobs/v4/simulation-clock.test.ts

**Interfaces:**
- Consumes: StoreApi, RobotDefinitionGeometryRepositoryV4, WorkcellProjectV4, and the current RobotJobPlaybackControllerV4.
- Produces: RuntimePublicationBarrierV4, JobRuntimeCheckpointV4, buildInitialJobRuntimeStatesV4, BrowserRuntimeBundleStoreStateV4, and quiesce/resume clock methods.

- [ ] **Step 1: Write the failing barrier tests**

~~~ts
it('withholds stores and releases one revision-consistent first callback', () => {
  const barrier = createRuntimePublicationBarrierV4()
  const robots = barrier.gateStore(createRobotRuntimeRegistryV4())
  const jobs = barrier.gateStore(createJobRuntimeStoreV4())
  const scene = barrier.gateStore(createSceneRuntimeStoreV4())
  publishA({ robots, jobs, scene })
  const observed: string[][] = []
  robots.subscribe(() => observed.push([
    robots.getState().projectRevisionId!,
    jobs.getState().projectRevisionId!,
    scene.getState().projectRevisionId!,
  ]))

  const transaction = barrier.begin()
  robots.getState().replaceProject(projectB)
  jobs.getState().replaceProject(projectB)
  scene.getState().replaceProjection(projectionB)
  expect(observed).toEqual([])
  transaction.commit()

  expect(observed).toEqual([Array(3).fill(projectB.revisionId)])
})

it('discards candidate notifications after checkpoint restore and rollback', () => {
  const listener = vi.fn()
  jobs.subscribe(listener)
  const transaction = barrier.begin()
  const checkpoint = jobs.getState().captureCheckpoint()
  jobs.getState().replaceProject(projectB)
  jobs.getState().restoreCheckpoint(checkpoint)
  transaction.rollback()
  expect(listener).not.toHaveBeenCalled()
  expect(jobs.getState().projectRevisionId).toBe(projectA.revisionId)
})
~~~

- [ ] **Step 2: Run the barrier test and confirm RED**

Run:

~~~powershell
npm run test:run -- src/features/project/v4/runtime-publication-barrier-v4.test.ts
~~~

Expected: FAIL because runtime-publication-barrier-v4.ts does not exist.

- [ ] **Step 3: Implement the minimal barrier**

gateStore forwards getState, getInitialState, and setState but owns its public subscriber set. Its single raw subscription forwards immediately when idle and marks the facade dirty when a transaction is active. gateGeometryRepository forwards publication methods but owns subscribe and a public version counter. commit clears the hold first, flushes each dirty facade once in registration order, and reports subscriber exceptions through onListenerError without throwing. rollback drops every dirty record. A nested begin throws RUNTIME_PUBLICATION_TRANSACTION_ACTIVE.

- [ ] **Step 4: Run the barrier test and confirm GREEN**

Run:

~~~powershell
npm run test:run -- src/features/project/v4/runtime-publication-barrier-v4.test.ts
~~~

Expected: PASS for immediate idle notification, withheld apply, consistent flush, Geometry public-version behavior, rollback silence, and nested-transaction rejection.

- [ ] **Step 5: Write failing Job and bundle checkpoint tests**

~~~ts
it('restores the exact Job revision and running record', () => {
  const store = createJobRuntimeStoreV4()
  store.getState().replaceProject(projectA)
  store.getState().setRobotState(runningRobotA)
  const checkpoint = store.getState().captureCheckpoint()
  store.getState().replaceProject(projectB)
  store.getState().restoreCheckpoint(checkpoint)
  expect(store.getState()).toMatchObject({
    projectRevisionId: projectA.revisionId,
    byRobotId: { 'robot-a': runningRobotA },
  })
})

it('rejects a checkpoint owned by another active-bundle store', () => {
  const first = createBrowserRuntimeBundleStoreV4()
  const second = createBrowserRuntimeBundleStoreV4()
  expect(() => second.getState().restoreCheckpoint(
    first.getState().captureCheckpoint(),
  )).toThrow('BROWSER_RUNTIME_BUNDLE_CHECKPOINT_INVALID')
})
~~~

- [ ] **Step 6: Run checkpoint tests and confirm RED**

Run:

~~~powershell
npm run test:run -- src/features/jobs/v4/job-runtime-store.test.ts src/features/project/v4/browser-runtime-bundle-store-v4.test.ts
~~~

Expected: FAIL because the Job checkpoint and active-bundle store are absent.

- [ ] **Step 7: Implement owned checkpoints and the pure Job-state builder**

Use one WeakMap per store, following the existing Robot, Scene, interaction, and coordinate checkpoint pattern. buildInitialJobRuntimeStatesV4 validates the Project and returns the same frozen IDLE records used by replaceProject. replaceActive rejects a Project revision that differs from its Scene projection revision.

- [ ] **Step 8: Write failing clock lifecycle tests**

~~~ts
it('drains one in-flight frame, remains silent, then resumes once', async () => {
  controller.startJob('job-a')
  scheduler.fire(10)
  const pending = controller.quiesce()
  advance.resolve()
  await pending
  expect(scheduler.pendingCount()).toBe(0)
  controller.resume()
  expect(scheduler.pendingCount()).toBe(1)
})

it('makes dispose final after quiesce', async () => {
  await controller.quiesce()
  controller.dispose()
  controller.resume()
  controller.ensureRunning()
  expect(scheduler.pendingCount()).toBe(0)
})
~~~

- [ ] **Step 9: Run clock tests and confirm RED**

Run:

~~~powershell
npm run test:run -- src/features/jobs/v4/simulation-clock.test.ts
~~~

Expected: FAIL because quiesce and resume are not defined.

- [ ] **Step 10: Implement quiesce and resume**

Track suspended separately from disposed. quiesce sets suspended before canceling a scheduled frame and resolves after the current advanceAll promise settles. Settlement cannot schedule another frame while suspended. resume clears suspended only when not disposed and calls ensureRunning. startJob while suspended throws ROBOT_JOB_CLOCK_QUIESCED.

- [ ] **Step 11: Run Task 1 GREEN**

Run:

~~~powershell
npm run test:run -- src/features/project/v4/runtime-publication-barrier-v4.test.ts src/features/project/v4/browser-runtime-bundle-store-v4.test.ts src/features/jobs/v4/job-runtime-store.test.ts src/features/jobs/v4/simulation-clock.test.ts
npx tsc -p tsconfig.app.json --noEmit
git diff --check
~~~

Expected: all focused tests pass, TypeScript reports no error, and no whitespace error exists. Keep the change uncommitted.

---

### Task 2: Build Reversible Browser Runtime and Geometry Generations

**Files:**
- Modify: src/features/robot/v4/robot-definition-geometry-repository.ts
- Test: src/features/robot/v4/robot-definition-geometry-repository.test.ts
- Create: src/features/project/v4/browser-project-runtime-v4.ts
- Test: src/features/project/v4/browser-project-runtime-v4.test.ts

**Interfaces:**
- Consumes: ProjectRuntimeV4, Task 1 barrier and checkpoints, a prepared-Geometry resolver, selectSceneRuntimeV4, and deriveCollisionPolicyV4.
- Produces: stageUnresolved, BrowserProjectRuntimeResourcesV4, BrowserProjectRuntimeDependenciesV4, and createBrowserProjectRuntimeV4.

- [ ] **Step 1: Write failing UNRESOLVED-generation tests**

~~~ts
it('replaces resolved same-ID Geometry with an UNRESOLVED generation', () => {
  const resolved = repository.stage(definitionA, preparedA)
  repository.commitBatch([resolved])
  const unresolved = repository.stageUnresolved(definitionA, 42)
  expect(repository.readCurrent(definitionA.id)?.handle).toBe(resolved)
  repository.commitBatch([unresolved])
  expect(repository.readCurrent(definitionA.id)).toMatchObject({
    handle: unresolved,
    resolution: 'UNRESOLVED',
    triangleCount: 42,
  })
  expect(repository.acquire(definitionA.id, 'robot-a')).toBeNull()
})

it('rolls back an UNRESOLVED candidate to the resolved current generation', () => {
  const candidate = repository.stageUnresolved(definitionA, 42)
  repository.rollback(candidate)
  expect(repository.readCurrent(definitionA.id)?.handle).toBe(resolved)
})
~~~

- [ ] **Step 2: Run Geometry tests and confirm RED**

Run:

~~~powershell
npm run test:run -- src/features/robot/v4/robot-definition-geometry-repository.test.ts
~~~

Expected: FAIL because stageUnresolved and resolution do not exist.

- [ ] **Step 3: Implement UNRESOLVED generations**

Store geometry as PreparedRobotDefinitionGeometryV4 | null in a publication generation. stageUnresolved validates Definition topology and a nonnegative safe triangle count, creates a normal staged handle, and owns no disposable Geometry. acquire returns null for that generation. commitBatch, rollback, fallback selection, and revoke use the same state machine for both resolution kinds.

- [ ] **Step 4: Run Geometry tests and confirm GREEN**

Run:

~~~powershell
npm run test:run -- src/features/robot/v4/robot-definition-geometry-repository.test.ts src/features/robot/v4/RobotInstanceModel.test.tsx src/features/robot/v4/RobotFleet.test.tsx src/features/scene/v4/Workcell.test.tsx
~~~

Expected: PASS; resolved leases remain shared and an UNRESOLVED generation produces the existing UNRESOLVED Robot state.

- [ ] **Step 5: Write failing prepare and triangle-limit tests**

~~~ts
it('prepares without changing live registries or Geometry', async () => {
  const before = snapshots(dependencies)
  const bundle = await runtime.prepare(projectB, projectB.revisionId)
  expect(snapshots(dependencies)).toEqual(before)
  expect(bundle.resources.project).toBe(projectB)
})

it('accepts 1500000 triangles and rejects 1500001 before apply', async () => {
  await expect(runtime.prepare(projectWithTriangles(1_500_000), 'revision-pass'))
    .resolves.toBeDefined()
  await expect(runtime.prepare(projectWithTriangles(1_500_001), 'revision-fail'))
    .rejects.toMatchObject({ code: 'VISIBLE_SCENE_TRIANGLE_LIMIT_EXCEEDED' })
})

it('records an unavailable logical source as UNRESOLVED', async () => {
  resolveDefinitionGeometry.mockResolvedValue(null)
  const bundle = await runtime.prepare(projectA, projectA.revisionId)
  expect(bundle.resources.definitionPublications[0]?.geometry).toBeNull()
})
~~~

- [ ] **Step 6: Run prepare tests and confirm RED**

Run:

~~~powershell
npm run test:run -- src/features/project/v4/browser-project-runtime-v4.test.ts -t "prepares|triangles|UNRESOLVED"
~~~

Expected: FAIL because browser-project-runtime-v4.ts does not exist.

- [ ] **Step 7: Implement pure preparation**

Validate Project and revision identity. Build robotStates with buildInitialRobotRuntimeStatesV4 and jobStates with buildInitialJobRuntimeStatesV4. Call prepareScene with the candidate revision and Robot record. Resolve all Definitions concurrently; if one rejects, dispose every fulfilled prepared Geometry. Use actual resolved triangle counts and declared occurrence counts for UNRESOLVED Definitions, multiplied by visible Robot Instances, then add visible Spatial Asset and primitive counts. Create the non-running candidate Job runtime only after all validation succeeds.

- [ ] **Step 8: Write failing atomic apply tests**

~~~ts
it('releases a first callback that sees one revision everywhere', async () => {
  await publish(runtime, projectA)
  const observed: string[][] = []
  dependencies.robots.subscribe(() => observed.push(readEveryRevision(dependencies)))
  const application = await runtime.apply(
    await runtime.prepare(projectB, projectB.revisionId),
  )
  expect(observed).toEqual([])
  await application.commit()
  expect(observed[0]).toEqual(Array(6).fill(projectB.revisionId))
})

it.each([
  'stage-geometry',
  'replace-robot',
  'replace-job',
  'replace-scene',
  'replace-interaction',
  'replace-coordinate',
  'replace-active-bundle',
] as const)('restores all resources when %s fails', async (failurePoint) => {
  await publish(runtime, projectA)
  injectApplyFailure(dependencies, failurePoint)
  const before = authoritativeSnapshot(dependencies)
  await expect(runtime.apply(
    await runtime.prepare(projectB, projectB.revisionId),
  )).rejects.toThrow()
  expect(authoritativeSnapshot(dependencies)).toEqual(before)
  expect(candidateNotification).not.toHaveBeenCalled()
})
~~~

- [ ] **Step 9: Run apply tests and confirm RED**

Run:

~~~powershell
npm run test:run -- src/features/project/v4/browser-project-runtime-v4.test.ts -t "first callback|restores all"
~~~

Expected: FAIL because reversible multi-store apply is absent.

- [ ] **Step 10: Implement apply in the exact order**

1. Await prior activeBundle.jobs.playback.quiesce.
2. Begin one RuntimePublicationTransactionV4.
3. Capture Robot, Job, Scene, interaction, coordinate, and active-bundle checkpoints.
4. Stage one resolved or UNRESOLVED Geometry handle per Definition.
5. Replace Robot, Job, Scene, interaction, coordinate, and active bundle in that order.
6. On failure, restore in reverse order, roll back handles in reverse order, rollback the barrier, dispose candidate resources, resume the prior clock, and rethrow the primary error.
7. application.commit calls commitBatch once when handles are nonempty, then transaction.commit.
8. application.rollback performs the reverse restore while held, rolls back handles, disposes the candidate clock, rolls back the barrier, and resumes the prior clock.
9. application.cleanup revokes every prior handle, including removed and same-ID Definitions, then disposes the prior Job runtime.
10. runtime.dispose is idempotent for a prepared bundle that never became authoritative.

- [ ] **Step 11: Write same-Definition and clock-lifecycle tests**

~~~ts
it('keeps the prior same-ID generation until cleanup and its final lease', async () => {
  await publish(runtime, projectA)
  const old = geometry.readCurrent(definitionId)!.handle
  const lease = geometry.acquire(definitionId, 'robot-a')!
  const next = await runtime.apply(await runtime.prepare(projectB, revisionB))
  expect(geometry.readCurrent(definitionId)!.handle).toBe(old)
  await next.commit()
  expect(geometry.readCurrent(definitionId)!.handle).not.toBe(old)
  await next.cleanup()
  expect(disposeOld).not.toHaveBeenCalled()
  lease.release()
  expect(disposeOld).toHaveBeenCalledOnce()
})

it('resumes the prior clock on rollback and disposes it after cleanup', async () => {
  await publish(runtime, projectA)
  const prior = runtimeBundle.getState().active!.jobs.playback
  const rolledBack = await runtime.apply(await runtime.prepare(projectB, revisionB))
  await rolledBack.rollback()
  expect(prior.resume).toHaveBeenCalledOnce()
  const committed = await runtime.apply(await runtime.prepare(projectB, revisionB))
  await committed.commit()
  await committed.cleanup()
  expect(prior.dispose).toHaveBeenCalledOnce()
})
~~~

- [ ] **Step 12: Run Task 2 GREEN**

Run:

~~~powershell
npm run test:run -- src/features/project/v4/browser-project-runtime-v4.test.ts src/features/robot/v4/robot-definition-geometry-repository.test.ts src/features/robot/v4/RobotInstanceModel.test.tsx src/features/robot/v4/RobotFleet.test.tsx src/features/scene/v4/Workcell.test.tsx
npx tsc -p tsconfig.app.json --noEmit
git diff --check
~~~

Expected: all tests pass, rollback emits no candidate state, and prior Geometry and clock resources live until committed cleanup. Keep the change uncommitted.

---

### Task 3: Serialize Mutations and Implement Target-Wins Hydration

**Files:**
- Create: src/features/project/v4/project-v4-mutation-service.ts
- Test: src/features/project/v4/project-v4-mutation-service.test.ts

**Interfaces:**
- Consumes: ProjectRepositoryV4, ProjectPublicationCoordinatorV4, PublishedProjectBundleV4, and validateWorkcellProjectV4.
- Produces: ProjectMutationServiceV4, structurally satisfying ProjectMutationPortV4.

- [ ] **Step 1: Write failing stable and valid-target hydrate tests**

~~~ts
it('restores a verified stable row without creating a revision', async () => {
  await seedStable(repository, projectA, 'token-a')
  await mutations.hydrate()
  expect(mutations.readPublished()?.revisionId).toBe(projectA.revisionId)
})

it('finalizes the exact publishing token and restores the valid target', async () => {
  await seedStable(repository, projectA, 'token-a')
  await seedPublishing(repository, projectB, projectA.revisionId, 'token-b')
  await mutations.hydrate()
  expect(mutations.readPublished()?.revisionId).toBe(projectB.revisionId)
  expect(await repository.readPointer()).toMatchObject({
    state: 'stable',
    revisionId: projectB.revisionId,
    commitToken: 'token-b',
  })
})
~~~

- [ ] **Step 2: Run hydrate tests and confirm RED**

Run:

~~~powershell
npm run test:run -- src/features/project/v4/project-v4-mutation-service.test.ts -t "stable|valid target"
~~~

Expected: FAIL because project-v4-mutation-service.ts does not exist.

- [ ] **Step 3: Implement the shared queue and verified target path**

Use one promise tail for hydrate, replace, replacePrepared, and replaceFromActive. A stable pointer reads its exact row and calls publication.restorePublished. A publishing pointer first verifies the target row, then calls repository.finalizePublication(pointer.commitToken) and restores that target.

- [ ] **Step 4: Write failing compensation and recovery tests**

~~~ts
it('compensates a corrupt target and restores the prior stable row', async () => {
  await seedStable(repository, projectA, 'token-a')
  await seedPublishing(repository, projectB, projectA.revisionId, 'token-b')
  await database.projectRevisions.delete(projectB.revisionId)
  await mutations.hydrate()
  expect(mutations.readPublished()?.revisionId).toBe(projectA.revisionId)
})

it('compensates a corrupt first target to no pointer and latches recovery', async () => {
  await seedPublishing(repository, projectA, null, 'token-first')
  await database.projectRevisions.delete(projectA.revisionId)
  await expect(mutations.hydrate()).rejects.toMatchObject({
    code: 'PROJECT_RECOVERY_REQUIRED',
  })
  expect(await repository.readPointer()).toBeNull()
  expect(mutations.readPublished()).toBeNull()
  expect(mutations.isRecoveryRequired()).toBe(true)
})
~~~

- [ ] **Step 5: Implement exact-token compensation**

On publishing-target read or verification failure, call repository.compensatePublication(pointer.commitToken), reread the pointer, and restore the verified prior stable row when present. If compensation removes the first pointer, latch recovery and throw PROJECT_RECOVERY_REQUIRED. Finalize, compensate, prior-row verification, or runtime-restore uncertainty also latches recovery. No other database is read.

- [ ] **Step 6: Write failing immutable recipe and CAS tests**

~~~ts
it('clones the active Project and forwards its unchanged expected revision', async () => {
  publication.readPublished.mockReturnValue(bundleA)
  createRevisionId.mockReturnValue('revision-b')
  nowIso.mockReturnValue('2026-07-17T01:02:03.000Z')
  await mutations.replaceFromActive({
    description: 'Rename Robot A',
    mutate(active) {
      expect(active).not.toBe(bundleA.project)
      return { ...active, robots: [{ ...active.robots[0]!, name: 'Renamed' }] }
    },
  })
  expect(publication.replace).toHaveBeenCalledWith({
    candidate: expect.objectContaining({
      projectId: bundleA.project.projectId,
      revisionId: 'revision-b',
      metadata: expect.objectContaining({
        createdAt: bundleA.project.metadata.createdAt,
        updatedAt: '2026-07-17T01:02:03.000Z',
      }),
    }),
    expectedRevisionId: bundleA.revisionId,
  })
})

it('does not retry a stale recipe', async () => {
  publication.replace.mockRejectedValueOnce(activeRevisionChanged)
  await expect(mutations.replaceFromActive(recipe))
    .rejects.toMatchObject({ code: 'PROJECT_ACTIVE_REVISION_CHANGED' })
  expect(recipe.mutate).toHaveBeenCalledOnce()
})
~~~

- [ ] **Step 7: Implement replace methods and one success notification**

replace captures readPublished()?.revisionId ?? null and delegates to replacePrepared. replacePrepared validates and forwards the supplied expected revision unchanged. replaceFromActive requires a published bundle, structuredClone copies its frozen Project, invokes the recipe once, rechecks the revision, assigns a fresh revisionId, preserves projectId and metadata.createdAt, overwrites metadata.updatedAt, validates, and publishes. Notify service listeners once only after successful hydrate or replacement.

- [ ] **Step 8: Run Task 3 GREEN**

Run:

~~~powershell
npm run test:run -- src/features/project/v4/project-v4-mutation-service.test.ts src/features/project/v4/project-v4-publication.test.ts src/features/project/v4/project-v4-repository.test.ts
npx tsc -p tsconfig.app.json --noEmit
git diff --check
~~~

Expected: all tests pass for absent pointer, stable restore, valid target, corrupt target with prior, corrupt first target, recipe exception, validation failure, stale CAS, durable failure, and runtime failure. Keep the change uncommitted.

---

## File Structure

### Create

- src/features/project/v4/runtime-publication-barrier-v4.ts — gates subscriptions for public Zustand stores and the Geometry repository while raw stores remain private.
- src/features/project/v4/runtime-publication-barrier-v4.test.ts — proves withheld notifications, adversarial first-observer consistency, rollback silence, and immediate notifications outside a transaction.
- src/features/project/v4/browser-runtime-bundle-store-v4.ts — holds the active Project, Scene projection, collision policy, and Project-owned Job runtime resources under one revision.
- src/features/project/v4/browser-runtime-bundle-store-v4.test.ts — proves authoritative checkpoint ownership and exact restore.
- src/features/project/v4/browser-project-runtime-v4.ts — prepares and reversibly applies Robot, Job, Scene, interaction, coordinate, Geometry, collision-policy, and Job-clock resources.
- src/features/project/v4/browser-project-runtime-v4.test.ts — covers all apply failure points, Geometry generations, triangle limits, UNRESOLVED state, notification ordering, and Job-clock lifecycle.
- src/features/project/v4/project-v4-mutation-service.ts — serializes hydrate, replacement, and immutable active-Project recipes over the P1 coordinator.
- src/features/project/v4/project-v4-mutation-service.test.ts — covers target-wins hydrate, exact-token finalize and compensation, recovery latch, recipe CAS, and failure preservation.
- src/features/project/v4/default-project-v4.ts — builds the one-Robot built-in CRB default Project.
- src/features/project/v4/default-project-v4.test.ts — proves default validity and exact initial ownership.
- src/features/project/v4/project-store-v4.ts — exposes V4 hydrate, New, Save, Export, and Import state.
- src/features/project/v4/project-store-v4.test.ts — covers identity creation, canonical JSON, rejection, reload, and status behavior.
- src/features/project/project-store-browser.test.ts — proves the browser factory exposes only gated V4 resources and drives one stable reload.
- src/features/collision/v4/CollisionPanel.tsx — validates the current registered V4 Geometry proxies on explicit operator request.
- src/features/collision/v4/CollisionPanel.test.tsx — proves namespaced findings, intentional mount exclusions, empty registration, and focus.
- src/app/v4-production-import-graph.test.ts — walks static imports from src/main.tsx and rejects every active V1-V3 browser lane and fixed Robot symbol.

### Modify

- src/features/robot/v4/robot-definition-geometry-repository.ts and test — add transactional UNRESOLVED generations without changing Robot identity.
- src/features/jobs/v4/job-runtime-store.ts and test — add owned checkpoints and an exported pure initial-state builder.
- src/features/jobs/v4/simulation-clock.ts and test — add quiesce and resume so an active Project clock can cross apply safely.
- src/features/project/project-store-browser.ts — construct and export the V4-only browser resource bundle.
- src/features/project/ProjectMenu.tsx and test — consume ProjectStoreV4 and use .json import and export.
- src/app/initial-project-bootstrap.ts and test — use activeProject and preserve StrictMode single-New behavior.
- src/features/scene/v4/SceneCanvas.tsx and test — accept a revision-safe external Home, Fit All, or Focus Selection request.
- src/app/AppShell.tsx and test — remove fixed authoring and dedicated-axis controls and render a read-only selected Robot source label.
- src/app/App.tsx and test — atomically compose the V4 browser resources and V4-only operator surfaces.
- src/features/ui/BottomWorkspace.test.tsx — prove TimelineV4 and CollisionPanelV4 remain mutually exclusive in the neutral bottom shell.

### Consume Without Modifying

- src/features/project/v4/project-v4-codec.ts
- src/features/project/v4/project-v4-db.ts
- src/features/project/v4/project-v4-repository.ts
- src/features/project/v4/project-v4-publication.ts
- src/features/project/v4/project-mutation-port.ts
- src/features/robot/v4/builtin-crb-definition.ts
- src/features/robot/v4/robot-runtime-registry.ts
- src/features/scene/v4/scene-runtime-selector.ts
- src/features/scene/v4/scene-runtime-store.ts
- src/features/interaction/v4/interaction-store.ts
- src/features/frames/v4/coordinate-display-store.ts
- src/features/viewport/v4/viewport-preference-store.ts
- src/features/scene/v4/SceneExplorer.tsx
- src/features/scene/v4/SceneContextMenu.tsx
- src/features/scene/v4/SceneEntityInspector.tsx
- src/features/joints/v4/JointInspector.tsx
- src/features/jobs/v4/RobotJobList.tsx
- src/features/ui/v4/Timeline.tsx
- src/features/scene/v4/Workcell.tsx

The similarly named V1-V3 root modules are not edited into forwarding facades. The production App stops importing them; the next task deletes them.

## Canonical Interfaces

### Notification barrier

~~~ts
export interface RuntimePublicationTransactionV4 {
  commit(): void
  rollback(): void
}

export interface RuntimePublicationBarrierV4 {
  gateStore<State>(store: StoreApi<State>): StoreApi<State>
  gateGeometryRepository(
    repository: RobotDefinitionGeometryRepositoryV4,
  ): RobotDefinitionGeometryRepositoryV4
  begin(): RuntimePublicationTransactionV4
}

export function createRuntimePublicationBarrierV4(options?: {
  readonly onListenerError?: (error: unknown) => void
}): RuntimePublicationBarrierV4
~~~

Only gated facades are exported from project-store-browser.ts. During a transaction each facade records its pre-transaction public snapshot and one dirty bit. commit ends the hold and invokes each dirty facade once in registration order; every listener exception is reported through onListenerError and cannot make an already observed publication reversible. rollback discards all dirty records. The gated Geometry facade owns a public monotonically increasing snapshot that advances only on an immediate notification or committed flush, not on a rolled-back raw generation.

### Job runtime checkpoint and clock

~~~ts
export interface JobRuntimeCheckpointV4 {
  readonly kind: 'job-runtime-checkpoint-v4'
}

export interface JobRuntimeStoreV4 {
  readonly projectRevisionId: string | null
  readonly byRobotId: Readonly<Record<string, RobotJobRuntimeStateV4>>
  replaceProject(project: WorkcellProjectV4): void
  setRobotState(state: RobotJobRuntimeStateV4): void
  reset(project: WorkcellProjectV4): void
  captureCheckpoint(): JobRuntimeCheckpointV4
  restoreCheckpoint(checkpoint: JobRuntimeCheckpointV4): void
}

export function buildInitialJobRuntimeStatesV4(
  project: WorkcellProjectV4,
): Readonly<Record<string, RobotJobRuntimeStateV4>>

export interface RobotJobPlaybackControllerV4 {
  startJob(jobId: RobotJobIdV4): { readonly runId: string }
  cancelRobotJob(robotId: RobotIdV4, reason: string): void
  ensureRunning(): void
  quiesce(): Promise<void>
  resume(): void
  dispose(): void
}
~~~

quiesce cancels the scheduled frame, blocks new scheduling, and resolves after the current advanceAll promise settles. resume is idempotent and schedules again only when the retained executor has a running Robot. dispose is final and idempotent.

### Geometry publication

~~~ts
export interface RobotDefinitionGeometryPublicationSnapshotV4 {
  readonly definitionId: RobotDefinitionIdV4
  readonly handle: RobotDefinitionGeometryPublicationHandleV4
  readonly resolution: 'RESOLVED' | 'UNRESOLVED'
  readonly triangleCount: number
}

export interface RobotDefinitionGeometryRepositoryV4 {
  stage(
    definition: RobotDefinitionV4,
    geometry: PreparedRobotDefinitionGeometryV4,
  ): RobotDefinitionGeometryPublicationHandleV4
  stageUnresolved(
    definition: RobotDefinitionV4,
    declaredTriangleCount: number,
  ): RobotDefinitionGeometryPublicationHandleV4
  commitBatch(
    handles: readonly RobotDefinitionGeometryPublicationHandleV4[],
  ): void
  rollback(handle: RobotDefinitionGeometryPublicationHandleV4): void
  readCurrent(
    definitionId: RobotDefinitionIdV4,
  ): RobotDefinitionGeometryPublicationSnapshotV4 | null
  acquire(
    definitionId: RobotDefinitionIdV4,
    robotId: RobotIdV4,
    publicationHandle?: RobotDefinitionGeometryPublicationHandleV4,
  ): AcquiredRobotDefinitionGeometryV4 | null
  revoke(handle: RobotDefinitionGeometryPublicationHandleV4): void
  subscribe(listener: () => void): () => void
  getSnapshot(): number
}
~~~

An UNRESOLVED generation is a real staged and committed generation with no acquire lease. It replaces a prior same-ID generation atomically, retains declared triangle accounting, and makes RobotInstanceModelV4 render its existing UNRESOLVED state.

### Active runtime bundle and browser runtime

~~~ts
export interface BrowserJobRuntimeResourcesV4 {
  readonly executor: RobotJobExecutorV4
  readonly playback: RobotJobPlaybackControllerV4
  dispose(): void
}

export interface ActiveBrowserRuntimeBundleV4 {
  readonly project: WorkcellProjectV4
  readonly sceneRuntime: SceneRuntimeProjectionV4
  readonly collisionPolicy: CollisionPolicyV4
  readonly jobs: BrowserJobRuntimeResourcesV4
}

export interface BrowserRuntimeBundleCheckpointV4 {
  readonly kind: 'browser-runtime-bundle-checkpoint-v4'
}

export interface BrowserRuntimeBundleStoreStateV4 {
  readonly projectRevisionId: RevisionIdV4 | null
  readonly active: ActiveBrowserRuntimeBundleV4 | null
  replaceActive(active: ActiveBrowserRuntimeBundleV4): void
  captureCheckpoint(): BrowserRuntimeBundleCheckpointV4
  restoreCheckpoint(checkpoint: BrowserRuntimeBundleCheckpointV4): void
}

export function createBrowserRuntimeBundleStoreV4(
): StoreApi<BrowserRuntimeBundleStoreStateV4>

export interface PreparedDefinitionPublicationV4 {
  readonly definition: RobotDefinitionV4
  readonly geometry: PreparedRobotDefinitionGeometryV4 | null
  readonly triangleCount: number
}

export interface BrowserProjectRuntimeResourcesV4 {
  readonly project: WorkcellProjectV4
  readonly robotStates: Readonly<Record<RobotIdV4, RobotRuntimeStateV4>>
  readonly jobStates: Readonly<Record<RobotIdV4, RobotJobRuntimeStateV4>>
  readonly sceneProjection: SceneRuntimeProjectionV4
  readonly collisionPolicy: CollisionPolicyV4
  readonly definitionPublications: readonly PreparedDefinitionPublicationV4[]
  readonly activeBundle: ActiveBrowserRuntimeBundleV4
}

export interface BrowserProjectRuntimeDependenciesV4 {
  readonly robotRegistry: StoreApi<RobotRuntimeRegistryV4>
  readonly jobStore: StoreApi<JobRuntimeStoreV4>
  readonly sceneStore: StoreApi<SceneRuntimeStoreV4>
  readonly interactionStore: StoreApi<InteractionStoreStateV4>
  readonly coordinateDisplayStore: StoreApi<CoordinateDisplayStoreStateV4>
  readonly runtimeBundleStore: StoreApi<BrowserRuntimeBundleStoreStateV4>
  readonly geometryRepository: RobotDefinitionGeometryRepositoryV4
  readonly notifications: RuntimePublicationBarrierV4
  readonly resolveDefinitionGeometry: (
    project: WorkcellProjectV4,
    definition: RobotDefinitionV4,
  ) => Promise<PreparedRobotDefinitionGeometryV4 | null>
  readonly prepareScene: (
    project: WorkcellProjectV4,
    robotStates: Readonly<Record<RobotIdV4, RobotRuntimeStateV4>>,
  ) => SceneRuntimeProjectionV4
  readonly createJobRuntime: (
    project: WorkcellProjectV4,
  ) => BrowserJobRuntimeResourcesV4
}

export function createBrowserProjectRuntimeV4(
  dependencies: BrowserProjectRuntimeDependenciesV4,
): ProjectRuntimeV4<BrowserProjectRuntimeResourcesV4>
~~~

prepare resolves or records every Definition, builds pure Robot and Job state, derives Scene and collision policy, creates a non-running candidate Job runtime, and checks the visible triangle limit. apply quiesces the prior clock before opening the notification transaction, captures Robot, Job, Scene, interaction, coordinate, and active-bundle checkpoints, stages one resolved or UNRESOLVED Geometry generation per Definition, replaces all stores, and returns the P1 application handle.

### Project mutation and store

~~~ts
export interface ProjectMutationRecipeV4 {
  readonly description: string
  mutate(active: WorkcellProjectV4): WorkcellProjectV4
}

export interface ProjectMutationServiceV4 {
  hydrate(): Promise<void>
  readPublished(): PublishedProjectBundleV4 | null
  subscribe(listener: () => void): () => void
  replace(candidate: WorkcellProjectV4): Promise<PublishedProjectBundleV4>
  replacePrepared(
    candidate: WorkcellProjectV4,
    expectedRevisionId: string | null,
  ): Promise<PublishedProjectBundleV4>
  replaceFromActive(
    recipe: ProjectMutationRecipeV4,
  ): Promise<PublishedProjectBundleV4>
  isRecoveryRequired(): boolean
}

export interface ProjectMutationServiceDependenciesV4 {
  readonly repository: ProjectRepositoryV4
  readonly publication: ProjectPublicationCoordinatorV4
  readonly nowIso: () => string
  readonly createRevisionId: () => string
}

export function createProjectMutationServiceV4(
  dependencies: ProjectMutationServiceDependenciesV4,
): ProjectMutationServiceV4

export function createDefaultProjectV4(options: {
  readonly projectId: string
  readonly revisionId: string
  readonly nowIso: string
}): WorkcellProjectV4

export interface ProjectStoreStateV4 {
  readonly activeProject: WorkcellProjectV4 | null
  readonly status:
    | 'idle'
    | 'loading'
    | 'saving'
    | 'importing'
    | 'ready'
    | 'error'
    | 'recovery-required'
  readonly error: string | null
  hydrate(): Promise<void>
  newProject(): Promise<void>
  saveActiveProject(): Promise<WorkcellProjectV4>
  exportActiveProject(): Promise<Blob>
  importProject(source: Blob | Uint8Array | ArrayBuffer): Promise<void>
}

export type ProjectStoreV4 = StoreApi<ProjectStoreStateV4>

export interface ProjectStoreDependenciesV4 {
  readonly mutations: ProjectMutationServiceV4
  readonly createDefaultProject: () => WorkcellProjectV4
  readonly encodeProject: (project: WorkcellProjectV4) => Blob
  readonly decodeProject: (
    source: Blob | Uint8Array | ArrayBuffer,
  ) => Promise<WorkcellProjectV4>
}

export function createProjectStoreV4(
  dependencies: ProjectStoreDependenciesV4,
): ProjectStoreV4
~~~

All mutation methods share one queue. replaceFromActive reads and clones the frozen published Project, applies the recipe to the clone, rechecks the unchanged expected revision, assigns one fresh revisionId, overwrites metadata.updatedAt with nowIso(), validates, and forwards that exact expected revision to publication.replace.

### V4-only browser resources

~~~ts
export interface BrowserProjectResourcesV4 {
  readonly projectStore: ProjectStoreV4
  readonly mutations: ProjectMutationServiceV4
  readonly robots: StoreApi<RobotRuntimeRegistryV4>
  readonly jobs: StoreApi<JobRuntimeStoreV4>
  readonly scene: StoreApi<SceneRuntimeStoreV4>
  readonly interaction: StoreApi<InteractionStoreStateV4>
  readonly coordinateDisplay: StoreApi<CoordinateDisplayStoreStateV4>
  readonly viewportPreferences: ViewportPreferenceStoreV4
  readonly geometry: RobotDefinitionGeometryRepositoryV4
  readonly runtimeBundle: StoreApi<BrowserRuntimeBundleStoreStateV4>
  readonly sceneCommands: SceneCommandServiceV4
  readonly jobCommands: JobCommandServiceV4
}

export interface BrowserProjectResourcesOptionsV4 {
  readonly database?: ProjectDatabaseV4
  readonly nowIso?: () => string
  readonly createId?: () => string
  readonly animationScheduler?: AnimationFrameSchedulerV4
  readonly resolveDefinitionGeometry?: (
    project: WorkcellProjectV4,
    definition: RobotDefinitionV4,
  ) => Promise<PreparedRobotDefinitionGeometryV4 | null>
}

export function createBrowserProjectResourcesV4(
  options?: BrowserProjectResourcesOptionsV4,
): BrowserProjectResourcesV4

export const browserProjectResourcesV4: BrowserProjectResourcesV4
export const projectStoreV4: ProjectStoreV4
export function useProjectStoreV4<Selected>(
  selector: (state: ProjectStoreStateV4) => Selected,
): Selected
~~~

No unversioned aliases are exported. The raw stores and raw Geometry repository are function locals and cannot be subscribed to by the App.

---

### Task 4: Add the Default Project and V4 Project Store

**Files:**
- Create: src/features/project/v4/default-project-v4.ts
- Test: src/features/project/v4/default-project-v4.test.ts
- Create: src/features/project/v4/project-store-v4.ts
- Test: src/features/project/v4/project-store-v4.test.ts

**Interfaces:**
- Consumes: WorkcellProjectV4, createBuiltinCrbDefinitionV4, ProjectMutationServiceV4, encodeProjectV4, and decodeProjectV4.
- Produces: createDefaultProjectV4, ProjectStoreStateV4, and createProjectStoreV4.

- [ ] **Step 1: Write the failing default-Project test**

~~~ts
it('creates a valid one-Robot CRB Project with independent identities', () => {
  const project = createDefaultProjectV4({
    projectId: 'project-default',
    revisionId: 'revision-default',
    nowIso: '2026-07-17T00:00:00.000Z',
  })

  expect(() => assertValidProjectV4(project)).not.toThrow()
  expect(project.projectId).toBe('project-default')
  expect(project.revisionId).toBe('revision-default')
  expect(project.robotDefinitions).toHaveLength(1)
  expect(project.robots).toHaveLength(1)
  expect(project.jobs).toHaveLength(1)
  expect(project.jobs[0].steps).toEqual([])
  expect(project.scene.frames.some((frame) => frame.role === 'world')).toBe(true)
  expect(project.scene.frames.some((frame) => frame.role === 'mcp')).toBe(true)
  expect(project.robotDefinitions[0].frames.map((frame) => frame.role)).toEqual(
    expect.arrayContaining(['base', 'flange', 'tool0', 'tool', 'tcp']),
  )
})
~~~

- [ ] **Step 2: Run the default test and confirm RED**

Run:

~~~powershell
npm run test:run -- src/features/project/v4/default-project-v4.test.ts
~~~

Expected: FAIL because default-project-v4.ts does not exist.

- [ ] **Step 3: Implement the smallest valid default factory**

The factory accepts explicit projectId, revisionId, and nowIso values. Reuse the built-in CRB Definition, create one Robot instance, create only the world and MCP Scene entities required by the schema, and create one empty Job owned by that Robot. Do not add the table or any path-bearing imported asset.

- [ ] **Step 4: Run the default test and confirm GREEN**

Run:

~~~powershell
npm run test:run -- src/features/project/v4/default-project-v4.test.ts
~~~

Expected: PASS, including schema validation and the absence of a default table entity.

- [ ] **Step 5: Write the failing Project-store tests**

Cover these observable cases:

~~~ts
it('New delegates one generated Project to the mutation service', async () => {
  await store.getState().newProject()
  expect(createDefaultProject).toHaveBeenCalledOnce()
  expect(mutations.replace).toHaveBeenCalledWith(generatedProject)
  expect(store.getState().activeProject?.revisionId).toBe(generatedProject.revisionId)
})

it('Save returns the durable active Project without republishing it', async () => {
  const saved = await store.getState().saveActiveProject()
  expect(saved).toEqual(activeProject)
  expect(mutations.replace).not.toHaveBeenCalled()
})

it('normalizes valid reordered V4 JSON and exports canonical bytes', async () => {
  await store.getState().importProject(reorderedValidV4Blob)
  const exported = await store.getState().exportActiveProject()
  expect(await exported.text()).toBe(canonicalJsonFor(importedProject))
})

it.each([1, 2, 3])('rejects schema %s and preserves the active revision', async (schemaVersion) => {
  await expect(store.getState().importProject(blobForSchema(schemaVersion))).rejects.toThrow()
  expect(store.getState().activeProject?.revisionId).toBe(activeProject.revisionId)
})
~~~

Also reject unknown root fields, sourceBytes, sourcePath, and mountPath; cover hydrate success, recovery-required status, no-active Save and Export, decoder failure, replacement failure, and status/error reset on the next successful command.

- [ ] **Step 6: Run the Project-store test and confirm RED**

Run:

~~~powershell
npm run test:run -- src/features/project/v4/project-store-v4.test.ts
~~~

Expected: FAIL because project-store-v4.ts does not exist.

- [ ] **Step 7: Implement the V4 Project store**

hydrate delegates to mutations.hydrate and mirrors the returned active Project or recovery latch. New calls the injected default factory once and publishes through mutations.replace. Save reads the durable active bundle through mutations.readPublished rather than creating a revision. Import fully decodes before mutations.replace. Export encodes the current active Project as application/json. Every async action sets its operation status, clears stale errors on entry, and leaves the previous active Project intact on failure.

- [ ] **Step 8: Run the focused Project tests and confirm GREEN**

Run:

~~~powershell
npm run test:run -- src/features/project/v4/default-project-v4.test.ts src/features/project/v4/project-store-v4.test.ts
~~~

Expected: PASS for default identity, New, durable Save, canonical import/export, strict rejection, hydrate, and recovery status. Keep the change uncommitted.

---

### Task 5: Wire the Browser Resource Root, Menu, and Initial Bootstrap

**Files:**
- Modify: src/features/project/project-store-browser.ts
- Create: src/features/project/project-store-browser.test.ts
- Modify: src/features/project/ProjectMenu.tsx
- Test: src/features/project/ProjectMenu.test.tsx
- Modify: src/app/initial-project-bootstrap.ts
- Test: src/app/initial-project-bootstrap.test.ts

**Interfaces:**
- Consumes: the ProjectDatabaseV4 constructor, createProjectRepositoryV4, createProjectPublicationCoordinatorV4, createBrowserProjectRuntimeV4, createProjectMutationServiceV4, createProjectStoreV4, and every gated V4 runtime facade.
- Produces: createBrowserProjectResourcesV4, browserProjectResourcesV4, projectStoreV4, useProjectStoreV4, ProjectMenuV4, and initial V4 hydration.

- [ ] **Step 1: Write the failing browser-root test**

~~~ts
it('publishes one stable reload through only gated V4 resources', async () => {
  const database = new ProjectDatabaseV4('browser-root-reload-test')
  const first = createBrowserProjectResourcesV4({ database })
  await first.projectStore.getState().newProject()
  const revisionId = first.projectStore.getState().activeProject!.revisionId

  const second = createBrowserProjectResourcesV4({ database })
  const observations: string[][] = []
  second.robots.subscribe(() => observations.push(readAllRuntimeRevisionIds(second)))
  await second.projectStore.getState().hydrate()

  expect(second.projectStore.getState().activeProject?.revisionId).toBe(revisionId)
  expect(observations).toEqual([Array(runtimeFacadeCount).fill(revisionId)])
})

it('keeps raw stores private and registers unresolved Geometry explicitly', async () => {
  const resources = createBrowserProjectResourcesV4({
    resolveDefinitionGeometry: async () => null,
  })
  await resources.projectStore.getState().newProject()
  expect(resources).not.toHaveProperty('rawRobots')
  expect(resources.geometry.readCurrent(definitionId)?.resolution).toBe('UNRESOLVED')
})
~~~

Also prove that the built-in CRB resolver returns its prepared bundle, each candidate Project receives its own Job executor and playback controller, and no browser export exposes a raw store or an unversioned alias.

- [ ] **Step 2: Run the browser-root test and confirm RED**

Run:

~~~powershell
npm run test:run -- src/features/project/project-store-browser.test.ts
~~~

Expected: FAIL because the browser module still exports the V3 resource graph.

- [ ] **Step 3: Replace the browser singleton atomically**

Construct database, repository, barrier, raw stores, gated facades, Geometry repository, browser runtime, publication coordinator, mutation service, command services, and Project store inside createBrowserProjectResourcesV4. Capture raw stores only in that closure. Resolve builtin://crb15000 through the checked-in CRB geometry bundle; stage every other unavailable logical source as UNRESOLVED. Export only the interfaces in BrowserProjectResourcesV4 and one production singleton.

- [ ] **Step 4: Run the browser-root test and confirm GREEN**

Run:

~~~powershell
npm run test:run -- src/features/project/project-store-browser.test.ts
~~~

Expected: PASS for reload, observer consistency, resource privacy, built-in resolution, unresolved resolution, and Project-owned Job resources.

- [ ] **Step 5: Write failing Project-menu and bootstrap tests**

~~~tsx
it('imports JSON and exports the active Project as JSON', async () => {
  render(<ProjectMenuV4 projectStore={projectStore} />)
  await user.upload(screen.getByLabelText('Import project'), jsonFile)
  expect(projectStore.getState().importProject).toHaveBeenCalledWith(jsonFile)
  await user.click(screen.getByRole('button', { name: 'Export' }))
  expect(downloadName).toMatch(/\.json$/)
  expect(downloadName).not.toContain('.wdtwin')
})

it('creates one Project only when hydrate returns no active Project', async () => {
  await bootstrapInitialProjectV4(projectStore)
  await bootstrapInitialProjectV4(projectStore)
  expect(projectStore.getState().hydrate).toHaveBeenCalledTimes(2)
  expect(projectStore.getState().newProject).toHaveBeenCalledTimes(1)
})
~~~

Menu coverage includes New confirmation, Save, Export, Import cancellation, operation disablement, and error rendering. Bootstrap coverage includes restored active Project, recovery-required, hydrate rejection, and React StrictMode double invocation.

- [ ] **Step 6: Run the menu/bootstrap tests and confirm RED**

Run:

~~~powershell
npm run test:run -- src/features/project/ProjectMenu.test.tsx src/app/initial-project-bootstrap.test.ts
~~~

Expected: FAIL because both files still consume the V3 Project store and archive suffix.

- [ ] **Step 7: Cut menu and bootstrap to ProjectStoreV4**

ProjectMenuV4 accepts ProjectStoreV4 directly and never decodes files itself. The file input accepts application/json and .json. bootstrapInitialProjectV4 calls hydrate first, returns for ready or recovery-required state, and uses a module-local in-flight guard so a genuinely absent idle store creates only one default Project under StrictMode.

- [ ] **Step 8: Run the Task 5 tests and confirm GREEN**

Run:

~~~powershell
npm run test:run -- src/features/project/project-store-browser.test.ts src/features/project/ProjectMenu.test.tsx src/app/initial-project-bootstrap.test.ts
~~~

Expected: PASS for the browser root, JSON Project commands, stable reload, absent bootstrap, restored bootstrap, and StrictMode behavior. Keep the change uncommitted.

---

### Task 6: Cut the Production App to the V4 Graph and Commit Once

**Files:**
- Create: src/features/collision/v4/CollisionPanel.tsx
- Test: src/features/collision/v4/CollisionPanel.test.tsx
- Modify: src/features/scene/v4/SceneCanvas.tsx
- Test: src/features/scene/v4/SceneCanvas.test.tsx
- Modify: src/app/AppShell.tsx
- Test: src/app/AppShell.test.tsx
- Modify: src/app/App.tsx
- Test: src/app/App.test.tsx
- Test: src/features/ui/BottomWorkspace.test.tsx
- Create: src/app/v4-production-import-graph.test.ts

**Interfaces:**
- Consumes: BrowserProjectResourcesV4, all V4 UI components listed in the file map, CollisionPolicyV4, and the registered Geometry proxies.
- Produces: one revision-gated production App, CollisionPanelV4, and a static import-graph enforcement test.

- [ ] **Step 1: Write the failing V4 collision-panel tests**

~~~tsx
it('validates registered V4 proxies only on operator request', async () => {
  render(<CollisionPanelV4 resources={resources} />)
  expect(collisionEngine.validate).not.toHaveBeenCalled()
  await user.click(screen.getByRole('button', { name: 'Validate' }))
  expect(collisionEngine.validate).toHaveBeenCalledWith(
    expect.objectContaining({ projectRevisionId: revisionId }),
  )
  expect(screen.getByText('robot-a/link-2')).toBeVisible()
})
~~~

Cover an empty registration, namespaced Robot/link and Scene-entity findings, intentional base/mount exclusions, near-miss totals, disabled Validate while a run is active, and focus-selection dispatch.

- [ ] **Step 2: Run the collision test and confirm RED**

Run:

~~~powershell
npm run test:run -- src/features/collision/v4/CollisionPanel.test.tsx
~~~

Expected: FAIL because CollisionPanelV4 does not exist.

- [ ] **Step 3: Implement the read-only V4 collision panel**

Read the active revision, collision policy, and registered proxy snapshot from the root bundle and gated Geometry repository. Validation is explicit; do not add a frame loop or physics behavior. Persist no derived collision result into the Project. Focus routes the finding identity to the V4 interaction command.

- [ ] **Step 4: Run the collision test and confirm GREEN**

Run:

~~~powershell
npm run test:run -- src/features/collision/v4/CollisionPanel.test.tsx
~~~

Expected: PASS for explicit validation, namespacing, exclusions, totals, and focus.

- [ ] **Step 5: Write failing revision-safe camera and shell tests**

Add this optional SceneCanvasV4 input:

~~~ts
export interface SceneCameraRequestV4 {
  readonly id: number
  readonly projectRevisionId: RevisionIdV4
  readonly command: 'home' | 'fit-all' | 'focus-selection'
}
~~~

Tests prove a new matching request runs once, a repeated id is ignored, and a request from the prior Project revision is ignored. AppShell tests prove the Add menu contains only Box, Cylinder, and Group; the selected Robot source is read-only; and fixed Robot editors, dedicated Linear Axis actions, STEP authoring actions, and joint-source selectors are absent.

- [ ] **Step 6: Run camera and shell tests and confirm RED**

Run:

~~~powershell
npm run test:run -- src/features/scene/v4/SceneCanvas.test.tsx src/app/AppShell.test.tsx
~~~

Expected: FAIL because the camera request and V4-only shell contract are not implemented.

- [ ] **Step 7: Implement the camera request and neutral shell**

SceneCanvasV4 stores the last handled request id and compares projectRevisionId before changing only camera position, projection, zoom, or orbit pivot. AppShell remains layout-only and takes typed menu, selection, source-label, and bottom-workspace props; it owns no Project or Robot singleton.

- [ ] **Step 8: Run camera and shell tests and confirm GREEN**

Run:

~~~powershell
npm run test:run -- src/features/scene/v4/SceneCanvas.test.tsx src/app/AppShell.test.tsx
~~~

Expected: PASS for request identity, stale-revision rejection, V4 Add commands, and removed fixed controls.

- [ ] **Step 9: Write the failing atomic App tests**

Test App with an injected BrowserProjectResourcesV4. It must keep the loading or recovery surface visible until projectStore.activeProject, runtimeBundle, Robot, Job, Scene, interaction, and coordinate stores all report the same revision. After one committed publication, assert the first rendered workcell includes SceneExplorerV4, SceneCanvasV4, SceneEntityInspectorV4 or JointInspectorV4, RobotJobListV4, TimelineV4, SceneContextMenuV4, CollisionPanelV4, and ProjectMenuV4. Also cover:

- Robot selection and Job selection remain distinct structured identities.
- Scene commands add Box, Cylinder, and Group through ProjectMutationServiceV4.
- The V4 context menu remains wired for Focus, persisted Hide/Show, temporary Isolate/Show All, Copy/Paste/Reset local transform, Rename, primitive and Group creation, Group move/ungroup, removable delete, Robot Base edit or mount-frame entry, and Collision entry.
- Home, Fit All, and Focus Selection create revision-qualified camera requests.
- Timeline and Collision occupy mutually exclusive bottom tabs without horizontal page overflow.
- Gripper Open and Close update Robot runtime only.
- A Project replacement clears stale selection and never renders a mixed-revision frame.
- An unavailable Geometry source renders UNRESOLVED, including when its Definition ID matches the prior Project.

- [ ] **Step 10: Run the App tests and confirm RED**

Run:

~~~powershell
npm run test:run -- src/app/App.test.tsx src/features/ui/BottomWorkspace.test.tsx
~~~

Expected: FAIL because App.tsx still composes the V3 stores and UI surfaces.

- [ ] **Step 11: Replace App.tsx in one edit**

App accepts an optional resources prop defaulting to browserProjectResourcesV4. Select all public state from gated facades. Compute ready only when every non-null public revision equals activeProject.revisionId and runtimeBundle.active.project is that revision. Compose only V4 components and typed V4 command services. No production import may reference a V1-V3 Project, Robot singleton, Scene singleton, Job singleton, linear-axis singleton, grasp controller, or fixed six-joint constant.

- [ ] **Step 12: Run the App tests and confirm GREEN**

Run:

~~~powershell
npm run test:run -- src/app/App.test.tsx src/features/ui/BottomWorkspace.test.tsx
~~~

Expected: PASS for atomic render, commands, selection, camera, bottom workspace, unresolved Geometry, and Project replacement.

- [ ] **Step 13: Add the static production import-graph test**

From src/main.tsx, recursively resolve relative static imports and re-exports. Fail if the reachable graph enters a V1-V3 runtime/store/component lane or contains any of these fixed-lane symbols:

~~~ts
const forbiddenProductionSymbols = [
  'robot:active',
  'linear-axis:active',
  'JointAnglesDeg',
  'JOINT_COUNT',
  'ZERO_JOINT_ANGLES',
  'heldEntityId',
  'GraspController',
  'WorkcellProjectSnapshotV3',
]
~~~

The allowlist may include neutral UI primitives and Project V4 codec/database code only. Do not use filename-only assertions; resolve the reachable module graph so dormant old files do not fail this task and active indirect imports do.

- [ ] **Step 14: Run the graph test and remove every reported production edge**

Run:

~~~powershell
npm run test:run -- src/app/v4-production-import-graph.test.ts
~~~

Expected RED: the first run reports the remaining V3 production edge. Remove or replace each reported import.

Run the same command again.

Expected GREEN: PASS with src/main.tsx reaching only V4 domain/runtime components and neutral shared UI.

- [ ] **Step 15: Run the complete verification gate**

Run:

~~~powershell
npm run test:run
npm run lint
npm run build
git diff --check
~~~

Expected: every test passes, lint reports no errors, the production build succeeds, and git diff --check prints no output.

- [ ] **Step 16: Review scope and create the one cutover commit**

Run:

~~~powershell
git status --short
git diff --stat
git diff --name-only
git status --short --untracked-files=all -- CRB15000_12kg-127_OmniCore_rev00_STEP_J Savvy
~~~

Expected: only the Task 1-6 files in this plan are staged for review; the CAD paths print no changes. Stage the exact reviewed source, test, and plan paths, inspect git diff --cached --check and git diff --cached --stat, then commit:

~~~powershell
git commit -m "feat: cut browser publication to project v4"
~~~

Expected: one commit with the exact message and no CAD, generated output, or unrelated user change.

---

## Execution Review Checklist

- [ ] Every public Robot, Job, Scene, interaction, coordinate, active-bundle, and Geometry subscription is gated; raw stores stay private.
- [ ] Runtime prepare is pure, apply is reversible, commit releases one consistent first observation, and cleanup owns the prior clock and Geometry generations.
- [ ] Target-wins hydrate uses the exact repository publication token for finalize or compensation and exposes recovery-required deterministically.
- [ ] Valid reordered V4 input is normalized and re-exported canonically; schemas 1-3, unknown fields, physical paths, and source bytes are rejected before staging.
- [ ] Missing Geometry publishes UNRESOLVED even for a same-ID Definition, and the 1,500,000/1,500,001 triangle boundary is tested.
- [ ] New, Save, Import, Export, reload, and StrictMode bootstrap are covered through the same serialized mutation service.
- [ ] App renders only matching revisions and reaches only V4 production modules.
- [ ] Right-click V4 commands remain functional without any dedicated linear-axis branch or fixed Robot editor.
- [ ] The complete test, lint, build, diff, staged-scope, and CAD-exclusion gates pass before the single final commit.

## Known Specification Boundary

WorkcellProjectV4 currently has no persisted collision-policy field. This plan therefore derives CollisionPolicyV4 deterministically from Robot Definitions and mount relationships and supplies the named browser near-miss default as a runtime resource. Persisting user-edited collision settings would require a separately approved V4 aggregate schema change; it is not hidden inside this browser cutover.
