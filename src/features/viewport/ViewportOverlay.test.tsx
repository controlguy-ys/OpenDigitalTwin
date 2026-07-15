import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { createViewportPreferenceStore } from './viewport-preference-store'
import { ViewportOverlay, type ViewportOverlayCameraCommands } from './ViewportOverlay'

function cameraActions(): ViewportOverlayCameraCommands {
  return { home: vi.fn(), fitAll: vi.fn(), focusSelection: vi.fn(), setStandardView: vi.fn() }
}

describe('ViewportOverlay', () => {
  it('exposes camera actions and disables Focus Selection without an eligible selection', async () => {
    const user = userEvent.setup()
    const actions = cameraActions()
    render(<ViewportOverlay actions={actions} canFocusSelection={false} store={createViewportPreferenceStore(null)} />)

    expect(screen.getByRole('button', { name: 'Focus Selection' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'Home View' }))
    await user.click(screen.getByRole('button', { name: 'Fit All' }))
    expect(actions.home).toHaveBeenCalledOnce()
    expect(actions.fitAll).toHaveBeenCalledOnce()
  })

  it('toggles Grid, World, Base, and TCP as browser-local display state', async () => {
    const user = userEvent.setup()
    const store = createViewportPreferenceStore(null)
    render(<ViewportOverlay actions={cameraActions()} canFocusSelection store={store} />)

    for (const name of ['Grid', 'World Frame', 'Robot Base Frame', 'Actual TCP Frame']) {
      await user.click(screen.getByRole('button', { name }))
    }
    expect(store.getState().layers).toEqual({
      grid: false, worldFrame: false, baseFrame: false, tcpFrame: false,
    })
  })
})
