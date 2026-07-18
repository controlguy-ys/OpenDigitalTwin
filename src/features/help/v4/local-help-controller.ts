export type LocalHelpTopicV4 =
  | 'controls'
  | 'stepImport'
  | 'opcUaMapping'
  | 'about'

export interface LocalHelpStateV4 {
  readonly openTopic: LocalHelpTopicV4 | null
}

export interface LocalHelpControllerV4 {
  getState(): LocalHelpStateV4
  subscribe(listener: () => void): () => void
  hasTopic(topic: LocalHelpTopicV4): boolean
  open(topic: LocalHelpTopicV4): void
  close(): void
  dispose(): void
}

export function createLocalHelpControllerV4(options: {
  readonly availableTopics: readonly LocalHelpTopicV4[]
}): LocalHelpControllerV4 {
  const available = new Set(options.availableTopics)
  const subscribers = new Set<() => void>()
  let disposed = false
  let state: LocalHelpStateV4 = Object.freeze({ openTopic: null })
  const publish = (openTopic: LocalHelpTopicV4 | null): void => {
    state = Object.freeze({ openTopic })
    const listeners = new Set(subscribers)
    for (const listener of listeners) listener()
  }
  return Object.freeze({
    getState: () => state,
    subscribe(listener: () => void) {
      if (!disposed) subscribers.add(listener)
      return () => subscribers.delete(listener)
    },
    hasTopic: (topic: LocalHelpTopicV4) => available.has(topic),
    open(topic: LocalHelpTopicV4) {
      if (disposed || state.openTopic === topic) return
      if (!available.has(topic)) throw new Error(`Local Help topic is unavailable: ${topic}`)
      publish(topic)
    },
    close() {
      if (disposed || state.openTopic === null) return
      publish(null)
    },
    dispose() {
      if (disposed) return
      disposed = true
      subscribers.clear()
    },
  })
}
