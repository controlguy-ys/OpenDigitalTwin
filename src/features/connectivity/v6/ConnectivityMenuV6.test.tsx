import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { ConnectivityMenuV6 } from './ConnectivityMenuV6.js'

describe('ConnectivityMenuV6', () => {
  it('keeps the four V5 controller actions in the required order and does not own dialog state', async () => {
    const user = userEvent.setup()
    const openSettings = vi.fn()
    const openMonitor = vi.fn()
    const openOverview = vi.fn()
    const openDocker = vi.fn()
    render(<ConnectivityMenuV6
      onOpenBindingOverview={openOverview}
      onOpenConnectionMonitor={openMonitor}
      onOpenDockerRunGuide={openDocker}
      onOpenOpcUaSettings={openSettings}
      projectAvailable
    />)

    const menu = screen.getByRole('group', { name: 'Connectivity' })
    expect(within(menu).getAllByRole('button').map((button) => button.textContent)).toEqual([
      'OPC UA Settings', 'Connection Monitor', 'Binding Overview', 'Docker Run Guide',
    ])
    await user.click(screen.getByRole('button', { name: 'OPC UA Settings' }))
    await user.click(screen.getByRole('button', { name: 'Connection Monitor' }))
    await user.click(screen.getByRole('button', { name: 'Binding Overview' }))
    await user.click(screen.getByRole('button', { name: 'Docker Run Guide' }))
    expect(openSettings).toHaveBeenCalledOnce()
    expect(openMonitor).toHaveBeenCalledOnce()
    expect(openOverview).toHaveBeenCalledOnce()
    expect(openDocker).toHaveBeenCalledOnce()
  })

  it('keeps modeless monitoring and Docker guidance available when no Project V5 is active', () => {
    render(<ConnectivityMenuV6
      onOpenBindingOverview={() => undefined}
      onOpenConnectionMonitor={() => undefined}
      onOpenDockerRunGuide={() => undefined}
      onOpenOpcUaSettings={() => undefined}
      projectAvailable={false}
    />)

    expect(screen.getByRole('button', { name: 'OPC UA Settings' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Binding Overview' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Connection Monitor' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Docker Run Guide' })).toBeEnabled()
  })
})
