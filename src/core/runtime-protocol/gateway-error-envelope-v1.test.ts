import { describe, expect, it } from 'vitest'

import { canonicalizeRuntimeGatewayErrorEnvelopeV1, validateRuntimeGatewayErrorEnvelopeV1 } from './gateway-error-envelope-v1.js'

describe('Runtime Gateway error envelope V1', () => {
  it('uses UTF-8 byte bounds while preserving the stable code for multibyte messages', () => {
    const envelope = canonicalizeRuntimeGatewayErrorEnvelopeV1('PROJECT_RECOVERY_REQUIRED', '한'.repeat(300), {
      recoveryError: '가'.repeat(300),
    })

    expect(envelope.code).toBe('PROJECT_RECOVERY_REQUIRED')
    expect(new TextEncoder().encode(envelope.message).byteLength).toBeLessThanOrEqual(512)
    expect(new TextEncoder().encode(envelope.recoveryError!).byteLength).toBeLessThanOrEqual(512)
    expect(validateRuntimeGatewayErrorEnvelopeV1(envelope)).toEqual(envelope)
    expect(() => validateRuntimeGatewayErrorEnvelopeV1({ ...envelope, message: '한'.repeat(171) })).toThrow()
  })
})
