import type { RobotIdV4 } from '../../../core/project-v4/index.js'
import type { JobRuntimeStoreV4 } from '../../jobs/v4/job-runtime-store.js'
import type { ProjectStoreStateV4 } from '../../project/v4/project-store-v4.js'
import type { RobotRuntimeRegistryV4 } from '../../robot/v4/robot-runtime-registry.js'
import type { RuntimeGatewayPresentationV4 } from '../../runtime-gateway/v4/runtime-gateway-publisher-v4.js'

export type ProjectHeaderPhaseV4 =
  | 'idle'
  | 'ready'
  | 'loading'
  | 'saving'
  | 'importing'
  | 'error'
  | 'recovery-required'

export interface AppHeaderStatusV4 {
  readonly project: {
    readonly name: string
    readonly phase: ProjectHeaderPhaseV4
    readonly saved: boolean
    readonly message: string | null
  }
  readonly simulation: {
    readonly runningJobCount: number
    readonly robotCount: number
  }
  readonly jointSource: {
    readonly activeRobotName: string | null
    readonly sourceLabel: string | null
  }
  readonly gateway: {
    readonly modeLabel: string
    readonly statusLabel: string
    readonly endpoint: string | null
  }
}

function sourceLabel(source: 'simulation' | 'manual' | `opcua:${string}`): string {
  if (source === 'simulation') return 'Simulation'
  if (source === 'manual') return 'Manual'
  return `OPC UA: ${source.slice('opcua:'.length)}`
}

function gatewayModeLabel(gateway: RuntimeGatewayPresentationV4): string {
  if (gateway.mode === 'bridge') return 'OPC UA Bridge'
  if (gateway.mode === 'client') return 'OPC UA Client'
  if (gateway.mode === 'server') return 'OPC UA Server'
  if (gateway.mode === 'off') return 'Off'
  return 'Unavailable'
}

function gatewayStatusLabel(gateway: RuntimeGatewayPresentationV4): string {
  if (gateway.message !== null) return gateway.message
  if (gateway.phase === 'activating') return 'Activating'
  if (gateway.phase === 'ready') return 'Ready'
  if (gateway.phase === 'offline') return 'Offline'
  if (gateway.phase === 'error') return 'Error'
  return 'Idle'
}

export function composeAppHeaderStatusV4(input: {
  readonly projectState: Pick<ProjectStoreStateV4, 'activeProject' | 'status' | 'error'>
  readonly jobRuntime: Pick<JobRuntimeStoreV4, 'byRobotId'>
  readonly robotRuntime: Pick<RobotRuntimeRegistryV4, 'robots'>
  readonly activeRobotId: RobotIdV4 | null
  readonly gateway: RuntimeGatewayPresentationV4
}): AppHeaderStatusV4 {
  const project = input.projectState.activeProject
  const activeRobot = input.activeRobotId === null
    ? null
    : project?.robots.find((robot) => robot.id === input.activeRobotId) ?? null
  const activeRuntime = activeRobot === null
    ? null
    : input.robotRuntime.robots[activeRobot.id] ?? null
  const runningJobCount = Object.values(input.jobRuntime.byRobotId).filter((state) => state.state === 'RUNNING').length
  return Object.freeze({
    project: Object.freeze({
      name: project?.metadata.name ?? 'Untitled Workcell',
      phase: input.projectState.status,
      saved: project !== null && input.projectState.status === 'ready',
      message: input.projectState.error,
    }),
    simulation: Object.freeze({ runningJobCount, robotCount: project?.robots.length ?? 0 }),
    jointSource: Object.freeze({
      activeRobotName: activeRobot?.name ?? null,
      sourceLabel: activeRuntime === null ? null : sourceLabel(activeRuntime.jointSource),
    }),
    gateway: Object.freeze({
      modeLabel: gatewayModeLabel(input.gateway),
      statusLabel: gatewayStatusLabel(input.gateway),
      endpoint: input.gateway.endpointUrl,
    }),
  })
}
