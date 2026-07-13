import { useRef, useState } from 'react'
import type { EquipmentRecord } from '../../domain/equipment/equipment'
import type { ExternalCollisionEntityId } from '../interaction/interaction-store'
import { equipmentRecordEntityId } from './equipment-entity-selection'

interface EquipmentAssetListProps {
  records: readonly EquipmentRecord[]
  selectedEntityId: ExternalCollisionEntityId | null
  onSelect(id: ExternalCollisionEntityId): void
  onRemove(id: ExternalCollisionEntityId): Promise<void>
}

export function EquipmentAssetList({
  records,
  selectedEntityId,
  onSelect,
  onRemove,
}: EquipmentAssetListProps) {
  const pendingRemovalIds = useRef(new Set<string>())
  const [pendingSnapshot, setPendingSnapshot] = useState<ReadonlySet<string>>(
    () => new Set(),
  )
  const [removalErrors, setRemovalErrors] = useState<
    ReadonlyMap<string, string>
  >(() => new Map())

  const remove = async (record: EquipmentRecord) => {
    const entityId = equipmentRecordEntityId(record)
    if (pendingRemovalIds.current.has(entityId)) {
      return
    }

    const pending = new Set(pendingRemovalIds.current)
    pending.add(entityId)
    pendingRemovalIds.current = pending
    setPendingSnapshot(pending)
    setRemovalErrors((current) => {
      if (!current.has(entityId)) {
        return current
      }
      const next = new Map(current)
      next.delete(entityId)
      return next
    })

    try {
      await onRemove(entityId)
    } catch {
      setRemovalErrors((current) => {
        const next = new Map(current)
        next.set(
          entityId,
          `Could not delete ${record.name}. Retry the operation.`,
        )
        return next
      })
    } finally {
      const nextPending = new Set(pendingRemovalIds.current)
      nextPending.delete(entityId)
      pendingRemovalIds.current = nextPending
      setPendingSnapshot(nextPending)
    }
  }

  return (
    <nav aria-label="Equipment assets" className="equipment-assets">
      <h2>Scene Assets</h2>
      <ul role="tree">
        {records.map((record) => {
          const entityId = equipmentRecordEntityId(record)
          return (
            <li
              aria-label={record.name}
              aria-selected={entityId === selectedEntityId}
              key={entityId}
              role="treeitem"
            >
              <button
                aria-label={`Select ${record.name}`}
                className="equipment-select"
                onClick={() => onSelect(entityId)}
                type="button"
              >
                <span
                  aria-hidden="true"
                  className="equipment-status-dot"
                  data-status={record.status}
                />
                <span>{record.name}</span>
                <small>{record.kind}</small>
              </button>
              <button
                aria-label={`Delete ${record.name}`}
                className="equipment-delete"
                disabled={pendingSnapshot.has(entityId)}
                onClick={() => {
                  void remove(record)
                }}
                type="button"
              >
                {pendingSnapshot.has(entityId) ? 'Deleting…' : 'Delete'}
              </button>
              {removalErrors.has(entityId) ? (
                <p className="equipment-remove-error" role="alert">
                  {removalErrors.get(entityId)}
                </p>
              ) : null}
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
