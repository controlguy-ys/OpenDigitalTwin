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
        nodeClass: 'Variable', referenceTypeId: 'ns=0;i=47', typeDefinitionId: 'ns=0;i=63', hasChildren: false,
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

  it('bounds retained continuations per endpoint, expires them, and releases every abandoned point', async () => {
    let now = 1_000
    const session = {
      browse: vi.fn(async () => ({ good: true, continuationPoint: Buffer.from(`page-${session.browse.mock.calls.length}`), references: [] })),
      browseNext: vi.fn(async () => ({ good: true, continuationPoint: null, references: [] })),
      readNamespaceArray: vi.fn(async () => ['http://opcfoundation.org/UA/']),
    }
    let token = 0
    const browser = createOpcUaAddressSpaceBrowserV1({
      currentSession: () => ({ endpointId: 'plc-a', generation: 1, session }),
      createToken: () => `token_${++token}`,
      nowMs: () => now,
      continuationTtlMs: 10,
      maxContinuations: 2,
      maxContinuationsPerEndpoint: 1,
    })
    await browser.browse({ endpointId: 'plc-a', parentNodeId: null, limit: 1, continuationToken: null })
    await browser.browse({ endpointId: 'plc-a', parentNodeId: null, limit: 1, continuationToken: null })
    expect(session.browseNext).toHaveBeenCalledWith([Buffer.from('page-1')], true)
    now += 11
    await browser.browse({ endpointId: 'plc-a', parentNodeId: null, limit: 1, continuationToken: null })
    expect(session.browseNext).toHaveBeenCalledWith([Buffer.from('page-2')], true)
    await expect(browser.release('token_1')).rejects.toThrow('OPC_UA_BROWSE_CONTINUATION_INVALID')
  })

  it('rejects oversized reference pages, releases their continuation, and marks leaf Variables as non-expandable', async () => {
    const session = {
      browse: vi.fn(async () => ({ good: true, continuationPoint: Buffer.from('oversized'), references: [
        { sessionNodeId: 'ns=0;i=85', browseName: 'Objects', displayName: 'Objects', nodeClass: 1, referenceTypeId: 'ns=0;i=35', typeDefinitionId: null },
        { sessionNodeId: 'ns=1;s=Leaf', browseName: 'Leaf', displayName: 'Leaf', nodeClass: 2, referenceTypeId: 'ns=0;i=47', typeDefinitionId: null },
      ] })),
      browseNext: vi.fn(async () => ({ good: true, continuationPoint: null, references: [] })),
      readNamespaceArray: vi.fn(async () => ['http://opcfoundation.org/UA/', 'urn:plant']),
    }
    const browser = createOpcUaAddressSpaceBrowserV1({ currentSession: () => ({ endpointId: 'plc-a', generation: 1, session }) })
    await expect(browser.browse({ endpointId: 'plc-a', parentNodeId: null, limit: 1, continuationToken: null })).rejects.toThrow('OPC_UA_BROWSE_RESPONSE_INVALID')
    expect(session.browseNext).toHaveBeenCalledWith([Buffer.from('oversized')], true)
  })

  it('releases an idle continuation from its expiry timer without another browse request', async () => {
    const expiryCallbacks: (() => void)[] = []
    const session = { browse: vi.fn(async () => ({ good: true, continuationPoint: Buffer.from('idle'), references: [] })), browseNext: vi.fn(async () => ({ good: true, continuationPoint: null, references: [] })), readNamespaceArray: vi.fn(async () => ['http://opcfoundation.org/UA/']) }
    const browser = createOpcUaAddressSpaceBrowserV1({ currentSession: () => ({ endpointId: 'plc-a', generation: 1, session }), continuationTtlMs: 10, setTimeout: (callback) => { expiryCallbacks.push(callback); return callback }, clearTimeout: () => undefined, createToken: () => 'idle_token' })
    await browser.browse({ endpointId: 'plc-a', parentNodeId: null, limit: 1, continuationToken: null })
    expiryCallbacks[0]!()
    await Promise.resolve()
    expect(session.browseNext).toHaveBeenCalledWith([Buffer.from('idle')], true)
  })

  it('retains a failed release for timer retry and exposes pending cleanup until it succeeds', async () => {
    const timers: (() => void)[] = []
    const session = { browse: vi.fn(async () => ({ good: true, continuationPoint: Buffer.from('retry'), references: [] })), browseNext: vi.fn().mockRejectedValueOnce(new Error('temporary')).mockResolvedValue({ good: true, continuationPoint: null, references: [] }), readNamespaceArray: vi.fn(async () => ['http://opcfoundation.org/UA/']) }
    const browser = createOpcUaAddressSpaceBrowserV1({ currentSession: () => ({ endpointId: 'plc-a', generation: 1, session }), setTimeout: (callback) => { timers.push(callback); return callback }, clearTimeout: () => undefined, createToken: () => 'retry_token' })
    await browser.browse({ endpointId: 'plc-a', parentNodeId: null, limit: 1, continuationToken: null })
    await expect(browser.release('retry_token')).rejects.toThrow('OPC_UA_BROWSE_RELEASE_FAILED')
    expect(browser.pendingReleaseCount()).toBe(1)
    timers.at(-1)?.()
    await Promise.resolve()
    expect(browser.pendingReleaseCount()).toBe(0)
  })

  it('shares one in-flight release between an HTTP-token release and endpoint cleanup', async () => {
    let resolveRelease: (() => void) | null = null
    const session = {
      browse: vi.fn(async () => ({ good: true, continuationPoint: Buffer.from('shared'), references: [] })),
      browseNext: vi.fn(async () => new Promise<{ readonly good: boolean; readonly continuationPoint: null; readonly references: readonly [] }>((resolve) => { resolveRelease = () => resolve({ good: true, continuationPoint: null, references: [] }) })),
      readNamespaceArray: vi.fn(async () => ['http://opcfoundation.org/UA/']),
    }
    const browser = createOpcUaAddressSpaceBrowserV1({ currentSession: () => ({ endpointId: 'plc-a', generation: 1, session }), createToken: () => 'shared_token' })
    await browser.browse({ endpointId: 'plc-a', parentNodeId: null, limit: 1, continuationToken: null })
    const release = browser.release('shared_token')
    await vi.waitFor(() => expect(session.browseNext).toHaveBeenCalledOnce())
    const disconnectCleanup = browser.releaseEndpoint('plc-a')
    resolveRelease!()
    await expect(Promise.all([release, disconnectCleanup])).resolves.toEqual([undefined, undefined])
    expect(session.browseNext).toHaveBeenCalledOnce()
  })

  it('replaces a consumed page token and releases the replacement continuation', async () => {
    const session = { browse: vi.fn(async () => ({ good: true, continuationPoint: Buffer.from('first'), references: [] })), browseNext: vi.fn(async (_points: readonly Uint8Array[], release: boolean) => release ? { good: true, continuationPoint: null, references: [] } : { good: true, continuationPoint: Buffer.from('second'), references: [] }), readNamespaceArray: vi.fn(async () => ['http://opcfoundation.org/UA/']) }
    let token = 0
    const browser = createOpcUaAddressSpaceBrowserV1({ currentSession: () => ({ endpointId: 'plc-a', generation: 1, session }), createToken: () => `page_${++token}` })
    const first = await browser.browse({ endpointId: 'plc-a', parentNodeId: null, limit: 1, continuationToken: null })
    const second = await browser.browse({ endpointId: 'plc-a', parentNodeId: 'ns=0;i=85', limit: 1, continuationToken: first.continuationToken })
    await expect(browser.release(first.continuationToken!)).rejects.toThrow('OPC_UA_BROWSE_CONTINUATION_INVALID')
    await browser.release(second.continuationToken!)
    expect(session.browseNext).toHaveBeenLastCalledWith([Buffer.from('second')], true)
  })

  it('releases an endpoint continuation immediately on lifecycle cleanup and rejects an independent unknown token', async () => {
    const session = { browse: vi.fn(async () => ({ good: true, continuationPoint: Buffer.from('disconnect'), references: [] })), browseNext: vi.fn(async () => ({ good: true, continuationPoint: null, references: [] })), readNamespaceArray: vi.fn(async () => ['http://opcfoundation.org/UA/']) }
    const browser = createOpcUaAddressSpaceBrowserV1({ currentSession: () => ({ endpointId: 'plc-a', generation: 1, session }), createToken: () => 'disconnect_token' })
    await browser.browse({ endpointId: 'plc-a', parentNodeId: null, limit: 1, continuationToken: null })
    await browser.releaseEndpoint('plc-a')
    expect(session.browseNext).toHaveBeenCalledWith([Buffer.from('disconnect')], true)
    await expect(browser.release('unknown_token')).rejects.toThrow('OPC_UA_BROWSE_CONTINUATION_INVALID')
  })

  it('releases all retained continuations when the browser is disposed', async () => {
    let page = 0
    const session = { browse: vi.fn(async () => ({ good: true, continuationPoint: Buffer.from(`dispose-${++page}`), references: [] })), browseNext: vi.fn(async () => ({ good: true, continuationPoint: null, references: [] })), readNamespaceArray: vi.fn(async () => ['http://opcfoundation.org/UA/']) }
    const browser = createOpcUaAddressSpaceBrowserV1({ currentSession: () => ({ endpointId: 'plc-a', generation: 1, session }), createToken: () => `dispose_token_${page}` })
    await browser.browse({ endpointId: 'plc-a', parentNodeId: null, limit: 1, continuationToken: null })
    await browser.dispose()
    expect(session.browseNext).toHaveBeenCalledWith([Buffer.from('dispose-1')], true)
  })

  it('rejects a hostile noncanonical adapter response before output and releases its continuation', async () => {
    const session = {
      browse: vi.fn(async () => ({ good: true, continuationPoint: Buffer.from('hostile'), references: [{ sessionNodeId: 'ns=65536;i=1', browseName: 'Bad', displayName: 'Bad', nodeClass: 2, referenceTypeId: 'ns=0;i=47', typeDefinitionId: null }] })),
      browseNext: vi.fn(async () => ({ good: true, continuationPoint: null, references: [] })),
      readNamespaceArray: vi.fn(async () => ['http://opcfoundation.org/UA/']),
    }
    const browser = createOpcUaAddressSpaceBrowserV1({ currentSession: () => ({ endpointId: 'plc-a', generation: 1, session }), createToken: () => 'hostile_token' })
    await expect(browser.browse({ endpointId: 'plc-a', parentNodeId: null, limit: 1, continuationToken: null })).rejects.toThrow('OPC_UA_BROWSE_RESPONSE_INVALID')
    expect(session.browseNext).toHaveBeenCalledWith([Buffer.from('hostile')], true)
  })

  it('rejects oversized adapter fields before output and releases their continuation', async () => {
    const session = {
      browse: vi.fn(async () => ({ good: true, continuationPoint: Buffer.from('oversized-field'), references: [{ sessionNodeId: 'ns=1;s=Leaf', browseName: 'x'.repeat(1_025), displayName: 'Leaf', nodeClass: 2, referenceTypeId: 'ns=0;i=47', typeDefinitionId: null }] })),
      browseNext: vi.fn(async () => ({ good: true, continuationPoint: null, references: [] })),
      readNamespaceArray: vi.fn(async () => ['http://opcfoundation.org/UA/', 'urn:plant']),
    }
    const browser = createOpcUaAddressSpaceBrowserV1({ currentSession: () => ({ endpointId: 'plc-a', generation: 1, session }), createToken: () => 'oversized_token' })
    await expect(browser.browse({ endpointId: 'plc-a', parentNodeId: null, limit: 1, continuationToken: null })).rejects.toThrow('OPC_UA_BROWSE_RESPONSE_INVALID')
    expect(session.browseNext).toHaveBeenCalledWith([Buffer.from('oversized-field')], true)
  })
})
