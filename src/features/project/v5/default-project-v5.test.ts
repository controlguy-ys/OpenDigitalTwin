import { describe, expect, it } from 'vitest'

import { validateWorkcellProjectV5 } from '../../../core/project-v5/index.js'
import { createDefaultProjectV5 } from './default-project-v5.js'

describe('default Project V5', () => {
  it('creates a fresh, valid workcell with one simulated NED2 and controller', () => {
    let next = 0
    const create = () => createDefaultProjectV5({
      createProjectId: () => `project-${++next}`,
      createRevisionId: () => `revision-${next}`,
      nowIso: () => '2026-07-23T00:00:00.000Z',
    })

    const first = create()
    const second = create()

    expect(validateWorkcellProjectV5(first)).toEqual(first)
    expect(first).toMatchObject({
      schemaVersion: 5,
      metadata: { name: 'Untitled Workcell', createdAt: '2026-07-23T00:00:00.000Z', updatedAt: '2026-07-23T00:00:00.000Z' },
      scene: { frames: expect.arrayContaining([expect.objectContaining({ id: 'world', role: 'world' }), expect.objectContaining({ id: 'mcp', role: 'mcp' })]) },
      assetReferences: [expect.objectContaining({ uri: 'builtin://niryo/ned2-assembly@v1' })],
      robotDefinitions: [expect.objectContaining({
        id: 'builtin-niryo-ned2-v1',
        joints: expect.arrayContaining([expect.objectContaining({ id: 'J6' })]),
      })],
      controllers: [expect.objectContaining({ id: 'controller-default' })],
      robots: [expect.objectContaining({
        name: 'NED2',
        controllerId: 'controller-default',
        visible: true,
        jointSource: 'simulation',
        initialJointValues: { J1: 0, J2: 0, J3: 0, J4: 0, J5: 0, J6: 0 },
      })],
      spatialEntities: [], sceneGroups: [], logicalSignals: [], jobs: [],
      opcUa: { mode: 'off', endpoints: [], mappings: [], bridgeRoutes: [] },
    })
    expect(second.projectId).not.toBe(first.projectId)
    expect(second.revisionId).not.toBe(first.revisionId)
    expect(JSON.stringify(first)).not.toContain('nodeId')
    expect(JSON.stringify(first)).not.toContain('move-linear')
  })
})
