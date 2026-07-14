import { describe, expect, expectTypeOf, it } from 'vitest'
import type { RobotLinkId } from '../robot/crb15000'
import * as projectV3Module from './project-v3'
import {
  MAX_OBJECT_ASSETS,
  MAX_OBJECT_INSTANCES,
  MAX_VISIBLE_RENDER_ITEMS,
  MAX_VISIBLE_STATUS_OVERLAYS,
  WORKCELL_PROJECT_SCHEMA_VERSION_V3,
  collectProjectSourceDescriptorsV3,
  preflightWorkcellProjectShapeV3,
  validateStagedWorkcellProjectSnapshotV3,
  validateWorkcellProjectSnapshotV3,
  type BoxObjectAssetRecordV3,
  type DeepReadonly,
  type FixedSixAxisRobotMechanicsV3,
  type ObjectAssetGeometryV3,
  type ObjectInstanceRecordV3,
  type ProjectBuiltInEquipmentRecordV3,
  type ProjectOpcUaEquipmentTransformBindingV3,
  type ProjectOpcUaNumericStatusBindingV3,
  type ProjectPoseStepV3,
  type ProjectRobotJointV3,
  type RobotLinkGeometryRecordV3,
  type RobotStepSourceAssetV3,
  type SimulationJobV1,
  type WorkcellProjectSnapshotV3,
} from './project-v3'

type DeepMutable<T> = T extends ArrayBuffer
  ? ArrayBuffer
  : T extends readonly unknown[]
    ? { -readonly [Key in keyof T]: DeepMutable<T[Key]> }
    : T extends object
      ? { -readonly [Key in keyof T]: DeepMutable<T[Key]> }
      : T

const LINK_IDS = [
  'LINK00',
  'LINK01',
  'LINK02',
  'LINK03',
  'LINK04',
  'LINK05',
  'LINK06',
] as const satisfies readonly RobotLinkId[]

const JOINT_IDS = ['J1', 'J2', 'J3', 'J4', 'J5', 'J6'] as const
const DIGEST_A = 'a'.repeat(64)
const DIGEST_B = 'b'.repeat(64)
const IDENTITY = {
  position: [0, 0, 0],
  quaternion: [0, 0, 0, 1],
  scale: [1, 1, 1],
} as const

function mutable<T>(value: T): DeepMutable<T> {
  return structuredClone(value) as DeepMutable<T>
}

function expectSelfReplacingAccessorRejected(
  snapshot: DeepMutable<WorkcellProjectSnapshotV3>,
  target: object,
  key: PropertyKey,
  replacementValue: unknown,
): void {
  let calls = 0
  const getter = () => {
    calls += 1
    Object.defineProperty(target, key, {
      value: replacementValue,
      writable: true,
      enumerable: true,
      configurable: true,
    })
    return replacementValue
  }
  Object.defineProperty(target, key, {
    get: getter,
    enumerable: true,
    configurable: true,
  })

  let error: unknown
  try {
    validateWorkcellProjectSnapshotV3(snapshot)
  } catch (caught) {
    error = caught
  }
  const descriptor = Object.getOwnPropertyDescriptor(target, key)
  expect.soft(calls).toBe(0)
  expect.soft(descriptor?.get).toBe(getter)
  expect.soft(descriptor !== undefined && 'value' in descriptor).toBe(false)
  expect(error).toBeInstanceOf(Error)
  expect((error as Error).message).toMatch(/data field/i)
}

function expectAccessorForgedArrayBufferRejected(
  snapshot: DeepMutable<WorkcellProjectSnapshotV3>,
  sourceOwner: object,
): void {
  const owner = sourceOwner as Record<string, unknown>
  const forgedBuffer = {}
  const replacementBuffer = Uint8Array.from([1, 2, 3]).buffer
  let tagCalls = 0
  let lengthCalls = 0
  Object.defineProperty(forgedBuffer, Symbol.toStringTag, {
    get: () => {
      tagCalls += 1
      owner.sourceBytes = replacementBuffer
      return 'ArrayBuffer'
    },
    configurable: true,
  })
  Object.defineProperty(forgedBuffer, 'byteLength', {
    get: () => {
      lengthCalls += 1
      return replacementBuffer.byteLength
    },
    enumerable: true,
    configurable: true,
  })
  owner.sourceBytes = forgedBuffer

  let error: unknown
  try {
    validateWorkcellProjectSnapshotV3(snapshot)
  } catch (caught) {
    error = caught
  }
  expect.soft(tagCalls).toBe(0)
  expect.soft(lengthCalls).toBe(0)
  expect.soft(owner.sourceBytes).toBe(forgedBuffer)
  expect(error).toBeInstanceOf(Error)
  expect((error as Error).message).toMatch(/ArrayBuffer/i)
}

function digest(index: number): string {
  return index.toString(16).padStart(64, '0')
}

function robotSource(
  sha256 = DIGEST_A,
  sourceBytes = Uint8Array.from([1, 2, 3]).buffer,
): RobotStepSourceAssetV3 {
  return {
    id: sha256,
    sha256,
    sourceFileName: 'robot.step',
    sourceBytes,
    detectedUnit: 'meter',
    selectedSourceUnit: 'meter',
    unitDecision: 'detected',
    sourceToMeters: 1,
    parserVersion: 'occt-import-js@0.0.23',
    statistics: { vertices: 24, triangles: 12, meshes: 1, materials: 1 },
  }
}

function robotLink(
  linkId: RobotLinkId,
  sourceAssetId = DIGEST_A,
  nodePath: readonly number[] = [Number(linkId.at(-1))],
): RobotLinkGeometryRecordV3 {
  return {
    linkId,
    sourceRefs: [{
      sourceAssetId,
      nodePath,
      nodeName: `${linkId}-body`,
      meshIndices: [0],
    }],
    coordinateMode: 'assembly-zero-pose',
    zeroPoseLocalization: mutable(IDENTITY),
    operatorAdjustment: mutable(IDENTITY),
    visible: true,
    collisionBoxes: [{
      id: 'body',
      center: [0, 0, 0],
      halfExtents: [0.1, 0.1, 0.1],
      quaternion: [0, 0, 0, 1],
    }],
    statistics: { vertices: 24, triangles: 12, meshes: 1, materials: 1 },
  }
}

function mechanics(maxVelocityDegPerSec = 180): FixedSixAxisRobotMechanicsV3 {
  const joints = JOINT_IDS.map((id, index) => ({
    id,
    parentLink: LINK_IDS[index]!,
    childLink: LINK_IDS[index + 1]!,
    originM: [0, 0, index === 0 ? 0.338 : 0] as const,
    axis: [0, 0, 1] as const,
    minDeg: -180,
    maxDeg: 180,
    homeDeg: 0,
    zeroOffsetDeg: 0,
    direction: 1 as const,
    maxVelocityDegPerSec,
  })) as unknown as FixedSixAxisRobotMechanicsV3['joints']
  return { joints, flange: IDENTITY, tool0: IDENTITY }
}

function pose(
  id = 'pose-1',
  anglesDeg: ProjectPoseStepV3['anglesDeg'] = [0, 0, 0, 0, 0, 0],
  durationMs = 1_000,
): ProjectPoseStepV3 {
  return {
    id,
    name: id,
    anglesDeg,
    durationMs,
    easing: 'easeInOut',
    speedPercentToNext: 100,
  }
}

function job(
  id = 'job-1',
  poses: readonly ProjectPoseStepV3[] = [pose()],
): SimulationJobV1 {
  return { id, name: id, revision: 1, poses }
}

function primitiveBox(id = 'box-1'): BoxObjectAssetRecordV3 {
  return {
    id,
    name: id,
    sourceKind: 'box',
    dimensionsM: [1, 1, 1],
    color: '#AABBCC',
    colliderCenter: [0, 0, 0],
    collisionHalfExtents: [0.5, 0.5, 0.5],
    collisionBoxes: [{
      id: 'primitive-body',
      center: [0, 0, 0],
      halfExtents: [0.5, 0.5, 0.5],
      quaternion: [0, 0, 0, 1],
    }],
    statistics: { vertices: 24, triangles: 12, meshes: 1, materials: 1 },
  }
}

function stepAsset(id = 'step-1') {
  return {
    id,
    name: id,
    sourceKind: 'step' as const,
    sourceFileName: `${id}.step`,
    sourceBytes: Uint8Array.from([4, 5, 6]).buffer,
    importScale: 1,
    originMode: 'source' as const,
    colliderCenter: [0, 0, 0] as const,
    collisionHalfExtents: [0.2, 0.2, 0.2] as const,
    collisionBoxes: [{
      id: 'body',
      center: [0, 0, 0] as const,
      halfExtents: [0.2, 0.2, 0.2] as const,
      quaternion: [0, 0, 0, 1] as const,
    }],
    statistics: { vertices: 24, triangles: 12, meshes: 1, materials: 1 },
  }
}

function cylinderAsset(id = 'cylinder-1') {
  return {
    id,
    name: id,
    sourceKind: 'cylinder' as const,
    radiusM: 0.5,
    heightM: 1,
    axis: 'z' as const,
    radialSegments: 32 as const,
    color: '#AABBCC' as const,
    colliderCenter: [0, 0, 0] as const,
    collisionHalfExtents: [0.5, 0.5, 0.5] as const,
    collisionBoxes: [{
      id: 'primitive-body',
      center: [0, 0, 0] as const,
      halfExtents: [0.5, 0.5, 0.5] as const,
      quaternion: [0, 0, 0, 1] as const,
    }],
    statistics: { vertices: 196, triangles: 128, meshes: 1, materials: 1 },
  }
}

function objectInstance(
  id = 'instance-1',
  assetId = 'box-1',
): ObjectInstanceRecordV3 {
  return {
    id,
    assetId,
    name: id,
    manualNumericStatus: 0,
    statusSource: 'manual',
    statusOverlayVisible: true,
    visible: true,
    graspable: false,
  }
}

function builtInEquipment(): ProjectBuiltInEquipmentRecordV3 {
  return {
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
  }
}

function numericStatusBinding(
  entityId: ProjectOpcUaNumericStatusBindingV3['entityId'],
): ProjectOpcUaNumericStatusBindingV3 {
  return { entityId, nodeId: `ns=2;s=${entityId}`, scale: 1, offset: 0 }
}

function transformBinding(
  entityId: ProjectOpcUaEquipmentTransformBindingV3['entityId'],
  smoothing: ProjectOpcUaEquipmentTransformBindingV3['smoothing'] = {
    mode: 'two-cycle',
    cycles: 2,
  },
): ProjectOpcUaEquipmentTransformBindingV3 {
  return {
    entityId,
    gatewayId: 'gateway-1',
    gatewayProfileId: 'profile-1',
    gatewayProfileRevision: DIGEST_B,
    mode: 'absolute',
    referenceFrameId: 'mcp',
    smoothing,
  }
}

function validV3Project(): WorkcellProjectSnapshotV3 {
  return {
    manifest: {
      format: 'WebDigitalTwinProject',
      schemaVersion: WORKCELL_PROJECT_SCHEMA_VERSION_V3,
      projectId: 'project-1',
      name: 'Portable workcell',
      createdAt: '2026-07-13T00:00:00.000Z',
      updatedAt: '2026-07-13T00:00:00.000Z',
    },
    robot: {
      name: 'Six-axis robot',
      basePosition: [0, 0, 0],
      baseRotationDeg: [0, 0, 0],
      sources: [robotSource()],
      links: LINK_IDS.map((linkId) => robotLink(linkId)),
      mechanics: mechanics(),
      mechanicsProvenance: { kind: 'manual', canonicalSha256: DIGEST_B },
    },
    frames: { mcp: IDENTITY, tcp: IDENTITY },
    simulation: { activeJobId: 'job-1', jobs: [job()] },
    objectAssets: [primitiveBox()],
    objectInstances: [objectInstance()],
    builtInEquipment: [builtInEquipment()],
    externalEntities: [
      { entityId: 'object:instance-1', manualTransform: IDENTITY, transformSource: 'manual' },
      { entityId: 'equipment:cup-01', manualTransform: IDENTITY, transformSource: 'manual' },
    ],
    opcUa: {
      endpointUrl: 'opc.tcp://127.0.0.1:4840',
      samplingIntervalMs: 100,
      joints: JOINT_IDS.map((id) => ({
        id,
        nodeId: `ns=2;s=Robot.${id}`,
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

function projectWithJobs(jobCount: number, poseCount: number) {
  const snapshot = mutable(validV3Project())
  snapshot.simulation.jobs = Array.from({ length: jobCount }, (_, jobIndex) => ({
    id: `job-${jobIndex}`,
    name: `Job ${jobIndex}`,
    revision: 1,
    poses: Array.from({ length: poseCount }, (_, poseIndex) => ({
      ...mutable(pose(`pose-${jobIndex}-${poseIndex}`)),
      durationMs: poseIndex === poseCount - 1 ? 1_000 : 16,
    })),
  }))
  snapshot.simulation.activeJobId = jobCount === 0 ? null : 'job-0'
  return snapshot
}

function projectWithTotalPoses(total: number) {
  const snapshot = mutable(validV3Project())
  const jobs: DeepMutable<SimulationJobV1>[] = []
  let remaining = total
  let jobIndex = 0
  while (remaining > 0) {
    const count = Math.min(256, remaining)
    jobs.push(projectWithJobs(1, count).simulation.jobs[0]!)
    jobs.at(-1)!.id = `job-${jobIndex}`
    jobs.at(-1)!.name = `Job ${jobIndex}`
    jobs.at(-1)!.poses.forEach((entry, poseIndex) => {
      entry.id = `pose-${jobIndex}-${poseIndex}`
    })
    remaining -= count
    jobIndex += 1
  }
  snapshot.simulation.jobs = jobs
  snapshot.simulation.activeJobId = jobs.length === 0 ? null : jobs[0]!.id
  return snapshot
}

function projectWithRobotSourceCount(count: number) {
  const snapshot = mutable(validV3Project())
  snapshot.robot.sources = Array.from({ length: count }, (_, index) =>
    robotSource(digest(index + 1)),
  ) as DeepMutable<RobotStepSourceAssetV3>[]
  snapshot.robot.links.forEach((link, index) => {
    link.sourceRefs = count === 0
      ? []
      : [{
          sourceAssetId: snapshot.robot.sources[index % count]!.id,
          nodePath: [index],
          nodeName: `${link.linkId}-body`,
          meshIndices: [0],
        }]
  })
  return snapshot
}

function utf8Text(byteLength: number): string {
  return `${'가'.repeat(Math.floor(byteLength / 3))}${'a'.repeat(byteLength % 3)}`
}

describe('Workcell Project V3 contract', () => {
  it('accepts Jobs, all Object source kinds, Robot sources, and canonical OPC UA bindings', () => {
    const snapshot = mutable(validV3Project())
    snapshot.objectAssets = mutable([
      stepAsset('step-1'),
      primitiveBox('box-1'),
      cylinderAsset('cylinder-1'),
    ])
    snapshot.opcUa.numericStatusBindings = [
      numericStatusBinding('equipment:cup-01'),
      numericStatusBinding('object:instance-1'),
    ]
    snapshot.opcUa.equipmentTransforms = [transformBinding('object:instance-1')]

    const validated = validateWorkcellProjectSnapshotV3(snapshot)
    expect(validated).toEqual(snapshot)
    expect(validated).not.toBe(snapshot)
    expect(Object.isFrozen(validated)).toBe(true)
  })

  it('rejects legacy, duplicate, and orphan numeric Status binding ownership', () => {
    const legacy = mutable(validV3Project())
    Object.assign(legacy.opcUa, { equipment: [] })
    expect(() => validateWorkcellProjectSnapshotV3(legacy)).toThrow(/equipment|legacy|unknown/i)

    const instanceId = mutable(validV3Project())
    instanceId.opcUa.numericStatusBindings = [{
      instanceId: 'instance-1',
      nodeId: 'ns=2;s=Object',
      scale: 1,
      offset: 0,
    } as unknown as DeepMutable<ProjectOpcUaNumericStatusBindingV3>]
    expect(() => validateWorkcellProjectSnapshotV3(instanceId)).toThrow(/instanceId|unknown/i)

    const duplicate = mutable(validV3Project())
    duplicate.opcUa.numericStatusBindings = [
      numericStatusBinding('object:instance-1'),
      numericStatusBinding('object:instance-1'),
    ]
    expect(() => validateWorkcellProjectSnapshotV3(duplicate)).toThrow(/duplicate/i)

    const orphan = mutable(validV3Project())
    orphan.opcUa.numericStatusBindings = [numericStatusBinding('object:missing')]
    expect(() => validateWorkcellProjectSnapshotV3(orphan)).toThrow(/missing|orphan/i)
  })

  it('requires one binding whenever either external source is OPC UA', () => {
    const numeric = mutable(validV3Project())
    numeric.builtInEquipment[0]!.statusSource = 'opcua'
    expect(() => validateWorkcellProjectSnapshotV3(numeric)).toThrow(/numeric|binding/i)

    const transform = mutable(validV3Project())
    transform.externalEntities[0]!.transformSource = 'opcua'
    expect(() => validateWorkcellProjectSnapshotV3(transform)).toThrow(/transform|binding/i)

    const dormant = mutable(validV3Project())
    dormant.opcUa.numericStatusBindings = [numericStatusBinding('object:instance-1')]
    dormant.opcUa.equipmentTransforms = [transformBinding('object:instance-1')]
    expect(() => validateWorkcellProjectSnapshotV3(dormant)).not.toThrow()
  })

  it.each([
    ['workspace mode', (snapshot: Record<string, unknown>) => { snapshot.workspaceMode = 'BUILD' }],
    ['live telemetry', (snapshot: Record<string, unknown>) => {
      const opcUa = snapshot.opcUa as Record<string, unknown>
      opcUa.liveValues = {}
    }],
  ])('rejects transient %s from the durable snapshot', (_label, mutate) => {
    const snapshot = mutable(validV3Project())
    mutate(snapshot as unknown as Record<string, unknown>)
    expect(() => validateWorkcellProjectSnapshotV3(snapshot)).toThrow(/unknown|transient/i)
  })

  it('rejects invalid Object dimensions and any non-fixed smoothing policy', () => {
    const invalidBox = mutable(validV3Project())
    invalidBox.objectAssets[0] = mutable({ ...primitiveBox(), dimensionsM: [1, 0, 1] as const })
    expect(() => validateWorkcellProjectSnapshotV3(invalidBox)).toThrow(/0.001/i)

    const invalidCylinder = mutable(validV3Project())
    const invalidCylinderAsset = mutable(cylinderAsset('box-1'))
    invalidCylinderAsset.radiusM = Number.NaN
    invalidCylinder.objectAssets = [invalidCylinderAsset]
    expect(() => validateWorkcellProjectSnapshotV3(invalidCylinder)).toThrow(/finite/i)

    const color = mutable(validV3Project())
    const invalidColor = mutable(primitiveBox())
    invalidColor.color = '#aabbcc'
    color.objectAssets = [invalidColor]
    expect(() => validateWorkcellProjectSnapshotV3(color)).toThrow(/#RRGGBB/i)

    const smoothing = mutable(validV3Project())
    smoothing.opcUa.equipmentTransforms = [transformBinding(
      'object:instance-1',
      { mode: 'duration', milliseconds: 100 } as unknown as ProjectOpcUaEquipmentTransformBindingV3['smoothing'],
    )]
    expect(() => validateWorkcellProjectSnapshotV3(smoothing)).toThrow(/two-cycle/i)
  })

  it('reports an unsupported Object sourceKind before branch-required fields', () => {
    const snapshot = mutable(validV3Project())
    snapshot.objectAssets = [{
      sourceKind: 'sphere',
    } as unknown as DeepMutable<WorkcellProjectSnapshotV3['objectAssets'][number]>]
    expect(() => validateWorkcellProjectSnapshotV3(snapshot)).toThrow(/sourceKind is unsupported/i)
  })

  it('accepts primitive dimension boundaries and rejects a fixed epsilon outside', () => {
    const epsilon = 1e-12
    const boxWith = (dimensionsM: readonly [number, number, number]) => {
      const snapshot = mutable(validV3Project())
      const half = dimensionsM.map((value) => value / 2) as [number, number, number]
      snapshot.objectAssets[0] = mutable({
        ...primitiveBox(),
        dimensionsM,
        collisionHalfExtents: half,
        collisionBoxes: [{
          id: 'primitive-body', center: [0, 0, 0], halfExtents: half, quaternion: [0, 0, 0, 1],
        }],
      })
      return snapshot
    }
    const cylinderWith = (radiusM: number, heightM: number) => {
      const snapshot = mutable(validV3Project())
      const half = [radiusM, radiusM, heightM / 2] as const
      snapshot.objectAssets = [mutable({
        ...cylinderAsset('box-1'), radiusM, heightM, collisionHalfExtents: half,
        collisionBoxes: [{
          id: 'primitive-body', center: [0, 0, 0], halfExtents: half, quaternion: [0, 0, 0, 1],
        }],
      })]
      return snapshot
    }

    expect(() => validateWorkcellProjectSnapshotV3(boxWith([0.001, 0.001, 0.001]))).not.toThrow()
    expect(() => validateWorkcellProjectSnapshotV3(boxWith([10, 10, 10]))).not.toThrow()
    expect(() => validateWorkcellProjectSnapshotV3(boxWith([0.001 - epsilon, 1, 1]))).toThrow(/0.001/)
    expect(() => validateWorkcellProjectSnapshotV3(boxWith([10 + epsilon, 1, 1]))).toThrow(/10/)
    expect(() => validateWorkcellProjectSnapshotV3(cylinderWith(0.0005, 0.001))).not.toThrow()
    expect(() => validateWorkcellProjectSnapshotV3(cylinderWith(5, 10))).not.toThrow()
    expect(() => validateWorkcellProjectSnapshotV3(cylinderWith(0.0005 - epsilon, 1))).toThrow(/0.0005/)
    expect(() => validateWorkcellProjectSnapshotV3(cylinderWith(5 + epsilon, 1))).toThrow(/5/)
    expect(() => validateWorkcellProjectSnapshotV3(cylinderWith(1, 0.001 - epsilon))).toThrow(/0.001/)
    expect(() => validateWorkcellProjectSnapshotV3(cylinderWith(1, 10 + epsilon))).toThrow(/10/)
  })

  it('enforces Job, per-Job Pose, and Project Pose boundaries exactly', () => {
    expect(() => validateWorkcellProjectSnapshotV3(projectWithJobs(32, 64))).not.toThrow()
    expect(() => validateWorkcellProjectSnapshotV3(projectWithJobs(33, 1))).toThrow(/32/)
    expect(() => validateWorkcellProjectSnapshotV3(projectWithJobs(1, 256))).not.toThrow()
    expect(() => validateWorkcellProjectSnapshotV3(projectWithJobs(1, 257))).toThrow(/256/)
    expect(() => validateWorkcellProjectSnapshotV3(projectWithTotalPoses(2_048))).not.toThrow()
    expect(() => validateWorkcellProjectSnapshotV3(projectWithTotalPoses(2_049))).toThrow(/2048|2,048/)
  })

  it('enforces one through seven unique Robot STEP sources at the Project boundary', () => {
    expect(() => validateWorkcellProjectSnapshotV3(projectWithRobotSourceCount(1))).not.toThrow()
    expect(() => validateWorkcellProjectSnapshotV3(projectWithRobotSourceCount(7))).not.toThrow()
    expect(() => validateWorkcellProjectSnapshotV3(projectWithRobotSourceCount(0))).toThrow(/1.*7/)
    expect(() => validateWorkcellProjectSnapshotV3(projectWithRobotSourceCount(8))).toThrow(/1.*7/)
  })

  it('rejects unreferenced Robot sources and duplicate part ownership across Links', () => {
    const unreferenced = mutable(validV3Project())
    unreferenced.robot.sources.push(robotSource(DIGEST_B))
    expect(() => validateWorkcellProjectSnapshotV3(unreferenced)).toThrow(/unreferenced/i)

    const duplicate = mutable(validV3Project())
    duplicate.robot.links[1]!.sourceRefs = mutable(duplicate.robot.links[0]!.sourceRefs)
    expect(() => validateWorkcellProjectSnapshotV3(duplicate)).toThrow(/ownership/i)
  })

  it('rejects empty Link occurrence ownership', () => {
    const noRefs = mutable(validV3Project())
    noRefs.robot.links[0]!.sourceRefs = []
    expect(() => validateWorkcellProjectSnapshotV3(noRefs)).toThrow(/sourceRefs/i)

    const noMeshes = mutable(validV3Project())
    noMeshes.robot.links[0]!.sourceRefs[0]!.meshIndices = []
    expect(() => validateWorkcellProjectSnapshotV3(noMeshes)).toThrow(/meshIndices/i)
  })

  it('requires positive integer Job revisions and a valid active Job reference', () => {
    expect(() => validateWorkcellProjectSnapshotV3(validV3Project())).not.toThrow()
    for (const invalid of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
      const snapshot = mutable(validV3Project())
      snapshot.simulation.jobs[0]!.revision = invalid
      expect(() => validateWorkcellProjectSnapshotV3(snapshot)).toThrow(/revision/i)
    }
    const missing = mutable(validV3Project())
    missing.simulation.activeJobId = 'missing-job'
    expect(() => validateWorkcellProjectSnapshotV3(missing)).toThrow(/activeJobId/i)
  })

  it.each(['mcp', 'tcp', 'flange', 'tool0'] as const)(
    'rejects non-unit scale on rigid %s transforms',
    (field) => {
      const snapshot = mutable(validV3Project())
      const target = field === 'mcp' || field === 'tcp'
        ? snapshot.frames[field]
        : snapshot.robot.mechanics[field]
      ;(target as unknown as { scale: number[] }).scale = [1, 2, 1]
      expect(() => validateWorkcellProjectSnapshotV3(snapshot)).toThrow(/rigid|unit scale/i)
    },
  )

  it('requires persisted V3 Pose speed and normalized Robot Mechanics', () => {
    const missingSpeed = mutable(validV3Project())
    delete (missingSpeed.simulation.jobs[0]!.poses[0] as { speedPercentToNext?: number }).speedPercentToNext
    expect(() => validateWorkcellProjectSnapshotV3(missingSpeed)).toThrow(/speed/i)

    const terminal = mutable(validV3Project())
    terminal.simulation.jobs[0]!.poses[0]!.durationMs = 999
    expect(() => validateWorkcellProjectSnapshotV3(terminal)).toThrow(/duration/i)

    for (const field of ['homeDeg', 'tool0'] as const) {
      const snapshot = mutable(validV3Project())
      if (field === 'homeDeg') {
        delete (snapshot.robot.mechanics.joints[0] as { homeDeg?: number }).homeDeg
      } else {
        delete (snapshot.robot.mechanics as { tool0?: unknown }).tool0
      }
      expect(() => validateWorkcellProjectSnapshotV3(snapshot)).toThrow(new RegExp(field.replace('Deg', ''), 'i'))
    }

    for (const velocity of [0, -1]) {
      const snapshot = mutable(validV3Project())
      snapshot.robot.mechanics.joints[0]!.maxVelocityDegPerSec = velocity
      expect(() => validateWorkcellProjectSnapshotV3(snapshot)).toThrow(/velocity/i)
    }
  })

  it('accepts Pose limit boundaries and rejects any command-space angle outside', () => {
    const exact = mutable(validV3Project())
    exact.simulation.jobs[0]!.poses[0]!.anglesDeg = [-180, 0, 0, 0, 0, 180]
    expect(() => validateWorkcellProjectSnapshotV3(exact)).not.toThrow()

    const below = mutable(validV3Project())
    below.simulation.jobs[0]!.poses[0]!.anglesDeg[0] = -180 - 1e-9
    expect(() => validateWorkcellProjectSnapshotV3(below)).toThrow(/PROJECT_JOB_POSE_OUT_OF_LIMITS/)

    const above = mutable(validV3Project())
    above.simulation.jobs[0]!.poses[0]!.anglesDeg[5] = 180 + 1e-9
    expect(() => validateWorkcellProjectSnapshotV3(above)).toThrow(/PROJECT_JOB_POSE_OUT_OF_LIMITS/)
  })

  it('preserves fixed tuple arity through the public DeepReadonly aggregate', () => {
    expectTypeOf<WorkcellProjectSnapshotV3['robot']['mechanics']['joints']>()
      .toEqualTypeOf<readonly [ProjectRobotJointV3, ProjectRobotJointV3, ProjectRobotJointV3, ProjectRobotJointV3, ProjectRobotJointV3, ProjectRobotJointV3]>()
    expectTypeOf<ProjectPoseStepV3['anglesDeg']>()
      .toEqualTypeOf<readonly [number, number, number, number, number, number]>()
    expectTypeOf<ObjectAssetGeometryV3['collisionHalfExtents']>()
      .toEqualTypeOf<readonly [number, number, number]>()
    expectTypeOf<ObjectAssetGeometryV3['collisionBoxes']>()
      .toMatchTypeOf<readonly unknown[]>()
    expectTypeOf<DeepReadonly<[number, { value: string }]>>()
      .toEqualTypeOf<readonly [number, { readonly value: string }]>()
    const assertStandaloneRecordsAreReadonly = () => {
      const geometry = {} as ObjectAssetGeometryV3
      const instance = {} as ObjectInstanceRecordV3
      // @ts-expect-error standalone V3 asset records are deeply readonly
      geometry.collisionHalfExtents[0] = 99
      // @ts-expect-error standalone V3 instance records cannot mutate inherited fields
      instance.name = 'changed'
    }
    expectTypeOf(assertStandaloneRecordsAreReadonly).toBeFunction()
  })

  it('owns source buffers at an untrusted structural boundary', () => {
    const input = Uint8Array.from([1, 2, 3]).buffer
    const snapshot = mutable(validV3Project())
    snapshot.robot.sources[0]!.sourceBytes = input
    const borrowedBeforePreflight = snapshot.robot.sources[0]!.sourceBytes
    expect(() => preflightWorkcellProjectShapeV3(snapshot)).not.toThrow()
    expect(snapshot.robot.sources[0]!.sourceBytes).toBe(borrowedBeforePreflight)
    const owned = validateWorkcellProjectSnapshotV3(snapshot)
    new Uint8Array(input)[0] = 9
    snapshot.robot.name = 'caller mutation'
    expect(new Uint8Array(owned.robot.sources[0]!.sourceBytes)[0]).toBe(1)
    expect(owned.robot.name).toBe('Six-axis robot')
    expect(Object.isFrozen(owned.robot.links)).toBe(true)
    expect(Object.isFrozen(owned.robot.links[0]!.sourceRefs[0]!.nodePath))
      .toBe(true)
    expect(collectProjectSourceDescriptorsV3(owned)).toEqual([
      expect.objectContaining({
        namespace: 'robot',
        ownerKey: expect.stringMatching(/^robot-source:/),
        sourceBytes: owned.robot.sources[0]!.sourceBytes,
        declaredSha256: DIGEST_A,
      }),
    ])
  })

  it('does not expose a forgeable staged-buffer registration bypass', () => {
    const snapshot = mutable(validV3Project())
    expect('registerStagedProjectSourceBuffersV3' in projectV3Module).toBe(false)
    expect('issueStagedProjectOwnershipCapabilityV3' in projectV3Module).toBe(false)
    const validateWithCapability = validateStagedWorkcellProjectSnapshotV3 as unknown as (
      value: unknown,
      capability: unknown,
    ) => WorkcellProjectSnapshotV3
    expect(() => validateWithCapability(snapshot, {})).toThrow(/capability|owned/i)
  })

  it('enforces aggregate Robot mesh, material, reference, and assembly-depth budgets', () => {
    const exactSourceBudget = mutable(validV3Project())
    exactSourceBudget.robot.sources[0]!.statistics.meshes = 448
    exactSourceBudget.robot.sources[0]!.statistics.materials = 224
    expect(() => validateWorkcellProjectSnapshotV3(exactSourceBudget)).not.toThrow()

    const meshOver = mutable(exactSourceBudget)
    meshOver.robot.sources[0]!.statistics.meshes = 449
    expect(() => validateWorkcellProjectSnapshotV3(meshOver)).toThrow(/448|mesh/i)

    const materialOver = mutable(exactSourceBudget)
    materialOver.robot.sources[0]!.statistics.materials = 225
    expect(() => validateWorkcellProjectSnapshotV3(materialOver)).toThrow(/224|material/i)

    const linkMeshOver = mutable(validV3Project())
    linkMeshOver.robot.sources[0]!.statistics.meshes = 65
    linkMeshOver.robot.links[0]!.sourceRefs[0]!.meshIndices = Array.from(
      { length: 65 },
      (_, index) => index,
    )
    linkMeshOver.robot.links[0]!.statistics.meshes = 1
    expect(() => validateWorkcellProjectSnapshotV3(linkMeshOver)).toThrow(/64|mesh/i)

    const referencesAtLimit = mutable(validV3Project())
    referencesAtLimit.robot.links.forEach((link, linkIndex) => {
      link.sourceRefs = Array.from({ length: 64 }, (_, referenceIndex) => ({
        sourceAssetId: DIGEST_A,
        nodePath: [linkIndex, referenceIndex],
        nodeName: `${link.linkId}-${referenceIndex}`,
        meshIndices: [0],
      }))
    })
    expect(() => validateWorkcellProjectSnapshotV3(referencesAtLimit)).not.toThrow()
    const referenceOver = mutable(referencesAtLimit)
    referenceOver.robot.links[0]!.sourceRefs.push({
      sourceAssetId: DIGEST_A,
      nodePath: [0, 64],
      nodeName: 'over-budget',
      meshIndices: [0],
    })
    expect(() => validateWorkcellProjectSnapshotV3(referenceOver)).toThrow(/448|reference/i)

    const depthAtLimit = mutable(validV3Project())
    depthAtLimit.robot.links[0]!.sourceRefs[0]!.nodePath = Array.from(
      { length: 64 },
      () => 0,
    )
    expect(() => validateWorkcellProjectSnapshotV3(depthAtLimit)).not.toThrow()
    const depthOver = mutable(depthAtLimit)
    depthOver.robot.links[0]!.sourceRefs[0]!.nodePath.push(0)
    expect(() => validateWorkcellProjectSnapshotV3(depthOver)).toThrow(/64|depth/i)
  })

  it('deterministically enumerates Robot sources before STEP Object owners', () => {
    const snapshot = mutable(validV3Project())
    snapshot.objectAssets = mutable([
      stepAsset('z-step'),
      stepAsset('a-step'),
      primitiveBox('box-1'),
    ])
    const validated = validateWorkcellProjectSnapshotV3(snapshot)

    expect(collectProjectSourceDescriptorsV3(validated).map(({ ownerKey }) => ownerKey))
      .toEqual([
        `robot-source:${DIGEST_A}`,
        'object-asset:a-step',
        'object-asset:z-step',
      ])
  })

  it('orders non-ASCII and canonically equivalent source owner keys by raw code units', () => {
    const ids = ['é', 'e\u0301', '한', 'Å']
    const ownerKeys = (orderedIds: readonly string[]) => {
      const snapshot = mutable(validV3Project())
      snapshot.objectAssets = mutable([
        primitiveBox('box-1'),
        ...orderedIds.map((id) => stepAsset(id)),
      ])
      return collectProjectSourceDescriptorsV3(snapshot)
        .filter(({ namespace }) => namespace === 'object')
        .map(({ ownerKey }) => ownerKey)
    }
    const expected = [...ids]
      .sort((first, second) => first < second ? -1 : first > second ? 1 : 0)
      .map((id) => `object-asset:${id}`)

    expect(ownerKeys(ids)).toEqual(expected)
    expect(ownerKeys([...ids].reverse())).toEqual(expected)
  })

  it('enforces exact Object and shared UTF-8 string boundaries without truncation', () => {
    const objectCounts = (assetCount: number, instanceCount: number) => {
      const snapshot = mutable(validV3Project())
      snapshot.objectAssets = Array.from(
        { length: assetCount },
        (_, index) => mutable(primitiveBox(`asset-${index}`)),
      )
      snapshot.objectInstances = Array.from(
        { length: instanceCount },
        (_, index) => mutable(objectInstance(`instance-${index}`, `asset-${index % assetCount}`)),
      )
      snapshot.externalEntities = [
        ...snapshot.objectInstances.map(({ id }) => ({
          entityId: `object:${id}` as const,
          manualTransform: mutable(IDENTITY),
          transformSource: 'manual' as const,
        })),
        { entityId: 'equipment:cup-01', manualTransform: mutable(IDENTITY), transformSource: 'manual' },
      ]
      return snapshot
    }
    expect(() => validateWorkcellProjectSnapshotV3(objectCounts(256, 512))).not.toThrow()
    expect(() => validateWorkcellProjectSnapshotV3(objectCounts(257, 512))).toThrow(/MAX_OBJECT_ASSETS/)
    expect(() => validateWorkcellProjectSnapshotV3(objectCounts(256, 513))).toThrow(/MAX_OBJECT_INSTANCES/)

    type Mutator = (snapshot: DeepMutable<WorkcellProjectSnapshotV3>, value: string) => void
    const fields: readonly [string, Mutator][] = [
      ['Project id', (snapshot, value) => { snapshot.manifest.projectId = value }],
      ['Project name', (snapshot, value) => { snapshot.manifest.name = value }],
      ['Robot name', (snapshot, value) => { snapshot.robot.name = value }],
      ['Asset id', (snapshot, value) => {
        snapshot.objectAssets[0]!.id = value
        snapshot.objectInstances[0]!.assetId = value
      }],
      ['Asset name', (snapshot, value) => { snapshot.objectAssets[0]!.name = value }],
      ['Instance id', (snapshot, value) => {
        snapshot.objectInstances[0]!.id = value
        snapshot.externalEntities[0]!.entityId = `object:${value}`
      }],
      ['Instance name', (snapshot, value) => { snapshot.objectInstances[0]!.name = value }],
      ['Job id', (snapshot, value) => {
        snapshot.simulation.jobs[0]!.id = value
        snapshot.simulation.activeJobId = value
      }],
      ['Job name', (snapshot, value) => { snapshot.simulation.jobs[0]!.name = value }],
      ['Pose id', (snapshot, value) => { snapshot.simulation.jobs[0]!.poses[0]!.id = value }],
      ['Pose name', (snapshot, value) => { snapshot.simulation.jobs[0]!.poses[0]!.name = value }],
    ]
    for (const [label, mutate] of fields) {
      const exact = mutable(validV3Project())
      mutate(exact, utf8Text(128))
      expect(() => validateWorkcellProjectSnapshotV3(exact), label).not.toThrow()
      const over = mutable(validV3Project())
      mutate(over, utf8Text(129))
      expect(() => validateWorkcellProjectSnapshotV3(over), label).toThrow(/128/)
    }

    for (const target of ['robot', 'object', 'manifest'] as const) {
      const exact = mutable(validV3Project())
      const over = mutable(validV3Project())
      if (target === 'robot') {
        exact.robot.sources[0]!.sourceFileName = `${utf8Text(250)}.step`
        over.robot.sources[0]!.sourceFileName = `${utf8Text(251)}.step`
      } else if (target === 'object') {
        const exactStep = mutable(stepAsset())
        const overStep = mutable(stepAsset())
        exact.objectAssets = [exactStep]
        over.objectAssets = [overStep]
        exact.objectInstances[0]!.assetId = 'step-1'
        over.objectInstances[0]!.assetId = 'step-1'
        exactStep.sourceFileName = `${utf8Text(250)}.step`
        overStep.sourceFileName = `${utf8Text(251)}.step`
      } else {
        exact.robot.mechanicsProvenance = { kind: 'manifest', sourceFileName: utf8Text(255), sourceSha256: DIGEST_B }
        over.robot.mechanicsProvenance = { kind: 'manifest', sourceFileName: utf8Text(256), sourceSha256: DIGEST_B }
      }
      expect(() => validateWorkcellProjectSnapshotV3(exact)).not.toThrow()
      expect(() => validateWorkcellProjectSnapshotV3(over)).toThrow(/255/)
    }
  })

  it('rejects inconsistent primitive-derived fields and live numeric Status', () => {
    const proxy = mutable(validV3Project())
    proxy.objectAssets[0]!.collisionHalfExtents = [0.4, 0.5, 0.5]
    expect(() => validateWorkcellProjectSnapshotV3(proxy)).toThrow(/proxy/i)

    const statistics = mutable(validV3Project())
    statistics.objectAssets[0]!.statistics.triangles = 11
    expect(() => validateWorkcellProjectSnapshotV3(statistics)).toThrow(/statistics/i)

    for (const value of [Number.NaN, Number.POSITIVE_INFINITY]) {
      const numeric = mutable(validV3Project())
      numeric.objectInstances[0]!.manualNumericStatus = value
      expect(() => validateWorkcellProjectSnapshotV3(numeric)).toThrow(/finite/i)
    }

    const live = mutable(validV3Project())
    Object.assign(live.objectInstances[0]!, { numericStatus: 10 })
    expect(() => validateWorkcellProjectSnapshotV3(live)).toThrow(/live|unknown/i)
  })

  it('requires one built-in record/state pair and exact content-addressed Robot source IDs', () => {
    const missingState = mutable(validV3Project())
    missingState.externalEntities = missingState.externalEntities.filter(({ entityId }) => entityId !== 'equipment:cup-01')
    expect(() => validateWorkcellProjectSnapshotV3(missingState)).toThrow(/equipment/i)

    const unknown = mutable(validV3Project())
    unknown.builtInEquipment[0]!.id = 'unknown'
    unknown.externalEntities[1]!.entityId = 'equipment:unknown'
    expect(() => validateWorkcellProjectSnapshotV3(unknown)).toThrow(/catalog/i)

    const geometry = mutable(validV3Project())
    geometry.builtInEquipment[0]!.collisionHalfExtents = [1, 1, 1]
    expect(() => validateWorkcellProjectSnapshotV3(geometry)).toThrow(/geometry|catalog/i)

    const source = mutable(validV3Project())
    source.robot.sources[0]!.id = DIGEST_B
    expect(() => validateWorkcellProjectSnapshotV3(source)).toThrow(/sha256|digest/i)
  })

  it('accepts only the reserved legacy whole-source occurrence exception', () => {
    const legacy = mutable(validV3Project())
    legacy.robot.links.forEach((link, index) => {
      link.coordinateMode = 'link-local'
      link.sourceRefs = [{
        sourceAssetId: DIGEST_A,
        nodePath: [-1, index],
        nodeName: `legacy-whole-source:${link.linkId}`,
        meshIndices: [0],
      }]
    })
    expect(() => validateWorkcellProjectSnapshotV3(legacy)).not.toThrow()

    const invalid = mutable(legacy)
    invalid.robot.links[0]!.sourceRefs[0]!.nodePath = [-2, 0]
    expect(() => validateWorkcellProjectSnapshotV3(invalid)).toThrow(/nodePath/i)
  })

  it('normalizes owned axes and quaternions but rejects near-zero or epsilon-scaled rigid data', () => {
    const normalizable = mutable(validV3Project())
    normalizable.robot.mechanics.joints[0]!.axis = [0, 0, 2]
    normalizable.frames.mcp.quaternion = [0, 0, 0, 2]
    normalizable.robot.links[0]!.collisionBoxes[0]!.quaternion = [0, 0, 0, 2]
    const normalized = validateWorkcellProjectSnapshotV3(normalizable)
    expect(normalized.robot.mechanics.joints[0]!.axis).toEqual([0, 0, 1])
    expect(normalized.frames.mcp.quaternion).toEqual([0, 0, 0, 1])
    expect(normalized.robot.links[0]!.collisionBoxes[0]!.quaternion)
      .toEqual([0, 0, 0, 1])

    const zeroQuaternion = mutable(validV3Project())
    zeroQuaternion.frames.mcp.quaternion = [0, 0, 0, 1e-9]
    expect(() => validateWorkcellProjectSnapshotV3(zeroQuaternion)).toThrow(/1e-9/)

    const epsilonScale = mutable(validV3Project())
    ;(epsilonScale.frames.tcp as unknown as { scale: number[] }).scale = [
      1,
      1 + Number.EPSILON,
      1,
    ]
    expect(() => validateWorkcellProjectSnapshotV3(epsilonScale)).toThrow(/unit scale/i)
  })

  it('overflow-safely normalizes a finite rigid quaternion to a unit quaternion', () => {
    const snapshot = mutable(validV3Project())
    snapshot.frames.mcp = {
      position: [0, 0, 0],
      quaternion: [Number.MAX_VALUE, Number.MAX_VALUE, 0, 0],
      scale: [1, 1, 1],
    }

    const quaternion = validateWorkcellProjectSnapshotV3(snapshot).frames.mcp.quaternion
    expect(quaternion.every(Number.isFinite)).toBe(true)
    expect(Math.hypot(...quaternion)).toBeCloseTo(1, 12)
  })

  it('overflow-safely normalizes a finite Joint axis to a unit vector', () => {
    const snapshot = mutable(validV3Project())
    snapshot.robot.mechanics.joints[0]!.axis = [
      Number.MAX_VALUE,
      Number.MAX_VALUE,
      0,
    ]

    const axis = validateWorkcellProjectSnapshotV3(snapshot)
      .robot.mechanics.joints[0]!.axis
    expect(axis.every(Number.isFinite)).toBe(true)
    expect(Math.hypot(...axis)).toBeCloseTo(1, 12)
  })

  it('canonicalizes duration tolerance and rejects a difference above 1e-9 ms', () => {
    const expectedDuration = 500
    const within = mutable(validV3Project())
    within.simulation.jobs[0]!.poses = mutable([
      pose('pose-1', [0, 0, 0, 0, 0, 0], expectedDuration + 1e-10),
      pose('pose-2', [90, 0, 0, 0, 0, 0]),
    ])
    const canonical = validateWorkcellProjectSnapshotV3(within)
    expect(canonical.simulation.jobs[0]!.poses[0]!.durationMs)
      .toBe(expectedDuration)

    const mismatched = mutable(within)
    mismatched.simulation.jobs[0]!.poses[0]!.durationMs =
      expectedDuration + 1e-9 + 1e-12
    expect(() => validateWorkcellProjectSnapshotV3(mismatched)).toThrow(/duration/i)
  })

  it('requires unique Job/Pose namespaces while allowing the same text across them', () => {
    const overlap = mutable(validV3Project())
    overlap.simulation.jobs[0]!.id = 'shared-id'
    overlap.simulation.jobs[0]!.poses[0]!.id = 'shared-id'
    overlap.simulation.activeJobId = 'shared-id'
    expect(() => validateWorkcellProjectSnapshotV3(overlap)).not.toThrow()

    const duplicateJobs = mutable(validV3Project())
    duplicateJobs.simulation.jobs.push({
      ...mutable(duplicateJobs.simulation.jobs[0]!),
      poses: [mutable(pose('pose-2'))],
    })
    expect(() => validateWorkcellProjectSnapshotV3(duplicateJobs)).toThrow(/duplicate.*Job|duplicate id/i)

    const duplicatePoses = mutable(validV3Project())
    duplicatePoses.simulation.jobs.push({
      id: 'job-2',
      name: 'Job 2',
      revision: 1,
      poses: [mutable(pose('pose-1'))],
    })
    expect(() => validateWorkcellProjectSnapshotV3(duplicatePoses)).toThrow(/duplicate Pose/i)
  })

  it('closes every Mechanics provenance variant and never accepts raw Manifest data', () => {
    const datasheet = mutable(validV3Project())
    datasheet.robot.mechanicsProvenance = {
      kind: 'datasheet',
      configurationId: 'CRB15000-12/1.27',
      configurationRevision: 'X',
    }
    expect(() => validateWorkcellProjectSnapshotV3(datasheet)).not.toThrow()

    const manifest = mutable(validV3Project())
    manifest.robot.mechanicsProvenance = {
      kind: 'manifest',
      sourceFileName: 'mechanics.json',
      sourceSha256: DIGEST_B,
    }
    expect(() => validateWorkcellProjectSnapshotV3(manifest)).not.toThrow()

    const rawManifest = mutable(manifest)
    Object.assign(rawManifest.robot.mechanicsProvenance, {
      sourceManifestBytes: Uint8Array.from([1]).buffer,
    })
    expect(() => validateWorkcellProjectSnapshotV3(rawManifest)).toThrow(/unknown/i)

    const uppercase = mutable(validV3Project())
    uppercase.robot.mechanicsProvenance = {
      kind: 'manual',
      canonicalSha256: DIGEST_B.toUpperCase(),
    }
    expect(() => validateWorkcellProjectSnapshotV3(uppercase)).toThrow(/lowercase/i)
  })

  it('enforces NodeId byte limits and unique transform Profile assignment', () => {
    const exact = mutable(validV3Project())
    exact.opcUa.joints[0]!.nodeId = utf8Text(1_024)
    expect(() => validateWorkcellProjectSnapshotV3(exact)).not.toThrow()

    const over = mutable(validV3Project())
    over.opcUa.joints[0]!.nodeId = utf8Text(1_025)
    expect(() => validateWorkcellProjectSnapshotV3(over)).toThrow(/1024|1,024/)

    const duplicateProfile = mutable(validV3Project())
    duplicateProfile.opcUa.equipmentTransforms = [
      transformBinding('object:instance-1'),
      transformBinding('equipment:cup-01'),
    ]
    expect(() => validateWorkcellProjectSnapshotV3(duplicateProfile))
      .toThrow(/Profile assignment/i)
  })

  it.each([
    ['manifest', (snapshot: DeepMutable<WorkcellProjectSnapshotV3>) => Object.assign(snapshot.manifest, { transient: true })],
    ['Robot source', (snapshot: DeepMutable<WorkcellProjectSnapshotV3>) => Object.assign(snapshot.robot.sources[0]!, { transient: true })],
    ['Link source reference', (snapshot: DeepMutable<WorkcellProjectSnapshotV3>) => Object.assign(snapshot.robot.links[0]!.sourceRefs[0]!, { transient: true })],
    ['Mechanics Joint', (snapshot: DeepMutable<WorkcellProjectSnapshotV3>) => Object.assign(snapshot.robot.mechanics.joints[0]!, { transient: true })],
    ['Pose', (snapshot: DeepMutable<WorkcellProjectSnapshotV3>) => Object.assign(snapshot.simulation.jobs[0]!.poses[0]!, { transient: true })],
    ['Object Asset', (snapshot: DeepMutable<WorkcellProjectSnapshotV3>) => Object.assign(snapshot.objectAssets[0]!, { sourceBytes: new ArrayBuffer(1) })],
    ['Object Instance', (snapshot: DeepMutable<WorkcellProjectSnapshotV3>) => Object.assign(snapshot.objectInstances[0]!, { transform: IDENTITY })],
    ['built-in Equipment', (snapshot: DeepMutable<WorkcellProjectSnapshotV3>) => Object.assign(snapshot.builtInEquipment[0]!, { numericStatus: 1 })],
    ['external state', (snapshot: DeepMutable<WorkcellProjectSnapshotV3>) => Object.assign(snapshot.externalEntities[0]!, { liveTransform: IDENTITY })],
    ['collision policy', (snapshot: DeepMutable<WorkcellProjectSnapshotV3>) => Object.assign(snapshot.collisionPolicy, { findings: [] })],
  ])('rejects unknown nested %s fields', (_label, mutate) => {
    const snapshot = mutable(validV3Project())
    mutate(snapshot)
    expect(() => validateWorkcellProjectSnapshotV3(snapshot)).toThrow(/unknown/i)
  })

  it('rejects symbolic, non-enumerable, and inherited configuration state', () => {
    const symbolic = mutable(validV3Project())
    Object.defineProperty(symbolic.manifest, Symbol('transient'), {
      value: true,
      enumerable: true,
    })
    expect(() => validateWorkcellProjectSnapshotV3(symbolic)).toThrow(/symbol|unknown/i)

    const hidden = mutable(validV3Project())
    Object.defineProperty(hidden.manifest, 'transient', {
      value: true,
      enumerable: false,
    })
    expect(() => validateWorkcellProjectSnapshotV3(hidden)).toThrow(/enumerable|unknown/i)

    const inherited = mutable(validV3Project())
    Object.setPrototypeOf(inherited.manifest, { transient: true })
    expect(() => validateWorkcellProjectSnapshotV3(inherited)).toThrow(/plain|prototype|unknown/i)
  })

  it.each([
    ['a sparse numeric tuple', (tuple: number[]) => { delete tuple[1] }],
    ['an extra string field', (tuple: number[]) => {
      Object.defineProperty(tuple, 'transient', { value: true, enumerable: true })
    }],
    ['a symbol field', (tuple: number[]) => {
      Object.defineProperty(tuple, Symbol('transient'), { value: true, enumerable: true })
    }],
    ['a non-enumerable field', (tuple: number[]) => {
      Object.defineProperty(tuple, 'transient', { value: true, enumerable: false })
    }],
    ['an accessor element', (tuple: number[]) => {
      Object.defineProperty(tuple, '1', { get: () => 0, enumerable: true })
    }],
    ['a modified prototype', (tuple: number[]) => {
      Object.setPrototypeOf(tuple, Object.create(Array.prototype))
    }],
    ['cyclic extra state', (tuple: number[]) => {
      Object.defineProperty(tuple, 'cycle', { value: tuple, enumerable: true })
    }],
  ])('rejects %s on a numeric tuple', (_label, mutateTuple) => {
    const snapshot = mutable(validV3Project())
    mutateTuple(snapshot.robot.basePosition)
    expect(() => validateWorkcellProjectSnapshotV3(snapshot))
      .toThrow(/Invalid workcell project V3:.*(?:array|sparse|unknown|enumerable|data|plain)/i)
  })

  it.each([
    ['STEP', () => stepAsset('box-1'), 'step'],
    ['Box', () => primitiveBox('box-1'), 'box'],
    ['Cylinder', () => cylinderAsset('box-1'), 'cylinder'],
  ])('rejects a self-replacing %s Asset sourceKind accessor without invoking it', (
    _label,
    createAsset,
    sourceKind,
  ) => {
    const snapshot = mutable(validV3Project())
    const asset = mutable(createAsset()) as unknown as DeepMutable<
      WorkcellProjectSnapshotV3['objectAssets'][number]
    >
    snapshot.objectAssets = [asset]
    expectSelfReplacingAccessorRejected(snapshot, asset, 'sourceKind', sourceKind)
  })

  it.each([
    ['datasheet', {
      kind: 'datasheet',
      configurationId: 'robot-configuration',
      configurationRevision: 'revision-1',
    }],
    ['manifest', {
      kind: 'manifest',
      sourceFileName: 'mechanics.json',
      sourceSha256: DIGEST_B,
    }],
    ['manual', {
      kind: 'manual',
      canonicalSha256: DIGEST_B,
    }],
  ])('rejects a self-replacing %s Mechanics provenance kind accessor', (
    kind,
    provenance,
  ) => {
    const snapshot = mutable(validV3Project())
    const record = mutable(provenance) as unknown as DeepMutable<
      WorkcellProjectSnapshotV3['robot']['mechanicsProvenance']
    >
    snapshot.robot.mechanicsProvenance = record
    expectSelfReplacingAccessorRejected(snapshot, record, 'kind', kind)
  })

  it('rejects a self-replacing Link sourceAssetId accessor before ownership tracking', () => {
    const snapshot = mutable(validV3Project())
    const reference = snapshot.robot.links[0]!.sourceRefs[0]!
    expectSelfReplacingAccessorRejected(
      snapshot,
      reference,
      'sourceAssetId',
      DIGEST_A,
    )
  })

  it.each([
    ['id', 'primitive-body'],
    ['center', [0, 0, 0]],
    ['halfExtents', [0.5, 0.5, 0.5]],
    ['quaternion', [0, 0, 0, 1]],
  ])('rejects a self-replacing primitive collision Box %s accessor', (
    field,
    replacementValue,
  ) => {
    const snapshot = mutable(validV3Project())
    const box = snapshot.objectAssets[0]!.collisionBoxes[0]!
    expectSelfReplacingAccessorRejected(snapshot, box, field, replacementValue)
  })

  it.each([
    ['vertices', 24],
    ['triangles', 12],
    ['meshes', 1],
    ['materials', 1],
  ])('rejects a self-replacing primitive statistics %s accessor', (
    field,
    replacementValue,
  ) => {
    const snapshot = mutable(validV3Project())
    const statistics = snapshot.objectAssets[0]!.statistics
    expectSelfReplacingAccessorRejected(snapshot, statistics, field, replacementValue)
  })

  it.each([
    ['mode', 'two-cycle'],
    ['cycles', 2],
  ])('rejects a self-replacing smoothing %s accessor', (field, replacementValue) => {
    const snapshot = mutable(validV3Project())
    snapshot.opcUa.equipmentTransforms = mutable([
      transformBinding('object:instance-1'),
    ])
    const smoothing = snapshot.opcUa.equipmentTransforms[0]!.smoothing
    expectSelfReplacingAccessorRejected(snapshot, smoothing, field, replacementValue)
  })

  it.each(['Robot source', 'STEP Object asset'])(
    'rejects an accessor-forged %s ArrayBuffer without invoking it',
    (sourceKind) => {
      const snapshot = mutable(validV3Project())
      let sourceOwner: object = snapshot.robot.sources[0]!
      if (sourceKind === 'STEP Object asset') {
        const asset = mutable(stepAsset('box-1'))
        snapshot.objectAssets = [asset]
        sourceOwner = asset
      }
      expectAccessorForgedArrayBufferRejected(snapshot, sourceOwner)
    },
  )

  it('rejects own configuration accessors on an ArrayBuffer without invoking them', () => {
    const snapshot = mutable(validV3Project())
    const buffer = Uint8Array.from([1, 2, 3]).buffer
    let calls = 0
    Object.defineProperty(buffer, 'transient', {
      get: () => {
        calls += 1
        return true
      },
      enumerable: true,
      configurable: true,
    })
    snapshot.robot.sources[0]!.sourceBytes = buffer

    let error: unknown
    try {
      validateWorkcellProjectSnapshotV3(snapshot)
    } catch (caught) {
      error = caught
    }
    expect.soft(calls).toBe(0)
    expect(error).toBeInstanceOf(Error)
    expect((error as Error).message).toMatch(/configuration|unknown/i)
  })

  it('exports the approved structural budgets', () => {
    expect(MAX_OBJECT_ASSETS).toBe(256)
    expect(MAX_OBJECT_INSTANCES).toBe(512)
    expect(MAX_VISIBLE_RENDER_ITEMS).toBe(1_024)
    expect(MAX_VISIBLE_STATUS_OVERLAYS).toBe(128)
  })
})
