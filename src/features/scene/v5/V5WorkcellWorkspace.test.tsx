import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { validateWorkcellProjectV5, type WorkcellProjectV5 } from '../../../core/project-v5/index.js'
import { makeMinimalWorkcellProjectV5 } from '../../../core/project-v5/test-support.js'
import { V5WorkcellWorkspace } from './V5WorkcellWorkspace.js'

function project(): WorkcellProjectV5 {
  const base = makeMinimalWorkcellProjectV5()
  return validateWorkcellProjectV5({
    ...base,
    spatialEntities: [{
      id: 'box',
      name: 'Workpiece',
      geometry: { kind: 'box', dimensionsM: [0.2, 0.2, 0.2], color: '#38bdf8' },
      parentFrameId: 'mcp',
      localPose: { positionM: [0, 0, 0.1], quaternion: [0, 0, 0, 1] },
      visible: true,
      groupId: null,
      removable: true,
      transformOwner: 'manual',
      numericStatus: { value: 0, sourceOwnership: 'manual', overlay: { visible: true, frameId: null } },
      graspable: false,
      graspFrames: [],
      movingFrames: [],
    }],
  })
}

describe('V5WorkcellWorkspace', () => {
  it('keeps binding available for a selected Object even before runtime activation', () => {
    const onOpenBinding = vi.fn()
    render(<V5WorkcellWorkspace
      bundle={null}
      onOpenBinding={onOpenBinding}
      onSelect={vi.fn()}
      project={project()}
      selection={{ kind: 'entity', id: 'box' }}
    />)
    fireEvent.click(screen.getByRole('button', { name: 'Open Binding…' }))
    expect(onOpenBinding).toHaveBeenCalledWith({ type: 'entity-status', entityId: 'box' })
    expect(screen.getByText('Project runtime is not active.')).toBeInTheDocument()
  })
})
