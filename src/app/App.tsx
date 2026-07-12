import { useCallback, useEffect, useRef, useState } from 'react'
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
import { AppShell } from './AppShell'

export function App() {
  const [sceneStatus, setSceneStatus] =
    useState<SceneRenderStatus>('loading')
  const [isImportOpen, setIsImportOpen] = useState(false)
  const [isRobotImportOpen, setIsRobotImportOpen] = useState(false)
  const [isRobotConfigurationOpen, setIsRobotConfigurationOpen] = useState(false)
  const [sourceMode, setSourceMode] = useState<'simulation' | 'opcua'>(
    'simulation',
  )
  const interactionControllerRef = useRef<InteractionRuntimeController | null>(
    null,
  )
  const sourceQuality = useRobotStore((state) => state.sourceQuality)
  const hydrateEquipment = useEquipmentStore((state) => state.hydrate)
  const equipmentRecords = useEquipmentStore((state) => state.records)
  const upsertEquipment = useEquipmentStore((state) => state.upsertEquipment)
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
    equipmentRecords.find((record) => record.id === selectedEquipmentId) ?? null

  useEffect(() => {
    let active = true
    void (async () => {
      await hydrateEquipment()
      if (active) {
        await importedGeometryRepository.restore(
          useEquipmentStore.getState().records,
        )
      }
    })()

    return () => {
      active = false
    }
  }, [hydrateEquipment])

  useEffect(() => {
    const unsubscribe = activeJointSource.subscribe((frame) => {
      useRobotStore.getState().applyFrame(frame)
    })
    const unsubscribeEquipment =
      activeJointSource === opcUaJointSource
        ? opcUaJointSource.subscribeEquipment((values) => {
            useEquipmentStore.getState().applyOpcUaEquipmentStatuses(values)
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
    (id: string) =>
      deleteImportedEquipment(id, {
        beginEquipmentRemoval: (equipmentId) =>
          useInteractionStore
            .getState()
            .beginEquipmentRemoval(equipmentId),
        endEquipmentRemoval: (equipmentId) => {
          useInteractionStore.getState().endEquipmentRemoval(equipmentId)
        },
        releaseHeldEquipment: async (equipmentId) => {
          const controller = interactionControllerRef.current
          const heldEquipmentId =
            useInteractionStore.getState().heldEquipmentId
          if (controller === null) {
            if (heldEquipmentId === equipmentId) {
              throw new Error(
                'The held equipment cannot be released while the 3D scene is unavailable.',
              )
            }
            return
          }
          await controller.releaseHeldEquipment(equipmentId)
        },
        removeEquipment,
        invalidateGeometry: (equipmentId) => {
          importedGeometryRepository.invalidate(equipmentId)
        },
        getSelectedEquipmentId: () =>
          useInteractionStore.getState().selectedEquipmentId,
        clearSelection,
      }),
    [clearSelection, removeEquipment],
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
        assetTree={
          <EquipmentAssetList
            onRemove={handleRemoveEquipment}
            onSelect={selectEquipment}
            records={equipmentRecords}
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
              onApply={commitEquipmentTransform}
              onCancel={cancelEquipmentTransform}
              onDelete={handleRemoveEquipment}
              onNumericStatus={setEquipmentNumericStatus}
              onOverlayVisible={setEquipmentStatusOverlayVisible}
              onStatusSource={setEquipmentStatusSource}
              onPreview={previewEquipmentTransform}
              record={selectedEquipmentRecord}
            />
          )
        }
        onOpenStepImport={() => setIsImportOpen(true)}
        onOpenRobotImport={() => setIsRobotImportOpen(true)}
        onOpenRobotConfiguration={() => setIsRobotConfigurationOpen(true)}
        onSourceModeChange={(mode) => {
          useRobotStore.getState().stopPlayback()
          setSourceMode(mode)
        }}
        sourceMode={sourceMode}
        sourceQuality={sourceQuality}
        viewport={
          <SceneCanvas
            onStatusChange={setSceneStatus}
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
        onCommit={upsertEquipment}
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
    </>
  )
}
