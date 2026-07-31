import manifest from '../../../../public/models/robot/ned2/manifest.json' with { type: 'json' }

import {
  validateRobotDefinitionShapeV5,
  type AssetReferenceV5,
  type RobotDefinitionV5,
} from '../../../core/project-v5/index.js'

export const BUILTIN_NED2_ASSET_REFERENCE_ID_V5 = 'builtin-niryo-ned2-assembly-v1' as const
export const BUILTIN_NED2_DEFINITION_ID_V5 = 'builtin-niryo-ned2-v1' as const

export function createBuiltinNed2AssetReferencesV5(): readonly AssetReferenceV5[] {
  const source = manifest.assetReference
  const asset: AssetReferenceV5 = {
    id: source.id,
    uri: 'builtin://niryo/ned2-assembly@v1',
    sha256: source.sha256,
    byteLength: source.byteLength,
    sourceFileName: source.sourceFileName,
    mediaType: 'model/step',
  }
  return [asset]
}

export function createBuiltinNed2DefinitionV5(): RobotDefinitionV5 {
  const source = manifest.definition
  return validateRobotDefinitionShapeV5({
    id: source.id,
    name: source.name,
    identification: {
      manufacturer: 'Niryo',
      model: 'NED2',
      productCode: 'NED2',
      serialNumberTemplate: 'NED2-{serial}',
      motionDeviceCategory: 'ARTICULATED_ROBOT',
    },
    mechanics: {
      schemaVersion: 1,
      status: 'confirmed',
      sourceKind: 'manifest',
      sourceName: 'public/models/robot/ned2/manifest.json',
      calibrationRevision: 'builtin-niryo-ned2-v1',
    },
    assetReferenceIds: structuredClone(source.assetReferenceIds),
    sourceConventions: structuredClone(source.sourceConventions),
    links: structuredClone(source.links),
    joints: structuredClone(source.joints),
    frames: structuredClone(source.frames),
    excludedGeometryOccurrenceKeys: structuredClone(source.excludedGeometryOccurrenceKeys),
  })
}
