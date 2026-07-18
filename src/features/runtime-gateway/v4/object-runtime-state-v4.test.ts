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

  it('keeps BAD ahead of STALE while recent invalid receipts prove the connection is alive', () => {
    const runtime = createObjectRuntimeStateV4(mappedProject())
    expect(runtime.ingest(batch(1, [poseValue('mapping-box-live', 1)]), 5_100)).toBe(true)
    expect(runtime.ingest(batch(2, [{
      ...poseValue('mapping-box-live', 2),
      value: { positionM: [2, 0, 'invalid'], quaternion: [0, 0, 0, 1] },
    }]), 5_900)).toBe(true)

    expect(runtime.sampleEntityFrame('box-live', 'box-live-motion', 6_500)).toEqual(expect.objectContaining({
      pose: expect.objectContaining({ positionM: [1, 0, 0] }),
      quality: 'BAD',
      statusCode: 'BadTypeMismatch',
    }))
    expect(runtime.sampleEntityFrame('box-live', 'box-live-motion', 6_901)).toEqual(expect.objectContaining({
      quality: 'STALE',
      statusCode: 'BadNoCommunication',
    }))
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

  it('uses the endpoint interval for omitted mappings and keeps BAD status fresh for at least one second', () => {
    const source = mappedProject()
    const project = validateWorkcellProjectV4({
      ...source,
      opcUa: {
        ...source.opcUa,
        mappings: source.opcUa.mappings.map((mapping) => (
          mapping.id === 'mapping-box-status'
            ? (() => {
                const { publishingIntervalMs: _publishingIntervalMs, ...withoutInterval } = mapping
                return withoutInterval
              })()
            : mapping
        )),
      },
    })
    const runtime = createObjectRuntimeStateV4(project)
    const status = {
      mappingId: 'mapping-box-status', coherenceGroupId: null, value: 42,
      unit: 'number', quality: 'GOOD' as const, statusCode: 'Good',
    }
    expect(runtime.ingest(batch(1, [status]), 5_100)).toBe(true)
    expect(runtime.ingest(batch(2, [{
      ...status,
      value: 'not-a-number',
      statusCode: 'BadTypeMismatch',
    }]), 5_900)).toBe(true)

    expect(runtime.readEntityStatus('box-live', 6_500)).toEqual(expect.objectContaining({
      value: 42,
      quality: 'BAD',
      statusCode: 'BadTypeMismatch',
    }))
    expect(runtime.readEntityStatus('box-live', 6_901)).toEqual(expect.objectContaining({
      quality: 'STALE',
      statusCode: 'BadNoCommunication',
    }))
  })

  it('clears endpoint sequence and interpolation state when the gateway opens a new session', () => {
    const runtime = createObjectRuntimeStateV4(mappedProject())
    expect(runtime.ingest(batch(10, [poseValue('mapping-box-live', 10)]), 5_100)).toBe(true)
    runtime.resetGatewaySession()

    expect(runtime.ingest(batch(1, [poseValue('mapping-box-live', 1)]), 5_200)).toBe(true)
    expect(runtime.sampleEntityFrame('box-live', 'box-live-motion', 5_200)?.pose.positionM)
      .toEqual([1, 0, 0])
  })

  it('marks a retained pose STALE after the interpolation freshness window', () => {
    const runtime = createObjectRuntimeStateV4(mappedProject())
    runtime.ingest(batch(1, [poseValue('mapping-box-live', 1)]), 5_100)

    expect(runtime.sampleEntityFrame('box-live', 'box-live-motion', 6_101)?.quality).toBe('STALE')
  })

  it('keeps Pose and Status freshness clocks independent while only Status continues to update', () => {
    const runtime = createObjectRuntimeStateV4(mappedProject())
    const status = {
      mappingId: 'mapping-box-status', coherenceGroupId: null, value: 42,
      unit: 'number', quality: 'GOOD' as const, statusCode: 'Good',
    }
    expect(runtime.ingest(batch(1, [poseValue('mapping-box-live', 1), status]), 5_000)).toBe(true)
    expect(runtime.ingest(batch(2, [{ ...status, value: 43 }]), 5_100)).toBe(true)
    expect(runtime.ingest(batch(3, [{ ...status, value: 44 }]), 5_200)).toBe(true)
    expect(runtime.ingest(batch(4, [{ ...status, value: 45 }]), 5_300)).toBe(true)

    expect(runtime.sampleEntityFrame('box-live', 'box-live-motion', 6_001))
      .toEqual(expect.objectContaining({ quality: 'STALE', statusCode: 'BadNoCommunication' }))
    expect(runtime.readEntityStatus('box-live', 6_001))
      .toEqual(expect.objectContaining({ value: 45, quality: 'GOOD', statusCode: 'Good' }))
  })

  it('drops batches for another Project, Revision, or Endpoint', () => {
    const runtime = createObjectRuntimeStateV4(mappedProject())
    expect(runtime.ingest(batch(1, [poseValue('mapping-box-live', 1)], { projectId: 'other' }), 5_100)).toBe(false)
    expect(runtime.ingest(batch(1, [poseValue('mapping-box-live', 1)], { configRevision: 'd'.repeat(64) }), 5_100)).toBe(false)
    expect(runtime.ingest(batch(1, [poseValue('mapping-box-live', 1)], { endpointId: 'endpoint-other' }), 5_100)).toBe(false)
  })

  it('accepts a canonical config revision for a UUID Project revision and rejects the UUID as a protocol fence', () => {
    const configRevision = 'c'.repeat(64)
    const project = validateWorkcellProjectV4({
      ...mappedProject(),
      revisionId: '6f0e1d43-1bd3-4c89-a811-3d8681e44773',
    })
    const runtime = createObjectRuntimeStateV4(project, configRevision)
    expect(runtime.ingest(batch(1, [poseValue('mapping-box-live', 1)], {
      configRevision,
    }), 5_100)).toBe(true)
    expect(runtime.ingest(batch(2, [poseValue('mapping-box-live', 2)], {
      configRevision: project.revisionId,
    }), 5_200)).toBe(false)
  })

  it('does not compile retained client mappings while the Project mode is off or server', () => {
    const project = mappedProject()
    for (const mode of ['off', 'server'] as const) {
      const runtime = createObjectRuntimeStateV4(validateWorkcellProjectV4({
        ...project,
        opcUa: { ...project.opcUa, mode },
      }))
      expect(runtime.bindingKeys()).toEqual([])
      expect(runtime.ingest(batch(1, [poseValue('mapping-box-live', 1)]), 5_100)).toBe(false)
    }
  })

  it('requires exactly one canonical owned pose mapping for an Entity Frame', () => {
    const project = mappedProject()
    const source = project.opcUa.mappings.find(({ id }) => id === 'mapping-box-live')!
    const duplicate = {
      ...source,
      id: 'mapping-box-live-duplicate',
      leaves: source.leaves.map((leaf, index) => ({
        ...leaf,
        nodeId: `ns=2;s=duplicate/${index}`,
      })),
    }
    const runtime = createObjectRuntimeStateV4(validateWorkcellProjectV4({
      ...project,
      opcUa: { ...project.opcUa, mappings: [...project.opcUa.mappings, duplicate] },
    }))

    expect(runtime.bindingKeys()).not.toContain('box-live:box-live-motion')
    expect(runtime.bindingKeys()).toContain('cylinder-live:cylinder-live-motion')
  })

  it('does not replace retained pose quality with a newer wire sequence carrying an older source timestamp', () => {
    const runtime = createObjectRuntimeStateV4(mappedProject())
    expect(runtime.ingest(batch(1, [poseValue('mapping-box-live', 1)]), 5_100)).toBe(true)
    expect(runtime.ingest(batch(2, [poseValue('mapping-box-live', 2, 'UNCERTAIN')], {
      sourceTimestampMs: 999,
    }), 5_200)).toBe(false)

    expect(runtime.sampleEntityFrame('box-live', 'box-live-motion', 5_200)).toEqual(expect.objectContaining({
      quality: 'GOOD',
      statusCode: 'Good',
      pose: expect.objectContaining({ positionM: [1, 0, 0] }),
    }))
  })

  it('holds the last valid Object pose and Status through a gateway session reset until a fresh baseline arrives', () => {
    const runtime = createObjectRuntimeStateV4(mappedProject())
    const status = {
      mappingId: 'mapping-box-status', coherenceGroupId: null, value: 42,
      unit: 'number', quality: 'GOOD' as const, statusCode: 'Good',
    }
    expect(runtime.ingest(batch(10, [poseValue('mapping-box-live', 10), status]), 5_100)).toBe(true)

    runtime.resetGatewaySession()

    expect(runtime.sampleEntityFrame('box-live', 'box-live-motion', 5_200)).toEqual(expect.objectContaining({
      pose: expect.objectContaining({ positionM: [10, 0, 0] }),
      quality: 'STALE',
      statusCode: 'BadNoCommunication',
    }))
    expect(runtime.readEntityStatus('box-live', 5_200)).toEqual(expect.objectContaining({
      value: 42,
      quality: 'STALE',
      statusCode: 'BadNoCommunication',
    }))

    expect(runtime.ingest(batch(1, [poseValue('mapping-box-live', 1), {
      ...status,
      value: 7,
    }]), 5_300)).toBe(true)
    expect(runtime.sampleEntityFrame('box-live', 'box-live-motion', 5_300)?.pose.positionM)
      .toEqual([1, 0, 0])
    expect(runtime.readEntityStatus('box-live', 5_300)?.value).toBe(7)
  })

  it('does not refresh stale timing when a newer wire sequence carries an older source timestamp', () => {
    const runtime = createObjectRuntimeStateV4(mappedProject())
    expect(runtime.ingest(batch(1, [poseValue('mapping-box-live', 1)]), 5_100)).toBe(true)
    expect(runtime.ingest(batch(2, [poseValue('mapping-box-live', 2)], {
      sourceTimestampMs: 999,
    }), 7_000)).toBe(false)

    expect(runtime.sampleEntityFrame('box-live', 'box-live-motion', 6_101)).toEqual(expect.objectContaining({
      quality: 'STALE',
      statusCode: 'BadNoCommunication',
    }))
  })

  it('holds the last interpolated display pose across a reconnect instead of jumping to the newest target', () => {
    const runtime = createObjectRuntimeStateV4(mappedProject())
    expect(runtime.ingest(batch(1, [poseValue('mapping-box-live', 1)]), 5_000)).toBe(true)
    expect(runtime.ingest(batch(2, [poseValue('mapping-box-live', 2)]), 5_100)).toBe(true)
    expect(runtime.sampleEntityFrame('box-live', 'box-live-motion', 5_250)?.pose.positionM)
      .toEqual([1.5, 0, 0])

    runtime.resetGatewaySession(5_250)

    expect(runtime.sampleEntityFrame('box-live', 'box-live-motion', 5_250)).toEqual(expect.objectContaining({
      pose: expect.objectContaining({ positionM: [1.5, 0, 0] }),
      quality: 'STALE',
    }))
  })
})
