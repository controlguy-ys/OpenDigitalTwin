import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type MouseEvent,
  type ReactNode,
} from 'react'
import { Circle } from 'lucide-react'
import { useStore } from 'zustand'

import type { OpcUaProjectTargetV5 } from '../../core/project-v5/index.js'
import { BindingEditorDialogV1 } from '../../features/connectivity/v5/BindingEditorDialog.js'
import { BindingOverviewDialogV1 } from '../../features/connectivity/v5/BindingOverviewDialog.js'
import { ConnectionMonitorPanel, type ConnectionMonitorPanelControlV1 } from '../../features/connectivity/v5/ConnectionMonitorPanel.js'
import { DockerRunGuideDialogV1 } from '../../features/connectivity/v5/DockerRunGuideDialog.js'
import { OpcUaSettingsDialog } from '../../features/connectivity/v5/OpcUaSettingsDialog.js'
import type { V6WorkcellSelection } from '../../features/interaction/v6/workcell-selection-v6.js'
import { SelectionInspectorV6 } from '../../features/inspector/v6/SelectionInspectorV6.js'
import { createJobAuthoringServiceV6 } from '../../features/jobs/v6/job-authoring-service-v6.js'
import { RobotJobEditorDialogV6 } from '../../features/jobs/v6/RobotJobEditorDialogV6.js'
import { RobotJobMonitorV6 } from '../../features/jobs/v6/RobotJobMonitorV6.js'
import {
  createBrowserProjectApplicationResourcesV5,
  type BrowserProjectApplicationResourcesV5,
} from '../../features/project/v5/browser-project-resources-v5.js'
import { createSceneCommandServiceV6 } from '../../features/scene/v6/scene-command-service-v6.js'
import { SceneContextMenuV6, resolveSceneContextTargetV6, type SceneContextActionIdV6, type SceneContextTargetV6 } from '../../features/scene/v6/SceneContextMenuV6.js'
import { SceneExplorerV6 } from '../../features/scene/v6/SceneExplorerV6.js'
import { V5WorkcellCanvas } from '../../features/scene/v5/V5WorkcellWorkspace.js'
import { AppMenuBarV6 } from '../../features/ui/v6/AppMenuBarV6.js'
import { ApplicationShellV6 } from '../../features/ui/v6/ApplicationShellV6.js'
import { ConnectivityMenuV6 } from '../../features/connectivity/v6/ConnectivityMenuV6.js'
import { HeaderStatusV6 } from '../../features/ui/v6/HeaderStatusV6.js'
import { HelpOverlayV6 } from '../../features/ui/v6/HelpOverlayV6.js'
import { ModelToolboxV6 } from '../../features/ui/v6/ModelToolboxV6.js'
import { createWorkspaceLayoutStoreV6 } from '../../features/ui/v6/workspace-layout-store-v6.js'
import { createCameraControllerV6 } from '../../features/viewport/v6/camera-controller-v6.js'
import { ViewportOverlayV6 } from '../../features/viewport/v6/ViewportOverlayV6.js'
import { WorkcellViewportV6 } from '../../features/viewport/v6/WorkcellViewportV6.js'
import { createInitialProjectBootstrapV5 } from '../v5/initial-project-bootstrap-v5.js'
import { createAppCommandCompositionV6 } from './app-command-composition-v6.js'
import { errorMessageV6, initialJobIdV6, selectedTargetV6, useViewportBoundsV6 } from './app-v6-support.js'

export interface AppV6Props {
  readonly resources?: BrowserProjectApplicationResourcesV5
}

export function AppV6({ resources: injectedResources }: AppV6Props): ReactNode {
  const resources = useMemo(() => injectedResources ?? createBrowserProjectApplicationResourcesV5(), [injectedResources])
  const projectState = useStore(resources.store)
  const connectivity = useSyncExternalStore(resources.connectivity.subscribe, resources.connectivity.getState, resources.connectivity.getState)
  const bundle = useSyncExternalStore(resources.runtime.bundle.subscribe, resources.runtime.bundle.readActiveState, resources.runtime.bundle.readActiveState)
  const [settingsState, setSettingsState] = useState(() => resources.settings.getState())
  const [selection, setSelection] = useState<V6WorkcellSelection | null>(null)
  const [jobId, setJobId] = useState<string | null>(() => initialJobIdV6(projectState.activeProject))
  const [operationError, setOperationError] = useState<string | null>(null)
  const [interactionMode, setInteractionMode] = useState<'select' | 'translate' | 'rotate'>('select')
  const [contextTarget, setContextTarget] = useState<SceneContextTargetV6 | null>(null)
  const [cameraVersion, setCameraVersion] = useState(0)
  const monitorRef = useRef<ConnectionMonitorPanelControlV1>(null)
  const lifecycleGenerationRef = useRef(0)
  const layout = useMemo(() => createWorkspaceLayoutStoreV6({ storage: window.localStorage }), [])
  const bootstrap = useMemo(() => createInitialProjectBootstrapV5(resources.store), [resources.store])
  const viewportBounds = useViewportBoundsV6()

  useEffect(() => resources.settings.subscribe(() => setSettingsState(resources.settings.getState())), [resources.settings])
  useEffect(() => {
    setSelection(null)
  }, [bundle?.runtimeEpoch])
  useEffect(() => {
    const project = bundle?.project ?? projectState.activeProject
    setJobId((current) => current !== null && project?.jobs.some((job) => job.id === current) ? current : initialJobIdV6(project))
  }, [bundle?.project, projectState.activeProject])
  useEffect(() => {
    document.documentElement.dataset.theme = layout.getState().preferences.theme
    return layout.subscribe(() => { document.documentElement.dataset.theme = layout.getState().preferences.theme })
  }, [layout])
  useEffect(() => {
    lifecycleGenerationRef.current += 1
    let active = true
    resources.connectivity.startHeader()
    void bootstrap.run(() => active).then(() => {
      if (active && resources.runtime.readActiveBundle() !== null) resources.runtime.startGatewayStream()
    }, (error: unknown) => {
      if (active) setOperationError(errorMessageV6(error))
    })
    return () => {
      active = false
      const cleanupGeneration = ++lifecycleGenerationRef.current
      queueMicrotask(() => {
        if (lifecycleGenerationRef.current === cleanupGeneration) void resources.dispose()
      })
    }
  }, [bootstrap, resources])

  const workspaceProject = bundle?.project ?? projectState.activeProject
  const selectedJob = workspaceProject?.jobs.find((job) => job.id === jobId) ?? null
  const sceneCommands = useMemo(() => createSceneCommandServiceV6({
    mutations: resources.mutations,
    createId: () => `entity-${crypto.randomUUID()}`,
    onSelectionChange: setSelection,
  }), [resources.mutations])
  const jobAuthoring = useMemo(() => bundle === null ? null : createJobAuthoringServiceV6({
    mutations: resources.mutations,
    runtime: bundle.runtimeGraph.jobs,
  }), [bundle, resources.mutations])
  const registry = useMemo(() => createAppCommandCompositionV6({
    resources,
    selection,
    setSelection,
    layout,
    openDialog: (request) => layout.getState().requestDialog(request),
    setInteractionMode,
  }), [layout, resources, selection])
  const camera = useMemo(() => createCameraControllerV6({
    camera: { position: [3.2, -4.2, 2.8], target: [0, 0, 0] },
    home: { position: [3.2, -4.2, 2.8], target: [0, 0, 0] },
    visibleBounds: () => null,
    selectionBounds: () => null,
    update: () => setCameraVersion((version) => version + 1),
  }), [])
  void cameraVersion

  const openBinding = useCallback((target: OpcUaProjectTargetV5, mappingId?: string) => {
    layout.getState().requestDialog({
      kind: 'binding-editor',
      target,
      ...(mappingId === undefined ? {} : { mappingId }),
    })
  }, [layout])
  const browseSessionAvailable = useCallback((endpointId: string) => (
    connectivity.status?.opcUa.clientEndpoints.some((endpoint) => endpoint.endpointId === endpointId && endpoint.sessionActive) ?? false
  ), [connectivity.status])
  const runSceneContextAction = useCallback((action: SceneContextActionIdV6, target: SceneContextTargetV6) => {
    setContextTarget(null)
    if (workspaceProject === null) return
    if (action === 'open-binding') {
      const bindingTarget = target.kind === 'empty' ? null : selectedTargetV6(workspaceProject, target.selection)
      if (bindingTarget !== null) openBinding(bindingTarget)
      return
    }
    if (action === 'toggle-visibility' && (target.kind === 'robot' || target.kind === 'object' || target.kind === 'group')) {
      const visible = target.kind === 'robot'
        ? !workspaceProject.robots.find((robot) => robot.id === target.id)?.visible
        : target.kind === 'object'
          ? !workspaceProject.spatialEntities.find((entity) => entity.id === target.id)?.visible
          : !workspaceProject.sceneGroups.find((group) => group.id === target.id)?.visible
      const selection = target.kind === 'robot'
        ? { kind: 'robot' as const, id: target.id }
        : target.kind === 'object'
          ? { kind: 'entity' as const, id: target.id }
          : { kind: 'group' as const, id: target.id }
      void sceneCommands.setVisibility(selection, visible).catch((error: unknown) => setOperationError(errorMessageV6(error)))
      return
    }
    if (action === 'duplicate' && target.kind === 'object') {
      void sceneCommands.duplicateEntity(target.id).catch((error: unknown) => setOperationError(errorMessageV6(error)))
      return
    }
    if (action === 'delete' && target.kind === 'object') {
      void sceneCommands.deleteEntity(target.id).catch((error: unknown) => setOperationError(errorMessageV6(error)))
      return
    }
    if (action === 'delete' && target.kind === 'group') {
      void sceneCommands.deleteGroup(target.id).catch((error: unknown) => setOperationError(errorMessageV6(error)))
      return
    }
    if (action === 'add-box' || action === 'add-cylinder' || action === 'fit-all') {
      const commandId = action === 'add-box' ? 'model.addBox' : action === 'add-cylinder' ? 'model.addCylinder' : 'view.fitAll'
      void registry.invoke(commandId).catch((error: unknown) => setOperationError(errorMessageV6(error)))
    }
  }, [openBinding, registry, sceneCommands, workspaceProject])
  const requestViewportContext = useCallback((event: MouseEvent<HTMLDivElement>) => {
    event.preventDefault()
    if (workspaceProject === null) return
    setContextTarget(resolveSceneContextTargetV6(workspaceProject, selection))
  }, [selection, workspaceProject])
  const dialog = useSyncExternalStore(layout.subscribe, () => layout.getState().openDialog, () => layout.getState().openDialog)

  const header = <div className="v6-app-header">
    <strong>OpenDigitalTwin</strong>
    <AppMenuBarV6 registry={registry} />
    <ConnectivityMenuV6
      onOpenBindingOverview={() => layout.getState().requestDialog({ kind: 'binding-overview' })}
      onOpenConnectionMonitor={(opener) => monitorRef.current?.open(opener)}
      onOpenDockerRunGuide={() => layout.getState().requestDialog({ kind: 'docker-guide' })}
      onOpenOpcUaSettings={() => {
        if (projectState.activeProject !== null) resources.settings.open(projectState.activeProject)
        layout.getState().requestDialog({ kind: 'opcua-settings' })
      }}
      projectAvailable={projectState.activeProject !== null}
    />
    <HeaderStatusV6
      connectivity={connectivity}
      projectName={workspaceProject?.metadata.name ?? 'Loading Project'}
      saveState={projectState.status === 'error' ? 'Error' : projectState.status === 'loading' ? 'Saving' : 'Saved'}
      simulation={{ icon: Circle, label: `Tool ${interactionMode}`, state: 'neutral' }}
    />
  </div>

  const viewport = workspaceProject === null
    ? <div className="v6-loading" role="status">{projectState.error ?? 'Preparing Project V5 runtime.'}</div>
    : <WorkcellViewportV6
      canvas={<V5WorkcellCanvas bundle={bundle} onSelect={setSelection} project={workspaceProject} selection={selection?.kind === 'robot' || selection?.kind === 'entity' ? selection : null} />}
      layoutStore={layout}
      onContextMenu={requestViewportContext}
      overlay={<ViewportOverlayV6 camera={camera} />}
      registry={registry}
    />

  return <div className="v6-app-root">
    {operationError !== null && <div className="v6-operation-error" role="alert">{operationError}</div>}
    <ApplicationShellV6
      bottom={workspaceProject === null || selectedJob === null ? <section aria-label="Job monitor">No Jobs in this Project.</section> : bundle === null ? <RobotJobMonitorV6
        jobId={selectedJob.id}
        onOpenEditor={() => layout.getState().requestDialog({ kind: 'job-editor', jobId: selectedJob.id })}
        project={workspaceProject}
      /> : <RobotJobMonitorV6
        jobId={selectedJob.id}
        onOpenEditor={() => layout.getState().requestDialog({ kind: 'job-editor', jobId: selectedJob.id })}
        playback={bundle.runtimeGraph.playback}
        project={workspaceProject}
        runtime={bundle.runtimeGraph.jobs}
      />}
      explorer={workspaceProject === null ? null : <SceneExplorerV6
        onContextMenu={setContextTarget}
        onSelectionChange={setSelection}
        onToggleVisibility={(nextSelection, visible) => { void sceneCommands.setVisibility(nextSelection, visible).catch((error: unknown) => setOperationError(errorMessageV6(error))) }}
        project={workspaceProject}
        selection={selection}
      />}
      header={header}
      inspector={workspaceProject === null ? null : <SelectionInspectorV6
        mutations={resources.mutations}
        onOpenBinding={openBinding}
        project={workspaceProject}
        runtime={bundle === null ? undefined : { robots: bundle.runtimeGraph.robots, jobs: bundle.runtimeGraph.jobs }}
        selection={selection}
      />}
      store={layout}
      toolbox={<ModelToolboxV6 registry={registry} />}
      viewport={viewport}
      workspaceHeightPx={viewportBounds.height}
      workspaceWidthPx={viewportBounds.width}
    />
    {contextTarget !== null && <SceneContextMenuV6 onAction={runSceneContextAction} surface="viewport" target={contextTarget} />}
    <ConnectionMonitorPanel controlRef={monitorRef} showTrigger={false} store={resources.connectivity} />
    {workspaceProject !== null && dialog?.kind === 'opcua-settings' && settingsState.open && <OpcUaSettingsDialog
      activeProject={workspaceProject}
      connectionTest={resources.connectionTest}
      controller={resources.settings}
      onOpenBindingOverview={() => layout.getState().requestDialog({ kind: 'binding-overview' })}
      onOpenDockerRunGuide={() => layout.getState().requestDialog({ kind: 'docker-guide' })}
      presentation={connectivity}
    />}
    {workspaceProject !== null && dialog?.kind === 'binding-overview' && <BindingOverviewDialogV1 activeProject={workspaceProject} onClose={() => layout.getState().closeDialog()} onEdit={openBinding} />}
    {workspaceProject !== null && dialog?.kind === 'binding-editor' && <BindingEditorDialogV1
      activeProject={workspaceProject}
      addressSpaceBrowsePort={resources.gateway}
      browseSessionAvailable={browseSessionAvailable}
      {...(dialog.mappingId === undefined ? {} : { mappingId: dialog.mappingId })}
      mutations={resources.mutations}
      nodeAddressResolver={resources.nodeAddressResolver}
      onClose={() => layout.getState().closeDialog()}
      onSaved={() => layout.getState().closeDialog()}
      target={dialog.target}
    />}
    {dialog?.kind === 'docker-guide' && <DockerRunGuideDialogV1 onClose={() => layout.getState().closeDialog()} status={connectivity.status} />}
    {workspaceProject !== null && dialog?.kind === 'job-editor' && jobAuthoring !== null && bundle !== null && <RobotJobEditorDialogV6 authoring={jobAuthoring} jobId={dialog.jobId} onClose={() => layout.getState().closeDialog()} project={workspaceProject} runtime={bundle.runtimeGraph.jobs} />}
    <HelpOverlayV6 onClose={() => layout.getState().closeDialog()} request={dialog?.kind === 'help' ? dialog : null} />
  </div>
}
