import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'

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
  run = runCommand,
  fetch: fetchFn = globalThis.fetch,
  probeOpcUaServer,
  sleep = delay,
  port = 18080,
  opcUaPort = 4840,
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
  const environment = {
    WEB_PORT: String(port),
    ROBOTSIM_OPCUA_ADVERTISE_HOST: '127.0.0.1',
    ROBOTSIM_OPCUA_PORT: String(opcUaPort),
  }

  try {
    await run([...compose, 'build'], { env: environment })
    await run(['docker', 'run', '--rm', 'robotsim-web:local', 'nginx', '-t'])
    await run([
      ...compose,
      'up',
      '-d',
      '--wait',
      '--wait-timeout',
      '90',
    ], { env: environment })
    await waitForHealthy(
      `http://127.0.0.1:${port}/healthz`,
      fetchFn,
      sleep,
      maxAttempts,
    )
    const homeResponse = await fetchFn(`http://127.0.0.1:${port}/`)
    if (!homeResponse.ok) throw new Error('RobotSim root page did not return success.')

    await waitForHealthy(
      `http://127.0.0.1:${port}/runtime/healthz`,
      fetchFn,
      sleep,
      maxAttempts,
    )
    const preApplyReadiness = await fetchFn(
      `http://127.0.0.1:${port}/runtime/readyz`,
    )
    const preApplyReadinessBody = await preApplyReadiness.json()
    if (
      preApplyReadiness.status !== 503
      || preApplyReadinessBody?.code !== 'NO_ACTIVE_REVISION'
    ) {
      throw new Error(
        'Runtime Gateway readiness must report NO_ACTIVE_REVISION before Project activation.',
      )
    }

    if (probeOpcUaServer !== undefined) {
      await probeOpcUaServer({
        endpointUrl: `opc.tcp://127.0.0.1:${opcUaPort}`,
        gatewayBaseUrl: `http://127.0.0.1:${port}/runtime`,
        webBaseUrl: `http://127.0.0.1:${port}`,
      })
    }
  } catch (error) {
    await run([...compose, 'ps'], { env: environment }).catch(() => undefined)
    await run([...compose, 'logs', '--no-color', '--tail', '200'], {
      env: environment,
    }).catch(() => undefined)
    throw error
  } finally {
    await run([...compose, 'down', '--volumes', '--remove-orphans'], {
      env: environment,
    })
  }
}

const invokedPath = process.argv[1] === undefined ? '' : resolve(process.argv[1])
if (invokedPath === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.SMOKE_WEB_PORT ?? 18080)
  const opcUaPort = Number(process.env.SMOKE_OPCUA_PORT ?? 4840)
  try {
    if (!Number.isSafeInteger(opcUaPort) || opcUaPort < 1 || opcUaPort > 65_535) {
      throw new Error('SMOKE_OPCUA_PORT must be an integer from 1 through 65535.')
    }
    const probeOpcUaServer = process.argv.includes('--opcua')
      ? (await import('./runtime-gateway-smoke-client.mjs')).probeDualRobotOpcUaServer
      : undefined
    await smokeDeployment({
      opcUaPort,
      port,
      probeOpcUaServer,
    })
    console.log(`[deploy] smoke test passed on port ${port}`)
  } catch (error) {
    console.error('[deploy]', error instanceof Error ? error.message : error)
    process.exitCode = 1
  }
}
