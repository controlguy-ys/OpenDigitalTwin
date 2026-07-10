import { DoubleSide, Vector2 } from 'three'
import type { EquipmentRecord } from '../../domain/equipment/equipment'
import { StackLight } from './StackLight'

interface BuiltInEquipmentProps {
  record: EquipmentRecord
}

export const CUP_VISUAL = {
  height: 0.15,
  waterZ: 0.132,
  waterColor: '#2d9cdb',
} as const

export const CUP_PROFILE_POINTS = [
  [0.043, 0],
  [0.049, 0.008],
  [0.052, 0.125],
  [0.049, CUP_VISUAL.height],
] as const satisfies readonly (readonly [number, number])[]

export const MACHINE_VISUAL = {
  collisionHalfExtents: [0.14, 0.12, 0.2],
  size: [0.28, 0.24, 0.4],
} as const

const CUP_PROFILE = CUP_PROFILE_POINTS.map(
  ([radius, height]) => new Vector2(radius, height),
)
const Z_UP_CYLINDER_ROTATION: [number, number, number] = [Math.PI / 2, 0, 0]

function Cup({ record }: BuiltInEquipmentProps) {
  const isGlass = record.id === 'cup-01'

  return (
    <group
      name={`${record.id}-visual`}
      position={[0, 0, -CUP_VISUAL.height / 2]}
    >
      <mesh
        castShadow
        name={`${record.id}-body`}
        receiveShadow
        rotation={Z_UP_CYLINDER_ROTATION}
      >
        <latheGeometry args={[CUP_PROFILE, 48]} />
        {isGlass ? (
          <meshPhysicalMaterial
            color="#d9edf1"
            metalness={0.04}
            opacity={0.42}
            roughness={0.12}
            side={DoubleSide}
            thickness={0.004}
            transparent
            transmission={0.56}
          />
        ) : (
          <meshStandardMaterial
            color="#aeb8bf"
            metalness={0.9}
            roughness={0.2}
            side={DoubleSide}
          />
        )}
      </mesh>
      <mesh
        castShadow
        name={`${record.id}-bottom`}
        position={[0, 0, 0.004]}
        receiveShadow
        rotation={Z_UP_CYLINDER_ROTATION}
      >
        <cylinderGeometry args={[0.044, 0.044, 0.008, 48]} />
        <meshStandardMaterial
          color={isGlass ? '#b8d5da' : '#89949b'}
          metalness={isGlass ? 0.12 : 0.88}
          opacity={isGlass ? 0.5 : 1}
          roughness={0.24}
          transparent={isGlass}
        />
      </mesh>
      <mesh
        castShadow
        name={`${record.id}-rim`}
        position={[0, 0, CUP_VISUAL.height]}
      >
        <torusGeometry args={[0.049, 0.003, 12, 48]} />
        <meshStandardMaterial
          color="#c4cdd2"
          metalness={0.9}
          roughness={0.18}
        />
      </mesh>
      <mesh name={`${record.id}-water`} position={[0, 0, CUP_VISUAL.waterZ]}>
        <circleGeometry args={[0.044, 48]} />
        <meshPhysicalMaterial
          color={CUP_VISUAL.waterColor}
          metalness={0.02}
          opacity={0.82}
          roughness={0.16}
          transparent
          transmission={0.08}
        />
      </mesh>
    </group>
  )
}

function Machine({ record }: BuiltInEquipmentProps) {
  const stackLightAnchor = record.stackLightAnchor

  return (
    <group name={`${record.id}-visual`}>
      <mesh castShadow name={`${record.id}-cabinet`} receiveShadow>
        <boxGeometry args={[...MACHINE_VISUAL.size]} />
        <meshStandardMaterial
          color="#657078"
          metalness={0.82}
          roughness={0.3}
        />
      </mesh>
      <mesh
        castShadow
        name={`${record.id}-front-panel`}
        position={[0, 0.123, 0.035]}
      >
        <boxGeometry args={[0.21, 0.008, 0.2]} />
        <meshStandardMaterial
          color="#303940"
          metalness={0.68}
          roughness={0.28}
        />
      </mesh>
      <mesh name={`${record.id}-display`} position={[0, 0.128, 0.085]}>
        <boxGeometry args={[0.13, 0.006, 0.058]} />
        <meshStandardMaterial
          color="#10212a"
          emissive="#123d4b"
          emissiveIntensity={0.35}
          metalness={0.2}
          roughness={0.32}
        />
      </mesh>
      <mesh
        name={`${record.id}-emergency-stop`}
        position={[0.082, 0.137, -0.025]}
        rotation={Z_UP_CYLINDER_ROTATION}
      >
        <cylinderGeometry args={[0.018, 0.021, 0.014, 24]} />
        <meshStandardMaterial
          color="#ce302d"
          emissive="#4a0705"
          emissiveIntensity={0.25}
          roughness={0.36}
        />
      </mesh>
      {stackLightAnchor === null ? null : (
        <>
          <mesh
            castShadow
            name={`${record.id}-stack-light-support`}
            position={[
              stackLightAnchor[0],
              stackLightAnchor[1],
              (MACHINE_VISUAL.size[2] / 2 + stackLightAnchor[2]) / 2,
            ]}
            rotation={Z_UP_CYLINDER_ROTATION}
          >
            <cylinderGeometry
              args={[
                0.009,
                0.009,
                stackLightAnchor[2] - MACHINE_VISUAL.size[2] / 2,
                18,
              ]}
            />
            <meshStandardMaterial
              color="#5d666d"
              metalness={0.9}
              roughness={0.2}
            />
          </mesh>
          <group
            name={`${record.id}-stack-light-anchor`}
            position={stackLightAnchor}
          >
            <StackLight
              name={`${record.id}-stack-light`}
              status={record.status}
            />
          </group>
        </>
      )}
    </group>
  )
}

export function BuiltInEquipment({ record }: BuiltInEquipmentProps) {
  if (record.kind === 'cup') {
    return <Cup record={record} />
  }

  if (record.kind === 'machine') {
    return <Machine record={record} />
  }

  return null
}
