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

function deferred<Value>() {
  let resolve: (value: Value) => void = () => undefined
  const promise = new Promise<Value>((complete) => { resolve = complete })
  return { promise, resolve }
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

  it('releases a continuation on close and keeps a release failure visible for retry', async () => {
    const user = userEvent.setup()
    const port = browserPort()
    port.releaseAddressSpaceBrowse = vi.fn()
      .mockRejectedValueOnce(new Error('release denied'))
      .mockResolvedValueOnce(undefined)
    render(<BrowserHarness port={port} />)
    const machine = await screen.findByRole('treeitem', { name: /Machine/ })
    machine.focus()
    await user.keyboard('{ArrowRight}')
    await screen.findByRole('treeitem', { name: /Temperature/ })
    await user.click(screen.getByRole('button', { name: 'Close' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('OPC_UA_BROWSE_RELEASE_FAILED: release denied')
    expect(screen.getByRole('dialog', { name: 'OPC UA Address Space' })).toBeVisible()
    expect(port.releaseAddressSpaceBrowse).toHaveBeenCalledWith('next-page')
    await user.click(screen.getByRole('button', { name: 'Close' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'OPC UA Address Space' })).not.toBeInTheDocument())
    expect(screen.getByRole('button', { name: 'Browse' })).toHaveFocus()
  })

  it('shows browse and clipboard failures without applying a node', async () => {
    const user = userEvent.setup()
    const browseFailure: OpcUaAddressSpaceBrowsePortV1 = {
      browseAddressSpace: vi.fn(async () => { throw new Error('session stale') }),
      releaseAddressSpaceBrowse: vi.fn(async () => undefined),
    }
    const view = render(<BrowserHarness port={browseFailure} />)
    expect(await screen.findByRole('alert')).toHaveTextContent('session stale')
    view.unmount()

    const port = browserPort()
    const writeText = vi.fn(async () => { throw new Error('clipboard denied') })
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    render(<BrowserHarness port={port} />)
    const machine = await screen.findByRole('treeitem', { name: /Machine/ })
    machine.focus()
    await user.keyboard('{ArrowRight}')
    await user.click(await screen.findByRole('treeitem', { name: /Temperature/ }))
    await user.click(screen.getByRole('button', { name: 'Copy NodeId' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('clipboard denied')
  })

  it('aborts and ignores a stale response after close before a new browse starts', async () => {
    const user = userEvent.setup()
    const first = deferred<OpcUaAddressSpaceBrowseResponseV1>()
    let firstSignal: AbortSignal | undefined
    const port: OpcUaAddressSpaceBrowsePortV1 = {
      browseAddressSpace: vi.fn()
        .mockImplementationOnce((_request, signal: AbortSignal | undefined) => { firstSignal = signal; return first.promise })
        .mockResolvedValueOnce(response('ns=0;i=85', [node('ns=2;s=Fresh', { displayName: 'Fresh' })])),
      releaseAddressSpaceBrowse: vi.fn(async () => undefined),
    }
    render(<BrowserHarness port={port} />)
    await user.click(screen.getByRole('button', { name: 'Close' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'OPC UA Address Space' })).not.toBeInTheDocument())
    expect(firstSignal?.aborted).toBe(true)
    await user.click(screen.getByRole('button', { name: 'Browse' }))
    await screen.findByRole('treeitem', { name: /Fresh/ })
    first.resolve(response('ns=0;i=85', [node('ns=2;s=Stale', { displayName: 'Stale' })]))
    await waitFor(() => expect(screen.queryByRole('treeitem', { name: /Stale/ })).not.toBeInTheDocument())
  })

  it('releases an acquired continuation exactly once when its parent unmounts during a pending child page', async () => {
    const user = userEvent.setup()
    const pendingPage = deferred<OpcUaAddressSpaceBrowseResponseV1>()
    let pendingSignal: AbortSignal | undefined
    const releaseAddressSpaceBrowse = vi.fn(async () => undefined)
    const port: OpcUaAddressSpaceBrowsePortV1 = {
      browseAddressSpace: vi.fn()
        .mockResolvedValueOnce(response('ns=0;i=85', [node('ns=2;s=Machine', { displayName: 'Machine', hasChildren: true })]))
        .mockResolvedValueOnce(response('ns=2;s=Machine', [node('ns=2;s=Machine.Temp', { displayName: 'Temperature' })], 'continuation-a'))
        .mockImplementationOnce((_request, signal: AbortSignal | undefined) => { pendingSignal = signal; return pendingPage.promise }),
      releaseAddressSpaceBrowse,
    }
    const view = render(<BrowserHarness port={port} />)
    const machine = await screen.findByRole('treeitem', { name: /Machine/ })
    machine.focus()
    await user.keyboard('{ArrowRight}')
    await screen.findByRole('treeitem', { name: /Temperature/ })
    await user.click(screen.getByRole('button', { name: 'Load more Machine' }))

    view.unmount()
    await waitFor(() => expect(releaseAddressSpaceBrowse).toHaveBeenCalledTimes(1))
    expect(releaseAddressSpaceBrowse).toHaveBeenCalledWith('continuation-a')
    expect(pendingSignal?.aborted).toBe(true)
    pendingPage.resolve(response('ns=2;s=Machine', [node('ns=2;s=Machine.Late', { displayName: 'Late' })]))
    await waitFor(() => expect(screen.queryByRole('treeitem', { name: /Late/ })).not.toBeInTheDocument())
    expect(releaseAddressSpaceBrowse).toHaveBeenCalledTimes(1)
  })
})
