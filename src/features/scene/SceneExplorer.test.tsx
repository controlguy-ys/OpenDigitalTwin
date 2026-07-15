import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { SceneExplorer } from './SceneExplorer'
import { testSceneRuntime } from './scene-ui-test-fixtures'

describe('SceneExplorer', () => {
  it('shows the actual hierarchy and routes persisted visibility and selection', async () => {
    const user = userEvent.setup()
    const setVisible = vi.fn(async () => undefined)
    const onSelect = vi.fn()
    render(
      <SceneExplorer
        commands={{ setVisible }}
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
})
