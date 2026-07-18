import { act, fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import type { AppCommandV4 } from './app-command.js'
import { createAppCommandRegistryV4 } from './app-command-registry.js'
import {
  createAppCommandBindingsV4,
  createAppCommandRuntimeV4,
  type AppCommandBindingsV4,
} from './app-command-runtime.js'
import { useAppCommandV4 } from './use-app-command.js'

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve
    reject = nextReject
  })
  return { promise, resolve, reject }
}

function command(
  id: string,
  overrides: Partial<AppCommandV4> = {},
): AppCommandV4 {
  return {
    id,
    label: id,
    section: 'project',
    kind: 'action',
    visible: true,
    enabled: true,
    execute: vi.fn(),
    ...overrides,
  }
}

function Probe({
  bindings,
  commandId,
  onInvoke,
  onBound,
}: {
  readonly bindings: AppCommandBindingsV4
  readonly commandId: string
  readonly onInvoke?: (invocation: Promise<unknown>) => void
  readonly onBound?: (invoke: () => Promise<unknown>) => void
}) {
  const bound = useAppCommandV4(bindings, commandId)
  onBound?.(bound.invoke)

  return (
    <button
      data-error={bound.error ?? ''}
      data-pending={String(bound.pending)}
      onClick={() => onInvoke?.(bound.invoke())}
      type="button"
    >
      {bound.command?.label ?? 'Unknown command'}
    </button>
  )
}

describe('useAppCommandV4', () => {
  it('reflects pending synchronously, ignores a duplicate invocation, and clears after completion', async () => {
    const execution = deferred<void>()
    const execute = vi.fn(() => execution.promise)
    const runtime = createAppCommandRuntimeV4(createAppCommandRegistryV4([
      command('project.save', { label: 'Save', execute }),
    ]))
    const bindings = createAppCommandBindingsV4(runtime)
    const invocations: Promise<unknown>[] = []
    render(<Probe bindings={bindings} commandId="project.save" onInvoke={(value) => invocations.push(value)} />)

    const button = screen.getByRole('button', { name: 'Save' })
    expect(button).toHaveAttribute('data-pending', 'false')
    expect(button).toHaveAttribute('data-error', '')

    fireEvent.click(button)
    fireEvent.click(button)
    expect(button).toHaveAttribute('data-pending', 'true')
    expect(execute).toHaveBeenCalledOnce()
    await expect(invocations[1]).resolves.toBe('ignored')

    await act(async () => {
      execution.resolve()
      await invocations[0]
    })
    expect(button).toHaveAttribute('data-pending', 'false')
  })

  it('shows a command error and clears it on a successful retry without remounting', async () => {
    let attempts = 0
    const runtime = createAppCommandRuntimeV4(createAppCommandRegistryV4([
      command('project.save', {
        execute: () => {
          attempts += 1
          if (attempts === 1) throw new Error('Save failed.')
        },
      }),
    ]))
    const bindings = createAppCommandBindingsV4(runtime)
    const invocations: Promise<unknown>[] = []
    render(<Probe bindings={bindings} commandId="project.save" onInvoke={(value) => invocations.push(value)} />)
    const button = screen.getByRole('button', { name: 'project.save' })

    fireEvent.click(button)
    await act(async () => { await invocations[0] })
    expect(button).toHaveAttribute('data-error', 'Save failed.')

    fireEvent.click(button)
    expect(button).toHaveAttribute('data-error', '')
    await act(async () => { await invocations[1] })
    expect(button).toHaveAttribute('data-error', '')
  })

  it('updates a mounted presenter from registry replacement without replacing bindings', async () => {
    const firstExecute = vi.fn()
    const runtime = createAppCommandRuntimeV4(createAppCommandRegistryV4([
      command('project.save', { label: 'Original save', execute: firstExecute }),
    ]))
    const bindings = createAppCommandBindingsV4(runtime)
    const invocations: Promise<unknown>[] = []
    render(<Probe bindings={bindings} commandId="project.save" onInvoke={(value) => invocations.push(value)} />)

    const replacementExecute = vi.fn()
    await act(async () => {
      runtime.replaceRegistry(createAppCommandRegistryV4([
        command('project.save', { label: 'Replacement save', execute: replacementExecute }),
      ]))
    })

    const button = screen.getByRole('button', { name: 'Replacement save' })
    fireEvent.click(button)
    await act(async () => { await invocations[0] })
    expect(firstExecute).not.toHaveBeenCalled()
    expect(replacementExecute).toHaveBeenCalledOnce()
  })

  it('returns an inert unknown command binding', async () => {
    const runtime = createAppCommandRuntimeV4(createAppCommandRegistryV4([]))
    const bindings = createAppCommandBindingsV4(runtime)
    const invocations: Promise<unknown>[] = []
    render(<Probe bindings={bindings} commandId="project.unknown" onInvoke={(value) => invocations.push(value)} />)
    const button = screen.getByRole('button', { name: 'Unknown command' })

    expect(button).toHaveAttribute('data-pending', 'false')
    expect(button).toHaveAttribute('data-error', '')
    fireEvent.click(button)
    await expect(invocations[0]).resolves.toBe('ignored')
  })

  it('switches fields and the stable callback to a changed command ID', async () => {
    const saveExecution = deferred<void>()
    const saveExecute = vi.fn(() => saveExecution.promise)
    let exportAttempt = 0
    const exportExecute = vi.fn(() => {
      exportAttempt += 1
      if (exportAttempt === 1) throw new Error('Export failed.')
    })
    const runtime = createAppCommandRuntimeV4(createAppCommandRegistryV4([
      command('project.save', { label: 'Save', execute: saveExecute }),
      command('project.export', { label: 'Export', execute: exportExecute }),
    ]))
    const bindings = createAppCommandBindingsV4(runtime)
    const invocations: Promise<unknown>[] = []
    const callbacks: Array<() => Promise<unknown>> = []
    const saveInvocation = runtime.invoke('project.save')
    await runtime.invoke('project.export')
    const view = render(
      <Probe
        bindings={bindings}
        commandId="project.save"
        onBound={(value) => callbacks.push(value)}
        onInvoke={(value) => invocations.push(value)}
      />,
    )
    const initialCallback = callbacks.at(-1)
    expect(screen.getByRole('button', { name: 'Save' })).toHaveAttribute('data-pending', 'true')
    expect(screen.getByRole('button', { name: 'Save' })).toHaveAttribute('data-error', '')

    view.rerender(
      <Probe
        bindings={bindings}
        commandId="project.export"
        onBound={(value) => callbacks.push(value)}
        onInvoke={(value) => invocations.push(value)}
      />,
    )
    expect(screen.getByRole('button', { name: 'Export' })).toHaveAttribute('data-pending', 'false')
    expect(screen.getByRole('button', { name: 'Export' })).toHaveAttribute('data-error', 'Export failed.')
    expect(callbacks.at(-1)).not.toBe(initialCallback)
    fireEvent.click(screen.getByRole('button', { name: 'Export' }))
    await act(async () => { await invocations[0] })
    expect(saveExecute).toHaveBeenCalledOnce()
    expect(exportExecute).toHaveBeenCalledTimes(2)
    await act(async () => {
      saveExecution.resolve()
      await saveInvocation
    })
  })
})
