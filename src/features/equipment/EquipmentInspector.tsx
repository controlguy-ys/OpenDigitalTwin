import { Euler, MathUtils, Quaternion } from 'three'
import { useEffect, useState } from 'react'
import type {
  EquipmentRecord,
  SerializableTransform,
} from '../../domain/equipment/equipment'
import type { ExternalCollisionEntityId } from '../interaction/interaction-store'
import { equipmentRecordEntityId } from './equipment-entity-selection'
import { EquipmentStatusEditor } from './EquipmentStatusEditor'

interface EquipmentInspectorProps {
  record: EquipmentRecord
  disabled?: boolean
  onPreview(id: ExternalCollisionEntityId, transform: SerializableTransform): void
  onApply(id: ExternalCollisionEntityId): void | Promise<void>
  onCancel(id: ExternalCollisionEntityId): void
  onNumericStatus(
    id: ExternalCollisionEntityId,
    value: number,
  ): void | Promise<void>
  onStatusSource(
    id: ExternalCollisionEntityId,
    source: 'manual' | 'opcua',
  ): void | Promise<void>
  onOverlayVisible(
    id: ExternalCollisionEntityId,
    visible: boolean,
  ): void | Promise<void>
  onDelete(id: ExternalCollisionEntityId): void | Promise<void>
}

interface TransformDraft {
  xMm: string
  yMm: string
  zMm: string
  rollDeg: string
  pitchDeg: string
  yawDeg: string
}

function draftFromRecord(record: EquipmentRecord): TransformDraft {
  const euler = new Euler().setFromQuaternion(
    new Quaternion(...record.transform.quaternion),
    'ZYX',
  )
  return {
    xMm: String(record.transform.position[0] * 1_000),
    yMm: String(record.transform.position[1] * 1_000),
    zMm: String(record.transform.position[2] * 1_000),
    rollDeg: String(MathUtils.radToDeg(euler.x)),
    pitchDeg: String(MathUtils.radToDeg(euler.y)),
    yawDeg: String(MathUtils.radToDeg(euler.z)),
  }
}

function finiteDraftNumber(value: string, label: string): number {
  const parsed = Number(value)
  if (value.trim() === '' || !Number.isFinite(parsed)) {
    throw new Error(`${label} must be a finite number.`)
  }
  return parsed
}

function transformFromDraft(
  record: EquipmentRecord,
  draft: TransformDraft,
): SerializableTransform {
  const roll = MathUtils.degToRad(finiteDraftNumber(draft.rollDeg, 'Roll'))
  const pitch = MathUtils.degToRad(finiteDraftNumber(draft.pitchDeg, 'Pitch'))
  const yaw = MathUtils.degToRad(finiteDraftNumber(draft.yawDeg, 'Yaw'))
  const quaternion = new Quaternion().setFromEuler(
    new Euler(roll, pitch, yaw, 'ZYX'),
  )
  return {
    position: [
      finiteDraftNumber(draft.xMm, 'X') / 1_000,
      finiteDraftNumber(draft.yMm, 'Y') / 1_000,
      finiteDraftNumber(draft.zMm, 'Z') / 1_000,
    ],
    quaternion: quaternion.toArray(),
    scale: [...record.transform.scale],
  }
}

export function EquipmentInspector({
  record,
  disabled = false,
  onPreview,
  onApply,
  onCancel,
  onNumericStatus,
  onStatusSource,
  onOverlayVisible,
  onDelete,
}: EquipmentInspectorProps) {
  const entityId = equipmentRecordEntityId(record)
  const [draft, setDraft] = useState(() => draftFromRecord(record))
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setDraft(draftFromRecord(record))
  }, [record])

  const updateDraft = (key: keyof TransformDraft, value: string) => {
    setDraft((current) => ({ ...current, [key]: value }))
  }

  const preview = (): boolean => {
    try {
      onPreview(entityId, transformFromDraft(record, draft))
      setError(null)
      return true
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Invalid transform.')
      return false
    }
  }

  const transformFields: readonly [
    keyof TransformDraft,
    string,
  ][] = [
    ['xMm', 'X (mm)'],
    ['yMm', 'Y (mm)'],
    ['zMm', 'Z (mm)'],
    ['rollDeg', 'Roll (deg)'],
    ['pitchDeg', 'Pitch (deg)'],
    ['yawDeg', 'Yaw (deg)'],
  ]

  return (
    <div className="equipment-inspector">
      <h2>Equipment</h2>
      <header>
        <strong>{record.name}</strong>
        <small>{record.kind}</small>
      </header>
      <fieldset disabled={disabled}>
        <legend>Manual transform</legend>
        <p>Coordinates relative to MCP</p>
        <div className="equipment-transform-grid">
          {transformFields.map(([key, label]) => (
            <label key={key}>
              {label}
              <input
                aria-label={label}
                onChange={(event) => updateDraft(key, event.currentTarget.value)}
                step="any"
                type="number"
                value={draft[key]}
              />
            </label>
          ))}
        </div>
        <div className="equipment-inspector-actions">
          <button onClick={preview} type="button">Preview transform</button>
          <button
            onClick={() => {
              if (preview()) void onApply(entityId)
            }}
            type="button"
          >
            Apply transform
          </button>
          <button
            onClick={() => {
              onCancel(entityId)
              setError(null)
            }}
            type="button"
          >
            Cancel transform
          </button>
        </div>
      </fieldset>
      <EquipmentStatusEditor
        disabled={disabled}
        onNumericStatus={(value) => onNumericStatus(entityId, value)}
        onOverlayVisible={(visible) => onOverlayVisible(entityId, visible)}
        onStatusSource={(source) => onStatusSource(entityId, source)}
        status={{
          numericStatus: record.numericStatus ?? 0,
          statusOverlayVisible: record.statusOverlayVisible ?? true,
          statusSource: record.statusSource ?? 'manual',
        }}
      />
      {error === null ? null : <p role="alert">{error}</p>}
      <button
        className="equipment-danger-action"
        disabled={disabled}
        onClick={() => {
          if (window.confirm(`Delete ${record.name}?`)) {
            void onDelete(entityId)
          }
        }}
        type="button"
      >
        Delete {record.name}
      </button>
    </div>
  )
}
