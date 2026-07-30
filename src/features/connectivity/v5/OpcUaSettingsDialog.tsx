import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
  type RefObject,
} from 'react'

import {
  MAX_OPC_UA_ENDPOINTS_V5,
  type OpcUaBridgeRouteV5,
  type WorkcellProjectV5,
} from '../../../core/project-v5/index.js'
import { ModalDialogV6 } from '../../ui/v6/ModalDialogV6.js'
import type { ConnectivityPresentationStateV1 } from './connectivity-presentation-store.js'
import type { OpcUaSettingsControllerV1 } from './opcua-settings-activation.js'
import {
  addBridgeRouteV1,
  addEndpointV1,
  deleteBridgeRouteV1,
  deleteEndpointV1,
  dockerLoopbackWarningV1,
  duplicateEndpointV1,
  replaceLoopbackHostV1,
  updateBridgeRouteV1,
  updateEndpointV1,
  validateOpcUaSettingsDraftV1,
  type OpcUaSettingsDraftV1,
  type OpcUaSettingsValidationIssueV1,
} from './opcua-settings-draft.js'
import type { OpcUaConnectionTestPortV1 } from '../../runtime-gateway/v5/runtime-gateway-connection-test.js'

export interface OpcUaSettingsDialogPropsV1 {
  readonly activeProject: WorkcellProjectV5
  readonly controller: OpcUaSettingsControllerV1
  readonly presentation: ConnectivityPresentationStateV1
  readonly connectionTest: OpcUaConnectionTestPortV1
  readonly onOpenBindingOverview: () => void
  readonly onOpenDockerRunGuide: () => void
  readonly triggerRef?: RefObject<HTMLElement | null>
}

interface ConnectionTestResultV1 {
  readonly phase: 'connected' | 'failed'
  readonly namespaceUris: readonly string[]
  readonly elapsedMs: number
  readonly error: string | null
}

function endpointIdFor(draft: OpcUaSettingsDraftV1): string {
  const used = new Set(draft.endpoints.map(({ endpointId }) => endpointId))
  for (let index = 1; ; index += 1) {
    const candidate = `endpoint-${index}`
    if (!used.has(candidate)) return candidate
  }
}

function routeIdFor(draft: OpcUaSettingsDraftV1): string {
  const used = new Set(draft.bridgeRoutes.map(({ id }) => id))
  for (let index = 1; ; index += 1) {
    const candidate = `bridge-route-${index}`
    if (!used.has(candidate)) return candidate
  }
}

function changedSectionCount(draft: OpcUaSettingsDraftV1, active: WorkcellProjectV5): number {
  let count = 0
  if (draft.mode !== active.opcUa.mode) count += 1
  if (JSON.stringify(draft.endpoints) !== JSON.stringify(active.opcUa.endpoints)) count += 1
  if (JSON.stringify(draft.bridgeRoutes) !== JSON.stringify(active.opcUa.bridgeRoutes)) count += 1
  return count
}

function roleDirection(mode: WorkcellProjectV5['opcUa']['mode']): string {
  switch (mode) {
    case 'off': return 'OPC UA runtime adapters are disabled.'
    case 'client': return 'The Gateway reads and writes configured Client Endpoints.'
    case 'server': return 'The Gateway exposes the deployment-owned OPC UA Server listener.'
    case 'bridge': return 'The Gateway combines Client Endpoint mappings with the OPC UA Server listener.'
  }
}

function issueTargetPath(issue: OpcUaSettingsValidationIssueV1): string {
  return issue.path
}

function tabbableElements(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(
    'button, input, select, textarea, [tabindex]',
  )).filter((element) => (
    element.tabIndex >= 0
    && element.closest('[hidden]') === null
    && (!('disabled' in element) || element.disabled !== true)
  ))
}

function numberValue(value: string): number {
  return value === '' ? Number.NaN : Number(value)
}

function mappingCount(project: WorkcellProjectV5, endpointId: string): number {
  return project.opcUa.mappings.filter((mapping) => mapping.endpointId === endpointId).length
}

function issueMessage(
  issues: readonly OpcUaSettingsValidationIssueV1[],
  interactionIssue: OpcUaSettingsValidationIssueV1 | null,
  error: string | null,
): string | null {
  return issues[0]?.message ?? interactionIssue?.message ?? error
}

function useOpcUaSettingsControllerStateV1(controller: OpcUaSettingsControllerV1) {
  const snapshot = useRef({ controller, value: controller.getState() })
  if (snapshot.current.controller !== controller) snapshot.current = { controller, value: controller.getState() }
  return useSyncExternalStore(
    (notify) => controller.subscribe(() => {
      snapshot.current = { controller, value: controller.getState() }
      notify()
    }),
    () => snapshot.current.value,
    () => snapshot.current.value,
  )
}

export function OpcUaSettingsDialog({
  activeProject,
  controller,
  presentation,
  connectionTest,
  onOpenBindingOverview,
  onOpenDockerRunGuide,
  triggerRef,
}: OpcUaSettingsDialogPropsV1): ReactNode {
  const state = useOpcUaSettingsControllerStateV1(controller)
  const dialogRef = useRef<HTMLDivElement>(null)
  const roleRef = useRef<HTMLSelectElement>(null)
  const wasOpenRef = useRef(false)
  const applyInFlightRef = useRef<Promise<unknown> | true | null>(null)
  const testAbortRef = useRef<AbortController | null>(null)
  const testGenerationRef = useRef(0)
  const [selectedEndpointId, setSelectedEndpointId] = useState<string | null>(null)
  const [interactionIssue, setInteractionIssue] = useState<OpcUaSettingsValidationIssueV1 | null>(null)
  const [testResult, setTestResult] = useState<ConnectionTestResultV1 | null>(null)
  const [testing, setTesting] = useState(false)
  const busy = state.phase === 'validating' || state.phase === 'activating'
  const draft = state.draft

  const invalidateDiagnostic = useCallback((): void => {
    testGenerationRef.current += 1
    testAbortRef.current?.abort()
    testAbortRef.current = null
    setTesting(false)
    setTestResult(null)
  }, [])

  useEffect(() => {
    applyInFlightRef.current = null
    if (state.open) {
      wasOpenRef.current = true
      invalidateDiagnostic()
      setInteractionIssue(null)
      return undefined
    }
    if (wasOpenRef.current) {
      wasOpenRef.current = false
      invalidateDiagnostic()
      setInteractionIssue(null)
    }
    return undefined
  }, [invalidateDiagnostic, state.open, triggerRef])

  useEffect(() => () => {
    applyInFlightRef.current = null
    testGenerationRef.current += 1
    testAbortRef.current?.abort()
    testAbortRef.current = null
  }, [])

  useEffect(() => {
    if (draft === null) return
    if (selectedEndpointId !== null && draft.endpoints.some((endpoint) => endpoint.endpointId === selectedEndpointId)) return
    setSelectedEndpointId(draft.endpoints[0]?.endpointId ?? null)
  }, [draft, selectedEndpointId])

  useLayoutEffect(() => {
    if (!state.open || !busy) return
    const root = dialogRef.current
    if (root === null) return
    const elements = tabbableElements(root)
    const active = document.activeElement
    if (active instanceof HTMLElement && root.contains(active) && elements.includes(active)) return
    ;(elements[0] ?? root).focus()
  }, [busy, state.open])

  useLayoutEffect(() => {
    const issue = state.phase === 'failed' ? state.issues[0] : undefined
    if (issue === undefined || draft === null) return undefined
    const endpointMatch = /^\$\.opcUa\.endpoints\[(\d+)\](?:\.(.+))?$/u.exec(issue.path)
    const endpoint = endpointMatch === null ? undefined : draft.endpoints[Number(endpointMatch[1])]
    if (endpoint !== undefined && selectedEndpointId !== endpoint.endpointId) {
      setSelectedEndpointId(endpoint.endpointId)
      return undefined
    }
    const timer = window.setTimeout(() => {
      const root = dialogRef.current
      if (root === null) return
      const path = issueTargetPath(issue)
      const pathTargets = Array.from(root.querySelectorAll<HTMLElement>('[data-validation-path]'))
        .filter((element) => element.dataset.validationPath === path)
      const target = pathTargets.find((element) => !('disabled' in element) || element.disabled !== true)
        ?? pathTargets[0]
        ?? (path.startsWith('$.opcUa.mappings') ? root.querySelector<HTMLElement>('[data-validation-path="$.opcUa.mappings"]') : null)
        ?? (path.startsWith('$.opcUa.bridgeRoutes') ? root.querySelector<HTMLElement>('[data-validation-path="$.opcUa.bridgeRoutes"]') : null)
        ?? root.querySelector<HTMLElement>('[data-validation-path="$"]')
      target?.focus()
    }, 0)
    return () => window.clearTimeout(timer)
  }, [draft, selectedEndpointId, state.issues, state.phase])

  if (!state.open || draft === null) return null

  const selectedEndpoint = draft.endpoints.find((endpoint) => endpoint.endpointId === selectedEndpointId) ?? draft.endpoints[0] ?? null
  const immediateIssues = validateOpcUaSettingsDraftV1(draft, activeProject)
  const currentIssue = issueMessage(state.issues, interactionIssue, state.error)
  const runtimeKind = presentation.status?.gateway.runtimeKind ?? 'native'
  const deployment = presentation.status?.deployment.opcUaServer
  const server = presentation.status?.opcUa.server
  const diagnostics = presentation.integrationDiagnostics
  const loopback = selectedEndpoint === null ? null : dockerLoopbackWarningV1(runtimeKind, selectedEndpoint.endpointUrl)
  const disabled = busy

  const update = (recipe: (current: OpcUaSettingsDraftV1) => OpcUaSettingsDraftV1): void => {
    if (disabled) return
    invalidateDiagnostic()
    setInteractionIssue(null)
    controller.update(recipe)
  }
  const close = (): void => {
    if (busy) return
    applyInFlightRef.current = null
    invalidateDiagnostic()
    setInteractionIssue(null)
    controller.cancel()
  }
  const apply = (): void => {
    if (busy || applyInFlightRef.current !== null) return
    applyInFlightRef.current = true
    invalidateDiagnostic()
    setInteractionIssue(null)
    try {
      const operation = controller.applyAndActivate()
      applyInFlightRef.current = operation
      void operation
        .catch(() => undefined)
        .finally(() => {
          if (applyInFlightRef.current === operation) applyInFlightRef.current = null
        })
    } catch {
      if (applyInFlightRef.current === true) applyInFlightRef.current = null
    }
  }
  const onTestConnection = (): void => {
    if (selectedEndpoint === null || disabled || testing) return
    testAbortRef.current?.abort()
    const abort = new AbortController()
    testAbortRef.current = abort
    const generation = ++testGenerationRef.current
    setTesting(true)
    setTestResult(null)
    void connectionTest.testEndpoint(selectedEndpoint, abort.signal)
      .then((result) => {
        if (generation === testGenerationRef.current) setTestResult(result)
      })
      .catch((error: unknown) => {
        if (generation !== testGenerationRef.current || (error instanceof Error && error.name === 'AbortError')) return
        setTestResult({ phase: 'failed', namespaceUris: [], elapsedMs: 0, error: error instanceof Error ? error.message : String(error) })
      })
      .finally(() => {
        if (generation === testGenerationRef.current) setTesting(false)
      })
  }
  return (
    <ModalDialogV6
      busy={busy}
      className="opcua-settings-dialog"
      dialogRef={dialogRef}
      footer={<footer className="opcua-settings-footer"><button disabled={disabled} onClick={close} type="button">Cancel</button><button disabled={disabled} form="opcua-settings-v1-form" type="submit">Apply &amp; Activate</button></footer>}
      header={<header className="opcua-settings-header">
          <div>
            <p>Connectivity</p>
            <h2 id="opcua-settings-v1-title">OPC UA Settings</h2>
          </div>
          <p>{busy ? 'Applying settings…' : 'Draft changes are not active until applied.'}</p>
        </header>}
      initialFocusRef={roleRef}
      onClose={close}
      overlayClassName="opcua-settings-overlay"
      testId="opcua-settings-overlay"
      titleId="opcua-settings-v1-title"
      triggerRef={triggerRef}
    >
        <form id="opcua-settings-v1-form" onSubmit={(event) => { event.preventDefault(); apply() }}>
          <div className="opcua-settings-body">
            <section aria-labelledby="opcua-overview-title">
              <h3 id="opcua-overview-title">Overview</h3>
              <dl className="opcua-settings-summary">
                <div><dt>Active revision</dt><dd>{activeProject.revisionId}</dd></div>
                <div><dt>Draft revision</dt><dd>{draft.baseProjectRevisionId}</dd></div>
                <div><dt>Changed sections</dt><dd>{changedSectionCount(draft, activeProject)}</dd></div>
              </dl>
              <label>
                <span>OPC UA role</span>
                <select
                  aria-label="OPC UA role"
                  data-validation-path="$.opcUa.mode"
                  disabled={disabled}
                  onChange={(event) => update((current) => ({ ...current, mode: event.currentTarget.value as WorkcellProjectV5['opcUa']['mode'] }))}
                  ref={roleRef}
                  value={draft.mode}
                >
                  <option value="off">Off</option><option value="client">Client</option><option value="server">Server</option><option value="bridge">Bridge</option>
                </select>
              </label>
              <p>{roleDirection(draft.mode)}</p>
            </section>

            <section aria-labelledby="opcua-client-endpoints-title">
              <h3 id="opcua-client-endpoints-title">Client Endpoints</h3>
              <div className="opcua-settings-actions">
                <button data-validation-path="$.opcUa.endpoints" disabled={disabled || draft.endpoints.length >= MAX_OPC_UA_ENDPOINTS_V5} onClick={() => {
                  let endpointId: string | null = null
                  update((current) => {
                    if (current.endpoints.length >= MAX_OPC_UA_ENDPOINTS_V5) return current
                    endpointId = endpointIdFor(current)
                    return addEndpointV1(current, { endpointId, name: `Endpoint ${current.endpoints.length + 1}`, endpointUrl: 'opc.tcp://localhost:4840', enabled: true, publishingIntervalMs: 100, reconnectDelayMs: 1_000 })
                  })
                  if (endpointId !== null) setSelectedEndpointId(endpointId)
                }} type="button">Add Endpoint</button>
                <button disabled={disabled || selectedEndpoint === null || draft.endpoints.length >= MAX_OPC_UA_ENDPOINTS_V5} onClick={() => {
                  if (selectedEndpoint === null) return
                  let duplicateId: string | null = null
                  update((current) => {
                    if (current.endpoints.length >= MAX_OPC_UA_ENDPOINTS_V5) return current
                    duplicateId = endpointIdFor(current)
                    return duplicateEndpointV1(current, selectedEndpoint.endpointId, duplicateId)
                  })
                  if (duplicateId !== null) setSelectedEndpointId(duplicateId)
                }} type="button">Duplicate Endpoint</button>
                <button disabled={disabled || selectedEndpoint === null} onClick={() => {
                  if (selectedEndpoint === null) return
                  invalidateDiagnostic()
                  const result = deleteEndpointV1(draft, activeProject, selectedEndpoint.endpointId)
                  setInteractionIssue(result.issues[0] ?? null)
                  if (result.issues.length === 0) {
                    controller.update(() => result.draft)
                    setSelectedEndpointId(result.draft.endpoints[0]?.endpointId ?? null)
                  }
                }} type="button">Delete Endpoint</button>
              </div>
              <label>
                <span>Endpoint profile</span>
                <select aria-label="Endpoint profile" data-validation-path="$.opcUa.endpoints" disabled={disabled || draft.endpoints.length === 0} onChange={(event) => { invalidateDiagnostic(); setSelectedEndpointId(event.currentTarget.value); setInteractionIssue(null) }} value={selectedEndpoint?.endpointId ?? ''}>
                  {draft.endpoints.map((endpoint) => <option key={endpoint.endpointId} value={endpoint.endpointId}>{endpoint.name}</option>)}
                </select>
              </label>
              {selectedEndpoint === null ? <p>No Client Endpoint is configured.</p> : <>
                <label><span>Endpoint ID</span><input aria-label="Endpoint ID" readOnly value={selectedEndpoint.endpointId} /></label>
                <label><span>Endpoint name</span><input aria-label="Endpoint name" data-validation-path={`$.opcUa.endpoints[${draft.endpoints.indexOf(selectedEndpoint)}].name`} disabled={disabled} onChange={(event) => update((current) => updateEndpointV1(current, selectedEndpoint.endpointId, { name: event.currentTarget.value }))} value={selectedEndpoint.name} /></label>
                <label><span>Endpoint URL</span><input aria-label="Endpoint URL" data-validation-path={`$.opcUa.endpoints[${draft.endpoints.indexOf(selectedEndpoint)}].endpointUrl`} disabled={disabled} onChange={(event) => update((current) => updateEndpointV1(current, selectedEndpoint.endpointId, { endpointUrl: event.currentTarget.value }))} value={selectedEndpoint.endpointUrl} /></label>
                <label><span>Enabled</span><input aria-label="Enabled" checked={selectedEndpoint.enabled} data-validation-path={`$.opcUa.endpoints[${draft.endpoints.indexOf(selectedEndpoint)}].enabled`} disabled={disabled} onChange={(event) => update((current) => updateEndpointV1(current, selectedEndpoint.endpointId, { enabled: event.currentTarget.checked }))} type="checkbox" /></label>
                <label><span>Publishing interval (ms)</span><input aria-label="Publishing interval (ms)" data-validation-path={`$.opcUa.endpoints[${draft.endpoints.indexOf(selectedEndpoint)}].publishingIntervalMs`} disabled={disabled} onChange={(event) => update((current) => updateEndpointV1(current, selectedEndpoint.endpointId, { publishingIntervalMs: numberValue(event.currentTarget.value) }))} type="number" value={selectedEndpoint.publishingIntervalMs} /></label>
                <label><span>Reconnect delay (ms)</span><input aria-label="Reconnect delay (ms)" data-validation-path={`$.opcUa.endpoints[${draft.endpoints.indexOf(selectedEndpoint)}].reconnectDelayMs`} disabled={disabled} onChange={(event) => update((current) => updateEndpointV1(current, selectedEndpoint.endpointId, { reconnectDelayMs: numberValue(event.currentTarget.value) }))} type="number" value={selectedEndpoint.reconnectDelayMs} /></label>
                <p>Mappings: {mappingCount(activeProject, selectedEndpoint.endpointId)}</p>
                <button data-validation-path="$.opcUa.mappings" disabled={disabled} onClick={onOpenBindingOverview} type="button">Open Binding Overview</button>
                <button disabled={disabled || testing} onClick={onTestConnection} type="button">Test Connection</button>
                {testResult === null ? null : <p role="status">{testResult.phase === 'connected' ? `Connected in ${testResult.elapsedMs} ms` : testResult.error}</p>}
                {loopback === null ? null : <aside className="opcua-loopback-warning"><p>{loopback.message}</p><button disabled={disabled} onClick={() => update((current) => replaceLoopbackHostV1(current, selectedEndpoint.endpointId, 'host.docker.internal'))} type="button">Use host.docker.internal</button></aside>}
              </>}
            </section>

            <section aria-labelledby="opcua-server-title">
              <h3 id="opcua-server-title">Server</h3>
              <p>Listener phase: {server?.phase ?? 'unavailable'}</p><p>Listener endpoint: {server?.endpointUrl ?? 'Unavailable'}</p>
              <label><span>Listener host</span><input aria-label="Listener host" readOnly value={deployment?.bindHost ?? ''} /></label>
              <label><span>Listener port</span><input aria-label="Listener port" readOnly value={deployment?.port ?? ''} /></label>
              <label><span>Advertised host</span><input aria-label="Advertised host" readOnly value={deployment?.advertisedHost ?? ''} /></label>
              <label><span>Advertised port</span><input aria-label="Advertised port" readOnly value={deployment?.advertisedPort ?? ''} /></label>
              <p>Robotics: {diagnostics?.serverModel.roboticsModel ?? 'unavailable'}</p><p>Product: {diagnostics?.serverModel.productModel ?? 'unavailable'}</p>
            </section>

            <section aria-labelledby="opcua-bridge-routes-title">
              <h3 data-validation-path="$.opcUa.bridgeRoutes" id="opcua-bridge-routes-title" tabIndex={-1}>Bridge Routes</h3>
              <button disabled={disabled || activeProject.opcUa.mappings.length === 0} onClick={() => update((current) => {
                const mappingId = activeProject.opcUa.mappings[0]!.id
                const route: OpcUaBridgeRouteV5 = { id: routeIdFor(current), sourceMappingId: mappingId, destinationMappingId: mappingId, direction: 'forward', scale: 1, offset: 0, unit: '' }
                return addBridgeRouteV1(current, route)
              })} type="button">Add Bridge Route</button>
              {draft.bridgeRoutes.map((route, index) => <div className="opcua-bridge-route" data-validation-path={`$.opcUa.bridgeRoutes[${index}]`} key={route.id} tabIndex={-1}>
                <label><span>Source mapping</span><select aria-label={`Source mapping ${route.id}`} data-validation-path={`$.opcUa.bridgeRoutes[${index}].sourceMappingId`} disabled={disabled} onChange={(event) => update((current) => updateBridgeRouteV1(current, route.id, { sourceMappingId: event.currentTarget.value }))} value={route.sourceMappingId}>{activeProject.opcUa.mappings.map((mapping) => <option key={mapping.id} value={mapping.id}>{mapping.id}</option>)}</select></label>
                <label><span>Destination mapping</span><select aria-label={`Destination mapping ${route.id}`} data-validation-path={`$.opcUa.bridgeRoutes[${index}].destinationMappingId`} disabled={disabled} onChange={(event) => update((current) => updateBridgeRouteV1(current, route.id, { destinationMappingId: event.currentTarget.value }))} value={route.destinationMappingId}>{activeProject.opcUa.mappings.map((mapping) => <option key={mapping.id} value={mapping.id}>{mapping.id}</option>)}</select></label>
                <label><span>Scale</span><input aria-label={`Scale ${route.id}`} data-validation-path={`$.opcUa.bridgeRoutes[${index}].scale`} disabled={disabled} onChange={(event) => update((current) => updateBridgeRouteV1(current, route.id, { scale: numberValue(event.currentTarget.value) }))} type="number" value={route.scale} /></label>
                <label><span>Offset</span><input aria-label={`Offset ${route.id}`} data-validation-path={`$.opcUa.bridgeRoutes[${index}].offset`} disabled={disabled} onChange={(event) => update((current) => updateBridgeRouteV1(current, route.id, { offset: numberValue(event.currentTarget.value) }))} type="number" value={route.offset} /></label>
                <label><span>Unit</span><input aria-label={`Unit ${route.id}`} data-validation-path={`$.opcUa.bridgeRoutes[${index}].unit`} disabled={disabled} onChange={(event) => update((current) => updateBridgeRouteV1(current, route.id, { unit: event.currentTarget.value }))} value={route.unit} /></label>
                <button disabled={disabled} onClick={() => update((current) => deleteBridgeRouteV1(current, route.id))} type="button">Delete Bridge Route</button>
              </div>)}
              {immediateIssues.filter((issue) => issue.path.startsWith('$.opcUa.bridgeRoutes')).map((issue) => <p key={`${issue.code}:${issue.path}`} role="status">{issue.message}</p>)}
            </section>

            <section aria-labelledby="opcua-diagnostics-title">
              <h3 id="opcua-diagnostics-title">Diagnostics</h3>
              <p>Runtime kind: {runtimeKind}</p><p>Health: /runtime/healthz</p><p>Readiness: /runtime/readyz</p>
              <button disabled={disabled} onClick={onOpenDockerRunGuide} type="button">Open Docker Run Guide</button>
            </section>
            {currentIssue === null ? null : <p data-validation-path="$" role="alert" tabIndex={-1}>{currentIssue}</p>}
          </div>
        </form>
    </ModalDialogV6>
  )
}
