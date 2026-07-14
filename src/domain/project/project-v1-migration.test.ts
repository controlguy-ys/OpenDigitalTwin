import { describe, expect, it, vi } from 'vitest'
import { CRB15000_DEFINITION, type RobotLinkId } from '../robot/crb15000'
import {
  WORKCELL_PROJECT_FORMAT,
  WORKCELL_PROJECT_SCHEMA_VERSION_V1,
  type WorkcellProjectSnapshotV1,
} from './project'
import { migrateV1ToV2 } from './project-v1-migration'
import { migrateProjectToV3 } from './project-v2-migration'
import { createProjectSourceMigrationFoundationInternalV1 } from './project-v3'
import {
  createProjectHashService,
  createProjectRevisionIdentityHasher,
  createProjectSourceDigest,
} from '../../lib/hash/sha256'

const LINK_IDS = [
  'LINK00', 'LINK01', 'LINK02', 'LINK03', 'LINK04', 'LINK05', 'LINK06',
] as const satisfies readonly RobotLinkId[]

function transform(position: [number, number, number]) {
  return {
    position: [...position] as [number, number, number],
    quaternion: [0, 0, 0, 1] as [number, number, number, number],
    scale: [1, 1, 1] as [number, number, number],
  }
}

function v1Snapshot(): WorkcellProjectSnapshotV1 {
  return {
    manifest: {
      format: WORKCELL_PROJECT_FORMAT,
      schemaVersion: WORKCELL_PROJECT_SCHEMA_VERSION_V1,
      projectId: 'legacy-project',
      name: 'Legacy workcell',
      createdAt: '2026-07-13T00:00:00.000Z',
      updatedAt: '2026-07-13T00:00:00.000Z',
    },
    robot: {
      name: 'Legacy Robot',
      basePosition: [0.1, 0.2, 0.3],
      baseRotationDeg: [10, 20, 30],
      links: LINK_IDS.map((linkId, index) => ({
        linkId,
        sourceFileName: `${linkId}.step`,
        sourceBytes: new Uint8Array([index + 1]).buffer,
        localTransform: transform([index / 100, 0, 0]),
        visible: index !== 2,
        collisionCenter: [index / 10, 0, 0],
        collisionHalfExtents: [0.1, 0.2, 0.3],
        statistics: { vertices: 3, triangles: 1, meshes: 1, materials: 1 },
      })),
      joints: CRB15000_DEFINITION.joints.map((joint) => ({
        ...joint,
        origin: [...joint.origin],
        axis: [...joint.axis],
        maxVelocityDegPerSec: 180,
      })),
    },
    frames: { mcp: transform([0.4, 0.5, 0.6]), tcp: transform([0, 0, 0.1]) },
    objectAssets: [{
      id: 'asset-01',
      name: 'Machine',
      sourceFileName: 'machine.step',
      sourceBytes: new Uint8Array([8, 9]).buffer,
      importScale: 0.001,
      originMode: 'source',
      colliderCenter: [0, 0, 0.2],
      collisionHalfExtents: [0.5, 0.4, 0.3],
      statistics: { vertices: 3, triangles: 1, meshes: 1, materials: 1 },
    }],
    objectInstances: [{
      id: 'machine-01',
      assetId: 'asset-01',
      name: 'Machine 01',
      transform: transform([1, 2, 3]),
      numericStatus: 7,
      statusSource: 'manual',
      statusOverlayVisible: true,
      visible: true,
    }],
    poses: [],
    opcUa: {
      endpointUrl: 'opc.tcp://127.0.0.1:4840',
      samplingIntervalMs: 100,
      joints: CRB15000_DEFINITION.joints.map(({ id }) => ({
        id,
        nodeId: `ns=2;s=${id}`,
        scale: 1,
        offset: 0,
      })),
      equipment: [],
    },
  }
}

describe('V1 to V2 project migration', () => {
  it('creates one identity-rotation default Box for every legacy collider', () => {
    const source = v1Snapshot()
    const migrated = migrateV1ToV2(source)

    expect(migrated.manifest.schemaVersion).toBe(2)
    for (const [index, link] of migrated.robot.links.entries()) {
      expect(link.collisionBoxes).toEqual([{
        id: 'default',
        center: [index / 10, 0, 0],
        halfExtents: [0.1, 0.2, 0.3],
        quaternion: [0, 0, 0, 1],
      }])
    }
    expect(migrated.objectAssets[0]!.collisionBoxes).toEqual([{
      id: 'default',
      center: [0, 0, 0.2],
      halfExtents: [0.5, 0.4, 0.3],
      quaternion: [0, 0, 0, 1],
    }])
    expect(migrated.collisionPolicy).toEqual({
      enabled: true,
      warningDistanceM: 0.02,
      ignoredPairKeys: [],
      enabledRobotSelfPairs: [],
    })
  })

  it('preserves visible transforms and owns all migrated arrays and bytes', () => {
    const source = v1Snapshot()
    const migrated = migrateV1ToV2(source)

    expect(migrated.robot.basePosition).toEqual(source.robot.basePosition)
    expect(migrated.robot.baseRotationDeg).toEqual(source.robot.baseRotationDeg)
    expect(migrated.frames).toEqual(source.frames)
    expect(migrated.robot.links.map(({ visible }) => visible)).toEqual(
      source.robot.links.map(({ visible }) => visible),
    )
    expect(migrated.objectInstances[0]!.transform).toEqual(
      source.objectInstances[0]!.transform,
    )

    source.robot.basePosition = [99, 0.2, 0.3]
    source.robot.links[0]!.localTransform.position[0] = 99
    source.robot.links[0]!.collisionCenter[0] = 99
    new Uint8Array(source.robot.links[0]!.sourceBytes)[0] = 99
    source.frames.mcp.position[0] = 99
    source.objectInstances[0]!.transform.position[0] = 99

    expect(migrated.robot.basePosition[0]).toBe(0.1)
    expect(migrated.robot.links[0]!.localTransform.position[0]).toBe(0)
    expect(migrated.robot.links[0]!.collisionBoxes[0]!.center[0]).toBe(0)
    expect(new Uint8Array(migrated.robot.links[0]!.sourceBytes)[0]).toBe(1)
    expect(migrated.frames.mcp.position[0]).toBe(0.4)
    expect(migrated.objectInstances[0]!.transform.position[0]).toBe(1)
  })

  it('dispatches through the owned V1 to V2 path before one V2 to V3 migration', async () => {
    const hashService = createProjectHashService({ subtle: globalThis.crypto.subtle })
    const analyzeLegacyRobotSource = vi.fn(async ({ tokenId, generation, sourceBytes }) => ({
      tokenId,
      generation,
      sourceBytes,
      analysis: { detectedUnit: 'meter' as const, meshIndices: [0] },
    }))
    const foundation = createProjectSourceMigrationFoundationInternalV1({
      sourceDigest: createProjectSourceDigest(hashService),
      lockedLegacyAnalyzer: analyzeLegacyRobotSource,
    })
    const sourceStaging = foundation.sourceStaging
    const source = v1Snapshot()
    const before = structuredClone(source)
    const migrated = await migrateProjectToV3(source, {
      sourceStaging,
      projectRevisionIdentityHasher: createProjectRevisionIdentityHasher(hashService),
      builtInEquipmentDefaults: [],
      builtInEquipmentTransformDefaults: [],
    })

    expect(migrated.projection.manifest.schemaVersion).toBe(3)
    expect(migrated.projection.robot.links[0]!.collisionBoxes).toEqual([{
      id: 'default',
      center: [0, 0, 0],
      halfExtents: [0.1, 0.2, 0.3],
      quaternion: [0, 0, 0, 1],
    }])
    expect(analyzeLegacyRobotSource).toHaveBeenCalledTimes(7)
    expect(source).toEqual(before)
  })
})
