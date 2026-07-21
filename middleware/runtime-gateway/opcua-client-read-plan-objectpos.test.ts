import { describe, expect, it } from 'vitest'

import { makeMinimalWorkcellProjectV5 } from '../../src/core/project-v5/test-support.js'
import { validateWorkcellProjectV5 } from '../../src/core/project-v5/index.js'
import {
  compileOpcUaClientReadPlanV1,
} from './opcua-client-read-plan.js'
import { createOpcUaClientSnapshotAssemblerV1 } from './opcua-client-adapter.js'
import type { UnsequencedOpcUaClientSnapshotV1 } from './opcua-client-adapter.js'

function objectPosProject() {
  const base = makeMinimalWorkcellProjectV5()
  const endpointId = 'endpoint-object-pos'
  const entityId = 'box-object-pos-00'
  const frameId = 'frame-object-pos-00'
  const nodeFields = ['X', 'Y', 'Z', 'Roll', 'Pitch', 'Yaw'] as const
  const projectPaths = [
    ['positionM', 0], ['positionM', 1], ['positionM', 2],
    ['rpyDegrees', 0], ['rpyDegrees', 1], ['rpyDegrees', 2],
  ] as const
  const target = { type: 'entity-frame' as const, entityId, frameId }
  const nodeAddress = (field: string) => ({
    namespaceUri: 'http://br-automation.com/OpcUa/PLC/PV/',
    identifierType: 'string' as const,
    identifier: `::Sample6X:ObjectPos[0].${field}`,
  })
  return validateWorkcellProjectV5({
    ...base,
    spatialEntities: [{
      id: entityId,
      name: 'ObjectPos[0]',
      geometry: { kind: 'box', dimensionsM: [0.2, 0.2, 0.2], color: '#2dd4bf' },
      parentFrameId: frameId,
      localPose: { positionM: [0, 0, 0], quaternion: [0, 0, 0, 1] },
      visible: true,
      groupId: null,
      removable: true,
      transformOwner: `opcua:${endpointId}`,
      numericStatus: {
        value: 0,
        sourceOwnership: 'manual',
        overlay: { visible: false, frameId: null },
      },
      graspable: false,
      graspFrames: [],
      movingFrames: [{
        frameId,
        name: 'ObjectPos[0] Frame',
        parentFrameId: 'mcp',
        localPose: { positionM: [0, 0, 0], quaternion: [0, 0, 0, 1] },
        sourceOwnership: `opcua:${endpointId}`,
      }],
    }],
    opcUa: {
      ...base.opcUa,
      endpoints: [
        ...base.opcUa.endpoints,
        {
          endpointId,
          name: 'ObjectPos',
          endpointUrl: 'opc.tcp://127.0.0.1:4840',
          enabled: true,
          publishingIntervalMs: 100,
          reconnectDelayMs: 1_000,
        },
      ],
      mappings: [
        ...base.opcUa.mappings,
        {
          id: 'mapping-object-pos-00',
          endpointId,
          nodeAddress: nodeAddress('X'),
          direction: 'read' as const,
          coherenceGroupId: 'entity:box-object-pos-00:pose',
          interpolationMode: 'shortest-quaternion' as const,
          coordinateConvention: 'project-v5-z-up-metres-quaternion-xyzw' as const,
          leaves: nodeFields.map((field, index) => ({
            leafPath: [index],
            nodeAddress: nodeAddress(field),
            projectPath: projectPaths[index]!,
            projectTarget: target,
            opcUaDataType: 'Double' as const,
            projectDataType: 'number' as const,
            scale: 1,
            offset: 0,
            unit: index < 3 ? 'metre' : 'degree',
            required: true,
          })),
        },
      ],
    },
  })
}

describe('OPC UA ObjectPos scalar-root assembly', () => {
  it('monitors six distinct roots and assembles one entity pose', () => {
    const project = objectPosProject()
    const plan = compileOpcUaClientReadPlanV1(project).find(({ endpointId }) => endpointId === 'endpoint-object-pos')!
    expect(plan.monitoredRoots).toHaveLength(6)

    const assembler = createOpcUaClientSnapshotAssemblerV1({ project, endpoint: plan })
    const values = [1, 2, 3, 0, 0, 90]
    let snapshot: UnsequencedOpcUaClientSnapshotV1 | null = null
    plan.monitoredRoots.forEach((root, index) => {
      snapshot = assembler.accept(root.rootKey, values[index], 'Good (0x00000000)', 100 + index)
    })

    expect(snapshot).not.toBeNull()
    const completeSnapshot = snapshot!
    expect(completeSnapshot.values).toHaveLength(1)
    expect(completeSnapshot.values[0]).toMatchObject({
      mappingId: 'mapping-object-pos-00',
      quality: 'GOOD',
      value: {
        positionM: [1, 2, 3],
      },
    })
    const quaternion = completeSnapshot.values[0]?.value
    expect(quaternion).toMatchObject({ quaternion: [0, 0, expect.closeTo(Math.SQRT1_2, 1e-12), expect.closeTo(Math.SQRT1_2, 1e-12)] })
  })
})
