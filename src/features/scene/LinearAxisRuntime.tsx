import { useFrame } from '@react-three/fiber'
import { useRef } from 'react'
import { Matrix4, Quaternion, Vector3, type Object3D } from 'three'
import type {
  SceneRuntimeEntityV1,
  SceneRuntimeProjectionV1,
} from './scene-runtime-selector'

const UNIT_SCALE = new Vector3(1, 1, 1)

function axisTravelVector(
  axis: Extract<SceneRuntimeEntityV1['source'], { kind: 'linear-axis' }>,
): Vector3 {
  const travel = new Vector3()
  travel[axis.direction] = axis.currentPositionM
  return travel
}

export function linearAxisMovingFrameMatrix(axis: SceneRuntimeEntityV1): Matrix4 {
  if (axis.source.kind !== 'linear-axis') {
    throw new Error('LINEAR_AXIS_RUNTIME_REQUIRED: Runtime Entity is not a Linear Axis.')
  }
  return new Matrix4()
    .fromArray(axis.worldMatrix as number[])
    .multiply(new Matrix4().makeTranslation(...axisTravelVector(axis.source).toArray()))
}

export function applySceneRuntimeWorldMatrix(
  object: Object3D,
  runtime: SceneRuntimeEntityV1,
): void {
  const matrix = new Matrix4().fromArray(runtime.worldMatrix as number[])
  matrix.decompose(object.position, object.quaternion, object.scale)
  object.quaternion.normalize()
  if (Math.max(
    Math.abs(object.scale.x - 1),
    Math.abs(object.scale.y - 1),
    Math.abs(object.scale.z - 1),
  ) <= 1e-9) object.scale.copy(UNIT_SCALE)
  object.updateMatrix()
  object.updateWorldMatrix(true, true)
}

function isDescendantOf(
  runtime: SceneRuntimeProjectionV1,
  entity: SceneRuntimeEntityV1,
  ancestorId: string,
): boolean {
  let parentId = entity.parentId
  while (parentId !== null) {
    if (parentId === ancestorId) return true
    parentId = runtime.byId.get(parentId)?.parentId ?? null
  }
  return false
}

export function synchronizeLinearAxisWorldMatrices(
  runtime: SceneRuntimeProjectionV1,
  objectRoots: ReadonlyMap<string, Object3D>,
  robotRoot: Object3D | null,
): readonly string[] {
  const axis = runtime.linearAxis
  if (axis?.source.kind !== 'linear-axis') return Object.freeze([])
  const updated: string[] = []
  const carriageId = axis.source.carriageEntityId
  if (carriageId !== null) {
    for (const objectRuntime of runtime.objects) {
      if (
        objectRuntime.entityId !== carriageId &&
        !isDescendantOf(runtime, objectRuntime, carriageId)
      ) continue
      const object = objectRoots.get(objectRuntime.entityId)
      if (object === undefined) continue
      applySceneRuntimeWorldMatrix(object, objectRuntime)
      updated.push(objectRuntime.entityId)
    }
  }
  if (axis.source.robotEntityId !== null && runtime.robot !== null && robotRoot !== null) {
    applySceneRuntimeWorldMatrix(robotRoot, runtime.robot)
    updated.push(runtime.robot.entityId)
  }
  return Object.freeze(updated)
}

export interface LinearAxisRuntimeProps {
  readonly runtime: SceneRuntimeProjectionV1
  readonly objectRoots: ReadonlyMap<string, Object3D>
  readonly robotRoot: Object3D | null
}

export function LinearAxisRuntime({
  runtime,
  objectRoots,
  robotRoot,
}: LinearAxisRuntimeProps) {
  const appliedRevision = useRef<string | null>(null)
  const axis = runtime.linearAxis

  useFrame(() => {
    if (axis?.source.kind !== 'linear-axis') return
    const revision = [
      ...axis.worldMatrix,
      axis.source.direction,
      axis.source.currentPositionM,
      axis.source.carriageEntityId,
      axis.source.robotEntityId,
    ].join('|')
    if (appliedRevision.current === revision) return
    synchronizeLinearAxisWorldMatrices(runtime, objectRoots, robotRoot)
    appliedRevision.current = revision
  })

  if (axis?.source.kind !== 'linear-axis' || !axis.effectiveVisible) return null
  const travel = axisTravelVector(axis.source)
  const rotation = new Quaternion(...axis.worldPose.quaternion)
  return (
    <group
      name="linear-axis:active"
      position={axis.worldPose.positionM}
      quaternion={rotation}
    >
      <group name="linear-axis:moving-frame" position={travel}>
        <axesHelper args={[0.18]} />
      </group>
    </group>
  )
}
