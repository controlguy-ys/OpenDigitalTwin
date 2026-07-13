import { describe, expect, it } from 'vitest'
import type { EquipmentRecord } from '../../domain/equipment/equipment'
import type {
  ObjectAssetRecordV1,
  ObjectInstanceRecordV1,
} from '../../domain/project/project'
import {
  collisionEntityToGraspParticipantId,
  runtimeGraspParticipants,
} from './grasp-participants'

const legacy: EquipmentRecord = {
  id: 'shared-01',
  name: 'Legacy Equipment',
  kind: 'cup',
  status: 'OFF',
  transform: {
    position: [0, 0, 0],
    quaternion: [0, 0, 0, 1],
    scale: [1, 1, 1],
  },
  graspable: true,
  collisionHalfExtents: [0.1, 0.1, 0.1],
  stackLightAnchor: null,
}

const asset: ObjectAssetRecordV1 = {
  id: 'asset-01',
  name: 'Shared Asset',
  sourceFileName: 'shared.step',
  sourceBytes: new Uint8Array([1]).buffer,
  importScale: 1,
  originMode: 'source',
  colliderCenter: [0.02, 0, 0],
  collisionHalfExtents: [0.2, 0.2, 0.2],
  statistics: { vertices: 3, triangles: 1, meshes: 1, materials: 1 },
}

const instance: ObjectInstanceRecordV1 = {
  id: 'shared-01',
  assetId: asset.id,
  name: 'Imported Object',
  transform: {
    position: [1, 2, 3],
    quaternion: [0, 0, 0, 1],
    scale: [1, 1, 1],
  },
  numericStatus: 0,
  statusSource: 'manual',
  statusOverlayVisible: false,
  visible: true,
}

describe('runtime grasp participants', () => {
  it('keeps same-local-id Equipment and imported Object as distinct graspable participants', () => {
    const participants = runtimeGraspParticipants(
      [legacy],
      [asset],
      [instance],
    )

    expect(participants.map(({ entityId }) => entityId)).toEqual([
      'equipment:shared-01',
      'object:shared-01',
    ])
    expect(participants[1]).toMatchObject({
      entityId: 'object:shared-01',
      record: {
        id: 'shared-01',
        assetId: 'asset-01',
        graspable: true,
        transform: instance.transform,
      },
    })
  })

  it('accepts only canonical external collision participants from Rapier payloads', () => {
    expect(collisionEntityToGraspParticipantId('equipment:shared-01')).toBe(
      'equipment:shared-01',
    )
    expect(collisionEntityToGraspParticipantId('object:shared-01')).toBe(
      'object:shared-01',
    )
    expect(collisionEntityToGraspParticipantId('robot-link:LINK01')).toBeNull()
    expect(collisionEntityToGraspParticipantId('shared-01')).toBeNull()
  })
})
