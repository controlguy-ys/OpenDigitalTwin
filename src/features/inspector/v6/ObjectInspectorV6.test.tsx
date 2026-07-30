import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { makeMinimalWorkcellProjectV5 } from '../../../core/project-v5/test-support.js'
import type { WorkcellProjectV5 } from '../../../core/project-v5/index.js'
import { ObjectInspectorV6 } from './ObjectInspectorV6.js'

function projectWithObject(): WorkcellProjectV5 {
  const project = structuredClone(makeMinimalWorkcellProjectV5())
  ;(project.spatialEntities as unknown as unknown[]).push({
    id: 'box', name: 'Box', geometry: { kind: 'box', dimensionsM: [0.1, 0.2, 0.3], color: '#808080' },
    parentFrameId: 'world', localPose: { positionM: [1, 2, 3], quaternion: [0, 0, 0, 1] }, visible: true,
    groupId: null, removable: true, transformOwner: 'manual',
    numericStatus: { value: 5, sourceOwnership: 'manual', overlay: { visible: false, frameId: null } },
    graspable: false, graspFrames: [], movingFrames: [],
  })
  return project
}

describe('ObjectInspectorV6', () => {
  it('keeps a manual transform draft through collapse and parent rerender, then mutates only the selected Object', () => {
    const project = projectWithObject()
    const mutate = vi.fn<(request: { readonly expectedRevisionId: string; readonly recipe: (candidate: WorkcellProjectV5) => WorkcellProjectV5 }) => Promise<void>>(() => Promise.resolve())
    const { rerender } = render(<ObjectInspectorV6 entityId="box" mutations={{ readPublished: () => ({ project, revisionId: project.revisionId }), mutate }} project={project} />)

    fireEvent.change(screen.getByLabelText('X (m)'), { target: { value: '4' } })
    fireEvent.click(screen.getByRole('button', { name: 'Transform' }))
    fireEvent.click(screen.getByRole('button', { name: 'Transform' }))
    rerender(<ObjectInspectorV6 entityId="box" mutations={{ readPublished: () => ({ project, revisionId: project.revisionId }), mutate }} project={project} />)
    expect(screen.getByLabelText('X (m)')).toHaveValue(4)

    fireEvent.click(screen.getByRole('button', { name: 'Apply Transform' }))
    expect(mutate).toHaveBeenCalledTimes(1)
    const request = mutate.mock.calls[0]![0]
    expect(request.expectedRevisionId).toBe(project.revisionId)
    expect(request.recipe(project).spatialEntities.find((entity: { id: string }) => entity.id === 'box')!.localPose.positionM).toEqual([4, 2, 3])
  })

  it('renders legacy Object communications and opens its status binding without writing', () => {
    const project = projectWithObject()
    const openBinding = vi.fn()
    render(<ObjectInspectorV6 entityId="box" onOpenBinding={openBinding} project={project} />)

    expect(screen.getByText('Disabled · 0 mappings')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Open Binding' }))
    expect(openBinding).toHaveBeenCalledWith({ type: 'entity-status', entityId: 'box' })
  })

  it('rejects a blank Transform draft without creating a mutation', () => {
    const project = projectWithObject()
    const mutate = vi.fn(() => Promise.resolve())
    render(<ObjectInspectorV6 entityId="box" mutations={{ readPublished: () => ({ project, revisionId: project.revisionId }), mutate }} project={project} />)

    fireEvent.change(screen.getByLabelText('X (m)'), { target: { value: '' } })
    fireEvent.click(screen.getByRole('button', { name: 'Apply Transform' }))
    expect(mutate).not.toHaveBeenCalled()
  })
})
