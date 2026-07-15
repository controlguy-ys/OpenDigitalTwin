import { Matrix4, Quaternion, Vector3 } from 'three'
import {
  validateProjectSceneState,
  type ProjectSceneStateV1,
  type SceneEntityIdV1,
  type SceneEntityV1,
  type ScenePoseV1,
} from '../project/scene-state-v1'

const UNIT_SCALE = new Vector3(1, 1, 1)

function matrixForPose(pose: ScenePoseV1): Matrix4 {
  return new Matrix4().compose(
    new Vector3(...pose.positionM),
    new Quaternion(...pose.quaternion).normalize(),
    UNIT_SCALE,
  )
}

function axisTravelMatrix(axis: Extract<SceneEntityV1, { kind: 'linear-axis' }>): Matrix4 {
  const travel = new Vector3()
  travel[axis.direction] = axis.currentPositionM
  return new Matrix4().makeTranslation(travel.x, travel.y, travel.z)
}

function worldMatrix(
  entities: ReadonlyMap<SceneEntityIdV1, SceneEntityV1>,
  entity: SceneEntityV1,
  active = new Set<SceneEntityIdV1>(),
): Matrix4 {
  if (active.has(entity.id)) throw new Error('SCENE_PARENT_CYCLE: Scene transform cycle.')
  active.add(entity.id)
  let parentWorld = new Matrix4()
  if (entity.parentId !== null) {
    const parent = entities.get(entity.parentId)
    if (parent === undefined) throw new Error('SCENE_PARENT_MISSING: Scene transform parent is missing.')
    parentWorld = worldMatrix(entities, parent, active)
    if (parent.kind === 'linear-axis') parentWorld.multiply(axisTravelMatrix(parent))
  }
  active.delete(entity.id)
  return parentWorld.multiply(matrixForPose(entity.localPose))
}

function canonicalNumber(value: number): number {
  if (Math.abs(value) < 1e-14) return 0
  const rounded = Math.round(value * 1e14) / 1e14
  return Object.is(rounded, -0) ? 0 : rounded
}

function poseForMatrix(matrix: Matrix4, rejectScale: boolean): ScenePoseV1 {
  const position = new Vector3()
  const quaternion = new Quaternion()
  const scale = new Vector3()
  matrix.decompose(position, quaternion, scale)
  if (
    rejectScale &&
    Math.max(Math.abs(scale.x - 1), Math.abs(scale.y - 1), Math.abs(scale.z - 1)) > 1e-9
  ) {
    throw new Error('SCENE_REPARENT_SCALE_DRIFT: Reparenting would change Object scale.')
  }
  quaternion.normalize()
  if (
    quaternion.w < 0 ||
    (quaternion.w === 0 && (quaternion.z < 0 ||
      (quaternion.z === 0 && (quaternion.y < 0 || (quaternion.y === 0 && quaternion.x < 0)))))
  ) {
    quaternion.set(-quaternion.x, -quaternion.y, -quaternion.z, -quaternion.w)
  }
  return {
    positionM: [position.x, position.y, position.z].map(canonicalNumber) as unknown as ScenePoseV1['positionM'],
    quaternion: [quaternion.x, quaternion.y, quaternion.z, quaternion.w]
      .map(canonicalNumber) as unknown as ScenePoseV1['quaternion'],
  }
}

function sceneMap(scene: ProjectSceneStateV1): Map<SceneEntityIdV1, SceneEntityV1> {
  return new Map(scene.entities.map((entity) => [entity.id, entity]))
}

export function worldPoseForEntity(
  scene: ProjectSceneStateV1,
  entityId: SceneEntityIdV1,
): ScenePoseV1 {
  const validated = validateProjectSceneState(scene)
  const entities = sceneMap(validated)
  const entity = entities.get(entityId)
  if (entity === undefined) throw new Error(`SCENE_ENTITY_MISSING: ${entityId} does not exist.`)
  return poseForMatrix(worldMatrix(entities, entity), false)
}

export function setSceneEntityWorldPose(
  scene: ProjectSceneStateV1,
  entityId: SceneEntityIdV1,
  worldPose: ScenePoseV1,
): ProjectSceneStateV1 {
  const validated = validateProjectSceneState(scene)
  const entities = sceneMap(validated)
  const entity = entities.get(entityId)
  if (entity === undefined) throw new Error(`SCENE_ENTITY_MISSING: ${entityId} does not exist.`)
  const localMatrix = new Matrix4()
    .copy(parentAnchorWorld(entities, entity.parentId))
    .invert()
    .multiply(matrixForPose(worldPose))
  const localPose = poseForMatrix(localMatrix, true)
  return validateProjectSceneState({
    entities: validated.entities.map((entry) => entry.id === entityId
      ? { ...entry, localPose } as SceneEntityV1
      : entry),
    robotMountContact: validated.robotMountContact,
  })
}

function parentAnchorWorld(
  entities: ReadonlyMap<SceneEntityIdV1, SceneEntityV1>,
  parentId: SceneEntityIdV1 | null,
): Matrix4 {
  if (parentId === null) return new Matrix4()
  const parent = entities.get(parentId)
  if (parent === undefined) throw new Error('SCENE_PARENT_MISSING: Reparent target does not exist.')
  const parentWorld = worldMatrix(entities, parent)
  return parent.kind === 'linear-axis'
    ? parentWorld.multiply(axisTravelMatrix(parent))
    : parentWorld
}

export function reparentSceneEntityPreservingWorld(
  scene: ProjectSceneStateV1,
  entityId: SceneEntityIdV1,
  parentId: SceneEntityIdV1 | null,
): ProjectSceneStateV1 {
  const validated = validateProjectSceneState(scene)
  const original = sceneMap(validated)
  const entity = original.get(entityId)
  if (entity === undefined) throw new Error(`SCENE_ENTITY_MISSING: ${entityId} does not exist.`)
  if (entity.kind === 'linear-axis' && parentId !== null) {
    throw new Error('SCENE_AXIS_PARENT_INVALID: Linear Axis must remain MCP-level.')
  }
  if (entity.kind === 'object' && entity.transformSource === 'opcua' && parentId !== null) {
    throw new Error('SCENE_OPCUA_OBJECT_REQUIRES_MCP_PARENT: OPC UA Object must remain MCP-level.')
  }
  const oldWorld = worldMatrix(original, entity)
  const nextEntities = validated.entities.map((entry): SceneEntityV1 => {
    if (entry.id === entityId) return { ...entry, parentId } as SceneEntityV1
    if (entry.kind !== 'linear-axis') return entry
    let carriageEntityId = entry.carriageEntityId === entityId ? null : entry.carriageEntityId
    let robotEntityId = entry.robotEntityId === entityId ? null : entry.robotEntityId
    if (entry.id === parentId) {
      if (entity.kind === 'robot') {
        if (robotEntityId !== null && robotEntityId !== entity.id) {
          throw new Error('SCENE_AXIS_ROBOT_OCCUPIED: Linear Axis already has a Robot.')
        }
        robotEntityId = entity.id
      } else {
        if (carriageEntityId !== null && carriageEntityId !== entity.id) {
          throw new Error('SCENE_AXIS_CARRIAGE_OCCUPIED: Linear Axis already has a carriage.')
        }
        if (entity.kind === 'linear-axis') {
          throw new Error('SCENE_AXIS_PARENT_INVALID: Linear Axis cannot attach to itself.')
        }
        carriageEntityId = entity.id
      }
    }
    return { ...entry, carriageEntityId, robotEntityId }
  })
  const structural = validateProjectSceneState({
    entities: nextEntities,
    robotMountContact: validated.robotMountContact,
  })
  const nextMap = sceneMap(structural)
  const newLocal = new Matrix4()
    .copy(parentAnchorWorld(nextMap, parentId))
    .invert()
    .multiply(oldWorld)
  const localPose = poseForMatrix(newLocal, true)
  return validateProjectSceneState({
    entities: structural.entities.map((entry) => entry.id === entityId
      ? { ...entry, localPose }
      : entry),
    robotMountContact: structural.robotMountContact,
  })
}
