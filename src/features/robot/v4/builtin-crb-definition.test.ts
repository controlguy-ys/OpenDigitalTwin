import { describe, expect, it, vi } from 'vitest'
import {
  BoxGeometry,
  BufferGeometry,
  Float32BufferAttribute,
  Group,
  Mesh,
  MeshStandardMaterial,
  type Object3D,
} from 'three'
import assetReport from '../../../../public/models/robot/asset-report.json'
import { canonicalProjectV4Json } from '../../../core/project-v4/canonical-json'
import { makeMinimalWorkcellProjectV4 } from '../../../core/project-v4/test-support'
import type { WorkcellProjectV4 } from '../../../core/project-v4/types'
import type { RobotDefinitionV4 } from '../../../core/project-v4/types'
import { validateWorkcellProjectV4 } from '../../../core/project-v4/validate'
import {
  BUILTIN_CRB_DEFINITION_ID_V4,
  createBuiltinCrbAssetReferencesV4,
  createBuiltinCrbDefinitionV4,
  prepareBuiltinCrbGeometryV4,
  type BuiltinCrbGeometryLoaderV4,
} from './builtin-crb-definition'

const ASSET_FACTS = [
  ['LINK00', 449_944, 'cc16b2240874d432b46e4c77bcf24f56121ad26e604a81b612650af050c1b801'],
  ['LINK01', 1_163_252, 'f65e5210c2f7dcc3d9c79b378b0e5435feeb757fda004d9f879df5ed51da2db1'],
  ['LINK02', 3_881_971, '9618cccd139b30bfeb56deaed045bb1b0af10bd2c2fef18a8973c218b03e1343'],
  ['LINK03', 1_486_284, 'fafb59b202bc72628f8cbaeb68a8fb1ae062faa254e18034f6cd8a2be4d43671'],
  ['LINK04', 3_624_189, '97654624273168c0a7369a8ffbad5b4651a74cae55210c08df5ef1b42bada7c1'],
  ['LINK05', 1_327_555, 'aa9908bef33bb89ccc7b27e19ab6a421f7deeac5fc908ec5414807e30e57e9bf'],
  ['LINK06', 746_156, '8a18f30a2ccf4ff0aad024d9f4cc8d257e5459148a013026c8ef1f03a90221c0'],
] as const

function builtinProject(): WorkcellProjectV4 {
  const base = makeMinimalWorkcellProjectV4()
  const definition = createBuiltinCrbDefinitionV4()
  return {
    ...base,
    assetReferences: createBuiltinCrbAssetReferencesV4(),
    robotDefinitions: [definition],
    robots: [{
      ...base.robots[0]!,
      definitionId: definition.id,
      initialJointValues: Object.fromEntries(definition.joints.map(({ id }) => [id, 0])),
      selectedToolFrameId: 'Tool',
      selectedTcpFrameId: 'TCP',
    }],
  }
}

function loadedRoot(
  geometry: BufferGeometry = new BoxGeometry(1, 1, 1),
  material = new MeshStandardMaterial(),
  occurrences = 1,
): Group {
  const root = new Group()
  for (let index = 0; index < occurrences; index += 1) {
    root.add(new Mesh(geometry, material))
  }
  return root
}

describe('built-in ABB CRB15000 Definition V4', () => {
  it('returns seven fresh immutable logical STEP identities with exact source facts', () => {
    const first = createBuiltinCrbAssetReferencesV4()
    const second = createBuiltinCrbAssetReferencesV4()
    expect(first).not.toBe(second)
    expect(first).toHaveLength(7)
    expect(Object.isFrozen(first)).toBe(true)

    first.forEach((asset, index) => {
      const [linkId, bytes, sha256] = ASSET_FACTS[index]!
      const suffix = linkId.slice(-2)
      expect(asset).not.toBe(second[index])
      expect(Object.isFrozen(asset)).toBe(true)
      expect(asset).toMatchObject({
        id: `builtin-abb-crb15000-12kg-127-link${suffix}-rev00`,
        uri: `builtin://abb/crb15000-12kg-127-link${suffix}@rev00`,
        byteLength: bytes,
        sha256,
        mediaType: 'model/step',
      })
      expect(asset.sourceFileName).toBe(assetReport.links[index]!.sourceFile)
    })
  })

  it('matches every checked-in statistic, bound, collision box, Joint, and Frame', () => {
    const first = createBuiltinCrbDefinitionV4()
    const second = createBuiltinCrbDefinitionV4()
    expect(first).not.toBe(second)
    expect(first.id).toBe(BUILTIN_CRB_DEFINITION_ID_V4)
    expect(first.links.map(({ id }) => id)).toEqual(assetReport.links.map(({ id }) => id))
    expect(first.joints.map(({ id }) => id)).toEqual(['J1', 'J2', 'J3', 'J4', 'J5', 'J6'])
    expect(first.joints.map((joint) => ({
      parent: joint.parentLinkId,
      child: joint.childLinkId,
      positionM: joint.origin.positionM,
      axis: joint.axis,
      limits: [joint.min, joint.max],
      home: joint.home,
      zeroOffset: joint.zeroOffset,
      direction: joint.direction,
      maximumVelocity: joint.maximumVelocity,
    }))).toEqual([
      { parent: 'LINK00', child: 'LINK01', positionM: [0, 0, 0.338], axis: [0, 0, 1], limits: [-270, 270], home: 0, zeroOffset: 0, direction: 1, maximumVelocity: 180 },
      { parent: 'LINK01', child: 'LINK02', positionM: [0, 0, 0], axis: [0, 1, 0], limits: [-180, 180], home: 0, zeroOffset: 0, direction: 1, maximumVelocity: 180 },
      { parent: 'LINK02', child: 'LINK03', positionM: [0, 0, 0.707], axis: [0, 1, 0], limits: [-225, 85], home: 0, zeroOffset: 0, direction: 1, maximumVelocity: 180 },
      { parent: 'LINK03', child: 'LINK04', positionM: [0, 0, 0.11], axis: [1, 0, 0], limits: [-180, 180], home: 0, zeroOffset: 0, direction: 1, maximumVelocity: 320 },
      { parent: 'LINK04', child: 'LINK05', positionM: [0.534, 0, 0], axis: [0, 1, 0], limits: [-180, 180], home: 0, zeroOffset: 0, direction: 1, maximumVelocity: 320 },
      { parent: 'LINK05', child: 'LINK06', positionM: [0.101, 0, 0.08], axis: [1, 0, 0], limits: [-270, 270], home: 0, zeroOffset: 0, direction: 1, maximumVelocity: 420 },
    ])
    expect(first.frames.map(({ id, role }) => [id, role])).toEqual([
      ['Base', 'base'],
      ['Flange', 'flange'],
      ['Tool0', 'tool0'],
      ['Tool', 'tool'],
      ['TCP', 'tcp'],
    ])
    expect(first.frames.find(({ id }) => id === 'Tool')?.localPose.quaternion)
      .toEqual([0, Math.SQRT1_2, 0, Math.SQRT1_2])
    expect(first.excludedGeometryOccurrenceKeys).toEqual([])
    expect(Object.values(first.sourceConventions)).toHaveLength(7)
    Object.values(first.sourceConventions).forEach((convention) => {
      expect(convention).toEqual({
        linearUnit: 'millimeter',
        sourceToMeters: 0.001,
        orientation: { mode: 'up-axis', upAxis: 'z' },
      })
    })
    expect(Object.isFrozen(first)).toBe(true)
    expect(first.links[0]!.geometryOccurrences[0]).not.toBe(
      second.links[0]!.geometryOccurrences[0],
    )
    expect(first.links[0]!.geometryOccurrences[0]!.linkLocalPose).not.toBe(
      second.links[0]!.geometryOccurrences[0]!.linkLocalPose,
    )
    expect(first.joints[0]!.origin).not.toBe(second.joints[0]!.origin)
    expect(first.frames[0]!.localPose).not.toBe(second.frames[0]!.localPose)

    let vertices = 0
    let triangles = 0
    first.links.forEach((link, index) => {
      const report = assetReport.links[index]!
      const occurrence = link.geometryOccurrences[0]!
      expect(link).not.toBe(second.links[index])
      expect(occurrence.occurrenceKey).toBe(`whole-source:${link.id}`)
      expect(occurrence.statistics).toEqual({
        vertices: report.source.vertexCount,
        triangles: report.source.triangleCount,
        meshes: report.generated.meshCount,
        materials: report.generated.materialColors.length,
      })
      const bounds = report.generated.localBounds
      const expectedCenter = bounds.min.map((value, axis) => (
        (value + bounds.max[axis]!) / 2
      ))
      const expectedHalfExtents = bounds.min.map((value, axis) => (
        (bounds.max[axis]! - value) / 2
      ))
      expect(occurrence.collisionBoxes).toEqual([{
        id: 'generated-local-bounds',
        centerM: expectedCenter,
        halfExtentsM: expectedHalfExtents,
        quaternion: [0, 0, 0, 1],
      }])
      vertices += occurrence.statistics.vertices
      triangles += occurrence.statistics.triangles
    })
    expect(vertices).toBe(51_925)
    expect(triangles).toBe(65_355)
  })

  it('embeds as a valid Project without GLB, bytes, or physical paths in canonical JSON', () => {
    const project = validateWorkcellProjectV4(builtinProject())
    const canonical = canonicalProjectV4Json(project)
    expect(canonical).not.toContain('.glb')
    expect(canonical).not.toContain('C:\\')
    expect(canonical).not.toMatch(/"\/(?:Users|home)\//)
    expect(canonical).not.toContain('STEP bytes')
  })

  it('prepares seven private GLB derivatives and counts rendered Mesh occurrences', async () => {
    const geometries: BoxGeometry[] = []
    const materials: MeshStandardMaterial[] = []
    const loader: BuiltinCrbGeometryLoaderV4 = {
      load: vi.fn(async (url: string): Promise<Object3D> => {
        expect(url).toMatch(/^\/models\/robot\/LINK0[0-6]\.glb$/)
        const geometry = new BoxGeometry(1, 1, 1)
        const material = new MeshStandardMaterial()
        geometries.push(geometry)
        materials.push(material)
        return loadedRoot(geometry, material, url.endsWith('LINK00.glb') ? 2 : 1)
      }),
    }

    const prepared = await prepareBuiltinCrbGeometryV4(
      createBuiltinCrbDefinitionV4(),
      loader,
    )

    expect(loader.load).toHaveBeenCalledTimes(7)
    expect([...prepared.linkTemplates.keys()]).toEqual(
      ['LINK00', 'LINK01', 'LINK02', 'LINK03', 'LINK04', 'LINK05', 'LINK06'],
    )
    expect(prepared.sharedGeometry.size).toBe(7)
    expect(prepared.triangleCount).toBe(8 * 12)
    const geometryDisposals = geometries.map((geometry) => vi.spyOn(geometry, 'dispose'))
    const materialDisposals = materials.map((material) => vi.spyOn(material, 'dispose'))
    prepared.dispose()
    prepared.dispose()
    geometryDisposals.forEach((dispose) => expect(dispose).toHaveBeenCalledOnce())
    materialDisposals.forEach((dispose) => expect(dispose).toHaveBeenCalledOnce())
  })

  it('accepts the canonical Definition returned by Project V4 validation', async () => {
    const validated = validateWorkcellProjectV4(builtinProject()).robotDefinitions[0]!
    const loader: BuiltinCrbGeometryLoaderV4 = {
      load: vi.fn(async () => loadedRoot()),
    }

    const prepared = await prepareBuiltinCrbGeometryV4(validated, loader)

    expect(loader.load).toHaveBeenCalledTimes(7)
    expect(prepared.definitionId).toBe(BUILTIN_CRB_DEFINITION_ID_V4)
    prepared.dispose()
  })

  it('rejects a non-built-in Definition before invoking the loader', async () => {
    const loader: BuiltinCrbGeometryLoaderV4 = { load: vi.fn() }
    const mismatched = {
      ...createBuiltinCrbDefinitionV4(),
      id: 'not-the-built-in-definition',
    }
    await expect(prepareBuiltinCrbGeometryV4(mismatched, loader)).rejects.toThrow(
      /BUILTIN_CRB_DEFINITION_INVALID/,
    )
    expect(loader.load).not.toHaveBeenCalled()
  })

  it('rejects mechanically or geometrically altered same-ID built-in Definitions', async () => {
    const mutations: Array<(definition: RobotDefinitionV4) => void> = [
      (definition) => {
        ;(definition.joints[0]!.axis as unknown as number[])[0] = 1
      },
      (definition) => {
        ;(definition.frames[0]!.localPose.positionM as unknown as number[])[0] = 1
      },
      (definition) => {
        const occurrence = definition.links[0]!.geometryOccurrences[0]!
        ;(occurrence.statistics as unknown as { triangles: number }).triangles += 1
      },
    ]

    for (const mutate of mutations) {
      const loader: BuiltinCrbGeometryLoaderV4 = { load: vi.fn() }
      const candidate = structuredClone(createBuiltinCrbDefinitionV4())
      mutate(candidate)
      await expect(prepareBuiltinCrbGeometryV4(candidate, loader)).rejects.toThrow(
        /BUILTIN_CRB_DEFINITION_INVALID/,
      )
      expect(loader.load).not.toHaveBeenCalled()
    }
  })

  it('waits for late loader settlements and disposes every fulfilled unique resource once', async () => {
    const roots = new Map<string, Group>()
    let resolveLate: ((root: Group) => void) | null = null
    const loader: BuiltinCrbGeometryLoaderV4 = {
      load: vi.fn((url: string): Promise<Object3D> => {
        if (url.endsWith('LINK01.glb')) return Promise.reject(new Error('loader failed'))
        const root = loadedRoot()
        roots.set(url, root)
        if (url.endsWith('LINK02.glb')) {
          return new Promise((resolve) => {
            resolveLate = resolve
          })
        }
        return Promise.resolve(root)
      }),
    }
    const operation = prepareBuiltinCrbGeometryV4(createBuiltinCrbDefinitionV4(), loader)
    await Promise.resolve()
    const lateRoot = roots.get('/models/robot/LINK02.glb')!
    const lateGeometry = (lateRoot.children[0] as Mesh).geometry
    const lateMaterial = (lateRoot.children[0] as Mesh).material as MeshStandardMaterial
    const lateGeometryDispose = vi.spyOn(lateGeometry, 'dispose')
    const lateMaterialDispose = vi.spyOn(lateMaterial, 'dispose')
    if (resolveLate === null) throw new Error('Late loader was not started.')
    ;(resolveLate as (root: Group) => void)(lateRoot)

    await expect(operation).rejects.toThrow('loader failed')
    expect(lateGeometryDispose).toHaveBeenCalledOnce()
    expect(lateMaterialDispose).toHaveBeenCalledOnce()
  })

  it('contains synchronous loader throws and still starts, settles, and cleans all seven loads', async () => {
    const roots = Array.from({ length: 7 }, () => loadedRoot())
    let resolveLate: ((root: Group) => void) | null = null
    const lateGeometry = (roots[0]!.children[0] as Mesh).geometry
    const laterGeometry = (roots[2]!.children[0] as Mesh).geometry
    const lateDispose = vi.spyOn(lateGeometry, 'dispose')
    const laterDispose = vi.spyOn(laterGeometry, 'dispose')
    const loader: BuiltinCrbGeometryLoaderV4 = {
      load: vi.fn((url: string): Promise<Object3D> => {
        const index = Number(url.match(/LINK0([0-6])/u)?.[1])
        if (index === 1) throw new Error('synchronous loader failure')
        if (index === 0) {
          return new Promise((resolve) => {
            resolveLate = resolve
          })
        }
        return Promise.resolve(roots[index]!)
      }),
    }
    const operation = prepareBuiltinCrbGeometryV4(createBuiltinCrbDefinitionV4(), loader)
    await Promise.resolve()
    expect(loader.load).toHaveBeenCalledTimes(7)
    if (resolveLate === null) throw new Error('Late loader was not started.')
    ;(resolveLate as (root: Group) => void)(roots[0]!)

    await expect(operation).rejects.toThrow('synchronous loader failure')
    expect(lateDispose).toHaveBeenCalledOnce()
    expect(laterDispose).toHaveBeenCalledOnce()
  })

  it('disposes malformed fulfilled Geometry without re-running triangle validation', async () => {
    const malformedGeometry = new BufferGeometry()
    malformedGeometry.setAttribute('position', new Float32BufferAttribute([
      0, 0, 0,
      1, 0, 0,
      0, 1, 0,
      1, 1, 0,
    ], 3))
    const malformedMaterial = new MeshStandardMaterial()
    const geometryDispose = vi.spyOn(malformedGeometry, 'dispose')
    const materialDispose = vi.spyOn(malformedMaterial, 'dispose')
    const loader: BuiltinCrbGeometryLoaderV4 = {
      load: vi.fn(async (url: string) => (
        url.endsWith('LINK00.glb')
          ? loadedRoot(malformedGeometry, malformedMaterial)
          : loadedRoot()
      )),
    }

    await expect(prepareBuiltinCrbGeometryV4(
      createBuiltinCrbDefinitionV4(),
      loader,
    )).rejects.toThrow(/BUILTIN_CRB_GEOMETRY_TRIANGLES_INVALID/)
    expect(geometryDispose).toHaveBeenCalledOnce()
    expect(materialDispose).toHaveBeenCalledOnce()
  })

  it('attempts every cleanup while preserving a primary preparation failure', async () => {
    const roots = Array.from({ length: 7 }, () => loadedRoot())
    const firstGeometry = (roots[0]!.children[0] as Mesh).geometry
    const secondGeometry = (roots[1]!.children[0] as Mesh).geometry
    const firstMaterial = (roots[0]!.children[0] as Mesh).material as MeshStandardMaterial
    const secondMaterial = (roots[1]!.children[0] as Mesh).material as MeshStandardMaterial
    vi.spyOn(firstGeometry, 'dispose').mockImplementationOnce(() => {
      throw new Error('cleanup failed')
    })
    const secondGeometryDispose = vi.spyOn(secondGeometry, 'dispose')
    const firstMaterialDispose = vi.spyOn(firstMaterial, 'dispose')
    const secondMaterialDispose = vi.spyOn(secondMaterial, 'dispose')
    const loader: BuiltinCrbGeometryLoaderV4 = {
      load: vi.fn(async (url: string) => {
        const index = Number(url.match(/LINK0([0-6])/u)?.[1])
        if (index === 6) throw new Error('primary loader failure')
        return roots[index]!
      }),
    }

    await expect(prepareBuiltinCrbGeometryV4(
      createBuiltinCrbDefinitionV4(),
      loader,
    )).rejects.toThrow('primary loader failure')
    expect(secondGeometryDispose).toHaveBeenCalledOnce()
    expect(firstMaterialDispose).toHaveBeenCalledOnce()
    expect(secondMaterialDispose).toHaveBeenCalledOnce()
  })

  it('attempts every successful-generation disposal and rethrows the first cleanup error', async () => {
    const roots = Array.from({ length: 7 }, () => loadedRoot())
    const firstGeometry = (roots[0]!.children[0] as Mesh).geometry
    const secondGeometry = (roots[1]!.children[0] as Mesh).geometry
    vi.spyOn(firstGeometry, 'dispose').mockImplementationOnce(() => {
      throw new Error('first cleanup failure')
    })
    const secondGeometryDispose = vi.spyOn(secondGeometry, 'dispose')
    const loader: BuiltinCrbGeometryLoaderV4 = {
      load: vi.fn(async (url: string) => {
        const index = Number(url.match(/LINK0([0-6])/u)?.[1])
        return roots[index]!
      }),
    }
    const prepared = await prepareBuiltinCrbGeometryV4(
      createBuiltinCrbDefinitionV4(),
      loader,
    )

    expect(() => prepared.dispose()).toThrow('first cleanup failure')
    expect(secondGeometryDispose).toHaveBeenCalledOnce()
  })
})
