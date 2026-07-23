import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { StrictMode } from 'react'

import type { ConnectivityPresentationStoreV1 } from './connectivity-presentation-store.js'
import { ConnectionMonitorPanel } from './ConnectionMonitorPanel.js'

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

function store(): ConnectivityPresentationStoreV1 {
  let current = state()
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
    expect(screen.getAllByText('T:0')[0]).toBeVisible()

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
    const cardDetails = document.querySelector('.connection-monitor-card .connection-monitor-details') as HTMLDetailsElement
    await user.click(cardDetails.querySelector('summary')!)
    expect(cardDetails).toHaveAttribute('open')
    expect(cardDetails).toHaveTextContent('Freshness')
  })
})
