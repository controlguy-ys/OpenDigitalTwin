import { useCallback, useEffect, useRef, useState } from 'react'
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
import { SceneExplorer } from '../features/scene/SceneExplorer'
import { SceneContextMenu } from '../features/scene/SceneContextMenu'
import { Timeline } from '../features/ui/Timeline'
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

export function App() {
  const [sceneStatus, setSceneStatus] =
    useState<SceneRenderStatus>('loading')
  const [isImportOpen, setIsImportOpen] = useState(false)
  const [isRobotImportOpen, setIsRobotImportOpen] = useState(false)
  const [isRobotConfigurationOpen, setIsRobotConfigurationOpen] = useState(false)
  const [isRobotGeometryOpen, setIsRobotGeometryOpen] = useState(false)
  const [isCoordinateFramesOpen, setIsCoordinateFramesOpen] = useState(false)
  const [robotRig, setRobotRig] = useState<RobotRigRegistration | null>(null)
  const [viewportContextEntityId, setViewportContextEntityId] = useState<
    SceneEntityIdV1 | null | undefined
  >(undefined)
  const [sourceMode, setSourceMode] = useState<'simulation' | 'opcua'>(
    'simulation',
  )
  const interactionControllerRef = useRef<InteractionRuntimeController | null>(
    null,
  )
  const sourceQuality = useRobotStore((state) => state.sourceQuality)
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
    }).catch(() => undefined)

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

  return (
    <>
      <AppShell
        projectMenu={<ProjectMenu />}
        assetTree={
          <SceneExplorer
            onOpenRobotGeometry={() => setIsRobotGeometryOpen(true)}
            onOpenRobotMechanics={() => setIsRobotConfigurationOpen(true)}
            onSelect={selectSceneEntity}
          />
        }
        bottomRail={
          <>
            <Timeline
              disabled={jointControlsDisabled}
              source={simulationJointSource}
            />
            <CollisionPanel />
          </>
        }
        controlsDisabled={controlsDisabled}
        inspector={
          selectedSceneEntityId === null ? (
            <JointInspector
              disabled={jointControlsDisabled}
              onReset={handleResetInteraction}
              source={simulationJointSource}
            />
          ) : (
            <SceneEntityInspector
              disabled={controlsDisabled}
              entityId={selectedSceneEntityId}
            />
          )
        }
        onOpenStepImport={() => setIsImportOpen(true)}
        onOpenRobotImport={() => setIsRobotImportOpen(true)}
        onOpenRobotConfiguration={() => setIsRobotConfigurationOpen(true)}
        onOpenRobotGeometry={() => setIsRobotGeometryOpen(true)}
        onOpenCoordinateFrames={() => setIsCoordinateFramesOpen(true)}
        onSourceModeChange={(mode) => {
          useRobotStore.getState().stopPlayback()
          setSourceMode(mode)
        }}
        sourceMode={sourceMode}
        sourceQuality={sourceQuality}
        viewport={
          <>
            <SceneCanvas
              onContextMenu={setViewportContextEntityId}
              onStatusChange={setSceneStatus}
              registerRig={setRobotRig}
              registerInteractionController={(controller) => {
                interactionControllerRef.current = controller
              }}
            />
            {viewportContextEntityId === undefined ? null : (
              <SceneContextMenu
                entityId={viewportContextEntityId}
                onClose={() => setViewportContextEntityId(undefined)}
                onIsolate={(entityId) => sceneEditorStore.getState().isolate(entityId)}
                onOpenRobotGeometry={() => setIsRobotGeometryOpen(true)}
                onOpenRobotMechanics={() => setIsRobotConfigurationOpen(true)}
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
