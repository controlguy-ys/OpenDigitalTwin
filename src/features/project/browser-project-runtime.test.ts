import { afterEach, describe, expect, it } from 'vitest'
import type {
  CurrentProjectSnapshot,
  RobotLinkGeometryRecordV2,
} from '../../domain/project/project'
import type { RobotLinkId } from '../../domain/robot/crb15000'
import { useCollisionStore } from '../collision/collision-store'
import { useRobotGeometryStore } from '../robot/robot-geometry-store'
import { browserProjectRuntime } from './browser-project-runtime'

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
  useRobotGeometryStore.setState({ links: originalLinks })
  useCollisionStore.getState().replaceCollisionState(originalCollision)
})

describe('browser project collision policy bridge', () => {
  it('captures the canonical ignored-pair policy in the V2 snapshot', async () => {
    useRobotGeometryStore.setState({ links: LINK_IDS.map(robotLink) })
    useCollisionStore.getState().setCollisionEnabled(false)
    useCollisionStore.getState().setWarningDistanceM(0.125)
    useCollisionStore
      .getState()
      .ignorePair('robot-link:LINK03|object:cup-01')

    const captured = (await browserProjectRuntime.capture(
      null,
    )) as CurrentProjectSnapshot

    expect(captured.manifest.schemaVersion).toBe(2)
    expect(captured.collisionPolicy).toEqual({
      enabled: false,
      warningDistanceM: 0.125,
      ignoredPairKeys: ['object:cup-01|robot-link:LINK03'],
      enabledRobotSelfPairs: [],
    })
  })
})
