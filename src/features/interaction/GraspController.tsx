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
import { useInteractionStore } from './interaction-store'
import { updateEquipmentObjectRegistration } from './equipment-object-registry'
import { getEquipmentOutlineState } from './outline-state'

const GRASP_GROUPS = interactionGroups(3, [1])

export interface InteractionRuntimeController {
  releaseHeldEquipment(id?: string): Promise<void>
  resetInteraction(): Promise<void>
}

export interface GraspControllerProps {
  rig: RobotRigRegistration
  equipmentObjectsRef: RefObject<Map<string, Object3D>>
  workbenchTopZ: number
  registerController?:
    | ((controller: InteractionRuntimeController | null) => void)
    | undefined
}

function getOtherEquipmentId(payload: IntersectionEnterPayload): string | null {
  const entity = payload.other.rigidBodyObject?.userData.collisionEntityId
  return typeof entity === 'string' && entity.startsWith('equipment:')
    ? entity.slice('equipment:'.length)
    : null
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
  const heldEquipmentId = useInteractionStore((state) => state.heldEquipmentId)
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
        return state.heldEquipmentId === null || state.gripOffset === null
          ? null
          : {
              equipmentId: state.heldEquipmentId,
              gripOffset: state.gripOffset,
            }
      },
      getEquipment: (id) =>
        useEquipmentStore.getState().records.find((record) => record.id === id),
      previewTransform: (id, transform) => {
        useEquipmentStore.getState().previewEquipmentTransform(id, transform)
      },
      clearHeld: (id) => {
        useInteractionStore.getState().releaseHeldEquipment(id)
      },
      commitTransform: (id) =>
        useEquipmentStore.getState().commitEquipmentTransform(id),
      resetInteraction: () => {
        useInteractionStore.getState().resetInteraction()
      },
    }),
    [],
  )

  const getToolWorld = useCallback((): SerializableTransform => {
    rig.toolFrame.updateWorldMatrix(true, false)
    return matrixToTransform(rig.toolFrame.matrixWorld)
  }, [rig.toolFrame])

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
    if (interaction.heldEquipmentId !== null) {
      return
    }
    const sensorWorld = getGraspSensorWorldTransform(rig.toolFrame)
    sensorPosition.fromArray(sensorWorld.position)
    const candidates = interaction.graspCandidateIds.flatMap((equipmentId) => {
      const record = useEquipmentStore
        .getState()
        .records.find(({ id }) => id === equipmentId)
      const object = equipmentObjectsRef.current.get(equipmentId)
      if (record?.graspable !== true || object === undefined) {
        return []
      }
      object.updateWorldMatrix(true, false)
      const equipmentPosition = new Vector3().fromArray(
        getWorldColliderCenter(
          object,
          record.importMetadata?.colliderCenter ?? [0, 0, 0],
        ),
      )
      return [{ equipmentId, distanceSq: equipmentPosition.distanceToSquared(sensorPosition) }]
    })
    const equipmentId = chooseNearestGraspCandidate(candidates)
    if (equipmentId === null) {
      return
    }
    const equipmentObject = equipmentObjectsRef.current.get(equipmentId)
    if (equipmentObject === undefined) {
      return
    }
    equipmentObject.updateWorldMatrix(true, false)
    const grip = computeGripOffset(
      getToolWorld(),
      matrixToTransform(equipmentObject.matrixWorld),
    )
    if (useInteractionStore.getState().holdEquipment(equipmentId, grip)) {
      useInteractionStore.getState().selectEquipment(equipmentId)
    }
  }, [equipmentObjectsRef, getToolWorld, rig.toolFrame, sensorPosition])

  useBeforePhysicsStep(() => {
    const rigidBody = rigidBodyRef.current
    if (rigidBody === null) {
      return
    }
    const sensor = getGraspSensorWorldTransform(rig.toolFrame)
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
    heldEquipmentId === null
      ? undefined
      : records.find(({ id }) => id === heldEquipmentId)
  const heldSelected =
    heldRecord !== undefined &&
    selection?.kind === 'equipment' &&
    selection.equipmentId === heldRecord.id
  const heldOutlineState =
    heldRecord === undefined
      ? null
      : getEquipmentOutlineState(
          heldRecord.id,
          heldSelected,
          activeCollisionPairs,
        )
  const registerHeldObject = useCallback(
    (object: Group | null) => {
      if (heldRecord === undefined) {
        return
      }
      updateEquipmentObjectRegistration(
        equipmentObjectsRef.current,
        heldRecord.id,
        heldObjectOwnerRef,
        object,
      )
    },
    [equipmentObjectsRef, heldRecord],
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
            const equipmentId = getOtherEquipmentId(payload)
            const record = useEquipmentStore
              .getState()
              .records.find(({ id }) => id === equipmentId)
            if (equipmentId !== null && record?.graspable === true) {
              useInteractionStore.getState().enterGraspCandidate(equipmentId)
            }
          }}
          onIntersectionExit={(payload) => {
            const equipmentId = getOtherEquipmentId(payload)
            if (equipmentId !== null) {
              useInteractionStore.getState().exitGraspCandidate(equipmentId)
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
              userData={{ equipmentId: heldRecord.id, held: true }}
            >
              <EquipmentVisual record={heldRecord} />
              {heldOutlineState === null ? null : (
                <EquipmentOutline
                  collision={heldOutlineState === 'collision'}
                  record={heldRecord}
                />
              )}
            </group>,
            rig.toolFrame,
          )}
    </>
  )
}
