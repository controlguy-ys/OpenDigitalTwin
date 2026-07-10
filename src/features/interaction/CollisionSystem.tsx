import { ActiveCollisionTypes } from '@dimforge/rapier3d-compat'
import {
  CuboidCollider,
  RigidBody,
  interactionGroups,
  useBeforePhysicsStep,
  type IntersectionEnterPayload,
  type IntersectionExitPayload,
  type RapierRigidBody,
} from '@react-three/rapier'
import { useMemo, useRef, type RefObject } from 'react'
import { Quaternion, Vector3, type Object3D } from 'three'
import type { EquipmentRecord } from '../../domain/equipment/equipment'
import type { RobotLinkId } from '../../domain/robot/crb15000'
import { useEquipmentStore } from '../equipment/equipment-store'
import { useRobotStore } from '../joints/robot-store'
import type { RobotRigRegistration } from '../robot/RobotModel'
import { useEventStore } from '../../state/event-store'
import { handleCollisionEnter, handleCollisionExit } from './collision-events'
import {
  type CollisionEntityId,
  useInteractionStore,
} from './interaction-store'
import { ROBOT_LINK_COLLISION_BOUNDS } from './robot-collision-bounds'

const ROBOT_GROUPS = interactionGroups(0, [0, 1, 2])
const EQUIPMENT_GROUPS = interactionGroups(1, [0, 3])
const WORKCELL_GROUPS = interactionGroups(2, [0])

interface KinematicSensorProps {
  entityId: CollisionEntityId
  getSource(): Object3D | null | undefined
  center: readonly [number, number, number]
  halfExtents: readonly [number, number, number]
  collisionGroups: number
}

function readOtherEntity(
  payload: IntersectionEnterPayload | IntersectionExitPayload,
): CollisionEntityId | null {
  const entity = payload.other.rigidBodyObject?.userData.collisionEntityId
  return typeof entity === 'string' ? (entity as CollisionEntityId) : null
}

function KinematicSensor({
  entityId,
  getSource,
  center,
  halfExtents,
  collisionGroups,
}: KinematicSensorProps) {
  const rigidBodyRef = useRef<RapierRigidBody>(null)
  const position = useMemo(() => new Vector3(), [])
  const rotation = useMemo(() => new Quaternion(), [])
  const scale = useMemo(() => new Vector3(), [])

  useBeforePhysicsStep(() => {
    const source = getSource()
    const rigidBody = rigidBodyRef.current
    if (source === null || source === undefined || rigidBody === null) {
      return
    }
    source.updateWorldMatrix(true, false)
    source.matrixWorld.decompose(position, rotation, scale)
    rigidBody.setNextKinematicTranslation(position)
    rigidBody.setNextKinematicRotation(rotation)
  })

  const dependencies = {
    interactionStore: useInteractionStore,
    eventStore: useEventStore,
    pausePlayback: () => useRobotStore.getState().setPlaying(false),
    now: Date.now,
  }

  return (
    <RigidBody
      colliders={false}
      ref={rigidBodyRef}
      type="kinematicPosition"
      userData={{ collisionEntityId: entityId }}
    >
      <CuboidCollider
        activeCollisionTypes={ActiveCollisionTypes.ALL}
        args={[...halfExtents]}
        collisionGroups={collisionGroups}
        onIntersectionEnter={(payload) => {
          const other = readOtherEntity(payload)
          if (other !== null) {
            handleCollisionEnter(entityId, other, dependencies)
          }
        }}
        onIntersectionExit={(payload) => {
          const other = readOtherEntity(payload)
          if (other !== null) {
            handleCollisionExit(entityId, other, dependencies)
          }
        }}
        position={[...center]}
        sensor
      />
    </RigidBody>
  )
}

function equipmentColliderCenter(
  record: EquipmentRecord,
): readonly [number, number, number] {
  const center = record.importMetadata?.colliderCenter ?? [0, 0, 0]
  return [
    center[0] * record.transform.scale[0],
    center[1] * record.transform.scale[1],
    center[2] * record.transform.scale[2],
  ]
}

function equipmentColliderHalfExtents(
  record: EquipmentRecord,
): readonly [number, number, number] {
  return [
    record.collisionHalfExtents[0] * Math.abs(record.transform.scale[0]),
    record.collisionHalfExtents[1] * Math.abs(record.transform.scale[1]),
    record.collisionHalfExtents[2] * Math.abs(record.transform.scale[2]),
  ]
}

export interface CollisionSystemProps {
  rig: RobotRigRegistration | null
  equipmentObjectsRef: RefObject<Map<string, Object3D>>
  workbenchObjectRef: RefObject<Object3D | null>
}

export function CollisionSystem({
  rig,
  equipmentObjectsRef,
  workbenchObjectRef,
}: CollisionSystemProps) {
  const records = useEquipmentStore((state) => state.records)
  const heldEquipmentId = useInteractionStore((state) => state.heldEquipmentId)
  const hiddenEntityIds = useInteractionStore((state) => state.hiddenEntityIds)

  return (
    <group name="collision-system">
      {rig === null
        ? null
        : (Object.keys(ROBOT_LINK_COLLISION_BOUNDS) as RobotLinkId[]).map(
            (linkId) => {
              const bounds = ROBOT_LINK_COLLISION_BOUNDS[linkId]
              return (
                <KinematicSensor
                  center={bounds.center}
                  collisionGroups={ROBOT_GROUPS}
                  entityId={`robot-link:${linkId}`}
                  getSource={() => rig.linkSlots[linkId]}
                  halfExtents={bounds.halfExtents}
                  key={linkId}
                />
              )
            },
          )}
      {records
        .filter(
          (record) =>
            record.id !== heldEquipmentId &&
            !hiddenEntityIds.includes(record.id),
        )
        .map((record) => (
          <KinematicSensor
            center={equipmentColliderCenter(record)}
            collisionGroups={EQUIPMENT_GROUPS}
            entityId={`equipment:${record.id}`}
            getSource={() => equipmentObjectsRef.current.get(record.id)}
            halfExtents={equipmentColliderHalfExtents(record)}
            key={`${record.id}-${record.transform.scale.join('-')}`}
          />
        ))}
      <KinematicSensor
        center={[0, 0, 1.03]}
        collisionGroups={WORKCELL_GROUPS}
        entityId="workcell:workbench"
        getSource={() => workbenchObjectRef.current}
        halfExtents={[0.9, 0.6, 0.05]}
      />
    </group>
  )
}
