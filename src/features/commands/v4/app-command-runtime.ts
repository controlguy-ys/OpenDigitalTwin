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
  const target = new Set(values)
  return new Proxy(target, {
    get(current, property) {
      if (property === 'add' || property === 'delete' || property === 'clear') {
        return () => { throw new TypeError('Command runtime snapshots are read-only.') }
      }
      const value = Reflect.get(current, property, current)
      return typeof value === 'function' ? value.bind(current) : value
    },
    set: () => false,
    defineProperty: () => false,
    deleteProperty: () => false,
  }) as unknown as ReadonlySet<T>
}

function readonlyMap<K, V>(values: ReadonlyMap<K, V>): ReadonlyMap<K, V> {
  const target = new Map(values)
  return new Proxy(target, {
    get(current, property) {
      if (property === 'set' || property === 'delete' || property === 'clear') {
        return () => { throw new TypeError('Command runtime snapshots are read-only.') }
      }
      const value = Reflect.get(current, property, current)
      return typeof value === 'function' ? value.bind(current) : value
    },
    set: () => false,
    defineProperty: () => false,
    deleteProperty: () => false,
  }) as unknown as ReadonlyMap<K, V>
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
    for (const listener of listeners) listener()
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
