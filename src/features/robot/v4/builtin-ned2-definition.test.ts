import { BoxGeometry, Group, Mesh, MeshStandardMaterial } from 'three'
import { describe, expect, it, vi } from 'vitest'

import { createDefaultProjectV4 } from '../../project/v4/default-project-v4.js'
import {
  BUILTIN_NED2_DEFINITION_ID_V4,
  createBuiltinNed2AssetReferencesV4,
  createBuiltinNed2DefinitionV4,
  prepareBuiltinNed2GeometryV4,
} from './builtin-ned2-definition.js'

function triangleRoot(): Group {
  const root = new Group()
  root.add(new Mesh(new BoxGeometry(0.1, 0.1, 0.1), new MeshStandardMaterial()))
  return root
}

describe('built-in NED2 Definition V4', () => {
  it('provides one immutable assembly source and a six-axis seven-Link topology', () => {
    const definition = createBuiltinNed2DefinitionV4()
    const assets = createBuiltinNed2AssetReferencesV4()

    expect(definition).toMatchObject({
      id: BUILTIN_NED2_DEFINITION_ID_V4,
      manufacturer: 'Niryo',
      model: 'NED2',
    })
    expect(definition.links.map(({ id }) => id)).toEqual([
      'LINK00', 'LINK01', 'LINK02', 'LINK03', 'LINK04', 'LINK05', 'LINK06',
    ])
    expect(definition.joints.map(({ id }) => id)).toEqual(['J1', 'J2', 'J3', 'J4', 'J5', 'J6'])
    expect(assets).toHaveLength(1)
    expect(assets[0]).toMatchObject({
      id: 'builtin-niryo-ned2-assembly-v1',
      uri: 'builtin://niryo/ned2-assembly@v1',
      sourceFileName: 'NED2_STEP.step',
    })
    expect(Object.isFrozen(definition)).toBe(true)
    expect(Object.isFrozen(definition.links[0]?.geometryOccurrences[0])).toBe(true)
  })

  it('loads all seven checked-in Link GLBs as one prepared Definition generation', async () => {
    const load = vi.fn(async (_url: string) => triangleRoot())
    const validatedDefinition = createDefaultProjectV4({
      projectId: 'project-ned2-loader',
      revisionId: 'revision-ned2-loader',
      nowIso: '2026-07-21T00:00:00.000Z',
    }).robotDefinitions[0]!
    const prepared = await prepareBuiltinNed2GeometryV4(
      validatedDefinition,
      { load },
    )

    expect(load.mock.calls.map(([url]) => url)).toEqual([
      '/models/robot/ned2/LINK00.glb',
      '/models/robot/ned2/LINK01.glb',
      '/models/robot/ned2/LINK02.glb',
      '/models/robot/ned2/LINK03.glb',
      '/models/robot/ned2/LINK04.glb',
      '/models/robot/ned2/LINK05.glb',
      '/models/robot/ned2/LINK06.glb',
    ])
    expect(prepared.linkTemplates.size).toBe(7)
    expect(prepared.triangleCount).toBe(84)
    prepared.dispose()
    expect(prepared.lifecycleState).toBe('DISPOSED')
  })

  it('rejects a Definition that does not exactly match the checked-in NED2 contract', async () => {
    const source = createBuiltinNed2DefinitionV4()
    const definition = {
      ...source,
      joints: source.joints.map((joint, index) => index === 0
        ? { ...joint, axis: [1, 0, 0] as const }
        : joint),
    }
    const load = vi.fn(async (_url: string) => triangleRoot())

    await expect(prepareBuiltinNed2GeometryV4(definition, { load }))
      .rejects.toMatchObject({ code: 'BUILTIN_NED2_DEFINITION_INVALID' })
    expect(load).not.toHaveBeenCalled()
  })
})
