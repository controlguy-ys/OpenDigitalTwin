import { useEffect, useState } from 'react'

export interface EquipmentStatusEditorValue {
  readonly numericStatus: number
  readonly statusSource: 'manual' | 'opcua'
  readonly statusOverlayVisible: boolean
}

export interface EquipmentStatusEditorProps {
  readonly status: EquipmentStatusEditorValue
  readonly disabled?: boolean
  readonly onNumericStatus: (value: number) => void | Promise<void>
  readonly onStatusSource: (source: 'manual' | 'opcua') => void | Promise<void>
  readonly onOverlayVisible: (visible: boolean) => void | Promise<void>
}

export function EquipmentStatusEditor({
  status,
  disabled = false,
  onNumericStatus,
  onStatusSource,
  onOverlayVisible,
}: EquipmentStatusEditorProps) {
  const [numericStatus, setNumericStatus] = useState(String(status.numericStatus))
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setNumericStatus(String(status.numericStatus))
  }, [status.numericStatus])

  const run = (action: () => void | Promise<void>) => {
    setError(null)
    void Promise.resolve(action()).catch((nextError: unknown) => {
      setError(nextError instanceof Error ? nextError.message : 'Status update failed.')
    })
  }

  return (
    <fieldset disabled={disabled}>
      <legend>Status overlay</legend>
      <label>
        Status source
        <select
          aria-label="Status source"
          onChange={(event) => run(() => onStatusSource(
            event.currentTarget.value as 'manual' | 'opcua',
          ))}
          value={status.statusSource}
        >
          <option value="manual">Manual</option>
          <option value="opcua">OPC UA</option>
        </select>
      </label>
      <label>
        Numeric status
        <input
          aria-label="Numeric status"
          disabled={status.statusSource === 'opcua'}
          onChange={(event) => setNumericStatus(event.currentTarget.value)}
          step="any"
          type="number"
          value={numericStatus}
        />
      </label>
      <label className="equipment-overlay-toggle">
        <input
          aria-label="Show status overlay"
          checked={status.statusOverlayVisible}
          onChange={(event) => run(() => onOverlayVisible(event.currentTarget.checked))}
          type="checkbox"
        />
        Show status overlay
      </label>
      <button
        disabled={status.statusSource === 'opcua'}
        onClick={() => {
          const value = Number(numericStatus)
          if (numericStatus.trim() === '' || !Number.isFinite(value)) {
            setError('Numeric status must be a finite number.')
            return
          }
          run(() => onNumericStatus(value))
        }}
        type="button"
      >
        Apply numeric status
      </button>
      {error === null ? null : <p role="alert">{error}</p>}
    </fieldset>
  )
}
