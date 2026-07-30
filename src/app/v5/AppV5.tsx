import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react'
import { useStore } from 'zustand'
import { createStore } from 'zustand/vanilla'

import {
  quaternionToRpyDegreesV5,
  rpyDegreesToQuaternionV5,
  validateWorkcellProjectV5,
  type OpcUaProjectTargetV5,
  type SpatialEntityV5,
  type WorkcellProjectV5,
} from '../../core/project-v5/index.js'
import { BindingEditorDialogV1 } from '../../features/connectivity/v5/BindingEditorDialog.js'
import { BindingOverviewDialogV1 } from '../../features/connectivity/v5/BindingOverviewDialog.js'
import { ConnectionMonitorPanel, type ConnectionMonitorPanelControlV1 } from '../../features/connectivity/v5/ConnectionMonitorPanel.js'
import { DockerRunGuideDialogV1 } from '../../features/connectivity/v5/DockerRunGuideDialog.js'
import { OpcUaSettingsDialog } from '../../features/connectivity/v5/OpcUaSettingsDialog.js'
import { RobotJobWorkspaceV5 } from '../../features/jobs/v5/RobotJobWorkspaceV5.js'
import {
  createBrowserProjectApplicationResourcesV5,
  type BrowserProjectApplicationResourcesV5,
} from '../../features/project/v5/browser-project-resources-v5.js'
import { createLogicalIoJobSampleV5, LOGICAL_IO_JOB_SAMPLE_IDS_V5 } from '../../features/project/v5/logical-io-job-sample-v5.js'
import type { ProjectV5MutationService } from '../../features/project/v5/project-v5-mutation-service.js'
import { V5WorkcellWorkspace, type V5WorkcellSelection } from '../../features/scene/v5/V5WorkcellWorkspace.js'
import type { RobotJointRuntimeStoreV5 } from '../../features/robot/v5/robot-joint-runtime-store.js'
import { createInitialProjectBootstrapV5 } from './initial-project-bootstrap-v5.js'

export interface AppV5Props {
  readonly resources?: BrowserProjectApplicationResourcesV5
}

function useExternalSnapshot<State>(
  subscribe: (listener: () => void) => () => void,
  getSnapshot: () => State,
): State {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}

function useRuntimeHeartbeat(enabled: boolean): void {
  const [, setTick] = useState(0)
  useEffect(() => {
    if (!enabled) return
    const handle = window.setInterval(() => setTick((tick) => tick + 1), 250)
    return () => window.clearInterval(handle)
  }, [enabled])
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function selectedTarget(project: WorkcellProjectV5, selection: V5WorkcellSelection | null): OpcUaProjectTargetV5 | null {
  if (selection === null) return null
  if (selection.kind === 'entity') {
    const entity = project.spatialEntities.find(({ id }) => id === selection.id)
    if (entity === undefined) return null
    const frame = entity.movingFrames[0]
    return frame === undefined
      ? { type: 'entity-status', entityId: entity.id }
      : { type: 'entity-frame', entityId: entity.id, frameId: frame.frameId }
  }
  const robot = project.robots.find(({ id }) => id === selection.id)
  return robot === undefined
    ? null
    : { type: 'robot-frame', robotId: robot.id, frameId: robot.selectedTcpFrameId }
}

function SceneExplorerV5({ project, selection, onSelect }: {
  readonly project: WorkcellProjectV5
  readonly selection: V5WorkcellSelection | null
  readonly onSelect: (selection: V5WorkcellSelection) => void
}): ReactNode {
  return <section className="v5-explorer">
    <header><h2>Scene Explorer</h2></header>
    <details open><summary>Frames</summary>
      <ul>{project.scene.frames.map((frame) => <li key={frame.id}>{frame.name}</li>)}</ul>
    </details>
    <details open><summary>Robots <span>{project.robots.length}</span></summary>
      <ul>{project.robots.map((robot) => <li key={robot.id}>
        <button className={selection?.kind === 'robot' && selection.id === robot.id ? 'is-selected' : ''} onClick={() => onSelect({ kind: 'robot', id: robot.id })} type="button">
          {robot.name}<small>{robot.jointSource}</small>
        </button>
      </li>)}</ul>
    </details>
    <details open><summary>Objects <span>{project.spatialEntities.length}</span></summary>
      <ul>{project.spatialEntities.map((entity) => <li key={entity.id}>
        <button className={selection?.kind === 'entity' && selection.id === entity.id ? 'is-selected' : ''} onClick={() => onSelect({ kind: 'entity', id: entity.id })} type="button">
          {entity.name}<small>{entity.transformOwner}</small>
        </button>
      </li>)}</ul>
    </details>
  </section>
}

function SelectionInspectorV5({ project, bundle, selection, onOpenBinding, mutations, runMutation }: {
  readonly project: WorkcellProjectV5
  readonly bundle: ReturnType<BrowserProjectApplicationResourcesV5['runtime']['readActiveBundle']>
  readonly selection: V5WorkcellSelection | null
  readonly onOpenBinding: (target: OpcUaProjectTargetV5) => void
  readonly mutations: ProjectV5MutationService
  readonly runMutation: (operation: Promise<unknown>) => void
}): ReactNode {
  useRuntimeHeartbeat(bundle !== null && selection !== null)
  const fallbackRobotStore = useMemo(() => bundle?.runtimeGraph.robots ?? null, [bundle])
  const robotState = useStore(
    fallbackRobotStore ?? EMPTY_ROBOT_STORE,
    (state) => selection?.kind === 'robot' ? state.byRobotId[selection.id] : undefined,
  )
  if (selection === null) return <aside className="v5-inspector"><p>Select a Robot or Object.</p></aside>
  const target = selectedTarget(project, selection)
  if (selection.kind === 'entity') {
    const entity = project.spatialEntities.find(({ id }) => id === selection.id)
    if (entity === undefined) return <aside className="v5-inspector"><p>Object is no longer available.</p></aside>
    const runtimeStatus = bundle?.runtimeGraph.objects.readNumericStatus(entity.id)
    const rpy = quaternionToRpyDegreesV5(entity.localPose.quaternion)
    const manual = entity.transformOwner === 'manual'
    const updateEntity = (recipe: (value: SpatialEntityV5) => SpatialEntityV5, description: string): void => {
      const published = mutations.readPublished()
      if (published === null) return
      runMutation(mutations.mutate({
        expectedRevisionId: published.revisionId,
        description,
        recipe: (candidate) => ({
          ...candidate,
          spatialEntities: candidate.spatialEntities.map((value) => value.id === entity.id ? recipe(value) : value),
        }),
      }))
    }
    return <aside className="v5-inspector"><h2>{entity.name}</h2>
      <dl>
        <div><dt>Transform owner</dt><dd>{entity.transformOwner}</dd></div>
        <div><dt>Visible</dt><dd>{entity.visible ? 'Yes' : 'No'}</dd></div>
        <div><dt>Status</dt><dd>{runtimeStatus?.value ?? entity.numericStatus.value}</dd></div>
        <div><dt>Status owner</dt><dd>{runtimeStatus?.owner ?? entity.numericStatus.sourceOwnership}</dd></div>
        <div><dt>Quality</dt><dd>{runtimeStatus?.quality ?? 'GOOD'}</dd></div>
        <div><dt>Status code</dt><dd>{runtimeStatus?.statusCode ?? 'Good'}</dd></div>
      </dl>
      <form className="v5-pose-form" onSubmit={(event) => {
        event.preventDefault()
        if (!manual) return
        const values = new FormData(event.currentTarget)
        const numeric = (name: string) => Number(values.get(name))
        updateEntity((value) => ({
          ...value,
          localPose: {
            positionM: [numeric('x'), numeric('y'), numeric('z')],
            quaternion: rpyDegreesToQuaternionV5([numeric('roll'), numeric('pitch'), numeric('yaw')]),
          },
        }), 'Update Object pose')
      }}>
        {[
          ['x', 'X (m)', entity.localPose.positionM[0]],
          ['y', 'Y (m)', entity.localPose.positionM[1]],
          ['z', 'Z (m)', entity.localPose.positionM[2]],
          ['roll', 'Roll (deg)', rpy[0]],
          ['pitch', 'Pitch (deg)', rpy[1]],
          ['yaw', 'Yaw (deg)', rpy[2]],
        ].map(([name, label, value]) => <label key={String(name)}><span>{label}</span><input defaultValue={Number(value)} disabled={!manual} name={String(name)} step="any" type="number" /></label>)}
        <button disabled={!manual} type="submit">Apply Pose</button>
      </form>
      <div className="v5-inspector-actions">
        <button onClick={() => updateEntity((value) => ({ ...value, visible: !value.visible }), entity.visible ? 'Hide Object' : 'Show Object')} type="button">{entity.visible ? 'Hide' : 'Show'}</button>
        <button disabled={!entity.removable} onClick={() => {
          const published = mutations.readPublished()
          if (published === null) return
          runMutation(mutations.mutate({
            expectedRevisionId: published.revisionId,
            description: 'Delete Object',
            recipe: (candidate) => ({ ...candidate, spatialEntities: candidate.spatialEntities.filter(({ id }) => id !== entity.id) }),
          }))
        }} type="button">Delete</button>
      </div>
      <button disabled={target === null} onClick={() => { if (target !== null) onOpenBinding(target) }} type="button">Open Binding…</button>
    </aside>
  }
  const robot = project.robots.find(({ id }) => id === selection.id)
  const definition = project.robotDefinitions.find(({ id }) => id === robot?.definitionId)
  const isOpcUa = robotState?.jointSource.startsWith('opcua:') ?? false
  const runtimeStatus = bundle?.runtimeGraph.robotFrames.readNumericStatus(selection.id)
  return <aside className="v5-inspector"><h2>{robot?.name ?? selection.id}</h2>
    <p>{isOpcUa ? 'Joint values are owned by OPC UA.' : 'Manual Joint control'}</p>
    <dl>
      <div><dt>Joint owner</dt><dd>{robotState?.jointSource ?? robot?.jointSource ?? 'unavailable'}</dd></div>
      <div><dt>Joint quality</dt><dd>{robotState?.quality ?? 'unavailable'}</dd></div>
      <div><dt>Status</dt><dd>{runtimeStatus?.value ?? 'unavailable'}</dd></div>
      <div><dt>Status owner</dt><dd>{runtimeStatus?.owner ?? 'unavailable'}</dd></div>
      <div><dt>Status quality</dt><dd>{runtimeStatus?.quality ?? 'unavailable'}</dd></div>
      <div><dt>Status code</dt><dd>{runtimeStatus?.statusCode ?? 'unavailable'}</dd></div>
    </dl>
    <div className="v5-joint-list">{definition?.joints.map((joint) => {
      const value = robotState?.jointValues[joint.id] ?? robot?.initialJointValues[joint.id] ?? joint.home
      return <label key={joint.id}><span>{joint.id}</span>
        <input
          disabled={bundle === null || isOpcUa}
          max={joint.max}
          min={joint.min}
          onChange={(event) => bundle?.runtimeGraph.robots.getState().writeJointValues(robot!.id, { [joint.id]: Number(event.currentTarget.value) }, 'manual')}
          step={joint.type === 'revolute' ? 1 : 0.001}
          type="range"
          value={value}
        />
        <output>{value.toFixed(joint.type === 'revolute' ? 1 : 3)}</output>
      </label>
    })}</div>
    <button disabled={target === null} onClick={() => { if (target !== null) onOpenBinding(target) }} type="button">Open Binding…</button>
  </aside>
}

const EMPTY_ROBOT_STORE = createStore<RobotJointRuntimeStoreV5>()(() => ({
  projectRevisionId: null,
  configRevision: null,
  byRobotId: {},
  replaceProject: () => undefined,
  ingest: () => false,
  restoreReplayPrefix: () => false,
  beginEndpointCatchup: () => ({ commit: () => undefined, abort: () => undefined }),
  markEndpointDisconnected: () => undefined,
  resetEndpointSession: () => undefined,
  resetGatewaySession: () => undefined,
  writeJointValues: () => undefined,
  readRobot: () => null,
  readRobotPose: () => { throw new Error('No active Robot runtime.') },
}))

export function AppV5({ resources: injectedResources }: AppV5Props): ReactNode {
  const resources = useMemo(
    () => injectedResources ?? createBrowserProjectApplicationResourcesV5(),
    [injectedResources],
  )
  const projectState = useStore(resources.store)
  const connectivity = useExternalSnapshot(resources.connectivity.subscribe, resources.connectivity.getState)
  const [settingsState, setSettingsState] = useState(() => resources.settings.getState())
  const bundle = useExternalSnapshot(resources.runtime.bundle.subscribe, resources.runtime.bundle.readActiveState)
  const [selection, setSelection] = useState<V5WorkcellSelection | null>(null)
  const [bindingOverviewOpen, setBindingOverviewOpen] = useState(false)
  const [bindingTarget, setBindingTarget] = useState<OpcUaProjectTargetV5 | null>(null)
  const [bindingMappingId, setBindingMappingId] = useState<string | undefined>()
  const [dockerGuideOpen, setDockerGuideOpen] = useState(false)
  const [operationError, setOperationError] = useState<string | null>(null)
  const monitorRef = useRef<ConnectionMonitorPanelControlV1>(null)
  const importInputRef = useRef<HTMLButtonElement>(null)
  const lifecycleGenerationRef = useRef(0)
  const bootstrap = useMemo(() => createInitialProjectBootstrapV5(resources.store), [resources.store])

  useEffect(
    () => resources.settings.subscribe(() => setSettingsState(resources.settings.getState())),
    [resources.settings],
  )

  useEffect(() => {
    setSelection(null)
  }, [bundle?.runtimeEpoch])

  useEffect(() => {
    lifecycleGenerationRef.current += 1
    let active = true
    resources.connectivity.startHeader()
    void bootstrap.run(() => active).then(() => {
      if (active && resources.runtime.readActiveBundle() !== null) resources.runtime.startGatewayStream()
    }, (error: unknown) => {
      if (active) setOperationError(errorMessage(error))
    })
    return () => {
      active = false
      const cleanupGeneration = ++lifecycleGenerationRef.current
      queueMicrotask(() => {
        if (lifecycleGenerationRef.current === cleanupGeneration) {
          void resources.dispose()
        }
      })
    }
  }, [bootstrap, resources])

  const run = useCallback(async (operation: () => Promise<void>) => {
    setOperationError(null)
    try {
      await operation()
    } catch (error) {
      setOperationError(errorMessage(error))
    }
  }, [])

  const activeProject = projectState.activeProject
  const workspaceProject = bundle?.project ?? activeProject
  const openBinding = useCallback((target: OpcUaProjectTargetV5, mappingId?: string) => {
    setBindingTarget(target)
    setBindingMappingId(mappingId)
    setBindingOverviewOpen(false)
  }, [])
  const browseSessionAvailable = useCallback((endpointId: string) => (
    connectivity.status?.opcUa.clientEndpoints.some((endpoint) => (
      endpoint.endpointId === endpointId && endpoint.sessionActive
    )) ?? false
  ), [connectivity.status])
  const addPrimitive = useCallback((kind: 'box' | 'cylinder') => {
    const published = resources.mutations.readPublished()
    if (published === null) return
    const id = `entity-${crypto.randomUUID()}`
    void resources.mutations.mutate({
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
    }).then(() => setSelection({ kind: 'entity', id }), (error: unknown) => setOperationError(errorMessage(error)))
  }, [resources.mutations])
  const loadDemo = useCallback(() => {
    const nowIso = new Date().toISOString()
    const source = createLogicalIoJobSampleV5({
      projectId: crypto.randomUUID(),
      revisionId: crypto.randomUUID(),
      nowIso,
    })
    const demo = validateWorkcellProjectV5({
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
    void run(() => resources.mutations.replace({ candidate: demo, description: 'Load Project V5 Demo' }).then(() => undefined))
  }, [resources.mutations, run])

  return <div className="v5-app-shell">
    <header className="v5-app-header">
      <div className="v5-brand"><strong>OpenDigitalTwin</strong><span>Project V5</span></div>
      <nav aria-label="Project commands">
        <button disabled={projectState.status === 'loading'} onClick={() => void run(() => resources.store.getState().newProject())} type="button">New</button>
        <button onClick={loadDemo} type="button">Load Demo</button>
        <button disabled={activeProject === null} onClick={() => void run(async () => { await resources.store.getState().saveActiveProject() })} type="button">Save</button>
        <button disabled={activeProject === null} onClick={() => void run(async () => {
          const blob = await resources.store.getState().exportActiveProject()
          const project = resources.store.getState().activeProject!
          resources.files.downloadProject(blob, { name: project.metadata.name, projectId: project.projectId })
        })} type="button">Export</button>
        <button ref={importInputRef} onClick={() => void run(async () => {
          const file = await resources.files.pickProject()
          if (file !== null) await resources.store.getState().importProject(file)
        })} type="button">Import</button>
      </nav>
      <nav aria-label="Connectivity commands">
        <button disabled={activeProject === null} onClick={() => { if (activeProject !== null) resources.settings.open(activeProject) }} type="button">OPC UA Settings…</button>
        <button onClick={(event) => monitorRef.current?.open(event.currentTarget)} type="button">Connection Monitor…</button>
        <button disabled={activeProject === null} onClick={() => setBindingOverviewOpen(true)} type="button">Binding Overview…</button>
        <button onClick={() => setDockerGuideOpen(true)} type="button">Docker Run Guide…</button>
      </nav>
      <nav aria-label="Model commands">
        <button disabled={activeProject === null} onClick={() => addPrimitive('box')} type="button">Add Box</button>
        <button disabled={activeProject === null} onClick={() => addPrimitive('cylinder')} type="button">Add Cylinder</button>
      </nav>
      <div className="v5-connectivity-status">
        <span data-state={connectivity.gateway.state}>Gateway {connectivity.gateway.label}</span>
        <span data-state={connectivity.opcUa.state}>OPC UA {connectivity.opcUa.label}</span>
      </div>
    </header>
    {operationError !== null && <div className="v5-error-banner" role="alert">{operationError}</div>}
    {workspaceProject === null
      ? <main className="v5-loading"><h1>{projectState.status === 'error' || projectState.status === 'recovery-required' ? 'Project unavailable' : 'Loading Project V5…'}</h1><p>{projectState.error ?? 'Preparing durable Project, browser runtime, and Gateway authority.'}</p></main>
      : <div className="v5-layout" key={`runtime-${bundle?.runtimeEpoch ?? 'pending'}:${workspaceProject.revisionId}`}>
        <SceneExplorerV5 onSelect={setSelection} project={workspaceProject} selection={selection} />
        <V5WorkcellWorkspace
          bundle={bundle}
          onOpenBinding={openBinding}
          onSelect={setSelection}
          project={workspaceProject}
          selection={selection}
        />
        <SelectionInspectorV5
          key={`${workspaceProject.revisionId}:${selection?.kind ?? 'none'}:${selection?.id ?? 'none'}`}
          bundle={bundle}
          mutations={resources.mutations}
          onOpenBinding={openBinding}
          project={workspaceProject}
          runMutation={(operation) => { void run(async () => { await operation }) }}
          selection={selection}
        />
        <RobotJobWorkspaceV5 bundle={bundle} project={workspaceProject} />
      </div>}
    <ConnectionMonitorPanel controlRef={monitorRef} showTrigger={false} store={resources.connectivity} />
    {activeProject !== null && settingsState.open && <OpcUaSettingsDialog
      activeProject={activeProject}
      connectionTest={resources.connectionTest}
      controller={resources.settings}
      onOpenBindingOverview={() => setBindingOverviewOpen(true)}
      onOpenDockerRunGuide={() => setDockerGuideOpen(true)}
      presentation={connectivity}
    />}
    {activeProject !== null && bindingOverviewOpen && <BindingOverviewDialogV1
      activeProject={activeProject}
      onClose={() => setBindingOverviewOpen(false)}
      onEdit={openBinding}
    />}
    {activeProject !== null && bindingTarget !== null && <BindingEditorDialogV1
      activeProject={activeProject}
      addressSpaceBrowsePort={resources.gateway}
      browseSessionAvailable={browseSessionAvailable}
      {...(bindingMappingId === undefined ? {} : { mappingId: bindingMappingId })}
      mutations={resources.mutations}
      nodeAddressResolver={resources.nodeAddressResolver}
      onClose={() => { setBindingTarget(null); setBindingMappingId(undefined) }}
      onSaved={() => { setBindingTarget(null); setBindingMappingId(undefined) }}
      target={bindingTarget}
    />}
    {dockerGuideOpen && <DockerRunGuideDialogV1
      onClose={() => setDockerGuideOpen(false)}
      status={connectivity.status}
    />}
  </div>
}
