import { describe, expect, it } from 'vitest'

import { makeMinimalWorkcellProjectV4 } from '../../../core/project-v4/test-support.js'
import type { ProjectStoreStateV4 } from '../../project/v4/project-store-v4.js'
import type { JobRuntimeStoreV4 } from '../../jobs/v4/job-runtime-store.js'
import type { RobotRuntimeRegistryV4 } from '../../robot/v4/robot-runtime-registry.js'
import type { RuntimeGatewayPresentationV4 } from '../../runtime-gateway/v4/runtime-gateway-publisher-v4.js'
import { composeAppHeaderStatusV4 } from './app-header-status.js'

const gateway: RuntimeGatewayPresentationV4 = {
  phase: 'ready', projectRevisionId: 'revision-1', mode: 'server', endpointUrl: 'opc.tcp://localhost:4840', message: null,
}

function projectState(status: ProjectStoreStateV4['status'], active = true, error: string | null = null): Pick<ProjectStoreStateV4, 'activeProject' | 'status' | 'error'> {
  const project = makeMinimalWorkcellProjectV4()
  return { activeProject: active ? project : null, status, error }
}

function runtime(project = makeMinimalWorkcellProjectV4()): Pick<RobotRuntimeRegistryV4, 'robots'> {
  return {
    robots: Object.freeze(Object.fromEntries(project.robots.map((robot) => [robot.id, {
      robotId: robot.id, definitionId: robot.definitionId, jointValues: robot.initialJointValues, jointSource: robot.jointSource,
      gripperState: 'OPEN' as const, selectedToolFrameId: robot.selectedToolFrameId, selectedTcpFrameId: robot.selectedTcpFrameId,
      numericStatus: 0, visible: true, revision: 0,
    }]))),
  }
}

describe('composeAppHeaderStatusV4', () => {
  it('keeps aggregate running Job state distinct from the addressed active Robot Joint source', () => {
    const base = makeMinimalWorkcellProjectV4()
    const second = { ...base.robots[0]!, id: 'robot-2', name: 'Robot Two' }
    const project = { ...base, robots: [{ ...base.robots[0]!, name: 'Robot One' }, second] }
    const robotRuntime = runtime(project)
    const state: Pick<JobRuntimeStoreV4, 'byRobotId'> = {
      byRobotId: {
        'robot-1': { robotId: 'robot-1', jobId: 'job-1', runId: 'run-1', state: 'RUNNING', stepIndex: 0, startedAtSimulationMs: 0, completedAtSimulationMs: null, failureCode: null, message: '' },
        'robot-2': { robotId: 'robot-2', jobId: null, runId: null, state: 'IDLE', stepIndex: null, startedAtSimulationMs: null, completedAtSimulationMs: null, failureCode: null, message: '' },
      },
    }
    const result = composeAppHeaderStatusV4({ projectState: { ...projectState('ready'), activeProject: project }, jobRuntime: state, robotRuntime, activeRobotId: 'robot-2', gateway })
    expect(result.simulation).toEqual({ runningJobCount: 1, robotCount: 2 })
    expect(result.jointSource).toEqual({ activeRobotName: 'Robot Two', sourceLabel: 'Simulation' })
  })

  it('maps all authoritative Project phases without recomputing save state', () => {
    for (const [phase, active, expectedSaved] of [
      ['idle', false, false], ['ready', true, true], ['loading', true, false], ['saving', true, false], ['importing', true, false], ['error', true, false], ['recovery-required', true, false],
    ] as const) {
      const result = composeAppHeaderStatusV4({ projectState: projectState(phase, active, phase === 'error' ? 'Import failed.' : null), jobRuntime: { byRobotId: {} }, robotRuntime: runtime(), activeRobotId: null, gateway: { ...gateway, phase: phase === 'error' ? 'error' : 'ready', message: phase === 'error' ? 'Gateway failed.' : null } })
      expect(result.project.phase).toBe(phase)
      expect(result.project.saved).toBe(expectedSaved)
      expect(result.gateway).toEqual({ modeLabel: 'OPC UA Server', statusLabel: phase === 'error' ? 'Gateway failed.' : 'Ready', endpoint: 'opc.tcp://localhost:4840' })
    }
  })

  it('uses the exact no-active-Robot presentation when the addressed Robot is absent', () => {
    const result = composeAppHeaderStatusV4({ projectState: projectState('ready'), jobRuntime: { byRobotId: {} }, robotRuntime: runtime(), activeRobotId: null, gateway: { ...gateway, endpointUrl: null } })
    expect(result.jointSource).toEqual({ activeRobotName: null, sourceLabel: null })
    expect(result.gateway.endpoint).toBeNull()
  })

  it.each([
    ['client', 'OPC UA Client'],
    ['bridge', 'OPC UA Bridge'],
  ] as const)('labels %s connectivity without treating it as unavailable', (mode, modeLabel) => {
    const result = composeAppHeaderStatusV4({
      projectState: projectState('ready'),
      jobRuntime: { byRobotId: {} },
      robotRuntime: runtime(),
      activeRobotId: null,
      gateway: { ...gateway, mode, endpointUrl: null },
    })
    expect(result.gateway.modeLabel).toBe(modeLabel)
  })

  it('labels an unavailable Runtime Gateway as Offline', () => {
    const result = composeAppHeaderStatusV4({
      projectState: projectState('ready'),
      jobRuntime: { byRobotId: {} },
      robotRuntime: runtime(),
      activeRobotId: null,
      gateway: {
        ...gateway,
        phase: 'offline',
        endpointUrl: null,
        message: null,
      },
    })

    expect(result.gateway).toEqual({
      modeLabel: 'OPC UA Server',
      statusLabel: 'Offline',
      endpoint: null,
    })
  })
})
