import { AttributeIds, DataType, StatusCodes } from 'node-opcua'
import { describe, expect, it, vi } from 'vitest'

import { cloneWorkcellProjectV5, makeMinimalWorkcellProjectV5 } from '../../src/core/project-v5/test-support.js'
import { validateWorkcellProjectV5, type WorkcellProjectV5 } from '../../src/core/project-v5/index.js'
import { createOpcUaClientWriteServiceV1 } from './opcua-client-write-service.js'

function projectWithBooleanOutput(): WorkcellProjectV5 {
  const project = cloneWorkcellProjectV5(makeMinimalWorkcellProjectV5())
  ;(project.logicalSignals[0] as unknown as { direction: 'output' }).direction = 'output'
  ;(project.opcUa.endpoints[0] as unknown as { endpointId: string; enabled: boolean }).endpointId = 'plc'
  ;(project.opcUa.endpoints[0] as unknown as { enabled: boolean }).enabled = true
  ;(project.opcUa.mappings[0] as unknown as { endpointId: string; direction: 'write'; id: string; nodeAddress: unknown }).endpointId = 'plc'
  ;(project.opcUa.mappings[0] as unknown as { direction: 'write' }).direction = 'write'
  ;(project.opcUa.mappings[0] as unknown as { id: string }).id = 'map-start'
  ;(project.opcUa.mappings[0] as unknown as { nodeAddress: unknown }).nodeAddress = {
    namespaceUri: 'urn:virtual-plc', identifierType: 'string', identifier: 'Start',
  }
  return validateWorkcellProjectV5(project)
}

describe('OPC UA Client Write Service V1', () => {
  it('writes one Boolean Value through the still-current live Session', async () => {
    const session = {
      readNamespaceArray: vi.fn(async () => ['http://opcfoundation.org/UA/', 'urn:virtual-plc']),
      write: vi.fn(async () => StatusCodes.Good),
    }
    const service = createOpcUaClientWriteServiceV1(projectWithBooleanOutput(), {
      currentSession: () => ({ endpointId: 'plc', generation: 1, session: session as never }),
    })

    await expect(service.write({ mappingId: 'map-start', value: true }))
      .resolves.toEqual({ ok: true, statusCode: 'Good' })
    expect(session.write).toHaveBeenCalledOnce()
    expect(session.write).toHaveBeenCalledWith({
      nodeId: 'ns=1;s=Start', attributeId: AttributeIds.Value,
      value: { value: { dataType: DataType.Boolean, value: true } },
    })
  })
})
