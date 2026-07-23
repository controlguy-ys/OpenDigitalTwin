import {
  validateOpcUaNodeAddressV1,
  type OpcUaNodeAddressV1,
} from '../../../core/project-v5/index.js'
import { validateRuntimeGatewayErrorEnvelopeV1 } from '../../../core/runtime-protocol/gateway-error-envelope-v1.js'
import type { NamespaceIndexResolutionPortV1 } from '../../connectivity/v5/opcua-node-address-draft.js'

const MAX_RESPONSE_BYTES_V1 = 64 * 1024

export class RuntimeGatewayNodeAddressResolverV1Error extends Error {
  readonly code: string
  readonly statusCode: number | null

  constructor(code: string, message: string, statusCode: number | null = null, cause?: unknown) {
    super(message)
    this.name = 'RuntimeGatewayNodeAddressResolverV1Error'
    this.code = code
    this.statusCode = statusCode
    if (cause !== undefined) this.cause = cause
  }
}

export interface RuntimeGatewayNodeAddressResolverV1Options {
  readonly fetch?: (input: string, init: RequestInit) => Promise<Response>
  readonly path?: string
}

function exactNodeAddressResponse(value: unknown): OpcUaNodeAddressV1 {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new RuntimeGatewayNodeAddressResolverV1Error('RUNTIME_GATEWAY_RESPONSE_INVALID', 'Runtime Gateway returned an invalid Node Address response.')
  }
  const record = value as Record<string, unknown>
  if (Object.keys(record).length !== 1 || !Object.hasOwn(record, 'nodeAddress')) {
    throw new RuntimeGatewayNodeAddressResolverV1Error('RUNTIME_GATEWAY_RESPONSE_INVALID', 'Runtime Gateway returned an invalid Node Address response.')
  }
  try {
    return validateOpcUaNodeAddressV1(record.nodeAddress, '$.nodeAddress')
  } catch (error) {
    throw new RuntimeGatewayNodeAddressResolverV1Error('RUNTIME_GATEWAY_RESPONSE_INVALID', 'Runtime Gateway returned an invalid Node Address response.', null, error)
  }
}

async function boundedJson(response: Response): Promise<unknown> {
  const declared = response.headers.get('content-length')
  if (declared !== null && (!/^[0-9]+$/u.test(declared) || Number(declared) > MAX_RESPONSE_BYTES_V1)) {
    throw new RuntimeGatewayNodeAddressResolverV1Error('RUNTIME_GATEWAY_RESPONSE_TOO_LARGE', 'Runtime Gateway response exceeds 64 KiB.', response.status)
  }
  const reader = response.body?.getReader()
  if (reader === undefined) {
    throw new RuntimeGatewayNodeAddressResolverV1Error('RUNTIME_GATEWAY_RESPONSE_INVALID', 'Runtime Gateway returned no response body.', response.status)
  }
  const chunks: Uint8Array[] = []
  let byteLength = 0
  while (true) {
    const next = await reader.read()
    if (next.done) break
    byteLength += next.value.byteLength
    if (byteLength > MAX_RESPONSE_BYTES_V1) {
      void reader.cancel().catch(() => undefined)
      throw new RuntimeGatewayNodeAddressResolverV1Error('RUNTIME_GATEWAY_RESPONSE_TOO_LARGE', 'Runtime Gateway response exceeds 64 KiB.', response.status)
    }
    chunks.push(next.value)
  }
  const merged = new Uint8Array(byteLength)
  let offset = 0
  for (const chunk of chunks) {
    merged.set(chunk, offset)
    offset += chunk.byteLength
  }
  try {
    return JSON.parse(new TextDecoder().decode(merged)) as unknown
  } catch (error) {
    throw new RuntimeGatewayNodeAddressResolverV1Error('RUNTIME_GATEWAY_RESPONSE_INVALID', 'Runtime Gateway returned invalid JSON.', response.status, error)
  }
}

export function createRuntimeGatewayNodeAddressResolverV1(
  options: RuntimeGatewayNodeAddressResolverV1Options = {},
): NamespaceIndexResolutionPortV1 {
  const fetcher = options.fetch ?? globalThis.fetch.bind(globalThis)
  const path = options.path ?? '/runtime/opcua/resolve-node-address'
  if (!path.startsWith('/') || path.startsWith('//') || path.includes('\\') || path.includes('?') || path.includes('#')) {
    throw new TypeError('Runtime Gateway Node Address path must be an absolute same-origin path.')
  }
  return Object.freeze({
    async resolve(endpointId: string, sessionNodeId: string, signal?: AbortSignal): Promise<OpcUaNodeAddressV1> {
      let response: Response
      try {
        response = await fetcher(path, {
          method: 'POST',
          headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
          body: JSON.stringify({ endpointId, sessionNodeId }),
          redirect: 'error',
          ...(signal === undefined ? {} : { signal }),
        })
      } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') throw error
        throw new RuntimeGatewayNodeAddressResolverV1Error('RUNTIME_GATEWAY_UNAVAILABLE', 'Runtime Gateway Node Address resolution is unavailable.', null, error)
      }
      const body = await boundedJson(response)
      if (!response.ok) {
        try {
          const envelope = validateRuntimeGatewayErrorEnvelopeV1(body)
          throw new RuntimeGatewayNodeAddressResolverV1Error(envelope.code, envelope.message, response.status)
        } catch (error) {
          if (error instanceof RuntimeGatewayNodeAddressResolverV1Error) throw error
          throw new RuntimeGatewayNodeAddressResolverV1Error(`RUNTIME_GATEWAY_HTTP_${response.status}`, 'Runtime Gateway Node Address resolution failed.', response.status, error)
        }
      }
      return exactNodeAddressResponse(body)
    },
  })
}
