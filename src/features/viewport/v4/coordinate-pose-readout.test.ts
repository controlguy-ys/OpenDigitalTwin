import { describe, expect, it } from 'vitest'
import {
  ProjectV4Error,
  rpyDegreesToQuaternionV4,
  validateWorkcellProjectV4,
  type RigidTransformV4,
  type SpatialEntityV4,
  type WorkcellProjectV4,
} from '../../../core/project-v4/index.js'
import {
  makeMinimalWorkcellProjectV4,
  projectAtLimit,
} from '../../../core/project-v4/test-support.js'
import { createRobotRuntimeRegistryV4 } from '../../robot/v4/robot-runtime-registry.js'
import { selectSceneRuntimeV4 } from '../../scene/v4/scene-runtime-selector.js'
import { sceneSelectionKeyV4 } from '../../interaction/v4/scene-selection.js'
import {
  computeActualTcpPoseReadoutV4,
  coordinateFrameOptionsV4,
  resolveCoordinateFrameWorldPoseV4,
} from './coordinate-pose-readout.js'

function pose(
  x = 0,
  y = 0,
  z = 0,
  rpy: readonly [number, number, number] = [0, 0, 0],
): RigidTransformV4 {
  return { positionM: [x, y, z], quaternion: rpyDegreesToQuaternionV4(rpy) }
}

function entity(): SpatialEntityV4 {
  return {
    id: 'entity-a',
    name: 'Fixture A',
    geometry: { kind: 'box', dimensionsM: [1, 1, 1], color: '#808080' },
    parentFrameId: 'world',
    localPose: pose(0, 3, 0),
    visible: true,
    groupId: null,
    removable: true,
    transformOwner: 'manual',
    numericStatus: {
      value: 0,
      sourceOwnership: 'manual',
      overlay: { visible: false, frameId: null },
    },
    graspable: true,
    graspFrames: [{ frameId: 'grasp-a', name: 'Grip A', localPose: pose(0, 0, 1) }],
    movingFrames: [{
      frameId: 'moving-a',
      name: 'Carriage A',
      parentFrameId: 'mcp',
      localPose: pose(0, 4, 0),
      sourceOwnership: 'manual',
    }],
  }
}

function richProject(): WorkcellProjectV4 {
  const source = projectAtLimit('robots', 2)
  const definition = source.robotDefinitions[0]!
  return validateWorkcellProjectV4({
    ...source,
    revisionId: 'revision-readout',
    scene: {
      frames: source.scene.frames.map((frame) => frame.role === 'world'
        ? { ...frame, localPose: pose(10, 0, 0) }
        : { ...frame, localPose: pose(0, 20, 0) }),
    },
    robotDefinitions: [{
      ...definition,
      frames: definition.frames.map((frame) => frame.id === 'TCP'
        ? { ...frame, localPose: pose(0, 0, 0, [0, 0, 90]) }
        : frame),
    }],
    robots: source.robots.map((robot, index) => ({
      ...robot,
      localBasePose: pose(index + 1, 0, 0),
    })),
    spatialEntities: [entity()],
  })
}

function runtime(project: WorkcellProjectV4) {
  const robots = createRobotRuntimeRegistryV4()
  robots.getState().replaceProject(project)
  return selectSceneRuntimeV4(project, robots.getState())
}

describe('coordinate pose readout V4', () => {
  it('lists global Frames followed by only the selected Robot local Frames', () => {
    const project = richProject()
    const projection = runtime(project)
    const optionsA = coordinateFrameOptionsV4(
      project,
      projection,
      { kind: 'robot', robotId: 'robot-1' },
    )
    const optionsB = coordinateFrameOptionsV4(
      project,
      projection,
      { kind: 'robot-frame', robotId: 'robot-2', frameId: 'TCP' },
    )

    expect(optionsA.map(({ selection }) => selection)).toEqual([
      { kind: 'scene-frame', frameId: 'world' },
      { kind: 'scene-frame', frameId: 'mcp' },
      { kind: 'robot-frame', robotId: 'robot-1', frameId: 'Base' },
      { kind: 'robot-frame', robotId: 'robot-1', frameId: 'Tool' },
      { kind: 'robot-frame', robotId: 'robot-1', frameId: 'TCP' },
    ])
    const tcpA = optionsA.find(({ selection }) => (
      selection.kind === 'robot-frame' && selection.frameId === 'TCP'
    ))!
    const tcpB = optionsB.find(({ selection }) => (
      selection.kind === 'robot-frame' && selection.frameId === 'TCP'
    ))!
    expect(tcpA.key).toBe(sceneSelectionKeyV4(tcpA.selection))
    expect(tcpB.key).toBe(sceneSelectionKeyV4(tcpB.selection))
    expect(tcpA.key).not.toBe(tcpB.key)
    expect(tcpA.worldPose.positionM).toEqual([11, 20, 0])
    expect(tcpB.worldPose.positionM).toEqual([12, 20, 0])
    expect(optionsA.find(({ selection }) => (
      selection.kind === 'scene-frame' && selection.frameId === 'world'
    ))?.editable).toBe(false)
    expect(optionsA.find(({ selection }) => (
      selection.kind === 'scene-frame' && selection.frameId === 'mcp'
    ))?.editable).toBe(true)
    expect(optionsA.find(({ selection }) => (
      selection.kind === 'robot-frame' && selection.frameId === 'Base'
    ))?.editable).toBe(true)
    expect(tcpA.editable).toBe(false)
  })

  it('lists only the selected Entity Grasp and Moving Frames after global Frames', () => {
    const project = richProject()
    const options = coordinateFrameOptionsV4(
      project,
      runtime(project),
      { kind: 'entity-frame', entityId: 'entity-a', frameId: 'grasp-a' },
    )

    expect(options.map(({ selection }) => selection)).toEqual([
      { kind: 'scene-frame', frameId: 'world' },
      { kind: 'scene-frame', frameId: 'mcp' },
      { kind: 'entity-frame', entityId: 'entity-a', frameId: 'grasp-a' },
      { kind: 'entity-frame', entityId: 'entity-a', frameId: 'moving-a' },
    ])
    expect(options.find(({ selection }) => (
      selection.kind === 'entity-frame' && selection.frameId === 'grasp-a'
    ))?.editable).toBe(false)
    expect(options.find(({ selection }) => (
      selection.kind === 'entity-frame' && selection.frameId === 'moving-a'
    ))?.editable).toBe(true)
  })

  it('returns only global options without a Robot or Spatial selection', () => {
    const project = richProject()
    const options = coordinateFrameOptionsV4(project, runtime(project), null)
    expect(options.map(({ selection }) => selection.kind)).toEqual([
      'scene-frame',
      'scene-frame',
    ])
  })

  it('resolves every structured Frame kind without aliasing local IDs', () => {
    const project = richProject()
    const projection = runtime(project)

    expect(resolveCoordinateFrameWorldPoseV4(projection, {
      kind: 'scene-frame', frameId: 'mcp',
    }).positionM).toEqual([10, 20, 0])
    expect(resolveCoordinateFrameWorldPoseV4(projection, {
      kind: 'robot-frame', robotId: 'robot-2', frameId: 'TCP',
    }).positionM).toEqual([12, 20, 0])
    expect(resolveCoordinateFrameWorldPoseV4(projection, {
      kind: 'entity-frame', entityId: 'entity-a', frameId: 'grasp-a',
    }).positionM).toEqual([10, 3, 1])
    expect(resolveCoordinateFrameWorldPoseV4(projection, {
      kind: 'entity-frame', entityId: 'entity-a', frameId: 'moving-a',
    }).positionM).toEqual([10, 24, 0])
  })

  it('returns exact structured option and readout identities without forged fields', () => {
    const project = richProject()
    const forgedSelection = {
      kind: 'robot-frame' as const,
      robotId: 'robot-1',
      frameId: 'TCP',
      worldPose: { positionM: [9, 9, 9] },
    }
    const options = coordinateFrameOptionsV4(project, runtime(project), forgedSelection)
    const tcp = options.find(({ selection }) => (
      selection.kind === 'robot-frame' && selection.frameId === 'TCP'
    ))!
    const readout = computeActualTcpPoseReadoutV4(
      project,
      runtime(project),
      forgedSelection,
      forgedSelection,
    )

    expect(tcp.selection).toEqual({
      kind: 'robot-frame',
      robotId: 'robot-1',
      frameId: 'TCP',
    })
    expect(tcp.selection).not.toHaveProperty('worldPose')
    expect(readout?.poseFrame).toEqual({
      kind: 'robot-frame',
      robotId: 'robot-1',
      frameId: 'TCP',
    })
    expect(readout?.poseFrame).not.toHaveProperty('worldPose')
  })

  it('computes selected Robot Actual TCP relative to the structured display Frame', () => {
    const project = richProject()
    const readout = computeActualTcpPoseReadoutV4(
      project,
      runtime(project),
      { kind: 'robot-link', robotId: 'robot-1', linkId: 'L0' },
      { kind: 'scene-frame', frameId: 'mcp' },
    )

    expect(readout).toMatchObject({
      robotId: 'robot-1',
      tcpFrameId: 'TCP',
      poseFrame: { kind: 'scene-frame', frameId: 'mcp' },
      xyzMm: [1000, 0, 0],
    })
    expect(readout?.rpyDeg[0]).toBeCloseTo(0, 12)
    expect(readout?.rpyDeg[1]).toBeCloseTo(0, 12)
    expect(readout?.rpyDeg[2]).toBeCloseTo(90, 12)
  })

  it('returns no Actual TCP for zero Robots or a non-Robot selection', () => {
    const zeroRobot = validateWorkcellProjectV4({
      ...makeMinimalWorkcellProjectV4(),
      revisionId: 'revision-readout-zero',
      assetReferences: [],
      robotDefinitions: [],
      robots: [],
    })
    expect(computeActualTcpPoseReadoutV4(
      zeroRobot,
      runtime(zeroRobot),
      null,
      { kind: 'scene-frame', frameId: 'world' },
    )).toBeNull()

    const project = richProject()
    expect(computeActualTcpPoseReadoutV4(
      project,
      runtime(project),
      { kind: 'spatial-entity', entityId: 'entity-a' },
      { kind: 'scene-frame', frameId: 'world' },
    )).toBeNull()
  })

  it('fails deterministically for unresolved Frames or mismatched revisions', () => {
    const project = richProject()
    const projection = runtime(project)
    expect(() => resolveCoordinateFrameWorldPoseV4(projection, {
      kind: 'robot-frame', robotId: 'robot-1', frameId: 'missing',
    })).toThrow(ProjectV4Error)
    expect(() => coordinateFrameOptionsV4(
      { ...project, revisionId: 'revision-other' },
      projection,
      { kind: 'robot', robotId: 'robot-1' },
    )).toThrowError(/SCENE_RUNTIME_PROJECT_REVISION_MISMATCH/)
  })
})
