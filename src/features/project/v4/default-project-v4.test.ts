import { describe, expect, it } from 'vitest'

import {
  canonicalProjectV4Json,
  validateWorkcellProjectV4,
} from '../../../core/project-v4/index.js'
import {
  BUILTIN_CRB_DEFINITION_ID_V4,
  createBuiltinCrbDefinitionV4,
} from '../../robot/v4/builtin-crb-definition.js'
import { createDefaultProjectV4 } from './default-project-v4.js'

const NOW = '2026-07-17T01:02:03.004Z'

describe('createDefaultProjectV4', () => {
  it('creates one valid built-in CRB workcell with explicit independent identities', () => {
    const project = createDefaultProjectV4({
      projectId: 'project-new',
      revisionId: 'revision-new',
      nowIso: NOW,
    })

    expect(validateWorkcellProjectV4(project)).toEqual(project)
    expect(Object.isFrozen(project)).toBe(true)
    expect(project).toMatchObject({
      schemaVersion: 4,
      projectId: 'project-new',
      revisionId: 'revision-new',
      metadata: {
        name: 'Untitled Workcell',
        createdAt: NOW,
        updatedAt: NOW,
      },
    })
    expect(project.projectId).not.toBe(project.revisionId)
    expect(project.robotDefinitions).toHaveLength(1)
    const builtin = createBuiltinCrbDefinitionV4()
    expect(project.robotDefinitions[0]).toMatchObject({
      id: BUILTIN_CRB_DEFINITION_ID_V4,
      manufacturer: builtin.manufacturer,
      model: builtin.model,
    })
    expect(project.robotDefinitions[0]?.links.map(({ id }) => id))
      .toEqual(builtin.links.map(({ id }) => id))
    expect(project.robotDefinitions[0]?.joints.map(({ id }) => id))
      .toEqual(builtin.joints.map(({ id }) => id))
    expect(project.assetReferences).toHaveLength(7)
    expect(project.assetReferences.every(({ uri }) => uri.startsWith('builtin://abb/')))
      .toBe(true)
  })

  it('owns World, MCP, Base, Flange, Tool0, Tool, and TCP explicitly', () => {
    const project = createDefaultProjectV4({
      projectId: 'project-frames',
      revisionId: 'revision-frames',
      nowIso: NOW,
    })

    expect(project.scene.frames.map(({ id, parentFrameId, role }) => (
      [id, parentFrameId, role]
    ))).toEqual([
      ['world', null, 'world'],
      ['mcp', 'world', 'mcp'],
    ])
    expect(project.robotDefinitions[0]?.frames.map(({ id, parentFrameId, role }) => (
      [id, parentFrameId, role]
    ))).toEqual([
      ['Base', 'LINK00', 'base'],
      ['Flange', 'LINK06', 'flange'],
      ['Tool0', 'Flange', 'tool0'],
      ['Tool', 'Tool0', 'tool'],
      ['TCP', 'Tool', 'tcp'],
    ])
  })

  it('starts one Simulation-owned Robot and one empty Robot Job without a table or attachment', () => {
    const project = createDefaultProjectV4({
      projectId: 'project-runtime',
      revisionId: 'revision-runtime',
      nowIso: NOW,
    })
    const definition = project.robotDefinitions[0]!
    const robot = project.robots[0]!

    expect(project.robots).toHaveLength(1)
    expect(robot).toMatchObject({
      definitionId: definition.id,
      visible: true,
      baseParentFrameId: 'mcp',
      jointSource: 'simulation',
      selectedToolFrameId: 'Tool',
      selectedTcpFrameId: 'TCP',
      numericStatus: {
        value: 0,
        sourceOwnership: 'simulation',
        overlay: { visible: false, frameId: null },
      },
      intentionalMountEntityId: null,
    })
    expect(robot.initialJointValues).toEqual(Object.fromEntries(
      definition.joints.map(({ id, home }) => [id, home]),
    ))
    expect(project.jobs).toEqual([{
      id: 'job-default',
      name: 'Default Job',
      robotId: robot.id,
      steps: [],
    }])
    expect(project.spatialEntities).toEqual([])
    expect(project.sceneGroups).toEqual([])
    expect(project.actions).toEqual([])
    expect(project.opcUa).toEqual({
      mode: 'off',
      endpoints: [],
      mappings: [],
      actionBindings: [],
      bridgeRoutes: [],
    })
    expect(canonicalProjectV4Json(project)).not.toMatch(
      /(?:attachment|table|[A-Za-z]:\\|\/(?:Users|home)\/|STEP bytes)/iu,
    )
  })

  it.each([
    { projectId: '', revisionId: 'revision-valid', nowIso: NOW },
    { projectId: 'project-valid', revisionId: '', nowIso: NOW },
    { projectId: 'same-id', revisionId: 'same-id', nowIso: NOW },
    { projectId: 'project-valid', revisionId: 'revision-valid', nowIso: 'not-iso' },
  ])('rejects invalid injected identity or time %#', (options) => {
    expect(() => createDefaultProjectV4(options)).toThrow()
  })
})
