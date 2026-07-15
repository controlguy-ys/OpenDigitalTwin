import { fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderToString } from 'react-dom/server'
import type { SceneCommandService } from './scene-command-service'
import { SceneContextMenu } from './SceneContextMenu'
import { testSceneRuntime } from './scene-ui-test-fixtures'
import type { SceneEntityV1 } from '../../domain/project/scene-state-v1'

afterEach(() => vi.restoreAllMocks())

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
        onDelete={vi.fn()}
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

  it('falls back to inline overlay rendering when no document portal target exists', () => {
    vi.stubGlobal('document', undefined)
    try {
      expect(() => renderToString(
        <SceneContextMenu
          commands={commands()}
          entityId={null}
          onDelete={vi.fn()}
          onIsolate={vi.fn()}
          runtime={testSceneRuntime()}
        />,
      )).not.toThrow()
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('filters Robot commands and exposes only existing dedicated surfaces', () => {
    render(
      <SceneContextMenu
        commands={commands()}
        entityId="robot:active"
        onDelete={vi.fn()}
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
    const onDelete = vi.fn(async () => undefined)
    const view = render(
      <SceneContextMenu
        commands={service}
        entityId="object:cup-1"
        onDelete={onDelete}
        onIsolate={vi.fn()}
        runtime={testSceneRuntime()}
      />,
    )
    await user.click(screen.getByRole('menuitem', { name: 'Delete' }))
    expect(onDelete).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog', { name: 'Delete Entity?' })).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Delete Entity' }))
    expect(onDelete).toHaveBeenCalledWith('object:cup-1')

    view.rerender(
      <SceneContextMenu
        commands={service}
        entityId="group:fixture"
        onDelete={onDelete}
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

  it('delegates Object and Group deletion to the injected safe boundary', async () => {
    const user = userEvent.setup()
    const service = commands()
    const onDelete = vi.fn(async () => undefined)
    const view = render(
      <SceneContextMenu
        commands={service}
        entityId="object:cup-1"
        onDelete={onDelete}
        onIsolate={vi.fn()}
        runtime={testSceneRuntime()}
      />,
    )

    await user.click(screen.getByRole('menuitem', { name: 'Delete' }))
    await user.click(screen.getByRole('button', { name: 'Delete Entity' }))
    expect(onDelete).toHaveBeenCalledWith('object:cup-1')
    expect(service.deleteEntity).not.toHaveBeenCalled()

    view.rerender(
      <SceneContextMenu
        commands={service}
        entityId="group:fixture"
        onDelete={onDelete}
        onIsolate={vi.fn()}
        runtime={testSceneRuntime()}
      />,
    )
    await user.click(screen.getByRole('menuitem', { name: 'Delete Group and Contents' }))
    await user.click(screen.getByRole('button', { name: 'Delete Group and Contents' }))
    expect(onDelete).toHaveBeenLastCalledWith('group:fixture')
    expect(service.deleteGroupAndContents).not.toHaveBeenCalled()
  })

  it('confirms and persists OPC UA-to-Manual ownership before grouping', async () => {
    const user = userEvent.setup()
    const service = commands()
    render(
      <SceneContextMenu
        commands={service}
        entityId="object:live-part"
        onDelete={vi.fn()}
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

  it('does not expose manual transform writes for an OPC UA-owned Object', async () => {
    const user = userEvent.setup()
    const service = commands()
    const view = render(
      <SceneContextMenu
        commands={service}
        entityId="object:cup-1"
        onDelete={vi.fn()}
        onIsolate={vi.fn()}
        runtime={testSceneRuntime()}
      />,
    )
    await user.click(screen.getByRole('menuitem', { name: 'Copy Transform' }))

    view.rerender(
      <SceneContextMenu
        commands={service}
        entityId="object:live-part"
        onDelete={vi.fn()}
        onIsolate={vi.fn()}
        runtime={testSceneRuntime()}
      />,
    )

    expect(screen.queryByRole('menuitem', { name: 'Paste Transform' })).not.toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: 'Reset Transform' })).not.toBeInTheDocument()
    expect(service.setLocalPose).not.toHaveBeenCalled()
  })

  it('hides mutation commands rejected for the active Axis carriage', () => {
    const runtime = testSceneRuntime([
      {
        kind: 'linear-axis', id: 'linear-axis:active', name: 'Axis', parentId: null,
        localPose: { positionM: [0, 0, 0], quaternion: [0, 0, 0, 1] }, visible: true,
        direction: 'x', minPositionM: -1, maxPositionM: 1, homePositionM: 0,
        currentPositionM: 0, carriageEntityId: 'object:cup-1', robotEntityId: null,
      },
      {
        kind: 'object', id: 'object:cup-1', name: 'Cup', parentId: 'linear-axis:active',
        localPose: { positionM: [0, 0, 0], quaternion: [0, 0, 0, 1] }, visible: true,
        target: { kind: 'object-instance', id: 'cup-1' }, transformSource: 'manual',
      },
      {
        kind: 'group', id: 'group:fixture', name: 'Fixture', parentId: null,
        localPose: { positionM: [0, 0, 0], quaternion: [0, 0, 0, 1] }, visible: true,
      },
    ] satisfies readonly SceneEntityV1[])
    const view = render(
      <SceneContextMenu
        commands={commands()}
        entityId="object:cup-1"
        onDelete={vi.fn()}
        onIsolate={vi.fn()}
        runtime={runtime}
      />,
    )

    expect(screen.queryByRole('menuitem', { name: 'Move to group' })).not.toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: 'Delete' })).not.toBeInTheDocument()

    const groupRuntime = testSceneRuntime([
      {
        kind: 'linear-axis', id: 'linear-axis:active', name: 'Axis', parentId: null,
        localPose: { positionM: [0, 0, 0], quaternion: [0, 0, 0, 1] }, visible: true,
        direction: 'x', minPositionM: -1, maxPositionM: 1, homePositionM: 0,
        currentPositionM: 0, carriageEntityId: 'group:fixture', robotEntityId: null,
      },
      {
        kind: 'group', id: 'group:fixture', name: 'Fixture', parentId: 'linear-axis:active',
        localPose: { positionM: [0, 0, 0], quaternion: [0, 0, 0, 1] }, visible: true,
      },
      {
        kind: 'object', id: 'object:cup-1', name: 'Cup', parentId: 'group:fixture',
        localPose: { positionM: [0, 0, 0], quaternion: [0, 0, 0, 1] }, visible: true,
        target: { kind: 'object-instance', id: 'cup-1' }, transformSource: 'manual',
      },
    ] satisfies readonly SceneEntityV1[])
    view.rerender(
      <SceneContextMenu
        commands={commands()}
        entityId="group:fixture"
        onDelete={vi.fn()}
        onIsolate={vi.fn()}
        runtime={groupRuntime}
      />,
    )
    expect(screen.queryByRole('menuitem', { name: 'Ungroup' })).not.toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: 'Delete Group and Contents' }))
      .not.toBeInTheDocument()
  })

  it('positions at the pointer, focuses the first item, roves, and returns focus on Escape', async () => {
    const user = userEvent.setup()
    function Harness() {
      const [open, setOpen] = useState(false)
      return (
        <>
          <button onClick={() => setOpen(true)} type="button">Open menu</button>
          {open ? (
            <SceneContextMenu
              commands={commands()}
              entityId={null}
              onClose={() => setOpen(false)}
              onDelete={vi.fn()}
              onIsolate={vi.fn()}
              position={{ x: 120, y: 240 }}
              runtime={testSceneRuntime()}
            />
          ) : null}
        </>
      )
    }
    render(<Harness />)

    const trigger = screen.getByRole('button', { name: 'Open menu' })
    await user.click(trigger)
    const first = screen.getByRole('menuitem', { name: 'Create Group' })
    expect(first).toHaveFocus()
    expect(screen.getByRole('menu')).toHaveStyle({ left: '120px', top: '240px' })
    await user.keyboard('{ArrowDown}')
    expect(screen.getByRole('menuitem', { name: 'Create Box' })).toHaveFocus()
    await user.keyboard('{End}')
    expect(screen.getByRole('menuitem', { name: 'Create Cylinder' })).toHaveFocus()
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
  })

  it('clamps pointer placement inside the viewport', () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      bottom: 0, height: 100, left: 0, right: 0, top: 0, width: 200,
      x: 0, y: 0, toJSON: () => ({}),
    })
    render(
      <SceneContextMenu
        commands={commands()}
        entityId={null}
        onDelete={vi.fn()}
        onIsolate={vi.fn()}
        position={{ x: window.innerWidth - 10, y: window.innerHeight - 10 }}
        runtime={testSceneRuntime()}
      />,
    )

    expect(screen.getByRole('menu')).toHaveStyle({
      left: `${window.innerWidth - 200}px`,
      top: `${window.innerHeight - 100}px`,
    })
  })

  it('remeasures clamp bounds when error content expands the menu', async () => {
    const user = userEvent.setup()
    let height = 100
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(() => ({
      bottom: 0, height, left: 0, right: 0, top: 0, width: 200,
      x: 0, y: 0, toJSON: () => ({}),
    }))
    const service = commands()
    service.setVisible.mockRejectedValue(new Error('visibility failed with expanded detail'))
    render(
      <SceneContextMenu
        commands={service}
        entityId="object:cup-1"
        onDelete={vi.fn()}
        onIsolate={vi.fn()}
        position={{ x: 0, y: window.innerHeight - 10 }}
        runtime={testSceneRuntime()}
      />,
    )
    expect(screen.getByRole('menu')).toHaveStyle({ top: `${window.innerHeight - 100}px` })

    height = 220
    await user.click(screen.getByRole('menuitem', { name: 'Hide' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('expanded detail')
    expect(screen.getByRole('menu')).toHaveStyle({ top: `${window.innerHeight - 220}px` })
  })

  it('remeasures clamp bounds when ownership changes available commands', () => {
    let height = 100
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(() => ({
      bottom: 0, height, left: 0, right: 0, top: 0, width: 200,
      x: 0, y: 0, toJSON: () => ({}),
    }))
    const object = {
      kind: 'object', id: 'object:part', name: 'Part', parentId: null,
      localPose: { positionM: [0, 0, 0], quaternion: [0, 0, 0, 1] }, visible: true,
      target: { kind: 'object-instance', id: 'part' }, transformSource: 'manual',
    } as const
    const view = render(
      <SceneContextMenu
        commands={commands()}
        entityId="object:part"
        onDelete={vi.fn()}
        onIsolate={vi.fn()}
        position={{ x: 0, y: window.innerHeight - 10 }}
        runtime={testSceneRuntime([object])}
      />,
    )
    expect(screen.getByRole('menu')).toHaveStyle({ top: `${window.innerHeight - 100}px` })

    height = 160
    view.rerender(
      <SceneContextMenu
        commands={commands()}
        entityId="object:part"
        onDelete={vi.fn()}
        onIsolate={vi.fn()}
        position={{ x: 0, y: window.innerHeight - 10 }}
        runtime={testSceneRuntime([{ ...object, transformSource: 'opcua' }])}
      />,
    )
    expect(screen.getByRole('menu')).toHaveStyle({ top: `${window.innerHeight - 160}px` })
  })

  it('remeasures on viewport resize and removes the listener on unmount', () => {
    let viewportHeight = 768
    vi.spyOn(window, 'innerHeight', 'get').mockImplementation(() => viewportHeight)
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      bottom: 0, height: 100, left: 0, right: 0, top: 0, width: 200,
      x: 0, y: 0, toJSON: () => ({}),
    })
    const addListener = vi.spyOn(window, 'addEventListener')
    const removeListener = vi.spyOn(window, 'removeEventListener')
    const view = render(
      <SceneContextMenu
        commands={commands()}
        entityId={null}
        onDelete={vi.fn()}
        onIsolate={vi.fn()}
        position={{ x: 0, y: 750 }}
        runtime={testSceneRuntime()}
      />,
    )
    const resizeRegistration = addListener.mock.calls.find(([type]) => String(type) === 'resize')
    expect(resizeRegistration).toBeDefined()

    viewportHeight = 600
    fireEvent(window, new Event('resize'))
    expect(screen.getByRole('menu')).toHaveStyle({ top: '500px' })

    view.unmount()
    expect(removeListener).toHaveBeenCalledWith('resize', resizeRegistration?.[1])
  })

  it('traps confirmation focus and returns it to the invoking menu item on Escape', async () => {
    const user = userEvent.setup()
    render(
      <SceneContextMenu
        commands={commands()}
        entityId="object:cup-1"
        onDelete={vi.fn()}
        onIsolate={vi.fn()}
        runtime={testSceneRuntime()}
      />,
    )

    const deleteItem = screen.getByRole('menuitem', { name: 'Delete' })
    await user.click(deleteItem)
    const cancel = screen.getByRole('button', { name: 'Cancel' })
    const confirm = screen.getByRole('button', { name: 'Delete Entity' })
    expect(cancel).toHaveFocus()
    await user.keyboard('{Shift>}{Tab}{/Shift}')
    expect(confirm).toHaveFocus()
    await user.keyboard('{Tab}')
    expect(cancel).toHaveFocus()
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(deleteItem).toHaveFocus()
  })

  it('blocks underlying menu commands while a confirmation dialog is modal', async () => {
    const user = userEvent.setup()
    const service = commands()
    render(
      <SceneContextMenu
        commands={service}
        entityId="object:cup-1"
        onDelete={vi.fn()}
        onIsolate={vi.fn()}
        runtime={testSceneRuntime()}
      />,
    )

    const hideItem = screen.getByRole('menuitem', { name: 'Hide' })
    await user.click(screen.getByRole('menuitem', { name: 'Delete' }))
    fireEvent.click(hideItem)

    expect(service.setVisible).not.toHaveBeenCalled()
    expect(screen.getByTestId('scene-modal-backdrop')).toBeVisible()
  })

  it('focuses and dismisses the group chooser as a modal dialog', async () => {
    const user = userEvent.setup()
    const runtime = testSceneRuntime([
      {
        kind: 'group', id: 'group:fixture', name: 'Fixture', parentId: null,
        localPose: { positionM: [0, 0, 0], quaternion: [0, 0, 0, 1] }, visible: true,
      },
      {
        kind: 'object', id: 'object:cup-1', name: 'Cup', parentId: null,
        localPose: { positionM: [0, 0, 0], quaternion: [0, 0, 0, 1] }, visible: true,
        target: { kind: 'object-instance', id: 'cup-1' }, transformSource: 'manual',
      },
    ] satisfies readonly SceneEntityV1[])
    render(
      <SceneContextMenu
        commands={commands()}
        entityId="object:cup-1"
        onDelete={vi.fn()}
        onIsolate={vi.fn()}
        runtime={runtime}
      />,
    )

    const moveItem = screen.getByRole('menuitem', { name: 'Move to group' })
    await user.click(moveItem)
    expect(screen.getByRole('button', { name: 'Move to Fixture' })).toHaveFocus()
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog', { name: 'Choose group' })).not.toBeInTheDocument()
    expect(moveItem).toHaveFocus()
  })

  it('blocks underlying menu commands while the group chooser is modal', async () => {
    const user = userEvent.setup()
    const service = commands()
    const runtime = testSceneRuntime([
      {
        kind: 'group', id: 'group:fixture', name: 'Fixture', parentId: null,
        localPose: { positionM: [0, 0, 0], quaternion: [0, 0, 0, 1] }, visible: true,
      },
      {
        kind: 'object', id: 'object:cup-1', name: 'Cup', parentId: null,
        localPose: { positionM: [0, 0, 0], quaternion: [0, 0, 0, 1] }, visible: true,
        target: { kind: 'object-instance', id: 'cup-1' }, transformSource: 'manual',
      },
    ] satisfies readonly SceneEntityV1[])
    render(
      <SceneContextMenu
        commands={service}
        entityId="object:cup-1"
        onDelete={vi.fn()}
        onIsolate={vi.fn()}
        runtime={runtime}
      />,
    )

    const hideItem = screen.getByRole('menuitem', { name: 'Hide' })
    await user.click(screen.getByRole('menuitem', { name: 'Move to group' }))
    fireEvent.click(hideItem)

    expect(service.setVisible).not.toHaveBeenCalled()
    expect(screen.getByTestId('scene-modal-backdrop')).toBeVisible()
  })

  it('returns focus after a failed confirmation action closes its dialog', async () => {
    const user = userEvent.setup()
    render(
      <SceneContextMenu
        commands={commands()}
        entityId="object:cup-1"
        onDelete={vi.fn(async () => {
          throw new Error('delete failed')
        })}
        onIsolate={vi.fn()}
        runtime={testSceneRuntime()}
      />,
    )

    const deleteItem = screen.getByRole('menuitem', { name: 'Delete' })
    await user.click(deleteItem)
    await user.click(screen.getByRole('button', { name: 'Delete Entity' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('delete failed')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(deleteItem).toHaveFocus()
  })

  it('returns focus after a failed group choice closes its dialog', async () => {
    const user = userEvent.setup()
    const service = commands()
    service.reparent.mockRejectedValue(new Error('reparent failed'))
    const runtime = testSceneRuntime([
      {
        kind: 'group', id: 'group:fixture', name: 'Fixture', parentId: null,
        localPose: { positionM: [0, 0, 0], quaternion: [0, 0, 0, 1] }, visible: true,
      },
      {
        kind: 'object', id: 'object:cup-1', name: 'Cup', parentId: null,
        localPose: { positionM: [0, 0, 0], quaternion: [0, 0, 0, 1] }, visible: true,
        target: { kind: 'object-instance', id: 'cup-1' }, transformSource: 'manual',
      },
    ] satisfies readonly SceneEntityV1[])
    render(
      <SceneContextMenu
        commands={service}
        entityId="object:cup-1"
        onDelete={vi.fn()}
        onIsolate={vi.fn()}
        runtime={runtime}
      />,
    )

    const moveItem = screen.getByRole('menuitem', { name: 'Move to group' })
    await user.click(moveItem)
    await user.click(screen.getByRole('button', { name: 'Move to Fixture' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('reparent failed')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(moveItem).toHaveFocus()
  })
})
