import { describe, expect, it } from 'vitest'
import {
  canonicalCollisionPairKeyV4,
  robotLinkCollisionIdV4,
  spatialEntityCollisionIdV4,
} from '../../core/robot-runtime/collision-identity'
import type {
  RobotDefinitionV4,
  RobotInstanceV4,
} from '../../core/project-v4/types'
import type { RobotMountContactV1 } from '../project/scene-state-v1'
import type { GeometryCollisionEntity } from './collision'
import {
  deriveCollisionPolicyV4,
  deriveMountContactPairKey,
  intentionalMountPairKeyV4,
} from './mount-contact'

function participant(
  id: string,
  category: GeometryCollisionEntity['category'],
): Pick<GeometryCollisionEntity, 'id' | 'category'> {
  return { id, category }
}

const CONFIGURED: RobotMountContactV1 = {
  baseLinkId: 'LINK00',
  mountSurfaceCollisionEntityId: 'workcell:workbench',
}

describe('mount contact derivation', () => {
  it('publishes a canonical pair only when the configured link and surface are active', () => {
    expect(deriveMountContactPairKey(CONFIGURED, [
      participant('workcell:workbench', 'environment'),
      participant('robot-link:LINK00', 'robot-link'),
    ])).toBe('robot-link:LINK00|workcell:workbench')
  })

  it.each([
    ['missing configuration', null, [
      participant('robot-link:LINK00', 'robot-link'),
      participant('workcell:workbench', 'environment'),
    ]],
    ['incomplete surface', { ...CONFIGURED, mountSurfaceCollisionEntityId: null }, [
      participant('robot-link:LINK00', 'robot-link'),
      participant('workcell:workbench', 'environment'),
    ]],
    ['missing base geometry', CONFIGURED, [
      participant('workcell:workbench', 'environment'),
    ]],
    ['missing surface geometry', CONFIGURED, [
      participant('robot-link:LINK00', 'robot-link'),
    ]],
    ['geometry-free surface category', CONFIGURED, [
      participant('robot-link:LINK00', 'robot-link'),
      participant('workcell:workbench', 'robot-link'),
    ]],
  ] as const)('returns null for %s', (_label, configuration, participants) => {
    expect(deriveMountContactPairKey(configuration, participants)).toBeNull()
  })
})

const IDENTITY = { positionM: [0, 0, 0], quaternion: [0, 0, 0, 1] } as const

function definition(id = 'shared-definition'): RobotDefinitionV4 {
  return {
    id,
    name: id,
    manufacturer: 'Test',
    model: 'Serial',
    assetReferenceIds: ['asset'],
    sourceConventions: {
      asset: {
        linearUnit: 'meter',
        sourceToMeters: 1,
        orientation: { mode: 'up-axis', upAxis: 'z' },
      },
    },
    links: [
      { id: 'tip', name: 'Tip', geometryOccurrences: [] },
      { id: 'root', name: 'Root', geometryOccurrences: [] },
      { id: 'middle', name: 'Middle', geometryOccurrences: [] },
    ],
    joints: [
      {
        id: 'axis-2', type: 'revolute', parentLinkId: 'middle', childLinkId: 'tip',
        origin: IDENTITY, axis: [0, 0, 1], min: -180, max: 180, home: 0,
        zeroOffset: 0, direction: 1, maximumVelocity: 90,
      },
      {
        id: 'axis-1', type: 'revolute', parentLinkId: 'root', childLinkId: 'middle',
        origin: IDENTITY, axis: [0, 0, 1], min: -180, max: 180, home: 0,
        zeroOffset: 0, direction: 1, maximumVelocity: 90,
      },
    ],
    frames: [],
    excludedGeometryOccurrenceKeys: [],
  }
}

function robot(
  id: string,
  intentionalMountEntityId: string | null,
  definitionId = 'shared-definition',
): RobotInstanceV4 {
  return {
    id,
    name: id,
    definitionId,
    visible: true,
    baseParentFrameId: 'world',
    localBasePose: IDENTITY,
    initialJointValues: { 'axis-1': 0, 'axis-2': 0 },
    jointSource: 'simulation',
    selectedToolFrameId: 'tool',
    selectedTcpFrameId: 'tcp',
    numericStatus: {
      value: 0,
      sourceOwnership: 'simulation',
      overlay: { visible: false, frameId: null },
    },
    intentionalMountEntityId,
  }
}

describe('mount contact derivation v4', () => {
  it('qualifies the Definition root and exact declared mount by Robot', () => {
    const candidate = robot('robot:a', 'table|one')
    expect(intentionalMountPairKeyV4(candidate, definition())).toBe(
      canonicalCollisionPairKeyV4(
        robotLinkCollisionIdV4('robot:a', 'root'),
        spatialEntityCollisionIdV4('table|one'),
      ),
    )
  })

  it('derives same-Robot adjacency and only each declared root mount', () => {
    const policy = deriveCollisionPolicyV4(
      [robot('robot-a', 'table'), robot('robot-b', null)],
      [definition()],
      { enabled: true, nearMissMarginM: 0.02 },
    )
    const aRoot = robotLinkCollisionIdV4('robot-a', 'root')
    const aMiddle = robotLinkCollisionIdV4('robot-a', 'middle')
    const bMiddle = robotLinkCollisionIdV4('robot-b', 'middle')

    expect(policy.excludedPairKeys).toContain(
      canonicalCollisionPairKeyV4(aRoot, aMiddle),
    )
    expect(policy.excludedPairKeys).not.toContain(
      canonicalCollisionPairKeyV4(aRoot, bMiddle),
    )
    expect(policy.intentionalMountPairKeys).toEqual(new Set([
      canonicalCollisionPairKeyV4(aRoot, spatialEntityCollisionIdV4('table')),
    ]))
    expect(policy.ignoredContactPairKeys).toEqual(new Set())
  })

  it('rejects missing, duplicate, or mismatched Definitions', () => {
    expect(() => deriveCollisionPolicyV4(
      [robot('robot-a', null, 'missing')],
      [definition()],
      { enabled: true, nearMissMarginM: 0 },
    )).toThrow(/definition/i)
    expect(() => deriveCollisionPolicyV4(
      [robot('robot-a', null)],
      [definition(), definition()],
      { enabled: true, nearMissMarginM: 0 },
    )).toThrow(/duplicate/i)
    expect(() => intentionalMountPairKeyV4(
      robot('robot-a', 'table', 'other'),
      definition(),
    )).toThrow(/definition/i)
  })
})
