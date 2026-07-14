import {
  canonicalMechanicsBytesV3,
  type ProjectRigidTransformV3,
  type WorkcellProjectSnapshotV3,
} from '../../domain/project/project-v3'
import { CRB15000_DEFINITION, type RobotLinkId } from '../../domain/robot/crb15000'
import {
  createProjectHashService,
  createProjectRevisionIdentityHasher,
} from '../../lib/hash/sha256'

const LINK_IDS = [
  'LINK00', 'LINK01', 'LINK02', 'LINK03', 'LINK04', 'LINK05', 'LINK06',
] as const satisfies readonly RobotLinkId[]

const IDENTITY = {
  position: [0, 0, 0] as [number, number, number],
  quaternion: [0, 0, 0, 1] as [number, number, number, number],
  scale: [1, 1, 1] as [1, 1, 1],
} satisfies ProjectRigidTransformV3

export interface RepositoryProjectFixtureOptions {
  readonly projectId?: string
  readonly name?: string
  readonly robotBytes?: readonly number[]
  readonly objectStepAssets?: readonly {
    readonly id: string
    readonly bytes: readonly number[]
  }[]
}

export async function repositoryProjectFixture(
  options: RepositoryProjectFixtureOptions = {},
): Promise<WorkcellProjectSnapshotV3> {
  const hashService = createProjectHashService({ subtle: globalThis.crypto.subtle })
  const revisionHasher = createProjectRevisionIdentityHasher(hashService)
  const sourceBytes = Uint8Array.from(options.robotBytes ?? [1, 2, 3]).buffer
  const sourceDigest = await hashService.sha256(sourceBytes)
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
  const objectAssets = (options.objectStepAssets ?? []).map(({ id, bytes }) => ({
    id,
    name: id,
    sourceKind: 'step' as const,
    sourceFileName: `${id}.step`,
    sourceBytes: Uint8Array.from(bytes).buffer,
    importScale: 1,
    originMode: 'source' as const,
    colliderCenter: [0, 0, 0] as [number, number, number],
    collisionHalfExtents: [0.1, 0.1, 0.1] as [number, number, number],
    collisionBoxes: [{
      id: 'default',
      center: [0, 0, 0] as [number, number, number],
      halfExtents: [0.1, 0.1, 0.1] as [number, number, number],
      quaternion: [0, 0, 0, 1] as [number, number, number, number],
    }],
    statistics: { vertices: 3, triangles: 1, meshes: 1, materials: 1 },
  }))
  return {
    manifest: {
      format: 'WebDigitalTwinProject',
      schemaVersion: 3,
      projectId: options.projectId ?? 'repository-project',
      name: options.name ?? 'Repository fixture',
      createdAt: '2026-07-13T00:00:00.000Z',
      updatedAt: '2026-07-13T00:00:00.000Z',
    },
    robot: {
      name: 'Robot',
      basePosition: [0, 0, 0],
      baseRotationDeg: [0, 0, 0],
      sources: [{
        id: sourceDigest,
        sha256: sourceDigest,
        sourceFileName: 'robot.step',
        sourceBytes,
        detectedUnit: 'meter',
        selectedSourceUnit: 'meter',
        unitDecision: 'detected',
        sourceToMeters: 1,
        parserVersion: 'occt-import-js@0.0.23',
        statistics: { vertices: 3, triangles: 1, meshes: 1, materials: 1 },
      }],
      links: LINK_IDS.map((linkId, index) => ({
        linkId,
        sourceRefs: [{
          sourceAssetId: sourceDigest,
          nodePath: [-1, index],
          nodeName: `legacy-whole-source:${linkId}`,
          meshIndices: [0],
        }],
        coordinateMode: 'link-local' as const,
        zeroPoseLocalization: structuredClone(IDENTITY),
        operatorAdjustment: structuredClone(IDENTITY),
        visible: true,
        collisionBoxes: [{
          id: 'default',
          center: [0, 0, 0],
          halfExtents: [0.1, 0.1, 0.1],
          quaternion: [0, 0, 0, 1],
        }],
        statistics: { vertices: 3, triangles: 1, meshes: 1, materials: 1 },
      })),
      mechanics,
      mechanicsProvenance: {
        kind: 'manual',
        canonicalSha256: await revisionHasher.hashRevisionIdentity(
          canonicalMechanicsBytesV3(mechanics),
        ),
      },
    },
    frames: { mcp: IDENTITY, tcp: IDENTITY },
    simulation: {
      activeJobId: 'job-a',
      jobs: [
        { id: 'job-a', name: 'First', revision: 1, poses: [] },
        { id: 'job-b', name: 'Second', revision: 1, poses: [] },
      ],
    },
    objectAssets,
    objectInstances: [],
    builtInEquipment: [],
    externalEntities: [],
    opcUa: {
      endpointUrl: 'opc.tcp://127.0.0.1:4840',
      samplingIntervalMs: 100,
      joints: CRB15000_DEFINITION.joints.map(({ id }) => ({
        id,
        nodeId: `ns=2;s=${id}`,
        scale: 1,
        offset: 0,
      })),
      numericStatusBindings: [],
      equipmentTransforms: [],
    },
    collisionPolicy: {
      enabled: true,
      warningDistanceM: 0.02,
      ignoredPairKeys: [],
      enabledRobotSelfPairs: [],
    },
  }
}
