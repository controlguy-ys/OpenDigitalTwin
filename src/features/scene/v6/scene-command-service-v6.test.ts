import { describe, expect, it, vi } from 'vitest'

import type { WorkcellProjectV5 } from '../../../core/project-v5/index.js'
import { cloneWorkcellProjectV5, makeMinimalWorkcellProjectV5 } from '../../../core/project-v5/test-support.js'
import type { ProjectV5MutationService } from '../../project/v5/project-v5-mutation-service.js'
import { createSceneCommandServiceV6 } from './scene-command-service-v6.js'

function project(): WorkcellProjectV5 {
  const base = makeMinimalWorkcellProjectV5()
  return {
    ...base,
    sceneGroups: [{ id: 'empty', name: 'Empty', parentGroupId: null, visible: true }, { id: 'non-empty', name: 'Non empty', parentGroupId: null, visible: true }],
    spatialEntities: [{
      id: 'box', name: 'Box', geometry: { kind: 'box', dimensionsM: [0.1, 0.1, 0.1], color: '#38bdf8' }, parentFrameId: 'mcp', localPose: { positionM: [0, 0, 0], quaternion: [0, 0, 0, 1] }, visible: true, groupId: 'non-empty', removable: true, transformOwner: 'manual', numericStatus: { value: 0, sourceOwnership: 'manual', overlay: { visible: false, frameId: null } }, graspable: true, graspFrames: [{ frameId: 'grasp', name: 'Grasp', localPose: { positionM: [0, 0, 0], quaternion: [0, 0, 0, 1] } }], movingFrames: [{ frameId: 'moving', name: 'Moving', parentFrameId: 'mcp', localPose: { positionM: [0, 0, 0], quaternion: [0, 0, 0, 1] }, sourceOwnership: 'manual' }],
    }],
    opcUa: {
      ...base.opcUa,
      mappings: [{
        ...base.opcUa.mappings[0]!, id: 'mapping-box', leaves: [{ ...base.opcUa.mappings[0]!.leaves[0]!, projectTarget: { type: 'entity-status', entityId: 'box' } }],
      }],
      bridgeRoutes: [{ id: 'route-box', sourceMappingId: 'mapping-box', destinationMappingId: 'mapping-box', direction: 'forward', scale: 1, offset: 0, unit: '' }],
    },
  }
}

function mutations(active: WorkcellProjectV5) {
  let current = cloneWorkcellProjectV5(active)
  const mutate = vi.fn(async (request: Parameters<ProjectV5MutationService['mutate']>[0]) => {
    current = request.recipe(current)
    return { project: current, revisionId: current.revisionId }
  })
  return {
    mutations: { readPublished: () => ({ project: current, revisionId: current.revisionId }), mutate } as unknown as ProjectV5MutationService,
    current: () => current,
    mutate,
  }
}

describe('createSceneCommandServiceV6', () => {
  it('creates and selects one visible root Group through one atomic current-revision mutation', async () => {
    const state = mutations(project())
    const setSelection = vi.fn()
    const service = createSceneCommandServiceV6({
      mutations: state.mutations,
      createId: vi.fn().mockReturnValue('new-group'),
      onSelectionChange: setSelection,
    })

    await expect(service.createGroup()).resolves.toBe('new-group')
    expect(state.mutate).toHaveBeenCalledOnce()
    expect(state.mutate).toHaveBeenCalledWith(expect.objectContaining({
      expectedRevisionId: 'revision-1',
      description: 'Create Group',
    }))
    expect(state.current().sceneGroups.at(-1)).toEqual({
      id: 'new-group', name: 'Group', parentGroupId: null, visible: true,
    })
    expect(setSelection).toHaveBeenCalledExactlyOnceWith({ kind: 'group', id: 'new-group' })
  })

  it('does not select a Group when its current-revision mutation rejects as stale', async () => {
    const state = mutations(project())
    const stale = new Error('PROJECT_ACTIVE_REVISION_CHANGED')
    state.mutate.mockRejectedValueOnce(stale)
    const setSelection = vi.fn()
    const service = createSceneCommandServiceV6({
      mutations: state.mutations,
      createId: vi.fn().mockReturnValue('stale-group'),
      onSelectionChange: setSelection,
    })

    await expect(service.createGroup()).rejects.toBe(stale)
    expect(state.mutate).toHaveBeenCalledOnce()
    expect(setSelection).not.toHaveBeenCalled()
  })

  it('uses one current-revision mutation for rename and visibility changes', async () => {
    const state = mutations(project())
    const service = createSceneCommandServiceV6({ mutations: state.mutations, createId: vi.fn() })
    await service.rename({ kind: 'entity', id: 'box' }, 'Renamed')
    await service.setVisibility({ kind: 'entity', id: 'box' }, false)
    expect(state.mutate).toHaveBeenCalledTimes(2)
    expect(state.mutate.mock.calls.map(([request]) => request.expectedRevisionId)).toEqual(['revision-1', 'revision-1'])
    expect(state.current().spatialEntities[0]).toMatchObject({ name: 'Renamed', visible: false })
  })

  it('deletes a removable Object with mapping leaves and invalid bridge routes atomically', async () => {
    const state = mutations(project())
    const service = createSceneCommandServiceV6({ mutations: state.mutations, createId: vi.fn() })
    await service.deleteEntity('box')
    expect(state.mutate).toHaveBeenCalledOnce()
    expect(state.current().spatialEntities).toEqual([])
    expect(state.current().opcUa.mappings).toEqual([])
    expect(state.current().opcUa.bridgeRoutes).toEqual([])
  })

  it('duplicates with fresh entity and child-frame IDs but no OPC UA mapping clone', async () => {
    const state = mutations(project())
    const createId = vi.fn().mockReturnValueOnce('copy').mockReturnValueOnce('copy-grasp').mockReturnValueOnce('copy-moving')
    const service = createSceneCommandServiceV6({ mutations: state.mutations, createId })
    await expect(service.duplicateEntity('box')).resolves.toBe('copy')
    expect(state.mutate).toHaveBeenCalledOnce()
    expect(state.current().spatialEntities[1]).toMatchObject({ id: 'copy', name: 'Box copy' })
    expect(state.current().spatialEntities[1]!.graspFrames[0]!.frameId).toBe('copy-grasp')
    expect(state.current().spatialEntities[1]!.movingFrames[0]!.frameId).toBe('copy-moving')
    expect(state.current().opcUa.mappings).toHaveLength(1)
  })

  it('rejects duplicate generated entity or frame IDs before mutation and selection changes', async () => {
    const state = mutations(project())
    const setSelection = vi.fn()
    const service = createSceneCommandServiceV6({
      mutations: state.mutations,
      createId: vi.fn().mockReturnValueOnce('copy').mockReturnValueOnce('copy').mockReturnValueOnce('copy-moving'),
      onSelectionChange: setSelection,
    })

    await expect(service.duplicateEntity('box')).rejects.toThrow('not fresh')
    expect(state.mutate).not.toHaveBeenCalled()
    expect(setSelection).not.toHaveBeenCalled()
  })

  it('rejects protected Object and non-empty Group deletion before mutation and preserves stale selection', async () => {
    const source = project()
    const locked = { ...source.spatialEntities[0]!, removable: false }
    const state = mutations({ ...source, spatialEntities: [locked] })
    const setSelection = vi.fn()
    const service = createSceneCommandServiceV6({ mutations: state.mutations, createId: vi.fn(), onSelectionChange: setSelection })
    await expect(service.deleteEntity('box')).rejects.toThrow('not removable')
    await expect(service.deleteGroup('non-empty')).rejects.toThrow('not empty')
    await expect(service.rename({ kind: 'entity', id: 'missing' }, 'Nope')).rejects.toThrow('does not exist')
    expect(state.mutate).not.toHaveBeenCalled()
    expect(setSelection).not.toHaveBeenCalled()
  })

  it('does not change selection when the current-revision publication rejects as stale', async () => {
    const source = project()
    const stale = new Error('PROJECT_ACTIVE_REVISION_CHANGED')
    const mutate = vi.fn(async () => { throw stale })
    const setSelection = vi.fn()
    const service = createSceneCommandServiceV6({
      mutations: { readPublished: () => ({ project: source, revisionId: source.revisionId }), mutate } as unknown as ProjectV5MutationService,
      createId: vi.fn().mockReturnValueOnce('copy').mockReturnValueOnce('copy-grasp').mockReturnValueOnce('copy-moving'),
      onSelectionChange: setSelection,
    })

    await expect(service.duplicateEntity('box')).rejects.toBe(stale)
    expect(mutate).toHaveBeenCalledOnce()
    expect(setSelection).not.toHaveBeenCalled()
  })
})
