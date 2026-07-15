import { useEffect, useRef, useState } from 'react'
import type { SceneEntityIdV1, ScenePoseV1 } from '../../domain/project/scene-state-v1'
import { sceneCommandService } from '../project/project-store-browser'
import type { SceneCommandService } from './scene-command-service'
import {
  usePublishedSceneRuntime,
  type SceneRuntimeProjectionV1,
} from './scene-runtime-selector'
import type { SceneContextPosition } from './scene-context-request'

type ContextCommands = Pick<SceneCommandService,
  | 'createBox' | 'createCylinder' | 'createGroup'
  | 'duplicateObject' | 'rename' | 'reparent'
  | 'setLocalPose' | 'setTransformSource' | 'setVisible' | 'ungroup'>

type PendingAction =
  | 'delete-entity'
  | 'delete-group'
  | 'ungroup'
  | 'switch-transform-source'
  | 'choose-group'
  | null

export interface SceneContextMenuProps {
  readonly entityId: SceneEntityIdV1 | null
  readonly runtime?: SceneRuntimeProjectionV1
  readonly commands?: ContextCommands
  readonly onDelete: (entityId: SceneEntityIdV1) => void | Promise<void>
  readonly onIsolate: (entityId: SceneEntityIdV1) => void
  readonly onClose?: () => void
  readonly onOpenRobotMechanics?: () => void
  readonly onOpenRobotGeometry?: () => void
  readonly onOpenRobotCollision?: () => void
  readonly position?: SceneContextPosition
}

const IDENTITY_POSE: ScenePoseV1 = Object.freeze({
  positionM: [0, 0, 0] as const,
  quaternion: [0, 0, 0, 1] as const,
})

let transformClipboard: ScenePoseV1 | null = null

function MenuItem({ children, onClick }: Readonly<{
  children: string
  onClick: () => unknown | Promise<unknown>
}>) {
  return <button onClick={onClick} role="menuitem" tabIndex={-1} type="button">{children}</button>
}

function ConfirmationDialog({
  label,
  confirmLabel,
  onCancel,
  onConfirm,
}: Readonly<{
  label: string
  confirmLabel: string
  onCancel: () => void
  onConfirm: () => unknown | Promise<unknown>
}>) {
  const dialogRef = useRef<HTMLDivElement>(null)
  const returnFocusRef = useRef(
    document.activeElement instanceof HTMLElement ? document.activeElement : null,
  )
  const restoreFocusRef = useRef(true)

  useEffect(() => {
    dialogRef.current?.querySelector<HTMLElement>('button')?.focus()
    return () => {
      if (restoreFocusRef.current) returnFocusRef.current?.focus()
    }
  }, [])

  return (
    <div
      aria-label={label}
      aria-modal="true"
      className="scene-confirmation"
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault()
          onCancel()
          return
        }
        if (event.key !== 'Tab') return
        const buttons = [...(dialogRef.current?.querySelectorAll<HTMLElement>('button') ?? [])]
        if (buttons.length === 0) return
        const current = buttons.indexOf(document.activeElement as HTMLElement)
        const next = event.shiftKey
          ? (current <= 0 ? buttons.length - 1 : current - 1)
          : (current >= buttons.length - 1 ? 0 : current + 1)
        event.preventDefault()
        buttons[next]?.focus()
      }}
      ref={dialogRef}
      role="dialog"
    >
      <p>{label}</p>
      <div>
        <button onClick={onCancel} type="button">Cancel</button>
        <button onClick={() => {
          restoreFocusRef.current = false
          void onConfirm()
        }} type="button">{confirmLabel}</button>
      </div>
    </div>
  )
}

function GroupChoiceDialog({
  entityName,
  groups,
  onCancel,
  onChoose,
}: Readonly<{
  entityName: string
  groups: readonly Readonly<{ entityId: `group:${string}`; name: string }>[]
  onCancel: () => void
  onChoose: (groupId: `group:${string}`) => unknown | Promise<unknown>
}>) {
  const dialogRef = useRef<HTMLDivElement>(null)
  const returnFocusRef = useRef(
    document.activeElement instanceof HTMLElement ? document.activeElement : null,
  )
  const restoreFocusRef = useRef(true)

  useEffect(() => {
    dialogRef.current?.querySelector<HTMLElement>('button')?.focus()
    return () => {
      if (restoreFocusRef.current) returnFocusRef.current?.focus()
    }
  }, [])

  return (
    <div
      aria-label="Choose group"
      aria-modal="true"
      className="scene-confirmation"
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault()
          onCancel()
          return
        }
        if (event.key !== 'Tab') return
        const buttons = [...(dialogRef.current?.querySelectorAll<HTMLElement>('button') ?? [])]
        if (buttons.length === 0) return
        const current = buttons.indexOf(document.activeElement as HTMLElement)
        const next = event.shiftKey
          ? (current <= 0 ? buttons.length - 1 : current - 1)
          : (current >= buttons.length - 1 ? 0 : current + 1)
        event.preventDefault()
        buttons[next]?.focus()
      }}
      ref={dialogRef}
      role="dialog"
    >
      <p>Move {entityName} to:</p>
      {groups.map((group) => (
        <button
          key={group.entityId}
          onClick={() => {
            restoreFocusRef.current = false
            void onChoose(group.entityId)
          }}
          type="button"
        >
          Move to {group.name}
        </button>
      ))}
      <button onClick={onCancel} type="button">Cancel</button>
    </div>
  )
}

export function SceneContextMenu({
  entityId,
  runtime: runtimeOverride,
  commands = sceneCommandService,
  onDelete,
  onIsolate,
  onClose,
  onOpenRobotMechanics,
  onOpenRobotGeometry,
  onOpenRobotCollision,
  position = { x: 0, y: 0 },
}: SceneContextMenuProps) {
  const publishedRuntime = usePublishedSceneRuntime()
  const runtime = runtimeOverride ?? publishedRuntime
  const entity = entityId === null ? undefined : runtime.byId.get(entityId)
  const [pending, setPending] = useState<PendingAction>(null)
  const [error, setError] = useState<string | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const returnFocusRef = useRef(
    document.activeElement instanceof HTMLElement ? document.activeElement : null,
  )
  const groups = runtime.groups
    .filter(({ entityId: groupId }) => groupId !== entity?.parentId)
    .map((group) => ({
      entityId: group.entityId as `group:${string}`,
      name: group.name,
    }))
  const activeAxisCarriage =
    runtime.linearAxis?.source.kind === 'linear-axis' &&
    runtime.linearAxis.source.carriageEntityId === entityId

  const focusMenuItem = (index: number) => {
    const items = [...(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])]
    if (items.length === 0) return
    const bounded = Math.max(0, Math.min(index, items.length - 1))
    items.forEach((item, itemIndex) => {
      item.tabIndex = itemIndex === bounded ? 0 : -1
    })
    items[bounded]?.focus()
  }

  useEffect(() => {
    focusMenuItem(0)
  }, [entityId])

  const closeMenu = () => {
    onClose?.()
    returnFocusRef.current?.focus()
  }

  const run = async (action: () => unknown | Promise<unknown>) => {
    try {
      await action()
      setError(null)
      closeMenu()
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Scene command failed.')
    }
  }

  if (entityId !== null && entity === undefined) return null

  const rename = async () => {
    if (entity === undefined) return
    const name = window.prompt('Entity name', entity.name)
    if (name !== null && name.trim() !== '') await commands.rename(entity.entityId, name)
  }

  const moveToGroup = () => {
    if (entity?.source.kind !== 'object') return
    if (entity.source.transformSource === 'opcua') setPending('switch-transform-source')
    else setPending('choose-group')
  }

  const transformItems = entity === undefined || entity.kind === 'linear-axis' ? null : (
    <>
      <MenuItem onClick={() => {
        transformClipboard = {
          positionM: [...entity.localPose.positionM],
          quaternion: [...entity.localPose.quaternion],
        }
      }}>
        {entity.kind === 'robot' ? 'Copy Base Transform' : 'Copy Transform'}
      </MenuItem>
      {transformClipboard === null ? null : (
        <MenuItem onClick={() => run(() => commands.setLocalPose(entity.entityId, transformClipboard!))}>
          {entity.kind === 'robot' ? 'Paste Base Transform' : 'Paste Transform'}
        </MenuItem>
      )}
      <MenuItem onClick={() => run(() => commands.setLocalPose(entity.entityId, IDENTITY_POSE))}>
        {entity.kind === 'robot' ? 'Reset Base Transform' : 'Reset Transform'}
      </MenuItem>
    </>
  )

  return (
    <>
      <div
        aria-label={entity === undefined ? 'Empty viewport commands' : `${entity.name} commands`}
        className="scene-context-menu"
        onKeyDown={(event) => {
          const items = [...(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])]
          const current = items.indexOf(document.activeElement as HTMLElement)
          if (event.key === 'Escape') {
            event.preventDefault()
            closeMenu()
          } else if (event.key === 'ArrowDown') {
            event.preventDefault()
            focusMenuItem(current + 1 >= items.length ? 0 : current + 1)
          } else if (event.key === 'ArrowUp') {
            event.preventDefault()
            focusMenuItem(current <= 0 ? items.length - 1 : current - 1)
          } else if (event.key === 'Home') {
            event.preventDefault()
            focusMenuItem(0)
          } else if (event.key === 'End') {
            event.preventDefault()
            focusMenuItem(items.length - 1)
          }
        }}
        ref={menuRef}
        role="menu"
        style={{ left: position.x, top: position.y }}
      >
        {entity === undefined ? (
          <>
            <MenuItem onClick={() => run(() => commands.createGroup('Group'))}>Create Group</MenuItem>
            <MenuItem onClick={() => run(() => commands.createBox({
              name: 'Box', dimensionsM: [0.1, 0.1, 0.1], color: '#94A3B8',
            }))}>Create Box</MenuItem>
            <MenuItem onClick={() => run(() => commands.createCylinder({
              name: 'Cylinder', radiusM: 0.05, heightM: 0.1, color: '#94A3B8',
            }))}>Create Cylinder</MenuItem>
          </>
        ) : (
          <>
            {entity.kind === 'robot' || entity.kind === 'linear-axis' ? null : (
              <MenuItem onClick={() => run(rename)}>Rename</MenuItem>
            )}
            {entity.kind === 'linear-axis' ? <MenuItem onClick={() => run(rename)}>Rename</MenuItem> : null}
            {entity.source.kind === 'object' && entity.source.target.kind === 'object-instance' ? (
              <MenuItem onClick={() => run(() => commands.duplicateObject(entity.entityId))}>Duplicate</MenuItem>
            ) : null}
            {transformItems}
            {entity.kind === 'object' && groups.length > 0 && !activeAxisCarriage ? (
              <MenuItem onClick={moveToGroup}>Move to group</MenuItem>
            ) : null}
            {entity.source.kind === 'group' && !activeAxisCarriage ? (
              <MenuItem onClick={() => {
                const hasChildren = runtime.entities.some(({ parentId }) => parentId === entity.entityId)
                if (hasChildren) setPending('ungroup')
                else void run(() => commands.ungroup(entity.source.id as `group:${string}`))
              }}>Ungroup</MenuItem>
            ) : null}
            <MenuItem onClick={() => run(() => commands.setVisible(
              entity.entityId,
              !entity.persistedVisible,
            ))}>{entity.persistedVisible ? 'Hide' : 'Show'}</MenuItem>
            <MenuItem onClick={() => { onIsolate(entity.entityId); closeMenu() }}>Isolate</MenuItem>
            {entity.source.kind === 'object' && !activeAxisCarriage ? (
              <MenuItem onClick={() => setPending('delete-entity')}>Delete</MenuItem>
            ) : null}
            {entity.source.kind === 'group' && !activeAxisCarriage ? (
              <MenuItem onClick={() => setPending('delete-group')}>Delete Group and Contents</MenuItem>
            ) : null}
            {entity.kind === 'robot' && onOpenRobotMechanics !== undefined ? (
              <MenuItem onClick={() => {
                onClose?.()
                onOpenRobotMechanics()
              }}>Open Mechanics</MenuItem>
            ) : null}
            {entity.kind === 'robot' && onOpenRobotGeometry !== undefined ? (
              <MenuItem onClick={() => {
                onClose?.()
                onOpenRobotGeometry()
              }}>Open Geometry</MenuItem>
            ) : null}
            {entity.kind === 'robot' && onOpenRobotCollision !== undefined ? (
              <MenuItem onClick={() => {
                onClose?.()
                onOpenRobotCollision()
              }}>Open Collision</MenuItem>
            ) : null}
          </>
        )}
        {error === null ? null : <p role="alert">{error}</p>}
      </div>
      {pending === 'delete-entity' && entity?.source.kind === 'object' ? (
        <ConfirmationDialog
          confirmLabel="Delete Entity"
          label="Delete Entity?"
          onCancel={() => setPending(null)}
          onConfirm={async () => {
            await run(() => onDelete(entity.entityId))
            setPending(null)
          }}
        />
      ) : null}
      {pending === 'delete-group' && entity?.source.kind === 'group' ? (
        <ConfirmationDialog
          confirmLabel="Delete Group and Contents"
          label="Delete Group and Contents?"
          onCancel={() => setPending(null)}
          onConfirm={async () => {
            await run(() => onDelete(entity.entityId))
            setPending(null)
          }}
        />
      ) : null}
      {pending === 'ungroup' && entity?.source.kind === 'group' ? (
        <ConfirmationDialog
          confirmLabel="Ungroup Children"
          label="Ungroup with children?"
          onCancel={() => setPending(null)}
          onConfirm={async () => {
            await run(() => commands.ungroup(entity.source.id as `group:${string}`))
            setPending(null)
          }}
        />
      ) : null}
      {pending === 'switch-transform-source' && entity?.source.kind === 'object' ? (
        <ConfirmationDialog
          confirmLabel="Switch to Manual"
          label="Switch transform source?"
          onCancel={() => setPending(null)}
          onConfirm={async () => {
            try {
              await commands.setTransformSource(
                entity.source.id as `object:${string}` | `equipment:${string}`,
                'manual',
              )
              setError(null)
              setPending('choose-group')
            } catch (nextError) {
              setError(nextError instanceof Error ? nextError.message : 'Ownership update failed.')
              setPending(null)
            }
          }}
        />
      ) : null}
      {pending === 'choose-group' && entity?.source.kind === 'object' ? (
        <GroupChoiceDialog
          entityName={entity.name}
          groups={groups}
          onCancel={() => setPending(null)}
          onChoose={async (groupId) => {
            await run(() => commands.reparent(entity.entityId, groupId))
            setPending(null)
          }}
        />
      ) : null}
    </>
  )
}
