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
                onClick={() => {
                  void onRemove(record.id)
                }}
                type="button"
              >
                Delete
              </button>
            ) : null}
          </li>
        ))}
      </ul>
    </nav>
  )
}
