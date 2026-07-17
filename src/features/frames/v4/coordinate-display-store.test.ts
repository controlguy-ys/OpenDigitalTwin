import { describe, expect, it } from 'vitest'
import {
  ProjectV4Error,
  validateWorkcellProjectV4,
  type FrameDefinitionV4,
  type SpatialEntityV4,
  type WorkcellProjectV4,
} from '../../../core/project-v4/index.js'
import {
  makeMinimalWorkcellProjectV4,
  projectAtLimit,
} from '../../../core/project-v4/test-support.js'
import type {
  CoordinateFrameSelectionV4,
  SceneSelectionV4,
} from '../../interaction/v4/scene-selection.js'
import { createCoordinateDisplayStoreV4 } from './coordinate-display-store.js'

const IDENTITY = Object.freeze({
  positionM: [0, 0, 0] as const,
  quaternion: [0, 0, 0, 1] as const,
})

function frame(id: string, role: FrameDefinitionV4['role'] = 'custom'): FrameDefinitionV4 {
  return { id, name: id, parentFrameId: 'world', localPose: IDENTITY, role }
}

function entity(id: string, frameSuffix = id): SpatialEntityV4 {
  return {
    id,
    name: id,
    geometry: { kind: 'box', dimensionsM: [1, 1, 1], color: '#808080' },
    parentFrameId: 'world',
    localPose: IDENTITY,
    visible: true,
    groupId: null,
    removable: true,
    transformOwner: 'manual',
    numericStatus: {
      value: 0,
      sourceOwnership: 'manual',
      overlay: { visible: false, frameId: null },
    },
    graspable: true,
    graspFrames: [{
      frameId: `grasp-${frameSuffix}`,
      name: `Grasp ${frameSuffix}`,
      localPose: IDENTITY,
    }],
    movingFrames: [{
      frameId: `moving-${frameSuffix}`,
      name: `Moving ${frameSuffix}`,
      parentFrameId: 'mcp',
      localPose: IDENTITY,
      sourceOwnership: 'manual',
    }],
  }
}

function richProject(revisionId = 'revision-coordinate-a'): WorkcellProjectV4 {
  const source = projectAtLimit('robots', 2)
  const definition = source.robotDefinitions[0]!
  return validateWorkcellProjectV4({
    ...source,
    revisionId,
    scene: { frames: [...source.scene.frames, frame('fixture', 'mcp'), frame('__proto__')] },
    robotDefinitions: [{
      ...definition,
      frames: [...definition.frames, {
        id: 'Probe',
        name: 'Probe',
        parentFrameId: definition.links.at(-1)!.id,
        localPose: IDENTITY,
        role: 'custom',
      }],
    }],
    spatialEntities: [entity('entity-a', 'a')],
  })
}

function expectCode(action: () => unknown, code: string): void {
  let error: unknown
  try { action() } catch (caught) { error = caught }
  expect(error).toBeInstanceOf(ProjectV4Error)
  expect((error as ProjectV4Error).code).toBe(code)
}

describe('coordinate display store V4', () => {
  it('starts empty, then selects the sole World Frame for zero or many Robots', () => {
    const store = createCoordinateDisplayStoreV4()
    expect(store.getState()).toMatchObject({ projectRevisionId: null, poseFrame: null })

    const zeroRobot = validateWorkcellProjectV4({
      ...makeMinimalWorkcellProjectV4(),
      revisionId: 'revision-zero',
      robots: [],
      robotDefinitions: [],
      assetReferences: [],
    })
    store.getState().replaceProject(zeroRobot)
    expect(store.getState()).toMatchObject({
      projectRevisionId: 'revision-zero',
      poseFrame: { kind: 'scene-frame', frameId: 'world' },
    })

    store.getState().replaceProject(richProject())
    expect(store.getState().poseFrame).toEqual({ kind: 'scene-frame', frameId: 'world' })
  })

  it('preserves valid global, Robot-local, and Entity-local choices across revisions', () => {
    const store = createCoordinateDisplayStoreV4()
    const projectA = richProject()
    const projectB = richProject('revision-coordinate-b')
    store.getState().replaceProject(projectA)

    for (const poseFrame of [
      { kind: 'scene-frame', frameId: 'fixture' },
      { kind: 'robot-frame', robotId: 'robot-2', frameId: 'TCP' },
      { kind: 'entity-frame', entityId: 'entity-a', frameId: 'moving-a' },
    ] as const) {
      store.getState().selectPoseFrame(poseFrame)
      store.getState().replaceProject(projectB)
      expect(store.getState().poseFrame).toEqual(poseFrame)
    }
  })

  it('falls back only when a Frame disappears or changes structured ownership', () => {
    const store = createCoordinateDisplayStoreV4()
    const projectA = richProject()
    store.getState().replaceProject(projectA)
    store.getState().selectPoseFrame({ kind: 'robot-frame', robotId: 'robot-2', frameId: 'Probe' })

    const definition = projectA.robotDefinitions[0]!
    const projectB = validateWorkcellProjectV4({
      ...projectA,
      revisionId: 'revision-no-probe',
      robotDefinitions: [{
        ...definition,
        frames: definition.frames.filter(({ id }) => id !== 'Probe'),
      }],
    })
    store.getState().replaceProject(projectB)
    expect(store.getState().poseFrame).toEqual({ kind: 'scene-frame', frameId: 'world' })

    store.getState().replaceProject(projectA)
    store.getState().selectPoseFrame({ kind: 'entity-frame', entityId: 'entity-a', frameId: 'grasp-a' })
    const projectC = validateWorkcellProjectV4({
      ...projectA,
      revisionId: 'revision-owner-changed',
      spatialEntities: [entity('entity-b', 'a')],
    })
    store.getState().replaceProject(projectC)
    expect(store.getState().poseFrame).toEqual({ kind: 'scene-frame', frameId: 'world' })
  })

  it('validates exact structured ownership, including repeated TCP and prototype IDs', () => {
    const store = createCoordinateDisplayStoreV4()
    store.getState().replaceProject(richProject())

    store.getState().selectPoseFrame({ kind: 'scene-frame', frameId: '__proto__' })
    expect(store.getState().poseFrame).toEqual({ kind: 'scene-frame', frameId: '__proto__' })
    store.getState().selectPoseFrame({ kind: 'robot-frame', robotId: 'robot-1', frameId: 'TCP' })
    expect(store.getState().poseFrame).toEqual({
      kind: 'robot-frame', robotId: 'robot-1', frameId: 'TCP',
    })
    store.getState().selectPoseFrame({ kind: 'robot-frame', robotId: 'robot-2', frameId: 'TCP' })
    expect(store.getState().poseFrame).toEqual({
      kind: 'robot-frame', robotId: 'robot-2', frameId: 'TCP',
    })

    expectCode(
      () => store.getState().selectPoseFrame({
        kind: 'robot-frame', robotId: 'missing', frameId: 'TCP',
      }),
      'COORDINATE_FRAME_NOT_FOUND',
    )
    expectCode(
      () => store.getState().selectPoseFrame({
        kind: 'entity-frame', entityId: 'entity-a', frameId: 'fixture',
      }),
      'COORDINATE_FRAME_NOT_FOUND',
    )
  })

  it('stores only exact structured Frame identity and detaches forged transform fields', () => {
    const store = createCoordinateDisplayStoreV4()
    store.getState().replaceProject(richProject())
    const callerPose = { positionM: [1, 2, 3], quaternion: [0, 0, 0, 1] }
    const forged = {
      kind: 'scene-frame' as const,
      frameId: 'world',
      worldPose: callerPose,
      selection: { robotId: 'robot-1' },
    }

    store.getState().selectPoseFrame(forged)
    callerPose.positionM[0] = 999

    expect(store.getState().poseFrame).toEqual({
      kind: 'scene-frame',
      frameId: 'world',
    })
    expect(store.getState().poseFrame).not.toHaveProperty('worldPose')
    expect(store.getState().poseFrame).not.toHaveProperty('selection')
  })

  it('keeps global choices and scopes local choices to the owning Scene selection', () => {
    const store = createCoordinateDisplayStoreV4()
    const project = richProject()
    store.getState().replaceProject(project)

    const cases: readonly [CoordinateFrameSelectionV4, SceneSelectionV4, boolean][] = [
      [
        { kind: 'robot-frame', robotId: 'robot-1', frameId: 'TCP' },
        { kind: 'robot-link', robotId: 'robot-1', linkId: 'L0' },
        true,
      ],
      [
        { kind: 'robot-frame', robotId: 'robot-1', frameId: 'TCP' },
        { kind: 'robot', robotId: 'robot-2' },
        false,
      ],
      [
        { kind: 'entity-frame', entityId: 'entity-a', frameId: 'moving-a' },
        { kind: 'spatial-entity', entityId: 'entity-a' },
        true,
      ],
      [
        { kind: 'entity-frame', entityId: 'entity-a', frameId: 'grasp-a' },
        { kind: 'robot', robotId: 'robot-1' },
        false,
      ],
    ]

    for (const [poseFrame, selection, preserved] of cases) {
      store.getState().selectPoseFrame(poseFrame)
      store.getState().reconcileSelection(project, selection)
      expect(store.getState().poseFrame).toEqual(preserved
        ? poseFrame
        : { kind: 'scene-frame', frameId: 'world' })
    }

    store.getState().selectPoseFrame({ kind: 'scene-frame', frameId: 'fixture' })
    store.getState().reconcileSelection(project, null)
    expect(store.getState().poseFrame).toEqual({ kind: 'scene-frame', frameId: 'fixture' })
  })

  it('restores visible state and closure-owned indexes atomically from an opaque checkpoint', () => {
    const projectA = richProject()
    const projectB = validateWorkcellProjectV4({
      ...makeMinimalWorkcellProjectV4(),
      revisionId: 'revision-coordinate-only-b',
      scene: {
        frames: [...makeMinimalWorkcellProjectV4().scene.frames, frame('b-only')],
      },
    })
    const store = createCoordinateDisplayStoreV4()
    store.getState().replaceProject(projectA)
    store.getState().selectPoseFrame({ kind: 'scene-frame', frameId: '__proto__' })
    const checkpointA = store.getState().captureCheckpoint()

    store.getState().replaceProject(projectB)
    store.getState().selectPoseFrame({ kind: 'scene-frame', frameId: 'b-only' })
    store.getState().restoreCheckpoint(checkpointA)
    expect(store.getState()).toMatchObject({
      projectRevisionId: projectA.revisionId,
      poseFrame: { kind: 'scene-frame', frameId: '__proto__' },
    })
    store.getState().selectPoseFrame({ kind: 'robot-frame', robotId: 'robot-2', frameId: 'TCP' })
    expectCode(
      () => store.getState().selectPoseFrame({ kind: 'scene-frame', frameId: 'b-only' }),
      'COORDINATE_FRAME_NOT_FOUND',
    )

    expectCode(
      () => store.getState().restoreCheckpoint({
        kind: 'coordinate-display-checkpoint-v4',
      }),
      'COORDINATE_DISPLAY_CHECKPOINT_INVALID',
    )
    const foreign = createCoordinateDisplayStoreV4()
    expectCode(
      () => foreign.getState().restoreCheckpoint(checkpointA),
      'COORDINATE_DISPLAY_CHECKPOINT_INVALID',
    )
  })

  it('rejects reconcile calls from a Project other than the published revision', () => {
    const store = createCoordinateDisplayStoreV4()
    const project = richProject()
    store.getState().replaceProject(project)

    expectCode(
      () => store.getState().reconcileSelection(
        { ...project, revisionId: 'revision-stale' },
        { kind: 'robot', robotId: 'robot-1' },
      ),
      'COORDINATE_DISPLAY_PROJECT_REVISION_MISMATCH',
    )
  })
})
