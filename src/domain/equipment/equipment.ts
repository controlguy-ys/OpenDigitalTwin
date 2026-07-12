export type EquipmentStatus = 'OFF' | 'RUNNING' | 'WARNING' | 'FAULT'
export type EquipmentStatusSource = 'manual' | 'opcua'

export interface SerializableTransform {
  position: [number, number, number]
  quaternion: [number, number, number, number]
  scale: [number, number, number]
}

export type EquipmentDetectedUnit =
  | 'millimeter'
  | 'meter'
  | 'inch'
  | 'unknown'
export type EquipmentSourceUnit = Exclude<EquipmentDetectedUnit, 'unknown'>
export type EquipmentOriginMode = 'center' | 'source'

export interface EquipmentImportMetadata {
  sourceFileName: string
  detectedUnit: EquipmentDetectedUnit
  selectedSourceUnit: EquipmentSourceUnit
  postImportScale: number
  originMode: EquipmentOriginMode
  colliderCenter: [number, number, number]
}

export interface EquipmentRecord {
  id: string
  name: string
  kind: 'cup' | 'machine' | 'imported'
  status: EquipmentStatus
  numericStatus?: number
  statusSource?: EquipmentStatusSource
  statusOverlayVisible?: boolean
  transform: SerializableTransform
  graspable: boolean
  collisionHalfExtents: [number, number, number]
  collisionCenter?: [number, number, number]
  stackLightAnchor: [number, number, number] | null
  /** Object Asset id for V1 Asset/Instance records. Legacy imports carry sourceBytes. */
  assetId?: string
  sourceBytes?: ArrayBuffer
  importMetadata?: EquipmentImportMetadata
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
const DETECTED_UNITS = new Set<EquipmentDetectedUnit>([
  'millimeter',
  'meter',
  'inch',
  'unknown',
])
const SOURCE_UNITS = new Set<EquipmentSourceUnit>([
  'millimeter',
  'meter',
  'inch',
])
const ORIGIN_MODES = new Set<EquipmentOriginMode>(['center', 'source'])
const UNIT_POST_SCALES: Record<EquipmentSourceUnit, number> = {
  millimeter: 0.001,
  meter: 1,
  inch: 0.0254,
}

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

function isPositiveFiniteTuple(value: unknown, length: number): value is number[] {
  return (
    isFiniteTuple(value, length) && value.every((entry) => entry > 0)
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

function isImportMetadata(value: unknown): value is EquipmentImportMetadata {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false
  }

  const metadata = value as Record<string, unknown>
  if (
    !isNonEmptyString(metadata.sourceFileName) ||
    typeof metadata.detectedUnit !== 'string' ||
    !DETECTED_UNITS.has(metadata.detectedUnit as EquipmentDetectedUnit) ||
    typeof metadata.selectedSourceUnit !== 'string' ||
    !SOURCE_UNITS.has(metadata.selectedSourceUnit as EquipmentSourceUnit) ||
    typeof metadata.postImportScale !== 'number' ||
    !Number.isFinite(metadata.postImportScale) ||
    metadata.postImportScale <= 0 ||
    typeof metadata.originMode !== 'string' ||
    !ORIGIN_MODES.has(metadata.originMode as EquipmentOriginMode) ||
    !isFiniteTuple(metadata.colliderCenter, 3)
  ) {
    return false
  }

  const detectedUnit = metadata.detectedUnit as EquipmentDetectedUnit
  const selectedSourceUnit = metadata.selectedSourceUnit as EquipmentSourceUnit
  if (detectedUnit === 'unknown') {
    return metadata.postImportScale === UNIT_POST_SCALES[selectedSourceUnit]
  }

  return detectedUnit === selectedSourceUnit && metadata.postImportScale === 1
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
    (record.numericStatus === undefined ||
      (typeof record.numericStatus === 'number' && Number.isFinite(record.numericStatus))) &&
    (record.statusSource === undefined ||
      record.statusSource === 'manual' ||
      record.statusSource === 'opcua') &&
    (record.statusOverlayVisible === undefined ||
      typeof record.statusOverlayVisible === 'boolean') &&
    isFiniteTuple(serializableTransform.position, 3) &&
    isFiniteTuple(serializableTransform.quaternion, 4) &&
    isFiniteTuple(serializableTransform.scale, 3) &&
    typeof record.graspable === 'boolean' &&
    isPositiveFiniteTuple(record.collisionHalfExtents, 3) &&
    (record.collisionCenter === undefined ||
      isFiniteTuple(record.collisionCenter, 3)) &&
    (record.stackLightAnchor === null ||
      isFiniteTuple(record.stackLightAnchor, 3)) &&
    (record.kind === 'imported'
      ? (isNonEmptyString(record.assetId) &&
          record.sourceBytes === undefined &&
          record.importMetadata === undefined) ||
        (record.assetId === undefined &&
          isArrayBuffer(record.sourceBytes) &&
          isImportMetadata(record.importMetadata))
      : record.assetId === undefined &&
        record.sourceBytes === undefined &&
        record.importMetadata === undefined)
  )
}
