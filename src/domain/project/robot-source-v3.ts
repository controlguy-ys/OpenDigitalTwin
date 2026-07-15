import type { SerializableTransform } from '../equipment/equipment'
import type { RobotLinkId } from '../robot/crb15000'
import type {
  GeometryStatistics,
  ProjectCollisionBoxV2,
} from './project'

export interface ProjectRigidTransformV3 {
  readonly position: readonly [number, number, number]
  readonly quaternion: readonly [number, number, number, number]
  readonly scale: readonly [1, 1, 1]
}

export interface RobotStepSourceAssetV3 {
  readonly id: string
  readonly sha256: string
  readonly sourceFileName: string
  readonly sourceBytes: ArrayBuffer
  readonly detectedUnit: 'meter' | 'millimeter' | 'inch' | 'unknown'
  readonly selectedSourceUnit: 'meter' | 'millimeter' | 'inch'
  readonly unitDecision: 'detected' | 'operator-confirmed' | 'legacy-detected'
  readonly sourceToMeters: number
  readonly parserVersion: string
  readonly statistics: GeometryStatistics
}

export interface RobotAssemblyPartRefV3 {
  readonly sourceAssetId: string
  readonly nodePath: readonly number[]
  readonly nodeName: string
  readonly meshIndices: readonly number[]
}

export interface RobotLinkGeometryRecordV3 {
  readonly linkId: RobotLinkId
  readonly sourceRefs: readonly RobotAssemblyPartRefV3[]
  readonly coordinateMode: 'assembly-zero-pose' | 'link-local'
  readonly zeroPoseLocalization: SerializableTransform
  readonly operatorAdjustment: SerializableTransform
  readonly collisionBoxes: readonly ProjectCollisionBoxV2[]
  readonly statistics: GeometryStatistics
}

export interface FixedSixAxisJointManifestV1 {
  readonly id: 'J1' | 'J2' | 'J3' | 'J4' | 'J5' | 'J6'
  readonly parentLink: RobotLinkId
  readonly childLink: RobotLinkId
  readonly originM: readonly [number, number, number]
  readonly axis: readonly [number, number, number]
  readonly minDeg: number
  readonly maxDeg: number
  readonly homeDeg: number
  readonly zeroOffsetDeg: number
  readonly direction: 1 | -1
  readonly maxVelocityDegPerSec: number
}

export type ProjectRobotJointV3 = FixedSixAxisJointManifestV1

export interface FixedSixAxisRobotManifestV1 {
  readonly schemaVersion: 1
  readonly name: string
  readonly joints: readonly FixedSixAxisJointManifestV1[]
  readonly flange: ProjectRigidTransformV3
  readonly tool0: ProjectRigidTransformV3
  readonly tcp: ProjectRigidTransformV3
}

export interface FixedSixAxisRobotMechanicsV3 {
  readonly joints: readonly [
    ProjectRobotJointV3,
    ProjectRobotJointV3,
    ProjectRobotJointV3,
    ProjectRobotJointV3,
    ProjectRobotJointV3,
    ProjectRobotJointV3,
  ]
  readonly flange: ProjectRigidTransformV3
  readonly tool0: ProjectRigidTransformV3
}

export type RobotMechanicsProvenanceV3 =
  | {
      readonly kind: 'datasheet'
      readonly configurationId: string
      readonly configurationRevision: string
    }
  | {
      readonly kind: 'manifest'
      readonly sourceFileName: string
      readonly sourceSha256: string
    }
  | {
      readonly kind: 'manual'
      readonly canonicalSha256: string
    }
