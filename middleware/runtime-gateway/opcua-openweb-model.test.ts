// @vitest-environment node

import { DataType, OPCUAServer } from 'node-opcua'
import { afterEach, describe, expect, it } from 'vitest'

import type { RigidTransformV5, WorkcellProjectV5 } from '../../src/core/project-v5/index.js'
import type { CommandResultV1 } from '../../src/core/runtime-protocol/v1.js'
import { makeMinimalWorkcellProjectV5 } from '../../src/core/project-v5/test-support.js'
import {
  OPENWEB_INSTANCES_NAMESPACE_URI_V1,
  OPENWEB_MODEL_NAMESPACE_URI_V1,
  instantiateOpcUaOpenWebModelV1,
  type OpenWebDiagnosticsSnapshotV1,
  type ServerActualSnapshotV1,
} from './opcua-openweb-model.js'

const CONFIG_REVISION = 'a'.repeat(64)

const POSE_A: RigidTransformV5 = Object.freeze({
  positionM: [0.1, 0.2, 0.3],
  quaternion: [0, 0, 0, 1],
})

const POSE_B: RigidTransformV5 = Object.freeze({
  positionM: [0.4, 0.5, 0.6],
  quaternion: [0.1, 0.2, 0.3, 0.9],
})

function project(): WorkcellProjectV5 {
  const source = makeMinimalWorkcellProjectV5()
  return {
    ...source,
    projectId: 'project-openweb',
    revisionId: 'revision-openweb',
    spatialEntities: [{
      id: 'box',
      name: 'Box',
      geometry: { kind: 'box', dimensionsM: [0.1, 0.1, 0.1], color: '#808080' },
      parentFrameId: 'mcp',
      localPose: POSE_A,
      visible: true,
      groupId: null,
      removable: true,
      transformOwner: 'simulation',
      numericStatus: {
        value: 0,
        sourceOwnership: 'simulation',
        overlay: { visible: false, frameId: null },
      },
      graspable: false,
      graspFrames: [],
      movingFrames: [],
    }],
  }
}

function snapshot(objectPose: RigidTransformV5 = POSE_A): ServerActualSnapshotV1 {
  return {
    projectId: 'project-openweb',
    revisionId: 'revision-openweb',
    configRevision: CONFIG_REVISION,
    robots: { 'robot-1': { J1: 12.5 } },
    sceneObjects: {
      box: {
        pose: objectPose,
        status: 7,
        color: '#123456',
        quality: 'GOOD',
        sourceTimestampMs: 1_000,
        publishedTimestampMs: 1_050,
      },
    },
    logicalSignals: {
      PartPresent: {
        value: true,
        quality: 'GOOD',
        statusCode: 'Good',
        sourceTimestampMs: 1_000,
        publishedTimestampMs: 1_050,
      },
    },
    jobs: { 'job-1': { state: 'running', stepIndex: 2, failureCode: null } },
    attachments: { box: { state: 'attached', parentFrameId: 'robot-1:Tool' } },
  }
}

function diagnostics(): OpenWebDiagnosticsSnapshotV1 {
  return {
    leaseGeneration: 4,
    leaseExpiresAtMs: 2_000,
    lastCommand: commandResult(),
    gateway: {
      mode: 'server',
      standardNodeSets: 'loaded',
      roboticsModel: 'ready',
      productModel: 'ready',
      endpointUrl: 'opc.tcp://127.0.0.1:4841',
      lastError: null,
    },
    endpoints: {
      plc: { phase: 'connected', lastError: null },
    },
  }
}

function commandResult(): CommandResultV1 {
  return {
      type: 'command-result-v1',
      protocolVersion: 1,
      projectId: 'project-openweb',
      configRevision: CONFIG_REVISION,
      leaseGeneration: 4,
      targetId: 'box',
      commandId: 'request-1',
      acknowledgement: 'ACCEPTED',
      executionState: 'SUCCEEDED',
      failureCode: null,
      message: 'Object command completed.',
      attachedObjectId: null,
      completedAt: 1_500,
  }
}

describe('OpenWebDigitalTwin OPC UA product model V1', () => {
  const servers: OPCUAServer[] = []

  afterEach(async () => {
    await Promise.all(servers.splice(0).map((server) => server.shutdown(0)))
  })

  async function startModel() {
    const server = new OPCUAServer({ port: 0 })
    servers.push(server)
    await server.initialize()
    const addressSpace = server.engine.addressSpace
    if (addressSpace === null) throw new Error('OPC_UA_ADDRESS_SPACE_UNAVAILABLE')
    const modelNamespace = addressSpace.registerNamespace(OPENWEB_MODEL_NAMESPACE_URI_V1)
    const instancesNamespace = addressSpace.registerNamespace(OPENWEB_INSTANCES_NAMESPACE_URI_V1)
    return {
      addressSpace,
      instancesNamespace,
      model: instantiateOpcUaOpenWebModelV1({
        addressSpace,
        modelNamespace,
        instancesNamespace,
        project: project(),
        configRevision: CONFIG_REVISION,
      }),
    }
  }

  it('creates separate Actual, Command, Result, and Diagnostics branches', async () => {
    const { model } = await startModel()

    expect(model.rootChildren()).toEqual(['Actual', 'Command', 'Result', 'Diagnostics'])
    expect(model.actualChildren()).toEqual(['SceneObjects', 'LogicalSignals', 'Jobs', 'Attachments'])
    expect(model.commandChildren()).toEqual([
      'RobotJointTargets', 'SceneObjects', 'LogicalSignals', 'Jobs',
    ])
  })

  it('does not create a product NodeId in an OPC Foundation namespace', async () => {
    const { model } = await startModel()

    expect(model.productNodeIds().every(({ namespaceUri }) => (
      namespaceUri === OPENWEB_MODEL_NAMESPACE_URI_V1
      || namespaceUri === OPENWEB_INSTANCES_NAMESPACE_URI_V1
    ))).toBe(true)
  })

  it('publishes Object Actual pose as one coherent snapshot', async () => {
    const { model } = await startModel()

    model.publishSnapshot(snapshot(POSE_A))
    expect(model.readActualObjectPose('box')).toEqual(POSE_A)

    model.publishSnapshot(snapshot(POSE_B))
    expect(model.readActualObjectPose('box')).toEqual(POSE_B)
  })

  it('retains the last coherent Object pose when a replacement pose is invalid', async () => {
    const { model } = await startModel()
    model.publishSnapshot(snapshot(POSE_A))
    const invalidPose = {
      positionM: [Number.NaN, POSE_B.positionM[1], POSE_B.positionM[2]],
      quaternion: POSE_B.quaternion,
    } as unknown as RigidTransformV5

    expect(() => model.publishSnapshot(snapshot(invalidPose))).toThrow('OPC_UA_OPENWEB_POSE_INVALID')
    expect(model.readActualObjectPose('box')).toEqual(POSE_A)
  })

  it('exposes typed staged command fields without dispatching a command', async () => {
    const { model } = await startModel()
    const object = model.commandFields.sceneObjects.box!
    const robot = model.commandFields.robotJointTargets['robot-1']!

    expect(object.requestId.readValue().value.dataType).toBe(DataType.String)
    expect(object.expiresAt.readValue().value.dataType).toBe(DataType.DateTime)
    expect(object.execute.readValue().value.dataType).toBe(DataType.Boolean)
    expect(object.payload.X.readValue().value.dataType).toBe(DataType.Double)
    expect(object.payload.Roll.readValue().value.dataType).toBe(DataType.Double)
    expect(robot.payload.J1!.readValue().value.dataType).toBe(DataType.Double)
  })

  it('publishes Result records and diagnostics updates as read-only product state', async () => {
    const { model } = await startModel()

    model.publishResult(diagnostics().lastCommand!)
    model.updateDiagnostics(diagnostics())

    expect(model.readResult('request-1')).toEqual(commandResult())
    expect(model.readDiagnostics()).toMatchObject(diagnostics())
    expect(model.readDiagnostics().revisionId).toBe('revision-openweb')
    expect(model.readDiagnostics().configRevision).toBe(CONFIG_REVISION)
  })

  it('cleans up idempotently and rejects publication after disposal', async () => {
    const { addressSpace, model } = await startModel()

    model.dispose()

    expect(addressSpace.findNode(model.rootNodeId)).toBeNull()
    expect(() => model.publishSnapshot(snapshot())).toThrow('OPC_UA_OPENWEB_MODEL_DISPOSED')
    expect(() => model.dispose()).not.toThrow()
  })
})
