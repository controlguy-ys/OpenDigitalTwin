import { describe, expect, it } from 'vitest'

import { materializeRobotMechanicsImportCandidateV5 } from '../../../core/robot-runtime-v5/materialize-robot-mechanics-import.js'
import { makeResolvedUrdfAssetBindingsV1, parseResolvedUrdfFixtureWithV1, readRobotAuthoringFixtureTextV1 } from './fixture-support.test.js'
import { parseResolvedUrdfV1 } from './resolved-urdf-adapter-v1.js'

describe('resolved URDF adapter V1', () => {
  it('uses parent-to-joint origin, joint-frame axis, and collapses a fixed tool', () => {
    const candidate = parseResolvedUrdfV1(readRobotAuthoringFixtureTextV1('fixed-tool.urdf'), makeResolvedUrdfAssetBindingsV1())
    const definition = materializeRobotMechanicsImportCandidateV5(candidate)
    expect(definition.joints.map(({ type }) => type)).toEqual(['revolute', 'revolute'])
    expect(definition.joints[1]!.origin.positionM).toEqual([0, 0, 0.31])
    expect(definition.frames.find(({ role }) => role === 'tcp')?.parentFrameId).toBe('LINK02')
    expect(definition.joints[0]!.min).toBeCloseTo(-90)
    expect(definition.joints[0]!.maximumVelocity).toBeCloseTo(180)
  })

  it.each(['continuous', 'floating', 'planar', 'mimic'])('rejects unsupported resolved URDF construct %s', (construct) => {
    expect(() => parseResolvedUrdfFixtureWithV1(construct)).toThrow(/URDF_UNSUPPORTED/)
  })
})
