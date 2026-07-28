import { describe, expect, it, vi } from 'vitest'
import { copyFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawn as spawnChild } from 'node:child_process'
// @ts-expect-error The production verification runner is intentionally plain ESM without a declaration file.
import { createProcessLauncher, parseVerifyArguments, runVerification } from './verify-codex.mjs'

function runNpm(cwd: string, args: string[]) {
  const child = process.platform === 'win32'
    ? spawnChild(
        process.env.ComSpec ?? process.env.COMSPEC ?? 'cmd.exe',
        ['/d', '/s', '/c', 'npm.cmd', ...args],
        { cwd, shell: false, stdio: ['ignore', 'pipe', 'pipe'] },
      )
    : spawnChild('npm', args, { cwd, shell: false, stdio: ['ignore', 'pipe', 'pipe'] })

  return new Promise<{ exitCode: number, stdout: string, stderr: string }>((resolveRun, rejectRun) => {
    let stdout = ''
    let stderr = ''
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => { stdout += chunk })
    child.stderr.on('data', (chunk: string) => { stderr += chunk })
    child.once('error', rejectRun)
    child.once('close', (exitCode: number | null) => {
      resolveRun({ exitCode: exitCode ?? 1, stdout, stderr })
    })
  })
}

describe('verify:codex', () => {
  it('runs the closed project-v5 profile in order and returns valid JSON data', async () => {
    const run = vi.fn(async (_command: string, _args: string[]) => ({
      exitCode: 0,
      durationMs: 5,
    }))
    const writeLatest = vi.fn(async () => undefined)
    const report = await runVerification(
      { scope: 'project-v5', json: true },
      { run, writeLatest },
    )
    expect(run.mock.calls.map(([command, args]) => [command, args])).toEqual([
      ['node', ['scripts/codex/validate-guidance.mjs']],
      ['npm', ['run', 'test:run', '--', 'src/core/project-v5', 'src/features/project/v5']],
      ['npm', ['run', 'lint']],
      ['npm', ['run', 'build']],
    ])
    expect(report.status).toBe('passed')
    expect(writeLatest).toHaveBeenCalledOnce()
  })

  it('uses npm config fallback when npm consumes the planned scope and json arguments', () => {
    expect(parseVerifyArguments([], {
      npm_config_scope: 'guidance',
      npm_config_json: 'true',
    })).toEqual({ scope: 'guidance', json: true })
  })

  it('uses ComSpec without shell mode for npm checks on Windows', () => {
    const spawnChild = vi.fn(() => ({}))
    const launch = createProcessLauncher({
      spawnChild,
      platform: 'win32',
      commandShell: 'C:\\Windows\\System32\\cmd.exe',
    })

    launch('npm', ['run', 'lint'])

    expect(spawnChild).toHaveBeenCalledWith(
      'C:\\Windows\\System32\\cmd.exe',
      ['/d', '/s', '/c', 'npm.cmd', 'run', 'lint'],
      { shell: false, stdio: ['ignore', 'pipe', 'pipe'] },
    )
  })

  it('stops after the first required failure and reports the failing command', async () => {
    const run = vi.fn()
      .mockResolvedValueOnce({ exitCode: 0, durationMs: 1 })
      .mockResolvedValueOnce({ exitCode: 1, durationMs: 2 })
    const writeLatest = vi.fn(async () => undefined)
    const report = await runVerification(
      { scope: 'project-v5', json: true },
      { run, writeLatest },
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

  it('emits one JSON document on stdout through the documented npm command', async () => {
    const fixture = await mkdtemp(join(tmpdir(), 'verify-codex-'))
    try {
      await mkdir(join(fixture, 'scripts/codex'), { recursive: true })
      await copyFile(
        join(process.cwd(), 'scripts/codex/verify-codex.mjs'),
        join(fixture, 'scripts/codex/verify-codex.mjs'),
      )
      await writeFile(
        join(fixture, 'package.json'),
        JSON.stringify({
          type: 'module',
          scripts: { 'verify:codex': 'node scripts/codex/verify-codex.mjs' },
        }),
        'utf8',
      )
      await writeFile(
        join(fixture, 'scripts/codex/validate-guidance.mjs'),
        "process.stdout.write('fixture guidance passed\\n')\n",
        'utf8',
      )

      const result = await runNpm(fixture, [
        'run',
        '--silent',
        'verify:codex',
        '--',
        '--scope',
        'guidance',
        '--json',
      ])
      const report = JSON.parse(result.stdout)

      expect(result.exitCode).toBe(0)
      expect(report).toMatchObject({ status: 'passed', scope: 'guidance' })
      expect(result.stderr).toContain('fixture guidance passed')
    } finally {
      await rm(fixture, { recursive: true, force: true })
    }
  })
})
