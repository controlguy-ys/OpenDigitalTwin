// @vitest-environment node

import { expect, it } from 'vitest'

import {
  canonicalProjectV4Json,
  configRevisionForProjectV4,
  validateWorkcellProjectV4,
} from '../../src/core/project-v4/index.js'
import { makeMinimalWorkcellProjectV4 } from '../../src/core/project-v4/test-support.js'
import { validateStateBatchV1 } from '../../src/core/runtime-protocol/v1.js'

function keyedStateBatch(configRevision: string): unknown {
  return {
    type: 'state-batch-v1',
    protocolVersion: 1,
    gatewayId: 'gateway-1',
    projectId: 'project-v4',
    configRevision,
    endpointId: 'endpoint-1',
    sequence: 1,
    sourceTimestampMs: 100,
    publishedTimestampMs: 101,
    originId: 'origin-1',
    values: [{
      mappingId: 'joint-J1',
      coherenceGroupId: null,
      value: 0,
      unit: 'deg',
      quality: 'GOOD',
      statusCode: 'Good',
    }],
  }
}

it('consumes the golden Project V4 Core and keyed protocol fixture in Node', async () => {
  const goldenConfigRevision = 'e679de7f286e2aa5bd2c3e9ca72c32916d527c9b7a68af7a7639dc16ba519969'
  const project = validateWorkcellProjectV4(makeMinimalWorkcellProjectV4())
  const canonicalJson = canonicalProjectV4Json(project)

  expect('document' in globalThis).toBe(false)
  expect(JSON.parse(canonicalJson)).toEqual(project)
  await expect(configRevisionForProjectV4(project)).resolves.toBe(goldenConfigRevision)
  expect(validateStateBatchV1(keyedStateBatch(goldenConfigRevision))).toMatchObject({
    configRevision: goldenConfigRevision,
    values: [{ mappingId: 'joint-J1', value: 0, unit: 'deg' }],
  })
})
