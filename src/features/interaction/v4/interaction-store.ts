import {
  failProjectV4,
  normalizeRigidTransformV4,
  validateWorkcellProjectV4,
  type FrameIdV4,
  type RevisionIdV4,
  type RigidTransformV4,
  type RobotIdV4,
  type RobotJobIdV4,
  type SceneGroupIdV4,
  type SpatialEntityIdV4,
  type WorkcellProjectV4,
} from '../../../core/project-v4/index.js'
import { createStore, type StoreApi } from 'zustand/vanilla'
import type {
  PersistedVisibilityTargetV4,
  SceneIsolationTargetV4,
  SceneSelectionTargetV4,
  SceneSelectionV4,
} from './scene-selection.js'

export interface InteractionCheckpointV4 {
  readonly kind: 'interaction-checkpoint-v4'
}

export interface InteractionStoreStateV4 {
  readonly projectRevisionId: RevisionIdV4 | null
  readonly selection: SceneSelectionV4
  readonly activeRobotId: RobotIdV4 | null
  readonly isolation: SceneIsolationTargetV4 | null
  readonly transformClipboard: RigidTransformV4 | null
  readonly selectedJobIdsByRobotId: ReadonlyMap<RobotIdV4, RobotJobIdV4 | null>

  replaceProject(project: WorkcellProjectV4): void
  select(selection: SceneSelectionV4): void
  clearSelection(): void
  clearSelectionForHidden(target: PersistedVisibilityTargetV4): void
  isolate(target: SceneIsolationTargetV4): void
  showAll(): void
  copyTransform(pose: RigidTransformV4): void
  clearTransformClipboard(): void
  activateRobot(robotId: RobotIdV4): void
  selectJob(robotId: RobotIdV4, jobId: RobotJobIdV4 | null): void
  captureCheckpoint(): InteractionCheckpointV4
  restoreCheckpoint(checkpoint: InteractionCheckpointV4): void
}

type EntityFrameKindV4 = 'grasp' | 'moving'

interface RobotSelectionFactsV4 {
  readonly linkIds: ReadonlySet<string>
  readonly frameIds: ReadonlySet<FrameIdV4>
}

interface InteractionProjectContextV4 {
  readonly robotFactsById: ReadonlyMap<RobotIdV4, RobotSelectionFactsV4>
  readonly robotIdsInProjectOrder: readonly RobotIdV4[]
  readonly spatialEntityIds: ReadonlySet<SpatialEntityIdV4>
  readonly sceneFrameIds: ReadonlySet<FrameIdV4>
  readonly sceneGroupIds: ReadonlySet<SceneGroupIdV4>
  readonly hiddenGroupIdsByGroupId: ReadonlyMap<SceneGroupIdV4, ReadonlySet<SceneGroupIdV4>>
  readonly groupIdByEntityId: ReadonlyMap<SpatialEntityIdV4, SceneGroupIdV4 | null>
  readonly entityFrameKindsByEntityId: ReadonlyMap<
    SpatialEntityIdV4,
    ReadonlyMap<FrameIdV4, EntityFrameKindV4>
  >
  readonly jobOwnerById: ReadonlyMap<RobotJobIdV4, RobotIdV4>
  readonly jobIdsByRobotId: ReadonlyMap<RobotIdV4, readonly RobotJobIdV4[]>
}

export function activeJobIdV4(
  state: Pick<
    InteractionStoreStateV4,
    'activeRobotId' | 'selectedJobIdsByRobotId'
  >,
): RobotJobIdV4 | null {
  return state.activeRobotId === null
    ? null
    : state.selectedJobIdsByRobotId.get(state.activeRobotId) ?? null
}

interface CapturedInteractionV4 {
  readonly state: InteractionStoreStateV4
  readonly context: InteractionProjectContextV4 | null
}

function interactionFailure(code: string, path: string, message: string): never {
  failProjectV4(
    code,
    path,
    message,
    'Refresh the published Project identities and try the interaction again.',
  )
}

function readonlyMapV4<K, V>(entries: Iterable<readonly [K, V]>): ReadonlyMap<K, V> {
  const backing = new Map<K, V>(entries)
  let facade: ReadonlyMap<K, V>
  facade = Object.freeze({
    get size(): number {
      return backing.size
    },
    has: (key: K): boolean => backing.has(key),
    get: (key: K): V | undefined => backing.get(key),
    entries: (): MapIterator<[K, V]> => backing.entries(),
    keys: (): MapIterator<K> => backing.keys(),
    values: (): MapIterator<V> => backing.values(),
    forEach: (
      callbackfn: (value: V, key: K, map: ReadonlyMap<K, V>) => void,
      thisArg?: unknown,
    ): void => {
      backing.forEach((value, key) => callbackfn.call(thisArg, value, key, facade))
    },
    [Symbol.iterator]: (): MapIterator<[K, V]> => backing[Symbol.iterator](),
  })
  return facade
}

const EMPTY_JOB_SELECTIONS_V4 = readonlyMapV4<RobotIdV4, RobotJobIdV4 | null>([])

function buildInteractionContextV4(
  project: WorkcellProjectV4,
): InteractionProjectContextV4 {
  const definitionsById = new Map(
    project.robotDefinitions.map((definition) => [definition.id, definition]),
  )
  const robotFactsById = new Map<RobotIdV4, RobotSelectionFactsV4>()
  for (const robot of project.robots) {
    const definition = definitionsById.get(robot.definitionId)!
    robotFactsById.set(robot.id, {
      linkIds: new Set(definition.links.map(({ id }) => id)),
      frameIds: new Set(definition.frames.map(({ id }) => id)),
    })
  }

  const sceneGroupIds = new Set(project.sceneGroups.map(({ id }) => id))
  const groupParentById = new Map(
    project.sceneGroups.map(({ id, parentGroupId }) => [id, parentGroupId]),
  )
  const hiddenGroupIdsByGroupId = new Map<SceneGroupIdV4, ReadonlySet<SceneGroupIdV4>>()
  for (const group of project.sceneGroups) {
    const hiddenIds = new Set<SceneGroupIdV4>()
    for (const candidate of project.sceneGroups) {
      let current: SceneGroupIdV4 | null = candidate.id
      while (current !== null) {
        if (current === group.id) {
          hiddenIds.add(candidate.id)
          break
        }
        current = groupParentById.get(current) ?? null
      }
    }
    hiddenGroupIdsByGroupId.set(group.id, hiddenIds)
  }

  const groupIdByEntityId = new Map<SpatialEntityIdV4, SceneGroupIdV4 | null>()
  const entityFrameKindsByEntityId = new Map<
    SpatialEntityIdV4,
    ReadonlyMap<FrameIdV4, EntityFrameKindV4>
  >()
  for (const entity of project.spatialEntities) {
    groupIdByEntityId.set(entity.id, entity.groupId)
    entityFrameKindsByEntityId.set(entity.id, new Map([
      ...entity.graspFrames.map(({ frameId }) => [frameId, 'grasp'] as const),
      ...entity.movingFrames.map(({ frameId }) => [frameId, 'moving'] as const),
    ]))
  }

  const jobOwnerById = new Map<RobotJobIdV4, RobotIdV4>()
  const mutableJobIdsByRobotId = new Map<RobotIdV4, RobotJobIdV4[]>(
    project.robots.map(({ id }) => [id, []]),
  )
  for (const projectJob of project.jobs) {
    jobOwnerById.set(projectJob.id, projectJob.robotId)
    mutableJobIdsByRobotId.get(projectJob.robotId)!.push(projectJob.id)
  }

  return {
    robotFactsById,
    robotIdsInProjectOrder: Object.freeze(project.robots.map(({ id }) => id)),
    spatialEntityIds: new Set(project.spatialEntities.map(({ id }) => id)),
    sceneFrameIds: new Set(project.scene.frames.map(({ id }) => id)),
    sceneGroupIds,
    hiddenGroupIdsByGroupId,
    groupIdByEntityId,
    entityFrameKindsByEntityId,
    jobOwnerById,
    jobIdsByRobotId: new Map([...mutableJobIdsByRobotId].map(
      ([robotId, ids]) => [robotId, Object.freeze([...ids])] as const,
    )),
  }
}

function activeRobotIdForSelectionV4(selection: SceneSelectionV4): RobotIdV4 | null {
  switch (selection?.kind) {
    case 'robot':
    case 'robot-link':
    case 'robot-frame':
      return selection.robotId
    default:
      return null
  }
}

function nextActiveRobotIdV4(
  currentActiveRobotId: RobotIdV4 | null,
  priorContext: InteractionProjectContextV4 | null,
  candidateContext: InteractionProjectContextV4,
  firstRobotId: RobotIdV4 | null,
): RobotIdV4 | null {
  if (currentActiveRobotId !== null && candidateContext.robotFactsById.has(currentActiveRobotId)) {
    return currentActiveRobotId
  }
  if (currentActiveRobotId !== null && priorContext !== null) {
    const activeIndex = priorContext.robotIdsInProjectOrder.indexOf(currentActiveRobotId)
    for (const robotId of priorContext.robotIdsInProjectOrder.slice(activeIndex + 1)) {
      if (candidateContext.robotFactsById.has(robotId)) return robotId
    }
  }
  return firstRobotId
}

function selectionExistsV4(
  context: InteractionProjectContextV4,
  selection: SceneSelectionTargetV4,
): boolean {
  switch (selection.kind) {
    case 'robot':
      return context.robotFactsById.has(selection.robotId)
    case 'robot-link':
      return context.robotFactsById.get(selection.robotId)?.linkIds.has(selection.linkId) === true
    case 'spatial-entity':
      return context.spatialEntityIds.has(selection.entityId)
    case 'scene-group':
      return context.sceneGroupIds.has(selection.groupId)
    case 'scene-frame':
      return context.sceneFrameIds.has(selection.frameId)
    case 'robot-frame':
      return context.robotFactsById.get(selection.robotId)?.frameIds.has(selection.frameId) === true
    case 'entity-frame':
      return context.entityFrameKindsByEntityId.get(selection.entityId)?.has(selection.frameId) === true
    default:
      return false
  }
}

function requireSelectionV4(
  context: InteractionProjectContextV4 | null,
  selection: SceneSelectionTargetV4,
): void {
  if (context === null || !selectionExistsV4(context, selection)) {
    interactionFailure(
      'SCENE_SELECTION_TARGET_INVALID',
      '$.selection',
      'Scene selection does not exist in the published Project or has the wrong owner.',
    )
  }
}

function frozenSelectionV4<T extends SceneSelectionTargetV4>(selection: T): T {
  switch (selection.kind) {
    case 'robot':
      return Object.freeze({ kind: 'robot', robotId: selection.robotId }) as T
    case 'robot-link':
      return Object.freeze({
        kind: 'robot-link',
        robotId: selection.robotId,
        linkId: selection.linkId,
      }) as T
    case 'spatial-entity':
      return Object.freeze({
        kind: 'spatial-entity',
        entityId: selection.entityId,
      }) as T
    case 'scene-group':
      return Object.freeze({ kind: 'scene-group', groupId: selection.groupId }) as T
    case 'scene-frame':
      return Object.freeze({ kind: 'scene-frame', frameId: selection.frameId }) as T
    case 'robot-frame':
      return Object.freeze({
        kind: 'robot-frame',
        robotId: selection.robotId,
        frameId: selection.frameId,
      }) as T
    case 'entity-frame':
      return Object.freeze({
        kind: 'entity-frame',
        entityId: selection.entityId,
        frameId: selection.frameId,
      }) as T
  }
}

function frozenTransformV4(pose: RigidTransformV4): RigidTransformV4 {
  const normalized = normalizeRigidTransformV4(pose, '$.transformClipboard')
  if (!normalized.positionM.every(Number.isFinite)) {
    interactionFailure(
      'TRANSFORM_CLIPBOARD_INVALID',
      '$.transformClipboard.positionM',
      'Copied transform position must contain only finite values.',
    )
  }
  return Object.freeze({
    positionM: Object.freeze([...normalized.positionM] as [number, number, number]),
    quaternion: Object.freeze([...normalized.quaternion] as [number, number, number, number]),
  })
}

function isSelectionHiddenByTargetV4(
  context: InteractionProjectContextV4,
  selection: SceneSelectionTargetV4,
  target: PersistedVisibilityTargetV4,
): boolean {
  if (target.kind === 'robot') {
    return (
      selection.kind === 'robot'
      || selection.kind === 'robot-link'
      || selection.kind === 'robot-frame'
    ) && selection.robotId === target.robotId
  }

  if (target.kind === 'spatial-entity') {
    if (selection.kind === 'spatial-entity') return selection.entityId === target.entityId
    return selection.kind === 'entity-frame'
      && selection.entityId === target.entityId
      && context.entityFrameKindsByEntityId.get(selection.entityId)?.get(selection.frameId) === 'grasp'
  }

  const hiddenGroupIds = context.hiddenGroupIdsByGroupId.get(target.groupId)!
  if (selection.kind === 'scene-group') return hiddenGroupIds.has(selection.groupId)
  if (selection.kind !== 'spatial-entity' && selection.kind !== 'entity-frame') return false

  const entityGroupId = context.groupIdByEntityId.get(selection.entityId)
  if (entityGroupId === null || entityGroupId === undefined || !hiddenGroupIds.has(entityGroupId)) {
    return false
  }
  return selection.kind === 'spatial-entity'
    || context.entityFrameKindsByEntityId.get(selection.entityId)?.get(selection.frameId) === 'grasp'
}

function checkpointFailureV4(): never {
  interactionFailure(
    'INTERACTION_CHECKPOINT_INVALID',
    '$.checkpoint',
    'Interaction checkpoint is not owned by this store.',
  )
}

export function createInteractionStoreV4(): StoreApi<InteractionStoreStateV4> {
  let context: InteractionProjectContextV4 | null = null
  const checkpoints = new WeakMap<object, CapturedInteractionV4>()

  return createStore<InteractionStoreStateV4>()((set, get) => ({
    projectRevisionId: null,
    selection: null,
    activeRobotId: null,
    isolation: null,
    transformClipboard: null,
    selectedJobIdsByRobotId: EMPTY_JOB_SELECTIONS_V4,
    replaceProject: (project) => {
      const validated = validateWorkcellProjectV4(project)
      const candidateContext = buildInteractionContextV4(validated)
      const current = get()
      const priorContext = context
      const firstPublication = context === null
      const firstRobotId = validated.robots[0]?.id ?? null
      const selection = firstPublication
        ? firstRobotId === null
          ? null
          : frozenSelectionV4({ kind: 'robot', robotId: firstRobotId })
        : current.selection === null || selectionExistsV4(candidateContext, current.selection)
          ? current.selection
          : firstRobotId === null
            ? null
            : frozenSelectionV4({ kind: 'robot', robotId: firstRobotId })
      const activeRobotId = nextActiveRobotIdV4(
        current.activeRobotId,
        priorContext,
        candidateContext,
        firstRobotId,
      )

      const jobSelections: Array<readonly [RobotIdV4, RobotJobIdV4 | null]> = []
      for (const robot of validated.robots) {
        const jobs = candidateContext.jobIdsByRobotId.get(robot.id) ?? []
        const previousChoice = current.selectedJobIdsByRobotId.get(robot.id) ?? null
        const selectedJobId = firstPublication
          ? jobs[0] ?? null
          : previousChoice !== null
            && candidateContext.jobOwnerById.get(previousChoice) === robot.id
            ? previousChoice
            : null
        jobSelections.push([robot.id, selectedJobId])
      }

      const candidateState: InteractionStoreStateV4 = {
        ...current,
        projectRevisionId: validated.revisionId,
        selection,
        activeRobotId,
        isolation: null,
        transformClipboard: null,
        selectedJobIdsByRobotId: readonlyMapV4(jobSelections),
      }
      context = candidateContext
      set(candidateState, true)
    },
    select: (selection) => {
      if (selection !== null) requireSelectionV4(context, selection)
      set((state) => ({
        ...state,
        selection: selection === null ? null : frozenSelectionV4(selection),
        activeRobotId: activeRobotIdForSelectionV4(selection) ?? state.activeRobotId,
      }), true)
    },
    clearSelection: () => {
      set((state) => ({ ...state, selection: null }), true)
    },
    clearSelectionForHidden: (target) => {
      requireSelectionV4(context, target)
      const current = get()
      if (
        context !== null
        && current.selection !== null
        && isSelectionHiddenByTargetV4(context, current.selection, target)
      ) {
        set({ ...current, selection: null }, true)
      }
    },
    isolate: (target) => {
      requireSelectionV4(context, target)
      set((state) => ({ ...state, isolation: frozenSelectionV4(target) }), true)
    },
    showAll: () => {
      set((state) => ({ ...state, isolation: null }), true)
    },
    copyTransform: (pose) => {
      const transformClipboard = frozenTransformV4(pose)
      set((state) => ({ ...state, transformClipboard }), true)
    },
    clearTransformClipboard: () => {
      set((state) => ({ ...state, transformClipboard: null }), true)
    },
    activateRobot: (robotId) => {
      if (context === null || !context.robotFactsById.has(robotId)) {
        interactionFailure(
          'ROBOT_ACTIVE_SELECTION_INVALID',
          '$.activeRobotId',
          `Robot ${robotId} does not exist in the published Project.`,
        )
      }
      set((state) => ({ ...state, activeRobotId: robotId }), true)
    },
    selectJob: (robotId, jobId) => {
      if (context === null || !context.robotFactsById.has(robotId)) {
        interactionFailure(
          'ROBOT_JOB_SELECTION_INVALID',
          `$.selectedJobIdsByRobotId.${robotId}`,
          `Robot ${robotId} does not exist in the published Project.`,
        )
      }
      if (jobId !== null && context.jobOwnerById.get(jobId) !== robotId) {
        interactionFailure(
          'ROBOT_JOB_SELECTION_INVALID',
          `$.selectedJobIdsByRobotId.${robotId}`,
          `Job ${jobId} does not belong to Robot ${robotId}.`,
        )
      }
      set((state) => ({
        ...state,
        activeRobotId: robotId,
        selectedJobIdsByRobotId: readonlyMapV4([...state.selectedJobIdsByRobotId].map(
          ([id, selectedJobId]) => [id, id === robotId ? jobId : selectedJobId] as const,
        )),
      }), true)
    },
    captureCheckpoint: () => {
      const checkpoint = Object.freeze({
        kind: 'interaction-checkpoint-v4' as const,
      })
      checkpoints.set(checkpoint, { state: get(), context })
      return checkpoint
    },
    restoreCheckpoint: (checkpoint) => {
      if (checkpoint === null || typeof checkpoint !== 'object') checkpointFailureV4()
      const captured = checkpoints.get(checkpoint)
      if (captured === undefined) checkpointFailureV4()
      context = captured.context
      set(captured.state, true)
    },
  }))
}
