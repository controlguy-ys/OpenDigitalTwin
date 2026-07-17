import type { ReactNode } from 'react'
import type {
  WorkcellProjectV4,
} from '../../../core/project-v4/index.js'
import {
  robotIdFromSceneSelectionV4,
  type SceneSelectionV4,
} from '../../interaction/v4/scene-selection.js'
import type { SceneRuntimeProjectionV4 } from '../../scene/v4/scene-runtime-selector.js'
import { TcpFrameMarker } from '../TcpFrameMarker.js'

export interface SelectedTcpFrameMarkerPropsV4 {
  readonly project: WorkcellProjectV4
  readonly runtime: SceneRuntimeProjectionV4
  readonly selection: SceneSelectionV4
  readonly visible: boolean
}

function markerIdentitySegmentV4(value: string): string {
  return encodeURIComponent(value)
}

export function SelectedTcpFrameMarkerV4({
  project,
  runtime,
  selection,
  visible,
}: SelectedTcpFrameMarkerPropsV4): ReactNode {
  if (!visible || runtime.projectRevisionId !== project.revisionId) return null

  const robotId = robotIdFromSceneSelectionV4(selection)
  if (robotId === null) return null
  const robot = project.robots.find((candidate) => candidate.id === robotId)
  const runtimeRobot = runtime.entities.get(robotId)
  if (robot === undefined || runtimeRobot?.kind !== 'robot' || !runtimeRobot.effectiveVisible) {
    return null
  }
  const definition = project.robotDefinitions.find(
    (candidate) => candidate.id === robot.definitionId,
  )
  const tcpFrameId = runtimeRobot.selectedTcpFrameId
  if (
    definition === undefined
    || !definition.frames.some((frame) => frame.id === tcpFrameId && frame.role === 'tcp')
  ) return null
  const tcpFrame = runtime.robotFramesByRobotId.get(robotId)?.get(tcpFrameId)
  if (tcpFrame === undefined || tcpFrame.robotId !== robotId) return null

  return (
    <group
      data-selected-tcp-marker={robotId}
      name={`selected-tcp-${markerIdentitySegmentV4(robotId)}`}
      position={tcpFrame.worldPose.positionM}
      quaternion={tcpFrame.worldPose.quaternion}
    >
      <TcpFrameMarker
        frameName="Actual TCP"
        name={`actual-tcp-${markerIdentitySegmentV4(robotId)}-${markerIdentitySegmentV4(tcpFrameId)}`}
        visible
      />
    </group>
  )
}
