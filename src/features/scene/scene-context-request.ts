import type { SceneEntityIdV1 } from '../../domain/project/scene-state-v1'

export interface SceneContextPosition {
  readonly x: number
  readonly y: number
}

export interface SceneContextRequest {
  readonly entityId: SceneEntityIdV1 | null
  readonly position: SceneContextPosition
}

export type SceneEntityContextHandler = (
  entityId: SceneEntityIdV1,
  position: SceneContextPosition,
) => void
