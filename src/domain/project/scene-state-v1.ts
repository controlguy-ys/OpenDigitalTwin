import type { RobotLinkId } from '../robot/crb15000'

export type SceneEntityIdV1 =
  | 'robot:active'
  | 'linear-axis:active'
  | `group:${string}`
  | `object:${string}`
  | `equipment:${string}`

export interface ScenePoseV1 {
  readonly positionM: readonly [number, number, number]
  readonly quaternion: readonly [number, number, number, number]
}

interface SceneEntityBaseV1 {
  readonly id: SceneEntityIdV1
  readonly name: string
  readonly parentId: SceneEntityIdV1 | null
  readonly localPose: ScenePoseV1
  readonly visible: boolean
}

export interface LinearAxisConfigurationV1 {
  readonly direction: 'x' | 'y' | 'z'
  readonly minPositionM: number
  readonly maxPositionM: number
  readonly homePositionM: number
  readonly currentPositionM: number
  readonly carriageEntityId:
    | `object:${string}`
    | `equipment:${string}`
    | `group:${string}`
    | null
  readonly robotEntityId: 'robot:active' | null
}

export type SceneEntityV1 =
  | (SceneEntityBaseV1 & { readonly kind: 'robot'; readonly id: 'robot:active' })
  | (SceneEntityBaseV1 & { readonly kind: 'group'; readonly id: `group:${string}` })
  | (SceneEntityBaseV1 & {
      readonly kind: 'object'
      readonly id: `object:${string}` | `equipment:${string}`
      readonly target:
        | Readonly<{ kind: 'object-instance'; id: string }>
        | Readonly<{ kind: 'built-in-equipment'; id: string }>
      readonly transformSource: 'manual' | 'opcua'
    })
  | (SceneEntityBaseV1 & LinearAxisConfigurationV1 & {
      readonly kind: 'linear-axis'
      readonly id: 'linear-axis:active'
    })

export interface RobotMountContactV1 {
  readonly baseLinkId: RobotLinkId
  readonly mountSurfaceCollisionEntityId: string | null
}

export interface ProjectSceneStateV1 {
  readonly entities: readonly SceneEntityV1[]
  readonly robotMountContact: RobotMountContactV1 | null
}

const ROBOT_LINK_IDS = new Set<RobotLinkId>([
  'LINK00', 'LINK01', 'LINK02', 'LINK03', 'LINK04', 'LINK05', 'LINK06',
])

function sceneFail(code: string, detail: string): never {
  throw new Error(`${code}: ${detail}`)
}

function plainDataRecord(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return sceneFail('SCENE_RECORD_INVALID', `${label} must be an object.`)
  }
  if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) {
    return sceneFail('SCENE_RECORD_INVALID', `${label} must be a plain object.`)
  }
  const keys = Reflect.ownKeys(value)
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (descriptor === undefined || !descriptor.enumerable || !('value' in descriptor)) {
      return sceneFail('SCENE_RECORD_INVALID', `${label}.${String(key)} must be enumerable data.`)
    }
  }
  return value as Record<string, unknown>
}

function record(
  value: unknown,
  label: string,
  required: readonly string[],
): Record<string, unknown> {
  const source = plainDataRecord(value, label)
  for (const key of Reflect.ownKeys(source)) {
    if (typeof key !== 'string' || !required.includes(key)) {
      return sceneFail('SCENE_UNKNOWN_FIELD', `${label} contains an unknown field.`)
    }
  }
  for (const key of required) {
    if (!Object.hasOwn(source, key)) {
      return sceneFail('SCENE_REQUIRED_FIELD', `${label}.${key} is required.`)
    }
  }
  return source
}

function finite(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return sceneFail('SCENE_NUMBER_INVALID', `${label} must be finite.`)
  }
  return value
}

function identifier(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0 || value.includes('|')) {
    return sceneFail('SCENE_ID_INVALID', `${label} must be a non-empty identifier.`)
  }
  if (new TextEncoder().encode(value).byteLength > 128) {
    return sceneFail('SCENE_ID_INVALID', `${label} exceeds 128 UTF-8 bytes.`)
  }
  return value
}

function tuple(value: unknown, length: number, label: string): number[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) {
    return sceneFail('SCENE_TUPLE_INVALID', `${label} must be a plain array.`)
  }
  if (value.length !== length) {
    return sceneFail('SCENE_TUPLE_INVALID', `${label} array must contain exactly ${length} values.`)
  }
  let indices = 0
  for (const key of Reflect.ownKeys(value)) {
    if (key === 'length') continue
    if (typeof key !== 'string' || !/^\d+$/.test(key) || Number(key) >= length) {
      return sceneFail('SCENE_TUPLE_INVALID', `${label} contains an unknown array field.`)
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (descriptor === undefined || !descriptor.enumerable) {
      return sceneFail('SCENE_TUPLE_INVALID', `${label}[${key}] must be enumerable.`)
    }
    if (!('value' in descriptor)) {
      return sceneFail('SCENE_TUPLE_INVALID', `${label}[${key}] must be a data field.`)
    }
    indices += 1
  }
  if (indices !== length) return sceneFail('SCENE_TUPLE_INVALID', `${label} array must not be sparse.`)
  return value.map((entry, index) => finite(entry, `${label}[${index}]`))
}

function entityArray(value: unknown): unknown[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) {
    return sceneFail('SCENE_ENTITIES_INVALID', 'scene.entities must be a plain array.')
  }
  const descriptors = Object.getOwnPropertyDescriptors(value)
  if (Reflect.ownKeys(descriptors).length !== value.length + 1) {
    return sceneFail('SCENE_ENTITIES_NOT_DENSE', 'scene.entities must be a dense closed array.')
  }
  const ordered: PropertyDescriptor[] = []
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = descriptors[String(index)]
    if (descriptor === undefined) {
      return sceneFail('SCENE_ENTITIES_NOT_DENSE', 'scene.entities must not be sparse.')
    }
    if (!descriptor.enumerable) {
      return sceneFail('SCENE_ENTITIES_INVALID', `scene.entities[${index}] must be enumerable.`)
    }
    if (!('value' in descriptor)) {
      return sceneFail('SCENE_ENTITIES_INVALID', `scene.entities[${index}] must be a data field.`)
    }
    ordered.push(descriptor)
  }
  return ordered.map((descriptor) => descriptor.value)
}

function pose(value: unknown, label: string): ScenePoseV1 {
  const source = record(value, label, ['positionM', 'quaternion'])
  const positionM = tuple(source.positionM, 3, `${label}.positionM`)
  const quaternion = tuple(source.quaternion, 4, `${label}.quaternion`)
  const scale = Math.max(...quaternion.map(Math.abs))
  if (scale === 0) {
    return sceneFail('SCENE_QUATERNION_INVALID', `${label}.quaternion must have norm above 1e-9.`)
  }
  const scaled = quaternion.map((component) => component / scale)
  const scaledNorm = Math.hypot(...scaled)
  if (!Number.isFinite(scaledNorm) || scaledNorm <= 0 || scale <= 1e-9 / scaledNorm) {
    return sceneFail('SCENE_QUATERNION_INVALID', `${label}.quaternion must have norm above 1e-9.`)
  }
  return {
    positionM: positionM as unknown as ScenePoseV1['positionM'],
    quaternion: scaled.map((component) => {
      const normalized = component / scaledNorm
      return Object.is(normalized, -0) ? 0 : normalized
    }) as unknown as ScenePoseV1['quaternion'],
  }
}

function entityId(value: unknown, label: string): SceneEntityIdV1 {
  if (typeof value !== 'string' || new TextEncoder().encode(value).byteLength > 138) {
    return sceneFail('SCENE_ID_INVALID', `${label} must be a canonical Scene id.`)
  }
  const id = value
  if (
    id !== 'robot:active' &&
    id !== 'linear-axis:active' &&
    !/^(?:group|object|equipment):.+$/.test(id)
  ) {
    return sceneFail('SCENE_ID_INVALID', `${label} is not canonical.`)
  }
  identifier(id.slice(id.indexOf(':') + 1), `${label} suffix`)
  return id as SceneEntityIdV1
}

function baseEntity(
  source: Record<string, unknown>,
  label: string,
): Pick<SceneEntityBaseV1, 'name' | 'parentId' | 'localPose' | 'visible'> {
  const name = identifier(source.name, `${label}.name`)
  const parentId = source.parentId === null
    ? null
    : entityId(source.parentId, `${label}.parentId`)
  if (typeof source.visible !== 'boolean') {
    return sceneFail('SCENE_VISIBILITY_INVALID', `${label}.visible must be boolean.`)
  }
  return { name, parentId, localPose: pose(source.localPose, `${label}.localPose`), visible: source.visible }
}

function validateEntity(value: unknown, index: number): SceneEntityV1 {
  const label = `scene.entities[${index}]`
  const entity = plainDataRecord(value, label)
  const kind = entity.kind
  const common = ['kind', 'id', 'name', 'parentId', 'localPose', 'visible'] as const
  if (kind === 'robot') {
    const source = record(entity, label, common)
    if (source.id !== 'robot:active') return sceneFail('SCENE_ID_KIND_MISMATCH', `${label}.id is invalid.`)
    return { kind, id: 'robot:active', ...baseEntity(source, label) }
  }
  if (kind === 'group') {
    const source = record(entity, label, common)
    const id = entityId(source.id, `${label}.id`)
    if (!id.startsWith('group:')) return sceneFail('SCENE_ID_KIND_MISMATCH', `${label}.id is invalid.`)
    return { kind, id: id as `group:${string}`, ...baseEntity(source, label) }
  }
  if (kind === 'object') {
    const source = record(entity, label, [...common, 'target', 'transformSource'])
    const id = entityId(source.id, `${label}.id`)
    if (!id.startsWith('object:') && !id.startsWith('equipment:')) {
      return sceneFail('SCENE_ID_KIND_MISMATCH', `${label}.id is invalid.`)
    }
    const target = record(source.target, `${label}.target`, ['kind', 'id'])
    if (target.kind !== 'object-instance' && target.kind !== 'built-in-equipment') {
      return sceneFail('SCENE_TARGET_INVALID', `${label}.target.kind is invalid.`)
    }
    const targetId = identifier(target.id, `${label}.target.id`)
    if (
      (id.startsWith('object:') && (target.kind !== 'object-instance' || id !== `object:${targetId}`)) ||
      (id.startsWith('equipment:') && (target.kind !== 'built-in-equipment' || id !== `equipment:${targetId}`))
    ) {
      return sceneFail('SCENE_TARGET_ID_MISMATCH', `${label} id and target must agree.`)
    }
    if (source.transformSource !== 'manual' && source.transformSource !== 'opcua') {
      return sceneFail('SCENE_TRANSFORM_SOURCE_INVALID', `${label}.transformSource is invalid.`)
    }
    return {
      kind, id: id as `object:${string}` | `equipment:${string}`, ...baseEntity(source, label),
      target: { kind: target.kind, id: targetId },
      transformSource: source.transformSource,
    }
  }
  if (kind === 'linear-axis') {
    const source = record(entity, label, [
      ...common, 'direction', 'minPositionM', 'maxPositionM', 'homePositionM',
      'currentPositionM', 'carriageEntityId', 'robotEntityId',
    ])
    if (source.id !== 'linear-axis:active') {
      return sceneFail('SCENE_ID_KIND_MISMATCH', `${label}.id is invalid.`)
    }
    if (source.direction !== 'x' && source.direction !== 'y' && source.direction !== 'z') {
      return sceneFail('SCENE_LINEAR_AXIS_DIRECTION', `${label}.direction is invalid.`)
    }
    const minPositionM = finite(source.minPositionM, `${label}.minPositionM`)
    const maxPositionM = finite(source.maxPositionM, `${label}.maxPositionM`)
    const homePositionM = finite(source.homePositionM, `${label}.homePositionM`)
    const currentPositionM = finite(source.currentPositionM, `${label}.currentPositionM`)
    if (
      minPositionM >= maxPositionM || homePositionM < minPositionM ||
      homePositionM > maxPositionM || currentPositionM < minPositionM ||
      currentPositionM > maxPositionM
    ) {
      return sceneFail('SCENE_LINEAR_AXIS_RANGE', `${label} positions are inconsistent.`)
    }
    let carriageEntityId: LinearAxisConfigurationV1['carriageEntityId'] = null
    if (source.carriageEntityId !== null) {
      const id = entityId(source.carriageEntityId, `${label}.carriageEntityId`)
      if (!id.startsWith('object:') && !id.startsWith('equipment:') && !id.startsWith('group:')) {
        return sceneFail('SCENE_AXIS_ATTACHMENT_INVALID', `${label}.carriageEntityId is invalid.`)
      }
      carriageEntityId = id as LinearAxisConfigurationV1['carriageEntityId']
    }
    if (source.robotEntityId !== null && source.robotEntityId !== 'robot:active') {
      return sceneFail('SCENE_AXIS_ATTACHMENT_INVALID', `${label}.robotEntityId is invalid.`)
    }
    return {
      kind, id: 'linear-axis:active', ...baseEntity(source, label),
      direction: source.direction, minPositionM, maxPositionM, homePositionM,
      currentPositionM, carriageEntityId,
      robotEntityId: source.robotEntityId as 'robot:active' | null,
    }
  }
  return sceneFail('SCENE_KIND_INVALID', `${label}.kind is invalid.`)
}

function deepFreeze(value: unknown): void {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return
  for (const nested of Object.values(value)) deepFreeze(nested)
  Object.freeze(value)
}

export function validateProjectSceneState(value: unknown): ProjectSceneStateV1 {
  const source = record(value, 'scene', ['entities', 'robotMountContact'])
  const entities = entityArray(source.entities).map(validateEntity)
  const byId = new Map<SceneEntityIdV1, SceneEntityV1>()
  const robots = entities.filter(({ kind }) => kind === 'robot').length
  const axes = entities.filter(({ kind }) => kind === 'linear-axis').length
  if (robots > 1) return sceneFail('SCENE_ROBOT_LIMIT', 'At most one Robot is allowed.')
  if (axes > 1) return sceneFail('SCENE_LINEAR_AXIS_LIMIT', 'At most one Linear Axis is allowed.')
  for (const entity of entities) {
    if (byId.has(entity.id)) {
      return sceneFail(
        entity.kind === 'object' ? 'SCENE_TARGET_DUPLICATE' : 'SCENE_ENTITY_ID_DUPLICATE',
        `${entity.id} is duplicated.`,
      )
    }
    byId.set(entity.id, entity)
  }
  for (const entity of entities) {
    if (entity.parentId !== null && !byId.has(entity.parentId)) {
      return sceneFail('SCENE_PARENT_MISSING', `${entity.id} references a missing parent.`)
    }
  }
  for (const entity of entities) {
    const visited = new Set<SceneEntityIdV1>()
    let cursor: SceneEntityV1 | undefined = entity
    while (cursor?.parentId !== null && cursor !== undefined) {
      if (visited.has(cursor.id)) return sceneFail('SCENE_PARENT_CYCLE', `${entity.id} has a parent cycle.`)
      visited.add(cursor.id)
      cursor = byId.get(cursor.parentId)
    }
  }

  const axisEntity = byId.get('linear-axis:active')
  const axis = axisEntity?.kind === 'linear-axis' ? axisEntity : undefined
  if (axis !== undefined && axis.parentId !== null) {
    return sceneFail('SCENE_AXIS_PARENT_INVALID', 'Linear Axis must be MCP-relative.')
  }
  for (const entity of entities) {
    const parent = entity.parentId === null ? undefined : byId.get(entity.parentId)
    if (entity.kind === 'group' && parent?.kind === 'group') {
      return sceneFail('SCENE_GROUP_NESTING', 'Groups cannot nest.')
    }
    if (entity.kind === 'group' && parent !== undefined && parent.kind !== 'linear-axis') {
      return sceneFail('SCENE_GROUP_PARENT_INVALID', 'Group parent must be MCP or the Linear Axis.')
    }
    if (entity.kind === 'robot' && parent !== undefined && parent.kind !== 'linear-axis') {
      return sceneFail('SCENE_ROBOT_PARENT_INVALID', 'Robot parent must be MCP or the Linear Axis.')
    }
    if (entity.kind === 'object' && parent !== undefined && parent.kind !== 'group' && parent.kind !== 'linear-axis') {
      return sceneFail('SCENE_OBJECT_PARENT_INVALID', 'Object parent must be MCP, a Group, or the Linear Axis.')
    }
    if (entity.kind === 'object' && entity.transformSource === 'opcua' && entity.parentId !== null) {
      return sceneFail('SCENE_OPCUA_OBJECT_REQUIRES_MCP_PARENT', `${entity.id} must remain MCP-level.`)
    }
    if (parent?.kind === 'linear-axis') {
      const attached = entity.kind === 'robot'
        ? parent.robotEntityId === entity.id
        : parent.carriageEntityId === entity.id
      if (!attached) return sceneFail('SCENE_AXIS_ATTACHMENT_MISMATCH', `${entity.id} is not declared by the Axis.`)
    }
  }
  if (axis !== undefined) {
    if (axis.carriageEntityId !== null) {
      const carriage = byId.get(axis.carriageEntityId)
      if (carriage === undefined || carriage.kind === 'robot' || carriage.kind === 'linear-axis' || carriage.parentId !== axis.id) {
        return sceneFail('SCENE_AXIS_ATTACHMENT_MISMATCH', 'Axis carriage attachment is inconsistent.')
      }
    }
    if (axis.robotEntityId !== null) {
      const attachedRobot = byId.get(axis.robotEntityId)
      if (attachedRobot?.kind !== 'robot' || attachedRobot.parentId !== axis.id) {
        return sceneFail('SCENE_AXIS_ATTACHMENT_MISMATCH', 'Axis Robot attachment is inconsistent.')
      }
    }
  }

  let robotMountContact: RobotMountContactV1 | null = null
  if (source.robotMountContact !== null) {
    const contact = record(source.robotMountContact, 'scene.robotMountContact', [
      'baseLinkId', 'mountSurfaceCollisionEntityId',
    ])
    if (!ROBOT_LINK_IDS.has(contact.baseLinkId as RobotLinkId)) {
      return sceneFail('SCENE_ROBOT_MOUNT_INVALID', 'Robot mount baseLinkId is invalid.')
    }
    if (
      contact.mountSurfaceCollisionEntityId !== null &&
      (typeof contact.mountSurfaceCollisionEntityId !== 'string' || contact.mountSurfaceCollisionEntityId.length === 0)
    ) {
      return sceneFail('SCENE_ROBOT_MOUNT_INVALID', 'Robot mount collision entity id is invalid.')
    }
    if (robots === 0) return sceneFail('SCENE_ROBOT_MOUNT_INVALID', 'Robot mount requires a Robot entity.')
    robotMountContact = {
      baseLinkId: contact.baseLinkId as RobotLinkId,
      mountSurfaceCollisionEntityId: contact.mountSurfaceCollisionEntityId as string | null,
    }
  }
  const result: ProjectSceneStateV1 = { entities, robotMountContact }
  deepFreeze(result)
  return result
}
