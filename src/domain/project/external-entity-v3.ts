import type {
  EquipmentStatus,
  EquipmentStatusSource,
  SerializableTransform,
} from '../equipment/equipment'

export type ExternalEntityId = `equipment:${string}` | `object:${string}`
export type TransformSource = 'manual' | 'opcua'

export interface ProjectExternalEntityTransformStateV3 {
  readonly entityId: ExternalEntityId
  readonly manualTransform: SerializableTransform
  readonly transformSource: TransformSource
}

export interface ProjectBuiltInEquipmentRecordV3 {
  readonly id: string
  readonly name: string
  readonly kind: 'cup' | 'machine'
  readonly status: EquipmentStatus
  readonly manualNumericStatus: number
  readonly statusSource: EquipmentStatusSource
  readonly statusOverlayVisible: boolean
  readonly graspable: boolean
  readonly collisionHalfExtents: readonly [number, number, number]
  readonly collisionCenter?: readonly [number, number, number]
  readonly stackLightAnchor: readonly [number, number, number] | null
}
