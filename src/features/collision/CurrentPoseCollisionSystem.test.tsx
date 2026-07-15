import { render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import {
  CURRENT_POSE_COLLISION_FRAME_PRIORITY,
  CurrentPoseCollisionSystem,
} from './CurrentPoseCollisionSystem'

const useFrameMock = vi.hoisted(() => vi.fn())
vi.mock('@react-three/fiber', () => ({ useFrame: useFrameMock }))

describe('CurrentPoseCollisionSystem frame ordering', () => {
  it('mounts collision sampling at explicit priority zero after negative-priority axis updates', () => {
    useFrameMock.mockClear()

    render(<CurrentPoseCollisionSystem />)

    expect(useFrameMock).toHaveBeenCalledWith(
      expect.any(Function),
      CURRENT_POSE_COLLISION_FRAME_PRIORITY,
    )
    expect(CURRENT_POSE_COLLISION_FRAME_PRIORITY).toBe(0)
  })
})
