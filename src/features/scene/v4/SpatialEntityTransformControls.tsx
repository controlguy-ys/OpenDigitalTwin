import { TransformControls } from '@react-three/drei/core/TransformControls.js'
import {
  useEffect,
  useLayoutEffect,
  useRef,
  type ReactNode,
} from 'react'
import { Object3D } from 'three'
import {
  relativeRigidTransformV4,
  type RigidTransformV4,
} from '../../../core/project-v4/rigid-transform.js'
import type { SpatialEntityIdV4 } from '../../../core/project-v4/types.js'

export interface SpatialEntityTransformControlsPropsV4 {
  readonly entityId: SpatialEntityIdV4
  readonly object: Object3D
  readonly gizmoFrame: 'world' | 'parent'
  readonly persistedWorldPose: RigidTransformV4
  readonly parentWorldPose: RigidTransformV4
  readonly onCommitLocalPose: (
    entityId: SpatialEntityIdV4,
    localPose: RigidTransformV4,
  ) => Promise<void>
  readonly onDraggingChange: (dragging: boolean) => void
}

function applyWorldPoseV4(object: Object3D, pose: RigidTransformV4): void {
  object.position.set(...pose.positionM)
  object.quaternion.set(...pose.quaternion)
  object.updateMatrixWorld()
}

function objectWorldPoseV4(object: Object3D): RigidTransformV4 {
  return {
    positionM: [object.position.x, object.position.y, object.position.z],
    quaternion: [
      object.quaternion.x,
      object.quaternion.y,
      object.quaternion.z,
      object.quaternion.w,
    ],
  }
}

function synchronizeParentProxyV4(
  proxy: Object3D,
  object: Object3D,
  parentWorldPose: RigidTransformV4,
): void {
  proxy.position.copy(object.position)
  proxy.quaternion.set(...parentWorldPose.quaternion).normalize()
  proxy.scale.set(1, 1, 1)
  proxy.updateMatrixWorld()
}

export function SpatialEntityTransformControlsV4({
  entityId,
  object,
  gizmoFrame,
  persistedWorldPose,
  parentWorldPose,
  onCommitLocalPose,
  onDraggingChange,
}: SpatialEntityTransformControlsPropsV4): ReactNode {
  const parentProxyRef = useRef(new Object3D())
  const draggingRef = useRef(false)
  const committingRef = useRef(false)
  const persistedWorldPoseRef = useRef(persistedWorldPose)
  const parentWorldPoseRef = useRef(parentWorldPose)
  const onCommitLocalPoseRef = useRef(onCommitLocalPose)
  const onDraggingChangeRef = useRef(onDraggingChange)
  persistedWorldPoseRef.current = persistedWorldPose
  parentWorldPoseRef.current = parentWorldPose
  onCommitLocalPoseRef.current = onCommitLocalPose
  onDraggingChangeRef.current = onDraggingChange

  useLayoutEffect(() => {
    if (gizmoFrame !== 'parent' || object.parent === null) return
    const proxy = parentProxyRef.current
    synchronizeParentProxyV4(proxy, object, parentWorldPose)
    object.parent.add(proxy)
    return () => {
      proxy.removeFromParent()
    }
  }, [gizmoFrame, object, parentWorldPose])

  useEffect(() => () => {
    if (!draggingRef.current) return
    draggingRef.current = false
    onDraggingChangeRef.current(false)
  }, [])

  const controlObject = gizmoFrame === 'parent' ? parentProxyRef.current : object

  return (
    <TransformControls
      mode="translate"
      object={controlObject}
      onMouseDown={() => {
        if (gizmoFrame === 'parent') {
          synchronizeParentProxyV4(
            parentProxyRef.current,
            object,
            parentWorldPoseRef.current,
          )
        }
        persistedWorldPoseRef.current = persistedWorldPose
        draggingRef.current = true
        onDraggingChangeRef.current(true)
      }}
      onMouseUp={() => {
        if (!draggingRef.current || committingRef.current) return
        draggingRef.current = false
        onDraggingChangeRef.current(false)
        committingRef.current = true
        const localPose = relativeRigidTransformV4(
          parentWorldPoseRef.current,
          objectWorldPoseV4(object),
        )
        void onCommitLocalPoseRef.current(entityId, localPose)
          .catch(() => applyWorldPoseV4(object, persistedWorldPoseRef.current))
          .finally(() => {
            committingRef.current = false
          })
      }}
      onObjectChange={() => {
        if (!draggingRef.current || gizmoFrame !== 'parent') return
        object.position.copy(parentProxyRef.current.position)
        object.updateMatrixWorld()
      }}
      space={gizmoFrame === 'parent' ? 'local' : 'world'}
    />
  )
}
