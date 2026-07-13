import Dexie, { type Table } from 'dexie'
import type {
  ObjectAssetRecordV2,
  ObjectInstanceRecordV1,
} from '../../domain/project/project'

export class ObjectAssetDatabase extends Dexie {
  assets!: Table<ObjectAssetRecordV2, string>
  instances!: Table<ObjectInstanceRecordV1, string>

  constructor(name = 'robot-sim-object-assets') {
    super(name)
    this.version(1).stores({
      assets: '&id, name, sourceFileName',
      instances: '&id, assetId, name, statusSource',
    })
  }
}

export const objectAssetDb = new ObjectAssetDatabase()
