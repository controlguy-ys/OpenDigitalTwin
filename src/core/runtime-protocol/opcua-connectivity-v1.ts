import type { OpcUaEndpointV5 } from '../project-v5/types.js'

export interface OpcUaTestConnectionRequestV1 { readonly type: 'opcua-test-connection-request-v1'; readonly protocolVersion: 1; readonly endpoint: OpcUaEndpointV5 }
export type OpcUaTestConnectionResultV1 =
  | { readonly type: 'opcua-test-connection-result-v1'; readonly protocolVersion: 1; readonly outcome: 'succeeded'; readonly namespaces: readonly string[] }
  | { readonly type: 'opcua-test-connection-result-v1'; readonly protocolVersion: 1; readonly outcome: 'failed'; readonly code: string; readonly message: string }
export interface OpcUaNamespaceIndexRequestV1 { readonly type: 'opcua-namespace-index-request-v1'; readonly protocolVersion: 1; readonly endpointId: string; readonly namespaceUri: string }
export interface OpcUaNamespaceIndexResponseV1 { readonly type: 'opcua-namespace-index-response-v1'; readonly protocolVersion: 1; readonly endpointId: string; readonly namespaceUri: string; readonly namespaceIndex: number }

function fail(): never { throw new Error('OPCUA_CONNECTIVITY_PROTOCOL_INVALID') }
const MAX_NAMESPACES = 256; const MAX_NAMESPACE_BYTES = 48 * 1024; const MAX_TEXT_BYTES = 4096
function text(value: unknown): value is string { return typeof value === 'string' && value.length > 0 && new TextEncoder().encode(value).byteLength <= MAX_TEXT_BYTES }
function object(value: unknown): Record<string, unknown> { if (value === null || typeof value !== 'object' || Array.isArray(value)) fail(); return value as Record<string, unknown> }
function keys(value: Record<string, unknown>, expected: readonly string[]): void { const actual = Object.keys(value).sort(); const sorted = [...expected].sort(); if (actual.length !== sorted.length || actual.some((key, index) => key !== sorted[index])) fail() }
export function validateOpcUaTestConnectionResultV1(value: unknown): OpcUaTestConnectionResultV1 {
  const source = object(value)
  if (source.outcome === 'succeeded') { keys(source, ['type', 'protocolVersion', 'outcome', 'namespaces']); if (source.type !== 'opcua-test-connection-result-v1' || source.protocolVersion !== 1 || !Array.isArray(source.namespaces) || source.namespaces.length > MAX_NAMESPACES || source.namespaces.some((item) => !text(item)) || new Set(source.namespaces).size !== source.namespaces.length || source.namespaces.reduce((total, item) => total + new TextEncoder().encode(item).byteLength, 0) > MAX_NAMESPACE_BYTES) fail(); return Object.freeze({ type: source.type, protocolVersion: 1, outcome: 'succeeded', namespaces: Object.freeze([...source.namespaces]) }) }
  keys(source, ['type', 'protocolVersion', 'outcome', 'code', 'message']); if (source.type !== 'opcua-test-connection-result-v1' || source.protocolVersion !== 1 || source.outcome !== 'failed' || !text(source.code) || !text(source.message)) fail(); return Object.freeze({ type: source.type, protocolVersion: 1, outcome: 'failed', code: source.code, message: source.message })
}
export function validateOpcUaNamespaceIndexResponseV1(value: unknown): OpcUaNamespaceIndexResponseV1 { const source = object(value); keys(source, ['type', 'protocolVersion', 'endpointId', 'namespaceUri', 'namespaceIndex']); const namespaceIndex = source.namespaceIndex; if (source.type !== 'opcua-namespace-index-response-v1' || source.protocolVersion !== 1 || !text(source.endpointId) || !text(source.namespaceUri) || typeof namespaceIndex !== 'number' || !Number.isSafeInteger(namespaceIndex) || namespaceIndex < 0) fail(); return Object.freeze({ type: source.type, protocolVersion: 1, endpointId: source.endpointId, namespaceUri: source.namespaceUri, namespaceIndex }) }
