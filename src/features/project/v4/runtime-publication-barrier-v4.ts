import type { StoreApi } from 'zustand/vanilla'
import type {
  RobotDefinitionGeometryRepositoryV4,
} from '../../robot/v4/robot-definition-geometry-repository.js'

export interface RuntimePublicationTransactionV4 {
  commit(): void
  rollback(): void
}

export interface RuntimePublicationBarrierV4 {
  gateStore<State>(store: StoreApi<State>): StoreApi<State>
  gateGeometryRepository(
    repository: RobotDefinitionGeometryRepositoryV4,
  ): RobotDefinitionGeometryRepositoryV4
  begin(): RuntimePublicationTransactionV4
}

interface PublicationGateV4 {
  prepareCommit(): void
  flushCommit(): void
  discard(): void
}

function reportListenerErrorV4(
  error: unknown,
  onListenerError: ((error: unknown) => void) | undefined,
): void {
  if (onListenerError === undefined) return
  try {
    onListenerError(error)
  } catch {
    // Listener error reporting cannot interrupt an observable publication.
  }
}

function notifyListenersV4(
  listeners: ReadonlySet<() => void>,
  onListenerError: ((error: unknown) => void) | undefined,
): void {
  for (const listener of listeners) {
    try {
      listener()
    } catch (error) {
      reportListenerErrorV4(error, onListenerError)
    }
  }
}

export function createRuntimePublicationBarrierV4(options: {
  readonly onListenerError?: (error: unknown) => void
} = {}): RuntimePublicationBarrierV4 {
  const gates: PublicationGateV4[] = []
  let activeToken: object | null = null

  const isHolding = (): boolean => activeToken !== null

  const barrier: RuntimePublicationBarrierV4 = {
    gateStore<State>(raw: StoreApi<State>): StoreApi<State> {
      let publicState = raw.getState()
      let dirty = false
      const listeners = new Set<() => void>()

      raw.subscribe(() => {
        if (isHolding()) {
          dirty = true
          return
        }
        publicState = raw.getState()
        notifyListenersV4(listeners, options.onListenerError)
      })

      gates.push({
        prepareCommit() {
          if (dirty) publicState = raw.getState()
        },
        flushCommit() {
          if (!dirty) return
          dirty = false
          notifyListenersV4(listeners, options.onListenerError)
        },
        discard() {
          dirty = false
        },
      })

      return Object.freeze({
        setState: raw.setState,
        getState: () => publicState,
        getInitialState: raw.getInitialState,
        subscribe(listener: (state: State, previousState: State) => void) {
          let previousState = publicState
          const notify = (): void => {
            const nextState = publicState
            const before = previousState
            previousState = nextState
            listener(nextState, before)
          }
          listeners.add(notify)
          return () => listeners.delete(notify)
        },
      }) satisfies StoreApi<State>
    },

    gateGeometryRepository(raw) {
      let publicSnapshot = 0
      let dirty = false
      const listeners = new Set<() => void>()

      raw.subscribe(() => {
        if (isHolding()) {
          dirty = true
          return
        }
        publicSnapshot += 1
        notifyListenersV4(listeners, options.onListenerError)
      })

      gates.push({
        prepareCommit() {
          if (dirty) publicSnapshot += 1
        },
        flushCommit() {
          if (!dirty) return
          dirty = false
          notifyListenersV4(listeners, options.onListenerError)
        },
        discard() {
          dirty = false
        },
      })

      return Object.freeze({
        stage: raw.stage.bind(raw),
        stageUnresolved: raw.stageUnresolved.bind(raw),
        commitBatch: raw.commitBatch.bind(raw),
        rollback: raw.rollback.bind(raw),
        readCurrent: raw.readCurrent.bind(raw),
        acquire: raw.acquire.bind(raw),
        revoke: raw.revoke.bind(raw),
        subscribe(listener: () => void) {
          listeners.add(listener)
          return () => listeners.delete(listener)
        },
        getSnapshot: () => publicSnapshot,
      })
    },

    begin() {
      if (activeToken !== null) {
        throw new Error('A Runtime V4 publication transaction is already active.')
      }
      const token = Object.freeze({})
      activeToken = token
      let settled = false

      const finish = (commit: boolean): void => {
        if (settled) return
        if (activeToken !== token) {
          throw new Error('Runtime V4 publication transaction is not active.')
        }
        settled = true
        if (commit) {
          for (const gate of gates) gate.prepareCommit()
          activeToken = null
          for (const gate of gates) gate.flushCommit()
        } else {
          for (const gate of gates) gate.discard()
          activeToken = null
        }
      }

      return Object.freeze({
        commit: () => finish(true),
        rollback: () => finish(false),
      })
    },
  }

  return Object.freeze(barrier)
}
