import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import type { RobotInstanceV5, WorkcellProjectV5 } from '../../../core/project-v5/index.js'
import { makeMinimalWorkcellProjectV5 } from '../../../core/project-v5/test-support.js'
import { createJobRuntimeStoreV5 } from '../../jobs/v5/job-runtime-store.js'
import { createRobotJointRuntimeStoreV5 } from '../../robot/v5/robot-joint-runtime-store.js'
import { RobotInspectorV6 } from './RobotInspectorV6.js'

const CONFIG = 'a'.repeat(64)
type MutationRequest = { readonly expectedRevisionId: string; readonly recipe: (project: WorkcellProjectV5) => WorkcellProjectV5 }

function projectWithSecondRobot(): WorkcellProjectV5 {
  const base = makeMinimalWorkcellProjectV5()
  const first = base.robots[0]
  if (first === undefined) throw new Error('Fixture must include one Robot.')
  const second: RobotInstanceV5 = {
    ...first,
    id: 'robot-2', name: 'Robot two', serialNumber: 'two', jointSource: 'manual',
    localBasePose: { positionM: [10, 20, 30], quaternion: [0, 0, 0, 1] }, initialJointValues: { J1: 12 },
  }
  return { ...base, robots: [{ ...first, jointSource: 'manual' }, second] }
}

function mutationPort(project: WorkcellProjectV5) {
  const mutate = vi.fn<(request: MutationRequest) => Promise<void>>(() => Promise.resolve())
  return { mutate, port: { readPublished: () => ({ project, revisionId: project.revisionId }), mutate } }
}

describe('RobotInspectorV6', () => {
  it('rerenders the selected Robot Joint value after a manual slider write', () => {
    const project = projectWithSecondRobot()
    const robots = createRobotJointRuntimeStoreV5(project, CONFIG)
    const write = vi.spyOn(robots.getState(), 'writeJointValues')
    render(<RobotInspectorV6 project={project} robotId="robot-2" runtime={{ robots }} />)

    expect(screen.getByRole('heading', { name: 'Robot two' })).toBeInTheDocument()
    expect(screen.getByText(/12 deg/u)).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('J1'), { target: { value: '35' } })
    expect(write).toHaveBeenCalledWith('robot-2', { J1: 35 }, 'manual')
    expect(screen.getByLabelText('J1')).toHaveValue('35')
    expect(screen.getByText('35 deg')).toBeInTheDocument()
    expect(robots.getState().readRobot('robot-2')?.jointValues.J1).toBe(35)
  })

  it('resets base drafts on selected Robot and published revision changes', () => {
    const project = projectWithSecondRobot()
    const { rerender } = render(<RobotInspectorV6 project={project} robotId="robot-1" />)
    fireEvent.change(screen.getByLabelText('X (m)'), { target: { value: '4' } })
    rerender(<RobotInspectorV6 project={project} robotId="robot-2" />)
    expect(screen.getByLabelText('X (m)')).toHaveValue(10)

    const revised: WorkcellProjectV5 = { ...project, revisionId: 'revision-2', robots: project.robots.map((robot) => robot.id === 'robot-2' ? { ...robot, localBasePose: { ...robot.localBasePose, positionM: [7, 20, 30] } } : robot) }
    rerender(<RobotInspectorV6 project={revised} robotId="robot-2" />)
    expect(screen.getByLabelText('X (m)')).toHaveValue(7)
  })

  it('does not mutate unchanged, blank, or non-finite Robot base drafts', () => {
    const project = projectWithSecondRobot()
    const { mutate, port } = mutationPort(project)
    render(<RobotInspectorV6 mutations={port} project={project} robotId="robot-2" />)
    fireEvent.click(screen.getByRole('button', { name: 'Apply Base Transform' }))
    fireEvent.change(screen.getByLabelText('X (m)'), { target: { value: '' } })
    fireEvent.click(screen.getByRole('button', { name: 'Apply Base Transform' }))
    fireEvent.change(screen.getByLabelText('X (m)'), { target: { value: 'NaN' } })
    fireEvent.click(screen.getByRole('button', { name: 'Apply Base Transform' }))
    expect(mutate).not.toHaveBeenCalled()
  })

  it('applies only the selected Robot base using the latest published revision', () => {
    const project = projectWithSecondRobot()
    const { mutate, port } = mutationPort(project)
    render(<RobotInspectorV6 mutations={port} project={project} robotId="robot-2" />)
    fireEvent.change(screen.getByLabelText('X (m)'), { target: { value: '14' } })
    fireEvent.click(screen.getByRole('button', { name: 'Apply Base Transform' }))
    const request = mutate.mock.calls[0]?.[0]
    expect(request?.expectedRevisionId).toBe(project.revisionId)
    expect(request?.recipe(project).robots.map((robot) => robot.localBasePose.positionM[0])).toEqual([0, 14])
  })

  it('disables OPC UA-owned Joints with an ownership explanation', () => {
    const project = projectWithSecondRobot()
    const opcuaProject: WorkcellProjectV5 = { ...project, robots: project.robots.map((robot) => robot.id === 'robot-2' ? { ...robot, jointSource: 'opcua:endpoint-1' } : robot) }
    const robots = createRobotJointRuntimeStoreV5(opcuaProject, CONFIG)
    render(<RobotInspectorV6 project={opcuaProject} robotId="robot-2" runtime={{ robots }} />)
    expect(screen.getByLabelText('J1')).toBeDisabled()
    expect(screen.getAllByText(/OPC UA \(endpoint-1\) owns Joint controls/u)).not.toHaveLength(0)
  })

  it('locks base authoring while the selected Robot has a running Job', () => {
    const project = projectWithSecondRobot()
    const jobs = createJobRuntimeStoreV5(project, CONFIG)
    jobs.getState().setRobotState({ robotId: 'robot-2', jobId: 'job-1', runId: 'run-1', state: 'RUNNING', stepIndex: 0, startedAtSimulationMs: 0, completedAtSimulationMs: null, failureCode: null, message: 'Running' })
    const robots = createRobotJointRuntimeStoreV5(project, CONFIG)
    render(<RobotInspectorV6 project={project} robotId="robot-2" runtime={{ jobs, robots }} />)
    expect(screen.getByLabelText('X (m)')).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Apply Base Transform' })).toBeDisabled()
    expect(screen.getByText(/running Job owns Robot motion/u)).toBeInTheDocument()
  })

  it('does not fall back to the first Robot when the selected identity is stale', () => {
    const project = projectWithSecondRobot()
    render(<RobotInspectorV6 project={project} robotId="deleted-robot" />)
    expect(screen.getByText('Selected Robot is no longer available.')).toBeInTheDocument()
    expect(screen.queryByText(project.robots[0]?.name ?? '')).toBeNull()
  })

  it('transitions from a valid Robot to a stale selection without a hook-order error', () => {
    const project = projectWithSecondRobot()
    const { rerender } = render(<RobotInspectorV6 project={project} robotId="robot-2" />)
    rerender(<RobotInspectorV6 project={project} robotId="deleted-robot" />)
    expect(screen.getByText('Selected Robot is no longer available.')).toBeInTheDocument()
  })

  it('opens the selected Robot TCP binding target', () => {
    const project = projectWithSecondRobot()
    const onOpenBinding = vi.fn()
    render(<RobotInspectorV6 project={project} robotId="robot-2" onOpenBinding={onOpenBinding} />)

    fireEvent.click(screen.getByRole('button', { name: 'Open Binding' }))

    const robot = project.robots.find(({ id }) => id === 'robot-2')
    expect(robot).toBeDefined()
    expect(onOpenBinding).toHaveBeenCalledWith({ type: 'robot-frame', robotId: 'robot-2', frameId: robot!.selectedTcpFrameId })
  })

  it('uses a distinct latest publication revision and mutates only its selected Robot', () => {
    const project = projectWithSecondRobot()
    const latest: WorkcellProjectV5 = { ...project, revisionId: 'revision-new', robots: project.robots.map((robot) => robot.id === 'robot-1' ? { ...robot, localBasePose: { ...robot.localBasePose, positionM: [99, 0, 0] } } : robot) }
    const mutate = vi.fn<(request: MutationRequest) => Promise<void>>(() => Promise.resolve())
    render(<RobotInspectorV6 mutations={{ readPublished: () => ({ project: latest, revisionId: latest.revisionId }), mutate }} project={project} robotId="robot-2" />)
    fireEvent.change(screen.getByLabelText('X (m)'), { target: { value: '14' } })
    fireEvent.click(screen.getByRole('button', { name: 'Apply Base Transform' }))
    const request = mutate.mock.calls[0]?.[0]
    expect(request?.expectedRevisionId).toBe('revision-new')
    expect(request?.recipe(latest).robots.map((robot) => robot.localBasePose.positionM[0])).toEqual([99, 14])
  })

  it('preserves the latest selected Robot quaternion while applying authored XYZ', () => {
    const project = projectWithSecondRobot()
    const latest: WorkcellProjectV5 = {
      ...project,
      revisionId: 'revision-new',
      robots: project.robots.map((robot) => robot.id === 'robot-2'
        ? { ...robot, localBasePose: { positionM: [10, 20, 30], quaternion: [0, 0, 0.5, Math.sqrt(0.75)] } }
        : robot),
    }
    const mutate = vi.fn<(request: MutationRequest) => Promise<void>>(() => Promise.resolve())
    render(<RobotInspectorV6 mutations={{ readPublished: () => ({ project: latest, revisionId: latest.revisionId }), mutate }} project={project} robotId="robot-2" />)
    fireEvent.change(screen.getByLabelText('X (m)'), { target: { value: '14' } })
    fireEvent.click(screen.getByRole('button', { name: 'Apply Base Transform' }))
    const updated = mutate.mock.calls[0]?.[0].recipe(latest).robots.find((robot) => robot.id === 'robot-2')
    expect(updated?.localBasePose.positionM).toEqual([14, 20, 30])
    expect(updated?.localBasePose.quaternion).toEqual([0, 0, 0.5, Math.sqrt(0.75)])
  })
})
