import { useEffect, useRef, useState, type ChangeEvent } from 'react'
import type { RobotLinkId } from '../../domain/robot/crb15000'
import { stepImportClient } from '../import/StepImportClient'
import {
  importMappedRobotStepGeometry,
  mapRobotStepFiles,
  validateCompleteRobotStepFiles,
  validateRobotStepFiles,
  type RobotStepImportController,
} from './robot-step-import'
import {
  robotGeometryRepository,
  type RobotGeometryRepository,
} from './robot-geometry-repository'
import { useRobotGeometryStore } from './robot-geometry-store'

const LINK_IDS = [
  'LINK00',
  'LINK01',
  'LINK02',
  'LINK03',
  'LINK04',
  'LINK05',
  'LINK06',
] as const satisfies readonly RobotLinkId[]

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
  const [mode, setMode] = useState<'new-robot' | 'replace-link'>('new-robot')
  const [replacementLinkId, setReplacementLinkId] =
    useState<RobotLinkId>('LINK00')
  const [error, setError] = useState<string | null>(null)
  const [importing, setImporting] = useState(false)
  const operationRevision = useRef(0)
  const replaceRobot = useRobotGeometryStore((state) => state.replaceRobot)
  const replaceLink = useRobotGeometryStore((state) => state.replaceLink)

  const reset = () => {
    operationRevision.current += 1
    client.cancel()
    setFiles([])
    setMode('new-robot')
    setReplacementLinkId('LINK00')
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
      if (mode === 'new-robot') {
        validateCompleteRobotStepFiles(selected)
      } else {
        validateRobotStepFiles(selected)
        if (selected.length !== 1) {
          throw new Error('Link replacement requires exactly one STEP file.')
        }
      }
      setFiles(selected)
      setError(null)
    } catch (nextError) {
      setFiles([])
      setError(
        nextError instanceof Error
          ? nextError.message
          : 'Invalid robot STEP files.',
      )
    }
  }

  const mappedFiles = () =>
    mode === 'new-robot'
      ? mapRobotStepFiles(files)
      : [{ linkId: replacementLinkId, file: files[0]! }]

  const handleImport = async () => {
    if (files.length === 0 || importing) return
    const revision = ++operationRevision.current
    setImporting(true)
    setError(null)
    try {
      const imported = await importMappedRobotStepGeometry(mappedFiles(), client)
      if (revision !== operationRevision.current) {
        for (const asset of imported.assets.values()) asset.dispose()
        return
      }
      if (mode === 'new-robot') {
        await replaceRobot(imported.records)
        repository.replace(imported.assets)
      } else {
        const record = imported.records[0]!
        const asset = imported.assets.get(replacementLinkId)!
        await replaceLink(record)
        repository.replaceLink(replacementLinkId, asset)
      }
      setImporting(false)
      onClose()
    } catch (nextError) {
      if (revision !== operationRevision.current) return
      setImporting(false)
      if (nextError instanceof DOMException && nextError.name === 'AbortError') {
        return
      }
      setError(
        nextError instanceof Error
          ? nextError.message
          : 'Robot STEP import failed.',
      )
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
          A new Robot requires all seven LINK00–LINK06 STEP files. Use the
          explicit Link replacement mode to change one existing Link.
        </p>
        <label>
          <span>Import mode</span>
          <select
            aria-label="Robot import mode"
            disabled={importing}
            onChange={(event) => {
              setMode(event.currentTarget.value as typeof mode)
              setFiles([])
              setError(null)
            }}
            value={mode}
          >
            <option value="new-robot">Import new Robot (7 Links)</option>
            <option value="replace-link">Replace one Link</option>
          </select>
        </label>
        {mode === 'replace-link' ? (
          <label>
            <span>Target Link</span>
            <select
              aria-label="Target Robot Link"
              disabled={importing}
              onChange={(event) =>
                setReplacementLinkId(event.currentTarget.value as RobotLinkId)
              }
              value={replacementLinkId}
            >
              {LINK_IDS.map((linkId) => (
                <option key={linkId} value={linkId}>
                  {linkId}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <label className="import-file-field">
          <span>Robot link STEP files</span>
          <input
            accept=".step,.stp"
            aria-label="Robot link STEP files"
            disabled={importing}
            multiple={mode === 'new-robot'}
            onChange={handleFiles}
            type="file"
          />
        </label>
        {files.length === 0 ? null : (
          <ol aria-label="Robot link mapping" className="robot-link-mapping">
            {mappedFiles().map(({ file, linkId }) => (
              <li key={linkId}>
                <strong>{linkId}</strong>
                <span>{file.name}</span>
              </li>
            ))}
          </ol>
        )}
        {importing ? (
          <progress aria-label="Robot STEP conversion progress" />
        ) : null}
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
            {importing
              ? 'Converting…'
              : mode === 'new-robot'
                ? 'Import new Robot'
                : 'Replace selected Link'}
          </button>
        </footer>
      </section>
    </div>
  )
}
