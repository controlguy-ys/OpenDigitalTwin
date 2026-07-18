import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useState } from 'react'
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

const gatewayDetailsProps = {
  gatewayDetailsOpen: false,
  onGatewayDetailsOpenChange: vi.fn(),
} as const

function bindings() {
  return createAppCommandBindingsV4(createAppCommandRuntimeV4(createAppCommandRegistryV4([
    { id: 'project.save', label: 'Save Project', section: 'project', kind: 'action', visible: true, enabled: true, execute: vi.fn() },
    { id: 'job.start', label: 'Start Job', section: 'job', kind: 'action', visible: true, enabled: false, disabledReason: 'No active Job.', execute: vi.fn() },
    { id: 'job.cancel', label: 'Cancel Active Robot Job', section: 'job', kind: 'action', visible: true, enabled: false, disabledReason: 'No running Job.', execute: vi.fn() },
    { id: 'robot.home', label: 'Robot Home', section: 'home', kind: 'action', visible: true, enabled: true, execute: vi.fn() },
    { id: 'view.ribbon', label: 'Toggle Ribbon Lite', section: 'view', kind: 'toggle', visible: true, enabled: true, checked: false, execute: vi.fn() },
  ])))
}

function controller(width = 1440) {
  return createShellLayoutControllerV4({ preferencesStore: createShellLayoutStoreV4({ storage: null }), initialBounds: initialShellLayoutBoundsV4(width, 900) })
}

function GatewayHeaderHarnessV4({ commandStyleOpen = false, width = 1440 }: { readonly commandStyleOpen?: boolean; readonly width?: number }) {
  const [gatewayDetailsOpen, setGatewayDetailsOpen] = useState(false)
  const [shellLayoutController] = useState(() => controller(width))
  return <>
    {commandStyleOpen ? <button onClick={() => setGatewayDetailsOpen(true)} type="button">Open Gateway command</button> : null}
    <StudioHeaderV4
      status={status}
      menuModel={model}
      commandBindings={bindings()}
      quickActionIds={['project.save', 'job.start', 'job.cancel']}
      ribbonContext={{ selection: null, activeRobotId: null, activeJobId: null }}
      shellLayoutController={shellLayoutController}
      gatewayDetailsOpen={gatewayDetailsOpen}
      onGatewayDetailsOpenChange={setGatewayDetailsOpen}
    />
  </>
}

describe('StudioHeaderV4', () => {
  it('owns the controlled open section so a global menu preview temporarily replaces the target context', async () => {
    render(<StudioHeaderV4 status={status} menuModel={model} commandBindings={bindings()} quickActionIds={['project.save', 'job.start', 'job.cancel']} ribbonContext={{ selection: { kind: 'robot', robotId: 'robot-2' }, activeRobotId: 'robot-2', activeJobId: null }} shellLayoutController={controller()} {...gatewayDetailsProps} />)
    expect(screen.getByRole('toolbar', { name: 'Context commands' })).toHaveTextContent('Robot Home')
    fireEvent.keyDown(screen.getByRole('menuitem', { name: 'Project' }), { key: 'ArrowDown' })
    await waitFor(() => expect(screen.getByRole('toolbar', { name: 'Context commands' })).toHaveTextContent('Save Project'))
    fireEvent.keyDown(screen.getByRole('menu', { name: 'Project' }), { key: 'Escape' })
    await waitFor(() => expect(screen.getByRole('toolbar', { name: 'Context commands' })).toHaveTextContent('Robot Home'))
  })

  it('uses exact status input and preserves Quick Actions while compact labels replace wide labels', () => {
    const layout = controller(1440)
    render(<StudioHeaderV4 status={status} menuModel={model} commandBindings={bindings()} quickActionIds={['project.save', 'job.start', 'job.cancel']} ribbonContext={{ selection: null, activeRobotId: null, activeJobId: null }} shellLayoutController={layout} {...gatewayDetailsProps} />)
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
    render(<StudioHeaderV4 status={{ ...status, jointSource: { activeRobotName: null, sourceLabel: null } }} menuModel={model} commandBindings={bindings()} quickActionIds={['project.save', 'job.start', 'job.cancel']} ribbonContext={{ selection: null, activeRobotId: null, activeJobId: null }} shellLayoutController={layout} {...gatewayDetailsProps} />)
    expect(screen.getByRole('button', { name: 'Menu' })).toBeInTheDocument()
    expect(screen.getByText('No active Robot')).toBeInTheDocument()
    expect(screen.getByTestId('project-name')).toHaveClass('studio-header-project-name-v4')
    act(() => layout.setBounds(959, 900))
    expect(screen.getByRole('button', { name: 'Menu' })).toBeInTheDocument()
  })

  it('uses the compact Menu controlled section as the exact Ribbon preview source', async () => {
    const layout = controller(1199)
    act(() => layout.setRibbonExpanded(true))
    render(<StudioHeaderV4 status={status} menuModel={model} commandBindings={bindings()} quickActionIds={['project.save', 'job.start', 'job.cancel']} ribbonContext={{ selection: { kind: 'robot', robotId: 'robot-2' }, activeRobotId: 'robot-2', activeJobId: null }} shellLayoutController={layout} {...gatewayDetailsProps} />)
    fireEvent.click(screen.getByRole('button', { name: 'Menu' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Project' }))
    await waitFor(() => expect(screen.getByRole('toolbar', { name: 'Context commands' })).toHaveTextContent('Save Project'))
    fireEvent.keyDown(screen.getByRole('menu', { name: 'Project' }), { key: 'Escape' })
    await waitFor(() => expect(screen.getByRole('toolbar', { name: 'Context commands' })).toHaveTextContent('Robot Home'))
  })

  it('uses the Robot name alone when an active Robot has no current Joint runtime source', () => {
    render(<StudioHeaderV4 status={{ ...status, jointSource: { activeRobotName: 'Robot Two', sourceLabel: null } }} menuModel={model} commandBindings={bindings()} quickActionIds={['project.save', 'job.start', 'job.cancel']} ribbonContext={{ selection: null, activeRobotId: null, activeJobId: null }} shellLayoutController={controller()} {...gatewayDetailsProps} />)
    expect(screen.getByText('Robot Two')).toBeInTheDocument()
    expect(screen.getByLabelText('Application status')).not.toHaveTextContent('null')
  })

  it('surfaces Quick Action pending, error, and outcome state through the shared command runtime', async () => {
    let complete: (() => void) | undefined
    const start = vi.fn(() => new Promise<void>((resolve) => { complete = resolve }))
    const cancel = vi.fn(() => { throw new Error('Cancel failed.') })
    const commandBindings = createAppCommandBindingsV4(createAppCommandRuntimeV4(createAppCommandRegistryV4([
      { id: 'project.save', label: 'Save Project', section: 'project', kind: 'action', visible: true, enabled: true, execute: vi.fn() },
      { id: 'job.start', label: 'Start Job', section: 'job', kind: 'action', visible: true, enabled: true, execute: start },
      { id: 'job.cancel', label: 'Cancel Active Robot Job', section: 'job', kind: 'action', visible: true, enabled: true, execute: cancel },
      { id: 'view.ribbon', label: 'Toggle Ribbon Lite', section: 'view', kind: 'toggle', visible: true, enabled: true, checked: false, execute: vi.fn() },
    ])))
    render(<StudioHeaderV4 status={status} menuModel={model} commandBindings={commandBindings} quickActionIds={['project.save', 'job.start', 'job.cancel']} ribbonContext={{ selection: null, activeRobotId: null, activeJobId: null }} shellLayoutController={controller()} {...gatewayDetailsProps} />)

    fireEvent.click(screen.getByRole('button', { name: 'Start Job' }))
    expect(screen.getByRole('button', { name: 'Start Job' })).toHaveAttribute('aria-busy', 'true')
    expect(start).toHaveBeenCalledTimes(1)
    complete?.()
    await waitFor(() => expect(screen.getByRole('button', { name: 'Start Job' })).not.toHaveAttribute('aria-busy'))

    fireEvent.click(screen.getByRole('button', { name: 'Cancel Active Robot Job' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Cancel failed.')
    expect(cancel).toHaveBeenCalledTimes(1)
  })

  it('invokes the shared view.ribbon command without mutating the Shell layout directly', async () => {
    const layout = controller()
    const toggle = vi.fn()
    const commandBindings = createAppCommandBindingsV4(createAppCommandRuntimeV4(createAppCommandRegistryV4([
      { id: 'project.save', label: 'Save Project', section: 'project', kind: 'action', visible: true, enabled: true, execute: vi.fn() },
      { id: 'job.start', label: 'Start Job', section: 'job', kind: 'action', visible: true, enabled: false, execute: vi.fn() },
      { id: 'job.cancel', label: 'Cancel Active Robot Job', section: 'job', kind: 'action', visible: true, enabled: false, execute: vi.fn() },
      { id: 'robot.home', label: 'Robot Home', section: 'home', kind: 'action', visible: true, enabled: true, execute: vi.fn() },
      { id: 'view.ribbon', label: 'Toggle Ribbon Lite', section: 'view', kind: 'toggle', visible: true, enabled: true, checked: false, execute: toggle },
    ])))
    render(<StudioHeaderV4 status={status} menuModel={model} commandBindings={commandBindings} quickActionIds={['project.save', 'job.start', 'job.cancel']} ribbonContext={{ selection: null, activeRobotId: null, activeJobId: null }} shellLayoutController={layout} {...gatewayDetailsProps} />)

    const expandedBeforeInvoke = layout.getState().isRibbonExpanded()
    fireEvent.click(screen.getByRole('button', { name: 'Toggle Ribbon Lite' }))
    await waitFor(() => expect(toggle).toHaveBeenCalledTimes(1))
    expect(layout.getState().isRibbonExpanded()).toBe(expandedBeforeInvoke)
  })

  it('exposes exact Gateway mode, status, and endpoint through a controlled disclosure that closes on close, Escape, and outside pointer', () => {
    const onGatewayDetailsOpenChange = vi.fn()
    const props = {
      status,
      menuModel: model,
      commandBindings: bindings(),
      quickActionIds: ['project.save', 'job.start', 'job.cancel'] as const,
      ribbonContext: { selection: null, activeRobotId: null, activeJobId: null },
      shellLayoutController: controller(),
      onGatewayDetailsOpenChange,
    }
    const view = render(<StudioHeaderV4 {...props} gatewayDetailsOpen={false} />)

    fireEvent.click(screen.getByRole('button', { name: /Gateway details:/ }))
    expect(onGatewayDetailsOpenChange).toHaveBeenLastCalledWith(true)

    view.rerender(<StudioHeaderV4 {...props} gatewayDetailsOpen />)
    const details = screen.getByRole('dialog', { name: 'Gateway details' })
    expect(details).toHaveTextContent('OPC UA Server')
    expect(details).toHaveTextContent('Ready')
    expect(details).toHaveTextContent('opc.tcp://localhost:4840')
    fireEvent.click(screen.getByRole('button', { name: 'Close Gateway details' }))
    expect(onGatewayDetailsOpenChange).toHaveBeenLastCalledWith(false)
    view.rerender(<StudioHeaderV4 {...props} gatewayDetailsOpen={false} />)
    expect(screen.queryByRole('dialog', { name: 'Gateway details' })).toBeNull()

    view.rerender(<StudioHeaderV4 {...props} gatewayDetailsOpen />)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onGatewayDetailsOpenChange).toHaveBeenLastCalledWith(false)
    view.rerender(<StudioHeaderV4 {...props} gatewayDetailsOpen={false} />)
    expect(screen.queryByRole('dialog', { name: 'Gateway details' })).toBeNull()

    view.rerender(<StudioHeaderV4 {...props} gatewayDetailsOpen />)
    fireEvent.pointerDown(document.body)
    expect(onGatewayDetailsOpenChange).toHaveBeenLastCalledWith(false)
    view.rerender(<StudioHeaderV4 {...props} gatewayDetailsOpen={false} />)
    expect(screen.queryByRole('dialog', { name: 'Gateway details' })).toBeNull()
  })

  it('moves focus into the Gateway dialog and restores its status trigger after every disclosure close route', async () => {
    render(<GatewayHeaderHarnessV4 />)
    const trigger = screen.getByRole('button', { name: 'Gateway details: OPC UA Server · Ready' })

    fireEvent.click(trigger)
    expect(await screen.findByRole('dialog', { name: 'Gateway details' })).toHaveFocus()
    fireEvent.click(screen.getByRole('button', { name: 'Close Gateway details' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Gateway details' })).toBeNull())
    expect(trigger).toHaveFocus()

    fireEvent.click(trigger)
    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Gateway details' })).toBeNull())
    expect(trigger).toHaveFocus()

    fireEvent.click(trigger)
    fireEvent.pointerDown(document.body)
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Gateway details' })).toBeNull())
    expect(trigger).toHaveFocus()
  })

  it('uses the persistent Gateway status trigger as the controlled command-style open fallback and cleans listeners on unmount', async () => {
    const view = render(<GatewayHeaderHarnessV4 commandStyleOpen />)
    const trigger = screen.getByRole('button', { name: 'Gateway details: OPC UA Server · Ready' })
    fireEvent.click(screen.getByRole('button', { name: 'Open Gateway command' }))
    expect(await screen.findByRole('dialog', { name: 'Gateway details' })).toHaveFocus()
    fireEvent.click(screen.getByRole('button', { name: 'Close Gateway details' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Gateway details' })).toBeNull())
    expect(trigger).toHaveFocus()

    const onGatewayDetailsOpenChange = vi.fn()
    view.rerender(<StudioHeaderV4 status={status} menuModel={model} commandBindings={bindings()} quickActionIds={['project.save', 'job.start', 'job.cancel']} ribbonContext={{ selection: null, activeRobotId: null, activeJobId: null }} shellLayoutController={controller()} gatewayDetailsOpen onGatewayDetailsOpenChange={onGatewayDetailsOpenChange} />)
    expect(screen.getByRole('dialog', { name: 'Gateway details' })).toHaveFocus()
    view.unmount()
    fireEvent.keyDown(document, { key: 'Escape' })
    fireEvent.pointerDown(document.body)
    expect(onGatewayDetailsOpenChange).not.toHaveBeenCalled()
  })

  it('restores the visible narrow Gateway fallback after a command-style open closes', async () => {
    render(<GatewayHeaderHarnessV4 commandStyleOpen width={959} />)
    const fallback = screen.getByRole('button', { name: 'Gateway details: Gateway: Ready' })

    fireEvent.click(screen.getByRole('button', { name: 'Open Gateway command' }))
    expect(await screen.findByRole('dialog', { name: 'Gateway details' })).toHaveFocus()
    fireEvent.click(screen.getByRole('button', { name: 'Close Gateway details' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Gateway details' })).toBeNull())
    expect(fallback).toHaveFocus()
  })
})
