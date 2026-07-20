import {
  createAttachmentInstructionErrorV1,
} from '../../../core/action-runtime-v5/attachment-instruction-error.js'
import type {
  AttachmentRuntimeRecordV1,
  DetachedPoseOverrideV1,
} from '../../../core/action-runtime-v5/attachment-transition.js'
import {
  normalizeRigidTransformV5,
  validateWorkcellProjectV5,
  type RigidTransformV5,
  type RobotDefinitionV5,
  type RobotInstanceV5,
  type SpatialEntityV5,
  type WorkcellProjectV5,
} from '../../../core/project-v5/index.js'
import { deepFreezeV5 } from '../../../core/project-v5/validation-support.js'
import type { StoreApi } from 'zustand/vanilla'

export interface AttachmentRuntimeStoreV1 {
  readonly projectRevisionId: string | null
  readonly configRevision: string | null
  readonly attachmentsByObjectId: Readonly<Record<string, AttachmentRuntimeRecordV1>>
  readonly detachedOverridesByObjectId: Readonly<Record<string, DetachedPoseOverrideV1>>
  replaceProject(project: WorkcellProjectV5, configRevision: string): void
  reset(project: WorkcellProjectV5, configRevision: string): void
  commitAttach(record: AttachmentRuntimeRecordV1): void
  commitDetach(override: DetachedPoseOverrideV1, expectedAttachment: AttachmentRuntimeRecordV1): void
}

interface AttachmentRuntimeContextV1 {
  readonly project: WorkcellProjectV5
  readonly configRevision: string
  readonly entitiesById: ReadonlyMap<string, SpatialEntityV5>
  readonly robotsById: ReadonlyMap<string, RobotInstanceV5>
  readonly definitionsById: ReadonlyMap<string, RobotDefinitionV5>
  readonly globalFrameIds: ReadonlySet<string>
}

type RuntimeMap<T> = Readonly<Record<string, T>>
type RuntimeListener = (
  state: AttachmentRuntimeStoreV1,
  previousState: AttachmentRuntimeStoreV1,
) => void

const CONFIG_REVISION_PATTERN = /^[0-9a-f]{64}$/u

function requireConfigRevision(value: string): string {
  if (!CONFIG_REVISION_PATTERN.test(value)) {
    throw new TypeError('Config revision must be a lowercase 64-character hexadecimal digest.')
  }
  return value
}

function compileContext(
  projectInput: WorkcellProjectV5,
  configRevisionInput: string,
): AttachmentRuntimeContextV1 {
  const configRevision = requireConfigRevision(configRevisionInput)
  const project = validateWorkcellProjectV5(projectInput)
  const globalFrameIds = new Set(project.scene.frames.map((frame) => frame.id))
  for (const entity of project.spatialEntities) {
    for (const frame of entity.graspFrames) globalFrameIds.add(frame.frameId)
    for (const frame of entity.movingFrames) globalFrameIds.add(frame.frameId)
  }
  return Object.freeze({
    project,
    configRevision,
    entitiesById: new Map(project.spatialEntities.map((entity) => [entity.id, entity])),
    robotsById: new Map(project.robots.map((robot) => [robot.id, robot])),
    definitionsById: new Map(project.robotDefinitions.map((definition) => [definition.id, definition])),
    globalFrameIds,
  })
}

function emptyRuntimeMap<T>(): RuntimeMap<T> {
  return Object.freeze(Object.create(null) as Record<string, T>)
}

function copyRuntimeMap<T>(source: RuntimeMap<T>): Record<string, T> {
  const result = Object.create(null) as Record<string, T>
  for (const key of Object.keys(source)) result[key] = source[key]!
  return result
}

function runtimeMapWith<T>(source: RuntimeMap<T>, key: string, value: T): RuntimeMap<T> {
  const result = copyRuntimeMap(source)
  result[key] = value
  return Object.freeze(result)
}

function runtimeMapWithout<T>(source: RuntimeMap<T>, key: string): RuntimeMap<T> {
  if (!Object.hasOwn(source, key)) return source
  const result = copyRuntimeMap(source)
  delete result[key]
  return Object.freeze(result)
}

function runtimeId(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new TypeError(`${label} must be a non-empty persisted ID.`)
  }
  return value
}

function simulationTimestamp(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new TypeError(`${label} must be finite and nonnegative.`)
  }
  return value === 0 ? 0 : value
}

function frozenPose(value: RigidTransformV5, path: string): RigidTransformV5 {
  return deepFreezeV5(normalizeRigidTransformV5(value, path))
}

function canonicalAttachment(record: AttachmentRuntimeRecordV1): AttachmentRuntimeRecordV1 {
  const objectGraspFrameId = record.objectGraspFrameId === null
    ? null
    : runtimeId(record.objectGraspFrameId, 'Object Grasp Frame ID')
  return deepFreezeV5({
    objectId: runtimeId(record.objectId, 'Object ID'),
    robotId: runtimeId(record.robotId, 'Robot ID'),
    toolFrameId: runtimeId(record.toolFrameId, 'Tool Frame ID'),
    objectGraspFrameId,
    toolFromObject: frozenPose(record.toolFromObject, '$.attachment.toolFromObject'),
    toolWorldPoseAtAttach: frozenPose(record.toolWorldPoseAtAttach, '$.attachment.toolWorldPoseAtAttach'),
    objectWorldPoseAtAttach: frozenPose(record.objectWorldPoseAtAttach, '$.attachment.objectWorldPoseAtAttach'),
    attachedAtSimulationMs: simulationTimestamp(record.attachedAtSimulationMs, 'Attach timestamp'),
  })
}

function canonicalDetachedOverride(override: DetachedPoseOverrideV1): DetachedPoseOverrideV1 {
  return deepFreezeV5({
    objectId: runtimeId(override.objectId, 'Object ID'),
    parentFrameId: runtimeId(override.parentFrameId, 'Detach parent Frame ID'),
    localPose: frozenPose(override.localPose, '$.detachedOverride.localPose'),
    objectWorldPoseAtDetach: frozenPose(
      override.objectWorldPoseAtDetach,
      '$.detachedOverride.objectWorldPoseAtDetach',
    ),
    detachedAtSimulationMs: simulationTimestamp(override.detachedAtSimulationMs, 'Detach timestamp'),
  })
}

function targetNotFound(message: string): never {
  throw createAttachmentInstructionErrorV1('ATTACHMENT_TARGET_NOT_FOUND', message)
}

function requireAttachTarget(
  context: AttachmentRuntimeContextV1 | null,
  record: AttachmentRuntimeRecordV1,
): void {
  if (context === null) targetNotFound('No Project is loaded for the Attachment runtime.')
  const entity = context.entitiesById.get(record.objectId)
  if (entity === undefined) targetNotFound(`Object ${record.objectId} is not defined in the active Project.`)
  const robot = context.robotsById.get(record.robotId)
  if (robot === undefined) targetNotFound(`Robot ${record.robotId} is not defined in the active Project.`)
  const definition = context.definitionsById.get(robot.definitionId)
  if (definition === undefined) targetNotFound(`Robot Definition ${robot.definitionId} is not defined in the active Project.`)
  if (!definition.frames.some((frame) => frame.id === record.toolFrameId)) {
    targetNotFound(`Tool Frame ${record.toolFrameId} is not defined for Robot ${record.robotId}.`)
  }
  if (
    record.objectGraspFrameId !== null
    && !entity.graspFrames.some((frame) => frame.frameId === record.objectGraspFrameId)
  ) {
    targetNotFound(`Grasp Frame ${record.objectGraspFrameId} is not defined for Object ${record.objectId}.`)
  }
}

function requireDetachTarget(
  context: AttachmentRuntimeContextV1 | null,
  override: DetachedPoseOverrideV1,
  expectedAttachment: AttachmentRuntimeRecordV1,
): void {
  if (override.objectId !== expectedAttachment.objectId) {
    targetNotFound('The Detach override does not target the prepared Attachment Object.')
  }
  if (context === null || !context.entitiesById.has(override.objectId)) {
    targetNotFound(`Object ${override.objectId} is not defined in the active Project.`)
  }
  if (!context.globalFrameIds.has(override.parentFrameId)) {
    targetNotFound(`Detach parent Frame ${override.parentFrameId} is not defined in the active Project.`)
  }
}

function stateWithActions(
  context: AttachmentRuntimeContextV1 | null,
  attachmentsByObjectId: RuntimeMap<AttachmentRuntimeRecordV1>,
  detachedOverridesByObjectId: RuntimeMap<DetachedPoseOverrideV1>,
  actions: Pick<
    AttachmentRuntimeStoreV1,
    'replaceProject' | 'reset' | 'commitAttach' | 'commitDetach'
  >,
): AttachmentRuntimeStoreV1 {
  return Object.freeze({
    projectRevisionId: context?.project.revisionId ?? null,
    configRevision: context?.configRevision ?? null,
    attachmentsByObjectId,
    detachedOverridesByObjectId,
    ...actions,
  })
}

export function createAttachmentRuntimeStoreV1(): StoreApi<AttachmentRuntimeStoreV1>
export function createAttachmentRuntimeStoreV1(
  project: WorkcellProjectV5,
  configRevision: string,
): StoreApi<AttachmentRuntimeStoreV1>
export function createAttachmentRuntimeStoreV1(
  projectInput?: WorkcellProjectV5,
  configRevisionInput?: string,
): StoreApi<AttachmentRuntimeStoreV1> {
  if ((projectInput === undefined) !== (configRevisionInput === undefined)) {
    throw new TypeError('Project and config revision must either both be supplied or both be omitted.')
  }

  let context = projectInput === undefined
    ? null
    : compileContext(projectInput, configRevisionInput!)
  let state: AttachmentRuntimeStoreV1
  let initialState: AttachmentRuntimeStoreV1
  let publishing = false
  const listeners = new Set<RuntimeListener>()

  const requireMutationBoundary = (): void => {
    if (publishing) throw new TypeError('Attachment runtime mutation cannot re-enter a subscriber notification.')
  }

  const publish = (nextState: AttachmentRuntimeStoreV1): void => {
    requireMutationBoundary()
    if (Object.is(nextState, state)) return
    const previousState = state
    state = nextState
    publishing = true
    try {
      const listenersAtPublication = Array.from(listeners)
      for (const listener of listenersAtPublication) {
        try {
          listener(nextState, previousState)
        } catch {
          // A runtime commit is durable before publication. Subscriber failures
          // are isolated so they cannot roll back the state or starve listeners.
        }
      }
    } finally {
      publishing = false
    }
  }

  const replaceProject = (nextProject: WorkcellProjectV5, nextConfigRevision: string): void => {
    requireMutationBoundary()
    const nextContext = compileContext(nextProject, nextConfigRevision)
    const nextState = stateWithActions(
      nextContext,
      emptyRuntimeMap(),
      emptyRuntimeMap(),
      actions,
    )
    context = nextContext
    publish(nextState)
  }

  const reset = (nextProject: WorkcellProjectV5, nextConfigRevision: string): void => {
    replaceProject(nextProject, nextConfigRevision)
  }

  const commitAttach = (recordInput: AttachmentRuntimeRecordV1): void => {
    requireMutationBoundary()
    const objectId = runtimeId(recordInput.objectId, 'Object ID')
    if (Object.hasOwn(state.attachmentsByObjectId, objectId)) {
      throw createAttachmentInstructionErrorV1(
        'ALREADY_ATTACHED',
        `Object ${objectId} already has an active Attachment.`,
      )
    }
    runtimeId(recordInput.robotId, 'Robot ID')
    runtimeId(recordInput.toolFrameId, 'Tool Frame ID')
    if (recordInput.objectGraspFrameId !== null) {
      runtimeId(recordInput.objectGraspFrameId, 'Object Grasp Frame ID')
    }
    requireAttachTarget(context, recordInput)
    const record = canonicalAttachment(recordInput)
    publish(stateWithActions(
      context,
      runtimeMapWith(state.attachmentsByObjectId, record.objectId, record),
      runtimeMapWithout(state.detachedOverridesByObjectId, record.objectId),
      actions,
    ))
  }

  const commitDetach = (
    overrideInput: DetachedPoseOverrideV1,
    expectedAttachment: AttachmentRuntimeRecordV1,
  ): void => {
    requireMutationBoundary()
    const objectId = runtimeId(overrideInput.objectId, 'Object ID')
    const current = Object.hasOwn(state.attachmentsByObjectId, objectId)
      ? state.attachmentsByObjectId[objectId]!
      : null
    if (current === null) {
      throw createAttachmentInstructionErrorV1(
        'NOT_ATTACHED',
        `Object ${objectId} has no active Attachment.`,
      )
    }
    if (current !== expectedAttachment) {
      throw createAttachmentInstructionErrorV1(
        'SOURCE_OWNERSHIP_CONFLICT',
        `Object ${objectId} Attachment changed before Detach commit.`,
      )
    }
    const override = canonicalDetachedOverride(overrideInput)
    requireDetachTarget(context, override, expectedAttachment)
    publish(stateWithActions(
      context,
      runtimeMapWithout(state.attachmentsByObjectId, override.objectId),
      runtimeMapWith(state.detachedOverridesByObjectId, override.objectId, override),
      actions,
    ))
  }

  const actions = {
    replaceProject,
    reset,
    commitAttach,
    commitDetach,
  } satisfies Pick<
    AttachmentRuntimeStoreV1,
    'replaceProject' | 'reset' | 'commitAttach' | 'commitDetach'
  >

  state = stateWithActions(
    context,
    emptyRuntimeMap(),
    emptyRuntimeMap(),
    actions,
  )
  initialState = state

  const setStateImplementation = (): never => {
    requireMutationBoundary()
    throw new TypeError('Use Attachment runtime actions instead of direct setState mutation.')
  }

  return {
    setState: setStateImplementation as StoreApi<AttachmentRuntimeStoreV1>['setState'],
    getState: () => state,
    getInitialState: () => initialState,
    subscribe: (listener) => {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
  }
}
