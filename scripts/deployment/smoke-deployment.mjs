import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { WebSocket } from 'ws'

const repositoryRoot = resolve(process.env.ROBOTSIM_ROOT ?? process.cwd())

export function createSmokeProjectName(now = Date.now(), pid = process.pid) {
  return `robotsim-smoke-${pid}-${now}`.toLowerCase()
}

function runCommand(command, options = {}) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(command[0], command.slice(1), {
      cwd: repositoryRoot,
      env: { ...process.env, ...options.env },
      shell: false,
      stdio: 'inherit',
    })
    child.once('error', rejectRun)
    child.once('exit', (code) => {
      if (code === 0) resolveRun()
      else rejectRun(new Error(`${command.join(' ')} exited with code ${code}.`))
    })
  })
}

const delay = (milliseconds) =>
  new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds))

function probeWebSocketConnection(url) {
  return new Promise((resolveProbe, rejectProbe) => {
    const socket = new WebSocket(url)
    const timeout = setTimeout(() => {
      socket.terminate()
      rejectProbe(new Error(`WebSocket probe timed out for ${url}.`))
    }, 5000)
    socket.once('open', () => {
      clearTimeout(timeout)
      socket.close()
      resolveProbe()
    })
    socket.once('error', (error) => {
      clearTimeout(timeout)
      rejectProbe(error)
    })
  })
}

async function waitForHealthy(url, fetchFn, sleep, maxAttempts) {
  let lastError = new Error(`Health probe failed for ${url}.`)
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      const response = await fetchFn(url)
      if (response.ok) return
      lastError = new Error(`Health probe ${url} returned a non-success status.`)
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error))
    }
    if (attempt + 1 < maxAttempts) await sleep(1000)
  }
  throw lastError
}

export async function smokeDeployment({
  includeOpcUa = false,
  run = runCommand,
  fetch: fetchFn = globalThis.fetch,
  probeWebSocket = probeWebSocketConnection,
  sleep = delay,
  port = 18080,
  projectName = createSmokeProjectName(),
  maxAttempts = 90,
} = {}) {
  const compose = [
    'docker',
    'compose',
    '--project-name',
    projectName,
    '--project-directory',
    repositoryRoot,
  ]
  const profiled = includeOpcUa ? [...compose, '--profile', 'opcua'] : compose
  const environment = { WEB_PORT: String(port) }

  try {
    await run([...profiled, 'build', ...(includeOpcUa ? [] : ['web'])], { env: environment })
    await run(['docker', 'run', '--rm', 'robotsim-web:local', 'nginx', '-t'])
    await run([
      ...profiled,
      'up',
      '-d',
      '--wait',
      '--wait-timeout',
      '90',
      ...(includeOpcUa ? [] : ['web']),
    ], { env: environment })
    await waitForHealthy(
      `http://127.0.0.1:${port}/healthz`,
      fetchFn,
      sleep,
      maxAttempts,
    )
    const homeResponse = await fetchFn(`http://127.0.0.1:${port}/`)
    if (!homeResponse.ok) throw new Error('RobotSim root page did not return success.')
    if (includeOpcUa) {
      await run([
        ...profiled,
        'exec',
        '-T',
        'opcua-connector',
        'node',
        '-e',
        "fetch('http://127.0.0.1:8081/healthz').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))",
      ], { env: environment })
      await probeWebSocket(`ws://127.0.0.1:${port}/opcua`)
    }
  } finally {
    await run([...profiled, 'down', '--volumes', '--remove-orphans'], {
      env: environment,
    })
  }
}

const invokedPath = process.argv[1] === undefined ? '' : resolve(process.argv[1])
if (invokedPath === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.SMOKE_WEB_PORT ?? 18080)
  try {
    await smokeDeployment({
      includeOpcUa: process.argv.includes('--opcua'),
      port,
    })
    console.log(`[deploy] smoke test passed on port ${port}`)
  } catch (error) {
    console.error('[deploy]', error instanceof Error ? error.message : error)
    process.exitCode = 1
  }
}
