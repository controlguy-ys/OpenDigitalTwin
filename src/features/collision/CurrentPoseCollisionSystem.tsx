import { useFrame } from '@react-three/fiber'
import { useMemo } from 'react'
import { useEventStore } from '../../state/event-store'
import { synchronizeCollisionFindings } from '../interaction/collision-events'
import { useInteractionStore } from '../interaction/interaction-store'
import { useRobotStore } from '../joints/robot-store'
import { useProjectStore } from '../project/project-store-browser'
import { useCollisionStore } from './collision-store'
import {
  CurrentPoseCollisionScheduler,
  currentPoseCollisionRevision,
  publishCurrentPoseCollision,
} from './current-pose-collision'

export interface CurrentPoseCollisionSystemProps {
  pausePlaybackOnCollision?: boolean
}

export const CURRENT_POSE_COLLISION_FRAME_PRIORITY = 0

export function CurrentPoseCollisionSystem({
  pausePlaybackOnCollision,
}: CurrentPoseCollisionSystemProps) {
  const scheduler = useMemo(() => new CurrentPoseCollisionScheduler(), [])
  const robotMountContact = useProjectStore(
    (state) => state.activeSnapshot?.scene.robotMountContact ?? null,
  )

  useFrame(({ clock }) => {
    const policy = useCollisionStore.getState().policy
    const revision = currentPoseCollisionRevision(
      policy,
      undefined,
      robotMountContact,
    )
    scheduler.observe(clock.elapsedTime * 1_000, revision, () => {
      const result = publishCurrentPoseCollision(
        useCollisionStore,
        undefined,
        robotMountContact,
      )
      const shouldPause =
        pausePlaybackOnCollision ??
        useCollisionStore.getState().pausePlaybackOnCollision
      synchronizeCollisionFindings(result.findings, {
        interactionStore: useInteractionStore,
        eventStore: useEventStore,
        now: Date.now,
        ...(shouldPause
          ? {
              pausePlayback: () =>
                useRobotStore.getState().setPlaying(false),
            }
          : {}),
      })
    })
  }, CURRENT_POSE_COLLISION_FRAME_PRIORITY)

  return null
}
