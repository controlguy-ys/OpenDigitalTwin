import type {
  FrameIdV4,
  RigidTransformV4,
  RobotIdV4,
  SpatialEntityIdV4,
  WorkcellProjectV4,
} from '../../../core/project-v4/index.js'
import type { InteractionStoreStateV4 } from '../../interaction/v4/interaction-store.js'
import {
  type PersistedVisibilityTargetV4,
  type SceneSelectionTargetV4,
} from '../../interaction/v4/scene-selection.js'
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'
import { useStore } from 'zustand'
import type { StoreApi } from 'zustand/vanilla'
import type { SceneCommandServiceV4 } from './scene-command-service.js'
import type { SceneContextRequestV4 } from './scene-context-request.js'
import type { SceneRuntimeProjectionV4 } from './scene-runtime-selector.js'

export interface SceneContextMenuPropsV4 {
  readonly request: SceneContextRequestV4
  readonly project: WorkcellProjectV4
  readonly runtime: SceneRuntimeProjectionV4
  readonly interaction: StoreApi<InteractionStoreStateV4>
  readonly commands: SceneCommandServiceV4
  readonly defaultPlacementFrameId: FrameIdV4
  readonly onFitAll: () => void
  readonly onFocus: (selection: SceneSelectionTargetV4) => void
  readonly onOpenRobotBase: (robotId: RobotIdV4) => void
  readonly onOpenMovingFrame: (
    entityId: SpatialEntityIdV4,
    frameId: FrameIdV4,
  ) => void
  readonly onOpenCollision: (selection: SceneSelectionTargetV4) => void
  readonly onClose: () => void
}

const IDENTITY_POSE_V4: RigidTransformV4 = Object.freeze({
  positionM: Object.freeze([0, 0, 0]) as RigidTransformV4['positionM'],
  quaternion: Object.freeze([0, 0, 0, 1]) as RigidTransformV4['quaternion'],
})

type RobotV4 = WorkcellProjectV4['robots'][number]
type SpatialEntityV4 = WorkcellProjectV4['spatialEntities'][number]
type SceneGroupV4 = WorkcellProjectV4['sceneGroups'][number]
type SceneFrameV4 = WorkcellProjectV4['scene']['frames'][number]

type ResolvedContextTargetV4 =
  | { readonly kind: 'empty'; readonly selection: null }
  | { readonly kind: 'stale'; readonly selection: SceneSelectionTargetV4 }
  | {
      readonly kind: 'robot'
      readonly selection: Extract<SceneSelectionTargetV4, { kind: 'robot' }>
      readonly robot: RobotV4
    }
  | {
      readonly kind: 'robot-link'
      readonly selection: Extract<SceneSelectionTargetV4, { kind: 'robot-link' }>
      readonly robot: RobotV4
    }
  | {
      readonly kind: 'spatial-entity'
      readonly selection: Extract<SceneSelectionTargetV4, { kind: 'spatial-entity' }>
      readonly entity: SpatialEntityV4
    }
  | {
      readonly kind: 'scene-group'
      readonly selection: Extract<SceneSelectionTargetV4, { kind: 'scene-group' }>
      readonly group: SceneGroupV4
    }
  | {
      readonly kind: 'scene-frame'
      readonly selection: Extract<SceneSelectionTargetV4, { kind: 'scene-frame' }>
      readonly frame: SceneFrameV4
    }
  | {
      readonly kind: 'robot-frame'
      readonly selection: Extract<SceneSelectionTargetV4, { kind: 'robot-frame' }>
    }
  | {
      readonly kind: 'entity-frame'
      readonly selection: Extract<SceneSelectionTargetV4, { kind: 'entity-frame' }>
      readonly frameKind: 'grasp' | 'moving'
      readonly movingOwnership: string | null
    }

interface MenuActionV4 {
  readonly label: string
  readonly disabled?: boolean
  readonly perform: () => unknown | Promise<unknown>
}

function staleTargetV4(selection: SceneSelectionTargetV4): ResolvedContextTargetV4 {
  return { kind: 'stale', selection }
}

function resolveContextTargetV4(
  project: WorkcellProjectV4,
  runtime: SceneRuntimeProjectionV4,
  selection: SceneSelectionTargetV4 | null,
): ResolvedContextTargetV4 {
  if (selection === null) return { kind: 'empty', selection: null }
  if (runtime.projectRevisionId !== project.revisionId) return staleTargetV4(selection)

  switch (selection.kind) {
    case 'robot': {
      const robot = project.robots.find(({ id }) => id === selection.robotId)
      return robot === undefined
        ? staleTargetV4(selection)
        : {
            kind: 'robot',
            selection: { kind: 'robot', robotId: robot.id },
            robot,
          }
    }
    case 'robot-link': {
      const robot = project.robots.find(({ id }) => id === selection.robotId)
      const definition = robot === undefined
        ? undefined
        : project.robotDefinitions.find(({ id }) => id === robot.definitionId)
      const link = definition?.links.find(({ id }) => id === selection.linkId)
      return robot === undefined || link === undefined
        ? staleTargetV4(selection)
        : {
            kind: 'robot-link',
            selection: { kind: 'robot-link', robotId: robot.id, linkId: link.id },
            robot,
          }
    }
    case 'spatial-entity': {
      const entity = project.spatialEntities.find(({ id }) => id === selection.entityId)
      return entity === undefined
        ? staleTargetV4(selection)
        : {
            kind: 'spatial-entity',
            selection: { kind: 'spatial-entity', entityId: entity.id },
            entity,
          }
    }
    case 'scene-group': {
      const group = project.sceneGroups.find(({ id }) => id === selection.groupId)
      return group === undefined
        ? staleTargetV4(selection)
        : {
            kind: 'scene-group',
            selection: { kind: 'scene-group', groupId: group.id },
            group,
          }
    }
    case 'scene-frame': {
      const frame = project.scene.frames.find(({ id }) => id === selection.frameId)
      return frame === undefined
        ? staleTargetV4(selection)
        : {
            kind: 'scene-frame',
            selection: { kind: 'scene-frame', frameId: frame.id },
            frame,
          }
    }
    case 'robot-frame': {
      const robot = project.robots.find(({ id }) => id === selection.robotId)
      const definition = robot === undefined
        ? undefined
        : project.robotDefinitions.find(({ id }) => id === robot.definitionId)
      const frame = definition?.frames.find(({ id }) => id === selection.frameId)
      return robot === undefined || frame === undefined
        ? staleTargetV4(selection)
        : {
            kind: 'robot-frame',
            selection: { kind: 'robot-frame', robotId: robot.id, frameId: frame.id },
          }
    }
    case 'entity-frame': {
      const entity = project.spatialEntities.find(({ id }) => id === selection.entityId)
      const grasp = entity?.graspFrames.find(({ frameId }) => frameId === selection.frameId)
      if (entity !== undefined && grasp !== undefined) {
        return {
          kind: 'entity-frame',
          selection: {
            kind: 'entity-frame', entityId: entity.id, frameId: grasp.frameId,
          },
          frameKind: 'grasp',
          movingOwnership: null,
        }
      }
      const moving = entity?.movingFrames.find(({ frameId }) => frameId === selection.frameId)
      return entity === undefined || moving === undefined
        ? staleTargetV4(selection)
        : {
            kind: 'entity-frame',
            selection: {
              kind: 'entity-frame', entityId: entity.id, frameId: moving.frameId,
            },
            frameKind: 'moving',
            movingOwnership: moving.sourceOwnership,
          }
    }
  }
}

function errorMessageV4(error: unknown): string {
  return error instanceof Error ? error.message : 'The Scene action was rejected.'
}

function promptNameV4(currentName: string): string | null {
  const value = window.prompt('Name', currentName)
  if (value === null) return null
  const name = value.trim()
  if (name === '') throw new Error('Name must not be blank.')
  return name
}

function promptGroupV4(
  project: WorkcellProjectV4,
  message: string,
  currentGroupId: string | null,
  excludedGroupId: string | null,
): string | null | false {
  const value = window.prompt(message, currentGroupId ?? '')
  if (value === null) return false
  const groupId = value.trim()
  if (groupId === '') return null
  if (
    groupId === excludedGroupId
    || !project.sceneGroups.some(({ id }) => id === groupId)
  ) {
    throw new Error(`Scene Group ${groupId} is not an available target.`)
  }
  return groupId
}

function visibilityActionV4(
  commands: SceneCommandServiceV4,
  interaction: StoreApi<InteractionStoreStateV4>,
  target: PersistedVisibilityTargetV4,
  persistedVisible: boolean,
): () => Promise<void> {
  return async () => {
    await commands.setPersistedVisibility(target, !persistedVisible)
    if (persistedVisible) interaction.getState().clearSelectionForHidden(target)
  }
}

function menuActionsV4(
  target: ResolvedContextTargetV4,
  props: SceneContextMenuPropsV4,
  clipboard: RigidTransformV4 | null,
): readonly MenuActionV4[] {
  const {
    project,
    interaction,
    commands,
    defaultPlacementFrameId,
    onFitAll,
    onFocus,
    onOpenRobotBase,
    onOpenMovingFrame,
    onOpenCollision,
  } = props
  if (target.kind === 'stale') return []
  if (target.kind === 'empty') {
    return [
      {
        label: 'Create Group',
        perform: () => commands.createGroup('Group', null),
      },
      {
        label: 'Create Box',
        perform: () => commands.createBox({
          name: 'Box',
          parentFrameId: defaultPlacementFrameId,
          localPose: IDENTITY_POSE_V4,
          dimensionsM: [0.1, 0.1, 0.1],
          color: '#94A3B8',
          groupId: null,
        }),
      },
      {
        label: 'Create Cylinder',
        perform: () => commands.createCylinder({
          name: 'Cylinder',
          parentFrameId: defaultPlacementFrameId,
          localPose: IDENTITY_POSE_V4,
          radiusM: 0.05,
          heightM: 0.1,
          color: '#94A3B8',
          groupId: null,
        }),
      },
      { label: 'Fit All', perform: onFitAll },
      { label: 'Show All', perform: () => interaction.getState().showAll() },
    ]
  }

  const focus: MenuActionV4 = {
    label: target.kind === 'scene-group' ? 'Focus Children' : 'Focus',
    perform: () => onFocus(target.selection),
  }

  if (target.kind === 'robot') {
    const visibility = { kind: 'robot' as const, robotId: target.robot.id }
    const baseEdit = (localBasePose: RigidTransformV4) => commands.setRobotBase({
      robotId: target.robot.id,
      baseParentFrameId: target.robot.baseParentFrameId,
      localBasePose,
      intentionalMountEntityId: target.robot.intentionalMountEntityId,
    })
    return [
      focus,
      {
        label: 'Copy Base Pose',
        perform: () => interaction.getState().copyTransform(target.robot.localBasePose),
      },
      {
        label: 'Paste Base Pose',
        disabled: clipboard === null,
        perform: () => clipboard === null ? false : baseEdit(clipboard),
      },
      { label: 'Reset Base Pose', perform: () => baseEdit(IDENTITY_POSE_V4) },
      {
        label: target.robot.visible ? 'Hide' : 'Show',
        perform: visibilityActionV4(commands, interaction, visibility, target.robot.visible),
      },
      { label: 'Isolate', perform: () => interaction.getState().isolate(visibility) },
      {
        label: 'Edit Base and Mount',
        perform: () => onOpenRobotBase(target.robot.id),
      },
      { label: 'Open Collision', perform: () => onOpenCollision(target.selection) },
    ]
  }

  if (target.kind === 'robot-link') {
    const owner = { kind: 'robot' as const, robotId: target.robot.id }
    return [
      focus,
      {
        label: target.robot.visible ? 'Hide Robot' : 'Show Robot',
        perform: visibilityActionV4(commands, interaction, owner, target.robot.visible),
      },
      { label: 'Isolate Robot', perform: () => interaction.getState().isolate(owner) },
      { label: 'Open Collision', perform: () => onOpenCollision(target.selection) },
    ]
  }

  if (target.kind === 'spatial-entity') {
    const visibility = {
      kind: 'spatial-entity' as const,
      entityId: target.entity.id,
    }
    const manuallyEditable = target.entity.transformOwner === 'manual'
    const actions: MenuActionV4[] = [
      focus,
      {
        label: 'Rename',
        perform: () => {
          const name = promptNameV4(target.entity.name)
          return name === null
            ? false
            : commands.rename(visibility, name)
        },
      },
      {
        label: 'Copy Local Pose',
        perform: () => interaction.getState().copyTransform(target.entity.localPose),
      },
      {
        label: 'Paste Local Pose',
        disabled: clipboard === null || !manuallyEditable,
        perform: () => clipboard === null
          ? false
          : commands.setSpatialEntityLocalPose(target.entity.id, clipboard),
      },
      {
        label: 'Reset Local Pose',
        disabled: !manuallyEditable,
        perform: () => commands.setSpatialEntityLocalPose(
          target.entity.id,
          IDENTITY_POSE_V4,
        ),
      },
      {
        label: 'Move to Group',
        disabled: project.sceneGroups.length === 0,
        perform: () => {
          const groupId = promptGroupV4(
            project,
            'Target Scene Group ID',
            target.entity.groupId,
            null,
          )
          return groupId === false
            ? false
            : commands.setSpatialEntityGroup(target.entity.id, groupId)
        },
      },
    ]
    if (target.entity.groupId !== null) {
      actions.push({
        label: 'Clear Group',
        perform: () => commands.setSpatialEntityGroup(target.entity.id, null),
      })
    }
    actions.push(
      {
        label: target.entity.visible ? 'Hide' : 'Show',
        perform: visibilityActionV4(commands, interaction, visibility, target.entity.visible),
      },
      { label: 'Isolate', perform: () => interaction.getState().isolate(visibility) },
    )
    if (target.entity.removable) {
      actions.push({
        label: 'Delete',
        perform: () => commands.deleteSpatialEntity(target.entity.id),
      })
    }
    actions.push({
      label: 'Open Collision',
      perform: () => onOpenCollision(target.selection),
    })
    return actions
  }

  if (target.kind === 'scene-group') {
    const visibility = { kind: 'scene-group' as const, groupId: target.group.id }
    return [
      focus,
      {
        label: 'Rename',
        perform: () => {
          const name = promptNameV4(target.group.name)
          return name === null
            ? false
            : commands.rename(visibility, name)
        },
      },
      {
        label: 'Move Group',
        perform: () => {
          const parentGroupId = promptGroupV4(
            project,
            'Parent Scene Group ID (blank for root)',
            target.group.parentGroupId,
            target.group.id,
          )
          return parentGroupId === false
            ? false
            : commands.reparentGroup(target.group.id, parentGroupId)
        },
      },
      { label: 'Ungroup', perform: () => commands.ungroup(target.group.id) },
      {
        label: target.group.visible ? 'Hide' : 'Show',
        perform: visibilityActionV4(commands, interaction, visibility, target.group.visible),
      },
      { label: 'Isolate', perform: () => interaction.getState().isolate(visibility) },
      {
        label: 'Delete Group and Contents',
        perform: () => commands.deleteGroupAndContents(target.group.id),
      },
    ]
  }

  if (target.kind === 'scene-frame') {
    const actions: MenuActionV4[] = [
      focus,
      {
        label: 'Rename',
        perform: () => {
          const name = promptNameV4(target.frame.name)
          return name === null
            ? false
            : commands.rename({
                kind: 'scene-frame', frameId: target.frame.id,
              }, name)
        },
      },
    ]
    if (target.frame.role !== 'world') {
      actions.push({
        label: 'Edit Frame',
        perform: () => interaction.getState().select(target.selection),
      })
    }
    return actions
  }

  if (target.kind === 'robot-frame') {
    return [
      focus,
      {
        label: 'Open Coordinate Details',
        perform: () => interaction.getState().select(target.selection),
      },
    ]
  }

  const actions: MenuActionV4[] = [focus]
  if (target.frameKind === 'moving' && target.movingOwnership === 'manual') {
    actions.push({
      label: 'Edit Moving Frame',
      perform: () => onOpenMovingFrame(
        target.selection.entityId,
        target.selection.frameId,
      ),
    })
  }
  return actions
}

function enabledMenuItemsV4(menu: HTMLElement | null): readonly HTMLButtonElement[] {
  if (menu === null) return []
  return [...menu.querySelectorAll<HTMLButtonElement>(
    'button[role="menuitem"]:not(:disabled)',
  )]
}

export function SceneContextMenuV4(props: SceneContextMenuPropsV4): ReactNode {
  const { request, project, runtime, interaction, onClose } = props
  const clipboard = useStore(interaction, (state) => state.transformClipboard)
  const target = resolveContextTargetV4(project, runtime, request.selection)
  const actions = menuActionsV4(target, props, clipboard)
  const actionSignature = actions.map(({ label, disabled }) => (
    `${label}:${String(disabled === true)}`
  )).join('|')
  const menuRef = useRef<HTMLDivElement>(null)
  const activeRequestRef = useRef(request)
  const pendingActionTokenRef = useRef<symbol | null>(null)
  const returnFocusRef = useRef<HTMLElement | null>(
    typeof document === 'undefined' || !(document.activeElement instanceof HTMLElement)
      ? null
      : document.activeElement,
  )
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [position, setPosition] = useState(request.position)

  useLayoutEffect(() => {
    activeRequestRef.current = request
    pendingActionTokenRef.current = null
    setError(null)
    setPending(false)
  }, [request])

  useEffect(() => {
    if (pending) {
      menuRef.current?.focus()
      return
    }
    menuRef.current?.querySelector<HTMLButtonElement>(
      'button[role="menuitem"]:not(:disabled)',
    )?.focus()
  }, [pending, request])

  useEffect(() => {
    const applicationRoot = document.getElementById('root')
    const previousInert = applicationRoot?.inert ?? false
    if (applicationRoot !== null) applicationRoot.inert = true
    return () => {
      if (applicationRoot !== null) applicationRoot.inert = previousInert
      returnFocusRef.current?.focus()
    }
  }, [])

  const measurePosition = useCallback((): void => {
    const bounds = menuRef.current?.getBoundingClientRect()
    if (bounds === undefined) return
    const x = Math.max(0, Math.min(request.position.x, window.innerWidth - bounds.width))
    const y = Math.max(0, Math.min(request.position.y, window.innerHeight - bounds.height))
    setPosition((current) => current.x === x && current.y === y ? current : { x, y })
  }, [request.position.x, request.position.y])

  useLayoutEffect(() => {
    measurePosition()
  }, [actionSignature, error, measurePosition])

  useEffect(() => {
    window.addEventListener('resize', measurePosition)
    return () => window.removeEventListener('resize', measurePosition)
  }, [measurePosition])

  const runAction = (action: MenuActionV4): void => {
    if (pendingActionTokenRef.current !== null || action.disabled === true) return
    const actionRequest = request
    const token = Symbol(action.label)
    pendingActionTokenRef.current = token
    setPending(true)
    setError(null)
    void Promise.resolve()
      .then(action.perform)
      .then((result) => {
        if (
          pendingActionTokenRef.current === token
          && activeRequestRef.current === actionRequest
          && result !== false
        ) {
          onClose()
        }
      })
      .catch((caught: unknown) => {
        if (
          pendingActionTokenRef.current === token
          && activeRequestRef.current === actionRequest
        ) {
          setError(errorMessageV4(caught))
        }
      })
      .finally(() => {
        if (pendingActionTokenRef.current === token) {
          pendingActionTokenRef.current = null
          setPending(false)
        }
      })
  }

  const onMenuKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      onClose()
      return
    }
    const items = enabledMenuItemsV4(menuRef.current)
    if (items.length === 0) {
      if (event.key === 'Tab') {
        event.preventDefault()
        event.stopPropagation()
        menuRef.current?.focus()
      }
      return
    }
    const currentIndex = items.indexOf(document.activeElement as HTMLButtonElement)
    let nextIndex: number | null = null
    if (event.key === 'ArrowDown') nextIndex = (currentIndex + 1 + items.length) % items.length
    else if (event.key === 'ArrowUp') {
      nextIndex = (currentIndex - 1 + items.length) % items.length
    } else if (event.key === 'Home') nextIndex = 0
    else if (event.key === 'End') nextIndex = items.length - 1
    else if (event.key === 'Tab') {
      nextIndex = event.shiftKey
        ? (currentIndex - 1 + items.length) % items.length
        : (currentIndex + 1 + items.length) % items.length
    }
    if (nextIndex === null) return
    event.preventDefault()
    event.stopPropagation()
    items[nextIndex]?.focus()
  }

  const staleError = target.kind === 'stale'
    ? 'The requested Scene target is no longer available in this Project revision.'
    : null
  const overlay = (
    <div
      aria-label="Scene context actions"
      aria-modal="true"
      className="scene-modal-backdrop scene-context-backdrop-v4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
      role="dialog"
    >
      <div
        aria-label="Scene actions"
        className="scene-context-menu scene-context-menu-v4"
        onKeyDown={onMenuKeyDown}
        ref={menuRef}
        role="menu"
        style={{ left: position.x, top: position.y }}
        tabIndex={-1}
      >
        {actions.map((action) => (
          <button
            disabled={pending || action.disabled === true}
            key={action.label}
            onClick={() => runAction(action)}
            role="menuitem"
            tabIndex={-1}
            type="button"
          >
            {action.label}
          </button>
        ))}
        {staleError === null && error === null ? null : (
          <p role="alert">{error ?? staleError}</p>
        )}
      </div>
    </div>
  )

  return createPortal(overlay, document.body)
}
