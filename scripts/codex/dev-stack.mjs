import { spawn as spawnChild } from 'node:child_process'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const GATEWAY_HEALTH_URL = 'http://127.0.0.1:8081/healthz'
const GATEWAY_URL = 'http://127.0.0.1:8081'
const PROBE_INTERVAL_MS = 250
const PROBE_TIMEOUT_MS = 30_000
const POSIX_FORCE_TIMEOUT_MS = 1_000
const POSIX_GRACEFUL_TIMEOUT_MS = 2_000
const POSIX_POLL_INTERVAL_MS = 50
const WEB_URL = 'http://127.0.0.1:5173'
const WEB_HEALTH_URL = `${WEB_URL}/`

const defaultDelay = (milliseconds) => new Promise((resolveDelay) => {
  setTimeout(resolveDelay, milliseconds)
})

export function createProcessSpawner({
  spawnChild: spawn = spawnChild,
  platform = process.platform,
  commandShell = process.env.ComSpec ?? process.env.COMSPEC ?? 'cmd.exe',
} = {}) {
  return (command, args) => {
    const options = platform === 'win32'
      ? { shell: false, stdio: 'inherit' }
      : { detached: true, shell: false, stdio: 'inherit' }
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

function isNoSuchProcess(error) {
  return error && typeof error === 'object' && error.code === 'ESRCH'
}

export function createPosixGroupKiller({
  signalProcessGroup = process.kill,
  delay = defaultDelay,
  gracefulTimeoutMs = POSIX_GRACEFUL_TIMEOUT_MS,
  forceTimeoutMs = POSIX_FORCE_TIMEOUT_MS,
  pollIntervalMs = POSIX_POLL_INTERVAL_MS,
} = {}) {
  return async (pid) => {
    if (!Number.isInteger(pid) || pid <= 0) {
      throw new Error(`INVALID_POSIX_PROCESS_GROUP_PID: ${pid}`)
    }
    const groupPid = -pid
    const sendSignal = (signal) => {
      try {
        signalProcessGroup(groupPid, signal)
        return true
      } catch (error) {
        if (isNoSuchProcess(error)) return false
        throw error
      }
    }
    const waitForGroupGone = async (timeoutMs) => {
      let elapsedMs = 0
      while (elapsedMs < timeoutMs) {
        if (!sendSignal(0)) return true
        const waitMs = Math.min(pollIntervalMs, timeoutMs - elapsedMs)
        await delay(waitMs)
        elapsedMs += waitMs
      }
      return !sendSignal(0)
    }

    if (!sendSignal('SIGTERM')) return
    if (await waitForGroupGone(gracefulTimeoutMs)) return
    if (!sendSignal('SIGKILL')) return
    if (await waitForGroupGone(forceTimeoutMs)) return
    throw new Error(`POSIX_PROCESS_GROUP_STILL_ALIVE: ${pid}`)
  }
}

const defaultPosixGroupKiller = createPosixGroupKiller()

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
  const listener = () => {
    void handler()
  }
  process.once(signal, listener)
  return () => process.removeListener(signal, listener)
}

function attachCleanupFailure(startupFailure, cleanupFailure) {
  if (startupFailure instanceof Error) {
    Object.defineProperty(startupFailure, 'cause', {
      configurable: true,
      value: cleanupFailure,
    })
    return startupFailure
  }
  return new Error(String(startupFailure), { cause: cleanupFailure })
}

function createStopRace(stopSignal, stopped) {
  if (stopSignal.aborted) {
    return { promise: Promise.resolve(stopped), dispose: () => undefined }
  }
  let listener
  const promise = new Promise((resolveStop) => {
    listener = () => resolveStop(stopped)
    stopSignal.addEventListener('abort', listener, { once: true })
  })
  return {
    promise,
    dispose: () => stopSignal.removeEventListener('abort', listener),
  }
}

async function waitForProbe(url, probe, stopSignal) {
  const deadline = Date.now() + PROBE_TIMEOUT_MS
  const timedOut = Symbol('probe timeout')
  const stopped = Symbol('stack stopped')

  while (Date.now() <= deadline) {
    const remaining = deadline - Date.now()
    let timeoutId
    const timeout = new Promise((resolveTimeout) => {
      timeoutId = setTimeout(resolveTimeout, Math.min(PROBE_INTERVAL_MS, remaining), timedOut)
    })
    const cancellation = createStopRace(stopSignal, stopped)
    const result = await Promise.race([
      Promise.resolve().then(() => probe(url)).then(Boolean, () => false),
      timeout,
      cancellation.promise,
    ]).finally(() => {
      clearTimeout(timeoutId)
      cancellation.dispose()
    })
    if (result === stopped) throw new Error('DEV_STACK_STOPPED')
    if (result === true) return
    if (Date.now() >= deadline) break
    if (result !== timedOut) {
      let cooldownId
      const cooldown = new Promise((resolveCooldown) => {
        cooldownId = setTimeout(resolveCooldown, Math.min(PROBE_INTERVAL_MS, deadline - Date.now()), timedOut)
      })
      const cooldownCancellation = createStopRace(stopSignal, stopped)
      const cooldownResult = await Promise.race([
        cooldown,
        cooldownCancellation.promise,
      ]).finally(() => {
        clearTimeout(cooldownId)
        cooldownCancellation.dispose()
      })
      if (cooldownResult === stopped) throw new Error('DEV_STACK_STOPPED')
    }
  }

  throw new Error(`SERVICE_PROBE_TIMEOUT: ${url}`)
}

export function createDevStack({
  spawn: spawnProcess = defaultSpawn,
  probe = defaultProbe,
  onSignal = defaultOnSignal,
  platform = process.platform,
  killTree = defaultWindowsTreeKiller,
  killGroup = defaultPosixGroupKiller,
} = {}) {
  const children = []
  const signalDisposers = []
  let stopPromise
  let signalsRegistered = false
  const stopController = new AbortController()

  const disposeSignalHandlers = () => {
    if (!signalsRegistered) return
    signalsRegistered = false
    for (const dispose of signalDisposers.splice(0)) dispose()
  }

  const registerSignalHandlers = () => {
    if (signalsRegistered) return
    signalsRegistered = true
    try {
      for (const signal of ['SIGINT', 'SIGTERM']) {
        const dispose = onSignal(signal, stop)
        if (typeof dispose === 'function') signalDisposers.push(dispose)
      }
    } catch (error) {
      disposeSignalHandlers()
      throw error
    }
  }

  const stop = () => {
    if (stopPromise) return stopPromise
    stopController.abort()
    stopPromise = (async () => {
      try {
        const cleanupFailures = []
        for (const child of [...children].reverse()) {
          try {
            if (platform === 'win32' && Number.isInteger(child.pid) && child.pid > 0) {
              await killTree(child.pid)
            } else if (platform !== 'win32' && Number.isInteger(child.pid) && child.pid > 0) {
              await killGroup(child.pid)
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
      } finally {
        disposeSignalHandlers()
      }
    })()
    return stopPromise
  }

  return Object.freeze({
    async start() {
      registerSignalHandlers()

      try {
        const build = spawnProcess('npm', ['run', 'build:gateway'])
        children.push(build)
        const buildExitCode = await build.exited
        children.splice(children.indexOf(build), 1)
        if (stopPromise) throw new Error('DEV_STACK_STOPPED')
        if (buildExitCode !== 0) throw new Error('GATEWAY_BUILD_FAILED')
        children.push(spawnProcess('node', ['dist-gateway/middleware/runtime-gateway/main.js']))
        children.push(spawnProcess('npm', ['run', 'dev', '--', '--host', '127.0.0.1', '--port', '5173']))
        await waitForProbe(GATEWAY_HEALTH_URL, probe, stopController.signal)
        await waitForProbe(WEB_HEALTH_URL, probe, stopController.signal)
      } catch (error) {
        try {
          await stop()
        } catch (cleanupFailure) {
          throw attachCleanupFailure(error, cleanupFailure)
        }
        throw error
      }

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
