import Dexie, { type Table } from 'dexie'
import type { RobotLinkGeometryRecordV1 } from '../../domain/project/project'

export class RobotGeometryDatabase extends Dexie {
  links!: Table<RobotLinkGeometryRecordV1, string>

  constructor(name = 'robot-sim-robot-geometry') {
    super(name)
    this.version(1).stores({ links: '&linkId, sourceFileName, visible' })
  }
}

export const robotGeometryDb = new RobotGeometryDatabase()
