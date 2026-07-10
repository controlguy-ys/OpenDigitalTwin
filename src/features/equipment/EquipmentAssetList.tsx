import { useRef, useState } from 'react'
import type { EquipmentRecord } from '../../domain/equipment/equipment'

interface EquipmentAssetListProps {
  records: readonly EquipmentRecord[]
  selectedEquipmentId: string | null
  onSelect(id: string): void
  onRemove(id: string): Promise<void>
}

export function EquipmentAssetList({
  records,
  selectedEquipmentId,
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
    if (pendingRemovalIds.current.has(record.id)) {
      return
    }

    const pending = new Set(pendingRemovalIds.current)
    pending.add(record.id)
    pendingRemovalIds.current = pending
    setPendingSnapshot(pending)
    setRemovalErrors((current) => {
      if (!current.has(record.id)) {
        return current
      }
      const next = new Map(current)
      next.delete(record.id)
      return next
    })

    try {
      await onRemove(record.id)
    } catch {
      setRemovalErrors((current) => {
        const next = new Map(current)
        next.set(
          record.id,
          `Could not delete ${record.name}. Retry the operation.`,
        )
        return next
      })
    } finally {
      const nextPending = new Set(pendingRemovalIds.current)
      nextPending.delete(record.id)
      pendingRemovalIds.current = nextPending
      setPendingSnapshot(nextPending)
    }
  }

  return (
    <nav aria-label="Equipment assets" className="equipment-assets">
      <h2>Scene Assets</h2>
      <ul role="tree">
        {records.map((record) => (
          <li
            aria-label={record.name}
            aria-selected={record.id === selectedEquipmentId}
            key={record.id}
            role="treeitem"
          >
            <button
              aria-label={`Select ${record.name}`}
              className="equipment-select"
              onClick={() => onSelect(record.id)}
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
            {record.kind === 'imported' ? (
              <button
                aria-label={`Delete ${record.name}`}
                className="equipment-delete"
                disabled={pendingSnapshot.has(record.id)}
                onClick={() => {
                  void remove(record)
                }}
                type="button"
              >
                {pendingSnapshot.has(record.id) ? 'Deleting…' : 'Delete'}
              </button>
            ) : null}
            {removalErrors.has(record.id) ? (
              <p className="equipment-remove-error" role="alert">
                {removalErrors.get(record.id)}
              </p>
            ) : null}
          </li>
        ))}
      </ul>
    </nav>
  )
}
