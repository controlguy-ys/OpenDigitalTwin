import { ActiveCollisionTypes } from '@dimforge/rapier3d-compat'
import { createPortal, type ThreeEvent } from '@react-three/fiber'
import {
  CuboidCollider,
  RigidBody,
  interactionGroups,
  useBeforePhysicsStep,
  type IntersectionEnterPayload,
  type RapierRigidBody,
} from '@react-three/rapier'
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  type RefObject,
} from 'react'
import { Vector3, type Group, type Object3D } from 'three'
import type { SerializableTransform } from '../../domain/equipment/equipment'
import {
  EquipmentOutline,
  EquipmentVisual,
} from '../equipment/EquipmentScene'
import { useEquipmentStore } from '../equipment/equipment-store'
import { useObjectAssetStore } from '../objects/object-asset-store'
import { useRobotStore } from '../joints/robot-store'
import type { RobotRigRegistration } from '../robot/RobotModel'
import {
  releaseHeldEquipmentAtTool,
  resetInteractionAtTool,
  type GraspActionDependencies,
} from './grasp-actions'
import {
  GRASP_SENSOR_HALF_EXTENTS,
  chooseNearestGraspCandidate,
  computeGripOffset,
  getGraspSensorWorldTransform,
  getWorldColliderCenter,
  matrixToTransform,
} from './interaction-math'
import {
  externalCollisionEntityLocalId,
  type ExternalCollisionEntityId,
  useInteractionStore,
} from './interaction-store'
import { updateEquipmentObjectRegistration } from './equipment-object-registry'
import { getExternalEntityOutlineState } from './outline-state'
import { useCoordinateFrameStore } from '../frames/coordinate-frame-store'
import { worldTransformToMcpLocal } from '../frames/frame-runtime'
import {
  collisionEntityToGraspParticipantId,
  runtimeGraspParticipants,
} from './grasp-participants'

const GRASP_GROUPS = interactionGroups(3, [1])

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

function getOtherParticipantId(
  payload: IntersectionEnterPayload,
): ExternalCollisionEntityId | null {
  const entity = payload.other.rigidBodyObject?.userData.collisionEntityId
  return collisionEntityToGraspParticipantId(entity)
}

export function GraspController({
  rig,
  equipmentObjectsRef,
  workbenchTopZ,
  registerController,
}: GraspControllerProps) {
  const rigidBodyRef = useRef<RapierRigidBody>(null)
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
  const gripOffset = useInteractionStore((state) => state.gripOffset)
  const selection = useInteractionStore((state) => state.selection)
  const activeCollisionPairs = useInteractionStore(
    (state) => state.activeCollisionPairs,
  )
  const hiddenEntityIds = useInteractionStore((state) => state.hiddenEntityIds)
  const heldObjectOwnerRef = useRef<Object3D>(null)
  const previousGripperOpen = useRef(true)
  const sensorPosition = useMemo(() => new Vector3(), [])

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
        const localId = externalCollisionEntityLocalId(canonicalId)
        if (canonicalId.startsWith('object:')) {
          useObjectAssetStore
            .getState()
            .previewInstanceTransform(localId, transform)
        } else {
          useEquipmentStore
            .getState()
            .previewEquipmentTransform(localId, transform)
        }
      },
      clearHeld: (entityId) => {
        useInteractionStore.getState().releaseHeldEquipment(entityId)
      },
      commitTransform: (entityId) => {
        const canonicalId = entityId as ExternalCollisionEntityId
        const localId = externalCollisionEntityLocalId(canonicalId)
        return canonicalId.startsWith('object:')
          ? useObjectAssetStore.getState().commitInstanceTransform(localId)
          : useEquipmentStore.getState().commitEquipmentTransform(localId)
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
    const sensorWorld = getGraspSensorWorldTransform(rig.tcpFrame)
    sensorPosition.fromArray(sensorWorld.position)
    const candidates = interaction.graspCandidateIds.flatMap((candidateId) => {
      const entityId = collisionEntityToGraspParticipantId(candidateId)
      if (entityId === null) return []
      const record = participantsById.get(entityId)?.record
      const object = equipmentObjectsRef.current.get(entityId)
      if (record?.graspable !== true || object === undefined) {
        return []
      }
      object.updateWorldMatrix(true, false)
      const equipmentPosition = new Vector3().fromArray(
        getWorldColliderCenter(
          object,
          record.collisionCenter ??
            record.importMetadata?.colliderCenter ??
            [0, 0, 0],
        ),
      )
      return [{
        equipmentId: entityId,
        distanceSq: equipmentPosition.distanceToSquared(sensorPosition),
      }]
    })
    const entityId = chooseNearestGraspCandidate(candidates) as
      | ExternalCollisionEntityId
      | null
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
        .selectEquipment(externalCollisionEntityLocalId(entityId))
    }
  }, [
    equipmentObjectsRef,
    getToolWorld,
    participantsById,
    rig.tcpFrame,
    sensorPosition,
  ])

  useBeforePhysicsStep(() => {
    const rigidBody = rigidBodyRef.current
    if (rigidBody === null) {
      return
    }
    const sensor = getGraspSensorWorldTransform(rig.tcpFrame)
    rigidBody.setNextKinematicTranslation(new Vector3(...sensor.position))
    rigidBody.setNextKinematicRotation({
      x: sensor.quaternion[0],
      y: sensor.quaternion[1],
      z: sensor.quaternion[2],
      w: sensor.quaternion[3],
    })
  })

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
  const heldSelected =
    heldRecord !== undefined &&
    selection?.kind === 'equipment' &&
    selection.equipmentId === heldRecord.id
  const heldOutlineState =
    heldRecord === undefined
      ? null
      : getExternalEntityOutlineState(
          heldEntityId!,
          heldSelected,
          activeCollisionPairs,
        )
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
      <RigidBody
        colliders={false}
        ref={rigidBodyRef}
        type="kinematicPosition"
        userData={{ collisionEntityId: 'grasp-sensor' }}
      >
        <CuboidCollider
          activeCollisionTypes={ActiveCollisionTypes.ALL}
          args={[...GRASP_SENSOR_HALF_EXTENTS]}
          collisionGroups={GRASP_GROUPS}
          onIntersectionEnter={(payload) => {
            const entityId = getOtherParticipantId(payload)
            const record =
              entityId === null
                ? undefined
                : participantsById.get(entityId)?.record
            if (entityId !== null && record?.graspable === true) {
              useInteractionStore.getState().enterGraspCandidate(entityId)
            }
          }}
          onIntersectionExit={(payload) => {
            const entityId = getOtherParticipantId(payload)
            if (entityId !== null) {
              useInteractionStore.getState().exitGraspCandidate(entityId)
            }
          }}
          sensor
        />
      </RigidBody>
      {heldRecord === undefined ||
      gripOffset === null ||
      hiddenEntityIds.includes(heldRecord.id)
        ? null
        : createPortal(
            <group
              name={`${heldRecord.id}-held`}
              onPointerDown={(event: ThreeEvent<PointerEvent>) => {
                event.stopPropagation()
                useInteractionStore.getState().selectEquipment(heldRecord.id)
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
              {heldOutlineState === null ? null : (
                <EquipmentOutline
                  collision={heldOutlineState === 'collision'}
                  record={heldRecord}
                />
              )}
            </group>,
            rig.tcpFrame,
          )}
    </>
  )
}
