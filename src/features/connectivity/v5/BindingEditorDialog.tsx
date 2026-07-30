import {
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from 'react'

import type {
  OpcUaProjectTargetV5,
  WorkcellProjectV5,
} from '../../../core/project-v5/index.js'
import { ModalDialogV6 } from '../../ui/v6/ModalDialogV6.js'
import type { ProjectV5AtomicMutationPort } from '../../project/v5/project-v5-mutation-service.js'
import type { NamespaceIndexResolutionPortV1 } from './opcua-node-address-draft.js'
import {
  FRAME_LEAF_LABELS_V1,
  bindingTargetLabelV1,
  createBindingMappingDraftV1,
  removeBindingMappingV1,
  saveBindingMappingV1,
  takeManualBindingOwnershipV1,
  type BindingMappingDraftV1,
} from './binding-editor-model.js'
import { resolveSessionNodeIdDraftV1 } from './opcua-node-address-draft.js'

type MutationPortV1 = Pick<ProjectV5AtomicMutationPort, 'readPublished' | 'mutate'>

export interface BindingEditorDialogPropsV1 {
  readonly activeProject: WorkcellProjectV5
  readonly target: OpcUaProjectTargetV5
  readonly mappingId?: string
  readonly mutations: MutationPortV1
  readonly nodeAddressResolver: NamespaceIndexResolutionPortV1
  readonly browseSessionAvailable: (endpointId: string) => boolean
  readonly onClose: () => void
  readonly onSaved?: () => void
  readonly createMappingId?: () => string
  readonly triggerRef?: RefObject<HTMLElement | null>
}

function nextMappingId(project: WorkcellProjectV5): string {
  const used = new Set(project.opcUa.mappings.map(({ id }) => id))
  for (let index = 1; ; index += 1) {
    const candidate = `mapping-${index}`
    if (!used.has(candidate)) return candidate
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function currentProject(
  mutations: MutationPortV1,
  fallback: WorkcellProjectV5,
): WorkcellProjectV5 {
  return mutations.readPublished()?.project ?? fallback
}

export function BindingEditorDialogV1({
  activeProject,
  target,
  mappingId,
  mutations,
  nodeAddressResolver,
  browseSessionAvailable,
  onClose,
  onSaved,
  createMappingId,
  triggerRef,
}: BindingEditorDialogPropsV1): ReactNode {
  const firstFieldRef = useRef<HTMLSelectElement>(null)
  const inFlightRef = useRef(false)
  const baselineRevisionIdRef = useRef(activeProject.revisionId)
  const manualActionRef = useRef<HTMLButtonElement>(null)
  const manualConfirmRef = useRef<HTMLButtonElement>(null)
  const manualConfirmationWasShownRef = useRef(false)
  const [draft, setDraft] = useState<BindingMappingDraftV1>(() => (
    createBindingMappingDraftV1(
      activeProject,
      target,
      createMappingId?.() ?? nextMappingId(activeProject),
      mappingId === undefined ? {} : { existingMappingId: mappingId },
    )
  ))
  const [sessionNodeId, setSessionNodeId] = useState('')
  const [manualConfirmation, setManualConfirmation] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const existing = activeProject.opcUa.mappings.some(({ id }) => id === draft.mappingId)
  const frameTarget = target.type === 'entity-frame' || target.type === 'robot-frame'

  useEffect(() => {
    if (manualConfirmation) {
      manualConfirmationWasShownRef.current = true
      manualConfirmRef.current?.focus()
    } else if (manualConfirmationWasShownRef.current) {
      manualConfirmationWasShownRef.current = false
      manualActionRef.current?.focus()
    }
  }, [manualConfirmation])

  const update = (patch: Partial<BindingMappingDraftV1>): void => {
    if (busy) return
    setError(null)
    setManualConfirmation(false)
    setDraft((current) => Object.freeze({ ...current, ...patch }))
  }

  const performMutation = (
    description: string,
    recipe: (project: WorkcellProjectV5) => WorkcellProjectV5,
  ): void => {
    if (busy || inFlightRef.current) return
    const published = mutations.readPublished()
    if (published === null) {
      setError('No published Project V5 revision is active.')
      return
    }
    inFlightRef.current = true
    setBusy(true)
    setError(null)
    void mutations.mutate({
      expectedRevisionId: baselineRevisionIdRef.current,
      description,
      recipe,
    }).then(() => {
      onSaved?.()
      onClose()
    }).catch((mutationError: unknown) => {
      setError(errorMessage(mutationError))
    }).finally(() => {
      inFlightRef.current = false
      setBusy(false)
    })
  }

  const resolvePastedNodeId = (): void => {
    if (busy || !browseSessionAvailable(draft.endpointId)) return
    setBusy(true)
    setError(null)
    void resolveSessionNodeIdDraftV1(draft.endpointId, sessionNodeId, nodeAddressResolver)
      .then((resolved) => {
        setDraft((current) => Object.freeze({
          ...current,
          namespaceUri: resolved.namespaceUri,
          identifierType: resolved.identifierType,
          identifier: resolved.identifier,
        }))
        setSessionNodeId('')
      })
      .catch((resolutionError: unknown) => setError(errorMessage(resolutionError)))
      .finally(() => setBusy(false))
  }

  const close = (): void => {
    if (!busy) onClose()
  }

  return (
    <ModalDialogV6
      busy={busy}
      busyEscapeBehavior="ignore"
      className="opcua-settings-dialog binding-editor-dialog"
      footer={<footer className="opcua-settings-footer">
        <button disabled={busy} onClick={close} type="button">Cancel</button>
        {existing ? <button disabled={busy} onClick={() => performMutation('Remove OPC UA binding', (project) => removeBindingMappingV1(project, draft.mappingId))} type="button">Remove Binding</button> : null}
        {manualConfirmation ? (
          <>
            <span role="status">Manual ownership removes conflicting read mappings for this target.</span>
            <button disabled={busy} onClick={() => setManualConfirmation(false)} type="button">Keep OPC UA Control</button>
            <button disabled={busy} onClick={() => performMutation('Take manual binding ownership', (project) => takeManualBindingOwnershipV1(project, target))} ref={manualConfirmRef} type="button">Confirm Take Manual Ownership</button>
          </>
        ) : (
          <button disabled={busy} onClick={() => setManualConfirmation(true)} ref={manualActionRef} type="button">Take Manual Ownership</button>
        )}
        <button disabled={busy || currentProject(mutations, activeProject).opcUa.endpoints.length === 0} form="binding-editor-v1-form" type="submit">Save Binding</button>
      </footer>}
      header={<header className="opcua-settings-header">
          <div>
            <p>Connectivity / Mapping</p>
            <h2 id="binding-editor-v1-title">OPC UA Binding</h2>
          </div>
          <p>{bindingTargetLabelV1(activeProject, target)}</p>
        </header>}
      initialFocusRef={firstFieldRef}
      onClose={close}
      overlayClassName="opcua-settings-overlay"
      testId="binding-editor-overlay"
      titleId="binding-editor-v1-title"
      triggerRef={triggerRef}
    >
        <form id="binding-editor-v1-form" onSubmit={(event) => {
          event.preventDefault()
          performMutation('Save OPC UA binding', (project) => saveBindingMappingV1(project, draft))
        }}>
          <div className="opcua-settings-body">
            <section aria-labelledby="binding-target-title">
              <h3 id="binding-target-title">Target</h3>
              <dl className="opcua-settings-summary">
                <div><dt>Project target</dt><dd>{bindingTargetLabelV1(activeProject, target)}</dd></div>
                <div><dt>Mapping ID</dt><dd>{draft.mappingId}</dd></div>
                <div><dt>Coordinate convention</dt><dd>Project V5 / Z-up / metres / quaternion XYZW</dd></div>
              </dl>
            </section>

            <section aria-labelledby="binding-endpoint-title">
              <h3 id="binding-endpoint-title">Client Endpoint</h3>
              <label>
                <span>Endpoint</span>
                <select
                  aria-label="Binding endpoint"
                  disabled={busy}
                  onChange={(event) => update({ endpointId: event.currentTarget.value })}
                  ref={firstFieldRef}
                  value={draft.endpointId}
                >
                  {activeProject.opcUa.endpoints.map((endpoint) => (
                    <option key={endpoint.endpointId} value={endpoint.endpointId}>{endpoint.name}</option>
                  ))}
                </select>
              </label>
              <p>Endpoint URLs and reconnect settings are managed only in OPC UA Settings.</p>
            </section>

            <section aria-labelledby="binding-node-address-title">
              <h3 id="binding-node-address-title">Stable Node Address</h3>
              <label><span>Namespace URI</span><input aria-label="Namespace URI" disabled={busy} onChange={(event) => update({ namespaceUri: event.currentTarget.value })} value={draft.namespaceUri} /></label>
              <label>
                <span>Identifier type</span>
                <select aria-label="Identifier type" disabled={busy} onChange={(event) => update({ identifierType: event.currentTarget.value as BindingMappingDraftV1['identifierType'] })} value={draft.identifierType}>
                  <option value="string">String</option><option value="numeric">Numeric</option><option value="guid">GUID</option><option value="byteString">ByteString</option>
                </select>
              </label>
              <label><span>Identifier</span><input aria-label="Identifier" disabled={busy} onChange={(event) => update({ identifier: event.currentTarget.value })} value={draft.identifier} /></label>
              <div className="binding-session-node-row">
                <label><span>Paste session NodeId</span><input aria-label="Paste session NodeId" disabled={busy || !browseSessionAvailable(draft.endpointId)} onChange={(event) => setSessionNodeId(event.currentTarget.value)} placeholder="ns=2;s=ObjectPos" value={sessionNodeId} /></label>
                <button disabled={busy || sessionNodeId.trim().length === 0 || !browseSessionAvailable(draft.endpointId)} onClick={resolvePastedNodeId} type="button">Resolve from Browse Session</button>
              </div>
              <p>{browseSessionAvailable(draft.endpointId) ? 'The current Browse Session will resolve ns=N to its Namespace URI.' : 'Connect this Endpoint to enable session NodeId paste.'}</p>
            </section>

            <section aria-labelledby="binding-behavior-title">
              <h3 id="binding-behavior-title">Mapping Behavior</h3>
              <label><span>Direction</span><select aria-label="Mapping direction" disabled={busy} onChange={(event) => update({ direction: event.currentTarget.value as BindingMappingDraftV1['direction'] })} value={draft.direction}><option value="read">Read</option><option value="write">Write</option><option value="readWrite">Read / Write</option></select></label>
              <label><span>Publishing interval override (ms)</span><input aria-label="Publishing interval override (ms)" disabled={busy} min="1" onChange={(event) => update({ publishingIntervalMs: event.currentTarget.value })} placeholder="Use Endpoint default" type="number" value={draft.publishingIntervalMs} /></label>
              <label><span>Coherence group</span><input aria-label="Coherence group" disabled={busy} onChange={(event) => update({ coherenceGroupId: event.currentTarget.value })} value={draft.coherenceGroupId} /></label>
              <label><span>Interpolation</span><select aria-label="Interpolation" disabled={busy} onChange={(event) => update({ interpolationMode: event.currentTarget.value as BindingMappingDraftV1['interpolationMode'] })} value={draft.interpolationMode}><option value="none">None</option><option value="linear">Linear</option><option value="shortest-quaternion">Shortest quaternion</option><option value="revolute-wrapped">Revolute wrapped</option></select></label>
            </section>

            <section aria-labelledby="binding-leaves-title">
              <h3 id="binding-leaves-title">{frameTarget ? 'Structured Pose Leaves' : 'Scalar Leaf'}</h3>
              <p>Each OPC UA leaf path maps to one fixed Project destination.</p>
              <div className="binding-leaf-grid">
                {draft.leafPaths.map((path, index) => (
                  <label key={`${FRAME_LEAF_LABELS_V1[index] ?? 'Value'}:${index}`}>
                    <span>{FRAME_LEAF_LABELS_V1[index] ?? 'Value'} → {frameTarget ? `${index < 3 ? 'positionM' : 'rpyDegrees'}[${index % 3}]` : 'value'}</span>
                    <input
                      aria-label={`${FRAME_LEAF_LABELS_V1[index] ?? 'Value'} leaf path`}
                      disabled={busy}
                      onChange={(event) => {
                        const leafPaths = [...draft.leafPaths]
                        leafPaths[index] = event.currentTarget.value
                        update({ leafPaths })
                      }}
                      placeholder={FRAME_LEAF_LABELS_V1[index] === undefined ? '[]' : `["${FRAME_LEAF_LABELS_V1[index]}"]`}
                      value={path}
                    />
                  </label>
                ))}
              </div>
            </section>
            {error === null ? null : <p role="alert">{error}</p>}
          </div>
        </form>
    </ModalDialogV6>
  )
}
