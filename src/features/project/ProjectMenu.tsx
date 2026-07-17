import { useRef, useState, type ChangeEvent } from 'react'
import { useStore } from 'zustand'

import type { RuntimeGatewayPresentationV4 } from '../runtime-gateway/v4/runtime-gateway-publisher-v4.js'
import { createDualRobotSampleV4 } from './v4/dual-robot-sample-v4.js'
import type { ProjectMutationPortV4 } from './v4/project-mutation-port.js'
import type { ProjectStoreV4 } from './v4/project-store-v4.js'

export interface ProjectMenuPropsV4 {
  readonly store: ProjectStoreV4
  readonly mutations?: ProjectMutationPortV4
  readonly gateway?: RuntimeGatewayPresentationV4
  readonly download?: (blob: Blob, fileName: string) => void
}

function safeFileName(name: string): string {
  return name.replace(/[<>:"/\\|?*]/gu, '_').trim() || 'workcell'
}

function downloadProject(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = fileName
  anchor.click()
  URL.revokeObjectURL(url)
}

export function ProjectMenuV4({
  store,
  mutations,
  gateway = {
    phase: 'idle',
    projectRevisionId: null,
    mode: null,
    endpointUrl: null,
    message: null,
  },
  download = downloadProject,
}: ProjectMenuPropsV4) {
  const state = useStore(store)
  const inputRef = useRef<HTMLInputElement>(null)
  const [mutationPending, setMutationPending] = useState(false)
  const [mutationError, setMutationError] = useState<string | null>(null)
  const busy = (
    state.status === 'loading'
    || state.status === 'saving'
    || state.status === 'importing'
    || mutationPending
  )
  const recoveryRequired = state.status === 'recovery-required'
  const disabled = busy || recoveryRequired
  const projectName = state.activeProject?.metadata.name ?? 'Untitled Workcell'
  const selectedGatewayMode = state.activeProject?.opcUa.mode ?? 'off'
  const unsupportedGatewayMode = selectedGatewayMode === 'client'
    || selectedGatewayMode === 'bridge'

  const runMutation = async (
    operation: () => Promise<unknown>,
  ): Promise<void> => {
    setMutationPending(true)
    setMutationError(null)
    try {
      await operation()
    } catch (error) {
      setMutationError(error instanceof Error ? error.message : String(error))
    } finally {
      setMutationPending(false)
    }
  }

  const gatewayLabel = gateway.phase === 'activating'
    ? 'Gateway syncing'
    : gateway.phase === 'error'
      ? 'Gateway unavailable'
      : gateway.phase === 'ready' && gateway.mode === 'server'
        ? 'Gateway ready'
        : gateway.phase === 'ready'
          ? 'Gateway off'
          : 'Gateway local'
  const gatewayTitle = gateway.endpointUrl ?? gateway.message ?? gatewayLabel

  const handleImport = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0]
    event.currentTarget.value = ''
    if (file === undefined) return
    await state.importProject(file).catch(() => undefined)
  }

  return (
    <div aria-label="Project controls" className="project-menu">
      <span className="project-name">{projectName}</span>
      <span className="project-save-state">
        {recoveryRequired
          ? 'Reload required'
          : busy
            ? 'Working'
            : state.activeProject === null ? 'Unsaved' : 'Saved'}
      </span>
      <label className="gateway-mode-control">
        OPC UA
        <select
          aria-label="OPC UA Server mode"
          disabled={disabled || state.activeProject === null || mutations === undefined}
          onChange={(event) => {
            if (mutations === undefined) return
            const mode = event.currentTarget.value === 'server' ? 'server' : 'off'
            void runMutation(() => mutations.replaceFromActive({
              description: `Set OPC UA mode to ${mode}`,
              mutate: (active) => ({
                ...active,
                opcUa: { ...active.opcUa, mode },
              }),
            }))
          }}
          value={selectedGatewayMode}
        >
          {unsupportedGatewayMode
            ? (
                <option disabled value={selectedGatewayMode}>
                  {`Unsupported: ${selectedGatewayMode === 'client' ? 'Client' : 'Bridge'}`}
                </option>
              )
            : null}
          <option value="off">Off</option>
          <option value="server">Server</option>
        </select>
      </label>
      <span
        aria-label="Runtime Gateway status"
        className={`gateway-status gateway-status-${gateway.phase}`}
        role={gateway.phase === 'error' ? 'alert' : 'status'}
        title={gatewayTitle}
      >
        {gatewayLabel}
      </span>
      <button
        disabled={disabled}
        onClick={() => void state.newProject().catch(() => undefined)}
        type="button"
      >
        New
      </button>
      <button
        aria-label="Save project"
        disabled={disabled || state.activeProject === null}
        onClick={() => void state.saveActiveProject().catch(() => undefined)}
        type="button"
      >
        Save
      </button>
      <button
        aria-label="Export project"
        disabled={disabled || state.activeProject === null}
        onClick={() => {
          void state.exportActiveProject()
            .then((blob) => download(blob, safeFileName(projectName) + '.json'))
            .catch(() => undefined)
        }}
        type="button"
      >
        Export
      </button>
      <button
        disabled={disabled}
        onClick={() => inputRef.current?.click()}
        type="button"
      >
        Import
      </button>
      <button
        aria-label="Load dual-Robot sample"
        disabled={disabled || state.activeProject === null || mutations === undefined}
        onClick={() => {
          if (mutations === undefined) return
          void runMutation(() => mutations.replaceFromActive({
            description: 'Load dual-Robot sample',
            mutate: (active) => createDualRobotSampleV4({
              projectId: active.projectId,
              revisionId: active.revisionId,
              nowIso: active.metadata.updatedAt,
              opcUaMode: active.opcUa.mode === 'server' ? 'server' : 'off',
            }),
          }))
        }}
        type="button"
      >
        Dual sample
      </button>
      <input
        accept=".json,application/json"
        aria-label="Import project"
        hidden
        onChange={(event) => void handleImport(event)}
        ref={inputRef}
        type="file"
      />
      {state.error === null && mutationError === null
        ? null
        : <span role="alert">{state.error ?? mutationError}</span>}
    </div>
  )
}
