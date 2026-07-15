import { useEffect, useMemo, useState, type KeyboardEvent } from 'react'
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
import type { SceneContextRequest } from './scene-context-request'

export interface SceneExplorerProps {
  readonly runtime?: SceneRuntimeProjectionV1
  readonly selectedEntityId?: SceneEntityIdV1 | null
  readonly commands?: Pick<SceneCommandService, 'setVisible'>
  readonly onSelect?: (entityId: SceneEntityIdV1) => void
  readonly onDelete: (entityId: SceneEntityIdV1) => void | Promise<void>
  readonly onIsolate?: (entityId: SceneEntityIdV1) => void
  readonly onShowAll?: () => void
  readonly onOpenRobotMechanics?: () => void
  readonly onOpenRobotGeometry?: () => void
  readonly onOpenRobotCollision?: () => void
}

function orderedTreeEntities(
  entities: readonly SceneRuntimeEntityV1[],
): readonly SceneRuntimeEntityV1[] {
  const childrenByParent = new Map<SceneEntityIdV1 | null, SceneRuntimeEntityV1[]>()
  for (const entity of entities) {
    const siblings = childrenByParent.get(entity.parentId) ?? []
    siblings.push(entity)
    childrenByParent.set(entity.parentId, siblings)
  }
  const ordered: SceneRuntimeEntityV1[] = []
  const visit = (parentId: SceneEntityIdV1 | null) => {
    for (const entity of childrenByParent.get(parentId) ?? []) {
      ordered.push(entity)
      visit(entity.entityId)
    }
  }
  visit(null)
  return ordered
}

function SceneTreeItem({
  entity,
  runtimeEntities,
  selectedEntityId,
  commands,
  onSelect,
  onContextMenu,
  focusedEntityId,
  onFocus,
  onKeyDown,
  onVisibilityError,
}: Readonly<{
  entity: SceneRuntimeEntityV1
  runtimeEntities: readonly SceneRuntimeEntityV1[]
  selectedEntityId: SceneEntityIdV1 | null
  commands: Pick<SceneCommandService, 'setVisible'>
  onSelect: (entityId: SceneEntityIdV1) => void
  onContextMenu: (request: SceneContextRequest) => void
  focusedEntityId: SceneEntityIdV1 | null
  onFocus: (entityId: SceneEntityIdV1) => void
  onKeyDown: (entityId: SceneEntityIdV1, event: KeyboardEvent<HTMLLIElement>) => void
  onVisibilityError: (error: unknown) => void
}>) {
  const children = runtimeEntities.filter(({ parentId }) => parentId === entity.entityId)
  return (
    <li
      aria-expanded={children.length === 0 ? undefined : true}
      aria-label={entity.name}
      aria-selected={entity.entityId === selectedEntityId}
      data-scene-entity-id={entity.entityId}
      onFocus={(event) => {
        if (event.target === event.currentTarget) {
          onFocus(entity.entityId)
        }
      }}
      onKeyDown={(event) => {
        if (event.target === event.currentTarget) {
          onKeyDown(entity.entityId, event)
        }
      }}
      onContextMenu={(event) => {
        event.preventDefault()
        event.stopPropagation()
        onContextMenu({
          entityId: entity.entityId,
          position: { x: event.clientX, y: event.clientY },
        })
      }}
      role="treeitem"
      tabIndex={entity.entityId === focusedEntityId ? 0 : -1}
    >
      <div className="scene-tree-row">
        <button
          aria-label={`Select ${entity.name}`}
          onClick={() => onSelect(entity.entityId)}
          tabIndex={-1}
          type="button"
        >
          <span aria-hidden="true" className={`scene-kind scene-kind-${entity.kind}`} />
          <span>{entity.name}</span>
        </button>
        <button
          aria-label={`${entity.persistedVisible ? 'Hide' : 'Show'} ${entity.name}`}
          onClick={() => {
            void commands.setVisible(entity.entityId, !entity.persistedVisible)
              .catch(onVisibilityError)
          }}
          tabIndex={-1}
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
              focusedEntityId={focusedEntityId}
              onFocus={onFocus}
              onKeyDown={onKeyDown}
              onContextMenu={onContextMenu}
              onSelect={onSelect}
              runtimeEntities={runtimeEntities}
              selectedEntityId={selectedEntityId}
              onVisibilityError={onVisibilityError}
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
  onDelete,
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
  const orderedEntities = useMemo(
    () => orderedTreeEntities(runtime.entities),
    [runtime.entities],
  )
  const [focusedEntityId, setFocusedEntityId] = useState<SceneEntityIdV1 | null>(
    selectedEntityId ?? orderedEntities[0]?.entityId ?? null,
  )
  const [contextRequest, setContextRequest] = useState<SceneContextRequest | undefined>(undefined)
  const [error, setError] = useState<string | null>(null)
  const roots = runtime.entities.filter(({ parentId }) => parentId === null)
  const focusEntity = (entityId: SceneEntityIdV1) => {
    setFocusedEntityId(entityId)
    document.querySelector<HTMLElement>(
      `[data-scene-entity-id="${entityId}"]`,
    )?.focus()
  }

  useEffect(() => {
    if (focusedEntityId !== null && runtime.byId.has(focusedEntityId)) return
    const fallback = selectedEntityId !== null && runtime.byId.has(selectedEntityId)
      ? selectedEntityId
      : orderedEntities[0]?.entityId ?? null
    if (fallback === null) {
      setFocusedEntityId(null)
      return
    }
    const shouldRestoreDomFocus = document.activeElement === document.body
    setFocusedEntityId(fallback)
    if (shouldRestoreDomFocus) {
      document.querySelector<HTMLElement>(
        `[data-scene-entity-id="${fallback}"]`,
      )?.focus()
    }
  }, [focusedEntityId, orderedEntities, runtime.byId, selectedEntityId])

  const handleTreeKeyDown = (
    entityId: SceneEntityIdV1,
    event: KeyboardEvent<HTMLLIElement>,
  ) => {
    const index = orderedEntities.findIndex((entity) => entity.entityId === entityId)
    const entity = runtime.byId.get(entityId)
    let target: SceneEntityIdV1 | undefined
    if (event.key.toLowerCase() === 'v') {
      if (event.ctrlKey || event.altKey || event.metaKey) return
      event.preventDefault()
      if (entity !== undefined) {
        void commands.setVisible(entityId, !entity.persistedVisible)
          .catch((nextError) => setError(
            nextError instanceof Error ? nextError.message : 'Visibility update failed.',
          ))
      }
      return
    } else if (event.key === 'ContextMenu' || (event.key === 'F10' && event.shiftKey)) {
      event.preventDefault()
      const bounds = event.currentTarget.getBoundingClientRect()
      setContextRequest({
        entityId,
        position: { x: bounds.left, y: bounds.bottom },
      })
      return
    } else if (event.key === 'ArrowDown') target = orderedEntities[index + 1]?.entityId
    else if (event.key === 'ArrowUp') target = orderedEntities[index - 1]?.entityId
    else if (event.key === 'Home') target = orderedEntities[0]?.entityId
    else if (event.key === 'End') target = orderedEntities.at(-1)?.entityId
    else if (event.key === 'ArrowRight') {
      target = runtime.entities.find(({ parentId }) => parentId === entityId)?.entityId
    } else if (event.key === 'ArrowLeft') target = entity?.parentId ?? undefined
    else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      select(entityId)
      return
    } else return
    event.preventDefault()
    if (target !== undefined) focusEntity(target)
  }

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
            setContextRequest({
              entityId: null,
              position: { x: event.clientX, y: event.clientY },
            })
          }
        }}
        style={{ minHeight: 0, overflow: 'auto' }}
      >
        <ul aria-label="Scene Objects" role="tree">
          {roots.map((entity) => (
            <SceneTreeItem
              commands={commands}
              entity={entity}
              focusedEntityId={focusedEntityId}
              key={entity.entityId}
              onContextMenu={setContextRequest}
              onFocus={setFocusedEntityId}
              onKeyDown={handleTreeKeyDown}
              onSelect={select}
              onVisibilityError={(nextError) => setError(
                nextError instanceof Error ? nextError.message : 'Visibility update failed.',
              )}
              runtimeEntities={runtime.entities}
              selectedEntityId={selectedEntityId}
            />
          ))}
        </ul>
        {error === null ? null : <p role="alert">{error}</p>}
      </div>
      {contextRequest === undefined ? null : (
        <SceneContextMenu
          entityId={contextRequest.entityId}
          onDelete={onDelete}
          onClose={() => setContextRequest(undefined)}
          onIsolate={isolate}
          position={contextRequest.position}
          {...(onOpenRobotCollision === undefined ? {} : { onOpenRobotCollision })}
          {...(onOpenRobotGeometry === undefined ? {} : { onOpenRobotGeometry })}
          {...(onOpenRobotMechanics === undefined ? {} : { onOpenRobotMechanics })}
          runtime={runtime}
        />
      )}
    </section>
  )
}
