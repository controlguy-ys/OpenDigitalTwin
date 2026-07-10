import {
  memo,
  useCallback,
  useEffect,
  useRef,
  useSyncExternalStore,
  type RefObject,
} from 'react'
import type { ThreeEvent } from '@react-three/fiber'
import type { Group, Object3D } from 'three'
import type { EquipmentRecord } from '../../domain/equipment/equipment'
import { EquipmentTransformControls } from '../interaction/EquipmentTransformControls'
import { useInteractionStore } from '../interaction/interaction-store'
import { importedGeometryRepository } from '../import/imported-geometry-repository'
import { BuiltInEquipment } from './BuiltInEquipment'
import { StackLight } from './StackLight'
import { useEquipmentStore } from './equipment-store'

interface EquipmentInstanceProps {
  record: EquipmentRecord
  equipmentObjectsRef: RefObject<Map<string, Object3D>>
  onDraggingChange(dragging: boolean): void
}

function hasEquipmentCollision(
  equipmentId: string,
  pairs: readonly string[],
): boolean {
  const entity = `equipment:${equipmentId}`
  return pairs.some((pair) => pair.startsWith(`${entity}|`) || pair.endsWith(`|${entity}`))
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
  const center = record.importMetadata?.colliderCenter ?? [0, 0, 0]
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
  const selected =
    selection?.kind === 'equipment' && selection.equipmentId === record.id
  const collision = hasEquipmentCollision(record.id, activeCollisionPairs)

  const registerObject = useCallback(
    (object: Group | null) => {
      objectRef.current = object
      if (object === null) {
        equipmentObjectsRef.current.delete(record.id)
      } else {
        equipmentObjectsRef.current.set(record.id, object)
      }
    },
    [equipmentObjectsRef, record.id],
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
          selected,
          collision,
        }}
      >
        <EquipmentVisual record={record} />
        {selected || collision ? (
          <EquipmentOutline collision={collision} record={record} />
        ) : null}
      </group>
      {selected ? (
        <EquipmentTransformControls
          commitTransform={commitTransform}
          equipmentId={record.id}
          objectRef={objectRef}
          onDraggingChange={onDraggingChange}
          previewTransform={previewTransform}
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
  const asset = importedGeometryRepository.get(record.id)

  useEffect(() => {
    if (asset === undefined) {
      void importedGeometryRepository.load(record).catch(() => undefined)
    }
  }, [asset, record])

  if (asset === undefined) {
    return null
  }

  return (
    <group name={`${record.id}-imported-visual`}>
      <primitive object={asset.group} />
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
  equipmentObjectsRef?: RefObject<Map<string, Object3D>>
  onDraggingChange?(dragging: boolean): void
}

const NOOP_DRAGGING_CHANGE = () => undefined

export function EquipmentScene({
  equipmentObjectsRef: providedEquipmentObjectsRef,
  onDraggingChange = NOOP_DRAGGING_CHANGE,
}: EquipmentSceneProps = {}) {
  const records = useEquipmentStore((state) => state.records)
  const heldEquipmentId = useInteractionStore((state) => state.heldEquipmentId)
  const hiddenEntityIds = useInteractionStore((state) => state.hiddenEntityIds)
  const localEquipmentObjectsRef = useRef(new Map<string, Object3D>())
  const equipmentObjectsRef =
    providedEquipmentObjectsRef ?? localEquipmentObjectsRef

  return (
    <group name="equipment-scene">
      {records
        .filter(
          (record) =>
            record.id !== heldEquipmentId &&
            !hiddenEntityIds.includes(record.id),
        )
        .map((record) => (
          <EquipmentInstance
            equipmentObjectsRef={equipmentObjectsRef}
            key={record.id}
            onDraggingChange={onDraggingChange}
            record={record}
          />
        ))}
    </group>
  )
}
