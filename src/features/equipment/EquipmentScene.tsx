import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
  type RefObject,
} from 'react'
import type { ThreeEvent } from '@react-three/fiber'
import type { Group, Object3D } from 'three'
import type { EquipmentRecord } from '../../domain/equipment/equipment'
import { EquipmentTransformControls } from '../interaction/EquipmentTransformControls'
import { updateEquipmentObjectRegistration } from '../interaction/equipment-object-registry'
import {
  type ExternalCollisionEntityId,
  useInteractionStore,
} from '../interaction/interaction-store'
import { getExternalEntityOutlineState } from '../interaction/outline-state'
import { importedGeometryRepository } from '../import/imported-geometry-repository'
import { BuiltInEquipment } from './BuiltInEquipment'
import { StackLight } from './StackLight'
import { EquipmentStatusOverlay } from './EquipmentStatusOverlay'
import { useEquipmentStore } from './equipment-store'
import { useObjectAssetStore } from '../objects/object-asset-store'
import { objectInstanceToGeometryEntity } from '../objects/object-equipment-adapter'
import { registerGeometryEntity } from '../collision/geometry-entity-registry'
import { equipmentRecordToGeometryEntity } from '../collision/scene-entity-adapter'
import { runtimeGraspParticipants } from '../interaction/grasp-participants'

interface EquipmentInstanceProps {
  entityId: ExternalCollisionEntityId
  record: EquipmentRecord
  equipmentObjectsRef: RefObject<
    Map<ExternalCollisionEntityId, Object3D>
  >
  onDraggingChange(dragging: boolean): void
}

export function EquipmentVisual({ record }: { record: EquipmentRecord }) {
  return record.kind === 'imported' ? (
    <ImportedEquipment record={record} />
  ) : (
    <BuiltInEquipment record={record} />
  )
}

export function EquipmentOutline({
  record,
  collision,
}: {
  record: EquipmentRecord
  collision: boolean
}) {
  const center =
    record.collisionCenter ?? record.importMetadata?.colliderCenter ?? [0, 0, 0]
  return (
    <mesh
      name={`${record.id}-${collision ? 'collision' : 'selection'}-outline`}
      position={center}
      renderOrder={1000}
      userData={{
        equipmentId: record.id,
        outline: collision ? 'collision' : 'selection',
      }}
    >
      <boxGeometry
        args={[
          record.collisionHalfExtents[0] * 2.04,
          record.collisionHalfExtents[1] * 2.04,
          record.collisionHalfExtents[2] * 2.04,
        ]}
      />
      <meshBasicMaterial
        color={collision ? '#ff3b30' : '#4da3ff'}
        depthTest={false}
        transparent
        opacity={0.86}
        wireframe
      />
    </mesh>
  )
}

const EquipmentInstance = memo(function EquipmentInstance({
  entityId,
  record,
  equipmentObjectsRef,
  onDraggingChange,
}: EquipmentInstanceProps) {
  const objectRef = useRef<Group>(null)
  const selection = useInteractionStore((state) => state.selection)
  const activeCollisionPairs = useInteractionStore(
    (state) => state.activeCollisionPairs,
  )
  const selectEquipment = useInteractionStore((state) => state.selectEquipment)
  const previewTransform = useEquipmentStore(
    (state) => state.previewEquipmentTransform,
  )
  const commitTransform = useEquipmentStore(
    (state) => state.commitEquipmentTransform,
  )
  const previewObjectTransform = useObjectAssetStore(
    (state) => state.previewInstanceTransform,
  )
  const commitObjectTransform = useObjectAssetStore(
    (state) => state.commitInstanceTransform,
  )
  const selected =
    selection?.kind === 'equipment' && selection.equipmentId === record.id
  const outlineState = getExternalEntityOutlineState(
    entityId,
    selected,
    activeCollisionPairs,
  )
  const collision = outlineState === 'collision'

  const registerObject = useCallback(
    (object: Group | null) => {
      updateEquipmentObjectRegistration(
        equipmentObjectsRef.current,
        entityId,
        objectRef,
        object,
      )
    },
    [entityId, equipmentObjectsRef],
  )

  return (
    <>
      <group
        name={record.id}
        onPointerDown={(event: ThreeEvent<PointerEvent>) => {
          event.stopPropagation()
          selectEquipment(record.id)
        }}
        position={record.transform.position}
        quaternion={record.transform.quaternion}
        ref={registerObject}
        scale={record.transform.scale}
        userData={{
          equipmentId: record.id,
          collisionEntityId: entityId,
          selected,
          collision,
        }}
      >
        <EquipmentVisual record={record} />
        <EquipmentStatusOverlay record={record} />
        {outlineState === null ? null : (
          <EquipmentOutline collision={collision} record={record} />
        )}
      </group>
      {selected ? (
        <EquipmentTransformControls
          commitTransform={
            record.assetId === undefined ? commitTransform : commitObjectTransform
          }
          equipmentId={record.id}
          objectRef={objectRef}
          onDraggingChange={onDraggingChange}
          previewTransform={
            record.assetId === undefined ? previewTransform : previewObjectTransform
          }
        />
      ) : null}
    </>
  )
})

function ImportedEquipment({ record }: { record: EquipmentRecord }) {
  useSyncExternalStore(
    importedGeometryRepository.subscribe,
    importedGeometryRepository.getSnapshot,
    importedGeometryRepository.getSnapshot,
  )
  const assetRecord = useObjectAssetStore((state) =>
    record.assetId === undefined
      ? undefined
      : state.assets.find(({ id }) => id === record.assetId),
  )
  const geometryId = record.assetId ?? record.id
  const asset = importedGeometryRepository.get(geometryId)

  useEffect(() => {
    if (asset === undefined) {
      void (assetRecord === undefined
        ? importedGeometryRepository.load(record)
        : importedGeometryRepository.loadObjectAsset(assetRecord)
      ).catch(() => undefined)
    }
  }, [asset, assetRecord, record])

  const instanceGroup = useMemo(() => asset?.group.clone(true), [asset])

  if (instanceGroup === undefined) {
    return null
  }

  return (
    <group name={`${record.id}-imported-visual`}>
      <primitive object={instanceGroup} />
      {record.stackLightAnchor === null ? null : (
        <group
          name={`${record.id}-stack-light-anchor`}
          position={record.stackLightAnchor}
        >
          <StackLight name={`${record.id}-stack-light`} status={record.status} />
        </group>
      )}
    </group>
  )
}

export interface EquipmentSceneProps {
  equipmentObjectsRef?: RefObject<
    Map<ExternalCollisionEntityId, Object3D>
  >
  onDraggingChange?(dragging: boolean): void
}

const NOOP_DRAGGING_CHANGE = () => undefined

export function EquipmentScene({
  equipmentObjectsRef: providedEquipmentObjectsRef,
  onDraggingChange = NOOP_DRAGGING_CHANGE,
}: EquipmentSceneProps = {}) {
  const records = useEquipmentStore((state) => state.records)
  const objectAssets = useObjectAssetStore((state) => state.assets)
  const objectInstances = useObjectAssetStore((state) => state.instances)
  const participants = useMemo(
    () => runtimeGraspParticipants(records, objectAssets, objectInstances),
    [objectAssets, objectInstances, records],
  )
  const heldEntityId = useInteractionStore((state) => state.heldEntityId)
  const hiddenEntityIds = useInteractionStore((state) => state.hiddenEntityIds)
  const localEquipmentObjectsRef = useRef(
    new Map<ExternalCollisionEntityId, Object3D>(),
  )
  const equipmentObjectsRef =
    providedEquipmentObjectsRef ?? localEquipmentObjectsRef

  useLayoutEffect(() => {
    const cleanups: (() => void)[] = []
    for (const record of records) {
      if (hiddenEntityIds.includes(record.id)) continue
      cleanups.push(
        registerGeometryEntity(
          equipmentRecordToGeometryEntity(
            record,
            equipmentObjectsRef.current.get(`equipment:${record.id}`) ?? null,
            heldEntityId === `equipment:${record.id}`,
          ),
        ),
      )
    }

    const assetsById = new Map(objectAssets.map((asset) => [asset.id, asset]))
    for (const instance of objectInstances) {
      if (!instance.visible || hiddenEntityIds.includes(instance.id)) continue
      const asset = assetsById.get(instance.assetId)
      if (asset === undefined) continue
      cleanups.push(
        registerGeometryEntity(
          objectInstanceToGeometryEntity(
            asset,
            instance,
            equipmentObjectsRef.current.get(`object:${instance.id}`) ?? null,
            heldEntityId === `object:${instance.id}`,
          ),
        ),
      )
    }

    return () => {
      for (const cleanup of cleanups.reverse()) cleanup()
    }
  }, [
    equipmentObjectsRef,
    heldEntityId,
    hiddenEntityIds,
    objectAssets,
    objectInstances,
    records,
  ])

  return (
    <group name="equipment-scene">
      {participants
        .filter(
          ({ entityId, record }) =>
            entityId !== heldEntityId &&
            !hiddenEntityIds.includes(record.id),
        )
        .map(({ entityId, record }) => (
          <EquipmentInstance
            entityId={entityId}
            equipmentObjectsRef={equipmentObjectsRef}
            key={entityId}
            onDraggingChange={onDraggingChange}
            record={record}
          />
        ))}
    </group>
  )
}
