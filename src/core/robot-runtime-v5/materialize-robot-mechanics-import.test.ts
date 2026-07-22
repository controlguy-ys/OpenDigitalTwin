import { describe, expect, it } from 'vitest'

import { composeRigidTransformV5, type RigidTransformV5 } from '../project-v5/rigid-transform.js'
import type { RobotMechanicsImportCandidateV1 } from './robot-mechanics-import-candidate.js'
import { homeJointValuesV5 } from './align-assembled-geometry.js'
import { materializeRobotMechanicsImportCandidateV5 } from './materialize-robot-mechanics-import.js'
import { computeSerialRobotPoseV5 } from './serial-kinematics.js'

const identity = (): RigidTransformV5 => ({ positionM: [0, 0, 0], quaternion: [0, 0, 0, 1] })
const occurrence = (occurrenceKey: string) => ({ occurrenceKey, assetReferenceId: 'asset-robot', linkLocalPose: identity(), statistics: { vertices: 0, triangles: 0, meshes: 0, materials: 0 }, collisionBoxes: [] })

function makeAssembledHomeCandidate(): RobotMechanicsImportCandidateV1 {
  return {
    schemaVersion: 1,
    definition: {
      id: 'robot-definition', name: 'Robot',
      identification: { manufacturer: 'Robot', model: 'Model', productCode: 'Robot-1', serialNumberTemplate: null, motionDeviceCategory: 'ARTICULATED_ROBOT' },
      assetReferenceIds: ['asset-robot'],
      sourceConventions: { 'asset-robot': { linearUnit: 'meter', sourceToMeters: 1, orientation: { mode: 'up-axis', upAxis: 'z' } } },
      excludedGeometryOccurrenceKeys: [],
    },
    mechanics: { schemaVersion: 1, status: 'confirmed', sourceKind: 'manifest', sourceName: 'robot.json', calibrationRevision: 'r1' },
    draft: {
      links: [
        { id: 'LINK00', name: 'Base', geometryOccurrences: [occurrence('LINK00-body')] },
        { id: 'LINK01', name: 'Shoulder', geometryOccurrences: [occurrence('LINK01-body')] },
        { id: 'CAMERA', name: 'Camera', geometryOccurrences: [occurrence('CAMERA-body')] },
        { id: 'LINK02', name: 'Arm', geometryOccurrences: [occurrence('LINK02-body')] },
      ],
      joints: [
        { id: 'J1', type: 'revolute', parentLinkId: 'LINK00', childLinkId: 'LINK01', origin: identity(), axis: [0, 0, 1], min: -180, max: 180, home: 0, zeroOffset: 0, direction: 1, maximumVelocity: 90 },
        { id: 'CAMERA-MOUNT', type: 'fixed', parentLinkId: 'LINK01', childLinkId: 'CAMERA', origin: { positionM: [0.2, 0, 0], quaternion: [0, 0, 0, 1] }, axis: null, min: null, max: null, home: null, zeroOffset: 0, direction: 1, maximumVelocity: null },
        { id: 'J2', type: 'revolute', parentLinkId: 'LINK01', childLinkId: 'LINK02', origin: { positionM: [0, 1, 0], quaternion: [0, 0, 0, 1] }, axis: [0, 0, 1], min: -180, max: 180, home: 30, zeroOffset: 0, direction: 1, maximumVelocity: 90 },
      ],
      frames: [],
    },
    geometryAlignment: {
      kind: 'assembled-home',
      occurrenceWorldPoses: {
        'LINK00-body': { positionM: [0, 0, 0], quaternion: [0, 0, 0, 1] },
        'LINK01-body': { positionM: [0.25, 0, 0], quaternion: [0, 0, Math.SQRT1_2, Math.SQRT1_2] },
        'CAMERA-body': { positionM: [0.2, 0, 0], quaternion: [0, 0, 0, 1] },
        'LINK02-body': { positionM: [0, 1.5, 0], quaternion: [0, 0, 0, 1] },
      },
    },
  }
}

describe('Robot mechanics import materialization', () => {
  it('canonicalizes fixed Links before aligning assembled Geometry at Home', () => {
    const candidate = makeAssembledHomeCandidate()
    const aligned = materializeRobotMechanicsImportCandidateV5(candidate)
    const assembled = (candidate.geometryAlignment as Extract<typeof candidate.geometryAlignment, { readonly kind: 'assembled-home' }>).occurrenceWorldPoses
    const home = computeSerialRobotPoseV5(aligned, homeJointValuesV5(aligned))

    expect(aligned.links.map(({ id }) => id)).toEqual(['LINK00', 'LINK01', 'LINK02'])
    for (const link of aligned.links) for (const geometry of link.geometryOccurrences) {
      const actual = composeRigidTransformV5(home.linkWorldPoses[link.id]!, geometry.linkLocalPose)
      const expected = assembled[geometry.occurrenceKey]!
      actual.positionM.forEach((component, index) => expect(component).toBeCloseTo(expected.positionM[index]!, 9))
      actual.quaternion.forEach((component, index) => expect(component).toBeCloseTo(expected.quaternion[index]!, 9))
    }
  })

  it('preserves link-local Geometry without realignment', () => {
    const candidate = makeAssembledHomeCandidate()
    const linkLocal = { ...candidate, geometryAlignment: { kind: 'link-local' as const } }

    const materialized = materializeRobotMechanicsImportCandidateV5(linkLocal)

    expect(materialized.links[1]!.geometryOccurrences.find(({ occurrenceKey }) => occurrenceKey === 'CAMERA-body')!.linkLocalPose.positionM).toEqual([0.2, 0, 0])
  })

  it('rejects unclosed candidates and invalid Mechanics provenance before canonicalization', () => {
    const candidate = makeAssembledHomeCandidate()

    expect(() => materializeRobotMechanicsImportCandidateV5({ ...candidate, unexpected: true } as unknown as RobotMechanicsImportCandidateV1)).toThrow(/PROJECT_VALUE_INVALID/)
    expect(() => materializeRobotMechanicsImportCandidateV5({ ...candidate, mechanics: { ...candidate.mechanics, calibrationRevision: '' } })).toThrow(/PROJECT_VALUE_INVALID/)
  })

  it('rejects an accessor-backed alignment discriminator without invoking it', () => {
    const candidate = makeAssembledHomeCandidate()
    const alignment = {} as Record<string, unknown>
    Object.defineProperty(alignment, 'kind', { enumerable: true, get: () => { throw new Error('must not invoke') } })

    expect(() => materializeRobotMechanicsImportCandidateV5({ ...candidate, geometryAlignment: alignment as RobotMechanicsImportCandidateV1['geometryAlignment'] })).toThrow(/PROJECT_VALUE_INVALID/)
  })
})
