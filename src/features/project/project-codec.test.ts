import { zipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import { CRB15000_DEFINITION, type RobotLinkId } from '../../domain/robot/crb15000'
import {
  WORKCELL_PROJECT_FORMAT,
  WORKCELL_PROJECT_SCHEMA_VERSION,
  type WorkcellProjectSnapshotV1,
} from '../../domain/project/project'
import { decodeWorkcellProject, encodeWorkcellProject } from './project-codec'

const LINKS = [
  'LINK00', 'LINK01', 'LINK02', 'LINK03', 'LINK04', 'LINK05', 'LINK06',
] as const satisfies readonly RobotLinkId[]

function snapshot(): WorkcellProjectSnapshotV1 {
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
  }
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
  })

  it('rejects a corrupt archive and path traversal entries', async () => {
    await expect(
      decodeWorkcellProject(new Uint8Array([1, 2, 3])),
    ).rejects.toThrow(/archive/i)

    const traversal = zipSync({ '../manifest.json': new Uint8Array([1]) })
    await expect(decodeWorkcellProject(traversal)).rejects.toThrow(/path/i)
  })
})
