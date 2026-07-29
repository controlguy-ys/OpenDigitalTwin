import { useEffect, useMemo, useRef, type ReactNode } from 'react'

import type { ForwardKinematicsResultV1 } from '../../../core/mechanism-runtime-v1/types.js'

export interface MechanismBodyVisualV1 {
  readonly bodyId: string
  readonly sizeM: readonly [number, number, number]
  readonly color: string
}

export interface MechanismPoseLayerV1Props {
  readonly bodyWorldPoses: ForwardKinematicsResultV1['bodyWorldPoses']
  readonly visuals: readonly MechanismBodyVisualV1[]
  readonly onDiagnostic?: (code: 'BODY_POSE_NOT_FOUND', bodyId: string) => void
}

export function MechanismPoseLayerV1({ bodyWorldPoses, visuals, onDiagnostic }: MechanismPoseLayerV1Props): ReactNode {
  const missingBodyIds = useMemo(() => {
    const missing = new Set<string>()
    for (const { bodyId } of visuals) if (bodyWorldPoses[bodyId] === undefined) missing.add(bodyId)
    return [...missing].sort()
  }, [bodyWorldPoses, visuals])
  const previousMissingBodyIds = useRef<ReadonlySet<string>>(new Set())

  useEffect(() => {
    const previous = previousMissingBodyIds.current
    for (const bodyId of missingBodyIds) {
      if (!previous.has(bodyId)) onDiagnostic?.('BODY_POSE_NOT_FOUND', bodyId)
    }
    previousMissingBodyIds.current = new Set(missingBodyIds)
  }, [missingBodyIds, onDiagnostic])

  return <>
    {visuals.map((visual) => {
      const pose = bodyWorldPoses[visual.bodyId]
      if (pose === undefined) return null
      return <group
        data-testid={`mechanism-body:${visual.bodyId}`}
        key={visual.bodyId}
        position={[...pose.positionM]}
        quaternion={[...pose.quaternion]}
      >
        <mesh>
          <boxGeometry args={[...visual.sizeM]} />
          <meshStandardMaterial color={visual.color} />
        </mesh>
      </group>
    })}
  </>
}
