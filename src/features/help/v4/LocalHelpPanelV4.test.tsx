import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { StrictMode } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { createLocalHelpControllerV4 } from './local-help-controller.js'
import { LocalHelpPanelV4 } from './LocalHelpPanelV4.js'
import type { LocalHelpControllerV4 } from './local-help-controller.js'

describe('LocalHelpPanelV4', () => {
  it('renders each declared local topic and restores focus to its invoking Help item after close', async () => {
    const controller = createLocalHelpControllerV4({ availableTopics: ['controls', 'stepImport', 'opcUaMapping', 'about'] })
    const topics = [
      ['controls', 'Keyboard and Mouse Controls'], ['stepImport', 'STEP Import Guide'], ['opcUaMapping', 'OPC UA Mapping Guide'], ['about', 'About'],
    ] as const
    render(<>{topics.map(([topic, title]) => <button key={topic} onClick={(event) => { event.currentTarget.focus(); controller.open(topic) }}>{title}</button>)}<LocalHelpPanelV4 controller={controller} /></>)
    for (const [topic, title] of topics) {
      fireEvent.click(screen.getByRole('button', { name: title }))
      expect(await screen.findByRole('dialog', { name: title })).toBeInTheDocument()
      if (topic === 'controls') {
        fireEvent.keyDown(screen.getByRole('dialog', { name: title }), { key: 'Escape' })
      } else {
        fireEvent.click(screen.getByRole('button', { name: `Close ${title}` }))
      }
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
      expect(screen.getByRole('button', { name: title })).toHaveFocus()
    }
  })

  it('does not manufacture an unavailable OPC UA Mapping panel and unsubscribes cleanly through StrictMode', () => {
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
    expect(() => controller.open('opcUaMapping')).toThrow('Local Help topic is unavailable')
    expect(screen.queryByRole('dialog', { name: 'OPC UA Mapping Guide' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'OPC UA Mapping Guide' })).toBeNull()
    expect(subscribe).toHaveBeenCalled()
    view.unmount()
    controller.open('about')
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})
