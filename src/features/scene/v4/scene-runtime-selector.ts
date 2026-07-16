import {
  composeRigidTransformV4,
  computeSerialRobotPoseV4,
  failProjectV4,
  normalizeRigidTransformV4,
  resolveWorldFrameMapV4,
  type FrameDefinitionV4,
  type FrameGraphNodeV4,
  type FrameIdV4,
  type RevisionIdV4,
  type RigidTransformV4,
  type RobotDefinitionIdV4,
  type RobotDefinitionV4,
  type RobotIdV4,
  type RobotJointSourceV4,
  type RobotLinkIdV4,
  type SceneGroupIdV4,
  type SerialRobotPoseV4,
  type SpatialEntityIdV4,
  type SpatialEntityV4,
  type WorkcellProjectV4,
} from '../../../core/project-v4/index.js'
import type {
  RobotRuntimeRegistryV4,
  RobotRuntimeStateV4,
} from '../../robot/v4/robot-runtime-registry.js'

export type SceneRuntimeGlobalFrameParentV4 =
  | { readonly kind: 'global-frame'; readonly frameId: FrameIdV4 }
  | { readonly kind: 'spatial-entity-root'; readonly entityId: SpatialEntityIdV4 }
  | null

export interface SceneRuntimeGlobalFrameV4 {
  readonly frameId: FrameIdV4
  readonly frameKind: 'scene' | 'grasp' | 'moving'
  readonly ownerEntityId: SpatialEntityIdV4 | null
  readonly parent: SceneRuntimeGlobalFrameParentV4
  readonly localPose: RigidTransformV4
  readonly worldPose: RigidTransformV4
  readonly effectiveVisible: boolean
}

export interface SceneRuntimeRobotFrameV4 {
  readonly robotId: RobotIdV4
  readonly definitionId: RobotDefinitionIdV4
  readonly frameId: FrameIdV4
  readonly parentLocalId: FrameIdV4 | RobotLinkIdV4
  readonly localPose: RigidTransformV4
  readonly worldPose: RigidTransformV4
}

export interface SceneRuntimeGroupV4 {
  readonly groupId: SceneGroupIdV4
  readonly parentGroupId: SceneGroupIdV4 | null
  readonly persistedVisible: boolean
  readonly effectiveVisible: boolean
}

export interface SceneRuntimeRobotEntityV4 {
  readonly kind: 'robot'
  readonly entityId: RobotIdV4
  readonly definitionId: RobotDefinitionIdV4
  readonly worldBasePose: RigidTransformV4
  readonly effectiveVisible: boolean
  readonly jointSource: RobotJointSourceV4
  readonly numericStatus: number
  readonly selectedToolFrameId: FrameIdV4
  readonly selectedTcpFrameId: FrameIdV4
  readonly serialPose: SerialRobotPoseV4
}

export interface SceneRuntimeSpatialEntityV4 {
  readonly kind: 'spatial-entity'
  readonly entityId: SpatialEntityIdV4
  readonly groupId: SceneGroupIdV4 | null
  readonly parentFrameId: FrameIdV4
  readonly localPose: RigidTransformV4
  readonly worldPose: RigidTransformV4
  readonly persistedVisible: boolean
  readonly effectiveVisible: boolean
  readonly transformOwner: SpatialEntityV4['transformOwner']
  readonly numericStatus: number
}

export type SceneRuntimeEntityV4 =
  | SceneRuntimeRobotEntityV4
  | SceneRuntimeSpatialEntityV4

export interface SceneRuntimeProjectionV4 {
  readonly projectRevisionId: RevisionIdV4
  readonly globalFrames: ReadonlyMap<FrameIdV4, SceneRuntimeGlobalFrameV4>
  readonly robotFramesByRobotId: ReadonlyMap<
    RobotIdV4,
    ReadonlyMap<FrameIdV4, SceneRuntimeRobotFrameV4>
  >
  readonly groups: ReadonlyMap<SceneGroupIdV4, SceneRuntimeGroupV4>
  readonly entities: ReadonlyMap<string, SceneRuntimeEntityV4>
  readonly visibleRobotIds: readonly RobotIdV4[]
  readonly visibleSpatialEntityIds: readonly SpatialEntityIdV4[]
}

interface RegisteredGlobalFrameV4 {
  readonly internalKey: string
  readonly frameId: FrameIdV4
  readonly frameKind: SceneRuntimeGlobalFrameV4['frameKind']
  readonly ownerEntityId: SpatialEntityIdV4 | null
  readonly parent: SceneRuntimeGlobalFrameParentV4
  readonly localPose: RigidTransformV4
}

function sceneFailure(code: string, path: string, message: string): never {
  failProjectV4(code, path, message, 'Publish matching Project and Robot runtime snapshots and try again.')
}

function qualifiedSceneFrameKey(frameId: string): string {
  return `scene-frame:${encodeURIComponent(frameId)}`
}

function qualifiedEntityRootKey(entityId: string): string {
  return `runtime-entity-root:${encodeURIComponent(entityId)}`
}

function frozenPose(value: RigidTransformV4): RigidTransformV4 {
  const normalized = normalizeRigidTransformV4({
    positionM: [...value.positionM],
    quaternion: [...value.quaternion],
  }, '$.sceneRuntime.pose')
  return Object.freeze({
    positionM: Object.freeze([
      normalized.positionM[0],
      normalized.positionM[1],
      normalized.positionM[2],
    ] as const),
    quaternion: Object.freeze([
      normalized.quaternion[0],
      normalized.quaternion[1],
      normalized.quaternion[2],
      normalized.quaternion[3],
    ] as const),
  })
}

function frozenRecord<T>(entries: Iterable<readonly [string, T]>): Readonly<Record<string, T>> {
  return Object.freeze(Object.fromEntries(entries))
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

function ownEnumerableDataValue(
  record: object,
  key: string,
  path: string,
): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(record, key)
  if (descriptor === undefined || !descriptor.enumerable || !('value' in descriptor)) {
    sceneFailure(
      'SCENE_RUNTIME_ROBOT_SET_MISMATCH',
      path,
      `Robot runtime field ${key} must be an enumerable own data property.`,
    )
  }
  return descriptor.value
}

function ownEnumerableDataEntries(
  value: unknown,
  path: string,
): readonly (readonly [string, unknown])[] {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    sceneFailure(
      'SCENE_RUNTIME_ROBOT_SET_MISMATCH',
      path,
      'Robot runtime records must be objects.',
    )
  }
  return Reflect.ownKeys(value).map((key): readonly [string, unknown] => {
    if (typeof key !== 'string') {
      sceneFailure(
        'SCENE_RUNTIME_ROBOT_SET_MISMATCH',
        path,
        'Robot runtime records cannot contain Symbol keys.',
      )
    }
    return [key, ownEnumerableDataValue(value, key, `${path}.${key}`)]
  })
}

function inspectRuntimeRobots(
  project: WorkcellProjectV4,
  robotsCandidate: unknown,
): ReadonlyMap<RobotIdV4, RobotRuntimeStateV4> {
  const entries = ownEnumerableDataEntries(robotsCandidate, '$.robotRuntime.robots')
  const projectRobotIds = new Set(project.robots.map(({ id }) => id))
  if (
    projectRobotIds.size !== project.robots.length
    || entries.length !== project.robots.length
    || entries.some(([id]) => !projectRobotIds.has(id))
  ) {
    sceneFailure(
      'SCENE_RUNTIME_ROBOT_SET_MISMATCH',
      '$.robotRuntime.robots',
      'Robot runtime keys must exactly match the Project Robot IDs.',
    )
  }

  const runtimeByRobotId = new Map<RobotIdV4, RobotRuntimeStateV4>()
  for (const robot of project.robots) {
    const stateCandidate = ownEnumerableDataValue(
      robotsCandidate as object,
      robot.id,
      `$.robotRuntime.robots.${robot.id}`,
    )
    if (stateCandidate === null || typeof stateCandidate !== 'object' || Array.isArray(stateCandidate)) {
      sceneFailure(
        'SCENE_RUNTIME_ROBOT_SET_MISMATCH',
        `$.robotRuntime.robots.${robot.id}`,
        'Robot runtime state must be an object.',
      )
    }
    const runtimeRobotId = ownEnumerableDataValue(
      stateCandidate,
      'robotId',
      `$.robotRuntime.robots.${robot.id}.robotId`,
    )
    const runtimeDefinitionId = ownEnumerableDataValue(
      stateCandidate,
      'definitionId',
      `$.robotRuntime.robots.${robot.id}.definitionId`,
    )
    if (runtimeRobotId !== robot.id || runtimeDefinitionId !== robot.definitionId) {
      sceneFailure(
        'SCENE_RUNTIME_ROBOT_SET_MISMATCH',
        `$.robotRuntime.robots.${robot.id}`,
        'Robot runtime identity must match its Project Robot and Definition.',
      )
    }
    runtimeByRobotId.set(robot.id, stateCandidate as RobotRuntimeStateV4)
  }
  return runtimeByRobotId
}

function copiedJointValues(
  definition: RobotDefinitionV4,
  state: RobotRuntimeStateV4,
  robotId: RobotIdV4,
): Readonly<Record<string, number>> {
  const candidate = ownEnumerableDataValue(
    state,
    'jointValues',
    `$.robotRuntime.robots.${robotId}.jointValues`,
  )
  const entries = ownEnumerableDataEntries(
    candidate,
    `$.robotRuntime.robots.${robotId}.jointValues`,
  )
  const expectedIds = new Set(definition.joints.map(({ id }) => id))
  if (
    expectedIds.size !== definition.joints.length
    || entries.length !== definition.joints.length
    || entries.some(([id]) => !expectedIds.has(id))
  ) {
    sceneFailure(
      'ROBOT_JOINT_KEY_SET_MISMATCH',
      `$.robotRuntime.robots.${robotId}.jointValues`,
      'Joint value keys must exactly match the Robot Definition.',
    )
  }
  return frozenRecord(definition.joints.map((joint) => {
    const value = ownEnumerableDataValue(
      candidate as object,
      joint.id,
      `$.robotRuntime.robots.${robotId}.jointValues.${joint.id}`,
    )
    return [joint.id, value as number] as const
  }))
}

function frozenSerialPose(pose: SerialRobotPoseV4): SerialRobotPoseV4 {
  return Object.freeze({
    jointValues: frozenRecord(Object.entries(pose.jointValues)),
    linkLocalPoses: frozenRecord(Object.entries(pose.linkLocalPoses).map(
      ([id, value]) => [id, frozenPose(value)] as const,
    )),
    linkWorldPoses: frozenRecord(Object.entries(pose.linkWorldPoses).map(
      ([id, value]) => [id, frozenPose(value)] as const,
    )),
    frameWorldPoses: frozenRecord(Object.entries(pose.frameWorldPoses).map(
      ([id, value]) => [id, frozenPose(value)] as const,
    )),
  })
}

function buildGroups(
  project: WorkcellProjectV4,
): ReadonlyMap<SceneGroupIdV4, SceneRuntimeGroupV4> {
  const byId = new Map(project.sceneGroups.map((group) => [group.id, group]))
  if (byId.size !== project.sceneGroups.length) {
    sceneFailure('PROJECT_ID_DUPLICATE', '$.sceneGroups', 'Scene Group IDs must be unique.')
  }
  const visiting = new Set<string>()
  const effective = new Map<string, boolean>()
  const resolve = (groupId: string): boolean => {
    const known = effective.get(groupId)
    if (known !== undefined) return known
    if (visiting.has(groupId)) {
      sceneFailure('SCENE_GROUP_CYCLE', '$.sceneGroups', `Scene Group ${groupId} participates in a cycle.`)
    }
    const group = byId.get(groupId)
    if (group === undefined) {
      sceneFailure('SCENE_GROUP_NOT_FOUND', '$.sceneGroups', `Scene Group ${groupId} does not exist.`)
    }
    visiting.add(groupId)
    const parentVisible = group.parentGroupId === null ? true : resolve(group.parentGroupId)
    const result = group.visible && parentVisible
    visiting.delete(groupId)
    effective.set(groupId, result)
    return result
  }

  return readonlyMapV4(project.sceneGroups.map((group) => [group.id, Object.freeze({
    groupId: group.id,
    parentGroupId: group.parentGroupId,
    persistedVisible: group.visible,
    effectiveVisible: resolve(group.id),
  })] as const))
}

function registerGlobalFrames(
  project: WorkcellProjectV4,
): {
  readonly frames: readonly RegisteredGlobalFrameV4[]
  readonly internalKeyByFrameId: ReadonlyMap<FrameIdV4, string>
} {
  const frames: RegisteredGlobalFrameV4[] = []
  const internalKeyByFrameId = new Map<FrameIdV4, string>()
  const register = (
    frameId: FrameIdV4,
    frameKind: RegisteredGlobalFrameV4['frameKind'],
    ownerEntityId: SpatialEntityIdV4 | null,
    parent: SceneRuntimeGlobalFrameParentV4,
    localPose: RigidTransformV4,
  ): void => {
    if (internalKeyByFrameId.has(frameId)) {
      sceneFailure('PROJECT_ID_DUPLICATE', '$.frames', `Global Frame ${frameId} is duplicated.`)
    }
    const internalKey = qualifiedSceneFrameKey(frameId)
    internalKeyByFrameId.set(frameId, internalKey)
    frames.push({ internalKey, frameId, frameKind, ownerEntityId, parent, localPose })
  }

  for (const frame of project.scene.frames) {
    register(
      frame.id,
      'scene',
      null,
      frame.parentFrameId === null
        ? null
        : { kind: 'global-frame', frameId: frame.parentFrameId },
      frame.localPose,
    )
  }
  for (const entity of project.spatialEntities) {
    for (const frame of entity.graspFrames) {
      register(
        frame.frameId,
        'grasp',
        entity.id,
        { kind: 'spatial-entity-root', entityId: entity.id },
        frame.localPose,
      )
    }
    for (const frame of entity.movingFrames) {
      register(
        frame.frameId,
        'moving',
        entity.id,
        { kind: 'global-frame', frameId: frame.parentFrameId },
        frame.localPose,
      )
    }
  }
  return { frames, internalKeyByFrameId }
}

function buildGlobalFrameGraph(
  project: WorkcellProjectV4,
  registeredFrames: readonly RegisteredGlobalFrameV4[],
  internalKeyByFrameId: ReadonlyMap<FrameIdV4, string>,
): {
  readonly worldByInternalKey: ReadonlyMap<string, RigidTransformV4>
  readonly entityRootKeyByEntityId: ReadonlyMap<SpatialEntityIdV4, string>
} {
  const entityRootKeyByEntityId = new Map<SpatialEntityIdV4, string>()
  const nodes: FrameGraphNodeV4[] = registeredFrames.map((frame) => {
    let parentFrameId: string | null
    if (frame.parent === null) {
      parentFrameId = null
    } else if (frame.parent.kind === 'spatial-entity-root') {
      parentFrameId = qualifiedEntityRootKey(frame.parent.entityId)
    } else {
      parentFrameId = internalKeyByFrameId.get(frame.parent.frameId) ?? null
      if (parentFrameId === null) {
        sceneFailure(
          'FRAME_PARENT_NOT_FOUND',
          `$.frames.${frame.frameId}.parent`,
          `Global Frame parent ${frame.parent.frameId} does not exist.`,
        )
      }
    }
    return { frameId: frame.internalKey, parentFrameId, localPose: frame.localPose }
  })

  for (const entity of project.spatialEntities) {
    if (entityRootKeyByEntityId.has(entity.id)) {
      sceneFailure('PROJECT_ID_DUPLICATE', '$.spatialEntities', `Spatial Entity ${entity.id} is duplicated.`)
    }
    const parentInternalKey = internalKeyByFrameId.get(entity.parentFrameId)
    if (parentInternalKey === undefined) {
      sceneFailure(
        'FRAME_PARENT_NOT_FOUND',
        `$.spatialEntities.${entity.id}.parentFrameId`,
        `Spatial Entity parent Frame ${entity.parentFrameId} does not exist.`,
      )
    }
    const rootKey = qualifiedEntityRootKey(entity.id)
    entityRootKeyByEntityId.set(entity.id, rootKey)
    nodes.push({
      frameId: rootKey,
      parentFrameId: parentInternalKey,
      localPose: entity.localPose,
    })
  }
  return {
    worldByInternalKey: resolveWorldFrameMapV4(nodes),
    entityRootKeyByEntityId,
  }
}

function requireRuntimePrimitive<T extends string | number | boolean>(
  state: RobotRuntimeStateV4,
  key: string,
  robotId: string,
  expectedType: 'string' | 'number' | 'boolean',
): T {
  const value = ownEnumerableDataValue(
    state,
    key,
    `$.robotRuntime.robots.${robotId}.${key}`,
  )
  if (typeof value !== expectedType || (expectedType === 'number' && !Number.isFinite(value))) {
    sceneFailure(
      'SCENE_RUNTIME_ROBOT_STATE_INVALID',
      `$.robotRuntime.robots.${robotId}.${key}`,
      `Robot runtime ${key} must be a finite ${expectedType}.`,
    )
  }
  return value as T
}

function robotFrameProjection(
  robotId: RobotIdV4,
  definition: RobotDefinitionV4,
  serialPose: SerialRobotPoseV4,
): ReadonlyMap<FrameIdV4, SceneRuntimeRobotFrameV4> {
  return readonlyMapV4(definition.frames.map((frame: FrameDefinitionV4) => {
    if (frame.parentFrameId === null) {
      sceneFailure(
        'FRAME_PARENT_NOT_FOUND',
        `$.robotDefinitions.${definition.id}.frames.${frame.id}.parentFrameId`,
        'Robot Definition Frames require a local parent.',
      )
    }
    const worldPose = serialPose.frameWorldPoses[frame.id]
    if (worldPose === undefined) {
      sceneFailure(
        'ROBOT_FRAME_NOT_FOUND',
        `$.robotDefinitions.${definition.id}.frames.${frame.id}`,
        `Robot Frame ${frame.id} was not resolved.`,
      )
    }
    return [frame.id, Object.freeze({
      robotId,
      definitionId: definition.id,
      frameId: frame.id,
      parentLocalId: frame.parentFrameId,
      localPose: frozenPose(frame.localPose),
      worldPose: frozenPose(worldPose),
    })] as const
  }))
}

export function selectSceneRuntimeV4(
  project: WorkcellProjectV4,
  robotRuntime: Pick<RobotRuntimeRegistryV4, 'projectRevisionId' | 'robots'>,
): SceneRuntimeProjectionV4 {
  if (
    robotRuntime.projectRevisionId === null
    || robotRuntime.projectRevisionId !== project.revisionId
  ) {
    sceneFailure(
      'SCENE_RUNTIME_REVISION_MISMATCH',
      '$.robotRuntime.projectRevisionId',
      'Robot runtime and Project revisions must match before Scene projection.',
    )
  }

  const robotEntityIds = new Set(project.robots.map(({ id }) => id))
  for (const entity of project.spatialEntities) {
    if (robotEntityIds.has(entity.id)) {
      sceneFailure(
        'PROJECT_ID_DUPLICATE',
        '$.spatialEntities',
        `Entity ID ${entity.id} is shared by a Robot and Spatial Entity.`,
      )
    }
  }

  const runtimeByRobotId = inspectRuntimeRobots(project, robotRuntime.robots)
  const definitionsById = new Map(project.robotDefinitions.map((definition) => [definition.id, definition]))
  if (definitionsById.size !== project.robotDefinitions.length) {
    sceneFailure('PROJECT_ID_DUPLICATE', '$.robotDefinitions', 'Robot Definition IDs must be unique.')
  }
  const groups = buildGroups(project)
  const { frames: registeredFrames, internalKeyByFrameId } = registerGlobalFrames(project)
  const { worldByInternalKey, entityRootKeyByEntityId } = buildGlobalFrameGraph(
    project,
    registeredFrames,
    internalKeyByFrameId,
  )

  const effectiveEntityVisibility = new Map<SpatialEntityIdV4, boolean>()
  for (const entity of project.spatialEntities) {
    const groupVisible = entity.groupId === null
      ? true
      : groups.get(entity.groupId)?.effectiveVisible
    if (groupVisible === undefined) {
      sceneFailure(
        'SCENE_GROUP_NOT_FOUND',
        `$.spatialEntities.${entity.id}.groupId`,
        `Scene Group ${entity.groupId} does not exist.`,
      )
    }
    effectiveEntityVisibility.set(entity.id, entity.visible && groupVisible)
  }

  const globalFrames = readonlyMapV4(registeredFrames.map((frame) => {
    const worldPose = worldByInternalKey.get(frame.internalKey)
    if (worldPose === undefined) {
      sceneFailure('FRAME_PARENT_NOT_FOUND', `$.frames.${frame.frameId}`, 'Global Frame was not resolved.')
    }
    return [frame.frameId, Object.freeze({
      frameId: frame.frameId,
      frameKind: frame.frameKind,
      ownerEntityId: frame.ownerEntityId,
      parent: frame.parent === null ? null : Object.freeze({ ...frame.parent }),
      localPose: frozenPose(frame.localPose),
      worldPose: frozenPose(worldPose),
      effectiveVisible: frame.frameKind === 'grasp'
        ? effectiveEntityVisibility.get(frame.ownerEntityId!) ?? false
        : true,
    })] as const
  }))

  const entityEntries: Array<readonly [string, SceneRuntimeEntityV4]> = []
  const robotFrameEntries: Array<readonly [RobotIdV4, ReadonlyMap<FrameIdV4, SceneRuntimeRobotFrameV4>]> = []
  const visibleRobotIds: RobotIdV4[] = []
  for (const robot of project.robots) {
    const definition = definitionsById.get(robot.definitionId)
    if (definition === undefined) {
      sceneFailure(
        'ROBOT_DEFINITION_NOT_FOUND',
        `$.robots.${robot.id}.definitionId`,
        `Robot Definition ${robot.definitionId} does not exist.`,
      )
    }
    const parentInternalKey = internalKeyByFrameId.get(robot.baseParentFrameId)
    const parentWorld = parentInternalKey === undefined
      ? undefined
      : worldByInternalKey.get(parentInternalKey)
    if (parentWorld === undefined) {
      sceneFailure(
        'FRAME_PARENT_NOT_FOUND',
        `$.robots.${robot.id}.baseParentFrameId`,
        `Robot Base parent Frame ${robot.baseParentFrameId} does not exist.`,
      )
    }
    const runtimeState = runtimeByRobotId.get(robot.id)!
    const jointValues = copiedJointValues(definition, runtimeState, robot.id)
    const worldBasePose = frozenPose(composeRigidTransformV4(parentWorld, robot.localBasePose))
    const serialPose = frozenSerialPose(
      computeSerialRobotPoseV4(definition, jointValues, worldBasePose),
    )
    const effectiveVisible = requireRuntimePrimitive<boolean>(
      runtimeState,
      'visible',
      robot.id,
      'boolean',
    )
    const entity = Object.freeze({
      kind: 'robot' as const,
      entityId: robot.id,
      definitionId: definition.id,
      worldBasePose,
      effectiveVisible,
      jointSource: requireRuntimePrimitive<RobotJointSourceV4>(
        runtimeState,
        'jointSource',
        robot.id,
        'string',
      ),
      numericStatus: requireRuntimePrimitive<number>(
        runtimeState,
        'numericStatus',
        robot.id,
        'number',
      ),
      selectedToolFrameId: requireRuntimePrimitive<FrameIdV4>(
        runtimeState,
        'selectedToolFrameId',
        robot.id,
        'string',
      ),
      selectedTcpFrameId: requireRuntimePrimitive<FrameIdV4>(
        runtimeState,
        'selectedTcpFrameId',
        robot.id,
        'string',
      ),
      serialPose,
    })
    entityEntries.push([robot.id, entity])
    robotFrameEntries.push([robot.id, robotFrameProjection(robot.id, definition, serialPose)])
    if (effectiveVisible) visibleRobotIds.push(robot.id)
  }

  const visibleSpatialEntityIds: SpatialEntityIdV4[] = []
  for (const entity of project.spatialEntities) {
    const rootKey = entityRootKeyByEntityId.get(entity.id)!
    const worldPose = worldByInternalKey.get(rootKey)
    if (worldPose === undefined) {
      sceneFailure(
        'FRAME_PARENT_NOT_FOUND',
        `$.spatialEntities.${entity.id}`,
        'Spatial Entity root was not resolved.',
      )
    }
    const effectiveVisible = effectiveEntityVisibility.get(entity.id)!
    const projection = Object.freeze({
      kind: 'spatial-entity' as const,
      entityId: entity.id,
      groupId: entity.groupId,
      parentFrameId: entity.parentFrameId,
      localPose: frozenPose(entity.localPose),
      worldPose: frozenPose(worldPose),
      persistedVisible: entity.visible,
      effectiveVisible,
      transformOwner: entity.transformOwner,
      numericStatus: entity.numericStatus.value,
    })
    entityEntries.push([entity.id, projection])
    if (effectiveVisible) visibleSpatialEntityIds.push(entity.id)
  }

  return Object.freeze({
    projectRevisionId: project.revisionId,
    globalFrames,
    robotFramesByRobotId: readonlyMapV4(robotFrameEntries),
    groups,
    entities: readonlyMapV4(entityEntries),
    visibleRobotIds: Object.freeze(visibleRobotIds),
    visibleSpatialEntityIds: Object.freeze(visibleSpatialEntityIds),
  })
}
