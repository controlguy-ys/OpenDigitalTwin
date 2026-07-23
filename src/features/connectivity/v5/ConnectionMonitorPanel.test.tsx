import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { createRef, StrictMode } from 'react'

import type {
  ConnectivityPresentationStateV1,
  ConnectivityPresentationStoreV1,
} from './connectivity-presentation-store.js'
import {
  ConnectionMonitorPanel,
  type ConnectionMonitorPanelControlV1,
} from './ConnectionMonitorPanel.js'

function state() {
  return {
    gateway: { state: 'offline' as const, label: 'Offline', detail: 'Gateway unavailable.' },
    opcUa: { state: 'error' as const, label: 'Unavailable', detail: 'Gateway unavailable.' },
    status: null,
    integrationDiagnostics: null,
    transportError: 'Gateway unavailable.',
    lastObservedAtMs: null,
  }
}

function store(initial: ConnectivityPresentationStateV1 = state()): ConnectivityPresentationStoreV1 {
  let current = initial
  let demand: 'header' | 'monitor' = 'header'
  const listeners = new Set<() => void>()
  const setMonitorOpen = vi.fn((open: boolean) => { demand = open ? 'monitor' : 'header'; current = { ...current, transportError: open ? 'Gateway unavailable.' : current.transportError }; listeners.forEach((listener) => listener()) })
  return {
    startHeader: vi.fn(), setMonitorOpen, setPublicationPhase: vi.fn(), getState: () => current,
    subscribe: (listener) => { listeners.add(listener); return () => listeners.delete(listener) },
    dispose: vi.fn(), poller: () => ({ setDemand: vi.fn(), stop: vi.fn(), status: () => ({ demand, inFlight: false, nextPollAtMs: null }) }),
  }
}

describe('ConnectionMonitorPanel', () => {
  it('is modeless, keeps the viewport interactive, and finalizes poll demand on close and unmount', async () => {
    const user = userEvent.setup()
    const presentationStore = store()
    const { unmount } = render(<StrictMode><div aria-label="3D viewport">Viewport</div><ConnectionMonitorPanel store={presentationStore} formatTimestamp={(value) => `T:${value}`} /></StrictMode>)

    await user.click(screen.getByRole('button', { name: 'Connection Monitor' }))
    const panel = screen.getByRole('complementary', { name: 'Connection Monitor' })
    expect(panel).not.toHaveAttribute('aria-modal')
    expect(screen.getByLabelText('3D viewport')).not.toHaveAttribute('aria-hidden')
    expect(presentationStore.poller().status().demand).toBe('monitor')
    expect(screen.getByRole('status')).toHaveTextContent('Gateway unavailable.')
    expect(screen.getAllByText('T:null')[0]).toBeVisible()
    expect(within(panel).getAllByRole('columnheader').map((header) => header.textContent)).toEqual([
      'Component', 'State', 'Endpoint', 'Last update', 'Quality', 'Error',
    ])
    expect(within(panel).getByLabelText('Details for Web proxy table row')).toBeVisible()

    await user.click(screen.getByRole('button', { name: 'Close Connection Monitor' }))
    expect(presentationStore.poller().status().demand).toBe('header')
    expect(screen.queryByRole('complementary', { name: 'Connection Monitor' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Connection Monitor' }))
    unmount()
    expect(presentationStore.poller().status().demand).toBe('header')
  })

  it('restores focus only while the opener remains connected and uses labelled compact cards/details', async () => {
    const user = userEvent.setup()
    const presentationStore = store()
    render(<ConnectionMonitorPanel compact store={presentationStore} />)
    const opener = screen.getByRole('button', { name: 'Connection Monitor' })
    const focus = vi.spyOn(opener, 'focus')

    await user.click(opener)
    focus.mockClear()
    expect(screen.getAllByText('Component')[0]).toBeVisible()
    expect(screen.getByText('Gateway unavailable.')).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Close Connection Monitor' }))
    expect(focus).toHaveBeenCalled()

    await user.click(opener)
    focus.mockClear()
    Object.defineProperty(opener, 'isConnected', { configurable: true, get: () => false })
    await user.click(screen.getByRole('button', { name: 'Close Connection Monitor' }))
    expect(focus).not.toHaveBeenCalled()
    Object.defineProperty(opener, 'isConnected', { configurable: true, get: () => true })
    await user.click(opener)
    expect(screen.getAllByText('State')[0]).toBeVisible()
    expect(screen.getByLabelText('Details for Web proxy compact card')).toBeVisible()
    const cardDetails = document.querySelector('.connection-monitor-card .connection-monitor-details') as HTMLDetailsElement
    await user.click(cardDetails.querySelector('summary')!)
    expect(cardDetails).toHaveAttribute('open')
    expect(cardDetails).toHaveTextContent('Freshness')
  })

  it('formats detail and error timestamps through the one injected formatter', async () => {
    const user = userEvent.setup()
    const revision = 'a'.repeat(64)
    const presentation: ConnectivityPresentationStateV1 = {
      gateway: { state: 'online', label: 'Online', detail: 'Current' },
      opcUa: { state: 'client-degraded', label: 'Degraded', detail: 'Retrying' },
      transportError: null,
      lastObservedAtMs: 100,
      integrationDiagnostics: null,
      status: {
        type: 'runtime-gateway-status-v1', protocolVersion: 1, observedAtMs: 100,
        gateway: { gatewayId: 'gateway', phase: 'online', runtimeKind: 'native' },
        deployment: {
          http: { bindHost: '127.0.0.1', port: 8081 },
          opcUaServer: { bindHost: '127.0.0.1', port: 4841, advertisedHost: 'localhost', advertisedPort: 4841 },
        },
        project: {
          phase: 'ready', authorityPhase: 'active', projectId: 'project', revisionId: 'revision',
          configRevision: revision, activationAttemptId: 'attempt-0001', readinessCode: 'READY',
        },
        opcUa: {
          mode: 'client',
          server: { phase: 'disabled', endpointUrl: null, lastError: null },
          clientEndpoints: [{
            endpointId: 'plc', endpointUrl: 'opc.tcp://plc:4840', phase: 'reconnecting',
            sessionActive: false, subscriptionActive: false, monitoredItemCount: 1, mappingCount: 1,
            lastValueQuality: 'UNCERTAIN', lastNotificationAtMs: 90, lastGoodValueAtMs: 80,
            reconnectAttempt: 2, nextRetryAtMs: 110,
            lastError: { code: 'RETRY', message: 'Retrying.', occurredAtMs: 95 },
          }],
        },
      },
    }
    render(<ConnectionMonitorPanel formatTimestamp={(value) => `T:${value}`} store={store(presentation)} />)
    await user.click(screen.getByRole('button', { name: 'Connection Monitor' }))
    const table = screen.getByRole('table')
    expect(within(table).getByText('RETRY: Retrying. @ T:95')).toBeVisible()
    const clientSummary = within(table).getByLabelText('Details for OPC UA Client plc table row')
    await user.click(clientSummary)
    const clientDetails = clientSummary.closest('details')!
    expect(within(clientDetails).getByText('T:90')).toBeVisible()
    expect(within(clientDetails).getByText('T:80')).toBeVisible()
    expect(within(clientDetails).getByText('T:110')).toBeVisible()
  })

  it('opens through the Task 7 control boundary before render demand and restores the external opener', () => {
    const presentationStore = store()
    const controlRef = createRef<ConnectionMonitorPanelControlV1>()
    const externalOpener = document.createElement('button')
    externalOpener.textContent = 'Header monitor'
    document.body.append(externalOpener)
    const focus = vi.spyOn(externalOpener, 'focus')
    render(<ConnectionMonitorPanel controlRef={controlRef} store={presentationStore} />)

    act(() => controlRef.current?.open(externalOpener))
    expect(presentationStore.poller().status().demand).toBe('monitor')
    expect(screen.getByRole('complementary', { name: 'Connection Monitor' })).toBeVisible()
    act(() => controlRef.current?.close())
    expect(presentationStore.poller().status().demand).toBe('header')
    expect(focus).toHaveBeenCalledOnce()
    externalOpener.remove()
  })
})
