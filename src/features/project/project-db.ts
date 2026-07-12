import Dexie, { type Table } from 'dexie'
import type { WorkcellProjectSnapshotV1 } from '../../domain/project/project'

export interface StoredActiveProject {
  key: 'active'
  snapshot: WorkcellProjectSnapshotV1
}

export class ProjectDatabase extends Dexie {
  projects!: Table<StoredActiveProject, string>

  constructor(name = 'robot-sim-project') {
    super(name)
    this.version(1).stores({ projects: '&key' })
  }
}

export const projectDb = new ProjectDatabase()
