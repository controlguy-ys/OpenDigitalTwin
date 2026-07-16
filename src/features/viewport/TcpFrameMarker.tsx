import { Html } from '@react-three/drei/web/Html.js'
import { useFrame } from '@react-three/fiber'
import { useMemo, useRef } from 'react'
import { ArrowHelper, Group, MathUtils, PerspectiveCamera, Vector3 } from 'three'

const AXES = [
  { id: 'x', label: 'X', direction: new Vector3(1, 0, 0), color: 0xff3b30, labelPosition: [0.14, 0, 0] as const },
  { id: 'y', label: 'Y', direction: new Vector3(0, 1, 0), color: 0x34c759, labelPosition: [0, 0.14, 0] as const },
  { id: 'z', label: 'Z', direction: new Vector3(0, 0, 1), color: 0x1688ff, labelPosition: [0, 0, 0.14] as const },
] as const

export function createLabelledFrameMarker(name: string, frame: string): Group {
  const marker = new Group()
  marker.name = `${name}-frame`
  marker.userData = { frame, depthAware: true }
  for (const axis of AXES) {
    const arrow = new ArrowHelper(axis.direction, new Vector3(), 0.12, axis.color, 0.035, 0.018)
    arrow.name = `${name}-${axis.id}`
    arrow.userData = { label: axis.label, frame }
    arrow.traverse((object) => {
      if ('material' in object && object.material !== undefined) {
        const materials = Array.isArray(object.material) ? object.material : [object.material]
        for (const material of materials) {
          if ('depthTest' in material) material.depthTest = true
        }
      }
    })
    marker.add(arrow)
  }
  return marker
}

export function frameMarkerScale(distance: number, verticalFovDeg: number, viewportHeightPx: number): number {
  if (!(distance > 0) || !(viewportHeightPx > 0)) return 1
  const visibleHeight = 2 * distance * Math.tan(MathUtils.degToRad(verticalFovDeg / 2))
  return visibleHeight * 28 / viewportHeightPx / 0.12
}

export function displayedFrameMarkerScale(
  distance: number,
  verticalFovDeg: number,
  viewportHeightPx: number,
): number {
  return Math.min(frameMarkerScale(distance, verticalFovDeg, viewportHeightPx), 3)
}

export interface TcpFrameMarkerProps {
  readonly name?: string
  readonly frameName?: string
  readonly visible: boolean
}

export function TcpFrameMarker({
  name = 'actual-tcp',
  frameName = 'Actual TCP',
  visible,
}: TcpFrameMarkerProps) {
  const marker = useMemo(() => createLabelledFrameMarker(name, frameName), [frameName, name])
  const visualRef = useRef<Group>(null)
  const worldPosition = useMemo(() => new Vector3(), [])
  useFrame(({ camera, size }) => {
    if (visualRef.current === null || !(camera instanceof PerspectiveCamera)) return
    visualRef.current.getWorldPosition(worldPosition)
    const scale = displayedFrameMarkerScale(
      camera.position.distanceTo(worldPosition),
      camera.fov,
      size.height,
    )
    visualRef.current.scale.setScalar(scale)
  })
  if (!visible) return null
  return (
    <group name={`${name}-visual`} ref={visualRef} userData={{ frame: frameName, depthAware: true }}>
      <primitive object={marker} />
      <mesh name={`${name}-origin`}>
        <sphereGeometry args={[0.012, 12, 12]} />
        <meshBasicMaterial color="#f4f7fb" depthTest />
      </mesh>
      {AXES.map((axis) => (
        <Html center key={axis.id} occlude position={axis.labelPosition} transform>
          <span className={`frame-axis-label frame-axis-${axis.id}`}>{axis.label}</span>
        </Html>
      ))}
      <Html center occlude position={[0, 0, -0.045]} transform>
        <span className="frame-name-label">{frameName}</span>
      </Html>
    </group>
  )
}
