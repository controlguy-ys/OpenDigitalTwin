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
import {
  createCollisionEntityOutlineSelector,
  useCollisionStore,
} from '../collision/collision-store'
import type { OutlineState } from '../interaction/outline-state'
import type { SceneRuntimeProjectionV1 } from '../scene/scene-runtime-selector'
import { sceneEditorStore } from '../project/project-store-browser'
import type { SceneEntityIdV1 } from '../../domain/project/scene-state-v1'

interface EquipmentInstanceProps {
  entityId: ExternalCollisionEntityId
  record: EquipmentRecord
  equipmentObjectsRef: RefObject<
    Map<ExternalCollisionEntityId, Object3D>
  >
  onDraggingChange(dragging: boolean): void
  onEntityContextMenu?: (entityId: SceneEntityIdV1) => void
}

export function isExternalCollisionRegistrationActive(
  entityId: ExternalCollisionEntityId,
  localId: string,
  visible: boolean,
  heldEntityId: ExternalCollisionEntityId | null,
  hiddenEntityIds: readonly string[],
): boolean {
  return (
    visible &&
    !hiddenEntityIds.includes(localId) &&
    !hiddenEntityIds.includes(entityId) &&
    !(entityId === heldEntityId && hiddenEntityIds.includes('robot'))
  )
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
  outlineState,
}: {
  record: EquipmentRecord
  outlineState: Exclude<OutlineState, null>
}) {
  const collision = outlineState === 'collision'
  const center =
    record.collisionCenter ?? record.importMetadata?.colliderCenter ?? [0, 0, 0]
  return (
    <mesh
      name={`${record.id}-${outlineState}-outline`}
      position={center}
      renderOrder={1000}
      userData={{
        equipmentId: record.id,
        outline: outlineState,
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
        color={
          collision
            ? '#ff3b30'
            : outlineState === 'near-miss'
              ? '#f5c542'
              : '#4da3ff'
        }
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
  onEntityContextMenu,
}: EquipmentInstanceProps) {
  const objectRef = useRef<Group>(null)
  const selection = useInteractionStore((state) => state.selection)
  const collisionOutlineSelector = useMemo(
    () => createCollisionEntityOutlineSelector(entityId),
    [entityId],
  )
  const collisionOutline = useCollisionStore(collisionOutlineSelector)
  const selectEquipment = useInteractionStore((state) => state.selectEquipment)
  const previewSceneTransform = useCallback((_id: string, transform: EquipmentRecord['transform']) => {
    const pose = {
      positionM: [...transform.position] as [number, number, number],
      quaternion: [...transform.quaternion] as [number, number, number, number],
    }
    const editor = sceneEditorStore.getState()
    if (editor.draftPose?.entityId === entityId) editor.updateDraft(pose)
    else editor.beginDraft(entityId, pose)
  }, [entityId])
  const commitSceneTransform = useCallback(async (_id: string) => {
    await sceneEditorStore.getState().applyDraft()
  }, [])
  const selected =
    selection?.kind === 'equipment' && selection.entityId === entityId
  const outlineState =
    collisionOutline ?? getExternalEntityOutlineState(entityId, selected, [])
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
        onContextMenu={(event: ThreeEvent<MouseEvent>) => {
          event.stopPropagation()
          event.nativeEvent.preventDefault()
          selectEquipment(entityId)
          onEntityContextMenu?.(entityId)
        }}
        onPointerDown={(event: ThreeEvent<PointerEvent>) => {
          event.stopPropagation()
          selectEquipment(entityId)
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
          <EquipmentOutline outlineState={outlineState} record={record} />
        )}
      </group>
      {selected ? (
        <EquipmentTransformControls
          commitTransform={
            commitSceneTransform
          }
          entityId={entityId}
          objectRef={objectRef}
          onDraggingChange={onDraggingChange}
          previewTransform={
            previewSceneTransform
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
      void (assetRecord === undefined ||
        ('sourceKind' in assetRecord && assetRecord.sourceKind !== 'step')
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
  onEntityContextMenu?(entityId: SceneEntityIdV1): void
  sceneRuntime?: SceneRuntimeProjectionV1
}

const NOOP_DRAGGING_CHANGE = () => undefined

export function EquipmentScene({
  equipmentObjectsRef: providedEquipmentObjectsRef,
  onDraggingChange = NOOP_DRAGGING_CHANGE,
  onEntityContextMenu,
  sceneRuntime,
}: EquipmentSceneProps = {}) {
  const records = useEquipmentStore((state) => state.records)
  const objectAssets = useObjectAssetStore((state) => state.assets)
  const objectInstances = useObjectAssetStore((state) => state.instances)
  const participants = useMemo(
    () => runtimeGraspParticipants(records, objectAssets, objectInstances),
    [objectAssets, objectInstances, records],
  )
  const publishedParticipants = useMemo(() => participants.flatMap((participant) => {
    const runtime = sceneRuntime?.byId.get(participant.entityId)
    if (runtime !== undefined && !runtime.effectiveVisible) return []
    return [{
      ...participant,
      record: runtime === undefined
        ? participant.record
        : {
            ...participant.record,
            transform: {
              ...participant.record.transform,
              position: [...runtime.worldPose.positionM] as [number, number, number],
              quaternion: [...runtime.worldPose.quaternion] as [number, number, number, number],
            },
          },
    }]
  }), [participants, sceneRuntime])
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
      const entityId = `equipment:${record.id}` as const
      if (sceneRuntime?.byId.get(entityId)?.effectiveVisible === false) continue
      if (!isExternalCollisionRegistrationActive(
        entityId,
        record.id,
        true,
        heldEntityId,
        hiddenEntityIds,
      )) continue
      cleanups.push(
        registerGeometryEntity(
          equipmentRecordToGeometryEntity(
            record,
            equipmentObjectsRef.current.get(entityId) ?? null,
            heldEntityId === entityId,
          ),
        ),
      )
    }

    const assetsById = new Map(objectAssets.map((asset) => [asset.id, asset]))
    for (const instance of objectInstances) {
      const entityId = `object:${instance.id}` as const
      if (sceneRuntime?.byId.get(entityId)?.effectiveVisible === false) continue
      if (!isExternalCollisionRegistrationActive(
        entityId,
        instance.id,
        instance.visible,
        heldEntityId,
        hiddenEntityIds,
      )) continue
      const asset = assetsById.get(instance.assetId)
      if (asset === undefined) continue
      cleanups.push(
        registerGeometryEntity(
          objectInstanceToGeometryEntity(
            asset,
            instance,
            equipmentObjectsRef.current.get(entityId) ?? null,
            heldEntityId === entityId,
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
    sceneRuntime,
  ])

  return (
    <group name="equipment-scene">
      {publishedParticipants
        .filter(
          ({ entityId, record }) =>
            entityId !== heldEntityId &&
            !hiddenEntityIds.includes(record.id) &&
            !hiddenEntityIds.includes(entityId),
        )
        .map(({ entityId, record }) => (
          <EquipmentInstance
            entityId={entityId}
            equipmentObjectsRef={equipmentObjectsRef}
            key={entityId}
            onDraggingChange={onDraggingChange}
            {...(onEntityContextMenu === undefined
              ? {}
              : { onEntityContextMenu })}
            record={record}
          />
        ))}
    </group>
  )
}
