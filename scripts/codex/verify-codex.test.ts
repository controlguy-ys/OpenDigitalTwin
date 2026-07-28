import { describe, expect, it, vi } from 'vitest'
import { parseVerifyArguments, runVerification } from './verify-codex.mjs'

describe('verify:codex', () => {
  it('runs the closed project-v5 profile in order and returns valid JSON data', async () => {
    const run = vi.fn(async () => ({ exitCode: 0, durationMs: 5 }))
    const report = await runVerification(
      { scope: 'project-v5', json: true },
      { run },
    )
    expect(run.mock.calls.map(([command, args]) => [command, args])).toEqual([
      ['node', ['scripts/codex/validate-guidance.mjs']],
      ['npm', ['run', 'test:run', '--', 'src/core/project-v5', 'src/features/project/v5']],
      ['npm', ['run', 'lint']],
      ['npm', ['run', 'build']],
    ])
    expect(report.status).toBe('passed')
  })

  it('uses npm config fallback when npm consumes the planned scope and json arguments', () => {
    expect(parseVerifyArguments([], {
      npm_config_scope: 'guidance',
      npm_config_json: 'true',
    })).toEqual({ scope: 'guidance', json: true })
  })

  it('stops after the first required failure and reports the failing command', async () => {
    const run = vi.fn()
      .mockResolvedValueOnce({ exitCode: 0, durationMs: 1 })
      .mockResolvedValueOnce({ exitCode: 1, durationMs: 2 })
    const report = await runVerification(
      { scope: 'project-v5', json: true },
      { run },
    )
    expect(report.status).toBe('failed')
    expect(report.checks.at(-1)).toMatchObject({ status: 'failed', exitCode: 1 })
    expect(run).toHaveBeenCalledTimes(2)
  })

  it('atomically records the latest bounded verification report', async () => {
    const writeLatest = vi.fn(async () => undefined)
    await runVerification(
      { scope: 'guidance', json: true },
      { run: vi.fn(async () => ({ exitCode: 0, durationMs: 1 })), writeLatest },
    )
    expect(writeLatest).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'passed', scope: 'guidance' }),
    )
  })
})
