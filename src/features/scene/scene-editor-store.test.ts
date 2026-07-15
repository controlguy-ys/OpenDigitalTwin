import { describe, expect, it, vi } from 'vitest'
import type { ProjectMutationService } from '../project/project-mutation-service'
import { createSceneEditorStore } from './scene-editor-store'

const FIRST_POSE = {
  positionM: [1, 2, 3] as const,
  quaternion: [0, 0, 0, 1] as const,
}

describe('SceneEditorStore', () => {
  it('keeps selection and isolation session-only', () => {
    const published = { snapshot: { scene: { entities: [] } }, generation: 4 }
    const mutationService = {
      readPublished: vi.fn(() => published),
      subscribe: vi.fn(() => () => undefined),
    } as unknown as ProjectMutationService
    const store = createSceneEditorStore({
      mutationService,
      setWorldPose: vi.fn(async () => undefined),
    })

    store.getState().select('object:cup-1')
    store.getState().isolate('group:fixture')

    expect(store.getState()).toMatchObject({
      selectedEntityId: 'object:cup-1',
      isolatedEntityId: 'group:fixture',
    })
    expect(JSON.stringify(published.snapshot)).not.toContain('isolatedEntityId')
  })

  it('applies a draft once, cancels without publication, and drops a stale draft on generation change', async () => {
    let generation = 7
    let sceneEntityIds = ['object:cup-1']
    let notify: () => void = () => undefined
    const mutationService = {
      readPublished: vi.fn(() => ({
        generation,
        snapshot: {
          scene: {
            entities: sceneEntityIds.map((id) => ({ id })),
          },
        },
      })),
      subscribe: vi.fn((listener: () => void) => {
        notify = listener
        return () => undefined
      }),
    } as unknown as ProjectMutationService
    const setWorldPose = vi.fn(async () => undefined)
    const store = createSceneEditorStore({ mutationService, setWorldPose })

    store.getState().beginDraft('object:cup-1', FIRST_POSE)
    await store.getState().applyDraft()
    expect(setWorldPose).toHaveBeenCalledOnce()
    expect(setWorldPose).toHaveBeenCalledWith('object:cup-1', FIRST_POSE)
    expect(store.getState().draftPose).toBeNull()

    store.getState().beginDraft('object:cup-1', FIRST_POSE)
    store.getState().cancelDraft()
    expect(setWorldPose).toHaveBeenCalledOnce()

    store.getState().beginDraft('object:cup-1', FIRST_POSE)
    store.getState().isolate('object:cup-1')
    generation = 8
    notify()
    expect(store.getState().draftPose).toBeNull()
    expect(store.getState().isolatedEntityId).toBe('object:cup-1')

    sceneEntityIds = []
    generation = 9
    notify()
    expect(store.getState().isolatedEntityId).toBeNull()
  })
})
