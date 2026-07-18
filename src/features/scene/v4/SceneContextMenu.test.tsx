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
import type { AppCommandV4 } from '../../commands/v4/app-command.js'
import { createAppCommandBindingsV4, createAppCommandRuntimeV4 } from '../../commands/v4/app-command-runtime.js'
import { createAppCommandRegistryV4 } from '../../commands/v4/app-command-registry.js'
import { createInteractionStoreV4 } from '../../interaction/v4/interaction-store.js'
import type { SceneSelectionTargetV4 } from '../../interaction/v4/scene-selection.js'
import { SceneContextMenuV4 } from './SceneContextMenu.js'
import { composeSceneContextCommandsV4 } from './scene-context-commands.js'
import type { SceneCommandServiceV4 } from './scene-command-service.js'

const IDENTITY: RigidTransformV4 = Object.freeze({
  positionM: [0, 0, 0] as const,
  quaternion: [0, 0, 0, 1] as const,
})
const INSETS = Object.freeze({ top: 0, right: 0, bottom: 0, left: 0 })

function entity(id: string, name: string, groupId: string | null, removable = true): SpatialEntityV4 {
  return {
    id, name, geometry: { kind: 'box', dimensionsM: [1, 1, 1], color: '#808080' },
    parentFrameId: 'world', localPose: { positionM: [0.1, 0.2, 0.3], quaternion: [0, 0, 0, 1] },
    visible: true, groupId, removable, transformOwner: 'manual',
    numericStatus: { value: 0, sourceOwnership: 'manual', overlay: { visible: false, frameId: null } },
    graspable: true,
    graspFrames: [{ frameId: `${id}-grasp`, name: 'Grip', localPose: IDENTITY }],
    movingFrames: [
      { frameId: `${id}-moving`, name: 'Manual Moving', parentFrameId: 'mcp', localPose: IDENTITY, sourceOwnership: 'manual' },
      { frameId: `${id}-live`, name: 'Live Moving', parentFrameId: 'world', localPose: IDENTITY, sourceOwnership: 'simulation' },
    ],
  }
}

function project(): WorkcellProjectV4 {
  const source = projectAtLimit('robots', 2)
  return validateWorkcellProjectV4({
    ...source, revisionId: 'revision-scene-context',
    scene: { frames: [...source.scene.frames, { id: 'fixture-frame', name: 'Fixture Frame', parentFrameId: 'mcp', localPose: IDENTITY, role: 'custom' }] },
    robots: source.robots.map((robot, index) => ({ ...robot, localBasePose: { positionM: [index + 1, 0, 0], quaternion: [0, 0, 0, 1] } })),
    sceneGroups: [
      { id: 'group-root', name: 'Root Group', parentGroupId: null, visible: true },
      { id: 'group-child', name: 'Child Group', parentGroupId: 'group-root', visible: true },
    ],
    spatialEntities: [entity('entity-a', 'Part A', 'group-child'), entity('entity-fixed', 'Fixed Part', null, false)],
  })
}

function commands() {
  const service = {
    createBox: vi.fn(async () => 'new-box'), createCylinder: vi.fn(async () => 'new-cylinder'), createGroup: vi.fn(async () => 'new-group'),
    rename: vi.fn(async () => undefined), setPersistedVisibility: vi.fn(async (): Promise<void> => {}),
    setSpatialEntityLocalPose: vi.fn(async () => undefined), setSpatialEntityGroup: vi.fn(async () => undefined),
    setRobotBase: vi.fn(async () => undefined), setSelectedToolFrames: vi.fn(async () => undefined),
    setSceneFrameLocalPose: vi.fn(async () => undefined), setMovingFrame: vi.fn(async () => undefined),
    setNumericStatus: vi.fn(async () => undefined), setStatusOverlayVisible: vi.fn(async () => undefined),
    reparentGroup: vi.fn(async () => undefined), ungroup: vi.fn(async () => undefined),
    deleteSpatialEntity: vi.fn(async () => undefined), deleteGroupAndContents: vi.fn(async () => undefined),
  }
  return { service: service as unknown as SceneCommandServiceV4, spies: service }
}

function command(
  id: string,
  label: string,
  execute: () => void | 'cancelled' | Promise<void | 'cancelled'>,
): AppCommandV4 {
  return { id, label, section: 'view', kind: 'action', visible: true, enabled: true, execute }
}

function renderMenu(selection: SceneSelectionTargetV4 | null) {
  const workcell = project()
  const interaction = createInteractionStoreV4()
  interaction.getState().replaceProject(workcell)
  if (selection !== null) interaction.getState().select(selection)
  const scene = commands()
  const invocation = {
    'view.fitAll': vi.fn(),
    'view.focusSelection': vi.fn(),
    'view.collision.open': vi.fn(),
  }
  const presentation = { openRobotBase: vi.fn(), openInspector: vi.fn() }
  const composed = composeSceneContextCommandsV4({
    project: workcell, interaction, scene: scene.service,
    prompt: { requestText: vi.fn(async () => 'Renamed') }, presentation,
  })
  const runtime = createAppCommandRuntimeV4(createAppCommandRegistryV4([
    ...composed,
    command('view.fitAll', 'Fit All', invocation['view.fitAll']),
    command('view.focusSelection', 'Focus', invocation['view.focusSelection']),
    command('view.collision.open', 'Open Collision', invocation['view.collision.open']),
  ]))
  const commandBindings = createAppCommandBindingsV4(runtime)
  const onClose = vi.fn()
  const request = { selection, position: { x: 10, y: 20 } }
  const result = render(<SceneContextMenuV4 commandBindings={commandBindings} interaction={interaction} onClose={onClose} project={workcell} request={request} safeAreaInsets={INSETS} />)
  const rerenderMenu = (next: SceneSelectionTargetV4 | null, position = { x: 10, y: 20 }, nextProject = workcell) => {
    if (next === null) interaction.getState().clearSelection()
    else interaction.getState().select(next)
    result.rerender(<SceneContextMenuV4 commandBindings={commandBindings} interaction={interaction} onClose={onClose} project={nextProject} request={{ selection: next, position }} safeAreaInsets={INSETS} />)
  }
  return { ...result, workcell, interaction, scene, invocation, presentation, runtime, commandBindings, onClose, request, rerenderMenu }
}

function labels(): string[] { return screen.getAllByRole('menuitem').map((item) => item.textContent ?? '') }

describe('SceneContextMenuV4', () => {
  it('renders the full reviewed target matrix from shared command IDs without modal or deferred controls', () => {
    const applicationRoot = document.createElement('div'); applicationRoot.id = 'root'; document.body.append(applicationRoot)
    const harness = renderMenu(null)
    expect(screen.getByRole('menu', { name: 'Scene actions' })).toBeVisible()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(applicationRoot).not.toHaveAttribute('inert')
    expect(labels()).toEqual(['Add Group', 'Add Box', 'Add Cylinder', 'Fit All', 'Show All'])
    const cases: readonly [SceneSelectionTargetV4, readonly string[]][] = [
      [{ kind: 'robot', robotId: 'robot-1' }, ['Focus', 'Copy Pose', 'Paste Pose', 'Reset Pose', 'Hide', 'Isolate', 'Edit Robot Base', 'Open Collision']],
      [{ kind: 'robot-link', robotId: 'robot-1', linkId: 'L0' }, ['Focus', 'Hide Robot', 'Isolate', 'Open Collision']],
      [{ kind: 'spatial-entity', entityId: 'entity-a' }, ['Focus', 'Rename', 'Copy Pose', 'Paste Pose', 'Reset Pose', 'Move to Group', 'Remove from Group', 'Hide', 'Isolate', 'Delete', 'Open Collision']],
      [{ kind: 'scene-group', groupId: 'group-root' }, ['Focus', 'Rename', 'Move Group', 'Ungroup', 'Hide', 'Isolate', 'Delete Group and Contents']],
      [{ kind: 'scene-frame', frameId: 'world' }, ['Focus', 'Rename']],
      [{ kind: 'scene-frame', frameId: 'fixture-frame' }, ['Focus', 'Rename', 'Edit Frame']],
      [{ kind: 'robot-frame', robotId: 'robot-2', frameId: 'TCP' }, ['Focus', 'Coordinate Details']],
      [{ kind: 'entity-frame', entityId: 'entity-a', frameId: 'entity-a-grasp' }, ['Focus']],
      [{ kind: 'entity-frame', entityId: 'entity-a', frameId: 'entity-a-moving' }, ['Focus', 'Edit Moving Frame']],
      [{ kind: 'entity-frame', entityId: 'entity-a', frameId: 'entity-a-live' }, ['Focus']],
    ]
    for (const [selection, expected] of cases) {
      harness.rerenderMenu(selection)
      expect(labels()).toEqual(expected)
      expect(screen.queryByText(/Mechanics|Geometry|STEP Import|Linear Axis|Automatic Grasp|Attach|Detach/i)).not.toBeInTheDocument()
    }
    applicationRoot.remove()
  })

  it('executes distinct composed command IDs with their exact owner targets', async () => {
    const user = userEvent.setup()
    const harness = renderMenu(null)
    await user.click(screen.getByRole('menuitem', { name: 'Add Group' }))
    expect(harness.scene.spies.createGroup).toHaveBeenCalledWith('Group', null)
    harness.rerenderMenu({ kind: 'robot-link', robotId: 'robot-1', linkId: 'L0' })
    await user.click(screen.getByRole('menuitem', { name: 'Focus' }))
    await user.click(screen.getByRole('menuitem', { name: 'Open Collision' }))
    expect(harness.invocation['view.focusSelection']).toHaveBeenCalledOnce()
    expect(harness.invocation['view.collision.open']).toHaveBeenCalledOnce()
    harness.rerenderMenu({ kind: 'robot', robotId: 'robot-2' })
    await user.click(screen.getByRole('menuitem', { name: 'Edit Robot Base' }))
    expect(harness.presentation.openRobotBase).toHaveBeenCalledWith('robot-2')
    harness.rerenderMenu({ kind: 'entity-frame', entityId: 'entity-a', frameId: 'entity-a-moving' })
    await user.click(screen.getByRole('menuitem', { name: 'Edit Moving Frame' }))
    expect(harness.presentation.openInspector).toHaveBeenCalledWith({ selection: { kind: 'entity-frame', entityId: 'entity-a', frameId: 'entity-a-moving' }, section: 'parent' })
  })

  it('creates deterministic empty-space primitives and routes Fit All and Show All through their own shared IDs', async () => {
    const user = userEvent.setup(); const harness = renderMenu(null); const originalProject = harness.workcell
    harness.interaction.getState().isolate({ kind: 'robot', robotId: 'robot-1' })
    await user.click(screen.getByRole('menuitem', { name: 'Add Box' }))
    expect(harness.scene.spies.createBox).toHaveBeenCalledWith({ name: 'Box', parentFrameId: 'mcp', localPose: IDENTITY, dimensionsM: [0.1, 0.1, 0.1], color: '#38BDF8', groupId: null })
    await user.click(screen.getByRole('menuitem', { name: 'Add Cylinder' }))
    expect(harness.scene.spies.createCylinder).toHaveBeenCalledWith({ name: 'Cylinder', parentFrameId: 'mcp', localPose: IDENTITY, radiusM: 0.05, heightM: 0.1, color: '#38BDF8', groupId: null })
    await user.click(screen.getByRole('menuitem', { name: 'Fit All' }))
    expect(harness.invocation['view.fitAll']).toHaveBeenCalledOnce()
    await user.click(screen.getByRole('menuitem', { name: 'Show All' }))
    expect(harness.interaction.getState().isolation).toBeNull()
    expect(harness.workcell).toBe(originalProject)
  })

  it('uses the interaction clipboard and selection state through the shared registry', async () => {
    const user = userEvent.setup(); const harness = renderMenu({ kind: 'robot', robotId: 'robot-1' })
    expect(screen.getByRole('menuitem', { name: 'Paste Pose' })).toBeDisabled()
    await user.click(screen.getByRole('menuitem', { name: 'Copy Pose' }))
    expect(harness.interaction.getState().transformClipboard).toEqual({ positionM: [1, 0, 0], quaternion: [0, 0, 0, 1] })
    expect(screen.getByRole('menuitem', { name: 'Paste Pose' })).toBeEnabled()
    await user.click(screen.getByRole('menuitem', { name: 'Paste Pose' }))
    expect(harness.scene.spies.setRobotBase).toHaveBeenCalledWith(expect.objectContaining({ robotId: 'robot-1', localBasePose: { positionM: [1, 0, 0], quaternion: [0, 0, 0, 1] } }))
    harness.rerenderMenu({ kind: 'spatial-entity', entityId: 'entity-a' })
    await user.click(screen.getByRole('menuitem', { name: 'Reset Pose' }))
    expect(harness.scene.spies.setSpatialEntityLocalPose).toHaveBeenCalledWith('entity-a', IDENTITY)
  })

  it('clears a hidden target only after its shared command completes and keeps a failure visible', async () => {
    const user = userEvent.setup(); const harness = renderMenu({ kind: 'spatial-entity', entityId: 'entity-a' })
    let reject!: (reason: Error) => void
    harness.scene.spies.setPersistedVisibility.mockImplementationOnce(() => new Promise<undefined>((_resolve, fail) => { reject = fail }))
    await user.click(screen.getByRole('menuitem', { name: 'Hide' }))
    expect(harness.interaction.getState().selection).toEqual({ kind: 'spatial-entity', entityId: 'entity-a' })
    reject(new Error('visibility failed'))
    const failure = await screen.findByRole('alert')
    expect(failure).toHaveTextContent('visibility failed')
    expect(failure.parentElement).toBe(screen.getByRole('menu').parentElement)
    expect(screen.getByRole('menu')).not.toContainElement(failure)
    expect(harness.interaction.getState().selection).toEqual({ kind: 'spatial-entity', entityId: 'entity-a' })
    expect(harness.onClose).not.toHaveBeenCalled()

    let resolve!: () => void
    harness.scene.spies.setPersistedVisibility.mockImplementationOnce(() => new Promise<undefined>((done) => { resolve = () => done(undefined) }))
    await user.click(screen.getByRole('menuitem', { name: 'Hide' }))
    expect(harness.interaction.getState().selection).not.toBeNull()
    resolve()
    await waitFor(() => expect(harness.interaction.getState().selection).toBeNull())
  })

  it('reports revision-qualified and missing structured targets as stale instead of falling back to empty-space commands', () => {
    const revision = renderMenu({ kind: 'robot', robotId: 'robot-1' })
    revision.interaction.getState().replaceProject({ ...revision.workcell, revisionId: 'new-revision' })
    revision.rerender(<SceneContextMenuV4 commandBindings={revision.commandBindings} interaction={revision.interaction} onClose={revision.onClose} project={revision.workcell} request={revision.request} safeAreaInsets={INSETS} />)
    expect(screen.getByRole('alert')).toHaveTextContent(/no longer available/i)
    expect(screen.queryByRole('menuitem')).not.toBeInTheDocument()
    revision.unmount()
    const missing = renderMenu(null)
    missing.rerender(<SceneContextMenuV4 commandBindings={missing.commandBindings} interaction={missing.interaction} onClose={missing.onClose} project={missing.workcell} request={{ selection: { kind: 'robot-frame', robotId: 'robot-1', frameId: 'missing' }, position: { x: 10, y: 20 } }} safeAreaInsets={INSETS} />)
    expect(screen.getByRole('alert')).toHaveTextContent(/no longer available/i)
    expect(screen.queryByRole('menuitem')).not.toBeInTheDocument()
    expect(missing.scene.spies.createBox).not.toHaveBeenCalled()
  })

  it('closes the same request when its command publishes a newer project revision before completing', async () => {
    const user = userEvent.setup(); const harness = renderMenu({ kind: 'robot', robotId: 'robot-1' })
    let resolve!: () => void
    harness.scene.spies.setPersistedVisibility.mockImplementationOnce(() => new Promise<undefined>((done) => { resolve = () => done(undefined) }))
    await user.click(screen.getByRole('menuitem', { name: 'Hide' }))
    const published = validateWorkcellProjectV4({ ...harness.workcell, revisionId: 'published-revision' })
    harness.interaction.getState().replaceProject(published)
    harness.rerender(<SceneContextMenuV4 commandBindings={harness.commandBindings} interaction={harness.interaction} onClose={harness.onClose} project={published} request={harness.request} safeAreaInsets={INSETS} />)
    await act(async () => { resolve(); await Promise.resolve() })
    expect(harness.onClose).toHaveBeenCalledOnce()
  })

  it('keeps shared command-ID errors across replacement requests but never lets an old outcome close one', async () => {
    const user = userEvent.setup(); const selection = { kind: 'spatial-entity' as const, entityId: 'entity-a' }
    const harness = renderMenu(selection)
    let reject!: (reason: Error) => void
    harness.scene.spies.setPersistedVisibility.mockImplementationOnce(() => new Promise<undefined>((_resolve, fail) => { reject = fail }))
    await user.click(screen.getByRole('menuitem', { name: 'Hide' }))
    harness.rerenderMenu({ kind: 'robot', robotId: 'robot-2' }, { x: 30, y: 40 })
    await act(async () => { reject(new Error('obsolete')); await Promise.resolve() })
    expect(await screen.findByText('obsolete')).toBeVisible()
    expect(harness.onClose).not.toHaveBeenCalled()

    harness.rerenderMenu(selection)
    let resolve!: () => void
    harness.scene.spies.setPersistedVisibility.mockImplementationOnce(() => new Promise<undefined>((done) => { resolve = () => done(undefined) }))
    await user.click(screen.getByRole('menuitem', { name: 'Hide' }))
    expect(screen.queryByText('obsolete')).not.toBeInTheDocument()
    harness.rerenderMenu(selection) // A new object with the same target and position is still a new request.
    await act(async () => { resolve(); await Promise.resolve() })
    expect(harness.onClose).not.toHaveBeenCalled()
  })

  it('is single-flight per command ID and exposes the shared pending and error state', async () => {
    const harness = renderMenu({ kind: 'robot', robotId: 'robot-1' })
    let resolve!: () => void
    harness.scene.spies.setPersistedVisibility.mockImplementationOnce(() => new Promise<undefined>((done) => { resolve = () => done(undefined) }))
    const hide = screen.getByRole('menuitem', { name: 'Hide' })
    act(() => {
      hide.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      hide.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    await waitFor(() => expect(harness.scene.spies.setPersistedVisibility).toHaveBeenCalledOnce())
    expect(harness.runtime.getState().pendingCommandIds.has('scene.visibility.toggle')).toBe(true)
    expect(hide).toBeDisabled()
    resolve()
    await waitFor(() => expect(harness.runtime.getState().pendingCommandIds.size).toBe(0))
    expect(harness.scene.spies.setPersistedVisibility).toHaveBeenCalledOnce()
  })

  it('keeps completed, cancelled, ignored, and failed shared outcomes correctly anchored', async () => {
    const user = userEvent.setup(); const harness = renderMenu(null)
    const group = screen.getByRole('menuitem', { name: 'Add Group' })
    await user.click(group)
    expect(harness.onClose).toHaveBeenCalledOnce()
    const cancel = command('model.add.group', 'Add Group', (): 'cancelled' => 'cancelled')
    harness.runtime.replaceRegistry(createAppCommandRegistryV4([cancel, command('model.add.box', 'Add Box', () => undefined), command('model.add.cylinder', 'Add Cylinder', () => undefined), command('view.fitAll', 'Fit All', () => undefined), command('scene.showAll', 'Show All', () => undefined)]))
    await user.click(screen.getByRole('menuitem', { name: 'Add Group' }))
    expect(harness.onClose).toHaveBeenCalledOnce()
    expect(await harness.runtime.invoke('missing.command')).toBe('ignored')
    harness.runtime.replaceRegistry(createAppCommandRegistryV4([command('model.add.group', 'Add Group', () => { throw new Error('registry failed') }), command('model.add.box', 'Add Box', () => undefined), command('model.add.cylinder', 'Add Cylinder', () => undefined), command('view.fitAll', 'Fit All', () => undefined), command('scene.showAll', 'Show All', () => undefined)]))
    await user.click(screen.getByRole('menuitem', { name: 'Add Group' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('registry failed')
    expect(harness.onClose).toHaveBeenCalledOnce()
  })

  it('is non-modal and returns focus after Escape, Tab, Shift+Tab, and a completed command', async () => {
    const user = userEvent.setup()
    const harness = renderMenu(null)
    harness.unmount()
    function Controlled({ keyName }: { readonly keyName: string }) {
      const [open, setOpen] = useState(false)
      return <><button onClick={() => setOpen(true)} type="button">Trigger {keyName}</button>{open ? <SceneContextMenuV4 commandBindings={harness.commandBindings} interaction={harness.interaction} onClose={() => setOpen(false)} project={harness.workcell} request={{ selection: null, position: { x: 10, y: 20 } }} safeAreaInsets={INSETS} /> : null}</>
    }
    const keys = ['{Escape}', '{Tab}', '{Shift>}{Tab}{/Shift}']
    for (const keyName of keys) {
      const view = render(<Controlled keyName={keyName} />)
      const trigger = screen.getByRole('button', { name: `Trigger ${keyName}` }); await user.click(trigger)
      await user.keyboard(keyName)
      expect(screen.queryByRole('menu')).not.toBeInTheDocument(); expect(trigger).toHaveFocus()
      view.unmount()
    }
    const completed = render(<Controlled keyName="completed" />)
    const trigger = screen.getByRole('button', { name: 'Trigger completed' }); await user.click(trigger)
    await user.click(screen.getByRole('menuitem', { name: 'Add Group' }))
    expect(screen.queryByRole('menu')).not.toBeInTheDocument(); expect(trigger).toHaveFocus()
    completed.unmount()
  })

  it('closes on capture-phase outside pointerdown without stealing that control focus', async () => {
    const user = userEvent.setup(); const harness = renderMenu(null)
    harness.unmount()
    function Controlled() { const [open, setOpen] = useState(false); return <><button onClick={() => setOpen(true)} type="button">Open menu</button><button type="button">Outside control</button>{open ? <SceneContextMenuV4 commandBindings={harness.commandBindings} interaction={harness.interaction} onClose={() => setOpen(false)} project={harness.workcell} request={{ selection: null, position: { x: 10, y: 20 } }} safeAreaInsets={INSETS} /> : null}</> }
    render(<Controlled />)
    await user.click(screen.getByRole('button', { name: 'Open menu' }))
    const outside = screen.getByRole('button', { name: 'Outside control' }); await user.click(outside)
    expect(screen.queryByRole('menu')).not.toBeInTheDocument(); expect(outside).toHaveFocus()
  })

  it('recovers the original focus owner when a replacement request closes on Escape', async () => {
    const user = userEvent.setup(); const harness = renderMenu(null); harness.unmount()
    const initial = { selection: null, position: { x: 10, y: 20 } }
    const replacement = { selection: { kind: 'robot' as const, robotId: 'robot-1' }, position: { x: 30, y: 40 } }
    let request: typeof initial | typeof replacement | null = null
    let rerenderTree!: () => void
    const close = () => { request = null; rerenderTree() }
    const tree = () => <><button type="button">Open menu</button>{request === null ? null : <SceneContextMenuV4 commandBindings={harness.commandBindings} interaction={harness.interaction} onClose={close} project={harness.workcell} request={request} safeAreaInsets={INSETS} />}</>
    const rendered = render(tree()); rerenderTree = () => rendered.rerender(tree())
    const trigger = screen.getByRole('button', { name: 'Open menu' }); trigger.focus()
    request = initial; rerenderTree(); harness.interaction.getState().select(replacement.selection)
    request = replacement; rerenderTree()
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('menu')).not.toBeInTheDocument(); expect(trigger).toHaveFocus()
  })

  it('clamps and scrolls inside a tiny four-inset safe rectangle and supports arrow navigation', async () => {
    const user = userEvent.setup()
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function boundsForSafeArea(this: HTMLElement) {
      const constrained = this.classList.contains('scene-context-menu-presentation-v4')
        && this.style.maxWidth === '0px'
      const width = constrained ? 0 : 300
      return { x: 0, y: 0, top: 0, left: 0, right: width, bottom: 300, width, height: 300, toJSON: () => ({}) }
    })
    const harness = renderMenu(null)
    harness.rerender(<SceneContextMenuV4 commandBindings={harness.commandBindings} interaction={harness.interaction} onClose={harness.onClose} project={harness.workcell} request={{ selection: null, position: { x: 400, y: 500 } }} safeAreaInsets={{ top: 11, right: window.innerWidth, bottom: 17, left: 19 }} />)
    const menu = screen.getByRole('menu')
    const presentation = menu.parentElement as HTMLElement
    expect(presentation).toHaveStyle({ left: '19px', top: '451px', maxWidth: '0px' })
    expect(presentation.getBoundingClientRect().width).toBeLessThanOrEqual(0)
    expect(screen.getByRole('menuitem', { name: 'Add Group' })).toHaveFocus()
    await user.keyboard('{ArrowDown}'); expect(screen.getByRole('menuitem', { name: 'Add Box' })).toHaveFocus()
    await user.keyboard('{End}'); expect(screen.getByRole('menuitem', { name: 'Fit All' })).toHaveFocus()
    await user.keyboard('{Home}'); expect(screen.getByRole('menuitem', { name: 'Add Group' })).toHaveFocus()
  })
})
