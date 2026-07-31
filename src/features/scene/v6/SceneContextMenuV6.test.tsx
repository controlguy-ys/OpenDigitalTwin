import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import type { WorkcellProjectV5 } from '../../../core/project-v5/index.js'
import { makeMinimalWorkcellProjectV5 } from '../../../core/project-v5/test-support.js'
import { SceneContextMenuV6, resolveSceneContextTargetV6, sceneContextActionsForTargetV6 } from './SceneContextMenuV6.js'

function project(): WorkcellProjectV5 {
  const base = makeMinimalWorkcellProjectV5()
  return { ...base, sceneGroups: [{ id: 'empty', name: 'Empty', parentGroupId: null, visible: true }], spatialEntities: [{
    id: 'locked', name: 'Locked object', geometry: { kind: 'box', dimensionsM: [0.1, 0.1, 0.1], color: '#38bdf8' }, parentFrameId: 'mcp', localPose: { positionM: [0, 0, 0], quaternion: [0, 0, 0, 1] }, visible: true, groupId: null, removable: false, transformOwner: 'manual', numericStatus: { value: 0, sourceOwnership: 'manual', overlay: { visible: false, frameId: null } }, graspable: false, graspFrames: [], movingFrames: [],
  }] }
}

describe('SceneContextMenuV6', () => {
  it('resolves the exact typed action matrix identically for Explorer and viewport targets', () => {
    const source = project()
    const targets = [
      resolveSceneContextTargetV6(source, { kind: 'robot', id: 'robot-1' }),
      resolveSceneContextTargetV6(source, { kind: 'entity', id: 'locked' }),
      resolveSceneContextTargetV6(source, { kind: 'group', id: 'empty' }),
      resolveSceneContextTargetV6(source, { kind: 'frame', id: 'mcp' }),
      resolveSceneContextTargetV6(source, null),
    ]
    expect(targets.map((target) => sceneContextActionsForTargetV6(target).map(({ id }) => id))).toEqual([
      ['focus', 'translate-base', 'rotate-base', 'toggle-visibility', 'open-binding', 'rename'],
      ['focus', 'translate', 'rotate', 'toggle-visibility', 'duplicate', 'open-binding', 'rename'],
      ['toggle-visibility', 'rename', 'delete'],
      ['focus'],
      ['add-box', 'add-cylinder', 'fit-all'],
    ])
  })

  it('renders one shared resolved menu on both surfaces and Open Binding only navigates', () => {
    const onAction = vi.fn()
    const target = resolveSceneContextTargetV6(project(), { kind: 'robot', id: 'robot-1' })
    const { rerender } = render(<SceneContextMenuV6 onAction={onAction} surface="explorer" target={target} />)
    expect(screen.getByRole('menu', { name: 'Scene actions' })).toHaveAttribute('data-surface', 'explorer')
    fireEvent.click(screen.getByRole('menuitem', { name: 'Open Binding' }))
    expect(onAction).toHaveBeenCalledWith('open-binding', target)
    rerender(<SceneContextMenuV6 onAction={onAction} surface="viewport" target={target} />)
    expect(screen.getByRole('menu', { name: 'Scene actions' })).toHaveAttribute('data-surface', 'viewport')
    expect(screen.getByRole('menuitem', { name: 'Translate Base' })).toBeVisible()
  })
})
