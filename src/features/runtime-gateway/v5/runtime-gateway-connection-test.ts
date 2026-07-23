import type { OpcUaEndpointV5 } from '../../../core/project-v5/index.js'
import type { RuntimeGatewayConnectivityClientV1 } from './runtime-gateway-connectivity-client.js'

export interface OpcUaConnectionTestPortV1 {
  testEndpoint(endpoint: OpcUaEndpointV5, signal?: AbortSignal): Promise<{
    readonly phase: 'connected' | 'failed'
    readonly namespaceUris: readonly string[]
    readonly elapsedMs: number
    readonly error: string | null
  }>
}

export interface RuntimeGatewayConnectionTestPortV1Options {
  readonly gateway: Pick<RuntimeGatewayConnectivityClientV1, 'testConnection'>
  readonly nowMs?: () => number
}

export function createRuntimeGatewayConnectionTestPortV1(
  options: RuntimeGatewayConnectionTestPortV1Options,
): OpcUaConnectionTestPortV1 {
  const nowMs = options.nowMs ?? Date.now
  return Object.freeze({
    async testEndpoint(endpoint: OpcUaEndpointV5, signal?: AbortSignal) {
      const startedAtMs = nowMs()
      const result = await options.gateway.testConnection(endpoint, signal)
      const elapsedMs = Math.max(0, nowMs() - startedAtMs)
      return result.outcome === 'succeeded'
        ? Object.freeze({ phase: 'connected' as const, namespaceUris: Object.freeze([...result.namespaces]), elapsedMs, error: null })
        : Object.freeze({ phase: 'failed' as const, namespaceUris: Object.freeze([]), elapsedMs, error: `${result.code}: ${result.message}` })
    },
  })
}
