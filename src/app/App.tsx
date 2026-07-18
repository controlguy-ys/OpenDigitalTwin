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

import type {
  RobotIdV4,
  RevisionIdV4,
  WorkcellProjectV4,
} from '../core/project-v4/index.js'
import { CollisionPanelV4 } from '../features/collision/v4/CollisionPanel.js'
import {
  createCollisionValidationControllerV4,
  queryVisibleGeometryCollisionsV4,
  type CollisionValidationControllerV4,
} from '../features/collision/v4/collision-validation-controller.js'
import { deriveCollisionPolicyV4 } from '../domain/collision/collision-policy-v4.js'
import {
  createAppCommandBindingsV4,
  createAppCommandRuntimeV4,
  type AppCommandBindingsV4,
  type AppCommandRuntimeV4,
  type AppCommandRuntimeStateV4,
} from '../features/commands/v4/app-command-runtime.js'
import { createAppCommandRegistryV4 } from '../features/commands/v4/app-command-registry.js'
import type { AppCommandRegistryV4 } from '../features/commands/v4/app-command-registry.js'
import {
  createAppShortcutDispatcherV4,
  type AppShortcutDispatcherV4,
} from '../features/commands/v4/app-shortcut-dispatcher.js'
import { LocalHelpPanelV4 } from '../features/help/v4/LocalHelpPanelV4.js'
import {
  createLocalHelpControllerV4,
  type LocalHelpControllerV4,
} from '../features/help/v4/local-help-controller.js'
import type {
  CollisionGeometryProxyV4,
} from '../features/collision/v4/scene-entity-adapter-v4.js'
import { activeJobIdV4 } from '../features/interaction/v4/interaction-store.js'
import type { SceneSelectionTargetV4 } from '../features/interaction/v4/scene-selection.js'
import { RobotJobListV4 } from '../features/jobs/v4/RobotJobList.js'
import { createJobOperatorServiceV4 } from '../features/jobs/v4/job-operator-service.js'
import { createRobotOperatorCommandServiceV4 } from '../features/joints/v4/robot-operator-command-service.js'
import {
  browserProjectResourcesV4,
  type BrowserProjectResourcesV4,
} from '../features/project/project-store-browser.js'
import { createDualRobotSampleV4 } from '../features/project/v4/dual-robot-sample-v4.js'
import type { RobotRuntimeRegistryV4 } from '../features/robot/v4/robot-runtime-registry.js'
import {
  createRuntimeGatewayPublisherV4,
  runtimeGatewayStatePublicationRequiresReactivationV4,
  type RuntimeGatewayPresentationV4,
  type RuntimeGatewayPublisherV4,
  type RuntimeGatewayStatePayloadV4,
  type RuntimeGatewayStatusV4,
} from '../features/runtime-gateway/v4/runtime-gateway-publisher-v4.js'
import {
  createObjectRuntimeStateV4,
  type ObjectRuntimeStateV4,
} from '../features/runtime-gateway/v4/object-runtime-state-v4.js'
import {
  createRuntimeGatewayStreamV4,
  type RuntimeGatewayStreamV4,
} from '../features/runtime-gateway/v4/runtime-gateway-stream-v4.js'
import {
  SceneCanvasV4,
  type SceneCameraCommandV4,
  type SceneCameraRequestV4,
  type SceneRenderStatusV4,
} from '../features/scene/v4/SceneCanvas.js'
import { SceneContextMenuV4 } from '../features/scene/v4/SceneContextMenu.js'
import { SceneEntityInspectorV4 } from '../features/scene/v4/SceneEntityInspector.js'
import { SceneExplorerV4 } from '../features/scene/v4/SceneExplorer.js'
import type { SceneContextRequestV4 } from '../features/scene/v4/scene-context-request.js'
import { selectSceneRuntimeV4 } from '../features/scene/v4/scene-runtime-selector.js'
import type { WorkcellRegistrationV4 } from '../features/scene/v4/Workcell.js'
import { BottomWorkspace } from '../features/ui/BottomWorkspace.js'
import { TimelineV4 } from '../features/ui/v4/Timeline.js'
import { buildAppMenuModelV4 } from '../features/ui/v4/app-menu-model.js'
import { composeAppHeaderStatusV4 } from '../features/ui/v4/app-header-status.js'
import { StudioHeaderV4 } from '../features/ui/v4/StudioHeaderV4.js'
import {
  createShellLayoutControllerV4,
  type ShellLayoutControllerSnapshotV4,
  type ShellLayoutControllerV4,
} from '../features/ui/v4/shell-layout-controller.js'
import { initialShellLayoutBoundsV4 } from '../features/ui/v4/shell-layout-geometry.js'
import type { ShellDockV4 } from '../features/ui/v4/shell-layout-store.js'
import { createViewportBoundResolversV4 } from '../features/viewport/v4/viewport-runtime.js'
import type { StandardWorldView } from '../features/viewport/camera-actions.js'
import { AppShellV4 } from './AppShell.js'
import { APP_QUICK_ACTION_IDS_V4, composeAppCommandsV4 } from './v4/app-command-composition.js'
import { createInitialProjectBootstrapV4 } from './initial-project-bootstrap.js'

export interface AppPropsV4 {
  readonly resources?: BrowserProjectResourcesV4
  readonly gatewayPublisher?: RuntimeGatewayPublisherV4 | null
  readonly gatewayStreamFactory?: RuntimeGatewayStreamFactoryV4 | null
}

export type RuntimeGatewayStreamFactoryV4 = (
  runtime: ObjectRuntimeStateV4,
) => RuntimeGatewayStreamV4

const browserRuntimeGatewayPublisherV4 = createRuntimeGatewayPublisherV4()
const browserRuntimeGatewayStreamFactoryV4: RuntimeGatewayStreamFactoryV4 = (runtime) => (
  createRuntimeGatewayStreamV4({
    ingest: runtime.ingest,
    onSessionStart: runtime.resetGatewaySession,
  })
)

const IDLE_GATEWAY_PRESENTATION_V4: RuntimeGatewayPresentationV4 = Object.freeze({
  phase: 'idle',
  projectRevisionId: null,
  mode: null,
  endpointUrl: null,
  message: null,
})

const INACTIVE_COMMAND_RUNTIME_STATE_V4: AppCommandRuntimeStateV4 = Object.freeze({
  pendingCommandIds: new Set<string>(),
  errorByCommandId: new Map<string, string>(),
})

const INACTIVE_COMMAND_REVISION_V4 = '__app-command-environment-inactive__' as RevisionIdV4
const EMPTY_COLLISION_PROXIES_V4: readonly CollisionGeometryProxyV4[] = Object.freeze([])

const getInactiveCommandRuntimeStateV4 = () => INACTIVE_COMMAND_RUNTIME_STATE_V4
const subscribeInactiveCommandRuntimeV4 = () => () => undefined

interface AppCommandEnvironmentV4 {
  readonly resources: BrowserProjectResourcesV4
  readonly shellLayoutController: ShellLayoutControllerV4
  readonly runtime: AppCommandRuntimeV4
  readonly bindings: AppCommandBindingsV4
  readonly collision: CollisionValidationControllerV4
  readonly help: LocalHelpControllerV4
  readonly shortcuts: AppShortcutDispatcherV4
}

interface InstalledCommandRegistryV4 {
  readonly registry: AppCommandRegistryV4
  readonly projectRevisionId: RevisionIdV4
}

interface AppInspectorFocusRequestV4 {
  readonly id: number
  readonly projectRevisionId: RevisionIdV4
  readonly selection: SceneSelectionTargetV4
  readonly section: 'joints' | 'pose' | 'parent' | 'group' | 'numericStatus'
}

type AppContextTargetSourceV4 = 'scene' | 'job' | 'empty'

const INACTIVE_SHELL_LAYOUT_SNAPSHOT_V4: ShellLayoutControllerSnapshotV4 = Object.freeze({
  mode: 'wide',
  bounds: Object.freeze({ mode: 'wide', widthPx: 1200, workspaceHeightPx: 800, dividerPx: 6 }),
  preferences: Object.freeze({
    version: 1,
    modes: Object.freeze({
      wide: Object.freeze({ ribbonExpanded: true, dockVisible: Object.freeze({ sidebar: true, inspector: true, bottom: false }) }),
      compact: Object.freeze({ ribbonExpanded: false, dockVisible: Object.freeze({ sidebar: true, inspector: false, bottom: false }) }),
      narrow: Object.freeze({ ribbonExpanded: false, dockVisible: Object.freeze({ sidebar: false, inspector: false, bottom: false }) }),
    }),
    sidebar: Object.freeze({ widthPx: 248, sceneJobSplitPercent: 60 }),
    inspector: Object.freeze({ widthPx: 320 }),
    bottom: Object.freeze({ heightPx: 160, activeTab: 'timeline' }),
    theme: 'system',
  }),
  overlays: Object.freeze({ sidebarOpen: false, inspectorOpen: false, bottomOpen: false }),
  resolved: Object.freeze({ sidebarWidthPx: 248, inspectorWidthPx: 320, bottomHeightPx: 160, viewportWidthPx: 620 }),
  safeAreaInsets: Object.freeze({ top: 0, right: 0, bottom: 0, left: 0 }),
  isDockVisible: (dock: ShellDockV4) => dock === 'sidebar' || dock === 'inspector',
  isRibbonExpanded: () => true,
})

const getInactiveShellLayoutSnapshotV4 = () => INACTIVE_SHELL_LAYOUT_SNAPSHOT_V4
const subscribeInactiveShellLayoutV4 = () => () => undefined

interface RevisionQualifiedSceneStatusV4 {
  readonly projectRevisionId: string | null
  readonly status: SceneRenderStatusV4
}

interface RevisionQualifiedContextRequestV4 {
  readonly projectRevisionId: string
  readonly request: SceneContextRequestV4
}

function nextCameraRequestV4(
  current: SceneCameraRequestV4 | undefined,
  projectRevisionId: string,
  request: SceneCameraCommandV4,
): SceneCameraRequestV4 {
  return {
    id: (current?.id ?? 0) + 1,
    projectRevisionId,
    ...request,
  }
}

function runtimeGatewayStatePayloadV4(
  project: WorkcellProjectV4,
  registry: RobotRuntimeRegistryV4,
): RuntimeGatewayStatePayloadV4 {
  if (registry.projectRevisionId !== project.revisionId) {
    throw new Error('Runtime Gateway Robot state does not match the active Project revision.')
  }
  const definitions = new Map(
    project.robotDefinitions.map((definition) => [definition.id, definition]),
  )
  return Object.freeze({
    projectId: project.projectId,
    revisionId: project.revisionId,
    robots: Object.freeze(project.robots.map((robot) => {
      const runtime = registry.robots[robot.id]
      const definition = definitions.get(robot.definitionId)
      if (runtime === undefined || definition === undefined) {
        throw new Error(`Runtime Gateway Robot ${robot.id} is not published.`)
      }
      const jointValues = Object.create(null) as Record<string, number>
      for (const { id } of definition.joints) {
        const value = runtime.jointValues[id]
        if (typeof value !== 'number' || !Number.isFinite(value)) {
          throw new Error(`Runtime Gateway Robot ${robot.id} Joint ${id} is invalid.`)
        }
        jointValues[id] = value
      }
      return Object.freeze({
        robotId: robot.id,
        jointValues: Object.freeze(jointValues),
      })
    })),
  })
}

function readyGatewayPresentationV4(
  status: RuntimeGatewayStatusV4,
): RuntimeGatewayPresentationV4 {
  return Object.freeze({
    phase: 'ready',
    projectRevisionId: status.revisionId,
    mode: status.mode,
    endpointUrl: status.endpointUrl,
    message: null,
  })
}

function RuntimePendingV4({
  recoveryRequired,
  error,
}: {
  readonly recoveryRequired: boolean
  readonly error: string | null
}): ReactNode {
  return (
    <main className="project-v4-pending">
      <p aria-live="polite" role="status">
        {recoveryRequired
          ? 'Project V4 recovery requires a reload.'
          : 'Synchronizing Project V4 runtime...'}
      </p>
      {error === null ? null : <p role="alert">{error}</p>}
    </main>
  )
}

export function App({
  resources = browserProjectResourcesV4,
  gatewayPublisher = browserRuntimeGatewayPublisherV4,
  gatewayStreamFactory = browserRuntimeGatewayStreamFactoryV4,
}: AppPropsV4) {
  const projectState = useStore(resources.projectStore)
  const runtimeBundle = useStore(resources.runtimeBundle, (state) => state)
  const robotRuntime = useStore(resources.robots, (state) => state)
  const jobRuntime = useStore(resources.jobs, (state) => state)
  const sceneStore = useStore(resources.scene, (state) => state)
  const interaction = useStore(resources.interaction, (state) => state)
  const coordinateDisplay = useStore(
    resources.coordinateDisplay,
    (state) => state,
  )
  const [shellLayoutController, setShellLayoutController] =
    useState<ShellLayoutControllerV4 | null>(null)
  const [commandEnvironment, setCommandEnvironment] =
    useState<AppCommandEnvironmentV4 | null>(null)
  const [installedRegistry, setInstalledRegistry] =
    useState<InstalledCommandRegistryV4 | null>(null)
  const [inspectorFocusRequest, setInspectorFocusRequest] =
    useState<AppInspectorFocusRequestV4 | null>(null)
  const [gatewayDetailsOpen, setGatewayDetailsOpen] = useState(false)
  const [contextTargetSource, setContextTargetSource] =
    useState<AppContextTargetSourceV4>('empty')
  const contextTargetSourceRef = useRef<AppContextTargetSourceV4>('empty')
  contextTargetSourceRef.current = contextTargetSource
  const shellLayoutSnapshot = useSyncExternalStore(
    shellLayoutController?.subscribe ?? subscribeInactiveShellLayoutV4,
    shellLayoutController?.getState ?? getInactiveShellLayoutSnapshotV4,
    shellLayoutController?.getState ?? getInactiveShellLayoutSnapshotV4,
  )
  const activeCommandEnvironment = commandEnvironment?.resources === resources
    && commandEnvironment.shellLayoutController === shellLayoutController
    ? commandEnvironment
    : null
  const commandRuntime = activeCommandEnvironment?.runtime ?? null
  const commandRuntimeState = useSyncExternalStore(
    commandRuntime?.subscribe ?? subscribeInactiveCommandRuntimeV4,
    commandRuntime?.getState ?? getInactiveCommandRuntimeStateV4,
    commandRuntime?.getState ?? getInactiveCommandRuntimeStateV4,
  )
  const [sceneStatusState, setSceneStatusState] =
    useState<RevisionQualifiedSceneStatusV4>({
      projectRevisionId: null,
      status: 'loading',
    })
  const [contextRequestState, setContextRequestState] =
    useState<RevisionQualifiedContextRequestV4 | null>(null)
  const [cameraRequest, setCameraRequest] =
    useState<SceneCameraRequestV4 | undefined>(undefined)
  const [registration, setRegistration] = useState<{
    readonly projectRevisionId: string
    readonly value: WorkcellRegistrationV4
  } | null>(null)
  const [commandError, setCommandError] = useState<string | null>(null)
  const [gatewayPresentation, setGatewayPresentation] =
    useState<RuntimeGatewayPresentationV4>(IDLE_GATEWAY_PRESENTATION_V4)
  const bootstrap = useMemo(
    () => createInitialProjectBootstrapV4(resources.projectStore),
    [resources.projectStore],
  )

  useEffect(() => {
    let active = true
    void bootstrap.run(() => active).catch((error: unknown) => {
      if (!active) return
      setCommandError(
        error instanceof Error ? error.message : 'Project V4 bootstrap failed.',
      )
    })
    return () => {
      active = false
    }
  }, [bootstrap])

  useEffect(() => {
    const controller = createShellLayoutControllerV4({
      preferencesStore: resources.shellLayoutStore,
      initialBounds: initialShellLayoutBoundsV4(
        document.documentElement.clientWidth,
        document.documentElement.clientHeight,
      ),
    })
    setShellLayoutController(controller)
    return () => {
      controller.dispose()
      setShellLayoutController((current) => current === controller ? null : current)
    }
  }, [resources.shellLayoutStore])

  useEffect(() => {
    if (shellLayoutController === null) return undefined
    const collision = createCollisionValidationControllerV4({
      initialInput: {
        projectRevisionId: INACTIVE_COMMAND_REVISION_V4,
        policy: deriveCollisionPolicyV4([], [], {
          enabled: false,
          nearMissMarginM: 0,
        }),
        proxies: EMPTY_COLLISION_PROXIES_V4,
        jobRunning: false,
        query: queryVisibleGeometryCollisionsV4,
      },
    })
    const help = createLocalHelpControllerV4({
      availableTopics: ['controls', 'stepImport', 'about'],
    })
    const runtime = createAppCommandRuntimeV4(createAppCommandRegistryV4([]))
    const bindings = createAppCommandBindingsV4(runtime)
    const shortcuts = createAppShortcutDispatcherV4({
      target: window,
      bindings,
    })
    const environment: AppCommandEnvironmentV4 = Object.freeze({
      resources,
      shellLayoutController,
      runtime,
      bindings,
      collision,
      help,
      shortcuts,
    })
    setCommandEnvironment(environment)
    return () => {
      shortcuts.dispose()
      collision.dispose()
      help.dispose()
      runtime.dispose()
      setCommandEnvironment((current) => current === environment ? null : current)
      setInstalledRegistry((current) => current?.registry === runtime.getRegistry() ? null : current)
    }
  }, [resources, shellLayoutController])

  const project = projectState.activeProject
  const revisionId = project?.revisionId ?? null
  const publishedBundle = resources.mutations.readPublished()
  const objectRuntimeConfigRevision = project !== null
    && publishedBundle?.revisionId === project.revisionId
    ? publishedBundle.configRevision
    : null
  const objectRuntime = useMemo(() => (
    project === null || objectRuntimeConfigRevision === null
      ? null
      : createObjectRuntimeStateV4(project, objectRuntimeConfigRevision)
  ), [objectRuntimeConfigRevision, project])
  useEffect(() => {
    if (
      gatewayStreamFactory === null
      || objectRuntime === null
      || project === null
      || (project.opcUa.mode !== 'client' && project.opcUa.mode !== 'bridge')
    ) return
    const stream = gatewayStreamFactory(objectRuntime)
    stream.start()
    return () => stream.stop()
  }, [gatewayStreamFactory, objectRuntime, project])
  const setCurrentContextRequest = useCallback((
    request: SceneContextRequestV4 | null,
  ): void => {
    if (project === null || request === null) {
      setContextRequestState(null)
      setContextTargetSource('empty')
      return
    }
    setContextTargetSource(request.selection === null ? 'empty' : 'scene')
    setContextRequestState({
      projectRevisionId: project.revisionId,
      request,
    })
  }, [project])
  const closeContextMenuRequest = useCallback((): void => {
    setContextRequestState(null)
  }, [])
  const projectPublicationUsable = projectState.status !== 'loading'
    && projectState.status !== 'recovery-required'
  const liveSceneRuntime = useMemo(() => (
    project !== null && robotRuntime.projectRevisionId === project.revisionId
      ? selectSceneRuntimeV4(project, robotRuntime)
      : null
  ), [project, robotRuntime])
  const cameraContextRef = useRef({
    project: null as WorkcellProjectV4 | null,
    runtime: null as ReturnType<typeof selectSceneRuntimeV4> | null,
    registration: null as {
      readonly projectRevisionId: string
      readonly value: WorkcellRegistrationV4
    } | null,
  })
  cameraContextRef.current = {
    project,
    runtime: liveSceneRuntime,
    registration,
  }
  const ready = (
    projectPublicationUsable
    && project !== null
    && runtimeBundle.projectRevisionId === revisionId
    && runtimeBundle.active?.project.revisionId === revisionId
    && robotRuntime.projectRevisionId === revisionId
    && jobRuntime.projectRevisionId === revisionId
    && liveSceneRuntime !== null
    && sceneStore.projectRevisionId === revisionId
    && sceneStore.projection?.projectRevisionId === revisionId
    && interaction.projectRevisionId === revisionId
    && coordinateDisplay.projectRevisionId === revisionId
  )
  const readPublishedProject = useCallback((): WorkcellProjectV4 => {
    const current = resources.projectStore.getState().activeProject
    if (current === null) throw new Error('No active Project is published.')
    return current
  }, [resources.projectStore])
  const robotOperator = useMemo(() => createRobotOperatorCommandServiceV4({
    readProject: readPublishedProject,
    robots: resources.robots,
    jobs: resources.jobs,
    jobCommands: resources.jobCommands,
  }), [readPublishedProject, resources.jobCommands, resources.jobs, resources.robots])
  const playback = runtimeBundle.active?.jobs.playback ?? null
  const jobOperator = useMemo(() => playback === null ? null : createJobOperatorServiceV4({
    readProject: readPublishedProject,
    jobs: resources.jobs,
    playback,
  }), [playback, readPublishedProject, resources.jobs])
  const registeredCollisionProxies: readonly CollisionGeometryProxyV4[] = (
    project !== null && registration?.projectRevisionId === project.revisionId
  ) ? registration.value.collisionProxies : EMPTY_COLLISION_PROXIES_V4
  const anyJobRunning = Object.values(jobRuntime.byRobotId)
    .some((state) => state.state === 'RUNNING')
  const activeRobotId = interaction.activeRobotId
  const activeJobId = activeJobIdV4(interaction)

  useEffect(() => {
    const retainJobContext = contextTargetSourceRef.current === 'job'
      && activeJobIdV4(resources.interaction.getState()) !== null
    setContextRequestState(null)
    setRegistration(null)
    setInspectorFocusRequest(null)
    setGatewayDetailsOpen(false)
    setContextTargetSource(retainJobContext ? 'job' : 'empty')
    setSceneStatusState({
      projectRevisionId: revisionId,
      status: 'loading',
    })
    setGatewayPresentation({
      ...IDLE_GATEWAY_PRESENTATION_V4,
      projectRevisionId: revisionId,
    })
  }, [revisionId])

  useEffect(() => {
    if (gatewayPublisher === null || project === null || !ready) return
    const projectRevisionId = project.revisionId
    const abortController = new AbortController()
    let active = true
    let unsubscribeRobots: (() => void) | null = null
    let observedStatePublish: Promise<RuntimeGatewayStatusV4> | null = null
    let recoveryPromise: Promise<void> | null = null
    let stateChangedDuringRecovery = false

    const isCurrentStatus = (status: RuntimeGatewayStatusV4): boolean => (
      status.projectId === project.projectId
      && status.revisionId === projectRevisionId
    )
    const publishFailure = (error: unknown): void => {
      if (!active) return
      setGatewayPresentation({
        phase: 'error',
        projectRevisionId,
        mode: project.opcUa.mode,
        endpointUrl: null,
        message: error instanceof Error ? error.message : String(error),
      })
    }
    const publishStatus = (status: RuntimeGatewayStatusV4): boolean => {
      if (!active) return false
      if (!isCurrentStatus(status)) {
        publishFailure(new Error('Runtime Gateway returned a stale Project revision.'))
        return false
      }
      setGatewayPresentation(readyGatewayPresentationV4(status))
      return true
    }
    const currentRobotStatePayload = (): RuntimeGatewayStatePayloadV4 => {
      const registry = resources.robots.getState()
      if (registry.projectRevisionId !== projectRevisionId) {
        throw new Error('Runtime Gateway Robot state does not match the active Project revision.')
      }
      return runtimeGatewayStatePayloadV4(project, registry)
    }
    const beginSameRevisionRecovery = (): void => {
      if (!active || recoveryPromise !== null) return
      setGatewayPresentation({
        phase: 'activating',
        projectRevisionId,
        mode: project.opcUa.mode,
        endpointUrl: null,
        message: null,
      })
      let retrySucceeded = false
      const recovery = Promise.resolve().then(async () => {
        const activationStatus = await gatewayPublisher.activateProject(
          project,
          abortController.signal,
        )
        if (!publishStatus(activationStatus) || !active) return
        stateChangedDuringRecovery = false
        if (project.opcUa.mode === 'server' || project.opcUa.mode === 'bridge') {
          const retryStatus = await gatewayPublisher.publishRobotState(
            currentRobotStatePayload(),
            abortController.signal,
          )
          retrySucceeded = publishStatus(retryStatus)
        } else {
          retrySucceeded = true
        }
      }).catch(publishFailure)
      recoveryPromise = recovery
      void recovery.finally(() => {
        if (recoveryPromise !== recovery) return
        recoveryPromise = null
        if (active && retrySucceeded && stateChangedDuringRecovery) {
          publishRobotState()
        }
      })
    }
    const publishRobotState = (): void => {
      if (!active) return
      if (recoveryPromise !== null) {
        stateChangedDuringRecovery = true
        return
      }
      let payload: RuntimeGatewayStatePayloadV4
      try {
        payload = currentRobotStatePayload()
      } catch (error) {
        publishFailure(error)
        return
      }
      const pending = gatewayPublisher.publishRobotState(
        payload,
        abortController.signal,
      )
      if (pending === observedStatePublish) return
      observedStatePublish = pending
      void pending.then(
        (status) => {
          if (observedStatePublish === pending) observedStatePublish = null
          publishStatus(status)
        },
        (error: unknown) => {
          if (observedStatePublish === pending) observedStatePublish = null
          if (runtimeGatewayStatePublicationRequiresReactivationV4(error)) {
            beginSameRevisionRecovery()
          } else {
            publishFailure(error)
          }
        },
      )
    }

    setGatewayPresentation({
      phase: 'activating',
      projectRevisionId,
      mode: project.opcUa.mode,
      endpointUrl: null,
      message: null,
    })
    void gatewayPublisher.activateProject(
      project,
      abortController.signal,
    ).then((status) => {
      if (
        !publishStatus(status)
        || (project.opcUa.mode !== 'server' && project.opcUa.mode !== 'bridge')
      ) return
      if (project.robots.length === 0) return
      unsubscribeRobots = resources.robots.subscribe(publishRobotState)
      publishRobotState()
    }).catch(publishFailure)

    return () => {
      active = false
      abortController.abort()
      unsubscribeRobots?.()
    }
  }, [gatewayPublisher, project, ready, resources.robots])

  const issueCameraRequest = useCallback((
    expectedProjectRevisionId: string,
    request: SceneCameraCommandV4,
  ): void => {
    if (cameraContextRef.current.project?.revisionId !== expectedProjectRevisionId) {
      throw new Error('Camera command is unavailable for a stale Project revision.')
    }
    setCameraRequest((current) => nextCameraRequestV4(
      current,
      expectedProjectRevisionId,
      request,
    ))
  }, [])

  const handleSceneStatusChange = useCallback((
    status: SceneRenderStatusV4,
  ) => {
    if (revisionId === null) return
    setSceneStatusState((current) => (
      current.projectRevisionId === revisionId && current.status === status
        ? current
        : { projectRevisionId: revisionId, status }
    ))
  }, [revisionId])

  const focusSelection = useCallback((selection: SceneSelectionTargetV4) => {
    resources.interaction.getState().select(selection)
    setContextTargetSource('scene')
    const expectedProjectRevisionId = cameraContextRef.current.project?.revisionId
    if (expectedProjectRevisionId === undefined) {
      throw new Error('Camera command is unavailable for a stale Project revision.')
    }
    issueCameraRequest(expectedProjectRevisionId, { command: 'focus-selection' })
  }, [issueCameraRequest, resources.interaction])

  const currentGatewayPresentation = useMemo(() => (
    project !== null && gatewayPresentation.projectRevisionId === project.revisionId
      ? gatewayPresentation
      : Object.freeze({
          ...IDLE_GATEWAY_PRESENTATION_V4,
          projectRevisionId: project?.revisionId ?? null,
        })
  ), [gatewayPresentation, project])
  const camera = useMemo(() => {
    if (project === null) return null
    const expectedProjectRevisionId = project.revisionId
    const contextMatchesExpectedRevision = (): boolean => (
      cameraContextRef.current.project?.revisionId === expectedProjectRevisionId
    )
    const issue = (request: SceneCameraCommandV4): void => {
      if (!contextMatchesExpectedRevision()) {
        throw new Error('Camera command is unavailable for a stale Project revision.')
      }
      issueCameraRequest(expectedProjectRevisionId, request)
    }
    const canFocus = (): boolean => {
      const current = cameraContextRef.current
      if (
        !contextMatchesExpectedRevision()
        || current.project === null
        || current.runtime === null
      ) return false
      return createViewportBoundResolversV4(
        current.project,
        current.runtime,
        current.registration?.projectRevisionId === current.project.revisionId
          ? current.registration.value
          : null,
        resources.interaction.getState().selection,
      ).canFocusSelection
    }
    return Object.freeze({
      home: () => issue({ command: 'home' }),
      fitAll: () => issue({ command: 'fit-all' }),
      canFocusSelection: canFocus,
      focusSelection: () => {
        if (!contextMatchesExpectedRevision()) {
          throw new Error('Camera command is unavailable for a stale Project revision.')
        }
        if (!canFocus()) throw new Error('Select a focusable Scene item.')
        issue({ command: 'focus-selection' })
      },
      setStandardView: (view: StandardWorldView) => {
        issue({ command: 'standard-view', view })
      },
    })
  }, [issueCameraRequest, project, resources.interaction])
  const actions = useMemo(() => {
    if (shellLayoutController === null || project === null) return null
    const openInspector = (request: {
      readonly selection: SceneSelectionTargetV4
      readonly section: 'joints' | 'pose' | 'parent' | 'group' | 'numericStatus'
    }): void => {
      resources.interaction.getState().select(request.selection)
      setContextTargetSource('scene')
      shellLayoutController.setDockVisible('inspector', true)
      setInspectorFocusRequest((current) => ({
        id: (current?.id ?? 0) + 1,
        projectRevisionId: project.revisionId,
        selection: request.selection,
        section: request.section,
      }))
    }
    return Object.freeze({
      project: Object.freeze({
        newProject: () => resources.projectStore.getState().newProject(),
        saveProject: async () => { await resources.projectStore.getState().saveActiveProject() },
        importProject: async () => {
          const file = await resources.projectFiles.pickProject()
          if (file === null) return 'cancelled' as const
          await resources.projectStore.getState().importProject(file)
        },
        exportProject: async () => {
          const current = resources.projectStore.getState().activeProject
          if (current === null) throw new Error('No active Project is published.')
          const blob = await resources.projectStore.getState().exportActiveProject()
          resources.projectFiles.downloadProject(blob, `${current.metadata.name}.json`)
        },
        loadDualRobotSample: async () => {
          await resources.mutations.replaceFromActive({
            description: 'Load dual-Robot technical demo',
            mutate: (active) => createDualRobotSampleV4({
              projectId: active.projectId,
              revisionId: active.revisionId,
              nowIso: active.metadata.updatedAt,
              opcUaMode: active.opcUa.mode === 'server' ? 'server' : 'off',
            }),
          })
        },
      }),
      connectivity: Object.freeze({
        setMode: async (mode: WorkcellProjectV4['opcUa']['mode']) => {
          await resources.mutations.replaceFromActive({
            description: `Set OPC UA mode to ${mode}`,
            mutate: (active) => ({
              ...active,
              opcUa: { ...active.opcUa, mode },
            }),
          })
        },
      }),
      presentation: Object.freeze({
        openRobotBase: (robotId: RobotIdV4) => openInspector({
          selection: { kind: 'robot', robotId },
          section: 'pose',
        }),
        openInspector,
        openTimeline: () => {
          shellLayoutController.setBottomTab('timeline')
          shellLayoutController.setDockVisible('bottom', true)
        },
        openCollision: (selection: SceneSelectionTargetV4 | null) => {
          if (selection !== null) {
            resources.interaction.getState().select(selection)
            setContextTargetSource('scene')
          }
          closeContextMenuRequest()
          shellLayoutController.setBottomTab('collision')
          shellLayoutController.setDockVisible('bottom', true)
        },
        openGatewayDetails: () => setGatewayDetailsOpen(true),
      }),
    })
  }, [closeContextMenuRequest, project, resources, shellLayoutController])
  const candidateRegistry = useMemo(() => {
    if (
      activeCommandEnvironment === null
      || project === null
      || shellLayoutController === null
      || camera === null
      || actions === null
      || jobOperator === null
      || runtimeBundle.active === null
    ) return null
    return composeAppCommandsV4({
      project,
      projectState,
      interaction: resources.interaction,
      gateway: currentGatewayPresentation,
      shellLayoutController,
      scene: resources.sceneCommands,
      jobs: resources.jobCommands,
      viewportPreferences: resources.viewportPreferences,
      projectFiles: resources.projectFiles,
      robotOperator,
      jobOperator,
      collision: activeCommandEnvironment.collision,
      camera,
      prompt: resources.userPrompt,
      help: activeCommandEnvironment.help,
      actions,
    })
  }, [
    actions,
    activeCommandEnvironment,
    camera,
    currentGatewayPresentation,
    jobOperator,
    project,
    projectState,
    resources,
    robotOperator,
    runtimeBundle.active,
    shellLayoutController,
  ])
  useEffect(() => {
    if (activeCommandEnvironment === null) return
    if (
      candidateRegistry === null
      || project === null
      || runtimeBundle.active === null
    ) {
      activeCommandEnvironment.collision.replaceInput({
        projectRevisionId: INACTIVE_COMMAND_REVISION_V4,
        policy: deriveCollisionPolicyV4([], [], {
          enabled: false,
          nearMissMarginM: 0,
        }),
        proxies: EMPTY_COLLISION_PROXIES_V4,
        jobRunning: false,
        query: queryVisibleGeometryCollisionsV4,
      })
      return
    }
    activeCommandEnvironment.collision.replaceInput({
      projectRevisionId: project.revisionId,
      policy: runtimeBundle.active.collisionPolicy,
      proxies: registeredCollisionProxies,
      jobRunning: anyJobRunning,
      query: queryVisibleGeometryCollisionsV4,
    })
  }, [anyJobRunning, activeCommandEnvironment, candidateRegistry, project, registeredCollisionProxies, runtimeBundle.active])

  useEffect(() => {
    if (activeCommandEnvironment === null) return
    if (candidateRegistry === null || project === null) {
      activeCommandEnvironment.runtime.replaceRegistry(createAppCommandRegistryV4([]))
      setInstalledRegistry(null)
      return
    }
    activeCommandEnvironment.runtime.replaceRegistry(candidateRegistry)
    setInstalledRegistry({ registry: candidateRegistry, projectRevisionId: project.revisionId })
  }, [activeCommandEnvironment, candidateRegistry])
  const headerStatus = useMemo(() => composeAppHeaderStatusV4({
    projectState,
    jobRuntime,
    robotRuntime,
    activeRobotId,
    gateway: currentGatewayPresentation,
  }), [activeRobotId, currentGatewayPresentation, jobRuntime, projectState, robotRuntime])
  const menuModel = useMemo(() => {
    if (activeCommandEnvironment === null) return []
    return buildAppMenuModelV4(activeCommandEnvironment.bindings.getRegistry())
  }, [activeCommandEnvironment, commandRuntimeState, contextTargetSource, interaction])

  if (
    shellLayoutController === null
    || activeCommandEnvironment === null
    || !ready
    || project === null
    || runtimeBundle.active === null
    || liveSceneRuntime === null
    || actions === null
    || camera === null
    || candidateRegistry === null
    || jobOperator === null
    // A same-revision Project/Gateway snapshot may rebuild command metadata.
    // Keep the mounted shell on its prior registry until the effect above
    // atomically installs the replacement; only a new Project revision must
    // enter the pending screen.
    || installedRegistry?.projectRevisionId !== project.revisionId
  ) {
    return (
      <RuntimePendingV4
        error={projectState.error ?? commandError}
        recoveryRequired={projectState.status === 'recovery-required'}
      />
    )
  }

  const sceneRuntime = liveSceneRuntime
  const sceneStatus = sceneStatusState.projectRevisionId === project.revisionId
    ? sceneStatusState.status
    : 'loading'
  const contextRequest = (
    contextRequestState?.projectRevisionId === project.revisionId
  ) ? contextRequestState.request : null
  const activeCameraRequest = (
    cameraRequest?.projectRevisionId === project.revisionId
  ) ? cameraRequest : undefined
  const timelineUnavailable = sceneStatus !== 'ready'
  const ribbonContext = contextTargetSource === 'scene'
    ? { selection: interaction.selection, activeRobotId, activeJobId: null }
    : contextTargetSource === 'job'
      ? { selection: null, activeRobotId, activeJobId }
      : { selection: null, activeRobotId: null, activeJobId: null }

  return (
    <>
      {commandError === null ? null : (
        <p className="operation-feedback" role="alert">{commandError}</p>
      )}
      <LocalHelpPanelV4 controller={activeCommandEnvironment.help} />
      <AppShellV4
        commandBindings={activeCommandEnvironment.bindings}
        header={(
          <StudioHeaderV4
            commandBindings={activeCommandEnvironment.bindings}
            gatewayDetailsOpen={gatewayDetailsOpen}
            menuModel={menuModel}
            onGatewayDetailsOpenChange={setGatewayDetailsOpen}
            quickActionIds={APP_QUICK_ACTION_IDS_V4}
            ribbonContext={ribbonContext}
            shellLayoutController={shellLayoutController}
            status={headerStatus}
          />
        )}
        assetTree={(
          <SceneExplorerV4
            commandBindings={activeCommandEnvironment.bindings}
            interaction={resources.interaction}
            onContextRequest={setCurrentContextRequest}
            onFocus={focusSelection}
            onSceneSelection={() => setContextTargetSource('scene')}
            project={project}
            runtime={sceneRuntime}
          />
        )}
        bottomRail={(
          <BottomWorkspace
            activeTab={shellLayoutSnapshot.preferences.bottom.activeTab}
            collision={(
              <CollisionPanelV4
                commandBindings={activeCommandEnvironment.bindings}
                controller={activeCommandEnvironment.collision}
                onFocus={focusSelection}
              />
            )}
            onActiveTabChange={shellLayoutController.setBottomTab}
            timeline={(
              <TimelineV4
                commandBindings={activeCommandEnvironment.bindings}
                commands={resources.jobCommands}
                disabled={timelineUnavailable}
                jobId={activeJobId}
                jobs={resources.jobs}
                project={project}
                robotId={activeRobotId}
              />
            )}
          />
        )}
        inspector={(
          <SceneEntityInspectorV4
            commandBindings={activeCommandEnvironment.bindings}
            focusRequest={inspectorFocusRequest}
            interaction={resources.interaction}
            jobs={resources.jobs}
            project={project}
            robots={resources.robots}
            runtime={sceneRuntime}
            sceneCommands={resources.sceneCommands}
            selection={interaction.selection}
            objectRuntime={objectRuntime}
          />
        )}
        jobTree={(
          <RobotJobListV4
            commandBindings={activeCommandEnvironment.bindings}
            interaction={resources.interaction}
            jobs={resources.jobs}
            project={project}
            onExplicitJobSelection={() => setContextTargetSource('job')}
            selectedRobotId={activeRobotId}
          />
        )}
        shellLayoutController={shellLayoutController}
        renderViewport={(safeAreaInsets) => (
          <>
            <SceneCanvasV4
              {...(activeCameraRequest === undefined
                ? {}
                : { cameraRequest: activeCameraRequest })}
              coordinateDisplay={resources.coordinateDisplay}
              commandBindings={activeCommandEnvironment.bindings}
              geometryRepository={resources.geometry}
              interaction={resources.interaction}
              onCommitSpatialEntityLocalPose={resources.sceneCommands.setSpatialEntityLocalPose}
              onContextRequest={setCurrentContextRequest}
              onExplicitContextTarget={(selection) => {
                setContextTargetSource(selection === null ? 'empty' : 'scene')
              }}
              onRegistration={(value) => {
                setRegistration(value === null ? null : {
                  projectRevisionId: project.revisionId,
                  value,
                })
              }}
              onStatusChange={handleSceneStatusChange}
              objectRuntime={objectRuntime}
              project={project}
              safeAreaInsets={safeAreaInsets}
              sceneRuntime={sceneRuntime}
              viewportPreferences={resources.viewportPreferences}
            />
            {contextRequest === null ? null : (
              <SceneContextMenuV4
                commandBindings={activeCommandEnvironment.bindings}
                interaction={resources.interaction}
                onClose={closeContextMenuRequest}
                project={project}
                request={contextRequest}
                safeAreaInsets={safeAreaInsets}
              />
            )}
          </>
        )}
        viewportBusy={sceneStatus === 'loading'}
      />
    </>
  )
}
