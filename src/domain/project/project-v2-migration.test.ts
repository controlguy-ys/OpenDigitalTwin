import { describe, expect, it, vi } from 'vitest'
import { CRB15000_DEFINITION, type RobotLinkId } from '../robot/crb15000'
import type { SerializableTransform } from '../equipment/equipment'
import {
  computeRobotWorldMatrices,
  type RobotGeometryTransforms,
  type RobotKinematicDefinition,
  type RobotToolFrameTransforms,
} from '../robot/kinematics'
import {
  composePose3D,
  pose3DToSerializableTransform,
  rpyToQuaternion,
  serializableTransformToPose3D,
} from '../frames/pose3d'
import {
  WORKCELL_PROJECT_FORMAT,
  WORKCELL_PROJECT_SCHEMA_VERSION_V2,
  type WorkcellProjectSnapshotV2,
} from './project'
import {
  createProjectSourceMigrationFoundationInternalV1,
  deriveCanonicalPoseDurationMsV3,
  type LegacyProjectArchiveReaderV1,
  type LegacyProjectArchiveSourcePlanV1,
  type PreparedLegacyArchiveProjectV1,
  type ProjectBuiltInEquipmentRecordV3,
  type ProjectExternalEntityTransformStateV3,
} from './project-v3'
import {
  PROJECT_V2_BUILT_IN_EQUIPMENT_RESTORED_WARNING,
  canonicalMechanicsBytesV3,
  migrateProjectToV3,
  migratePreparedLegacyArchiveProjectToV3InternalV1,
  prepareLegacyArchiveProjectForMigrationInternalV1,
  verifyProjectCryptographicProvenanceV3,
  type ProjectV3MigrationDependencies,
} from './project-v2-migration'
import {
  createProjectHashService,
  createProjectRevisionIdentityHasher,
  createProjectSourceDigest,
  type ProjectHashService,
} from '../../lib/hash/sha256'
import {
  type ProjectSourceLockedLeaseWorkerV1,
} from '../../features/project/project-source-staging'
import { WORKBENCH_TOP_Z } from '../../features/scene/workcell-constants'

const LINK_IDS = [
  'LINK00', 'LINK01', 'LINK02', 'LINK03', 'LINK04', 'LINK05', 'LINK06',
] as const satisfies readonly RobotLinkId[]
const IDENTITY = {
  position: [0, 0, 0] as [number, number, number],
  quaternion: [0, 0, 0, 1] as [number, number, number, number],
  scale: [1, 1, 1] as [number, number, number],
}
const TOOL0 = {
  position: [0, 0, 0] as [number, number, number],
  quaternion: [
    0, 0.7071067811865476, 0, 0.7071067811865476,
  ] as [number, number, number, number],
  scale: [1, 1, 1] as [number, number, number],
}
const BUILT_IN_DEFAULTS: readonly ProjectBuiltInEquipmentRecordV3[] = [{
  id: 'cup-01',
  name: 'Cup 01',
  kind: 'cup',
  status: 'RUNNING',
  manualNumericStatus: 0,
  statusSource: 'manual',
  statusOverlayVisible: true,
  graspable: true,
  collisionHalfExtents: [0.055, 0.055, 0.075],
  stackLightAnchor: null,
}]
const BUILT_IN_TRANSFORM_DEFAULTS: readonly ProjectExternalEntityTransformStateV3[] = [{
  entityId: 'equipment:cup-01',
  manualTransform: {
    position: [0.75, 0, 1.15],
    quaternion: [0, 0, 0, 1],
    scale: [1, 1, 1],
  },
  transformSource: 'manual',
}]

function transform(position: [number, number, number] = [0, 0, 0]) {
  return {
    position: [...position] as [number, number, number],
    quaternion: [0, 0, 0, 1] as [number, number, number, number],
    scale: [1, 1, 1] as [number, number, number],
  }
}

function mutableTransform(value: {
  readonly position: readonly [number, number, number]
  readonly quaternion: readonly [number, number, number, number]
  readonly scale: readonly [number, number, number]
}): SerializableTransform {
  return {
    position: [...value.position],
    quaternion: [...value.quaternion],
    scale: [...value.scale],
  }
}

function robotRootPose(
  mcp: Parameters<typeof mutableTransform>[0],
  basePosition: readonly [number, number, number],
  baseRotationDeg: readonly [number, number, number],
) {
  return pose3DToSerializableTransform(composePose3D(
    composePose3D(
      serializableTransformToPose3D(mutableTransform(mcp)),
      { position: [0, 0, WORKBENCH_TOP_Z], quaternion: [0, 0, 0, 1] },
    ),
    {
      position: basePosition,
      quaternion: rpyToQuaternion(baseRotationDeg.map(
        (value) => value * Math.PI / 180,
      ) as [number, number, number]),
    },
  ))
}

function expectMatrixWithin(
  actual: readonly number[],
  expected: readonly number[],
  tolerance = 1e-9,
): void {
  expect(actual).toHaveLength(16)
  expect(expected).toHaveLength(16)
  actual.forEach((value, index) => {
    expect(Math.abs(value - expected[index]!)).toBeLessThanOrEqual(tolerance)
  })
}

function validV2Project(
  overrides: Partial<Pick<WorkcellProjectSnapshotV2, 'poses'>> = {},
): WorkcellProjectSnapshotV2 {
  return {
    manifest: {
      format: WORKCELL_PROJECT_FORMAT,
      schemaVersion: WORKCELL_PROJECT_SCHEMA_VERSION_V2,
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
        sourceBytes: Uint8Array.from([index + 1]).buffer,
        localTransform: transform([index / 100, 0, 0]),
        visible: index !== 2,
        collisionCenter: [0, 0, 0],
        collisionHalfExtents: [0.1, 0.2, 0.3],
        collisionBoxes: [{
          id: 'default',
          center: [0, 0, 0],
          halfExtents: [0.1, 0.2, 0.3],
          quaternion: [0, 0, 0, 1],
        }],
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
      mcp: transform([0.4, 0.5, 0.6]),
      tcp: transform([0, 0, 0.1]),
    },
    objectAssets: [{
      id: 'asset-01',
      name: 'Machine',
      sourceFileName: 'machine.step',
      sourceBytes: Uint8Array.from([8, 9]).buffer,
      importScale: 0.001,
      originMode: 'source',
      colliderCenter: [0, 0, 0.2],
      collisionHalfExtents: [0.5, 0.4, 0.3],
      collisionBoxes: [{
        id: 'default',
        center: [0, 0, 0.2],
        halfExtents: [0.5, 0.4, 0.3],
        quaternion: [0, 0, 0, 1],
      }],
      statistics: { vertices: 3, triangles: 1, meshes: 1, materials: 1 },
    }],
    objectInstances: [{
      id: 'object-1',
      assetId: 'asset-01',
      name: 'Machine 01',
      transform: transform([1, 2, 3]),
      numericStatus: 7,
      statusSource: 'manual',
      statusOverlayVisible: true,
      visible: true,
    }],
    poses: overrides.poses ?? [],
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
    collisionPolicy: {
      enabled: true,
      warningDistanceM: 0.02,
      ignoredPairKeys: [],
      enabledRobotSelfPairs: [],
    },
  }
}

function pose(id: string, speedPercentToNext?: number) {
  return {
    id,
    name: `Pose ${id}`,
    anglesDeg: [0, 0, 0, 0, 0, id === 'B' ? 10 : 0] as [number, number, number, number, number, number],
    durationMs: id === 'B' ? 345 : 123,
    easing: 'linear' as const,
    ...(speedPercentToNext === undefined ? {} : { speedPercentToNext }),
  }
}

interface DependenciesResult {
  readonly dependencies: ProjectV3MigrationDependencies
  readonly hashService: ProjectHashService
  readonly digestSource: ProjectHashService['sha256']
  readonly analyzeLegacyRobotSource: ReturnType<typeof vi.fn>
}

function migrationDependencies(
  detectedUnit: 'meter' | 'millimeter' | 'inch' | 'unknown' = 'meter',
  lockedLegacyAnalyzer?: ProjectSourceLockedLeaseWorkerV1,
): DependenciesResult {
  const hashService = createProjectHashService({ subtle: globalThis.crypto.subtle })
  const projectRevisionIdentityHasher = createProjectRevisionIdentityHasher(hashService)
  const nativeSourceDigest = createProjectSourceDigest(hashService)
  const digestSource = vi.fn(nativeSourceDigest.digestSource.bind(nativeSourceDigest))
  const analyzeLegacyRobotSource = vi.fn(lockedLegacyAnalyzer ?? (async ({
    tokenId,
    generation,
    sourceBytes,
  }) => ({
    tokenId,
    generation,
    sourceBytes,
    analysis: { detectedUnit, meshIndices: [0] },
  })))
  const foundation = createProjectSourceMigrationFoundationInternalV1({
    sourceDigest: { digestSource },
    lockedLegacyAnalyzer: analyzeLegacyRobotSource,
  })
  const sourceStaging = foundation.sourceStaging
  return {
    hashService,
    digestSource,
    analyzeLegacyRobotSource,
    dependencies: {
      sourceStaging,
      projectRevisionIdentityHasher,
      builtInEquipmentDefaults: BUILT_IN_DEFAULTS,
      builtInEquipmentTransformDefaults: BUILT_IN_TRANSFORM_DEFAULTS,
    },
  }
}

function legacyArchivePreparation(source = validV2Project()): {
  readonly candidate: WorkcellProjectSnapshotV2
  readonly sources: readonly LegacyProjectArchiveSourcePlanV1[]
  readonly bytesByPath: ReadonlyMap<string, ArrayBuffer>
  readonly reader: LegacyProjectArchiveReaderV1
  readonly readSource: ReturnType<typeof vi.fn>
  readonly finish: ReturnType<typeof vi.fn>
} {
  const candidate = structuredClone(source)
  const bytesByPath = new Map<string, ArrayBuffer>()
  const sources: LegacyProjectArchiveSourcePlanV1[] = []
  for (const [index, link] of candidate.robot.links.entries()) {
    const entryPath = `robot/links/${link.linkId}.step`
    const bytes = source.robot.links[index]!.sourceBytes.slice(0)
    bytesByPath.set(entryPath, bytes)
    link.sourceBytes = new ArrayBuffer(1)
    sources.push({
      namespace: 'robot',
      entryPath,
      ownerKeys: [`robot-link:${link.linkId}`],
      byteLength: bytes.byteLength,
    })
  }
  for (const [index, asset] of candidate.objectAssets.entries()) {
    const entryPath = `objects/assets/${index.toString().padStart(4, '0')}.step`
    const bytes = source.objectAssets[index]!.sourceBytes.slice(0)
    bytesByPath.set(entryPath, bytes)
    asset.sourceBytes = new ArrayBuffer(1)
    sources.push({
      namespace: 'object',
      entryPath,
      ownerKeys: [`object-asset:${asset.id}`],
      byteLength: bytes.byteLength,
    })
  }
  sources.sort((left, right) => left.entryPath < right.entryPath ? -1 : 1)
  const readSource = vi.fn(async (plan: LegacyProjectArchiveSourcePlanV1) =>
    bytesByPath.get(plan.entryPath)!.slice(0))
  const finish = vi.fn()
  return {
    candidate,
    sources: Object.freeze(sources),
    bytesByPath,
    reader: Object.freeze({ readSource, finish }),
    readSource,
    finish,
  }
}

function containsArrayBuffer(value: unknown, seen = new WeakSet<object>()): boolean {
  if (typeof value !== 'object' || value === null || seen.has(value)) return false
  try {
    if (Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'byteLength')?.get?.call(value) !== undefined) {
      return true
    }
  } catch {
    // The value is not an ArrayBuffer in this realm.
  }
  seen.add(value)
  return Reflect.ownKeys(value).some((key) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    return descriptor !== undefined && 'value' in descriptor &&
      containsArrayBuffer(descriptor.value, seen)
  })
}

describe('V2 to V3 project migration', () => {
  it('does not expose a raw owned-buffer adoption port from the runtime foundation', () => {
    const hashService = createProjectHashService({ subtle: globalThis.crypto.subtle })
    const foundation = createProjectSourceMigrationFoundationInternalV1({
      sourceDigest: createProjectSourceDigest(hashService),
      lockedLegacyAnalyzer: async ({ tokenId, generation, sourceBytes }) => ({
        tokenId,
        generation,
        sourceBytes,
        analysis: { detectedUnit: 'meter', meshIndices: [0] },
      }),
    })

    expect(Object.keys(foundation)).toEqual(['sourceStaging'])
    expect(foundation).not.toHaveProperty('ownedSourceStaging')
    expect(foundation).not.toHaveProperty('adoptOwnedSource')
  })

  it('transfer-detaches direct legacy staging input before its first hash await', async () => {
    const source = validV2Project()
    const retainedAlias = source.robot.links[0]!.sourceBytes
    const hashService = createProjectHashService({ subtle: globalThis.crypto.subtle })
    const nativeSourceDigest = createProjectSourceDigest(hashService)
    let firstDigestStarted!: () => void
    const digestStarted = new Promise<void>((resolve) => { firstDigestStarted = resolve })
    let releaseFirstDigest!: () => void
    const digestGate = new Promise<void>((resolve) => { releaseFirstDigest = resolve })
    let calls = 0
    const foundation = createProjectSourceMigrationFoundationInternalV1({
      sourceDigest: {
        async digestSource(bytes, signal) {
          calls += 1
          if (calls === 1) {
            firstDigestStarted()
            await digestGate
          }
          return nativeSourceDigest.digestSource(bytes, signal)
        },
      },
      lockedLegacyAnalyzer: async ({ tokenId, generation, sourceBytes }) => ({
        tokenId,
        generation,
        sourceBytes,
        analysis: { detectedUnit: 'meter', meshIndices: [0] },
      }),
    })

    const pending = foundation.sourceStaging.stageOwnedLegacyProjectSources(source)
    await digestStarted
    const byteLengthDuringHash = retainedAlias.byteLength
    releaseFirstDigest()
    const staged = await pending

    expect(byteLengthDuringHash).toBe(0)
    expect(retainedAlias.byteLength).toBe(0)
    expect(() => new Uint8Array(retainedAlias)).toThrow()
    expect(() => foundation.sourceStaging.assertPrepared(staged[0]!.preparedSource)).not.toThrow()
  })

  it('preserves a caller-owned cross-namespace alias as one independent source per namespace', async () => {
    const source = validV2Project()
    const shared = Uint8Array.from([101, 102, 103]).buffer
    source.robot.links[0]!.sourceBytes = shared
    source.robot.links[1]!.sourceBytes = shared
    source.objectAssets[0]!.sourceBytes = shared
    source.objectAssets.push({
      ...source.objectAssets[0]!,
      id: 'asset-02',
      name: 'Machine Copy',
      sourceBytes: shared,
    })
    const before = structuredClone(source)
    const sharedBefore = [...new Uint8Array(shared)]
    const {
      dependencies,
      hashService,
      digestSource,
      analyzeLegacyRobotSource,
    } = migrationDependencies()
    const expectedDigest = await hashService.sha256(shared)
    const originalStructuredClone = globalThis.structuredClone
    let sourceBearingCopyCalls = 0
    let sourceTransferCalls = 0
    const cloneSpy = vi.spyOn(globalThis, 'structuredClone').mockImplementation(
      ((value: unknown, options?: StructuredSerializeOptions) => {
        if (containsArrayBuffer(value)) {
          if ((options?.transfer?.length ?? 0) > 0) sourceTransferCalls += 1
          else sourceBearingCopyCalls += 1
        }
        return originalStructuredClone(value, options)
      }) as typeof structuredClone,
    )

    try {
      const pending = migrateProjectToV3(source, dependencies)
      const sourceCopiesBeforeFirstAwait = sourceBearingCopyCalls
      const migrated = await pending
      const matchingGroups = migrated.preparedSourceGroups.filter(({ preparedSource }) =>
        preparedSource.sha256 === expectedDigest)
      const robotGroup = matchingGroups.find(({ preparedSource }) =>
        preparedSource.namespace === 'robot')
      const objectGroup = matchingGroups.find(({ preparedSource }) =>
        preparedSource.namespace === 'object')

      expect(sourceCopiesBeforeFirstAwait).toBe(2)
      expect(sourceBearingCopyCalls).toBe(2)
      // Seven ownership transfers plus one outbound and one reclaimed parser
      // lease for each of the six unique Robot sources.
      expect(sourceTransferCalls).toBe(7 + (6 * 2))
      expect(digestSource).toHaveBeenCalledTimes(7)
      expect(analyzeLegacyRobotSource).toHaveBeenCalledTimes(6)
      expect(migrated.preparedSourceGroups).toHaveLength(7)
      expect(matchingGroups).toHaveLength(2)
      expect(robotGroup?.ownerKeys).toEqual([`robot-source:${expectedDigest}`])
      expect(objectGroup?.ownerKeys).toEqual([
        'object-asset:asset-01',
        'object-asset:asset-02',
      ])
      expect(robotGroup?.preparedSource).not.toBe(objectGroup?.preparedSource)
      expect(robotGroup?.preparedSource).not.toHaveProperty('sourceBytes')
      expect(objectGroup?.preparedSource).not.toHaveProperty('sourceBytes')
      expect(migrated.projection.robot.sources.filter(({ id }) =>
        id === expectedDigest)).toHaveLength(1)
      expect(migrated.projection.robot.links.slice(0, 2).map((link) =>
        link.sourceRefs[0]!.sourceAssetId)).toEqual([expectedDigest, expectedDigest])
      expect(migrated.projection.objectAssets.map((asset) =>
        asset.sourceKind === 'step' ? asset.sourceSha256 : undefined)).toEqual([
        expectedDigest,
        expectedDigest,
      ])
      expect(source).toEqual(before)
      expect(source.robot.links[0]!.sourceBytes).toBe(shared)
      expect(source.robot.links[1]!.sourceBytes).toBe(shared)
      expect(source.objectAssets[0]!.sourceBytes).toBe(shared)
      expect(source.objectAssets[1]!.sourceBytes).toBe(shared)
      expect(shared.byteLength).toBe(sharedBefore.length)
      expect([...new Uint8Array(shared)]).toEqual(sharedBefore)
    } finally {
      cloneSpy.mockRestore()
    }
  })

  it('moves a non-empty flat Pose list into exactly one active Default Job', async () => {
    const source = validV2Project({ poses: [pose('A', 40), pose('B', 100)] })
    const { dependencies } = migrationDependencies()
    const migrated = await migrateProjectToV3(source, dependencies)

    expect(migrated.projection.simulation).toMatchObject({
      activeJobId: 'job-default',
      jobs: [{
        id: 'job-default',
        name: 'Default Job',
        revision: 1,
        poses: [
          expect.objectContaining({ id: 'A', speedPercentToNext: 40 }),
          expect.objectContaining({ id: 'B', speedPercentToNext: 100, durationMs: 1000 }),
        ],
      }],
    })
    const poses = migrated.projection.simulation.jobs[0]!.poses
    expect(poses[0]!.durationMs).toBe(deriveCanonicalPoseDurationMsV3(
      poses[0]!, poses[1]!, migrated.projection.robot.mechanics,
    ))
    expect(migrated.warnings.filter((warning) =>
      warning === 'PROJECT_LEGACY_POSE_DURATION_NORMALIZED')).toHaveLength(1)
  })

  it('moves an empty flat Pose list into one empty active Default Job', async () => {
    const { dependencies } = migrationDependencies()
    const migrated = await migrateProjectToV3(validV2Project({ poses: [] }), dependencies)
    expect(migrated.projection.simulation).toEqual({
      activeJobId: 'job-default',
      jobs: [{ id: 'job-default', name: 'Default Job', revision: 1, poses: [] }],
    })
  })

  it('defaults missing speed and preserves exact terminal timing', async () => {
    const { dependencies } = migrationDependencies()
    const source = validV2Project({ poses: [pose('A'), pose('B')] })
    const migrated = await migrateProjectToV3(source, dependencies)
    expect(migrated.projection.simulation.jobs[0]!.poses.map((entry) =>
      entry.speedPercentToNext)).toEqual([100, 100])
    expect(migrated.projection.simulation.jobs[0]!.poses[1]!.durationMs).toBe(1000)
  })

  it('rejects an out-of-limit legacy Pose without clamping or partial migration', async () => {
    const source = validV2Project({ poses: [pose('A')] })
    const maximum = source.robot.joints[2]!.maxDeg
    source.poses[0]!.anglesDeg[2] = maximum + 1e-9
    const before = structuredClone(source)
    const { dependencies } = migrationDependencies()

    await expect(migrateProjectToV3(source, dependencies)).rejects.toMatchObject({
      code: 'PROJECT_LEGACY_POSE_OUT_OF_LIMITS',
      totalCount: 1,
      details: [expect.objectContaining({ poseId: 'A', jointId: 'J3' })],
    })
    expect(source).toEqual(before)
  })

  it('stores byte-identical legacy Link sources once and retains seven Link refs', async () => {
    const source = validV2Project()
    const shared = Uint8Array.from([1, 2, 3]).buffer
    for (const link of source.robot.links) link.sourceBytes = shared
    const { dependencies, analyzeLegacyRobotSource } = migrationDependencies()
    const migrated = await migrateProjectToV3(source, dependencies)

    expect(migrated.projection.robot.sources).toHaveLength(1)
    expect(migrated.projection.robot.links).toHaveLength(7)
    expect(new Set(migrated.projection.robot.links.map((link) =>
      link.sourceRefs[0]!.sourceAssetId))).toEqual(
      new Set([migrated.projection.robot.sources[0]!.id]),
    )
    expect(migrated.projection.robot.links.map((link) =>
      link.sourceRefs[0]!.nodePath)).toEqual(
      LINK_IDS.map((_linkId, index) => [-1, index]),
    )
    expect(migrated.projection.robot.links[0]!.operatorAdjustment).not.toBe(
      migrated.projection.robot.links[1]!.operatorAdjustment,
    )
    expect(migrated.projection.robot.links[0]!.sourceRefs[0]!.meshIndices).not.toBe(
      migrated.projection.robot.links[1]!.sourceRefs[0]!.meshIndices,
    )
    expect(analyzeLegacyRobotSource).toHaveBeenCalledTimes(1)
  })

  it('uses canonical Link-id ordinals when valid legacy Links are reordered', async () => {
    const source = validV2Project()
    ;[source.robot.links[0], source.robot.links[1]] = [
      source.robot.links[1]!,
      source.robot.links[0]!,
    ]
    const { dependencies } = migrationDependencies()

    const migrated = await migrateProjectToV3(source, dependencies)
    expect(migrated.projection.robot.links.map(({ linkId }) => linkId)).toEqual(LINK_IDS)
    expect(Object.fromEntries(migrated.projection.robot.links.map((link) => [
      link.linkId,
      link.sourceRefs[0]!.nodePath,
    ]))).toEqual(Object.fromEntries(LINK_IDS.map((linkId, index) => [
      linkId,
      [-1, index],
    ])))
    const canonical = await migrateProjectToV3(
      validV2Project(),
      migrationDependencies().dependencies,
    )
    expect(JSON.stringify(migrated.projection)).toBe(JSON.stringify(canonical.projection))
  })

  it('fills deterministic Mechanics, Tool0, provenance, and warnings', async () => {
    const { dependencies, hashService } = migrationDependencies()
    const migrated = await migrateProjectToV3(validV2Project(), dependencies)

    expect(migrated.projection.robot.mechanics.joints[0]).toMatchObject({
      homeDeg: 0,
      zeroOffsetDeg: 0,
      direction: 1,
    })
    expect(migrated.projection.robot.mechanics.flange).toEqual(IDENTITY)
    expect(migrated.projection.robot.mechanics.tool0).toEqual(TOOL0)
    expect(migrated.warnings.filter((warning) =>
      warning === 'PROJECT_V2_MECHANICS_DEFAULTED')).toHaveLength(1)
    expect(migrated.warnings.filter((warning) =>
      warning === PROJECT_V2_BUILT_IN_EQUIPMENT_RESTORED_WARNING)).toHaveLength(1)
    expect(migrated.projection.robot.mechanicsProvenance.kind).toBe('manual')
    await expect(verifyProjectCryptographicProvenanceV3(
      migrated.projection,
      createProjectRevisionIdentityHasher(hashService),
    )).resolves.toBeUndefined()
    const expectedDigest = await hashService.sha256(
      canonicalMechanicsBytesV3(migrated.projection.robot.mechanics),
    )
    expect(migrated.projection.robot.mechanicsProvenance).toEqual({
      kind: 'manual',
      canonicalSha256: expectedDigest,
    })
  })

  it('preserves zero-pose Link matrices and a commanded TCP world matrix', async () => {
    const source = validV2Project()
    const migrated = await migrateProjectToV3(
      source,
      migrationDependencies().dependencies,
    )
    const legacyGeometry = Object.fromEntries(source.robot.links.map((link) => [
      link.linkId,
      link.localTransform,
    ])) as RobotGeometryTransforms
    const migratedGeometry = Object.fromEntries(migrated.projection.robot.links.map((link) => [
      link.linkId,
      link.zeroPoseLocalization,
    ])) as RobotGeometryTransforms
    const migratedDefinition: RobotKinematicDefinition = {
      id: migrated.projection.robot.name,
      baseLink: 'LINK00',
      joints: migrated.projection.robot.mechanics.joints.map((joint) => ({
        id: joint.id,
        parentLink: joint.parentLink,
        childLink: joint.childLink,
        origin: joint.originM,
        axis: joint.axis,
        minDeg: joint.minDeg,
        maxDeg: joint.maxDeg,
      })),
      toolRotationYRad: 0,
    }
    const legacyToolFrames: RobotToolFrameTransforms = {
      flange: IDENTITY,
      tool: TOOL0,
      tcp: source.frames.tcp,
    }
    const migratedToolFrames: RobotToolFrameTransforms = {
      flange: mutableTransform(migrated.projection.robot.mechanics.flange),
      tool: mutableTransform(migrated.projection.robot.mechanics.tool0),
      tcp: mutableTransform(migrated.projection.frames.tcp),
    }
    const legacyRoot = robotRootPose(
      source.frames.mcp,
      source.robot.basePosition,
      source.robot.baseRotationDeg,
    )
    const migratedRoot = robotRootPose(
      migrated.projection.frames.mcp,
      migrated.projection.robot.basePosition,
      migrated.projection.robot.baseRotationDeg,
    )
    const zeroAngles = [0, 0, 0, 0, 0, 0] as const
    const legacyZero = computeRobotWorldMatrices(
      CRB15000_DEFINITION,
      legacyGeometry,
      legacyToolFrames,
      zeroAngles,
      legacyRoot,
    )
    const migratedZero = computeRobotWorldMatrices(
      migratedDefinition,
      migratedGeometry,
      migratedToolFrames,
      zeroAngles,
      migratedRoot,
    )

    for (const linkId of LINK_IDS) {
      expectMatrixWithin(migratedZero.linkSlots[linkId], legacyZero.linkSlots[linkId])
      expectMatrixWithin(migratedZero.linkGeometry[linkId], legacyZero.linkGeometry[linkId])
    }

    const commandedAngles = [35, -42, 18, 71, -33, 109] as const
    const legacyCommanded = computeRobotWorldMatrices(
      CRB15000_DEFINITION,
      legacyGeometry,
      legacyToolFrames,
      commandedAngles,
      legacyRoot,
    )
    const migratedCommanded = computeRobotWorldMatrices(
      migratedDefinition,
      migratedGeometry,
      migratedToolFrames,
      commandedAngles,
      migratedRoot,
    )
    expectMatrixWithin(migratedCommanded.tcp, legacyCommanded.tcp)
  })

  it('rejects inconsistent Manual Mechanics provenance asynchronously', async () => {
    const { dependencies, hashService } = migrationDependencies()
    const migrated = await migrateProjectToV3(validV2Project(), dependencies)
    const projection = structuredClone(migrated.projection)
    ;(projection.robot as unknown as {
      mechanicsProvenance: { kind: 'manual'; canonicalSha256: string }
    }).mechanicsProvenance = {
      kind: 'manual',
      canonicalSha256: '0'.repeat(64),
    }
    await expect(verifyProjectCryptographicProvenanceV3(
      projection,
      createProjectRevisionIdentityHasher(hashService),
    )).rejects.toMatchObject({
      code: 'PROJECT_MANUAL_MECHANICS_DIGEST_MISMATCH',
    })
  })

  it('hashes the exact normalized Mechanics returned by V3 validation', async () => {
    const source = validV2Project()
    source.robot.joints[0]!.axis = [
      3.480865334724874,
      -4.2433765466883315,
      4.252336924505995,
    ]
    const { dependencies, hashService } = migrationDependencies()

    const migrated = await migrateProjectToV3(source, dependencies)
    await expect(verifyProjectCryptographicProvenanceV3(
      migrated.projection,
      createProjectRevisionIdentityHasher(hashService),
    )).resolves.toBeUndefined()
  })

  it.each(['mcp', 'tcp'] as const)(
    'rejects a non-rigid legacy %s frame before returning a candidate',
    async (field) => {
      const source = validV2Project()
      source.frames[field].scale = [1, 2, 1]
      const before = structuredClone(source)
      const { dependencies } = migrationDependencies()
      await expect(migrateProjectToV3(source, dependencies)).rejects.toMatchObject({
        code: 'PROJECT_LEGACY_FRAME_NON_RIGID',
      })
      expect(source).toEqual(before)
    },
  )

  it('fails an unknown legacy source unit without publishing a partial snapshot', async () => {
    const source = validV2Project()
    const before = structuredClone(source)
    const { dependencies } = migrationDependencies('unknown')
    await expect(migrateProjectToV3(source, dependencies)).rejects.toMatchObject({
      code: 'ROBOT_STEP_UNIT_REQUIRED',
    })
    expect(source).toEqual(before)
  })

  it('moves Object transforms and numeric Status bindings without invention', async () => {
    const source = validV2Project()
    source.objectInstances[0]!.statusSource = 'opcua'
    source.opcUa.equipment = [{
      instanceId: 'object-1',
      nodeId: 'ns=2;s=Object.Status',
      scale: 2,
      offset: -1,
    }]
    const { dependencies } = migrationDependencies()
    const migrated = await migrateProjectToV3(source, dependencies)

    expect(migrated.projection.objectInstances[0]).toEqual({
      id: 'object-1',
      assetId: 'asset-01',
      name: 'Machine 01',
      manualNumericStatus: 7,
      statusSource: 'opcua',
      statusOverlayVisible: true,
      visible: true,
      graspable: false,
    })
    expect(migrated.projection.externalEntities).toContainEqual({
      entityId: 'object:object-1',
      manualTransform: transform([1, 2, 3]),
      transformSource: 'manual',
    })
    expect(migrated.projection.opcUa.numericStatusBindings).toEqual([{
      entityId: 'object:object-1',
      nodeId: 'ns=2;s=Object.Status',
      scale: 2,
      offset: -1,
    }])
    expect(migrated.projection.opcUa.equipmentTransforms).toEqual([])
    expect(migrated.warnings.filter((warning) =>
      warning === 'PROJECT_V2_STATUS_FALLBACK_ASSUMED')).toHaveLength(1)
  })

  it('normalizes an unbound legacy OPC numeric source to Manual fallback', async () => {
    const source = validV2Project()
    source.objectInstances[0]!.statusSource = 'opcua'
    const { dependencies } = migrationDependencies()
    const migrated = await migrateProjectToV3(source, dependencies)
    expect(migrated.projection.objectInstances[0]).toMatchObject({
      statusSource: 'manual',
      manualNumericStatus: 7,
    })
    expect(migrated.warnings).toContain('PROJECT_V2_STATUS_FALLBACK_ASSUMED')
  })

  it('rejects malformed built-in default pairs without mutating the input', async () => {
    const source = validV2Project()
    const before = structuredClone(source)
    const { dependencies } = migrationDependencies()
    const invalidDependencies: ProjectV3MigrationDependencies = {
      ...dependencies,
      builtInEquipmentTransformDefaults: [{
        ...BUILT_IN_TRANSFORM_DEFAULTS[0]!,
        entityId: 'equipment:orphan',
      }],
    }
    await expect(migrateProjectToV3(source, invalidDependencies)).rejects.toMatchObject({
      code: 'PROJECT_BUILT_IN_DEFAULTS_INVALID',
    })
    expect(source).toEqual(before)
  })

  it('rejects legacy Pose budgets rather than truncating', async () => {
    const source = validV2Project()
    source.poses = Array.from({ length: 257 }, (_, index) => pose(`pose-${index}`))
    const { dependencies } = migrationDependencies()
    await expect(migrateProjectToV3(source, dependencies)).rejects.toMatchObject({
      code: 'PROJECT_LEGACY_POSE_BUDGET_EXCEEDED',
    })
  })

  it('is deterministic across independent inputs and keeps inputs unchanged', async () => {
    const first = validV2Project({ poses: [pose('A', 75), pose('B', 100)] })
    const second = structuredClone(first)
    const beforeFirst = structuredClone(first)
    const beforeSecond = structuredClone(second)
    const firstDependencies = migrationDependencies().dependencies
    const secondDependencies = migrationDependencies().dependencies

    const migratedFirst = await migrateProjectToV3(first, firstDependencies)
    const migratedSecond = await migrateProjectToV3(second, secondDependencies)
    expect(JSON.stringify(migratedFirst.projection)).toBe(JSON.stringify(migratedSecond.projection))
    expect(migratedFirst.warnings).toEqual(migratedSecond.warnings)
    expect(first).toEqual(beforeFirst)
    expect(second).toEqual(beforeSecond)
  })

  it('rejects after a locked parser failure without returning a candidate', async () => {
    const source = validV2Project()
    const before = structuredClone(source)
    const lockedAnalyzer = vi.fn<ProjectSourceLockedLeaseWorkerV1>(async () => {
      throw new Error('parser failed')
    })
    const { dependencies } = migrationDependencies('meter', lockedAnalyzer)
    await expect(migrateProjectToV3(source, dependencies)).rejects.toThrow(/parser failed/)
    expect(lockedAnalyzer).toHaveBeenCalledTimes(1)
    expect(source).toEqual(before)
  })

  it('rejects a spread migration service with rebound staging before a substituted analyzer can run', async () => {
    const source = validV2Project()
    const { dependencies } = migrationDependencies()
    const substitutedAnalyzer = vi.fn(async () => ({
      detectedUnit: 'meter' as const,
      meshIndices: [0],
    }))
    const forgedDependencies: ProjectV3MigrationDependencies = {
      ...dependencies,
      sourceStaging: {
        ...dependencies.sourceStaging,
        stageOwnedLegacyProjectSources:
          dependencies.sourceStaging.stageOwnedLegacyProjectSources.bind(
            dependencies.sourceStaging,
          ),
        analyzeLegacyRobotSource: substitutedAnalyzer,
      },
    }

    await expect(migrateProjectToV3(source, forgedDependencies)).rejects.toMatchObject({
      code: 'PROJECT_SOURCE_STAGING_SERVICE_INVALID',
    })
    expect(substitutedAnalyzer).not.toHaveBeenCalled()
  })

  it('snapshots canonical staging and revision hashing before the first source await', async () => {
    const source = validV2Project()
    const hashService = createProjectHashService({ subtle: globalThis.crypto.subtle })
    const nativeSourceDigest = createProjectSourceDigest(hashService)
    let firstDigestStarted!: () => void
    const digestStarted = new Promise<void>((resolve) => { firstDigestStarted = resolve })
    let releaseFirstDigest!: () => void
    const firstDigestGate = new Promise<void>((resolve) => { releaseFirstDigest = resolve })
    let digestCalls = 0
    const digestSource = vi.fn(async (bytes: ArrayBuffer, signal?: AbortSignal) => {
      digestCalls += 1
      if (digestCalls === 1) {
        firstDigestStarted()
        await firstDigestGate
      }
      return nativeSourceDigest.digestSource(bytes, signal)
    })
    const lockedAnalyzer = vi.fn<ProjectSourceLockedLeaseWorkerV1>(async ({
      tokenId,
      generation,
      sourceBytes,
    }) => ({
      tokenId,
      generation,
      sourceBytes,
      analysis: { detectedUnit: 'meter', meshIndices: [0] },
    }))
    const foundation = createProjectSourceMigrationFoundationInternalV1({
      sourceDigest: { digestSource },
      lockedLegacyAnalyzer: lockedAnalyzer,
    })
    const actualRevisionHasher = createProjectRevisionIdentityHasher(hashService)
    const hashRevisionIdentity = vi.fn(actualRevisionHasher.hashRevisionIdentity)
    const dependencies: ProjectV3MigrationDependencies = {
      sourceStaging: foundation.sourceStaging,
      projectRevisionIdentityHasher: { hashRevisionIdentity },
      builtInEquipmentDefaults: BUILT_IN_DEFAULTS,
      builtInEquipmentTransformDefaults: BUILT_IN_TRANSFORM_DEFAULTS,
    }
    const substitutedAnalyzer = vi.fn(async () => ({
      detectedUnit: 'inch' as const,
      meshIndices: [0],
    }))
    const substitutedValidator = vi.fn((
      projection: Parameters<typeof foundation.sourceStaging.validateProjection>[0],
    ) => projection)
    const forgedStaging = {
      ...foundation.sourceStaging,
      stageOwnedLegacyProjectSources:
        foundation.sourceStaging.stageOwnedLegacyProjectSources.bind(
          foundation.sourceStaging,
        ),
      analyzeLegacyRobotSource: substitutedAnalyzer,
      validateProjection: substitutedValidator,
    } as typeof foundation.sourceStaging
    const replacementRevisionHasher = vi.fn(async () => '0'.repeat(64))
    const pending = migrateProjectToV3(source, dependencies)

    await digestStarted
    const mutableDependencies = dependencies as unknown as {
      sourceStaging: typeof foundation.sourceStaging
      projectRevisionIdentityHasher: { hashRevisionIdentity: typeof replacementRevisionHasher }
    }
    mutableDependencies.sourceStaging = forgedStaging
    mutableDependencies.projectRevisionIdentityHasher = {
      hashRevisionIdentity: replacementRevisionHasher,
    }
    releaseFirstDigest()

    await expect(pending).resolves.toMatchObject({
      projection: { manifest: { schemaVersion: 3 } },
    })
    expect(lockedAnalyzer).toHaveBeenCalledTimes(7)
    expect(substitutedAnalyzer).not.toHaveBeenCalled()
    expect(substitutedValidator).not.toHaveBeenCalled()
    expect(hashRevisionIdentity).toHaveBeenCalledTimes(2)
    expect(replacementRevisionHasher).not.toHaveBeenCalled()
  })

  it('calls provenance verification and revokes staged tokens on a late mismatch', async () => {
    const source = validV2Project()
    const before = structuredClone(source)
    const { hashService } = migrationDependencies()
    const actual = createProjectRevisionIdentityHasher(hashService)
    const hashRevisionIdentity = vi.fn()
      .mockImplementationOnce(actual.hashRevisionIdentity)
      .mockResolvedValueOnce('0'.repeat(64))
    const lockedAnalyzer = vi.fn<ProjectSourceLockedLeaseWorkerV1>(async ({
      tokenId,
      generation,
      sourceBytes,
    }) => ({
      tokenId,
      generation,
      sourceBytes,
      analysis: { detectedUnit: 'meter', meshIndices: [0] },
    }))
    const mismatchDependencies = migrationDependencies('meter', lockedAnalyzer).dependencies

    await expect(migrateProjectToV3(source, {
      ...mismatchDependencies,
      projectRevisionIdentityHasher: { hashRevisionIdentity },
    })).rejects.toMatchObject({ code: 'PROJECT_MANUAL_MECHANICS_DIGEST_MISMATCH' })
    expect(hashRevisionIdentity).toHaveBeenCalledTimes(2)
    expect(lockedAnalyzer).toHaveBeenCalledTimes(7)
    expect(source).toEqual(before)
  })

  it('rejects and revokes promptly when cancellation races a silent legacy analyzer', async () => {
    const source = validV2Project()
    const controller = new AbortController()
    let started!: () => void
    const analyzerStarted = new Promise<void>((resolve) => { started = resolve })
    const lockedAnalyzer = vi.fn<ProjectSourceLockedLeaseWorkerV1>(async () => {
      started()
      return new Promise<never>(() => {})
    })
    const { dependencies } = migrationDependencies('meter', lockedAnalyzer)
    const pending = migrateProjectToV3(source, dependencies, controller.signal)

    await analyzerStarted
    const abortedAt = performance.now()
    controller.abort()
    await expect(Promise.race([
      pending,
      new Promise<never>((_resolve, reject) => setTimeout(
        () => reject(new Error('migration cancellation remained pending')),
        250,
      )),
    ])).rejects.toMatchObject({ code: 'PROJECT_MIGRATION_CANCELLED' })
    expect(performance.now() - abortedAt).toBeLessThan(250)
    expect(lockedAnalyzer).toHaveBeenCalledTimes(1)
  })

  it('rejects owner-weighted legacy Archive bytes before reading or hashing', async () => {
    const prepared = legacyArchivePreparation()
    const sharedPlaceholder = new ArrayBuffer(1)
    for (const link of prepared.candidate.robot.links) link.sourceBytes = sharedPlaceholder
    const robotOwners = prepared.candidate.robot.links.map(({ linkId }) =>
      `robot-link:${linkId}` as const)
    const objectPlan = prepared.sources.find(({ namespace }) => namespace === 'object')!
    const sources: LegacyProjectArchiveSourcePlanV1[] = [{
      namespace: 'robot',
      entryPath: 'robot/links/shared.step',
      ownerKeys: robotOwners,
      byteLength: 20 * 1024 * 1024,
    }, objectPlan]
    const { dependencies, digestSource } = migrationDependencies()

    await expect(prepareLegacyArchiveProjectForMigrationInternalV1(
      prepared.candidate,
      sources,
      prepared.reader,
      dependencies,
    )).rejects.toMatchObject({ code: 'PROJECT_SOURCE_BYTES_INVALID' })
    expect(prepared.readSource).not.toHaveBeenCalled()
    expect(digestSource).not.toHaveBeenCalled()
    expect(prepared.finish).not.toHaveBeenCalled()
  })

  it.each([
    ['a one-byte buffer outside sourceBytes', new ArrayBuffer(1)],
    ['a typed view outside sourceBytes', new Uint8Array([1])],
  ])('rejects %s before any legacy Archive read', async (_label, unexpected) => {
    const prepared = legacyArchivePreparation()
    ;(prepared.candidate as unknown as Record<string, unknown>).unexpected = unexpected
    const { dependencies, digestSource } = migrationDependencies()

    await expect(Promise.resolve().then(() => prepareLegacyArchiveProjectForMigrationInternalV1(
      prepared.candidate, prepared.sources, prepared.reader, dependencies,
    ))).rejects.toMatchObject({ code: 'PROJECT_SOURCE_ASSIGNMENT_INVALID' })
    expect(prepared.readSource).not.toHaveBeenCalled()
    expect(digestSource).not.toHaveBeenCalled()
  })

  it('rejects candidate and plan accessors without invoking them or reading', async () => {
    const first = legacyArchivePreparation()
    const candidateGetter = vi.fn(() => 'trap')
    Object.defineProperty(first.candidate.manifest, 'trap', {
      enumerable: true,
      get: candidateGetter,
    })
    const firstDependencies = migrationDependencies()
    await expect(Promise.resolve().then(() => prepareLegacyArchiveProjectForMigrationInternalV1(
      first.candidate, first.sources, first.reader, firstDependencies.dependencies,
    ))).rejects.toMatchObject({ code: 'PROJECT_SOURCE_ASSIGNMENT_INVALID' })
    expect(candidateGetter).not.toHaveBeenCalled()
    expect(first.readSource).not.toHaveBeenCalled()

    const second = legacyArchivePreparation()
    const planGetter = vi.fn(() => second.sources[0]!.entryPath)
    const maliciousPlan: LegacyProjectArchiveSourcePlanV1 = { ...second.sources[0]! }
    Object.defineProperty(maliciousPlan, 'entryPath', {
      enumerable: true,
      get: planGetter,
    })
    const secondDependencies = migrationDependencies()
    await expect(Promise.resolve().then(() => prepareLegacyArchiveProjectForMigrationInternalV1(
      second.candidate,
      [maliciousPlan, ...second.sources.slice(1)],
      second.reader,
      secondDependencies.dependencies,
    ))).rejects.toMatchObject({ code: 'PROJECT_SOURCE_ASSIGNMENT_INVALID' })
    expect(planGetter).not.toHaveBeenCalled()
    expect(second.readSource).not.toHaveBeenCalled()
  })

  it('revokes a prepared capability when cancellation wins before consumption', async () => {
    const prepared = legacyArchivePreparation()
    const controller = new AbortController()
    const digestBuffers: ArrayBuffer[] = []
    const hashService = createProjectHashService({ subtle: globalThis.crypto.subtle })
    const nativeDigest = createProjectSourceDigest(hashService)
    const foundation = createProjectSourceMigrationFoundationInternalV1({
      sourceDigest: {
        async digestSource(bytes, signal) {
          digestBuffers.push(bytes as ArrayBuffer)
          return nativeDigest.digestSource(bytes, signal)
        },
      },
      lockedLegacyAnalyzer: async ({ tokenId, generation, sourceBytes }) => ({
        tokenId, generation, sourceBytes,
        analysis: { detectedUnit: 'meter', meshIndices: [0] },
      }),
    })
    const dependencies: ProjectV3MigrationDependencies = {
      sourceStaging: foundation.sourceStaging,
      projectRevisionIdentityHasher: createProjectRevisionIdentityHasher(hashService),
      builtInEquipmentDefaults: BUILT_IN_DEFAULTS,
      builtInEquipmentTransformDefaults: BUILT_IN_TRANSFORM_DEFAULTS,
    }
    const capability = await prepareLegacyArchiveProjectForMigrationInternalV1(
      prepared.candidate, prepared.sources, prepared.reader, dependencies, controller.signal,
    )

    controller.abort()

    expect(digestBuffers.every(({ byteLength }) => byteLength === 0)).toBe(true)
    await expect(migratePreparedLegacyArchiveProjectToV3InternalV1(
      capability, dependencies, controller.signal,
    )).rejects.toMatchObject({ code: 'PROJECT_SOURCE_CAPABILITY_REVOKED' })
  })

  it('rejects forged, foreign, and replayed legacy Archive capabilities', async () => {
    const prepared = legacyArchivePreparation()
    const first = migrationDependencies()
    const second = migrationDependencies()
    await expect(migratePreparedLegacyArchiveProjectToV3InternalV1(
      Object.freeze({}) as PreparedLegacyArchiveProjectV1,
      first.dependencies,
    )).rejects.toMatchObject({ code: 'PROJECT_SOURCE_STAGING_SERVICE_INVALID' })
    const capability = await prepareLegacyArchiveProjectForMigrationInternalV1(
      prepared.candidate, prepared.sources, prepared.reader, first.dependencies,
    )

    await expect(migratePreparedLegacyArchiveProjectToV3InternalV1(
      capability, second.dependencies,
    )).rejects.toMatchObject({ code: 'PROJECT_SOURCE_STAGING_SERVICE_INVALID' })
    const migrated = await migratePreparedLegacyArchiveProjectToV3InternalV1(
      capability, first.dependencies,
    )
    await expect(migratePreparedLegacyArchiveProjectToV3InternalV1(
      capability, first.dependencies,
    )).rejects.toMatchObject({ code: 'PROJECT_SOURCE_CAPABILITY_CONSUMED' })
    for (const group of migrated.preparedSourceGroups) {
      first.dependencies.sourceStaging.revoke(group.preparedSource)
    }
  })

  it('rejects a substituted migration signal without consuming the capability', async () => {
    const prepared = legacyArchivePreparation()
    const preparationController = new AbortController()
    const substitutedController = new AbortController()
    const { dependencies } = migrationDependencies()
    const capability = await prepareLegacyArchiveProjectForMigrationInternalV1(
      prepared.candidate,
      prepared.sources,
      prepared.reader,
      dependencies,
      preparationController.signal,
    )

    await expect(migratePreparedLegacyArchiveProjectToV3InternalV1(
      capability,
      dependencies,
      substitutedController.signal,
    )).rejects.toMatchObject({ code: 'PROJECT_SOURCE_STAGING_SERVICE_INVALID' })
    const migrated = await migratePreparedLegacyArchiveProjectToV3InternalV1(
      capability,
      dependencies,
      preparationController.signal,
    )
    for (const group of migrated.preparedSourceGroups) {
      dependencies.sourceStaging.revoke(group.preparedSource)
    }
  })

  it('revokes every staged Archive token when reader finish throws', async () => {
    const prepared = legacyArchivePreparation()
    const digestBuffers: ArrayBuffer[] = []
    const hashService = createProjectHashService({ subtle: globalThis.crypto.subtle })
    const nativeDigest = createProjectSourceDigest(hashService)
    const foundation = createProjectSourceMigrationFoundationInternalV1({
      sourceDigest: {
        async digestSource(bytes, signal) {
          digestBuffers.push(bytes as ArrayBuffer)
          return nativeDigest.digestSource(bytes, signal)
        },
      },
      lockedLegacyAnalyzer: async () => { throw new Error('must not analyze') },
    })
    const dependencies: ProjectV3MigrationDependencies = {
      sourceStaging: foundation.sourceStaging,
      projectRevisionIdentityHasher: createProjectRevisionIdentityHasher(hashService),
      builtInEquipmentDefaults: BUILT_IN_DEFAULTS,
      builtInEquipmentTransformDefaults: BUILT_IN_TRANSFORM_DEFAULTS,
    }
    const finish = vi.fn(() => { throw new Error('finish failed') })

    await expect(prepareLegacyArchiveProjectForMigrationInternalV1(
      prepared.candidate,
      prepared.sources,
      Object.freeze({
        readSource: prepared.readSource as LegacyProjectArchiveReaderV1['readSource'],
        finish,
      }),
      dependencies,
    )).rejects.toThrow(/finish failed/)
    expect(finish).toHaveBeenCalledTimes(1)
    expect(digestBuffers).toHaveLength(prepared.sources.length)
    expect(digestBuffers.every(({ byteLength }) => byteLength === 0)).toBe(true)
  })

  it('detaches a signal-ignoring late Archive read and revokes earlier tokens', async () => {
    const prepared = legacyArchivePreparation()
    const controller = new AbortController()
    const digestBuffers: ArrayBuffer[] = []
    const hashService = createProjectHashService({ subtle: globalThis.crypto.subtle })
    const nativeDigest = createProjectSourceDigest(hashService)
    const foundation = createProjectSourceMigrationFoundationInternalV1({
      sourceDigest: {
        async digestSource(bytes, signal) {
          digestBuffers.push(bytes as ArrayBuffer)
          return nativeDigest.digestSource(bytes, signal)
        },
      },
      lockedLegacyAnalyzer: async () => { throw new Error('must not analyze') },
    })
    const dependencies: ProjectV3MigrationDependencies = {
      sourceStaging: foundation.sourceStaging,
      projectRevisionIdentityHasher: createProjectRevisionIdentityHasher(hashService),
      builtInEquipmentDefaults: BUILT_IN_DEFAULTS,
      builtInEquipmentTransformDefaults: BUILT_IN_TRANSFORM_DEFAULTS,
    }
    let secondReadStarted!: () => void
    const readStarted = new Promise<void>((resolve) => { secondReadStarted = resolve })
    let resolveSecondRead!: (bytes: ArrayBuffer) => void
    const lateRead = new Promise<ArrayBuffer>((resolve) => { resolveSecondRead = resolve })
    let reads = 0
    const readSource = vi.fn(async (plan: LegacyProjectArchiveSourcePlanV1) => {
      reads += 1
      if (reads === 2) {
        secondReadStarted()
        return lateRead
      }
      return prepared.bytesByPath.get(plan.entryPath)!.slice(0)
    })
    const pending = prepareLegacyArchiveProjectForMigrationInternalV1(
      prepared.candidate,
      prepared.sources,
      Object.freeze({
        readSource,
        finish: prepared.finish as LegacyProjectArchiveReaderV1['finish'],
      }),
      dependencies,
      controller.signal,
    )

    await readStarted
    controller.abort()
    await expect(pending).rejects.toMatchObject({ code: 'PROJECT_SOURCE_LEASE_CANCELLED' })
    const lateBytes = new Uint8Array([91, 92, 93]).buffer
    resolveSecondRead(lateBytes)
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(readSource).toHaveBeenCalledTimes(2)
    expect(lateBytes.byteLength).toBe(0)
    expect(digestBuffers).toHaveLength(1)
    expect(digestBuffers[0]!.byteLength).toBe(0)
    expect(prepared.finish).not.toHaveBeenCalled()
  })

  it('revokes all pre-staged Archive tokens when migration fails', async () => {
    const prepared = legacyArchivePreparation()
    const digestBuffers: ArrayBuffer[] = []
    const hashService = createProjectHashService({ subtle: globalThis.crypto.subtle })
    const nativeDigest = createProjectSourceDigest(hashService)
    const foundation = createProjectSourceMigrationFoundationInternalV1({
      sourceDigest: {
        async digestSource(bytes, signal) {
          digestBuffers.push(bytes as ArrayBuffer)
          return nativeDigest.digestSource(bytes, signal)
        },
      },
      lockedLegacyAnalyzer: async () => { throw new Error('parser failed after staging') },
    })
    const dependencies: ProjectV3MigrationDependencies = {
      sourceStaging: foundation.sourceStaging,
      projectRevisionIdentityHasher: createProjectRevisionIdentityHasher(hashService),
      builtInEquipmentDefaults: BUILT_IN_DEFAULTS,
      builtInEquipmentTransformDefaults: BUILT_IN_TRANSFORM_DEFAULTS,
    }
    const capability = await prepareLegacyArchiveProjectForMigrationInternalV1(
      prepared.candidate, prepared.sources, prepared.reader, dependencies,
    )

    await expect(migratePreparedLegacyArchiveProjectToV3InternalV1(
      capability, dependencies,
    )).rejects.toThrow(/parser failed after staging/)
    expect(digestBuffers.every(({ byteLength }) => byteLength === 0)).toBe(true)
  })

  it('detaches a signal-ignoring late analyzer return after Archive migration cancellation', async () => {
    const prepared = legacyArchivePreparation()
    const controller = new AbortController()
    let analyzerStarted!: () => void
    const started = new Promise<void>((resolve) => { analyzerStarted = resolve })
    let releaseAnalyzer!: () => void
    const gate = new Promise<void>((resolve) => { releaseAnalyzer = resolve })
    let leasedBytes: ArrayBuffer | undefined
    const lockedAnalyzer = vi.fn<ProjectSourceLockedLeaseWorkerV1>(async (input) => {
      leasedBytes = input.sourceBytes
      analyzerStarted()
      await gate
      return {
        tokenId: input.tokenId,
        generation: input.generation,
        sourceBytes: input.sourceBytes,
        analysis: { detectedUnit: 'meter', meshIndices: [0] },
      }
    })
    const { dependencies } = migrationDependencies('meter', lockedAnalyzer)
    const capability = await prepareLegacyArchiveProjectForMigrationInternalV1(
      prepared.candidate, prepared.sources, prepared.reader, dependencies, controller.signal,
    )
    const pending = migratePreparedLegacyArchiveProjectToV3InternalV1(
      capability, dependencies, controller.signal,
    )

    await started
    controller.abort()
    await expect(pending).rejects.toMatchObject({ code: 'PROJECT_MIGRATION_CANCELLED' })
    releaseAnalyzer()
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(lockedAnalyzer).toHaveBeenCalledTimes(1)
    expect(leasedBytes?.byteLength).toBe(0)
  })
})
