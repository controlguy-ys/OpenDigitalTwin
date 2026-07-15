import { StrictMode } from 'react'
import { act, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { simulationJointSource } from '../features/joints/SimulationJointSource'
import { useRobotStore } from '../features/joints/robot-store'
import { App, RobotTargetInspector } from './App'
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
    localStorage.clear()
    useRobotStore.getState().reset()
  })

  it('renders the five industrial workstation regions', () => {
    render(<AppShell viewport={<div>3D viewport</div>} />)
    expect(screen.getByRole('banner')).toHaveTextContent('RobotSim')
    expect(screen.getByLabelText('Scene Assets')).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Scene Objects' })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Robot Jobs' })).toBeInTheDocument()
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
    expect(screen.getByRole('button', { name: 'Add' })).toBeEnabled()
  })

  it('consolidates imports and primitives in one Add menu', async () => {
    const user = userEvent.setup()
    const onOpenStepImport = vi.fn()
    render(
      <AppShell
        onOpenStepImport={onOpenStepImport}
        viewport={<div>3D viewport</div>}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'Add' }))
    await user.click(screen.getByRole('menuitem', { name: 'Import STEP' }))

    expect(onOpenStepImport).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('button', { name: 'Robot Config' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Robot Geometry' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Coordinate Frames' })).not.toBeInTheDocument()
  })

  it('keeps the document fixed while named work areas own scrolling', () => {
    render(
      <AppShell
        assetTree={<div>Scene tree</div>}
        bottomRail={<div>Bottom content</div>}
        jobTree={<div>Job tree</div>}
        viewport={<div>3D viewport</div>}
      />,
    )

    expect(document.documentElement).toHaveStyle({ overflow: 'hidden' })
    expect(document.body).toHaveStyle({ overflow: 'hidden' })
    expect(screen.getByLabelText('3D viewport').closest('.app-shell')).toHaveStyle({
      height: '100dvh',
      overflow: 'hidden',
    })
    expect(screen.getByRole('region', { name: 'Robot Jobs' })).toHaveClass('sidebar-pane')
    expect(screen.getByLabelText('Timeline and Events')).toContainElement(
      screen.getByText('Bottom content'),
    )
  })

  it('persists the draggable 60/40 split only in browser preferences', () => {
    const activeProject = { simulation: { activeJobId: null, jobs: [] } }
    const before = JSON.stringify(activeProject)
    render(
      <AppShell
        assetTree={<div>Scene tree</div>}
        jobTree={<div>Job tree</div>}
        viewport={<div>3D viewport</div>}
      />,
    )
    const sidebar = screen.getByLabelText('Scene Assets')
    vi.spyOn(sidebar, 'getBoundingClientRect').mockReturnValue({
      bottom: 100,
      height: 100,
      left: 0,
      right: 248,
      top: 0,
      width: 248,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    })

    const divider = screen.getByRole('separator', { name: 'Resize Scene Objects and Robot Jobs' })
    fireEvent.pointerDown(divider, { clientY: 60, pointerId: 1 })
    fireEvent.pointerMove(window, { clientY: 55, pointerId: 1 })
    fireEvent.pointerUp(window, { pointerId: 1 })

    expect(divider).toHaveAttribute('aria-valuenow', '55')
    expect(localStorage.getItem('robotsim.sidebarSplitPercent')).toBe('55')
    expect(JSON.stringify(activeProject)).toBe(before)
    expect(JSON.stringify(activeProject)).not.toContain('sidebarSplitPercent')
  })

  it('keeps Robot editors out of the permanent top bar', () => {
    render(<AppShell viewport={<div>3D viewport</div>} />)

    expect(screen.queryByRole('button', { name: 'Coordinate Frames' })).not.toBeInTheDocument()
  })

  it('moves Robot Mechanics, Geometry, and Frames into target-specific Inspector tabs', async () => {
    const user = userEvent.setup()
    const openMechanics = vi.fn()
    render(
      <RobotTargetInspector
        onOpenFrames={vi.fn()}
        onOpenGeometry={vi.fn()}
        onOpenMechanics={openMechanics}
        transform={<div>Transform editor</div>}
      />,
    )

    expect(screen.getByRole('tablist', { name: 'Robot Inspector editors' })).toBeVisible()
    expect(screen.getByRole('tabpanel', { name: 'Transform' })).toHaveTextContent('Transform editor')
    await user.click(screen.getByRole('tab', { name: 'Mechanics' }))
    expect(screen.getByRole('tabpanel', { name: 'Mechanics' })).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Open Mechanics editor' }))
    expect(openMechanics).toHaveBeenCalledOnce()
  })

  it('wires the top-bar action to the accessible import dialog', async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.click(screen.getByRole('button', { name: 'Add' }))
    await user.click(screen.getByRole('menuitem', { name: 'Import STEP' }))
    expect(screen.getByRole('dialog', { name: 'Import STEP' })).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Close import dialog' }))
    expect(screen.queryByRole('dialog', { name: 'Import STEP' })).not.toBeInTheDocument()
  })

  it('composes Scene Objects, Robot Jobs, and mutually exclusive bottom tabs in App', async () => {
    const user = userEvent.setup()
    render(<App />)

    expect(screen.getByRole('region', { name: 'Scene Objects' })).toBeVisible()
    expect(screen.getByRole('region', { name: 'Robot Jobs' })).toBeVisible()
    expect(screen.getByRole('button', { name: '+ New Job' })).toBeVisible()
    expect(screen.getByRole('tabpanel', { name: 'Timeline' })).toBeVisible()
    expect(screen.queryByRole('tabpanel', { name: 'Collision' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('tab', { name: /^Collision/ }))
    expect(screen.getByRole('tabpanel', { name: 'Collision' })).toBeVisible()
    expect(screen.queryByRole('tabpanel', { name: 'Timeline' })).not.toBeInTheDocument()
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

  it('mounts the inspector and timeline and gates pose capture until a Job exists', async () => {
    const user = userEvent.setup()
    render(<App />)

    expect(screen.getByRole('heading', { name: 'Inspector' })).toBeVisible()
    expect(screen.getByRole('heading', { name: 'Timeline' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'Home' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Stop' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Save Pose' })).toBeDisabled()
    expect(screen.getByText(/create a Job/i)).toBeVisible()

    await user.click(screen.getByRole('button', { name: 'Scene ready' }))
    expect(screen.getByRole('button', { name: 'Home' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Stop' })).toBeEnabled()
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
