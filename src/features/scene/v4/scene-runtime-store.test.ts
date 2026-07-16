import { describe, expect, it } from 'vitest'
import { ProjectV4Error } from '../../../core/project-v4/index.js'
import {
  createSceneRuntimeStoreV4,
  type SceneRuntimeCheckpointV4,
} from './scene-runtime-store.js'
import type { SceneRuntimeProjectionV4 } from './scene-runtime-selector.js'

function projection(revision: string): SceneRuntimeProjectionV4 {
  return Object.freeze({
    projectRevisionId: revision,
    globalFrames: new Map(),
    robotFramesByRobotId: new Map(),
    groups: new Map(),
    entities: new Map(),
    visibleRobotIds: Object.freeze([]),
    visibleSpatialEntityIds: Object.freeze([]),
  })
}

function expectCheckpointError(action: () => unknown): void {
  let error: unknown
  try {
    action()
  } catch (caught) {
    error = caught
  }
  expect(error).toBeInstanceOf(ProjectV4Error)
  expect((error as ProjectV4Error).code).toBe('SCENE_RUNTIME_CHECKPOINT_INVALID')
}

describe('SceneRuntimeStoreV4', () => {
  it('atomically replaces the complete projection with its exact Project revision', () => {
    const store = createSceneRuntimeStoreV4()
    const next = projection('revision-scene-2')
    const observations: Array<readonly [string | null, SceneRuntimeProjectionV4 | null]> = []
    const unsubscribe = store.subscribe((state) => {
      observations.push([state.projectRevisionId, state.projection])
    })

    store.getState().replaceProjection(next)
    unsubscribe()

    expect(observations).toEqual([['revision-scene-2', next]])
    expect(store.getState()).toMatchObject({
      projectRevisionId: 'revision-scene-2',
      projection: next,
    })
  })

  it('keeps action methods callable across complete replacements', () => {
    const store = createSceneRuntimeStoreV4()
    const methods = {
      replaceProjection: store.getState().replaceProjection,
      captureCheckpoint: store.getState().captureCheckpoint,
      restoreCheckpoint: store.getState().restoreCheckpoint,
    }

    store.getState().replaceProjection(projection('revision-a'))
    expect(store.getState()).toMatchObject(methods)
    store.getState().replaceProjection(projection('revision-b'))
    expect(store.getState()).toMatchObject(methods)
  })

  it('restores the exact checkpoint state and Revision in one publication', () => {
    const store = createSceneRuntimeStoreV4()
    const first = projection('revision-a')
    store.getState().replaceProjection(first)
    const capturedState = store.getState()
    const checkpoint = store.getState().captureCheckpoint()
    store.getState().replaceProjection(projection('revision-b'))
    let notifications = 0
    const unsubscribe = store.subscribe(() => { notifications += 1 })

    store.getState().restoreCheckpoint(checkpoint)
    unsubscribe()

    expect(notifications).toBe(1)
    expect(store.getState()).toBe(capturedState)
    expect(store.getState().projectRevisionId).toBe('revision-a')
    expect(store.getState().projection).toBe(first)
    expect(Object.isFrozen(checkpoint)).toBe(true)
  })

  it('rejects forged and foreign checkpoints without replacing or notifying', () => {
    const storeA = createSceneRuntimeStoreV4()
    const storeB = createSceneRuntimeStoreV4()
    storeA.getState().replaceProjection(projection('revision-a'))
    storeB.getState().replaceProjection(projection('revision-b'))
    const before = storeA.getState()
    const foreign = storeB.getState().captureCheckpoint()
    let notifications = 0
    const unsubscribe = storeA.subscribe(() => { notifications += 1 })

    expectCheckpointError(() => storeA.getState().restoreCheckpoint(
      { kind: 'scene-runtime-checkpoint-v4' },
    ))
    expectCheckpointError(() => storeA.getState().restoreCheckpoint(foreign))
    expectCheckpointError(() => storeA.getState().restoreCheckpoint(
      null as unknown as SceneRuntimeCheckpointV4,
    ))
    unsubscribe()

    expect(storeA.getState()).toBe(before)
    expect(notifications).toBe(0)
  })
})
