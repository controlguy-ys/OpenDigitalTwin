import { describe, expect, it } from 'vitest'

import { validateWorkcellProjectV5 } from '../../../core/project-v5/index.js'
import { createDefaultProjectV5 } from '../../project/v5/default-project-v5.js'
import {
  BUILTIN_NED2_ASSET_REFERENCE_ID_V5,
  BUILTIN_NED2_DEFINITION_ID_V5,
  createBuiltinNed2AssetReferencesV5,
  createBuiltinNed2DefinitionV5,
} from './builtin-ned2-definition-v5.js'

describe('built-in NED2 Definition V5', () => {
  it('adapts the checked-in manifest into one validated six-axis Definition with collision geometry', () => {
    const definition = createBuiltinNed2DefinitionV5()
    const assets = createBuiltinNed2AssetReferencesV5()

    expect(definition).toMatchObject({
      id: BUILTIN_NED2_DEFINITION_ID_V5,
      identification: {
        manufacturer: 'Niryo',
        model: 'NED2',
        motionDeviceCategory: 'ARTICULATED_ROBOT',
      },
      mechanics: {
        status: 'confirmed',
        sourceKind: 'manifest',
      },
      assetReferenceIds: [BUILTIN_NED2_ASSET_REFERENCE_ID_V5],
    })
    expect(definition.links.map(({ id }) => id)).toEqual([
      'LINK00', 'LINK01', 'LINK02', 'LINK03', 'LINK04', 'LINK05', 'LINK06',
    ])
    expect(definition.joints.map(({ id }) => id)).toEqual(['J1', 'J2', 'J3', 'J4', 'J5', 'J6'])
    expect(definition.links.every(({ geometryOccurrences }) => (
      geometryOccurrences.length === 1
      && geometryOccurrences[0]!.collisionBoxes.length === 1
    ))).toBe(true)
    expect(assets).toEqual([expect.objectContaining({
      id: BUILTIN_NED2_ASSET_REFERENCE_ID_V5,
      uri: 'builtin://niryo/ned2-assembly@v1',
      sha256: '94598f79781e8756c1e79cd9ed56f1f43ecb507263db3a2ed2e752e0c4c88752',
      byteLength: 7_250_770,
      sourceFileName: 'NED2_STEP.step',
    })])
  })

  it('survives the complete Project V5 validator as the New Project robot', () => {
    const project = createDefaultProjectV5({
      createProjectId: () => 'project-ned2',
      createRevisionId: () => 'revision-ned2',
      nowIso: () => '2026-07-31T00:00:00.000Z',
    })

    expect(validateWorkcellProjectV5(project)).toEqual(project)
    expect(project.robotDefinitions[0]).toEqual(createBuiltinNed2DefinitionV5())
  })
})
