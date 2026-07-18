import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { createAppCommandBindingsV4, createAppCommandRuntimeV4 } from '../../commands/v4/app-command-runtime.js'
import { createAppCommandRegistryV4 } from '../../commands/v4/app-command-registry.js'
import { ViewOrientationControlV4 } from './ViewOrientationControl.js'

const VIEWS = ['isometric', 'top', 'front', 'right', 'back', 'left', 'bottom'] as const
type View = (typeof VIEWS)[number]
type CommandSpy = ReturnType<typeof vi.fn<() => void | Promise<void>>>

function deferred() {
  let resolve!: () => void
  let reject!: (error: Error) => void
  const promise = new Promise<void>((nextResolve, nextReject) => {
    resolve = nextResolve
    reject = nextReject
  })
  return { promise, resolve, reject }
}

function bindings(options: {
  readonly hidden?: View
  readonly disabled?: View
  readonly pending?: View
} = {}) {
  const calls = Object.fromEntries(VIEWS.map((view) => [
    view,
    vi.fn<() => void | Promise<void>>(),
  ])) as Record<View, CommandSpy>
  const gate = deferred()
  const runtime = createAppCommandRuntimeV4(createAppCommandRegistryV4(
    VIEWS.map((view) => ({
      id: `view.orientation.${view}`,
      label: view,
      section: 'view' as const,
      kind: 'action' as const,
      visible: view !== options.hidden,
      enabled: view !== options.disabled,
      execute: () => {
        calls[view]()
        return view === options.pending ? gate.promise : undefined
      },
    })),
  ))
  return { calls, gate, runtime, commandBindings: createAppCommandBindingsV4(runtime) }
}

describe('ViewOrientationControlV4', () => {
  it('routes every Standard World view to its own exact shared command ID', async () => {
    const user = userEvent.setup()
    const data = bindings()
    render(<ViewOrientationControlV4 commandBindings={data.commandBindings} />)
    const control = screen.getByLabelText('View orientation')

    expect(control).toHaveValue('')
    for (const view of VIEWS) {
      const before = Object.fromEntries(VIEWS.map((candidate) => [candidate, data.calls[candidate].mock.calls.length])) as Record<View, number>
      await user.selectOptions(control, view)
      for (const candidate of VIEWS) {
        expect(data.calls[candidate]).toHaveBeenCalledTimes(before[candidate] + (candidate === view ? 1 : 0))
      }
      expect(control).toHaveValue('')
    }
  })

  it('keeps a hidden orientation unavailable and rejects a forced stale change event', () => {
    const data = bindings({ hidden: 'top' })
    render(<ViewOrientationControlV4 commandBindings={data.commandBindings} />)
    const control = screen.getByLabelText('View orientation')

    expect(screen.getByRole('option', { name: 'Top' })).toBeDisabled()
    fireEvent.change(control, { target: { value: 'top' } })
    expect(data.calls.top).not.toHaveBeenCalled()
    expect(control).toHaveValue('')
  })

  it('ignores the blank prompt option', async () => {
    const user = userEvent.setup()
    const data = bindings()
    render(<ViewOrientationControlV4 commandBindings={data.commandBindings} />)

    await user.selectOptions(screen.getByLabelText('View orientation'), '')
    for (const view of VIEWS) expect(data.calls[view]).not.toHaveBeenCalled()
  })

  it('presents disabled and pending exact IDs as unavailable and shares the terminal error', async () => {
    const data = bindings({ disabled: 'right', pending: 'front' })
    render(<ViewOrientationControlV4 commandBindings={data.commandBindings} />)
    const control = screen.getByLabelText('View orientation')

    expect(screen.getByRole('option', { name: 'Right' })).toBeDisabled()
    fireEvent.change(control, { target: { value: 'right' } })
    expect(data.calls.right).not.toHaveBeenCalled()

    const invocation = data.runtime.invoke('view.orientation.front')
    await waitFor(() => expect(screen.getByRole('option', { name: 'Front' })).toBeDisabled())
    fireEvent.change(control, { target: { value: 'front' } })
    expect(data.calls.front).toHaveBeenCalledOnce()

    act(() => data.gate.reject(new Error('front rejected')))
    await expect(invocation).resolves.toBe('failed')
    expect(screen.getByRole('alert')).toHaveTextContent('front rejected')
  })
})
