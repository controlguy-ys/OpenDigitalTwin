import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react'
import { useStore } from 'zustand'

import type {
  FrameIdV4,
  RigidTransformV4,
  RobotIdV4,
  WorkcellProjectV4,
} from '../core/project-v4/index.js'
import { CollisionPanelV4 } from '../features/collision/v4/CollisionPanel.js'
import type {
  CollisionGeometryProxyV4,
} from '../features/collision/v4/scene-entity-adapter-v4.js'
import { activeJobIdV4 } from '../features/interaction/v4/interaction-store.js'
import type { SceneSelectionTargetV4 } from '../features/interaction/v4/scene-selection.js'
import { RobotJobListV4 } from '../features/jobs/v4/RobotJobList.js'
import {
  browserProjectResourcesV4,
  type BrowserProjectResourcesV4,
} from '../features/project/project-store-browser.js'
import { ProjectMenuV4 } from '../features/project/ProjectMenu.js'
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
  SceneCanvasV4,
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
import {
  createShellLayoutControllerV4,
  type ShellLayoutControllerSnapshotV4,
  type ShellLayoutControllerV4,
} from '../features/ui/v4/shell-layout-controller.js'
import { initialShellLayoutBoundsV4 } from '../features/ui/v4/shell-layout-geometry.js'
import { AppShellV4 } from './AppShell.js'
import { createInitialProjectBootstrapV4 } from './initial-project-bootstrap.js'

const IDENTITY_POSE_V4: RigidTransformV4 = Object.freeze({
  positionM: Object.freeze([0, 0, 0] as const),
  quaternion: Object.freeze([0, 0, 0, 1] as const),
})

export interface AppPropsV4 {
  readonly resources?: BrowserProjectResourcesV4
  readonly gatewayPublisher?: RuntimeGatewayPublisherV4 | null
}

const browserRuntimeGatewayPublisherV4 = createRuntimeGatewayPublisherV4()

const IDLE_GATEWAY_PRESENTATION_V4: RuntimeGatewayPresentationV4 = Object.freeze({
  phase: 'idle',
  projectRevisionId: null,
  mode: null,
  endpointUrl: null,
  message: null,
})

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
  isDockVisible: () => false,
  isRibbonExpanded: () => false,
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

function sourceLabelV4(source: string | null): string | null {
  if (source === null) return null
  if (source === 'simulation') return 'Simulation'
  if (source === 'manual') return 'Manual'
  return source.startsWith('opcua:') ? 'OPC UA' : source
}

function nextCameraRequestV4(
  current: SceneCameraRequestV4 | undefined,
  projectRevisionId: string,
  command: SceneCameraRequestV4['command'],
): SceneCameraRequestV4 {
  return {
    id: (current?.id ?? 0) + 1,
    projectRevisionId,
    command,
  }
}

function projectFrameIdV4(
  role: 'mcp' | 'world',
  frames: readonly { readonly id: FrameIdV4; readonly role: string }[],
): FrameIdV4 | null {
  return frames.find((frame) => frame.role === role)?.id ?? null
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
  const shellLayoutSnapshot = useSyncExternalStore(
    shellLayoutController?.subscribe ?? subscribeInactiveShellLayoutV4,
    shellLayoutController?.getState ?? getInactiveShellLayoutSnapshotV4,
    shellLayoutController?.getState ?? getInactiveShellLayoutSnapshotV4,
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

  const project = projectState.activeProject
  const revisionId = project?.revisionId ?? null
  const projectPublicationUsable = projectState.status !== 'loading'
    && projectState.status !== 'recovery-required'
  const liveSceneRuntime = useMemo(() => (
    project !== null && robotRuntime.projectRevisionId === project.revisionId
      ? selectSceneRuntimeV4(project, robotRuntime)
      : null
  ), [project, robotRuntime])
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

  useEffect(() => {
    setContextRequestState(null)
    setRegistration(null)
    setSceneStatusState({
      projectRevisionId: revisionId,
      status: 'loading',
    })
    setCameraRequest(undefined)
    setGatewayPresentation({
      ...IDLE_GATEWAY_PRESENTATION_V4,
      projectRevisionId: revisionId,
    })
  }, [revisionId])

  useEffect(() => {
    if (gatewayPublisher === null || project === null || !ready) return
    const projectRevisionId = project.revisionId
    if (project.opcUa.mode !== 'off' && project.opcUa.mode !== 'server') {
      const unsupportedMode = project.opcUa.mode
      const abortController = new AbortController()
      let active = true
      setGatewayPresentation({
        phase: 'activating',
        projectRevisionId,
        mode: null,
        endpointUrl: null,
        message: null,
      })
      const runtimeOffProject: WorkcellProjectV4 = {
        ...project,
        opcUa: {
          mode: 'off',
          endpoints: [],
          mappings: [],
          actionBindings: [],
          bridgeRoutes: [],
        },
      }
      void gatewayPublisher.activateProject(
        runtimeOffProject,
        abortController.signal,
      ).then((status) => {
        if (!active) return
        if (
          status.projectId !== project.projectId
          || status.revisionId !== projectRevisionId
          || status.mode !== 'off'
        ) {
          throw new Error('Runtime Gateway did not deactivate the prior OPC UA runtime.')
        }
        setGatewayPresentation({
          phase: 'error',
          projectRevisionId,
          mode: null,
          endpointUrl: null,
          message: `OPC UA mode ${unsupportedMode} is not supported by this Runtime Gateway.`,
        })
      }).catch((error: unknown) => {
        if (!active) return
        setGatewayPresentation({
          phase: 'error',
          projectRevisionId,
          mode: null,
          endpointUrl: null,
          message: error instanceof Error ? error.message : String(error),
        })
      })
      return () => {
        active = false
        abortController.abort()
      }
    }
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
        mode: project.opcUa.mode === 'server' ? 'server' : 'off',
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
        mode: 'server',
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
        const retryStatus = await gatewayPublisher.publishRobotState(
          currentRobotStatePayload(),
          abortController.signal,
        )
        retrySucceeded = publishStatus(retryStatus)
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
      mode: project.opcUa.mode === 'server' ? 'server' : 'off',
      endpointUrl: null,
      message: null,
    })
    void gatewayPublisher.activateProject(
      project,
      abortController.signal,
    ).then((status) => {
      if (!publishStatus(status) || project.opcUa.mode !== 'server') return
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
    command: SceneCameraRequestV4['command'],
  ) => {
    if (revisionId === null) return
    setCameraRequest((current) => nextCameraRequestV4(
      current,
      revisionId,
      command,
    ))
  }, [revisionId])

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
    issueCameraRequest('focus-selection')
  }, [issueCameraRequest, resources.interaction])

  const runCommand = useCallback(async (
    command: () => Promise<unknown>,
  ): Promise<void> => {
    setCommandError(null)
    try {
      await command()
    } catch (error) {
      setCommandError(
        error instanceof Error ? error.message : 'Project V4 command failed.',
      )
    }
  }, [])

  if (
    shellLayoutController === null
    || !ready
    || project === null
    || runtimeBundle.active === null
    || liveSceneRuntime === null
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
  const setCurrentContextRequest = (
    request: SceneContextRequestV4 | null,
  ): void => {
    setContextRequestState(request === null ? null : {
      projectRevisionId: project.revisionId,
      request,
    })
  }
  const activeRobotId = interaction.activeRobotId
  const activeJobId = activeJobIdV4(interaction)
  const activeRobot = activeRobotId === null
    ? null
    : project.robots.find((robot) => robot.id === activeRobotId) ?? null
  const placementFrameId = projectFrameIdV4('mcp', project.scene.frames)
    ?? projectFrameIdV4('world', project.scene.frames)
  if (placementFrameId === null) {
    return (
      <RuntimePendingV4
        error="Project V4 has no placement Frame."
        recoveryRequired={false}
      />
    )
  }
  const selectedGroupId = interaction.selection?.kind === 'scene-group'
    ? interaction.selection.groupId
    : null
  const collisionProxies: readonly CollisionGeometryProxyV4[] =
    registration?.projectRevisionId === project.revisionId
      ? registration.value.collisionProxies
      : []
  const anyJobRunning = Object.values(jobRuntime.byRobotId)
    .some((state) => state.state === 'RUNNING')
  const controlsDisabled = sceneStatus !== 'ready'
  const currentGatewayPresentation = (
    gatewayPresentation.projectRevisionId === project.revisionId
  ) ? gatewayPresentation : {
      ...IDLE_GATEWAY_PRESENTATION_V4,
      projectRevisionId: project.revisionId,
    }

  const openCollision = (selection: SceneSelectionTargetV4): void => {
    resources.interaction.getState().select(selection)
    setCurrentContextRequest(null)
    shellLayoutController.setBottomTab('collision')
    shellLayoutController.setDockVisible('bottom', true)
  }

  return (
    <>
      {commandError === null ? null : (
        <p className="operation-feedback" role="alert">{commandError}</p>
      )}
      <AppShellV4
        assetTree={(
          <SceneExplorerV4
            commands={resources.sceneCommands}
            interaction={resources.interaction}
            onContextRequest={setCurrentContextRequest}
            onFocus={focusSelection}
            project={project}
            runtime={sceneRuntime}
          />
        )}
        bottomRail={(
          <BottomWorkspace
            activeTab={shellLayoutSnapshot.preferences.bottom.activeTab}
            collision={(
              <CollisionPanelV4
                jobRunning={anyJobRunning}
                onFocus={focusSelection}
                policy={runtimeBundle.active.collisionPolicy}
                projectRevisionId={project.revisionId}
                proxies={collisionProxies}
              />
            )}
            onActiveTabChange={shellLayoutController.setBottomTab}
            timeline={(
              <TimelineV4
                commands={resources.jobCommands}
                disabled={controlsDisabled}
                jobId={activeJobId}
                jobs={resources.jobs}
                playback={runtimeBundle.active.jobs.playback}
                project={project}
                robotId={activeRobotId}
              />
            )}
          />
        )}
        controlsDisabled={controlsDisabled}
        inspector={(
          <SceneEntityInspectorV4
            interaction={resources.interaction}
            jobCommands={resources.jobCommands}
            jobs={resources.jobs}
            project={project}
            robots={resources.robots}
            runtime={sceneRuntime}
            sceneCommands={resources.sceneCommands}
            selectedJobId={activeJobId}
            selection={interaction.selection}
          />
        )}
        jobTree={(
          <RobotJobListV4
            commands={resources.jobCommands}
            interaction={resources.interaction}
            jobs={resources.jobs}
            playback={runtimeBundle.active.jobs.playback}
            project={project}
            selectedRobotId={activeRobotId}
          />
        )}
        onCreateBox={() => {
          void runCommand(() => resources.sceneCommands.createBox({
            name: 'Box',
            parentFrameId: placementFrameId,
            localPose: IDENTITY_POSE_V4,
            dimensionsM: [0.1, 0.1, 0.1],
            color: '#38BDF8',
            groupId: selectedGroupId,
          }))
        }}
        onCreateCylinder={() => {
          void runCommand(() => resources.sceneCommands.createCylinder({
            name: 'Cylinder',
            parentFrameId: placementFrameId,
            localPose: IDENTITY_POSE_V4,
            radiusM: 0.05,
            heightM: 0.1,
            color: '#38BDF8',
            groupId: selectedGroupId,
          }))
        }}
        onCreateGroup={() => {
          void runCommand(() => resources.sceneCommands.createGroup(
            'Group',
            selectedGroupId,
          ))
        }}
        projectMenu={(
          <ProjectMenuV4
            gateway={currentGatewayPresentation}
            mutations={resources.mutations}
            store={resources.projectStore}
          />
        )}
        shellLayoutController={shellLayoutController}
        robotSourceLabel={sourceLabelV4(activeRobot?.jointSource ?? null)}
        viewport={(
          <>
            <SceneCanvasV4
              {...(activeCameraRequest === undefined
                ? {}
                : { cameraRequest: activeCameraRequest })}
              coordinateDisplay={resources.coordinateDisplay}
              geometryRepository={resources.geometry}
              interaction={resources.interaction}
              onContextRequest={setCurrentContextRequest}
              onRegistration={(value) => {
                setRegistration(value === null ? null : {
                  projectRevisionId: project.revisionId,
                  value,
                })
              }}
              onStatusChange={handleSceneStatusChange}
              project={project}
              sceneRuntime={sceneRuntime}
              viewportPreferences={resources.viewportPreferences}
            />
            {contextRequest === null ? null : (
              <SceneContextMenuV4
                commands={resources.sceneCommands}
                defaultPlacementFrameId={placementFrameId}
                interaction={resources.interaction}
                onClose={() => setCurrentContextRequest(null)}
                onFitAll={() => issueCameraRequest('fit-all')}
                onFocus={focusSelection}
                onOpenCollision={openCollision}
                onOpenMovingFrame={(entityId, frameId) => {
                  resources.interaction.getState().select({
                    kind: 'entity-frame',
                    entityId,
                    frameId,
                  })
                  setCurrentContextRequest(null)
                }}
                onOpenRobotBase={(robotId: RobotIdV4) => {
                  resources.interaction.getState().select({
                    kind: 'robot',
                    robotId,
                  })
                  setCurrentContextRequest(null)
                }}
                project={project}
                request={contextRequest}
                runtime={sceneRuntime}
              />
            )}
          </>
        )}
        viewportBusy={sceneStatus === 'loading'}
      />
    </>
  )
}
