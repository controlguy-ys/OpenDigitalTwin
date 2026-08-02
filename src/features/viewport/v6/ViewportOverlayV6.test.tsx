import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { ViewportOverlayV6, selectedTcpMarkerV6 } from './ViewportOverlayV6.js'

const cameraControllerPort = () => ({
  home: vi.fn(), fitAll: vi.fn(), focusSelection: vi.fn(), setOrientation: vi.fn(),
  snapshot: vi.fn(() => ({ position: [0, 0, 0] as const, target: [0, 0, 0] as const })),
})

describe('ViewportOverlayV6', () => {
  it('collision-fits Camera views with a bounded internal scroll region', () => {
    const css = readFileSync(resolve(process.cwd(), 'src/styles/v6/viewport.css'), 'utf8')
    const menuRule = css.match(/\.v6-camera-views-menu\s*\{([^}]*)\}/u)?.[1] ?? ''
    const menuButtonRule = css.match(/\.v6-camera-views-menu button\s*\{([^}]*)\}/u)?.[1] ?? ''

    expect(menuRule).toContain('inline-size: min(220px, calc(100vw - 16px));')
    expect(menuRule).toContain('max-height: min(280px, calc(100dvh - 76px));')
    expect(menuRule).toContain('overflow-y: auto;')
    expect(menuRule).toContain('overscroll-behavior: contain;')
    expect(menuButtonRule).toContain('white-space: normal;')
    expect(menuButtonRule).toContain('overflow-wrap: anywhere;')
  })

  it('keeps one real ViewCube surface while grouping all seven camera commands behind one accessible menu', () => {
    const camera = cameraControllerPort()
    render(<ViewportOverlayV6 camera={camera} />)
    fireEvent.click(screen.getByRole('button', { name: 'Home view' }))
    fireEvent.click(screen.getByRole('button', { name: 'Fit all visible geometry' }))
    fireEvent.click(screen.getByRole('button', { name: 'Focus selection' }))
    expect(screen.queryByRole('button', { name: 'Set isometric view' })).toBeNull()
    const viewsTrigger = screen.getByRole('button', { name: 'Camera views' })
    expect(viewsTrigger).toHaveAttribute('aria-haspopup', 'menu')
    expect(viewsTrigger).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(viewsTrigger)
    for (const [index, orientation] of ['isometric', 'top', 'front', 'right', 'back', 'left', 'bottom'].entries()) {
      const viewsMenu = screen.getByRole('menu', { name: 'Camera views' })
      fireEvent.click(within(viewsMenu).getByRole('menuitem', { name: `Set ${orientation} view` }))
      if (index < 6) fireEvent.click(viewsTrigger)
    }
    expect(screen.queryByRole('menu', { name: 'Camera views' })).toBeNull()
    expect(camera.home).toHaveBeenCalledOnce(); expect(camera.fitAll).toHaveBeenCalledOnce(); expect(camera.focusSelection).toHaveBeenCalledOnce()
    expect(camera.setOrientation).toHaveBeenCalledWith('isometric')
    expect(camera.setOrientation).toHaveBeenCalledWith('top')
    expect(camera.setOrientation).toHaveBeenCalledWith('front')
    expect(camera.setOrientation).toHaveBeenCalledWith('right')
    expect(camera.setOrientation).toHaveBeenCalledWith('back')
    expect(camera.setOrientation).toHaveBeenCalledWith('left')
    expect(camera.setOrientation).toHaveBeenCalledWith('bottom')
    expect(screen.queryByTestId('v6-view-cube')).toBeNull()
    expect(screen.getByTestId('v6-camera-views')).toHaveAttribute('data-safe-placement', 'top-toolbar')
    expect(screen.getByTestId('v6-camera-controls')).toHaveAttribute('data-safe-placement', 'top-toolbar')
    expect(screen.getByTestId('v6-camera-toolbar')).toHaveAttribute('role', 'toolbar')
  })

  it('renders an eligible TCP marker and makes Translate functional only through an enabled manual port', () => {
    const translate = vi.fn()
    const markerInput = { projectRevisionId: 'r1', runtimeRevisionId: 'r1', selection: { kind: 'robot', id: 'robot' }, robot: { id: 'robot', selectedTcpFrameId: 'tcp' }, tcp: { robotId: 'robot', frameId: 'tcp', role: 'tcp' } } as const
    const camera = cameraControllerPort()
    const { rerender } = render(<ViewportOverlayV6 camera={camera} tcpMarker={markerInput} transformControl={{ enabled: false, explanation: 'OPC UA owns this transform.', translate }} />)

    expect(screen.getByTestId('v6-tcp-marker')).toHaveTextContent('robot / tcp')
    expect(screen.getByRole('button', { name: 'Translate selection' })).toBeDisabled()
    expect(screen.getByText('OPC UA owns this transform.')).toHaveClass('visually-hidden')
    expect(screen.getByRole('button', { name: 'Translate selection' })).toHaveAttribute('title', 'OPC UA owns this transform.')
    rerender(<ViewportOverlayV6 camera={camera} tcpMarker={markerInput} transformControl={{ enabled: true, explanation: 'Manual transform.', translate }} />)
    fireEvent.click(screen.getByRole('button', { name: 'Translate selection' }))
    expect(translate).toHaveBeenCalledOnce()
    expect(selectedTcpMarkerV6({ ...markerInput, runtimeRevisionId: 'r2' })).toBeNull()
  })

  it.each([
    ['non-robot selection', { selection: { kind: 'object', id: 'robot' } }],
    ['selected robot mismatch', { selection: { kind: 'robot', id: 'other-robot' } }],
    ['selected TCP mismatch', { robot: { id: 'robot', selectedTcpFrameId: 'other-tcp' } }],
    ['TCP frame mismatch', { tcp: { robotId: 'robot', frameId: 'other-tcp', role: 'tcp' } }],
    ['non-TCP role', { tcp: { robotId: 'robot', frameId: 'tcp', role: 'tool' } }],
    ['runtime revision mismatch', { runtimeRevisionId: 'r2' }],
  ])('does not render a TCP marker for %s', (_reason, override) => {
    const camera = cameraControllerPort()
    const markerInput = {
      projectRevisionId: 'r1', runtimeRevisionId: 'r1',
      selection: { kind: 'robot', id: 'robot' },
      robot: { id: 'robot', selectedTcpFrameId: 'tcp' },
      tcp: { robotId: 'robot', frameId: 'tcp', role: 'tcp' },
      ...override,
    }
    render(<ViewportOverlayV6 camera={camera} tcpMarker={markerInput} />)
    expect(screen.queryByTestId('v6-tcp-marker')).toBeNull()
  })
})
