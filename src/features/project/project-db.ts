import Dexie, { type Table } from 'dexie'
import type {
  ByteFreeWorkcellProjectProjectionV3,
  ProjectSourceNamespaceV1,
} from '../../domain/project/project-v3'

export interface StoredActiveProject {
  key: 'active'
  /** Existing full-snapshot bytes are untrusted until the Project store validates them. */
  snapshot: unknown
}

export type ProjectSourceBlobKeyV1 = `${ProjectSourceNamespaceV1}:${string}`

export interface ProjectSourceBlobV1 {
  readonly key: ProjectSourceBlobKeyV1
  readonly namespace: ProjectSourceNamespaceV1
  readonly sha256: string
  readonly sourceBytes: ArrayBuffer
  readonly byteLength: number
}

export type StoredWorkcellProjectSnapshotProjectionV3 =
  ByteFreeWorkcellProjectProjectionV3

export interface StoredProjectRevisionV1 {
  readonly revisionId: string
  readonly projectId: string
  readonly createdAt: string
  readonly snapshot: StoredWorkcellProjectSnapshotProjectionV3
}

/** Durable uniqueness reservation preventing commit-token ABA after reopen. */
export interface StoredProjectCommitTokenV1 {
  readonly commitToken: string
  readonly revisionId: string
  readonly createdAt: string
}

export type StoredProjectPointerV1 =
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

export class ProjectDatabase extends Dexie {
  projects!: Table<StoredActiveProject, string>
  projectRevisions!: Table<StoredProjectRevisionV1, string>
  projectSourceBlobs!: Table<ProjectSourceBlobV1, string>
  projectPointers!: Table<StoredProjectPointerV1, string>
  projectCommitTokens!: Table<StoredProjectCommitTokenV1, string>

  constructor(name = 'robot-sim-project') {
    super(name)
    this.version(1).stores({ projects: '&key' })
    this.version(2).stores({
      projects: '&key',
      projectRevisions: '&revisionId, projectId',
      projectSourceBlobs: '&key, namespace, sha256',
      projectPointers: '&key, state, revisionId',
    })
    this.version(3).stores({
      projects: '&key',
      projectRevisions: '&revisionId, projectId',
      projectSourceBlobs: '&key, namespace, sha256',
      projectPointers: '&key, state, revisionId',
      projectCommitTokens: '&commitToken, revisionId',
    })
  }
}

export const projectDb = new ProjectDatabase()
