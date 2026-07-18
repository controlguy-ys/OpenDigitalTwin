import type {
  AppCommandOutcomeV4,
} from './app-command.js'
import type { AppCommandRegistryV4 } from './app-command-registry.js'

export interface AppCommandRuntimeStateV4 {
  readonly pendingCommandIds: ReadonlySet<string>
  readonly errorByCommandId: ReadonlyMap<string, string>
}

export interface AppCommandRuntimeV4 {
  getState(): AppCommandRuntimeStateV4
  getRegistry(): AppCommandRegistryV4
  subscribe(listener: () => void): () => void
  replaceRegistry(registry: AppCommandRegistryV4): void
  invoke(commandId: string): Promise<AppCommandOutcomeV4>
  dispose(): void
}

export interface AppCommandBindingsV4 {
  readonly runtime: AppCommandRuntimeV4
  getRegistry(): AppCommandRegistryV4
}

function readonlySet<T>(values: ReadonlySet<T>): ReadonlySet<T> {
  const snapshotValues = new Set(values)
  let view: ReadonlySet<T>
  view = Object.freeze({
    get size() {
      return snapshotValues.size
    },
    has(value: T) {
      return snapshotValues.has(value)
    },
    entries() {
      return snapshotValues.entries()
    },
    keys() {
      return snapshotValues.keys()
    },
    values() {
      return snapshotValues.values()
    },
    forEach(
      callback: (value: T, value2: T, set: ReadonlySet<T>) => void,
      thisArg?: unknown,
    ) {
      for (const value of snapshotValues) callback.call(thisArg, value, value, view)
    },
    [Symbol.iterator]() {
      return snapshotValues[Symbol.iterator]()
    },
  })
  return view
}

function readonlyMap<K, V>(values: ReadonlyMap<K, V>): ReadonlyMap<K, V> {
  const snapshotValues = new Map(values)
  let view: ReadonlyMap<K, V>
  view = Object.freeze({
    get size() {
      return snapshotValues.size
    },
    get(key: K) {
      return snapshotValues.get(key)
    },
    has(key: K) {
      return snapshotValues.has(key)
    },
    entries() {
      return snapshotValues.entries()
    },
    keys() {
      return snapshotValues.keys()
    },
    values() {
      return snapshotValues.values()
    },
    forEach(
      callback: (value: V, key: K, map: ReadonlyMap<K, V>) => void,
      thisArg?: unknown,
    ) {
      for (const [key, value] of snapshotValues) callback.call(thisArg, value, key, view)
    },
    [Symbol.iterator]() {
      return snapshotValues[Symbol.iterator]()
    },
  })
  return view
}

function normalizeError(error: unknown): string {
  return error instanceof Error && error.message.length > 0
    ? error.message
    : 'Command execution failed.'
}

export function createAppCommandRuntimeV4(
  initialRegistry: AppCommandRegistryV4,
): AppCommandRuntimeV4 {
  let registry = initialRegistry
  let disposed = false
  const pendingCommandIds = new Set<string>()
  const errorByCommandId = new Map<string, string>()
  const listeners = new Set<() => void>()
  let state = createState()

  function createState(): AppCommandRuntimeStateV4 {
    return Object.freeze({
      pendingCommandIds: readonlySet(pendingCommandIds),
      errorByCommandId: readonlyMap(errorByCommandId),
    })
  }

  function publish(): void {
    if (disposed) return
    state = createState()
    const currentListeners = Array.from(listeners)
    for (const listener of currentListeners) listener()
  }

  function settle(commandId: string, error: string | null): void {
    if (disposed) return
    pendingCommandIds.delete(commandId)
    if (error === null) errorByCommandId.delete(commandId)
    else errorByCommandId.set(commandId, error)
    publish()
  }

  return {
    getState() {
      return state
    },
    getRegistry() {
      return registry
    },
    subscribe(listener) {
      if (disposed) return () => undefined
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    replaceRegistry(nextRegistry) {
      if (disposed) return
      registry = nextRegistry
      publish()
    },
    async invoke(commandId) {
      if (disposed) return 'ignored'
      const command = registry.get(commandId)
      if (command === null || pendingCommandIds.has(commandId) || !command.enabled) {
        return 'ignored'
      }

      pendingCommandIds.add(commandId)
      errorByCommandId.delete(commandId)
      publish()

      try {
        const execution = await command.execute()
        settle(commandId, null)
        return execution === 'cancelled' ? 'cancelled' : 'completed'
      } catch (error) {
        settle(commandId, normalizeError(error))
        return 'failed'
      }
    },
    dispose() {
      if (disposed) return
      disposed = true
      listeners.clear()
    },
  }
}

export function createAppCommandBindingsV4(
  runtime: AppCommandRuntimeV4,
): AppCommandBindingsV4 {
  return Object.freeze({
    runtime,
    getRegistry: () => runtime.getRegistry(),
  })
}
