import { useFrame } from '@react-three/fiber'
import { useLayoutEffect, useRef } from 'react'
import { Matrix4, Quaternion, Vector3, type Object3D } from 'three'
import type {
  SceneRuntimeEntityV1,
  SceneRuntimeProjectionV1,
} from './scene-runtime-selector'
import type { LinearAxisSourceV1 } from './linear-axis-source'

const UNIT_SCALE = new Vector3(1, 1, 1)
const DECOMPOSED_SCALE = new Vector3()
export const LINEAR_AXIS_RUNTIME_FRAME_PRIORITY = -1

function axisTravelVector(
  axis: Extract<SceneRuntimeEntityV1['source'], { kind: 'linear-axis' }>,
  positionM = axis.currentPositionM,
): Vector3 {
  const travel = new Vector3()
  travel[axis.direction] = positionM
  return travel
}

export function linearAxisMovingFrameMatrix(
  axis: SceneRuntimeEntityV1,
  positionM = axis.source.kind === 'linear-axis' ? axis.source.currentPositionM : 0,
): Matrix4 {
  if (axis.source.kind !== 'linear-axis') {
    throw new Error('LINEAR_AXIS_RUNTIME_REQUIRED: Runtime Entity is not a Linear Axis.')
  }
  return new Matrix4()
    .fromArray(axis.worldMatrix as number[])
    .multiply(new Matrix4().makeTranslation(...axisTravelVector(axis.source, positionM).toArray()))
}

export function applySceneRuntimeWorldMatrix(
  object: Object3D,
  runtime: SceneRuntimeEntityV1,
  worldMatrix?: Matrix4,
  preserveScale = false,
): void {
  const matrix = worldMatrix ?? new Matrix4().fromArray(runtime.worldMatrix as number[])
  const ownedScale = preserveScale ? object.scale.clone() : UNIT_SCALE
  matrix.decompose(object.position, object.quaternion, DECOMPOSED_SCALE)
  object.quaternion.normalize()
  object.scale.copy(ownedScale)
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
  positionM = runtime.linearAxis?.source.kind === 'linear-axis'
    ? runtime.linearAxis.source.currentPositionM
    : 0,
): readonly string[] {
  const axis = runtime.linearAxis
  if (axis?.source.kind !== 'linear-axis') return Object.freeze([])
  const updated: string[] = []
  const axisDelta = positionM === axis.source.currentPositionM
    ? null
    : linearAxisMovingFrameMatrix(axis, positionM)
      .multiply(linearAxisMovingFrameMatrix(axis).invert())
  const adjustedWorldMatrix = (entity: SceneRuntimeEntityV1) => {
    const worldMatrix = new Matrix4().fromArray(entity.worldMatrix as number[])
    return axisDelta === null ? worldMatrix : axisDelta.clone().multiply(worldMatrix)
  }
  const carriageId = axis.source.carriageEntityId
  if (carriageId !== null) {
    for (const objectRuntime of runtime.objects) {
      if (
        objectRuntime.entityId !== carriageId &&
        !isDescendantOf(runtime, objectRuntime, carriageId)
      ) continue
      const object = objectRoots.get(objectRuntime.entityId)
      if (object === undefined) continue
      applySceneRuntimeWorldMatrix(
        object,
        objectRuntime,
        adjustedWorldMatrix(objectRuntime),
        true,
      )
      updated.push(objectRuntime.entityId)
    }
  }
  if (axis.source.robotEntityId !== null && runtime.robot !== null && robotRoot !== null) {
    applySceneRuntimeWorldMatrix(
      robotRoot,
      runtime.robot,
      adjustedWorldMatrix(runtime.robot),
      false,
    )
    updated.push(runtime.robot.entityId)
  }
  return Object.freeze(updated)
}

export interface LinearAxisRuntimeProps {
  readonly runtime: SceneRuntimeProjectionV1
  readonly objectRoots: ReadonlyMap<string, Object3D>
  readonly robotRoot: Object3D | null
  readonly source: LinearAxisSourceV1 | null
}

export function LinearAxisRuntime({
  runtime,
  objectRoots,
  robotRoot,
  source,
}: LinearAxisRuntimeProps) {
  const appliedRevision = useRef<string | null>(null)
  const movingFrameRef = useRef<Object3D>(null)
  const axis = runtime.linearAxis
  const minPositionM = axis?.source.kind === 'linear-axis'
    ? axis.source.minPositionM
    : 0
  const maxPositionM = axis?.source.kind === 'linear-axis'
    ? axis.source.maxPositionM
    : 0
  const latestTimestampMs = useRef(Number.NEGATIVE_INFINITY)
  const lastGoodPositionM = useRef(
    axis?.source.kind === 'linear-axis' ? axis.source.currentPositionM : 0,
  )

  useLayoutEffect(() => {
    if (axis?.source.kind !== 'linear-axis') return
    latestTimestampMs.current = Number.NEGATIVE_INFINITY
    lastGoodPositionM.current = axis.source.currentPositionM
    appliedRevision.current = null
    if (source === null) return
    return source.subscribe((frame) => {
      if (
        !Number.isFinite(frame.timestampMs) ||
        frame.timestampMs < latestTimestampMs.current
      ) return
      latestTimestampMs.current = frame.timestampMs
      if (
        frame.quality === 'GOOD' &&
        Number.isFinite(frame.positionM) &&
        frame.positionM >= minPositionM &&
        frame.positionM <= maxPositionM
      ) {
        lastGoodPositionM.current = frame.positionM
      }
    })
  }, [
    axis?.entityId,
    minPositionM,
    maxPositionM,
    source,
  ])

  useFrame(() => {
    if (axis?.source.kind !== 'linear-axis') return
    const positionM = lastGoodPositionM.current
    const revision = [
      ...axis.worldMatrix,
      axis.source.direction,
      positionM,
      axis.source.carriageEntityId,
      axis.source.robotEntityId,
    ].join('|')
    if (appliedRevision.current === revision) return
    synchronizeLinearAxisWorldMatrices(runtime, objectRoots, robotRoot, positionM)
    const travel = axisTravelVector(axis.source, positionM)
    movingFrameRef.current?.position?.copy(travel)
    appliedRevision.current = revision
  }, LINEAR_AXIS_RUNTIME_FRAME_PRIORITY)

  if (axis?.source.kind !== 'linear-axis' || !axis.effectiveVisible) return null
  const travel = axisTravelVector(axis.source, lastGoodPositionM.current)
  const rotation = new Quaternion(...axis.worldPose.quaternion)
  return (
    <group
      name="linear-axis:active"
      position={axis.worldPose.positionM}
      quaternion={rotation}
    >
      <group name="linear-axis:moving-frame" position={travel} ref={movingFrameRef}>
        <axesHelper args={[0.18]} />
      </group>
    </group>
  )
}
