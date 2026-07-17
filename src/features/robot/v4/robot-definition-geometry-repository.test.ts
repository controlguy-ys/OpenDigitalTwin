import { describe, expect, it, vi } from 'vitest'
import {
  BoxGeometry,
  BufferGeometry,
  Group,
  Line,
  LineBasicMaterial,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  Points,
  PointsMaterial,
} from 'three'
import type {
  RobotDefinitionV4,
  RobotLinkIdV4,
} from '../../../core/project-v4/types'
import { makeMinimalWorkcellProjectV4 } from '../../../core/project-v4/test-support'
import {
  createPreparedRobotDefinitionGeometryV4,
  createRobotDefinitionGeometryRepositoryV4,
  type PreparedRobotDefinitionGeometryV4,
  type RobotDefinitionGeometryPublicationHandleV4,
} from './robot-definition-geometry-repository'

function definition(
  id = 'definition-1',
  linkIds: readonly string[] = ['L0', 'L1'],
): RobotDefinitionV4 {
  const base = makeMinimalWorkcellProjectV4().robotDefinitions[0]!
  return {
    ...base,
    id,
    links: linkIds.map((linkId) => ({
      id: linkId,
      name: linkId,
      geometryOccurrences: [],
    })),
    joints: linkIds.slice(1).map((linkId, index) => ({
      id: `joint-${index}`,
      type: 'revolute' as const,
      parentLinkId: linkIds[index]!,
      childLinkId: linkId,
      origin: { positionM: [0, 0, 0], quaternion: [0, 0, 0, 1] },
      axis: [0, 0, 1],
      min: -180,
      max: 180,
      home: 0,
      zeroOffset: 0,
      direction: 1 as const,
      maximumVelocity: 90,
    })),
    frames: [],
  }
}

function prepared(
  robotDefinition = definition(),
  disposeResources: () => void = vi.fn(),
  templateLinkIds: readonly string[] = robotDefinition.links.map(({ id }) => id),
): {
  readonly resource: PreparedRobotDefinitionGeometryV4
  readonly geometry: BoxGeometry
  readonly templates: Map<RobotLinkIdV4, Group>
  readonly geometries: Set<BoxGeometry>
  readonly disposeResources: () => void
} {
  const geometry = new BoxGeometry(1, 1, 1)
  const templates = new Map(templateLinkIds.map((linkId) => {
    const root = new Group()
    root.name = `template:${linkId}`
    root.add(new Mesh(geometry, new MeshStandardMaterial({ color: '#ffffff' })))
    return [linkId, root] as const
  }))
  const geometries = new Set([geometry])
  return {
    resource: createPreparedRobotDefinitionGeometryV4({
      definitionId: robotDefinition.id,
      linkTemplates: templates,
      sharedGeometry: geometries,
      triangleCount: 12,
      disposeResources,
    }),
    geometry,
    templates,
    geometries,
    disposeResources,
  }
}

function firstMesh(root: Group): Mesh {
  let result: Mesh | null = null
  root.traverse((object) => {
    if (result === null && object instanceof Mesh) result = object
  })
  if (result === null) throw new Error('Expected a Mesh.')
  return result
}

describe('Robot Definition Geometry repository V4', () => {
  it('publishes an UNRESOLVED same-Definition generation without leasing stale Geometry', () => {
    const robotDefinition = definition()
    const source = prepared(robotDefinition)
    const repository = createRobotDefinitionGeometryRepositoryV4()
    const resolvedHandle = repository.stage(robotDefinition, source.resource)
    repository.commitBatch([resolvedHandle])
    const notifications: number[] = []
    repository.subscribe(() => notifications.push(repository.getSnapshot()))

    const unresolvedHandle = repository.stageUnresolved(robotDefinition, 44)

    expect(repository.readCurrent(robotDefinition.id)).toMatchObject({
      handle: resolvedHandle,
      resolution: 'RESOLVED',
      triangleCount: 12,
    })
    expect(repository.acquire(robotDefinition.id, 'robot-a', unresolvedHandle)).toBeNull()

    repository.commitBatch([unresolvedHandle])

    expect(repository.readCurrent(robotDefinition.id)).toEqual({
      definitionId: robotDefinition.id,
      handle: unresolvedHandle,
      resolution: 'UNRESOLVED',
      triangleCount: 44,
    })
    expect(repository.acquire(robotDefinition.id, 'robot-a')).toBeNull()
    expect(repository.acquire(robotDefinition.id, 'robot-a', resolvedHandle)).not.toBeNull()
    expect(notifications).toEqual([2])

    repository.revoke(unresolvedHandle)
    expect(repository.readCurrent(robotDefinition.id)).toMatchObject({
      handle: resolvedHandle,
      resolution: 'RESOLVED',
    })
  })

  it('rolls back an UNRESOLVED staged generation without notification', () => {
    const robotDefinition = definition()
    const repository = createRobotDefinitionGeometryRepositoryV4()
    const listener = vi.fn()
    repository.subscribe(listener)

    const handle = repository.stageUnresolved(robotDefinition, 0)
    repository.rollback(handle)

    expect(repository.readCurrent(robotDefinition.id)).toBeNull()
    expect(listener).not.toHaveBeenCalled()
  })

  it('shares immutable BufferGeometry while leasing distinct roots and materials', () => {
    const robotDefinition = definition()
    const source = prepared(robotDefinition)
    const repository = createRobotDefinitionGeometryRepositoryV4()
    const handle = repository.stage(robotDefinition, source.resource)
    repository.commitBatch([handle])

    const a = repository.acquire(robotDefinition.id, 'robot-a', handle)!
    const b = repository.acquire(robotDefinition.id, 'robot-b', handle)!
    const aMesh = firstMesh(a.linkRoots.get('L0')!)
    const bMesh = firstMesh(b.linkRoots.get('L0')!)

    expect(a.instanceRoot).not.toBe(b.instanceRoot)
    expect(a.linkRoots.get('L0')).not.toBe(b.linkRoots.get('L0'))
    expect(aMesh.geometry).toBe(source.geometry)
    expect(bMesh.geometry).toBe(source.geometry)
    expect(aMesh.material).not.toBe(bMesh.material)

    a.release()
    expect(source.disposeResources).not.toHaveBeenCalled()
    repository.revoke(handle)
    expect(source.disposeResources).not.toHaveBeenCalled()
    b.release()
    expect(source.disposeResources).toHaveBeenCalledOnce()
    b.release()
    repository.revoke(handle)
    expect(source.disposeResources).toHaveBeenCalledOnce()
  })

  it('preserves source material sharing inside one lease while isolating leases', () => {
    const robotDefinition = definition()
    const source = prepared(robotDefinition)
    const template = source.resource.linkTemplates.get('L0')!
    const sourceMaterial = new MeshStandardMaterial({ color: '#abcdef' })
    template.clear()
    template.add(
      new Mesh(source.geometry, sourceMaterial),
      new Mesh(source.geometry, sourceMaterial),
    )
    const repository = createRobotDefinitionGeometryRepositoryV4()
    const handle = repository.stage(robotDefinition, source.resource)
    repository.commitBatch([handle])
    const a = repository.acquire(robotDefinition.id, 'robot-a')!
    const b = repository.acquire(robotDefinition.id, 'robot-b')!
    const aMeshes: Mesh[] = []
    const bMeshes: Mesh[] = []
    a.linkRoots.get('L0')!.traverse((object) => {
      if (object instanceof Mesh) aMeshes.push(object)
    })
    b.linkRoots.get('L0')!.traverse((object) => {
      if (object instanceof Mesh) bMeshes.push(object)
    })
    expect(aMeshes[0]!.material).toBe(aMeshes[1]!.material)
    expect(bMeshes[0]!.material).toBe(bMeshes[1]!.material)
    expect(aMeshes[0]!.material).not.toBe(bMeshes[0]!.material)
    a.release()
    b.release()
    repository.revoke(handle)
  })

  it('isolates mutable Line and Points materials across leases', () => {
    const robotDefinition = definition()
    const source = prepared(robotDefinition)
    const template = source.resource.linkTemplates.get('L0')!
    const lineMaterial = new LineBasicMaterial()
    const pointsMaterial = new PointsMaterial()
    template.clear()
    template.add(
      new Line(new BufferGeometry(), lineMaterial),
      new Points(new BufferGeometry(), pointsMaterial),
    )
    const repository = createRobotDefinitionGeometryRepositoryV4()
    const handle = repository.stage(robotDefinition, source.resource)
    repository.commitBatch([handle])
    const a = repository.acquire(robotDefinition.id, 'robot-a')!
    const b = repository.acquire(robotDefinition.id, 'robot-b')!
    const aLine = a.linkRoots.get('L0')!.getObjectByProperty('type', 'Line') as Line
    const bLine = b.linkRoots.get('L0')!.getObjectByProperty('type', 'Line') as Line
    const aPoints = a.linkRoots.get('L0')!.getObjectByProperty('type', 'Points') as Points
    const bPoints = b.linkRoots.get('L0')!.getObjectByProperty('type', 'Points') as Points
    expect(aLine.material).not.toBe(lineMaterial)
    expect(aLine.material).not.toBe(bLine.material)
    expect(aPoints.material).not.toBe(pointsMaterial)
    expect(aPoints.material).not.toBe(bPoints.material)
    a.release()
    b.release()
    repository.revoke(handle)
  })

  it('rolls back a failed lease clone without leaking generation ownership', () => {
    const robotDefinition = definition()
    const source = prepared(robotDefinition)
    class ThrowingClone extends Object3D {
      override clone(_recursive?: boolean): this {
        throw new Error('clone failed')
      }
    }
    source.resource.linkTemplates.get('L1')!.add(new ThrowingClone())
    const repository = createRobotDefinitionGeometryRepositoryV4()
    const handle = repository.stage(robotDefinition, source.resource)
    repository.commitBatch([handle])
    expect(() => repository.acquire(robotDefinition.id, 'robot-a')).toThrow('clone failed')
    repository.revoke(handle)
    expect(source.disposeResources).toHaveBeenCalledOnce()
  })

  it('finalizes lease and repository state even when resource disposal throws', () => {
    const robotDefinition = definition()
    const source = prepared(robotDefinition)
    const repository = createRobotDefinitionGeometryRepositoryV4()
    const handle = repository.stage(robotDefinition, source.resource)
    repository.commitBatch([handle])
    const lease = repository.acquire(robotDefinition.id, 'robot-a')!
    const leasedMaterial = firstMesh(lease.linkRoots.get('L0')!).material as MeshStandardMaterial
    vi.spyOn(leasedMaterial, 'dispose').mockImplementationOnce(() => {
      throw new Error('material dispose failed')
    })
    repository.revoke(handle)
    expect(() => lease.release()).toThrow('material dispose failed')
    expect(source.disposeResources).toHaveBeenCalledOnce()
    expect(() => lease.release()).not.toThrow()

    const throwingSource = prepared(definition('throwing-definition'), () => {
      throw new Error('shared dispose failed')
    })
    const throwingDefinition = definition('throwing-definition')
    const throwingHandle = repository.stage(throwingDefinition, throwingSource.resource)
    repository.commitBatch([throwingHandle])
    const listener = vi.fn()
    repository.subscribe(listener)
    const before = repository.getSnapshot()
    expect(() => repository.revoke(throwingHandle)).toThrow('shared dispose failed')
    expect(repository.readCurrent(throwingDefinition.id)).toBeNull()
    expect(repository.getSnapshot()).toBe(before + 1)
    expect(listener).toHaveBeenCalledOnce()
  })

  it('snapshots caller collections before preparation and staging', () => {
    const robotDefinition = definition()
    const source = prepared(robotDefinition)
    source.templates.clear()
    source.geometries.clear()

    expect([...source.resource.linkTemplates.keys()]).toEqual(['L0', 'L1'])
    expect([...source.resource.sharedGeometry]).toEqual([source.geometry])
    expect(() => (source.resource.linkTemplates as unknown as Map<string, Group>)
      .set('mutated', new Group())).toThrow(TypeError)
    expect(() => (source.resource.sharedGeometry as unknown as Set<BoxGeometry>)
      .add(new BoxGeometry())).toThrow(TypeError)

    const repository = createRobotDefinitionGeometryRepositoryV4()
    const handle = repository.stage(robotDefinition, source.resource)
    source.templates.set('later', new Group())
    source.geometries.add(new BoxGeometry())
    repository.commitBatch([handle])
    const lease = repository.acquire(robotDefinition.id, 'robot-a')!
    expect([...lease.linkRoots.keys()]).toEqual(['L0', 'L1'])
    expect([...lease.sharedGeometry]).toEqual([source.geometry])
    lease.release()
    repository.revoke(handle)
  })

  it('snapshots staged Definition topology and validates Robot identity before leasing', () => {
    const robotDefinition = definition()
    const source = prepared(robotDefinition)
    const repository = createRobotDefinitionGeometryRepositoryV4()
    const handle = repository.stage(robotDefinition, source.resource)
    ;(robotDefinition.links as unknown as Array<{ id: string }>)[0]!.id = 'caller-mutated-link'
    ;(robotDefinition.joints as unknown as Array<{ parentLinkId: string }>)[0]!.parentLinkId = 'caller-mutated-link'
    repository.commitBatch([handle])

    const lease = repository.acquire(robotDefinition.id, 'robot-a')!
    expect([...lease.linkRoots.keys()]).toEqual(['L0', 'L1'])
    lease.release()
    expect(() => repository.acquire(robotDefinition.id, '\ud800')).toThrowError(
      /Runtime identity segment must contain valid Unicode/,
    )
    repository.revoke(handle)
    expect(source.disposeResources).toHaveBeenCalledOnce()
  })

  it('rejects forged, mismatched, incomplete, extra, reused, and disposed resources pre-mutation', () => {
    const robotDefinition = definition()
    const repository = createRobotDefinitionGeometryRepositoryV4()
    const valid = prepared(robotDefinition)
    const forged = {
      ...valid.resource,
      lifecycleState: 'READY',
    } as unknown as PreparedRobotDefinitionGeometryV4
    expect(() => repository.stage(robotDefinition, forged)).toThrowError(/ROBOT_GEOMETRY_PREPARED_RESOURCE_INVALID/)

    const mismatch = prepared({ ...robotDefinition, id: 'other-definition' })
    expect(() => repository.stage(robotDefinition, mismatch.resource)).toThrowError(/ROBOT_GEOMETRY_DEFINITION_MISMATCH/)
    expect(mismatch.disposeResources).not.toHaveBeenCalled()

    const missing = prepared(robotDefinition, vi.fn(), ['L0'])
    expect(() => repository.stage(robotDefinition, missing.resource)).toThrowError(/ROBOT_GEOMETRY_LINK_TEMPLATE_SET_MISMATCH/)
    expect(missing.disposeResources).not.toHaveBeenCalled()

    const extraDefinition = definition('definition-extra', ['L0', 'L1'])
    const extra = prepared(extraDefinition, vi.fn(), ['L0', 'L1', 'extra'])
    expect(() => repository.stage(extraDefinition, extra.resource)).toThrowError(/ROBOT_GEOMETRY_LINK_TEMPLATE_SET_MISMATCH/)
    expect(extra.disposeResources).not.toHaveBeenCalled()

    const owned = prepared(robotDefinition)
    const ownedHandle = repository.stage(robotDefinition, owned.resource)
    expect(() => repository.stage(robotDefinition, owned.resource)).toThrowError(/ROBOT_GEOMETRY_PREPARED_RESOURCE_INVALID/)
    owned.resource.dispose()
    expect(owned.resource.lifecycleState).toBe('READY')
    expect(owned.disposeResources).not.toHaveBeenCalled()
    repository.rollback(ownedHandle)
    expect(owned.disposeResources).toHaveBeenCalledOnce()

    const disposed = prepared(definition('disposed-definition'))
    disposed.resource.dispose()
    expect(() => repository.stage(definition('disposed-definition'), disposed.resource)).toThrowError(/ROBOT_GEOMETRY_PREPARED_RESOURCE_INVALID/)
  })

  it('keeps staged generations invisible and supports exact-handle rollback without notification', () => {
    const robotDefinition = definition()
    const repository = createRobotDefinitionGeometryRepositoryV4()
    const listener = vi.fn()
    repository.subscribe(listener)
    const a = prepared(robotDefinition)
    const handleA = repository.stage(robotDefinition, a.resource)

    expect(repository.readCurrent(robotDefinition.id)).toBeNull()
    expect(repository.acquire(robotDefinition.id, 'robot-a')).toBeNull()
    const stagedLease = repository.acquire(robotDefinition.id, 'robot-a', handleA)!
    expect(stagedLease).not.toBeNull()
    stagedLease.release()
    expect(listener).not.toHaveBeenCalled()

    repository.commitBatch([handleA])
    expect(repository.readCurrent(robotDefinition.id)?.handle).toBe(handleA)
    expect(listener).toHaveBeenCalledOnce()

    const b = prepared(robotDefinition)
    const handleB = repository.stage(robotDefinition, b.resource)
    const exactB = repository.acquire(robotDefinition.id, 'robot-b', handleB)!
    expect(repository.acquire(robotDefinition.id, 'robot-current')?.publicationHandle).toBe(handleA)
    repository.rollback(handleB)
    expect(listener).toHaveBeenCalledOnce()
    expect(b.disposeResources).not.toHaveBeenCalled()
    exactB.release()
    expect(b.disposeResources).toHaveBeenCalledOnce()
    repository.rollback(handleB)
  })

  it('restores the newest older committed generation when a replacement is revoked', () => {
    const robotDefinition = definition()
    const repository = createRobotDefinitionGeometryRepositoryV4()
    const a = prepared(robotDefinition)
    const handleA = repository.stage(robotDefinition, a.resource)
    repository.commitBatch([handleA])
    const heldA = repository.acquire(robotDefinition.id, 'held-a', handleA)!

    const b = prepared(robotDefinition)
    const handleB = repository.stage(robotDefinition, b.resource)
    repository.commitBatch([handleB])
    expect(repository.readCurrent(robotDefinition.id)?.handle).toBe(handleB)
    repository.revoke(handleB)
    expect(repository.readCurrent(robotDefinition.id)?.handle).toBe(handleA)
    const againA = repository.acquire(robotDefinition.id, 'again-a')!
    expect(againA.publicationHandle).toBe(handleA)
    expect(b.disposeResources).toHaveBeenCalledOnce()
    expect(a.disposeResources).not.toHaveBeenCalled()

    heldA.release()
    againA.release()
    repository.revoke(handleA)
    expect(a.disposeResources).toHaveBeenCalledOnce()
  })

  it('commits multiple Definitions atomically with one first-observer notification', () => {
    const definitionA = definition('definition-a')
    const definitionB = definition('definition-b')
    const repository = createRobotDefinitionGeometryRepositoryV4()
    const handleA = repository.stage(definitionA, prepared(definitionA).resource)
    const handleB = repository.stage(definitionB, prepared(definitionB).resource)
    const observed: Array<readonly [unknown, unknown]> = []
    repository.subscribe(() => {
      observed.push([
        repository.readCurrent(definitionA.id)?.handle,
        repository.readCurrent(definitionB.id)?.handle,
      ])
    })

    repository.commitBatch([handleA, handleB])

    expect(observed).toEqual([[handleA, handleB]])
    expect(repository.getSnapshot()).toBe(1)
  })

  it('validates a complete batch before mutation', () => {
    const robotDefinition = definition()
    const repository = createRobotDefinitionGeometryRepositoryV4()
    const handleA = repository.stage(robotDefinition, prepared(robotDefinition).resource)
    const handleB = repository.stage(robotDefinition, prepared(robotDefinition).resource)
    const forged = Object.freeze({
      kind: 'robot-definition-geometry-publication-v4' as const,
    }) as RobotDefinitionGeometryPublicationHandleV4

    expect(() => repository.commitBatch([handleA, handleA])).toThrowError(/ROBOT_GEOMETRY_PUBLICATION_BATCH_INVALID/)
    expect(() => repository.commitBatch([])).toThrowError(/ROBOT_GEOMETRY_PUBLICATION_BATCH_INVALID/)
    expect(() => repository.commitBatch([handleA, handleB])).toThrowError(/ROBOT_GEOMETRY_PUBLICATION_BATCH_INVALID/)
    expect(() => repository.commitBatch([handleA, forged])).toThrowError(/ROBOT_GEOMETRY_PUBLICATION_HANDLE_INVALID/)
    expect(repository.readCurrent(robotDefinition.id)).toBeNull()
    expect(repository.getSnapshot()).toBe(0)
    repository.commitBatch([handleA])
    expect(repository.readCurrent(robotDefinition.id)?.handle).toBe(handleA)
    expect(repository.getSnapshot()).toBe(1)
  })

  it('keeps ownership and notifications exact across repositories and non-current revoke', () => {
    const definitionA = definition('definition-a')
    const definitionB = definition('definition-b')
    const sourceA = prepared(definitionA)
    const repository = createRobotDefinitionGeometryRepositoryV4()
    const foreignRepository = createRobotDefinitionGeometryRepositoryV4()
    const handleA = repository.stage(definitionA, sourceA.resource)
    expect(() => foreignRepository.stage(definitionA, sourceA.resource)).toThrowError(
      /ROBOT_GEOMETRY_PREPARED_RESOURCE_INVALID/,
    )
    repository.commitBatch([handleA])

    const replacementA = prepared(definitionA)
    const replacementHandle = repository.stage(definitionA, replacementA.resource)
    repository.commitBatch([replacementHandle])
    const listener = vi.fn()
    repository.subscribe(listener)
    repository.revoke(handleA)
    expect(listener).not.toHaveBeenCalled()
    expect(repository.readCurrent(definitionA.id)?.handle).toBe(replacementHandle)
    expect(repository.acquire(definitionB.id, 'robot-b', replacementHandle)).toBeNull()

    const reusable = prepared(definitionB)
    expect(() => repository.stage(definitionA, reusable.resource)).toThrowError(
      /ROBOT_GEOMETRY_DEFINITION_MISMATCH/,
    )
    const reusableHandle = repository.stage(definitionB, reusable.resource)
    repository.rollback(reusableHandle)
  })

  it('pins exact handles and rejects foreign handles or exhausted generations pre-mutation', () => {
    const robotDefinition = definition()
    const repository = createRobotDefinitionGeometryRepositoryV4()
    const foreignRepository = createRobotDefinitionGeometryRepositoryV4()
    const foreign = foreignRepository.stage(robotDefinition, prepared(robotDefinition).resource)
    expect(() => repository.acquire(robotDefinition.id, 'robot-a', foreign)).toThrowError(/ROBOT_GEOMETRY_PUBLICATION_HANDLE_INVALID/)

    const exhausted = createRobotDefinitionGeometryRepositoryV4({
      initialGenerationForTesting: Number.MAX_SAFE_INTEGER,
    })
    const candidate = prepared(robotDefinition)
    expect(() => exhausted.stage(robotDefinition, candidate.resource)).toThrowError(/ROBOT_GEOMETRY_PUBLICATION_GENERATION_EXHAUSTED/)
    expect(candidate.disposeResources).not.toHaveBeenCalled()
    expect(exhausted.getSnapshot()).toBe(0)
  })
})
