import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { ViewportOverlayV6, selectedTcpMarkerV6 } from './ViewportOverlayV6.js'

describe('ViewportOverlayV6', () => {
  it('keeps Home, Fit, Focus below the View Cube safe area and invokes camera-only commands', () => {
    const camera = { home: vi.fn(), fitAll: vi.fn(), focusSelection: vi.fn(), setOrientation: vi.fn() }
    render(<ViewportOverlayV6 camera={camera} />)
    fireEvent.click(screen.getByRole('button', { name: 'Home view' }))
    fireEvent.click(screen.getByRole('button', { name: 'Fit all visible geometry' }))
    fireEvent.click(screen.getByRole('button', { name: 'Focus selection' }))
    expect(camera.home).toHaveBeenCalledOnce(); expect(camera.fitAll).toHaveBeenCalledOnce(); expect(camera.focusSelection).toHaveBeenCalledOnce()
    expect(screen.getByTestId('v6-view-cube')).toBeInTheDocument()
    expect(screen.getByTestId('v6-camera-controls')).toHaveAttribute('data-safe-placement', 'below-cube')
  })

  it('renders a TCP marker only for the current selected Robot, selected TCP, and matching runtime revision', () => {
    expect(selectedTcpMarkerV6({ projectRevisionId: 'r1', runtimeRevisionId: 'r1', selection: { kind: 'robot', id: 'robot' }, robot: { id: 'robot', selectedTcpFrameId: 'tcp' }, tcp: { robotId: 'robot', frameId: 'tcp', role: 'tcp' } })).toEqual({ robotId: 'robot', frameId: 'tcp' })
    expect(selectedTcpMarkerV6({ projectRevisionId: 'r1', runtimeRevisionId: 'r2', selection: { kind: 'robot', id: 'robot' }, robot: { id: 'robot', selectedTcpFrameId: 'tcp' }, tcp: { robotId: 'robot', frameId: 'tcp', role: 'tcp' } })).toBeNull()
  })
})
