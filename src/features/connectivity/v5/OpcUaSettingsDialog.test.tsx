import { fireEvent, render, screen, waitFor } from '@testing-library/react'
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
  presentationState = presentation(),
  connectionTest = { testEndpoint: vi.fn(async () => ({ phase: 'connected' as const, namespaceUris: ['urn:test'], elapsedMs: 4, error: null })) },
  onOpenBindingOverview = vi.fn(),
  onOpenDockerRunGuide = vi.fn(),
}: {
  readonly active?: WorkcellProjectV5
  readonly activation?: OpcUaSettingsActivationServiceV1
  readonly presentationState?: ConnectivityPresentationStateV1
  readonly connectionTest?: OpcUaConnectionTestPortV1
  readonly onOpenBindingOverview?: () => void
  readonly onOpenDockerRunGuide?: () => void
}) {
  const triggerRef = useRef<HTMLButtonElement>(null)
  const controllerRef = useRef(createOpcUaSettingsControllerV1(activation))
  const props: OpcUaSettingsDialogPropsV1 = {
    activeProject: active, controller: controllerRef.current, connectionTest,
    onOpenBindingOverview, onOpenDockerRunGuide, presentation: presentationState, triggerRef,
  }
  return <><button onClick={() => controllerRef.current.open(active)} ref={triggerRef} type="button">OPC UA Settings</button><OpcUaSettingsDialog {...props} /></>
}

describe('OpcUaSettingsDialog', () => {
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
    screen.getByRole('button', { name: 'Apply & Activate' }).focus()
    fireEvent.keyDown(dialog, { key: 'Tab' })
    expect(role).toHaveFocus()
    fireEvent.keyDown(dialog, { key: 'Tab', shiftKey: true })
    expect(screen.getByRole('button', { name: 'Apply & Activate' })).toHaveFocus()
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
    const url = screen.getByLabelText('Endpoint URL')
    await user.clear(url); await user.type(url, 'opc.tcp://127.0.0.1:4840')
    expect(screen.getByText(/host\.docker\.internal/i)).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Use host.docker.internal' }))
    expect(url).toHaveValue('opc.tcp://host.docker.internal:4840')
    await user.click(screen.getByRole('button', { name: 'Test Connection' }))
    await waitFor(() => expect(connectionTest.testEndpoint).toHaveBeenCalledOnce())
    expect(screen.getByRole('status')).toHaveTextContent('Connected in 5 ms')
    expect(screen.getByRole('button', { name: 'Apply & Activate' })).toBeEnabled()
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
    await user.click(screen.getByRole('button', { name: 'Delete Bridge Route' }))
    await user.clear(screen.getByLabelText('Endpoint name'))
    await user.click(screen.getByRole('button', { name: 'Apply & Activate' }))
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('UTF-8 length'))
    expect(screen.getByLabelText('Endpoint name')).toHaveFocus()
    expect(screen.getByLabelText('Endpoint name')).toHaveValue('')
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
    await user.click(screen.getByRole('button', { name: 'Apply & Activate' }))
    expect(screen.getByLabelText('OPC UA role')).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Apply & Activate' })).toBeDisabled()
    resolve(published(active))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(trigger).toHaveFocus()
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
