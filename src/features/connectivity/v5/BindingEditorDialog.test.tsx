import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import {
  validateWorkcellProjectV5,
  type WorkcellProjectV5,
} from '../../../core/project-v5/index.js'
import type { OpcUaAddressSpaceBrowseResponseV1 } from '../../../core/runtime-protocol/opcua-connectivity-v1.js'
import {
  cloneWorkcellProjectV5,
  makeMinimalWorkcellProjectV5,
} from '../../../core/project-v5/test-support.js'
import type { PublishedProjectV5 } from '../../project/v5/project-v5-publication.js'
import type { ProjectV5AtomicMutationPort } from '../../project/v5/project-v5-mutation-service.js'
import type { OpcUaAddressSpaceBrowsePortV1 } from './OpcUaAddressSpaceBrowserDialog.js'
import { BindingEditorDialogV1 } from './BindingEditorDialog.js'

function projectWithBox(): WorkcellProjectV5 {
  const project = cloneWorkcellProjectV5(makeMinimalWorkcellProjectV5())
  ;(project.spatialEntities as unknown as Array<WorkcellProjectV5['spatialEntities'][number]>).push({
    id: 'box', name: 'Box',
    geometry: { kind: 'box', dimensionsM: [0.1, 0.1, 0.1], color: '#808080' },
    parentFrameId: 'box-motion',
    localPose: { positionM: [0, 0, 0], quaternion: [0, 0, 0, 1] },
    visible: true, groupId: null, removable: true, transformOwner: 'manual',
    numericStatus: { value: 0, sourceOwnership: 'manual', overlay: { visible: true, frameId: null } },
    graspable: true, graspFrames: [],
    movingFrames: [{
      frameId: 'box-motion', name: 'Motion', parentFrameId: 'world',
      localPose: { positionM: [0, 0, 0], quaternion: [0, 0, 0, 1] },
      sourceOwnership: 'manual',
    }],
  })
  return validateWorkcellProjectV5(project)
}

function published(project: WorkcellProjectV5): PublishedProjectV5 {
  return { project, revisionId: project.revisionId, configRevision: 'a'.repeat(64) }
}

function mutationHarness(project: WorkcellProjectV5, failure?: Error) {
  let candidate: WorkcellProjectV5 | null = null
  const mutate = vi.fn(async (request: Parameters<ProjectV5AtomicMutationPort['mutate']>[0]) => {
    if (failure !== undefined) throw failure
    candidate = validateWorkcellProjectV5(request.recipe(project))
    return published(candidate)
  })
  return {
    candidate: () => candidate,
    port: { readPublished: () => published(project), mutate },
    mutate,
  }
}

describe('BindingEditorDialogV1', () => {
  it('shows Project Endpoints only and atomically saves a six-leaf Object Pose mapping', async () => {
    const user = userEvent.setup()
    const project = projectWithBox()
    const mutation = mutationHarness(project)
    const onClose = vi.fn()
    render(<BindingEditorDialogV1
      activeProject={project}
      browseSessionAvailable={() => false}
      createMappingId={() => 'mapping-box-pose'}
      mutations={mutation.port}
      nodeAddressResolver={{ resolve: vi.fn() }}
      onClose={onClose}
      target={{ type: 'entity-frame', entityId: 'box', frameId: 'box-motion' }}
    />)
    expect(screen.getByLabelText('Binding endpoint')).toHaveTextContent('Controller')
    expect(screen.queryByLabelText('Endpoint URL')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Reconnect delay (ms)')).not.toBeInTheDocument()
    expect(screen.getByText('Project V5 / Z-up / metres / quaternion XYZW')).toBeVisible()
    expect(screen.getByLabelText('Paste session NodeId')).toBeDisabled()
    expect(screen.queryByRole('button', { name: 'Browse Address Space' })).not.toBeInTheDocument()

    await user.clear(screen.getByLabelText('Namespace URI'))
    await user.type(screen.getByLabelText('Namespace URI'), 'urn:virtual-plc')
    await user.type(screen.getByLabelText('Identifier'), 'ObjectPos')
    await user.click(screen.getByRole('button', { name: 'Save Binding' }))

    await waitFor(() => expect(mutation.mutate).toHaveBeenCalledOnce())
    const candidate = mutation.candidate()
    expect(candidate?.opcUa.mappings.find(({ id }) => id === 'mapping-box-pose')?.leaves).toHaveLength(6)
    expect(candidate?.spatialEntities[0]).toMatchObject({
      transformOwner: 'opcua:endpoint-1',
      movingFrames: [{ sourceOwnership: 'opcua:endpoint-1' }],
    })
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('resolves a pasted session NodeId only through an available Browse Session', async () => {
    const user = userEvent.setup()
    const project = projectWithBox()
    const resolver = {
      resolve: vi.fn(async () => ({
        namespaceUri: 'urn:virtual-plc',
        identifierType: 'string' as const,
        identifier: 'ObjectPos',
      })),
    }
    render(<BindingEditorDialogV1
      activeProject={project}
      browseSessionAvailable={() => true}
      createMappingId={() => 'mapping-box-pose'}
      mutations={mutationHarness(project).port}
      nodeAddressResolver={resolver}
      onClose={vi.fn()}
      target={{ type: 'entity-frame', entityId: 'box', frameId: 'box-motion' }}
    />)
    await user.type(screen.getByLabelText('Paste session NodeId'), 'ns=2;s=ObjectPos')
    await user.click(screen.getByRole('button', { name: 'Resolve from Browse Session' }))
    await waitFor(() => expect(resolver.resolve).toHaveBeenCalledWith('endpoint-1', 'ns=2;s=ObjectPos', undefined))
    expect(screen.getByLabelText('Namespace URI')).toHaveValue('urn:virtual-plc')
    expect(screen.getByLabelText('Identifier')).toHaveValue('ObjectPos')
    expect(screen.queryByRole('button', { name: 'Browse Address Space' })).not.toBeInTheDocument()
  })

  it('opens a nested read-only Address Space browser only for a live session and applies its stable node address without mutating', async () => {
    const user = userEvent.setup()
    const project = projectWithBox()
    const mutation = mutationHarness(project)
    const browsePort: OpcUaAddressSpaceBrowsePortV1 = {
      browseAddressSpace: vi.fn(async (): Promise<OpcUaAddressSpaceBrowseResponseV1> => ({
        type: 'opcua-address-space-browse-response-v1',
        protocolVersion: 1,
        endpointId: 'endpoint-1',
        parentNodeId: 'ns=0;i=85',
        continuationToken: null,
        nodes: [{
          sessionNodeId: 'ns=2;s=Machine.Temperature', browseName: 'Temperature', displayName: 'Temperature', nodeClass: 'Variable', referenceTypeId: 'ns=0;i=47', typeDefinitionId: null, hasChildren: false,
          nodeAddress: { namespaceUri: 'urn:machine', identifierType: 'string', identifier: 'Machine.Temperature' },
        }],
      })),
      releaseAddressSpaceBrowse: vi.fn(async () => undefined),
    }
    render(<BindingEditorDialogV1
      activeProject={project}
      addressSpaceBrowsePort={browsePort}
      browseSessionAvailable={() => true}
      createMappingId={() => 'mapping-box-pose'}
      mutations={mutation.port}
      nodeAddressResolver={{ resolve: vi.fn() }}
      onClose={vi.fn()}
      target={{ type: 'entity-frame', entityId: 'box', frameId: 'box-motion' }}
    />)

    await user.click(screen.getByRole('button', { name: 'Browse Address Space' }))
    expect(screen.getAllByRole('dialog')).toHaveLength(2)
    const temperature = await screen.findByRole('treeitem', { name: /Temperature/ })
    await user.click(temperature)
    await user.click(screen.getByRole('button', { name: 'Select Node' }))
    expect(screen.getByRole('dialog', { name: 'OPC UA Binding' })).toBeVisible()
    expect(screen.queryByRole('dialog', { name: 'OPC UA Address Space' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Browse Address Space' })).toHaveFocus()
    expect(screen.getByLabelText('Namespace URI')).toHaveValue('urn:machine')
    expect(screen.getByLabelText('Identifier')).toHaveValue('Machine.Temperature')
    expect(mutation.mutate).not.toHaveBeenCalled()
  })

  it('uses the same editor for Robot Joint binding and keeps an atomic failure open', async () => {
    const user = userEvent.setup()
    const project = validateWorkcellProjectV5(makeMinimalWorkcellProjectV5())
    const mutation = mutationHarness(project, new Error('PROJECT_ACTIVE_REVISION_CHANGED'))
    const onClose = vi.fn()
    render(<BindingEditorDialogV1
      activeProject={project}
      browseSessionAvailable={() => false}
      createMappingId={() => 'mapping-j1'}
      mutations={mutation.port}
      nodeAddressResolver={{ resolve: vi.fn() }}
      onClose={onClose}
      target={{ type: 'robot-joint', robotId: 'robot-1', jointId: 'J1' }}
    />)
    expect(screen.getByRole('heading', { name: 'Scalar Leaf' })).toBeVisible()
    await user.clear(screen.getByLabelText('Namespace URI'))
    await user.type(screen.getByLabelText('Namespace URI'), 'urn:virtual-plc')
    await user.type(screen.getByLabelText('Identifier'), 'Robot.J1')
    await user.click(screen.getByRole('button', { name: 'Save Binding' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('PROJECT_ACTIVE_REVISION_CHANGED')
    expect(screen.getByRole('dialog')).toBeVisible()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('requires an explicit confirmation before taking Manual ownership', async () => {
    const user = userEvent.setup()
    const project = projectWithBox()
    const mutation = mutationHarness(project)
    render(<BindingEditorDialogV1
      activeProject={project}
      browseSessionAvailable={() => false}
      createMappingId={() => 'mapping-box-pose'}
      mutations={mutation.port}
      nodeAddressResolver={{ resolve: vi.fn() }}
      onClose={vi.fn()}
      target={{ type: 'entity-frame', entityId: 'box', frameId: 'box-motion' }}
    />)
    await user.click(screen.getByRole('button', { name: 'Take Manual Ownership' }))
    expect(mutation.mutate).not.toHaveBeenCalled()
    expect(screen.getByText('Manual ownership removes conflicting read mappings for this target.')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Confirm Take Manual Ownership' })).toHaveFocus()
    await user.click(screen.getByRole('button', { name: 'Keep OPC UA Control' }))
    expect(screen.getByRole('button', { name: 'Take Manual Ownership' })).toHaveFocus()
    await user.click(screen.getByRole('button', { name: 'Take Manual Ownership' }))
    await user.click(screen.getByRole('button', { name: 'Confirm Take Manual Ownership' }))
    await waitFor(() => expect(mutation.mutate).toHaveBeenCalledOnce())
  })

  it('submits the revision that the editor opened against instead of adopting a newer publication', async () => {
    const user = userEvent.setup()
    const activeProject = projectWithBox()
    const newerProject = { ...activeProject, revisionId: 'revision-newer' }
    const mutate = vi.fn(async (_request: Parameters<ProjectV5AtomicMutationPort['mutate']>[0]) => {
      throw new Error('PROJECT_ACTIVE_REVISION_CHANGED')
    })
    const view = render(<BindingEditorDialogV1
      activeProject={activeProject}
      browseSessionAvailable={() => false}
      createMappingId={() => 'mapping-box-pose'}
      mutations={{ readPublished: () => published(newerProject), mutate }}
      nodeAddressResolver={{ resolve: vi.fn() }}
      onClose={vi.fn()}
      target={{ type: 'entity-frame', entityId: 'box', frameId: 'box-motion' }}
    />)
    view.rerender(<BindingEditorDialogV1
      activeProject={newerProject}
      browseSessionAvailable={() => false}
      createMappingId={() => 'mapping-box-pose'}
      mutations={{ readPublished: () => published(newerProject), mutate }}
      nodeAddressResolver={{ resolve: vi.fn() }}
      onClose={vi.fn()}
      target={{ type: 'entity-frame', entityId: 'box', frameId: 'box-motion' }}
    />)
    await user.clear(screen.getByLabelText('Namespace URI'))
    await user.type(screen.getByLabelText('Namespace URI'), 'urn:virtual-plc')
    await user.type(screen.getByLabelText('Identifier'), 'ObjectPos')
    await user.click(screen.getByRole('button', { name: 'Save Binding' }))
    await waitFor(() => expect(mutate).toHaveBeenCalledOnce())
    expect(mutate.mock.calls[0]?.[0].expectedRevisionId).toBe(activeProject.revisionId)
    expect(await screen.findByRole('alert')).toHaveTextContent('PROJECT_ACTIVE_REVISION_CHANGED')
  })
})
