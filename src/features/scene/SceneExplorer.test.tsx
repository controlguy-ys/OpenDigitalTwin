import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { SceneExplorer } from './SceneExplorer'
import { TEST_SCENE_ENTITIES, testSceneRuntime } from './scene-ui-test-fixtures'

describe('SceneExplorer', () => {
  it('shows the actual hierarchy and routes persisted visibility and selection', async () => {
    const user = userEvent.setup()
    const setVisible = vi.fn(async () => undefined)
    const onSelect = vi.fn()
    render(
      <SceneExplorer
        commands={{ setVisible }}
        onDelete={vi.fn()}
        onIsolate={vi.fn()}
        onSelect={onSelect}
        onShowAll={vi.fn()}
        runtime={testSceneRuntime()}
        selectedEntityId={null}
      />,
    )

    const group = screen.getByRole('treeitem', { name: 'Fixture Group' })
    expect(group).toHaveAttribute('aria-expanded', 'true')
    expect(group).toContainElement(screen.getByRole('treeitem', { name: 'Cup' }))
    expect(screen.getByRole('treeitem', { name: 'Assembly Robot' })).toBeVisible()
    expect(screen.getByRole('treeitem', { name: 'Linear Axis' })).toBeVisible()

    await user.click(screen.getByRole('button', { name: 'Select Fixture Group' }))
    expect(onSelect).toHaveBeenCalledWith('group:fixture')

    await user.click(screen.getByRole('button', { name: 'Hide Fixture Group' }))
    expect(setVisible).toHaveBeenCalledWith('group:fixture', false)
    await user.click(screen.getByRole('button', { name: 'Show Workbench' }))
    expect(setVisible).toHaveBeenCalledWith('equipment:workbench', true)
  })

  it('keeps isolate session-only and bounds tree scrolling inside the sidebar', async () => {
    const user = userEvent.setup()
    const onShowAll = vi.fn()
    const { container } = render(
      <SceneExplorer
        commands={{ setVisible: vi.fn(async () => undefined) }}
        onDelete={vi.fn()}
        onIsolate={vi.fn()}
        onSelect={vi.fn()}
        onShowAll={onShowAll}
        runtime={testSceneRuntime()}
        selectedEntityId="group:fixture"
      />,
    )

    expect(container.firstElementChild).toHaveStyle({ minHeight: '0', overflow: 'hidden' })
    expect(screen.getByTestId('scene-tree-scroll')).toHaveStyle({ minHeight: '0', overflow: 'auto' })
    expect(screen.getByRole('treeitem', { name: 'Fixture Group' })).toHaveAttribute('aria-selected', 'true')
    await user.click(screen.getByRole('button', { name: 'Show All' }))
    expect(onShowAll).toHaveBeenCalledTimes(1)
  })

  it('routes tree deletion through the same injected safe boundary', async () => {
    const user = userEvent.setup()
    const onDelete = vi.fn(async () => undefined)
    render(
      <SceneExplorer
        commands={{ setVisible: vi.fn(async () => undefined) }}
        onDelete={onDelete}
        onIsolate={vi.fn()}
        onSelect={vi.fn()}
        onShowAll={vi.fn()}
        runtime={testSceneRuntime()}
        selectedEntityId={null}
      />,
    )

    fireEvent.contextMenu(screen.getByRole('treeitem', { name: 'Cup' }))
    await user.click(screen.getByRole('menuitem', { name: 'Delete' }))
    await user.click(screen.getByRole('button', { name: 'Delete Entity' }))

    expect(onDelete).toHaveBeenCalledWith('object:cup-1')
  })

  it('supports minimal tree keyboard navigation and activation', () => {
    const onSelect = vi.fn()
    render(
      <SceneExplorer
        commands={{ setVisible: vi.fn(async () => undefined) }}
        onDelete={vi.fn()}
        onIsolate={vi.fn()}
        onSelect={onSelect}
        onShowAll={vi.fn()}
        runtime={testSceneRuntime()}
        selectedEntityId={null}
      />,
    )

    const robot = screen.getByRole('treeitem', { name: 'Assembly Robot' })
    const group = screen.getByRole('treeitem', { name: 'Fixture Group' })
    const cup = screen.getByRole('treeitem', { name: 'Cup' })
    const axis = screen.getByRole('treeitem', { name: 'Linear Axis' })
    robot.focus()
    fireEvent.keyDown(robot, { key: 'ArrowDown' })
    expect(group).toHaveFocus()
    fireEvent.keyDown(group, { key: 'ArrowRight' })
    expect(cup).toHaveFocus()
    fireEvent.keyDown(cup, { key: 'ArrowLeft' })
    expect(group).toHaveFocus()
    fireEvent.keyDown(group, { key: 'End' })
    expect(axis).toHaveFocus()
    fireEvent.keyDown(axis, { key: 'Home' })
    expect(robot).toHaveFocus()
    fireEvent.keyDown(robot, { key: 'Enter' })
    expect(onSelect).toHaveBeenCalledWith('robot:active')
  })

  it('opens canonical context commands and toggles visibility from a focused tree row', async () => {
    const setVisible = vi.fn(async () => undefined)
    render(
      <SceneExplorer
        commands={{ setVisible }}
        onDelete={vi.fn()}
        onIsolate={vi.fn()}
        onSelect={vi.fn()}
        onShowAll={vi.fn()}
        runtime={testSceneRuntime()}
        selectedEntityId={null}
      />,
    )

    const cup = screen.getByRole('treeitem', { name: 'Cup' })
    cup.focus()
    fireEvent.keyDown(cup, { key: 'v' })
    expect(setVisible).toHaveBeenCalledTimes(1)
    expect(setVisible).toHaveBeenCalledWith('object:cup-1', false)

    fireEvent.keyDown(cup, { key: 'F10', shiftKey: true })
    expect(screen.getByRole('menu', { name: 'Cup commands' })).toBeVisible()
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' })
    expect(cup).toHaveFocus()

    fireEvent.keyDown(cup, { key: 'ContextMenu' })
    expect(screen.getByRole('menu', { name: 'Cup commands' })).toBeVisible()
  })

  it('ignores command-modified V while allowing plain and Shift V visibility shortcuts', () => {
    const setVisible = vi.fn(async () => undefined)
    render(
      <SceneExplorer
        commands={{ setVisible }}
        onDelete={vi.fn()}
        onIsolate={vi.fn()}
        onSelect={vi.fn()}
        onShowAll={vi.fn()}
        runtime={testSceneRuntime()}
        selectedEntityId={null}
      />,
    )

    const cup = screen.getByRole('treeitem', { name: 'Cup' })
    cup.focus()
    fireEvent.keyDown(cup, { key: 'v', ctrlKey: true })
    fireEvent.keyDown(cup, { key: 'v', altKey: true })
    fireEvent.keyDown(cup, { key: 'v', metaKey: true })
    expect(setVisible).not.toHaveBeenCalled()

    fireEvent.keyDown(cup, { key: 'V', shiftKey: true })
    fireEvent.keyDown(cup, { key: 'v' })
    expect(setVisible).toHaveBeenCalledTimes(2)
    expect(setVisible).toHaveBeenNthCalledWith(1, 'object:cup-1', false)
    expect(setVisible).toHaveBeenNthCalledWith(2, 'object:cup-1', false)
  })

  it('recovers roving focus when the focused Entity disappears after publication', async () => {
    const props = {
      commands: { setVisible: vi.fn(async () => undefined) },
      onDelete: vi.fn(),
      onIsolate: vi.fn(),
      onSelect: vi.fn(),
      onShowAll: vi.fn(),
      selectedEntityId: null,
    }
    const view = render(<SceneExplorer {...props} runtime={testSceneRuntime()} />)
    const cup = screen.getByRole('treeitem', { name: 'Cup' })
    cup.focus()

    view.rerender(
      <SceneExplorer
        {...props}
        runtime={testSceneRuntime(
          TEST_SCENE_ENTITIES.filter(({ id }) => id !== 'object:cup-1'),
        )}
      />,
    )

    const robot = screen.getByRole('treeitem', { name: 'Assembly Robot' })
    await waitFor(() => expect(robot).toHaveAttribute('tabindex', '0'))
    expect(robot).toHaveFocus()
  })

  it('positions the context menu at the pointer and reports visibility failures', async () => {
    const user = userEvent.setup()
    const setVisible = vi.fn(async () => {
      throw new Error('visibility publish failed')
    })
    render(
      <SceneExplorer
        commands={{ setVisible }}
        onDelete={vi.fn()}
        onIsolate={vi.fn()}
        onSelect={vi.fn()}
        onShowAll={vi.fn()}
        runtime={testSceneRuntime()}
        selectedEntityId={null}
      />,
    )

    const cup = screen.getByRole('treeitem', { name: 'Cup' })
    fireEvent.contextMenu(cup, { clientX: 90, clientY: 110 })
    expect(screen.getByRole('menu')).toHaveStyle({ left: '90px', top: '110px' })

    await user.click(screen.getByRole('button', { name: 'Hide Assembly Robot' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('visibility publish failed')
  })
})
