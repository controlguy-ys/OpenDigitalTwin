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
import {
  robotConfigurationToDefinition,
  useRobotConfigurationStore,
} from '../robot/robot-configuration-store'

function activeRobotDefinition() {
  return robotConfigurationToDefinition(
    useRobotConfigurationStore.getState().configuration,
  )
}

export interface RobotStoreState extends RobotFrameState {
  gripperOpen: boolean
  keyframes: readonly RobotKeyframe[]
  playbackResetRevision: number
  setJoint(jointIndex: number, angleDeg: number): void
  applyFrame(frame: JointFrame, nowMs?: number): void
  home(): void
  reset(): void
  replacePublishedKeyframes(keyframes: readonly RobotKeyframe[]): void
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

  replacePublishedKeyframes: (keyframes) => {
    const next: readonly RobotKeyframe[] = keyframes.map((keyframe) => ({
      ...keyframe,
      anglesDeg: [
        keyframe.anglesDeg[0],
        keyframe.anglesDeg[1],
        keyframe.anglesDeg[2],
        keyframe.anglesDeg[3],
        keyframe.anglesDeg[4],
        keyframe.anglesDeg[5],
      ],
    }))
    set((state) => ({
      keyframes: next,
      playing: false,
      playbackResetRevision: state.playbackResetRevision + 1,
    }))
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
