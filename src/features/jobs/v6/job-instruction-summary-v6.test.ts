import { describe, expect, it } from 'vitest'

import { jobInstructionSummaryV6 } from './job-instruction-summary-v6.js'

describe('jobInstructionSummaryV6', () => {
  it('renders each supported instruction in compact readable form', () => {
    expect(jobInstructionSummaryV6({ id: 'move', kind: 'move-joint', jointValues: { J1: 0, J2: 0, J3: 0, J4: 0, J5: 0, J6: 0 }, speedPercentToNext: 30 })).toBe('Move joints · 6 axes · 30%')
    expect(jobInstructionSummaryV6({ id: 'wait', kind: 'wait-di', signalId: 'PartPresent', expected: true, timeoutMs: 3_000 })).toBe('Wait PartPresent = true · timeout 3 s')
    expect(jobInstructionSummaryV6({ id: 'set', kind: 'set-do', signalId: 'GripperClose', value: true })).toBe('Set GripperClose = true')
    expect(jobInstructionSummaryV6({ id: 'delay', kind: 'delay', durationMs: 500 })).toBe('Delay 500 ms')
    expect(jobInstructionSummaryV6({ id: 'attach', kind: 'attach', objectId: 'Part', toolFrameId: 'TCP', objectGraspFrameId: null, maximumDistanceM: 0 })).toBe('Attach Part → TCP')
    expect(jobInstructionSummaryV6({ id: 'detach', kind: 'detach', objectId: 'Part', targetParentFrameId: 'World' })).toBe('Detach Part → World')
  })
})
