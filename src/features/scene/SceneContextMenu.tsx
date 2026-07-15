import { useState } from 'react'
import type { SceneEntityIdV1, ScenePoseV1 } from '../../domain/project/scene-state-v1'
import { sceneCommandService } from '../project/project-store-browser'
import type { SceneCommandService } from './scene-command-service'
import {
  usePublishedSceneRuntime,
  type SceneRuntimeProjectionV1,
} from './scene-runtime-selector'

type ContextCommands = Pick<SceneCommandService,
  | 'createBox' | 'createCylinder' | 'createGroup' | 'deleteEntity'
  | 'deleteGroupAndContents' | 'duplicateObject' | 'rename' | 'reparent'
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
  readonly onIsolate: (entityId: SceneEntityIdV1) => void
  readonly onClose?: () => void
  readonly onOpenRobotMechanics?: () => void
  readonly onOpenRobotGeometry?: () => void
  readonly onOpenRobotCollision?: () => void
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
  return <button onClick={onClick} role="menuitem" type="button">{children}</button>
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
  return (
    <div aria-label={label} aria-modal="true" className="scene-confirmation" role="dialog">
      <p>{label}</p>
      <div>
        <button onClick={onCancel} type="button">Cancel</button>
        <button onClick={onConfirm} type="button">{confirmLabel}</button>
      </div>
    </div>
  )
}

export function SceneContextMenu({
  entityId,
  runtime: runtimeOverride,
  commands = sceneCommandService,
  onIsolate,
  onClose,
  onOpenRobotMechanics,
  onOpenRobotGeometry,
  onOpenRobotCollision,
}: SceneContextMenuProps) {
  const publishedRuntime = usePublishedSceneRuntime()
  const runtime = runtimeOverride ?? publishedRuntime
  const entity = entityId === null ? undefined : runtime.byId.get(entityId)
  const [pending, setPending] = useState<PendingAction>(null)
  const [error, setError] = useState<string | null>(null)
  const groups = runtime.groups.filter(({ entityId: groupId }) => groupId !== entity?.parentId)

  const run = async (action: () => unknown | Promise<unknown>) => {
    try {
      await action()
      setError(null)
      onClose?.()
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
      <div aria-label={entity === undefined ? 'Empty viewport commands' : `${entity.name} commands`} className="scene-context-menu" role="menu">
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
            {entity.kind === 'object' && groups.length > 0 ? (
              <MenuItem onClick={moveToGroup}>Move to group</MenuItem>
            ) : null}
            {entity.source.kind === 'group' ? (
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
            <MenuItem onClick={() => { onIsolate(entity.entityId); onClose?.() }}>Isolate</MenuItem>
            {entity.source.kind === 'object' ? (
              <MenuItem onClick={() => setPending('delete-entity')}>Delete</MenuItem>
            ) : null}
            {entity.source.kind === 'group' ? (
              <MenuItem onClick={() => setPending('delete-group')}>Delete Group and Contents</MenuItem>
            ) : null}
            {entity.kind === 'robot' && onOpenRobotMechanics !== undefined ? (
              <MenuItem onClick={onOpenRobotMechanics}>Open Mechanics</MenuItem>
            ) : null}
            {entity.kind === 'robot' && onOpenRobotGeometry !== undefined ? (
              <MenuItem onClick={onOpenRobotGeometry}>Open Geometry</MenuItem>
            ) : null}
            {entity.kind === 'robot' && onOpenRobotCollision !== undefined ? (
              <MenuItem onClick={onOpenRobotCollision}>Open Collision</MenuItem>
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
            await run(() => commands.deleteEntity(entity.entityId))
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
            await run(() => commands.deleteGroupAndContents(
              entity.source.id as `group:${string}`,
              true,
            ))
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
        <div aria-label="Choose group" aria-modal="true" className="scene-confirmation" role="dialog">
          <p>Move {entity.name} to:</p>
          {groups.map((group) => (
            <button
              key={group.entityId}
              onClick={async () => {
                await run(() => commands.reparent(entity.entityId, group.entityId))
                setPending(null)
              }}
              type="button"
            >
              Move to {group.name}
            </button>
          ))}
          <button onClick={() => setPending(null)} type="button">Cancel</button>
        </div>
      ) : null}
    </>
  )
}
