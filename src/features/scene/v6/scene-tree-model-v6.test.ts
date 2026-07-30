import { describe, expect, it } from 'vitest'

import type { WorkcellProjectV5 } from '../../../core/project-v5/index.js'
import { makeMinimalWorkcellProjectV5 } from '../../../core/project-v5/test-support.js'
import { buildSceneTreeRowsV6, filterSceneTreeRowsV6 } from './scene-tree-model-v6.js'

function project(): WorkcellProjectV5 {
  const base = makeMinimalWorkcellProjectV5()
  return {
    ...base,
    robots: [...base.robots, { ...base.robots[0]!, id: 'robot-2', name: 'Robot 2', serialNumber: 'ROBOT-SAMPLE-002' }],
    sceneGroups: [
      { id: 'fixtures', name: 'Fixtures', parentGroupId: null, visible: true },
      { id: 'infeed', name: 'Infeed', parentGroupId: 'fixtures', visible: false },
    ],
    spatialEntities: [
      { id: 'box-a', name: 'Box A', geometry: { kind: 'box', dimensionsM: [0.1, 0.1, 0.1], color: '#38bdf8' }, parentFrameId: 'mcp', localPose: { positionM: [0, 0, 0], quaternion: [0, 0, 0, 1] }, visible: true, groupId: 'fixtures', removable: true, transformOwner: 'manual', numericStatus: { value: 0, sourceOwnership: 'manual', overlay: { visible: false, frameId: null } }, graspable: false, graspFrames: [], movingFrames: [] },
      { id: 'box-b', name: 'Box B', geometry: { kind: 'box', dimensionsM: [0.1, 0.1, 0.1], color: '#38bdf8' }, parentFrameId: 'mcp', localPose: { positionM: [0, 0, 0], quaternion: [0, 0, 0, 1] }, visible: false, groupId: 'infeed', removable: true, transformOwner: 'opcua:endpoint-1', numericStatus: { value: 0, sourceOwnership: 'manual', overlay: { visible: false, frameId: null } }, graspable: false, graspFrames: [], movingFrames: [] },
      { id: 'box-c', name: 'Loose box', geometry: { kind: 'box', dimensionsM: [0.1, 0.1, 0.1], color: '#38bdf8' }, parentFrameId: 'mcp', localPose: { positionM: [0, 0, 0], quaternion: [0, 0, 0, 1] }, visible: true, groupId: null, removable: false, transformOwner: 'simulation', numericStatus: { value: 0, sourceOwnership: 'manual', overlay: { visible: false, frameId: null } }, graspable: false, graspFrames: [], movingFrames: [] },
    ],
  }
}

describe('buildSceneTreeRowsV6', () => {
  it('preserves Project order, group nesting, visibility, and owner labels in semantic rows', () => {
    const rows = buildSceneTreeRowsV6(project())

    expect(rows.map(({ key }) => key)).toEqual([
      'section:frames', 'frame:world', 'frame:mcp',
      'section:robots', 'robot:robot-1', 'robot:robot-2',
      'section:groups', 'group:fixtures', 'object:box-a', 'group:infeed', 'object:box-b',
      'section:objects', 'object:box-c',
    ])
    expect(rows.find(({ key }) => key === 'group:infeed')).toMatchObject({ parentKey: 'group:fixtures', depth: 2, visible: false })
    expect(rows.find(({ key }) => key === 'object:box-b')).toMatchObject({ parentKey: 'group:infeed', depth: 3, ownerLabel: 'OPC UA: endpoint-1' })
    expect(rows.find(({ key }) => key === 'robot:robot-1')).toMatchObject({ depth: 1, ownerLabel: 'Simulation' })
  })

  it('keeps matching ancestors when filtering without reordering the Project tree', () => {
    const rows = buildSceneTreeRowsV6(project())
    expect(filterSceneTreeRowsV6(rows, 'box b').map(({ key }) => key)).toEqual([
      'section:groups', 'group:fixtures', 'group:infeed', 'object:box-b',
    ])
  })
})
