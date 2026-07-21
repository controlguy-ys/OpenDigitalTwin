import {
  composeRigidTransformV4,
  relativeRigidTransformV4,
  type RigidTransformV4,
  type WorkcellProjectV4,
} from '../../../core/project-v4/index.js'
import { createStore, type StoreApi } from 'zustand/vanilla'

import {
  HACKATHON_HANDOVER_IDS_V4,
  HACKATHON_HANDOVER_STEPS_V4,
} from '../../project/v4/hackathon-handover-sample-v4.js'

export type HandoverPartOwnerV4 = 'TABLE' | 'NED2-A' | 'NED2-B' | 'OUTPUT_TRAY'
export type HandoverZoneOwnerV4 = 'NONE' | 'NED2-A' | 'NED2-B'
export type HandoverRunStateV4 = 'IDLE' | 'RUNNING' | 'SUCCEEDED' | 'FAULTED'

export interface HandoverPoseOverrideV4 {
  readWorldPose(entityId: string): RigidTransformV4 | null
}

export function createHandoverPoseOverrideV4(
  store: StoreApi<HandoverDemoRuntimeStateV4>,
): Readonly<HandoverPoseOverrideV4> {
  return Object.freeze({
    readWorldPose: (entityId: string) => store.getState().readWorldPose(entityId),
  })
}

export interface HandoverDemoRuntimeStateV4 extends HandoverPoseOverrideV4 {
  readonly runState: HandoverRunStateV4
  readonly step: typeof HACKATHON_HANDOVER_STEPS_V4[number]
  readonly partOwner: HandoverPartOwnerV4
  readonly sharedZoneOwner: HandoverZoneOwnerV4
  readonly failureCode: 'GRIP_CONFIRM_TIMEOUT' | null
  readonly injectGripConfirmTimeout: boolean
  readonly generation: number
  setFaultInjection(enabled: boolean): void
  begin(runId: string): number
  setStep(generation: number, step: HandoverDemoRuntimeStateV4['step']): boolean
  attach(
    generation: number,
    owner: 'NED2-A' | 'NED2-B',
    toolWorld: RigidTransformV4,
    objectWorld: RigidTransformV4,
  ): boolean
  updateAttachedPose(
    generation: number,
    owner: 'NED2-A' | 'NED2-B',
    toolWorld: RigidTransformV4,
  ): boolean
  transfer(
    generation: number,
    owner: 'NED2-A' | 'NED2-B',
    newToolWorld: RigidTransformV4,
  ): boolean
  place(generation: number, worldPose: RigidTransformV4): boolean
  complete(generation: number): boolean
  failGripConfirm(generation: number): boolean
  reset(): void
}

const IDENTITY_POSE_V4: RigidTransformV4 = {
  positionM: [0, 0, 0],
  quaternion: [0, 0, 0, 1],
}

function copyPoseV4(pose: RigidTransformV4): RigidTransformV4 {
  return composeRigidTransformV4(IDENTITY_POSE_V4, pose)
}

function sharedZoneOwnerForStepV4(
  step: HandoverDemoRuntimeStateV4['step'],
  partOwner: HandoverPartOwnerV4,
): HandoverZoneOwnerV4 {
  if (
    step === 'MOVE_TO_SHARED_ZONE'
    || step === 'HANDOVER_APPROACH'
    || step === 'HANDOVER_CONFIRM'
    || step === 'PLACE'
  ) {
    return partOwner === 'NED2-A' || partOwner === 'NED2-B'
      ? partOwner
      : 'NONE'
  }
  return 'NONE'
}

export function createHandoverDemoRuntimeStoreV4(
  project: WorkcellProjectV4,
): StoreApi<HandoverDemoRuntimeStateV4> {
  const authoredWorkpiece = project.spatialEntities.find(
    ({ id }) => id === HACKATHON_HANDOVER_IDS_V4.workpieceId,
  )
  const initialWorkpieceWorld = authoredWorkpiece === undefined
    ? null
    : copyPoseV4(authoredWorkpiece.localPose)
  let workpieceWorld = initialWorkpieceWorld
  let toolToObject: RigidTransformV4 | null = null

  return createStore<HandoverDemoRuntimeStateV4>()((set, get) => {
    const accepts = (generation: number): boolean => (
      generation === get().generation
    )
    const publishPoseChange = (): void => {
      set((state) => ({ ...state }), true)
    }

    return {
      runState: 'IDLE',
      step: 'READY',
      partOwner: 'TABLE',
      sharedZoneOwner: 'NONE',
      failureCode: null,
      injectGripConfirmTimeout: false,
      generation: 0,
      readWorldPose: (entityId) => (
        entityId === HACKATHON_HANDOVER_IDS_V4.workpieceId
          ? workpieceWorld
          : null
      ),
      setFaultInjection: (enabled) => {
        set({ injectGripConfirmTimeout: enabled })
      },
      begin: (runId) => {
        void runId
        const generation = get().generation + 1
        workpieceWorld = initialWorkpieceWorld
        toolToObject = null
        set({
          runState: 'RUNNING',
          step: 'READY',
          partOwner: 'TABLE',
          sharedZoneOwner: 'NONE',
          failureCode: null,
          generation,
        })
        return generation
      },
      setStep: (generation, step) => {
        if (!accepts(generation)) return false
        set({
          step,
          sharedZoneOwner: sharedZoneOwnerForStepV4(step, get().partOwner),
        })
        return true
      },
      attach: (generation, owner, toolWorld, objectWorld) => {
        if (!accepts(generation)) return false
        toolToObject = relativeRigidTransformV4(toolWorld, objectWorld)
        workpieceWorld = copyPoseV4(objectWorld)
        set({ partOwner: owner })
        return true
      },
      updateAttachedPose: (generation, owner, toolWorld) => {
        if (
          !accepts(generation)
          || get().partOwner !== owner
          || toolToObject === null
        ) return false
        workpieceWorld = composeRigidTransformV4(toolWorld, toolToObject)
        publishPoseChange()
        return true
      },
      transfer: (generation, owner, newToolWorld) => {
        if (!accepts(generation) || workpieceWorld === null || toolToObject === null) {
          return false
        }
        toolToObject = relativeRigidTransformV4(newToolWorld, workpieceWorld)
        set({ partOwner: owner, sharedZoneOwner: owner })
        return true
      },
      place: (generation, worldPose) => {
        if (!accepts(generation)) return false
        workpieceWorld = copyPoseV4(worldPose)
        toolToObject = null
        set({ partOwner: 'OUTPUT_TRAY', sharedZoneOwner: 'NONE' })
        return true
      },
      complete: (generation) => {
        if (!accepts(generation)) return false
        set({
          runState: 'SUCCEEDED',
          step: 'COMPLETE',
          sharedZoneOwner: 'NONE',
          failureCode: null,
          injectGripConfirmTimeout: false,
        })
        return true
      },
      failGripConfirm: (generation) => {
        if (!accepts(generation)) return false
        set({
          runState: 'FAULTED',
          failureCode: 'GRIP_CONFIRM_TIMEOUT',
        })
        return true
      },
      reset: () => {
        workpieceWorld = initialWorkpieceWorld
        toolToObject = null
        set({
          runState: 'IDLE',
          step: 'READY',
          partOwner: 'TABLE',
          sharedZoneOwner: 'NONE',
          failureCode: null,
          injectGripConfirmTimeout: false,
          generation: get().generation + 1,
        })
      },
    }
  })
}
