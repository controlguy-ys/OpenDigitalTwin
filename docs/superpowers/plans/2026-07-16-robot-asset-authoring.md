# Robot and Asset Authoring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add logical Asset mounting, bounded STEP preparation, deterministic one-to-seven-source Robot assembly authoring, and reusable Object/Group authoring to the V4-only browser.

**Architecture:** Extend the compiled TypeScript Runtime Gateway with a filesystem-confined `AssetResolver`, while the browser remains the sole Project author and commits only `asset://` or versioned `builtin://` references. Analyze STEP sources in a bounded Worker, preserve the OCCT occurrence hierarchy, require explicit operator ownership and Mechanics confirmation, and publish one complete Robot Definition plus Instance through the P1/P2 atomic V4 mutation boundary. Reuse the existing Scene Explorer, context-menu, visibility, grouping, and RPY editing interaction patterns after converting them to V4 keyed entities.

**Tech Stack:** TypeScript 6.0.3, React 19.2.7, Zustand 5.0.14, Three.js 0.185.1, React Three Fiber 9.6.1, occt-import-js 0.0.23, Web Workers, Node HTTP/filesystem streams, Vitest 4.1.10, Testing Library 16.3.2, Playwright 1.61.1, Vite 8.1.4, Node 22.15.1, npm 11.4.2.

## Global Constraints

- P1 `2026-07-16-project-v4-core-contracts.md` and P2 `2026-07-16-multi-robot-runtime.md` are landed prerequisites. Consume P1's public V4 contracts and `PublishedProjectBundleV4`, plus P2's `ProjectMutationServiceV4`, Robot registry, Frame runtime, and keyed Scene commands; do not create a second Project authority.
- Accept one through seven Robot STEP sources per Definition. Source count, assembly node count, Mesh count, Link count, and Joint count are independent.
- Accept one through sixteen serial revolute or prismatic Joints and the corresponding two through seventeen Links.
- Never infer Joint ownership, axis, origin, limits, Link order, source orientation, Base, Flange, Tool0, Tool, TCP, or Gripper Frames from filenames, topology, motor-like components, AI, an API, or a harness.
- Names and hierarchy are evidence that may be displayed. No suggestion is confirmed until the operator explicitly confirms it.
- Persist source orientation as exactly one discriminated choice: Up-Axis normalization or a custom source-root quaternion. Reject a configuration that would apply both corrections.
- Use metres internally, Z-up, normalized quaternion `[x,y,z,w]`, and RPY degrees composed as `Rz * Ry * Rx`. Apply source linear scaling and orientation exactly once.
- Persist no raw STEP bytes and no physical Windows, Linux, or Docker path. Project, XML, and XLSX may contain only `asset://<alias>/<relative-path>` or versioned `builtin://` URIs plus digest and import metadata.
- Keep `AssetResolver` active in OPC UA Off mode. Missing external Assets open as `UNRESOLVED`; checksum mismatch blocks Geometry publication.
- Enforce 8 Robot Instances, 1-7 STEP sources/Definition, 100 MiB and 600,000 triangles/Robot Definition, 128 unique non-Robot STEP Assets, 256 non-Robot Instances, 50 MiB and 250,000 triangles/Object STEP, 256 MiB referenced STEP bytes/Project, and 1.5M visible triangles.
- The 128-Asset count is prepared non-Robot STEP Geometry identity, not Object Instance count. Reusing the same digest with the same import convention reuses one prepared Asset.
- Generated Box and Cylinder Assets consume neither STEP count nor raw STEP bytes.
- Preserve current Object Group, inherited visibility, right-click, delete, reparent-with-World-pose, and local XYZRPY behavior. P1 locks at most 256 Scene Groups.
- Do not add Legacy Adoption, V3 migration, negative legacy occurrence paths, fixed `LINK00..LINK06` assumptions, or a compatibility switch.
- The proprietary MRb05 STEP remains untracked. This plan proves the general authoring path with redistributable fixtures; P8 owns the non-skippable MRb05 operator-confirmation and release gate.
- Gateway production code is TypeScript under `middleware/runtime-gateway` and compiles through `tsconfig.gateway.json`; do not add a new `.mjs` service path.
- P3 proves the Asset route through the development/E2E Vite proxy. P5 exclusively owns production Compose/Nginx cutover, resource limits, and `/runtime/*` proxy wiring.
- Keep source comments in English, preserve unrelated/untracked CAD folders, and stage only the files listed in each task.
- Every task ends with focused GREEN tests, `npm run lint`, the relevant browser/Gateway build, and one focused commit.

---

## File Structure

**Create:**

- `middleware/runtime-gateway/assets/asset-mount-config.ts` — deployment-only alias/root/write-policy parsing.
- `middleware/runtime-gateway/assets/asset-resolver.ts` — path confinement, digest, bounded resolve/register streams.
- `middleware/runtime-gateway/assets/asset-http-router.ts` — versioned import/resolve HTTP adapter.
- `src/features/assets/runtime-asset-client.ts` — browser upload/resolve transport.
- `src/features/assets/asset-resolution-repository.ts` — digest/convention keyed Geometry and unresolved-state cache.
- `src/features/assets/ResolvedAssetPlaceholder.tsx` — bounded missing/digest-mismatch Scene placeholder.
- `src/features/robot/assembly/robot-import-errors.ts` — stable authoring error codes and diagnostic details.
- `src/features/robot/assembly/robot-source-preflight.ts` — synchronous File/count/byte/name checks.
- `src/features/robot/assembly/robot-source-analysis.ts` — immutable occurrence tree and budgets.
- `src/features/robot/assembly/robot-assembly-worker-protocol.ts` — closed Worker messages.
- `src/features/robot/assembly/robot-assembly-analysis.worker.ts` — OCCT analysis Worker.
- `src/features/robot/assembly/RobotAssemblyAnalysisClient.ts` — sequential Worker owner, timeout, and cancellation.
- `src/features/robot/assembly/source-coordinate-convention.ts` — unit/orientation adapters.
- `src/features/robot/assembly/robot-link-mapping.ts` — explicit occurrence ownership/exclusion.
- `src/features/robot/assembly/robot-link-geometry.ts` — selected-Mesh conversion and budgets.
- `src/features/robot/assembly/robot-geometry-localization.ts` — Link-local Zero Pose reconstruction.
- `src/features/robot/assembly/robot-definition-draft.ts` — closed authoring draft and normalization.
- `src/features/robot/assembly/robot-joint-preview.ts` — per-Joint descendant exercise.
- `src/features/robot/assembly/robot-definition-authoring-service.ts` — Asset registration and one atomic V4 commit.
- `src/features/robot/assembly/robot-import-wizard-store.ts` — bounded draft state machine.
- `src/features/robot/assembly/RobotAssemblyWizard.tsx` — accessible staged authoring UI.
- `src/features/robot/assembly/RobotOccurrenceTree.tsx` — hierarchy/ownership editor.
- `src/features/robot/assembly/RobotAssemblyPreview.tsx` — isolated Geometry and Joint preview.
- `src/features/robot/assembly/RobotMechanicsEditorV4.tsx` — 1-16 Joint and Frame editor.
- Matching colocated `*.test.ts` and `*.test.tsx` files.
- `tests/fixtures/robots/generated-seven-link-assembly.step` — redistributable component-preserving STEP fixture.
- `tests/robot-asset-authoring.spec.ts` — production browser acceptance for P3.
- `docs/operator/robot-asset-authoring.md` — operator workflow and recovery guidance.

**Modify:**

- `middleware/runtime-gateway/main.ts`, `middleware/runtime-gateway/deployment-config.ts`, and their tests.
- `vite.config.ts` for the development/E2E `/runtime/assets/v1` proxy only.
- `src/lib/cad/occt-types.ts`.
- `src/features/import/detect-step-unit.ts`, `occt-to-three.ts`, `ImportStepDialog.tsx`, and their tests.
- `src/features/import/imported-geometry-repository.ts` and its tests.
- `src/features/robot/RobotImportDialog.tsx` and its tests.
- `src/features/scene/scene-command-service.ts`, `SceneExplorer.tsx`, `SceneContextMenu.tsx`, `SceneEntityInspector.tsx`, and their tests.
- `src/features/project/v4/browser-project-runtime-v4.ts` and its tests.
- `src/app/App.tsx`, `src/app/App.test.tsx`, `package.json`, `package-lock.json`, and `README.md`.

### Task 1: Add the Confined Runtime Gateway AssetResolver

**Files:**
- Create: `middleware/runtime-gateway/assets/asset-mount-config.ts`
- Test: `middleware/runtime-gateway/assets/asset-mount-config.test.ts`
- Create: `middleware/runtime-gateway/assets/asset-resolver.ts`
- Test: `middleware/runtime-gateway/assets/asset-resolver.test.ts`
- Create: `middleware/runtime-gateway/assets/asset-http-router.ts`
- Test: `middleware/runtime-gateway/assets/asset-http-router.test.ts`
- Modify: `middleware/runtime-gateway/deployment-config.ts`
- Modify: `middleware/runtime-gateway/deployment-config.test.ts`
- Modify: `middleware/runtime-gateway/main.ts`
- Modify: `vite.config.ts`

**Interfaces:**
- Consumes: `AssetReferenceV4`, `ProjectV4Error`, and the compiled Gateway scaffold from P1.
- Produces: `readAssetMountConfig`, `createAssetResolver`, `createAssetHttpRouter`, `ResolvedAssetV1`, and HTTP routes used by Task 2.

- [ ] **Step 1: Write RED mount and confinement tests**

```ts
// @vitest-environment node
it('maps deployment roots without exposing them in the logical URI', () => {
  const mounts = readAssetMountConfig({
    ROBOTSIM_ASSET_MOUNT_CELL_LIBRARY: 'D:\\CellAssets',
    ROBOTSIM_ASSET_MOUNT_PROJECT_ASSETS: 'D:\\RobotSimManaged',
  })
  expect(mounts).toEqual([
    { alias: 'cell-library', rootPath: 'D:\\CellAssets', writable: false },
    { alias: 'project-assets', rootPath: 'D:\\RobotSimManaged', writable: true },
  ])
})

it.each([
  'asset://cell-library/../secret.step',
  'asset://cell-library/%2e%2e/secret.step',
  'asset://unknown/robot.step',
])('rejects an escaping or unknown logical URI: %s', async (uri) => {
  await expect(resolver.resolve({ ...assetReference(), uri })).rejects.toMatchObject({
    code: 'ASSET_URI_REJECTED',
  })
})
```

Test canonical alias conversion from `ROBOTSIM_ASSET_MOUNT_LOCAL_SAMPLES` to `local-samples`, duplicate aliases, missing roots, read-only registration, Windows and POSIX separators, existing-file `realpath` confinement, symlink escape, declared byte mismatch, SHA-256 mismatch, cancellation, and temporary-file cleanup.

- [ ] **Step 2: Run RED**

```powershell
npm run test:run -- middleware/runtime-gateway/assets middleware/runtime-gateway/deployment-config.test.ts
```

Expected: FAIL because the Asset modules and deployment fields do not exist.

- [ ] **Step 3: Implement exact mount and resolver contracts**

```ts
export interface AssetMountDefinitionV1 {
  readonly alias: string
  readonly rootPath: string
  readonly writable: boolean
}

export interface ResolvedAssetV1 {
  readonly reference: AssetReferenceV4
  readonly absolutePath: string
  readonly byteLength: number
  openStream(): NodeJS.ReadableStream
}

export interface AssetResolverV1 {
  resolve(reference: AssetReferenceV4, signal?: AbortSignal): Promise<ResolvedAssetV1>
  register(request: {
    readonly purpose: 'robot' | 'object'
    readonly sourceFileName: string
    readonly expectedSha256: string
    readonly expectedByteLength: number
    readonly source: NodeJS.ReadableStream
  }, signal?: AbortSignal): Promise<AssetReferenceV4>
}

export function readAssetMountConfig(
  environment: Readonly<Record<string, string | undefined>>,
): readonly AssetMountDefinitionV1[]

export function createAssetResolver(options: {
  readonly mounts: readonly AssetMountDefinitionV1[]
  readonly createId: (sha256: string) => string
}): AssetResolverV1
```

Only `project-assets` is writable. Store managed sources at `<sha256>.step`, use `wx` temporary files in the same directory, hash while streaming, compare declared length/digest, and rename atomically. An identical existing digest is an idempotent success. Enforce 100 MiB for `robot` and 50 MiB for `object`; Project aggregate and triangle limits remain Core validation responsibilities.

- [ ] **Step 4: Implement the versioned HTTP adapter and deployment wiring**

```ts
export interface AssetHttpRouterV1 {
  handle(request: IncomingMessage, response: ServerResponse): Promise<boolean>
}

export function createAssetHttpRouter(options: {
  readonly resolver: AssetResolverV1
  readonly prefix: '/runtime/assets/v1'
}): AssetHttpRouterV1
```

Support `POST /runtime/assets/v1/import` with headers `x-asset-purpose`, `x-asset-file-name`, `x-asset-sha256`, and `content-length`; return the closed `AssetReferenceV4` JSON. Support `GET` and `HEAD /runtime/assets/v1/content?uri=<encoded>&sha256=<hex>`, revalidate the digest, and stream bytes without buffering the file. Return stable JSON codes and no absolute path. Add the router before OPC UA mode selection so Off mode still resolves Assets.

For development and P3 E2E only, proxy `/runtime/assets/v1` from Vite to `http://127.0.0.1:8081` without rewriting the path. Start the compiled Gateway beside Vite in Off mode and configure temporary local-samples/project-assets roots in the test process environment. Do not edit `compose.yaml` or `deploy/nginx.conf` here; P5 adds the read-only mount, writable managed volume, and narrowly scoped 101 MiB production upload limit after all Gateway modes exist.

- [ ] **Step 5: Run GREEN and commit**

```powershell
npm run test:run -- middleware/runtime-gateway/assets middleware/runtime-gateway/deployment-config.test.ts
npm run lint
npm run build:gateway
npm run build
git add middleware/runtime-gateway/assets middleware/runtime-gateway/main.ts middleware/runtime-gateway/deployment-config* vite.config.ts
git diff --cached --check
git commit -m "feat: add confined runtime asset resolver"
```

Expected: all focused tests PASS, both builds pass, and the Vite proxy reaches the bounded Gateway Asset routes in Off mode. Production mount and Nginx validation remains P5-owned.

### Task 2: Add Browser Asset Registration, Resolution, and Placeholders

**Files:**
- Create: `src/features/assets/runtime-asset-client.ts`
- Test: `src/features/assets/runtime-asset-client.test.ts`
- Create: `src/features/assets/asset-resolution-repository.ts`
- Test: `src/features/assets/asset-resolution-repository.test.ts`
- Create: `src/features/assets/ResolvedAssetPlaceholder.tsx`
- Test: `src/features/assets/ResolvedAssetPlaceholder.test.tsx`
- Modify: `src/features/import/imported-geometry-repository.ts`
- Modify: `src/features/import/imported-geometry-repository.test.ts`
- Modify: `src/features/project/v4/browser-project-runtime-v4.ts`
- Modify: `src/features/project/v4/browser-project-runtime-v4.test.ts`

**Interfaces:**
- Consumes: Task 1 HTTP routes, `AssetReferenceV4`, `SourceOrientationV4`, P1 hashing, and the P2 runtime publication boundary.
- Produces: `RuntimeAssetClientV1`, `AssetResolutionRepositoryV4`, `PreparedStepGeometryKeyV4`, and bounded placeholder read models.

- [ ] **Step 1: Write RED transport and repository tests**

```ts
it('registers a File and returns only a logical content-addressed reference', async () => {
  const result = await client.registerFile(file('fixture.step', bytes), 'object')
  expect(result).toEqual(expect.objectContaining({
    uri: `asset://project-assets/${SHA256}.step`,
    sha256: SHA256,
    byteLength: bytes.byteLength,
  }))
  expect(JSON.stringify(result)).not.toMatch(/[A-Z]:\\|\/srv\//)
})

it('keeps the Project open and publishes one unresolved placeholder', async () => {
  fetchMock.mockResolvedValue(response(404, { code: 'ASSET_NOT_FOUND' }))
  const result = await repository.resolve(reference(), convention())
  expect(result).toMatchObject({ state: 'unresolved', code: 'ASSET_NOT_FOUND' })
  expect(repository.get(reference().id)?.state).toBe('unresolved')
})
```

Cover abort, malformed responses, digest mismatch, no Gateway, session-local re-selection with matching and mismatching digest, two concurrent resolves sharing one Promise, cache-key convention differences, and exactly-once Geometry disposal.

- [ ] **Step 2: Run RED**

```powershell
npm run test:run -- src/features/assets src/features/import/imported-geometry-repository.test.ts src/features/project/v4/browser-project-runtime-v4.test.ts
```

Expected: FAIL because the browser Asset contracts are missing.

- [ ] **Step 3: Implement the browser client and cache identity**

```ts
export interface RuntimeAssetClientV1 {
  registerFile(
    file: File,
    purpose: 'robot' | 'object',
    signal?: AbortSignal,
  ): Promise<AssetReferenceV4>
  resolve(reference: AssetReferenceV4, signal?: AbortSignal): Promise<ArrayBuffer>
}

export interface PreparedStepGeometryKeyV4 {
  readonly sha256: string
  readonly sourceToMeters: number
  readonly orientation: SourceOrientationV4
  readonly originMode: 'source' | 'center'
}

export type AssetResolutionV4 =
  | { readonly state: 'ready'; readonly asset: ImportedThreeAsset }
  | { readonly state: 'unresolved'; readonly code: 'ASSET_NOT_FOUND' | 'ASSET_GATEWAY_UNAVAILABLE' }
  | { readonly state: 'digest-mismatch'; readonly code: 'ASSET_DIGEST_MISMATCH' }
```

Hash File chunks through the existing SHA-256 Worker, then send the File body to Task 1 without converting it to base64. Validate the returned closed reference and exact digest. Canonicalize the Geometry key through P1 canonical JSON; never key by filename or physical path.

- [ ] **Step 4: Integrate prepare/reselect/placeholder behavior**

`browser-project-runtime-v4.prepare()` resolves every visible referenced Asset before applying the candidate. Missing Assets create bounded placeholders and warnings while allowing Project publication; digest mismatch creates a placeholder and blocks the affected Geometry only. A session re-selection is an in-memory `AssetReferenceV4.id -> File` override accepted only after digest/length match and never written into the Project.

```tsx
export function ResolvedAssetPlaceholder(props: Readonly<{
  assetId: string
  label: string
  state: Exclude<AssetResolutionV4, { state: 'ready' }>
  boundsM?: readonly [number, number, number]
}>): JSX.Element
```

Use a maximum 0.25 m fallback cube when no stored bounds exist and render `UNRESOLVED` or `DIGEST MISMATCH` as both text and icon, not color alone.

- [ ] **Step 5: Run GREEN and commit**

```powershell
npm run test:run -- src/features/assets src/features/import/imported-geometry-repository.test.ts src/features/project/v4/browser-project-runtime-v4.test.ts
npm run lint
npm run build
git add src/features/assets src/features/import/imported-geometry-repository* src/features/project/v4/browser-project-runtime-v4*
git diff --cached --check
git commit -m "feat: resolve logical assets in the browser"
```

### Task 3: Analyze One Through Seven STEP Sources Without Inferring Mechanics

**Files:**
- Create: `src/features/robot/assembly/robot-import-errors.ts`
- Create: `src/features/robot/assembly/robot-source-preflight.ts`
- Test: `src/features/robot/assembly/robot-source-preflight.test.ts`
- Create: `src/features/robot/assembly/robot-source-analysis.ts`
- Test: `src/features/robot/assembly/robot-source-analysis.test.ts`
- Create: `src/features/robot/assembly/robot-assembly-worker-protocol.ts`
- Test: `src/features/robot/assembly/robot-assembly-worker-protocol.test.ts`
- Create: `src/features/robot/assembly/robot-assembly-analysis.worker.ts`
- Create: `src/features/robot/assembly/RobotAssemblyAnalysisClient.ts`
- Test: `src/features/robot/assembly/RobotAssemblyAnalysisClient.test.ts`
- Modify: `src/lib/cad/occt-types.ts`
- Modify: `src/features/import/detect-step-unit.ts`
- Modify: `src/features/import/detect-step-unit.test.ts`

**Interfaces:**
- Consumes: `STEP_IMPORT_OPTIONS`, `ProjectHashService`, P1 limits, and Task 2 Asset resolution.
- Produces: stable authoring errors, `RobotSourceAnalysisV4`, `RobotPartOccurrenceV4`, and one sequential/cancellable analysis client.

- [ ] **Step 1: Write RED synchronous preflight tests**

```ts
it.each([1, 7])('accepts %i selected Robot STEP source(s)', (count) => {
  expect(() => preflightRobotSourceSelection(files(count))).not.toThrow()
})

it.each([0, 8])('rejects %i before reading or hashing', (count) => {
  const inputs = files(count, { arrayBuffer: vi.fn() })
  expect(() => preflightRobotSourceSelection(inputs)).toThrow('ROBOT_STEP_SOURCE_COUNT')
  expect(inputs.every((file) => file.arrayBuffer.mock.calls.length === 0)).toBe(true)
})
```

Assert case-insensitive `.step`/`.stp`, 255 UTF-8 filename bytes pass and 256 fail, zero-byte input, 100 MiB Definition total, count before duplicate collapse, and no File read/Worker construction for rejected input.

- [ ] **Step 2: Write RED hierarchy, budget, timeout, and cancellation tests**

```ts
it('preserves stable non-negative occurrence paths and never creates Joints', async () => {
  const analysis = await client.analyzeSources([source('assembly.step')])
  expect(analysis[0].occurrences.map((part) => part.nodePath)).toEqual([[0, 0], [0, 1]])
  expect(JSON.stringify(analysis)).not.toMatch(/joint|axis|origin/i)
})

it('terminates at 60 seconds and ignores a late Worker reply', async () => {
  const pending = client.analyzeSources([source('slow.step')])
  await vi.advanceTimersByTimeAsync(60_000)
  await expect(pending).rejects.toMatchObject({ code: 'ROBOT_STEP_PARSE_TIMEOUT' })
  worker.reply(successfulAnalysis())
  expect(onResult).not.toHaveBeenCalled()
})
```

Cover one Worker at a time, malformed messages, `error`, `messageerror`, exact Mesh/node/depth/typed-array/triangle boundaries, duplicate digest collapse with one parse, repeated names retaining distinct paths, unnamed nodes, corrupt/fused/unresolved-external/tessellated-only fixtures, and Cancel visible within 250 ms.

- [ ] **Step 3: Run RED**

```powershell
npm run test:run -- src/features/robot/assembly/robot-source-preflight.test.ts src/features/robot/assembly/robot-source-analysis.test.ts src/features/robot/assembly/robot-assembly-worker-protocol.test.ts src/features/robot/assembly/RobotAssemblyAnalysisClient.test.ts
```

Expected: FAIL because the analysis modules do not exist.

- [ ] **Step 4: Implement closed analysis contracts**

```ts
export class RobotImportError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly details: Readonly<Record<string, string | number | boolean>> = {},
  ) { super(`${code}: ${message}`) }
}

export interface RobotPartOccurrenceV4 {
  readonly key: string
  readonly assetReferenceId: string
  readonly nodePath: readonly number[]
  readonly nodeName: string
  readonly meshIndices: readonly number[]
  readonly statistics: GeometryStatisticsV4
}

export interface RobotSourceAnalysisV4 {
  readonly assetReference: AssetReferenceV4
  readonly detectedUnit: 'millimeter' | 'meter' | 'inch' | 'unknown'
  readonly root: RobotOccurrenceNodeV4
  readonly occurrences: readonly RobotPartOccurrenceV4[]
  readonly statistics: GeometryStatisticsV4
  readonly transientMeshes: readonly OcctMesh[]
}

export interface RobotAssemblyAnalysisClientV4 {
  analyzeSources(
    sources: readonly RobotAnalysisSourceV4[],
    signal?: AbortSignal,
  ): Promise<readonly RobotSourceAnalysisV4[]>
  cancel(): void
  dispose(): void
}
```

Worker input carries one source at a time and uses the checked-in options exactly. Convert OCCT `root.children` ordinals into immutable non-negative paths, stable-sort only diagnostic occurrence lists, preserve Mesh indices, and treat Mesh coordinates as source Zero Pose Geometry. Never emit a Link or Joint suggestion.

- [ ] **Step 5: Run GREEN and commit**

```powershell
npm run test:run -- src/features/import/detect-step-unit.test.ts src/features/robot/assembly/robot-source-preflight.test.ts src/features/robot/assembly/robot-source-analysis.test.ts src/features/robot/assembly/robot-assembly-worker-protocol.test.ts src/features/robot/assembly/RobotAssemblyAnalysisClient.test.ts
npm run lint
npm run build
git add src/lib/cad/occt-types.ts src/features/import/detect-step-unit* src/features/robot/assembly/robot-import-errors.ts src/features/robot/assembly/robot-source-* src/features/robot/assembly/robot-assembly-* src/features/robot/assembly/RobotAssemblyAnalysisClient*
git diff --cached --check
git commit -m "feat: analyze robot assembly sources"
```

### Task 4: Map Occurrences, Normalize Source Coordinates, and Localize Links

**Files:**
- Create: `src/features/robot/assembly/source-coordinate-convention.ts`
- Test: `src/features/robot/assembly/source-coordinate-convention.test.ts`
- Create: `src/features/robot/assembly/robot-link-mapping.ts`
- Test: `src/features/robot/assembly/robot-link-mapping.test.ts`
- Create: `src/features/robot/assembly/robot-link-geometry.ts`
- Test: `src/features/robot/assembly/robot-link-geometry.test.ts`
- Create: `src/features/robot/assembly/robot-geometry-localization.ts`
- Test: `src/features/robot/assembly/robot-geometry-localization.test.ts`
- Modify: `src/features/import/occt-to-three.ts`
- Modify: `src/features/import/occt-to-three.test.ts`

**Interfaces:**
- Consumes: Task 3 analyses, P1 `SourceOrientationV4`/transform math, and P2 generic Link/Joint FK.
- Produces: confirmed occurrence ownership, source-to-domain transforms, per-Link prepared Geometry, collision proxies, and Zero Pose proof.

- [ ] **Step 1: Write RED source-convention and ownership tests**

```ts
it('rejects simultaneous Up-Axis and custom root corrections', () => {
  expect(() => normalizeSourceConvention({
    sourceToMeters: 0.001,
    orientation: { mode: 'up-axis', upAxis: 'y' },
    customRootQuaternion: [Math.SQRT1_2, 0, 0, Math.SQRT1_2],
  })).toThrow('ROBOT_SOURCE_ORIENTATION_CONFLICT')
})

it('requires every Mesh occurrence to have one owner or explicit exclusion', () => {
  expect(() => validateConfirmedRobotLinkMapping(mappingWithUnassignedMesh(), analysis()))
    .toThrow('ROBOT_LINK_MAPPING_INCOMPLETE')
  expect(() => validateConfirmedRobotLinkMapping(mappingWithDuplicateOwner(), analysis()))
    .toThrow('ROBOT_LINK_PART_CONFLICT')
})
```

Assert 2/17 Links pass and 1/18 fail, a moving Robot with one fused occurrence fails `ROBOT_STEP_FUSED_BODY`, every operator confirmation is true, excluded hardware is explicit, and names never change the result.

- [ ] **Step 2: Write RED localization and subset-conversion tests**

```ts
it('reconstructs every included source Zero Pose vertex within 0.5 mm', () => {
  const localized = localizeRobotLinkOccurrences(confirmedDraft())
  expect(maximumReconstructionErrorM(localized)).toBeLessThanOrEqual(0.0005)
})

it('does not mutate or share disposable selected Geometry', () => {
  const first = extractMappedLinkGeometry(result(), linkA())
  const second = extractMappedLinkGeometry(result(), linkB())
  first.dispose()
  expect(second.group.children).toHaveLength(1)
})
```

Cover nested rotation/translation, Y-up normalization, custom quaternion normalization, source scaling once, matrix tolerance `1e-6`, per-Link selected Mesh/material/triangle budgets, and excluded hardware omitted from reconstruction.

- [ ] **Step 3: Run RED**

```powershell
npm run test:run -- src/features/robot/assembly/source-coordinate-convention.test.ts src/features/robot/assembly/robot-link-mapping.test.ts src/features/robot/assembly/robot-link-geometry.test.ts src/features/robot/assembly/robot-geometry-localization.test.ts src/features/import/occt-to-three.test.ts
```

Expected: FAIL because mapping/localization APIs are missing.

- [ ] **Step 4: Implement the closed confirmed mapping and conversion adapters**

```ts
export interface ConfirmedRobotLinkMappingV4 {
  readonly links: readonly {
    readonly linkId: string
    readonly occurrenceKeys: readonly string[]
    readonly confirmed: true
  }[]
  readonly excludedOccurrenceKeys: readonly string[]
  readonly exclusionsConfirmed: true
}

export interface PreparedRobotLinkGeometryV4 {
  readonly linkId: string
  readonly occurrenceKeys: readonly string[]
  readonly linkLocalTransforms: Readonly<Record<string, RigidTransformV4>>
  readonly geometry: ImportedThreeAsset
  readonly collisionBoxes: readonly CollisionBoxV4[]
  readonly statistics: GeometryStatisticsV4
}

export function sourceConventionTransformV4(
  convention: SourceConventionDraftV4,
): RigidTransformV4
export function validateConfirmedRobotLinkMapping(
  mapping: ConfirmedRobotLinkMappingV4,
  analyses: readonly RobotSourceAnalysisV4[],
): ConfirmedRobotLinkMappingV4
export function extractMappedLinkGeometry(
  analyses: readonly RobotSourceAnalysisV4[],
  mapping: ConfirmedRobotLinkMappingV4,
): readonly PreparedRobotLinkGeometryV4[]
```

Add an explicit selected-Mesh API to `occt-to-three.ts`; clone index/attribute arrays before transformation, never remove Meshes from the shared analysis, and dispose partial outputs on failure.

- [ ] **Step 5: Run GREEN and commit**

```powershell
npm run test:run -- src/features/robot/assembly/source-coordinate-convention.test.ts src/features/robot/assembly/robot-link-mapping.test.ts src/features/robot/assembly/robot-link-geometry.test.ts src/features/robot/assembly/robot-geometry-localization.test.ts src/features/import/occt-to-three.test.ts
npm run lint
npm run build
git add src/features/robot/assembly/source-coordinate-convention* src/features/robot/assembly/robot-link-* src/features/robot/assembly/robot-geometry-localization* src/features/import/occt-to-three*
git diff --cached --check
git commit -m "feat: map assembly occurrences to robot links"
```

### Task 5: Validate Variable Mechanics and Commit One Definition Plus Instance

**Files:**
- Create: `src/features/robot/assembly/robot-definition-draft.ts`
- Test: `src/features/robot/assembly/robot-definition-draft.test.ts`
- Create: `src/features/robot/assembly/robot-joint-preview.ts`
- Test: `src/features/robot/assembly/robot-joint-preview.test.ts`
- Create: `src/features/robot/assembly/robot-definition-authoring-service.ts`
- Test: `src/features/robot/assembly/robot-definition-authoring-service.test.ts`
- Modify: `src/features/project/v4/browser-project-runtime-v4.ts`
- Modify: `src/features/project/v4/browser-project-runtime-v4.test.ts`

**Interfaces:**
- Consumes: Task 2 Asset client/repository, Task 4 confirmed/localized Geometry, P1 V4 validators and `PublishedProjectBundleV4`, and P2 `ProjectMutationServiceV4` plus the generic FK/runtime registry.
- Produces: a closed Robot Definition draft, per-Joint descendant proof, and one cancellable atomic authoring service.

- [ ] **Step 1: Write RED Mechanics and preview tests**

```ts
it.each([1, 16])('accepts a connected serial chain with %i Joint(s)', (jointCount) => {
  expect(() => normalizeRobotDefinitionDraftV4(serialDraft(jointCount))).not.toThrow()
})

it.each([0, 17])('rejects %i Joints', (jointCount) => {
  expect(() => normalizeRobotDefinitionDraftV4(serialDraft(jointCount)))
    .toThrow('ROBOT_JOINT_LIMIT_EXCEEDED')
})

it('moves only the selected Joint child subtree', () => {
  const proof = exerciseRobotJointV4(definition(), 'J3', 5)
  expect(proof.movedLinkIds).toEqual(['link-3', 'link-4', 'link-5', 'link-6'])
  expect(proof.ancestorLinkIdsMoved).toEqual([])
})
```

Test revolute degrees/degree-per-second, prismatic metres/metres-per-second, complete Joint origin transforms, normalized axes, min/max/Home, direction, zero offset, strictly positive maximum velocity, connected serial ownership, Base/Flange/Tool0/Tool/TCP/Gripper Frames, and duplicate/missing IDs.

- [ ] **Step 2: Write RED transaction and failure-injection tests**

```ts
it('publishes Asset references, one Definition, and one Instance atomically', async () => {
  const result = await service.commitDefinitionAndInstance(confirmedImport())
  expect(result).toEqual({ definitionId: 'definition-mrb', robotId: 'robot-mrb' })
  expect(mutation.replaceFromActive).toHaveBeenCalledTimes(1)
  expect(published().robotDefinitions).toHaveLength(1)
  expect(published().robots[0].definitionId).toBe('definition-mrb')
})

it('keeps the old revision when Geometry preparation fails', async () => {
  assetRepository.prepare.mockRejectedValue(new Error('parse failed'))
  await expect(service.commitDefinitionAndInstance(confirmedImport())).rejects.toThrow('parse failed')
  expect(mutation.replaceFromActive).not.toHaveBeenCalled()
  expect(readPublished()).toEqual(before)
})
```

Inject upload, resolve, checksum, mapping, Geometry, Job-limit reconciliation, queued budget recheck, runtime prepare, publication, and cleanup failures. Prove no mixed revision/runtime; a content-addressed upload left without a Project reference is harmless and reusable; Cancel returns true only before the mutation boundary.

- [ ] **Step 3: Run RED**

```powershell
npm run test:run -- src/features/robot/assembly/robot-definition-draft.test.ts src/features/robot/assembly/robot-joint-preview.test.ts src/features/robot/assembly/robot-definition-authoring-service.test.ts src/features/project/v4/browser-project-runtime-v4.test.ts
```

Expected: FAIL because the authoring service is missing.

- [ ] **Step 4: Implement exact authoring contracts**

```ts
export interface ConfirmedRobotImportV4 {
  readonly definitionId: string
  readonly robotId: string
  readonly robotName: string
  readonly sources: readonly ConfirmedRobotSourceV4[]
  readonly mapping: ConfirmedRobotLinkMappingV4
  readonly definitionDraft: RobotDefinitionDraftV4
  readonly instanceBaseParentFrameId: string
  readonly instanceLocalBasePose: RigidTransformV4
}

export interface RobotDefinitionAuthoringServiceV4 {
  commitDefinitionAndInstance(
    input: ConfirmedRobotImportV4,
  ): Promise<{ readonly definitionId: string; readonly robotId: string }>
  updateDefinition(
    definitionId: string,
    draft: RobotDefinitionDraftV4,
  ): Promise<void>
  cancel(): boolean
}
```

For selected Files, register each digest idempotently through Task 2; for an existing mounted `AssetReferenceV4`, resolve and verify without uploading. Reuse an existing Project Asset reference with the same digest/length. Prepare all Definition Geometry before entering the mutation. Inside one queued recipe, revalidate current counts, Definition/Instance IDs, visible triangles, Job poses, and references, then add or replace the complete aggregate. Key prepared Geometry by `(definitionId, linkId)` and source cache by digest/convention so Instances sharing one Definition reuse materials/Geometry while retaining independent Joint state.

- [ ] **Step 5: Run GREEN and commit**

```powershell
npm run test:run -- src/features/robot/assembly/robot-definition-draft.test.ts src/features/robot/assembly/robot-joint-preview.test.ts src/features/robot/assembly/robot-definition-authoring-service.test.ts src/features/project/v4/browser-project-runtime-v4.test.ts
npm run lint
npm run build
git add src/features/robot/assembly/robot-definition-* src/features/robot/assembly/robot-joint-preview* src/features/project/v4/browser-project-runtime-v4*
git diff --cached --check
git commit -m "feat: commit authored robot definitions"
```

### Task 6: Replace the Fixed Robot Dialog With the Bounded Assembly Wizard

**Files:**
- Create: `src/features/robot/assembly/robot-import-wizard-store.ts`
- Test: `src/features/robot/assembly/robot-import-wizard-store.test.ts`
- Create: `src/features/robot/assembly/RobotAssemblyWizard.tsx`
- Test: `src/features/robot/assembly/RobotAssemblyWizard.test.tsx`
- Create: `src/features/robot/assembly/RobotOccurrenceTree.tsx`
- Test: `src/features/robot/assembly/RobotOccurrenceTree.test.tsx`
- Create: `src/features/robot/assembly/RobotAssemblyPreview.tsx`
- Create: `src/features/robot/assembly/RobotMechanicsEditorV4.tsx`
- Test: `src/features/robot/assembly/RobotMechanicsEditorV4.test.tsx`
- Create: `src/features/robot/assembly/RobotAssemblyWizard.css`
- Modify: `src/features/robot/RobotImportDialog.tsx`
- Modify: `src/features/robot/RobotImportDialog.test.tsx`
- Modify: `src/app/App.tsx`
- Modify: `src/app/App.test.tsx`

**Interfaces:**
- Consumes: Tasks 3-5 and the P2 selected-Robot/Scene command ports.
- Produces: an accessible eight-stage controlled Wizard and production `Import Robot` integration.

- [ ] **Step 1: Write RED state-machine and interaction tests**

```tsx
await user.upload(screen.getByLabelText('Robot STEP sources'), oneAssemblyFile())
await screen.findByRole('tree', { name: 'STEP occurrence hierarchy' })
expect(screen.getByRole('button', { name: 'Continue to Links' })).toBeDisabled()
await user.selectOptions(screen.getByLabelText('Occurrence LOWER_LINK_ASSY owner'), 'link-2')
await user.click(screen.getByRole('checkbox', { name: 'Confirm occurrence ownership' }))
expect(screen.getByRole('button', { name: 'Continue to Links' })).toBeEnabled()
```

Test stage order, unknown unit confirmation, Up-Axis/custom-rotation exclusivity, every inclusion/exclusion, dynamic add/remove Links and Joints, full Mechanics fields, per-Joint exercise, Zero Pose proof, Frames/collision review, exact resource summary, double submit, cancellation before/after commit boundary, focus restoration, keyboard tree operation, error summary links, `aria-busy`, and bounded internal scrolling.

- [ ] **Step 2: Run RED**

```powershell
npm run test:run -- src/features/robot/assembly/robot-import-wizard-store.test.ts src/features/robot/assembly/RobotOccurrenceTree.test.tsx src/features/robot/assembly/RobotMechanicsEditorV4.test.tsx src/features/robot/assembly/RobotAssemblyWizard.test.tsx src/features/robot/RobotImportDialog.test.tsx src/app/App.test.tsx
```

Expected: FAIL because the Wizard components are missing.

- [ ] **Step 3: Implement the bounded Wizard state and props**

```ts
export type RobotImportWizardStageV4 =
  | 'sources'
  | 'source-convention'
  | 'occurrences'
  | 'links'
  | 'mechanics'
  | 'zero-pose'
  | 'frames-collision'
  | 'review'

export interface RobotAssemblyWizardProps {
  readonly open: boolean
  readonly analysisClient: RobotAssemblyAnalysisClientV4
  readonly assetClient: RuntimeAssetClientV1
  readonly authoringService: RobotDefinitionAuthoringServiceV4
  readonly onCommitted: (result: { definitionId: string; robotId: string }) => void
  readonly onClose: () => void
}
```

Keep transient bytes/Meshes outside Zustand persistence. The state machine owns one operation generation and `editing | committing | failed | complete` lifecycle. Cancel terminates analysis and disposes transient Geometry before the mutation boundary; after the boundary it is disabled. A repeated submit returns the same pending Promise.

- [ ] **Step 4: Implement the production composition**

`RobotImportDialog` becomes a thin wrapper around `RobotAssemblyWizard`; remove copy that says seven STEP files are required. Reuse AppShell's existing `Import Robot` command. After commit, select `robot:<robotId>` and focus its Inspector. Do not add a second toolbar button or expose the removed fixed importer.

- [ ] **Step 5: Run GREEN and commit**

```powershell
npm run test:run -- src/features/robot/assembly src/features/robot/RobotImportDialog.test.tsx src/app/App.test.tsx
npm run lint
npm run build
git add src/features/robot/assembly/robot-import-wizard-store* src/features/robot/assembly/RobotAssemblyWizard* src/features/robot/assembly/RobotOccurrenceTree* src/features/robot/assembly/RobotAssemblyPreview.tsx src/features/robot/assembly/RobotMechanicsEditorV4* src/features/robot/RobotImportDialog* src/app/App*
git diff --cached --check
git commit -m "feat: add robot assembly authoring wizard"
```

### Task 7: Convert Object STEP Import and Scene Group Commands to Logical V4 Assets

**Files:**
- Modify: `src/features/import/ImportStepDialog.tsx`
- Modify: `src/features/import/ImportStepDialog.test.tsx`
- Modify: `src/features/scene/scene-command-service.ts`
- Modify: `src/features/scene/scene-command-service.test.ts`
- Modify: `src/features/scene/SceneExplorer.tsx`
- Modify: `src/features/scene/SceneExplorer.test.tsx`
- Modify: `src/features/scene/SceneContextMenu.tsx`
- Modify: `src/features/scene/SceneContextMenu.test.tsx`
- Modify: `src/features/scene/SceneEntityInspector.tsx`
- Modify: `src/features/scene/SceneEntityInspector.test.tsx`
- Modify: `src/features/scene/scene-runtime-selector.ts`
- Modify: `src/features/scene/scene-runtime-selector.test.ts`
- Modify: `src/app/App.tsx`
- Modify: `src/app/App.test.tsx`
- Modify: `tests/reusable-scene-editor.spec.ts`
- Modify: `tests/project-resource-performance.spec.ts`

**Interfaces:**
- Consumes: Tasks 1-2 Asset APIs, P1 limits, P2 V4 Scene commands, and current interaction patterns.
- Produces: one-STEP-per-Object import, 128/256 enforcement, reusable prepared Assets, and preserved Group/hide/RPY workflows.

- [ ] **Step 1: Write RED Object Asset boundary and identity tests**

```ts
it('accepts the 128th unique STEP Asset and rejects the 129th before hashing or upload', async () => {
  const atLimitMinusOne = projectWithStepAssets(127)
  await expect(commands(atLimitMinusOne).importStepObject(input(128))).resolves.toBe('object:128')
  const hash = vi.fn()
  const upload = vi.fn()
  await expect(commands(projectWithStepAssets(128), { hash, upload }).importStepObject(input(129)))
    .rejects.toThrow('OBJECT_STEP_ASSET_LIMIT_EXCEEDED')
  expect(hash).not.toHaveBeenCalled()
  expect(upload).not.toHaveBeenCalled()
})

it('reuses an exact digest and convention while creating a second Instance', async () => {
  await commands.importStepObject(firstInput())
  await commands.importStepObject(secondInputWithSameGeometry())
  expect(readProject().assetReferences).toHaveLength(1)
  expect(readProject().spatialEntities).toHaveLength(2)
})
```

Test 256/257 Instances, one File per imported Object, 50 MiB/triangle boundaries, creation/deletion of Box and Cylinder primitives, primitive STEP-count/raw-byte exclusion, differing orientation producing a different prepared Geometry identity, and current-state recheck inside the queued mutation.

- [ ] **Step 2: Write RED Group, visibility, delete, and RPY regression tests**

```tsx
await user.click(screen.getByRole('button', { name: 'Hide Fixture Group' }))
expect(objectChild()).toHaveAttribute('data-effective-visible', 'false')
await user.click(screen.getByRole('button', { name: 'Show Fixture Group' }))
expect(worldPose('object:cup')).toEqual(beforeGroupWorldPose)

await user.clear(screen.getByLabelText('Roll (deg)'))
await user.type(screen.getByLabelText('Roll (deg)'), '90')
await user.click(screen.getByRole('button', { name: 'Apply Transform' }))
expect(readEntity('object:cup').localPose.quaternion).toEqualQuaternion(
  rpyDegreesToQuaternionV4([90, 0, 0]),
)
```

Cover create Group, move to Group, ungroup, delete Group/contents confirmation, inherited hide, isolate/show-all, right-click matrices, removal of Object Instance, retained Asset while referenced, and removal of unreferenced prepared cache entries without deleting physical managed content.

- [ ] **Step 3: Run RED**

```powershell
npm run test:run -- src/features/import/ImportStepDialog.test.tsx src/features/scene/scene-command-service.test.ts src/features/scene/SceneExplorer.test.tsx src/features/scene/SceneContextMenu.test.tsx src/features/scene/SceneEntityInspector.test.tsx src/features/scene/scene-runtime-selector.test.ts
```

Expected: FAIL on V3 embedded bytes, the old 64-Asset limit, or missing V4 commands.

- [ ] **Step 4: Implement the V4 Object command boundary**

```ts
export interface ImportStepObjectCommandV4 {
  readonly assetReference: AssetReferenceV4
  readonly importConvention: StepGeometryImportConventionV4
  readonly entity: SpatialEntityV4
}

export interface SceneCommandServiceV4 {
  importStepObject(command: ImportStepObjectCommandV4): Promise<string>
  createBox(input: CreateBoxObjectInputV4): Promise<string>
  createCylinder(input: CreateCylinderObjectInputV4): Promise<string>
  createGroup(name: string): Promise<string>
  setVisible(entityId: string, visible: boolean): Promise<void>
  setLocalPose(entityId: string, pose: RigidTransformV4): Promise<void>
  reparent(entityId: string, groupId: string | null): Promise<void>
  ungroup(groupId: string): Promise<void>
  deleteGroupAndContents(groupId: string, confirmed: true): Promise<void>
  deleteEntity(entityId: string): Promise<void>
}
```

`ImportStepDialog` preflights current capacity, analyzes one STEP, requires unit/source orientation, registers the File, then commits one reference/Geometry definition/Spatial Entity recipe. Adapt the existing `createBox` and `createCylinder` commands to create V4 primitive `SpatialEntityV4` records without an `AssetReferenceV4`; retain their current Add menu and context-menu entries. Object local XYZRPY remains editable through `SceneEntityInspector`; source orientation is a separate Asset field and must not be changed by Scene placement controls.

- [ ] **Step 5: Run GREEN and commit**

```powershell
npm run test:run -- src/features/import src/features/scene src/app/App.test.tsx
npm run test:e2e -- tests/reusable-scene-editor.spec.ts
npm run lint
npm run build
git add src/features/import/ImportStepDialog* src/features/scene src/app/App* tests/reusable-scene-editor.spec.ts tests/project-resource-performance.spec.ts
git diff --cached --check
git commit -m "feat: author logical object assets and groups"
```

### Task 8: Prove the P3 Authoring Gate With Redistributable Fixtures

**Files:**
- Create: `tests/fixtures/robots/generated-seven-link-assembly.step`
- Create: `src/features/robot/assembly/robot-authoring-fixtures.test.ts`
- Create: `tests/robot-asset-authoring.spec.ts`
- Create: `docs/operator/robot-asset-authoring.md`
- Modify: `README.md`
- Modify: `package.json`
- Modify: `package-lock.json`

**Interfaces:**
- Consumes: Tasks 1-7 public APIs.
- Produces: a green P3 gate, operator documentation, and the exact handoff consumed by P4/P8.

- [ ] **Step 1: Add RED fixture and round-trip tests**

```ts
it('authors one component-preserving STEP into seven confirmed Links and six Joints', async () => {
  const result = await authorGeneratedFixture({
    sourcePath: 'tests/fixtures/robots/generated-seven-link-assembly.step',
    mapping: confirmedGeneratedMapping(),
    mechanics: generatedSixJointMechanics(),
  })
  expect(result.project.robotDefinitions[0]).toMatchObject({
    assetReferenceIds: [result.project.assetReferences[0].id],
    links: expect.arrayContaining([expect.objectContaining({ id: 'link-0' })]),
    joints: expect.arrayContaining([expect.objectContaining({ id: 'J6' })]),
  })
  expect(await jsonRoundTrip(result.project)).toEqual(result.project)
})
```

The redistributable fixture contains seven named rigid solids in one self-contained AP214 Assembly. The test mapping is explicit test data, not name inference. Add fused, corrupt, and unmapped synthetic cases with zero active mutation.

- [ ] **Step 2: Write the production browser P3 acceptance**

Use `test.step` to import the generated one-source Assembly, choose its explicit unit and Up Axis, assign seven occurrences, confirm exclusions, enter six Joint records, exercise J1-J6, commit, create a second Instance sharing the Definition, import/group/hide/rotate/delete one Object, save/reload, and assert one Robot source reference plus independent Instance state.

```ts
await expect(page.getByTestId('robot-definition-count')).toHaveText('1')
await expect(page.getByTestId('robot-instance-count')).toHaveText('2')
await expect(page.getByTestId('resolved-asset-count')).toHaveText('1')
```

- [ ] **Step 3: Run RED**

```powershell
npm run test:run -- src/features/robot/assembly/robot-authoring-fixtures.test.ts
npm run test:e2e -- tests/robot-asset-authoring.spec.ts
```

Expected: FAIL until the fixture, browser wiring, and diagnostics exist.

- [ ] **Step 4: Add exact operator documentation and scripts**

Add package script:

```json
{
  "test:p3-authoring": "vitest run src/features/robot/assembly && playwright test tests/robot-asset-authoring.spec.ts"
}
```

Document File versus mounted URI flows, unit/orientation distinction, explicit ownership/exclusion, variable Mechanics, Zero Pose/Joint preview, logical URI portability, `UNRESOLVED`/digest recovery, Object limits, Group commands, and the fact that MRb05 mapping and Mechanics are not supplied by P3.

- [ ] **Step 5: Run the complete P3 gate and commit**

```powershell
npm run test:p3-authoring
npm run test:middleware
npm run lint
npm run build:gateway
npm run build
git status --short
git add tests/fixtures/robots/generated-seven-link-assembly.step src/features/robot/assembly/robot-authoring-fixtures.test.ts tests/robot-asset-authoring.spec.ts docs/operator/robot-asset-authoring.md README.md package.json package-lock.json
git diff --cached --check
git commit -m "test: prove robot and asset authoring"
```

Expected: every command exits 0; no MRb05 or other proprietary CAD is staged; P3 is ready for the Runtime Gateway transport workstreams.

## Self-Review

- **Spec coverage:** Tasks 1-2 cover logical URI mounting, Off-mode resolution, managed import, digest verification, unresolved placeholders, and no physical paths. Tasks 3-6 cover one-to-seven-source hierarchy analysis, explicit occurrence ownership, source convention, variable Mechanics, Joint preview, atomic Definition/Instance authoring, and the bounded Wizard. Task 7 covers the 128/256 Object boundaries and existing Group/hide/RPY workflows. Task 8 proves browser and Project round trips without proprietary CAD.
- **No inference audit:** No interface accepts a suggested Link or Joint as confirmed. Every ownership record contains `confirmed: true`; Mechanics and source orientation are entered explicitly. MRb05 semantic confirmation is reserved for P8.
- **Type consistency:** `AssetReferenceV4`, `SourceOrientationV4`, `RigidTransformV4`, and `PublishedProjectBundleV4` come only from P1; `ProjectMutationServiceV4` comes only from P2. P3 owns `RobotSourceAnalysisV4`, `ConfirmedRobotLinkMappingV4`, `RobotDefinitionDraftV4`, and `RuntimeAssetClientV1` exactly once.
- **Resource audit:** The plan covers all exact and plus-one Asset, Instance, Robot source, Definition byte/triangle, Project byte, visible triangle, and Group limits.
- **Placeholder scan:** Run `rg -n "T[B]D|T[O]DO|F[I]XME|f[i]ll in|impl[e]ment later|appropr[i]ate error handling|sim[i]lar to Task" docs/superpowers/plans/2026-07-16-robot-asset-authoring.md`; expect exit code 1.
