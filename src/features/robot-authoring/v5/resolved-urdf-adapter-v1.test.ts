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

  it('rejects missing limits and traversal Link fields', () => {
    const xml = readRobotAuthoringFixtureTextV1('fixed-tool.urdf')
    expect(() => parseResolvedUrdfV1(xml.replace(' lower="-1.5707963267948966"', ''), makeResolvedUrdfAssetBindingsV1())).toThrow(/URDF_UNSUPPORTED/)
    expect(() => parseResolvedUrdfV1(xml.replace('link="LINK00"', 'link="../LINK00"'), makeResolvedUrdfAssetBindingsV1())).toThrow(/URDF_UNSUPPORTED/)
  })

  it.each([
    ['lower', '-1.5707963267948966'],
    ['upper', '1.5707963267948966'],
    ['velocity', '3.141592653589793'],
  ])('rejects empty and whitespace-only %s limit lexemes', (attribute, value) => {
    const xml = readRobotAuthoringFixtureTextV1('fixed-tool.urdf')
    expect(() => parseResolvedUrdfV1(xml.replace(`${attribute}="${value}"`, `${attribute}=""`), makeResolvedUrdfAssetBindingsV1())).toThrow(/URDF_UNSUPPORTED/)
    expect(() => parseResolvedUrdfV1(xml.replace(`${attribute}="${value}"`, `${attribute}="   "`), makeResolvedUrdfAssetBindingsV1())).toThrow(/URDF_UNSUPPORTED/)
  })

  it.each([
    ['origin', '<origin xyz="0 0 0.12" rpy="0 0 0"/>', '<origin xyz="0 0 0.12" rpy="0 0 0"><xacro/></origin>'],
    ['parent', '<parent link="LINK00"/>', '<parent link="LINK00"><plugin/></parent>'],
    ['child', '<child link="LINK01"/>', '<child link="LINK01"><plugin/></child>'],
    ['axis', '<axis xyz="0 0 1"/>', '<axis xyz="0 0 1"><plugin/></axis>'],
    ['limit', '<limit lower="-1.5707963267948966" upper="1.5707963267948966" velocity="3.141592653589793"/>', '<limit lower="-1.5707963267948966" upper="1.5707963267948966" velocity="3.141592653589793"><plugin/></limit>'],
  ])('rejects nested content in a %s leaf', (_name, original, replacement) => {
    const xml = readRobotAuthoringFixtureTextV1('fixed-tool.urdf').replace(original, replacement)
    expect(() => parseResolvedUrdfV1(xml, makeResolvedUrdfAssetBindingsV1())).toThrow(/URDF_UNSUPPORTED/)
  })

  it('rejects non-resolved asset-binding provenance', () => {
    const bindings = makeResolvedUrdfAssetBindingsV1()
    const invalid = { ...bindings, mechanics: { ...bindings.mechanics, sourceKind: 'manifest' } } as unknown as typeof bindings
    expect(() => parseResolvedUrdfV1(readRobotAuthoringFixtureTextV1('fixed-tool.urdf'), invalid)).toThrow(/URDF_BINDING_PROVENANCE_INVALID/)
  })

  it('preserves prismatic metres and converts URDF RPY radians', () => {
    const xml = '<robot name="units"><link name="BASE"/><link name="SLIDE"/><joint name="P1" type="prismatic"><parent link="BASE"/><child link="SLIDE"/><origin xyz="0 0 0" rpy="0 0 1.5707963267948966"/><axis xyz="1 0 0"/><limit lower="-0.2" upper="0.4" velocity="0.5"/></joint></robot>'
    const bindings = makeResolvedUrdfAssetBindingsV1()
    const candidate = parseResolvedUrdfV1(xml, { ...bindings, geometryOccurrencesByLinkName: { BASE: [], SLIDE: [] } })
    const joint = candidate.draft.joints[0]!
    expect(joint.min).toBe(-0.2)
    expect(joint.max).toBe(0.4)
    expect(joint.maximumVelocity).toBe(0.5)
    expect(joint.origin.quaternion[2]).toBeCloseTo(Math.SQRT1_2)
    expect(joint.origin.quaternion[3]).toBeCloseTo(Math.SQRT1_2)
  })
})
