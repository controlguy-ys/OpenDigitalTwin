import { describe, expect, it } from 'vitest'

import { createBrowserPublisherLeaseManagerV1 } from './browser-publisher-lease.js'
import { createRuntimeIntegrationDiagnosticsV1 } from './integration-diagnostics.js'

const REVISION = 'a'.repeat(64)

describe('Gateway integration diagnostics', () => {
  it('uses the same closed snapshot for HTTP and product Diagnostics without mutation', () => {
    const lease = createBrowserPublisherLeaseManagerV1({ nowMs: () => 1_000 })
    lease.acquire({ projectId: 'project-v5', configRevision: REVISION, publisherId: 'browser-a' })
    const diagnostics = createRuntimeIntegrationDiagnosticsV1({
      nowMs: () => 1_000,
      readContext: () => ({ projectId: 'project-v5', revisionId: 'revision-1', configRevision: REVISION }),
      readServerModel: () => ({ standardNodeSets: 'loaded', roboticsModel: 'ready', productModel: 'ready', activeSessionCount: 1, lastError: null }),
      lease,
    })
    const first = diagnostics.snapshot()
    expect(first).toMatchObject({ type: 'runtime-integration-diagnostics-v1', browserPublisher: { phase: 'active', generation: 1 } })
    expect(diagnostics.snapshot()).toEqual(first)
    expect(diagnostics.lastCommand()).toBeNull()
  })
})
