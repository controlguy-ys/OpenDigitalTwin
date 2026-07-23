export const RUNTIME_GATEWAY_ERROR_CODE_MAX_BYTES_V1 = 128
export const RUNTIME_GATEWAY_ERROR_MESSAGE_MAX_BYTES_V1 = 512
export const RUNTIME_GATEWAY_ERROR_DETAIL_KEYS_V1 = [
  'recoveredProjectId', 'recoveredRevisionId', 'recoveryError',
] as const

export interface RuntimeGatewayErrorEnvelopeV1 {
  readonly code: string
  readonly message: string
  readonly recoveredProjectId?: string | null
  readonly recoveredRevisionId?: string | null
  readonly recoveryError?: string | null
}

const CODE = /^[A-Z][A-Z0-9_]*$/u
const encoder = new TextEncoder()
const decoder = new TextDecoder()

function boundedUtf8(value: string, maxBytes: number): string {
  const bytes = encoder.encode(value)
  if (bytes.byteLength <= maxBytes) return value
  let end = maxBytes
  while (end > 0 && ((bytes[end] ?? 0) & 0b1100_0000) === 0b1000_0000) end -= 1
  return decoder.decode(bytes.slice(0, end))
}

function validText(value: unknown, maxBytes: number): value is string {
  return typeof value === 'string' && encoder.encode(value).byteLength <= maxBytes
}

export function canonicalizeRuntimeGatewayErrorEnvelopeV1(
  code: string,
  message: string,
  details: Readonly<Record<string, unknown>> = {},
): RuntimeGatewayErrorEnvelopeV1 {
  const stableCode = CODE.test(code) && encoder.encode(code).byteLength <= RUNTIME_GATEWAY_ERROR_CODE_MAX_BYTES_V1
    ? code
    : 'RUNTIME_GATEWAY_INTERNAL_ERROR'
  const envelope: Record<string, string | null> = {
    code: stableCode,
    message: boundedUtf8(message, RUNTIME_GATEWAY_ERROR_MESSAGE_MAX_BYTES_V1),
  }
  for (const key of RUNTIME_GATEWAY_ERROR_DETAIL_KEYS_V1) {
    const value = details[key]
    if (value === null) envelope[key] = null
    else if (typeof value === 'string') envelope[key] = boundedUtf8(value, RUNTIME_GATEWAY_ERROR_MESSAGE_MAX_BYTES_V1)
  }
  return Object.freeze(envelope) as unknown as RuntimeGatewayErrorEnvelopeV1
}

export function validateRuntimeGatewayErrorEnvelopeV1(value: unknown): RuntimeGatewayErrorEnvelopeV1 {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('RUNTIME_GATEWAY_ERROR_ENVELOPE_INVALID')
  const source = value as Record<string, unknown>
  const allowed = new Set<string>(['code', 'message', ...RUNTIME_GATEWAY_ERROR_DETAIL_KEYS_V1])
  if (Object.keys(source).some((key) => !allowed.has(key)) || !validText(source.code, RUNTIME_GATEWAY_ERROR_CODE_MAX_BYTES_V1) || !CODE.test(source.code) || !validText(source.message, RUNTIME_GATEWAY_ERROR_MESSAGE_MAX_BYTES_V1)) {
    throw new Error('RUNTIME_GATEWAY_ERROR_ENVELOPE_INVALID')
  }
  const envelope: Record<string, string | null> = { code: source.code, message: source.message }
  for (const key of RUNTIME_GATEWAY_ERROR_DETAIL_KEYS_V1) {
    if (!(key in source)) continue
    if (source[key] !== null && !validText(source[key], RUNTIME_GATEWAY_ERROR_MESSAGE_MAX_BYTES_V1)) throw new Error('RUNTIME_GATEWAY_ERROR_ENVELOPE_INVALID')
    envelope[key] = source[key] as string | null
  }
  return Object.freeze(envelope) as unknown as RuntimeGatewayErrorEnvelopeV1
}
