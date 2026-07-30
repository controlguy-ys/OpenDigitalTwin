import { act, fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import type { SpatialEntityV5, WorkcellProjectV5 } from '../../../core/project-v5/index.js'
import { makeMinimalWorkcellProjectV5 } from '../../../core/project-v5/test-support.js'
import { ApplicationShellV6 } from '../../ui/v6/ApplicationShellV6.js'
import { createWorkspaceLayoutStoreV6 } from '../../ui/v6/workspace-layout-store-v6.js'
import { SelectionInspectorV6 } from './SelectionInspectorV6.js'

function projectWithObject(): WorkcellProjectV5 {
  const base = makeMinimalWorkcellProjectV5()
  const entity: SpatialEntityV5 = {
    id: 'box', name: 'Box', geometry: { kind: 'box', dimensionsM: [0.1, 0.2, 0.3], color: '#808080' },
    parentFrameId: 'world', localPose: { positionM: [1, 2, 3], quaternion: [0, 0, 0, 1] }, visible: true,
    groupId: null, removable: true, transformOwner: 'manual',
    numericStatus: { value: 5, sourceOwnership: 'manual', overlay: { visible: false, frameId: null } },
    graspable: false, graspFrames: [], movingFrames: [],
  }
  return { ...base, spatialEntities: [...base.spatialEntities, entity] }
}

describe('SelectionInspectorV6 shell integration', () => {
  it('keeps an Object draft and the Canvas node through Inspector collapse and resize', () => {
    const project = projectWithObject()
    const store = createWorkspaceLayoutStoreV6({ storage: null })
    render(<ApplicationShellV6
      bottom={<div>Bottom</div>}
      explorer={<div>Explorer</div>}
      header={<div>Header</div>}
      inspector={<SelectionInspectorV6 project={project} selection={{ kind: 'entity', id: 'box' }} />}
      store={store}
      toolbox={<div>Toolbox</div>}
      viewport={<div data-testid="canvas-node">Canvas</div>}
      workspaceHeightPx={800}
      workspaceWidthPx={1440}
    />)

    const canvas = screen.getByTestId('canvas-node')
    fireEvent.change(screen.getByLabelText('X (m)'), { target: { value: '4' } })
    act(() => {
      store.getState().setDockVisible('wide', 'inspector', false)
      store.getState().setDockSize('inspector', 420)
      store.getState().setDockVisible('wide', 'inspector', true)
    })
    expect(screen.getByLabelText('X (m)')).toHaveValue(4)
    expect(screen.getByTestId('canvas-node')).toBe(canvas)
  })
})
