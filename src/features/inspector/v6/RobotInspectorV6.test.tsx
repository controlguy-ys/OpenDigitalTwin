import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { makeMinimalWorkcellProjectV5 } from '../../../core/project-v5/test-support.js'
import { createRobotJointRuntimeStoreV5 } from '../../robot/v5/robot-joint-runtime-store.js'
import { RobotInspectorV6 } from './RobotInspectorV6.js'

const CONFIG = 'a'.repeat(64)

describe('RobotInspectorV6', () => {
  it('uses the selected second Robot runtime and writes its manual slider with correct joint units', () => {
    const project = structuredClone(makeMinimalWorkcellProjectV5())
    const second = { ...project.robots[0]!, id: 'robot-2', name: 'Robot two', serialNumber: 'two', initialJointValues: { J1: 12 }, jointSource: 'manual' as const }
    ;(project.robots as unknown as unknown[]).push(second)
    const robots = createRobotJointRuntimeStoreV5(project, CONFIG)
    const write = vi.spyOn(robots.getState(), 'writeJointValues')
    render(<RobotInspectorV6 project={project} robotId="robot-2" runtime={{ robots }} />)

    expect(screen.getByRole('heading', { name: 'Robot two' })).toBeInTheDocument()
    expect(screen.getByText(/deg/u)).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('J1'), { target: { value: '14' } })
    expect(write).toHaveBeenCalledWith('robot-2', { J1: 14 }, 'manual')
  })

  it('does not fall back to the first Robot when the selected identity is stale', () => {
    const project = makeMinimalWorkcellProjectV5()
    render(<RobotInspectorV6 project={project} robotId="deleted-robot" />)
    expect(screen.getByText('Selected Robot is no longer available.')).toBeInTheDocument()
    expect(screen.queryByText(project.robots[0]!.name)).toBeNull()
  })
})
