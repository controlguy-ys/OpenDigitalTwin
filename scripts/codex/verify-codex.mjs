import { mkdir, rename, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { spawn } from 'node:child_process'

const PROFILES = Object.freeze({
  guidance: [
    ['guidance', 'node', ['scripts/codex/validate-guidance.mjs']],
  ],
  'project-v5': [
    ['guidance', 'node', ['scripts/codex/validate-guidance.mjs']],
    ['project-v5-tests', 'npm', ['run', 'test:run', '--', 'src/core/project-v5', 'src/features/project/v5']],
    ['lint', 'npm', ['run', 'lint']],
    ['web-build', 'npm', ['run', 'build']],
  ],
  gateway: [
    ['guidance', 'node', ['scripts/codex/validate-guidance.mjs']],
    ['gateway-tests', 'npm', ['run', 'test:gateway']],
    ['gateway-build', 'npm', ['run', 'build:gateway']],
    ['gateway-config', 'node', ['dist-gateway/middleware/runtime-gateway/main.js', '--check-config']],
  ],
  ui: [
    ['guidance', 'node', ['scripts/codex/validate-guidance.mjs']],
    ['ui-tests', 'npm', ['run', 'test:connectivity-ui']],
    ['browser-e2e', 'npm', ['run', 'test:e2e']],
  ],
  full: [
    ['full-verification', 'npm', ['run', 'verify']],
  ],
})

const SCOPES = Object.freeze(Object.keys(PROFILES))

export function parseVerifyArguments(argv, environment = process.env) {
  let scope = environment.npm_config_scope
  let json = environment.npm_config_json === 'true'

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === '--json') {
      json = true
    } else if (argument === '--scope') {
      scope = argv[index + 1]
      index += 1
    } else {
      throw new Error(`Unknown argument: ${argument}`)
    }
  }

  if (!scope) throw new Error('Missing required --scope <scope>.')
  if (!Object.hasOwn(PROFILES, scope)) {
    throw new Error(`Unknown verification scope: ${scope}. Expected one of: ${SCOPES.join(', ')}.`)
  }
  return Object.freeze({ scope, json })
}

export function createProcessLauncher({
  spawnChild = spawn,
  platform = process.platform,
  commandShell = process.env.ComSpec ?? process.env.COMSPEC ?? 'cmd.exe',
} = {}) {
  return (command, args) => {
    const options = { shell: false, stdio: ['ignore', 'pipe', 'pipe'] }
    return platform === 'win32' && command === 'npm'
      ? spawnChild(commandShell, ['/d', '/s', '/c', 'npm.cmd', ...args], options)
      : spawnChild(command, args, options)
  }
}

const launchProcess = createProcessLauncher()

function runCommand(command, args) {
  const startedAt = performance.now()
  let child
  try {
    child = launchProcess(command, args)
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    return Promise.resolve({ exitCode: 1, durationMs: Math.round(performance.now() - startedAt) })
  }
  return new Promise((resolveCommand) => {
    child.stdout.on('data', (chunk) => process.stderr.write(chunk))
    child.stderr.on('data', (chunk) => process.stderr.write(chunk))
    child.once('error', (error) => {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
      resolveCommand({ exitCode: 1, durationMs: Math.round(performance.now() - startedAt) })
    })
    child.once('close', (exitCode) => {
      resolveCommand({ exitCode: exitCode ?? 1, durationMs: Math.round(performance.now() - startedAt) })
    })
  })
}

async function writeLatestReport(report, rootDirectory = process.cwd()) {
  const directory = resolve(rootDirectory, 'artifacts/codex')
  const destination = resolve(directory, 'latest-verification.json')
  const temporary = resolve(directory, `.latest-verification-${process.pid}.tmp`)
  await mkdir(directory, { recursive: true })
  await writeFile(temporary, `${JSON.stringify(report)}\n`, 'utf8')
  await rename(temporary, destination)
}

export async function runVerification(options, dependencies = {}) {
  if (!Object.hasOwn(PROFILES, options.scope)) {
    throw new Error(`Unknown verification scope: ${options.scope}. Expected one of: ${SCOPES.join(', ')}.`)
  }

  const run = dependencies.run ?? runCommand
  const writeLatest = dependencies.writeLatest ?? writeLatestReport
  const checks = []
  for (const [id, command, args] of PROFILES[options.scope]) {
    const result = await run(command, args)
    const check = Object.freeze({
      id,
      status: result.exitCode === 0 ? 'passed' : 'failed',
      command: Object.freeze([command, ...args]),
      exitCode: result.exitCode,
      durationMs: result.durationMs,
    })
    checks.push(check)
    if (check.status === 'failed') break
  }

  const report = Object.freeze({
    status: checks.every((check) => check.status === 'passed') ? 'passed' : 'failed',
    scope: options.scope,
    observedAt: new Date().toISOString(),
    checks: Object.freeze(checks),
    warnings: Object.freeze([]),
    artifacts: Object.freeze(['artifacts/codex/latest-verification.json']),
  })
  await writeLatest(report)
  return report
}

async function main() {
  try {
    const options = parseVerifyArguments(process.argv.slice(2))
    const report = await runVerification(options)
    if (options.json) {
      process.stdout.write(`${JSON.stringify(report)}\n`)
    } else {
      process.stdout.write(`${report.status}: ${report.scope}\n`)
    }
    if (report.status === 'failed') process.exitCode = 1
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  await main()
}
