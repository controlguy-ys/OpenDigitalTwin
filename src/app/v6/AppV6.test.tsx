import { StrictMode } from 'react'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { validateWorkcellProjectV5, type WorkcellProjectV5 } from '../../core/project-v5/index.js'
import { makeMinimalWorkcellProjectV5 } from '../../core/project-v5/test-support.js'
import { validateRuntimeGatewayStatusV1, type RuntimeGatewayStatusV1 } from '../../core/runtime-protocol/gateway-status-v1.js'
import { createBrowserProjectApplicationResourcesV5, type BrowserProjectApplicationResourcesV5 } from '../../features/project/v5/browser-project-resources-v5.js'
import { createBrowserProjectRuntimeV5 } from '../../features/project/v5/browser-project-runtime-v5.js'
import { ProjectDatabaseV5 } from '../../features/project/v5/project-v5-db.js'
import { WORKSPACE_PREFERENCES_STORAGE_KEY_V6 } from '../../features/ui/v6/workspace-layout-store-v6.js'
import type { CameraOrientationV6 } from '../../features/viewport/v6/camera-controller-v6.js'
import { AppV6 } from './AppV6.js'

const viewCubeProbe = vi.hoisted(() => ({
  onCameraOrientation: null as ((orientation: CameraOrientationV6) => void) | null,
}))

const ISOMETRIC_FRAME_OFFSET_V6 = 2.8 / Math.sqrt(3)

function expectIsometricFrame(position: readonly number[], center: readonly [number, number, number]): void {
  expect(position[0]).toBeCloseTo(center[0] + ISOMETRIC_FRAME_OFFSET_V6)
  expect(position[1]).toBeCloseTo(center[1] - ISOMETRIC_FRAME_OFFSET_V6)
  expect(position[2]).toBeCloseTo(center[2] + ISOMETRIC_FRAME_OFFSET_V6)
}

vi.mock('../../features/scene/v5/V5WorkcellWorkspace.js', () => ({
  V5WorkcellCanvas: ({ project, bundle, cameraPose, cameraVersion, onCameraOrientation, onPresentationChange }: {
    project: WorkcellProjectV5
    bundle: { readonly runtimeEpoch: number } | null
    cameraPose?: { readonly position: readonly number[]; readonly target: readonly number[] }
    cameraVersion?: number
    onCameraOrientation?: (orientation: CameraOrientationV6) => void
    onPresentationChange?: (value: { readonly state: 'ready'; readonly visibleGeometryCount: number; readonly unresolvedPoseKeys: readonly string[]; readonly visibleBounds: { readonly center: readonly [number, number, number]; readonly radius: number }; readonly selectionBounds: { readonly center: readonly [number, number, number]; readonly radius: number } | null }) => void
  }) => {
    viewCubeProbe.onCameraOrientation = onCameraOrientation ?? null
    return <div data-testid="runtime-canvas" data-camera-position={JSON.stringify(cameraPose?.position ?? [])} data-camera-version={cameraVersion}>
    {project.revisionId} / Epoch {bundle?.runtimeEpoch ?? 'none'}
    <button onClick={() => {
      const offset = (bundle?.runtimeEpoch ?? 1) * 10
      onPresentationChange?.({ state: 'ready', visibleGeometryCount: 1, unresolvedPoseKeys: [], visibleBounds: { center: [offset + 4, offset + 5, offset + 6], radius: 1 }, selectionBounds: { center: [offset + 7, offset + 8, offset + 9], radius: 0.5 } })
    }} type="button">Publish finite scene bounds</button>
    </div>
  },
}))
vi.mock('../../features/connectivity/v5/ConnectionMonitorPanel.js', () => ({
  ConnectionMonitorPanel: () => <div>Connection Monitor Surface</div>,
}))

function project(revisionId = 'revision-app-a'): WorkcellProjectV5 {
  return validateWorkcellProjectV5({ ...makeMinimalWorkcellProjectV5(), revisionId })
}

function projectWithJobs(revisionId: string, includeSecondJob: boolean): WorkcellProjectV5 {
  const base = project(revisionId)
  const firstJob = base.jobs[0]
  if (firstJob === undefined) throw new Error('AppV6 fixture did not expose a first Job.')
  const secondJob = {
    ...firstJob,
    id: 'job-second',
    name: 'Second Job',
    instructions: firstJob.instructions.map((instruction) => ({ ...instruction, id: `${instruction.id}-second` })),
  }
  return validateWorkcellProjectV5({ ...base, jobs: includeSecondJob ? [firstJob, secondJob] : [firstJob] })
}

function projectWithoutJobs(revisionId = 'revision-app-empty-jobs'): WorkcellProjectV5 {
  return validateWorkcellProjectV5({ ...project(revisionId), jobs: [] })
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

async function resourcesHarness(candidate: WorkcellProjectV5 = project()) {
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
  await resources.mutations.replace({ candidate, description: 'Seed AppV6 test Project' })
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

  it('routes a loaded zero-Job Project through the styled Job Monitor empty state', async () => {
    const user = userEvent.setup()
    const harness = await resourcesHarness(projectWithoutJobs())
    const view = render(<AppV6 resources={harness.resources} />)
    try {
      await waitFor(() => expect(screen.getByTestId('runtime-canvas')).toHaveTextContent('revision-app-empty-jobs / Epoch 1'))

      const monitorToggle = screen.getByRole('button', { name: /Show Job Monitor|Hide Job Monitor/u })
      if (monitorToggle.getAttribute('aria-pressed') !== 'true') await user.click(monitorToggle)
      const monitor = within(screen.getByTestId('v6-bottom')).getByRole('region', { name: 'Job monitor' })
      expect(monitor).toHaveClass('v6-job-monitor--empty')
      expect(within(monitor).getByText('No Jobs in this Project.')).toBeVisible()
      expect(within(monitor).getByText(/execution details when a Job is available/u)).toBeVisible()
      expect(within(monitor).queryByRole('button')).toBeNull()
    } finally {
      view.unmount()
      await waitFor(() => expect(harness.dispose).toHaveBeenCalledOnce())
    }
  })

  it('renders the replacement runtime Project before the project-store observer catches up', async () => {
    const harness = await resourcesHarness()
    render(<AppV6 resources={harness.resources} />)
    await waitFor(() => expect(screen.getByTestId('runtime-canvas')).toHaveTextContent('revision-app-a / Epoch 1'))

    await harness.resources.mutations.replace({ candidate: project('revision-app-b'), description: 'Replace AppV6 test Project' })

    await waitFor(() => expect(screen.getByTestId('runtime-canvas')).toHaveTextContent('revision-app-b / Epoch 2'))
  })

  it('preserves a selected Job across revisions and falls back to the first Job when it is removed', async () => {
    const user = userEvent.setup()
    const storedPreferences = localStorage.getItem(WORKSPACE_PREFERENCES_STORAGE_KEY_V6)
    localStorage.removeItem(WORKSPACE_PREFERENCES_STORAGE_KEY_V6)
    const harness = await resourcesHarness(projectWithJobs('revision-jobs-a', true))
    const view = render(<AppV6 resources={harness.resources} />)
    try {
      const canvas = await screen.findByTestId('runtime-canvas')
      await waitFor(() => expect(canvas).toHaveTextContent('revision-jobs-a / Epoch 1'))

      const monitorToggle = screen.getByRole('button', { name: /Show Job Monitor|Hide Job Monitor/u })
      if (monitorToggle.getAttribute('aria-pressed') !== 'true') await user.click(monitorToggle)
      const getMonitor = () => within(screen.getByTestId('v6-bottom')).getByRole('region', { name: 'Job monitor', hidden: true })
      const monitor = getMonitor()
      const selector = within(monitor).getByRole('combobox', { name: 'Active Job', hidden: true })
      await user.selectOptions(selector, 'job-second')
      await waitFor(() => expect(within(getMonitor()).getByRole('combobox', { name: 'Active Job', hidden: true })).toHaveValue('job-second'))
      expect(getMonitor()).toHaveTextContent('Second Job')

      await harness.resources.mutations.replace({ candidate: projectWithJobs('revision-jobs-b', true), description: 'Keep selected Job across revision' })
      await waitFor(() => expect(canvas).toHaveTextContent('revision-jobs-b / Epoch 2'))
      await waitFor(() => expect(within(getMonitor()).getByRole('combobox', { name: 'Active Job', hidden: true })).toHaveValue('job-second'))
      expect(getMonitor()).toHaveTextContent('Second Job')

      await harness.resources.mutations.replace({ candidate: projectWithJobs('revision-jobs-c', false), description: 'Remove selected Job' })
      await waitFor(() => expect(canvas).toHaveTextContent('revision-jobs-c / Epoch 3'))
      await waitFor(() => expect(within(getMonitor()).queryByRole('combobox', { name: 'Active Job', hidden: true })).toBeNull())
      expect(getMonitor()).toHaveTextContent('Home')
    } finally {
      view.unmount()
      await waitFor(() => expect(harness.dispose).toHaveBeenCalledOnce())
      if (storedPreferences === null) localStorage.removeItem(WORKSPACE_PREFERENCES_STORAGE_KEY_V6)
      else localStorage.setItem(WORKSPACE_PREFERENCES_STORAGE_KEY_V6, storedPreferences)
    }
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

    const monitorToggle = screen.getByRole('button', { name: /Show Job Monitor|Hide Job Monitor/u })
    if (monitorToggle.getAttribute('aria-pressed') !== 'true') await user.click(monitorToggle)
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

  it('feeds finite scene presentation bounds to the real camera and fits once for the active runtime epoch', async () => {
    const user = userEvent.setup()
    const harness = await resourcesHarness()
    render(<AppV6 resources={harness.resources} />)
    const canvas = await screen.findByTestId('runtime-canvas')
    await waitFor(() => expect(canvas).toHaveTextContent('Epoch 1'))
    expect(JSON.parse(canvas.getAttribute('data-camera-position') ?? '[]')).toEqual([3.2, -4.2, 2.8])

    await user.click(screen.getByRole('button', { name: 'Publish finite scene bounds' }))
    await waitFor(() => expectIsometricFrame(JSON.parse(canvas.getAttribute('data-camera-position') ?? '[]') as number[], [14, 15, 16]))
    const fitVersion = canvas.getAttribute('data-camera-version')
    await user.click(screen.getByRole('button', { name: 'Publish finite scene bounds' }))
    expect(canvas.getAttribute('data-camera-version')).toBe(fitVersion)
  })

  it('routes the real ViewCube orientation callback through the shared camera controller', async () => {
    const harness = await resourcesHarness()
    render(<AppV6 resources={harness.resources} />)
    const canvas = await screen.findByTestId('runtime-canvas')
    await waitFor(() => expect(canvas).toHaveTextContent('Epoch 1'))
    expect(viewCubeProbe.onCameraOrientation).toEqual(expect.any(Function))
    act(() => viewCubeProbe.onCameraOrientation?.('right'))
    await waitFor(() => {
      const position = JSON.parse(canvas.getAttribute('data-camera-position') ?? '[]') as number[]
      expect(position[0]).toBeGreaterThan(0)
      expect(position[1]).toBe(0)
      expect(position[2]).toBe(0)
    })
  })

  it('forwards the failed instruction id into the editor and keeps compact status noninteractive', async () => {
    const user = userEvent.setup()
    const harness = await resourcesHarness()
    render(<AppV6 resources={harness.resources} />)
    await waitFor(() => expect(screen.getByTestId('runtime-canvas')).toHaveTextContent('Epoch 1'))
    const projectValue = harness.resources.runtime.readActiveBundle()?.project
    const jobs = harness.resources.runtime.readActiveBundle()?.runtimeGraph.jobs
    const job = projectValue?.jobs[0]
    if (projectValue === undefined || jobs === undefined || job === undefined) throw new Error('AppV6 test Project did not expose a runtime Job.')
    jobs.getState().setRobotState({
      robotId: job.robotId,
      jobId: job.id,
      runId: 'failed-run',
      state: 'FAILED',
      stepIndex: 0,
      startedAtSimulationMs: 0,
      completedAtSimulationMs: 1,
      failureCode: 'WAIT_DI_TIMEOUT',
      message: 'Timed out waiting for DI signal.',
    })
    await user.click(screen.getByRole('button', { name: /Show Job Monitor|Hide Job Monitor/u }))
    const monitor = within(screen.getByTestId('v6-bottom')).getByRole('region', { name: 'Job monitor', hidden: true })
    await waitFor(() => expect(monitor).toHaveTextContent('FAILED'))
    await user.click(within(monitor).getByRole('button', { name: 'Inspect failed step', hidden: true }))
    const editor = await screen.findByRole('dialog', { name: /Edit Job/u })
    expect(within(editor).getByRole('listitem')).toHaveAttribute('aria-current', 'step')
    const compactStatus = document.querySelector('.v6-job-compact-status')
    expect(compactStatus).not.toBeNull()
    expect(compactStatus?.querySelectorAll('button')).toHaveLength(0)
  })

  it('does not fit stale finite bounds after a revision and runtime epoch change', async () => {
    const user = userEvent.setup()
    const harness = await resourcesHarness()
    render(<AppV6 resources={harness.resources} />)
    const canvas = await screen.findByTestId('runtime-canvas')
    await waitFor(() => expect(canvas).toHaveTextContent('Epoch 1'))
    await user.click(screen.getByRole('button', { name: 'Publish finite scene bounds' }))
    await waitFor(() => expectIsometricFrame(JSON.parse(canvas.getAttribute('data-camera-position') ?? '[]') as number[], [14, 15, 16]))

    await harness.resources.mutations.replace({ candidate: project('revision-app-b'), description: 'Replace AppV6 identity test Project' })
    await waitFor(() => expect(canvas).toHaveTextContent('revision-app-b / Epoch 2'))
    expectIsometricFrame(JSON.parse(canvas.getAttribute('data-camera-position') ?? '[]') as number[], [14, 15, 16])

    await user.click(screen.getByRole('button', { name: 'Publish finite scene bounds' }))
    await waitFor(() => expectIsometricFrame(JSON.parse(canvas.getAttribute('data-camera-position') ?? '[]') as number[], [24, 25, 26]))
  })
})
