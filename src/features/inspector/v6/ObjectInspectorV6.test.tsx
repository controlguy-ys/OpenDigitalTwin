import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import type { SpatialEntityV5, WorkcellProjectV5 } from '../../../core/project-v5/index.js'
import { makeMinimalWorkcellProjectV5 } from '../../../core/project-v5/test-support.js'
import { ObjectInspectorV6 } from './ObjectInspectorV6.js'

type MutationRequest = { readonly expectedRevisionId: string; readonly recipe: (project: WorkcellProjectV5) => WorkcellProjectV5 }

function box(overrides: Partial<SpatialEntityV5> = {}): SpatialEntityV5 {
  return {
    id: 'box', name: 'Box', geometry: { kind: 'box', dimensionsM: [0.1, 0.2, 0.3], color: '#808080' },
    parentFrameId: 'world', localPose: { positionM: [1, 2, 3], quaternion: [0, 0, 0, 1] }, visible: true,
    groupId: null, removable: true, transformOwner: 'manual',
    numericStatus: { value: 5, sourceOwnership: 'manual', overlay: { visible: false, frameId: null } },
    graspable: false, graspFrames: [], movingFrames: [], ...overrides,
  }
}

function projectWithObject(entity = box()): WorkcellProjectV5 {
  const base = makeMinimalWorkcellProjectV5()
  return { ...base, spatialEntities: [...base.spatialEntities, entity] }
}

function mutationPort(project: WorkcellProjectV5) {
  const mutate = vi.fn<(request: MutationRequest) => Promise<void>>(() => Promise.resolve())
  return { mutate, port: { readPublished: () => ({ project, revisionId: project.revisionId }), mutate } }
}

describe('ObjectInspectorV6', () => {
  it('keeps a manual Transform draft through collapse and parent rerender, then mutates only the selected Object', () => {
    const project = projectWithObject()
    const { mutate, port } = mutationPort(project)
    const { rerender } = render(<ObjectInspectorV6 entityId="box" mutations={port} project={project} />)
    fireEvent.change(screen.getByLabelText('X (m)'), { target: { value: '4' } })
    const disclosure = screen.getByText('Transform', { selector: 'summary' })
    fireEvent.click(disclosure)
    expect(disclosure.parentElement).not.toHaveAttribute('open')
    fireEvent.click(disclosure)
    expect(disclosure.parentElement).toHaveAttribute('open')
    rerender(<ObjectInspectorV6 entityId="box" mutations={port} project={project} />)
    expect(screen.getByLabelText('X (m)')).toHaveValue(4)
    fireEvent.click(screen.getByRole('button', { name: 'Apply Transform' }))
    const request = mutate.mock.calls[0]?.[0]
    expect(request?.expectedRevisionId).toBe(project.revisionId)
    expect(request?.recipe(project).spatialEntities.find((entity) => entity.id === 'box')?.localPose.positionM).toEqual([4, 2, 3])
  })

  it('resets a Transform draft when its published revision changes', () => {
    const project = projectWithObject()
    const { rerender } = render(<ObjectInspectorV6 entityId="box" project={project} />)
    fireEvent.change(screen.getByLabelText('X (m)'), { target: { value: '4' } })
    const revised = projectWithObject(box({ localPose: { positionM: [9, 2, 3], quaternion: [0, 0, 0, 1] } }))
    rerender(<ObjectInspectorV6 entityId="box" project={{ ...revised, revisionId: 'revision-2' }} />)
    expect(screen.getByLabelText('X (m)')).toHaveValue(9)
  })

  it('disables non-manual Transform authoring with its ownership explanation', () => {
    const project = projectWithObject(box({ transformOwner: 'simulation' }))
    render(<ObjectInspectorV6 entityId="box" project={project} />)
    expect(screen.getByLabelText('X (m)')).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Apply Transform' })).toBeDisabled()
    expect(screen.getAllByText(/Simulation owns this Transform/u)).not.toHaveLength(0)
  })

  it('rejects blank, non-finite, and unchanged Transform drafts without reading or mutating', () => {
    const project = projectWithObject()
    const { mutate, port } = mutationPort(project)
    const readPublished = vi.fn(port.readPublished)
    render(<ObjectInspectorV6 entityId="box" mutations={{ ...port, readPublished }} project={project} />)
    fireEvent.click(screen.getByRole('button', { name: 'Apply Transform' }))
    fireEvent.change(screen.getByLabelText('X (m)'), { target: { value: '' } })
    fireEvent.click(screen.getByRole('button', { name: 'Apply Transform' }))
    fireEvent.change(screen.getByLabelText('X (m)'), { target: { value: 'NaN' } })
    fireEvent.click(screen.getByRole('button', { name: 'Apply Transform' }))
    expect(readPublished).not.toHaveBeenCalled()
    expect(mutate).not.toHaveBeenCalled()
  })

  it('uses legacy Object comms, enable-only, disable, and tag-only recipes without an OPC UA write', () => {
    const project = projectWithObject()
    const { mutate, port } = mutationPort(project)
    const openBinding = vi.fn()
    const { rerender } = render(<ObjectInspectorV6 entityId="box" mutations={port} onOpenBinding={openBinding} project={project} />)
    expect(screen.getByText('Disabled · 0 mappings')).toBeInTheDocument()
    fireEvent.click(screen.getByLabelText('Enable Object communications'))
    expect(mutate.mock.calls[0]?.[0].recipe(project).spatialEntities.find((entity) => entity.id === 'box')?.enableComms).toBe(true)
    fireEvent.change(screen.getByLabelText('Display tag'), { target: { value: 'Shared tag' } })
    fireEvent.blur(screen.getByLabelText('Display tag'))
    expect(mutate.mock.calls[1]?.[0].recipe(project).spatialEntities.find((entity) => entity.id === 'box')?.tagName).toBe('Shared tag')
    const enabled = projectWithObject(box({ enableComms: true }))
    rerender(<ObjectInspectorV6 entityId="box" mutations={port} onOpenBinding={openBinding} project={{ ...enabled, revisionId: 'revision-2' }} />)
    fireEvent.click(screen.getByLabelText('Enable Object communications'))
    expect(mutate.mock.calls[2]?.[0].recipe(enabled).spatialEntities.find((entity) => entity.id === 'box')?.enableComms).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: 'Open Binding' }))
    expect(openBinding).toHaveBeenCalledWith({ type: 'entity-status', entityId: 'box' })
  })
})
