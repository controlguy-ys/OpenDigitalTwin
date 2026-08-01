import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useRef } from 'react'
import { describe, expect, it, vi } from 'vitest'

import {
  validateWorkcellProjectV5,
  type WorkcellProjectV5,
} from '../../../core/project-v5/index.js'
import { cloneWorkcellProjectV5, makeMinimalWorkcellProjectV5 } from '../../../core/project-v5/test-support.js'
import type { RuntimeGatewayStatusV1 } from '../../../core/runtime-protocol/gateway-status-v1.js'
import type { RuntimeIntegrationDiagnosticsV1 } from '../../../core/runtime-protocol/integration-diagnostics-v1.js'
import type { PublishedProjectV5 } from '../../project/v5/project-v5-publication.js'
import type { ConnectivityPresentationStateV1 } from './connectivity-presentation-store.js'
import {
  createOpcUaSettingsControllerV1,
  type OpcUaSettingsActivationServiceV1,
  type OpcUaSettingsControllerV1,
} from './opcua-settings-activation.js'
import { validateOpcUaSettingsDraftV1 } from './opcua-settings-draft.js'
import { OpcUaSettingsDialog, type OpcUaSettingsDialogPropsV1 } from './OpcUaSettingsDialog.js'
import type { OpcUaConnectionTestPortV1 } from '../../runtime-gateway/v5/runtime-gateway-connection-test.js'

function project(): WorkcellProjectV5 {
  return validateWorkcellProjectV5(makeMinimalWorkcellProjectV5())
}

function published(value: WorkcellProjectV5): PublishedProjectV5 {
  return { project: value, revisionId: value.revisionId, configRevision: 'a'.repeat(64) }
}

function deferred<Value>() {
  let resolve!: (value: Value) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<Value>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, reject, resolve }
}

function tabbables(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(
    'button, input, select, textarea, [tabindex]',
  )).filter((element) => (
    element.tabIndex >= 0
    && element.closest('[hidden]') === null
    && (!('disabled' in element) || element.disabled !== true)
  ))
}

function status(runtimeKind: 'native' | 'docker' = 'native'): RuntimeGatewayStatusV1 {
  return {
    type: 'runtime-gateway-status-v1', protocolVersion: 1, observedAtMs: 1,
    gateway: { gatewayId: 'gateway', phase: 'online', runtimeKind },
    deployment: {
      http: { bindHost: '127.0.0.1', port: 8080 },
      opcUaServer: { bindHost: '0.0.0.0', port: 4841, advertisedHost: '127.0.0.1', advertisedPort: 4841 },
    },
    project: { phase: 'ready', authorityPhase: 'active', projectId: 'project', revisionId: 'revision', configRevision: 'a'.repeat(64), activationAttemptId: 'attempt-0001', readinessCode: 'READY' },
    opcUa: { mode: 'client', server: { phase: 'disabled', endpointUrl: null, lastError: null }, clientEndpoints: [] },
  }
}

function diagnostics(): RuntimeIntegrationDiagnosticsV1 {
  return {
    type: 'runtime-integration-diagnostics-v1', protocolVersion: 1, observedAtMs: 1,
    projectId: 'project', revisionId: 'revision', configRevision: 'a'.repeat(64),
    serverModel: { standardNodeSets: 'loaded', roboticsModel: 'ready', productModel: 'ready', activeSessionCount: 0, maximumSessionCount: 16, lastError: null },
    browserPublisher: { phase: 'absent', publisherId: null, generation: null, expiresAt: null }, lastCommandResult: null,
  }
}

function presentation(kind: 'native' | 'docker' = 'native'): ConnectivityPresentationStateV1 {
  return {
    gateway: { state: 'online', label: 'Online', detail: 'Runtime Gateway responded.' },
    opcUa: { state: 'client-connected', label: 'Connected', detail: 'Project: READY' },
    status: status(kind), integrationDiagnostics: diagnostics(), transportError: null, lastObservedAtMs: 1,
    statusFreshness: 'current', transportErrorOccurredAtMs: null,
  }
}

function service(active: WorkcellProjectV5, options: { readonly pending?: Promise<PublishedProjectV5>; readonly reject?: Error } = {}): OpcUaSettingsActivationServiceV1 {
  return {
    validate: (draft) => validateOpcUaSettingsDraftV1(draft, active),
    apply: vi.fn(async (draft) => {
      if (options.pending !== undefined) return options.pending
      if (options.reject !== undefined) throw options.reject
      return published({ ...active, opcUa: { ...active.opcUa, mode: draft.mode, endpoints: draft.endpoints, bridgeRoutes: draft.bridgeRoutes } })
    }),
  }
}

function Harness({
  active = project(),
  activation = service(active),
  controller,
  presentationState = presentation(),
  connectionTest = { testEndpoint: vi.fn(async () => ({ phase: 'connected' as const, namespaceUris: ['urn:test'], elapsedMs: 4, error: null })) },
  onOpenBindingOverview = vi.fn(),
  onOpenDockerRunGuide = vi.fn(),
}: {
  readonly active?: WorkcellProjectV5
  readonly activation?: OpcUaSettingsActivationServiceV1
  readonly controller?: OpcUaSettingsControllerV1
  readonly presentationState?: ConnectivityPresentationStateV1
  readonly connectionTest?: OpcUaConnectionTestPortV1
  readonly onOpenBindingOverview?: () => void
  readonly onOpenDockerRunGuide?: () => void
}) {
  const triggerRef = useRef<HTMLButtonElement>(null)
  const controllerRef = useRef(controller ?? createOpcUaSettingsControllerV1(activation))
  const props: OpcUaSettingsDialogPropsV1 = {
    activeProject: active, controller: controllerRef.current, connectionTest,
    onOpenBindingOverview, onOpenDockerRunGuide, presentation: presentationState, triggerRef,
  }
  return <><button onClick={() => controllerRef.current.open(active)} ref={triggerRef} type="button">OPC UA Settings</button><OpcUaSettingsDialog {...props} /></>
}

describe('OpcUaSettingsDialog', () => {
  it('does not apply an unchanged draft submitted directly', async () => {
    const user = userEvent.setup()
    const active = project()
    const applyAndActivate = vi.fn()
    const baseController = createOpcUaSettingsControllerV1(service(active))
    const controller: OpcUaSettingsControllerV1 = { ...baseController, applyAndActivate }
    render(<Harness active={active} controller={controller} />)
    await user.click(screen.getByRole('button', { name: 'OPC UA Settings' }))

    const apply = screen.getByRole('button', { name: 'Apply & Activate' })
    const helper = screen.getByText('No changes to apply.')
    expect(screen.getByText('Changed sections').nextElementSibling).toHaveTextContent('0')
    expect(apply).toBeDisabled()
    expect(helper).toBeVisible()
    expect(apply).toHaveAttribute('aria-describedby', helper.id)

    fireEvent.submit(screen.getByRole('dialog').querySelector('form')!)
    expect(applyAndActivate).not.toHaveBeenCalled()
  })

  it('enables Apply for one changed section and disables it again when reverted', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await user.click(screen.getByRole('button', { name: 'OPC UA Settings' }))

    const role = screen.getByLabelText('OPC UA role')
    const apply = screen.getByRole('button', { name: 'Apply & Activate' })
    await user.selectOptions(role, 'bridge')
    expect(screen.getByText('Changed sections').nextElementSibling).toHaveTextContent('1')
    expect(apply).toBeEnabled()
    await user.selectOptions(role, 'client')
    expect(screen.getByText('Changed sections').nextElementSibling).toHaveTextContent('0')
    expect(apply).toBeDisabled()
  })

  it('cancels the disposable Draft without mutation and restores trigger focus', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    const trigger = screen.getByRole('button', { name: 'OPC UA Settings' })
    await user.click(trigger)
    await user.selectOptions(screen.getByLabelText('OPC UA role'), 'bridge')
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
  })

  it('contains focus and permits Escape or overlay cancel while idle', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    const trigger = screen.getByRole('button', { name: 'OPC UA Settings' })
    await user.click(trigger)
    const dialog = screen.getByRole('dialog', { name: 'OPC UA Settings' })
    const role = screen.getByLabelText('OPC UA role')
    await waitFor(() => expect(role).toHaveFocus())
    const focusable = tabbables(dialog)
    const first = focusable[0]!
    const last = focusable.at(-1)!
    expect(first).toBe(role)
    last.focus()
    fireEvent.keyDown(dialog, { key: 'Tab' })
    expect(first).toHaveFocus()
    fireEvent.keyDown(dialog, { key: 'Tab', shiftKey: true })
    expect(last).toHaveFocus()
    fireEvent.keyDown(dialog, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
    await user.click(trigger)
    fireEvent.mouseDown(screen.getByTestId('opcua-settings-overlay'))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('shows Server deployment fields as read-only status, never Draft fields', async () => {
    const user = userEvent.setup()
    render(<Harness presentationState={presentation('docker')} />)
    await user.click(screen.getByRole('button', { name: 'OPC UA Settings' }))
    expect(screen.getByLabelText('Listener port')).toHaveValue('4841')
    expect(screen.getByLabelText('Listener port')).toHaveAttribute('readonly')
    expect(screen.getByLabelText('Advertised host')).toHaveValue('127.0.0.1')
    expect(screen.getByText('Robotics: ready')).toBeVisible()
    expect(screen.getByText('Product: ready')).toBeVisible()
  })

  it('enforces the exact eight-endpoint add limit and protects an in-use endpoint', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await user.click(screen.getByRole('button', { name: 'OPC UA Settings' }))
    const add = screen.getByRole('button', { name: 'Add Endpoint' })
    for (let count = 1; count < 8; count += 1) await user.click(add)
    expect(add).toBeDisabled()
    await user.selectOptions(screen.getByLabelText('Endpoint profile'), 'endpoint-1')
    await user.click(screen.getByRole('button', { name: 'Delete Endpoint' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Cannot delete an OPC UA Endpoint while a Mapping references it.')
  })

  it('guards Duplicate at eight and rejects a stale double event from creating a ninth endpoint', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await user.click(screen.getByRole('button', { name: 'OPC UA Settings' }))
    const add = screen.getByRole('button', { name: 'Add Endpoint' })
    for (let count = 1; count < 7; count += 1) await user.click(add)
    const duplicate = screen.getByRole('button', { name: 'Duplicate Endpoint' })

    act(() => {
      fireEvent.click(duplicate)
      fireEvent.click(duplicate)
    })

    expect(screen.getByLabelText('Endpoint profile').querySelectorAll('option')).toHaveLength(8)
    expect(screen.getByRole('button', { name: 'Duplicate Endpoint' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Add Endpoint' })).toBeDisabled()
  })

  it('duplicates endpoints, reports active mapping count, and opens the Binding Overview callback', async () => {
    const user = userEvent.setup()
    const onOpenBindingOverview = vi.fn()
    render(<Harness onOpenBindingOverview={onOpenBindingOverview} />)
    await user.click(screen.getByRole('button', { name: 'OPC UA Settings' }))
    expect(screen.getByText('Mappings: 1')).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Duplicate Endpoint' }))
    expect(screen.getByLabelText('Endpoint profile')).toHaveTextContent('Copy')
    await user.click(screen.getByRole('button', { name: 'Open Binding Overview' }))
    expect(onOpenBindingOverview).toHaveBeenCalledOnce()
  })

  it('runs Test Connection only through the diagnostic port and requires explicit Docker loopback replacement', async () => {
    const user = userEvent.setup()
    const connectionTest: OpcUaConnectionTestPortV1 = { testEndpoint: vi.fn(async () => ({ phase: 'connected' as const, namespaceUris: ['urn:controller'], elapsedMs: 5, error: null })) }
    render(<Harness connectionTest={connectionTest} presentationState={presentation('docker')} />)
    await user.click(screen.getByRole('button', { name: 'OPC UA Settings' }))
    await user.click(screen.getByRole('button', { name: 'Test Connection' }))
    await waitFor(() => expect(connectionTest.testEndpoint).toHaveBeenCalledOnce())
    expect(screen.getByRole('button', { name: 'Apply & Activate' })).toBeDisabled()
    const url = screen.getByLabelText('Endpoint URL')
    await user.clear(url); await user.type(url, 'opc.tcp://127.0.0.1:4840')
    expect(screen.getByText(/host\.docker\.internal/i)).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Use host.docker.internal' }))
    expect(url).toHaveValue('opc.tcp://host.docker.internal:4840')
    await user.click(screen.getByRole('button', { name: 'Test Connection' }))
    await waitFor(() => expect(connectionTest.testEndpoint).toHaveBeenCalledTimes(2))
    expect(screen.getByRole('status')).toHaveTextContent('Connected in 5 ms')
    expect(screen.getByRole('button', { name: 'Apply & Activate' })).toBeEnabled()
  })

  it('invalidates ignored diagnostic completions across edits, switch, delete, cancel, success, reopen, and unmount', async () => {
    const user = userEvent.setup()
    const calls: Array<{
      readonly signal: AbortSignal | undefined
      readonly operation: ReturnType<typeof deferred<Awaited<ReturnType<OpcUaConnectionTestPortV1['testEndpoint']>>>>
    }> = []
    const connectionTest: OpcUaConnectionTestPortV1 = {
      testEndpoint: vi.fn((_endpoint, signal) => {
        const operation = deferred<Awaited<ReturnType<OpcUaConnectionTestPortV1['testEndpoint']>>>()
        calls.push({ signal, operation })
        return operation.promise
      }),
    }
    const rendered = render(<Harness connectionTest={connectionTest} />)
    const open = async () => user.click(screen.getByRole('button', { name: 'OPC UA Settings' }))
    const test = async () => user.click(screen.getByRole('button', { name: 'Test Connection' }))

    await open()
    await test()
    await user.type(screen.getByLabelText('Endpoint name'), ' edited')
    expect(calls[0]!.signal?.aborted).toBe(true)
    expect(screen.getByRole('button', { name: 'Test Connection' })).toBeEnabled()
    await act(async () => calls[0]!.operation.resolve({ phase: 'connected', namespaceUris: ['urn:late'], elapsedMs: 99, error: null }))
    expect(screen.queryByText('Connected in 99 ms')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Add Endpoint' }))
    await user.selectOptions(screen.getByLabelText('Endpoint profile'), 'endpoint-1')
    await test()
    await user.selectOptions(screen.getByLabelText('Endpoint profile'), 'endpoint-2')
    expect(calls[1]!.signal?.aborted).toBe(true)
    expect(screen.getByRole('button', { name: 'Test Connection' })).toBeEnabled()

    await test()
    await user.click(screen.getByRole('button', { name: 'Delete Endpoint' }))
    expect(calls[2]!.signal?.aborted).toBe(true)
    expect(screen.getByLabelText('Endpoint profile')).toHaveValue('endpoint-1')

    await test()
    await user.click(screen.getByRole('button', { name: 'Delete Endpoint' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Cannot delete')
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(calls[3]!.signal?.aborted).toBe(true)
    await open()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Test Connection' })).toBeEnabled()

    await test()
    await user.selectOptions(screen.getByLabelText('OPC UA role'), 'bridge')
    await user.click(screen.getByRole('button', { name: 'Apply & Activate' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(calls[4]!.signal?.aborted).toBe(true)
    await open()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()

    await test()
    rendered.unmount()
    expect(calls[5]!.signal?.aborted).toBe(true)
    await act(async () => calls[5]!.operation.resolve({ phase: 'connected', namespaceUris: ['urn:unmounted'], elapsedMs: 1, error: null }))
  })

  it('surfaces immediate Bridge Route validation and focuses the first failed field without discarding edits', async () => {
    const user = userEvent.setup()
    const source = cloneWorkcellProjectV5(project())
    const twoMappingProject = validateWorkcellProjectV5({
      ...source,
      logicalSignals: [...source.logicalSignals, { ...source.logicalSignals[0]!, id: 'SecondSignal', name: 'Second Signal' }],
      opcUa: { ...source.opcUa, mappings: [
        source.opcUa.mappings[0]!,
        { ...source.opcUa.mappings[0]!, id: 'mapping-2', nodeAddress: { ...source.opcUa.mappings[0]!.nodeAddress, identifier: 'Signals.Second' }, leaves: source.opcUa.mappings[0]!.leaves.map((leaf) => ({ ...leaf, projectTarget: { type: 'logical-signal', signalId: 'SecondSignal' } })) },
      ] },
    })
    render(<Harness active={twoMappingProject} />)
    await user.click(screen.getByRole('button', { name: 'OPC UA Settings' }))
    await user.click(screen.getByRole('button', { name: 'Add Bridge Route' }))
    expect(screen.getByText(/Bridge route cannot echo a Mapping to itself\./)).toBeVisible()
    await user.selectOptions(screen.getByLabelText('OPC UA role'), 'bridge')
    await user.click(screen.getByRole('button', { name: 'Apply & Activate' }))
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Bridge route cannot echo'))
    const routeTarget = screen.getByLabelText('Source mapping bridge-route-1').closest<HTMLElement>('[data-validation-path="$.opcUa.bridgeRoutes[0]"]')
    expect(routeTarget).toHaveAttribute('tabindex', '-1')
    expect(routeTarget).toHaveFocus()
    await user.click(screen.getByRole('button', { name: 'Delete Bridge Route' }))
    await user.clear(screen.getByLabelText('Endpoint name'))
    await user.click(screen.getByRole('button', { name: 'Apply & Activate' }))
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('UTF-8 length'))
    expect(screen.getByLabelText('Endpoint name')).toHaveFocus()
    expect(screen.getByLabelText('Endpoint name')).toHaveValue('')
  })

  it.each([
    { path: '$.opcUa.endpoints', target: 'endpoint-root' },
    { path: '$.unsupported', target: 'summary' },
  ] as const)('focuses the stable $target target for validation path $path', async ({ path, target }) => {
    const user = userEvent.setup()
    const active = project()
    const activation: OpcUaSettingsActivationServiceV1 = {
      validate: () => [{ code: 'TEST_ISSUE', path, message: `Issue at ${path}` }],
      apply: vi.fn(async () => published(active)),
    }
    render(<Harness active={active} activation={activation} />)
    await user.click(screen.getByRole('button', { name: 'OPC UA Settings' }))
    await user.selectOptions(screen.getByLabelText('OPC UA role'), 'bridge')
    await user.click(screen.getByRole('button', { name: 'Apply & Activate' }))
    const alert = await screen.findByRole('alert')
    const expected = target === 'endpoint-root'
      ? screen.getByRole('button', { name: 'Add Endpoint' })
      : alert
    await waitFor(() => expect(expected).toHaveFocus())
  })

  it('focuses the Endpoint profile for an endpoint-root issue when Add is disabled at eight', async () => {
    const user = userEvent.setup()
    const active = project()
    const activation: OpcUaSettingsActivationServiceV1 = {
      validate: () => [{ code: 'TEST_ENDPOINT_ROOT', path: '$.opcUa.endpoints', message: 'Endpoint list issue' }],
      apply: vi.fn(async () => published(active)),
    }
    render(<Harness active={active} activation={activation} />)
    await user.click(screen.getByRole('button', { name: 'OPC UA Settings' }))
    await user.selectOptions(screen.getByLabelText('OPC UA role'), 'bridge')
    const add = screen.getByRole('button', { name: 'Add Endpoint' })
    for (let count = 1; count < 8; count += 1) await user.click(add)
    expect(add).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'Apply & Activate' }))
    await waitFor(() => expect(screen.getByLabelText('Endpoint profile')).toHaveFocus())
  })

  it('disables changes while Apply is busy, retains an async failure, and restores focus after success', async () => {
    const user = userEvent.setup()
    let resolve!: (value: PublishedProjectV5) => void
    const pending = new Promise<PublishedProjectV5>((done) => { resolve = done })
    const active = project()
    const activation = service(active, { pending })
    render(<Harness active={active} activation={activation} />)
    const trigger = screen.getByRole('button', { name: 'OPC UA Settings' })
    await user.click(trigger)
    await user.selectOptions(screen.getByLabelText('OPC UA role'), 'bridge')
    await user.click(screen.getByRole('button', { name: 'Apply & Activate' }))
    expect(screen.getByLabelText('OPC UA role')).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Apply & Activate' })).toBeDisabled()
    resolve(published(active))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(trigger).toHaveFocus()
  })

  it('recovers browser-lost focus after Apply disables its button and traps Tab while busy', async () => {
    const user = userEvent.setup()
    const active = project()
    const pending = deferred<PublishedProjectV5>()
    render(<Harness active={active} activation={service(active, { pending: pending.promise })} />)
    await user.click(screen.getByRole('button', { name: 'OPC UA Settings' }))
    await user.selectOptions(screen.getByLabelText('OPC UA role'), 'bridge')
    const dialog = screen.getByRole('dialog')
    const apply = screen.getByRole('button', { name: 'Apply & Activate' })
    const setAttribute = Element.prototype.setAttribute
    let simulatedBrowserFocusLoss = false
    document.body.tabIndex = -1
    Object.defineProperty(Element.prototype, 'setAttribute', {
      configurable: true,
      value(this: Element, name: string, value: string) {
        setAttribute.call(this, name, value)
        if (name === 'disabled' && document.activeElement === this) {
          simulatedBrowserFocusLoss = true
          document.body.focus()
        }
      },
    })
    try {
      await user.click(apply)
      expect(simulatedBrowserFocusLoss).toBe(true)
      expect(apply).toBeDisabled()
      const focusable = tabbables(dialog)
      const first = focusable[0]!
      const last = focusable.at(-1)!
      expect(focusable).not.toContain(apply)
      expect(document.body).not.toHaveFocus()
      expect(first).toHaveFocus()

      last.focus()
      await user.tab()
      expect(first).toHaveFocus()
      await user.tab({ shift: true })
      expect(last).toHaveFocus()
    } finally {
      Object.defineProperty(Element.prototype, 'setAttribute', {
        configurable: true,
        value: setAttribute,
        writable: true,
      })
      document.body.removeAttribute('tabindex')
    }

    pending.resolve(published(active))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('contains Escape and closes only while idle', async () => {
    const user = userEvent.setup()
    const propagated = vi.fn()
    document.addEventListener('keydown', propagated)
    render(<Harness />)
    await user.click(screen.getByRole('button', { name: 'OPC UA Settings' }))
    const idleEscape = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'Escape' })
    act(() => screen.getByRole('dialog').dispatchEvent(idleEscape))
    expect(idleEscape.defaultPrevented).toBe(true)
    expect(propagated).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    document.removeEventListener('keydown', propagated)

    const pending = deferred<PublishedProjectV5>()
    const active = project()
    const busyPropagated = vi.fn()
    document.addEventListener('keydown', busyPropagated)
    render(<Harness active={active} activation={service(active, { pending: pending.promise })} />)
    await user.click(screen.getAllByRole('button', { name: 'OPC UA Settings' }).at(-1)!)
    await user.selectOptions(screen.getAllByLabelText('OPC UA role').at(-1)!, 'bridge')
    await user.click(screen.getByRole('button', { name: 'Apply & Activate' }))
    const busyEscape = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'Escape' })
    act(() => screen.getByRole('dialog').dispatchEvent(busyEscape))
    expect(busyEscape.defaultPrevented).toBe(true)
    expect(busyPropagated).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog')).toBeVisible()
    document.removeEventListener('keydown', busyPropagated)
    pending.resolve(published(active))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('ignores composing Escape without consuming it or closing the dialog', async () => {
    const user = userEvent.setup()
    const propagated = vi.fn()
    document.addEventListener('keydown', propagated)
    try {
      render(<Harness />)
      await user.click(screen.getByRole('button', { name: 'OPC UA Settings' }))
      const composingEscape = new KeyboardEvent('keydown', {
        bubbles: true,
        cancelable: true,
        key: 'Escape',
      })
      Object.defineProperty(composingEscape, 'isComposing', { value: true })

      act(() => screen.getByRole('dialog').dispatchEvent(composingEscape))

      expect(composingEscape.defaultPrevented).toBe(false)
      expect(propagated).toHaveBeenCalledOnce()
      expect(screen.getByRole('dialog')).toBeVisible()
    } finally {
      document.removeEventListener('keydown', propagated)
    }
  })

  it('coalesces rapid Apply events before crossing the controller boundary', async () => {
    const active = project()
    const pending = deferred<PublishedProjectV5>()
    const activation = service(active, { pending: pending.promise })
    const baseController = createOpcUaSettingsControllerV1(activation)
    const applyAndActivate = vi.fn(() => baseController.applyAndActivate())
    const controller: OpcUaSettingsControllerV1 = { ...baseController, applyAndActivate }
    render(<Harness active={active} controller={controller} />)
    await userEvent.setup().click(screen.getByRole('button', { name: 'OPC UA Settings' }))
    await userEvent.setup().selectOptions(screen.getByLabelText('OPC UA role'), 'bridge')
    const apply = screen.getByRole('button', { name: 'Apply & Activate' })
    act(() => {
      fireEvent.click(apply)
      fireEvent.click(apply)
    })
    expect(applyAndActivate).toHaveBeenCalledOnce()
    expect(activation.apply).toHaveBeenCalledOnce()
    pending.resolve(published(active))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('releases the dialog-local Apply guard after rejection so a later retry can succeed', async () => {
    const user = userEvent.setup()
    const active = project()
    const activation: OpcUaSettingsActivationServiceV1 = {
      validate: (draft) => validateOpcUaSettingsDraftV1(draft, active),
      apply: vi.fn()
        .mockRejectedValueOnce(new Error('Gateway activation rejected'))
        .mockResolvedValueOnce(published(active)),
    }
    const baseController = createOpcUaSettingsControllerV1(activation)
    const applyAndActivate = vi.fn(() => baseController.applyAndActivate())
    const controller: OpcUaSettingsControllerV1 = { ...baseController, applyAndActivate }
    render(<Harness active={active} controller={controller} />)
    await user.click(screen.getByRole('button', { name: 'OPC UA Settings' }))
    await user.selectOptions(screen.getByLabelText('OPC UA role'), 'bridge')

    await user.click(screen.getByRole('button', { name: 'Apply & Activate' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Gateway activation rejected')
    await user.click(screen.getByRole('button', { name: 'Apply & Activate' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(applyAndActivate).toHaveBeenCalledTimes(2)
    expect(activation.apply).toHaveBeenCalledTimes(2)
  })

  it('retains all Draft inputs and presents one alert when asynchronous Apply rejects', async () => {
    const user = userEvent.setup()
    const active = project()
    render(<Harness active={active} activation={service(active, { reject: new Error('Gateway activation rejected') })} />)
    await user.click(screen.getByRole('button', { name: 'OPC UA Settings' }))
    const name = screen.getByLabelText('Endpoint name')
    await user.clear(name); await user.type(name, 'Retained controller')
    await user.click(screen.getByRole('button', { name: 'Apply & Activate' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Gateway activation rejected')
    expect(screen.getByRole('dialog')).toBeVisible()
    expect(name).toHaveValue('Retained controller')
    expect(screen.getAllByRole('alert')).toHaveLength(1)
  })
})
