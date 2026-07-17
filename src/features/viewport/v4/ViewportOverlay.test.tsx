import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { makeMinimalWorkcellProjectV4 } from '../../../core/project-v4/test-support.js'
import { createCoordinateDisplayStoreV4 } from '../../frames/v4/coordinate-display-store.js'
import { createJobRuntimeStoreV4 } from '../../jobs/v4/job-runtime-store.js'
import { createInteractionStoreV4 } from '../../interaction/v4/interaction-store.js'
import { createRobotRuntimeRegistryV4 } from '../../robot/v4/robot-runtime-registry.js'
import { selectSceneRuntimeV4 } from '../../scene/v4/scene-runtime-selector.js'
import { createViewportPreferenceStoreV4 } from './viewport-preference-store.js'
import { ViewportOverlayV4 } from './ViewportOverlay.js'
import type { ViewportRuntimeControllerV4 } from './viewport-runtime.js'

function actions(): ViewportRuntimeControllerV4['actions'] {
  return {
    home: vi.fn(),
    fitAll: vi.fn(),
    focusSelection: vi.fn(),
    setStandardView: vi.fn(),
  }
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

describe('ViewportOverlayV4', () => {
  it('routes World camera controls and disables unresolved Focus', async () => {
    const user = userEvent.setup()
    const data = fixture()
    const camera = actions()
    render(
      <ViewportOverlayV4
        actions={camera}
        canFocusSelection={false}
        display={data.display}
        preferences={data.preferences}
        project={data.project}
        runtime={data.runtime}
        selection={{ kind: 'robot', robotId: 'robot-1' }}
      />,
    )

    expect(screen.getByLabelText('World view cube')).toHaveAttribute('data-reference', 'world')
    expect(screen.getByRole('button', { name: 'Focus Selection' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'Home View' }))
    await user.click(screen.getByRole('button', { name: 'Fit All' }))
    await user.click(screen.getByRole('button', { name: 'Top view' }))
    expect(camera.home).toHaveBeenCalledOnce()
    expect(camera.fitAll).toHaveBeenCalledOnce()
    expect(camera.setStandardView).toHaveBeenCalledWith('top')
  })

  it('toggles exactly Grid, World, MCP, Base, and TCP browser view layers', async () => {
    const user = userEvent.setup()
    const data = fixture()
    render(
      <ViewportOverlayV4
        actions={actions()}
        canFocusSelection
        display={data.display}
        preferences={data.preferences}
        project={data.project}
        runtime={data.runtime}
        selection={{ kind: 'robot', robotId: 'robot-1' }}
      />,
    )

    for (const name of [
      'Grid',
      'World Frame',
      'Machine Centric Point Frames',
      'Selected Robot Base Frame',
      'Selected Robot Actual TCP Frame',
    ]) {
      await user.click(screen.getByRole('button', { name }))
    }
    expect(data.preferences.getState().layers).toEqual({
      grid: false,
      worldFrame: false,
      mcpFrame: false,
      baseFrame: false,
      tcpFrame: false,
    })
    expect(screen.getByLabelText('Coordinate status')).toBeVisible()
  })

  it('keeps Project, Robot, Job, and interaction state unchanged for camera actions', async () => {
    const user = userEvent.setup()
    const data = fixture()
    const camera = actions()
    const projectIdentity = data.project
    const robotRevision = data.robots.getState().projectRevisionId
    const jobState = data.jobs.getState()
    const selection = data.interaction.getState().selection
    render(
      <ViewportOverlayV4
        actions={camera}
        canFocusSelection
        display={data.display}
        preferences={data.preferences}
        project={data.project}
        runtime={data.runtime}
        selection={selection}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'Home View' }))
    await user.click(screen.getByRole('button', { name: 'Fit All' }))
    await user.click(screen.getByRole('button', { name: 'Focus Selection' }))
    expect(data.project).toBe(projectIdentity)
    expect(data.robots.getState().projectRevisionId).toBe(robotRevision)
    expect(data.jobs.getState()).toBe(jobState)
    expect(data.interaction.getState().selection).toBe(selection)
  })
})
