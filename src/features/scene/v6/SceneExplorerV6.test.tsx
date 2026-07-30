import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import type { WorkcellProjectV5 } from '../../../core/project-v5/index.js'
import { makeMinimalWorkcellProjectV5 } from '../../../core/project-v5/test-support.js'
import { SceneExplorerV6 } from './SceneExplorerV6.js'

function project(): WorkcellProjectV5 {
  const base = makeMinimalWorkcellProjectV5()
  return {
    ...base,
    sceneGroups: [
      { id: 'fixtures', name: 'Fixtures', parentGroupId: null, visible: true },
      { id: 'infeed', name: 'Infeed', parentGroupId: 'fixtures', visible: true },
    ],
    spatialEntities: [{
      id: 'box', name: 'Searchable workpiece with a deliberately long name', geometry: { kind: 'box', dimensionsM: [0.1, 0.1, 0.1], color: '#38bdf8' }, parentFrameId: 'mcp', localPose: { positionM: [0, 0, 0], quaternion: [0, 0, 0, 1] }, visible: true, groupId: 'infeed', removable: true, transformOwner: 'manual', numericStatus: { value: 0, sourceOwnership: 'manual', overlay: { visible: false, frameId: null } }, graspable: false, graspFrames: [], movingFrames: [],
    }],
  }
}

describe('SceneExplorerV6', () => {
  it('really collapses, restores local expansion after search, and retains matching ancestors', () => {
    render(<SceneExplorerV6 onSelectionChange={vi.fn()} project={project()} selection={null} />)
    const fixtures = screen.getByRole('treeitem', { name: /Fixtures/u })
    fireEvent.click(screen.getByRole('button', { name: 'Collapse Fixtures' }))
    expect(screen.queryByRole('treeitem', { name: /Searchable workpiece/u })).toBeNull()

    const search = screen.getByRole('searchbox', { name: 'Search scene' })
    fireEvent.change(search, { target: { value: 'workpiece' } })
    expect(screen.getByRole('treeitem', { name: /Fixtures/u })).toBeVisible()
    expect(screen.getByRole('treeitem', { name: /Searchable workpiece/u })).toBeVisible()
    fireEvent.change(search, { target: { value: '' } })
    expect(fixtures).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('treeitem', { name: /Searchable workpiece/u })).toBeNull()
  })

  it('uses tree keyboard semantics, pointer selection, visibility, and Shift+F10 context routing', () => {
    const onSelectionChange = vi.fn()
    const onToggleVisibility = vi.fn()
    const onContextMenu = vi.fn()
    render(<SceneExplorerV6
      onContextMenu={onContextMenu}
      onSelectionChange={onSelectionChange}
      onToggleVisibility={onToggleVisibility}
      project={project()}
      selection={null}
    />)
    const tree = screen.getByRole('tree', { name: 'Scene Explorer' })
    tree.focus()
    fireEvent.keyDown(tree, { key: 'ArrowDown' })
    fireEvent.keyDown(tree, { key: 'ArrowDown' })
    fireEvent.keyDown(tree, { key: 'Enter' })
    expect(onSelectionChange).toHaveBeenCalledWith({ kind: 'frame', id: 'mcp' })

    const object = screen.getByRole('treeitem', { name: /Searchable workpiece/u })
    fireEvent.click(object)
    fireEvent.keyDown(object, { key: ' ' })
    fireEvent.keyDown(object, { key: 'F10', shiftKey: true })
    fireEvent.contextMenu(object)
    expect(onSelectionChange).toHaveBeenLastCalledWith({ kind: 'entity', id: 'box' })
    expect(onToggleVisibility).toHaveBeenCalledWith({ kind: 'entity', id: 'box' }, false)
    expect(onContextMenu).toHaveBeenCalledTimes(2)
    expect(onContextMenu).toHaveBeenLastCalledWith(expect.objectContaining({ kind: 'object', id: 'box' }))
  })
})
