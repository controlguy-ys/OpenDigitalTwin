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

export function createProcessSpawner({
  spawnChild: spawn = spawnChild,
  platform = process.platform,
  commandShell = process.env.ComSpec ?? process.env.COMSPEC ?? 'cmd.exe',
} = {}) {
  return (command, args) => {
    const options = { shell: false, stdio: 'inherit' }
    const child = platform === 'win32' && command === 'npm'
      ? spawn(commandShell, ['/d', '/s', '/c', 'npm.cmd', ...args], options)
      : spawn(command, args, options)
    const exited = new Promise((resolveExit, rejectExit) => {
      child.once('error', rejectExit)
      child.once('exit', (code) => resolveExit(code ?? 1))
    })

    return { pid: child.pid, kill: () => child.kill(), exited }
  }
}

const defaultSpawn = createProcessSpawner()

export function createWindowsTreeKiller({ spawnChild: spawn = spawnChild } = {}) {
  return (pid) => {
    let taskkill
    try {
      taskkill = spawn('taskkill.exe', ['/PID', String(pid), '/T', '/F'], {
        shell: false,
        stdio: 'ignore',
      })
    } catch (error) {
      return Promise.reject(error)
    }

    return new Promise((resolveKill, rejectKill) => {
      taskkill.once('error', rejectKill)
      taskkill.once('exit', (code) => {
        if (code === 0 || code === 128) {
          resolveKill()
          return
        }
        rejectKill(new Error(`WINDOWS_TREE_KILL_FAILED: ${pid} (exit code ${code ?? 'unknown'})`))
      })
    })
  }
}

const defaultWindowsTreeKiller = createWindowsTreeKiller()

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
  platform = process.platform,
  killTree = defaultWindowsTreeKiller,
} = {}) {
  const children = []
  let stopPromise

  const stop = () => {
    if (stopPromise) return stopPromise
    stopPromise = (async () => {
      const cleanupFailures = []
      for (const child of [...children].reverse()) {
        try {
          if (platform === 'win32' && Number.isInteger(child.pid) && child.pid > 0) {
            await killTree(child.pid)
          } else {
            child.kill()
          }
        } catch (error) {
          cleanupFailures.push(error)
        }
      }
      const exits = await Promise.allSettled(children.map((child) => child.exited))
      for (const exit of exits) {
        if (exit.status === 'rejected') cleanupFailures.push(exit.reason)
      }
      if (cleanupFailures.length === 1) throw cleanupFailures[0]
      if (cleanupFailures.length > 1) {
        throw new AggregateError(cleanupFailures, 'DEV_STACK_STOP_FAILED')
      }
    })()
    return stopPromise
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
