import type {
  FrameIdV4,
  RevisionIdV4,
  RigidTransformV4,
  RobotIdV4,
  WorkcellProjectV4,
} from '../../../core/project-v4/index.js'
import type { AppCommandV4 } from '../../commands/v4/app-command.js'
import type { InteractionStoreStateV4 } from '../../interaction/v4/interaction-store.js'
import type {
  PersistedVisibilityTargetV4,
  SceneSelectionTargetV4,
} from '../../interaction/v4/scene-selection.js'
import type { UserPromptPortV4 } from '../../ui/v4/user-prompt-port.js'
import type { StoreApi } from 'zustand/vanilla'
import type { SceneCommandServiceV4 } from './scene-command-service.js'

export type SceneContextTargetV4 =
  | { readonly kind: 'empty'; readonly selection: null }
  | { readonly kind: 'stale'; readonly selection: SceneSelectionTargetV4 }
  | { readonly kind: 'robot'; readonly selection: Extract<SceneSelectionTargetV4, { kind: 'robot' }>; readonly robot: WorkcellProjectV4['robots'][number] }
  | { readonly kind: 'robot-link'; readonly selection: Extract<SceneSelectionTargetV4, { kind: 'robot-link' }>; readonly robot: WorkcellProjectV4['robots'][number] }
  | { readonly kind: 'spatial-entity'; readonly selection: Extract<SceneSelectionTargetV4, { kind: 'spatial-entity' }>; readonly entity: WorkcellProjectV4['spatialEntities'][number] }
  | { readonly kind: 'scene-group'; readonly selection: Extract<SceneSelectionTargetV4, { kind: 'scene-group' }>; readonly group: WorkcellProjectV4['sceneGroups'][number] }
  | { readonly kind: 'scene-frame'; readonly selection: Extract<SceneSelectionTargetV4, { kind: 'scene-frame' }>; readonly frame: WorkcellProjectV4['scene']['frames'][number] }
  | { readonly kind: 'robot-frame'; readonly selection: Extract<SceneSelectionTargetV4, { kind: 'robot-frame' }>; readonly robot: WorkcellProjectV4['robots'][number] }
  | { readonly kind: 'entity-frame'; readonly selection: Extract<SceneSelectionTargetV4, { kind: 'entity-frame' }>; readonly entity: WorkcellProjectV4['spatialEntities'][number]; readonly frameKind: 'grasp' | 'moving'; readonly movingOwnership: string | null }

export interface SceneCommandPresentationPortV4 {
  openRobotBase(robotId: RobotIdV4): void
  openInspector(request: {
    readonly selection: SceneSelectionTargetV4
    readonly section: 'joints' | 'pose' | 'parent' | 'group' | 'numericStatus'
  }): void
}

export interface ComposeSceneContextCommandsOptionsV4 {
  readonly project: WorkcellProjectV4
  readonly interaction: StoreApi<InteractionStoreStateV4>
  readonly scene: SceneCommandServiceV4
  readonly prompt: UserPromptPortV4
  readonly presentation: SceneCommandPresentationPortV4
}

const IDENTITY_POSE_V4: RigidTransformV4 = Object.freeze({
  positionM: Object.freeze([0, 0, 0]) as RigidTransformV4['positionM'],
  quaternion: Object.freeze([0, 0, 0, 1]) as RigidTransformV4['quaternion'],
})

const SCENE_CONTEXT_COMMAND_IDS_V4 = Object.freeze([
  'model.add.box', 'model.add.cylinder', 'model.add.group', 'scene.rename',
  'scene.pose.copy', 'scene.pose.paste', 'scene.pose.reset', 'scene.visibility.toggle',
  'scene.isolate', 'scene.showAll', 'scene.delete', 'scene.group.move',
  'scene.group.remove', 'robot.base.edit', 'robot.mount.edit', 'robot.jog.open',
  'scene.pose.edit', 'scene.parent.edit', 'scene.status.edit',
] as const)

function stale(selection: SceneSelectionTargetV4): SceneContextTargetV4 {
  return { kind: 'stale', selection }
}

export function resolveSceneContextTargetV4(
  project: WorkcellProjectV4,
  projectRevisionId: RevisionIdV4 | null,
  selection: SceneSelectionTargetV4 | null,
): SceneContextTargetV4 {
  if (selection === null) return { kind: 'empty', selection: null }
  if (projectRevisionId !== project.revisionId) return stale(selection)
  switch (selection.kind) {
    case 'robot': {
      const robot = project.robots.find(({ id }) => id === selection.robotId)
      return robot === undefined ? stale(selection) : { kind: 'robot', selection, robot }
    }
    case 'robot-link': {
      const robot = project.robots.find(({ id }) => id === selection.robotId)
      const definition = robot === undefined ? undefined : project.robotDefinitions.find(({ id }) => id === robot.definitionId)
      return robot === undefined || definition === undefined || !definition.links.some(({ id }) => id === selection.linkId)
        ? stale(selection) : { kind: 'robot-link', selection, robot }
    }
    case 'spatial-entity': {
      const entity = project.spatialEntities.find(({ id }) => id === selection.entityId)
      return entity === undefined ? stale(selection) : { kind: 'spatial-entity', selection, entity }
    }
    case 'scene-group': {
      const group = project.sceneGroups.find(({ id }) => id === selection.groupId)
      return group === undefined ? stale(selection) : { kind: 'scene-group', selection, group }
    }
    case 'scene-frame': {
      const frame = project.scene.frames.find(({ id }) => id === selection.frameId)
      return frame === undefined ? stale(selection) : { kind: 'scene-frame', selection, frame }
    }
    case 'robot-frame': {
      const robot = project.robots.find(({ id }) => id === selection.robotId)
      const definition = robot === undefined ? undefined : project.robotDefinitions.find(({ id }) => id === robot.definitionId)
      return robot === undefined || definition === undefined || !definition.frames.some(({ id }) => id === selection.frameId)
        ? stale(selection) : { kind: 'robot-frame', selection, robot }
    }
    case 'entity-frame': {
      const entity = project.spatialEntities.find(({ id }) => id === selection.entityId)
      const grasp = entity?.graspFrames.find(({ frameId }) => frameId === selection.frameId)
      if (entity !== undefined && grasp !== undefined) return {
        kind: 'entity-frame', selection, entity, frameKind: 'grasp', movingOwnership: null,
      }
      const moving = entity?.movingFrames.find(({ frameId }) => frameId === selection.frameId)
      return entity === undefined || moving === undefined ? stale(selection) : {
        kind: 'entity-frame', selection, entity, frameKind: 'moving', movingOwnership: moving.sourceOwnership,
      }
    }
  }
}

function freezeIds(ids: readonly string[]): readonly string[] {
  return Object.freeze([...ids])
}

export function sceneContextCommandIdsV4(
  project: WorkcellProjectV4,
  projectRevisionId: RevisionIdV4 | null,
  selection: SceneSelectionTargetV4 | null,
): readonly string[] {
  const target = resolveSceneContextTargetV4(project, projectRevisionId, selection)
  if (target.kind === 'stale') return freezeIds([])
  if (target.kind === 'empty') return freezeIds([
    'model.add.group', 'model.add.box', 'model.add.cylinder', 'view.fitAll', 'scene.showAll',
  ])
  if (target.kind === 'robot') return freezeIds([
    'view.focusSelection', 'scene.pose.copy', 'scene.pose.paste', 'scene.pose.reset',
    'scene.visibility.toggle', 'scene.isolate', 'robot.base.edit', 'view.collision.open',
  ])
  if (target.kind === 'robot-link') return freezeIds([
    'view.focusSelection', 'scene.visibility.toggle', 'scene.isolate', 'view.collision.open',
  ])
  if (target.kind === 'spatial-entity') return freezeIds([
    'view.focusSelection', 'scene.rename', 'scene.pose.copy', 'scene.pose.paste', 'scene.pose.reset',
    'scene.group.move', ...(target.entity.groupId === null ? [] : ['scene.group.remove']),
    'scene.visibility.toggle', 'scene.isolate', ...(target.entity.removable ? ['scene.delete'] : []),
    'view.collision.open',
  ])
  if (target.kind === 'scene-group') return freezeIds([
    'view.focusSelection', 'scene.rename', 'scene.group.move', 'scene.group.remove',
    'scene.visibility.toggle', 'scene.isolate', 'scene.delete',
  ])
  if (target.kind === 'scene-frame') return freezeIds([
    'view.focusSelection', 'scene.rename', ...(target.frame.role === 'world' ? [] : ['scene.pose.edit']),
  ])
  if (target.kind === 'robot-frame') return freezeIds(['view.focusSelection', 'scene.pose.edit'])
  return freezeIds(target.frameKind === 'moving' && target.movingOwnership === 'manual'
    ? ['view.focusSelection', 'scene.parent.edit']
    : ['view.focusSelection'])
}

function liveTarget(options: ComposeSceneContextCommandsOptionsV4): SceneContextTargetV4 {
  const state = options.interaction.getState()
  return resolveSceneContextTargetV4(options.project, state.projectRevisionId, state.selection)
}

function unavailable(): never {
  throw new Error('Select a compatible Scene item.')
}

function robotOwner(target: SceneContextTargetV4): WorkcellProjectV4['robots'][number] | null {
  return target.kind === 'robot' || target.kind === 'robot-link' || target.kind === 'robot-frame'
    ? target.robot : null
}

function visibilityTarget(target: SceneContextTargetV4): PersistedVisibilityTargetV4 | null {
  if (target.kind === 'robot' || target.kind === 'robot-link') return { kind: 'robot', robotId: target.robot.id }
  if (target.kind === 'spatial-entity') return { kind: 'spatial-entity', entityId: target.entity.id }
  if (target.kind === 'scene-group') return { kind: 'scene-group', groupId: target.group.id }
  return null
}

function persistedVisible(target: SceneContextTargetV4): boolean | null {
  if (target.kind === 'robot' || target.kind === 'robot-link') return target.robot.visible
  if (target.kind === 'spatial-entity') return target.entity.visible
  if (target.kind === 'scene-group') return target.group.visible
  return null
}

function renameTarget(target: SceneContextTargetV4) {
  if (target.kind === 'robot') return { kind: 'robot' as const, robotId: target.robot.id, name: target.robot.name }
  if (target.kind === 'spatial-entity') return { kind: 'spatial-entity' as const, entityId: target.entity.id, name: target.entity.name }
  if (target.kind === 'scene-group') return { kind: 'scene-group' as const, groupId: target.group.id, name: target.group.name }
  if (target.kind === 'scene-frame') return { kind: 'scene-frame' as const, frameId: target.frame.id, name: target.frame.name }
  return null
}

function placementFrame(project: WorkcellProjectV4): FrameIdV4 | null {
  return project.scene.frames.find((frame) => frame.role === 'mcp')?.id
    ?? project.scene.frames.find((frame) => frame.role === 'world')?.id
    ?? null
}

function canCreateModelV4(target: SceneContextTargetV4): boolean {
  return target.kind !== 'stale'
}

function creationDisabledReasonV4(
  target: SceneContextTargetV4,
  requiresPlacementFrame: boolean,
  project: WorkcellProjectV4,
): string | undefined {
  if (!canCreateModelV4(target)) return 'Select a compatible Scene item.'
  return requiresPlacementFrame && placementFrame(project) === null
    ? 'No MCP or World placement Frame is available.'
    : undefined
}

function definition(
  id: typeof SCENE_CONTEXT_COMMAND_IDS_V4[number],
  label: string,
  section: AppCommandV4['section'],
  options: object,
): AppCommandV4 {
  return Object.defineProperties({ id, label, section }, Object.getOwnPropertyDescriptors(options)) as AppCommandV4
}

function withCompatibility(
  command: AppCommandV4,
  options: ComposeSceneContextCommandsOptionsV4,
  predicate: (target: SceneContextTargetV4) => boolean,
): AppCommandV4 {
  return Object.defineProperties(command, {
    enabled: { enumerable: true, get: () => predicate(liveTarget(options)) },
    disabledReason: {
      enumerable: true,
      get: () => predicate(liveTarget(options)) ? undefined : 'Select a compatible Scene item.',
    },
  }) as AppCommandV4
}

export function composeSceneContextCommandsV4(
  options: ComposeSceneContextCommandsOptionsV4,
): readonly AppCommandV4[] {
  const commands: AppCommandV4[] = [
    definition('model.add.box', 'Add Box', 'model', {
      kind: 'action', visible: true,
      get enabled() { return creationDisabledReasonV4(liveTarget(options), true, options.project) === undefined },
      get disabledReason() { return creationDisabledReasonV4(liveTarget(options), true, options.project) },
      async execute() {
        if (!canCreateModelV4(liveTarget(options))) unavailable()
        const parentFrameId = placementFrame(options.project)
        if (parentFrameId === null) throw new Error('No MCP or World placement Frame is available.')
        const target = liveTarget(options)
        await options.scene.createBox({ name: 'Box', parentFrameId, localPose: IDENTITY_POSE_V4, dimensionsM: [0.1, 0.1, 0.1], color: '#38BDF8', groupId: target.kind === 'scene-group' ? target.group.id : null })
      },
    }),
    definition('model.add.cylinder', 'Add Cylinder', 'model', {
      kind: 'action', visible: true,
      get enabled() { return creationDisabledReasonV4(liveTarget(options), true, options.project) === undefined },
      get disabledReason() { return creationDisabledReasonV4(liveTarget(options), true, options.project) },
      async execute() {
        if (!canCreateModelV4(liveTarget(options))) unavailable()
        const parentFrameId = placementFrame(options.project)
        if (parentFrameId === null) throw new Error('No MCP or World placement Frame is available.')
        const target = liveTarget(options)
        await options.scene.createCylinder({ name: 'Cylinder', parentFrameId, localPose: IDENTITY_POSE_V4, radiusM: 0.05, heightM: 0.1, color: '#38BDF8', groupId: target.kind === 'scene-group' ? target.group.id : null })
      },
    }),
    definition('model.add.group', 'Add Group', 'model', {
      kind: 'action', visible: true,
      get enabled() { return creationDisabledReasonV4(liveTarget(options), false, options.project) === undefined },
      get disabledReason() { return creationDisabledReasonV4(liveTarget(options), false, options.project) },
      async execute() { const target = liveTarget(options); if (!canCreateModelV4(target)) unavailable(); await options.scene.createGroup('Group', target.kind === 'scene-group' ? target.group.id : null) },
    }),
    withCompatibility(definition('scene.rename', 'Rename', 'home', {
      kind: 'action', visible: true, enabled: false,
      async execute() {
        const target = renameTarget(liveTarget(options))
        if (target === null) unavailable()
        const response = await options.prompt.requestText({ title: 'Name', initialValue: target.name, required: true })
        if (response === null) return 'cancelled'
        const name = response.trim()
        const { name: _currentName, ...rename } = target
        await options.scene.rename(rename, name)
      },
    }), options, (target) => renameTarget(target) !== null),
    withCompatibility(definition('scene.pose.copy', 'Copy Pose', 'home', {
      kind: 'action', visible: true, enabled: false,
      execute() {
        const target = liveTarget(options)
        if (target.kind === 'robot') options.interaction.getState().copyTransform(target.robot.localBasePose)
        else if (target.kind === 'spatial-entity') options.interaction.getState().copyTransform(target.entity.localPose)
        else unavailable()
      },
    }), options, (target) => target.kind === 'robot' || target.kind === 'spatial-entity'),
    definition('scene.pose.paste', 'Paste Pose', 'home', {
      kind: 'action', visible: true,
      get enabled() {
        const target = liveTarget(options); const clipboard = options.interaction.getState().transformClipboard
        return clipboard !== null && (target.kind === 'robot' || (target.kind === 'spatial-entity' && target.entity.transformOwner === 'manual'))
      },
      get disabledReason() {
        const target = liveTarget(options)
        if (target.kind !== 'robot' && target.kind !== 'spatial-entity') return 'Select a compatible Scene item.'
        if (options.interaction.getState().transformClipboard === null) return 'Copy a Pose first.'
        return target.kind === 'spatial-entity' && target.entity.transformOwner !== 'manual' ? 'The selected Object Pose is not manually owned.' : undefined
      },
      async execute() {
        const target = liveTarget(options); const clipboard = options.interaction.getState().transformClipboard
        if (clipboard === null) throw new Error('Copy a Pose first.')
        if (target.kind === 'robot') await options.scene.setRobotBase({ robotId: target.robot.id, baseParentFrameId: target.robot.baseParentFrameId, localBasePose: clipboard, intentionalMountEntityId: target.robot.intentionalMountEntityId })
        else if (target.kind === 'spatial-entity' && target.entity.transformOwner === 'manual') await options.scene.setSpatialEntityLocalPose(target.entity.id, clipboard)
        else unavailable()
      },
    }),
    definition('scene.pose.reset', 'Reset Pose', 'home', {
      kind: 'action', visible: true,
      get enabled() { const target = liveTarget(options); return target.kind === 'robot' || (target.kind === 'spatial-entity' && target.entity.transformOwner === 'manual') },
      get disabledReason() { const target = liveTarget(options); if (target.kind === 'robot' || (target.kind === 'spatial-entity' && target.entity.transformOwner === 'manual')) return undefined; return target.kind === 'spatial-entity' ? 'The selected Object Pose is not manually owned.' : 'Select a compatible Scene item.' },
      async execute() {
        const target = liveTarget(options)
        if (target.kind === 'robot') await options.scene.setRobotBase({ robotId: target.robot.id, baseParentFrameId: target.robot.baseParentFrameId, localBasePose: IDENTITY_POSE_V4, intentionalMountEntityId: target.robot.intentionalMountEntityId })
        else if (target.kind === 'spatial-entity' && target.entity.transformOwner === 'manual') await options.scene.setSpatialEntityLocalPose(target.entity.id, IDENTITY_POSE_V4)
        else unavailable()
      },
    }),
    definition('scene.visibility.toggle', 'Hide', 'home', {
      kind: 'toggle', visible: true,
      get enabled() { return visibilityTarget(liveTarget(options)) !== null },
      get disabledReason() { return visibilityTarget(liveTarget(options)) === null ? 'Select a compatible Scene item.' : undefined },
      get checked() { return persistedVisible(liveTarget(options)) ?? false },
      get label() { const target = liveTarget(options); const visible = persistedVisible(target); return target.kind === 'robot-link' ? (visible ? 'Hide Robot' : 'Show Robot') : visible ? 'Hide' : 'Show' },
      async execute() {
        const target = liveTarget(options); const persisted = visibilityTarget(target); const visible = persistedVisible(target)
        if (persisted === null || visible === null) unavailable()
        await options.scene.setPersistedVisibility(persisted, !visible)
        if (visible) options.interaction.getState().clearSelectionForHidden(persisted)
      },
    }),
    withCompatibility(definition('scene.isolate', 'Isolate', 'home', {
      kind: 'action', visible: true, enabled: false,
      execute() { const target = visibilityTarget(liveTarget(options)); if (target === null) unavailable(); options.interaction.getState().isolate(target) },
    }), options, (target) => visibilityTarget(target) !== null),
    definition('scene.showAll', 'Show All', 'home', {
      kind: 'action', visible: true,
      get enabled() { return options.interaction.getState().isolation !== null },
      get disabledReason() { return options.interaction.getState().isolation === null ? 'Select a compatible Scene item.' : undefined },
      execute() { options.interaction.getState().showAll() },
    }),
    definition('scene.delete', 'Delete', 'home', {
      kind: 'action', visible: true, destructive: true,
      get enabled() { const target = liveTarget(options); return target.kind === 'scene-group' || (target.kind === 'spatial-entity' && target.entity.removable) },
      get disabledReason() { const target = liveTarget(options); return target.kind === 'scene-group' || (target.kind === 'spatial-entity' && target.entity.removable) ? undefined : 'Select a compatible Scene item.' },
      get label() { return liveTarget(options).kind === 'scene-group' ? 'Delete Group and Contents' : 'Delete' },
      async execute() { const target = liveTarget(options); if (target.kind === 'scene-group') await options.scene.deleteGroupAndContents(target.group.id); else if (target.kind === 'spatial-entity' && target.entity.removable) await options.scene.deleteSpatialEntity(target.entity.id); else unavailable() },
    }),
    withCompatibility(definition('scene.group.move', 'Move to Group', 'model', {
      kind: 'action', visible: true, enabled: false,
      get label() { return liveTarget(options).kind === 'scene-group' ? 'Move Group' : 'Move to Group' },
      execute() { const target = liveTarget(options); if (target.kind !== 'spatial-entity' && target.kind !== 'scene-group') unavailable(); options.presentation.openInspector({ selection: target.selection, section: 'group' }) },
    }), options, (target) => target.kind === 'spatial-entity' || target.kind === 'scene-group'),
    definition('scene.group.remove', 'Remove from Group', 'model', {
      kind: 'action', visible: true,
      get enabled() { const target = liveTarget(options); return target.kind === 'scene-group' || (target.kind === 'spatial-entity' && target.entity.groupId !== null) },
      get disabledReason() { const target = liveTarget(options); return target.kind === 'scene-group' || (target.kind === 'spatial-entity' && target.entity.groupId !== null) ? undefined : 'Select a compatible Scene item.' },
      get label() { return liveTarget(options).kind === 'scene-group' ? 'Ungroup' : 'Remove from Group' },
      async execute() { const target = liveTarget(options); if (target.kind === 'scene-group') await options.scene.ungroup(target.group.id); else if (target.kind === 'spatial-entity' && target.entity.groupId !== null) await options.scene.setSpatialEntityGroup(target.entity.id, null); else unavailable() },
    }),
    withCompatibility(definition('robot.base.edit', 'Edit Robot Base', 'model', {
      kind: 'action', visible: true, enabled: false,
      execute() { const robot = robotOwner(liveTarget(options)); if (robot === null) unavailable(); options.presentation.openRobotBase(robot.id) },
    }), options, (target) => robotOwner(target) !== null),
    withCompatibility(definition('robot.mount.edit', 'Edit Robot Mount', 'model', {
      kind: 'action', visible: true, enabled: false,
      execute() { const robot = robotOwner(liveTarget(options)); if (robot === null) unavailable(); options.presentation.openRobotBase(robot.id) },
    }), options, (target) => robotOwner(target) !== null),
    definition('robot.jog.open', 'Joint Jog', 'home', {
      kind: 'action',
      get visible() { const target = liveTarget(options); return target.kind === 'robot' || target.kind === 'robot-link' || target.kind === 'robot-frame' },
      get enabled() { const target = liveTarget(options); return target.kind === 'robot' || target.kind === 'robot-link' || target.kind === 'robot-frame' },
      get disabledReason() { const target = liveTarget(options); return target.kind === 'robot' || target.kind === 'robot-link' || target.kind === 'robot-frame' ? undefined : 'Select a compatible Scene item.' },
      execute() { const target = liveTarget(options); if (target.kind !== 'robot' && target.kind !== 'robot-link' && target.kind !== 'robot-frame') unavailable(); options.presentation.openInspector({ selection: target.selection, section: 'joints' }) },
    }),
    definition('scene.pose.edit', 'XYZRPY', 'model', {
      kind: 'action',
      get visible() { const target = liveTarget(options); return (target.kind === 'spatial-entity' && target.entity.transformOwner === 'manual') || (target.kind === 'scene-frame' && target.frame.role !== 'world') || target.kind === 'robot-frame' },
      get enabled() { const target = liveTarget(options); return (target.kind === 'spatial-entity' && target.entity.transformOwner === 'manual') || (target.kind === 'scene-frame' && target.frame.role !== 'world') || target.kind === 'robot-frame' },
      get disabledReason() { const target = liveTarget(options); return (target.kind === 'spatial-entity' && target.entity.transformOwner === 'manual') || (target.kind === 'scene-frame' && target.frame.role !== 'world') || target.kind === 'robot-frame' ? undefined : 'Select a compatible Scene item.' },
      get label() { const target = liveTarget(options); return target.kind === 'scene-frame' ? 'Edit Frame' : target.kind === 'robot-frame' ? 'Coordinate Details' : 'XYZRPY' },
      execute() { const target = liveTarget(options); if (!((target.kind === 'spatial-entity' && target.entity.transformOwner === 'manual') || (target.kind === 'scene-frame' && target.frame.role !== 'world') || target.kind === 'robot-frame')) unavailable(); options.presentation.openInspector({ selection: target.selection, section: 'pose' }) },
    }),
    definition('scene.parent.edit', 'Parent', 'model', {
      kind: 'action',
      get visible() { const target = liveTarget(options); return target.kind === 'entity-frame' && target.frameKind === 'moving' && target.movingOwnership === 'manual' },
      get enabled() { const target = liveTarget(options); return target.kind === 'entity-frame' && target.frameKind === 'moving' && target.movingOwnership === 'manual' },
      get disabledReason() { const target = liveTarget(options); return target.kind === 'entity-frame' && target.frameKind === 'moving' && target.movingOwnership === 'manual' ? undefined : 'Select a compatible Scene item.' },
      get label() { return liveTarget(options).kind === 'entity-frame' ? 'Edit Moving Frame' : 'Parent' },
      execute() { const target = liveTarget(options); if (target.kind !== 'entity-frame' || target.frameKind !== 'moving' || target.movingOwnership !== 'manual') unavailable(); options.presentation.openInspector({ selection: target.selection, section: 'parent' }) },
    }),
    definition('scene.status.edit', 'Numeric Status', 'model', {
      kind: 'action',
      get visible() { const target = liveTarget(options); return target.kind === 'spatial-entity' || target.kind === 'robot' },
      get enabled() { const target = liveTarget(options); return target.kind === 'spatial-entity' || target.kind === 'robot' },
      get disabledReason() { const target = liveTarget(options); return target.kind === 'spatial-entity' || target.kind === 'robot' ? undefined : 'Select a compatible Scene item.' },
      execute() { const target = liveTarget(options); if (target.kind !== 'spatial-entity' && target.kind !== 'robot') unavailable(); options.presentation.openInspector({ selection: target.selection, section: 'numericStatus' }) },
    }),
  ]
  if (new Set(commands.map(({ id }) => id)).size !== SCENE_CONTEXT_COMMAND_IDS_V4.length) throw new Error('Scene Context command IDs must be unique.')
  return Object.freeze(commands)
}
