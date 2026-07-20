import {
  composeRigidTransformV5,
  normalizeRigidTransformV5,
  type RigidTransformV5,
} from '../../../core/project-v5/index.js'
import { deepFreezeV5 } from '../../../core/project-v5/validation-support.js'
import type { StoreApi } from 'zustand/vanilla'
import type { AttachmentRuntimeStoreV1 } from '../../actions/v5/attachment-runtime-store.js'

export interface AttachmentPoseRuntimeV1 {
  readObjectWorldPose(
    objectId: string,
    readRobotFrameWorldPose: (robotId: string, frameId: string) => RigidTransformV5 | null,
    readSceneFrameWorldPose: (frameId: string) => RigidTransformV5 | null,
  ): RigidTransformV5 | null
}

function frozenPose(value: RigidTransformV5): RigidTransformV5 {
  return deepFreezeV5(normalizeRigidTransformV5(value, '$.attachmentWorldPose'))
}

export function createAttachmentPoseRuntimeV1(
  store: StoreApi<AttachmentRuntimeStoreV1>,
): AttachmentPoseRuntimeV1 {
  const readObjectWorldPose: AttachmentPoseRuntimeV1['readObjectWorldPose'] = (
    objectId,
    readRobotFrameWorldPose,
    readSceneFrameWorldPose,
  ) => {
    const state = store.getState()
    const attachment = Object.hasOwn(state.attachmentsByObjectId, objectId)
      ? state.attachmentsByObjectId[objectId]!
      : null
    if (attachment !== null) {
      const toolWorldPose = readRobotFrameWorldPose(attachment.robotId, attachment.toolFrameId)
      return toolWorldPose === null
        ? frozenPose(attachment.objectWorldPoseAtAttach)
        : frozenPose(composeRigidTransformV5(toolWorldPose, attachment.toolFromObject))
    }

    const detached = Object.hasOwn(state.detachedOverridesByObjectId, objectId)
      ? state.detachedOverridesByObjectId[objectId]!
      : null
    if (detached !== null) {
      const parentWorldPose = readSceneFrameWorldPose(detached.parentFrameId)
      return parentWorldPose === null
        ? frozenPose(detached.objectWorldPoseAtDetach)
        : frozenPose(composeRigidTransformV5(parentWorldPose, detached.localPose))
    }
    return null
  }

  return Object.freeze({ readObjectWorldPose })
}
