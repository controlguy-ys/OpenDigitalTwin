import { useEffect, useRef, useState, type ChangeEvent } from 'react'
import { stepImportClient } from '../import/StepImportClient'
import {
  importRobotStepFiles,
  mapRobotStepFiles,
  type RobotStepImportController,
} from './robot-step-import'
import {
  robotGeometryRepository,
  type RobotGeometryRepository,
} from './robot-geometry-repository'

interface RobotImportDialogProps {
  open: boolean
  onClose(): void
  client?: RobotStepImportController
  repository?: RobotGeometryRepository
}

export function RobotImportDialog({
  open,
  onClose,
  client = stepImportClient,
  repository = robotGeometryRepository,
}: RobotImportDialogProps) {
  const [files, setFiles] = useState<readonly File[]>([])
  const [error, setError] = useState<string | null>(null)
  const [importing, setImporting] = useState(false)
  const operationRevision = useRef(0)

  const reset = () => {
    operationRevision.current += 1
    client.cancel()
    setFiles([])
    setError(null)
    setImporting(false)
  }

  useEffect(() => {
    if (!open) reset()
  }, [open])

  if (!open) return null

  const handleFiles = (event: ChangeEvent<HTMLInputElement>) => {
    const selected = Array.from(event.currentTarget.files ?? [])
    try {
      mapRobotStepFiles(selected)
      setFiles(selected)
      setError(null)
    } catch (nextError) {
      setFiles([])
      setError(nextError instanceof Error ? nextError.message : 'Invalid robot STEP files.')
    }
  }

  const handleImport = async () => {
    if (files.length === 0 || importing) return
    const revision = ++operationRevision.current
    setImporting(true)
    setError(null)
    try {
      const assets = await importRobotStepFiles(files, client)
      if (revision !== operationRevision.current) {
        for (const asset of assets.values()) asset.dispose()
        return
      }
      repository.replace(assets)
      setImporting(false)
      onClose()
    } catch (nextError) {
      if (revision !== operationRevision.current) return
      setImporting(false)
      if (nextError instanceof DOMException && nextError.name === 'AbortError') return
      setError(nextError instanceof Error ? nextError.message : 'Robot STEP import failed.')
    }
  }

  return (
    <div
      aria-labelledby="robot-import-title"
      aria-modal="true"
      className="import-step-backdrop"
      role="dialog"
    >
      <section className="import-step-dialog">
        <header>
          <div>
            <p>Single robot slot</p>
            <h2 id="robot-import-title">Import Robot STEP</h2>
          </div>
          <button
            aria-label="Close robot import dialog"
            disabled={importing}
            onClick={() => {
              reset()
              onClose()
            }}
            type="button"
          >
            Close
          </button>
        </header>
        <p className="robot-import-hint">
          Select 1–7 STEP files. ABB-style LINK00–LINK06 names are mapped
          automatically; generic names use file order.
        </p>
        <label className="import-file-field">
          <span>Robot link STEP files</span>
          <input
            accept=".step,.stp"
            aria-label="Robot link STEP files"
            disabled={importing}
            multiple
            onChange={handleFiles}
            type="file"
          />
        </label>
        {files.length === 0 ? null : (
          <ol aria-label="Robot link mapping" className="robot-link-mapping">
            {mapRobotStepFiles(files).map(({ file, linkId }) => (
              <li key={linkId}>
                <strong>{linkId}</strong>
                <span>{file.name}</span>
              </li>
            ))}
          </ol>
        )}
        {importing ? <progress aria-label="Robot STEP conversion progress" /> : null}
        {error === null ? null : <p role="alert">{error}</p>}
        <footer>
          <button
            disabled={importing}
            onClick={() => {
              reset()
              onClose()
            }}
            type="button"
          >
            Cancel
          </button>
          <button
            disabled={files.length === 0 || importing}
            onClick={() => void handleImport()}
            type="button"
          >
            {importing ? 'Converting…' : 'Replace robot geometry'}
          </button>
        </footer>
      </section>
    </div>
  )
}
