import { describe, expect, it } from 'vitest'
import type {
  FixedSixAxisRobotMechanicsV3,
  ProjectRobotJointV3,
} from './robot-source-v3'
import type {
  ProjectPoseStepV3,
  ProjectSimulationStateV3,
} from './simulation-job-v1'
import {
  canonicalizeSimulationDurationsV3,
  deriveCanonicalPoseDurationMsV3,
  reconcileSimulationForMechanicsChange,
  validateSimulationPoseLimitsV3,
} from './simulation-duration-v3'

type DeepMutable<T> = T extends readonly unknown[]
  ? { -readonly [Key in keyof T]: DeepMutable<T[Key]> }
  : T extends object
    ? { -readonly [Key in keyof T]: DeepMutable<T[Key]> }
    : T

function mutable<T>(value: T): DeepMutable<T> {
  return structuredClone(value) as DeepMutable<T>
}

const LINK_IDS = [
  'LINK00',
  'LINK01',
  'LINK02',
  'LINK03',
  'LINK04',
  'LINK05',
  'LINK06',
] as const

const RIGID_IDENTITY = {
  position: [0, 0, 0],
  quaternion: [0, 0, 0, 1],
  scale: [1, 1, 1],
} as const

function mechanics(maxVelocityDegPerSec = 100): FixedSixAxisRobotMechanicsV3 {
  const joints = Array.from({ length: 6 }, (_, index) => ({
    id: `J${index + 1}`,
    parentLink: LINK_IDS[index],
    childLink: LINK_IDS[index + 1],
    originM: [0, 0, 0],
    axis: [0, 0, 1],
    minDeg: -180,
    maxDeg: 180,
    homeDeg: 0,
    zeroOffsetDeg: 0,
    direction: 1,
    maxVelocityDegPerSec,
  })) as unknown as FixedSixAxisRobotMechanicsV3['joints']
  return { joints, flange: RIGID_IDENTITY, tool0: RIGID_IDENTITY }
}

function pose(
  id: string,
  angle = 0,
  durationMs = 1_000,
  speedPercentToNext = 100,
): ProjectPoseStepV3 {
  return {
    id,
    name: id,
    anglesDeg: [angle, 0, 0, 0, 0, 0],
    durationMs,
    easing: 'easeInOut',
    speedPercentToNext,
  }
}

function simulation(): ProjectSimulationStateV3 {
  return {
    activeJobId: 'moving',
    jobs: [
      {
        id: 'moving',
        name: 'Moving',
        revision: 4,
        poses: [pose('start', 0, 1_800, 50), pose('end', 90)],
      },
      {
        id: 'stationary',
        name: 'Stationary',
        revision: 2,
        poses: [pose('only')],
      },
    ],
  }
}

describe('Project V3 canonical simulation duration', () => {
  it('derives duration from the slowest Joint and outgoing Pose speed', () => {
    expect(
      deriveCanonicalPoseDurationMsV3(
        pose('from', 10, 1_000, 50),
        {
          ...pose('to'),
          anglesDeg: [30, 0, 0, 0, 0, 0],
        },
        mechanics(100),
      ),
    ).toBe(400)

    expect(
      deriveCanonicalPoseDurationMsV3(
        pose('from'),
        pose('to'),
        mechanics(100),
      ),
    ).toBe(16)
  })

  it.each([0, 101, Number.NaN])(
    'rejects invalid outgoing speed %s',
    (speed) => {
      expect(() =>
        deriveCanonicalPoseDurationMsV3(
          pose('from', 0, 1_000, speed),
          pose('to', 10),
          mechanics(),
        ),
      ).toThrow(/speedPercentToNext/)
    },
  )

  it('canonicalizes accepted duration tolerance and requires terminal 1000 ms', () => {
    const state = simulation()
    const expected = deriveCanonicalPoseDurationMsV3(
      state.jobs[0]!.poses[0]!,
      state.jobs[0]!.poses[1]!,
      mechanics(),
    )
    const withinTolerance: ProjectSimulationStateV3 = {
      ...state,
      jobs: [
        {
          ...state.jobs[0]!,
          poses: [
            { ...state.jobs[0]!.poses[0]!, durationMs: expected + 1e-10 },
            state.jobs[0]!.poses[1]!,
          ],
        },
        state.jobs[1]!,
      ],
    }

    const canonical = canonicalizeSimulationDurationsV3(
      withinTolerance,
      mechanics(),
    )
    expect(canonical.jobs[0]!.poses[0]!.durationMs).toBe(expected)
    expect(canonical.jobs[0]!.revision).toBe(4)

    const mismatched = mutable(withinTolerance)
    mismatched.jobs[0]!.poses[0]!.durationMs = expected + 1e-8
    expect(() => canonicalizeSimulationDurationsV3(mismatched, mechanics()))
      .toThrow(/duration/i)

    const wrongTerminal = mutable(withinTolerance)
    wrongTerminal.jobs[0]!.poses[1]!.durationMs = 999
    expect(() => canonicalizeSimulationDurationsV3(wrongTerminal, mechanics()))
      .toThrow(/duration/i)
  })

  it('reconciles affected Jobs exactly once and retains unaffected identity', () => {
    const previous = canonicalizeSimulationDurationsV3(simulation(), mechanics())
    const next = reconcileSimulationForMechanicsChange(previous, mechanics(50))

    expect(next.jobs[0]!.poses[0]!.durationMs)
      .toBe(previous.jobs[0]!.poses[0]!.durationMs * 2)
    expect(next.jobs[0]!.revision).toBe(previous.jobs[0]!.revision + 1)
    expect(next.jobs[1]).toBe(previous.jobs[1])
  })

  it('rejects an affected Job whose revision cannot be safely incremented', () => {
    const previous = canonicalizeSimulationDurationsV3(simulation(), mechanics())
    const exhausted: ProjectSimulationStateV3 = {
      ...previous,
      jobs: [{
        ...previous.jobs[0]!,
        revision: Number.MAX_SAFE_INTEGER,
      }, previous.jobs[1]!],
    }
    const before = structuredClone(exhausted)

    expect(() => reconcileSimulationForMechanicsChange(exhausted, mechanics(50)))
      .toThrow(/revision/i)
    expect(exhausted).toEqual(before)
  })

  it('atomically rejects proposed Mechanics limits around saved Poses', () => {
    const state: ProjectSimulationStateV3 = {
      activeJobId: 'job-1',
      jobs: [{
        id: 'job-1',
        name: 'Job 1',
        revision: 1,
        poses: [
          {
            ...pose('pose-1'),
            anglesDeg: [0, 80, 0, 0, 0, 0],
          },
        ],
      }],
    }
    const proposed = mechanics()
    const joints = [...proposed.joints] as ProjectRobotJointV3[]
    joints[1] = { ...joints[1]!, minDeg: -60, maxDeg: 60 }
    const narrowed = { ...proposed, joints } as unknown as FixedSixAxisRobotMechanicsV3
    const before = structuredClone(state)

    expect(() => reconcileSimulationForMechanicsChange(state, narrowed))
      .toThrow(expect.objectContaining({
        code: 'PROJECT_JOB_POSE_OUT_OF_LIMITS',
        totalCount: 1,
        details: [expect.objectContaining({
          jobId: 'job-1',
          poseId: 'pose-1',
          jointId: 'J2',
        })],
      }))
    expect(state).toEqual(before)
  })

  it('accepts inclusive command-space limits and reports every outside angle', () => {
    const robotMechanics = mechanics()
    const min = robotMechanics.joints[0]!.minDeg
    const max = robotMechanics.joints[5]!.maxDeg
    const within: ProjectSimulationStateV3 = {
      activeJobId: 'job-1',
      jobs: [{
        id: 'job-1',
        name: 'Job 1',
        revision: 1,
        poses: [{
          ...pose('pose-1'),
          anglesDeg: [min, 0, 0, 0, 0, max],
        }],
      }],
    }

    expect(() => validateSimulationPoseLimitsV3(within, robotMechanics))
      .not.toThrow()
    const outside = mutable(within)
    outside.jobs[0]!.poses[0]!.anglesDeg[0] = min - 1e-9
    outside.jobs[0]!.poses[0]!.anglesDeg[5] = max + 1e-9
    expect(() => validateSimulationPoseLimitsV3(outside, robotMechanics))
      .toThrow(expect.objectContaining({
        code: 'PROJECT_JOB_POSE_OUT_OF_LIMITS',
        totalCount: 2,
      }))
  })
})
