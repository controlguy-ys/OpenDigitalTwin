import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import type { WorkcellProjectV5 } from '../../../core/project-v5/index.js'
import { makeMinimalWorkcellProjectV5 } from '../../../core/project-v5/test-support.js'
import type { SceneCommandServiceV6 } from '../../scene/v6/scene-command-service-v6.js'
import { SelectionInspectorV6 } from './SelectionInspectorV6.js'

function projectWithGroupAndFrame(): WorkcellProjectV5 {
  const base = makeMinimalWorkcellProjectV5()
  return {
    ...base,
    scene: {
      frames: [
        ...base.scene.frames,
        { id: 'custom-frame', name: 'Custom Frame', parentFrameId: 'world', localPose: { positionM: [1, 2, 3], quaternion: [0, 0, 0, 1] }, role: 'custom' },
      ],
    },
    sceneGroups: [
      { id: 'parent', name: 'Parent Group', parentGroupId: null, visible: false },
      { id: 'child', name: 'Child Group', parentGroupId: 'parent', visible: true },
    ],
  }
}

describe('SelectionInspectorV6', () => {
  it('keeps a safe empty Inspector when there is no selection', () => {
    render(<SelectionInspectorV6 project={makeMinimalWorkcellProjectV5()} selection={null} />)
    expect(screen.getByText('Select a Robot or Object to inspect.')).toBeInTheDocument()
  })

  it('routes Group selection to the Group inspector and applies one atomic Group patch', () => {
    const project = projectWithGroupAndFrame()
    const updateGroup = vi.fn<SceneCommandServiceV6['updateGroup']>().mockResolvedValue(undefined)
    const updateSceneFrame = vi.fn<SceneCommandServiceV6['updateSceneFrame']>().mockResolvedValue(undefined)
    const sceneCommands: Pick<SceneCommandServiceV6, 'updateGroup' | 'updateSceneFrame'> = { updateGroup, updateSceneFrame }
    render(<SelectionInspectorV6 project={project} sceneCommands={sceneCommands} selection={{ kind: 'group', id: 'child' }} />)

    expect(screen.getByRole('heading', { name: 'Child Group' })).toBeVisible()
    expect(screen.getByText('Parent Group: Parent Group')).toBeVisible()
    expect(screen.getByText('Effective visibility: Hidden')).toBeVisible()
    fireEvent.change(screen.getByLabelText('Group Name'), { target: { value: 'Renamed Group' } })
    fireEvent.click(screen.getByLabelText('Group Visible'))
    fireEvent.click(screen.getByRole('button', { name: 'Apply Group' }))
    expect(updateGroup).toHaveBeenCalledWith('child', { name: 'Renamed Group', parentGroupId: 'parent', visible: false })
  })

  it('routes Scene Frame selection to a pose inspector and keeps World read-only', () => {
    const project = projectWithGroupAndFrame()
    const updateGroup = vi.fn<SceneCommandServiceV6['updateGroup']>().mockResolvedValue(undefined)
    const updateSceneFrame = vi.fn<SceneCommandServiceV6['updateSceneFrame']>().mockResolvedValue(undefined)
    const sceneCommands: Pick<SceneCommandServiceV6, 'updateGroup' | 'updateSceneFrame'> = { updateGroup, updateSceneFrame }
    const { rerender } = render(<SelectionInspectorV6 project={project} sceneCommands={sceneCommands} selection={{ kind: 'frame', id: 'custom-frame' }} />)

    expect(screen.getByRole('heading', { name: 'Custom Frame' })).toBeVisible()
    expect(screen.getByText('Role: custom')).toBeVisible()
    expect(screen.getByText('Parent Frame: World')).toBeVisible()
    fireEvent.change(screen.getByLabelText('Scene Frame Local X (m)'), { target: { value: '4' } })
    fireEvent.click(screen.getByRole('button', { name: 'Apply Scene Frame' }))
    expect(updateSceneFrame).toHaveBeenCalledWith('custom-frame', expect.objectContaining({ positionM: [4, 2, 3] }))

    rerender(<SelectionInspectorV6 project={project} sceneCommands={sceneCommands} selection={{ kind: 'frame', id: 'world' }} />)
    expect(screen.getByText('World Frame is read-only.')).toBeVisible()
    expect(screen.getByLabelText('Scene Frame Local X (m)')).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Apply Scene Frame' })).toBeDisabled()
  })

  it('renders a safe stale Object state without routing to a Robot', () => {
    const project = makeMinimalWorkcellProjectV5()
    render(<SelectionInspectorV6 project={project} selection={{ kind: 'entity', id: 'deleted-object' }} />)
    expect(screen.getByText('Selected Object is no longer available.')).toBeInTheDocument()
    expect(screen.queryByText(project.robots[0]?.name ?? '')).toBeNull()
  })
})
