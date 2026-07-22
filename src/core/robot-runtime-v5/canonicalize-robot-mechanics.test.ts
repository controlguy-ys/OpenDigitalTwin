import { describe, expect, it } from 'vitest'

import type { RigidTransformV5 } from '../project-v5/rigid-transform.js'
import type { RobotMechanicsDraftV1 } from './robot-mechanics-draft.js'
import { canonicalizeRobotMechanicsV5 } from './canonicalize-robot-mechanics.js'

const identity = (): RigidTransformV5 => ({ positionM: [0, 0, 0], quaternion: [0, 0, 0, 1] })
const link = (id: string, occurrenceKey?: string) => ({
  id,
  name: id,
  geometryOccurrences: occurrenceKey === undefined ? [] : [{
    occurrenceKey,
    assetReferenceId: 'asset-robot',
    linkLocalPose: identity(),
    statistics: { vertices: 0, triangles: 0, meshes: 0, materials: 0 },
    collisionBoxes: [],
  }],
})
const movable = (id: string, parentLinkId: string, childLinkId: string, origin = identity()) => ({
  id,
  type: 'revolute' as const,
  parentLinkId,
  childLinkId,
  origin,
  axis: [0, 0, 1] as const,
  min: -180,
  max: 180,
  home: 0,
  zeroOffset: 0,
  direction: 1 as const,
  maximumVelocity: 90,
})
const fixed = (id: string, parentLinkId: string, childLinkId: string, origin = identity()) => ({
  id,
  type: 'fixed' as const,
  parentLinkId,
  childLinkId,
  origin,
  axis: null,
  min: null,
  max: null,
  home: null,
  zeroOffset: 0,
  direction: 1 as const,
  maximumVelocity: null,
})

function makeSixAxisDraft({ j2OriginM }: { readonly j2OriginM: readonly [number, number, number] }): RobotMechanicsDraftV1 {
  return {
    links: Array.from({ length: 7 }, (_, index) => link(`LINK${String(index).padStart(2, '0')}`)),
    joints: Array.from({ length: 6 }, (_, index) => movable(
      `J${index + 1}`,
      `LINK${String(index).padStart(2, '0')}`,
      `LINK${String(index + 1).padStart(2, '0')}`,
      index === 1 ? { positionM: j2OriginM, quaternion: [0, 0, 0, 1] } : identity(),
    )),
    frames: [{ id: 'TCP', name: 'TCP', parentFrameId: 'LINK06', localPose: identity(), role: 'tcp' }],
  }
}

function makeDraftWithFixedCameraMount(): RobotMechanicsDraftV1 {
  return {
    links: [link('LINK00'), link('LINK01'), link('CAMERA', 'camera-body'), link('LINK02')],
    joints: [
      movable('J1', 'LINK00', 'LINK01'),
      fixed('camera-mount', 'LINK01', 'CAMERA', { positionM: [0.1, 0, 0], quaternion: [0, 0, 0, 1] }),
      movable('J2', 'LINK01', 'LINK02'),
    ],
    frames: [{ id: 'TCP', name: 'TCP', parentFrameId: 'LINK02', localPose: identity(), role: 'tcp' }],
  }
}

function makeMovableBranchDraft(): RobotMechanicsDraftV1 {
  return {
    links: [link('LINK00'), link('LINK01'), link('LINK02'), link('LINK03')],
    joints: [movable('J1', 'LINK00', 'LINK01'), movable('J2', 'LINK01', 'LINK02'), movable('J3', 'LINK01', 'LINK03')],
    frames: [],
  }
}

function makeFixedCycleDraft(): RobotMechanicsDraftV1 {
  return {
    links: [link('LINK00'), link('LINK01'), link('LINK02')],
    joints: [fixed('F1', 'LINK00', 'LINK01'), fixed('F2', 'LINK01', 'LINK02'), fixed('F3', 'LINK02', 'LINK00')],
    frames: [],
  }
}

describe('V5 Robot mechanics canonicalization', () => {
  it('keeps each Robot Joint origin and axis independent', () => {
    const compact = canonicalizeRobotMechanicsV5(makeSixAxisDraft({ j2OriginM: [0, 0, 0.20] }))
    const tall = canonicalizeRobotMechanicsV5(makeSixAxisDraft({ j2OriginM: [0, 0, 0.55] }))

    expect(compact.joints[1]!.origin.positionM).toEqual([0, 0, 0.20])
    expect(tall.joints[1]!.origin.positionM).toEqual([0, 0, 0.55])
    expect(compact.joints[1]!.axis).toEqual([0, 0, 1])
  })

  it('collapses fixed accessories without creating a command Joint', () => {
    const result = canonicalizeRobotMechanicsV5(makeDraftWithFixedCameraMount())

    expect(result.joints.map(({ id }) => id)).toEqual(['J1', 'J2'])
    expect(result.links).toHaveLength(3)
    expect(result.links[1]!.geometryOccurrences.map(({ occurrenceKey }) => occurrenceKey)).toContain('camera-body')
    expect(result.links[1]!.geometryOccurrences.find(({ occurrenceKey }) => occurrenceKey === 'camera-body')!.linkLocalPose.positionM).toEqual([0.1, 0, 0])
  })

  it('composes fixed segments into the next movable Joint origin and Link Frames', () => {
    const draft = makeSixAxisDraft({ j2OriginM: [0, 0, 0.2] })
    const result = canonicalizeRobotMechanicsV5({
      ...draft,
      links: [draft.links[0]!, draft.links[1]!, link('ADAPTER'), ...draft.links.slice(2)],
      joints: [
        draft.joints[0]!,
        fixed('F1', 'LINK01', 'ADAPTER', { positionM: [0.1, 0, 0], quaternion: [0, 0, 0, 1] }),
        { ...draft.joints[1]!, parentLinkId: 'ADAPTER' },
        ...draft.joints.slice(2),
      ],
      frames: [{ id: 'Adapter', name: 'Adapter', parentFrameId: 'ADAPTER', localPose: identity(), role: 'custom' }, ...draft.frames],
    })

    expect(result.joints[1]!.parentLinkId).toBe('LINK01')
    expect(result.joints[1]!.origin.positionM).toEqual([0.1, 0, 0.2])
    expect(result.frames.find(({ id }) => id === 'Adapter')!.parentFrameId).toBe('LINK01')
    expect(result.frames.find(({ id }) => id === 'Adapter')!.localPose.positionM).toEqual([0.1, 0, 0])
  })

  it('rejects a movable branch and a fixed cycle', () => {
    expect(() => canonicalizeRobotMechanicsV5(makeMovableBranchDraft())).toThrow(/MOVABLE_BRANCH_UNSUPPORTED/)
    expect(() => canonicalizeRobotMechanicsV5(makeFixedCycleDraft())).toThrow(/KINEMATIC_CYCLE/)
  })

  it('rejects dangling Links and invalid movable or fixed Joint fields', () => {
    const draft = makeSixAxisDraft({ j2OriginM: [0, 0, 0.2] })
    expect(() => canonicalizeRobotMechanicsV5({ ...draft, joints: [{ ...draft.joints[0]!, childLinkId: 'MISSING' }] })).toThrow(/ROBOT_LINK_NOT_FOUND/)
    expect(() => canonicalizeRobotMechanicsV5({ ...draft, joints: [{ ...draft.joints[0]!, axis: [0, 0, 0] }] })).toThrow(/JOINT_AXIS_NOT_NORMALIZABLE/)
    expect(() => canonicalizeRobotMechanicsV5({ ...draft, joints: [{ ...draft.joints[0]!, home: 181 }] })).toThrow(/ROBOT_JOINT_LIMIT_INVALID/)
    expect(() => canonicalizeRobotMechanicsV5({ ...draft, joints: [{ ...draft.joints[0]!, type: 'fixed', axis: [0, 0, 1] }] })).toThrow(/FIXED_JOINT_FIELDS_INVALID/)
  })

  it('rejects duplicate geometry occurrence keys before fixed-segment collapse', () => {
    const draft = makeSixAxisDraft({ j2OriginM: [0, 0, 0.2] })
    expect(() => canonicalizeRobotMechanicsV5({
      ...draft,
      links: [link('LINK00', 'shared-occurrence'), link('LINK01', 'shared-occurrence'), ...draft.links.slice(2)],
    })).toThrow(/GEOMETRY_OCCURRENCE_DUPLICATE/)
  })

  it('rejects an axis whose finite components have a non-finite magnitude', () => {
    const draft = makeSixAxisDraft({ j2OriginM: [0, 0, 0.2] })
    expect(() => canonicalizeRobotMechanicsV5({
      ...draft,
      joints: [{ ...draft.joints[0]!, axis: [Number.MAX_VALUE, Number.MAX_VALUE, Number.MAX_VALUE] }, ...draft.joints.slice(1)],
    })).toThrow(/JOINT_AXIS_NOT_NORMALIZABLE/)
  })

  it('rejects empty Frame ids and uses the runtime movable-Joint count diagnostics', () => {
    const draft = makeSixAxisDraft({ j2OriginM: [0, 0, 0.2] })
    expect(() => canonicalizeRobotMechanicsV5({
      ...draft,
      frames: [{ id: '', name: 'invalid', parentFrameId: 'LINK00', localPose: identity(), role: 'custom' }],
    })).toThrow(/PROJECT_ID_INVALID/)
    expect(() => canonicalizeRobotMechanicsV5({
      links: [link('LINK00'), link('LINK01')],
      joints: [fixed('F1', 'LINK00', 'LINK01')],
      frames: [],
    })).toThrow(/ROBOT_JOINT_COUNT_TOO_SMALL/)
    expect(() => canonicalizeRobotMechanicsV5({
      links: Array.from({ length: 18 }, (_, index) => link(`LINK${index}`)),
      joints: Array.from({ length: 17 }, (_, index) => movable(`J${index}`, `LINK${index}`, `LINK${index + 1}`)),
      frames: [],
    })).toThrow(/ROBOT_JOINT_LIMIT_EXCEEDED/)
  })

  it('composes rotation and translation into geometry, direct Frames, and the next movable Joint only', () => {
    const halfSqrt = Math.SQRT1_2
    const result = canonicalizeRobotMechanicsV5({
      links: [
        link('LINK00'),
        link('LINK01'),
        {
          id: 'ADAPTER',
          name: 'ADAPTER',
          geometryOccurrences: [{
            occurrenceKey: 'adapter-body',
            assetReferenceId: 'asset-robot',
            linkLocalPose: { positionM: [1, 0, 0], quaternion: [0, 0, 0, 1] },
            statistics: { vertices: 0, triangles: 0, meshes: 0, materials: 0 },
            collisionBoxes: [],
          }],
        },
        link('LINK02'),
      ],
      joints: [
        movable('J1', 'LINK00', 'LINK01'),
        fixed('F1', 'LINK01', 'ADAPTER', { positionM: [1, 0, 0], quaternion: [0, 0, halfSqrt, halfSqrt] }),
        movable('J2', 'ADAPTER', 'LINK02', { positionM: [1, 0, 0], quaternion: [0, 0, 0, 1] }),
      ],
      frames: [
        { id: 'Direct', name: 'Direct', parentFrameId: 'ADAPTER', localPose: { positionM: [1, 0, 0], quaternion: [0, 0, 0, 1] }, role: 'custom' },
        { id: 'Nested', name: 'Nested', parentFrameId: 'Direct', localPose: { positionM: [0, 1, 0], quaternion: [0, 0, 0, 1] }, role: 'tcp' },
      ],
    })

    const geometryPose = result.links[1]!.geometryOccurrences[0]!.linkLocalPose
    const direct = result.frames.find(({ id }) => id === 'Direct')!
    expect(geometryPose.positionM[0]).toBeCloseTo(1, 12)
    expect(geometryPose.positionM[1]).toBeCloseTo(1, 12)
    expect(geometryPose.positionM[2]).toBeCloseTo(0, 12)
    expect(direct.parentFrameId).toBe('LINK01')
    expect(direct.localPose.positionM[0]).toBeCloseTo(1, 12)
    expect(direct.localPose.positionM[1]).toBeCloseTo(1, 12)
    expect(result.frames.find(({ id }) => id === 'Nested')).toMatchObject({ parentFrameId: 'Direct', localPose: { positionM: [0, 1, 0] } })
    expect(result.joints[1]!.origin.positionM[0]).toBeCloseTo(1, 12)
    expect(result.joints[1]!.origin.positionM[1]).toBeCloseTo(1, 12)
    expect(result.joints[1]!.origin.positionM[2]).toBeCloseTo(0, 12)
  })
})
