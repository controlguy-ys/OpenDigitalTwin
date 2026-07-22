import type { RigidTransformV5 } from '../project-v5/rigid-transform.js'
import type { RobotDefinitionV5, RobotMechanicsMetadataV1 } from '../project-v5/types.js'
import type { RobotMechanicsDraftV1 } from './robot-mechanics-draft.js'

export type RobotDefinitionEnvelopeV1 = Pick<
  RobotDefinitionV5,
  | 'id'
  | 'name'
  | 'identification'
  | 'assetReferenceIds'
  | 'sourceConventions'
  | 'excludedGeometryOccurrenceKeys'
>

export type RobotGeometryAlignmentV1 =
  | { readonly kind: 'link-local' }
  | {
      readonly kind: 'assembled-home'
      readonly occurrenceWorldPoses: Readonly<Record<string, RigidTransformV5>>
    }

export interface RobotMechanicsImportCandidateV1 {
  readonly schemaVersion: 1
  readonly definition: RobotDefinitionEnvelopeV1
  readonly mechanics: RobotMechanicsMetadataV1
  readonly draft: RobotMechanicsDraftV1
  readonly geometryAlignment: RobotGeometryAlignmentV1
}
