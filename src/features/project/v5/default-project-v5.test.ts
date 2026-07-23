import { describe, expect, it } from 'vitest'

import { validateWorkcellProjectV5 } from '../../../core/project-v5/index.js'
import { createDefaultProjectV5 } from './default-project-v5.js'

describe('default Project V5', () => {
  it('creates a fresh, valid empty workcell with only durable V5 configuration', () => {
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
      assetReferences: [], robotDefinitions: [], controllers: [], robots: [], spatialEntities: [], sceneGroups: [], logicalSignals: [], jobs: [],
      opcUa: { mode: 'off', endpoints: [], mappings: [], bridgeRoutes: [] },
    })
    expect(second.projectId).not.toBe(first.projectId)
    expect(second.revisionId).not.toBe(first.revisionId)
    expect(JSON.stringify(first)).not.toContain('nodeId')
    expect(JSON.stringify(first)).not.toContain('move-linear')
  })
})
