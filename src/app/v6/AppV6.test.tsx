import { StrictMode } from 'react'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { validateWorkcellProjectV5, type WorkcellProjectV5 } from '../../core/project-v5/index.js'
import { makeMinimalWorkcellProjectV5 } from '../../core/project-v5/test-support.js'
import { validateRuntimeGatewayStatusV1, type RuntimeGatewayStatusV1 } from '../../core/runtime-protocol/gateway-status-v1.js'
import { createBrowserProjectApplicationResourcesV5, type BrowserProjectApplicationResourcesV5 } from '../../features/project/v5/browser-project-resources-v5.js'
import { createBrowserProjectRuntimeV5 } from '../../features/project/v5/browser-project-runtime-v5.js'
import { ProjectDatabaseV5 } from '../../features/project/v5/project-v5-db.js'
import { AppV6 } from './AppV6.js'

vi.mock('../../features/scene/v5/V5WorkcellWorkspace.js', () => ({
  V5WorkcellCanvas: ({ project, bundle }: { project: WorkcellProjectV5; bundle: { readonly runtimeEpoch: number } | null }) => <div data-testid="runtime-canvas">{project.revisionId} / Epoch {bundle?.runtimeEpoch ?? 'none'}</div>,
}))
vi.mock('../../features/connectivity/v5/ConnectionMonitorPanel.js', () => ({
  ConnectionMonitorPanel: () => <div>Connection Monitor Surface</div>,
}))

function project(revisionId = 'revision-app-a'): WorkcellProjectV5 {
  return validateWorkcellProjectV5({ ...makeMinimalWorkcellProjectV5(), revisionId })
}

function inactiveGatewayStatus(): RuntimeGatewayStatusV1 {
  return validateRuntimeGatewayStatusV1({
    type: 'runtime-gateway-status-v1', protocolVersion: 1, observedAtMs: 1,
    gateway: { gatewayId: 'gateway-1', phase: 'online', runtimeKind: 'native' },
    deployment: { http: { bindHost: '127.0.0.1', port: 8081 }, opcUaServer: { bindHost: '127.0.0.1', port: 4841, advertisedHost: '127.0.0.1', advertisedPort: 4841 } },
    project: { phase: 'not-applied', authorityPhase: 'inactive', projectId: null, revisionId: null, configRevision: null, activationAttemptId: null, readinessCode: 'NO_ACTIVE_REVISION' },
    opcUa: { mode: 'off', server: { phase: 'disabled', endpointUrl: null, lastError: null }, clientEndpoints: [] },
  })
}

function readyGatewayStatus(projectValue: WorkcellProjectV5, configRevision: string, activationAttemptId: string): RuntimeGatewayStatusV1 {
  return validateRuntimeGatewayStatusV1({
    ...inactiveGatewayStatus(),
    project: { phase: 'ready', authorityPhase: 'active', projectId: projectValue.projectId, revisionId: projectValue.revisionId, configRevision, activationAttemptId, readinessCode: 'READY' },
  })
}

function isActivation(value: unknown): value is { readonly project: WorkcellProjectV5; readonly configRevision: string; readonly activationAttemptId: string } {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const record = value as Record<string, unknown>
  return typeof record.configRevision === 'string' && typeof record.activationAttemptId === 'string' && record.project !== null && typeof record.project === 'object'
}

async function resourcesHarness() {
  let gatewayStatus = inactiveGatewayStatus()
  const fetch = async (input: string, init: RequestInit): Promise<Response> => {
    if (input.endsWith('/status')) return new Response(JSON.stringify(gatewayStatus), { headers: { 'Content-Type': 'application/json' } })
    if (input.endsWith('/project') && init.method === 'PUT') {
      const body = typeof init.body === 'string' ? JSON.parse(init.body) : null
      if (!isActivation(body)) return new Response('{}', { status: 400, headers: { 'Content-Type': 'application/json' } })
      const projectValue = validateWorkcellProjectV5(body.project)
      gatewayStatus = readyGatewayStatus(projectValue, body.configRevision, body.activationAttemptId)
      return new Response(JSON.stringify(gatewayStatus), { headers: { 'Content-Type': 'application/json' } })
    }
    if (input.endsWith('/project') && init.method === 'DELETE') {
      gatewayStatus = inactiveGatewayStatus()
      return new Response(JSON.stringify(gatewayStatus), { headers: { 'Content-Type': 'application/json' } })
    }
    return new Response('{}', { status: 404, headers: { 'Content-Type': 'application/json' } })
  }
  const runtime = createBrowserProjectRuntimeV5({
    gatewayId: 'gateway-1', scheduler: { now: () => 0, request: () => 0, cancel: () => undefined },
    createRunId: () => 'run-1', createCommandId: () => 'command-1',
    stream: { nowMs: () => 0, url: 'ws://runtime.test/runtime/ws', createWebSocket: () => { throw new Error('WebSocket should not be created in AppV6 tests.') } },
    command: { fetch, nowMs: () => 0 }, onDiagnostic: () => undefined,
  })
  const actual = createBrowserProjectApplicationResourcesV5({ database: new ProjectDatabaseV5(`app-v6-${crypto.randomUUID()}`), fetch, runtime })
  const startHeader = vi.fn(() => actual.connectivity.startHeader())
  const startGatewayStream = vi.fn(() => actual.runtime.startGatewayStream())
  const dispose = vi.fn(() => actual.dispose())
  const resources = Object.freeze({
    ...actual,
    connectivity: { ...actual.connectivity, startHeader },
    runtime: { ...actual.runtime, startGatewayStream },
    dispose,
  }) satisfies BrowserProjectApplicationResourcesV5
  await resources.mutations.replace({ candidate: project(), description: 'Seed AppV6 test Project' })
  return { dispose, resources, startGatewayStream, startHeader }
}

async function openOpcUaSettingsFromMenu(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  await user.click(screen.getByRole('menuitem', { name: 'Connectivity' }))
  await user.click(within(screen.getByRole('menu', { name: 'Connectivity menu' })).getByRole('menuitem', { name: 'OPC UA Settings' }))
}

describe('AppV6', () => {
  it('boots the single V5 authority into V6 landmarks and the runtime-owned Project', async () => {
    const harness = await resourcesHarness()
    render(<AppV6 resources={harness.resources} />)

    await waitFor(() => expect(screen.getByTestId('runtime-canvas')).toHaveTextContent('revision-app-a / Epoch 1'))
    expect(harness.startHeader).toHaveBeenCalledOnce()
    expect(harness.startGatewayStream).toHaveBeenCalledOnce()
    expect(screen.getByRole('menubar')).toBeVisible()
    expect(screen.getByRole('main', { name: '3D viewport' })).toBeVisible()
    expect(screen.getByRole('tree', { name: 'Scene Explorer' })).toBeVisible()
    expect(screen.queryByText('Project V5', { exact: true })).not.toBeInTheDocument()
  })

  it('renders the replacement runtime Project before the project-store observer catches up', async () => {
    const harness = await resourcesHarness()
    render(<AppV6 resources={harness.resources} />)
    await waitFor(() => expect(screen.getByTestId('runtime-canvas')).toHaveTextContent('revision-app-a / Epoch 1'))

    await harness.resources.mutations.replace({ candidate: project('revision-app-b'), description: 'Replace AppV6 test Project' })

    await waitFor(() => expect(screen.getByTestId('runtime-canvas')).toHaveTextContent('revision-app-b / Epoch 2'))
  })

  it('keeps one-shot resources alive through the StrictMode probe and disposes on final unmount', async () => {
    const harness = await resourcesHarness()
    const view = render(<StrictMode><AppV6 resources={harness.resources} /></StrictMode>)

    await waitFor(() => expect(harness.startHeader).toHaveBeenCalledTimes(2))
    await Promise.resolve()
    expect(harness.dispose).not.toHaveBeenCalled()

    view.unmount()
    await waitFor(() => expect(harness.dispose).toHaveBeenCalledOnce())
  })

  it('keeps Settings and Binding Overview mounted while their child dialogs return focus to the immediate opener', async () => {
    const user = userEvent.setup()
    const harness = await resourcesHarness()
    render(<AppV6 resources={harness.resources} />)
    await waitFor(() => expect(screen.getByTestId('runtime-canvas')).toHaveTextContent('revision-app-a / Epoch 1'))

    await openOpcUaSettingsFromMenu(user)
    const settings = await screen.findByRole('dialog', { name: 'OPC UA Settings' })
    const overviewTrigger = within(settings).getByRole('button', { name: 'Open Binding Overview' })
    await user.click(overviewTrigger)
    const overview = await screen.findByRole('dialog', { name: 'Binding Overview' })
    await user.click(within(overview).getByRole('button', { name: 'Close' }))
    await waitFor(() => expect(overviewTrigger).toHaveFocus())

    await user.click(overviewTrigger)
    const reopenedOverview = await screen.findByRole('dialog', { name: 'Binding Overview' })
    const editTrigger = within(reopenedOverview).getByRole('button', { name: 'Edit Binding' })
    await user.click(editTrigger)
    const editor = await screen.findByRole('dialog', { name: 'OPC UA Binding' })
    await user.click(within(editor).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(editTrigger).toHaveFocus())
  })

  it('returns Settings Docker guide and Job editor focus to their real trigger buttons', async () => {
    const user = userEvent.setup()
    const harness = await resourcesHarness()
    render(<AppV6 resources={harness.resources} />)
    await waitFor(() => expect(screen.getByTestId('runtime-canvas')).toHaveTextContent('revision-app-a / Epoch 1'))

    await openOpcUaSettingsFromMenu(user)
    const settings = await screen.findByRole('dialog', { name: 'OPC UA Settings' })
    const dockerTrigger = within(settings).getByRole('button', { name: 'Open Docker Run Guide' })
    await user.click(dockerTrigger)
    const dockerGuide = await screen.findByRole('dialog', { name: /Docker/u })
    await user.click(within(dockerGuide).getByRole('button', { name: 'Close' }))
    await waitFor(() => expect(dockerTrigger).toHaveFocus())

    await user.click(screen.getByRole('button', { name: 'Show Job Monitor' }))
    const jobTrigger = screen.getByRole('button', { name: 'Edit Job' })
    await user.click(jobTrigger)
    const editor = await screen.findByRole('dialog', { name: 'Edit Job: Home' })
    await user.click(within(editor).getByRole('button', { name: 'Close' }))
    await waitFor(() => expect(jobTrigger).toHaveFocus())
  })

  it('keeps Explorer and viewport context requests on their originating surfaces', async () => {
    const user = userEvent.setup()
    const harness = await resourcesHarness()
    render(<AppV6 resources={harness.resources} />)
    await waitFor(() => expect(screen.getByTestId('runtime-canvas')).toHaveTextContent('revision-app-a / Epoch 1'))

    const robot = screen.getByRole('treeitem', { name: /Robot 1/u })
    await user.click(robot)
    fireEvent.keyDown(robot, { key: 'F10', shiftKey: true })
    const explorerActions = await screen.findByRole('menu', { name: 'Scene actions' })
    expect(explorerActions).toHaveAttribute('data-surface', 'explorer')
    await user.click(within(explorerActions).getByRole('menuitem', { name: 'Focus' }))

    fireEvent.contextMenu(screen.getByTestId('v6-canvas-host'))
    expect(await screen.findByRole('menu', { name: 'Scene actions' })).toHaveAttribute('data-surface', 'viewport')
  })
})
