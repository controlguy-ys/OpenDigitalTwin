import type {
  FrameIdV4,
  RobotIdV4,
  RobotLinkIdV4,
  SceneGroupIdV4,
  SpatialEntityIdV4,
  WorkcellProjectV4,
} from '../../../core/project-v4/index.js'
import {
  encodeRuntimeIdentitySegmentV4,
  robotLinkCollisionIdV4,
  spatialEntityCollisionIdV4,
  type CollisionEntityIdV4,
} from '../../../core/robot-runtime/collision-identity.js'

export type SceneSelectionTargetV4 =
  | { readonly kind: 'robot'; readonly robotId: RobotIdV4 }
  | {
      readonly kind: 'robot-link'
      readonly robotId: RobotIdV4
      readonly linkId: RobotLinkIdV4
    }
  | {
      readonly kind: 'spatial-entity'
      readonly entityId: SpatialEntityIdV4
    }
  | { readonly kind: 'scene-group'; readonly groupId: SceneGroupIdV4 }
  | { readonly kind: 'scene-frame'; readonly frameId: FrameIdV4 }
  | {
      readonly kind: 'robot-frame'
      readonly robotId: RobotIdV4
      readonly frameId: FrameIdV4
    }
  | {
      readonly kind: 'entity-frame'
      readonly entityId: SpatialEntityIdV4
      readonly frameId: FrameIdV4
    }

export type SceneSelectionV4 = SceneSelectionTargetV4 | null

export type PersistedVisibilityTargetV4 =
  | Extract<SceneSelectionTargetV4, { readonly kind: 'robot' }>
  | Extract<SceneSelectionTargetV4, { readonly kind: 'spatial-entity' }>
  | Extract<SceneSelectionTargetV4, { readonly kind: 'scene-group' }>

export type SceneIsolationTargetV4 = PersistedVisibilityTargetV4

export type CoordinateFrameSelectionV4 = Extract<
  SceneSelectionTargetV4,
  { readonly kind: 'scene-frame' | 'robot-frame' | 'entity-frame' }
>

const SELECTION_NAMESPACE_V4 = 'scene-selection-v4'

export function sceneSelectionKeyV4(selection: SceneSelectionTargetV4): string {
  switch (selection.kind) {
    case 'robot':
      return `${SELECTION_NAMESPACE_V4}:robot:${encodeRuntimeIdentitySegmentV4(selection.robotId)}`
    case 'robot-link':
      return `${SELECTION_NAMESPACE_V4}:robot-link:${encodeRuntimeIdentitySegmentV4(selection.robotId)}:${encodeRuntimeIdentitySegmentV4(selection.linkId)}`
    case 'spatial-entity':
      return `${SELECTION_NAMESPACE_V4}:spatial-entity:${encodeRuntimeIdentitySegmentV4(selection.entityId)}`
    case 'scene-group':
      return `${SELECTION_NAMESPACE_V4}:scene-group:${encodeRuntimeIdentitySegmentV4(selection.groupId)}`
    case 'scene-frame':
      return `${SELECTION_NAMESPACE_V4}:scene-frame:${encodeRuntimeIdentitySegmentV4(selection.frameId)}`
    case 'robot-frame':
      return `${SELECTION_NAMESPACE_V4}:robot-frame:${encodeRuntimeIdentitySegmentV4(selection.robotId)}:${encodeRuntimeIdentitySegmentV4(selection.frameId)}`
    case 'entity-frame':
      return `${SELECTION_NAMESPACE_V4}:entity-frame:${encodeRuntimeIdentitySegmentV4(selection.entityId)}:${encodeRuntimeIdentitySegmentV4(selection.frameId)}`
  }
}

export function sameSceneSelectionV4(
  first: SceneSelectionV4,
  second: SceneSelectionV4,
): boolean {
  if (first === null || second === null) return first === second
  return sceneSelectionKeyV4(first) === sceneSelectionKeyV4(second)
}

export function robotIdFromSceneSelectionV4(
  selection: SceneSelectionV4,
): RobotIdV4 | null {
  if (
    selection?.kind === 'robot'
    || selection?.kind === 'robot-link'
    || selection?.kind === 'robot-frame'
  ) {
    return selection.robotId
  }
  return null
}

export function spatialEntityIdFromSceneSelectionV4(
  selection: SceneSelectionV4,
): SpatialEntityIdV4 | null {
  if (selection?.kind === 'spatial-entity' || selection?.kind === 'entity-frame') {
    return selection.entityId
  }
  return null
}

export function collisionEntityIdsForSelectionV4(
  project: WorkcellProjectV4,
  selection: SceneSelectionV4,
): readonly CollisionEntityIdV4[] {
  if (selection === null) return []
  if (selection.kind === 'robot-link') {
    return [robotLinkCollisionIdV4(selection.robotId, selection.linkId)]
  }
  if (selection.kind === 'spatial-entity') {
    return [spatialEntityCollisionIdV4(selection.entityId)]
  }
  if (selection.kind !== 'robot') return []

  const robot = project.robots.find(({ id }) => id === selection.robotId)
  const definition = robot === undefined
    ? undefined
    : project.robotDefinitions.find(({ id }) => id === robot.definitionId)
  return definition?.links.map((link) => (
    robotLinkCollisionIdV4(selection.robotId, link.id)
  )) ?? []
}
