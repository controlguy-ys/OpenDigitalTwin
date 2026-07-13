import type { PropsWithChildren } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type {
  ObjectAssetRecordV1,
  ObjectInstanceRecordV1,
} from '../../domain/project/project'
import { CollisionSystem } from './CollisionSystem'

const storeState = vi.hoisted(() => ({
  assets: [] as ObjectAssetRecordV1[],
  instances: [] as ObjectInstanceRecordV1[],
}))

vi.mock('@dimforge/rapier3d-compat', () => ({
  ActiveCollisionTypes: { ALL: 0 },
}))

vi.mock('@react-three/rapier', () => ({
  CuboidCollider: () => null,
  RigidBody: ({
    children,
    userData,
  }: PropsWithChildren<{
    userData: { collisionEntityId: string }
  }>) => (
    <div data-testid={`rigid-body-${userData.collisionEntityId}`}>
      {children}
    </div>
  ),
  interactionGroups: () => 0,
  useBeforePhysicsStep: () => undefined,
}))

vi.mock('../equipment/equipment-store', () => ({
  useEquipmentStore: (selector: (state: { records: never[] }) => unknown) =>
    selector({ records: [] }),
}))

vi.mock('../objects/object-asset-store', () => ({
  useObjectAssetStore: (
    selector: (state: typeof storeState) => unknown,
  ) => selector(storeState),
}))

const ASSET: ObjectAssetRecordV1 = {
  id: 'asset-01',
  name: 'Imported Object',
  sourceFileName: 'object.step',
  sourceBytes: new Uint8Array([1]).buffer,
  importScale: 1,
  originMode: 'source',
  colliderCenter: [0, 0, 0],
  collisionHalfExtents: [0.1, 0.1, 0.1],
  statistics: { vertices: 3, triangles: 1, meshes: 1, materials: 1 },
}

const INSTANCE: ObjectInstanceRecordV1 = {
  id: 'object-01',
  assetId: ASSET.id,
  name: 'Imported Object',
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

describe('CollisionSystem', () => {
  it('does not create a legacy Rapier body for an imported Object', () => {
    storeState.assets = [ASSET]
    storeState.instances = [INSTANCE]

    const markup = renderToStaticMarkup(
      <CollisionSystem
        equipmentObjectsRef={{ current: new Map() }}
        rig={null}
        workbenchObjectRef={{ current: null }}
      />,
    )

    expect(markup).not.toContain('data-testid="rigid-body-object:object-01"')
    expect(markup).toContain('data-testid="rigid-body-workcell:workbench"')
  })
})
