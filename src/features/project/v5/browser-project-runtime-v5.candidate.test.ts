import { describe, expect, it } from 'vitest'
import {
  cloneWorkcellProjectV5,
  makeMinimalWorkcellProjectV5,
} from '../../../core/project-v5/test-support.js'
import type { WorkcellProjectV5 } from '../../../core/project-v5/index.js'
import {
  createBrowserProjectRuntimeV5,
  type BrowserProjectRuntimeV5Options,
} from './browser-project-runtime-v5.js'
import type { BrowserWebSocketV5 } from '../../runtime-gateway/v5/runtime-gateway-state-stream.js'

const CONFIG_A = 'a'.repeat(64)
const CONFIG_B = 'b'.repeat(64)

function scheduler() {
  let next = 0
  return {
    now: () => 0,
    request: () => ++next,
    cancel: () => undefined,
  }
}

class FakeSocket implements BrowserWebSocketV5 {
  readyState = 0
  private readonly listeners = new Map<string, Set<(event: unknown) => void>>()

  close(): void { this.readyState = 3 }
  addEventListener(type: 'open' | 'message' | 'close' | 'error', listener: (event: unknown) => void): void {
    const listeners = this.listeners.get(type) ?? new Set()
    listeners.add(listener)
    this.listeners.set(type, listeners)
  }
  removeEventListener(type: 'open' | 'message' | 'close' | 'error', listener: (event: unknown) => void): void {
    this.listeners.get(type)?.delete(listener)
  }
}

function project(revisionId: string): WorkcellProjectV5 {
  const next = cloneWorkcellProjectV5(makeMinimalWorkcellProjectV5())
  ;(next as { revisionId: string }).revisionId = revisionId
  return next
}

function options(overrides: Partial<BrowserProjectRuntimeV5Options> = {}): BrowserProjectRuntimeV5Options {
  return {
    initialProject: makeMinimalWorkcellProjectV5(),
    initialConfigRevision: CONFIG_A,
    gatewayId: 'gateway-1',
    scheduler: scheduler(),
    createRunId: () => 'run-1',
    createCommandId: () => 'command-1',
    stream: {
      url: 'ws://runtime.test/runtime/ws',
      createWebSocket: () => { throw new Error('Socket was not expected in this test.') },
      nowMs: () => 100,
      reconnectDelayMs: 50,
    },
    command: { fetch: async () => new Response(), nowMs: () => 100 },
    onDiagnostic: () => undefined,
    ...overrides,
  }
}

describe('BrowserProjectRuntimeV5 candidate lifecycle', () => {
  it('rejects commit before the candidate has been applied', async () => {
    const runtime = createBrowserProjectRuntimeV5(options())
    const prepared = await runtime.prepare(project('revision-not-applied'), CONFIG_B)

    expect(() => runtime.commit(prepared)).toThrow('BROWSER_RUNTIME_CANDIDATE_NOT_APPLIED')

    await runtime.rollback(prepared)
    await runtime.dispose()
  })

  it('rejects duplicate apply and commit while an apply is in progress', async () => {
    let releaseGate: (() => void) | null = null
    const runtime = createBrowserProjectRuntimeV5(options({
      testHooks: {
        detachedApplyGate: () => new Promise<void>((resolve) => { releaseGate = resolve }),
      },
    }))
    const prepared = await runtime.prepare(project('revision-busy'), CONFIG_B)
    const applying = runtime.apply(prepared)
    await Promise.resolve()

    await expect(runtime.apply(prepared)).rejects.toThrow('BROWSER_RUNTIME_CANDIDATE_BUSY')
    expect(() => runtime.commit(prepared)).toThrow('BROWSER_RUNTIME_CANDIDATE_BUSY')

    const rollback = runtime.rollback(prepared)
    releaseGate!()
    await expect(applying).rejects.toMatchObject({ name: 'AbortError' })
    await rollback
    await runtime.dispose()
  })

  it('marks a failed apply unavailable until rollback consumes the candidate', async () => {
    const runtime = createBrowserProjectRuntimeV5(options({
      testHooks: { failApplyAfter: 'signals' },
    }))
    const prepared = await runtime.prepare(project('revision-failed'), CONFIG_B)

    await expect(runtime.apply(prepared)).rejects.toThrow('TEST_APPLY_FAILURE')
    await expect(runtime.apply(prepared)).rejects.toThrow('BROWSER_RUNTIME_CANDIDATE_APPLY_FAILED')
    expect(() => runtime.commit(prepared)).toThrow('BROWSER_RUNTIME_CANDIDATE_APPLY_FAILED')

    await runtime.rollback(prepared)
    await expect(runtime.apply(prepared)).rejects.toThrow('BROWSER_RUNTIME_CANDIDATE_CONSUMED')
    await expect(runtime.rollback(prepared)).rejects.toThrow('BROWSER_RUNTIME_CANDIDATE_CONSUMED')
    await runtime.dispose()
  })

  it('disposes an applied candidate that becomes stale when another candidate commits', async () => {
    const runtime = createBrowserProjectRuntimeV5(options())
    const older = await runtime.prepare(project('revision-older'), CONFIG_B)
    const newer = await runtime.prepare(project('revision-newer'), 'c'.repeat(64))

    await Promise.all([runtime.apply(older), runtime.apply(newer)])
    runtime.commit(newer)

    expect(() => runtime.commit(older)).toThrow('BROWSER_RUNTIME_CANDIDATE_STALE')
    await expect(runtime.apply(older)).rejects.toThrow('BROWSER_RUNTIME_CANDIDATE_CONSUMED')
    await expect(runtime.rollback(older)).rejects.toThrow('BROWSER_RUNTIME_CANDIDATE_CONSUMED')
    expect(() => runtime.commit(older)).toThrow('BROWSER_RUNTIME_CANDIDATE_CONSUMED')
    await runtime.dispose()
  })

  it('synchronously stops transport and joins applying and prepared candidates during owner disposal', async () => {
    const sockets: FakeSocket[] = []
    let releaseGate: (() => void) | null = null
    let gateAborted = false
    const runtime = createBrowserProjectRuntimeV5(options({
      stream: {
        url: 'ws://runtime.test/runtime/ws',
        createWebSocket: () => {
          const socket = new FakeSocket()
          sockets.push(socket)
          return socket
        },
        nowMs: () => 100,
        reconnectDelayMs: 50,
      },
      testHooks: {
        detachedApplyGate: (_step, signal) => new Promise<void>((_resolve, reject) => {
          signal.addEventListener('abort', () => {
            gateAborted = true
            releaseGate = () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))
          }, { once: true })
        }),
      },
    }))
    runtime.startGatewayStream()
    const applyingCandidate = await runtime.prepare(project('revision-dispose-applying'), CONFIG_B)
    const preparedCandidate = await runtime.prepare(project('revision-dispose-prepared'), 'c'.repeat(64))
    const applying = runtime.apply(applyingCandidate)
    await Promise.resolve()

    const firstDispose = runtime.dispose()
    const secondDispose = runtime.dispose()
    expect(secondDispose).toBe(firstDispose)
    expect(sockets[0]!.readyState).toBe(3)
    expect(gateAborted).toBe(true)
    let disposeSettled = false
    void firstDispose.then(() => { disposeSettled = true })
    await Promise.resolve()
    expect(disposeSettled).toBe(false)

    releaseGate!()
    await expect(applying).rejects.toMatchObject({ name: 'AbortError' })
    await firstDispose

    await expect(runtime.prepare(project('revision-after-dispose'), CONFIG_A)).rejects.toThrow('BROWSER_RUNTIME_DISPOSED')
    await expect(runtime.apply(preparedCandidate)).rejects.toThrow('BROWSER_RUNTIME_DISPOSED')
    await expect(runtime.rollback(preparedCandidate)).rejects.toThrow('BROWSER_RUNTIME_DISPOSED')
    expect(() => runtime.commit(preparedCandidate)).toThrow('BROWSER_RUNTIME_DISPOSED')
    expect(() => runtime.startGatewayStream()).toThrow('BROWSER_RUNTIME_DISPOSED')
    expect(() => runtime.stopGatewayStream()).not.toThrow()
  })
})
