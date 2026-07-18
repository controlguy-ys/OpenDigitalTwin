import type { SceneSelectionTargetV4 } from '../../interaction/v4/scene-selection.js'
import type { SceneContextRequestV4 } from './scene-context-request.js'

export const SCENE_CONTEXT_DRAG_THRESHOLD_PX_V4 = 5
const THRESHOLD_SQUARED_V4 = SCENE_CONTEXT_DRAG_THRESHOLD_PX_V4 ** 2

interface PointV4 {
  readonly pointerId: number
  readonly clientX: number
  readonly clientY: number
}

interface BeginV4 extends PointV4 {
  readonly button: number
  readonly pointerType: string
}

interface NativeContextV4 {
  readonly button: number
  readonly clientX: number
  readonly clientY: number
  readonly pointerId?: number
  readonly pointerType?: string
}

interface ActiveV4 extends PointV4 {
  readonly pointerType: 'mouse' | 'pen'
  readonly originClientX: number
  readonly originClientY: number
  readonly candidate: SceneSelectionTargetV4 | null
  readonly dragged: boolean
}

interface CompletionV4 extends PointV4 {
  readonly completionId: number
  readonly pointerType: 'mouse' | 'pen'
}

export interface FinishedRightButtonGestureV4 {
  readonly completionId: number
  readonly request: SceneContextRequestV4 | null
}

export interface RightButtonGestureControllerV4 {
  begin(event: BeginV4): boolean
  setCandidate(pointerId: number, selection: SceneSelectionTargetV4): void
  move(event: PointV4): void
  finish(event: PointV4): FinishedRightButtonGestureV4 | null
  cancel(pointerId?: number): void
  consumeNativeContextMenu(event: NativeContextV4): boolean
  clearCompletion(completionId: number): void
}

function advanceV4(active: ActiveV4, event: PointV4): ActiveV4 {
  const dx = event.clientX - active.originClientX
  const dy = event.clientY - active.originClientY
  return {
    ...active,
    clientX: event.clientX,
    clientY: event.clientY,
    dragged: active.dragged || dx * dx + dy * dy >= THRESHOLD_SQUARED_V4,
  }
}

export function createRightButtonGestureControllerV4(): RightButtonGestureControllerV4 {
  let active: ActiveV4 | null = null
  let completion: CompletionV4 | null = null
  let nextCompletionId = 0
  return {
    begin(event) {
      if (event.button !== 2 || (event.pointerType !== 'mouse' && event.pointerType !== 'pen')) {
        return false
      }
      completion = null
      active = {
        pointerId: event.pointerId,
        pointerType: event.pointerType,
        originClientX: event.clientX,
        originClientY: event.clientY,
        clientX: event.clientX,
        clientY: event.clientY,
        candidate: null,
        dragged: false,
      }
      return true
    },
    setCandidate(pointerId, selection) {
      if (active?.pointerId === pointerId) active = { ...active, candidate: selection }
    },
    move(event) {
      if (active?.pointerId === event.pointerId) active = advanceV4(active, event)
    },
    finish(event) {
      if (active?.pointerId !== event.pointerId) return null
      const finished = advanceV4(active, event)
      active = null
      const completionId = ++nextCompletionId
      completion = {
        completionId,
        pointerId: finished.pointerId,
        pointerType: finished.pointerType,
        clientX: finished.clientX,
        clientY: finished.clientY,
      }
      return {
        completionId,
        request: finished.dragged ? null : {
          selection: finished.candidate,
          position: { x: finished.clientX, y: finished.clientY },
        },
      }
    },
    cancel(pointerId) {
      if (pointerId === undefined) {
        active = null
        completion = null
        return
      }
      if (active?.pointerId === pointerId) active = null
      if (completion?.pointerId === pointerId) completion = null
    },
    consumeNativeContextMenu(event) {
      const record = active ?? completion
      if (record === null || event.button !== 2) return false
      const pointerMatches = typeof event.pointerId === 'number'
        ? record.pointerId === event.pointerId
          && (event.pointerType === 'mouse' || event.pointerType === 'pen')
        : record.clientX === event.clientX && record.clientY === event.clientY
      if (!pointerMatches) return false
      if (record === completion) completion = null
      return true
    },
    clearCompletion(completionId) {
      if (completion?.completionId === completionId) completion = null
    },
  }
}
