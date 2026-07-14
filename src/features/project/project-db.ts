import Dexie, { type Table } from 'dexie'
import type {
  LegacyProjectSnapshotV2 as CurrentProjectSnapshot,
} from '../../domain/project/project'

export interface StoredActiveProject {
  key: 'active'
  snapshot: CurrentProjectSnapshot
}

export class ProjectDatabase extends Dexie {
  projects!: Table<StoredActiveProject, string>

  constructor(name = 'robot-sim-project') {
    super(name)
    this.version(1).stores({ projects: '&key' })
  }
}

export const projectDb = new ProjectDatabase()
