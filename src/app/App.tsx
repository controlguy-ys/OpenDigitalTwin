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
import type { SerializableTransform } from '../domain/equipment/equipment'
import { useProjectStore } from '../features/project/project-store-browser'
import { ProjectMenu } from '../features/project/ProjectMenu'
import { CoordinateFramesDialog } from '../features/frames/CoordinateFramesDialog'
import type { RobotRigRegistration } from '../features/robot/RobotModel'

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
  const selectedEquipmentId = useInteractionStore(
    (state) => state.selectedEquipmentId,
  )
  const selectEquipment = useInteractionStore((state) => state.selectEquipment)
  const clearSelection = useInteractionStore((state) => state.clearSelection)
  const controlsDisabled = sceneStatus !== 'ready'
  const jointControlsDisabled = controlsDisabled || sourceMode === 'opcua'
  const activeJointSource =
    sourceMode === 'simulation' ? simulationJointSource : opcUaJointSource
  const selectedEquipmentRecord =
    allEquipmentRecords.find((record) => record.id === selectedEquipmentId) ?? null

  useEffect(() => {
    let active = true
    void (async () => {
      await Promise.all([
        hydrateEquipment(),
        hydrateObjectAssets(),
        hydrateRobotGeometry(),
        hydrateProject(),
      ])
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
    async (id: string) => {
      const objectInstance = useObjectAssetStore
        .getState()
        .instances.find((instance) => instance.id === id)
      if (objectInstance !== undefined) {
        const entityId = `object:${id}`
        useInteractionStore.getState().beginEquipmentRemoval(entityId)
        try {
          const controller = interactionControllerRef.current
          if (controller !== null) {
            await controller.releaseHeldEquipment(entityId)
          }
          await removeObjectInstance(id)
          if (useInteractionStore.getState().selectedEquipmentId === id) {
            clearSelection()
          }
        } finally {
          useInteractionStore.getState().endEquipmentRemoval(entityId)
        }
        return
      }
      await deleteImportedEquipment(id, {
        beginEquipmentRemoval: (equipmentId) =>
          useInteractionStore
            .getState()
            .beginEquipmentRemoval(equipmentId),
        endEquipmentRemoval: (equipmentId) => {
          useInteractionStore.getState().endEquipmentRemoval(equipmentId)
        },
        releaseHeldEquipment: async (equipmentId) => {
          const controller = interactionControllerRef.current
          const heldEntityId = useInteractionStore.getState().heldEntityId
          if (controller === null) {
            if (heldEntityId === `equipment:${equipmentId}`) {
              throw new Error(
                'The held equipment cannot be released while the 3D scene is unavailable.',
              )
            }
            return
          }
          await controller.releaseHeldEquipment(`equipment:${equipmentId}`)
        },
        removeEquipment,
        invalidateGeometry: (equipmentId) => {
          importedGeometryRepository.invalidate(equipmentId)
        },
        getSelectedEquipmentId: () =>
          useInteractionStore.getState().selectedEquipmentId,
        clearSelection,
      })
    },
    [clearSelection, removeEquipment, removeObjectInstance],
  )

  const findObjectInstance = useCallback(
    (id: string) => objectInstances.find((instance) => instance.id === id),
    [objectInstances],
  )

  const handlePreviewEquipmentTransform = useCallback(
    (id: string, transform: SerializableTransform) => {
      if (findObjectInstance(id) === undefined) {
        previewEquipmentTransform(id, transform)
      } else {
        previewObjectTransform(id, transform)
      }
    },
    [findObjectInstance, previewEquipmentTransform, previewObjectTransform],
  )

  const handleCommitEquipmentTransform = useCallback(
    async (id: string) => {
      await (findObjectInstance(id) === undefined
        ? commitEquipmentTransform(id)
        : commitObjectTransform(id))
    },
    [commitEquipmentTransform, commitObjectTransform, findObjectInstance],
  )

  const handleCancelEquipmentTransform = useCallback(
    (id: string) => {
      if (findObjectInstance(id) === undefined) cancelEquipmentTransform(id)
      else cancelObjectTransform(id)
    },
    [cancelEquipmentTransform, cancelObjectTransform, findObjectInstance],
  )

  const updateObjectField = useCallback(
    async (id: string, update: Record<string, unknown>) => {
      const instance = findObjectInstance(id)
      if (instance === undefined) return false
      await updateObjectInstance({ ...instance, ...update })
      return true
    },
    [findObjectInstance, updateObjectInstance],
  )

  const handleNumericStatus = useCallback(
    async (id: string, value: number) => {
      if (!(await updateObjectField(id, { numericStatus: value, statusSource: 'manual' }))) {
        await setEquipmentNumericStatus(id, value)
      }
    },
    [setEquipmentNumericStatus, updateObjectField],
  )

  const handleOverlayVisible = useCallback(
    async (id: string, visible: boolean) => {
      if (!(await updateObjectField(id, { statusOverlayVisible: visible }))) {
        await setEquipmentStatusOverlayVisible(id, visible)
      }
    },
    [setEquipmentStatusOverlayVisible, updateObjectField],
  )

  const handleStatusSource = useCallback(
    async (id: string, statusSource: 'manual' | 'opcua') => {
      if (!(await updateObjectField(id, { statusSource }))) {
        await setEquipmentStatusSource(id, statusSource)
      }
    },
    [setEquipmentStatusSource, updateObjectField],
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
            selectedEquipmentId={selectedEquipmentId}
          />
        }
        bottomRail={
          <Timeline
            disabled={jointControlsDisabled}
            source={simulationJointSource}
          />
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
              onApply={handleCommitEquipmentTransform}
              onCancel={handleCancelEquipmentTransform}
              onDelete={handleRemoveEquipment}
              onNumericStatus={handleNumericStatus}
              onOverlayVisible={handleOverlayVisible}
              onStatusSource={handleStatusSource}
              onPreview={handlePreviewEquipmentTransform}
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
        onSelect={selectEquipment}
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
