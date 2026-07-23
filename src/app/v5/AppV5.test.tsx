import { StrictMode } from 'react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { createStore } from 'zustand/vanilla'
import { describe, expect, it, vi } from 'vitest'

import { validateWorkcellProjectV5, type WorkcellProjectV5 } from '../../core/project-v5/index.js'
import { makeMinimalWorkcellProjectV5 } from '../../core/project-v5/test-support.js'
import type { ConnectivityPresentationStateV1 } from '../../features/connectivity/v5/connectivity-presentation-store.js'
import type { ProjectStoreStateV5 } from '../../features/project/v5/project-store-v5.js'
import type { BrowserProjectApplicationResourcesV5 } from '../../features/project/v5/browser-project-resources-v5.js'
import { AppV5 } from './AppV5.js'

vi.mock('../../features/scene/v5/V5WorkcellWorkspace.js', () => ({
  V5WorkcellWorkspace: ({ project, bundle }: {
    project: WorkcellProjectV5
    bundle: { readonly runtimeEpoch: number } | null
  }) => <div>V5 Scene Workspace · {project.revisionId} · Epoch {bundle?.runtimeEpoch ?? 'none'}</div>,
}))
vi.mock('../../features/jobs/v5/RobotJobWorkspaceV5.js', () => ({
  RobotJobWorkspaceV5: () => <div>V5 Job Workspace</div>,
}))
vi.mock('../../features/connectivity/v5/ConnectionMonitorPanel.js', () => ({
  ConnectionMonitorPanel: () => <div>Connection Monitor Surface</div>,
}))

function project(revisionId = 'revision-app-a'): WorkcellProjectV5 {
  return validateWorkcellProjectV5({ ...makeMinimalWorkcellProjectV5(), revisionId })
}

function resourcesHarness() {
  const activeProject = project()
  const hydrate = vi.fn(async () => undefined)
  const projectStore = createStore<ProjectStoreStateV5>()(() => ({
    activeProject,
    status: 'ready',
    error: null,
    hydrate,
    newProject: vi.fn(async () => undefined),
    saveActiveProject: vi.fn(async () => activeProject),
    exportActiveProject: vi.fn(async () => new Blob()),
    importProject: vi.fn(async () => undefined),
  }))
  const connectivityState: ConnectivityPresentationStateV1 = {
    gateway: { state: 'online', label: 'Online', detail: 'Ready' },
    opcUa: { state: 'off', label: 'Off', detail: 'Disabled' },
    status: null,
    integrationDiagnostics: null,
    transportError: null,
    lastObservedAtMs: null,
  }
  const startHeader = vi.fn()
  const settingsOpen = vi.fn()
  const startGatewayStream = vi.fn()
  const dispose = vi.fn(async () => undefined)
  let runtimeBundle: ReturnType<BrowserProjectApplicationResourcesV5['runtime']['readActiveBundle']> = {
    runtimeEpoch: 1,
    project: activeProject,
    projectRevisionId: activeProject.revisionId,
    configRevision: 'a'.repeat(64),
    gatewayId: 'gateway-1',
    runtimeGraph: {},
  } as never
  const runtimeBundleListeners = new Set<() => void>()
  const settingsState = { open: false, phase: 'editing' as const, draft: null, issues: [], error: null }
  const resources = {
    store: projectStore,
    connectivity: {
      startHeader,
      setMonitorOpen: vi.fn(),
      setPublicationPhase: vi.fn(),
      getState: () => connectivityState,
      subscribe: () => () => undefined,
      dispose: vi.fn(),
      poller: vi.fn(),
    },
    settings: {
      getState: () => settingsState,
      subscribe: () => () => undefined,
      open: settingsOpen,
      update: vi.fn(),
      cancel: vi.fn(),
      applyAndActivate: vi.fn(),
    },
    runtime: {
      bundle: {
        getState: vi.fn(),
        readActiveState: () => runtimeBundle,
        subscribe: (listener: () => void) => {
          runtimeBundleListeners.add(listener)
          return () => runtimeBundleListeners.delete(listener)
        },
      },
      readActiveBundle: () => runtimeBundle,
      startGatewayStream,
      stopGatewayStream: vi.fn(),
      dispose: vi.fn(),
    },
    files: {
      pickProject: vi.fn(async () => null),
      downloadProject: vi.fn(),
    },
    mutations: {},
    connectionTest: {},
    nodeAddressResolver: {},
    dispose,
  } as unknown as BrowserProjectApplicationResourcesV5
  const publishRuntimeBundle = (nextProject: WorkcellProjectV5, runtimeEpoch: number): void => {
    runtimeBundle = {
      runtimeEpoch,
      project: nextProject,
      projectRevisionId: nextProject.revisionId,
      configRevision: 'a'.repeat(64),
      gatewayId: 'gateway-1',
      runtimeGraph: {},
    } as never
    for (const listener of runtimeBundleListeners) listener()
  }
  return { dispose, hydrate, publishRuntimeBundle, resources, settingsOpen, startGatewayStream, startHeader }
}

describe('AppV5', () => {
  it('boots one V5 Project authority and exposes the required active workspaces', async () => {
    const harness = resourcesHarness()
    render(<AppV5 resources={harness.resources} />)
    await waitFor(() => expect(harness.hydrate).toHaveBeenCalledOnce())
    expect(harness.startHeader).toHaveBeenCalledOnce()
    expect(harness.startGatewayStream).toHaveBeenCalledOnce()
    expect(screen.getByText(/V5 Scene Workspace/u)).toBeInTheDocument()
    expect(screen.getByText('V5 Job Workspace')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'OPC UA Settings…' }))
    expect(harness.settingsOpen).toHaveBeenCalledOnce()
  })

  it('disposes the composed poller, stream, and runtime authority on unmount', async () => {
    const harness = resourcesHarness()
    const view = render(<AppV5 resources={harness.resources} />)
    view.unmount()
    await waitFor(() => expect(harness.dispose).toHaveBeenCalledOnce())
  })

  it('does not dispose one-shot resources during the StrictMode setup probe', async () => {
    const harness = resourcesHarness()
    const view = render(
      <StrictMode>
        <AppV5 resources={harness.resources} />
      </StrictMode>,
    )

    await waitFor(() => expect(harness.hydrate).toHaveBeenCalled())
    await Promise.resolve()
    expect(harness.dispose).not.toHaveBeenCalled()

    view.unmount()
    await waitFor(() => expect(harness.dispose).toHaveBeenCalledOnce())
  })

  it('renders the Project owned by a replacement Runtime Epoch before the store observer catches up', async () => {
    const harness = resourcesHarness()
    render(<AppV5 resources={harness.resources} />)
    await waitFor(() => expect(screen.getByText(/revision-app-a/u)).toBeInTheDocument())

    act(() => harness.publishRuntimeBundle(project('revision-app-b'), 2))

    expect(screen.getByText(/revision-app-b · Epoch 2/u)).toBeInTheDocument()
    expect(screen.queryByText(/revision-app-a · Epoch 2/u)).not.toBeInTheDocument()
  })
})
