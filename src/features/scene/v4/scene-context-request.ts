import type { SceneSelectionTargetV4 } from '../../interaction/v4/scene-selection.js'

export interface SceneContextPositionV4 {
  readonly x: number
  readonly y: number
}

export interface SceneContextRequestV4 {
  readonly selection: SceneSelectionTargetV4 | null
  readonly position: SceneContextPositionV4
}

export interface WorkcellInteractionHandlersV4 {
  readonly onSelect: (selection: SceneSelectionTargetV4) => void
  readonly onContextCandidate: (
    selection: SceneSelectionTargetV4,
    pointerId: number,
  ) => void
}
