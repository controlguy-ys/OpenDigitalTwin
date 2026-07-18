import type { RobotIdV4, WorkcellProjectV4 } from '../../core/project-v4/index.js'
import type { AppCommandSectionV4, AppCommandV4 } from '../../features/commands/v4/app-command.js'
import { createAppCommandRegistryV4, type AppCommandRegistryV4 } from '../../features/commands/v4/app-command-registry.js'
import type { CollisionValidationControllerV4 } from '../../features/collision/v4/collision-validation-controller.js'
import { activeJobIdV4, type InteractionStoreStateV4 } from '../../features/interaction/v4/interaction-store.js'
import type { SceneSelectionTargetV4 } from '../../features/interaction/v4/scene-selection.js'
import type { RobotOperatorCommandServiceV4 } from '../../features/joints/v4/robot-operator-command-service.js'
import type { JobCommandServiceV4 } from '../../features/jobs/v4/job-command-service.js'
import type { JobOperatorServiceV4 } from '../../features/jobs/v4/job-operator-service.js'
import type { ProjectFileCommandPortV4 } from '../../features/project/v4/project-file-command-port.js'
import type { ProjectStoreStateV4 } from '../../features/project/v4/project-store-v4.js'
import type { RuntimeGatewayPresentationV4 } from '../../features/runtime-gateway/v4/runtime-gateway-publisher-v4.js'
import type { UserPromptPortV4 } from '../../features/ui/v4/user-prompt-port.js'
import type { LocalHelpControllerV4, LocalHelpTopicV4 } from '../../features/help/v4/local-help-controller.js'
import type { ShellLayoutControllerV4 } from '../../features/ui/v4/shell-layout-controller.js'
import type { ViewportPreferenceStoreV4 } from '../../features/viewport/v4/viewport-preference-store.js'
import type { StandardWorldView } from '../../features/viewport/camera-actions.js'
import type { StoreApi } from 'zustand/vanilla'
import type { SceneCommandServiceV4 } from '../../features/scene/v4/scene-command-service.js'
import {
  composeSceneContextCommandsV4,
  resolveSceneContextTargetV4,
  type SceneCommandPresentationPortV4,
} from '../../features/scene/v4/scene-context-commands.js'

export interface AppCameraCommandPortV4 {
  home(): void
  fitAll(): void
  canFocusSelection(): boolean
  focusSelection(): void
  setStandardView(view: StandardWorldView): void
}

export interface AppCommandActionPortsV4 {
  readonly project: {
    newProject(): void | Promise<void>
    saveProject(): Promise<void>
    importProject(): Promise<'cancelled' | void>
    exportProject(): Promise<void>
    loadDualRobotSample(): void | Promise<void>
  }
  readonly connectivity: { setMode(mode: WorkcellProjectV4['opcUa']['mode']): Promise<void> }
  readonly presentation: {
    openRobotBase(robotId: RobotIdV4): void
    openInspector(request: {
      readonly selection: SceneSelectionTargetV4
      readonly section: 'joints' | 'pose' | 'parent' | 'group' | 'numericStatus'
    }): void
    openTimeline(): void
    openCollision(selection: SceneSelectionTargetV4 | null): void
    openGatewayDetails(): void
  }
}

export interface AppCommandCompositionContextV4 {
  readonly project: WorkcellProjectV4
  readonly projectState: ProjectStoreStateV4
  readonly interaction: StoreApi<InteractionStoreStateV4>
  readonly gateway: RuntimeGatewayPresentationV4
  readonly shellLayoutController: ShellLayoutControllerV4
  readonly scene: SceneCommandServiceV4
  readonly jobs: JobCommandServiceV4
  readonly viewportPreferences: ViewportPreferenceStoreV4
  readonly projectFiles: ProjectFileCommandPortV4
  readonly robotOperator: RobotOperatorCommandServiceV4
  readonly jobOperator: JobOperatorServiceV4
  readonly collision: CollisionValidationControllerV4
  readonly camera: AppCameraCommandPortV4
  readonly prompt: UserPromptPortV4
  readonly help: LocalHelpControllerV4
  readonly actions: AppCommandActionPortsV4
}

export interface AppCommandMenuPlacementV4 {
  readonly commandId: string
  readonly submenu: null | { readonly id: string; readonly label: string }
}

type PlacementMapV4 = Readonly<Record<AppCommandSectionV4, readonly AppCommandMenuPlacementV4[]>>

function placements(
  entries: readonly (readonly [string, string | null, string | null])[],
): readonly AppCommandMenuPlacementV4[] {
  return Object.freeze(entries.map(([commandId, id, label]) => Object.freeze({
    commandId, submenu: id === null || label === null ? null : Object.freeze({ id, label }),
  })))
}

export const APP_COMMAND_PLACEMENTS_BY_SECTION_V4: PlacementMapV4 = Object.freeze({
  project: placements([
    ['project.new', null, null], ['project.save', null, null], ['project.import', null, null], ['project.export', null, null], ['project.sample.dual', 'project.samples', 'Samples'],
  ]),
  home: placements([
    ['view.focusSelection', null, null], ['scene.rename', null, null], ['scene.pose.copy', null, null], ['scene.pose.paste', null, null], ['scene.pose.reset', null, null], ['scene.visibility.toggle', null, null], ['scene.isolate', null, null], ['scene.showAll', null, null], ['scene.delete', null, null], ['robot.home', null, null], ['robot.gripper.open', null, null], ['robot.gripper.close', null, null],
  ]),
  model: placements([
    ['model.add.box', null, null], ['model.add.cylinder', null, null], ['model.add.group', null, null], ['scene.group.move', null, null], ['scene.group.remove', null, null], ['robot.base.edit', null, null], ['robot.mount.edit', null, null],
  ]),
  job: placements([
    ['job.new', null, null], ['job.pose.save', null, null], ['job.start', null, null], ['job.cancel', null, null], ['job.rename', null, null], ['job.duplicate', null, null], ['job.delete', null, null], ['view.timeline.open', null, null],
  ]),
  simulation: placements([
    ['job.start', null, null], ['job.cancel', null, null], ['view.timeline.open', null, null], ['collision.validate', null, null], ['view.collision.open', null, null],
  ]),
  connectivity: placements([
    ['connectivity.mode.off', 'connectivity.runtime-mode', 'Runtime Mode'], ['connectivity.mode.client', 'connectivity.runtime-mode', 'Runtime Mode'], ['connectivity.mode.server', 'connectivity.runtime-mode', 'Runtime Mode'], ['connectivity.mode.bridge', 'connectivity.runtime-mode', 'Runtime Mode'], ['connectivity.details.open', null, null],
  ]),
  view: placements([
    ['view.sidebar', 'view.panels', 'Panels'], ['view.inspector', 'view.panels', 'Panels'], ['view.bottom', 'view.panels', 'Panels'], ['view.ribbon', 'view.panels', 'Panels'], ['view.layout.reset', 'view.panels', 'Panels'],
    ['view.theme.system', 'view.theme', 'Theme'], ['view.theme.light', 'view.theme', 'Theme'], ['view.theme.dark', 'view.theme', 'Theme'],
    ['view.layer.grid', 'view.layers', 'Layers'], ['view.layer.world', 'view.layers', 'Layers'], ['view.layer.mcp', 'view.layers', 'Layers'], ['view.layer.base', 'view.layers', 'Layers'], ['view.layer.tcp', 'view.layers', 'Layers'],
    ['view.home', 'view.camera', 'Camera'], ['view.fitAll', 'view.camera', 'Camera'], ['view.focusSelection', 'view.camera', 'Camera'],
    ['view.orientation.isometric', 'view.standard-views', 'Standard Views'], ['view.orientation.top', 'view.standard-views', 'Standard Views'], ['view.orientation.front', 'view.standard-views', 'Standard Views'], ['view.orientation.right', 'view.standard-views', 'Standard Views'], ['view.orientation.back', 'view.standard-views', 'Standard Views'], ['view.orientation.left', 'view.standard-views', 'Standard Views'], ['view.orientation.bottom', 'view.standard-views', 'Standard Views'],
  ]),
  help: placements([
    ['help.controls', null, null], ['help.stepImport', null, null], ['help.opcUaMapping', null, null], ['help.about', null, null],
  ]),
})

export const APP_QUICK_ACTION_IDS_V4 = Object.freeze([
  'project.save', 'job.start', 'job.cancel',
] as const)

export const APP_CONTEXT_COMMAND_IDS_V4 = Object.freeze({
  robot: Object.freeze(['robot.jog.open', 'robot.home', 'robot.base.edit', 'scene.visibility.toggle'] as const),
  object: Object.freeze(['scene.pose.edit', 'scene.parent.edit', 'scene.group.move', 'scene.status.edit', 'scene.visibility.toggle', 'scene.delete'] as const),
  job: Object.freeze(['job.pose.save', 'job.start', 'job.cancel', 'job.rename', 'job.duplicate', 'job.delete', 'view.timeline.open'] as const),
  empty: Object.freeze(['model.add.box', 'model.add.cylinder', 'model.add.group', 'view.fitAll'] as const),
})

const PROJECT_BUSY_STATUSES = new Set(['loading', 'saving', 'importing'])

function command(id: string, label: string, section: AppCommandSectionV4, properties: object): AppCommandV4 {
  return Object.defineProperties({ id, label, section }, Object.getOwnPropertyDescriptors(properties)) as AppCommandV4
}

function activeRobot(context: AppCommandCompositionContextV4): WorkcellProjectV4['robots'][number] | null {
  const id = context.interaction.getState().activeRobotId
  return id === null ? null : context.project.robots.find((robot) => robot.id === id) ?? null
}

function activeJob(context: AppCommandCompositionContextV4): WorkcellProjectV4['jobs'][number] | null {
  const robot = activeRobot(context)
  const jobId = activeJobIdV4(context.interaction.getState())
  if (robot === null || jobId === null) return null
  const job = context.project.jobs.find((candidate) => candidate.id === jobId)
  return job?.robotId === robot.id ? job : null
}

function activeRobotReason(context: AppCommandCompositionContextV4): string | undefined {
  return activeRobot(context) === null ? 'No active Robot.' : undefined
}

function activeJobReason(context: AppCommandCompositionContextV4): string | undefined {
  return activeRobotReason(context) ?? (activeJob(context) === null ? 'No active Job for the active Robot.' : undefined)
}

function projectReason(context: AppCommandCompositionContextV4, needsActive: boolean): string | undefined {
  if (context.projectState.status === 'recovery-required') return 'Reload is required before Project commands can run.'
  if (PROJECT_BUSY_STATUSES.has(context.projectState.status)) return 'Project operation is in progress.'
  return needsActive && context.projectState.activeProject === null ? 'No active Project.' : undefined
}

function selectedSceneOrNull(context: AppCommandCompositionContextV4): SceneSelectionTargetV4 | null {
  const state = context.interaction.getState()
  const target = resolveSceneContextTargetV4(context.project, state.projectRevisionId, state.selection)
  return target.kind === 'stale' || target.kind === 'empty' ? null : target.selection
}

function projectCommand(
  context: AppCommandCompositionContextV4,
  id: string,
  label: string,
  needsActive: boolean,
  execute: () => void | Promise<void | 'cancelled'>,
  shortcut?: string,
): AppCommandV4 {
  return command(id, label, 'project', {
    kind: 'action', visible: true,
    get enabled() { return projectReason(context, needsActive) === undefined },
    get disabledReason() { return projectReason(context, needsActive) },
    ...(shortcut === undefined ? {} : { shortcut }), execute,
  })
}

function contextualPresentation(context: AppCommandCompositionContextV4): SceneCommandPresentationPortV4 {
  return Object.freeze({
    openRobotBase: context.actions.presentation.openRobotBase,
    openInspector: context.actions.presentation.openInspector,
  })
}

function activeRobotCommand(
  context: AppCommandCompositionContextV4,
  id: string,
  label: string,
  execute: (robotId: RobotIdV4) => void | Promise<void>,
  canExecute?: (robotId: RobotIdV4) => boolean,
): AppCommandV4 {
  const available = (): boolean => {
    const robot = activeRobot(context)
    return robot !== null && (canExecute?.(robot.id) ?? true)
  }
  return command(id, label, 'home', {
    kind: 'action', visible: true,
    get enabled() { return available() },
    get disabledReason() { return activeRobotReason(context) ?? (available() ? undefined : 'No active Robot.') },
    execute() { const robot = activeRobot(context); if (robot === null || !available()) throw new Error(activeRobotReason(context) ?? 'No active Robot.'); return execute(robot.id) },
  })
}

function activeJobCommand(
  context: AppCommandCompositionContextV4,
  id: string,
  label: string,
  execute: (robotId: RobotIdV4, jobId: string) => void | Promise<void | 'cancelled'>,
  canExecute?: (robotId: RobotIdV4, jobId: string) => boolean,
  destructive = false,
): AppCommandV4 {
  const available = (): boolean => {
    const robot = activeRobot(context); const job = activeJob(context)
    return robot !== null && job !== null && (canExecute?.(robot.id, job.id) ?? true)
  }
  return command(id, label, 'job', {
    kind: 'action', visible: true, ...(destructive ? { destructive: true } : {}),
    get enabled() { return available() },
    get disabledReason() { return activeJobReason(context) ?? (available() ? undefined : 'No active Job for the active Robot.') },
    execute() { const robot = activeRobot(context); const job = activeJob(context); if (robot === null || job === null || !available()) throw new Error(activeJobReason(context) ?? 'No active Job for the active Robot.'); return execute(robot.id, job.id) },
  })
}

export function composeAppCommandsV4(context: AppCommandCompositionContextV4): AppCommandRegistryV4 {
  const commands: AppCommandV4[] = [
    projectCommand(context, 'project.new', 'New Project', false, () => context.actions.project.newProject()),
    projectCommand(context, 'project.save', 'Save Project', true, () => context.actions.project.saveProject(), 'Ctrl+S'),
    projectCommand(context, 'project.import', 'Import Project', false, () => context.actions.project.importProject()),
    projectCommand(context, 'project.export', 'Export Project', true, () => context.actions.project.exportProject()),
    projectCommand(context, 'project.sample.dual', 'Dual-Robot Technical Demo', true, () => context.actions.project.loadDualRobotSample()),
    ...composeSceneContextCommandsV4({ project: context.project, interaction: context.interaction, scene: context.scene, prompt: context.prompt, presentation: contextualPresentation(context) }),
    activeRobotCommand(context, 'robot.home', 'Robot Home', (robotId) => context.robotOperator.home(robotId), (robotId) => context.robotOperator.canHome(robotId)),
    activeRobotCommand(context, 'robot.gripper.open', 'Open Gripper', (robotId) => context.robotOperator.setGripper(robotId, 'OPEN')),
    activeRobotCommand(context, 'robot.gripper.close', 'Close Gripper', (robotId) => context.robotOperator.setGripper(robotId, 'CLOSED')),
    command('job.new', 'New Job', 'job', {
      kind: 'action', visible: true,
      get enabled() { const robot = activeRobot(context); return robot !== null && context.jobOperator.canAuthor(robot.id) },
      get disabledReason() {
        const robot = activeRobot(context)
        return activeRobotReason(context) ?? (
          robot !== null && !context.jobOperator.canAuthor(robot.id)
            ? 'Job authoring is unavailable while this Robot is running or stale.'
            : undefined
        )
      },
      async execute() {
        const robot = activeRobot(context)
        if (robot === null || !context.jobOperator.canAuthor(robot.id)) {
          throw new Error(activeRobotReason(context) ?? 'Job authoring is unavailable while this Robot is running or stale.')
        }
        const name = await context.prompt.requestText({ title: 'Job name', initialValue: 'Job', required: true })
        if (name === null) return 'cancelled'
        const id = await context.jobs.createJob(robot.id, name.trim())
        context.interaction.getState().selectJob(robot.id, id)
      },
    }),
    activeJobCommand(context, 'job.pose.save', 'Save Current Pose', (robotId, jobId) => context.robotOperator.savePose(robotId, jobId), (robotId, jobId) => context.robotOperator.canSavePose(robotId, jobId)),
    activeJobCommand(context, 'job.start', 'Start Job', (robotId, jobId) => context.jobOperator.start(robotId, jobId), (robotId, jobId) => context.jobOperator.canStart(robotId, jobId)),
    command('job.cancel', 'Cancel Active Robot Job', 'job', {
      kind: 'action', visible: true,
      get enabled() { const robot = activeRobot(context); return robot !== null && context.jobOperator.canCancel(robot.id) },
      get disabledReason() { const robot = activeRobot(context); return robot !== null && context.jobOperator.canCancel(robot.id) ? undefined : activeRobotReason(context) ?? 'No active Job for the active Robot.' },
      execute() { const robot = activeRobot(context); if (robot === null || !context.jobOperator.canCancel(robot.id)) throw new Error(activeRobotReason(context) ?? 'No active Job for the active Robot.'); return context.jobOperator.cancel(robot.id) },
    }),
    activeJobCommand(context, 'job.rename', 'Rename Job', async (_robotId, jobId) => { const job = activeJob(context); if (job === null || job.id !== jobId) throw new Error('No active Job for the active Robot.'); const name = await context.prompt.requestText({ title: 'Job name', initialValue: job.name, required: true }); if (name === null) return 'cancelled'; await context.jobs.renameJob(jobId, name.trim()) }, (robotId) => context.jobOperator.canAuthor(robotId)),
    activeJobCommand(context, 'job.duplicate', 'Duplicate Job', async (robotId, jobId) => { const duplicate = await context.jobs.duplicateJob(jobId); context.interaction.getState().selectJob(robotId, duplicate) }, (robotId) => context.jobOperator.canAuthor(robotId)),
    activeJobCommand(context, 'job.delete', 'Delete Job', (_robotId, jobId) => context.jobs.deleteJob(jobId), (robotId) => context.jobOperator.canAuthor(robotId), true),
    command('view.timeline.open', 'Open Timeline', 'job', { kind: 'action', visible: true, enabled: true, execute: () => context.actions.presentation.openTimeline() }),
    command('collision.validate', 'Validate Geometry Collision', 'simulation', {
      kind: 'action', visible: true,
      get enabled() { return context.collision.getState().canValidate },
      get disabledReason() { return context.collision.getState().canValidate ? undefined : 'Collision validation is unavailable while a Job is running or no visible Geometry exists.' },
      execute: () => context.collision.validate(),
    }),
    command('view.collision.open', 'Open Collision Findings', 'simulation', { kind: 'action', visible: true, enabled: true, execute: () => context.actions.presentation.openCollision(selectedSceneOrNull(context)) }),
    command('connectivity.mode.off', 'Off', 'connectivity', { kind: 'radio', visible: true, enabled: true, groupId: 'connectivity.runtime-mode', get checked() { return context.project.opcUa.mode === 'off' }, execute: () => context.actions.connectivity.setMode('off') }),
    command('connectivity.mode.client', 'OPC UA Client', 'connectivity', { kind: 'radio', visible: true, enabled: true, groupId: 'connectivity.runtime-mode', get checked() { return context.project.opcUa.mode === 'client' }, execute: () => context.actions.connectivity.setMode('client') }),
    command('connectivity.mode.server', 'OPC UA Server', 'connectivity', { kind: 'radio', visible: true, enabled: true, groupId: 'connectivity.runtime-mode', get checked() { return context.project.opcUa.mode === 'server' }, execute: () => context.actions.connectivity.setMode('server') }),
    command('connectivity.mode.bridge', 'OPC UA Bridge', 'connectivity', { kind: 'radio', visible: true, enabled: true, groupId: 'connectivity.runtime-mode', get checked() { return context.project.opcUa.mode === 'bridge' }, execute: () => context.actions.connectivity.setMode('bridge') }),
    command('connectivity.details.open', 'Gateway Details', 'connectivity', { kind: 'action', visible: true, enabled: true, execute: () => context.actions.presentation.openGatewayDetails() }),
  ]

  const dock = (id: string, label: string, name: 'sidebar' | 'inspector' | 'bottom'): void => {
    commands.push(command(id, label, 'view', {
      kind: 'toggle', visible: true,
      get enabled() { return true }, get checked() { return context.shellLayoutController.getState().isDockVisible(name) },
      execute() { const current = context.shellLayoutController.getState().isDockVisible(name); context.shellLayoutController.setDockVisible(name, !current) },
    }))
  }
  dock('view.sidebar', 'Scene and Job Sidebar', 'sidebar')
  dock('view.inspector', 'Inspector', 'inspector')
  dock('view.bottom', 'Bottom Workspace', 'bottom')
  commands.push(command('view.ribbon', 'Ribbon Lite', 'view', { kind: 'toggle', visible: true, enabled: true, get checked() { return context.shellLayoutController.getState().isRibbonExpanded() }, execute() { const current = context.shellLayoutController.getState().isRibbonExpanded(); context.shellLayoutController.setRibbonExpanded(!current) } }))
  commands.push(command('view.layout.reset', 'Reset Layout', 'view', { kind: 'action', visible: true, enabled: true, execute: () => context.shellLayoutController.resetLayout() }))

  for (const theme of ['system', 'light', 'dark'] as const) {
    commands.push(command(`view.theme.${theme}`, theme[0]!.toUpperCase() + theme.slice(1), 'view', {
      kind: 'radio', visible: true, enabled: true, groupId: 'view.theme',
      get checked() { return context.shellLayoutController.getState().preferences.theme === theme },
      execute: () => context.shellLayoutController.setTheme(theme),
    }))
  }
  const layers = [
    ['grid', 'Grid', 'grid'], ['world', 'World Frame', 'worldFrame'], ['mcp', 'MCP Frame', 'mcpFrame'], ['base', 'Robot Base Frame', 'baseFrame'], ['tcp', 'TCP Frame', 'tcpFrame'],
  ] as const
  for (const [id, label, layer] of layers) {
    commands.push(command(`view.layer.${id}`, label, 'view', {
      kind: 'toggle', visible: true, enabled: true,
      get checked() { return context.viewportPreferences.getState().layers[layer] },
      execute() { const current = context.viewportPreferences.getState().layers[layer]; context.viewportPreferences.getState().setLayer(layer, !current) },
    }))
  }
  commands.push(command('view.home', 'Home View', 'view', { kind: 'action', visible: true, enabled: true, shortcut: 'H', execute: () => context.camera.home() }))
  commands.push(command('view.fitAll', 'Fit All', 'view', { kind: 'action', visible: true, enabled: true, execute: () => context.camera.fitAll() }))
  commands.push(command('view.focusSelection', 'Focus Selection', 'view', {
    kind: 'action', visible: true, shortcut: 'F',
    get enabled() { return context.camera.canFocusSelection() },
    get disabledReason() { return context.camera.canFocusSelection() ? undefined : 'Select a focusable Scene item.' },
    // The camera port repeats its revision/selection preflight at execution
    // time, so a registry captured before a Project replacement cannot report
    // a completed focus request that the current Scene would discard.
    execute() { context.camera.focusSelection() },
  }))
  const views: readonly (readonly [StandardWorldView, string])[] = [
    ['isometric', 'Isometric'], ['top', 'Top'], ['front', 'Front'], ['right', 'Right'], ['back', 'Back'], ['left', 'Left'], ['bottom', 'Bottom'],
  ]
  for (const [view, label] of views) commands.push(command(`view.orientation.${view}`, label, 'view', { kind: 'action', visible: true, enabled: true, execute: () => context.camera.setStandardView(view) }))

  const helpTopics: readonly (readonly [LocalHelpTopicV4, string, string])[] = [
    ['controls', 'help.controls', 'Keyboard and Mouse Controls'], ['stepImport', 'help.stepImport', 'STEP Import Guide'], ['opcUaMapping', 'help.opcUaMapping', 'OPC UA Mapping Guide'], ['about', 'help.about', 'About'],
  ]
  for (const [topic, id, label] of helpTopics) if (context.help.hasTopic(topic)) {
    commands.push(command(id, label, 'help', { kind: 'action', visible: true, enabled: true, execute: () => context.help.open(topic) }))
  }
  return createAppCommandRegistryV4(commands)
}
