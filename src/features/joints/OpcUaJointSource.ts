import {
  validateJointFrame,
  ZERO_JOINT_ANGLES,
  type JointAngleSource,
  type JointAnglesDeg,
  type JointFrame,
} from '../../domain/robot/joint-frame'
import { resolveOpcUaGatewayUrl } from './opcua-gateway-url'

export interface BrowserWebSocket {
  onopen: (() => void) | null
  onmessage: ((event: MessageEvent<string>) => void) | null
  onerror: (() => void) | null
  onclose: (() => void) | null
  close(): void
}

type WebSocketFactory = (url: string) => BrowserWebSocket

const defaultFactory: WebSocketFactory = (url) =>
  new WebSocket(url) as unknown as BrowserWebSocket

export class OpcUaJointSource implements JointAngleSource {
  readonly mode = 'opcua' as const
  private readonly listeners = new Set<(frame: JointFrame) => void>()
  private readonly equipmentListeners = new Set<
    (values: Readonly<Record<string, number>>, timestampMs: number) => void
  >()
  private socket: BrowserWebSocket | null = null
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private desiredConnected = false
  private lastAngles: JointAnglesDeg = ZERO_JOINT_ANGLES
  private readonly url: string
  private readonly createWebSocket: WebSocketFactory

  constructor(
    url = 'ws://127.0.0.1:4841',
    createWebSocket: WebSocketFactory = defaultFactory,
  ) {
    this.url = url
    this.createWebSocket = createWebSocket
  }

  connect(): Promise<void> {
    if (this.socket !== null) return Promise.resolve()
    this.desiredConnected = true
    return this.openSocket()
  }

  disconnect(): Promise<void> {
    this.desiredConnected = false
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    const socket = this.socket
    this.socket = null
    if (socket !== null) {
      socket.onopen = null
      socket.onmessage = null
      socket.onerror = null
      socket.onclose = null
      socket.close()
    }
    return Promise.resolve()
  }

  subscribe(listener: (frame: JointFrame) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  subscribeEquipment(
    listener: (values: Readonly<Record<string, number>>, timestampMs: number) => void,
  ): () => void {
    this.equipmentListeners.add(listener)
    return () => this.equipmentListeners.delete(listener)
  }

  private openSocket(): Promise<void> {
    return new Promise((resolve, reject) => {
      let opened = false
      let socket: BrowserWebSocket
      try {
        socket = this.createWebSocket(this.url)
      } catch (error) {
        this.emitBad()
        reject(error)
        return
      }
      this.socket = socket
      socket.onopen = () => {
        opened = true
        resolve()
      }
      socket.onmessage = (event) => this.handleMessage(event.data)
      socket.onerror = () => {
        this.emitBad()
        if (!opened) reject(new Error(`Unable to connect to OPC UA gateway at ${this.url}.`))
      }
      socket.onclose = () => {
        if (this.socket === socket) this.socket = null
        if (!this.desiredConnected) return
        this.emitBad()
        this.reconnectTimer = setTimeout(() => {
          this.reconnectTimer = null
          void this.openSocket().catch(() => undefined)
        }, 2000)
      }
    })
  }

  private handleMessage(raw: string): void {
    try {
      const parsed = JSON.parse(raw) as Partial<JointFrame> & { type?: string }
      if (parsed.type === 'equipment-status') {
        const message = parsed as unknown as {
          values?: Record<string, unknown>
          timestampMs?: unknown
        }
        if (typeof message.values !== 'object' || message.values === null) return
        const values = Object.fromEntries(
          Object.entries(message.values)
            .filter(
              (entry): entry is [string, number] =>
                typeof entry[1] === 'number' && Number.isFinite(entry[1]),
            )
            .map(([id, value]) => [id, Number(value)]),
        )
        const timestampMs = Number(message.timestampMs)
        if (!Number.isFinite(timestampMs)) return
        for (const listener of this.equipmentListeners) {
          listener(values, timestampMs)
        }
        return
      }
      if (parsed.type !== 'joint-frame') return
      const frame = validateJointFrame({
        anglesDeg: parsed.anglesDeg as JointAnglesDeg,
        timestampMs: parsed.timestampMs as number,
        quality: parsed.quality as JointFrame['quality'],
      })
      this.lastAngles = [...frame.anglesDeg]
      this.emit(frame)
    } catch {
      this.emitBad()
    }
  }

  private emitBad(): void {
    this.emit({
      anglesDeg: [...this.lastAngles],
      timestampMs: Date.now(),
      quality: 'BAD',
    })
  }

  private emit(frame: JointFrame): void {
    for (const listener of this.listeners) listener(frame)
  }
}

export const opcUaJointSource = new OpcUaJointSource(
  resolveOpcUaGatewayUrl(
    import.meta.env.VITE_OPCUA_GATEWAY_URL,
    typeof window === 'undefined' ? undefined : window.location,
  ),
)
