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
      createBox: vi.fn(async () => 'box'), createCylinder: vi.fn(async () => 'cylinder'), createGroup: vi.fn(async () => 'group'), rename: vi.fn(async () => undefined), setPersistedVisibility: vi.fn(async () => undefined), setSpatialEntityLocalPose: vi.fn(async () => undefined), setSpatialEntityGroup: vi.fn(async () => undefined), setRobotBase: vi.fn(async () => undefined), setSelectedToolFrames: vi.fn(async () => undefined), setSceneFrameLocalPose: vi.fn(async () => undefined), setMovingFrame: vi.fn(async () => undefined), configureSpatialEntityOpcUaBinding: vi.fn(async () => undefined), takeSpatialEntityManualControl: vi.fn(async () => undefined), setNumericStatus: vi.fn(async () => undefined), setStatusOverlayVisible: vi.fn(async () => undefined), reparentGroup: vi.fn(async () => undefined), ungroup: vi.fn(async () => undefined), deleteSpatialEntity: vi.fn(async () => undefined), deleteGroupAndContents: vi.fn(async () => undefined),
    },
    jobs: { createJob: vi.fn(async () => 'job-new'), renameJob: vi.fn(async () => undefined), duplicateJob: vi.fn(async () => 'job-1'), deleteJob: vi.fn(async () => undefined), saveJointPose: vi.fn(async () => undefined), addActionReference: vi.fn(async () => undefined), moveStep: vi.fn(async () => undefined), deleteStep: vi.fn(async () => undefined), setJointPoseSpeed: vi.fn(async () => undefined) },
    viewportPreferences: createViewportPreferenceStoreV4(null),
    projectFiles: { pickProject: vi.fn(async () => null), downloadProject: vi.fn() },
    robotOperator: { canHome: vi.fn(() => true), home: vi.fn(), setGripper: vi.fn(), canSavePose: vi.fn(() => true), savePose: vi.fn(async () => undefined) },
    jobOperator: { canAuthor: vi.fn(() => true), canStart: vi.fn(() => true), start: vi.fn(async () => undefined), canCancel: vi.fn(() => true), cancel: vi.fn(async () => undefined), canReset: vi.fn(() => false), reset: vi.fn(async () => undefined) },
    collision: { getState: vi.fn(() => ({ projectRevisionId: project.revisionId, pending: false, canValidate: true, error: null, result: null })), subscribe: vi.fn(() => () => undefined), replaceInput: vi.fn(), validate: vi.fn(async () => undefined), dispose: vi.fn() },
    camera: { home: vi.fn(), fitAll: vi.fn(), canFocusSelection: vi.fn(() => true), focusSelection: vi.fn(), setStandardView: vi.fn() },
    prompt: { requestText: vi.fn(async () => 'Job') },
    help: { getState: vi.fn(() => ({ openTopic: null })), subscribe: vi.fn(() => () => undefined), hasTopic: vi.fn((topic: string) => topic !== 'opcUaMapping'), open: vi.fn(), close: vi.fn(), dispose: vi.fn() },
    actions: {
      project: { newProject: vi.fn(), saveProject: vi.fn(async () => undefined), importProject: vi.fn(async () => 'cancelled' as const), exportProject: vi.fn(async () => undefined), loadDualRobotSample: vi.fn() },
      connectivity: { setMode: vi.fn(async () => undefined) },
      presentation: { canOpenRobotImport: vi.fn(() => true), openRobotImport: vi.fn(), openRobotBase: vi.fn(), openInspector: vi.fn(), openTimeline: vi.fn(), openCollision: vi.fn(), openGatewayDetails: vi.fn() },
    },
  }
}

describe('composeAppCommandsV4', () => {
  it('declares the complete ordered one-level placement table and immutable Context tuples', () => {
    const root = (commandId: string) => ({ commandId, submenu: null })
    const submenu = (commandId: string, id: string, label: string) => ({ commandId, submenu: { id, label } })
    expect(APP_COMMAND_PLACEMENTS_BY_SECTION_V4).toEqual({
      project: [root('project.new'), root('project.save'), root('project.import'), root('project.export'), submenu('project.sample.dual', 'project.samples', 'Samples')],
      home: ['view.focusSelection', 'scene.rename', 'scene.pose.copy', 'scene.pose.paste', 'scene.pose.reset', 'scene.visibility.toggle', 'scene.isolate', 'scene.showAll', 'scene.delete', 'robot.home', 'robot.gripper.open', 'robot.gripper.close'].map(root),
      model: ['model.importRobotStep', 'model.add.box', 'model.add.cylinder', 'model.add.group', 'scene.group.move', 'scene.group.remove', 'robot.base.edit', 'robot.mount.edit'].map(root),
      job: ['job.new', 'job.pose.save', 'job.start', 'job.cancel', 'job.rename', 'job.duplicate', 'job.delete', 'view.timeline.open'].map(root),
      simulation: ['job.start', 'job.cancel', 'view.timeline.open', 'collision.validate', 'view.collision.open'].map(root),
      connectivity: [submenu('connectivity.mode.off', 'connectivity.runtime-mode', 'Runtime Mode'), submenu('connectivity.mode.client', 'connectivity.runtime-mode', 'Runtime Mode'), submenu('connectivity.mode.server', 'connectivity.runtime-mode', 'Runtime Mode'), submenu('connectivity.mode.bridge', 'connectivity.runtime-mode', 'Runtime Mode'), root('connectivity.details.open')],
      view: [
        ...['view.sidebar', 'view.inspector', 'view.bottom', 'view.ribbon', 'view.layout.reset'].map((id) => submenu(id, 'view.panels', 'Panels')),
        ...['view.theme.system', 'view.theme.light', 'view.theme.dark'].map((id) => submenu(id, 'view.theme', 'Theme')),
        ...['view.layer.grid', 'view.layer.world', 'view.layer.mcp', 'view.layer.base', 'view.layer.tcp'].map((id) => submenu(id, 'view.layers', 'Layers')),
        ...['view.home', 'view.fitAll', 'view.focusSelection'].map((id) => submenu(id, 'view.camera', 'Camera')),
        ...['view.orientation.isometric', 'view.orientation.top', 'view.orientation.front', 'view.orientation.right', 'view.orientation.back', 'view.orientation.left', 'view.orientation.bottom'].map((id) => submenu(id, 'view.standard-views', 'Standard Views')),
      ],
      help: ['help.controls', 'help.stepImport', 'help.opcUaMapping', 'help.about'].map(root),
    })
    expect(() => (APP_COMMAND_PLACEMENTS_BY_SECTION_V4.project as unknown as object[]).push({})).toThrow()
    expect(() => (APP_CONTEXT_COMMAND_IDS_V4.robot as unknown as string[]).push('bad')).toThrow()
    expect(Object.isFrozen(APP_COMMAND_PLACEMENTS_BY_SECTION_V4)).toBe(true)
    for (const entries of Object.values(APP_COMMAND_PLACEMENTS_BY_SECTION_V4)) {
      expect(Object.isFrozen(entries)).toBe(true)
      for (const entry of entries) {
        expect(Object.isFrozen(entry)).toBe(true)
        if (entry.submenu !== null) expect(Object.isFrozen(entry.submenu)).toBe(true)
      }
    }
    for (const ids of Object.values(APP_CONTEXT_COMMAND_IDS_V4)) expect(Object.isFrozen(ids)).toBe(true)
    expect(Object.isFrozen(APP_QUICK_ACTION_IDS_V4)).toBe(true)
    expect(APP_QUICK_ACTION_IDS_V4).toEqual(['project.save', 'job.start', 'job.cancel'])
    expect(APP_CONTEXT_COMMAND_IDS_V4).toEqual({
      robot: ['robot.jog.open', 'robot.home', 'robot.base.edit', 'scene.visibility.toggle'],
      object: ['scene.pose.edit', 'scene.parent.edit', 'scene.group.move', 'scene.status.edit', 'scene.visibility.toggle', 'scene.delete'],
      job: ['job.pose.save', 'job.start', 'job.cancel', 'job.rename', 'job.duplicate', 'job.delete', 'view.timeline.open'],
      empty: ['model.add.box', 'model.add.cylinder', 'model.add.group', 'view.fitAll'],
    })
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

  it('creates and selects a Robot-owned Job before saving when an imported Robot has no Job yet', async () => {
    const project = projectWithJob()
    const withoutRobotTwoJob = {
      ...project,
      jobs: project.jobs.filter(({ robotId }) => robotId !== 'robot-2'),
    }
    const composed = context(withoutRobotTwoJob)
    const registry = composeAppCommandsV4(composed)
    composed.interaction.getState().activateRobot('robot-2')
    const withCreatedJob = {
      ...withoutRobotTwoJob,
      jobs: [...withoutRobotTwoJob.jobs, {
        id: 'job-new', name: 'Robot 2 Job', robotId: 'robot-2', steps: [],
      }],
    }
    vi.mocked(composed.jobs.createJob).mockImplementation(async () => {
      composed.interaction.getState().replaceProject(withCreatedJob)
      return 'job-new'
    })

    expect(registry.get('job.pose.save')).toMatchObject({ enabled: true })
    await registry.get('job.pose.save')!.execute()

    expect(composed.jobs.createJob).toHaveBeenCalledWith('robot-2', 'Robot 2 Job')
    expect(composed.interaction.getState().selectedJobIdsByRobotId.get('robot-2')).toBe('job-new')
    expect(composed.robotOperator.savePose).toHaveBeenCalledWith('robot-2', 'job-new')
  })

  it('publishes one RUNNING authoring gate to every Job command surface', async () => {
    const composed = context()
    vi.mocked(composed.jobOperator.canAuthor).mockReturnValue(false)
    const registry = composeAppCommandsV4(composed)

    for (const id of ['job.new', 'job.rename', 'job.duplicate', 'job.delete'] as const) {
      expect(registry.get(id)).toMatchObject({ enabled: false })
    }
    await expect(registry.get('job.new')!.execute()).rejects.toThrow()
    for (const id of ['job.rename', 'job.duplicate', 'job.delete'] as const) {
      expect(() => registry.get(id)!.execute()).toThrow()
    }
    expect(composed.prompt.requestText).not.toHaveBeenCalled()
    expect(composed.jobs.createJob).not.toHaveBeenCalled()
    expect(composed.jobs.renameJob).not.toHaveBeenCalled()
    expect(composed.jobs.duplicateJob).not.toHaveBeenCalled()
    expect(composed.jobs.deleteJob).not.toHaveBeenCalled()
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
    await registry.get('job.delete')!.execute()
    expect(composed.robotOperator.home).toHaveBeenCalledWith('robot-2')
    expect(composed.robotOperator.setGripper).toHaveBeenCalledWith('robot-2', 'OPEN')
    expect(composed.robotOperator.savePose).toHaveBeenCalledWith('robot-2', 'job-2')
    expect(composed.jobOperator.start).toHaveBeenCalledWith('robot-2', 'job-2')
    expect(composed.jobOperator.cancel).toHaveBeenCalledWith('robot-2')
    expect(composed.jobs.renameJob).toHaveBeenCalledWith('job-2', 'Job')
    expect(composed.jobs.deleteJob).toHaveBeenCalledWith('job-2')
    expect(composed.interaction.getState()).toMatchObject({ activeRobotId: 'robot-2', selection: { kind: 'spatial-entity', entityId: 'object-1' } })
    expect(composed.interaction.getState().selectedJobIdsByRobotId.get('robot-2')).toBe('job-2')
  })

  it('selects Robot 2 duplicate and new Job return values on the live pair', async () => {
    const composed = context()
    const registry = composeAppCommandsV4(composed)
    composed.interaction.getState().activateRobot('robot-2')
    composed.interaction.getState().selectJob('robot-2', 'job-2')
    const duplicated = { ...composed.project, jobs: [...composed.project.jobs, { id: 'job-2-copy', name: 'Copy', robotId: 'robot-2', steps: [] }] }
    vi.mocked(composed.jobs.duplicateJob).mockImplementation(async () => { composed.interaction.getState().replaceProject(duplicated); return 'job-2-copy' })
    await registry.get('job.duplicate')!.execute()
    expect(composed.jobs.duplicateJob).toHaveBeenCalledWith('job-2')
    expect(composed.interaction.getState().selectedJobIdsByRobotId.get('robot-2')).toBe('job-2-copy')
    const withNew = { ...duplicated, jobs: [...duplicated.jobs, { id: 'job-2-new', name: 'Job', robotId: 'robot-2', steps: [] }] }
    vi.mocked(composed.jobs.createJob).mockImplementation(async () => { composed.interaction.getState().replaceProject(withNew); return 'job-2-new' })
    await registry.get('job.new')!.execute()
    expect(composed.jobs.createJob).toHaveBeenCalledWith('robot-2', 'Job')
    expect(composed.interaction.getState().selectedJobIdsByRobotId.get('robot-2')).toBe('job-2-new')
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
    expect(registry.get('connectivity.mode.client')).toMatchObject({ label: 'OPC UA Client' })
    expect(registry.get('connectivity.mode.bridge')).toMatchObject({ label: 'OPC UA Bridge' })
    expect(registry.get('model.importRobotStep')).toMatchObject({
      label: 'Import Robot STEP',
      enabled: true,
    })
    await registry.get('model.importRobotStep')!.execute()
    expect(composed.actions.presentation.openRobotImport).toHaveBeenCalledTimes(1)
  })

  it('flips every Shell checked state and reset restores its deterministic defaults', async () => {
    const composed = context()
    const registry = composeAppCommandsV4(composed)
    for (const id of ['view.sidebar', 'view.inspector', 'view.bottom', 'view.ribbon'] as const) await registry.get(id)!.execute()
    expect(registry.get('view.sidebar')).toMatchObject({ checked: false })
    expect(registry.get('view.inspector')).toMatchObject({ checked: false })
    expect(registry.get('view.bottom')).toMatchObject({ checked: true })
    expect(registry.get('view.ribbon')).toMatchObject({ checked: false })
    await registry.get('view.layout.reset')!.execute()
    expect(registry.get('view.sidebar')).toMatchObject({ checked: true })
    expect(registry.get('view.inspector')).toMatchObject({ checked: true })
    expect(registry.get('view.bottom')).toMatchObject({ checked: false })
    expect(registry.get('view.ribbon')).toMatchObject({ checked: true })
  })

  it('routes all remaining shell, view, connectivity, presentation, and available Help actions exactly once', async () => {
    const composed = context()
    const registry = composeAppCommandsV4(composed)
    for (const id of ['view.sidebar', 'view.inspector', 'view.bottom', 'view.ribbon', 'view.layout.reset', 'view.theme.system', 'view.theme.light', 'view.theme.dark', 'view.layer.grid', 'view.layer.world', 'view.layer.mcp', 'view.layer.base', 'view.layer.tcp', 'view.home', 'view.fitAll', 'view.focusSelection', 'view.orientation.isometric', 'view.orientation.top', 'view.orientation.front', 'view.orientation.right', 'view.orientation.back', 'view.orientation.left', 'view.orientation.bottom', 'view.timeline.open', 'connectivity.mode.off', 'connectivity.mode.client', 'connectivity.mode.server', 'connectivity.mode.bridge', 'connectivity.details.open', 'help.controls', 'help.stepImport', 'help.about'] as const) {
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
    expect(composed.actions.connectivity.setMode).toHaveBeenNthCalledWith(2, 'client')
    expect(composed.actions.connectivity.setMode).toHaveBeenNthCalledWith(3, 'server')
    expect(composed.actions.connectivity.setMode).toHaveBeenNthCalledWith(4, 'bridge')
    expect(composed.actions.presentation.openGatewayDetails).toHaveBeenCalledTimes(1)
    expect(composed.help.open).toHaveBeenCalledWith('controls')
    expect(composed.help.open).toHaveBeenCalledWith('stepImport')
    expect(composed.help.open).toHaveBeenCalledWith('about')
  })

  it('disables collision validation while the camera port rejects an unavailable focus execution', async () => {
    const composed = context()
    const registry = composeAppCommandsV4(composed)
    vi.mocked(composed.collision.getState).mockReturnValue({ projectRevisionId: composed.project.revisionId, pending: false, canValidate: false, error: null, result: null })
    expect(registry.get('collision.validate')).toMatchObject({ enabled: false, disabledReason: 'Collision validation is unavailable while a Job is running or no visible Geometry exists.' })
    vi.mocked(composed.camera.canFocusSelection).mockReturnValue(false)
    vi.mocked(composed.camera.focusSelection).mockImplementation(() => {
      throw new Error('Select a focusable Scene item.')
    })
    expect(() => registry.get('view.focusSelection')!.execute()).toThrow('Select a focusable Scene item.')
    expect(composed.camera.focusSelection).toHaveBeenCalledOnce()
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

  it('uses the complete canonical toggle, radio, destructive, shortcut, section, and label metadata sets', () => {
    const registry = composeAppCommandsV4(context())
    const all = ['project', 'home', 'model', 'job', 'simulation', 'connectivity', 'view', 'help'].flatMap((section) => registry.list(section as Parameters<typeof registry.list>[0]))
    expect(new Set(all.map(({ id }) => id)).size).toBe(all.length)
    expect(all.filter(({ kind }) => kind === 'toggle').map(({ id }) => id)).toEqual([
      'scene.visibility.toggle', 'view.sidebar', 'view.inspector', 'view.bottom', 'view.ribbon', 'view.layer.grid', 'view.layer.world', 'view.layer.mcp', 'view.layer.base', 'view.layer.tcp',
    ])
    expect(all.filter(({ kind }) => kind === 'radio').map(({ id, groupId }) => [id, groupId])).toEqual([
      ['connectivity.mode.off', 'connectivity.runtime-mode'], ['connectivity.mode.client', 'connectivity.runtime-mode'], ['connectivity.mode.server', 'connectivity.runtime-mode'], ['connectivity.mode.bridge', 'connectivity.runtime-mode'], ['view.theme.system', 'view.theme'], ['view.theme.light', 'view.theme'], ['view.theme.dark', 'view.theme'],
    ])
    expect(all.filter(({ destructive }) => destructive === true).map(({ id }) => id)).toEqual(['scene.delete', 'job.delete'])
    expect(all.filter(({ shortcut }) => shortcut !== undefined).map(({ id, shortcut }) => [id, shortcut])).toEqual([
      ['project.save', 'Ctrl+S'], ['view.home', 'H'], ['view.focusSelection', 'F'],
    ])
    expect(all.filter(({ section }) => section === 'project').map(({ id, label }) => [id, label])).toEqual([
      ['project.new', 'New Project'], ['project.save', 'Save Project'], ['project.import', 'Import Project'], ['project.export', 'Export Project'], ['project.sample.dual', 'Dual-Robot Technical Demo'],
    ])
    expect(all.filter(({ section }) => section === 'connectivity').map(({ id, label }) => [id, label])).toEqual([
      ['connectivity.mode.off', 'Off'], ['connectivity.mode.client', 'OPC UA Client'], ['connectivity.mode.server', 'OPC UA Server'], ['connectivity.mode.bridge', 'OPC UA Bridge'], ['connectivity.details.open', 'Gateway Details'],
    ])
  })

  it('projects every registered fixture command to its literal id, label, and canonical section', () => {
    const registry = composeAppCommandsV4(context())
    const expected = [
      { id: 'project.new', label: 'New Project', section: 'project' },
      { id: 'project.save', label: 'Save Project', section: 'project' },
      { id: 'project.import', label: 'Import Project', section: 'project' },
      { id: 'project.export', label: 'Export Project', section: 'project' },
      { id: 'project.sample.dual', label: 'Dual-Robot Technical Demo', section: 'project' },
      { id: 'scene.rename', label: 'Rename', section: 'home' },
      { id: 'scene.pose.copy', label: 'Copy Pose', section: 'home' },
      { id: 'scene.pose.paste', label: 'Paste Pose', section: 'home' },
      { id: 'scene.pose.reset', label: 'Reset Pose', section: 'home' },
      { id: 'scene.visibility.toggle', label: 'Hide', section: 'home' },
      { id: 'scene.isolate', label: 'Isolate', section: 'home' },
      { id: 'scene.showAll', label: 'Show All', section: 'home' },
      { id: 'scene.delete', label: 'Delete', section: 'home' },
      { id: 'robot.jog.open', label: 'Joint Jog', section: 'home' },
      { id: 'robot.home', label: 'Robot Home', section: 'home' },
      { id: 'robot.gripper.open', label: 'Open Gripper', section: 'home' },
      { id: 'robot.gripper.close', label: 'Close Gripper', section: 'home' },
      { id: 'model.importRobotStep', label: 'Import Robot STEP', section: 'model' },
      { id: 'model.add.box', label: 'Add Box', section: 'model' },
      { id: 'model.add.cylinder', label: 'Add Cylinder', section: 'model' },
      { id: 'model.add.group', label: 'Add Group', section: 'model' },
      { id: 'scene.group.move', label: 'Move to Group', section: 'model' },
      { id: 'scene.group.remove', label: 'Remove from Group', section: 'model' },
      { id: 'robot.base.edit', label: 'Edit Robot Base', section: 'model' },
      { id: 'robot.mount.edit', label: 'Edit Robot Mount', section: 'model' },
      { id: 'scene.pose.edit', label: 'XYZRPY', section: 'model' },
      { id: 'scene.parent.edit', label: 'Parent', section: 'model' },
      { id: 'scene.status.edit', label: 'Numeric Status', section: 'model' },
      { id: 'job.new', label: 'New Job', section: 'job' },
      { id: 'job.pose.save', label: 'Save Current Pose', section: 'job' },
      { id: 'job.start', label: 'Start Job', section: 'job' },
      { id: 'job.cancel', label: 'Cancel Active Robot Job', section: 'job' },
      { id: 'job.rename', label: 'Rename Job', section: 'job' },
      { id: 'job.duplicate', label: 'Duplicate Job', section: 'job' },
      { id: 'job.delete', label: 'Delete Job', section: 'job' },
      { id: 'view.timeline.open', label: 'Open Timeline', section: 'job' },
      { id: 'collision.validate', label: 'Validate Geometry Collision', section: 'simulation' },
      { id: 'view.collision.open', label: 'Open Collision Findings', section: 'simulation' },
      { id: 'connectivity.mode.off', label: 'Off', section: 'connectivity' },
      { id: 'connectivity.mode.client', label: 'OPC UA Client', section: 'connectivity' },
      { id: 'connectivity.mode.server', label: 'OPC UA Server', section: 'connectivity' },
      { id: 'connectivity.mode.bridge', label: 'OPC UA Bridge', section: 'connectivity' },
      { id: 'connectivity.details.open', label: 'Gateway Details', section: 'connectivity' },
      { id: 'view.sidebar', label: 'Scene and Job Sidebar', section: 'view' },
      { id: 'view.inspector', label: 'Inspector', section: 'view' },
      { id: 'view.bottom', label: 'Bottom Workspace', section: 'view' },
      { id: 'view.ribbon', label: 'Ribbon Lite', section: 'view' },
      { id: 'view.layout.reset', label: 'Reset Layout', section: 'view' },
      { id: 'view.theme.system', label: 'System', section: 'view' },
      { id: 'view.theme.light', label: 'Light', section: 'view' },
      { id: 'view.theme.dark', label: 'Dark', section: 'view' },
      { id: 'view.layer.grid', label: 'Grid', section: 'view' },
      { id: 'view.layer.world', label: 'World Frame', section: 'view' },
      { id: 'view.layer.mcp', label: 'MCP Frame', section: 'view' },
      { id: 'view.layer.base', label: 'Robot Base Frame', section: 'view' },
      { id: 'view.layer.tcp', label: 'TCP Frame', section: 'view' },
      { id: 'view.home', label: 'Home View', section: 'view' },
      { id: 'view.fitAll', label: 'Fit All', section: 'view' },
      { id: 'view.focusSelection', label: 'Focus Selection', section: 'view' },
      { id: 'view.orientation.isometric', label: 'Isometric', section: 'view' },
      { id: 'view.orientation.top', label: 'Top', section: 'view' },
      { id: 'view.orientation.front', label: 'Front', section: 'view' },
      { id: 'view.orientation.right', label: 'Right', section: 'view' },
      { id: 'view.orientation.back', label: 'Back', section: 'view' },
      { id: 'view.orientation.left', label: 'Left', section: 'view' },
      { id: 'view.orientation.bottom', label: 'Bottom', section: 'view' },
      { id: 'help.controls', label: 'Keyboard and Mouse Controls', section: 'help' },
      { id: 'help.stepImport', label: 'STEP Import Guide', section: 'help' },
      { id: 'help.about', label: 'About', section: 'help' },
    ] as const
    expect(expected.map(({ id }) => registry.get(id)).every((command) => command !== null)).toBe(true)
    expect(expected.map(({ id }) => {
      const command = registry.get(id)!
      return { id: command.id, label: command.label, section: command.section }
    })).toEqual(expected)
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
    for (const status of ['loading', 'importing'] as const) {
      const next = { ...initialEmpty, projectState: { ...initialEmpty.projectState, status } }
      expect(composeAppCommandsV4(next).get('project.new')).toMatchObject({ enabled: false, disabledReason: 'Project operation is in progress.' })
      expect(composeAppCommandsV4(next).get('project.import')).toMatchObject({ enabled: false, disabledReason: 'Project operation is in progress.' })
    }
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

  it('registers and executes the optional OPC UA Help topic when it is available', async () => {
    const initial = context()
    const help = { ...initial.help, hasTopic: vi.fn(() => true) }
    const registry = composeAppCommandsV4({ ...initial, help })
    for (const id of ['help.controls', 'help.stepImport', 'help.opcUaMapping', 'help.about'] as const) await registry.get(id)!.execute()
    expect(help.open).toHaveBeenCalledWith('controls')
    expect(help.open).toHaveBeenCalledWith('stepImport')
    expect(help.open).toHaveBeenCalledWith('opcUaMapping')
    expect(help.open).toHaveBeenCalledWith('about')
    for (const id of ['job.pause', 'job.resume', 'robot.geometry.open', 'robot.kinematics.open', 'robot.rapid.open', 'scene.opcUaMapping.open', 'coordinate.frames.open'] as const) expect(registry.get(id)).toBeNull()
  })
})
