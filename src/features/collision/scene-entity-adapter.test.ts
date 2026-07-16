import { Group } from 'three'
import { describe, expect, it } from 'vitest'
import type {
  RobotDefinitionV4,
  SpatialEntityV4,
} from '../../core/project-v4/types'
import {
  robotLinkCollisionIdV4,
  spatialEntityCollisionIdV4,
} from '../../core/robot-runtime/collision-identity'
import {
  DEFAULT_COLLISION_POLICY,
  pairKey,
} from '../../domain/collision/collision'
import { queryGeometryCollisionsWithTelemetry } from '../../domain/collision/query-collision'
import type { EquipmentRecord } from '../../domain/equipment/equipment'
import type {
  ObjectAssetRecordV1,
  ObjectInstanceRecordV1,
  RobotLinkGeometryRecordV1,
  RobotLinkGeometryRecordV2,
} from '../../domain/project/project'
import {
  geometryEntityRegistry,
  registerGeometryEntity,
  snapshotGeometryEntities,
} from './geometry-entity-registry'
import {
  deriveMountContactPairKeyFromRegistrations,
  equipmentRecordToGeometryEntity,
  objectInstanceToGeometryEntity,
  robotLinkToGeometryEntity,
  robotLinkCollisionProxiesV4,
  spatialEntityCollisionProxyV4,
  visibleCollisionEntitiesV4,
  workbenchToGeometryEntity,
} from './scene-entity-adapter'

function equipment(): EquipmentRecord {
  return {
    id: 'fixture-01',
    name: 'Fixture',
    kind: 'machine',
    status: 'OFF',
    numericStatus: 0,
    statusSource: 'manual',
    statusOverlayVisible: false,
    transform: {
      position: [0, 0, 0],
      quaternion: [0, 0, 0, 1],
      scale: [1, 1, 1],
    },
    graspable: true,
    collisionCenter: [0.2, -0.1, 0.4],
    collisionHalfExtents: [0.5, 0.4, 0.3],
    stackLightAnchor: null,
  }
}

function asset(): ObjectAssetRecordV1 {
  return {
    id: 'asset-01',
    name: 'Fixture Asset',
    sourceFileName: 'fixture.step',
    sourceBytes: new Uint8Array([1]).buffer,
    importScale: 1,
    originMode: 'source',
    colliderCenter: [0.2, -0.1, 0.4],
    collisionHalfExtents: [0.5, 0.4, 0.3],
    statistics: { vertices: 3, triangles: 1, meshes: 1, materials: 1 },
  }
}

function instance(): ObjectInstanceRecordV1 {
  return {
    id: 'fixture-01',
    assetId: 'asset-01',
    name: 'Fixture Instance',
    transform: {
      position: [0, 0, 0],
      quaternion: [0, 0, 0, 1],
      scale: [1, 1, 1],
    },
    numericStatus: 0,
    statusSource: 'manual',
    statusOverlayVisible: false,
    visible: true,
  }
}

function robotGeometry(
  linkId: RobotLinkGeometryRecordV1['linkId'] = 'LINK03',
): RobotLinkGeometryRecordV1 {
  return {
    linkId,
    sourceFileName: `${linkId}.step`,
    sourceBytes: new Uint8Array([1]).buffer,
    localTransform: {
      position: [0, 0, 0],
      quaternion: [0, 0, 0, 1],
      scale: [1, 1, 1],
    },
    visible: true,
    collisionCenter: [0.12, -0.23, 0.34],
    collisionHalfExtents: [0.41, 0.32, 0.23],
    statistics: { vertices: 3, triangles: 1, meshes: 1, materials: 1 },
  }
}

describe('scene collision Entity adapters', () => {
  it('derives mount contact only from configured live collision registrations', () => {
    const configuration = {
      baseLinkId: 'LINK00' as const,
      mountSurfaceCollisionEntityId: 'workcell:workbench',
    }
    const registrations = [
      robotLinkToGeometryEntity(robotGeometry('LINK00'), new Group()),
      workbenchToGeometryEntity(new Group()),
    ]

    expect(deriveMountContactPairKeyFromRegistrations(
      configuration,
      registrations,
    )).toBe('robot-link:LINK00|workcell:workbench')
    expect(deriveMountContactPairKeyFromRegistrations(
      configuration,
      registrations.slice(1),
    )).toBeNull()
    expect(deriveMountContactPairKeyFromRegistrations(
      configuration,
      [{ ...registrations[0]!, object: null }, registrations[1]!],
    )).toBeNull()
  })

  it('adapts legacy Equipment and imported Object Instances to equivalent Boxes', () => {
    const object = new Group()
    const legacy = equipmentRecordToGeometryEntity(equipment(), object)
    const imported = objectInstanceToGeometryEntity(asset(), instance(), object)

    expect(legacy).toMatchObject({
      id: 'equipment:fixture-01',
      category: 'equipment',
    })
    expect(imported).toMatchObject({
      id: 'object:fixture-01',
      category: 'object',
    })
    expect(imported.boxes).toEqual(legacy.boxes)
  })

  it('keeps canonical external IDs while only switching category across grasp and release', () => {
    const object = new Group()

    expect(equipmentRecordToGeometryEntity(equipment(), object, true)).toMatchObject({
      id: 'equipment:fixture-01',
      category: 'held-object',
    })
    expect(objectInstanceToGeometryEntity(asset(), instance(), object, true)).toMatchObject({
      id: 'object:fixture-01',
      category: 'held-object',
    })
    expect(objectInstanceToGeometryEntity(asset(), instance(), object, false)).toMatchObject({
      id: 'object:fixture-01',
      category: 'object',
    })
  })

  it('uses the active custom Robot Link collider record', () => {
    expect(robotLinkToGeometryEntity(robotGeometry(), new Group())).toMatchObject({
      id: 'robot-link:LINK03',
      category: 'robot-link',
      boxes: [
        {
          id: 'default',
          center: [0.12, -0.23, 0.34],
          halfExtents: [0.41, 0.32, 0.23],
          quaternion: [0, 0, 0, 1],
        },
      ],
    })
  })

  it('preserves every canonical V2 Robot Link Compound Box', () => {
    const compound: RobotLinkGeometryRecordV2 = {
      ...robotGeometry(),
      collisionBoxes: [
        {
          id: 'body',
          center: [0.12, -0.23, 0.34],
          halfExtents: [0.41, 0.32, 0.23],
          quaternion: [0, 0, 0, 1],
        },
        {
          id: 'wrist',
          center: [0.5, 0.1, -0.2],
          halfExtents: [0.08, 0.09, 0.1],
          quaternion: [0, 0, Math.SQRT1_2, Math.SQRT1_2],
        },
      ],
    }

    const registration = robotLinkToGeometryEntity(compound, new Group())

    expect(registration.boxes).toEqual(compound.collisionBoxes)
    expect(registration.boxes).not.toBe(compound.collisionBoxes)
  })

  it('publishes the existing Workbench proxy as the environment pair participant', () => {
    geometryEntityRegistry.clear()
    const workbench = new Group()
    const linkObject = new Group()
    registerGeometryEntity(workbenchToGeometryEntity(workbench, 0, 'Calibration Table'))
    registerGeometryEntity(
      robotLinkToGeometryEntity(
        {
          ...robotGeometry('LINK01'),
          collisionCenter: [0, 0, 1.03],
          collisionHalfExtents: [0.1, 0.1, 0.1],
        },
        linkObject,
      ),
    )
    registerGeometryEntity(
      robotLinkToGeometryEntity(
        {
          ...robotGeometry('LINK00'),
          collisionCenter: [0, 0, 1.03],
          collisionHalfExtents: [0.1, 0.1, 0.1],
        },
        new Group(),
      ),
    )

    const snapshot = snapshotGeometryEntities()
    const workbenchEntity = snapshot.entities.find(
      ({ id }) => id === 'workcell:workbench',
    )
    expect(workbenchEntity).toMatchObject({
      name: 'Calibration Table',
      category: 'environment',
      boxes: [
        {
          center: [0, 0, 1.03],
          halfExtents: [0.9, 0.6, 0.05],
        },
      ],
    })
    const result = queryGeometryCollisionsWithTelemetry(
      snapshot.entities,
      DEFAULT_COLLISION_POLICY,
      {
        mountContactPairKey: deriveMountContactPairKeyFromRegistrations(
          {
            baseLinkId: 'LINK00',
            mountSurfaceCollisionEntityId: 'workcell:workbench',
          },
          [...geometryEntityRegistry.values()],
        ),
      },
    )
    expect(result.findings).toEqual([
      expect.objectContaining({
        pairKey: pairKey('robot-link:LINK01', 'workcell:workbench'),
      }),
    ])
    expect(result.mountContact).toEqual({
      pairKey: pairKey('robot-link:LINK00', 'workcell:workbench'),
      state: 'contact',
    })
  })
})

const IDENTITY_POSE = {
  positionM: [0, 0, 0],
  quaternion: [0, 0, 0, 1],
} as const

function v4Box(id: string, centerM: readonly [number, number, number] = [0, 0, 0]) {
  return {
    id,
    centerM,
    halfExtentsM: [0.1, 0.1, 0.1] as const,
    quaternion: [0, 0, 0, 1] as const,
  }
}

function v4Definition(): RobotDefinitionV4 {
  const firstBoxes = Array.from({ length: 9 }, (_, index) =>
    v4Box(index === 0 ? 'box:|%' : `first-${index}`, index === 0 ? [1, 0, 0] : [0, 0, 0]),
  )
  const secondBoxes = Array.from({ length: 8 }, (_, index) =>
    v4Box(`second-${index}`),
  )
  return {
    id: 'definition',
    name: 'Definition',
    manufacturer: 'Test',
    model: 'Variable',
    assetReferenceIds: ['asset-a', 'asset-b'],
    sourceConventions: {
      'asset-a': {
        linearUnit: 'meter', sourceToMeters: 1,
        orientation: { mode: 'up-axis', upAxis: 'z' },
      },
      'asset-b': {
        linearUnit: 'meter', sourceToMeters: 1,
        orientation: { mode: 'up-axis', upAxis: 'z' },
      },
    },
    links: [
      {
        id: 'root:link',
        name: 'Root',
        geometryOccurrences: [
          {
            occurrenceKey: 'occ:|%',
            assetReferenceId: 'asset-a',
            linkLocalPose: {
              positionM: [1, 0, 0],
              quaternion: [0, 0, Math.SQRT1_2, Math.SQRT1_2],
            },
            statistics: { vertices: 0, triangles: 0, meshes: 0, materials: 0 },
            collisionBoxes: firstBoxes,
          },
          {
            occurrenceKey: 'second',
            assetReferenceId: 'asset-b',
            linkLocalPose: IDENTITY_POSE,
            statistics: { vertices: 0, triangles: 0, meshes: 0, materials: 0 },
            collisionBoxes: secondBoxes,
          },
        ],
      },
      { id: 'empty-tip', name: 'Tip', geometryOccurrences: [] },
    ],
    joints: [{
      id: 'axis', type: 'revolute', parentLinkId: 'root:link', childLinkId: 'empty-tip',
      origin: IDENTITY_POSE, axis: [0, 0, 1], min: -180, max: 180, home: 0,
      zeroOffset: 0, direction: 1, maximumVelocity: 90,
    }],
    frames: [],
    excludedGeometryOccurrenceKeys: [],
  }
}

function spatialEntity(
  id: string,
  geometry: SpatialEntityV4['geometry'],
): SpatialEntityV4 {
  return {
    id,
    name: id,
    geometry,
    parentFrameId: 'world',
    localPose: IDENTITY_POSE,
    visible: true,
    groupId: null,
    removable: true,
    transformOwner: 'manual',
    numericStatus: {
      value: 0,
      sourceOwnership: 'manual',
      overlay: { visible: false, frameId: null },
    },
    graspable: false,
    graspFrames: [],
    movingFrames: [],
  }
}

describe('scene collision Entity adapters v4', () => {
  it('aggregates all occurrence Boxes in link*occurrence*box order with qualified ids', () => {
    const candidate = v4Definition()
    const before = JSON.stringify(candidate)
    const proxies = robotLinkCollisionProxiesV4({
      robotId: 'robot|a',
      definition: candidate,
      linkWorldPoses: {
        'root:link': { positionM: [10, 0, 0], quaternion: [0, 0, 0, 1] },
        'empty-tip': IDENTITY_POSE,
      },
      effectiveVisible: true,
    })

    expect(proxies).toHaveLength(1)
    expect(proxies[0]?.entity.id).toBe(robotLinkCollisionIdV4('robot|a', 'root:link'))
    expect(proxies[0]?.entity.boxes).toHaveLength(17)
    expect(proxies[0]?.entity.boxes[0]?.id).toBe(
      'occ%3A%7C%25:box%3A%7C%25',
    )
    expect(proxies[0]?.entity.boxes[0]?.center[0]).toBeCloseTo(1)
    expect(proxies[0]?.entity.boxes[0]?.center[1]).toBeCloseTo(1)
    expect(proxies[0]?.entity.boxes[0]?.center[2]).toBeCloseTo(0)
    expect(proxies[0]?.entity.boxes[0]?.quaternion[2]).toBeCloseTo(Math.SQRT1_2)
    expect(proxies[0]?.entity.boxes[0]?.quaternion[3]).toBeCloseTo(Math.SQRT1_2)
    expect(proxies[0]?.entity.worldMatrix[12]).toBe(10)
    const firstBox = proxies[0]!.entity.boxes[0]!
    const world = proxies[0]!.entity.worldMatrix
    const actualWorldCenter = [
      world[0]! * firstBox.center[0] + world[4]! * firstBox.center[1]
        + world[8]! * firstBox.center[2] + world[12]!,
      world[1]! * firstBox.center[0] + world[5]! * firstBox.center[1]
        + world[9]! * firstBox.center[2] + world[13]!,
      world[2]! * firstBox.center[0] + world[6]! * firstBox.center[1]
        + world[10]! * firstBox.center[2] + world[14]!,
    ]
    expect(actualWorldCenter[0]).toBeCloseTo(11)
    expect(actualWorldCenter[1]).toBeCloseTo(1)
    expect(actualWorldCenter[2]).toBeCloseTo(0)
    expect(JSON.stringify(candidate)).toBe(before)
  })

  it('omits excluded occurrences and Links without collision Boxes', () => {
    const candidate = v4Definition()
    const proxies = robotLinkCollisionProxiesV4({
      robotId: 'robot-a',
      definition: { ...candidate, excludedGeometryOccurrenceKeys: ['occ:|%'] },
      linkWorldPoses: {
        'root:link': IDENTITY_POSE,
        'empty-tip': IDENTITY_POSE,
      },
      effectiveVisible: true,
    })
    expect(proxies).toHaveLength(1)
    expect(proxies[0]?.entity.boxes).toHaveLength(8)
    expect(proxies[0]?.entity.boxes.every(({ id }) => id.startsWith('second:'))).toBe(true)
  })

  it('requires own-key World poses for prototype-shaped Link ids', () => {
    const candidate = v4Definition()
    const prototypeDefinition: RobotDefinitionV4 = {
      ...candidate,
      links: candidate.links.map((link) => link.id === 'root:link'
        ? { ...link, id: '__proto__' }
        : link),
      joints: candidate.joints.map((joint) => ({
        ...joint,
        parentLinkId: joint.parentLinkId === 'root:link'
          ? '__proto__'
          : joint.parentLinkId,
      })),
    }
    expect(() => robotLinkCollisionProxiesV4({
      robotId: 'robot-a',
      definition: prototypeDefinition,
      linkWorldPoses: { 'empty-tip': IDENTITY_POSE },
      effectiveVisible: true,
    })).toThrow(/missing.*world pose/i)

    const proxies = robotLinkCollisionProxiesV4({
      robotId: 'robot-a',
      definition: prototypeDefinition,
      linkWorldPoses: Object.fromEntries([
        ['__proto__', IDENTITY_POSE],
        ['empty-tip', IDENTITY_POSE],
      ]),
      effectiveVisible: true,
    })
    expect(proxies[0]?.entity.id).toBe(robotLinkCollisionIdV4('robot-a', '__proto__'))
  })

  it('creates deterministic Box, Cylinder, and asset Spatial proxies', () => {
    const box = spatialEntityCollisionProxyV4({
      entity: spatialEntity('box|1', {
        kind: 'box', dimensionsM: [2, 4, 6], color: '#fff',
      }),
      worldPose: IDENTITY_POSE,
      effectiveVisible: true,
    })
    const cylinder = spatialEntityCollisionProxyV4({
      entity: spatialEntity('cylinder', {
        kind: 'cylinder', radiusM: 2, heightM: 6, axis: 'z',
        radialSegments: 32, color: '#fff',
      }),
      worldPose: IDENTITY_POSE,
      effectiveVisible: true,
    })
    const asset = spatialEntityCollisionProxyV4({
      entity: spatialEntity('asset', {
        kind: 'asset',
        assetReferenceId: 'asset-a',
        occurrenceKey: 'asset-occurrence',
        sourceConvention: {
          linearUnit: 'meter', sourceToMeters: 1,
          orientation: { mode: 'up-axis', upAxis: 'z' },
        },
        originMode: 'source',
        statistics: { vertices: 0, triangles: 0, meshes: 0, materials: 0 },
        collisionBoxes: [v4Box('main')],
      }),
      worldPose: IDENTITY_POSE,
      effectiveVisible: false,
    })

    expect(box?.entity).toMatchObject({
      id: spatialEntityCollisionIdV4('box|1'),
      boxes: [{ id: 'primitive', halfExtents: [1, 2, 3] }],
    })
    expect(cylinder?.entity.boxes).toEqual([
      expect.objectContaining({ id: 'primitive', halfExtents: [2, 2, 3] }),
    ])
    expect(asset).toMatchObject({ effectiveVisible: false })
    expect(asset?.entity.boxes).toEqual([
      expect.objectContaining({ id: 'main' }),
    ])
  })

  it('filters hidden proxies without mutating Project or proxy state', () => {
    const visible = spatialEntityCollisionProxyV4({
      entity: spatialEntity('visible', {
        kind: 'box', dimensionsM: [1, 1, 1], color: '#fff',
      }),
      worldPose: IDENTITY_POSE,
      effectiveVisible: true,
    })!
    const hidden = spatialEntityCollisionProxyV4({
      entity: spatialEntity('hidden', {
        kind: 'box', dimensionsM: [1, 1, 1], color: '#fff',
      }),
      worldPose: IDENTITY_POSE,
      effectiveVisible: false,
    })!
    const before = JSON.stringify([visible, hidden])

    expect(visibleCollisionEntitiesV4([hidden, visible])).toEqual([visible.entity])
    expect(JSON.stringify([visible, hidden])).toBe(before)
  })
})
