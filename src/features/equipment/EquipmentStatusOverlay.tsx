import { Html } from '@react-three/drei/web/Html.js'
import type { EquipmentRecord } from '../../domain/equipment/equipment'

export function EquipmentStatusOverlay({ record }: { record: EquipmentRecord }) {
  if (!(record.statusOverlayVisible ?? true)) {
    return null
  }
  const center = record.collisionCenter ?? record.importMetadata?.colliderCenter ?? [0, 0, 0]

  return (
    <Html
      center
      position={[
        center[0],
        center[1],
        center[2] + record.collisionHalfExtents[2] + 0.06,
      ]}
      zIndexRange={[40, 0]}
    >
      <output
        aria-label={`${record.name} numeric status`}
        className="equipment-status-overlay"
      >
        <strong>{record.numericStatus ?? 0}</strong>
      </output>
    </Html>
  )
}
