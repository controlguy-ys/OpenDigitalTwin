import { describe, expect, it, vi } from 'vitest'
import type { ObjectAssetRecordV2, ObjectInstanceRecordV1 } from '../../domain/project/project'
import {
  validateWorkcellProjectSnapshotV3,
  type WorkcellProjectSnapshotV3,
} from '../../domain/project/project-v3'
import type { SceneEntityV1 } from '../../domain/project/scene-state-v1'
import { worldPoseForEntity } from '../../domain/scene/scene-transform'
import type { StoredWorkcellProjectSnapshotProjectionV3 } from '../project/project-db'
import type { ProjectMutationService } from '../project/project-mutation-service'
import { repositoryProjectFixture } from '../project/project-revision-repository.test-support'
import { createSceneCommandService } from './scene-command-service'

const IDENTITY_POSE = {
  positionM: [0, 0, 0] as const,
  quaternion: [0, 0, 0, 1] as const,
}

function robot(): SceneEntityV1 {
  return {
    kind: 'robot',
    id: 'robot:active',
    name: 'Robot',
    parentId: null,
    localPose: IDENTITY_POSE,
    visible: true,
  }
}

function linearAxis(
  overrides: Partial<Extract<SceneEntityV1, { kind: 'linear-axis' }>> = {},
): Extract<SceneEntityV1, { kind: 'linear-axis' }> {
  return {
    kind: 'linear-axis', id: 'linear-axis:active', name: 'Linear Axis', parentId: null,
    localPose: IDENTITY_POSE, visible: true, direction: 'x', minPositionM: -1,
    maxPositionM: 2, homePositionM: 0.25, currentPositionM: 0.5,
    carriageEntityId: null, robotEntityId: null,
    ...overrides,
  }
}

function projection(
  entities: readonly SceneEntityV1[] = [robot()],
): StoredWorkcellProjectSnapshotProjectionV3 {
  return {
    scene: { entities, robotMountContact: null },
    objectAssets: [],
    objectInstances: [],
    builtInEquipment: [],
    opcUa: { numericStatusBindings: [], equipmentTransforms: [] },
    collisionPolicy: { ignoredPairKeys: [], enabledRobotSelfPairs: [] },
  } as unknown as StoredWorkcellProjectSnapshotProjectionV3
}

function mutationHarness(initial: StoredWorkcellProjectSnapshotProjectionV3) {
  let active = structuredClone(initial)
  const replaceFromActive = vi.fn<ProjectMutationService['replaceFromActive']>(
    async (recipe) => {
      active = recipe(active)
    },
  )
  const mutationService = {
    replaceFromActive,
    readPublished: vi.fn(() => ({
      revisionId: 'test-revision',
      snapshot: active,
      generation: 1,
    })),
  } as unknown as ProjectMutationService
  return { mutationService, replaceFromActive, active: () => active }
}

function stepAsset(): ObjectAssetRecordV2 {
  return {
    id: 'asset-cup',
    name: 'Cup',
    sourceFileName: 'cup.step',
    sourceBytes: new Uint8Array([1, 2, 3]).buffer,
    importScale: 0.001,
    originMode: 'center',
    colliderCenter: [0, 0, 0],
    collisionHalfExtents: [0.05, 0.05, 0.1],
    collisionBoxes: [{
      id: 'default',
      center: [0, 0, 0],
      halfExtents: [0.05, 0.05, 0.1],
      quaternion: [0, 0, 0, 1],
    }],
    statistics: { vertices: 12, triangles: 4, meshes: 1, materials: 1 },
  }
}

function objectInstance(): ObjectInstanceRecordV1 {
  return {
    id: 'cup-1',
    assetId: 'asset-cup',
    name: 'Cup',
    transform: {
      position: [0.4, 0.2, 1.05],
      quaternion: [0, 0, 0, 1],
      scale: [1, 1, 1],
    },
    numericStatus: 7,
    statusSource: 'manual',
    statusOverlayVisible: true,
    visible: true,
  }
}

describe('SceneCommandService', () => {
  it('imports the STEP Asset, Instance, Scene Entity, transform state, and target reference in one publication', async () => {
    const harness = mutationHarness(projection())
    const preparedSourceGroup = { ownerKeys: ['object-asset:asset-cup'] } as never
    const commands = createSceneCommandService({
      mutationService: harness.mutationService,
      stageStepSource: vi.fn(async () => ({
        sourceSha256: 'a'.repeat(64),
        preparedSourceGroup,
      })),
    })

    await commands.importStepObject({
      asset: stepAsset(),
      instance: objectInstance(),
      graspable: true,
    })

    expect(harness.replaceFromActive).toHaveBeenCalledTimes(1)
    expect(harness.replaceFromActive.mock.calls[0]?.[1]).toEqual([preparedSourceGroup])
    expect(harness.active()).toMatchObject({
      objectAssets: [{ id: 'asset-cup', sourceKind: 'step', sourceSha256: 'a'.repeat(64) }],
      objectInstances: [{
        id: 'cup-1', assetId: 'asset-cup', scale: [1, 1, 1], manualNumericStatus: 7,
      }],
      scene: {
        entities: expect.arrayContaining([expect.objectContaining({
          id: 'object:cup-1',
          kind: 'object',
          localPose: { positionM: [0.4, 0.2, 1.05], quaternion: [0, 0, 0, 1] },
          target: { kind: 'object-instance', id: 'cup-1' },
        })]),
      },
    })
  })

  it('deletes an Object and every durable entity reference in one recipe while retaining a shared Asset', async () => {
    const first = objectInstance()
    const second = { ...objectInstance(), id: 'cup-2', name: 'Cup 2' }
    const objectEntity = (id: string): SceneEntityV1 => ({
      kind: 'object',
      id: `object:${id}`,
      name: id,
      parentId: null,
      localPose: IDENTITY_POSE,
      visible: true,
      target: { kind: 'object-instance', id },
      transformSource: 'manual',
    })
    const current = projection([robot(), objectEntity('cup-1'), objectEntity('cup-2')]) as unknown as {
      objectAssets: unknown[]
      objectInstances: unknown[]
      opcUa: { numericStatusBindings: unknown[]; equipmentTransforms: unknown[] }
      collisionPolicy: { ignoredPairKeys: string[] }
    }
    current.objectAssets = [
      { ...stepAsset(), sourceKind: 'step', sourceSha256: 'a'.repeat(64) },
      { ...stepAsset(), id: 'asset-unused', sourceKind: 'step', sourceSha256: 'b'.repeat(64) },
    ]
    current.objectInstances = [first, second]
    current.opcUa.numericStatusBindings = [{ entityId: 'object:cup-1', nodeId: 'ns=2;s=Cup', scale: 1, offset: 0 }]
    current.opcUa.equipmentTransforms = [{ entityId: 'object:cup-1' }]
    current.collisionPolicy.ignoredPairKeys = ['object:cup-1|robot-link:LINK00']
    const harness = mutationHarness(current as unknown as StoredWorkcellProjectSnapshotProjectionV3)
    const commands = createSceneCommandService({ mutationService: harness.mutationService })

    await commands.deleteEntity('object:cup-1')

    expect(harness.replaceFromActive).toHaveBeenCalledTimes(1)
    expect(JSON.stringify(harness.active())).not.toContain('object:cup-1')
    expect(harness.active().objectInstances.map(({ id }) => id)).toEqual(['cup-2'])
    expect(harness.active().objectAssets.map(({ id }) => id)).toEqual(['asset-cup', 'asset-unused'])
  })

  it.each([
    'object:cup-1',
    'object:cup-1/default',
  ])('clears robot mount contact when deleting its referenced Entity or collision id (%s)', async (mountReference) => {
    const instance = objectInstance()
    const object: SceneEntityV1 = {
      kind: 'object', id: 'object:cup-1', name: 'Cup', parentId: null,
      localPose: IDENTITY_POSE, visible: true,
      target: { kind: 'object-instance', id: 'cup-1' }, transformSource: 'manual',
    }
    const current = projection([robot(), object]) as unknown as {
      scene: { robotMountContact: unknown }
      objectAssets: unknown[]
      objectInstances: unknown[]
    }
    current.scene.robotMountContact = {
      baseLinkId: 'LINK00', mountSurfaceCollisionEntityId: mountReference,
    }
    current.objectAssets = [{
      ...stepAsset(), sourceKind: 'step', sourceSha256: 'a'.repeat(64),
    }]
    current.objectInstances = [instance]
    const harness = mutationHarness(current as unknown as StoredWorkcellProjectSnapshotProjectionV3)
    const commands = createSceneCommandService({ mutationService: harness.mutationService })

    await commands.deleteEntity('object:cup-1')

    expect(harness.active().scene.robotMountContact).toMatchObject({
      mountSurfaceCollisionEntityId: null,
    })
  })

  it('rejects Robot deletion and an Axis carriage Group before publication', async () => {
    const carriage: SceneEntityV1 = {
      kind: 'group', id: 'group:carriage', name: 'Carriage', parentId: 'linear-axis:active',
      localPose: IDENTITY_POSE, visible: true,
    }
    const axis: SceneEntityV1 = {
      kind: 'linear-axis', id: 'linear-axis:active', name: 'Axis', parentId: null,
      localPose: IDENTITY_POSE, visible: true, direction: 'x', minPositionM: 0,
      maxPositionM: 1, homePositionM: 0, currentPositionM: 0,
      carriageEntityId: 'group:carriage', robotEntityId: null,
    }
    const harness = mutationHarness(projection([robot(), axis, carriage]))
    const commands = createSceneCommandService({ mutationService: harness.mutationService })

    await expect(commands.deleteEntity('robot:active')).rejects.toThrow('ROBOT_DELETE_UNAVAILABLE')
    await expect(commands.ungroup('group:carriage')).rejects.toThrow('SCENE_AXIS_CARRIAGE_ATTACHED')
    expect(harness.replaceFromActive).not.toHaveBeenCalled()
  })

  it('creates Box and Cylinder primitives as Project V3 Asset, Instance, and Scene Entity recipes', async () => {
    const harness = mutationHarness(projection())
    const ids = ['box-1', 'cylinder-1']
    const commands = createSceneCommandService({
      mutationService: harness.mutationService,
      createId: () => ids.shift()!,
    })

    await commands.createBox({
      name: 'Guard', dimensionsM: [1, 0.5, 0.2], color: '#AABBCC',
    })
    await commands.createCylinder({
      name: 'Post', radiusM: 0.1, heightM: 0.8, color: '#112233',
    })

    expect(harness.replaceFromActive).toHaveBeenCalledTimes(2)
    expect(harness.active().objectAssets).toEqual([
      expect.objectContaining({ sourceKind: 'box', dimensionsM: [1, 0.5, 0.2] }),
      expect.objectContaining({ sourceKind: 'cylinder', radiusM: 0.1, heightM: 0.8 }),
    ])
    expect(harness.active().objectInstances).toHaveLength(2)
    expect(harness.active().scene.entities.map(({ id }) => id)).toEqual([
      'robot:active', 'object:box-1', 'object:cylinder-1',
    ])
  })

  it('creates Cylinder metadata accepted by the real V3 validator', async () => {
    const project = await repositoryProjectFixture()
    const harness = mutationHarness(project as unknown as StoredWorkcellProjectSnapshotProjectionV3)
    const commands = createSceneCommandService({
      mutationService: harness.mutationService,
      createId: () => 'validated-cylinder',
    })

    await commands.createCylinder({
      name: 'Validated Post', radiusM: 0.1, heightM: 0.8, color: '#112233',
    })

    expect(() => validateWorkcellProjectSnapshotV3(
      harness.active() as unknown as WorkcellProjectSnapshotV3,
    )).not.toThrow()
    expect(harness.active().objectAssets.at(-1)?.statistics.vertices).toBe(196)
  })

  it.each([
    ['Group', {
      parent: {
        kind: 'group', id: 'group:fixture', name: 'Fixture', parentId: null,
        localPose: { ...IDENTITY_POSE, positionM: [10, 0, 0] }, visible: true,
      } satisfies SceneEntityV1,
      expectedLocalPosition: [10, 0, 0],
    }],
    ['moving Linear Axis', {
      parent: {
        kind: 'linear-axis', id: 'linear-axis:active', name: 'Axis', parentId: null,
        localPose: { ...IDENTITY_POSE, positionM: [10, 0, 0] }, visible: true,
        direction: 'x', minPositionM: -10, maxPositionM: 10,
        homePositionM: 0, currentPositionM: 2,
        carriageEntityId: 'object:cup-1', robotEntityId: null,
      } satisfies SceneEntityV1,
      expectedLocalPosition: [8, 0, 0],
    }],
  ])('converts an MCP-world edit through the actual %s parent before storing local pose', async (_label, fixture) => {
    const child: SceneEntityV1 = {
      kind: 'object', id: 'object:cup-1', name: 'Cup', parentId: fixture.parent.id,
      localPose: IDENTITY_POSE, visible: true,
      target: { kind: 'object-instance', id: 'cup-1' }, transformSource: 'manual',
    }
    const harness = mutationHarness(projection([robot(), fixture.parent, child]))
    const commands = createSceneCommandService({ mutationService: harness.mutationService })

    await commands.setWorldPose('object:cup-1', {
      positionM: [20, 0, 0], quaternion: [0, 0, 0, 1],
    })

    expect(harness.active().scene.entities.find(({ id }) => id === 'object:cup-1')?.localPose.positionM)
      .toEqual(fixture.expectedLocalPosition)
    expect(worldPoseForEntity(harness.active().scene, 'object:cup-1').positionM)
      .toEqual([20, 0, 0])
  })

  it('reparents and ungroups direct members without changing World pose or child visibility', async () => {
    const group: SceneEntityV1 = {
      kind: 'group', id: 'group:fixture', name: 'Fixture', parentId: null,
      localPose: { ...IDENTITY_POSE, positionM: [1, 0, 0] }, visible: true,
    }
    const child: SceneEntityV1 = {
      kind: 'object', id: 'object:cup-1', name: 'Cup', parentId: null,
      localPose: { ...IDENTITY_POSE, positionM: [2, 0, 0] }, visible: true,
      target: { kind: 'object-instance', id: 'cup-1' }, transformSource: 'manual',
    }
    const harness = mutationHarness(projection([robot(), group, child]))
    const commands = createSceneCommandService({ mutationService: harness.mutationService })

    await commands.reparent('object:cup-1', 'group:fixture')
    await commands.setVisible('group:fixture', false)
    expect(harness.active().scene.entities.find(({ id }) => id === 'object:cup-1')).toMatchObject({
      parentId: 'group:fixture',
      localPose: { positionM: [1, 0, 0] },
      visible: true,
    })

    await commands.setVisible('group:fixture', true)
    await commands.ungroup('group:fixture')
    expect(harness.active().scene.entities.find(({ id }) => id === 'object:cup-1')).toMatchObject({
      parentId: null,
      localPose: { positionM: [2, 0, 0] },
      visible: true,
    })
    expect(harness.active().scene.entities.some(({ id }) => id === 'group:fixture')).toBe(false)
  })

  it('duplicates only the Instance and Scene Entity, reuses the Asset, and warns non-blockingly at the 205th Instance', async () => {
    const instance = objectInstance()
    const entity: SceneEntityV1 = {
      kind: 'object', id: 'object:cup-1', name: 'Cup', parentId: null,
      localPose: IDENTITY_POSE, visible: true,
      target: { kind: 'object-instance', id: 'cup-1' }, transformSource: 'manual',
    }
    const current = projection([robot(), entity]) as unknown as {
      objectAssets: unknown[]
      objectInstances: unknown[]
    }
    current.objectAssets = [{ ...stepAsset(), sourceKind: 'step', sourceSha256: 'a'.repeat(64) }]
    current.objectInstances = [
      instance,
      ...Array.from({ length: 203 }, (_, index) => ({ ...instance, id: `other-${index}` })),
    ]
    const harness = mutationHarness(current as unknown as StoredWorkcellProjectSnapshotProjectionV3)
    const onWarning = vi.fn()
    const commands = createSceneCommandService({
      mutationService: harness.mutationService,
      createId: () => 'cup-copy',
      onWarning,
    })

    await commands.duplicateObject('object:cup-1')

    expect(harness.active().objectAssets).toHaveLength(1)
    expect(harness.active().objectInstances).toHaveLength(205)
    expect(harness.active().scene.entities).toContainEqual(expect.objectContaining({
      id: 'object:cup-copy', target: { kind: 'object-instance', id: 'cup-copy' },
    }))
    expect(onWarning).toHaveBeenCalledWith({
      code: 'OBJECT_INSTANCE_WARNING', current: 205, limit: 256,
    })
  })

  it('duplicates an OPC UA-backed Object as a validator-clean Manual fallback without copying bindings', async () => {
    const baseProject = await repositoryProjectFixture({
      objectStepAssets: [{ id: 'asset-cup', bytes: [9, 8, 7] }],
    })
    const project: WorkcellProjectSnapshotV3 = {
      ...baseProject,
      objectInstances: [...baseProject.objectInstances, {
        id: 'cup-1', assetId: 'asset-cup', name: 'OPC Cup', manualNumericStatus: 17,
        statusSource: 'opcua', statusOverlayVisible: false, scale: [1, 1, 1], graspable: true,
      }],
      scene: { ...baseProject.scene, entities: [...baseProject.scene.entities, {
        kind: 'object', id: 'object:cup-1', name: 'OPC Cup', parentId: null,
        localPose: { positionM: [3, 4, 5], quaternion: [0, 0, 0, 1] }, visible: true,
        target: { kind: 'object-instance', id: 'cup-1' }, transformSource: 'opcua',
      }] },
      opcUa: {
        ...baseProject.opcUa,
        numericStatusBindings: [...baseProject.opcUa.numericStatusBindings, {
          entityId: 'object:cup-1', nodeId: 'ns=2;s=Cup.Status', scale: 1, offset: 0,
        }],
        equipmentTransforms: [...baseProject.opcUa.equipmentTransforms, {
          entityId: 'object:cup-1', gatewayId: 'gateway-1', gatewayProfileId: 'profile-1',
          gatewayProfileRevision: 'b'.repeat(64), mode: 'absolute', referenceFrameId: 'mcp',
          smoothing: { mode: 'two-cycle', cycles: 2 },
        }],
      },
    }
    expect(() => validateWorkcellProjectSnapshotV3(project)).not.toThrow()
    const harness = mutationHarness(project as unknown as StoredWorkcellProjectSnapshotProjectionV3)
    const commands = createSceneCommandService({
      mutationService: harness.mutationService,
      createId: () => 'cup-copy',
    })

    await commands.duplicateObject('object:cup-1')

    const candidate = harness.active() as unknown as WorkcellProjectSnapshotV3
    expect(candidate.objectInstances.find(({ id }) => id === 'cup-copy')).toMatchObject({
      manualNumericStatus: 17,
      statusSource: 'manual',
      statusOverlayVisible: false,
    })
    expect(candidate.scene.entities.find(({ id }) => id === 'object:cup-copy')).toMatchObject({
      localPose: { positionM: [3, 4, 5] },
      transformSource: 'manual',
    })
    expect(candidate.opcUa.numericStatusBindings).toHaveLength(1)
    expect(candidate.opcUa.equipmentTransforms).toHaveLength(1)
    expect(() => validateWorkcellProjectSnapshotV3(candidate)).not.toThrow()
  })

  it('does not emit the STEP threshold warning for primitives or duplicates that add no STEP Asset', async () => {
    const instance = objectInstance()
    const object: SceneEntityV1 = {
      kind: 'object', id: 'object:cup-1', name: 'Cup', parentId: null,
      localPose: IDENTITY_POSE, visible: true,
      target: { kind: 'object-instance', id: 'cup-1' }, transformSource: 'manual',
    }
    const current = projection([robot(), object]) as unknown as {
      objectAssets: unknown[]
      objectInstances: unknown[]
    }
    current.objectAssets = Array.from({ length: 52 }, (_, index) => ({
      ...stepAsset(), id: `step-${index}`, sourceKind: 'step', sourceSha256: `${index}`.padStart(64, '0'),
    }))
    current.objectInstances = [instance]
    const harness = mutationHarness(current as unknown as StoredWorkcellProjectSnapshotProjectionV3)
    const ids = ['box-1', 'cup-copy']
    const onWarning = vi.fn()
    const commands = createSceneCommandService({
      mutationService: harness.mutationService,
      createId: () => ids.shift()!,
      onWarning,
    })

    await commands.createBox({ name: 'Guard', dimensionsM: [1, 1, 1], color: '#AABBCC' })
    await commands.duplicateObject('object:cup-1')

    expect(onWarning).not.toHaveBeenCalledWith(expect.objectContaining({
      code: 'STEP_ASSET_WARNING',
    }))
  })

  it('rechecks an Axis carriage Group inside the queued recipe when published state changes after invocation', async () => {
    const group: SceneEntityV1 = {
      kind: 'group', id: 'group:carriage', name: 'Carriage', parentId: null,
      localPose: IDENTITY_POSE, visible: true,
    }
    const initial = projection([robot(), group])
    const attachedGroup: SceneEntityV1 = { ...group, parentId: 'linear-axis:active' }
    const axis: SceneEntityV1 = {
      kind: 'linear-axis', id: 'linear-axis:active', name: 'Axis', parentId: null,
      localPose: IDENTITY_POSE, visible: true, direction: 'x', minPositionM: 0,
      maxPositionM: 1, homePositionM: 0, currentPositionM: 0,
      carriageEntityId: 'group:carriage', robotEntityId: null,
    }
    let active = projection([robot(), axis, attachedGroup])
    const replaceFromActive = vi.fn<ProjectMutationService['replaceFromActive']>(async (recipe) => {
      const candidate = recipe(active)
      active = candidate
    })
    const mutationService = {
      readPublished: vi.fn(() => ({ revisionId: 'old', snapshot: initial, generation: 1 })),
      replaceFromActive,
    } as unknown as ProjectMutationService
    const commands = createSceneCommandService({ mutationService })
    const before = structuredClone(active)

    await expect(commands.ungroup('group:carriage')).rejects.toThrow(
      'SCENE_AXIS_CARRIAGE_ATTACHED',
    )

    expect(replaceFromActive).toHaveBeenCalledTimes(1)
    expect(active).toEqual(before)
  })

  it('updates Object status fields through one Project V3 recipe instead of the read-model store', async () => {
    const entity: SceneEntityV1 = {
      kind: 'object', id: 'object:cup-1', name: 'Cup', parentId: null,
      localPose: IDENTITY_POSE, visible: true,
      target: { kind: 'object-instance', id: 'cup-1' }, transformSource: 'manual',
    }
    const current = projection([robot(), entity]) as unknown as {
      objectInstances: unknown[]
    }
    current.objectInstances = [{
      id: 'cup-1', assetId: 'asset-cup', name: 'Cup', manualNumericStatus: 0,
      statusSource: 'manual', statusOverlayVisible: true, scale: [1, 1, 1], graspable: true,
    }]
    const harness = mutationHarness(current as unknown as StoredWorkcellProjectSnapshotProjectionV3)
    const commands = createSceneCommandService({ mutationService: harness.mutationService })

    await commands.updateObjectInstance('object:cup-1', {
      numericStatus: 9,
      statusSource: 'opcua',
      statusOverlayVisible: false,
    })

    expect(harness.replaceFromActive).toHaveBeenCalledTimes(1)
    expect(harness.active().objectInstances[0]).toMatchObject({
      manualNumericStatus: 9,
      statusSource: 'opcua',
      statusOverlayVisible: false,
    })
  })

  it('switches OPC UA transform ownership to Manual through one Project V3 recipe', async () => {
    const entity: SceneEntityV1 = {
      kind: 'object', id: 'object:live-part', name: 'Live Part', parentId: null,
      localPose: IDENTITY_POSE, visible: true,
      target: { kind: 'object-instance', id: 'live-part' }, transformSource: 'opcua',
    }
    const harness = mutationHarness(projection([robot(), entity]))
    const commands = createSceneCommandService({ mutationService: harness.mutationService })

    await commands.setTransformSource('object:live-part', 'manual')

    expect(harness.replaceFromActive).toHaveBeenCalledTimes(1)
    expect(harness.active().scene.entities).toContainEqual({
      ...entity,
      transformSource: 'manual',
    })
  })

  it('rejects manual local and world pose writes for an OPC UA-owned Object', async () => {
    const entity: SceneEntityV1 = {
      kind: 'object', id: 'object:live-part', name: 'Live Part', parentId: null,
      localPose: IDENTITY_POSE, visible: true,
      target: { kind: 'object-instance', id: 'live-part' }, transformSource: 'opcua',
    }
    const harness = mutationHarness(projection([robot(), entity]))
    const commands = createSceneCommandService({ mutationService: harness.mutationService })
    const pose = { positionM: [1, 2, 3], quaternion: [0, 0, 0, 1] } as const

    await expect(commands.setLocalPose('object:live-part', pose)).rejects.toThrow(
      'SCENE_TRANSFORM_OWNED_BY_OPCUA',
    )
    await expect(commands.setWorldPose('object:live-part', pose)).rejects.toThrow(
      'SCENE_TRANSFORM_OWNED_BY_OPCUA',
    )
    expect(harness.active().scene.entities).toContainEqual(entity)
  })

  it('updates and deletes built-in Equipment through Project V3 recipes and clears mount contact', async () => {
    const equipment: SceneEntityV1 = {
      kind: 'object', id: 'equipment:cup-01', name: 'Cup', parentId: null,
      localPose: IDENTITY_POSE, visible: true,
      target: { kind: 'built-in-equipment', id: 'cup-01' }, transformSource: 'manual',
    }
    const current = projection([robot(), equipment]) as unknown as {
      scene: StoredWorkcellProjectSnapshotProjectionV3['scene']
      builtInEquipment: unknown[]
      opcUa: { numericStatusBindings: unknown[]; equipmentTransforms: unknown[] }
    }
    ;(current.scene as { robotMountContact: unknown }).robotMountContact = {
      baseLinkId: 'LINK00', mountSurfaceCollisionEntityId: 'equipment:cup-01',
    }
    current.builtInEquipment = [{
      id: 'cup-01', name: 'Cup', kind: 'cup', status: 'RUNNING',
      manualNumericStatus: 0, statusSource: 'manual', statusOverlayVisible: true,
      graspable: true, collisionHalfExtents: [0.055, 0.055, 0.075], stackLightAnchor: null,
    }]
    current.opcUa.numericStatusBindings = [{
      entityId: 'equipment:cup-01', nodeId: 'ns=2;s=Cup', scale: 1, offset: 0,
    }]
    current.opcUa.equipmentTransforms = [{ entityId: 'equipment:cup-01' }]
    const harness = mutationHarness(current as unknown as StoredWorkcellProjectSnapshotProjectionV3)
    const commands = createSceneCommandService({ mutationService: harness.mutationService })

    await commands.updateBuiltInEquipment('equipment:cup-01', {
      numericStatus: 9, statusSource: 'opcua', statusOverlayVisible: false,
    })
    expect(harness.active().builtInEquipment[0]).toMatchObject({
      manualNumericStatus: 9, statusSource: 'opcua', statusOverlayVisible: false,
    })

    await commands.deleteEntity('equipment:cup-01')

    expect(harness.replaceFromActive).toHaveBeenCalledTimes(2)
    expect(harness.active().builtInEquipment).toEqual([])
    expect(harness.active().scene.robotMountContact).toMatchObject({
      mountSurfaceCollisionEntityId: null,
    })
    expect(JSON.stringify(harness.active().opcUa)).not.toContain('equipment:cup-01')
  })

  it('creates at most one validated MCP-level Linear Axis in one Project V3 recipe', async () => {
    const harness = mutationHarness(projection())
    const commands = createSceneCommandService({ mutationService: harness.mutationService })

    await commands.createLinearAxis({
      direction: 'y', minPositionM: -2, maxPositionM: 3,
      homePositionM: 0.25, currentPositionM: 0.5,
      carriageEntityId: null, robotEntityId: null,
    })

    expect(harness.active().scene.entities).toContainEqual({
      kind: 'linear-axis', id: 'linear-axis:active', name: 'Linear Axis', parentId: null,
      localPose: IDENTITY_POSE, visible: true, direction: 'y', minPositionM: -2,
      maxPositionM: 3, homePositionM: 0.25, currentPositionM: 0.5,
      carriageEntityId: null, robotEntityId: null,
    })
    await expect(commands.createLinearAxis({
      direction: 'x', minPositionM: 0, maxPositionM: 1,
      homePositionM: 0, currentPositionM: 0,
      carriageEntityId: null, robotEntityId: null,
    })).rejects.toThrow('LINEAR_AXIS_ALREADY_EXISTS')
    expect(harness.replaceFromActive).toHaveBeenCalledTimes(2)
  })

  it('rejects an out-of-range position without clamping and moves Home through one recipe', async () => {
    const harness = mutationHarness(projection([robot(), linearAxis()]))
    const commands = createSceneCommandService({ mutationService: harness.mutationService })

    await expect(commands.setLinearAxisPosition(2.1)).rejects.toThrow('LINEAR_AXIS_OUT_OF_RANGE')
    expect(linearAxisFrom(harness.active()).currentPositionM).toBe(0.5)

    await commands.moveLinearAxisHome()
    expect(linearAxisFrom(harness.active()).currentPositionM).toBe(0.25)
  })

  it('attaches and detaches the Robot without a World-pose jump', async () => {
    const sceneRobot: SceneEntityV1 = {
      ...robot(), localPose: { ...IDENTITY_POSE, positionM: [4, 5, 6] },
    }
    const harness = mutationHarness(projection([sceneRobot, linearAxis({
      localPose: { ...IDENTITY_POSE, positionM: [10, 0, 0] },
    })]))
    const commands = createSceneCommandService({ mutationService: harness.mutationService })
    const before = worldPoseForEntity(harness.active().scene, 'robot:active')

    await commands.attachRobotToLinearAxis()
    expect(linearAxisFrom(harness.active()).robotEntityId).toBe('robot:active')
    expect(worldPoseForEntity(harness.active().scene, 'robot:active')).toEqual(before)

    await commands.detachRobotFromLinearAxis()
    expect(linearAxisFrom(harness.active()).robotEntityId).toBeNull()
    expect(worldPoseForEntity(harness.active().scene, 'robot:active')).toEqual(before)
  })

  it('replaces one Object-or-Group carriage atomically while preserving both World poses', async () => {
    const previous: SceneEntityV1 = {
      kind: 'object', id: 'object:previous', name: 'Previous', parentId: 'linear-axis:active',
      localPose: { ...IDENTITY_POSE, positionM: [1, 0, 0] }, visible: true,
      target: { kind: 'object-instance', id: 'previous' }, transformSource: 'manual',
    }
    const next: SceneEntityV1 = {
      kind: 'group', id: 'group:next', name: 'Next', parentId: null,
      localPose: { ...IDENTITY_POSE, positionM: [7, 8, 9] }, visible: true,
    }
    const harness = mutationHarness(projection([
      robot(), linearAxis({ carriageEntityId: 'object:previous' }), previous, next,
    ]))
    const commands = createSceneCommandService({ mutationService: harness.mutationService })
    const previousWorld = worldPoseForEntity(harness.active().scene, 'object:previous')
    const nextWorld = worldPoseForEntity(harness.active().scene, 'group:next')

    await commands.setLinearAxisCarriage('group:next')

    expect(harness.replaceFromActive).toHaveBeenCalledTimes(1)
    expect(linearAxisFrom(harness.active()).carriageEntityId).toBe('group:next')
    expect(harness.active().scene.entities.find(({ id }) => id === 'object:previous')?.parentId).toBeNull()
    expect(harness.active().scene.entities.find(({ id }) => id === 'group:next')?.parentId)
      .toBe('linear-axis:active')
    expect(worldPoseForEntity(harness.active().scene, 'object:previous')).toEqual(previousWorld)
    expect(worldPoseForEntity(harness.active().scene, 'group:next')).toEqual(nextWorld)
  })

  it('rejects a non-carriage Entity and an OPC-UA-owned Object without mutation', async () => {
    const opcObject: SceneEntityV1 = {
      kind: 'object', id: 'object:live', name: 'Live', parentId: null,
      localPose: IDENTITY_POSE, visible: true,
      target: { kind: 'object-instance', id: 'live' }, transformSource: 'opcua',
    }
    const harness = mutationHarness(projection([robot(), linearAxis(), opcObject]))
    const commands = createSceneCommandService({ mutationService: harness.mutationService })
    const before = structuredClone(harness.active().scene)

    await expect(commands.setLinearAxisCarriage('robot:active')).rejects.toThrow(
      'LINEAR_AXIS_CARRIAGE_REQUIRED',
    )
    await expect(commands.setLinearAxisCarriage('object:live')).rejects.toThrow(
      'SCENE_TRANSFORM_OWNED_BY_OPCUA',
    )
    expect(harness.active().scene).toEqual(before)
  })

  it('deletes the Linear Axis only after carriage and Robot are detached', async () => {
    const attachedRobot: SceneEntityV1 = {
      ...robot(), parentId: 'linear-axis:active',
    }
    const harness = mutationHarness(projection([
      linearAxis({ robotEntityId: 'robot:active' }), attachedRobot,
    ]))
    const commands = createSceneCommandService({ mutationService: harness.mutationService })

    await expect(commands.deleteLinearAxis()).rejects.toThrow('LINEAR_AXIS_DELETE_ATTACHED')
    await commands.detachRobotFromLinearAxis()
    await commands.deleteLinearAxis()

    expect(harness.active().scene.entities.some(({ kind }) => kind === 'linear-axis')).toBe(false)
    expect(harness.active().scene.entities.find(({ id }) => id === 'robot:active')?.parentId).toBeNull()
  })
})

function linearAxisFrom(
  snapshot: StoredWorkcellProjectSnapshotProjectionV3,
): Extract<SceneEntityV1, { kind: 'linear-axis' }> {
  const axis = snapshot.scene.entities.find(({ kind }) => kind === 'linear-axis')
  if (axis?.kind !== 'linear-axis') throw new Error('Expected Linear Axis')
  return axis
}
