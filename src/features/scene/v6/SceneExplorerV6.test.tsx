import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
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
    const disclosure = screen.getByRole('button', { name: 'Collapse Fixtures' })
    expect(disclosure).toHaveAttribute('aria-expanded', 'true')
    expect(disclosure.textContent).toBe('')
    fireEvent.click(disclosure)
    expect(disclosure).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('treeitem', { name: /Searchable workpiece/u })).toBeNull()

    const search = screen.getByRole('searchbox', { name: 'Search scene' })
    fireEvent.change(search, { target: { value: 'workpiece' } })
    const filteredFixtures = screen.getByRole('treeitem', { name: /Fixtures/u })
    const filteredDisclosure = screen.getByRole('button', { name: 'Collapse Fixtures' })
    expect(filteredFixtures).toBeVisible()
    expect(screen.getByRole('treeitem', { name: /Searchable workpiece/u })).toBeVisible()
    expect(filteredFixtures).toHaveAttribute('aria-expanded', 'true')
    expect(filteredDisclosure).toHaveAttribute('aria-expanded', 'true')
    expect(filteredDisclosure).toBeDisabled()
    expect(filteredDisclosure).toHaveAttribute('title', 'Expansion is fixed while filtering')
    fireEvent.change(search, { target: { value: '' } })
    expect(fixtures).toHaveAttribute('aria-expanded', 'false')
    const restoredDisclosure = screen.getByRole('button', { name: 'Expand Fixtures' })
    expect(restoredDisclosure).toHaveAttribute('aria-expanded', 'false')
    expect(restoredDisclosure).not.toBeDisabled()
    expect(screen.queryByRole('treeitem', { name: /Searchable workpiece/u })).toBeNull()
  })

  it('renders visibility icon controls without visible action text and preserves their pointer action', async () => {
    const user = userEvent.setup()
    const onToggleVisibility = vi.fn()
    const hiddenProject = project()
    render(<SceneExplorerV6
      onSelectionChange={vi.fn()}
      onToggleVisibility={onToggleVisibility}
      project={{ ...hiddenProject, robots: hiddenProject.robots.map((robot) => ({ ...robot, visible: false })) }}
      selection={null}
    />)

    const visibility = screen.getByRole('button', { name: 'Show Robot 1' })
    expect(visibility.textContent).toBe('')
    expect(visibility).toHaveAccessibleName('Show Robot 1')
    await user.click(visibility)
    expect(onToggleVisibility).toHaveBeenCalledExactlyOnceWith({ kind: 'robot', id: 'robot-1' }, true)
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

  it('navigates and requests a context menu for the focused row instead of a stale active row', () => {
    const onContextMenu = vi.fn()
    render(<SceneExplorerV6 onContextMenu={onContextMenu} onSelectionChange={vi.fn()} project={project()} selection={null} />)
    const object = screen.getByRole('treeitem', { name: /Searchable workpiece/u })
    const world = screen.getByRole('treeitem', { name: /World/u })
    const mcp = screen.getByRole('treeitem', { name: /MCP/u })
    fireEvent.click(object)
    world.focus()
    fireEvent.keyDown(world, { key: 'ArrowDown' })
    expect(mcp).toHaveFocus()
    fireEvent.keyDown(mcp, { key: 'F10', shiftKey: true })
    expect(onContextMenu).toHaveBeenCalledWith(expect.objectContaining({ kind: 'frame', id: 'mcp' }))
  })

  it('lets a nested visibility button handle Space once and use its containing row target', async () => {
    const user = userEvent.setup()
    const onToggleVisibility = vi.fn()
    const onContextMenu = vi.fn()
    render(<SceneExplorerV6
      onContextMenu={onContextMenu}
      onSelectionChange={vi.fn()}
      onToggleVisibility={onToggleVisibility}
      project={project()}
      selection={null}
    />)
    await user.click(screen.getByRole('treeitem', { name: /Searchable workpiece/u }))
    const robotVisibility = screen.getByRole('button', { name: 'Hide Robot 1' })
    expect(robotVisibility.textContent).toBe('')
    expect(robotVisibility).toHaveAccessibleName('Hide Robot 1')
    robotVisibility.focus()
    await user.keyboard(' ')
    expect(onToggleVisibility).toHaveBeenCalledExactlyOnceWith({ kind: 'robot', id: 'robot-1' }, false)
    fireEvent.keyDown(robotVisibility, { key: 'F10', shiftKey: true })
    expect(onContextMenu).toHaveBeenLastCalledWith(expect.objectContaining({ kind: 'robot', id: 'robot-1' }))
  })
})
