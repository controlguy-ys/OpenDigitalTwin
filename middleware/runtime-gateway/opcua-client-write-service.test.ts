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

  it('reports invalid mappings, disconnected endpoints, namespace failures, rejected writes, and thrown writes', async () => {
    const disconnected = createOpcUaClientWriteServiceV1(projectWithBooleanOutput(), {
      currentSession: () => null,
    })
    await expect(disconnected.write({ mappingId: 'unknown', value: true }))
      .resolves.toMatchObject({ failureCode: 'OPC_UA_WRITE_MAPPING_INVALID' })
    await expect(disconnected.write({ mappingId: 'map-start', value: true }))
      .resolves.toMatchObject({ failureCode: 'OPC_UA_ENDPOINT_DISCONNECTED' })

    const namespaceFailure = createOpcUaClientWriteServiceV1(projectWithBooleanOutput(), {
      currentSession: () => ({ endpointId: 'plc', generation: 1, session: {
        readNamespaceArray: async () => { throw new Error('namespace unavailable') },
        write: async () => StatusCodes.Good,
      } as never }),
    })
    await expect(namespaceFailure.write({ mappingId: 'map-start', value: true }))
      .resolves.toMatchObject({ failureCode: 'OPC_UA_WRITE_FAILED', statusCode: 'BadCommunicationError' })

    const missingUri = createOpcUaClientWriteServiceV1(projectWithBooleanOutput(), {
      currentSession: () => ({ endpointId: 'plc', generation: 1, session: {
        readNamespaceArray: async () => ['http://opcfoundation.org/UA/'],
        write: async () => StatusCodes.Good,
      } as never }),
    })
    await expect(missingUri.write({ mappingId: 'map-start', value: true }))
      .resolves.toMatchObject({ failureCode: 'OPC_UA_WRITE_FAILED', statusCode: 'BadNodeIdUnknown' })

    const rejectedSession = {
      readNamespaceArray: vi.fn(async () => ['http://opcfoundation.org/UA/', 'urn:virtual-plc']),
      write: vi.fn(async () => StatusCodes.BadTypeMismatch),
    }
    const rejected = createOpcUaClientWriteServiceV1(projectWithBooleanOutput(), {
      currentSession: () => ({ endpointId: 'plc', generation: 1, session: rejectedSession as never }),
    })
    await expect(rejected.write({ mappingId: 'map-start', value: true }))
      .resolves.toMatchObject({ failureCode: 'OPC_UA_WRITE_REJECTED', statusCode: 'BadTypeMismatch' })

    const throwingSession = {
      readNamespaceArray: vi.fn(async () => ['http://opcfoundation.org/UA/', 'urn:virtual-plc']),
      write: vi.fn(async () => { throw new Error('write socket closed') }),
    }
    const throwing = createOpcUaClientWriteServiceV1(projectWithBooleanOutput(), {
      currentSession: () => ({ endpointId: 'plc', generation: 1, session: throwingSession as never }),
    })
    await expect(throwing.write({ mappingId: 'map-start', value: true }))
      .resolves.toMatchObject({ failureCode: 'OPC_UA_WRITE_FAILED', statusCode: 'BadCommunicationError' })
  })

  it('fences a write against a concurrent stop before it can reach the stale Session', async () => {
    let resolveNamespace: ((value: readonly string[]) => void) | null = null
    const session = {
      readNamespaceArray: vi.fn(async () => new Promise<readonly string[]>((resolve) => { resolveNamespace = resolve })),
      write: vi.fn(async () => StatusCodes.Good),
    }
    let live = true
    const service = createOpcUaClientWriteServiceV1(projectWithBooleanOutput(), {
      currentSession: () => live
        ? { endpointId: 'plc', generation: 1, session: session as never }
        : null,
    })

    const pending = service.write({ mappingId: 'map-start', value: true })
    await expect.poll(() => resolveNamespace).not.toBeNull()
    live = false
    resolveNamespace!(['http://opcfoundation.org/UA/', 'urn:virtual-plc'])

    await expect(pending).resolves.toMatchObject({ failureCode: 'OPC_UA_ENDPOINT_DISCONNECTED' })
    expect(session.write).not.toHaveBeenCalled()
  })

  it('fences a write against a reconnect generation and Session replacement with zero stale writes', async () => {
    let resolveNamespace: ((value: readonly string[]) => void) | null = null
    const staleSession = {
      readNamespaceArray: vi.fn(async () => new Promise<readonly string[]>((resolve) => { resolveNamespace = resolve })),
      write: vi.fn(async () => StatusCodes.Good),
    }
    const freshSession = {
      readNamespaceArray: vi.fn(async () => ['http://opcfoundation.org/UA/', 'urn:virtual-plc']),
      write: vi.fn(async () => StatusCodes.Good),
    }
    let current = { endpointId: 'plc', generation: 1, session: staleSession as never }
    const service = createOpcUaClientWriteServiceV1(projectWithBooleanOutput(), {
      currentSession: () => current,
    })

    const pending = service.write({ mappingId: 'map-start', value: true })
    await expect.poll(() => resolveNamespace).not.toBeNull()
    current = { endpointId: 'plc', generation: 2, session: freshSession as never }
    resolveNamespace!(['http://opcfoundation.org/UA/', 'urn:virtual-plc'])

    await expect(pending).resolves.toMatchObject({ failureCode: 'OPC_UA_ENDPOINT_DISCONNECTED' })
    expect(staleSession.write).not.toHaveBeenCalled()
    expect(freshSession.write).not.toHaveBeenCalled()
  })
})
