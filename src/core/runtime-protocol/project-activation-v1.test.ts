import { describe, expect, it } from 'vitest'

import { validateRuntimeProjectActivationRequestV1 } from './project-activation-v1.js'

describe('validateRuntimeProjectActivationRequestV1', () => {
  it('rejects injected fields and invalid authority before a Gateway transition', () => {
    expect(() => validateRuntimeProjectActivationRequestV1({
      type: 'runtime-project-activation-v1', protocolVersion: 1, project: {},
      configRevision: 'a'.repeat(64), activationAttemptId: 'attempt-0001',
      expectedAuthority: null, injected: true,
    })).toThrow('RUNTIME_PROJECT_ACTIVATION_INVALID')
  })
})
