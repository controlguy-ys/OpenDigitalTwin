import { describe, expect, it } from 'vitest'
import { CRB15000_DEFINITION, type RobotLinkId } from '../robot/crb15000'
import {
  MAX_OBJECT_ASSET_TRIANGLES,
  MAX_COLLISION_BOXES_PER_PROJECT,
  type ProjectCollisionBoxV2,
  type ObjectAssetRecordV1,
  type ObjectInstanceRecordV1,
  type RobotLinkGeometryRecordV1,
  type WorkcellProjectSnapshotV1,
  type WorkcellProjectSnapshotV2,
  validateWorkcellProjectSnapshot,
  validateWorkcellProjectSnapshotV1,
  WORKCELL_PROJECT_FORMAT,
  WORKCELL_PROJECT_SCHEMA_VERSION,
  WORKCELL_PROJECT_SCHEMA_VERSION_V1,
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
    collisionCenter: [0, 0, 0],
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
    colliderCenter: [0, 0, 0.1],
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
      schemaVersion: WORKCELL_PROJECT_SCHEMA_VERSION_V1,
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

const defaultBox = (
  center: [number, number, number] = [0, 0, 0],
  halfExtents: [number, number, number] = [0.1, 0.1, 0.1],
): ProjectCollisionBoxV2 => ({
  id: 'default',
  center: [...center],
  halfExtents: [...halfExtents],
  quaternion: [0, 0, 0, 1],
})

function validV2ProjectSnapshot(): WorkcellProjectSnapshotV2 {
  const legacy = validProjectSnapshot()
  return {
    ...legacy,
    manifest: { ...legacy.manifest, schemaVersion: 2 },
    robot: {
      ...legacy.robot,
      links: legacy.robot.links.map((link) => ({
        ...link,
        collisionBoxes: [
          defaultBox([...link.collisionCenter], [...link.collisionHalfExtents]),
        ],
      })),
    },
    objectAssets: legacy.objectAssets.map((asset) => ({
      ...asset,
      collisionBoxes: [
        defaultBox([...asset.colliderCenter], [...asset.collisionHalfExtents]),
      ],
    })),
    collisionPolicy: {
      enabled: true,
      warningDistanceM: 0.02,
      ignoredPairKeys: [],
      enabledRobotSelfPairs: [],
    },
  }
}

describe('portable workcell project contract', () => {
  it('accepts seven Robot links and reusable Object Asset references', () => {
    const snapshot = validProjectSnapshot()

    expect(validateWorkcellProjectSnapshotV1(snapshot)).toBe(snapshot)
  })

  it('rejects a project that does not contain exactly seven Robot links', () => {
    const snapshot = validProjectSnapshot()
    snapshot.robot.links = snapshot.robot.links.slice(0, 6)

    expect(() => validateWorkcellProjectSnapshotV1(snapshot)).toThrow(
      'exactly seven',
    )
  })

  it('rejects an Object Instance that references a missing Object Asset', () => {
    const snapshot = validProjectSnapshot()
    snapshot.objectInstances = [objectInstance('orphan', 'missing-asset')]

    expect(() => validateWorkcellProjectSnapshotV1(snapshot)).toThrow(
      'Object Asset',
    )
  })

  it('rejects duplicate Object Asset ids', () => {
    const snapshot = validProjectSnapshot()
    snapshot.objectAssets = [objectAsset(), objectAsset()]

    expect(() => validateWorkcellProjectSnapshotV1(snapshot)).toThrow('Duplicate')
  })

  it('rejects Object Instance ids that cannot form a Collision Entity id', () => {
    const snapshot = validProjectSnapshot()
    snapshot.objectInstances = [objectInstance('machine|forged-pair')]

    expect(() => validateWorkcellProjectSnapshotV1(snapshot)).toThrow(
      /Object Instance.*separator|Collision Entity/i,
    )
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

    expect(() => validateWorkcellProjectSnapshotV1(snapshot)).toThrow(
      'triangle budget',
    )
  })

  it('rejects scale on fixed MCP and TCP frames', () => {
    const snapshot = validProjectSnapshot()
    snapshot.frames.mcp.scale = [1, 2, 1]

    expect(() => validateWorkcellProjectSnapshotV1(snapshot)).toThrow(/scale/i)
  })
})

describe('portable workcell project V2 collision contract', () => {
  it('keeps the V1 literal independent from the current schema version', () => {
    expect(WORKCELL_PROJECT_SCHEMA_VERSION_V1).toBe(1)
    expect(WORKCELL_PROJECT_SCHEMA_VERSION).toBe(2)
  })

  it('normalizes and owns Compound Boxes and policy pair-key arrays', () => {
    const snapshot = validV2ProjectSnapshot()
    const boxes = snapshot.robot.links[0]!.collisionBoxes
    boxes[0]!.quaternion = [0, 0, 0, 2]
    boxes.push({
      id: 'secondary',
      center: [0.2, 0, 0],
      halfExtents: [0.05, 0.06, 0.07],
      quaternion: [0, 0, 1, 1],
    })
    snapshot.collisionPolicy.ignoredPairKeys = [
      'object:machine-02|robot-link:LINK01',
      'object:machine-01|robot-link:LINK00',
      'object:machine-02|robot-link:LINK01',
    ]

    const normalized = validateWorkcellProjectSnapshot(snapshot)

    expect(normalized).not.toBe(snapshot)
    expect(normalized.robot.links[0]!.collisionBoxes).not.toBe(boxes)
    expect(normalized.robot.links[0]!.collisionBoxes[0]!.quaternion).toEqual([
      0, 0, 0, 1,
    ])
    expect(normalized.robot.links[0]!.collisionBoxes[1]!.quaternion[2]).toBeCloseTo(
      Math.SQRT1_2,
    )
    expect(normalized.robot.links[0]!.collisionBoxes[1]!.quaternion[3]).toBeCloseTo(
      Math.SQRT1_2,
    )
    expect(normalized.robot.links[0]!.collisionCenter).toEqual(
      normalized.robot.links[0]!.collisionBoxes[0]!.center,
    )
    expect(normalized.robot.links[0]!.collisionHalfExtents).toEqual(
      normalized.robot.links[0]!.collisionBoxes[0]!.halfExtents,
    )
    expect(normalized.collisionPolicy.ignoredPairKeys).toEqual([
      'object:machine-01|robot-link:LINK00',
      'object:machine-02|robot-link:LINK01',
    ])

    boxes[1]!.center[0] = 99
    snapshot.collisionPolicy.ignoredPairKeys[0] = 'mutated'
    expect(normalized.robot.links[0]!.collisionBoxes[1]!.center[0]).toBe(0.2)
    expect(normalized.collisionPolicy.ignoredPairKeys[0]).toBe(
      'object:machine-01|robot-link:LINK00',
    )
  })

  it.each([
    ['an empty canonical array', () => [] as ProjectCollisionBoxV2[]],
    [
      'duplicate Box ids',
      () => [defaultBox(), { ...defaultBox(), center: [0.2, 0, 0] }],
    ],
    [
      'a non-positive half extent',
      () => [{ ...defaultBox(), halfExtents: [0.1, 0, 0.1] }],
    ],
    [
      'a non-finite quaternion',
      () => [{ ...defaultBox(), quaternion: [0, 0, Number.NaN, 1] }],
    ],
    [
      'more than sixteen Boxes',
      () => Array.from({ length: 17 }, (_, index) => ({
        ...defaultBox(),
        id: `box-${index}`,
      })),
    ],
  ])('rejects %s instead of falling back to legacy bounds', (_label, boxes) => {
    const snapshot = validV2ProjectSnapshot()
    snapshot.robot.links[0]!.collisionBoxes = boxes() as ProjectCollisionBoxV2[]

    expect(() => validateWorkcellProjectSnapshot(snapshot)).toThrow(/Box|collision/i)
  })

  it('rejects projects above the total Compound Box budget', () => {
    const snapshot = validV2ProjectSnapshot()
    const boxesPerAsset = 16
    const assetCount = Math.ceil(
      (MAX_COLLISION_BOXES_PER_PROJECT - snapshot.robot.links.length + 1) /
        boxesPerAsset,
    )
    snapshot.objectAssets = Array.from({ length: assetCount }, (_, assetIndex) => ({
      ...objectAsset(`asset-${assetIndex}`),
      collisionBoxes: Array.from({ length: boxesPerAsset }, (_, boxIndex) => ({
        ...defaultBox(),
        id: `box-${boxIndex}`,
      })),
    }))
    snapshot.objectInstances = []

    expect(() => validateWorkcellProjectSnapshot(snapshot)).toThrow(/1,024|project.*Box/i)
  })

  it('rejects a negative collision warning distance', () => {
    const snapshot = validV2ProjectSnapshot()
    snapshot.collisionPolicy.warningDistanceM = -0.01

    expect(() => validateWorkcellProjectSnapshot(snapshot)).toThrow(/warning distance/i)
  })
})
