import { describe, expect, it } from 'vitest'

import { composeRigidTransformV5, type RigidTransformV5 } from '../project-v5/rigid-transform.js'
import type { RobotDefinitionV5 } from '../project-v5/types.js'
import { alignAssembledGeometryV5, homeJointValuesV5 } from './align-assembled-geometry.js'
import { computeSerialRobotPoseV5 } from './serial-kinematics.js'

const identity = (): RigidTransformV5 => ({ positionM: [0, 0, 0], quaternion: [0, 0, 0, 1] })
const occurrence = (occurrenceKey: string) => ({
  occurrenceKey,
  assetReferenceId: 'asset-robot',
  linkLocalPose: identity(),
  statistics: { vertices: 0, triangles: 0, meshes: 0, materials: 0 },
  collisionBoxes: [],
})

function definition(): RobotDefinitionV5 {
  return {
    id: 'robot-definition',
    name: 'Robot',
    identification: { manufacturer: 'Robot', model: 'Model', productCode: 'Robot-1', serialNumberTemplate: null, motionDeviceCategory: 'ARTICULATED_ROBOT' },
    mechanics: { schemaVersion: 1, status: 'confirmed', sourceKind: 'manifest', sourceName: 'robot.json', calibrationRevision: 'r1' },
    assetReferenceIds: ['asset-robot'],
    sourceConventions: {
      'asset-robot': { linearUnit: 'meter', sourceToMeters: 1, orientation: { mode: 'up-axis', upAxis: 'z' } },
    },
    links: [
      { id: 'LINK00', name: 'Base', geometryOccurrences: [occurrence('LINK00-body')] },
      { id: 'LINK01', name: 'Shoulder', geometryOccurrences: [occurrence('LINK01-body')] },
      { id: 'LINK02', name: 'Arm', geometryOccurrences: [occurrence('LINK02-body')] },
    ],
    joints: [
      { id: 'J1', type: 'revolute', parentLinkId: 'LINK00', childLinkId: 'LINK01', origin: identity(), axis: [0, 0, 1], min: -180, max: 180, home: 0, zeroOffset: 0, direction: 1, maximumVelocity: 90 },
      { id: 'J2', type: 'revolute', parentLinkId: 'LINK01', childLinkId: 'LINK02', origin: { positionM: [0, 1, 0], quaternion: [0, 0, 0, 1] }, axis: [0, 0, 1], min: -180, max: 180, home: 30, zeroOffset: 0, direction: 1, maximumVelocity: 90 },
    ],
    frames: [],
    excludedGeometryOccurrenceKeys: [],
  }
}

function occurrenceWorldPoses(definition: RobotDefinitionV5): Readonly<Record<string, RigidTransformV5>> {
  const home = computeSerialRobotPoseV5(definition, homeJointValuesV5(definition))
  return Object.freeze({
    'LINK00-body': { positionM: [0, 0, 0], quaternion: [0, 0, 0, 1] },
    'LINK01-body': { positionM: [0.25, 0, 0], quaternion: [0, 0, Math.SQRT1_2, Math.SQRT1_2] },
    'LINK02-body': composeRigidTransformV5(home.linkWorldPoses.LINK02!, { positionM: [0.5, 0, 0], quaternion: [0, 0, 0, 1] }),
  })
}

function expectOccurrenceWorldPoses(definition: RobotDefinitionV5, expected: Readonly<Record<string, RigidTransformV5>>): void {
  const pose = computeSerialRobotPoseV5(definition, homeJointValuesV5(definition))
  for (const link of definition.links) for (const geometry of link.geometryOccurrences) {
    const actual = composeRigidTransformV5(pose.linkWorldPoses[link.id]!, geometry.linkLocalPose)
    const target = expected[geometry.occurrenceKey]!
    actual.positionM.forEach((component, index) => expect(component).toBeCloseTo(target.positionM[index]!, 9))
    actual.quaternion.forEach((component, index) => expect(component).toBeCloseTo(target.quaternion[index]!, 9))
  }
}

describe('assembled Geometry alignment', () => {
  it('preserves assembled source placement at Home and follows the Link after motion', () => {
    const source = definition()
    const assembled = occurrenceWorldPoses(source)

    const aligned = alignAssembledGeometryV5(source, assembled)

    expectOccurrenceWorldPoses(aligned, assembled)
    const moved = computeSerialRobotPoseV5(aligned, { ...homeJointValuesV5(aligned), J2: 45 })
    const occurrence = aligned.links[2]!.geometryOccurrences[0]!
    expect(composeRigidTransformV5(moved.linkWorldPoses.LINK02!, occurrence.linkLocalPose))
      .not.toEqual(assembled['LINK02-body'])
  })

  it('requires exactly one finite assembled pose for each canonical occurrence', () => {
    const source = definition()
    const assembled = occurrenceWorldPoses(source)

    expect(() => alignAssembledGeometryV5(source, { ...assembled, extra: identity() })).toThrow(/GEOMETRY_OCCURRENCE_ALIGNMENT_MISMATCH/)
    const { 'LINK02-body': _missing, ...missing } = assembled
    expect(() => alignAssembledGeometryV5(source, missing)).toThrow(/GEOMETRY_OCCURRENCE_ALIGNMENT_MISMATCH/)
    expect(() => alignAssembledGeometryV5(source, { ...assembled, 'LINK02-body': { positionM: [Infinity, 0, 0], quaternion: [0, 0, 0, 1] } })).toThrow(/POSITION_COMPONENT_NOT_FINITE/)
  })

  it('rejects duplicate occurrence keys in the Definition', () => {
    const source = definition()
    const duplicate = { ...source, links: [...source.links, { id: 'LINK03', name: 'Duplicate', geometryOccurrences: [occurrence('LINK02-body')] }] }

    expect(() => alignAssembledGeometryV5(duplicate, occurrenceWorldPoses(source))).toThrow(/GEOMETRY_OCCURRENCE_DUPLICATE/)
  })

  it('rejects accessor-backed, inherited, and extra fields in assembled pose records', () => {
    const source = definition()
    const assembled = occurrenceWorldPoses(source)
    const accessorPose = {} as Record<string, unknown>
    Object.defineProperty(accessorPose, 'positionM', { enumerable: true, get: () => { throw new Error('must not invoke') } })
    Object.defineProperty(accessorPose, 'quaternion', { enumerable: true, value: [0, 0, 0, 1] })

    expect(() => alignAssembledGeometryV5(source, { ...assembled, 'LINK02-body': accessorPose as unknown as RigidTransformV5 })).toThrow(/PROJECT_RECORD_NOT_CLOSED/)
    expect(() => alignAssembledGeometryV5(source, { ...assembled, 'LINK02-body': { positionM: [0, 0, 0], quaternion: [0, 0, 0, 1], extra: true } as RigidTransformV5 })).toThrow(/PROJECT_RECORD_NOT_CLOSED/)
    expect(() => alignAssembledGeometryV5(source, { ...assembled, 'LINK02-body': Object.assign(Object.create({ quaternion: [0, 0, 0, 1] }), { positionM: [0, 0, 0] }) as RigidTransformV5 })).toThrow(/PROJECT_RECORD_PROTOTYPE_INVALID/)
  })
})
