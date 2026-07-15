import { afterEach, describe, expect, it, vi } from 'vitest'
import type { RobotLinkGeometryRecordV2 } from '../../domain/project/project'
import type { WorkcellProjectSnapshotV3 } from '../../domain/project/project-v3'
import type { RobotLinkId } from '../../domain/robot/crb15000'
import { useCollisionStore } from '../collision/collision-store'
import { useCoordinateFrameStore } from '../frames/coordinate-frame-store'
import { importedGeometryRepository } from '../import/imported-geometry-repository'
import { useRobotStore } from '../joints/robot-store'
import { useObjectAssetStore } from '../objects/object-asset-store'
import { useRobotConfigurationStore } from '../robot/robot-configuration-store'
import { robotGeometryRepository } from '../robot/robot-geometry-repository'
import { useRobotGeometryStore } from '../robot/robot-geometry-store'
import { createBrowserProjectRuntime } from './browser-project-runtime'

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
  next.robot.links[0]!.visible = false
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
    visible: true,
  }))
  next.externalEntities = next.objectInstances.map((instance: { id: string }, index: number) => ({
    entityId: `object:${instance.id}` as const,
    manualTransform: {
      position: [index * 2, 0, 0] as [number, number, number],
      quaternion: [0, 0, 0, 1] as [number, number, number, number],
      scale: [1, 1, 1] as [1, 1, 1],
    },
    transformSource: 'manual' as const,
  }))
  return next
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
  })
}

describe('browser project collision policy bridge', () => {
  it('creates a native V3 project with the canonical collision policy', async () => {
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
    const captured = await browserProjectRuntime.createNew()

    expect(captured.manifest.schemaVersion).toBe(3)
    expect(captured.robot.sources).toHaveLength(1)
    expect(new Set(
      captured.robot.links.map((link) => link.sourceRefs[0]?.sourceAssetId),
    )).toEqual(new Set([captured.robot.sources[0]?.id]))
    expect(captured.collisionPolicy).toEqual({
      enabled: false,
      warningDistanceM: 0.125,
      ignoredPairKeys: ['object:cup-01|robot-link:LINK03'],
      enabledRobotSelfPairs: [],
    })
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
    const captured = await browserProjectRuntime.createNew()

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
    browserProjectRuntime.publish({
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
    runtime.publish({
      revisionId: 'primitive-revision',
      snapshot,
      generation: 1,
      resources,
    })

    expect(useObjectAssetStore.getState().assets.map(({ id }) => id)).toEqual([
      'box-asset',
      'cylinder-asset',
    ])
    expect(importedGeometryRepository.get('box-asset')?.group.children).toHaveLength(1)
    expect(importedGeometryRepository.get('cylinder-asset')?.group.children).toHaveLength(1)
  })

  it('notifies every read-model subscriber only after one complete bundle switch', async () => {
    const runtime = createBrowserProjectRuntime({
      loadRobotGeometry: async () => LINK_IDS.map(robotLink),
      prepareRobotAssets: async () => new Map(),
    })
    const first = await runtime.createNew()
    const firstResources = await runtime.prepare(first, 'revision-a')
    runtime.publish({ revisionId: 'revision-a', snapshot: first, generation: 1, resources: firstResources })
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
      robotGeometryRepository.subscribe(observe),
      importedGeometryRepository.subscribe(observe),
    ]

    runtime.publish({ revisionId: 'revision-b', snapshot: next, generation: 2, resources: nextResources })
    const complete = publishedSignature(runtime)
    for (const unsubscribe of unsubscribes) unsubscribe()

    expect(observations).toHaveLength(8)
    expect(new Set(observations)).toEqual(new Set([complete]))
  })

  it('rolls back a failed bundle switch without notifying mixed read models', async () => {
    const runtime = createBrowserProjectRuntime({
      loadRobotGeometry: async () => LINK_IDS.map(robotLink),
      prepareRobotAssets: async () => new Map(),
    })
    const first = await runtime.createNew()
    const firstResources = await runtime.prepare(first, 'revision-a')
    runtime.publish({ revisionId: 'revision-a', snapshot: first, generation: 1, resources: firstResources })
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
      robotGeometryRepository.subscribe(observe),
      importedGeometryRepository.subscribe(observe),
    ]
    vi.spyOn(importedGeometryRepository, 'exchangeAll').mockImplementationOnce(() => {
      throw new Error('object repository publish failed')
    })

    expect(() => runtime.publish({
      revisionId: 'revision-b',
      snapshot: next,
      generation: 2,
      resources: nextResources,
    })).toThrow('object repository publish failed')
    for (const unsubscribe of unsubscribes) unsubscribe()

    expect(observations).toEqual([])
    expect(publishedSignature(runtime)).toBe(before)
  })
})
