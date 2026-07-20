import { describe, expect, it } from 'vitest'
import { makeMinimalWorkcellProjectV5 } from '../../../core/project-v5/test-support.js'
import {
  createBrowserProjectRuntimeV5,
  type BrowserProjectRuntimeV5Options,
} from './browser-project-runtime-v5.js'

const CONFIG_A = 'a'.repeat(64)
const CONFIG_B = 'b'.repeat(64)

function options(overrides: Partial<BrowserProjectRuntimeV5Options> = {}): BrowserProjectRuntimeV5Options {
  return {
    initialProject: makeMinimalWorkcellProjectV5(),
    initialConfigRevision: CONFIG_A,
    gatewayId: 'gateway-1',
    scheduler: {
      now: () => 0,
      request: () => 1,
      cancel: () => undefined,
    },
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

describe('BrowserProjectRuntimeV5 reentrant graph disposal', () => {
  it('finishes old executor shutdown after a replacement commits during Job start publication', async () => {
    const runtime = createBrowserProjectRuntimeV5(options())
    const oldGraph = runtime.bundle.getState().runtimeGraph
    const replacement = structuredClone(makeMinimalWorkcellProjectV5())
    ;(replacement as { revisionId: string }).revisionId = 'replacement-revision'
    const prepared = await runtime.prepare(replacement, CONFIG_B)
    await runtime.apply(prepared)

    let committed = false
    const unsubscribe = oldGraph.jobs.subscribe((state) => {
      if (committed || state.byRobotId['robot-1']?.state !== 'RUNNING') return
      committed = true
      runtime.commit(prepared)
    })

    try {
      const run = oldGraph.jobExecutor.startJob('job-1', 0)

      expect(committed).toBe(true)
      expect(oldGraph.jobs.getState().byRobotId['robot-1']).toMatchObject({ state: 'IDLE' })
      expect(() => oldGraph.jobExecutor.startJob('job-1', 1)).toThrow('JOB_EXECUTOR_DISPOSED')
      await expect(oldGraph.jobExecutor.waitForTerminal(run.runId)).resolves.toMatchObject({
        state: 'CANCELLED',
        runId: run.runId,
      })
    } finally {
      unsubscribe()
      await runtime.dispose()
    }
  })

  it('reports a deferred hostile IDLE publication without failing the original Job start', async () => {
    const diagnostics: unknown[] = []
    const runtime = createBrowserProjectRuntimeV5(options({ onDiagnostic: (error) => diagnostics.push(error) }))
    const oldGraph = runtime.bundle.getState().runtimeGraph
    const replacement = structuredClone(makeMinimalWorkcellProjectV5())
    ;(replacement as { revisionId: string }).revisionId = 'replacement-hostile-idle'
    const prepared = await runtime.prepare(replacement, CONFIG_B)
    await runtime.apply(prepared)

    let committed = false
    const unsubscribeCommit = oldGraph.jobs.subscribe((state) => {
      if (committed || state.byRobotId['robot-1']?.state !== 'RUNNING') return
      committed = true
      runtime.commit(prepared)
    })
    const unsubscribeHostile = oldGraph.jobs.subscribe((state) => {
      if (state.byRobotId['robot-1']?.state === 'IDLE') throw new Error('idle-hostile')
    })

    try {
      expect(() => oldGraph.jobExecutor.startJob('job-1', 0)).not.toThrow()
      expect(committed).toBe(true)
      expect(diagnostics).toEqual([expect.objectContaining({ message: 'idle-hostile' })])
    } finally {
      unsubscribeHostile()
      unsubscribeCommit()
      await runtime.dispose()
    }
  })
})
