import {
  failProjectV4,
  normalizeRigidTransformV4,
  quaternionToRpyDegreesV4,
  relativeRigidTransformV4,
  type FrameIdV4,
  type RigidTransformV4,
  type RobotIdV4,
  type Vector3V4,
  type WorkcellProjectV4,
} from '../../../core/project-v4/index.js'
import {
  robotIdFromSceneSelectionV4,
  sceneSelectionKeyV4,
  spatialEntityIdFromSceneSelectionV4,
  type CoordinateFrameSelectionV4,
  type SceneSelectionV4,
} from '../../interaction/v4/scene-selection.js'
import type { SceneRuntimeProjectionV4 } from '../../scene/v4/scene-runtime-selector.js'

export interface CoordinateFrameOptionV4 {
  readonly selection: CoordinateFrameSelectionV4
  readonly key: string
  readonly label: string
  readonly worldPose: RigidTransformV4
  readonly editable: boolean
}

export interface ActualTcpPoseReadoutV4 {
  readonly robotId: RobotIdV4
  readonly tcpFrameId: FrameIdV4
  readonly poseFrame: CoordinateFrameSelectionV4
  readonly xyzMm: Vector3V4
  readonly rpyDeg: Vector3V4
}

function coordinateReadoutFailureV4(
  code: string,
  path: string,
  message: string,
): never {
  failProjectV4(
    code,
    path,
    message,
    'Refresh the matching Project and Scene runtime snapshots and try again.',
  )
}

function requireMatchingRevisionV4(
  project: WorkcellProjectV4,
  runtime: SceneRuntimeProjectionV4,
): void {
  if (project.revisionId !== runtime.projectRevisionId) {
    coordinateReadoutFailureV4(
      'SCENE_RUNTIME_PROJECT_REVISION_MISMATCH',
      '$.revisionId',
      'Coordinate readout requires matching Project and Scene runtime revisions.',
    )
  }
}

function frozenPoseV4(pose: RigidTransformV4): RigidTransformV4 {
  const normalized = normalizeRigidTransformV4(pose, '$.coordinateFrame.worldPose')
  return Object.freeze({
    positionM: Object.freeze([...normalized.positionM]) as unknown as Vector3V4,
    quaternion: Object.freeze([...normalized.quaternion]) as unknown as RigidTransformV4['quaternion'],
  })
}

function frozenSelectionV4(
  selection: CoordinateFrameSelectionV4,
): CoordinateFrameSelectionV4 {
  switch (selection.kind) {
    case 'scene-frame':
      return Object.freeze({ kind: 'scene-frame', frameId: selection.frameId })
    case 'robot-frame':
      return Object.freeze({
        kind: 'robot-frame',
        robotId: selection.robotId,
        frameId: selection.frameId,
      })
    case 'entity-frame':
      return Object.freeze({
        kind: 'entity-frame',
        entityId: selection.entityId,
        frameId: selection.frameId,
      })
  }
}

function optionV4(
  selection: CoordinateFrameSelectionV4,
  label: string,
  worldPose: RigidTransformV4,
  editable: boolean,
): CoordinateFrameOptionV4 {
  const ownedSelection = frozenSelectionV4(selection)
  return Object.freeze({
    selection: ownedSelection,
    key: sceneSelectionKeyV4(ownedSelection),
    label,
    worldPose: frozenPoseV4(worldPose),
    editable,
  })
}

export function resolveCoordinateFrameWorldPoseV4(
  runtime: SceneRuntimeProjectionV4,
  selection: CoordinateFrameSelectionV4,
): RigidTransformV4 {
  if (selection.kind === 'robot-frame') {
    const frame = runtime.robotFramesByRobotId.get(selection.robotId)?.get(selection.frameId)
    if (frame === undefined) {
      coordinateReadoutFailureV4(
        'COORDINATE_FRAME_NOT_FOUND',
        '$.poseFrame',
        `Robot Frame ${selection.robotId}/${selection.frameId} is unresolved.`,
      )
    }
    return frozenPoseV4(frame.worldPose)
  }

  const frame = runtime.globalFrames.get(selection.frameId)
  const hasExactOwnership = selection.kind === 'scene-frame'
    ? frame?.frameKind === 'scene' && frame.ownerEntityId === null
    : frame !== undefined
      && frame.frameKind !== 'scene'
      && frame.ownerEntityId === selection.entityId
  if (frame === undefined || !hasExactOwnership) {
    coordinateReadoutFailureV4(
      'COORDINATE_FRAME_NOT_FOUND',
      '$.poseFrame',
      `Structured Frame ${selection.frameId} is unresolved or has different ownership.`,
    )
  }
  return frozenPoseV4(frame.worldPose)
}

export function coordinateFrameOptionsV4(
  project: WorkcellProjectV4,
  runtime: SceneRuntimeProjectionV4,
  selection: SceneSelectionV4,
): readonly CoordinateFrameOptionV4[] {
  requireMatchingRevisionV4(project, runtime)
  const options: CoordinateFrameOptionV4[] = []

  for (const frame of project.scene.frames) {
    const frameSelection = {
      kind: 'scene-frame' as const,
      frameId: frame.id,
    }
    options.push(optionV4(
      frameSelection,
      `${frame.name} (${frame.role})`,
      resolveCoordinateFrameWorldPoseV4(runtime, frameSelection),
      frame.role !== 'world',
    ))
  }

  const selectedRobotId = robotIdFromSceneSelectionV4(selection)
  if (selectedRobotId !== null) {
    const robot = project.robots.find(({ id }) => id === selectedRobotId)
    const definition = robot === undefined
      ? undefined
      : project.robotDefinitions.find(({ id }) => id === robot.definitionId)
    if (robot !== undefined && definition !== undefined) {
      for (const frame of definition.frames) {
        const frameSelection = {
          kind: 'robot-frame' as const,
          robotId: robot.id,
          frameId: frame.id,
        }
        options.push(optionV4(
          frameSelection,
          `${robot.name} / ${frame.name}`,
          resolveCoordinateFrameWorldPoseV4(runtime, frameSelection),
          frame.role === 'base',
        ))
      }
    }
  }

  const selectedEntityId = spatialEntityIdFromSceneSelectionV4(selection)
  if (selectedEntityId !== null) {
    const entity = project.spatialEntities.find(({ id }) => id === selectedEntityId)
    if (entity !== undefined) {
      for (const frame of entity.graspFrames) {
        const frameSelection = {
          kind: 'entity-frame' as const,
          entityId: entity.id,
          frameId: frame.frameId,
        }
        options.push(optionV4(
          frameSelection,
          `${entity.name} / ${frame.name}`,
          resolveCoordinateFrameWorldPoseV4(runtime, frameSelection),
          false,
        ))
      }
      for (const frame of entity.movingFrames) {
        const frameSelection = {
          kind: 'entity-frame' as const,
          entityId: entity.id,
          frameId: frame.frameId,
        }
        options.push(optionV4(
          frameSelection,
          `${entity.name} / ${frame.name}`,
          resolveCoordinateFrameWorldPoseV4(runtime, frameSelection),
          frame.sourceOwnership === 'manual',
        ))
      }
    }
  }

  return Object.freeze(options)
}

function millimetresV4(positionM: Vector3V4): Vector3V4 {
  return Object.freeze(positionM.map((component) => (
    component === 0 ? 0 : component * 1000
  ))) as unknown as Vector3V4
}

function frozenRpyV4(pose: RigidTransformV4): Vector3V4 {
  return Object.freeze(quaternionToRpyDegreesV4(pose.quaternion).map((component) => (
    component === 0 ? 0 : component
  ))) as unknown as Vector3V4
}

export function computeActualTcpPoseReadoutV4(
  project: WorkcellProjectV4,
  runtime: SceneRuntimeProjectionV4,
  selection: SceneSelectionV4,
  poseFrame: CoordinateFrameSelectionV4,
): ActualTcpPoseReadoutV4 | null {
  requireMatchingRevisionV4(project, runtime)
  const robotId = robotIdFromSceneSelectionV4(selection)
  if (robotId === null) return null
  const runtimeRobot = runtime.entities.get(robotId)
  if (runtimeRobot?.kind !== 'robot') return null
  const tcpFrameId = runtimeRobot.selectedTcpFrameId
  const tcpWorld = runtime.robotFramesByRobotId.get(robotId)?.get(tcpFrameId)?.worldPose
  if (tcpWorld === undefined) {
    coordinateReadoutFailureV4(
      'COORDINATE_TCP_FRAME_NOT_FOUND',
      `$.robots.${robotId}.selectedTcpFrameId`,
      `Selected TCP Frame ${tcpFrameId} is unresolved for Robot ${robotId}.`,
    )
  }
  const referenceWorld = resolveCoordinateFrameWorldPoseV4(runtime, poseFrame)
  const relative = relativeRigidTransformV4(referenceWorld, tcpWorld)
  return Object.freeze({
    robotId,
    tcpFrameId,
    poseFrame: frozenSelectionV4(poseFrame),
    xyzMm: millimetresV4(relative.positionM),
    rpyDeg: frozenRpyV4(relative),
  })
}
