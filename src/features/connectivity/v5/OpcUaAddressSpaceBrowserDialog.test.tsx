import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useRef, useState, type ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'

import type {
  OpcUaAddressSpaceBrowseNodeV1,
  OpcUaAddressSpaceBrowseResponseV1,
} from '../../../core/runtime-protocol/opcua-connectivity-v1.js'
import {
  OpcUaAddressSpaceBrowserDialogV1,
  type OpcUaAddressSpaceBrowsePortV1,
} from './OpcUaAddressSpaceBrowserDialog.js'

function node(
  sessionNodeId: string,
  overrides: Partial<OpcUaAddressSpaceBrowseNodeV1> = {},
): OpcUaAddressSpaceBrowseNodeV1 {
  return {
    sessionNodeId,
    browseName: sessionNodeId,
    displayName: sessionNodeId,
    nodeClass: 'Object',
    referenceTypeId: 'ns=0;i=35',
    typeDefinitionId: null,
    hasChildren: false,
    nodeAddress: null,
    ...overrides,
  }
}

function response(
  parentNodeId: string,
  nodes: readonly OpcUaAddressSpaceBrowseNodeV1[],
  continuationToken: string | null = null,
): OpcUaAddressSpaceBrowseResponseV1 {
  return {
    type: 'opcua-address-space-browse-response-v1',
    protocolVersion: 1,
    endpointId: 'endpoint-1',
    parentNodeId,
    nodes,
    continuationToken,
  }
}

function browserPort(): OpcUaAddressSpaceBrowsePortV1 {
  return {
    browseAddressSpace: vi.fn(async ({ parentNodeId, continuationToken }) => {
      if (parentNodeId === null) return response('ns=0;i=85', [node('ns=2;s=Machine', { browseName: 'Machine', displayName: 'Machine', hasChildren: true })])
      if (continuationToken === null) return response(parentNodeId, [node('ns=2;s=Machine.Temperature', {
        browseName: 'Temperature',
        displayName: 'Temperature',
        nodeClass: 'Variable',
        nodeAddress: { namespaceUri: 'urn:machine', identifierType: 'string', identifier: 'Machine.Temperature' },
      })], 'next-page')
      return response(parentNodeId, [node('ns=2;s=Machine.Pressure', { browseName: 'Pressure', displayName: 'Pressure' })])
    }),
    releaseAddressSpaceBrowse: vi.fn(async () => undefined),
  }
}

function BrowserHarness({ port, onSelect = vi.fn() }: {
  readonly port: OpcUaAddressSpaceBrowsePortV1
  readonly onSelect?: (address: OpcUaAddressSpaceBrowseNodeV1['nodeAddress'] & {}) => void
}): ReactNode {
  const triggerRef = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(true)
  return <>
    <button onClick={() => setOpen(true)} ref={triggerRef} type="button">Browse</button>
    {open ? <OpcUaAddressSpaceBrowserDialogV1
      browsePort={port}
      endpointId="endpoint-1"
      onClose={() => setOpen(false)}
      onSelect={(address) => { onSelect(address); setOpen(false) }}
      triggerRef={triggerRef}
    /> : null}
  </>
}

describe('OpcUaAddressSpaceBrowserDialogV1', () => {
  it('lazily browses Objects, paginates expanded children, filters loaded rows, and never invokes a mutation port', async () => {
    const user = userEvent.setup()
    const port = browserPort()
    render(<BrowserHarness port={port} />)

    const machine = await screen.findByRole('treeitem', { name: /Machine/ })
    expect(port.browseAddressSpace).toHaveBeenCalledWith({ endpointId: 'endpoint-1', parentNodeId: null, limit: 25, continuationToken: null }, expect.any(AbortSignal))
    machine.focus()
    await user.keyboard('{ArrowRight}')
    await screen.findByRole('treeitem', { name: /Temperature/ })
    await user.click(screen.getByRole('button', { name: 'Load more Machine' }))
    await screen.findByRole('treeitem', { name: /Pressure/ })
    await user.type(screen.getByLabelText('Filter loaded nodes'), 'temperature')
    expect(screen.getByRole('treeitem', { name: /Temperature/ })).toBeVisible()
    expect(screen.queryByRole('treeitem', { name: /Pressure/ })).not.toBeInTheDocument()
    expect(port.releaseAddressSpaceBrowse).not.toHaveBeenCalled()
  })

  it('copies the exact session NodeId only when asked and applies a stable address on selection', async () => {
    const user = userEvent.setup()
    const port = browserPort()
    const onSelect = vi.fn()
    const writeText = vi.fn(async () => undefined)
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    render(<BrowserHarness onSelect={onSelect} port={port} />)

    const machine = await screen.findByRole('treeitem', { name: /Machine/ })
    machine.focus()
    await user.keyboard('{ArrowRight}')
    await screen.findByRole('treeitem', { name: /Temperature/ })
    await user.click(screen.getByRole('treeitem', { name: /Temperature/ }))
    await user.click(screen.getByRole('button', { name: 'Copy NodeId' }))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('ns=2;s=Machine.Temperature'))
    await user.click(screen.getByRole('button', { name: 'Select Node' }))
    expect(onSelect).toHaveBeenCalledWith({ namespaceUri: 'urn:machine', identifierType: 'string', identifier: 'Machine.Temperature' })
    expect(screen.queryByRole('dialog', { name: 'OPC UA Address Space' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Browse' })).toHaveFocus()
  })

  it('uses the tree keyboard contract and closes only the nested browser on Escape', async () => {
    const user = userEvent.setup()
    const port = browserPort()
    render(<BrowserHarness port={port} />)

    const machine = await screen.findByRole('treeitem', { name: /Machine/ })
    machine.focus()
    await user.keyboard('{ArrowRight}')
    const temperature = await screen.findByRole('treeitem', { name: /Temperature/ })
    await user.keyboard('{ArrowDown}')
    await waitFor(() => expect(temperature).toHaveFocus())
    await user.keyboard('{Home}')
    await waitFor(() => expect(machine).toHaveFocus())
    await user.keyboard('{End}')
    await waitFor(() => expect(temperature).toHaveFocus())
    await user.keyboard('{ArrowLeft}')
    await waitFor(() => expect(machine).toHaveFocus())
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog', { name: 'OPC UA Address Space' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Browse' })).toHaveFocus()
  })
})
