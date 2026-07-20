import { describe, expect, it } from 'vitest'

import { splitStateBatchesV1 } from './runtime-stream-timeline.js'

const REVISION = 'a'.repeat(64)

function batch(sequence: number, values: Array<{
  mappingId: string
  coherenceGroupId: null
  value: boolean | number
  unit: string
  quality: 'GOOD'
  statusCode: string
}> = [{
  mappingId: 'mapping-1', coherenceGroupId: null, value: true,
  unit: '', quality: 'GOOD' as const, statusCode: 'Good',
}]) {
  return {
    type: 'state-batch-v1' as const,
    protocolVersion: 1 as const,
    gatewayId: 'gateway-1',
    projectId: 'project-v5',
    configRevision: REVISION,
    endpointId: 'plc-a',
    sequence,
    sourceTimestampMs: 1_000,
    publishedTimestampMs: 1_000,
    originId: 'gateway-1:opcua-client',
    values,
  }
}

describe('runtime stream timeline V1', () => {
  it('splits neutral State Batches without retaining a StateBatchHub dependency', () => {
    const chunks = splitStateBatchesV1(batch(4, Array.from({ length: 129 }, (_, index) => ({
      mappingId: `mapping-${index + 1}`, coherenceGroupId: null, value: index,
      unit: '', quality: 'GOOD' as const, statusCode: 'Good',
    }))))

    expect(chunks.map(({ sequence, values }) => [sequence, values.length])).toEqual([
      [4, 128], [5, 1],
    ])
  })
})
