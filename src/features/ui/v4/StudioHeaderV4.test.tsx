import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { createAppCommandBindingsV4, createAppCommandRuntimeV4 } from '../../commands/v4/app-command-runtime.js'
import { createAppCommandRegistryV4 } from '../../commands/v4/app-command-registry.js'
import type { AppHeaderStatusV4 } from './app-header-status.js'
import type { AppMenuSectionModelV4 } from './app-menu-model.js'
import { createShellLayoutControllerV4 } from './shell-layout-controller.js'
import { initialShellLayoutBoundsV4 } from './shell-layout-geometry.js'
import { createShellLayoutStoreV4 } from './shell-layout-store.js'
import { StudioHeaderV4 } from './StudioHeaderV4.js'

const status: AppHeaderStatusV4 = {
  project: { name: 'An intentionally long Project name that must truncate in place', phase: 'ready', saved: true, message: null },
  simulation: { runningJobCount: 1, robotCount: 2 },
  jointSource: { activeRobotName: 'Robot Two', sourceLabel: 'Simulation' },
  gateway: { modeLabel: 'OPC UA Server', statusLabel: 'Ready', endpoint: 'opc.tcp://localhost:4840' },
}

const model: readonly AppMenuSectionModelV4[] = Object.freeze([
  { id: 'project', label: 'Project', children: Object.freeze([{ kind: 'command' as const, commandId: 'project.save' }]) },
  { id: 'home', label: 'Home', children: Object.freeze([{ kind: 'command' as const, commandId: 'robot.home' }]) },
])

function bindings() {
  return createAppCommandBindingsV4(createAppCommandRuntimeV4(createAppCommandRegistryV4([
    { id: 'project.save', label: 'Save Project', section: 'project', kind: 'action', visible: true, enabled: true, execute: vi.fn() },
    { id: 'job.start', label: 'Start Job', section: 'job', kind: 'action', visible: true, enabled: false, disabledReason: 'No active Job.', execute: vi.fn() },
    { id: 'job.cancel', label: 'Cancel Active Robot Job', section: 'job', kind: 'action', visible: true, enabled: false, disabledReason: 'No running Job.', execute: vi.fn() },
    { id: 'robot.home', label: 'Robot Home', section: 'home', kind: 'action', visible: true, enabled: true, execute: vi.fn() },
  ])))
}

function controller(width = 1440) {
  return createShellLayoutControllerV4({ preferencesStore: createShellLayoutStoreV4({ storage: null }), initialBounds: initialShellLayoutBoundsV4(width, 900) })
}

describe('StudioHeaderV4', () => {
  it('owns the controlled open section so a global menu preview temporarily replaces the target context', async () => {
    render(<StudioHeaderV4 status={status} menuModel={model} commandBindings={bindings()} quickActionIds={['project.save', 'job.start', 'job.cancel']} ribbonContext={{ selection: { kind: 'robot', robotId: 'robot-2' }, activeRobotId: 'robot-2', activeJobId: null }} shellLayoutController={controller()} />)
    expect(screen.getByRole('toolbar', { name: 'Context commands' })).toHaveTextContent('Robot Home')
    fireEvent.keyDown(screen.getByRole('menuitem', { name: 'Project' }), { key: 'ArrowDown' })
    await waitFor(() => expect(screen.getByRole('toolbar', { name: 'Context commands' })).toHaveTextContent('Save Project'))
    fireEvent.keyDown(screen.getByRole('menu', { name: 'Project' }), { key: 'Escape' })
    await waitFor(() => expect(screen.getByRole('toolbar', { name: 'Context commands' })).toHaveTextContent('Robot Home'))
  })

  it('uses exact status input and preserves Quick Actions while compact labels replace wide labels', () => {
    const layout = controller(1440)
    render(<StudioHeaderV4 status={status} menuModel={model} commandBindings={bindings()} quickActionIds={['project.save', 'job.start', 'job.cancel']} ribbonContext={{ selection: null, activeRobotId: null, activeJobId: null }} shellLayoutController={layout} />)
    expect(screen.getByText('Running Jobs: 1')).toBeInTheDocument()
    expect(screen.getByText('Robot Two · Simulation')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save Project' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Start Job' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Cancel Active Robot Job' })).toBeInTheDocument()
    expect(screen.getByLabelText('Quick Actions').querySelectorAll('button')).toHaveLength(3)
    act(() => layout.setBounds(1199, 900))
    expect(screen.getByText('Jobs: 1')).toBeInTheDocument()
    expect(screen.getByText('Robot Two')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save Project' })).toBeInTheDocument()
    act(() => layout.setBounds(960, 900))
    expect(screen.getByText('Jobs: 1')).toBeInTheDocument()
  })

  it('uses compact Menu at compact and narrow breakpoints while keeping long Project copy truncatable in place', () => {
    const layout = controller(1199)
    render(<StudioHeaderV4 status={{ ...status, jointSource: { activeRobotName: null, sourceLabel: null } }} menuModel={model} commandBindings={bindings()} quickActionIds={['project.save', 'job.start', 'job.cancel']} ribbonContext={{ selection: null, activeRobotId: null, activeJobId: null }} shellLayoutController={layout} />)
    expect(screen.getByRole('button', { name: 'Menu' })).toBeInTheDocument()
    expect(screen.getByText('No active Robot')).toBeInTheDocument()
    expect(screen.getByTestId('project-name')).toHaveClass('studio-header-project-name-v4')
    act(() => layout.setBounds(959, 900))
    expect(screen.getByRole('button', { name: 'Menu' })).toBeInTheDocument()
  })

  it('uses the compact Menu controlled section as the exact Ribbon preview source', async () => {
    const layout = controller(1199)
    act(() => layout.setRibbonExpanded(true))
    render(<StudioHeaderV4 status={status} menuModel={model} commandBindings={bindings()} quickActionIds={['project.save', 'job.start', 'job.cancel']} ribbonContext={{ selection: { kind: 'robot', robotId: 'robot-2' }, activeRobotId: 'robot-2', activeJobId: null }} shellLayoutController={layout} />)
    fireEvent.click(screen.getByRole('button', { name: 'Menu' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Project' }))
    await waitFor(() => expect(screen.getByRole('toolbar', { name: 'Context commands' })).toHaveTextContent('Save Project'))
    fireEvent.keyDown(screen.getByRole('menu', { name: 'Project' }), { key: 'Escape' })
    await waitFor(() => expect(screen.getByRole('toolbar', { name: 'Context commands' })).toHaveTextContent('Robot Home'))
  })
})
