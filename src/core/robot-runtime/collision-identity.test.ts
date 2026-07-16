import { describe, expect, it } from 'vitest'
import { ProjectV4Error } from '../project-v4/errors'
import type { RobotDefinitionV4 } from '../project-v4/types'
import {
  canonicalCollisionPairKeyV4,
  decodeRuntimeIdentitySegmentV4,
  encodeRuntimeIdentitySegmentV4,
  parseRobotLinkCollisionIdV4,
  robotAdjacencyPairKeysV4,
  robotLinkCollisionIdV4,
  rootRobotLinkIdV4,
  spatialEntityCollisionIdV4,
  toolCollisionIdV4,
} from './collision-identity'

const IDENTITY = { positionM: [0, 0, 0], quaternion: [0, 0, 0, 1] } as const

function definition(): RobotDefinitionV4 {
  return {
    id: 'definition:shared',
    name: 'Arbitrary chain',
    manufacturer: 'Test',
    model: 'Variable',
    assetReferenceIds: ['asset'],
    sourceConventions: {
      asset: {
        linearUnit: 'meter',
        sourceToMeters: 1,
        orientation: { mode: 'up-axis', upAxis: 'z' },
      },
    },
    links: [
      { id: 'wrist|tip', name: 'Tip', geometryOccurrences: [] },
      { id: 'base:root', name: 'Base', geometryOccurrences: [] },
      { id: '上部 arm', name: 'Arm', geometryOccurrences: [] },
    ],
    joints: [
      {
        id: 'axis-2',
        type: 'prismatic',
        parentLinkId: '上部 arm',
        childLinkId: 'wrist|tip',
        origin: IDENTITY,
        axis: [1, 0, 0],
        min: 0,
        max: 1,
        home: 0,
        zeroOffset: 0,
        direction: 1,
        maximumVelocity: 1,
      },
      {
        id: 'axis-1',
        type: 'revolute',
        parentLinkId: 'base:root',
        childLinkId: '上部 arm',
        origin: IDENTITY,
        axis: [0, 0, 1],
        min: -180,
        max: 180,
        home: 0,
        zeroOffset: 0,
        direction: 1,
        maximumVelocity: 90,
      },
    ],
    frames: [],
    excludedGeometryOccurrenceKeys: [],
  }
}

describe('collision runtime identity v4', () => {
  it('qualifies equal local Link ids by Robot Instance', () => {
    expect(robotLinkCollisionIdV4('robot-a', 'base')).toBe('robot-link:robot-a:base')
    expect(robotLinkCollisionIdV4('robot-b', 'base')).toBe('robot-link:robot-b:base')
  })

  it.each(['robot:one', 'link|two', '100%', 'ロボット 腕'])(
    'round-trips delimiter and Unicode segment %s canonically',
    (raw) => {
      const encoded = encodeRuntimeIdentitySegmentV4(raw)
      expect(decodeRuntimeIdentitySegmentV4(encoded)).toBe(raw)
      expect(encoded).toBe(encodeURIComponent(raw))
    },
  )

  it('rejects empty, malformed, and non-canonical encoded segments', () => {
    expect(() => encodeRuntimeIdentitySegmentV4('')).toThrow(/empty/i)
    expect(decodeRuntimeIdentitySegmentV4('')).toBeNull()
    expect(decodeRuntimeIdentitySegmentV4('%')).toBeNull()
    expect(decodeRuntimeIdentitySegmentV4('%41')).toBeNull()
    expect(decodeRuntimeIdentitySegmentV4('%e3%83%ad')).toBeNull()
    expect(() => encodeRuntimeIdentitySegmentV4('\ud800')).toThrow(
      /runtime identity segment/i,
    )
    expect(() => encodeRuntimeIdentitySegmentV4(1 as unknown as string)).toThrow(
      /runtime identity segment/i,
    )
  })

  it('round-trips namespaced Robot, Tool, and Spatial identities', () => {
    const robotLink = robotLinkCollisionIdV4('robot:a|b', '上部% link')
    expect(robotLink).toBe('robot-link:robot%3Aa%7Cb:%E4%B8%8A%E9%83%A8%25%20link')
    expect(parseRobotLinkCollisionIdV4(robotLink)).toEqual({
      robotId: 'robot:a|b',
      linkId: '上部% link',
    })
    expect(parseRobotLinkCollisionIdV4('robot-link:robot:%41')).toBeNull()
    expect(parseRobotLinkCollisionIdV4('robot-link:robot:link:extra')).toBeNull()
    expect(toolCollisionIdV4('robot:a', 'tcp|1')).toBe('tool:robot%3Aa:tcp%7C1')
    expect(spatialEntityCollisionIdV4('fixture|a')).toBe('spatial-entity:fixture%7Ca')
    expect(parseRobotLinkCollisionIdV4(
      robotLinkCollisionIdV4('__proto__', 'constructor'),
    )).toEqual({ robotId: '__proto__', linkId: 'constructor' })
  })

  it('sorts canonical pair identities stably', () => {
    const first = robotLinkCollisionIdV4('robot:b', 'root')
    const second = spatialEntityCollisionIdV4('table|1')
    expect(canonicalCollisionPairKeyV4(first, second)).toBe(
      canonicalCollisionPairKeyV4(second, first),
    )
    expect(canonicalCollisionPairKeyV4(first, second).split('|')).toHaveLength(2)
    expect(() => canonicalCollisionPairKeyV4(
      'robot-link:robot:%41',
      second,
    )).toThrow(/canonical/i)
    expect(() => canonicalCollisionPairKeyV4(
      'robot-link:robot:%e4%b8%8a',
      second,
    )).toThrow(/canonical/i)
    expect(() => canonicalCollisionPairKeyV4(
      'spatial-entity:上',
      second,
    )).toThrow(/canonical/i)
    expect(() => canonicalCollisionPairKeyV4(
      1 as unknown as Parameters<typeof canonicalCollisionPairKeyV4>[0],
      second,
    )).toThrow(/canonical/i)
  })

  it('derives arbitrary non-numeric adjacency only for the supplied Robot', () => {
    const robotA = robotAdjacencyPairKeysV4('robot:a', definition())
    const robotB = robotAdjacencyPairKeysV4('robot:b', definition())
    expect(robotA).toEqual(new Set([
      canonicalCollisionPairKeyV4(
        robotLinkCollisionIdV4('robot:a', '上部 arm'),
        robotLinkCollisionIdV4('robot:a', 'wrist|tip'),
      ),
      canonicalCollisionPairKeyV4(
        robotLinkCollisionIdV4('robot:a', 'base:root'),
        robotLinkCollisionIdV4('robot:a', '上部 arm'),
      ),
    ]))
    expect([...robotA].some((key) => robotB.has(key))).toBe(false)
    expect(rootRobotLinkIdV4(definition())).toBe('base:root')
  })

  it('rejects an ambiguous Definition root instead of guessing a fixed Link', () => {
    const candidate = definition()
    try {
      rootRobotLinkIdV4({
        ...candidate,
        joints: candidate.joints.slice(0, 1),
      })
      throw new Error('Expected an invalid Robot chain.')
    } catch (error) {
      expect(error).toBeInstanceOf(ProjectV4Error)
      expect((error as ProjectV4Error).code).toBe('ROBOT_JOINT_CHAIN_INVALID')
    }
  })

  it('retains the stable missing-Link error boundary', () => {
    const candidate = definition()
    try {
      rootRobotLinkIdV4({
        ...candidate,
        joints: candidate.joints.map((joint, index) => index === 0
          ? { ...joint, parentLinkId: 'missing-link' }
          : joint),
      })
      throw new Error('Expected a missing Robot Link.')
    } catch (error) {
      expect(error).toBeInstanceOf(ProjectV4Error)
      expect((error as ProjectV4Error).code).toBe('ROBOT_LINK_NOT_FOUND')
    }
  })

  it('retains the stable duplicate local-id error boundary', () => {
    const candidate = definition()
    try {
      rootRobotLinkIdV4({
        ...candidate,
        links: candidate.links.map((link, index) => index === 0
          ? { ...link, id: candidate.links[1]!.id }
          : link),
      })
      throw new Error('Expected a duplicate Robot local id.')
    } catch (error) {
      expect(error).toBeInstanceOf(ProjectV4Error)
      expect((error as ProjectV4Error).code).toBe('PROJECT_ID_DUPLICATE')
    }
  })
})
