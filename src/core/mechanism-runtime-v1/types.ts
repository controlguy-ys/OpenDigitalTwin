import type { RigidTransformV5, Vector3V5 } from '../project-v5/rigid-transform.js'

export type RigidTransformV1 = RigidTransformV5
export type Vector3V1 = Vector3V5

/** Canonical mechanism spatial coordinates are right-handed, Z-up, and expressed in metres. */

export type MechanismBodyIdV1 = string
export type MechanismJointIdV1 = string
export type MechanismFrameIdV1 = string
export type MechanismMotionGroupIdV1 = string

export interface MechanismBodyV1 {
  readonly bodyId: MechanismBodyIdV1
  readonly name: string
}

export type MechanismJointV1 =
  | {
      readonly jointId: MechanismJointIdV1
      readonly jointType: 'fixed'
      readonly parentBodyId: MechanismBodyIdV1
      readonly childBodyId: MechanismBodyIdV1
      readonly origin: RigidTransformV1
    }
  | {
      readonly jointId: MechanismJointIdV1
      readonly jointType: 'revolute' | 'prismatic'
      readonly parentBodyId: MechanismBodyIdV1
      readonly childBodyId: MechanismBodyIdV1
      readonly origin: RigidTransformV1
      /** A unit direction vector in the canonical right-handed, Z-up mechanism coordinates. */
      readonly axis: Vector3V1
      /** Bounds, home, and zero offset use radians for revolute Joints and metres for prismatic Joints. */
      readonly minimum: number
      readonly maximum: number
      readonly home: number
      readonly zeroOffset: number
      readonly direction: 1 | -1
      /** Maximum velocity uses radians per second for revolute Joints and metres per second for prismatic Joints. */
      readonly maximumVelocity: number
    }

export type MechanismFrameParentV1 =
  | { readonly type: 'body'; readonly bodyId: MechanismBodyIdV1 }
  | { readonly type: 'frame'; readonly frameId: MechanismFrameIdV1 }

export interface MechanismFrameV1 {
  readonly frameId: MechanismFrameIdV1
  readonly name: string
  readonly role:
    | 'world' | 'mcp' | 'mount' | 'base' | 'flange' | 'tool0' | 'tool'
    | 'tcp' | 'gripper' | 'grasp' | 'placement' | 'work' | 'sensor' | 'custom'
  readonly parent: MechanismFrameParentV1
  readonly localPose: RigidTransformV1
}

export interface MechanismMotionGroupV1 {
  readonly motionGroupId: MechanismMotionGroupIdV1
  readonly name: string
  readonly coordinateJointIds: readonly MechanismJointIdV1[]
  readonly endFrameIds: readonly MechanismFrameIdV1[]
}

export type CanonicalJsonValueV1 =
  | null | boolean | number | string | readonly CanonicalJsonValueV1[] | CanonicalJsonObjectV1

export interface CanonicalJsonObjectV1 {
  readonly [key: string]: CanonicalJsonValueV1
}

export interface MechanismSolverReferenceV1 {
  readonly solverKey: string
  readonly contractVersion: string
  readonly parameters: CanonicalJsonObjectV1
  readonly normalizedParametersHash: string
}

export interface MechanismDefinitionV1 {
  readonly mechanismId: string
  readonly name: string
  readonly topologyKind: 'tree' | 'free-body' | 'parallel'
  readonly solverRef: MechanismSolverReferenceV1
  readonly bodies: readonly MechanismBodyV1[]
  readonly joints: readonly MechanismJointV1[]
  readonly frames: readonly MechanismFrameV1[]
  readonly motionGroups: readonly MechanismMotionGroupV1[]
  readonly constraints: readonly MechanismLoopClosureConstraintV1[]
  readonly geometryBindings: readonly MechanismGeometryBindingV1[]
  readonly sourceProvenance: MechanismSourceProvenanceV1
}

export interface MechanismLoopClosureConstraintV1 {
  readonly constraintId: string
  readonly constraintType: 'loop-closure'
  readonly parentFrameId: MechanismFrameIdV1
  readonly childFrameId: MechanismFrameIdV1
  readonly targetPose: RigidTransformV1
}

export interface MechanismGeometryBindingV1 {
  readonly geometryBindingId: string
  readonly bodyId: MechanismBodyIdV1
  readonly assetReferenceId: string
  readonly occurrenceKey: string
  readonly bodyLocalPose: RigidTransformV1
}

export interface MechanismSourceProvenanceV1 {
  readonly sourceKind: 'project-v5-robot' | 'mechanism-manifest' | 'urdf' | 'manual' | 'fixture'
  readonly sourceDetail: string
  readonly sourceName: string
  readonly sourceRevision: string
  readonly adapterKey: string | null
  readonly adapterVersion: string | null
}

export interface TwinEntityAssetBindingV1 {
  readonly assetBindingId: string
  readonly assetReferenceId: string
  readonly mechanismGeometryBindingId: string | null
}

export interface TwinEntityDefinitionV1 {
  readonly entityId: string
  readonly displayName: string
  readonly manufacturer: string
  readonly model: string
  readonly definitionRevision: string
  readonly assetBindings: readonly TwinEntityAssetBindingV1[]
  readonly mechanismDefinitionId: string | null
  readonly capabilityIds: readonly string[]
}

export interface MechanismRuntimeInstanceV1 {
  readonly instanceId: string
  readonly definitionId: string
  readonly parentFrameId: string
  readonly localPose: RigidTransformV1
  readonly activeToolFrameId: MechanismFrameIdV1 | null
  readonly activeTcpFrameId: MechanismFrameIdV1 | null
  readonly visible: boolean
  readonly declaredValueOwners: {
    readonly coordinates: 'manual' | 'simulation' | `opcua:${string}`
    readonly frames: Readonly<Record<string, 'manual' | 'simulation' | `opcua:${string}`>>
  }
}

export interface RobotHomeCoordinateSetV1 {
  readonly coordinateSetId: string
  readonly name: string
  readonly coordinatesByStableId: Readonly<Record<string, number>>
}

export interface RobotCapabilityV1 {
  readonly robotCapabilityId: string
  readonly mechanismId: string
  readonly motionGroupIds: readonly MechanismMotionGroupIdV1[]
  readonly baseFrameId: MechanismFrameIdV1 | null
  readonly flangeFrameIds: readonly MechanismFrameIdV1[]
  readonly toolFrameIds: readonly MechanismFrameIdV1[]
  readonly tcpFrameIds: readonly MechanismFrameIdV1[]
  readonly homeCoordinateSets: readonly RobotHomeCoordinateSetV1[]
  readonly robotStatusSemantics: {
    readonly numericStatusSupported: boolean
    readonly motionStateSupported: boolean
    readonly safetyStateSupported: boolean
  }
  readonly roboticsOpcUaView: {
    readonly axisJointIds: readonly MechanismJointIdV1[]
    readonly baseFrameId: MechanismFrameIdV1 | null
    readonly flangeFrameIds: readonly MechanismFrameIdV1[]
    readonly toolFrameIds: readonly MechanismFrameIdV1[]
    readonly tcpFrameIds: readonly MechanismFrameIdV1[]
  }
}

export interface ForwardKinematicsRequestV1 {
  readonly mechanismDefinition: MechanismDefinitionV1
  readonly rootWorldPose: RigidTransformV1
  readonly coordinatesByStableId: Readonly<Record<string, number>>
  readonly requestedFrameIds?: readonly string[]
  readonly requestedMotionGroupId?: string
}

export interface ForwardKinematicsResultV1 {
  readonly solverKey: string
  readonly solverContractVersion: string
  readonly normalizedCoordinates: Readonly<Record<string, number>>
  readonly bodyLocalPoses: Readonly<Record<string, RigidTransformV1>>
  readonly bodyWorldPoses: Readonly<Record<string, RigidTransformV1>>
  readonly frameWorldPoses: Readonly<Record<string, RigidTransformV1>>
  readonly motionGroupEndFramePoses: Readonly<Record<string, Readonly<Record<string, RigidTransformV1>>>>
  readonly warnings: readonly KinematicsWarningV1[]
}

export interface ValidationFindingV1 {
  readonly code: string
  readonly path: string
  readonly message: string
  readonly recovery?: string
}

export interface KinematicsWarningV1 {
  readonly code: string
  readonly path: string
  readonly message: string
}

export interface ValidationReportV1 {
  readonly valid: boolean
  readonly errors: readonly ValidationFindingV1[]
  readonly warnings: readonly ValidationFindingV1[]
}

export interface SolverCapabilitiesV1 {
  readonly topologyKinds: readonly ('tree' | 'free-body' | 'parallel')[]
  readonly jointTypes: readonly ('fixed' | 'revolute' | 'prismatic')[]
  readonly deterministicForward: true
  readonly inverse: boolean
  readonly jacobian: boolean
  readonly constraintProjection: boolean
}

export interface SolverDescriptorV1 {
  readonly solverKey: string
  readonly contractVersion: string
  readonly capabilities: SolverCapabilitiesV1
}

export interface InverseKinematicsRequestV1 {
  readonly mechanismDefinition: MechanismDefinitionV1
  readonly rootWorldPose: RigidTransformV1
  readonly seedCoordinatesByStableId: Readonly<Record<string, number>>
  readonly targetFrameId: MechanismFrameIdV1
  readonly targetWorldPose: RigidTransformV1
}

export interface InverseKinematicsResultV1 {
  readonly coordinatesByStableId: Readonly<Record<string, number>>
  readonly warnings: readonly KinematicsWarningV1[]
}

export interface JacobianRequestV1 {
  readonly mechanismDefinition: MechanismDefinitionV1
  readonly coordinatesByStableId: Readonly<Record<string, number>>
  readonly frameId: MechanismFrameIdV1
}

export interface JacobianResultV1 {
  readonly rows: readonly (readonly number[])[]
  readonly coordinateJointIds: readonly MechanismJointIdV1[]
}

export interface ConstraintProjectionRequestV1 {
  readonly mechanismDefinition: MechanismDefinitionV1
  readonly coordinatesByStableId: Readonly<Record<string, number>>
}

export interface ConstraintProjectionResultV1 {
  readonly coordinatesByStableId: Readonly<Record<string, number>>
  readonly warnings: readonly KinematicsWarningV1[]
}

export interface KinematicsSolverV1 {
  readonly solverKey: string
  readonly contractVersion: string
  describeCapabilities(): SolverCapabilitiesV1
  validateDefinition(definition: MechanismDefinitionV1): ValidationReportV1
  normalizeCoordinates(
    definition: MechanismDefinitionV1,
    coordinates: Readonly<Record<string, number>>,
  ): Readonly<Record<string, number>>
  evaluateForward(request: ForwardKinematicsRequestV1): ForwardKinematicsResultV1
  solveInverse?(request: InverseKinematicsRequestV1): InverseKinematicsResultV1
  evaluateJacobian?(request: JacobianRequestV1): JacobianResultV1
  projectConstraints?(request: ConstraintProjectionRequestV1): ConstraintProjectionResultV1
}
