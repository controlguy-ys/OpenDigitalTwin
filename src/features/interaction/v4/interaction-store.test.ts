import { describe, expect, it } from 'vitest'
import {
  ProjectV4Error,
  validateWorkcellProjectV4,
  type RobotInstanceV4,
  type RobotJobV4,
  type SceneGroupV4,
  type SpatialEntityV4,
  type WorkcellProjectV4,
} from '../../../core/project-v4/index'
import { makeMinimalWorkcellProjectV4 } from '../../../core/project-v4/test-support'
import type {
  PersistedVisibilityTargetV4,
  SceneSelectionTargetV4,
} from './scene-selection'
import {
  createInteractionStoreV4,
  type InteractionCheckpointV4,
} from './interaction-store'

const IDENTITY_POSE = Object.freeze({
  positionM: Object.freeze([0, 0, 0] as const),
  quaternion: Object.freeze([0, 0, 0, 1] as const),
})

interface ProjectOptions {
  readonly revisionId: string
  readonly robotIds?: readonly string[]
  readonly jobs?: readonly RobotJobV4[]
}

function projectWithRobots({
  revisionId,
  robotIds = ['robot-a'],
  jobs = [],
}: ProjectOptions): WorkcellProjectV4 {
  const base = makeMinimalWorkcellProjectV4()
  const template = base.robots[0]!
  const robots = robotIds.map((id): RobotInstanceV4 => ({
    ...template,
    id,
    name: `Robot ${id}`,
  }))
  return validateWorkcellProjectV4({
    ...base,
    revisionId,
    metadata: {
      ...base.metadata,
      updatedAt: `2026-07-17T00:00:${revisionId.length.toString().padStart(2, '0')}.000Z`,
    },
    robots,
    jobs: structuredClone(jobs),
    robotDefinitions: robotIds.length === 0 ? [] : base.robotDefinitions,
    assetReferences: robotIds.length === 0 ? [] : base.assetReferences,
  })
}

function job(id: string, robotId: string, name = id): RobotJobV4 {
  return { id, robotId, name, steps: [] }
}

function projectWithVisibilityGraph(revisionId = 'visibility-a'): WorkcellProjectV4 {
  const base = projectWithRobots({
    revisionId,
    robotIds: ['robot-free', 'robot-mounted'],
  })
  const sceneGroups: readonly SceneGroupV4[] = [
    { id: 'group-root', name: 'Root', parentGroupId: null, visible: true },
    { id: 'group-child', name: 'Child', parentGroupId: 'group-root', visible: true },
    { id: 'group-other', name: 'Other', parentGroupId: null, visible: true },
  ]
  const spatialEntities: readonly SpatialEntityV4[] = [
    {
      id: 'track-entity',
      name: 'Track Entity',
      geometry: { kind: 'box', dimensionsM: [1, 1, 1], color: '#808080' },
      parentFrameId: 'world',
      localPose: IDENTITY_POSE,
      visible: true,
      groupId: 'group-child',
      removable: true,
      transformOwner: 'manual',
      numericStatus: {
        value: 0,
        sourceOwnership: 'manual',
        overlay: { visible: true, frameId: null },
      },
      graspable: true,
      graspFrames: [{
        frameId: 'grasp-frame',
        name: 'Grasp Frame',
        localPose: IDENTITY_POSE,
      }],
      movingFrames: [{
        frameId: 'moving-frame',
        name: 'Moving Frame',
        parentFrameId: 'world',
        localPose: IDENTITY_POSE,
        sourceOwnership: 'manual',
      }],
    },
    {
      id: 'other-entity',
      name: 'Other Entity',
      geometry: { kind: 'box', dimensionsM: [1, 1, 1], color: '#808080' },
      parentFrameId: 'world',
      localPose: IDENTITY_POSE,
      visible: true,
      groupId: 'group-other',
      removable: true,
      transformOwner: 'manual',
      numericStatus: {
        value: 0,
        sourceOwnership: 'manual',
        overlay: { visible: true, frameId: null },
      },
      graspable: false,
      graspFrames: [],
      movingFrames: [],
    },
  ]
  const robots = base.robots.map((robot, index): RobotInstanceV4 => (
    index === 1
      ? {
          ...robot,
          baseParentFrameId: 'moving-frame',
          intentionalMountEntityId: 'track-entity',
        }
      : robot
  ))
  return validateWorkcellProjectV4({
    ...base,
    sceneGroups,
    spatialEntities,
    robots,
  })
}

function expectProjectError(operation: () => void, code: string): void {
  try {
    operation()
    throw new Error(`Expected ${code}.`)
  } catch (error) {
    expect(error).toBeInstanceOf(ProjectV4Error)
    expect((error as ProjectV4Error).code).toBe(code)
  }
}

describe('interaction store V4 publication', () => {
  it('selects the first Robot and each Robot first Job deterministically', () => {
    const project = projectWithRobots({
      revisionId: 'one',
      robotIds: ['robot-b', 'robot-a'],
      jobs: [
        job('job-b-2', 'robot-b'),
        job('job-a-1', 'robot-a'),
        job('job-b-1', 'robot-b'),
      ],
    })
    const store = createInteractionStoreV4()

    store.getState().replaceProject(project)

    expect(store.getState().projectRevisionId).toBe('one')
    expect(store.getState().selection).toEqual({ kind: 'robot', robotId: 'robot-b' })
    expect([...store.getState().selectedJobIdsByRobotId]).toEqual([
      ['robot-b', 'job-b-2'],
      ['robot-a', 'job-a-1'],
    ])
  })

  it('accepts a valid zero-Robot Project without inventing selection state', () => {
    const store = createInteractionStoreV4()
    store.getState().replaceProject(projectWithRobots({ revisionId: 'zero', robotIds: [] }))

    expect(store.getState().selection).toBeNull()
    expect(store.getState().selectedJobIdsByRobotId.size).toBe(0)
  })

  it('supports the maximum eight Robots without an implicit active identity', () => {
    const robotIds = Array.from({ length: 8 }, (_, index) => `robot-${index + 1}`)
    const jobs = robotIds.flatMap((robotId, index) => [
      job(`job-${index + 1}-first`, robotId),
      job(`job-${index + 1}-second`, robotId),
    ])
    const store = createInteractionStoreV4()
    store.getState().replaceProject(projectWithRobots({ revisionId: 'eight', robotIds, jobs }))

    expect(store.getState().selection).toEqual({ kind: 'robot', robotId: 'robot-1' })
    expect([...store.getState().selectedJobIdsByRobotId]).toEqual(robotIds.map(
      (robotId, index) => [robotId, `job-${index + 1}-first`],
    ))
  })

  it('publishes runtime-readonly Job selection maps', () => {
    const store = createInteractionStoreV4()
    store.getState().replaceProject(projectWithRobots({
      revisionId: 'readonly',
      jobs: [job('job-a', 'robot-a')],
    }))

    const selections = store.getState().selectedJobIdsByRobotId
    expect('set' in selections).toBe(false)
    expect('delete' in selections).toBe(false)
    expect('clear' in selections).toBe(false)
    expect(() => (selections as Map<string, string | null>).set('robot-a', null)).toThrow()
    expect(store.getState().selectedJobIdsByRobotId.get('robot-a')).toBe('job-a')
  })

  it('preserves valid selection and per-Robot Job choices across unrelated revisions', () => {
    const first = projectWithRobots({
      revisionId: 'preserve-a',
      robotIds: ['robot-a', 'robot-b'],
      jobs: [job('job-a-1', 'robot-a'), job('job-a-2', 'robot-a'), job('job-b', 'robot-b')],
    })
    const second = projectWithRobots({
      revisionId: 'preserve-b',
      robotIds: ['robot-a', 'robot-b'],
      jobs: [job('job-b', 'robot-b'), job('job-a-2', 'robot-a', 'Edited'), job('job-a-1', 'robot-a')],
    })
    const store = createInteractionStoreV4()
    store.getState().replaceProject(first)
    store.getState().select({ kind: 'robot-frame', robotId: 'robot-b', frameId: 'TCP' })
    store.getState().selectJob('robot-a', 'job-a-2')
    store.getState().selectJob('robot-b', null)
    store.getState().isolate({ kind: 'robot', robotId: 'robot-a' })
    store.getState().copyTransform(IDENTITY_POSE)

    store.getState().replaceProject(second)

    expect(store.getState().selection).toEqual({
      kind: 'robot-frame',
      robotId: 'robot-b',
      frameId: 'TCP',
    })
    expect(store.getState().selectedJobIdsByRobotId.get('robot-a')).toBe('job-a-2')
    expect(store.getState().selectedJobIdsByRobotId.get('robot-b')).toBeNull()
    expect(store.getState().isolation).toBeNull()
    expect(store.getState().transformClipboard).toBeNull()
  })

  it('falls back only stale identities and initializes only newly introduced Robots', () => {
    const first = projectWithRobots({
      revisionId: 'fallback-a',
      robotIds: ['robot-old', 'robot-stay'],
      jobs: [
        job('old-job', 'robot-old'),
        job('stay-first', 'robot-stay'),
        job('stay-selected', 'robot-stay'),
      ],
    })
    const second = projectWithRobots({
      revisionId: 'fallback-b',
      robotIds: ['robot-stay', 'robot-new'],
      jobs: [job('stay-first', 'robot-stay'), job('new-first', 'robot-new')],
    })
    const store = createInteractionStoreV4()
    store.getState().replaceProject(first)
    store.getState().select({ kind: 'robot', robotId: 'robot-old' })
    store.getState().selectJob('robot-stay', 'stay-selected')

    store.getState().replaceProject(second)

    expect(store.getState().selection).toEqual({ kind: 'robot', robotId: 'robot-stay' })
    expect([...store.getState().selectedJobIdsByRobotId]).toEqual([
      ['robot-stay', 'stay-first'],
      ['robot-new', 'new-first'],
    ])
  })

  it('validates arbitrary and prototype-shaped Robot, local Frame, and Job IDs by ownership', () => {
    const base = projectWithRobots({
      revisionId: 'hostile',
      robotIds: ['__proto__', 'constructor'],
      jobs: [job('toString', '__proto__'), job('job|other', 'constructor')],
    })
    const definition = base.robotDefinitions[0]!
    const hostileDefinition = {
      ...definition,
      links: definition.links.map((link, index) => (
        index === 1 ? { ...link, id: 'link:| 한글' } : link
      )),
      joints: definition.joints.map((joint, index) => (
        index === 0 ? { ...joint, childLinkId: 'link:| 한글' } : joint
      )),
      frames: definition.frames.map((frame, index) => {
        if (index === 1) return { ...frame, parentFrameId: 'link:| 한글' }
        if (index === 2) return { ...frame, id: 'frame:| 한글' }
        return frame
      }),
    }
    const robots = base.robots.map((robot) => ({
      ...robot,
      selectedTcpFrameId: 'frame:| 한글',
    }))
    const project = validateWorkcellProjectV4({
      ...base,
      robotDefinitions: [hostileDefinition],
      robots,
    })
    const store = createInteractionStoreV4()
    store.getState().replaceProject(project)

    expect(() => store.getState().select({
      kind: 'robot-link',
      robotId: '__proto__',
      linkId: 'link:| 한글',
    })).not.toThrow()
    expect(() => store.getState().select({
      kind: 'robot-frame',
      robotId: 'constructor',
      frameId: 'frame:| 한글',
    })).not.toThrow()
    expect(() => store.getState().selectJob('__proto__', 'toString')).not.toThrow()
    expectProjectError(
      () => store.getState().selectJob('constructor', 'toString'),
      'ROBOT_JOB_SELECTION_INVALID',
    )
    expectProjectError(
      () => store.getState().select({ kind: 'robot', robotId: 'missing' }),
      'SCENE_SELECTION_TARGET_INVALID',
    )
    expectProjectError(
      () => store.getState().select({
        kind: 'robot-frame',
        robotId: '__proto__',
        frameId: 'missing',
      }),
      'SCENE_SELECTION_TARGET_INVALID',
    )
  })

  it('stores exact selection and isolation identities without forged mutable fields', () => {
    const store = createInteractionStoreV4()
    store.getState().replaceProject(projectWithRobots({ revisionId: 'exact-selection' }))
    const mutablePose = { positionM: [1, 2, 3] }
    const forged = {
      kind: 'robot' as const,
      robotId: 'robot-a',
      worldPose: mutablePose,
      nestedSelection: { kind: 'robot', robotId: 'robot-b' },
    }

    store.getState().select(forged)
    store.getState().isolate(forged)
    mutablePose.positionM[0] = 999

    expect(store.getState().selection).toEqual({ kind: 'robot', robotId: 'robot-a' })
    expect(store.getState().isolation).toEqual({ kind: 'robot', robotId: 'robot-a' })
    expect(store.getState().selection).not.toHaveProperty('worldPose')
    expect(store.getState().isolation).not.toHaveProperty('nestedSelection')
  })

  it('rejects invalid Project replacement without changing visible state or identity indexes', () => {
    const project = projectWithRobots({
      revisionId: 'atomic-a',
      jobs: [job('job-a', 'robot-a')],
    })
    const store = createInteractionStoreV4()
    store.getState().replaceProject(project)
    store.getState().selectJob('robot-a', null)
    const before = store.getState()
    const invalid: WorkcellProjectV4 = {
      ...project,
      revisionId: 'invalid-b',
      robots: project.robots.map((robot, index) => (
        index === 0 ? { ...robot, definitionId: 'missing-definition' } : robot
      )),
    }

    expect(() => store.getState().replaceProject(invalid)).toThrow('ROBOT_DEFINITION_NOT_FOUND')

    expect(store.getState()).toBe(before)
    expect(() => store.getState().select({ kind: 'robot', robotId: 'robot-a' })).not.toThrow()
    expectProjectError(
      () => store.getState().select({ kind: 'robot', robotId: 'robot-b' }),
      'SCENE_SELECTION_TARGET_INVALID',
    )
  })
})

describe('interaction store V4 visibility semantics', () => {
  function preparedStore() {
    const store = createInteractionStoreV4()
    store.getState().replaceProject(projectWithVisibilityGraph())
    return store
  }

  it('clears only the addressed Robot, Link, or Robot Frame selection', () => {
    const store = preparedStore()
    const target = { kind: 'robot', robotId: 'robot-free' } as const
    const cleared: readonly SceneSelectionTargetV4[] = [
      target,
      { kind: 'robot-link', robotId: 'robot-free', linkId: 'L0' },
      { kind: 'robot-frame', robotId: 'robot-free', frameId: 'TCP' },
    ]
    for (const selection of cleared) {
      store.getState().select(selection)
      store.getState().clearSelectionForHidden(target)
      expect(store.getState().selection).toBeNull()
    }

    store.getState().select({ kind: 'robot', robotId: 'robot-mounted' })
    store.getState().clearSelectionForHidden(target)
    expect(store.getState().selection).toEqual({ kind: 'robot', robotId: 'robot-mounted' })
  })

  it('clears a hidden Spatial Entity and its Grasp Frame but preserves its Moving Frame', () => {
    const store = preparedStore()
    const target = { kind: 'spatial-entity', entityId: 'track-entity' } as const

    for (const selection of [
      target,
      { kind: 'entity-frame', entityId: 'track-entity', frameId: 'grasp-frame' } as const,
    ]) {
      store.getState().select(selection)
      store.getState().clearSelectionForHidden(target)
      expect(store.getState().selection).toBeNull()
    }

    const moving = {
      kind: 'entity-frame',
      entityId: 'track-entity',
      frameId: 'moving-frame',
    } as const
    store.getState().select(moving)
    store.getState().clearSelectionForHidden(target)
    expect(store.getState().selection).toEqual(moving)
  })

  it('clears Group descendants and their Grasp Frames without hiding Moving Frames or mounted Robots', () => {
    const store = preparedStore()
    const target = { kind: 'scene-group', groupId: 'group-root' } as const
    const cleared: readonly SceneSelectionTargetV4[] = [
      target,
      { kind: 'scene-group', groupId: 'group-child' },
      { kind: 'spatial-entity', entityId: 'track-entity' },
      { kind: 'entity-frame', entityId: 'track-entity', frameId: 'grasp-frame' },
    ]
    for (const selection of cleared) {
      store.getState().select(selection)
      store.getState().clearSelectionForHidden(target)
      expect(store.getState().selection).toBeNull()
    }

    const preserved: readonly SceneSelectionTargetV4[] = [
      { kind: 'entity-frame', entityId: 'track-entity', frameId: 'moving-frame' },
      { kind: 'robot', robotId: 'robot-mounted' },
      { kind: 'spatial-entity', entityId: 'other-entity' },
    ]
    for (const selection of preserved) {
      store.getState().select(selection)
      store.getState().clearSelectionForHidden(target)
      expect(store.getState().selection).toEqual(selection)
    }
  })

  it('keeps isolate ephemeral and resets isolate and clipboard on every publication', () => {
    const first = projectWithVisibilityGraph('ephemeral-a')
    const second = projectWithVisibilityGraph('ephemeral-b')
    const store = createInteractionStoreV4()
    store.getState().replaceProject(first)
    const isolation = { kind: 'scene-group', groupId: 'group-root' } as const
    store.getState().isolate(isolation)
    const copied = {
      positionM: [1, 2, 3] as const,
      quaternion: [0, 0, 0, 2] as const,
    }
    store.getState().copyTransform(copied)

    expect(store.getState().isolation).toEqual(isolation)
    expect(store.getState().transformClipboard).toEqual({
      positionM: [1, 2, 3],
      quaternion: [0, 0, 0, 1],
    })
    expect(store.getState().transformClipboard).not.toBe(copied)

    store.getState().replaceProject(second)
    expect(store.getState().isolation).toBeNull()
    expect(store.getState().transformClipboard).toBeNull()
  })

  it('validates isolate and addressed hidden targets against the current Project', () => {
    const store = preparedStore()
    const missing = { kind: 'scene-group', groupId: 'missing' } as const
    expectProjectError(
      () => store.getState().isolate(missing),
      'SCENE_SELECTION_TARGET_INVALID',
    )
    expectProjectError(
      () => store.getState().clearSelectionForHidden(missing),
      'SCENE_SELECTION_TARGET_INVALID',
    )
  })
})

describe('interaction store V4 checkpoint ownership', () => {
  it('restores visible state and closure identity indexes atomically', () => {
    const projectA = projectWithRobots({
      revisionId: 'checkpoint-a',
      robotIds: ['robot-a'],
      jobs: [job('job-a', 'robot-a')],
    })
    const projectB = projectWithRobots({
      revisionId: 'checkpoint-b',
      robotIds: ['robot-b'],
      jobs: [job('job-b', 'robot-b')],
    })
    const store = createInteractionStoreV4()
    store.getState().replaceProject(projectA)
    store.getState().selectJob('robot-a', null)
    const checkpoint = store.getState().captureCheckpoint()
    store.getState().replaceProject(projectB)
    store.getState().selectJob('robot-b', null)

    store.getState().restoreCheckpoint(checkpoint)

    expect(store.getState().projectRevisionId).toBe('checkpoint-a')
    expect(store.getState().selectedJobIdsByRobotId.get('robot-a')).toBeNull()
    expect(() => store.getState().select({ kind: 'robot', robotId: 'robot-a' })).not.toThrow()
    expect(() => store.getState().selectJob('robot-a', 'job-a')).not.toThrow()
    expectProjectError(
      () => store.getState().select({ kind: 'robot', robotId: 'robot-b' }),
      'SCENE_SELECTION_TARGET_INVALID',
    )
    expectProjectError(
      () => store.getState().selectJob('robot-b', 'job-b'),
      'ROBOT_JOB_SELECTION_INVALID',
    )
  })

  it('rejects forged, null, and foreign checkpoints', () => {
    const project = projectWithRobots({ revisionId: 'checkpoint-owner' })
    const first = createInteractionStoreV4()
    const second = createInteractionStoreV4()
    first.getState().replaceProject(project)
    second.getState().replaceProject(project)
    const foreign = second.getState().captureCheckpoint()

    for (const checkpoint of [
      { kind: 'interaction-checkpoint-v4' },
      foreign,
      null,
    ]) {
      expectProjectError(
        () => first.getState().restoreCheckpoint(checkpoint as InteractionCheckpointV4),
        'INTERACTION_CHECKPOINT_INVALID',
      )
    }
  })

  it('preserves explicit show-all, clear-selection, and null Job choices', () => {
    const first = projectWithVisibilityGraph('explicit-a')
    const second = projectWithVisibilityGraph('explicit-b')
    const store = createInteractionStoreV4()
    store.getState().replaceProject(first)
    store.getState().clearSelection()
    store.getState().showAll()
    store.getState().clearTransformClipboard()

    store.getState().replaceProject(second)

    expect(store.getState().selection).toBeNull()
    expect(store.getState().isolation).toBeNull()
    expect(store.getState().transformClipboard).toBeNull()
  })
})

// Compile-time guard: the hide API intentionally accepts only persisted visibility targets.
const _persistedVisibilityTarget: PersistedVisibilityTargetV4 = {
  kind: 'scene-group',
  groupId: 'group-root',
}
void _persistedVisibilityTarget
