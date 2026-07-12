import { create } from 'zustand'
import {
  clampJointAngles,
  initialRobotState,
  reduceJointFrame,
  ZERO_JOINT_ANGLES,
  type JointFrame,
  type RobotFrameState,
} from '../../domain/robot/joint-frame'
import {
  deriveTransitionDurationMs,
  type RobotKeyframe,
} from './keyframes'
import {
  robotConfigurationToDefinition,
  useRobotConfigurationStore,
} from '../robot/robot-configuration-store'

function activeRobotDefinition() {
  return robotConfigurationToDefinition(
    useRobotConfigurationStore.getState().configuration,
  )
}

function recalculateKeyframeDurations(
  keyframes: readonly RobotKeyframe[],
): readonly RobotKeyframe[] {
  const velocities = useRobotConfigurationStore
    .getState()
    .configuration.joints.map((joint) => joint.maxVelocityDegPerSec)
  return keyframes.map((keyframe, index) => {
    const next = keyframes[index + 1]
    if (next === undefined) return keyframe
    const speedPercent = keyframe.speedPercentToNext ?? 100
    return {
      ...keyframe,
      durationMs: deriveTransitionDurationMs(
        keyframe,
        next,
        speedPercent,
        velocities,
      ),
    }
  })
}

const POSE_STORAGE_KEY = 'robot-sim.pose-sequence.v1'

function persistKeyframes(keyframes: readonly RobotKeyframe[]): void {
  try {
    globalThis.localStorage?.setItem(POSE_STORAGE_KEY, JSON.stringify(keyframes))
  } catch {
    // Browser storage is an optional durability layer; simulation stays usable.
  }
}

function readPersistedKeyframes(): readonly RobotKeyframe[] {
  try {
    const raw = globalThis.localStorage?.getItem(POSE_STORAGE_KEY)
    if (raw === null || raw === undefined) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []

    const ids = new Set<string>()
    const keyframes: RobotKeyframe[] = []
    for (const candidate of parsed) {
      if (typeof candidate !== 'object' || candidate === null) return []
      const pose = candidate as Partial<RobotKeyframe>
      const durationMs = pose.durationMs
      if (
        typeof pose.id !== 'string' ||
        ids.has(pose.id) ||
        typeof pose.name !== 'string' ||
        !Array.isArray(pose.anglesDeg) ||
        pose.anglesDeg.length !== 6 ||
        pose.anglesDeg.some((angle) => !Number.isFinite(angle)) ||
        typeof durationMs !== 'number' ||
        !Number.isFinite(durationMs) ||
        durationMs <= 0 ||
        (pose.easing !== 'linear' && pose.easing !== 'easeInOut')
      ) {
        return []
      }
      const speedPercentToNext = pose.speedPercentToNext ?? 100
      if (!Number.isFinite(speedPercentToNext)) return []
      ids.add(pose.id)
      keyframes.push({
        id: pose.id,
        name: pose.name,
        anglesDeg: pose.anglesDeg as RobotKeyframe['anglesDeg'],
        durationMs,
        easing: pose.easing,
        speedPercentToNext: Math.min(100, Math.max(1, speedPercentToNext)),
      })
    }
    return keyframes
  } catch {
    return []
  }
}

export interface RobotStoreState extends RobotFrameState {
  gripperOpen: boolean
  keyframes: readonly RobotKeyframe[]
  playbackResetRevision: number
  setJoint(jointIndex: number, angleDeg: number): void
  applyFrame(frame: JointFrame, nowMs?: number): void
  home(): void
  reset(): void
  savePose(): void
  hydrateKeyframes(): void
  clearKeyframes(): void
  moveKeyframe(id: string, direction: -1 | 1): void
  deleteKeyframe(id: string): void
  setKeyframeSpeed(id: string, speedPercent: number): void
  setPlaying(playing: boolean): void
  stopPlayback(): void
  setGripperOpen(gripperOpen: boolean): void
}

type RobotStoreSelector<T> = (state: RobotStoreState) => T

export const jointAngleSelectors = [
  (state: RobotStoreState) => state.anglesDeg[0],
  (state: RobotStoreState) => state.anglesDeg[1],
  (state: RobotStoreState) => state.anglesDeg[2],
  (state: RobotStoreState) => state.anglesDeg[3],
  (state: RobotStoreState) => state.anglesDeg[4],
  (state: RobotStoreState) => state.anglesDeg[5],
] as const satisfies readonly RobotStoreSelector<number>[]

export const useRobotStore = create<RobotStoreState>()((set) => ({
  ...initialRobotState,
  gripperOpen: true,
  keyframes: readPersistedKeyframes(),
  playbackResetRevision: 0,

  setJoint: (jointIndex, angleDeg) => {
    if (!Number.isInteger(jointIndex) || jointIndex < 0 || jointIndex >= 6) {
      throw new RangeError('Joint index must be an integer from 0 through 5')
    }

    set((state) => {
      const anglesDeg = [...state.anglesDeg] as [
        number,
        number,
        number,
        number,
        number,
        number,
      ]
      anglesDeg[jointIndex] = angleDeg
      return { anglesDeg: clampJointAngles(anglesDeg, activeRobotDefinition()) }
    })
  },

  applyFrame: (frame, nowMs = Date.now()) => {
    set((state) => reduceJointFrame(state, frame, nowMs, activeRobotDefinition()))
  },

  home: () => {
    set({ anglesDeg: ZERO_JOINT_ANGLES })
  },

  reset: () => {
    set({
      ...initialRobotState,
      gripperOpen: true,
      keyframes: [],
      playbackResetRevision: 0,
    })
  },

  savePose: () => {
    set((state) => {
      const poseNumber = state.keyframes.length + 1
      const keyframe: RobotKeyframe = {
        id: `pose-${poseNumber}`,
        name: `Pose ${poseNumber}`,
        anglesDeg: [
          state.anglesDeg[0],
          state.anglesDeg[1],
          state.anglesDeg[2],
          state.anglesDeg[3],
          state.anglesDeg[4],
          state.anglesDeg[5],
        ],
        durationMs: 1000,
        easing: 'easeInOut',
        speedPercentToNext: 100,
      }

      const keyframes = recalculateKeyframeDurations([
        ...state.keyframes,
        keyframe,
      ])
      persistKeyframes(keyframes)
      return { keyframes }
    })
  },

  hydrateKeyframes: () => {
    set({ keyframes: readPersistedKeyframes() })
  },

  clearKeyframes: () => {
    persistKeyframes([])
    set({ keyframes: [] })
  },

  moveKeyframe: (id, direction) => {
    set((state) => {
      const fromIndex = state.keyframes.findIndex((keyframe) => keyframe.id === id)
      const toIndex = fromIndex + direction
      if (
        fromIndex < 0 ||
        (direction !== -1 && direction !== 1) ||
        toIndex < 0 ||
        toIndex >= state.keyframes.length
      ) {
        return state
      }

      const keyframes = [...state.keyframes]
      const [moved] = keyframes.splice(fromIndex, 1)
      if (moved === undefined) {
        return state
      }
      keyframes.splice(toIndex, 0, moved)
      const recalculated = recalculateKeyframeDurations(keyframes)
      persistKeyframes(recalculated)
      return { keyframes: recalculated, playing: false }
    })
  },

  deleteKeyframe: (id) => {
    set((state) => {
      const keyframes = recalculateKeyframeDurations(
        state.keyframes.filter((keyframe) => keyframe.id !== id),
      )
      persistKeyframes(keyframes)
      return { keyframes, playing: false }
    })
  },

  setKeyframeSpeed: (id, speedPercent) => {
    if (!Number.isFinite(speedPercent)) {
      throw new Error('Pose speed must be a finite number')
    }

    const clampedSpeedPercent = Math.min(100, Math.max(1, speedPercent))
    set((state) => {
      const keyframes = recalculateKeyframeDurations(state.keyframes.map((keyframe) =>
        keyframe.id === id
          ? {
              ...keyframe,
              speedPercentToNext: clampedSpeedPercent,
            }
          : keyframe,
      ))
      persistKeyframes(keyframes)
      return { keyframes, playing: false }
    })
  },

  setPlaying: (playing) => {
    set({ playing })
  },

  stopPlayback: () => {
    set((state) => ({
      playing: false,
      playbackResetRevision: state.playbackResetRevision + 1,
    }))
  },

  setGripperOpen: (gripperOpen) => {
    set({ gripperOpen })
  },
}))
