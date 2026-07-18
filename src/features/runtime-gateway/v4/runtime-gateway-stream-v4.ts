export interface BrowserLocationV4 {
  readonly protocol: string
  readonly host: string
}

export interface BrowserWebSocketV4 {
  readonly readyState: number
  close(): void
  addEventListener(
    type: 'open' | 'message' | 'close' | 'error',
    listener: (event: unknown) => void,
  ): void
  removeEventListener(
    type: 'open' | 'message' | 'close' | 'error',
    listener: (event: unknown) => void,
  ): void
}

export interface RuntimeGatewayStreamStatusV4 {
  readonly phase: 'stopped' | 'connecting' | 'open' | 'reconnecting'
  readonly reconnectScheduled: boolean
}

export interface RuntimeGatewayStreamV4 {
  start(): void
  stop(): void
  status(): RuntimeGatewayStreamStatusV4
}

export interface RuntimeGatewayStreamOptionsV4 {
  readonly url?: string
  readonly location?: BrowserLocationV4
  readonly createWebSocket?: (url: string) => BrowserWebSocketV4
  readonly ingest: (value: unknown, receivedTimestampMs: number) => boolean
  readonly nowMs?: () => number
  readonly reconnectDelayMs?: number
}

interface SocketListenersV4 {
  readonly open: (event: unknown) => void
  readonly message: (event: unknown) => void
  readonly close: (event: unknown) => void
  readonly error: (event: unknown) => void
}

function requireReconnectDelayV4(value: number): number {
  if (!Number.isSafeInteger(value) || value < 50) {
    throw new TypeError('Runtime Gateway reconnect delay must be a whole number of at least 50 ms.')
  }
  return value
}

export function runtimeGatewayWebSocketUrlV4(location: BrowserLocationV4): string {
  if (location.host.trim().length === 0) throw new TypeError('Browser host must not be empty.')
  const scheme = location.protocol === 'https:'
    ? 'wss:'
    : location.protocol === 'http:'
      ? 'ws:'
      : null
  if (scheme === null) throw new TypeError(`Unsupported browser protocol ${location.protocol}.`)
  return `${scheme}//${location.host}/runtime/ws`
}

function defaultBrowserLocationV4(): BrowserLocationV4 {
  return { protocol: globalThis.location.protocol, host: globalThis.location.host }
}

function defaultWebSocketFactoryV4(url: string): BrowserWebSocketV4 {
  return new globalThis.WebSocket(url) as BrowserWebSocketV4
}

function messageTextV4(event: unknown): string | null {
  if (event === null || typeof event !== 'object') return null
  const data = (event as { readonly data?: unknown }).data
  return typeof data === 'string' ? data : null
}

export function createRuntimeGatewayStreamV4(
  options: RuntimeGatewayStreamOptionsV4,
): RuntimeGatewayStreamV4 {
  const url = options.url ?? runtimeGatewayWebSocketUrlV4(
    options.location ?? defaultBrowserLocationV4(),
  )
  const createWebSocket = options.createWebSocket ?? defaultWebSocketFactoryV4
  const nowMs = options.nowMs ?? Date.now
  const reconnectDelayMs = requireReconnectDelayV4(options.reconnectDelayMs ?? 1_000)
  let started = false
  let phase: RuntimeGatewayStreamStatusV4['phase'] = 'stopped'
  let socket: BrowserWebSocketV4 | null = null
  let listeners: SocketListenersV4 | null = null
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null

  const detachSocket = (target: BrowserWebSocketV4): void => {
    if (socket !== target || listeners === null) return
    target.removeEventListener('open', listeners.open)
    target.removeEventListener('message', listeners.message)
    target.removeEventListener('close', listeners.close)
    target.removeEventListener('error', listeners.error)
    listeners = null
    socket = null
  }

  const scheduleReconnect = (): void => {
    if (!started || reconnectTimer !== null) return
    phase = 'reconnecting'
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null
      connect()
    }, reconnectDelayMs)
  }

  const disconnect = (target: BrowserWebSocketV4): void => {
    if (socket !== target) return
    detachSocket(target)
    try {
      if (target.readyState < 2) target.close()
    } catch {
      // Reconnection remains deterministic even if browser close throws.
    }
    scheduleReconnect()
  }

  const connect = (): void => {
    if (!started || socket !== null) return
    phase = 'connecting'
    let candidate: BrowserWebSocketV4
    try {
      candidate = createWebSocket(url)
    } catch {
      scheduleReconnect()
      return
    }
    const candidateListeners: SocketListenersV4 = {
      open: () => {
        if (socket === candidate && started) phase = 'open'
      },
      message: (event) => {
        if (socket !== candidate || !started) return
        const text = messageTextV4(event)
        if (text === null) return
        try {
          options.ingest(JSON.parse(text) as unknown, nowMs())
        } catch {
          // One malformed or rejected sample must not terminate the live stream.
        }
      },
      close: () => disconnect(candidate),
      error: () => disconnect(candidate),
    }
    socket = candidate
    listeners = candidateListeners
    candidate.addEventListener('open', candidateListeners.open)
    candidate.addEventListener('message', candidateListeners.message)
    candidate.addEventListener('close', candidateListeners.close)
    candidate.addEventListener('error', candidateListeners.error)
  }

  const start = (): void => {
    if (started) return
    started = true
    connect()
  }

  const stop = (): void => {
    if (!started && phase === 'stopped') return
    started = false
    if (reconnectTimer !== null) {
      clearTimeout(reconnectTimer)
      reconnectTimer = null
    }
    const active = socket
    if (active !== null) {
      detachSocket(active)
      try {
        active.close()
      } catch {
        // Stop is idempotent even when browser socket cleanup fails.
      }
    }
    phase = 'stopped'
  }

  return Object.freeze({
    start,
    stop,
    status: () => Object.freeze({
      phase,
      reconnectScheduled: reconnectTimer !== null,
    }),
  })
}
