import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { useStore } from 'zustand'
import type { SceneEntityIdV1 } from '../domain/project/scene-state-v1'
import { useEquipmentStore } from '../features/equipment/equipment-store'
import { useInteractionStore } from '../features/interaction/interaction-store'
import type { InteractionRuntimeController } from '../features/interaction/GraspController'
import { ImportStepDialog } from '../features/import/ImportStepDialog'
import { stepImportClient } from '../features/import/StepImportClient'
import { importedGeometryRepository } from '../features/import/imported-geometry-repository'
import { JointInspector } from '../features/joints/JointInspector'
import { simulationJointSource } from '../features/joints/SimulationJointSource'
import { opcUaJointSource } from '../features/joints/OpcUaJointSource'
import { useRobotStore } from '../features/joints/robot-store'
import {
  SceneCanvas,
  type SceneRenderStatus,
} from '../features/scene/SceneCanvas'
import { SceneEntityInspector } from '../features/scene/SceneEntityInspector'
import {
  LinearAxisInspector,
  type LinearAxisCommands,
} from '../features/scene/LinearAxisInspector'
import { ManualLinearAxisSource } from '../features/scene/linear-axis-source'
import type { LinearAxisCommittedStateV1 } from '../features/scene/linear-axis-source'
import { linearAxisConfigurationIdentity } from '../features/scene/LinearAxisRuntime'
import { SceneExplorer } from '../features/scene/SceneExplorer'
import { SceneContextMenu } from '../features/scene/SceneContextMenu'
import { RobotMountContactEditor } from '../features/scene/RobotMountContactEditor'
import { Timeline } from '../features/ui/Timeline'
import { BottomWorkspace } from '../features/ui/BottomWorkspace'
import { RobotJobList } from '../features/jobs/RobotJobList'
import { jobCommandService } from '../features/jobs/job-command-service'
import { RobotImportDialog } from '../features/robot/RobotImportDialog'
import { RobotConfigurationDialog } from '../features/robot/RobotConfigurationDialog'
import { useRobotGeometryStore } from '../features/robot/robot-geometry-store'
import { restoreRobotGeometryRecords } from '../features/robot/robot-step-import'
import { robotGeometryRepository } from '../features/robot/robot-geometry-repository'
import { RobotGeometryDialog } from '../features/robot/RobotGeometryDialog'
import { AppShell } from './AppShell'
import { useObjectAssetStore } from '../features/objects/object-asset-store'
import {
  projectStore,
  sceneCommandService,
  sceneEditorStore,
  useProjectStore,
} from '../features/project/project-store-browser'
import { ProjectMenu } from '../features/project/ProjectMenu'
import { CoordinateFramesDialog } from '../features/frames/CoordinateFramesDialog'
import type { RobotRigRegistration } from '../features/robot/RobotModel'
import { CollisionPanel } from '../features/collision/CollisionPanel'
import { usePublishedSceneRuntime } from '../features/scene/scene-runtime-selector'
import { useCollisionStore } from '../features/collision/collision-store'
import { deleteSceneEntitySafely } from './safe-scene-deletion'
import type { SceneContextRequest } from '../features/scene/scene-context-request'
import { MAX_POSES_PER_JOB, MAX_PROJECT_POSES } from '../domain/project/simulation-job-v1'
import {
  MAX_OBJECT_INSTANCES,
  MAX_STEP_OBJECT_ASSETS,
} from '../domain/project/project-v3'
import {
  OperationFeedback,
  operationFeedbackStore,
  runOperationWithFeedback,
} from '../features/ui/OperationFeedback'

type RobotInspectorTab = 'Transform' | 'Mechanics' | 'Geometry' | 'Frames'
const ROBOT_INSPECTOR_TABS = ['Transform', 'Mechanics', 'Geometry', 'Frames'] as const

export interface RobotTargetInspectorProps {
  readonly transform: ReactNode
  readonly onOpenMechanics: () => void
  readonly onOpenGeometry: () => void
  readonly onOpenFrames: () => void
  readonly mountContact?: ReactNode
}

export function RobotTargetInspector({
  transform,
  onOpenMechanics,
  onOpenGeometry,
  onOpenFrames,
  mountContact,
}: RobotTargetInspectorProps) {
  const [tab, setTab] = useState<RobotInspectorTab>('Transform')
  const tabRefs = useRef(new Map<RobotInspectorTab, HTMLButtonElement>())
  const openEditor = tab === 'Mechanics'
    ? onOpenMechanics
    : tab === 'Geometry'
      ? onOpenGeometry
      : onOpenFrames

  const selectAndFocusTab = (nextTab: RobotInspectorTab) => {
    setTab(nextTab)
    tabRefs.current.get(nextTab)?.focus()
  }

  return (
    <div className="robot-target-inspector">
      <div aria-label="Robot Inspector editors" role="tablist">
        {ROBOT_INSPECTOR_TABS.map((candidate, index) => (
          <button
            aria-controls={`robot-${candidate.toLowerCase()}-panel`}
            aria-selected={tab === candidate}
            id={`robot-${candidate.toLowerCase()}-tab`}
            key={candidate}
            onKeyDown={(event) => {
              let nextIndex: number | null = null
              if (event.key === 'Home') nextIndex = 0
              else if (event.key === 'End') nextIndex = ROBOT_INSPECTOR_TABS.length - 1
              else if (event.key === 'ArrowRight') {
                nextIndex = (index + 1) % ROBOT_INSPECTOR_TABS.length
              } else if (event.key === 'ArrowLeft') {
                nextIndex = (index - 1 + ROBOT_INSPECTOR_TABS.length) % ROBOT_INSPECTOR_TABS.length
              }
              if (nextIndex === null) return
              event.preventDefault()
              selectAndFocusTab(ROBOT_INSPECTOR_TABS[nextIndex]!)
            }}
            onClick={() => setTab(candidate)}
            ref={(node) => {
              if (node === null) tabRefs.current.delete(candidate)
              else tabRefs.current.set(candidate, node)
            }}
            role="tab"
            tabIndex={tab === candidate ? 0 : -1}
            type="button"
          >
            {candidate}
          </button>
        ))}
      </div>
      <section
        aria-label={tab}
        className="robot-target-inspector-panel"
        id={`robot-${tab.toLowerCase()}-panel`}
        role="tabpanel"
      >
        {tab === 'Transform' ? <>{transform}{mountContact}</> : (
          <button onClick={openEditor} type="button">Open {tab} editor</button>
        )}
      </section>
    </div>
  )
}

export function clearDeletedLinearAxisEditorState(): void {
  const editor = sceneEditorStore.getState()
  editor.select(null)
  editor.cancelDraft()
  editor.showAll()
}

export interface LinearAxisTargetInspectorProps {
  readonly disabled: boolean
  readonly source: ManualLinearAxisSource
  readonly commands?: LinearAxisCommands
}

export function LinearAxisTargetInspector({
  disabled,
  source,
  commands,
}: LinearAxisTargetInspectorProps) {
  return (
    <div className="linear-axis-target-inspector">
      <SceneEntityInspector
        disabled={disabled}
        entityId="linear-axis:active"
      />
      <LinearAxisInspector
        {...(commands === undefined ? {} : { commands })}
        disabled={disabled}
        onDeleted={clearDeletedLinearAxisEditorState}
        source={source}
      />
    </div>
  )
}

export function App() {
  const [sceneStatus, setSceneStatus] =
    useState<SceneRenderStatus>('loading')
  const [isImportOpen, setIsImportOpen] = useState(false)
  const [isRobotImportOpen, setIsRobotImportOpen] = useState(false)
  const [isRobotConfigurationOpen, setIsRobotConfigurationOpen] = useState(false)
  const [isRobotGeometryOpen, setIsRobotGeometryOpen] = useState(false)
  const [isCoordinateFramesOpen, setIsCoordinateFramesOpen] = useState(false)
  const [robotRig, setRobotRig] = useState<RobotRigRegistration | null>(null)
  const [viewportContextRequest, setViewportContextRequest] = useState<
    SceneContextRequest | undefined
  >(undefined)
  const [collisionFocusRequest, setCollisionFocusRequest] = useState(0)
  const [inspectorOpenRequest, setInspectorOpenRequest] = useState(0)
  const [cameraCommandRequest, setCameraCommandRequest] = useState<
    Readonly<{ id: number; command: 'fit-all' | 'focus-selection' }> | undefined
  >(undefined)
  const [sourceMode, setSourceMode] = useState<'simulation' | 'opcua'>(
    'simulation',
  )
  const interactionControllerRef = useRef<InteractionRuntimeController | null>(
    null,
  )
  const sourceQuality = useRobotStore((state) => state.sourceQuality)
  const jointAnglesDeg = useRobotStore((state) => state.anglesDeg)
  const hydrateEquipment = useEquipmentStore((state) => state.hydrate)
  const hydrateObjectAssets = useObjectAssetStore((state) => state.hydrate)
  const hydrateRobotGeometry = useRobotGeometryStore((state) => state.hydrate)
  const hydrateProject = useProjectStore((state) => state.hydrate)
  const selection = useInteractionStore((state) => state.selection)
  const selectEquipment = useInteractionStore((state) => state.selectEquipment)
  const selectedSceneEntityId = useStore(
    sceneEditorStore,
    (state) => state.selectedEntityId,
  )
  const isolatedSceneEntityId = useStore(
    sceneEditorStore,
    (state) => state.isolatedEntityId,
  )
  const sceneRuntime = usePublishedSceneRuntime()
  const axisRuntime = sceneRuntime.linearAxis
  const axisEntityId = axisRuntime?.source.kind === 'linear-axis'
    ? axisRuntime.entityId
    : null
  const linearAxisSource = useMemo(() => {
    if (
      axisRuntime?.source.kind !== 'linear-axis' ||
      axisEntityId === null
    ) return null
    return new ManualLinearAxisSource({
      initialPositionM: axisRuntime.source.currentPositionM,
      homePositionM: axisRuntime.source.homePositionM,
      commitPositionM: sceneCommandService.setLinearAxisPosition,
      commitHome: sceneCommandService.moveLinearAxisHome,
    })
  }, [
    axisEntityId,
    sceneCommandService.moveLinearAxisHome,
    sceneCommandService.setLinearAxisPosition,
  ])
  const axisConfigurationIdentity = linearAxisConfigurationIdentity(sceneRuntime)
  const linearAxisCommittedState: LinearAxisCommittedStateV1 | null =
    axisRuntime?.source.kind === 'linear-axis' && axisConfigurationIdentity !== null
      ? Object.freeze({
        axisEntityId: axisRuntime.entityId,
        configurationIdentity: axisConfigurationIdentity,
        positionM: axisRuntime.source.currentPositionM,
        homePositionM: axisRuntime.source.homePositionM,
      })
      : null
  const activeSnapshot = useProjectStore((state) => state.activeSnapshot)
  const stepAssetCount = activeSnapshot?.objectAssets.filter(
    (asset) => asset.sourceKind === 'step',
  ).length ?? 0
  const stepImportUnavailableReason = stepAssetCount >= MAX_STEP_OBJECT_ASSETS
    ? `STEP Asset limit reached: ${stepAssetCount} of ${MAX_STEP_OBJECT_ASSETS}.`
    : (activeSnapshot?.objectInstances.length ?? 0) >= MAX_OBJECT_INSTANCES
      ? `Object Instance limit reached: ${activeSnapshot?.objectInstances.length ?? 0} of ${MAX_OBJECT_INSTANCES}.`
      : undefined
  const activeJob = activeSnapshot?.simulation.jobs.find(
    ({ id }) => id === activeSnapshot.simulation.activeJobId,
  )
  const totalPoseCount = activeSnapshot?.simulation.jobs.reduce(
    (count, job) => count + job.poses.length,
    0,
  ) ?? 0
  const savePoseUnavailableReason = activeJob === undefined
    ? 'Create a Job in Robot Jobs and select it to save a Pose.'
    : activeJob.poses.length >= MAX_POSES_PER_JOB
      ? `This Job reached the ${MAX_POSES_PER_JOB} Pose limit.`
      : totalPoseCount >= MAX_PROJECT_POSES
        ? `This Project reached the ${MAX_PROJECT_POSES} Pose limit.`
        : null
  const collisionCount = useCollisionStore((state) =>
    state.validationReport?.findings.length ?? state.currentFindings.length)
  const controlsDisabled = sceneStatus !== 'ready'
  const jointControlsDisabled = controlsDisabled || sourceMode === 'opcua'
  const activeJointSource =
    sourceMode === 'simulation' ? simulationJointSource : opcUaJointSource

  const selectSceneEntity = useCallback((entityId: SceneEntityIdV1) => {
    sceneEditorStore.getState().select(entityId)
    if (entityId.startsWith('object:') || entityId.startsWith('equipment:')) {
      selectEquipment(entityId)
    } else if (entityId === 'robot:active') {
      useInteractionStore.getState().selectRobot()
    } else {
      useInteractionStore.getState().clearSelection()
    }
  }, [selectEquipment])
  const focusSceneEntity = useCallback((entityId: SceneEntityIdV1) => {
    selectSceneEntity(entityId)
    setCameraCommandRequest((current) => ({
      id: (current?.id ?? 0) + 1,
      command: 'focus-selection',
    }))
  }, [selectSceneEntity])
  const fitAllSceneEntities = useCallback(() => {
    setCameraCommandRequest((current) => ({
      id: (current?.id ?? 0) + 1,
      command: 'fit-all',
    }))
  }, [])
  const runCreateSceneEntity = useCallback(async (
    command: () => Promise<SceneEntityIdV1>,
  ) => {
    await runOperationWithFeedback(command, selectSceneEntity)
  }, [selectSceneEntity])

  useEffect(() => {
    let active = true
    void (async () => {
      await Promise.all([
        hydrateEquipment(),
        hydrateObjectAssets(),
        hydrateRobotGeometry(),
      ])
      await hydrateProject()
      if (projectStore.getState().activeSnapshot !== null) return
      if (active) {
        const robotRecords = useRobotGeometryStore.getState().links
        const restoredRobot =
          robotRecords.length === 0
            ? null
            : await restoreRobotGeometryRecords(robotRecords, stepImportClient)
                .catch(() => null)
        if (active && restoredRobot !== null) {
          robotGeometryRepository.replace(restoredRobot)
        }
        await Promise.all([
          importedGeometryRepository.restore(useEquipmentStore.getState().records),
          importedGeometryRepository.restoreObjectAssets(
            useObjectAssetStore.getState().assets,
          ),
        ])
      }
    })()

    return () => {
      active = false
    }
  }, [hydrateEquipment, hydrateObjectAssets, hydrateProject, hydrateRobotGeometry])

  useEffect(() => {
    if (selection?.kind === 'equipment') {
      sceneEditorStore.getState().select(selection.entityId)
    } else if (selection?.kind === 'robot' || selection?.kind === 'robot-link') {
      sceneEditorStore.getState().select('robot:active')
    }
  }, [selection])

  useEffect(() => {
    const unsubscribe = activeJointSource.subscribe((frame) => {
      useRobotStore.getState().applyFrame(frame)
    })
    const unsubscribeEquipment =
      activeJointSource === opcUaJointSource
        ? opcUaJointSource.subscribeEquipment((values) => {
            useEquipmentStore.getState().applyOpcUaEquipmentStatuses(values)
            useObjectAssetStore.getState().applyOpcUaStatuses(values)
          })
        : () => undefined
    void activeJointSource.connect().then(() => {
      if (activeJointSource === simulationJointSource) {
        simulationJointSource.setAngles(useRobotStore.getState().anglesDeg)
      }
    }).catch((error) => operationFeedbackStore.getState().publishError(error))

    return () => {
      unsubscribe()
      unsubscribeEquipment()
      void activeJointSource.disconnect()
    }
  }, [activeJointSource])

  const handleResetInteraction = useCallback(async () => {
    const controller = interactionControllerRef.current
    if (controller === null) {
      useInteractionStore.getState().resetInteraction()
      return
    }
    await controller.resetInteraction()
  }, [])

  const handleDeleteSceneEntity = useCallback(
    (entityId: SceneEntityIdV1) => deleteSceneEntitySafely(entityId, {
      runtime: sceneRuntime,
      beginRemoval: (externalId) =>
        useInteractionStore.getState().beginEquipmentRemoval(externalId),
      endRemoval: (externalId) =>
        useInteractionStore.getState().endEquipmentRemoval(externalId),
      getHeldEntityId: () => useInteractionStore.getState().heldEntityId,
      releaseHeldEntity: async (externalId) => {
        const controller = interactionControllerRef.current
        if (controller === null) {
          if (useInteractionStore.getState().heldEntityId === externalId) {
            throw new Error('The held Entity cannot be released while the 3D scene is unavailable.')
          }
          return
        }
        await controller.releaseHeldEquipment(externalId)
      },
      deleteEntity: sceneCommandService.deleteEntity,
      deleteGroupAndContents: sceneCommandService.deleteGroupAndContents,
      clearInteractionSelection: (externalId) =>
        useInteractionStore.getState().clearSelectionForEntity(externalId),
      clearCollisionPairs: (externalId) => {
        useInteractionStore.getState().clearCollisionPairsForEntity(externalId)
      },
      getSceneSelection: () => sceneEditorStore.getState().selectedEntityId,
      clearSceneSelection: () => sceneEditorStore.getState().select(null),
    }),
    [sceneRuntime],
  )

  return (
    <>
      {import.meta.env.MODE === 'test' ? (
        <>
          <output data-testid="project-semantic-diagnostic" hidden>
            {activeSnapshot === undefined || activeSnapshot === null
              ? 'null'
              : JSON.stringify(activeSnapshot)}
          </output>
          <output data-testid="scene-editor-diagnostic" hidden>
            {isolatedSceneEntityId ?? 'null'}
          </output>
          <output data-testid="robot-joint-diagnostic" hidden>
            {JSON.stringify(jointAnglesDeg)}
          </output>
        </>
      ) : null}
      <OperationFeedback />
      <AppShell
        projectMenu={<ProjectMenu />}
        assetTree={
          <SceneExplorer
            onDelete={handleDeleteSceneEntity}
            onOpenRobotCollision={() =>
              setCollisionFocusRequest((value) => value + 1)}
            onOpenRobotGeometry={() => setIsRobotGeometryOpen(true)}
            onOpenRobotMechanics={() => setIsRobotConfigurationOpen(true)}
            onFitAll={fitAllSceneEntities}
            onFocus={focusSceneEntity}
            onOpenAxisSettings={() => {
              selectSceneEntity('linear-axis:active')
              setInspectorOpenRequest((value) => value + 1)
            }}
            onSelect={selectSceneEntity}
          />
        }
        jobTree={<RobotJobList />}
        bottomRail={
          <BottomWorkspace
            collision={<CollisionPanel focusRequest={collisionFocusRequest} />}
            collisionCount={collisionCount}
            collisionOpenRequest={collisionFocusRequest}
            timeline={<Timeline
              disabled={jointControlsDisabled}
              source={simulationJointSource}
            />}
          />
        }
        bottomRailOpenRequest={collisionFocusRequest}
        inspectorOpenRequest={inspectorOpenRequest}
        controlsDisabled={controlsDisabled}
        inspector={
          selectedSceneEntityId === null ? (
            <JointInspector
              canSavePose={savePoseUnavailableReason === null}
              disabled={jointControlsDisabled}
              onReset={handleResetInteraction}
              onSavePose={async () => {
                await jobCommandService.saveCurrentPose(
                  `Pose ${(activeJob?.poses.length ?? 0) + 1}`,
                )
              }}
              savePoseUnavailableReason={savePoseUnavailableReason ?? undefined}
              source={simulationJointSource}
            />
          ) : selectedSceneEntityId === 'robot:active' ? (
          <RobotTargetInspector
              mountContact={(
                <RobotMountContactEditor
                  configuration={activeSnapshot?.scene.robotMountContact ?? null}
                  disabled={controlsDisabled}
                />
              )}
              onOpenFrames={() => setIsCoordinateFramesOpen(true)}
              onOpenGeometry={() => setIsRobotGeometryOpen(true)}
              onOpenMechanics={() => setIsRobotConfigurationOpen(true)}
              transform={
                <SceneEntityInspector
                  disabled={controlsDisabled}
                  entityId={selectedSceneEntityId}
                />
              }
            />
          ) : selectedSceneEntityId === 'linear-axis:active' ? (
            linearAxisSource === null ? null : (
              <LinearAxisTargetInspector
                disabled={controlsDisabled}
                source={linearAxisSource}
              />
            )
          ) : (
            <SceneEntityInspector
              disabled={controlsDisabled}
              entityId={selectedSceneEntityId}
            />
          )
        }
        onOpenStepImport={() => setIsImportOpen(true)}
        onOpenRobotImport={() => setIsRobotImportOpen(true)}
        onCreateBox={() => {
          void runCreateSceneEntity(() => sceneCommandService.createBox({
            name: 'Box', dimensionsM: [0.1, 0.1, 0.1], color: '#38BDF8',
          }))
        }}
        onCreateCylinder={() => {
          void runCreateSceneEntity(() => sceneCommandService.createCylinder({
            name: 'Cylinder', radiusM: 0.05, heightM: 0.1, color: '#38BDF8',
          }))
        }}
        onCreateGroup={() => {
          void runCreateSceneEntity(() => sceneCommandService.createGroup('Group'))
        }}
        linearAxisAvailable={axisRuntime === null}
        onCreateLinearAxis={() => {
          void runCreateSceneEntity(async () => {
            await sceneCommandService.createLinearAxis({
            direction: 'x', minPositionM: 0, maxPositionM: 2,
            homePositionM: 0, currentPositionM: 0,
            carriageEntityId: null, robotEntityId: null,
            })
            return 'linear-axis:active'
          })
        }}
        onSourceModeChange={(mode) => {
          useRobotStore.getState().stopPlayback()
          setSourceMode(mode)
        }}
        sourceMode={sourceMode}
        sourceQuality={sourceQuality}
        viewport={
          <>
            <SceneCanvas
              {...(cameraCommandRequest === undefined ? {} : { cameraCommandRequest })}
              linearAxisCommittedState={linearAxisCommittedState}
              linearAxisSource={linearAxisSource}
              onContextMenu={(entityId, position) => {
                setViewportContextRequest({ entityId, position })
              }}
              onStatusChange={setSceneStatus}
              registerRig={setRobotRig}
              registerInteractionController={(controller) => {
                interactionControllerRef.current = controller
              }}
            />
            {viewportContextRequest === undefined ? null : (
              <SceneContextMenu
                entityId={viewportContextRequest.entityId}
                onDelete={handleDeleteSceneEntity}
                onFitAll={fitAllSceneEntities}
                onFocus={focusSceneEntity}
                onClose={() => setViewportContextRequest(undefined)}
                onIsolate={(entityId) => sceneEditorStore.getState().isolate(entityId)}
                onOpenRobotCollision={() =>
                  setCollisionFocusRequest((value) => value + 1)}
                onOpenRobotGeometry={() => setIsRobotGeometryOpen(true)}
                onOpenRobotMechanics={() => setIsRobotConfigurationOpen(true)}
                onOpenAxisSettings={() => {
                  selectSceneEntity('linear-axis:active')
                  setInspectorOpenRequest((value) => value + 1)
                }}
                position={viewportContextRequest.position}
              />
            )}
          </>
        }
        viewportBusy={sceneStatus === 'loading'}
      />
      <ImportStepDialog
        cache={importedGeometryRepository}
        client={stepImportClient}
        commands={sceneCommandService}
        {...(stepImportUnavailableReason === undefined
          ? {}
          : { importUnavailableReason: stepImportUnavailableReason })}
        onClose={() => setIsImportOpen(false)}
        onSelect={(id) => selectSceneEntity(`object:${id}`)}
        open={isImportOpen}
      />
      <RobotImportDialog
        onClose={() => setIsRobotImportOpen(false)}
        open={isRobotImportOpen}
      />
      <RobotConfigurationDialog
        onClose={() => setIsRobotConfigurationOpen(false)}
        open={isRobotConfigurationOpen}
      />
      <RobotGeometryDialog
        onClose={() => setIsRobotGeometryOpen(false)}
        open={isRobotGeometryOpen}
      />
      <CoordinateFramesDialog
        onClose={() => setIsCoordinateFramesOpen(false)}
        open={isCoordinateFramesOpen}
        rig={robotRig}
      />
    </>
  )
}
