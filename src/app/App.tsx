import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { EquipmentAssetList } from '../features/equipment/EquipmentAssetList'
import { EquipmentInspector } from '../features/equipment/EquipmentInspector'
import { useEquipmentStore } from '../features/equipment/equipment-store'
import { useInteractionStore } from '../features/interaction/interaction-store'
import type { InteractionRuntimeController } from '../features/interaction/GraspController'
import { ImportStepDialog } from '../features/import/ImportStepDialog'
import { stepImportClient } from '../features/import/StepImportClient'
import { deleteImportedEquipment } from '../features/import/imported-equipment-actions'
import { importedGeometryRepository } from '../features/import/imported-geometry-repository'
import { JointInspector } from '../features/joints/JointInspector'
import { simulationJointSource } from '../features/joints/SimulationJointSource'
import { opcUaJointSource } from '../features/joints/OpcUaJointSource'
import { useRobotStore } from '../features/joints/robot-store'
import {
  SceneCanvas,
  type SceneRenderStatus,
} from '../features/scene/SceneCanvas'
import { Timeline } from '../features/ui/Timeline'
import { RobotImportDialog } from '../features/robot/RobotImportDialog'
import { RobotConfigurationDialog } from '../features/robot/RobotConfigurationDialog'
import { useRobotGeometryStore } from '../features/robot/robot-geometry-store'
import { restoreRobotGeometryRecords } from '../features/robot/robot-step-import'
import { robotGeometryRepository } from '../features/robot/robot-geometry-repository'
import { RobotGeometryDialog } from '../features/robot/RobotGeometryDialog'
import { AppShell } from './AppShell'
import { useObjectAssetStore } from '../features/objects/object-asset-store'
import { objectRecords } from '../features/objects/object-equipment-adapter'
import {
  projectStore,
  useProjectStore,
} from '../features/project/project-store-browser'
import { ProjectMenu } from '../features/project/ProjectMenu'
import { CoordinateFramesDialog } from '../features/frames/CoordinateFramesDialog'
import type { RobotRigRegistration } from '../features/robot/RobotModel'
import type { ExternalCollisionEntityId } from '../features/interaction/interaction-store'
import { removeCanonicalExternalEntity } from './external-entity-removal'
import { findEquipmentRecordByEntityId } from '../features/equipment/equipment-entity-selection'
import { createCanonicalExternalEntityMutations } from './external-entity-mutations'
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
  const [sourceMode, setSourceMode] = useState<'simulation' | 'opcua'>(
    'simulation',
  )
  const interactionControllerRef = useRef<InteractionRuntimeController | null>(
    null,
  )
  const sourceQuality = useRobotStore((state) => state.sourceQuality)
  const hydrateEquipment = useEquipmentStore((state) => state.hydrate)
  const equipmentRecords = useEquipmentStore((state) => state.records)
  const objectAssets = useObjectAssetStore((state) => state.assets)
  const objectInstances = useObjectAssetStore((state) => state.instances)
  const hydrateObjectAssets = useObjectAssetStore((state) => state.hydrate)
  const hydrateRobotGeometry = useRobotGeometryStore((state) => state.hydrate)
  const hydrateProject = useProjectStore((state) => state.hydrate)
  const addAssetInstance = useObjectAssetStore((state) => state.addAssetInstance)
  const updateObjectInstance = useObjectAssetStore((state) => state.updateInstance)
  const removeObjectInstance = useObjectAssetStore((state) => state.removeInstance)
  const previewObjectTransform = useObjectAssetStore(
    (state) => state.previewInstanceTransform,
  )
  const commitObjectTransform = useObjectAssetStore(
    (state) => state.commitInstanceTransform,
  )
  const cancelObjectTransform = useObjectAssetStore(
    (state) => state.cancelInstanceTransform,
  )
  const allEquipmentRecords = useMemo(
    () => [...equipmentRecords, ...objectRecords(objectAssets, objectInstances)],
    [equipmentRecords, objectAssets, objectInstances],
  )
  const removeEquipment = useEquipmentStore((state) => state.removeEquipment)
  const previewEquipmentTransform = useEquipmentStore(
    (state) => state.previewEquipmentTransform,
  )
  const commitEquipmentTransform = useEquipmentStore(
    (state) => state.commitEquipmentTransform,
  )
  const cancelEquipmentTransform = useEquipmentStore(
    (state) => state.cancelEquipmentTransform,
  )
  const setEquipmentNumericStatus = useEquipmentStore(
    (state) => state.setEquipmentNumericStatus,
  )
  const setEquipmentStatusOverlayVisible = useEquipmentStore(
    (state) => state.setEquipmentStatusOverlayVisible,
  )
  const setEquipmentStatusSource = useEquipmentStore(
    (state) => state.setEquipmentStatusSource,
  )
  const selection = useInteractionStore((state) => state.selection)
  const selectEquipment = useInteractionStore((state) => state.selectEquipment)
  const clearSelection = useInteractionStore((state) => state.clearSelection)
  const controlsDisabled = sceneStatus !== 'ready'
  const jointControlsDisabled = controlsDisabled || sourceMode === 'opcua'
  const activeJointSource =
    sourceMode === 'simulation' ? simulationJointSource : opcUaJointSource
  const selectedEntityId =
    selection?.kind === 'equipment' ? selection.entityId : null
  const selectedEquipmentRecord = findEquipmentRecordByEntityId(
    allEquipmentRecords,
    selectedEntityId,
  )

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

  const handleRemoveEquipment = useCallback(
    async (entityId: ExternalCollisionEntityId) => {
      await removeCanonicalExternalEntity(entityId, {
        removeObject: async (id) => {
          const objectInstance = useObjectAssetStore
            .getState()
            .instances.find((instance) => instance.id === id)
          if (objectInstance === undefined) return
          useInteractionStore.getState().beginEquipmentRemoval(entityId)
          try {
            const controller = interactionControllerRef.current
            if (controller !== null) {
              await controller.releaseHeldEquipment(entityId)
            }
            await removeObjectInstance(id)
            useInteractionStore.getState().clearSelectionForEntity(entityId)
          } finally {
            useInteractionStore.getState().endEquipmentRemoval(entityId)
          }
        },
        removeEquipment: async (id) => {
          await deleteImportedEquipment(id, {
            beginEquipmentRemoval: () =>
              useInteractionStore
                .getState()
                .beginEquipmentRemoval(entityId),
            endEquipmentRemoval: () => {
              useInteractionStore.getState().endEquipmentRemoval(entityId)
            },
            releaseHeldEquipment: async (equipmentId) => {
              const controller = interactionControllerRef.current
              const heldEntityId = useInteractionStore.getState().heldEntityId
              if (controller === null) {
                if (heldEntityId === entityId) {
                  throw new Error(
                    'The held equipment cannot be released while the 3D scene is unavailable.',
                  )
                }
                return
              }
              await controller.releaseHeldEquipment(
                `equipment:${equipmentId}`,
              )
            },
            removeEquipment,
            invalidateGeometry: (equipmentId) => {
              importedGeometryRepository.invalidate(equipmentId)
            },
            getSelectedEquipmentId: () => {
              const currentSelection = useInteractionStore.getState().selection
              return currentSelection?.kind === 'equipment' &&
                currentSelection.entityId === entityId
                ? id
                : null
            },
            clearSelection,
          })
        },
      })
    },
    [clearSelection, removeEquipment, removeObjectInstance],
  )

  const updateObjectField = useCallback(
    async (id: string, update: Record<string, unknown>) => {
      const instance = useObjectAssetStore
        .getState()
        .instances.find((candidate) => candidate.id === id)
      if (instance === undefined) return
      await updateObjectInstance({ ...instance, ...update })
    },
    [updateObjectInstance],
  )

  const externalEntityMutations = useMemo(
    () =>
      createCanonicalExternalEntityMutations({
        previewEquipment: previewEquipmentTransform,
        previewObject: previewObjectTransform,
        commitEquipment: commitEquipmentTransform,
        commitObject: commitObjectTransform,
        cancelEquipment: cancelEquipmentTransform,
        cancelObject: cancelObjectTransform,
        setEquipmentNumericStatus,
        setEquipmentOverlayVisible: setEquipmentStatusOverlayVisible,
        setEquipmentStatusSource,
        updateObject: updateObjectField,
      }),
    [
      cancelEquipmentTransform,
      cancelObjectTransform,
      commitEquipmentTransform,
      commitObjectTransform,
      previewEquipmentTransform,
      previewObjectTransform,
      setEquipmentNumericStatus,
      setEquipmentStatusOverlayVisible,
      setEquipmentStatusSource,
      updateObjectField,
    ],
  )

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
          <EquipmentAssetList
            onRemove={handleRemoveEquipment}
            onSelect={selectEquipment}
            records={allEquipmentRecords}
            selectedEntityId={selectedEntityId}
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
          selectedEquipmentRecord === null ? (
            <JointInspector
              disabled={jointControlsDisabled}
              onReset={handleResetInteraction}
              source={simulationJointSource}
            />
          ) : (
            <EquipmentInspector
              disabled={controlsDisabled}
              onApply={externalEntityMutations.commit}
              onCancel={externalEntityMutations.cancel}
              onDelete={handleRemoveEquipment}
              onNumericStatus={externalEntityMutations.setNumericStatus}
              onOverlayVisible={externalEntityMutations.setOverlayVisible}
              onStatusSource={externalEntityMutations.setStatusSource}
              onPreview={externalEntityMutations.preview}
              record={selectedEquipmentRecord}
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
          <SceneCanvas
            onStatusChange={setSceneStatus}
            registerRig={setRobotRig}
            registerInteractionController={(controller) => {
              interactionControllerRef.current = controller
            }}
          />
        }
        viewportBusy={sceneStatus === 'loading'}
      />
      <ImportStepDialog
        cache={importedGeometryRepository}
        client={stepImportClient}
        onClose={() => setIsImportOpen(false)}
        onCommitAsset={addAssetInstance}
        onSelect={(id) => selectEquipment(`object:${id}`)}
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
