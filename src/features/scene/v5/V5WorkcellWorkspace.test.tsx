import { fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { createStore } from 'zustand/vanilla'

import {
  cloneWorkcellProjectV5,
  makeMinimalWorkcellProjectV5,
} from '../../../core/project-v5/test-support.js'
import {
  validateWorkcellProjectV5,
  type RigidTransformV5,
  type WorkcellProjectV5,
} from '../../../core/project-v5/index.js'
import type { BrowserRuntimeBundleStateV5 } from '../../project/v5/browser-runtime-bundle-store-v5.js'
import { V5WorkcellWorkspace } from './V5WorkcellWorkspace.js'

vi.mock('@react-three/fiber', () => ({
  Canvas: ({ children }: { readonly children: ReactNode }) => children,
  useFrame: (callback: () => void) => { callback() },
}))

vi.mock('@react-three/drei', () => ({
  GizmoHelper: ({ children }: { readonly children: ReactNode }) => children,
  GizmoViewcube: () => null,
  Grid: () => null,
  Html: ({ children }: { readonly children: ReactNode }) => children,
  OrbitControls: () => null,
  PerspectiveCamera: () => null,
}))

const SHARED_LINK_POSE: RigidTransformV5 = Object.freeze({
  positionM: Object.freeze([1, 2, 3] as const),
  quaternion: Object.freeze([0, 0, 0, 1] as const),
})

function project(): WorkcellProjectV5 {
  const base = makeMinimalWorkcellProjectV5()
  return validateWorkcellProjectV5({
    ...base,
    spatialEntities: [{
      id: 'box',
      name: 'Workpiece',
      geometry: { kind: 'box', dimensionsM: [0.2, 0.2, 0.2], color: '#38bdf8' },
      parentFrameId: 'mcp',
      localPose: { positionM: [0, 0, 0.1], quaternion: [0, 0, 0, 1] },
      visible: true,
      groupId: null,
      removable: true,
      transformOwner: 'manual',
      numericStatus: { value: 0, sourceOwnership: 'manual', overlay: { visible: true, frameId: null } },
      graspable: false,
      graspFrames: [],
      movingFrames: [],
    }],
  })
}

function projectWithRepeatedLinkGeometry(): WorkcellProjectV5 {
  const next = cloneWorkcellProjectV5(project())
  const definition = next.robotDefinitions[0]!
  const link = definition.links.find(({ id }) => id === 'L0')!
  const first = link.geometryOccurrences[0]!
  ;(link.geometryOccurrences as unknown as Array<typeof first>).push({
    ...first,
    occurrenceKey: 'robot-occurrence-duplicate',
  })
  return validateWorkcellProjectV5(next)
}

function bundleWithWorld(readRobotLinkWorldPose: ReturnType<typeof vi.fn>): BrowserRuntimeBundleStateV5 {
  const robots = createStore(() => ({ byRobotId: { 'robot-1': {} } }))
  return {
    runtimeEpoch: 1,
    project: projectWithRepeatedLinkGeometry(),
    projectRevisionId: 'revision-1',
    configRevision: 'a'.repeat(64),
    gatewayId: 'gateway-test',
    runtimeGraph: {
      robots,
      world: {
        readRobotLinkWorldPose,
        readRobotFrameWorldPose: () => null,
        readSceneFrameWorldPose: () => null,
        readObjectWorldPose: () => null,
      },
    },
  } as unknown as BrowserRuntimeBundleStateV5
}

describe('V5WorkcellWorkspace', () => {
  it('keeps binding available for a selected Object even before runtime activation', () => {
    const onOpenBinding = vi.fn()
    render(<V5WorkcellWorkspace
      bundle={null}
      onOpenBinding={onOpenBinding}
      onSelect={vi.fn()}
      project={project()}
      selection={{ kind: 'entity', id: 'box' }}
    />)
    fireEvent.click(screen.getByRole('button', { name: 'Open Binding…' }))
    expect(onOpenBinding).toHaveBeenCalledWith({ type: 'entity-status', entityId: 'box' })
    expect(screen.getByText('Project runtime is not active.')).toBeInTheDocument()
  })

  it('renders repeated Robot Link geometry through the shared World facade instead of private kinematics', () => {
    const readRobotLinkWorldPose = vi.fn((robotId: string, linkId: string): RigidTransformV5 | null => (
      robotId === 'robot-1' && linkId === 'L0' ? SHARED_LINK_POSE : null
    ))
    const activeProject = projectWithRepeatedLinkGeometry()
    render(<V5WorkcellWorkspace
      bundle={bundleWithWorld(readRobotLinkWorldPose)}
      onOpenBinding={vi.fn()}
      onSelect={vi.fn()}
      project={activeProject}
      selection={null}
    />)

    const linkReads = readRobotLinkWorldPose.mock.calls.filter(([, linkId]) => linkId === 'L0')
    expect(linkReads).toEqual([
      ['robot-1', 'L0'], ['robot-1', 'L0'], ['robot-1', 'L0'], ['robot-1', 'L0'],
    ])
  })
})
