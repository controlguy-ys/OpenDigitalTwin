import { useFrame } from '@react-three/fiber'
import { useMemo } from 'react'
import { useEventStore } from '../../state/event-store'
import { synchronizeCollisionFindings } from '../interaction/collision-events'
import { useInteractionStore } from '../interaction/interaction-store'
import { useRobotStore } from '../joints/robot-store'
import { useCollisionStore } from './collision-store'
import {
  CurrentPoseCollisionScheduler,
  currentPoseCollisionRevision,
  publishCurrentPoseCollision,
} from './current-pose-collision'

export interface CurrentPoseCollisionSystemProps {
  pausePlaybackOnCollision?: boolean
}

export function CurrentPoseCollisionSystem({
  pausePlaybackOnCollision = true,
}: CurrentPoseCollisionSystemProps) {
  const scheduler = useMemo(() => new CurrentPoseCollisionScheduler(), [])

  useFrame(({ clock }) => {
    const policy = useCollisionStore.getState().policy
    const revision = currentPoseCollisionRevision(policy)
    scheduler.observe(clock.elapsedTime * 1_000, revision, () => {
      const result = publishCurrentPoseCollision(useCollisionStore)
      synchronizeCollisionFindings(result.findings, {
        interactionStore: useInteractionStore,
        eventStore: useEventStore,
        now: Date.now,
        ...(pausePlaybackOnCollision
          ? {
              pausePlayback: () =>
                useRobotStore.getState().setPlaying(false),
            }
          : {}),
      })
    })
  })

  return null
}
