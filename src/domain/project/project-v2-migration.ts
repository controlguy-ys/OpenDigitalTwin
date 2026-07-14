import type { SerializableTransform } from '../equipment/equipment'
import {
  validateWorkcellProjectSnapshotV2,
  WORKCELL_PROJECT_SCHEMA_VERSION_V1,
  WORKCELL_PROJECT_SCHEMA_VERSION_V2,
  type GeometryStatistics,
  type MigratableProjectSnapshot,
  type WorkcellProjectSnapshotV1,
  type WorkcellProjectSnapshotV2,
} from './project'
import { migrateV1ToV2 } from './project-v1-migration'
import {
  MAX_POSES_PER_JOB,
  MAX_PROJECT_POSES,
  ROBOT_LINK_IDS_V3,
  WORKCELL_PROJECT_SCHEMA_VERSION_V3,
  assertCanonicalProjectSourceMigrationStagingServiceInternalV1,
  canonicalMechanicsBytesV3,
  deriveCanonicalPoseDurationMsV3,
  normalizeFixedSixAxisRobotMechanicsV3,
  verifyProjectCryptographicProvenanceV3,
  validateBuiltInEquipmentDefaultPairsV3,
  type ByteFreeWorkcellProjectProjectionV3,
  type FixedSixAxisRobotMechanicsV3,
  type ProjectBuiltInEquipmentRecordV3,
  type ProjectExternalEntityTransformStateV3,
  type ProjectPoseStepV3,
  type ProjectRigidTransformV3,
  type ProjectRobotJointV3,
  type ProjectSourceMigrationStagingServiceV1,
} from './project-v3'
import type { ProjectRevisionIdentityHasher } from '../../lib/hash/sha256'
import {
  type PreparedProjectSourceGroupV1,
  type PreparedProjectSourceV1,
} from '../../features/project/project-source-staging'

export const PROJECT_V2_BUILT_IN_EQUIPMENT_RESTORED_WARNING =
  'PROJECT_V2_BUILT_IN_EQUIPMENT_RESTORED'
export const LEGACY_ROBOT_PARSER_VERSION = 'occt-import-js@0.0.23'

const IDENTITY_TRANSFORM: ProjectRigidTransformV3 = {
  position: [0, 0, 0],
  quaternion: [0, 0, 0, 1],
  scale: [1, 1, 1],
}
const LEGACY_TOOL0_TRANSFORM: ProjectRigidTransformV3 = {
  position: [0, 0, 0],
  quaternion: [0, 0.7071067811865476, 0, 0.7071067811865476],
  scale: [1, 1, 1],
}

export interface ProjectV3MigrationDependencies {
  readonly sourceStaging: ProjectSourceMigrationStagingServiceV1
  readonly projectRevisionIdentityHasher: ProjectRevisionIdentityHasher
  readonly builtInEquipmentDefaults: readonly ProjectBuiltInEquipmentRecordV3[]
  readonly builtInEquipmentTransformDefaults: readonly ProjectExternalEntityTransformStateV3[]
}

export interface ProjectMigrationResultV3 {
  readonly projection: ByteFreeWorkcellProjectProjectionV3
  readonly preparedSourceGroups: readonly PreparedProjectSourceGroupV1[]
  readonly warnings: readonly string[]
}

export interface LegacyPoseLimitViolationV3 {
  readonly jobId: 'job-default'
  readonly poseId: string
  readonly jointId: string
  readonly angleDeg: number
  readonly minDeg: number
  readonly maxDeg: number
}

function fail(
  code: string,
  message: string,
  details: Record<string, unknown> = {},
  cause?: unknown,
): never {
  throw Object.assign(
    new Error(`${code}: ${message}`, cause === undefined ? undefined : { cause }),
    { code, ...details },
  )
}

function migrationCancelled(): Error & { readonly code: 'PROJECT_MIGRATION_CANCELLED' } {
  return Object.assign(
    new Error('PROJECT_MIGRATION_CANCELLED: Project migration was cancelled.'),
    { code: 'PROJECT_MIGRATION_CANCELLED' as const },
  )
}

function awaitAnalyzerWithAbort<Result>(
  analyze: () => Promise<Result>,
  signal?: AbortSignal,
): Promise<Result> {
  if (signal?.aborted === true) return Promise.reject(migrationCancelled())
  if (signal === undefined) return analyze()
  return new Promise<Result>((resolve, reject) => {
    let settled = false
    const finish = (action: () => void): void => {
      if (settled) return
      settled = true
      signal.removeEventListener('abort', onAbort)
      action()
    }
    const onAbort = (): void => finish(() => reject(migrationCancelled()))
    signal.addEventListener('abort', onAbort, { once: true })
    let pending: Promise<Result>
    try {
      pending = analyze()
    } catch (error) {
      finish(() => reject(error))
      return
    }
    void pending.then(
      (result) => finish(() => resolve(result)),
      (error) => finish(() => reject(error)),
    )
  })
}

function ownDataValue(value: unknown, key: string): unknown {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const descriptor = Object.getOwnPropertyDescriptor(value, key)
  return descriptor !== undefined && 'value' in descriptor ? descriptor.value : undefined
}

function schemaVersionOf(value: unknown): number | undefined {
  return ownDataValue(ownDataValue(value, 'manifest'), 'schemaVersion') as number | undefined
}

function rejectNonRigidLegacyFrames(value: unknown): void {
  const frames = ownDataValue(value, 'frames')
  for (const field of ['mcp', 'tcp'] as const) {
    const scale = ownDataValue(ownDataValue(frames, field), 'scale')
    if (
      Array.isArray(scale) &&
      scale.length === 3 &&
      scale.some((entry) => entry !== 1)
    ) {
      fail(
        'PROJECT_LEGACY_FRAME_NON_RIGID',
        `Legacy ${field.toUpperCase()} scale must be exactly [1, 1, 1].`,
      )
    }
  }
}

function normalizeTuple3(
  value: readonly [number, number, number],
): [number, number, number] {
  return [value[0], value[1], value[2]]
}

function normalizeQuaternion(
  value: readonly [number, number, number, number],
): [number, number, number, number] {
  const norm = Math.hypot(...value)
  if (!Number.isFinite(norm) || norm <= 1e-9) {
    return fail('PROJECT_LEGACY_TRANSFORM_INVALID', 'Legacy Quaternion must be finite and nonzero.')
  }
  return [value[0] / norm, value[1] / norm, value[2] / norm, value[3] / norm]
}

function normalizeTransform(value: SerializableTransform): SerializableTransform {
  return {
    position: normalizeTuple3(value.position),
    quaternion: normalizeQuaternion(value.quaternion),
    scale: normalizeTuple3(value.scale),
  }
}

function normalizedMechanics(
  source: WorkcellProjectSnapshotV2,
): FixedSixAxisRobotMechanicsV3 {
  const joints = source.robot.joints.map((joint) => {
    const axisLength = Math.hypot(...joint.axis)
    if (!Number.isFinite(axisLength) || axisLength <= 1e-9) {
      return fail('ROBOT_MECHANICS_INVALID', `${joint.id} axis must be finite and nonzero.`)
    }
    if (!Number.isFinite(joint.maxVelocityDegPerSec) || joint.maxVelocityDegPerSec <= 0) {
      return fail('ROBOT_MECHANICS_INVALID', `${joint.id} maximum velocity must be positive.`)
    }
    return {
      id: joint.id,
      parentLink: joint.parentLink,
      childLink: joint.childLink,
      originM: normalizeTuple3(joint.origin),
      axis: normalizeTuple3(joint.axis),
      minDeg: joint.minDeg,
      maxDeg: joint.maxDeg,
      homeDeg: Math.min(joint.maxDeg, Math.max(joint.minDeg, 0)),
      zeroOffsetDeg: 0,
      direction: 1 as const,
      maxVelocityDegPerSec: joint.maxVelocityDegPerSec,
    } satisfies ProjectRobotJointV3
  })
  if (joints.length !== 6) {
    return fail('ROBOT_JOINT_COUNT_UNSUPPORTED', 'Legacy Robot must contain exactly six Joints.')
  }
  return normalizeFixedSixAxisRobotMechanicsV3({
    joints: joints as unknown as FixedSixAxisRobotMechanicsV3['joints'],
    flange: IDENTITY_TRANSFORM,
    tool0: LEGACY_TOOL0_TRANSFORM,
  })
}

function validateLegacyPoseLimits(
  poses: readonly WorkcellProjectSnapshotV2['poses'][number][],
  mechanics: FixedSixAxisRobotMechanicsV3,
): void {
  const violations: LegacyPoseLimitViolationV3[] = []
  let totalCount = 0
  for (const pose of poses) {
    pose.anglesDeg.forEach((angleDeg, index) => {
      const joint = mechanics.joints[index]!
      if (angleDeg < joint.minDeg || angleDeg > joint.maxDeg) {
        totalCount += 1
        if (violations.length < 64) {
          violations.push({
            jobId: 'job-default',
            poseId: pose.id,
            jointId: joint.id,
            angleDeg,
            minDeg: joint.minDeg,
            maxDeg: joint.maxDeg,
          })
        }
      }
    })
  }
  if (totalCount > 0) {
    fail(
      'PROJECT_LEGACY_POSE_OUT_OF_LIMITS',
      `${totalCount} legacy Pose angle(s) are outside the migrated Mechanics limits.`,
      { totalCount, details: Object.freeze(violations) },
    )
  }
}

function migrateSimulation(
  source: WorkcellProjectSnapshotV2,
  mechanics: FixedSixAxisRobotMechanicsV3,
): { readonly simulation: ByteFreeWorkcellProjectProjectionV3['simulation']; readonly durationChanged: boolean } {
  if (
    source.poses.length > MAX_POSES_PER_JOB ||
    source.poses.length > MAX_PROJECT_POSES
  ) {
    return fail(
      'PROJECT_LEGACY_POSE_BUDGET_EXCEEDED',
      `Legacy flat Pose list cannot exceed ${Math.min(MAX_POSES_PER_JOB, MAX_PROJECT_POSES)} entries.`,
    )
  }
  validateLegacyPoseLimits(source.poses, mechanics)
  const poses = source.poses.map((pose) => ({
    id: pose.id,
    name: pose.name,
    anglesDeg: [...pose.anglesDeg] as [number, number, number, number, number, number],
    durationMs: pose.durationMs,
    easing: pose.easing,
    speedPercentToNext: pose.speedPercentToNext ?? 100,
  }))
  let durationChanged = false
  const canonicalPoses = poses.map((pose, index) => {
    const next = poses[index + 1]
    const durationMs = next === undefined
      ? 1_000
      : deriveCanonicalPoseDurationMsV3(pose, next, mechanics)
    if (Math.abs(pose.durationMs - durationMs) > 1e-9) durationChanged = true
    return { ...pose, durationMs } satisfies ProjectPoseStepV3
  })
  return {
    simulation: {
      activeJobId: 'job-default',
      jobs: [{
        id: 'job-default',
        name: 'Default Job',
        revision: 1,
        poses: canonicalPoses,
      }],
    },
    durationChanged,
  }
}

function sameStatistics(first: GeometryStatistics, second: GeometryStatistics): boolean {
  return (
    first.vertices === second.vertices &&
    first.triangles === second.triangles &&
    first.meshes === second.meshes &&
    first.materials === second.materials
  )
}

function unitScale(unit: 'meter' | 'millimeter' | 'inch'): number {
  return unit === 'meter' ? 1 : unit === 'millimeter' ? 0.001 : 0.0254
}

function sortedGroups(
  groups: readonly PreparedProjectSourceGroupV1[],
): readonly PreparedProjectSourceGroupV1[] {
  return Object.freeze(groups.map((group) => Object.freeze({
    ownerKeys: Object.freeze([...group.ownerKeys]),
    preparedSource: group.preparedSource,
  })).sort((first, second) => {
    const firstKey = first.ownerKeys[0]!
    const secondKey = second.ownerKeys[0]!
    const firstRobot = firstKey.startsWith('robot-source:')
    const secondRobot = secondKey.startsWith('robot-source:')
    if (firstRobot !== secondRobot) return firstRobot ? -1 : 1
    return firstKey < secondKey ? -1 : firstKey > secondKey ? 1 : 0
  }))
}

async function migrateOwnedV2ToV3(
  source: WorkcellProjectSnapshotV2,
  dependencies: ProjectV3MigrationDependencies,
  sourceStaging: ProjectSourceMigrationStagingServiceV1,
  signal?: AbortSignal,
): Promise<ProjectMigrationResultV3> {
  let defaults
  try {
    defaults = validateBuiltInEquipmentDefaultPairsV3(
      dependencies.builtInEquipmentDefaults,
      dependencies.builtInEquipmentTransformDefaults,
    )
  } catch (error) {
    return fail(
      'PROJECT_BUILT_IN_DEFAULTS_INVALID',
      'Built-in Equipment defaults are not paired immutable catalog entries.',
      {},
      error,
    )
  }
  const mechanics = normalizedMechanics(source)
  const { simulation, durationChanged } = migrateSimulation(source, mechanics)
  const stagedTokens = new Set<PreparedProjectSourceV1>()
  try {
    const stagedLegacy = await sourceStaging.stageOwnedLegacyProjectSources(
      source,
      signal,
    )
    for (const staged of stagedLegacy) stagedTokens.add(staged.preparedSource)
    const stagedByOwner = new Map(
      stagedLegacy.map((staged) => [staged.legacyOwnerKey, staged.preparedSource] as const),
    )

    const robotGroups = new Map<string, {
      readonly preparedSource: PreparedProjectSourceV1
      readonly linkIndexes: number[]
    }>()
    for (const [linkIndex, link] of source.robot.links.entries()) {
      const prepared = stagedByOwner.get(`robot-link:${link.linkId}`)!
      const existing = robotGroups.get(prepared.sha256)
      if (existing === undefined) {
        robotGroups.set(prepared.sha256, { preparedSource: prepared, linkIndexes: [linkIndex] })
      } else {
        existing.linkIndexes.push(linkIndex)
        if (existing.preparedSource !== prepared) {
          if (existing.preparedSource.byteLength !== prepared.byteLength) {
            return fail('PROJECT_SOURCE_DIGEST_COLLISION', 'Equal Robot digests have different byte lengths.')
          }
          sourceStaging.revoke(prepared)
        }
      }
    }
    for (const group of robotGroups.values()) {
      group.linkIndexes.sort((first, second) =>
        ROBOT_LINK_IDS_V3.indexOf(source.robot.links[first]!.linkId) -
        ROBOT_LINK_IDS_V3.indexOf(source.robot.links[second]!.linkId))
    }
    const orderedRobotGroups = [...robotGroups.entries()].sort((first, second) =>
      ROBOT_LINK_IDS_V3.indexOf(source.robot.links[first[1].linkIndexes[0]!]!.linkId) -
      ROBOT_LINK_IDS_V3.indexOf(source.robot.links[second[1].linkIndexes[0]!]!.linkId))

    const analysisByDigest = new Map<string, {
      readonly detectedUnit: 'meter' | 'millimeter' | 'inch'
      readonly meshIndices: readonly number[]
    }>()
    for (const [digest, group] of orderedRobotGroups) {
      const analysis = await awaitAnalyzerWithAbort(
        () => sourceStaging.analyzeLegacyRobotSource(group.preparedSource, signal),
        signal,
      )
      if (analysis.detectedUnit === 'unknown') {
        return fail(
          'ROBOT_STEP_UNIT_REQUIRED',
          `Legacy Robot source ${digest} has no deterministic source unit.`,
        )
      }
      const meshIndices = [...analysis.meshIndices].sort((first, second) => first - second)
      const representative = source.robot.links[group.linkIndexes[0]!]!
      const expectedMeshIndices = Array.from(
        { length: representative.statistics.meshes },
        (_value, index) => index,
      )
      if (
        meshIndices.length !== expectedMeshIndices.length ||
        meshIndices.some((meshIndex, index) =>
          !Number.isSafeInteger(meshIndex) || meshIndex !== expectedMeshIndices[index])
      ) {
        return fail(
          'PROJECT_LEGACY_SOURCE_REFERENCE_INVALID',
          `Legacy Robot source ${digest} does not resolve its complete mesh set.`,
        )
      }
      for (const linkIndex of group.linkIndexes) {
        if (!sameStatistics(representative.statistics, source.robot.links[linkIndex]!.statistics)) {
          return fail(
            'PROJECT_LEGACY_SOURCE_METADATA_CONFLICT',
            `Byte-identical Robot source ${digest} has conflicting legacy statistics.`,
          )
        }
      }
      analysisByDigest.set(digest, {
        detectedUnit: analysis.detectedUnit,
        meshIndices: Object.freeze(meshIndices),
      })
    }

    const robotSources = orderedRobotGroups.map(([digest, group]) => {
      const representative = source.robot.links[group.linkIndexes[0]!]!
      const analysis = analysisByDigest.get(digest)!
      return {
        id: digest,
        sha256: digest,
        sourceFileName: representative.sourceFileName,
        detectedUnit: analysis.detectedUnit,
        selectedSourceUnit: analysis.detectedUnit,
        unitDecision: 'legacy-detected' as const,
        sourceToMeters: unitScale(analysis.detectedUnit),
        parserVersion: LEGACY_ROBOT_PARSER_VERSION,
        statistics: structuredClone(representative.statistics),
      }
    })
    const robotDigestByLink = new Map<number, string>()
    for (const [digest, group] of orderedRobotGroups) {
      for (const linkIndex of group.linkIndexes) robotDigestByLink.set(linkIndex, digest)
    }
    const robotLinks = source.robot.links.map((link, linkIndex) => {
      const digest = robotDigestByLink.get(linkIndex)!
      return {
        linkId: link.linkId,
        sourceRefs: [{
          sourceAssetId: digest,
          nodePath: [-1, ROBOT_LINK_IDS_V3.indexOf(link.linkId)],
          nodeName: `legacy-whole-source:${link.linkId}`,
          meshIndices: [...analysisByDigest.get(digest)!.meshIndices],
        }],
        coordinateMode: 'link-local' as const,
        zeroPoseLocalization: normalizeTransform(link.localTransform),
        operatorAdjustment: structuredClone(IDENTITY_TRANSFORM),
        visible: link.visible,
        collisionBoxes: structuredClone(link.collisionBoxes),
        statistics: structuredClone(link.statistics),
      }
    }).sort((first, second) =>
      ROBOT_LINK_IDS_V3.indexOf(first.linkId) - ROBOT_LINK_IDS_V3.indexOf(second.linkId))

    const objectGroups = new Map<string, {
      readonly preparedSource: PreparedProjectSourceV1
      readonly ownerKeys: (`object-asset:${string}`)[]
    }>()
    const objectDigestById = new Map<string, string>()
    for (const asset of source.objectAssets) {
      const prepared = stagedByOwner.get(`object-asset:${asset.id}`)!
      objectDigestById.set(asset.id, prepared.sha256)
      const existing = objectGroups.get(prepared.sha256)
      if (existing === undefined) {
        objectGroups.set(prepared.sha256, {
          preparedSource: prepared,
          ownerKeys: [`object-asset:${asset.id}`],
        })
      } else {
        existing.ownerKeys.push(`object-asset:${asset.id}`)
        if (existing.preparedSource !== prepared) {
          if (existing.preparedSource.byteLength !== prepared.byteLength) {
            return fail('PROJECT_SOURCE_DIGEST_COLLISION', 'Equal Object digests have different byte lengths.')
          }
          sourceStaging.revoke(prepared)
        }
      }
    }

    const mechanicsDigest = await dependencies.projectRevisionIdentityHasher.hashRevisionIdentity(
      canonicalMechanicsBytesV3(mechanics),
      signal,
    )
    const numericBindingTargets = new Set(
      source.opcUa.equipment.map((binding) => binding.instanceId),
    )
    const hasOpcUaFallback = source.objectInstances.some(({ statusSource }) =>
      statusSource === 'opcua')
    const objectInstances = source.objectInstances.map((instance) => ({
      id: instance.id,
      assetId: instance.assetId,
      name: instance.name,
      manualNumericStatus: instance.numericStatus,
      statusSource: instance.statusSource === 'opcua' && numericBindingTargets.has(instance.id)
        ? 'opcua' as const
        : 'manual' as const,
      statusOverlayVisible: instance.statusOverlayVisible,
      visible: instance.visible,
      graspable: false,
    }))
    const objectTransforms = source.objectInstances.map((instance) => ({
      entityId: `object:${instance.id}` as const,
      manualTransform: normalizeTransform(instance.transform),
      transformSource: 'manual' as const,
    }))
    const objectAssets = source.objectAssets.map((asset) => ({
      id: asset.id,
      name: asset.name,
      sourceKind: 'step' as const,
      sourceFileName: asset.sourceFileName,
      sourceSha256: objectDigestById.get(asset.id)!,
      importScale: asset.importScale,
      originMode: asset.originMode,
      colliderCenter: [...asset.colliderCenter] as [number, number, number],
      collisionHalfExtents: [...asset.collisionHalfExtents] as [number, number, number],
      collisionBoxes: structuredClone(asset.collisionBoxes),
      statistics: structuredClone(asset.statistics),
    }))

    const projection = {
      manifest: {
        ...structuredClone(source.manifest),
        schemaVersion: WORKCELL_PROJECT_SCHEMA_VERSION_V3,
      },
      robot: {
        name: source.robot.name,
        basePosition: [...source.robot.basePosition],
        baseRotationDeg: [...source.robot.baseRotationDeg],
        sources: robotSources,
        links: robotLinks,
        mechanics,
        mechanicsProvenance: {
          kind: 'manual' as const,
          canonicalSha256: mechanicsDigest,
        },
      },
      frames: {
        mcp: normalizeTransform(source.frames.mcp),
        tcp: normalizeTransform(source.frames.tcp),
      },
      simulation,
      objectAssets,
      objectInstances,
      builtInEquipment: defaults.configurations,
      externalEntities: [...objectTransforms, ...defaults.transforms],
      opcUa: {
        endpointUrl: source.opcUa.endpointUrl,
        samplingIntervalMs: source.opcUa.samplingIntervalMs,
        joints: structuredClone(source.opcUa.joints),
        numericStatusBindings: source.opcUa.equipment.map((binding) => ({
          entityId: `object:${binding.instanceId}` as const,
          nodeId: binding.nodeId,
          scale: binding.scale,
          offset: binding.offset,
        })),
        equipmentTransforms: [],
      },
      collisionPolicy: structuredClone(source.collisionPolicy),
    } as unknown as ByteFreeWorkcellProjectProjectionV3

    const groups = sortedGroups([
      ...orderedRobotGroups.map(([digest, group]) => ({
        ownerKeys: [`robot-source:${digest}` as const],
        preparedSource: group.preparedSource,
      })),
      ...Array.from(objectGroups.values(), (group) => ({
        ownerKeys: Object.freeze([...group.ownerKeys].sort()),
        preparedSource: group.preparedSource,
      })),
    ])
    const validatedProjection = sourceStaging.validateProjection(
      projection,
      groups,
    )
    await verifyProjectCryptographicProvenanceV3(
      validatedProjection,
      dependencies.projectRevisionIdentityHasher,
      signal,
    )
    const warnings = [
      'PROJECT_V2_MECHANICS_DEFAULTED',
      ...(durationChanged ? ['PROJECT_LEGACY_POSE_DURATION_NORMALIZED'] : []),
      ...(hasOpcUaFallback ? ['PROJECT_V2_STATUS_FALLBACK_ASSUMED'] : []),
      PROJECT_V2_BUILT_IN_EQUIPMENT_RESTORED_WARNING,
    ]
    return {
      projection: validatedProjection,
      preparedSourceGroups: groups,
      warnings: Object.freeze(warnings),
    }
  } catch (error) {
    for (const sourceToken of stagedTokens) {
      try {
        sourceStaging.revoke(sourceToken)
      } catch {
        // Revocation is best-effort for tokens already revoked during de-duplication.
      }
    }
    throw error
  }
}

export { canonicalMechanicsBytesV3, verifyProjectCryptographicProvenanceV3 }

export async function migrateProjectToV3(
  candidate: MigratableProjectSnapshot,
  dependencies: ProjectV3MigrationDependencies,
  signal?: AbortSignal,
): Promise<ProjectMigrationResultV3> {
  const sourceStaging = dependencies.sourceStaging
  const revisionIdentityHasher = dependencies.projectRevisionIdentityHasher
  const resolvedDependencies: ProjectV3MigrationDependencies = Object.freeze({
    sourceStaging,
    projectRevisionIdentityHasher: Object.freeze({
      hashRevisionIdentity:
        revisionIdentityHasher.hashRevisionIdentity.bind(revisionIdentityHasher),
    }),
    builtInEquipmentDefaults: dependencies.builtInEquipmentDefaults,
    builtInEquipmentTransformDefaults: dependencies.builtInEquipmentTransformDefaults,
  })
  assertCanonicalProjectSourceMigrationStagingServiceInternalV1(
    sourceStaging,
  )
  rejectNonRigidLegacyFrames(candidate)
  const schemaVersion = schemaVersionOf(candidate)
  let source: WorkcellProjectSnapshotV2
  if (schemaVersion === WORKCELL_PROJECT_SCHEMA_VERSION_V1) {
    source = migrateV1ToV2(candidate as WorkcellProjectSnapshotV1)
  } else if (schemaVersion === WORKCELL_PROJECT_SCHEMA_VERSION_V2) {
    source = validateWorkcellProjectSnapshotV2(candidate)
  } else {
    return fail('PROJECT_LEGACY_SCHEMA_UNSUPPORTED', 'Migration accepts only V1 or V2 Projects.')
  }
  return migrateOwnedV2ToV3(source, resolvedDependencies, sourceStaging, signal)
}
