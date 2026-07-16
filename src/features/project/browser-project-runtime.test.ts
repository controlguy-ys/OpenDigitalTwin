import { afterEach, describe, expect, it, vi } from 'vitest'
import type { RobotLinkGeometryRecordV2 } from '../../domain/project/project'
import type { WorkcellProjectSnapshotV3 } from '../../domain/project/project-v3'
import type { RobotLinkId } from '../../domain/robot/crb15000'
import { DEFAULT_COLLISION_POLICY } from '../../domain/collision/collision'
import { Group } from 'three'
import { useCollisionStore } from '../collision/collision-store'
import { useCoordinateFrameStore } from '../frames/coordinate-frame-store'
import { useEquipmentStore } from '../equipment/equipment-store'
import { importedGeometryRepository } from '../import/imported-geometry-repository'
import type { ImportedThreeAsset } from '../import/occt-to-three'
import { useRobotStore } from '../joints/robot-store'
import { useObjectAssetStore } from '../objects/object-asset-store'
import { useInteractionStore } from '../interaction/interaction-store'
import { useRobotConfigurationStore } from '../robot/robot-configuration-store'
import { robotGeometryRepository } from '../robot/robot-geometry-repository'
import { useRobotGeometryStore } from '../robot/robot-geometry-store'
import { WORKBENCH_TOP_Z } from '../scene/workcell-constants'
import {
  DEFAULT_ROBOT_SOURCE_FILE_NAMES,
  DEFAULT_ROBOT_SOURCE_SHA256,
} from '../robot/default-robot-geometry'
import {
  createBrowserProjectRuntime,
  type BrowserProjectRuntimeBundleV1,
} from './browser-project-runtime'

const LINK_IDS = [
  'LINK00',
  'LINK01',
  'LINK02',
  'LINK03',
  'LINK04',
  'LINK05',
  'LINK06',
] as const satisfies readonly RobotLinkId[]

function robotLink(linkId: RobotLinkId): RobotLinkGeometryRecordV2 {
  return {
    linkId,
    sourceFileName: `${linkId}.step`,
    sourceBytes: new Uint8Array([1]).buffer,
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
        id: 'default',
        center: [0, 0, 0],
        halfExtents: [0.1, 0.1, 0.1],
        quaternion: [0, 0, 0, 1],
      },
    ],
    statistics: { vertices: 3, triangles: 1, meshes: 1, materials: 1 },
  }
}

const originalLinks = useRobotGeometryStore.getState().links
const originalObjects = useObjectAssetStore.getState()
const originalConfiguration = useRobotConfigurationStore.getState()
const originalRobot = useRobotStore.getState()
const originalFrames = useCoordinateFrameStore.getState()
const originalCollision = {
  policy: useCollisionStore.getState().policy,
  currentFindings: useCollisionStore.getState().currentFindings,
  diagnostics: useCollisionStore.getState().diagnostics,
}

afterEach(() => {
  vi.restoreAllMocks()
  useRobotGeometryStore.setState({ links: originalLinks })
  useObjectAssetStore.setState(originalObjects, true)
  useRobotConfigurationStore.setState(originalConfiguration, true)
  useRobotStore.setState(originalRobot, true)
  useCoordinateFrameStore.setState(originalFrames, true)
  useCollisionStore.getState().replaceCollisionState(originalCollision, null)
  useCollisionStore.getState().setValidationReport(null)
  useEquipmentStore.setState(originalEquipment, true)
  useInteractionStore.setState(originalInteraction, true)
  robotGeometryRepository.clear()
  importedGeometryRepository.replaceAll(new Map())
})

function withPrimitiveAssets(
  snapshot: Awaited<ReturnType<ReturnType<typeof createBrowserProjectRuntime>['createNew']>>,
): WorkcellProjectSnapshotV3 {
  // Tests intentionally construct a valid next immutable snapshot before publication.
  const next = structuredClone(snapshot) as any
  next.manifest.name = 'Primitive Cell'
  next.robot.name = 'Primitive Robot'
  next.scene.entities.find(({ kind }: { kind: string }) => kind === 'robot')!.visible = false
  next.frames.mcp.position = [0.25, 0, 0]
  next.collisionPolicy.warningDistanceM = 0.075
  next.objectAssets = [{
    id: 'box-asset',
    name: 'Box Asset',
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
  }, {
    id: 'cylinder-asset',
    name: 'Cylinder Asset',
    sourceKind: 'cylinder',
    radiusM: 0.5,
    heightM: 1,
    axis: 'z',
    radialSegments: 32,
    color: '#CCDDEE',
    colliderCenter: [0, 0, 0],
    collisionHalfExtents: [0.5, 0.5, 0.5],
    collisionBoxes: [{
      id: 'primitive-body',
      center: [0, 0, 0],
      halfExtents: [0.5, 0.5, 0.5],
      quaternion: [0, 0, 0, 1],
    }],
    statistics: { vertices: 196, triangles: 128, meshes: 1, materials: 1 },
  }]
  next.objectInstances = next.objectAssets.map((asset: { id: string; name: string }, index: number) => ({
    id: `${asset.id}-instance`,
    assetId: asset.id,
    name: `${asset.name} Instance`,
    graspable: false,
    manualNumericStatus: index,
    statusSource: 'manual',
    statusOverlayVisible: false,
    scale: [1, 1, 1],
  }))
  next.scene.entities = [
    ...next.scene.entities,
    ...next.objectInstances.map((instance: { id: string; name: string }, index: number) => ({
      kind: 'object' as const,
      id: `object:${instance.id}` as const,
      name: instance.name,
      parentId: null,
      localPose: {
        positionM: [index * 2, 0, 0] as [number, number, number],
        quaternion: [0, 0, 0, 1] as [number, number, number, number],
      },
      visible: true,
      target: { kind: 'object-instance' as const, id: instance.id },
      transformSource: 'manual' as const,
    })),
  ]
  return next
}
const originalEquipment = useEquipmentStore.getState()
const originalInteraction = useInteractionStore.getState()

function geometryAsset(dispose = vi.fn()): ImportedThreeAsset {
  return {
    group: new Group(),
    colliderCenter: [0, 0, 0],
    bounds: {
      min: [-0.1, -0.1, -0.1],
      max: [0.1, 0.1, 0.1],
      size: [0.2, 0.2, 0.2],
      center: [0, 0, 0],
    },
    dispose,
  }
}

function publishedSignature(runtime: ReturnType<typeof createBrowserProjectRuntime>) {
  return JSON.stringify({
    revisionId: runtime.activeRevisionId(),
    linkVisible: useRobotGeometryStore.getState().links[0]?.visible,
    objectKinds: useObjectAssetStore.getState().assets.map((asset) =>
      'sourceKind' in asset ? asset.sourceKind : 'step'),
    robotName: useRobotConfigurationStore.getState().configuration.name,
    poseCount: useRobotStore.getState().keyframes.length,
    mcpX: useCoordinateFrameStore.getState().frames.mcp.position[0],
    warningDistanceM: useCollisionStore.getState().policy.warningDistanceM,
    hasBoxGeometry: importedGeometryRepository.get('box-asset') !== undefined,
    hasCylinderGeometry: importedGeometryRepository.get('cylinder-asset') !== undefined,
    equipmentIds: useEquipmentStore.getState().records.map(({ id }) => id),
    hiddenEntityIds: useInteractionStore.getState().hiddenEntityIds,
  })
}

function publishRuntime(
  runtime: ReturnType<typeof createBrowserProjectRuntime>,
  bundle: BrowserProjectRuntimeBundleV1,
): void {
  const publication = runtime.apply(bundle)
  publication.commit()
  publication.cleanup()
}

describe('browser project collision policy bridge', () => {
  it('uses bundled GLBs instead of reparsing the seven default STEP sources', async () => {
    const prepareRobotAssets = vi.fn(async (_links: readonly RobotLinkGeometryRecordV2[]) => new Map())
    const defaultLinks = LINK_IDS.map((linkId, index) => ({
      ...robotLink(linkId),
      sourceFileName: DEFAULT_ROBOT_SOURCE_FILE_NAMES[linkId],
      sourceBytes: new Uint8Array([index + 1]).buffer,
    }))
    const runtime = createBrowserProjectRuntime({
      loadRobotGeometry: async () => defaultLinks,
      prepareRobotAssets,
    })

    const snapshot = structuredClone(await runtime.createNew()) as any
    for (const source of snapshot.robot.sources) {
      const linkId = LINK_IDS.find((candidate) =>
        DEFAULT_ROBOT_SOURCE_FILE_NAMES[candidate] === source.sourceFileName,
      )!
      source.sha256 = DEFAULT_ROBOT_SOURCE_SHA256[linkId]
    }
    const resources = await runtime.prepare(snapshot, 'default-bundled')

    expect(prepareRobotAssets).not.toHaveBeenCalled()
    expect(resources.robotAssets.size).toBe(0)
  })

  it('does not substitute bundled GLBs for different STEP bytes with matching filenames', async () => {
    const prepareRobotAssets = vi.fn(async (_links: readonly RobotLinkGeometryRecordV2[]) => new Map())
    const runtime = createBrowserProjectRuntime({
      loadRobotGeometry: async () => LINK_IDS.map((linkId, index) => ({
        ...robotLink(linkId),
        sourceFileName: DEFAULT_ROBOT_SOURCE_FILE_NAMES[linkId],
        sourceBytes: new Uint8Array([index + 1]).buffer,
      })),
      prepareRobotAssets,
    })

    const snapshot = await runtime.createNew()
    await runtime.prepare(snapshot, 'same-names-different-bytes')

    expect(prepareRobotAssets).toHaveBeenCalledOnce()
  })

  it('does not substitute bundled GLBs for a customized default-source assembly mapping', async () => {
    const prepareRobotAssets = vi.fn(async (_links: readonly RobotLinkGeometryRecordV2[]) => new Map())
    const runtime = createBrowserProjectRuntime({
      loadRobotGeometry: async () => LINK_IDS.map((linkId, index) => ({
        ...robotLink(linkId),
        sourceFileName: DEFAULT_ROBOT_SOURCE_FILE_NAMES[linkId],
        sourceBytes: new Uint8Array([index + 1]).buffer,
      })),
      prepareRobotAssets,
    })
    const snapshot = structuredClone(await runtime.createNew()) as any
    for (const source of snapshot.robot.sources) {
      const linkId = LINK_IDS.find((candidate) =>
        DEFAULT_ROBOT_SOURCE_FILE_NAMES[candidate] === source.sourceFileName,
      )!
      source.sha256 = DEFAULT_ROBOT_SOURCE_SHA256[linkId]
    }
    snapshot.robot.links[0].sourceRefs.push({
      ...snapshot.robot.links[0].sourceRefs[0],
      nodeName: 'custom-selection',
    })

    await runtime.prepare(snapshot, 'customized-default-source-mapping')

    expect(prepareRobotAssets).toHaveBeenCalledOnce()
    expect(prepareRobotAssets.mock.calls[0]?.[0].map(({ linkId }) => linkId)).toEqual(['LINK00'])
  })

  it('parses only a customized Link while retaining bundled GLBs for unchanged default Links', async () => {
    const prepareRobotAssets = vi.fn(async (_links: readonly RobotLinkGeometryRecordV2[]) => new Map())
    const runtime = createBrowserProjectRuntime({
      loadRobotGeometry: async () => LINK_IDS.map((linkId, index) => ({
        ...robotLink(linkId),
        sourceFileName: DEFAULT_ROBOT_SOURCE_FILE_NAMES[linkId],
        sourceBytes: new Uint8Array([index + 1]).buffer,
      })),
      prepareRobotAssets,
    })
    const snapshot = structuredClone(await runtime.createNew()) as any
    for (const source of snapshot.robot.sources) {
      const linkId = LINK_IDS.find((candidate) =>
        DEFAULT_ROBOT_SOURCE_FILE_NAMES[candidate] === source.sourceFileName,
      )!
      source.sha256 = DEFAULT_ROBOT_SOURCE_SHA256[linkId]
    }
    const link00SourceId = snapshot.robot.links[0].sourceRefs[0].sourceAssetId
    snapshot.robot.sources.find(({ id }: { id: string }) => id === link00SourceId).sha256 = '0'.repeat(64)

    await runtime.prepare(snapshot, 'one-customized-default-link')

    expect(prepareRobotAssets).toHaveBeenCalledOnce()
    expect(prepareRobotAssets.mock.calls[0]?.[0].map(({ linkId }) => linkId)).toEqual(['LINK00'])
  })

  it('retains bundled GLBs when canonical default Links are stored in a different array order', async () => {
    const prepareRobotAssets = vi.fn(async (_links: readonly RobotLinkGeometryRecordV2[]) => new Map())
    const runtime = createBrowserProjectRuntime({
      loadRobotGeometry: async () => LINK_IDS.map((linkId, index) => ({
        ...robotLink(linkId),
        sourceFileName: DEFAULT_ROBOT_SOURCE_FILE_NAMES[linkId],
        sourceBytes: new Uint8Array([index + 1]).buffer,
      })),
      prepareRobotAssets,
    })
    const snapshot = structuredClone(await runtime.createNew()) as any
    for (const source of snapshot.robot.sources) {
      const linkId = LINK_IDS.find((candidate) =>
        DEFAULT_ROBOT_SOURCE_FILE_NAMES[candidate] === source.sourceFileName,
      )!
      source.sha256 = DEFAULT_ROBOT_SOURCE_SHA256[linkId]
    }
    snapshot.robot.links.reverse()

    await runtime.prepare(snapshot, 'reordered-default-links')

    expect(prepareRobotAssets).not.toHaveBeenCalled()
  })

  it('reuses prepared geometry when a Scene pose changes without changing asset sources', async () => {
    const robotDispose = vi.fn()
    const prepareRobotAssets = vi.fn(async () => new Map([
      ['LINK00' as const, geometryAsset(robotDispose)],
    ]))
    const runtime = createBrowserProjectRuntime({
      loadRobotGeometry: async () => LINK_IDS.map(robotLink),
      prepareRobotAssets,
    })
    const first = withPrimitiveAssets(await runtime.createNew())
    const firstResources = await runtime.prepare(first, 'revision-a')
    publishRuntime(runtime, {
      revisionId: 'revision-a', snapshot: first, generation: 1, resources: firstResources,
    })
    const firstBox = importedGeometryRepository.get('box-asset')
    const next = structuredClone(first) as any
    next.scene.entities.find(({ id }: { id: string }) => id === 'object:box-asset-instance')
      .localPose.positionM = [0.135, 0, 0]

    const nextResources = await runtime.prepare(next, 'revision-b')

    expect(prepareRobotAssets).toHaveBeenCalledTimes(1)
    expect(nextResources.robotAssets).toBe(firstResources.robotAssets)
    expect(nextResources.objectAssets).toBe(firstResources.objectAssets)
    publishRuntime(runtime, {
      revisionId: 'revision-b', snapshot: next, generation: 2, resources: nextResources,
    })
    expect(importedGeometryRepository.get('box-asset')).toBe(firstBox)
    expect(useObjectAssetStore.getState().instances[0]?.transform.position).toEqual([0.135, 0, 0])
    expect(robotDispose).not.toHaveBeenCalled()
  })

  it('does not dispose active geometry when a reused pose bundle is abandoned or rolled back', async () => {
    const robotDispose = vi.fn()
    const runtime = createBrowserProjectRuntime({
      loadRobotGeometry: async () => LINK_IDS.map(robotLink),
      prepareRobotAssets: async () => new Map([
        ['LINK00', geometryAsset(robotDispose)],
      ]),
    })
    const first = withPrimitiveAssets(await runtime.createNew())
    const firstResources = await runtime.prepare(first, 'revision-a')
    publishRuntime(runtime, {
      revisionId: 'revision-a', snapshot: first, generation: 1, resources: firstResources,
    })
    const activeBox = importedGeometryRepository.get('box-asset')
    const next = structuredClone(first) as any
    next.scene.entities.find(({ id }: { id: string }) => id === 'object:box-asset-instance')
      .localPose.positionM = [0.2, 0, 0]

    const abandonedResources = await runtime.prepare(next, 'revision-abandoned')
    runtime.dispose({
      revisionId: 'revision-abandoned', snapshot: next, generation: 2,
      resources: abandonedResources,
    })
    const rollbackResources = await runtime.prepare(next, 'revision-rollback')
    const publication = runtime.apply({
      revisionId: 'revision-rollback', snapshot: next, generation: 3,
      resources: rollbackResources,
    })
    publication.rollback()

    expect(runtime.activeRevisionId()).toBe('revision-a')
    expect(importedGeometryRepository.get('box-asset')).toBe(activeBox)
    expect(robotDispose).not.toHaveBeenCalled()
  })

  it('creates a native V3 project with the canonical collision policy', async () => {
    useRobotGeometryStore.setState({ links: LINK_IDS.map(robotLink) })
    useCollisionStore.getState().setCollisionEnabled(false)
    useCollisionStore.getState().setWarningDistanceM(0.125)
    useCollisionStore
      .getState()
      .ignorePair('robot-link:LINK03|object:cup-01')
    useCoordinateFrameStore.getState().replaceFrames({
      mcp: {
        position: [1, 2, 3],
        quaternion: [0, 0, 1, 0],
        scale: [1, 1, 1],
      },
      tcp: {
        position: [4, 5, 6],
        quaternion: [0, 1, 0, 0],
        scale: [1, 1, 1],
      },
    })

    const browserProjectRuntime = createBrowserProjectRuntime({
      loadRobotGeometry: async () => LINK_IDS.map(robotLink),
      prepareRobotAssets: async () => new Map(),
    })
    const captured = await browserProjectRuntime.createNew()

    expect(captured.manifest.schemaVersion).toBe(3)
    expect(captured.robot.sources).toHaveLength(1)
    expect(new Set(
      captured.robot.links.map((link) => link.sourceRefs[0]?.sourceAssetId),
    )).toEqual(new Set([captured.robot.sources[0]?.id]))
    expect(captured.frames).toEqual({
      mcp: {
        position: [0, 0, 0],
        quaternion: [0, 0, 0, 1],
        scale: [1, 1, 1],
      },
      tcp: {
        position: [0, 0, 0],
        quaternion: [0, 0, 0, 1],
        scale: [1, 1, 1],
      },
    })
    expect(captured.collisionPolicy).toEqual(DEFAULT_COLLISION_POLICY)
    expect(captured.scene.robotMountContact).toEqual({
      baseLinkId: 'LINK00',
      mountSurfaceCollisionEntityId: 'workcell:workbench',
    })
    expect(captured.scene.entities.find(({ id }) => id === 'workcell:workbench')).toEqual({
      kind: 'environment',
      id: 'workcell:workbench',
      name: 'Workbench',
      parentId: null,
      localPose: { positionM: [0, 0, 0], quaternion: [0, 0, 0, 1] },
      visible: true,
    })
    expect(captured.builtInEquipment).toEqual([])
    expect(captured.scene.entities.find(({ kind }) => kind === 'robot')?.localPose)
      .toEqual({ positionM: [0, 0, WORKBENCH_TOP_Z], quaternion: [0, 0, 0, 1] })
  })

  it('restores the persisted collision policy without staging STEP geometry', async () => {
    useRobotGeometryStore.setState({ links: LINK_IDS.map(robotLink) })
    useCollisionStore.getState().setCollisionEnabled(false)
    useCollisionStore.getState().setWarningDistanceM(0.125)
    useCollisionStore
      .getState()
      .ignorePair('robot-link:LINK03|object:cup-01')
    const browserProjectRuntime = createBrowserProjectRuntime({
      loadRobotGeometry: async () => LINK_IDS.map(robotLink),
      prepareRobotAssets: async () => new Map(),
    })
    const created = await browserProjectRuntime.createNew()
    const captured: WorkcellProjectSnapshotV3 = {
      ...created,
      collisionPolicy: {
        enabled: false,
        warningDistanceM: 0.125,
        ignoredPairKeys: ['object:cup-01|robot-link:LINK03'],
        enabledRobotSelfPairs: [],
      },
    }

    useCollisionStore.getState().setCollisionEnabled(true)
    useCollisionStore.getState().setWarningDistanceM(0.001)
    useCollisionStore
      .getState()
      .restorePair('robot-link:LINK03|object:cup-01')
    useCollisionStore.getState().setLatestTelemetry({
      entityCount: 1,
      boxCount: 1,
      broadPhaseCandidateCount: 0,
      narrowPhaseTestCount: 0,
      findingCount: 0,
    })
    const replaceCollisionState = vi.spyOn(
      useCollisionStore.getState(),
      'replaceCollisionState',
    )

    const prepared = await browserProjectRuntime.prepare(captured, 'revision-test')
    publishRuntime(browserProjectRuntime, {
      revisionId: 'revision-test',
      snapshot: captured,
      generation: 1,
      resources: prepared,
    })

    expect(useCollisionStore.getState().policy).toEqual({
      enabled: false,
      warningDistanceM: 0.125,
      ignoredPairKeys: ['object:cup-01|robot-link:LINK03'],
      enabledRobotSelfPairs: [],
    })
    expect(replaceCollisionState).toHaveBeenCalledWith(
      expect.objectContaining({ policy: captured.collisionPolicy }),
      null,
    )
    expect(useCollisionStore.getState().latestTelemetry).toBeNull()
    expect(useCollisionStore.getState().validationReport).toBeNull()
  })

  it('prepares Box and Cylinder assets as V3 read models without legacy markers', async () => {
    const runtime = createBrowserProjectRuntime({
      loadRobotGeometry: async () => LINK_IDS.map(robotLink),
      prepareRobotAssets: async () => new Map(),
    })
    const snapshot = withPrimitiveAssets(await runtime.createNew())

    expect(snapshot.robot.links.every(({ sourceRefs }) =>
      sourceRefs.every(({ nodeName }) => !nodeName.includes('legacy')),
    )).toBe(true)
    const resources = await runtime.prepare(snapshot, 'primitive-revision')
    publishRuntime(runtime, {
      revisionId: 'primitive-revision',
      snapshot,
      generation: 1,
      resources,
    })

    expect(useObjectAssetStore.getState().assets.map(({ id }) => id)).toEqual([
      'box-asset',
      'cylinder-asset',
    ])
    expect(useObjectAssetStore.getState().instances.map((instance) =>
      (instance as typeof instance & { graspable?: boolean }).graspable,
    )).toEqual([false, false])
    expect(importedGeometryRepository.get('box-asset')?.group.children).toHaveLength(1)
    expect(importedGeometryRepository.get('cylinder-asset')?.group.children).toHaveLength(1)
  })

  it('publishes Robot and Built-in Equipment Scene visibility and complete Equipment state', async () => {
    const runtime = createBrowserProjectRuntime({
      loadRobotGeometry: async () => LINK_IDS.map(robotLink),
      prepareRobotAssets: async () => new Map(),
    })
    const snapshot = structuredClone(await runtime.createNew()) as any
    snapshot.scene.entities.find(({ kind }: { kind: string }) => kind === 'robot').visible = false
    snapshot.builtInEquipment = [{
      id: 'cup-01', name: 'Published Cup', kind: 'cup', status: 'WARNING',
      manualNumericStatus: 37, statusSource: 'manual', statusOverlayVisible: false,
      graspable: true, collisionHalfExtents: [0.055, 0.055, 0.075],
      stackLightAnchor: null,
    }]
    snapshot.scene.entities.push({
      kind: 'object', id: 'equipment:cup-01', name: 'Published Cup', parentId: null,
      localPose: { positionM: [1, 2, 3], quaternion: [0, 0, 0, 1] },
      visible: false, target: { kind: 'built-in-equipment', id: 'cup-01' },
      transformSource: 'manual',
    })

    const resources = await runtime.prepare(snapshot, 'equipment-revision')
    publishRuntime(runtime, {
      revisionId: 'equipment-revision', snapshot, generation: 1, resources,
    })

    expect(useRobotGeometryStore.getState().links.every(({ visible }) => !visible)).toBe(true)
    expect(useEquipmentStore.getState().records).toEqual([{
      id: 'cup-01', name: 'Published Cup', kind: 'cup', status: 'WARNING',
      numericStatus: 37, statusSource: 'manual', statusOverlayVisible: false,
      transform: { position: [1, 2, 3], quaternion: [0, 0, 0, 1], scale: [1, 1, 1] },
      graspable: true, collisionHalfExtents: [0.055, 0.055, 0.075],
      stackLightAnchor: null,
    }])
    expect(useInteractionStore.getState().hiddenEntityIds).toContain('equipment:cup-01')
  })

  it('notifies every read-model subscriber only after one complete bundle switch', async () => {
    const runtime = createBrowserProjectRuntime({
      loadRobotGeometry: async () => LINK_IDS.map(robotLink),
      prepareRobotAssets: async () => new Map(),
    })
    const first = await runtime.createNew()
    const firstResources = await runtime.prepare(first, 'revision-a')
    publishRuntime(runtime, { revisionId: 'revision-a', snapshot: first, generation: 1, resources: firstResources })
    const next = withPrimitiveAssets(first)
    const nextResources = await runtime.prepare(next, 'revision-b')
    const observations: string[] = []
    const observe = () => observations.push(publishedSignature(runtime))
    const unsubscribes = [
      useRobotGeometryStore.subscribe(observe),
      useObjectAssetStore.subscribe(observe),
      useRobotConfigurationStore.subscribe(observe),
      useRobotStore.subscribe(observe),
      useCoordinateFrameStore.subscribe(observe),
      useCollisionStore.subscribe(observe),
      useEquipmentStore.subscribe(observe),
      useInteractionStore.subscribe(observe),
      robotGeometryRepository.subscribe(observe),
      importedGeometryRepository.subscribe(observe),
    ]

    publishRuntime(runtime, { revisionId: 'revision-b', snapshot: next, generation: 2, resources: nextResources })
    const complete = publishedSignature(runtime)
    for (const unsubscribe of unsubscribes) unsubscribe()

    expect(observations).toHaveLength(10)
    expect(new Set(observations)).toEqual(new Set([complete]))
  })

  it('rolls back a failed bundle switch without notifying mixed read models', async () => {
    const runtime = createBrowserProjectRuntime({
      loadRobotGeometry: async () => LINK_IDS.map(robotLink),
      prepareRobotAssets: async () => new Map(),
    })
    const first = await runtime.createNew()
    const firstResources = await runtime.prepare(first, 'revision-a')
    publishRuntime(runtime, { revisionId: 'revision-a', snapshot: first, generation: 1, resources: firstResources })
    const before = publishedSignature(runtime)
    const next = withPrimitiveAssets(first)
    const nextResources = await runtime.prepare(next, 'revision-b')
    const observations: string[] = []
    const observe = () => observations.push(publishedSignature(runtime))
    const unsubscribes = [
      useRobotGeometryStore.subscribe(observe),
      useObjectAssetStore.subscribe(observe),
      useRobotConfigurationStore.subscribe(observe),
      useRobotStore.subscribe(observe),
      useCoordinateFrameStore.subscribe(observe),
      useCollisionStore.subscribe(observe),
      useEquipmentStore.subscribe(observe),
      useInteractionStore.subscribe(observe),
      robotGeometryRepository.subscribe(observe),
      importedGeometryRepository.subscribe(observe),
    ]
    vi.spyOn(importedGeometryRepository, 'exchangeAll').mockImplementationOnce(() => {
      throw new Error('object repository publish failed')
    })

    expect(() => runtime.apply({
      revisionId: 'revision-b',
      snapshot: next,
      generation: 2,
      resources: nextResources,
    })).toThrow('object repository publish failed')
    for (const unsubscribe of unsubscribes) unsubscribe()

    expect(observations).toEqual([])
    expect(publishedSignature(runtime)).toBe(before)
  })

  it('restores the published Equipment read model after failed publication', async () => {
    await useEquipmentStore.getState().hydrate()
    const originalCheckpoint = useEquipmentStore.getState().captureRuntimeCheckpoint()
    try {
      const runtime = createBrowserProjectRuntime({
        loadRobotGeometry: async () => LINK_IDS.map(robotLink),
        prepareRobotAssets: async () => new Map(),
      })
      const first = structuredClone(await runtime.createNew()) as any
      first.builtInEquipment = [{
        id: 'cup-01', name: 'Transactional Cup', kind: 'cup', status: 'RUNNING',
        manualNumericStatus: 0, statusSource: 'manual', statusOverlayVisible: true,
        graspable: true, collisionHalfExtents: [0.055, 0.055, 0.075],
        stackLightAnchor: null,
      }]
      first.scene.entities.push({
        kind: 'object', id: 'equipment:cup-01', name: 'Transactional Cup', parentId: null,
        localPose: { positionM: [1, 2, 3], quaternion: [0, 0, 0, 1] },
        visible: true, target: { kind: 'built-in-equipment', id: 'cup-01' },
        transformSource: 'manual',
      })
      const firstResources = await runtime.prepare(first, 'revision-a')
      publishRuntime(runtime, {
        revisionId: 'revision-a', snapshot: first, generation: 1, resources: firstResources,
      })

      const nextBase = withPrimitiveAssets(first)
      const next = {
        ...nextBase,
        scene: {
          ...nextBase.scene,
          entities: nextBase.scene.entities.map((entity) => entity.id === 'equipment:cup-01'
            ? {
                ...entity,
                localPose: { ...entity.localPose, positionM: [4, 5, 6] as const },
              }
            : entity),
        },
      }
      const nextResources = await runtime.prepare(next, 'revision-b')
      const observations: string[] = []
      const unsubscribe = useEquipmentStore.subscribe(() => {
        observations.push(publishedSignature(runtime))
      })
      vi.spyOn(importedGeometryRepository, 'exchangeAll').mockImplementationOnce(() => {
        throw new Error('object repository publish failed')
      })

      expect(() => runtime.apply({
        revisionId: 'revision-b', snapshot: next, generation: 2, resources: nextResources,
      })).toThrow('object repository publish failed')
      unsubscribe()

      expect(observations).toEqual([])
      expect(useEquipmentStore.getState().records[0]?.transform.position).toEqual([1, 2, 3])
    } finally {
      useEquipmentStore.getState().restoreRuntimeCheckpoint(originalCheckpoint)
    }
  })

  it('keeps the new bundle authoritative when disposal of replaced resources fails', async () => {
    const oldDispose = vi.fn()
      .mockImplementationOnce(() => { throw new Error('old cleanup failed') })
      .mockImplementation(() => undefined)
    const newDispose = vi.fn()
    let preparation = 0
    const runtime = createBrowserProjectRuntime({
      loadRobotGeometry: async () => LINK_IDS.map(robotLink),
      prepareRobotAssets: async () => new Map([['LINK00', geometryAsset(
        preparation++ === 0 ? oldDispose : newDispose,
      )]]),
    })
    const first = await runtime.createNew()
    const firstResources = await runtime.prepare(first, 'revision-a')
    publishRuntime(runtime, { revisionId: 'revision-a', snapshot: first, generation: 1, resources: firstResources })
    const next = withPrimitiveAssets(first)
    const nextResources = await runtime.prepare(next, 'revision-b')

    expect(() => publishRuntime(runtime, {
      revisionId: 'revision-b',
      snapshot: next,
      generation: 2,
      resources: nextResources,
    })).not.toThrow()
    expect(runtime.activeRevisionId()).toBe('revision-b')
    expect(useRobotConfigurationStore.getState().configuration.name).toBe('Primitive Robot')
    expect(newDispose).not.toHaveBeenCalled()

    const diagnostic = runtime.readCleanupDiagnostics()[0]
    expect(diagnostic?.message).toContain('old cleanup failed')
    expect(runtime.retryCleanup(diagnostic!.token)).toBe(true)
    expect(runtime.readCleanupDiagnostics()).toEqual([])
  })

  it('bounds retained cleanup diagnostics when repeated old-resource disposal fails', async () => {
    let preparation = 0
    const runtime = createBrowserProjectRuntime({
      loadRobotGeometry: async () => LINK_IDS.map(robotLink),
      prepareRobotAssets: async () => new Map([['LINK00', geometryAsset(
        preparation++ < 9
          ? vi.fn(() => { throw new Error('persistent cleanup failure') })
          : vi.fn(),
      )]]),
    })
    const base = withPrimitiveAssets(await runtime.createNew())

    for (let index = 0; index < 10; index += 1) {
      const snapshot = structuredClone(base) as any
      snapshot.objectAssets[0].color = `#${index.toString(16).padStart(6, '0').toUpperCase()}`
      const revisionId = `revision-${index}`
      const resources = await runtime.prepare(snapshot, revisionId)
      publishRuntime(runtime, { revisionId, snapshot, generation: index + 1, resources })
    }

    const diagnostics = runtime.readCleanupDiagnostics()
    expect(diagnostics).toHaveLength(8)
    expect(new Set(diagnostics.map(({ token }) => token)).size).toBe(8)
    expect(diagnostics.every(({ attempts }) => attempts === 1)).toBe(true)
  })
})
