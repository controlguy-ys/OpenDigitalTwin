import { validateWorkcellProjectV5 } from '../../core/project-v5/index.js'
import type { BrowserProjectApplicationResourcesV5 } from '../../features/project/v5/browser-project-resources-v5.js'
import {
  LOGICAL_IO_JOB_SAMPLE_IDS_V5,
  createLogicalIoJobSampleV5,
} from '../../features/project/v5/logical-io-job-sample-v5.js'
import type { V6WorkcellSelection } from '../../features/interaction/v6/workcell-selection-v6.js'
import type { DialogRequestV6 } from '../../features/ui/v6/dialog-request-v6.js'
import type { WorkspaceLayoutStoreV6 } from '../../features/ui/v6/workspace-layout-store-v6.js'
import {
  createAppCommandRegistryV6,
  createMainViewMaximizeCommandV6,
  type AppCommandSnapshotV6,
  type AppCommandRegistryV6,
} from '../../features/commands/v6/app-command-v6.js'

export interface AppCommandCompositionContextV6 {
  readonly resources: BrowserProjectApplicationResourcesV5
  readonly selection: V6WorkcellSelection | null
  readonly setSelection: (selection: V6WorkcellSelection | null) => void
  readonly layout: WorkspaceLayoutStoreV6
  readonly openDialog: (dialog: DialogRequestV6) => void
  readonly setInteractionMode: (mode: 'select' | 'translate' | 'rotate') => void
  readonly createEntityId?: () => string
}

function projectIsReady(context: AppCommandCompositionContextV6): boolean {
  return context.resources.store.getState().status === 'ready'
}

function activeProject(context: AppCommandCompositionContextV6) {
  return context.resources.store.getState().activeProject
}

function createPrimitiveCommand(
  context: AppCommandCompositionContextV6,
  kind: 'box' | 'cylinder',
): AppCommandSnapshotV6 {
  const label = kind === 'box' ? 'Add Box' : 'Add Cylinder'
  return {
    id: kind === 'box' ? 'model.addBox' : 'model.addCylinder',
    label,
    get enabled() {
      return projectIsReady(context) && context.resources.mutations.readPublished() !== null
    },
    visible: true,
    async execute() {
      const published = context.resources.mutations.readPublished()
      if (published === null) throw new Error('No published Project V5 revision is active.')
      const id = context.createEntityId?.() ?? `entity-${crypto.randomUUID()}`
      await context.resources.mutations.mutate({
        expectedRevisionId: published.revisionId,
        description: `Add ${kind}`,
        recipe: (candidate) => ({
          ...candidate,
          spatialEntities: [...candidate.spatialEntities, {
            id,
            name: kind === 'box' ? 'Box' : 'Cylinder',
            geometry: kind === 'box'
              ? { kind: 'box', dimensionsM: [0.2, 0.2, 0.2], color: '#38bdf8' }
              : { kind: 'cylinder', radiusM: 0.1, heightM: 0.25, axis: 'z', radialSegments: 32, color: '#f59e0b' },
            parentFrameId: 'mcp',
            localPose: { positionM: [0, 0, kind === 'box' ? 0.1 : 0.125], quaternion: [0, 0, 0, 1] },
            visible: true,
            groupId: null,
            removable: true,
            transformOwner: 'manual',
            numericStatus: { value: 0, sourceOwnership: 'manual', overlay: { visible: true, frameId: null } },
            graspable: false,
            graspFrames: [],
            movingFrames: [],
          }],
        }),
      })
      context.setSelection({ kind: 'entity', id })
    },
  }
}

function createLoadDemoCommand(context: AppCommandCompositionContextV6): AppCommandSnapshotV6 {
  return {
    id: 'project.loadDemo',
    label: 'Load Demo',
    get enabled() { return projectIsReady(context) },
    visible: true,
    async execute() {
      const nowIso = new Date().toISOString()
      const source = createLogicalIoJobSampleV5({
        projectId: crypto.randomUUID(), revisionId: crypto.randomUUID(), nowIso,
      })
      const candidate = validateWorkcellProjectV5({
        ...source,
        metadata: { ...source.metadata, name: 'Project V5 Robot Job Demo' },
        spatialEntities: source.spatialEntities.map((entity) => entity.id === LOGICAL_IO_JOB_SAMPLE_IDS_V5.partEntityId
          ? { ...entity, localPose: { positionM: [0, 0, 0], quaternion: [0, 0, 0, 1] } }
          : entity),
        logicalSignals: source.logicalSignals.map((signal) => signal.id === LOGICAL_IO_JOB_SAMPLE_IDS_V5.partPresentSignalId
          ? { ...signal, initialValue: true }
          : signal),
        jobs: source.jobs.map((job) => ({
          ...job,
          instructions: job.instructions.map((instruction) => instruction.kind === 'attach'
            ? { ...instruction, maximumDistanceM: 1 }
            : instruction),
        })),
        opcUa: { mode: 'off', endpoints: [], mappings: [], bridgeRoutes: [] },
      })
      await context.resources.mutations.replace({ candidate, description: 'Load Project V5 Demo' })
    },
  }
}

export function createAppCommandCompositionV6(
  context: AppCommandCompositionContextV6,
): AppCommandRegistryV6 {
  const command = (
    id: AppCommandSnapshotV6['id'],
    label: string,
    execute: () => void | Promise<void>,
    enabled: () => boolean = () => true,
  ): AppCommandSnapshotV6 => ({ id, label, get enabled() { return enabled() }, visible: true, execute })
  const themeCommand = (
    id: 'view.theme.system' | 'view.theme.dark' | 'view.theme.light',
    label: string,
    theme: 'system' | 'dark' | 'light',
  ): AppCommandSnapshotV6 => ({
    id,
    label,
    enabled: true,
    visible: true,
    get checked() { return context.layout.getState().preferences.theme === theme },
    execute: () => context.layout.getState().setTheme(theme),
  })
  const commands: readonly AppCommandSnapshotV6[] = [
    command('project.new', 'New Project', () => context.resources.store.getState().newProject(), () => projectIsReady(context)),
    createLoadDemoCommand(context),
    command('project.save', 'Save', async () => { await context.resources.store.getState().saveActiveProject() }, () => projectIsReady(context) && activeProject(context) !== null),
    command('project.export', 'Export', async () => {
      const project = activeProject(context)
      if (project === null) throw new Error('No active Project V5 is available to export.')
      const blob = await context.resources.store.getState().exportActiveProject()
      context.resources.files.downloadProject(blob, { name: project.metadata.name, projectId: project.projectId })
    }, () => projectIsReady(context) && activeProject(context) !== null),
    command('project.import', 'Import', async () => {
      const file = await context.resources.files.pickProject()
      if (file !== null) await context.resources.store.getState().importProject(file)
    }, () => projectIsReady(context)),
    command('tool.select', 'Select', () => context.setInteractionMode('select')),
    command('tool.translate', 'Translate', () => context.setInteractionMode('translate')),
    command('tool.rotate', 'Rotate', () => context.setInteractionMode('rotate')),
    createPrimitiveCommand(context, 'box'),
    createPrimitiveCommand(context, 'cylinder'),
    createMainViewMaximizeCommandV6({
      isMainViewMaximized: () => context.layout.getState().mainViewPresentation === 'maximized',
      toggleMainView: () => context.layout.getState().toggleMainViewMaximized(),
    }),
    command('view.layout.reset', 'Reset Layout', () => context.layout.getState().resetLayout()),
    themeCommand('view.theme.system', 'System Theme', 'system'),
    themeCommand('view.theme.dark', 'Dark Theme', 'dark'),
    themeCommand('view.theme.light', 'Light Theme', 'light'),
    command('help.controls', 'Controls', () => context.openDialog({ kind: 'help', topic: 'controls' }), () => true),
    command('help.about', 'About', () => context.openDialog({ kind: 'help', topic: 'about' }), () => true),
  ]
  return createAppCommandRegistryV6(commands)
}
