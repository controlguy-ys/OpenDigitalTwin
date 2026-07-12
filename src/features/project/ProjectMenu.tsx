import { useRef, type ChangeEvent } from 'react'
import { useStore } from 'zustand'
import type { StoreApi } from 'zustand/vanilla'
import { projectStore } from './project-store-browser'
import type { ProjectStoreState } from './project-store'

export interface ProjectMenuProps {
  store?: StoreApi<ProjectStoreState>
  download?(bytes: Uint8Array, fileName: string): void
}

function safeFileName(name: string): string {
  return name.replace(/[<>:"/\\|?*]/g, '_').trim() || 'workcell'
}

function downloadProject(bytes: Uint8Array, fileName: string): void {
  const blob = new Blob([bytes.slice().buffer], { type: 'application/zip' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = fileName
  anchor.click()
  URL.revokeObjectURL(url)
}

function readFile(file: File): Promise<ArrayBuffer> {
  if (typeof file.arrayBuffer === 'function') return file.arrayBuffer()
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(reader.error ?? new Error('Unable to read project file.'))
    reader.onload = () => resolve(reader.result as ArrayBuffer)
    reader.readAsArrayBuffer(file)
  })
}

export function ProjectMenu({
  store = projectStore,
  download = downloadProject,
}: ProjectMenuProps) {
  const state = useStore(store)
  const inputRef = useRef<HTMLInputElement>(null)
  const busy = state.status === 'saving' || state.status === 'importing'

  const handleImport = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0]
    event.currentTarget.value = ''
    if (file === undefined) return
    await state.importProject(await readFile(file)).catch(() => undefined)
  }

  return (
    <div className="project-menu" aria-label="Project controls">
      <span className="project-name">{state.activeProjectName ?? 'Unsaved Workcell'}</span>
      <span className="project-save-state">
        {busy ? 'Working…' : state.activeProjectId === null ? 'Unsaved' : 'Saved'}
      </span>
      <button
        disabled={busy}
        onClick={() => void state.newProject().catch(() => undefined)}
        type="button"
      >
        New
      </button>
      <button
        aria-label="Save project"
        disabled={busy}
        onClick={() => void state.saveActiveProject().catch(() => undefined)}
        type="button"
      >
        Save
      </button>
      <button
        aria-label="Export project"
        disabled={busy}
        onClick={() => {
          void state
            .exportActiveProject()
            .then((bytes) =>
              download(
                bytes,
                `${safeFileName(state.activeProjectName ?? 'workcell')}.wdtwin`,
              ),
            )
            .catch(() => undefined)
        }}
        type="button"
      >
        Export
      </button>
      <button disabled={busy} onClick={() => inputRef.current?.click()} type="button">
        Import
      </button>
      <input
        accept=".wdtwin,application/zip"
        aria-label="Import project"
        hidden
        onChange={(event) => void handleImport(event)}
        ref={inputRef}
        type="file"
      />
      {state.error === null ? null : <span role="alert">{state.error}</span>}
    </div>
  )
}
