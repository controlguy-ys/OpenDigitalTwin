import Dexie from 'dexie'

import {
  canonicalProjectV5Json,
  configRevisionForProjectV5,
  validateWorkcellProjectV5,
  type WorkcellProjectV5,
} from '../../../core/project-v5/index.js'
import {
  ProjectDatabaseV5,
  type StoredProjectPointerV5,
  type StoredProjectRevisionV5,
} from './project-v5-db.js'
import { decodeProjectV5 } from './project-v5-codec.js'

export interface PreparedProjectRevisionV5 {
  readonly revisionId: string
  readonly configRevision: string
  readonly project: WorkcellProjectV5
}

export interface ProjectRevisionRecordV5 {
  readonly revisionId: string
  readonly configRevision: string
  readonly project: WorkcellProjectV5
}

export interface ProjectRepositoryV5 {
  prepareRevision(candidate: WorkcellProjectV5): Promise<PreparedProjectRevisionV5>
  materializePreparedProject(prepared: PreparedProjectRevisionV5): WorkcellProjectV5
  discardPreparedRevision(prepared: PreparedProjectRevisionV5): void
  commitPreparedRevision(expectedRevisionId: string | null, prepared: PreparedProjectRevisionV5, commitToken: string): Promise<void>
  finalizePublication(commitToken: string): Promise<void>
  compensatePublication(commitToken: string): Promise<void>
  readRevision(revisionId: string): Promise<ProjectRevisionRecordV5 | null>
  readActive(): Promise<WorkcellProjectV5 | null>
  readPointer(): Promise<StoredProjectPointerV5 | null>
  garbageCollect(): Promise<void>
}

export interface ProjectRepositoryV5Options {
  readonly database: ProjectDatabaseV5
  readonly now?: (() => string) | undefined
}

export class ProjectRepositoryV5Error extends Error {
  readonly code: string
  readonly cause?: unknown

  constructor(code: string, message: string, cause?: unknown) {
    super(`${code}: ${message}`)
    this.name = 'ProjectRepositoryV5Error'
    this.code = code
    if (cause !== undefined) this.cause = cause
  }
}

type PreparedStatus = 'prepared' | 'committing' | 'committed' | 'discarded' | 'failed'

interface PreparedState {
  readonly authority: object
  readonly storedRevision: StoredProjectRevisionV5
  status: PreparedStatus
}

const CONFIG_REVISION_PATTERN = /^[0-9a-f]{64}$/u
const CONTROL_CHARACTER_PATTERN = /[\p{Cc}\p{Cf}\p{Cs}\p{Zl}\p{Zp}]/u

function failRepository(code: string, message: string, cause?: unknown): never {
  throw new ProjectRepositoryV5Error(code, message, cause)
}

function isCanonicalUtcIso(value: unknown): value is string {
  if (typeof value !== 'string') return false
  try {
    return new Date(value).toISOString() === value
  } catch {
    return false
  }
}

function isNonemptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

function isPrintableCommitToken(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 &&
    !CONTROL_CHARACTER_PATTERN.test(value) && new TextEncoder().encode(value).byteLength <= 128
}

function validateCommitToken(commitToken: string): void {
  if (!isPrintableCommitToken(commitToken)) {
    failRepository('PROJECT_COMMIT_TOKEN_INVALID', 'Commit token must be printable, nonempty, and at most 128 UTF-8 bytes.')
  }
}

function closedPlainRecord(value: unknown, keys: readonly string[], code: string): Readonly<Record<string, unknown>> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return failRepository(code, 'Stored Project V5 row is malformed.')
  }
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) return failRepository(code, 'Stored Project V5 row is malformed.')
  const descriptors = Object.getOwnPropertyDescriptors(value)
  const actualKeys = Reflect.ownKeys(descriptors)
  if (actualKeys.length !== keys.length || actualKeys.some((key) => typeof key !== 'string' || !keys.includes(key))) {
    return failRepository(code, 'Stored Project V5 row is malformed.')
  }
  const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>
  for (const key of keys) {
    const descriptor = descriptors[key]
    if (descriptor === undefined || !descriptor.enumerable || !('value' in descriptor)) {
      return failRepository(code, 'Stored Project V5 row is malformed.')
    }
    result[key] = descriptor.value
  }
  return result
}

function validatePointer(value: unknown): StoredProjectPointerV5 {
  const publishing = typeof value === 'object' && value !== null &&
    (value as { readonly state?: unknown }).state === 'publishing'
  const row = closedPlainRecord(
    value,
    publishing
      ? ['key', 'state', 'revisionId', 'previousRevisionId', 'previousCommitToken', 'commitToken']
      : ['key', 'state', 'revisionId', 'commitToken'],
    'PROJECT_POINTER_INVALID',
  )
  if (row.key !== 'active' || (row.state !== 'stable' && row.state !== 'publishing') ||
      !isNonemptyString(row.revisionId) || !isPrintableCommitToken(row.commitToken)) {
    return failRepository('PROJECT_POINTER_INVALID', 'Stored Project V5 pointer is malformed.')
  }
  if (row.state === 'stable') {
    return Object.freeze({ key: 'active', state: 'stable', revisionId: row.revisionId, commitToken: row.commitToken })
  }
  if ((row.previousRevisionId !== null && !isNonemptyString(row.previousRevisionId)) ||
      (row.previousCommitToken !== null && !isPrintableCommitToken(row.previousCommitToken)) ||
      (row.previousRevisionId === null) !== (row.previousCommitToken === null) ||
      row.previousCommitToken === row.commitToken) {
    return failRepository('PROJECT_POINTER_INVALID', 'Stored publishing Project V5 pointer is malformed.')
  }
  return Object.freeze({
    key: 'active', state: 'publishing', revisionId: row.revisionId,
    previousRevisionId: row.previousRevisionId, previousCommitToken: row.previousCommitToken,
    commitToken: row.commitToken,
  })
}

function validateStoredRevisionShape(value: unknown, expectedRevisionId: string): StoredProjectRevisionV5 {
  const row = closedPlainRecord(
    value,
    ['revisionId', 'projectId', 'configRevision', 'createdAt', 'canonicalJson'],
    'PROJECT_REVISION_CORRUPT',
  )
  if (row.revisionId !== expectedRevisionId || !isNonemptyString(row.projectId) ||
      !isCanonicalUtcIso(row.createdAt) || typeof row.canonicalJson !== 'string') {
    return failRepository('PROJECT_REVISION_CORRUPT', `Revision ${expectedRevisionId} has invalid metadata.`)
  }
  if (typeof row.configRevision !== 'string' || !CONFIG_REVISION_PATTERN.test(row.configRevision)) {
    return failRepository('PROJECT_CONFIG_REVISION_MISMATCH', `Revision ${expectedRevisionId} has an invalid config revision.`)
  }
  return Object.freeze({
    revisionId: row.revisionId, projectId: row.projectId, configRevision: row.configRevision,
    createdAt: row.createdAt, canonicalJson: row.canonicalJson,
  })
}

async function materializeStoredRevision(value: unknown, expectedRevisionId: string): Promise<ProjectRevisionRecordV5> {
  const row = validateStoredRevisionShape(value, expectedRevisionId)
  let project: WorkcellProjectV5
  try {
    project = await decodeProjectV5(new TextEncoder().encode(row.canonicalJson))
  } catch (error) {
    return failRepository('PROJECT_REVISION_CORRUPT', `Revision ${expectedRevisionId} does not contain valid V5 JSON.`, error)
  }
  if (project.revisionId !== row.revisionId || project.projectId !== row.projectId) {
    return failRepository('PROJECT_REVISION_CORRUPT', `Revision ${expectedRevisionId} does not match its row identity.`)
  }
  if (canonicalProjectV5Json(project) !== row.canonicalJson) {
    return failRepository('PROJECT_REVISION_CORRUPT', `Revision ${expectedRevisionId} is not canonical JSON.`)
  }
  if (await configRevisionForProjectV5(project) !== row.configRevision) {
    return failRepository('PROJECT_CONFIG_REVISION_MISMATCH', `Revision ${expectedRevisionId} failed its config revision check.`)
  }
  return Object.freeze({ revisionId: row.revisionId, configRevision: row.configRevision, project })
}

function materializePrepared(state: PreparedState): WorkcellProjectV5 {
  try {
    return validateWorkcellProjectV5(JSON.parse(state.storedRevision.canonicalJson))
  } catch (error) {
    return failRepository('PROJECT_REVISION_CORRUPT', 'Prepared Project V5 revision cannot be materialized.', error)
  }
}

export function createProjectRepositoryV5(options: ProjectRepositoryV5Options): ProjectRepositoryV5 {
  const database = options.database
  const now = options.now ?? (() => new Date().toISOString())
  const authority = Object.freeze({})
  const preparedStates = new WeakMap<object, PreparedState>()

  const preparedState = (prepared: PreparedProjectRevisionV5): PreparedState => {
    const state = typeof prepared === 'object' && prepared !== null ? preparedStates.get(prepared) : undefined
    if (state === undefined || state.authority !== authority) {
      return failRepository('PROJECT_PREPARED_REVISION_INVALID', 'Prepared Project V5 revision is forged or belongs to another repository.')
    }
    if (state.status !== 'prepared') {
      return failRepository('PROJECT_PREPARED_REVISION_CONSUMED', 'Prepared Project V5 revision is no longer available.')
    }
    return state
  }

  const repository: ProjectRepositoryV5 = {
    async prepareRevision(candidate) {
      const project = validateWorkcellProjectV5(candidate)
      const canonicalJson = canonicalProjectV5Json(project)
      const configRevision = await configRevisionForProjectV5(project)
      if (!CONFIG_REVISION_PATTERN.test(configRevision)) {
        return failRepository('PROJECT_CONFIG_REVISION_MISMATCH', 'Project V5 config revision must be lowercase SHA-256 hex.')
      }
      const createdAt = now()
      if (!isCanonicalUtcIso(createdAt)) {
        return failRepository('PROJECT_REVISION_CORRUPT', 'Project V5 persistence timestamp must be canonical UTC ISO text.')
      }
      const storedRevision = Object.freeze({
        revisionId: project.revisionId, projectId: project.projectId, configRevision, createdAt, canonicalJson,
      })
      const prepared = Object.freeze({ revisionId: project.revisionId, configRevision, project: materializePrepared({ authority, storedRevision, status: 'prepared' }) })
      preparedStates.set(prepared, { authority, storedRevision, status: 'prepared' })
      return prepared
    },

    materializePreparedProject(prepared) {
      return materializePrepared(preparedState(prepared))
    },

    discardPreparedRevision(prepared) {
      preparedState(prepared).status = 'discarded'
    },

    async commitPreparedRevision(expectedRevisionId, prepared, commitToken) {
      const state = preparedState(prepared)
      state.status = 'committing'
      try {
        validateCommitToken(commitToken)
        await database.transaction('rw', database.projectRevisions, database.projectPointers, database.projectCommitTokens, async () => {
          const rawPointer = await database.projectPointers.get('active')
          const pointer = rawPointer === undefined ? null : validatePointer(rawPointer)
          if (await database.projectCommitTokens.get(commitToken) !== undefined || pointer?.commitToken === commitToken ||
              (pointer?.state === 'publishing' && pointer.previousCommitToken === commitToken)) {
            return failRepository('PROJECT_COMMIT_TOKEN_REUSED', 'Commit token is permanently reserved by an earlier publication.')
          }
          if (pointer?.state === 'publishing') return failRepository('PROJECT_PUBLICATION_IN_PROGRESS', 'A Project V5 publication is already in progress.')
          if ((pointer?.revisionId ?? null) !== expectedRevisionId) {
            return failRepository('PROJECT_ACTIVE_REVISION_CHANGED', 'The active Project V5 revision changed before commit.')
          }
          await database.projectCommitTokens.add({
            commitToken, revisionId: state.storedRevision.revisionId, createdAt: state.storedRevision.createdAt,
          })
          const existing = await database.projectRevisions.get(state.storedRevision.revisionId)
          if (existing === undefined) {
            await database.projectRevisions.add(state.storedRevision)
          } else {
            const retained = validateStoredRevisionShape(existing, state.storedRevision.revisionId)
            await Dexie.waitFor(materializeStoredRevision(retained, state.storedRevision.revisionId))
            if (retained.projectId !== state.storedRevision.projectId ||
                retained.configRevision !== state.storedRevision.configRevision ||
                retained.canonicalJson !== state.storedRevision.canonicalJson) {
              return failRepository('PROJECT_REVISION_ID_COLLISION', 'An immutable Project V5 revision has conflicting canonical content.')
            }
          }
          await database.projectPointers.put({
            key: 'active', state: 'publishing', revisionId: state.storedRevision.revisionId,
            previousRevisionId: pointer?.revisionId ?? null, previousCommitToken: pointer?.commitToken ?? null,
            commitToken,
          })
        })
        state.status = 'committed'
      } catch (error) {
        state.status = 'failed'
        throw error
      }
    },

    async finalizePublication(commitToken) {
      validateCommitToken(commitToken)
      await database.transaction('rw', database.projectPointers, async () => {
        const rawPointer = await database.projectPointers.get('active')
        if (rawPointer === undefined) return failRepository('PROJECT_PUBLICATION_NOT_FOUND', 'No Project V5 publication exists.')
        const pointer = validatePointer(rawPointer)
        if (pointer.state === 'stable') {
          if (pointer.commitToken === commitToken) return
          return failRepository('PROJECT_PUBLICATION_TOKEN_MISMATCH', 'Stable Project V5 publication has another token.')
        }
        if (pointer.commitToken !== commitToken) return failRepository('PROJECT_PUBLICATION_TOKEN_MISMATCH', 'Publishing Project V5 publication has another token.')
        await database.projectPointers.put({ key: 'active', state: 'stable', revisionId: pointer.revisionId, commitToken: pointer.commitToken })
      })
    },

    async compensatePublication(commitToken) {
      validateCommitToken(commitToken)
      await database.transaction('rw', database.projectPointers, database.projectRevisions, async () => {
        const rawPointer = await database.projectPointers.get('active')
        if (rawPointer === undefined) return failRepository('PROJECT_PUBLICATION_NOT_FOUND', 'No Project V5 publication exists.')
        const pointer = validatePointer(rawPointer)
        if (pointer.state === 'stable') {
          if (pointer.commitToken === commitToken) return failRepository('PROJECT_PUBLICATION_ALREADY_FINALIZED', 'A stable Project V5 publication cannot be compensated.')
          return failRepository('PROJECT_PUBLICATION_TOKEN_MISMATCH', 'Stable Project V5 publication has another token.')
        }
        if (pointer.commitToken !== commitToken) return failRepository('PROJECT_PUBLICATION_TOKEN_MISMATCH', 'Publishing Project V5 publication has another token.')
        if (pointer.previousRevisionId === null) {
          await database.projectPointers.delete('active')
          return
        }
        const previous = await database.projectRevisions.get(pointer.previousRevisionId)
        if (previous === undefined || pointer.previousCommitToken === null) {
          return failRepository('PROJECT_PREVIOUS_REVISION_MISSING', 'The previous stable Project V5 revision cannot be restored.')
        }
        await Dexie.waitFor(materializeStoredRevision(previous, pointer.previousRevisionId))
        await database.projectPointers.put({
          key: 'active', state: 'stable', revisionId: pointer.previousRevisionId, commitToken: pointer.previousCommitToken,
        })
      })
    },

    async readRevision(revisionId) {
      const row = await database.projectRevisions.get(revisionId)
      return row === undefined ? null : materializeStoredRevision(row, revisionId)
    },

    async readActive() {
      return database.transaction('r', database.projectPointers, database.projectRevisions, async () => {
        const rawPointer = await database.projectPointers.get('active')
        if (rawPointer === undefined) return null
        const pointer = validatePointer(rawPointer)
        const row = await database.projectRevisions.get(pointer.revisionId)
        if (row === undefined) return failRepository('PROJECT_REVISION_MISSING', `Active Project V5 revision ${pointer.revisionId} is missing.`)
        return (await Dexie.waitFor(materializeStoredRevision(row, pointer.revisionId))).project
      })
    },

    async readPointer() {
      const pointer = await database.projectPointers.get('active')
      return pointer === undefined ? null : validatePointer(pointer)
    },

    async garbageCollect() {
      await database.transaction('rw', database.projectPointers, database.projectRevisions, async () => {
        const rawPointer = await database.projectPointers.get('active')
        if (rawPointer === undefined) return failRepository('PROJECT_POINTER_MISSING', 'No active Project V5 pointer exists for garbage collection.')
        const pointer = validatePointer(rawPointer)
        const retained = new Set<string>([pointer.revisionId])
        if (pointer.state === 'publishing' && pointer.previousRevisionId !== null) retained.add(pointer.previousRevisionId)
        for (const revisionId of retained) {
          const row = await database.projectRevisions.get(revisionId)
          if (row === undefined) return failRepository('PROJECT_REVISION_MISSING', `Retained Project V5 revision ${revisionId} is missing.`)
          await Dexie.waitFor(materializeStoredRevision(row, revisionId))
        }
        const keys = await database.projectRevisions.toCollection().primaryKeys()
        await database.projectRevisions.bulkDelete(keys.filter((key) => !retained.has(String(key))))
      })
    },
  }
  return Object.freeze(repository)
}
