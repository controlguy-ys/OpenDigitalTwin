import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import {
  validateWorkcellProjectV4,
  type SpatialEntityV4,
  type WorkcellProjectV4,
} from '../../../core/project-v4/index.js'
import { projectAtLimit } from '../../../core/project-v4/test-support.js'
import { createInteractionStoreV4 } from '../../interaction/v4/interaction-store.js'
import { sceneSelectionKeyV4 } from '../../interaction/v4/scene-selection.js'
import { createRobotRuntimeRegistryV4 } from '../../robot/v4/robot-runtime-registry.js'
import type { SceneCommandServiceV4 } from './scene-command-service.js'
import { selectSceneRuntimeV4 } from './scene-runtime-selector.js'
import { SceneExplorerV4 } from './SceneExplorer.js'

const IDENTITY = Object.freeze({
  positionM: [0, 0, 0] as const,
  quaternion: [0, 0, 0, 1] as const,
})

function entity(
  id: string,
  name: string,
  groupId: string | null,
  visible = true,
  withFrames = false,
): SpatialEntityV4 {
  return {
    id,
    name,
    geometry: { kind: 'box', dimensionsM: [1, 1, 1], color: '#808080' },
    parentFrameId: 'world',
    localPose: IDENTITY,
    visible,
    groupId,
    removable: true,
    transformOwner: 'manual',
    numericStatus: {
      value: 0,
      sourceOwnership: 'manual',
      overlay: { visible: false, frameId: null },
    },
    graspable: withFrames,
    graspFrames: withFrames
      ? [{ frameId: `${id}-grasp`, name: 'Grip', localPose: IDENTITY }]
      : [],
    movingFrames: withFrames
      ? [{
          frameId: `${id}-moving`,
          name: 'Moving',
          parentFrameId: 'mcp',
          localPose: IDENTITY,
          sourceOwnership: 'manual',
        }]
      : [],
  }
}

function project(): WorkcellProjectV4 {
  const source = projectAtLimit('robots', 2)
  return validateWorkcellProjectV4({
    ...source,
    revisionId: 'revision-scene-explorer',
    sceneGroups: [
      { id: 'group-root', name: 'Root Group', parentGroupId: null, visible: true },
      { id: 'group-child', name: 'Child Group', parentGroupId: 'group-root', visible: true },
    ],
    spatialEntities: [
      entity('entity-a', 'Grouped A', 'group-child', true, true),
      entity('entity-b', 'Grouped B', 'group-root', false),
      entity('entity-c', 'Ungrouped', null),
    ],
  })
}

function runtime(workcell: WorkcellProjectV4) {
  const robots = createRobotRuntimeRegistryV4()
  robots.getState().replaceProject(workcell)
  return selectSceneRuntimeV4(workcell, robots.getState())
}

function commandHarness() {
  const setPersistedVisibility = vi.fn(async () => undefined)
  return {
    service: { setPersistedVisibility } as unknown as SceneCommandServiceV4,
    setPersistedVisibility,
  }
}

function renderExplorer(command = commandHarness()) {
  const workcell = project()
  const interaction = createInteractionStoreV4()
  interaction.getState().replaceProject(workcell)
  const onContextRequest = vi.fn()
  const onFocus = vi.fn()
  const result = render(
    <SceneExplorerV4
      commands={command.service}
      interaction={interaction}
      onContextRequest={onContextRequest}
      onFocus={onFocus}
      project={workcell}
      runtime={runtime(workcell)}
    />,
  )
  return {
    ...result,
    command,
    interaction,
    onContextRequest,
    onFocus,
    workcell,
  }
}

function row(name: string): HTMLElement {
  return screen.getByRole('treeitem', { name })
}

describe('SceneExplorerV4', () => {
  it('builds the complete deterministic structured tree in Project order', () => {
    renderExplorer()

    expect(screen.getAllByRole('treeitem').map((item) => item.getAttribute('aria-label')))
      .toEqual([
        'World',
        'MCP',
        'Robot 1',
        'Robot 1 / Link 0',
        'Robot 1 / Link 1',
        'Robot 1 / Base',
        'Robot 1 / Tool',
        'Robot 1 / TCP',
        'Robot 2',
        'Robot 2 / Link 0',
        'Robot 2 / Link 1',
        'Robot 2 / Base',
        'Robot 2 / Tool',
        'Robot 2 / TCP',
        'Root Group',
        'Child Group',
        'Grouped A',
        'Grouped A / Grip',
        'Grouped A / Moving',
        'Grouped B',
        'Ungrouped',
      ])
    expect(screen.getByText('Scene Frames').closest('[role="treeitem"]')).toBeNull()
    expect(screen.getByText('Robots').closest('[role="treeitem"]')).toBeNull()
    expect(screen.getByText('Scene Objects').closest('[role="treeitem"]')).toBeNull()
    expect(row('Robot 1 / TCP')).toHaveAttribute(
      'data-scene-selection-key',
      sceneSelectionKeyV4({ kind: 'robot-frame', robotId: 'robot-1', frameId: 'TCP' }),
    )
    expect(row('Robot 2 / TCP')).toHaveAttribute(
      'data-scene-selection-key',
      sceneSelectionKeyV4({ kind: 'robot-frame', robotId: 'robot-2', frameId: 'TCP' }),
    )
    expect(row('Robot 1 / TCP').dataset.sceneSelectionKey)
      .not.toBe(row('Robot 2 / TCP').dataset.sceneSelectionKey)

    const visibilityButtons = screen.getAllByRole('button', { name: /^(Hide|Show) / })
    expect(visibilityButtons.map((button) => button.getAttribute('aria-label'))).toEqual([
      'Hide Robot 1',
      'Hide Robot 2',
      'Hide Root Group',
      'Hide Child Group',
      'Hide Grouped A',
      'Show Grouped B',
      'Hide Ungrouped',
    ])
    expect(screen.getByTestId('scene-tree-scroll')).toHaveStyle({
      minHeight: '0',
      overflow: 'auto',
    })
  })

  it('supports click selection, double-click focus, roving keys, and collapse navigation', async () => {
    const user = userEvent.setup()
    const harness = renderExplorer()
    const robot = row('Robot 1')
    expect(robot).toHaveAttribute('tabindex', '0')

    robot.focus()
    await user.keyboard('{ArrowDown}')
    expect(row('Robot 1 / Link 0')).toHaveFocus()
    await user.keyboard('{ArrowLeft}')
    expect(robot).toHaveFocus()
    await user.keyboard('{ArrowLeft}')
    expect(screen.queryByRole('treeitem', { name: 'Robot 1 / Link 0' })).not.toBeInTheDocument()
    await user.keyboard('{ArrowRight}{ArrowRight}')
    expect(row('Robot 1 / Link 0')).toHaveFocus()

    await user.keyboard('{End}')
    expect(row('Ungrouped')).toHaveFocus()
    await user.keyboard('{Home}{Enter}')
    expect(row('World')).toHaveFocus()
    expect(harness.interaction.getState().selection).toEqual({
      kind: 'scene-frame',
      frameId: 'world',
    })

    await user.click(within(row('Robot 2 / TCP')).getByRole('button', { name: 'Robot 2 / TCP' }))
    expect(harness.interaction.getState().selection).toEqual({
      kind: 'robot-frame',
      robotId: 'robot-2',
      frameId: 'TCP',
    })
    await user.dblClick(within(row('Grouped A')).getByRole('button', { name: 'Grouped A' }))
    expect(harness.onFocus).toHaveBeenCalledWith({
      kind: 'spatial-entity',
      entityId: 'entity-a',
    })
  })

  it('exposes a pointer-operable disclosure for expandable tree rows', async () => {
    const user = userEvent.setup()
    renderExplorer()

    const collapse = screen.getByRole('button', { name: 'Collapse Robot 1' })
    expect(collapse).toHaveAttribute('aria-expanded', 'true')
    await user.click(collapse)

    expect(screen.queryByRole('treeitem', { name: 'Robot 1 / Link 0' })).not.toBeInTheDocument()
    const expand = screen.getByRole('button', { name: 'Expand Robot 1' })
    expect(expand).toHaveAttribute('aria-expanded', 'false')
    await user.click(expand)

    expect(screen.getByRole('treeitem', { name: 'Robot 1 / Link 0' })).toBeInTheDocument()
    expect(within(row('Robot 1 / Link 0')).queryByRole('button', {
      name: /^(Collapse|Expand) /,
    })).not.toBeInTheDocument()
  })

  it('emits exact structured pointer, keyboard, and empty-space context requests', () => {
    const harness = renderExplorer()
    fireEvent.contextMenu(row('Robot 2 / TCP'), { clientX: 44, clientY: 55 })
    expect(harness.onContextRequest).toHaveBeenLastCalledWith({
      selection: { kind: 'robot-frame', robotId: 'robot-2', frameId: 'TCP' },
      position: { x: 44, y: 55 },
    })

    const moving = row('Grouped A / Moving')
    vi.spyOn(moving, 'getBoundingClientRect').mockReturnValue({
      bottom: 90,
      height: 20,
      left: 12,
      right: 112,
      top: 70,
      width: 100,
      x: 12,
      y: 70,
      toJSON: () => ({}),
    })
    moving.focus()
    fireEvent.keyDown(moving, { key: 'F10', shiftKey: true })
    expect(harness.onContextRequest).toHaveBeenLastCalledWith({
      selection: { kind: 'entity-frame', entityId: 'entity-a', frameId: 'entity-a-moving' },
      position: { x: 12, y: 90 },
    })

    fireEvent.contextMenu(screen.getByTestId('scene-tree-scroll'), {
      clientX: 5,
      clientY: 6,
    })
    expect(harness.onContextRequest).toHaveBeenLastCalledWith({
      selection: null,
      position: { x: 5, y: 6 },
    })
  })

  it('clears only an affected selection after a successful persisted hide', async () => {
    let resolveVisibility!: () => void
    const command = commandHarness()
    command.setPersistedVisibility.mockImplementationOnce(() => new Promise<undefined>((resolve) => {
      resolveVisibility = () => resolve(undefined)
    }))
    const harness = renderExplorer(command)
    harness.interaction.getState().select({
      kind: 'robot-link',
      robotId: 'robot-1',
      linkId: 'L0',
    })

    fireEvent.click(screen.getByRole('button', { name: 'Hide Robot 1' }))
    await waitFor(() => expect(command.setPersistedVisibility).toHaveBeenCalledWith(
      { kind: 'robot', robotId: 'robot-1' }, false,
    ))
    expect(harness.interaction.getState().selection).toEqual({
      kind: 'robot-link', robotId: 'robot-1', linkId: 'L0',
    })

    resolveVisibility()
    await waitFor(() => expect(harness.interaction.getState().selection).toBeNull())
  })

  it('preserves selection on rejection and respects Grasp versus Moving ownership', async () => {
    const rejected = commandHarness()
    rejected.setPersistedVisibility.mockRejectedValueOnce(new Error('publication rejected'))
    const first = renderExplorer(rejected)
    first.interaction.getState().select({
      kind: 'entity-frame',
      entityId: 'entity-a',
      frameId: 'entity-a-grasp',
    })
    fireEvent.click(screen.getByRole('button', { name: 'Hide Grouped A' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('publication rejected')
    expect(first.interaction.getState().selection).toEqual({
      kind: 'entity-frame', entityId: 'entity-a', frameId: 'entity-a-grasp',
    })
    first.unmount()

    const accepted = renderExplorer()
    accepted.interaction.getState().select({
      kind: 'entity-frame',
      entityId: 'entity-a',
      frameId: 'entity-a-moving',
    })
    fireEvent.click(screen.getByRole('button', { name: 'Hide Grouped A' }))
    await waitFor(() => expect(accepted.command.setPersistedVisibility).toHaveBeenCalledOnce())
    expect(accepted.interaction.getState().selection).toEqual({
      kind: 'entity-frame', entityId: 'entity-a', frameId: 'entity-a-moving',
    })
  })

  it('does not let an obsolete visibility success clear selection in a newer Project revision', async () => {
    let resolveVisibility!: () => void
    const command = commandHarness()
    command.setPersistedVisibility.mockImplementationOnce(() => new Promise<undefined>((resolve) => {
      resolveVisibility = () => resolve(undefined)
    }))
    const harness = renderExplorer(command)
    const selection = {
      kind: 'robot-link' as const,
      robotId: 'robot-1',
      linkId: 'L0',
    }
    harness.interaction.getState().select(selection)
    fireEvent.click(screen.getByRole('button', { name: 'Hide Robot 1' }))
    await waitFor(() => expect(command.setPersistedVisibility).toHaveBeenCalledOnce())

    const published = validateWorkcellProjectV4({
      ...harness.workcell,
      revisionId: 'revision-scene-explorer-newer',
      robots: harness.workcell.robots.map((robot) => (
        robot.id === 'robot-2' ? { ...robot, name: 'Robot 2 updated' } : robot
      )),
    })
    harness.interaction.getState().replaceProject(published)
    harness.interaction.getState().select(selection)
    harness.rerender(
      <SceneExplorerV4
        commands={command.service}
        interaction={harness.interaction}
        onContextRequest={harness.onContextRequest}
        onFocus={harness.onFocus}
        project={published}
        runtime={runtime(published)}
      />,
    )

    await act(async () => {
      resolveVisibility()
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(harness.interaction.getState().selection).toEqual(selection)
  })

  it('does not surface an obsolete visibility rejection in a newer Project revision', async () => {
    let rejectVisibility!: (error: Error) => void
    const command = commandHarness()
    command.setPersistedVisibility.mockImplementationOnce(() => new Promise<undefined>((_resolve, reject) => {
      rejectVisibility = reject
    }))
    const harness = renderExplorer(command)
    fireEvent.click(screen.getByRole('button', { name: 'Hide Robot 1' }))
    await waitFor(() => expect(command.setPersistedVisibility).toHaveBeenCalledOnce())

    const published = validateWorkcellProjectV4({
      ...harness.workcell,
      revisionId: 'revision-scene-explorer-rejection-newer',
      robots: harness.workcell.robots.map((robot) => (
        robot.id === 'robot-2' ? { ...robot, name: 'Robot 2 updated' } : robot
      )),
    })
    harness.interaction.getState().replaceProject(published)
    harness.rerender(
      <SceneExplorerV4
        commands={command.service}
        interaction={harness.interaction}
        onContextRequest={harness.onContextRequest}
        onFocus={harness.onFocus}
        project={published}
        runtime={runtime(published)}
      />,
    )

    await act(async () => {
      rejectVisibility(new Error('obsolete visibility failure'))
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(screen.queryByText('obsolete visibility failure')).not.toBeInTheDocument()
  })

  it('dispatches one visibility command for two synchronous activations', async () => {
    let resolveVisibility!: () => void
    const command = commandHarness()
    command.setPersistedVisibility.mockImplementationOnce(() => new Promise<undefined>((resolve) => {
      resolveVisibility = () => resolve(undefined)
    }))
    renderExplorer(command)
    const hide = screen.getByRole('button', { name: 'Hide Robot 1' })

    act(() => {
      hide.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
      hide.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    })
    await waitFor(() => expect(command.setPersistedVisibility).toHaveBeenCalledOnce())

    await act(async () => {
      resolveVisibility()
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(command.setPersistedVisibility).toHaveBeenCalledOnce()
  })
})
