import { useCallback, useSyncExternalStore } from 'react'

import type { AppCommandOutcomeV4, AppCommandV4 } from './app-command.js'
import type {
  AppCommandBindingsV4,
  AppCommandRuntimeStateV4,
} from './app-command-runtime.js'

export interface BoundAppCommandV4 {
  readonly command: AppCommandV4 | null
  readonly pending: boolean
  readonly error: string | null
  invoke(): Promise<AppCommandOutcomeV4>
}

export function useAppCommandV4(
  bindings: AppCommandBindingsV4,
  commandId: string,
): BoundAppCommandV4 {
  const runtime = bindings.runtime
  const subscribe = useCallback(
    (listener: () => void) => runtime.subscribe(listener),
    [runtime],
  )
  const getSnapshot = useCallback(
    (): AppCommandRuntimeStateV4 => runtime.getState(),
    [runtime],
  )
  const state = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
  const command = bindings.getRegistry().get(commandId)
  const invoke = useCallback(
    () => runtime.invoke(commandId),
    [commandId, runtime],
  )

  return {
    command,
    pending: state.pendingCommandIds.has(commandId),
    error: state.errorByCommandId.get(commandId) ?? null,
    invoke,
  }
}
