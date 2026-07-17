import Dexie, { type Table } from 'dexie'

export interface StoredProjectRevisionV4 {
  readonly revisionId: string
  readonly projectId: string
  readonly configRevision: string
  readonly createdAt: string
  readonly canonicalJson: string
}

/** Permanent reservation preventing commit-token ABA after compensation/reopen. */
export interface StoredProjectCommitTokenV4 {
  readonly commitToken: string
  readonly revisionId: string
  readonly createdAt: string
}

export type StoredProjectPointerV4 =
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

export class ProjectDatabaseV4 extends Dexie {
  projectRevisions!: Table<StoredProjectRevisionV4, string>
  projectPointers!: Table<StoredProjectPointerV4, string>
  projectCommitTokens!: Table<StoredProjectCommitTokenV4, string>

  constructor(name = 'robot-sim-project-v4') {
    super(name)
    this.version(1).stores({
      projectRevisions: '&revisionId,projectId',
      projectPointers: '&key,state,revisionId',
      projectCommitTokens: '&commitToken,revisionId',
    })
  }
}
