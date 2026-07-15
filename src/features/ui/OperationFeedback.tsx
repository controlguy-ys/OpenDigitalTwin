import { useStore } from 'zustand'
import { createStore, type StoreApi } from 'zustand/vanilla'
import type { SceneCommandWarningV1 } from '../scene/scene-command-service'

export interface OperationFeedbackMessageV1 {
  readonly kind: 'status' | 'alert'
  readonly text: string
}

export interface OperationFeedbackStateV1 {
  readonly message: OperationFeedbackMessageV1 | null
  publishResourceWarning(warning: SceneCommandWarningV1): void
  publishError(error: unknown): void
  clear(): void
}

export type OperationFeedbackStore = StoreApi<OperationFeedbackStateV1>

export function createOperationFeedbackStore(): OperationFeedbackStore {
  return createStore<OperationFeedbackStateV1>((set) => ({
    message: null,
    publishResourceWarning: (warning) => set({
      message: {
        kind: 'status',
        text: `${warning.code}: ${warning.current} of ${warning.limit}`,
      },
    }),
    publishError: (error) => set({
      message: {
        kind: 'alert',
        text: error instanceof Error ? error.message : 'Operation failed.',
      },
    }),
    clear: () => set({ message: null }),
  }))
}

export const operationFeedbackStore = createOperationFeedbackStore()

export async function runOperationWithFeedback<T>(
  operation: () => Promise<T>,
  onSuccess: (value: T) => void,
  store: OperationFeedbackStore = operationFeedbackStore,
): Promise<void> {
  store.getState().clear()
  try {
    const value = await operation()
    onSuccess(value)
  } catch (error) {
    store.getState().publishError(error)
  }
}

export function OperationFeedback({
  store = operationFeedbackStore,
}: Readonly<{ store?: OperationFeedbackStore }>) {
  const message = useStore(store, (state) => state.message)
  if (message === null) return null
  return (
    <div className={`operation-feedback operation-feedback-${message.kind}`}>
      <p aria-live={message.kind === 'alert' ? 'assertive' : 'polite'} role={message.kind}>
        {message.text}
      </p>
      <button
        aria-label="Dismiss operation message"
        onClick={() => store.getState().clear()}
        type="button"
      >Dismiss</button>
    </div>
  )
}
