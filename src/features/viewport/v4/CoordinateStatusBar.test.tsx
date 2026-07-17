import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import {
  validateWorkcellProjectV4,
  type WorkcellProjectV4,
} from '../../../core/project-v4/index.js'
import {
  makeMinimalWorkcellProjectV4,
  projectAtLimit,
} from '../../../core/project-v4/test-support.js'
import { createCoordinateDisplayStoreV4 } from '../../frames/v4/coordinate-display-store.js'
import { createRobotRuntimeRegistryV4 } from '../../robot/v4/robot-runtime-registry.js'
import { selectSceneRuntimeV4 } from '../../scene/v4/scene-runtime-selector.js'
import { CoordinateStatusBarV4 } from './CoordinateStatusBar.js'
import { createViewportPreferenceStoreV4 } from './viewport-preference-store.js'

function projectWithOffsets(): WorkcellProjectV4 {
  const source = makeMinimalWorkcellProjectV4()
  return validateWorkcellProjectV4({
    ...source,
    revisionId: 'revision-status-bar',
    scene: {
      frames: source.scene.frames.map((frame) => frame.role === 'mcp'
        ? {
            ...frame,
            localPose: { positionM: [2, 0, 0], quaternion: [0, 0, 0, 1] },
          }
        : frame),
    },
    robots: source.robots.map((robot) => ({
      ...robot,
      localBasePose: { positionM: [1, 0, 0], quaternion: [0, 0, 0, 1] },
    })),
  })
}

function runtime(project: WorkcellProjectV4) {
  const robots = createRobotRuntimeRegistryV4()
  robots.getState().replaceProject(project)
  return selectSceneRuntimeV4(project, robots.getState())
}

describe('CoordinateStatusBarV4', () => {
  it('routes structured Pose Frame and generic Gizmo choices independently', async () => {
    const user = userEvent.setup()
    const project = projectWithOffsets()
    const display = createCoordinateDisplayStoreV4()
    const preferences = createViewportPreferenceStoreV4(null)
    display.getState().replaceProject(project)
    render(
      <CoordinateStatusBarV4
        display={display}
        preferences={preferences}
        project={project}
        runtime={runtime(project)}
        selection={{ kind: 'robot', robotId: 'robot-1' }}
      />,
    )

    expect(screen.getByLabelText('Pose Frame')).toHaveTextContent('World')
    expect(screen.getByLabelText('Pose Frame')).toHaveTextContent('MCP')
    expect(screen.getByLabelText('Pose Frame')).toHaveTextContent('Robot 1 / TCP')
    expect(screen.getByText('mm/deg')).toBeVisible()
    expect(screen.getByText('Intrinsic Z-Y-X RPY')).toBeVisible()
    expect(screen.getByLabelText('Actual TCP pose')).toHaveTextContent('X 3000.0')
    expect(screen.getByLabelText('Actual TCP pose')).toHaveTextContent('Rz 0.0')

    const mcpOption = Array.from(
      (screen.getByLabelText('Pose Frame') as HTMLSelectElement).options,
    ).find(({ text }) => text.includes('MCP'))!
    await user.selectOptions(screen.getByLabelText('Pose Frame'), mcpOption.value)
    expect(display.getState().poseFrame).toEqual({ kind: 'scene-frame', frameId: 'mcp' })
    expect(screen.getByLabelText('Actual TCP pose')).toHaveTextContent('X 1000.0')

    await user.selectOptions(screen.getByLabelText('Gizmo Frame'), 'parent')
    expect(preferences.getState().gizmoFrame).toBe('parent')
    expect(display.getState().poseFrame).toEqual({ kind: 'scene-frame', frameId: 'mcp' })
  })

  it('shows an explicit no-TCP state for non-Robot selection and zero Robots', () => {
    const project = projectWithOffsets()
    const display = createCoordinateDisplayStoreV4()
    display.getState().replaceProject(project)
    const preferences = createViewportPreferenceStoreV4(null)
    const { rerender } = render(
      <CoordinateStatusBarV4
        display={display}
        preferences={preferences}
        project={project}
        runtime={runtime(project)}
        selection={null}
      />,
    )
    expect(screen.getByLabelText('Actual TCP pose')).toHaveTextContent('Actual TCP: None')

    const zero = validateWorkcellProjectV4({
      ...makeMinimalWorkcellProjectV4(),
      revisionId: 'revision-status-zero',
      assetReferences: [],
      robotDefinitions: [],
      robots: [],
    })
    display.getState().replaceProject(zero)
    rerender(
      <CoordinateStatusBarV4
        display={display}
        preferences={preferences}
        project={zero}
        runtime={runtime(zero)}
        selection={null}
      />,
    )
    expect(screen.getByLabelText('Pose Frame')).toHaveTextContent('World')
    expect(screen.getByLabelText('Actual TCP pose')).toHaveTextContent('Actual TCP: None')
  })

  it('falls back to a scoped Frame while a two-Robot selection is reconciling', () => {
    const source = projectAtLimit('robots', 2)
    const project = validateWorkcellProjectV4({
      ...source,
      revisionId: 'revision-status-robot-switch',
      robots: source.robots.map((robot, index) => ({
        ...robot,
        localBasePose: {
          positionM: [index + 1, 0, 0],
          quaternion: [0, 0, 0, 1],
        },
      })),
    })
    const display = createCoordinateDisplayStoreV4()
    display.getState().replaceProject(project)
    display.getState().selectPoseFrame({
      kind: 'robot-frame',
      robotId: 'robot-1',
      frameId: 'TCP',
    })

    render(
      <CoordinateStatusBarV4
        display={display}
        preferences={createViewportPreferenceStoreV4(null)}
        project={project}
        runtime={runtime(project)}
        selection={{ kind: 'robot', robotId: 'robot-2' }}
      />,
    )

    expect(
      (screen.getByLabelText('Pose Frame') as HTMLSelectElement).selectedOptions[0],
    ).toHaveTextContent('World')
    expect(screen.getByLabelText('Actual TCP pose')).toHaveTextContent('robot-2 / TCP')
    expect(screen.getByLabelText('Actual TCP pose')).toHaveTextContent('X 2000.0')
  })
})
