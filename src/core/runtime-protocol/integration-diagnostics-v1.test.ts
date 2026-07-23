import { describe, expect, it } from 'vitest'

import { validateRuntimeIntegrationDiagnosticsV1 } from './integration-diagnostics-v1.js'

const REVISION = 'a'.repeat(64)

function diagnostics(overrides: Record<string, unknown> = {}) {
  return {
    type: 'runtime-integration-diagnostics-v1', protocolVersion: 1, observedAtMs: 1_000,
    projectId: 'project-v5', revisionId: 'revision-1', configRevision: REVISION,
    serverModel: {
      standardNodeSets: 'loaded', roboticsModel: 'ready', productModel: 'ready',
      activeSessionCount: 1, maximumSessionCount: 16, lastError: null,
    },
    browserPublisher: { phase: 'active', publisherId: 'browser-a', generation: 2, expiresAt: 6_000 },
    lastCommandResult: null,
    ...overrides,
  }
}

describe('RuntimeIntegrationDiagnosticsV1', () => {
  it('accepts only the exact closed diagnostics shape', () => {
    expect(validateRuntimeIntegrationDiagnosticsV1(diagnostics())).toEqual(diagnostics())
    expect(() => validateRuntimeIntegrationDiagnosticsV1(diagnostics({ extra: true }))).toThrow('RUNTIME_PROTOCOL_INVALID')
  })

  it('requires disabled models and zero sessions when no Server model is active', () => {
    expect(validateRuntimeIntegrationDiagnosticsV1(diagnostics({
      projectId: null, revisionId: null, configRevision: null,
      serverModel: {
        standardNodeSets: 'disabled', roboticsModel: 'disabled', productModel: 'disabled',
        activeSessionCount: 0, maximumSessionCount: 16, lastError: null,
      },
      browserPublisher: { phase: 'absent', publisherId: null, generation: null, expiresAt: null },
    }))).toMatchObject({ projectId: null, serverModel: { activeSessionCount: 0 } })
  })
})
