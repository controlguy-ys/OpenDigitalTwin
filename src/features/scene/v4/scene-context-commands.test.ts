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
    expect(resolveSceneContextTargetV4({ ...project, robots: [{ ...project.robots[0]!, definitionId: 'missing-definition' }] }, project.revisionId, { kind: 'robot-link', robotId: 'robot-1', linkId: 'L0' })).toMatchObject({ kind: 'stale' })
    expect(resolveSceneContextTargetV4({ ...project, robots: [{ ...project.robots[0]!, definitionId: 'missing-definition' }] }, project.revisionId, { kind: 'robot-frame', robotId: 'robot-1', frameId: 'TCP' })).toMatchObject({ kind: 'stale' })
    const secondDefinition = { ...project.robotDefinitions[0]!, id: 'definition-2', links: [{ ...project.robotDefinitions[0]!.links[0]!, id: 'other-link' }], frames: [{ ...project.robotDefinitions[0]!.frames[0]!, id: 'other-frame' }] }
    const twoDefinitions = { ...project, robotDefinitions: [...project.robotDefinitions, secondDefinition] }
    expect(resolveSceneContextTargetV4(twoDefinitions, twoDefinitions.revisionId, { kind: 'robot-link', robotId: 'robot-1', linkId: 'other-link' })).toMatchObject({ kind: 'stale' })
    expect(resolveSceneContextTargetV4(twoDefinitions, twoDefinitions.revisionId, { kind: 'robot-frame', robotId: 'robot-1', frameId: 'other-frame' })).toMatchObject({ kind: 'stale' })
    expect(resolveSceneContextTargetV4(project, project.revisionId, { kind: 'spatial-entity', entityId: 'removed-object' })).toMatchObject({ kind: 'stale' })
    expect(resolveSceneContextTargetV4(project, project.revisionId, { kind: 'scene-group', groupId: 'removed-group' })).toMatchObject({ kind: 'stale' })
    expect(resolveSceneContextTargetV4(project, project.revisionId, { kind: 'scene-frame', frameId: 'removed-frame' })).toMatchObject({ kind: 'stale' })
    expect(resolveSceneContextTargetV4(project, project.revisionId, { kind: 'entity-frame', entityId: 'entity-b', frameId: 'moving-a' })).toMatchObject({ kind: 'stale' })
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

  it.each([
    [null, ['model.add.group', 'model.add.box', 'model.add.cylinder', 'view.fitAll', 'scene.showAll']],
    [{ kind: 'robot', robotId: 'robot-1' }, ['view.focusSelection', 'scene.pose.copy', 'scene.pose.paste', 'scene.pose.reset', 'scene.visibility.toggle', 'scene.isolate', 'robot.base.edit', 'view.collision.open']],
    [{ kind: 'robot-link', robotId: 'robot-1', linkId: 'L0' }, ['view.focusSelection', 'scene.visibility.toggle', 'scene.isolate', 'view.collision.open']],
    [{ kind: 'spatial-entity', entityId: 'entity-b' }, ['view.focusSelection', 'scene.rename', 'scene.pose.copy', 'scene.pose.paste', 'scene.pose.reset', 'scene.group.move', 'scene.visibility.toggle', 'scene.isolate', 'view.collision.open']],
    [{ kind: 'scene-group', groupId: 'group-a' }, ['view.focusSelection', 'scene.rename', 'scene.group.move', 'scene.group.remove', 'scene.visibility.toggle', 'scene.isolate', 'scene.delete']],
    [{ kind: 'scene-frame', frameId: 'world' }, ['view.focusSelection', 'scene.rename']],
    [{ kind: 'scene-frame', frameId: 'fixture' }, ['view.focusSelection', 'scene.rename', 'scene.pose.edit']],
    [{ kind: 'robot-frame', robotId: 'robot-1', frameId: 'TCP' }, ['view.focusSelection', 'scene.pose.edit']],
    [{ kind: 'entity-frame', entityId: 'entity-a', frameId: 'moving-a' }, ['view.focusSelection', 'scene.parent.edit']],
    [{ kind: 'entity-frame', entityId: 'entity-a', frameId: 'grasp-a' }, ['view.focusSelection']],
  ] as const)('returns exact context IDs for %j', (selection, expected) => {
    const project = projectWithTargets()
    expect(sceneContextCommandIdsV4(project, project.revisionId, selection)).toEqual(expected)
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
    await commandById(commands, 'model.add.cylinder').execute()
    await commandById(commands, 'model.add.group').execute()
    expect(scene.createCylinder).toHaveBeenCalledWith(expect.objectContaining({
      name: 'Cylinder', parentFrameId: 'mcp', radiusM: 0.05, heightM: 0.1, color: '#38BDF8', groupId: 'group-a',
    }))
    expect(scene.createGroup).toHaveBeenCalledWith('Group', 'group-a')
    interaction.getState().select({ kind: 'entity-frame', entityId: 'entity-a', frameId: 'moving-a' })
    await commandById(commands, 'scene.parent.edit').execute()
    expect(openInspector).toHaveBeenCalledWith({
      selection: { kind: 'entity-frame', entityId: 'entity-a', frameId: 'moving-a' }, section: 'parent',
    })
  })

  it('disables all model creation on a stale selection and rechecks before each service call', async () => {
    const project = projectWithTargets()
    const interaction = createInteractionStoreV4()
    interaction.getState().replaceProject(project)
    interaction.getState().select({ kind: 'scene-group', groupId: 'group-a' })
    const scene = sceneService()
    const commands = composeSceneContextCommandsV4({
      project, interaction, scene, prompt: { requestText: vi.fn(async () => 'unused') },
      presentation: { openRobotBase: vi.fn(), openInspector: vi.fn() },
    })
    for (const id of ['model.add.box', 'model.add.cylinder', 'model.add.group']) {
      expect(commandById(commands, id).enabled).toBe(true)
    }
    interaction.setState({ projectRevisionId: 'stale' })
    for (const id of ['model.add.box', 'model.add.cylinder', 'model.add.group']) {
      const entry = commandById(commands, id)
      expect(entry).toMatchObject({ enabled: false, disabledReason: 'Select a compatible Scene item.' })
      await expect(entry.execute()).rejects.toThrow('compatible Scene item')
    }
    expect(scene.createBox).not.toHaveBeenCalled()
    expect(scene.createCylinder).not.toHaveBeenCalled()
    expect(scene.createGroup).not.toHaveBeenCalled()
  })

  it('uses MCP then World placement fallback and exposes no-frame failure without writes', async () => {
    const project = projectWithTargets()
    const onlyWorld = { ...project, scene: { frames: project.scene.frames.filter((frame) => frame.role !== 'mcp') } }
    const interaction = createInteractionStoreV4()
    interaction.getState().replaceProject(project)
    const scene = sceneService()
    const commands = composeSceneContextCommandsV4({
      project: onlyWorld, interaction, scene, prompt: { requestText: vi.fn(async () => 'unused') },
      presentation: { openRobotBase: vi.fn(), openInspector: vi.fn() },
    })
    await commandById(commands, 'model.add.cylinder').execute()
    expect(scene.createCylinder).toHaveBeenCalledWith(expect.objectContaining({ parentFrameId: 'world' }))
    const noFrame = { ...onlyWorld, scene: { frames: [] } }
    const none = composeSceneContextCommandsV4({
      project: noFrame, interaction, scene: sceneService(), prompt: { requestText: vi.fn(async () => 'unused') },
      presentation: { openRobotBase: vi.fn(), openInspector: vi.fn() },
    })
    expect(commandById(none, 'model.add.box')).toMatchObject({ enabled: false, disabledReason: 'No MCP or World placement Frame is available.' })
    await expect(commandById(none, 'model.add.box').execute()).rejects.toThrow('No MCP or World placement Frame is available.')
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

  it('defines exactly the approved 19 Scene commands with canonical sections and kinds', () => {
    const project = projectWithTargets()
    const interaction = createInteractionStoreV4()
    interaction.getState().replaceProject(project)
    const commands = composeSceneContextCommandsV4({ project, interaction, scene: sceneService(), prompt: { requestText: vi.fn(async () => null) }, presentation: { openRobotBase: vi.fn(), openInspector: vi.fn() } })
    expect(commands).toHaveLength(19)
    expect(new Set(commands.map(({ id }) => id)).size).toBe(19)
    expect(commands.filter(({ kind }) => kind === 'toggle').map(({ id }) => id)).toEqual(['scene.visibility.toggle'])
    expect(commands.filter(({ section }) => section === 'home').map(({ id }) => id)).toEqual([
      'scene.rename', 'scene.pose.copy', 'scene.pose.paste', 'scene.pose.reset', 'scene.visibility.toggle', 'scene.isolate', 'scene.showAll', 'scene.delete', 'robot.jog.open',
    ])
    expect(commands.filter(({ section }) => section === 'model').map(({ id }) => id)).toEqual([
      'model.add.box', 'model.add.cylinder', 'model.add.group', 'scene.group.move', 'scene.group.remove', 'robot.base.edit', 'robot.mount.edit', 'scene.pose.edit', 'scene.parent.edit', 'scene.status.edit',
    ])
  })

  it('rejects a required blank prompt before rename service dispatch', async () => {
    const project = projectWithTargets()
    const interaction = createInteractionStoreV4()
    interaction.getState().replaceProject(project)
    interaction.getState().select({ kind: 'spatial-entity', entityId: 'entity-a' })
    const scene = sceneService()
    const commands = composeSceneContextCommandsV4({
      project, interaction, scene, prompt: { requestText: vi.fn(async () => { throw new Error('Name is required.') }) },
      presentation: { openRobotBase: vi.fn(), openInspector: vi.fn() },
    })
    await expect(commandById(commands, 'scene.rename').execute()).rejects.toThrow('Name is required.')
    expect(scene.rename).not.toHaveBeenCalled()
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

  it('clones copied poses and blocks non-manual Object pose writes before dispatch', async () => {
    const project = projectWithTargets()
    const interaction = createInteractionStoreV4()
    interaction.getState().replaceProject(project)
    interaction.getState().select({ kind: 'spatial-entity', entityId: 'entity-a' })
    const source = project.spatialEntities.find((entity) => entity.id === 'entity-a')!
    const copyCommands = composeSceneContextCommandsV4({ project, interaction, scene: sceneService(), prompt: { requestText: vi.fn(async () => 'unused') }, presentation: { openRobotBase: vi.fn(), openInspector: vi.fn() } })
    await commandById(copyCommands, 'scene.pose.copy').execute()
    ;(source.localPose.positionM as unknown as number[])[0] = 99
    expect(interaction.getState().transformClipboard?.positionM).toEqual([1, 0, 0])
    const ownedBySimulation = {
      ...project,
      spatialEntities: project.spatialEntities.map((entity) => entity.id === 'entity-a' ? { ...entity, transformOwner: 'simulation' as const } : entity),
    }
    const scene = sceneService()
    const commands = composeSceneContextCommandsV4({ project: ownedBySimulation, interaction, scene, prompt: { requestText: vi.fn(async () => 'unused') }, presentation: { openRobotBase: vi.fn(), openInspector: vi.fn() } })
    expect(commandById(commands, 'scene.pose.paste')).toMatchObject({ enabled: false, disabledReason: 'The selected Object Pose is not manually owned.' })
    expect(commandById(commands, 'scene.pose.reset')).toMatchObject({ enabled: false, disabledReason: 'The selected Object Pose is not manually owned.' })
    await expect(commandById(commands, 'scene.pose.paste').execute()).rejects.toThrow('compatible Scene item')
    await expect(commandById(commands, 'scene.pose.reset').execute()).rejects.toThrow('compatible Scene item')
    expect(scene.setSpatialEntityLocalPose).not.toHaveBeenCalled()
  })

  it('dispatches exact manual Object paste/reset and distinguishes ungroup from grouped Object removal', async () => {
    const project = projectWithTargets()
    const interaction = createInteractionStoreV4()
    interaction.getState().replaceProject(project)
    const scene = sceneService()
    interaction.getState().select({ kind: 'spatial-entity', entityId: 'entity-a' })
    interaction.getState().copyTransform({ positionM: [4, 5, 6], quaternion: [0, 0, 0, 1] })
    const commands = composeSceneContextCommandsV4({ project, interaction, scene, prompt: { requestText: vi.fn(async () => 'unused') }, presentation: { openRobotBase: vi.fn(), openInspector: vi.fn() } })
    await commandById(commands, 'scene.pose.paste').execute()
    await commandById(commands, 'scene.pose.reset').execute()
    await commandById(commands, 'scene.group.remove').execute()
    expect(scene.setSpatialEntityLocalPose).toHaveBeenNthCalledWith(1, 'entity-a', expect.objectContaining({ positionM: [4, 5, 6] }))
    expect(scene.setSpatialEntityLocalPose).toHaveBeenNthCalledWith(2, 'entity-a', expect.objectContaining({ positionM: [0, 0, 0] }))
    expect(scene.setSpatialEntityGroup).toHaveBeenCalledWith('entity-a', null)
    interaction.getState().select({ kind: 'scene-group', groupId: 'group-a' })
    expect(commandById(commands, 'scene.group.move')).toMatchObject({ label: 'Move Group', enabled: true })
    expect(commandById(commands, 'scene.group.remove')).toMatchObject({ label: 'Ungroup', enabled: true })
    expect(commandById(commands, 'scene.visibility.toggle')).toMatchObject({ label: 'Hide', checked: true })
    await commandById(commands, 'scene.group.move').execute()
    await commandById(commands, 'scene.group.remove').execute()
    expect(scene.ungroup).toHaveBeenCalledWith('group-a')
    expect(scene.ungroup).toHaveBeenCalledWith('group-a')
  })

  it('preserves selection when a hide rejects and routes every inspector/base entry to its exact owner', async () => {
    const project = projectWithTargets()
    const interaction = createInteractionStoreV4()
    interaction.getState().replaceProject(project)
    const rejected = sceneService()
    vi.mocked(rejected.setPersistedVisibility).mockRejectedValueOnce(new Error('reject'))
    const openRobotBase = vi.fn()
    const openInspector = vi.fn()
    const commands = composeSceneContextCommandsV4({ project, interaction, scene: rejected, prompt: { requestText: vi.fn(async () => 'unused') }, presentation: { openRobotBase, openInspector } })
    interaction.getState().select({ kind: 'robot', robotId: 'robot-1' })
    await expect(commandById(commands, 'scene.visibility.toggle').execute()).rejects.toThrow('reject')
    expect(interaction.getState().selection).toEqual({ kind: 'robot', robotId: 'robot-1' })
    await commandById(commands, 'robot.base.edit').execute()
    await commandById(commands, 'robot.mount.edit').execute()
    await commandById(commands, 'robot.jog.open').execute()
    interaction.getState().select({ kind: 'spatial-entity', entityId: 'entity-a' })
    await commandById(commands, 'scene.pose.edit').execute()
    await commandById(commands, 'scene.status.edit').execute()
    expect(openRobotBase).toHaveBeenNthCalledWith(1, 'robot-1')
    expect(openRobotBase).toHaveBeenNthCalledWith(2, 'robot-1')
    expect(openInspector.mock.calls.map(([request]) => request)).toEqual(expect.arrayContaining([
      expect.objectContaining({ section: 'joints' }), expect.objectContaining({ section: 'pose' }), expect.objectContaining({ section: 'numericStatus' }),
    ]))
  })

  it('clears exactly the hidden selection only after successful persisted visibility write', async () => {
    const project = projectWithTargets()
    const interaction = createInteractionStoreV4()
    interaction.getState().replaceProject(project)
    interaction.getState().select({ kind: 'spatial-entity', entityId: 'entity-a' })
    const scene = sceneService()
    const commands = composeSceneContextCommandsV4({ project, interaction, scene, prompt: { requestText: vi.fn(async () => 'unused') }, presentation: { openRobotBase: vi.fn(), openInspector: vi.fn() } })
    await commandById(commands, 'scene.visibility.toggle').execute()
    expect(scene.setPersistedVisibility).toHaveBeenCalledWith({ kind: 'spatial-entity', entityId: 'entity-a' }, false)
    expect(interaction.getState().selection).toBeNull()
  })

  it('routes Isolate and Show All directly through live Interaction state and deletes the exact removable Object', async () => {
    const project = projectWithTargets()
    const interaction = createInteractionStoreV4()
    interaction.getState().replaceProject(project)
    interaction.getState().select({ kind: 'spatial-entity', entityId: 'entity-a' })
    const scene = sceneService()
    const commands = composeSceneContextCommandsV4({ project, interaction, scene, prompt: { requestText: vi.fn(async () => 'unused') }, presentation: { openRobotBase: vi.fn(), openInspector: vi.fn() } })
    await commandById(commands, 'scene.isolate').execute()
    expect(interaction.getState().isolation).toEqual({ kind: 'spatial-entity', entityId: 'entity-a' })
    expect(commandById(commands, 'scene.showAll')).toMatchObject({ enabled: true })
    await commandById(commands, 'scene.showAll').execute()
    expect(interaction.getState().isolation).toBeNull()
    await commandById(commands, 'scene.delete').execute()
    expect(scene.deleteSpatialEntity).toHaveBeenCalledWith('entity-a')
  })
})
