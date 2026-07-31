import type { ReactNode } from 'react'

import type { WorkcellProjectV5 } from '../../../core/project-v5/index.js'
import type { V6WorkcellSelection } from '../../interaction/v6/workcell-selection-v6.js'

export type SceneContextActionIdV6 =
  | 'focus' | 'translate-base' | 'rotate-base' | 'translate' | 'rotate'
  | 'toggle-visibility' | 'duplicate' | 'open-binding' | 'rename' | 'delete'
  | 'add-box' | 'add-cylinder' | 'fit-all'

export interface SceneContextActionV6 { readonly id: SceneContextActionIdV6; readonly label: string }

export type SceneContextTargetV6 =
  | { readonly kind: 'robot'; readonly id: string; readonly selection: V6WorkcellSelection }
  | { readonly kind: 'object'; readonly id: string; readonly removable: boolean; readonly selection: V6WorkcellSelection }
  | { readonly kind: 'group'; readonly id: string; readonly empty: boolean; readonly selection: V6WorkcellSelection }
  | { readonly kind: 'frame'; readonly id: string; readonly selection: V6WorkcellSelection }
  | { readonly kind: 'empty' }

const ACTIONS: Readonly<Record<SceneContextActionIdV6, SceneContextActionV6>> = {
  focus: { id: 'focus', label: 'Focus' },
  'translate-base': { id: 'translate-base', label: 'Translate Base' },
  'rotate-base': { id: 'rotate-base', label: 'Rotate Base' },
  translate: { id: 'translate', label: 'Translate' },
  rotate: { id: 'rotate', label: 'Rotate' },
  'toggle-visibility': { id: 'toggle-visibility', label: 'Show/Hide' },
  duplicate: { id: 'duplicate', label: 'Duplicate' },
  'open-binding': { id: 'open-binding', label: 'Open Binding' },
  rename: { id: 'rename', label: 'Rename' },
  delete: { id: 'delete', label: 'Delete' },
  'add-box': { id: 'add-box', label: 'Add Box' },
  'add-cylinder': { id: 'add-cylinder', label: 'Add Cylinder' },
  'fit-all': { id: 'fit-all', label: 'Fit All' },
}

function requireTarget<T>(value: T | undefined, selection: V6WorkcellSelection): T {
  if (value === undefined) throw new Error(`The selected ${selection.kind} no longer exists in this Project V5 revision.`)
  return value
}

export function resolveSceneContextTargetV6(
  project: WorkcellProjectV5,
  selection: V6WorkcellSelection | null,
): SceneContextTargetV6 {
  if (selection === null) return { kind: 'empty' }
  if (selection.kind === 'robot') {
    requireTarget(project.robots.find(({ id }) => id === selection.id), selection)
    return { kind: 'robot', id: selection.id, selection }
  }
  if (selection.kind === 'entity') {
    const entity = requireTarget(project.spatialEntities.find(({ id }) => id === selection.id), selection)
    return { kind: 'object', id: entity.id, removable: entity.removable, selection }
  }
  if (selection.kind === 'group') {
    requireTarget(project.sceneGroups.find(({ id }) => id === selection.id), selection)
    const descendants = new Set<string>([selection.id])
    let changed = true
    while (changed) {
      changed = false
      for (const group of project.sceneGroups) if (group.parentGroupId !== null && descendants.has(group.parentGroupId) && !descendants.has(group.id)) {
        descendants.add(group.id); changed = true
      }
    }
    return { kind: 'group', id: selection.id, empty: !project.sceneGroups.some((group) => group.parentGroupId === selection.id) && !project.spatialEntities.some((entity) => entity.groupId !== null && descendants.has(entity.groupId)), selection }
  }
  requireTarget(project.scene.frames.find(({ id }) => id === selection.id), selection)
  return { kind: 'frame', id: selection.id, selection }
}

export function sceneContextActionsForTargetV6(target: SceneContextTargetV6): readonly SceneContextActionV6[] {
  switch (target.kind) {
    case 'robot': return [ACTIONS.focus, ACTIONS['translate-base'], ACTIONS['rotate-base'], ACTIONS['toggle-visibility'], ACTIONS['open-binding'], ACTIONS.rename]
    case 'object': return [ACTIONS.focus, ACTIONS.translate, ACTIONS.rotate, ACTIONS['toggle-visibility'], ACTIONS.duplicate, ACTIONS['open-binding'], ACTIONS.rename, ...(target.removable ? [ACTIONS.delete] : [])]
    case 'group': return [ACTIONS['toggle-visibility'], ACTIONS.rename, ...(target.empty ? [ACTIONS.delete] : [])]
    case 'frame': return [ACTIONS.focus]
    case 'empty': return [ACTIONS['add-box'], ACTIONS['add-cylinder'], ACTIONS['fit-all']]
  }
}

export interface SceneContextMenuV6Props {
  readonly target: SceneContextTargetV6
  readonly surface: 'explorer' | 'viewport'
  readonly onAction: (action: SceneContextActionIdV6, target: SceneContextTargetV6) => void
}

export function SceneContextMenuV6({ target, surface, onAction }: SceneContextMenuV6Props): ReactNode {
  return <div aria-label="Scene actions" className="v6-scene-context-menu" data-surface={surface} role="menu">
    {sceneContextActionsForTargetV6(target).map((action) => <button
      data-action-id={action.id}
      key={action.id}
      onClick={() => onAction(action.id, target)}
      role="menuitem"
      type="button"
    >{action.label}</button>)}
  </div>
}
