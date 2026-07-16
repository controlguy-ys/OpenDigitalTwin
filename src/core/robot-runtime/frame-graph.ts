import { failProjectV4 } from '../project-v4/errors.js'
import {
  composeRigidTransformV4,
  normalizeRigidTransformV4,
  relativeRigidTransformV4,
  type RigidTransformV4,
} from '../project-v4/rigid-transform.js'

export interface FrameGraphNodeV4 {
  readonly frameId: string
  readonly parentFrameId: string | null
  readonly localPose: RigidTransformV4
}

type VisitState = 'gray' | 'black'

function invalidFrameGraph(code: string, path: string, message: string): never {
  failProjectV4(code, path, message, 'Correct the Frame graph and try again.')
}

function cloneNormalizedTransform(
  value: RigidTransformV4,
  path: string,
): RigidTransformV4 {
  if (
    value.positionM.some((component) => !Number.isFinite(component))
    || value.quaternion.some((component) => !Number.isFinite(component))
  ) {
    invalidFrameGraph('PROJECT_VALUE_INVALID', path, 'Rigid transform components must be finite.')
  }

  return normalizeRigidTransformV4({
    positionM: [...value.positionM],
    quaternion: [...value.quaternion],
  }, path)
}

export function resolveWorldFrameMapV4(
  nodes: readonly FrameGraphNodeV4[],
): ReadonlyMap<string, RigidTransformV4> {
  const nodesById = new Map<string, { readonly node: FrameGraphNodeV4; readonly index: number }>()
  nodes.forEach((node, index) => {
    if (nodesById.has(node.frameId)) {
      invalidFrameGraph(
        'FRAME_ID_DUPLICATE',
        `$.frames[${index}].frameId`,
        `Frame id ${node.frameId} is duplicated.`,
      )
    }
    nodesById.set(node.frameId, { node, index })
  })

  for (const { node, index } of nodesById.values()) {
    if (node.parentFrameId !== null && !nodesById.has(node.parentFrameId)) {
      invalidFrameGraph(
        'FRAME_PARENT_NOT_FOUND',
        `$.frames[${index}].parentFrameId`,
        `Frame parent ${node.parentFrameId} does not exist.`,
      )
    }
  }

  const states = new Map<string, VisitState>()
  const worldById = new Map<string, RigidTransformV4>()

  const resolve = (frameId: string): RigidTransformV4 => {
    const state = states.get(frameId)
    if (state === 'gray') {
      invalidFrameGraph('FRAME_CYCLE', '$.frames', `Frame ${frameId} participates in a cycle.`)
    }
    if (state === 'black') return worldById.get(frameId)!

    const entry = nodesById.get(frameId)!
    states.set(frameId, 'gray')
    const localPose = cloneNormalizedTransform(
      entry.node.localPose,
      `$.frames[${entry.index}].localPose`,
    )
    const worldPose = entry.node.parentFrameId === null
      ? localPose
      : composeRigidTransformV4(resolve(entry.node.parentFrameId), localPose)
    worldById.set(frameId, worldPose)
    states.set(frameId, 'black')
    return worldPose
  }

  nodes.forEach(({ frameId }) => resolve(frameId))
  return worldById
}

export function reparentFramePreservingWorldV4(
  nodes: readonly FrameGraphNodeV4[],
  frameId: string,
  nextParentFrameId: string | null,
): readonly FrameGraphNodeV4[] {
  const currentWorldById = resolveWorldFrameMapV4(nodes)
  const currentWorld = currentWorldById.get(frameId)
  if (currentWorld === undefined) {
    invalidFrameGraph('FRAME_PARENT_NOT_FOUND', '$.frameId', `Frame ${frameId} does not exist.`)
  }

  const nextParentWorld = nextParentFrameId === null
    ? null
    : currentWorldById.get(nextParentFrameId)
  if (nextParentWorld === undefined) {
    invalidFrameGraph(
      'FRAME_PARENT_NOT_FOUND',
      '$.nextParentFrameId',
      `Frame parent ${nextParentFrameId} does not exist.`,
    )
  }

  const nextLocalPose = nextParentWorld === null
    ? cloneNormalizedTransform(currentWorld, '$.localPose')
    : relativeRigidTransformV4(nextParentWorld, currentWorld)
  const candidate = nodes.map((node) => node.frameId === frameId
    ? { ...node, parentFrameId: nextParentFrameId, localPose: nextLocalPose }
    : node)

  resolveWorldFrameMapV4(candidate)
  return candidate
}
