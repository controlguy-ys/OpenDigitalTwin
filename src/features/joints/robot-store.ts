import { create } from 'zustand'
import {
  clampJointAngles,
  initialRobotState,
  reduceJointFrame,
  ZERO_JOINT_ANGLES,
  type JointFrame,
  type RobotFrameState,
} from '../../domain/robot/joint-frame'
import type { RobotKeyframe } from './keyframes'

export interface RobotStoreState extends RobotFrameState {
  gripperOpen: boolean
  keyframes: readonly RobotKeyframe[]
  playbackResetRevision: number
  setJoint(jointIndex: number, angleDeg: number): void
  applyFrame(frame: JointFrame, nowMs?: number): void
  home(): void
  reset(): void
  savePose(): void
  clearKeyframes(): void
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
  keyframes: [],
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
      return { anglesDeg: clampJointAngles(anglesDeg) }
    })
  },

  applyFrame: (frame, nowMs = Date.now()) => {
    set((state) => reduceJointFrame(state, frame, nowMs))
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
      }

      return { keyframes: [...state.keyframes, keyframe] }
    })
  },

  clearKeyframes: () => {
    set({ keyframes: [] })
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
