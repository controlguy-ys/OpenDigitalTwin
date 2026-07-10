import { StrictMode } from 'react'
import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { simulationJointSource } from '../features/joints/SimulationJointSource'
import { useRobotStore } from '../features/joints/robot-store'
import { App } from './App'
import { AppShell } from './AppShell'

vi.mock('../features/scene/SceneCanvas', () => ({
  SceneCanvas: ({
    onStatusChange,
  }: {
    onStatusChange?: (status: 'ready') => void
  }) => (
    <button
      aria-label="Scene ready"
      onClick={() => {
        onStatusChange?.('ready')
      }}
      type="button"
    />
  ),
}))

describe('AppShell', () => {
  beforeEach(() => {
    useRobotStore.getState().reset()
  })

  it('renders the five industrial workstation regions', () => {
    render(<AppShell viewport={<div>3D viewport</div>} />)
    expect(screen.getByRole('banner')).toHaveTextContent('RobotSim')
    expect(screen.getByLabelText('Scene Assets')).toBeInTheDocument()
    expect(screen.getByLabelText('3D viewport')).toBeInTheDocument()
    expect(screen.getByLabelText('Inspector')).toBeInTheDocument()
    expect(screen.getByLabelText('Timeline and Events')).toBeInTheDocument()
  })

  it('opens the responsive drawers and bottom sheet from their controls', async () => {
    const user = userEvent.setup()
    const { getByLabelText, getByRole } = render(
      <AppShell viewport={<div>3D viewport</div>} />,
    )

    const controls = [
      getByRole('button', { name: 'Scene Assets drawer' }),
      getByRole('button', { name: 'Inspector drawer' }),
      getByRole('button', { name: 'Timeline and Events sheet' }),
    ]

    for (const control of controls) {
      expect(control).toHaveAttribute('aria-expanded', 'false')
      await user.click(control)
      expect(control).toHaveAttribute('aria-expanded', 'true')
      await user.click(control)
      expect(control).toHaveAttribute('aria-expanded', 'false')
      await user.click(control)
    }

    expect(getByLabelText('Scene Assets')).toHaveClass('is-open')
    expect(getByLabelText('Inspector')).toHaveClass('is-open')
    expect(getByLabelText('Timeline and Events')).toHaveClass('is-open')
  })

  it('exposes when scene-dependent controls are not ready', () => {
    render(<AppShell controlsDisabled viewport={<div>3D viewport</div>} />)

    const viewport = screen.getByLabelText('3D viewport')
    expect(viewport).toHaveAttribute('aria-busy', 'true')
    expect(viewport.closest('.app-shell')).toHaveAttribute(
      'data-controls-disabled',
      'true',
    )
    expect(screen.getByRole('button', { name: 'Import STEP' })).toBeEnabled()
  })

  it('keeps controls disabled without marking an error fallback as busy', () => {
    render(
      <AppShell
        controlsDisabled
        viewport={<div>3D viewport</div>}
        viewportBusy={false}
      />,
    )

    const viewport = screen.getByLabelText('3D viewport')
    expect(viewport).toHaveAttribute('aria-busy', 'false')
    expect(viewport.closest('.app-shell')).toHaveAttribute(
      'data-controls-disabled',
      'true',
    )
  })

  it('keeps scene-dependent controls gated while the canvas loads', () => {
    render(<App />)

    const viewport = screen.getByLabelText('3D viewport')
    expect(viewport).toHaveAttribute('aria-busy', 'true')
    expect(viewport.closest('.app-shell')).toHaveAttribute(
      'data-controls-disabled',
      'true',
    )
  })

  it('mounts the inspector and timeline and enables them only when the scene is ready', async () => {
    const user = userEvent.setup()
    render(<App />)

    expect(screen.getByRole('heading', { name: 'Inspector' })).toBeVisible()
    expect(screen.getByRole('heading', { name: 'Timeline' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'Home' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Stop' })).toBeDisabled()

    await user.click(screen.getByRole('button', { name: 'Scene ready' }))
    expect(screen.getByRole('button', { name: 'Home' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Stop' })).toBeEnabled()

    await user.click(screen.getByRole('button', { name: 'Save Pose' }))
    await user.click(screen.getByRole('button', { name: 'Save Pose' }))
    expect(screen.getByRole('button', { name: 'Play' })).toBeEnabled()
  })

  it('keeps exactly one live source subscription through StrictMode setup and cleanup', () => {
    const subscriber = vi.fn()
    const unsubscribe = useRobotStore.subscribe(subscriber)
    const view = render(
      <StrictMode>
        <App />
      </StrictMode>,
    )

    act(() => {
      simulationJointSource.setAngles([10, 20, 30, 40, 50, 60])
    })
    expect(subscriber).toHaveBeenCalledTimes(1)
    expect(useRobotStore.getState().anglesDeg).toEqual([10, 20, 30, 40, 50, 60])

    view.unmount()
    act(() => {
      simulationJointSource.setAngles([0, 0, 0, 0, 0, 0])
    })
    expect(subscriber).toHaveBeenCalledTimes(1)
    unsubscribe()
  })

  it('renders the current source quality in the top bar', () => {
    render(
      <AppShell
        sourceQuality="STALE"
        viewport={<div>3D viewport</div>}
      />,
    )

    expect(screen.getByRole('banner')).toHaveTextContent('STALE')
    expect(screen.getByRole('banner')).not.toHaveTextContent('GOOD')
  })
})
