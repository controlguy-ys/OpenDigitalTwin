import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import {
  validateWorkcellProjectV4,
  type RigidTransformV4,
  type SpatialEntityV4,
  type WorkcellProjectV4,
} from '../../../core/project-v4/index.js'
import { projectAtLimit } from '../../../core/project-v4/test-support.js'
import { createInteractionStoreV4 } from '../../interaction/v4/interaction-store.js'
import type { SceneSelectionTargetV4 } from '../../interaction/v4/scene-selection.js'
import { createRobotRuntimeRegistryV4 } from '../../robot/v4/robot-runtime-registry.js'
import { SceneContextMenuV4 } from './SceneContextMenu.js'
import type { SceneCommandServiceV4 } from './scene-command-service.js'
import { selectSceneRuntimeV4 } from './scene-runtime-selector.js'

const IDENTITY: RigidTransformV4 = Object.freeze({
  positionM: [0, 0, 0] as const,
  quaternion: [0, 0, 0, 1] as const,
})

function entity(
  id: string,
  name: string,
  groupId: string | null,
  removable = true,
): SpatialEntityV4 {
  return {
    id,
    name,
    geometry: { kind: 'box', dimensionsM: [1, 1, 1], color: '#808080' },
    parentFrameId: 'world',
    localPose: { positionM: [0.1, 0.2, 0.3], quaternion: [0, 0, 0, 1] },
    visible: true,
    groupId,
    removable,
    transformOwner: 'manual',
    numericStatus: {
      value: 0,
      sourceOwnership: 'manual',
      overlay: { visible: false, frameId: null },
    },
    graspable: true,
    graspFrames: [{ frameId: `${id}-grasp`, name: 'Grip', localPose: IDENTITY }],
    movingFrames: [
      {
        frameId: `${id}-moving`,
        name: 'Manual Moving',
        parentFrameId: 'mcp',
        localPose: IDENTITY,
        sourceOwnership: 'manual',
      },
      {
        frameId: `${id}-live`,
        name: 'Live Moving',
        parentFrameId: 'world',
        localPose: IDENTITY,
        sourceOwnership: 'simulation',
      },
    ],
  }
}

function project(): WorkcellProjectV4 {
  const source = projectAtLimit('robots', 2)
  return validateWorkcellProjectV4({
    ...source,
    revisionId: 'revision-scene-context',
    scene: {
      frames: [
        ...source.scene.frames,
        {
          id: 'fixture-frame',
          name: 'Fixture Frame',
          parentFrameId: 'mcp',
          localPose: IDENTITY,
          role: 'custom',
        },
      ],
    },
    robots: source.robots.map((robot, index) => ({
      ...robot,
      localBasePose: {
        positionM: [index + 1, 0, 0],
        quaternion: [0, 0, 0, 1],
      },
    })),
    sceneGroups: [
      { id: 'group-root', name: 'Root Group', parentGroupId: null, visible: true },
      { id: 'group-child', name: 'Child Group', parentGroupId: 'group-root', visible: true },
    ],
    spatialEntities: [
      entity('entity-a', 'Part A', 'group-child'),
      entity('entity-fixed', 'Fixed Part', null, false),
    ],
  })
}

function runtime(workcell: WorkcellProjectV4) {
  const robots = createRobotRuntimeRegistryV4()
  robots.getState().replaceProject(workcell)
  return selectSceneRuntimeV4(workcell, robots.getState())
}

function commandHarness() {
  const service = {
    createBox: vi.fn(async () => 'new-box'),
    createCylinder: vi.fn(async () => 'new-cylinder'),
    createGroup: vi.fn(async () => 'new-group'),
    rename: vi.fn(async () => undefined),
    setPersistedVisibility: vi.fn(async () => undefined),
    setSpatialEntityLocalPose: vi.fn(async () => undefined),
    setSpatialEntityGroup: vi.fn(async () => undefined),
    setRobotBase: vi.fn(async () => undefined),
    setSelectedToolFrames: vi.fn(async () => undefined),
    setSceneFrameLocalPose: vi.fn(async () => undefined),
    setMovingFrame: vi.fn(async () => undefined),
    setNumericStatus: vi.fn(async () => undefined),
    setStatusOverlayVisible: vi.fn(async () => undefined),
    reparentGroup: vi.fn(async () => undefined),
    ungroup: vi.fn(async () => undefined),
    deleteSpatialEntity: vi.fn(async () => undefined),
    deleteGroupAndContents: vi.fn(async () => undefined),
  }
  return { service: service as SceneCommandServiceV4, spies: service }
}

function renderMenu(selection: SceneSelectionTargetV4 | null) {
  const workcell = project()
  const interaction = createInteractionStoreV4()
  interaction.getState().replaceProject(workcell)
  const commands = commandHarness()
  const callbacks = {
    onClose: vi.fn(),
    onFitAll: vi.fn(),
    onFocus: vi.fn(),
    onOpenRobotBase: vi.fn(),
    onOpenMovingFrame: vi.fn(),
    onOpenCollision: vi.fn(),
  }
  const props = {
    ...callbacks,
    commands: commands.service,
    defaultPlacementFrameId: 'mcp',
    interaction,
    project: workcell,
    request: { selection, position: { x: 10, y: 20 } },
    runtime: runtime(workcell),
  } as const
  const result = render(<SceneContextMenuV4 {...props} />)
  return { ...result, callbacks, commands, interaction, props, workcell }
}

function labels(): string[] {
  return screen.getAllByRole('menuitem').map((item) => item.textContent ?? '')
}

describe('SceneContextMenuV4', () => {
  it('renders the exact command matrix without deferred or forbidden features', () => {
    const harness = renderMenu(null)
    expect(labels()).toEqual([
      'Create Group', 'Create Box', 'Create Cylinder', 'Fit All', 'Show All',
    ])

    const cases: readonly [SceneSelectionTargetV4, readonly string[]][] = [
      [
        { kind: 'robot', robotId: 'robot-1' },
        [
          'Focus', 'Copy Base Pose', 'Paste Base Pose', 'Reset Base Pose', 'Hide',
          'Isolate', 'Edit Base and Mount', 'Open Collision',
        ],
      ],
      [
        { kind: 'robot-link', robotId: 'robot-1', linkId: 'L0' },
        ['Focus', 'Hide Robot', 'Isolate Robot', 'Open Collision'],
      ],
      [
        { kind: 'spatial-entity', entityId: 'entity-a' },
        [
          'Focus', 'Rename', 'Copy Local Pose', 'Paste Local Pose', 'Reset Local Pose',
          'Move to Group', 'Clear Group', 'Hide', 'Isolate', 'Delete', 'Open Collision',
        ],
      ],
      [
        { kind: 'scene-group', groupId: 'group-root' },
        [
          'Focus Children', 'Rename', 'Move Group', 'Ungroup', 'Hide', 'Isolate',
          'Delete Group and Contents',
        ],
      ],
      [
        { kind: 'scene-frame', frameId: 'world' },
        ['Focus', 'Rename'],
      ],
      [
        { kind: 'scene-frame', frameId: 'fixture-frame' },
        ['Focus', 'Rename', 'Edit Frame'],
      ],
      [
        { kind: 'robot-frame', robotId: 'robot-2', frameId: 'TCP' },
        ['Focus', 'Open Coordinate Details'],
      ],
      [
        { kind: 'entity-frame', entityId: 'entity-a', frameId: 'entity-a-grasp' },
        ['Focus'],
      ],
      [
        { kind: 'entity-frame', entityId: 'entity-a', frameId: 'entity-a-moving' },
        ['Focus', 'Edit Moving Frame'],
      ],
      [
        { kind: 'entity-frame', entityId: 'entity-a', frameId: 'entity-a-live' },
        ['Focus'],
      ],
    ]

    for (const [selection, expected] of cases) {
      harness.rerender(
        <SceneContextMenuV4
          {...harness.props}
          request={{ selection, position: { x: 10, y: 20 } }}
        />,
      )
      expect(labels()).toEqual(expected)
      expect(screen.queryByText(/Mechanics|Geometry|STEP Import|Linear Axis|Automatic Grasp|Attach|Detach/i))
        .not.toBeInTheDocument()
    }
  })

  it('creates deterministic empty-space primitives and keeps Fit/Show All non-Project', async () => {
    const user = userEvent.setup()
    const harness = renderMenu(null)
    const originalProject = harness.workcell
    harness.interaction.getState().isolate({ kind: 'robot', robotId: 'robot-1' })

    await user.click(screen.getByRole('menuitem', { name: 'Create Group' }))
    await waitFor(() => expect(harness.commands.spies.createGroup).toHaveBeenCalledWith('Group', null))
    await user.click(screen.getByRole('menuitem', { name: 'Create Box' }))
    await waitFor(() => expect(harness.commands.spies.createBox).toHaveBeenCalledWith({
      name: 'Box',
      parentFrameId: 'mcp',
      localPose: IDENTITY,
      dimensionsM: [0.1, 0.1, 0.1],
      color: '#94A3B8',
      groupId: null,
    }))
    await user.click(screen.getByRole('menuitem', { name: 'Create Cylinder' }))
    await waitFor(() => expect(harness.commands.spies.createCylinder).toHaveBeenCalledWith({
      name: 'Cylinder',
      parentFrameId: 'mcp',
      localPose: IDENTITY,
      radiusM: 0.05,
      heightM: 0.1,
      color: '#94A3B8',
      groupId: null,
    }))
    await user.click(screen.getByRole('menuitem', { name: 'Fit All' }))
    expect(harness.callbacks.onFitAll).toHaveBeenCalledOnce()
    await user.click(screen.getByRole('menuitem', { name: 'Show All' }))
    expect(harness.interaction.getState().isolation).toBeNull()
    expect(harness.workcell).toBe(originalProject)
  })

  it('uses only the interaction clipboard for Robot and Spatial pose commands', async () => {
    const user = userEvent.setup()
    const harness = renderMenu({ kind: 'robot', robotId: 'robot-1' })

    expect(screen.getByRole('menuitem', { name: 'Paste Base Pose' })).toBeDisabled()
    await user.click(screen.getByRole('menuitem', { name: 'Copy Base Pose' }))
    expect(harness.interaction.getState().transformClipboard).toEqual({
      positionM: [1, 0, 0], quaternion: [0, 0, 0, 1],
    })
    expect(screen.getByRole('menuitem', { name: 'Paste Base Pose' })).toBeEnabled()
    await user.click(screen.getByRole('menuitem', { name: 'Paste Base Pose' }))
    await waitFor(() => expect(harness.commands.spies.setRobotBase).toHaveBeenCalledWith({
      robotId: 'robot-1',
      baseParentFrameId: 'mcp',
      localBasePose: { positionM: [1, 0, 0], quaternion: [0, 0, 0, 1] },
      intentionalMountEntityId: null,
    }))
    await user.click(screen.getByRole('menuitem', { name: 'Reset Base Pose' }))
    await waitFor(() => expect(harness.commands.spies.setRobotBase).toHaveBeenLastCalledWith({
      robotId: 'robot-1',
      baseParentFrameId: 'mcp',
      localBasePose: IDENTITY,
      intentionalMountEntityId: null,
    }))

    harness.rerender(
      <SceneContextMenuV4
        {...harness.props}
        request={{
          selection: { kind: 'spatial-entity', entityId: 'entity-a' },
          position: { x: 10, y: 20 },
        }}
      />,
    )
    await user.click(screen.getByRole('menuitem', { name: 'Copy Local Pose' }))
    expect(harness.interaction.getState().transformClipboard).toEqual({
      positionM: [0.1, 0.2, 0.3], quaternion: [0, 0, 0, 1],
    })
    await user.click(screen.getByRole('menuitem', { name: 'Reset Local Pose' }))
    await waitFor(() => expect(harness.commands.spies.setSpatialEntityLocalPose)
      .toHaveBeenCalledWith('entity-a', IDENTITY))
  })

  it('routes callbacks and exact owner targets without Project mutations', async () => {
    const user = userEvent.setup()
    const harness = renderMenu({ kind: 'robot-link', robotId: 'robot-1', linkId: 'L0' })
    await user.click(screen.getByRole('menuitem', { name: 'Focus' }))
    expect(harness.callbacks.onFocus).toHaveBeenCalledWith({
      kind: 'robot-link', robotId: 'robot-1', linkId: 'L0',
    })
    await user.click(screen.getByRole('menuitem', { name: 'Isolate Robot' }))
    expect(harness.interaction.getState().isolation).toEqual({
      kind: 'robot', robotId: 'robot-1',
    })
    await user.click(screen.getByRole('menuitem', { name: 'Open Collision' }))
    expect(harness.callbacks.onOpenCollision).toHaveBeenCalledWith({
      kind: 'robot-link', robotId: 'robot-1', linkId: 'L0',
    })

    harness.rerender(
      <SceneContextMenuV4
        {...harness.props}
        request={{
          selection: { kind: 'robot', robotId: 'robot-2' },
          position: { x: 10, y: 20 },
        }}
      />,
    )
    await user.click(screen.getByRole('menuitem', { name: 'Edit Base and Mount' }))
    expect(harness.callbacks.onOpenRobotBase).toHaveBeenCalledWith('robot-2')

    harness.rerender(
      <SceneContextMenuV4
        {...harness.props}
        request={{
          selection: {
            kind: 'entity-frame', entityId: 'entity-a', frameId: 'entity-a-moving',
          },
          position: { x: 10, y: 20 },
        }}
      />,
    )
    await user.click(screen.getByRole('menuitem', { name: 'Edit Moving Frame' }))
    expect(harness.callbacks.onOpenMovingFrame).toHaveBeenCalledWith(
      'entity-a', 'entity-a-moving',
    )
    expect(harness.commands.spies.setPersistedVisibility).not.toHaveBeenCalled()
  })

  it('clears affected selection only after hide success and retains errors in the menu', async () => {
    const user = userEvent.setup()
    let rejectVisibility!: (error: Error) => void
    const harness = renderMenu({ kind: 'spatial-entity', entityId: 'entity-a' })
    harness.interaction.getState().select({ kind: 'spatial-entity', entityId: 'entity-a' })
    harness.commands.spies.setPersistedVisibility.mockImplementationOnce(() => (
      new Promise<undefined>((_resolve, reject) => { rejectVisibility = reject })
    ))

    await user.click(screen.getByRole('menuitem', { name: 'Hide' }))
    expect(harness.interaction.getState().selection).toEqual({
      kind: 'spatial-entity', entityId: 'entity-a',
    })
    rejectVisibility(new Error('stale visibility rejected'))
    expect(await screen.findByRole('alert')).toHaveTextContent('stale visibility rejected')
    expect(harness.interaction.getState().selection).toEqual({
      kind: 'spatial-entity', entityId: 'entity-a',
    })
    expect(screen.getByRole('menu')).toBeVisible()
  })

  it('rejects stale structured requests instead of degrading them to empty space', () => {
    const harness = renderMenu({
      kind: 'robot-frame', robotId: 'robot-1', frameId: 'missing',
    })
    expect(screen.getByRole('alert')).toHaveTextContent(/no longer available/i)
    expect(screen.queryByRole('menuitem')).not.toBeInTheDocument()
    expect(harness.commands.spies.createBox).not.toHaveBeenCalled()
  })

  it('does not let an obsolete async action close or overwrite a newer target menu', async () => {
    const user = userEvent.setup()
    let rejectOldAction!: (error: Error) => void
    const harness = renderMenu({ kind: 'spatial-entity', entityId: 'entity-a' })
    harness.commands.spies.setPersistedVisibility.mockImplementationOnce(() => (
      new Promise<undefined>((_resolve, reject) => { rejectOldAction = reject })
    ))
    await user.click(screen.getByRole('menuitem', { name: 'Hide' }))
    await waitFor(() => expect(harness.commands.spies.setPersistedVisibility).toHaveBeenCalledOnce())

    harness.rerender(
      <SceneContextMenuV4
        {...harness.props}
        request={{
          selection: { kind: 'robot', robotId: 'robot-2' },
          position: { x: 30, y: 40 },
        }}
      />,
    )
    expect(screen.getByRole('menuitem', { name: 'Copy Base Pose' })).toBeVisible()

    await act(async () => {
      rejectOldAction(new Error('obsolete entity failure'))
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(screen.queryByText('obsolete entity failure')).not.toBeInTheDocument()
    expect(harness.callbacks.onClose).not.toHaveBeenCalled()
    expect(screen.getByRole('menuitem', { name: 'Edit Base and Mount' })).toBeVisible()
  })

  it('closes the same request when its mutation publishes a new Project revision first', async () => {
    const user = userEvent.setup()
    let resolveVisibility!: () => void
    const harness = renderMenu({ kind: 'robot', robotId: 'robot-1' })
    harness.commands.spies.setPersistedVisibility.mockImplementationOnce(() => (
      new Promise<undefined>((resolve) => { resolveVisibility = () => resolve(undefined) })
    ))
    await user.click(screen.getByRole('menuitem', { name: 'Hide' }))
    await waitFor(() => expect(harness.commands.spies.setPersistedVisibility).toHaveBeenCalledOnce())

    const published = validateWorkcellProjectV4({
      ...harness.workcell,
      revisionId: 'revision-scene-context-published',
      robots: harness.workcell.robots.map((robot) => (
        robot.id === 'robot-1' ? { ...robot, visible: false } : robot
      )),
    })
    harness.interaction.getState().replaceProject(published)
    harness.rerender(
      <SceneContextMenuV4
        {...harness.props}
        project={published}
        request={harness.props.request}
        runtime={runtime(published)}
      />,
    )

    await act(async () => {
      resolveVisibility()
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(harness.callbacks.onClose).toHaveBeenCalledOnce()
  })

  it('does not let an old completion close a newer request for the same target', async () => {
    const user = userEvent.setup()
    let resolveOldAction!: () => void
    const selection = { kind: 'spatial-entity' as const, entityId: 'entity-a' }
    const harness = renderMenu(selection)
    harness.commands.spies.setPersistedVisibility.mockImplementationOnce(() => (
      new Promise<undefined>((resolve) => { resolveOldAction = () => resolve(undefined) })
    ))
    await user.click(screen.getByRole('menuitem', { name: 'Hide' }))
    await waitFor(() => expect(harness.commands.spies.setPersistedVisibility).toHaveBeenCalledOnce())

    harness.rerender(
      <SceneContextMenuV4
        {...harness.props}
        request={{ selection, position: { x: 10, y: 20 } }}
      />,
    )
    await act(async () => {
      resolveOldAction()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(harness.callbacks.onClose).not.toHaveBeenCalled()
    expect(screen.getByRole('menuitem', { name: 'Hide' })).toBeVisible()
  })

  it('keeps Tab trapped while an async action disables every menu item', async () => {
    const user = userEvent.setup()
    let resolveVisibility!: () => void
    const harness = renderMenu({ kind: 'robot', robotId: 'robot-1' })
    harness.commands.spies.setPersistedVisibility.mockImplementationOnce(() => (
      new Promise<undefined>((resolve) => { resolveVisibility = () => resolve(undefined) })
    ))
    await user.click(screen.getByRole('menuitem', { name: 'Hide' }))
    await waitFor(() => expect(harness.commands.spies.setPersistedVisibility).toHaveBeenCalledOnce())

    const menu = screen.getByRole('menu')
    await waitFor(() => expect(menu).toHaveFocus())
    expect(menu.dispatchEvent(new KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      key: 'Tab',
    }))).toBe(false)
    expect(menu).toHaveFocus()

    await act(async () => {
      resolveVisibility()
      await Promise.resolve()
      await Promise.resolve()
    })
  })

  it('dispatches one action command for two synchronous activations', async () => {
    let resolveVisibility!: () => void
    const harness = renderMenu({ kind: 'robot', robotId: 'robot-1' })
    harness.commands.spies.setPersistedVisibility.mockImplementationOnce(() => (
      new Promise<undefined>((resolve) => { resolveVisibility = () => resolve(undefined) })
    ))
    const hide = screen.getByRole('menuitem', { name: 'Hide' })

    act(() => {
      hide.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
      hide.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    })
    await waitFor(() => expect(harness.commands.spies.setPersistedVisibility).toHaveBeenCalledOnce())

    await act(async () => {
      resolveVisibility()
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(harness.commands.spies.setPersistedVisibility).toHaveBeenCalledOnce()
  })

  it('clamps placement, traps focus, roves, closes on Escape, and restores focus', async () => {
    const user = userEvent.setup()
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      bottom: 0,
      height: 100,
      left: 0,
      right: 0,
      top: 0,
      width: 200,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    })
    const workcell = project()
    const interaction = createInteractionStoreV4()
    interaction.getState().replaceProject(workcell)
    const commands = commandHarness()

    function Harness() {
      const [open, setOpen] = useState(false)
      return (
        <>
          <button onClick={() => setOpen(true)} type="button">Open menu</button>
          {!open ? null : (
            <SceneContextMenuV4
              commands={commands.service}
              defaultPlacementFrameId="mcp"
              interaction={interaction}
              onClose={() => setOpen(false)}
              onFitAll={vi.fn()}
              onFocus={vi.fn()}
              onOpenCollision={vi.fn()}
              onOpenMovingFrame={vi.fn()}
              onOpenRobotBase={vi.fn()}
              project={workcell}
              request={{
                selection: null,
                position: { x: window.innerWidth - 10, y: window.innerHeight - 10 },
              }}
              runtime={runtime(workcell)}
            />
          )}
        </>
      )
    }
    render(<Harness />)
    const trigger = screen.getByRole('button', { name: 'Open menu' })
    await user.click(trigger)
    expect(screen.getByRole('menuitem', { name: 'Create Group' })).toHaveFocus()
    expect(screen.getByRole('menu')).toHaveStyle({
      left: `${window.innerWidth - 200}px`,
      top: `${window.innerHeight - 100}px`,
    })
    await user.keyboard('{ArrowDown}')
    expect(screen.getByRole('menuitem', { name: 'Create Box' })).toHaveFocus()
    await user.keyboard('{End}')
    expect(screen.getByRole('menuitem', { name: 'Show All' })).toHaveFocus()
    await user.keyboard('{Tab}')
    expect(screen.getByRole('menuitem', { name: 'Create Group' })).toHaveFocus()
    await user.keyboard('{Shift>}{Tab}{/Shift}')
    expect(screen.getByRole('menuitem', { name: 'Show All' })).toHaveFocus()
    await user.keyboard('{Home}{Escape}')
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
  })
})
