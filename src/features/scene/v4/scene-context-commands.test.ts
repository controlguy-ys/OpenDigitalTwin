import { describe, expect, it, vi } from 'vitest'

import { makeMinimalWorkcellProjectV4 } from '../../../core/project-v4/test-support.js'
import type { WorkcellProjectV4 } from '../../../core/project-v4/index.js'
import type { AppCommandV4 } from '../../commands/v4/app-command.js'
import { createInteractionStoreV4 } from '../../interaction/v4/interaction-store.js'
import type { SceneCommandServiceV4 } from './scene-command-service.js'
import {
  composeSceneContextCommandsV4,
  resolveSceneContextTargetV4,
  sceneContextCommandIdsV4,
} from './scene-context-commands.js'

function projectWithTargets(): WorkcellProjectV4 {
  const project = makeMinimalWorkcellProjectV4()
  return {
    ...project,
    scene: {
      frames: [...project.scene.frames, {
        id: 'fixture', name: 'Fixture', parentFrameId: 'world',
        localPose: { positionM: [0, 0, 0], quaternion: [0, 0, 0, 1] }, role: 'custom',
      }],
    },
    spatialEntities: [
      {
        id: 'entity-a', name: 'Entity A', geometry: { kind: 'box', dimensionsM: [1, 1, 1], color: '#123456' },
        parentFrameId: 'world', localPose: { positionM: [1, 0, 0], quaternion: [0, 0, 0, 1] },
        visible: true, groupId: 'group-a', removable: true, transformOwner: 'manual',
        numericStatus: { value: 0, sourceOwnership: 'manual', overlay: { visible: true, frameId: null } },
        graspable: true,
        graspFrames: [{ frameId: 'grasp-a', name: 'Grasp', localPose: { positionM: [0, 0, 0], quaternion: [0, 0, 0, 1] } }],
        movingFrames: [{ frameId: 'moving-a', name: 'Moving', parentFrameId: 'world', localPose: { positionM: [0, 0, 0], quaternion: [0, 0, 0, 1] }, sourceOwnership: 'manual' }],
      },
      {
        id: 'entity-b', name: 'Entity B', geometry: { kind: 'box', dimensionsM: [1, 1, 1], color: '#654321' },
        parentFrameId: 'world', localPose: { positionM: [2, 0, 0], quaternion: [0, 0, 0, 1] },
        visible: true, groupId: null, removable: false, transformOwner: 'manual',
        numericStatus: { value: 0, sourceOwnership: 'manual', overlay: { visible: true, frameId: null } },
        graspable: false, graspFrames: [], movingFrames: [],
      },
    ],
    sceneGroups: [{ id: 'group-a', name: 'Group A', parentGroupId: null, visible: true }],
  }
}

function sceneService(): SceneCommandServiceV4 {
  return {
    createBox: vi.fn(async () => 'new-box'), createCylinder: vi.fn(async () => 'new-cylinder'),
    createGroup: vi.fn(async () => 'new-group'), rename: vi.fn(async () => undefined),
    setPersistedVisibility: vi.fn(async () => undefined),
    setSpatialEntityLocalPose: vi.fn(async () => undefined),
    setSpatialEntityGroup: vi.fn(async () => undefined),
    setRobotBase: vi.fn(async () => undefined), setSelectedToolFrames: vi.fn(async () => undefined),
    setSceneFrameLocalPose: vi.fn(async () => undefined), setMovingFrame: vi.fn(async () => undefined),
    setNumericStatus: vi.fn(async () => undefined), setStatusOverlayVisible: vi.fn(async () => undefined),
    reparentGroup: vi.fn(async () => undefined), ungroup: vi.fn(async () => undefined),
    deleteSpatialEntity: vi.fn(async () => undefined), deleteGroupAndContents: vi.fn(async () => undefined),
  }
}

function commandById(commands: readonly AppCommandV4[], id: string): AppCommandV4 {
  const command = commands.find((candidate) => candidate.id === id)
  if (command === undefined) throw new Error(`Missing command ${id}`)
  return command
}

describe('scene context commands', () => {
  it('resolves exact owners and rejects stale revisions and missing members', () => {
    const project = projectWithTargets()
    expect(resolveSceneContextTargetV4(project, project.revisionId, null)).toMatchObject({ kind: 'empty' })
    expect(resolveSceneContextTargetV4(project, project.revisionId, { kind: 'robot-link', robotId: 'robot-1', linkId: 'L0' })).toMatchObject({ kind: 'robot-link', robot: { id: 'robot-1' } })
    expect(resolveSceneContextTargetV4(project, project.revisionId, { kind: 'robot-frame', robotId: 'robot-1', frameId: 'TCP' })).toMatchObject({ kind: 'robot-frame', robot: { id: 'robot-1' } })
    expect(resolveSceneContextTargetV4(project, project.revisionId, { kind: 'entity-frame', entityId: 'entity-a', frameId: 'moving-a' })).toMatchObject({ kind: 'entity-frame', frameKind: 'moving', movingOwnership: 'manual' })
    expect(resolveSceneContextTargetV4(project, null, { kind: 'robot', robotId: 'robot-1' })).toMatchObject({ kind: 'stale' })
    expect(resolveSceneContextTargetV4(project, project.revisionId, { kind: 'robot-link', robotId: 'robot-1', linkId: 'missing' })).toMatchObject({ kind: 'stale' })
  })

  it('returns the approved ordered context IDs without mutable array leakage', () => {
    const project = projectWithTargets()
    const ids = sceneContextCommandIdsV4(project, project.revisionId, { kind: 'spatial-entity', entityId: 'entity-a' })
    expect(ids).toEqual([
      'view.focusSelection', 'scene.rename', 'scene.pose.copy', 'scene.pose.paste', 'scene.pose.reset',
      'scene.group.move', 'scene.group.remove', 'scene.visibility.toggle', 'scene.isolate', 'scene.delete', 'view.collision.open',
    ])
    expect(() => (ids as string[]).push('bad')).toThrow()
    expect(sceneContextCommandIdsV4(project, project.revisionId, { kind: 'entity-frame', entityId: 'entity-a', frameId: 'grasp-a' })).toEqual(['view.focusSelection'])
    expect(sceneContextCommandIdsV4(project, 'other', { kind: 'robot', robotId: 'robot-1' })).toEqual([])
  })

  it('resolves a live retargeted object and never falls back after staleness', async () => {
    const project = projectWithTargets()
    const interaction = createInteractionStoreV4()
    interaction.getState().replaceProject(project)
    interaction.getState().select({ kind: 'spatial-entity', entityId: 'entity-a' })
    const scene = sceneService()
    const prompt = { requestText: vi.fn(async () => '  Retargeted  ') }
    const commands = composeSceneContextCommandsV4({
      project, interaction, scene, prompt,
      presentation: { openRobotBase: vi.fn(), openInspector: vi.fn() },
    })

    interaction.getState().select({ kind: 'spatial-entity', entityId: 'entity-b' })
    await commandById(commands, 'scene.rename').execute()
    expect(scene.rename).toHaveBeenCalledWith({ kind: 'spatial-entity', entityId: 'entity-b' }, 'Retargeted')

    interaction.setState({ projectRevisionId: 'stale' })
    await expect(commandById(commands, 'scene.rename').execute()).rejects.toThrow('compatible Scene item')
    expect(scene.rename).toHaveBeenCalledTimes(1)
  })

  it('uses one canonical primitive path and contextual presentation actions', async () => {
    const project = projectWithTargets()
    const interaction = createInteractionStoreV4()
    interaction.getState().replaceProject(project)
    interaction.getState().select({ kind: 'scene-group', groupId: 'group-a' })
    const scene = sceneService()
    const openInspector = vi.fn()
    const commands = composeSceneContextCommandsV4({
      project, interaction, scene, prompt: { requestText: vi.fn(async () => null) },
      presentation: { openRobotBase: vi.fn(), openInspector },
    })
    await commandById(commands, 'model.add.box').execute()
    expect(scene.createBox).toHaveBeenCalledWith(expect.objectContaining({
      name: 'Box', parentFrameId: 'mcp', dimensionsM: [0.1, 0.1, 0.1], color: '#38BDF8', groupId: 'group-a',
    }))
    interaction.getState().select({ kind: 'entity-frame', entityId: 'entity-a', frameId: 'moving-a' })
    await commandById(commands, 'scene.parent.edit').execute()
    expect(openInspector).toHaveBeenCalledWith({
      selection: { kind: 'entity-frame', entityId: 'entity-a', frameId: 'moving-a' }, section: 'parent',
    })
  })

  it('returns cancellation without mutating and keeps unsupported editors absent', async () => {
    const project = projectWithTargets()
    const interaction = createInteractionStoreV4()
    interaction.getState().replaceProject(project)
    interaction.getState().select({ kind: 'spatial-entity', entityId: 'entity-a' })
    const scene = sceneService()
    const commands = composeSceneContextCommandsV4({
      project, interaction, scene, prompt: { requestText: vi.fn(async () => null) },
      presentation: { openRobotBase: vi.fn(), openInspector: vi.fn() },
    })
    await expect(commandById(commands, 'scene.rename').execute()).resolves.toBe('cancelled')
    expect(scene.rename).not.toHaveBeenCalled()
    interaction.getState().select({ kind: 'entity-frame', entityId: 'entity-a', frameId: 'grasp-a' })
    expect(commandById(commands, 'scene.parent.edit').visible).toBe(false)
    expect(commandById(commands, 'scene.pose.edit').visible).toBe(false)
  })

  it('uses exact live clipboard, persisted visibility, and group deletion targets', async () => {
    const project = projectWithTargets()
    const interaction = createInteractionStoreV4()
    interaction.getState().replaceProject(project)
    interaction.getState().select({ kind: 'robot', robotId: 'robot-1' })
    const scene = sceneService()
    const commands = composeSceneContextCommandsV4({
      project, interaction, scene, prompt: { requestText: vi.fn(async () => 'unused') },
      presentation: { openRobotBase: vi.fn(), openInspector: vi.fn() },
    })
    await commandById(commands, 'scene.pose.copy').execute()
    await commandById(commands, 'scene.pose.paste').execute()
    expect(scene.setRobotBase).toHaveBeenCalledWith(expect.objectContaining({ robotId: 'robot-1' }))
    await commandById(commands, 'scene.visibility.toggle').execute()
    expect(scene.setPersistedVisibility).toHaveBeenCalledWith({ kind: 'robot', robotId: 'robot-1' }, false)
    interaction.getState().select({ kind: 'scene-group', groupId: 'group-a' })
    await commandById(commands, 'scene.delete').execute()
    expect(scene.deleteGroupAndContents).toHaveBeenCalledWith('group-a')
  })
})
