import Dexie, { type Table } from 'dexie'

export interface StoredProjectRevisionV5 {
  readonly revisionId: string
  readonly projectId: string
  readonly configRevision: string
  readonly createdAt: string
  readonly canonicalJson: string
}

/** A token is retained permanently, including after a compensated publication. */
export interface StoredProjectCommitTokenV5 {
  readonly commitToken: string
  readonly revisionId: string
  readonly createdAt: string
}

export type StoredProjectPointerV5 =
  | {
      readonly key: 'active'
      readonly state: 'stable'
      readonly revisionId: string
      readonly commitToken: string
    }
  | {
      readonly key: 'active'
      readonly state: 'publishing'
      readonly revisionId: string
      readonly previousRevisionId: string | null
      readonly previousCommitToken: string | null
      readonly commitToken: string
    }

export class ProjectDatabaseV5 extends Dexie {
  projectRevisions!: Table<StoredProjectRevisionV5, string>
  projectPointers!: Table<StoredProjectPointerV5, string>
  projectCommitTokens!: Table<StoredProjectCommitTokenV5, string>

  constructor(name = 'robot-sim-project-v5') {
    super(name)
    this.version(1).stores({
      projectRevisions: '&revisionId,projectId',
      projectPointers: '&key,state,revisionId',
      projectCommitTokens: '&commitToken,revisionId',
    })
  }
}
