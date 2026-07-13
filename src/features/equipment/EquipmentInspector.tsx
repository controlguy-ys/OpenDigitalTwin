import { Euler, MathUtils, Quaternion } from 'three'
import { useEffect, useState } from 'react'
import type {
  EquipmentRecord,
  SerializableTransform,
} from '../../domain/equipment/equipment'
import type { ExternalCollisionEntityId } from '../interaction/interaction-store'
import { equipmentRecordEntityId } from './equipment-entity-selection'

interface EquipmentInspectorProps {
  record: EquipmentRecord
  disabled?: boolean
  onPreview(id: string, transform: SerializableTransform): void
  onApply(id: string): void | Promise<void>
  onCancel(id: string): void
  onNumericStatus(id: string, value: number): void | Promise<void>
  onStatusSource(id: string, source: 'manual' | 'opcua'): void | Promise<void>
  onOverlayVisible(id: string, visible: boolean): void | Promise<void>
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
  const [draft, setDraft] = useState(() => draftFromRecord(record))
  const [numericStatus, setNumericStatus] = useState(
    String(record.numericStatus ?? 0),
  )
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setDraft(draftFromRecord(record))
    setNumericStatus(String(record.numericStatus ?? 0))
  }, [record])

  const updateDraft = (key: keyof TransformDraft, value: string) => {
    setDraft((current) => ({ ...current, [key]: value }))
  }

  const preview = (): boolean => {
    try {
      onPreview(record.id, transformFromDraft(record, draft))
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
              if (preview()) void onApply(record.id)
            }}
            type="button"
          >
            Apply transform
          </button>
          <button
            onClick={() => {
              onCancel(record.id)
              setError(null)
            }}
            type="button"
          >
            Cancel transform
          </button>
        </div>
      </fieldset>
      <fieldset disabled={disabled}>
        <legend>Status overlay</legend>
        <label>
          Status source
          <select
            aria-label="Status source"
            onChange={(event) => void onStatusSource(
              record.id,
              event.currentTarget.value as 'manual' | 'opcua',
            )}
            value={record.statusSource ?? 'manual'}
          >
            <option value="manual">Manual</option>
            <option value="opcua">OPC UA</option>
          </select>
        </label>
        <label>
          Numeric status
          <input
            aria-label="Numeric status"
            disabled={(record.statusSource ?? 'manual') === 'opcua'}
            onChange={(event) => setNumericStatus(event.currentTarget.value)}
            step="any"
            type="number"
            value={numericStatus}
          />
        </label>
        <label className="equipment-overlay-toggle">
          <input
            aria-label="Show status overlay"
            checked={record.statusOverlayVisible ?? true}
            onChange={(event) => {
              void onOverlayVisible(record.id, event.currentTarget.checked)
            }}
            type="checkbox"
          />
          Show status overlay
        </label>
        <button
          disabled={(record.statusSource ?? 'manual') === 'opcua'}
          onClick={() => {
            const value = Number(numericStatus)
            if (numericStatus.trim() === '' || !Number.isFinite(value)) {
              setError('Numeric status must be a finite number.')
              return
            }
            setError(null)
            void onNumericStatus(record.id, value)
          }}
          type="button"
        >
          Apply numeric status
        </button>
      </fieldset>
      {error === null ? null : <p role="alert">{error}</p>}
      <button
        className="equipment-danger-action"
        disabled={disabled}
        onClick={() => {
          if (window.confirm(`Delete ${record.name}?`)) {
            void onDelete(equipmentRecordEntityId(record))
          }
        }}
        type="button"
      >
        Delete {record.name}
      </button>
    </div>
  )
}
