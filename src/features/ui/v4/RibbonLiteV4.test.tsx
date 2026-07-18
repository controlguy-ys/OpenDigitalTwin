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

const emptyContext = { selection: null, activeRobotId: null, activeJobId: null, previewSection: null } as const

function runtimeBindings(commands: Parameters<typeof createAppCommandRegistryV4>[0]) {
  const runtime = createAppCommandRuntimeV4(createAppCommandRegistryV4(commands))
  return { bindings: createAppCommandBindingsV4(runtime), runtime }
}

describe('RibbonLiteV4', () => {
  it('uses the Shell-owned expanded preference and collapses by default in compact and narrow modes', () => {
    const wide = controller(1440)
    const view = render(<RibbonLiteV4 commandBindings={bindings()} context={emptyContext} shellLayoutController={wide} />)
    expect(screen.getByRole('toolbar', { name: 'Context commands' })).toBeVisible()
    act(() => wide.setRibbonExpanded(false))
    expect(document.getElementById('ribbon-lite-v4')).not.toBeVisible()
    view.unmount()

    const compact = controller(1199)
    render(<RibbonLiteV4 commandBindings={bindings()} context={emptyContext} shellLayoutController={compact} />)
    expect(document.getElementById('ribbon-lite-v4')).not.toBeVisible()
    act(() => compact.setRibbonExpanded(true))
    expect(screen.getByRole('toolbar', { name: 'Context commands' })).toBeVisible()
    act(() => compact.setBounds(959, 900))
    expect(document.getElementById('ribbon-lite-v4')).not.toBeVisible()
  })

  it('renders only visible command labels with Lucide-backed accessible buttons and one More menu', async () => {
    render(<RibbonLiteV4 commandBindings={bindings()} context={emptyContext} shellLayoutController={controller()} availableWidthPx={154} measuredWidthPxByCommandId={{ 'model.add.box': 40, 'model.add.cylinder': 40, 'model.add.group': 40, 'view.fitAll': 40 }} moreWidthPx={36} />)
    expect(screen.getByRole('toolbar', { name: 'Context commands' })).not.toHaveAttribute('data-more-open')
    expect(screen.getByRole('button', { name: 'Add Box' })).toHaveAttribute('title', 'Add Box')
    expect(screen.getByRole('button', { name: 'More commands' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'More commands' }))
    await waitFor(() => expect(screen.getByRole('menu', { name: 'More commands' })).toBeInTheDocument())
    expect(screen.getByRole('menuitem', { name: 'Fit All' })).toBeInTheDocument()
  })

  it('focuses the first enabled More command and supports logical keyboard navigation that skips disabled menuitems', async () => {
    const { bindings: commandBindings } = runtimeBindings([
      { id: 'model.add.box', label: 'Add Box', section: 'model', kind: 'action', visible: true, enabled: true, execute: vi.fn() },
      { id: 'model.add.cylinder', label: 'Add Cylinder', section: 'model', kind: 'action', visible: true, enabled: false, disabledReason: 'Unavailable.', execute: vi.fn() },
      { id: 'model.add.group', label: 'Add Group', section: 'model', kind: 'action', visible: true, enabled: true, execute: vi.fn() },
    ])
    render(<RibbonLiteV4 commandBindings={commandBindings} context={emptyContext} shellLayoutController={controller()} availableWidthPx={36} measuredWidthPxByCommandId={{ 'model.add.box': 40, 'model.add.cylinder': 40, 'model.add.group': 40 }} moreWidthPx={36} />)
    const more = screen.getByRole('button', { name: 'More commands' })

    fireEvent.click(more)
    const menu = await screen.findByRole('menu', { name: 'More commands' })
    const box = screen.getByRole('menuitem', { name: 'Add Box' })
    const group = screen.getByRole('menuitem', { name: 'Add Group' })
    expect(box).toHaveFocus()
    fireEvent.keyDown(menu, { key: 'ArrowDown' })
    expect(group).toHaveFocus()
    fireEvent.keyDown(menu, { key: 'ArrowUp' })
    expect(box).toHaveFocus()
    fireEvent.keyDown(menu, { key: 'End' })
    expect(group).toHaveFocus()
    fireEvent.keyDown(menu, { key: 'Home' })
    expect(box).toHaveFocus()
    fireEvent.keyDown(menu, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('menu', { name: 'More commands' })).toBeNull())
    expect(more).toHaveFocus()
  })

  it('restores More only when a reset closes a menu that owns focus', async () => {
    const commandBindings = bindings()
    const shellLayoutController = controller()
    const { rerender } = render(<RibbonLiteV4 commandBindings={commandBindings} context={emptyContext} shellLayoutController={shellLayoutController} availableWidthPx={116} measuredWidthPxByCommandId={{ 'model.add.box': 40, 'model.add.cylinder': 40, 'model.add.group': 40 }} moreWidthPx={36} />)
    const more = screen.getByRole('button', { name: 'More commands' })
    fireEvent.click(more)
    await screen.findByRole('menu', { name: 'More commands' })
    fireEvent.pointerDown(document.body)
    await waitFor(() => expect(screen.queryByRole('menu', { name: 'More commands' })).toBeNull())
    expect(more).toHaveFocus()

    fireEvent.click(more)
    await screen.findByRole('menu', { name: 'More commands' })
    const outside = document.createElement('button')
    outside.textContent = 'Outside focus'
    document.body.append(outside)
    outside.focus()
    rerender(<RibbonLiteV4 commandBindings={commandBindings} context={{ ...emptyContext, previewSection: 'project' }} shellLayoutController={shellLayoutController} availableWidthPx={116} measuredWidthPxByCommandId={{ 'model.add.box': 40, 'model.add.cylinder': 40, 'model.add.group': 40 }} moreWidthPx={36} />)
    await waitFor(() => expect(screen.queryByRole('menu', { name: 'More commands' })).toBeNull())
    expect(outside).toHaveFocus()
    outside.remove()
  })

  it('subscribes at the ribbon boundary so a runtime registry replacement reveals a newly visible command', () => {
    const { bindings: commandBindings, runtime } = runtimeBindings([
      { id: 'model.add.box', label: 'Add Box', section: 'model', kind: 'action', visible: true, enabled: true, execute: vi.fn() },
      { id: 'model.add.cylinder', label: 'Add Cylinder', section: 'model', kind: 'action', visible: false, enabled: true, execute: vi.fn() },
      { id: 'model.add.group', label: 'Add Group', section: 'model', kind: 'action', visible: false, enabled: true, execute: vi.fn() },
    ])
    render(<RibbonLiteV4 commandBindings={commandBindings} context={emptyContext} shellLayoutController={controller()} />)
    expect(screen.queryByRole('button', { name: 'Add Cylinder' })).toBeNull()

    act(() => runtime.replaceRegistry(createAppCommandRegistryV4([
      { id: 'model.add.box', label: 'Add Box', section: 'model', kind: 'action', visible: true, enabled: true, execute: vi.fn() },
      { id: 'model.add.cylinder', label: 'Add Cylinder', section: 'model', kind: 'action', visible: true, enabled: true, execute: vi.fn() },
      { id: 'model.add.group', label: 'Add Group', section: 'model', kind: 'action', visible: false, enabled: true, execute: vi.fn() },
    ])))

    expect(screen.getByRole('button', { name: 'Add Cylinder' })).toBeInTheDocument()
  })

  it('surfaces command pending and failure state for visible and More commands', async () => {
    let complete: (() => void) | undefined
    const { bindings: commandBindings } = runtimeBindings([
      { id: 'model.add.box', label: 'Add Box', section: 'model', kind: 'action', visible: true, enabled: true, execute: () => new Promise<void>((resolve) => { complete = resolve }) },
      { id: 'model.add.cylinder', label: 'Add Cylinder', section: 'model', kind: 'action', visible: true, enabled: true, execute: vi.fn() },
      { id: 'model.add.group', label: 'Add Group', section: 'model', kind: 'action', visible: true, enabled: true, execute: () => { throw new Error('Group failed.') } },
    ])
    render(<RibbonLiteV4 commandBindings={commandBindings} context={emptyContext} shellLayoutController={controller()} availableWidthPx={116} measuredWidthPxByCommandId={{ 'model.add.box': 40, 'model.add.cylinder': 40, 'model.add.group': 40 }} moreWidthPx={36} />)

    fireEvent.click(screen.getByRole('button', { name: 'Add Box' }))
    expect(screen.getByRole('button', { name: 'Add Box' })).toHaveAttribute('aria-busy', 'true')
    complete?.()
    await waitFor(() => expect(screen.getByRole('button', { name: 'Add Box' })).not.toHaveAttribute('aria-busy'))

    fireEvent.click(screen.getByRole('button', { name: 'More commands' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Add Group' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Group failed.')
  })

  it('uses the completed command outcome to close More', async () => {
    const { bindings: commandBindings } = runtimeBindings([
      { id: 'model.add.box', label: 'Add Box', section: 'model', kind: 'action', visible: true, enabled: true, execute: vi.fn() },
      { id: 'model.add.cylinder', label: 'Add Cylinder', section: 'model', kind: 'action', visible: true, enabled: true, execute: vi.fn() },
      { id: 'model.add.group', label: 'Add Group', section: 'model', kind: 'action', visible: true, enabled: true, execute: vi.fn() },
    ])
    render(<RibbonLiteV4 commandBindings={commandBindings} context={emptyContext} shellLayoutController={controller()} availableWidthPx={116} measuredWidthPxByCommandId={{ 'model.add.box': 40, 'model.add.cylinder': 40, 'model.add.group': 40 }} moreWidthPx={36} />)
    const more = screen.getByRole('button', { name: 'More commands' })
    fireEvent.click(more)
    fireEvent.click(screen.getByRole('menuitem', { name: 'Add Group' }))
    await waitFor(() => expect(screen.queryByRole('menu', { name: 'More commands' })).toBeNull())
    expect(more).toHaveFocus()
  })

  it('dismisses and resets More on outside, Escape, context, and ribbon visibility changes without clipping its menu structure', async () => {
    const layout = controller()
    const { bindings: commandBindings, runtime } = runtimeBindings([
      { id: 'model.add.box', label: 'Add Box', section: 'model', kind: 'action', visible: true, enabled: true, execute: vi.fn() },
      { id: 'model.add.cylinder', label: 'Add Cylinder', section: 'model', kind: 'action', visible: true, enabled: true, execute: vi.fn() },
      { id: 'model.add.group', label: 'Add Group', section: 'model', kind: 'action', visible: true, enabled: true, execute: vi.fn() },
    ])
    const { rerender } = render(<RibbonLiteV4 commandBindings={commandBindings} context={emptyContext} shellLayoutController={layout} availableWidthPx={116} measuredWidthPxByCommandId={{ 'model.add.box': 40, 'model.add.cylinder': 40, 'model.add.group': 40 }} moreWidthPx={36} />)
    const more = screen.getByRole('button', { name: 'More commands' })

    fireEvent.click(more)
    expect(screen.getByRole('menu', { name: 'More commands' }).parentElement).toHaveClass('ribbon-more-v4')
    fireEvent.pointerDown(document.body)
    await waitFor(() => expect(screen.queryByRole('menu', { name: 'More commands' })).toBeNull())

    fireEvent.click(more)
    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('menu', { name: 'More commands' })).toBeNull())

    fireEvent.click(more)
    act(() => runtime.replaceRegistry(createAppCommandRegistryV4([
      { id: 'model.add.box', label: 'Add Box', section: 'model', kind: 'action', visible: true, enabled: true, execute: vi.fn() },
      { id: 'model.add.cylinder', label: 'Add Cylinder', section: 'model', kind: 'action', visible: true, enabled: true, execute: vi.fn() },
      { id: 'model.add.group', label: 'Add Group', section: 'model', kind: 'action', visible: false, enabled: true, execute: vi.fn() },
    ])))
    expect(screen.queryByRole('menu', { name: 'More commands' })).toBeNull()

    rerender(<RibbonLiteV4 commandBindings={commandBindings} context={{ ...emptyContext, previewSection: 'project' }} shellLayoutController={layout} availableWidthPx={116} measuredWidthPxByCommandId={{ 'model.add.box': 40, 'model.add.cylinder': 40, 'model.add.group': 40 }} moreWidthPx={36} />)
    expect(screen.queryByRole('menu', { name: 'More commands' })).toBeNull()

    rerender(<RibbonLiteV4 commandBindings={commandBindings} context={emptyContext} shellLayoutController={layout} availableWidthPx={116} measuredWidthPxByCommandId={{ 'model.add.box': 40, 'model.add.cylinder': 40, 'model.add.group': 40 }} moreWidthPx={36} />)
    act(() => runtime.replaceRegistry(createAppCommandRegistryV4([
      { id: 'model.add.box', label: 'Add Box', section: 'model', kind: 'action', visible: true, enabled: true, execute: vi.fn() },
      { id: 'model.add.cylinder', label: 'Add Cylinder', section: 'model', kind: 'action', visible: true, enabled: true, execute: vi.fn() },
      { id: 'model.add.group', label: 'Add Group', section: 'model', kind: 'action', visible: true, enabled: true, execute: vi.fn() },
    ])))
    fireEvent.click(screen.getByRole('button', { name: 'More commands' }))
    expect(document.querySelector<HTMLButtonElement>('[aria-label="More commands"]')).toHaveAttribute('aria-expanded', 'true')
    act(() => layout.setRibbonExpanded(false))
    expect(document.querySelector<HTMLButtonElement>('[aria-label="More commands"]')).toHaveAttribute('aria-expanded', 'false')
  })

  it('cleans More global dismissal listeners when its owner unmounts', async () => {
    const view = render(<RibbonLiteV4 commandBindings={bindings()} context={emptyContext} shellLayoutController={controller()} availableWidthPx={116} measuredWidthPxByCommandId={{ 'model.add.box': 40, 'model.add.cylinder': 40, 'model.add.group': 40 }} moreWidthPx={36} />)
    const addEventListener = vi.spyOn(document, 'addEventListener')
    const removeEventListener = vi.spyOn(document, 'removeEventListener')

    fireEvent.click(screen.getByRole('button', { name: 'More commands' }))
    await screen.findByRole('menu', { name: 'More commands' })
    const pointerDownListener = addEventListener.mock.calls.find(([eventName, , options]) => eventName === 'pointerdown' && options === true)?.[1]
    const keyDownListener = addEventListener.mock.calls.find(([eventName]) => eventName === 'keydown')?.[1]
    expect(pointerDownListener).toEqual(expect.any(Function))
    expect(keyDownListener).toEqual(expect.any(Function))

    view.unmount()
    expect(removeEventListener).toHaveBeenCalledWith('pointerdown', pointerDownListener, true)
    expect(removeEventListener).toHaveBeenCalledWith('keydown', keyDownListener)
    expect(() => {
      fireEvent.pointerDown(document.body)
      fireEvent.keyDown(document, { key: 'Escape' })
    }).not.toThrow()
    addEventListener.mockRestore()
    removeEventListener.mockRestore()
  })
})
