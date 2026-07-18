import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { createAppCommandBindingsV4, createAppCommandRuntimeV4 } from '../../commands/v4/app-command-runtime.js'
import { createAppCommandRegistryV4 } from '../../commands/v4/app-command-registry.js'
import { createShellLayoutControllerV4 } from './shell-layout-controller.js'
import { initialShellLayoutBoundsV4 } from './shell-layout-geometry.js'
import { createShellLayoutStoreV4 } from './shell-layout-store.js'
import { RibbonLiteV4 } from './RibbonLiteV4.js'

function controller(width = 1440) {
  return createShellLayoutControllerV4({
    preferencesStore: createShellLayoutStoreV4({ storage: null }),
    initialBounds: initialShellLayoutBoundsV4(width, 900),
  })
}

function bindings() {
  return createAppCommandBindingsV4(createAppCommandRuntimeV4(createAppCommandRegistryV4([
    { id: 'model.add.box', label: 'Add Box', section: 'model', kind: 'action', visible: true, enabled: true, execute: vi.fn() },
    { id: 'model.add.cylinder', label: 'Add Cylinder', section: 'model', kind: 'action', visible: true, enabled: true, execute: vi.fn() },
    { id: 'model.add.group', label: 'Add Group', section: 'model', kind: 'action', visible: true, enabled: true, execute: vi.fn() },
    { id: 'view.fitAll', label: 'Fit All', section: 'view', kind: 'action', visible: true, enabled: true, execute: vi.fn() },
  ])))
}

describe('RibbonLiteV4', () => {
  it('uses the Shell-owned expanded preference and collapses by default in compact and narrow modes', () => {
    const wide = controller(1440)
    const view = render(<RibbonLiteV4 commandBindings={bindings()} context={{ selection: null, activeRobotId: null, activeJobId: null, previewSection: null }} shellLayoutController={wide} />)
    expect(screen.getByRole('toolbar', { name: 'Context commands' })).toBeVisible()
    act(() => wide.setRibbonExpanded(false))
    expect(document.getElementById('ribbon-lite-v4')).not.toBeVisible()
    view.unmount()

    const compact = controller(1199)
    render(<RibbonLiteV4 commandBindings={bindings()} context={{ selection: null, activeRobotId: null, activeJobId: null, previewSection: null }} shellLayoutController={compact} />)
    expect(document.getElementById('ribbon-lite-v4')).not.toBeVisible()
    act(() => compact.setRibbonExpanded(true))
    expect(screen.getByRole('toolbar', { name: 'Context commands' })).toBeVisible()
    act(() => compact.setBounds(959, 900))
    expect(document.getElementById('ribbon-lite-v4')).not.toBeVisible()
  })

  it('renders only visible command labels with Lucide-backed accessible buttons and one More menu', async () => {
    render(<RibbonLiteV4 commandBindings={bindings()} context={{ selection: null, activeRobotId: null, activeJobId: null, previewSection: null }} shellLayoutController={controller()} availableWidthPx={154} measuredWidthPxByCommandId={{ 'model.add.box': 40, 'model.add.cylinder': 40, 'model.add.group': 40, 'view.fitAll': 40 }} moreWidthPx={36} />)
    expect(screen.getByRole('button', { name: 'Add Box' })).toHaveAttribute('title', 'Add Box')
    expect(screen.getByRole('button', { name: 'More commands' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'More commands' }))
    await waitFor(() => expect(screen.getByRole('menu', { name: 'More commands' })).toBeInTheDocument())
    expect(screen.getByRole('menuitem', { name: 'Fit All' })).toBeInTheDocument()
  })
})
