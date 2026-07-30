import { describe, expect, it, vi } from 'vitest'

import { createOpcUaAddressSpaceBrowserV1 } from './opcua-address-space-browser.js'

describe('createOpcUaAddressSpaceBrowserV1', () => {
  it('browses the Objects root with a bounded page and returns namespace-stable addresses without writing', async () => {
    const session = {
      browse: vi.fn(async () => ({
        good: true,
        continuationPoint: Buffer.from('next-page'),
        references: [{
          sessionNodeId: 'ns=1;s=Machine.Temperature',
          browseName: 'Temperature',
          displayName: 'Machine temperature',
          nodeClass: 2,
          referenceTypeId: 'ns=0;i=47',
          typeDefinitionId: 'ns=0;i=63',
        }],
      })),
      browseNext: vi.fn(async () => ({ good: true, continuationPoint: null, references: [] })),
      readNamespaceArray: vi.fn(async () => ['http://opcfoundation.org/UA/', 'urn:plant']),
      write: vi.fn(),
    }
    const browser = createOpcUaAddressSpaceBrowserV1({
      currentSession: (endpointId) => endpointId === 'plc-a'
        ? { endpointId, generation: 4, session }
        : null,
      createToken: () => 'opaque-page-token',
    })

    const result = await browser.browse({
      endpointId: 'plc-a', parentNodeId: null, limit: 25, continuationToken: null,
    })

    expect(session.browse).toHaveBeenCalledWith(expect.objectContaining({ nodeId: 'ns=0;i=85', requestedMaxReferencesPerNode: 25 }))
    expect(result).toEqual({
      endpointId: 'plc-a', parentNodeId: 'ns=0;i=85',
      nodes: [{
        sessionNodeId: 'ns=1;s=Machine.Temperature', browseName: 'Temperature', displayName: 'Machine temperature',
        nodeClass: 'Variable', referenceTypeId: 'ns=0;i=47', typeDefinitionId: 'ns=0;i=63', hasChildren: true,
        nodeAddress: { namespaceUri: 'urn:plant', identifierType: 'string', identifier: 'Machine.Temperature' },
      }],
      continuationToken: 'opaque-page-token',
    })
    expect(session.write).not.toHaveBeenCalled()
  })

  it('fences a continuation against a changed endpoint Session and releases only the original continuation point', async () => {
    const firstSession = {
      browse: vi.fn(async () => ({ good: true, continuationPoint: Buffer.from('page-2'), references: [] })),
      browseNext: vi.fn(async () => ({ good: true, continuationPoint: null, references: [] })), readNamespaceArray: vi.fn(async () => ['http://opcfoundation.org/UA/']),
    }
    const nextSession = { browse: vi.fn(), browseNext: vi.fn(), readNamespaceArray: vi.fn() }
    let current: typeof firstSession | typeof nextSession = firstSession
    const browser = createOpcUaAddressSpaceBrowserV1({
      currentSession: () => ({ endpointId: 'plc-a', generation: current === firstSession ? 1 : 2, session: current }),
      createToken: () => 'opaque-page-token',
    })
    await browser.browse({ endpointId: 'plc-a', parentNodeId: null, limit: 10, continuationToken: null })
    current = nextSession

    await expect(browser.browse({ endpointId: 'plc-a', parentNodeId: null, limit: 10, continuationToken: 'opaque-page-token' }))
      .rejects.toThrow('OPC_UA_BROWSE_SESSION_STALE')

    expect(firstSession.browseNext).toHaveBeenCalledWith([Buffer.from('page-2')], true)
    expect(nextSession.browseNext).not.toHaveBeenCalled()
  })
})
