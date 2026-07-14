import { unzipSync, zipSync } from 'fflate'
import { describe, expect, it, vi } from 'vitest'
import { CRB15000_DEFINITION, type RobotLinkId } from '../../domain/robot/crb15000'
import {
  WORKCELL_PROJECT_FORMAT,
  WORKCELL_PROJECT_SCHEMA_VERSION_V2 as WORKCELL_PROJECT_SCHEMA_VERSION,
  type LegacyProjectSnapshotV2 as CurrentProjectSnapshot,
} from '../../domain/project/project'
import {
  createProjectSourceMigrationFoundationInternalV1,
  createProjectSourceStagingService,
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
  decodeLegacyRuntimeProjectV2,
  decodeWorkcellProject,
  encodeLegacyRuntimeProjectV2,
} from './project-codec'

const LINKS = [
  'LINK00', 'LINK01', 'LINK02', 'LINK03', 'LINK04', 'LINK05', 'LINK06',
] as const satisfies readonly RobotLinkId[]

function snapshot(): CurrentProjectSnapshot {
  return {
    manifest: {
      format: WORKCELL_PROJECT_FORMAT,
      schemaVersion: WORKCELL_PROJECT_SCHEMA_VERSION,
      projectId: 'project-codec',
      name: 'Codec fixture',
      createdAt: '2026-07-13T00:00:00.000Z',
      updatedAt: '2026-07-13T00:00:00.000Z',
    },
    robot: {
      name: 'Custom Robot',
      basePosition: [0, 0, 0],
      baseRotationDeg: [0, 0, 0],
      links: LINKS.map((linkId, index) => ({
        linkId,
        sourceFileName: `${linkId}.step`,
        sourceBytes: new Uint8Array([index, index + 1]).buffer,
        localTransform: {
          position: [0, 0, 0],
          quaternion: [0, 0, 0, 1],
          scale: [1, 1, 1],
        },
        visible: true,
        collisionCenter: [0, 0, 0],
        collisionHalfExtents: [0.1, 0.1, 0.1],
        collisionBoxes: [
          {
            id: 'main',
            center: [0, 0, 0],
            halfExtents: [0.1, 0.1, 0.1],
            quaternion: [0, 0, 0, 1],
          },
          {
            id: 'guard',
            center: [0.12, 0, 0],
            halfExtents: [0.02, 0.03, 0.04],
            quaternion: [0, 0, Math.SQRT1_2, Math.SQRT1_2],
          },
        ],
        statistics: { vertices: 3, triangles: 1, meshes: 1, materials: 1 },
      })),
      joints: CRB15000_DEFINITION.joints.map((joint) => ({
        ...joint,
        origin: [...joint.origin],
        axis: [...joint.axis],
        maxVelocityDegPerSec: 180,
      })),
    },
    frames: {
      mcp: { position: [0, 0, 0], quaternion: [0, 0, 0, 1], scale: [1, 1, 1] },
      tcp: { position: [0, 0, 0], quaternion: [0, 0, 0, 1], scale: [1, 1, 1] },
    },
    objectAssets: [
      {
        id: 'cup-asset',
        name: 'Cup',
        sourceFileName: 'cup.step',
        sourceBytes: new Uint8Array([8, 9, 10]).buffer,
        importScale: 0.001,
        originMode: 'center',
        colliderCenter: [0, 0, 0],
        collisionHalfExtents: [0.05, 0.05, 0.1],
        collisionBoxes: [
          {
            id: 'cup-body',
            center: [0, 0, 0],
            halfExtents: [0.05, 0.05, 0.1],
            quaternion: [0, 0, 0, 1],
          },
        ],
        statistics: { vertices: 6, triangles: 2, meshes: 1, materials: 1 },
      },
    ],
    objectInstances: [
      {
        id: 'cup-01',
        assetId: 'cup-asset',
        name: 'Cup 01',
        transform: {
          position: [0.6, 0, 1.1],
          quaternion: [0, 0, 0, 1],
          scale: [1, 1, 1],
        },
        numericStatus: 12,
        statusSource: 'manual',
        statusOverlayVisible: true,
        visible: true,
      },
    ],
    poses: [
      {
        id: 'home',
        name: 'Home',
        anglesDeg: [0, 0, 0, 0, 0, 0],
        durationMs: 1000,
        easing: 'linear',
        speedPercentToNext: 50,
      },
    ],
    opcUa: {
      endpointUrl: 'opc.tcp://127.0.0.1:4840',
      samplingIntervalMs: 100,
      joints: CRB15000_DEFINITION.joints.map((joint) => ({
        id: joint.id,
        nodeId: `ns=2;s=${joint.id}`,
        scale: 1,
        offset: 0,
      })),
      equipment: [],
    },
    collisionPolicy: {
      enabled: true,
      warningDistanceM: 0.03,
      ignoredPairKeys: ['object:cup-01|robot-link:LINK00'],
      enabledRobotSelfPairs: ['robot-link:LINK00|robot-link:LINK02'],
    },
  }
}

class SessionWorker implements ProjectArchiveWorkerLike {
  onmessage: ((event: MessageEvent<ProjectArchiveWorkerResponse>) => void) | null = null
  onerror: ((event: ErrorEvent) => void) | null = null
  onmessageerror: ((event: MessageEvent<unknown>) => void) | null = null
  private readonly session: ReturnType<typeof createProjectArchiveWorkerSession>
  private readonly observeRequest: (request: ProjectArchiveWorkerRequest) => void
  private readonly observeResponse: (response: ProjectArchiveWorkerResponse) => void

  constructor(
    observeRequest: (request: ProjectArchiveWorkerRequest) => void = () => undefined,
    observeResponse: (response: ProjectArchiveWorkerResponse) => void = () => undefined,
  ) {
    this.observeRequest = observeRequest
    this.observeResponse = observeResponse
    this.session = createProjectArchiveWorkerSession((response, transfer = []) => {
      const owned = structuredClone(response, { transfer })
      this.observeResponse(owned)
      queueMicrotask(() => this.onmessage?.({ data: owned } as MessageEvent<ProjectArchiveWorkerResponse>))
    })
  }

  postMessage(message: ProjectArchiveWorkerRequest, transfer: Transferable[] = []): void {
    this.observeRequest(message)
    const owned = structuredClone(message, { transfer })
    queueMicrotask(() => this.session.handle(owned))
  }

  terminate(): void {}
}

const workerFactory = (): ProjectArchiveWorkerLike => new SessionWorker()
const testEncoder = new TextEncoder()

function legacyJson(value: unknown): Uint8Array<ArrayBuffer> {
  return new Uint8Array(testEncoder.encode(JSON.stringify(value)))
}

function legacyArchive(version: 1 | 2): Uint8Array {
  const source = structuredClone(snapshot())
  const entries: Record<string, Uint8Array> = {}
  entries['manifest.json'] = legacyJson({ ...source.manifest, schemaVersion: version })
  entries['frames.json'] = legacyJson(source.frames)
  entries['robot/configuration.json'] = legacyJson({
    name: source.robot.name,
    basePosition: source.robot.basePosition,
    baseRotationDeg: source.robot.baseRotationDeg,
    joints: source.robot.joints,
  })
  entries['robot/links/index.json'] = legacyJson(source.robot.links.map((link) => {
    const { sourceBytes, ...metadata } = link
    const archived = { ...metadata, archivePath: `robot/links/${link.linkId}.step` }
    if (version === 1) delete (archived as { collisionBoxes?: unknown }).collisionBoxes
    entries[archived.archivePath] = new Uint8Array(sourceBytes)
    return archived
  }))
  entries['objects/assets.json'] = legacyJson(source.objectAssets.map((asset, index) => {
    const { sourceBytes, ...metadata } = asset
    const archived = {
      ...metadata,
      archivePath: `objects/assets/${index.toString().padStart(4, '0')}.step`,
    }
    if (version === 1) delete (archived as { collisionBoxes?: unknown }).collisionBoxes
    entries[archived.archivePath] = new Uint8Array(sourceBytes)
    return archived
  }))
  entries['objects/instances.json'] = legacyJson(source.objectInstances)
  entries['poses/sequences.json'] = legacyJson(source.poses)
  entries['opcua/bindings.json'] = legacyJson(source.opcUa)
  if (version === 2) entries['collision/policy.json'] = legacyJson(source.collisionPolicy)
  return zipSync(entries, { mtime: new Date(1980, 0, 1, 0, 0, 0, 0) })
}

function legacyArchiveWithSharedRobotPath(): Uint8Array {
  const entries = unzipSync(legacyArchive(2))
  const links = JSON.parse(new TextDecoder().decode(entries['robot/links/index.json'])) as Array<{
    archivePath: string
  }>
  const removedPath = links[1]!.archivePath
  links[1]!.archivePath = links[0]!.archivePath
  entries['robot/links/index.json'] = legacyJson(links)
  delete entries[removedPath]
  return zipSync(entries, { mtime: new Date(1980, 0, 1, 0, 0, 0, 0) })
}

function legacyArchiveWithEqualRobotPathBytes(): Uint8Array {
  const entries = unzipSync(legacyArchive(2))
  entries['robot/links/LINK01.step'] = entries['robot/links/LINK00.step']!.slice()
  return zipSync(entries, { mtime: new Date(1980, 0, 1, 0, 0, 0, 0) })
}

function legacyArchiveWithCrossNamespaceEqualBytes(): Uint8Array {
  const entries = unzipSync(legacyArchive(2))
  entries['objects/assets/0000.step'] = entries['robot/links/LINK00.step']!.slice()
  return zipSync(entries, { mtime: new Date(1980, 0, 1, 0, 0, 0, 0) })
}

function migrationCodecDependencies(overrides: {
  readonly workerFactory?: (() => ProjectArchiveWorkerLike) | undefined
  readonly digestSource?: ((
    bytes: ArrayBuffer | ArrayBufferView,
    signal?: AbortSignal,
  ) => Promise<string>) | undefined
} = {}) {
  const hashService = createProjectHashService({ subtle: crypto.subtle })
  const sourceDigest = createProjectSourceDigest(hashService)
  const digestSource = vi.fn(overrides.digestSource ?? sourceDigest.digestSource.bind(sourceDigest))
  const analyzeLegacyRobotSource = vi.fn(async ({ tokenId, generation, sourceBytes }) => ({
    tokenId,
    generation,
    sourceBytes,
    analysis: { detectedUnit: 'meter' as const, meshIndices: [0] },
  }))
  const foundation = createProjectSourceMigrationFoundationInternalV1({
    sourceDigest: { digestSource },
    lockedLegacyAnalyzer: analyzeLegacyRobotSource,
  })
  const projectRevisionIdentityHasher = createProjectRevisionIdentityHasher(hashService)
  const legacyMigration = {
    sourceStaging: foundation.sourceStaging,
    projectRevisionIdentityHasher,
    builtInEquipmentDefaults: [],
    builtInEquipmentTransformDefaults: [],
  }
  return {
    digestSource,
    analyzeLegacyRobotSource,
    options: {
      workerFactory: overrides.workerFactory ?? workerFactory,
      sourceStaging: foundation.sourceStaging,
      projectRevisionIdentityHasher,
      legacyMigration,
    },
  }
}

describe('.wdtwin streaming legacy dispatch', () => {
  it('keeps the temporary V2 browser runtime on streaming Blob/File transport', async () => {
    const source = snapshot()
    const archive = await encodeLegacyRuntimeProjectV2(source, { workerFactory })
    const file = new File([archive], 'runtime.wdtwin')
    const wholeFileRead = vi.spyOn(file, 'arrayBuffer').mockRejectedValue(
      new Error('whole-file reads are forbidden'),
    )

    const decoded = await decodeLegacyRuntimeProjectV2(file, { workerFactory })

    expect(archive).toBeInstanceOf(Blob)
    expect(decoded.manifest).toEqual(source.manifest)
    expect(new Uint8Array(decoded.robot.links[0]!.sourceBytes)).toEqual(
      new Uint8Array(source.robot.links[0]!.sourceBytes),
    )
    expect(wholeFileRead).not.toHaveBeenCalled()
  })

  it.each([1, 2] as const)('streams and migrates a V%s archive to byte-free V3', async (version) => {
    const { options, digestSource, analyzeLegacyRobotSource } = migrationCodecDependencies()

    const decoded = await decodeWorkcellProject(legacyArchive(version), options)

    expect(decoded.projection.manifest.schemaVersion).toBe(3)
    expect(decoded.preparedSourceGroups).toHaveLength(8)
    expect(digestSource).toHaveBeenCalledTimes(8)
    const sharedSignal = digestSource.mock.calls[0]![1]
    expect(sharedSignal).toBeInstanceOf(AbortSignal)
    expect(digestSource.mock.calls.every((call) => call[1] === sharedSignal)).toBe(true)
    expect(analyzeLegacyRobotSource.mock.calls.every((call) => call[0].signal === sharedSignal))
      .toBe(true)
    expect(JSON.stringify(decoded)).not.toContain('sourceBytes')
  })

  it.each([1, 2] as const)(
    'stages each expanded V%s source before requesting the next archive entry',
    async (version) => {
    const extractStarts: string[] = []
    let firstDigestStarted!: () => void
    const digestStarted = new Promise<void>((resolve) => { firstDigestStarted = resolve })
    let releaseFirstDigest!: () => void
    const digestGate = new Promise<void>((resolve) => { releaseFirstDigest = resolve })
    const hashService = createProjectHashService({ subtle: crypto.subtle })
    const nativeDigest = createProjectSourceDigest(hashService)
    let digestCalls = 0
    const { options } = migrationCodecDependencies({
      workerFactory: () => new SessionWorker((request) => {
        if (request.type === 'extract-start' && request.path.endsWith('.step')) {
          extractStarts.push(request.path)
        }
      }),
      digestSource: async (bytes, signal) => {
        digestCalls += 1
        if (digestCalls === 1) {
          firstDigestStarted()
          await digestGate
        }
        return nativeDigest.digestSource(bytes, signal)
      },
    })

    const pending = decodeWorkcellProject(legacyArchive(version), options)
    await digestStarted
    const readsBeforeFirstDigestSettled = [...extractStarts]
    releaseFirstDigest()
    await pending

    expect(readsBeforeFirstDigestSettled).toHaveLength(1)
    },
  )

  it('cancels during the second legacy digest without retaining prior or late source bytes', async () => {
    const controller = new AbortController()
    const extractStarts: string[] = []
    const expandedBuffers: ArrayBuffer[] = []
    const digestBuffers: ArrayBuffer[] = []
    let secondDigestStarted!: () => void
    const digestStarted = new Promise<void>((resolve) => { secondDigestStarted = resolve })
    let releaseSecondDigest!: () => void
    const digestGate = new Promise<void>((resolve) => { releaseSecondDigest = resolve })
    let digestCalls = 0
    const { options } = migrationCodecDependencies({
      workerFactory: () => new SessionWorker(
        (request) => {
          if (request.type === 'extract-start' && request.path.endsWith('.step')) {
            extractStarts.push(request.path)
          }
        },
        (response) => {
          if (response.type === 'entry-data' && response.path.endsWith('.step')) {
            expandedBuffers.push(response.bytes)
          }
        },
      ),
      digestSource: async (bytes) => {
        const buffer = bytes as ArrayBuffer
        digestBuffers.push(buffer)
        digestCalls += 1
        if (digestCalls === 2) {
          secondDigestStarted()
          await digestGate
        }
        return digestCalls.toString(16).padStart(64, '0')
      },
    })

    const pending = decodeWorkcellProject(legacyArchive(2), options, controller.signal)
    await digestStarted
    const readsBeforeCancellation = extractStarts.length
    controller.abort()
    await expect(pending).rejects.toMatchObject({ code: 'PROJECT_ARCHIVE_CANCELLED' })
    releaseSecondDigest()
    await Promise.resolve()
    await Promise.resolve()

    expect(readsBeforeCancellation).toBe(2)
    expect(expandedBuffers).toHaveLength(2)
    expect(expandedBuffers.every(({ byteLength }) => byteLength === 0)).toBe(true)
    expect(digestBuffers).toHaveLength(2)
    expect(digestBuffers.every(({ byteLength }) => byteLength === 0)).toBe(true)
  })

  it('digests each unique legacy namespace and archive path exactly once', async () => {
    const reads: string[] = []
    const { options, digestSource, analyzeLegacyRobotSource } = migrationCodecDependencies({
      workerFactory: () => new SessionWorker((request) => {
        if (request.type === 'extract-start' && request.path.endsWith('.step')) reads.push(request.path)
      }),
    })

    const decoded = await decodeWorkcellProject(legacyArchiveWithSharedRobotPath(), options)

    expect(reads).toHaveLength(7)
    expect(decoded.preparedSourceGroups).toHaveLength(7)
    expect(digestSource).toHaveBeenCalledTimes(7)
    expect(analyzeLegacyRobotSource).toHaveBeenCalledTimes(6)
  })

  it('stages equal bytes from different legacy paths separately before digest de-duplication', async () => {
    const reads: string[] = []
    const { options, digestSource, analyzeLegacyRobotSource } = migrationCodecDependencies({
      workerFactory: () => new SessionWorker((request) => {
        if (request.type === 'extract-start' && request.path.endsWith('.step')) reads.push(request.path)
      }),
    })

    const decoded = await decodeWorkcellProject(legacyArchiveWithEqualRobotPathBytes(), options)

    expect(reads).toHaveLength(8)
    expect(digestSource).toHaveBeenCalledTimes(8)
    expect(analyzeLegacyRobotSource).toHaveBeenCalledTimes(6)
    expect(decoded.preparedSourceGroups).toHaveLength(7)
  })

  it('keeps equal Robot and Object Archive bytes isolated by namespace', async () => {
    const reads: string[] = []
    const { options, digestSource, analyzeLegacyRobotSource } = migrationCodecDependencies({
      workerFactory: () => new SessionWorker((request) => {
        if (request.type === 'extract-start' && request.path.endsWith('.step')) reads.push(request.path)
      }),
    })

    const decoded = await decodeWorkcellProject(legacyArchiveWithCrossNamespaceEqualBytes(), options)
    const matchingDigest = decoded.projection.robot.sources[0]!.sha256
    const matchingGroups = decoded.preparedSourceGroups.filter(({ preparedSource }) =>
      preparedSource.sha256 === matchingDigest)

    expect(reads).toHaveLength(8)
    expect(digestSource).toHaveBeenCalledTimes(8)
    expect(analyzeLegacyRobotSource).toHaveBeenCalledTimes(7)
    expect(decoded.preparedSourceGroups).toHaveLength(8)
    expect(matchingGroups).toHaveLength(2)
    expect(matchingGroups.map(({ preparedSource }) => preparedSource.namespace).sort())
      .toEqual(['object', 'robot'])
    expect(matchingGroups[0]!.preparedSource).not.toBe(matchingGroups[1]!.preparedSource)
  })

  it('requires the complete legacy bundle before expanding or hashing STEP bytes', async () => {
    const hashService = createProjectHashService({ subtle: crypto.subtle })
    const sourceDigest = createProjectSourceDigest(hashService)
    const digestSource = vi.fn(sourceDigest.digestSource.bind(sourceDigest))
    const sourceStaging = createProjectSourceStagingService({
      sourceDigest: { digestSource },
    })

    await expect(decodeWorkcellProject(legacyArchive(2), {
      workerFactory,
      sourceStaging,
      projectRevisionIdentityHasher: createProjectRevisionIdentityHasher(hashService),
    })).rejects.toMatchObject({ code: 'PROJECT_LEGACY_MIGRATION_DEPENDENCIES_REQUIRED' })
    expect(digestSource).not.toHaveBeenCalled()
  })

  it('rejects a mismatched legacy staging identity before archive reads or hashes', async () => {
    const first = migrationCodecDependencies()
    const second = migrationCodecDependencies()

    await expect(decodeWorkcellProject(legacyArchive(1), {
      ...first.options,
      legacyMigration: second.options.legacyMigration,
    })).rejects.toMatchObject({ code: 'PROJECT_LEGACY_MIGRATION_DEPENDENCIES_INVALID' })
    expect(first.digestSource).not.toHaveBeenCalled()
    expect(second.digestSource).not.toHaveBeenCalled()
  })
})
