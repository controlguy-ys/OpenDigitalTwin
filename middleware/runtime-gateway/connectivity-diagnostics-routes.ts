import { validateOpcUaEndpointV5, type OpcUaEndpointV5 } from '../../src/core/project-v5/index.js'
import { validateOpcUaTestConnectionResultV1, type OpcUaTestConnectionResultV1 } from '../../src/core/runtime-protocol/opcua-connectivity-v1.js'

export const MAX_CONNECTIVITY_DIAGNOSTICS_BODY_BYTES_V1 = 64 * 1024

export class ConnectivityDiagnosticsRouteErrorV1 extends Error {
  readonly statusCode: number
  readonly code: string
  constructor(statusCode: number, code: string, message: string) {
    super(message)
    this.name = 'ConnectivityDiagnosticsRouteErrorV1'
    this.statusCode = statusCode
    this.code = code
  }
}

function record(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new ConnectivityDiagnosticsRouteErrorV1(400, 'CONNECTIVITY_REQUEST_INVALID', 'Connectivity request must be a JSON object.')
  return value as Record<string, unknown>
}

function exact(value: Record<string, unknown>, keys: readonly string[]): void {
  const actual = Object.keys(value).sort()
  const expected = [...keys].sort()
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) throw new ConnectivityDiagnosticsRouteErrorV1(400, 'CONNECTIVITY_REQUEST_INVALID', 'Connectivity request contains unsupported fields.')
}

function boundedText(value: unknown, field: string, maximumBytes = 1_024): string {
  if (typeof value !== 'string' || value.length === 0 || Buffer.byteLength(value) > maximumBytes) throw new ConnectivityDiagnosticsRouteErrorV1(400, 'CONNECTIVITY_REQUEST_INVALID', `${field} must be a bounded non-empty string.`)
  return value
}

export function validateTestConnectionRequestV1(value: unknown): OpcUaEndpointV5 {
  const source = record(value); exact(source, ['type', 'protocolVersion', 'endpoint'])
  if (source.type !== 'opcua-test-connection-request-v1' || source.protocolVersion !== 1) throw new ConnectivityDiagnosticsRouteErrorV1(400, 'CONNECTIVITY_REQUEST_INVALID', 'Connectivity request version is unsupported.')
  try { return validateOpcUaEndpointV5(source.endpoint, '$.endpoint') } catch { throw new ConnectivityDiagnosticsRouteErrorV1(400, 'CONNECTIVITY_REQUEST_INVALID', 'Endpoint does not satisfy the Project V5 endpoint contract.') }
}

export function validateNamespaceIndexRequestV1(value: unknown): { readonly endpointId: string; readonly namespaceUri: string } {
  const source = record(value); exact(source, ['type', 'protocolVersion', 'endpointId', 'namespaceUri'])
  if (source.type !== 'opcua-namespace-index-request-v1' || source.protocolVersion !== 1) throw new ConnectivityDiagnosticsRouteErrorV1(400, 'CONNECTIVITY_REQUEST_INVALID', 'Namespace request version is unsupported.')
  return Object.freeze({ endpointId: boundedText(source.endpointId, 'endpointId'), namespaceUri: boundedText(source.namespaceUri, 'namespaceUri', 4_096) })
}

export function validateNodeAddressResolutionRequestV1(value: unknown): {
  readonly endpointId: string
  readonly sessionNodeId: string
} {
  const source = record(value); exact(source, ['endpointId', 'sessionNodeId'])
  return Object.freeze({
    endpointId: boundedText(source.endpointId, 'endpointId'),
    sessionNodeId: boundedText(source.sessionNodeId, 'sessionNodeId', 8 * 1024),
  })
}

const TEST_CONNECTION_CODES = new Set([
  'OPC_UA_CONNECTION_TIMEOUT', 'OPC_UA_CONNECT_FAILED', 'OPC_UA_SESSION_FAILED',
  'OPC_UA_NAMESPACE_READ_FAILED', 'OPC_UA_NAMESPACE_ARRAY_INVALID',
  'OPC_UA_CONNECTION_CLEANUP_FAILED', 'OPC_UA_CONNECTION_FAILED',
])

export function boundedTestConnectionResultV1(result: unknown): OpcUaTestConnectionResultV1 {
  let validated: OpcUaTestConnectionResultV1
  try { validated = validateOpcUaTestConnectionResultV1(result) } catch {
    throw new ConnectivityDiagnosticsRouteErrorV1(503, 'CONNECTIVITY_RESPONSE_INVALID', 'Connectivity diagnostic returned an invalid result.')
  }
  const canonical = validated.outcome === 'succeeded'
    ? Object.freeze({ type: 'opcua-test-connection-result-v1' as const, protocolVersion: 1 as const, outcome: 'succeeded' as const, namespaces: Object.freeze([...validated.namespaces]) })
    : TEST_CONNECTION_CODES.has(validated.code)
      ? Object.freeze({ type: 'opcua-test-connection-result-v1' as const, protocolVersion: 1 as const, outcome: 'failed' as const, code: validated.code, message: validated.message.slice(0, 512) })
      : (() => { throw new ConnectivityDiagnosticsRouteErrorV1(503, 'CONNECTIVITY_RESPONSE_INVALID', 'Connectivity diagnostic returned an unsupported failure code.') })()
  const bytes = Buffer.byteLength(JSON.stringify(canonical))
  if (bytes > MAX_CONNECTIVITY_DIAGNOSTICS_BODY_BYTES_V1) throw new ConnectivityDiagnosticsRouteErrorV1(503, 'CONNECTIVITY_RESPONSE_TOO_LARGE', 'Connectivity response exceeds 64 KiB.')
  return canonical
}
