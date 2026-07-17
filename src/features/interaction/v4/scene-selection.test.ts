import { describe, expect, it } from 'vitest'
import { makeMinimalWorkcellProjectV4 } from '../../../core/project-v4/test-support'
import {
  robotLinkCollisionIdV4,
  spatialEntityCollisionIdV4,
} from '../../../core/robot-runtime/collision-identity'
import type { SceneSelectionTargetV4 } from './scene-selection'
import {
  collisionEntityIdsForSelectionV4,
  robotIdFromSceneSelectionV4,
  sameSceneSelectionV4,
  sceneSelectionKeyV4,
  spatialEntityIdFromSceneSelectionV4,
} from './scene-selection'

const EVERY_SELECTION_VARIANT: readonly SceneSelectionTargetV4[] = [
  { kind: 'robot', robotId: 'robot:A' },
  { kind: 'robot-link', robotId: 'robot:A', linkId: 'link|one' },
  { kind: 'spatial-entity', entityId: 'entity%one' },
  { kind: 'scene-group', groupId: 'group one' },
  { kind: 'scene-frame', frameId: '세계 프레임' },
  { kind: 'robot-frame', robotId: 'robot:A', frameId: 'TCP' },
  { kind: 'entity-frame', entityId: 'entity%one', frameId: '__proto__' },
]

describe('scene selection V4 identity', () => {
  it('assigns an injective namespaced key to every structured selection variant', () => {
    const keys = EVERY_SELECTION_VARIANT.map(sceneSelectionKeyV4)

    expect(new Set(keys).size).toBe(EVERY_SELECTION_VARIANT.length)
    expect(keys.every((key) => key.startsWith('scene-selection-v4:'))).toBe(true)
    expect(keys).not.toContain(expect.stringContaining('robot:A'))
    expect(keys).not.toContain(expect.stringContaining('link|one'))
  })

  it('does not alias equal Robot-local Frame IDs on different Robots', () => {
    const first = { kind: 'robot-frame', robotId: 'robot-a', frameId: 'TCP' } as const
    const second = { kind: 'robot-frame', robotId: 'robot-b', frameId: 'TCP' } as const

    expect(sceneSelectionKeyV4(first)).not.toBe(sceneSelectionKeyV4(second))
    expect(sameSceneSelectionV4(first, second)).toBe(false)
    expect(sameSceneSelectionV4(first, { ...first })).toBe(true)
  })

  it.each([':', '|', '%', 'with spaces', '한글/日本語', '__proto__', 'constructor', 'toString'])(
    'encodes hostile user segment %s without collisions or prototype access',
    (segment) => {
      const robotFrame = {
        kind: 'robot-frame',
        robotId: `robot:${segment}`,
        frameId: `frame|${segment}`,
      } as const
      const entityFrame = {
        kind: 'entity-frame',
        entityId: `robot:${segment}`,
        frameId: `frame|${segment}`,
      } as const

      expect(sceneSelectionKeyV4(robotFrame)).not.toBe(sceneSelectionKeyV4(entityFrame))
      expect(sceneSelectionKeyV4(robotFrame)).not.toContain(`robot:${segment}`)
      expect(sceneSelectionKeyV4(robotFrame)).not.toContain(`frame|${segment}`)
    },
  )

  it('keeps null and structured equality exact', () => {
    expect(sameSceneSelectionV4(null, null)).toBe(true)
    expect(sameSceneSelectionV4(null, EVERY_SELECTION_VARIANT[0]!)).toBe(false)
    expect(sameSceneSelectionV4(
      { kind: 'robot-link', robotId: 'a:b', linkId: 'c' },
      { kind: 'robot-link', robotId: 'a', linkId: 'b:c' },
    )).toBe(false)
  })

  it('extracts only the owning Robot or Spatial Entity identity', () => {
    expect(robotIdFromSceneSelectionV4({ kind: 'robot', robotId: 'robot-a' })).toBe('robot-a')
    expect(robotIdFromSceneSelectionV4({
      kind: 'robot-link',
      robotId: 'robot-b',
      linkId: 'shared',
    })).toBe('robot-b')
    expect(robotIdFromSceneSelectionV4({
      kind: 'robot-frame',
      robotId: 'robot-c',
      frameId: 'TCP',
    })).toBe('robot-c')
    expect(robotIdFromSceneSelectionV4({ kind: 'scene-frame', frameId: 'world' })).toBeNull()

    expect(spatialEntityIdFromSceneSelectionV4({
      kind: 'spatial-entity',
      entityId: 'entity-a',
    })).toBe('entity-a')
    expect(spatialEntityIdFromSceneSelectionV4({
      kind: 'entity-frame',
      entityId: 'entity-b',
      frameId: 'grasp',
    })).toBe('entity-b')
    expect(spatialEntityIdFromSceneSelectionV4({ kind: 'scene-group', groupId: 'g' })).toBeNull()
    expect(spatialEntityIdFromSceneSelectionV4(null)).toBeNull()
  })
})

describe('selection to collision identity V4', () => {
  const project = makeMinimalWorkcellProjectV4()
  const robot = project.robots[0]!
  const definition = project.robotDefinitions[0]!
  const spatialProject = {
    ...project,
    spatialEntities: [{
      id: 'entity:one',
      name: 'Entity',
      geometry: { kind: 'box' as const, dimensionsM: [1, 1, 1] as const, color: '#808080' as const },
      parentFrameId: 'world',
      localPose: { positionM: [0, 0, 0] as const, quaternion: [0, 0, 0, 1] as const },
      visible: true,
      groupId: null,
      removable: true,
      transformOwner: 'manual' as const,
      numericStatus: {
        value: 0,
        sourceOwnership: 'manual' as const,
        overlay: { visible: true, frameId: null },
      },
      graspable: false,
      graspFrames: [],
      movingFrames: [],
    }],
  }

  it('maps a Robot Link to its exact qualified collision entity', () => {
    expect(collisionEntityIdsForSelectionV4(project, {
      kind: 'robot-link',
      robotId: robot.id,
      linkId: definition.links[1]!.id,
    })).toEqual([
      robotLinkCollisionIdV4(robot.id, definition.links[1]!.id),
    ])
  })

  it('maps a whole Robot to every qualified Link in Definition order', () => {
    expect(collisionEntityIdsForSelectionV4(project, {
      kind: 'robot',
      robotId: robot.id,
    })).toEqual(definition.links.map((link) => robotLinkCollisionIdV4(robot.id, link.id)))
  })

  it('maps a Spatial Entity exactly and leaves Groups, Frames, and null unmapped', () => {
    expect(collisionEntityIdsForSelectionV4(spatialProject, {
      kind: 'spatial-entity',
      entityId: 'entity:one',
    })).toEqual([spatialEntityCollisionIdV4('entity:one')])

    for (const selection of EVERY_SELECTION_VARIANT.filter((item) => (
      item.kind === 'scene-group'
      || item.kind === 'scene-frame'
      || item.kind === 'robot-frame'
      || item.kind === 'entity-frame'
    ))) {
      expect(collisionEntityIdsForSelectionV4(spatialProject, selection)).toEqual([])
    }
    expect(collisionEntityIdsForSelectionV4(spatialProject, null)).toEqual([])
  })
})
