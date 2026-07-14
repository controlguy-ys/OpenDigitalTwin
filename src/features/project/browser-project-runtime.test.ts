import { afterEach, describe, expect, it, vi } from 'vitest'
import type { RobotLinkGeometryRecordV2 } from '../../domain/project/project'
import type { RobotLinkId } from '../../domain/robot/crb15000'
import { useCollisionStore } from '../collision/collision-store'
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
const originalCollision = {
  policy: useCollisionStore.getState().policy,
  currentFindings: useCollisionStore.getState().currentFindings,
  diagnostics: useCollisionStore.getState().diagnostics,
}

afterEach(() => {
  vi.restoreAllMocks()
  useRobotGeometryStore.setState({ links: originalLinks })
  useCollisionStore.getState().replaceCollisionState(originalCollision, null)
  useCollisionStore.getState().setValidationReport(null)
})

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
})
