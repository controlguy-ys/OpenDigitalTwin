import { describe, expect, it, vi } from 'vitest'
import type { SceneEntityV1 } from '../domain/project/scene-state-v1'
import { testSceneRuntime } from '../features/scene/scene-ui-test-fixtures'
import { deleteSceneEntitySafely } from './safe-scene-deletion'

describe('deleteSceneEntitySafely', () => {
  it('deletes the dedicated Workbench Environment and clears its Scene selection', async () => {
    const workbench: SceneEntityV1 = {
      kind: 'environment', id: 'workcell:workbench', name: 'Workbench', parentId: null,
      localPose: { positionM: [0, 0, 0], quaternion: [0, 0, 0, 1] }, visible: true,
    }
    const deleteEntity = vi.fn(async () => undefined)
    const clearSceneSelection = vi.fn()

    await deleteSceneEntitySafely('workcell:workbench', {
      beginRemoval: vi.fn(() => true),
      clearCollisionPairs: vi.fn(),
      clearInteractionSelection: vi.fn(),
      clearSceneSelection,
      deleteEntity,
      deleteGroupAndContents: vi.fn(async () => undefined),
      endRemoval: vi.fn(),
      getHeldEntityId: () => null,
      getSceneSelection: () => 'workcell:workbench',
      releaseHeldEntity: vi.fn(async () => undefined),
      runtime: testSceneRuntime([workbench]),
    })

    expect(deleteEntity).toHaveBeenCalledWith('workcell:workbench')
    expect(clearSceneSelection).toHaveBeenCalledOnce()
  })

  it('locks descendants, releases a held child before Group deletion, and clears both selections', async () => {
    const beginRemoval = vi.fn(() => true)
    const endRemoval = vi.fn()
    const releaseHeldEntity = vi.fn(async () => undefined)
    const deleteGroupAndContents = vi.fn(async () => undefined)
    const deleteEntity = vi.fn(async () => undefined)
    const clearInteractionSelection = vi.fn()
    const clearCollisionPairs = vi.fn()
    const clearSceneSelection = vi.fn()

    await deleteSceneEntitySafely('group:fixture', {
      beginRemoval,
      clearCollisionPairs,
      clearInteractionSelection,
      clearSceneSelection,
      deleteEntity,
      deleteGroupAndContents,
      endRemoval,
      getHeldEntityId: () => 'object:cup-1',
      getSceneSelection: () => 'object:cup-1',
      releaseHeldEntity,
      runtime: testSceneRuntime(),
    })

    expect(beginRemoval).toHaveBeenCalledWith('object:cup-1')
    expect(releaseHeldEntity).toHaveBeenCalledWith('object:cup-1')
    expect(deleteGroupAndContents).toHaveBeenCalledWith('group:fixture', true)
    expect(releaseHeldEntity.mock.invocationCallOrder[0]).toBeLessThan(
      deleteGroupAndContents.mock.invocationCallOrder[0]!,
    )
    expect(deleteEntity).not.toHaveBeenCalled()
    expect(clearInteractionSelection).toHaveBeenCalledWith('object:cup-1')
    expect(clearCollisionPairs).toHaveBeenCalledWith('object:cup-1')
    expect(clearSceneSelection).toHaveBeenCalledTimes(1)
    expect(endRemoval).toHaveBeenCalledWith('object:cup-1')
  })

  it('releases acquired locks when Project deletion rejects', async () => {
    const endRemoval = vi.fn()
    await expect(deleteSceneEntitySafely('object:cup-1', {
      beginRemoval: () => true,
      clearCollisionPairs: vi.fn(),
      clearInteractionSelection: vi.fn(),
      clearSceneSelection: vi.fn(),
      deleteEntity: vi.fn(async () => {
        throw new Error('publish failed')
      }),
      deleteGroupAndContents: vi.fn(async () => undefined),
      endRemoval,
      getHeldEntityId: () => null,
      getSceneSelection: () => null,
      releaseHeldEntity: vi.fn(async () => undefined),
      runtime: testSceneRuntime(),
    })).rejects.toThrow('publish failed')

    expect(endRemoval).toHaveBeenCalledWith('object:cup-1')
  })
})
