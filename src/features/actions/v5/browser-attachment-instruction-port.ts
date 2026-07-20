import {
  composeRigidTransformV5,
  validateWorkcellProjectV5,
  normalizeRigidTransformV5,
  type RigidTransformV5,
  type RobotJobInstructionV1,
  type WorkcellProjectV5,
} from '../../../core/project-v5/index.js'
import { createAttachmentInstructionErrorV1 } from '../../../core/action-runtime-v5/attachment-instruction-error.js'
import {
  prepareAttachTransitionV1,
  prepareDetachTransitionV1,
} from '../../../core/action-runtime-v5/attachment-transition.js'
import type {
  AttachmentInstructionPortV1,
  JobInstructionContextV1,
} from '../../jobs/v5/job-executor.js'
import type { StoreApi } from 'zustand/vanilla'
import type { AttachmentRuntimeStoreV1 } from './attachment-runtime-store.js'

const CONFIG_REVISION_PATTERN = /^[0-9a-f]{64}$/u

type AttachInstructionV1 = Extract<RobotJobInstructionV1, { readonly kind: 'attach' }>
type DetachInstructionV1 = Extract<RobotJobInstructionV1, { readonly kind: 'detach' }>

export interface BrowserAttachmentInstructionPortOptionsV1 {
  readonly readProject: () => WorkcellProjectV5
  readonly readConfigRevision: () => string
  readonly attachments: StoreApi<AttachmentRuntimeStoreV1>
  readonly readRobotFrameWorldPose: (robotId: string, frameId: string) => RigidTransformV5 | null
  readonly readSceneFrameWorldPose: (frameId: string) => RigidTransformV5 | null
  readonly readObjectWorldPose: (objectId: string) => RigidTransformV5 | null
}

interface CapturedProjectV1 {
  readonly project: WorkcellProjectV5
  readonly configRevision: string
  readonly attachmentsByObjectId: AttachmentRuntimeStoreV1['attachmentsByObjectId']
  readonly detachedOverridesByObjectId: AttachmentRuntimeStoreV1['detachedOverridesByObjectId']
}

function failure(
  code: Parameters<typeof createAttachmentInstructionErrorV1>[0],
  message: string,
): never {
  throw createAttachmentInstructionErrorV1(code, message)
}

function exactMap<T extends { readonly id: string }>(values: readonly T[]): ReadonlyMap<string, T> {
  return new Map(values.map((value) => [value.id, value]))
}

function globalFrameParents(project: WorkcellProjectV5): ReadonlyMap<string, string | null> {
  const parents = new Map<string, string | null>()
  for (const frame of project.scene.frames) parents.set(frame.id, frame.parentFrameId)
  for (const entity of project.spatialEntities) {
    for (const frame of entity.graspFrames) parents.set(frame.frameId, entity.parentFrameId)
    for (const frame of entity.movingFrames) parents.set(frame.frameId, frame.parentFrameId)
  }
  return parents
}

function ancestryReaches(
  startFrameId: string,
  targetFrameIds: ReadonlySet<string>,
  parents: ReadonlyMap<string, string | null>,
): boolean {
  const visited = new Set<string>()
  let current: string | null = startFrameId
  while (current !== null && !visited.has(current)) {
    if (targetFrameIds.has(current)) return true
    visited.add(current)
    current = parents.get(current) ?? null
  }
  return false
}

function canonicalPosesMatch(actual: RigidTransformV5, prepared: RigidTransformV5): boolean {
  const expected = normalizeRigidTransformV5(prepared, '$.preparedAttachmentPose')
  return actual.positionM.every((value, index) => value === expected.positionM[index])
    && actual.quaternion.every((value, index) => value === expected.quaternion[index])
}

export function createBrowserAttachmentInstructionPortV1(
  options: BrowserAttachmentInstructionPortOptionsV1,
): AttachmentInstructionPortV1 {
  const assertRevision = (captured: CapturedProjectV1): void => {
    const state = options.attachments.getState()
    if (
      state.projectRevisionId !== captured.project.revisionId
      || state.configRevision !== captured.configRevision
      || state.attachmentsByObjectId !== captured.attachmentsByObjectId
      || state.detachedOverridesByObjectId !== captured.detachedOverridesByObjectId
    ) {
      failure(
        'SOURCE_OWNERSHIP_CONFLICT',
        'The Attachment Project or configuration changed while preparing the instruction.',
      )
    }
  }

  const capture = (): CapturedProjectV1 => {
    const stateBeforeReaders = options.attachments.getState()
    if (stateBeforeReaders.projectRevisionId === null || stateBeforeReaders.configRevision === null) {
      failure('SOURCE_OWNERSHIP_CONFLICT', 'The Attachment Store has no active Project/configuration identity.')
    }
    const project = validateWorkcellProjectV5(options.readProject())
    const stateAfterProjectReader = options.attachments.getState()
    if (
      stateAfterProjectReader.projectRevisionId !== stateBeforeReaders.projectRevisionId
      || stateAfterProjectReader.configRevision !== stateBeforeReaders.configRevision
      || stateAfterProjectReader.attachmentsByObjectId !== stateBeforeReaders.attachmentsByObjectId
      || stateAfterProjectReader.detachedOverridesByObjectId !== stateBeforeReaders.detachedOverridesByObjectId
      || stateBeforeReaders.projectRevisionId !== project.revisionId
    ) {
      failure('SOURCE_OWNERSHIP_CONFLICT', 'The Attachment Store changed while reading the current Project.')
    }
    const configRevision = options.readConfigRevision()
    if (!CONFIG_REVISION_PATTERN.test(configRevision) || configRevision !== stateBeforeReaders.configRevision) {
      failure('SOURCE_OWNERSHIP_CONFLICT', 'The current Attachment configuration revision is invalid.')
    }
    const stateAfterConfigReader = options.attachments.getState()
    if (
      stateAfterConfigReader.projectRevisionId !== stateBeforeReaders.projectRevisionId
      || stateAfterConfigReader.configRevision !== stateBeforeReaders.configRevision
      || stateAfterConfigReader.attachmentsByObjectId !== stateBeforeReaders.attachmentsByObjectId
      || stateAfterConfigReader.detachedOverridesByObjectId !== stateBeforeReaders.detachedOverridesByObjectId
    ) {
      failure('SOURCE_OWNERSHIP_CONFLICT', 'The Attachment Store changed while reading its configuration revision.')
    }
    const captured = Object.freeze({
      project,
      configRevision,
      attachmentsByObjectId: stateBeforeReaders.attachmentsByObjectId,
      detachedOverridesByObjectId: stateBeforeReaders.detachedOverridesByObjectId,
    })
    assertRevision(captured)
    return captured
  }

  const attach = async (
    instruction: AttachInstructionV1,
    context: JobInstructionContextV1,
  ): Promise<void> => {
    const captured = capture()
    const robots = exactMap(captured.project.robots)
    const definitions = exactMap(captured.project.robotDefinitions)
    const entities = exactMap(captured.project.spatialEntities)
    const robot = robots.get(context.robotId)
    const object = entities.get(instruction.objectId)
    if (robot === undefined || object === undefined || !object.graspable) {
      failure('ATTACHMENT_TARGET_NOT_FOUND', 'The exact Attach Robot or Object target does not exist.')
    }
    const definition = definitions.get(robot.definitionId)
    if (definition === undefined) {
      failure('ATTACHMENT_TARGET_NOT_FOUND', `Robot Definition ${robot.definitionId} does not exist.`)
    }
    const tools = exactMap(definition.frames)
    if (!tools.has(instruction.toolFrameId)) {
      failure('ATTACHMENT_TARGET_NOT_FOUND', `Tool Frame ${instruction.toolFrameId} does not belong to Robot ${robot.id}.`)
    }
    const graspFrames = new Map(object.graspFrames.map((frame) => [frame.frameId, frame]))
    const grasp = instruction.objectGraspFrameId === null
      ? null
      : graspFrames.get(instruction.objectGraspFrameId)
    if (instruction.objectGraspFrameId !== null && grasp === undefined) {
      failure('ATTACHMENT_TARGET_NOT_FOUND', `Grasp Frame ${instruction.objectGraspFrameId} does not belong to Object ${object.id}.`)
    }

    const existing = captured.attachmentsByObjectId[instruction.objectId]
    if (existing !== undefined) {
      failure('ALREADY_ATTACHED', `Object ${instruction.objectId} is already attached.`)
    }
    if (object.transformOwner === 'attachment' || object.transformOwner.startsWith('opcua:')) {
      failure('SOURCE_OWNERSHIP_CONFLICT', `Object ${object.id} is owned by ${object.transformOwner}.`)
    }
    const objectGraspFrameIds = new Set(object.graspFrames.map((frame) => frame.frameId))
    if (ancestryReaches(robot.baseParentFrameId, objectGraspFrameIds, globalFrameParents(captured.project))) {
      failure(
        'ATTACHMENT_TARGET_NOT_FOUND',
        `Robot ${robot.id} Base ancestry depends on Object ${object.id}.`,
      )
    }

    const detachedOverride = captured.detachedOverridesByObjectId[instruction.objectId]
    let objectWorldPose: RigidTransformV5 | null
    if (detachedOverride === undefined) {
      objectWorldPose = options.readObjectWorldPose(object.id)
      assertRevision(captured)
      if (objectWorldPose === null) {
        failure('ATTACHMENT_FRAME_UNAVAILABLE', `Object ${object.id} World pose is unavailable.`)
      }
    } else {
      const parentWorldPose = options.readSceneFrameWorldPose(detachedOverride.parentFrameId)
      assertRevision(captured)
      objectWorldPose = parentWorldPose === null
        ? detachedOverride.objectWorldPoseAtDetach
        : composeRigidTransformV5(parentWorldPose, detachedOverride.localPose)
    }
    const toolWorldPose = options.readRobotFrameWorldPose(robot.id, instruction.toolFrameId)
    assertRevision(captured)
    if (toolWorldPose === null) {
      failure('ATTACHMENT_FRAME_UNAVAILABLE', `Tool Frame ${instruction.toolFrameId} World pose is unavailable.`)
    }
    const transition = prepareAttachTransitionV1(instruction, {
      robotId: robot.id,
      objectTransformOwner: object.transformOwner,
      existingAttachment: null,
      objectWorldPose,
      toolWorldPose,
      objectGraspLocalPose: grasp?.localPose ?? null,
      simulationMs: context.simulationMs,
    })
    assertRevision(captured)
    let commitFailure: unknown
    try {
      options.attachments.getState().commitAttach(transition.record)
    } catch (error) {
      commitFailure = error
    }
    const committedAttachment = options.attachments.getState().attachmentsByObjectId[instruction.objectId]
    const committedExactly = !(
      committedAttachment === undefined
      || committedAttachment.objectId !== transition.record.objectId
      || committedAttachment.robotId !== transition.record.robotId
      || committedAttachment.toolFrameId !== transition.record.toolFrameId
      || committedAttachment.objectGraspFrameId !== transition.record.objectGraspFrameId
      || committedAttachment.attachedAtSimulationMs !== transition.record.attachedAtSimulationMs
      || !canonicalPosesMatch(committedAttachment.toolFromObject, transition.record.toolFromObject)
      || !canonicalPosesMatch(committedAttachment.toolWorldPoseAtAttach, transition.record.toolWorldPoseAtAttach)
      || !canonicalPosesMatch(committedAttachment.objectWorldPoseAtAttach, transition.record.objectWorldPoseAtAttach)
      || Object.hasOwn(options.attachments.getState().detachedOverridesByObjectId, instruction.objectId)
    )
    if (!committedExactly) {
      if (commitFailure !== undefined) throw commitFailure
      failure('SOURCE_OWNERSHIP_CONFLICT', 'The prepared Attachment was not committed atomically.')
    }
  }

  const detach = async (
    instruction: DetachInstructionV1,
    context: JobInstructionContextV1,
  ): Promise<void> => {
    const captured = capture()
    const entities = exactMap(captured.project.spatialEntities)
    const robots = exactMap(captured.project.robots)
    const definitions = exactMap(captured.project.robotDefinitions)
    const object = entities.get(instruction.objectId)
    const contextRobot = robots.get(context.robotId)
    if (object === undefined || contextRobot === undefined) {
      failure('ATTACHMENT_TARGET_NOT_FOUND', 'The exact Detach Robot or Object target does not exist.')
    }
    const expectedAttachment = options.attachments.getState().attachmentsByObjectId[instruction.objectId]
    if (expectedAttachment === undefined) {
      failure('NOT_ATTACHED', `Object ${instruction.objectId} is not attached.`)
    }
    if (expectedAttachment.robotId !== context.robotId) {
      failure('SOURCE_OWNERSHIP_CONFLICT', `Object ${instruction.objectId} is attached by another Robot.`)
    }
    const storedRobot = robots.get(expectedAttachment.robotId)
    const definition = storedRobot === undefined ? undefined : definitions.get(storedRobot.definitionId)
    if (
      storedRobot === undefined
      || definition === undefined
      || !exactMap(definition.frames).has(expectedAttachment.toolFrameId)
    ) {
      failure('ATTACHMENT_TARGET_NOT_FOUND', 'The stored Attachment Robot or Tool Frame no longer exists.')
    }

    const targetParentFrameId = instruction.targetParentFrameId ?? object.parentFrameId
    const parents = globalFrameParents(captured.project)
    if (!parents.has(targetParentFrameId)) {
      failure('ATTACHMENT_TARGET_NOT_FOUND', `Detach parent Frame ${targetParentFrameId} does not exist.`)
    }
    const objectGraspFrameIds = new Set(object.graspFrames.map((frame) => frame.frameId))
    if (ancestryReaches(targetParentFrameId, objectGraspFrameIds, parents)) {
      failure(
        'ATTACHMENT_TARGET_NOT_FOUND',
        `Detach parent Frame ${targetParentFrameId} depends on Object ${object.id}.`,
      )
    }

    const currentToolWorldPose = options.readRobotFrameWorldPose(
      expectedAttachment.robotId,
      expectedAttachment.toolFrameId,
    )
    assertRevision(captured)
    if (currentToolWorldPose === null) {
      failure('ATTACHMENT_FRAME_UNAVAILABLE', `Stored Tool Frame ${expectedAttachment.toolFrameId} is unavailable.`)
    }
    const targetParentWorldPose = options.readSceneFrameWorldPose(targetParentFrameId)
    assertRevision(captured)
    if (targetParentWorldPose === null) {
      failure('ATTACHMENT_FRAME_UNAVAILABLE', `Detach parent Frame ${targetParentFrameId} is unavailable.`)
    }
    const transition = prepareDetachTransitionV1(instruction, {
      robotId: context.robotId,
      attachment: expectedAttachment,
      currentToolWorldPose,
      targetParentFrameId,
      targetParentWorldPose,
      simulationMs: context.simulationMs,
    })
    assertRevision(captured)
    let commitFailure: unknown
    try {
      options.attachments.getState().commitDetach(transition.override, expectedAttachment)
    } catch (error) {
      commitFailure = error
    }
    const committed = options.attachments.getState()
    const committedOverride = committed.detachedOverridesByObjectId[instruction.objectId]
    const committedExactly = !(
      committedOverride === undefined
      || Object.hasOwn(committed.attachmentsByObjectId, instruction.objectId)
      || committedOverride.objectId !== transition.override.objectId
      || committedOverride.parentFrameId !== transition.override.parentFrameId
      || committedOverride.detachedAtSimulationMs !== transition.override.detachedAtSimulationMs
      || !canonicalPosesMatch(committedOverride.localPose, transition.override.localPose)
      || !canonicalPosesMatch(committedOverride.objectWorldPoseAtDetach, transition.override.objectWorldPoseAtDetach)
    )
    if (!committedExactly) {
      if (commitFailure !== undefined) throw commitFailure
      failure('SOURCE_OWNERSHIP_CONFLICT', 'The prepared Detach was not committed atomically.')
    }
  }

  return Object.freeze({ attach, detach })
}
