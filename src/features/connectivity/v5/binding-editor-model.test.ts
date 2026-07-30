import { describe, expect, it } from 'vitest'

import {
  validateWorkcellProjectV5,
  type OpcUaMappingV5,
  type WorkcellProjectV5,
} from '../../../core/project-v5/index.js'
import {
  cloneWorkcellProjectV5,
  makeMinimalWorkcellProjectV5,
} from '../../../core/project-v5/test-support.js'
import {
  FRAME_PROJECT_PATHS_V1,
  availableBindingTargetsV1,
  createBindingMappingDraftV1,
  mappingFromBindingDraftV1,
  removeBindingMappingV1,
  saveBindingMappingV1,
  takeManualBindingOwnershipV1,
} from './binding-editor-model.js'

function projectWithBox(): WorkcellProjectV5 {
  const project = cloneWorkcellProjectV5(makeMinimalWorkcellProjectV5())
  ;(project.spatialEntities as unknown as Array<WorkcellProjectV5['spatialEntities'][number]>).push({
    id: 'box',
    name: 'Box',
    geometry: { kind: 'box', dimensionsM: [0.1, 0.1, 0.1], color: '#808080' },
    parentFrameId: 'box-motion',
    localPose: { positionM: [0, 0, 0], quaternion: [0, 0, 0, 1] },
    visible: true,
    groupId: null,
    removable: true,
    transformOwner: 'manual',
    numericStatus: { value: 0, sourceOwnership: 'manual', overlay: { visible: true, frameId: null } },
    graspable: true,
    graspFrames: [],
    movingFrames: [{
      frameId: 'box-motion',
      name: 'Motion',
      parentFrameId: 'world',
      localPose: { positionM: [0, 0, 0], quaternion: [0, 0, 0, 1] },
      sourceOwnership: 'manual',
    }],
  })
  return validateWorkcellProjectV5(project)
}

describe('binding editor model', () => {
  it('lists Object and Robot targets from the Project instead of fixed robot assumptions', () => {
    const labels = availableBindingTargetsV1(projectWithBox()).map(({ label }) => label)
    expect(labels).toEqual(expect.arrayContaining([
      'Box / Pose / Motion',
      'Box / Status',
      'Robot 1 / Joint / J1',
      'Robot 1 / Frame / Base',
      'Robot 1 / Status',
    ]))
  })

  it('creates six independent Object Pose leaves with canonical Project destinations', () => {
    const project = projectWithBox()
    const target = { type: 'entity-frame', entityId: 'box', frameId: 'box-motion' } as const
    const initial = createBindingMappingDraftV1(project, target, 'mapping-box-pose')
    const mapping = mappingFromBindingDraftV1({
      ...initial,
      namespaceUri: 'urn:virtual-plc',
      identifier: 'ObjectPos',
      leafPaths: ['["X"]', '["Y"]', '["Z"]', '["Roll"]', '["Pitch"]', '["Yaw"]'],
    })
    expect(mapping.coordinateConvention).toBe('project-v5-z-up-metres-quaternion-xyzw')
    expect(mapping.leaves.map(({ leafPath }) => leafPath)).toEqual([
      ['X'], ['Y'], ['Z'], ['Roll'], ['Pitch'], ['Yaw'],
    ])
    expect(mapping.leaves.map(({ projectPath }) => projectPath)).toEqual(FRAME_PROJECT_PATHS_V1)
  })

  it('saves a read Mapping atomically and removes it without silently taking Manual ownership', () => {
    const project = projectWithBox()
    const target = { type: 'entity-frame', entityId: 'box', frameId: 'box-motion' } as const
    const draft = {
      ...createBindingMappingDraftV1(project, target, 'mapping-box-pose'),
      namespaceUri: 'urn:virtual-plc',
      identifier: 'ObjectPos',
    }
    const saved = validateWorkcellProjectV5(saveBindingMappingV1(project, draft))
    expect(saved.opcUa.mappings.find(({ id }) => id === 'mapping-box-pose')).toBeDefined()
    expect(saved.spatialEntities[0]).toMatchObject({
      transformOwner: 'opcua:endpoint-1',
      movingFrames: [{ sourceOwnership: 'opcua:endpoint-1' }],
    })

    const removed = validateWorkcellProjectV5(removeBindingMappingV1(saved, 'mapping-box-pose'))
    expect(removed.opcUa.mappings.find(({ id }) => id === 'mapping-box-pose')).toBeUndefined()
    expect(removed.spatialEntities[0]).toMatchObject({
      transformOwner: 'opcua:endpoint-1',
      movingFrames: [{ sourceOwnership: 'opcua:endpoint-1' }],
    })
  })

  it('auto-enables Object communications and only fills blank tags from an explicit browse-name suggestion', () => {
    const project = projectWithBox()
    const target = { type: 'entity-status', entityId: 'box' } as const
    const draft = {
      ...createBindingMappingDraftV1(project, target, 'mapping-box-status'),
      namespaceUri: 'urn:virtual-plc',
      identifier: 'Object.Status',
    }
    const suggested = validateWorkcellProjectV5(saveBindingMappingV1(project, draft, {
      suggestedTagName: 'Browser Object Status',
    }))
    expect(suggested.spatialEntities[0]).toMatchObject({ enableComms: true, tagName: 'Browser Object Status' })

    const blank = validateWorkcellProjectV5({
      ...project,
      spatialEntities: [{ ...project.spatialEntities[0]!, tagName: '' }],
    })
    const blankSuggested = validateWorkcellProjectV5(saveBindingMappingV1(blank, draft, {
      suggestedTagName: 'Blank tag browse name',
    }))
    expect(blankSuggested.spatialEntities[0]).toMatchObject({ tagName: 'Blank tag browse name' })

    const explicit = validateWorkcellProjectV5({
      ...project,
      spatialEntities: [{ ...project.spatialEntities[0]!, tagName: 'Operator tag' }],
    })
    const preserved = validateWorkcellProjectV5(saveBindingMappingV1(explicit, draft, {
      suggestedTagName: 'Different browse name',
    }))
    expect(preserved.spatialEntities[0]).toMatchObject({ enableComms: true, tagName: 'Operator tag' })
  })

  it('takes manual control for the whole Robot Joint ownership scope', () => {
    const project = cloneWorkcellProjectV5(makeMinimalWorkcellProjectV5())
    const target = { type: 'robot-joint', robotId: 'robot-1', jointId: 'J1' } as const
    const mapping = mappingFromBindingDraftV1({
      ...createBindingMappingDraftV1(project, target, 'mapping-j1'),
      namespaceUri: 'urn:virtual-plc',
      identifier: 'Robot.J1',
    })
    ;(project.opcUa.mappings as unknown as OpcUaMappingV5[]).push(mapping)
    ;(project.robots[0] as unknown as { jointSource: string }).jointSource = 'opcua:endpoint-1'
    const controlled = validateWorkcellProjectV5(project)
    const manual = validateWorkcellProjectV5(takeManualBindingOwnershipV1(controlled, target))
    expect(manual.robots[0]!.jointSource).toBe('manual')
    expect(manual.opcUa.mappings.some(({ id }) => id === 'mapping-j1')).toBe(false)
  })

  it('clears every OPC UA-owned Moving Frame when taking Object Manual ownership', () => {
    const project = cloneWorkcellProjectV5(projectWithBox())
    ;(project.spatialEntities[0]!.movingFrames as unknown as Array<WorkcellProjectV5['spatialEntities'][number]['movingFrames'][number]>).push({
      frameId: 'box-motion-2',
      name: 'Motion 2',
      parentFrameId: 'world',
      localPose: { positionM: [0, 0, 0], quaternion: [0, 0, 0, 1] },
      sourceOwnership: 'manual',
    })
    let configured = validateWorkcellProjectV5(project)
    for (const [frameId, mappingId] of [['box-motion', 'mapping-box-1'], ['box-motion-2', 'mapping-box-2']] as const) {
      const target = { type: 'entity-frame', entityId: 'box', frameId } as const
      configured = validateWorkcellProjectV5(saveBindingMappingV1(configured, {
        ...createBindingMappingDraftV1(configured, target, mappingId),
        namespaceUri: 'urn:virtual-plc',
        identifier: mappingId,
      }))
    }
    const manual = validateWorkcellProjectV5(takeManualBindingOwnershipV1(
      configured,
      { type: 'entity-frame', entityId: 'box', frameId: 'box-motion' },
    ))
    expect(manual.opcUa.mappings.filter(({ id }) => id.startsWith('mapping-box-'))).toHaveLength(0)
    expect(manual.spatialEntities[0]).toMatchObject({
      transformOwner: 'manual',
      movingFrames: [{ sourceOwnership: 'manual' }, { sourceOwnership: 'manual' }],
    })
  })

  it('uses metres for prismatic Robot Joint mappings', () => {
    const project = cloneWorkcellProjectV5(makeMinimalWorkcellProjectV5())
    ;(project.robotDefinitions[0]!.joints[0] as unknown as { type: string }).type = 'prismatic'
    const validated = validateWorkcellProjectV5(project)
    const target = { type: 'robot-joint', robotId: 'robot-1', jointId: 'J1' } as const
    const mapping = mappingFromBindingDraftV1({
      ...createBindingMappingDraftV1(validated, target, 'mapping-prismatic'),
      namespaceUri: 'urn:virtual-plc',
      identifier: 'Axis.Position',
    })
    expect(mapping.leaves[0]?.unit).toBe('metre')
    expect(mapping.interpolationMode).toBe('linear')
  })

  it('loads the exact Mapping row when one target has both read and write mappings', () => {
    const project = projectWithBox()
    const target = { type: 'entity-status', entityId: 'box' } as const
    const read = validateWorkcellProjectV5(saveBindingMappingV1(project, {
      ...createBindingMappingDraftV1(project, target, 'mapping-status-read'),
      namespaceUri: 'urn:virtual-plc',
      identifier: 'Status.Read',
    }))
    const writeMapping = mappingFromBindingDraftV1({
      ...createBindingMappingDraftV1(read, target, 'mapping-status-write', { createNew: true }),
      namespaceUri: 'urn:virtual-plc',
      identifier: 'Status.Write',
      direction: 'write',
    })
    const dual = validateWorkcellProjectV5({
      ...read,
      opcUa: { ...read.opcUa, mappings: [...read.opcUa.mappings, writeMapping] },
    })
    const selected = createBindingMappingDraftV1(
      dual,
      target,
      'unused',
      { existingMappingId: 'mapping-status-write' },
    )
    expect(selected).toMatchObject({
      mappingId: 'mapping-status-write',
      direction: 'write',
      identifier: 'Status.Write',
    })
  })

  it('rejects an exact Mapping row that disappeared instead of creating a replacement', () => {
    const project = projectWithBox()
    const target = { type: 'entity-status', entityId: 'box' } as const
    expect(() => createBindingMappingDraftV1(
      project,
      target,
      'replacement-mapping',
      { existingMappingId: 'deleted-mapping' },
    )).toThrow('BINDING_MAPPING_NOT_FOUND')
  })

  it('round-trips dotted and numeric-string OPC UA member names losslessly', () => {
    const project = projectWithBox()
    const target = { type: 'entity-frame', entityId: 'box', frameId: 'box-motion' } as const
    const mapping = mappingFromBindingDraftV1({
      ...createBindingMappingDraftV1(project, target, 'mapping-weird-paths'),
      namespaceUri: 'urn:virtual-plc',
      identifier: 'Pose',
      leafPaths: ['["pose.x"]', '["0"]', '["z"]', '["roll"]', '["pitch"]', '["yaw"]'],
    })
    const configured = validateWorkcellProjectV5(saveBindingMappingV1(project, {
      ...createBindingMappingDraftV1(project, target, 'mapping-weird-paths'),
      namespaceUri: 'urn:virtual-plc',
      identifier: 'Pose',
      leafPaths: mapping.leaves.map(({ leafPath }) => JSON.stringify(leafPath)),
    }))
    const reopened = createBindingMappingDraftV1(
      configured,
      target,
      'unused',
      { existingMappingId: 'mapping-weird-paths' },
    )
    const roundTripped = mappingFromBindingDraftV1(reopened)
    expect(roundTripped.leaves[0]?.leafPath).toEqual(['pose.x'])
    expect(roundTripped.leaves[1]?.leafPath).toEqual(['0'])
  })

  it('matches reordered frame leaves by canonical Project destination on reopen', () => {
    const project = projectWithBox()
    const target = { type: 'entity-frame', entityId: 'box', frameId: 'box-motion' } as const
    const saved = validateWorkcellProjectV5(saveBindingMappingV1(project, {
      ...createBindingMappingDraftV1(project, target, 'mapping-reordered'),
      namespaceUri: 'urn:virtual-plc',
      identifier: 'Pose',
      leafPaths: ['["source-x"]', '["source-y"]', '["source-z"]', '["source-r"]', '["source-p"]', '["source-yaw"]'],
    }))
    const mappingIndex = saved.opcUa.mappings.findIndex(({ id }) => id === 'mapping-reordered')
    const mapping = saved.opcUa.mappings[mappingIndex]!
    const reordered = validateWorkcellProjectV5({
      ...saved,
      opcUa: {
        ...saved.opcUa,
        mappings: saved.opcUa.mappings.map((candidate, index) => index === mappingIndex
          ? { ...candidate, leaves: [mapping.leaves[1]!, mapping.leaves[0]!, ...mapping.leaves.slice(2)] }
          : candidate),
      },
    })
    const reopened = createBindingMappingDraftV1(
      reordered,
      target,
      'unused',
      { existingMappingId: 'mapping-reordered' },
    )
    expect(reopened.leafPaths.slice(0, 2)).toEqual(['["source-x"]', '["source-y"]'])
    const roundTripped = mappingFromBindingDraftV1(reopened)
    expect(roundTripped.leaves.slice(0, 2).map(({ leafPath, projectPath }) => ({ leafPath, projectPath }))).toEqual([
      { leafPath: ['source-x'], projectPath: ['positionM', 0] },
      { leafPath: ['source-y'], projectPath: ['positionM', 1] },
    ])
  })

  it('preserves unedited leaf metadata and per-leaf Node Address overrides', () => {
    const project = projectWithBox()
    const target = { type: 'entity-frame', entityId: 'box', frameId: 'box-motion' } as const
    const saved = validateWorkcellProjectV5(saveBindingMappingV1(project, {
      ...createBindingMappingDraftV1(project, target, 'mapping-metadata'),
      namespaceUri: 'urn:virtual-plc',
      identifier: 'Pose',
    }))
    const mappingIndex = saved.opcUa.mappings.findIndex(({ id }) => id === 'mapping-metadata')
    const mapping = saved.opcUa.mappings[mappingIndex]!
    const customizedLeaf = {
      ...mapping.leaves[0]!,
      nodeAddress: {
        namespaceUri: 'urn:virtual-plc:leaf',
        identifierType: 'string' as const,
        identifier: ' Pose.X ',
      },
      opcUaDataType: 'Float' as const,
      projectDataType: 'number' as const,
      scale: 0.001,
      offset: 2.5,
      unit: 'millimetre',
      required: false,
    }
    const customized = validateWorkcellProjectV5({
      ...saved,
      opcUa: {
        ...saved.opcUa,
        mappings: saved.opcUa.mappings.map((candidate, index) => index === mappingIndex
          ? { ...candidate, leaves: [customizedLeaf, ...candidate.leaves.slice(1)] }
          : candidate),
      },
    })
    const reopened = createBindingMappingDraftV1(
      customized,
      target,
      'unused',
      { existingMappingId: 'mapping-metadata' },
    )
    const roundTripped = mappingFromBindingDraftV1(reopened)
    expect(roundTripped.leaves[0]).toEqual(customizedLeaf)
  })

  it.each([
    [{ type: 'entity-status', entityId: 'box' } as const, 'numericStatus.sourceOwnership'],
    [{ type: 'robot-joint', robotId: 'robot-1', jointId: 'J1' } as const, 'jointSource'],
    [{ type: 'robot-frame', robotId: 'robot-1', frameId: 'TCP' } as const, 'frameSources.TCP'],
    [{ type: 'robot-status', robotId: 'robot-1' } as const, 'numericStatus.sourceOwnership'],
  ])('validates the shared scalar Mapping variant %o', (target, ownerPath) => {
    const project = target.type === 'entity-status' ? projectWithBox() : validateWorkcellProjectV5(makeMinimalWorkcellProjectV5())
    const draft = {
      ...createBindingMappingDraftV1(project, target, `mapping-${target.type}`),
      namespaceUri: 'urn:virtual-plc',
      identifier: `Value.${target.type}`,
    }
    const saved = validateWorkcellProjectV5(saveBindingMappingV1(project, draft))
    const mapping = saved.opcUa.mappings.find(({ id }) => id === `mapping-${target.type}`)
    expect(mapping?.leaves).toHaveLength(target.type === 'robot-frame' ? 6 : 1)
    const owner = target.type === 'entity-status'
      ? saved.spatialEntities[0]!.numericStatus.sourceOwnership
      : target.type === 'robot-joint'
        ? saved.robots[0]!.jointSource
        : target.type === 'robot-frame'
          ? saved.robots[0]!.frameSources.TCP
          : saved.robots[0]!.numericStatus.sourceOwnership
    expect({ ownerPath, owner }).toEqual({ ownerPath, owner: 'opcua:endpoint-1' })
  })
})
