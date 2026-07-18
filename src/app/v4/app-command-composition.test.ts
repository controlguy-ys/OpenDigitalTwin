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
    jobs: [{ id: 'job-1', name: 'Job 1', robotId: 'robot-1', steps: [] }],
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
    jobs: { createJob: vi.fn(async () => 'job-new'), renameJob: vi.fn(async () => undefined), duplicateJob: vi.fn(async () => 'job-copy'), deleteJob: vi.fn(async () => undefined), saveJointPose: vi.fn(async () => undefined), addActionReference: vi.fn(async () => undefined), moveStep: vi.fn(async () => undefined), deleteStep: vi.fn(async () => undefined), setJointPoseSpeed: vi.fn(async () => undefined) },
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
    expect(registry.get('job.start')).toBe(registry.get('job.start'))
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

  it('disables snapshot-backed project commands while busy or recovery is required', () => {
    const initialBusy = context()
    const busy = { ...initialBusy, projectState: { ...initialBusy.projectState, status: 'saving' as const } }
    const busyRegistry = composeAppCommandsV4(busy)
    expect(busyRegistry.get('project.new')).toMatchObject({ enabled: false, disabledReason: 'Project operation is in progress.' })
    const initialRecovery = context()
    const recovery = { ...initialRecovery, projectState: { ...initialRecovery.projectState, status: 'recovery-required' as const } }
    expect(composeAppCommandsV4(recovery).get('project.import')).toMatchObject({ enabled: false, disabledReason: 'Reload is required before Project commands can run.' })
  })
})
