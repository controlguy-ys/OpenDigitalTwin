import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import {
  validateWorkcellProjectV4,
  type WorkcellProjectV4,
} from '../../../core/project-v4/index.js'
import { makeMinimalWorkcellProjectV4 } from '../../../core/project-v4/test-support.js'
import { createRobotRuntimeRegistryV4 } from '../../robot/v4/robot-runtime-registry.js'
import { selectSceneRuntimeV4 } from '../../scene/v4/scene-runtime-selector.js'
import { CoordinateFrameLayersV4 } from './CoordinateFrameLayers.js'
import type { ViewportLayerV4 } from './viewport-preference-store.js'

vi.mock('../TcpFrameMarker.js', () => ({
  TcpFrameMarker: ({ frameName, name, visible }: {
    readonly frameName: string
    readonly name: string
    readonly visible: boolean
  }) => visible ? <span data-frame-name={frameName} data-marker-name={name}>triad</span> : null,
}))

const ALL_LAYERS: Readonly<Record<ViewportLayerV4, boolean>> = {
  grid: true,
  worldFrame: true,
  mcpFrame: true,
  baseFrame: true,
  tcpFrame: true,
}

function projection(project: WorkcellProjectV4) {
  const robots = createRobotRuntimeRegistryV4()
  robots.getState().replaceProject(project)
  return selectSceneRuntimeV4(project, robots.getState())
}

function layeredProject(): WorkcellProjectV4 {
  const source = makeMinimalWorkcellProjectV4()
  return validateWorkcellProjectV4({
    ...source,
    revisionId: 'coordinate-frame-layered',
    scene: {
      frames: [
        ...source.scene.frames,
        {
          id: 'mcp:secondary',
          name: 'MCP Secondary',
          parentFrameId: 'world',
          localPose: {
            positionM: [0, 2, 0],
            quaternion: [0, 0, 0, 1],
          },
          role: 'mcp',
        },
      ],
    },
    robots: source.robots.map((robot) => ({
      ...robot,
      localBasePose: {
        positionM: [3, 0, 0],
        quaternion: [0, 0, 0, 1],
      },
    })),
  })
}

describe('CoordinateFrameLayersV4', () => {
  it('renders one Grid, World, every MCP, and only the selected Robot Base', () => {
    const project = layeredProject()
    const { container } = render(
      <CoordinateFrameLayersV4
        layers={ALL_LAYERS}
        project={project}
        runtime={projection(project)}
        selection={{ kind: 'robot-link', robotId: 'robot-1', linkId: 'L0' }}
      />,
    )

    expect(container.querySelectorAll('[data-viewport-grid]')).toHaveLength(1)
    expect(container.querySelectorAll('[data-coordinate-frame-layer="worldFrame"]')).toHaveLength(1)
    expect(container.querySelectorAll('[data-coordinate-frame-layer="mcpFrame"]')).toHaveLength(2)
    expect(container.querySelectorAll('[data-coordinate-frame-layer="baseFrame"]')).toHaveLength(1)
    expect(container.querySelector('[data-coordinate-frame-layer="baseFrame"]'))
      .toHaveAttribute('position', '3,0,0')
    expect(screen.getAllByText('triad')).toHaveLength(4)
    expect(screen.queryByText('Actual TCP')).not.toBeInTheDocument()
  })

  it('routes each exact layer flag without presentation-only leakage', () => {
    const project = layeredProject()
    const layers = { ...ALL_LAYERS, mcpFrame: false, baseFrame: false }
    const { container, rerender } = render(
      <CoordinateFrameLayersV4
        layers={layers}
        project={project}
        runtime={projection(project)}
        selection={{ kind: 'robot', robotId: 'robot-1' }}
      />,
    )
    expect(container.querySelectorAll('[data-viewport-grid]')).toHaveLength(1)
    expect(container.querySelectorAll('[data-coordinate-frame-layer="worldFrame"]')).toHaveLength(1)
    expect(container.querySelectorAll('[data-coordinate-frame-layer="mcpFrame"]')).toHaveLength(0)
    expect(container.querySelectorAll('[data-coordinate-frame-layer="baseFrame"]')).toHaveLength(0)

    rerender(
      <CoordinateFrameLayersV4
        layers={{ ...ALL_LAYERS, grid: false, worldFrame: false }}
        project={project}
        runtime={projection(project)}
        selection={{ kind: 'spatial-entity', entityId: 'anything' }}
      />,
    )
    expect(container.querySelectorAll('[data-viewport-grid]')).toHaveLength(0)
    expect(container.querySelectorAll('[data-coordinate-frame-layer="worldFrame"]')).toHaveLength(0)
    expect(container.querySelectorAll('[data-coordinate-frame-layer="mcpFrame"]')).toHaveLength(2)
    expect(container.querySelectorAll('[data-coordinate-frame-layer="baseFrame"]')).toHaveLength(0)
  })

  it('keeps global layers safe with zero Robots and omits Base', () => {
    const source = makeMinimalWorkcellProjectV4()
    const project = validateWorkcellProjectV4({
      ...source,
      revisionId: 'coordinate-frame-zero-robots',
      assetReferences: [],
      robotDefinitions: [],
      robots: [],
    })
    const { container } = render(
      <CoordinateFrameLayersV4
        layers={ALL_LAYERS}
        project={project}
        runtime={projection(project)}
        selection={null}
      />,
    )
    expect(container.querySelectorAll('[data-viewport-grid]')).toHaveLength(1)
    expect(container.querySelectorAll('[data-coordinate-frame-layer="worldFrame"]')).toHaveLength(1)
    expect(container.querySelectorAll('[data-coordinate-frame-layer="mcpFrame"]')).toHaveLength(1)
    expect(container.querySelectorAll('[data-coordinate-frame-layer="baseFrame"]')).toHaveLength(0)
  })
})
