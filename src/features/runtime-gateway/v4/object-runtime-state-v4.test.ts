import { describe, expect, it } from 'vitest'

import { makeMinimalWorkcellProjectV4 } from '../../../core/project-v4/test-support.js'
import { validateWorkcellProjectV4, type WorkcellProjectV4 } from '../../../core/project-v4/index.js'
import type { StateBatchV1 } from '../../../core/runtime-protocol/v1.js'
import { createObjectRuntimeStateV4 } from './object-runtime-state-v4.js'

const REVISION = 'b'.repeat(64)
const ENDPOINT_ID = 'endpoint-objects'

function entity(
  id: string,
  geometry: WorkcellProjectV4['spatialEntities'][number]['geometry'],
) {
  const frameId = `${id}-motion`
  return {
    id,
    name: id,
    geometry,
    parentFrameId: frameId,
    localPose: { positionM: [0, 0, 0] as const, quaternion: [0, 0, 0, 1] as const },
    visible: true,
    groupId: null,
    removable: true,
    transformOwner: `opcua:${ENDPOINT_ID}` as const,
    numericStatus: {
      value: 0,
      sourceOwnership: `opcua:${ENDPOINT_ID}` as const,
      overlay: { visible: true, frameId: null },
    },
    graspable: false,
    graspFrames: [],
    movingFrames: [{
      frameId,
      name: `${id} motion`,
      parentFrameId: 'world',
      localPose: { positionM: [0, 0, 0] as const, quaternion: [0, 0, 0, 1] as const },
      sourceOwnership: `opcua:${ENDPOINT_ID}` as const,
    }],
  }
}

function mappedProject(): WorkcellProjectV4 {
  const base = makeMinimalWorkcellProjectV4()
  const entities = [
    entity('box-live', { kind: 'box', dimensionsM: [1, 1, 1], color: '#808080' }),
    entity('cylinder-live', { kind: 'cylinder', radiusM: 0.5, heightM: 1, axis: 'z', radialSegments: 32, color: '#808080' }),
    entity('step-live', {
      kind: 'asset',
      assetReferenceId: 'asset-step-live',
      occurrenceKey: 'step-live-occurrence',
      sourceConvention: {
        linearUnit: 'meter',
        sourceToMeters: 1,
        orientation: { mode: 'up-axis', upAxis: 'z' },
      },
      originMode: 'source',
      statistics: { triangles: 12, vertices: 8, meshes: 1, materials: 1 },
      collisionBoxes: [],
    }),
  ]
  const poseMapping = (entityId: string) => ({
    id: `mapping-${entityId}`,
    endpointId: ENDPOINT_ID,
    direction: 'read' as const,
    publishingIntervalMs: 100,
    coherenceGroupId: `${entityId}-pose`,
    sourceOwnership: `opcua:${ENDPOINT_ID}` as const,
    interpolationMode: 'shortest-quaternion' as const,
    coordinateConvention: 'project-v4-z-up-metres-quaternion-xyzw' as const,
    leaves: [
      ['positionM', 0, 'X'], ['positionM', 1, 'Y'], ['positionM', 2, 'Z'],
      ['rpyDegrees', 0, 'Roll'], ['rpyDegrees', 1, 'Pitch'], ['rpyDegrees', 2, 'Yaw'],
    ].map(([root, index, suffix]) => ({
      leafPath: [root as string, index as number],
      nodeId: `ns=2;s=${entityId}/${suffix}`,
      projectTarget: { type: 'entity-frame' as const, entityId, frameId: `${entityId}-motion` },
      opcUaDataType: 'Double' as const,
      projectDataType: 'number' as const,
      scale: 1,
      offset: 0,
      unit: root === 'positionM' ? 'metre' : 'degree',
      required: true,
    })),
  })
  return validateWorkcellProjectV4({
    ...base,
    revisionId: REVISION,
    assetReferences: [...base.assetReferences, {
      id: 'asset-step-live',
      uri: 'asset://local/step-live.step',
      byteLength: 1,
      sha256: 'c'.repeat(64),
      sourceFileName: 'step-live.step',
      mediaType: 'model/step',
    }],
    spatialEntities: entities,
    opcUa: {
      mode: 'client',
      endpoints: [{
        endpointId: ENDPOINT_ID,
        name: 'Objects',
        endpointUrl: 'opc.tcp://127.0.0.1:4840',
        enabled: true,
        publishingIntervalMs: 100,
        reconnectDelayMs: 1_000,
      }],
      mappings: [
        ...entities.map(({ id }) => poseMapping(id)),
        {
          id: 'mapping-box-status',
          endpointId: ENDPOINT_ID,
          direction: 'read',
          publishingIntervalMs: 100,
          coherenceGroupId: null,
          sourceOwnership: `opcua:${ENDPOINT_ID}`,
          interpolationMode: 'none',
          coordinateConvention: 'project-v4-z-up-metres-quaternion-xyzw',
          leaves: [{
            leafPath: [],
            nodeId: 'ns=2;s=box-live/Status',
            projectTarget: { type: 'entity-status', entityId: 'box-live' },
            opcUaDataType: 'Double',
            projectDataType: 'number',
            scale: 1,
            offset: 0,
            unit: 'number',
            required: true,
          }],
        },
      ],
      actionBindings: [],
      bridgeRoutes: [],
    },
  })
}

function poseValue(mappingId: string, x: number, quality: 'GOOD' | 'UNCERTAIN' | 'BAD' = 'GOOD') {
  return {
    mappingId,
    coherenceGroupId: `${mappingId.slice('mapping-'.length)}-pose`,
    value: { positionM: [x, 0, 0], quaternion: [0, 0, 0, 1] },
    unit: 'project-v4-z-up-metres-quaternion-xyzw',
    quality,
    statusCode: quality === 'BAD' ? 'BadNoCommunication' : quality === 'UNCERTAIN' ? 'UncertainInitialValue' : 'Good',
  } as const
}

function batch(
  sequence: number,
  values: StateBatchV1['values'],
  overrides: Partial<StateBatchV1> = {},
): StateBatchV1 {
  return {
    type: 'state-batch-v1',
    protocolVersion: 1,
    gatewayId: 'gateway-test',
    projectId: 'project-v4',
    configRevision: REVISION,
    endpointId: ENDPOINT_ID,
    sequence,
    sourceTimestampMs: 1_000 + sequence * 100,
    publishedTimestampMs: 5_000 + sequence * 100,
    originId: 'gateway-test:client',
    values,
    ...overrides,
  }
}

describe('ObjectRuntimeStateV4', () => {
  it('uses one geometry-neutral pose path for box, cylinder, and imported STEP entities', () => {
    const runtime = createObjectRuntimeStateV4(mappedProject())
    expect(runtime.bindingKeys()).toEqual([
      'box-live:box-live-motion',
      'cylinder-live:cylinder-live-motion',
      'step-live:step-live-motion',
    ])

    expect(runtime.ingest(batch(1, [
      poseValue('mapping-box-live', 1),
      poseValue('mapping-cylinder-live', 2),
      poseValue('mapping-step-live', 3),
    ]), 5_100)).toBe(true)

    expect(runtime.sampleEntityFrame('box-live', 'box-live-motion', 5_100)?.pose.positionM).toEqual([1, 0, 0])
    expect(runtime.sampleEntityFrame('cylinder-live', 'cylinder-live-motion', 5_100)?.pose.positionM).toEqual([2, 0, 0])
    expect(runtime.sampleEntityFrame('step-live', 'step-live-motion', 5_100)?.pose.positionM).toEqual([3, 0, 0])
  })

  it('keeps the latest GOOD pose on BAD and exposes quality without mutating the pose buffer', () => {
    const runtime = createObjectRuntimeStateV4(mappedProject())
    runtime.ingest(batch(1, [poseValue('mapping-box-live', 1)]), 5_100)
    runtime.ingest(batch(2, [poseValue('mapping-box-live', 99, 'BAD')]), 5_200)

    const result = runtime.sampleEntityFrame('box-live', 'box-live-motion', 5_200)
    expect(result?.pose.positionM).toEqual([1, 0, 0])
    expect(result?.quality).toBe('BAD')
    expect(result?.statusCode).toBe('BadNoCommunication')
  })

  it('accepts UNCERTAIN poses, rejects delayed endpoint sequence, and never rewinds', () => {
    const runtime = createObjectRuntimeStateV4(mappedProject())
    expect(runtime.ingest(batch(2, [poseValue('mapping-box-live', 2, 'UNCERTAIN')]), 5_200)).toBe(true)
    expect(runtime.ingest(batch(1, [poseValue('mapping-box-live', 1)]), 5_300)).toBe(false)

    const result = runtime.sampleEntityFrame('box-live', 'box-live-motion', 5_200)
    expect(result?.pose.positionM).toEqual([2, 0, 0])
    expect(result?.quality).toBe('UNCERTAIN')
  })

  it('retains the latest numeric Object Status on BAD and isolates unknown mappings', () => {
    const runtime = createObjectRuntimeStateV4(mappedProject())
    const goodStatus = {
      mappingId: 'mapping-box-status', coherenceGroupId: null, value: 42,
      unit: 'number', quality: 'GOOD' as const, statusCode: 'Good',
    }
    const badStatus = { ...goodStatus, value: 99, quality: 'BAD' as const, statusCode: 'BadNoCommunication' }
    expect(runtime.ingest(batch(1, [goodStatus]), 5_100)).toBe(true)
    expect(runtime.ingest(batch(2, [badStatus]), 5_200)).toBe(true)

    expect(runtime.readEntityStatus('box-live', 5_200)).toEqual(expect.objectContaining({
      value: 42,
      quality: 'BAD',
      statusCode: 'BadNoCommunication',
    }))
    expect(runtime.ingest(batch(3, [{ ...goodStatus, mappingId: 'mapping-unknown' }]), 5_300)).toBe(false)
  })

  it('marks a retained pose STALE after the interpolation freshness window', () => {
    const runtime = createObjectRuntimeStateV4(mappedProject())
    runtime.ingest(batch(1, [poseValue('mapping-box-live', 1)]), 5_100)

    expect(runtime.sampleEntityFrame('box-live', 'box-live-motion', 5_601)?.quality).toBe('STALE')
  })

  it('drops batches for another Project, Revision, or Endpoint', () => {
    const runtime = createObjectRuntimeStateV4(mappedProject())
    expect(runtime.ingest(batch(1, [poseValue('mapping-box-live', 1)], { projectId: 'other' }), 5_100)).toBe(false)
    expect(runtime.ingest(batch(1, [poseValue('mapping-box-live', 1)], { configRevision: 'd'.repeat(64) }), 5_100)).toBe(false)
    expect(runtime.ingest(batch(1, [poseValue('mapping-box-live', 1)], { endpointId: 'endpoint-other' }), 5_100)).toBe(false)
  })
})
