import { OrbitControls } from '@react-three/drei/core/OrbitControls.js'
import {
  forwardRef,
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'
import type { Group, Object3D } from 'three'
import { EquipmentScene } from '../equipment/EquipmentScene'
import { CollisionSystem } from '../interaction/CollisionSystem'
import { useInteractionStore } from '../interaction/interaction-store'
import { hasActiveCollision } from '../interaction/outline-state'
import {
  GraspController,
  type InteractionRuntimeController,
} from '../interaction/GraspController'
import type { RobotRigRegistration } from '../robot/RobotModel'
import { RobotModel } from '../robot/RobotModel'
import {
  WORKBENCH_TOP_THICKNESS,
  WORKBENCH_TOP_Z,
} from './workcell-constants'
import { useCoordinateFrameStore } from '../frames/coordinate-frame-store'
import { registerGeometryEntity } from '../collision/geometry-entity-registry'
import { workbenchToGeometryEntity } from '../collision/scene-entity-adapter'

export { WORKBENCH_TOP_Z } from './workcell-constants'

interface WorkcellProps {
  registerRig: (registration: RobotRigRegistration | null) => void
  registerInteractionController?:
    | ((controller: InteractionRuntimeController | null) => void)
    | undefined
}

const WORKBENCH_LEGS = [
  [-0.78, -0.48],
  [-0.78, 0.48],
  [0.78, -0.48],
  [0.78, 0.48],
] as const

const Workbench = forwardRef<Group>(function Workbench(_props, ref) {
  const activeCollisionPairs = useInteractionStore(
    (state) => state.activeCollisionPairs,
  )
  const collision = hasActiveCollision(
    'workcell:workbench',
    activeCollisionPairs,
  )
  return (
    <group name="workbench" ref={ref}>
      <mesh
        castShadow
        name="workbench-top"
        position={[0, 0, WORKBENCH_TOP_Z - WORKBENCH_TOP_THICKNESS / 2]}
        receiveShadow
      >
        <boxGeometry args={[1.8, 1.2, WORKBENCH_TOP_THICKNESS]} />
        <meshStandardMaterial color="#6f767c" metalness={0.8} roughness={0.34} />
      </mesh>
      {collision ? (
        <mesh
          name="workbench-collision-outline"
          position={[0, 0, WORKBENCH_TOP_Z - WORKBENCH_TOP_THICKNESS / 2]}
          renderOrder={1000}
          userData={{ outline: 'collision', workcellId: 'workbench' }}
        >
          <boxGeometry
            args={[
              1.8 * 1.01,
              1.2 * 1.01,
              WORKBENCH_TOP_THICKNESS * 1.04,
            ]}
          />
          <meshBasicMaterial
            color="#ff3b30"
            depthTest={false}
            opacity={0.86}
            transparent
            wireframe
          />
        </mesh>
      ) : null}
      {WORKBENCH_LEGS.map(([x, y]) => (
        <mesh
          castShadow
          key={`${x}-${y}`}
          position={[x, y, 0.49]}
          receiveShadow
        >
          <boxGeometry args={[0.09, 0.09, 0.98]} />
          <meshStandardMaterial color="#252b30" metalness={0.72} roughness={0.38} />
        </mesh>
      ))}
    </group>
  )
})

export function Workcell({
  registerRig,
  registerInteractionController,
}: WorkcellProps) {
  const [rig, setRig] = useState<RobotRigRegistration | null>(null)
  const [orbitEnabled, setOrbitEnabled] = useState(true)
  const mcp = useCoordinateFrameStore((state) => state.frames.mcp)
  const equipmentObjectsRef = useRef(new Map<string, Object3D>())
  const workbenchObjectRef = useRef<Group>(null)
  const handleRigRegistration = useCallback(
    (registration: RobotRigRegistration | null) => {
      setRig(registration)
      registerRig(registration)
    },
    [registerRig],
  )
  const handleEquipmentDraggingChange = useCallback((dragging: boolean) => {
    setOrbitEnabled(!dragging)
  }, [])

  useLayoutEffect(
    () =>
      registerGeometryEntity(
        workbenchToGeometryEntity(workbenchObjectRef.current),
      ),
    [],
  )

  return (
    <>
      <ambientLight intensity={0.68} />
      <directionalLight
        castShadow
        intensity={1.8}
        position={[3.2, -2.4, 5]}
        shadow-mapSize-height={2048}
        shadow-mapSize-width={2048}
      />
      <mesh name="workcell-floor" position={[0, 0, 0]} receiveShadow>
        <planeGeometry args={[6, 6]} />
        <meshStandardMaterial color="#121a21" metalness={0.18} roughness={0.9} />
      </mesh>
      <gridHelper
        args={[6, 60, '#344754', '#1d2a33']}
        name="workcell-grid"
        position={[0, 0, 0.002]}
        rotation={[Math.PI / 2, 0, 0]}
      />
      <Workbench ref={workbenchObjectRef} />
      <group
        name="mcp-frame"
        position={mcp.position}
        quaternion={mcp.quaternion}
      >
        <EquipmentScene
          equipmentObjectsRef={equipmentObjectsRef}
          onDraggingChange={handleEquipmentDraggingChange}
        />
        <group name="robot-workbench-mount" position={[0, 0, WORKBENCH_TOP_Z]}>
          <RobotModel registerRig={handleRigRegistration} />
        </group>
      </group>
      <CollisionSystem
        equipmentObjectsRef={equipmentObjectsRef}
        rig={rig}
        workbenchObjectRef={workbenchObjectRef}
      />
      {rig === null ? null : (
        <GraspController
          equipmentObjectsRef={equipmentObjectsRef}
          registerController={registerInteractionController}
          rig={rig}
          workbenchTopZ={WORKBENCH_TOP_Z}
        />
      )}
      <OrbitControls
        enableDamping
        enabled={orbitEnabled}
        makeDefault
        maxDistance={5}
        minDistance={0.8}
        target={[0.15, 0, 1.55]}
      />
    </>
  )
}
