import Dexie from 'dexie'

import {
  canonicalProjectV4Json,
  configRevisionForProjectV4,
  validateWorkcellProjectV4,
  type WorkcellProjectV4,
} from '../../../core/project-v4/index.js'
import {
  ProjectDatabaseV4,
  type StoredProjectPointerV4,
  type StoredProjectRevisionV4,
} from './project-v4-db.js'
import { decodeProjectV4 } from './project-v4-codec.js'

export interface PreparedProjectRevisionV4 {
  readonly revisionId: string
  readonly configRevision: string
  readonly project: WorkcellProjectV4
}

export interface ProjectRevisionRecordV4 {
  readonly revisionId: string
  readonly configRevision: string
  readonly project: WorkcellProjectV4
}

export interface ProjectRepositoryV4 {
  prepareRevision(candidate: WorkcellProjectV4): Promise<PreparedProjectRevisionV4>
  materializePreparedProject(prepared: PreparedProjectRevisionV4): WorkcellProjectV4
  discardPreparedRevision(prepared: PreparedProjectRevisionV4): void
  commitPreparedRevision(
    expectedRevisionId: string | null,
    prepared: PreparedProjectRevisionV4,
    commitToken: string,
  ): Promise<void>
  finalizePublication(commitToken: string): Promise<void>
  compensatePublication(commitToken: string): Promise<void>
  readRevision(revisionId: string): Promise<ProjectRevisionRecordV4 | null>
  readActive(): Promise<WorkcellProjectV4 | null>
  readPointer(): Promise<StoredProjectPointerV4 | null>
  garbageCollect(): Promise<void>
}

export interface ProjectRepositoryV4Options {
  readonly database: ProjectDatabaseV4
  readonly now?: (() => string) | undefined
}

export class ProjectRepositoryV4Error extends Error {
  readonly code: string
  readonly cause?: unknown

  constructor(code: string, message: string, cause?: unknown) {
    super(`${code}: ${message}`)
    this.name = 'ProjectRepositoryV4Error'
    this.code = code
    if (cause !== undefined) this.cause = cause
  }
}

type PreparedStatus = 'prepared' | 'committed' | 'discarded' | 'failed'

interface PreparedProjectRevisionStateV4 {
  readonly authority: object
  readonly project: WorkcellProjectV4
  readonly storedRevision: StoredProjectRevisionV4
  status: PreparedStatus
}

const CONFIG_REVISION_PATTERN = /^[0-9a-f]{64}$/u
const CONTROL_CHARACTER_PATTERN = /[\p{Cc}\p{Cf}\p{Cs}\p{Zl}\p{Zp}]/u

function failRepository(code: string, message: string, cause?: unknown): never {
  throw new ProjectRepositoryV4Error(code, message, cause)
}

function isCanonicalUtcIso(value: unknown): value is string {
  if (typeof value !== 'string') return false
  try {
    return new Date(value).toISOString() === value
  } catch {
    return false
  }
}

function isPrintableCommitToken(value: unknown): value is string {
  return typeof value === 'string' &&
    value.length > 0 &&
    !CONTROL_CHARACTER_PATTERN.test(value) &&
    new TextEncoder().encode(value).byteLength <= 128
}

function validateCommitToken(commitToken: string): void {
  if (!isPrintableCommitToken(commitToken)) {
    failRepository(
      'PROJECT_COMMIT_TOKEN_INVALID',
      'Project commit token must be printable, nonempty, and at most 128 UTF-8 bytes.',
    )
  }
}

function isNonemptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

function closedPlainRecord(
  value: unknown,
  expectedKeys: readonly string[],
  code: string,
  message: string,
): Readonly<Record<string, unknown>> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return failRepository(code, message)
  }
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) {
    return failRepository(code, message)
  }
  const descriptors = Object.getOwnPropertyDescriptors(value)
  const keys = Reflect.ownKeys(descriptors)
  if (
    keys.length !== expectedKeys.length ||
    keys.some((key) => typeof key !== 'string' || !expectedKeys.includes(key))
  ) {
    return failRepository(code, message)
  }
  const record: Record<string, unknown> = Object.create(null) as Record<string, unknown>
  for (const key of expectedKeys) {
    const descriptor = descriptors[key]
    if (descriptor === undefined || !descriptor.enumerable || !('value' in descriptor)) {
      return failRepository(code, message)
    }
    record[key] = descriptor.value
  }
  return record
}

function validatePointer(value: unknown): StoredProjectPointerV4 {
  const base = closedPlainRecord(
    value,
    typeof value === 'object' && value !== null &&
        (value as { readonly state?: unknown }).state === 'publishing'
      ? [
          'key',
          'state',
          'revisionId',
          'previousRevisionId',
          'previousCommitToken',
          'commitToken',
        ]
      : ['key', 'state', 'revisionId', 'commitToken'],
    'PROJECT_POINTER_INVALID',
    'Stored Project V4 pointer is malformed.',
  )
  if (
    base.key !== 'active' ||
    (base.state !== 'stable' && base.state !== 'publishing') ||
    !isNonemptyString(base.revisionId) ||
    !isPrintableCommitToken(base.commitToken)
  ) {
    return failRepository('PROJECT_POINTER_INVALID', 'Stored Project V4 pointer is malformed.')
  }
  if (base.state === 'stable') {
    return Object.freeze({
      key: 'active',
      state: 'stable',
      revisionId: base.revisionId,
      commitToken: base.commitToken,
    })
  }
  if (
    (base.previousRevisionId !== null && !isNonemptyString(base.previousRevisionId)) ||
    (base.previousCommitToken !== null && !isPrintableCommitToken(base.previousCommitToken)) ||
    ((base.previousRevisionId === null) !== (base.previousCommitToken === null)) ||
    base.previousCommitToken === base.commitToken
  ) {
    return failRepository('PROJECT_POINTER_INVALID', 'Stored publishing Project V4 pointer is malformed.')
  }
  return Object.freeze({
    key: 'active',
    state: 'publishing',
    revisionId: base.revisionId,
    previousRevisionId: base.previousRevisionId,
    previousCommitToken: base.previousCommitToken,
    commitToken: base.commitToken,
  })
}

function validateStoredRevisionShape(
  value: unknown,
  expectedRevisionId: string,
): StoredProjectRevisionV4 {
  const record = closedPlainRecord(
    value,
    ['revisionId', 'projectId', 'configRevision', 'createdAt', 'canonicalJson'],
    'PROJECT_REVISION_CORRUPT',
    `Stored Project V4 revision ${expectedRevisionId} is malformed.`,
  )
  if (
    record.revisionId !== expectedRevisionId ||
    !isNonemptyString(record.projectId) ||
    !isCanonicalUtcIso(record.createdAt) ||
    typeof record.canonicalJson !== 'string'
  ) {
    return failRepository(
      'PROJECT_REVISION_CORRUPT',
      `Stored Project V4 revision ${expectedRevisionId} has invalid metadata.`,
    )
  }
  if (
    typeof record.configRevision !== 'string' ||
    !CONFIG_REVISION_PATTERN.test(record.configRevision)
  ) {
    return failRepository(
      'PROJECT_CONFIG_REVISION_MISMATCH',
      `Stored Project V4 revision ${expectedRevisionId} has an invalid config revision.`,
    )
  }
  return Object.freeze({
    revisionId: record.revisionId,
    projectId: record.projectId,
    configRevision: record.configRevision,
    createdAt: record.createdAt,
    canonicalJson: record.canonicalJson,
  })
}

async function materializeStoredRevision(
  value: unknown,
  expectedRevisionId: string,
): Promise<ProjectRevisionRecordV4> {
  const row = validateStoredRevisionShape(value, expectedRevisionId)
  let project: WorkcellProjectV4
  try {
    project = await decodeProjectV4(new TextEncoder().encode(row.canonicalJson))
  } catch (error) {
    return failRepository(
      'PROJECT_REVISION_CORRUPT',
      `Stored Project V4 revision ${expectedRevisionId} does not contain valid V4 JSON.`,
      error,
    )
  }
  if (project.revisionId !== row.revisionId || project.projectId !== row.projectId) {
    return failRepository(
      'PROJECT_REVISION_CORRUPT',
      `Stored Project V4 revision ${expectedRevisionId} does not match its row identity.`,
    )
  }
  if (canonicalProjectV4Json(project) !== row.canonicalJson) {
    return failRepository(
      'PROJECT_REVISION_CORRUPT',
      `Stored Project V4 revision ${expectedRevisionId} is not canonical JSON.`,
    )
  }
  const configRevision = await configRevisionForProjectV4(project)
  if (configRevision !== row.configRevision) {
    return failRepository(
      'PROJECT_CONFIG_REVISION_MISMATCH',
      `Stored Project V4 revision ${expectedRevisionId} failed its config revision check.`,
    )
  }
  return Object.freeze({
    revisionId: row.revisionId,
    configRevision: row.configRevision,
    project,
  })
}

export function createProjectRepositoryV4(
  options: ProjectRepositoryV4Options,
): ProjectRepositoryV4 {
  const database = options.database
  const now = options.now ?? (() => new Date().toISOString())
  const authority = Object.freeze({})
  const preparedStates = new WeakMap<object, PreparedProjectRevisionStateV4>()

  const preparedState = (
    prepared: PreparedProjectRevisionV4,
  ): PreparedProjectRevisionStateV4 => {
    const state = typeof prepared === 'object' && prepared !== null
      ? preparedStates.get(prepared)
      : undefined
    if (state === undefined || state.authority !== authority) {
      return failRepository(
        'PROJECT_PREPARED_REVISION_INVALID',
        'Prepared Project V4 revision is forged or belongs to another repository.',
      )
    }
    if (state.status !== 'prepared') {
      return failRepository(
        'PROJECT_PREPARED_REVISION_CONSUMED',
        'Prepared Project V4 revision is no longer available.',
      )
    }
    return state
  }

  const repository: ProjectRepositoryV4 = {
    async prepareRevision(candidate) {
      const project = validateWorkcellProjectV4(candidate)
      const canonicalJson = canonicalProjectV4Json(project)
      const configRevision = await configRevisionForProjectV4(project)
      if (!CONFIG_REVISION_PATTERN.test(configRevision)) {
        return failRepository(
          'PROJECT_CONFIG_REVISION_MISMATCH',
          'Project V4 config revision must be lowercase SHA-256 hex.',
        )
      }
      const createdAt = now()
      if (!isCanonicalUtcIso(createdAt)) {
        return failRepository(
          'PROJECT_REVISION_CORRUPT',
          'Project V4 persistence timestamp must be canonical UTC ISO text.',
        )
      }
      const storedRevision = Object.freeze({
        revisionId: project.revisionId,
        projectId: project.projectId,
        configRevision,
        createdAt,
        canonicalJson,
      })
      const prepared = Object.freeze({
        revisionId: project.revisionId,
        configRevision,
        project,
      })
      preparedStates.set(prepared, {
        authority,
        project,
        storedRevision,
        status: 'prepared',
      })
      return prepared
    },

    materializePreparedProject(prepared) {
      return preparedState(prepared).project
    },

    discardPreparedRevision(prepared) {
      const state = preparedState(prepared)
      state.status = 'discarded'
    },

    async commitPreparedRevision(expectedRevisionId, prepared, commitToken) {
      const state = preparedState(prepared)
      try {
        validateCommitToken(commitToken)
        await database.transaction(
          'rw',
          database.projectRevisions,
          database.projectPointers,
          database.projectCommitTokens,
          async () => {
            const rawPointer = await database.projectPointers.get('active')
            const pointer = rawPointer === undefined ? null : validatePointer(rawPointer)
            if (
              await database.projectCommitTokens.get(commitToken) !== undefined ||
              pointer?.commitToken === commitToken ||
              (pointer?.state === 'publishing' && pointer.previousCommitToken === commitToken)
            ) {
              return failRepository(
                'PROJECT_COMMIT_TOKEN_REUSED',
                'Project V4 commit token is permanently reserved by an earlier publication.',
              )
            }
            if (pointer?.state === 'publishing') {
              return failRepository(
                'PROJECT_PUBLICATION_IN_PROGRESS',
                'Another Project V4 publication is already in progress.',
              )
            }
            const actualRevisionId = pointer?.revisionId ?? null
            if (actualRevisionId !== expectedRevisionId) {
              return failRepository(
                'PROJECT_ACTIVE_REVISION_CHANGED',
                'The active Project V4 revision changed before commit.',
              )
            }
            await database.projectCommitTokens.add({
              commitToken,
              revisionId: state.storedRevision.revisionId,
              createdAt: state.storedRevision.createdAt,
            })
            const existing = await database.projectRevisions.get(state.storedRevision.revisionId)
            if (existing === undefined) {
              await database.projectRevisions.add(state.storedRevision)
            } else {
              const retained = validateStoredRevisionShape(
                existing,
                state.storedRevision.revisionId,
              )
              if (
                retained.projectId !== state.storedRevision.projectId ||
                retained.configRevision !== state.storedRevision.configRevision ||
                retained.canonicalJson !== state.storedRevision.canonicalJson
              ) {
                return failRepository(
                  'PROJECT_REVISION_ID_COLLISION',
                  'An immutable Project V4 revision has conflicting canonical content.',
                )
              }
            }
            await database.projectPointers.put({
              key: 'active',
              state: 'publishing',
              revisionId: state.storedRevision.revisionId,
              previousRevisionId: pointer?.revisionId ?? null,
              previousCommitToken: pointer?.commitToken ?? null,
              commitToken,
            })
          },
        )
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
        if (rawPointer === undefined) {
          return failRepository(
            'PROJECT_PUBLICATION_NOT_FOUND',
            'No Project V4 publication exists.',
          )
        }
        const pointer = validatePointer(rawPointer)
        if (pointer.state === 'stable') {
          if (pointer.commitToken === commitToken) return
          return failRepository(
            'PROJECT_PUBLICATION_TOKEN_MISMATCH',
            'Stable Project V4 publication has another token.',
          )
        }
        if (pointer.commitToken !== commitToken) {
          return failRepository(
            'PROJECT_PUBLICATION_TOKEN_MISMATCH',
            'Publishing Project V4 publication has another token.',
          )
        }
        await database.projectPointers.put({
          key: 'active',
          state: 'stable',
          revisionId: pointer.revisionId,
          commitToken: pointer.commitToken,
        })
      })
    },

    async compensatePublication(commitToken) {
      validateCommitToken(commitToken)
      await database.transaction(
        'rw',
        database.projectPointers,
        database.projectRevisions,
        async () => {
          const rawPointer = await database.projectPointers.get('active')
          if (rawPointer === undefined) {
            return failRepository(
              'PROJECT_PUBLICATION_NOT_FOUND',
              'No Project V4 publication exists.',
            )
          }
          const pointer = validatePointer(rawPointer)
          if (pointer.state === 'stable') {
            if (pointer.commitToken === commitToken) {
              return failRepository(
                'PROJECT_PUBLICATION_ALREADY_FINALIZED',
                'A stable Project V4 publication cannot be compensated.',
              )
            }
            return failRepository(
              'PROJECT_PUBLICATION_TOKEN_MISMATCH',
              'Stable Project V4 publication has another token.',
            )
          }
          if (pointer.commitToken !== commitToken) {
            return failRepository(
              'PROJECT_PUBLICATION_TOKEN_MISMATCH',
              'Publishing Project V4 publication has another token.',
            )
          }
          if (pointer.previousRevisionId === null) {
            await database.projectPointers.delete('active')
            return
          }
          const previous = await database.projectRevisions.get(pointer.previousRevisionId)
          if (previous === undefined || pointer.previousCommitToken === null) {
            return failRepository(
              'PROJECT_PREVIOUS_REVISION_MISSING',
              'The previous stable Project V4 revision cannot be restored.',
            )
          }
          await Dexie.waitFor(materializeStoredRevision(previous, pointer.previousRevisionId))
          await database.projectPointers.put({
            key: 'active',
            state: 'stable',
            revisionId: pointer.previousRevisionId,
            commitToken: pointer.previousCommitToken,
          })
        },
      )
    },

    async readRevision(revisionId) {
      const row = await database.projectRevisions.get(revisionId)
      return row === undefined ? null : materializeStoredRevision(row, revisionId)
    },

    async readActive() {
      return database.transaction(
        'r',
        database.projectPointers,
        database.projectRevisions,
        async () => {
          const rawPointer = await database.projectPointers.get('active')
          if (rawPointer === undefined) return null
          const pointer = validatePointer(rawPointer)
          const row = await database.projectRevisions.get(pointer.revisionId)
          if (row === undefined) {
            return failRepository(
              'PROJECT_REVISION_MISSING',
              `Active Project V4 revision ${pointer.revisionId} is missing.`,
            )
          }
          const record = await Dexie.waitFor(materializeStoredRevision(row, pointer.revisionId))
          return record.project
        },
      )
    },

    async readPointer() {
      const rawPointer = await database.projectPointers.get('active')
      return rawPointer === undefined ? null : validatePointer(rawPointer)
    },

    async garbageCollect() {
      await database.transaction(
        'rw',
        database.projectPointers,
        database.projectRevisions,
        async () => {
          const rawPointer = await database.projectPointers.get('active')
          if (rawPointer === undefined) {
            return failRepository(
              'PROJECT_POINTER_MISSING',
              'No active Project V4 pointer exists for garbage collection.',
            )
          }
          const pointer = validatePointer(rawPointer)
          const retainedRevisionIds = new Set<string>([pointer.revisionId])
          if (pointer.state === 'publishing' && pointer.previousRevisionId !== null) {
            retainedRevisionIds.add(pointer.previousRevisionId)
          }
          for (const revisionId of retainedRevisionIds) {
            const row = await database.projectRevisions.get(revisionId)
            if (row === undefined) {
              return failRepository(
                'PROJECT_REVISION_MISSING',
                `Retained Project V4 revision ${revisionId} is missing.`,
              )
            }
            await Dexie.waitFor(materializeStoredRevision(row, revisionId))
          }
          const keys = await database.projectRevisions.toCollection().primaryKeys()
          await database.projectRevisions.bulkDelete(
            keys.filter((key) => !retainedRevisionIds.has(String(key))),
          )
        },
      )
    },
  }

  return Object.freeze(repository)
}
