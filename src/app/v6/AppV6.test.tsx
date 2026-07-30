import { StrictMode } from 'react'
import { act, render, screen, waitFor } from '@testing-library/react'
import { createStore } from 'zustand/vanilla'
import { describe, expect, it, vi } from 'vitest'

import { validateWorkcellProjectV5, type WorkcellProjectV5 } from '../../core/project-v5/index.js'
import { makeMinimalWorkcellProjectV5 } from '../../core/project-v5/test-support.js'
import type { ConnectivityPresentationStateV1 } from '../../features/connectivity/v5/connectivity-presentation-store.js'
import type { BrowserProjectApplicationResourcesV5 } from '../../features/project/v5/browser-project-resources-v5.js'
import type { ProjectStoreStateV5 } from '../../features/project/v5/project-store-v5.js'
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
  const listeners = new Set<() => void>()
  const settingsState = { open: false, phase: 'editing' as const, draft: null, issues: [], error: null }
  const resources = {
    store: projectStore,
    connectivity: { startHeader, getState: () => connectivityState, subscribe: () => () => undefined, dispose: vi.fn() },
    settings: { getState: () => settingsState, subscribe: () => () => undefined, open: vi.fn(), update: vi.fn(), cancel: vi.fn(), applyAndActivate: vi.fn() },
    runtime: {
      bundle: { readActiveState: () => runtimeBundle, subscribe: (listener: () => void) => { listeners.add(listener); return () => listeners.delete(listener) } },
      readActiveBundle: () => runtimeBundle,
      startGatewayStream,
      stopGatewayStream: vi.fn(),
      dispose: vi.fn(),
    },
    files: { pickProject: vi.fn(async () => null), downloadProject: vi.fn() },
    mutations: { readPublished: () => ({ project: activeProject, revisionId: activeProject.revisionId }), mutate: vi.fn(), replace: vi.fn() },
    connectionTest: {},
    nodeAddressResolver: {},
    gateway: {},
    dispose,
  } as unknown as BrowserProjectApplicationResourcesV5
  const publishRuntimeBundle = (nextProject: WorkcellProjectV5, runtimeEpoch: number) => {
    runtimeBundle = { ...runtimeBundle!, runtimeEpoch, project: nextProject, projectRevisionId: nextProject.revisionId } as never
    listeners.forEach((listener) => listener())
  }
  return { dispose, hydrate, publishRuntimeBundle, resources, startGatewayStream, startHeader }
}

describe('AppV6', () => {
  it('boots the single V5 authority into V6 landmarks and the runtime-owned Project', async () => {
    const harness = resourcesHarness()
    render(<AppV6 resources={harness.resources} />)

    await waitFor(() => expect(harness.hydrate).toHaveBeenCalledOnce())
    expect(harness.startHeader).toHaveBeenCalledOnce()
    expect(harness.startGatewayStream).toHaveBeenCalledOnce()
    expect(screen.getByRole('menubar')).toBeVisible()
    expect(screen.getByRole('main', { name: '3D viewport' })).toBeVisible()
    expect(screen.getByRole('tree', { name: 'Scene Explorer' })).toBeVisible()
    expect(screen.queryByText('Project V5', { exact: true })).not.toBeInTheDocument()
  })

  it('renders the replacement runtime Project before the project-store observer catches up', async () => {
    const harness = resourcesHarness()
    render(<AppV6 resources={harness.resources} />)
    await waitFor(() => expect(screen.getByTestId('runtime-canvas')).toHaveTextContent('revision-app-a / Epoch 1'))

    act(() => harness.publishRuntimeBundle(project('revision-app-b'), 2))

    expect(screen.getByTestId('runtime-canvas')).toHaveTextContent('revision-app-b / Epoch 2')
  })

  it('keeps one-shot resources alive through the StrictMode probe and disposes on final unmount', async () => {
    const harness = resourcesHarness()
    const view = render(<StrictMode><AppV6 resources={harness.resources} /></StrictMode>)

    await waitFor(() => expect(harness.hydrate).toHaveBeenCalled())
    await Promise.resolve()
    expect(harness.dispose).not.toHaveBeenCalled()

    view.unmount()
    await waitFor(() => expect(harness.dispose).toHaveBeenCalledOnce())
  })
})
