import { MessageSecurityMode, OPCUAClient, SecurityPolicy } from 'node-opcua'

import type { OpcUaEndpointV5 } from '../../src/core/project-v5/index.js'
import type { OpcUaTestConnectionResultV1 } from '../../src/core/runtime-protocol/opcua-connectivity-v1.js'

const MAX_NAMESPACE_COUNT = 256
const MAX_NAMESPACE_BYTES = 48 * 1024
const MAX_NAMESPACE_URI_BYTES = 4 * 1024

export interface OpcUaConnectionTestSessionV1 {
  readNamespaceArray(): Promise<readonly string[]>
  close(): Promise<void>
}

export interface OpcUaConnectionTestClientV1 {
  connect(endpointUrl: string): Promise<void>
  createSession(): Promise<OpcUaConnectionTestSessionV1>
  disconnect(): Promise<void>
}

export interface OpcUaConnectionTestOptionsV1 {
  readonly createClient?: () => OpcUaConnectionTestClientV1
  readonly timeoutMs?: number
  readonly cleanupTimeoutMs?: number
  readonly sessionCloseTimeoutMs?: number
  readonly disconnectTimeoutMs?: number
}

export type OpcUaConnectionTestResultV1 = OpcUaTestConnectionResultV1

function boundedMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return message.slice(0, 512)
}

function validNamespaces(value: readonly string[]): readonly string[] | null {
  if (value.length > MAX_NAMESPACE_COUNT) return null
  let bytes = 0
  const unique = new Set<string>()
  for (const namespaceUri of value) {
    if (typeof namespaceUri !== 'string' || namespaceUri.length === 0 || Buffer.byteLength(namespaceUri) > MAX_NAMESPACE_URI_BYTES || unique.has(namespaceUri)) return null
    unique.add(namespaceUri)
    bytes += Buffer.byteLength(namespaceUri)
    if (bytes > MAX_NAMESPACE_BYTES) return null
  }
  return Object.freeze([...value])
}

function defaultClient(): OpcUaConnectionTestClientV1 {
  return OPCUAClient.create({
    securityMode: MessageSecurityMode.None,
    securityPolicy: SecurityPolicy.None,
    connectionStrategy: { maxRetry: 0 },
  }) as unknown as OpcUaConnectionTestClientV1
}

export async function testOpcUaConnectionV1(
  endpoint: OpcUaEndpointV5,
  options: OpcUaConnectionTestOptionsV1 = {},
): Promise<OpcUaConnectionTestResultV1> {
  const timeoutMs = options.timeoutMs ?? 5_000
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 5_000) throw new TypeError('timeoutMs must be a positive integer no greater than five seconds.')
  const cleanupTimeoutMs = options.cleanupTimeoutMs ?? timeoutMs
  if (!Number.isSafeInteger(cleanupTimeoutMs) || cleanupTimeoutMs < 1 || cleanupTimeoutMs > 5_000) throw new TypeError('cleanupTimeoutMs must be a positive integer no greater than five seconds.')
  const sessionCloseTimeoutMs = options.sessionCloseTimeoutMs ?? cleanupTimeoutMs
  const disconnectTimeoutMs = options.disconnectTimeoutMs ?? cleanupTimeoutMs
  const client = (options.createClient ?? defaultClient)()
  let session: OpcUaConnectionTestSessionV1 | null = null
  let failure: { readonly code: string; readonly message: string } | null = null
  let timedOut = false
  let timeout: ReturnType<typeof setTimeout> | null = null
  let connectOperation: Promise<void> | null = null
  let createSessionOperation: Promise<OpcUaConnectionTestSessionV1> | null = null
  let connectSettled = false
  let createSessionSettled = false
  let connectNeedsLateCleanup = false
  let createSessionNeedsLateCleanup = false
  const deadline = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(() => {
      timedOut = true
      connectNeedsLateCleanup = connectOperation !== null && !connectSettled
      createSessionNeedsLateCleanup = createSessionOperation !== null && !createSessionSettled
      reject(new Error('OPC UA diagnostic timed out.'))
    }, timeoutMs)
  })
  let namespaces: readonly string[] | null = null
  let phase: 'connect' | 'session' | 'read' = 'connect'
  const withinDeadline = async <T>(operation: Promise<T>): Promise<T> => Promise.race([operation, deadline])
  try {
    connectOperation = client.connect(endpoint.endpointUrl)
    void connectOperation.then(() => { connectSettled = true }, () => { connectSettled = true })
    await withinDeadline(connectOperation)
    phase = 'session'
    createSessionOperation = client.createSession()
    void createSessionOperation.then(() => { createSessionSettled = true }, () => { createSessionSettled = true })
    session = await withinDeadline(createSessionOperation)
    phase = 'read'
    namespaces = await withinDeadline(session.readNamespaceArray())
    const validated = validNamespaces(namespaces)
    if (validated === null) {
      failure = { code: 'OPC_UA_NAMESPACE_ARRAY_INVALID', message: 'OPC UA Server NamespaceArray is malformed or exceeds its limit.' }
    } else {
      namespaces = validated
    }
  } catch (error) {
    failure = { code: timedOut ? 'OPC_UA_CONNECTION_TIMEOUT' : phase === 'connect' ? 'OPC_UA_CONNECT_FAILED' : phase === 'session' ? 'OPC_UA_SESSION_FAILED' : 'OPC_UA_NAMESPACE_READ_FAILED', message: boundedMessage(error) }
  } finally {
    if (timeout !== null) clearTimeout(timeout)
    let cleanupTimedOut = false
    const withinCleanupBudget = async (operation: () => Promise<void> | void, budgetMs: number): Promise<void> => {
      let timer: ReturnType<typeof setTimeout> | null = null
      const deadline = new Promise<never>((_resolve, reject) => { timer = setTimeout(() => { cleanupTimedOut = true; reject(new Error('OPC UA diagnostic cleanup timed out.')) }, budgetMs) })
      try { await Promise.race([Promise.resolve().then(operation), deadline]) } finally { if (timer !== null) clearTimeout(timer) }
    }
    const cleanup = async (targetSession: OpcUaConnectionTestSessionV1 | null): Promise<boolean> => {
      let failed = false
      try { await withinCleanupBudget(() => targetSession?.close(), sessionCloseTimeoutMs) } catch { failed = true }
      // Session teardown owns the Client lifetime: disconnect is attempted only
      // after close settles or the independent cleanup budget expires.
      try { await withinCleanupBudget(() => client.disconnect(), disconnectTimeoutMs) } catch { failed = true }
      return failed
    }
    const cleanupFailed = await cleanup(session)
    if (timedOut) {
      // Timed-out node-opcua work can still produce resources. Observe both
      // promises captured as pending at the timeout boundary. Settlement
      // during normal cleanup cannot transfer or cancel that ownership.
      if (connectNeedsLateCleanup) void connectOperation?.then(() => cleanup(null), () => undefined).catch(() => undefined)
      if (createSessionNeedsLateCleanup) void createSessionOperation?.then((lateSession) => cleanup(lateSession), () => undefined).catch(() => undefined)
    }
    if (cleanupFailed) failure = { code: 'OPC_UA_CONNECTION_CLEANUP_FAILED', message: cleanupTimedOut ? 'OPC UA diagnostic cleanup timed out.' : 'OPC UA diagnostic cleanup failed.' }
  }
  if (failure === null && namespaces !== null) {
    return Object.freeze({ type: 'opcua-test-connection-result-v1', protocolVersion: 1, outcome: 'succeeded', namespaces })
  }
  return Object.freeze({ type: 'opcua-test-connection-result-v1', protocolVersion: 1, outcome: 'failed', code: failure?.code ?? 'OPC_UA_CONNECTION_FAILED', message: failure?.message ?? 'OPC UA diagnostic failed.' })
}
