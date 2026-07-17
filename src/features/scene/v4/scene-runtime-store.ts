import {
  failProjectV4,
  type RevisionIdV4,
} from '../../../core/project-v4/index.js'
import { createStore, type StoreApi } from 'zustand/vanilla'
import type { SceneRuntimeProjectionV4 } from './scene-runtime-selector.js'

export interface SceneRuntimeCheckpointV4 {
  readonly kind: 'scene-runtime-checkpoint-v4'
}

export interface SceneRuntimeStoreV4 {
  readonly projectRevisionId: RevisionIdV4 | null
  readonly projection: SceneRuntimeProjectionV4 | null
  replaceProjection(projection: SceneRuntimeProjectionV4): void
  captureCheckpoint(): SceneRuntimeCheckpointV4
  restoreCheckpoint(checkpoint: SceneRuntimeCheckpointV4): void
}

function checkpointFailure(): never {
  failProjectV4(
    'SCENE_RUNTIME_CHECKPOINT_INVALID',
    '$.checkpoint',
    'Scene runtime checkpoint is not owned by this store.',
    'Capture a checkpoint from this Scene runtime store and try again.',
  )
}

export function createSceneRuntimeStoreV4(): StoreApi<SceneRuntimeStoreV4> {
  const checkpoints = new WeakMap<object, SceneRuntimeStoreV4>()

  return createStore<SceneRuntimeStoreV4>()((set, get) => ({
    projectRevisionId: null,
    projection: null,
    replaceProjection: (projection) => {
      set((state) => ({
        ...state,
        projectRevisionId: projection.projectRevisionId,
        projection,
      }), true)
    },
    captureCheckpoint: () => {
      const checkpoint = Object.freeze({
        kind: 'scene-runtime-checkpoint-v4' as const,
      })
      checkpoints.set(checkpoint, get())
      return checkpoint
    },
    restoreCheckpoint: (checkpoint) => {
      if (checkpoint === null || typeof checkpoint !== 'object') checkpointFailure()
      const captured = checkpoints.get(checkpoint)
      if (captured === undefined) checkpointFailure()
      set(captured, true)
    },
  }))
}
