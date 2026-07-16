import { describe, expect, it } from 'vitest'
import {
  ProjectV4Error,
  sampleJointTransitionV4,
  transitionDurationMsV4,
  type RobotJointDefinitionV4,
} from '../project-v4/index.js'

const IDENTITY_POSE = {
  positionM: [0, 0, 0] as const,
  quaternion: [0, 0, 0, 1] as const,
}

function joint(
  id: string,
  type: 'revolute' | 'prismatic',
  min: number,
  max: number,
  maximumVelocity: number,
): RobotJointDefinitionV4 {
  return {
    id,
    type,
    parentLinkId: `${id}-parent`,
    childLinkId: `${id}-child`,
    origin: IDENTITY_POSE,
    axis: [0, 0, 1],
    min,
    max,
    home: 0,
    zeroOffset: 0,
    direction: 1,
    maximumVelocity,
  }
}

const MIXED_JOINTS = Object.freeze([
  joint('turn/table', 'revolute', -200, 200, 90),
  joint('lift:mm', 'prismatic', -1, 1, 0.2),
])

function expectProjectError(action: () => unknown, code: string): ProjectV4Error {
  let error: unknown
  try {
    action()
  } catch (caught) {
    error = caught
  }
  expect(error).toBeInstanceOf(ProjectV4Error)
  expect((error as ProjectV4Error).code).toBe(code)
  return error as ProjectV4Error
}

describe('Job timeline V4', () => {
  it('uses literal Joint IDs and synchronizes duration at speed 1 and 100', () => {
    const from = { 'turn/table': 0, 'lift:mm': 0 }
    const to = { 'turn/table': 90, 'lift:mm': 0.4 }

    expect(transitionDurationMsV4(from, to, 100, MIXED_JOINTS)).toBe(2_000)
    expect(transitionDurationMsV4(from, to, 1, MIXED_JOINTS)).toBe(200_000)
  })

  it.each([0, 101, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    'rejects invalid speed %s',
    (speed) => {
      expectProjectError(
        () => transitionDurationMsV4(
          { 'turn/table': 0, 'lift:mm': 0 },
          { 'turn/table': 10, 'lift:mm': 0.1 },
          speed,
          MIXED_JOINTS,
        ),
        'JOB_SPEED_INVALID',
      )
    },
  )

  it('rejects missing, extra, non-finite, and out-of-limit Joint values', () => {
    const valid = { 'turn/table': 0, 'lift:mm': 0 }

    expectProjectError(
      () => transitionDurationMsV4(
        { 'turn/table': 0 } as Record<string, number>,
        valid,
        100,
        MIXED_JOINTS,
      ),
      'JOINT_VALUE_KEYS_INVALID',
    )
    expectProjectError(
      () => transitionDurationMsV4(
        valid,
        { ...valid, extra: 0 },
        100,
        MIXED_JOINTS,
      ),
      'JOINT_VALUE_KEYS_INVALID',
    )
    expectProjectError(
      () => transitionDurationMsV4(
        { ...valid, 'lift:mm': Number.NaN },
        valid,
        100,
        MIXED_JOINTS,
      ),
      'JOINT_VALUE_NOT_FINITE',
    )
    expectProjectError(
      () => transitionDurationMsV4(
        valid,
        { ...valid, 'turn/table': 201 },
        100,
        MIXED_JOINTS,
      ),
      'JOINT_VALUE_OUT_OF_RANGE',
    )
  })

  it('rejects arrays, accessors, symbols, and non-enumerable Joint properties', () => {
    const valid = { 'turn/table': 0, 'lift:mm': 0 }
    const accessor = Object.defineProperty({ 'lift:mm': 0 }, 'turn/table', {
      enumerable: true,
      get: () => 0,
    })
    const withSymbol = { ...valid, [Symbol('joint')]: 0 }
    const nonEnumerable = Object.defineProperty({ 'turn/table': 0 }, 'lift:mm', {
      enumerable: false,
      value: 0,
    })
    const customPrototype = Object.assign(Object.create({ inherited: 0 }), valid)

    for (const invalid of [[0, 0], accessor, withSymbol, nonEnumerable, customPrototype]) {
      expectProjectError(
        () => transitionDurationMsV4(
          invalid as unknown as Record<string, number>,
          valid,
          100,
          MIXED_JOINTS,
        ),
        'JOINT_VALUE_KEYS_INVALID',
      )
    }
  })

  it('returns duration zero and a fresh exact target for no movement', () => {
    const target = { 'turn/table': 15, 'lift:mm': 0.25 }
    expect(transitionDurationMsV4(target, target, 100, MIXED_JOINTS)).toBe(0)

    const sampled = sampleJointTransitionV4({
      from: target,
      to: target,
      elapsedMs: 0,
      durationMs: 0,
      joints: MIXED_JOINTS,
    })
    expect(sampled).toEqual(target)
    expect(sampled).not.toBe(target)
    expect(Object.isFrozen(sampled)).toBe(true)
  })

  it('chooses limit-safe +360 and -360 revolute candidates', () => {
    const revolute = [joint('azimuth', 'revolute', -200, 200, 20)]

    expect(transitionDurationMsV4({ azimuth: 170 }, { azimuth: -170 }, 100, revolute)).toBe(1_000)
    expect(sampleJointTransitionV4({
      from: { azimuth: 170 },
      to: { azimuth: -170 },
      elapsedMs: 500,
      durationMs: 1_000,
      joints: revolute,
    })).toEqual({ azimuth: 180 })

    expect(sampleJointTransitionV4({
      from: { azimuth: -170 },
      to: { azimuth: 170 },
      elapsedMs: 500,
      durationMs: 1_000,
      joints: revolute,
    })).toEqual({ azimuth: -180 })
  })

  it('uses raw delta as the stable tie and rejects wraps that leave limits', () => {
    const tieJoint = [joint('azimuth', 'revolute', -180, 180, 180)]
    expect(sampleJointTransitionV4({
      from: { azimuth: 0 },
      to: { azimuth: 180 },
      elapsedMs: 500,
      durationMs: 1_000,
      joints: tieJoint,
    })).toEqual({ azimuth: 90 })
    expect(sampleJointTransitionV4({
      from: { azimuth: 0 },
      to: { azimuth: -180 },
      elapsedMs: 500,
      durationMs: 1_000,
      joints: tieJoint,
    })).toEqual({ azimuth: -90 })

    expect(transitionDurationMsV4(
      { azimuth: 170 },
      { azimuth: -170 },
      100,
      tieJoint,
    )).toBeCloseTo(1_888.888888888889)
    expect(sampleJointTransitionV4({
      from: { azimuth: 170 },
      to: { azimuth: -170 },
      elapsedMs: 500,
      durationMs: 1_000,
      joints: tieJoint,
    })).toEqual({ azimuth: 0 })

    const narrowJoint = [joint('azimuth', 'revolute', -175, 175, 340)]
    expect(transitionDurationMsV4(
      { azimuth: -170 },
      { azimuth: 170 },
      100,
      narrowJoint,
    )).toBe(1_000)
  })

  it('interpolates prismatic Joints linearly and clamps sampling progress', () => {
    expect(sampleJointTransitionV4({
      from: { 'turn/table': 0, 'lift:mm': 0 },
      to: { 'turn/table': 90, 'lift:mm': 0.4 },
      elapsedMs: 500,
      durationMs: 1_000,
      joints: MIXED_JOINTS,
    })).toEqual({ 'turn/table': 45, 'lift:mm': 0.2 })

    expect(sampleJointTransitionV4({
      from: { 'turn/table': 0, 'lift:mm': 0 },
      to: { 'turn/table': 90, 'lift:mm': 0.4 },
      elapsedMs: 0,
      durationMs: 1_000,
      joints: MIXED_JOINTS,
    })).toEqual({ 'turn/table': 0, 'lift:mm': 0 })

    expect(sampleJointTransitionV4({
      from: { 'turn/table': 0, 'lift:mm': 0 },
      to: { 'turn/table': 90, 'lift:mm': 0.4 },
      elapsedMs: 2_000,
      durationMs: 1_000,
      joints: MIXED_JOINTS,
    })).toEqual({ 'turn/table': 90, 'lift:mm': 0.4 })
  })

  it('restores the exact persisted target at wrapped completion', () => {
    const revolute = [joint('azimuth', 'revolute', -200, 200, 20)]
    expect(sampleJointTransitionV4({
      from: { azimuth: 170 },
      to: { azimuth: -170 },
      elapsedMs: 1_000,
      durationMs: 1_000,
      joints: revolute,
    })).toEqual({ azimuth: -170 })
  })

  it.each([
    { elapsedMs: -1, durationMs: 1_000 },
    { elapsedMs: Number.NaN, durationMs: 1_000 },
    { elapsedMs: 0, durationMs: -1 },
    { elapsedMs: 0, durationMs: Number.POSITIVE_INFINITY },
  ])('rejects invalid sample timing $elapsedMs/$durationMs', ({ elapsedMs, durationMs }) => {
    expectProjectError(
      () => sampleJointTransitionV4({
        from: { 'turn/table': 0, 'lift:mm': 0 },
        to: { 'turn/table': 90, 'lift:mm': 0.4 },
        elapsedMs,
        durationMs,
        joints: MIXED_JOINTS,
      }),
      'JOB_TIMELINE_TIME_INVALID',
    )
  })

  it('does not mutate or retain caller Joint records or arrays', () => {
    const from = { 'turn/table': 0, 'lift:mm': 0 }
    const to = { 'turn/table': 90, 'lift:mm': 0.4 }
    const joints = [...MIXED_JOINTS]
    const beforeFrom = structuredClone(from)
    const beforeTo = structuredClone(to)
    const beforeJoints = structuredClone(joints)

    const sampled = sampleJointTransitionV4({
      from,
      to,
      elapsedMs: 500,
      durationMs: 1_000,
      joints,
    })

    expect(from).toEqual(beforeFrom)
    expect(to).toEqual(beforeTo)
    expect(joints).toEqual(beforeJoints)
    expect(sampled).not.toBe(from)
    expect(sampled).not.toBe(to)
  })

  it.each(['__proto__', 'constructor', 'toString'])(
    'treats prototype-shaped Joint ID %s as a literal own key',
    (jointId) => {
      const specialJoint = [joint(jointId, 'prismatic', -1, 1, 0.5)]
      const from = Object.fromEntries([[jointId, 0]])
      const to = Object.fromEntries([[jointId, 0.5]])

      expect(transitionDurationMsV4(from, to, 100, specialJoint)).toBe(1_000)
      const sampled = sampleJointTransitionV4({
        from,
        to,
        elapsedMs: 500,
        durationMs: 1_000,
        joints: specialJoint,
      })
      expect(Object.hasOwn(sampled, jointId)).toBe(true)
      expect(sampled[jointId]).toBe(0.25)
    },
  )
})
