import type { RigidTransformV5 } from './rigid-transform.js'
import type {
  AssetReferenceV5,
  GeometryStatisticsV5,
  LogicalSignalV1,
  OpcUaMappingV5,
  RobotJobInstructionV1,
  RobotDefinitionV5,
  RobotInstanceV5,
  WorkcellProjectV5,
} from './types.js'

const ZERO_STATISTICS: GeometryStatisticsV5 = {
  vertices: 0,
  triangles: 0,
  meshes: 0,
  materials: 0,
}

function identityPose(): RigidTransformV5 {
  return { positionM: [0, 0, 0], quaternion: [0, 0, 0, 1] }
}

function makeAssetReference(id = 'asset-robot'): AssetReferenceV5 {
  return {
    id,
    uri: `asset://local/${id}.step`,
    sha256: '0'.repeat(64),
    byteLength: 1,
    sourceFileName: `${id}.step`,
    mediaType: 'model/step',
  }
}

function makeRobotDefinition(): RobotDefinitionV5 {
  return {
    id: 'definition-1',
    name: 'Robot Definition 1',
    identification: {
      manufacturer: 'ABB',
      model: 'CRB15000-12/1.27',
      productCode: 'CRB15000-12/1.27',
      serialNumberTemplate: null,
      motionDeviceCategory: 'ARTICULATED_ROBOT',
    },
    assetReferenceIds: ['asset-robot'],
    sourceConventions: {
      'asset-robot': {
        linearUnit: 'millimeter',
        sourceToMeters: 0.001,
        orientation: { mode: 'up-axis', upAxis: 'z' },
      },
    },
    links: [
      {
        id: 'L0',
        name: 'Link 0',
        geometryOccurrences: [{
          occurrenceKey: 'robot-occurrence',
          assetReferenceId: 'asset-robot',
          linkLocalPose: identityPose(),
          statistics: ZERO_STATISTICS,
          collisionBoxes: [],
        }],
      },
      { id: 'L1', name: 'Link 1', geometryOccurrences: [] },
    ],
    joints: [{
      id: 'J1',
      type: 'revolute',
      parentLinkId: 'L0',
      childLinkId: 'L1',
      origin: identityPose(),
      axis: [0, 0, 1],
      min: -180,
      max: 180,
      home: 0,
      zeroOffset: 0,
      direction: 1,
      maximumVelocity: 90,
    }],
    frames: [
      { id: 'Base', name: 'Base', parentFrameId: 'L0', localPose: identityPose(), role: 'base' },
      { id: 'Tool', name: 'Tool', parentFrameId: 'L1', localPose: identityPose(), role: 'tool' },
      { id: 'TCP', name: 'TCP', parentFrameId: 'Tool', localPose: identityPose(), role: 'tcp' },
    ],
    excludedGeometryOccurrenceKeys: [],
  }
}

function makeRobot(): RobotInstanceV5 {
  return {
    id: 'robot-1',
    name: 'Robot 1',
    definitionId: 'definition-1',
    serialNumber: 'ROBOT-SAMPLE-001',
    controllerId: 'controller-1',
    visible: true,
    baseParentFrameId: 'mcp',
    localBasePose: identityPose(),
    initialJointValues: { J1: 0 },
    jointSource: 'simulation',
    frameSources: { Base: 'simulation', Tool: 'simulation', TCP: 'simulation' },
    selectedToolFrameId: 'Tool',
    selectedTcpFrameId: 'TCP',
    numericStatus: {
      value: 0,
      sourceOwnership: 'simulation',
      overlay: { visible: false, frameId: null },
    },
    intentionalMountEntityId: null,
  }
}

export function cloneWorkcellProjectV5(project: WorkcellProjectV5): WorkcellProjectV5 {
  return structuredClone(project)
}

export function makeMinimalWorkcellProjectV5(): WorkcellProjectV5 {
  return {
    schemaVersion: 5,
    projectId: 'project-v5',
    revisionId: 'revision-1',
    metadata: {
      name: 'Minimal Project V5',
      createdAt: '2026-07-19T00:00:00.000Z',
      updatedAt: '2026-07-19T00:00:00.000Z',
    },
    assetReferences: [makeAssetReference()],
    scene: {
      frames: [
        { id: 'world', name: 'World', parentFrameId: null, localPose: identityPose(), role: 'world' },
        { id: 'mcp', name: 'MCP', parentFrameId: 'world', localPose: identityPose(), role: 'mcp' },
      ],
    },
    robotDefinitions: [makeRobotDefinition()],
    controllers: [{
      id: 'controller-1',
      name: 'Controller 1',
      identification: {
        manufacturer: 'ABB',
        model: 'OmniCore C90XT',
        productCode: '3HAC058893-001',
        serialNumber: 'CTRL-SAMPLE-001',
      },
    }],
    robots: [makeRobot()],
    spatialEntities: [],
    sceneGroups: [],
    logicalSignals: [{
      id: 'PartPresent',
      name: 'Part Present',
      dataType: 'Boolean',
      direction: 'input',
      initialValue: false,
      unit: '',
      scope: { type: 'project' },
    }],
    jobs: [{
      id: 'job-1',
      name: 'Home',
      robotId: 'robot-1',
      instructions: [{
        id: 'instruction-1',
        kind: 'move-joint',
        jointValues: { J1: 0 },
        speedPercentToNext: 100,
      }],
    }],
    opcUa: {
      mode: 'client',
      endpoints: [{
        endpointId: 'endpoint-1',
        name: 'Controller',
        endpointUrl: 'opc.tcp://localhost:4840',
        enabled: true,
        publishingIntervalMs: 100,
        reconnectDelayMs: 1_000,
      }],
      mappings: [{
        id: 'mapping-1',
        endpointId: 'endpoint-1',
        nodeAddress: {
          namespaceUri: 'urn:sample:plc',
          identifierType: 'string',
          identifier: 'Signals.PartPresent',
        },
        direction: 'read',
        coherenceGroupId: null,
        interpolationMode: 'none',
        coordinateConvention: 'project-v5-z-up-metres-quaternion-xyzw',
        leaves: [{
          leafPath: [],
          projectPath: [],
          projectTarget: { type: 'logical-signal', signalId: 'PartPresent' },
          opcUaDataType: 'Boolean',
          projectDataType: 'boolean',
          scale: 1,
          offset: 0,
          unit: '',
          required: true,
        }],
      }],
      bridgeRoutes: [],
    },
  }
}

export type ProjectV5LimitField =
  | 'logicalSignals'
  | 'opcUaMappings'
  | 'opcUaLeaves'
  | 'jobInstructions'

function signal(id: string): LogicalSignalV1 {
  return {
    id,
    name: id,
    dataType: 'Boolean',
    direction: 'input',
    initialValue: false,
    unit: '',
    scope: { type: 'project' },
  }
}

function mapping(
  id: string,
  endpointId: string,
  identifier: string,
  signalId: string,
  leaves: readonly OpcUaMappingV5['leaves'][number][],
): OpcUaMappingV5 {
  return {
    id,
    endpointId,
    nodeAddress: {
      namespaceUri: 'urn:sample:plc',
      identifierType: 'string',
      identifier,
    },
    direction: 'read',
    coherenceGroupId: null,
    interpolationMode: 'none',
    coordinateConvention: 'project-v5-z-up-metres-quaternion-xyzw',
    leaves: leaves.map((leaf) => ({
      ...leaf,
      projectTarget: { type: 'logical-signal', signalId },
    })),
  }
}

function logicalLeaf(leafPath: readonly (string | number)[] = []): OpcUaMappingV5['leaves'][number] {
  return {
    leafPath,
    projectPath: [],
    projectTarget: { type: 'logical-signal', signalId: 'PartPresent' },
    opcUaDataType: 'Boolean',
    projectDataType: 'boolean',
    scale: 1,
    offset: 0,
    unit: '',
    required: true,
  }
}

function ensureEndpoints(project: WorkcellProjectV5, count: number): void {
  const endpoints = project.opcUa.endpoints as unknown as Array<WorkcellProjectV5['opcUa']['endpoints'][number]>
  while (endpoints.length < count) {
    const index = endpoints.length + 1
    endpoints.push({
      endpointId: `endpoint-${index}`,
      name: `Endpoint ${index}`,
      endpointUrl: `opc.tcp://localhost:${4840 + index}`,
      enabled: true,
      publishingIntervalMs: 100,
      reconnectDelayMs: 1_000,
    })
  }
}

export function projectV5AtLimit(field: ProjectV5LimitField, count: number): WorkcellProjectV5 {
  const project = cloneWorkcellProjectV5(makeMinimalWorkcellProjectV5())
  if (field === 'logicalSignals') {
    ;(project.logicalSignals as unknown as LogicalSignalV1[]).splice(
      0,
      project.logicalSignals.length,
      ...Array.from({ length: count }, (_, index) => signal(index === 0 ? 'PartPresent' : `Signal-${index + 1}`)),
    )
    return project
  }
  if (field === 'opcUaMappings') {
    const endpointCount = Math.ceil(count / 64)
    ensureEndpoints(project, endpointCount)
    const signals = Array.from({ length: count }, (_, index) => signal(index === 0 ? 'PartPresent' : `Signal-${index + 1}`))
    ;(project.logicalSignals as unknown as LogicalSignalV1[]).splice(0, project.logicalSignals.length, ...signals)
    ;(project.opcUa.mappings as unknown as OpcUaMappingV5[]).splice(
      0,
      project.opcUa.mappings.length,
      ...Array.from({ length: count }, (_, index) => {
        const endpointIndex = Math.floor(index / 64) + 1
        return mapping(
          `mapping-${index + 1}`,
          `endpoint-${endpointIndex}`,
          `Signals.${index + 1}`,
          index === 0 ? 'PartPresent' : `Signal-${index + 1}`,
          [logicalLeaf()],
        )
      }),
    )
    return project
  }
  if (field === 'opcUaLeaves') {
    const mappingCount = Math.ceil(count / 32)
    const endpointCount = Math.ceil(mappingCount / 16)
    ensureEndpoints(project, endpointCount)
    const signals = Array.from({ length: mappingCount }, (_, index) => signal(index === 0 ? 'PartPresent' : `Signal-${index + 1}`))
    ;(project.logicalSignals as unknown as LogicalSignalV1[]).splice(0, project.logicalSignals.length, ...signals)
    let remaining = count
    const mappings: OpcUaMappingV5[] = []
    for (let index = 0; index < mappingCount; index += 1) {
      const leafCount = Math.min(remaining, 32)
      remaining -= leafCount
      const endpointIndex = Math.floor(index / 16) + 1
      mappings.push(mapping(
        `mapping-${index + 1}`,
        `endpoint-${endpointIndex}`,
        `Signals.${index + 1}`,
        index === 0 ? 'PartPresent' : `Signal-${index + 1}`,
        Array.from({ length: leafCount }, (_, leafIndex) => logicalLeaf([leafIndex])),
      ))
    }
    ;(project.opcUa.mappings as unknown as OpcUaMappingV5[]).splice(0, project.opcUa.mappings.length, ...mappings)
    return project
  }

  const jobs: WorkcellProjectV5['jobs'][number][] = []
  let remaining = count
  let instructionIndex = 1
  while (remaining > 0) {
    const jobInstructionCount = Math.min(remaining, 256)
    remaining -= jobInstructionCount
    const instructions: RobotJobInstructionV1[] = Array.from({ length: jobInstructionCount }, () => ({
      id: `instruction-${instructionIndex++}`,
      kind: 'move-joint',
      jointValues: { J1: 0 },
      speedPercentToNext: 100,
    }))
    jobs.push({
      id: `job-${jobs.length + 1}`,
      name: `Job ${jobs.length + 1}`,
      robotId: 'robot-1',
      instructions,
    })
  }
  ;(project.jobs as unknown as WorkcellProjectV5['jobs'][number][]).splice(0, project.jobs.length, ...jobs)
  return project
}

export function projectWithInstructionSignalV5(
  kind: 'set-do' | 'wait-di',
  direction: LogicalSignalV1['direction'],
): WorkcellProjectV5 {
  const project = cloneWorkcellProjectV5(makeMinimalWorkcellProjectV5())
  const projectSignal = project.logicalSignals[0] as unknown as { direction: LogicalSignalV1['direction'] }
  projectSignal.direction = direction
  const instruction: RobotJobInstructionV1 = kind === 'set-do'
    ? { id: 'instruction-1', kind, signalId: 'PartPresent', value: true }
    : { id: 'instruction-1', kind, signalId: 'PartPresent', expected: true, timeoutMs: 1_000 }
  ;(project.jobs[0]!.instructions as unknown as RobotJobInstructionV1[]).splice(0, 1, instruction)
  return project
}

export function projectWithMissingMoveJointV5(jointId: string): WorkcellProjectV5 {
  const project = cloneWorkcellProjectV5(makeMinimalWorkcellProjectV5())
  const definition = project.robotDefinitions[0]!
  ;(definition.links as unknown as RobotDefinitionV5['links'][number][]).push({
    id: 'L2',
    name: 'Link 2',
    geometryOccurrences: [],
  })
  ;(definition.joints as unknown as RobotDefinitionV5['joints'][number][]).push({
    id: jointId,
    type: 'revolute',
    parentLinkId: 'L1',
    childLinkId: 'L2',
    origin: identityPose(),
    axis: [0, 0, 1],
    min: -180,
    max: 180,
    home: 0,
    zeroOffset: 0,
    direction: 1,
    maximumVelocity: 90,
  })
  const initialJointValues = project.robots[0]!.initialJointValues as unknown as Record<string, number>
  initialJointValues[jointId] = 0
  return project
}
