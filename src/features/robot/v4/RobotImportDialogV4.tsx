import { useEffect, useRef, useState, type ChangeEvent, type ReactNode } from 'react'

import {
  mapRobotStepFilesV4,
  type RobotImportControllerV4,
  type RobotImportDraftV4,
  type RobotSourceUpAxisV4,
} from './robot-step-import-v4.js'

export interface RobotImportDialogPropsV4 {
  readonly controller: RobotImportControllerV4
  readonly open: boolean
  readonly onClose: () => void
}

const DEFAULT_DRAFT_V4: RobotImportDraftV4 = Object.freeze({
  name: 'Imported Robot',
  manufacturer: 'Custom',
  model: 'Six-axis Robot',
  sourceUpAxis: 'z',
})

export function RobotImportDialogV4({
  controller,
  open,
  onClose,
}: RobotImportDialogPropsV4): ReactNode {
  const [draft, setDraft] = useState<RobotImportDraftV4>(DEFAULT_DRAFT_V4)
  const [files, setFiles] = useState<readonly File[]>([])
  const [error, setError] = useState<string | null>(null)
  const [importing, setImporting] = useState(false)
  const operation = useRef(0)

  useEffect(() => {
    if (open) return
    operation.current += 1
    controller.cancel()
    setDraft(DEFAULT_DRAFT_V4)
    setFiles([])
    setError(null)
    setImporting(false)
  }, [controller, open])

  if (!open) return null

  const mapping = files.length === 0 ? [] : mapRobotStepFilesV4(files)
  const updateDraft = <Key extends keyof RobotImportDraftV4>(
    key: Key,
    value: RobotImportDraftV4[Key],
  ): void => setDraft((current) => ({ ...current, [key]: value }))

  const handleFiles = (event: ChangeEvent<HTMLInputElement>): void => {
    const selected = Array.from(event.currentTarget.files ?? [])
    try {
      mapRobotStepFilesV4(selected)
      setFiles(selected)
      setError(null)
    } catch (nextError) {
      setFiles([])
      setError(nextError instanceof Error ? nextError.message : 'Invalid Robot STEP selection.')
    }
  }

  const close = (): void => {
    operation.current += 1
    controller.cancel()
    setDraft(DEFAULT_DRAFT_V4)
    setFiles([])
    setError(null)
    setImporting(false)
    onClose()
  }

  const importRobot = async (): Promise<void> => {
    if (files.length === 0 || importing) return
    const revision = ++operation.current
    setImporting(true)
    setError(null)
    try {
      await controller.importRobot(files, draft)
      if (operation.current !== revision) return
      setImporting(false)
      onClose()
    } catch (nextError) {
      if (operation.current !== revision) return
      setImporting(false)
      if (nextError instanceof DOMException && nextError.name === 'AbortError') return
      setError(nextError instanceof Error ? nextError.message : 'Robot STEP import failed.')
    }
  }

  const validDraft = draft.name.trim() !== ''
    && draft.manufacturer.trim() !== ''
    && draft.model.trim() !== ''

  return (
    <div
      aria-labelledby="robot-import-title-v4"
      aria-modal="true"
      className="import-step-backdrop"
      role="dialog"
    >
      <section className="import-step-dialog robot-import-dialog-v4">
        <header>
          <div>
            <p>Robot Geometry</p>
            <h2 id="robot-import-title-v4">Import Robot STEP</h2>
          </div>
          <button
            aria-label="Close Robot Import"
            disabled={importing}
            onClick={close}
            type="button"
          >Close</button>
        </header>
        <p className="robot-import-hint">
          Select one through seven STEP sources. Files containing LINK00–LINK06
          are mapped by name; remaining files fill the first free Links.
          Unassigned Links keep the six-axis mechanics but have no Geometry.
        </p>
        <div className="robot-import-fields-v4">
          <label>
            <span>Robot name</span>
            <input
              aria-label="Robot name"
              disabled={importing}
              maxLength={128}
              onChange={(event) => updateDraft('name', event.currentTarget.value)}
              value={draft.name}
            />
          </label>
          <label>
            <span>Manufacturer</span>
            <input
              aria-label="Robot manufacturer"
              disabled={importing}
              maxLength={128}
              onChange={(event) => updateDraft('manufacturer', event.currentTarget.value)}
              value={draft.manufacturer}
            />
          </label>
          <label>
            <span>Model</span>
            <input
              aria-label="Robot model"
              disabled={importing}
              maxLength={128}
              onChange={(event) => updateDraft('model', event.currentTarget.value)}
              value={draft.model}
            />
          </label>
          <label>
            <span>Source up axis</span>
            <select
              aria-label="Robot source up axis"
              disabled={importing}
              onChange={(event) => updateDraft(
                'sourceUpAxis',
                event.currentTarget.value as RobotSourceUpAxisV4,
              )}
              value={draft.sourceUpAxis}
            >
              <option value="z">Z-Up</option>
              <option value="y">Y-Up</option>
              <option value="x">X-Up</option>
            </select>
          </label>
        </div>
        <label className="import-file-field">
          <span>Robot STEP sources (1–7)</span>
          <input
            accept=".step,.stp"
            aria-label="Robot STEP sources"
            disabled={importing}
            multiple
            onChange={handleFiles}
            type="file"
          />
        </label>
        {mapping.length === 0 ? null : (
          <ol aria-label="Robot Link mapping" className="robot-link-mapping">
            {mapping.map(({ file, linkOrdinal }) => (
              <li key={linkOrdinal}>
                <strong>LINK{String(linkOrdinal).padStart(2, '0')}</strong>
                <span title={file.name}>{file.name}</span>
              </li>
            ))}
          </ol>
        )}
        {importing ? (
          <div className="import-converting">
            <progress aria-label="Robot STEP import progress" />
            <span role="status">Hashing, converting, and publishing Robot Geometry…</span>
          </div>
        ) : null}
        {error === null ? null : <p role="alert">{error}</p>}
        <footer>
          <button disabled={importing} onClick={close} type="button">Cancel</button>
          <button
            disabled={importing || files.length === 0 || !validDraft}
            onClick={() => void importRobot()}
            type="button"
          >{importing ? 'Importing…' : 'Import Robot'}</button>
        </footer>
      </section>
    </div>
  )
}
