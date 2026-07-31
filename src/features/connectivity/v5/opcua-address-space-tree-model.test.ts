import { describe, expect, it } from 'vitest'

import type { OpcUaAddressSpaceBrowseNodeV1 } from '../../../core/runtime-protocol/opcua-connectivity-v1.js'
import { addressTreeNavigationV1, createAddressTreeRowsV1, replaceAddressTreeRowV1, visibleAddressTreeRowsV1 } from './opcua-address-space-tree-model.js'

function node(sessionNodeId: string, displayName: string, hasChildren = false): OpcUaAddressSpaceBrowseNodeV1 {
  return { sessionNodeId, browseName: displayName, displayName, nodeClass: 'Object', referenceTypeId: 'ns=0;i=35', typeDefinitionId: null, hasChildren, nodeAddress: null }
}

describe('OPC UA address space tree model', () => {
  it('keeps row identity stable while adding a child page and filtering loaded rows', () => {
    const root = createAddressTreeRowsV1(null, [node('ns=2;s=Machine', 'Machine', true)])[0]!
    const child = createAddressTreeRowsV1(root.rowId, [node('ns=2;s=Machine.Temp', 'Temperature')])
    const rows = replaceAddressTreeRowV1([root], root.rowId, (current) => Object.freeze({ ...current, expanded: true, children: child }))
    expect(visibleAddressTreeRowsV1(rows, 'temperature').map(({ row }) => row.rowId)).toEqual([root.rowId, child[0]!.rowId])
  })

  it('returns deterministic ARIA tree navigation actions', () => {
    const rows = createAddressTreeRowsV1(null, [node('ns=2;s=A', 'A', true), node('ns=2;s=B', 'B')])
    const visible = visibleAddressTreeRowsV1(rows, '')
    expect(addressTreeNavigationV1('ArrowDown', visible, rows[0]!)).toEqual({ type: 'focus', rowId: rows[1]!.rowId })
    expect(addressTreeNavigationV1('ArrowRight', visible, rows[0]!)).toEqual({ type: 'expand', row: rows[0] })
    expect(addressTreeNavigationV1('Enter', visible, rows[1]!)).toEqual({ type: 'select', row: rows[1] })
  })
})
