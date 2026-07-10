export type EquipmentStatus = 'OFF' | 'RUNNING' | 'WARNING' | 'FAULT'

export interface SerializableTransform {
  position: [number, number, number]
  quaternion: [number, number, number, number]
  scale: [number, number, number]
}

export interface EquipmentRecord {
  id: string
  name: string
  kind: 'cup' | 'machine' | 'imported'
  status: EquipmentStatus
  transform: SerializableTransform
  graspable: boolean
  collisionHalfExtents: [number, number, number]
  stackLightAnchor: [number, number, number] | null
  sourceBytes?: ArrayBuffer
}

export interface StatusLightState {
  red: boolean
  yellow: boolean
  green: boolean
}

export const STATUS_LIGHTS = {
  OFF: { red: false, yellow: false, green: false },
  RUNNING: { red: false, yellow: false, green: true },
  WARNING: { red: false, yellow: true, green: false },
  FAULT: { red: true, yellow: false, green: false },
} as const satisfies Record<EquipmentStatus, StatusLightState>
