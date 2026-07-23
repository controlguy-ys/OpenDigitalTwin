import {
  DataType,
  StatusCodes,
  Variant,
  type AddressSpace,
  type Namespace,
  type UAObject,
  type UAVariable,
} from 'node-opcua'

import type { RigidTransformV5, WorkcellProjectV5 } from '../../src/core/project-v5/index.js'
import {
  validateCommandResultV1,
  type CommandResultV1,
} from '../../src/core/runtime-protocol/v1.js'
import type { ProductCommandTargetV1 } from './opcua-command-staging.js'

export const OPENWEB_MODEL_NAMESPACE_URI_V1 =
  'urn:open-web-digital-twin:model:v1' as const

export const OPENWEB_INSTANCES_NAMESPACE_URI_V1 =
  'urn:open-web-digital-twin:instances:v1' as const

export const MAX_OPENWEB_RESULT_RECORDS_V1 = 4_096

const CANONICAL_CONFIG_REVISION_V1 = /^[0-9a-f]{64}$/u

export function assertCanonicalConfigRevisionV1(configRevision: string): void {
  if (!CANONICAL_CONFIG_REVISION_V1.test(configRevision)) {
    throw new Error('OPC_UA_CONFIG_REVISION_INVALID')
  }
}

export type OpenWebQualityV1 = 'GOOD' | 'UNCERTAIN' | 'BAD' | 'STALE'

export interface ObjectActualV1 {
  readonly pose: RigidTransformV5
  readonly status: number
  readonly color: string
  readonly quality: OpenWebQualityV1
  readonly sourceTimestampMs: number
  readonly publishedTimestampMs: number
}

export interface LogicalSignalActualV1 {
  readonly value: boolean | number | string
  readonly quality: OpenWebQualityV1
  readonly statusCode: string
  readonly sourceTimestampMs: number
  readonly publishedTimestampMs: number
}

export interface JobActualV1 {
  readonly state: string
  readonly stepIndex: number
  readonly failureCode: string | null
}

export interface AttachmentActualV1 {
  readonly state: 'attached' | 'detached'
  readonly parentFrameId: string | null
}

export interface ServerActualSnapshotV1 {
  readonly projectId: string
  readonly revisionId: string
  readonly configRevision: string
  readonly robots: Readonly<Record<string, Readonly<Record<string, number>>>>
  readonly sceneObjects: Readonly<Record<string, ObjectActualV1>>
  readonly logicalSignals: Readonly<Record<string, LogicalSignalActualV1>>
  readonly jobs: Readonly<Record<string, JobActualV1>>
  readonly attachments: Readonly<Record<string, AttachmentActualV1>>
}

export interface OpenWebGatewayDiagnosticsV1 {
  readonly mode: string
  readonly standardNodeSets: string
  readonly roboticsModel: string
  readonly productModel: string
  readonly endpointUrl: string | null
  readonly lastError: string | null
}

export interface OpenWebEndpointDiagnosticsV1 {
  readonly phase: string
  readonly lastError: string | null
}

export interface OpenWebDiagnosticsSnapshotV1 {
  readonly leaseGeneration: number | null
  readonly leaseExpiresAtMs: number | null
  readonly lastCommand: CommandResultV1 | null
  readonly gateway: OpenWebGatewayDiagnosticsV1
  readonly endpoints: Readonly<Record<string, OpenWebEndpointDiagnosticsV1>>
}

export interface OpenWebDiagnosticsReadV1 extends OpenWebDiagnosticsSnapshotV1 {
  readonly revisionId: string
  readonly configRevision: string
}

export interface ProductNodeIdV1 {
  readonly nodeId: string
  readonly namespaceUri:
    | typeof OPENWEB_MODEL_NAMESPACE_URI_V1
    | typeof OPENWEB_INSTANCES_NAMESPACE_URI_V1
}

export interface ProductCommandBaseFieldsV1 {
  readonly targetId: string
  readonly requestId: UAVariable
  readonly expiresAt: UAVariable
  readonly execute: UAVariable
}

export interface RobotJointTargetCommandFieldsV1 extends ProductCommandBaseFieldsV1 {
  readonly payload: Readonly<Record<string, UAVariable>>
}

export interface SceneObjectCommandFieldsV1 extends ProductCommandBaseFieldsV1 {
  readonly payload: Readonly<{
    X: UAVariable
    Y: UAVariable
    Z: UAVariable
    Roll: UAVariable
    Pitch: UAVariable
    Yaw: UAVariable
  }>
}

export interface LogicalSignalCommandFieldsV1 extends ProductCommandBaseFieldsV1 {
  readonly payload: Readonly<{ Value: UAVariable }>
}

export interface JobCommandFieldsV1 extends ProductCommandBaseFieldsV1 {
  readonly payload: Readonly<{ Operation: UAVariable }>
}

export interface ProductCommandFieldHandlesV1 {
  readonly robotJointTargets: Readonly<Record<string, RobotJointTargetCommandFieldsV1>>
  readonly sceneObjects: Readonly<Record<string, SceneObjectCommandFieldsV1>>
  readonly logicalSignals: Readonly<Record<string, LogicalSignalCommandFieldsV1>>
  readonly jobs: Readonly<Record<string, JobCommandFieldsV1>>
}

export interface OpcUaOpenWebModelV1 {
  readonly rootNodeId: string
  readonly commandFields: ProductCommandFieldHandlesV1
  readonly commandTargets: Readonly<Record<string, ProductCommandTargetV1>>
  rootChildren(): readonly ['Actual', 'Command', 'Result', 'Diagnostics']
  actualChildren(): readonly ['SceneObjects', 'LogicalSignals', 'Jobs', 'Attachments']
  commandChildren(): readonly ['RobotJointTargets', 'SceneObjects', 'LogicalSignals', 'Jobs']
  productNodeIds(): readonly ProductNodeIdV1[]
  retainedResultLimit(): number
  publishSnapshot(snapshot: ServerActualSnapshotV1): void
  readActualObjectPose(objectId: string): RigidTransformV5 | null
  publishResult(result: CommandResultV1): void
  readResult(requestId: string): CommandResultV1 | null
  updateDiagnostics(snapshot: OpenWebDiagnosticsSnapshotV1): void
  readDiagnostics(): OpenWebDiagnosticsReadV1
  bindCommandWrites(listener: (write: Readonly<{ sessionId: string; target: ProductCommandTargetV1; field: string; value: unknown }>) => void): void
  dispose(): void
}

type ScalarValueV1 = boolean | number | string | Date

type ObjectActualNodesV1 = Readonly<{
  readonly pose: Readonly<{
    readonly x: UAVariable
    readonly y: UAVariable
    readonly z: UAVariable
    readonly quaternionX: UAVariable
    readonly quaternionY: UAVariable
    readonly quaternionZ: UAVariable
    readonly quaternionW: UAVariable
  }>
  readonly status: UAVariable
  readonly color: UAVariable
  readonly quality: UAVariable
  readonly sourceTimestamp: UAVariable
  readonly publishedTimestamp: UAVariable
}>

type LogicalSignalActualNodesV1 = Readonly<{
  readonly value: UAVariable
  readonly quality: UAVariable
  readonly statusCode: UAVariable
  readonly sourceTimestamp: UAVariable
  readonly publishedTimestamp: UAVariable
}>

type JobActualNodesV1 = Readonly<{
  readonly state: UAVariable
  readonly stepIndex: UAVariable
  readonly failureCode: UAVariable
}>

type AttachmentActualNodesV1 = Readonly<{
  readonly state: UAVariable
  readonly parentFrameId: UAVariable
}>

type ResultNodesV1 = Readonly<{
  readonly entry: UAObject
  readonly acknowledgement: UAVariable
  readonly executionState: UAVariable
  readonly failureCode: UAVariable
  readonly message: UAVariable
  readonly completionTime: UAVariable
}>

type DiagnosticsNodesV1 = Readonly<{
  readonly leaseGeneration: UAVariable
  readonly leaseExpiresAt: UAVariable
  readonly lastCommand: Readonly<{
    readonly requestId: UAVariable
    readonly acknowledgement: UAVariable
    readonly executionState: UAVariable
    readonly failureCode: UAVariable
    readonly message: UAVariable
    readonly completionTime: UAVariable
  }>
  readonly gateway: Readonly<{
    readonly mode: UAVariable
    readonly standardNodeSets: UAVariable
    readonly roboticsModel: UAVariable
    readonly productModel: UAVariable
    readonly endpointUrl: UAVariable
    readonly lastError: UAVariable
  }>
  readonly endpoints: UAObject
}>

const ROOT_CHILDREN = Object.freeze(['Actual', 'Command', 'Result', 'Diagnostics'] as const)
const ACTUAL_CHILDREN = Object.freeze(['SceneObjects', 'LogicalSignals', 'Jobs', 'Attachments'] as const)
const COMMAND_CHILDREN = Object.freeze([
  'RobotJointTargets', 'SceneObjects', 'LogicalSignals', 'Jobs',
] as const)
const OPENWEB_QUALITIES = Object.freeze(['GOOD', 'UNCERTAIN', 'BAD', 'STALE'] as const)

function nodeIdForPath(namespace: Namespace, path: string): string {
  return `ns=${namespace.index};s=${path}`
}

function frozenRecord<T>(entries: Iterable<readonly [string, T]>): Readonly<Record<string, T>> {
  const record = Object.create(null) as Record<string, T>
  for (const [key, value] of entries) record[key] = value
  return Object.freeze(record)
}

function copyPose(pose: RigidTransformV5): RigidTransformV5 {
  return Object.freeze({
    positionM: [pose.positionM[0], pose.positionM[1], pose.positionM[2]] as RigidTransformV5['positionM'],
    quaternion: [pose.quaternion[0], pose.quaternion[1], pose.quaternion[2], pose.quaternion[3]] as RigidTransformV5['quaternion'],
  })
}

function copyResult(result: CommandResultV1): CommandResultV1 {
  return Object.freeze({ ...result })
}

function copyDiagnostics(
  snapshot: OpenWebDiagnosticsSnapshotV1,
  revisionId: string,
  configRevision: string,
): OpenWebDiagnosticsReadV1 {
  return Object.freeze({
    revisionId,
    configRevision,
    leaseGeneration: snapshot.leaseGeneration,
    leaseExpiresAtMs: snapshot.leaseExpiresAtMs,
    lastCommand: snapshot.lastCommand === null ? null : copyResult(snapshot.lastCommand),
    gateway: Object.freeze({ ...snapshot.gateway }),
    endpoints: frozenRecord(Object.entries(snapshot.endpoints).map(([endpointId, endpoint]) => [
      endpointId,
      Object.freeze({ ...endpoint }),
    ])),
  })
}

function logicalSignalDataType(dataType: WorkcellProjectV5['logicalSignals'][number]['dataType']): DataType {
  switch (dataType) {
    case 'Boolean': return DataType.Boolean
    case 'Int32': return DataType.Int32
    case 'UInt32': return DataType.UInt32
    case 'Double': return DataType.Double
    case 'String': return DataType.String
  }
}

function requireFinite(value: number, name: string): number {
  if (!Number.isFinite(value)) throw new Error(`OPC_UA_OPENWEB_${name}_INVALID`)
  return value
}

function requireInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value)) throw new Error(`OPC_UA_OPENWEB_${name}_INVALID`)
  return value
}

function requireInt32(value: number, name: string): number {
  const integer = requireInteger(value, name)
  if (integer < -2_147_483_648 || integer > 2_147_483_647) {
    throw new Error(`OPC_UA_OPENWEB_${name}_INVALID`)
  }
  return integer
}

function requireUInt32(value: number, name: string): number {
  const integer = requireInteger(value, name)
  if (integer < 0 || integer > 4_294_967_295) {
    throw new Error(`OPC_UA_OPENWEB_${name}_INVALID`)
  }
  return integer
}

function requireText(value: unknown, name: string): string {
  if (typeof value !== 'string') throw new Error(`OPC_UA_OPENWEB_${name}_INVALID`)
  return value
}

function requireQuality(value: unknown): OpenWebQualityV1 {
  if (!OPENWEB_QUALITIES.includes(value as OpenWebQualityV1)) {
    throw new Error('OPC_UA_OPENWEB_QUALITY_INVALID')
  }
  return value as OpenWebQualityV1
}

function dateAt(value: number | null): Date {
  return new Date(value ?? 0)
}

function setValue(variable: UAVariable, dataType: DataType, value: ScalarValueV1, timestamp?: number): void {
  variable.setValueFromSource(
    { dataType, value },
    StatusCodes.Good,
    timestamp === undefined ? undefined : new Date(timestamp),
  )
}

export function instantiateOpcUaOpenWebModelV1(options: Readonly<{
  addressSpace: AddressSpace
  modelNamespace: Namespace
  instancesNamespace: Namespace
  project: WorkcellProjectV5
  configRevision: string
  maxRetainedResults?: number
}>): OpcUaOpenWebModelV1 {
  const { addressSpace, modelNamespace, instancesNamespace, project, configRevision } = options
  if (modelNamespace.namespaceUri !== OPENWEB_MODEL_NAMESPACE_URI_V1) {
    throw new Error('OPC_UA_OPENWEB_MODEL_NAMESPACE_INVALID')
  }
  if (instancesNamespace.namespaceUri !== OPENWEB_INSTANCES_NAMESPACE_URI_V1) {
    throw new Error('OPC_UA_OPENWEB_INSTANCES_NAMESPACE_INVALID')
  }
  assertCanonicalConfigRevisionV1(configRevision)
  const maxRetainedResults = options.maxRetainedResults ?? MAX_OPENWEB_RESULT_RECORDS_V1
  if (
    !Number.isSafeInteger(maxRetainedResults)
    || maxRetainedResults < 1
    || maxRetainedResults > MAX_OPENWEB_RESULT_RECORDS_V1
  ) {
    throw new Error('OPC_UA_OPENWEB_RESULT_LIMIT_INVALID')
  }

  const productNodeIdsByNodeId = new Map<string, ProductNodeIdV1>()
  const rootPath = `OpenWebDigitalTwin/Projects/${project.projectId}`

  function track<T extends UAObject | UAVariable>(node: T): T {
    const namespaceUri = node.nodeId.namespace === modelNamespace.index
      ? modelNamespace.namespaceUri
      : node.nodeId.namespace === instancesNamespace.index
        ? instancesNamespace.namespaceUri
        : null
    if (namespaceUri === null) throw new Error('OPC_UA_OPENWEB_PRODUCT_NODE_NAMESPACE_INVALID')
    const nodeId = node.nodeId.toString()
    productNodeIdsByNodeId.set(nodeId, Object.freeze({
      nodeId,
      namespaceUri: namespaceUri as ProductNodeIdV1['namespaceUri'],
    }))
    return node
  }

  function untrack(node: UAObject | UAVariable): void {
    productNodeIdsByNodeId.delete(node.nodeId.toString())
  }

  function liveProductNodeIds(): readonly ProductNodeIdV1[] {
    for (const nodeId of productNodeIdsByNodeId.keys()) {
      if (addressSpace.findNode(nodeId) === null) productNodeIdsByNodeId.delete(nodeId)
    }
    return Object.freeze([...productNodeIdsByNodeId.values()])
  }

  function object(
    parent: UAObject | null,
    browseName: string,
    path: string,
  ): UAObject {
    return track(instancesNamespace.addObject(parent === null
      ? {
          organizedBy: addressSpace.rootFolder.objects,
          browseName: { name: browseName, namespaceIndex: instancesNamespace.index },
          nodeId: nodeIdForPath(instancesNamespace, path),
          typeDefinition: 'BaseObjectType',
        }
      : {
          componentOf: parent,
          browseName: { name: browseName, namespaceIndex: instancesNamespace.index },
          nodeId: nodeIdForPath(instancesNamespace, path),
          typeDefinition: 'BaseObjectType',
        }))
  }

  function variable(
    parent: UAObject,
    browseName: string,
    path: string,
    dataType: DataType,
    value: ScalarValueV1,
    writable = false,
  ): UAVariable {
    const accessLevel = writable ? 'CurrentRead | CurrentWrite' : 'CurrentRead'
    return track(instancesNamespace.addVariable({
      componentOf: parent,
      browseName: { name: browseName, namespaceIndex: instancesNamespace.index },
      nodeId: nodeIdForPath(instancesNamespace, path),
      dataType,
      accessLevel,
      userAccessLevel: accessLevel,
      minimumSamplingInterval: 0,
      value: new Variant({ dataType, value }),
    }))
  }

  const openWeb = object(null, 'OpenWebDigitalTwin', 'OpenWebDigitalTwin')
  const projects = object(openWeb, 'Projects', 'OpenWebDigitalTwin/Projects')
  const projectRoot = object(projects, project.projectId, rootPath)
  const actual = object(projectRoot, 'Actual', `${rootPath}/Actual`)
  const command = object(projectRoot, 'Command', `${rootPath}/Command`)
  const result = object(projectRoot, 'Result', `${rootPath}/Result`)
  const diagnostics = object(projectRoot, 'Diagnostics', `${rootPath}/Diagnostics`)

  const actualSceneObjects = object(actual, 'SceneObjects', `${rootPath}/Actual/SceneObjects`)
  const actualLogicalSignals = object(actual, 'LogicalSignals', `${rootPath}/Actual/LogicalSignals`)
  const actualJobs = object(actual, 'Jobs', `${rootPath}/Actual/Jobs`)
  const actualAttachments = object(actual, 'Attachments', `${rootPath}/Actual/Attachments`)

  const commandRobotJointTargets = object(command, 'RobotJointTargets', `${rootPath}/Command/RobotJointTargets`)
  const commandSceneObjects = object(command, 'SceneObjects', `${rootPath}/Command/SceneObjects`)
  const commandLogicalSignals = object(command, 'LogicalSignals', `${rootPath}/Command/LogicalSignals`)
  const commandJobs = object(command, 'Jobs', `${rootPath}/Command/Jobs`)

  const actualObjects = new Map<string, ObjectActualNodesV1>()
  const actualSignals = new Map<string, LogicalSignalActualNodesV1>()
  const actualJobsById = new Map<string, JobActualNodesV1>()
  const actualAttachmentsByObjectId = new Map<string, AttachmentActualNodesV1>()
  const posesByObjectId = new Map<string, RigidTransformV5>()
  const signalDefinitionsById = new Map(project.logicalSignals.map((signal) => [signal.id, signal]))
  const robotJointIdsByRobotId = new Map(project.robots.map((robot) => {
    const definition = project.robotDefinitions.find(({ id }) => id === robot.definitionId)
    if (definition === undefined) throw new Error(`OPC_UA_OPENWEB_ROBOT_DEFINITION_NOT_FOUND: ${robot.id}`)
    return [robot.id, new Set(definition.joints.map(({ id }) => id))] as const
  }))

  for (const entity of project.spatialEntities) {
    const path = `${rootPath}/Actual/SceneObjects/${entity.id}`
    const entry = object(actualSceneObjects, entity.id, path)
    const pose = object(entry, 'Pose', `${path}/Pose`)
    const poseValue = copyPose(entity.localPose)
    const nodes: ObjectActualNodesV1 = Object.freeze({
      pose: Object.freeze({
        x: variable(pose, 'X', `${path}/Pose/X`, DataType.Double, poseValue.positionM[0]),
        y: variable(pose, 'Y', `${path}/Pose/Y`, DataType.Double, poseValue.positionM[1]),
        z: variable(pose, 'Z', `${path}/Pose/Z`, DataType.Double, poseValue.positionM[2]),
        quaternionX: variable(pose, 'QuaternionX', `${path}/Pose/QuaternionX`, DataType.Double, poseValue.quaternion[0]),
        quaternionY: variable(pose, 'QuaternionY', `${path}/Pose/QuaternionY`, DataType.Double, poseValue.quaternion[1]),
        quaternionZ: variable(pose, 'QuaternionZ', `${path}/Pose/QuaternionZ`, DataType.Double, poseValue.quaternion[2]),
        quaternionW: variable(pose, 'QuaternionW', `${path}/Pose/QuaternionW`, DataType.Double, poseValue.quaternion[3]),
      }),
      status: variable(entry, 'Status', `${path}/Status`, DataType.Int32, entity.numericStatus.value),
      color: variable(
        entry,
        'Color',
        `${path}/Color`,
        DataType.String,
        entity.geometry.kind === 'asset' ? '#808080' : entity.geometry.color,
      ),
      quality: variable(entry, 'Quality', `${path}/Quality`, DataType.String, 'STALE'),
      sourceTimestamp: variable(entry, 'SourceTimestamp', `${path}/SourceTimestamp`, DataType.DateTime, dateAt(null)),
      publishedTimestamp: variable(entry, 'PublishedTimestamp', `${path}/PublishedTimestamp`, DataType.DateTime, dateAt(null)),
    })
    actualObjects.set(entity.id, nodes)
    posesByObjectId.set(entity.id, poseValue)

    const attachmentPath = `${rootPath}/Actual/Attachments/${entity.id}`
    const attachment = object(actualAttachments, entity.id, attachmentPath)
    actualAttachmentsByObjectId.set(entity.id, Object.freeze({
      state: variable(attachment, 'State', `${attachmentPath}/State`, DataType.String, 'detached'),
      parentFrameId: variable(attachment, 'ParentFrameId', `${attachmentPath}/ParentFrameId`, DataType.String, ''),
    }))
  }

  for (const signal of project.logicalSignals) {
    const path = `${rootPath}/Actual/LogicalSignals/${signal.id}`
    const entry = object(actualLogicalSignals, signal.id, path)
    actualSignals.set(signal.id, Object.freeze({
      value: variable(entry, 'Value', `${path}/Value`, logicalSignalDataType(signal.dataType), signal.initialValue),
      quality: variable(entry, 'Quality', `${path}/Quality`, DataType.String, 'STALE'),
      statusCode: variable(entry, 'StatusCode', `${path}/StatusCode`, DataType.String, 'UncertainInitialValue'),
      sourceTimestamp: variable(entry, 'SourceTimestamp', `${path}/SourceTimestamp`, DataType.DateTime, dateAt(null)),
      publishedTimestamp: variable(entry, 'PublishedTimestamp', `${path}/PublishedTimestamp`, DataType.DateTime, dateAt(null)),
    }))
  }

  for (const job of project.jobs) {
    const path = `${rootPath}/Actual/Jobs/${job.id}`
    const entry = object(actualJobs, job.id, path)
    actualJobsById.set(job.id, Object.freeze({
      state: variable(entry, 'State', `${path}/State`, DataType.String, 'idle'),
      stepIndex: variable(entry, 'StepIndex', `${path}/StepIndex`, DataType.Int32, 0),
      failureCode: variable(entry, 'FailureCode', `${path}/FailureCode`, DataType.String, ''),
    }))
  }

  function commandBase(
    parent: UAObject,
    path: string,
    targetId: string,
  ): ProductCommandBaseFieldsV1 {
    return Object.freeze({
      targetId,
      requestId: variable(parent, 'RequestId', `${path}/RequestId`, DataType.String, '', true),
      expiresAt: variable(parent, 'ExpiresAt', `${path}/ExpiresAt`, DataType.DateTime, dateAt(null), true),
      execute: variable(parent, 'Execute', `${path}/Execute`, DataType.Boolean, false, true),
    })
  }

  const robotCommandFields: Array<readonly [string, RobotJointTargetCommandFieldsV1]> = []
  for (const robot of project.robots) {
    const path = `${rootPath}/Command/RobotJointTargets/${robot.id}`
    const entry = object(commandRobotJointTargets, robot.id, path)
    const jointTargets = object(entry, 'JointTargets', `${path}/JointTargets`)
    const definition = project.robotDefinitions.find(({ id }) => id === robot.definitionId)
    if (definition === undefined) throw new Error(`OPC_UA_OPENWEB_ROBOT_DEFINITION_NOT_FOUND: ${robot.id}`)
    const payload: Array<readonly [string, UAVariable]> = []
    for (const joint of definition.joints) {
      payload.push([joint.id, variable(
        jointTargets,
        joint.id,
        `${path}/JointTargets/${joint.id}`,
        DataType.Double,
        robot.initialJointValues[joint.id] ?? joint.home,
        true,
      )])
    }
    robotCommandFields.push([robot.id, Object.freeze({
      ...commandBase(entry, path, robot.id),
      payload: frozenRecord(payload),
    })])
  }

  const objectCommandFields: Array<readonly [string, SceneObjectCommandFieldsV1]> = []
  for (const entity of project.spatialEntities) {
    const path = `${rootPath}/Command/SceneObjects/${entity.id}`
    const entry = object(commandSceneObjects, entity.id, path)
    objectCommandFields.push([entity.id, Object.freeze({
      ...commandBase(entry, path, entity.id),
      // RPY is deliberately an exchange-only staged command representation.
      payload: Object.freeze({
        X: variable(entry, 'X', `${path}/X`, DataType.Double, entity.localPose.positionM[0], true),
        Y: variable(entry, 'Y', `${path}/Y`, DataType.Double, entity.localPose.positionM[1], true),
        Z: variable(entry, 'Z', `${path}/Z`, DataType.Double, entity.localPose.positionM[2], true),
        Roll: variable(entry, 'Roll', `${path}/Roll`, DataType.Double, 0, true),
        Pitch: variable(entry, 'Pitch', `${path}/Pitch`, DataType.Double, 0, true),
        Yaw: variable(entry, 'Yaw', `${path}/Yaw`, DataType.Double, 0, true),
      }),
    })])
  }

  const signalCommandFields: Array<readonly [string, LogicalSignalCommandFieldsV1]> = []
  for (const signal of project.logicalSignals) {
    const path = `${rootPath}/Command/LogicalSignals/${signal.id}`
    const entry = object(commandLogicalSignals, signal.id, path)
    signalCommandFields.push([signal.id, Object.freeze({
      ...commandBase(entry, path, signal.id),
      payload: Object.freeze({
        Value: variable(entry, 'Value', `${path}/Value`, logicalSignalDataType(signal.dataType), signal.initialValue, true),
      }),
    })])
  }

  const jobCommandFields: Array<readonly [string, JobCommandFieldsV1]> = []
  for (const job of project.jobs) {
    const path = `${rootPath}/Command/Jobs/${job.id}`
    const entry = object(commandJobs, job.id, path)
    jobCommandFields.push([job.id, Object.freeze({
      ...commandBase(entry, path, job.id),
      payload: Object.freeze({
        Operation: variable(entry, 'Operation', `${path}/Operation`, DataType.String, 'start', true),
      }),
    })])
  }

  const commandFields: ProductCommandFieldHandlesV1 = Object.freeze({
    robotJointTargets: frozenRecord(robotCommandFields),
    sceneObjects: frozenRecord(objectCommandFields),
    logicalSignals: frozenRecord(signalCommandFields),
    jobs: frozenRecord(jobCommandFields),
  })
  const commandTargetEntries: Array<readonly [string, ProductCommandTargetV1]> = [
    ...project.robots.map((robot): readonly [string, ProductCommandTargetV1] => {
      const definition = project.robotDefinitions.find(({ id }) => id === robot.definitionId)!
      return [robot.id, Object.freeze({ targetId: robot.id, projectId: project.projectId, revisionId: project.revisionId, configRevision, payload: Object.freeze({ kind: 'robot-joint-target' as const, robotId: robot.id, jointIds: Object.freeze(definition.joints.map(({ id }) => id)) }) })] as const
    }),
    ...project.spatialEntities.map((entity): readonly [string, ProductCommandTargetV1] => [entity.id, Object.freeze({ targetId: entity.id, projectId: project.projectId, revisionId: project.revisionId, configRevision, payload: Object.freeze({ kind: 'scene-object-pose' as const, objectId: entity.id }) })]),
    ...project.logicalSignals.map((signal): readonly [string, ProductCommandTargetV1] => [signal.id, Object.freeze({ targetId: signal.id, projectId: project.projectId, revisionId: project.revisionId, configRevision, payload: Object.freeze({ kind: 'logical-signal' as const, signalId: signal.id }) })]),
    ...project.jobs.map((job): readonly [string, ProductCommandTargetV1] => [job.id, Object.freeze({ targetId: job.id, projectId: project.projectId, revisionId: project.revisionId, configRevision, payload: Object.freeze({ kind: 'job' as const, jobId: job.id }) })]),
  ]
  const commandTargets: Readonly<Record<string, ProductCommandTargetV1>> = frozenRecord(commandTargetEntries)

  const revisionId = variable(diagnostics, 'RevisionId', `${rootPath}/Diagnostics/RevisionId`, DataType.String, project.revisionId)
  const configRevisionNode = variable(diagnostics, 'ConfigRevision', `${rootPath}/Diagnostics/ConfigRevision`, DataType.String, configRevision)
  const lease = object(diagnostics, 'Lease', `${rootPath}/Diagnostics/Lease`)
  const lastCommand = object(diagnostics, 'LastCommand', `${rootPath}/Diagnostics/LastCommand`)
  const gateway = object(diagnostics, 'Gateway', `${rootPath}/Diagnostics/Gateway`)
  const endpoints = object(diagnostics, 'Endpoints', `${rootPath}/Diagnostics/Endpoints`)
  const diagnosticsNodes: DiagnosticsNodesV1 = Object.freeze({
    leaseGeneration: variable(lease, 'Generation', `${rootPath}/Diagnostics/Lease/Generation`, DataType.UInt32, 0),
    leaseExpiresAt: variable(lease, 'ExpiresAt', `${rootPath}/Diagnostics/Lease/ExpiresAt`, DataType.DateTime, dateAt(null)),
    lastCommand: Object.freeze({
      requestId: variable(lastCommand, 'RequestId', `${rootPath}/Diagnostics/LastCommand/RequestId`, DataType.String, ''),
      acknowledgement: variable(lastCommand, 'Acknowledgement', `${rootPath}/Diagnostics/LastCommand/Acknowledgement`, DataType.String, 'IDLE'),
      executionState: variable(lastCommand, 'ExecutionState', `${rootPath}/Diagnostics/LastCommand/ExecutionState`, DataType.String, 'IDLE'),
      failureCode: variable(lastCommand, 'FailureCode', `${rootPath}/Diagnostics/LastCommand/FailureCode`, DataType.String, ''),
      message: variable(lastCommand, 'Message', `${rootPath}/Diagnostics/LastCommand/Message`, DataType.String, ''),
      completionTime: variable(lastCommand, 'CompletionTime', `${rootPath}/Diagnostics/LastCommand/CompletionTime`, DataType.DateTime, dateAt(null)),
    }),
    gateway: Object.freeze({
      mode: variable(gateway, 'Mode', `${rootPath}/Diagnostics/Gateway/Mode`, DataType.String, 'off'),
      standardNodeSets: variable(gateway, 'StandardNodeSets', `${rootPath}/Diagnostics/Gateway/StandardNodeSets`, DataType.String, 'disabled'),
      roboticsModel: variable(gateway, 'RoboticsModel', `${rootPath}/Diagnostics/Gateway/RoboticsModel`, DataType.String, 'disabled'),
      productModel: variable(gateway, 'ProductModel', `${rootPath}/Diagnostics/Gateway/ProductModel`, DataType.String, 'ready'),
      endpointUrl: variable(gateway, 'EndpointUrl', `${rootPath}/Diagnostics/Gateway/EndpointUrl`, DataType.String, ''),
      lastError: variable(gateway, 'LastError', `${rootPath}/Diagnostics/Gateway/LastError`, DataType.String, ''),
    }),
    endpoints,
  })
  // These immutable product identity nodes are deliberately retained in the tree.
  void revisionId
  void configRevisionNode

  const resultNodesByRequestId = new Map<string, ResultNodesV1>()
  const resultsByRequestId = new Map<string, CommandResultV1>()
  const endpointNodesById = new Map<string, Readonly<{ phase: UAVariable; lastError: UAVariable }>>()
  let diagnosticsState: OpenWebDiagnosticsReadV1 = copyDiagnostics({
    leaseGeneration: null,
    leaseExpiresAtMs: null,
    lastCommand: null,
    gateway: {
      mode: 'off',
      standardNodeSets: 'disabled',
      roboticsModel: 'disabled',
      productModel: 'ready',
      endpointUrl: null,
      lastError: null,
    },
    endpoints: {},
  }, project.revisionId, configRevision)
  let disposed = false
  let commandWriteListener: OpcUaOpenWebModelV1['bindCommandWrites'] extends (listener: infer Listener) => void ? Listener | null : never = null

  function sessionIdFromWriteContext(context: unknown): string {
    const session = context !== null && typeof context === 'object'
      ? (context as { readonly session?: { getSessionId?: () => { toString(): string } } }).session
      : undefined
    const id = session?.getSessionId?.().toString()
    return id === undefined ? 'opcua:anonymous-session' : `opcua:${id}`
  }

  function installCommandWriter(variable: UAVariable, target: ProductCommandTargetV1, field: string): void {
    const original = variable.writeValue.bind(variable) as (...args: unknown[]) => unknown
    ;(variable as unknown as { writeValue: (...args: unknown[]) => unknown }).writeValue = (...args: unknown[]): unknown => {
      const dataValue = args[1] as { readonly value?: { readonly value?: unknown } } | undefined
      const listener = commandWriteListener
      if (listener !== null) {
        try {
          listener({ sessionId: sessionIdFromWriteContext(args[0]), target, field, value: dataValue?.value?.value })
        } catch {
          const callback = args.at(-1)
          if (typeof callback === 'function') {
            ;(callback as (error: Error | null, status: typeof StatusCodes.BadInvalidArgument) => void)(null, StatusCodes.BadInvalidArgument)
            return undefined
          }
          return Promise.resolve(StatusCodes.BadInvalidArgument)
        }
      }
      return original(...args)
    }
  }

  for (const target of Object.values(commandTargets)) {
    const fields = target.payload.kind === 'robot-joint-target'
      ? commandFields.robotJointTargets[target.targetId]!
      : target.payload.kind === 'scene-object-pose'
        ? commandFields.sceneObjects[target.targetId]!
        : target.payload.kind === 'logical-signal'
          ? commandFields.logicalSignals[target.targetId]!
          : commandFields.jobs[target.targetId]!
    installCommandWriter(fields.requestId, target, 'RequestId')
    installCommandWriter(fields.expiresAt, target, 'ExpiresAt')
    installCommandWriter(fields.execute, target, 'Execute')
    for (const [field, variable] of Object.entries(fields.payload)) installCommandWriter(variable, target, field)
  }

  function assertActive(): void {
    if (disposed) throw new Error('OPC_UA_OPENWEB_MODEL_DISPOSED')
  }

  function requireSnapshotIdentity(snapshot: ServerActualSnapshotV1): void {
    if (snapshot.projectId !== project.projectId) throw new Error('OPC_UA_OPENWEB_PROJECT_MISMATCH')
    if (snapshot.revisionId !== project.revisionId) throw new Error('OPC_UA_OPENWEB_REVISION_MISMATCH')
    if (snapshot.configRevision !== configRevision) throw new Error('OPC_UA_OPENWEB_CONFIG_REVISION_MISMATCH')
  }

  function requireKnown<T>(values: Readonly<Record<string, T>>, known: ReadonlyMap<string, unknown>, kind: string): void {
    for (const id of Object.keys(values)) {
      if (!known.has(id)) throw new Error(`OPC_UA_OPENWEB_${kind}_NOT_FOUND: ${id}`)
    }
  }

  function prepareSignalValue(
    signal: WorkcellProjectV5['logicalSignals'][number],
    value: LogicalSignalActualV1['value'],
  ): LogicalSignalActualV1['value'] {
    if (signal.dataType === 'Boolean' && typeof value === 'boolean') return value
    if (signal.dataType === 'String' && typeof value === 'string') return value
    if (signal.dataType === 'Int32' && typeof value === 'number') {
      return requireInt32(value, 'LOGICAL_SIGNAL_VALUE')
    }
    if (signal.dataType === 'UInt32' && typeof value === 'number') {
      return requireUInt32(value, 'LOGICAL_SIGNAL_VALUE')
    }
    if (signal.dataType === 'Double' && typeof value === 'number') {
      return requireFinite(value, 'LOGICAL_SIGNAL_VALUE')
    }
    throw new Error('OPC_UA_OPENWEB_LOGICAL_SIGNAL_VALUE_INVALID')
  }

  function prepareSnapshot(snapshot: ServerActualSnapshotV1): ServerActualSnapshotV1 {
    requireSnapshotIdentity(snapshot)
    requireKnown(snapshot.robots, robotJointIdsByRobotId, 'ROBOT')
    requireKnown(snapshot.sceneObjects, actualObjects, 'SCENE_OBJECT')
    requireKnown(snapshot.logicalSignals, actualSignals, 'LOGICAL_SIGNAL')
    requireKnown(snapshot.jobs, actualJobsById, 'JOB')
    requireKnown(snapshot.attachments, actualAttachmentsByObjectId, 'ATTACHMENT')

    const robots = frozenRecord(Object.entries(snapshot.robots).map(([robotId, values]) => {
      const joints = robotJointIdsByRobotId.get(robotId)!
      const preparedValues: Array<readonly [string, number]> = []
      for (const [jointId, value] of Object.entries(values)) {
        if (!joints.has(jointId)) throw new Error(`OPC_UA_OPENWEB_JOINT_NOT_FOUND: ${robotId}/${jointId}`)
        preparedValues.push([jointId, requireFinite(value, 'JOINT_VALUE')])
      }
      return [robotId, frozenRecord(preparedValues)] as const
    }))

    const sceneObjects = frozenRecord(Object.entries(snapshot.sceneObjects).map(([objectId, actualValue]) => {
      const pose = copyPose(actualValue.pose)
      const preparedPose: RigidTransformV5 = Object.freeze({
        positionM: [
          requireFinite(pose.positionM[0], 'POSE'),
          requireFinite(pose.positionM[1], 'POSE'),
          requireFinite(pose.positionM[2], 'POSE'),
        ] as RigidTransformV5['positionM'],
        quaternion: [
          requireFinite(pose.quaternion[0], 'POSE'),
          requireFinite(pose.quaternion[1], 'POSE'),
          requireFinite(pose.quaternion[2], 'POSE'),
          requireFinite(pose.quaternion[3], 'POSE'),
        ] as RigidTransformV5['quaternion'],
      })
      return [objectId, Object.freeze({
        pose: preparedPose,
        status: requireInt32(actualValue.status, 'OBJECT_STATUS'),
        color: requireText(actualValue.color, 'OBJECT_COLOR'),
        quality: requireQuality(actualValue.quality),
        sourceTimestampMs: requireInteger(actualValue.sourceTimestampMs, 'SOURCE_TIMESTAMP'),
        publishedTimestampMs: requireInteger(actualValue.publishedTimestampMs, 'PUBLISHED_TIMESTAMP'),
      })] as const
    }))

    const logicalSignals = frozenRecord(Object.entries(snapshot.logicalSignals).map(([signalId, actualValue]) => {
      const signal = signalDefinitionsById.get(signalId)!
      return [signalId, Object.freeze({
        value: prepareSignalValue(signal, actualValue.value),
        quality: requireQuality(actualValue.quality),
        statusCode: requireText(actualValue.statusCode, 'LOGICAL_SIGNAL_STATUS_CODE'),
        sourceTimestampMs: requireInteger(actualValue.sourceTimestampMs, 'SOURCE_TIMESTAMP'),
        publishedTimestampMs: requireInteger(actualValue.publishedTimestampMs, 'PUBLISHED_TIMESTAMP'),
      })] as const
    }))

    const jobs = frozenRecord(Object.entries(snapshot.jobs).map(([jobId, actualValue]) => [jobId, Object.freeze({
      state: requireText(actualValue.state, 'JOB_STATE'),
      stepIndex: requireInt32(actualValue.stepIndex, 'JOB_STEP_INDEX'),
      failureCode: actualValue.failureCode === null
        ? null
        : requireText(actualValue.failureCode, 'JOB_FAILURE_CODE'),
    })] as const))

    const attachments = frozenRecord(Object.entries(snapshot.attachments).map(([objectId, actualValue]) => {
      if (actualValue.state !== 'attached' && actualValue.state !== 'detached') {
        throw new Error('OPC_UA_OPENWEB_ATTACHMENT_STATE_INVALID')
      }
      return [objectId, Object.freeze({
        state: actualValue.state,
        parentFrameId: actualValue.parentFrameId === null
          ? null
          : requireText(actualValue.parentFrameId, 'ATTACHMENT_PARENT_FRAME'),
      })] as const
    }))

    return Object.freeze({
      projectId: snapshot.projectId,
      revisionId: snapshot.revisionId,
      configRevision: snapshot.configRevision,
      robots,
      sceneObjects,
      logicalSignals,
      jobs,
      attachments,
    })
  }

  function publishSnapshot(snapshot: ServerActualSnapshotV1): void {
    assertActive()
    const prepared = prepareSnapshot(snapshot)

    for (const [objectId, actualValue] of Object.entries(prepared.sceneObjects)) {
      const nodes = actualObjects.get(objectId)!
      const pose = actualValue.pose
      posesByObjectId.set(objectId, pose)
      setValue(nodes.pose.x, DataType.Double, pose.positionM[0], actualValue.sourceTimestampMs)
      setValue(nodes.pose.y, DataType.Double, pose.positionM[1], actualValue.sourceTimestampMs)
      setValue(nodes.pose.z, DataType.Double, pose.positionM[2], actualValue.sourceTimestampMs)
      setValue(nodes.pose.quaternionX, DataType.Double, pose.quaternion[0], actualValue.sourceTimestampMs)
      setValue(nodes.pose.quaternionY, DataType.Double, pose.quaternion[1], actualValue.sourceTimestampMs)
      setValue(nodes.pose.quaternionZ, DataType.Double, pose.quaternion[2], actualValue.sourceTimestampMs)
      setValue(nodes.pose.quaternionW, DataType.Double, pose.quaternion[3], actualValue.sourceTimestampMs)
      setValue(nodes.status, DataType.Int32, actualValue.status, actualValue.sourceTimestampMs)
      setValue(nodes.color, DataType.String, actualValue.color, actualValue.sourceTimestampMs)
      setValue(nodes.quality, DataType.String, actualValue.quality, actualValue.sourceTimestampMs)
      setValue(nodes.sourceTimestamp, DataType.DateTime, new Date(actualValue.sourceTimestampMs), actualValue.sourceTimestampMs)
      setValue(nodes.publishedTimestamp, DataType.DateTime, new Date(actualValue.publishedTimestampMs), actualValue.publishedTimestampMs)
    }

    for (const [signalId, actualValue] of Object.entries(prepared.logicalSignals)) {
      const nodes = actualSignals.get(signalId)!
      const dataType = logicalSignalDataType(signalDefinitionsById.get(signalId)!.dataType)
      setValue(nodes.value, dataType, actualValue.value, actualValue.sourceTimestampMs)
      setValue(nodes.quality, DataType.String, actualValue.quality, actualValue.sourceTimestampMs)
      setValue(nodes.statusCode, DataType.String, actualValue.statusCode, actualValue.sourceTimestampMs)
      setValue(nodes.sourceTimestamp, DataType.DateTime, new Date(actualValue.sourceTimestampMs), actualValue.sourceTimestampMs)
      setValue(nodes.publishedTimestamp, DataType.DateTime, new Date(actualValue.publishedTimestampMs), actualValue.publishedTimestampMs)
    }

    for (const [jobId, actualValue] of Object.entries(prepared.jobs)) {
      const nodes = actualJobsById.get(jobId)!
      setValue(nodes.state, DataType.String, actualValue.state)
      setValue(nodes.stepIndex, DataType.Int32, actualValue.stepIndex)
      setValue(nodes.failureCode, DataType.String, actualValue.failureCode ?? '')
    }

    for (const [objectId, actualValue] of Object.entries(prepared.attachments)) {
      const nodes = actualAttachmentsByObjectId.get(objectId)!
      setValue(nodes.state, DataType.String, actualValue.state)
      setValue(nodes.parentFrameId, DataType.String, actualValue.parentFrameId ?? '')
    }
  }

  function readActualObjectPose(objectId: string): RigidTransformV5 | null {
    const pose = posesByObjectId.get(objectId)
    return pose === undefined ? null : copyPose(pose)
  }

  function createResultNodes(requestId: string): ResultNodesV1 {
    const path = `${rootPath}/Result/${requestId}`
    const entry = object(result, requestId, path)
    return Object.freeze({
      entry,
      acknowledgement: variable(entry, 'Acknowledgement', `${path}/Acknowledgement`, DataType.String, 'IDLE'),
      executionState: variable(entry, 'ExecutionState', `${path}/ExecutionState`, DataType.String, 'IDLE'),
      failureCode: variable(entry, 'FailureCode', `${path}/FailureCode`, DataType.String, ''),
      message: variable(entry, 'Message', `${path}/Message`, DataType.String, ''),
      completionTime: variable(entry, 'CompletionTime', `${path}/CompletionTime`, DataType.DateTime, dateAt(null)),
    })
  }

  function writeResult(nodes: ResultNodesV1, value: CommandResultV1): void {
    setValue(nodes.acknowledgement, DataType.String, value.acknowledgement)
    setValue(nodes.executionState, DataType.String, value.executionState)
    setValue(nodes.failureCode, DataType.String, value.failureCode ?? '')
    setValue(nodes.message, DataType.String, value.message)
    setValue(nodes.completionTime, DataType.DateTime, dateAt(value.completedAt))
  }

  function evictOldestTerminalResult(): boolean {
    for (const [requestId, stored] of resultsByRequestId) {
      if (stored.executionState !== 'SUCCEEDED' && stored.executionState !== 'FAILED') continue

      const nodes = resultNodesByRequestId.get(requestId)
      if (nodes === undefined) throw new Error('OPC_UA_OPENWEB_RESULT_NODE_MISSING')

      resultsByRequestId.delete(requestId)
      resultNodesByRequestId.delete(requestId)
      untrack(nodes.acknowledgement)
      untrack(nodes.executionState)
      untrack(nodes.failureCode)
      untrack(nodes.message)
      untrack(nodes.completionTime)
      untrack(nodes.entry)
      instancesNamespace.deleteNode(nodes.entry)
      return true
    }
    return false
  }

  function publishResult(resultValue: CommandResultV1): void {
    assertActive()
    const normalized = copyResult(validateCommandResultV1(resultValue))
    if (normalized.projectId !== project.projectId) throw new Error('OPC_UA_OPENWEB_RESULT_PROJECT_MISMATCH')
    if (normalized.configRevision !== configRevision) throw new Error('OPC_UA_OPENWEB_RESULT_CONFIG_REVISION_MISMATCH')
    let nodes = resultNodesByRequestId.get(normalized.commandId)
    if (nodes === undefined) {
      if (resultsByRequestId.size >= maxRetainedResults && !evictOldestTerminalResult()) {
        throw new Error('OPC_UA_OPENWEB_RESULT_CAPACITY_EXHAUSTED')
      }
      nodes = createResultNodes(normalized.commandId)
      resultNodesByRequestId.set(normalized.commandId, nodes)
    }
    resultsByRequestId.set(normalized.commandId, normalized)
    writeResult(nodes, normalized)
  }

  function readResult(requestId: string): CommandResultV1 | null {
    const value = resultsByRequestId.get(requestId)
    return value === undefined ? null : copyResult(value)
  }

  function writeLastCommand(value: CommandResultV1 | null): void {
    setValue(diagnosticsNodes.lastCommand.requestId, DataType.String, value?.commandId ?? '')
    setValue(diagnosticsNodes.lastCommand.acknowledgement, DataType.String, value?.acknowledgement ?? 'IDLE')
    setValue(diagnosticsNodes.lastCommand.executionState, DataType.String, value?.executionState ?? 'IDLE')
    setValue(diagnosticsNodes.lastCommand.failureCode, DataType.String, value?.failureCode ?? '')
    setValue(diagnosticsNodes.lastCommand.message, DataType.String, value?.message ?? '')
    setValue(diagnosticsNodes.lastCommand.completionTime, DataType.DateTime, dateAt(value?.completedAt ?? null))
  }

  function updateDiagnostics(snapshot: OpenWebDiagnosticsSnapshotV1): void {
    assertActive()
    const next = copyDiagnostics(snapshot, project.revisionId, configRevision)
    if (next.leaseGeneration !== null) requireInteger(next.leaseGeneration, 'LEASE_GENERATION')
    if (next.leaseExpiresAtMs !== null) requireInteger(next.leaseExpiresAtMs, 'LEASE_EXPIRY')
    setValue(diagnosticsNodes.leaseGeneration, DataType.UInt32, next.leaseGeneration ?? 0)
    setValue(diagnosticsNodes.leaseExpiresAt, DataType.DateTime, dateAt(next.leaseExpiresAtMs))
    writeLastCommand(next.lastCommand)
    setValue(diagnosticsNodes.gateway.mode, DataType.String, next.gateway.mode)
    setValue(diagnosticsNodes.gateway.standardNodeSets, DataType.String, next.gateway.standardNodeSets)
    setValue(diagnosticsNodes.gateway.roboticsModel, DataType.String, next.gateway.roboticsModel)
    setValue(diagnosticsNodes.gateway.productModel, DataType.String, next.gateway.productModel)
    setValue(diagnosticsNodes.gateway.endpointUrl, DataType.String, next.gateway.endpointUrl ?? '')
    setValue(diagnosticsNodes.gateway.lastError, DataType.String, next.gateway.lastError ?? '')
    for (const [endpointId, endpoint] of Object.entries(next.endpoints)) {
      let nodes = endpointNodesById.get(endpointId)
      if (nodes === undefined) {
        const path = `${rootPath}/Diagnostics/Endpoints/${endpointId}`
        const entry = object(diagnosticsNodes.endpoints, endpointId, path)
        nodes = Object.freeze({
          phase: variable(entry, 'Phase', `${path}/Phase`, DataType.String, endpoint.phase),
          lastError: variable(entry, 'LastError', `${path}/LastError`, DataType.String, endpoint.lastError ?? ''),
        })
        endpointNodesById.set(endpointId, nodes)
      }
      setValue(nodes.phase, DataType.String, endpoint.phase)
      setValue(nodes.lastError, DataType.String, endpoint.lastError ?? '')
    }
    diagnosticsState = next
  }

  function readDiagnostics(): OpenWebDiagnosticsReadV1 {
    return copyDiagnostics(diagnosticsState, project.revisionId, configRevision)
  }

  function dispose(): void {
    if (disposed) return
    disposed = true
    actualObjects.clear()
    actualSignals.clear()
    actualJobsById.clear()
    actualAttachmentsByObjectId.clear()
    posesByObjectId.clear()
    resultNodesByRequestId.clear()
    resultsByRequestId.clear()
    endpointNodesById.clear()
    instancesNamespace.deleteNode(openWeb)
    productNodeIdsByNodeId.clear()
  }

  return Object.freeze({
    rootNodeId: projectRoot.nodeId.toString(),
    commandFields,
    commandTargets,
    rootChildren: () => ROOT_CHILDREN,
    actualChildren: () => ACTUAL_CHILDREN,
    commandChildren: () => COMMAND_CHILDREN,
    productNodeIds: liveProductNodeIds,
    retainedResultLimit: () => maxRetainedResults,
    publishSnapshot,
    readActualObjectPose,
    publishResult,
    readResult,
    updateDiagnostics,
    readDiagnostics,
    bindCommandWrites(listener: (write: Readonly<{ sessionId: string; target: ProductCommandTargetV1; field: string; value: unknown }>) => void) {
      if (typeof listener !== 'function') throw new Error('OPC_UA_OPENWEB_COMMAND_LISTENER_INVALID')
      commandWriteListener = listener
    },
    dispose,
  })
}
