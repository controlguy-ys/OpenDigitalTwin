import { unzipSync, zipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import { CRB15000_DEFINITION, type RobotLinkId } from '../../domain/robot/crb15000'
import {
  WORKCELL_PROJECT_FORMAT,
  WORKCELL_PROJECT_SCHEMA_VERSION_V2 as WORKCELL_PROJECT_SCHEMA_VERSION,
  WORKCELL_PROJECT_SCHEMA_VERSION_V1,
  type LegacyProjectSnapshotV2 as CurrentProjectSnapshot,
} from '../../domain/project/project'
import { decodeWorkcellProject, encodeWorkcellProject } from './project-codec'

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

const decoder = new TextDecoder()
const encoder = new TextEncoder()

function parseEntry<T>(entries: Record<string, Uint8Array>, path: string): T {
  return JSON.parse(decoder.decode(entries[path]!)) as T
}

function writeEntry(
  entries: Record<string, Uint8Array>,
  path: string,
  value: unknown,
): void {
  entries[path] = encoder.encode(JSON.stringify(value))
}

describe('.wdtwin archive codec', () => {
  it('round-trips JSON records and raw STEP bytes', async () => {
    const source = snapshot()
    const encoded = await encodeWorkcellProject(source)
    const decoded = await decodeWorkcellProject(encoded)

    expect(decoded.manifest).toEqual(source.manifest)
    expect(decoded.robot.links.map(({ sourceBytes }) =>
      Array.from(new Uint8Array(sourceBytes))),
    ).toEqual(source.robot.links.map(({ sourceBytes }) =>
      Array.from(new Uint8Array(sourceBytes))))
    expect(Array.from(new Uint8Array(decoded.objectAssets[0]!.sourceBytes))).toEqual([
      8, 9, 10,
    ])
    expect(decoded.objectInstances).toEqual(source.objectInstances)
    expect(decoded.poses).toEqual(source.poses)
    expect(decoded.robot.links[0]!.collisionBoxes).toEqual(
      source.robot.links[0]!.collisionBoxes,
    )
    expect(decoded.objectAssets[0]!.collisionBoxes).toEqual(
      source.objectAssets[0]!.collisionBoxes,
    )
    expect(decoded.collisionPolicy).toEqual(source.collisionPolicy)

    const entries = unzipSync(encoded)
    expect(parseEntry(entries, 'collision/policy.json')).toEqual(
      source.collisionPolicy,
    )
  })

  it('decodes V1 archives and atomically migrates legacy bounds to V2', async () => {
    const encoded = await encodeWorkcellProject(snapshot())
    const entries = unzipSync(encoded)
    const manifest = parseEntry<Record<string, unknown>>(entries, 'manifest.json')
    manifest.schemaVersion = WORKCELL_PROJECT_SCHEMA_VERSION_V1
    writeEntry(entries, 'manifest.json', manifest)
    const links = parseEntry<Array<Record<string, unknown>>>(
      entries,
      'robot/links/index.json',
    )
    links.forEach((link) => delete link.collisionBoxes)
    writeEntry(entries, 'robot/links/index.json', links)
    const assets = parseEntry<Array<Record<string, unknown>>>(
      entries,
      'objects/assets.json',
    )
    assets.forEach((asset) => delete asset.collisionBoxes)
    writeEntry(entries, 'objects/assets.json', assets)
    delete entries['collision/policy.json']

    const migrated = await decodeWorkcellProject(zipSync(entries))

    expect(migrated.manifest.schemaVersion).toBe(WORKCELL_PROJECT_SCHEMA_VERSION)
    expect(migrated.robot.links[0]!.collisionBoxes).toEqual([{
      id: 'default',
      center: [0, 0, 0],
      halfExtents: [0.1, 0.1, 0.1],
      quaternion: [0, 0, 0, 1],
    }])
    expect(migrated.objectAssets[0]!.collisionBoxes[0]!.id).toBe('default')
    expect(migrated.collisionPolicy.warningDistanceM).toBe(0.02)
  })

  it('rejects invalid V2 canonical Box data instead of using its legacy mirror', async () => {
    const entries = unzipSync(await encodeWorkcellProject(snapshot()))
    const links = parseEntry<Array<Record<string, unknown>>>(
      entries,
      'robot/links/index.json',
    )
    links[0]!.collisionBoxes = []
    writeEntry(entries, 'robot/links/index.json', links)

    await expect(decodeWorkcellProject(zipSync(entries))).rejects.toThrow(/Box/i)
  })

  it('requires the collision policy entry for V2 archives', async () => {
    const entries = unzipSync(await encodeWorkcellProject(snapshot()))
    delete entries['collision/policy.json']

    await expect(decodeWorkcellProject(zipSync(entries))).rejects.toThrow(
      /collision\/policy\.json/i,
    )
  })

  it('rejects a corrupt archive and path traversal entries', async () => {
    await expect(
      decodeWorkcellProject(new Uint8Array([1, 2, 3])),
    ).rejects.toThrow(/archive/i)

    const traversal = zipSync({ '../manifest.json': new Uint8Array([1]) })
    await expect(decodeWorkcellProject(traversal)).rejects.toThrow(/path/i)
  })
})
