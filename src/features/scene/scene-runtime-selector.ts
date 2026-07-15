import type { WorkcellProjectSnapshotV3 } from '../../domain/project/project-v3'
import type {
  SceneEntityIdV1,
  SceneEntityV1,
  ScenePoseV1,
} from '../../domain/project/scene-state-v1'
import { worldPoseForEntity } from '../../domain/scene/scene-transform'
import { useSyncExternalStore } from 'react'
import {
  projectMutationService,
  sceneEditorStore,
} from '../project/project-store-browser'

export interface SceneRuntimeEditorProjectionV1 {
  readonly isolatedEntityId: SceneEntityIdV1 | null
  readonly draftPose?: Readonly<{
    readonly entityId: SceneEntityIdV1
    readonly pose: ScenePoseV1
  }> | null
}

export interface SceneRuntimeEntityV1 {
  readonly entityId: SceneEntityIdV1
  readonly kind: SceneEntityV1['kind']
  readonly name: string
  readonly parentId: SceneEntityIdV1 | null
  readonly localPose: ScenePoseV1
  readonly worldPose: ScenePoseV1
  readonly persistedVisible: boolean
  readonly effectiveVisible: boolean
  readonly source: SceneEntityV1
}

export interface SceneRuntimeProjectionV1 {
  readonly entities: readonly SceneRuntimeEntityV1[]
  readonly byId: ReadonlyMap<SceneEntityIdV1, SceneRuntimeEntityV1>
  readonly robot: SceneRuntimeEntityV1 | null
  readonly objects: readonly SceneRuntimeEntityV1[]
  readonly groups: readonly SceneRuntimeEntityV1[]
  readonly linearAxis: SceneRuntimeEntityV1 | null
}

function ancestors(
  byId: ReadonlyMap<SceneEntityIdV1, SceneEntityV1>,
  entity: SceneEntityV1,
): readonly SceneEntityV1[] {
  const result: SceneEntityV1[] = []
  let parentId = entity.parentId
  while (parentId !== null) {
    const parent = byId.get(parentId)
    if (parent === undefined) break
    result.push(parent)
    parentId = parent.parentId
  }
  return result
}

function isolateAllows(
  byId: ReadonlyMap<SceneEntityIdV1, SceneEntityV1>,
  entity: SceneEntityV1,
  isolatedEntityId: SceneEntityIdV1 | null,
): boolean {
  if (isolatedEntityId === null || entity.id === isolatedEntityId) return true
  const entityAncestors = ancestors(byId, entity)
  if (entityAncestors.some(({ id }) => id === isolatedEntityId)) return true
  const isolated = byId.get(isolatedEntityId)
  return isolated !== undefined && ancestors(byId, isolated).some(({ id }) => id === entity.id)
}

export function selectSceneRuntime(
  snapshot: WorkcellProjectSnapshotV3,
  editor: SceneRuntimeEditorProjectionV1,
): SceneRuntimeProjectionV1 {
  const projectedScene = editor.draftPose === null || editor.draftPose === undefined
    ? snapshot.scene
    : {
        ...snapshot.scene,
        entities: snapshot.scene.entities.map((entity) =>
          entity.id === editor.draftPose?.entityId
            ? { ...entity, localPose: editor.draftPose.pose } as SceneEntityV1
            : entity),
      }
  const sceneEntities = new Map(projectedScene.entities.map((entity) => [entity.id, entity]))
  const entities = projectedScene.entities.map((entity): SceneRuntimeEntityV1 => {
    const hierarchyVisible = entity.visible && ancestors(sceneEntities, entity)
      .every((ancestor) => ancestor.visible)
    return Object.freeze({
      entityId: entity.id,
      kind: entity.kind,
      name: entity.name,
      parentId: entity.parentId,
      localPose: entity.localPose,
      worldPose: worldPoseForEntity(projectedScene, entity.id),
      persistedVisible: entity.visible,
      effectiveVisible: hierarchyVisible && isolateAllows(
        sceneEntities,
        entity,
        editor.isolatedEntityId,
      ),
      source: entity,
    })
  })
  const byId = new Map(entities.map((entity) => [entity.entityId, entity]))
  const robot = entities.find(({ kind }) => kind === 'robot') ?? null
  const linearAxis = entities.find(({ kind }) => kind === 'linear-axis') ?? null
  return Object.freeze({
    entities: Object.freeze(entities),
    byId,
    robot,
    objects: Object.freeze(entities.filter(({ kind }) => kind === 'object')),
    groups: Object.freeze(entities.filter(({ kind }) => kind === 'group')),
    linearAxis,
  })
}

const EMPTY_RUNTIME: SceneRuntimeProjectionV1 = Object.freeze({
  entities: Object.freeze([]),
  byId: new Map(),
  robot: null,
  objects: Object.freeze([]),
  groups: Object.freeze([]),
  linearAxis: null,
})

let cachedSnapshot: WorkcellProjectSnapshotV3 | null = null
let cachedIsolation: SceneEntityIdV1 | null = null
let cachedDraft: ReturnType<typeof sceneEditorStore.getState>['draftPose'] = null
let cachedRuntime = EMPTY_RUNTIME

function publishedSceneRuntimeSnapshot(): SceneRuntimeProjectionV1 {
  const snapshot = projectMutationService.readPublished()?.snapshot ?? null
  const editor = sceneEditorStore.getState()
  const isolatedEntityId = editor.isolatedEntityId
  const draftPose = editor.draftPose
  if (snapshot === null) return EMPTY_RUNTIME
  if (
    snapshot === cachedSnapshot &&
    isolatedEntityId === cachedIsolation &&
    draftPose === cachedDraft
  ) return cachedRuntime
  cachedSnapshot = snapshot
  cachedIsolation = isolatedEntityId
  cachedDraft = draftPose
  cachedRuntime = selectSceneRuntime(snapshot, { isolatedEntityId, draftPose })
  return cachedRuntime
}

function subscribePublishedSceneRuntime(listener: () => void): () => void {
  const unsubscribeProject = projectMutationService.subscribe(listener)
  const unsubscribeEditor = sceneEditorStore.subscribe(listener)
  return () => {
    unsubscribeEditor()
    unsubscribeProject()
  }
}

export function usePublishedSceneRuntime(): SceneRuntimeProjectionV1 {
  return useSyncExternalStore(
    subscribePublishedSceneRuntime,
    publishedSceneRuntimeSnapshot,
    publishedSceneRuntimeSnapshot,
  )
}
