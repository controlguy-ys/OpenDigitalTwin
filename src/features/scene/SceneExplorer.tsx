import { useState } from 'react'
import { useStore } from 'zustand'
import type { SceneEntityIdV1 } from '../../domain/project/scene-state-v1'
import {
  sceneCommandService,
  sceneEditorStore,
} from '../project/project-store-browser'
import type { SceneCommandService } from './scene-command-service'
import { SceneContextMenu } from './SceneContextMenu'
import {
  usePublishedSceneRuntime,
  type SceneRuntimeEntityV1,
  type SceneRuntimeProjectionV1,
} from './scene-runtime-selector'

export interface SceneExplorerProps {
  readonly runtime?: SceneRuntimeProjectionV1
  readonly selectedEntityId?: SceneEntityIdV1 | null
  readonly commands?: Pick<SceneCommandService, 'setVisible'>
  readonly onSelect?: (entityId: SceneEntityIdV1) => void
  readonly onIsolate?: (entityId: SceneEntityIdV1) => void
  readonly onShowAll?: () => void
  readonly onOpenRobotMechanics?: () => void
  readonly onOpenRobotGeometry?: () => void
  readonly onOpenRobotCollision?: () => void
}

function SceneTreeItem({
  entity,
  runtimeEntities,
  selectedEntityId,
  commands,
  onSelect,
  onContextMenu,
}: Readonly<{
  entity: SceneRuntimeEntityV1
  runtimeEntities: readonly SceneRuntimeEntityV1[]
  selectedEntityId: SceneEntityIdV1 | null
  commands: Pick<SceneCommandService, 'setVisible'>
  onSelect: (entityId: SceneEntityIdV1) => void
  onContextMenu: (entityId: SceneEntityIdV1) => void
}>) {
  const children = runtimeEntities.filter(({ parentId }) => parentId === entity.entityId)
  return (
    <li
      aria-expanded={children.length === 0 ? undefined : true}
      aria-label={entity.name}
      aria-selected={entity.entityId === selectedEntityId}
      onContextMenu={(event) => {
        event.preventDefault()
        onContextMenu(entity.entityId)
      }}
      role="treeitem"
    >
      <div className="scene-tree-row">
        <button
          aria-label={`Select ${entity.name}`}
          onClick={() => onSelect(entity.entityId)}
          type="button"
        >
          <span aria-hidden="true" className={`scene-kind scene-kind-${entity.kind}`} />
          <span>{entity.name}</span>
        </button>
        <button
          aria-label={`${entity.persistedVisible ? 'Hide' : 'Show'} ${entity.name}`}
          onClick={() => void commands.setVisible(entity.entityId, !entity.persistedVisible)}
          type="button"
        >
          {entity.persistedVisible ? 'Hide' : 'Show'}
        </button>
      </div>
      {children.length === 0 ? null : (
        <ul role="group">
          {children.map((child) => (
            <SceneTreeItem
              commands={commands}
              entity={child}
              key={child.entityId}
              onContextMenu={onContextMenu}
              onSelect={onSelect}
              runtimeEntities={runtimeEntities}
              selectedEntityId={selectedEntityId}
            />
          ))}
        </ul>
      )}
    </li>
  )
}

export function SceneExplorer({
  runtime: runtimeOverride,
  selectedEntityId: selectedOverride,
  commands = sceneCommandService,
  onSelect,
  onIsolate: _onIsolate,
  onShowAll,
  onOpenRobotMechanics,
  onOpenRobotGeometry,
  onOpenRobotCollision,
}: SceneExplorerProps) {
  const publishedRuntime = usePublishedSceneRuntime()
  const storeSelection = useStore(sceneEditorStore, (state) => state.selectedEntityId)
  const runtime = runtimeOverride ?? publishedRuntime
  const selectedEntityId = selectedOverride === undefined ? storeSelection : selectedOverride
  const select = onSelect ?? ((entityId: SceneEntityIdV1) => sceneEditorStore.getState().select(entityId))
  const showAll = onShowAll ?? (() => sceneEditorStore.getState().showAll())
  const isolate = _onIsolate ?? ((entityId: SceneEntityIdV1) => sceneEditorStore.getState().isolate(entityId))
  const [contextEntityId, setContextEntityId] = useState<SceneEntityIdV1 | null | undefined>(undefined)
  const roots = runtime.entities.filter(({ parentId }) => parentId === null)

  return (
    <section
      aria-label="Scene Explorer"
      className="scene-explorer"
      style={{ minHeight: 0, overflow: 'hidden' }}
    >
      <header>
        <h2>Scene Objects</h2>
        <button onClick={showAll} type="button">Show All</button>
      </header>
      <div
        className="scene-tree-scroll"
        data-testid="scene-tree-scroll"
        onContextMenu={(event) => {
          if (event.target === event.currentTarget) {
            event.preventDefault()
            setContextEntityId(null)
          }
        }}
        style={{ minHeight: 0, overflow: 'auto' }}
      >
        <ul aria-label="Scene Objects" role="tree">
          {roots.map((entity) => (
            <SceneTreeItem
              commands={commands}
              entity={entity}
              key={entity.entityId}
              onContextMenu={setContextEntityId}
              onSelect={select}
              runtimeEntities={runtime.entities}
              selectedEntityId={selectedEntityId}
            />
          ))}
        </ul>
      </div>
      {contextEntityId === undefined ? null : (
        <SceneContextMenu
          entityId={contextEntityId}
          onClose={() => setContextEntityId(undefined)}
          onIsolate={isolate}
          {...(onOpenRobotCollision === undefined ? {} : { onOpenRobotCollision })}
          {...(onOpenRobotGeometry === undefined ? {} : { onOpenRobotGeometry })}
          {...(onOpenRobotMechanics === undefined ? {} : { onOpenRobotMechanics })}
          runtime={runtime}
        />
      )}
    </section>
  )
}
