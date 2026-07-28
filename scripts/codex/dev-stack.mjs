import { spawn as spawnChild } from 'node:child_process'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const GATEWAY_HEALTH_URL = 'http://127.0.0.1:8081/healthz'
const GATEWAY_URL = 'http://127.0.0.1:8081'
const PROBE_INTERVAL_MS = 250
const PROBE_TIMEOUT_MS = 30_000
const WEB_URL = 'http://127.0.0.1:5173'
const WEB_HEALTH_URL = `${WEB_URL}/`

const delay = (milliseconds) => new Promise((resolveDelay) => {
  setTimeout(resolveDelay, milliseconds)
})

const commandForPlatform = (command) => (
  process.platform === 'win32' && command === 'npm' ? 'npm.cmd' : command
)

const defaultSpawn = (command, args) => {
  const child = spawnChild(commandForPlatform(command), args, {
    shell: false,
    stdio: 'inherit',
  })
  const exited = new Promise((resolveExit, rejectExit) => {
    child.once('error', rejectExit)
    child.once('exit', (code) => resolveExit(code ?? 1))
  })

  return { kill: () => child.kill(), exited }
}

const defaultProbe = async (url) => {
  const response = await fetch(url, { signal: AbortSignal.timeout(PROBE_INTERVAL_MS) })
  return response.ok
}

const defaultOnSignal = (signal, handler) => {
  process.once(signal, () => {
    void handler()
  })
}

async function waitForProbe(url, probe) {
  const deadline = Date.now() + PROBE_TIMEOUT_MS
  const timedOut = Symbol('probe timeout')

  while (Date.now() <= deadline) {
    const remaining = deadline - Date.now()
    const result = await Promise.race([
      Promise.resolve(probe(url)).catch(() => false),
      delay(Math.min(PROBE_INTERVAL_MS, remaining)).then(() => timedOut),
    ])
    if (result === true) return
    if (Date.now() >= deadline) break
    if (result !== timedOut) await delay(Math.min(PROBE_INTERVAL_MS, deadline - Date.now()))
  }

  throw new Error(`SERVICE_PROBE_TIMEOUT: ${url}`)
}

export function createDevStack({
  spawn: spawnProcess = defaultSpawn,
  probe = defaultProbe,
  onSignal = defaultOnSignal,
} = {}) {
  const children = []
  let stopping = false

  const stop = async () => {
    if (stopping) return
    stopping = true
    for (const child of [...children].reverse()) {
      try {
        child.kill()
      } catch {
        // A child which already exited needs no further cleanup.
      }
    }
  }

  return Object.freeze({
    async start() {
      const build = spawnProcess('npm', ['run', 'build:gateway'])
      const buildExitCode = await build.exited
      if (buildExitCode !== 0) throw new Error('GATEWAY_BUILD_FAILED')

      try {
        children.push(spawnProcess('node', ['dist-gateway/middleware/runtime-gateway/main.js']))
        children.push(spawnProcess('npm', ['run', 'dev', '--', '--host', '127.0.0.1', '--port', '5173']))
        await waitForProbe(GATEWAY_HEALTH_URL, probe)
        await waitForProbe(WEB_HEALTH_URL, probe)
      } catch (error) {
        await stop()
        throw error
      }

      onSignal('SIGINT', stop)
      onSignal('SIGTERM', stop)
      return Object.freeze({ webUrl: WEB_URL, gatewayUrl: GATEWAY_URL })
    },
    stop,
  })
}

async function main() {
  const stack = createDevStack()
  try {
    const { gatewayUrl, webUrl } = await stack.start()
    console.log(`Gateway ready: ${gatewayUrl}`)
    console.log(`Web ready: ${webUrl}`)
  } catch (error) {
    console.error(error)
    process.exitCode = 1
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  void main()
}
