import { CYLINDER_RADIAL_SEGMENTS_V4 } from './limits.js'
import type { QuaternionV4, RigidTransformV4, Vector3V4 } from './rigid-transform.js'

export type ProjectIdV4 = string
export type RevisionIdV4 = string
export type AssetReferenceIdV4 = string
export type FrameIdV4 = string
export type RobotDefinitionIdV4 = string
export type RobotLinkIdV4 = string
export type RobotJointIdV4 = string
export type RobotIdV4 = string
export type SpatialEntityIdV4 = string
export type SceneGroupIdV4 = string
export type RobotJobIdV4 = string
export type RobotActionIdV4 = string
export type OpcUaEndpointIdV4 = string
export type OpcUaMappingIdV4 = string
export type OpcUaActionBindingIdV4 = string

export interface ProjectMetadataV4 {
  readonly name: string
  readonly createdAt: string
  readonly updatedAt: string
}

export interface AssetReferenceV4 {
  readonly id: AssetReferenceIdV4
  readonly uri: `asset://${string}/${string}` | `builtin://${string}/${string}@${string}`
  readonly sha256: string
  readonly byteLength: number
  readonly sourceFileName: string
  readonly mediaType: 'model/step'
}

export type SourceOrientationV4 =
  | { readonly mode: 'up-axis'; readonly upAxis: 'x' | 'y' | 'z' }
  | { readonly mode: 'root-rotation'; readonly quaternion: QuaternionV4 }

export interface SourceConventionV4 {
  readonly linearUnit: 'millimeter' | 'centimeter' | 'meter' | 'inch' | 'foot'
  readonly sourceToMeters: number
  readonly orientation: SourceOrientationV4
}

export interface GeometryStatisticsV4 {
  readonly vertices: number
  readonly triangles: number
  readonly meshes: number
  readonly materials: number
}

export interface CollisionBoxV4 {
  readonly id: string
  readonly centerM: Vector3V4
  readonly halfExtentsM: Vector3V4
  readonly quaternion: QuaternionV4
}

export type FrameRoleV4 =
  | 'world'
  | 'mcp'
  | 'base'
  | 'flange'
  | 'tool0'
  | 'tool'
  | 'tcp'
  | 'gripper'
  | 'grasp'
  | 'placement'
  | 'custom'

export interface FrameDefinitionV4 {
  readonly id: FrameIdV4
  readonly name: string
  readonly parentFrameId: FrameIdV4 | RobotLinkIdV4 | null
  readonly localPose: RigidTransformV4
  readonly role: FrameRoleV4
}

export interface ProjectSceneV4 {
  readonly frames: readonly FrameDefinitionV4[]
}

export interface RobotGeometryOccurrenceV4 {
  readonly occurrenceKey: string
  readonly assetReferenceId: AssetReferenceIdV4
  readonly linkLocalPose: RigidTransformV4
  readonly statistics: GeometryStatisticsV4
  readonly collisionBoxes: readonly CollisionBoxV4[]
}

export interface RobotLinkDefinitionV4 {
  readonly id: RobotLinkIdV4
  readonly name: string
  readonly geometryOccurrences: readonly RobotGeometryOccurrenceV4[]
}

export interface RobotJointDefinitionV4 {
  readonly id: RobotJointIdV4
  readonly type: 'revolute' | 'prismatic'
  readonly parentLinkId: RobotLinkIdV4
  readonly childLinkId: RobotLinkIdV4
  readonly origin: RigidTransformV4
  readonly axis: Vector3V4
  readonly min: number
  readonly max: number
  readonly home: number
  readonly zeroOffset: number
  readonly direction: 1 | -1
  readonly maximumVelocity: number
}

export interface RobotDefinitionV4 {
  readonly id: RobotDefinitionIdV4
  readonly name: string
  readonly manufacturer: string
  readonly model: string
  readonly assetReferenceIds: readonly AssetReferenceIdV4[]
  readonly sourceConventions: Readonly<Record<AssetReferenceIdV4, SourceConventionV4>>
  readonly links: readonly RobotLinkDefinitionV4[]
  readonly joints: readonly RobotJointDefinitionV4[]
  readonly frames: readonly FrameDefinitionV4[]
  readonly excludedGeometryOccurrenceKeys: readonly string[]
}

export type RobotJointSourceV4 = 'simulation' | 'manual' | `opcua:${OpcUaEndpointIdV4}`

export interface StatusOverlayV4 {
  readonly visible: boolean
  readonly frameId: FrameIdV4 | null
}

export interface NumericStatusV4 {
  readonly value: number
  readonly sourceOwnership: 'manual' | 'simulation' | `opcua:${OpcUaEndpointIdV4}`
  readonly overlay: StatusOverlayV4
}

export interface RobotInstanceV4 {
  readonly id: RobotIdV4
  readonly name: string
  readonly definitionId: RobotDefinitionIdV4
  readonly visible: boolean
  readonly baseParentFrameId: FrameIdV4
  readonly localBasePose: RigidTransformV4
  readonly initialJointValues: Readonly<Record<RobotJointIdV4, number>>
  readonly jointSource: RobotJointSourceV4
  readonly selectedToolFrameId: FrameIdV4
  readonly selectedTcpFrameId: FrameIdV4
  readonly numericStatus: NumericStatusV4
  readonly intentionalMountEntityId: SpatialEntityIdV4 | null
}

export type AssetGeometryV4 = {
  readonly kind: 'asset'
  readonly assetReferenceId: AssetReferenceIdV4
  readonly occurrenceKey: string
  readonly sourceConvention: SourceConventionV4
  readonly originMode: 'source' | 'center'
  readonly statistics: GeometryStatisticsV4
  readonly collisionBoxes: readonly CollisionBoxV4[]
}

export type BoxPrimitiveV4 = {
  readonly kind: 'box'
  readonly dimensionsM: Vector3V4
  readonly color: `#${string}`
}

export type CylinderPrimitiveV4 = {
  readonly kind: 'cylinder'
  readonly radiusM: number
  readonly heightM: number
  readonly axis: 'z'
  readonly radialSegments: typeof CYLINDER_RADIAL_SEGMENTS_V4
  readonly color: `#${string}`
}

export type SpatialGeometryV4 = AssetGeometryV4 | BoxPrimitiveV4 | CylinderPrimitiveV4

export interface ObjectGraspFrameV4 {
  readonly frameId: FrameIdV4
  readonly name: string
  readonly localPose: RigidTransformV4
}

export interface MovingFrameV4 {
  readonly frameId: FrameIdV4
  readonly name: string
  readonly parentFrameId: FrameIdV4
  readonly localPose: RigidTransformV4
  readonly sourceOwnership: 'manual' | 'simulation' | `opcua:${OpcUaEndpointIdV4}` | 'attachment'
}

export interface SpatialEntityV4 {
  readonly id: SpatialEntityIdV4
  readonly name: string
  readonly geometry: SpatialGeometryV4
  readonly parentFrameId: FrameIdV4
  readonly localPose: RigidTransformV4
  readonly visible: boolean
  readonly groupId: SceneGroupIdV4 | null
  readonly removable: boolean
  readonly transformOwner: 'manual' | 'simulation' | `opcua:${OpcUaEndpointIdV4}` | 'attachment'
  readonly numericStatus: NumericStatusV4
  readonly graspable: boolean
  readonly graspFrames: readonly ObjectGraspFrameV4[]
  readonly movingFrames: readonly MovingFrameV4[]
}

export interface SceneGroupV4 {
  readonly id: SceneGroupIdV4
  readonly name: string
  readonly parentGroupId: SceneGroupIdV4 | null
  readonly visible: boolean
}

export type RobotJobStepV4 =
  | {
      readonly kind: 'joint-pose'
      readonly jointValues: Readonly<Record<RobotJointIdV4, number>>
      readonly speedPercentToNext: number
    }
  | { readonly kind: 'action-reference'; readonly actionId: RobotActionIdV4 }

export interface RobotJobV4 {
  readonly id: RobotJobIdV4
  readonly name: string
  readonly robotId: RobotIdV4
  readonly steps: readonly RobotJobStepV4[]
}

export type RobotActionDefinitionV4 =
  | {
      readonly id: RobotActionIdV4
      readonly kind: 'set-gripper-state'
      readonly robotId: RobotIdV4
      readonly state: 'OPEN' | 'CLOSED'
    }
  | {
      readonly id: RobotActionIdV4
      readonly kind: 'attach-object'
      readonly robotId: RobotIdV4
      readonly toolFrameId: FrameIdV4
      readonly objectId: SpatialEntityIdV4
      readonly objectGraspFrameId?: FrameIdV4
      readonly maximumDistanceM: number
    }
  | {
      readonly id: RobotActionIdV4
      readonly kind: 'detach-object'
      readonly objectId: SpatialEntityIdV4
      readonly targetParentFrameId?: FrameIdV4
    }

export type OpcUaModeV4 = 'off' | 'client' | 'server' | 'bridge'

export interface OpcUaEndpointV4 {
  readonly endpointId: OpcUaEndpointIdV4
  readonly name: string
  readonly endpointUrl: string
  readonly enabled: boolean
  readonly publishingIntervalMs: number
  readonly reconnectDelayMs: number
}

export type OpcUaMappingDirectionV4 = 'read' | 'write' | 'readWrite' | 'publish' | 'action-trigger'
export type OpcUaDataTypeV4 =
  | 'Boolean'
  | 'SByte'
  | 'Byte'
  | 'Int16'
  | 'UInt16'
  | 'Int32'
  | 'UInt32'
  | 'Float'
  | 'Double'
  | 'String'
export type ProjectScalarDataTypeV4 = 'boolean' | 'integer' | 'number' | 'string'
export type OpcUaInterpolationModeV4 =
  | 'none'
  | 'linear'
  | 'shortest-quaternion'
  | 'revolute-wrapped'

export type OpcUaProjectTargetV4 =
  | { readonly type: 'robot-joint'; readonly robotId: RobotIdV4; readonly jointId: RobotJointIdV4 }
  | { readonly type: 'robot-frame'; readonly robotId: RobotIdV4; readonly frameId: FrameIdV4 }
  | { readonly type: 'robot-status'; readonly robotId: RobotIdV4 }
  | { readonly type: 'entity-frame'; readonly entityId: SpatialEntityIdV4; readonly frameId: FrameIdV4 }
  | { readonly type: 'entity-status'; readonly entityId: SpatialEntityIdV4 }

export interface OpcUaMappingLeafV4 {
  readonly leafPath: readonly (string | number)[]
  readonly nodeId: string
  readonly projectTarget: OpcUaProjectTargetV4
  readonly opcUaDataType: OpcUaDataTypeV4
  readonly projectDataType: ProjectScalarDataTypeV4
  readonly scale: number
  readonly offset: number
  readonly unit: string
  readonly required: boolean
}

export interface OpcUaMappingV4 {
  readonly id: OpcUaMappingIdV4
  readonly endpointId: OpcUaEndpointIdV4
  readonly direction: OpcUaMappingDirectionV4
  readonly publishingIntervalMs?: number
  readonly coherenceGroupId: string | null
  readonly sourceOwnership: 'manual' | 'simulation' | `opcua:${OpcUaEndpointIdV4}` | 'attachment'
  readonly interpolationMode: OpcUaInterpolationModeV4
  readonly coordinateConvention: 'project-v4-z-up-metres-quaternion-xyzw'
  readonly leaves: readonly OpcUaMappingLeafV4[]
}

export type OpcUaActionBindingV4 =
  | {
      readonly id: OpcUaActionBindingIdV4
      readonly endpointId: OpcUaEndpointIdV4
      readonly nodeId: string
      readonly kind: 'action-execute' | 'job-start'
      readonly actionId: RobotActionIdV4 | RobotJobIdV4
      readonly triggerMode: 'boolean-rising-edge'
      readonly integerCommandValue: null
    }
  | {
      readonly id: OpcUaActionBindingIdV4
      readonly endpointId: OpcUaEndpointIdV4
      readonly nodeId: string
      readonly kind: 'action-execute' | 'job-start'
      readonly actionId: RobotActionIdV4 | RobotJobIdV4
      readonly triggerMode: 'integer-command-value'
      readonly integerCommandValue: number
    }

export interface BridgeRouteV4 {
  readonly id: string
  readonly sourceChannelId: string
  readonly destinationChannelId: string
  readonly direction: 'forward'
  readonly scale: number
  readonly offset: number
  readonly unit: string
  readonly sourceOwnership: 'client' | 'server'
}

export interface OpcUaProjectConfigurationV4 {
  readonly mode: OpcUaModeV4
  readonly endpoints: readonly OpcUaEndpointV4[]
  readonly mappings: readonly OpcUaMappingV4[]
  readonly actionBindings: readonly OpcUaActionBindingV4[]
  readonly bridgeRoutes: readonly BridgeRouteV4[]
}

export interface WorkcellProjectV4 {
  readonly schemaVersion: 4
  readonly projectId: ProjectIdV4
  readonly revisionId: RevisionIdV4
  readonly metadata: ProjectMetadataV4
  readonly assetReferences: readonly AssetReferenceV4[]
  readonly scene: ProjectSceneV4
  readonly robotDefinitions: readonly RobotDefinitionV4[]
  readonly robots: readonly RobotInstanceV4[]
  readonly spatialEntities: readonly SpatialEntityV4[]
  readonly sceneGroups: readonly SceneGroupV4[]
  readonly jobs: readonly RobotJobV4[]
  readonly actions: readonly RobotActionDefinitionV4[]
  readonly opcUa: OpcUaProjectConfigurationV4
}
