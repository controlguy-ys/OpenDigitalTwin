import { describe, expect, it } from 'vitest'

import { materializeRobotMechanicsImportCandidateV5 } from '../../../core/robot-runtime-v5/materialize-robot-mechanics-import.js'
import { readRobotAuthoringFixtureBytesV1 } from './fixture-support.test.js'
import { decodeRobotDefinitionManifestV1 } from './robot-definition-manifest-v1.js'

describe('Robot definition Manifest V1', () => {
  it('decodes independent per-Joint origins and occurrence-to-Link mappings', () => {
    const candidate = decodeRobotDefinitionManifestV1(readRobotAuthoringFixtureBytesV1('two-offset-six-axis.robot.json'))
    expect(candidate.mechanics.sourceKind).toBe('manifest')
    expect(candidate.draft.joints[1]!.origin.positionM).toEqual([0, 0, 0.42])
    expect(candidate.draft.joints[1]!.axis).toEqual([0, 1, 0])
    expect(candidate.draft.links[2]!.geometryOccurrences[0]!.occurrenceKey).toBe('arm-link-2')
    expect(materializeRobotMechanicsImportCandidateV5(candidate).joints).toHaveLength(6)
  })

  it('rejects traversal and unknown Manifest fields', () => {
    const bytes = new TextEncoder().encode('{"schema":"open-digital-twin/robot-definition-manifest/1","unexpected":true}')
    expect(() => decodeRobotDefinitionManifestV1(bytes)).toThrow(/PROJECT_RECORD_NOT_CLOSED|PROJECT_VALUE_INVALID/)
  })

  it.each([
    ['zero', 0],
    ['negative', -1],
    ['unit mismatch', 0.001],
  ])('rejects %s sourceToMeters values', (_name, sourceToMeters) => {
    const manifest = JSON.parse(readRobotAuthoringFixtureBytesV1('two-offset-six-axis.robot.json').toString())
    manifest.definition.sourceConventions['asset-robot'].sourceToMeters = sourceToMeters
    expect(() => decodeRobotDefinitionManifestV1(new TextEncoder().encode(JSON.stringify(manifest)))).toThrow(/PROJECT_VALUE_INVALID/)
  })

  it('rejects traversal source fields and duplicate collision box IDs', () => {
    const manifest = JSON.parse(readRobotAuthoringFixtureBytesV1('two-offset-six-axis.robot.json').toString())
    manifest.mechanics.sourceName = '../robot.json'
    expect(() => decodeRobotDefinitionManifestV1(new TextEncoder().encode(JSON.stringify(manifest)))).toThrow(/PROJECT_VALUE_INVALID/)
    manifest.mechanics.sourceName = 'robot.json'
    const box = { id: 'duplicate-box', centerM: [0, 0, 0], halfExtentsM: [1, 1, 1], quaternion: [0, 0, 0, 1] }
    manifest.draft.links[0].geometryOccurrences[0].collisionBoxes = [box]
    manifest.draft.links[1].geometryOccurrences[0].collisionBoxes = [box]
    expect(() => decodeRobotDefinitionManifestV1(new TextEncoder().encode(JSON.stringify(manifest)))).toThrow(/PROJECT_ID_DUPLICATE/)
  })
})
