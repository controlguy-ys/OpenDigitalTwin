import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { makeMinimalWorkcellProjectV4 } from '../../../core/project-v4/test-support.js'
import { createCoordinateDisplayStoreV4 } from '../../frames/v4/coordinate-display-store.js'
import { createJobRuntimeStoreV4 } from '../../jobs/v4/job-runtime-store.js'
import { createInteractionStoreV4 } from '../../interaction/v4/interaction-store.js'
import { createRobotRuntimeRegistryV4 } from '../../robot/v4/robot-runtime-registry.js'
import { selectSceneRuntimeV4 } from '../../scene/v4/scene-runtime-selector.js'
import { createViewportPreferenceStoreV4, type ViewportLayerV4, type ViewportPreferenceStoreV4 } from './viewport-preference-store.js'
import { ViewportOverlayV4 } from './ViewportOverlay.js'
import { createAppCommandBindingsV4, createAppCommandRuntimeV4 } from '../../commands/v4/app-command-runtime.js'
import { createAppCommandRegistryV4 } from '../../commands/v4/app-command-registry.js'

const IDS = [
  'view.home', 'view.fitAll', 'view.focusSelection',
  'view.orientation.isometric', 'view.orientation.top', 'view.orientation.front',
  'view.orientation.right', 'view.orientation.back', 'view.orientation.left', 'view.orientation.bottom',
  'view.layer.grid', 'view.layer.world', 'view.layer.mcp', 'view.layer.base', 'view.layer.tcp',
] as const
type CommandId = (typeof IDS)[number]
type CommandSpy = ReturnType<typeof vi.fn<() => void>>

const LAYERS_BY_ID: Partial<Record<CommandId, ViewportLayerV4>> = {
  'view.layer.grid': 'grid',
  'view.layer.world': 'worldFrame',
  'view.layer.mcp': 'mcpFrame',
  'view.layer.base': 'baseFrame',
  'view.layer.tcp': 'tcpFrame',
}

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve
    reject = nextReject
  })
  return { promise, resolve, reject }
}

function bindings(
  preferences: ViewportPreferenceStoreV4,
  overrides: Partial<Record<CommandId, () => void | Promise<void>>> = {},
  unavailable: { readonly hidden?: CommandId; readonly disabled?: CommandId } = {},
) {
  const calls = Object.fromEntries(IDS.map((id) => [
    id,
    vi.fn<() => void>(),
  ])) as Record<CommandId, CommandSpy>
  const runtime = createAppCommandRuntimeV4(createAppCommandRegistryV4(IDS.map((id) => ({
    id,
    label: id,
    section: 'view' as const,
    kind: 'action' as const,
    visible: id !== unavailable.hidden,
    enabled: id !== 'view.focusSelection' && id !== unavailable.disabled,
    get checked() {
      const layer = LAYERS_BY_ID[id]
      return layer === undefined ? false : preferences.getState().layers[layer]
    },
    execute: () => {
      calls[id]()
      const override = overrides[id]
      if (override !== undefined) return override()
      const layer = LAYERS_BY_ID[id]
      if (layer !== undefined) preferences.getState().setLayer(layer, !preferences.getState().layers[layer])
    },
  }))))
  return { calls, runtime, commandBindings: createAppCommandBindingsV4(runtime) }
}

function fixture() {
  const project = makeMinimalWorkcellProjectV4()
  const robots = createRobotRuntimeRegistryV4()
  robots.getState().replaceProject(project)
  const jobs = createJobRuntimeStoreV4()
  jobs.getState().replaceProject(project)
  const interaction = createInteractionStoreV4()
  interaction.getState().replaceProject(project)
  const display = createCoordinateDisplayStoreV4()
  display.getState().replaceProject(project)
  return {
    project,
    runtime: selectSceneRuntimeV4(project, robots.getState()),
    robots,
    jobs,
    interaction,
    display,
    preferences: createViewportPreferenceStoreV4(null),
  }
}

function overlay(data: ReturnType<typeof fixture>, commandBindings: ReturnType<typeof bindings>['commandBindings']) {
  return <ViewportOverlayV4
    commandBindings={commandBindings}
    display={data.display}
    preferences={data.preferences}
    project={data.project}
    runtime={data.runtime}
    selection={{ kind: 'robot', robotId: 'robot-1' }}
    safeAreaInsets={{ top: 0, right: 0, bottom: 0, left: 0 }}
  />
}

describe('ViewportOverlayV4', () => {
  it('routes Home, Fit, and accessible standard-view controls to their own shared IDs', async () => {
    const user = userEvent.setup()
    const data = fixture()
    const commands = bindings(data.preferences)
    render(overlay(data, commands.commandBindings))

    expect(screen.getByRole('button', { name: 'Focus Selection' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'Home View' }))
    await user.click(screen.getByRole('button', { name: 'Fit All' }))
    await user.selectOptions(screen.getByLabelText('View orientation'), 'top')
    expect(commands.calls['view.home']).toHaveBeenCalledOnce()
    expect(commands.calls['view.fitAll']).toHaveBeenCalledOnce()
    expect(commands.calls['view.orientation.top']).toHaveBeenCalledOnce()
    expect(commands.calls['view.orientation.bottom']).not.toHaveBeenCalled()
  })

  it('keeps Project state immutable while the accessible fallback invokes its exact standard-view ID', async () => {
    const user = userEvent.setup()
    const data = fixture()
    const projectIdentity = data.project
    const commands = bindings(data.preferences)
    render(overlay(data, commands.commandBindings))

    await user.selectOptions(screen.getByLabelText('View orientation'), 'bottom')
    expect(commands.calls['view.orientation.bottom']).toHaveBeenCalledOnce()
    expect(screen.getByLabelText('View orientation')).toHaveValue('')
    expect(data.project).toBe(projectIdentity)
  })

  it('mutates exactly the five reviewed browser layer preferences through their matching command IDs', async () => {
    const user = userEvent.setup()
    const data = fixture()
    const commands = bindings(data.preferences)
    render(<ViewportOverlayV4
      commandBindings={commands.commandBindings}
      display={data.display}
      preferences={data.preferences}
      project={data.project}
      runtime={data.runtime}
      selection={{ kind: 'robot', robotId: 'robot-1' }}
      safeAreaInsets={{ top: Number.NaN, right: 3, bottom: -1, left: Number.POSITIVE_INFINITY }}
    />)

    const cases: readonly [CommandId, string, ViewportLayerV4][] = [
      ['view.layer.grid', 'Grid', 'grid'],
      ['view.layer.world', 'World Frame', 'worldFrame'],
      ['view.layer.mcp', 'Machine Centric Point Frames', 'mcpFrame'],
      ['view.layer.base', 'Selected Robot Base Frame', 'baseFrame'],
      ['view.layer.tcp', 'Selected Robot Actual TCP Frame', 'tcpFrame'],
    ]
    for (const [id, label, layer] of cases) {
      const before = Object.fromEntries(cases.map(([candidate]) => [candidate, commands.calls[candidate].mock.calls.length])) as Record<CommandId, number>
      const layersBefore = data.preferences.getState().layers
      await user.click(screen.getByRole('button', { name: label }))
      expect(commands.calls[id]).toHaveBeenCalledTimes(before[id] + 1)
      expect(data.preferences.getState().layers[layer]).toBe(false)
      expect(screen.getByRole('button', { name: label })).toHaveAttribute('aria-pressed', 'false')
      for (const [otherId, , otherLayer] of cases) {
        if (otherId !== id) {
          expect(commands.calls[otherId]).toHaveBeenCalledTimes(before[otherId])
          expect(data.preferences.getState().layers[otherLayer]).toBe(layersBefore[otherLayer])
        }
      }
    }
    expect(screen.getByLabelText('Coordinate status')).toBeVisible()
  })

  it('shares pending and error state for one layer command across two overlay surfaces', async () => {
    const user = userEvent.setup()
    const data = fixture()
    const gate = deferred<void>()
    const commands = bindings(data.preferences, { 'view.layer.grid': () => gate.promise })
    render(<>
      <section aria-label="first overlay">{overlay(data, commands.commandBindings)}</section>
      <section aria-label="second overlay">{overlay(data, commands.commandBindings)}</section>
    </>)
    const first = within(screen.getByRole('region', { name: 'first overlay' }))
    const second = within(screen.getByRole('region', { name: 'second overlay' }))

    await user.click(first.getByRole('button', { name: 'Grid' }))
    expect(commands.calls['view.layer.grid']).toHaveBeenCalledOnce()
    expect(first.getByRole('button', { name: 'Grid' })).toBeDisabled()
    expect(second.getByRole('button', { name: 'Grid' })).toBeDisabled()
    act(() => gate.reject(new Error('Grid update failed')))
    await waitFor(() => expect(screen.getAllByRole('alert')).toHaveLength(2))
    expect(screen.getAllByRole('alert').every((alert) => alert.textContent === 'Grid update failed')).toBe(true)
    expect(data.preferences.getState().layers.grid).toBe(true)
  })

  it('shares checked, hidden, and disabled layer command presentation across two overlays', async () => {
    const user = userEvent.setup()
    const data = fixture()
    const commands = bindings(data.preferences, {}, {
      hidden: 'view.layer.tcp',
      disabled: 'view.layer.base',
    })
    render(<>
      <section aria-label="first overlay">{overlay(data, commands.commandBindings)}</section>
      <section aria-label="second overlay">{overlay(data, commands.commandBindings)}</section>
    </>)
    const first = within(screen.getByRole('region', { name: 'first overlay' }))
    const second = within(screen.getByRole('region', { name: 'second overlay' }))

    expect(first.getByRole('button', { name: 'Selected Robot Base Frame' })).toBeDisabled()
    expect(second.getByRole('button', { name: 'Selected Robot Base Frame' })).toBeDisabled()
    expect(first.getByRole('button', { name: 'Selected Robot Actual TCP Frame' })).toBeDisabled()
    expect(second.getByRole('button', { name: 'Selected Robot Actual TCP Frame' })).toBeDisabled()

    await user.click(first.getByRole('button', { name: 'World Frame' }))
    expect(commands.calls['view.layer.world']).toHaveBeenCalledOnce()
    expect(first.getByRole('button', { name: 'World Frame' })).toHaveAttribute('aria-pressed', 'false')
    expect(second.getByRole('button', { name: 'World Frame' })).toHaveAttribute('aria-pressed', 'false')
    expect(commands.calls['view.layer.base']).not.toHaveBeenCalled()
    expect(commands.calls['view.layer.tcp']).not.toHaveBeenCalled()
  })

  it('keeps Project, Robot, Job, and interaction state unchanged for camera actions', async () => {
    const user = userEvent.setup()
    const data = fixture()
    const projectIdentity = data.project
    const robotRevision = data.robots.getState().projectRevisionId
    const jobState = data.jobs.getState()
    const selection = data.interaction.getState().selection
    const commands = bindings(data.preferences)
    render(overlay(data, commands.commandBindings))

    await user.click(screen.getByRole('button', { name: 'Home View' }))
    await user.click(screen.getByRole('button', { name: 'Fit All' }))
    await user.click(screen.getByRole('button', { name: 'Focus Selection' }))
    expect(data.project).toBe(projectIdentity)
    expect(data.robots.getState().projectRevisionId).toBe(robotRevision)
    expect(data.jobs.getState()).toBe(jobState)
    expect(data.interaction.getState().selection).toBe(selection)
  })
})
