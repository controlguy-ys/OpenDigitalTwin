import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { SceneCommandService } from './scene-command-service'
import { SceneContextMenu } from './SceneContextMenu'
import { testSceneRuntime } from './scene-ui-test-fixtures'

function commands() {
  return {
    createBox: vi.fn(async () => 'object:box-1' as const),
    createCylinder: vi.fn(async () => 'object:cylinder-1' as const),
    createGroup: vi.fn(async () => 'group:new' as const),
    deleteEntity: vi.fn(async () => undefined),
    deleteGroupAndContents: vi.fn(async () => undefined),
    duplicateObject: vi.fn(async () => 'object:copy' as const),
    rename: vi.fn(async () => undefined),
    reparent: vi.fn(async () => undefined),
    setLocalPose: vi.fn(async () => undefined),
    setTransformSource: vi.fn(async () => undefined),
    setVisible: vi.fn(async () => undefined),
    ungroup: vi.fn(async () => undefined),
  } satisfies Pick<SceneCommandService,
    | 'createBox' | 'createCylinder' | 'createGroup' | 'deleteEntity'
    | 'deleteGroupAndContents' | 'duplicateObject' | 'rename' | 'reparent'
    | 'setLocalPose' | 'setTransformSource' | 'setVisible' | 'ungroup'>
}

describe('SceneContextMenu', () => {
  it('keeps the empty viewport menu limited to commands implemented in Task 3', async () => {
    const user = userEvent.setup()
    const service = commands()
    render(
      <SceneContextMenu
        commands={service}
        entityId={null}
        onIsolate={vi.fn()}
        runtime={testSceneRuntime()}
      />,
    )

    expect(screen.getAllByRole('menuitem').map((item) => item.textContent)).toEqual([
      'Create Group', 'Create Box', 'Create Cylinder',
    ])
    expect(screen.queryByRole('menuitem', { name: 'Fit All' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('menuitem', { name: 'Create Box' }))
    expect(service.createBox).toHaveBeenCalledTimes(1)
  })

  it('filters Robot commands and exposes only existing dedicated surfaces', () => {
    render(
      <SceneContextMenu
        commands={commands()}
        entityId="robot:active"
        onIsolate={vi.fn()}
        onOpenRobotCollision={vi.fn()}
        onOpenRobotGeometry={vi.fn()}
        onOpenRobotMechanics={vi.fn()}
        runtime={testSceneRuntime()}
      />,
    )

    expect(screen.getByRole('menuitem', { name: 'Copy Base Transform' })).toBeVisible()
    expect(screen.getByRole('menuitem', { name: 'Open Mechanics' })).toBeVisible()
    expect(screen.queryByRole('menuitem', { name: /Attach/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: /Delete/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: /Focus/ })).not.toBeInTheDocument()
  })

  it('requires confirmation before destructive Object and Group commands', async () => {
    const user = userEvent.setup()
    const service = commands()
    const view = render(
      <SceneContextMenu
        commands={service}
        entityId="object:cup-1"
        onIsolate={vi.fn()}
        runtime={testSceneRuntime()}
      />,
    )
    await user.click(screen.getByRole('menuitem', { name: 'Delete' }))
    expect(service.deleteEntity).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog', { name: 'Delete Entity?' })).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Delete Entity' }))
    expect(service.deleteEntity).toHaveBeenCalledWith('object:cup-1')

    view.rerender(
      <SceneContextMenu
        commands={service}
        entityId="group:fixture"
        onIsolate={vi.fn()}
        runtime={testSceneRuntime()}
      />,
    )
    await user.click(screen.getByRole('menuitem', { name: 'Ungroup' }))
    expect(service.ungroup).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog', { name: 'Ungroup with children?' })).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Ungroup Children' }))
    expect(service.ungroup).toHaveBeenCalledWith('group:fixture')
  })

  it('confirms and persists OPC UA-to-Manual ownership before grouping', async () => {
    const user = userEvent.setup()
    const service = commands()
    render(
      <SceneContextMenu
        commands={service}
        entityId="object:live-part"
        onIsolate={vi.fn()}
        runtime={testSceneRuntime()}
      />,
    )

    await user.click(screen.getByRole('menuitem', { name: 'Move to group' }))
    expect(service.setTransformSource).not.toHaveBeenCalled()
    expect(service.reparent).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog', { name: 'Switch transform source?' })).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Switch to Manual' }))
    expect(service.setTransformSource).toHaveBeenCalledWith('object:live-part', 'manual')
    expect(service.reparent).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Move to Fixture Group' }))
    expect(service.reparent).toHaveBeenCalledWith('object:live-part', 'group:fixture')
    expect(service.setTransformSource.mock.invocationCallOrder[0]).toBeLessThan(
      service.reparent.mock.invocationCallOrder[0]!,
    )
  })
})
