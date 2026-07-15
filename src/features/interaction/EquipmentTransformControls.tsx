import { TransformControls } from '@react-three/drei/core/TransformControls.js'
import { useEffect, useLayoutEffect, useRef, type RefObject } from 'react'
import type { Object3D } from 'three'
import type { SerializableTransform } from '../../domain/equipment/equipment'
import type { ExternalCollisionEntityId } from './interaction-store'

export interface EquipmentTransformControlsProps {
  entityId: ExternalCollisionEntityId
  objectRef: RefObject<Object3D | null>
  previewTransform(id: string, transform: SerializableTransform): void
  commitTransform(id: string): Promise<void>
  onDraggingChange(dragging: boolean): void
  space?: 'world' | 'local'
}

export function readObjectTransform(object: Object3D): SerializableTransform {
  return {
    position: object.position.toArray(),
    quaternion: object.quaternion.toArray(),
    scale: object.scale.toArray(),
  }
}

export function EquipmentTransformControls({
  entityId,
  objectRef,
  previewTransform,
  commitTransform,
  onDraggingChange,
  space = 'world',
}: EquipmentTransformControlsProps) {
  const onDraggingChangeRef = useRef(onDraggingChange)
  useLayoutEffect(() => {
    onDraggingChangeRef.current = onDraggingChange
  }, [onDraggingChange])

  useEffect(
    () => () => {
      onDraggingChangeRef.current(false)
    },
    [],
  )

  return (
    <TransformControls
      mode="translate"
      object={objectRef as RefObject<Object3D>}
      onMouseDown={() => {
        onDraggingChangeRef.current(true)
      }}
      onMouseUp={() => {
        onDraggingChangeRef.current(false)
        void commitTransform(entityId)
      }}
      onObjectChange={() => {
        const object = objectRef.current
        if (object !== null) {
          previewTransform(entityId, readObjectTransform(object))
        }
      }}
      size={0.8}
      space={space}
    />
  )
}
