import { zipSync } from 'fflate'
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
  private readonly session = createProjectArchiveWorkerSession((response, transfer = []) => {
    const owned = structuredClone(response, { transfer })
    queueMicrotask(() => this.onmessage?.({ data: owned } as MessageEvent<ProjectArchiveWorkerResponse>))
  })

  postMessage(message: ProjectArchiveWorkerRequest, transfer: Transferable[] = []): void {
    const owned = structuredClone(message, { transfer })
    queueMicrotask(() => this.session.handle(owned))
  }

  terminate(): void {}
}

const workerFactory = (): ProjectArchiveWorkerLike => new SessionWorker()
const testEncoder = new TextEncoder()

function legacyJson(value: unknown): Uint8Array {
  return testEncoder.encode(JSON.stringify(value))
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

function migrationCodecDependencies() {
  const hashService = createProjectHashService({ subtle: crypto.subtle })
  const sourceDigest = createProjectSourceDigest(hashService)
  const digestSource = vi.fn(sourceDigest.digestSource.bind(sourceDigest))
  const foundation = createProjectSourceMigrationFoundationInternalV1({
    sourceDigest: { digestSource },
    lockedLegacyAnalyzer: async ({ tokenId, generation, sourceBytes }) => ({
      tokenId,
      generation,
      sourceBytes,
      analysis: { detectedUnit: 'meter', meshIndices: [0] },
    }),
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
    options: {
      workerFactory,
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
    const { options, digestSource } = migrationCodecDependencies()

    const decoded = await decodeWorkcellProject(legacyArchive(version), options)

    expect(decoded.projection.manifest.schemaVersion).toBe(3)
    expect(decoded.preparedSourceGroups).toHaveLength(8)
    expect(digestSource).toHaveBeenCalledTimes(8)
    expect(JSON.stringify(decoded)).not.toContain('sourceBytes')
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
