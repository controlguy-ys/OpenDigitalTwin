import Dexie, { type Table } from 'dexie'

export interface RobotStepAssetRecordV4 {
  readonly id: string
  readonly sha256: string
  readonly sourceFileName: string
  readonly bytes: ArrayBuffer
}

export interface RobotStepAssetRepositoryV4 {
  read(id: string): Promise<RobotStepAssetRecordV4 | null>
  write(record: RobotStepAssetRecordV4): Promise<'created' | 'existing'>
  delete(id: string): Promise<void>
}

export class RobotStepAssetDatabaseV4 extends Dexie {
  robotStepAssets!: Table<RobotStepAssetRecordV4, string>

  constructor(name = 'robot-sim-robot-step-assets-v4') {
    super(name)
    this.version(1).stores({
      robotStepAssets: '&id,&sha256',
    })
  }
}

function snapshot(record: RobotStepAssetRecordV4): RobotStepAssetRecordV4 {
  return Object.freeze({
    ...record,
    bytes: record.bytes.slice(0),
  })
}

export function createRobotStepAssetRepositoryV4(
  database = new RobotStepAssetDatabaseV4(),
): RobotStepAssetRepositoryV4 {
  return Object.freeze({
    async read(id: string) {
      const record = await database.robotStepAssets.get(id)
      return record === undefined ? null : snapshot(record)
    },

    async write(record: RobotStepAssetRecordV4) {
      const existing = await database.robotStepAssets.get(record.id)
      if (existing !== undefined) {
        if (
          existing.sha256 !== record.sha256
          || existing.bytes.byteLength !== record.bytes.byteLength
        ) {
          throw new Error(`Robot STEP Asset ${record.id} conflicts with stored content.`)
        }
        return 'existing'
      }
      await database.robotStepAssets.add(snapshot(record))
      return 'created'
    },

    async delete(id: string) {
      await database.robotStepAssets.delete(id)
    },
  })
}
