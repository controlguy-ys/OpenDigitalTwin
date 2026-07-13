import { createPortal } from '@react-three/fiber'
import { useCallback, useLayoutEffect, useRef } from 'react'
import type { Group, Object3D } from 'three'
import { registerGeometryEntity } from '../collision/geometry-entity-registry'
import { useRobotStore } from '../joints/robot-store'

interface RobotGripperProps {
  tcpFrame: Group
}

export function registerRobotToolGeometryEntity(
  object: Object3D,
): () => void {
  return registerGeometryEntity({
    id: 'tool:default',
    name: 'Parallel gripper',
    category: 'tool',
    boxes: [
      {
        id: 'default',
        center: [0, 0, 0.0775],
        halfExtents: [0.036, 0.047, 0.0775],
        quaternion: [0, 0, 0, 1],
      },
    ],
    object,
    colliderRevision: 0,
  })
}

export function RobotGripper({ tcpFrame }: RobotGripperProps) {
  const gripperOpen = useRobotStore((state) => state.gripperOpen)
  const jawOffset = gripperOpen ? 0.038 : 0.018
  const cleanupRegistrationRef = useRef<(() => void) | null>(null)
  const registerTool = useCallback((object: Group | null) => {
    cleanupRegistrationRef.current?.()
    cleanupRegistrationRef.current =
      object === null ? null : registerRobotToolGeometryEntity(object)
  }, [])

  useLayoutEffect(
    () => () => {
      cleanupRegistrationRef.current?.()
      cleanupRegistrationRef.current = null
    },
    [],
  )

  return createPortal(
    <group name="parallel-gripper" ref={registerTool}>
      <mesh castShadow position={[0, 0, 0.025]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[0.034, 0.034, 0.05, 24]} />
        <meshStandardMaterial color="#8a949d" metalness={0.8} roughness={0.28} />
      </mesh>
      <mesh castShadow position={[0, 0, 0.065]}>
        <boxGeometry args={[0.072, 0.072, 0.035]} />
        <meshStandardMaterial color="#303a43" metalness={0.7} roughness={0.34} />
      </mesh>
      {[-1, 1].map((direction) => (
        <mesh
          castShadow
          key={direction}
          position={[0, direction * jawOffset, 0.115]}
        >
          <boxGeometry args={[0.018, 0.018, 0.08]} />
          <meshStandardMaterial color="#bbc4ca" metalness={0.72} roughness={0.3} />
        </mesh>
      ))}
    </group>,
    tcpFrame,
  )
}
