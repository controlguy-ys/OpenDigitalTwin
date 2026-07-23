import { describe, expect, it, vi } from 'vitest'

import {
  createOpcUaNodeAddressDraftV1,
  resolveSessionNodeIdDraftV1,
  validateOpcUaNodeAddressDraftV1,
} from './opcua-node-address-draft.js'

describe('OPC UA Node Address Draft V1', () => {
  it('canonicalizes the Namespace URI without changing a String identifier', () => {
    expect(validateOpcUaNodeAddressDraftV1({
      namespaceUri: ' urn:virtual-plc ',
      identifierType: 'string',
      identifier: ' ObjectPos ',
    })).toEqual({
      namespaceUri: 'urn:virtual-plc',
      identifierType: 'string',
      identifier: ' ObjectPos ',
    })
  })

  it('persists Namespace URI rather than the live Namespace Index', async () => {
    const resolve = vi.fn(async () => ({
      namespaceUri: 'urn:virtual-plc',
      identifierType: 'string' as const,
      identifier: 'ObjectPos',
    }))
    const address = await resolveSessionNodeIdDraftV1('plc-a', 'ns=2;s=ObjectPos', { resolve })

    expect(resolve).toHaveBeenCalledWith('plc-a', 'ns=2;s=ObjectPos', undefined)
    expect(address).toEqual({
      namespaceUri: 'urn:virtual-plc',
      identifierType: 'string',
      identifier: 'ObjectPos',
    })
    expect(JSON.stringify(address)).not.toContain('ns=2')
  })

  it('preserves a disconnected resolver failure and leaves the caller Draft unchanged', async () => {
    const draft = createOpcUaNodeAddressDraftV1({
      namespaceUri: 'urn:retained',
      identifierType: 'string',
      identifier: 'Retained',
    })
    const resolve = vi.fn(async () => { throw new Error('OPC_UA_BROWSE_SESSION_UNAVAILABLE') })

    await expect(resolveSessionNodeIdDraftV1('plc-a', 'ns=2;s=ObjectPos', { resolve }))
      .rejects.toThrow('OPC_UA_BROWSE_SESSION_UNAVAILABLE')
    expect(draft).toEqual({
      namespaceUri: 'urn:retained',
      identifierType: 'string',
      identifier: 'Retained',
    })
  })
})
