import { createPortal, type ThreeEvent } from '@react-three/fiber'
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  type RefObject,
} from 'react'
import type { Group, Object3D } from 'three'
import type { GeometryCollisionEntity } from '../../domain/collision/collision'
import type { SerializableTransform } from '../../domain/equipment/equipment'
import { snapshotGeometryEntities } from '../collision/geometry-entity-registry'
import {
  EquipmentOutline,
  EquipmentVisual,
} from '../equipment/EquipmentScene'
import { EquipmentStatusOverlay } from '../equipment/EquipmentStatusOverlay'
import { useEquipmentStore } from '../equipment/equipment-store'
import { useObjectAssetStore } from '../objects/object-asset-store'
import { sceneEditorStore } from '../project/project-store-browser'
import {
  usePublishedSceneRuntime,
  type SceneRuntimeProjectionV1,
} from '../scene/scene-runtime-selector'
import { useRobotStore } from '../joints/robot-store'
import type { RobotRigRegistration } from '../robot/RobotModel'
import {
  releaseHeldEquipmentAtTool,
  resetInteractionAtTool,
  type GraspActionDependencies,
} from './grasp-actions'
import {
  computeGripOffset,
  matrixToTransform,
} from './interaction-math'
import {
  externalCollisionEntityLocalId,
  type ExternalCollisionEntityId,
  useInteractionStore,
} from './interaction-store'
import { updateEquipmentObjectRegistration } from './equipment-object-registry'
import type { OutlineState } from './outline-state'
import { useCoordinateFrameStore } from '../frames/coordinate-frame-store'
import { worldTransformToMcpLocal } from '../frames/frame-runtime'
import {
  runtimeGraspParticipants,
} from './grasp-participants'
import {
  createCollisionEntityOutlineSelector,
  useCollisionStore,
} from '../collision/collision-store'
import {
  createGeometryGraspSensorEntity,
  findGraspCandidates,
} from './geometry-grasp-sensor'

export interface InteractionRuntimeController {
  releaseHeldEquipment(id?: string): Promise<void>
  resetInteraction(): Promise<void>
}

export interface GraspControllerProps {
  rig: RobotRigRegistration
  equipmentObjectsRef: RefObject<
    Map<ExternalCollisionEntityId, Object3D>
  >
  workbenchTopZ: number
  registerController?:
    | ((controller: InteractionRuntimeController | null) => void)
    | undefined
}

export function resolveGeometryGraspTarget(
  sensorEntity: GeometryCollisionEntity,
  candidates: readonly GeometryCollisionEntity[],
  graspableEntityIds: ReadonlySet<string>,
): ExternalCollisionEntityId | null {
  return (
    findGraspCandidates(sensorEntity, candidates).find(({ entityId }) =>
      graspableEntityIds.has(entityId),
    )?.entityId ?? null
  )
}

export function isHeldSceneEntityVisible(
  sceneRuntime: Pick<SceneRuntimeProjectionV1, 'byId'>,
  entityId: ExternalCollisionEntityId,
): boolean {
  return sceneRuntime.byId.get(entityId)?.effectiveVisible !== false
}

export function GraspController({
  rig,
  equipmentObjectsRef,
  workbenchTopZ,
  registerController,
}: GraspControllerProps) {
  const gripperOpen = useRobotStore((state) => state.gripperOpen)
  const records = useEquipmentStore((state) => state.records)
  const objectAssets = useObjectAssetStore((state) => state.assets)
  const objectInstances = useObjectAssetStore((state) => state.instances)
  const participants = useMemo(
    () => runtimeGraspParticipants(records, objectAssets, objectInstances),
    [objectAssets, objectInstances, records],
  )
  const participantsById = useMemo(
    () =>
      new Map(
        participants.map((participant) => [participant.entityId, participant]),
      ),
    [participants],
  )
  const heldEntityId = useInteractionStore((state) => state.heldEntityId)
  const sceneRuntime = usePublishedSceneRuntime()
  const gripOffset = useInteractionStore((state) => state.gripOffset)
  const selection = useInteractionStore((state) => state.selection)
  const heldOutlineSelector = useMemo(
    () => createCollisionEntityOutlineSelector(heldEntityId ?? ''),
    [heldEntityId],
  )
  const heldCollisionOutline = useCollisionStore(heldOutlineSelector)
  const hiddenEntityIds = useInteractionStore((state) => state.hiddenEntityIds)
  const heldObjectOwnerRef = useRef<Object3D>(null)
  const previousGripperOpen = useRef(true)

  const graspDependencies = useMemo<GraspActionDependencies>(
    () => ({
      getHeld: () => {
        const state = useInteractionStore.getState()
        return state.heldEntityId === null ||
          state.heldEquipmentId === null ||
          state.gripOffset === null
          ? null
          : {
              entityId: state.heldEntityId,
              equipmentId: state.heldEquipmentId,
              gripOffset: state.gripOffset,
            }
      },
      getEquipment: (entityId) => {
        const canonicalId = entityId as ExternalCollisionEntityId
        const localId = externalCollisionEntityLocalId(canonicalId)
        if (canonicalId.startsWith('object:')) {
          const objectState = useObjectAssetStore.getState()
          return runtimeGraspParticipants(
            [],
            objectState.assets,
            objectState.instances,
          ).find(({ entityId: candidateId }) => candidateId === canonicalId)
            ?.record
        }
        return useEquipmentStore
          .getState()
          .records.find((record) => record.id === localId)
      },
      previewTransform: (entityId, transform) => {
        const canonicalId = entityId as ExternalCollisionEntityId
        const editor = sceneEditorStore.getState()
        const pose = {
          positionM: [...transform.position] as [number, number, number],
          quaternion: [...transform.quaternion] as [number, number, number, number],
        }
        if (editor.draftPose?.entityId === canonicalId) editor.updateDraft(pose)
        else editor.beginDraft(canonicalId, pose)
      },
      clearHeld: (entityId) => {
        useInteractionStore.getState().releaseHeldEquipment(entityId)
      },
      commitTransform: (entityId) => {
        void entityId
        return sceneEditorStore.getState().applyDraft()
      },
      resetInteraction: () => {
        useInteractionStore.getState().resetInteraction()
      },
      toPersistedTransform: (world) =>
        worldTransformToMcpLocal(
          world,
          useCoordinateFrameStore.getState().frames.mcp,
        ),
    }),
    [],
  )

  const getToolWorld = useCallback((): SerializableTransform => {
    rig.tcpFrame.updateWorldMatrix(true, false)
    return matrixToTransform(rig.tcpFrame.matrixWorld)
  }, [rig.tcpFrame])

  const releaseHeld = useCallback(
    async (id?: string) => {
      await releaseHeldEquipmentAtTool(
        id,
        getToolWorld(),
        workbenchTopZ,
        graspDependencies,
      )
    },
    [getToolWorld, graspDependencies, workbenchTopZ],
  )

  const resetInteraction = useCallback(async () => {
    await resetInteractionAtTool(
      getToolWorld(),
      workbenchTopZ,
      graspDependencies,
    )
  }, [getToolWorld, graspDependencies, workbenchTopZ])

  const attemptGrasp = useCallback(() => {
    const interaction = useInteractionStore.getState()
    if (interaction.heldEntityId !== null) {
      return
    }
    const sensorEntity = createGeometryGraspSensorEntity(rig.tcpFrame)
    const candidates = snapshotGeometryEntities().entities
    const graspableEntityIds = new Set(
      participants
        .filter(({ record }) => record.graspable)
        .map(({ entityId }) => entityId),
    )
    const overlappingIds = findGraspCandidates(sensorEntity, candidates)
      .filter(({ entityId }) => graspableEntityIds.has(entityId))
      .map(({ entityId }) => entityId)
    const overlappingIdSet = new Set(overlappingIds)
    for (const candidateId of interaction.graspCandidateIds) {
      if (!overlappingIdSet.has(candidateId as ExternalCollisionEntityId)) {
        interaction.exitGraspCandidate(candidateId)
      }
    }
    for (const candidateId of overlappingIds) {
      interaction.enterGraspCandidate(candidateId)
    }
    const entityId = resolveGeometryGraspTarget(
      sensorEntity,
      candidates,
      graspableEntityIds,
    )
    if (entityId === null) {
      return
    }
    const equipmentObject = equipmentObjectsRef.current.get(entityId)
    if (equipmentObject === undefined) {
      return
    }
    equipmentObject.updateWorldMatrix(true, false)
    const grip = computeGripOffset(
      getToolWorld(),
      matrixToTransform(equipmentObject.matrixWorld),
    )
    if (useInteractionStore.getState().holdEquipment(entityId, grip)) {
      useInteractionStore
        .getState()
        .selectEquipment(entityId)
    }
  }, [
    equipmentObjectsRef,
    getToolWorld,
    participantsById,
    participants,
    rig.tcpFrame,
  ])

  useEffect(() => {
    const wasOpen = previousGripperOpen.current
    previousGripperOpen.current = gripperOpen
    if (wasOpen === gripperOpen) {
      return
    }
    if (gripperOpen) {
      void releaseHeld()
    } else {
      attemptGrasp()
    }
  }, [attemptGrasp, gripperOpen, releaseHeld])

  useLayoutEffect(() => {
    const controller: InteractionRuntimeController = {
      releaseHeldEquipment: releaseHeld,
      resetInteraction,
    }
    registerController?.(controller)
    return () => {
      registerController?.(null)
    }
  }, [registerController, releaseHeld, resetInteraction])

  const heldRecord =
    heldEntityId === null
      ? undefined
      : participantsById.get(heldEntityId)?.record
  const heldSceneVisible = heldEntityId === null ||
    isHeldSceneEntityVisible(sceneRuntime, heldEntityId)
  const heldSelected =
    heldRecord !== undefined &&
    selection?.kind === 'equipment' &&
    selection.entityId === heldEntityId
  const heldOutlineState: OutlineState =
    heldRecord === undefined
      ? null
      : heldCollisionOutline ?? (heldSelected ? 'selection' : null)
  const registerHeldObject = useCallback(
    (object: Group | null) => {
      if (heldRecord === undefined || heldEntityId === null) {
        return
      }
      updateEquipmentObjectRegistration(
        equipmentObjectsRef.current,
        heldEntityId,
        heldObjectOwnerRef,
        object,
      )
    },
    [equipmentObjectsRef, heldEntityId, heldRecord],
  )

  return (
    <>
      {heldRecord === undefined ||
      gripOffset === null ||
      !heldSceneVisible ||
      hiddenEntityIds.includes(heldRecord.id)
        ? null
        : createPortal(
            <group
              name={`${heldRecord.id}-held`}
              onPointerDown={(event: ThreeEvent<PointerEvent>) => {
                event.stopPropagation()
                useInteractionStore.getState().selectEquipment(heldEntityId!)
              }}
              position={gripOffset.position}
              quaternion={gripOffset.quaternion}
              ref={registerHeldObject}
              scale={gripOffset.scale}
              userData={{
                collisionEntityId: heldEntityId,
                equipmentId: heldRecord.id,
                held: true,
              }}
            >
              <EquipmentVisual record={heldRecord} />
              <EquipmentStatusOverlay record={heldRecord} />
              {heldOutlineState === null ? null : (
                <EquipmentOutline
                  outlineState={heldOutlineState}
                  record={heldRecord}
                />
              )}
            </group>,
            rig.tcpFrame,
          )}
    </>
  )
}
