import { describe, expect, it, vi } from 'vitest'

import { makeMinimalWorkcellProjectV4 } from '../../core/project-v4/test-support.js'
import type { WorkcellProjectV4 } from '../../core/project-v4/index.js'
import { createInteractionStoreV4 } from '../../features/interaction/v4/interaction-store.js'
import { createShellLayoutControllerV4 } from '../../features/ui/v4/shell-layout-controller.js'
import { createShellLayoutStoreV4 } from '../../features/ui/v4/shell-layout-store.js'
import { initialShellLayoutBoundsV4 } from '../../features/ui/v4/shell-layout-geometry.js'
import { createViewportPreferenceStoreV4 } from '../../features/viewport/v4/viewport-preference-store.js'
import type { AppCommandCompositionContextV4 } from './app-command-composition.js'
import {
  APP_COMMAND_PLACEMENTS_BY_SECTION_V4,
  APP_CONTEXT_COMMAND_IDS_V4,
  APP_QUICK_ACTION_IDS_V4,
  composeAppCommandsV4,
} from './app-command-composition.js'

function projectWithJob(): WorkcellProjectV4 {
  const project = makeMinimalWorkcellProjectV4()
  return {
    ...project,
    robots: [...project.robots, { ...project.robots[0]!, id: 'robot-2', name: 'Robot 2' }],
    jobs: [
      { id: 'job-1', name: 'Job 1', robotId: 'robot-1', steps: [] },
      { id: 'job-2', name: 'Job 2', robotId: 'robot-2', steps: [] },
    ],
  }
}

function context(project = projectWithJob()): AppCommandCompositionContextV4 {
  const interaction = createInteractionStoreV4()
  interaction.getState().replaceProject(project)
  interaction.getState().activateRobot('robot-1')
  interaction.getState().selectJob('robot-1', 'job-1')
  const shellLayoutController = createShellLayoutControllerV4({
    preferencesStore: createShellLayoutStoreV4({ storage: null }),
    initialBounds: initialShellLayoutBoundsV4(1440, 800),
  })
  return {
    project,
    projectState: {
      activeProject: project, status: 'ready', error: null,
      hydrate: vi.fn(async () => undefined), newProject: vi.fn(async () => undefined),
      saveActiveProject: vi.fn(async () => project), exportActiveProject: vi.fn(async () => new Blob()),
      importProject: vi.fn(async () => undefined),
    },
    interaction,
    gateway: { phase: 'idle', projectRevisionId: project.revisionId, mode: 'off', endpointUrl: null, message: null },
    shellLayoutController,
    scene: {
      createBox: vi.fn(async () => 'box'), createCylinder: vi.fn(async () => 'cylinder'), createGroup: vi.fn(async () => 'group'), rename: vi.fn(async () => undefined), setPersistedVisibility: vi.fn(async () => undefined), setSpatialEntityLocalPose: vi.fn(async () => undefined), setSpatialEntityGroup: vi.fn(async () => undefined), setRobotBase: vi.fn(async () => undefined), setSelectedToolFrames: vi.fn(async () => undefined), setSceneFrameLocalPose: vi.fn(async () => undefined), setMovingFrame: vi.fn(async () => undefined), setNumericStatus: vi.fn(async () => undefined), setStatusOverlayVisible: vi.fn(async () => undefined), reparentGroup: vi.fn(async () => undefined), ungroup: vi.fn(async () => undefined), deleteSpatialEntity: vi.fn(async () => undefined), deleteGroupAndContents: vi.fn(async () => undefined),
    },
    jobs: { createJob: vi.fn(async () => 'job-new'), renameJob: vi.fn(async () => undefined), duplicateJob: vi.fn(async () => 'job-1'), deleteJob: vi.fn(async () => undefined), saveJointPose: vi.fn(async () => undefined), addActionReference: vi.fn(async () => undefined), moveStep: vi.fn(async () => undefined), deleteStep: vi.fn(async () => undefined), setJointPoseSpeed: vi.fn(async () => undefined) },
    viewportPreferences: createViewportPreferenceStoreV4(null),
    projectFiles: { pickProject: vi.fn(async () => null), downloadProject: vi.fn() },
    robotOperator: { canHome: vi.fn(() => true), home: vi.fn(), setGripper: vi.fn(), canSavePose: vi.fn(() => true), savePose: vi.fn(async () => undefined) },
    jobOperator: { canStart: vi.fn(() => true), start: vi.fn(async () => undefined), canCancel: vi.fn(() => true), cancel: vi.fn(async () => undefined) },
    collision: { getState: vi.fn(() => ({ projectRevisionId: project.revisionId, pending: false, canValidate: true, error: null, result: null })), subscribe: vi.fn(() => () => undefined), replaceInput: vi.fn(), validate: vi.fn(async () => undefined), dispose: vi.fn() },
    camera: { home: vi.fn(), fitAll: vi.fn(), canFocusSelection: vi.fn(() => true), focusSelection: vi.fn(), setStandardView: vi.fn() },
    prompt: { requestText: vi.fn(async () => 'Job') },
    help: { getState: vi.fn(() => ({ openTopic: null })), subscribe: vi.fn(() => () => undefined), hasTopic: vi.fn((topic: string) => topic !== 'opcUaMapping'), open: vi.fn(), close: vi.fn(), dispose: vi.fn() },
    actions: {
      project: { newProject: vi.fn(), saveProject: vi.fn(async () => undefined), importProject: vi.fn(async () => 'cancelled' as const), exportProject: vi.fn(async () => undefined), loadDualRobotSample: vi.fn() },
      connectivity: { setMode: vi.fn(async () => undefined) },
      presentation: { openRobotBase: vi.fn(), openInspector: vi.fn(), openTimeline: vi.fn(), openCollision: vi.fn(), openGatewayDetails: vi.fn() },
    },
  }
}

describe('composeAppCommandsV4', () => {
  it('declares the complete ordered one-level placement table and immutable Context tuples', () => {
    const ids = Object.fromEntries(Object.entries(APP_COMMAND_PLACEMENTS_BY_SECTION_V4).map(([section, entries]) => [section, entries.map(({ commandId }) => commandId)]))
    expect(ids).toEqual({
      project: ['project.new', 'project.save', 'project.import', 'project.export', 'project.sample.dual'],
      home: ['view.focusSelection', 'scene.rename', 'scene.pose.copy', 'scene.pose.paste', 'scene.pose.reset', 'scene.visibility.toggle', 'scene.isolate', 'scene.showAll', 'scene.delete', 'robot.home', 'robot.gripper.open', 'robot.gripper.close'],
      model: ['model.add.box', 'model.add.cylinder', 'model.add.group', 'scene.group.move', 'scene.group.remove', 'robot.base.edit', 'robot.mount.edit'],
      job: ['job.new', 'job.pose.save', 'job.start', 'job.cancel', 'job.rename', 'job.duplicate', 'job.delete', 'view.timeline.open'],
      simulation: ['job.start', 'job.cancel', 'view.timeline.open', 'collision.validate', 'view.collision.open'],
      connectivity: ['connectivity.mode.off', 'connectivity.mode.server', 'connectivity.details.open'],
      view: ['view.sidebar', 'view.inspector', 'view.bottom', 'view.ribbon', 'view.layout.reset', 'view.theme.system', 'view.theme.light', 'view.theme.dark', 'view.layer.grid', 'view.layer.world', 'view.layer.mcp', 'view.layer.base', 'view.layer.tcp', 'view.home', 'view.fitAll', 'view.focusSelection', 'view.orientation.isometric', 'view.orientation.top', 'view.orientation.front', 'view.orientation.right', 'view.orientation.back', 'view.orientation.left', 'view.orientation.bottom'],
      help: ['help.controls', 'help.stepImport', 'help.opcUaMapping', 'help.about'],
    })
    expect(APP_COMMAND_PLACEMENTS_BY_SECTION_V4.project.at(-1)).toMatchObject({ submenu: { id: 'project.samples', label: 'Samples' } })
    expect(APP_COMMAND_PLACEMENTS_BY_SECTION_V4.view.find(({ commandId }) => commandId === 'view.theme.system')).toMatchObject({ submenu: { id: 'view.theme', label: 'Theme' } })
    expect(() => (APP_COMMAND_PLACEMENTS_BY_SECTION_V4.project as unknown as object[]).push({})).toThrow()
    expect(() => (APP_CONTEXT_COMMAND_IDS_V4.robot as unknown as string[]).push('bad')).toThrow()
  })

  it('exposes the approved placement and context tuples without duplicate definitions', () => {
    const composed = context()
    const registry = composeAppCommandsV4(composed)
    expect(APP_QUICK_ACTION_IDS_V4).toEqual(['project.save', 'job.start', 'job.cancel'])
    expect(APP_CONTEXT_COMMAND_IDS_V4.object).toEqual([
      'scene.pose.edit', 'scene.parent.edit', 'scene.group.move', 'scene.status.edit', 'scene.visibility.toggle', 'scene.delete',
    ])
    expect(APP_COMMAND_PLACEMENTS_BY_SECTION_V4.project.map(({ commandId }) => commandId)).toEqual([
      'project.new', 'project.save', 'project.import', 'project.export', 'project.sample.dual',
    ])
    const allReferencedIds = [
      ...Object.values(APP_COMMAND_PLACEMENTS_BY_SECTION_V4).flatMap((entries) => entries.map(({ commandId }) => commandId)),
      ...APP_QUICK_ACTION_IDS_V4,
      ...Object.values(APP_CONTEXT_COMMAND_IDS_V4).flatMap((ids) => ids),
    ]
    const uniqueIds = [...new Set(allReferencedIds.filter((id) => id !== 'help.opcUaMapping'))]
    const resolved = uniqueIds.map((id) => [id, registry.get(id)] as const)
    expect(resolved.every(([, entry]) => entry !== null)).toBe(true)
    expect(new Set(resolved.map(([, entry]) => entry)).size).toBe(uniqueIds.length)
    for (const [id, entry] of resolved) {
      if (entry!.visible) expect(registry.list(entry!.section).find((candidate) => candidate.id === id)).toBe(entry)
    }
    expect(registry.get('job.pause')).toBeNull()
    expect(registry.get('help.opcUaMapping')).toBeNull()
  })

  it('uses live active Robot and Job identities without selection fallback', async () => {
    const composed = context()
    const registry = composeAppCommandsV4(composed)
    await registry.get('robot.home')!.execute()
    await registry.get('job.start')!.execute()
    await registry.get('job.cancel')!.execute()
    expect(composed.robotOperator.home).toHaveBeenCalledWith('robot-1')
    expect(composed.jobOperator.start).toHaveBeenCalledWith('robot-1', 'job-1')
    expect(composed.jobOperator.cancel).toHaveBeenCalledWith('robot-1')
  })

  it('uses exact live gripper, Job authoring, and missing-or-foreign Job gates', async () => {
    const composed = context()
    const registry = composeAppCommandsV4(composed)
    await registry.get('robot.gripper.open')!.execute()
    await registry.get('robot.gripper.close')!.execute()
    await registry.get('job.pose.save')!.execute()
    await registry.get('job.rename')!.execute()
    await registry.get('job.duplicate')!.execute()
    await registry.get('job.delete')!.execute()
    expect(composed.robotOperator.setGripper).toHaveBeenNthCalledWith(1, 'robot-1', 'OPEN')
    expect(composed.robotOperator.setGripper).toHaveBeenNthCalledWith(2, 'robot-1', 'CLOSED')
    expect(composed.robotOperator.savePose).toHaveBeenCalledWith('robot-1', 'job-1')
    expect(composed.jobs.renameJob).toHaveBeenCalledWith('job-1', 'Job')
    expect(composed.jobs.duplicateJob).toHaveBeenCalledWith('job-1')
    expect(composed.jobs.deleteJob).toHaveBeenCalledWith('job-1')
    composed.interaction.getState().selectJob('robot-1', null)
    expect(registry.get('job.start')).toMatchObject({ enabled: false, disabledReason: 'No active Job for the active Robot.' })
    composed.interaction.setState({ selectedJobIdsByRobotId: new Map([['robot-1', 'foreign-job']]) })
    expect(registry.get('job.rename')).toMatchObject({ enabled: false, disabledReason: 'No active Job for the active Robot.' })
  })

  it('retargets every Robot and Job command to the live second pair and preserves it across Object selection', async () => {
    const project = projectWithJob()
    const objectProject = {
      ...project,
      spatialEntities: [{
        id: 'object-1', name: 'Object', geometry: { kind: 'box' as const, dimensionsM: [1, 1, 1] as [number, number, number], color: '#123456' as const },
        parentFrameId: 'world', localPose: { positionM: [0, 0, 0] as [number, number, number], quaternion: [0, 0, 0, 1] as [number, number, number, number] }, visible: true, groupId: null, removable: true, transformOwner: 'manual' as const,
        numericStatus: { value: 0, sourceOwnership: 'manual' as const, overlay: { visible: true, frameId: null } }, graspable: false, graspFrames: [], movingFrames: [],
      }],
    }
    const composed = context(objectProject)
    const registry = composeAppCommandsV4(composed)
    composed.interaction.getState().activateRobot('robot-2')
    composed.interaction.getState().selectJob('robot-2', 'job-2')
    composed.interaction.getState().select({ kind: 'spatial-entity', entityId: 'object-1' })
    await registry.get('robot.home')!.execute()
    await registry.get('robot.gripper.open')!.execute()
    await registry.get('job.pose.save')!.execute()
    await registry.get('job.start')!.execute()
    await registry.get('job.cancel')!.execute()
    await registry.get('job.rename')!.execute()
    expect(composed.robotOperator.home).toHaveBeenCalledWith('robot-2')
    expect(composed.robotOperator.setGripper).toHaveBeenCalledWith('robot-2', 'OPEN')
    expect(composed.robotOperator.savePose).toHaveBeenCalledWith('robot-2', 'job-2')
    expect(composed.jobOperator.start).toHaveBeenCalledWith('robot-2', 'job-2')
    expect(composed.jobOperator.cancel).toHaveBeenCalledWith('robot-2')
    expect(composed.jobs.renameJob).toHaveBeenCalledWith('job-2', 'Job')
    expect(composed.interaction.getState()).toMatchObject({ activeRobotId: 'robot-2', selection: { kind: 'spatial-entity', entityId: 'object-1' } })
    expect(composed.interaction.getState().selectedJobIdsByRobotId.get('robot-2')).toBe('job-2')
  })

  it('selects returned duplicate/new jobs and does not mutate services for cancellation or required prompt failure', async () => {
    const composed = context()
    const registry = composeAppCommandsV4(composed)
    const withDuplicate = { ...composed.project, jobs: [...composed.project.jobs, { id: 'job-copy', name: 'Copy', robotId: 'robot-1', steps: [] }] }
    vi.mocked(composed.jobs.duplicateJob).mockImplementation(async () => {
      composed.interaction.getState().replaceProject(withDuplicate)
      return 'job-copy'
    })
    await registry.get('job.duplicate')!.execute()
    expect(composed.interaction.getState().selectedJobIdsByRobotId.get('robot-1')).toBe('job-copy')
    const withNew = { ...withDuplicate, jobs: [...withDuplicate.jobs, { id: 'job-new', name: 'Job', robotId: 'robot-1', steps: [] }] }
    vi.mocked(composed.jobs.createJob).mockImplementation(async () => {
      composed.interaction.getState().replaceProject(withNew)
      return 'job-new'
    })
    await registry.get('job.new')!.execute()
    expect(composed.interaction.getState().selectedJobIdsByRobotId.get('robot-1')).toBe('job-new')
    vi.mocked(composed.prompt.requestText).mockResolvedValueOnce(null)
    await expect(registry.get('job.new')!.execute()).resolves.toBe('cancelled')
    expect(composed.jobs.createJob).toHaveBeenCalledTimes(1)
    vi.mocked(composed.prompt.requestText).mockRejectedValueOnce(new Error('Job name is required.'))
    await expect(registry.get('job.new')!.execute()).rejects.toThrow('Job name is required.')
    expect(composed.jobs.createJob).toHaveBeenCalledTimes(1)
  })

  it('routes checked state and project cancellation to one exact port call', async () => {
    const composed = context()
    const registry = composeAppCommandsV4(composed)
    await expect(registry.get('project.import')!.execute()).resolves.toBe('cancelled')
    await registry.get('view.layer.grid')!.execute()
    await registry.get('connectivity.mode.server')!.execute()
    expect(composed.actions.project.importProject).toHaveBeenCalledTimes(1)
    expect(composed.viewportPreferences.getState().layers.grid).toBe(false)
    expect(composed.actions.connectivity.setMode).toHaveBeenCalledWith('server')
  })

  it('routes every Project action once, leaves projectFiles untouched, and preserves action rejection', async () => {
    const composed = context()
    const registry = composeAppCommandsV4(composed)
    await registry.get('project.new')!.execute()
    await registry.get('project.save')!.execute()
    await registry.get('project.import')!.execute()
    await registry.get('project.export')!.execute()
    await registry.get('project.sample.dual')!.execute()
    expect(composed.actions.project.newProject).toHaveBeenCalledTimes(1)
    expect(composed.actions.project.saveProject).toHaveBeenCalledTimes(1)
    expect(composed.actions.project.importProject).toHaveBeenCalledTimes(1)
    expect(composed.actions.project.exportProject).toHaveBeenCalledTimes(1)
    expect(composed.actions.project.loadDualRobotSample).toHaveBeenCalledTimes(1)
    expect(composed.projectFiles.pickProject).not.toHaveBeenCalled()
    expect(composed.projectFiles.downloadProject).not.toHaveBeenCalled()
    const failure = new Error('export failed')
    vi.mocked(composed.actions.project.exportProject).mockRejectedValueOnce(failure)
    await expect(registry.get('project.export')!.execute()).rejects.toBe(failure)
  })

  it('uses live shell, camera, collision, and Help ports without capability placeholders', async () => {
    const composed = context()
    const registry = composeAppCommandsV4(composed)
    await registry.get('view.sidebar')!.execute()
    await registry.get('view.home')!.execute()
    await registry.get('view.orientation.top')!.execute()
    await registry.get('collision.validate')!.execute()
    await registry.get('help.controls')!.execute()
    expect(composed.shellLayoutController.getState().isDockVisible('sidebar')).toBe(false)
    expect(composed.camera.home).toHaveBeenCalledTimes(1)
    expect(composed.camera.setStandardView).toHaveBeenCalledWith('top')
    expect(composed.collision.validate).toHaveBeenCalledTimes(1)
    expect(composed.help.open).toHaveBeenCalledWith('controls')
    expect(registry.get('connectivity.mode.client')).toBeNull()
    expect(registry.get('model.importRobotStep')).toBeNull()
  })

  it('routes all remaining shell, view, connectivity, presentation, and available Help actions exactly once', async () => {
    const composed = context()
    const registry = composeAppCommandsV4(composed)
    for (const id of ['view.sidebar', 'view.inspector', 'view.bottom', 'view.ribbon', 'view.layout.reset', 'view.theme.system', 'view.theme.light', 'view.theme.dark', 'view.layer.grid', 'view.layer.world', 'view.layer.mcp', 'view.layer.base', 'view.layer.tcp', 'view.home', 'view.fitAll', 'view.focusSelection', 'view.orientation.isometric', 'view.orientation.top', 'view.orientation.front', 'view.orientation.right', 'view.orientation.back', 'view.orientation.left', 'view.orientation.bottom', 'view.timeline.open', 'connectivity.mode.off', 'connectivity.mode.server', 'connectivity.details.open', 'help.controls', 'help.stepImport', 'help.about'] as const) {
      await registry.get(id)!.execute()
    }
    composed.interaction.getState().select({ kind: 'scene-frame', frameId: 'mcp' })
    await registry.get('view.collision.open')!.execute()
    expect(composed.shellLayoutController.getState().preferences.theme).toBe('dark')
    expect(Object.values(composed.viewportPreferences.getState().layers).every((visible) => visible === false)).toBe(true)
    expect(composed.camera.home).toHaveBeenCalledTimes(1)
    expect(composed.camera.fitAll).toHaveBeenCalledTimes(1)
    expect(composed.camera.focusSelection).toHaveBeenCalledTimes(1)
    expect(composed.camera.setStandardView).toHaveBeenCalledTimes(7)
    expect(composed.actions.presentation.openTimeline).toHaveBeenCalledTimes(1)
    expect(composed.actions.presentation.openCollision).toHaveBeenCalledWith({ kind: 'scene-frame', frameId: 'mcp' })
    expect(composed.actions.connectivity.setMode).toHaveBeenNthCalledWith(1, 'off')
    expect(composed.actions.connectivity.setMode).toHaveBeenNthCalledWith(2, 'server')
    expect(composed.actions.presentation.openGatewayDetails).toHaveBeenCalledTimes(1)
    expect(composed.help.open).toHaveBeenCalledWith('controls')
    expect(composed.help.open).toHaveBeenCalledWith('stepImport')
    expect(composed.help.open).toHaveBeenCalledWith('about')
  })

  it('disables collision validation and rejects stale focus without dispatching camera movement', async () => {
    const composed = context()
    const registry = composeAppCommandsV4(composed)
    vi.mocked(composed.collision.getState).mockReturnValue({ projectRevisionId: composed.project.revisionId, pending: false, canValidate: false, error: null, result: null })
    expect(registry.get('collision.validate')).toMatchObject({ enabled: false, disabledReason: 'Collision validation is unavailable while a Job is running or no visible Geometry exists.' })
    vi.mocked(composed.camera.canFocusSelection).mockReturnValue(false)
    expect(() => registry.get('view.focusSelection')!.execute()).toThrow('Select a focusable Scene item.')
    expect(composed.camera.focusSelection).not.toHaveBeenCalled()
  })

  it('uses canonical command metadata and propagates focus and collision rejection', async () => {
    const composed = context()
    const rejected = new Error('collision rejected')
    vi.mocked(composed.collision.validate).mockRejectedValueOnce(rejected)
    vi.mocked(composed.camera.canFocusSelection).mockReturnValue(false)
    const registry = composeAppCommandsV4(composed)
    expect(registry.get('project.save')).toMatchObject({ section: 'project', kind: 'action', shortcut: 'Ctrl+S' })
    expect(registry.get('scene.visibility.toggle')).toMatchObject({ section: 'home', kind: 'toggle' })
    expect(registry.get('scene.delete')).toMatchObject({ section: 'home', destructive: true })
    expect(registry.get('job.delete')).toMatchObject({ section: 'job', destructive: true })
    expect(registry.get('connectivity.mode.off')).toMatchObject({ kind: 'radio', groupId: 'connectivity.runtime-mode', checked: true })
    expect(registry.get('view.theme.system')).toMatchObject({ kind: 'radio', groupId: 'view.theme' })
    expect(registry.get('view.focusSelection')).toMatchObject({ enabled: false, disabledReason: 'Select a focusable Scene item.', shortcut: 'F' })
    await expect(registry.get('collision.validate')!.execute()).rejects.toBe(rejected)
  })

  it('disables snapshot-backed project commands while busy or recovery is required', () => {
    const initialBusy = context()
    const busy = { ...initialBusy, projectState: { ...initialBusy.projectState, status: 'saving' as const } }
    const busyRegistry = composeAppCommandsV4(busy)
    expect(busyRegistry.get('project.new')).toMatchObject({ enabled: false, disabledReason: 'Project operation is in progress.' })
    const initialRecovery = context()
    const recovery = { ...initialRecovery, projectState: { ...initialRecovery.projectState, status: 'recovery-required' as const } }
    expect(composeAppCommandsV4(recovery).get('project.import')).toMatchObject({ enabled: false, disabledReason: 'Reload is required before Project commands can run.' })
    const initialEmpty = context()
    const noActive = { ...initialEmpty, projectState: { ...initialEmpty.projectState, activeProject: null } }
    const noActiveRegistry = composeAppCommandsV4(noActive)
    expect(noActiveRegistry.get('project.save')).toMatchObject({ enabled: false, disabledReason: 'No active Project.' })
    expect(noActiveRegistry.get('project.export')).toMatchObject({ enabled: false, disabledReason: 'No active Project.' })
    expect(noActiveRegistry.get('project.sample.dual')).toMatchObject({ enabled: false, disabledReason: 'No active Project.' })
  })

  it('keeps an existing registry on its snapshot until a replacement context is composed', () => {
    const original = context()
    const firstRegistry = composeAppCommandsV4(original)
    const replacementProject = { ...original.project, opcUa: { ...original.project.opcUa, mode: 'server' as const } }
    const replacement = { ...original, project: replacementProject, projectState: { ...original.projectState, activeProject: replacementProject } }
    const replacementRegistry = composeAppCommandsV4(replacement)
    expect(firstRegistry.get('connectivity.mode.server')).toMatchObject({ checked: false })
    expect(replacementRegistry.get('connectivity.mode.server')).toMatchObject({ checked: true })
  })
})
