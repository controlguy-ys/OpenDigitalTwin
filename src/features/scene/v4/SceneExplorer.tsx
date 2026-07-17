import type {
  WorkcellProjectV4,
} from '../../../core/project-v4/index.js'
import type { InteractionStoreStateV4 } from '../../interaction/v4/interaction-store.js'
import {
  sameSceneSelectionV4,
  sceneSelectionKeyV4,
  type PersistedVisibilityTargetV4,
  type SceneSelectionTargetV4,
} from '../../interaction/v4/scene-selection.js'
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from 'react'
import { useStore } from 'zustand'
import type { StoreApi } from 'zustand/vanilla'
import type { SceneCommandServiceV4 } from './scene-command-service.js'
import type { SceneContextRequestV4 } from './scene-context-request.js'
import type { SceneRuntimeProjectionV4 } from './scene-runtime-selector.js'

export interface SceneExplorerPropsV4 {
  readonly project: WorkcellProjectV4
  readonly runtime: SceneRuntimeProjectionV4
  readonly interaction: StoreApi<InteractionStoreStateV4>
  readonly commands: SceneCommandServiceV4
  readonly onContextRequest: (request: SceneContextRequestV4) => void
  readonly onFocus: (selection: SceneSelectionTargetV4) => void
}

interface SceneTreeNodeV4 {
  readonly key: string
  readonly label: string
  readonly selection: SceneSelectionTargetV4
  readonly children: readonly SceneTreeNodeV4[]
  readonly visibilityTarget: PersistedVisibilityTargetV4 | null
  readonly persistedVisible: boolean | null
  readonly effectiveVisible: boolean
}

interface SceneTreeCategoryV4 {
  readonly label: string
  readonly nodes: readonly SceneTreeNodeV4[]
}

interface FlattenedSceneTreeV4 {
  readonly rows: readonly SceneTreeNodeV4[]
  readonly byKey: ReadonlyMap<string, SceneTreeNodeV4>
  readonly parentKeyByKey: ReadonlyMap<string, string | null>
  readonly expandableKeys: ReadonlySet<string>
}

function treeNodeV4(
  label: string,
  selection: SceneSelectionTargetV4,
  children: readonly SceneTreeNodeV4[],
  effectiveVisible: boolean,
  visibility?: {
    readonly target: PersistedVisibilityTargetV4
    readonly persistedVisible: boolean
  },
): SceneTreeNodeV4 {
  return {
    key: sceneSelectionKeyV4(selection),
    label,
    selection,
    children,
    visibilityTarget: visibility?.target ?? null,
    persistedVisible: visibility?.persistedVisible ?? null,
    effectiveVisible,
  }
}

function entityNodeV4(
  project: WorkcellProjectV4,
  runtime: SceneRuntimeProjectionV4,
  entityId: string,
): SceneTreeNodeV4 {
  const entity = project.spatialEntities.find(({ id }) => id === entityId)!
  const effectiveVisible = runtime.entities.get(entity.id)?.effectiveVisible ?? false
  const children = [
    ...entity.graspFrames.map((frame) => treeNodeV4(
      `${entity.name} / ${frame.name}`,
      { kind: 'entity-frame', entityId: entity.id, frameId: frame.frameId },
      [],
      runtime.globalFrames.get(frame.frameId)?.effectiveVisible ?? false,
    )),
    ...entity.movingFrames.map((frame) => treeNodeV4(
      `${entity.name} / ${frame.name}`,
      { kind: 'entity-frame', entityId: entity.id, frameId: frame.frameId },
      [],
      runtime.globalFrames.get(frame.frameId)?.effectiveVisible ?? false,
    )),
  ]
  const selection = { kind: 'spatial-entity' as const, entityId: entity.id }
  return treeNodeV4(entity.name, selection, children, effectiveVisible, {
    target: selection,
    persistedVisible: entity.visible,
  })
}

function sceneTreeCategoriesV4(
  project: WorkcellProjectV4,
  runtime: SceneRuntimeProjectionV4,
): readonly SceneTreeCategoryV4[] {
  const frameNodes = project.scene.frames.map((frame) => treeNodeV4(
    frame.name,
    { kind: 'scene-frame', frameId: frame.id },
    [],
    runtime.globalFrames.get(frame.id)?.effectiveVisible ?? false,
  ))

  const definitionsById = new Map(
    project.robotDefinitions.map((definition) => [definition.id, definition]),
  )
  const robotNodes = project.robots.map((robot) => {
    const definition = definitionsById.get(robot.definitionId)!
    const children = [
      ...definition.links.map((link) => treeNodeV4(
        `${robot.name} / ${link.name}`,
        { kind: 'robot-link', robotId: robot.id, linkId: link.id },
        [],
        runtime.entities.get(robot.id)?.effectiveVisible ?? false,
      )),
      ...definition.frames.map((frame) => treeNodeV4(
        `${robot.name} / ${frame.name}`,
        { kind: 'robot-frame', robotId: robot.id, frameId: frame.id },
        [],
        runtime.entities.get(robot.id)?.effectiveVisible ?? false,
      )),
    ]
    const selection = { kind: 'robot' as const, robotId: robot.id }
    return treeNodeV4(
      robot.name,
      selection,
      children,
      runtime.entities.get(robot.id)?.effectiveVisible ?? false,
      { target: selection, persistedVisible: robot.visible },
    )
  })

  const groupChildrenByParent = new Map<string | null, string[]>()
  for (const group of project.sceneGroups) {
    const children = groupChildrenByParent.get(group.parentGroupId) ?? []
    children.push(group.id)
    groupChildrenByParent.set(group.parentGroupId, children)
  }
  const entityIdsByGroup = new Map<string | null, string[]>()
  for (const entity of project.spatialEntities) {
    const siblings = entityIdsByGroup.get(entity.groupId) ?? []
    siblings.push(entity.id)
    entityIdsByGroup.set(entity.groupId, siblings)
  }
  const groupById = new Map(project.sceneGroups.map((group) => [group.id, group]))
  const visitGroup = (groupId: string): SceneTreeNodeV4 => {
    const group = groupById.get(groupId)!
    const children = [
      ...(groupChildrenByParent.get(group.id) ?? []).map(visitGroup),
      ...(entityIdsByGroup.get(group.id) ?? []).map((entityId) => (
        entityNodeV4(project, runtime, entityId)
      )),
    ]
    const selection = { kind: 'scene-group' as const, groupId: group.id }
    return treeNodeV4(
      group.name,
      selection,
      children,
      runtime.groups.get(group.id)?.effectiveVisible ?? false,
      { target: selection, persistedVisible: group.visible },
    )
  }
  const objectNodes = [
    ...(groupChildrenByParent.get(null) ?? []).map(visitGroup),
    ...(entityIdsByGroup.get(null) ?? []).map((entityId) => (
      entityNodeV4(project, runtime, entityId)
    )),
  ]

  return [
    { label: 'Scene Frames', nodes: frameNodes },
    { label: 'Robots', nodes: robotNodes },
    { label: 'Scene Objects', nodes: objectNodes },
  ]
}

function flattenTreeFactsV4(
  categories: readonly SceneTreeCategoryV4[],
  expandedKeys: ReadonlySet<string>,
): FlattenedSceneTreeV4 {
  const rows: SceneTreeNodeV4[] = []
  const byKey = new Map<string, SceneTreeNodeV4>()
  const parentKeyByKey = new Map<string, string | null>()
  const expandableKeys = new Set<string>()
  const visit = (node: SceneTreeNodeV4, parentKey: string | null): void => {
    byKey.set(node.key, node)
    parentKeyByKey.set(node.key, parentKey)
    if (node.children.length > 0) expandableKeys.add(node.key)
    rows.push(node)
    if (expandedKeys.has(node.key)) {
      for (const child of node.children) visit(child, node.key)
    } else {
      const indexDescendants = (candidate: SceneTreeNodeV4, ownerKey: string): void => {
        byKey.set(candidate.key, candidate)
        parentKeyByKey.set(candidate.key, ownerKey)
        if (candidate.children.length > 0) expandableKeys.add(candidate.key)
        for (const child of candidate.children) indexDescendants(child, candidate.key)
      }
      for (const child of node.children) indexDescendants(child, node.key)
    }
  }
  for (const category of categories) {
    for (const node of category.nodes) visit(node, null)
  }
  return { rows, byKey, parentKeyByKey, expandableKeys }
}

function allExpandableKeysV4(categories: readonly SceneTreeCategoryV4[]): ReadonlySet<string> {
  const keys = new Set<string>()
  const visit = (node: SceneTreeNodeV4): void => {
    if (node.children.length > 0) keys.add(node.key)
    for (const child of node.children) visit(child)
  }
  for (const category of categories) {
    for (const node of category.nodes) visit(node)
  }
  return keys
}

function errorMessageV4(error: unknown): string {
  return error instanceof Error ? error.message : 'The Scene command was rejected.'
}

function persistedVisibilityV4(
  project: WorkcellProjectV4,
  target: PersistedVisibilityTargetV4,
): boolean | null {
  switch (target.kind) {
    case 'robot':
      return project.robots.find(({ id }) => id === target.robotId)?.visible ?? null
    case 'spatial-entity':
      return project.spatialEntities.find(({ id }) => id === target.entityId)?.visible ?? null
    case 'scene-group':
      return project.sceneGroups.find(({ id }) => id === target.groupId)?.visible ?? null
  }
}

export function SceneExplorerV4({
  project,
  runtime,
  interaction,
  commands,
  onContextRequest,
  onFocus,
}: SceneExplorerPropsV4): ReactNode {
  const selection = useStore(interaction, (state) => state.selection)
  const categories = useMemo(
    () => sceneTreeCategoriesV4(project, runtime),
    [project, runtime],
  )
  const expandableKeys = useMemo(() => allExpandableKeysV4(categories), [categories])
  const knownExpandableKeys = useRef(expandableKeys)
  const [expandedKeys, setExpandedKeys] = useState<ReadonlySet<string>>(() => (
    new Set(expandableKeys)
  ))
  const facts = useMemo(
    () => flattenTreeFactsV4(categories, expandedKeys),
    [categories, expandedKeys],
  )
  const selectedKey = selection === null ? null : sceneSelectionKeyV4(selection)
  const [focusedKey, setFocusedKey] = useState<string | null>(() => (
    selectedKey !== null && facts.byKey.has(selectedKey)
      ? selectedKey
      : facts.rows[0]?.key ?? null
  ))
  const rowRefs = useRef(new Map<string, HTMLElement>())
  const activeProjectRef = useRef(project)
  const pendingVisibilityTokensRef = useRef(new Map<string, symbol>())
  const [pendingVisibilityKeys, setPendingVisibilityKeys] = useState<ReadonlySet<string>>(
    () => new Set(),
  )
  const [error, setError] = useState<string | null>(null)

  useLayoutEffect(() => {
    activeProjectRef.current = project
  }, [project])

  useEffect(() => {
    setError(null)
  }, [project.revisionId])

  useEffect(() => {
    setExpandedKeys((current) => {
      const next = new Set([...current].filter((key) => expandableKeys.has(key)))
      for (const key of expandableKeys) {
        if (!knownExpandableKeys.current.has(key)) next.add(key)
      }
      knownExpandableKeys.current = expandableKeys
      return next
    })
  }, [expandableKeys])

  useEffect(() => {
    if (focusedKey !== null && facts.rows.some(({ key }) => key === focusedKey)) return
    const fallback = selectedKey !== null && facts.rows.some(({ key }) => key === selectedKey)
      ? selectedKey
      : facts.rows[0]?.key ?? null
    setFocusedKey(fallback)
  }, [facts.rows, focusedKey, selectedKey])

  const focusRow = (key: string): void => {
    setFocusedKey(key)
    rowRefs.current.get(key)?.focus()
  }

  const updateExpanded = (key: string, expanded: boolean): void => {
    setExpandedKeys((current) => {
      const next = new Set(current)
      if (expanded) next.add(key)
      else next.delete(key)
      return next
    })
  }

  const requestContext = (
    node: SceneTreeNodeV4,
    position: SceneContextRequestV4['position'],
  ): void => {
    setError(null)
    try {
      interaction.getState().select(node.selection)
      onContextRequest({ selection: node.selection, position })
    } catch (caught) {
      setError(errorMessageV4(caught))
    }
  }

  const toggleVisibility = (node: SceneTreeNodeV4): void => {
    if (
      node.visibilityTarget === null
      || node.persistedVisible === null
      || pendingVisibilityTokensRef.current.has(node.key)
    ) return
    const target = node.visibilityTarget
    const hiding = node.persistedVisible
    const requestedVisible = !node.persistedVisible
    const invocationRevisionId = project.revisionId
    const token = Symbol(node.key)
    pendingVisibilityTokensRef.current.set(node.key, token)
    setPendingVisibilityKeys((current) => new Set(current).add(node.key))
    setError(null)
    void Promise.resolve()
      .then(() => commands.setPersistedVisibility(target, requestedVisible))
      .then(() => {
        if (pendingVisibilityTokensRef.current.get(node.key) !== token) return
        const activeProject = activeProjectRef.current
        const committedInActiveProject = (
          activeProject.revisionId === invocationRevisionId
          || persistedVisibilityV4(activeProject, target) === requestedVisible
        )
        if (hiding && committedInActiveProject) {
          interaction.getState().clearSelectionForHidden(target)
        }
      })
      .catch((caught: unknown) => {
        if (
          pendingVisibilityTokensRef.current.get(node.key) === token
          && activeProjectRef.current.revisionId === invocationRevisionId
        ) {
          setError(errorMessageV4(caught))
        }
      })
      .finally(() => {
        if (pendingVisibilityTokensRef.current.get(node.key) !== token) return
        pendingVisibilityTokensRef.current.delete(node.key)
        setPendingVisibilityKeys((current) => {
          const next = new Set(current)
          next.delete(node.key)
          return next
        })
      })
  }

  const onRowKeyDown = (node: SceneTreeNodeV4, event: KeyboardEvent<HTMLLIElement>): void => {
    if (event.target !== event.currentTarget) return
    const index = facts.rows.findIndex(({ key }) => key === node.key)
    let targetKey: string | undefined
    if (event.key === 'ArrowDown') targetKey = facts.rows[index + 1]?.key
    else if (event.key === 'ArrowUp') targetKey = facts.rows[index - 1]?.key
    else if (event.key === 'Home') targetKey = facts.rows[0]?.key
    else if (event.key === 'End') targetKey = facts.rows.at(-1)?.key
    else if (event.key === 'ArrowRight') {
      if (node.children.length === 0) return
      if (!expandedKeys.has(node.key)) {
        event.preventDefault()
        updateExpanded(node.key, true)
        return
      }
      targetKey = node.children[0]?.key
    } else if (event.key === 'ArrowLeft') {
      if (node.children.length > 0 && expandedKeys.has(node.key)) {
        event.preventDefault()
        updateExpanded(node.key, false)
        return
      }
      targetKey = facts.parentKeyByKey.get(node.key) ?? undefined
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      setError(null)
      try {
        interaction.getState().select(node.selection)
      } catch (caught) {
        setError(errorMessageV4(caught))
      }
      return
    } else if (event.key === 'ContextMenu' || (event.key === 'F10' && event.shiftKey)) {
      event.preventDefault()
      const bounds = event.currentTarget.getBoundingClientRect()
      requestContext(node, { x: bounds.left, y: bounds.bottom })
      return
    } else return

    event.preventDefault()
    if (targetKey !== undefined) focusRow(targetKey)
  }

  const renderNode = (node: SceneTreeNodeV4): ReactNode => {
    const selected = sameSceneSelectionV4(selection, node.selection)
    const hasChildren = node.children.length > 0
    const expanded = hasChildren && expandedKeys.has(node.key)
    return (
      <li
        aria-expanded={hasChildren ? expanded : undefined}
        aria-label={node.label}
        aria-selected={selected}
        data-effective-visible={String(node.effectiveVisible)}
        data-scene-selection-key={node.key}
        key={node.key}
        onContextMenu={(event) => {
          event.preventDefault()
          event.stopPropagation()
          requestContext(node, { x: event.clientX, y: event.clientY })
        }}
        onDoubleClick={(event) => {
          if (event.target instanceof HTMLButtonElement && event.target.dataset.visibility === 'true') {
            return
          }
          onFocus(node.selection)
        }}
        onFocus={(event) => {
          if (event.target === event.currentTarget) setFocusedKey(node.key)
        }}
        onKeyDown={(event) => onRowKeyDown(node, event)}
        ref={(element) => {
          if (element === null) rowRefs.current.delete(node.key)
          else rowRefs.current.set(node.key, element)
        }}
        role="treeitem"
        tabIndex={focusedKey === node.key ? 0 : -1}
      >
        <div className="scene-tree-row">
          <button
            aria-label={node.label}
            onClick={() => {
              focusRow(node.key)
              setError(null)
              try {
                interaction.getState().select(node.selection)
              } catch (caught) {
                setError(errorMessageV4(caught))
              }
            }}
            tabIndex={-1}
            type="button"
          >
            {node.label}
          </button>
          {node.visibilityTarget === null || node.persistedVisible === null ? null : (
            <button
              aria-label={`${node.persistedVisible ? 'Hide' : 'Show'} ${node.label}`}
              data-visibility="true"
              disabled={pendingVisibilityKeys.has(node.key)}
              onClick={(event) => {
                event.stopPropagation()
                toggleVisibility(node)
              }}
              tabIndex={-1}
              type="button"
            >
              {node.persistedVisible ? 'Hide' : 'Show'}
            </button>
          )}
        </div>
        {!expanded ? null : (
          <ul role="group">{node.children.map(renderNode)}</ul>
        )}
      </li>
    )
  }

  return (
    <section
      aria-label="Scene Explorer"
      className="scene-explorer scene-explorer-v4"
      style={{ minHeight: 0, overflow: 'hidden' }}
    >
      <header><h2>Scene Explorer</h2></header>
      <div
        className="scene-tree-scroll"
        data-testid="scene-tree-scroll"
        onContextMenu={(event) => {
          if (event.target !== event.currentTarget) return
          event.preventDefault()
          onContextRequest({
            selection: null,
            position: { x: event.clientX, y: event.clientY },
          })
        }}
        style={{ minHeight: 0, overflow: 'auto' }}
      >
        <div aria-label="Scene Objects" role="tree">
          {categories.map((category) => (
            <section key={category.label} role="presentation">
              <h3>{category.label}</h3>
              <ul role="group">{category.nodes.map(renderNode)}</ul>
            </section>
          ))}
        </div>
        {error === null ? null : <p role="alert">{error}</p>}
      </div>
    </section>
  )
}
