import {
  validateWorkcellProjectSnapshotV2,
  validateWorkcellProjectSnapshotV1,
  WORKCELL_PROJECT_SCHEMA_VERSION_V2,
  type ProjectCollisionBoxV2,
  type WorkcellProjectSnapshotV1,
  type WorkcellProjectSnapshotV2,
} from './project'

function defaultBox(
  center: readonly [number, number, number],
  halfExtents: readonly [number, number, number],
): ProjectCollisionBoxV2 {
  return {
    id: 'default',
    center: [...center],
    halfExtents: [...halfExtents],
    quaternion: [0, 0, 0, 1],
  }
}

export function migrateV1ToV2(
  candidate: WorkcellProjectSnapshotV1,
): WorkcellProjectSnapshotV2 {
  const source = structuredClone(validateWorkcellProjectSnapshotV1(candidate))
  return validateWorkcellProjectSnapshotV2({
    ...source,
    manifest: {
      ...source.manifest,
      schemaVersion: WORKCELL_PROJECT_SCHEMA_VERSION_V2,
    },
    robot: {
      ...source.robot,
      links: source.robot.links.map((link) => ({
        ...link,
        collisionBoxes: [
          defaultBox(link.collisionCenter, link.collisionHalfExtents),
        ],
      })),
    },
    objectAssets: source.objectAssets.map((asset) => ({
      ...asset,
      collisionBoxes: [
        defaultBox(asset.colliderCenter, asset.collisionHalfExtents),
      ],
    })),
    collisionPolicy: {
      enabled: true,
      warningDistanceM: 0.02,
      ignoredPairKeys: [],
      enabledRobotSelfPairs: [],
    },
  })
}
