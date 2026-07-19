import { configRevisionForProjectV5, validateWorkcellProjectV5 } from '../../../core/project-v5/index.js'
import { describe, expect, it } from 'vitest'

import { decodeProjectV5, encodeProjectV5 } from './project-v5-codec.js'
import {
  createLogicalIoJobSampleV5,
  LOGICAL_IO_JOB_SAMPLE_IDS_V5,
} from './logical-io-job-sample-v5.js'

const IDENTITY = {
  projectId: 'sample-v5',
  revisionId: 'sample-v5-r1',
  nowIso: '2026-07-19T00:00:00.000Z',
} as const

describe('logical I/O Job Project V5 sample', () => {
  it('creates a canonical V5 sample with every explicit instruction kind', async () => {
    const project = createLogicalIoJobSampleV5(IDENTITY)
    const job = project.jobs[0]!
    const kinds = new Set(job.instructions.map(({ kind }) => kind))

    expect(validateWorkcellProjectV5(project)).toEqual(project)
    expect(kinds).toEqual(new Set(['move-joint', 'set-do', 'wait-di', 'delay', 'attach', 'detach']))
    expect(project.robotDefinitions[0]!.identification.motionDeviceCategory).toBe('ARTICULATED_ROBOT')
    expect(project.controllers).toHaveLength(1)
    expect(project.logicalSignals.map(({ direction }) => direction).sort()).toEqual(['input', 'output'])
    expect(JSON.stringify(project)).not.toMatch(/"actions"|action-reference|actionBindings|ns=\d+;/u)
    await expect(decodeProjectV5(encodeProjectV5(project))).resolves.toEqual(project)
  })

  it('uses deterministic IDs, exact poses and speeds, URI-based OPC UA addresses, and no runtime Signal state', async () => {
    const project = createLogicalIoJobSampleV5(IDENTITY)
    const job = project.jobs[0]!

    expect(project.robotDefinitions).toHaveLength(1)
    expect(project.robotDefinitions[0]).toMatchObject({
      id: LOGICAL_IO_JOB_SAMPLE_IDS_V5.robotDefinitionId,
      assetReferenceIds: [LOGICAL_IO_JOB_SAMPLE_IDS_V5.robotSourceId],
      joints: [{ id: 'J1' }, { id: 'J2' }],
    })
    expect(project.robotDefinitions[0]!.links.every(({ geometryOccurrences }) => geometryOccurrences.length === 0)).toBe(true)
    expect(project.robots[0]).toMatchObject({
      id: LOGICAL_IO_JOB_SAMPLE_IDS_V5.robotId,
      controllerId: LOGICAL_IO_JOB_SAMPLE_IDS_V5.controllerId,
      initialJointValues: { J1: 0, J2: 0 },
    })
    expect(project.spatialEntities).toMatchObject([{
      id: LOGICAL_IO_JOB_SAMPLE_IDS_V5.partEntityId,
      geometry: { kind: 'box' },
      graspable: true,
      graspFrames: [{ frameId: LOGICAL_IO_JOB_SAMPLE_IDS_V5.partGraspFrameId }],
    }])
    expect(project.logicalSignals).toMatchObject([
      { id: LOGICAL_IO_JOB_SAMPLE_IDS_V5.partPresentSignalId, name: 'PartPresent', dataType: 'Boolean', direction: 'input' },
      { id: LOGICAL_IO_JOB_SAMPLE_IDS_V5.clampCommandSignalId, name: 'ClampCommand', dataType: 'Boolean', direction: 'output' },
    ])
    expect(project.opcUa.mappings.map(({ nodeAddress }) => nodeAddress)).toEqual([
      { namespaceUri: 'urn:robot-sim-web:logical-io-job-sample:v5', identifierType: 'string', identifier: 'Signals.PartPresent' },
      { namespaceUri: 'urn:robot-sim-web:logical-io-job-sample:v5', identifierType: 'string', identifier: 'Signals.ClampCommand' },
    ])
    expect(job.instructions).toEqual([
      { id: 'move-1', kind: 'move-joint', jointValues: { J1: 0, J2: 0 }, speedPercentToNext: 30 },
      { id: 'move-2', kind: 'move-joint', jointValues: { J1: 10, J2: -10 }, speedPercentToNext: 30 },
      { id: 'wait-part-present', kind: 'wait-di', signalId: 'signal-part-present', expected: true, timeoutMs: 5_000 },
      { id: 'clamp-on', kind: 'set-do', signalId: 'signal-clamp-command', value: true },
      { id: 'clamp-delay', kind: 'delay', durationMs: 250 },
      { id: 'attach-part', kind: 'attach', objectId: 'entity-part', toolFrameId: 'Tool', objectGraspFrameId: 'part-grasp', maximumDistanceM: 0.05 },
      { id: 'move-3', kind: 'move-joint', jointValues: { J1: 20, J2: -20 }, speedPercentToNext: 40 },
      { id: 'move-4', kind: 'move-joint', jointValues: { J1: 30, J2: -30 }, speedPercentToNext: 40 },
      { id: 'move-5', kind: 'move-joint', jointValues: { J1: 40, J2: -20 }, speedPercentToNext: 40 },
      { id: 'move-6', kind: 'move-joint', jointValues: { J1: 50, J2: -10 }, speedPercentToNext: 40 },
      { id: 'move-7', kind: 'move-joint', jointValues: { J1: 40, J2: 0 }, speedPercentToNext: 40 },
      { id: 'move-8', kind: 'move-joint', jointValues: { J1: 30, J2: 10 }, speedPercentToNext: 40 },
      { id: 'move-9', kind: 'move-joint', jointValues: { J1: 20, J2: 20 }, speedPercentToNext: 40 },
      { id: 'detach-part', kind: 'detach', objectId: 'entity-part', targetParentFrameId: 'world' },
      { id: 'clamp-off', kind: 'set-do', signalId: 'signal-clamp-command', value: false },
      { id: 'move-10', kind: 'move-joint', jointValues: { J1: 10, J2: 10 }, speedPercentToNext: 30 },
      { id: 'move-11', kind: 'move-joint', jointValues: { J1: 0, J2: 0 }, speedPercentToNext: 30 },
    ])
    expect(new Set(job.instructions.map(({ id }) => id)).size).toBe(job.instructions.length)

    const json = JSON.stringify(project)
    expect(json).not.toMatch(/"(?:quality|statusCode|sourceTimestamp|publishedTimestamp|owner)"/u)
    await expect(configRevisionForProjectV5(project)).resolves.toMatch(/^[0-9a-f]{64}$/u)
  })
})
