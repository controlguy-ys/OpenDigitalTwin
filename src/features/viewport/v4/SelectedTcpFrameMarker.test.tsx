import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import {
  validateWorkcellProjectV4,
  type WorkcellProjectV4,
} from '../../../core/project-v4/index.js'
import {
  makeMinimalWorkcellProjectV4,
  projectAtLimit,
} from '../../../core/project-v4/test-support.js'
import { createRobotRuntimeRegistryV4 } from '../../robot/v4/robot-runtime-registry.js'
import { selectSceneRuntimeV4 } from '../../scene/v4/scene-runtime-selector.js'
import { SelectedTcpFrameMarkerV4 } from './SelectedTcpFrameMarker.js'

vi.mock('../TcpFrameMarker.js', () => ({
  TcpFrameMarker: ({ frameName, name, visible }: {
    readonly frameName: string
    readonly name: string
    readonly visible: boolean
  }) => visible ? <span data-frame-name={frameName} data-marker-name={name}>marker</span> : null,
}))

function projection(project: WorkcellProjectV4) {
  const robots = createRobotRuntimeRegistryV4()
  robots.getState().replaceProject(project)
  return selectSceneRuntimeV4(project, robots.getState())
}

function twoRobotProject(): WorkcellProjectV4 {
  const source = projectAtLimit('robots', 2)
  return validateWorkcellProjectV4({
    ...source,
    revisionId: 'selected-tcp-two-robots',
    robots: source.robots.map((robot, index) => ({
      ...robot,
      localBasePose: {
        positionM: [index + 1, 0, 0],
        quaternion: [0, 0, 0, 1],
      },
    })),
  })
}

describe('SelectedTcpFrameMarkerV4', () => {
  it('renders one copied Actual TCP marker at the selected Robot qualified pose', () => {
    const project = twoRobotProject()
    const { container, rerender } = render(
      <SelectedTcpFrameMarkerV4
        project={project}
        runtime={projection(project)}
        selection={{ kind: 'robot-link', robotId: 'robot-1', linkId: 'L0' }}
        visible
      />,
    )

    const first = container.querySelector('[data-selected-tcp-marker]')
    expect(first).toHaveAttribute('position', '1,0,0')
    expect(screen.getByText('marker')).toHaveAttribute('data-frame-name', 'Actual TCP')
    expect(screen.getByText('marker')).toHaveAttribute(
      'data-marker-name',
      'actual-tcp-robot-1-TCP',
    )

    rerender(
      <SelectedTcpFrameMarkerV4
        project={project}
        runtime={projection(project)}
        selection={{ kind: 'robot-frame', robotId: 'robot-2', frameId: 'TCP' }}
        visible
      />,
    )
    expect(container.querySelectorAll('[data-selected-tcp-marker]')).toHaveLength(1)
    expect(container.querySelector('[data-selected-tcp-marker]')).toHaveAttribute(
      'position',
      '2,0,0',
    )
  })

  it('omits the marker for non-Robot selection, disabled layer, or hidden selected Robot', () => {
    const source = makeMinimalWorkcellProjectV4()
    const hidden = validateWorkcellProjectV4({
      ...source,
      revisionId: 'selected-tcp-hidden',
      robots: source.robots.map((robot) => ({ ...robot, visible: false })),
    })
    const view = render(
      <SelectedTcpFrameMarkerV4
        project={source}
        runtime={projection(source)}
        selection={{ kind: 'scene-frame', frameId: 'world' }}
        visible
      />,
    )
    expect(view.container.querySelector('[data-selected-tcp-marker]')).toBeNull()

    view.rerender(
      <SelectedTcpFrameMarkerV4
        project={source}
        runtime={projection(source)}
        selection={{ kind: 'robot', robotId: 'robot-1' }}
        visible={false}
      />,
    )
    expect(view.container.querySelector('[data-selected-tcp-marker]')).toBeNull()

    view.rerender(
      <SelectedTcpFrameMarkerV4
        project={hidden}
        runtime={projection(hidden)}
        selection={{ kind: 'robot', robotId: 'robot-1' }}
        visible
      />,
    )
    expect(view.container.querySelector('[data-selected-tcp-marker]')).toBeNull()
  })

  it('fails closed for unresolved Robot or selected TCP identity', () => {
    const project = makeMinimalWorkcellProjectV4()
    const runtime = projection(project)
    const view = render(
      <SelectedTcpFrameMarkerV4
        project={project}
        runtime={runtime}
        selection={{ kind: 'robot', robotId: 'missing-robot' }}
        visible
      />,
    )
    expect(view.container.querySelector('[data-selected-tcp-marker]')).toBeNull()

    const robot = runtime.entities.get('robot-1')
    if (robot?.kind !== 'robot') throw new Error('Expected Robot runtime fixture.')
    const unresolved = {
      ...runtime,
      entities: new Map([
        ['robot-1', { ...robot, selectedTcpFrameId: 'missing-tcp' }],
      ]),
    }
    view.rerender(
      <SelectedTcpFrameMarkerV4
        project={project}
        runtime={unresolved}
        selection={{ kind: 'robot', robotId: 'robot-1' }}
        visible
      />,
    )
    expect(view.container.querySelector('[data-selected-tcp-marker]')).toBeNull()
  })
})
