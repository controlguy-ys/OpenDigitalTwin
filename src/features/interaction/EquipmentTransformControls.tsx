import { TransformControls } from '@react-three/drei/core/TransformControls.js'
import { useEffect, useLayoutEffect, useRef, type RefObject } from 'react'
import { Object3D, type QuaternionTuple } from 'three'
import type { SerializableTransform } from '../../domain/equipment/equipment'
import type { ExternalCollisionEntityId } from './interaction-store'

export interface EquipmentTransformControlsProps {
  entityId: ExternalCollisionEntityId
  objectRef: RefObject<Object3D | null>
  previewTransform(id: string, transform: SerializableTransform): void
  commitTransform(id: string): Promise<void>
  onDraggingChange(dragging: boolean): void
  space?: 'world' | 'parent'
  parentQuaternion?: QuaternionTuple
}

export function readObjectTransform(object: Object3D): SerializableTransform {
  return {
    position: object.position.toArray(),
    quaternion: object.quaternion.toArray(),
    scale: object.scale.toArray(),
  }
}

export function synchronizeParentGizmoProxy(
  proxy: Object3D,
  object: Object3D,
  parentQuaternion: QuaternionTuple,
): void {
  proxy.position.copy(object.position)
  proxy.quaternion.set(...parentQuaternion).normalize()
  proxy.scale.set(1, 1, 1)
  proxy.updateMatrix()
}

export function applyParentGizmoTranslation(proxy: Object3D, object: Object3D): void {
  object.position.copy(proxy.position)
  object.updateMatrix()
}

export function EquipmentTransformControls({
  entityId,
  objectRef,
  previewTransform,
  commitTransform,
  onDraggingChange,
  space = 'world',
  parentQuaternion = [0, 0, 0, 1],
}: EquipmentTransformControlsProps) {
  const onDraggingChangeRef = useRef(onDraggingChange)
  useLayoutEffect(() => {
    onDraggingChangeRef.current = onDraggingChange
  }, [onDraggingChange])
  const parentProxyRef = useRef(new Object3D())
  const parentQuaternionKey = parentQuaternion.join('|')
  useLayoutEffect(() => {
    if (space !== 'parent' || objectRef.current === null) return
    const proxy = parentProxyRef.current
    synchronizeParentGizmoProxy(proxy, objectRef.current, parentQuaternion)
    objectRef.current.parent?.add(proxy)
    return () => {
      proxy.removeFromParent()
    }
  }, [objectRef, parentQuaternionKey, space])
  const controlRef = space === 'parent'
    ? parentProxyRef as RefObject<Object3D>
    : objectRef as RefObject<Object3D>

  useEffect(
    () => () => {
      onDraggingChangeRef.current(false)
    },
    [],
  )

  return (
    <TransformControls
      mode="translate"
      object={controlRef}
      onMouseDown={() => {
        if (space === 'parent' && objectRef.current !== null) {
          synchronizeParentGizmoProxy(parentProxyRef.current, objectRef.current, parentQuaternion)
        }
        onDraggingChangeRef.current(true)
      }}
      onMouseUp={() => {
        onDraggingChangeRef.current(false)
        void commitTransform(entityId)
      }}
      onObjectChange={() => {
        const object = objectRef.current
        if (object !== null) {
          if (space === 'parent') applyParentGizmoTranslation(parentProxyRef.current, object)
          previewTransform(entityId, readObjectTransform(object))
        }
      }}
      size={0.8}
      space={space === 'parent' ? 'local' : 'world'}
    />
  )
}
