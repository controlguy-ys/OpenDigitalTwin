import { EMPTY_SOLVER_PARAMETERS_SHA256_V1 } from './limits.js'
import type {
  MechanismBodyV1,
  MechanismDefinitionV1,
  MechanismFrameV1,
  MechanismJointV1,
  MechanismMotionGroupV1,
  RigidTransformV1,
} from './types.js'

export const identityPoseV1: RigidTransformV1 = {
  positionM: [0, 0, 0],
  quaternion: [0, 0, 0, 1],
}

function body(bodyId: string): MechanismBodyV1 {
  return { bodyId, name: bodyId }
}

function fixed(jointId: string, parentBodyId: string, childBodyId: string): MechanismJointV1 {
  return { jointId, jointType: 'fixed', parentBodyId, childBodyId, origin: identityPoseV1 }
}

function movable(
  jointId: string,
  jointType: 'revolute' | 'prismatic',
  parentBodyId: string,
  childBodyId: string,
): MechanismJointV1 {
  return {
    jointId,
    jointType,
    parentBodyId,
    childBodyId,
    origin: identityPoseV1,
    axis: [0, 0, 1],
    minimum: jointType === 'revolute' ? -Math.PI : 0,
    maximum: jointType === 'revolute' ? Math.PI : 1,
    home: 0,
    zeroOffset: 0,
    direction: 1,
    maximumVelocity: 1,
  }
}

function frame(frameId: string, parentBodyId: string): MechanismFrameV1 {
  return {
    frameId,
    name: frameId,
    role: 'custom',
    parent: { type: 'body', bodyId: parentBodyId },
    localPose: identityPoseV1,
  }
}

function definition(
  bodies: readonly MechanismBodyV1[],
  joints: readonly MechanismJointV1[],
  frames: readonly MechanismFrameV1[] = [],
  motionGroups: readonly MechanismMotionGroupV1[] = [],
): MechanismDefinitionV1 {
  return {
    mechanismId: 'fixture-mechanism',
    name: 'Fixture mechanism',
    topologyKind: 'tree',
    solverRef: {
      solverKey: 'open-digital-twin/tree-fk',
      contractVersion: '1',
      parameters: {},
      normalizedParametersHash: EMPTY_SOLVER_PARAMETERS_SHA256_V1,
    },
    bodies,
    joints,
    frames,
    motionGroups,
    constraints: [],
    geometryBindings: [],
    sourceProvenance: {
      sourceKind: 'fixture',
      sourceDetail: 'Deterministic test fixture.',
      sourceName: 'test-support',
      sourceRevision: '1',
      adapterKey: null,
      adapterVersion: null,
    },
  }
}

export function makeOneRevoluteMechanismV1(): MechanismDefinitionV1 {
  return definition([body('base'), body('arm')], [movable('joint-1', 'revolute', 'base', 'arm')])
}

export function makeMixedTreeMechanismV1(): MechanismDefinitionV1 {
  return definition(
    [body('base'), body('pedestal'), body('arm'), body('tool')],
    [
      fixed('fixed-pedestal', 'base', 'pedestal'),
      movable('arm-slide', 'prismatic', 'pedestal', 'arm'),
      movable('tool-roll', 'revolute', 'arm', 'tool'),
    ],
  )
}

export function makeBranchedMechanismV1(): MechanismDefinitionV1 {
  return definition(
    [body('base'), body('head'), body('left-upper'), body('left-lower'), body('right-upper'), body('right-lower')],
    [
      movable('right-elbow', 'revolute', 'right-upper', 'right-lower'),
      movable('left-elbow', 'revolute', 'left-upper', 'left-lower'),
      movable('right-shoulder', 'revolute', 'base', 'right-upper'),
      movable('head-yaw', 'revolute', 'base', 'head'),
      movable('left-shoulder', 'revolute', 'base', 'left-upper'),
    ],
  )
}

export function makeCncMechanismV1(): MechanismDefinitionV1 {
  return definition(
    [body('base'), body('x'), body('y'), body('z')],
    [
      movable('axis-x', 'prismatic', 'base', 'x'),
      movable('axis-y', 'prismatic', 'x', 'y'),
      movable('axis-z', 'prismatic', 'y', 'z'),
    ],
  )
}

export function makeMaximumTreeMechanismV1(): MechanismDefinitionV1 {
  const bodies = Array.from({ length: 128 }, (_, index) => body(`body-${String(index).padStart(3, '0')}`))
  const joints = Array.from({ length: 127 }, (_, index) => (
    index < 64
      ? movable(`joint-${String(index).padStart(3, '0')}`, 'revolute', bodies[index]!.bodyId, bodies[index + 1]!.bodyId)
      : fixed(`joint-${String(index).padStart(3, '0')}`, bodies[index]!.bodyId, bodies[index + 1]!.bodyId)
  ))
  return definition(bodies, joints)
}

export function makeMechanismTreeFkBenchmarkFixtureV1(): {
  readonly mechanismDefinition: MechanismDefinitionV1
  readonly rootWorldPose: RigidTransformV1
  readonly coordinatesByStableId: Readonly<Record<string, number>>
} {
  const bodies = Array.from({ length: 128 }, (_, index) => body(`benchmark-body-${String(index).padStart(3, '0')}`))
  const joints = Array.from({ length: 127 }, (_, index) => {
    const childBodyId = bodies[index + 1]!.bodyId
    const parentBodyId = index < 4
      ? bodies[0]!.bodyId
      : bodies[index - 3]!.bodyId
    return index < 64
      ? movable(`benchmark-joint-${String(index).padStart(3, '0')}`, 'prismatic', parentBodyId, childBodyId)
      : fixed(`benchmark-joint-${String(index).padStart(3, '0')}`, parentBodyId, childBodyId)
  })
  const coordinatesByStableId = Object.fromEntries(joints
    .filter((joint) => joint.jointType !== 'fixed')
    .map((joint, index) => [joint.jointId, ((index % 13) + 1) / 14]))

  return {
    mechanismDefinition: {
      ...definition(bodies, joints),
      mechanismId: 'fixture-mechanism-tree-fk-benchmark',
      name: 'Tree FK benchmark fixture',
    },
    rootWorldPose: {
      positionM: [1.25, -2.5, 0.75],
      quaternion: [0, 0, 0, 1],
    },
    coordinatesByStableId,
  }
}

export function makeNestedFrameMechanismV1(): MechanismDefinitionV1 {
  return definition(
    [body('base'), body('tool')],
    [movable('joint-1', 'revolute', 'base', 'tool')],
    [
      frame('base-frame', 'base'),
      {
        ...frame('mount-frame', 'base'),
        parent: { type: 'frame', frameId: 'base-frame' },
      },
      {
        ...frame('tool-frame', 'tool'),
        parent: { type: 'frame', frameId: 'mount-frame' },
      },
    ],
  )
}

function detachedPose(positionM: [number, number, number] = [0, 0, 0]): RigidTransformV1 {
  return {
    positionM: [...positionM] as [number, number, number],
    quaternion: [0, 0, 0, 1],
  }
}

function fixtureDefinition(
  mechanismId: string,
  name: string,
  bodies: readonly MechanismBodyV1[],
  joints: readonly MechanismJointV1[],
  frames: readonly MechanismFrameV1[],
): MechanismDefinitionV1 {
  return {
    mechanismId,
    name,
    topologyKind: 'tree',
    solverRef: {
      solverKey: 'open-digital-twin/tree-fk',
      contractVersion: '1',
      parameters: {},
      normalizedParametersHash: EMPTY_SOLVER_PARAMETERS_SHA256_V1,
    },
    bodies,
    joints,
    frames,
    motionGroups: [],
    constraints: [],
    geometryBindings: [],
    sourceProvenance: {
      sourceKind: 'fixture',
      sourceDetail: 'Deterministic composition test fixture.',
      sourceName: 'test-support',
      sourceRevision: '1',
      adapterKey: null,
      adapterVersion: null,
    },
  }
}

export function makeLinearCarriageMechanismV1(): MechanismDefinitionV1 {
  return fixtureDefinition(
    'fixture-linear-carriage',
    'Linear carriage fixture',
    [{ bodyId: 'carriage-base', name: 'Carriage base' }, { bodyId: 'carriage', name: 'Carriage' }],
    [{
      jointId: 'carriage-axis',
      jointType: 'prismatic',
      parentBodyId: 'carriage-base',
      childBodyId: 'carriage',
      origin: detachedPose(),
      axis: [1, 0, 0],
      minimum: 0,
      maximum: 1,
      home: 0,
      zeroOffset: 0,
      direction: 1,
      maximumVelocity: 1,
    }],
    [{
      frameId: 'carriage',
      name: 'Carriage mount',
      role: 'mount',
      parent: { type: 'body', bodyId: 'carriage' },
      localPose: detachedPose([0.25, 0, 0]),
    }],
  )
}

export function makeMountedRobotMechanismV1(): MechanismDefinitionV1 {
  return fixtureDefinition(
    'fixture-mounted-robot',
    'Mounted robot fixture',
    [{ bodyId: 'robot-base', name: 'Robot base' }, { bodyId: 'robot-tool', name: 'Robot tool' }],
    [{
      jointId: 'robot-slide',
      jointType: 'prismatic',
      parentBodyId: 'robot-base',
      childBodyId: 'robot-tool',
      origin: detachedPose(),
      axis: [1, 0, 0],
      minimum: 0,
      maximum: 1,
      home: 0,
      zeroOffset: 0,
      direction: 1,
      maximumVelocity: 1,
    }],
    [{
      frameId: 'tcp',
      name: 'TCP',
      role: 'tcp',
      parent: { type: 'body', bodyId: 'robot-tool' },
      localPose: detachedPose([0, 0, 0.3]),
    }],
  )
}
