import { TransformControls } from '@react-three/drei/core/TransformControls.js'
import { useEffect, type RefObject } from 'react'
import type { Object3D } from 'three'
import type { SerializableTransform } from '../../domain/equipment/equipment'

export interface EquipmentTransformControlsProps {
  equipmentId: string
  objectRef: RefObject<Object3D | null>
  previewTransform(id: string, transform: SerializableTransform): void
  commitTransform(id: string): Promise<void>
  onDraggingChange(dragging: boolean): void
}

export function readObjectTransform(object: Object3D): SerializableTransform {
  return {
    position: object.position.toArray(),
    quaternion: object.quaternion.toArray(),
    scale: object.scale.toArray(),
  }
}

export function EquipmentTransformControls({
  equipmentId,
  objectRef,
  previewTransform,
  commitTransform,
  onDraggingChange,
}: EquipmentTransformControlsProps) {
  useEffect(
    () => () => {
      onDraggingChange(false)
    },
    [onDraggingChange],
  )

  return (
    <TransformControls
      mode="translate"
      object={objectRef as RefObject<Object3D>}
      onMouseDown={() => {
        onDraggingChange(true)
      }}
      onMouseUp={() => {
        onDraggingChange(false)
        void commitTransform(equipmentId)
      }}
      onObjectChange={() => {
        const object = objectRef.current
        if (object !== null) {
          previewTransform(equipmentId, readObjectTransform(object))
        }
      }}
      size={0.8}
      space="world"
    />
  )
}
