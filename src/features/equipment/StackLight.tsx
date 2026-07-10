import type { EquipmentStatus } from '../../domain/equipment/equipment'
import { STATUS_LIGHTS } from '../../domain/equipment/equipment'

type StackLightLens = 'red' | 'yellow' | 'green'

interface StackLightPointLightState {
  color: string
  distance: number
  intensity: number
}

export interface StackLightLensRenderState {
  lens: StackLightLens
  active: boolean
  color: string
  emissiveIntensity: number
  positionZ: number
  pointLight: StackLightPointLightState | null
}

interface StackLightProps {
  status: EquipmentStatus
  name?: string
}

const LENS_DEFINITIONS = [
  { lens: 'green', color: '#2dd36f', positionZ: 0.12 },
  { lens: 'yellow', color: '#ffbf2f', positionZ: 0.165 },
  { lens: 'red', color: '#ee3d35', positionZ: 0.21 },
] as const satisfies readonly {
  lens: StackLightLens
  color: string
  positionZ: number
}[]

const SEPARATOR_POSITIONS = [0.0975, 0.1425, 0.1875, 0.2325] as const
const Z_UP_CYLINDER_ROTATION: [number, number, number] = [Math.PI / 2, 0, 0]

export function getStackLightRenderState(
  status: EquipmentStatus,
): StackLightLensRenderState[] {
  const activeLenses = STATUS_LIGHTS[status]

  return LENS_DEFINITIONS.map(({ lens, color, positionZ }) => {
    const active = activeLenses[lens]
    return {
      lens,
      active,
      color,
      emissiveIntensity: active ? 2.4 : 0.08,
      positionZ,
      pointLight: active
        ? { color, distance: 0.45, intensity: 0.4 }
        : null,
    }
  })
}

export function StackLight({ status, name = 'stack-light' }: StackLightProps) {
  const lenses = getStackLightRenderState(status)

  return (
    <group name={name}>
      <mesh
        castShadow
        name={`${name}-base`}
        position={[0, 0, 0.015]}
        rotation={Z_UP_CYLINDER_ROTATION}
      >
        <cylinderGeometry args={[0.052, 0.057, 0.03, 28]} />
        <meshStandardMaterial color="#222a30" metalness={0.82} roughness={0.28} />
      </mesh>
      <mesh
        castShadow
        name={`${name}-stem`}
        position={[0, 0, 0.064]}
        rotation={Z_UP_CYLINDER_ROTATION}
      >
        <cylinderGeometry args={[0.009, 0.009, 0.068, 18]} />
        <meshStandardMaterial color="#5d666d" metalness={0.9} roughness={0.2} />
      </mesh>
      <mesh
        castShadow
        name={`${name}-housing`}
        position={[0, 0, 0.091]}
        rotation={Z_UP_CYLINDER_ROTATION}
      >
        <cylinderGeometry args={[0.048, 0.048, 0.018, 28]} />
        <meshStandardMaterial color="#171d22" metalness={0.76} roughness={0.3} />
      </mesh>
      {lenses.map((lens) => (
        <group key={lens.lens}>
          <mesh
            castShadow
            name={`${name}-${lens.lens}-lens`}
            position={[0, 0, lens.positionZ]}
            rotation={Z_UP_CYLINDER_ROTATION}
          >
            <cylinderGeometry args={[0.044, 0.044, 0.038, 32]} />
            <meshPhysicalMaterial
              color={lens.color}
              emissive={lens.color}
              emissiveIntensity={lens.emissiveIntensity}
              metalness={0.05}
              opacity={0.72}
              roughness={0.24}
              thickness={0.018}
              transparent
              transmission={0.12}
            />
          </mesh>
          {lens.pointLight === null ? null : (
            <pointLight
              color={lens.pointLight.color}
              decay={2}
              distance={lens.pointLight.distance}
              intensity={lens.pointLight.intensity}
              name={`${name}-${lens.lens}-glow`}
              position={[0, 0, lens.positionZ]}
            />
          )}
        </group>
      ))}
      {SEPARATOR_POSITIONS.map((positionZ) => (
        <mesh
          castShadow
          key={positionZ}
          name={`${name}-separator`}
          position={[0, 0, positionZ]}
          rotation={Z_UP_CYLINDER_ROTATION}
        >
          <cylinderGeometry args={[0.049, 0.049, 0.007, 28]} />
          <meshStandardMaterial color="#1a2025" metalness={0.8} roughness={0.25} />
        </mesh>
      ))}
    </group>
  )
}
