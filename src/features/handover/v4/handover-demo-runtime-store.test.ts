import { describe, expect, it } from 'vitest'

import {
  composeRigidTransformV4,
  type RigidTransformV4,
} from '../../../core/project-v4/index.js'
import {
  createHackathonHandoverSampleV4,
  HACKATHON_HANDOVER_IDS_V4,
} from '../../project/v4/hackathon-handover-sample-v4.js'
import { createHandoverDemoRuntimeStoreV4 } from './handover-demo-runtime-store.js'

const TOOL_A: RigidTransformV4 = {
  positionM: [0.2, -0.1, 0.8],
  quaternion: [0, 0, 0, 1],
}
const TOOL_A_MOVED: RigidTransformV4 = {
  positionM: [0.35, 0.05, 0.9],
  quaternion: [0, 0, Math.SQRT1_2, Math.SQRT1_2],
}
const TOOL_B: RigidTransformV4 = {
  positionM: [0.35, 0.05, 0.9],
  quaternion: [0, 0, 1, 0],
}
const OBJECT_WORLD: RigidTransformV4 = {
  positionM: [0.21, -0.08, 0.77],
  quaternion: [0, 0, 0, 1],
}
const PLACED_WORLD: RigidTransformV4 = {
  positionM: [0.7, 0.2, 0.1],
  quaternion: [0, 0, 0, 1],
}

function runtime() {
  return createHandoverDemoRuntimeStoreV4(createHackathonHandoverSampleV4({
    projectId: 'project-handover-runtime-test',
    revisionId: 'revision-handover-runtime-test',
    nowIso: '2026-07-21T06:00:00.000Z',
  }))
}

describe('Handover demo runtime store V4', () => {
  it('begins from the authored Workpiece pose and resets to the exact initial state', () => {
    const store = runtime()
    const initialPose = store.getState().readWorldPose(
      HACKATHON_HANDOVER_IDS_V4.workpieceId,
    )

    expect(store.getState()).toMatchObject({
      runState: 'IDLE',
      step: 'READY',
      partOwner: 'TABLE',
      sharedZoneOwner: 'NONE',
      failureCode: null,
      injectGripConfirmTimeout: false,
      generation: 0,
    })
    expect(store.getState().readWorldPose('another-entity')).toBeNull()

    store.getState().setFaultInjection(true)
    const generation = store.getState().begin('run-1')
    store.getState().setStep(generation, 'MOVE_TO_SHARED_ZONE')
    store.getState().attach(generation, 'NED2-A', TOOL_A, OBJECT_WORLD)
    store.getState().reset()

    expect(store.getState()).toMatchObject({
      runState: 'IDLE',
      step: 'READY',
      partOwner: 'TABLE',
      sharedZoneOwner: 'NONE',
      failureCode: null,
      injectGripConfirmTimeout: false,
      generation: generation + 1,
    })
    expect(store.getState().readWorldPose(
      HACKATHON_HANDOVER_IDS_V4.workpieceId,
    )).toEqual(initialPose)
  })

  it('updates an attached Workpiece from the owning Tool pose', () => {
    const store = runtime()
    const generation = store.getState().begin('run-1')

    expect(store.getState().attach(
      generation,
      'NED2-A',
      TOOL_A,
      OBJECT_WORLD,
    )).toBe(true)
    const toolToObject = {
      positionM: [0.009999999999999981, 0.020000000000000004, -0.030000000000000027],
      quaternion: [0, 0, 0, 1],
    } satisfies RigidTransformV4

    expect(store.getState().updateAttachedPose(
      generation,
      'NED2-A',
      TOOL_A_MOVED,
    )).toBe(true)
    expect(store.getState().readWorldPose(
      HACKATHON_HANDOVER_IDS_V4.workpieceId,
    )).toEqual(composeRigidTransformV4(TOOL_A_MOVED, toolToObject))
    expect(store.getState().updateAttachedPose(
      generation,
      'NED2-B',
      TOOL_B,
    )).toBe(false)
  })

  it('changes attachment owner without moving the Workpiece in World space', () => {
    const store = runtime()
    const generation = store.getState().begin('run-1')
    store.getState().attach(generation, 'NED2-A', TOOL_A, OBJECT_WORLD)
    const before = store.getState().readWorldPose(HACKATHON_HANDOVER_IDS_V4.workpieceId)

    expect(store.getState().transfer(generation, 'NED2-B', TOOL_B)).toBe(true)

    expect(store.getState()).toMatchObject({
      partOwner: 'NED2-B',
      sharedZoneOwner: 'NED2-B',
    })
    expect(store.getState().readWorldPose(
      HACKATHON_HANDOVER_IDS_V4.workpieceId,
    )).toEqual(before)
  })

  it('places at the requested World pose and clears one-shot fault injection on completion', () => {
    const store = runtime()
    store.getState().setFaultInjection(true)
    const generation = store.getState().begin('run-1')
    store.getState().attach(generation, 'NED2-A', TOOL_A, OBJECT_WORLD)
    store.getState().transfer(generation, 'NED2-B', TOOL_B)

    expect(store.getState().place(generation, PLACED_WORLD)).toBe(true)
    expect(store.getState()).toMatchObject({
      partOwner: 'OUTPUT_TRAY',
      sharedZoneOwner: 'NONE',
    })
    expect(store.getState().readWorldPose(
      HACKATHON_HANDOVER_IDS_V4.workpieceId,
    )).toEqual(PLACED_WORLD)
    expect(store.getState().complete(generation)).toBe(true)
    expect(store.getState()).toMatchObject({
      runState: 'SUCCEEDED',
      step: 'COMPLETE',
      injectGripConfirmTimeout: false,
    })
  })

  it('records Grip Confirm Timeout without changing attachment ownership', () => {
    const store = runtime()
    const generation = store.getState().begin('run-1')
    store.getState().attach(generation, 'NED2-A', TOOL_A, OBJECT_WORLD)
    store.getState().setStep(generation, 'HANDOVER_CONFIRM')

    expect(store.getState().failGripConfirm(generation)).toBe(true)
    expect(store.getState()).toMatchObject({
      runState: 'FAULTED',
      step: 'HANDOVER_CONFIRM',
      partOwner: 'NED2-A',
      sharedZoneOwner: 'NED2-A',
      failureCode: 'GRIP_CONFIRM_TIMEOUT',
    })
  })

  it('ignores every transition from a reset generation', () => {
    const store = runtime()
    const stale = store.getState().begin('run-1')
    store.getState().reset()
    const before = store.getState()

    expect(store.getState().setStep(stale, 'PICK_GRIP')).toBe(false)
    expect(store.getState().attach(stale, 'NED2-A', TOOL_A, OBJECT_WORLD)).toBe(false)
    expect(store.getState().updateAttachedPose(stale, 'NED2-A', TOOL_A_MOVED)).toBe(false)
    expect(store.getState().transfer(stale, 'NED2-B', TOOL_B)).toBe(false)
    expect(store.getState().place(stale, PLACED_WORLD)).toBe(false)
    expect(store.getState().complete(stale)).toBe(false)
    expect(store.getState().failGripConfirm(stale)).toBe(false)
    expect(store.getState()).toBe(before)
  })
})
