import { describe, expect, it } from 'vitest'
import { CRB15000_DEFINITION, type RobotLinkId } from '../robot/crb15000'
import {
  MAX_OBJECT_ASSET_TRIANGLES,
  type ObjectAssetRecordV1,
  type ObjectInstanceRecordV1,
  type RobotLinkGeometryRecordV1,
  type WorkcellProjectSnapshotV1,
  validateWorkcellProjectSnapshot,
  WORKCELL_PROJECT_FORMAT,
  WORKCELL_PROJECT_SCHEMA_VERSION,
} from './project'

const LINK_IDS = [
  'LINK00',
  'LINK01',
  'LINK02',
  'LINK03',
  'LINK04',
  'LINK05',
  'LINK06',
] as const satisfies readonly RobotLinkId[]

const IDENTITY_TRANSFORM = {
  position: [0, 0, 0],
  quaternion: [0, 0, 0, 1],
  scale: [1, 1, 1],
} as const

function identityTransform() {
  return {
    position: [...IDENTITY_TRANSFORM.position] as [number, number, number],
    quaternion: [...IDENTITY_TRANSFORM.quaternion] as [number, number, number, number],
    scale: [...IDENTITY_TRANSFORM.scale] as [number, number, number],
  }
}

function robotLink(linkId: RobotLinkId): RobotLinkGeometryRecordV1 {
  return {
    linkId,
    sourceFileName: `${linkId}.step`,
    sourceBytes: new Uint8Array([1, 2, 3]).buffer,
    localTransform: identityTransform(),
    visible: true,
    collisionHalfExtents: [0.1, 0.1, 0.1],
    statistics: { vertices: 12, triangles: 4, meshes: 1, materials: 1 },
  }
}

function objectAsset(id = 'asset-machine'): ObjectAssetRecordV1 {
  return {
    id,
    name: 'Machine',
    sourceFileName: 'machine.step',
    sourceBytes: new Uint8Array([4, 5, 6]).buffer,
    importScale: 0.001,
    originMode: 'source',
    collisionHalfExtents: [0.5, 0.4, 0.3],
    statistics: { vertices: 36, triangles: 12, meshes: 1, materials: 1 },
  }
}

function objectInstance(id: string, assetId = 'asset-machine'): ObjectInstanceRecordV1 {
  return {
    id,
    assetId,
    name: id,
    transform: {
      position: [0, 0, 0],
      quaternion: [0, 0, 0, 1],
      scale: [1, 1, 1],
    },
    numericStatus: 0,
    statusSource: 'manual',
    statusOverlayVisible: true,
    visible: true,
  }
}

function validProjectSnapshot(): WorkcellProjectSnapshotV1 {
  return {
    manifest: {
      format: WORKCELL_PROJECT_FORMAT,
      schemaVersion: WORKCELL_PROJECT_SCHEMA_VERSION,
      projectId: 'project-01',
      name: 'Portable cell',
      createdAt: '2026-07-13T00:00:00.000Z',
      updatedAt: '2026-07-13T00:00:00.000Z',
    },
    robot: {
      name: 'Custom six-axis robot',
      basePosition: [0, 0, 0],
      baseRotationDeg: [0, 0, 0],
      links: LINK_IDS.map(robotLink),
      joints: CRB15000_DEFINITION.joints.map((joint, index) => ({
        ...joint,
        origin: [...joint.origin],
        axis: [...joint.axis],
        maxVelocityDegPerSec: [180, 180, 180, 320, 320, 420][index]!,
      })),
    },
    frames: {
      mcp: identityTransform(),
      tcp: identityTransform(),
    },
    objectAssets: [objectAsset()],
    objectInstances: [objectInstance('machine-01'), objectInstance('machine-02')],
    poses: [
      {
        id: 'pose-home',
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
        nodeId: `ns=2;s=Robot.${joint.id}`,
        scale: 1,
        offset: 0,
      })),
      equipment: [],
    },
  }
}

describe('portable workcell project contract', () => {
  it('accepts seven Robot links and reusable Object Asset references', () => {
    const snapshot = validProjectSnapshot()

    expect(validateWorkcellProjectSnapshot(snapshot)).toBe(snapshot)
  })

  it('rejects a project that does not contain exactly seven Robot links', () => {
    const snapshot = validProjectSnapshot()
    snapshot.robot.links = snapshot.robot.links.slice(0, 6)

    expect(() => validateWorkcellProjectSnapshot(snapshot)).toThrow(
      'exactly seven',
    )
  })

  it('rejects an Object Instance that references a missing Object Asset', () => {
    const snapshot = validProjectSnapshot()
    snapshot.objectInstances = [objectInstance('orphan', 'missing-asset')]

    expect(() => validateWorkcellProjectSnapshot(snapshot)).toThrow(
      'Object Asset',
    )
  })

  it('rejects duplicate Object Asset ids', () => {
    const snapshot = validProjectSnapshot()
    snapshot.objectAssets = [objectAsset(), objectAsset()]

    expect(() => validateWorkcellProjectSnapshot(snapshot)).toThrow('Duplicate')
  })

  it('rejects Object geometry that exceeds the triangle budget', () => {
    const snapshot = validProjectSnapshot()
    snapshot.objectAssets = [
      {
        ...objectAsset(),
        statistics: {
          ...objectAsset().statistics,
          triangles: MAX_OBJECT_ASSET_TRIANGLES + 1,
        },
      },
    ]

    expect(() => validateWorkcellProjectSnapshot(snapshot)).toThrow(
      'triangle budget',
    )
  })
})
