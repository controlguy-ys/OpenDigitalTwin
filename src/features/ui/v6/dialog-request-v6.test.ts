import { describe, expect, it } from 'vitest'

import type { DialogRequestV6 } from './dialog-request-v6.js'

describe('DialogRequestV6 job editor', () => {
  it('accepts an optional instruction id for job editing', () => {
    const request: DialogRequestV6 = { kind: 'job-editor', jobId: 'job-1', instructionId: 'instruction-1' }
    expect(request).toMatchObject({ kind: 'job-editor', jobId: 'job-1', instructionId: 'instruction-1' })
  })
})
