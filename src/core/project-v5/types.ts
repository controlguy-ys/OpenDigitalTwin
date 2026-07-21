import { CYLINDER_RADIAL_SEGMENTS_V5 } from './limits.js'
import type { OpcUaNodeAddressV1 } from './opcua-node-address.js'
import type { QuaternionV5, RigidTransformV5, Vector3V5 } from './rigid-transform.js'

export type ProjectIdV5 = string
export type RevisionIdV5 = string
export type AssetReferenceIdV5 = string
export type FrameIdV5 = string
export type RobotDefinitionIdV5 = string
export type RobotLinkIdV5 = string
export type RobotJointIdV5 = string
export type RobotControllerIdV5 = string
export type RobotIdV5 = string
export type SpatialEntityIdV5 = string
export type SceneGroupIdV5 = string
export type LogicalSignalIdV1 = string
export type RobotJobIdV5 = string
export type RobotJobInstructionIdV1 = string
export type OpcUaEndpointIdV5 = string
export type OpcUaMappingIdV5 = string
export type OpcUaBridgeRouteIdV5 = string

export interface ProjectMetadataV5 {
  readonly name: string
  readonly createdAt: string
  readonly updatedAt: string
}

export interface AssetReferenceV5 {
  readonly id: AssetReferenceIdV5
  readonly uri: `asset://${string}/${string}` | `builtin://${string}/${string}@${string}`
  readonly sha256: string
  readonly byteLength: number
  readonly sourceFileName: string
  readonly mediaType: 'model/step'
}

export type SourceOrientationV5 =
  | { readonly mode: 'up-axis'; readonly upAxis: 'x' | 'y' | 'z' }
  | { readonly mode: 'root-rotation'; readonly quaternion: QuaternionV5 }

export interface SourceConventionV5 {
  readonly linearUnit: 'millimeter' | 'centimeter' | 'meter' | 'inch' | 'foot'
  readonly sourceToMeters: number
  readonly orientation: SourceOrientationV5
}

export interface GeometryStatisticsV5 {
  readonly vertices: number
  readonly triangles: number
  readonly meshes: number
  readonly materials: number
}

export interface CollisionBoxV5 {
  readonly id: string
  readonly centerM: Vector3V5
  readonly halfExtentsM: Vector3V5
  readonly quaternion: QuaternionV5
}

export type FrameRoleV5 =
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

export interface FrameDefinitionV5 {
  readonly id: FrameIdV5
  readonly name: string
  readonly parentFrameId: FrameIdV5 | RobotLinkIdV5 | null
  readonly localPose: RigidTransformV5
  readonly role: FrameRoleV5
}

export interface ProjectSceneV5 {
  readonly frames: readonly FrameDefinitionV5[]
}

export interface RobotGeometryOccurrenceV5 {
  readonly occurrenceKey: string
  readonly assetReferenceId: AssetReferenceIdV5
  readonly linkLocalPose: RigidTransformV5
  readonly statistics: GeometryStatisticsV5
  readonly collisionBoxes: readonly CollisionBoxV5[]
}

export interface RobotLinkDefinitionV5 {
  readonly id: RobotLinkIdV5
  readonly name: string
  readonly geometryOccurrences: readonly RobotGeometryOccurrenceV5[]
}

export interface RobotJointDefinitionV5 {
  readonly id: RobotJointIdV5
  readonly type: 'revolute' | 'prismatic'
  readonly parentLinkId: RobotLinkIdV5
  readonly childLinkId: RobotLinkIdV5
  readonly origin: RigidTransformV5
  readonly axis: Vector3V5
  readonly min: number
  readonly max: number
  readonly home: number
  readonly zeroOffset: number
  readonly direction: 1 | -1
  readonly maximumVelocity: number
}

export interface RobotIdentificationV1 {
  readonly manufacturer: string
  readonly model: string
  readonly productCode: string
  readonly serialNumberTemplate: string | null
  readonly motionDeviceCategory: 'ARTICULATED_ROBOT' | 'SCARA_ROBOT' | 'DELTA_ROBOT' | 'OTHER'
}

export interface RobotDefinitionV5 {
  readonly id: RobotDefinitionIdV5
  readonly name: string
  readonly identification: RobotIdentificationV1
  readonly assetReferenceIds: readonly AssetReferenceIdV5[]
  readonly sourceConventions: Readonly<Record<AssetReferenceIdV5, SourceConventionV5>>
  readonly links: readonly RobotLinkDefinitionV5[]
  readonly joints: readonly RobotJointDefinitionV5[]
  readonly frames: readonly FrameDefinitionV5[]
  readonly excludedGeometryOccurrenceKeys: readonly string[]
}

export interface RobotControllerIdentificationV1 {
  readonly manufacturer: string
  readonly model: string
  readonly productCode: string
  readonly serialNumber: string
}

export interface RobotControllerV5 {
  readonly id: RobotControllerIdV5
  readonly name: string
  readonly identification: RobotControllerIdentificationV1
}

export type RobotJointSourceV5 = 'simulation' | 'manual' | `opcua:${string}`

export interface StatusOverlayV5 {
  readonly visible: boolean
  readonly frameId: FrameIdV5 | null
}

export interface NumericStatusV5 {
  readonly value: number
  readonly sourceOwnership: 'manual' | 'simulation' | `opcua:${string}`
  readonly overlay: StatusOverlayV5
}

export interface RobotInstanceV5 {
  readonly id: RobotIdV5
  readonly name: string
  readonly definitionId: RobotDefinitionIdV5
  readonly serialNumber: string
  readonly controllerId: RobotControllerIdV5
  readonly visible: boolean
  readonly baseParentFrameId: FrameIdV5
  readonly localBasePose: RigidTransformV5
  readonly initialJointValues: Readonly<Record<RobotJointIdV5, number>>
  readonly jointSource: RobotJointSourceV5
  readonly frameSources: Readonly<Record<FrameIdV5, RobotJointSourceV5>>
  readonly selectedToolFrameId: FrameIdV5
  readonly selectedTcpFrameId: FrameIdV5
  readonly numericStatus: NumericStatusV5
  readonly intentionalMountEntityId: SpatialEntityIdV5 | null
}

export type AssetGeometryV5 = {
  readonly kind: 'asset'
  readonly assetReferenceId: AssetReferenceIdV5
  readonly occurrenceKey: string
  readonly sourceConvention: SourceConventionV5
  readonly originMode: 'source' | 'center'
  readonly statistics: GeometryStatisticsV5
  readonly collisionBoxes: readonly CollisionBoxV5[]
}

export type BoxPrimitiveV5 = {
  readonly kind: 'box'
  readonly dimensionsM: Vector3V5
  readonly color: `#${string}`
}

export type CylinderPrimitiveV5 = {
  readonly kind: 'cylinder'
  readonly radiusM: number
  readonly heightM: number
  readonly axis: 'z'
  readonly radialSegments: typeof CYLINDER_RADIAL_SEGMENTS_V5
  readonly color: `#${string}`
}

export type SpatialGeometryV5 = AssetGeometryV5 | BoxPrimitiveV5 | CylinderPrimitiveV5

export interface ObjectGraspFrameV5 {
  readonly frameId: FrameIdV5
  readonly name: string
  readonly localPose: RigidTransformV5
}

export interface MovingFrameV5 {
  readonly frameId: FrameIdV5
  readonly name: string
  readonly parentFrameId: FrameIdV5
  readonly localPose: RigidTransformV5
  readonly sourceOwnership: 'manual' | 'simulation' | `opcua:${string}` | 'attachment'
}

export interface SpatialEntityV5 {
  readonly id: SpatialEntityIdV5
  readonly name: string
  readonly geometry: SpatialGeometryV5
  readonly parentFrameId: FrameIdV5
  readonly localPose: RigidTransformV5
  readonly visible: boolean
  readonly groupId: SceneGroupIdV5 | null
  readonly removable: boolean
  readonly transformOwner: 'manual' | 'simulation' | `opcua:${string}` | 'attachment'
  readonly numericStatus: NumericStatusV5
  readonly graspable: boolean
  readonly graspFrames: readonly ObjectGraspFrameV5[]
  readonly movingFrames: readonly MovingFrameV5[]
}

export interface SceneGroupV5 {
  readonly id: SceneGroupIdV5
  readonly name: string
  readonly parentGroupId: SceneGroupIdV5 | null
  readonly visible: boolean
}

export type LogicalSignalDataTypeV1 = 'Boolean' | 'Int32' | 'UInt32' | 'Double' | 'String'
export type LogicalSignalDirectionV1 = 'input' | 'output' | 'bidirectional' | 'internal'
export type LogicalSignalValueV1 = boolean | number | string

export interface LogicalSignalV1 {
  readonly id: LogicalSignalIdV1
  readonly name: string
  readonly dataType: LogicalSignalDataTypeV1
  readonly direction: LogicalSignalDirectionV1
  readonly initialValue: LogicalSignalValueV1
  readonly unit: string
  readonly scope: { readonly type: 'project' }
    | { readonly type: 'robot' | 'entity'; readonly id: string }
}

export type RobotJobInstructionV1 =
  | {
      readonly id: RobotJobInstructionIdV1
      readonly kind: 'move-joint'
      readonly jointValues: Readonly<Record<string, number>>
      readonly speedPercentToNext: number
    }
  | { readonly id: RobotJobInstructionIdV1; readonly kind: 'set-do'; readonly signalId: string; readonly value: boolean }
  | { readonly id: RobotJobInstructionIdV1; readonly kind: 'wait-di'; readonly signalId: string; readonly expected: boolean; readonly timeoutMs: number }
  | { readonly id: RobotJobInstructionIdV1; readonly kind: 'delay'; readonly durationMs: number }
  | {
      readonly id: RobotJobInstructionIdV1
      readonly kind: 'attach'
      readonly objectId: string
      readonly toolFrameId: string
      readonly objectGraspFrameId: string | null
      readonly maximumDistanceM: number
    }
  | {
      readonly id: RobotJobInstructionIdV1
      readonly kind: 'detach'
      readonly objectId: string
      readonly targetParentFrameId: string | null
    }

export interface RobotJobV5 {
  readonly id: RobotJobIdV5
  readonly name: string
  readonly robotId: RobotIdV5
  readonly instructions: readonly RobotJobInstructionV1[]
}

export interface OpcUaEndpointV5 {
  readonly endpointId: OpcUaEndpointIdV5
  readonly name: string
  readonly endpointUrl: string
  readonly enabled: boolean
  readonly publishingIntervalMs: number
  readonly reconnectDelayMs: number
}

export type OpcUaProjectTargetV5 =
  | { readonly type: 'logical-signal'; readonly signalId: string }
  | { readonly type: 'robot-joint'; readonly robotId: string; readonly jointId: string }
  | { readonly type: 'robot-frame'; readonly robotId: string; readonly frameId: string }
  | { readonly type: 'robot-status'; readonly robotId: string }
  | { readonly type: 'entity-frame'; readonly entityId: string; readonly frameId: string }
  | { readonly type: 'entity-status'; readonly entityId: string }

export interface OpcUaMappingLeafV5 {
  readonly leafPath: readonly (string | number)[]
  readonly nodeAddress?: OpcUaNodeAddressV1
  readonly projectPath: readonly (string | number)[]
  readonly projectTarget: OpcUaProjectTargetV5
  readonly opcUaDataType: 'Boolean' | 'SByte' | 'Byte' | 'Int16' | 'UInt16' | 'Int32' | 'UInt32' | 'Float' | 'Double' | 'String'
  readonly projectDataType: 'boolean' | 'integer' | 'number' | 'string'
  readonly scale: number
  readonly offset: number
  readonly unit: string
  readonly required: boolean
}

export interface OpcUaMappingV5 {
  readonly id: OpcUaMappingIdV5
  readonly endpointId: OpcUaEndpointIdV5
  readonly nodeAddress: OpcUaNodeAddressV1
  readonly direction: 'read' | 'write' | 'readWrite'
  readonly publishingIntervalMs?: number
  readonly coherenceGroupId: string | null
  readonly interpolationMode: 'none' | 'linear' | 'shortest-quaternion' | 'revolute-wrapped'
  readonly coordinateConvention: 'project-v5-z-up-metres-quaternion-xyzw'
  readonly leaves: readonly OpcUaMappingLeafV5[]
}

export interface OpcUaBridgeRouteV5 {
  readonly id: OpcUaBridgeRouteIdV5
  readonly sourceMappingId: OpcUaMappingIdV5
  readonly destinationMappingId: OpcUaMappingIdV5
  readonly direction: 'forward'
  readonly scale: number
  readonly offset: number
  readonly unit: string
}

export interface OpcUaProjectConfigurationV5 {
  readonly mode: 'off' | 'client' | 'server' | 'bridge'
  readonly endpoints: readonly OpcUaEndpointV5[]
  readonly mappings: readonly OpcUaMappingV5[]
  readonly bridgeRoutes: readonly OpcUaBridgeRouteV5[]
}

export interface WorkcellProjectV5 {
  readonly schemaVersion: 5
  readonly projectId: ProjectIdV5
  readonly revisionId: RevisionIdV5
  readonly metadata: ProjectMetadataV5
  readonly assetReferences: readonly AssetReferenceV5[]
  readonly scene: ProjectSceneV5
  readonly robotDefinitions: readonly RobotDefinitionV5[]
  readonly controllers: readonly RobotControllerV5[]
  readonly robots: readonly RobotInstanceV5[]
  readonly spatialEntities: readonly SpatialEntityV5[]
  readonly sceneGroups: readonly SceneGroupV5[]
  readonly logicalSignals: readonly LogicalSignalV1[]
  readonly jobs: readonly RobotJobV5[]
  readonly opcUa: OpcUaProjectConfigurationV5
}
