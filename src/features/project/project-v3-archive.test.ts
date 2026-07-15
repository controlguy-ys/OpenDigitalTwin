import { unzipSync, zipSync } from 'fflate'
import { afterEach, describe, expect, it, vi } from 'vitest'
import menuSource from './ProjectMenu.tsx?raw'
import codecSource from './project-codec.ts?raw'
import workerSource from './project-archive-worker.ts?raw'
import archiveSource from './project-v3-archive.ts?raw'
import { CRB15000_DEFINITION, type RobotLinkId } from '../../domain/robot/crb15000'
import {
  canonicalMechanicsBytesV3,
  createProjectSourceStagingService,
  deriveCanonicalPoseDurationMsV3,
  type ProjectRigidTransformV3,
  type WorkcellProjectSnapshotV3,
} from '../../domain/project/project-v3'
import {
  createProjectHashService,
  createProjectRevisionIdentityHasher,
  createProjectSourceDigest,
} from '../../lib/hash/sha256'
import {
  createProjectArchiveWorkerSession,
  type ProjectArchiveWorkerLike,
  type ProjectArchiveWorkerRequest,
  type ProjectArchiveWorkerResponse,
} from './project-archive-worker'
import {
  decodeWorkcellProject,
  encodeWorkcellProject,
  revokeProjectDecodeResult,
} from './project-codec'

const LINK_IDS = [
  'LINK00', 'LINK01', 'LINK02', 'LINK03', 'LINK04', 'LINK05', 'LINK06',
] as const satisfies readonly RobotLinkId[]
const IDENTITY = {
  position: [0, 0, 0],
  quaternion: [0, 0, 0, 1],
  scale: [1, 1, 1],
} as const satisfies ProjectRigidTransformV3
const ASSEMBLY_BYTES = new TextEncoder().encode('one assembly STEP source')
const OBJECT_BYTES = new TextEncoder().encode('one semantic Object STEP source')

function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer), (byte) =>
    byte.toString(16).padStart(2, '0')).join('')
}

async function digest(bytes: ArrayBuffer | ArrayBufferView): Promise<string> {
  return toHex(await crypto.subtle.digest('SHA-256', bytes as BufferSource))
}

class SessionWorker implements ProjectArchiveWorkerLike {
  onmessage: ((event: MessageEvent<ProjectArchiveWorkerResponse>) => void) | null = null
  onerror: ((event: ErrorEvent) => void) | null = null
  onmessageerror: ((event: MessageEvent<unknown>) => void) | null = null
  private readonly session = createProjectArchiveWorkerSession((response, transfer = []) => {
    const owned = structuredClone(response, { transfer })
    queueMicrotask(() => this.onmessage?.({ data: owned } as MessageEvent<ProjectArchiveWorkerResponse>))
  })
  private terminated = false

  postMessage(message: ProjectArchiveWorkerRequest, transfer: Transferable[] = []): void {
    if (this.terminated) throw new Error('Worker is terminated.')
    const owned = structuredClone(message, { transfer })
    queueMicrotask(() => this.session.handle(owned))
  }

  terminate(): void {
    this.terminated = true
  }
}

class DelayedFirstResponseWorker implements ProjectArchiveWorkerLike {
  onmessage: ((event: MessageEvent<ProjectArchiveWorkerResponse>) => void) | null = null
  onerror: ((event: ErrorEvent) => void) | null = null
  onmessageerror: ((event: MessageEvent<unknown>) => void) | null = null
  private first = true
  private readonly session = createProjectArchiveWorkerSession((response, transfer = []) => {
    const owned = structuredClone(response, { transfer })
    if (this.first) {
      this.first = false
      setTimeout(() => this.onmessage?.({ data: owned } as MessageEvent<ProjectArchiveWorkerResponse>), 70_000)
    } else {
      queueMicrotask(() => this.onmessage?.({ data: owned } as MessageEvent<ProjectArchiveWorkerResponse>))
    }
  })
  terminated = false

  postMessage(message: ProjectArchiveWorkerRequest, transfer: Transferable[] = []): void {
    const owned = structuredClone(message, { transfer })
    queueMicrotask(() => this.session.handle(owned))
  }

  terminate(): void {
    this.terminated = true
  }
}

class SilentWorker implements ProjectArchiveWorkerLike {
  onmessage: ((event: MessageEvent<ProjectArchiveWorkerResponse>) => void) | null = null
  onerror: ((event: ErrorEvent) => void) | null = null
  onmessageerror: ((event: MessageEvent<unknown>) => void) | null = null
  terminated = false
  postMessage(): void {}
  terminate(): void {
    this.terminated = true
  }
}

afterEach(() => {
  vi.useRealTimers()
})

const workerFactory = (): ProjectArchiveWorkerLike => new SessionWorker()

function stepAsset(id: string, sourceBytes: ArrayBuffer) {
  return {
    id,
    name: id,
    sourceKind: 'step' as const,
    sourceFileName: `${id}.step`,
    sourceBytes,
    importScale: 1,
    originMode: 'source' as const,
    colliderCenter: [0, 0, 0] as const,
    collisionHalfExtents: [0.2, 0.2, 0.2] as const,
    collisionBoxes: [{
      id: 'body',
      center: [0, 0, 0] as const,
      halfExtents: [0.2, 0.2, 0.2] as const,
      quaternion: [0, 0, 0, 1] as const,
    }],
    statistics: { vertices: 24, triangles: 12, meshes: 1, materials: 1 },
  }
}

function boxAsset() {
  return {
    id: 'box-asset',
    name: 'Box',
    sourceKind: 'box' as const,
    dimensionsM: [1, 1, 1] as const,
    color: '#AABBCC' as const,
    colliderCenter: [0, 0, 0] as const,
    collisionHalfExtents: [0.5, 0.5, 0.5] as const,
    collisionBoxes: [{
      id: 'primitive-body',
      center: [0, 0, 0] as const,
      halfExtents: [0.5, 0.5, 0.5] as const,
      quaternion: [0, 0, 0, 1] as const,
    }],
    statistics: { vertices: 24, triangles: 12, meshes: 1, materials: 1 },
  }
}

function cylinderAsset() {
  return {
    id: 'cylinder-asset',
    name: 'Cylinder',
    sourceKind: 'cylinder' as const,
    radiusM: 0.5,
    heightM: 1,
    axis: 'z' as const,
    radialSegments: 32 as const,
    color: '#DDEEFF' as const,
    colliderCenter: [0, 0, 0] as const,
    collisionHalfExtents: [0.5, 0.5, 0.5] as const,
    collisionBoxes: [{
      id: 'primitive-body',
      center: [0, 0, 0] as const,
      halfExtents: [0.5, 0.5, 0.5] as const,
      quaternion: [0, 0, 0, 1] as const,
    }],
    statistics: { vertices: 196, triangles: 128, meshes: 1, materials: 1 },
  }
}

async function projectFixture(
  objectAssets: WorkcellProjectSnapshotV3['objectAssets'] = [],
): Promise<WorkcellProjectSnapshotV3> {
  const assemblyBuffer = ASSEMBLY_BYTES.slice().buffer
  const assemblySha256 = await digest(assemblyBuffer)
  const mechanics = {
    joints: CRB15000_DEFINITION.joints.map((joint, index) => ({
      id: joint.id,
      parentLink: LINK_IDS[index]!,
      childLink: LINK_IDS[index + 1]!,
      originM: [...joint.origin],
      axis: [...joint.axis],
      minDeg: joint.minDeg,
      maxDeg: joint.maxDeg,
      homeDeg: Math.min(joint.maxDeg, Math.max(joint.minDeg, 0)),
      zeroOffsetDeg: 0,
      direction: 1 as const,
      maxVelocityDegPerSec: 180,
    })) as unknown as WorkcellProjectSnapshotV3['robot']['mechanics']['joints'],
    flange: IDENTITY,
    tool0: IDENTITY,
  }
  const mechanicsSha256 = await digest(canonicalMechanicsBytesV3(mechanics))
  const instances = objectAssets.map((asset, index) => ({
    id: `instance-${index + 1}`,
    assetId: asset.id,
    name: `Instance ${index + 1}`,
    manualNumericStatus: index,
    statusSource: 'manual' as const,
    statusOverlayVisible: true,
    scale: [1, 1, 1] as const,
    graspable: false,
  }))
  const objectStates = instances.map((instance) => ({
    kind: 'object' as const,
    id: `object:${instance.id}` as const,
    name: instance.name,
    parentId: null,
    localPose: { positionM: [0, 0, 0] as const, quaternion: [0, 0, 0, 1] as const },
    visible: true,
    target: { kind: 'object-instance' as const, id: instance.id },
    transformSource: 'manual' as const,
  }))
  return {
    manifest: {
      format: 'WebDigitalTwinProject',
      schemaVersion: 3,
      projectId: 'archive-project',
      name: 'Archive fixture',
      createdAt: '2026-07-13T00:00:00.000Z',
      updatedAt: '2026-07-13T00:00:00.000Z',
    },
    robot: {
      name: 'Assembly Robot',
      sources: [{
        id: assemblySha256,
        sha256: assemblySha256,
        sourceFileName: 'assembly.step',
        sourceBytes: assemblyBuffer,
        detectedUnit: 'meter',
        selectedSourceUnit: 'meter',
        unitDecision: 'detected',
        sourceToMeters: 1,
        parserVersion: 'occt-import-js@0.0.23',
        statistics: { vertices: 24, triangles: 12, meshes: 7, materials: 1 },
      }],
      links: LINK_IDS.map((linkId, index) => ({
        linkId,
        sourceRefs: [{
          sourceAssetId: assemblySha256,
          nodePath: [index],
          nodeName: `${linkId}-body`,
          meshIndices: [index],
        }],
        coordinateMode: 'assembly-zero-pose',
        zeroPoseLocalization: IDENTITY,
        operatorAdjustment: IDENTITY,
        collisionBoxes: [{
          id: 'body',
          center: [0, 0, 0],
          halfExtents: [0.1, 0.1, 0.1],
          quaternion: [0, 0, 0, 1],
        }],
        statistics: { vertices: 3, triangles: 1, meshes: 1, materials: 1 },
      })),
      mechanics,
      mechanicsProvenance: { kind: 'manual', canonicalSha256: mechanicsSha256 },
    },
    frames: { mcp: IDENTITY, tcp: IDENTITY },
    simulation: {
      activeJobId: 'job-z',
      jobs: [
        { id: 'job-z', name: 'First stored Job', revision: 1, poses: [] },
        { id: 'job-a', name: 'Second stored Job', revision: 1, poses: [] },
      ],
    },
    scene: {
      robotMountContact: { baseLinkId: 'LINK00', mountSurfaceCollisionEntityId: null },
      entities: [
        { kind: 'robot', id: 'robot:active', name: 'Robot', parentId: null,
          localPose: { positionM: [0, 0, 0], quaternion: [0, 0, 0, 1] }, visible: true },
        ...objectStates,
        { kind: 'object', id: 'equipment:cup-01', name: 'Cup 01', parentId: null,
          localPose: { positionM: [0, 0, 0], quaternion: [0, 0, 0, 1] }, visible: true,
          target: { kind: 'built-in-equipment', id: 'cup-01' }, transformSource: 'manual' },
      ],
    },
    objectAssets,
    objectInstances: instances,
    builtInEquipment: [{
      id: 'cup-01',
      name: 'Cup 01',
      kind: 'cup',
      status: 'RUNNING',
      manualNumericStatus: 7,
      statusSource: 'manual',
      statusOverlayVisible: true,
      graspable: true,
      collisionHalfExtents: [0.055, 0.055, 0.075],
      stackLightAnchor: null,
    }],
    opcUa: {
      endpointUrl: 'opc.tcp://127.0.0.1:4840',
      samplingIntervalMs: 100,
      joints: CRB15000_DEFINITION.joints.map(({ id }) => ({
        id,
        nodeId: `ns=2;s=Robot.${id}`,
        scale: 1,
        offset: 0,
      })),
      numericStatusBindings: [
        { entityId: 'equipment:cup-01', nodeId: 'ns=2;s=Cup.Status', scale: 1, offset: 0 },
        ...(instances[0] === undefined ? [] : [{
          entityId: `object:${instances[0].id}` as const,
          nodeId: 'ns=2;s=Object.Status',
          scale: 1,
          offset: 0,
        }]),
      ],
      equipmentTransforms: [{
        entityId: 'equipment:cup-01',
        gatewayId: 'gateway-1',
        gatewayProfileId: 'profile-1',
        gatewayProfileRevision: 'a'.repeat(64),
        mode: 'absolute',
        referenceFrameId: 'mcp',
        smoothing: { mode: 'two-cycle', cycles: 2 },
      }],
    },
    collisionPolicy: {
      enabled: true,
      warningDistanceM: 0.02,
      ignoredPairKeys: [],
      enabledRobotSelfPairs: [],
    },
  } as WorkcellProjectSnapshotV3
}

async function inspectArchiveEntries(blob: Blob): Promise<Record<string, Uint8Array>> {
  return unzipSync(new Uint8Array(await blob.arrayBuffer()))
}

async function inspectArchiveText(blob: Blob): Promise<string> {
  const decoder = new TextDecoder()
  return Object.values(await inspectArchiveEntries(blob))
    .map((entry) => decoder.decode(entry))
    .join('\n')
}

async function rewriteArchive(
  blob: Blob,
  mutate: (entries: Record<string, Uint8Array>) => void,
): Promise<Blob> {
  const entries = await inspectArchiveEntries(blob)
  mutate(entries)
  return new Blob([zipSync(entries).slice().buffer])
}

function containsBinary(value: unknown, seen = new WeakSet<object>()): boolean {
  if (typeof value !== 'object' || value === null || seen.has(value)) return false
  seen.add(value)
  try {
    if (Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'byteLength')?.get?.call(value) !== undefined) {
      return true
    }
  } catch {
    // The value is not an ArrayBuffer in this realm.
  }
  if (ArrayBuffer.isView(value)) return true
  return Reflect.ownKeys(value).some((key) => containsBinary(
    (value as Record<PropertyKey, unknown>)[key],
    seen,
  ))
}

function codecDependencies() {
  const hashService = createProjectHashService({ subtle: crypto.subtle })
  return {
    workerFactory,
    sourceStaging: createProjectSourceStagingService({
      sourceDigest: createProjectSourceDigest(hashService),
    }),
    projectRevisionIdentityHasher: createProjectRevisionIdentityHasher(hashService),
  }
}

describe('deterministic Project V3 archive', () => {
  it('keeps synchronous ZIP, whole-File reads, Blob recopy, and locale sorting out of production paths', () => {
    expect(`${codecSource}\n${archiveSource}\n${workerSource}`).not.toMatch(/\b(?:zipSync|unzipSync)\b/)
    expect(`${codecSource}\n${archiveSource}\n${workerSource}`).not.toContain('localeCompare')
    expect(menuSource).not.toContain('.arrayBuffer(')
    expect(menuSource).not.toMatch(/new Blob\s*\(/)
    const resultInterface = archiveSource.match(
      /export interface ProjectDecodeResultV3\s*\{[\s\S]*?\n\}/,
    )?.[0]
    expect(resultInterface).toBeDefined()
    expect(resultInterface).not.toMatch(/sourceBytes|ArrayBuffer|ArrayBufferView|Uint\d+Array/)
  })

  it('writes one Robot STEP entry for seven Links sharing one source', async () => {
    const project = await projectFixture()
    const entries = await inspectArchiveEntries(
      await encodeWorkcellProject(project, { workerFactory }),
    )
    const expectedSha = project.robot.sources[0]!.sha256

    expect(Object.keys(entries).filter((path) =>
      path.startsWith('robot/sources/') && path.endsWith('.step')))
      .toEqual([`robot/sources/${expectedSha}.step`])
  })

  it('stores Box and Cylinder definitions inline without fake STEP entries', async () => {
    const step = stepAsset('step-asset', OBJECT_BYTES.slice().buffer)
    const entries = await inspectArchiveEntries(await encodeWorkcellProject(
      await projectFixture([step, boxAsset(), cylinderAsset()]),
      { workerFactory },
    ))
    const assets = JSON.parse(new TextDecoder().decode(entries['objects/assets.json']))

    expect(Object.keys(entries).filter((path) =>
      path.startsWith('objects/assets/') && path.endsWith('.step'))).toHaveLength(1)
    expect(assets).toEqual(expect.arrayContaining([
      expect.objectContaining({ sourceKind: 'box' }),
      expect.objectContaining({ sourceKind: 'cylinder' }),
    ]))
  })

  it('shares one Object STEP blob between Assets with byte-identical sources', async () => {
    const first = stepAsset('asset-a', OBJECT_BYTES.slice().buffer)
    const second = stepAsset('asset-b', OBJECT_BYTES.slice().buffer)
    const project = await projectFixture([first, second])
    const entries = await inspectArchiveEntries(
      await encodeWorkcellProject(project, { workerFactory }),
    )
    const objectSha = await digest(OBJECT_BYTES)
    const assets = JSON.parse(new TextDecoder().decode(entries['objects/assets.json']))

    expect(Object.keys(entries).filter((path) =>
      path.startsWith('objects/assets/') && path.endsWith('.step')))
      .toEqual([`objects/assets/${objectSha}.step`])
    expect(assets).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'asset-a', sourceKind: 'step', sourceSha256: objectSha }),
      expect.objectContaining({ id: 'asset-b', sourceKind: 'step', sourceSha256: objectSha }),
    ]))
  })

  it('omits Workspace Mode and every live OPC UA field', async () => {
    const project = await projectFixture([stepAsset('step-asset', OBJECT_BYTES.slice().buffer)])
    const tainted = structuredClone(project) as unknown as Record<string, unknown>
    Object.assign(tainted, { workspaceMode: 'simulation' })
    const opcUa = (tainted.opcUa as Record<string, unknown>)
    Object.assign(opcUa, {
      lastGood: 12,
      receiptTime: 14,
      quality: 'good',
      trajectory: [],
      socketState: 'open',
      liveNumericStatus: 42,
    })

    await expect(encodeWorkcellProject(
      tainted as unknown as WorkcellProjectSnapshotV3,
      { workerFactory },
    )).rejects.toThrow(/unknown|transient/i)
    const text = await inspectArchiveText(await encodeWorkcellProject(project, { workerFactory }))
    expect(text).not.toMatch(/workspaceMode|lastGood|receiptTime|quality|trajectory|socketState/)
    expect(text).not.toMatch(/"(?:numericStatus|liveNumericStatus)"/)
  })

  it('round-trips canonical numeric and Transform bindings without legacy ownership', async () => {
    const project = await projectFixture([stepAsset('step-asset', OBJECT_BYTES.slice().buffer)])
    const decoded = await decodeWorkcellProject(
      await encodeWorkcellProject(project, { workerFactory }),
      codecDependencies(),
    )

    expect(decoded.projection.opcUa.numericStatusBindings).toEqual([
      expect.objectContaining({ entityId: 'equipment:cup-01' }),
      expect.objectContaining({ entityId: 'object:instance-1' }),
    ])
    expect(decoded.projection.opcUa.equipmentTransforms).toHaveLength(1)
    expect(decoded.projection.opcUa).not.toHaveProperty('equipment')
    expect(decoded.preparedSourceGroups).toHaveLength(2)
    expect(decoded).not.toHaveProperty('snapshot')
    expect(JSON.stringify(decoded)).not.toContain('sourceBytes')
    expect(containsBinary(decoded)).toBe(false)
    expect(decoded.projection.simulation.jobs.map(({ id }) => id)).toEqual(['job-z', 'job-a'])
  })

  it('decodes each unique archive source with one digest and exposes no bytes', async () => {
    const sourceDigest = createProjectSourceDigest(createProjectHashService({ subtle: crypto.subtle }))
    const sourceDigestSpy = vi.fn(sourceDigest.digestSource)
    const hashService = createProjectHashService({ subtle: crypto.subtle })
    const project = await projectFixture([
      stepAsset('asset-a', OBJECT_BYTES.slice().buffer),
      stepAsset('asset-b', OBJECT_BYTES.slice().buffer),
    ])
    const decoded = await decodeWorkcellProject(
      await encodeWorkcellProject(project, { workerFactory }),
      {
        workerFactory,
        sourceStaging: createProjectSourceStagingService({
          sourceDigest: { digestSource: sourceDigestSpy },
        }),
        projectRevisionIdentityHasher: createProjectRevisionIdentityHasher(hashService),
      },
    )

    expect(sourceDigestSpy).toHaveBeenCalledTimes(2)
    expect(JSON.stringify(decoded)).not.toContain('sourceBytes')
  })

  it('owns ArrayBuffer input synchronously before caller mutation', async () => {
    const project = await projectFixture()
    const input = new Uint8Array(await (
      await encodeWorkcellProject(project, { workerFactory })
    ).arrayBuffer())

    const pending = decodeWorkcellProject(input, codecDependencies())
    input.fill(0)

    const decoded = await pending
    expect(decoded).toEqual(expect.objectContaining({
      projection: expect.objectContaining({ manifest: project.manifest }),
    }))
    revokeProjectDecodeResult(decoded)
  })

  it('produces byte-identical archives and sorted set-like collections', async () => {
    const project = await projectFixture([
      stepAsset('z-asset', OBJECT_BYTES.slice().buffer),
      stepAsset('a-asset', OBJECT_BYTES.slice().buffer),
    ])
    const first = new Uint8Array(await (await encodeWorkcellProject(project, { workerFactory })).arrayBuffer())
    const second = new Uint8Array(await (await encodeWorkcellProject(project, { workerFactory })).arrayBuffer())
    expect(second).toEqual(first)

    const entries = unzipSync(first)
    expect(Object.keys(entries)).toEqual(Object.keys(entries).sort())
    const assets = JSON.parse(new TextDecoder().decode(entries['objects/assets.json'])) as { id: string }[]
    expect(assets.map(({ id }) => id)).toEqual(['a-asset', 'z-asset'])
    const archivedLinks = JSON.parse(new TextDecoder().decode(
      entries['robot/links/index.json'],
    )) as Record<string, unknown>[]
    expect(archivedLinks.every((link) => !Object.hasOwn(link, 'visible'))).toBe(true)
    expect(entries['scene/state.json']).toBeDefined()
    expect(entries['external/entities.json']).toBeUndefined()
  })

  it('is byte-identical for equivalent property insertion and set collection order', async () => {
    const project = await projectFixture([
      stepAsset('z-asset', OBJECT_BYTES.slice().buffer),
      stepAsset('a-asset', OBJECT_BYTES.slice().buffer),
    ])
    const reordered = structuredClone(project) as unknown as Record<string, unknown>
    reordered.manifest = Object.fromEntries(
      Object.entries(reordered.manifest as Record<string, unknown>).reverse(),
    )
    const robot = reordered.robot as { sources: unknown[]; links: unknown[] }
    robot.sources.reverse()
    robot.links.reverse()
    ;(reordered.objectAssets as unknown[]).reverse()
    ;(reordered.objectInstances as unknown[]).reverse()
    ;(reordered.builtInEquipment as unknown[]).reverse()
    ;((reordered.scene as { entities: unknown[] }).entities).reverse()
    const opcUa = reordered.opcUa as {
      numericStatusBindings: unknown[]
      equipmentTransforms: unknown[]
    }
    opcUa.numericStatusBindings.reverse()
    opcUa.equipmentTransforms.reverse()

    const canonical = new Uint8Array(await (
      await encodeWorkcellProject(project, { workerFactory })
    ).arrayBuffer())
    const equivalent = new Uint8Array(await (
      await encodeWorkcellProject(reordered as unknown as WorkcellProjectSnapshotV3, { workerFactory })
    ).arrayBuffer())

    expect(equivalent).toEqual(canonical)
  })

  it('owns the V3 snapshot synchronously before caller source mutation', async () => {
    const project = structuredClone(await projectFixture()) as WorkcellProjectSnapshotV3
    const expectedSha = project.robot.sources[0]!.sha256
    const pending = encodeWorkcellProject(project, { workerFactory })
    new Uint8Array(project.robot.sources[0]!.sourceBytes).fill(0)

    const entries = await inspectArchiveEntries(await pending)

    expect(Array.from(entries[`robot/sources/${expectedSha}.step`]!)).toEqual(
      Array.from(ASSEMBLY_BYTES),
    )
  })

  it('preserves stored Job order and each Job Pose order exactly', async () => {
    const project = structuredClone(await projectFixture()) as unknown as {
      robot: WorkcellProjectSnapshotV3['robot']
      simulation: { activeJobId: string; jobs: Array<Record<string, unknown>> }
    } & WorkcellProjectSnapshotV3
    const firstAngles = [0, 0, 0, 0, 0, 0] as const
    const secondAngles = [0, 0, 0, 0, 0, 10] as const
    const firstDuration = deriveCanonicalPoseDurationMsV3(
      { anglesDeg: firstAngles, speedPercentToNext: 50 },
      { anglesDeg: secondAngles },
      project.robot.mechanics,
    )
    const mutableSimulation = project.simulation as unknown as {
      jobs: Array<{ poses: unknown[] }>
    }
    mutableSimulation.jobs[0]!.poses = [
      {
        id: 'pose-z', name: 'Stored first', anglesDeg: firstAngles,
        durationMs: firstDuration, easing: 'easeInOut', speedPercentToNext: 50,
      },
      {
        id: 'pose-a', name: 'Stored second', anglesDeg: secondAngles,
        durationMs: 1_000, easing: 'linear', speedPercentToNext: 100,
      },
    ]
    const decoded = await decodeWorkcellProject(
      await encodeWorkcellProject(project, { workerFactory }),
      codecDependencies(),
    )

    expect(decoded.projection.simulation.jobs.map(({ id }) => id)).toEqual(['job-z', 'job-a'])
    expect(decoded.projection.simulation.jobs[0]!.poses.map(({ id }) => id))
      .toEqual(['pose-z', 'pose-a'])
  })

  it.each([
    ['missing referenced blob', (entries: Record<string, Uint8Array>, sourcePath: string) => {
      delete entries[sourcePath]
    }],
    ['unknown JSON entry', (entries: Record<string, Uint8Array>) => {
      entries['unknown.json'] = new TextEncoder().encode('{}')
    }],
    ['unreferenced source blob', (entries: Record<string, Uint8Array>) => {
      entries[`objects/assets/${'f'.repeat(64)}.step`] = new Uint8Array([1])
    }],
  ] as const)('rejects a %s before source digest or token publication', async (_name, mutate) => {
    const project = await projectFixture()
    const sourcePath = `robot/sources/${project.robot.sources[0]!.sha256}.step`
    const archive = await rewriteArchive(
      await encodeWorkcellProject(project, { workerFactory }),
      (entries) => mutate(entries, sourcePath),
    )
    const hashService = createProjectHashService({ subtle: crypto.subtle })
    const nativeDigest = createProjectSourceDigest(hashService)
    const digestSource = vi.fn(nativeDigest.digestSource.bind(nativeDigest))
    const tokenIdFactory = vi.fn(() => 'unexpected-token')
    const sourceStaging = createProjectSourceStagingService({
      sourceDigest: { digestSource },
      tokenIdFactory,
    })

    await expect(decodeWorkcellProject(archive, {
      workerFactory,
      sourceStaging,
      projectRevisionIdentityHasher: createProjectRevisionIdentityHasher(hashService),
    })).rejects.toThrow(/missing|unknown|unreferenced|entry/i)
    expect(digestSource).not.toHaveBeenCalled()
    expect(tokenIdFactory).not.toHaveBeenCalled()
  })

  it('rejects path/index/source-byte digest disagreement before publishing a token', async () => {
    const project = await projectFixture()
    const sourcePath = `robot/sources/${project.robot.sources[0]!.sha256}.step`
    const archive = await rewriteArchive(
      await encodeWorkcellProject(project, { workerFactory }),
      (entries) => { entries[sourcePath] = new TextEncoder().encode('tampered source') },
    )
    const hashService = createProjectHashService({ subtle: crypto.subtle })
    const nativeDigest = createProjectSourceDigest(hashService)
    const digestSource = vi.fn(nativeDigest.digestSource.bind(nativeDigest))
    const tokenIdFactory = vi.fn(() => 'unexpected-token')
    const sourceStaging = createProjectSourceStagingService({
      sourceDigest: { digestSource },
      tokenIdFactory,
    })

    await expect(decodeWorkcellProject(archive, {
      workerFactory,
      sourceStaging,
      projectRevisionIdentityHasher: createProjectRevisionIdentityHasher(hashService),
    })).rejects.toMatchObject({ code: 'PROJECT_SOURCE_DIGEST_MISMATCH' })
    expect(digestSource).toHaveBeenCalledTimes(1)
    expect(tokenIdFactory).not.toHaveBeenCalled()
  })

  it('rolls back a previously prepared source when a later archive digest fails', async () => {
    const project = await projectFixture([stepAsset('object-a', OBJECT_BYTES.slice().buffer)])
    const robotPath = `robot/sources/${project.robot.sources[0]!.sha256}.step`
    const archive = await rewriteArchive(
      await encodeWorkcellProject(project, { workerFactory }),
      (entries) => { entries[robotPath] = new TextEncoder().encode('tampered later source') },
    )
    const hashService = createProjectHashService({ subtle: crypto.subtle })
    const nativeDigest = createProjectSourceDigest(hashService)
    const digestSource = vi.fn(nativeDigest.digestSource.bind(nativeDigest))
    let tokenSequence = 0
    const tokenIdFactory = vi.fn(() => `rollback-token-${++tokenSequence}`)

    await expect(decodeWorkcellProject(archive, {
      workerFactory,
      sourceStaging: createProjectSourceStagingService({
        sourceDigest: { digestSource }, tokenIdFactory,
      }),
      projectRevisionIdentityHasher: createProjectRevisionIdentityHasher(hashService),
    })).rejects.toMatchObject({ code: 'PROJECT_SOURCE_DIGEST_MISMATCH' })
    expect(digestSource).toHaveBeenCalledTimes(2)
    expect(tokenIdFactory).toHaveBeenCalledTimes(1)
  })

  it('rejects duplicate Asset IDs and unknown versions before hashing sources', async () => {
    const project = await projectFixture([
      stepAsset('asset-a', OBJECT_BYTES.slice().buffer),
      stepAsset('asset-b', OBJECT_BYTES.slice().buffer),
    ])
    const encoded = await encodeWorkcellProject(project, { workerFactory })
    const duplicateAssets = await rewriteArchive(encoded, (entries) => {
      const assets = JSON.parse(new TextDecoder().decode(entries['objects/assets.json'])) as
        Record<string, unknown>[]
      assets[1]!.id = assets[0]!.id
      entries['objects/assets.json'] = new TextEncoder().encode(JSON.stringify(assets))
    })
    const unknownVersion = await rewriteArchive(encoded, (entries) => {
      const manifest = JSON.parse(new TextDecoder().decode(entries['manifest.json'])) as
        Record<string, unknown>
      manifest.schemaVersion = 999
      entries['manifest.json'] = new TextEncoder().encode(JSON.stringify(manifest))
    })
    for (const archive of [duplicateAssets, unknownVersion]) {
      const hashService = createProjectHashService({ subtle: crypto.subtle })
      const nativeDigest = createProjectSourceDigest(hashService)
      const digestSource = vi.fn(nativeDigest.digestSource.bind(nativeDigest))
      const tokenIdFactory = vi.fn(() => 'unexpected-token')
      const sourceStaging = createProjectSourceStagingService({
        sourceDigest: { digestSource }, tokenIdFactory,
      })

      await expect(decodeWorkcellProject(archive, {
        workerFactory,
        sourceStaging,
        projectRevisionIdentityHasher: createProjectRevisionIdentityHasher(hashService),
      })).rejects.toThrow(/duplicate|unsupported|schema|assignment|Project/i)
      expect(digestSource).not.toHaveBeenCalled()
      expect(tokenIdFactory).not.toHaveBeenCalled()
    }
  })

  it('keeps equal Robot/Object content in separate namespace groups and revokes by result identity', async () => {
    const object = stepAsset('same-source', ASSEMBLY_BYTES.slice().buffer)
    const project = await projectFixture([object])
    const dependencies = codecDependencies()
    const decoded = await decodeWorkcellProject(
      await encodeWorkcellProject(project, { workerFactory }),
      dependencies,
    )

    expect(decoded.preparedSourceGroups).toHaveLength(2)
    expect(decoded.preparedSourceGroups.map(({ preparedSource }) => preparedSource.namespace).sort())
      .toEqual(['object', 'robot'])
    expect(decoded.preparedSourceGroups[0]!.preparedSource)
      .not.toBe(decoded.preparedSourceGroups[1]!.preparedSource)
    for (const group of decoded.preparedSourceGroups) {
      expect(() => dependencies.sourceStaging.assertPrepared(group.preparedSource)).not.toThrow()
    }
    expect(revokeProjectDecodeResult(decoded)).toBe(true)
    expect(revokeProjectDecodeResult(decoded)).toBe(false)
    for (const group of decoded.preparedSourceGroups) {
      expect(() => dependencies.sourceStaging.assertPrepared(group.preparedSource)).toThrow(/revoked/i)
    }
    expect(() => revokeProjectDecodeResult(structuredClone(decoded))).toThrow(/forged|invalid/i)
  })

  it('cancels staging before token publication and revokes post-staging provenance failures', async () => {
    const project = await projectFixture()
    const archive = await encodeWorkcellProject(project, { workerFactory })
    const controller = new AbortController()
    let releaseDigest!: (value: string) => void
    let markDigestStarted!: () => void
    const digestStarted = new Promise<void>((resolve) => { markDigestStarted = resolve })
    const digestSource = vi.fn(() => new Promise<string>((resolve) => {
      releaseDigest = resolve
      markDigestStarted()
    }))
    const cancelledTokenFactory = vi.fn(() => 'cancelled-token')
    const hashService = createProjectHashService({ subtle: crypto.subtle })
    const cancelled = decodeWorkcellProject(archive, {
      workerFactory,
      sourceStaging: createProjectSourceStagingService({
        sourceDigest: { digestSource }, tokenIdFactory: cancelledTokenFactory,
      }),
      projectRevisionIdentityHasher: createProjectRevisionIdentityHasher(hashService),
    }, controller.signal)
    await digestStarted
    controller.abort()
    releaseDigest(project.robot.sources[0]!.sha256)

    await expect(cancelled).rejects.toMatchObject({ code: 'PROJECT_ARCHIVE_CANCELLED' })
    expect(cancelledTokenFactory).not.toHaveBeenCalled()

    const provenanceTokenFactory = vi.fn(() => 'provenance-token')
    await expect(decodeWorkcellProject(archive, {
      workerFactory,
      sourceStaging: createProjectSourceStagingService({
        sourceDigest: createProjectSourceDigest(hashService),
        tokenIdFactory: provenanceTokenFactory,
      }),
      projectRevisionIdentityHasher: {
        hashRevisionIdentity: vi.fn(async () => '0'.repeat(64)),
      },
    })).rejects.toMatchObject({ code: 'PROJECT_MANUAL_MECHANICS_DIGEST_MISMATCH' })
    expect(provenanceTokenFactory).toHaveBeenCalledTimes(1)
  })

  it('cancels after staging while provenance is pending and returns no prepared result', async () => {
    const project = await projectFixture()
    const archive = await encodeWorkcellProject(project, { workerFactory })
    const controller = new AbortController()
    const hashService = createProjectHashService({ subtle: crypto.subtle })
    let markHasherStarted!: () => void
    const hasherStarted = new Promise<void>((resolve) => { markHasherStarted = resolve })
    const tokenIdFactory = vi.fn(() => 'post-stage-token')
    const pending = decodeWorkcellProject(archive, {
      workerFactory,
      sourceStaging: createProjectSourceStagingService({
        sourceDigest: createProjectSourceDigest(hashService), tokenIdFactory,
      }),
      projectRevisionIdentityHasher: {
        hashRevisionIdentity: (_bytes, provenanceSignal) => new Promise<string>((_resolve, reject) => {
          markHasherStarted()
          provenanceSignal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
        }),
      },
    }, controller.signal)
    await hasherStarted
    controller.abort()

    await expect(pending).rejects.toMatchObject({ code: 'PROJECT_ARCHIVE_CANCELLED' })
    expect(tokenIdFactory).toHaveBeenCalledTimes(1)
  })

  it('revokes a staged source and detaches a signal-ignoring pending digest on decode abort', async () => {
    const project = await projectFixture([stepAsset('step-asset', OBJECT_BYTES.slice().buffer)])
    const archive = await encodeWorkcellProject(project, { workerFactory })
    const hashService = createProjectHashService({ subtle: crypto.subtle })
    const nativeDigest = createProjectSourceDigest(hashService)
    let secondDigestStarted!: () => void
    const secondStarted = new Promise<void>((resolve) => { secondDigestStarted = resolve })
    let releaseSecondDigest!: () => void
    const secondGate = new Promise<void>((resolve) => { releaseSecondDigest = resolve })
    const retainedDigestBuffers: ArrayBuffer[] = []
    let digestCalls = 0
    const digestSource = vi.fn(async (bytes: ArrayBuffer) => {
      retainedDigestBuffers.push(bytes)
      digestCalls += 1
      if (digestCalls === 2) {
        secondDigestStarted()
        await secondGate
      }
      return nativeDigest.digestSource(bytes)
    })
    let tokenSequence = 0
    const tokenIdFactory = vi.fn(() => `decode-token-${++tokenSequence}`)
    const controller = new AbortController()
    const pending = decodeWorkcellProject(archive, {
      workerFactory,
      sourceStaging: createProjectSourceStagingService({
        sourceDigest: { digestSource },
        tokenIdFactory,
      }),
      projectRevisionIdentityHasher: createProjectRevisionIdentityHasher(hashService),
    }, controller.signal)
    await secondStarted
    expect(tokenIdFactory).toHaveBeenCalledTimes(1)

    controller.abort()
    const outcome = await Promise.race([
      pending.then(
        () => 'resolved' as const,
        () => 'rejected' as const,
      ),
      new Promise<'late'>((resolve) => setTimeout(() => resolve('late'), 250)),
    ])
    expect(outcome).toBe('rejected')
    expect(retainedDigestBuffers).toHaveLength(2)
    expect(retainedDigestBuffers.map(({ byteLength }) => byteLength)).toEqual([0, 0])
    expect(tokenIdFactory).toHaveBeenCalledTimes(1)

    releaseSecondDigest()
    await Promise.resolve()
    await Promise.resolve()
    expect(tokenIdFactory).toHaveBeenCalledTimes(1)
  })

  it('uses one exact 120 second deadline across source digest and ZIP encode', async () => {
    const project = await projectFixture()
    if (project.robot.mechanicsProvenance.kind !== 'manual') throw new Error('Expected manual provenance.')
    const mechanicsDigest = project.robot.mechanicsProvenance.canonicalSha256
    const digestWorker = new DelayedFirstResponseWorker()
    const zipWorker = new SilentWorker()
    const workers: ProjectArchiveWorkerLike[] = [digestWorker, zipWorker]
    vi.useFakeTimers()

    const pending = encodeWorkcellProject(project, {
      workerFactory: () => workers.shift()!,
      projectRevisionIdentityHasher: {
        hashRevisionIdentity: async () => mechanicsDigest,
      },
    })
    const observed = expect(pending).rejects.toMatchObject({ code: 'PROJECT_ARCHIVE_TIMEOUT' })
    await vi.advanceTimersByTimeAsync(70_000)
    await vi.advanceTimersByTimeAsync(49_999)
    expect(zipWorker.terminated).toBe(false)
    await vi.advanceTimersByTimeAsync(1)

    await observed
    expect(zipWorker.terminated).toBe(true)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('uses the same deadline from central inspection through final source staging', async () => {
    const project = await projectFixture([stepAsset('step-asset', OBJECT_BYTES.slice().buffer)])
    const archive = await encodeWorkcellProject(project, { workerFactory })
    const delayedWorker = new DelayedFirstResponseWorker()
    const hashService = createProjectHashService({ subtle: crypto.subtle })
    const nativeDigest = createProjectSourceDigest(hashService)
    const digestSource = vi.fn((bytes: ArrayBuffer, digestSignal?: AbortSignal) =>
      new Promise<string>((resolve, reject) => {
        setTimeout(() => {
          nativeDigest.digestSource(bytes, digestSignal).then(resolve, reject)
        }, 100_000)
      }))
    const tokenIdFactory = vi.fn(() => 'must-not-mint')
    const sourceStaging = createProjectSourceStagingService({
      sourceDigest: { digestSource },
      tokenIdFactory,
    })
    vi.useFakeTimers()

    const pending = decodeWorkcellProject(archive, {
      workerFactory: () => delayedWorker,
      sourceStaging,
      projectRevisionIdentityHasher: createProjectRevisionIdentityHasher(hashService),
    })
    const observed = expect(pending).rejects.toMatchObject({ code: 'PROJECT_ARCHIVE_TIMEOUT' })
    await vi.advanceTimersByTimeAsync(70_000)
    await vi.advanceTimersByTimeAsync(49_999)
    expect(tokenIdFactory).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)

    await observed
    expect(delayedWorker.terminated).toBe(true)
    expect(tokenIdFactory).not.toHaveBeenCalled()
    vi.clearAllTimers()
  })
})
