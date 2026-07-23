import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { StrictMode, useMemo, useState } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { createAppCommandBindingsV4, createAppCommandRuntimeV4 } from '../../commands/v4/app-command-runtime.js'
import { createAppCommandRegistryV4 } from '../../commands/v4/app-command-registry.js'
import { AppMenuBarV4 } from '../../ui/v4/AppMenuBarV4.js'
import type { AppCommandSectionV4 } from '../../commands/v4/app-command.js'
import { CompactAppMenuV4 } from '../../ui/v4/CompactAppMenuV4.js'
import { createLocalHelpControllerV4 } from './local-help-controller.js'
import { LocalHelpPanelV4 } from './LocalHelpPanelV4.js'
import type { LocalHelpControllerV4 } from './local-help-controller.js'

function HelpMenuHarnessV4({ controller, compact = false }: { readonly controller: LocalHelpControllerV4; readonly compact?: boolean }) {
  const [openSection, setOpenSection] = useState<AppCommandSectionV4 | null>(null)
  const commandBindings = useMemo(() => createAppCommandBindingsV4(createAppCommandRuntimeV4(createAppCommandRegistryV4([
    { id: 'help.controls', label: 'Keyboard and Mouse Controls', section: 'help', kind: 'action', visible: true, enabled: true, execute: () => controller.open('controls') },
  ]))), [controller])
  const Menu = compact ? CompactAppMenuV4 : AppMenuBarV4
  return <>
    <Menu
      commandBindings={commandBindings}
      model={[{ id: 'help', label: 'Help', children: [{ kind: 'command', commandId: 'help.controls' }] }]}
      onOpenSectionChange={setOpenSection}
      onPreviewSection={() => undefined}
      openSection={openSection}
    />
    <LocalHelpPanelV4 controller={controller} />
  </>
}

describe('LocalHelpPanelV4', () => {
  it('renders each declared local topic and restores focus to its invoking Help item after close', async () => {
    const controller = createLocalHelpControllerV4({ availableTopics: ['controls', 'stepImport', 'opcUaSettings', 'connectionMonitor', 'opcUaBinding', 'dockerRunGuide', 'about'] })
    const topics = [
      ['controls', 'Keyboard and Mouse Controls'],
      ['stepImport', 'STEP Import Guide'],
      ['opcUaSettings', 'OPC UA Settings'],
      ['connectionMonitor', 'Connection Monitor'],
      ['opcUaBinding', 'OPC UA Binding'],
      ['dockerRunGuide', 'Docker Run Guide'],
      ['about', 'About'],
    ] as const
    render(<>{topics.map(([topic, title]) => <button key={topic} onClick={(event) => { event.currentTarget.focus(); controller.open(topic) }}>{title}</button>)}<LocalHelpPanelV4 controller={controller} /></>)
    for (const [topic, title] of topics) {
      fireEvent.click(screen.getByRole('button', { name: title }))
      expect(await screen.findByRole('dialog', { name: title })).toBeInTheDocument()
      if (topic === 'controls') {
        fireEvent.keyDown(document, { key: 'Escape' })
      } else {
        fireEvent.click(screen.getByRole('button', { name: `Close ${title}` }))
      }
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
      expect(screen.getByRole('button', { name: title })).toHaveFocus()
    }
  })

  it('captures the original invoker once and restores it after a Help topic switch', async () => {
    const controller = createLocalHelpControllerV4({ availableTopics: ['controls', 'about'] })
    render(<><button onClick={(event) => { event.currentTarget.focus(); controller.open('controls') }}>Open controls</button><LocalHelpPanelV4 controller={controller} /></>)

    const trigger = screen.getByRole('button', { name: 'Open controls' })
    fireEvent.click(trigger)
    await screen.findByRole('dialog', { name: 'Keyboard and Mouse Controls' })
    act(() => controller.open('about'))
    expect(await screen.findByRole('dialog', { name: 'About' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Close About' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(trigger).toHaveFocus()
  })

  it('closes on an unprevented document Escape while focus remains outside the nonmodal Help panel', async () => {
    const controller = createLocalHelpControllerV4({ availableTopics: ['controls'] })
    render(<><button onClick={(event) => { event.currentTarget.focus(); controller.open('controls') }}>Open controls</button><button>Outside</button><LocalHelpPanelV4 controller={controller} /></>)

    const trigger = screen.getByRole('button', { name: 'Open controls' })
    fireEvent.click(trigger)
    await screen.findByRole('dialog', { name: 'Keyboard and Mouse Controls' })
    const outside = screen.getByRole('button', { name: 'Outside' })
    outside.focus()
    expect(outside).toHaveFocus()
    fireEvent.keyDown(document, { key: 'Escape' })

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(trigger).toHaveFocus()
  })

  it('returns focus to the persistent Help menu trigger after a real Menu to Help command closes the menu item', async () => {
    const controller = createLocalHelpControllerV4({ availableTopics: ['controls'] })
    render(<HelpMenuHarnessV4 controller={controller} />)

    const helpTrigger = screen.getByRole('menuitem', { name: 'Help' })
    fireEvent.keyDown(helpTrigger, { key: 'ArrowDown' })
    const helpItem = await screen.findByRole('menuitem', { name: 'Keyboard and Mouse Controls' })
    expect(helpItem).toHaveFocus()
    fireEvent.click(helpItem)
    await screen.findByRole('dialog', { name: 'Keyboard and Mouse Controls' })
    fireEvent.click(screen.getByRole('button', { name: 'Close Keyboard and Mouse Controls' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(helpTrigger).toHaveFocus()
  })

  it('walks the compact Menu hierarchy back to its persistent disclosure after Help closes', async () => {
    const controller = createLocalHelpControllerV4({ availableTopics: ['controls'] })
    render(<HelpMenuHarnessV4 compact controller={controller} />)

    const disclosure = screen.getByRole('button', { name: 'Menu' })
    fireEvent.click(disclosure)
    const category = await screen.findByRole('menuitem', { name: 'Help' })
    fireEvent.click(category)
    const helpItem = await screen.findByRole('menuitem', { name: 'Keyboard and Mouse Controls' })
    fireEvent.click(helpItem)
    await screen.findByRole('dialog', { name: 'Keyboard and Mouse Controls' })
    fireEvent.click(screen.getByRole('button', { name: 'Close Keyboard and Mouse Controls' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(disclosure).toHaveFocus()
  })

  it('keeps a pre-open StrictMode session deterministic and cleans up its subscription', async () => {
    const controller = createLocalHelpControllerV4({ availableTopics: ['about'] })
    controller.open('about')
    let activeSubscriptions = 0
    const subscribe = vi.fn((listener: () => void) => {
      activeSubscriptions += 1
      const unsubscribe = controller.subscribe(listener)
      return () => {
        activeSubscriptions -= 1
        unsubscribe()
      }
    })
    const facade: LocalHelpControllerV4 = {
      getState: controller.getState,
      subscribe,
      hasTopic: controller.hasTopic,
      open: controller.open,
      close: controller.close,
      dispose: controller.dispose,
    }
    const priorFocus = document.createElement('button')
    priorFocus.textContent = 'Before panel'
    document.body.append(priorFocus)
    priorFocus.focus()
    const view = render(<StrictMode><LocalHelpPanelV4 controller={facade} /></StrictMode>)
    expect(await screen.findByRole('dialog', { name: 'About' })).toBeInTheDocument()
    expect(activeSubscriptions).toBe(1)
    fireEvent.click(screen.getByRole('button', { name: 'Close About' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(priorFocus).toHaveFocus()
    view.unmount()
    expect(activeSubscriptions).toBe(0)
    priorFocus.remove()
  })

  it('does not manufacture an unavailable OPC UA Binding panel and unsubscribes cleanly through StrictMode', () => {
    const controller = createLocalHelpControllerV4({ availableTopics: ['controls', 'stepImport', 'about'] })
    const subscribe = vi.fn((listener: () => void) => controller.subscribe(listener))
    const facade: LocalHelpControllerV4 = {
      getState: controller.getState,
      subscribe,
      hasTopic: controller.hasTopic,
      open: controller.open,
      close: controller.close,
      dispose: controller.dispose,
    }
    const view = render(<StrictMode><LocalHelpPanelV4 controller={facade} /></StrictMode>)
    expect(() => controller.open('opcUaBinding')).toThrow('Local Help topic is unavailable')
    expect(screen.queryByRole('dialog', { name: 'OPC UA Binding' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'OPC UA Binding' })).toBeNull()
    expect(subscribe).toHaveBeenCalled()
    view.unmount()
    controller.open('about')
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})
