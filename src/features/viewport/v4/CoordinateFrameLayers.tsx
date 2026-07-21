import type { ReactNode } from 'react'
import type {
  RigidTransformV4,
  WorkcellProjectV4,
} from '../../../core/project-v4/index.js'
import {
  robotIdFromSceneSelectionV4,
  type SceneSelectionV4,
} from '../../interaction/v4/scene-selection.js'
import type { SceneRuntimeProjectionV4 } from '../../scene/v4/scene-runtime-selector.js'
import { TcpFrameMarker } from '../TcpFrameMarker.js'
import type { ViewportLayerV4 } from './viewport-preference-store.js'

export interface CoordinateFrameLayersPropsV4 {
  readonly project: WorkcellProjectV4
  readonly runtime: SceneRuntimeProjectionV4
  readonly selection: SceneSelectionV4
  readonly layers: Readonly<Record<ViewportLayerV4, boolean>>
}

interface FrameLayerMarkerPropsV4 {
  readonly frameName: string
  readonly layer: 'worldFrame' | 'mcpFrame' | 'baseFrame'
  readonly markerName: string
  readonly pose: RigidTransformV4
}

function markerSegmentV4(value: string): string {
  return encodeURIComponent(value)
}

function FrameLayerMarkerV4({
  frameName,
  layer,
  markerName,
  pose,
}: FrameLayerMarkerPropsV4): ReactNode {
  return (
    <group
      name={`${markerName}-anchor`}
      position={pose.positionM}
      quaternion={pose.quaternion}
      userData={{ frameLayer: layer }}
    >
      <TcpFrameMarker frameName={frameName} name={markerName} visible />
    </group>
  )
}

export function CoordinateFrameLayersV4({
  project,
  runtime,
  selection,
  layers,
}: CoordinateFrameLayersPropsV4): ReactNode {
  if (runtime.projectRevisionId !== project.revisionId) return null

  const worldDefinition = project.scene.frames.find(({ role }) => role === 'world')
  const worldFrame = worldDefinition === undefined
    ? undefined
    : runtime.globalFrames.get(worldDefinition.id)
  const mcpFrames = project.scene.frames.flatMap((frame) => {
    if (frame.role !== 'mcp') return []
    const projected = runtime.globalFrames.get(frame.id)
    return projected === undefined ? [] : [{ definition: frame, projected }]
  })
  const selectedRobotId = robotIdFromSceneSelectionV4(selection)
  const selectedRobot = selectedRobotId === null
    ? undefined
    : project.robots.find(({ id }) => id === selectedRobotId)
  const selectedRobotRuntime = selectedRobotId === null
    ? undefined
    : runtime.entities.get(selectedRobotId)
  const basePose = selectedRobot !== undefined
    && selectedRobotRuntime?.kind === 'robot'
    && selectedRobotRuntime.effectiveVisible
    ? selectedRobotRuntime.worldBasePose
    : null

  return (
    <>
      {layers.grid ? (
        <gridHelper
          args={[6, 60, '#344754', '#1d2a33']}
          name="workcell-grid-v4"
          position={[0, 0, 0.002]}
          rotation={[Math.PI / 2, 0, 0]}
          userData={{ frameLayer: 'grid' }}
        />
      ) : null}
      {layers.worldFrame && worldDefinition !== undefined && worldFrame !== undefined ? (
        <FrameLayerMarkerV4
          frameName={worldDefinition.name}
          layer="worldFrame"
          markerName={`world-${markerSegmentV4(worldDefinition.id)}`}
          pose={worldFrame.worldPose}
        />
      ) : null}
      {layers.mcpFrame ? mcpFrames.map(({ definition, projected }) => (
        <FrameLayerMarkerV4
          frameName={definition.name}
          key={definition.id}
          layer="mcpFrame"
          markerName={`mcp-${markerSegmentV4(definition.id)}`}
          pose={projected.worldPose}
        />
      )) : null}
      {layers.baseFrame && selectedRobot !== undefined && basePose !== null ? (
        <FrameLayerMarkerV4
          frameName={`${selectedRobot.name} Base`}
          layer="baseFrame"
          markerName={`robot-base-${markerSegmentV4(selectedRobot.id)}`}
          pose={basePose}
        />
      ) : null}
    </>
  )
}
