import { createStore, type StoreApi } from 'zustand/vanilla'
import type {
  SceneEntityIdV1,
  ScenePoseV1,
} from '../../domain/project/scene-state-v1'
import type { ProjectMutationService } from '../project/project-mutation-service'

export interface SceneEditorState {
  readonly selectedEntityId: SceneEntityIdV1 | null
  readonly isolatedEntityId: SceneEntityIdV1 | null
  readonly draftPose: Readonly<{
    entityId: SceneEntityIdV1
    pose: ScenePoseV1
    generation: number
  }> | null
  select(entityId: SceneEntityIdV1 | null): void
  isolate(entityId: SceneEntityIdV1): void
  showAll(): void
  beginDraft(entityId: SceneEntityIdV1, pose: ScenePoseV1): void
  updateDraft(pose: ScenePoseV1): void
  applyDraft(): Promise<void>
  cancelDraft(): void
}

export interface SceneEditorStoreOptions {
  readonly mutationService: Pick<ProjectMutationService, 'readPublished' | 'subscribe'>
  readonly setLocalPose: (entityId: SceneEntityIdV1, pose: ScenePoseV1) => Promise<void>
}

export type SceneEditorStore = StoreApi<SceneEditorState> & {
  readonly dispose: () => void
}

export function createSceneEditorStore(
  options: SceneEditorStoreOptions,
): SceneEditorStore {
  let generation = options.mutationService.readPublished()?.generation ?? 0
  const store = createStore<SceneEditorState>()((set, get) => ({
    selectedEntityId: null,
    isolatedEntityId: null,
    draftPose: null,
    select: (selectedEntityId) => set({ selectedEntityId }),
    isolate: (isolatedEntityId) => set({ isolatedEntityId }),
    showAll: () => set({ isolatedEntityId: null }),
    beginDraft: (entityId, pose) => set({
      draftPose: Object.freeze({ entityId, pose, generation }),
    }),
    updateDraft: (pose) => set((state) => state.draftPose === null
      ? state
      : { draftPose: Object.freeze({ ...state.draftPose, pose }) }),
    applyDraft: async () => {
      const draft = get().draftPose
      if (draft === null) return
      if (draft.generation !== generation) {
        set({ draftPose: null })
        return
      }
      await options.setLocalPose(draft.entityId, draft.pose)
      if (get().draftPose === draft) set({ draftPose: null })
    },
    cancelDraft: () => set({ draftPose: null }),
  }))
  const unsubscribe = options.mutationService.subscribe(() => {
    const nextGeneration = options.mutationService.readPublished()?.generation ?? 0
    if (nextGeneration === generation) return
    generation = nextGeneration
    store.setState({ draftPose: null })
  })
  return Object.assign(store, { dispose: unsubscribe })
}
