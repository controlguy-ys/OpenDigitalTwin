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

const EQUIPMENT_KINDS = new Set<EquipmentRecord['kind']>([
  'cup',
  'machine',
  'imported',
])
const EQUIPMENT_STATUSES = new Set<EquipmentStatus>([
  'OFF',
  'RUNNING',
  'WARNING',
  'FAULT',
])

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function isFiniteTuple(value: unknown, length: number): value is number[] {
  return (
    Array.isArray(value) &&
    value.length === length &&
    value.every((entry) => typeof entry === 'number' && Number.isFinite(entry))
  )
}

function isArrayBuffer(value: unknown): value is ArrayBuffer {
  if (
    typeof value !== 'object' ||
    value === null ||
    ArrayBuffer.isView(value)
  ) {
    return false
  }

  const candidate = value as { byteLength?: unknown; slice?: unknown }
  return (
    Object.prototype.toString.call(value) === '[object ArrayBuffer]' &&
    typeof candidate.byteLength === 'number' &&
    Number.isFinite(candidate.byteLength) &&
    typeof candidate.slice === 'function'
  )
}

export function isEquipmentRecord(value: unknown): value is EquipmentRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false
  }

  const record = value as Record<string, unknown>
  const transform = record.transform
  if (
    typeof transform !== 'object' ||
    transform === null ||
    Array.isArray(transform)
  ) {
    return false
  }

  const serializableTransform = transform as Record<string, unknown>
  return (
    isNonEmptyString(record.id) &&
    isNonEmptyString(record.name) &&
    typeof record.kind === 'string' &&
    EQUIPMENT_KINDS.has(record.kind as EquipmentRecord['kind']) &&
    typeof record.status === 'string' &&
    EQUIPMENT_STATUSES.has(record.status as EquipmentStatus) &&
    isFiniteTuple(serializableTransform.position, 3) &&
    isFiniteTuple(serializableTransform.quaternion, 4) &&
    isFiniteTuple(serializableTransform.scale, 3) &&
    typeof record.graspable === 'boolean' &&
    isFiniteTuple(record.collisionHalfExtents, 3) &&
    (record.stackLightAnchor === null ||
      isFiniteTuple(record.stackLightAnchor, 3)) &&
    (record.sourceBytes === undefined || isArrayBuffer(record.sourceBytes))
  )
}
