import Dexie from 'dexie'
import {
  preflightWorkcellProjectShapeV3,
  type WorkcellProjectSnapshotV3,
} from '../../domain/project/project-v3'
import type {
  ProjectDatabase,
  ProjectSourceBlobKeyV1,
  StoredProjectPointerV1,
  StoredProjectRevisionV1,
  StoredWorkcellProjectSnapshotProjectionV3,
} from './project-db'
import { createProjectRevisionIdentityProjectionV3 } from './project-revision-canonical'

const SHA256 = /^[0-9a-f]{64}$/
const ARRAY_BUFFER_BYTE_LENGTH_GETTER = Object.getOwnPropertyDescriptor(
  ArrayBuffer.prototype,
  'byteLength',
)?.get

/** Conservative fixed allowance for one immutable revision and pointer write. */
export const PROJECT_REVISION_COMMIT_OVERHEAD_BYTES_V1 = 256 * 1024

export class ProjectRevisionStorageError extends Error {
  readonly code: string

  constructor(code: string, message: string, cause?: unknown) {
    super(`${code}: ${message}`, cause === undefined ? undefined : { cause })
    this.name = 'ProjectRevisionStorageError'
    this.code = code
  }
}

export interface ProjectRevisionGarbageCollectionHooksV1 {
  readonly afterPointerRead?: (() => void | Promise<void>) | undefined
}

export interface ProjectStorageEstimateV1 {
  readonly usage?: number | undefined
  readonly quota?: number | undefined
}

export interface ProjectRevisionStorageQuotaPreflightV1 {
  readonly additionalUniqueBlobBytes: number
  readonly estimate?: (() => Promise<ProjectStorageEstimateV1>) | undefined
}

function fail(code: string, message: string, cause?: unknown): never {
  throw new ProjectRevisionStorageError(code, message, cause)
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
}

function exactKeys(record: Record<string, unknown>, expected: readonly string[]): boolean {
  const keys = Reflect.ownKeys(record)
  return keys.length === expected.length &&
    keys.every((key) => typeof key === 'string' && expected.includes(key))
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

function sha256String(value: unknown): value is string {
  return typeof value === 'string' && SHA256.test(value)
}

function arrayBufferByteLength(value: unknown): number | undefined {
  if (typeof value !== 'object' || value === null || ARRAY_BUFFER_BYTE_LENGTH_GETTER === undefined) {
    return undefined
  }
  try {
    return Reflect.apply(ARRAY_BUFFER_BYTE_LENGTH_GETTER, value, []) as number
  } catch {
    return undefined
  }
}

function defaultStorageEstimate(): (() => Promise<ProjectStorageEstimateV1>) | undefined {
  const storage = globalThis.navigator?.storage
  return storage === undefined || typeof storage.estimate !== 'function'
    ? undefined
    : storage.estimate.bind(storage)
}

/**
 * Performs the advisory storage estimate before the caller opens its write
 * transaction. An unavailable or failed estimate is unknown, not sufficient.
 */
export async function preflightProjectRevisionStorageQuotaV1(
  input: ProjectRevisionStorageQuotaPreflightV1,
): Promise<void> {
  if (
    !Number.isSafeInteger(input.additionalUniqueBlobBytes) ||
    input.additionalUniqueBlobBytes < 0 ||
    input.additionalUniqueBlobBytes >
      Number.MAX_SAFE_INTEGER - PROJECT_REVISION_COMMIT_OVERHEAD_BYTES_V1
  ) {
    return fail(
      'PROJECT_STORAGE_QUOTA_INPUT_INVALID',
      'Additional Project source storage must be a non-negative safe integer.',
    )
  }
  const estimateStorage = input.estimate ?? defaultStorageEstimate()
  if (estimateStorage === undefined) return
  let estimate: ProjectStorageEstimateV1
  try {
    estimate = await estimateStorage()
  } catch {
    return
  }
  const { usage, quota } = estimate
  if (
    typeof usage !== 'number' ||
    typeof quota !== 'number' ||
    !Number.isFinite(usage) ||
    !Number.isFinite(quota) ||
    usage < 0 ||
    quota < 0
  ) {
    return
  }
  const required = input.additionalUniqueBlobBytes +
    PROJECT_REVISION_COMMIT_OVERHEAD_BYTES_V1
  if (quota - usage < required) {
    return fail(
      'PROJECT_STORAGE_QUOTA_INSUFFICIENT',
      'Known browser storage headroom is insufficient for this Project revision.',
    )
  }
}

/** Call only after a Dexie transaction has rejected and rolled back. */
export function rethrowProjectRevisionStorageWriteErrorV1(error: unknown): never {
  if (error instanceof Dexie.QuotaExceededError) {
    return fail(
      'PROJECT_STORAGE_QUOTA_INSUFFICIENT',
      'IndexedDB rejected the Project revision because storage quota was exceeded.',
      error,
    )
  }
  throw error
}

function validateNativePointer(value: unknown): StoredProjectPointerV1 {
  if (!isPlainRecord(value) || value.key !== 'active') {
    return fail('PROJECT_POINTER_INVALID', 'Stored Project pointer is malformed.')
  }
  if (!sha256String(value.revisionId) || !nonEmptyString(value.commitToken)) {
    return fail('PROJECT_POINTER_INVALID', 'Stored Project pointer identity is malformed.')
  }
  if (value.state === 'stable') {
    if (!exactKeys(value, ['key', 'state', 'revisionId', 'commitToken'])) {
      return fail('PROJECT_POINTER_INVALID', 'Stable Project pointer is not a closed native record.')
    }
    return value as unknown as StoredProjectPointerV1
  }
  if (
    value.state !== 'publishing' ||
    !exactKeys(value, [
      'key',
      'state',
      'revisionId',
      'previousRevisionId',
      'previousCommitToken',
      'commitToken',
    ]) ||
    (value.previousRevisionId !== null && !sha256String(value.previousRevisionId)) ||
    (value.previousCommitToken !== null && !nonEmptyString(value.previousCommitToken)) ||
    ((value.previousRevisionId === null) !== (value.previousCommitToken === null))
  ) {
    return fail('PROJECT_POINTER_INVALID', 'Publishing Project pointer is not a closed native record.')
  }
  return value as unknown as StoredProjectPointerV1
}

function validateRevision(
  value: unknown,
  expectedRevisionId: string,
): StoredProjectRevisionV1 {
  if (
    !isPlainRecord(value) ||
    !exactKeys(value, ['revisionId', 'projectId', 'createdAt', 'snapshot']) ||
    value.revisionId !== expectedRevisionId ||
    !SHA256.test(expectedRevisionId) ||
    !nonEmptyString(value.projectId) ||
    !nonEmptyString(value.createdAt) ||
    !Number.isFinite(Date.parse(value.createdAt)) ||
    !isPlainRecord(value.snapshot)
  ) {
    return fail('PROJECT_REVISION_INVALID', `Stored Project revision ${expectedRevisionId} is malformed.`)
  }
  const manifest = value.snapshot.manifest
  if (!isPlainRecord(manifest) || manifest.projectId !== value.projectId) {
    return fail(
      'PROJECT_REVISION_INVALID',
      `Stored Project revision ${expectedRevisionId} has a mismatched Project identity.`,
    )
  }
  try {
    createProjectRevisionIdentityProjectionV3(value.snapshot)
  } catch (error) {
    return fail(
      'PROJECT_REVISION_INVALID',
      `Stored Project revision ${expectedRevisionId} has an invalid projection graph.`,
      error,
    )
  }
  return value as unknown as StoredProjectRevisionV1
}

function exactReachableBlobKeys(
  projection: StoredWorkcellProjectSnapshotProjectionV3,
  revisionId: string,
): ReadonlySet<ProjectSourceBlobKeyV1> {
  const projectionRecord = projection as unknown as Record<string, unknown>
  const robot = projectionRecord.robot
  const objectAssets = projectionRecord.objectAssets
  if (!isPlainRecord(robot) || !Array.isArray(robot.sources) || !Array.isArray(objectAssets)) {
    return fail(
      'PROJECT_REVISION_INVALID',
      `Stored Project revision ${revisionId} has no closed source projection.`,
    )
  }
  const reachable = new Set<ProjectSourceBlobKeyV1>()
  for (const source of robot.sources) {
    if (
      !isPlainRecord(source) ||
      !sha256String(source.sha256) ||
      source.id !== source.sha256 ||
      Reflect.has(source, 'sourceBytes')
    ) {
      return fail(
        'PROJECT_REVISION_INVALID',
        `Stored Project revision ${revisionId} has an invalid Robot source reference.`,
      )
    }
    reachable.add(`robot:${source.sha256 as string}`)
  }
  for (const asset of objectAssets) {
    if (!isPlainRecord(asset) || !nonEmptyString(asset.sourceKind)) {
      return fail(
        'PROJECT_REVISION_INVALID',
        `Stored Project revision ${revisionId} has an invalid Object Asset projection.`,
      )
    }
    if (asset.sourceKind === 'step') {
      if (
        !sha256String(asset.sourceSha256) ||
        Reflect.has(asset, 'sourceBytes')
      ) {
        return fail(
          'PROJECT_REVISION_INVALID',
          `Stored Project revision ${revisionId} has an invalid Object source reference.`,
        )
      }
      reachable.add(`object:${asset.sourceSha256 as string}`)
    } else if (asset.sourceKind !== 'box' && asset.sourceKind !== 'cylinder') {
      return fail(
        'PROJECT_REVISION_INVALID',
        `Stored Project revision ${revisionId} has an unknown Object source kind.`,
      )
    }
  }
  return reachable
}

function validateReachableBlob(
  value: unknown,
  expectedKey: ProjectSourceBlobKeyV1,
): ArrayBuffer {
  const actualByteLength = isPlainRecord(value)
    ? arrayBufferByteLength(value.sourceBytes)
    : undefined
  if (
    !isPlainRecord(value) ||
    !exactKeys(value, ['key', 'namespace', 'sha256', 'sourceBytes', 'byteLength']) ||
    value.key !== expectedKey ||
    (value.namespace !== 'robot' && value.namespace !== 'object') ||
    !sha256String(value.sha256) ||
    `${value.namespace}:${value.sha256}` !== expectedKey ||
    actualByteLength === undefined ||
    Reflect.ownKeys(value.sourceBytes as object).length !== 0 ||
    !Number.isSafeInteger(value.byteLength) ||
    (value.byteLength as number) <= 0 ||
    value.byteLength !== actualByteLength
  ) {
    return fail('PROJECT_SOURCE_BLOB_INVALID', `Stored Project source Blob ${expectedKey} is malformed.`)
  }
  return value.sourceBytes as ArrayBuffer
}

function materializeRetainedProjection(
  projection: StoredWorkcellProjectSnapshotProjectionV3,
  sourceBuffers: ReadonlyMap<ProjectSourceBlobKeyV1, ArrayBuffer>,
  revisionId: string,
): WorkcellProjectSnapshotV3 {
  const candidate = structuredClone(projection) as unknown as Record<string, unknown>
  const robot = candidate.robot as Record<string, unknown>
  const sources = robot.sources as Record<string, unknown>[]
  for (const source of sources) {
    const key = `robot:${String(source.sha256)}` as ProjectSourceBlobKeyV1
    const sourceBytes = sourceBuffers.get(key)
    if (sourceBytes === undefined) {
      return fail('PROJECT_SOURCE_BLOB_MISSING', `Retained Project source Blob ${key} is missing.`)
    }
    source.sourceBytes = sourceBytes
  }
  for (const asset of candidate.objectAssets as Record<string, unknown>[]) {
    if (asset.sourceKind !== 'step') continue
    const key = `object:${String(asset.sourceSha256)}` as ProjectSourceBlobKeyV1
    const sourceBytes = sourceBuffers.get(key)
    if (sourceBytes === undefined) {
      return fail('PROJECT_SOURCE_BLOB_MISSING', `Retained Project source Blob ${key} is missing.`)
    }
    delete asset.sourceSha256
    asset.sourceBytes = sourceBytes
  }
  try {
    preflightWorkcellProjectShapeV3(candidate)
  } catch (error) {
    return fail(
      'PROJECT_REVISION_INVALID',
      `Stored Project revision ${revisionId} could not be reconstituted.`,
      error,
    )
  }
  return candidate as unknown as WorkcellProjectSnapshotV3
}

/**
 * Marks and sweeps the native revision store under the same cross-tab Dexie
 * write lock used by commits. No deletion occurs before every retained record
 * and its reachable Blob metadata have passed closed validation.
 */
export async function garbageCollectProjectRevisionStorageV1(
  database: ProjectDatabase,
  hooks: ProjectRevisionGarbageCollectionHooksV1 = {},
): Promise<void> {
  await database.transaction(
    'rw',
    database.projectPointers,
    database.projectRevisions,
    database.projectSourceBlobs,
    async () => {
      const rawPointer = await database.projectPointers.get('active')
      if (rawPointer === undefined) {
        return fail('PROJECT_POINTER_MISSING', 'No native active Project pointer exists.')
      }
      const pointer = validateNativePointer(rawPointer)
      if (hooks.afterPointerRead !== undefined) {
        await Dexie.waitFor(Promise.resolve().then(hooks.afterPointerRead))
      }

      const retainedRevisionIds = new Set<string>([pointer.revisionId])
      if (pointer.state === 'publishing' && pointer.previousRevisionId !== null) {
        retainedRevisionIds.add(pointer.previousRevisionId)
      }
      const reachableBlobKeys = new Set<ProjectSourceBlobKeyV1>()
      const retainedRevisions = new Map<string, StoredProjectRevisionV1>()
      for (const revisionId of retainedRevisionIds) {
        const row = await database.projectRevisions.get(revisionId)
        if (row === undefined) {
          return fail(
            'PROJECT_REVISION_MISSING',
            `Retained Project revision ${revisionId} is missing.`,
          )
        }
        const revision = validateRevision(row, revisionId)
        retainedRevisions.set(revisionId, revision)
        for (const key of exactReachableBlobKeys(revision.snapshot, revisionId)) {
          reachableBlobKeys.add(key)
        }
      }
      const sourceBuffers = new Map<ProjectSourceBlobKeyV1, ArrayBuffer>()
      for (const key of reachableBlobKeys) {
        const row = await database.projectSourceBlobs.get(key)
        if (row === undefined) {
          return fail('PROJECT_SOURCE_BLOB_MISSING', `Retained Project source Blob ${key} is missing.`)
        }
        sourceBuffers.set(key, validateReachableBlob(row, key))
      }
      for (const [revisionId, revision] of retainedRevisions) {
        materializeRetainedProjection(revision.snapshot, sourceBuffers, revisionId)
      }

      const revisionKeys = await database.projectRevisions.toCollection().primaryKeys()
      const revisionsToDelete = revisionKeys.filter((revisionId) =>
        !retainedRevisionIds.has(String(revisionId)))
      const blobKeys = await database.projectSourceBlobs.toCollection().primaryKeys()
      const blobsToDelete = blobKeys.filter((key) =>
        !reachableBlobKeys.has(String(key) as ProjectSourceBlobKeyV1))

      await database.projectRevisions.bulkDelete(revisionsToDelete)
      await database.projectSourceBlobs.bulkDelete(blobsToDelete)
    },
  )
}
