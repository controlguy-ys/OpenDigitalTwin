import { TransformControls } from '@react-three/drei/core/TransformControls.js'
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
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

interface SpatialEntityCommitAttemptV4 {
  readonly token: number
  readonly entityId: SpatialEntityIdV4
  readonly object: Object3D
  readonly rollbackPose: RigidTransformV4
}

function applyWorldPoseV4(object: Object3D, pose: RigidTransformV4): void {
  object.position.set(...pose.positionM)
  object.quaternion.set(...pose.quaternion)
  object.updateMatrixWorld()
}

function cloneRigidTransformV4(pose: RigidTransformV4): RigidTransformV4 {
  return {
    positionM: [...pose.positionM],
    quaternion: [...pose.quaternion],
  }
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
  const [committing, setCommitting] = useState(false)
  const parentProxyRef = useRef(new Object3D())
  const draggingRef = useRef(false)
  const committingRef = useRef(false)
  const mountedRef = useRef(true)
  const nextAttemptTokenRef = useRef(0)
  const activeAttemptRef = useRef<SpatialEntityCommitAttemptV4 | null>(null)
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

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      if (!draggingRef.current) return
      draggingRef.current = false
      onDraggingChangeRef.current(false)
    }
  }, [])

  const controlObject = gizmoFrame === 'parent' ? parentProxyRef.current : object

  return (
    <TransformControls
      enabled={!committing}
      mode="translate"
      object={controlObject}
      onMouseDown={() => {
        if (committingRef.current) return
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
        setCommitting(true)
        const attempt: SpatialEntityCommitAttemptV4 = {
          token: ++nextAttemptTokenRef.current,
          entityId,
          object,
          rollbackPose: cloneRigidTransformV4(persistedWorldPoseRef.current),
        }
        activeAttemptRef.current = attempt
        const localPose = relativeRigidTransformV4(
          parentWorldPoseRef.current,
          objectWorldPoseV4(attempt.object),
        )
        void onCommitLocalPoseRef.current(attempt.entityId, localPose)
          .catch(() => {
            const activeAttempt = activeAttemptRef.current
            if (
              activeAttempt?.token !== attempt.token
              || activeAttempt.entityId !== attempt.entityId
            ) return
            applyWorldPoseV4(activeAttempt.object, activeAttempt.rollbackPose)
          })
          .finally(() => {
            const activeAttempt = activeAttemptRef.current
            if (
              activeAttempt?.token !== attempt.token
              || activeAttempt.entityId !== attempt.entityId
            ) return
            activeAttemptRef.current = null
            committingRef.current = false
            if (mountedRef.current) setCommitting(false)
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
