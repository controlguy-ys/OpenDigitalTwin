import { create } from 'zustand'
import {
  clampJointAngles,
  initialRobotState,
  reduceJointFrame,
  ZERO_JOINT_ANGLES,
  type JointFrame,
  type RobotFrameState,
} from '../../domain/robot/joint-frame'

export interface RobotStoreState extends RobotFrameState {
  gripperOpen: boolean
  setJoint(jointIndex: number, angleDeg: number): void
  applyFrame(frame: JointFrame, nowMs?: number): void
  home(): void
  reset(): void
  setPlaying(playing: boolean): void
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
    })
  },

  setPlaying: (playing) => {
    set({ playing })
  },

  setGripperOpen: (gripperOpen) => {
    set({ gripperOpen })
  },
}))
