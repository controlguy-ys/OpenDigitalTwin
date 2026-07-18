import { GizmoHelper } from '@react-three/drei/core/GizmoHelper.js'
import { GizmoViewcube } from '@react-three/drei/core/GizmoViewcube.js'
import type { ThreeEvent } from '@react-three/fiber'
import type { ReactNode } from 'react'
import { Vector3 } from 'three'
import type { WorldViewDirectionV4 } from '../camera-actions.js'
import {
  ZERO_VIEWPORT_SAFE_AREA_INSETS_V4,
  type ViewportSafeAreaInsetsV4,
} from './viewport-safe-area.js'

export interface WorldViewCubePropsV4 {
  readonly onDirection: (direction: WorldViewDirectionV4) => void
  readonly safeAreaInsets?: ViewportSafeAreaInsetsV4
}

const VIEW_CUBE_TARGET_PX_V4 = 88
const DREI_VIEW_CUBE_BASE_PX_V4 = 60

export function WorldViewCubeV4({
  onDirection,
  safeAreaInsets = ZERO_VIEWPORT_SAFE_AREA_INSETS_V4,
}: WorldViewCubePropsV4): ReactNode {
  const handleClick = (event: ThreeEvent<MouseEvent>): null => {
    event.stopPropagation()
    const objectDirection = event.object.position
    const source = objectDirection.lengthSq() > 1e-8
      ? objectDirection
      : event.face?.normal ?? new Vector3()
    onDirection([source.x, source.y, source.z])
    return null
  }

  return (
    <GizmoHelper
      alignment="top-right"
      margin={[56 + safeAreaInsets.right, 56 + safeAreaInsets.top]}
    >
      <group scale={VIEW_CUBE_TARGET_PX_V4 / DREI_VIEW_CUBE_BASE_PX_V4}>
        <GizmoViewcube
          color="#d9e2e8"
          faces={['Right', 'Left', 'Back', 'Front', 'Top', 'Bottom']}
          hoverColor="#38bdf8"
          onClick={handleClick}
          strokeColor="#526674"
          textColor="#17232d"
        />
      </group>
    </GizmoHelper>
  )
}
