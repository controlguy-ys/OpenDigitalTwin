import { GizmoHelper } from '@react-three/drei/core/GizmoHelper.js'
import { GizmoViewcube } from '@react-three/drei/core/GizmoViewcube.js'
import type { ThreeEvent } from '@react-three/fiber'
import type { ReactNode } from 'react'
import { Vector3 } from 'three'
import type { WorldViewDirectionV4 } from '../camera-actions.js'
import type { AppCommandBindingsV4 } from '../../commands/v4/app-command-runtime.js'
import {
  ZERO_VIEWPORT_SAFE_AREA_INSETS_V4,
  type ViewportSafeAreaInsetsV4,
} from './viewport-safe-area.js'

export interface WorldViewCubePropsV4 {
  readonly commandBindings: AppCommandBindingsV4
  readonly onDirection: (direction: WorldViewDirectionV4) => void
  readonly safeAreaInsets?: ViewportSafeAreaInsetsV4
}

const VIEW_CUBE_TARGET_PX_V4 = 88
const DREI_VIEW_CUBE_BASE_PX_V4 = 60
const WORLD_VIEW_CUBE_FACES_V4: string[] = [
  'Right', 'Left', 'Back', 'Front', 'Top', 'Bottom',
]
Object.freeze(WORLD_VIEW_CUBE_FACES_V4)

export function WorldViewCubeV4({
  commandBindings,
  onDirection,
  safeAreaInsets = ZERO_VIEWPORT_SAFE_AREA_INSETS_V4,
}: WorldViewCubePropsV4): ReactNode {
  const handleClick = (event: ThreeEvent<MouseEvent>): null => {
    event.stopPropagation()
    const objectDirection = event.object.position
    const source = objectDirection.lengthSq() > 1e-8
      ? objectDirection
      : event.face?.normal ?? new Vector3()
    const direction: WorldViewDirectionV4 = [source.x, source.y, source.z]
    const material = direction.filter((value) => Math.abs(value) > 1e-8)
    if (material.length === 1) {
      const [x, y, z] = direction
      const id = x > 0 ? 'view.orientation.right'
        : x < 0 ? 'view.orientation.left'
          : y < 0 ? 'view.orientation.front'
            : y > 0 ? 'view.orientation.back'
              : z > 0 ? 'view.orientation.top'
                : z < 0 ? 'view.orientation.bottom'
                  : null
      if (id !== null && commandBindings.getRegistry().get(id)?.visible === true) {
        void commandBindings.runtime.invoke(id)
      }
    } else if (material.length > 1) {
      onDirection(direction)
    }
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
          faces={WORLD_VIEW_CUBE_FACES_V4}
          hoverColor="#38bdf8"
          onClick={handleClick}
          strokeColor="#526674"
          textColor="#17232d"
        />
      </group>
    </GizmoHelper>
  )
}
