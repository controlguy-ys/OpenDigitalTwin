import { OrbitControls } from '@react-three/drei/core/OrbitControls.js'
import { EquipmentScene } from '../equipment/EquipmentScene'
import type { RobotRigRegistration } from '../robot/RobotModel'
import { RobotModel } from '../robot/RobotModel'

interface WorkcellProps {
  registerRig: (registration: RobotRigRegistration | null) => void
}

const WORKBENCH_TOP_Z = 1.08
const WORKBENCH_TOP_THICKNESS = 0.1
const WORKBENCH_LEGS = [
  [-0.78, -0.48],
  [-0.78, 0.48],
  [0.78, -0.48],
  [0.78, 0.48],
] as const

function Workbench() {
  return (
    <group name="workbench">
      <mesh
        castShadow
        name="workbench-top"
        position={[0, 0, WORKBENCH_TOP_Z - WORKBENCH_TOP_THICKNESS / 2]}
        receiveShadow
      >
        <boxGeometry args={[1.8, 1.2, WORKBENCH_TOP_THICKNESS]} />
        <meshStandardMaterial color="#6f767c" metalness={0.8} roughness={0.34} />
      </mesh>
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
}

export function Workcell({ registerRig }: WorkcellProps) {
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
      <Workbench />
      <EquipmentScene />
      <group name="robot-workbench-mount" position={[0, 0, WORKBENCH_TOP_Z]}>
        <RobotModel registerRig={registerRig} />
      </group>
      <OrbitControls
        enableDamping
        makeDefault
        maxDistance={5}
        minDistance={0.8}
        target={[0.15, 0, 1.55]}
      />
    </>
  )
}
