import { describe, expect, it } from 'vitest'

import {
  validateWorkcellProjectV5,
  type WorkcellProjectV5,
} from '../../../core/project-v5/index.js'
import {
  cloneWorkcellProjectV5,
  makeMinimalWorkcellProjectV5,
} from '../../../core/project-v5/test-support.js'
import {
  createBindingMappingDraftV1,
  removeBindingMappingV1,
  saveBindingMappingV1,
} from './binding-editor-model.js'
import {
  entityCommsDisplayStateV1,
  entityTargetMappingCountV1,
  updateEntityCommsV1,
} from './entity-comms-model.js'

function projectWithEntities(): WorkcellProjectV5 {
  const project = cloneWorkcellProjectV5(makeMinimalWorkcellProjectV5())
  for (const [id, name] of [['box', 'Box'], ['crate', 'Crate']] as const) {
    ;(project.spatialEntities as unknown as Array<WorkcellProjectV5['spatialEntities'][number]>).push({
      id,
      name,
      geometry: { kind: 'box', dimensionsM: [0.1, 0.1, 0.1], color: '#808080' },
      parentFrameId: `${id}-motion`,
      localPose: { positionM: [0, 0, 0], quaternion: [0, 0, 0, 1] },
      visible: true,
      groupId: null,
      removable: true,
      transformOwner: 'manual',
      numericStatus: { value: 0, sourceOwnership: 'manual', overlay: { visible: false, frameId: null } },
      graspable: false,
      graspFrames: [],
      movingFrames: [{
        frameId: `${id}-motion`,
        name: 'Motion',
        parentFrameId: 'world',
        localPose: { positionM: [0, 0, 0], quaternion: [0, 0, 0, 1] },
        sourceOwnership: 'manual',
      }],
    })
  }
  return validateWorkcellProjectV5(project)
}

function saveEntityMapping(
  project: WorkcellProjectV5,
  entityId: string,
  type: 'entity-frame' | 'entity-status',
  mappingId: string,
): WorkcellProjectV5 {
  const target = type === 'entity-frame'
    ? { type, entityId, frameId: `${entityId}-motion` } as const
    : { type, entityId } as const
  return validateWorkcellProjectV5(saveBindingMappingV1(project, {
    ...createBindingMappingDraftV1(project, target, mappingId),
    namespaceUri: 'urn:virtual-plc',
    identifier: mappingId,
  }))
}

describe('Object communications model', () => {
  it('derives legacy display state from entity mappings and the Object name', () => {
    let project = saveEntityMapping(projectWithEntities(), 'box', 'entity-frame', 'box-frame')
    const legacy = cloneWorkcellProjectV5(project)
    delete (legacy.spatialEntities[0] as unknown as Record<string, unknown>).enableComms
    delete (legacy.spatialEntities[0] as unknown as Record<string, unknown>).tagName
    project = validateWorkcellProjectV5(legacy)

    expect(entityTargetMappingCountV1(project, 'box')).toBe(1)
    expect(entityCommsDisplayStateV1(project, project.spatialEntities[0]!)).toEqual({
      enabled: true,
      tagName: 'Box',
      mappingCount: 1,
    })
  })

  it('enables communications metadata without creating an OPC UA mapping', () => {
    const project = projectWithEntities()
    const updated = updateEntityCommsV1(project, 'box', { enableComms: true })

    expect(entityCommsDisplayStateV1(updated, updated.spatialEntities[0]!)).toEqual({
      enabled: true,
      tagName: 'Box',
      mappingCount: 0,
    })
    expect(updated.opcUa).toEqual(project.opcUa)
  })

  it('updates Object tag metadata without using it as mapping identity', () => {
    const project = projectWithEntities()
    const updated = updateEntityCommsV1(project, 'box', { tagName: 'Shared display tag' })
    const duplicate = updateEntityCommsV1(updated, 'crate', { tagName: 'Shared display tag' })

    expect(updated.spatialEntities[0]).toMatchObject({ tagName: 'Shared display tag' })
    expect(entityCommsDisplayStateV1(updated, updated.spatialEntities[0]!).enabled).toBe(false)
    expect(updated.opcUa.mappings).toHaveLength(1)
    expect(duplicate.spatialEntities.map(({ tagName }) => tagName)).toEqual(['Shared display tag', 'Shared display tag'])
  })

  it('disables one Object atomically without altering unrelated mappings, routes, or owners', () => {
    const withSimulationFrame = cloneWorkcellProjectV5(projectWithEntities())
    ;(withSimulationFrame.spatialEntities[0]!.movingFrames as unknown as Array<WorkcellProjectV5['spatialEntities'][number]['movingFrames'][number]>).push({
      frameId: 'box-simulation', name: 'Simulation', parentFrameId: 'world',
      localPose: { positionM: [0, 0, 0], quaternion: [0, 0, 0, 1] }, sourceOwnership: 'simulation',
    })
    let project = saveEntityMapping(validateWorkcellProjectV5(withSimulationFrame), 'box', 'entity-frame', 'box-frame')
    project = saveEntityMapping(project, 'box', 'entity-status', 'box-status')
    project = saveEntityMapping(project, 'crate', 'entity-frame', 'crate-frame')
    const robotTarget = { type: 'robot-status', robotId: 'robot-1' } as const
    project = validateWorkcellProjectV5(saveBindingMappingV1(project, {
      ...createBindingMappingDraftV1(project, robotTarget, 'robot-status'),
      namespaceUri: 'urn:virtual-plc',
      identifier: 'Robot.Status',
    }))
    project = validateWorkcellProjectV5({
      ...project,
      opcUa: {
        ...project.opcUa,
        bridgeRoutes: [
          { id: 'box-route', sourceMappingId: 'box-frame', destinationMappingId: 'robot-status', direction: 'forward', scale: 1, offset: 0, unit: '' },
          { id: 'other-route', sourceMappingId: 'crate-frame', destinationMappingId: 'robot-status', direction: 'forward', scale: 1, offset: 0, unit: '' },
        ],
      },
    })

    const disabled = validateWorkcellProjectV5(updateEntityCommsV1(project, 'box', { enableComms: false }))
    expect(disabled.spatialEntities[0]).toMatchObject({
      enableComms: false,
      transformOwner: 'manual',
      numericStatus: { sourceOwnership: 'manual' },
      movingFrames: [{ sourceOwnership: 'manual' }, { sourceOwnership: 'simulation' }],
    })
    expect(disabled.opcUa.mappings.map(({ id }) => id)).toEqual(['mapping-1', 'crate-frame', 'robot-status'])
    expect(disabled.opcUa.bridgeRoutes.map(({ id }) => id)).toEqual(['other-route'])
    expect(disabled.spatialEntities[1]).toMatchObject({ transformOwner: 'opcua:endpoint-1' })
    expect(disabled.robots[0]!.numericStatus.sourceOwnership).toBe('opcua:endpoint-1')
  })

  it('keeps enabled Object metadata after removing one mapping', () => {
    const project = saveEntityMapping(projectWithEntities(), 'box', 'entity-frame', 'box-frame')
    const removed = validateWorkcellProjectV5(removeBindingMappingV1(project, 'box-frame'))

    expect(removed.spatialEntities[0]).toMatchObject({ enableComms: true })
    expect(entityCommsDisplayStateV1(removed, removed.spatialEntities[0]!)).toMatchObject({
      enabled: true,
      mappingCount: 0,
    })
  })
})
